// owns: R6, R5, R1 · delivery — the stage loop: writer → judge → door, every step a
// transition through the one table (R9) and every model call on the one ledger (R1). A
// stage runs an episode: open (start, regenerate, escalate or rejudge), heartbeat while
// the stage's own code writes and judges, finish by pinning the verdict, then dispose —
// a non-block verdict approves; a block regenerates under the cap or lands in `blocked`,
// where the doors are the human's (R6); a stale stage is re-judged, never regenerated (R5).
// A stage whose code throws is stopped with the error as its reason, on the record. The
// stages this loop can run are registered here; one it cannot is refused by name.

import { join } from "node:path";
import { Refused } from "../../shared/refused.mjs";
import { readDoc } from "../../shared/store.mjs";
import { rows, estimate, standing, modelFor, tally } from "../../shared/agent-call/index.mjs";
import { STAGES, LEDGER, readRun, transition, heartbeat, liveness } from "../state/index.mjs";
import { intake, takePinned, compile, slice, INTAKE_FILE } from "../intake/index.mjs";
import { round as sddRound, rejudge as sddRejudge } from "../sdd/index.mjs";

export { Refused };
/** How often the wrapper writes the heartbeat while a stage's code runs. */
export const PULSE_MS = 15_000;

/**
 * The stages this loop can run, each as `round(root, ctx)` and `rejudge(root, ctx)`
 * returning the root-relative path of the verdict it filed. `writer` says whether a block
 * can be regenerated: a stage with no writer (intake) blocks on what the snapshot carries,
 * and the doors are the human's from the first round. `calls` is the shape of one round —
 * how many writer and judge calls it makes for a given snapshot — which is what an
 * estimate multiplies by the ledger's history (R1).
 */
export const AUTHORED = {
  intake: {
    writer: false,
    round: (root, ctx) => intake(root, { now: ctx.now }).verdict,
    rejudge: (root, ctx) => intake(root, { now: ctx.now }).verdict,
    calls: () => ({ writer: 0, judge: 0 }),
  },
  sdd: {
    writer: true,
    round: async (root, ctx) => (await sddRound(root, ctx)).file,
    rejudge: async (root, ctx) => (await sddRejudge(root, ctx)).file,
    // one binding for the set, one judge per work item — the items intake sliced, or the ones it will
    calls: ({ handoff, intake }) => ({ writer: 1, judge: (intake?.work_items ?? slice(handoff, compile(handoff).scenarios)).length }),
  },
};

/**
 * What a round of each stage is likely to cost, before it is spent (R1): the round's shape
 * times the ledger's mean for that role and model — and no number where there is no
 * history, because a number from a rate card would be shown with the same confidence as a
 * measured one. `usd` is null until every role the shape needs has history. `standing` is
 * the spend against the run's budget.
 */
export function estimateRun(root, { handoff, intake = null, models = {}, budget = null } = {}) {
  const ledger = join(root, LEDGER);
  const stages = Object.entries(AUTHORED).map(([stage, a]) => {
    const shape = a.calls({ handoff, intake });
    const roles = Object.entries(shape).filter(([, n]) => n > 0).map(([role, calls]) => {
      const model = modelFor({ half: "delivery", role }, models);
      const e = estimate(ledger, { half: "delivery", role, model });
      return { role, model, calls, per_call: e.usd, n: e.n, usd: e.usd == null ? null : e.usd * calls };
    });
    const known = roles.every((r) => r.usd != null);
    return { stage, calls: roles.reduce((n, r) => n + r.calls, 0), roles, usd: known ? roles.reduce((n, r) => n + r.usd, 0) : null };
  });
  const known = stages.every((s) => s.usd != null);
  return { stages, calls: stages.reduce((n, s) => n + s.calls, 0), usd: known ? stages.reduce((n, s) => n + s.usd, 0) : null, standing: standing(ledger, budget) };
}

/**
 * Run one stage through one episode, from wherever it stands. Refuses `no-stage`,
 * `stage-unauthored` (the stage lands at M3), `stage-order` (a stage before it is not
 * approved), `stage-blocked` (the cap was reached — escalate, approve on the record, or
 * stop), `stage-done` (approved; reopen with a reason), and the table's own refusals
 * (`stage-running` while a live stage is alive). Returns `{ stage, status, round, run,
 * verdict, cost }` — cost from the ledger, for this stage of this half, all episodes.
 */
export async function runStage(root, { stage, by = "runner", onEvent, _query, _sleep, _now = () => new Date(), _pulse_ms = PULSE_MS } = {}) {
  const run = needRun(root);
  const authored = need(stage, run);
  const st = run.stages[stage];
  const now = _now();
  let mode;
  switch (st.status) {
    case "pending": case "stopped": mode = "start"; break;
    case "running": {
      if (liveness(st, { now, window: run.liveness_ms }).state !== "dead") throw new Refused("stage-running", `${stage}: the stage is running and alive — wait for it, or stop it with a reason`);
      mode = "start"; break;
    }
    case "rejudging": {
      if (liveness(st, { now, window: run.liveness_ms }).state !== "dead") throw new Refused("stage-running", `${stage}: the stage is re-judging and alive — wait for it, or stop it with a reason`);
      throw new Refused("stage-dead", `${stage}: the re-judge died — stop it with a reason, then start it`);
    }
    case "review": mode = "dispose"; break;
    case "stale": mode = "rejudge"; break;
    case "blocked": throw new Refused("stage-blocked", `${stage}: round ${st.round} of ${run.cap} — the cap is reached; escalate with a reason, approve on the record, or stop`);
    case "approved": throw new Refused("stage-done", `${stage}: approved — reopen with a reason to redo it`);
    default: throw new Refused("no-transition", `${stage}: ${st.status} has no episode`);
  }
  if (mode !== "dispose") transition(root, { stage, event: mode, by, now });
  return episode(root, { stage, authored, mode, by, onEvent, _query, _sleep, _now, _pulse_ms });
}

/** The cap door a human opens: a round bought with a reason, on the record (R6), then run. */
export async function escalate(root, { stage, by, reason, onEvent, _query, _sleep, _now = () => new Date(), _pulse_ms = PULSE_MS } = {}) {
  const run = needRun(root);
  const authored = need(stage, run);
  transition(root, { stage, event: "escalate", by, reason, now: _now() });
  return episode(root, { stage, authored, mode: "start", by, onEvent, _query, _sleep, _now, _pulse_ms });
}

/**
 * Stages in order until one does not approve or the loop cannot run it. Returns what
 * each stage came to and where it halted: `{ stages: [result…], halted: { stage, why } | null }`.
 */
export async function advance(root, opts = {}) {
  const out = { stages: [], halted: null };
  for (const stage of STAGES) {
    const run = needRun(root);
    if (run.stages[stage].status === "approved") continue;
    if (!AUTHORED[stage]) { out.halted = { stage, why: "stage-unauthored" }; break; }
    const r = await runStage(root, { ...opts, stage });
    out.stages.push(r);
    if (r.status !== "approved") { out.halted = { stage, why: r.status }; break; }
  }
  return out;
}

// ── the episode ──

async function episode(root, { stage, authored, mode, by, onEvent, _query, _sleep, _now, _pulse_ms }) {
  let path = needRun(root).stages[stage].verdict;
  if (mode !== "dispose") {
    const rejudging = mode === "rejudge";
    // a start over a recorded block — an escalated round, or a start after a stop — is
    // answering that block: the writer sees the findings, as it does on regenerate
    const prior = !rejudging && path ? readDoc(root, path) : null;
    path = await work(root, { stage, authored, rejudging, review: prior?.verdict === "block" ? prior : null, by, onEvent, _query, _sleep, _now, _pulse_ms });
    if (rejudging) {
      const doc = readDoc(root, path);
      const event = doc?.verdict === "block" ? "reblock" : "clear";
      transition(root, { stage, event, by, verdict: path, now: _now() });
      onEvent?.(`${stage} re-judged: ${event}`);
      if (event === "clear") return result(root, stage);
    } else {
      transition(root, { stage, event: "finish", by, verdict: path, now: _now() });
    }
  }
  // dispose: the verdict on record decides the door
  for (;;) {
    const run = needRun(root);
    const doc = readDoc(root, path);
    if (!doc) throw new Refused("no-verdict", `${stage}: ${path ?? "nothing"} holds no verdict to dispose of`);
    if (doc.verdict !== "block") {
      transition(root, { stage, event: "approve", by, now: _now() });
      onEvent?.(`${stage} ${doc.verdict} · round ${run.stages[stage].round} — approved`);
      return result(root, stage);
    }
    if (!authored.writer) {
      onEvent?.(`${stage} block — no writer to regenerate; the door is the human's`);
      return result(root, stage);
    }
    if (run.stages[stage].round >= run.cap) {
      transition(root, { stage, event: "cap", by, now: _now() });
      onEvent?.(`${stage} block · round ${run.stages[stage].round} of ${run.cap} — blocked at the cap`);
      return result(root, stage);
    }
    transition(root, { stage, event: "regenerate", by, now: _now() });
    onEvent?.(`${stage} block · round ${run.stages[stage].round} of ${run.cap} — regenerating`);
    path = await work(root, { stage, authored, rejudging: false, review: doc, by, onEvent, _query, _sleep, _now, _pulse_ms });
    transition(root, { stage, event: "finish", by, verdict: path, now: _now() });
  }
}

/** The stage's own code, under the wrapper's pulse. A throw stops the stage with the error as the reason and is re-thrown. */
async function work(root, { stage, authored, rejudging, review = null, by, onEvent, _query, _sleep, _now, _pulse_ms }) {
  const run = needRun(root);
  const pulse = setInterval(() => { try { heartbeat(root, stage, _now()); } catch { /* the stage moved under us; the next transition says how */ } }, _pulse_ms);
  try {
    const ctx = { run, now: _now(), by, review, onEvent: (e) => onEvent?.(`${stage} ${e}`), _query, _sleep };
    if (authored.writer) {
      ctx.handoff = takePinned(root, run);
      ctx.intake = readDoc(root, INTAKE_FILE);
      if (!ctx.intake) throw new Refused("no-intake", `${stage}: there is no intake record — intake runs first`);
    }
    return await authored[rejudging ? "rejudge" : "round"](root, ctx);
  } catch (e) {
    const reason = `${e.code ?? e.name}: ${String(e.message).split("\n")[0]}`.slice(0, 400);
    try { transition(root, { stage, event: "stop", by: "wrapper", reason, now: _now() }); } catch { /* already stopped */ }
    onEvent?.(`${stage} stopped — ${reason}`);
    throw e;
  } finally {
    clearInterval(pulse);
  }
}

function result(root, stage) {
  const run = needRun(root);
  const st = run.stages[stage];
  const spent = rows(join(root, LEDGER)).filter((r) => r.half === "delivery" && r.stage === stage);
  return {
    stage, status: st.status, round: st.round, run,
    verdict: readDoc(root, st.verdict),
    cost: tally(spent),
  };
}

function needRun(root) {
  const run = readRun(root);
  if (!run) throw new Refused("no-run", `${root} has no run — set Delivery up first`);
  return run;
}

/** The stage exists, the loop knows how to run it, and everything before it is approved. */
function need(stage, run) {
  if (!STAGES.includes(stage)) throw new Refused("no-stage", `${stage} is not a stage — one of ${STAGES.join(", ")}`);
  const authored = AUTHORED[stage];
  if (!authored) throw new Refused("stage-unauthored", `${stage}: this loop has no writer or judge for it yet — ${stage} lands at M3`);
  const before = STAGES.slice(0, STAGES.indexOf(stage)).filter((s) => run.stages[s].status !== "approved");
  if (before.length) throw new Refused("stage-order", `${stage}: ${before.map((s) => `${s} is ${run.stages[s].status}`).join(", ")} — a stage runs from an approved one`);
  return authored;
}
