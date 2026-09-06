#!/usr/bin/env node
// owns: R5 · shared — eval: rejudge. The freshness arithmetic: a verdict is about the
// hashes it pinned; fresh when every pin matches the artifact on disk, stale naming the
// artifact when one does not, unknown when nothing was pinned. And the path it drives in
// the state machine: a moved handoff sends an approved stage stale → rejudging → back to
// approved on a clean re-judge or to review on a block — a re-judge, never a regeneration,
// and never a round. Then the same, end to end on a cold root: Discovery moves, the new
// snapshot is adopted, the loop re-judges the standing binding — no writer called — and
// clears it, or blocks it and only then regenerates.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { suite, withRoot, scripted } from "./_harness.mjs";
import { pin, verdictFreshness } from "../shared/judge/index.mjs";
import { stamp } from "../shared/hash.mjs";
import { apply, DEFAULTS, readRun, adoptHandoff, LEDGER } from "../delivery/state/index.mjs";
import { rows } from "../shared/agent-call/index.mjs";
import { advance } from "../delivery/run/index.mjs";
import { loadSdd, VERDICT_FILE as SDD_VERDICT } from "../delivery/sdd/index.mjs";
import { readDoc } from "../shared/store.mjs";
import { seedDelivery, seedStories, reexport, BINDING, STORIES } from "./_fixture.mjs";
import { answer } from "../discovery/doors/index.mjs";

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

// ── R5 end to end: the handoff moves under an approved Delivery; re-judge, never regenerate ──
await withRoot({}, async (tmp) => {
  const refusal = (fn) => Promise.resolve().then(fn).then(() => null, (e) => e);
  const CLEAN = (item) => ({ findings: [], deferred: [{ subject: item, summary: `${item}: nothing here tests the signal dropping mid-write.`, beyond: "untested" }], checked: 1, skipped: 0 });
  const judges = () => scripted({ structuredSeq: [CLEAN("STORY-1"), CLEAN("STORY-2"), CLEAN("REQ-4")] });
  let t = Date.parse("2026-09-06T11:00:00Z");
  const clock = () => new Date((t += 1000));
  const { disc, cold } = await seedDelivery(tmp, { slug: "loaf" });

  const first = scripted({ structuredSeq: [BINDING, CLEAN("STORY-1"), CLEAN("STORY-2"), CLEAN("REQ-4")] });
  const built = await advance(cold, { _query: first.query, _now: clock });
  const sdd1 = readDoc(cold, SDD_VERDICT);
  check("Delivery stands approved through sdd on handoff v1: one writer call, three judges, the verdict pinned to v1",
    built.stages.map((r) => `${r.stage}:${r.status}`).join() === "intake:approved,sdd:approved" && first.calls.length === 4 && sdd1.judged[0].id === "handoff-v1" && loadSdd(cold).traces.handoff.version === 1, JSON.stringify(built.halted));
  check("adopting the snapshot the run already pins is refused — nothing moved", (await refusal(() => adoptHandoff(cold, { version: 1, by: "Brad", now: clock() })))?.code === "same-handoff");

  // Discovery rewords a story. v2 is adopted; both stages go stale; the re-judge clears.
  const reworded = structuredClone(STORIES);
  reworded[1].statement = reworded[1].statement.replace(/so that .*$/, "so that I can plan the dock before the first truck.");
  seedStories(disc, { stories: reworded });
  const v2 = await reexport(disc, cold, { now: clock() });
  const adopted = adoptHandoff(cold, { version: 2, by: "Brad", now: clock() });
  check("v2 moved STORY-2; adopting it moves the pin and sends every approved stage stale with its rounds returned to zero — a flag per stage naming the move",
    v2.version === 2 && v2.stories.stories[1].statement !== STORIES[1].statement && adopted.moved.join() === "intake,sdd" && ["intake", "sdd"].every((st) => adopted.run.stages[st].status === "stale" && adopted.run.stages[st].round === 0) && adopted.run.flags.filter((f) => f.event === "moved").map((f) => f.reason).join() === "handoff v1 → v2,handoff v1 → v2", JSON.stringify(adopted.run.flags));
  check("the standing sdd verdict is still fresh by its pins — v1 is untouched on disk; what moved is the run's pin, and that is the table's `moved`, not the arithmetic's",
    verdictFreshness(sdd1, { root: cold }).fresh === true && readRun(cold).handoff.version === 2 && sdd1.judged[0].id === "handoff-v1");

  const re = judges();
  const events = [];
  const rejudged = await advance(cold, { _query: re.query, _now: clock, onEvent: (e) => events.push(e) });
  const sdd2 = readDoc(cold, SDD_VERDICT);
  check("R5: stale re-judges — intake recompiles, the standing binding is judged again against v2 by three judges and no writer; both clear back to approved at round 0",
    rejudged.stages.map((r) => `${r.stage}:${r.status}:${r.round}`).join() === "intake:approved:0,sdd:approved:0" && re.calls.length === 3 && rows(join(cold, LEDGER)).filter((r) => r.stage === "sdd").map((r) => r.role).join() === "writer,judge,judge,judge,judge,judge,judge", `${JSON.stringify(rejudged.stages.map((r) => [r.stage, r.status, r.round]))} · calls ${re.calls.length}`);
  check("the binding was not regenerated — the same document, still traced to v1 — and the new verdict pins v2 and the recompiled intake record",
    loadSdd(cold).traces.handoff.version === 1 && loadSdd(cold).meta.content_hash === sdd1.judged[2].content_hash && sdd2.judged[0].id === "handoff-v2" && sdd2.judged[1].content_hash !== sdd1.judged[1].content_hash && sdd2.judged[2].content_hash === sdd1.judged[2].content_hash, JSON.stringify(sdd2.judged));
  check("the re-judge's judge saw the reworded story", /plan the dock before the first truck/.test(re.calls[1].prompt), re.calls[1].prompt.slice(0, 200));
  check("the wrapper said what happened: cleared, twice", events.filter((e) => /re-judged: clear/.test(e)).join() === "intake re-judged: clear,sdd re-judged: clear", events.join(" | "));

  // The PM rules on OQ-2: REQ-2 gains a criterion, STORY-2 a scenario proving it. v3 is adopted; the standing binding tests nothing for the new criterion — the re-judge blocks on the arithmetic without a model, and the block is now the loop's: under the cap it regenerates in the same episode.
  answer({ root: disc, req: "REQ-2", oq: "OQ-2", answer: "The receiving lead names the vendor from the manifest.", criterion: "A delivery with no paperwork shows the vendor named from the manifest.", by: "Brad" });
  const proving = structuredClone(reworded);
  proving[1].scenarios.push({ name: "Vendor named from the manifest", gherkin: "Given a delivery with no paperwork\nWhen the receiving lead opens its row\nThen the vendor is shown as named on the manifest", proves: ["REQ-2/AC-2"] });
  seedStories(disc, { stories: proving });
  const v3 = await reexport(disc, cold, { now: clock() });
  adoptHandoff(cold, { version: 3, by: "Brad", now: clock() });
  const rebound = structuredClone(BINDING);
  rebound.items[1].tests.push({ id: "T-5", proves: ["REQ-2/AC-2"], scenario: "STORY-2/2", level: "browser", exercises: "seed a delivery with no paperwork and a manifest naming Harvest Foods; open SCREEN-2", asserts: "its delivery-row shows Harvest Foods" });
  const writer = scripted({ structuredSeq: [rebound, CLEAN("STORY-1"), CLEAN("STORY-2"), CLEAN("REQ-4")] });
  const before = rows(join(cold, LEDGER)).length;
  const moved = await advance(cold, { _query: writer.query, _now: clock, onEvent: (e) => events.push(e) });
  const sdd3 = readDoc(cold, SDD_VERDICT);
  check("v3 carries RUL-1 and REQ-2/AC-2: intake clears; sdd's re-judge blocks on the arithmetic — criterion untested, no model asked — lands in review at round 0, and the loop regenerates from there: one writer, three judges, approved at round 1",
    v3.contract.rulings.length === 1 && events.filter((e) => /re-judged|round/.test(e)).slice(-4).join(" | ") === "intake re-judged: clear | sdd re-judged: reblock | sdd block · round 0 of 2 — regenerating | sdd pass · round 1 — approved" && moved.stages.map((r) => `${r.stage}:${r.status}:${r.round}`).join() === "intake:approved:0,sdd:approved:1" && moved.halted?.why === "stage-unauthored" && writer.calls.length === 4 && rows(join(cold, LEDGER)).slice(before).map((r) => r.role).join() === "writer,judge,judge,judge", `${events.slice(-8).join(" | ")} · ${JSON.stringify(moved.stages.map((r) => [r.stage, r.status, r.round]))}`);
  check("the writer answered the arithmetic's finding — criterion-untested on REQ-2/AC-2, quoted — and the binding is now traced to v3 with the new test",
    /## The judge's findings on the previous binding/.test(writer.calls[0].prompt) && /criterion-untested/.test(writer.calls[0].prompt) && /REQ-2\/AC-2/.test(writer.calls[0].prompt) && loadSdd(cold).traces.handoff.version === 3 && loadSdd(cold).items[1].tests.length === 2 && sdd3.verdict === "pass" && sdd3.judged[0].id === "handoff-v3", writer.calls[0].prompt.slice(-500));
  check("R3: the ruling rode into the writer's and the judges' mechanics, and the new scenario into the work item",
    /RUL-1/.test(writer.calls[0].options.systemPrompt) && /names the vendor from the manifest/.test(writer.calls[0].options.systemPrompt) && /RUL-1/.test(writer.calls[2].options.systemPrompt) && /STORY-2\/2/.test(writer.calls[2].prompt), writer.calls[2].prompt.slice(0, 300));
  check("the record of the whole: two moves flagged per stage, no override anywhere, the run pinned at v3",
    readRun(cold).handoff.version === 3 && readRun(cold).flags.filter((f) => f.event === "moved").length === 4 && !readRun(cold).flags.some((f) => f.override), JSON.stringify(readRun(cold).flags.map((f) => `${f.stage}:${f.event}`)));
});

done();
