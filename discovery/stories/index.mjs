// owns: R13 · discovery — the stories: the backlog a team can take, written from the
// PRD and the prototype at the PM's bar. One composer reads the record and returns the
// backlog; the runner keeps ids sticky, holds the backlog to the line's arithmetic —
// every criterion inside the line proved by a scenario, every reference resolving,
// nothing past the line — and files the verdict. One reviewer holds it to the craft a
// PM would: scenarios a person can read, slices a person would notice.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { skeleton, outputContract, validateAgainst } from "../../shared/schema/index.mjs";
import { identity, mechanics, assemble } from "../../shared/prompt/index.mjs";
import { call } from "../../shared/agent-call/index.mjs";
import { runJudge, deriveVerdict, pin, renderFindingsForAgent } from "../../shared/judge/index.mjs";
import { funnelPath } from "../../shared/funnel.mjs";
import { scopeOf } from "../../shared/scope.mjs";
import { loadProject, ledgerPath } from "../setup/index.mjs";
import { loadPrd, existingIds, PRD_FILE } from "../workshop/index.mjs";
import { Refused, readDoc, saveDoc, saveVerdict, freshVerdict, keepOutgoing, traceOf, rulingsOf, agreementGap, pendingReactions, insideRequirements, renderRequirement, renderPrd, renderPrototype, renderStories, PROTOTYPE_FILE, STORIES_FILE } from "../record/index.mjs";

const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), "prompts");
export const GATE = "story-arithmetic";
export const REVIEW_GATE = "story-reviewer";
export const ARITHMETIC = ["criterion-unproved", "criterion-proved-twice", "ref-unknown", "story-past-line", "story-outside-epic", "story-without-screen", "scenario-malformed", "requirement-without-epic", "epic-past-line"];
const WRITES = new Set(["Write", "Edit", "Bash", "NotebookEdit"]);
const STEP = /^(Given|When|Then|And|But)\b/;

export function loadStories(root) { return readDoc(root, STORIES_FILE); }

/**
 * Write or rewrite the backlog. Refused before the line is drawn and before a prototype
 * exists — the stories claim screens, so there must be screens to claim. Refused, before
 * any call, while a reaction's proposed change still waits on the PM, while the prototype
 * asks a blocking question the PM has not answered, and
 * without the PM's agreement to this exact PRD and prototype. The composer has no write
 * surface; what it returns is validated, its ids must survive from the previous backlog,
 * and the arithmetic is checked and filed beside it; the backlog it replaces is kept in
 * the history first. A fresh reviewer verdict on the previous backlog rides into the
 * prompt (R13).
 */
export async function write({ root, notes, onEvent, _query, _sleep }) {
  const project = loadProject(root);
  const prd = loadPrd(root);
  const scope = scopeOf(prd);
  if (!scope) throw new Refused("no-line", "stories: the MVP line is not drawn — a backlog is what is inside it");
  const proto = readDoc(root, PROTOTYPE_FILE);
  if (!proto) throw new Refused("no-prototype", "stories: there is no prototype — stories claim the screens they happen on, so build it first");
  const pending = pendingReactions(prd);
  if (pending.length) throw new Refused("reaction-pending", `stories: the PM's reaction is still waiting on its proposed change — ${pending.map((r) => `${r.id} (${r.proposal})`).join(", ")}. Approve or reject it before the backlog is written on the old meaning.`, pending);
  const asked = (proto.open_questions ?? []).filter((q) => q.blocking && q.status !== "answered");
  if (asked.length) throw new Refused("blocking-question", `stories: the prototype asks what the PM must decide first — ${asked.map((q) => `${q.id ?? "(no id; rebuild the prototype)"} "${q.question}"`).join("; ")}. Answer it through the answer door, then agree the revision.`, asked);
  const gap = agreementGap(prd, proto);
  if (gap?.rule === "no-agreement") throw new Refused(gap.rule, `stories: ${gap.why} — review the PRD and the prototype, then agree to them`);
  if (gap) throw new Refused(gap.rule, `stories: ${gap.why}. Agree again before the backlog is written.`);
  const prior = loadStories(root);
  const priorIds = prior ? existingIds(prior, ["epics", "stories"]) : [];
  const review = freshVerdict(root, REVIEW_GATE);

  const system = assemble({
    identity: identity(join(PROMPTS, "writer.md")),
    mechanics: mechanics({ kind: "writer", schema: "story", scope, rulings: rulingsOf(prd), arithmetic: ARITHMETIC }),
  });
  const findings = review ? renderFindingsForAgent(review) : null;
  const prompt = [
    renderPrd(prd),
    `## Prototype\n\n${renderPrototype(proto)}`,
    priorIds.length ? `## Existing ids — keep these for the same epics and stories; mint new ones only for new work\n\n${priorIds.map((p) => `- ${p.id}: ${p.label}`).join("\n")}` : "",
    notes?.trim() ? `## The PM's notes\n\n${notes.trim()}` : "",
    findings ? `## The reviewer's findings on the previous backlog\n\n${findings}` : "",
  ].filter(Boolean).join("\n\n");

  const res = await call({
    half: "discovery", stage: "stories", role: "writer", kind: "compose",
    system, prompt, cwd: root, outputSchema: outputContract("story"),
    ledger: ledgerPath(root), budget: project.budget, models: project.models,
    onEvent, _query, _sleep,
  });

  const wrote = res.toolUses.filter((t) => WRITES.has(t.name));
  if (wrote.length) throw new Refused("wrote", `stories: the writer used ${wrote.map((t) => t.name).join(", ")} — it composes, the runner writes`, wrote);
  if (res.structured === undefined) throw new Refused("no-structured-output", "stories: the writer returned no backlog");
  const v = validateAgainst(outputContract("story"), res.structured);
  if (!v.ok) throw new Refused("stories-invalid", `stories: the backlog does not fit the contract — ${v.errors.slice(0, 5).join("; ")}`, v.errors);

  const doc = { ...skeleton("story"), id: `stories-${prd.meta.slug}`, traces: traceOf(prd, proto), ...res.structured };
  const kept = new Set([...doc.epics.map((e) => e.id), ...doc.stories.map((s) => s.id)]);
  const dropped = priorIds.filter((p) => !kept.has(p.id));
  if (dropped.length) throw new Refused("ids-dropped", `stories: the rewrite dropped ${dropped.map((p) => p.id).join(", ")} — ids are sticky; a story that went away is a note, not a silence`, dropped);

  keepOutgoing(root, "stories", STORIES_FILE);
  saveDoc(root, STORIES_FILE, "story", doc);
  const arithmetic = { ...checkStories(prd, proto, doc), judged: pins(prd, proto, doc) };
  saveVerdict(root, arithmetic);
  return { stories: doc, arithmetic, model: res.model, usd: res.usd };
}

/** The reviewer at the PM's bar (R13): reads the PRD, the prototype and the backlog; the verdict is filed under its gate. */
export async function review({ root, onEvent, _query, _sleep }) {
  const project = loadProject(root);
  const prd = loadPrd(root);
  const proto = readDoc(root, PROTOTYPE_FILE);
  const doc = loadStories(root);
  if (!doc) throw new Refused("no-stories", "stories: there is no backlog to review");
  if (!proto) throw new Refused("no-prototype", "stories: the prototype the backlog was written from is gone");
  const verdict = await runJudge({
    gate: REVIEW_GATE, half: "discovery", stage: "stories",
    identity: join(PROMPTS, "reviewer.md"),
    sections: [
      ["Requirements inside the line", insideRequirements(prd).map(renderRequirement).join("\n") || "(none)"],
      ["Vocabulary", (prd.shape?.vocabulary ?? []).map((t) => `- **${t.term}**: ${t.definition}`).join("\n") || "(none defined)"],
      ["Prototype screens", renderPrototype(proto)],
      ["Stories", renderStories(doc)],
    ],
    artifacts: artifactsOf(prd, proto, doc),
    scope: scopeOf(prd), rulings: rulingsOf(prd), arithmetic: ARITHMETIC, funnel: funnelPath(root),
    cwd: root, ledger: ledgerPath(root), budget: project.budget, models: project.models, onEvent, _query, _sleep,
  });
  saveVerdict(root, verdict);
  return verdict;
}

/** What a verdict on the backlog is about: the PRD, the prototype and the backlog itself. */
function artifactsOf(prd, proto, doc) {
  return [{ id: prd.id, path: PRD_FILE, doc: prd }, { id: proto.id, path: PROTOTYPE_FILE, doc: proto }, { id: doc.id, path: STORIES_FILE, doc }];
}
const pins = (prd, proto, doc) => artifactsOf(prd, proto, doc).map(pin);

/** Every non-empty line is a step; there is a When and a Then. Syntax only — whether the steps mean anything is the reviewer's. */
export function gherkinShape(text) {
  const lines = String(text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const bad = lines.filter((l) => !STEP.test(l));
  if (bad.length) return `line "${bad[0]}" is not a Given/When/Then/And/But step`;
  if (!lines.some((l) => l.startsWith("When"))) return "no When — nothing happens";
  if (!lines.some((l) => l.startsWith("Then"))) return "no Then — nothing is observed";
  return null;
}

/**
 * The line's arithmetic over the backlog (R13), finding-shaped like every gate. Every
 * criterion inside the line is proved exactly once; every reference resolves; nothing
 * past the line has a story; every story sits in its epic, on its screens, and reads
 * as Gherkin.
 */
export function checkStories(prd, proto, doc) {
  const findings = [];
  const f = (severity, rule, subject, summary, evidence, remedy) => findings.push({ severity, confidence: "certain", rule, subject, summary, evidence, remedy });
  const inside = new Set(prd.mvp?.inside ?? []);
  const reqs = new Map((prd.requirements ?? []).map((r) => [r.id, r]));
  const criteria = new Set([...reqs.values()].flatMap((r) => (r.acceptance_criteria ?? []).map((ac) => `${r.id}/${ac.id}`)));
  const screens = new Map((proto.screens ?? []).map((s) => [s.id, s]));
  const onScreen = new Set([...screens.values()].flatMap((s) => s.req_refs));
  const epics = new Map((doc.epics ?? []).map((e) => [e.id, e]));
  const stories = doc.stories ?? [];
  const proved = new Map();

  for (const e of epics.values()) {
    if (!reqs.has(e.req_ref)) f("high", "ref-unknown", e.id, `${e.id} is for ${e.req_ref}, which is not a requirement.`, `\`/epics\` ${e.id} req_ref ${e.req_ref}; \`/requirements\` has no such id.`, "Point the epic at a requirement the PRD holds.");
    else if (!inside.has(e.req_ref)) f("high", "epic-past-line", e.id, `${e.id} is for ${e.req_ref}, which is not inside the line.`, `\`/mvp/inside\` does not name ${e.req_ref}.`, "Drop the epic; the backlog is what is inside the line.");
  }
  for (const s of stories) {
    const epic = epics.get(s.epic);
    if (!epic) f("high", "ref-unknown", s.id, `${s.id} is in ${s.epic}, which is not an epic here.`, `\`/stories\` ${s.id} epic ${s.epic}; \`/epics\` has no such id.`, "Put the story in an epic that exists.");
    else if (!s.req_refs.includes(epic.req_ref)) f("high", "story-outside-epic", s.id, `${s.id} sits in ${s.epic} (${epic.req_ref}) but does not deliver ${epic.req_ref}.`, `\`/stories\` ${s.id} req_refs [${s.req_refs.join(", ")}] lacks ${epic.req_ref}.`, "Move the story to the epic for what it delivers, or add the epic's requirement to its req_refs.");
    for (const r of s.req_refs) {
      if (!reqs.has(r)) f("high", "ref-unknown", s.id, `${s.id} delivers ${r}, which is not a requirement.`, `\`/stories\` ${s.id} req_refs names ${r}; \`/requirements\` has no such id.`, "Reference a requirement the PRD holds.");
      else if (!inside.has(r)) f("high", "story-past-line", s.id, `${s.id} delivers ${r}, which is not inside the line.`, `\`/mvp/inside\` does not name ${r}.`, "Drop the story or the reference; nothing past the line gets a story.");
    }
    for (const sc of s.screen_refs) {
      if (!screens.has(sc)) f("high", "ref-unknown", s.id, `${s.id} happens on ${sc}, which the prototype does not have.`, `\`/stories\` ${s.id} screen_refs names ${sc}; the prototype's \`/screens\` has no such id.`, "Claim a screen the prototype shows.");
    }
    if (!s.screen_refs.length && s.req_refs.some((r) => onScreen.has(r))) {
      const shown = s.req_refs.filter((r) => onScreen.has(r));
      f("medium", "story-without-screen", s.id, `${s.id} claims no screen, but the prototype shows ${shown.join(", ")}.`, `\`/stories\` ${s.id} screen_refs is empty; ${[...screens.values()].filter((sc) => sc.req_refs.some((r) => shown.includes(r))).map((sc) => sc.id).join(", ")} show what it delivers.`, "Claim the screens the story happens on, or say in notes why none applies.");
    }
    (s.scenarios ?? []).forEach((sc, i) => {
      const shape = gherkinShape(sc.gherkin);
      if (shape) f("high", "scenario-malformed", `${s.id}#${i + 1}`, `Scenario "${sc.name}" in ${s.id} is not Gherkin: ${shape}.`, `\`/stories\` ${s.id} scenarios[${i}].gherkin: ${shape}.`, "Every non-empty line is a Given/When/Then/And/But step; there is a When and a Then.");
      for (const c of sc.proves) {
        if (!criteria.has(c)) f("high", "ref-unknown", `${s.id}#${i + 1}`, `Scenario "${sc.name}" proves ${c}, which is not a criterion.`, `\`/stories\` ${s.id} scenarios[${i}].proves names ${c}; no requirement has it.`, "Prove a criterion the PRD holds, as REQ-n/AC-m.");
        else proved.set(c, [...(proved.get(c) ?? []), `${s.id}#${i + 1}`]);
      }
    });
  }
  const covered = new Set([...epics.values()].map((e) => e.req_ref));
  for (const r of inside) {
    const req = reqs.get(r);
    if (!req || req.type !== "functional") continue;
    if (!covered.has(r)) f("high", "requirement-without-epic", r, `${r} is inside the line and has no epic.`, `\`/mvp/inside\` names ${r}; no \`/epics\` entry has req_ref ${r}.`, "One epic per functional requirement inside the line.");
    for (const ac of req.acceptance_criteria ?? []) {
      const id = `${r}/${ac.id}`;
      const by = proved.get(id) ?? [];
      if (!by.length) f("high", "criterion-unproved", id, `${id} is inside the line and no scenario proves it.`, `${id}: ${ac.statement}; no scenario's \`proves\` names it.`, "Write the scenario that proves it, or say in an open question why it cannot be proved yet.");
      else if (by.length > 1) f("medium", "criterion-proved-twice", id, `${id} is proved by ${by.length} scenarios.`, `${id} proved by ${by.join(", ")}.`, "One scenario per criterion; a second proof is a scenario that proves nothing new, or a criterion that should be two.");
    }
  }
  const checked = epics.size + stories.length + [...inside].filter((r) => reqs.get(r)?.type === "functional").length;
  return { gate: GATE, verdict: deriveVerdict(findings), findings, deferred: [], checked, skipped: 0 };
}
