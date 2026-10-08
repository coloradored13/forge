# Build plan: guided Discovery through handoff

Status: proposal. Milestone results and PR state live in dated evidence docs, starting with [the DH0 evidence](discovery-m0-evidence.md). Baseline: `f8ad980d1aa71d72f86fc62b83a1396010118ab6`. `docs/round-two.md` is superseded and is not an input to this work. DH labels distinguish this plan from Forge's earlier M0–M3 milestones.

Read the [workflow summary](discovery-workflow.md) and [acceptance specification](discovery-acceptance.md) together. The accepted scope stops at handoff; it does not include implementing the downstream product or running Forge Delivery.

## Start with tests, but test the right things

Yes: define the successful journey and its failure cases before changing orchestration. Then write executable failing tests for the first increment, implement that increment, and repeat. Do not first build a huge test framework or a simulated happy path that only proves our mock agents agree with us.

Use three layers of evidence:

1. **Deterministic pipeline tests:** scripted model responses exercise real commands/routes, persistence, approvals, version conflicts, stale artifacts, and package contents. These tests must fail when the relevant invariant is broken.
2. **Separate real-model evaluations:** the owner runs these separately, with a Claude session other than the implementing one, to check whether the actual agents ask useful questions, preserve supplied meaning, expose uncertainty, and incorporate prototype feedback. Retain inputs, outputs, model versions, operator labels, cost and outcome. The implementing session makes no live model calls; all implementation tests use `scripted()`.
3. **Human acceptance:** a non-coding PM operates the workflow, then a receiving team member reads only the package. Record effort, misunderstandings, help needed and remaining product decisions. Model-generated quality ratings do not replace this evidence.

The first change should add D01/D02 from the acceptance specification as a red regression around current prototype feedback and extraction behavior. A cleanly failing behavioral assertion is evidence; a missing import or unimplemented API is not. Existing tests that encode superseded requirements must be changed deliberately, with the new requirement and replacement assertion identified.

## Implementation approach

- Extend the existing Node application, console routes, model-call boundary, store, schemas, hash helpers and eval harness. Change Discovery in place, with one console flow. Keep roles separate by context and authority; do not build a new agent runtime or change anything under `delivery/`.
- Put the primary journey in one console experience: current understanding, consequential questions, prototype, feedback, proposed changes, agreement, handoff. Keep technical IDs and raw records available for inspection without requiring them for PM decisions.
- Keep the PRD and accepted decisions authoritative. Prototype and backlog generation read pinned revisions. An agent returns proposals or generated artifacts; the application validates and commits accepted changes.
- Add the smallest coherent session metadata needed for reactions, decisions, agreement revision, and in-flight operations. Co-locate related state with existing Discovery records; do not introduce a database or distributed event system without observed need.
- Reuse the existing amendment/ruling behavior where it fits. General feedback may concern a problem statement, scope, constraint, or unanswered question, so do not force every answer into a new requirement criterion.
- Protect the shared project record across different actions, not merely double clicks of the same button. Use a project mutation lock and expected revision checks; serialize dependent writes. Independent read-only reviews may run concurrently against the same revision.
- Give the prototype builder no write access to the project. It writes only to an isolated staging directory or returns HTML as structured output; the runner validates content, allowed paths and revisions before publishing to `discovery/prototype/`. Merely changing the working directory or rejecting a wrong-file write after it lands is insufficient. Cancellation or failure preserves the last accepted artifacts. Record unknown model spend honestly; promise one initiated operation per request, not impossible guarantees about a remote provider's billing.
- Treat generated prototype HTML as untrusted when showing it in the console. Isolate it from parent controls and credentials; block access to external resources in the supported prototype mode. Test the actual browser behavior.

## Size budgets and review stops

Before each future milestone starts, its PR records owner-agreed estimates for sessions, net implementation lines and net eval/helper lines, with a baseline commit and counted areas. If any actual exceeds 150% of its estimate, stop for review and report what is done, what remains, and the options to cut, continue or stop. Report additions/deletions and documentation separately so net counts do not hide churn. A missing agreement is not permission to start. DH1a and DH1b each require their own estimates and a separate PR, green on its own tests. No budget tooling is needed.

DH0 retains its already agreed cap: 160 added nonblank test/helper lines, with a hard stop above 240. Application and schema changes are capped at zero; documentation is separate. The owner approved the final suite's size against this cap; actuals are in [the DH0 evidence](discovery-m0-evidence.md). Do not retroactively substitute a net-line or session cap for that agreement.

## Milestones

Milestones are sequential and independently reviewable. They are scope units, not promises about calendar duration or model spending. Re-estimate remaining effort after the first complete slice using observed implementation and PM effort. A failed checkpoint should trigger a fix, a cut, or an explicit stop; it should not automatically expand this plan.

### DH0 — Agree on observable behavior and capture the baseline

**Current authorization:** commit this revised plan on a fresh branch from `main`, add only D01/D02 using `scripted()` and existing functions, show assertion failures against unchanged `f8ad980`, and stop for review. Do not merge intentionally failing tests, fix the defects, add browser tests, change schemas, or make live model calls. The full feedback resolves the truncated plan revisions; its additional test-layout suggestions and differences from the completed suite are recorded in the evidence, not treated as authorization to expand DH0.

**Deliver:** only D01/D02 failing regressions, their passing controls, and the evidence needed for review. The wider acceptance document remains a proposal; vague/refined paired-input and full-pilot fixtures are deferred to their later milestones.

**Work:**
- Read the current code at the recorded revision and run `npm run evals` once before implementation. Preserve existing user work.
- Use the smallest shared-equipment cancellation fixture needed to expose D01/D02. Build its state through the real setup, workshop, extraction, prototype and ruling functions with `scripted()`; do not seed the final product records directly.
- Record the desired learning moment: the PM sees cancellation after pickup, rejects it, and chooses cancellation only before pickup. Do not treat this desired outcome as instructions every real PM must choose.
- Express the critical tests through existing public routes/functions and scripted model seams. Add no external account or paid model requirement to ordinary CI.

**Touches:** add only `evals/discovery-loop.mjs`, reusing existing `suite()`, `scripted()` and `withRoot()` without changing the harness, runner, schemas or application. Use explicit expected-check counts. Each property has a passing control and a violating example; the root-level suite intentionally makes ordinary evals red until a separately reviewed fix.

**Exit:** D01/D02 demonstrate the missing behavior through assertion failures on unchanged main at `f8ad980`; unrelated baseline failures are identified separately. Record results in [the DH0 evidence](discovery-m0-evidence.md), commit the tests, and stop for review. Fix nothing and make no live model calls. Fixture expectations distinguish product decisions from incidental wording. No claim of successful user experience yet.

**Merge order:** PR #58 never merges by itself. DH1a branches from #58's head. DH1a counts as green only when the full `npm run evals` passes, including `discovery-loop`. D01/D02 assertions may be tightened, never loosened; the DH1a PR lists every test edit as old → new. Close #58 with a pointer when DH1a's PR opens.

**Split (owner decision, 2026-10-08):** DH1a ships as two PRs, each with its own agreed estimate. DH1a.1 covers D01, D02 and the agreement checkpoint, and carries #58 to `main`. DH1a.2 covers D03 and D05 and stacks on it. Estimates and results are in [the DH1a evidence](discovery-dh1a-evidence.md).

### DH1a — Core reaction-to-agreement logic with scripted tests

**Deliver:** domain logic for feedback, proposed changes, approval, agreement and story prerequisites, exercised through real functions with scripted model responses. This is the first implementation milestone after the DH0 red-test review.

**Work:**
- Fix the reviewed D01/D02 defects only after DH0 review authorizes implementation.
- Record feedback against the viewed revision; have the specification editor propose a change whose origin and affected behavior are explicit. Approve or reject through the existing doors.
- Prevent extraction from overwriting or removing a PM-ruled criterion: refuse naming it, or hold the change as a proposal minted through the amend door. Unruled content stays editable (D02). Correct the doors header (`discovery/doors/index.mjs:6-7`) to match. Track affected revisions and invalidate agreement when meaning changes.
- Add stable IDs and resolution statuses to prototype questions, currently only `{ question, blocking }`; the runner mints them. Require current agreement before final stories.
- A refused `extract`, `answer` or `write` leaves `prd.json`, `prototype.json` and `stories.json` byte-identical. Implement only the state needed for this slice.

**Touches:** `discovery/workshop`, `discovery/doors`, `discovery/prototype`, `discovery/stories`, `discovery/record`, and the smallest necessary schema additions. All model calls remain behind `shared/agent-call`.

**Tests first:** D01–D03 and D05 at the domain-function level, with both allowed and violating examples. No browser or live-model dependency.

**Exit:** the scripted journey carries a PM-approved correction through current state and story generation, rejects unapproved/stale changes, and preserves unrelated accepted decisions. It does not claim PM usability or package readiness.

### DH1b — Supported launch, console, package and prototype isolation

**Deliver:** the owner can launch Forge and act as the PM through the complete small reaction-to-handoff slice.

**Work:**
- Provide one README command, using the existing runtime, that opens the console on a new project folder. Setup checks prerequisites and `gh auth status` before writing anything. Missing authentication explains the remedy without leaving a half-created project; a failed setup can be retried without manual cleanup.
- Add plain-language console controls for reaction, proposed changes and agreement. No JSON-pointer editing or agent management is required of the PM.
- Produce a minimal self-contained handoff including actual prototype HTML. Label unavailable capabilities honestly.
- Contain the prototype builder's writes before generation, then validate and publish through the runner. Isolate displayed HTML from parent state, approval controls and external services before the first browser pilot. Basic save/resume and actionable refusal messages are required.
- Test setup separately from the PM journey, including missing `gh` authentication and a successful retry. PM tasks require no terminal commands after the supported launch.
- Hide the tracker option in the console only. The export door's tracker path stays, because `seam` checks its carry-forward (`evals/seam.mjs:316`).

**Touches:** setup, console, prototype rendering/publication, export packaging, and separately invoked browser tests. Reuse DH1a's core logic.

**Tests first:** console coverage for D03/D05, portable D10 happy path, core D13 builder containment and browser isolation, and setup success/failure examples. For D13, assert on the options the builder call passes to `query()` (`scripted().calls[0].options`): either it has no Write, Edit or Bash tools (structured-output mode), or its cwd is a staging directory outside the project root and its permission rules deny writes under the project. This assertion must fail on `f8ad980`. Keep "a scripted builder Write to `discovery/prd.json` is refused and leaves that file byte-identical" as extra assertions; alone they already pass on `f8ad980`, because `scripted()` never executes tool uses. An allowed staged HTML write must publish only after validation. A live check that the SDK actually denies such a write is separate live evidence. A failing `gh` seam proves setup refuses before writes, and retry needs no cleanup.

Keep browser checks for D03, D10 package opening and D13 outside root-level `evals/*.mjs` auto-discovery. Introduce a separate command such as `npm run evals:browser` with Playwright as a development dependency in this milestone, not DH0. Without an installed browser, report SKIPPED, never PASS; ordinary evals still run.

**Exit:** the owner gets from the README to the first workshop question alone, then completes the correction in the console and finds the chosen rule in the specification, prototype behavior, criterion, story and handoff. Setup has been demonstrated both with and without usable GitHub authentication. The owner and Claude arrange a fresh agent session given only the package, labelled **agent read**; this does not count as H02. The agent read identifies the chosen cancellation rule and the excluded work; a miss is a failed checkpoint. All live runs remain separate from the implementing session's scripted checks.

**Decision:** if this loop is confusing or fails to reduce ambiguity, revise this slice before building more machinery. Do not compensate with additional approvals or reports.

### DH2 — Support varied inputs and a bounded discovery loop

**Deliver:** both vague and refined ideas reach the same quality of agreement without the detailed idea being needlessly re-interviewed.

**Work:**
- Preserve the existing adaptive interrogator prompt. Add visible topic status and source-backed assumptions so its behavior is understandable and testable.
- Gather consequential questions from prototype, backlog and design records in the same PM view. Give each an owner, scope, source and readiness impact. Route newly discovered product choices back to this decision flow.
- Add the technical-adviser path for relevant uncertainty. Permit bounded delegation to engineering/design; never fabricate a specialist's approval or investigation.
- Support partial exploratory prototypes before full coverage, with explicit exploration targets and omissions. Offer alternatives when an ambiguity is best resolved by seeing them.
- Keep a decision settled unless new evidence, a changed requirement or a contradiction justifies reopening it. Show unresolved work and the cost/effort checkpoint instead of looping automatically.
- Handle a scope cut by examining dependent requirements/screens/criteria; do not preserve approval solely because a text transformation is exact.

**Touches:** workshop prompts/sections, prototype prompt and records, review prompts, decision metadata and console views. Keep the original coverage dimensions; do not invent a second requirements taxonomy.

**Tests first:** scripted D04, D06–D08. The owner and Claude separately run Q01–Q03 and Q05. Use paired inputs and adversarial agent outputs. Tests assert supported meaning, not exact model prose.

**Exit:** both input variants work; the PM can answer, reject, delegate, or explicitly stop on an unknown. Repeated findings and failed generations cannot silently trigger unlimited paid retries. Every remaining material blocker is visible.

### DH3 — Make the handoff trustworthy for both recipients

**Deliver:** a self-contained immutable package whose contents agree with the PM's accepted revision and whose readiness claim names the intended recipient.

**Work:**
- Generate epics/stories only from the agreement. Validate all criterion types with plans that may include multiple automated or human checks; distinguish planned checks from executed results.
- Add a separate reviewer pass for omissions, contradictions and invented behavior. Persist enough finding/decision history to distinguish a proposed fix from a verified correction and to preserve intentional deferrals.
- Show explicit visual authority and implementation discretion. For a human team, delegate further design work. For a future build pipeline, resolve material design ambiguity or mark the package blocked; use the existing design components where sufficient.
- Resolve the current design-to-stories dependency in the existing flow: design must accept the agreed/provisional product and prototype before final stories, without requiring the final backlog as input. Any design feedback that changes product meaning returns to the agreement loop, after which final stories are generated or refreshed. This prevents a signed design and a final backlog from depending circularly on one another.
- Build the documented Markdown/JSON/prototype/manifest package from one pinned revision. Validate actual asset bytes and references, not only their metadata. Freeze previous exports; a material change produces another version.
- Make readiness include current agreement, relevant reviews, trace consistency, decisions and package completeness. Separate discussion-draft export from ready export.
- Test the package from an empty directory without source access. A small documented package verifier belongs at this boundary; it is not a new general validation framework.

**Touches:** story checks/schema, review storage, optional design flow, export readiness/rendering, package writer and focused `evals/handoff-package.mjs`.

**Tests first:** scripted D07–D12. The owner and Claude separately run Q04/Q05 with a fresh package-only session labelled **agent read**. Reuse applicable seam and freshness fixtures. Reserve H02 and the human comparison in H03 for DH4.

**Exit:** a fresh planning-only agent can enumerate intended behavior, work, discretion and unresolved questions from the package without the Discovery conversation or Forge checkout. Compare its read against the agreement and label it agent evidence. Human consumability remains pending until DH4; this does not prove downstream build correctness.

### DH4 — Verify recovery and non-coder usability

**Deliver:** the supported journey survives ordinary interruptions and can be completed without coding assistance.

**Work:**
- Finish project-level conflict handling (conflicting writes are serialized; late results cannot overwrite accepted decisions), duplicate-request prevention, staged persistence, cancellation, visible failures, retry choices, and resume behavior. Basic protection introduced in DH1 remains in place throughout.
- Test prototype isolation in the real browser. A prototype cannot submit PM approvals, read parent state, or contact arbitrary services.
- Recheck the supported launch and missing-auth recovery introduced in DH1b. Do not postpone first-launch usability until this milestone or claim a hosted/browser deployment that has not been provided.
- Run the human pilot with a new idea and a non-coding PM; where practical, use someone who did not help design the interface. Test one change after provisional agreement and one scope cut before final export.
- At the owner's chosen pilot, run H02 once with a cold human recipient given only the package. Earlier DH1b/DH3 reads use fresh agent sessions and are labelled agent reads. Compare a fresh planning-only agent's read with the human's for H03; record help, time, questions, corrections and unresolved blockers against the fixed rubric. The owner and Claude conduct the pilot and live runs separately.

**Tests first:** scripted D09, D11, D13/D14, with browser checks in their separate suite. H01–H03 and the complete Q suite are separate owner/Claude evidence. Cover failure injection before declaring readiness.

**Exit:** required deterministic checks pass, Q01–Q05 meet their stated rubrics, and human acceptance meets the agreed effort/clarity targets. Failed model-quality results keep readiness pending even when the state-machine tests pass. A missing credential or unavailable participant also leaves that evidence pending; it is never counted as a pass. Preserve valid checkpoints between fixes rather than forcing the PM to repeat unrelated work.

## Compatibility and cutover

The new acceptance plan intentionally permits multiple checks per criterion and covers non-functional criteria. Legacy Delivery expects a different contract. Do not silently feed the new package to `delivery/intake` or claim compatibility because JSON parsing succeeds.

Introduce an explicitly versioned handoff format at the export boundary. Keep legacy `handoff-vN.json` generation only while its seven consumer suites read it: `seam` and `transition-table` call `exportHandoff` directly, and `economics`, `release`, `qa`, `rejudge` and `scope` reach it through `seedDelivery`, `seedBuild` or `reexport` (`evals/_fixture.mjs:154`, `:181`, `:245`). Alternatively, move each consumer to a stored legacy snapshot deliberately in the same PR. Preserve historical snapshots without rewriting them. Do not silently migrate an in-progress project; schema changes migrate it explicitly or refuse. Additive Discovery metadata is preferable where semantics are unchanged; version genuinely changed semantics. Change nothing under `delivery/`; its frozen path is unsupported for the new format until a separate adaptation task validates it.

Fix D01, D02, D05 and D13 in the existing modules and build the loop into the existing console. Maintain one Discovery flow, without an old/new switch or parallel legacy journey. The owner's only project, Bakehouse, is a throwaway record and remains read-only. Hide the tracker option on the console's export page in DH1b until synchronization is fixed; comparing against a previous handoff cannot detect remote issue edits. Tracker repair remains out of scope. Cutover requires the full `npm run evals` to pass, or each consumer to move to a stored legacy snapshot in the same PR.

Update `SPEC.md` and the rule registry alongside the milestone that changes their claims. Do not add rules merely to name every new function, and do not preserve false green assertions for compatibility.

## Completion and deliberate exclusions

Complete means the selected PM journey produces a checked, usable handoff and has evidence at all three test layers. It does not mean every imaginable question is answered or future code is proven faithful.

Included: relevant interrogation, explicit assumptions, prototype feedback, agreement, backlog, planned acceptance coverage, decision ownership, portable handoff, and the recovery needed to trust those steps.

Excluded: production implementation, Delivery orchestration, release gates, tracker synchronization, full customer research tooling, generic agent infrastructure, an OS installer, automated budget estimation research, and portfolio/second-cycle management. One amendment and a scope cut within the current discovery exercise are included.

Preserve practical safeguards from current Forge: versioned artifacts, stable IDs, scope checks, model-call accounting, explicit questions, and separate writer/reviewer contexts. Add mechanisms only when an acceptance case needs them.
