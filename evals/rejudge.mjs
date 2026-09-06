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
import { join as pathJoin } from "node:path";
import { join } from "node:path";
import { suite, withRoot, scripted } from "./_harness.mjs";
import { pin, verdictFreshness } from "../shared/judge/index.mjs";
import { stamp } from "../shared/hash.mjs";
import { apply, DEFAULTS, readRun, adoptHandoff, rounds, transition, LEDGER } from "../delivery/state/index.mjs";
import { rows } from "../shared/agent-call/index.mjs";
import { advance, runStage } from "../delivery/run/index.mjs";
import { loadSdd, VERDICT_FILE as SDD_VERDICT, SDD_FILE } from "../delivery/sdd/index.mjs";
import { rejudge as buildRejudge, checkCurrency, loadBuild, VERDICT_FILE as BUILD_VERDICT, BRANCH } from "../delivery/build/index.mjs";
import { readDoc, saveDoc } from "../shared/store.mjs";
import { seedDelivery, seedStories, reexport, BINDING, STORIES, seedBuild, builder, roundCtx, put, gitIn, BUILT } from "./_fixture.mjs";
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
  // A re-judge files a verdict too, and overwrites the last one on the same path — so it is kept the same way,
  // at round 0 (R5: not a round), beside the binding it judged again (R8).
  const kept = rounds(cold, "sdd");
  check("R8: the first round's verdict and the re-judge's are both on the record — finish at round 1, clear at round 0 — each pinning the same binding, judged against v1 and then v2",
    kept.map((k) => `${k.seq}:${k.round}:${k.event}:${k.verdict.verdict}`).join() === "1:1:finish:pass,2:0:clear:pass" && kept[0].verdict.judged[0].id === "handoff-v1" && kept[1].verdict.judged[0].id === "handoff-v2" && kept[1].kept.some((k) => k.path === "forge/delivery/sdd.json" && k.content_hash === sdd1.judged[2].content_hash), JSON.stringify(kept.map((k) => [k.seq, k.round, k.event, k.verdict?.verdict])));

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
    v3.contract.rulings.length === 1 && events.filter((e) => /re-judged|round/.test(e)).slice(-4).join(" | ") === "intake re-judged: clear | sdd re-judged: reblock | sdd block · round 0 of 2 — regenerating | sdd pass · round 1 — approved" && moved.stages.map((r) => `${r.stage}:${r.status}:${r.round}`).join() === "intake:approved:0,sdd:approved:1" && moved.halted?.why === "no-repo" && moved.halted.stage === "build" && writer.calls.length === 4 && rows(join(cold, LEDGER)).slice(before).map((r) => r.role).join() === "writer,judge,judge,judge", `${events.slice(-8).join(" | ")} · ${JSON.stringify(moved.stages.map((r) => [r.stage, r.status, r.round]))}`);
  check("the writer answered the arithmetic's finding — criterion-untested on REQ-2/AC-2, quoted — and the binding is now traced to v3 with the new test",
    /## The judge's findings on the previous binding/.test(writer.calls[0].prompt) && /criterion-untested/.test(writer.calls[0].prompt) && /REQ-2\/AC-2/.test(writer.calls[0].prompt) && loadSdd(cold).traces.handoff.version === 3 && loadSdd(cold).items[1].tests.length === 2 && sdd3.verdict === "pass" && sdd3.judged[0].id === "handoff-v3", writer.calls[0].prompt.slice(-500));
  check("the writer was told what the move touched: STORY-2 to revise — the untested criterion names it and its work item changed, read against the intake kept with the round that bound the standing binding — STORY-1 and REQ-4 to carry verbatim",
    /### STORY-2 — revise: REQ-2\/AC-2 \(criterion-untested\), its work item changed/.test(writer.calls[0].prompt) && /### STORY-1 — carry verbatim/.test(writer.calls[0].prompt) && /### REQ-4 — carry verbatim/.test(writer.calls[0].prompt) && !/Every item is to revise/.test(writer.calls[0].prompt), writer.calls[0].prompt.slice(writer.calls[0].prompt.indexOf("## The previous binding"), writer.calls[0].prompt.indexOf("## The previous binding") + 300));
  check("R3: the ruling rode into the writer's and the judges' mechanics, and the new scenario into the work item",
    /RUL-1/.test(writer.calls[0].options.systemPrompt) && /names the vendor from the manifest/.test(writer.calls[0].options.systemPrompt) && /RUL-1/.test(writer.calls[2].options.systemPrompt) && /STORY-2\/2/.test(writer.calls[2].prompt), writer.calls[2].prompt.slice(0, 300));
  check("the record of the whole: two moves flagged per stage, no override anywhere, the run pinned at v3",
    readRun(cold).handoff.version === 3 && readRun(cold).flags.filter((f) => f.event === "moved").length === 4 && !readRun(cold).flags.some((f) => f.override), JSON.stringify(readRun(cold).flags.map((f) => `${f.stage}:${f.event}`)));

  // The PM rules on OQ-1: REQ-1 gains AC-3. v4 is adopted; the re-judge blocks on the arithmetic and the writer, regenerating, asks a blocking question instead of guessing — twice — so the stage blocks at the cap with no judge called. The writer cannot answer it; the door is the human's.
  answer({ root: disc, req: "REQ-1", oq: "OQ-1", answer: "Yes — until the shift closes.", criterion: "An exception can be recorded against a delivery until the shift closes.", by: "Brad" });
  const late = structuredClone(proving);
  late[0].scenarios.push({ name: "Recorded after the truck left", gherkin: "Given a delivery whose truck has left\nWhen the dock lead records an exception against it before the shift closes\nThen the exception is recorded", proves: ["REQ-1/AC-3"] });
  seedStories(disc, { stories: late });
  const v4 = await reexport(disc, cold, { now: clock() });
  adoptHandoff(cold, { version: 4, by: "Brad", now: clock() });
  const asking = structuredClone(rebound);
  asking.items[0].tests.push({ id: "T-6", proves: ["REQ-1/AC-3"], scenario: "STORY-1/3", level: "browser", exercises: "seed a delivery marked departed; on SCREEN-1 record Short ×1 against it before the shift closes", asserts: "the recorded state shows the delivery and Short ×1" });
  asking.questions.push({ subject: "STORY-1", question: "When does a shift close — at a fixed time, or when the lead closes it? REQ-1/AC-3 reads both ways and T-6 seeds a different clock for each.", blocking: true });
  const asker = scripted({ structuredSeq: [asking, asking] });
  const before4 = rows(join(cold, LEDGER)).length;
  const stuck = await advance(cold, { _query: asker.query, _now: clock, onEvent: (e) => events.push(e) });
  const sdd4 = readDoc(cold, SDD_VERDICT);
  check("v4 carries RUL-2 and REQ-1/AC-3: sdd's re-judge blocks on the arithmetic; the writer regenerates and asks a blocking question rather than guess; the question blocks without a judge, twice, and the stage is blocked at the cap — two writer calls, no judge",
    v4.contract.rulings.length === 2 && stuck.halted?.stage === "sdd" && stuck.halted.why === "blocked" && readRun(cold).stages.sdd.round === 2 && asker.calls.length === 2 && rows(join(cold, LEDGER)).slice(before4).map((r) => r.role).join() === "writer,writer" && sdd4.verdict === "block" && sdd4.findings.map((f) => f.rule).join() === "question" && sdd4.cost?.model === "none" && /A blocking question on the binding/.test(asker.calls[1].prompt), `${events.slice(-5).join(" | ")} · ${JSON.stringify(sdd4.findings?.map((f) => f.rule))}`);
  check("blocked is not a stage the loop runs — the run refuses with the doors named",
    (await refusal(() => advance(cold, { _query: asker.query, _now: clock }))) === null && (await refusal(() => runStage(cold, { stage: "sdd", _query: asker.query, _now: clock })))?.code === "stage-blocked");

  // The PM answers the binding's question in Discovery — a ruling, on the PRD, becoming REQ-1/AC-4. v5 is adopted: the blocked stage goes stale with the rest, because the verdict it holds was judged against a contract that has moved. The re-judge reblocks on the standing binding (the question is still on it), and with the round returned to zero the loop regenerates with the whole cap ahead of it — no escalate, no override, the human's word spent where it belongs.
  answer({ root: disc, req: "REQ-1", question: "When does a shift close — at a fixed time, or when the lead closes it?", answer: "When the dock lead closes it.", criterion: "A shift closes when the dock lead closes it; nothing closes it on a clock.", by: "Brad" });
  const closing = structuredClone(late);
  closing[0].scenarios.push({ name: "The lead closes the shift", gherkin: "Given an open shift\nWhen the dock lead closes it\nThen no exception can be recorded against its deliveries", proves: ["REQ-1/AC-4"] });
  seedStories(disc, { stories: closing });
  const v5 = await reexport(disc, cold, { now: clock() });
  const adopted5 = adoptHandoff(cold, { version: 5, by: "Brad", now: clock() });
  check("adopting v5 moves the blocked stage too: intake and sdd both stale at round 0, a flag per stage naming v4 → v5 — a block against a moved contract is re-judged, not escalated",
    v5.contract.rulings.length === 3 && adopted5.moved.join() === "intake,sdd" && ["intake", "sdd"].every((st) => adopted5.run.stages[st].status === "stale" && adopted5.run.stages[st].round === 0) && adopted5.run.flags.filter((f) => f.event === "moved" && /v4 → v5/.test(f.reason)).length === 2, JSON.stringify(adopted5.run.stages.sdd));
  const settled = structuredClone(asking);
  settled.questions = [];
  settled.items[0].tests.push({ id: "T-7", proves: ["REQ-1/AC-4"], scenario: "STORY-1/4", level: "browser", exercises: "open a shift, close it as the dock lead, open SCREEN-1 for one of its deliveries", asserts: "record-exception is not offered; the closed state" });
  const settler = scripted({ structuredSeq: [settled, CLEAN("STORY-1"), CLEAN("STORY-2"), CLEAN("REQ-4")] });
  const before5 = rows(join(cold, LEDGER)).length;
  const answered = await advance(cold, { _query: settler.query, _now: clock, onEvent: (e) => events.push(e) });
  const sdd5 = readDoc(cold, SDD_VERDICT);
  check("v5 carries the answer: intake clears; sdd's re-judge reblocks on the standing binding — the question is still on it — lands in review at round 0 and regenerates: the writer binds the answer, three judges pass it, approved at round 1",
    events.filter((e) => /re-judged|round/.test(e)).slice(-4).join(" | ") === "intake re-judged: clear | sdd re-judged: reblock | sdd block · round 0 of 2 — regenerating | sdd pass · round 1 — approved" && answered.stages.map((r) => `${r.stage}:${r.status}:${r.round}`).join() === "intake:approved:0,sdd:approved:1" && answered.halted?.why === "no-repo" && settler.calls.length === 4 && rows(join(cold, LEDGER)).slice(before5).map((r) => r.role).join() === "writer,judge,judge,judge" && sdd5.verdict === "pass" && sdd5.judged[0].id === "handoff-v5" && loadSdd(cold).questions.length === 0 && loadSdd(cold).items[0].tests.map((t) => t.id).join() === "T-1,T-2,T-6,T-7", `${events.slice(-6).join(" | ")} · ${JSON.stringify(answered.stages.map((r) => [r.stage, r.status, r.round]))}`);
  check("the writer saw the question it had asked, as the finding that blocked, and the ruling that answers it rode in the mechanics",
    /question/.test(settler.calls[0].prompt) && /When does a shift close/.test(settler.calls[0].prompt) && /RUL-3/.test(settler.calls[0].options.systemPrompt) && /When the dock lead closes it/.test(settler.calls[0].options.systemPrompt), settler.calls[0].options.systemPrompt.slice(-600));
  check("the record of the whole: four moves per stage, no override and no escalate anywhere — every door the human opened was a ruling on the PRD",
    readRun(cold).handoff.version === 5 && readRun(cold).flags.filter((f) => f.event === "moved").length === 8 && !readRun(cold).flags.some((f) => f.override || f.event === "escalate"), JSON.stringify(readRun(cold).flags.map((f) => `${f.stage}:${f.event}`)));
});

// ── R5 in build: a re-judge is manifest currency — the standing build held to the binding as it now stands, never a rebuild; a block rebuilds only what moved ──
await withRoot({}, async (tmp) => {
  const { cold } = await seedBuild(tmp, { slug: "moor", files: { "README.md": "# Moor\n" } });
  const b = builder([BUILT(), BUILT("Run sheet built."), BUILT("Queue built.")], { 0: (cwd) => put(cwd, "src/exceptions/store.js", "a"), 1: (cwd) => put(cwd, "src/deliveries/store.js", "b"), 2: (cwd) => put(cwd, "src/queue/q.js", "c") });
  const built = await runStage(cold, { stage: "build", _query: b.query });
  const standing = loadBuild(cold);
  check("the build approves in one round, three calls", built.status === "approved" && built.round === 1 && b.calls.length === 3);

  // The arithmetic alone: the binding as it stands against the build as it stands.
  const sdd = readDoc(cold, SDD_FILE);
  check("nothing moved: currency finds nothing", checkCurrency(sdd, standing).length === 0);
  const moved = structuredClone(sdd); moved.items[1].approach += " Rows are keyed by delivery id.";
  check("an item whose bound fields changed is binding-moved — that item, high and certain, the hashes in the evidence — and no other",
    checkCurrency(moved, standing).map((f) => `${f.rule}@${f.subject}:${f.severity}/${f.confidence}`).join() === "binding-moved@STORY-2:high/certain" && /^built from [0-9a-f]{64}; the binding now hashes [0-9a-f]{64}$/.test(checkCurrency(moved, standing)[0].evidence), JSON.stringify(checkCurrency(moved, standing)));
  const risk = structuredClone(sdd); risk.items[0].risks.push("a fourth reason");
  check("risks are bound too — the builder read them", checkCurrency(risk, standing).map((f) => f.subject).join() === "STORY-1");
  const grown = structuredClone(sdd); grown.items.push({ ...sdd.items[2], work_item: "REQ-9" });
  check("an item the binding has that the build does not is unbuilt; one the build has that the binding dropped is not a finding — nothing to hold it to",
    checkCurrency(grown, standing).map((f) => `${f.rule}@${f.subject}`).join() === "unbuilt@REQ-9" && checkCurrency({ ...sdd, items: sdd.items.slice(0, 2) }, standing).length === 0);

  // Through the door: the binding moves on disk, the stage goes stale, the loop re-judges — no builder called — blocks, and regenerates exactly the moved item.
  saveDoc(cold, SDD_FILE, "sdd", moved);
  transition(cold, { stage: "build", event: "moved", by: "Brad", reason: "the run-sheet binding moved" });
  const events = [];
  const again = builder([BUILT("Run sheet rebuilt.")], { 0: (cwd) => put(cwd, "src/deliveries/store.js", "b2") });
  const r2 = await runStage(cold, { stage: "build", _query: again.query, onEvent: (e) => events.push(e) });
  const after = loadBuild(cold);
  check("stale → re-judge: reblock on binding-moved with no call; then the round rebuilds STORY-2 alone — one builder call — and keeps STORY-1 and REQ-4 at their commits for $0; approved",
    events.filter((e) => /re-judged|round|reused|building/.test(e)).join(" | ") === `build re-judged: reblock | build block · round 0 of 2 — regenerating | build STORY-1 reused — binding unchanged, ${standing.items[0].commit.slice(0, 7)} stands | build STORY-2 building from ${standing.items[2].commit.slice(0, 7)} | build REQ-4 reused — binding unchanged, ${standing.items[2].commit.slice(0, 7)} stands | build pass · round 1 — approved` && r2.status === "approved" && again.calls.length === 1 && after.items.map((i) => `${i.work_item}:${i.reused ? 1 : 0}`).join() === "STORY-1:1,STORY-2:0,REQ-4:1" && after.items[0].commit === standing.items[0].commit && after.items[2].commit === standing.items[2].commit && after.items[1].commit !== standing.items[1].commit && after.items[1].binding_hash !== standing.items[1].binding_hash, events.join(" | "));
  check("the rebuild's prompt carried the finding it was bought to answer; the record traces the binding as it now stands; the branch grew by one commit",
    /binding-moved/.test(again.calls[0].prompt) && after.traces.sdd.content_hash === readDoc(cold, SDD_FILE).meta.content_hash && gitIn(cold, ["log", "--format=%s", BRANCH]).split("\n").length === 5 && gitIn(cold, ["log", "--format=%s", "-1", BRANCH]) === "STORY-2: Run sheet rebuilt.", gitIn(cold, ["log", "--format=%s", BRANCH]));
  const clear = await buildRejudge(cold, roundCtx(cold));
  check("re-judged again with nothing moved: clear — a pass with no findings, the same four pins", clear.verdict.verdict === "pass" && clear.verdict.findings.length === 0 && clear.verdict.judged.length === 4 && readDoc(cold, BUILD_VERDICT).verdict === "pass");
});

done();
