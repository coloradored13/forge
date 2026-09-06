// owns: R1, R10 · delivery — the run view and its doors. One page: before a run, the setup
// (project repo verified · models · budget · cap · estimate); after, every stage with its
// state in the machine's word, round n of cap, verdict, cost and doors, then the findings,
// the flags, the funnel. Every trigger is a form on a door — the loop's episode, or a
// transition through the one table — with the cost shown first (R1). Nothing here reads
// the record but through the view, nothing moves it but through the doors, and a refusal
// is the door's own words. Composed with Discovery's routes by tools/console.

import { esc, usd, when, short, badge, table, dl, form, verdictLine, findingsHtml } from "../../shared/console/index.mjs";
import { STAGES, createRun, transition, adoptHandoff } from "../state/index.mjs";
import { runStage, escalate, advance } from "../run/index.mjs";
import { runView } from "./views.mjs";

const STATE = { approved: "ok", running: "warn", rejudging: "warn", review: "warn", stale: "warn", blocked: "bad", dead: "bad", pending: "muted", stopped: "muted" };
const blank = (s) => (s?.trim() ? s.trim() : undefined);
const num = (s, fallback) => (blank(s) === undefined ? fallback : Number(s));
const by = { name: "by", label: "by", required: true };
const reason = { name: "reason", label: "reason — on the record", required: true };

// ── the estimate ──

/** The round's shape times the ledger's history; no number where there is no history. */
function estimateHtml(e) {
  if (!e) return `<p class="muted">no estimate — the run's snapshot could not be read</p>`;
  const rows = e.stages.map((s) => [esc(s.stage), s.calls ? s.roles.map((r) => `${r.calls} ${esc(r.role)} <code>${esc(r.model)}</code>`).join("<br>") : `<span class="muted">no model calls</span>`, s.calls ? s.roles.map((r) => (r.per_call == null ? `<span class="muted">no history yet</span>` : `~${usd(r.per_call)} a call (${r.n} so far)`)).join("<br>") : "", s.usd == null ? (s.calls ? "—" : usd(0)) : `~${usd(s.usd)}`]);
  const total = e.usd == null ? `${e.calls} calls a round · no Delivery history to price them yet` : `${e.calls} calls a round · ~${usd(e.usd)}`;
  const st = e.standing;
  const standing = st.budget == null ? `${usd(st.spent)} spent · no cap` : `${usd(st.spent)} of ${usd(st.budget)} spent · ${usd(st.remaining)} remains`;
  return `<p class="quote${st.over ? " over" : ""}">${esc(total)} · ${esc(standing)}${st.over ? " · " + badge("over budget", "bad") : ""}</p>` + table(["stage", "calls a round", "from history", "≈ usd"], rows);
}

const rolesTable = (rs) => table(["role", "model", ""], rs.map((r) => [`<code>${esc(r.key)}</code>`, `<code>${esc(r.model)}</code>`, r.overridden ? badge(`override · default ${r.default}`, "warn") : badge("default", "muted")]));
/** The ledger's arithmetic in one line; a call the process died inside of is counted and named, never priced. */
const costLine = (c) => `${c.calls} calls · ${usd(c.usd)}${c.unfinished ? ` · ${badge(`${c.unfinished} unfinished`, "warn")}` : ""}`;
const handoffRow = (h) => [`v${h.version} <code>${esc(short(h.hash))}</code>`, esc(h.exit), esc(h.by), when(h.exported_at), h.signed ? badge("signed", "ok") : badge("unsigned", "muted"), h.cost ? `${usd(h.cost.usd)} · ${h.cost.calls ?? 0} calls` : "—", h.refusal ? `${badge(h.refusal.code, "bad")}<br><span class="muted">${esc(h.refusal.message)}</span>` : badge("takeable", "ok")];

// ── setup ──

function setupPage(v) {
  const takeable = v.handoffs.filter((h) => !h.refusal);
  const setup = !v.project ? `<p class="refusal">${esc(v.root)} has no <code>.git</code> — Delivery runs in the project's repository.</p>`
    : !takeable.length ? `<p class="refusal">No handoff Delivery may take. Export one through the Delivery exit, with the design signed.</p>`
      : form({
        action: "/run/setup", submit: "Set up",
        fields: [
          by,
          { name: "version", label: "handoff", type: "select", required: true, value: v.offer, options: takeable.map((h) => [h.version, `v${h.version} · ${h.exit} · ${when(h.exported_at)}`]) },
          { name: "cap", label: "cap — judged rounds before a block is the human's", type: "number", value: v.defaults.cap },
          { name: "ceiling", label: "ceiling — rounds a human may buy up to", type: "number", value: v.defaults.ceiling },
          { name: "liveness", label: "liveness window in minutes — silence past it reads as dead", type: "number", value: v.defaults.liveness_ms / 60_000 },
          { name: "budget", label: "budget in USD (blank: no cap — the run pauses at it, never degrades)", type: "number", step: "0.01", value: "" },
          ...v.roles.map((r) => ({ name: `model.${r.key}`, label: `model · ${r.key}`, value: r.model })),
        ],
        note: "One record, every stage pending. A later handoff is adopted onto this run — approved stages go stale and are re-judged, never run afresh.",
      });
  return { title: "Delivery run", body: `<h1>Set up Delivery</h1><p class="muted">${esc(v.root)}</p>`
    + `<h2>Handoffs</h2>${table(["handoff", "exit", "by", "exported", "design", "Discovery cost", "may Delivery take it?"], v.handoffs.map(handoffRow))}`
    + `<h2>Estimate</h2>${v.estimate ? estimateHtml(v.estimate) : `<p class="muted">nothing to estimate until a handoff is takeable</p>`}`
    + `<h2>Model per role</h2>${rolesTable(v.roles)}`
    + `<h2>Set up</h2>${setup}` };
}

// ── the run ──

function doorHtml(stage, door, st, run) {
  const action = `/run/${stage}/${door === "rejudge" ? "run" : door}`;
  switch (door) {
    case "run": return form({ action, submit: st.status === "stopped" || st.shown === "dead" ? "Start again" : "Run", fields: [by] });
    case "rejudge": return form({ action, submit: "Re-judge", fields: [by], note: "The standing artifact is judged against the new snapshot — no writer runs unless it blocks." });
    case "escalate": return form({ action, submit: "Escalate", fields: [by, reason], note: `Buys round ${st.round + 1} of a ceiling of ${run.ceiling}. The writer sees the block's findings.` });
    case "approve": return form({ action, submit: "Approve", fields: [by, { name: "override_reason", label: st.status === "blocked" || st.verdict?.verdict === "block" ? "over the block — your reason, on the record" : "if the verdict is stale — your reason, on the record", value: "" }], note: "Needs a fresh, non-block verdict. Over a block or a stale verdict, the reason is the record." });
    case "reopen": return form({ action, submit: "Reopen", fields: [by, reason] });
    case "stop": return form({ action, submit: "Stop", fields: [by, reason] });
    default: return "";
  }
}

function stageRow(s, run) {
  const state = `${badge(s.shown, STATE[s.shown] ?? "muted")}${s.silent_ms != null ? `<br><span class="muted">silent ${Math.round(s.silent_ms / 1000)} s of ${Math.round(run.liveness_ms / 1000)}</span>` : ""}${s.authored ? "" : `<br><span class="muted">lands at M3</span>`}`;
  const times = [["started", when(s.started_at)], ["heartbeat", when(s.heartbeat_at)], ["finished", when(s.finished_at)]].filter(([, t]) => t !== "—").map(([k, t]) => `${k} ${t}`).join("<br>") || `<span class="muted">—</span>`;
  return [esc(s.stage), state, `${s.round} of ${run.cap}`, verdictLine(s.verdict), costLine(s.cost), times, s.doors.map((d) => doorHtml(s.stage, d, s, run)).join("") || `<span class="muted">—</span>`];
}

function runPage(v) {
  const r = v.run;
  const pin = v.pin_refusal ? `<p class="refusal">${badge(v.pin_refusal.code, "bad")} ${esc(v.pin_refusal.message)}</p>` : "";
  const advanceForm = v.advance ? form({ action: "/run/advance", submit: "Advance", fields: [by], note: "Runs the stages in order until one does not approve, or the loop reaches a stage it cannot run yet." }) : "";
  const flags = table(["at", "stage", "event", "by", "reason", "override"], v.flags.map((f) => [when(f.at), esc(f.stage), badge(f.event, f.override ? "bad" : "warn"), esc(f.by), esc(f.reason), f.override ? `${badge(f.guard, "bad")}<br><span class="muted">${esc(f.note)}</span>` : f.note ? `<span class="muted">${esc(f.note)}</span>` : ""]));
  const fun = v.funnel;
  const funnel = fun.total === 0 ? `<p class="muted">nothing has crossed the seam against the funnel yet</p>`
    : table(["signal", "rule", "count"], Object.entries(fun.by_signal).map(([k, n]) => [esc(k), esc(fun.rules[k] ?? "—"), n])) + (Object.keys(fun.by_gate).length ? table(["gate", "count"], Object.entries(fun.by_gate).map(([k, n]) => [esc(k), n])) : "");
  const adopt = v.adoptable.length ? form({ action: "/run/adopt", submit: "Adopt", fields: [by, { name: "version", label: "handoff", type: "select", required: true, value: v.adoptable.at(-1), options: v.adoptable.map((n) => [n, `v${n}`]) }], note: "The pin moves; every approved stage goes stale and is re-judged, not regenerated (R5)." }) : `<p class="muted">the run is on the latest takeable handoff</p>`;
  return { title: "Delivery run", body: `<h1>${esc(r.id)} <span class="muted">handoff v${esc(r.handoff.version)} · <code>${esc(short(r.handoff.content_hash))}</code></span></h1>`
    + dl([["set up", `${esc(r.by)} · ${when(r.created_at)}`], ["rounds", `cap ${r.cap} · ceiling ${r.ceiling}`], ["liveness window", `${Math.round(r.liveness_ms / 1000)} s`], ["spent", costLine(v.cost)]])
    + pin
    + `<h2>Stages</h2>${table(["stage", "state", "round", "verdict", "cost", "when", "doors"], v.stages.map((s) => stageRow(s, r)))}${advanceForm}`
    + `<h2>Next round</h2>${estimateHtml(v.estimate)}`
    + findingsHtml(v.gates, { deferredTitle: "Deferred — untested, or past the line" })
    + `<h2>Flags on record</h2>${flags}`
    + `<h2>Funnel (R8)</h2>${funnel}`
    + `<h2>Handoff</h2>${adopt}<h3>All handoffs</h3>${table(["handoff", "exit", "by", "exported", "design", "Discovery cost", "may Delivery take it?"], v.handoffs.map(handoffRow))}`
    + `<h2>Model per role</h2>${rolesTable(v.roles)}` };
}

// ── routes ──

/**
 * The route table for one project root, Delivery's half. Seams pass through to the loop
 * and the doors — a scripted `_query` for evals, a fixed `_now` for clocks — so the console
 * holds no call and no clock of its own.
 */
export function routes({ root, _query, _sleep, _now = () => new Date() } = {}) {
  const seams = { ...(_query ? { _query } : {}), ...(_sleep ? { _sleep } : {}), _now };
  const work = (title, fn) => ({ title, back: "/run", work: fn });
  const step = (stage, f, event, extra = {}) => { transition(root, { stage, event, by: f.by, reason: blank(f.reason), now: _now(), ...extra }); return { redirect: "/run" }; };
  const stageOf = (params) => { if (!STAGES.includes(params.stage)) throw Object.assign(new Error(`${params.stage} is not a stage`), { code: "no-stage" }); return params.stage; };

  return [
    { method: "GET", path: "/run", handler: () => { const v = runView(root, { now: _now() }); return v.run ? runPage(v) : setupPage(v); } },
    { method: "POST", path: "/run/setup", handler: ({ form: f }) => {
      const models = Object.fromEntries(Object.entries(f).filter(([k, v]) => k.startsWith("model.") && blank(v)).map(([k, v]) => [k.slice(6), v.trim()]).filter(([k, v]) => v !== runView(root).roles.find((r) => r.key === k)?.default));
      createRun(root, { by: f.by, version: num(f.version, undefined), cap: num(f.cap, undefined), ceiling: num(f.ceiling, undefined), liveness_ms: blank(f.liveness) === undefined ? undefined : Number(f.liveness) * 60_000, budget: num(f.budget, null), models, now: _now() });
      return { redirect: "/run" };
    } },
    { method: "POST", path: "/run/advance", handler: ({ form: f }) => work("Advance", async (onEvent) => { await advance(root, { by: f.by, onEvent, ...seams }); return "/run"; }) },
    { method: "POST", path: "/run/:stage/run", handler: ({ params, form: f }) => { const stage = stageOf(params); return work(stage, async (onEvent) => { await runStage(root, { stage, by: f.by, onEvent, ...seams }); return "/run"; }); } },
    { method: "POST", path: "/run/:stage/escalate", handler: ({ params, form: f }) => { const stage = stageOf(params); return work(`${stage} · escalate`, async (onEvent) => { await escalate(root, { stage, by: f.by, reason: f.reason, onEvent, ...seams }); return "/run"; }); } },
    { method: "POST", path: "/run/:stage/approve", handler: ({ params, form: f }) => step(stageOf(params), { by: f.by, reason: f.override_reason }, "approve", { override: Boolean(blank(f.override_reason)) }) },
    { method: "POST", path: "/run/:stage/reopen", handler: ({ params, form: f }) => step(stageOf(params), f, "reopen") },
    { method: "POST", path: "/run/:stage/stop", handler: ({ params, form: f }) => step(stageOf(params), f, "stop") },
    { method: "POST", path: "/run/adopt", handler: ({ form: f }) => { adoptHandoff(root, { version: num(f.version, undefined), by: f.by, now: _now() }); return { redirect: "/run" }; } },
  ];
}
