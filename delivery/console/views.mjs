// owns: R1, R10 · delivery — the run as the human sees it, as data. Read through the
// record's own readers — the machine's one `view` for state and liveness (a running stage
// silent past the window is `dead`, in that word), the verdict's pins for freshness, the
// ledger for cost, the funnel meter for what crossed the seam — and never restated.
// Before a run exists, the same view is the setup: the handoffs Delivery may take, each
// asked with the door's own question, and what a round is likely to cost (R1).

import { existsSync } from "node:fs";
import { join } from "node:path";
import { roles, defaults, modelFor, rows } from "../../shared/agent-call/index.mjs";
import { verdictFreshness } from "../../shared/judge/index.mjs";
import { readHandoffs } from "../../shared/handoff.mjs";
import { readDoc } from "../../shared/store.mjs";
import { funnelPath, rows as funnelRows, meter, SIGNALS } from "../../shared/funnel.mjs";
import { Refused, DEFAULTS, LEDGER, readRun, view, takeHandoff } from "../state/index.mjs";
import { takePinned, INTAKE_FILE } from "../intake/index.mjs";
import { AUTHORED, estimateRun } from "../run/index.mjs";

/**
 * The doors a stage offers, by the state the console shows. `run` and `rejudge` are the
 * loop's episode (one route); the rest are transitions. A dead re-judge has no run door —
 * the machine says stop it first.
 */
export function doorsFor(st) {
  if (st.shown === "dead") return st.status === "running" ? ["run", "stop"] : ["stop"];
  return { pending: ["run"], stopped: ["run"], running: ["stop"], rejudging: ["stop"], review: ["approve", "stop"], blocked: ["escalate", "approve", "stop"], approved: ["reopen"], stale: ["rejudge", "stop"] }[st.status] ?? [];
}

const roleRows = (overrides = {}) => roles().filter((k) => k.startsWith("delivery.")).map((key) => {
  const [half, role] = key.split(".");
  const model = modelFor({ half, role }, overrides);
  return { key, half, role, model, default: defaults()[key], overridden: model !== defaults()[key] };
});

/** Every handoff on disk, each asked the setup door's question — takeable, or the refusal in its own words. */
function handoffRows(root) {
  return readHandoffs(root).map((h) => {
    let refusal = null;
    try { takeHandoff(root, h.version); } catch (e) { if (!(e instanceof Refused)) throw e; refusal = { code: e.code, message: e.message }; }
    return { version: h.version, exit: h.exit, by: h.by, exported_at: h.exported_at, cost: h.cost ?? null, signed: Boolean(h.design?.signoff), hash: h.meta?.content_hash ?? null, refusal, handoff: h };
  });
}

/** A stage's verdict as the run wears it: read by the path the machine recorded, fresh only by its pins. */
function verdictRow(root, stage, path) {
  const v = path ? readDoc(root, path) : null;
  if (!v) return { gate: stage, verdict: null, fresh: null, findings: [], deferred: [], model: null, usd: null };
  return { gate: v.gate, verdict: v.verdict, fresh: verdictFreshness(v, { root }).fresh, findings: v.findings, deferred: v.deferred ?? [], model: v.cost?.model ?? null, usd: v.cost?.usd ?? null, checked: v.checked, skipped: v.skipped, judged: v.judged ?? [] };
}

/**
 * No run: the offer — handoffs with their takeability, Delivery's roles at their defaults,
 * the starting values, and the estimate for the latest takeable handoff. A run: the
 * machine's view of every stage with its verdict, cost, and doors; the flags; the funnel;
 * the next round's estimate; and the handoffs newer than the pin that could be adopted.
 */
export function runView(root, { now = new Date() } = {}) {
  const run = readRun(root);
  const handoffs = handoffRows(root);
  const takeable = handoffs.filter((h) => !h.refusal);
  if (!run) {
    const latest = takeable.at(-1) ?? null;
    return {
      root, run: null, project: existsSync(join(root, ".git")), handoffs, roles: roleRows(), defaults: DEFAULTS,
      offer: latest?.version ?? null,
      estimate: latest ? estimateRun(root, { handoff: latest.handoff }) : null,
    };
  }
  const v = view(run, now);
  let pinned = null, pin_refusal = null;
  try { pinned = takePinned(root, run); } catch (e) { if (!(e instanceof Refused)) throw e; pin_refusal = { code: e.code, message: e.message }; }
  const intake = readDoc(root, INTAKE_FILE);
  const spent = rows(join(root, LEDGER)).filter((r) => r.half === "delivery");
  const cost = (stage) => { const mine = spent.filter((r) => r.stage === stage); return { calls: mine.length, usd: mine.reduce((n, r) => n + (r.usd ?? 0), 0) }; };
  // The episode doors (run, rejudge) stand only on the first stage not yet approved, and only where the loop has a writer and a judge for it — the order the runner keeps.
  let before = false;
  const stages = v.stages.map((st) => {
    const authored = Boolean(AUTHORED[st.stage]);
    const doors = doorsFor(st).filter((d) => !((d === "run" || d === "rejudge") && (before || !authored)));
    if (st.status !== "approved") before = true;
    return { ...st, authored, verdict: verdictRow(root, st.stage, st.verdict), cost: cost(st.stage), doors };
  });
  const next = stages.find((s) => s.status !== "approved");
  return {
    root, run: { id: run.id, by: run.by, created_at: run.created_at, handoff: run.handoff, cap: run.cap, ceiling: run.ceiling, liveness_ms: run.liveness_ms, budget: run.budget },
    pin_refusal,
    roles: roleRows(run.models ?? {}),
    stages, gates: stages.map((s) => s.verdict).filter((g) => g.verdict !== null),
    flags: run.flags,
    cost: { calls: spent.length, usd: spent.reduce((n, r) => n + (r.usd ?? 0), 0) },
    estimate: pinned ? estimateRun(root, { handoff: pinned, intake, models: run.models ?? {}, budget: run.budget ?? null }) : null,
    funnel: { ...meter(funnelRows(funnelPath(root))), rules: SIGNALS },
    handoffs, adoptable: takeable.filter((h) => h.version > run.handoff.version).map((h) => h.version),
    advance: Boolean(next?.doors.some((d) => d === "run" || d === "rejudge")),
  };
}
