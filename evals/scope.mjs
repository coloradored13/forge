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
import { seedProject, seedPrototype, seedStories, seedDesign, DESIGN, seedDelivery, BINDING, seedBuild, builder, roundCtx, put, gitIn, BUILT, BLOCKED } from "./_fixture.mjs";
import { skeleton, validate, outputContract, fieldsOf, partialContract } from "../shared/schema/index.mjs";
import { mechanics, namedFields } from "../shared/prompt/index.mjs";
import { verify, stamp } from "../shared/hash.mjs";
import { lineDrawn, scopeOf, checkScope } from "../shared/scope.mjs";
import { setupProject, ledgerPath } from "../discovery/setup/index.mjs";
import { rows as calls } from "../shared/agent-call/ledger.mjs";
import { SECTIONS, LINE_SECTION, indexOf, section } from "../discovery/workshop/sections.mjs";
import { openPrd, loadPrd, savePrd, mayOpen, systemFor, turn, extract, readTranscript, parseReply, captured, progress, WorkshopRefused } from "../discovery/workshop/index.mjs";
import { repoBrief } from "../discovery/workshop/brief.mjs";
import { Refused, readDoc, saveDoc, readVerdict, freshVerdict, staleness, DESIGN_FILE, HTML_FILE } from "../discovery/record/index.mjs";
import { answer } from "../discovery/doors/index.mjs";
import { write, review, signoff, checkDesign, GATE as DESIGN_GATE, REVIEW_GATE as DESIGN_REVIEW, ARITHMETIC as DESIGN_RULES } from "../discovery/design/index.mjs";
import { intake } from "../delivery/intake/index.mjs";
import { checkBinding, covered, dependenciesOf, buildOrder, renderItem, ARITHMETIC as SDD_RULES, UNTESTED, GATE as SDD_GATE, SDD_FILE } from "../delivery/sdd/index.mjs";
import { scopeOfRevision, carry, CARRIED } from "../delivery/sdd/revise.mjs";
import { round as buildRound, contain, globToRegExp, loadBuild, checkBuild, ARITHMETIC as BUILD_RULES, BRANCH, WORKTREE, BUILD_FILE, VERDICT_FILE as BUILD_VERDICT } from "../delivery/build/index.mjs";
import { INTAKE_FILE } from "../delivery/intake/index.mjs";
import { identity } from "../shared/prompt/index.mjs";
import { ROOT } from "./_harness.mjs";

const { check, done } = suite("scope · R2 the line is a gate input, R12 shape before scope", 173);

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
  check("every call went through the script and the ledger holds them all", calls(ledgerPath(root)).length === 1 + 3 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1);
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

  // The binding's own questions. The writer cannot amend the contract; it asks, and marks
  // the question blocking when a build past it would build the guess in. The schema promises
  // that such a question blocks the stage until a human answers in Discovery or overrides on
  // the record — the door has to read them for that to be true.
  doc = clone(); doc.questions = [{ subject: "STORY-2", question: "Does withdrawing a delivery free its slot for the rest of the shift? REQ-1/AC-2 refuses a duplicate and says nothing about withdrawal.", blocking: true }];
  v = held(doc);
  check("a blocking question on the binding blocks — high and certain, the question quoted as evidence, the remedy Discovery's door, no judge asked; the question is counted as checked",
    v.verdict === "block" && rules(v) === "question" && v.findings[0].severity === "high" && v.findings[0].confidence === "certain" && v.findings[0].subject === "STORY-2" && /free its slot for the rest of the shift/.test(v.findings[0].evidence) && /Answer it in Discovery/.test(v.findings[0].remedy) && v.checked === 7, JSON.stringify(v.findings));
  doc = clone(); doc.questions = [{ subject: null, question: "Should the run sheet read newest-first? The design does not say.", blocking: false }, { subject: "SCREEN-1", question: "Is the reason chip's label the design's final string?", blocking: false }];
  v = held(doc);
  check("questions that do not block advise, low and likely — carried across as questions, the judge still runs; one with no subject is on the binding",
    v.verdict === "advise" && rules(v) === "question" && v.findings.length === 2 && v.findings.every((f) => f.severity === "low" && f.confidence === "likely") && v.findings.map((f) => f.subject).join() === "binding,SCREEN-1", JSON.stringify(v.findings));
  doc = clone(); doc.questions = [{ subject: "REQ-4", question: "Which clock stamps the record — the device's or the server's?", blocking: true }]; doc.items[0].tests.pop();
  v = held(doc);
  check("a blocking question beside an arithmetic miss is one block with both named — the writer answers the miss, the human the question",
    v.verdict === "block" && rules(v) === "criterion-untested,question" && v.findings.filter((f) => f.rule === "question")[0].subject === "REQ-4", rules(v));
  doc = clone(); delete doc.questions;
  check("a binding with no questions field is read as none — the arithmetic does not throw on it", held(doc).verdict === "pass");

  // What an item depends on is derived from the binding, never declared: a control bound
  // on a screen the item does not run on is another item's to wire — the one that runs
  // there and binds it — and an interface named `from` another item is that item's to
  // build. The build order follows. A foreign control nobody wires is a slicing gap; a
  // cycle has no order; both block.
  const ordered = (d) => buildOrder(d, record).order?.map((it) => it.work_item).join() ?? null;
  const ways = (d, id) => dependenciesOf(d, record).deps.get(id).map((x) => `${x.item}:${x.via}`).join();
  doc = clone();
  check("a binding with no foreign controls and no `from` depends on nothing, and the build order is the binding's",
    ["STORY-1", "STORY-2", "REQ-4"].every((id) => ways(doc, id) === "") && dependenciesOf(doc, record).unowned.length === 0 && ordered(doc) === "STORY-1,STORY-2,REQ-4" && buildOrder(doc, record).cycle === null, ordered(doc));
  doc = clone(); doc.items[0].controls.push({ screen_ref: "SCREEN-2", control: "delivery-row" });
  check("a control bound on a screen the item does not run on depends on the item that runs there and binds it, the control as the way; the order follows — STORY-2 before STORY-1, REQ-4 where it was — and the arithmetic passes: a dependency is not a finding",
    ways(doc, "STORY-1") === "STORY-2:SCREEN-2/`delivery-row`" && ways(doc, "STORY-2") === "" && ordered(doc) === "STORY-2,STORY-1,REQ-4" && held(doc).verdict === "pass", `${ways(doc, "STORY-1")} · ${ordered(doc)} · ${rules(held(doc))}`);
  doc = clone(); doc.items[0].interfaces.push({ name: "queue.enqueue", signature: "enqueue(write: Write): void", shared: true, from: "REQ-4" }); doc.items[2].interfaces[0].shared = true;
  check("an interface named `from` another item depends on that item, the interface as the way; the provider names no `from` and depends on nothing; the consumer is built after it",
    ways(doc, "STORY-1") === "REQ-4:`queue.enqueue`" && ways(doc, "REQ-4") === "" && ordered(doc) === "REQ-4,STORY-1,STORY-2" && held(doc).verdict === "pass", `${ways(doc, "STORY-1")} · ${ordered(doc)} · ${rules(held(doc))}`);
  doc.items[0].controls.push({ screen_ref: "SCREEN-2", control: "delivery-row" });
  check("two ways to two items are two dependencies, in the binding's order of the items depended on; the dependents keep their own order after them",
    ways(doc, "STORY-1") === "STORY-2:SCREEN-2/`delivery-row`,REQ-4:`queue.enqueue`" && ordered(doc) === "STORY-2,REQ-4,STORY-1", `${ways(doc, "STORY-1")} · ${ordered(doc)}`);

  for (const [from, why] of [["REQ-9", "no item REQ-9"], ["STORY-2", "STORY-2 does not name"], ["STORY-1", "names itself"]]) {
    doc = clone(); doc.items[0].interfaces.push({ name: "queue.enqueue", signature: "enqueue(write: Write): void", shared: true, from }); doc.items[2].interfaces[0].shared = true;
    v = held(doc);
    check(`\`from\` ${from}: a provider that is no item, one that does not name the interface, or the item itself blocks — interface-from-unknown, the interface and the name quoted (${why})`,
      v.verdict === "block" && rules(v) === "interface-from-unknown" && v.findings[0].subject === "STORY-1" && /`queue\.enqueue`/.test(v.findings[0].summary) && new RegExp(from).test(v.findings[0].summary), JSON.stringify(v.findings));
  }
  doc = clone(); doc.items[0].controls.push({ screen_ref: "SCREEN-2", control: "delivery-row" }); doc.items[1].controls = [];
  v = held(doc);
  check("a control driven on a screen the item does not run on, which no item running there binds, blocks — control-unbound: nobody builds it; the screen's items named",
    v.verdict === "block" && rules(v) === "control-unbound" && v.findings[0].subject === "STORY-1" && /`delivery-row` on SCREEN-2/.test(v.findings[0].summary) && /SCREEN-2 is run on by STORY-2/.test(v.findings[0].evidence) && dependenciesOf(doc, record).unowned.map((u) => `${u.item}:${u.screen_ref}/${u.control}`).join() === "STORY-1:SCREEN-2/delivery-row", JSON.stringify(v.findings));
  doc = clone(); doc.items[0].controls.push({ screen_ref: "SCREEN-2", control: "delivery-row" }); doc.items[1].controls.push({ screen_ref: "SCREEN-1", control: "record-exception" });
  v = held(doc);
  check("two items each driving the other's screen is a cycle — no order builds them — one blocking finding whose subject is the whole ring, so every member is in the revision's scope; the order is null",
    v.verdict === "block" && rules(v) === "dependency-cycle" && v.findings[0].subject === "STORY-1, STORY-2" && /STORY-1 → STORY-2 → STORY-1/.test(v.findings[0].summary) && /SCREEN-2\/`delivery-row`/.test(v.findings[0].evidence) && /SCREEN-1\/`record-exception`/.test(v.findings[0].evidence) && buildOrder(doc, record).order === null && buildOrder(doc, record).cycle.join() === "STORY-1,STORY-2,STORY-1", JSON.stringify(v.findings));
  // The ring above, and the one move that answers it: both ends in one unit. What passed
  // between them is internal, there is no edge left to order, and nothing either story
  // promised is lost — the unit answers for the criteria and scenarios of both.
  doc = clone();
  doc.items[0].controls.push({ screen_ref: "SCREEN-2", control: "delivery-row" });
  doc.items[1].controls.push({ screen_ref: "SCREEN-1", control: "record-exception" });
  const ring = doc.items[1];
  doc.items[0].covers = ["STORY-2"];
  doc.items[0].tests = [...doc.items[0].tests, ...ring.tests];
  doc.items[0].controls = [...doc.items[0].controls, ...ring.controls];
  doc.items = doc.items.filter((it) => it.work_item !== "STORY-2");
  v = held(doc);
  check("a unit covering both ends of a ring has no ring to order: what passed between them is its own to build, the order is whole, and the partition still covers every work item exactly once",
    v.verdict !== "block" && !rules(v).includes("dependency-cycle") && buildOrder(doc, record).order !== null && buildOrder(doc, record).cycle === null
      && doc.items.flatMap(covered).sort().join() === "REQ-4,STORY-1,STORY-2", JSON.stringify({ rules: rules(v), order: buildOrder(doc, record).order?.map((i) => i.work_item) }));
  check("a merged unit still answers for everything it covers: a criterion of the item it absorbed, left untested, blocks on the unit that now owns it",
    (() => { const d = clone(); d.items[0].covers = ["STORY-2"]; d.items = d.items.filter((it) => it.work_item !== "STORY-2"); const r = held(d); return r.verdict === "block" && rules(r).includes("criterion-untested"); })());
  check("covering a work item twice blocks: two units building the same item is two builds of it, neither aware of the other",
    (() => { const d = clone(); d.items[0].covers = ["STORY-2"]; const r = held(d); return r.verdict === "block" && rules(r).includes("item-bound-twice"); })());
  check("an interface naming a work item its own unit already covers blocks — the unit builds it, so there is no provider to name",
    (() => { const d = clone(); d.items[0].covers = ["STORY-2"]; d.items = d.items.filter((it) => it.work_item !== "STORY-2"); d.items[0].interfaces[0] = { ...d.items[0].interfaces[0], from: "STORY-2" }; return rules(held(d)).includes("interface-from-unknown"); })());

  doc = clone(); doc.items.push({ ...clone().items[1], work_item: "STORY-9", tests: [], controls: [{ screen_ref: "SCREEN-1", control: "reason-chip" }] });
  check("an item the intake does not carry is left out of the dependencies — item-unknown is its finding, and the derivation does not throw on it", rules(held(doc)) === "item-unknown" && ordered(doc) === "STORY-1,STORY-2,REQ-4");

  v = held({ items: [], questions: [] });
  check("an empty binding is every work item unbound — three findings, the work items still counted", v.findings.length === 3 && rules(v) === "item-unbound" && v.checked === 3);

  // A regeneration revises what the findings name and what a changed input touches; every
  // other item comes back character for character, and the runner holds the writer to it —
  // the build hashes each item, and a second phrasing of an unchanged item is a rebuild
  // that says nothing.
  const prior = { ...clone(), traces: { intake: { content_hash: record.meta.content_hash } } };
  const F = (rule, subject, summary = "", evidence = "") => ({ severity: "high", confidence: "certain", rule, subject, summary, evidence, remedy: "" });
  const verdictOf = (...findings) => ({ verdict: "block", findings });
  const scoped = (review, priorIntake = record) => scopeOfRevision({ prior, review, intake: record, priorIntake });
  const reasons = (s) => [...s.items].map(([id, why]) => `${id}: ${why.join("; ")}`).join(" · ");
  let scope = scoped(verdictOf(F("test-proves-nothing", "T-2")));
  check("a finding on a test puts the item holding it in scope and nothing else; the reason is the id and the rule that named it",
    scope.all === null && reasons(scope) === "STORY-1: T-2 (test-proves-nothing)", reasons(scope));
  scope = scoped(verdictOf(F("criterion-untested", "REQ-2/AC-1"), F("interface-disagrees", "deliveries.forShift"), F("question", "SCREEN-1")));
  check("a criterion resolves to the items carrying it, an interface name to every item naming it, a screen to the items running there — REQ-4 is named by none and stays out",
    scope.all === null && reasons(scope) === "STORY-2: REQ-2/AC-1 (criterion-untested); deliveries.forShift (interface-disagrees) · STORY-1: deliveries.forShift (interface-disagrees); SCREEN-1 (question)", reasons(scope));
  scope = scoped(verdictOf(F("design-insufficient", "STORY-1 / T-4 (REQ-4/AC-1)"), F("binds-past-the-item", "STORY-2 · T-3")));
  check("a judge's free-form subject resolves every id in it as a token — STORY-1 and T-4 and the criterion, separators ignored — and an id is never read inside a longer one",
    scope.all === null && reasons(scope) === "STORY-1: STORY-1 (design-insufficient) · REQ-4: T-4 (design-insufficient); REQ-4/AC-1 (design-insufficient) · STORY-2: STORY-2 (binds-past-the-item); T-3 (binds-past-the-item)", reasons(scope));
  scope = scoped(verdictOf(F("question", "binding", "Should the run sheet read newest-first? STORY-2 renders arrival order and the design does not say.")));
  check("a subject that names nothing the record knows falls back to the finding's summary and evidence — the item named there is the scope",
    scope.all === null && reasons(scope) === "STORY-2: STORY-2 (question)", reasons(scope));
  scope = scoped(verdictOf(F("question", "binding", "Which clock stamps a record?", "`/questions`")));
  check("a finding that names nothing anywhere widens the scope to every item, and the reason quotes it — a revision never narrows on a guess",
    scope.all !== null && /names nothing the record knows/.test(scope.all) && /"binding"/.test(scope.all) && scope.items.size === 3, scope.all);
  scope = scoped(verdictOf(F("test-proves-nothing", "T-2"), { ...F(CARRIED, "STORY-2"), severity: "low" }));
  check("the carry's own finding does not widen the scope — an item restored last round is not thereby open this round",
    scope.all === null && [...scope.items.keys()].join() === "STORY-1", reasons(scope));
  scope = scoped(verdictOf(F("test-proves-nothing", "T-2"), { ...F("question", "STORY-2", "A question on the binding: which clock?", "`/questions` · subject STORY-2 · which clock?"), severity: "low", confidence: "likely" }, { ...F("question", "binding", "A question on the binding: newest-first?", "`/questions`"), severity: "low", confidence: "likely" }));
  check("a question the writer asked and did not mark blocking asks nothing of the writer: it opens no item and widens nothing — only the blocking one, filed high, is in scope",
    scope.all === null && [...scope.items.keys()].join() === "STORY-1", reasons(scope) || scope.all);
  const ringed = scoped(verdictOf(F("dependency-cycle", "STORY-1, STORY-2", "STORY-1 → STORY-2 → STORY-1: each depends on the next; no order builds them.")));
  check("a cycle's finding puts every member of the ring in scope — the ring is the subject, each id resolved from it",
    ringed.all === null && [...ringed.items.keys()].sort().join() === "STORY-1,STORY-2" && reasons(ringed).includes("STORY-2: STORY-2 (dependency-cycle)"), reasons(ringed));
  const was = JSON.parse(JSON.stringify(record)); was.work_items[1].statement += " Withdrawn deliveries are struck through."; was.meta.content_hash = "0".repeat(64);
  scope = scopeOfRevision({ prior: { ...prior, traces: { intake: { content_hash: was.meta.content_hash } } }, review: verdictOf(F("test-proves-nothing", "T-2")), intake: record, priorIntake: was });
  check("an intake that moved since the previous binding puts the items whose work item changed in scope, beside what the findings name — a changed input touches the item",
    scope.all === null && reasons(scope) === "STORY-1: T-2 (test-proves-nothing) · STORY-2: its work item changed", reasons(scope));
  scope = scopeOfRevision({ prior: { ...prior, traces: { intake: { content_hash: was.meta.content_hash } } }, review: verdictOf(F("test-proves-nothing", "T-2")), intake: record, priorIntake: null });
  check("an intake that moved, with the one the previous binding was bound against not on record, is every item in scope with the reason said", scope.all !== null && /not on record/.test(scope.all), scope.all);
  scope = scoped(verdictOf());
  check("a verdict with no findings and an unchanged intake is a scope of nothing — every item carries", scope.all === null && scope.items.size === 0);
  // A reopen is the one declared scope: the human's reason redoes every item — unless the
  // reopen names the items it is about, and then it is those, the standing verdict's findings
  // opening nothing (it passed), a moved intake still opening what it changed.
  const reopenedAll = scopeOfRevision({ prior, review: verdictOf({ ...F("test-weak", "T-3"), severity: "low", confidence: "likely" }), intake: record, priorIntake: record, reopened: { by: "Brad", reason: "the run sheet is keyed by delivery id" } });
  check("a reopen with no items named is every item in scope, the reason said", reopenedAll.all === "the binding is reopened" && reopenedAll.items.size === 3);
  const reopenedSome = scopeOfRevision({ prior, review: verdictOf({ ...F("test-weak", "T-3"), severity: "low", confidence: "likely" }), intake: record, priorIntake: record, reopened: { by: "Brad", reason: "the run sheet is keyed by delivery id", items: ["STORY-2"] } });
  check("a reopen that names its items is those items and no more — the standing verdict's advisory finding on another item opens nothing, it passed",
    reopenedSome.all === null && reasons(reopenedSome) === "STORY-2: named by the reopen", reasons(reopenedSome) || reopenedSome.all);
  const reopenedMoved = scopeOfRevision({ prior: { ...prior, traces: { intake: { content_hash: was.meta.content_hash } } }, review: verdictOf(), intake: record, priorIntake: was, reopened: { by: "Brad", reason: "again", items: ["REQ-4"] } });
  check("a reopen that names its items, over an intake that moved since the binding, opens the named items and the changed work item both — a changed input is never carried",
    reopenedMoved.all === null && reasons(reopenedMoved) === "REQ-4: named by the reopen · STORY-2: its work item changed", reasons(reopenedMoved) || reopenedMoved.all);

  const inScope = (...ids) => ({ all: null, items: new Map(ids.map((id) => [id, ["named"]])) });
  const carriedFindings = (c) => { c.findings.forEach((f) => emitted.add(f.rule)); return c.findings; };
  doc = clone(); doc.items[1].risks = ["the run sheet's order is the store's — a sort would be a design change"]; doc.items[1].approach += " Rows are keyed by delivery id.";
  let c = carry(prior, doc, inScope("STORY-1"), record);
  check("an item outside the scope that came back different is the previous item again, verbatim, and the churn is one finding — low, certain, the fields that moved named",
    JSON.stringify(c.items[1]) === JSON.stringify(prior.items[1]) && c.items[0] === doc.items[0] && carriedFindings(c).length === 1 && c.findings[0].rule === CARRIED && c.findings[0].severity === "low" && c.findings[0].confidence === "certain" && c.findings[0].subject === "STORY-2" && /approach, risks/.test(c.findings[0].summary) && /carried verbatim/.test(c.findings[0].summary), JSON.stringify(c.findings));
  doc = clone(); doc.items[0].approach = "The form posts to the store; the store exposes no update.";
  c = carry(prior, doc, inScope("STORY-1"), record);
  check("an item in scope comes back as the writer wrote it — no restore, no finding", c.items[0].approach === doc.items[0].approach && c.findings.length === 0);
  doc = clone(); doc.items[0].interfaces[1].signature = "forShift(shift: Shift): Delivery[]"; doc.items[1].interfaces[0].signature = "forShift(shift: Shift): Delivery[]";
  c = carry(prior, doc, inScope("STORY-1"), record);
  check("a shared interface rewritten on a revised item is rewritten on every item naming it, that line only — the carried item takes the line and nothing is filed, so the set still agrees",
    c.items[1].interfaces[0].signature === "forShift(shift: Shift): Delivery[]" && c.items[1].approach === prior.items[1].approach && c.findings.length === 0 && checkBinding(record, design, { items: c.items, questions: [] }).verdict === "pass", JSON.stringify(c.findings));
  doc = clone(); doc.items[0].interfaces.push({ name: "queue.enqueue", signature: "enqueue(write: Write): void", shared: true, from: "REQ-4" }); doc.items[2].interfaces[0].shared = true;
  c = carry(prior, doc, inScope("STORY-1"), record);
  check("a revised item that now consumes another item's interface `from` it may flip that line to shared on the carried provider — the line the set forces, and only that",
    c.items[2].interfaces[0].shared === true && c.findings.length === 0 && checkBinding(record, design, { items: c.items, questions: [] }).verdict === "pass", JSON.stringify(c.findings));
  doc = clone(); doc.items[0].interfaces.push({ name: "queue.enqueue", signature: "enqueue(write: Write): void", shared: true, from: "REQ-4" }); doc.items[2].interfaces[0].shared = true; doc.items[2].risks = ["the queue's durability is the browser's"];
  c = carry(prior, doc, inScope("STORY-1"), record);
  check("the forced line does not open the rest of the item — a risk rewritten beside it is restored and filed",
    c.items[2].interfaces[0].shared === true && c.items[2].risks.length === 0 && carriedFindings(c).length === 1 && /risks/.test(c.findings[0].summary) && !/interfaces/.test(c.findings[0].summary), JSON.stringify(c.findings));
  doc = clone(); doc.items.pop();
  c = carry(prior, doc, inScope("STORY-1"), record);
  check("an item outside the scope that came back missing is restored from the previous binding and filed as missing — the arithmetic never sees a drop the writer had no cause for",
    c.items.length === 3 && c.items[2].work_item === "REQ-4" && carriedFindings(c).length === 1 && /came back missing/.test(c.findings[0].summary), JSON.stringify(c.findings));
  doc = clone(); doc.items[1].risks = ["churn"];
  c = carry(prior, doc, { all: "reopened", items: new Map() }, record);
  check("a scope of everything restores nothing — the writer's binding stands as written", c.items[1].risks[0] === "churn" && c.findings.length === 0);
  check("every rule the arithmetic can emit is declared to the writer and the judge as arithmetic, and nothing declared is idle",
    [...emitted].every((r) => SDD_RULES.includes(r)) && SDD_RULES.every((r) => emitted.has(r)) && SDD_RULES.includes(CARRIED), `emitted ${[...emitted].sort().join()} · declared ${[...SDD_RULES].sort().join()}`);
  const bound = clone().items[0]; bound.interfaces.push({ name: "queue.enqueue", signature: "enqueue(write: Write): void", shared: true, from: "REQ-4" });
  check("an item renders its dependencies to a reader — an interface consumed `from` another item says so on the line; a mark on the heading says what the round may do with it",
    /`queue\.enqueue`: `enqueue\(write: Write\): void` \(shared\) · from REQ-4/.test(renderItem(bound)) && /^### STORY-1 — carry verbatim\n/.test(renderItem(bound, "carry verbatim")) && /^### STORY-1\n/.test(renderItem(bound)), renderItem(bound).slice(0, 300));

  const judge = identity(join(ROOT, "delivery", "sdd", "prompts", "judge.md"));
  check("R10: the judge's one falsification deferral is asked in the identity with the word the runner keys on — exactly one, never a finding, `beyond` = untested",
    judge.includes(`\`beyond\` set to the word \`${UNTESTED}\``) && /Exactly one, in `deferred`/.test(judge) && /never a finding and it never blocks/.test(judge));
  const writer = identity(join(ROOT, "delivery", "sdd", "prompts", "writer.md"));
  check("the writer is told the arithmetic compares signatures verbatim and that the design is the whole control vocabulary",
    /compares the signatures verbatim/.test(writer) && /The design is the whole vocabulary/.test(writer));
  check("the writer is told how a dependency is written — a consumed interface names its provider in `from`; a control a test drives on another item's screen is bound on the screen that holds it — and that the order of the build follows from it",
    /names that item in `from`/.test(writer) && /another item's screen/.test(writer) && /built first/.test(writer) && /hides the dependency/.test(writer), writer.slice(writer.indexOf("## The controls"), writer.indexOf("## The controls") + 900));
  check("the writer is told what a second round is — the items marked to carry come back character for character, the one line the set may move is a shared interface a revised item rewrote, and the runner restores what it changed without cause",
    /## A second round/.test(writer) && /carry verbatim/.test(writer) && /character for character/.test(writer) && /that line and nothing else/.test(writer) && /restored/.test(writer), writer.slice(writer.indexOf("## A second round"), writer.indexOf("## A second round") + 600));
});

// ── R2 in build: the surface is the fence — the change set is held to the binding's globs, and the verdict is arithmetic ──
{
  const g = (glob, paths) => paths.map((p) => (globToRegExp(glob).test(p) ? 1 : 0)).join("");
  check("a trailing `/**` is the directory and everything under it, at any depth; `*` stays in one segment; `**/` is any run of directories or none",
    g("src/exceptions/**", ["src/exceptions", "src/exceptions/store.js", "src/exceptions/a/b.js", "src/exceptionsx", "src/deliveries/x.js"]) === "11100" && g("src/*.js", ["src/a.js", "src/x/y.js", "srcx/a.js"]) === "100" && g("**/*.spec.js", ["a.spec.js", "src/a/b.spec.js", "src/a.js"]) === "110" && g("**", ["anything/at/all"]) === "1");
  const held = contain(["src/exceptions/store.js", "src/exceptions/store.test.js", "src/deliveries/x.js", "forge/run.json", "discovery/prd.json", "README.md"], ["src/exceptions/**"]);
  check("contain: a path inside the surface is fine; outside it is surface-escape; under the record it is record-write, whatever the surface says — in the change set's order",
    held.map((v) => `${v.rule}:${v.path}`).join() === "surface-escape:src/deliveries/x.js,record-write:forge/run.json,record-write:discovery/prd.json,surface-escape:README.md", JSON.stringify(held));
  check("a surface that names the record does not license writing there", contain(["forge/x"], ["forge/**", "**"]).map((v) => v.rule).join() === "record-write");
}

/** Every rule the build rounds below raised — checked against the declared arithmetic at the end. */
const emitted = new Set();

await withRoot({}, async (tmp) => {
  const { cold, sdd } = await seedBuild(tmp, { files: { "README.md": "# Dock\n", "src/index.js": "export {};\n" } });
  const wt = join(cold, WORKTREE);
  const main = gitIn(cold, ["rev-parse", "main"]);
  const branchLog = () => gitIn(cold, ["log", "--format=%an|%s", BRANCH]).split("\n");

  // Round 1: STORY-1 writes inside its surface and one file outside it; STORY-2 says built and changes nothing; REQ-4 builds.
  // None depends on another, so each gets its call — a block or a violation is the item's, not the round's.
  const escape = builder([BUILT(), BUILT("Built the run sheet."), BUILT("Queue built.")], {
    0: (cwd) => { put(cwd, "src/exceptions/store.js", "export const record = () => {};\n"); put(cwd, "src/deliveries/x.js", "oops\n"); },
    2: (cwd) => put(cwd, "src/queue/q.js", "y"),
  });
  const r1 = await buildRound(cold, { ...roundCtx(cold), _query: escape.query });
  r1.verdict.findings.forEach((f) => emitted.add(f.rule));
  const [i1, i2, i3] = r1.doc.items;
  check("a change set that leaves the surface fails the item — violated, both paths accounted, the one outside named with its rule, nothing committed — and the round goes on: STORY-2 and REQ-4, which depend on nothing, each got their call",
    r1.verdict.verdict === "block" && i1.status === "violated" && i1.changed.join() === "src/deliveries/x.js,src/exceptions/store.js" && i1.violations.map((v) => `${v.rule}:${v.path}`).join() === "surface-escape:src/deliveries/x.js" && i1.commit === null && i1.base === main && i2.status === "blocked" && i3.status === "built" && escape.calls.length === 3, JSON.stringify(r1.doc.items));
  check("a builder that says built and changed nothing is recorded blocked with the runner's reason — the diff is the control, not the report",
    i2.status === "blocked" && i2.reason === "the builder reported built and changed nothing" && i2.changed.length === 0 && i2.commit === null && i2.base === main, JSON.stringify(i2));
  check("the verdict is arithmetic — no judge, no model on it — one finding per violation and one per block, all certain, pinned to the handoff, the intake record, the binding and the build record; the block's finding names the item and the runner's reason",
    r1.verdict.cost.model === "none" && r1.verdict.cost.usd === 0 && r1.verdict.findings.map((f) => `${f.rule}@${f.subject}`).join() === "surface-escape@STORY-1,builder-blocked@STORY-2" && /changed nothing/.test(r1.verdict.findings[1].summary) && r1.verdict.findings.every((f) => f.confidence === "certain") && r1.verdict.judged.map((j) => j.path).join() === `discovery/handoffs/handoff-v1.json,${INTAKE_FILE},${SDD_FILE},${BUILD_FILE}` && r1.verdict.checked === 3, JSON.stringify(r1.verdict.findings));
  check("the violated work is discarded, not kept: the branch carries REQ-4 over the seed and nothing of STORY-1, the worktree is clean at that commit, and nothing of the escape is on the record but the accounting",
    branchLog().join() === "Forge|REQ-4: Queue built.,Forge|seed" && !existsSync(join(wt, "src", "deliveries")) && !existsSync(join(wt, "src", "exceptions")) && existsSync(join(wt, "src", "queue", "q.js")) && gitIn(wt, ["status", "--short"]) === "" && i3.commit === gitIn(cold, ["rev-parse", BRANCH]), `${branchLog().join(" · ")} · ${gitIn(wt, ["status", "--short"])}`);
  check("the build record validates and traces what it was built from", validate("build", r1.doc).ok && r1.doc.traces.sdd.content_hash === sdd.meta.content_hash && r1.doc.traces.handoff.version === 1 && r1.doc.branch === BRANCH && r1.doc.id === `build-${roundCtx(cold).run.id}`, JSON.stringify(validate("build", r1.doc).errors));

  // Round 2, with the findings: STORY-1 clean; STORY-2 blocks with a reason of its own; REQ-4 stands — no call.
  const again = builder([BUILT(), BLOCKED("the binding's `Delivery` type is in no interface — approach: \"renders one row per delivery\"")], { 0: (cwd) => put(cwd, "src/exceptions/store.js", "export const record = () => {};\n") });

  // ── a builder that runs the suites has not left its surface ──
  // The binding asks builders to write tests; verifying them means running them, and a
  // runner writes beside the product when it does. That output is not source the builder
  // touched — it is the runner's, it is regenerable, and a project using that runner keeps
  // it out of its repository. Forge writes the project's .gitignore (discovery/setup) and
  // Forge chooses the runners (shared/runners), so the output never reaches the change set
  // at all. It blocked a real build before it did: six surface-escapes on one item and
  // eight more cascading from them, for the side effect of proving the tests could fail.
  await withRoot({}, async (tmp2) => {
    const { cold: c2 } = await seedBuild(tmp2, { slug: "kiln", files: { "README.md": "# Kiln\n" } });
    const ran = builder([BUILT(), BUILT("b"), BUILT("c")], {
      0: (cwd) => {
        put(cwd, "src/exceptions/store.js", "export const record = () => {};\n");
        put(cwd, "test-results/.last-run.json", '{"status":"passed"}\n');
        put(cwd, "test-results/tests-browser-a/error-context.md", "# context\n");
        put(cwd, "playwright-report/index.html", "<html></html>\n");
      },
      1: (cwd) => put(cwd, "src/deliveries/store.js", "b"),
      2: (cwd) => put(cwd, "src/queue/q.js", "c"),
    });
    const rRun = await buildRound(c2, { ...roundCtx(c2), _query: ran.query });
    const item = rRun.doc.items[0];
    check("a builder whose test run wrote test-results/ and playwright-report/ is built, not violated — the runner's output is not in the change set, so it cannot read as source outside the surface",
      item.status === "built" && item.changed.join() === "src/exceptions/store.js" &&
      item.violations.length === 0 && rRun.verdict.verdict === "pass",
      JSON.stringify({ status: item.status, changed: item.changed, violations: item.violations, verdict: rRun.verdict.verdict }));

    check("and that output is genuinely on disk — the claim is that it is not accounted, not that it was never written",
      existsSync(join(c2, WORKTREE, "test-results", ".last-run.json")) && existsSync(join(c2, WORKTREE, "playwright-report", "index.html")));
  });
  const r2 = await buildRound(cold, { ...roundCtx(cold, { review: r1.verdict }), _query: again.query });
  r2.verdict.findings.forEach((f) => emitted.add(f.rule));
  const [s1, s2, q4] = r2.doc.items;
  check("a clean change set is committed on the build branch by Forge, the message the item id and the report's first line; the item is built with its commit and its base — the branch's head, where REQ-4 already stands",
    s1.status === "built" && s1.commit && s1.commit !== main && branchLog()[0] === `Forge|STORY-1: ${BUILT().summary.slice(0, 72)}` && s1.changed.join() === "src/exceptions/store.js" && s1.violations.length === 0 && s1.reason === null && s1.base === i3.commit, JSON.stringify([s1, branchLog()]));
  check("an item whose binding and commit both stand is reused for $0 — no call, the same commit — and a builder blocked with a reason is recorded with it, the finding quoting the reason and the report",
    q4.reused === true && q4.commit === i3.commit && s2.status === "blocked" && /Delivery` type/.test(s2.reason) && r2.verdict.findings.map((f) => `${f.rule}@${f.subject}`).join() === "builder-blocked@STORY-2" && /Delivery` type/.test(r2.verdict.findings[0].summary) && /^report:/.test(r2.verdict.findings[0].evidence) && again.calls.length === 2, JSON.stringify(r2.verdict.findings[0]));
  check("the builder's prompt carries the item, its binding exactly, the shared interfaces the other items name, the screens it runs on, the questions the snapshot still carries as not its to decide, and — on a rebuild — the findings on its own previous build: STORY-1 sees its escape, STORY-2 its block",
    /^## Where you are/.test(again.calls[0].prompt) && /## The binding — build exactly this/.test(again.calls[0].prompt) && /## Shared interfaces the other items name/.test(again.calls[0].prompt) && /STORY-2 · `deliveries.forShift`/.test(again.calls[0].prompt) && /## The signed design — the screens this item runs on/.test(again.calls[0].prompt) && /## The findings on the previous build of this item/.test(again.calls[0].prompt) && /surface-escape/.test(again.calls[0].prompt) && /src\/deliveries\/x\.js/.test(again.calls[0].prompt) && !/builder-blocked/.test(again.calls[0].prompt) && /## The findings on the previous build of this item/.test(again.calls[1].prompt) && /changed nothing/.test(again.calls[1].prompt) && !/surface-escape/.test(again.calls[1].prompt), again.calls[0].prompt.slice(0, 600));
  check("the builder's system prompt is the identity plus the writer's mechanics: the scope line, the arithmetic named as checked elsewhere, and the report's contract — status, summary, suggestions, reason, nothing of the runner's",
    /# Builder/.test(again.calls[0].options.systemPrompt) && /## Checked elsewhere[^#]*`surface-escape`[^#]*`record-write`/.test(again.calls[0].options.systemPrompt) && again.calls[0].options.outputFormat.schema.required.join() === "status,summary,suggestions,reason" && !("binding_hash" in again.calls[0].options.outputFormat.schema.properties), again.calls[0].options.systemPrompt.slice(-600));

  // Round 3: STORY-2 builds; the other two stand; the verdict passes; the branch carries one commit per item over the seed, each from the round it built in, and main is untouched.
  const rest = builder([BUILT("Run sheet built: T-3 by id.")], { 0: (cwd) => put(cwd, "src/deliveries/store.js", "x") });
  const r3 = await buildRound(cold, { ...roundCtx(cold, { review: r2.verdict }), _query: rest.query });
  check("every item built: the verdict passes with no findings, the branch is seed → REQ-4 → STORY-1 → STORY-2 — the order they built in, one call this round — and the project's own branch has not moved",
    r3.verdict.verdict === "pass" && r3.verdict.findings.length === 0 && r3.doc.items.map((i) => `${i.work_item}:${i.status}:${i.reused ? 1 : 0}`).join() === "STORY-1:built:1,STORY-2:built:0,REQ-4:built:1" && branchLog().map((l) => l.split("|")[1].split(":")[0]).join() === "STORY-2,STORY-1,REQ-4,seed" && gitIn(cold, ["rev-parse", "main"]) === main && rest.calls.length === 1, branchLog().join(" · "));
  check("the record on disk is the last round's, and the loop's verdict file beside it", loadBuild(cold).items.every((i) => i.status === "built") && readDoc(cold, BUILD_VERDICT).verdict === "pass");

  const builderId = identity(join(ROOT, "delivery", "build", "prompts", "builder.md"));
  check("the builder is told the diff is the control, to commit nothing, to name tests by criterion id, and the design's hooks — data-screen and data-control — which QA will drive by",
    /the diff is the control/.test(builderId) && /Commit nothing/.test(builderId) && /`data-screen`/.test(builderId) && /`data-control`/.test(builderId) && /REQ-5\/AC-1/.test(builderId) && /not an element to invent/.test(builderId));
  check("the builder is told what it depends on was built before it and stands in its checkout — drive it by id, call it as written, build nothing of it, report what does not match",
    /built before you/.test(builderId) && /[Bb]uild nothing of it/.test(builderId) && /a report, not a repair/.test(builderId), builderId.slice(0, 1200));
});

// ── R2 in build: the order is the binding's dependencies — an item after what it drives and calls — and the builder sees what it stands on ──
// No new call: the dependency section is prompt tokens on the calls the round makes anyway (§8).
await withRoot({}, async (tmp) => {
  const binding = JSON.parse(JSON.stringify(BINDING));
  binding.items[0].controls.push({ screen_ref: "SCREEN-2", control: "delivery-row" }); // STORY-1's test reaches the delivery through the run sheet's row
  binding.items[0].interfaces.push({ name: "queue.enqueue", signature: "enqueue(write: Write): void", shared: true, from: "REQ-4" }); // and writes through REQ-4's queue
  binding.items[2].interfaces[0].shared = true;
  const { cold, sdd } = await seedBuild(tmp, { slug: "weir", binding, files: { "README.md": "# Weir\n" } });
  check("the binding with `from` on a consumed interface is the sdd's approved record — the optional field fits the contract", sdd?.items[0].interfaces.at(-1).from === "REQ-4" && roundCtx(cold).run.stages.sdd.status === "approved", JSON.stringify(roundCtx(cold).run.stages.sdd));

  const b = builder([BUILT("Run sheet built."), BUILT("Queue built."), BUILT("Exceptions built.")], { 0: (cwd) => put(cwd, "src/deliveries/store.js", "a"), 1: (cwd) => put(cwd, "src/queue/q.js", "b"), 2: (cwd) => put(cwd, "src/exceptions/store.js", "c") });
  const r = await buildRound(cold, { ...roundCtx(cold), _query: b.query });
  const called = b.calls.map((c) => c.prompt.match(/## The work item\n\n### ((?:STORY|REQ)-\d+) — /)[1]);
  check("items are built after what they depend on — STORY-2 and REQ-4 before STORY-1, the binding's order otherwise — the record in the order built, the round passing",
    called.join() === "STORY-2,REQ-4,STORY-1" && r.doc.items.map((i) => `${i.work_item}:${i.status}`).join() === "STORY-2:built,REQ-4:built,STORY-1:built" && r.verdict.verdict === "pass" && gitIn(cold, ["log", "--format=%s", BRANCH]).split("\n").map((l) => l.split(":")[0]).join() === "STORY-1,REQ-4,STORY-2,seed", `${called.join()} · ${JSON.stringify(r.verdict.findings)}`);
  const p = b.calls[2].prompt;
  const section = (prompt, h) => { const i = prompt.indexOf(`## ${h}`); return i < 0 ? "" : prompt.slice(i, prompt.indexOf("\n## ", i + 1) < 0 ? undefined : prompt.indexOf("\n## ", i + 1)); };
  const deps = section(p, "What this item depends on");
  const [s2, q4] = r.doc.items;
  check("the dependent item's builder is shown what it stands on: each dependency with the commit it stands at, the controls this item drives on that item's screen by id — kind and label — the interface it calls as written, and the instruction to build nothing of them",
    deps.includes(`### STORY-2 — built at ${s2.commit.slice(0, 7)}`) && /SCREEN-2 — The run sheet: `delivery-row` link "the delivery"/.test(deps) && deps.includes(`### REQ-4 — built at ${q4.commit.slice(0, 7)}`) && /`queue\.enqueue`: `enqueue\(write: Write\): void`/.test(deps) && /build nothing of them/.test(deps), deps || p.slice(0, 800));
  check("the design slice stays the item's own screens in full — SCREEN-2 is not drawn in STORY-1's design section, and the items that depend on nothing carry no dependency section",
    /### SCREEN-1 — Recording an exception/.test(section(p, "The signed design — the screens this item runs on")) && !/### SCREEN-2/.test(section(p, "The signed design — the screens this item runs on")) && !b.calls[0].prompt.includes("## What this item depends on") && !b.calls[1].prompt.includes("## What this item depends on"), section(p, "The signed design — the screens this item runs on").slice(0, 300));

  // A block lands on the dependencies, not the order: what depends on the blocked item is unbuilt behind it, naming it; what does not is built in the same round.
  const { cold: behind, sdd: behindSdd } = await seedBuild(tmp, { slug: "sluice", binding, files: { "README.md": "# Sluice\n" } });
  const h = builder([BLOCKED("the design has no delivery-row control on SCREEN-2"), BUILT("Queue built.")], { 1: (cwd) => put(cwd, "src/queue/q.js", "b") });
  const rh = await buildRound(behind, { ...roundCtx(behind), _query: h.query });
  rh.verdict.findings.forEach((f) => emitted.add(f.rule));
  check("STORY-2 blocks; REQ-4, which depends on nothing, is built for its call; STORY-1, which depends on both, is unbuilt behind STORY-2 alone — the reason names the blocked dependency and not the built one, and the finding says why it was not attempted",
    rh.doc.items.map((i) => `${i.work_item}:${i.status}`).join() === "STORY-2:blocked,REQ-4:built,STORY-1:unbuilt" && h.calls.length === 2 && rh.doc.items[2].reason === "it depends on STORY-2, which is blocked" && rh.verdict.findings.map((f) => `${f.rule}@${f.subject}`).join() === "builder-blocked@STORY-2,unbuilt@STORY-1" && /after what it depends on/.test(rh.verdict.findings[1].evidence) && rh.verdict.findings[1].summary === "STORY-1 was not built: it depends on STORY-2, which is blocked.", JSON.stringify(rh.verdict.findings));
  const h2 = builder([BUILT("Run sheet built."), BUILT("Exceptions built.")], { 0: (cwd) => put(cwd, "src/deliveries/store.js", "a"), 1: (cwd) => put(cwd, "src/exceptions/store.js", "c") });
  const rh2 = await buildRound(behind, { ...roundCtx(behind, { review: rh.verdict }), _query: h2.query });
  check("the next round builds STORY-2 and then STORY-1 on it, REQ-4 standing; `unbuilt` said nothing about STORY-1's work, so its builder is shown no previous findings — STORY-2's is shown its block",
    rh2.verdict.verdict === "pass" && rh2.doc.items.map((i) => `${i.work_item}:${i.status}:${i.reused ? 1 : 0}`).join() === "STORY-2:built:0,REQ-4:built:1,STORY-1:built:0" && h2.calls.length === 2 && /## The findings on the previous build of this item/.test(h2.calls[0].prompt) && /delivery-row/.test(h2.calls[0].prompt) && !/## The findings on the previous build/.test(h2.calls[1].prompt) && h2.calls[1].prompt.includes(`### STORY-2 — built at ${rh2.doc.items[0].commit.slice(0, 7)}`), `${rh2.doc.items.map((i) => `${i.work_item}:${i.status}`).join()} · ${h2.calls[1]?.prompt.slice(0, 300)}`);

  // A binding that was approved with a cycle in it — before the arithmetic held them — has no order: the round refuses by name before any call.
  const ring = JSON.parse(JSON.stringify(behindSdd));
  ring.items[1].controls.push({ screen_ref: "SCREEN-1", control: "record-exception" });
  saveDoc(behind, SDD_FILE, "sdd", ring);
  const cyc = builder([BUILT()]);
  const refused = await buildRound(behind, { ...roundCtx(behind), _query: cyc.query }).then(() => null, (e) => e);
  check("a cycle in the binding refuses the build round — dependency-cycle, the ring named — and no builder is called", refused?.code === "dependency-cycle" && /STORY-1 → STORY-2 → STORY-1/.test(refused.message) && cyc.calls.length === 0, refused?.message);
});

check("every rule the build's arithmetic can emit is declared to the builder as arithmetic, and the four a round can raise were raised across the rounds above; `binding-moved` is the re-judge's (R5)",
  [...emitted].every((r) => BUILD_RULES.includes(r)) && BUILD_RULES.filter((r) => r !== "binding-moved").every((r) => emitted.has(r) || r === "record-write") && checkBuild({ items: [{ work_item: "STORY-1", status: "violated", base: "b", changed: ["forge/x"], violations: [{ path: "forge/x", rule: "record-write" }], reason: "r", summary: "s" }] }).map((f) => f.rule).join() === "record-write", `emitted ${[...emitted].sort().join()} · declared ${[...BUILD_RULES].sort().join()}`);

done();
