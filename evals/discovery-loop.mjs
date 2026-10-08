// owns: R3, R13, R15 · shared — M0 regressions: unresolved prototype questions and
// accepted PM decisions. Intentionally red until a separately reviewed implementation.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { suite, scripted, withRoot } from "./_harness.mjs";
import { partialContract, validateAgainst } from "../shared/schema/index.mjs";
import { checkScope } from "../shared/scope.mjs";
import { setupProject } from "../discovery/setup/index.mjs";
import { openPrd, turn, extract, loadPrd, WorkshopRefused } from "../discovery/workshop/index.mjs";
import { answer } from "../discovery/doors/index.mjs";
import { generate } from "../discovery/prototype/index.mjs";
import { write, loadStories } from "../discovery/stories/index.mjs";
import { Refused, HTML_FILE, STORIES_FILE } from "../discovery/record/index.mjs";

const { check, done } = suite("discovery-loop — M0 D01/D02", 8);
const QUESTION = "Can a member cancel a booking after pickup?";
const DECISION = "Cancellation is unavailable after pickup.";
const REQUIREMENTS = {
  requirements: [{ id: "REQ-1", statement: "Members can cancel equipment bookings.", type: "functional", status: "committed",
    done_definition: "A cancelled booking releases its reservation.", acceptance_criteria: [{ id: "AC-1", statement: "Cancellation releases the reservation." }] }],
  surfaces: { shipped: [{ id: "SURF-1", kind: "web app", statement: "A booking page for members.", req_refs: ["REQ-1"] }], deferred: [] },
  mvp: { line: "Booking cancellation only; notifications are excluded.", inside: ["REQ-1"], past: [] },
};
const BACKLOG = {
  epics: [{ id: "EPIC-1", req_ref: "REQ-1", title: "Cancel a booking" }],
  stories: [{ id: "STORY-1", epic: "EPIC-1", statement: "As a member, I want to cancel my booking, so that others can reserve the equipment.",
    req_refs: ["REQ-1"], screen_refs: ["SCREEN-1"], scenarios: [{ name: "Release a reservation",
      gherkin: "Given my cancellable booking\nWhen I cancel it\nThen its reservation is released", proves: ["REQ-1/AC-1"] }] }],
  notes: "", open_questions: [],
};
const attempt = async (action) => {
  try { return { value: await action() }; } catch (error) { return { error }; }
};
const describe = (out) => out.error ? `${out.error.name}: ${out.error.code ?? ""} ${out.error.message}` : "returned successfully";

async function project(parent, slug) {
  const { root } = setupProject({ parent, slug, title: "Equipment bookings", _exec: () => "" });
  openPrd({ root, slug, title: "Equipment bookings", seed: "Members need to cancel equipment bookings; after-pickup policy is undecided." });
  await turn({ root, key: "shape", text: "Staff mark pickup. A booking runs from reserved to picked up to returned.",
    _query: scripted({ text: "🏛 Shape captured.\n[SECTION_COMPLETE]" }).query });
  await extract({ root, key: "shape", _query: scripted({ structured: { shape: {
    lifecycles: [{ id: "LC-1", subject: "booking", states: ["reserved", "picked up", "returned"], owner: "staff" }],
    vocabulary: [], attribution: [], clocks: [],
  } } }).query });
  await turn({ root, key: "requirements", text: "Members cancel bookings on a web page; cancellation releases the reservation. Notifications are excluded.",
    _query: scripted({ text: "🏛 Cancellation is in scope.\n[SECTION_COMPLETE]" }).query });
  await extract({ root, key: "requirements", _query: scripted({ structured: structuredClone(REQUIREMENTS) }).query });
  return root;
}

for (const blocking of [false, true]) {
  await withRoot({}, async (parent) => {
    const root = await project(parent, `d01-${blocking ? "blocked" : "control"}`);
    const builder = scripted({ structured: {
      screens: [{ id: "SCREEN-1", name: "Booking", surface_ref: "SURF-1", req_refs: ["REQ-1"] }],
      uncovered: [], notes: "Cancellation policy needs PM confirmation.", open_questions: [{ question: QUESTION, blocking }],
    }, toolUses: [{ name: "Write", input: { file_path: HTML_FILE } }] });
    const prototype = await generate({ root, _query: (args) => {
      // Emulate only the scripted SDK's authorized HTML Write; generate owns the record and hashes.
      mkdirSync(dirname(join(root, HTML_FILE)), { recursive: true });
      writeFileSync(join(root, HTML_FILE), "<!doctype html><title>Booking</title><button>Cancel booking</button>\n");
      return builder.query(args);
    } });
    check(`D01 ${blocking ? "blocking" : "control"} setup reaches a valid generated prototype`,
      checkScope(loadPrd(root)).verdict === "pass" && prototype.arithmetic.verdict === "pass" && builder.calls.length === 1
      && prototype.prototype.open_questions.length === 1 && prototype.prototype.open_questions[0].blocking === blocking && !existsSync(join(root, STORIES_FILE)));
    const writer = scripted({ structured: structuredClone(BACKLOG) });
    const out = await attempt(() => write({ root, _query: writer.query }));
    if (blocking) {
      check("D01 a blocking prototype question prevents the story call and artifact",
        out.error instanceof Refused && !["no-line", "no-prototype"].includes(out.error.code)
        && writer.calls.length === 0 && !existsSync(join(root, STORIES_FILE)),
        `${describe(out)}; writer calls=${writer.calls.length}; stories persisted=${existsSync(join(root, STORIES_FILE))}`);
    } else {
      check("D01 control: no blocking question permits a valid persisted backlog",
        !out.error && writer.calls.length === 1 && out.value.arithmetic.verdict === "pass" && loadStories(root)?.stories[0]?.id === "STORY-1",
        describe(out));
    }
  });
}

for (const contradict of [false, true]) {
  await withRoot({}, async (parent) => {
    const root = await project(parent, `d02-${contradict ? "overwrite" : "control"}`);
    const ruled = answer({ root, req: "REQ-1", question: QUESTION, answer: "No.", criterion: DECISION, by: "PM" });
    const note = "The equipment desk handles bookings.";
    await turn({ root, key: "requirements", text: `Keep the cancellation decision unchanged. Add this context: ${note}`,
      _query: scripted({ text: "🏛 I will retain the decision and add the context.\n[SECTION_COMPLETE]" }).query });
    const before = loadPrd(root);
    const candidate = structuredClone({ requirements: before.requirements, surfaces: before.surfaces, mvp: before.mvp });
    candidate.requirements[0].context = note;
    if (contradict) candidate.requirements[0].acceptance_criteria.find((ac) => ac.id === "AC-2").statement = "Cancellation is available after pickup.";
    check(`D02 ${contradict ? "contradictory" : "control"} extraction is schema-valid and preserves the ruled ID`,
      ruled.ruling.criterion === "REQ-1/AC-2" && before.requirements[0].acceptance_criteria[1].statement === DECISION
      && validateAgainst(partialContract("prd", ["requirements", "surfaces", "mvp"]), candidate).ok);
    const extractor = scripted({ structured: candidate });
    const out = await attempt(() => extract({ root, key: "requirements", _query: extractor.query }));
    const after = loadPrd(root);
    const preserved = after.requirements[0].acceptance_criteria.find((ac) => ac.id === "AC-2")?.statement === DECISION
      && JSON.stringify(after.rulings) === JSON.stringify(before.rulings);
    if (contradict) {
      check("D02 extraction cannot reverse a PM-ruled criterion while retaining its ID",
        extractor.calls.length === 1 && (!out.error || out.error instanceof WorkshopRefused) && preserved,
        `${describe(out)}; criterion=${after.requirements[0].acceptance_criteria[1].statement}; ruling answer=${after.rulings[0].answer}`);
    } else {
      check("D02 control: a benign extraction updates context and preserves the PM decision",
        !out.error && extractor.calls.length === 1 && preserved && after.requirements[0].context === note, describe(out));
    }
  });
}

done();
