#!/usr/bin/env node
// owns: R2, R12 · shared — eval: scope. The MVP line is a gate input: drawn after the
// shape (R12), read by every agent after it as scope (R2), and held to its own
// arithmetic — every committed requirement on one side, nothing named that the document
// lacks. The workshop is exercised end to end on a scripted model: sections open in
// order, a turn writes the transcript and the section state, an extraction fills only
// its section's fields from a contract derived from the PRD schema, and ids stick. The
// design is the last document inside the line: held to the claim map exactly (every
// claimed screen designed, every designed screen claimed), reviewed against the standard
// it declared, and signed by a named person — a blocking review overridden only by a
// human's word on the record.

import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { suite, withRoot, scripted } from "./_harness.mjs";
import { seedProject, seedPrototype, seedStories, seedDesign, DESIGN, seedDelivery, BINDING } from "./_fixture.mjs";
import { skeleton, validate, outputContract, fieldsOf, partialContract } from "../shared/schema/index.mjs";
import { mechanics, namedFields } from "../shared/prompt/index.mjs";
import { verify, stamp } from "../shared/hash.mjs";
import { lineDrawn, scopeOf, checkScope } from "../shared/scope.mjs";
import { setupProject, ledgerPath } from "../discovery/setup/index.mjs";
import { SECTIONS, LINE_SECTION, indexOf, section } from "../discovery/workshop/sections.mjs";
import { openPrd, loadPrd, savePrd, mayOpen, systemFor, turn, extract, readTranscript, parseReply, captured, progress, WorkshopRefused } from "../discovery/workshop/index.mjs";
import { repoBrief } from "../discovery/workshop/brief.mjs";
import { Refused, readDoc, readVerdict, freshVerdict, staleness, DESIGN_FILE, HTML_FILE } from "../discovery/record/index.mjs";
import { answer } from "../discovery/doors/index.mjs";
import { write, review, signoff, checkDesign, GATE as DESIGN_GATE, REVIEW_GATE as DESIGN_REVIEW, ARITHMETIC as DESIGN_RULES } from "../discovery/design/index.mjs";
import { intake } from "../delivery/intake/index.mjs";
import { checkBinding, ARITHMETIC as SDD_RULES, UNTESTED, GATE as SDD_GATE } from "../delivery/sdd/index.mjs";
import { identity } from "../shared/prompt/index.mjs";
import { ROOT } from "./_harness.mjs";

const { check, done } = suite("scope · R2 the line is a gate input, R12 shape before scope");

const same = (a, b) => a.length === b.length && [...a].sort().join(" ") === [...b].sort().join(" ");
const REQ = (n, status = "committed") => ({ id: `REQ-${n}`, statement: `s${n}`, type: "functional", done_definition: "d", acceptance_criteria: [{ id: "AC-1", statement: "a" }], status, context: "", flags: [] });
const rulesOf = (v) => v.findings.map((f) => `${f.rule}:${f.subject}`).sort();
const fired = (v) => v.findings.map((f) => `${f.rule}@${f.subject}`);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const refusal = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };
const refuse = (fn) => { try { fn(); return null; } catch (e) { return e; } };
const finding = (subject, severity = "high", confidence = "certain", extra = {}) => ({ severity, confidence, rule: "crafted-not-generic", subject, summary: `about ${subject}`, evidence: "e", remedy: "r", ...extra });

// ── R2 · the line's arithmetic ──
{
  const prd = skeleton("prd");
  prd.requirements = [REQ(1), REQ(2), REQ(3, "deferred"), REQ(4)];
  prd.shape.lifecycles = [{ id: "LC-1", subject: "order", states: ["placed", "baked"], owner: "head baker" }];
  prd.surfaces.shipped = [{ id: "SURF-1", kind: "handheld web app", statement: "…", req_refs: ["REQ-1"] }];

  check("before the line: not drawn, scope is null — nothing is a gate input yet", !lineDrawn(prd) && scopeOf(prd) === null);
  const undrawn = checkScope(prd);
  check("before the line: the check blocks on mvp-line-missing and every committed requirement is unplaced",
    undrawn.verdict === "block" && same(rulesOf(undrawn), ["mvp-line-missing:/mvp/line", "mvp-unplaced:REQ-1", "mvp-unplaced:REQ-2", "mvp-unplaced:REQ-4"]), rulesOf(undrawn).join(","));

  prd.mvp = { line: "One bakery, one run sheet, no inventory.", inside: ["REQ-1", "REQ-2"], past: [{ ref: "REQ-4", why: "second location" }, { ref: "LC-1", why: "cancellation waits" }, { ref: "SURF-1", why: "handheld later" }] };
  const clean = checkScope(prd);
  check("a drawn line with every committed requirement placed passes", clean.verdict === "pass" && clean.findings.length === 0 && clean.checked === 4 + 3 + 1, JSON.stringify(clean));
  check("the line becomes scope: one quotable sentence and what sits past it with its reason",
    scopeOf(prd).mvp === "One bakery, one run sheet, no inventory." && scopeOf(prd).deferred.join("|") === "REQ-4 — second location|LC-1 — cancellation waits|SURF-1 — handheld later");

  const bad = structuredClone(prd);
  bad.mvp.inside.push("REQ-9", "REQ-4");
  bad.mvp.past.push({ ref: "SURF-7", why: "nothing has this id" });
  bad.requirements.push(REQ(5));
  bad.requirements[2].status = "cut"; bad.mvp.inside.push("REQ-3");
  const v = checkScope(bad);
  check("each way the document can contradict its line is a certain + high finding",
    v.verdict === "block" && same(rulesOf(v), ["mvp-inside-unknown:REQ-9", "mvp-both-sides:REQ-4", "mvp-past-unknown:SURF-7", "mvp-unplaced:REQ-5", "mvp-inside-not-committed:REQ-3"]) &&
    v.findings.every((f) => f.severity === "high" && f.confidence === "certain" && f.evidence && f.remedy), rulesOf(v).join(","));
  check("the check is finding-shaped like every other gate", v.gate === "mvp-line" && "deferred" in v && "skipped" in v);

  // What an agent after the line is shown.
  const shown = mechanics({ kind: "conversant", schema: "prd", only: ["okr"], scope: scopeOf(prd) });
  check("a conversant after the line reads the line and is told to name it and move on, not elicit past it",
    /## Scope[\s\S]*The MVP line: One bakery, one run sheet, no inventory\.[\s\S]*- REQ-4 — second location[\s\S]*name the line and move on/.test(shown));
  const judged = mechanics({ kind: "judge", schema: "finding", scope: scopeOf(prd) });
  check("a judge after the line is told past-the-line goes in deferred, never findings", /goes in `deferred`[\s\S]*never in `findings`/.test(judged));
}

// ── R12 · shape before scope: the sections, in order, over the schema ──
{
  const keys = SECTIONS.map((s) => s.key);
  check("the sections run problem → shape → solution → requirements → metrics → readiness", keys.join(",") === "problem,shape,solution,requirements,metrics,readiness");
  check("shape comes before the section that draws the line, and the line section owns /mvp",
    indexOf("shape") < indexOf(LINE_SECTION) && section(LINE_SECTION).fields.includes("mvp") && !SECTIONS.slice(0, indexOf("shape") + 1).some((s) => s.fields.includes("mvp")));
  const contract = outputContract("prd");
  const model = Object.keys(contract.properties);
  const named = [...new Set(SECTIONS.flatMap((s) => s.fields))];
  check("every field a section names is a model-facing field of the PRD contract, and every such field has a section",
    same(named, model), `section-only ${named.filter((f) => !model.includes(f)).join(",")} · contract-only ${model.filter((f) => !named.includes(f)).join(",")}`);
  for (const s of SECTIONS) {
    const text = mechanics({ kind: "conversant", schema: "prd", only: s.fields });
    const held = fieldsOf(partialContract("prd", s.fields)).map((f) => f.path);
    check(`${s.key}: the conversant mechanics name exactly this section's fields (${held.length})`, same(namedFields(text), held) && /This section captures/.test(text) && /never emit structured data/.test(text));
  }
  let err = null;
  try { partialContract("prd", ["header"]); } catch (e) { err = e; }
  check("a section asking for a field the schema lacks is refused — the contract is never retyped", /header not in the contract/.test(err?.message ?? ""));

  const empty = skeleton("prd");
  check("the PRD skeleton is derived and validates, with the drift pointers pinned by the schema",
    validate("prd", empty).ok && empty["x-drift-checked"].join() === "/problem,/shape,/solution,/surfaces,/requirements,/mvp,/okr,/constraints" && empty.mvp.line === "" && empty.shape.lifecycles.length === 0);
}

// ── the workshop, end to end on a scripted model ──
await withRoot({}, async (parent) => {
  const _exec = (cmd, args) => (cmd === "git" && args[0] === "remote" ? "git@github.com:acme/oven.git" : "");
  const { root } = setupProject({ slug: "oven", title: "Oven", parent, _exec });
  const prd = openPrd({ root, title: "Oven", slug: "oven", seed: "A run sheet for one bakery.", repo: "git@github.com:acme/oven.git" });
  check("openPrd writes discovery/prd.json: the skeleton, the runner's fields set, every section pending, stamped and verifiable",
    existsSync(join(root, "discovery", "prd.json")) && prd.id === "prd-oven" && prd.meta.slug === "oven" && prd.meta.doc_status === "draft" && prd.seed.startsWith("A run sheet") &&
    Object.keys(prd.sections).join() === SECTIONS.map((s) => s.key).join() && Object.values(prd.sections).every((s) => s.status === "pending" && s.session_id === null && s.turns === 0) &&
    verify(loadPrd(root)).verdict === "pass", JSON.stringify(prd.sections));
  const twice = (() => { try { openPrd({ root, title: "Oven", slug: "oven", seed: "again" }); return null; } catch (e) { return e; } })();
  check("a second openPrd over an existing PRD is refused", twice instanceof WorkshopRefused && twice.code === "prd-exists");

  // R12 as a door.
  const early = await turn({ root, key: "requirements", text: "REQ-1: …", _query: scripted().query }).then(() => null, (e) => e);
  check("the requirements section cannot open before the shape is complete — R12 is a door, not advice",
    early instanceof WorkshopRefused && early.code === "shape-first" && !mayOpen(loadPrd(root), "requirements").ok && !mayOpen(loadPrd(root), "metrics").ok && mayOpen(loadPrd(root), "problem").ok && mayOpen(loadPrd(root), "solution").ok);

  // A turn.
  const brief = repoBrief(root);
  const sys = systemFor({ prd: loadPrd(root), key: "problem", brief });
  check("the first system prompt is the interrogator, the section, then generated mechanics with the seed, the capture and the repo brief",
    sys.startsWith("# The interrogator") && /# Section: Problem & Value/.test(sys) && /\n---\n\n# Mechanics/.test(sys) && /This section captures — `prd`/.test(sys) && /`\/problem\/crux`/.test(sys) &&
    !/`\/requirements`/.test(sys) && /"A run sheet for one bakery\."/.test(sys) && /\(nothing captured yet\)/.test(sys) && /## What exists/.test(sys) && !/## Scope/.test(sys));

  const q = scripted({ text: ["🔥 Who is the baker, exactly?", "🏛️ So the crux is the 4am handoff.\n\n[SECTION_COMPLETE]\n"], sessionId: "sess-p" });
  const t1 = await turn({ root, key: "problem", text: "A bakery run sheet.", _query: q.query });
  check("a turn parses the posture and returns the reply with no signal in it", t1.mode === "challenge" && t1.signals.length === 0 && t1.reply === "🔥 Who is the baker, exactly?" && t1.state.status === "open" && t1.state.turns === 1);
  const t2 = await turn({ root, key: "problem", text: "The head baker.", _query: q.query });
  check("[SECTION_COMPLETE] completes the section and is stripped from the record",
    t2.mode === "socratic" && t2.signals.join() === "complete" && !/SECTION_COMPLETE/.test(t2.reply) && t2.state.status === "complete" && t2.state.turns === 2 && loadPrd(root).sections.problem.status === "complete");
  const rows = readTranscript(root, "problem");
  check("the transcript holds both sides of both turns, with posture, signals and cost on the workshop's lines",
    rows.length === 4 && rows.map((r) => r.from).join() === "pm,workshop,pm,workshop" && rows[0].text === "A bakery run sheet." && rows[1].mode === "challenge" && rows[3].signals.join() === "complete" && typeof rows[3].usd === "number",
    JSON.stringify(rows.map((r) => [r.from, r.mode])));
  check("the PRD is the model's context on the second turn — the seed and the captured summary, not a flattened transcript",
    /"A run sheet for one bakery\."/.test(q.calls[1].options.systemPrompt) && !/A bakery run sheet\./.test(q.calls[1].options.systemPrompt) && q.calls[1].options.resume === "sess-p");

  // Kill.
  const kill = scripted({ text: "🔥 The question that did not survive: who pays.\n\n[KILL_SUGGESTED]\n\nBetter here than in the CEO's office." });
  const t3 = await turn({ root, key: "problem", text: "override, moving on", _query: kill.query });
  const flagged = loadPrd(root);
  check("[KILL_SUGGESTED] goes on the record as a flag with the memo; the section stays open for the PM's decision",
    t3.signals.join() === "kill" && flagged.flags.length === 1 && flagged.flags[0].kind === "kill_suggested" && flagged.flags[0].section === "problem" && /who pays/.test(flagged.flags[0].note) && flagged.sections.problem.status === "open",
    JSON.stringify(flagged.flags));
  check("parseReply reads the posture with or without the variation selector", parseReply("🏛 x").mode === "socratic" && parseReply("🏛️ x").mode === "socratic" && parseReply("plain").mode === null);

  // Extraction: a separate call, the contract derived from the schema, only this section's fields.
  const problem = { who: "the head baker", problem: "the 4am handoff is verbal", crux: "one sheet both shifts trust", why_now: "second oven", business_value: "fewer remakes", evidence: "3 remakes/week" };
  const x = scripted({ structured: { problem }, usd: 0.08 });
  const e1 = await extract({ root, key: "problem", _query: x.query });
  const after = loadPrd(root);
  check("extract fills exactly the section's fields, stamps, validates and records when",
    e1.fields.join() === "problem" && after.problem.crux === "one sheet both shifts trust" && after.shape.lifecycles.length === 0 && after.sections.problem.extracted_at && verify(after).verdict === "pass" && e1.usd === 0.08);
  check("the extraction's output contract on the wire is the PRD schema cut to the section — derived, not retyped",
    same(Object.keys(x.calls[0].options.outputFormat.schema.properties), ["problem"]) && x.calls[0].options.outputFormat.schema.required.join() === "problem" &&
    x.calls[0].options.outputFormat.schema.properties.problem.required.includes("crux") && x.calls[0].options.tools.length === 0);
  check("the extractor reads the transcript, not the PRD, and is told never to invent", /TRANSCRIPT:\n[\s\S]*PM: A bakery run sheet\.[\s\S]*Workshop: 🔥 Who is the baker/.test(x.calls[0].prompt) && /# The extractor/.test(x.calls[0].options.systemPrompt) && /Output contract — `prd`/.test(x.calls[0].options.systemPrompt));
  check("the ledger row for the extraction is its own kind", (() => { const l = readFileSync(join(root, "forge", "discovery", "calls.jsonl"), "utf8").trim().split("\n").map(JSON.parse); return l.at(-1).kind === "extract" && l.at(-1).role === "writer"; })());
  const ctx = systemFor({ prd: after, key: "shape", brief });
  check("the next section's context shows what was captured", /Crux: one sheet both shifts trust/.test(ctx) && /Who: the head baker/.test(ctx) && captured(after).includes("Value: fewer remakes"));

  const malformed = scripted({ structured: { problem: { who: "x" } } });
  const e2 = await extract({ root, key: "problem", _query: malformed.query }).then(() => null, (e) => e);
  check("an extraction that does not fit the contract is refused, naming the fields, and the PRD is untouched",
    e2 instanceof WorkshopRefused && e2.code === "extract-invalid" && e2.detail.some((d) => /crux/.test(d)) && loadPrd(root).problem.crux === "one sheet both shifts trust", e2?.message);
  const nothing = await extract({ root, key: "solution", _query: scripted().query }).then(() => null, (e) => e);
  check("a section with no transcript has nothing to extract", nothing instanceof WorkshopRefused && nothing.code === "no-transcript");

  // Through the shape to the line — and sticky ids.
  const doc = loadPrd(root);
  doc.sections.shape.status = "complete";
  doc.shape.lifecycles = [{ id: "LC-1", subject: "order", states: ["placed", "baked", "collected"], owner: "head baker" }];
  savePrd(root, doc);
  check("with the shape complete the line section opens", mayOpen(loadPrd(root), "requirements").ok && progress(loadPrd(root)).sections.find((s) => s.key === "metrics").may_open);
  const late = systemFor({ prd: loadPrd(root), key: "requirements", brief });
  check("the line section shows the lifecycles it will draw through, and no scope yet — the line is drawn here", /LC-1 order: placed → baked → collected/.test(late) && !/## Scope/.test(late));

  await turn({ root, key: "requirements", text: "REQ-1 record an exception; REQ-2 review the sheet. Line: recording only.", _query: scripted({ text: "🔥 …\n\n[SECTION_COMPLETE]" }).query });
  const first = {
    requirements: [REQ(1), REQ(2, "deferred")],
    surfaces: { shipped: [{ id: "SURF-1", kind: "handheld web app", statement: "one-handed at the door", req_refs: ["REQ-1"] }], deferred: [] },
    mvp: { line: "Recording only; review waits.", inside: ["REQ-1"], past: [{ ref: "REQ-2", why: "review needs a week of data" }] },
  };
  await extract({ root, key: "requirements", _query: scripted({ structured: first }).query });
  const lined = loadPrd(root);
  check("the extraction draws the line into the PRD and the line becomes scope", lineDrawn(lined) && scopeOf(lined).mvp === "Recording only; review waits." && checkScope(lined).verdict === "pass");
  const metrics = systemFor({ prd: lined, key: "metrics", brief });
  check("a section after the line reads it as scope (R2)", /## Scope\n\nThe MVP line: Recording only; review waits\.[\s\S]*- REQ-2 — review needs a week of data/.test(metrics));

  const renumbered = structuredClone(first);
  renumbered.requirements = [{ ...REQ(1), id: "REQ-3" }, REQ(2, "deferred")];
  renumbered.mvp.inside = ["REQ-3"];
  const e3 = await extract({ root, key: "requirements", _query: scripted({ structured: renumbered }).query }).then(() => null, (e) => e);
  check("a re-extraction that drops an id is refused — ids are sticky, the PRD stands",
    e3 instanceof WorkshopRefused && e3.code === "ids-dropped" && e3.detail.map((d) => d.id).join() === "REQ-1" && loadPrd(root).requirements[0].id === "REQ-1", e3?.message);
  const y = scripted({ structured: { ...first, requirements: [...first.requirements, REQ(3)] } });
  await extract({ root, key: "requirements", _query: y.query });
  check("the extractor is told which ids exist and a re-extraction that keeps them and adds one is accepted",
    /EXISTING ids to PRESERVE[\s\S]*REQ-1: s1[\s\S]*REQ-2: s2[\s\S]*SURF-1: one-handed/.test(y.calls[0].prompt) && loadPrd(root).requirements.length === 3);

  const contradict = scripted({ structured: { ...first, requirements: [...first.requirements, REQ(3)], mvp: { ...first.mvp, inside: ["REQ-1", "REQ-2", "REQ-3"] } } });
  await extract({ root, key: "requirements", _query: contradict.query });
  check("the arithmetic is the gate's, not the writer's: a line the document contradicts is written and then found",
    same(rulesOf(checkScope(loadPrd(root))), ["mvp-both-sides:REQ-2", "mvp-inside-not-committed:REQ-2"]), rulesOf(checkScope(loadPrd(root))).join(","));
});

// ── R2 · the design covers the claim map exactly, both directions ──
await withRoot({}, (parent) => {
  const root = seedProject(parent);
  const proto = seedPrototype(root);
  const stories = seedStories(root);
  const doc = seedDesign(root);
  const clean = checkDesign(proto, stories, doc);
  check("clean: both claimed screens designed once, the hero on a designed screen — pass, nothing fired", clean.verdict === "pass" && clean.findings.length === 0 && clean.gate === DESIGN_GATE, JSON.stringify(clean.findings));
  check("checked counts the claimed screens, the designed screens and the heroes", clean.checked === 2 + 2 + 1 && clean.skipped === 0 && clean.deferred.length === 0, String(clean.checked));

  const seen = new Set();
  const defect = (label, mutate, expect) => {
    const d = structuredClone(doc), s = structuredClone(stories);
    mutate(d, s);
    const v = checkDesign(proto, s, d);
    for (const x of v.findings) seen.add(x.rule);
    check(`design defect: ${label}`, v.verdict === "block" && same(fired(v), expect) && v.findings.every((x) => x.severity === "high" && x.confidence === "certain" && x.evidence && x.remedy), fired(v).join(" "));
  };
  defect("a designed screen the prototype does not have — and the claimed one it displaced is undesigned", (d) => { d.screens[1].screen_ref = "SCREEN-9"; }, ["screen-unknown@SCREEN-9", "screen-undesigned@SCREEN-2"]);
  defect("a designed screen no story claims", (d, s) => { s.stories[1].screen_refs = []; }, ["screen-unclaimed@SCREEN-2"]);
  defect("a claimed screen with no design", (d) => { d.screens = [d.screens[0]]; }, ["screen-undesigned@SCREEN-2"]);
  defect("a screen designed twice", (d) => { d.screens.push(structuredClone(d.screens[0])); }, ["screen-designed-twice@SCREEN-1"]);
  defect("a hero on a screen the design does not hold", (d) => { d.standard.heroes[0].screen_ref = "SCREEN-9"; }, ["hero-unknown@SCREEN-9"]);
  check("every rule the writer is told is checked elsewhere fires on some defect, and nothing else does", same([...seen], DESIGN_RULES), `${[...seen].sort()} vs ${[...DESIGN_RULES].sort()}`);
  const s9 = structuredClone(stories);
  s9.stories[0].screen_refs = ["SCREEN-1", "SCREEN-9"];
  check("a story claiming a screen the prototype lacks is the backlog's defect, not the design's — nothing fires here", checkDesign(proto, s9, doc).findings.length === 0);

  const empty = skeleton("design");
  check("the design skeleton is derived and validates; the hash covers the standard, the tokens, the stylesheet and the screens; nothing is signed by default",
    validate("design", empty).ok && empty["x-drift-checked"].join() === "/standard,/tokens,/stylesheet,/screens" && !("signoff" in empty));
  const signed = structuredClone(doc);
  signed.signoff = { by: "Ana", at: "t", content_hash: doc.meta.content_hash, review: { gate: DESIGN_REVIEW, verdict: "pass" } };
  signed.notes = "different notes";
  stamp(signed);
  const recoloured = structuredClone(doc);
  recoloured.tokens["color-pen"] = "#a02018";
  stamp(recoloured);
  check("a signature and notes do not move the hash; one token does — the design is one document, and a changed palette stales all of it",
    signed.meta.content_hash === doc.meta.content_hash && recoloured.meta.content_hash !== doc.meta.content_hash && validate("design", signed).ok);
  const contract = outputContract("design");
  check("the writer's contract on the wire holds the standard and the screens and neither the traces nor the sign-off",
    same(Object.keys(contract.properties), ["standard", "tokens", "stylesheet", "screens", "notes", "open_questions"]) && contract.properties.standard.required.join() === "direction,heroes,commitments");
});

// ── the design runner: a writer that declares its standard, a reviewer that holds it to it, a person who signs ──
await withRoot({}, async (parent) => {
  const bare = seedProject(parent, { slug: "bare" });
  const none = scripted({ structured: DESIGN });
  const noProto = await refusal(() => write({ root: bare, _query: none.query }));
  seedPrototype(bare);
  const noStories = await refusal(() => write({ root: bare, _query: none.query }));
  const noDesign = await refusal(() => review({ root: bare, _query: none.query }));
  const noSign = refuse(() => signoff(bare, { by: "Ana" }));
  check("no prototype, no design; no backlog, no design; no design, nothing to review or sign — all refused before any call",
    noProto?.code === "no-prototype" && noStories?.code === "no-stories" && noDesign?.code === "no-design" && noSign?.code === "no-design" && none.calls.length === 0, `${noProto?.code} ${noStories?.code} ${noDesign?.code} ${noSign?.code}`);
  const p = loadPrd(bare);
  p.mvp = { line: "", inside: [], past: [] };
  savePrd(bare, p);
  const noLine = await refusal(() => write({ root: bare, _query: none.query }));
  check("no line, no design", noLine instanceof Refused && noLine.code === "no-line" && none.calls.length === 0, noLine?.message);

  const root = seedProject(parent);
  const proto = seedPrototype(root);
  const stories = seedStories(root);
  answer({ root, req: "REQ-1", oq: "OQ-1", answer: "No — the door closes the record when the truck leaves.", criterion: "An exception cannot be recorded against a delivery marked departed.", by: "Brad" });
  const prd = loadPrd(root);

  const q = scripted({ structured: DESIGN, toolUses: [{ name: "Read", input: { file_path: HTML_FILE } }] });
  const out = await write({ root, _query: q.query });
  const o = q.calls[0].options;
  check("the writer composes: Read/Glob/Grep only, no edits accepted, the design contract as its output format, billed to discovery.writer",
    q.calls.length === 1 && eq(o.tools, ["Read", "Glob", "Grep"]) && o.permissionMode === "default" && eq(o.outputFormat, { type: "json_schema", schema: outputContract("design") }) && out.model === "claude-opus-5", JSON.stringify({ tools: o.tools, mode: o.permissionMode }));
  check("its system prompt is the design writer's identity — declare the standard, then the craft floor — plus the contract naming the standard's fields, scope, the ruling and every arithmetic rule as checked elsewhere",
    /^# Design writer/.test(o.systemPrompt) && /## Declare your standard before you draw a screen/.test(o.systemPrompt) && /## The craft floor/.test(o.systemPrompt) && /`\/standard\/commitments`/.test(o.systemPrompt) && !/`\/signoff/.test(o.systemPrompt) && !/`\/traces/.test(o.systemPrompt) &&
    /## Scope/.test(o.systemPrompt) && /RUL-1/.test(o.systemPrompt) && /## Checked elsewhere/.test(o.systemPrompt) && DESIGN_RULES.every((r) => o.systemPrompt.includes(r)), o.systemPrompt.slice(-600));
  check("its prompt is the PRD with its surfaces and their kind, the prototype with the file to read, the stories per screen — and nothing about a previous design on a first write",
    /## Surfaces inside the line\n\n- \*\*SURF-1\*\* \(handheld web app\)/.test(q.calls[0].prompt) && !/SURF-2/.test(q.calls[0].prompt) && /REQ-1\/AC-3/.test(q.calls[0].prompt) && q.calls[0].prompt.includes(`The prototype itself is at \`${HTML_FILE}\``) &&
    /## Stories — what happens on each screen\n\nEpics:[\s\S]*### STORY-1 \(EPIC-1\)[\s\S]*screens SCREEN-1/.test(q.calls[0].prompt) && !/## The previous design's standard/.test(q.calls[0].prompt) && !/## Existing control ids/.test(q.calls[0].prompt) && !/## The reviewer's findings/.test(q.calls[0].prompt));
  const doc = readDoc(root, DESIGN_FILE);
  check("the design is written by the runner: traced to the PRD, the prototype and the backlog by hash, stamped, verifying, unsigned, and it is what came back",
    doc.id === "design-dock" && doc.traces.prd.content_hash === prd.meta.content_hash && doc.traces.prd.version === "0.2.0" && doc.traces.prototype.content_hash === proto.meta.content_hash && doc.traces.stories.content_hash === stories.meta.content_hash &&
    eq(doc.screens, DESIGN.screens) && eq(doc.standard, DESIGN.standard) && validate("design", doc).ok && verify(doc).verdict === "pass" && !("signoff" in doc) && eq(out.design, doc), JSON.stringify(doc.traces));
  const badge = staleness(root).design;
  check("the badge: not stale, nothing moved, unsigned", badge && !badge.stale && !badge.prd_moved && !badge.prototype_moved && !badge.stories_moved && badge.signed === false, JSON.stringify(badge));
  const arith = readVerdict(root, DESIGN_GATE);
  check("the arithmetic verdict is filed with four pins — PRD, prototype, stories, design — passes and is fresh",
    arith.judged.length === 4 && arith.judged[3].content_hash === doc.meta.content_hash && arith.verdict === "pass" && freshVerdict(root, DESIGN_GATE) !== null && eq(out.arithmetic, arith), JSON.stringify(arith.judged.map((j) => j.id)));

  for (const tool of ["Write", "Edit", "Bash"]) {
    const e = await refusal(() => write({ root, _query: scripted({ structured: DESIGN, toolUses: [tool] }).query }));
    check(`a writer that used ${tool} is refused — it composes, the runner writes`, e instanceof Refused && e.code === "wrote" && e.message.includes(tool), e?.message);
  }
  const silent = await refusal(() => write({ root, _query: scripted({}).query }));
  check("no structured answer is refused", silent instanceof Refused && silent.code === "no-structured-output", silent?.message);
  const wrong = await refusal(() => write({ root, _query: scripted({ structured: { ...DESIGN, standard: { direction: "clean and modern" } } }).query }));
  check("a design that does not fit the contract — a standard with no heroes and no commitments — is refused naming the fields", wrong instanceof Refused && wrong.code === "design-invalid" && wrong.detail.some((d) => /heroes|commitments/.test(d)), wrong?.message);
  check("nothing refused reached the record", eq(readDoc(root, DESIGN_FILE), doc));

  // A rewrite: the previous standard and its control ids ride in with the PM's notes.
  const q2 = scripted({ structured: DESIGN });
  await write({ root, notes: "Bigger chips; a glove has to hit them.", _query: q2.query });
  check("a rewrite is shown the previous design's standard, its control ids to keep, and the PM's notes",
    /## The previous design's standard[\s\S]*Direction: A clipboard at a loading door[\s\S]*Commitments:\n- Two families/.test(q2.calls[0].prompt) && /## Existing control ids[\s\S]*- SCREEN-1 `record-exception` button "Record the exception"[\s\S]*- SCREEN-2 `delivery-row` link/.test(q2.calls[0].prompt) && /## The PM's notes\n\nBigger chips/.test(q2.calls[0].prompt));

  // The arithmetic is the gate's, not the writer's: a design missing a claimed screen is written, found, and cannot be signed.
  const q3 = scripted({ structured: { ...DESIGN, screens: [DESIGN.screens[0]] } });
  const out3 = await write({ root, _query: q3.query });
  check("a design missing a claimed screen is written and then found — the arithmetic blocks on screen-undesigned", out3.arithmetic.verdict === "block" && fired(out3.arithmetic).join() === "screen-undesigned@SCREEN-2" && eq(readVerdict(root, DESIGN_GATE), out3.arithmetic), fired(out3.arithmetic).join(" "));
  const notAdding = refuse(() => signoff(root, { by: "Ana Ruiz" }));
  check("nobody signs a design that does not add up — refused with the arithmetic's findings", notAdding?.code === "arithmetic-blocked" && notAdding.detail.length === 1, notAdding?.message);
  await write({ root, _query: scripted({ structured: DESIGN }).query });

  // The sign-off door before any review.
  const absent = refuse(() => signoff(root, { by: "Ana Ruiz" }));
  check("no reviewer verdict, no signature — review-absent, and it says none was ever filed", absent?.code === "review-absent" && absent.detail === "none", absent?.message);
  const anon = refuse(() => signoff(root, { by: "  " }));
  check("a sign-off is a named person's word — no name, no signature", anon?.code === "no-author");

  // The reviewer: three findings — one re-raises the ruling by id, one breaks a declared commitment, one advises.
  const findings = [
    finding("SCREEN-1", "high", "certain", { rule: "standard-not-kept", evidence: "commitment \"weights 400 and 600 only\"; stylesheet sets font-weight:700 on the record button" }),
    finding("RUL-1", "high", "certain", { rule: "decides-an-open-question", summary: "the recorded state should say whether the truck has left" }),
    finding("SCREEN-2", "medium", "likely", { rule: "hero-spend" }),
  ];
  const r = scripted({ structured: { findings, deferred: [], checked: 2, skipped: 0 }, toolUses: [{ name: "Read", input: { file_path: HTML_FILE } }] });
  const verdict = await review({ root, _query: r.query });
  const ro = r.calls[0].options;
  check("the reviewer is a judge: Read/Glob/Grep, the finding contract, billed to discovery.reviewer; its identity is the design reviewer's — the declared standard first — with the ruling and the arithmetic as checked elsewhere",
    eq(ro.tools, ["Read", "Glob", "Grep"]) && eq(ro.outputFormat, { type: "json_schema", schema: outputContract("finding") }) && verdict.cost.model === "claude-opus-5" && /^# Design reviewer/.test(ro.systemPrompt) && /`standard-not-kept`/.test(ro.systemPrompt) && /RUL-1/.test(ro.systemPrompt) && DESIGN_RULES.every((x) => ro.systemPrompt.includes(x)) &&
    readFileSync(ledgerPath(root), "utf8").trim().split("\n").map((l) => JSON.parse(l)).at(-1).role === "reviewer", ro.systemPrompt.slice(0, 200));
  check("it is shown the declared standard before anything else, then the requirements, vocabulary, surfaces with their kind, prototype screens, stories, and the design whole — tokens, stylesheet, each screen's structure, states and controls",
    /^## The declared standard\n\nDirection: A clipboard at a loading door/.test(r.calls[0].prompt) && /## Requirements inside the line[\s\S]*REQ-1\/AC-3/.test(r.calls[0].prompt) && /## Vocabulary[\s\S]*\*\*exception\*\*/.test(r.calls[0].prompt) &&
    /## Surfaces inside the line — where each screen is read\n\n- \*\*SURF-1\*\* \(handheld web app\)/.test(r.calls[0].prompt) && !/SURF-2/.test(r.calls[0].prompt) && /## Prototype screens[\s\S]*SCREEN-2/.test(r.calls[0].prompt) && /## Stories[\s\S]*### STORY-2/.test(r.calls[0].prompt) &&
    /## Design\n\nTokens:\n- font-display: Source Serif 4[\s\S]*- space-unit: 8[\s\S]*```css\n:root\{--paper[\s\S]*### SCREEN-1 — Recording an exception\n\nRead: Held one-handed[\s\S]*States:\n- \*\*choosing\*\*: [\s\S]*- \*\*recorded\*\* \(recording\): [\s\S]*Controls:\n- `reason-chip` chip "Short \/ Damaged \/ Wrong item"[\s\S]*### SCREEN-2[\s\S]*Writer's notes: Kept the prototype/.test(r.calls[0].prompt), r.calls[0].prompt.slice(0, 300));
  check("the verdict: the re-raise removed and counted, the commitment break blocks, the advice rides along; filed with four pins and fresh",
    verdict.reraised === 1 && verdict.findings.length === 2 && verdict.findings[0].rule === "standard-not-kept" && verdict.verdict === "block" && verdict.judged.length === 4 && eq(readVerdict(root, DESIGN_REVIEW), verdict) && freshVerdict(root, DESIGN_REVIEW) !== null, JSON.stringify(verdict.findings.map((x) => x.rule)));

  // The sign-off door on a block: refused, then overridden by a human's word — on the record, hash unmoved.
  const blocked = refuse(() => signoff(root, { by: "Ana Ruiz" }));
  check("a blocking review is not signed — refused with the findings", blocked?.code === "review-blocked" && blocked.detail.length === 2, blocked?.message);
  const noReason = refuse(() => signoff(root, { by: "Ana Ruiz", override: { reason: " " } }));
  check("an override needs a reason", noReason?.code === "review-blocked");
  const signedAt = new Date("2026-09-05T10:00:00Z");
  const over = signoff(root, { by: "Ana Ruiz", note: "The 700 is one declaration; fixed at build.", override: { reason: "The direction is right; the weight slip is a token, not a design." }, _now: () => signedAt });
  const after = readDoc(root, DESIGN_FILE);
  const flag = loadPrd(root).flags.at(-1);
  check("a human's word overrides: the design carries who, when, the review's verdict and the reason; its hash did not move; it validates and verifies; the badge says signed",
    over.signed && after.signoff.by === "Ana Ruiz" && after.signoff.at === signedAt.toISOString() && after.signoff.content_hash === after.meta.content_hash && after.signoff.review.gate === DESIGN_REVIEW && after.signoff.review.verdict === "block" &&
    after.signoff.override.reason.startsWith("The direction is right") && after.meta.content_hash === doc.meta.content_hash && validate("design", after).ok && verify(after).verdict === "pass" && staleness(root).design.signed === true, JSON.stringify(after.signoff));
  check("the override is on the PRD as an override flag under the design section, naming the signer and the reason", flag.kind === "override" && flag.section === "design" && /design signed by Ana Ruiz over a BLOCK from design-reviewer: The direction is right/.test(flag.note) && flag.at === signedAt.toISOString(), JSON.stringify(flag));
  check("signing moved nothing the reviewer pinned — the verdict is still fresh", freshVerdict(root, DESIGN_REVIEW) !== null && freshVerdict(root, DESIGN_GATE) !== null);

  // A rewrite is a new design: the fresh verdict rides in, the signature stays behind, the verdict goes stale.
  const q4 = scripted({ structured: { ...DESIGN, tokens: { ...DESIGN.tokens, "color-pen": "#a02018" } } });
  await write({ root, _query: q4.query });
  check("a fresh reviewer verdict rides into the rewrite, findings first and their authority stated, without the re-raise",
    /## The reviewer's findings on the previous design\n\nThe design-reviewer gate returned BLOCK on the previous version/.test(q4.calls[0].prompt) && /1\. \[high\/certain\] standard-not-kept — SCREEN-1/.test(q4.calls[0].prompt) && !/RUL-1/.test(q4.calls[0].prompt.split("## The reviewer's findings")[1]));
  const redone = readDoc(root, DESIGN_FILE);
  const rebadge = staleness(root).design;
  check("the rewrite is unsigned, its hash moved, the review verdict is no longer fresh though its file is there, and the badge says unsigned and not stale",
    !("signoff" in redone) && redone.meta.content_hash !== after.meta.content_hash && freshVerdict(root, DESIGN_REVIEW) === null && existsSync(join(root, "discovery", "reviews", `${DESIGN_REVIEW}.json`)) && rebadge.signed === false && !rebadge.stale, JSON.stringify(rebadge));
  const stale = refuse(() => signoff(root, { by: "Ana Ruiz" }));
  check("a stale verdict is nothing — review-absent, and it says the one on file is stale", stale?.code === "review-absent" && stale.detail === "stale", stale?.message);

  // A clean review is signed plainly; a ruling afterwards stales the design but not the signature.
  const cleanReview = await review({ root, _query: scripted({ structured: { findings: [], deferred: [], checked: 2, skipped: 0 } }).query });
  const plain = signoff(root, { by: "Ana Ruiz", override: { reason: "not needed" } });
  const plainFlag = loadPrd(root).flags.at(-1);
  check("a passing review is signed without an override even when a reason is offered — a note flag on the PRD, no override on the design",
    cleanReview.verdict === "pass" && plain.signed && !("override" in plain.design.signoff) && plain.design.signoff.review.verdict === "pass" && plainFlag.kind === "note" && /design signed by Ana Ruiz \(design-reviewer pass\)/.test(plainFlag.note), JSON.stringify(plainFlag));
  answer({ root, req: "REQ-2", oq: "OQ-2", answer: "The receiving lead.", by: "Brad" });
  const moved = staleness(root).design;
  check("a ruling after sign-off: the design wears the badge naming RUL-2 and stays signed — the signature is on this content; whether it needs redoing is the PM's call",
    moved.stale && moved.prd_moved && !moved.stories_moved && moved.since.join() === "RUL-2" && moved.signed === true, JSON.stringify(moved));
  check("every call went through the script and the ledger holds them all", readFileSync(ledgerPath(root), "utf8").trim().split("\n").length === 1 + 3 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1);
});

// ── R2 in Delivery: the binding is held to the signed design and the sliced work items ──
// The arithmetic runs before any judge: every item bound once, every control the design's,
// every criterion tested by its own item, the shared interfaces written once. A binding
// that does not add up blocks with the line quoted and no model is asked (R1).
await withRoot({}, async (tmp) => {
  const { cold, handoff } = await seedDelivery(tmp);
  const { record } = intake(cold, { now: new Date("2026-09-06T09:05:00Z") });
  const design = handoff.design;
  const clone = () => JSON.parse(JSON.stringify(BINDING));
  const rules = (v) => [...new Set(v.findings.map((f) => f.rule))].sort().join();
  const emitted = new Set();
  const held = (doc) => { const v = checkBinding(record, design, doc); v.findings.forEach((f) => emitted.add(f.rule)); return v; };

  const clean = held(clone());
  check("a binding that adds up passes with nothing to say — three items and three work items checked, the gate named, the shape a verdict's",
    clean.verdict === "pass" && clean.findings.length === 0 && clean.checked === 6 && clean.gate === SDD_GATE && validate("finding", clean).ok, JSON.stringify(clean.findings));

  let doc = clone(); doc.items[0].controls.push({ screen_ref: "SCREEN-1", control: "submit" });
  let v = held(doc);
  check("a control the signed design does not carry blocks, naming the screen's controls so the writer can see the vocabulary",
    v.verdict === "block" && rules(v) === "control-not-in-design" && /`reason-chip`, `record-exception`; `submit` is not among them/.test(v.findings[0].evidence), JSON.stringify(v.findings));
  doc = clone(); doc.items[1].controls[0].screen_ref = "SCREEN-9";
  check("a control on a screen the design does not have blocks the same way", rules(held(doc)) === "control-not-in-design");

  doc = clone(); doc.items[0].tests.pop();
  v = held(doc);
  check("a criterion the item carries and no test proves blocks, quoting the criterion's statement",
    v.verdict === "block" && rules(v) === "criterion-untested" && v.findings[0].subject === "REQ-1/AC-2" && /REQ-1\/AC-2: /.test(v.findings[0].evidence), JSON.stringify(v.findings));
  doc = clone(); doc.items[1].tests[0].proves = ["REQ-1/AC-1"];
  v = held(doc);
  check("a test proving another item's criterion is a finding on the test and leaves its own criterion untested — two rules, both blocking",
    v.verdict === "block" && rules(v) === "criterion-not-on-item,criterion-untested" && v.findings.find((f) => f.rule === "criterion-not-on-item").subject === "T-3", JSON.stringify(v.findings.map((f) => [f.rule, f.subject])));

  doc = clone(); doc.items.pop();
  v = held(doc);
  check("a work item with no binding blocks — REQ-4, the requirement item with no screen, is still an item to bind",
    v.verdict === "block" && rules(v) === "item-unbound" && v.findings[0].subject === "REQ-4");
  doc = clone(); doc.items.push({ ...clone().items[1], work_item: "STORY-9", tests: [] });
  check("an item the intake does not carry is unknown, and nothing under it is counted as bound", rules(held(doc)) === "item-unknown");
  doc = clone(); doc.items.push(clone().items[1]);
  v = held(doc);
  check("the same work item bound twice is a finding, and its repeated test id is another", rules(v) === "item-bound-twice,test-id-duplicate" && v.findings.find((f) => f.rule === "test-id-duplicate").summary === "T-3 appears twice on STORY-2.");
  doc = clone(); doc.items[1].tests[0].id = "T-1";
  check("test ids are one namespace across the set", rules(held(doc)) === "test-id-duplicate" && /used by STORY-1 and STORY-2/.test(held(doc).findings[0].summary));
  doc = clone(); doc.items[0].tests[0].scenario = "STORY-1/7";
  check("a test naming a scenario the item does not run blocks; null is allowed (REQ-4's test carries none and passes)", rules(held(doc)) === "scenario-unknown" && clean.findings.length === 0);

  doc = clone(); doc.items[1].interfaces[0].signature = "forShift(shift: Shift): Promise<Delivery[]>";
  v = held(doc);
  check("a shared interface written two ways blocks with both signatures quoted — the arithmetic compares them character for character",
    v.verdict === "block" && rules(v) === "interface-disagrees" && /STORY-1: `forShift\(shift_id: string\): Delivery\[\]` · STORY-2: `forShift\(shift: Shift\)/.test(v.findings[0].evidence), v.findings[0]?.evidence);
  doc = clone(); doc.items[0].interfaces[1].shared = false;
  v = held(doc);
  check("an interface two items name that one marks as its own advises, medium — it does not block, and the judge still runs",
    v.verdict === "advise" && rules(v) === "interface-unshared" && v.findings[0].severity === "medium" && v.findings[0].subject === "STORY-1", JSON.stringify(v.findings));
  doc = clone(); doc.items[2].interfaces[0].shared = true;
  check("an interface marked shared that no other item names advises the other way", rules(held(doc)) === "interface-unshared" && /no other item names it/.test(held(doc).findings[0].summary));

  v = held({ items: [], questions: [] });
  check("an empty binding is every work item unbound — three findings, the work items still counted", v.findings.length === 3 && rules(v) === "item-unbound" && v.checked === 3);
  check("every rule the arithmetic can emit is declared to the writer and the judge as arithmetic, and nothing declared is idle",
    [...emitted].every((r) => SDD_RULES.includes(r)) && SDD_RULES.every((r) => emitted.has(r)), `emitted ${[...emitted].sort().join()} · declared ${[...SDD_RULES].sort().join()}`);

  const judge = identity(join(ROOT, "delivery", "sdd", "prompts", "judge.md"));
  check("R10: the judge's one falsification deferral is asked in the identity with the word the runner keys on — exactly one, never a finding, `beyond` = untested",
    judge.includes(`\`beyond\` set to the word \`${UNTESTED}\``) && /Exactly one, in `deferred`/.test(judge) && /never a finding and it never blocks/.test(judge));
  const writer = identity(join(ROOT, "delivery", "sdd", "prompts", "writer.md"));
  check("the writer is told the arithmetic compares signatures verbatim and that the design is the whole control vocabulary",
    /compares the signatures verbatim/.test(writer) && /The design is the whole vocabulary/.test(writer));
});

done();
