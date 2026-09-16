# Product Interrogation Tool — Detailed Build Plan

## 1. Product I would build

I would build a single-user, local-first web application that conducts an adaptive product interview and produces a durable, reviewable product handoff.

The application would:

1. Open by asking the product manager what they are considering building.
2. Interrogate the underlying problem before granting the proposed solution any special status.
3. Adapt its depth and question sequence to the particular problem.
4. Ask one focused question at a time.
5. Visibly declare whether it is **drawing something out** or **pressure-testing** a claim.
6. Maintain a continuously updated product record behind the conversation.
7. Deliver interrogation craft as small, triggered units rather than one monolithic prompt.
8. Distinguish settled facts, assumptions, unknowns, overrides, risks, and engineering questions.
9. Generate worked consequences through a context-isolated deriver that sees only the product record.
10. Let the product manager react to every consequential interpretation independently.
11. Send rejected or corrected interpretations back into the interview.
12. Finish with a build-ready proposal, build-to-learn experiment, learning plan, or reasoned decision to stop.
13. Retain the transcript, record history, derivation rounds, corrections, and final output.
14. Export a document that a developer or agent can use without access to the original conversation.

The interface would remain conversational, but the implementation would keep enough explicit state to make consequential model decisions inspectable, attributable, correctable, and testable.

## 2. Chosen implementation shape

### 2.1 Interface

I would use a responsive browser application optimized for desktop use. The primary workspace would contain:

- **Conversation:** the active question, a short reason for asking it, declared posture, response composer, and persistent challenge-response actions.
- **Record:** the continuously updated understanding, with evidence labels, unknowns, decisions, requirements, measures, and interpretations plus direct correction controls.
- **Session status:** current phase, recommendation or readiness claim, open issues, recently activated craft, and reaction-round progress.

The conversation would remain dominant so the experience never becomes a form. On smaller screens, these areas would become tabs rather than simultaneous columns.

### 2.2 Technology

I would use:

- **TypeScript** throughout.
- **React with Next.js** for the browser application and server endpoints.
- **PostgreSQL** for durable sessions, transcripts, records, and version history.
- **JSON columns** for evolving record fragments where rigid relational fields would prematurely impose a universal product schema.
- **Relational tables** for stable operational concepts such as sessions, messages, versions, model calls, craft activations, corrections, and derivation rounds.
- A provider-neutral **language-model gateway** supporting structured outputs, streaming, separate interviewer and deriver configurations, and prompt/model version recording.
- Background jobs for derivation rounds, rendering, and evaluation runs.
- Markdown and PDF exports for people and JSON exports for agents.

The first deployment would be one web service and one database. Logical isolation between roles would matter more than introducing multiple services.

### 2.3 Single-user operation

The first release would not include accounts, invitations, roles, presence, concurrent editing, comments, or collaborative approvals. A deployment would represent one user's workspace. Sessions would still be exportable because the output is intended to travel.

## 3. Triggered craft delivery

This would be the first subsystem built because it determines the quality of every phase.

### 3.1 Craft units

Each triggered piece of interrogation craft would be an independently loadable, versioned unit containing:

- Stable identifier and human-readable name.
- Exact behavioral instruction.
- Trigger description.
- Trigger and non-trigger examples.
- Applicable phases and activities.
- Conditions that increase priority or suppress it.
- Expected observable behavior.
- Expected record effect, where applicable.
- Tests and source-brief reference.
- Concrete examples rotated across unrelated domains.

Separate units would cover inversion, ownability, timelessness, atomicity, testability, necessity, requirement typing, behavioral point of view, hidden-detail extraction, settled-word enforcement, experience quantification, scope-line challenges, measurement validity, and the individual ambiguity lenses.

### 3.2 Always-loaded behavioral kernel

A deliberately small kernel would govern every interviewer turn:

- Act as a thought partner and interrogator, not a form.
- Treat inability to defend a claim as a finding, not a failure.
- Declare the posture.
- Apply emergent depth.
- Scale challenge to consequence.
- Offer defend, override, and workshop paths.
- Never fill a gap with something plausible.
- Ask one pointed question at a time.
- Keep each turn short.
- Record by default and block rarely.
- Do not manufacture objections.
- Accept well-supported answers and move on.
- Do not prescribe engineering implementation.

This kernel would not contain the complete craft library.

### 3.3 Triggering pipeline

For every user turn, the system would:

1. Load the current phase, transcript tail, current record, unresolved items, and last question.
2. Ask a lightweight trigger assessor to identify the few craft units relevant now.
3. Produce a structured activation proposal naming the unit, triggering text or record item, reason, confidence, and present consequence.
4. Apply deterministic eligibility constraints such as phase compatibility, suppression rules, duplicate protection, and an active-unit budget.
5. Select a very small foreground set—normally one unit and rarely two.
6. Load the full wording of only those units.
7. Ask the interviewer to choose the single highest-value next move.
8. Require a structured response containing posture, visible reason, one question, offered response paths, proposed record changes, consequential control-flow judgement, and activated craft identifiers.
9. Validate the response contract before presenting it.
10. Store the activation decision and resulting behavior for later review.

The system would never iterate through inactive craft units or expose a “next craft unit” concept.

### 3.4 Guardrails

To prevent craft from never firing, I would use broad semantic triggers, paraphrased examples, recall-oriented evaluation passes, activation logs, never-fired reports, and one behavioral test per craft unit.

To prevent the craft library from becoming a route, I would prohibit lens-completion percentages, required visitation, universal question order, phase completion based on section coverage, and empty record sections being treated as missing work.

## 4. Runtime components

### 4.1 Interview orchestrator

The orchestrator would retrieve session state, call the trigger assessor, load activated craft, call the interviewer, validate the response, apply record changes through reconciliation, persist the turn, and route corrections or phase operations. It would coordinate work but would not decide completion by counting topics.

The three model roles would not automatically mean three blocking calls on every turn:

- **Interviewer:** required for every substantive user turn because it produces the next conversational move. It is the only model call that must remain on the foreground path for a simple turn.
- **Trigger assessor:** conditional. It would run when the answer introduces a new claim, changes direction, contains ambiguity, or may activate craft beyond the unit already in play. A short factual answer to the interviewer's direct question would reuse the active craft context and skip reassessment. A periodic reassessment after several reused turns would protect against a craft unit remaining active too long.
- **Record reconciler:** conditional and normally off the response-critical path. The interviewer would emit a candidate record delta with its turn. Simple, additive deltas could be queued and reconciled together for up to three turns; corrections, contradictions, status changes, cross-entry effects, artifact attempts, derivation rounds, and phase transitions would force immediate reconciliation. The next turn would receive the authoritative record plus any explicitly pending deltas, so batching could not make new information disappear.

The expected steady-state turn would therefore use one foreground model call for a simple factual answer and two for a turn requiring fresh craft selection. Reconciliation would usually complete while the person reads or answers the next question. Stage 1 would target a median user-submit-to-complete-question latency of **three seconds or less**, a 95th percentile of **six seconds or less**, and visible first output within **1.5 seconds** where streaming is available. Those are engineering targets to test the architecture, not promises to hide missed by the implementation.

From Stage 1, every turn would retain and expose its end-to-end latency, time to first output, foreground and background call counts, per-call latency, and whether assessment or reconciliation was skipped, reused, or batched. This would be a small development readout and stored metadata, not a product analytics dashboard or a spending gate. If the median exceeds a few seconds, call routing and prompt/context size would be addressed before adding features.

Before starting a derivation round or another potentially long model operation, the interface would say that it is a longer operation, identify the record version and kinds of claims it will examine, and show the number of model operations currently planned. It would report progress without introducing budgets, spend caps, or approval gates.

### 4.2 Interviewer

The interviewer would receive the behavioral kernel, current phase goal, relevant conversation, current record, unresolved items, activated craft, prior user corrections, and the latest failed artifact attempt. Its job would be to make one conversational move. It would never receive the entire craft library at once.

### 4.3 Record reconciler

A separate reconciliation step would compare the previous record, latest exchanges, interviewer-proposed changes, evidence labels, decisions, and corrections. It would propose an explicit patch identifying additions, revisions, superseded statements, newly unsettled material, unknowns, evidence changes, overrides, engineering questions, and content that did not fit existing entries. Consequential changes would remain inspectable and correctable.

“Did not fit” would be an explicit patch outcome, not permission to coerce content into the nearest type. Unfitted content would remain visible in the record, retain its source and wording, and be included in periodic review counts. A growing unfitted collection would be treated as evidence that the entry-type vocabulary needs to change.

The authoritative record would win whenever the interviewer proposal and reconciler patch differ. The following interviewer call would receive the reconciled record, the accepted patch, and any still-pending deltas rather than relying on its prior prose. A dedicated integration test would deliberately reshape an interviewer-proposed change in reconciliation and verify that the next question reflects the reconciled record rather than the interviewer's earlier belief.

### 4.4 Artifact-attempt engine

At appropriate moments, this component would attempt to produce a vetting recommendation, build handoff, build-to-learn handoff, or developer-start package. It would report:

- What it can state confidently.
- Which record material supports each claim.
- Where it had to guess.
- Contradictions preventing a coherent claim.
- Requirements without demonstrable criteria.
- Measures that cannot be produced.
- Unknowns without owners.
- Scope commitments on neither side of the line.
- The single most consequential missing decision.

The interviewer would turn the most important failure into the next question. Completion would therefore arise from successful generation, not checklist coverage.

### 4.5 Context-isolated deriver

The deriver would have a hard context boundary. It would receive only a frozen record version and its derivation instructions. It would not receive transcript messages, interviewer prompts, hidden summaries, trigger history, or conversational memory.

I would enforce this in code with a dedicated input builder whose accepted input type contains only a serialized record version. The deriver endpoint would not accept a transcript or session-history parameter. Interviewer and deriver would use separate prompts and preferably different model configurations. Context manifests would prove what each call received.

### 4.6 Renderer

The first-release renderer would transform only the record into human-readable Markdown and structured JSON. It would never invent missing content; unresolved material would remain explicitly unresolved. Printable PDF, specialized developer-start views, and dedicated non-build/learning layouts would remain later rendering work once the interview is demonstrably good.

## 5. Information model without a universal questionnaire

The application needs operational structure for provenance and correction, but it would not impose mandatory product fields.

### 5.1 Session and transcript

A session would track phase, path, status, model configuration, current record version, transcript position, derivation round, stop state, and resume summary.

Every interaction would be an immutable transcript event, including user messages, assistant questions, visible posture and rationale, action selections, corrections, overrides, recommendations, derivation reactions, retries, and errors.

### 5.2 Emergent record entries

The record would be a collection of typed, linked entries that emerge only when relevant. Possible types would include problem claims, people, situations, value claims, evidence, crux, proposed direction, shipping surfaces, exclusions, requirements, criteria, definitions, rules, constraints, objectives, measures, readings, unknowns, decisions, risks, overrides, settled interpretations, consequences, engineering investigations, scope lines, learning questions, and experiment branches.

No entry type would be mandatory merely because it exists.

Each entry would support:

- Stable ID and natural-language content.
- Proposed, tested, settled, unsettled, superseded, rejected, or open status.
- Evidence label where relevant.
- Source and transcript references.
- Owner where relevant.
- Rationale and revisit condition.
- Links to related entries.
- Version and correction history.
- Model or user attribution.

### 5.3 Evidence

Material claims would carry **observed**, **reported**, or **assumed**. The model would propose the label and explain why; the user could correct it. A precise number spoken by the user would remain reported unless the tool had independently observed it. The label would influence visibility and interrogation priority but would never gate progress.

### 5.4 Unknowns and decisions

Unknowns would be first-class entries rather than null values. Each would describe what is unknown, why it matters, what it affects, whether it is acceptable, its owner, intended resolution, and decision consequences. Readiness would begin with these entries automatically.

Decisions would retain alternatives, rationale, evidence, accepted risks, user overrides, revisit conditions, and linked consequences.

## 6. Conversation design

### 6.1 Opening and turn shape

The landing screen would ask:

> What are you considering building?

Each turn would show a **Drawing this out** or **Pressure-testing** badge, one concise reason, one pointed question, and persistent actions written in the user's voice:

- “I'll defend this.”
- “Workshop this with me.”
- “Flag it and move on.”

Relevant content would also offer “You heard me wrong.” Assistant turns would stay within two or three short paragraphs. The posture, reason, and actions are supporting interface chrome, not a license for a dense turn: the reason should ordinarily be shorter than the question, and secondary actions should remain visually quiet until needed.

### 6.2 Defend, override, and workshop

- **Defend:** assess the answer, acknowledge it and move on when it holds, or push once more when it hand-waves.
- **Override:** record the unresolved point, tool objection, user decision, reason, and accepted risk; then continue.
- **Workshop:** switch to drawing-out, offer a few distinct framings, let the user form a claim, then switch back to pressure-testing it.

### 6.3 Corrections

“You heard me wrong” would generate a proposed record patch and a semantic diff showing removed wording, new wording, affected entries, and invalidated consequences. Approval would supersede the old version, unsettle dependent material, update interviewer context, and invalidate stale derivations.

“I never said that” on a derived consequence would reject the consequence, preserve it as diagnostic history, mark its source unsettled, identify the unsupported assumption, and route the exact ambiguity back into phase 2.

## 7. Phase 2 — Defining

I would build this phase first.

### 7.1 Product direction and shipping surface

The interviewer would attempt to produce one plain statement of what the product does for a person, link it directly to the problem and crux, and record significant exclusions with reasons. It would explicitly establish what reaches a person or consumer this cycle—web app, CLI, API, library, mobile app, document, report, pipeline output, or another emerged surface—with one testable sentence per shipping surface.

### 7.2 Ambiguity lenses

The assessor would activate lenses semantically:

- **State:** statuses and lifecycle.
- **Time:** dates, periods, cutoffs, expiry, or late arrival.
- **Identity:** attribution, authorship, audit, or person-specific behavior.
- **Ordering:** chronology, queues, replay, concurrency, or event order.
- **Absence:** missing, deleted, optional, incomplete, or nonexistent values.
- **Duplication:** retries, repeated submissions, imports, or sameness.
- **Permission:** roles, visibility, sensitive actions, or restricted access.
- **Failure:** external dependencies, partial actions, retries, and recovery.
- **Limits:** quotas, thresholds, capacity, minimums, maximums, and rates.
- **Words:** disputed or overloaded nouns.

Each lens would begin with a question that can close the branch with a one-line “no.” The interviewer could also pursue ambiguity no existing lens covers; those discoveries would be logged as candidates for future craft.

### 7.3 Requirement formation

Requirements would emerge from settled conversation and failed artifact attempts. Distinct craft units would react to multiple capabilities, vague qualities, weak necessity, embedded rationale, implementation-specific nouns, system-property phrasing, missing actors, universal criteria, behavioral detail hidden in notes, new terminology, or ambiguous requirement type.

The experience pass would run only after experience-facing requirements stabilize, turning lived claims into measurable criteria such as completion time, visible-response time, recovery steps, operability conditions, or required equipment.

### 7.4 Scope and measurement

The user would write one quotable scope sentence. The system would identify commitments clearly inside, clearly outside, ambiguous, excluding the crux, or effectively including everything, then challenge only the highest-impact inconsistency.

With a named crux, the tool would form a durable objective, timeless outcome measures, leading indicators, counter-measures, and dated expected readings with baselines, targets, timeframes, and committed or aspirational status. It would challenge activity metrics, measures aimed away from the crux, readings dependent on out-of-scope work, and measures with no production path. It would describe instrumentation work without inventing hour or currency estimates.

### 7.5 Readiness

Readiness would start from unresolved unknowns and deriver confusion. The user could resolve each material issue, assign an owner, leave it explicitly open, route it to engineering investigation, or accept the risk.

The system would separate product-owned decisions and constraints from engineering-owned implementation choices. When the artifact attempt exposes no material gap, it would state, “I believe this is everything a team needs to start,” and launch phase 3 to test that claim.

### 7.6 BUILD-TO-LEARN variant

In this path, the record would center the learning question, why building is the cheapest valid way to learn, minimal thing to ship, required instrumentation, possible results, decisions following each result including an inconclusive result, owner, and exclusions. Anything not serving the learning question would be challenged.

## 8. Phase 3 — Reacting

I would build this alongside phase 2 rather than treating it as downstream polish.

### 8.1 Derivation round

A derivation round would freeze a record version and ask the context-isolated deriver to inspect rules, definitions, edge cases, behavior, measures, system properties, thresholds, and cross-entry relationships.

Each consequence candidate would include source IDs, claim kind, concrete scenario, derived result, record material used, assumption introduced, missing information, confidence, whether an interpretive choice was required, suitable rendering, and why a developer could stumble.

### 8.2 Consequence selection and rendering

The product would prioritize derivations requiring unstated choices, load-bearing rules, cross-entry interactions, boundary cases, and claims whose clarity breaks in a concrete example. It would not ask the user to approve an example for every requirement.

The rendering would match the claim:

- Rules and edge cases become worked examples.
- Screen flows become state sequences or lightweight mockups.
- CLI behavior becomes command transcripts.
- APIs and libraries become example calls and results.
- Pipelines become sample input and output.
- Measures become sample readings with production paths.
- System properties become thresholds with verification methods.

### 8.3 Per-consequence reaction

Each reaction card would display the scenario, expected behavior, “the record says” provenance, “I assumed” provenance, unspecified information, and source entries. The user could confirm, change, reject, or leave it unresolved.

- Confirmation would store a first-class settled interpretation.
- Change would show a diff, revise sources, invalidate dependents, and return the piece to phase 2.
- Rejection would preserve the diagnostic, mark the source unsettled, and route the unsupported assumption back into the interview.

A round with no record changes would be reported as convergence. The user could stop earlier, with unresolved material stated plainly in the output.

## 9. Phase 1 — Vetting

I would add vetting after the defining/reacting loop works.

The interviewer would seek enough substance to attempt a recommendation stating the specific person and situation, problem, value, why now, evidence, named crux, and whether the intended direction targets the crux. A solution-first opening would be treated as a proposed intervention and would not anchor the diagnosis.

The artifact engine would attempt a reasoned recommendation and use the largest failure in that argument as the next question. Vetting would end in exactly one outcome:

- **BUILD:** proceed to defining with the case and crux retained.
- **LEARN:** produce the uncertainty, method, owner, possible outcomes, and decision branches.
- **BUILD-TO-LEARN:** proceed to an experiment-centered defining phase.
- **END:** preserve what was tested, what failed, and what would justify revisiting it.

The tool's recommendation and the user's decision would remain separate. An override would preserve both positions and the user's reason.

## 10. Output design

Every output would be generated from the record and begin with status, recommendation, date, readiness or convergence statement, important unresolved items, and overrides.

### 10.1 Build-ready proposal

Where relevant content emerged, the document would include:

1. Executive summary.
2. Problem and affected person.
3. Named crux.
4. Evidence and labels.
5. Product direction and link to the crux.
6. Shipping surfaces.
7. Scope line, commitments, and exclusions with reasons.
8. Requirements and acceptance criteria.
9. Rules, definitions, and settled interpretations.
10. Worked examples and experience thresholds.
11. Objective, measures, counter-measures, and expected readings.
12. Measurement-production implications.
13. Product-owned constraints and engineering investigations.
14. Unknowns, owners, risks, and overrides.
15. Decisions, alternatives, rationale, and revisit conditions.
16. Reaction-round history and readiness statement.

Sections would appear only when content exists; their absence would not imply an incomplete field.

### 10.2 Other outcome documents

- A **LEARN** output would center the blocked decision, learning need, method, owner, and positive, negative, and inconclusive branches.
- A **BUILD-TO-LEARN** output would center the learning question, minimal intervention, instrumentation, result interpretation, and experiment-specific readiness.
- An **END** output would preserve the original idea, premise tested, evidence, failure in the case, current recommendation, and revisit conditions.
- A **JSON export** would preserve stable IDs, relationships, statuses, evidence, provenance, owners, criteria, unknowns, derivations, and overrides for agent consumption.

## 11. Retention, resumption, and transparency

Every user action, model response, patch, and reaction would autosave. A returning user would see the phase, last settled decision, most consequential open issue, changes since the last visit, pending consequences, and one proposed next question.

From the first release, the system would retain transcript events, record versions and diffs, craft activations, trigger reasoning, model calls, context manifests, derivation rounds, corrections, overrides, exports, prompt/model versions, latency, and call counts. A purpose-built run-review screen would be deferred; raw stored data and developer-level inspection would be sufficient until the interview quality is proven. Store everything from day one and build the viewing tools later.

Consequential model judgements—including posture, craft activation, challenge choice, sufficiency, readiness, engineering routing, assumptions, convergence, and rare proposed blocks—would be visible and stored. Application code would validate structured model decisions; it would never infer control flow by parsing generated prose.

If the model proposed blocking, it would have to name the action, concrete likely failure, why recording is insufficient, minimum unblock condition, override availability, and override consequences.

## 12. Testing and evaluation

### 12.1 Craft and sequence tests

Every craft unit would have direct-trigger, paraphrased-trigger, non-trigger, competing-trigger, suppression, and observable-behavior tests. Required seeds would cover inversion, ownability, timelessness, atomicity, and experience quantification.

Domain-varied scenarios—a static document, CLI, multi-actor workflow, pipeline, mobile app, API-only product, weak solution-first idea, and strong evidence-backed problem—would prove that question sequences differ materially and irrelevant lenses remain dormant.

### 12.2 End-to-end behavior tests

The suite would verify that:

- Weak premises can reach LEARN or END.
- Strong premises reach BUILD without manufactured obstruction.
- BUILD-TO-LEARN changes scope and readiness behavior.
- Unknowns propagate into readiness and output.
- Overrides preserve both positions.
- Scope lines including everything or excluding the crux are challenged.
- Requirement craft fires at the correct moment.
- Measures remain distinct from dated readings.
- The system works for products without user interfaces.

### 12.3 Deriver and reaction tests

Tests would prove that transcript content cannot enter the deriver input, interview-only facts are unavailable unless recorded, deleting a record entry affects its derived consequences, rejected consequences unsettle their sources, corrections feed into later interviewer behavior, and zero-change rounds report convergence.

A negative integration test would place a critical fact only in the transcript and verify that the deriver cannot use it.

A reconciler-divergence integration test would make the reconciler reshape a change the interviewer proposed, then verify that the next interviewer turn follows the authoritative record rather than its own previous wording. Another test would verify that content with no clean entry type is retained under the visible “did not fit” outcome rather than silently forced into a nearby type.

### 12.4 Suite integrity

CI would publish and enforce the number of fixtures discovered and executed, craft units with tests, and integration wiring exercised. Full mutation-testing infrastructure would be deferred until the interview is demonstrably good; the first release would use a small number of hand-written negative integration tests for critical connections such as record-to-deriver isolation, correction feedback, and unknown propagation.

Judgement-based evaluation would combine human-authored expected behavior, deterministic state assertions, a separately configured evaluator, periodic human review, and real developer handoffs. The component under test would not grade itself.

## 13. Destination-test program

During development, the record-only deriver would act as a standing developer proxy, identifying decisions, terms, relationships, criteria, measures, and scope that still require interpretation.

For real handoff evaluation, I would freeze an output, give it without the transcript to a developer or capable agent, ask them to begin, capture every clarification, classify the source of each gap, and track the question count across product versions.

Where historical material is available, I would compare the tool's questions with clarifications a real team actually asked. This would measure how many known implementation blockers the interview surfaced before handoff without rewarding irrelevant interrogation.

## 14. Product-improvement observability

Reviewable run data would include craft considered and activated, lenses opened and closed, challenges defended or overridden, workshop selections, unknowns created and resolved, semantic rejections, derivation guesses, reaction rounds, outcomes, session depth, and developer clarification counts.

The review view would answer which craft never fires, which fires without changing behavior, where users override, where sessions stall, which assumptions are rejected, and which output gaps cause developer questions. This evidence—not an invented universal schema—would determine future structural additions.

## 15. Delivery sequence

### Stage 0 — Behavioral corpus and architecture

Extract the small always-loaded kernel, divide craft into versioned units, write trigger and counterexamples, create cross-domain fixtures, define record/transcript and deriver boundaries, build the model gateway, and prove selective activation—especially inversion and ownability—in a minimal harness.

### Stage 1 — Thin phase 2 interview loop

Build session creation, the crude single-question opener (“What are you considering building?”), captured response, direct transition into defining, posture, three response paths, conditional trigger assessment, craft loading, interviewer, transcript retention, conditional/batched reconciliation, evidence labels, unknown capture, basic record inspection, resumption, and the per-turn latency/call-count readout. This opener does not diagnose, recommend, or choose among the four vetting outcomes; Stage 5 will replace it.

At the end of Stage 1, run one real product problem that someone actually wants built from the crude opener through the available defining loop. Retain the transcript, record, activations, manifests, turn timings, call counts, and observed failures as the baseline for later stages.

### Stage 2 — Generative readiness

Add artifact attempts, gap detection, highest-consequence question selection, requirement and criterion handling, scope, measurement, readiness, and the product/engineering boundary.

### Stage 3 — Isolated phase 3

Add frozen record snapshots, deriver-only input construction, worked consequences, provenance, individual reactions, semantic rejection, correction diffs, return-to-phase-2 routing, correction feedback, convergence reporting, and first-release Markdown and JSON exports.

At the end of Stage 3, run the same real product problem again from the crude opener through defining and reaction. Compare its record, derivation gaps, corrections, latency, and developer clarification questions with the Stage 1 baseline.

**The first release ends here.** It consists of Stages 0–3 plus Markdown and JSON export. It retains all raw activations, context manifests, record versions, model-call telemetry, and derivation rounds needed by later evaluation and viewing tools.

## Deferred sequence after interview quality is demonstrated

The remaining stages begin only after real Stage 1 and Stage 3 runs show that the interview asks useful questions and the reaction loop catches consequential gaps.

### Stage 4 — BUILD-TO-LEARN

Add learning-question scope, experiment measures, instrumentation readiness, outcome branches, and experiment-specific output.

### Stage 5 — Vetting

Add problem-first diagnosis, evidence, crux, recommendation attempts, all four outcomes, overrides, and outcome-specific artifacts.

### Stage 6 — Output and export

Add specialized developer-start, learning, and END layouts plus printable PDF with explicit unresolved-state rendering. Markdown and JSON already ship in the first release.

### Stage 7 — Evaluation and run review

Add a built run-review surface, craft activation review, prompt/model comparisons, deriver confusion reports, handoff question capture, historical evaluation, mutation-testing infrastructure, and product-quality reporting. The underlying data has been retained since Stage 1.

### Stage 8 — Hardening

Complete export reproducibility, backup and restore, accessibility beyond first-release keyboard basics, long-session performance work, richer provider-failure handling, and archive/deletion controls. The first release provides a clear provider error rather than a recovery subsystem and does not introduce a database migration program for this single-user local tool.

## 16. First production release

The first production release would include:

- Single-user responsive workspace.
- Persistent, resumable sessions.
- A crude one-question entry point followed directly by phase 2; full phase 1 vetting remains deferred.
- Triggered craft and ambiguity lenses.
- Requirement craft, including inversion and ownability.
- Declared postures and the defend, override, and workshop paths.
- Evidence labels, unknown ownership, scope, and measurement interrogation.
- Artifact-attempt completion rather than checklist completion.
- Context-isolated deriver and worked examples.
- Per-consequence reaction, correction diffs, and semantic rejection loop.
- Convergence reporting.
- Retained transcript, record versions, craft activations, context manifests, derivation rounds, and per-call telemetry, accessible through developer-level inspection rather than a dedicated review product.
- Markdown and JSON export.
- Keyboard-operable core interactions and a clear provider-error state.
- Behavioral, isolation, reconciliation-divergence, and negative integration tests without a full mutation-testing platform.

PDF, specialized output layouts, a built run-review surface, full mutation-testing infrastructure, extended accessibility work, backup and restore, archive and deletion, and sophisticated provider recovery are explicitly outside the first release. PostgreSQL remains acceptable if it is the fastest implementation path, but the release would not spend time on a migration story for a single-user local tool.

The release would prioritize interview and reaction quality over visual polish. Its central acceptance criterion would be that record-only readers ask fewer clarifying questions, and that every remaining question can be traced to a missed interrogation, record gap, derivation gap, or rendering loss. Its operating constraint would be that the median turn remains at or below three seconds with call count and latency visible throughout development.
