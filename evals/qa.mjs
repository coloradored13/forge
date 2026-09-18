#!/usr/bin/env node
// owns: R2 · delivery — eval: qa. What ran and what it did is a fact taken from output;
// whether it discharges a criterion is a judgement made without the binding's account of
// what its own test was checking. Both directions, scripted seams only (R15).

import { suite, withRoot, scripted } from "./_harness.mjs";
import { seedBuild, builder, put, BUILT, CLEAN } from "./_fixture.mjs";
import { checkRun, execute, round, SUITES, ARITHMETIC, COUNTER, IDENTITY, QA_FILE } from "../delivery/qa/index.mjs";
import { verdictFreshness } from "../shared/judge/index.mjs";
import { validate } from "../shared/schema/index.mjs";
import { runStage, reopen, advance, redoPlan } from "../delivery/run/index.mjs";
import { readDoc, saveDoc } from "../shared/store.mjs";
import { WORKTREE } from "../delivery/build/index.mjs";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const { check, done } = suite("qa — the proof: criteria discharged by what ran", 36);

const intake = {
  work_items: [
    { id: "STORY-1", criteria: [{ id: "REQ-1/AC-1", statement: "A reviewer records a decision at the moment they make it." }], scenarios: [], screens: [{ screen_ref: "SCREEN-1" }] },
    { id: "STORY-2", criteria: [{ id: "REQ-1/AC-2", statement: "The whole day is readable with no action but opening the app." }], scenarios: [], screens: [{ screen_ref: "SCREEN-2" }] },
  ],
};
const sdd = {
  items: [
    { work_item: "STORY-1", tests: [{ id: "T-1", proves: ["REQ-1/AC-1"], exercises: "records a decision" }] },
    { work_item: "STORY-2", tests: [{ id: "T-2", proves: ["REQ-1/AC-2"], exercises: "opens the app" }, { id: "T-3", proves: ["REQ-1/AC-2"], exercises: "reads the day" }] },
  ],
};
const results = (tests, suites = [{ id: "unit", command: "node --test", ran: true, ok: true, tests: tests.length, out: "" }]) => ({ suites, tests });
const T = (id, passed, suite = "unit") => ({ id, title: `${id} — a thing`, suite, passed });
const rules = (f) => [...new Set(f.map((x) => x.rule))].sort().join(",");
const of = (f, rule) => f.filter((x) => x.rule === rule);

// ── the parsers, over output the real runners emit ──
const tapOut = [
  "TAP version 13", "# Subtest: REQ-1/AC-1 · T-1 — records it",
  "ok 1 - REQ-1/AC-1 · T-1 — records it", "not ok 2 - REQ-1/AC-2 · T-2 — reads the day",
  "ok 3 - some test with no id", "ok 4 - T-9 — skipped one # SKIP",
].join("\n");
const tap = SUITES[0].parse(tapOut);
check("TAP: ok and not ok are read as passed and failed, a skip is neither", tap.length === 3 && tap[0].passed && !tap[1].passed && tap[2].passed, JSON.stringify(tap));

const lineOut = ["  ✓  1 tests/a.spec.js:3:1 › REQ-1/AC-1 · T-1 — records it (1.2s)",
  "  1) tests/b.spec.js:9:1 › REQ-1/AC-2 · T-2 — reads the day", "  2 failed", "  1 passed (3s)"].join("\n");
const line = SUITES[1].parse(lineOut);
check("line reporter: a title listed as a numbered failure is failed, whatever else names it", line.some((r) => !r.passed && /T-2/.test(r.title)), JSON.stringify(line));

// ── the configured command, run for real against a real test file ──
// The only check that could have caught the invocation defect: a string assertion on the
// command says nothing about whether the runner finds anything, and the parsers above are
// fed output rather than producing it. So spawn the configured command over a seeded
// tests/unit and require the id to come back through the parser the suite declares.
withRoot({
  [join(WORKTREE, "tests", "unit", "sample.spec.js")]:
    `import { test } from "node:test";\nimport assert from "node:assert";\ntest("T-1 — the configured command finds this file", () => assert.ok(true));\n`,
}, (root) => {
  const [cmd, ...args] = SUITES[0].command;
  const r = spawnSync(cmd, args, { cwd: join(root, WORKTREE), encoding: "utf8" });
  const rows = SUITES[0].parse(`${r.stdout ?? ""}${r.stderr ?? ""}`);
  check("the configured unit command actually finds and names the tests in tests/unit — a bare directory path does not, and every test in it then reads as missing from the product",
    r.status === 0 && rows.length === 1 && rows[0].passed && /\bT-1\b/.test(rows[0].title),
    JSON.stringify({ command: SUITES[0].command.join(" "), status: r.status, rows, err: String(r.stderr ?? "").slice(0, 200) }));
});

// ── a test id seen twice is discharged by both or by neither ──
await withRoot({}, async (root) => {
  const out = ["ok 1 - T-1 — first reading", "not ok 2 - T-1 — second reading"].join("\n");
  const r = await execute(root, { _exec: async () => ({ ok: false, out }) });
  const one = r.tests.find((t) => t.id === "T-1");
  check("one id driven by two tests passes only if both do — a second reading that fails is not outvoted", r.tests.length === 1 && one && !one.passed, JSON.stringify(r.tests));
});

// ── the arithmetic ──
let f = checkRun(intake, sdd, results([T("T-1", true), T("T-2", true), T("T-3", true)]));
check("everything ran and passed: no finding at all", f.length === 0, JSON.stringify(f));

f = checkRun(intake, sdd, results([T("T-1", true), T("T-2", false), T("T-3", true)]));
check("a failed test is a finding, and the criterion behind it is not — a second passing test discharges it",
  rules(f) === "test-failed" && of(f, "test-failed")[0].subject === "T-2", JSON.stringify(f));

f = checkRun(intake, sdd, results([T("T-1", true), T("T-2", false), T("T-3", false)]));
check("a criterion whose every test failed is undischarged, and the criterion is the subject — not the tests",
  of(f, "criterion-unproved").length === 1 && of(f, "criterion-unproved")[0].subject === "REQ-1/AC-2" && of(f, "test-failed").length === 2, JSON.stringify(f));

f = checkRun(intake, sdd, results([T("T-1", true), T("T-3", true)]));
check("a test the binding names that no title carries did not run, and says so — it is never counted as passing",
  of(f, "test-missing").length === 1 && of(f, "test-missing")[0].subject === "T-2" && of(f, "criterion-unproved").length === 0, JSON.stringify(f));

f = checkRun(intake, { items: [{ work_item: "STORY-1", tests: [] }, { work_item: "STORY-2", tests: [] }] }, results([]));
check("a criterion with no test in the binding at all is unproved, and the remedy sends it to sdd where evidence is bound",
  of(f, "criterion-unproved").length === 2 && /sdd is where a criterion gets its evidence/.test(of(f, "criterion-unproved")[0].remedy), JSON.stringify(f.map((x) => x.subject)));

f = checkRun(intake, sdd, { suites: [{ id: "browser", command: "npx playwright test", ran: true, ok: false, tests: 0, out: "Cannot find module" }], tests: [T("T-1", true), T("T-2", true), T("T-3", true)] });
check("a suite that exits non-zero having named no test did not run — that is a finding, and it is not the same as its tests failing",
  of(f, "suite-failed").length === 1 && of(f, "suite-failed")[0].subject === "browser" && /must never read as a passing one/.test(of(f, "suite-failed")[0].remedy), JSON.stringify(f));

f = checkRun(intake, sdd, { suites: [{ id: "unit", command: "node --test", ran: true, ok: false, tests: 3, out: "" }], tests: [T("T-1", true), T("T-2", false), T("T-3", true)] });
check("a suite that exits non-zero because a test failed is not `suite-failed` — the failure is already named by the test",
  !rules(f).includes("suite-failed"), JSON.stringify(f));

// A runner handed a path it cannot load still prints one title — named after the path.
// Counting titles read that as a live suite, and reported every test it should have run
// as missing from the product. The join decides, so one title carrying no id is not a test.
f = checkRun(intake, sdd, { suites: [{ id: "unit", command: "node --test tests/unit/", ran: true, ok: false, tests: 1, out: "Error: Cannot find module '/x/tests/unit'" }], tests: [] });
check("a suite that could not start but still printed one title naming the path it failed to load is `suite-failed` — a title carrying no test id is not a test",
  of(f, "suite-failed").length === 1 && of(f, "suite-failed")[0].subject === "unit" && /none carrying a test id/.test(of(f, "suite-failed")[0].evidence), JSON.stringify(f.map((x) => `${x.rule}:${x.subject}`)));

// ── the round's contract with the loop: a verdict on disk, named by a path ──
// The loop is handed a root-relative path and `transition` re-reads the file itself, so a
// round that returns the verdict in hand reads back as a round that judged nothing. Every
// piece of this stage was checked above and the stage still could not finish a round: the
// parts were exercised, the seam to the loop was not.
await withRoot({}, async (tmp) => {
  const { cold } = await seedBuild(tmp, { files: { "README.md": "# Dock\n" } });
  const b = builder([BUILT(), BUILT("Run sheet built."), BUILT("Queue built.")],
    { 0: (cwd) => put(cwd, "src/exceptions/store.js", "a"), 1: (cwd) => put(cwd, "src/deliveries/store.js", "b"), 2: (cwd) => put(cwd, "src/queue/q.js", "c") });
  await runStage(cold, { stage: "build", _query: b.query });

  const out = ["ok 1 - T-1 — records it", "ok 2 - T-2 — never updated", "ok 3 - T-3 — four rows", "ok 4 - T-4 — the queue flushes"].join("\n");
  const r = await round(cold, {
    _exec: async () => ({ ok: true, out }),
    _query: scripted({ structuredSeq: [CLEAN("STORY-1"), CLEAN("STORY-2"), CLEAN("REQ-4")] }).query,
  });
  // Read only what can be a path: handed the verdict itself, `readDoc` throws, and a throw
  // aborts the file instead of reporting the one thing this check exists to report.
  const filed = typeof r.file === "string" ? readDoc(cold, r.file) : null;
  check("a qa round files its verdict and hands the loop the path to it — a verdict returned in hand is a round that judged nothing, with every oracle call paid for and discarded at the door",
    typeof r.file === "string" && !!filed && typeof filed.verdict === "string" && filed.gate === "qa",
    JSON.stringify({ returned: typeof r.file, value: typeof r.file === "string" ? r.file : Object.keys(r.file ?? {}), read: filed ? { gate: filed.gate, verdict: filed.verdict } : null }));

  // Filing it is not enough: a verdict that pinned nothing is unknown, never fresh, and
  // `approve` guards on freshness. Unpinned, a clean qa verdict is refused forever and the
  // stage can never close — the run reaches the last door and stops at it.
  const fresh = verdictFreshness(filed ?? {}, { root: cold });
  check("the verdict pins the chain it rests on — contract, binding, build, and what ran — so the approve door can open and a later change makes it stale",
    fresh.fresh === true && (filed?.judged ?? []).length === 5,
    JSON.stringify({ fresh, pinned: (filed?.judged ?? []).map((p) => p.id) }));

  // The pin is load-bearing, not decorative: re-running the suites rewrites the executed
  // record, and the verdict must stop being evidence about it.
  saveDoc(cold, QA_FILE, "qa", { id: "bakehouse", meta: {}, suites: [], tests: [], "x-drift-checked": ["/tests"] });
  const after = verdictFreshness(readDoc(cold, r.file), { root: cold });
  check("re-running the suites makes the standing verdict stale — the record it judged is not the record on disk",
    after.fresh === false && after.stale.some((s) => s.path === QA_FILE),
    JSON.stringify(after));
});

// ── the carry: the stage that must answer a finding is handed the finding ──
// A reopened stage's own verdict approved — that is why it was approved — so it carries no
// findings, and a writer given it learns nothing about why it is redoing the work. Without
// the carry the only channel is the reopen's `reason`: a sentence a human composed, which
// re-makes by hand the judgement a model was paid to make independently.
await withRoot({}, async (tmp) => {
  const { cold } = await seedBuild(tmp, { files: { "README.md": "# Dock\n" } });
  const b = builder([BUILT(), BUILT("b"), BUILT("c")],
    { 0: (cwd) => put(cwd, "src/exceptions/store.js", "a"), 1: (cwd) => put(cwd, "src/deliveries/store.js", "b"), 2: (cwd) => put(cwd, "src/queue/q.js", "c") });
  await runStage(cold, { stage: "build", _query: b.query });

  // The oracle diagnoses a wrong test and names the binding as whose it is.
  const ORACLE = {
    findings: [{
      severity: "high", confidence: "certain", rule: "the test is wrong", subject: "T-1", redo: "sdd",
      summary: "T-1 asserts the reason chip is visible; REQ-1/AC-1 requires the exception to be on the record.",
      evidence: "the test asserts a chip is visible. The criterion: a reviewer records a decision at the moment they make it.",
      remedy: "Bind a test that observes the recorded exception, not the control that starts it.",
    }],
    deferred: [], checked: 1, skipped: 0,
  };
  await runStage(cold, { stage: "qa", _query: scripted({ structured: ORACLE }).query });

  const items = (await import("./_fixture.mjs")).BINDING;
  const redo = scripted({ structuredSeq: [{ items: items.items, questions: [] }, CLEAN("STORY-1"), CLEAN("STORY-2"), CLEAN("REQ-4")] });
  await reopen(cold, { stage: "sdd", by: "Brad", reason: "qa sent the binding back", from: "qa", _query: redo.query });
  const prompt = redo.calls[0]?.prompt ?? "";

  check("a stage reopened by a later gate is handed that gate's own findings — the judge that saw the evidence wrote them, and the writer answers those rather than somebody's summary",
    /T-1 asserts the reason chip is visible/.test(prompt) && /the test is wrong/.test(prompt) && /observes the recorded exception/.test(prompt),
    JSON.stringify({ calls: redo.calls.length, carried: /T-1 asserts/.test(prompt), head: prompt.slice(0, 200) }));

  check("only what was addressed to it: arithmetic findings name no stage and are not carried, so the writer is not handed defects that are not its to fix",
    !/suite-failed/.test(prompt) && !/test-missing/.test(prompt),
    JSON.stringify({ suiteFailed: /suite-failed/.test(prompt), testMissing: /test-missing/.test(prompt) }));
});

// ── the loop routes on the diagnosis, and the ceiling bounds the circle ──
// Driven through `advance`, not its parts: every defect this stage has had was in a seam
// between components that each tested clean. An oracle that always sends the binding back
// makes the cycle run until something stops it, which is the only way to see what does.
await withRoot({}, async (tmp) => {
  const { cold } = await seedBuild(tmp, { files: { "README.md": "# Dock\n" } });
  const b = builder([BUILT(), BUILT("b"), BUILT("c")],
    { 0: (cwd) => put(cwd, "src/exceptions/store.js", "a"), 1: (cwd) => put(cwd, "src/deliveries/store.js", "b"), 2: (cwd) => put(cwd, "src/queue/q.js", "c") });
  await runStage(cold, { stage: "build", _query: b.query });

  const { BINDING } = await import("./_fixture.mjs");
  const SEND_BACK = {
    findings: [{
      severity: "high", confidence: "certain", rule: "the test is wrong", subject: "T-1", redo: "sdd",
      summary: "T-1 asserts the chip is visible; the criterion requires the exception on the record.",
      evidence: "assertion: chip visible. criterion: a reviewer records a decision at the moment they make it.",
    }],
    deferred: [], checked: 1, skipped: 0,
  };
  // One seam, three answers — told apart by the sections each prompt actually carries.
  const seen = { oracle: 0, writer: 0, judge: 0 };
  const CLEAN_JUDGE = { findings: [], deferred: [], checked: 1, skipped: 0 };
  const reply = (prompt) => {
    // The oracle is asked per work item; only STORY-1's answer sends anything back, so the
    // plan must carry that item alone out of the three judged — a redo that names every
    // item rewrites work no finding was about.
    if (/Suite output/.test(prompt)) { seen.oracle++; return /REQ-1\/AC-1/.test(prompt) ? SEND_BACK : CLEAN_JUDGE; }
    if (/Interfaces the other items name/.test(prompt)) { seen.judge++; return CLEAN_JUDGE; }
    seen.writer++; return { items: BINDING.items, questions: [] };
  };
  const q = ({ prompt, options }) => (async function* () {
    yield { type: "system", subtype: "init", session_id: "s" };
    yield { type: "assistant", session_id: "s", message: { content: [{ type: "text", text: "ok" }] } };
    yield { type: "result", session_id: "s", subtype: "success", is_error: false, errors: [], total_cost_usd: 0.01, num_turns: 1, structured_output: reply(prompt), modelUsage: { [options.model]: { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.01 } } };
  })();

  const events = [];
  const out = await advance(cold, { _query: q, onEvent: (e) => events.push(e) });
  const run = readDoc(cold, "forge/run.json");
  const sent = run.flags.filter((f) => f.event === "reopen" && f.from === "qa");

  check("a blocking verdict whose findings name a stage is not a human door — the loop reopens that stage itself, with the items the findings were about, and says so",
    out.redos.length > 0 && out.redos[0].from === "qa" && out.redos[0].to === "sdd" && out.redos[0].items.join() === "STORY-1" &&
    sent.length > 0 && sent[0].stage === "sdd" && /sent 1 item\(s\) back/.test(sent[0].reason) &&
    events.some((e) => /qa → sdd redo 1 of 3/.test(e)),
    JSON.stringify({ redos: out.redos, flags: sent.map((f) => `${f.stage}:${f.from}:${f.reason}`), halted: out.halted }));

  check("the circle is bounded by the ceiling, not by a stage's own cap — a reopen resets that cap, so only a count across stages can stop an oracle that keeps sending the same work back",
    out.halted?.why === "redo-ceiling" && sent.length === run.ceiling && /the block is the human's call now/.test(out.halted.message ?? ""),
    JSON.stringify({ halted: out.halted, reopens: sent.length, ceiling: run.ceiling, oracleRounds: seen.oracle }));
});

// A criterion that cannot be met routes to nobody: the loop must not spend a cycle on it.
await withRoot({}, async (tmp) => {
  const { cold } = await seedBuild(tmp, { files: { "README.md": "# Dock\n" } });
  const b = builder([BUILT(), BUILT("b"), BUILT("c")],
    { 0: (cwd) => put(cwd, "src/exceptions/store.js", "a"), 1: (cwd) => put(cwd, "src/deliveries/store.js", "b"), 2: (cwd) => put(cwd, "src/queue/q.js", "c") });
  await runStage(cold, { stage: "build", _query: b.query });
  await runStage(cold, { stage: "qa", _query: scripted({ structured: {
    findings: [{ severity: "high", confidence: "certain", rule: COUNTER, subject: "REQ-1/AC-1", summary: "30000ms is below the typing alone; 35000ms is reachable.", evidence: "measured 34758ms, of which 34200ms is scripted input." }],
    deferred: [], checked: 1, skipped: 0,
  } }).query });
  check("a counter-proposal routes to nobody — no stage can redo its way out of a criterion that cannot be met, so the plan is empty and the run stops at the human",
    redoPlan(cold, "qa") === null, JSON.stringify(redoPlan(cold, "qa")));
});

// A glob that matches nothing exits ZERO with no tests — the same misattribution as a
// runner that cannot start, by a quieter route. Exit code alone could not see it.
f = checkRun(intake, sdd, { suites: [{ id: "unit", command: "node --test tests/unit/*.spec.js", ran: true, ok: true, tests: 0, out: "" }], tests: [] });
check("a suite that exits zero having run nothing, while the binding still names tests nothing ran, did not run — a glob that matches nothing is not a suite that passed",
  of(f, "suite-failed").length === 1 && /exited zero and produced no test at all/.test(of(f, "suite-failed")[0].evidence) && /T-1/.test(of(f, "suite-failed")[0].evidence),
  JSON.stringify(of(f, "suite-failed").map((x) => x.evidence)));

f = checkRun({ work_items: [] }, { items: [] }, { suites: [{ id: "browser", command: "npx playwright test", ran: true, ok: true, tests: 0, out: "" }], tests: [] });
check("a suite that holds nothing when the binding names nothing for it is not a finding — silence is only suspect when something is unaccounted",
  of(f, "suite-failed").length === 0, JSON.stringify(f));

// ── a qa round driven through the loop, which _exec could not reach before ──
await withRoot({}, async (tmp) => {
  const { cold } = await seedBuild(tmp, { files: { "README.md": "# Dock\n" } });
  const b = builder([BUILT(), BUILT("b"), BUILT("c")],
    { 0: (cwd) => put(cwd, "src/exceptions/store.js", "a"), 1: (cwd) => put(cwd, "src/deliveries/store.js", "b"), 2: (cwd) => put(cwd, "src/queue/q.js", "c") });
  await runStage(cold, { stage: "build", _query: b.query });

  const out = ["ok 1 - T-1 passes", "ok 2 - T-2 passes", "ok 3 - T-3 passes", "ok 4 - T-4 passes"].join("\n");
  const r = await runStage(cold, {
    stage: "qa",
    _exec: async () => ({ ok: true, out }),
    _query: scripted({ structured: { findings: [], deferred: [], checked: 1, skipped: 0 } }).query,
  });
  check("a qa round runs through the loop with its suites scripted — the seam reaches the stage, so the loop path is testable and not only round() called directly",
    r.status === "approved" && r.verdict.verdict === "pass" && r.verdict.findings.length === 0,
    JSON.stringify({ status: r.status, verdict: r.verdict?.verdict, findings: r.verdict?.findings?.map((x) => x.rule) }));
});

check("every arithmetic rule is declared, and the counter-proposal is the oracle's alone",
  new Set(ARITHMETIC).size === ARITHMETIC.length && !ARITHMETIC.includes(COUNTER) && COUNTER === "counter-proposal");

// ── the oracle's identity: the isolation has to be in the prose, not only the plumbing ──
const oracle = existsSync(IDENTITY) ? readFileSync(IDENTITY, "utf8") : "";
check("the oracle exists and is authored", oracle.length > 1000);
check("it is told it does not get the binding's account of what the test was checking — the reason isolation exists",
  /not given the binding's account|what it \*proves\* is yours/i.test(oracle) && /asserts the wrong thing/i.test(oracle));
check("it must say which of the three a failure is: the code, the test, or the criterion",
  /The code is wrong/.test(oracle) && /The test is wrong/.test(oracle) && /The criterion is wrong/.test(oracle));
check("a wrong criterion is answered with a number, not a refusal, and does not block",
  /counter-proposal/.test(oracle) && /does not block/.test(oracle) && /what is achievable/.test(oracle));
check("the counter-proposal must carry what was asked, what was measured, why, and whether the alternative still serves the requirement",
  /what was asked/.test(oracle) && /what was measured/.test(oracle) && /why it cannot be met/.test(oracle) && /still serves the requirement/.test(oracle));
check("it must not invent a rationale the requirement does not give",
  /Do not guess at a reason the\s*requirement does not give/.test(oracle));
check("it does not decide whether a test passed, and does not repeat the arithmetic",
  /You do not decide whether a test passed/.test(oracle) && /already holds/.test(oracle));
check("it is told not to manufacture doubt — an oracle that finds fault everywhere is worth nothing",
  /manufacture doubt/.test(oracle));

// ── the diagnosis routes the work, so it has to be a field and not a sentence ──
const verdictWith = (finding) => ({ gate: "qa", verdict: "advise", findings: [finding], deferred: [], checked: 1, skipped: 0 });
const FIND = { severity: "medium", confidence: "certain", rule: "the test is wrong", subject: "T-9", summary: "s", evidence: "e" };
check("a finding may name the stage that must redo its work, and only a stage that can",
  validate("finding", verdictWith({ ...FIND, redo: "sdd" })).ok &&
  validate("finding", verdictWith({ ...FIND, redo: "build" })).ok &&
  !validate("finding", verdictWith({ ...FIND, redo: "qa" })).ok &&
  validate("finding", verdictWith(FIND)).ok,
  JSON.stringify(validate("finding", verdictWith({ ...FIND, redo: "qa" })).errors));

check("the oracle is told to put the diagnosis in the field, not only in its prose — a sentence has to be read back out by hand",
  /`redo`\s+field,\s+not\s+only\s+in\s+your\s+prose/.test(oracle) && /routes\s+the\s+work/.test(oracle));

check("a wrong test is the binding's to fix, never the code's — code written to satisfy a test that asks the wrong question makes the wrong answer permanent",
  /→ `redo: "sdd"`/.test(oracle) && /Never `build`/.test(oracle) && /→ `redo: "build"`/.test(oracle));

check("a criterion that cannot be met names no stage — no stage can redo its way out of it, and naming one is a loop the run cannot leave",
  /no `redo` at all/.test(oracle) && /loop it cannot leave/.test(oracle));

done();
