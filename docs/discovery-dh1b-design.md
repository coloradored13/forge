# DH1b design: the PM runs the slice in a supported console

For review by ChatGPT (Dots) and Gemini before any tests or code. Base: `main` at `2406d92`.

**Scope.** Plan lines 77–97: launch from the README, then act as the PM through reaction to handoff in the console. Acceptance: D03's console and browser half, D05 in the console, D10, D13.

## Found while mapping the code

1. The Generate form's "notes to the writer" box sends feedback straight to the builder (`discovery/console/index.mjs:102`, `discovery/prototype/index.mjs:57`), bypassing D03's reaction and approval.
2. The prototype is served from the console's own origin with no sandbox (`discovery/console/index.mjs:216`, `shared/console/index.mjs:167`), so its script can post an approval as the console. No route checks `Origin` or `Host` (`shared/console/index.mjs:153–163`), so any other open page can post too, including setup, which creates a GitHub repo.
3. A failed build has already overwritten the published HTML (`evals/discovery-readiness.mjs:191–192` asserts it), while `react` and `agree` bind to the record's hash. Containment must come before the console's controls.
4. A failed model call's cost is recorded as $0 even when it is unknown (`shared/agent-call/index.mjs:231`).
5. One console request can run a model call repeatedly for up to 6 hours (`shared/agent-call/usage-pause.mjs:36`). Nothing serializes mutating actions, and only extract and react check for a late write (`discovery/workshop/index.mjs:80`, `discovery/doors/index.mjs:353`).
6. Eleven suites consume the legacy handoff, not the seven plan line 155 lists. SPEC has one word of headroom.

## Split, in order

Each part is one or more tests-first PR pairs, scoped at its kickoff.

| Part | Contents | Implementation | Tests | Sessions |
|---|---|---|---|---|
| 1 | Builder containment (D13, first half); a sandbox header on the served prototype and an `Origin` check on every console route (finding 2); request guards (finding 5) | 80 | 270 | 2.5 |
| 2 | Setup checks and retry; the README launch command | 95 | 225 | 2 |
| 3 | Browser test runner and CI; display isolation (D13, second half) | 20 | 280 | 2.5 |
| 4 | Console D03 and D05 controls, basic save and resume, and the D03 browser path | 150 | 505 | 4 |
| 5 | The self-contained package (D10) and honest spend | 152 | 250 | 2.5 |
| **DH1b** | | **~500** | **~1,530** | **~13** |

Net nonblank lines, as in DH1a.2, with about 20% for tightening after wrong versions get through. Three independent estimates were reconciled; they agreed on implementation and differed most on part 4's tests. The 1.5× gut check is about 745 / 2,300. DH1a.2 came in at +291 / +1,081. Then the exit checkpoint: the owner's live run, setup with and without GitHub sign-in, and the package-only agent read.

## Part 1's two contracts

- **Trusted requests.** The console trusts only its own loopback address, whatever `Host` a request claims. A mutating request needs an `Origin` that matches it exactly; a missing, `null` or foreign `Origin` is refused, setup included. Plain navigation without `Origin` still works. Each refused foreign or prototype post is paired with an allowed PM submission.
- **One mutation at a time, through its work.** A project-wide guard holds from a mutating request until its long work finishes, not only its handler (`shared/console/index.mjs:170–177` runs the work after the handler returns). A second mutation, or a duplicate submit, is refused with a remedy while one runs. A build publishes only after validation; an ordinary model or validation failure keeps the prior HTML and record. Within one Discovery console request a model call runs once: a usage gap ends the request with a refusal saying when to try again (plan line 27). Delivery keeps its pause (`evals/economics.mjs:120`), and `SPEC.md:134` gets a word-neutral edit.

No browser pilot runs before part 3's isolation proof.

## Decisions for the owner

1. **The split and order above.** Part 1 first, because everything later binds to the published HTML.
2. **The builder returns its HTML as structured output** (no write tools, as the stories and design writers already work), not a staging folder with deny rules. It leaves the sandbox code Delivery depends on untouched, and a scripted test shows no write tool is offered. Cost: every rebuild re-emits the whole page. One live build at real size, at the end of part 1, confirms it works before later parts build on it. The staging option adds about 25 / 45 lines and a live proof that deny rules hold.
3. **The package includes its tamper cases in DH1b** (an edited or missing file fails validation), since every D-case needs a violating run. The recipient's verifier stays in DH3. Happy path only saves about 20 / 45.
4. **Unknown spend is fixed at its source now** (part 5): a failed call's cost is marked unknown in a separate field, so Delivery's totals and call counts do not change.
5. **Browser tests run in CI** with a pinned Chromium, where SKIPPED fails. Claude makes the network install (the dev dependency and a browser download of roughly 100–350 MB) with the owner's OK.

**Agreed by the owner (2026-10-21):** all five, the estimate, and the single-attempt rule, after reviews by Dots and Gemini.

Everything else, such as the notes box, tracker wording and setup's retry behavior, is decided at the kickoff of the part it belongs to.

## Not in DH1b

Package versioning and the recipient verifier (DH3); late builds, cancellation and interrupted writes (DH4); anything under `delivery/`. Criteria set without a linked question, and reactions about scope or constraints, stay recorded limits.
