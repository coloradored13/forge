# M0: D01 and D02 red-test evidence

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

The plan incorporates the unambiguous owner revisions: move launch/setup recovery into M1; split M1 into scripted core logic and then console/package/isolation; agree size caps before each milestone; stop above a 50% overrun.

The owner said they would supply corrections to the truncated text for revisions d–h. Those interpretations remain pending. They must be resolved in the plan before later implementation; this M0 does not implement staging, launch, browser suites, export changes, or agent/human evaluation changes.

Stop here for owner review. No fixes are part of this PR's M0 authorization. Live-model evaluation is scheduled separately.
