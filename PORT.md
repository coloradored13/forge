# Port checklist

SPEC.md §7, as work. v1 is `~/Dev Team` (github coloradored13/Dev-Team), archived read-only as the evidence corpus. Nothing is ported by copying a directory; each item is re-homed under one half with an `owns:` header, its v1 evals either re-cut into one of the ten or left behind.

Check an item only when its eval is green in this repo. The v1 path is the source; the target is where it lands here.

## Port as code — leaf, proven

| v1 | lands in | milestone | done |
|---|---|---|---|
| `tools/hash.mjs` — chain and pins | `shared/hash.mjs` | M1 | [x] |
| `tools/run.mjs` door table + `flagsAfterStart` | `delivery/state/` — seed of the transition table | M2 | [x] |
| `tools/judges.mjs` — `deriveVerdict`, `verdictFreshness`, `renderFindingsForAgent` | `shared/judge/` | M1 | [x] |
| `tools/stage.mjs` + `tools/usage.mjs` — the agent-call chokepoint | `shared/agent-call/` | M1 | [x] |
| `tools/provenance.mjs` + verifier | `delivery/release/` | M3 | [ ] |
| `tools/containment.mjs` | `delivery/build/` | M3 | [ ] |
| `tests/browser` | `delivery/qa/` | M3 | [ ] |
| prompt `prototype` (identity half only) | `discovery/prototype/` | M1 | [x] |
| prompts `uxd-writer`, `uxd-judge` (identity halves; the declared-standard pattern, §10.6) | `discovery/design/` | M1 | [x] |
| prompts `sdd-writer`, `sdd-judge` (identity halves) | `delivery/sdd/` | M2 | [x] |
| prompt `dev` (identity half — the largest upgrade; containment lines drop, they are mechanical) | `delivery/build/` | M3 | [ ] |
| prompt `acceptance-oracle` (identity half) | `delivery/qa/` | M3 | [ ] |
| `lib/workshop.ts` + `app/api/{chat,extract}/route.ts` — grows shape and the MVP line; the `Capture:` enumerations become generated mechanics | `discovery/workshop/` | M1 | [x] |
| eval `coherence` | `evals/coherence.mjs` | M1 | [x] |
| eval `provenance` | `evals/provenance.mjs` | M3 | [ ] |
| eval `door-table` | folded into `evals/transition-table.mjs` | M2 | [x] |
| eval `module-graph` | folded into `evals/coherence.mjs` | M1 | [x] |

## Redesign

| item | rule | milestone | done |
|---|---|---|---|
| The story judge → a reviewer at the PM's bar | R13 | M1 | [x] |
| Intake: diff, compile, slice, ask — new | R13, R14 | M2 | [x] |
| The state machine and liveness | R9 | M2 | [x] |
| Amend with blast radius | R4 | M1 | [x] |
| Answers that write criteria | R3 | M1 | [x] |
| Staleness as re-judge | R5 | M2 | [x] |
| Ranked judges | R7 | M1 | [x] |
| Setup with estimate, both halves | R1 | M1, M2 | [x] |
| Project repo at Discovery setup (create or attach; refusals) — new | R11, R14 | M1 | [x] |
| Delivery read containment: no `discovery/` reads, tool uses recorded — new | R14 | M2 | [x] |
| Workshop reads the repo and manifest before its first question (brownfield) — new | R11 | M1 | [x] |
| Tracker export (GitHub Issues, Jira) — new | — | M1 | [x] |

## Stays behind

Not ported. Listed so nobody "rescues" one under pressure.

- Lazy reconcile and every raw reader of run state
- The contract stage; tickets as a stage; the prototype as a chain link
- At least 19 of 29 eval suites; drift rules that duplicate a judge
- The answers ledger as a rail separate from the contract
- `_shared.md` — replaced by the generated mechanics half (§6)
- v1 itself

## Deferred to M6

- License (Apache-2.0 per the v1 plan) and README truth pass — added when the repo goes public, on the user's word.
