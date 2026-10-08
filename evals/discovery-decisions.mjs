#!/usr/bin/env node
// owns: R3, R4, R13 · shared — eval: discovery-decisions. The decisions stories wait on:
// a prototype question carries a runner-owned id and status and is answered only through
// the answer door; stories need the PM's agreement on the exact revision, and a change
// that moves the PRD or the prototype voids it; a ruled criterion the PM's own words
// contradict is held as a proposal, and approving it supersedes the ruling on the record.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { suite, scripted, withRoot } from "./_harness.mjs";
import { seedProject, SCREENS, EPICS, STORIES, HTML } from "./_fixture.mjs";
import { loadPrd, extract, appendTranscript, WorkshopRefused } from "../discovery/workshop/index.mjs";
import * as doors from "../discovery/doors/index.mjs";
import { generate } from "../discovery/prototype/index.mjs";
import { write, loadStories } from "../discovery/stories/index.mjs";
import { Refused, readDoc, readVerdict, rulingsOf, HTML_FILE, PRD_FILE, PROTOTYPE_FILE, STORIES_FILE } from "../discovery/record/index.mjs";

const { check, done } = suite("discovery-decisions · questions, agreement and rulings stories wait on", 17);
const ASIDE = { question: "Should the run sheet show each vendor's phone number?", blocking: false };
const BLOCKER = { question: "Can a dock lead record an exception after the truck has left?", blocking: true };
const LATER = { question: "Does a photo of the damage travel with the exception?", blocking: true };
const DECISION = "An exception cannot be recorded after the truck has left.";
const CONTRARY = "An exception can be recorded after the truck has left.";
const AT = "2026-10-08T12:00:00.000Z";
const by = "PM";
// The backlog proves every criterion the fixture holds, plus the one a ruling adds as REQ-1/AC-3.
const backlog = (extra = []) => ({ epics: EPICS, stories: [{ ...STORIES[0], scenarios: [...STORIES[0].scenarios, ...extra] }, STORIES[1]], notes: "", open_questions: [] });
const RULED_SCENARIO = { name: "Too late to record", gherkin: "Given a truck that has left\nWhen I try to record an exception against its delivery\nThen the exception is refused", proves: ["REQ-1/AC-3"] };

const bytes = (root, file) => existsSync(join(root, file)) ? readFileSync(join(root, file), "utf8") : null;
const attempt = async (fn) => { try { return { value: await fn() }; } catch (error) { return { error }; } };
const said = (out) => out.error ? `${out.error.constructor?.name}: ${out.error.code} ${out.error.message}` : "returned successfully";
const refused = (out, code) => (out.error instanceof Refused || out.error instanceof WorkshopRefused) && out.error.code === code;
const door = (name, args) => attempt(() => {
  if (typeof doors[name] !== "function") throw new Error(`${name}() does not exist`);
  return doors[name](args);
});
const asked = (root) => (readDoc(root, PROTOTYPE_FILE)?.open_questions ?? []).map((q) => `${q.id}:${q.status}:${q.question.slice(0, 18)}`).join(" | ");

/** A real build: the scripted builder writes the HTML where the runner points it and returns these questions. */
async function build(root, open_questions, uncovered = ["REQ-4"]) {
  const builder = scripted({ structured: { screens: SCREENS, uncovered, notes: "Start on the run sheet.", open_questions }, toolUses: [{ name: "Write", input: { file_path: HTML_FILE } }] });
  return attempt(() => generate({ root, _query: (args) => {
    const p = resolve(args.options.cwd, HTML_FILE);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, HTML);
    return builder.query(args);
  } }));
}

async function stories(root, extra) {
  const writer = scripted({ structured: backlog(extra) });
  const out = await attempt(() => write({ root, _query: writer.query }));
  return { out, calls: writer.calls.length };
}

// ── a prototype question: runner-owned id and status, answered only through the door ──
await withRoot({}, async (parent) => {
  const root = seedProject(parent);
  await build(root, [ASIDE, BLOCKER]);
  const qs = readDoc(root, PROTOTYPE_FILE)?.open_questions ?? [];
  check("the runner mints each prototype question an id and an open status",
    qs.length === 2 && qs[0].id === "PQ-1" && qs[1].id === "PQ-2" && qs.every((q) => q.status === "open"), asked(root));

  const minted = bytes(root, PROTOTYPE_FILE);
  const claim = await build(root, [{ ...LATER, id: "PQ-7", status: "answered" }]);
  check("a builder that hands back a question's id or status is refused, and the prototype record is byte-identical",
    refused(claim, "prototype-invalid") && bytes(root, PROTOTYPE_FILE) === minted, said(claim));

  const before = { prd: bytes(root, PRD_FILE), proto: bytes(root, PROTOTYPE_FILE) };
  const unknown = await attempt(() => doors.answer({ root, pq: "PQ-9", req: "REQ-1", answer: "No.", criterion: DECISION, by }));
  check("answering a question the prototype does not ask is refused, and both records are byte-identical",
    refused(unknown, "unknown-question") && bytes(root, PRD_FILE) === before.prd && bytes(root, PROTOTYPE_FILE) === before.proto, said(unknown));

  const ruled = await attempt(() => doors.answer({ root, pq: "PQ-2", req: "REQ-1", answer: "No — not once the truck has left.", criterion: DECISION, by }));
  const pq2 = readDoc(root, PROTOTYPE_FILE)?.open_questions?.find((q) => q.id === "PQ-2");
  check("answering PQ-2 rules it: the ruling names PQ-2 and its question, and the prototype marks PQ-2 answered by that ruling",
    !ruled.error && ruled.value.ruling.pq === "PQ-2" && ruled.value.ruling.question === BLOCKER.question && ruled.value.ruling.criterion === "REQ-1/AC-3"
      && pq2?.status === "answered" && pq2?.ruling === ruled.value.ruling.id, `${said(ruled)}; ${asked(root)}`);

  const again = { prd: bytes(root, PRD_FILE), out: await attempt(() => doors.answer({ root, pq: "PQ-2", req: "REQ-1", answer: "Yes.", by })) };
  check("a prototype question already answered is not answered again, and the PRD is byte-identical",
    refused(again.out, "already-ruled") && bytes(root, PRD_FILE) === again.prd, said(again.out));

  await build(root, [ASIDE]); // a rebuild that no longer asks the settled question
  await build(root, [ASIDE, BLOCKER, LATER]); // ... and one that asks it again, beside a new one
  const kept = readDoc(root, PROTOTYPE_FILE)?.open_questions ?? [];
  check("a settled question asked again keeps its id and stays answered, even after a rebuild dropped it; a new question never takes an id a ruling names",
    kept[0]?.id === "PQ-1" && kept[1]?.id === "PQ-2" && kept[1]?.status === "answered" && kept[1]?.ruling === "RUL-1" && kept[2]?.id === "PQ-3" && kept[2]?.status === "open", asked(root));
});

// ── the agreement: stories are written from the revision the PM agreed, and nothing else ──
await withRoot({}, async (parent) => {
  const root = seedProject(parent);
  const early = await door("agree", { root, by });
  check("the PM cannot agree before there is a prototype to agree to", refused(early, "no-prototype"), said(early));

  await build(root, [ASIDE]);
  const nameless = await door("agree", { root, by: " " });
  const none = await stories(root);
  check("agreement is attributed, and without it stories are refused before the writer runs — no call, no backlog",
    refused(nameless, "no-author") && refused(none.out, "no-agreement") && none.calls === 0 && !existsSync(join(root, STORIES_FILE)), `${said(nameless)}; ${said(none.out)}; calls=${none.calls}`);

  const agreed = await door("agree", { root, by, _now: () => new Date(AT) });
  const first = await stories(root);
  check("once the PM agrees this exact revision, the writer runs once and the backlog persists",
    !agreed.error && agreed.value.agreement.by === by && agreed.value.agreement.prd_hash === loadPrd(root).meta.content_hash
      && !first.out.error && first.calls === 1 && loadStories(root)?.stories?.length === 2, `${said(agreed)}; ${said(first.out)}`);

  // A material change lands through the amend door: the agreement no longer covers what is on the record.
  const target = "/requirements/1/acceptance_criteria/0/statement";
  const amd = doors.propose({ root, target, to: "The run sheet lists every delivery expected this shift, in arrival order.", rationale: "Arrival order is what a lead works through.", by });
  doors.approve({ root, id: amd.amendment.id, by, radius: [...amd.amendment.radius.criteria, ...amd.amendment.radius.stories, ...amd.amendment.radius.screens] });
  const backlogBefore = bytes(root, STORIES_FILE);
  const stale = await stories(root);
  check("after an approved change, the old agreement does not count: stories are refused naming the change, and the backlog is byte-identical",
    refused(stale.out, "agreement-stale") && stale.out.error.message.includes(amd.amendment.id) && stale.calls === 0 && bytes(root, STORIES_FILE) === backlogBefore, said(stale.out));

  const prdBefore = bytes(root, PRD_FILE);
  const early2 = await door("agree", { root, by });
  check("the PM cannot agree to a prototype built from an older PRD, and the refused agreement leaves the PRD byte-identical",
    refused(early2, "prototype-stale") && bytes(root, PRD_FILE) === prdBefore, said(early2));

  await build(root, [ASIDE]);
  const again = await door("agree", { root, by });
  const second = await stories(root);
  check("rebuilt and agreed again, the writer runs and the backlog is rewritten", !again.error && !second.out.error && second.calls === 1, `${said(again)}; ${said(second.out)}`);

  await build(root, [ASIDE], []); // the PRD is unchanged; what the prototype shows is not
  const reshaped = await stories(root);
  check("a rebuild that changes what the prototype shows voids the agreement too: stories are refused until the PM agrees to it",
    refused(reshaped.out, "agreement-stale") && reshaped.out.error.message.includes("prototype") && reshaped.calls === 0, said(reshaped.out));

  // The rewrite run: a rebuild that raises a blocking question holds the rewrite, even with the agreement still current.
  const rebuilt = await build(root, [ASIDE, LATER]);
  const backlogNow = bytes(root, STORIES_FILE);
  const held = await stories(root);
  check("a rebuild that raises a blocking question holds the rewrite before the writer runs, naming the question; the backlog is byte-identical",
    !rebuilt.error && refused(held.out, "blocking-question") && held.out.error.message.includes(LATER.question) && held.calls === 0 && bytes(root, STORIES_FILE) === backlogNow, said(held.out));
});

// ── the answered-question run: answered through the door, rebuilt, agreed — then stories ──
await withRoot({}, async (parent) => {
  const root = seedProject(parent);
  await build(root, [ASIDE, BLOCKER]);
  await door("agree", { root, by });
  const blocked = await stories(root);
  await attempt(() => doors.answer({ root, pq: "PQ-2", req: "REQ-1", answer: "No.", criterion: DECISION, by }));
  const stale = await door("agree", { root, by });
  await build(root, [ASIDE, BLOCKER]);
  await door("agree", { root, by });
  const out = await stories(root, [RULED_SCENARIO]);
  check("the blocking question holds stories until the PM answers it through the door; rebuilt and agreed, the writer runs once and the backlog persists",
    refused(blocked.out, "blocking-question") && refused(stale, "prototype-stale") && !out.out.error && out.calls === 1 && loadStories(root)?.stories?.[0]?.scenarios?.length === 3,
    `${said(blocked.out)}; ${said(stale)}; ${said(out.out)}; ${asked(root)}`);
});

// ── the PM's own words: a later turn contradicting a ruling is a proposal, never an edit ──
await withRoot({}, async (parent) => {
  const root = seedProject(parent);
  const ruling = doors.answer({ root, req: "REQ-1", question: BLOCKER.question, answer: "No.", criterion: DECISION, by }).ruling;
  appendTranscript(root, "requirements", { at: AT, from: "pm", text: `Actually, I've changed my mind: ${CONTRARY}` });
  appendTranscript(root, "requirements", { at: AT, from: "workshop", text: "Noted.", mode: "socratic", signals: [] });
  const prd = loadPrd(root);
  const candidate = structuredClone({ requirements: prd.requirements, surfaces: prd.surfaces, mvp: prd.mvp });
  candidate.requirements[0].acceptance_criteria[2].statement = CONTRARY;
  const out = await attempt(() => extract({ root, key: "requirements", _query: scripted({ structured: candidate }).query }));
  const after = loadPrd(root);
  const held = (after.amendments ?? []).find((a) => a.status === "proposed" && a.radius.criteria.includes(ruling.criterion));
  check("even in the PM's own words, extraction never applies a reversal of a ruling: it is held as a workshop proposal, audited at mint",
    !out.error && after.requirements[0].acceptance_criteria[2].statement === DECISION && held?.origin === "workshop" && JSON.stringify(held?.to).includes(CONTRARY)
      && readVerdict(root, `${doors.AUDIT_GATE}/${held.id}`)?.gate === doors.AUDIT_GATE,
    `${said(out)}; REQ-1/AC-3=${after.requirements[0].acceptance_criteria[2]?.statement}; proposal=${held ? `${held.id} ${held.origin}` : "none"}`);

  const ok = held ? await attempt(() => doors.approve({ root, id: held.id, by, radius: [...held.radius.criteria, ...held.radius.stories, ...held.radius.screens] })) : { error: new Error("nothing to approve") };
  const now = loadPrd(root);
  const rid = now.rulings.find((r) => r.id === ruling.id);
  const rides = rulingsOf(now).find((r) => r.id === ruling.id);
  check("approving it changes the criterion and the version, keeps the ruling on the record as superseded, and agents read the decision as it now stands",
    !ok.error && now.requirements[0].acceptance_criteria[2].statement === CONTRARY && now.meta.version !== after.meta.version
      && rid?.answer === "No." && rid?.superseded_by === held?.id && Boolean(rides?.answer?.includes(CONTRARY)),
    `${said(ok)}; ruling=${JSON.stringify(rid)}; rides=${JSON.stringify(rides)}`);
});

done();
