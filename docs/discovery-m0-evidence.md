# DH0 (originally M0): D01 and D02 red-test evidence

Review boundary: tests and documentation only. No application, schema, dependency, runner or existing helper changes. No live pipeline model calls. `docs/round-two.md` is superseded and was not used.

Branch: `codex/discovery-m0-red-tests`, created directly from fetched `main` at `f8ad980d1aa71d72f86fc62b83a1396010118ab6`. The stale `codex/provide-build-plan-based-on-md` branch was not used. The plan was committed first in `2e85da7`.

Draft review: https://github.com/coloradored13/forge/pull/58. It never merges by itself: DH1a branches from its head and reaches `main` with it (see the plan's merge order).

## History

- 2026-10-08, `2e85da7`–`072e89f` (Codex): the plan, a first D01/D02 suite of 8 checks, and this evidence.
- 2026-10-08, review (Claude): every claim held, but the first suite was too weak to gate DH1a (see [test strength](#test-strength)).
- 2026-10-08, follow-up commit (Claude): the 11-check suite and the plan, acceptance and workflow changes from that review. From this date the owner moved implementation from Codex to Claude; ChatGPT reviews through the owner.

## Owner decisions (2026-10-08)

- **Size:** the suite's 165 nonblank lines are approved against the 160-line cap. The hard stop above 240 still applies.
- **Fixture:** the narrowed fixture is accepted. D01 uses one cancellation requirement; D02 adds a returns requirement so that two requirements share the bare criterion id `AC-2`. Both are built through real steps. The four-requirement booking fixture and the vague/refined inputs move to the milestones that use them.
- **D02's design:** after the line is drawn, extraction may still edit unruled content; only ruled criteria are protected. Recorded in the [acceptance specification](discovery-acceptance.md)'s D02.

## Scope and cap

The owner agreed to a cap of 160 added nonblank test/helper lines and a hard stop above 240. Application and schema changes are capped at zero; documentation is counted separately.

Actual test addition: [evals/discovery-loop.mjs](../evals/discovery-loop.mjs), 165 nonblank lines (173 total), 11 checks, replacing the first suite's 107 nonblank lines and 8 checks. The file uses the normal root-level eval discovery, so the PR is intentionally red rather than hiding the regressions from CI.

## Evidence

| Run | Result |
|---|---|
| Unchanged-main baseline, `npm run evals` before adding tests | Exit 0; all 15 existing suites pass |
| Pristine archive of main at `f8ad980`, copying in only the new test | Exit 1; 7/11 checks pass, exactly the four intended checks fail |
| Branch `npm run evals` with the new suite | Exit 1; 15/16 suites pass, with `discovery-loop` at 7/11 |

The red run reports completed assertions after the suite reaches `done()`, not an abort, missing import, invalid fixture, browser failure, or network failure:

```text
FAIL  D01 a blocking prototype question stops the story call before it starts and leaves the records alone
      returned successfully; writer calls=1; stories persisted=true; prototype record unchanged=true
FAIL  D01 the refusal shows the PM the blocking question
      returned successfully
FAIL  D02 extraction cannot reverse a PM-ruled criterion: refused naming it, or held as a proposal
      returned successfully; REQ-2/AC-2=Cancellation is available after pickup.; ruling=RUL-1 → REQ-2/AC-2 "No."; contrary text applied=true; refusal names it=false; pending proposal=none
FAIL  D02 extraction cannot remove a PM-ruled criterion
      returned successfully; REQ-2/AC-2=undefined; ruling=RUL-1 → REQ-2/AC-2 "No."; contrary text applied=false; refusal names it=false; pending proposal=none

7/11 passed
```

## What the checks hold

**D01.** Both runs use the same project slug and the same two prototype questions, with a non-blocking question listed first; the only difference is the second question's `blocking` flag. The blocking run must be refused before the writer call starts: zero writer calls, no stories file, and `prototype.json` byte-identical. What the console renders for the refusal (`refusalHtml`) must contain the question. Either refusal class, `Refused` or `WorkshopRefused`, is accepted; the existing `no-line` and `no-prototype` refusals are not. The control must persist a backlog that passes story arithmetic.

**D02.** The PM rules through real `answer()`, which appends the decision to the cancellation requirement as `REQ-2/AC-2`. The follow-up transcript is seeded with `appendTranscript()`, so `extract()` is the only step under test. Every run's extraction rewords two unruled criteria — REQ-2's `AC-1` and REQ-1's `AC-2`, which shares the ruled criterion's bare id and is listed first — and edits REQ-2's context. The control must apply all of that and preserve the ruling. The contradict run also reverses `REQ-2/AC-2`; the remove run drops it. Each passes only if the ruling is preserved, the contrary text appears nowhere in `requirements`, `surfaces` or `mvp`, and either the refusal names `REQ-2/AC-2` or `RUL-1`, or a pending amendment whose `radius.criteria` names the criterion was minted. "Preserved" means the same `question`, `answer`, `by` and `criterion` and the same ruling count, so DH1a may annotate a ruling.

**A pre-existing hole the remove run exposes:** on `f8ad980`, dropping a ruled criterion succeeds and leaves `RUL-1` pointing at nothing. The `ids-dropped` check compares bare ids (`discovery/workshop/index.mjs:280-283`), so REQ-1's `AC-2` hides the drop.

**Setup** runs inside labelled checks. A setup failure prints named FAILs ("not run") instead of aborting, and the count stays 11.

## Test strength

These checks gate DH1a, so they must reject plausible wrong fixes as well as fail on main. Twenty-one wrong fixes and five right fixes were applied to `discovery/stories/index.mjs` and `discovery/workshop/index.mjs` in a pristine `f8ad980` archive, and both suites were run against each:

| | First suite (8 checks) | This suite (11 checks) |
|---|---|---|
| Wrong fixes rejected | 6 of 21 | 20 of 21 |
| Right fixes accepted | 4 of 5 | 5 of 5 |

Against the first suite, a generic "stories: blocked" refusal plus a silent freeze of every criterion made all 16 suites pass, and a correct D02 refusal thrown as the shared `Refused` class failed. The one wrong fix this suite misses applies a ruled change whenever the PM's own turn states it; that case belongs to DH1a's D03 tests. The fault-injection harness and its results are kept with the owner's review notes, outside this repository; a rerun against this commit's file matched them exactly.

## Real steps exercised

Both cases begin with `setupProject()` and `openPrd()`, then `turn()`/`extract()` for shape and requirements. Shape completion comes from the scripted conversation signal; tests do not assign section state directly.

D01 then calls real `generate()` and real story `write()`. The fake model adapter emulates only the SDK's declared HTML `Write`, carried out where the runner pointed the builder (`options.cwd`); `generate()` itself creates the prototype record, hashes and verdict. This is not containment evidence (D13). No final prototype or backlog record is seeded to disk.

D02 calls real `answer()`, seeds the follow-up transcript, and calls real `extract()`. Every model invocation receives `scripted().query`; setup receives an inert executor rather than invoking Git or remote services. No browser is imported or installed by this suite.

## Reproduce on unchanged main

From the branch checkout with dependencies installed:

```sh
node evals/discovery-loop.mjs
# Expected exit 1 with exactly the four checks above failing.
```

To prove the same behavior against the pinned main implementation, copy only the test into a clean archive:

```sh
set -o pipefail
baseline=$(mktemp -d /tmp/forge-m0-main.XXXXXX)
git archive f8ad980d1aa71d72f86fc62b83a1396010118ab6 | tar -x -C "$baseline"
ln -s "$PWD/node_modules" "$baseline/node_modules"
cp evals/discovery-loop.mjs "$baseline/evals/discovery-loop.mjs"
(cd "$baseline" && node evals/discovery-loop.mjs)
# Expected exit 1; this archive contains no application fixes.
```

## Plan review status

The [handoff plan](discovery-handoff-plan.md) incorporates the owner's requested revisions from `brief-for-astra.md`: launch/setup recovery in DH1b, separate core and console PRs, agreed estimates and review stops, staged prototype output with no builder project-write access, real-step positive/negative tests, one Discovery flow, limited legacy export retention, hidden tracker export, separately invoked browser checks, and one cold human read at DH4. Milestone labels use DH to distinguish earlier Forge milestones; branch/test filenames retain their original M0 names.

The follow-up commit applies the PR #58 review: the D13 builder-containment check now asserts on the builder's call options (the earlier wording already passed on `f8ad980`); all seven legacy-export consumer suites are named; DH1a's untested items move to DH2 and DH4; PR state moves out of the plan and acceptance documents into this file; and three items dropped from the original plan are restored (DH1b's agent-read pass condition, explicit migration of in-progress projects, and cost and outcome in live-run records).

Stop here for review. No fixes are part of this PR's DH0 authorization. Live-model evaluation is scheduled separately.
