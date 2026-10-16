#!/usr/bin/env node
// owns: R3, R4 · discovery — PR70 at 6235dca: the react door; PR5 settlement/journey stay separate.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join, relative } from "node:path";
import { suite, scripted, withRoot } from "./_harness.mjs";
import { seedProject, seedPrototype, seedStories, project, cancel, put, writeHtml, EPICS, STORIES } from "./_fixture.mjs";
import * as doors from "../discovery/doors/index.mjs";
import { loadPrd, savePrd, PRD_FILE } from "../discovery/workshop/index.mjs";
import { Refused, readDoc, PROTOTYPE_FILE, STORIES_FILE } from "../discovery/record/index.mjs";
import { generate } from "../discovery/prototype/index.mjs";
import { write } from "../discovery/stories/index.mjs";
import { loadProject, ledgerPath, PROJECT_FILE } from "../discovery/setup/index.mjs";
import { rows } from "../shared/agent-call/ledger.mjs";
import { BudgetError } from "../shared/agent-call/index.mjs";
import { names, load, fields, outputContract, validate, validateAgainst } from "../shared/schema/index.mjs";

const { check, done } = suite("discovery-react · 4b contract", 61);
const _now = () => new Date("2026-10-16T17:47:00Z");
const text = "  Please make the explanation clearer.\n", by = "Brad";
const none = { change: null, rationale: "", note: "Presentation only." };
const edit = { change: { criterion: "REQ-1/AC-1", statement: "An exception records a reason and timestamp." }, rationale: "Traceability.", note: "Review this change." };
const paths = ["/change", "/change/criterion", "/change/requirement", "/change/statement", "/rationale", "/note"];
const bytes = (root, file) => existsSync(join(root, file)) ? readFileSync(join(root, file), "utf8") : null;
const tree = (root, dir = "discovery") => !existsSync(join(root, dir)) ? [] : readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
  .filter((f) => f.isFile()).map((f) => { const p = join(f.parentPath, f.name); return [relative(root, p), readFileSync(p, "utf8")]; }).sort();
const seenOf = (root) => ({ prd_hash: loadPrd(root).meta.content_hash, prototype_hash: readDoc(root, PROTOTYPE_FILE)?.meta.content_hash });
const reactionRows = (root) => rows(ledgerPath(root)).filter((r) => r.stage === "reaction");
async function test(label, fn) {
  try { await withRoot({}, async (parent) => { const root = seedProject(parent); seedPrototype(root); await fn(root, parent); }); check(label, true); }
  catch (e) { check(label, false, e.stack); }
}
async function react(root, q, extra = {}) {
  assert.equal(typeof doors.react, "function", "doors.react must be exported");
  return doors.react({ root, by, text, seen: Object.hasOwn(extra, "seen") ? extra.seen : seenOf(root), _query: q.query, _now, ...extra });
}
async function refused(fn, code, pq) {
  let caught;
  await assert.rejects(fn, (e) => {
    caught = e;
    assert.ok(e instanceof Refused); assert.equal(e.code, code);
    assert.equal(e.detail?.text, text); assert.equal(e.detail?.pq, pq); return true;
  });
  return caught;
}
async function build(root, notes = "Notes", questions = [{ question: "Who records the reason?", blocking: true }]) {
  const proto = readDoc(root, PROTOTYPE_FILE);
  const q = scripted({ structured: { screens: proto.screens, uncovered: proto.uncovered, notes, open_questions: questions } });
  return generate({ root, _query: (args) => { writeHtml(root); return q.query(args); } });
}

await test("nullable schema exposes exactly six described paths and accepts both change forms", () => {
  assert.ok(names().includes("reaction"), "reaction schema must exist");
  assert.deepEqual(fields("reaction").map((f) => f.path), paths);
  const schema = load("reaction"), change = schema.properties.change;
  assert.deepEqual(change.type, ["object", "null"]); assert.equal(change.additionalProperties, false);
  assert.equal(change.properties.criterion.pattern, "^REQ-\\d+/AC-\\d+$"); assert.equal(change.properties.requirement.pattern, "^REQ-\\d+$");
  assert.deepEqual(change.required, ["statement"]); assert.equal(schema.additionalProperties, false);
  assert.match(change.description, /null/i); assert.match(change.description, /exactly one/i);
  assert.match(change.properties.statement.$ref, /^prd\.schema\.json#/);
  assert.equal(change.properties.statement.minLength, undefined);
  assert.deepEqual([...schema.required].sort(), ["change", "note", "rationale"]);
  for (const key of ["rationale", "note"]) {
    assert.equal(schema.properties[key].type, "string");
    assert.equal(schema.properties[key].minLength, undefined); assert.equal(schema.properties[key].maxLength, undefined);
  }
  assert.equal(JSON.stringify(schema).includes('"x-runner"'), false);
  for (const value of [none, edit, { ...edit, change: { requirement: "REQ-1", statement: "New criterion." } }])
    assert.ok(validateAgainst(outputContract("reaction"), value).ok);
});

for (const mode of ["no-author", "no-text", "no-prototype", "prototype-stale", "revision-moved", "prototype-seen", "missing-seen", "unknown-question", "already-ruled", "answered-unrebuilt"]) {
  await test(`preflight ${mode}: precedence, no call and no writes`, async (root, parent) => {
    const q = scripted({ structured: none });
    let args = { pq: "PQ-999", seen: { prd_hash: "0".repeat(64), prototype_hash: "0".repeat(64) } };
    if (mode === "no-author" || mode === "no-text") {
      args = { ...args, root: join(parent, "absent"), ...(mode === "no-author" ? { by: " " } : {}) };
      args.text = " "; // no-author must beat no-text, and both must beat reads.
    } else if (mode === "no-prototype") unlinkSync(join(root, PROTOTYPE_FILE));
    else if (mode === "prototype-stale") {
      doors.answer({ root, by, req: "REQ-1", oq: "OQ-1", answer: "Late recording is allowed." });
      args.seen = seenOf(root); // Fresh seen cannot repair stale prototype provenance.
    } else if (mode === "prototype-seen") args.seen = { ...seenOf(root), prototype_hash: "0".repeat(64) };
    else if (mode === "missing-seen") args.seen = undefined;
    else if (mode === "unknown-question") args.seen = seenOf(root);
    else if (mode === "already-ruled" || mode === "answered-unrebuilt") {
      await build(root); doors.answer({ root, by, req: "REQ-1", pq: "PQ-1", answer: "The dock lead records it." });
      if (mode === "already-ruled") await build(root);
      args = { pq: "PQ-1", seen: seenOf(root) };
    }
    const before = tree(root), ledger = bytes(root, relative(root, ledgerPath(root)));
    const code = ["missing-seen", "prototype-seen"].includes(mode) ? "revision-moved" : mode === "answered-unrebuilt" ? "prototype-stale" : mode;
    if (mode === "no-text" || mode === "no-author") await assert.rejects(() => react(root, q, args), (e) => e instanceof Refused && e.code === code && e.detail?.text === " " && e.detail?.pq === args.pq);
    else { const e = await refused(() => react(root, q, args), code, args.pq); if (mode === "already-ruled") assert.match(e.message, /RUL-1/); }
    if (args.root) assert.equal(existsSync(args.root), false, "preflight must not create the missing root");
    assert.equal(q.calls.length, 0); assert.equal(reactionRows(root).length, 0);
    assert.equal(bytes(root, relative(root, ledgerPath(root))), ledger); assert.deepEqual(tree(root), before);
  });
}

const invalid = [
  ["no structured output", undefined], ["null output", null],
  ["both ids", { ...edit, change: { ...edit.change, requirement: "REQ-1" } }],
  ["neither id", { ...edit, change: { statement: "Changed." } }],
  ["malformed criterion", { ...edit, change: { ...edit.change, criterion: "REQ-2" } }],
  ["model id", { ...edit, change: { requirement: "REQ-1", statement: "New.", id: "AC-1" } }],
  ...["change", "rationale", "note"].map((key) => [`missing ${key}`, Object.fromEntries(Object.entries(edit).filter(([k]) => k !== key))]),
  ...["", "   "].map((statement) => [`blank statement ${statement.length}`, { ...edit, change: { ...edit.change, statement } }]),
  ...["", "   "].map((rationale) => [`blank rationale ${rationale.length}`, { ...edit, rationale }]),
  ...["REQ-1/AC-9", "REQ-9/AC-1", "REQ-3/AC-1"].map((criterion) => [criterion, { ...edit, change: { ...edit.change, criterion } }]),
  ...["REQ-9", "REQ-3"].map((requirement) => [requirement, { ...edit, change: { requirement, statement: "New." } }]),
];
for (const [label, structured] of invalid) await test(`invalid editor result: ${label}`, async (root) => {
  const q = scripted({ structured }), before = tree(root);
  await refused(() => react(root, q), structured === undefined ? "no-structured-output" : "reaction-invalid");
  assert.equal(q.calls.length, 1); assert.equal(reactionRows(root).length, 1); assert.deepEqual(tree(root), before);
});

for (const change of ["proposal", "null"]) for (const move of ["agree", "answer", "other-answer", "rebuild", "unlink", "propose"]) {
  await test(`${change}: preserves mid-call ${move}, with prototype check before PRD guard`, async (root) => {
    await build(root, "Notes", [{ question: "Who records the reason?", blocking: true }, { question: "Who names the vendor?", blocking: true }]);
    const originalHash = readDoc(root, PROTOTYPE_FILE).meta.content_hash;
    const q = scripted({ structured: change === "null" ? none : edit }); let saved;
    const _query = (args) => (async function* () {
      if (move === "agree") doors.agree({ root, by });
      if (move === "answer" || move === "other-answer") doors.answer({ root, by, req: "REQ-1", pq: move === "answer" ? "PQ-1" : "PQ-2", answer: "Dock lead." });
      if (move === "rebuild") { await build(root, "Only notes changed."); assert.equal(readDoc(root, PROTOTYPE_FILE).meta.content_hash, originalHash); }
      if (move === "unlink") unlinkSync(join(root, PROTOTYPE_FILE));
      if (move === "propose") doors.propose({ root, by, target: "/open_questions/0/owner", to: "dock lead", rationale: "New owner." });
      saved = tree(root); yield* q.query(args);
    })();
    await refused(() => react(root, q, { _query, pq: "PQ-1" }), ["agree", "propose"].includes(move) ? "prd-changed" : "revision-moved", "PQ-1");
    assert.equal(q.calls.length, 1); assert.equal(reactionRows(root).length, 1); assert.deepEqual(tree(root), saved);
  });
}

for (const linked of [false, true]) await test(`null reaction persists without accepted changes; linked=${linked}`, async (root) => {
  doors.answer({ root, by, req: "REQ-1", oq: "OQ-1", answer: "Late exceptions are recorded." });
  seedPrototype(root);
  if (linked) await build(root, "Important prototype note.", [
    { question: "Who records the reason?", blocking: true },
    { question: "UNLINKED QUESTION SENTINEL", blocking: false },
  ]);
  const seen = seenOf(root); doors.agree({ root, by }); // Agreement bytes must not invalidate seen.
  const before = loadPrd(root), proto = readDoc(root, PROTOTYPE_FILE), protoBytes = bytes(root, PROTOTYPE_FILE);
  const funnel = bytes(root, "forge/discovery/funnel.jsonl"), events = [], q = scripted({ structured: none });
  const result = await react(root, q, { seen, ...(linked ? { pq: "PQ-1" } : {}), onEvent: (e) => events.push(e) });
  const after = loadPrd(root), rx = after.reactions.at(-1);
  assert.deepEqual(result.reaction, rx); assert.deepEqual(result.prd, after);
  assert.equal(result.amendment, null); assert.equal(result.audit, null);
  assert.ok(validate("prd", after).ok); assert.equal(rx.id, "RX-1"); assert.equal(rx.by, by);
  assert.equal(rx.at, _now().toISOString()); assert.equal(rx.text, text); assert.deepEqual(rx.seen, seen);
  assert.equal(rx.proposal, null); assert.deepEqual(rx.screens, []); assert.equal(rx.note, none.note);
  assert.equal(rx.pq, linked ? "PQ-1" : undefined);
  const expected = structuredClone(before); expected.reactions = [...(before.reactions ?? []), rx];
  assert.deepEqual(after, expected); assert.equal(bytes(root, PROTOTYPE_FILE), protoBytes);
  assert.equal(bytes(root, "forge/discovery/funnel.jsonl"), funnel); assert.equal(existsSync(join(root, "discovery/reviews/amendment-audit")), false);
  assert.deepEqual(events, ["· ok"]); assert.equal(q.calls.length, 1);
  const { prompt, options } = q.calls[0];
  assert.deepEqual(options.outputFormat, { type: "json_schema", schema: outputContract("reaction") }); assert.deepEqual(options.allowedTools, []);
  for (const path of paths) assert.ok(options.systemPrompt.includes('`' + path + '`'));
  for (const part of ["Output contract — `reaction`", "The MVP line:", "RUL-1"]) assert.ok(options.systemPrompt.includes(part));
  for (const part of [...proto.screens.flatMap((s) => [s.id, s.name]), proto.notes, text]) assert.ok(prompt.includes(part));
  assert.ok(!prompt.includes(proto.file)); assert.doesNotMatch(prompt, /read it/i);
  if (linked) { assert.ok(prompt.includes("PQ-1")); assert.ok(prompt.includes(proto.open_questions[0].question)); assert.ok(!prompt.includes("UNLINKED QUESTION SENTINEL")); }
  const ledger = reactionRows(root); assert.equal(ledger.length, 1);
  for (const [key, value] of Object.entries({ half: "discovery", stage: "reaction", role: "writer", kind: "extract" })) assert.equal(ledger[0][key], value);
  const writer = scripted({ structured: { epics: EPICS, stories: STORIES, notes: "", open_questions: [] } });
  if (linked) { await assert.rejects(() => write({ root, _query: writer.query }), (e) => e instanceof Refused && e.code === "blocking-question"); assert.equal(writer.calls.length, 0); }
  else { await write({ root, _query: writer.query }); assert.equal(writer.calls.length, 1); }
});

await test("BudgetError propagates without model calls or discovery writes", async (root) => {
  put(root, PROJECT_FILE, JSON.stringify({ ...loadProject(root), budget: 0 }));
  const before = tree(root), q = scripted({ structured: none });
  await assert.rejects(() => react(root, q), (e) => e instanceof BudgetError && e.code === "budget");
  assert.equal(q.calls.length, 0); assert.equal(reactionRows(root).length, 0); assert.deepEqual(tree(root), before);
});
for (const file of [PROJECT_FILE, PRD_FILE]) await test(`missing ${file} propagates existing read refusal`, async (root) => {
  unlinkSync(join(root, file)); const q = scripted({ structured: none }), before = tree(root);
  let expected; try { file === PROJECT_FILE ? loadProject(root) : loadPrd(root); } catch (e) { expected = e; }
  assert.ok(expected);
  await assert.rejects(() => react(root, q, { seen: {} }), (e) => e.constructor === expected.constructor && e.code === expected.code);
  assert.equal(q.calls.length, 0); assert.deepEqual(tree(root), before);
});

// Both sides are trimmed: whitespace in the accepted text must not hide a no-op.
for (const padded of [false, true]) await test(`identical reword is refused; stored whitespace=${padded}`, async (root) => {
  const prd = loadPrd(root), ac = prd.requirements[0].acceptance_criteria[0];
  if (padded) { ac.statement = `  ${ac.statement}  `; savePrd(root, prd); seedPrototype(root); }
  const q = scripted({ structured: { ...edit, change: { ...edit.change, statement: ` ${ac.statement.trim()}\n` } } }), before = tree(root);
  await refused(() => react(root, q), "reaction-invalid");
  assert.equal(q.calls.length, 1); assert.deepEqual(tree(root), before);
});

for (const kind of ["reword", "addition"]) for (const linked of [false, true]) await test(`${kind} persists proposed records and pinned audit; linked=${linked}`, async (root) => {
  const prd = loadPrd(root); prd.requirements[0].acceptance_criteria[1].id = "AC-3";
  savePrd(root, prd); seedPrototype(root); if (linked) await build(root);
  doors.agree({ root, by });
  const before = loadPrd(root), proto = bytes(root, PROTOTYPE_FILE), funnel = bytes(root, "forge/discovery/funnel.jsonl");
  const statement = "  An exception records a reason and timestamp.  ";
  const q = scripted({ structured: { ...edit, change: { [kind === "reword" ? "criterion" : "requirement"]: kind === "reword" ? "REQ-1/AC-1" : "REQ-1", statement } } });
  let stamps = 0;
  const result = await react(root, q, { ...(linked ? { pq: "PQ-1" } : {}), _now: () => { stamps++; return _now(); } });
  const saved = loadPrd(root), rx = saved.reactions.at(-1), a = saved.amendments.at(-1);
  assert.equal(q.calls.length, 1); assert.equal(stamps, 1); assert.ok(validate("prd", saved).ok);
  for (const [field, bad] of [["reaction", "AMD-1"], ["pq", "OQ-1"]]) {
    const malformed = structuredClone(saved); malformed.amendments.at(-1)[field] = bad; assert.equal(validate("prd", malformed).ok, false);
  }
  assert.equal(rx.id, "RX-1"); assert.equal(rx.by, by); assert.equal(rx.text, text); assert.deepEqual(rx.seen, seenOf(root));
  assert.equal(rx.note, edit.note); assert.equal(rx.proposal, a.id); assert.deepEqual(rx.screens, ["SCREEN-1"]);
  assert.equal(a.id, "AMD-1"); assert.equal(a.reaction, rx.id); assert.equal(a.origin, "reaction"); assert.equal(a.by, "editor");
  assert.equal(a.rationale, edit.rationale); assert.equal(a.status, "proposed"); assert.equal(a.at, rx.at); assert.equal(rx.at, _now().toISOString());
  assert.equal(a.pq, linked ? "PQ-1" : undefined); assert.equal(rx.pq, a.pq);
  assert.equal(a.against_hash, before.meta.content_hash); assert.equal(a.against_version, before.meta.version);
  if (kind === "reword") {
    assert.equal(a.target, "/requirements/0/acceptance_criteria/0/statement");
    assert.equal(a.from, before.requirements[0].acceptance_criteria[0].statement); assert.equal(a.to, statement.trim()); assert.equal(a.adds, false);
  } else {
    assert.equal(a.target, "/requirements/0/acceptance_criteria/2"); assert.equal(a.adds, true); assert.ok(!Object.hasOwn(a, "from"));
    assert.deepEqual(a.to, { id: "AC-4", statement: statement.trim() });
  }
  const expected = structuredClone(before); expected.reactions = [...(before.reactions ?? []), rx]; expected.amendments = [...before.amendments, a];
  assert.deepEqual(saved, expected); assert.equal(bytes(root, PROTOTYPE_FILE), proto); assert.equal(bytes(root, "forge/discovery/funnel.jsonl"), funnel);
  const audit = readDoc(root, `discovery/reviews/amendment-audit/${a.id}.json`);
  assert.ok(audit && validate("finding", audit).ok); assert.equal(audit.judged[0].content_hash, saved.meta.content_hash);
  assert.deepEqual(result.reaction, rx); assert.deepEqual(result.amendment, a); assert.deepEqual(result.prd, saved);
  assert.deepEqual(result.audit, audit);
  const writer = scripted({ structured: {} });
  await assert.rejects(() => write({ root, _query: writer.query }), (e) => e instanceof Refused && e.code === "reaction-pending");
  assert.equal(writer.calls.length, 0);
  if (linked) { const pq = readDoc(root, PROTOTYPE_FILE).open_questions[0]; assert.equal(pq.status, "open"); assert.equal(pq.blocking, true); }
});

// Seed through existing runner surfaces so precedence failures reach the future API on main.
for (const mode of ["pending", "no-prototype", "prototype-stale"]) await test(`${mode} precedence with pending reaction and invalid seen/PQ`, async (root) => {
  const { amendment: a } = doors.propose({ root, by, target: "/open_questions/0/owner", to: "dock lead", rationale: "Owner." });
  const prd = loadPrd(root), rx = { id: "RX-1", by, at: _now().toISOString(), text, seen: seenOf(root), proposal: a.id, screens: [], note: "Review." };
  prd.reactions = [rx]; savePrd(root, prd);
  if (mode === "no-prototype") unlinkSync(join(root, PROTOTYPE_FILE));
  if (mode === "prototype-stale") doors.answer({ root, by, req: "REQ-1", oq: "OQ-1", answer: "Late recording is allowed." });
  const q = scripted({ structured: none }), before = tree(root), ledger = bytes(root, relative(root, ledgerPath(root)));
  const e = await refused(() => react(root, q, { seen: {}, pq: "PQ-999" }), mode === "pending" ? "reaction-pending" : mode, "PQ-999");
  if (mode === "pending") { assert.ok(Array.isArray(e.detail.pending)); assert.ok(e.detail.pending.some((r) => r.id === rx.id && r.proposal === a.id)); }
  assert.equal(q.calls.length, 0); assert.equal(bytes(root, relative(root, ledgerPath(root))), ledger); assert.deepEqual(tree(root), before);
});

for (const decision of ["reject", "approve", "null"]) await test(`next reaction after ${decision}; refused call consumes no id`, async (root) => {
  const first = await react(root, scripted({ structured: decision === "null" ? none : edit })), seen = seenOf(root);
  if (decision !== "null") {
    const before = tree(root), q = scripted({ structured: none }), ledger = reactionRows(root).length;
    const e = await refused(() => react(root, q), "reaction-pending");
    assert.ok(e.detail.pending.some((r) => r.id === "RX-1" && r.proposal === "AMD-1"));
    assert.equal(q.calls.length, 0); assert.equal(reactionRows(root).length, ledger); assert.deepEqual(tree(root), before);
    if (decision === "reject") doors.reject({ root, by, id: first.amendment.id, reason: "Keep it." });
    else {
      const r = first.amendment.radius; doors.approve({ root, by, id: first.amendment.id, radius: [...r.criteria, ...r.stories, ...r.screens] });
      seedPrototype(root); // Approval changed accepted meaning; react still requires a current prototype.
    }
  }
  const next = await react(root, scripted({ structured: decision === "reject" ? edit : none }), decision === "null" ? { seen } : {});
  assert.equal(next.reaction.id, "RX-2"); assert.equal(loadPrd(root).reactions.length, 2);
  if (decision === "reject") assert.equal(next.amendment.id, "AMD-2");
});

await test("RX numbering skips gaps; affected screens differ from radius on bookings", async (_root, parent) => {
  const root = await project(parent, [cancel("REQ-1")]);
  seedPrototype(root, { screens: [{ id: "SCREEN-1", name: "Bookings", surface_ref: "SURF-1", req_refs: ["REQ-1"] }], uncovered: [] });
  const prd = loadPrd(root), prior = (id) => ({ id, by, at: _now().toISOString(), text, seen: seenOf(root), proposal: null, screens: [], note: "Presentation." });
  prd.reactions = [prior("RX-1"), prior("RX-3")]; savePrd(root, prd);
  const result = await react(root, scripted({ structured: { ...edit, change: { criterion: "REQ-1/AC-1", statement: "Cancellation immediately releases the reservation." } } }));
  assert.equal(result.reaction.id, "RX-4"); assert.deepEqual(result.reaction.screens, ["SCREEN-1"]); assert.deepEqual(result.amendment.radius.screens, []);
  assert.deepEqual(loadPrd(root).reactions.at(-1), result.reaction);
  doors.reject({ root, by, id: result.amendment.id, reason: "Review both screens." });
  seedPrototype(root, { screens: ["SCREEN-3", "SCREEN-1"].map((id) => ({ id, name: "Bookings", surface_ref: "SURF-1", req_refs: ["REQ-1"] })), uncovered: [] });
  const next = await react(root, scripted({ structured: { ...edit, change: { criterion: "REQ-1/AC-1", statement: "Cancellation immediately releases the reservation." } } }));
  assert.deepEqual(next.reaction.screens, ["SCREEN-3", "SCREEN-1"], "affected screens follow prototype order");
});

for (const rewrite of [false, true]) await test(`radius uses mint-time backlog and displayed acknowledgement approves; rewrite=${rewrite}`, async (root) => {
  doors.agree({ root, by }); seedStories(root);
  const prd = bytes(root, PRD_FILE), proto = bytes(root, PROTOTYPE_FILE), q = scripted({ structured: edit });
  const extra = structuredClone(STORIES[0]); extra.id = "STORY-3";
  extra.statement = "As a dock lead, I want a second way to record a reason, so that it is traceable.";
  let storyBytes, writerCalls = 0;
  const _query = (args) => (async function* () {
    if (rewrite) {
      const writer = scripted({ structured: { epics: EPICS, stories: [...STORIES, extra], notes: "Added another proof.", open_questions: [] } });
      await write({ root, _query: writer.query }); writerCalls = writer.calls.length;
    }
    assert.equal(bytes(root, PRD_FILE), prd); assert.equal(bytes(root, PROTOTYPE_FILE), proto);
    storyBytes = bytes(root, STORIES_FILE); yield* q.query(args);
  })();
  const result = await react(root, q, { _query }), a = result.amendment;
  assert.equal(q.calls.length, 1); assert.equal(writerCalls, rewrite ? 1 : 0); assert.equal(bytes(root, STORIES_FILE), storyBytes);
  assert.deepEqual(a.radius.stories, rewrite ? ["STORY-1", "STORY-3"] : ["STORY-1"]);
  const audit = readDoc(root, `discovery/reviews/amendment-audit/${a.id}.json`);
  assert.equal(audit.checked, 1 + a.radius.criteria.length + a.radius.stories.length + a.radius.screens.length);
  assert.equal(result.audit.checked, audit.checked); assert.equal(audit.judged[0].content_hash, loadPrd(root).meta.content_hash);
  const radius = [...a.radius.criteria, ...a.radius.stories, ...a.radius.screens];
  doors.approve({ root, by, id: a.id, radius });
  assert.equal(loadPrd(root).amendments.at(-1).status, "approved");
  assert.equal(loadPrd(root).requirements[0].acceptance_criteria[0].statement, edit.change.statement);
});

done();
