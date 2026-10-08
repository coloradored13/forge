# Build plan: guided Discovery through handoff

Status: M0 authorized for failing regression tests only; no application or schema fixes. Baseline: `f8ad980d1aa71d72f86fc62b83a1396010118ab6`. `docs/round-two.md` is superseded and is not an input to this work.

Read the [workflow summary](discovery-workflow.md) and [acceptance specification](discovery-acceptance.md) together. The accepted scope stops at handoff; it does not include implementing the downstream product or running Forge Delivery.

## Start with tests, but test the right things

Yes: define the successful journey and its failure cases before changing orchestration. Then write executable failing tests for the first increment, implement that increment, and repeat. Do not first build a huge test framework or a simulated happy path that only proves our mock agents agree with us.

Use three layers of evidence:

1. **Deterministic pipeline tests:** scripted model responses exercise real commands/routes, persistence, approvals, version conflicts, stale artifacts, and package contents. These tests must fail when the relevant invariant is broken.
2. **Opt-in real-model evaluations:** check whether the actual agents ask useful questions, preserve supplied meaning, expose uncertainty, and incorporate prototype feedback. Retain inputs, outputs, model versions and operator labels. These runs are not the offline regression suite.
3. **Human acceptance:** a non-coding PM operates the workflow, then a receiving team member reads only the package. Record effort, misunderstandings, help needed and remaining product decisions. Model-generated quality ratings do not replace this evidence.

The first change should add D01/D02 from the acceptance specification as a red regression around current prototype feedback and extraction behavior. A cleanly failing behavioral assertion is evidence; a missing import or unimplemented API is not. Existing tests that encode superseded requirements must be changed deliberately, with the new requirement and replacement assertion identified.

## Implementation approach

- Extend the existing Node application, console routes, model-call boundary, store, schemas, hash helpers and eval harness. Keep roles separate by context and authority; do not build a new agent runtime.
- Put the primary journey in one console experience: current understanding, consequential questions, prototype, feedback, proposed changes, agreement, handoff. Keep technical IDs and raw records available for inspection without requiring them for PM decisions.
- Keep the PRD and accepted decisions authoritative. Prototype and backlog generation read pinned revisions. An agent returns proposals or generated artifacts; the application validates and commits accepted changes.
- Add the smallest coherent session metadata needed for reactions, decisions, agreement revision, and in-flight operations. Co-locate related state with existing Discovery records; do not introduce a database or distributed event system without observed need.
- Reuse the existing amendment/ruling behavior where it fits. General feedback may concern a problem statement, scope, constraint, or unanswered question, so do not force every answer into a new requirement criterion.
- Protect the shared project record across different actions, not merely double clicks of the same button. Use a project mutation lock and expected revision checks; serialize dependent writes. Independent read-only reviews may run concurrently against the same revision.
- Stage generated outputs and publish them only after validation and revision checks. Cancellation or failure preserves the last accepted artifacts. Record unknown model spend honestly; promise one initiated operation per request, not impossible guarantees about a remote provider's billing.
- Treat generated prototype HTML as untrusted when showing it in the console. Isolate it from parent controls and credentials; block access to external resources in the supported prototype mode. Test the actual browser behavior.

## Size budgets and review stops

Before each milestone, agree with the owner on a numeric size cap, its baseline commit, and counted areas. Count added nonblank implementation/test/helper lines and report deletions and documentation separately; do not offset additions with unrelated deletions. Stop for review if additions exceed 150% of the agreed cap. A missing cap is not permission to start that milestone. M1a and M1b each require their own cap.

For M0 the owner agreed to 160 added nonblank test/helper lines, with a hard stop above 240. Application and schema changes are capped at zero. Plan documentation is counted separately. Do not add a growth-checker framework for this work; record the measured diff in the review evidence.

## Milestones

Milestones are sequential and independently reviewable. They are scope units, not promises about calendar duration or model spending. Re-estimate remaining effort after the first complete slice using observed implementation and PM effort. A failed checkpoint should trigger a fix, a cut, or an explicit stop; it should not automatically expand this plan.

### M0 — Agree on observable behavior and capture the baseline

**Current authorization:** commit this revised plan on a fresh branch from `main`, add only D01/D02 using `scripted()` and existing functions, show assertion failures against unchanged `f8ad980`, and stop for review. Do not fix the defects, add browser tests, change schemas, or make live model calls. Real-model evaluation is scheduled separately. Truncated plan instructions remain pending clarification and are not inferred as authorization.

**Deliver:** only D01/D02 failing regressions, their passing controls, and the evidence needed for review. The wider acceptance document remains a proposal; vague/refined paired-input and full-pilot fixtures are deferred to their later milestones.

**Work:**
- Read the current code at the recorded revision and run `npm run evals` once before implementation. Preserve existing user work.
- Use the smallest shared-equipment cancellation fixture needed to expose D01/D02. Build its state through the real setup, workshop, extraction, prototype and ruling functions with `scripted()`; do not seed the final product records directly.
- Record the desired learning moment: the PM sees cancellation after pickup, rejects it, and chooses cancellation only before pickup. Do not treat this desired outcome as instructions every real PM must choose.
- Express the critical tests through existing public routes/functions and scripted model seams. Add no external account or paid model requirement to ordinary CI.

**Touches:** add only `evals/discovery-loop.mjs`, reusing existing `suite()`, `scripted()` and `withRoot()` without changing the harness, runner, schemas or application. Use explicit expected-check counts. Each property has a passing control and a violating example; the root-level suite intentionally makes ordinary evals red until a separately reviewed fix.

**Exit:** D01/D02 demonstrate the missing behavior through assertion failures on unchanged main at `f8ad980`; unrelated baseline failures are identified separately. Record results in [the M0 evidence](discovery-m0-evidence.md), commit the tests, and stop for review. Fix nothing and make no live model calls. Fixture expectations distinguish product decisions from incidental wording. No claim of successful user experience yet.

### M1a — Core reaction-to-agreement logic with scripted tests

**Deliver:** domain logic for feedback, proposed changes, approval, agreement and story prerequisites, exercised through real functions with scripted model responses. This is the first implementation milestone after the M0 red-test review.

**Work:**
- Fix the reviewed D01/D02 defects only after M0 review authorizes implementation.
- Record feedback against the viewed revision; propose a change whose origin and affected behavior are explicit.
- Prevent extraction or late results from overwriting accepted decisions. Track affected revisions and invalidate agreement when meaning changes.
- Require current agreement before final stories; route newly discovered product choices back to the decision flow.
- Preserve the last accepted state on failure and serialize conflicting writes. Implement only the state needed for this slice.

**Touches:** `discovery/workshop`, `discovery/doors`, `discovery/prototype`, `discovery/stories`, `discovery/record`, and the smallest necessary schema additions. All model calls remain behind `shared/agent-call`.

**Tests first:** D01–D03 and D05 at the domain-function level, with both allowed and violating examples. No browser or live-model dependency.

**Exit:** the scripted journey carries a PM-approved correction through current state and story generation, rejects unapproved/stale changes, and preserves unrelated accepted decisions. It does not claim PM usability or package readiness.

### M1b — Supported launch, console, package and prototype isolation

**Deliver:** the owner can launch Forge and act as the PM through the complete small reaction-to-handoff slice.

**Work:**
- Provide one documented, tested launch path using the existing runtime. Check prerequisites and GitHub authentication before setup performs remote-dependent mutations. A missing `gh` sign-in must explain the remedy without leaving a half-created project; provide an explicit files-only choice where remote access is unnecessary. A retry after authentication resumes or completes setup coherently.
- Add plain-language console controls for reaction, proposed changes and agreement. No JSON-pointer editing or agent management is required of the PM.
- Produce a minimal self-contained handoff including actual prototype HTML. Label unavailable capabilities honestly.
- Isolate generated HTML from parent state, approval controls and external services before the first browser pilot. Basic save/resume and actionable refusal messages are required.
- Test setup separately from the PM journey, including missing `gh` authentication and a successful retry. PM tasks require no terminal commands after the supported launch.

**Touches:** setup, console, prototype rendering/publication, export packaging, and separately invoked browser tests. Reuse M1a's core logic.

**Tests first:** console coverage for D03/D05, portable D10 happy path, core D13 isolation, and setup success/failure examples. Browser checks are reported separately from scripted domain checks.

**Exit:** the owner completes the correction in the console and finds the chosen rule in the specification, prototype behavior, criterion, story and handoff. Setup has been demonstrated both with and without usable GitHub authentication. Reader and live-model checkpoint wording will be finalized from the owner's pending corrections before implementation starts.

**Decision:** if this loop is confusing or fails to reduce ambiguity, revise this slice before building more machinery. Do not compensate with additional approvals or reports.

### M2 — Support varied inputs and a bounded discovery loop

**Deliver:** both vague and refined ideas reach the same quality of agreement without the detailed idea being needlessly re-interviewed.

**Work:**
- Preserve the existing adaptive interrogator prompt. Add visible topic status and source-backed assumptions so its behavior is understandable and testable.
- Gather consequential questions from prototype, backlog and design records in the same PM view. Give each an owner, scope, source and readiness impact.
- Add the technical-adviser path for relevant uncertainty. Permit bounded delegation to engineering/design; never fabricate a specialist's approval or investigation.
- Support partial exploratory prototypes before full coverage, with explicit exploration targets and omissions. Offer alternatives when an ambiguity is best resolved by seeing them.
- Keep a decision settled unless new evidence, a changed requirement or a contradiction justifies reopening it. Show unresolved work and the cost/effort checkpoint instead of looping automatically.
- Handle a scope cut by examining dependent requirements/screens/criteria; do not preserve approval solely because a text transformation is exact.

**Touches:** workshop prompts/sections, prototype prompt and records, review prompts, decision metadata and console views. Keep the original coverage dimensions; do not invent a second requirements taxonomy.

**Tests first:** D04, D06–D08; real-model exercises Q01–Q03 and Q05. Use paired inputs and adversarial agent outputs. Tests assert supported meaning, not exact model prose.

**Exit:** both input variants work; the PM can answer, reject, delegate, or explicitly stop on an unknown. Repeated findings and failed generations cannot silently trigger unlimited paid retries. Every remaining material blocker is visible.

### M3 — Make the handoff trustworthy for both recipients

**Deliver:** a self-contained immutable package whose contents agree with the PM's accepted revision and whose readiness claim names the intended recipient.

**Work:**
- Generate epics/stories only from the agreement. Validate all criterion types with plans that may include multiple automated or human checks; distinguish planned checks from executed results.
- Add a separate reviewer pass for omissions, contradictions and invented behavior. Persist enough finding/decision history to distinguish a proposed fix from a verified correction and to preserve intentional deferrals.
- Show explicit visual authority and implementation discretion. For a human team, delegate further design work. For a future build pipeline, resolve material design ambiguity or mark the package blocked; use the existing design components where sufficient.
- Resolve the current design-to-stories dependency explicitly: the new profile's design path must accept the agreed/provisional product and prototype before final stories, without requiring the final backlog as input. Preserve the legacy entry point. Any design feedback that changes product meaning returns to the agreement loop, after which final stories are generated or refreshed. This prevents a signed design and a final backlog from depending circularly on one another.
- Build the documented Markdown/JSON/prototype/manifest package from one pinned revision. Validate actual asset bytes and references, not only their metadata. Freeze previous exports; a material change produces another version.
- Make readiness include current agreement, relevant reviews, trace consistency, decisions and package completeness. Separate discussion-draft export from ready export.
- Test the package from an empty directory without source access. A small documented package verifier belongs at this boundary; it is not a new general validation framework.

**Touches:** story checks/schema, review storage, optional design flow, export readiness/rendering, package writer and focused `evals/handoff-package.mjs`.

**Tests first:** D07–D12, Q04/Q05, H02/H03. Reuse applicable seam and freshness fixtures.

**Exit:** a receiving designer/product owner/engineer can identify the intended behavior and their discretion; a separate planning-only agent can enumerate the work and unresolved questions from the package. Neither needs the Discovery conversation or Forge checkout. This proves handoff consumability, not downstream build correctness.

### M4 — Verify recovery and non-coder usability

**Deliver:** the supported journey survives ordinary interruptions and can be completed without coding assistance.

**Work:**
- Finish project-level conflict handling, duplicate-request prevention, staged persistence, cancellation, visible failures, retry choices, and resume behavior. Basic protection introduced in M1 remains in place throughout.
- Test prototype isolation in the real browser. A prototype cannot submit PM approvals, read parent state, or contact arbitrary services.
- Recheck the supported launch and missing-auth recovery introduced in M1b. Do not postpone first-launch usability until this milestone or claim a hosted/browser deployment that has not been provided.
- Run the human pilot with a new idea and a non-coding PM; where practical, use someone who did not help design the interface. Test one change after provisional agreement and one scope cut before final export.
- Have human and planning-only agent recipients read the final package cold. Record help, time, questions, corrections and unresolved blockers against the fixed rubric.

**Tests first:** D09, D11, D13/D14; H01–H03 and the complete opt-in Q suite. Cover failure injection before declaring readiness.

**Exit:** required deterministic checks pass, Q01–Q05 meet their stated rubrics, and human acceptance meets the agreed effort/clarity targets. Failed model-quality results keep readiness pending even when the state-machine tests pass. A missing credential or unavailable participant also leaves that evidence pending; it is never counted as a pass. Preserve valid checkpoints between fixes rather than forcing the PM to repeat unrelated work.

## Compatibility and cutover

The new acceptance plan intentionally permits multiple checks per criterion and covers non-functional criteria. Legacy Delivery expects a different contract. Do not silently feed the new package to `delivery/intake` or claim compatibility because JSON parsing succeeds.

Introduce an explicitly versioned new handoff format at the export boundary and keep existing exports readable. Preserve existing legacy fixtures and historical snapshots without rewriting them. Additive Discovery metadata is preferable where semantics are unchanged; version genuinely changed semantics. The frozen Delivery path is unsupported for the new format until a separate adaptation task validates it.

Keep the existing Discovery flow available while the thin slice is being developed. Expose the new journey as one opt-in entry point, not a growing configuration matrix. Switch the default only after M4, without silently migrating an in-progress project; retain a recoverable original for any explicit migration.

Update `SPEC.md` and the rule registry alongside the milestone that changes their claims. Do not add rules merely to name every new function, and do not preserve false green assertions for compatibility.

## Completion and deliberate exclusions

Complete means the selected PM journey produces a checked, usable handoff and has evidence at all three test layers. It does not mean every imaginable question is answered or future code is proven faithful.

Included: relevant interrogation, explicit assumptions, prototype feedback, agreement, backlog, planned acceptance coverage, decision ownership, portable handoff, and the recovery needed to trust those steps.

Excluded: production implementation, Delivery orchestration, release gates, tracker synchronization, full customer research tooling, generic agent infrastructure, an OS installer, automated budget estimation research, and portfolio/second-cycle management. One amendment and a scope cut within the current discovery exercise are included.

Preserve practical safeguards from current Forge: versioned artifacts, stable IDs, scope checks, model-call accounting, explicit questions, and separate writer/reviewer contexts. Add mechanisms only when an acceptance case needs them.
