#!/usr/bin/env node
// owns: R3, R13 · shared — eval: discovery-loop. D01: a blocking prototype question stops the story
// writer before its call, leaves the record alone, and the refusal shows the PM the question. D02: an
// extraction cannot rewrite or remove a PM-ruled criterion; it is refused naming the criterion or held as
// a proposal, never applied, while unruled criteria stay editable. Red at DH0 by design
// (docs/discovery-m0-evidence.md); DH1a turns it green. Its assertions may be tightened, never loosened.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { suite, scripted, withRoot } from "./_harness.mjs";
import { partialContract, validateAgainst } from "../shared/schema/index.mjs";
import { checkScope } from "../shared/scope.mjs";
import { refusalHtml, esc } from "../shared/console/index.mjs";
import { project, cancel } from "./_fixture.mjs";
import { extract, loadPrd, appendTranscript, WorkshopRefused } from "../discovery/workshop/index.mjs";
import { section } from "../discovery/workshop/sections.mjs";
import * as doors from "../discovery/doors/index.mjs";
import { generate, GATE as PROTOTYPE_GATE } from "../discovery/prototype/index.mjs";
import { write, loadStories, GATE as STORY_GATE } from "../discovery/stories/index.mjs";
import { Refused, readDoc, readVerdict, HTML_FILE, PRD_FILE, PROTOTYPE_FILE, STORIES_FILE } from "../discovery/record/index.mjs";

const { check, done } = suite("discovery-loop · D01 a blocking question holds the stories, D02 a ruling survives extraction", 11);
const QUESTION = "Can a member cancel a booking after pickup?";
const ASIDE = "Should the booking page show the equipment desk's hours?";
const DECISION = "Cancellation is unavailable after pickup.";
const CONTRARY = "Cancellation is available after pickup.";
const NOTE = "The equipment desk handles bookings.";
const AT = "2026-10-08T12:00:00.000Z";
const HTML = "<!doctype html><title>Booking</title><button>Cancel booking</button>\n";
// D02 lists returns first: it reuses the bare id AC-2, as real PRDs do, so protection must follow REQ-2/AC-2, not "AC-2".
const RETURNS = { id: "REQ-1", statement: "Staff record returns.", type: "functional", status: "committed", done_definition: "A returned item can be booked again.",
  acceptance_criteria: [{ id: "AC-1", statement: "Staff can mark a booking returned." }, { id: "AC-2", statement: "A return records when it happened." }] };
const RULED = "REQ-2/AC-2"; // answer() appends the PM's criterion to the cancellation requirement, after its AC-1
const REWORD = { "REQ-2/AC-1": "Cancelling a booking releases its reservation immediately.", "REQ-1/AC-2": "A return records the time the item came back." };
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
const describe = (out) => out.error ? `${out.error.constructor?.name ?? "Error"}: ${out.error.code ?? ""} ${out.error.message}` : "returned successfully";
const refusal = (error) => error instanceof Refused || error instanceof WorkshopRefused;
const criterion = (doc, ref) => {
  const [req, ac] = ref.split("/");
  return doc?.requirements?.find((r) => r.id === req)?.acceptance_criteria?.find((a) => a.id === ac);
};
const NOT_RUN = "not run — the setup above did not reach the state under test";

// ── D01: the only difference between the two runs is the second question's `blocking` flag ──
for (const blocking of [false, true]) {
  await withRoot({}, async (parent) => {
    const name = blocking ? "blocking" : "control";
    const gates = blocking
      ? ["D01 a blocking prototype question stops the story call before it starts and leaves the records alone",
        "D01 the refusal shows the PM the blocking question"]
      : ["D01 control: a non-blocking question permits a valid persisted backlog"];
    const asked = [{ question: ASIDE, blocking: false }, { question: QUESTION, blocking }];
    const writes = [{ name: "Write", input: { file_path: HTML_FILE } }];
    const builder = scripted({ structured: {
      screens: [{ id: "SCREEN-1", name: "Booking", surface_ref: "SURF-1", req_refs: ["REQ-1"] }],
      uncovered: [], notes: "Cancellation policy needs PM confirmation.", open_questions: asked,
    }, toolUses: writes });
    const setup = await attempt(async () => {
      const root = await project(parent, [cancel("REQ-1")]);
      // The scripted SDK Write, carried out where the runner pointed the builder. Not containment evidence (D13).
      await generate({ root, _query: (args) => {
        for (const w of writes) { const p = resolve(args.options.cwd, w.input.file_path); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, HTML); }
        return builder.query(args);
      } });
      doors.agree({ root, by: "PM" }); // both runs agree the revision; `blocking` stays the only difference
      return root;
    });
    const root = setup.value;
    const pairs = (doc) => JSON.stringify((doc?.open_questions ?? []).map((q) => [q.question, q.blocking]));
    const proto = root ? readDoc(root, PROTOTYPE_FILE) : null;
    const ready = !setup.error && checkScope(loadPrd(root)).verdict === "pass" && readVerdict(root, PROTOTYPE_GATE)?.verdict === "pass"
      && builder.calls.length === 1 && pairs(proto) === pairs({ open_questions: asked }) && !existsSync(join(root, STORIES_FILE));
    check(`D01 ${name} setup reaches a valid generated prototype`, ready, setup.error ? describe(setup) : `questions on disk: ${pairs(proto)}`);
    if (!ready) { for (const gate of gates) check(gate, false, NOT_RUN); return; }

    const before = readFileSync(join(root, PROTOTYPE_FILE), "utf8");
    const writer = scripted({ structured: structuredClone(BACKLOG) });
    const out = await attempt(() => write({ root, _query: writer.query }));
    if (!blocking) {
      check(gates[0], !out.error && writer.calls.length === 1 && readVerdict(root, STORY_GATE)?.verdict === "pass"
        && loadStories(root)?.stories?.[0]?.id === "STORY-1", describe(out));
      return;
    }
    const refused = refusal(out.error) && !["no-line", "no-prototype", "no-agreement", "agreement-stale"].includes(out.error.code);
    const untouched = readFileSync(join(root, PROTOTYPE_FILE), "utf8") === before;
    check(gates[0], refused && writer.calls.length === 0 && !existsSync(join(root, STORIES_FILE)) && untouched,
      `${describe(out)}; writer calls=${writer.calls.length}; stories persisted=${existsSync(join(root, STORIES_FILE))}; prototype record unchanged=${untouched}`);
    // What the console renders for a refusal (its message, plus a string detail) must contain the question itself.
    check(gates[1], refused && refusalHtml(out.error).includes(esc(QUESTION)), refused ? `the PM sees: ${refusalHtml(out.error)}` : describe(out));
  });
}

// ── D02: every run rewords two unruled criteria and the ruled requirement's context; two runs also attack the ruling ──
for (const mode of ["control", "contradict", "remove"]) {
  await withRoot({}, async (parent) => {
    const gate = {
      control: "D02 control: extraction still rewords unruled criteria, beside a ruling or sharing its bare id",
      contradict: "D02 extraction cannot reverse a PM-ruled criterion: refused naming it, or held as a proposal",
      remove: "D02 extraction cannot remove a PM-ruled criterion",
    }[mode];
    const setup = await attempt(async () => {
      const root = await project(parent, [RETURNS, cancel("REQ-2")]);
      const ruled = doors.answer({ root, req: "REQ-2", question: QUESTION, answer: "No.", criterion: DECISION, by: "PM" });
      // extract() is the step under test and its input is the section transcript, so seed that.
      appendTranscript(root, "requirements", { at: AT, from: "pm", text: `Keep the cancellation decision unchanged. Add this context: ${NOTE}` });
      appendTranscript(root, "requirements", { at: AT, from: "workshop", text: "I will keep the decision and add the context.", mode: "socratic", signals: ["complete"] });
      const prd = loadPrd(root);
      const candidate = structuredClone({ requirements: prd.requirements, surfaces: prd.surfaces, mvp: prd.mvp });
      const req = candidate.requirements.find((r) => r.id === "REQ-2");
      req.context = NOTE;
      for (const [ref, text] of Object.entries(REWORD)) criterion(candidate, ref).statement = text;
      if (mode === "contradict") criterion(candidate, RULED).statement = CONTRARY;
      if (mode === "remove") req.acceptance_criteria = req.acceptance_criteria.filter((a) => a.id !== "AC-2");
      return { root, ruled, prd, candidate };
    });
    const { root, ruled, prd: before, candidate } = setup.value ?? {};
    const ready = !setup.error && ruled.ruling.criterion === RULED && criterion(before, RULED)?.statement === DECISION
      && validateAgainst(partialContract("prd", section("requirements").fields), candidate).ok;
    check(`D02 ${mode} setup: the ruling stands and the extraction is schema-valid`, ready, setup.error ? describe(setup) : `ruling → ${ruled?.ruling?.criterion}`);
    if (!ready) { check(gate, false, NOT_RUN); return; }

    const extractor = scripted({ structured: candidate });
    const prdBefore = readFileSync(join(root, PRD_FILE), "utf8");
    const out = await attempt(() => extract({ root, key: "requirements", _query: extractor.query }));
    const untouched = readFileSync(join(root, PRD_FILE), "utf8") === prdBefore;
    const after = loadPrd(root);
    const was = before.rulings.find((x) => x.id === ruled.ruling.id);
    const now = after.rulings?.find((x) => x.id === ruled.ruling.id);
    const preserved = criterion(after, RULED)?.statement === DECISION && after.rulings?.length === before.rulings.length
      && ["question", "answer", "by", "criterion"].every((k) => now?.[k] === was[k]);
    const state = `${describe(out)}; ${RULED}=${criterion(after, RULED)?.statement}; ruling=${now ? `${now.id} → ${now.criterion} "${now.answer}"` : "missing"}`;
    if (mode === "control") {
      const reworded = Object.entries(REWORD).every(([ref, text]) => criterion(after, ref)?.statement === text);
      check(gate, !out.error && extractor.calls.length === 1 && preserved && reworded
        && after.requirements.find((r) => r.id === "REQ-2")?.context === NOTE, `${state}; unruled rewordings applied=${reworded}`);
      return;
    }
    const named = refusal(out.error) && /REQ-2\/AC-2|RUL-1/.test(refusalHtml(out.error));
    const proposal = (after.amendments ?? []).find((a) => a.status === "proposed" && a.radius?.criteria?.includes(RULED)
      && (mode === "remove" || JSON.stringify(a.to).includes(CONTRARY)));
    const applied = JSON.stringify([after.requirements, after.surfaces, after.mvp]).includes(CONTRARY);
    check(gate, extractor.calls.length === 1 && preserved && !applied && ((named && untouched) || (!out.error && !!proposal)),
      `${state}; contrary text applied=${applied}; refusal names it=${named}; record unchanged=${untouched}; pending proposal=${proposal?.id ?? "none"}`);
  });
}

done();
