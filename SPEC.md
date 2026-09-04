# Forge v2

`doc` forge-v2 / spec · `rev` draft 2b · `date` 2026-09-04 · `status` approved for M0 · `supersedes` draft 1, the v1 six-lane plan · `size budget` ≤ 3,500 words, enforced by `evals/spec-budget.mjs`

> A product manager works a PRD into a vetted, linked backlog a team can take — **or keeps going, and agents build the product with the pipeline producing the proof.**
>
> One repo, two halves, one seam. **Discovery** produces what humans sign. **Delivery** produces what machines prove. The PM chooses where to stop.

| 16 | 13 / 29 | 3× | 33 : 1 | 29 → 10 | 8 → 4 + 4 |
|---|---|---|---|---|---|
| v1 rounds — all on discovery-side artifacts | amendments that were real discovery | spec surface with no MVP line | scaffolding to prompt | eval suites | stages, split by who signs |

This file is the spec's home (R10). The published artifact is a rendering of it.

## §1 What v1 proved

Two runs, two pipeline versions, eight days.

**Proved · dock-exceptions**

- A hash-chained pipeline carries a PRD to a merged product with provenance: 7 stages, 34/34 chains, 253 tests, 111 browser-backed steps; the verifier passes in a fresh clone.
- The delivery half's governance works: a build refused to widen its own write surface; both QA blocks converged in one round; every recovery went through a door.

**Proved · bakehouse**

- Judges find spec defects a human missed: "terminal" half-defined, rulings with no owner, a budget calibrated for the wrong event.
- The loop converges once the spec stops contradicting the judge: 20 → 19 → 16 → 14 → 12 → 8 → 5.
- Discovery is front-loaded: all 10 genuine-discovery amendments came from prototype rounds 1–2.

**Disproved · bakehouse**

- **The fusion.** All 16 rounds were spent on discovery-side artifacts — prototype and stories — held to the delivery bar: the story judge demanded executable specs; the prototype regenerated four times because it was a chain link. The unusable part was never the build half.
- **Gate accuracy is not usability.** Every gate was locally right; 29 amendments reached 2.5 of 8 stages in two days. 13 were product discovery; 16 were the pipeline charging for its own defects.
- **Round 3 feeds on itself.** Discovery was exhausted by round 2 in both stages.
- **Cost scales with spec surface** — 20 requirements against 8, no MVP line to say "not now."
- **Accretion is the default.** 22k lines in eight days; 29 eval suites around 618 lines of prompts.

## §2 The split

Two bars, because two executors. The seam is a snapshot.

| | Discovery | Delivery |
|---|---|---|
| executor | a human — the PM, a designer, a team | a machine — agents whose output nobody reads before it runs |
| bar | vetted and linked | proven |
| loop | human-triggered review; the PM is the loop | capped regeneration with a cost function |
| staleness | a badge and a diff; the PM decides | re-judge, regenerate only on block |
| state | document status: draft → reviewed → signed | one state machine with liveness |
| may amend the PRD | yes, audited | never — it may only ask |
| output | Jira (ideas, epics, stories) + the handoff | a product + its provenance manifest |

**The seam.** The **handoff** is a snapshot, not a set of references: the contract, stories, design, and prototype embedded as they stood at export, hashed per item, with the Jira keys they were exported to. Discovery writes it whichever exit the PM picks. Delivery reads nothing else and must start cold from a handoff file with the Discovery code absent.

After export, drift enters from either side — the PM in Discovery, the team in Jira. Intake diffs the snapshot against whatever is live and reports per ID: unchanged, changed with the diff, added, removed. The door is the PM's: proceed on the snapshot, or re-export a new handoff version. The prototype rides as record only — nothing in Delivery reads it; the design is the binding referent.

**The stopping spot.** Discovery's export door has three exits: **hand off to a team** (Jira), **send to Delivery**, or both. Because the handoff persists, stopping is a pause, not a fork — a team that took the Jira export can start Delivery from it a month later.

**One repo.** `discovery/`, `delivery/`, `shared/`. One import rule — `delivery/` imports from `shared/` only — and one cold-intake eval keep the halves from re-fusing under pressure.

## §3 Rules

The traps as constraints: evidence, enforcer, home. The registry is `shared/rules.json`.

**R1 · Economics are visible before they are spent.** `both`
Every model call goes through one chokepoint that records model, tokens, cost, and duration by half, stage, and role; the model is chosen per role in one config. Discovery shows "this refine ≈ $X; you're at $Y of $Z" before each trigger; Delivery pauses at the budget, never degrades. Cost rides into the Jira export and the manifest.
*evidence* "folks may not want a $100 PRD." *enforcer* `shared/agent-call` · eval `economics`

**R2 · Scope is a gate input.** `both`
Discovery draws the MVP line; the contract binds only MVP; every reviewer and judge reads the line and emits out-of-scope findings as deferrals — zero cost, seeding the next round.
*evidence* 20 requirements for a bakery run sheet. *enforcer* compiler · judge output `deferred[]` · eval `scope`

**R3 · Rulings are spec.** `discovery`
A human's answer becomes a criterion in one mechanical operation — attributed, pinned, versioned. No reviewer or judge re-raises a settled ruling.
*evidence* AMD-14..23: ten amendments, two rounds, to promote content already decided. *enforcer* the `answer` door · eval `rulings`

**R4 · Amendments are audited at mint.** `discovery`
A proposal computes its blast radius — every criterion, story, and screen that references the changed term — and any vocabulary it introduces. The PM approves the radius, not just the edit.
*evidence* AMD-7 unaudited → AMD-11..13; AMD-17..23 → AMD-24..26. *enforcer* the `amend` door · drift `undeclared-vocabulary` · eval `amendment-audit`

**R5 · Staleness triggers a re-judge, not a regeneration.** `delivery`
When the handoff moves, each downstream stage is re-judged; the writer runs only if the re-judge blocks. Pin refreshes never count as rounds.
*evidence* prototype rounds 5–8: four rounds of zero product value. *enforcer* `stale → rejudging → {approved | review}` · eval `rejudge`

**R6 · Rounds are capped and the cap is a door.** `delivery`
Default 2 judged rounds per stage, ceiling 3. At the cap an advise proceeds with its findings as advisories on the manifest; a block at the cap is the human's call — accept on the record, or buy a round with a reason. Discovery has no automatic rounds to cap.
*evidence* discovery exhausted by round 2 in both stages; n = 2, so defaults calibrate at M3. *enforcer* transition table · `escalate` · eval `economics`

**R7 · Reviewers and judges rank; they do not enumerate.** `both`
At most k in-scope findings (default 5) by severity × confidence, each quoting the line it fails and the criterion it would fail. Twenty findings in front of a PM is the same defect in human time. Block still requires certain + high.
*evidence* a 12-finding block re-judged over a 5-finding advise. *enforcer* judge output schema · eval `economics`

**R8 · The funnel narrows, and the seam is where it is measured.** `both`
Any amendment Delivery raises against a Discovery artifact is a gate-miss logged against the Discovery gate that should have caught it, with a postmortem field. The target is near zero — that number is what proves the split was right. Judges are in the funnel too: a finding QA later contradicts is a judge miss.
*evidence* dock-exceptions: 3 late-origin of 31. *enforcer* run record `origin` · funnel meter · eval `funnel`

**R9 · One state machine, one store, one reader.** `delivery`
State is written by the thing that changes it — the wrapper records its own completion and heartbeats while alive. The API is the only reader. No lazy reconcile.
*evidence* two misdiagnosed "wrapper deaths"; rows 1, 17, 25; class C. *enforcer* one transition table read by every door · eval `transition-table`, exhaustive

**R10 · One home per concept, one enforcer per rule.** `both`
A field lives in one schema under `shared/` and is derived into prompt, output contract, assembly, console, and Jira mapping — never retyped. Arithmetic rules belong to drift, judgment rules to judges, and nothing is checked by both.
*evidence* class A: PRs #22 / #23, rows 5, 10, 26; task #20's double enforcement. *enforcer* generated sections · rule registry with an `enforcer` field · eval `coherence`

**R11 · Brownfield is the main mode.** `both`
Delivery's intake takes what exists — repo and prior manifest — and every stage produces deltas; QA re-runs the prior manifest's tests as regression. Discovery in brownfield mode elicits the delta against the manifest. Greenfield is the case where what exists is empty.
*evidence* task #8 never built; a product's second release is the first real test. *enforcer* intake `existing` · eval `provenance`

**R12 · Shape before scope.** `discovery`
The workshop elicits the whole product's lifecycles, vocabularies, attribution, and clock boundaries before the MVP line is drawn; unknowns are marked "unowned — expect discovery."
*evidence* AMD-1..6, AMD-27 — lifecycle gaps a shape pass asks for up front. *enforcer* PRD `shape` section · drift `unowned-term`

**R13 · Stories are testable at the PM's bar.** `discovery`
Every Given names a concrete state; every Then something observable; every story pins the criteria it serves and the screens it uses. Syntax crosses the seam for free; precision is what intake compiles, and a story raising more than a couple of precision questions is a Discovery gate-miss.
*evidence* bakehouse story rounds were never about syntax. *enforcer* story reviewer rules · intake question budget · eval `funnel`

**R14 · The seam is a snapshot.** `both`
Delivery reads only the handoff, runs cold with Discovery absent, never edits a Discovery artifact, and reports drift against the snapshot rather than resolving it. This rule keeps one repo from re-fusing.
*evidence* §1, the fusion. *enforcer* import rule · cold intake in a temp root · eval `seam`

**R15 · Tests never touch real records; fixtures never depend on history.** `both`
Every eval seeds its own state in a temp root. The gate ledger proves it can say "no" on a seeded fixture, not on a sentinel that expires when the pipeline works.
*evidence* class E rows 6, 23; P3, P10. *enforcer* the eval harness

**Kept from v1, unchanged**

- Verdicts pin the hash they judged; presence is never evidence.
- Overriding a block takes a human's word, on the record.
- Doors only — no hand edits to state or hashes.
- Flags are append-only decision history.
- Rulings ride into every writer, reviewer, and judge.
- Design is judged as a designer would: direction, craft, a hero spend.
- Usage limits pause the run; nothing degrades quietly.
- Build accounting is the diff from base, whoever committed.

## §4 Discovery

The original intent. Four artifacts a PM signs, then a door.

`setup` (model per role · budget) → `workshop → prd` (shape, then the MVP line) → `prototype` (the PM reacts; amends the PRD) → `stories` (epics + stories, Given/When/Then) → `design` (refined to sign-off) → **`export`** (team · Delivery · both)

| Artifact | Owns | The reviewer asks | Arithmetic |
|---|---|---|---|
| PRD | Crux, objective, measurements, requirements with criteria, surfaces, **shape**, the **MVP line**. Compiles to the contract; export freezes it. | Does it contradict itself or its founding scenario? Is a gauge gameable? Is ruled behavior unowned? | Every criterion provable; every term in the vocabulary; every surface bound |
| prototype | The concept the PM reacts to — the cheap, *expected* discovery loop that amends the PRD. An exhibit, never a chain link. | What does the spec fail to say? Does it honor the shape? | Every MVP surface has a screen |
| stories | Epics per requirement; stories in Given/When/Then at Jira's granularity. Slicing into work items is Delivery's. | Testable at the PM's bar (R13)? Proves what it pins? Contradicts nothing ruled? | Every MVP criterion has a story; every story pins criteria and screens |
| design | The canonical production design, two-faced: rendered for sign-off; structured (structure, tokens, states, viewport) for Delivery to bind to. | Direction decided? Crafted, not generic? Hero spend? One language across screens? | Every story screen designed; every design screen claimed |
| export | The ready gate — all joins green — and the three-exit door. | — | Handoff snapshot, versioned, hashed per item |

**The loop is the PM.** Generate → review (≤ k ranked findings and deferrals) → the PM acts: **accept** · **edit** · **answer** (ruling → criterion) · **amend** (edit + blast radius) · **defer** · **refine** (regenerate with the PM's notes — cost shown first). Nothing regenerates without a human trigger. When the PRD moves, downstream artifacts wear a stale badge with the diff; the PM refreshes what matters.

**Jira.** Crux and objective → a Jira Product Discovery idea with the PRD attached; requirements → epics; stories → stories under their epics. REQ-n / AC-n / SCREEN-n ride as fields, so every issue links to its PRD section. Jira is a projection of the handoff with the same IDs — never a chain link.

## §5 Delivery

Forge proper. Starts from a snapshot, ends with a product that carries its proof.

`setup` (existing · models · budget · cap · estimate) → `intake` (validate · diff · compile · slice · ask) → `sdd` → `build` → `qa` → **`release`** (manifest into the product repo) ↺ next round: a delta PRD in Discovery against the manifest (R11)

| Stage | Owns | The judge asks | Arithmetic |
|---|---|---|---|
| intake | Validating the handoff (schema, version, hashes); the drift diff; compiling stories to executable scenarios with step skeletons; slicing work items; precision questions back — the one door across the seam. | — | Joins re-run; drift reported per ID; questions per story within budget (R13); prior manifest loads in brownfield |
| sdd | Binding the signed design and the scenarios to tests and interfaces per work item, before code. sdd never invents an interface. | Does each test prove something? Do the interfaces agree across items? | Controls ⊂ design; tests ↔ criteria; shared interfaces verbatim, each writer verifying a neighbour's (peer ring) |
| build | The code, contained per work item, accounted from base. | No judge — QA is the judge. | Containment; change set from base; manifest currency for $0 reuse |
| qa | The proof: per-criterion verdicts from executed output; browser evidence against the signed design for surface criteria. | Is each criterion discharged by executed output? | Prior manifest's tests still pass |
| release | The provenance manifest committed into the product repo with a vendored verifier: criteria → tests → commits → work items → design → stories → requirements → contract → PRD, plus verdicts, advisories, deferrals, drift, cost, argv. | — | `verify` passes in a fresh clone |

**The loop, per stage.** Writer → judge → door. Doors: **approve** (fresh, non-block verdict) · **ask** (across the seam) · **defer** · **escalate** (buy a round, reason required) · **reopen** · **stop**. No *amend* — Delivery cannot change the PRD (R5, R6).

**Stage state — one machine.** `pending → running → review → approved`; `review → blocked` when a block meets the cap; `approved → stale → rejudging → {approved | review}` when the handoff moves; any → `stopped`. The wrapper heartbeats; a running stage silent past the liveness window is `dead`, and the console says so in that word. One table, every door reads it, the eval is exhaustive over it.

## §6 Shared

What both halves stand on, and nothing else.

- **Schema** — the single home for PRD, contract, story, design, handoff, run, finding, manifest (R10).
- **Agent call** — the only place a model is invoked: model per role from one config, metering, budget check, usage-pause (R1).
- **Judge runner** — ranked, capped, scoped output; verdict derivation; hash-pinned freshness (R7).
- **Prompts** — two halves per agent. *Identity* is authored: role, craft floor, declared standard, what is not a finding. *Mechanics* are generated from schema, rule registry, and run config: output contract, k, severity, rulings, MVP line. One authoring surface; no `_shared.md` (R10). v1 was ~1:1 expertise-to-process; the defect was three surfaces, not the ratio.
- **Console** — six views: setup · workshop · discovery board (artifacts, reviews, doors, staleness, cost) · export · delivery run (state, liveness, cost, round n of cap, findings, funnel) · release. Anything else is cut.
- **Evals, ten** — `transition-table` (R9) · `economics` (R1, R6, R7) · `seam` (R14) · `scope` (R2) · `rulings` (R3) · `amendment-audit` (R4) · `rejudge` (R5) · `funnel` (R8, R13) · `coherence` (R10; absorbs v1's prompts, schema-coverage, module-graph) · `provenance` (R11; the manifest verifier). Temp roots and seeded fixtures only (R15).

## §7 Transfer

What crosses from v1 as code, as lessons, what is rebuilt, what stays. The checklist is `PORT.md`.

**Port as code — leaf, proven**

- `tools/hash.mjs` — chain and pins
- `tools/run.mjs` door table + `flagsAfterStart` — seed of the transition table
- `tools/judges.mjs` — `deriveVerdict`, `verdictFreshness`, `renderFindingsForAgent`
- `tools/stage.mjs` + `tools/usage.mjs` — the agent-call chokepoint
- `tools/provenance.mjs` + verifier; `tools/containment.mjs`; `tests/browser`
- Prompts — Discovery: `prototype`, `uxd-*`; Delivery: `sdd-*`, `dev`, `acceptance-oracle`; identity halves only, re-cut to §6 — `dev` gets the largest upgrade
- `lib/workshop.ts` — grows shape and the MVP line
- Evals `coherence`, `provenance`, `door-table`, `module-graph`

**Redesign**

- The story judge → a reviewer at the PM's bar (R13)
- Intake: diff, compile, slice, ask — new
- The state machine and liveness (R9)
- Amend with blast radius (R4); answers that write criteria (R3)
- Staleness as re-judge (R5); ranked judges (R7)
- Setup with estimate, both halves; Jira export — new

**Stays behind**

- Lazy reconcile and every raw reader of run state
- The contract stage; tickets as a stage; the prototype as a chain link
- At least 19 of 29 eval suites; drift rules that duplicate a judge
- The answers ledger as a rail separate from the contract
- v1 itself — archived read-only with its ledger and the paused bakehouse run: the evidence corpus

## §8 Budgets on the build

The pipeline's disease was a loop with no cost function. The rebuild gets one.

- **Four Discovery artifacts, four Delivery stages, ten evals.**
- **Every module carries a one-line `owns:` header** — its rule and its half (`discovery | delivery | shared`). A module without one fails CI.
- **Scaffolding-to-prompt ratio reported in CI.** v1 ended at 33 : 1. A trend, not a gate.
- **Every gate added after M2 states its cost per run and what it displaces.**
- **No instance fixes mid-run.** A defect gets a rule or a catalog line; a second instance of a ruled class is a regression in the rule.
- **This document stays under 3,500 words.** Draft 1 set 3,000 for one pipeline; the split added a stage table and the seam. Raised once; not again.

## §9 Milestones

Done-bars, not phases. Every bar is a claim about the pipeline; Bakehouse only exercises it. Discovery ships first — the original intent.

- **M0 · Spec approved; repo seeded.** SPEC.md with the rules as R-numbers; §7 as the port checklist; three directories and the import rule on day one.
- **M1 · Discovery produces a backlog a team could take today** *(the original intent)*. Workshop → PRD → prototype → stories → design → Jira export and a handoff snapshot, with cost shown per artifact and per run and the model chosen per role. Test case: Bakehouse.
- **M2 · Delivery core on fixtures.** State machine, doors, cap, re-judge, metering; a cold intake from a handoff in a temp root with Discovery absent, drift reported against a seeded edit. Judges stubbed — no model calls.
- **M3 · Delivery ships a product that carries its proof** *(the exhibit)*. From the M1 handoff: ≤ 2 rounds per stage on average, ≤ 3 hours of compute, a product matching the signed design, the manifest verified in a fresh clone, cost known, zero Delivery-origin amendments or each a logged gate-miss. k, cap, liveness calibrated here. Test case: the Bakehouse MVP.
- **M4 · The pipeline runs against its own output.** A delta PRD against the M3 manifest; prior criteria pass as regression; the manifest extends. Test case: one deferred Bakehouse surface.
- **M5 · Forge builds Forge.** One v2 feature through both halves. Optional, if M4 is clean.
- **M6 · Public.** On the user's explicit word, at that moment.

## §10 Decisions

Taken 2026-09-04 with M0 approval; each is the draft's recommendation.

1. Names: **Discovery** and **Delivery** — the PM's own vocabulary, and the first is what Jira calls it. The repo is `forge`; v1 keeps its Dev-Team name as the archive.
2. Prototype fidelity: clickable and deliberately rough — it exists to change the PRD, and polish invites the PM to sign a concept as if it were the design.
3. Design sign-off: the AI judge plus a named human designer — the human is the taste gate v1 lacked when it shipped a wireframe.
4. Default models per role: v1's until M1 and M3 calibrate; a cheaper Discovery reviewer is the first experiment worth measuring.
5. Starting values: k = 5, cap 2 / ceiling 3, liveness window 5 minutes, intake question budget 2 per story. Revisited at M3 with the funnel data.
6. Writers declare their own standard and are judged against it plus a craft floor — v1's uxd pattern, never executed. Trialled on the design stage at M1 first.

---

evidence: Dev-Team PRs #1–#45, audit-ledger rows 1–29, task #19 P1–P10, runs/bakehouse-run-sheet
