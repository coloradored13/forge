#!/usr/bin/env node
// owns: R9, R6, R5 · delivery — eval: transition-table. One state machine, one store, one
// reader: every (state, event) pair either has exactly one row or is refused with a named
// code — the table is walked exhaustively, not sampled. Every guard is tried both ways;
// an overridable guard passes only on a human's word and leaves a flag; a stage silent
// past the liveness window reads as dead, in that word, and only a dead stage may be
// started over. Setup refuses without a repository, a handoff, an intact handoff, a
// signed design. The v1 door table (`doorRefusals`, `applyOverride`) is the seed; the
// stale → rejudging → {approved | review} path (R5) and the cap and ceiling (R6) are rows
// here, proved in their own suites too.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { suite, withRoot, scripted } from "./_harness.mjs";
import { seedProject, seedPrototype, seedStories, seedDesign, DESIGN } from "./_fixture.mjs";
import { review, signoff } from "../discovery/design/index.mjs";
import { exportHandoff } from "../discovery/export/index.mjs";
import { validate, load, contractOf } from "../shared/schema/index.mjs";
import { stamp } from "../shared/hash.mjs";
import { Refused } from "../shared/refused.mjs";
import {
  RUN_FILE, ROUNDS, STAGES, STATES, EVENTS, TRANSITIONS, GUARDS, DEFAULTS,
  createRun, readRun, apply, transition, heartbeat, liveness, view, adoptHandoff,
} from "../delivery/state/index.mjs";

const { check, done } = suite("transition-table · one state machine, one store, one reader");

const T0 = new Date("2026-09-05T12:00:00Z");
const at = (ms) => new Date(T0.getTime() + ms);
const refusal = (fn) => { try { fn(); return null; } catch (e) { return e; } };
const noExec = () => { throw new Error("no command expected"); };
const clean = () => scripted({ structured: { findings: [], deferred: [], checked: 2, skipped: 0 } }).query;

// A run in hand, no disk: the pure table is walked on this.
const runOf = (over = {}) => ({
  id: "dock", handoff: { version: 4, path: "discovery/handoffs/handoff-v4.json", content_hash: "a".repeat(64) },
  created_at: T0.toISOString(), by: "Brad", cap: 2, ceiling: 3, liveness_ms: 300_000, budget: null, models: {},
  stages: Object.fromEntries(STAGES.map((s) => [s, { status: "pending", round: 0, started_at: null, heartbeat_at: null, finished_at: null, verdict: null }])),
  flags: [], ...over,
});
const inState = (status, extra = {}) => runOf({ stages: { ...runOf().stages, sdd: { status, round: 1, started_at: T0.toISOString(), heartbeat_at: T0.toISOString(), finished_at: null, verdict: "forge/delivery/reviews/sdd-1.json", ...extra } } });
const V = (verdict) => ({ verdict, path: `forge/delivery/reviews/sdd-${verdict}.json` });
// A context that satisfies every guard at once, so a row's own guards are never what refuses a pair.
const SATISFIED = { by: "Brad", reason: "because", verdict: V("block"), fresh: true, now: at(10 * 60_000) };
const SATISFIED_NONBLOCK = { ...SATISFIED, verdict: V("advise") };

// ── the table itself ──

check("the schema is the home of the vocabulary: five stages, eight states, read from run.schema.json — none retyped here",
  STAGES.join() === "intake,sdd,build,qa,release" && STATES.join() === "pending,running,review,approved,blocked,stale,rejudging,stopped" && load("run").$defs.stage.properties.status.enum.join() === STATES.join());
check("`dead` is not a state — it is read from the heartbeat, never written", !STATES.includes("dead"));
// What a table must be, checked on a seeded bad one first so the check is known to bite.
const flaws = (table) => {
  const out = [], seen = new Set();
  for (const r of table) {
    if (!(r.from === "*" || STATES.includes(r.from))) out.push(`from ${r.from} is not a state`);
    if (!STATES.includes(r.to)) out.push(`to ${r.to} is not a state`);
    for (const g of r.guards ?? []) if (!(g in GUARDS)) out.push(`guard ${g} does not exist`);
    const key = `${r.from} —${r.event}→`;
    if (seen.has(key)) out.push(`${key} has two rows`); seen.add(key);
  }
  return out;
};
const seededBad = [...TRANSITIONS, { from: "running", event: "start", to: "dead", guards: ["liveness"] }];
check("seeded: a row landing in `dead` with a guard nobody defined, doubling a pair, is caught three ways", flaws(seededBad).length === 3, flaws(seededBad).join("; "));
check("every row's from and to name a state or the wildcard, every guard it names exists, no pair has two rows", flaws(TRANSITIONS).length === 0, flaws(TRANSITIONS).join("; "));
check("EVENTS is exactly the set of events the table names", EVENTS.join() === [...new Set(TRANSITIONS.map((r) => r.event))].join());
check("every guard names the code it refuses with, and says whether a human's word may pass it",
  Object.values(GUARDS).every((g) => typeof g.code === "string" && typeof g.test === "function" && typeof g.overridable === "boolean"));
check("the starting values are the spec's §10.5: cap 2, ceiling 3, five minutes", DEFAULTS.cap === 2 && DEFAULTS.ceiling === 3 && DEFAULTS.liveness_ms === 300_000);

// Exhaustive: STATES × EVENTS. A pair with a row lands where the row says under a
// satisfied context; a pair without one is refused `no-transition`, never silently ignored.
let pairs = 0, landed = 0, refused = 0, wrong = [];
for (const from of STATES) for (const event of EVENTS) {
  pairs++;
  const rows = TRANSITIONS.filter((r) => (r.from === from || (r.from === "*" && from !== "stopped")) && r.event === event);
  if (rows.length > 1) { wrong.push(`${from} —${event}→ has ${rows.length} rows`); continue; }
  // `cap` needs the round at the cap; `dead` needs a dead stage — the context is ten minutes on from the heartbeat.
  const run = inState(from, event === "cap" ? { round: 2 } : {});
  const ctx = { ...(event === "approve" || event === "clear" ? SATISFIED_NONBLOCK : SATISFIED), stage: "sdd", event };
  const e = refusal(() => apply(run, ctx));
  if (rows.length === 1) {
    if (e) wrong.push(`${from} —${event}→ refused ${e.code}: ${e.message}`);
    else if (apply(run, ctx).run.stages.sdd.status !== rows[0].to) wrong.push(`${from} —${event}→ landed in ${apply(run, ctx).run.stages.sdd.status}, row says ${rows[0].to}`);
    else landed++;
  } else {
    if (!e) wrong.push(`${from} —${event}→ went through with no row`);
    else if (e.code !== "no-transition") wrong.push(`${from} —${event}→ refused ${e.code}, not no-transition`);
    else refused++;
  }
}
check(`every (state, event) pair is decided: ${landed} land, ${refused} are refused by name, ${pairs} pairs`, wrong.length === 0 && landed + refused === pairs && pairs === STATES.length * EVENTS.length, wrong.slice(0, 4).join(" | "));
check("a refusal names the pair", refusal(() => apply(inState("pending"), { stage: "sdd", event: "approve", by: "Brad" }))?.message.includes("pending —approve→"));
check("stopped is terminal for stop; `*` does not reach it", refusal(() => apply(inState("stopped"), { ...SATISFIED, stage: "sdd", event: "stop" }))?.code === "no-transition");
check("an unknown stage or event is refused, not a no-op",
  refusal(() => apply(runOf(), { stage: "paint", event: "start" }))?.code === "no-stage" && refusal(() => apply(runOf(), { stage: "sdd", event: "sing" }))?.code === "no-event");
check("apply never mutates the run it was given", (() => { const r = inState("review"); apply(r, { ...SATISFIED_NONBLOCK, stage: "sdd", event: "approve" }); return r.stages.sdd.status === "review" && r.flags.length === 0; })());

// ── guards, both ways ──

// start: only a dead stage is started over.
const running = inState("running", { heartbeat_at: T0.toISOString() });
const alive = refusal(() => apply(running, { stage: "sdd", event: "start", by: "wrapper", now: at(60_000) }));
check("start over a running stage that heartbeated a minute ago is refused stage-running", alive?.code === "stage-running" && /alive/.test(alive.message), alive?.message);
const overDead = apply(running, { stage: "sdd", event: "start", by: "wrapper", now: at(6 * 60_000) });
check("start over a stage silent six minutes lands in running, and the restart is on the record as one", overDead.run.stages.sdd.status === "running" && overDead.flags.length === 1 && overDead.flags[0].event === "start" && /dead/.test(overDead.flags[0].note) && overDead.run.flags.length === 1, JSON.stringify(overDead.flags));
check("a human's word does not pass the liveness guard — an alive stage is stopped with a reason, not restarted over",
  refusal(() => apply(running, { stage: "sdd", event: "start", by: "Brad", reason: "impatient", override: true, now: at(60_000) }))?.code === "stage-running");

// finish: the wrapper carries a verdict, and the round is counted.
const fin = apply(running, { stage: "sdd", event: "finish", by: "wrapper", verdict: V("advise"), now: at(120_000) });
check("finish lands in review with the verdict path on the stage, round counted, finished_at set",
  fin.run.stages.sdd.status === "review" && fin.run.stages.sdd.verdict === V("advise").path && fin.run.stages.sdd.round === 2 && fin.run.stages.sdd.finished_at === at(120_000).toISOString());
check("finish without a verdict is refused no-verdict — a round that judged nothing is not a round", refusal(() => apply(running, { stage: "sdd", event: "finish", by: "wrapper" }))?.code === "no-verdict");
check("finish is the wrapper's; no override applies", refusal(() => apply(running, { stage: "sdd", event: "finish", by: "Brad", reason: "trust me", override: true }))?.code === "no-verdict");

// approve: a fresh, non-block verdict — or a human's word, flagged.
const rev = inState("review");
check("approve on a fresh advise lands in approved with no flag", (() => { const r = apply(rev, { stage: "sdd", event: "approve", by: "runner", verdict: V("advise"), fresh: true }); return r.run.stages.sdd.status === "approved" && r.flags.length === 0; })());
check("approve on a fresh pass lands in approved", apply(rev, { stage: "sdd", event: "approve", by: "runner", verdict: V("pass"), fresh: true }).run.stages.sdd.status === "approved");
const blocked = refusal(() => apply(rev, { stage: "sdd", event: "approve", by: "runner", verdict: V("block"), fresh: true }));
check("approve over a block is refused judge-blocked", blocked?.code === "judge-blocked");
const stale = refusal(() => apply(rev, { stage: "sdd", event: "approve", by: "runner", verdict: V("advise"), fresh: false }));
check("approve over a stale verdict is refused verdict-stale — presence is never evidence", stale?.code === "verdict-stale");
check("a verdict that pinned nothing is not fresh either", refusal(() => apply(rev, { stage: "sdd", event: "approve", by: "runner", verdict: V("advise"), fresh: null }))?.code === "verdict-stale");
const word = apply(rev, { stage: "sdd", event: "approve", by: "Brad", reason: "the block is a style nit; shipping", override: true, verdict: V("block"), fresh: true });
check("approve over a block on a human's word lands in approved, and the flag names the guard, the person and the reason",
  word.run.stages.sdd.status === "approved" && word.flags.length === 1 && word.flags[0].override === true && word.flags[0].guard === "judge-blocked" && word.flags[0].by === "Brad" && word.flags[0].reason === "the block is a style nit; shipping" && word.flags[0].stage === "sdd", JSON.stringify(word.flags));
check("an override without a reason is refused reason-required — the word is the reason on the record",
  refusal(() => apply(rev, { stage: "sdd", event: "approve", by: "Brad", override: true, verdict: V("block"), fresh: true }))?.code === "reason-required");
check("an override without a name is refused too", refusal(() => apply(rev, { stage: "sdd", event: "approve", reason: "ship", override: true, verdict: V("block"), fresh: true }))?.code === "reason-required");
const two = apply(rev, { stage: "sdd", event: "approve", by: "Brad", reason: "both", override: true, verdict: V("block"), fresh: false });
check("two guards overridden at once leave two flags, one per guard", two.flags.length === 2 && two.flags.map((f) => f.guard).sort().join() === "judge-blocked,verdict-stale");

// regenerate and cap: the arithmetic of R6, at the boundary.
const rev1 = inState("review", { round: 1 });
const rev2 = inState("review", { round: 2 });
check("a block under the cap regenerates: review → running, round unchanged until the next finish",
  (() => { const r = apply(rev1, { stage: "sdd", event: "regenerate", by: "runner", verdict: V("block") }); return r.run.stages.sdd.status === "running" && r.run.stages.sdd.round === 1 && r.run.stages.sdd.finished_at === null; })());
check("regenerate at the cap is refused at-cap", refusal(() => apply(rev2, { stage: "sdd", event: "regenerate", by: "runner", verdict: V("block") }))?.code === "at-cap");
check("regenerate on an advise is refused not-blocked — an advise proceeds, it is not regenerated", refusal(() => apply(rev1, { stage: "sdd", event: "regenerate", by: "runner", verdict: V("advise") }))?.code === "not-blocked");
check("cap at round 2 of 2 lands in blocked", apply(rev2, { stage: "sdd", event: "cap", by: "runner", verdict: V("block") }).run.stages.sdd.status === "blocked");
check("cap with rounds remaining is refused rounds-remain", refusal(() => apply(rev1, { stage: "sdd", event: "cap", by: "runner", verdict: V("block") }))?.code === "rounds-remain");
check("cap on an advise is refused not-blocked", refusal(() => apply(rev2, { stage: "sdd", event: "cap", by: "runner", verdict: V("advise") }))?.code === "not-blocked");
check("neither cap guard takes a human's word — the arithmetic is not a door",
  refusal(() => apply(rev2, { stage: "sdd", event: "regenerate", by: "Brad", reason: "once more", override: true, verdict: V("block") }))?.code === "at-cap");

// escalate: a reason buys a round, up to the ceiling.
const blk2 = inState("blocked", { round: 2 });
const blk3 = inState("blocked", { round: 3 });
const esc = apply(blk2, { stage: "sdd", event: "escalate", by: "Brad", reason: "the judge misread the fixture; one more round with the note" });
check("escalate under the ceiling lands in running with the round kept and a flag carrying the reason",
  esc.run.stages.sdd.status === "running" && esc.run.stages.sdd.round === 2 && esc.flags.length === 1 && esc.flags[0].event === "escalate" && esc.flags[0].override === false && /misread/.test(esc.flags[0].reason));
check("escalate without a reason is refused reason-required", refusal(() => apply(blk2, { stage: "sdd", event: "escalate", by: "Brad" }))?.code === "reason-required");
check("escalate with a blank reason is refused too", refusal(() => apply(blk2, { stage: "sdd", event: "escalate", by: "Brad", reason: "  " }))?.code === "reason-required");
check("escalate at the ceiling is refused at-ceiling, and the word does not pass it — approve on the record, or stop",
  refusal(() => apply(blk3, { stage: "sdd", event: "escalate", by: "Brad", reason: "again" }))?.code === "at-ceiling" && refusal(() => apply(blk3, { stage: "sdd", event: "escalate", by: "Brad", reason: "again", override: true }))?.code === "at-ceiling");
check("blocked → approved is the same approve door: refused judge-blocked without the word, flagged with it",
  refusal(() => apply(blk3, { stage: "sdd", event: "approve", by: "runner", verdict: V("block"), fresh: true }))?.code === "judge-blocked"
  && apply(blk3, { stage: "sdd", event: "approve", by: "Brad", reason: "accepting the residual", override: true, verdict: V("block"), fresh: true }).run.stages.sdd.status === "approved");

// The full R6 walk: cap 2, ceiling 3, one escalation, then the human's call.
{
  let r = runOf(), last = null;
  // As the store does: the verdict on the record rides into every event after the finish that filed it.
  const step = (event, ctx = {}) => { last = ctx.verdict ?? last; const out = apply(r, { stage: "sdd", event, by: "wrapper", verdict: last, fresh: true, ...ctx }); r = out.run; return out; };
  step("start", { now: at(0) });
  step("finish", { verdict: V("block"), now: at(60_000) });
  step("regenerate", { by: "runner" });
  step("finish", { verdict: V("block"), now: at(120_000) });
  const cannot = refusal(() => step("regenerate", { by: "runner" }));
  step("cap", { by: "runner" });
  step("escalate", { by: "Brad", reason: "one more with the judge's note attached" });
  step("finish", { verdict: V("block"), now: at(180_000) });
  const noMore = refusal(() => step("escalate", { by: "Brad", reason: "again" }));
  step("cap", { by: "runner" });
  const ceiling = refusal(() => step("escalate", { by: "Brad", reason: "again" }));
  check("the walk: two judged rounds hit the cap; one escalation buys the third; the ceiling refuses a fourth; three rounds are on the stage",
    cannot?.code === "at-cap" && noMore?.code === "no-transition" && ceiling?.code === "at-ceiling" && r.stages.sdd.status === "blocked" && r.stages.sdd.round === 3, `${cannot?.code} ${noMore?.code} ${ceiling?.code} ${r.stages.sdd.status} r${r.stages.sdd.round}`);
  step("stop", { by: "Brad", reason: "taking it up with the team" });
  check("stop lands in stopped with the reason flagged; start from stopped opens a new episode at round 0",
    r.stages.sdd.status === "stopped" && r.flags.at(-1).event === "stop" && step("start", { now: at(200_000) }).run.stages.sdd.round === 0);
  check("stop without a reason is refused reason-required", refusal(() => apply(inState("review"), { stage: "sdd", event: "stop", by: "Brad" }))?.code === "reason-required");
  check("flags are append-only across the walk: escalate, stop — nothing removed", r.flags.map((f) => f.event).join() === "escalate,stop");
}

// Staleness (R5): moved → stale → rejudging → approved | review, no round consumed.
const appr = inState("approved", { round: 2 });
const moved = apply(appr, { stage: "sdd", event: "moved", by: "runner", reason: "handoff v4 → v5" });
check("moved lands an approved stage in stale, round reset — a moved handoff is a new episode", moved.run.stages.sdd.status === "stale" && moved.run.stages.sdd.round === 0);
const rj = apply(moved.run, { stage: "sdd", event: "rejudge", by: "wrapper", now: at(0) });
check("rejudge lands in rejudging and starts the heartbeat", rj.run.stages.sdd.status === "rejudging" && rj.run.stages.sdd.heartbeat_at === T0.toISOString());
check("clear on a non-block verdict lands back in approved with the round still 0 — a pin refresh is never a round (R5)",
  (() => { const r = apply(rj.run, { stage: "sdd", event: "clear", by: "wrapper", verdict: V("pass") }); return r.run.stages.sdd.status === "approved" && r.run.stages.sdd.round === 0 && r.run.stages.sdd.verdict === V("pass").path; })());
check("clear on a block is refused judge-blocked; reblock takes it to review, round still 0",
  refusal(() => apply(rj.run, { stage: "sdd", event: "clear", by: "wrapper", verdict: V("block") }))?.code === "judge-blocked"
  && (() => { const r = apply(rj.run, { stage: "sdd", event: "reblock", by: "wrapper", verdict: V("block") }); return r.run.stages.sdd.status === "review" && r.run.stages.sdd.round === 0; })());
check("reblock on a pass is refused not-blocked", refusal(() => apply(rj.run, { stage: "sdd", event: "reblock", by: "wrapper", verdict: V("pass") }))?.code === "not-blocked");
check("clear over a block does not take a human's word — the word is spent at approve, on the record",
  refusal(() => apply(rj.run, { stage: "sdd", event: "clear", by: "Brad", reason: "fine", override: true, verdict: V("block") }))?.code === "judge-blocked");
// A handoff that moves under a judged-but-not-approved stage: the verdict it holds was judged
// against the old contract, so it goes stale the same way — and `opens` returns the round to
// zero, so the re-judge's reblock regenerates with the full cap ahead of it instead of the one
// `escalate` at the ceiling that a blocked stage would otherwise have as its only door.
for (const from of ["review", "blocked"]) {
  const judged = inState(from, { round: from === "blocked" ? 3 : 1, verdict: "forge/delivery/reviews/sdd-3.json" });
  const mv = apply(judged, { stage: "sdd", event: "moved", by: "runner", reason: "handoff v4 → v5" });
  check(`moved lands a ${from} stage in stale at round 0 with its verdict kept — the block was against a contract that moved, so it is re-judged, not escalated`,
    mv.run.stages.sdd.status === "stale" && mv.run.stages.sdd.round === 0 && mv.run.stages.sdd.verdict === "forge/delivery/reviews/sdd-3.json" && mv.flags.length === 1 && mv.flags[0].event === "moved" && /v4 → v5/.test(mv.flags[0].reason), `${mv.run.stages.sdd.status} r${mv.run.stages.sdd.round}`);
  const rb = apply(apply(mv.run, { stage: "sdd", event: "rejudge", by: "wrapper", now: at(0) }).run, { stage: "sdd", event: "reblock", by: "wrapper", verdict: V("block") });
  check(`from ${from}: rejudge → reblock lands in review at round 0, and regenerate is open again — the cap counts from the moved contract`,
    rb.run.stages.sdd.status === "review" && rb.run.stages.sdd.round === 0 && apply(rb.run, { stage: "sdd", event: "regenerate", by: "runner", verdict: V("block") }).run.stages.sdd.status === "running");
}
check("moved from running, rejudging, pending or stopped is refused no-transition — nothing judged there is stale",
  ["running", "rejudging", "pending", "stopped"].every((from) => refusal(() => apply(inState(from), { stage: "sdd", event: "moved", by: "runner", reason: "handoff v4 → v5" }))?.code === "no-transition"));

// Reopen (R6): a human's reason redoes an approved stage — a new episode in running, the
// reason held on the stage until the redo approves, so a restart over a dead or stopped
// reopen still knows what it is answering; the flag keeps it as history after.
const reopened = apply(appr, { stage: "sdd", event: "reopen", by: "Brad", reason: "the dock lead found the run sheet reads oldest-first", now: at(0) });
check("reopen takes a reason and opens a new episode in running, round 0, the verdict kept, the reason on the stage and on a flag",
  reopened.run.stages.sdd.status === "running" && reopened.run.stages.sdd.round === 0 && reopened.run.stages.sdd.verdict === appr.stages.sdd.verdict && reopened.run.stages.sdd.reopened?.by === "Brad" && /oldest-first/.test(reopened.run.stages.sdd.reopened.reason) && reopened.run.stages.sdd.reopened.at === T0.toISOString() && reopened.flags.length === 1 && reopened.flags[0].event === "reopen" && reopened.flags[0].override === false, JSON.stringify(reopened.run.stages.sdd));
check("reopen without a reason is refused", refusal(() => apply(appr, { stage: "sdd", event: "reopen", by: "Brad" }))?.code === "reason-required");
check("the reopen rides the episode until a binding answers it: a stop keeps it, a start from stopped keeps it, a dead restart keeps it — the finish that files the redo's verdict clears it, so a later round is scoped by the findings, not the reason",
  (() => {
    const stopped = apply(reopened.run, { stage: "sdd", event: "stop", by: "Brad", reason: "parking it" }).run;
    const restarted = apply(stopped, { stage: "sdd", event: "start", by: "Brad" }).run;
    const dead = { ...restarted, stages: { ...restarted.stages, sdd: { ...restarted.stages.sdd, heartbeat_at: T0.toISOString() } } };
    const recovered = apply(dead, { stage: "sdd", event: "start", by: "wrapper", now: at(300_001) }).run;
    const finished = apply(recovered, { stage: "sdd", event: "finish", by: "wrapper", verdict: V("advise") }).run;
    const approved = apply(finished, { stage: "sdd", event: "approve", by: "runner", verdict: V("advise"), fresh: true }).run;
    return stopped.stages.sdd.reopened?.by === "Brad" && restarted.stages.sdd.reopened?.by === "Brad" && recovered.stages.sdd.reopened?.by === "Brad" && finished.stages.sdd.status === "review" && !("reopened" in finished.stages.sdd) && approved.stages.sdd.status === "approved" && !("reopened" in approved.stages.sdd) && validate("run", finished).ok && validate("run", approved).ok;
  })());
check("the schema is the home of it: an open reopen is by, reason, at on the stage — nothing else, and never required", (() => { const s = load("run").$defs.stage.properties.reopened; return s?.required?.join() === "by,reason,at" && s.additionalProperties === false && !load("run").$defs.stage.required.includes("reopened"); })());

// Liveness is read, never written.
check("liveness: a running stage heartbeated inside the window is alive, past it dead, and the silence is measured",
  liveness({ status: "running", heartbeat_at: T0.toISOString() }, { now: at(299_000), window: 300_000 }).state === "alive"
  && liveness({ status: "running", heartbeat_at: T0.toISOString() }, { now: at(301_000), window: 300_000 }).state === "dead"
  && liveness({ status: "running", heartbeat_at: T0.toISOString() }, { now: at(301_000), window: 300_000 }).silent_ms === 301_000);
check("a rejudging stage is held to the same window; a stage that is not running has no liveness",
  liveness({ status: "rejudging", heartbeat_at: T0.toISOString() }, { now: at(400_000), window: 300_000 }).state === "dead"
  && liveness({ status: "review", heartbeat_at: T0.toISOString() }, { now: at(400_000), window: 300_000 }).state === "idle");
const shown = view(inState("running", { heartbeat_at: T0.toISOString() }), at(10 * 60_000));
check("the reader shows a dead stage as `dead`, in that word, while the stored state stays running",
  shown.stages.find((s) => s.stage === "sdd").shown === "dead" && shown.stages.find((s) => s.stage === "sdd").status === "running" && shown.stages.find((s) => s.stage === "sdd").silent_ms === 600_000 && shown.stages.length === 5 && shown.stages[0].stage === "intake");
check("the reader shows round n of cap and the ceiling beside every stage", shown.stages.every((s) => s.cap === 2 && s.ceiling === 3 && typeof s.round === "number"));

// ── the store: one file, validated on every write; setup refuses in order ──

await withRoot({}, async (tmp) => {
  const root = seedProject(tmp);
  const now = () => T0;
  const bare = refusal(() => createRun(root, { by: "Brad", now: T0 }));
  check("setup without a repository is refused no-project", bare?.code === "no-project" && bare instanceof Refused, bare?.message);
  mkdirSync(join(root, ".git"));
  check("…without a handoff, no-handoff", refusal(() => createRun(root, { by: "Brad", now: T0 }))?.code === "no-handoff");
  check("…without a name, no-author", refusal(() => createRun(root, { by: " ", now: T0 }))?.code === "no-author");

  // A team handoff — unsigned design — is not Delivery's.
  seedPrototype(root); seedStories(root); seedDesign(root);
  const go = (exit) => exportHandoff({ root, exit, by: "Brad", _exec: noExec, _fetch: noExec, _env: {}, _now: now });
  await go("team");
  const unsigned = refusal(() => createRun(root, { by: "Brad", now: T0 }));
  check("a handoff whose design is unsigned is refused design-unsigned — signed is the invariant, whatever exit the label says", unsigned?.code === "design-unsigned", unsigned?.message);
  await review({ root, _query: clean() });
  signoff(root, { by: "Ana Ruiz" });
  const v2 = await go("delivery");
  // An edited snapshot fails integrity before anything else about it is read.
  const tampered = JSON.parse(readFileSync(join(root, v2.file), "utf8"));
  tampered.items[0].hash = "0".repeat(64);
  writeFileSync(join(root, v2.file), JSON.stringify(tampered));
  const broken = refusal(() => createRun(root, { by: "Brad", now: T0 }));
  check("a handoff that does not verify is refused handoff-integrity, with the findings as detail", broken?.code === "handoff-integrity" && broken.detail.findings.length > 0, broken?.message);
  writeFileSync(join(root, v2.file), JSON.stringify(v2.handoff, null, 2) + "\n");
  check("bad rounds are refused before anything is written: a cap under one, a ceiling under the cap",
    refusal(() => createRun(root, { by: "Brad", cap: 0, now: T0 }))?.code === "bad-rounds" && refusal(() => createRun(root, { by: "Brad", cap: 3, ceiling: 2, now: T0 }))?.code === "bad-rounds");
  check("a model override for a role the config does not know is refused unknown-role", refusal(() => createRun(root, { by: "Brad", models: { "delivery.poet": "claude-opus-5" }, now: T0 }))?.code === "unknown-role");
  check("no refusal wrote a run", !existsSync(join(root, RUN_FILE)));

  const run = createRun(root, { by: "Brad", now: T0 });
  check("setup writes forge/run.json: pinned to handoff v2 by version, path and content hash; every stage pending at round 0; the §10.5 values; no flags",
    existsSync(join(root, RUN_FILE)) && run.handoff.version === 2 && run.handoff.path === v2.file && run.handoff.content_hash === v2.handoff.meta.content_hash && STAGES.every((s) => run.stages[s].status === "pending" && run.stages[s].round === 0) && run.cap === 2 && run.ceiling === 3 && run.liveness_ms === 300_000 && run.flags.length === 0 && run.by === "Brad" && run.id === "dock", JSON.stringify(run.handoff));
  check("the run validates against its schema, and the schema is wholly the runner's — no model writes a byte of it",
    validate("run", run).ok && Object.keys(contractOf(load("run")).properties).length === 0, validate("run", run).errors.join("; "));
  check("a second setup is refused run-exists — a new handoff is adopted, not run afresh", refusal(() => createRun(root, { by: "Brad", now: T0 }))?.code === "run-exists");
  check("readRun reads back what was written; a project with no run reads null", JSON.stringify(readRun(root)) === JSON.stringify(run) && readRun(tmp) === null);

  // Transitions through the store: read → guard → write, the file is the state.
  transition(root, { stage: "intake", event: "start", by: "wrapper", now: T0 });
  check("start through the store: the file says running with the heartbeat set", readRun(root).stages.intake.status === "running" && readRun(root).stages.intake.heartbeat_at === T0.toISOString());
  heartbeat(root, "intake", at(60_000));
  check("heartbeat moves heartbeat_at and nothing else", readRun(root).stages.intake.heartbeat_at === at(60_000).toISOString() && readRun(root).stages.intake.status === "running" && readRun(root).stages.intake.started_at === T0.toISOString());
  check("heartbeat on a stage that is not running is refused not-running", refusal(() => heartbeat(root, "sdd", at(60_000)))?.code === "not-running");
  check("a transition on a project with no run is refused no-run", refusal(() => transition(tmp, { stage: "intake", event: "start", by: "wrapper" }))?.code === "no-run");

  // finish files nothing itself — the wrapper filed the verdict; the store reads it back for the door.
  const verdictPath = join("forge", "delivery", "reviews", "intake-1.json");
  const artifact = stamp({ id: "brief", text: "one", "x-drift-checked": ["/text"] });
  mkdirSync(join(root, "forge", "delivery", "reviews"), { recursive: true });
  writeFileSync(join(root, "forge", "delivery", "brief.json"), JSON.stringify(artifact));
  const filed = { gate: "intake", verdict: "advise", findings: [{ severity: "low", confidence: "likely", rule: "r", subject: "brief", summary: "s", evidence: "e" }], deferred: [], checked: 1, skipped: 0, judged: [{ id: "brief", path: "forge/delivery/brief.json", content_hash: artifact.meta.content_hash }] };
  writeFileSync(join(root, verdictPath), JSON.stringify(filed));
  transition(root, { stage: "intake", event: "finish", by: "wrapper", verdict: verdictPath, now: at(120_000) });
  check("finish through the store takes the verdict's path, reads its verdict, and lands in review at round 1",
    readRun(root).stages.intake.status === "review" && readRun(root).stages.intake.verdict === verdictPath && readRun(root).stages.intake.round === 1);
  transition(root, { stage: "sdd", event: "start", by: "wrapper", now: at(125_000) });
  check("finish with a path that holds no verdict is refused no-verdict, and the stage stays running",
    refusal(() => transition(root, { stage: "sdd", event: "finish", by: "wrapper", verdict: "forge/nothing.json" }))?.code === "no-verdict" && readRun(root).stages.sdd.status === "running");
  // Approve reads freshness from the pins on disk — nothing is passed in.
  writeFileSync(join(root, "forge", "delivery", "brief.json"), JSON.stringify(stamp({ id: "brief", text: "two", "x-drift-checked": ["/text"] })));
  const staleDoor = refusal(() => transition(root, { stage: "intake", event: "approve", by: "runner", now: at(130_000) }));
  check("approve through the store checks the recorded verdict's pins against disk: the artifact moved, so verdict-stale", staleDoor?.code === "verdict-stale", staleDoor?.message);
  writeFileSync(join(root, "forge", "delivery", "brief.json"), JSON.stringify(artifact));
  const approved = transition(root, { stage: "intake", event: "approve", by: "runner", now: at(140_000) });
  check("…and passes once the pins match again; the file says approved", approved.run.stages.intake.status === "approved" && readRun(root).stages.intake.status === "approved" && approved.flags.length === 0);
  check("the store refuses a write that would not validate — a bad event never reaches the file", refusal(() => transition(root, { stage: "intake", event: "sing", by: "x" }))?.code === "no-event" && readRun(root).stages.intake.status === "approved");

  // Adopting a moved handoff: approved stages go stale, the rest hold; the pin moves.
  check("adopting the same handoff again is refused same-handoff", refusal(() => adoptHandoff(root, { by: "Brad", now: at(160_000) }))?.code === "same-handoff");
  const same = await go("delivery");
  check("a re-export that moved nothing is the same handoff by content hash — versions are not moves", same.handoff.version === 3 && refusal(() => adoptHandoff(root, { by: "Brad", now: at(165_000) }))?.code === "same-handoff");
  seedDesign(root, { ...DESIGN, notes: "Revised after the dock lead's walkthrough: the run sheet reads newest-first." });
  await review({ root, _query: clean() });
  signoff(root, { by: "Ana Ruiz" });
  const v3 = await go("delivery");
  const adopted = adoptHandoff(root, { by: "Brad", now: at(170_000) });
  check("adopting handoff v4 moves the pin, sends the approved stage stale with a flag naming the versions, and leaves the running one alone",
    adopted.run.handoff.version === 4 && adopted.run.handoff.content_hash === v3.handoff.meta.content_hash && adopted.moved.join() === "intake" && readRun(root).stages.intake.status === "stale" && readRun(root).stages.sdd.status === "running" && readRun(root).flags.at(-1).event === "moved" && /v2 → v4/.test(readRun(root).flags.at(-1).reason), JSON.stringify(adopted.moved));
  check("the view over the store reads the file, not memory: intake stale, sdd running and alive, three others pending",
    view(readRun(root), at(180_000)).stages.map((s) => s.shown).join() === "stale,running,pending,pending,pending");

  // Retention comes after the record: a finish is written before its round is kept, and a keep
  // that fails stops the stage on the record with the error as the reason — never a stage left
  // running with a verdict on disk, and never a review whose round was silently not kept.
  const sddVerdict = join("forge", "delivery", "reviews", "sdd-1.json");
  writeFileSync(join(root, sddVerdict), JSON.stringify({ ...filed, gate: "sdd" }));
  writeFileSync(join(root, ROUNDS, "sdd"), "a file where the stage's rounds directory goes\n");
  const unkept = refusal(() => transition(root, { stage: "sdd", event: "finish", by: "wrapper", verdict: sddVerdict, now: at(190_000) }));
  check("a retention failure is thrown, not swallowed", unkept !== null && /ENOTDIR|not a directory/i.test(unkept.message), unkept?.message);
  const after = readRun(root);
  check("…the finish was written before the keep was tried: the verdict path and the counted round are on the record",
    after.stages.sdd.verdict === sddVerdict && after.stages.sdd.round === 1 && after.stages.sdd.finished_at === at(190_000).toISOString(), JSON.stringify(after.stages.sdd));
  check("…and the stage is stopped by the store through the table, the retention error as the flagged reason",
    after.stages.sdd.status === "stopped" && after.flags.at(-1).event === "stop" && after.flags.at(-1).stage === "sdd" && after.flags.at(-1).by === "store" && /^retention: .*(ENOTDIR|not a directory)/i.test(after.flags.at(-1).reason) && after.flags.at(-1).override === false,
    JSON.stringify(after.flags.at(-1)));
  check("the stopped record validates — a stop the store takes is a stop the schema admits", validate("run", after).ok, validate("run", after).errors.join("; "));
  const restarted = refusal(() => transition(root, { stage: "sdd", event: "start", by: "wrapper", now: at(200_000) }));
  check("start from the stopped stage opens a new episode at round 0, the same as any stop", restarted === null && readRun(root).stages.sdd.status === "running" && readRun(root).stages.sdd.round === 0, restarted?.message);
});

done();
