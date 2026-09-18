// owns: R2 · delivery — the proof. Every criterion the contract carries is discharged by
// output that actually ran, or it is a finding. The build's verdict is arithmetic over a
// change set: it says the binding was satisfied and the files exist. It cannot say the
// product does what was promised, because nothing executed. This stage executes.
//
// Two things are kept apart on purpose. What ran and what it produced is a fact, taken by
// running the suites and reading their output — no model decides whether a test passed.
// Whether that output discharges the criterion is a judgement, and the oracle making it is
// given the criterion and the signed design, never the binding's own account of what its
// test was checking. A test that asserts the wrong thing passes; an oracle that reads the
// assertion to learn what counts agrees with it, and the criterion is marked proved by the
// very thing that got it wrong.
//
// A criterion that cannot be met as written is not a build failure. It is the engineer's
// answer that the number is wrong, and it crosses the seam as a counter-proposal — what
// was asked, what was measured, why, and what is achievable — so the human disposes of it
// in seconds rather than opening an investigation. Delivery never edits the contract (R5).

import { join } from "node:path";
import { readDoc, saveDoc, saveVerdict } from "../../shared/store.mjs";
import { Refused } from "../../shared/refused.mjs";
import { runPerItemJudge, pin } from "../../shared/judge/index.mjs";
import { scopeOf } from "../../shared/scope.mjs";
import { readRun, takeHandoff, LEDGER } from "../state/index.mjs";
import { INTAKE_FILE } from "../intake/index.mjs";
import { loadSdd, covered, renderWorkItem, SDD_FILE } from "../sdd/index.mjs";
import { loadBuild, WORKTREE, BUILD_FILE } from "../build/index.mjs";
import { RUNNERS } from "../../shared/runners.mjs";

export const GATE = "qa";
export const QA_FILE = join("forge", "delivery", "qa.json");
export const VERDICT_FILE = join("forge", "delivery", "reviews", "qa.json");
export const IDENTITY = new URL("./prompts/oracle.md", import.meta.url).pathname;

/** Checked by running things, never the oracle's to report (R10). */
export const ARITHMETIC = ["test-missing", "test-failed", "criterion-unproved", "criterion-unprovable", "suite-failed"];

/**
 * The tests the binding says this machine cannot walk, and the names they wait on — read
 * from the binding's `needs` and then checked, never taken on trust. A test whose needs
 * are all present is an ordinary test: if it fails, it failed.
 *
 * The difference this draws is the one a manifest could not say. A criterion can go
 * undischarged because the product is wrong, or because nobody here owned the rig the
 * promise is about — Bakehouse's REQ-14/AC-1 is a power cut, and T-80 refuses to
 * substitute a process kill for one because a kill leaves the page cache up and a build
 * that never flushed would pass. That refusal is the discipline this whole architecture
 * is for, and it was being recorded as a failing test.
 *
 * It does not lower the bar. An unprovable criterion is still undischarged, still blocks,
 * still lands on the manifest — declaring a need buys a reason, never a pass.
 */
export function unprovable(sdd, env = process.env) {
  const out = [];
  for (const it of sdd?.items ?? []) {
    for (const t of it.tests ?? []) {
      const waiting = (t.needs ?? []).filter((n) => !String(env[n] ?? "").trim());
      if (waiting.length) out.push({ id: t.id, needs: waiting });
    }
  }
  return out;
}
/** What the oracle may say instead of a verdict: the criterion is wrong, and here is the number that is not. */
export const COUNTER = "counter-proposal";

/** The runners Forge knows, from their one home (shared/runners) — what to run and how to read it. */
export const SUITES = RUNNERS;

export function loadQa(root) { return readDoc(root, QA_FILE); }

/**
 * A test id in a title is the join between the binding and what ran. The builder writes
 * it there because the binding's prompt says to; QA reads it back and a test the binding
 * names that no title carries is `test-missing` — the join's one failure mode, reported
 * rather than passed over in silence.
 */
const idsIn = (title) => [...String(title).matchAll(/\bT-\d+\b/g)].map((m) => m[0]);

/**
 * Run every suite in the build's worktree. Returns what ran, by test id, and the raw
 * output of each suite so a person can read it. A suite that will not start at all is
 * `suite-failed` — the difference between "nothing was proved" and "everything passed"
 * is the whole point of this stage, and an unrun suite must never read as the second.
 */
export async function execute(root, { _exec } = {}) {
  const cwd = join(root, WORKTREE);
  const suites = [], byId = new Map();
  for (const s of SUITES) {
    const res = await run(cwd, s.command, _exec);
    const rows = res.ok || res.out ? s.parse(res.out) : [];
    suites.push({ id: s.id, command: s.command.join(" "), ran: res.ok !== null, ok: res.ok, tests: rows.length, out: res.out.slice(0, 20000) });
    for (const r of rows) for (const id of idsIn(r.title)) {
      const was = byId.get(id);
      // One id may be driven by more than one test; it is discharged only if all of them pass.
      byId.set(id, { id, title: r.title, suite: s.id, passed: (was ? was.passed : true) && r.passed });
    }
  }
  return { suites, tests: [...byId.values()] };
}

async function run(cwd, command, _exec) {
  if (_exec) return _exec(command, { cwd });
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(command[0], command.slice(1), { cwd, encoding: "utf8", timeout: 20 * 60_000 });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/**
 * What ran, against what the binding promised would run. Finding-shaped like every gate.
 * Nothing here is a judgement: a test the binding names either ran or it did not, and
 * either passed or it did not.
 */
export function checkRun(intake, sdd, results, env = process.env) {
  // What this machine was never going to be able to walk, checked against the environment
  // rather than taken from the binding's word.
  const waiting = new Map(unprovable(sdd, env).map((u) => [u.id, u.needs]));
  const findings = [];
  const f = (severity, rule, subject, summary, evidence, remedy) => findings.push({ severity, confidence: "certain", rule, subject, summary, evidence, remedy });

  // A suite is alive if it contributed a test the binding can join to, not if it printed
  // something shaped like a title. Counting titles let a suite that failed to start at all
  // evade this: node's runner, handed a path it cannot load, still emits one subtest named
  // after the path — one title, zero ids, `tests === 0` false, and the whole suite's tests
  // reported as `test-missing` against the product instead of `suite-failed` against the
  // runner. The join is what QA actually needs, so the join is what decides.
  // A non-zero exit is not the only way a suite can fail to run. A glob that matches nothing
  // exits ZERO with no tests — the same misattribution by a quieter route: every test the
  // binding names reads as missing from the product when the runner simply looked in the
  // wrong place. So the exit code is one trigger and unmatched binding tests are the other.
  // A suite that legitimately holds nothing is only silent when the binding names nothing
  // for it either, and then there is nothing left unmatched to blame it for.
  const found = new Set(results.tests.map((t) => t.id));
  // A test this machine was never going to walk is not evidence that a runner broke, so it
  // does not count toward the unmatched that blame one.
  const unmatched = (sdd.items ?? []).flatMap((it) => (it.tests ?? []).map((t) => t.id)).filter((id) => !found.has(id) && !waiting.has(id));
  for (const s of results.suites) {
    const joined = results.tests.filter((t) => t.suite === s.id).length;
    if (joined > 0 || (s.ok !== false && !unmatched.length)) continue;
    const why = s.ok === false
      ? `exited non-zero and produced no test the binding names${s.tests ? ` (it printed ${s.tests} title(s), none carrying a test id)` : ""}`
      : `exited zero and produced no test at all, while the binding still names ${unmatched.length} that nothing ran: ${unmatched.slice(0, 6).join(", ")}${unmatched.length > 6 ? ` (+${unmatched.length - 6})` : ""}`;
    f("high", "suite-failed", s.id, `The ${s.id} suite did not run.`, `\`${s.command}\` ${why}. Output: ${s.out.slice(0, 400)}`, "A suite that cannot start proves nothing. Fix the runner, then judge — an unrun suite must never read as a passing one, and its tests must not be reported missing from the product.");
  }

  const ran = new Map(results.tests.map((t) => [t.id, t]));
  const criteria = new Map();
  for (const w of intake.work_items ?? []) for (const c of w.criteria ?? []) criteria.set(c.id, { ...c, item: w.id });

  for (const it of sdd.items ?? []) {
    for (const t of it.tests ?? []) {
      const got = ran.get(t.id);
      if (waiting.has(t.id)) continue; // its criterion is reported below, with what it waits on
      if (!got) f("high", "test-missing", t.id, `${t.id} is in the binding and did not run.`, `\`/items\` ${it.work_item} names ${t.id}; no test the suites ran carries that id in its title.`, "Run it, or say in the binding why it cannot be run — a criterion whose test never ran is not discharged, it is unmeasured.");
      else if (!got.passed) f("high", "test-failed", t.id, `${t.id} failed.`, `${got.suite}: ${got.title}`, "The code, the test, or the criterion is wrong. Which one it is, is the oracle's to say.");
    }
  }

  // The criterion is the unit that matters: a criterion with no passing test behind it is
  // undischarged however many tests claim it.
  for (const [id, c] of criteria) {
    const tests = (sdd.items ?? []).flatMap((it) => (it.tests ?? []).filter((t) => (t.proves ?? []).includes(id)).map((t) => ({ ...t, item: it.work_item })));
    if (!tests.length) { f("high", "criterion-unproved", id, `${id} on ${c.item} has no test in the binding.`, `no test in \`/items\` names ${id} in \`proves\`.`, "Bind the test that proves it — sdd is where a criterion gets its evidence."); continue; }
    const passed = tests.filter((t) => ran.get(t.id)?.passed);
    // Every test bound to it waits on this machine: the criterion is unproved, and the
    // reason is the rig and not the product. It blocks exactly as hard — a promise nobody
    // could check is not a promise kept — but the record no longer says the product failed.
    if (!passed.length && tests.length && tests.every((t) => waiting.has(t.id))) {
      const needs = [...new Set(tests.flatMap((t) => waiting.get(t.id) ?? []))];
      f("high", "criterion-unprovable", id, `${id} on ${c.item} cannot be proved on this machine.`,
        `${c.statement}\n  every test bound to it waits on the environment: ${tests.map((t) => `${t.id} needs ${(waiting.get(t.id) ?? []).join(", ")}`).join("; ")}`,
        `Give the run what it waits on — ${needs.join(", ")} — and judge again, or dispose of the criterion on the record. Nothing here says the product is wrong: it says nobody asked it.`);
      continue;
    }
    if (!passed.length) f("high", "criterion-unproved", id, `${id} on ${c.item} is not discharged by anything that ran.`, `${c.statement}\n  tests: ${tests.map((t) => `${t.id} ${ran.has(t.id) ? (ran.get(t.id).passed ? "passed" : "failed") : "did not run"}`).join("; ")}`, "Discharge it, or answer it as a counter-proposal — what was asked, what was measured, and what is achievable.");
  }
  return findings;
}

/** The oracle's question, per work item: is each criterion discharged by what actually ran? */
function sections({ item, intake, design, results }) {
  const byId = new Map((intake.work_items ?? []).map((w) => [w.id, w]));
  const all = covered(item).map((id) => byId.get(id)).filter(Boolean);
  const refs = new Set(all.flatMap((w) => (w.screens ?? []).map((s) => s.screen_ref)));
  const ran = new Map(results.tests.map((t) => [t.id, t]));
  // Deliberately NOT the binding's `asserts`: the oracle is told what ran and what it did,
  // and decides for itself what would discharge the criterion. Handed the test's account of
  // what it was checking, it would grade the test against its own description.
  const executed = (item.tests ?? []).map((t) => {
    const got = ran.get(t.id);
    return `- ${t.id} — ${got ? `${got.passed ? "PASSED" : "FAILED"} · ${got.suite} · ${got.title}` : "DID NOT RUN"}\n  exercises: ${t.exercises ?? "(not stated)"}\n  proves: ${(t.proves ?? []).join(", ") || "(nothing)"}`;
  }).join("\n");

  return [
    ["The criteria to discharge", all.map((w) => renderWorkItem(w, intake)).join("\n\n")],
    ["The signed design — the screens these criteria are lived on", refs.size ? JSON.stringify((design?.screens ?? []).filter((s) => refs.has(s.screen_ref)), null, 1) : "(no screen)"],
    ["What ran, and what it did", executed || "(no test)"],
    ["Suite output", results.suites.map((s) => `### ${s.id}\n\n${s.out.slice(0, 6000)}`).join("\n\n")],
  ];
}

/**
 * One round: run everything, hold it to the binding, then ask the oracle per item whether
 * the criteria are discharged. The arithmetic and the judgement are merged into one verdict
 * by the rule every gate uses.
 */
export async function round(root, ctx = {}) {
  const run = readRun(root);
  const handoff = takeHandoff(root, run.handoff.version).handoff;
  const intake = readDoc(root, INTAKE_FILE);
  const sdd = loadSdd(root);
  const build = loadBuild(root);
  if (!intake || !sdd) throw new Refused("no-binding", "qa: the binding is not on record — sdd runs before qa");
  if (!build) throw new Refused("no-build", "qa: nothing has been built — build runs before qa");

  ctx.onEvent?.("running the suites");
  const results = await execute(root, ctx);
  for (const s of results.suites) ctx.onEvent?.(`${s.id}: ${s.tests} test(s), ${s.ok ? "exit 0" : "non-zero"}`);

  const arithmetic = checkRun(intake, sdd, results, ctx._env ?? process.env);

  // The executed record goes down before anything judges it, because it is what the
  // verdict will be pinned to and a pin needs the stamped document. The raw output is not
  // on it: it is large, it is not a fact about the product, and the oracle has read it.
  const doc = saveDoc(root, QA_FILE, "qa", {
    id: run.id, meta: {},
    suites: results.suites.map(({ out, ...s }) => s),
    tests: results.tests,
    unprovable: unprovable(sdd, ctx._env ?? process.env),
    "x-drift-checked": ["/tests", "/unprovable"],
  });

  const judge = await runPerItemJudge({
    gate: GATE, half: "delivery", stage: GATE, identity: IDENTITY,
    items: (sdd.items ?? []).map((it) => ({ id: it.work_item, sections: sections({ item: it, intake, design: handoff.design, results }) })),
    scope: scopeOf(handoff.contract), rulings: (handoff.contract?.rulings ?? []), arithmetic: [...ARITHMETIC, COUNTER],
    cwd: root, ledger: join(root, LEDGER), budget: run.budget, models: run.models,
    onEvent: ctx.onEvent, _query: ctx._query, _sleep: ctx._sleep,
  });

  const findings = [...arithmetic, ...judge.verdict.findings];
  const verdict = {
    ...judge.verdict,
    gate: GATE,
    findings,
    verdict: findings.some((x) => x.severity === "high" && x.confidence === "certain") ? "block" : findings.length ? "advise" : "pass",
    checked: results.tests.length,
    // A verdict is about the hashes it pinned and nothing else, and one that pinned
    // nothing is unknown rather than fresh (R5) — so an unpinned qa verdict can never pass
    // the approve door, however clean it is. The chain this judgement rests on: the
    // contract it was judged against, the binding that named the tests, the build that was
    // run, and the record of what running it produced. Any of them moving makes this
    // verdict evidence about something that is no longer on disk.
    judged: [
      pin({ id: `handoff-v${handoff.version}`, path: run.handoff.path, doc: handoff }),
      pin({ id: intake.id, path: INTAKE_FILE, doc: intake }),
      pin({ id: sdd.id, path: SDD_FILE, doc: sdd }),
      pin({ id: build.id, path: BUILD_FILE, doc: build }),
      pin({ id: doc.id, path: QA_FILE, doc }),
    ],
  };

  // The verdict goes on disk before it goes back. The loop is handed a root-relative path,
  // not a document: `transition` re-reads the file itself, so that what the door disposes
  // of is what was filed rather than what a caller says was filed. A round that returns the
  // verdict in hand instead reads back as a round that judged nothing — every oracle call
  // made, paid for, and discarded at the door.
  saveVerdict(root, VERDICT_FILE, verdict);
  return { doc, verdict, file: VERDICT_FILE, results };
}

/** A re-judge runs nothing new: the suites are the record, and the oracle reads them again. */
export const rejudge = round;
