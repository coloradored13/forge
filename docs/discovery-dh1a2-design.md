# DH1a.2 design: a reaction becomes an approved change, and stale work cannot be handed off

Status: for ChatGPT's review, as PR 1 of DH1a.2, before any tests or code. Base: `main` at `e752411` (DH0 and DH1a.1 merged). Revision 3. Three independent critics and a verifier checked revision 1 against the code, and their confirmed findings went into revision 2. Revision 3 answers ChatGPT's review of revision 2 on PR #60.

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
- **Actual after the guard and D05 (2026-10-16).** Net nonblank lines, the plan's counting basis, with gross additions and SPEC reported separately:
  - Implementation: the guard (#62) +17 net (+27 / −10); D05 (#66) +71 net (+111 / −40). **Total +88 of ~225.**
  - Tests: the guard (#61) +162 net; D05 (#65) +264 net (+299 / −35, including 19 lines of unchanged helper moves). **Total +426 of ~300 (142%), under the 1.5× line of 450.** Gross additions are 461.
  - SPEC: one row reworded word-neutrally (+1 / −1). It is documentation, not implementation.
  - The tests grew from the §7 refits, from tightening after deliberately wrong versions got through, and from the review findings D05 took on: the archived pair on a failed build, the stale marker in the team rendering, and Delivery's intake (owner, 2026-10-16). PRs 4 and 5 are re-estimated before they start.

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
| `reaction-pending` | an earlier reaction's proposal is still proposed: one at a time (owner, 2026-10-16) |

**The editor call.**
- Role `discovery.writer`, kind `extract` (no tools), stage `reaction`.
- `mechanics()` passes the rulings and the scope, as every writer gets.
- The prompt holds `renderPrd`, the prototype's screens and notes, the PQ if one is given, and the PM's text. It contains no instruction to read files.
- **Output contract:** a new `shared/schema/reaction.schema.json`, `{ change, rationale, note }`. `change` is `null`, `{ criterion: "REQ-n/AC-m", statement }` to reword a criterion, or `{ requirement: "REQ-n", statement }` to add one. The editor names criteria by join id, and the runner builds the JSON pointer. The schema's shape is settled in "4b decisions" below: one nullable `change` object rather than a `oneOf`.

**After the call.** Each refusal below leaves `prd.json` byte-identical, files no audit, and carries `{ text, pq }`:

| Code | When |
|---|---|
| `no-structured-output` | the editor returned no output |
| `reaction-invalid` | the output doesn't fit the contract, or names a criterion or requirement that doesn't exist or sits past the line |
| mint's own codes | passed through unchanged |
| `prd-changed` | the guard fired |
| `revision-moved` | the prototype record's bytes no longer match what `react` read before the call. This covers a rebuild, and an answer to the linked PQ, made while the editor was working. It includes a rebuild that changed only notes or questions, which leaves the content hash unchanged |

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

### 4b decisions (for review before tests)

Settles the re-estimate's risks and the 4a review's seventh. Line numbers are `main` at `52b7486`; "4a" marks `origin/discovery/dh1a2-pr4a`.

**Output contract.** `reaction.schema.json` makes `change` a single nullable object, not a `oneOf`.
- `change` is `type: ["object", "null"]`, `required: ["statement"]` and closed. It has three fields:
  - `criterion`, matching `^REQ-\d+/AC-\d+$`;
  - `requirement`, matching `^REQ-\d+$`;
  - `statement`, a sibling `$ref` to the PRD's criterion statement, with no local `minLength` (code refuses blanks).

  Its description says null is allowed and to name exactly one id. Mechanics prints no types, so only this description tells the editor about null.
- `rationale` and `note` are required strings with no length bounds, since the PRD fields they land in have none. The root is closed, with no `x-runner` fields.
- `fieldsOf` already walks a type array (`shared/schema/index.mjs:193`), so all six paths reach the editor: risk (1) costs zero lines. The sweep's `anyOf` plus a branch walk is rejected: it needs path merging and a cross-branch `required` rule, and it is no better proven on the wire.
- `coherence` goes from 202 to 206 (`evals/coherence.mjs:34`). A `oneOf` version also counts 206, so the count cannot prove the fields are described.
- The call is `stage: "reaction"`, `role: "writer"`, `kind: "extract"`, with identity `discovery/doors/prompts/editor.md`. Prompt: `renderPrd`, `renderPrototype(proto, { file: false })` (a new option dropping the "read it" line, record 4a:223), the linked PQ only, the PM's text.

**Before the call.** Each check throws `Refused(code, message, { text, pq })`; `reaction-pending` adds `pending`.
1. `no-author` and `no-text` run before any read, as `answer` does (doors:36-37).
2. Read the project, `prd`, `base = prdStamp(root)` (extract's order, workshop:270-272), `proto`, `stories` (`readDoc(root, STORIES_FILE)`, for the radius, as `propose` reads it at doors:222), and `protoBase` (sha256 of `prototype.json`, null if absent).
3. `no-prototype`, then `prototype-stale` (agree's test, doors:319). Stale wins over `revision-moved` because `seen` cannot fix it.
4. `reaction-pending` when `pendingReactions(prd)` is not empty (4a), with detail `{ text, pq, pending }` naming each reaction and its amendment. Conditions of the record come before conditions of the PM's input (`seen`, `pq`). One at a time because approving one proposal bumps the version, which leaves every other pending one unapprovable (`prd-moved`), and two additions to one requirement would get the same `AC-n` and pointer (`target-now-exists`, doors:279).
5. `revision-moved` compares `seen` with the two content hashes, as agreements do (doors:321), not bytes. So the PM's own agreement or earlier reaction does not void their view. A missing `seen` fails here.
6. `unknown-question`, then `already-ruled` with `answer`'s message (doors:55-57).

`no-prd`, `no-project` and `BudgetError` propagate unchanged.

**After the call.**
1. `no-structured-output`.
2. `reaction-invalid` when the contract fails, or when the editor:
   - names both ids or neither;
   - names a target that is not found (`criterionAt`) or not in `insideRequirements(prd)`;
   - gives a blank statement, or a reword identical to the current one;
   - proposes a change with a blank `rationale`. `mint` does not check this; propose does (`no-rationale`, doors:218).
3. One `_now()` stamps both records. `mint` runs in memory with `proto` and `stories` (so the radius it mints is the one `approve` recomputes, doors:282) and gains optional `reaction` and `pq`, spread as in `answer` (doors:70). React passes `by: "editor"`, `origin: "reaction"` and the trimmed statement. An addition's `-` comes back as the index with `adds: true` (doors:243-248); §2 should say so.
4. `revision-moved` if the bytes of `prototype.json` no longer match `protoBase`. Nothing is awaited before step 5.
5. Append the reaction, then `savePrd(root, prd, { base })`. A `prd-changed` is caught and re-thrown with `{ text, pq }`.
6. File the audit only if something was minted. This is extract's order (workshop:310-311), not propose's.

So when the prototype moved, the result is `revision-moved` whether or not the PRD also moved. `change: null` still runs steps 4–5.

**Returns** `{ reaction, amendment, audit, prd }`, as the other doors return their records; `amendment` and `audit` are null when `change` is null.

**Ids and screens.**
- `RX-n` and an added `AC-n` use the doors' `nextId` (doors:21): highest plus one, gaps never filled. A refused react consumes no number. A model-supplied `id` fails the closed contract.
- `screens` lists the screens whose `req_refs` include the targeted requirement, in prototype order. It is not `radius.screens`, which is empty for a reword.

**The record, and `change: null`.** `text` is kept verbatim, per 4a's schema; PR 5 trims it when it copies it into a ruling. `seen` is rebuilt from the current hashes. A null change records `proposal: null`, `screens: []` and the editor's `note`, and keeps `pq`. Nothing is minted or audited. React pushes no flags and no funnel signal.

**The PQ on react.** React never writes `prototype.json`. The PQ stays `open`, and blocking, until approval (PR 5).

**Refusal table changes (after the call).**

| Change | Row | Why |
|---|---|---|
| Drop | mint's own codes | Unreachable: react builds both pointers from indexes it validated, and `acceptance_criteria` is required. Anything `mint` throws still comes before any write |
| Reword | `reaction-invalid` | List the step 2 checks |
| Reword | `prd-changed` | Only `prd.json` moved; the detail is re-thrown |
| Reword | `revision-moved` | An answer to **any** PQ: `answer` with `pq` writes `prototype.json` (doors:80-81) |
| Not added | `no-line` | A current prototype implies a drawn line |
| Add (before the call) | `reaction-pending` | One pending reaction at a time (owner, 2026-10-16) |

**Remaining ambiguities.**
- §7's `_fixture.mjs:274` is `builder()`, and `discovery-guard.mjs:93-109` uses the same idiom. To run `generate()` mid-call, wrap it in an async generator that awaits it and then `yield*`s the script.
- "PQ no longer open" can be set up through the doors: build asking Q, call `answer({ pq })`, rebuild still asking Q, then react. Without the rebuild, the result is `prototype-stale`.
- `["object","null"]` has never been on the live wire; the first live react proves it.

**Decided by the owner (2026-10-16),** with Claude, ChatGPT and Gemini each recommending the same:
- **The amendment fields move into 4b.** `amendments.items` gains `origin: "reaction"` and optional `reaction` (`RX-n`) and `pq` (`PQ-n`); without them `savePrd` refuses every proposing reaction with `prd-invalid` (prd.schema:330, :340).
- **One pending reaction at a time.** `react` refuses `reaction-pending` before the call, as above.
- **An identical reword is refused** as `reaction-invalid` (trimmed text equal to the current statement). `answer` still settles a PQ whose criterion already reads right.
- **Journey step 4 (PR 5)** seeds a backlog before the reaction, so the export before the rewrite meets the ready gate (`not-ready` with `stories-stale`), not `no-stories`.

**Estimate.** The nullable-object contract removes risk (1) from the re-estimate (#68): 4b drops about 10–20 lines each of implementation and tests.


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
| `design-stale` | `design.id` | the design traces other stories, prototype or PRD | regenerate the design | only `delivery` and `both`; a team takes a stale design as it stands |

- **A stale design must still match, even for a team.** The design checks (`checkDesign`) still apply to every exit, as they do on `main`. So a team export whose design misses a current screen is refused with `screen-undesigned`, and the remedy is to regenerate the design. A team gives up only freshness and sign-off.
  - **Call sequence for the tests:** move the PRD without touching screens or stories' structure, then refresh the prototype, the agreement and the stories. The team export is allowed and carries the design marked stale, while `delivery` is refused `design-stale`.
  - Then add SCREEN-3 and refresh again, keeping the old design. Every exit is now refused with `screen-undesigned`.
- **Which agreement finding.** It uses the same rule as `write()`: `no-agreement` when none was ever recorded, otherwise `agreement-stale`. The one check is shared between the two.
- **Staleness compares content hashes only.** Matching ids or labels never make an artifact current.
- **History.** Before `write` or the design writer overwrites its record, the outgoing file is copied to `discovery/history/<kind>-<first 12 of the sha256 of the saved file's bytes>.json`.
  - The key is the whole file, not the content hash: the content hash leaves out traces, sign-offs and workflow state, so two different records could share one key.
  - For the prototype, the outgoing JSON and HTML are copied as a pair before the builder call, because the builder overwrites the HTML during that call.
  - Tests: after a D05 refresh, the old stories can still be read from history; two refreshes with equal content but different traces or sign-offs keep both copies; and the archived HTML matches the old record's `file_hash`. *(Owner decision, 2026-10-14: a history copy, rather than narrowing the clause to exported handoffs.)*
- **SPEC (owner decision, 2026-10-14):** "staleness | a badge and a diff; the PM decides" is reworded word-neutrally to say that a stale agreement or backlog blocks export. The record module's "never enforced" comment changes to match.

## 6. Not in DH1a.2

- Console and browser controls, and D13 containment: DH1b.
- The rest of D09, including the export tracker path, a late prototype build, duplicate requests and interrupted writes: DH4.
- Retiring or delegating questions: DH2.
- Protecting approved changes that settle no question.

## 7. For the test author

**Edits to existing suites.** Each is listed old → new in the tests-first commit, and none loosens an assertion:
- **`_fixture.mjs`:** `seedDelivery` records an agreement after seeding the prototype. A `refresh()` helper rebuilds the prototype, agrees, writes the stories again, then regenerates the design, reviews it and signs off. The bookings setup moves here.
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
- `react`'s check after the call compares only the prototype's content hash. A rebuild during the paused call that changes only notes or questions must still be refused, with the PRD bytes and the prototype content hash unchanged (from ChatGPT's review of revision 3);
- a refusal after the call leaves an audit file or changes `prd.json`;
- stories are written while a reaction is pending;
- readiness ignores the prototype hash, accepts unchanged ids as current, or blocks the team exit on a stale design;
- a refresh destroys the old stories.

**How to land a write in the middle of a call:** wrap `_query`, so it pauses after the step has read the PRD (the pattern at `_fixture.mjs:274`).

**Assert on what is saved:** file bytes, refusal codes and classes (`Refused`), `scripted().calls` counts, and prompt contents. Each case has a run the gate refuses and one it allows.

**For 4b** (from the 4b design PR; numbers refer to these cases, not to sections):

1. `fields("reaction").map(f => f.path)` is exactly `/change`, `/change/criterion`, `/change/requirement`, `/change/statement`, `/rationale`, `/note`. Guard it with `names().includes("reaction") &&` so `main` fails by assertion, not ENOENT.
2. The editor's `systemPrompt` (from `scripted().calls`):
   - names all six paths in backticks;
   - contains "Output contract — `reaction`", "The MVP line:" and each ruling id;
   - is guarded on `typeof doors.react === "function"`.
3. `coherence` declares 206. On `main` it fails by count (ran 202 of 206).
4. Editor call:
   - `options.outputFormat` deep-equals `{ type: "json_schema", schema: outputContract("reaction") }`;
   - `options.allowedTools` is `[]`;
   - the ledger gains one row with stage `reaction`, role `writer`, kind `extract`, half `discovery`.
5. `calls[0].prompt`:
   - contains each screen's id and name, `proto.notes`, the linked PQ's id and question, and the PM's text;
   - does not contain `proto.file`, `/read it/i`, or an unlinked PQ's question.
6. Pre-call codes, table-driven, in the order above (`reaction-pending` after `prototype-stale`). Each case breaks its own condition and every later one. Each asserts `instanceof Refused`, the code, and `e.detail.text` and `e.detail.pq` by property (never `deepEqual`, never the message text). Each also asserts zero calls, zero ledger rows, and `tree(root, "discovery")` unchanged.
7. The PRD moved after the build (e.g. `answer` with an OQ) and `seen` holds the current hashes: still `prototype-stale`.
8. The prototype is current but `seen.prototype_hash` is wrong, or `seen` is all zeros: `revision-moved`, zero calls.
9. `agree()` before react, with the pre-agreement `seen`: allowed.
10. `already-ruled` through the doors (build asking Q, `answer({ pq })`, rebuild asking Q):
    - zero calls, and the message names RUL-1;
    - control: with PQ-1 still open, react is allowed and records `pq: "PQ-1"`;
    - without the rebuild: `prototype-stale`.
11. `reaction-invalid` cases. Each makes one call, leaves `prd.json` byte-identical, and files no `amendment-audit` file:
    - both ids; neither id; `criterion: "REQ-2"`;
    - an addition carrying `id: "AC-1"`;
    - missing `change`, `rationale` or `note`;
    - statement `""` or `"   "`;
    - a reword identical to the current statement;
    - a change with rationale `""` or `"   "`;
    - `REQ-1/AC-9`, or `REQ-9`;
    - a reword or an addition on `REQ-3` (past the line in `seedProject`).
12. `change: null` with rationale `""` is allowed.
13. `agree()` inside the `_query` wrapper gives `prd-changed`: detail `{ text, pq }`, no audit file, and `prd.json` equals the post-agree bytes.
14. `answer({ pq })` inside the wrapper gives `revision-moved`, and `prd.json` equals the post-answer bytes. This rejects guard-first ordering.
15. A rebuild inside an async-generator wrapper that changes only notes or questions:
    - gives `revision-moved`, with the prototype content hash unchanged;
    - count only ledger rows with stage `reaction`;
    - check for no audit only under `discovery/reviews/amendment-audit`.
16. `prototype.json` unlinked inside the wrapper gives `revision-moved`, not a crash.
17. `propose()` inside the wrapper: compare the discovery tree with the snapshot taken after the injected write, since propose files its own audit.
18. `change: null` with a mid-call `agree()` still gives `prd-changed`, with no write.
19. Allowed reword:
    - target is `/requirements/i/acceptance_criteria/j/statement`, `from` is the old statement, `to` is trimmed;
    - `origin: "reaction"`, `by: "editor"`, `reaction` equal to the RX id, `pq` present only when given, `status: "proposed"`;
    - `validate("prd", loadPrd(root)).ok`.
20. Allowed addition: `target` ends in `/acceptance_criteria/<length>`, not `-`; `adds: true`; no `from`; `to` is `{ id: <next AC-n>, statement }`.
21. After an allowed change, the audit exists and its `judged` pin equals the saved PRD's content hash.
22. A requirement holding AC-1 and AC-3 gets AC-4.
23. Allowed react, refused react, `reject` AMD-1, allowed react: the result is RX-2 with AMD-2.
24. `screens`, on the bookings fixture (`project(parent, [cancel("REQ-1")])`): a reword of REQ-1/AC-1 gives `["SCREEN-1"]` while `amendment.radius.screens` is `[]`. Do not use the dock fixture: its vocabulary puts SCREEN-1 in the radius.
25. With a fixed `_now`: `reaction.at === amendment.at === _now().toISOString()`.
26. `reaction.seen` deep-equals the current `{ prd_hash, prototype_hash }` content hashes, and `text` equals the argument byte-for-byte.
27. Null record:
    - `proposal: null`, `screens: []`, `note` as returned, `pq` kept;
    - amendments, requirements, content hash, version and agreements unchanged;
    - no `amendment-audit` directory;
    - `write()` is not refused `reaction-pending`.
28. `prd.flags` is unchanged after any react.
29. After a react with a blocking PQ: `prototype.json` is byte-identical, the PQ is still `open`, and `write()` refuses `reaction-pending` with zero calls.
30. One at a time:
    - a second react while RX-1's AMD-1 is proposed is refused `reaction-pending` with zero calls, `prd.json` unchanged, and `detail.pending` naming RX-1 and AMD-1;
    - after `reject` (or `approve`) of AMD-1, the next react is allowed and records RX-2;
    - a `change: null` reaction never blocks the next react.
31. An `onEvent` spy receives `· ok` and nothing else.
32. A `BudgetError` propagates with its class and code unchanged.
33. Make no assertion on `skeleton("reaction")`.
34. Journey step 4 (PR 5): a backlog is seeded before the reaction. Between step 3's agree and the rewrite, `exportHandoff({ exit: "team" })` is refused `not-ready` with `stories-stale`, with no handoff written. After the rewrite it succeeds, and the contract shows the criterion and RUL-n.
35. With a backlog on disk, the minted amendment's `radius.stories` equals what `approve` recomputes, so `approve` with that radius succeeds (no `radius-unacknowledged`).
36. `react` returns `{ reaction, amendment, audit, prd }`; for `change: null`, `amendment` and `audit` are null.

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
5. Design staleness blocks only the Delivery exits. The design checks still block every exit (revised in revision 3).
6. A history copy on overwrite, owner-decided, keyed by the whole saved file and taken before the builder call (revised in revision 3).
7. The guard refuses for extract and react, and re-applies for turn. `react` also re-checks the prototype after its call (revised in revision 3).
