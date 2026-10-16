// owns: R2 · discovery — the design: the canonical production design, written from the
// PRD, the prototype and the backlog, refined to sign-off. One writer declares the
// standard it will be held to and composes one visual language and one design per
// claimed screen; the runner holds the set to the claim map — every claimed screen
// designed, every designed screen claimed, nothing past the line (R2) — and files the
// verdict. One reviewer judges it as a design director would: against the declared
// standard and the craft floor. A named person signs this exact design (§10.3); a
// blocking review is overridden only by a human's word, on the record.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { skeleton, outputContract, validateAgainst } from "../../shared/schema/index.mjs";
import { identity, mechanics, assemble } from "../../shared/prompt/index.mjs";
import { call } from "../../shared/agent-call/index.mjs";
import { runJudge, deriveVerdict, pin, renderFindingsForAgent } from "../../shared/judge/index.mjs";
import { funnelPath } from "../../shared/funnel.mjs";
import { scopeOf } from "../../shared/scope.mjs";
import { loadProject, ledgerPath } from "../setup/index.mjs";
import { loadPrd, savePrd, PRD_FILE } from "../workshop/index.mjs";
import { Refused, readDoc, saveDoc, saveVerdict, readVerdict, freshVerdict, keepOutgoing, traceOf, rulingsOf, isSigned, insideRequirements, renderRequirement, renderPrd, renderSurfaces, renderPrototype, renderStories, renderStandard, renderDesign, PROTOTYPE_FILE, STORIES_FILE, DESIGN_FILE } from "../record/index.mjs";

const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), "prompts");
export const GATE = "design-arithmetic";
export const REVIEW_GATE = "design-reviewer";
export const ARITHMETIC = ["screen-undesigned", "screen-unclaimed", "screen-unknown", "screen-designed-twice", "hero-unknown"];
const WRITES = new Set(["Write", "Edit", "Bash", "NotebookEdit"]);

export function loadDesign(root) { return readDoc(root, DESIGN_FILE); }

/**
 * Write or rewrite the design. Refused before the line, before a prototype and before a
 * backlog — the design covers the screens the stories claim, so both must exist. The
 * writer has no write surface; what it returns is validated, traced to all three by
 * hash, and the claim-map arithmetic is checked and filed beside it; the design it
 * replaces is kept in the history first. A fresh reviewer verdict on the previous design
 * rides into the prompt, as do its control ids.
 */
export async function write({ root, notes, onEvent, _query, _sleep }) {
  const project = loadProject(root);
  const prd = loadPrd(root);
  const scope = scopeOf(prd);
  if (!scope) throw new Refused("no-line", "design: the MVP line is not drawn — the design is what is inside it");
  const proto = readDoc(root, PROTOTYPE_FILE);
  if (!proto) throw new Refused("no-prototype", "design: there is no prototype — the design is keyed by its screens, so build it first");
  const stories = readDoc(root, STORIES_FILE);
  if (!stories) throw new Refused("no-stories", "design: there is no backlog — the design covers the screens the stories claim, so write them first");
  const prior = loadDesign(root);
  const review = freshVerdict(root, REVIEW_GATE);

  const system = assemble({
    identity: identity(join(PROMPTS, "writer.md")),
    mechanics: mechanics({ kind: "writer", schema: "design", scope, rulings: rulingsOf(prd), arithmetic: ARITHMETIC }),
  });
  const findings = review ? renderFindingsForAgent(review) : null;
  const priorIds = prior ? prior.screens.flatMap((s) => s.controls.map((c) => `${s.screen_ref} \`${c.id}\` ${c.kind} "${c.label}"`)) : [];
  const prompt = [
    renderPrd(prd),
    `## Prototype\n\n${renderPrototype(proto)}`,
    `## Stories — what happens on each screen\n\n${renderStories(stories)}`,
    prior ? `## The previous design's standard — keep it unless you say in your notes why it changed\n\n${renderStandard(prior.standard)}` : "",
    priorIds.length ? `## Existing control ids — keep these for the same controls; mint new ones only for new controls\n\n${priorIds.map((p) => `- ${p}`).join("\n")}` : "",
    notes?.trim() ? `## The PM's notes\n\n${notes.trim()}` : "",
    findings ? `## The reviewer's findings on the previous design\n\n${findings}` : "",
  ].filter(Boolean).join("\n\n");

  const res = await call({
    half: "discovery", stage: "design", role: "writer", kind: "compose",
    system, prompt, cwd: root, outputSchema: outputContract("design"),
    ledger: ledgerPath(root), budget: project.budget, models: project.models,
    onEvent, _query, _sleep,
  });

  const wrote = res.toolUses.filter((t) => WRITES.has(t.name));
  if (wrote.length) throw new Refused("wrote", `design: the writer used ${wrote.map((t) => t.name).join(", ")} — it composes, the runner writes`, wrote);
  if (res.structured === undefined) throw new Refused("no-structured-output", "design: the writer returned no design");
  const v = validateAgainst(outputContract("design"), res.structured);
  if (!v.ok) throw new Refused("design-invalid", `design: the design does not fit the contract — ${v.errors.slice(0, 5).join("; ")}`, v.errors);

  const doc = { ...skeleton("design"), id: `design-${prd.meta.slug}`, traces: traceOf(prd, proto, stories), ...res.structured };
  keepOutgoing(root, "design", DESIGN_FILE);
  saveDoc(root, DESIGN_FILE, "design", doc);
  const arithmetic = { ...checkDesign(proto, stories, doc), judged: pins(prd, proto, stories, doc) };
  saveVerdict(root, arithmetic);
  return { design: doc, arithmetic, model: res.model, usd: res.usd };
}

/** The reviewer as a design director: the declared standard first, then the record and the design; the verdict is filed under its gate. */
export async function review({ root, onEvent, _query, _sleep }) {
  const project = loadProject(root);
  const prd = loadPrd(root);
  const proto = readDoc(root, PROTOTYPE_FILE);
  const stories = readDoc(root, STORIES_FILE);
  const doc = loadDesign(root);
  if (!doc) throw new Refused("no-design", "design: there is no design to review");
  if (!proto || !stories) throw new Refused(proto ? "no-stories" : "no-prototype", "design: what the design was written from is gone");
  const verdict = await runJudge({
    gate: REVIEW_GATE, half: "discovery", stage: "design",
    identity: join(PROMPTS, "reviewer.md"),
    sections: [
      ["The declared standard", renderStandard(doc.standard)],
      ["Requirements inside the line", insideRequirements(prd).map(renderRequirement).join("\n") || "(none)"],
      ["Vocabulary", (prd.shape?.vocabulary ?? []).map((t) => `- **${t.term}**: ${t.definition}`).join("\n") || "(none defined)"],
      ["Surfaces inside the line — where each screen is read", renderSurfaces(prd)],
      ["Prototype screens", renderPrototype(proto)],
      ["Stories", renderStories(stories)],
      ["Design", renderDesign(doc)],
    ],
    artifacts: artifactsOf(prd, proto, stories, doc),
    scope: scopeOf(prd), rulings: rulingsOf(prd), arithmetic: ARITHMETIC, funnel: funnelPath(root),
    cwd: root, ledger: ledgerPath(root), budget: project.budget, models: project.models, onEvent, _query, _sleep,
  });
  saveVerdict(root, verdict);
  return verdict;
}

/**
 * A named human designer signs this exact design (§10.3). Refused without a name,
 * while the arithmetic blocks, without a fresh reviewer verdict, and on a blocking
 * verdict — unless a human overrides it with a reason, which goes on the PRD as an
 * override flag. Signing does not move the hash; a later rewrite leaves the signature
 * behind.
 */
export function signoff(root, { by, note, override, _now = () => new Date() } = {}) {
  const doc = loadDesign(root);
  if (!doc) throw new Refused("no-design", "signoff: there is no design to sign");
  if (!by?.trim()) throw new Refused("no-author", "signoff: a sign-off is a named person's word — say who");
  const proto = readDoc(root, PROTOTYPE_FILE);
  const stories = readDoc(root, STORIES_FILE);
  if (!proto || !stories) throw new Refused(proto ? "no-stories" : "no-prototype", "signoff: what the design was written from is gone");
  const arithmetic = checkDesign(proto, stories, doc);
  if (arithmetic.verdict === "block") throw new Refused("arithmetic-blocked", "signoff: the design does not add up against the claim map — rewrite it first", arithmetic.findings);
  const review = freshVerdict(root, REVIEW_GATE);
  if (!review) throw new Refused("review-absent", `signoff: no fresh ${REVIEW_GATE} verdict on this design — review it first; a stale verdict is nothing`, readVerdict(root, REVIEW_GATE) ? "stale" : "none");
  if (review.verdict === "block" && !override?.reason?.trim()) throw new Refused("review-blocked", `signoff: the ${REVIEW_GATE} gate returned BLOCK — fix it, or override with a reason on the record`, review.findings);

  const at = _now().toISOString();
  doc.signoff = {
    by: by.trim(), at, ...(note?.trim() ? { note: note.trim() } : {}),
    content_hash: doc.meta.content_hash,
    review: { gate: review.gate, verdict: review.verdict },
    ...(review.verdict === "block" ? { override: { reason: override.reason.trim() } } : {}),
  };
  saveDoc(root, DESIGN_FILE, "design", doc);

  const prd = loadPrd(root);
  const overrode = review.verdict === "block";
  prd.flags.push({
    at, section: "design", kind: overrode ? "override" : "note",
    note: overrode
      ? `design signed by ${doc.signoff.by} over a BLOCK from ${REVIEW_GATE}: ${doc.signoff.override.reason}`
      : `design signed by ${doc.signoff.by} (${REVIEW_GATE} ${review.verdict})${doc.signoff.note ? `: ${doc.signoff.note}` : ""}`,
  });
  savePrd(root, prd);
  return { design: doc, signed: isSigned(doc) };
}

/** What a verdict on the design is about: the PRD, the prototype, the backlog and the design itself. */
function artifactsOf(prd, proto, stories, doc) {
  return [{ id: prd.id, path: PRD_FILE, doc: prd }, { id: proto.id, path: PROTOTYPE_FILE, doc: proto }, { id: stories.id, path: STORIES_FILE, doc: stories }, { id: doc.id, path: DESIGN_FILE, doc }];
}
const pins = (prd, proto, stories, doc) => artifactsOf(prd, proto, stories, doc).map(pin);

/**
 * The claim map's arithmetic over the design (R2), finding-shaped like every gate.
 * Every screen a story claims is designed once; every designed screen is one the
 * prototype has and a story claims; every hero is on a designed screen. Nothing here
 * is about craft — that is the reviewer's.
 */
export function checkDesign(proto, stories, doc) {
  const findings = [];
  const f = (severity, rule, subject, summary, evidence, remedy) => findings.push({ severity, confidence: "certain", rule, subject, summary, evidence, remedy });
  const known = new Set((proto.screens ?? []).map((s) => s.id));
  const claimed = new Map();
  for (const s of stories.stories ?? []) for (const sc of s.screen_refs ?? []) claimed.set(sc, [...(claimed.get(sc) ?? []), s.id]);
  const designed = new Map();
  for (const s of doc.screens ?? []) designed.set(s.screen_ref, (designed.get(s.screen_ref) ?? 0) + 1);

  for (const [ref, n] of designed) {
    if (!known.has(ref)) f("high", "screen-unknown", ref, `${ref} is designed, but the prototype has no such screen.`, `\`/screens\` names ${ref}; the prototype's \`/screens\` has no such id.`, "Design the screens the prototype has and the stories claim; nothing else.");
    else if (!claimed.has(ref)) f("high", "screen-unclaimed", ref, `${ref} is designed, but no story claims it.`, `\`/screens\` names ${ref}; no story's \`/screen_refs\` does.`, "Drop the design, or raise the missing story as an open question — a screen nobody's story happens on is scope nobody decided.");
    if (n > 1) f("high", "screen-designed-twice", ref, `${ref} is designed ${n} times.`, `\`/screens\` holds ${n} entries with screen_ref ${ref}.`, "One design per screen; states, not duplicates, carry its variations.");
  }
  for (const [ref, by] of claimed) {
    if (known.has(ref) && !designed.has(ref)) f("high", "screen-undesigned", ref, `${ref} is claimed by ${by.join(", ")} and has no design.`, `${by.join(", ")} name ${ref} in \`/screen_refs\`; \`/screens\` has no entry for it.`, "Design every screen a story claims — Delivery builds what the design states, and an undesigned screen is a build agent's guess.");
  }
  for (const h of doc.standard?.heroes ?? []) {
    if (!designed.has(h.screen_ref)) f("high", "hero-unknown", h.screen_ref, `A hero moment is named on ${h.screen_ref}, which this design does not hold.`, `\`/standard/heroes\` names ${h.screen_ref}: "${h.moment}"; \`/screens\` has no entry for it.`, "Name heroes on screens the design holds.");
  }
  const checked = claimed.size + (doc.screens ?? []).length + (doc.standard?.heroes ?? []).length;
  return { gate: GATE, verdict: deriveVerdict(findings), findings, deferred: [], checked, skipped: 0 };
}
