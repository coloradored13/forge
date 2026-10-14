# DH1a.2 design: a reaction becomes an approved change, and stale work cannot be handed off

Status: for ChatGPT's review, as PR 1 of DH1a.2, before any tests or code. Base: `main` at `e752411` (DH0 and DH1a.1 merged). Revision 2: three independent critics and a verifier checked revision 1 against the code; their confirmed findings are folded in below.

**Scope.** The extraction guard the owner moved here, D03 at the level of domain functions, and D05. The browser run of D03 is DH1b's.

**Who does what.** ChatGPT writes the tests from this design and the acceptance text. That includes the edits to existing suites listed in §7. Claude commits them unchanged, shows them failing on `main`, runs deliberately wrong versions of the code against them, and only then implements.

**Delivery as small PRs** (owner, 2026-10-14). Each PR branches from `main` after the one before it merges, and its tests come first.

| PR | Contents |
|---|---|
| 1 | This design, docs only |
| 2 | The guard (§1) |
| 3 | D05 readiness and the history copy (§5), with the §7 suite refits and the SPEC wording |
| 4 | Reactions (§2), including the pending-reaction hold |
| 5 | Approval settles the linked question (§3), and the D03 journey suite (§4) |

Each PR's lines count toward this milestone's estimate.

**Estimate (agreed by the owner, 2026-10-14).** About 225 implementation lines and 300 test lines over 2 sessions. The stop is above 1.5×: about 338 and 450.
- **Implementation:** guard ~15, react ~60, editor prompt ~15, reaction schema ~20, PRD schema additions ~20, approval settlement ~25, readiness ~30, history ~10, stories' pending-reaction check ~5, turn re-apply ~5.
- **Tests:** new cases ~250, plus ~45 lines of edits to existing suites (§7).
- The agreed estimate was ~200 / ~220. The increase is the guard, D05's suite refits, and the history copy.

## 1. The guard: a late write cannot replace a PRD that moved

- **`prdStamp(root)`** is exported beside `savePrd` and returns the sha256 of `prd.json`'s bytes.
- **`savePrd(root, prd, { base })`.** When `base` is given and the file no longer matches it, the save throws the shared `Refused` with code `prd-changed`. The check runs before stamping and validation, and the file stays byte-identical. `base` is optional, and the synchronous doors pass nothing. The code is distinct from approve's existing `prd-moved`.
- **`extract()` refuses.** Its result is built from the PRD it read, so it cannot be merged.
- **`react()` refuses (§2).** Its refusal's detail carries `{ text, pq }`, so the console can offer the PM's words again.
- **`turn()` re-applies.** After the model returns it re-reads the PRD, then:
  - sets `sections[key].session_id` and `status`;
  - increments `sections[key].turns` from the fresh value;
  - appends the kill flag if one was signalled.

  Two concurrent turns on one section stay with D09.
- **Not covered (known limits, D09 in DH4):** the export's tracker path, and a late prototype build overwriting newer prototype state.

## 2. Reactions (D03)

The PM reacts in plain language to the prototype they are looking at. A specification editor turns the reaction into at most one proposed change. The accepted record changes only on approval.

**`react({ root, by, text, pq, seen, onEvent, _query, _sleep, _now })`** lives in `discovery/doors` and makes one model call. `seen` is `{ prd_hash, prototype_hash }`: the revision the PM was viewing.

**Refusals before the call.** None writes anything, and every one carries `{ text, pq }` in its detail:

| Code | When |
|---|---|
| `no-author` | no `by` |
| `no-text` | no reaction text |
| `no-prototype` | there is no prototype |
| `prototype-stale` | the prototype was built from an older PRD |
| `revision-moved` | `seen` no longer matches the current PRD and prototype |
| `unknown-question` | `pq` is given but the prototype doesn't ask it |
| `already-ruled` | `pq` is given but no longer open |

**The editor call.**
- Role `discovery.writer`, kind `extract` (no tools), stage `reaction`.
- `mechanics()` passes the rulings and the scope, as every writer gets.
- The prompt holds `renderPrd`, the prototype's screens and notes, the PQ if one is given, and the PM's text. It contains no instruction to read files.
- **Output contract:** a new `shared/schema/reaction.schema.json`, `{ change, rationale, note }`. `change` is `null`, `{ criterion: "REQ-n/AC-m", statement }` to reword a criterion, or `{ requirement: "REQ-n", statement }` to add one. The editor names criteria by join id, and the runner builds the JSON pointer.

**After the call.** Each refusal below leaves `prd.json` byte-identical, files no audit, and carries `{ text, pq }`:

| Code | When |
|---|---|
| `no-structured-output` | the editor returned no output |
| `reaction-invalid` | the output doesn't fit the contract, or names a criterion or requirement that doesn't exist or sits past the line |
| mint's own codes | passed through unchanged |
| `prd-changed` | the guard fired |

**The proposal.**
- **For a reword,** the runner mints `/requirements/i/acceptance_criteria/j/statement`.
- **For an addition,** it mints `/requirements/i/acceptance_criteria/-`, with `{ id, statement }` and an id the runner assigns as the next `AC-n` on that requirement.
- **Minted through `mint()`** with `by: "editor"`, `origin: "reaction"`, `reaction: "RX-n"`, and `pq` when one was given.
- **Order:** the PRD is saved with the guard's `base` first, and the audit is filed after it, as `extract` does.

**The reaction record.** It lives in the PRD's runner-owned `reactions` list: `{ id, by, at, text, pq?, seen, proposal: AMD-n | null, screens, note }`. `screens` lists the prototype screens that show the targeted requirement. Together with the proposal's from/to and radius, this is the "affected behavior" D03 asks for.

**Nothing accepted changes before approval.** Requirements, content hash, version and the current agreement all stay as they were, because amendments and reactions are outside the hash.

**A pending reaction holds the backlog.** While a reaction's proposal is still proposed:
- `write()` refuses `reaction-pending`, naming the reaction and its amendment, before any call;
- readiness reports the same finding.

The PM's objection cannot be bypassed by writing stories on the old meaning.

**`change: null`** means the editor judged the reaction to be about presentation, not product meaning. The reaction is recorded with the editor's note, and nothing is minted.

## 3. Approval settles the linked question, by reference only

`approve()` keeps its signature. Supersession runs first, as it does today, over the rulings that existed before this approval. Then, if all of the following hold, approval appends one ruling:
- the amendment has a `pq`;
- its target is one of the two shapes in §2;
- that PQ is still open.

**The ruling.** `{ id: RUL-n, pq, question: the PQ's text, answer: the reaction's text, criterion: REQ-n/AC-m (the edited or added criterion), by: the approver, at, version, prd_hash, amendment: AMD-n }`. It adds no criterion, and it is never superseded by its own amendment.

**On the prototype record,** the PQ is marked answered by that ruling, and both records are validated before either is written, as `answer` does.

**What settles a question.** In approval, only the `pq` named on the amendment. The rebuild's existing rule, a ruling whose question matches the PQ's wording, is unchanged.

**What doesn't.** A rejected proposal changes no requirement, hash, version or agreement, and leaves the PQ open and blocking. The PRD's bytes still change, because `reject` records the decision.

**What doesn't get protected.** An approved reaction without a `pq` creates no ruling, so the criterion it set is not protected from later extraction. This is the same as any other PM-approved amendment under the owner's D02 decision, and it is recorded as a limit.

**Schema and records:**
- amendments gain `reaction` and `pq`, and `origin` gains `"reaction"`;
- rulings gain `amendment`, which `rulingsOf()` does not carry;
- the PRD gains `reactions`;
- the rulings description changes from "written by the answer door" to also cover approval;
- R3's enforcer, in `rules.json` and SPEC, gains the approve door, word-neutrally.

## 4. The D03 journey

**The fixture.** Move the bookings setup, `project()` and `cancel()`, from `evals/discovery-loop.mjs` into `evals/_fixture.mjs` with no change of behavior, and give the journey its own suite. A scripted build asks the blocking PQ "Can a member cancel a booking after pickup?". The cancellation requirement starts with only "Cancellation releases the reservation.", so the D03 decision is an addition.

**Steps:**
1. **React** with `pq` and `seen`. One proposal is minted with `origin: "reaction"`. The requirements, hash, version and current agreement are unchanged, and `write()` is refused `reaction-pending` with zero calls.
2. **Approve.** The criterion is added with a runner-assigned id, the version bumps, and RUL-n records `pq`, the PQ's text, the new criterion and `amendment`. The PQ is answered on the prototype record, and the agreement is now stale.
3. **Regenerate the prototype, agree, and write the stories.**
   - The builder's and the writer's prompts contain the new statement, and their system prompts contain RUL-n.
   - `stories.traces.prd.content_hash` equals the post-approval hash.
   - The backlog proves the new criterion.
4. **Export.** It is refused before the rewrite and allowed after it. The contract carries the criterion text and the ruling.
5. **The rejected path.** `reject` changes no requirement, hash or agreement. The PQ still blocks stories.
6. **An unrelated ruling**, seeded before step 1, is byte-for-byte unchanged and not superseded at the end.

## 5. Invalidation and readiness (D05)

`readinessOf()` gains findings. Each is high and certain, and its remedy names the next step:

| Finding | Subject | When | Remedy | Blocks |
|---|---|---|---|---|
| `no-agreement` / `agreement-stale` | `prd.id` | a prototype exists and no agreement covers this PRD and prototype | rebuild the prototype if it traces an older PRD, then agree | every exit |
| `stories-stale` | `stories.id` | the stories trace another PRD or prototype | write the stories again under the current agreement | every exit |
| `reaction-pending` | `prd.id` | a reaction's proposal is undecided | approve or reject it | every exit |
| `design-stale` | `design.id` | the design traces other stories, prototype or PRD | regenerate the design | only `delivery` and `both`; a team takes the design as it stands |

- **Which agreement finding.** It uses the same rule as `write()`: `no-agreement` when none was ever recorded, otherwise `agreement-stale`. The one check is shared between the two.
- **Staleness compares content hashes only.** Matching ids or labels never make an artifact current.
- **History.** Before `generate`, `write` or the design writer overwrites its record, the outgoing JSON (and the prototype HTML) is copied to `discovery/history/<kind>-<first 12 of content_hash>.json`. After a D05 refresh, the old stories are still readable there. *(Owner decision, 2026-10-14: a history copy, rather than narrowing the clause to exported handoffs.)*
- **SPEC (owner decision, 2026-10-14):** "staleness | a badge and a diff; the PM decides" is reworded word-neutrally to say that a stale agreement or backlog blocks export. The record module's "never enforced" comment changes to match.

## 6. Not in DH1a.2

- Console and browser controls, and D13 containment: DH1b.
- The rest of D09, including the export tracker path, a late prototype build, duplicate requests and interrupted writes: DH4.
- Retiring or delegating questions: DH2.
- Protecting approved changes that settle no question.

## 7. For the test author

**Edits to existing suites.** Each is listed old → new in the tests-first commit, and none loosens an assertion:
- **`_fixture.mjs`:** `seedDelivery` records an agreement after seeding the prototype. A `refresh()` helper rebuilds, agrees, rewrites the design, reviews and signs off. The bookings setup moves here.
- **seam, rejudge, transition-table, coherence:** each re-export after a PRD move calls `refresh()` first. The verifier found 8 suites affected before the narrowing; it put the remaining cost at about 40–45 lines.
- **Derived counts:**
  - `amendment-audit` goes from 52 to 53, for the new runner-owned field;
  - `coherence` goes from 202 to the count after `reaction.schema.json`;
  - `discovery-loop` keeps 11 checks, losing only its moved helpers.

**Wrong fixes the tests should reject:**
- the guard compares only the version, which misses an agreement;
- `turn` refuses instead of re-applying, or loses the PM's turn state;
- a PQ is settled by an amendment without `pq`, by a rejected one, or by one with another target shape;
- an added criterion keeps a model-supplied or duplicate id;
- the ruling points at the old criterion;
- `react` runs the model before refusing;
- a refusal after the call leaves an audit file or changes `prd.json`;
- stories are written while a reaction is pending;
- readiness ignores the prototype hash, accepts unchanged ids as current, or blocks the team exit on a stale design;
- a refresh destroys the old stories.

**How to land a write in the middle of a call:** wrap `_query`, so it pauses after the step has read the PRD (the pattern at `_fixture.mjs:274`).

**Assert on what is saved:** file bytes, refusal codes and classes (`Refused`), `scripted().calls` counts, and prompt contents. Each case has a run the gate refuses and one it allows.

## 8. Notes for writing the tests

- **Reach new APIs through a namespace import** (`import * as doors`), and check that a function exists before calling it. Then the tests-first run on `main` fails by assertion rather than at load time, and every suite still reaches `done()`.
- **Declare each suite's count explicitly** with `suite(name, n)`.
- **Use `scripted()` for every model call.** No live calls.
- **Deliver each PR's tests on that PR,** as a commit or as a comment with the files. Claude commits them unchanged as the tests-first commit and reports which checks fail on `main`, and why. The §7 refits belong to PR 3, the D05 change that forces them.

## 9. Choices to challenge

1. At most one proposal per reaction.
2. Reactions name criteria by join id, and the runner builds pointers and assigns ids.
3. A pending reaction holds stories and export.
4. Approval writes a ruling only when a question is linked.
5. Design staleness blocks only the Delivery exits.
6. A history copy on overwrite (owner-decided).
7. The guard refuses for extract and react, and re-applies for turn.
