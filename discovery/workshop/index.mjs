// owns: R1, R12 · discovery — the PRD workshop. One PRD per project at `discovery/prd.json`,
// opened as the schema's skeleton and captured a section at a time. A turn is one
// conversation exchange through the chokepoint (quote before, ledger row after, the SDK
// holding the session); the interrogator holds no tools and emits no data. Extraction
// is a second, separate call that transcribes the transcript into the section's fields
// — conversation is not extraction. Shape comes before scope: the sections that draw
// and read the MVP line cannot open until the shape section is complete. A step that waits
// on a model never saves over a PRD that moved meanwhile: extraction refuses, a turn re-applies
// only its own section state onto the fresh PRD.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { skeleton, validate, validateAgainst, partialContract } from "../../shared/schema/index.mjs";
import { stamp } from "../../shared/hash.mjs";
import { identity, mechanics, assemble } from "../../shared/prompt/index.mjs";
import { call, quote, modelFor } from "../../shared/agent-call/index.mjs";
import { scopeOf, lineDrawn } from "../../shared/scope.mjs";
import { loadProject, ledgerPath } from "../setup/index.mjs";
import { SECTIONS, LINE_SECTION, section, indexOf } from "./sections.mjs";
import { repoBrief } from "./brief.mjs";
import { holdRulings, AUDIT_GATE } from "../doors/index.mjs";
import { saveVerdict, keepOutgoing } from "../record/index.mjs";
import { Refused } from "../../shared/refused.mjs";

export const PRD_FILE = join("discovery", "prd.json");
export const TRANSCRIPTS = join("discovery", "workshop");
const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), "prompts");

/** What the interrogator may put on the record, on its own line, once. */
export const SIGNALS = { "[SECTION_COMPLETE]": "complete", "[KILL_SUGGESTED]": "kill" };
/** Every message opens with its posture. The variation selector is optional — models drop it. */
const MODE = /^\s*(🏛️|🏛|🔥)/u;
export const MODES = { "🏛️": "socratic", "🏛": "socratic", "🔥": "challenge" };

export class WorkshopRefused extends Error {
  constructor(code, message, detail) { super(message); this.code = code; if (detail) this.detail = detail; }
}

// ── the document ──

export function prdPath(root) { return join(root, PRD_FILE); }

/**
 * A PRD before its first section: the schema's skeleton with the runner's fields set,
 * every section pending, stamped. Refused if one exists — a PRD is edited through its
 * sections, never re-opened over.
 */
export function openPrd({ root, title, slug, seed, owner, baseline = null, repo, _now = () => new Date() }) {
  const file = prdPath(root);
  if (existsSync(file)) throw new WorkshopRefused("prd-exists", `workshop: ${file} exists — capture its sections; do not open another`);
  if (!seed?.trim()) throw new WorkshopRefused("no-seed", "workshop: a seed is required — the PM's idea, as typed");
  const prd = skeleton("prd");
  prd.id = `prd-${slug}`;
  prd.created = _now().toISOString();
  prd.meta = { ...prd.meta, title, slug, doc_status: "draft", version: "0.1.0", baseline, ...(owner ? { owner } : {}), ...(repo ? { links: { repo } } : {}) };
  prd.seed = seed;
  prd.sections = Object.fromEntries(SECTIONS.map((s) => [s.key, { status: "pending", session_id: null, turns: 0, extracted_at: null }]));
  savePrd(root, prd);
  return prd;
}

export function loadPrd(root) {
  const file = prdPath(root);
  if (!existsSync(file)) throw new WorkshopRefused("no-prd", `workshop: ${file} not found — open the PRD first`);
  return JSON.parse(readFileSync(file, "utf8"));
}

/** The sha256 of the PRD file's bytes: what a step that waits on a model read before it began. */
export function prdStamp(root) {
  return createHash("sha256").update(readFileSync(prdPath(root))).digest("hex");
}

/**
 * Stamp, validate, write. An invalid document is never written — the refusal names the fields.
 * With `base`, the file must still be the bytes the caller read; a late write never replaces a
 * PRD that moved while the model worked (D09's basic guard). With `keep`, for a door that moves
 * the version, the outgoing file is kept as history (D05) once the new one has validated and
 * before anything is written: a refusal keeps nothing, and a failed copy changes nothing. A disk
 * error writing the PRD itself after its copy leaves that copy, as the other writers' order does:
 * hidden while it matches the current file, listed once the PRD changes at the same version.
 */
export function savePrd(root, prd, { base, keep = false } = {}) {
  if (base !== undefined && prdStamp(root) !== base) throw new Refused("prd-changed", "workshop: the PRD changed while this step was working — nothing was saved; run it again on the current PRD");
  stamp(prd);
  const v = validate("prd", prd);
  if (!v.ok) throw new WorkshopRefused("prd-invalid", `workshop: the PRD does not fit its schema — ${v.errors.slice(0, 5).join("; ")}`, v.errors);
  if (keep) keepOutgoing(root, "prd", PRD_FILE);
  mkdirSync(dirname(prdPath(root)), { recursive: true });
  writeFileSync(prdPath(root), JSON.stringify(prd, null, 2) + "\n");
  return prd;
}

/** What has been captured so far, for the interrogator's context (v1 `summarize`, over the v2 fields). */
export function captured(prd) {
  const parts = [];
  const p = prd.problem ?? {};
  if (p.problem) parts.push(`Problem: ${p.problem}`);
  if (p.crux) parts.push(`Crux: ${p.crux}`);
  if (p.who) parts.push(`Who: ${p.who}`);
  if (p.why_now) parts.push(`Why now: ${p.why_now}`);
  if (p.business_value) parts.push(`Value: ${p.business_value}`);
  const sh = prd.shape ?? {};
  if (sh.lifecycles?.length) parts.push(`Lifecycles:\n${sh.lifecycles.map((l) => `  ${l.id} ${l.subject}: ${l.states.join(" → ")} (${l.owner})`).join("\n")}`);
  if (sh.vocabulary?.length) parts.push(`Vocabulary: ${sh.vocabulary.map((v) => `${v.term} = ${v.definition}`).join("; ")}`);
  if (sh.attribution?.length) parts.push(`Attribution: ${sh.attribution.map((a) => `${a.id} ${a.action} by ${a.actor}, known by ${a.known_by}`).join("; ")}`);
  if (sh.clocks?.length) parts.push(`Clocks: ${sh.clocks.map((c) => `${c.id} ${c.boundary}: ${c.rule} (${c.owner})`).join("; ")}`);
  const so = prd.solution ?? {};
  if (so.summary) parts.push(`Solution: ${so.summary}`);
  if (so.in_scope?.length) parts.push(`In scope: ${so.in_scope.join("; ")}`);
  if (so.out_of_scope?.length) parts.push(`Out of scope: ${so.out_of_scope.map((x) => x.item).join("; ")}`);
  const su = prd.surfaces ?? {};
  if (su.shipped?.length) parts.push(`Surfaces: ${su.shipped.map((s) => `${s.id} ${s.statement}`).join("; ")}`);
  if (su.deferred?.length) parts.push(`Surfaces deferred: ${su.deferred.map((s) => `${s.kind} — ${s.rationale}`).join("; ")}`);
  if (prd.requirements?.length) {
    parts.push(`Requirements:\n${prd.requirements.map((r) => `  ${r.id} [${r.type}${r.status !== "committed" ? `, ${r.status}` : ""}] ${r.statement}${r.flags?.length ? " ⚠ " + r.flags.join("; ") : ""}`).join("\n")}`);
  }
  if (lineDrawn(prd)) {
    parts.push(`MVP line: ${prd.mvp.line}\n  inside: ${prd.mvp.inside.join(", ") || "(none)"}\n  past: ${prd.mvp.past.map((x) => `${x.ref} (${x.why})`).join("; ") || "(none)"}`);
  }
  if (prd.okr?.objective) parts.push(`Objective: ${prd.okr.objective}`);
  if (prd.okr?.key_results?.length) parts.push(`Key results: ${prd.okr.key_results.map((k) => `${k.id} ${k.statement}`).join("; ")}`);
  if (prd.open_questions?.length) parts.push(`Open questions: ${prd.open_questions.map((q) => `${q.id} ${q.question} (${q.owner})`).join("; ")}`);
  if (prd.constraints?.length) parts.push(`Constraints: ${prd.constraints.join("; ")}`);
  if (prd.flags?.length) parts.push(`Flags on record: ${prd.flags.map((f) => `[${f.kind} · ${f.section}] ${f.note}`).join("; ")}`);
  return parts.length ? parts.join("\n") : "(nothing captured yet)";
}

// ── the conversation ──

/** Whether a section may open now. Shape before scope (R12) is the one mechanical order. */
export function mayOpen(prd, key) {
  const s = section(key);
  if (indexOf(s.key) >= indexOf(LINE_SECTION) && prd.sections?.shape?.status !== "complete") {
    return { ok: false, code: "shape-first", message: `workshop: ${key} cannot open before the shape section is complete — the line is drawn through a shape, not instead of one` };
  }
  return { ok: true };
}

/**
 * The system prompt for one section: the interrogator's identity plus the section's,
 * then the generated mechanics — the fields this section captures, the MVP line as
 * scope once it exists — then context: the seed, what is captured, what exists in the
 * repo. The brief goes in before the first question is asked (R11).
 */
export function systemFor({ prd, key, brief }) {
  const s = section(key);
  const id = [identity(join(PROMPTS, "interrogator.md")), identity(join(PROMPTS, `${s.key}.md`))].join("\n\n");
  const scope = indexOf(s.key) > indexOf(LINE_SECTION) ? scopeOf(prd) ?? undefined : undefined;
  const mech = mechanics({ kind: "conversant", schema: "prd", only: s.fields, scope });
  const context = [
    `## Context`, ``,
    `The PM's original seed:`, `"${prd.seed}"`, ``,
    `### Already captured`, ``, captured(prd), ``,
    brief.text,
  ].join("\n");
  return assemble({ identity: id, mechanics: `${mech}\n\n${context}` });
}

/** The strip the console shows before a turn is triggered (R1): model, estimate, spent, budget. */
export function quoteTurn({ root, key }) {
  section(key);
  const project = loadProject(root);
  const model = modelFor({ half: "discovery", role: "workshop" }, project.models);
  return { section: key, model, ...quote(ledgerPath(root), { half: "discovery", role: "workshop", model, stage: "workshop", budget: project.budget }) };
}

export function parseReply(text) {
  const m = text.match(MODE);
  const mode = m ? MODES[m[1]] : null;
  const signals = Object.entries(SIGNALS).filter(([tag]) => text.includes(tag)).map(([, name]) => name);
  return { mode, signals, reply: stripSignals(text) };
}

export function stripSignals(text) {
  let out = text;
  for (const tag of Object.keys(SIGNALS)) out = out.split(tag).join("");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * One exchange: the PM's message in, the interrogator's reply out, both on the
 * transcript; the section's session and turn count updated; a signal changes the
 * section's status or puts a flag on the record.
 */
export async function turn({ root, key, text, onEvent, _query, _sleep, _now = () => new Date() }) {
  if (!text?.trim()) throw new WorkshopRefused("no-text", "workshop: a turn needs the PM's message");
  const project = loadProject(root);
  const prd = loadPrd(root);
  const s = section(key);
  const gate = mayOpen(prd, key);
  if (!gate.ok) throw new WorkshopRefused(gate.code, gate.message);

  const state = prd.sections[s.key];
  const brief = repoBrief(root);
  const system = systemFor({ prd, key: s.key, brief });

  const res = await call({
    half: "discovery", stage: "workshop", role: "workshop", kind: "converse",
    system, prompt: text, cwd: root, maxTurns: 1,
    resume: state.session_id ?? undefined,
    ledger: ledgerPath(root), budget: project.budget, models: project.models,
    onEvent, _query, _sleep,
  });

  const { mode, signals, reply } = parseReply(res.text ?? "");
  const at = _now().toISOString();
  appendTranscript(root, s.key, { at, from: "pm", text });
  appendTranscript(root, s.key, { at, from: "workshop", text: reply, mode, signals, model: res.model, usd: res.usd });

  // Re-read: the PM may have written while the model worked. The turn re-applies only its own state.
  const now = loadPrd(root);
  const fresh = now.sections[s.key];
  fresh.session_id = res.sessionId ?? fresh.session_id;
  fresh.turns += 1;
  fresh.status = signals.includes("complete") ? "complete" : "open";
  if (signals.includes("kill")) {
    now.flags.push({ at, section: s.key, kind: "kill_suggested", note: firstParagraph(reply) });
  }
  savePrd(root, now);

  return { section: s.key, reply, mode, signals, state: { ...fresh }, brief: brief.mode, model: res.model, usd: res.usd, sessionId: res.sessionId };
}

function firstParagraph(text) {
  return text.replace(MODE, "").trim().split(/\n\s*\n/)[0]?.trim().slice(0, 600) || "(no memo)";
}

// ── the transcript ──

export function transcriptPath(root, key) { return join(root, TRANSCRIPTS, `${key}.jsonl`); }

export function appendTranscript(root, key, row) {
  const file = transcriptPath(root, key);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(row) + "\n");
  return row;
}

export function readTranscript(root, key) {
  const file = transcriptPath(root, key);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

/** The transcript as the extractor reads it — who said what, in order. */
export function transcriptText(rows) {
  return rows.map((r) => `${r.from === "pm" ? "PM" : "Workshop"}: ${r.text}`).join("\n\n");
}

// ── the extraction ──

/** Every id already on the record in these fields, with the line it labels — the extractor must keep them. */
export function existingIds(prd, fields) {
  const out = [];
  const walk = (v, path) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}/${i}`));
    else if (v && typeof v === "object") {
      if (typeof v.id === "string") out.push({ id: v.id, label: v.statement ?? v.subject ?? v.action ?? v.boundary ?? v.question ?? "", path });
      for (const [k, x] of Object.entries(v)) if (k !== "id") walk(x, `${path}/${k}`);
    }
  };
  for (const f of fields) walk(prd[f], `/${f}`);
  return out;
}

/**
 * Transcribe a section's transcript into its fields. The output contract is the PRD
 * schema cut to the section (never retyped); the result is validated against it, the
 * ids that existed before must survive, and the merged document must validate whole
 * before it is written.
 */
export async function extract({ root, key, onEvent, _query, _sleep, _now = () => new Date() }) {
  const project = loadProject(root);
  const prd = loadPrd(root);
  const base = prdStamp(root);
  const s = section(key);
  const rows = readTranscript(root, s.key);
  if (!rows.length) throw new WorkshopRefused("no-transcript", `workshop: nothing to extract — ${s.key} has no transcript yet`);

  const contract = partialContract("prd", s.fields);
  const prior = existingIds(prd, s.fields);
  const system = assemble({ identity: identity(join(PROMPTS, "extractor.md")), mechanics: mechanics({ kind: "writer", schema: "prd", only: s.fields }) });
  const prompt = [
    `SECTION: ${s.label}`,
    prior.length ? `\nEXISTING ids to PRESERVE (same id for the same thing; mint new ones only for what is genuinely new):\n${prior.map((p) => `${p.id}: ${p.label}`).join("\n")}` : "",
    `\nTRANSCRIPT:\n${transcriptText(rows)}`,
    `\nReturn only the structured data.`,
  ].join("\n");

  const res = await call({
    half: "discovery", stage: "workshop", role: "writer", kind: "extract",
    system, prompt, cwd: root, outputSchema: contract,
    ledger: ledgerPath(root), budget: project.budget, models: project.models,
    onEvent, _query, _sleep,
  });

  if (res.structured === undefined) throw new WorkshopRefused("no-structured-output", `workshop: the extraction for ${s.key} returned no structured output`);
  const v = validateAgainst(contract, res.structured);
  if (!v.ok) throw new WorkshopRefused("extract-invalid", `workshop: the extraction for ${s.key} does not fit the contract — ${v.errors.slice(0, 5).join("; ")}`, v.errors);

  const next = structuredClone(prd);
  for (const f of s.fields) if (f in res.structured) next[f] = res.structured[f];
  const at = _now().toISOString();
  // A ruled criterion is the PM's (R3): removing one is refused by name, rewording one is held as a proposal.
  const held = holdRulings({ prd, next, root, key: s.key, at });
  const kept = new Set(existingIds(next, s.fields).map((p) => p.id));
  const dropped = prior.filter((p) => !kept.has(p.id));
  if (dropped.length) {
    throw new WorkshopRefused("ids-dropped", `workshop: the extraction for ${s.key} dropped ${dropped.map((p) => p.id).join(", ")} — ids are sticky; deferred and cut items keep theirs`, dropped);
  }

  next.sections[s.key].extracted_at = at;
  savePrd(root, next, { base });
  for (const { amendment, audit } of held) saveVerdict(root, audit, join(AUDIT_GATE, amendment.id));
  return { section: s.key, fields: s.fields, prd: next, held: held.map((h) => h.amendment), model: res.model, usd: res.usd };
}

/** Where the workshop stands: each section's state, and whether the line is drawn. */
export function progress(prd) {
  return {
    sections: SECTIONS.map((s) => ({ key: s.key, label: s.label, ...(prd.sections?.[s.key] ?? { status: "pending", session_id: null, turns: 0, extracted_at: null }), may_open: mayOpen(prd, s.key).ok })),
    line_drawn: lineDrawn(prd),
  };
}
