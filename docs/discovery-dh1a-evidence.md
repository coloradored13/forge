# DH1a.1: questions, agreement and the ruling guard — evidence

Branch `discovery/dh1a-1`, stacked on PR #58's head `81d7316`, which is the baseline for every count below. No live model calls; every model invocation is `scripted()`.

## Scope and estimates

On 2026-10-08 the owner split DH1a into two PRs and agreed these estimates before work started:

- **DH1a.1 (this PR):** D01's blocking-question gate, D02's ruled-criterion guard, and the PM's agreement before stories.
- **DH1a.2 (next):** the prototype reaction → proposed change → approval → refreshed prototype → agreement → stories journey (D03), and changes invalidating agreement and outputs (D05). Estimated at about 200 implementation and 220 eval lines, 1–2 sessions.

| DH1a.1 | Estimate | Stop above (1.5×) | Actual |
|---|---|---|---|
| Sessions | 1 | — | 1 |
| Net implementation lines (`discovery/`, `shared/`, schemas included) | 180 | 270 | +158 (+202 / −44) |
| Net eval lines (`evals/`) | 200 | 300 | +187 (+198 / −11) |

Lines are nonblank lines in `git diff 81d7316`, additions and deletions reported separately. Documentation is counted apart: SPEC.md changed two lines; `docs/` gained this file and the plan's edits.

## What changed

- **Prototype questions are runner-owned.** Each carries an `id` (`PQ-n`), a `status` (`open` or `answered`) and, once answered, its `ruling`. `generate()` mints them (`questionsOf`): a question a ruling settled stays answered whatever the builder says; the same question keeps its id across rebuilds; a new question takes an id no build and no ruling has used. The model's contract is unchanged, because `x-runner` fields are stripped at any depth.
- **The answer door takes a prototype question** (`pq`). The ruling records it, the prototype marks the question answered by that ruling, and both records are validated before either is written.
- **A new `agree` door.** Attributed; refused without a prototype, or with one built from an older PRD. It records `AGR-n` with the PRD version and hash and the prototype hash, in the PRD's new runner-owned `agreements` list.
- **Stories wait on both.** `write()` is refused before any model call while a blocking prototype question is unanswered — the message names each question and the next action — then without a current agreement (`no-agreement`), or when the record has moved past it (`agreement-stale`, naming the rulings and amendments since, or that the prototype was rebuilt).
- **Extraction cannot take a ruling back** (the ruled-criterion guard, R3). It runs before the bare-id check. Removing a ruled criterion is refused by name. Rewording one keeps the PM's words and holds the new ones as a proposal minted through the amend door, with origin `workshop`, so R4's audit runs at mint. Unruled content still applies — the owner's D02 decision.
- `propose()` is split into `propose()` and `mint()`, so extraction proposals go through the same audited code.
- **Approval supersedes a ruling.** An approved amendment that changes a ruled criterion marks the ruling `superseded_by` it; the ruling stays as history, and `rulingsOf()` tells agents what the criterion reads now.
- **Records.** The doors header is corrected. R3's enforcer reads "the answer door · the ruled-criterion guard" in both `shared/rules.json` and SPEC.md, and SPEC §4's pipeline notes the agreement.
- **Console, minimal.** The board gains an Agree form and a prototype-question choice on the answer form, so "Write stories" is not a dead end before DH1b's plain-language controls.

## Tests

Tests came first: commit `f3bfb58` added the new suite and the `discovery-loop` edits before any implementation. On DH0's code, `discovery-decisions` was 1/16 and `discovery-loop` 4/11; every failure was an assertion, and both suites reached `done()`. The one early pass guards a wrong fix (a builder that hands back its own question ids). One check was added after implementation, during the mutation check below: a rebuilt prototype voids the agreement. It is the only check that rejects "the agreement ignores the prototype".

| Suite | DH0 (`81d7316`) | This branch |
|---|---|---|
| `discovery-loop` | 7/11, red by design | 11/11 |
| `discovery-decisions` (new) | — | 17/17 |
| `rulings` | 31/31 | 33/33 |
| `amendment-audit` | 51/51 | 52/52 |
| `funnel` | 70/70 | 70/70 |
| `npm run evals` | 15/16 suites | 17/17 suites |

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

## Known limits

- Questions are matched by normalized wording. A builder that rewords a settled question raises a new open one; DH2's decision view is where that belongs.
- The `ids-dropped` check still compares bare ids for unruled content. That is pre-existing; ruled criteria are now covered by the guard.
- Answering a prototype question writes the PRD, then the prototype record. A crash between the two writes is DH4's interrupted-persistence case.
- The console controls are minimal; DH1b replaces them.
- SPEC.md is at 3,499 of its 3,500-word budget, so DH1a.2 can only add claims by tightening others.
