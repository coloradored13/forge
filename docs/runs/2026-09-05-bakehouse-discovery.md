# Run report — Bakehouse through Discovery (M1 PR7)

**Date:** 2026-09-05 · **Record:** `~/Forge/bakehouse` (github coloradored13/bakehouse, private) · **Pipeline:** forge main `84a4a0e` · **Models:** every role `claude-opus-5` · **Exit:** team, GitHub tracker · **Cost:** $28.01 over 53 model calls.

The pipeline is the goal; Bakehouse is the test case that exercises it. This is the first run of the Discovery half on real model calls against a real product. The v1 Bakehouse PRD was handed to the workshop section by section as the PM's statements rather than re-litigated, so the measurement is how much of a finished PRD survives the interrogator, and what the stages downstream do with it. Product-content decisions were delegated to the PM seat (Claude, for Brad); every change to the record went through a door — no hand edits, no hash edits, no gate bypasses.

## The run in numbers

| Stage | Calls | Cost | Outcome |
|---|---|---|---|
| Workshop (6 sections) | 35 | $5.38 | PRD v0.1.0 → 21 requirements (REQ-15 past the line), 20 inside; shape-first gate lifted after 5 shape turns |
| Prototype | 1 | $1.80 | 16 screens in one HTML file (SCREEN-16 scaffolding — see F11/F16); `prototype-arithmetic` PASS |
| Stories | 10 | $9.84 | 5 write/review rounds → 14 epics / 24 stories; stopped at ADVISE/4 by PM rule; 2 PRD rulings (RUL-1, RUL-2) via `answer` → PRD v0.3.0 |
| Design | 7 | $10.99 | 3 write/review rounds (BLOCK/5 · BLOCK/5 · ADVISE/5) → 15 screens, signed with 5 residual |
| Export | 0 | $0 | `export-ready` PASS (149 checked) → handoff v1, 76 items → 44 GitHub issues, zero refusals |

Handoff v1: 20 requirements · 1 surface · 2 rulings · 14 epics · 24 stories · 15 screens, each hashed. Tracker: 20 requirement issues (labels `epic, REQ-n`, acceptance criteria, trace to PRD `v0.3.0 243d6655b0dc` + handoff v1) and 24 story issues (`Part of #<epic>`, labels `REQ-n, story, SCREEN-n, STORY-n`, gherkin per scenario, same trace). Keys written back onto the record; `handoff-v1.md` renders the whole snapshot for a human.

The two reviewer loops are 74% of spend.

## Findings

Status key: **FIXED** (merged mid-run under the blockers-only rule) · **PR** (post-run single-concern candidate) · **CATALOG** (ruling or trigger recorded, no change) · **HELD** (worked as specified) · **WITHDRAWN**.

### Workshop and PRD

1. **FIXED — the chokepoint was not isolated from the operator's Claude Code.** First real call: a one-sentence system prompt with zero tools cost 43,946 cache-creation tokens. SDK 0.3.261 with `settingSources` omitted loads the operator's settings, CLAUDE.md, hooks and every configured MCP server under the pipeline's identity. Fixed before the record existed: `settingSources: []`, `strictMcpConfig: true` on every call (PR #12, red-first in `economics`). Same call after: 1,286 input tokens. Invisible on fixtures — only a real call could find it.
2. **CATALOG — the extractor transcribes narrative into fields.** The crux field absorbed solution mechanics from the conversation; KR-3 absorbed an interrogator aside ("Noted by the interrogator as binding four gauges…") that is still on the record as evidence. Recurrence → ruling candidate for the extractor identity.
3. **CATALOG — the surfaces schema has no "cut" bucket.** Native app and API landed in `deferred` with an "Out of scope:" rationale because there was nowhere else to put them.
4. **CATALOG — invented ids are caught by arithmetic, but only at export.** My handover said "past the line: the reporting view, second station, barcode, native, API"; the schema pattern forced ids, the extractor minted `SURF-2..5`, and `checkScope` blocked with four `mvp-past-unknown`. No code fix (writer writes, gate finds); corrected through the door. But `mvp-line` runs only at export — three paid stages would have run on a line the gate blocks. Ruling candidate: join `checkScope` at the prototype door, or record the verdict at requirements extract.
5. **CATALOG — the readiness extractor wrote ownership into constraint strings.** Asked who owns each clock, the PM answered at the readiness section; the extractor owns `open_questions`/`constraints` there, not `shape.clocks[].owner`, so it recorded the answer where it could and the clocks stayed "unowned". The general form is F9.
6. **CATALOG — cost grows on resumed sections.** Short turns late in a section cost $0.21–0.31 as the transcript grew (cache misses); a six-turn requirements extract cost $0.89 vs $0.40 with cache.
7. **Driver only** — `est [object Object]` in the scratch driver's quote rendering. Not pipeline.
8. **HELD — what real calls found in the v1 PRD.** Shape gaps v1 never named: batch code after a write-off (→ mint counter, never reused within a bake day); a baker arriving before the roster (→ they add themselves; that is the morning touch); plan-item removal editing the yardstick (→ plan append-only, "withdrawn" replaces removal, end-of-day fulfilled | short, shortfall ≠ deviation); one reason list (→ two: batch reasons and plan reasons). Solution: no surface anyone reads completeness from while KR-1 committed ≥80% (→ counts panel). Requirements: retention orphaned in a constraint (→ REQ-21); REQ-11's unownable quantifier. Metrics: KR-1 a committed falsifier of an unproven theory (→ aspirational); missing candour counter; 30-day panel vs 90-day KR-3 (→ three non-overlapping readings, C8). R12 shape-first and the interrogator earned their keep on real content.
9. **CATALOG — cross-section rulings have no door.** A later section's answer that belongs to an earlier section's field (F5) has nowhere to land; the workshop's sections are write-once and the `answer` door serves only requirement criteria. Workaround used: re-open shape (turn + extract). Three redundant constraint strings remain on the record.
10. **CATALOG — `mvp-line` verdict is never recorded until export** (shows as "—" in the verdicts view through four stages).
11. **PR — `req-unaccounted` forces non-functional requirements onto a screen.** REQ-13/14/16 (offline, no external reach, zero-install) have no screen; the builder invented SCREEN-16 "Bench check" scaffolding and the gate counted it as coverage. See F16 for the chain.
12. **HELD — PRD moved after the prototype; the staleness badge recorded it; the PM decided not to rebuild.** The prototype found a PRD defect (REQ-2/AC-3 "previous day's names" wrong across skipped days); corrected through the requirements door; export does not enforce staleness. Worked as designed.
13. **CATALOG — extract cost.** Requirements extract $0.40 with cache vs $0.89 without.
14. **CATALOG — PRD version never bumps on re-extract.** 0.1.0 through the whole workshop, including corrections; the first bump came from `answer` (F21).
15. **Product note** — one shared batch-reason list for flags and write-offs under an 8-item cap; head baker owns contents. Design-level, no PRD change.

### Prototype, stories, design

16. **PR — gate asymmetry on requirement `type` is a chain.** Prototype `req-unaccounted` counts every inside requirement regardless of `type` (`discovery/prototype/index.mjs:116`); stories `requirement-without-epic` and AC coverage filter to `functional` (`discovery/stories/index.mjs:174`); design `screen-unclaimed` then blocks the scaffolding screen the prototype gate forced. Chain cost: SCREEN-16 built, one design rewrite ($1.59). Seen live a second way: the same `answer` door produced REQ-18/AC-3 (non-functional, no scenario required) and REQ-19/AC-5 (functional, readiness BLOCK until a scenario existed). `story.schema` says "every criterion inside the line is proved by a scenario"; the arithmetic enforces only functional ones. Remedy: one `type` filter in the prototype rule, red-first.
17. **CATALOG — the reviewer loop does not converge on its own; the brake is the PM.** Stories: passes 1–3 returned exactly k=5 findings each; severities ratcheted medium → high/likely → high/certain; two of pass 3's highs sat on surface created by pass 2's fixes; pass 3 was BLOCK — which gates nothing (only `design.signoff` reads a reviewer BLOCK). The reviewer has no memory of its prior pass (`splitReraised` matches PRD rulings, not prior findings) and reviews the whole backlog cold each time. STORY-21/AC-2 came back every pass with a wider demand. Same shape as v1's 16 rounds; the difference is that no door runs on it. PM error: rounds 2–3 accepted all five each time. The reviewer proposes; the PM disposes.
18. **PR — the k cap hides a backlog and blinds the funnel.** Mechanics prompt: "Return at most k… keep the k that matter most and let the rest go — the runner cuts to k and counts what it cut." The judge pre-cuts, so `rank()` never drops and `funnel.jsonl` was never created. Design review made the mechanism visible: three of pass 2's five findings sat on surface that existed in pass 1 — hidden behind the cap, never counted as dropped, surfacing five at a time. The PM cannot dispose of what the cap withholds. **User (2026-09-05): the cap is arbitrary — "if someone is using this they can choose to refute/move on."** Remedy: return everything in scope; the PM disposes; `rank()` and the funnel then measure something real.
19. **WITHDRAWN — I accused a judge of fabricating a quotation; it was verbatim from the record.** A story-review deferral quoted "the builder": "The second oven doesn't arrive until Q4; I built the multi-oven case because REQ-5/AC-4 names it." I searched the PRD, found nothing, and called it fabricated. The sentence is in `prototype.json` — the prototype builder's notes. The design reviewer quoted the same note later. Both judges cited the record accurately; the false accusation was the PM's, from an incomplete search. Evidence integrity in deferrals held on this run.
20. **CATALOG — `blocking: true` on backlog open questions has no mechanics.** Nothing reads it. The two blocking questions were real PRD contradictions the stories stage found (REQ-18 all-time tallies vs REQ-19 windowed panel; "trailing thirty bake days" undefined). A label without a gate.
21. **HELD — the `answer` door worked as specified.** RUL-1 → REQ-18/AC-3, RUL-2 → REQ-19/AC-5; version 0.1.0 → 0.2.0 → 0.3.0; readiness went BLOCK on the new functional criterion until one stories write picked it up; rulings rode into the composer (R3). Answering costs one stories regeneration (~$1.2) — by design.
22. **HELD — the composer refused part of a PM instruction, with reason.** I asked STORY-3 to keep a scenario proving REQ-1/AC-5 alongside another that already proved it; the composer declined (one criterion, one scenario), merged them, and said so in notes. The writer held the arithmetic over the PM's wording.
23. **CATALOG — cost shape.** Stories ≈ 35% and design ≈ 39% of the run. A design write costs $1.6–2.0 per regeneration regardless of change size (no patch path). Reviews $0.4–1.6. An interrupted call writes no ledger row (`call()` records on completion) — one killed design write's spend is invisible to the ledger.
24. **HELD — the declared-standard pattern (§10.6) earned its keep.** The design reviewer held the design to its own commitments ("ember spent on three things only" — found four more) and its own hero ("read from a metre back" — state word at 15px). It also caught the design deciding two undecided PRD questions in product copy — batch attribution after a claim, and "a yield of zero is impossible" — and both remedies were deletion, not a ruling. A boundary catch the arithmetic cannot make.
25. **CATALOG — door calls exceed tool limits.** A design write took 600s; write + review cannot share a 10-minute tool call; one write was killed mid-flight (no row, no document; re-run alone). Any driver — the console included — needs background execution with progress for the long doors.
26. **Cosmetic.** `review` returns a verdict without `usd`/`model` (driver prints `$?`). `story-arithmetic` `checked` = epics + stories + functional inside requirements (`stories/index.mjs:183`): it counts requirements while two of its rules check criteria, so adding an AC never moves it — a definition that undercounts the gate's own work.
27. **CATALOG — the loop converges when the PM's fixes are surface-neutral.** Design round 1 BLOCK/5 → remedies taken, but the PM's note ("15px stays for SCREEN-6 and SCREEN-14") was hardened by the composer into an exclusive reservation the screens then violated → round 2 BLOCK/5 with a high on that new surface. Round 3's five remedies were each one sentence or one CSS rule, no screen restructured, no commitment added → ADVISE/5, every finding on pre-existing surface, none created by the fixes. Signed with residual. Contrast stories (F17), where each round's fixes made new surface. The variable is the PM's instruction discipline, not the reviewer.
28. **HELD — export and the GitHub tracker worked first time, end to end.** No `tracker-error`, no `tracker-parent-missing`, no label 422. One asymmetry: requirement titles carry `REQ-n ·`, story titles don't (the id lives in label and trace) — searching the issue list by story id needs the label.
29. **Cost total: $28.01 / 53 calls** for a 20-requirement product with real judges, two PRD rulings, a signed design, and a tracker export — one afternoon of PM attention.
30. **CATALOG — the signoff override path has no live exercise.** `review-absent` and `review-blocked` refusals exist in code and evals; on this run the PM chose a third round over an override, so `override.reason` → PRD flag has not been walked on a real record. Trigger: the next BLOCK the PM judges acceptable.

## PM decisions on the record (product content, delegated)

- REQ-2/AC-3 corrected (four places a roster is offered; a carried roster labelled with its date). Prototype not rebuilt; the staleness badge records it.
- RUL-1: each lookup is one event stamped with its bake day, carrying nothing else; the three lookup counts are counts over the panel's trailing-thirty-bake-day window; no all-time total. RUL-2: a bake day is a day, by the bake-day boundary, with at least one batch started; the window is the thirty most recent bake days, today included once a batch has started, or every bake day so far when fewer exist; the panel states its window.
- Stories: stopped at ADVISE/4 twice (round 4; round 5 post-rulings). Residual on the fresh verdict. First-run scenario dropped; 13 non-blocking backlog questions ride to the team in the handoff.
- SCREEN-16 excluded from design by note.
- Design round 1: all five remedies taken. Round 2: user chose a third round over override; all five taken as smallest-change remedies; SCREEN-8's zero-yield refusal dropped — the PRD sets no minimum, so the design had no standing (no PRD change). Round 3: signed with five residual (ink-3 token wording; ink-3 contrast on WRITTEN OFF/WITHDRAWN — clears AA large-text at 22px/600, builder may lift to ink-2; SCREEN-12 missing state — copy SCREEN-11; mirrored glyph pair; SCREEN-9 hero prose). The signoff note carries the list.
- Export: team exit, GitHub tracker, handoff v1.

## What changes next

Post-run, each a single-concern PR with a red-first eval, CI green, merged separately:

1. **Prototype `req-unaccounted` filters to `type === "functional"`** (F11, F16) — the same filter stories and design already apply.
2. **Judges return everything in scope; the runner ranks and the PM disposes** (F18) — the mechanics prompt stops asking the judge to pre-cut; `rank()` and the funnel's `dropped` meter then measure a real thing. The user's position: no arbitrary cap.

Cataloged with triggers, not scheduled: `mvp-line` joined earlier than export (F4, F10); cross-section ruling door (F9); `blocking` on open questions (F20); ledger row for interrupted calls (F23); console background execution for long doors (F25); extractor identity on narrative (F2).

## Directives from the user during the run

- "You're technically part of [the loop]. If the brake is the PM, you're the brake. You decide when it's acceptable and not perfect to let it continue down the pipeline." Dispose each finding; do not accept all.
- "I'm okay not having an arbitrary cap. If someone is using this they can choose to refute/move on."
- Describe interruptions precisely: a killed in-flight call is one call lost, not a stage lost.
