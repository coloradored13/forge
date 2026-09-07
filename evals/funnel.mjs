#!/usr/bin/env node
// owns: R8, R13 · shared — eval: funnel. The two Discovery runners after the line: the
// prototype (one builder, one file, the line's arithmetic) and the stories (one composer
// with no write surface, the line's arithmetic, one reviewer at the PM's bar whose fresh
// verdict rides into the next rewrite — R13), and the meter every signal lands in
// (R8). Both directions: every arithmetic rule fires on its seeded defect and nothing
// fires on the clean record; the runners refuse what is not theirs to accept; a verdict
// rides in while its pins hold and is nothing once they do not. R13's other end is here
// too: intake's question budget, counted per story from the snapshot and never trimmed —
// a story over it is a Discovery gate-miss the meter records. No model is reached.

import { join } from "node:path";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { suite, withRoot, scripted } from "./_harness.mjs";
import { seedProject, seedPrototype, seedStories, writeHtml, SCREENS, EPICS, STORIES } from "./_fixture.mjs";
import { outputContract, validate } from "../shared/schema/index.mjs";
import { verify } from "../shared/hash.mjs";
import { record, rows, meter, funnelPath, SIGNALS } from "../shared/funnel.mjs";
import { loadPrd, savePrd } from "../discovery/workshop/index.mjs";
import { ledgerPath } from "../discovery/setup/index.mjs";
import { rows as calls } from "../shared/agent-call/ledger.mjs";
import { Refused, readDoc, readVerdict, freshVerdict, staleness, PROTOTYPE_FILE, STORIES_FILE, HTML_FILE, REVIEWS } from "../discovery/record/index.mjs";
import { answer } from "../discovery/doors/index.mjs";
import { generate, checkPrototype, GATE as PROTO_GATE, ARITHMETIC as PROTO_RULES } from "../discovery/prototype/index.mjs";
import { write, review, checkStories, gherkinShape, GATE as STORY_GATE, REVIEW_GATE, ARITHMETIC as STORY_RULES } from "../discovery/stories/index.mjs";
import { ask, slice, QUESTION_BUDGET } from "../delivery/intake/index.mjs";

const { check, done } = suite("funnel · R8 the meter, R13 stories at the PM's bar", 70);

const refusal = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const clone = (v) => structuredClone(v);
const fired = (verdict) => verdict.findings.map((f) => `${f.rule}@${f.subject}`);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const f = (subject, severity = "high", confidence = "certain", extra = {}) => ({ severity, confidence, rule: "then-not-observable", subject, summary: `about ${subject}`, evidence: "e", remedy: "r", ...extra });

// ── the prototype's arithmetic, both directions ──
await withRoot({}, (parent) => {
  const root = seedProject(parent);
  const proto = seedPrototype(root);
  const prd = loadPrd(root);
  const clean = checkPrototype(prd, proto);
  check("clean: two screens on the shipped surface, the non-functional requirement listed as uncovered — pass, nothing fired", clean.verdict === "pass" && clean.findings.length === 0 && clean.gate === PROTO_GATE, JSON.stringify(clean.findings));
  check("checked counts the screens, the surfaces inside the line and the functional requirements inside it — REQ-4 is not a screen's to show", clean.checked === 2 + 1 + 2 && clean.skipped === 0 && clean.deferred.length === 0, String(clean.checked));
  const quiet = checkPrototype(prd, { ...clone(proto), uncovered: [] });
  check("a non-functional requirement on no screen and not listed as uncovered is not a defect — nothing forces a screen to house it", quiet.verdict === "pass" && quiet.findings.length === 0, fired(quiet).join(" "));

  const seen = new Set();
  const defect = (label, mutate, expect) => {
    const p = clone(proto);
    mutate(p);
    const v = checkPrototype(prd, p);
    for (const x of v.findings) seen.add(x.rule);
    check(`prototype defect: ${label}`, v.verdict === "block" && expect.every((e) => fired(v).includes(e)) && v.findings.every((x) => x.severity === "high" && x.confidence === "certain"), fired(v).join(" "));
  };
  defect("a screen on a surface the PRD does not ship", (p) => { p.screens[0].surface_ref = "SURF-9"; }, ["screen-surface-unknown@SCREEN-1"]);
  defect("a screen on a surface past the line", (p) => { p.screens[0].surface_ref = "SURF-2"; }, ["screen-past-line@SCREEN-1"]);
  defect("a screen showing a requirement past the line", (p) => { p.screens[0].req_refs = ["REQ-3"]; }, ["screen-past-line@SCREEN-1", "req-unaccounted@REQ-1"]);
  defect("a screen referencing a requirement that does not exist", (p) => { p.screens[1].req_refs = ["REQ-9"]; }, ["ref-unknown@SCREEN-2", "req-unaccounted@REQ-2"]);
  defect("no screen on a surface inside the line", (p) => { p.screens = []; }, ["surface-without-screen@SURF-1", "req-unaccounted@REQ-1", "req-unaccounted@REQ-2"]);
  defect("uncovered naming a requirement that does not exist", (p) => { p.uncovered = ["REQ-9"]; }, ["ref-unknown@REQ-9"]);
  defect("uncovered naming a requirement a screen shows", (p) => { p.uncovered = ["REQ-1", "REQ-4"]; }, ["uncovered-yet-covered@REQ-1"]);
  defect("a functional requirement inside the line on no screen and not listed as uncovered", (p) => { p.screens[1].req_refs = []; }, ["req-unaccounted@REQ-2"]);
  check("every rule the builder is told is checked elsewhere fires on some defect, and nothing else does", eq([...seen].sort(), [...PROTO_RULES].sort()), `${[...seen].sort()} vs ${[...PROTO_RULES].sort()}`);
});

// ── the stories' arithmetic, both directions ──
await withRoot({}, (parent) => {
  const root = seedProject(parent);
  const proto = seedPrototype(root);
  const doc = seedStories(root);
  const prd = loadPrd(root);
  const clean = checkStories(prd, proto, doc);
  check("clean: one epic per functional requirement inside the line, every criterion proved once, every story on its screen — pass", clean.verdict === "pass" && clean.findings.length === 0 && clean.gate === STORY_GATE, JSON.stringify(clean.findings));
  check("checked counts the epics, the stories and the functional requirements inside the line — REQ-4 needs no epic", clean.checked === 2 + 2 + 2, String(clean.checked));

  const seen = new Set();
  const defect = (label, mutate, expect, verdict = "block") => {
    const d = clone(doc);
    mutate(d);
    const v = checkStories(prd, proto, d);
    for (const x of v.findings) seen.add(x.rule);
    check(`stories defect: ${label}`, v.verdict === verdict && expect.every((e) => fired(v).includes(e)), fired(v).join(" "));
  };
  defect("an epic for a requirement that does not exist", (d) => { d.epics[0].req_ref = "REQ-9"; }, ["ref-unknown@EPIC-1", "requirement-without-epic@REQ-1"]);
  defect("an epic for a requirement past the line", (d) => { d.epics[1].req_ref = "REQ-3"; }, ["epic-past-line@EPIC-2", "requirement-without-epic@REQ-2"]);
  defect("a story in an epic that is not there", (d) => { d.stories[0].epic = "EPIC-9"; }, ["ref-unknown@STORY-1"]);
  defect("a story in an epic whose requirement it does not deliver", (d) => { d.stories[0].epic = "EPIC-2"; }, ["story-outside-epic@STORY-1"]);
  defect("a story delivering a requirement that does not exist", (d) => { d.stories[1].req_refs = ["REQ-2", "REQ-9"]; }, ["ref-unknown@STORY-2"]);
  defect("a story delivering a requirement past the line", (d) => { d.stories[1].req_refs = ["REQ-2", "REQ-3"]; }, ["story-past-line@STORY-2"]);
  defect("a story on a screen the prototype does not have", (d) => { d.stories[0].screen_refs = ["SCREEN-9"]; }, ["ref-unknown@STORY-1"]);
  defect("a story claiming no screen when the prototype shows what it delivers — medium, advise", (d) => { d.stories[0].screen_refs = []; }, ["story-without-screen@STORY-1"], "advise");
  defect("a scenario with no When", (d) => { d.stories[0].scenarios[0].gherkin = "Given a delivery\nThen the exception shows it"; }, ["scenario-malformed@STORY-1#1"]);
  defect("a scenario with a line that is not a step", (d) => { d.stories[1].scenarios[0].gherkin = "Scenario: seeing the shift\nWhen I open the run sheet\nThen the deliveries are listed"; }, ["scenario-malformed@STORY-2#1"]);
  defect("a scenario proving a criterion that does not exist", (d) => { d.stories[0].scenarios[0].proves = ["REQ-1/AC-9"]; }, ["ref-unknown@STORY-1#1", "criterion-unproved@REQ-1/AC-1"]);
  defect("a functional requirement inside the line with no epic and no scenario", (d) => { d.epics = [d.epics[0]]; d.stories = [d.stories[0]]; }, ["requirement-without-epic@REQ-2", "criterion-unproved@REQ-2/AC-1"]);
  defect("a criterion proved twice — medium, advise", (d) => { d.stories[1].scenarios[0].proves = ["REQ-2/AC-1", "REQ-1/AC-1"]; }, ["criterion-proved-twice@REQ-1/AC-1"], "advise");
  check("every rule the writer is told is checked elsewhere fires on some defect, and nothing else does", eq([...seen].sort(), [...STORY_RULES].sort()), `${[...seen].sort()} vs ${[...STORY_RULES].sort()}`);

  check("gherkinShape: a Given/When/Then with And and But is well-formed", gherkinShape("Given a\nWhen b\nThen c\nAnd d\nBut e") === null);
  check("gherkinShape: no When, no Then, a non-step line, a keyword glued to a word", /no When/.test(gherkinShape("Given a\nThen b")) && /no Then/.test(gherkinShape("Given a\nWhen b")) && /not a Given\/When\/Then/.test(gherkinShape("Given a\nwhen b\nThen c")) && /"Givens are"/.test(gherkinShape("Givens are\nWhen b\nThen c")));
});

// ── the prototype runner: one builder, one file, the verdict filed beside it ──
await withRoot({}, async (parent) => {
  const root = seedProject(parent);
  const prd = loadPrd(root);
  const html = writeHtml(root);
  const structured = { screens: SCREENS, uncovered: ["REQ-4"], notes: "Start on the run sheet.", open_questions: [] };

  const q = scripted({ structured, toolUses: [{ name: "Read", input: { file_path: "discovery/prd.json" } }, { name: "Write", input: { file_path: HTML_FILE } }] });
  const out = await generate({ root, _query: q.query });
  const o = q.calls[0].options;
  check("the builder is a writer: Read/Write/Edit/Glob/Grep, edits accepted, the prototype contract as its output format, opus billed to discovery.writer",
    q.calls.length === 1 && eq(o.tools, ["Read", "Write", "Edit", "Glob", "Grep"]) && o.permissionMode === "acceptEdits" && eq(o.outputFormat, { type: "json_schema", schema: outputContract("prototype") }) && out.model === "claude-opus-5" && out.usd === 0.05, JSON.stringify({ tools: o.tools, mode: o.permissionMode, model: out.model }));
  check("its system prompt is the builder's identity plus the mechanics: scope, and every arithmetic rule as checked elsewhere",
    /^# Prototype builder/.test(o.systemPrompt) && /## Scope/.test(o.systemPrompt) && /One door, one shift, no exports\./.test(o.systemPrompt) && /## Checked elsewhere/.test(o.systemPrompt) && PROTO_RULES.every((r) => o.systemPrompt.includes(r)), o.systemPrompt.slice(-400));
  check("its prompt is the PRD after the line and where to write — nothing about existing screens or notes on a first build",
    /REQ-1/.test(q.calls[0].prompt) && q.calls[0].prompt.includes(`Write one file, \`${HTML_FILE}\``) && !/## Existing screens/.test(q.calls[0].prompt) && !/## The PM's notes/.test(q.calls[0].prompt));
  const doc = readDoc(root, PROTOTYPE_FILE);
  check("the record is written: id from the slug, traced to the PRD's version and hash, the file's hash, the builder's screens; stamped and verifying",
    doc.id === "proto-dock" && doc.traces.prd.version === "0.1.0" && doc.traces.prd.content_hash === prd.meta.content_hash && doc.file === HTML_FILE && doc.file_hash === html && eq(doc.screens, SCREENS) && validate("prototype", doc).ok && verify(doc).verdict === "pass" && eq(out.prototype, doc), JSON.stringify(doc).slice(0, 300));
  const v = readVerdict(root, PROTO_GATE);
  check("the arithmetic verdict is filed under its gate, pins the PRD and the prototype it checked, and is fresh",
    existsSync(join(root, REVIEWS, `${PROTO_GATE}.json`)) && v.verdict === "pass" && v.judged.length === 2 && v.judged[0].content_hash === prd.meta.content_hash && v.judged[1].content_hash === doc.meta.content_hash && freshVerdict(root, PROTO_GATE) !== null && eq(out.arithmetic, v), JSON.stringify(v.judged));
  check("one call, one ledger row", calls(ledgerPath(root)).length === 1);

  // A rebuild: existing ids and the PM's notes ride in; a new screen may be minted; a dropped id is refused.
  const q2 = scripted({ structured: { ...structured, screens: [...SCREENS, { id: "SCREEN-3", name: "Confirming an exception", surface_ref: "SURF-1", req_refs: ["REQ-1"] }] }, toolUses: [{ name: "Write", input: { file_path: join(root, HTML_FILE) } }] });
  const out2 = await generate({ root, notes: "The run sheet needs the vendor on each row.", _query: q2.query });
  check("a rebuild is told the existing screen ids and the PM's notes; an absolute path to the one file is the one file",
    /## Existing screens[\s\S]*- SCREEN-1: /.test(q2.calls[0].prompt) && /## The PM's notes on the last build\n\nThe run sheet needs the vendor/.test(q2.calls[0].prompt) && out2.prototype.screens.length === 3);
  const q3 = scripted({ structured: { ...structured, screens: [SCREENS[0]] }, toolUses: [{ name: "Write", input: { file_path: HTML_FILE } }] });
  const dropped = await refusal(() => generate({ root, _query: q3.query }));
  check("a rebuild that drops a screen id is refused, naming the ids; the record on disk is the last accepted build", dropped instanceof Refused && dropped.code === "ids-dropped" && /SCREEN-2, SCREEN-3/.test(dropped.message) && readDoc(root, PROTOTYPE_FILE).screens.length === 3, dropped?.message);

  // The builder wrote somewhere else, or nowhere, or returned nothing, or returned the wrong shape.
  const elsewhere = await refusal(() => generate({ root, _query: scripted({ structured, toolUses: [{ name: "Write", input: { file_path: HTML_FILE } }, { name: "Edit", input: { file_path: "src/app.js" } }] }).query }));
  check("a write anywhere but the one file is refused, naming the file", elsewhere instanceof Refused && elsewhere.code === "wrote-elsewhere" && /src\/app\.js/.test(elsewhere.message), elsewhere?.message);
  rmSync(join(root, HTML_FILE));
  const noHtml = await refusal(() => generate({ root, _query: scripted({ structured }).query }));
  check("no file written is refused — the record is not the prototype", noHtml instanceof Refused && noHtml.code === "no-html", noHtml?.message);
  writeHtml(root);
  const silent = await refusal(() => generate({ root, _query: scripted({ toolUses: ["Write"].map(() => ({ name: "Write", input: { file_path: HTML_FILE } })) }).query }));
  check("no structured answer is refused", silent instanceof Refused && silent.code === "no-structured-output", silent?.message);
  const wrong = await refusal(() => generate({ root, _query: scripted({ structured: { screens: "two", uncovered: [] }, toolUses: [{ name: "Write", input: { file_path: HTML_FILE } }] }).query }));
  check("a record that does not fit the contract is refused", wrong instanceof Refused && wrong.code === "prototype-invalid", wrong?.message);
  check("nothing refused reached the record: three screens still, the verdict still the last accepted build's", readDoc(root, PROTOTYPE_FILE).screens.length === 3 && readVerdict(root, PROTO_GATE).judged[1].content_hash === readDoc(root, PROTOTYPE_FILE).meta.content_hash);

  // Before the line there is nothing to hold the prototype to.
  const bare = seedProject(parent, { slug: "bare" });
  const p = loadPrd(bare);
  p.mvp = { line: "", inside: [], past: [] };
  savePrd(bare, p);
  const none = scripted({ structured });
  const noLine = await refusal(() => generate({ root: bare, _query: none.query }));
  check("no line, no prototype — refused before any call", noLine instanceof Refused && noLine.code === "no-line" && none.calls.length === 0, noLine?.message);
});

// ── the stories runner: a composer with no write surface, a reviewer whose fresh verdict rides in ──
await withRoot({}, async (parent) => {
  const bare = seedProject(parent, { slug: "bare" });
  const none = scripted({ structured: { epics: EPICS, stories: STORIES, notes: "", open_questions: [] } });
  const noProto = await refusal(() => write({ root: bare, _query: none.query }));
  const noStories = await refusal(() => review({ root: bare, _query: none.query }));
  check("no prototype, no stories; no stories, no review — both refused before any call", noProto?.code === "no-prototype" && noStories?.code === "no-stories" && none.calls.length === 0, `${noProto?.code} ${noStories?.code}`);

  const root = seedProject(parent);
  const proto = seedPrototype(root);
  answer({ root, req: "REQ-1", oq: "OQ-1", answer: "No — the door closes the record when the truck leaves.", criterion: "An exception cannot be recorded against a delivery marked departed.", by: "Brad" });
  const prd = loadPrd(root);
  const backlog = { epics: EPICS, stories: STORIES, notes: "", open_questions: [] };

  const q = scripted({ structured: backlog, toolUses: [{ name: "Read", input: { file_path: HTML_FILE } }, { name: "Grep", input: { pattern: "button" } }] });
  const out = await write({ root, _query: q.query });
  const o = q.calls[0].options;
  check("the writer composes: Read/Glob/Grep only, no edits accepted, the story contract as its output format, billed to discovery.writer",
    q.calls.length === 1 && eq(o.tools, ["Read", "Glob", "Grep"]) && o.permissionMode === "default" && eq(o.outputFormat, { type: "json_schema", schema: outputContract("story") }) && out.model === "claude-opus-5", JSON.stringify({ tools: o.tools, mode: o.permissionMode }));
  check("its system prompt is the Product Owner's identity plus scope, the ruling and every arithmetic rule as checked elsewhere",
    /^# Story writer/.test(o.systemPrompt) && /## Scope/.test(o.systemPrompt) && /RUL-1/.test(o.systemPrompt) && /## Checked elsewhere/.test(o.systemPrompt) && STORY_RULES.every((r) => o.systemPrompt.includes(r)));
  check("its prompt is the PRD, the prototype's screens with the file to read, and no reviewer findings on a first write",
    /REQ-1\/AC-3/.test(q.calls[0].prompt) && /## Prototype\n\nScreens:\n- \*\*SCREEN-1\*\*/.test(q.calls[0].prompt) && q.calls[0].prompt.includes(`The prototype itself is at \`${HTML_FILE}\``) && !/## The reviewer's findings/.test(q.calls[0].prompt) && !/## Existing ids/.test(q.calls[0].prompt));
  const doc = readDoc(root, STORIES_FILE);
  check("the backlog is written by the runner: traced to the PRD and the prototype by hash, stamped, verifying, and it is what came back",
    doc.id === "stories-dock" && doc.traces.prd.content_hash === prd.meta.content_hash && doc.traces.prd.version === "0.2.0" && doc.traces.prototype.content_hash === proto.meta.content_hash && eq(doc.stories, STORIES) && validate("story", doc).ok && verify(doc).verdict === "pass" && eq(out.stories, doc));
  const arith = readVerdict(root, STORY_GATE);
  check("the arithmetic verdict is filed with three pins — PRD, prototype, stories — and is fresh; REQ-1/AC-3 is unproved because the ruling landed after the fixture was cut",
    arith.judged.length === 3 && arith.judged[2].content_hash === doc.meta.content_hash && freshVerdict(root, STORY_GATE) !== null && fired(arith).join() === "criterion-unproved@REQ-1/AC-3" && arith.verdict === "block", fired(arith).join(" "));

  for (const tool of ["Write", "Edit", "Bash"]) {
    const e = await refusal(() => write({ root, _query: scripted({ structured: backlog, toolUses: [tool] }).query }));
    check(`a writer that used ${tool} is refused — it composes, the runner writes`, e instanceof Refused && e.code === "wrote" && e.message.includes(tool), e?.message);
  }
  const q2 = scripted({ structured: { ...backlog, stories: [STORIES[0]] } });
  const dropped = await refusal(() => write({ root, _query: q2.query }));
  check("a rewrite is told the existing ids, and one that drops a story is refused naming it", /## Existing ids[\s\S]*- EPIC-1: [\s\S]*- STORY-2: As a dock lead/.test(q2.calls[0].prompt) && dropped?.code === "ids-dropped" && /STORY-2/.test(dropped.message), dropped?.message);
  const wrong = await refusal(() => write({ root, _query: scripted({ structured: { epics: [], stories: "none" } }).query }));
  check("a backlog that does not fit the contract is refused", wrong?.code === "stories-invalid", wrong?.message);
  check("nothing refused reached the record", eq(readDoc(root, STORIES_FILE), doc));

  // The reviewer: 8 findings — one re-raises the ruling, seven stand and all seven reach the PM, ranked; nothing is withheld for a later round.
  const findings = [
    f("OQ-1", "high", "certain", { summary: "the truck question is still open" }),
    f("STORY-1", "high", "certain", { rule: "imperative-step" }),
    f("STORY-2", "high", "likely", { rule: "not-a-slice" }),
    f("STORY-1", "medium", "certain", { rule: "given-not-concrete" }),
    f("STORY-2", "medium", "likely", { rule: "proves-less" }),
    f("STORY-1", "low", "certain"),
    f("STORY-2", "low", "likely"),
    f("STORY-1", "low", "likely"),
  ];
  const r = scripted({ structured: { findings, deferred: [], checked: 2, skipped: 0 }, toolUses: [{ name: "Read", input: { file_path: HTML_FILE } }] });
  const verdict = await review({ root, _query: r.query });
  const ro = r.calls[0].options;
  check("the reviewer is a judge: Read/Glob/Grep, the finding contract, billed to discovery.reviewer; its identity is the story reviewer's, with the ruling and the arithmetic as checked elsewhere",
    eq(ro.tools, ["Read", "Glob", "Grep"]) && eq(ro.outputFormat, { type: "json_schema", schema: outputContract("finding") }) && verdict.cost.model === "claude-opus-5" && /^# Story reviewer/.test(ro.systemPrompt) && /RUL-1/.test(ro.systemPrompt) && STORY_RULES.every((x) => ro.systemPrompt.includes(x)) && readFileSync(ledgerPath(root), "utf8").trim().split("\n").map((l) => JSON.parse(l)).at(-1).role === "reviewer", ro.systemPrompt.slice(0, 200));
  check("it is shown the requirements inside the line with their criteria, the vocabulary, the screens and the stories",
    /## Requirements inside the line[\s\S]*REQ-1\/AC-3: An exception cannot be recorded/.test(r.calls[0].prompt) && /## Vocabulary[\s\S]*\*\*exception\*\*/.test(r.calls[0].prompt) && /## Prototype screens[\s\S]*SCREEN-2/.test(r.calls[0].prompt) && /## Stories[\s\S]*### STORY-1 \(EPIC-1\)/.test(r.calls[0].prompt) && !/REQ-3/.test(r.calls[0].prompt.split("## Vocabulary")[0]));
  check("the verdict: the re-raise removed and counted, all seven kept by rank with the lightest last, block on the certain highs; filed with three pins and fresh",
    verdict.reraised === 1 && !("dropped" in verdict) && verdict.findings.length === 7 && verdict.findings[0].rule === "imperative-step" && verdict.findings[6].subject === "STORY-1" && verdict.findings[6].severity === "low" && verdict.findings[6].confidence === "likely" && verdict.verdict === "block" && eq(readVerdict(root, REVIEW_GATE), verdict) && verdict.judged.length === 3 && freshVerdict(root, REVIEW_GATE) !== null && validate("finding", verdict).ok, JSON.stringify(verdict.findings.map((x) => x.rule)));
  const funnel = rows(funnelPath(root));
  const m = meter(funnel);
  check("the meter: one re-raise row naming the ruling and nothing else — no cap, so no cut to count; totals by signal and by gate (R8)",
    funnel.length === 1 && funnel[0].signal === "reraised" && funnel[0].ruling === "RUL-1" && funnel[0].gate === REVIEW_GATE && eq(m, { total: 1, by_signal: { reraised: 1 }, by_gate: { [REVIEW_GATE]: 1 } }), JSON.stringify({ funnel, m }));

  // The fresh verdict rides into the next rewrite; after the PRD moves it is nothing, though the file is still there.
  const q3 = scripted({ structured: backlog });
  await write({ root, _query: q3.query });
  check("a fresh reviewer verdict rides into the rewrite, findings first and their authority stated",
    /## The reviewer's findings on the previous backlog\n\nThe story-reviewer gate returned BLOCK on the previous version/.test(q3.calls[0].prompt) && /1\. \[high\/certain\] imperative-step — STORY-1/.test(q3.calls[0].prompt) && /LIKELY — a judgement call/.test(q3.calls[0].prompt) && !/OQ-1/.test(q3.calls[0].prompt.split("## The reviewer's findings")[1]));
  answer({ root, req: "REQ-2", oq: "OQ-2", answer: "The receiving lead.", by: "Brad" });
  check("the ruling moved the PRD: the backlog wears the badge naming RUL-2", staleness(root).stories.prd_moved && staleness(root).stories.since.join() === "RUL-2" && existsSync(join(root, REVIEWS, `${REVIEW_GATE}.json`)));
  const q4 = scripted({ structured: backlog });
  await write({ root, _query: q4.query });
  check("a verdict whose PRD pin no longer matches does not ride in — the pin is checked, never the file", !/## The reviewer's findings/.test(q4.calls[0].prompt) && /RUL-2/.test(q4.calls[0].options.systemPrompt) && !staleness(root).stories.prd_moved);
  check("every call went through the script and the ledger holds them all", calls(ledgerPath(root)).length === 1 + 3 + 1 + 1 + 1 + 1 + 1);
});

// ── R13 · the seam's question budget: syntax crosses for free; precision is what intake counts, per story, never trimmed ──
{
  const handoff = {
    contract: { requirements: [{ id: "REQ-1", type: "functional", statement: "r", acceptance_criteria: [{ id: "AC-1", statement: "a" }] }], open_questions: [{ id: "OQ-1", question: "contract asks", status: "open" }, { id: "OQ-2", question: "answered", status: "answered" }] },
    stories: { epics: [{ id: "EPIC-1", req_ref: "REQ-1", title: "t" }], stories: [
      { id: "STORY-1", epic: "EPIC-1", statement: "s1", req_refs: ["REQ-1"], screen_refs: ["SCREEN-1"], scenarios: [] },
      { id: "STORY-2", epic: "EPIC-1", statement: "s2", req_refs: ["REQ-1"], screen_refs: [], scenarios: [] },
    ], open_questions: [
      { subject: "STORY-1", question: "one", blocking: false }, { subject: "STORY-1", question: "two", blocking: false },
      { subject: "REQ-1/AC-1", question: "on the criterion — lands on both stories", blocking: true },
      { question: "no subject", blocking: false },
    ] },
    design: { screens: [{ screen_ref: "SCREEN-1", name: "n", controls: [], states: [] }], open_questions: [{ subject: "SCREEN-1", question: "design asks about the screen", blocking: false }, { subject: "SURF-9", question: "no story takes a surface", blocking: false }] },
  };
  const items = slice(handoff, []);
  const { questions, budget } = ask(handoff, items);
  const on = (story) => questions.filter((q) => q.story === story).map((q) => q.question);
  check("attribution: STORY-n direct; REQ-n/AC-m through every story carrying the requirement; SCREEN-n through the story on the screen; the rest ride with no story",
    eq(on("STORY-1"), ["one", "two", "on the criterion — lands on both stories", "design asks about the screen"]) && eq(on("STORY-2"), ["on the criterion — lands on both stories"]) && eq(on(null), ["contract asks", "no subject", "no story takes a surface"]), JSON.stringify(questions.map((q) => [q.story, q.question])));
  check("the budget is 2 per story: STORY-1 at 4 is over, STORY-2 at 1 is not; the closed contract question is not carried; nothing is trimmed",
    budget.per_story === QUESTION_BUDGET && QUESTION_BUDGET === 2 && eq(budget.over, [{ story: "STORY-1", count: 4 }]) && questions.length === 8 && !questions.some((q) => q.question === "answered"), JSON.stringify(budget));
  check("blocking rides across as the source said it — a blocking question on the criterion is blocking on each story it lands on", questions.filter((q) => q.blocking).length === 2 && questions.filter((q) => q.blocking).every((q) => q.source === "stories"));
  check("the signal intake records for a story over budget measures R13", SIGNALS["intake-questions"] === "R13");
}

// ── the meter refuses noise ──
await withRoot({}, (root) => {
  const path = funnelPath(root);
  let threw = null;
  try { record(path, { signal: "vibes", gate: "x" }); } catch (e) { threw = e; }
  check("an unnamed signal is refused — every row measures a rule", threw instanceof Error && /unknown signal vibes/.test(threw.message) && !existsSync(path) && eq(Object.values(SIGNALS), ["R3", "R8", "R13"]));
  record(path, { signal: "delivery-amendment", id: "AMD-1", material: true }, () => new Date("2026-09-04T12:00:00Z"));
  check("a row is dated and read back as written", eq(rows(path), [{ at: "2026-09-04T12:00:00.000Z", signal: "delivery-amendment", id: "AMD-1", material: true }]) && eq(meter(rows(path)), { total: 1, by_signal: { "delivery-amendment": 1 }, by_gate: {} }));
});

done();
