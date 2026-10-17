#!/usr/bin/env node
// owns: R3, R4 · discovery — DH1a.2 §3: approval settles only its referenced PQ.
import assert from "node:assert/strict";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { suite, scripted, withRoot } from "./_harness.mjs";
import { seedProject, seedPrototype, put } from "./_fixture.mjs";
import * as doors from "../discovery/doors/index.mjs";
import { loadPrd, savePrd, WorkshopRefused } from "../discovery/workshop/index.mjs";
import { Refused, readDoc, saveDoc, rulingsOf, PRD_FILE, PROTOTYPE_FILE } from "../discovery/record/index.mjs";
import { validate } from "../shared/schema/index.mjs";
import { resolve, verify } from "../shared/hash.mjs";

const { check, done } = suite("discovery-settlement · approval by reference", 24);
const _now = () => new Date("2026-10-17T12:00:00Z");
const text = "  Keep a reason and timestamp.\n", statement = "An exception records a reason and timestamp.";
const bytes = (root, file) => existsSync(join(root, file)) ? readFileSync(join(root, file), "utf8") : null;
const pair = (root) => [bytes(root, PRD_FILE), bytes(root, PROTOTYPE_FILE)];
const raw = (root, file, doc) => put(root, file, JSON.stringify(doc, null, 2) + "\n");
const radius = (a) => [...a.radius.criteria, ...a.radius.stories, ...a.radius.screens];
const approve = (root, a, extra = {}) => doors.approve({ root, id: a.id, by: "  Approver  ", radius: radius(a), _now, ...extra });
async function test(label, fn) {
  try { await withRoot({}, async (parent) => { const root = seedProject(parent); await fn(root); }); check(label, true); }
  catch (e) { check(label, false, e.stack); }
}
function prototype(root) {
  seedPrototype(root);
  const proto = readDoc(root, PROTOTYPE_FILE);
  // Same wording on two ids distinguishes reference settlement from wording matching.
  proto.open_questions = ["PQ-1", "PQ-2"].map((id) => ({ id, question: "Who records the reason?", blocking: true, status: "open" }));
  saveDoc(root, PROTOTYPE_FILE, "prototype", proto);
}
async function proposal(root, { addition = false, linked = true, criterion = "REQ-1/AC-1" } = {}) {
  assert.equal(typeof doors.react, "function");
  const prd = loadPrd(root), proto = readDoc(root, PROTOTYPE_FILE);
  const q = scripted({ structured: { change: { [addition ? "requirement" : "criterion"]: addition ? "REQ-1" : criterion, statement }, rationale: "Traceability.", note: "Review." } });
  const out = await doors.react({ root, by: "Reactor", text, ...(linked ? { pq: "PQ-1" } : {}),
    seen: { prd_hash: prd.meta.content_hash, prototype_hash: proto.meta.content_hash }, _query: q.query,
    _now: () => new Date("2026-10-16T10:00:00Z") });
  assert.equal(q.calls.length, 1); return out.amendment;
}

for (const addition of [false, true]) await test(`settles by reference with saved field provenance; addition=${addition}`, async (root) => {
  const initial = loadPrd(root); initial.requirements[0].acceptance_criteria[1].id = "AC-3"; savePrd(root, initial);
  prototype(root); const a = await proposal(root, { addition });
  assert.equal(doors.auditOf(a).verdict, "advise", "undeclared vocabulary remains advisory at approval");
  const linked = loadPrd(root), rx = linked.reactions[0];
  linked.reactions = [{ ...rx, id: "RX-8", text: "First decoy", proposal: null }, rx, { ...rx, id: "RX-9", text: "Last decoy", proposal: null }];
  savePrd(root, linked);
  const proto = readDoc(root, PROTOTYPE_FILE); proto.open_questions.reverse();
  for (const q of proto.open_questions) q.question = "Who records the reason at approval?";
  saveDoc(root, PROTOTYPE_FILE, "prototype", proto);
  const before = loadPrd(root), untouched = structuredClone(proto.open_questions[0]);
  approve(root, a);
  const prd = loadPrd(root), saved = prd.amendments.at(-1), ruling = prd.rulings.at(-1);
  assert.equal(prd.rulings.length, before.rulings.length + 1, "approval must append one settlement ruling");
  assert.deepEqual(ruling, { id: "RUL-1", pq: "PQ-1", question: proto.open_questions[1].question, answer: text.trim(),
    criterion: addition ? "REQ-1/AC-4" : "REQ-1/AC-1", by: "Approver", at: saved.decided.at,
    version: saved.resulting_version, prd_hash: prd.meta.content_hash, amendment: a.id });
  assert.equal(ruling.at, _now().toISOString()); assert.equal(ruling.version, "0.2.0");
  assert.notEqual(ruling.prd_hash, before.meta.content_hash); assert.equal(verify(prd).verdict, "pass");
  assert.equal(validate("prd", prd).ok, true); assert.equal(validate("prototype", readDoc(root, PROTOTYPE_FILE)).ok, true);
  const expected = structuredClone(before.requirements);
  if (addition) expected[0].acceptance_criteria.push({ id: "AC-4", statement });
  else expected[0].acceptance_criteria[0].statement = statement;
  assert.deepEqual(prd.requirements, expected, "settlement references the edit; it adds no extra criterion");
  assert.deepEqual(readDoc(root, PROTOTYPE_FILE).open_questions, [untouched, { ...proto.open_questions[1], status: "answered", ruling: ruling.id }]);
  assert.deepEqual(prd.flags.slice(0, -1), before.flags); assert.equal(prd.flags.length, before.flags.length + 1);
  for (const id of [a.id, ruling.id, "PQ-1"]) assert.ok(prd.flags.at(-1).note.includes(id));
  assert.deepEqual(rulingsOf(prd), [{ id: ruling.id, pq: ruling.pq, question: ruling.question, answer: ruling.answer, criterion: ruling.criterion }]);
});

await test("supersedes only the old ruling and preserves unrelated history", async (root) => {
  const old = doors.answer({ root, req: "REQ-1", question: "Old reason policy?", answer: "Record the reason.", by: "Earlier PM" }).ruling;
  const other = doors.answer({ root, req: "REQ-2", question: "Who sees the run sheet?", answer: "The dock lead.", by: "Earlier PM" }).ruling;
  prototype(root); const a = await proposal(root, { criterion: old.criterion });
  approve(root, a); const prd = loadPrd(root);
  assert.equal(prd.rulings.length, 3, "one new ruling beside the two historical rulings");
  assert.deepEqual(prd.rulings[0], { ...old, superseded_by: a.id }); assert.deepEqual(prd.rulings[1], other);
  assert.equal(prd.rulings[2].id, "RUL-3"); assert.equal(prd.rulings[2].criterion, old.criterion);
  assert.equal(prd.rulings[2].amendment, a.id); assert.equal(Object.hasOwn(prd.rulings[2], "superseded_by"), false);
  for (const id of [old.id, "RUL-3", "PQ-1"]) assert.ok(prd.flags.at(-1).note.includes(id));
});

for (const mode of ["missing-reaction", "dangling-reaction", "no-pq", "unknown-pq", "answered", "no-prototype", "wrong-target"]) {
  await test(`approval without settlement: ${mode}`, async (root) => {
    prototype(root); let a = await proposal(root, { linked: mode !== "no-pq" });
    const prd = loadPrd(root), proto = readDoc(root, PROTOTYPE_FILE);
    if (mode === "wrong-target") {
      // The exported mint permits a linked amendment outside react's two criterion shapes.
      prd.amendments = []; a = doors.mint({ prd, proto, target: "/requirements/0/statement", to: "A dock lead records exceptions.",
        rationale: "Context.", by: "editor", origin: "reaction", reaction: "RX-1", pq: "PQ-1", at: _now().toISOString() }).amendment;
    } else {
      a = prd.amendments.at(-1);
      if (mode === "missing-reaction") delete a.reaction;
      if (mode === "dangling-reaction") a.reaction = "RX-999";
      if (mode === "unknown-pq") proto.open_questions = proto.open_questions.filter((q) => q.id !== a.pq);
      if (mode === "answered") Object.assign(proto.open_questions[0], { status: "answered", ruling: "RUL-99" });
    }
    savePrd(root, prd); saveDoc(root, PROTOTYPE_FILE, "prototype", proto);
    if (mode === "no-prototype") unlinkSync(join(root, PROTOTYPE_FILE));
    const r = doors.radiusOf({ prd, proto: readDoc(root, PROTOTYPE_FILE), target: a.target, from: a.from });
    const before = loadPrd(root), protoBytes = bytes(root, PROTOTYPE_FILE);
    approve(root, a, { radius: radius({ radius: r }) });
    const after = loadPrd(root);
    assert.equal(after.amendments.at(-1).status, "approved"); assert.deepEqual(resolve(after, a.target), a.to);
    assert.deepEqual(after.rulings, before.rulings); assert.equal(bytes(root, PROTOTYPE_FILE), protoBytes);
    assert.equal(after.flags.length, before.flags.length + 1);
  });
}

for (const kind of ["prd", "prototype"]) await test(`invalid ${kind}: validate both records before either write`, async (root) => {
  prototype(root); const a = await proposal(root);
  const file = kind === "prd" ? PRD_FILE : PROTOTYPE_FILE, doc = readDoc(root, file);
  doc.unexpected = "invalid closed-contract property"; raw(root, file, doc);
  assert.equal(validate(kind, doc).ok, false);
  const before = pair(root);
  assert.throws(() => approve(root, a), (e) => e instanceof (kind === "prd" ? WorkshopRefused : Refused) && e.code === `${kind}-invalid`);
  assert.deepEqual(pair(root), before);
});

// Failing a settlement condition never bypasses the ordinary approval guards.
for (const linked of [false, true]) for (const mode of ["movement", "target", "addition-target", "radius", "decided", "author"]) {
  await test(`existing ${mode} guard, settlement eligible=${linked}`, async (root) => {
    prototype(root); const a = await proposal(root, { linked, addition: mode === "addition-target" });
    const prd = loadPrd(root); let extra = {}, code;
    if (mode === "movement") { prd.problem.crux += " changed"; savePrd(root, prd); code = "prd-moved"; }
    if (mode === "target") { prd.amendments.at(-1).from = "Not the current criterion"; savePrd(root, prd); code = "from-changed"; }
    if (mode === "addition-target") {
      // Raw corruption holds the stored hash fixed, isolating the target guard from movement.
      prd.requirements[0].acceptance_criteria.push(a.to); raw(root, PRD_FILE, prd); code = "target-now-exists";
    }
    if (mode === "radius") { extra.radius = []; code = "radius-unacknowledged"; }
    if (mode === "decided") { doors.reject({ root, id: a.id, by: "PM", reason: "Keep it." }); code = "not-proposed"; }
    if (mode === "author") { extra.by = " "; code = "no-author"; }
    const before = pair(root);
    assert.throws(() => approve(root, a, extra), (e) => e instanceof Refused && e.code === code);
    assert.deepEqual(pair(root), before);
  });
}

done();
