#!/usr/bin/env node
// owns: R2, R12 · shared — eval: scope. The MVP line is a gate input: drawn after the
// shape (R12), read by every agent after it as scope (R2), and held to its own
// arithmetic — every committed requirement on one side, nothing named that the document
// lacks. The workshop is exercised end to end on a scripted model: sections open in
// order, a turn writes the transcript and the section state, an extraction fills only
// its section's fields from a contract derived from the PRD schema, and ids stick.

import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { suite, withRoot, scripted } from "./_harness.mjs";
import { skeleton, validate, outputContract, fieldsOf, partialContract } from "../shared/schema/index.mjs";
import { mechanics, namedFields } from "../shared/prompt/index.mjs";
import { verify } from "../shared/hash.mjs";
import { lineDrawn, scopeOf, checkScope } from "../shared/scope.mjs";
import { setupProject } from "../discovery/setup/index.mjs";
import { SECTIONS, LINE_SECTION, indexOf, section } from "../discovery/workshop/sections.mjs";
import { openPrd, loadPrd, savePrd, mayOpen, systemFor, turn, extract, readTranscript, parseReply, captured, progress, WorkshopRefused } from "../discovery/workshop/index.mjs";
import { repoBrief } from "../discovery/workshop/brief.mjs";

const { check, done } = suite("scope · R2 the line is a gate input, R12 shape before scope");

const same = (a, b) => a.length === b.length && [...a].sort().join(" ") === [...b].sort().join(" ");
const REQ = (n, status = "committed") => ({ id: `REQ-${n}`, statement: `s${n}`, type: "functional", done_definition: "d", acceptance_criteria: [{ id: "AC-1", statement: "a" }], status, context: "", flags: [] });
const rulesOf = (v) => v.findings.map((f) => `${f.rule}:${f.subject}`).sort();

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

done();
