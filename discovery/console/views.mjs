// owns: R1, R10 · discovery — the PM's views, as data. Each is the record read through the
// record's own functions — staleness, freshness by pin, the ledger's standing, the doors'
// state — and never a restatement of it. Cost stands on every view before the trigger it
// belongs to (R1). SPEC §6 names six views; the four Discovery views are here, the run
// view is delivery/console's, and the release view is a projection of the manifest (M3).

import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { roles, defaults, modelFor, standing, estimate, quote } from "../../shared/agent-call/index.mjs";
import { verdictFreshness } from "../../shared/judge/index.mjs";
import { readHandoffs, latestHandoff, handoffFile } from "../../shared/handoff.mjs";
import { loadProject, ledgerPath, partialProject, SetupRefused } from "../setup/index.mjs";
import { loadPrd, WorkshopRefused, captured, mayOpen, progress, quoteTurn, readTranscript } from "../workshop/index.mjs";
import { section } from "../workshop/sections.mjs";
import { readDoc, readVerdict, staleness, rulingsOf, PRD_FILE, PROTOTYPE_FILE, STORIES_FILE, DESIGN_FILE, HTML_FILE } from "../record/index.mjs";
import { GATE as PROTOTYPE_GATE } from "../prototype/index.mjs";
import { GATE as STORY_GATE, REVIEW_GATE as STORY_REVIEW } from "../stories/index.mjs";
import { GATE as DESIGN_GATE, REVIEW_GATE as DESIGN_REVIEW } from "../design/index.mjs";
import { radiusOf } from "../doors/index.mjs";
import { readiness, exitReadiness, designState, costOf, EXITS } from "../export/index.mjs";

/** The six, in the spec's order. A view that lands later says which milestone brings its record. */
export const VIEWS = [
  { key: "setup", label: "Setup" },
  { key: "workshop", label: "Workshop" },
  { key: "board", label: "Board" },
  { key: "export", label: "Export" },
  { key: "run", label: "Delivery run" },
  { key: "release", label: "Release", lands: "M3" },
];

/** Which document wears which gates, in pipeline order. The PRD's own reviewer is the workshop's, at the section. */
export const ARTIFACTS = [
  { kind: "prd", file: PRD_FILE, gates: [] },
  { kind: "prototype", file: PROTOTYPE_FILE, gates: [PROTOTYPE_GATE], html: HTML_FILE },
  { kind: "stories", file: STORIES_FILE, gates: [STORY_GATE, STORY_REVIEW] },
  { kind: "design", file: DESIGN_FILE, gates: [DESIGN_GATE, DESIGN_REVIEW] },
];

const tryProject = (root) => { try { return loadProject(root); } catch (e) { if (e instanceof SetupRefused && ["no-project", "setup-incomplete"].includes(e.code)) return null; throw e; } };
const tryPrd = (root) => { try { return loadPrd(root); } catch (e) { if (e instanceof WorkshopRefused && e.code === "no-prd") return null; throw e; } };

// ── setup ──

/**
 * The project: repo, model per role (the override named beside the default, and what a call
 * of it has cost so far — Discovery's ledger prices Discovery's roles; Delivery's roles are
 * priced by Delivery's own setup, on the run view), the budget's standing, cost by stage.
 */
export function setupView(root) {
  const project = tryProject(root);
  const roleRows = (overrides = {}, ledger = null) => roles().map((key) => {
    const [half, role] = key.split(".");
    const model = modelFor({ half, role }, overrides);
    return { key, half, role, model, default: defaults()[key], overridden: model !== defaults()[key], estimate: ledger && half === "discovery" ? estimate(ledger, { half, role, model }) : null };
  });
  if (!project) {
    // An unfinished setup is resumed as a new project, never offered as an attach (its .git is setup's own).
    const partial = partialProject(root);
    return { root, project: null, slug: partial?.slug ?? basename(root), title: partial?.title ?? "", budget: partial?.budget ?? null, resume: Boolean(partial),
      existing: !partial && existsSync(join(root, ".git")), roles: roleRows(partial?.models ?? {}), standing: null, cost: [] };
  }
  const ledger = ledgerPath(root);
  return {
    root, project: { slug: project.slug, title: project.title, created: project.created, repo: project.repo },
    slug: project.slug, existing: true,
    roles: roleRows(project.models ?? {}, ledger),
    standing: standing(ledger, project.budget ?? null),
    cost: Object.entries(costOf(root).by_stage).map(([stage, c]) => ({ stage, ...c })),
  };
}

// ── workshop ──

/** One section at a time: the sections in their order, the current one's transcript, the quote before the next turn, what is captured. */
export function workshopView(root, key) {
  const project = loadProject(root);
  const prd = tryPrd(root);
  if (!prd) return { prd: null, offer: { slug: project.slug, title: project.title } };
  const p = progress(prd);
  const current = key ? section(key).key : (p.sections.find((s) => s.status !== "complete" && s.may_open) ?? p.sections.at(-1)).key;
  const gate = mayOpen(prd, current);
  return {
    prd: { title: prd.meta.title, slug: prd.meta.slug, version: prd.meta.version, doc_status: prd.meta.doc_status },
    sections: p.sections, line_drawn: p.line_drawn,
    current: { ...p.sections.find((s) => s.key === current), why: gate.ok ? null : gate.message },
    transcript: readTranscript(root, current),
    quote: quoteTurn({ root, key: current }),
    captured: captured(prd),
    flags: prd.flags ?? [],
  };
}

// ── board ──

/** A gate as the board wears it: the filed verdict, fresh only by its pins; absent when nothing is filed. */
function gateRow(root, gate) {
  const v = readVerdict(root, gate);
  if (!v) return { gate, verdict: null, fresh: null, findings: [], deferred: [], model: null, usd: null };
  return { gate, verdict: v.verdict, fresh: verdictFreshness(v, { root }).fresh, findings: v.findings, deferred: v.deferred ?? [], model: v.cost?.model ?? null, usd: v.cost?.usd ?? null, checked: v.checked, skipped: v.skipped };
}

/** The published prototype, if any — what the framed prototype view shows. */
export function prototypeView(root) {
  const doc = readDoc(root, PROTOTYPE_FILE);
  return { present: Boolean(doc), version: doc?.meta?.version ?? null };
}

// The ready-gate finding that says how each artifact recovers once it is stale (D05).
const RECOVERY = { prototype: ["no-agreement", "agreement-stale"], stories: ["stories-stale"], design: ["design-stale"] };

/** The artifacts with their stale badges, recovery and gates, the doors' state, the ledger's cost, and the quotes before the writer and the reviewer. */
export function boardView(root) {
  const project = loadProject(root);
  const prd = loadPrd(root);
  const st = staleness(root);
  // As Delivery reads the gate, so a stale design shows its recovery too.
  const ready = readiness(root);
  const docs = Object.fromEntries(ARTIFACTS.map((a) => [a.kind, readDoc(root, a.file)]));
  const artifacts = ARTIFACTS.map(({ kind, file, gates, html }) => {
    const doc = docs[kind];
    const b = kind === "prd" ? null : st[kind];
    const moved = b ? Object.entries({ prd: b.prd_moved, prototype: b.prototype_moved, stories: b.stories_moved }).filter(([, m]) => m).map(([k]) => k) : [];
    return {
      kind, file, present: Boolean(doc), version: doc?.meta?.version ?? null, hash: doc?.meta?.content_hash ?? null,
      stale: b?.stale ?? false, moved, since: b?.since ?? [], traced_version: b?.traced_version ?? null,
      recovery: b?.stale ? ready.findings.find((f) => RECOVERY[kind].includes(f.rule))?.remedy ?? null : null,
      ...(kind === "design" ? { signed: b?.signed ?? false, signoff: doc?.signoff ?? null } : {}),
      ...(html ? { html } : {}),
      gates: gates.map((g) => gateRow(root, g)),
    };
  });
  const ledger = ledgerPath(root);
  const q = (role) => quote(ledger, { half: "discovery", role, model: modelFor({ half: "discovery", role }, project.models), budget: project.budget ?? null });
  return {
    prd: { title: prd.meta.title, slug: prd.meta.slug, version: prd.meta.version, hash: prd.meta.content_hash, doc_status: prd.meta.doc_status, links: prd.meta.links ?? {} },
    line: prd.mvp?.line ?? null,
    artifacts, gates: artifacts.flatMap((a) => a.gates),
    requirements: (prd.requirements ?? []).map((r) => ({ id: r.id, statement: r.statement, status: r.status, inside: (prd.mvp?.inside ?? []).includes(r.id), criteria: r.acceptance_criteria ?? [] })),
    open_questions: prd.open_questions ?? [],
    prototype_questions: (docs.prototype?.open_questions ?? []).filter((q) => q.id && q.status === "open"),
    rulings: rulingsOf(prd),
    // A proposal shows the radius as it stands now — what approving it acknowledges — never the one minted then.
    amendments: (prd.amendments ?? []).map((a) => ({ ...a, radius_now: a.status === "proposed" ? radiusOf({ prd, proto: docs.prototype, stories: docs.stories, target: a.target, from: a.adds ? undefined : a.from }) : null })),
    flags: prd.flags ?? [],
    cost: costOf(root),
    quotes: { writer: { model: modelFor({ half: "discovery", role: "writer" }, project.models), ...q("writer") }, reviewer: { model: modelFor({ half: "discovery", role: "reviewer" }, project.models), ...q("reviewer") } },
  };
}

// ── export ──

/** The ready gate recomputed live, whether each exit may leave now, the design's state, every handoff so far, and the tracker as the latest snapshot carries it. */
export function exportView(root) {
  loadProject(root); // refused, as the door is, before setup
  const docs = { prd: loadPrd(root), proto: readDoc(root, PROTOTYPE_FILE), stories: readDoc(root, STORIES_FILE), design: readDoc(root, DESIGN_FILE) };
  const handoffs = readHandoffs(root).map((h) => ({ version: h.version, exit: h.exit, by: h.by, exported_at: h.exported_at, tracker: h.tracker, cost: h.cost, design: designState(h.design), file: handoffFile(h.version), rendering: handoffFile(h.version).replace(/\.json$/, ".md") }));
  const latest = latestHandoff(root);
  const t = latest?.tracker ?? null;
  return {
    readiness: readiness(root),
    readinessByExit: Object.fromEntries(EXITS.map((exit) => { const r = exitReadiness({ ...docs, exit }); return [exit, { verdict: r.verdict, findings: r.findings }]; })),
    design: designState(docs.design),
    exits: EXITS,
    handoffs,
    tracker: t ? { kind: t.kind, where: t.kind === "github" ? t.repo : `${t.site} · ${t.project}`, keyed: Object.keys(t.keys ?? {}).length, version: latest.version } : null,
  };
}
