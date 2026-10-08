# DH0 (originally M0): D01 and D02 red-test evidence

Review boundary: tests and documentation only. No application, schema, dependency, runner or existing helper changes. No live pipeline model calls. `docs/round-two.md` is superseded and was not used.

Branch: `codex/discovery-m0-red-tests`, created directly from fetched `main` at `f8ad980d1aa71d72f86fc62b83a1396010118ab6`. The stale `codex/provide-build-plan-based-on-md` branch was not used. The plan was committed first in `2e85da7`.

Draft review: https://github.com/coloradored13/forge/pull/58

## Scope and cap

The owner agreed to a cap of 160 added nonblank test/helper lines and a hard stop above 240. Application and schema changes are capped at zero; documentation is counted separately.

Actual test addition: [evals/discovery-loop.mjs](../evals/discovery-loop.mjs), 107 nonblank lines (113 total). Eight property/setup checks run: six pass and the two intended regressions fail. The file uses the normal root-level eval discovery, so the PR is intentionally red rather than hiding the regressions from CI.

## Evidence

| Run | Result |
|---|---|
| Unchanged-main baseline, `npm run evals` before adding tests | Exit 0; all 15 existing suites pass |
| Pristine archive of main at `f8ad980`, copying in only the new test | Exit 1; 6/8 checks pass, exactly D01 and D02 fail |
| Branch `npm run evals` with the new suite | Exit 1; 15/16 suites pass, with the new suite at 6/8 |

The red run reports completed assertions, not an abort, missing import, invalid fixture, browser failure, or network failure:

```text
FAIL D01 a blocking prototype question prevents the story call and artifact
     returned successfully; writer calls=1; stories persisted=true

FAIL D02 extraction cannot reverse a PM-ruled criterion while retaining its ID
     returned successfully; criterion=Cancellation is available after pickup.; ruling answer=No.

6/8 passed
```

D01's passing control has the same question with `blocking: false`; the violating example changes that flag to true. This prevents a future blanket refusal of all prototype questions from satisfying the test. Both generated prototypes and the passing backlog satisfy the existing arithmetic checks.

D02's passing control updates an unrelated context note while preserving the actual ruling and criterion. Its violating example preserves the same criterion ID and supplies schema-valid extraction output while reversing the accepted statement. The PM's ruling is created through the real `answer()` function, not by writing an expected record.

## Real steps exercised

Both examples begin with `setupProject()` and `openPrd()`, then `turn()`/`extract()` for shape and requirements. Shape completion comes from the scripted conversation signal; tests do not assign section state directly.

D01 then calls real `generate()` and real story `write()`. The fake model adapter emulates only the SDK's declared HTML `Write` operation; `generate()` itself creates the prototype record, hashes and verdict. No final prototype or backlog record is seeded to disk.

D02 calls real `answer()`, another workshop `turn()`, and real `extract()`. Every model invocation receives `scripted().query`; setup receives an inert executor rather than invoking Git or remote services. No browser is imported or installed by this suite.

## Reproduce on unchanged main

From the branch checkout with dependencies installed:

```sh
node evals/discovery-loop.mjs
# Expected exit 1 with exactly D01 and D02 failing.
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

The [handoff plan](discovery-handoff-plan.md) incorporates the owner's requested revisions using the complete feedback supplied in `brief-for-astra.md`: launch/setup recovery in DH1b, separate core and console PRs, agreed estimates and review stops, staged prototype output with no builder project-write access, real-step positive/negative tests, one Discovery flow, limited legacy export retention, hidden tracker export, separately invoked browser checks, and one cold human read at DH4. Milestone labels now use DH to distinguish earlier Forge milestones; branch/test filenames retain their original M0 names.

The attachment is review feedback, not blanket authorization for additional implementation. Its detailed DH0 fixture prescription differs from the already completed suite:

- The current suite uses one cancellation requirement and real setup/workshop/prototype functions. It does not add `seedBooking()`, change shared fixtures, or add unused vague/refined constants. The broader four-requirement fixture remains future acceptance work.
- D01 combines refusal, zero writer calls and no persisted story artifact in one check. It does not yet assert that the refusal names the blocking question, which the feedback explicitly requests. That assertion remains a test-strengthening item for review; the current red result establishes the missing gate, not the eventual quality of its explanation.
- D02's passing control changes an unrelated context field, not a different unruled criterion. It proves benign extraction remains possible but does not establish the feedback's stronger criterion-edit control. The violating case does preserve the ruled criterion ID and inspect the persisted decision and ruling after real extraction.

No tests were changed in response to the attachment, and no new test run is claimed for these documentation revisions. The evidence above remains the recorded result for the unchanged suite. This DH0 does not implement staging, launch, browser suites, export changes, or agent/human evaluation changes.

Stop here for owner review. No fixes are part of this PR's DH0 authorization. Live-model evaluation is scheduled separately.
