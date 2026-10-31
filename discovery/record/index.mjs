// owns: R3, R4 · discovery — the discovery record: where each document lives beside the
// PRD, what it traces, how the PRD's settled rulings ride into every writer and reviewer
// after it (R3), and the stale badge a document wears once the PRD has moved past what
// it traces — with the rulings and amendments that moved it (R4) — and the outgoing copy
// a writer keeps before it replaces a document. Also how the record reads to an agent:
// one rendering per document, used by every prompt that shows it.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { verdictFreshness } from "../../shared/judge/index.mjs";
import { Refused } from "../../shared/refused.mjs";
import { readDoc, saveDoc, saveVerdict as file } from "../../shared/store.mjs";
import { renderDesign } from "../../shared/handoff.mjs";
import { PRD_FILE, loadPrd } from "../workshop/index.mjs";

export { PRD_FILE, Refused, readDoc, saveDoc, renderDesign };
export const PROTOTYPE_FILE = join("discovery", "prototype.json");
export const HTML_FILE = join("discovery", "prototype", "index.html");
export const STORIES_FILE = join("discovery", "stories.json");
export const DESIGN_FILE = join("discovery", "design.json");
export const REVIEWS = join("discovery", "reviews");
export const HISTORY = join("discovery", "history");

// ── documents ──

/**
 * Keep the document a writer is about to replace: its saved bytes, at
 * `discovery/history/<kind>-<first 12 hex of their sha256>.json`. The key is the whole
 * file, not the content hash, which leaves out traces, sign-offs and workflow state. A
 * file that rides beside it (the prototype's HTML) is kept under the same key.
 */
export function keepOutgoing(root, kind, file, beside) {
  if (!existsSync(join(root, file))) return null;
  const saved = readFileSync(join(root, file));
  const key = join(HISTORY, `${kind}-${createHash("sha256").update(saved).digest("hex").slice(0, 12)}`);
  mkdirSync(join(root, HISTORY), { recursive: true });
  writeFileSync(join(root, `${key}.json`), saved);
  if (beside && existsSync(join(root, beside))) copyFileSync(join(root, beside), join(root, `${key}${extname(beside)}`));
  return key;
}

/** A gate's verdict, filed under its gate id (or a name under it). Validated: a verdict that does not fit the shape is not a verdict. */
export function saveVerdict(root, verdict, name = verdict?.gate) {
  return join(root, file(root, join(REVIEWS, `${name}.json`), verdict));
}

export function readVerdict(root, gate) {
  return readDoc(root, join(REVIEWS, `${gate}.json`));
}

/** The verdict only if every artifact it pinned is still the one on disk; presence alone is nothing. */
export function freshVerdict(root, gate) {
  const v = readVerdict(root, gate);
  return v && verdictFreshness(v, { root }).fresh ? v : null;
}

// ── traces, versions, rulings ──

/** What a document was written from, by hash: the PRD always; the prototype and the stories when the document sits after them. */
export function traceOf(prd, proto, stories) {
  return {
    prd: { version: prd.meta.version, content_hash: prd.meta.content_hash },
    ...(proto ? { prototype: { content_hash: proto.meta.content_hash } } : {}),
    ...(stories ? { stories: { content_hash: stories.meta.content_hash } } : {}),
  };
}

export function cmpVersion(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** major.minor.patch; `minor` resets patch. Material changes bump minor, the rest patch. */
export function bumpVersion(v, part) {
  const [ma, mi, pa] = String(v).split(".").map((n) => Number(n) || 0);
  return part === "minor" ? `${ma}.${mi + 1}.0` : `${ma}.${mi}.${pa + 1}`;
}

/** A criterion by its join id, REQ-n/AC-m, with where it sits — or null. */
export function criterionAt(prd, ref) {
  const [req, id] = String(ref).split("/");
  const i = (prd.requirements ?? []).findIndex((r) => r.id === req);
  const j = i < 0 ? -1 : (prd.requirements[i].acceptance_criteria ?? []).findIndex((ac) => ac.id === id);
  return j < 0 ? null : { i, j, ac: prd.requirements[i].acceptance_criteria[j] };
}

/**
 * The PRD's rulings as every writer, reviewer and judge after the answer door receives
 * them (R3). A ruling an approved amendment has since superseded still settles its
 * question, and says what the criterion holds now.
 */
export function rulingsOf(prd) {
  return (prd.rulings ?? []).map(({ id, oq, pq, question, answer, criterion, superseded_by }) => ({ id, ...(oq ? { oq } : {}), ...(pq ? { pq } : {}), question,
    answer: superseded_by ? `${answer} — superseded by ${superseded_by}: ${criterion} now reads "${criterionAt(prd, criterion)?.ac.statement ?? "(removed)"}"` : answer, criterion }));
}

/** The rulings and approved amendments that landed after a PRD version. */
export function changedSince(prd, version) {
  return [
    ...(prd.rulings ?? []).filter((r) => cmpVersion(r.version, version) > 0).map((r) => r.id),
    ...(prd.amendments ?? []).filter((a) => a.status === "approved" && cmpVersion(a.resulting_version, version) > 0).map((a) => a.id),
  ];
}

/** The reactions still waiting on the PM: each one whose amendment is still proposed. A reaction with no proposal never holds. */
export function pendingReactions(prd) {
  const proposed = new Set((prd.amendments ?? []).filter((a) => a.status === "proposed").map((a) => a.id));
  return (prd.reactions ?? []).filter((r) => r.proposal && proposed.has(r.proposal));
}

/**
 * What the PM can do about a pending reaction: decide its amendment — or, once the PRD has
 * moved past the version or content it was proposed against, which approve refuses, reject
 * it and propose again. The stories door and the ready gate say the same thing.
 */
export function recoveryOf(prd, r) {
  const a = (prd.amendments ?? []).find((x) => x.id === r.proposal);
  if (a && (a.against_version !== prd.meta.version || a.against_hash !== prd.meta.content_hash)) {
    return `${r.proposal} was proposed against PRD ${a.against_version} and can no longer be approved; reject it, then propose again against the current record.`;
  }
  return `Approve or reject ${r.proposal}, then refresh what it changes.`;
}

/** The PM's agreement that covers the record as it stands — this PRD and this prototype — or null. */
export function currentAgreement(prd, proto) {
  return (prd.agreements ?? []).findLast((a) => a.prd_hash === prd.meta.content_hash && a.prototype_hash === proto?.meta?.content_hash) ?? null;
}

/**
 * Why no agreement covers the record as it stands, or null: `no-agreement` when none was
 * ever recorded, else `agreement-stale` with what moved since the last. One rule: the
 * stories door refuses on it and the ready gate reports it.
 */
export function agreementGap(prd, proto) {
  if (currentAgreement(prd, proto)) return null;
  const last = prd.agreements?.at(-1);
  if (!last) return { rule: "no-agreement", why: "the PM has not agreed this revision" };
  const moved = changedSince(prd, last.prd_version);
  const what = last.prd_hash !== prd.meta.content_hash ? `the PRD has moved from ${last.prd_version} to ${prd.meta.version}${moved.length ? ` (${moved.join(", ")})` : ""}` : "the prototype has been rebuilt";
  return { rule: "agreement-stale", why: `${last.id} agreed to a revision that is no longer on the record — ${what}` };
}

/**
 * The stale badge per downstream document: whether what it traces still matches the
 * PRD (and, further down, the prototype and the stories) by content hash, and which
 * rulings and amendments landed after the version it was made from. The ready gate
 * enforces the same badge: stale stories hold every exit, a stale design the Delivery
 * exits (D05). The design also says whether its sign-off is on this exact version.
 */
export function staleness(root) {
  return stalenessOf({ prd: loadPrd(root), proto: readDoc(root, PROTOTYPE_FILE), stories: readDoc(root, STORIES_FILE), design: readDoc(root, DESIGN_FILE) });
}

export function stalenessOf({ prd, proto, stories, design }) {
  const since = (version) => changedSince(prd, version);
  const moved = (traced, current) => !current || traced.content_hash !== current.meta.content_hash;
  const badge = (doc, extra = {}) => {
    const traced = doc.traces.prd;
    const prd_moved = traced.content_hash !== prd.meta.content_hash;
    return { stale: prd_moved || Object.values(extra).some(Boolean), prd_moved, ...extra, traced_version: traced.version, current_version: prd.meta.version, since: since(traced.version) };
  };
  return {
    prd: { version: prd.meta.version, content_hash: prd.meta.content_hash },
    prototype: proto ? badge(proto) : null,
    stories: stories ? badge(stories, { prototype_moved: moved(stories.traces.prototype, proto) }) : null,
    design: design ? { ...badge(design, { prototype_moved: moved(design.traces.prototype, proto), stories_moved: moved(design.traces.stories, stories) }), signed: isSigned(design) } : null,
  };
}

/** Signed means a named person signed this exact content — a regenerate leaves the signature behind. */
export function isSigned(design) {
  return Boolean(design?.signoff) && design.signoff.content_hash === design.meta.content_hash;
}

// ── how the record reads to an agent ──

const insideLine = (prd) => new Set(prd.mvp?.inside ?? []);

/** The requirements inside the line, with every criterion by its join id. */
export function insideRequirements(prd) {
  const inside = insideLine(prd);
  return (prd.requirements ?? []).filter((r) => inside.has(r.id));
}

export function renderRequirement(r) {
  const acs = (r.acceptance_criteria ?? []).map((ac) => `  - ${r.id}/${ac.id}: ${ac.statement}`);
  return [`- **${r.id}** [${r.type}] ${r.statement}`, `  Done when: ${r.done_definition}`, ...acs].join("\n");
}

/** The PRD as a writer or reviewer after the line reads it: the problem, the shape, what is inside the line, the surfaces that carry it. */
/** The shipped surfaces inside the line, with their kind — where each screen is read. */
export function renderSurfaces(prd) {
  const past = new Set((prd.mvp?.past ?? []).map((p) => p.ref));
  return (prd.surfaces?.shipped ?? []).filter((s) => !past.has(s.id)).map((s) => `- **${s.id}** (${s.kind}) ${s.statement} — carries ${s.req_refs.join(", ") || "(nothing bound yet)"}`).join("\n") || "(none)";
}

export function renderPrd(prd) {
  const parts = [];
  parts.push(`## Problem\n\nWho: ${prd.problem.who}\nProblem: ${prd.problem.problem}\nCrux: ${prd.problem.crux}`);
  parts.push(`## Solution\n\n${prd.solution.summary}`);
  const sh = prd.shape ?? {};
  const shape = [];
  if (sh.lifecycles?.length) shape.push(`Lifecycles:\n${sh.lifecycles.map((l) => `- ${l.id} ${l.subject}: ${l.states.join(" → ")} (${l.owner})`).join("\n")}`);
  if (sh.attribution?.length) shape.push(`Attribution:\n${sh.attribution.map((a) => `- ${a.id} ${a.action} — ${a.actor}, known by ${a.known_by}`).join("\n")}`);
  if (sh.clocks?.length) shape.push(`Clocks:\n${sh.clocks.map((c) => `- ${c.id} ${c.boundary}: ${c.rule} (${c.owner})`).join("\n")}`);
  if (shape.length) parts.push(`## Shape\n\n${shape.join("\n\n")}`);
  parts.push(`## Vocabulary — the words to use\n\n${(sh.vocabulary ?? []).map((v) => `- **${v.term}**: ${v.definition}`).join("\n") || "(none defined)"}`);
  parts.push(`## Surfaces inside the line\n\n${renderSurfaces(prd)}`);
  parts.push(`## Requirements inside the line\n\n${insideRequirements(prd).map(renderRequirement).join("\n") || "(none)"}`);
  if (prd.constraints?.length) parts.push(`## Constraints\n\n${prd.constraints.map((c) => `- ${c}`).join("\n")}`);
  const open = (prd.open_questions ?? []).filter((q) => q.status === "open");
  if (open.length) parts.push(`## Open questions — unanswered; take the most visible reading and say so\n\n${open.map((q) => `- ${q.id} ${q.question} (${q.owner})`).join("\n")}`);
  return parts.join("\n\n");
}

/** The prototype as an agent reads it. With `file: false` the pointer to the HTML is left out, for an agent that has no tools to read it. */
export function renderPrototype(proto, { file = true } = {}) {
  const screens = (proto.screens ?? []).map((s) => `- **${s.id}** "${s.name}" on ${s.surface_ref} — ${s.req_refs.join(", ") || "(no requirements)"}`).join("\n") || "(no screens)";
  const lines = [`Screens:\n${screens}`];
  if (proto.uncovered?.length) lines.push(`Not shown by the prototype: ${proto.uncovered.join(", ")}`);
  if (proto.notes?.trim()) lines.push(`Builder's notes: ${proto.notes.trim()}`);
  if (file) lines.push(`The prototype itself is at \`${proto.file}\` — read it; what it shows is evidence, what this list says is a claim.`);
  return lines.join("\n\n");
}

export function renderStories(doc) {
  const epics = (doc.epics ?? []).map((e) => `- **${e.id}** ← ${e.req_ref}: ${e.title}`).join("\n") || "(no epics)";
  const stories = (doc.stories ?? []).map((s) => [
    `### ${s.id} (${s.epic}) — ${s.req_refs.join(", ")} · screens ${s.screen_refs.join(", ") || "(none)"}`,
    s.statement,
    ...(s.scenarios ?? []).map((sc) => `**${sc.name}** proves ${sc.proves.join(", ")}\n\`\`\`gherkin\n${sc.gherkin.trim()}\n\`\`\``),
  ].join("\n\n")).join("\n\n");
  return `Epics:\n${epics}\n\n${stories || "(no stories)"}`;
}

/** The declared standard alone — what the writer promised, as the reviewer reads it before the screens. */
export function renderStandard(std) {
  return [
    `Direction: ${std.direction}`,
    `Heroes:\n${(std.heroes ?? []).map((h) => `- ${h.screen_ref}: ${h.moment}`).join("\n") || "(none)"}`,
    `Commitments:\n${(std.commitments ?? []).map((c) => `- ${c}`).join("\n") || "(none)"}`,
  ].join("\n\n");
}

/** The design as a reviewer or a later stage reads it: tokens, the stylesheet, then each screen whole. */
