// owns: R3, R4, R14 · discovery — shared D03 bookings seed; all models scripted.
import assert from "node:assert/strict";
import { scripted } from "./_harness.mjs";
import { project, cancel, seedStories } from "./_fixture.mjs";
import * as doors from "../discovery/doors/index.mjs";
import { generate } from "../discovery/prototype/index.mjs";
export const QUESTION = "Can a member cancel a booking after pickup?", DECISION = "Cancellation is unavailable after pickup.";
export const accepted = (prd) => ({ requirements: prd.requirements, hash: prd.meta.content_hash, version: prd.meta.version, agreements: prd.agreements });
export async function build(root) {
  const q = scripted({ structured: { html: "<!doctype html><title>Booking</title><button>Cancel booking</button>\n", screens: [{ id: "SCREEN-1", name: "Booking", surface_ref: "SURF-1", req_refs: ["REQ-1"] }],
    uncovered: [], notes: "Confirm cancellation policy.", open_questions: [{ question: QUESTION, blocking: true }] } });
  await generate({ root, _query: q.query });
  assert.equal(q.calls.length, 1); return q;
}
export async function setup(parent) {
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
