// owns: R9, R6, R5 · delivery — one state machine, one store, one reader. Every stage of a
// run is in exactly one state; every change goes through one transition table, the same
// table for the wrapper and for every door; the record is one file, written by the thing
// that changed it and read back by one reader. Nothing reconciles lazily: a running
// stage that stopped heartbeating reads as dead, in that word, and stays so until someone
// acts on it. The round cap and ceiling (R6) and the stale → rejudging path (R5) are rows
// here, not code elsewhere. Seed: v1's `doorRefusals` / `applyOverride` — override is a
// door, not a key.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, posix } from "node:path";
import { load, validate } from "../../shared/schema/index.mjs";
import { Refused } from "../../shared/refused.mjs";
import { verdictFreshness } from "../../shared/judge/index.mjs";
import { sha256 } from "../../shared/hash.mjs";
import { roles } from "../../shared/agent-call/index.mjs";
import { HANDOFFS, handoffFile, readHandoffs, verifyHandoff } from "../../shared/handoff.mjs";

export { Refused };
export const RUN_FILE = join("forge", "run.json");
export const LEDGER = join("forge", "delivery", "calls.jsonl");
/** Every verdict ever filed on the run, with what it judged — `<stage>/<seq>/` under here. */
export const ROUNDS = join("forge", "delivery", "rounds");

// The vocabulary is the schema's (R10): stages in pipeline order, the state enum as declared.
const SCHEMA = load("run");
export const STAGES = SCHEMA.properties.stages.required;
export const STATES = SCHEMA.$defs.stage.properties.status.enum;
/** SPEC §10.5 starting values — calibrated at M3, never tuned mid-run. */
export const DEFAULTS = { cap: 2, ceiling: 3, liveness_ms: 5 * 60_000 };

const LIVE = new Set(["running", "rejudging"]);

/**
 * The guards. Each says what it tests, the code it refuses with, and whether a human's
 * word may pass it. The arithmetic guards (cap, ceiling, liveness) take no word: the cap
 * is a door because it lands in `blocked`, where the human's moves are escalate, approve
 * on the record, or stop — not because it can be talked past.
 */
export const GUARDS = {
  dead:            { code: "stage-running",   overridable: false, test: (st, run, ctx) => liveness(st, { now: ctx.now, window: run.liveness_ms }).state === "dead",
                     say: (st, run, ctx) => `the stage is running and alive (silent ${liveness(st, { now: ctx.now, window: run.liveness_ms }).silent_ms} ms of ${run.liveness_ms}) — wait for it, or stop it with a reason` },
  verdict:         { code: "no-verdict",      overridable: false, test: (st, run, ctx) => typeof ctx.verdict?.verdict === "string" && typeof ctx.verdict?.path === "string",
                     say: () => "no verdict was filed — a round that judged nothing is not a round" },
  fresh:           { code: "verdict-stale",   overridable: true,  test: (st, run, ctx) => ctx.fresh === true,
                     say: (st, run, ctx) => ctx.fresh === null ? "the verdict pinned nothing — it is not evidence of the artifact on disk" : "the verdict's pins no longer match the artifacts — re-judge before approving" },
  "non-block":     { code: "judge-blocked",   overridable: true,  test: (st, run, ctx) => ctx.verdict?.verdict !== "block",
                     say: () => "the judge blocked — regenerate under the cap, escalate with a reason, or approve on your word" },
  block:           { code: "not-blocked",     overridable: false, test: (st, run, ctx) => ctx.verdict?.verdict === "block",
                     say: (st, run, ctx) => `the verdict is ${ctx.verdict?.verdict} — nothing to regenerate; approve` },
  "under-cap":     { code: "at-cap",          overridable: false, test: (st, run) => st.round < run.cap,
                     say: (st, run) => `round ${st.round} of ${run.cap} — the cap is reached; the block is the human's call` },
  "at-cap":        { code: "rounds-remain",   overridable: false, test: (st, run) => st.round >= run.cap,
                     say: (st, run) => `round ${st.round} of ${run.cap} — rounds remain; regenerate` },
  "under-ceiling": { code: "at-ceiling",      overridable: false, test: (st, run) => st.round < run.ceiling,
                     say: (st, run) => `round ${st.round} is the ceiling (${run.ceiling}) — no round left to buy; approve on the record, or stop` },
  reason:          { code: "reason-required", overridable: false, test: (st, run, ctx) => typeof ctx.by === "string" && ctx.by.trim() !== "" && typeof ctx.reason === "string" && ctx.reason.trim() !== "",
                     say: () => "this door takes a name and a reason, on the record" },
};

/**
 * The table. Guards run in order; the first that fails refuses with its code — unless it
 * is overridable and the caller gave `override` with a name and a reason, in which case a
 * flag is written naming the guard and the transition goes through. `opens` starts a new
 * episode: the round returns to zero. `counts` is a judged round: the round advances.
 */
export const TRANSITIONS = [
  { from: "pending",   event: "start",      to: "running",   guards: [] },
  { from: "stopped",   event: "start",      to: "running",   guards: [], opens: true },
  { from: "running",   event: "start",      to: "running",   guards: ["dead"], recovers: true },
  { from: "running",   event: "finish",     to: "review",    guards: ["verdict"], counts: true },
  { from: "review",    event: "approve",    to: "approved",  guards: ["fresh", "non-block"] },
  { from: "review",    event: "regenerate", to: "running",   guards: ["block", "under-cap"] },
  { from: "review",    event: "cap",        to: "blocked",   guards: ["block", "at-cap"] },
  { from: "blocked",   event: "escalate",   to: "running",   guards: ["reason", "under-ceiling"] },
  { from: "blocked",   event: "approve",    to: "approved",  guards: ["fresh", "non-block"] },
  { from: "approved",  event: "moved",      to: "stale",     guards: [], opens: true },
  { from: "review",    event: "moved",      to: "stale",     guards: [], opens: true },
  { from: "blocked",   event: "moved",      to: "stale",     guards: [], opens: true },
  // JUDGED is derived from these rows, and a stage part way through a re-judge holds a
  // judgement as much as one that finished. Left out, `adoptHandoff` skipped it and the
  // in-flight verdict cleared against a handoff it had never seen.
  { from: "rejudging", event: "moved",      to: "stale",     guards: [], opens: true },
  { from: "stale",     event: "rejudge",    to: "rejudging", guards: [] },
  { from: "rejudging", event: "clear",      to: "approved",  guards: ["verdict", "non-block", "fresh"], noWord: true },
  { from: "rejudging", event: "reblock",    to: "review",    guards: ["verdict", "block"] },
  { from: "approved",  event: "reopen",     to: "running",   guards: ["reason"], opens: true },
  { from: "*",         event: "stop",       to: "stopped",   guards: ["reason"] },
];
export const EVENTS = [...new Set(TRANSITIONS.map((r) => r.event))];
/** Events that leave a flag on the record whenever they go through: a human's reason is history. */
const FLAGGED = new Set(["escalate", "reopen", "stop", "moved"]);
/** The states a stage holds a judgement in — what `moved` sends stale (R5): the rows the table moves from. Read by the adopt door here and the reopen door in the loop. */
export const JUDGED = new Set(TRANSITIONS.filter((r) => r.event === "moved").map((r) => r.from));

const iso = (d) => (d instanceof Date ? d : new Date(d ?? Date.now())).toISOString();

// ── the pure table ──

/**
 * Apply one event to one stage of a run in hand. Returns `{ run, flags, filed }` — the new
 * run (the given one is not touched), the flags this transition added, and whether the
 * event filed a verdict (the store keeps every one it does). Refuses with
 * `no-stage`, `no-event`, `no-transition`, or a guard's code. Context: `by`, `reason`,
 * `override`, `verdict` ({ verdict, path } — what was filed), `fresh` (true | false |
 * null — the pins checked), `now`.
 */
export function apply(run, ctx) {
  const { stage, event } = ctx;
  if (!STAGES.includes(stage)) throw new Refused("no-stage", `${stage} is not a stage — one of ${STAGES.join(", ")}`);
  if (!EVENTS.includes(event)) throw new Refused("no-event", `${event} is not an event — one of ${EVENTS.join(", ")}`);
  const st = run.stages[stage];
  const row = TRANSITIONS.find((r) => r.event === event && (r.from === st.status || (r.from === "*" && st.status !== "stopped")));
  if (!row) throw new Refused("no-transition", `${stage}: ${st.status} —${event}→ has no transition`, { stage, from: st.status, event });

  const now = iso(ctx.now);
  const flags = [];
  const word = ctx.override && !row.noWord;
  for (const name of row.guards) {
    const g = GUARDS[name];
    if (g.test(st, run, ctx)) continue;
    if (!(g.overridable && word)) throw new Refused(g.code, `${stage}: ${g.say(st, run, ctx)}`, { stage, from: st.status, event, guard: name });
    if (!GUARDS.reason.test(st, run, ctx)) throw new Refused("reason-required", `${stage}: an override is a human's word — it takes a name and a reason`, { stage, event, guard: name });
    flags.push({ at: now, stage, event, by: ctx.by, reason: ctx.reason, override: true, guard: g.code, note: g.say(st, run, ctx) });
  }
  if (FLAGGED.has(event)) flags.push({ at: now, stage, event, by: ctx.by ?? "runner", reason: ctx.reason ?? "", ...(ctx.items?.length ? { items: [...ctx.items] } : {}), override: false });
  if (row.recovers) flags.push({ at: now, stage, event, by: ctx.by ?? "wrapper", reason: "restarted over a dead stage", override: false, note: `the stage was dead: silent ${liveness(st, { now: ctx.now, window: run.liveness_ms }).silent_ms} ms, window ${run.liveness_ms} ms` });

  const next = { ...st, status: row.to };
  if (row.opens) next.round = 0;
  if (row.counts) next.round = st.round + 1;
  // a reopen is the human's reason to redo an approved stage — and the items it names, when it
  // names any: it rides the episode on the stage until the redo files a verdict — a restart
  // still knows why it runs and what it is about; a later round does not need to
  if (event === "reopen") next.reopened = { by: ctx.by, reason: ctx.reason, at: now, ...(ctx.items?.length ? { items: [...ctx.items] } : {}), ...(ctx.from ? { from: ctx.from } : {}) };
  if (row.counts) delete next.reopened;
  if (LIVE.has(row.to)) { next.started_at = now; next.heartbeat_at = now; next.finished_at = null; }
  const filed = Boolean(ctx.verdict?.path && row.guards.includes("verdict"));
  if (filed) { next.verdict = ctx.verdict.path; next.finished_at = now; }
  const out = { ...run, stages: { ...run.stages, [stage]: next }, flags: [...run.flags, ...flags] };
  return { run: out, flags, filed };
}

/** Alive, dead, or idle (not running) — read from the heartbeat's age, never stored. */
export function liveness(st, { now, window }) {
  if (!LIVE.has(st.status) || !st.heartbeat_at) return { state: "idle", silent_ms: null };
  const silent_ms = new Date(iso(now)).getTime() - new Date(st.heartbeat_at).getTime();
  return { state: silent_ms > window ? "dead" : "alive", silent_ms };
}

/** The one reader: what a console shows. `shown` says dead where the store says running and the heartbeat says otherwise. */
export function view(run, now = new Date()) {
  const stages = STAGES.map((stage) => {
    const st = run.stages[stage];
    const live = liveness(st, { now, window: run.liveness_ms });
    return { stage, ...st, shown: live.state === "dead" ? "dead" : st.status, silent_ms: live.silent_ms, cap: run.cap, ceiling: run.ceiling };
  });
  return { id: run.id, handoff: run.handoff, by: run.by, created_at: run.created_at, budget: run.budget, models: run.models, stages, flags: run.flags };
}

// ── the store ──

export function readRun(root) {
  const p = join(root, RUN_FILE);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

function writeRun(root, run) {
  const v = validate("run", run);
  if (!v.ok) throw new Refused("run-invalid", `${RUN_FILE}: the record does not fit its schema — ${v.errors.slice(0, 5).join("; ")}`, v.errors);
  const p = join(root, RUN_FILE);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(`${p}.tmp`, JSON.stringify(run, null, 2) + "\n");
  renameSync(`${p}.tmp`, p);
  return run;
}

function needRun(root) {
  const run = readRun(root);
  if (!run) throw new Refused("no-run", `${root} has no ${RUN_FILE} — set Delivery up first`);
  return run;
}

/** The handoff Delivery may take: present, intact, its design signed. Same three refusals at setup and at adoption — and the console asks the same question of every handoff it lists. */
export function takeHandoff(root, version) {
  const all = readHandoffs(root);
  const h = version ? all.find((x) => x.version === version) : all.at(-1);
  if (!h) throw new Refused("no-handoff", version ? `no handoff v${version} under ${HANDOFFS}` : `no handoff under ${HANDOFFS} — export one from Discovery first`);
  const integrity = verifyHandoff(h);
  if (integrity.verdict === "block") throw new Refused("handoff-integrity", `handoff v${h.version} does not verify: ${integrity.findings.map((f) => `${f.subject} ${f.rule}`).join(", ")} — a snapshot is never edited; re-export`, integrity);
  const signed = Boolean(h.design?.signoff) && h.design.signoff.content_hash === h.design.meta?.content_hash;
  if (!signed) throw new Refused("design-unsigned", `handoff v${h.version} carries a design nobody signed — what Delivery builds is signed; export through the Delivery exit`, h.exit);
  return { handoff: h, pin: { version: h.version, path: handoffFile(h.version), content_hash: h.meta.content_hash } };
}

/**
 * Delivery setup. Refuses, in order: no name; no `.git`; a run already here; no handoff,
 * a broken one, an unsigned one; rounds that make no sense; a model for a role nobody
 * configured. Then writes the one record with every stage pending.
 */
export function createRun(root, { by, version, cap = DEFAULTS.cap, ceiling = DEFAULTS.ceiling, liveness_ms = DEFAULTS.liveness_ms, budget = null, models = {}, now } = {}) {
  if (typeof by !== "string" || by.trim() === "") throw new Refused("no-author", "setup: a run is set up by a named person");
  if (!existsSync(join(root, ".git"))) throw new Refused("no-project", `${root} has no .git — Delivery runs in the project's repository`);
  if (existsSync(join(root, RUN_FILE))) throw new Refused("run-exists", `${RUN_FILE} exists — a new handoff is adopted onto the run, not run afresh`);
  const { handoff, pin } = takeHandoff(root, version);
  if (!(Number.isInteger(cap) && cap >= 1 && Number.isInteger(ceiling) && ceiling >= cap)) throw new Refused("bad-rounds", `setup: cap ${cap} and ceiling ${ceiling} — the cap is at least 1 and the ceiling is never below it`);
  const known = roles();
  const unknown = Object.keys(models).filter((k) => !known.includes(k) || !k.startsWith("delivery."));
  if (unknown.length) throw new Refused("unknown-role", `setup: no such Delivery role ${unknown.join(", ")} — one of ${known.filter((k) => k.startsWith("delivery.")).join(", ")}`);
  const run = {
    id: handoff.project.slug, handoff: pin, created_at: iso(now), by, cap, ceiling, liveness_ms, budget, models,
    stages: Object.fromEntries(STAGES.map((s) => [s, { status: "pending", round: 0, started_at: null, heartbeat_at: null, finished_at: null, verdict: null }])),
    flags: [],
  };
  return writeRun(root, run);
}

/** A verdict on the record, read by path; null when the path holds no finding document. */
function verdictAt(root, path) {
  if (typeof path !== "string" || !existsSync(join(root, path))) return null;
  try {
    const doc = JSON.parse(readFileSync(join(root, path), "utf8"));
    return validate("finding", doc).ok ? doc : null;
  } catch { return null; }
}

/**
 * One event through the store: read, guard, write. `verdict` is the root-relative path
 * the wrapper filed (finish, clear, reblock); the approve door reads the stage's recorded
 * verdict and checks its pins against disk itself — nothing about freshness is passed in.
 *
 * The record is written before the round is kept. Retention copies what the table already
 * admitted; a copy that fails must not undo the admission (the verdict is on disk and the
 * round happened) and must not pass unremarked (a round the reader cannot find is a judge
 * miss nobody can attribute). So a failed keep takes the table's own door: the stage is
 * stopped by the store with the error as the flagged reason, and the error is rethrown —
 * the record says what happened, and the caller hears it.
 */
export function transition(root, { stage, event, by, reason, items, override, verdict, from, now } = {}) {
  const run = needRun(root);
  const st = run.stages[stage];
  const path = verdict ?? st?.verdict ?? null;
  const doc = verdictAt(root, path);
  const freshness = doc ? verdictFreshness(doc, { root }) : null;
  const ctx = { stage, event, by, reason, items, override, from, now, verdict: doc ? { verdict: doc.verdict, path } : null, fresh: freshness?.fresh ?? null };
  const out = apply(run, ctx);
  writeRun(root, out.run);
  if (out.filed) {
    try {
      retain(root, { stage, event, round: out.run.stages[stage].round, path, doc, stale: freshness.stale, now });
    } catch (err) {
      const reason = `retention: ${String(err.message).split("\n")[0]}`.slice(0, 400);
      writeRun(root, apply(out.run, { stage, event: "stop", by: "store", reason, now }).run);
      throw err;
    }
  }
  return out;
}

// ── every verdict, kept ──

/**
 * A verdict is filed on a fixed path — `sdd.json` beside `reviews/sdd.json` — and the next
 * round overwrites both. R8's judge miss (a finding a later verdict contradicts) is only
 * attributable while the earlier round can still be read, so every filing keeps the
 * verdict with what it judged, at `rounds/<stage>/<seq>/`: the verdict as `verdict.json`,
 * each pinned artifact under the delivery record by its own name, and `round.json` saying
 * which event filed it at which round. The handoff is pinned too but not copied — it is
 * versioned outside the record and never edited. A pin gone stale between judging and
 * filing is named, not copied: a copy of what is on disk now would misrepresent what was
 * judged. `seq` counts filings per stage across episodes; `round` restarts, `seq` does not.
 * Nothing here gates: the table admitted the event before this runs.
 */
const KEPT_UNDER = `${posix.join("forge", "delivery")}/`;
const VERDICT_COPY = "verdict.json";

function retain(root, { stage, event, round, path, doc, stale, now }) {
  const seq = rounds(root, stage).reduce((n, r) => Math.max(n, r.seq), 0) + 1;
  const dir = posix.join(ROUNDS, stage, String(seq));
  mkdirSync(join(root, dir), { recursive: true });
  copyFileSync(join(root, path), join(root, dir, VERDICT_COPY));
  const gone = new Set(stale.map((s) => s.id));
  const kept = [];
  for (const p of doc.judged ?? []) {
    if (!p.path.startsWith(KEPT_UNDER) || gone.has(p.id) || p.path === path) continue;
    copyFileSync(join(root, p.path), join(root, dir, basename(p.path)));
    kept.push({ id: p.id, path: p.path, content_hash: p.content_hash, as: basename(p.path) });
  }
  const record = { seq, stage, event, round, at: iso(now), filed: { path, sha256: sha256(doc) }, kept, stale };
  writeFileSync(join(root, dir, "round.json.tmp"), JSON.stringify(record, null, 2) + "\n");
  renameSync(join(root, dir, "round.json.tmp"), join(root, dir, "round.json"));
  return record;
}

/** Every filing for a stage, in order: `round.json` with `dir` (root-relative) and the kept `verdict` read back. */
export function rounds(root, stage) {
  const base = join(root, ROUNDS, stage);
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((d) => /^\d+$/.test(d) && existsSync(join(base, d, "round.json")))
    .map((d) => {
      const dir = posix.join(ROUNDS, stage, d);
      const record = JSON.parse(readFileSync(join(root, dir, "round.json"), "utf8"));
      return { ...record, dir, verdict: JSON.parse(readFileSync(join(root, dir, VERDICT_COPY), "utf8")) };
    })
    .sort((a, b) => a.seq - b.seq);
}

/**
 * The newest kept judgement of each item across a stage's filings — what a per-item
 * judge may copy forward when it is about to ask the same question (same key) again.
 * Read from the kept rounds, not the standing verdict alone: an arithmetic block files
 * no judgements, and the round before it still answered.
 */
export function judgements(root, stage) {
  const by = new Map();
  for (const r of rounds(root, stage).reverse()) for (const it of r.verdict.items ?? []) if (!by.has(it.id)) by.set(it.id, it);
  return [...by.values()];
}

/** The wrapper's pulse. Only a running or rejudging stage has one. */
export function heartbeat(root, stage, now) {
  const run = needRun(root);
  const st = run.stages[stage];
  if (!st) throw new Refused("no-stage", `${stage} is not a stage`);
  if (!LIVE.has(st.status)) throw new Refused("not-running", `${stage} is ${st.status} — nothing is running to heartbeat`);
  return writeRun(root, { ...run, stages: { ...run.stages, [stage]: { ...st, heartbeat_at: iso(now) } } });
}

/**
 * A new handoff onto a standing run (R5): the pin moves; every judged stage goes stale —
 * to be re-judged, not regenerated (SPEC §5: approved → stale). A stage in review or
 * blocked holds a verdict too, judged against the contract that just moved: it goes stale
 * the same way, and `opens` returns its round to zero, so the re-judge's reblock has the
 * whole cap ahead of it instead of one escalate at the ceiling — the human's answer in
 * Discovery is the door, not a word on the record. Stages mid-flight are left alone: a
 * verdict pins what it judged, so a judge that pinned the handoff among its inputs goes
 * stale with it at the door; one that did not, does not. That pin is the stage loop's to write.
 */
export function adoptHandoff(root, { version, by, now } = {}) {
  let run = needRun(root);
  const { pin } = takeHandoff(root, version);
  if (pin.content_hash === run.handoff.content_hash) throw new Refused("same-handoff", `handoff v${pin.version} is already the run's — nothing moved`);
  const was = run.handoff.version;
  const moved = [];
  run = { ...run, handoff: pin };
  for (const stage of STAGES) {
    if (!JUDGED.has(run.stages[stage].status)) continue;
    run = apply(run, { stage, event: "moved", by: by ?? "runner", reason: `handoff v${was} → v${pin.version}`, now }).run;
    moved.push(stage);
  }
  writeRun(root, run);
  return { run, moved };
}
