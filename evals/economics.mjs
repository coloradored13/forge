#!/usr/bin/env node
// owns: R1, R7, R6 · shared — eval: economics. Every model call is recorded with model,
// tokens, cost and duration by half, stage and role; the budget refuses a call before
// the model runs; the model is chosen per role from one config; a usage gap pauses;
// judges' findings are ranked, never cut, with the verdict derived, never read; and rounds
// are capped by the transition table — the cap lands a block in `blocked`, where the human's
// moves are escalate with a reason (to the ceiling), approve on the record, or stop (R6).
// The Delivery loop is run on a cold root: writer → arithmetic → judge → door, each round a
// transition, every call on the ledger, the wrapper's heartbeat under the work, a thrown
// stage stopped with the error as its reason. No model is ever called here — the SDK is
// replaced by a scripted query.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { suite, withRoot, scripted } from "./_harness.mjs";
import { call, BudgetError, rows, quote, modelFor, TOOLS, totals, estimate, tally } from "../shared/agent-call/index.mjs";
import { append as appendLedger } from "../shared/agent-call/ledger.mjs";
import { runJudge, runPerItemJudge, rank, deriveVerdict, weight, renderFindingsForAgent } from "../shared/judge/index.mjs";
import { apply, DEFAULTS, readRun, transition, rounds, LEDGER } from "../delivery/state/index.mjs";
import { runStage, escalate, advance, estimateRun, AUTHORED, PULSE_MS } from "../delivery/run/index.mjs";
import { SDD_FILE, VERDICT_FILE as SDD_VERDICT, loadSdd } from "../delivery/sdd/index.mjs";
import { seedDelivery, coldRoot, BINDING, seedBuild, builder, put, gitIn, BUILT, BLOCKED } from "./_fixture.mjs";
import { loadBuild, BRANCH } from "../delivery/build/index.mjs";
import { readDoc } from "../shared/store.mjs";
import { stamp } from "../shared/hash.mjs";
import { setupProject } from "../discovery/setup/index.mjs";
import { openPrd, quoteTurn, turn } from "../discovery/workshop/index.mjs";

const { check, done } = suite("economics · R1 metering and budget, R7 ranked judges");

const IDENTITY = "# Story reviewer\n\nYou review stories at the PM's bar. A missing edge case is not a finding; an untestable Then is.\n";
const FINDING = (severity, confidence, n) => ({ severity, confidence, rule: `r${n}`, subject: `STORY-${n}`, summary: `s${n}`, evidence: `e${n}` });

// ── R1 · metering ──
await withRoot({}, async (root) => {
  const ledger = join(root, "runs", "r1", "calls.jsonl");
  const q = scripted({ usd: 0.12 });
  const r = await call({ half: "discovery", stage: "stories", role: "writer", kind: "writer", system: "s", prompt: "p", cwd: root, ledger, _query: q.query });
  const [row] = rows(ledger);
  check("a call writes one ledger row with half, stage, role, model, tokens, cost, duration",
    rows(ledger).length === 1 && row.half === "discovery" && row.stage === "stories" && row.role === "writer" && row.model === "claude-opus-5" &&
    row.usd === 0.12 && row.tokens.input === 1000 && row.tokens.output === 200 && row.tokens.cache_read === 7 && typeof row.ms === "number" && row.ok === true,
    JSON.stringify(row));
  check("the call returns what it cost", r.usd === 0.12 && r.model === "claude-opus-5" && r.text === "ok", JSON.stringify(r));
  check("the model, the tool policy and the system prompt reach the SDK",
    q.calls[0].options.model === "claude-opus-5" && q.calls[0].options.allowedTools.includes("Write") && q.calls[0].options.systemPrompt === "s");
  check("the call is isolated from the operator's Claude Code — no settings, CLAUDE.md, MCP servers or hooks load under the identity (first real call: 44k tokens of them did)",
    Array.isArray(q.calls[0].options.settingSources) && q.calls[0].options.settingSources.length === 0 && q.calls[0].options.strictMcpConfig === true && q.calls[0].options.mcpServers === undefined,
    JSON.stringify({ settingSources: q.calls[0].options.settingSources, strictMcpConfig: q.calls[0].options.strictMcpConfig }));

  const bad = scripted({ usd: 0.03, resultError: "the agent fell over" });
  let threw = null;
  try { await call({ half: "delivery", stage: "sdd", role: "writer", kind: "writer", system: "s", prompt: "p", cwd: root, ledger, _query: bad.query }); } catch (e) { threw = e; }
  const failed = rows(ledger)[1];
  check("a failed call still records its row — it billed", threw && failed?.ok === false && failed.usd === 0.03 && failed.error.includes("fell over"), JSON.stringify(failed));

  // A call is on the record before the model runs: a started row first, the outcome
  // after, the two joined by a call id — a process killed mid-call leaves the start.
  const seen = [];
  const watch = scripted({ usd: 0.07 });
  const watched = ({ prompt, options }) => { seen.push(readFileSync(ledger, "utf8").trim().split("\n").length); return watch.query({ prompt, options }); };
  await call({ half: "discovery", stage: "stories", role: "writer", kind: "writer", system: "s", prompt: "p", cwd: root, ledger, _query: watched });
  const raw = readFileSync(ledger, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const start = raw.at(-2), end = raw.at(-1);
  check("a started row is durable before the SDK is invoked — the query saw it on disk — naming half, stage, role, kind and model with the outcome still open, and no cost",
    seen[0] === 5 && start.ok === null && typeof start.call === "string" && start.call.length >= 8 && start.half === "discovery" && start.stage === "stories" && start.role === "writer" && start.kind === "writer" && start.model === "claude-opus-5" && !("usd" in start) && !("tools" in start), JSON.stringify({ seen, start }));
  check("the outcome row carries the same call id, so the two are one call on the record",
    end.call === start.call && end.ok === true && end.usd === 0.07 && end.at === start.at, JSON.stringify(end));
  check("rows() reads a call as one row — the outcome over the start, in the order calls began",
    rows(ledger).length === 3 && rows(ledger).at(-1).call === start.call && rows(ledger).at(-1).ok === true && rows(ledger).at(-1).usd === 0.07 && rows(ledger)[0].usd === 0.12 && rows(ledger)[1].ok === false, JSON.stringify(rows(ledger).map((r) => [r.call ?? "-", r.ok, r.usd])));
  // A row from before call ids (the ledgers Bakehouse already has) passes through as it is; a kill leaves the started row alone.
  // Both seeded through the ledger's own append — the eval cannot kill itself.
  appendLedger(ledger, { at: "2026-09-06T09:00:00.000Z", half: "discovery", stage: "stories", role: "writer", kind: "writer", model: "claude-opus-5", ok: true, usd: 0.01, ms: 5, turns: 1, tokens: { input: 1, output: 1, cache_read: 0, cache_create: 0 }, tools: [] });
  appendLedger(ledger, { call: "killed-1", at: "2026-09-06T10:00:00.000Z", half: "discovery", stage: "stories", role: "writer", kind: "writer", model: "claude-opus-5", ok: null });
  const after = rows(ledger);
  const t = tally(after);
  check("a killed call is on the record as a call whose outcome is unknown: counted, not priced, not history; the row without an id is read as it always was",
    after.length === 5 && after[3].usd === 0.01 && after.at(-1).ok === null && after.at(-1).call === "killed-1" && t.calls === 5 && Math.abs(t.usd - 0.23) < 1e-9 && t.unfinished === 1 && estimate(ledger, { half: "discovery", role: "writer" }).n === 3 && totals(ledger, ["half"]).discovery.unfinished === 1 && totals(ledger, ["half"]).discovery.calls === 4 && totals(ledger, ["half"]).delivery.unfinished === 0, JSON.stringify({ t, n: estimate(ledger, { half: "discovery", role: "writer" }).n, totals: totals(ledger, ["half"]) }));

  check("a call without a ledger is refused", await call({ half: "discovery", stage: "x", role: "writer", system: "s", prompt: "p", _query: q.query }).then(() => false, (e) => /ledger/.test(e.message)));
  check("a call from no half is refused", await call({ half: "shared", stage: "x", role: "writer", system: "s", prompt: "p", ledger, _query: q.query }).then(() => false, (e) => /half/.test(e.message)));
});

// ── R1 · budget ──
await withRoot({}, async (root) => {
  const ledger = join(root, "calls.jsonl");
  const q = scripted({ usd: 0.6 });
  const opts = { half: "discovery", stage: "prd", role: "writer", kind: "writer", system: "s", prompt: "p", ledger, _query: q.query, budget: 1.0 };
  await call(opts);
  await call(opts);
  let err = null;
  try { await call(opts); } catch (e) { err = e; }
  check("at the budget the call is refused before the model runs", err instanceof BudgetError && err.code === "budget" && q.calls.length === 2, `${q.calls.length} calls · ${err?.message}`);
  check("the refusal names what was spent and the cap", err?.spent === 1.2 && err?.budget === 1.0);
  const quoted = quote(ledger, { half: "discovery", role: "writer", budget: 1.0 });
  check("the quote a door shows: estimate from history, spent, remaining, over",
    quoted.estimate.basis === "history" && quoted.estimate.n === 2 && Math.abs(quoted.estimate.usd - 0.6) < 1e-9 && quoted.spent === 1.2 && quoted.remaining === 0 && quoted.over === true,
    JSON.stringify(quoted));
  const cold = quote(ledger, { half: "delivery", role: "judge", budget: 5 });
  check("with no history the estimate says so instead of inventing a number", cold.estimate.basis === "none" && cold.estimate.usd === null && cold.remaining === 5 - 1.2);
  check("uncapped is uncapped", quote(ledger, { half: "discovery", role: "writer" }).remaining === null);
});

// ── R1 · model per role ──
{
  check("the default model comes from one config", modelFor({ half: "delivery", role: "judge" }) === "claude-opus-5");
  check("a run's setup overrides per role", modelFor({ half: "delivery", role: "judge" }, { "delivery.judge": "claude-sonnet-5" }) === "claude-sonnet-5");
  let err = null;
  try { modelFor({ half: "discovery", role: "barista" }); } catch (e) { err = e; }
  check("an unknown role is refused, never defaulted", /no model configured for discovery\.barista/.test(err?.message ?? ""));
}

// ── R1 · usage pause ──
await withRoot({}, async (root) => {
  const ledger = join(root, "calls.jsonl");
  const waits = [];
  const q = scripted({ throwWith: ["usage limit reached — resets at 4pm", null], usd: 0.2 });
  const r = await call({ half: "delivery", stage: "qa", role: "judge", system: "s", prompt: "p", cwd: root, ledger, _query: q.query, _sleep: async (ms) => waits.push(ms) });
  check("a usage gap pauses and retries the whole call", r.usd === 0.2 && q.calls.length === 2 && waits.length === 1 && waits[0] === 5 * 60_000, `${q.calls.length} calls · waits ${waits}`);
  check("both attempts are on the ledger — the failed one is not hidden — each its own call, started and closed",
    rows(ledger).length === 2 && rows(ledger)[0].ok === false && rows(ledger)[1].ok === true && rows(ledger)[0].call !== rows(ledger)[1].call && readFileSync(ledger, "utf8").trim().split("\n").length === 4, JSON.stringify(rows(ledger).map((r) => [r.call, r.ok])));

  const q2 = scripted({ throwWith: ["TypeError: cannot read properties of undefined"] });
  const err = await call({ half: "delivery", stage: "qa", role: "judge", system: "s", prompt: "p", cwd: root, ledger, _query: q2.query, _sleep: async () => {} }).then(() => null, (e) => e);
  check("any other error rethrows at once", err && /TypeError/.test(err.message) && q2.calls.length === 1);
});

// ── R1 · the workshop turn is a metered call: quoted before, recorded after, one session ──
await withRoot({}, async (parent) => {
  const _exec = (cmd, args) => (cmd === "git" && args[0] === "remote" ? "git@github.com:acme/oven.git" : "");
  const { root } = setupProject({ slug: "oven", title: "Oven", parent, budget: 1.0, models: { "discovery.workshop": "claude-sonnet-5" }, _exec });
  openPrd({ root, title: "Oven", slug: "oven", seed: "A run sheet for one bakery." });

  const before = quoteTurn({ root, key: "problem" });
  check("before a turn the door has a quote: the model, no history yet, nothing spent, the cap",
    before.model === "claude-sonnet-5" && before.estimate.basis === "none" && before.spent === 0 && before.budget === 1.0 && before.remaining === 1.0, JSON.stringify(before));

  const q = scripted({ text: ["🔥 Who exactly is the baker?", "🏛️ Good — so the crux is the 4am handoff.\n\n[SECTION_COMPLETE]"], usd: [0.21, 0.19], sessionId: "sess-oven-1" });
  const t1 = await turn({ root, key: "problem", text: "A bakery run sheet.", _query: q.query });
  const t2 = await turn({ root, key: "problem", text: "The head baker, at 4am.", _query: q.query });
  const ledger = rows(join(root, "forge", "discovery", "calls.jsonl"));
  check("each turn is one ledger row under discovery/workshop/workshop with the model the project chose",
    ledger.length === 2 && ledger.every((r) => r.half === "discovery" && r.stage === "workshop" && r.role === "workshop" && r.kind === "converse" && r.model === "claude-sonnet-5") && ledger[0].usd === 0.21 && ledger[1].usd === 0.19,
    JSON.stringify(ledger));
  check("the turn returns what it cost", t1.usd === 0.21 && t1.model === "claude-sonnet-5" && t2.usd === 0.19);
  check("the first turn opens a session; the second resumes it — real multi-turn state, not a flattened transcript",
    q.calls[0].options.resume === undefined && q.calls[1].options.resume === "sess-oven-1" && t1.sessionId === "sess-oven-1" && t2.state.session_id === "sess-oven-1",
    JSON.stringify([q.calls[0].options.resume, q.calls[1].options.resume]));
  check("a conversant holds no tools — tools: [] reaches the SDK, one turn at a time",
    q.calls.every((c) => Array.isArray(c.options.tools) && c.options.tools.length === 0 && c.options.allowedTools.length === 0 && c.options.maxTurns === 1) && TOOLS.converse.allowed.length === 0 && TOOLS.extract.allowed.length === 0,
    JSON.stringify(q.calls[0].options));

  const after = quoteTurn({ root, key: "problem" });
  check("after two turns the quote has history: estimate is their mean, spent is their sum",
    after.estimate.basis === "history" && after.estimate.n === 2 && Math.abs(after.estimate.usd - 0.2) < 1e-9 && Math.abs(after.spent - 0.4) < 1e-9 && Math.abs(after.remaining - 0.6) < 1e-9, JSON.stringify(after));

  const dear = scripted({ text: "🔥 …", usd: 0.7 });
  await turn({ root, key: "shape", text: "An order has a life.", _query: dear.query });
  const refused = await turn({ root, key: "shape", text: "more", _query: dear.query }).then(() => null, (e) => e);
  check("at the project's cap the next turn is refused before the model runs", refused instanceof BudgetError && dear.calls.length === 1 && quoteTurn({ root, key: "shape" }).over === true, refused?.message);
});

// ── R1 · the estimate before a run: the round's shape times the ledger's history — never a rate card ──
await withRoot({}, async (tmp) => {
  const CLEAN = (item) => ({ findings: [], deferred: [{ subject: item, summary: `${item}: the signal dropping mid-write.`, beyond: "untested" }], checked: 1, skipped: 0 });
  const { disc, cold, handoff } = await seedDelivery(tmp, { slug: "tare" });
  const e0 = estimateRun(cold, { handoff });
  check("before any call the estimate has the round's shape — intake asks nothing of a model, sdd is one writer and one judge per work item the slicing will produce, build one builder per item and no judge — and no price: no history is 'no history', not a number",
    e0.stages.map((s) => `${s.stage}:${s.calls}`).join() === "intake:0,sdd:4,build:3" && e0.stages[1].roles.map((r) => `${r.role}×${r.calls}`).join() === "writer×1,judge×3" && e0.stages[2].roles.map((r) => `${r.role}×${r.calls}`).join() === "builder×3" && e0.stages.slice(1).every((s) => s.roles.every((r) => r.per_call === null && r.n === 0 && r.usd === null)) && e0.calls === 7 && e0.usd === null && e0.stages[0].usd === 0 && e0.standing.spent === 0, JSON.stringify(e0));
  check("the shape names the model each role would run on — the run's override where there is one, the shared default where there is not", e0.stages[1].roles.map((r) => r.model).join() === `${modelFor({ half: "delivery", role: "writer" })},${modelFor({ half: "delivery", role: "judge" })}` && estimateRun(cold, { handoff, models: { "delivery.judge": "claude-sonnet-5" } }).stages[1].roles[1].model === "claude-sonnet-5");

  const q = scripted({ structuredSeq: [BINDING, CLEAN("STORY-1"), CLEAN("STORY-2"), CLEAN("REQ-4")], usd: [0.9, 0.2, 0.3, 0.4] });
  await advance(cold, { _query: q.query, _now: () => new Date("2026-09-06T09:30:00Z") });
  const e1 = estimateRun(cold, { handoff, intake: readDoc(cold, "forge/delivery/intake.json") });
  check("after one sdd round its roles have history and the stage's estimate is arithmetic on it: the writer's mean once, the judges' mean per work item the intake sliced — and the run's total is still no number, because the builder has none",
    e1.stages[1].roles[0].per_call === 0.9 && e1.stages[1].roles[0].n === 1 && Math.abs(e1.stages[1].roles[1].per_call - 0.3) < 1e-9 && e1.stages[1].roles[1].n === 3 && Math.abs(e1.stages[1].usd - 1.8) < 1e-9 && e1.stages[2].usd === null && e1.usd === null && Math.abs(e1.standing.spent - 1.8) < 1e-9, JSON.stringify(e1.stages.slice(1)));
  check("history is per model, not per role: pointing the judge at a model it has never run on takes the price away again, and the run's total with it",
    estimateRun(cold, { handoff, models: { "delivery.judge": "claude-sonnet-5" } }).stages[1].roles[1].per_call === null && estimateRun(cold, { handoff, models: { "delivery.judge": "claude-sonnet-5" } }).stages[1].usd === null && estimateRun(cold, { handoff, models: { "delivery.judge": "claude-sonnet-5" } }).stages[1].roles[0].per_call === 0.9);
  check("standing is the spend against the run's budget: what remains, and over when the next round would already be refused",
    Math.abs(estimateRun(cold, { handoff, budget: 5 }).standing.remaining - 3.2) < 1e-9 && estimateRun(cold, { handoff, budget: 1.5 }).standing.over === true && estimateRun(cold, { handoff }).standing.budget === null);
  check("another cold root of the same project has no history of its own — the ledger is the run's, never borrowed", estimateRun(coldRoot(tmp, disc, "tare-2"), { handoff }).usd === null);
});

// ── R7 · rank and derive ──
{
  const many = [
    FINDING("low", "likely", 1), FINDING("high", "likely", 2), FINDING("medium", "certain", 3), FINDING("high", "certain", 4),
    FINDING("low", "certain", 5), FINDING("medium", "likely", 6), FINDING("high", "certain", 7),
  ];
  const ordered = rank(many);
  check("rank orders by severity × confidence, stable for ties, and keeps everything — there is no cap for a finding to fall off",
    ordered.map((f) => f.subject).join(",") === "STORY-4,STORY-7,STORY-2,STORY-3,STORY-6,STORY-5,STORY-1" && ordered.length === many.length,
    ordered.map((f) => f.subject).join(","));
  check("weight has one definition", weight(FINDING("high", "certain")) > weight(FINDING("high", "likely")) && weight(FINDING("high", "likely")) > weight(FINDING("medium", "certain")));
  check("certain + high blocks", deriveVerdict([FINDING("high", "certain", 1)]) === "block");
  check("likely + high advises — a human converts it", deriveVerdict([FINDING("high", "likely", 1)]) === "advise");
  check("medium and low advise", deriveVerdict([FINDING("medium", "certain", 1), FINDING("low", "likely", 2)]) === "advise");
  check("no findings pass", deriveVerdict([]) === "pass");
  check("a finding with no confidence is read as certain — malformed fails loudly", deriveVerdict([{ severity: "high" }]) === "block");

  // How the ranked findings reach the writer that must answer them.
  const shown = renderFindingsForAgent({
    gate: "story-reviewer", verdict: "advise", checked: 3,
    findings: [{ ...FINDING("high", "certain", 1), evidence: "AC-2 has no measurable outcome", remedy: "state the count" }, FINDING("medium", "likely", 2)],
    deferred: [{ subject: "STORY-9", summary: "wants a reporting view", beyond: "MVP line: no reporting" }],
  });
  check("render states each finding's authority in its own words — certain is an observation, likely a judgement",
    /1\. \[high\/certain\][\s\S]*CERTAIN — a literal observation[\s\S]*2\. \[medium\/likely\][\s\S]*LIKELY — a judgement call/.test(shown));
  check("render carries evidence and remedy, and names the gate, verdict and count", /evidence: AC-2/.test(shown) && /suggested: state the count/.test(shown) && /story-reviewer gate returned ADVISE .* over 3 item/.test(shown));
  check("render shows deferrals as not this round's work", /Deferred — [\s\S]*Do not address these:[\s\S]*STORY-9 — wants a reporting view \(beyond: MVP line: no reporting\)/.test(shown));
  check("nothing to show renders nothing, not an empty section", renderFindingsForAgent({ gate: "g", verdict: "pass", findings: [], deferred: [] }) === null && renderFindingsForAgent(null) === null);
}

// ── R7 · the judge runner, end to end on a scripted model ──
await withRoot({ "prompts/reviewer.md": IDENTITY }, async (root) => {
  const ledger = join(root, "calls.jsonl");
  const doc = stamp({ id: "STORY-1", statement: "As a baker…", "x-drift-checked": ["/statement"] });
  const structured = {
    findings: [FINDING("low", "likely", 1), FINDING("high", "likely", 2), FINDING("medium", "certain", 3), FINDING("high", "certain", 4), FINDING("low", "certain", 5), FINDING("medium", "likely", 6)],
    deferred: [{ subject: "SCREEN-9", summary: "inventory view", beyond: "the MVP line" }],
    checked: 6, skipped: 0,
  };
  const q = scripted({ structured, usd: 0.31 });
  const v = await runJudge({
    gate: "story-reviewer", half: "discovery", stage: "stories", identity: join(root, "prompts", "reviewer.md"),
    sections: [["Stories", "…"]], artifacts: [{ id: "STORY-1", path: "stories/STORY-1.json", doc }],
    scope: { mvp: "run sheet only" }, cwd: root, ledger, _query: q.query,
  });
  check("the verdict is derived over every finding returned, ranked, nothing cut and nothing counted as cut",
    v.verdict === "block" && v.findings.length === 6 && !("dropped" in v) && v.findings[0].subject === "STORY-4" && v.findings[5].subject === "STORY-1", JSON.stringify(v.findings.map((f) => f.subject)));
  check("deferrals ride through untouched and are never findings", v.deferred.length === 1 && v.deferred[0].subject === "SCREEN-9");
  check("the verdict pins what it judged", v.judged.length === 1 && v.judged[0].content_hash === doc.meta.content_hash && v.judged[0].path === "stories/STORY-1.json");
  check("the verdict carries its cost", v.cost.usd === 0.31 && v.cost.model === "claude-opus-5" && rows(ledger).length === 1 && rows(ledger)[0].role === "reviewer");
  const sys = q.calls[0].options.systemPrompt;
  check("the system prompt is identity then mechanics, and the output contract is on the wire",
    sys.startsWith("# Story reviewer") && /\n---\n\n# Mechanics/.test(sys) && /every in-scope finding/.test(sys) && q.calls[0].options.outputFormat.schema.required.includes("deferred"));
  // R7 forbids a cap on how many findings come back, not a ceiling on how long a field may be —
  // the contract's `maxLength` is stated with its field (coherence checks it), never as "at most N findings".
  check("no count cap on findings anywhere in the prompt (R7: rank means order, not trim)", !/at most \d+ (in-scope )?findings/.test(sys) && !/keep the \d+ that matter/.test(sys));
  check("a judge has no write surface", q.calls[0].options.allowedTools.join() === "Read,Glob,Grep");

  const wrote = scripted({ structured, toolUses: ["Write"] });
  const e1 = await runJudge({ gate: "g", half: "delivery", stage: "sdd", identity: join(root, "prompts", "reviewer.md"), cwd: root, ledger, _query: wrote.query }).then(() => null, (e) => e);
  check("a judge that wrote anything is refused", e1 && /no write surface/.test(e1.message), e1?.message);

  const silent = scripted({});
  const e2 = await runJudge({ gate: "g", half: "delivery", stage: "sdd", identity: join(root, "prompts", "reviewer.md"), cwd: root, ledger, _query: silent.query }).then(() => null, (e) => e);
  check("a judge with no structured output is refused", e2 && /no structured output/.test(e2.message));

  const malformed = scripted({ structured: { findings: [{ severity: "high", rule: "r", subject: "s", summary: "s", evidence: "e" }], deferred: [], checked: 1, skipped: 0 } });
  const e3 = await runJudge({ gate: "g", half: "delivery", stage: "sdd", identity: join(root, "prompts", "reviewer.md"), cwd: root, ledger, _query: malformed.query }).then(() => null, (e) => e);
  check("a finding without confidence does not validate — the schema refuses the guess", e3 && /does not validate/.test(e3.message) && /confidence/.test(e3.message), e3?.message);
});

// ── R7 · per-item merge ──
await withRoot({ "prompts/j.md": IDENTITY }, async (root) => {
  const ledger = join(root, "calls.jsonl");
  let n = 0;
  const query = (args) => {
    n++;
    if (n === 2) throw new Error("boom");
    return scripted({ structured: { findings: [FINDING("medium", "likely", n)], deferred: [], checked: 1, skipped: 0 } }).query(args);
  };
  const { verdict, items } = await runPerItemJudge({
    gate: "design-judge", half: "discovery", stage: "design", identity: join(root, "prompts", "j.md"), cwd: root, ledger, _query: query,
    items: [{ id: "SCREEN-1", sections: [["a", "b"]] }, { id: "SCREEN-2", sections: [["a", "b"]] }, { id: "SCREEN-3", sections: [["a", "b"]] }],
  });
  check("an item whose judge failed is a certain + high finding, so the stage blocks",
    verdict.verdict === "block" && verdict.findings.some((f) => f.rule === "judge-failed" && f.subject === "SCREEN-2") && verdict.skipped === 1 && verdict.checked === 2,
    JSON.stringify(verdict));
  check("per-item verdicts ride alongside", items.length === 2 && items.map((i) => i.id).join() === "SCREEN-1,SCREEN-3");
});

// ── R6: rounds are capped and the cap is a door — the economics of a stage that keeps blocking ──
{
  const refusal = (fn) => { try { fn(); return null; } catch (e) { return e; } };
  const stages = Object.fromEntries(["intake", "sdd", "build", "qa", "release"].map((s) => [s, { status: "pending", round: 0, started_at: null, heartbeat_at: null, finished_at: null, verdict: null }]));
  let run = { id: "p", handoff: { version: 1, path: "h", content_hash: "x" }, created_at: "2026-09-05T12:00:00.000Z", by: "Brad", ...DEFAULTS, budget: null, models: {}, stages, flags: [] };
  const block = { verdict: "block", path: "forge/delivery/reviews/build-block.json" };
  const go = (event, ctx = {}) => { run = apply(run, { stage: "build", event, by: "wrapper", verdict: block, fresh: true, ...ctx }).run; return run.stages.build; };
  go("start"); go("finish"); go("regenerate"); go("finish");
  check("R6: with the §10.5 cap of 2, two blocking rounds is the most the arithmetic spends on its own — the third is refused at-cap",
    run.stages.build.round === 2 && refusal(() => go("regenerate"))?.code === "at-cap" && run.stages.build.status === "review");
  check("the cap lands in blocked, a state with no automatic exit: regenerate is not a transition from it",
    go("cap", { by: "runner" }).status === "blocked" && refusal(() => go("regenerate"))?.code === "no-transition");
  check("an escalation with a reason buys exactly one more round, to the ceiling of 3; the ceiling refuses the next",
    go("escalate", { by: "Brad", reason: "the judge read the fixture, not the change" }).status === "running" && go("finish").round === 3 && go("cap", { by: "runner" }).status === "blocked" && refusal(() => go("escalate", { by: "Brad", reason: "again" }))?.code === "at-ceiling");
  check("at the ceiling the block is the human's call: approve on the record leaves a flag naming the guard; stop takes a reason",
    go("approve", { by: "Brad", reason: "the residual is documented in the manifest", override: true }).status === "approved" && run.flags.filter((f) => f.override).length === 1 && run.flags.at(-1).guard === "judge-blocked" && run.flags.map((f) => f.event).join() === "escalate,approve");
}

// ── R6 · the loop on a cold root: writer → arithmetic → judge → door; the cap; the human's doors ──
{
  const refusal = (fn) => Promise.resolve().then(fn).then(() => null, (e) => e);
  const clone = () => structuredClone(BINDING);
  const BAD = clone(); BAD.items[0].controls.push({ screen_ref: "SCREEN-1", control: "submit" });
  // the second writer fixes STORY-1 — and rephrases STORY-2's risks, which nothing named
  const CHURNED = clone(); CHURNED.items[1].risks = ["the run sheet's order is the store's — a sort would be a design change"];
  const CLEAN = (item) => ({ findings: [], deferred: [{ subject: item, summary: `${item}: the second recording against the same delivery in the same second.`, beyond: "untested" }], checked: 1, skipped: 0 });
  const PROVES_NOTHING = { ...CLEAN("STORY-1"), findings: [{ severity: "high", confidence: "certain", rule: "test-proves-nothing", subject: "T-2", summary: "T-2 asserts that no exported function changes the row without naming a function that is called or what is read afterwards.", evidence: "asserts: \"no exported function changes the row\" · REQ-1/AC-2: A submitted exception cannot be edited.", remedy: "Name the calls attempted and the read that follows each." }] };
  // a scripted SDK that yields slowly, so the wrapper's pulse has something to beat under
  const slow = (q, ms = 6) => (a) => { const it = q(a); return (async function* () { for await (const m of it) { await new Promise((r) => setTimeout(r, ms)); yield m; } })(); };
  let t = Date.parse("2026-09-06T09:00:00Z");
  const clock = () => new Date((t += 1000));

  await withRoot({}, async (tmp) => {
    const { cold } = await seedDelivery(tmp);
    const events = [];
    const script = scripted({ structuredSeq: [BAD, CHURNED, PROVES_NOTHING, CLEAN("STORY-2"), CLEAN("REQ-4"), BINDING, CLEAN("STORY-1"), CLEAN("STORY-2"), CLEAN("REQ-4")] });
    const opts = { _query: slow(script.query), _now: clock, _pulse_ms: 1, onEvent: (e) => events.push(e) };

    check("the loop knows which stages it can run — intake, sdd and build — and says so in one table; build has a writer and no judge",
      Object.keys(AUTHORED).join() === "intake,sdd,build" && AUTHORED.intake.writer === false && AUTHORED.sdd.writer === true && AUTHORED.build.writer === true && PULSE_MS === 15_000);
    const order = await refusal(() => runStage(cold, { stage: "sdd", ...opts }));
    const unauthored = await refusal(() => runStage(cold, { stage: "qa", ...opts }));
    const nostage = await refusal(() => runStage(cold, { stage: "ship", ...opts }));
    check("a stage runs from an approved one: sdd before intake is stage-order; qa is stage-unauthored (M3); a name that is not a stage is no-stage — nothing was called",
      order?.code === "stage-order" && /intake is pending/.test(order.message) && unauthored?.code === "stage-unauthored" && nostage?.code === "no-stage" && script.calls.length === 0, `${order?.code} ${unauthored?.code} ${nostage?.code}`);

    const r0 = await runStage(cold, { stage: "intake", ...opts });
    check("intake: no writer, the compile is the round — the snapshot's open questions advise, a non-block approves in one episode, round 1, zero model calls",
      r0.status === "approved" && r0.round === 1 && r0.verdict.verdict === "advise" && r0.verdict.findings.every((f) => f.rule === "question") && r0.cost.calls === 0 && r0.cost.usd === 0 && script.calls.length === 0, JSON.stringify(r0.verdict?.findings));
    check("an approved stage is done — run again is stage-done", (await refusal(() => runStage(cold, { stage: "intake", ...opts })))?.code === "stage-done");

    const r1 = await runStage(cold, { stage: "sdd", ...opts });
    const v1 = r1.verdict;
    check("R6: sdd round 1 blocks on the arithmetic (no judge called — R1), regenerates; round 2 blocks on the judge; round 2 is the cap — blocked, the human's doors",
      r1.status === "blocked" && r1.round === 2 && v1.verdict === "block" && v1.findings[0].rule === "test-proves-nothing" && script.calls.length === 5, `${r1.status} r${r1.round} calls ${script.calls.length}`);
    check("the round-1 verdict was filed with no judge cost; the round-2 verdict merges the judges' — three items, cost the judges', pinned to the handoff, the intake record and the binding",
      Math.abs(v1.cost.usd - 0.15) < 1e-9 && v1.checked === 6 + 3 && v1.judged.map((j) => j.id).join() === "handoff-v1,intake-dock,sdd-dock" && v1.judged.map((j) => j.path).join() === `discovery/handoffs/handoff-v1.json,forge/delivery/intake.json,${SDD_FILE}`, JSON.stringify(v1.judged));
    check("the falsification deferral: one per item, keyed `untested`, riding beside the findings and never among them",
      v1.deferred.length === 3 && v1.deferred.every((d) => d.beyond === "untested") && v1.deferred.map((d) => d.subject).join() === "STORY-1,STORY-2,REQ-4");
    check("R1: five calls on the ledger for delivery/sdd — two writers, three judges — each with model, cost and tokens; the result's cost is their sum",
      r1.cost.calls === 5 && Math.abs(r1.cost.usd - 0.25) < 1e-9 && rows(join(cold, LEDGER)).filter((r) => r.half === "delivery" && r.stage === "sdd").map((r) => r.role).join() === "writer,writer,judge,judge,judge" && rows(join(cold, LEDGER)).every((r) => r.model && r.tokens && r.ok), rows(join(cold, LEDGER)).map((r) => `${r.stage}/${r.role}`).join());
    const p0 = script.calls[0].prompt, p1 = script.calls[1].prompt, pj = script.calls[2].prompt;
    check("the first writer prompt carries the work items, the signed design and no previous binding; the second carries the previous binding and the arithmetic's finding, quoted",
      /^## Work items/.test(p0) && /## The signed design/.test(p0) && !/previous binding/.test(p0) && /## The previous binding/.test(p1) && /## The judge's findings on the previous binding/.test(p1) && /control-not-in-design/.test(p1) && /`submit`/.test(p1), p1.slice(-400));
    check("the second writer is told, per item, what the round may do: STORY-1 to revise, named by the arithmetic's finding; STORY-2 and REQ-4 to carry verbatim",
      /### STORY-1 — revise: STORY-1 \(control-not-in-design\)/.test(p1) && /### STORY-2 — carry verbatim/.test(p1) && /### REQ-4 — carry verbatim/.test(p1), p1.slice(p1.indexOf("## The previous binding"), p1.indexOf("## The previous binding") + 400));
    const carried = v1.findings.filter((f) => f.rule === "item-carried");
    check("the second writer rephrased STORY-2's risks with nothing naming it: the binding on disk carries the previous STORY-2 verbatim, and the round's verdict files the churn — low, certain, beside the judge's block",
      carried.length === 1 && carried[0].subject === "STORY-2" && carried[0].severity === "low" && carried[0].confidence === "certain" && loadSdd(cold).items[1].risks.length === 0 && loadSdd(cold).items[0].controls.length === 2, JSON.stringify([carried, loadSdd(cold).items[1].risks]));
    check("a judge sees one item: the work item, the screens it runs on, its binding, the interfaces the others name",
      /^## The work item/.test(pj) && /## The signed design — the screens this item runs on/.test(pj) && /## The binding/.test(pj) && /## Interfaces the other items name/.test(pj) && /STORY-2 · `deliveries.forShift`/.test(pj) && !/STORY-2 · `exceptions.record`/.test(pj), pj.slice(0, 300));
    check("the contract's vocabulary reaches the writer and every judge — a term the PRD defines is not a question for the binding to ask",
      /## Vocabulary — the contract's words\n\n- \*\*exception\*\*: A shortfall or damage/.test(p0) && /\*\*run sheet\*\*/.test(p0) && /## Vocabulary — the contract's words[\s\S]*\*\*exception\*\*/.test(pj) && script.calls.slice(2, 5).every((c) => /\*\*run sheet\*\*: The deliveries expected in a shift/.test(c.prompt)), p0.slice(0, 200));
    check("the judge's system prompt names the arithmetic as checked elsewhere (R10); the writer's output contract is the sdd schema without the runner's fields — items and questions, nothing about traces or the stamp",
      /## Checked elsewhere[^#]*`item-unbound`[^#]*`interface-disagrees`/.test(script.calls[2].options.systemPrompt) && script.calls[0].options.outputFormat.schema.required.join() === "items,questions" && !("traces" in script.calls[0].options.outputFormat.schema.properties), JSON.stringify(script.calls[0].options.outputFormat.schema.required));
    check("the wrapper narrates the doors: regenerating at round 1 of 2, blocked at the cap at round 2 of 2",
      events.includes("sdd block · round 1 of 2 — regenerating") && events.includes("sdd block · round 2 of 2 — blocked at the cap"), events.join(" | "));
    const stuck = await refusal(() => runStage(cold, { stage: "sdd", ...opts }));
    check("blocked has no automatic exit: run again is stage-blocked, and the message names the doors", stuck?.code === "stage-blocked" && /escalate with a reason, approve on the record, or stop/.test(stuck.message));
    const wordless = await refusal(() => escalate(cold, { stage: "sdd", by: "Brad", ...opts }));
    check("an escalation without a reason is refused before anything runs", wordless?.code === "reason-required" && script.calls.length === 5);

    const before = readRun(cold).stages.sdd;
    const r2 = await escalate(cold, { stage: "sdd", by: "Brad", reason: "the assertion is checkable as written — one more round", ...opts });
    check("escalate with a reason buys one round: the writer answers the recorded block, the judges clear it, approved at round 3 — and the flag names who and why",
      r2.status === "approved" && r2.round === 3 && r2.verdict.verdict === "pass" && r2.run.flags.length === 1 && r2.run.flags[0].event === "escalate" && r2.run.flags[0].by === "Brad" && /one more round/.test(r2.run.flags[0].reason), JSON.stringify(r2.run.flags));
    check("the escalated round's writer saw the judge's finding it was bought to answer", /## The judge's findings on the previous binding/.test(script.calls[5].prompt) && /test-proves-nothing/.test(script.calls[5].prompt));
    check("the escalated round's writer saw the churn filed against it too, and the carry's finding did not open STORY-2 — STORY-1 to revise for T-2, STORY-2 still to carry",
      /item-carried/.test(script.calls[5].prompt) && /### STORY-1 — revise: T-2 \(test-proves-nothing\)/.test(script.calls[5].prompt) && /### STORY-2 — carry verbatim/.test(script.calls[5].prompt), script.calls[5].prompt.slice(script.calls[5].prompt.indexOf("## The previous binding"), script.calls[5].prompt.indexOf("## The previous binding") + 300));
    check("R1: nine calls, $0.45, all on one ledger; the result's cost is the stage's whole spend across episodes",
      r2.cost.calls === 9 && Math.abs(r2.cost.usd - 0.45) < 1e-9 && script.calls.length === 9);
    const after = readRun(cold).stages.sdd;
    check("the wrapper's pulse wrote the heartbeat while the stage's code ran — the last beat is after the start, and the finish was stamped by the clock",
      Date.parse(after.heartbeat_at) > Date.parse(after.started_at) && Date.parse(after.finished_at) >= Date.parse(after.heartbeat_at) && Date.parse(after.started_at) > Date.parse(before.finished_at), JSON.stringify({ before, after }));
    check("the binding on disk is the approved one, traced to the handoff it was bound from", loadSdd(cold).items.length === 3 && loadSdd(cold).traces.handoff.version === 1 && readDoc(cold, SDD_VERDICT).verdict === "pass");
    const rest = await advance(cold, opts);
    check("advance over an approved run: nothing to do until build, which refuses — this cold root is no repository — halted there with the refusal's code, the stage stopped on the record with the reason, no call made",
      rest.stages.length === 0 && rest.halted?.why === "no-repo" && rest.halted.stage === "build" && readRun(cold).stages.build.status === "stopped" && /no-repo/.test(readRun(cold).flags.at(-1).reason) && script.calls.length === 9, JSON.stringify([rest.halted, readRun(cold).flags.at(-1)]));

    // Every filed verdict is kept with what it judged (R8): the next round overwrites both on their fixed
    // paths, and a judge miss — a finding a later verdict contradicts — is only attributable while the
    // earlier round can still be read. Numbered across episodes, since a new episode counts from zero.
    const kept = rounds(cold, "sdd");
    check("R8: three sdd verdicts were filed — arithmetic block, judge block, escalated pass — and all three are on the record as they were filed, numbered across episodes",
      kept.map((k) => `${k.seq}:${k.round}:${k.event}:${k.verdict.verdict}`).join() === "1:1:finish:block,2:2:finish:block,3:3:finish:pass", JSON.stringify(kept.map((k) => [k.seq, k.round, k.event, k.verdict?.verdict])));
    const first = readDoc(cold, join(kept[0].dir, "sdd.json"));
    check("the round-1 binding is kept beside its verdict, exactly what was judged: its hash is the verdict's pin, and it is not the binding on disk now",
      first?.meta.content_hash === kept[0].verdict.judged.find((j) => j.path === SDD_FILE).content_hash && first.meta.content_hash !== loadSdd(cold).meta.content_hash, JSON.stringify(kept[0]));
    check("what is kept is what the verdict pinned under the record — the intake record and the binding, none stale; the handoff is not copied, being versioned outside the record",
      kept[0].kept.map((k) => k.path).join() === `forge/delivery/intake.json,${SDD_FILE}` && kept[0].stale.length === 0 && !existsSync(join(cold, kept[0].dir, "handoff-v1.json")) && existsSync(join(cold, kept[0].dir, "intake.json")), JSON.stringify(kept[0].kept));
    check("intake's one round keeps its verdict alone — intake pins the handoff, not the record it compiles", rounds(cold, "intake").length === 1 && rounds(cold, "intake")[0].kept.length === 0 && rounds(cold, "intake")[0].verdict.verdict === "advise" && rounds(cold, "build").length === 0);
  });

  // A stage whose code throws is stopped on the record, by the wrapper, with the error as the reason; it starts again from stopped.
  await withRoot({}, async (tmp) => {
    const { cold } = await seedDelivery(tmp, { slug: "silo" });
    const broken = scripted({ throwWith: "the socket closed" });
    const events = [];
    const failed = await refusal(() => advance(cold, { _query: broken.query, _now: clock, onEvent: (e) => events.push(e) }));
    const st = readRun(cold).stages;
    check("advance ran intake to approved, then sdd's writer threw: the error surfaces, the stage is stopped by the wrapper with the error as its reason, the ledger holds the failed call",
      failed?.message === "the socket closed" && st.intake.status === "approved" && st.sdd.status === "stopped" && readRun(cold).flags.at(-1).event === "stop" && readRun(cold).flags.at(-1).by === "wrapper" && readRun(cold).flags.at(-1).reason === "Error: the socket closed" && rows(join(cold, LEDGER)).filter((r) => r.stage === "sdd").every((r) => r.ok === false), JSON.stringify(readRun(cold).flags));
    check("the wrapper said so", events.at(-1) === "sdd stopped — Error: the socket closed", events.join(" | "));
    const good = scripted({ structuredSeq: [BINDING, CLEAN("STORY-1"), CLEAN("STORY-2"), CLEAN("REQ-4")] });
    const again = await advance(cold, { _query: good.query, _now: clock });
    check("from stopped, start opens a new episode: the round is counted from zero, sdd approves at round 1, and advance halts at build's refusal (no repository here)",
      again.stages.length === 1 && again.stages[0].stage === "sdd" && again.stages[0].status === "approved" && again.stages[0].round === 1 && again.halted?.why === "no-repo" && again.halted.stage === "build" && good.calls.length === 4, JSON.stringify(again.halted));

    // A live stage is left alone; a dead one is restarted with a flag; a dead re-judge has no door but stop.
    transition(cold, { stage: "sdd", event: "stop", by: "Brad", reason: "the binding names a store the product does not have", now: clock() });
    transition(cold, { stage: "sdd", event: "start", by: "runner", now: clock() });
    const alive = await refusal(() => runStage(cold, { stage: "sdd", _query: good.query, _now: () => new Date(t) }));
    check("a running stage with a fresh heartbeat is stage-running — the loop does not run over live work", alive?.code === "stage-running" && /alive/.test(alive.message));
    const recovered = await runStage(cold, { stage: "sdd", _query: scripted({ structuredSeq: [BINDING, CLEAN("STORY-1"), CLEAN("STORY-2"), CLEAN("REQ-4")] }).query, _now: () => new Date(t + DEFAULTS.liveness_ms + 1) });
    check("a running stage silent past the window is dead: start recovers it with a flag on the record and the episode runs to approved",
      recovered.status === "approved" && recovered.run.flags.some((f) => f.reason === "restarted over a dead stage" && f.event === "start" && /silent 300001 ms, window 300000 ms/.test(f.note)), JSON.stringify(recovered.run.flags.at(-1)));
    transition(cold, { stage: "sdd", event: "moved", by: "runner", reason: "handoff v1 → v2 (simulated)", now: clock() });
    transition(cold, { stage: "sdd", event: "rejudge", by: "runner", now: clock() });
    const dead = await refusal(() => runStage(cold, { stage: "sdd", _query: good.query, _now: () => new Date(t + DEFAULTS.liveness_ms + 1) }));
    check("a dead re-judge is not restarted by the loop — stage-dead: stop it with a reason, then start", dead?.code === "stage-dead" && /stop it with a reason/.test(dead.message));
  });
}

// ── R1 in build: one builder per item that needs building, nothing for one that stands; the verdict costs nothing; the estimate learns the builder's price ──
await withRoot({}, async (tmp) => {
  const { cold, handoff, intake } = await seedBuild(tmp, { slug: "silt", files: { "README.md": "# Silt\n" } });
  const ledger = join(cold, LEDGER);
  const spentBefore = rows(ledger).length;
  const events = [];
  // Round 1: STORY-1 built, STORY-2 blocked → the round halts, REQ-4 unbuilt → block → regenerate under the cap.
  // Round 2: STORY-1 stands (no call), STORY-2 built, REQ-4 built → pass → approved at round 2.
  const b = builder([BUILT(), BLOCKED("the design has no delivery-row control on SCREEN-2"), BUILT("Run sheet built."), BUILT("Queue built.")], {
    0: (cwd) => put(cwd, "src/exceptions/store.js", "a"),
    2: (cwd) => put(cwd, "src/deliveries/store.js", "b"),
    3: (cwd) => put(cwd, "src/queue/q.js", "c"),
  }, { usd: [0.7, 0.1, 0.5, 0.3] });
  const r = await runStage(cold, { stage: "build", _query: b.query, onEvent: (e) => events.push(e) });
  check("the loop runs build as a writer stage with no judge: round 1 blocks on the arithmetic and regenerates under the cap; round 2 passes — approved at round 2, four builder calls in all",
    r.status === "approved" && r.round === 2 && r.verdict.verdict === "pass" && b.calls.length === 4 && events.includes("build block · round 1 of 2 — regenerating"), `${r.status} r${r.round} · ${events.join(" | ")}`);
  check("R1: the stage's cost is the builders' — four rows on the ledger for delivery/build/builder, $1.60 — and the verdict itself cost nothing: no model on it",
    r.cost.calls === 4 && Math.abs(r.cost.usd - 1.6) < 1e-9 && rows(ledger).slice(spentBefore).map((x) => `${x.stage}/${x.role}/${x.kind}`).join() === Array(4).fill("build/builder/builder").join() && r.verdict.cost.model === "none" && r.verdict.cost.usd === 0, JSON.stringify(r.cost));
  const doc = loadBuild(cold);
  check("round 2 kept STORY-1 for $0 — reused, the round-1 commit, no call with its item in the prompt — and built the other two",
    doc.items.map((i) => `${i.work_item}:${i.status}:${i.reused ? 1 : 0}`).join() === "STORY-1:built:1,STORY-2:built:0,REQ-4:built:0" && b.calls.slice(2).every((c) => !/### STORY-1 — story/.test(c.prompt)) && events.some((e) => /STORY-1 reused — binding unchanged/.test(e)) && gitIn(cold, ["log", "--format=%s", BRANCH]).split("\n").length === 4, events.join(" | "));
  check("R8: both rounds' verdicts are kept with the build record they judged", rounds(cold, "build").map((k) => `${k.round}:${k.verdict.verdict}`).join() === "1:block,2:pass" && rounds(cold, "build")[0].kept.some((k) => k.path === "forge/delivery/build.json"), JSON.stringify(rounds(cold, "build").map((k) => [k.round, k.verdict.verdict, k.kept.map((x) => x.path)])));
  const e = estimateRun(cold, { handoff, intake });
  check("the estimate now prices a build: the builder's mean over its four calls, times one per item — a number from history",
    Math.abs(e.stages[2].roles[0].per_call - 0.4) < 1e-9 && e.stages[2].roles[0].n === 4 && e.stages[2].calls === 3 && Math.abs(e.stages[2].usd - 1.2) < 1e-9, JSON.stringify(e.stages[2]));
});

done();
