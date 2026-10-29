// owns: R14 · discovery — the export door: the ready gate — every join green, every hash
// whole — and the three exits: hand off to a team, send to Delivery, or both. Whichever
// exit, the door writes the same thing: a versioned handoff snapshot — the contract the
// PRD compiles to, the backlog, the design and the prototype as they stood, hashed per
// item — and a rendering of it a human reads. A team may also get the backlog projected
// to a tracker (GitHub Issues or Jira) with the same ids, its keys written back onto the
// snapshot, never a chain link. What goes to Delivery carries a signed design; what goes
// to a team carries the design as it stands, with its state on record.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { validate } from "../../shared/schema/index.mjs";
import { verify } from "../../shared/hash.mjs";
import { pin, deriveVerdict } from "../../shared/judge/index.mjs";
import { checkScope, lineDrawn } from "../../shared/scope.mjs";
import { totals } from "../../shared/agent-call/ledger.mjs";
import { handoffFile, readHandoffs, latestHandoff, itemsOf, designMoved } from "../../shared/handoff.mjs";
import { loadProject, ledgerPath, exec } from "../setup/index.mjs";
import { loadPrd, savePrd, PRD_FILE } from "../workshop/index.mjs";
import { Refused, readDoc, saveDoc, saveVerdict, isSigned, agreementGap, pendingReactions, recoveryOf, stalenessOf, renderPrd, renderPrototype, renderStories, renderStandard, renderDesign, PROTOTYPE_FILE, STORIES_FILE, DESIGN_FILE } from "../record/index.mjs";
import { checkPrototype } from "../prototype/index.mjs";
import { checkStories } from "../stories/index.mjs";
import { checkDesign } from "../design/index.mjs";
import { resolveTracker, project as projectTo, IDEA } from "./trackers.mjs";

export const GATE = "export-ready";
export const EXITS = ["team", "delivery", "both"];
export { IDEA, KINDS as TRACKERS, repoOf } from "./trackers.mjs";

// ── the ready gate ──

/**
 * Every join recomputed live, every document's hash checked and every trace held to the
 * record — one finding-shaped verdict, pinned to what it read. For a team exit a stale
 * design is not a finding; with no exit named, the gate reads as Delivery's.
 */
export function readiness(root, exit) {
  const prd = loadPrd(root);
  return readinessOf({ prd, proto: readDoc(root, PROTOTYPE_FILE), stories: readDoc(root, STORIES_FILE), design: readDoc(root, DESIGN_FILE), exit });
}

export function readinessOf({ prd, proto, stories, design, exit }) {
  const joins = [checkScope(prd), checkReactions(prd)];
  if (proto) joins.push(checkPrototype(prd, proto), checkFreshness({ prd, proto, stories, design, exit }));
  if (proto && stories) joins.push(checkStories(prd, proto, stories));
  if (proto && stories && design) joins.push(checkDesign(proto, stories, design));
  const docs = [[prd, PRD_FILE], [proto, PROTOTYPE_FILE], [stories, STORIES_FILE], [design, DESIGN_FILE]].filter(([d]) => d);
  for (const [doc] of docs) joins.push(verify(doc));
  const findings = joins.flatMap((j) => j.findings);
  return {
    gate: GATE, verdict: deriveVerdict(findings), findings, deferred: [],
    checked: joins.reduce((n, j) => n + j.checked, 0), skipped: 0,
    judged: docs.map(([doc, path]) => pin({ id: doc.id, path, doc })),
  };
}

/** While a reaction's proposed change is undecided nothing leaves: a finding on the PRD alone, so it shows with or without a prototype, naming the recovery the PM still has. */
function checkReactions(prd) {
  const findings = pendingReactions(prd).map((r) => ({ severity: "high", confidence: "certain", rule: "reaction-pending", subject: prd.id,
    summary: `${r.id}'s proposed change ${r.proposal} is still undecided.`, evidence: `\`/reactions\`: ${r.id} proposes ${r.proposal}, still proposed.`, remedy: recoveryOf(prd, r) }));
  return { findings, checked: 1 };
}

/**
 * D05, by content hash only — a matching id or version label never makes a document
 * current. Without the PM's agreement to this PRD and prototype, or with stories written
 * from another, nothing leaves; a design written from other stories, prototype or PRD
 * does not go to Delivery, and a team takes it as it stands.
 */
function checkFreshness({ prd, proto, stories, design, exit }) {
  const findings = [];
  const f = (rule, subject, summary, evidence, remedy) => findings.push({ severity: "high", confidence: "certain", rule, subject, summary, evidence, remedy });
  const badge = stalenessOf({ prd, proto, stories, design });
  const moved = (b) => `${["prd", "prototype", "stories"].filter((k) => b[`${k}_moved`]).map((k) => `\`/traces/${k}\``).join(", ")}: the content hash differs${b.since.length ? `; since then ${b.since.join(", ")}` : ""}.`;
  const gap = agreementGap(prd, proto);
  if (gap) f(gap.rule, prd.id, "No agreement of the PM's covers this PRD and its prototype.", `\`/agreements\`: ${gap.why}.`, "Rebuild the prototype if it traces an older PRD, then agree to the PRD and the prototype.");
  if (badge.stories?.stale) f("stories-stale", stories.id, `${stories.id} was written from another PRD or prototype.`, moved(badge.stories), "Write the stories again under the current agreement.");
  if (badge.design?.stale && exit !== "team") f("design-stale", design.id, `${design.id} was written from other stories, prototype or PRD.`, moved(badge.design), "Regenerate the design, then review and sign it.");
  return { findings, checked: 1 + (stories ? 1 : 0) + (design ? 1 : 0) };
}

// ── each exit ──

/**
 * Whether an exit may leave now — one rule, which the door enforces and the export view
 * shows (R10): a prototype and a backlog, then the ready gate, then for Delivery or both a
 * signed design. Each check that fails is a finding with its remedy; `refusal` is the
 * first of them, as the door throws it.
 */
export function exitReadiness({ prd, proto, stories, design, exit }) {
  const gate = readinessOf({ prd, proto, stories, design, exit });
  const findings = [], refusals = [];
  const need = (code, message, detail, summary, evidence, remedy) => {
    refusals.push(new Refused(code, message, detail));
    findings.push({ severity: "high", confidence: "certain", rule: code, subject: prd.id, summary, evidence, remedy });
  };
  if (!proto) need("no-prototype", "export: there is no prototype — generate one on the board first", undefined, "There is no prototype; the backlog claims screens it must have.", `\`${PROTOTYPE_FILE}\` is absent.`, "Generate the prototype on the board.");
  if (!stories) need("no-stories", "export: there is no backlog to hand off — write the stories on the board first", undefined, "There is no backlog to hand off.", `\`${STORIES_FILE}\` is absent.`, "Write the stories on the board.");
  findings.push(...gate.findings);
  if (gate.verdict === "block") refusals.push(new Refused("not-ready", "export: the record does not add up — every join is green before anything leaves", gate.findings));
  if (exit !== "team" && !design) need("no-design", "export: Delivery builds what the design states, and there is no design", "none", "Delivery builds what the design states, and there is no design.", `\`${DESIGN_FILE}\` is absent.`, "Write the design on the board, then review and sign it.");
  else if (exit !== "team" && !isSigned(design)) need("design-unsigned", "export: what goes to Delivery is signed — sign the design first", "unsigned", `Nobody has signed ${design.id} as it stands.`, "`/signoff`: none on this version.", "Review the design and sign it on the board.");
  return { exit, verdict: refusals.length ? "block" : "pass", findings, gate, refusal: refusals[0] ?? null };
}

// ── the contract ──

/** The PRD compiled to what Delivery builds against: its own fields, filtered to the line; rulings in force, approved amendments, open questions. */
export function compile(prd) {
  const inside = new Set(prd.mvp?.inside ?? []);
  const past = new Set((prd.mvp?.past ?? []).map((p) => p.ref));
  const contract = {
    prd: { version: prd.meta.version, content_hash: prd.meta.content_hash },
    title: prd.meta.title, slug: prd.meta.slug,
    problem: prd.problem, shape: prd.shape, solution: prd.solution, okr: prd.okr, constraints: prd.constraints, mvp: prd.mvp,
    surfaces: (prd.surfaces?.shipped ?? []).filter((s) => !past.has(s.id)),
    requirements: (prd.requirements ?? []).filter((r) => inside.has(r.id)),
    rulings: prd.rulings ?? [],
    amendments: (prd.amendments ?? []).filter((a) => a.status === "approved"),
    open_questions: (prd.open_questions ?? []).filter((q) => q.status === "open"),
  };
  const v = validate("contract", contract);
  if (!v.ok) throw new Refused("contract-invalid", `export: the PRD does not compile — ${v.errors.slice(0, 5).join("; ")}`, v.errors);
  return structuredClone(contract);
}

// ── the door ──

/**
 * Export. Refused: an exit that is not one of the three; no named person; a tracker
 * that is not one we know, or one missing what it needs (`bad-tracker`; Jira also needs
 * JIRA_EMAIL and JIRA_API_TOKEN in the environment — `no-credentials`); no line,
 * prototype or backlog; a record whose joins do not add up (`not-ready`, the findings
 * attached); and — for Delivery or both — no design, or a design nobody has signed. Then
 * the snapshot is written as the next version with its rendering beside it; for a team,
 * the tracker (given now, or carried from the last handoff) is brought to match it —
 * create · update · leave alone, by item hash — or, with none, the files are the handoff;
 * and the PRD takes a flag saying what left and where. `tracker: false` is files only on
 * any exit: the snapshot carries no tracker and none is called. Credentials are written nowhere.
 */
export async function exportHandoff({ root, exit, by, tracker: trackerOpts, _now = () => new Date(), _fetch = fetch, _env = process.env, _exec = exec }) {
  if (!EXITS.includes(exit)) throw new Refused("bad-exit", `export: the door has three exits — ${EXITS.join(", ")} — and "${exit}" is not one`);
  if (!by?.trim()) throw new Refused("no-author", "export: a handoff is a named person's word — say who");
  const project = loadProject(root);
  const prd = loadPrd(root);
  const previous = latestHandoff(root);
  // A named tracker resumes from the last handoff that carries one, so files-only exports since do not reset it.
  const basis = trackerOpts ? readHandoffs(root).findLast((h) => h.tracker) ?? null : previous;
  const toTeam = exit !== "delivery";
  const tracker = trackerOpts === false ? null : toTeam ? resolveTracker(trackerOpts, basis, project) : (previous?.tracker ?? null);
  if (toTeam && tracker?.kind === "jira" && !(_env.JIRA_EMAIL && _env.JIRA_API_TOKEN)) throw new Refused("no-credentials", "export: JIRA_EMAIL and JIRA_API_TOKEN must be in the environment; they are never written to a record");
  if (!lineDrawn(prd)) throw new Refused("no-line", "export: nothing leaves before the MVP line is drawn");
  const proto = readDoc(root, PROTOTYPE_FILE), stories = readDoc(root, STORIES_FILE), design = readDoc(root, DESIGN_FILE);
  const ready = exitReadiness({ prd, proto, stories, design, exit });
  // The gate is filed once the door reaches it, past the prototype and the backlog.
  if (proto && stories) saveVerdict(root, ready.gate);
  if (ready.refusal) throw ready.refusal;
  const verdict = ready.gate;

  const version = (previous?.version ?? 0) + 1;
  const handoff = {
    id: `handoff-${project.slug}-v${version}`, version, exported_at: _now().toISOString(), by: by.trim(), exit,
    project: { slug: project.slug, title: project.title, remote: project.repo?.remote ?? null },
    contract: compile(prd), prototype: proto, stories, design, items: [], tracker, cost: costOf(root), meta: {},
    "x-drift-checked": ["/contract", "/prototype", "/stories", "/design"],
  };
  handoff.items = itemsOf(handoff);
  const file = handoffFile(version);
  const rendering = file.replace(/\.json$/, ".md");
  const save = () => { saveDoc(root, file, "handoff", handoff); writeFileSync(join(root, rendering), renderHandoff(handoff)); };
  save();

  const projected = toTeam && tracker ? await projectTo({ handoff, previous: basis, prd, save, _fetch, _env, _exec, root }) : null;

  if (tracker?.kind === "jira" && tracker.keys[IDEA]) prd.meta.links = { ...(prd.meta.links ?? {}), jira_idea: tracker.keys[IDEA] };
  const where = projected ? ` · ${trackerName(tracker)}: ${projected.created.length} created, ${projected.updated.length} updated, ${projected.unchanged.length} unchanged` : toTeam ? " · files only" : "";
  prd.flags.push({ at: handoff.exported_at, section: "export", kind: "note", note: `handoff v${version} exported (${exit}) by ${handoff.by}${where}` });
  savePrd(root, prd);
  return { handoff, file, rendering, verdict, tracker: projected };
}

/** What Discovery has cost so far, by stage — the ledger's totals, shaped for the snapshot and the board. */
export function costOf(root) {
  const t = totals(ledgerPath(root), ["stage"]);
  const sum = (k) => Object.values(t).reduce((n, v) => n + v[k], 0);
  return { usd: sum("usd"), calls: sum("calls"), by_stage: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, { usd: v.usd, calls: v.calls }])) };
}

const trackerName = (t) => (t.kind === "github" ? `GitHub ${t.repo}` : `Jira ${t.project}`);

// ── the rendering ──

/** The design's state as the snapshot records it: none, unsigned, or signed by whom and when. */
export function designState(design) {
  if (!design) return "none";
  if (!isSigned(design)) return "unsigned";
  return `signed by ${design.signoff.by} at ${design.signoff.at}${design.signoff.override ? " (over a BLOCK, with reason on record)" : ""}`;
}

/**
 * The handoff as a team reads it, beside the snapshot: what this is and where it went,
 * the contract (the PRD's own rendering, on the compiled fields), the rulings and
 * amendments in force, the backlog, the design as it stands, the prototype. Derived —
 * the snapshot is the record; this is written from it and never read back.
 */
export function renderHandoff(h) {
  const c = h.contract;
  const moved = designMoved(h);
  const design = `${designState(h.design)}${moved.length ? ` · stale: written from another ${moved.join(", ")}` : ""}`;
  const t = h.tracker;
  const keys = t ? Object.entries(t.keys).map(([id, k]) => `${id} ${t.kind === "github" ? `#${k}` : k}`).join(", ") : "";
  const head = [
    `# ${c.title} — handoff v${h.version} (${h.exit})`,
    `Exported ${h.exported_at} by ${h.by} · PRD v${c.prd.version} ${c.prd.content_hash.slice(0, 12)} · design: ${design}`,
    `Tracker: ${t ? `${trackerName(t)}${keys ? ` — ${keys}` : ""}` : "none — these files are the handoff"}`,
    `Discovery cost: $${h.cost.usd.toFixed(2)} over ${h.cost.calls} model calls${Object.keys(h.cost.by_stage).length ? ` (${Object.entries(h.cost.by_stage).map(([s, v]) => `${s} ${v.calls}`).join(", ")})` : ""}`,
    h.project.remote ? `Repository: ${h.project.remote}` : null,
  ].filter(Boolean).join("\n");
  const parts = [head, renderPrd({ ...c, surfaces: { shipped: c.surfaces } })];
  if (c.rulings.length) parts.push(`## Rulings — answers on the record (R3)\n\n${c.rulings.map((r) => `- **${r.id}**${r.oq ? ` (${r.oq})` : ""} ${r.question}\n  ${r.answer}${r.criterion ? ` → ${r.criterion}` : ""} — ${r.by}, ${r.at}`).join("\n")}`);
  if (c.amendments.length) parts.push(`## Amendments approved\n\n${c.amendments.map((a) => `- **${a.id}** ${a.target}: ${a.rationale} — ${a.by}, ${a.at}`).join("\n")}`);
  parts.push(`## Backlog\n\n${renderStories(h.stories)}`);
  parts.push(`## Design — ${design}\n\n${moved.length ? `This design was written from another ${moved.join(", ")} than this handoff carries. Regenerate the design, then review and sign it, before Delivery takes it.\n\n` : ""}${h.design ? `${renderStandard(h.design.standard)}\n\n${renderDesign(h.design)}` : "(no design yet)"}`);
  parts.push(`## Prototype\n\n${renderPrototype(h.prototype)}`);
  return `${parts.join("\n\n")}\n`;
}
