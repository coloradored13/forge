# DH1a.1: questions, agreement and the ruling guard — evidence

Branch `discovery/dh1a-1`, stacked on PR #58's head `81d7316`, which is the baseline for every count below. No live model calls; every model invocation is `scripted()`.

## Scope and estimates

On 2026-10-08 the owner split DH1a into two PRs and agreed these estimates before work started:

- **DH1a.1 (this PR):** D01's blocking-question gate, D02's ruled-criterion guard, and the PM's agreement before stories.
- **DH1a.2 (next):** the prototype reaction → proposed change → approval → refreshed prototype → agreement → stories journey (D03), and changes invalidating agreement and outputs (D05). Estimated at about 200 implementation and 220 eval lines, 1–2 sessions.

| DH1a.1 | Estimate | Stop above (1.5×) | Actual |
|---|---|---|---|
| Sessions | 1 | — | 2 (the build, then the review fixes) |
| Net implementation lines (`discovery/`, `shared/`, schemas included) | 180 | 270 | +164 (+209 / −45) |
| Net eval lines (`evals/`) | 200 | 300 | +230 (+241 / −11) |

Lines are nonblank lines in `git diff 81d7316`, additions and deletions reported separately. The first build (`d32fa8a`) was +158 and +187; the review fixes below added +6 and +43. Documentation is counted apart: SPEC.md changed two lines; `docs/` gained this file and the plan's edits.

## What changed

- **Prototype questions are runner-owned.** Each carries an `id` (`PQ-n`), a `status` (`open` or `answered`) and, once answered, its `ruling`. `generate()` mints them (`questionsOf`): a question a ruling settled stays answered whatever the builder says; the same question keeps its id from build to build; a new question takes the number after the highest ever issued, which the record keeps as `questions_issued`. A blocker stays one until the PM answers it: a rebuild that asks it as non-blocking, or no longer asks it, does not settle it. The model's contract is unchanged, because `x-runner` fields are stripped at any depth.
- **The answer door takes a prototype question** (`pq`). The ruling records it, the prototype marks the question answered by that ruling, and both records are validated before either is written.
- **A new `agree` door.** Attributed; refused without a prototype, or with one built from an older PRD. It records `AGR-n` with the PRD version and hash and the prototype hash, in the PRD's new runner-owned `agreements` list.
- **Stories wait on both.** `write()` is refused before any model call while a blocking prototype question is unanswered — the message names each question and the next action — then without a current agreement (`no-agreement`), or when the record has moved past it (`agreement-stale`, naming the rulings and amendments since, or that the prototype was rebuilt).
- **Extraction cannot take a ruling back** (the ruled-criterion guard, R3). It runs before the bare-id check. Removing a ruled criterion is refused by name. Rewording one keeps the PM's words and holds the new ones as a proposal minted through the amend door, with origin `workshop`, so R4's audit runs at mint. Unruled content still applies — the owner's D02 decision.
- `propose()` is split into `propose()` and `mint()`, so extraction proposals go through the same audited code.
- **Approval supersedes a ruling.** An approved amendment that changes a ruled criterion marks the ruling `superseded_by` it; the ruling stays as history, and `rulingsOf()` tells agents what the criterion reads now.
- **A judge cannot re-raise an answered prototype question.** `rulingsOf()` carries a ruling's `pq`, and `splitReraised()` treats a finding whose subject is that question as a re-raise, as it already did for the ruling and its PRD question. A finding about the criterion the ruling became still stands.
- **Records.** The doors header is corrected. R3's enforcer reads "the answer door · the ruled-criterion guard" in both `shared/rules.json` and SPEC.md, and SPEC §4's pipeline notes the agreement.
- **Console, minimal.** The board gains an Agree form and a prototype-question choice on the answer form, so "Write stories" is not a dead end before DH1b's plain-language controls.

## Tests

Tests came first: commit `f3bfb58` added the new suite and the `discovery-loop` edits before any implementation. On DH0's code, `discovery-decisions` was 1/16 and `discovery-loop` 4/11; every failure was an assertion, and both suites reached `done()`. The one early pass guards a wrong fix (a builder that hands back its own question ids). One check was added after implementation, during the mutation check below: a rebuilt prototype voids the agreement. It is the only check that rejects "the agreement ignores the prototype".

| Suite | DH0 (`81d7316`) | This branch |
|---|---|---|
| `discovery-loop` | 7/11, red by design | 11/11 |
| `discovery-decisions` (new) | — | 22/22 |
| `rulings` | 31/31 | 33/33 |
| `amendment-audit` | 51/51 | 52/52 |
| `funnel` | 70/70 | 70/70 |
| `npm run evals` | 15/16 suites | 17/17 suites |

With the review fixes, all 17 suites pass, `coherence` 202/202. A first local run stopped `coherence` at its console checks because the machine could not open a local socket (`EADDRNOTAVAIL`, a macOS fault outside the change); after a restart it passed in full.

Test edits, old → new:

- `discovery-loop`, D01 setup: no agreement → both runs record the PM's agreement after `generate()`; `blocking` stays the only difference between them.
- `discovery-loop`, D01 refusal: `no-line` and `no-prototype` did not count → `no-agreement` and `agreement-stale` do not count either. Tightened.
- `discovery-loop`, D02 violating runs: a refusal naming the criterion → a refusal naming it that also leaves `prd.json` byte-identical. Tightened.
- `funnel`: the prototype was seeded before the OQ-1 ruling and stories written without agreement → seeded after the ruling and agreed, then re-seeded and agreed again after the OQ-2 ruling. A new prerequisite; no assertion changed.
- `amendment-audit`: 51 → 52 checks. Its forbidden-target loop derives one more from the schema, `/agreements`.
- `rulings`: two checks mirror the guard in R3's own eval.

**Mutation check.** Eighteen plausible wrong versions of this code were each run against `discovery-decisions`, `discovery-loop`, `rulings`, `funnel`, `amendment-audit` and `coherence`. Every one was rejected by an assertion:

- stories: an answered question still blocks; only the first question is read; no agreement gate; any agreement ever made counts; the refusal names no question;
- record: the agreement ignores the prototype; a superseded ruling rides in unchanged;
- doors: `agree` accepts a stale prototype, or needs no name; answering a PQ leaves it open; a ruled rewording is dropped silently, minted as the PM's, or applied as well as proposed; removing a ruled criterion is allowed; approval does not supersede the ruling;
- prototype: a rebuild forgets what a ruling settled; new ids ignore the ids rulings name;
- workshop: the guard runs after the bare-id check.

## Review round 1 (ChatGPT, 2026-10-09, at `d32fa8a`)

Three findings. Each was reproduced independently with scripted builds on Node 22 before anything was fixed.

1. **P1: a rebuild could clear an unanswered blocker.** `questionsOf` took the builder's latest questions, and their `blocking` flags, at face value. Building with a blocking question and then rebuilding with no questions, or with the same question marked non-blocking, let `agree` and `write` run the writer and save stories with no ruling. D01 was bypassed without the PM. Fixed: an unanswered blocker stays on the record, still blocking, until a ruling settles it, by its id or by its wording.
2. **P2: a PQ id could be issued twice.** The next id was counted from the previous build only. Builds `[A, B] → [A] → [A, C]` gave C the PQ-2 that B had held, so a stale `answer({ pq: "PQ-2" })` meant for B recorded the PM's answer against C. This also made this document's earlier claim false: it said a new question takes an id no build and no ruling has used. Fixed: the record keeps `questions_issued`, the highest number issued, and a new question takes the next.
3. **P2: a judge could re-raise an answered prototype question.** `rulingsOf()` dropped `pq`, and `splitReraised()` matched only ruling ids and PRD questions, so a finding about an answered PQ was kept and could block. Fixed as described under "What changed".

Test edits, old → new: `discovery-decisions` goes from 17 to 22 checks, and no existing assertion changed. The new checks:

- a judge finding about PQ-2 is a re-raise, while one about REQ-1/AC-3 that cites PQ-2 stands;
- the three-build id sequence, with the stale answer refused and both records byte-identical;
- a rebuild that drops a blocker leaves stories refused, naming it;
- so does a rebuild that downgrades it;
- a control: a blocker the rebuild kept is settled by an answer given by its wording, and stories then run.

Tests came first (`a424fe5`): on `d32fa8a` the suite was 18/22, with the four regressions failing by assertion and the control passing.

The mutation check was rerun on the 18 earlier wrong versions plus nine new ones:

- a rebuild drops a blocker, or downgrades it;
- a kept blocker ignores a ruling given by its wording;
- every unasked blocker is kept, settled or not;
- the high-water mark is not read back, or never saved;
- `rulingsOf()` drops `pq`;
- `splitReraised()` ignores `pq`, or matches it anywhere in a finding's text.

26 of the 27 are rejected by an assertion. The earlier "new ids ignore the ids rulings name" now survives: the high-water mark gives the same ids in every state the tests reach. The two differ only if `prototype.json` is deleted by hand, so the term stays as a guard for that case. `coherence` was left out of this run: this machine's ephemeral ports were exhausted (`EADDRNOTAVAIL`), so its console checks could not open a local socket and would have failed every mutant for that reason.

## Review round 2 (ChatGPT, 2026-10-14, at `90c7b52`)

ChatGPT retested the head independently and confirmed all three fixes, including the variant where B is a blocker: it is kept, and `PQ-2` still answers it. It answered the packet questions the first round left open:

- **Q2 holds for sequential extraction but fails as an unqualified claim.** An extraction that reads the PRD, waits on the model, and saves after an answer has landed overwrites that answer. Claude reproduced this on this branch and on `81d7316`: after the answer the PRD was at v0.2.0 with RUL-1 and REQ-1/AC-3; after the delayed extraction it was back at v0.1.0, with no ruling and no AC-3. The defect predates DH1a.1. The ruled-criterion guard compares the extraction with the PRD it read, so it cannot see a ruling made after that read. See Known limits.
- **Q4 holds.** No existing assertion was loosened.
- **Q5 holds as acceptance wording.** It does not show that containment exists; that is DH1b's work.

## Known limits

- Questions are matched by normalized wording. A builder that rewords a settled question raises a new open one; DH2's decision view is where that belongs. The same applies to a kept blocker: reworded, it is asked twice.
- **A blocker settled outside the answer door stays open.** Only a ruling settles a prototype question. If the PM settles it another way, through an approved amendment or through the workshop and an extraction, it blocks until it is answered through the door, and that answer adds a criterion that may restate one already there. DH1a.2's D03 journey settles a reaction through an amendment, so its approval must settle the question it answers. It should name that question on the record, and it should not infer settlement from similar wording (agreed with ChatGPT in review round 2).
- **No retire or downgrade.** For now the PM settles a blocker only by answering it. Retiring a question, or delegating it, belongs to DH2, which gives each question an owner, scope and readiness impact and holds delegation to D06's conditions.
- The `ids-dropped` check still compares bare ids for unruled content. That is pre-existing; ruled criteria are now covered by the guard.
- **A late extraction can overwrite a ruling (D09).** Extraction saves its result over the PRD it read at the start. An answer, approval or agreement that lands while the model is working is lost: the ruling, its criterion and the version bump all go. This predates DH1a.1. The plan puts concurrent writes in DH4, and on 2026-10-14 the owner moved a basic guard to the start of DH1a.2: extraction refuses to save over a PRD that changed after it read it. Until that lands, the ruled-criterion guard protects ruled criteria only when actions run one after another.
- Answering a prototype question writes the PRD, then the prototype record. A crash between the two writes is DH4's interrupted-persistence case.
- The console controls are minimal; DH1b replaces them.
- SPEC.md is at 3,499 of its 3,500-word budget, so DH1a.2 can only add claims by tightening others.
