#!/usr/bin/env node
// owns: R1, R7 · shared — eval: economics. Every model call is recorded with model,
// tokens, cost and duration by half, stage and role; the budget refuses a call before
// the model runs; the model is chosen per role from one config; a usage gap pauses;
// and judges are ranked to k with the verdict derived, never read. R6 (the round cap)
// joins this suite at M2 with the transition table. No model is ever called here — the
// SDK is replaced by a scripted query.

import { join } from "node:path";
import { suite, withRoot, scripted } from "./_harness.mjs";
import { call, BudgetError, rows, quote, modelFor, TOOLS } from "../shared/agent-call/index.mjs";
import { runJudge, runPerItemJudge, rank, deriveVerdict, weight, renderFindingsForAgent } from "../shared/judge/index.mjs";
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

  const bad = scripted({ usd: 0.03, resultError: "the agent fell over" });
  let threw = null;
  try { await call({ half: "delivery", stage: "sdd", role: "writer", kind: "writer", system: "s", prompt: "p", ledger, _query: bad.query }); } catch (e) { threw = e; }
  const failed = rows(ledger)[1];
  check("a failed call still records its row — it billed", threw && failed?.ok === false && failed.usd === 0.03 && failed.error.includes("fell over"), JSON.stringify(failed));

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
  const r = await call({ half: "delivery", stage: "qa", role: "judge", system: "s", prompt: "p", ledger, _query: q.query, _sleep: async (ms) => waits.push(ms) });
  check("a usage gap pauses and retries the whole call", r.usd === 0.2 && q.calls.length === 2 && waits.length === 1 && waits[0] === 5 * 60_000, `${q.calls.length} calls · waits ${waits}`);
  check("both attempts are on the ledger — the failed one is not hidden", rows(ledger).length === 2 && rows(ledger)[0].ok === false && rows(ledger)[1].ok === true);

  const q2 = scripted({ throwWith: ["TypeError: cannot read properties of undefined"] });
  const err = await call({ half: "delivery", stage: "qa", role: "judge", system: "s", prompt: "p", ledger, _query: q2.query, _sleep: async () => {} }).then(() => null, (e) => e);
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

// ── R7 · rank and derive ──
{
  const many = [
    FINDING("low", "likely", 1), FINDING("high", "likely", 2), FINDING("medium", "certain", 3), FINDING("high", "certain", 4),
    FINDING("low", "certain", 5), FINDING("medium", "likely", 6), FINDING("high", "certain", 7),
  ];
  const { kept, dropped } = rank(many, 5);
  check("rank keeps k, ordered by severity × confidence, stable for ties",
    kept.map((f) => f.subject).join(",") === "STORY-4,STORY-7,STORY-2,STORY-3,STORY-6" && dropped.map((f) => f.subject).join(",") === "STORY-5,STORY-1",
    kept.map((f) => f.subject).join(","));
  check("a blocking finding is never the one dropped", dropped.every((f) => !(f.severity === "high" && f.confidence === "certain")));
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
    k: 5, scope: { mvp: "run sheet only" }, cwd: root, ledger, _query: q.query,
  });
  check("the verdict is derived over the k kept, with the cut counted",
    v.verdict === "block" && v.findings.length === 5 && v.dropped === 1 && v.findings[0].subject === "STORY-4", JSON.stringify(v.findings.map((f) => f.subject)));
  check("deferrals ride through untouched and never count against k", v.deferred.length === 1 && v.deferred[0].subject === "SCREEN-9");
  check("the verdict pins what it judged", v.judged.length === 1 && v.judged[0].content_hash === doc.meta.content_hash && v.judged[0].path === "stories/STORY-1.json");
  check("the verdict carries its cost", v.cost.usd === 0.31 && v.cost.model === "claude-opus-5" && rows(ledger).length === 1 && rows(ledger)[0].role === "reviewer");
  const sys = q.calls[0].options.systemPrompt;
  check("the system prompt is identity then mechanics, and the output contract is on the wire",
    sys.startsWith("# Story reviewer") && /\n---\n\n# Mechanics/.test(sys) && /at most 5 in-scope findings/.test(sys) && q.calls[0].options.outputFormat.schema.required.includes("deferred"));
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

done();
