# D05 validation artifact (PR #65)

This folder holds Claude's reference implementation of D05 as a patch, the mutation runner, and its case manifest, so the results in PR #65 can be reproduced independently. It is evidence for review, not the implementation PR. This branch changes no production code, and it is not meant to be merged.

## Contents

| File | What it is |
|---|---|
| `reference.diff` | Claude's reference D05, a patch to production code only (5 files under `discovery/`; nothing under `evals/`, no SPEC) |
| `mutants.py` | the runner; it applies the reference, then each wrong version, in its own detached worktree |
| `manifest.json` | the 47 cases: `id`, `wrong_behavior`, `source` (the design clause), and the exact `patches` (old → new text in the named file) |
| `results-claude-0456fec.json` | Claude's run against `0456fec` |

## Pinned versions

- **Tests head:** `0456fecfb37bec91ffe109df0561c58577cea330` (`test/dh1a2-d05`). The runner's `BASE` defaults to this SHA.
- **Claude's run:** macOS, Node v22.22.0, npm 10.9.4, Python 3.14.3. The dependencies come from the repo's `package-lock.json` through `npm ci`. The runner uses only the Python standard library.

## Commands

```sh
git fetch origin validation/d05-reference test/dh1a2-d05
git switch --detach origin/validation/d05-reference
npm ci
# 1. The reference alone: expect discovery-readiness 64/64 and every suite passing.
git worktree add --detach /tmp/d05-ref 0456fecfb37bec91ffe109df0561c58577cea330
(cd /tmp/d05-ref && git apply "$OLDPWD/validation/d05/reference.diff" && ln -s "$OLDPWD/node_modules" node_modules \
  && node evals/discovery-readiness.mjs && npm run evals)
git worktree remove --force /tmp/d05-ref
# 2. All wrong versions (about 15 minutes at -j 3); writes validation/d05/results.json
python3 validation/d05/mutants.py -j 3
# One case only:      python3 validation/d05/mutants.py --only H11,A15
# The case list:      python3 validation/d05/mutants.py --manifest
```

The runner aborts if the reference does not pass discovery-readiness 64/64 and every suite. A case counts as **rejected** when discovery-readiness fails, when a suite that passes on the reference fails, or when a suite shows a FAIL label the reference does not. After each case the runner restores the files, checks that `git diff` is byte-identical to `reference.diff`, and reruns discovery-readiness on the restored tree.

**Checking that a case fails for the intended reason.** Each result records the failing checks under `failing`. A rejection whose only failures are unrelated suites, or a syntax error, would be suspect. Each patch was checked with `node --check` when it was written.

## Claude's results at `0456fec`

46 of 47 rejected. The reference passes 64/64 and 19/19 suites.

| Case | Result | Wrong behavior |
|---|---|---|
| A01 | rejected | readiness counts an agreement to this PRD's hash as current whatever prototype it agreed to |
| A02 | rejected | stories-stale compares only the PRD hash; a rebuilt prototype does not stale the stories |
| A20 | rejected | stories-stale compares only the prototype hash; a moved PRD does not stale the stories |
| A21 | rejected | design-stale ignores the PRD trace (prototype and stories only) |
| A03 | rejected | design-stale ignores the stories trace (PRD and prototype only) |
| A04 | rejected | design-stale ignores the prototype trace (PRD and stories only) |
| A05 | rejected | stories/design freshness by version label: current while traces.prd.version equals the PRD's version |
| A06 | rejected | readiness matches an agreement by PRD version label instead of the PRD and prototype hashes |
| A07 | rejected | design-stale is reported for every exit, so a team cannot take a stale design |
| A08 | rejected | design-stale blocks only delivery; the 'both' exit lets a stale design through |
| A09 | rejected | exportHandoff does not pass the exit to readinessOf, so a team is judged as Delivery |
| A10 | rejected | readiness(root) with no exit reads as the team's gate and omits design-stale |
| A11 | rejected | checkDesign is skipped for the team exit, so screen-undesigned no longer blocks a team |
| A12 | rejected | readiness picks no-agreement whenever no agreement names this PRD hash (write() says agreement-stale) |
| A13 | rejected | freshness findings are medium severity (the verdict advises instead of blocking) |
| A14 | rejected | freshness findings are high but only 'likely' (the verdict advises instead of blocking) |
| A15 | rejected | every freshness remedy restates the problem (the summary) and names no next step |
| A16 | rejected | agreement remedy drops the rebuild step: 'Agree to the PRD and the prototype.' |
| A17 | rejected | the agreement finding is raised only once stories exist; a prototype with no agreement and no stories reads as |
| A18 | rejected | the shared agreement rule ignores the prototype hash (write() and readiness both accept an agreement to an old |
| A19 | rejected | a team exit skips the agreement and stories-stale checks too (team takes everything as it stands) |
| A22 | rejected | stories/design count as current while every screen id they reference still exists in the prototype (id joins,  |
| A23 | rejected | readiness reports one code, agreement-stale, for every agreement gap (write() still says no-agreement when non |
| A24 | rejected | write() refuses agreement-stale for every gap, so the stories door and readiness disagree when no agreement wa |
| A25 | rejected | a team export re-stamps the stale design's traces to the current record inside the handoff, hiding that it is  |
| A26 | rejected | freshness is checked only at the export door (an exit named); readiness(root), the console's gate view, omits  |
| A27 | rejected | every freshness finding names prd.id as its subject, not the stale stories or design |
| A28 | rejected | design-stale remedy names the wrong next step: re-review and re-sign the design (a sign-off never changes its  |
| A29 | rejected | design-stale is keyed on the sign-off (signed on this exact version) instead of the design's traces |
| H01 | rejected | stories write keeps no history copy; a refresh destroys the old backlog |
| H02 | rejected | the design writer keeps no history copy |
| H03 | rejected | history keyed by the document's content hash instead of the sha256 of the saved bytes |
| H04 | rejected | history key uses the first 16 hex of the sha256, not 12 |
| H05 | rejected | history copy is the record re-serialized as compact JSON, not the saved bytes |
| H06 | rejected | prototype JSON/HTML pair archived after the builder call, when the HTML is already overwritten |
| H07 | rejected | prototype history keeps the JSON only, not the HTML |
| H08 | rejected | the archived HTML is keyed by its own bytes rather than beside the record under the record's key |
| H09 | rejected | history keeps only the newest copy per kind; the second refresh deletes the first copy |
| H10 | rejected | history keeps only the first copy per kind; later outgoing copies are dropped |
| H11 | **survived** | a copy whose key already exists is never overwritten (reference overwrites); under whole-file keys the same ke |
| H12 | rejected | stories history copy taken after saveDoc, so it archives the incoming backlog |
| H13 | rejected | stories history files are named by the schema id, discovery/history/story-<key>.json |
| H14 | rejected | stories history copy skipped when the backlog's content is unchanged (only traces moved) |
| H15 | rejected | the design writer keeps the outgoing design only when it was signed; an unsigned draft is overwritten with no  |
| H16 | rejected | stories and design keep the outgoing copy only when it is stale; a rewrite under the same PRD/prototype/storie |
| H17 | rejected | design history copy taken after saveDoc, so it archives the incoming design |
| H18 | rejected | history keyed by kind only (discovery/history/<kind>.json), so every copy overwrites the one before |

## H11: why it's equivalent

H11 never overwrites a history copy whose key already exists, while the reference overwrites. The key is the first 12 hex digits of the sha256 of the outgoing file's whole bytes. So a copy under an existing key holds the same bytes, unless two different files share a 48-bit prefix, and skipping or overwriting leaves an identical file.

The versions of "a second refresh loses the first copy" that do lose data are separate cases, and all were rejected:
- H03: keyed by content hash;
- H09: deletes the older copies;
- H10: keeps only the first copy.

A test could tell H11 apart only by forcing a prefix collision, which isn't feasible.
