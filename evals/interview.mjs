#!/usr/bin/env node
// owns: R15 · shared — Stages 0–3: triggered craft, adaptive calls, reconciliation,
// record-only derivation, reaction feedback, retention and first-release exports.

import { existsSync, readFileSync } from "node:fs";
import { suite, withRoot } from "./_harness.mjs";
import { CRAFT, ALWAYS } from "../discovery/interview/craft.mjs";
import { OPENING, SESSION_FILE, derive, exportSession, flushRecord, interviewTurn, loadSession, openSession, react } from "../discovery/interview/index.mjs";

const { check, done } = suite("interview", 29);
const answer = (role, overrides = {}) => {
  if (role === "assess") return { activate: ["inversion"], reason: "system property" };
  if (role === "interview") return { posture: "pressure-testing", reason: "This decides observable behavior.", question: "Who is unable to alter the submitted record?", expected_answer: "short-factual", record_delta: [{ type: "claim", content: "Submitted records cannot be altered.", status: "proposed", evidence: "reported" }] };
  if (role === "reconcile") return { entries: [{ id: "REC-A", type: "requirement", content: "A reviewer cannot edit a submitted record.", status: "settled", evidence: "reported" }], unfitted: overrides.unfitted ?? [] };
  if (role === "derive") return { consequences: [{ sources: ["REC-A"], scenario: "A reviewer submits a decision and then notices a typo.", result: "The reviewer cannot edit it.", record_says: "A reviewer cannot edit a submitted record.", assumed: "Submission is the boundary.", unspecified: "Whether an administrator can correct it." }] };
  throw new Error(role);
};

check("the opener asks one question without demanding justification", OPENING === "What are you considering building?" && (OPENING.match(/\?/g) ?? []).length === 1);
check("the always-loaded kernel declares both postures", ALWAYS.includes("drawing-out") && ALWAYS.includes("pressure-testing"));
check("inversion is an independent triggered unit", CRAFT.some((x) => x.id === "inversion" && /property of the system/.test(x.trigger)));
check("ownability is an independent triggered unit", CRAFT.some((x) => x.id === "ownability" && /acceptance criterion/.test(x.trigger)));
check("all craft units document a trigger", CRAFT.every((x) => x.id && x.trigger && x.instruction));

await withRoot({}, async (root) => {
  const s = openSession({ root, seed: "A decision log for reviewers", _now: () => "2026-09-16T00:00:00.000Z" });
  check("a real answer opens directly in defining", s.phase === "defining" && s.transcript[0].text.includes("decision log"));
  check("the session is retained", existsSync(`${root}/${SESSION_FILE}`));
  check("the opening event is retained", readFileSync(`${root}/discovery/interview/events.jsonl`, "utf8").includes("session.opened"));

  const seen = [];
  const invoke = async (role, input) => { seen.push({ role, input }); return answer(role); };
  const first = await interviewTurn({ root, text: "The system must never change a submitted record", _invoke: invoke });
  check("a new claim invokes assessor then interviewer", seen.map((x) => x.role).join(",") === "assess,interview", JSON.stringify(seen.map((x) => x.role)));
  check("the selected craft is foregrounded", first.craft[0] === "inversion");
  check("posture and reason are visible", first.posture === "pressure-testing" && first.reason.length > 0);
  check("one question is returned", (first.text.match(/\?/g) ?? []).length === 1);
  check("turn telemetry exposes call count", first.telemetry.calls === 2 && first.telemetry.assessed && !first.telemetry.reconciled);

  seen.length = 0;
  const second = await interviewTurn({ root, text: "The reviewer", _invoke: invoke });
  check("a short factual answer skips reassessment", seen.map((x) => x.role).join(",") === "interview", JSON.stringify(seen.map((x) => x.role)));
  check("a reused craft turn needs only one foreground call", second.telemetry.foreground === 1 && !second.telemetry.reconciled);

  seen.length = 0;
  const third = await interviewTurn({ root, text: "Only after submission", _invoke: invoke });
  check("three pending deltas force reconciliation", seen.map((x) => x.role).join(",") === "interview,reconcile" && third.telemetry.reconciled);
  const after = loadSession(root);
  check("the reconciler is authoritative", after.record.entries[0].content === "A reviewer cannot edit a submitted record.");
  check("pending deltas are cleared after reconciliation", after.pending.length === 0);

  seen.length = 0;
  await interviewTurn({ root, text: "That is the settled boundary", _invoke: invoke });
  check("the next turn reads the reconciled record", seen.find((x) => x.role === "interview")?.input.record.entries[0].content === "A reviewer cannot edit a submitted record.");

  await flushRecord({ root, _invoke: async (role) => answer(role, { unfitted: [{ content: "The ritual matters to the team", reason: "No current type captures cultural practice." }] }) });
  // flush is empty here; create a forced reconciliation that carries unfitted content.
  await interviewTurn({ root, text: "That ritual matters but it is not a requirement", action: "correct", _invoke: async (role) => answer(role, { unfitted: [{ content: "The ritual matters to the team", reason: "No current type captures cultural practice." }] }) });
  check("did-not-fit content remains visible", loadSession(root).record.unfitted.some((x) => x.content.includes("ritual")));

  let derivationInput;
  const round = await derive({ root, _invoke: async (role, input) => { if (role === "derive") derivationInput = input; return answer(role); } });
  check("the deriver receives exactly one top-level input", Object.keys(derivationInput).join(",") === "record", JSON.stringify(Object.keys(derivationInput)));
  check("the deriver receives no transcript", !JSON.stringify(derivationInput).includes("The system must never change"));
  check("the context manifest marks the call record-only", round.calls.at(-1).record_only === true);
  check("a worked consequence carries provenance", round.consequences[0].record_says && round.consequences[0].assumed && round.consequences[0].unspecified);

  const c = react({ root, roundId: round.id, consequenceId: round.consequences[0].id, reaction: "reject", correction: "Administrators may correct it with a reason." });
  check("a rejection is retained on the consequence", c.status === "reject" && c.correction.includes("Administrators"));
  check("a rejected consequence unsettles its source", loadSession(root).record.entries.find((x) => x.id === "REC-A")?.status === "unsettled");
  check("a rejected consequence feeds a pending correction back", loadSession(root).pending.some((x) => x.content.includes("Administrators")));

  const files = exportSession({ root });
  check("Markdown and JSON exports are written", existsSync(files.markdown) && existsSync(files.json));
  check("Markdown exposes unfitted content", readFileSync(files.markdown, "utf8").includes("Did not fit"));
});

done();
