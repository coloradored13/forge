// owns: R10 · shared — what Forge knows about a test runner, in one place: how to invoke
// it, how to read what it printed, and what it leaves on disk when it has run.
//
// The third of those is the one that had no home. QA knew the first two and Delivery's
// build knew neither, so when a builder verified its work — running the browser suite,
// mutating the product to prove each new assertion could fail — the runner wrote its
// output beside the product and build's change-set accounting counted it as source the
// builder had touched outside its surface. Six findings, eight more cascading from them,
// and a blocked stage, for the side effect of doing the thing the binding asked for.
//
// The repair is not a list of paths for build to tolerate. A project that runs Playwright
// keeps `test-results/` out of its repository, the same as it keeps `node_modules/` out,
// and Forge is the thing that writes that repository's `.gitignore` (discovery/setup).
// Forge also decides which runners will run there. It should write the one that follows
// from the other. Then git's own `--exclude-standard` does the work, build needs no
// special case, and a reader of the product sees an ordinary correctly-configured repo
// rather than a Forge convention kept somewhere they cannot see.

/** TAP, as node's runner emits it: `ok 3 - T-14 …` / `not ok 4 - T-9 …`. */
export function tap(out) {
  const rows = [];
  for (const raw of out.split("\n")) {
    const m = /^(not ok|ok)\s+\d+\s*-?\s*(.*)$/.exec(raw.trim());
    if (m && !/# SKIP/i.test(raw)) rows.push({ title: m[2].trim(), passed: m[1] === "ok" });
  }
  return rows;
}

/** Playwright's line reporter: a failing test is listed under `N failed` by its title. */
export function line(out) {
  const rows = [];
  for (const raw of out.split("\n")) {
    const ok = /^\s*✓|^\s*\d+\)\s/.test(raw);
    const m = /›\s*(.+?)\s*$/.exec(raw);
    if (m) rows.push({ title: m[1].trim(), passed: !/^\s*\d+\)/.test(raw) && !/✘|×/.test(raw) });
    else if (ok) continue;
  }
  // The line reporter prints failures after a `N failed` header; anything it did not name
  // as failing and the binding expects is resolved against the summary below.
  const failed = new Set(rows.filter((r) => !r.passed).map((r) => r.title));
  return rows.map((r) => ({ ...r, passed: !failed.has(r.title) }));
}

/**
 * The runners, and everything Forge knows about each.
 *
 * `generates` is what the runner writes beside the product when it runs — the paths a
 * project using it would keep out of its repository. Empty is an answer and must be
 * written as one: a runner that leaves nothing says so, and a runner added without saying
 * either way is caught by the coherence eval rather than by a blocked build months later.
 *
 * These are the runners' documented defaults. A project that configures its output
 * somewhere else is outside what this can know, and the failure then reads as an
 * incomplete `.gitignore` in the product — something a person can see and fix in the repo —
 * rather than as Forge's accounting refusing a builder for reasons invisible from the
 * product's side.
 */
export const RUNNERS = [
  {
    id: "unit",
    command: ["node", "--test", "--test-reporter=tap", "tests/unit/*.spec.js"],
    parse: tap,
    // node's runner prints and writes nothing.
    generates: [],
  },
  {
    id: "browser",
    command: ["npx", "--no-install", "playwright", "test", "tests/browser", "--reporter=line"],
    parse: line,
    // Playwright's defaults: the per-test artefacts of a run, and the HTML report.
    generates: ["test-results/", "playwright-report/"],
  },
];

/** Everything every known runner leaves behind, deduplicated and in a stable order. */
export const GENERATED = [...new Set(RUNNERS.flatMap((r) => r.generates))].sort();
