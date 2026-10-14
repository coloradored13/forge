#!/usr/bin/env node
// owns: R3 · shared — eval: rulings. A PM's answer becomes a criterion in one
// operation — attributed, pinned to the PRD version it landed in — and the ruling rides
// into every writer and reviewer after it; a finding that re-raises it is removed and
// counted, never shown. Both directions: the door refuses what is not a ruling, and a
// judge run on a scripted model has its re-raises cut while its real findings stand.
// An extraction cannot remove a ruled criterion, and its rewording is held for the PM.

import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { suite, withRoot, scripted } from "./_harness.mjs";
import { seedProject, seedPrototype } from "./_fixture.mjs";
import { outputContract, validate } from "../shared/schema/index.mjs";
import { verify } from "../shared/hash.mjs";
import { mechanics } from "../shared/prompt/index.mjs";
import { runJudge, splitReraised } from "../shared/judge/index.mjs";
import { rows, funnelPath } from "../shared/funnel.mjs";
import { loadPrd, extract, appendTranscript } from "../discovery/workshop/index.mjs";
import { ledgerPath } from "../discovery/setup/index.mjs";
import { rows as calls } from "../shared/agent-call/ledger.mjs";
import { Refused, rulingsOf, staleness, PRD_FILE } from "../discovery/record/index.mjs";
import { answer } from "../discovery/doors/index.mjs";

const { check, done } = suite("rulings · R3 answers are spec", 33);

const refusal = (fn) => { try { fn(); return null; } catch (e) { return e; } };

await withRoot({}, async (parent) => {
  const root = seedProject(parent);
  seedPrototype(root);
  const before = loadPrd(root);

  // ── the door refuses what is not a ruling ──
  const by = "Brad";
  for (const [code, args] of [
    ["no-author", { req: "REQ-1", oq: "OQ-1", answer: "No." }],
    ["no-answer", { req: "REQ-1", oq: "OQ-1", by }],
    ["unknown-req", { req: "REQ-9", oq: "OQ-1", answer: "No.", by }],
    ["unknown-question", { req: "REQ-1", oq: "OQ-9", answer: "No.", by }],
    ["no-question", { req: "REQ-1", answer: "No.", by }],
  ]) {
    const e = refusal(() => answer({ root, ...args }));
    check(`answer refuses ${code}`, e instanceof Refused && e.code === code, e?.code ?? "no refusal");
  }
  check("a refused answer leaves the PRD where it was", loadPrd(root).meta.content_hash === before.meta.content_hash && loadPrd(root).rulings.length === 0);

  // ── one operation: criterion, closed question, version, ruling, flag, hash ──
  const at = new Date("2026-09-04T10:00:00Z");
  const r1 = answer({ root, req: "REQ-1", oq: "OQ-1", answer: "No — the door closes the record when the truck leaves.", criterion: "An exception cannot be recorded against a delivery marked departed.", by, _now: () => at });
  const prd = loadPrd(root);
  const req = prd.requirements.find((r) => r.id === "REQ-1");
  check("the answer became AC-3 of REQ-1, worded as the criterion, and the ruling joins to it",
    r1.ruling.id === "RUL-1" && r1.criterion.id === "AC-3" && req.acceptance_criteria.at(-1).statement === "An exception cannot be recorded against a delivery marked departed." && r1.ruling.criterion === "REQ-1/AC-3", JSON.stringify(r1.ruling));
  check("the ruling is attributed, dated, and carries the question and the answer as given",
    r1.ruling.by === "Brad" && r1.ruling.at === at.toISOString() && r1.ruling.oq === "OQ-1" && r1.ruling.question === "Can an exception be recorded after the truck has left?" && /door closes the record/.test(r1.ruling.answer));
  check("the open question is answered on the record, not deleted", prd.open_questions.find((q) => q.id === "OQ-1").status === "answered" && prd.open_questions.length === 2);
  check("a ruling is material: the version bumps minor, 0.1.0 → 0.2.0, and the ruling names it", before.meta.version === "0.1.0" && prd.meta.version === "0.2.0" && r1.ruling.version === "0.2.0");
  check("the ruling pins the PRD hash it landed in, which is the hash on disk, and the document verifies",
    r1.ruling.prd_hash === prd.meta.content_hash && prd.meta.content_hash !== before.meta.content_hash && verify(prd).verdict === "pass" && validate("prd", prd).ok);
  check("the decision is on the flags trail", prd.flags.length === 1 && prd.flags[0].kind === "note" && /RUL-1 by Brad/.test(prd.flags[0].note) && /became REQ-1\/AC-3/.test(prd.flags[0].note), JSON.stringify(prd.flags));

  // ── settled is settled ──
  const again = refusal(() => answer({ root, req: "REQ-1", oq: "OQ-1", answer: "Yes, actually.", by }));
  check("an answered question is not re-answered — amend the criterion it became", again instanceof Refused && again.code === "already-ruled" && /amend/.test(again.message));
  const same = refusal(() => answer({ root, req: "REQ-2", question: "can an exception be recorded after the truck has left?", answer: "Yes.", by }));
  check("the same question asked without its OQ id is caught by its wording", same instanceof Refused && same.code === "already-ruled" && /RUL-1/.test(same.message));
  const r2 = answer({ root, req: "REQ-1", question: "Is a photo required with every exception?", answer: "No; optional.", by, _now: () => at });
  check("a question with no OQ can still be ruled on; ids advance", r2.ruling.id === "RUL-2" && r2.ruling.oq === undefined && r2.criterion.id === "AC-4" && loadPrd(root).meta.version === "0.3.0");

  // ── the ruling rides into every agent after it ──
  const rulings = rulingsOf(loadPrd(root));
  check("rulingsOf carries id, question, answer and the criterion — nothing else", rulings.length === 2 && Object.keys(rulings[0]).sort().join() === "answer,criterion,id,oq,question" && Object.keys(rulings[1]).sort().join() === "answer,criterion,id,question");
  const text = mechanics({ kind: "reviewer", schema: "finding", rulings });
  check("the mechanics half shows each ruling as settled, not to be re-raised", /## Rulings — settled, not to be re-raised[\s\S]*\*\*RUL-1\*\* Can an exception be recorded after the truck has left\?\n\s*→ No — the door closes/.test(text), text.slice(text.indexOf("## Rulings"), text.indexOf("## Rulings") + 300));

  // The prototype is now stale against 0.3.0, with the two rulings named as why.
  const s = staleness(root);
  check("the prototype wears the stale badge with the rulings that landed since it was built", s.prototype.stale && s.prototype.prd_moved && s.prototype.traced_version === "0.1.0" && s.prototype.current_version === "0.3.0" && s.prototype.since.join() === "RUL-1,RUL-2", JSON.stringify(s.prototype));

  // ── a judge's re-raises are removed and counted; real findings stand ──
  const f = (subject, extra = {}) => ({ severity: "high", confidence: "certain", rule: "x", subject, summary: `about ${subject}`, evidence: "e", remedy: "r", ...extra });
  const findings = [
    f("RUL-1"),
    f("OQ-1", { summary: "the truck question is still open" }),
    f("STORY-1", { evidence: "this contradicts RUL-1's answer" }),
    f("REQ-1/AC-3", { rule: "then-not-observable" }),
    f("STORY-2", { rule: "not-a-slice", severity: "medium", confidence: "likely" }),
  ];
  const split = splitReraised(findings, rulings);
  check("splitReraised: by subject — the ruling, or the question it answered", split.reraised.map((x) => x.subject).join() === "RUL-1,OQ-1" && split.reraised.every((x) => x.ruling === "RUL-1"));
  check("a defect that cites the ruling it breaks is a defect, not a re-raise: STORY-1 survives on its subject, whatever its evidence argues",
    split.kept.map((x) => x.subject).join() === "STORY-1,REQ-1/AC-3,STORY-2", JSON.stringify(split.kept.map((x) => x.subject)));
  check("a high/certain finding removed as a re-raise could never block — so the text is never what removes it",
    splitReraised([f("STORY-9", { summary: "SMS recovery contradicts RUL-1, which requires email" })], rulings).kept.length === 1);
  check("splitReraised: a finding about the criterion the ruling became is held to", splitReraised([f("REQ-1/AC-3", { evidence: "see RUL-1" })], rulings).reraised.length === 0);
  check("with no rulings nothing is removed", splitReraised(findings, []).kept.length === 5);

  const q = scripted({ structured: { findings, deferred: [], checked: 2, skipped: 0 } });
  const identity = join(parent, "reviewer.md");
  writeFileSync(identity, "# Reviewer\n\nYou hold stories to the bar a PM would.");
  const verdict = await runJudge({ gate: "story-reviewer", half: "discovery", stage: "stories", identity, sections: [["Stories", "…"]], artifacts: [{ id: "prd-dock", path: PRD_FILE, doc: loadPrd(root) }], rulings, funnel: funnelPath(root), cwd: root, ledger: ledgerPath(root), _query: q.query });
  check("runJudge removes the two re-raises and keeps the three findings about artifacts",
    verdict.reraised === 2 && verdict.findings.map((x) => x.subject).join() === "STORY-1,REQ-1/AC-3,STORY-2" && verdict.verdict === "block" && !("dropped" in verdict), JSON.stringify(verdict.findings.map((x) => x.subject)));
  check("what was removed is on the verdict whole, not only counted — a count says something went and never what",
    verdict.removed.length === 2 && verdict.removed.map((x) => `${x.subject}:${x.ruling}`).join() === "RUL-1:RUL-1,OQ-1:RUL-1" && verdict.removed.every((x) => x.summary && x.rule), JSON.stringify(verdict.removed));
  check("the verdict validates with reraised and removed on it", validate("finding", verdict).ok && verdict.judged[0].content_hash === loadPrd(root).meta.content_hash);
  check("neither is the model's to write: removed and ruling are absent from the output contract",
    !("removed" in outputContract("finding").properties) && !("ruling" in outputContract("finding").properties.findings.items.properties));
  const funnel = rows(funnelPath(root));
  check("each re-raise is a funnel row naming the gate, the rule, the subject and the ruling (R8)",
    funnel.length === 2 && funnel.every((r) => r.signal === "reraised" && r.gate === "story-reviewer" && r.ruling === "RUL-1") && funnel.map((r) => r.subject).join() === "RUL-1,OQ-1", JSON.stringify(funnel));
  check("the judge was shown the rulings in its system prompt", /RUL-1/.test(q.calls[0].options.systemPrompt) && /RUL-2/.test(q.calls[0].options.systemPrompt));

  const clean = scripted({ structured: { findings: [f("REQ-1/AC-3")], deferred: [], checked: 1, skipped: 0 } });
  const v2 = await runJudge({ gate: "story-reviewer", half: "discovery", stage: "stories", identity, sections: [], artifacts: [], rulings: [], funnel: funnelPath(root), cwd: root, ledger: ledgerPath(root), _query: clean.query });
  check("with no rulings a judge run records nothing and removes nothing", v2.reraised === 0 && v2.removed.length === 0 && v2.findings.length === 1 && rows(funnelPath(root)).length === 2);
  check("no model was reached: every call went through the script, and the ledger holds them", q.calls.length === 1 && clean.calls.length === 1 && existsSync(ledgerPath(root)) && calls(ledgerPath(root)).length === 2);
});

// ── the ruled-criterion guard: an extraction cannot take a ruling back ──
await withRoot({}, async (parent) => {
  const root = seedProject(parent);
  answer({ root, req: "REQ-1", oq: "OQ-1", answer: "No.", criterion: "An exception cannot be recorded against a delivery marked departed.", by: "Brad" });
  appendTranscript(root, "requirements", { at: "2026-09-04T11:00:00.000Z", from: "pm", text: "Tidy the criteria's wording." });
  const prd = loadPrd(root);
  const cut = (edit) => { const c = structuredClone({ requirements: prd.requirements, surfaces: prd.surfaces, mvp: prd.mvp }); edit(c.requirements[0].acceptance_criteria); return scripted({ structured: c }).query; };
  const before = readFileSync(join(root, PRD_FILE), "utf8");
  let gone = null;
  try { await extract({ root, key: "requirements", _query: cut((acs) => acs.splice(2, 1)) }); } catch (e) { gone = e; }
  check("an extraction that removes a ruled criterion is refused naming it and its ruling, and the PRD is byte-identical",
    gone instanceof Refused && gone.code === "ruled-criterion" && /REQ-1\/AC-3/.test(gone.message) && /RUL-1/.test(gone.message) && readFileSync(join(root, PRD_FILE), "utf8") === before, gone?.message);
  const out = await extract({ root, key: "requirements", _query: cut((acs) => { acs[2].statement = "Exceptions may be recorded after departure."; }) });
  const after = loadPrd(root);
  check("one that rewords it keeps the PM's words and holds the new ones as a workshop proposal on that criterion",
    after.requirements[0].acceptance_criteria[2].statement === prd.requirements[0].acceptance_criteria[2].statement && out.held.length === 1
      && after.amendments[0].origin === "workshop" && after.amendments[0].target === "/requirements/0/acceptance_criteria/2/statement" && after.amendments[0].to === "Exceptions may be recorded after departure.", JSON.stringify(after.amendments));
});

done();
