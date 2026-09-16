// owns: R1, R12 · discovery — adaptive interview, emergent record, isolated deriver.
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { call } from "../../shared/agent-call/index.mjs";
import { ledgerPath, loadProject } from "../setup/index.mjs";
import { ALWAYS, byId, catalogue } from "./craft.mjs";

export const SESSION_FILE = join("discovery", "interview", "session.json");
export const EVENTS_FILE = join("discovery", "interview", "events.jsonl");
export const OPENING = "What are you considering building?";
const TYPES = ["claim", "person", "crux", "surface", "exclusion", "requirement", "criterion", "definition", "rule", "constraint", "objective", "measure", "reading", "unknown", "decision", "risk", "override", "interpretation", "engineering_question", "scope_line"];

const string = { type: "string" };
const consequence = {
  type: "object", additionalProperties: false,
  required: ["sources", "scenario", "result", "record_says", "assumed", "unspecified"],
  properties: {
    sources: { type: "array", items: string }, scenario: string, result: string,
    record_says: string, assumed: string, unspecified: string,
  },
};
const schemas = {
  assess: {
    type: "object", additionalProperties: false, required: ["activate", "reason"],
    properties: { activate: { type: "array", maxItems: 2, items: { type: "string", enum: catalogue().map((x) => x.id) } }, reason: string },
  },
  interview: {
    type: "object", additionalProperties: false,
    required: ["posture", "reason", "question", "expected_answer", "record_delta"],
    properties: { posture: { enum: ["drawing-out", "pressure-testing"] }, reason: string, question: string, expected_answer: { enum: ["short-factual", "open"] }, record_delta: { type: "array", items: entrySchema() } },
  },
  reconcile: {
    type: "object", additionalProperties: false, required: ["entries", "unfitted"],
    properties: { entries: { type: "array", items: entrySchema() }, unfitted: { type: "array", items: { type: "object", additionalProperties: false, required: ["content", "reason"], properties: { content: string, reason: string } } } },
  },
  derive: { type: "object", additionalProperties: false, required: ["consequences"], properties: { consequences: { type: "array", items: consequence } } },
};

function entrySchema() { return { type: "object", additionalProperties: false, required: ["type", "content", "status"], properties: { id: { type: "string" }, type: { type: "string", enum: TYPES }, content: { type: "string" }, status: { enum: ["proposed", "tested", "settled", "unsettled", "open", "superseded", "rejected"] }, evidence: { enum: ["observed", "reported", "assumed"] }, rationale: { type: "string" }, owner: { type: "string" }, sources: { type: "array", items: { type: "string" } } } }; }
const clone = (v) => JSON.parse(JSON.stringify(v));
const now = () => new Date().toISOString();
const pathOf = (root, rel) => join(root, rel);
const write = (root, session) => { const file = pathOf(root, SESSION_FILE); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(session, null, 2) + "\n"); return session; };
const event = (root, row) => { const file = pathOf(root, EVENTS_FILE); mkdirSync(dirname(file), { recursive: true }); appendFileSync(file, JSON.stringify({ at: now(), ...row }) + "\n"); };

export function openSession({ root, seed, _now = now }) {
  if (!seed?.trim()) throw new Error("interview: an opening answer is required");
  if (existsSync(pathOf(root, SESSION_FILE))) throw new Error("interview: a session already exists");
  const session = { id: randomUUID(), created_at: _now(), phase: "defining", status: "active", opening: OPENING, transcript: [{ from: "pm", text: seed.trim(), at: _now() }], record: { version: 0, entries: [], unfitted: [] }, pending: [], active_craft: [], turns: [], derivations: [], convergence: false };
  event(root, { kind: "session.opened", session: session.id, opening: OPENING, answer: seed.trim() });
  return write(root, session);
}

export function loadSession(root) {
  const file = pathOf(root, SESSION_FILE);
  if (!existsSync(file)) throw new Error("interview: no session — answer the opening question first");
  return JSON.parse(readFileSync(file, "utf8"));
}

export async function interviewTurn({ root, text, action = "defend", _invoke }) {
  if (!text?.trim()) throw new Error("interview: a response is required");
  const s = loadSession(root), started = Date.now(), calls = [];
  s.transcript.push({ from: "pm", text: text.trim(), action, at: now() });
  if (action === "flag") s.record.entries.push(normalize({ type: "override", content: text.trim(), status: "open", rationale: "PM chose to flag this and move on." }, s));

  const prior = s.turns.at(-1);
  const assess = !prior || prior.expected_answer !== "short-factual" || action !== "defend" || s.turns.length % 4 === 3;
  let activated = s.active_craft;
  if (assess) {
    const a = await invoke({ root, role: "assess", input: { catalogue: catalogue(), record: s.record, latest: text, action }, schema: schemas.assess, _invoke, calls });
    activated = a.output.activate;
  }
  const response = await invoke({ root, role: "interview", input: { always: ALWAYS, craft: byId(activated), record: s.record, pending: s.pending, latest: text, action }, schema: schemas.interview, _invoke, calls });
  s.active_craft = activated;
  s.pending.push(...response.output.record_delta.map((x) => normalize(x, s)));
  const force = ["workshop", "flag", "correct"].includes(action) || s.pending.some((x) => ["unsettled", "superseded", "rejected"].includes(x.status)) || s.pending.length >= 3;
  if (force) await reconcile({ root, session: s, _invoke, calls });
  const assistant = { from: "interviewer", posture: response.output.posture, reason: response.output.reason, text: response.output.question, craft: activated, at: now() };
  s.transcript.push(assistant);
  const telemetry = { ms: Date.now() - started, calls: calls.length, foreground: calls.filter((x) => x.role !== "reconcile").length, detail: calls, assessed: assess, reconciled: force };
  s.turns.push({ ...assistant, expected_answer: response.output.expected_answer, telemetry });
  event(root, { kind: "turn.completed", session: s.id, telemetry, craft: activated });
  write(root, s);
  return { ...assistant, telemetry, actions: ["defend", "workshop", "flag", "correct"] };
}

export async function flushRecord({ root, _invoke }) {
  const s = loadSession(root), calls = [];
  await reconcile({ root, session: s, _invoke, calls });
  write(root, s);
  return { record: s.record, calls };
}

async function reconcile({ root, session: s, _invoke, calls }) {
  if (!s.pending.length) return;
  const r = await invoke({ root, role: "reconcile", input: { authoritative_record: s.record, pending_deltas: s.pending, instruction: "Never force content into a nearby type. Put content that does not fit in unfitted." }, schema: schemas.reconcile, _invoke, calls });
  s.record = { version: s.record.version + 1, entries: r.output.entries.map((x) => normalize(x, s)), unfitted: [...s.record.unfitted, ...r.output.unfitted.map((x) => ({ id: randomUUID(), ...x, at: now() }))] };
  s.pending = [];
  event(root, { kind: "record.reconciled", session: s.id, version: s.record.version, unfitted: r.output.unfitted.length });
}

export async function derive({ root, _invoke }) {
  const s = loadSession(root), calls = [];
  if (s.pending.length) await reconcile({ root, session: s, _invoke, calls });
  const snapshot = clone(s.record); // only this value crosses the deriver boundary
  event(root, { kind: "derivation.started", session: s.id, record_version: snapshot.version, planned_calls: 1, covers: ["rules", "definitions", "edge cases", "behavior", "measures", "thresholds"] });
  const d = await invoke({ root, role: "derive", input: { record: snapshot }, schema: schemas.derive, _invoke, calls, recordOnly: true });
  const round = { id: randomUUID(), record_version: snapshot.version, status: "open", consequences: d.output.consequences.map((x) => ({ id: randomUUID(), status: "open", ...x })), calls, at: now() };
  s.derivations.push(round); s.convergence = round.consequences.length === 0;
  write(root, s); event(root, { kind: "derivation.completed", session: s.id, round: round.id, consequences: round.consequences.length });
  return round;
}

export function react({ root, roundId, consequenceId, reaction, correction }) {
  const s = loadSession(root), round = s.derivations.find((x) => x.id === roundId), c = round?.consequences.find((x) => x.id === consequenceId);
  if (!c) throw new Error("interview: consequence not found");
  if (!['confirm', 'change', 'reject', 'unresolved'].includes(reaction)) throw new Error("interview: invalid reaction");
  c.status = reaction; c.correction = correction?.trim() || undefined;
  if (reaction === "confirm") s.record.entries.push(normalize({ type: "interpretation", content: c.result, status: "settled", rationale: c.scenario, sources: c.sources }, s));
  if (reaction === "change" || reaction === "reject") {
    for (const source of c.sources) { const e = s.record.entries.find((x) => x.id === source); if (e) e.status = "unsettled"; }
    s.pending.push(normalize({ type: "interpretation", content: correction?.trim() || `Rejected consequence: ${c.result}`, status: "unsettled", rationale: `${reaction} of ${c.id}`, sources: c.sources }, s));
  }
  round.status = round.consequences.every((x) => x.status !== "open") ? "complete" : "open";
  s.convergence = false; write(root, s); event(root, { kind: "consequence.reacted", round: round.id, consequence: c.id, reaction });
  return c;
}

export function exportSession({ root }) {
  const s = loadSession(root); const dir = pathOf(root, join("discovery", "interview", "exports")); mkdirSync(dir, { recursive: true });
  const json = join(dir, `record-v${s.record.version}.json`), md = join(dir, `record-v${s.record.version}.md`);
  writeFileSync(json, JSON.stringify({ session: s.id, phase: s.phase, record: s.record, derivations: s.derivations }, null, 2) + "\n");
  const groups = Object.groupBy(s.record.entries, (x) => x.type);
  const body = [`# Product interrogation record`, ``, `Record version ${s.record.version}.`, ...Object.entries(groups).flatMap(([type, entries]) => [``, `## ${type.replaceAll("_", " ")}`, ``, ...entries.map((x) => `- **${x.status}** ${x.content}${x.evidence ? ` _(${x.evidence})_` : ""}`)]), ...(s.record.unfitted.length ? ["", "## Did not fit", "", ...s.record.unfitted.map((x) => `- ${x.content} — ${x.reason}`)] : [])].join("\n") + "\n";
  writeFileSync(md, body); event(root, { kind: "session.exported", session: s.id, version: s.record.version, files: [md, json] });
  return { markdown: md, json };
}

function normalize(entry, session) { return { id: entry.id || `REC-${session.record.entries.length + session.pending.length + 1}-${randomUUID().slice(0, 6)}`, ...entry, sources: entry.sources ?? [] }; }

async function invoke({ root, role, input, schema, _invoke, calls, recordOnly = false }) {
  const started = Date.now(); let output, model = "test";
  if (_invoke) output = await _invoke(role, clone(input), schema);
  else {
    const project = loadProject(root);
    const res = await call({ half: "discovery", stage: `interview-${role}`, role: "workshop", kind: role === "derive" ? "extract" : "converse", system: system(role), prompt: JSON.stringify(input), outputSchema: schema, maxTurns: 1, cwd: root, ledger: ledgerPath(root), budget: project.budget, models: project.models });
    output = res.structured; model = res.model;
  }
  if (!output) throw new Error(`interview: ${role} returned no structured output`);
  const meta = { role, ms: Date.now() - started, model, record_only: recordOnly }; calls.push(meta);
  event(root, { kind: "model.call", role, manifest: { record_only: recordOnly, keys: Object.keys(input), record_version: input.record?.version ?? input.authoritative_record?.version }, ...meta });
  return { output, meta };
}

function system(role) {
  if (role === "assess") return "Select at most two craft units whose triggers apply now. The library is a resource, never a route.";
  if (role === "interview") return "Use the loaded craft as the foreground concern. Ask exactly one concise question. Return only the structured response.";
  if (role === "reconcile") return "Reconcile into an emergent record. Preserve meaning, provenance and unknowns. Never guess and never force unfitted content into a type.";
  return "You are an independent deriver. You receive the record only. Derive concrete consequences where interpretation is required and expose record text, assumptions and unspecified gaps.";
}
