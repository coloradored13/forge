// owns: R15 · shared — the seeded Discovery record the PR3 evals start from: a project
// in a temp root, a PRD past the line, a prototype and a backlog, all through the same
// writers the doors use. Nothing here reaches a model or a real repository.

import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { skeleton } from "../shared/schema/index.mjs";
import { HANDOFFS } from "../shared/handoff.mjs";
import { scripted } from "./_harness.mjs";
import { setupProject } from "../discovery/setup/index.mjs";
import { openPrd, loadPrd, savePrd } from "../discovery/workshop/index.mjs";
import { readDoc, saveDoc, traceOf, PROTOTYPE_FILE, HTML_FILE, STORIES_FILE, DESIGN_FILE } from "../discovery/record/index.mjs";
import { review, signoff } from "../discovery/design/index.mjs";
import { exportHandoff } from "../discovery/export/index.mjs";
import { createRun } from "../delivery/state/index.mjs";

export const HTML = "<!doctype html><title>Dock</title><main><h1>Run sheet</h1><button>Record an exception</button></main>\n";

export const REQ = (n, statement, acs, extra = {}) => ({
  id: `REQ-${n}`, statement, type: "functional", done_definition: "d", status: "committed", context: "", flags: [],
  acceptance_criteria: acs.map((s, i) => ({ id: `AC-${i + 1}`, statement: s })), ...extra,
});

/** A project with a PRD past the line: two requirements inside it with a screen each, one non-functional, one deferred. */
export function seedProject(parent, { slug = "dock" } = {}) {
  const _exec = (cmd, args) => (cmd === "git" && args[0] === "remote" ? `git@github.com:acme/${slug}.git` : "");
  const { root } = setupProject({ slug, title: "Dock", parent, _exec });
  openPrd({ root, title: "Dock", slug, seed: "Exceptions recorded at the door, not shouted." });
  const prd = loadPrd(root);
  prd.problem = { ...prd.problem, who: "dock leads at one receiving door", problem: "a shortfall is shouted across the dock and lost by the next shift", crux: "recording at the door, one-handed" };
  prd.shape.vocabulary = [
    { term: "exception", definition: "A shortfall or damage a dock lead records against a delivery.", owner: "ops" },
    { term: "run sheet", definition: "The deliveries expected in a shift, in arrival order.", owner: "ops" },
  ];
  prd.surfaces.shipped = [
    { id: "SURF-1", kind: "handheld web app", statement: "A handheld web app a dock lead uses one-handed at the door.", req_refs: ["REQ-1", "REQ-2"] },
    { id: "SURF-2", kind: "document", statement: "A weekly export a supervisor opens in a spreadsheet.", req_refs: ["REQ-3"] },
  ];
  prd.requirements = [
    REQ(1, "A dock lead records an exception at the door against a delivery.", ["An exception carries the delivery, the vendor and a reason.", "A submitted exception cannot be edited."]),
    REQ(2, "A dock lead sees the run sheet for the shift.", ["The run sheet lists every delivery expected this shift."]),
    REQ(3, "A supervisor exports the week's records.", ["The export holds every record of the week."], { status: "deferred" }),
    REQ(4, "The app keeps working through a shift with no signal.", ["Nothing recorded in a shift is lost when the signal drops."], { type: "non-functional" }),
  ];
  prd.mvp = { line: "One door, one shift, no exports.", inside: ["REQ-1", "REQ-2", "REQ-4"], past: [{ ref: "REQ-3", why: "the weekly export waits" }, { ref: "SURF-2", why: "no export, no document" }] };
  prd.open_questions = [
    { id: "OQ-1", question: "Can an exception be recorded after the truck has left?", owner: "ops", status: "open" },
    { id: "OQ-2", question: "Who names the vendor when the paperwork is missing?", owner: "ops", status: "open" },
  ];
  savePrd(root, prd);
  return root;
}

export const SCREENS = [
  { id: "SCREEN-1", name: "Recording an exception", surface_ref: "SURF-1", req_refs: ["REQ-1"] },
  { id: "SCREEN-2", name: "The run sheet", surface_ref: "SURF-1", req_refs: ["REQ-2"] },
];

export function writeHtml(root, html = HTML) {
  const p = join(root, HTML_FILE);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, html);
  return createHash("sha256").update(html).digest("hex");
}

/** The prototype record as the runner would write it after a build: two screens, the non-functional requirement listed as uncovered. */
export function seedPrototype(root, { screens = SCREENS, uncovered = ["REQ-4"] } = {}) {
  const prd = loadPrd(root);
  const file_hash = writeHtml(root);
  const doc = { ...skeleton("prototype"), id: `proto-${prd.meta.slug}`, traces: traceOf(prd), file: HTML_FILE, file_hash, screens, uncovered, notes: "Start on the run sheet; tap a delivery to record against it.", open_questions: [] };
  return saveDoc(root, PROTOTYPE_FILE, "prototype", doc);
}

export const EPICS = [
  { id: "EPIC-1", req_ref: "REQ-1", title: "Record an exception at the door" },
  { id: "EPIC-2", req_ref: "REQ-2", title: "See the shift's run sheet" },
];
export const STORIES = [
  {
    id: "STORY-1", epic: "EPIC-1", statement: "As a dock lead, I want to record an exception against a delivery, so that the vendor is charged for what did not arrive.",
    req_refs: ["REQ-1"], screen_refs: ["SCREEN-1"],
    scenarios: [
      { name: "Recording a shortfall", gherkin: "Given a delivery from Harvest Foods on the run sheet\nWhen I record an exception for two missing cases\nThen the exception shows the delivery, Harvest Foods and the reason", proves: ["REQ-1/AC-1"] },
      { name: "A submitted exception stays as recorded", gherkin: "Given a submitted exception\nWhen I try to change its reason\nThen the exception is unchanged", proves: ["REQ-1/AC-2"] },
    ],
  },
  {
    id: "STORY-2", epic: "EPIC-2", statement: "As a dock lead, I want to see the run sheet for my shift, so that I know which trucks are still due.",
    req_refs: ["REQ-2"], screen_refs: ["SCREEN-2"],
    scenarios: [{ name: "Seeing the shift", gherkin: "Given four deliveries expected this shift\nWhen I open the run sheet\nThen all four deliveries are listed in arrival order", proves: ["REQ-2/AC-1"] }],
  },
];

/** The backlog as the runner would write it: one epic per functional requirement inside the line, every criterion proved once. */
export function seedStories(root, { epics = EPICS, stories = STORIES, open_questions = [] } = {}) {
  const prd = loadPrd(root);
  const proto = readDoc(root, PROTOTYPE_FILE);
  const doc = { ...skeleton("story"), id: `stories-${prd.meta.slug}`, traces: traceOf(prd, proto), epics, stories, notes: "", open_questions };
  return saveDoc(root, STORIES_FILE, "story", doc);
}

/** What the design writer composes: a declared standard, one language, one design per claimed screen. */
export const DESIGN = {
  standard: {
    direction: "A clipboard at a loading door: ink-dark type on warm paper, one red pen for the exception, read with a glove on in bad light.",
    heroes: [{ screen_ref: "SCREEN-1", moment: "The reason is chosen and the exception is recorded — the red pen mark." }],
    commitments: ["Two families: Source Serif for the delivery names, Inter for everything else; weights 400 and 600 only.", "Space on an 8px unit.", "Separation by space and weight; a border only around the one control that records.", "Status never by colour alone — a word travels with it."],
  },
  tokens: { "font-display": "Source Serif 4", "font-text": "Inter", "type-ratio": 1.25, "space-unit": 8, "color-paper": "#f3ede2", "color-ink": "#1e1a16", "color-pen": "#b3261e", "touch-min": 48 },
  stylesheet: ":root{--paper:#f3ede2;--ink:#1e1a16;--pen:#b3261e;--u:8px}button:focus-visible{outline:3px solid var(--pen)}@media (prefers-reduced-motion:reduce){*{transition:none}}",
  screens: [
    {
      screen_ref: "SCREEN-1", name: "Recording an exception", moment: "Held one-handed at the door, glanced at between pallets; large targets, few words.",
      structure: "header: delivery name (display) · vendor · main: reason chips (Short, Damaged, Wrong item) · quantity stepper · footer: one button 'Record the exception'",
      states: [{ name: "choosing", renders: "reason chips unselected; the record button disabled with its label" }, { name: "recorded", renders: "the exception as written, no controls but 'Back to the run sheet'", entered_by: "recording" }],
      controls: [{ id: "reason-chip", kind: "chip", label: "Short / Damaged / Wrong item" }, { id: "record-exception", kind: "button", label: "Record the exception" }],
    },
    {
      screen_ref: "SCREEN-2", name: "The run sheet", moment: "Glanced at from a step away as trucks arrive; the next delivery reads first.",
      structure: "header: shift and door · list: one row per delivery — time (tabular), vendor (display), state word · empty: 'Nothing due this shift'",
      states: [{ name: "populated", renders: "every delivery expected this shift in arrival order" }, { name: "empty", renders: "one sentence: Nothing due this shift", entered_by: "a shift with no deliveries" }],
      controls: [{ id: "delivery-row", kind: "link", label: "the delivery" }],
    },
  ],
  notes: "Kept the prototype's start-on-the-run-sheet; dropped its bordered cards.",
  open_questions: [],
};

/** The design as the runner would write it: traced to all three by hash, unsigned. */
export function seedDesign(root, design = DESIGN) {
  const prd = loadPrd(root);
  const proto = readDoc(root, PROTOTYPE_FILE);
  const stories = readDoc(root, STORIES_FILE);
  const doc = { ...skeleton("design"), id: `design-${prd.meta.slug}`, traces: traceOf(prd, proto, stories), ...structuredClone(design) };
  return saveDoc(root, DESIGN_FILE, "design", doc);
}

// ── Delivery: a cold root holding a signed handoff and nothing else of Discovery's (R14) ──

const noExec = () => { throw new Error("no command expected"); };
const cleanJudge = () => scripted({ structured: { findings: [], deferred: [], checked: 2, skipped: 0 } }).query;

/**
 * Discovery whole in `tmp/<slug>` — PRD, prototype, backlog, design reviewed clean and
 * signed — exported through the Delivery exit; then a cold root beside it holding `.git/`
 * and the handoffs only, with a run pinned to v1. `open_questions` ride on the stories.
 * @returns { disc, cold, handoff }
 */
export async function seedDelivery(tmp, { slug = "dock", open_questions = [], by = "Brad", now = new Date("2026-09-06T09:00:00Z") } = {}) {
  const disc = seedProject(tmp, { slug });
  seedPrototype(disc);
  seedStories(disc, { open_questions });
  seedDesign(disc);
  await review({ root: disc, _query: cleanJudge() });
  signoff(disc, { by: "Ana Ruiz" });
  const { handoff } = await exportHandoff({ root: disc, exit: "delivery", by, _exec: noExec, _fetch: noExec, _env: {}, _now: () => now });
  const cold = coldRoot(tmp, disc, `${slug}-cold`);
  createRun(cold, { by, version: 1, now });
  return { disc, cold, handoff };
}

/** A repository with `.git/` and Discovery's handoffs, nothing else. */
export function coldRoot(tmp, disc, name = "cold") {
  const cold = join(tmp, name);
  mkdirSync(join(cold, ".git"), { recursive: true });
  mkdirSync(join(cold, HANDOFFS), { recursive: true });
  for (const f of readdirSync(join(disc, HANDOFFS))) copyFileSync(join(disc, HANDOFFS, f), join(cold, HANDOFFS, f));
  return cold;
}

/** Re-export Discovery as it now stands and copy the new snapshot into the cold root. */
export async function reexport(disc, cold, { by = "Brad", now = new Date("2026-09-06T10:00:00Z") } = {}) {
  const { handoff } = await exportHandoff({ root: disc, exit: "delivery", by, _exec: noExec, _fetch: noExec, _env: {}, _now: () => now });
  for (const f of readdirSync(join(disc, HANDOFFS))) copyFileSync(join(disc, HANDOFFS, f), join(cold, HANDOFFS, f));
  return handoff;
}

/**
 * A binding that adds up for the seeded backlog: STORY-1 and STORY-2 on their screens'
 * controls, REQ-4 with no screen; every criterion tested once; one interface shared
 * verbatim. What the sdd writer would return — the runner adds id, traces and the stamp.
 */
export const BINDING = {
  items: [
    {
      work_item: "STORY-1", approach: "The exception form posts to the exceptions store; a submitted exception is a row that is never updated — the store exposes no update.",
      interfaces: [{ name: "exceptions.record", signature: "record(delivery_id: string, reason: 'short' | 'damaged' | 'wrong-item', quantity: number): Exception", shared: false }, { name: "deliveries.forShift", signature: "forShift(shift_id: string): Delivery[]", shared: true }],
      tests: [
        { id: "T-1", proves: ["REQ-1/AC-1"], scenario: "STORY-1/1", level: "browser", exercises: "choose the Short chip, set two cases, press Record the exception on SCREEN-1", asserts: "the recorded state shows the delivery, Harvest Foods and Short ×2" },
        { id: "T-2", proves: ["REQ-1/AC-2"], scenario: "STORY-1/2", level: "integration", exercises: "record an exception, then call every exported function of the store with its id and a new reason", asserts: "no exported function changes the row; a read returns the original reason" },
      ],
      controls: [{ screen_ref: "SCREEN-1", control: "reason-chip" }, { screen_ref: "SCREEN-1", control: "record-exception" }],
      surface: ["src/exceptions/**", "src/screens/record/**"], risks: ["the reason vocabulary is the design's three chips; a fourth reason is a design change"],
    },
    {
      work_item: "STORY-2", approach: "The run sheet reads the shift's deliveries in arrival order from the deliveries store and renders one row per delivery.",
      interfaces: [{ name: "deliveries.forShift", signature: "forShift(shift_id: string): Delivery[]", shared: true }],
      tests: [{ id: "T-3", proves: ["REQ-2/AC-1"], scenario: "STORY-2/1", level: "browser", exercises: "seed four deliveries for the shift and open SCREEN-2", asserts: "four delivery-row controls in arrival order; the populated state" }],
      controls: [{ screen_ref: "SCREEN-2", control: "delivery-row" }],
      surface: ["src/deliveries/**", "src/screens/run-sheet/**"], risks: [],
    },
    {
      work_item: "REQ-4", approach: "Every write goes to a local queue first and is flushed to the store when the signal returns; the queue is durable across a reload.",
      interfaces: [{ name: "queue.enqueue", signature: "enqueue(write: Write): void", shared: false }],
      tests: [{ id: "T-4", proves: ["REQ-4/AC-1"], scenario: null, level: "integration", exercises: "record three exceptions with the network stubbed offline, reload, restore the network", asserts: "all three are in the store afterwards, none duplicated" }],
      controls: [], surface: ["src/queue/**"], risks: [],
    },
  ],
  questions: [],
};
