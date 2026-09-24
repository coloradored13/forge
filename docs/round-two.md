# Closing cold review round two

**Working document. Start here.** Written 2026-09-20 against `main` at `e8c3652`.

This is the durable copy of the round-2 plan and its work items. A conversation's task list does
not survive the session it was made in and auto-memory is scoped per directory, so this file — in
the repo, version controlled — is the thing to read first. The matching plan lives at
`~/.claude/plans/structured-cooking-hearth.md` and the finding-by-finding disposition, with
evidence for each, is at https://claude.ai/code/artifact/1b168a6c-9474-4944-9040-f71dfdb47c3b

---

## What happened

Three independent reviewers attacked the whole pipeline, release included, from a cold bundle
(`tools/review-bundle.mjs` — spec, source, evals, one real run's evidence, and deliberately none of
our reasoning or known defects). Every claim was re-verified in-repo before acceptance:

**14 confirmed · 2 scoped down · 2 rejected · 7 of them success-while-false** — paths where the
evidence chain reports success while the signed claim is untrue.

Condition **(d)** of the back-to-green freeze — *cold reviewers find no unresolved foundational
flaw* — is **not met**. The freeze holds.

### State

forge `main` at `e8c3652`, clean. Bakehouse (`~/Forge/bakehouse`): intake approved r0 · sdd
approved r2 · build approved r3 · qa approved r0 · **release at `review` r1, never approved**.
26 commits on `forge/build` ahead of `origin/main`. 23 human flags, 3 of which overrode a guard.
Delivery cost $654.89 over 477 calls — builders $289.68, judges $278.48.

**Do not approve Bakehouse's release gate.** Leaving it at `review` is the honest record; approving
it would sign evidence we have established does not hold.

### Rulings taken 2026-09-20

1. **Re-cut release, do not patch it four times.**
2. **Cheap transfer probe before the full transfer test.**
3. **Delete the keyed judge carry.**

---

## The shape of the problem

Fourteen findings collapse to four roots. Fixing roots is what keeps this from being fourteen patches.

| Root | Findings | The mistake |
|---|---|---|
| **The chain is built from the wrong end** | A1, A3, A4, A6, A7 | Release projects *what happened* instead of checking *what was promised*. `chainOf()` takes no contract. |
| **A declaration is believed, not checked** | A2, A5, B2, B5, B6, #12 | The runner accepts an agent's or an artifact's own account of itself. This is the refusal blindness generalized. |
| **Doors compose in ways the rules do not intend** | B1 | The ceiling guards one transition and one episode, so two legal doors buy unlimited rounds. |
| **The evals cannot fail on the property they name** | 6 of ~13 suites | Fixtures define away the tested case. This is why two prior fixes shipped without working. |

Efficiency-only, cataloged per the standing directive: cache-key economics · the judge/builder cost
ratio, which **gets worse** once the carry is deleted.

**B7 is no longer cataloged — its trigger has fired.** See *Model independence* below.

### Cost shape

Only W3 and W4 spend real money. W0–W2 are fixtures and unit work.

| Wave | Rough spend |
|---|---|
| W0 eval integrity | $0 — no model calls |
| W1 product-independent correctness | $0–5 |
| W2 structural | $0–10 |
| W3 transfer | probe ~$20–40, then $150–350 |
| W4 re-earn | **$400–700** |

If a session is unsure whether to spend, the answer through W2 is no.

---

# Wave 0 — make the evals able to fail

**Must precede everything.** We have twice shipped a fix that did not work: the ceiling fix
addressed the wrong half, and three evals written this cycle could not fail. Fixing the rest with
that discipline would mean believing we fixed them.

### 0.1 Strengthen R15 with falsification-first

R15 already owns the eval harness, so no new rule. Every new or changed check is demonstrated
**red before green**, and the PR description carries the red run.

### 0.2 Retrofit the six known-defective suites

Each shown red against a seeded violation:

- **`evals/release.mjs`** — the check named *"one row per criterion the contract carries"* passes a
  hand-built **intake** to `chainOf()`, so a contract→intake drop is unreachable. Must pass a
  *contract*; red on a dropped criterion.
- **`evals/qa.mjs`** — the whole-stage green path fabricates TAP pass lines plus a scripted clean
  oracle. Must be red on an `assert.ok(true)` test whose title carries the right `T-n`. Note this
  suite currently builds that exact shape as a *positive* fixture.
- **`evals/scope.mjs`** (rejudge) — changes STORY-2, a field already inside STORY-2's judge key,
  then celebrates that the others stand. Must be red on a changed input *outside* the key.
- **`evals/provenance.mjs`** — the brownfield `PRIOR` fixture has `tests: []`. Must carry real
  prior tests.
- **`evals/transition-table.mjs:188`** — asserts the cap by constructing the at-review state
  directly instead of calling `finish`, the only transition that increments. Must drive the ceiling
  through the real transition.
- **`evals/economics.mjs:95`** — asserts `err?.spent === 1.2 && err?.budget === 1.0`, codifying a
  violation of R1 as the expected result. Also `:512`, whose *"the round is counted from zero"*
  label runs on a stage already at round 0 and cannot fail either way.

### 0.3 Audit the other seven suites

`amendment-audit`, `coherence`, `funnel`, `owns`, `rulings`, `seam`, `spec-budget`. The six above
are only what two reviewers happened to read. Round 1's finding #9 already made this mandatory —
*"every 'eval owns this rule' claim in `rules.json` is now unverified"* — and it has been
outstanding since 2026-09-07.

Two questions per suite: does any check construct the state it asserts on instead of driving the
transition that produces it? Does any assert a property the fixture makes unreachable?

**Record the result per suite.** A clean suite is a finding too, and the recorded audit is what lets
`rules.json`'s enforcer claims be cited as architectural evidence again.

**Exit criterion:** six retrofits red-before-green **and** an audit result recorded for all seven
others. Until then `npm run evals` is not citable as architectural evidence.

**What survived attack — keep it.** `suite(name, expected)` and its denominator guard could not be
falsified. The failures are all fixtures, not the harness.

---

# Wave 1 — product-independent correctness

Nothing here depends on what product runs through the pipeline.

### 1.1 Ceiling becomes cumulative per stage, across episodes  (B1)

Two bypasses, both real:

- **Walked by hand.** From blocked at round 3, ceiling 3: `escalate` correctly refuses
  `at-ceiling`. Then `stop` → stopped r3 → `start` → running r3 → `finish` → **r4**. The earlier fix
  removed `opens` from the start transition, which stopped the round *resetting*. It never stopped a
  round being *spent*. A reviewer attacked stop/start, found the reset closed, and reported it
  non-falsifiable — they tested the half we had fixed.
- **Composed from two legal doors.** `delivery/state/index.mjs:84` — `blocked → approve` guards are
  `["fresh", "non-block"]`, and `non-block` is overridable. `:95` — `approved → reopen` carries
  `opens: true`. `:138` — `if (row.opens) next.round = 0`. Override-approve then reopen restores the
  ceiling in full, repeatable, with nothing on the record distinguishing it from an honest reopen.

**Fix the root:** count judged rounds cumulatively per stage; `finish` is subject to the cap, not
just `escalate`; raising the ceiling requires an explicit escalate with a reason.

Also correct **`shared/schema/run.schema.json:58`**, which still documents the pre-fix behaviour
(*"a stop, a reopen or a moved handoff opens a new episode at zero"* — false for stop). R10 says one
home per concept; the fix for R6 left the home saying the opposite, and that stale line is why a
reviewer reported a closed bypass while missing the open one.

### 1.2 Delete the keyed judge carry  (A5)

`shared/judge/index.mjs:166` — `s.id === item.id && s.key === prepared.key && s.tools === 0`.
Remove that branch and the `stands: true` entry it takes. `prepare()`'s key stays useful for the
ledger but stops gating re-judgement.

**Why delete rather than patch a third time.** The key names the prompt, and what a judge is held to
is not confined to its prompt. Round 1 found repo-reading judges (44% of Bakehouse's used a repo
tool) and we answered with the `tools === 0` guard. Round 2 found a second route:
`contract.constraints` reach the **writer** (`delivery/sdd/index.mjs:98`, inside `write()`) and never
the judge — `judgeAll()` renders them nowhere, and `shared/scope.mjs:16` returns only
`{ mvp, deferred }`. A handoff changing *only* a global constraint moves no judge key, so every
tool-free judgement stands for $0, the binding does not move, build's currency stands too, and the
new signed constraint never becomes anyone's obligation.

Two rounds, two independent routes, same mechanism. A third is likelier than not.

**Cost rises, accepted deliberately.** The $0 `stands` rows were the saving. Do **not** solve the
resulting cost problem by reinstating a carry keyed on the prompt — that is the defect both rounds
found. Any future reuse must declare what it assumes unchanged and have the runner verify it (R16).

*Verification, red first:* a fixture changing only `handoff.contract.constraints`, preserving every
work item and design object, must produce a fresh judge call per item. Today it produces zero.

### 1.3 Budget reserves against its estimate  (B3)

`shared/agent-call/index.mjs:117` asks *"already over?"* before a call and never reserves against
expected cost, so a run at $0.99 of a $1.00 cap may start an arbitrarily expensive call.

Reuse the existing `quote()` / `estimateRun()` per-model history — do not build a second estimator
(R10). Refuse when `used + estimate > budget`.

Decide and record which way R1 moves: either it means *pause before exceeding* (gate and eval both
wrong) or *stop once over* (R1's wording is wrong). Something has to move; today the eval defends
the gap.

*Verification, red first:* budget 1.0, one 0.6 call admitted, a second **refused before the model
runs**, total spend 0.6.

### 1.4 `scopeOfRevision()` fails closed — and closes #6

`delivery/run/index.mjs` tries a finding's structured `subject`; failing that it scans concatenated
free-text `summary` + `evidence` for known IDs; finding none, it opens **every** work item. Model
phrasing decides machine scope.

**Two rulings collide here. Do not pick one blindly.**

- Round 1 (binding): the fallback is *"widen scope whenever complete scope cannot be established."*
- Round 2 (B5): that widening **is** the defect.

They reconcile at exactly one shape:

> A finding declares **`implicated_items`** — plural, explicit ids, never resolved from prose.
> Some resolve → revise exactly those. **None** resolve → `finding-unrouted`, revise nothing, the PM
> disposes (R7).
>
> Round 1's *widen* governs a **partially** known scope. Round 2's *fail closed* governs a **wholly
> unknown** one. Both hold.

**`subject` alone cannot close #6.** It is singular, and #6 exists precisely because a cross-item
finding must name both items — round 1 wrote it as `finding.implicated_items = ["STORY-1","STORY-2"]`.
Implementing only *"require a structured subject"* closes B5 and leaves #6 open while looking like it
closed it. `subject` stays as the ruling-re-raise key it already is in `splitReraised`.

**This gates Waves 2 and 4.** Round 1's binding ruling: #6 must be CLOSED before the next
finding-driven regeneration, because it can mechanically undo a correct cross-item repair before QA
sees it. The release re-cut and the Bakehouse re-run are both exactly that.

*Verification, red first:* (1) a finding with no resolvable ids opens **zero** items and emits
`finding-unrouted` — today it opens all. (2) The same semantic finding with and without an incidental
id in its evidence produces the **same** scope. (3) A cross-item finding naming two items revises
both — impossible to express today.

### 1.5 Spec truth pass  (A6, partial)

`SPEC.md:107` — *"QA re-runs the prior manifest's tests as regression"* — and `:166`'s stage-table
cell *"Prior manifest's tests still pass"* both describe a mechanism that does not exist.
`delivery/qa/index.mjs` never reads a prior manifest. Intake persists only its path and a
human-readable `manifestSummary`: presentation text, not an executable prior test plan.

R11 calls brownfield the main mode, so the right end state is to **implement** it — but that is
runner-coupled and belongs in W3. **Correct the spec now** so it stops asserting a mechanism it does
not have, and audit §5's stage table for other claims the code does not honour. SPEC is CI-gated on
word budget, so the correction must fit.

### 1.6 Round-1 remainder

Still outstanding and belonging to this wave: `verdictFreshness` recompute plus a temporal-race
eval; the `checked`/`skipped` coverage guard.

---

# Wave 2 — the two structural pieces

### 2.1 R16 — a declaration is checked, never believed

One new rule in `SPEC.md` §3 and `shared/rules.json`. **Compression, not accretion:** it is the
principle already established for refusals — *declared by the agent, verified by the runner, neither
believed nor inferred; a declared refusal buys a reason, never a pass* — generalized to every site
that shares the blindness.

The sites, from months of independent sightings:

| Site | The declaration nobody checks |
|---|---|
| **A2** | a test's *title* declares what it proves; the `T-\d+` regex believes it |
| **A5** | the judge key declares the question and omits contract constraints *(deleted in 1.2)* |
| **B2** | the build currency hash declares what moved and omits dependencies |
| **B5** | a finding's prose declares its scope *(closed in 1.4)* |
| **#59** | a refusal declared outside a purpose-built schema reads as a failure |
| **#12** | an expected-red leg declares it is deferred and nothing verifies the flip can happen |

That last one predates the cold reviews by months and is the same rule in v1 vocabulary: *"a leg
expected to be red is indistinguishable from a leg that is broken, so the promise went unverified for
a whole slot. A cheap fix is to require the leg to print WHY it is red in machine-checkable terms,
and to have the later slice's own audit assert that figure has changed."* Carry that concrete shape
in — two joinable assertions instead of one trusted flip.

R10 requires one enforcer per rule, so this PR must produce **one home**. Preference: a named
`declared-unverified` finding class every site emits, plus an eval enumerating the sites — *not* a
shared helper, because the verifications are genuinely different and a helper fitting all of them
would be doing nothing.

Re-ask SDD-5's **OQ-5** here: does a gate read a deferred leg at its own slot or only at
end-of-cycle? Unanswered since v1, and it is a pipeline design question wearing product clothes.

Run `node tools/import-rule.mjs && node tools/owns.mjs`.

### 2.2 Release re-cut — derived downward from the contract

Rebuild `delivery/release/index.mjs` (365 lines), `delivery/release/verify.mjs` (188) and
`evals/release.mjs` (172) around one principle:

> **The expected row set comes from the signed handoff, and anything release cannot account for is a
> finding, not an absence.**

- **A1** — `chainOf(handoff, intake, …)` derives expected criteria from `contract`, not from
  `intake.work_items`. A contract criterion with no row is `criterion-unaccounted` and release cannot
  approve.
  The drop happens upstream: coverage arithmetic applies only to *functional* requirements, but a
  story may name any in-scope requirement in `req_refs`. `delivery/intake/index.mjs:175` skips
  non-functional in the *"no criterion dropped"* pass; `:257` suppresses the standalone item when
  `storied`. So a non-functional criterion inside the MVP line, referenced by a story with no
  scenario proving it, vanishes entirely. **Fix intake's asymmetry too, but do not rely on it** —
  release is the last place that can catch it.
  The **verifier** re-derives the expected set from the shipped, pinned `forge/handoff-vN.json` — it
  is already in the repo, so the fresh-clone check becomes *complete* rather than internally
  consistent. Today it only checks the manifest's own rows for duplicate or empty ids.
- **A3** — `x-drift-checked` becomes **the whole document except `/meta/content_hash`**. Today it is
  `["/chain","/handoff","/verdicts","/pins"]`, leaving `product`, `verifier`, `cost`, `advisories`,
  `deferrals`, `drift`, `argv`, `built_at` unsigned. This closes the verifier's self-certification
  loop for free: `/verifier` moves inside the hash, so its SHA can no longer be updated in place.
  The verifier must additionally check **`product.commit`** — grep it today and you get comment lines
  only, it is never checked by anything — and that chain commits are ancestors of it.
- **A4** — `advisoriesOf()` carries **every** finding from every gate verdict, tagged with the gate's
  verdict and whether a human overrode it. Delete the `doc.verdict === "block"` skip. Overridden
  blocks are the most consequential class and are exactly what the projection drops. Bakehouse
  shipped `advisories: 33`, all `question` from intake, while sdd/build/qa all blocked.
- **A7** — `delivery/release/verify.mjs:138` runs only `git cat-file -t`. No rev-list, no merge-base,
  no ancestry anywhere. Add a repository-only check that the credited commit's diff touches the
  item's declared surface.

### 2.3 The oracle sees the test source  (A2 half one) — closes #58, answers #56

A builder can write `test("REQ-1/AC-1 · T-1 — records an exception", () => assert.ok(true))` while
the product does not record an exception. The title creates the join, `assert.ok(true)` creates the
passing bit, and the oracle has no test body from which to discover the asserted property is
unrelated. Release then marks the criterion discharged.

**The isolation is inverted.** The oracle is denied the binding's `asserts` — the writer's prose
about assertions — but *is* given `exercises` and `proves`, also writer prose, plus the title and the
pass bit. It withholds the factual thing and supplies the account.

**Fix:** give the oracle the test **source**; drop `exercises` as the primary account. Seeing the
code is not the leak the isolation was built to prevent — it is what makes the judgement independent
of the writer at all.

Half two — test identity across arbitrary runners, replacing the `T-\d+` title regex with a
structured join — is runner-coupled and rides with W3. Do not design it against JS-only assumptions.

**This closes #58 and answers #56.** #58 (*"the test is wrong" has two sub-cases routing to different
stages*) is unanswerable today precisely because nothing downstream sees the test; an oracle holding
the source can separate a wrong test (→ sdd) from a wrong product (→ build). #56 (the oracle reached
for Bash despite no write surface) is the same investigation from the other side: settle what the
oracle may read in the PR that gives it more to read.

**Also decide:** QA discards raw suite output once the oracle has read it, so the shipped record
holds only the parsed projection and the fresh-clone verifier cannot re-derive whether the parser was
faithful. Retain it or state why not.

### 2.4 Build currency covers dependencies  (B2)

`delivery/build/index.mjs:47` — `BOUND = ["approach","interfaces","tests","controls","surface","risks"]`
hashes an item's **own** fields, so a dependent whose dependency's contract moved is reused for $0 and
never re-examined.

*Scoped down from the reviewer's version:* their mechanism was wrong — they argued the carried
dependent's commit sits behind its dependency in history and so "runs against the outdated version".
Git does not work that way; the tip tree carries both. The substance survives: dependency identity is
missing from the currency. Fold each dependency's bound hash in.

The notional catch is QA running the whole suite at the tip — but per 2.3 that discharge is a title
join, so do not rely on it.

*Verification, red first:* STORY-1 depends on STORY-2; both build; STORY-2's binding moves; STORY-1
must rebuild. Today it is reused for $0.

---

# Wave 3 — transfer

### 3.1 Cheap probe first (~$20–40)

A small non-JavaScript repository through **intake + sdd only**. No build, no qa, no release. The
deliverable is the **finding list**, not a passing run — diagnostic spend, not evidentiary.

Purpose: surface single-product assumptions so 2.3's half two and B4 are designed once. B4 is already
known and two of three reviewers found it independently:

- `shared/runners.mjs` — `RUNNERS` holds exactly two commands: `node --test` over
  `tests/unit/*.spec.js`, and Playwright over `tests/browser`.
- `delivery/build/index.mjs` `standsOn()` — searches for required test IDs only in tracked files
  whose paths contain `test/` or `tests/`.
- the builder network policy names npm/yarn and Playwright distribution hosts.

A `cargo test` or `pytest` product, or one whose tests live beside their source, breaks the proof
layer with no architectural novelty: QA never executes its native suite, and zero-cost `stands`
reports required test IDs absent merely because they live elsewhere.

Run it **after** W0–W2 so the machinery under it is sound, but **before** committing to the runner
layer's design.

### 3.2 Full transfer test

Brownfield, materially different. Freeze condition (e). Three pieces land together because they live
in the same layer: **runner generality (B4)**, **A2 half two**, and **A6's prior-manifest regression**.

*"Brownfield is the main mode"* has never actually been exercised. Until it is, R11 is a claim, not a
property.

---

# Wave 4 — re-earn the evidence

Bakehouse's current release is **not trustworthy evidence**. Estimated spend $400–700.

1. **Re-run Bakehouse end to end. Expect work, not a clean run.** Record these predictions *before*
   starting, so they can be scored after:
   - A1's fix will report some number of criteria that silently went missing. That number is unknown
     today and is the real measure of what the old manifest was hiding.
   - A4's fix will put the three overridden blocks' findings on the manifest for the first time —
     which the existing override reasons already falsely claim is happening.
2. **Contingency.** Bakehouse has blocked at STORY-4 and STORY-6 before and a stricter release gate
   raises the odds. If the re-run blocks, **that is the pipeline working** — the honest reading is
   that the old approval was the anomaly. Do not relax a gate to get through it. Route it as a
   finding; if the block is a Forge defect rather than a product one, it qualifies under the freeze
   exactly as STORY-6 did.
3. **The test for condition (c).** *Evidence supports trust without line-by-line review* is the whole
   claim and has no test elsewhere in this plan. **Seeded-defect run:** take the re-run product,
   inject one A1-shaped drop (a contract criterion no work item carries) and one A2-shaped no-op test
   (`assert.ok(true)` with a valid `T-n` over deliberately wrong behaviour), and confirm the fixed
   pipeline **blocks both** end to end with real calls. Scope to the stages that should catch them
   rather than a full rebuild. Passing evals prove the fixture; only this proves the pipeline.
   **Run this twice — once with `delivery.judge` on the writer's model family, once on a different
   one.** The seeded run is the only place where ground truth is known, which is what B7's
   measurement has always lacked. See *Model independence* below for what that can and cannot show.
4. **Round-3 cold review.** `tools/review-bundle.mjs` needs no change.

---

## Model independence — B7's trigger has fired

Every agent role runs on the same model family. `shared/agent-call/models.json` pins all six —
`discovery.workshop`, `discovery.writer`, `discovery.reviewer`, `delivery.writer`, `delivery.judge`,
`delivery.builder` — to `claude-opus-5`.

**The trigger was written down in round 1 and has now been met.** That disposition was *measure
first, no rule*, with the stated condition for acting: *"misses concentrate where writer = judge →
require a distinct judge model for QA only, one config line."* Round 1's reviewer raised it; round
2 had **all three reviewers** reach it independently. One sharpened it past the model name: the
oracle receives the SDD writer's own `exercises` prose rather than an independent observation, so
the roles share an upstream *description* as well as weights.

They were also fair about it — Forge caught exactly this class in Bakehouse, the durability
criterion where killing a process is not a power cut. The mechanism is not inert. What it lacks is
any axis that would *force* the distinction when writer, builder, test and oracle all choose the
same wrong surrogate.

### Why this is now cheap

Two things changed that were not true when B7 was first cataloged:

- **The config surface already exists.** `models.json` pins per `half.role` and its own note says
  *"A run's setup overrides per role; an unknown role is refused, never defaulted."* Varying the
  judge is a config line, not code. It takes full model-ID strings, so it can pin exact versions,
  not just families.
- **W1 removes the barrier.** A round-2 reviewer complained that baking `model` into the judge
  cache key punishes switching models — every standing judgement invalidates at once. That was
  **rejected as correct by design** (a different model *is* a different judge), but it was a real
  practical cost. **Deleting the keyed carry (1.2) makes it moot.** After W1, switching judge models
  costs nothing beyond the calls themselves.

Cost also cuts the right way: a cheaper reviewer alongside an Opus one is *less* expensive than two
Opus reviewers and *more* independent. That is the rare change that helps both B7 and the judge
cost ratio.

### The measurement, and its limits

**Run it on W4's seeded-defect run.** That run injects one A1-shaped drop and one A2-shaped no-op
test, so unlike every previous run **the ground truth is known** — which is exactly what judge-miss
rate needs and has never had. Run it once with `delivery.judge` on the writer's family and once on a
different one, and compare what each catches.

**State the limit honestly: two seeded defects is a directional signal, not a calibration.** It
cannot establish a miss rate. What it can do is show whether a differing judge catches something the
same-family judge does not — and one such case is enough to promote B7 from *measured* to *ruled*.
Do not report it as more than that.

If it fires, the rule is the one round 1 already drafted: a distinct judge model for QA only, one
config line, no new rail.

### Sigma-side (not Forge, noted so it is not lost)

The 33 agent definitions in `sigma-system-overview/agent-infrastructure/agents/` carry **no
frontmatter at all** — they open directly on `# {Agent Name} Agent`. So every one inherits the
global Claude Code default, which is why a single `settings.json` line moved all of them between
model families at once. Per-agent `model:` frontmatter would let cheap models take the mechanical
passes and Opus take the analytical ones. Separate repo, separate decision, same idea.

---

## Cold review is a cadence, not a gate

The empirical case is one-sided. Round 1 found 9 Class-A defects. Round 2 found 14 more including 7
success-while-false, **several in code written after round 1**, and three reviewers converged
unanimously on a hole two internal rounds had walked past.

It is also nearly free on our side: the bundle is file concatenation, and the reviewing happens
elsewhere. The cost is the user's time, not the ledger.

- **Review after W2, before any W3/W4 spend.** W2 re-cuts release and lands R16 — the two most
  structural changes here, both designed by the same author who built the stage round 2 falsified.
  Finding a design flaw before paying Bakehouse prices for it is the argument.
- **Round 3 after W4**, as the condition (d) retest.
- **Write the prediction down first.** Two rounds in, we cannot say whether we are getting better at
  self-review or just patching what outsiders hand us. A prediction file is the only way to find out
  and it costs a paragraph. Round 2's honest prior would have been *"release is new, it is probably
  the weakest stage"* — which was right, and which we did not act on.
- **Keep the brief cold.** The bundle deliberately withholds our reasoning and our known-defect list,
  and excludes itself. Never add *"here is what we fixed"* — a reviewer told where to look has been
  steered. For the W2 review, add the *scope* of what changed, never the rationale.

---

## Verification

- **Per PR:** every changed check shown **red before green**; `npm run evals` green;
  `node tools/import-rule.mjs && node tools/owns.mjs`; CI green; merged as a separate step.
- **W0 exit:** six retrofits red-before-green **and** an audit result recorded for each of the other
  seven suites.
- **W1:** drive a stage to the ceiling through real `finish` transitions and confirm both bypass
  paths refuse; confirm a judge is re-asked when only `contract.constraints` moved; confirm a call is
  refused *before* the spend crosses the cap; confirm an unroutable finding opens nothing and a
  cross-item finding revises both items.
- **W2 exit:** a cold review of the re-cut, briefed on scope but not rationale, before any W3/W4
  spend. Prediction recorded first.
  Seed a non-functional criterion referenced by a story with no proving scenario, take it to release,
  confirm `criterion-unaccounted` blocks. Edit `cost.usd` in a released clone — the verifier must now
  fail. Edit `verify.mjs` **and** its descriptor together — must still fail. Confirm an
  `assert.ok(true)` test with a valid `T-n` title no longer discharges.
- **W3:** the probe's finding list is the deliverable, not a passing run.
- **W4:** Bakehouse reaches an *approved* release, manifest and verifier green in a fresh clone, the
  seeded-defect run blocks both injected defects on both judge-model arms, and the round-3 bundle
  goes out unchanged. Record what each arm caught — one case a differing judge catches and the
  same-family judge does not is enough to promote B7 from measured to ruled.

---

## Against the five freeze conditions

| | Condition | Where |
|---|---|---|
| (a) | Bakehouse to QA and Release | reached, **not approved**; re-earned in W4 |
| (b) | Manifest verifies in a fresh clone | met but **hollow** until W2 |
| (c) | Evidence supports trust without line-by-line review | **fails on A1 and A2**; fixed W0–W2, *tested* by W4's seeded-defect run. Until then (c) is asserted, not demonstrated |
| (d) | No unresolved foundational flaw | **fails now**; retested round 3 in W4, with a mid-point review after W2 |
| (e) | A second product demonstrates transfer | W3 |

**The freeze holds until (d) is retested against a fixed pipeline.**

---

## What held

Worth keeping in view while working through fourteen findings. The reviewers confirmed what *does*
hold: `suite(name, expected)` and its denominator guard survived direct attack, and an outside
reviewer with no access to our findings reached the refusal blindness independently — probing the
explicit channels (a builder's structured `blocked`, `criterion-unprovable`, the counter-proposal
path), failing to falsify them, and confirming the two sites we closed are genuinely closed. That is
the first external evidence our own analysis of the foundational defect was right.

The machinery is not rotten. It reports success it has not earned, which is a narrower and more
fixable thing than fourteen findings feels like.
