// owns: R6, R5, R1 · delivery — the stage loop: writer → judge → door, every step a
// transition through the one table (R9) and every model call on the one ledger (R1). A
// stage runs an episode: open (start, regenerate, escalate, reopen or rejudge), heartbeat
// while the stage's own code writes and judges, finish by pinning the verdict, then dispose
// — a non-block verdict approves; a block regenerates under the cap or lands in `blocked`,
// where the doors are the human's (R6); a stale stage is re-judged, never regenerated (R5).
// A reopen redoes an approved stage on a human's reason, and every judged stage after it
// goes stale — judged against what is being rewritten. A stage whose code throws is
// stopped with the error as its reason, on the record. The stages this loop can run are
// registered here; one it cannot is refused by name.

import { join } from "node:path";
import { Refused } from "../../shared/refused.mjs";
import { readDoc } from "../../shared/store.mjs";
import { rows, estimate, standing, modelFor, tally } from "../../shared/agent-call/index.mjs";
import { STAGES, JUDGED, LEDGER, readRun, transition, heartbeat, liveness } from "../state/index.mjs";
import { intake, takePinned, compile, slice, INTAKE_FILE } from "../intake/index.mjs";
import { round as sddRound, rejudge as sddRejudge, PER_RESPONSE } from "../sdd/index.mjs";
import { round as qaRound, rejudge as qaRejudge, COUNTER } from "../qa/index.mjs";
import { round as buildRound, rejudge as buildRejudge } from "../build/index.mjs";

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
    // one binding for the set, crossing in responses of PER_RESPONSE items; one judge per work item — the items intake sliced, or the ones it will
    calls: ({ handoff, intake }) => { const n = (intake?.work_items ?? slice(handoff, compile(handoff).scenarios)).length; return { writer: Math.ceil(n / PER_RESPONSE), judge: n }; },
  },
  build: {
    writer: true,
    round: async (root, ctx) => (await buildRound(root, ctx)).file,
    rejudge: async (root, ctx) => (await buildRejudge(root, ctx)).file,
    // one builder per binding item and no judge — the verdict is arithmetic; a reused item is no call, so this is the ceiling
    calls: ({ handoff, intake }) => ({ builder: (intake?.work_items ?? slice(handoff, compile(handoff).scenarios)).length }),
  },
  qa: {
    writer: false,
    round: async (root, ctx) => (await qaRound(root, ctx)).file,
    rejudge: async (root, ctx) => (await qaRejudge(root, ctx)).file,
    // the suites are run once, whatever they cost in wall clock, and one oracle per binding
    // item reads what came out — no writer: qa proves what is there, it does not make it
    calls: ({ handoff, intake }) => ({ judge: (intake?.work_items ?? slice(handoff, compile(handoff).scenarios)).length }),
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
export async function runStage(root, { stage, by = "runner", onEvent, _query, _sleep, _perResponse, _now = () => new Date(), _pulse_ms = PULSE_MS } = {}) {
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
  return episode(root, { stage, authored, mode, by, onEvent, _query, _sleep, _perResponse, _now, _pulse_ms });
}

/** The cap door a human opens: a round bought with a reason, on the record (R6), then run. */
export async function escalate(root, { stage, by, reason, onEvent, _query, _sleep, _perResponse, _now = () => new Date(), _pulse_ms = PULSE_MS } = {}) {
  const run = needRun(root);
  const authored = need(stage, run);
  transition(root, { stage, event: "escalate", by, reason, now: _now() });
  return episode(root, { stage, authored, mode: "start", by, onEvent, _query, _sleep, _perResponse, _now, _pulse_ms });
}

/**
 * The door over an approved stage: redo it on a human's reason. The reopen is a transition
 * with the reason on a flag and on the stage; the writer of the redo sees the standing
 * artifact, its verdict and the reason, and every item is its to revise — or, when the
 * reopen names the items it is about, those and only those, the rest carried verbatim
 * (`items`: work item ids the intake carries; one it does not is `item-unknown`, refused
 * before anything runs). What was judged against the artifact being rewritten — every later
 * stage holding a judgement — goes stale by the same reason, to be re-judged (R5), never
 * regenerated; a later stage that is alive refuses the reopen first. Then the episode runs.
 * Refuses the table's own (`no-transition` when the stage is not approved, `reason-required`).
 */
export async function reopen(root, { stage, by, reason, items = null, from = null, onEvent, _query, _sleep, _perResponse, _now = () => new Date(), _pulse_ms = PULSE_MS } = {}) {
  const run = needRun(root);
  const authored = need(stage, run);
  const now = _now();
  const later = STAGES.slice(STAGES.indexOf(stage) + 1);
  // `from` names the later gate whose verdict sent this work back, so the writer can be
  // handed that gate's findings rather than a sentence about them. It must be a later
  // stage — an earlier one cannot have judged work this stage had not yet produced — and
  // it must have a verdict on record, or there is nothing to carry.
  if (from) {
    if (!later.includes(from)) throw new Refused("redo-unknown", `${stage}: a redo comes from a later stage — ${from} is not one of ${later.join(", ") || "(none)"}`);
    if (!run.stages[from]?.verdict) throw new Refused("redo-unjudged", `${stage}: ${from} has filed no verdict, so it has no findings to send back`);
  }
  const alive = later.find((s) => liveness(run.stages[s], { now, window: run.liveness_ms }).state === "alive");
  if (alive) throw new Refused("stage-running", `${stage}: ${alive} is running and alive on what ${stage} produced — wait for it, or stop it with a reason`);
  if (items?.length) {
    const carried = new Set((readDoc(root, INTAKE_FILE)?.work_items ?? []).map((w) => w.id));
    const unknown = items.filter((id) => !carried.has(id));
    if (unknown.length) throw new Refused("item-unknown", `${stage}: the reopen names ${unknown.join(", ")}, which the intake does not carry — name work items the record knows, or none to redo every item`);
  }
  transition(root, { stage, event: "reopen", by, reason, items: items?.length ? [...new Set(items)] : undefined, from: from ?? undefined, now });
  for (const s of later) if (JUDGED.has(run.stages[s].status)) transition(root, { stage: s, event: "moved", by, reason: `${stage} reopened: ${reason}`, now });
  return episode(root, { stage, authored, mode: "start", by, onEvent, _query, _sleep, _perResponse, _now, _pulse_ms });
}

/**
 * Stages in order until one does not approve or the loop cannot run it. Returns what
 * each stage came to and where it halted: `{ stages: [result…], halted: { stage, why } | null }`.
 * A stage's refusal (the door's, or a round's — `no-repo`, `containment`) halts the loop
 * with its code; the stage is already stopped on the record with the reason by the
 * episode. Anything else is a fault and propagates.
 */
export async function advance(root, opts = {}) {
  const out = { stages: [], halted: null, redos: [] };
  for (;;) {
    out.halted = await sweep(root, opts, out);
    if (!out.halted) return out;
    const plan = out.halted.why === "review" ? redoPlan(root, out.halted.stage) : null;
    if (!plan?.length) return out;

    // The cross-stage bound. A stage's own cap counts rounds inside it and is reset by the
    // reopen (`opens`), so it cannot bound a cycle that leaves the stage and comes back:
    // qa blocks → sdd redoes → build redoes → qa runs again. Unbounded, that is a gate
    // paying for its own opinion in a circle. The ceiling is the number already on the
    // record for how much a run may buy, so the redos take it too.
    const run = needRun(root);
    const spent = run.flags.filter((f) => f.event === "reopen" && f.from).length;
    if (spent >= run.ceiling) {
      out.halted = { stage: out.halted.stage, why: "redo-ceiling", message: `${out.halted.stage} sent work back ${spent} time(s), the ceiling — the block is the human's call now` };
      return out;
    }

    // The earliest stage only. Reopening sdd sends build stale by the same door, so build
    // re-judges and regenerates against the binding that just moved — and a wrong test is
    // often why the code was wrong, so its findings may not survive the re-bind. Reopening
    // both would also refuse: the second stage is no longer `approved` once the first has
    // sent it stale. Anything still wrong comes back named on the next verdict.
    const [first] = plan;
    const by = opts.by ?? "runner";
    const reason = `${out.halted.stage} sent ${first.items.length} item(s) back: ${first.items.join(", ")}`;
    opts.onEvent?.(`${out.halted.stage} → ${first.stage} redo ${spent + 1} of ${run.ceiling} · ${reason}`);
    out.redos.push({ from: out.halted.stage, to: first.stage, items: first.items, cycle: spent + 1 });
    try { await reopen(root, { ...opts, stage: first.stage, items: first.items, from: out.halted.stage, by, reason }); }
    catch (e) { if (e instanceof Refused) { out.halted = { stage: first.stage, why: e.code, message: e.message }; return out; } throw e; }
  }
}

/** One pass through the stages in order; the halt, or null when every stage approved. */
async function sweep(root, opts, out) {
  for (const stage of STAGES) {
    const run = needRun(root);
    if (run.stages[stage].status === "approved") continue;
    if (!AUTHORED[stage]) return { stage, why: "stage-unauthored" };
    let r;
    try { r = await runStage(root, { ...opts, stage }); }
    catch (e) { if (e instanceof Refused) return { stage, why: e.code, message: e.message }; throw e; }
    out.stages.push(r);
    if (r.status !== "approved") return { stage, why: r.status };
  }
  return null;
}

/**
 * What a blocking verdict asks of the stages before it: each stage its findings named, with
 * the work items those findings were about, in pipeline order so the earliest goes first.
 *
 * The items come from the per-item judgements, not from parsing subjects — a finding's
 * subject is a test id or a criterion, and the item it belongs to is already known because
 * the item is what its judge was asked about. Null when nothing routes: no `redo` anywhere,
 * or a `counter-proposal`, which says the criterion itself cannot be met. No stage can redo
 * its way out of that one, so it is the PM's and the loop stops rather than spending a
 * cycle proving it again.
 */
export function redoPlan(root, stage) {
  const at = needRun(root).stages[stage]?.verdict;
  const verdict = at ? readDoc(root, at) : null;
  if (!verdict || verdict.verdict !== "block") return null;
  if ((verdict.findings ?? []).some((f) => f.rule === COUNTER)) return null;
  const by = new Map();
  for (const it of verdict.items ?? []) {
    for (const f of it.findings ?? []) {
      if (!f.redo) continue;
      if (!by.has(f.redo)) by.set(f.redo, new Set());
      by.get(f.redo).add(it.id);
    }
  }
  return STAGES.filter((s) => by.has(s)).map((s) => ({ stage: s, items: [...by.get(s)].sort() }));
}

// ── the episode ──

/**
 * The findings a later gate laid at this stage's door, as a verdict the writer's renderer
 * already knows how to show. Only findings whose `redo` names this stage: a judge that
 * diagnosed a defect said whose it is (finding.schema `redo`), and handing a writer the
 * ones addressed to somebody else invites it to fix work that is not its own. Arithmetic
 * findings name no stage and are not carried — `test-failed` is the consequence a judge's
 * finding explains, and the explanation is what the writer needs.
 *
 * Null when nothing is addressed here, so the caller falls back to the ordinary review.
 */
function redoFindings(root, { from, stage }) {
  const at = needRun(root).stages[from]?.verdict;
  const verdict = at ? readDoc(root, at) : null;
  if (!verdict) return null;
  const findings = (verdict.findings ?? []).filter((f) => f.redo === stage);
  if (!findings.length) return null;
  return { ...verdict, findings, deferred: [], checked: findings.length };
}

async function episode(root, { stage, authored, mode, by, onEvent, _query, _sleep, _perResponse, _now, _pulse_ms }) {
  let path = needRun(root).stages[stage].verdict;
  if (mode !== "dispose") {
    const rejudging = mode === "rejudge";
    // a start over a recorded block — an escalated round, or a start after a stop — is
    // answering that block: the writer sees the findings, as it does on regenerate; a
    // start over a reopen is answering the reason: the writer sees the standing verdict too
    const prior = !rejudging && path ? readDoc(root, path) : null;
    const opened = needRun(root).stages[stage].reopened;
    const reopened = Boolean(opened);
    // A stage reopened by a later gate answers that gate, not itself. Its own standing
    // verdict approved — that is why it is approved — so it carries no findings, and a
    // writer handed it is told nothing about why it is redoing the work. The findings
    // that named this stage live on the verdict of the gate that found them, and only
    // that gate's judge saw the evidence: rendering them for the writer is the whole of
    // the carry. Without it the reason is a sentence a human wrote, and the judgement a
    // model was paid to make is re-made by whoever composed it.
    const downstream = !rejudging && opened?.from ? redoFindings(root, { from: opened.from, stage }) : null;
    const review = downstream ?? (prior && (prior.verdict === "block" || reopened) ? prior : null);
    path = await work(root, { stage, authored, rejudging, review, by, onEvent, _query, _sleep, _perResponse, _now, _pulse_ms });
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
    path = await work(root, { stage, authored, rejudging: false, review: doc, by, onEvent, _query, _sleep, _perResponse, _now, _pulse_ms });
    transition(root, { stage, event: "finish", by, verdict: path, now: _now() });
  }
}

/** The stage's own code, under the wrapper's pulse. A throw stops the stage with the error as the reason and is re-thrown. */
async function work(root, { stage, authored, rejudging, review = null, by, onEvent, _query, _sleep, _perResponse, _now, _pulse_ms }) {
  const run = needRun(root);
  const pulse = setInterval(() => { try { heartbeat(root, stage, _now()); } catch { /* the stage moved under us; the next transition says how */ } }, _pulse_ms);
  try {
    const ctx = { run, now: _now(), by, review, reopened: run.stages[stage].reopened ?? null, onEvent: (e) => onEvent?.(`${stage} ${e}`), _query, _sleep, _perResponse };
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
