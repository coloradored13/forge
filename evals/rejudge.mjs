#!/usr/bin/env node
// owns: R5 · shared — eval: rejudge. The freshness arithmetic: a verdict is about the
// hashes it pinned; fresh when every pin matches the artifact on disk, stale naming the
// artifact when one does not, unknown when nothing was pinned. And the path it drives in
// the state machine: a moved handoff sends an approved stage stale → rejudging → back to
// approved on a clean re-judge or to review on a block — a re-judge, never a regeneration,
// and never a round.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { suite, withRoot } from "./_harness.mjs";
import { pin, verdictFreshness } from "../shared/judge/index.mjs";
import { stamp } from "../shared/hash.mjs";
import { apply, DEFAULTS } from "../delivery/state/index.mjs";

const { check, done } = suite("rejudge · verdict freshness");

const story = (id, statement) => stamp({ id, statement, "x-drift-checked": ["/statement"] });

withRoot({}, (root) => {
  const a = story("STORY-1", "As a baker, I want the run sheet…");
  const b = story("STORY-2", "As a baker, I want to mark a bake done…");
  writeFileSync(join(root, "STORY-1.json"), JSON.stringify(a));
  writeFileSync(join(root, "STORY-2.json"), JSON.stringify(b));
  const verdict = { gate: "story-reviewer", verdict: "pass", findings: [], deferred: [], checked: 2, skipped: 0,
    judged: [pin({ id: "STORY-1", path: "STORY-1.json", doc: a }), pin({ id: "STORY-2", path: "STORY-2.json", doc: b })] };

  check("every pin matches → fresh", verdictFreshness(verdict, { root }).fresh === true);

  b.statement = "As a baker, I want to mark a bake done and note the reason…";
  stamp(b);
  writeFileSync(join(root, "STORY-2.json"), JSON.stringify(b));
  const f = verdictFreshness(verdict, { root });
  check("an artifact re-stamped since judging → stale, naming it with both hashes",
    f.fresh === false && f.stale.length === 1 && f.stale[0].id === "STORY-2" && f.stale[0].judged === verdict.judged[1].content_hash && f.stale[0].current === b.meta.content_hash,
    JSON.stringify(f));

  writeFileSync(join(root, "STORY-1.json"), JSON.stringify({ id: "STORY-1", statement: "edited by hand, never re-stamped", meta: a.meta, "x-drift-checked": ["/statement"] }));
  check("a hand edit that kept the old hash still reads as the pinned version — freshness is a hash comparison, integrity is hash.verify's job",
    verdictFreshness(verdict, { root }).stale.map((s) => s.id).join() === "STORY-2");

  writeFileSync(join(root, "STORY-2.json"), "");
  const g = verdictFreshness(verdict, { root });
  check("a missing or unreadable artifact is not the one the judge saw", g.fresh === false && g.stale[0].current === null);

  check("no pins → unknown, not fresh: presence is never evidence", verdictFreshness({ ...verdict, judged: [] }, { root }).fresh === null && verdictFreshness({ gate: "g" }, { root }).fresh === null);

  let err = null;
  try { pin({ id: "X", path: "x.json", doc: { id: "X" } }); } catch (e) { err = e; }
  check("an unstamped artifact cannot be pinned", /no meta\.content_hash/.test(err?.message ?? ""));
});

// ── R5 in the machine: staleness triggers a re-judge, not a regeneration ──
{
  const refusal = (fn) => { try { fn(); return null; } catch (e) { return e; } };
  const stages = Object.fromEntries(["intake", "sdd", "build", "qa", "release"].map((s) => [s, { status: "pending", round: 0, started_at: null, heartbeat_at: null, finished_at: null, verdict: null }]));
  let run = { id: "p", handoff: { version: 1, path: "h", content_hash: "x" }, created_at: "2026-09-05T12:00:00.000Z", by: "Brad", ...DEFAULTS, budget: null, models: {}, stages: { ...stages, sdd: { ...stages.sdd, status: "approved", round: 2, verdict: "forge/delivery/reviews/sdd-2.json" } }, flags: [] };
  const go = (event, ctx = {}) => { run = apply(run, { stage: "sdd", event, by: "wrapper", fresh: true, ...ctx }).run; return run.stages.sdd; };
  check("a moved handoff sends an approved stage stale, and the episode's rounds are spent — round 0", go("moved", { by: "runner", reason: "handoff v1 → v2" }).status === "stale" && run.stages.sdd.round === 0);
  check("stale does not regenerate: start and regenerate are not transitions from it", refusal(() => go("start"))?.code === "no-transition" && refusal(() => go("regenerate"))?.code === "no-transition");
  check("stale re-judges: rejudging, with the wrapper's heartbeat", go("rejudge").status === "rejudging" && run.stages.sdd.heartbeat_at !== null);
  check("a clean re-judge clears back to approved with the new verdict pinned and no round spent",
    go("clear", { verdict: { verdict: "pass", path: "forge/delivery/reviews/sdd-3.json" } }).status === "approved" && run.stages.sdd.round === 0 && run.stages.sdd.verdict === "forge/delivery/reviews/sdd-3.json");
  go("moved", { by: "runner", reason: "handoff v2 → v3" }); go("rejudge");
  check("a re-judge that blocks lands in review — the block is now the loop's, round still 0, so the cap counts from here",
    go("reblock", { verdict: { verdict: "block", path: "forge/delivery/reviews/sdd-4.json" } }).status === "review" && run.stages.sdd.round === 0 && go("regenerate", { by: "runner", verdict: { verdict: "block", path: "forge/delivery/reviews/sdd-4.json" } }).status === "running");
}

done();
