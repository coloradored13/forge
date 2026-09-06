// owns: R14, R13, R11 · delivery — the cold read. Delivery takes the handoff its run
// pinned and nothing else of Discovery's: validates it, reports drift per item against
// the latest snapshot exported since (R14 — never against Discovery's live record, which
// Delivery cannot see), notes what the repository holds (R11), re-runs the joins,
// compiles every scenario to steps, slices the backlog into work items the writers take,
// and sends the questions the snapshot still carries back across the seam, counted
// against a budget (R13). Nothing is resolved here. Drift is reported and the door is the
// PM's: proceed on the pin, or adopt the newer snapshot. No model is called.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Refused } from "../../shared/refused.mjs";
import { validate } from "../../shared/schema/index.mjs";
import { canonicalize, resolve } from "../../shared/hash.mjs";
import { saveDoc, saveVerdict } from "../../shared/store.mjs";
import { KINDS, itemFields, itemsOf, verifyHandoff, latestHandoff } from "../../shared/handoff.mjs";
import { deriveVerdict, rank, fit } from "../../shared/judge/verdict.mjs";
import { record as signal, funnelPath } from "../../shared/funnel.mjs";
import { whatExists, manifestSummary, MANIFEST } from "../../shared/existing.mjs";
import { readRun } from "../state/index.mjs";

export const GATE = "intake";
export const INTAKE_FILE = join("forge", "delivery", "intake.json");
export const VERDICT_FILE = join("forge", "delivery", "reviews", "intake.json");
/** Precision questions a story may carry across the seam before it is a Discovery gate-miss (SPEC §10.5). */
export const QUESTION_BUDGET = 2;

const iso = (d) => (d instanceof Date ? d : new Date(d ?? Date.now())).toISOString();

/**
 * The handoff a run pinned, verified — the one Discovery artifact any Delivery stage reads.
 * Refuses, in order: the pinned file gone; a file that is not a handoff; a handoff that is
 * not the one pinned (an edit that re-hashed itself — the pin is the run's word on what it
 * took); one whose items no longer verify.
 */
export function takePinned(root, run) {
  const pin = run.handoff;
  const file = join(root, pin.path);
  if (!existsSync(file)) throw new Refused("no-handoff", `${pin.path} is not here — the run pinned a snapshot the repository does not hold`);
  let handoff;
  try { handoff = JSON.parse(readFileSync(file, "utf8")); } catch (e) { throw new Refused("handoff-invalid", `${pin.path} is not JSON: ${String(e.message).split("\n")[0]}`); }
  const shape = validate("handoff", handoff);
  if (!shape.ok) throw new Refused("handoff-invalid", `${pin.path} is not a handoff — ${shape.errors.slice(0, 5).join("; ")}`, shape.errors);
  if (handoff.meta?.content_hash !== pin.content_hash) {
    throw new Refused("handoff-moved", `${pin.path} is not the snapshot the run pinned — pinned ${pin.content_hash}, on disk ${handoff.meta?.content_hash} — a snapshot is never edited; re-export and adopt`, { pinned: pin.content_hash, found: handoff.meta?.content_hash });
  }
  const integrity = verifyHandoff(handoff);
  if (integrity.verdict === "block") throw new Refused("handoff-integrity", `${pin.path} does not verify: ${integrity.findings.map((f) => `${f.subject} ${f.rule}`).join(", ")} — a snapshot is never edited; re-export`, integrity);
  return handoff;
}

/**
 * Take the pinned handoff (refusing as `takePinned` does, after `no-run`), then write the
 * record and file the verdict where the machine's finish door reads it.
 * @returns { record, verdict: path, file: path }
 */
export function intake(root, { now } = {}) {
  const run = readRun(root);
  if (!run) throw new Refused("no-run", `${root} has no run — set Delivery up first; intake takes the handoff the run pinned`);
  const pin = run.handoff;
  const handoff = takePinned(root, run);

  const latest = latestHandoff(root);
  const moved = drift(handoff, latest);
  const seen = whatExists(root);
  const compiled = compile(handoff);
  const work_items = slice(handoff, compiled.scenarios);
  const asked = ask(handoff, work_items);

  const findings = [...joins(handoff), ...compiled.findings];
  for (const c of moved.changed) findings.push(driftFinding(c.id, `${c.id} (${c.kind}) changed in v${moved.against.version}: ${c.fields.map((f) => f.field).join(", ")}.`, `pinned v${pin.version} · latest v${moved.against.version} · ${c.fields.map((f) => `${f.field} ${short(f.was)} → ${short(f.now)}`).join("; ")}`, moved.against.version));
  for (const a of moved.added) findings.push(driftFinding(a.id, `${a.id} (${a.kind}) is in v${moved.against.version} and not in the snapshot this run pinned.`, `pinned v${pin.version} has no ${a.kind} ${a.id}; v${moved.against.version} does`, moved.against.version));
  for (const r of moved.removed) findings.push(driftFinding(r.id, `${r.id} (${r.kind}) is in the snapshot this run pinned and gone from v${moved.against.version}.`, `pinned v${pin.version} holds ${r.kind} ${r.id}; v${moved.against.version} does not`, moved.against.version));
  for (const q of asked.questions) {
    findings.push(q.blocking
      ? { severity: "high", confidence: "certain", rule: "question", subject: q.story ?? q.subject ?? q.source, summary: fit(`A blocking question rides in the snapshot: ${q.question}`), evidence: `${q.source} open_questions · subject ${q.subject ?? "—"} · blocking · ${q.question}`, remedy: "Answer it in Discovery and adopt the re-export, or override with the reason on record." }
      : { severity: "low", confidence: "likely", rule: "question", subject: q.story ?? q.subject ?? q.source, summary: fit(`An open question rides in the snapshot: ${q.question}`), evidence: `${q.source} open_questions · subject ${q.subject ?? "—"} · ${q.question}`, remedy: "Carry it, or answer it in Discovery — the writers will read it as a question, not a decision." });
  }
  for (const o of asked.budget.over) {
    findings.push({ severity: "low", confidence: "likely", rule: "question-budget", subject: o.story, summary: `${o.story} carries ${o.count} precision questions across the seam; the budget is ${QUESTION_BUDGET}.`, evidence: `R13: syntax crosses for free, precision is what intake compiles — ${o.count} > ${QUESTION_BUDGET} is a Discovery gate-miss, counted in the funnel`, remedy: "Nothing here; the meter is the point. The stories reviewer's bar is where this is fixed." });
    signal(funnelPath(root), { signal: "intake-questions", gate: GATE, story: o.story, count: o.count, budget: QUESTION_BUDGET }, () => new Date(iso(now)));
  }

  const verdict = {
    gate: GATE, verdict: deriveVerdict(findings), findings: rank(findings), deferred: [],
    checked: itemsOf(handoff).length + compiled.scenarios.length, skipped: 0,
    judged: [{ id: `handoff-v${handoff.version}`, path: pin.path, content_hash: handoff.meta.content_hash }],
  };
  const record = {
    id: `intake-${run.id}`, meta: {}, handoff: { ...pin }, taken_at: iso(now),
    drift: moved,
    existing: {
      mode: seen.mode,
      manifest: seen.manifest ? { path: MANIFEST, summary: seen.manifest.unreadable ? [`unreadable: ${seen.manifest.unreadable}`] : manifestSummary(seen.manifest) } : null,
      files: seen.files.length,
      top_level: [...new Set(seen.files.map((f) => f.split("/")[0]))],
    },
    scenarios: compiled.scenarios, work_items, questions: asked.questions, budget: asked.budget,
    "x-drift-checked": ["/handoff", "/scenarios", "/work_items", "/questions"],
  };
  saveDoc(root, INTAKE_FILE, "intake", record);
  saveVerdict(root, VERDICT_FILE, verdict);
  return { record, verdict: VERDICT_FILE, file: INTAKE_FILE };
}

const short = (v) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s.length > 60 ? `${s.slice(0, 57)}…` : s; };

function driftFinding(subject, summary, evidence, version) {
  return { severity: "medium", confidence: "certain", rule: "drift", subject, summary, evidence, remedy: `Proceed on the pinned snapshot, or adopt v${version} onto the run — approved stages go stale and are re-judged (R5).` };
}

// ── drift: the pinned snapshot against the latest, per item over its hashed fields ──

/**
 * @param pinned  the handoff the run pinned
 * @param latest  the latest handoff exported, or null
 * @returns { against, unchanged[id], changed[{id, kind, fields[{field, was, now}]}], added[{id, kind}], removed[{id, kind}] }
 * `against` is null when the pin is the latest — then everything is unchanged.
 */
export function drift(pinned, latest) {
  const out = { against: null, unchanged: [], changed: [], added: [], removed: [] };
  if (!latest || latest.meta?.content_hash === pinned.meta?.content_hash) {
    out.unchanged = itemsOf(pinned).map((it) => it.id);
    return out;
  }
  out.against = { version: latest.version, content_hash: latest.meta.content_hash };
  const was = itemsOf(pinned), now = new Map(itemsOf(latest).map((it) => [`${it.kind}:${it.id}`, it]));
  const wasDocs = docsOf(pinned), nowDocs = docsOf(latest);
  for (const it of was) {
    const key = `${it.kind}:${it.id}`;
    const n = now.get(key);
    if (!n) out.removed.push({ id: it.id, kind: it.kind });
    else if (n.hash !== it.hash) out.changed.push({ id: it.id, kind: it.kind, fields: fieldDiff(it.kind, wasDocs.get(key), nowDocs.get(key)) });
    else out.unchanged.push(it.id);
    now.delete(key);
  }
  for (const it of now.values()) out.added.push({ id: it.id, kind: it.kind });
  return out;
}

/** Every indexed item of a handoff by `kind:id`, the item itself. */
function docsOf(handoff) {
  const out = new Map();
  for (const [kind, { at, id }] of Object.entries(KINDS)) {
    const list = resolve(handoff, at);
    if (Array.isArray(list)) for (const it of list) out.set(`${kind}:${it[id]}`, it);
  }
  return out;
}

function fieldDiff(kind, a, b) {
  return itemFields(kind).filter((f) => canonicalize(a?.[f] ?? null) !== canonicalize(b?.[f] ?? null)).map((f) => ({ field: f, was: a?.[f] ?? null, now: b?.[f] ?? null }));
}

// ── joins: what the export door checked, checked again — Delivery trusts nothing it did not verify ──

/** Finding-shaped, every join in the snapshot: story → epic → requirement, story → screen, scenario → criterion, and every functional criterion inside the line proved by something. */
export function joins(handoff) {
  const c = handoff.contract, s = handoff.stories, d = handoff.design;
  const findings = [];
  const f = (rule, subject, summary, evidence) => findings.push({ severity: "high", confidence: "certain", rule, subject, summary, evidence, remedy: "Re-export a snapshot whose joins hold; nothing is patched on this side of the seam." });
  const reqs = new Map(c.requirements.map((r) => [r.id, r]));
  const criteria = new Set(c.requirements.flatMap((r) => (r.acceptance_criteria ?? []).map((ac) => `${r.id}/${ac.id}`)));
  const epics = new Map(s.epics.map((e) => [e.id, e]));
  const screens = new Set((d?.screens ?? []).map((sc) => sc.screen_ref));
  for (const e of s.epics) if (!reqs.has(e.req_ref)) f("join-epic-requirement", e.id, `${e.id} sits on ${e.req_ref}, which the contract does not hold.`, `epic.req_ref ${e.req_ref} · contract requirements ${[...reqs.keys()].join(", ") || "none"}`);
  for (const st of s.stories) {
    if (!epics.has(st.epic)) f("join-story-epic", st.id, `${st.id} is in ${st.epic}, which the backlog does not hold.`, `story.epic ${st.epic} · epics ${[...epics.keys()].join(", ") || "none"}`);
    for (const r of st.req_refs ?? []) if (!reqs.has(r)) f("join-story-requirement", st.id, `${st.id} claims ${r}, which the contract does not hold.`, `story.req_refs ${st.req_refs.join(", ")} · contract requirements ${[...reqs.keys()].join(", ") || "none"}`);
    for (const sc of st.screen_refs ?? []) if (!screens.has(sc)) f("join-story-screen", st.id, `${st.id} runs on ${sc}, which the signed design does not draw.`, `story.screen_refs ${st.screen_refs.join(", ")} · design screens ${[...screens].join(", ") || "none"}`);
    (st.scenarios ?? []).forEach((sn, i) => { for (const p of sn.proves ?? []) if (!criteria.has(p)) f("join-scenario-criterion", `${st.id}/${i + 1}`, `Scenario "${sn.name}" proves ${p}, which the contract does not hold.`, `scenario.proves ${sn.proves.join(", ")} · criteria ${[...criteria].join(", ") || "none"}`); });
  }
  const proved = new Set(s.stories.flatMap((st) => (st.scenarios ?? []).flatMap((sn) => sn.proves ?? [])));
  for (const r of c.requirements) {
    if (r.type !== "functional") continue;
    for (const ac of r.acceptance_criteria ?? []) { const k = `${r.id}/${ac.id}`; if (!proved.has(k)) f("join-criterion-unproved", k, `${k} is inside the line and no scenario proves it.`, `${k}: ${ac.statement}`); }
  }
  return findings;
}

// ── compile: every scenario to steps ──

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);

/**
 * Gherkin lines to steps. Given / When / Then set the kind; And / But take the kind of the
 * line before them. A line with no keyword, or an And with nothing before it, is refused
 * — the stories writer's shape rule should have caught it; here it is a defect in the
 * snapshot, not something to guess around.
 */
export function parseGherkin(text) {
  const steps = [];
  let last = null;
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(Given|When|Then|And|But)\b\s*(.*)$/i.exec(line);
    if (!m) throw new Refused("bad-gherkin", `a scenario line has no keyword: "${line}" — Given, When, Then, And or But`);
    const word = m[1].toLowerCase();
    const kind = word === "and" || word === "but" ? last : word;
    if (!kind) throw new Refused("bad-gherkin", `"${line}" continues nothing — And and But follow a Given, When or Then`);
    last = kind;
    const body = m[2].trim();
    steps.push({ kind, text: body, step: slug(`${kind} ${body}`) });
  }
  if (!steps.length) throw new Refused("bad-gherkin", "a scenario has no steps");
  return steps;
}

/** @returns { scenarios, findings } — a scenario that does not compile is a finding with empty steps, never a crash. */
export function compile(handoff) {
  const scenarios = [], findings = [];
  for (const st of handoff.stories.stories) {
    (st.scenarios ?? []).forEach((sn, i) => {
      const id = `${st.id}/${i + 1}`;
      let steps = [];
      try { steps = parseGherkin(sn.gherkin); } catch (e) {
        findings.push({ severity: "high", confidence: "certain", rule: "compile-gherkin", subject: id, summary: fit(`Scenario "${sn.name}" does not compile: ${e.message}`), evidence: sn.gherkin ?? "(no gherkin)", remedy: "Re-export a backlog whose scenarios parse; the stories writer's shape rule is the home of this." });
      }
      scenarios.push({ id, story: st.id, name: sn.name, proves: [...(sn.proves ?? [])], screens: [...(st.screen_refs ?? [])], steps });
    });
  }
  return { scenarios, findings };
}

// ── slice: the backlog as work items ──

/**
 * One item per story in epic order, carrying the criteria its scenarios prove (with the
 * contract's text), the signed design's screens it runs on (control ids, state names) and
 * its scenario ids; then one per non-functional or constraint requirement inside the line
 * that no story carries — verified by measurement or inspection, not by a story.
 */
export function slice(handoff, scenarios) {
  const c = handoff.contract, s = handoff.stories, d = handoff.design;
  const criteria = new Map(c.requirements.flatMap((r) => (r.acceptance_criteria ?? []).map((ac) => [`${r.id}/${ac.id}`, ac.statement])));
  const order = [...criteria.keys()];
  const screens = new Map((d?.screens ?? []).map((sc) => [sc.screen_ref, sc]));
  const screen = (ref) => {
    const sc = screens.get(ref);
    return { screen_ref: ref, name: sc?.name ?? null, controls: (sc?.controls ?? []).map((k) => k.id), states: (sc?.states ?? []).map((st) => st.name) };
  };
  const epicAt = new Map(s.epics.map((e, i) => [e.id, i]));
  const stories = [...s.stories].sort((a, b) => (epicAt.get(a.epic) ?? Infinity) - (epicAt.get(b.epic) ?? Infinity) || s.stories.indexOf(a) - s.stories.indexOf(b));
  const items = stories.map((st) => {
    const mine = scenarios.filter((x) => x.story === st.id);
    const proved = new Set(mine.flatMap((x) => x.proves));
    return {
      id: st.id, kind: "story", epic: st.epic, statement: st.statement, req_refs: [...(st.req_refs ?? [])],
      criteria: order.filter((k) => proved.has(k)).map((k) => ({ id: k, statement: criteria.get(k) })),
      screens: (st.screen_refs ?? []).map(screen),
      scenarios: mine.map((x) => x.id),
    };
  });
  const storied = new Set(s.stories.flatMap((st) => st.req_refs ?? []));
  for (const r of c.requirements) {
    if (r.type === "functional" || storied.has(r.id)) continue;
    items.push({ id: r.id, kind: "requirement", epic: null, statement: r.statement, req_refs: [r.id], criteria: (r.acceptance_criteria ?? []).map((ac) => ({ id: `${r.id}/${ac.id}`, statement: ac.statement })), screens: [], scenarios: [] });
  }
  return items;
}

// ── ask: the questions the snapshot carries, attributed and counted ──

/**
 * Every open question in the snapshot — the contract's, the stories', the design's —
 * attributed to a story where the subject allows: STORY-n directly; REQ-n (or REQ-n/AC-m)
 * through the stories that carry the requirement; SCREEN-n through the stories on that
 * screen. A question no story takes rides with story null. Never trimmed: the budget is
 * a meter (R13), and the funnel row is written by the caller.
 * @returns { questions, budget: { per_story, over[{story, count}] } }
 */
export function ask(handoff, work_items = []) {
  const c = handoff.contract, s = handoff.stories, d = handoff.design;
  const stories = work_items.filter((w) => w.kind === "story");
  const attribute = (subject) => {
    if (!subject) return [null];
    if (/^STORY-\d+$/.test(subject)) return [subject];
    const req = /^(REQ-\d+)(?:\/|$)/.exec(subject)?.[1];
    const hits = req ? stories.filter((w) => w.req_refs.includes(req))
      : /^SCREEN-\d+$/.test(subject) ? stories.filter((w) => w.screens.some((sc) => sc.screen_ref === subject))
      : [];
    return hits.length ? hits.map((w) => w.id) : [null];
  };
  const questions = [];
  const push = (source, subject, question, blocking) => { for (const story of attribute(subject)) questions.push({ id: `Q-${questions.length + 1}`, subject: subject ?? null, story, question, blocking, source }); };
  for (const q of c.open_questions ?? []) if (q.status === "open") push("contract", null, q.question, false);
  for (const q of s.open_questions ?? []) push("stories", q.subject, q.question, Boolean(q.blocking));
  for (const q of d?.open_questions ?? []) push("design", q.subject, q.question, Boolean(q.blocking));
  const counts = new Map();
  for (const q of questions) if (q.story) counts.set(q.story, (counts.get(q.story) ?? 0) + 1);
  const over = [...counts].filter(([, n]) => n > QUESTION_BUDGET).map(([story, count]) => ({ story, count }));
  return { questions, budget: { per_story: QUESTION_BUDGET, over } };
}
