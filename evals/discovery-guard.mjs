#!/usr/bin/env node
// owns: R3 · discovery — DH1a.2 §1: late workshop writes preserve newer PM decisions.
// All interleavings run inside scripted queries, after the workshop read and before
// the result. No timers, live providers, or later reaction/history behavior.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { suite, scripted, withRoot } from "./_harness.mjs";
import { seedProject, seedPrototype } from "./_fixture.mjs";
import * as workshop from "../discovery/workshop/index.mjs";
import { agree, answer, AUDIT_GATE } from "../discovery/doors/index.mjs";
import { Refused, REVIEWS } from "../discovery/record/index.mjs";

const { check, done } = suite("Discovery · PRD write guard", 11);
const _now = () => new Date("2026-10-14T12:00:00Z");
const bytes = (root) => readFileSync(workshop.prdPath(root));
// Independent oracle also lets save/extract/turn cases run when prdStamp is absent.
const digest = (root) => createHash("sha256").update(bytes(root)).digest("hex");
const changed = (e) => e instanceof Refused && e.code === "prd-changed";
async function test(label, fn) {
  try { await withRoot({}, (tmp) => fn(seedProject(tmp))); check(label, true); }
  catch (e) { check(label, false, e.stack); }
}

await test("prdStamp hashes exact bytes, including formatting, without writing", (root) => {
  assert.equal(typeof workshop.prdStamp, "function", "prdStamp must be exported beside savePrd");
  const before = bytes(root), stamp = workshop.prdStamp(root);
  assert.equal(stamp, digest(root));
  assert.deepEqual(bytes(root), before);
  writeFileSync(workshop.prdPath(root), JSON.stringify(workshop.loadPrd(root)) + "\n\n");
  const formatted = bytes(root);
  assert.notEqual(workshop.prdStamp(root), stamp);
  assert.equal(workshop.prdStamp(root), digest(root));
  assert.deepEqual(bytes(root), formatted);
});

await test("savePrd accepts matching base and stamps the saved content", (root) => {
  const base = digest(root), prd = workshop.loadPrd(root), oldHash = prd.meta.content_hash;
  prd.problem.problem = "A new problem captured by the workshop.";
  workshop.savePrd(root, prd, { base });
  assert.deepEqual(workshop.loadPrd(root), prd);
  assert.notEqual(prd.meta.content_hash, oldHash);
  assert.notEqual(digest(root), base);
});

await test("savePrd refuses an agreement-only move without touching bytes", (root) => {
  seedPrototype(root);
  const base = digest(root), stale = workshop.loadPrd(root);
  agree({ root, by: "Brad", _now });
  const fresh = workshop.loadPrd(root), saved = bytes(root);
  assert.equal(fresh.meta.version, stale.meta.version);
  assert.equal(fresh.meta.content_hash, stale.meta.content_hash);
  assert.notEqual(digest(root), base);
  assert.throws(() => workshop.savePrd(root, stale, { base }), changed);
  assert.deepEqual(bytes(root), saved);
});

await test("stale base refuses before stamping or validating the candidate", (root) => {
  const base = digest(root), candidate = workshop.loadPrd(root);
  writeFileSync(workshop.prdPath(root), Buffer.concat([bytes(root), Buffer.from("\n")]));
  candidate.problem.problem = "Would change the content hash if stamped.";
  candidate.meta.version = 42;
  const untouched = structuredClone(candidate), saved = bytes(root);
  assert.throws(() => workshop.savePrd(root, candidate, { base }), changed);
  assert.deepEqual(candidate, untouched, "refusal must precede stamp's in-memory mutation");
  assert.deepEqual(bytes(root), saved);
});

await test("base remains optional; matching base still validates invalid content", (root) => {
  const prd = workshop.loadPrd(root);
  prd.problem.problem = "A synchronous write remains supported.";
  workshop.savePrd(root, prd);
  assert.deepEqual(workshop.loadPrd(root), prd);
  const saved = bytes(root), base = digest(root);
  prd.meta.version = 42;
  assert.throws(() => workshop.savePrd(root, prd, { base }),
    (e) => e instanceof workshop.WorkshopRefused && e.code === "prd-invalid");
  assert.deepEqual(bytes(root), saved);
});

// A ruled rewording makes extract prepare an audit: refusal must not file it.
for (const move of ["none", "agreement", "answer"]) {
  await test(`extract ${move === "none" ? "allows unchanged PRD and files held audit" : `refuses ${move} move with no PRD write or audit`}`, async (root) => {
    answer({ root, req: "REQ-1", oq: "OQ-1", answer: "Late exceptions remain recorded.", by: "Brad", _now });
    seedPrototype(root);
    const initial = workshop.loadPrd(root);
    const structured = Object.fromEntries(["requirements", "surfaces", "mvp"].map((k) => [k, structuredClone(initial[k])]));
    structured.requirements[0].acceptance_criteria.at(-1).statement = "Late exceptions are rejected.";
    workshop.appendTranscript(root, "requirements", { at: _now().toISOString(), from: "pm", text: "Review late exceptions." });
    const q = scripted({ structured });
    let saved, answered;
    const _query = (args) => {
      if (move === "agreement") agree({ root, by: "Brad", _now });
      if (move === "answer") {
        answered = answer({ root, req: "REQ-1", oq: "OQ-2", answer: "The dock lead names the vendor.", by: "Brad", _now });
        const fresh = workshop.loadPrd(root);
        assert.notEqual(fresh.meta.version, initial.meta.version);
        assert.notEqual(fresh.meta.content_hash, initial.meta.content_hash);
        assert.equal(answered.ruling.oq, "OQ-2");
        assert.equal(answered.ruling.criterion, `REQ-1/${answered.criterion.id}`);
      }
      saved = bytes(root);
      if (move === "agreement") {
        assert.equal(workshop.loadPrd(root).meta.content_hash, initial.meta.content_hash);
        assert.equal(workshop.loadPrd(root).meta.version, initial.meta.version);
      }
      return q.query(args);
    };
    let result, error;
    try { result = await workshop.extract({ root, key: "requirements", _query, _now }); }
    catch (e) { error = e; }
    assert.equal(q.calls.length, 1);
    const auditDir = join(root, REVIEWS, AUDIT_GATE);
    if (move === "none") {
      assert.ifError(error);
      assert.equal(result.held.length, 1);
      const prd = workshop.loadPrd(root);
      assert.equal(prd.sections.requirements.extracted_at, _now().toISOString());
      assert.deepEqual(prd.requirements, initial.requirements);
      assert.equal(prd.amendments.at(-1).to, "Late exceptions are rejected.");
      assert.ok(existsSync(join(auditDir, `${result.held[0].id}.json`)));
    } else {
      assert.ok(changed(error), `expected shared Refused(prd-changed), got ${error?.code ?? "success"}`);
      assert.deepEqual(bytes(root), saved);
      assert.equal(existsSync(auditDir), false);
      if (move === "answer") {
        const prd = workshop.loadPrd(root);
        assert.deepEqual(prd.rulings.find((r) => r.id === answered.ruling.id), answered.ruling);
        assert.deepEqual(prd.requirements[0].acceptance_criteria.find((ac) => ac.id === answered.criterion.id), answered.criterion);
      }
    }
  });
}

for (const mode of ["unchanged", "complete-kill", "open"]) {
  await test(`turn ${mode}: reapplies only its state and preserves fresh PM data`, async (root) => {
    const initial = workshop.loadPrd(root);
    initial.sections.problem = { status: "open", turns: 2, session_id: "old-session", extracted_at: null };
    workshop.savePrd(root, initial);
    const kill = mode === "complete-kill";
    const q = scripted({ text: `🏛 Keep the PM's decision.${kill ? "\n[SECTION_COMPLETE]\n[KILL_SUGGESTED]" : ""}`, sessionId: "new-session" });
    let fresh;
    const _query = (args) => {
      fresh = workshop.loadPrd(root);
      if (mode !== "unchanged") {
        // A direct PM state write, not a second concurrent turn (deferred D09).
        fresh.problem.problem = "PM content committed while the model is working.";
        fresh.sections.problem.turns = 7;
        if (mode === "open") fresh.sections.problem.status = "complete";
        fresh.sections.problem.extracted_at = "2026-10-14T11:00:00.000Z";
        fresh.sections.shape.status = "complete";
        fresh.flags.push({ at: _now().toISOString(), section: "shape", kind: "note", note: "PM's newer note" });
        workshop.savePrd(root, fresh);
      }
      return q.query(args);
    };
    let result, error;
    try { result = await workshop.turn({ root, key: "problem", text: "Continue.", _query, _now }); }
    catch (e) { error = e; }
    assert.equal(q.calls.length, 1);
    assert.ifError(error); // Refusing instead of reapplying is a wrong fix.
    const expected = structuredClone(fresh);
    Object.assign(expected.sections.problem, { turns: fresh.sections.problem.turns + 1, status: kill ? "complete" : "open", session_id: "new-session" });
    if (kill) expected.flags.push({ at: _now().toISOString(), section: "problem", kind: "kill_suggested", note: "Keep the PM's decision." });
    assert.deepEqual(workshop.loadPrd(root), expected);
    assert.deepEqual(result.state, expected.sections.problem);
  });
}

done();
