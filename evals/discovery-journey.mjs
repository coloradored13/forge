#!/usr/bin/env node
// owns: R3, R4, R14 · discovery — D03 bookings: reaction → decision → fresh backlog → export.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { suite, scripted, withRoot } from "./_harness.mjs";
import { project, cancel, seedStories } from "./_fixture.mjs";
import * as doors from "../discovery/doors/index.mjs";
import { loadPrd } from "../discovery/workshop/index.mjs";
import { Refused, readDoc, agreementGap, PRD_FILE, PROTOTYPE_FILE, STORIES_FILE } from "../discovery/record/index.mjs";
import { generate } from "../discovery/prototype/index.mjs";
import { write } from "../discovery/stories/index.mjs";
import { exportHandoff } from "../discovery/export/index.mjs";
import { validate } from "../shared/schema/index.mjs";

const { check, done } = suite("discovery-journey · D03 bookings", 2);
const QUESTION = "Can a member cancel a booking after pickup?", DECISION = "Cancellation is unavailable after pickup.";
const bytes = (root, file) => readFileSync(join(root, file), "utf8");
const accepted = (prd) => ({ requirements: prd.requirements, hash: prd.meta.content_hash, version: prd.meta.version, agreements: prd.agreements });
const noService = () => { throw new Error("unexpected external service"); };
async function build(root) {
  const q = scripted({ structured: { html: "<!doctype html><title>Booking</title><button>Cancel booking</button>\n", screens: [{ id: "SCREEN-1", name: "Booking", surface_ref: "SURF-1", req_refs: ["REQ-1"] }],
    uncovered: [], notes: "Confirm cancellation policy.", open_questions: [{ question: QUESTION, blocking: true }] } });
  await generate({ root, _query: q.query });
  assert.equal(q.calls.length, 1); return q;
}
async function setup(parent) {
  const root = await project(parent, [cancel("REQ-1")]);
  const other = doors.answer({ root, req: "REQ-1", question: "Does cancellation notify the member?", answer: "Show confirmation.", by: "Earlier PM" }).ruling;
  await build(root); doors.agree({ root, by: "PM" });
  const backlog = { epics: [{ id: "EPIC-1", req_ref: "REQ-1", title: "Cancel a booking" }],
    stories: [{ id: "STORY-1", epic: "EPIC-1", statement: "As a member, I want to cancel my booking, so that others can reserve the equipment.",
      req_refs: ["REQ-1"], screen_refs: ["SCREEN-1"], scenarios: [
        { name: "Release reservation", gherkin: "Given my cancellable booking\nWhen I cancel it\nThen its reservation is released", proves: ["REQ-1/AC-1"] },
        { name: "Confirm cancellation", gherkin: "Given my cancellable booking\nWhen I cancel it\nThen confirmation is shown", proves: [other.criterion] },
      ] }], notes: "", open_questions: [] };
  seedStories(root, backlog); // The blocking PQ prevents write(); seed bookings, never the dock defaults.
  return { root, other, backlog };
}

for (const decision of ["approve", "reject"]) {
  try {
    await withRoot({}, async (parent) => {
      const { root, other, backlog } = await setup(parent), before = loadPrd(root), proto = readDoc(root, PROTOTYPE_FILE);
      const protoBytes = bytes(root, PROTOTYPE_FILE), storyBytes = bytes(root, STORIES_FILE);
      const editor = scripted({ structured: { change: { requirement: "REQ-1", statement: DECISION }, rationale: "Pickup ends cancellation.", note: "Review the policy." } });
      assert.equal(typeof doors.react, "function");
      const { amendment: a } = await doors.react({ root, by: "PM", text: "  No cancellations after pickup.\n", pq: "PQ-1",
        seen: { prd_hash: before.meta.content_hash, prototype_hash: proto.meta.content_hash }, _query: editor.query });
      const proposed = loadPrd(root);
      assert.equal(editor.calls.length, 1); assert.equal(proposed.amendments.length, 1); assert.equal(a.origin, "reaction");
      assert.equal(a.pq, "PQ-1"); assert.equal(a.reaction, proposed.reactions[0].id); assert.equal(a.to.id, "AC-3");
      assert.deepEqual(accepted(proposed), accepted(before)); assert.equal(bytes(root, PROTOTYPE_FILE), protoBytes);
      const writer = scripted({ structured: backlog }), proposedBytes = bytes(root, PRD_FILE);
      await assert.rejects(() => write({ root, _query: writer.query }), (e) => e instanceof Refused && e.code === "reaction-pending");
      assert.equal(writer.calls.length, 0); assert.equal(bytes(root, PRD_FILE), proposedBytes); assert.equal(bytes(root, STORIES_FILE), storyBytes);
      if (decision === "reject") {
        doors.reject({ root, id: a.id, by: "PM", reason: "Keep the question open." });
        const rejected = loadPrd(root);
        assert.deepEqual(accepted(rejected), accepted(before)); assert.deepEqual(rejected.rulings, before.rulings);
        assert.equal(rejected.amendments[0].status, "rejected"); assert.notEqual(bytes(root, PRD_FILE), proposedBytes);
        assert.equal(bytes(root, PROTOTYPE_FILE), protoBytes); assert.equal(readDoc(root, PROTOTYPE_FILE).open_questions[0].status, "open");
        await assert.rejects(() => write({ root, _query: writer.query }), (e) => e instanceof Refused && e.code === "blocking-question");
        assert.equal(writer.calls.length, 0); assert.equal(bytes(root, STORIES_FILE), storyBytes); return;
      }
      doors.approve({ root, id: a.id, by: "PM", radius: [...a.radius.criteria, ...a.radius.stories, ...a.radius.screens] });
      const approved = loadPrd(root), ruling = approved.rulings.at(-1);
      assert.equal(approved.rulings.length, 2, "approval records the D03 ruling beside the unrelated ruling");
      assert.deepEqual(approved.rulings[0], other); assert.equal(Object.hasOwn(ruling, "superseded_by"), false);
      assert.equal(ruling.pq, "PQ-1"); assert.equal(ruling.question, QUESTION); assert.equal(ruling.amendment, a.id);
      assert.equal(ruling.criterion, "REQ-1/AC-3"); assert.equal(approved.requirements[0].acceptance_criteria.length, 3);
      assert.deepEqual(approved.requirements[0].acceptance_criteria.at(-1), { id: "AC-3", statement: DECISION });
      assert.notEqual(approved.meta.version, before.meta.version); assert.notEqual(approved.meta.content_hash, before.meta.content_hash);
      assert.deepEqual(approved.agreements, before.agreements); assert.ok(agreementGap(approved, readDoc(root, PROTOTYPE_FILE)));
      assert.deepEqual(readDoc(root, PROTOTYPE_FILE).open_questions[0], { ...proto.open_questions[0], status: "answered", ruling: ruling.id });
      const builder = await build(root); doors.agree({ root, by: "PM" });
      assert.equal(readDoc(root, PROTOTYPE_FILE).open_questions[0].status, "answered");
      assert.equal(agreementGap(loadPrd(root), readDoc(root, PROTOTYPE_FILE)), null);
      const go = () => exportHandoff({ root, exit: "team", by: "PM", _exec: noService, _fetch: noService, _env: {} });
      const agreedBytes = bytes(root, PRD_FILE);
      await assert.rejects(go, (e) => e instanceof Refused && e.code === "not-ready" && e.detail.some((f) => f.rule === "stories-stale"));
      assert.equal(bytes(root, PRD_FILE), agreedBytes); assert.equal(bytes(root, STORIES_FILE), storyBytes);
      assert.equal(existsSync(join(root, "discovery/handoffs")), false);
      const fresh = structuredClone(backlog);
      fresh.stories[0].scenarios.push({ name: "Pickup prevents cancellation", gherkin: "Given my booking has been picked up\nWhen I view it\nThen cancellation is unavailable", proves: [ruling.criterion] });
      const rewrite = scripted({ structured: fresh }); await write({ root, _query: rewrite.query });
      assert.equal(rewrite.calls.length, 1);
      for (const q of [builder, rewrite]) { assert.ok(q.calls[0].prompt.includes(DECISION)); assert.ok(q.calls[0].options.systemPrompt.includes(ruling.id)); }
      const stories = readDoc(root, STORIES_FILE);
      assert.equal(stories.traces.prd.content_hash, approved.meta.content_hash);
      assert.ok(stories.stories.some((s) => s.scenarios.some((sc) => sc.proves.includes(ruling.criterion))));
      const out = await go(), handoff = readDoc(root, out.file);
      assert.equal(validate("handoff", handoff).ok, true);
      assert.deepEqual(handoff.contract.requirements[0].acceptance_criteria.at(-1), { id: "AC-3", statement: DECISION });
      assert.deepEqual(handoff.contract.rulings, approved.rulings); assert.deepEqual(loadPrd(root).rulings[0], other);
    });
    check(`D03 ${decision}: complete bookings journey`, true);
  } catch (e) { check(`D03 ${decision}: complete bookings journey`, false, e.stack); }
}

done();
