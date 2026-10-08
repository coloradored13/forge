// owns: R3, R4 · discovery — the PM's doors into a PRD after the workshop. `answer`: a
// human's answer becomes a criterion in one operation — attributed, pinned, versioned —
// and the ruling rides into every agent after it; nothing re-raises it, and no extraction
// rewrites it (R3). `propose` / `approve` / `reject`: an amendment computes its blast
// radius — every criterion, story and screen that references what changes — and the
// vocabulary it introduces, at mint; the PM approves the radius, not just the edit (R4).
// `agree`: the PM's agreement names the exact PRD and prototype stories are written from.
// After the line is drawn a ruled criterion moves only through these doors; extraction
// may still change unruled content. No door edits a hash by hand.

import { join } from "node:path";
import { load, validate } from "../../shared/schema/index.mjs";
import { canonicalize, resolve, stamp } from "../../shared/hash.mjs";
import { deriveVerdict, pin, fit } from "../../shared/judge/index.mjs";
import { record as recordSignal, funnelPath } from "../../shared/funnel.mjs";
import { loadPrd, savePrd, PRD_FILE } from "../workshop/index.mjs";
import { Refused, readDoc, saveDoc, saveVerdict, criterionAt, PROTOTYPE_FILE, STORIES_FILE, bumpVersion } from "../record/index.mjs";

export const AUDIT_GATE = "amendment-audit";

const nextId = (items, prefix) => `${prefix}-${Math.max(0, ...items.map((x) => Number(String(x.id).split("-")[1]) || 0)) + 1}`;
const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

// ── R3 · answer ──

/**
 * @param req        the requirement the answer becomes a criterion of
 * @param oq         the open question it answers, if one — closed on the record
 * @param pq         the prototype question it answers, if one — marked answered on the prototype's record
 * @param question   the question, when there is no OQ or PQ (or to override its wording)
 * @param answer     the PM's answer, as given
 * @param criterion  the criterion's wording, when the answer is not already one
 * @param by         who ruled — a ruling without a name is not a ruling
 */
export function answer({ root, req, oq, pq, question, answer: text, criterion, by, _now = () => new Date() }) {
  if (!by?.trim()) throw new Refused("no-author", "answer: a ruling is attributed — say who answered");
  if (!text?.trim()) throw new Refused("no-answer", "answer: an answer is required");
  if (oq && pq) throw new Refused("two-questions", "answer: one answer settles one question — name the PRD's open question or the prototype's, not both");
  const prd = loadPrd(root);
  const r = (prd.requirements ?? []).find((x) => x.id === req);
  if (!r) throw new Refused("unknown-req", `answer: ${req} is not a requirement in the PRD`);

  let q = question?.trim();
  let open = null;
  if (oq) {
    open = (prd.open_questions ?? []).find((x) => x.id === oq);
    if (!open) throw new Refused("unknown-question", `answer: ${oq} is not an open question in the PRD`);
    if (open.status !== "open") throw new Refused("already-ruled", `answer: ${oq} is ${open.status} — a settled question is not re-answered; amend the criterion it became`);
    q ||= open.question;
  }
  let proto = null;
  let asked = null;
  if (pq) {
    proto = readDoc(root, PROTOTYPE_FILE);
    asked = (proto?.open_questions ?? []).find((x) => x.id === pq);
    if (!asked) throw new Refused("unknown-question", `answer: ${pq} is not a question the prototype asks`);
    if (asked.status !== "open") throw new Refused("already-ruled", `answer: ${pq} is ${asked.status}${asked.ruling ? ` by ${asked.ruling}` : ""} — a settled question is not re-answered; amend the criterion it became`);
    q ||= asked.question;
  }
  if (!q) throw new Refused("no-question", "answer: name the open question this answers, or state the question");
  const dup = (prd.rulings ?? []).find((x) => norm(x.question) === norm(q));
  if (dup) throw new Refused("already-ruled", `answer: ${dup.id} already ruled on "${q}" → ${dup.answer} (${dup.criterion}); amend that criterion instead`);

  const at = _now().toISOString();
  const ac = { id: nextId(r.acceptance_criteria ?? [], "AC"), statement: (criterion ?? text).trim() };
  r.acceptance_criteria = [...(r.acceptance_criteria ?? []), ac];
  if (open) open.status = "answered";
  prd.meta.version = bumpVersion(prd.meta.version, "minor");

  const ruling = { id: nextId(prd.rulings ?? [], "RUL"), ...(oq ? { oq } : {}), ...(pq ? { pq } : {}), question: q, answer: text.trim(), by: by.trim(), at, criterion: `${r.id}/${ac.id}`, version: prd.meta.version, prd_hash: "" };
  prd.rulings = [...(prd.rulings ?? []), ruling];
  prd.flags.push({ at, section: "requirements", kind: "note", note: `${ruling.id} by ${ruling.by}: "${q}" → ${ruling.answer} · became ${ruling.criterion}` });
  stamp(prd);
  ruling.prd_hash = prd.meta.content_hash;
  if (asked) {
    Object.assign(asked, { status: "answered", ruling: ruling.id });
    const v = validate("prototype", proto); // checked before either record moves
    if (!v.ok) throw new Refused("prototype-invalid", `answer: the prototype's record does not fit its schema — ${v.errors.slice(0, 5).join("; ")}`, v.errors);
  }
  savePrd(root, prd);
  if (asked) saveDoc(root, PROTOTYPE_FILE, "prototype", proto);
  return { ruling, requirement: r.id, criterion: ac, prd };
}

/**
 * What an extraction may do to a criterion a ruling made (R3): nothing. A removal is
 * refused, naming it. A rewording is put back and held as a proposal through the amend
 * door, minted against the extraction's own result so the PM can approve it as it
 * stands. Returns the minted amendments and audits, for the caller to file once the PRD
 * is written.
 */
export function holdRulings({ prd, next, root, key, at }) {
  const removed = [];
  const reworded = [];
  for (const r of prd.rulings ?? []) {
    const was = criterionAt(prd, r.criterion);
    const now = criterionAt(next, r.criterion);
    if (!was) continue;
    if (!now) removed.push(r);
    else if (now.ac.statement !== was.ac.statement) {
      reworded.push({ r, target: `/requirements/${now.i}/acceptance_criteria/${now.j}/statement`, to: now.ac.statement });
      now.ac.statement = was.ac.statement;
    }
  }
  if (removed.length) throw new Refused("ruled-criterion", `workshop: the extraction for ${key} removes ${removed.map((r) => `${r.criterion}, which ${r.id} settled`).join("; ")} — a ruled criterion changes only through the amend door`, removed);
  if (!reworded.length) return [];
  stamp(next);
  const proto = readDoc(root, PROTOTYPE_FILE);
  const stories = readDoc(root, STORIES_FILE);
  return reworded.map(({ r, target, to }) => mint({ prd: next, proto, stories, target, to, at, by: "workshop", origin: "workshop",
    rationale: `The ${key} extraction reworded ${r.criterion}, which ${r.id} settled ("${r.question}" → ${r.answer}). Held for the PM.` }));
}

// ── R4 · amend ──

/** The top-level PRD fields no amendment may target: the runner's record around the spec. */
export function forbiddenTargets() {
  return Object.entries(load("prd").properties).filter(([, p]) => p["x-runner"]).map(([k]) => `/${k}`);
}

const STOP = new Set(("a an the and or but if then else when while with without within into onto from for of on in at by to as is are was were be been being have has had do does did not no nor so such than that this these those there their they them its it we our you your who whom which what where why how can could may might must shall should will would each every all any some more most much many few less least own same other another only just also very too again further once here per via once about above below over under between among through during before after up down out off").split(" "));

/** Words 4+ letters long, lowercased, minus stopwords. Text is every string inside the value. */
function words(value) {
  const out = new Set();
  const walk = (v) => {
    if (typeof v === "string") {
      for (const w of v.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []) if (!STOP.has(w)) out.add(w);
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === "object") {
      Object.values(v).forEach(walk);
    }
  };
  walk(value);
  return out;
}

const mentions = (text, term) => new RegExp(`(?<![\\w-])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "i").test(text);
const textOf = (value) => JSON.stringify(value ?? "");

/**
 * Everything the change touches (R4). Structural: what sits under the target — a
 * requirement's criteria, the stories and screens that reference it, a surface's
 * screens. By vocabulary: every term the changed text uses, and every criterion, story
 * and screen that uses the same term. Recomputed at approval, so a radius that moved
 * since the proposal cannot be approved on the old acknowledgement.
 */
export function radiusOf({ prd, proto, stories, target, from }) {
  const criteria = new Set(), storyIds = new Set(), screens = new Set(), terms = new Set();
  const seg = target.split("/").slice(1);
  const reqs = prd.requirements ?? [];
  const allStories = stories?.stories ?? [];
  const allScreens = proto?.screens ?? [];

  const touchReq = (r, acs = r.acceptance_criteria ?? []) => {
    for (const ac of acs) criteria.add(`${r.id}/${ac.id}`);
    for (const s of allStories) if (s.req_refs.includes(r.id) || s.scenarios.some((sc) => sc.proves.some((p) => p.startsWith(`${r.id}/`)))) storyIds.add(s.id);
    for (const sc of allScreens) if (sc.req_refs.includes(r.id)) screens.add(sc.id);
  };
  if (seg[0] === "requirements" && reqs[seg[1]]) {
    const r = reqs[seg[1]];
    if (seg[2] === "acceptance_criteria" && seg[3] !== undefined && r.acceptance_criteria?.[seg[3]]) {
      const ac = r.acceptance_criteria[seg[3]];
      criteria.add(`${r.id}/${ac.id}`);
      for (const s of allStories) if (s.scenarios.some((sc) => sc.proves.includes(`${r.id}/${ac.id}`))) storyIds.add(s.id);
    } else touchReq(r);
  }
  if (seg[0] === "surfaces" && seg[1] === "shipped" && prd.surfaces?.shipped?.[seg[2]]) {
    const surf = prd.surfaces.shipped[seg[2]];
    for (const sc of allScreens) if (sc.surface_ref === surf.id) screens.add(sc.id);
  }

  const vocab = prd.shape?.vocabulary ?? [];
  const changed = textOf(from);
  for (const v of vocab) if (mentions(changed, v.term)) terms.add(v.term);
  if (seg[0] === "shape" && seg[1] === "vocabulary" && vocab[seg[2]]) terms.add(vocab[seg[2]].term);
  for (const term of terms) {
    for (const r of reqs) {
      const reqSays = mentions(r.statement, term);
      for (const ac of r.acceptance_criteria ?? []) if (reqSays || mentions(ac.statement, term)) criteria.add(`${r.id}/${ac.id}`);
    }
    for (const s of allStories) if (mentions(s.statement, term) || s.scenarios.some((sc) => mentions(sc.gherkin, term) || mentions(sc.name, term))) storyIds.add(s.id);
    for (const sc of allScreens) if (mentions(sc.name, term)) screens.add(sc.id);
  }
  const sorted = (set) => [...set].sort();
  return { criteria: sorted(criteria), stories: sorted(storyIds), screens: sorted(screens), terms: sorted(terms) };
}

/** Words the new text uses that nothing drift-checked in the PRD uses — vocabulary arriving undeclared. */
export function introducedBy(prd, to) {
  const known = words(Object.fromEntries(prd["x-drift-checked"].map((p) => [p, resolve(prd, p)])));
  return [...words(to)].filter((w) => !known.has(w)).sort();
}

/** The audit, finding-shaped, from the amendment's own facts — deterministic, so approval recomputes it rather than trusting the file. */
export function auditOf(amendment) {
  const findings = [];
  if (amendment.introduces.length) {
    findings.push({
      severity: "medium", confidence: "certain", rule: "undeclared-vocabulary", subject: amendment.id,
      summary: fit(`${amendment.id} introduces ${amendment.introduces.length} word(s) the PRD does not use: ${amendment.introduces.join(", ")}.`),
      evidence: `\`${amendment.target}\` → ${textOf(amendment.to).slice(0, 200)}; none of ${amendment.introduces.join(", ")} appear in the PRD's drift-checked content or its vocabulary.`,
      remedy: "Define the term in the shape's vocabulary in the same amendment, or reword to the words the PRD already holds.",
    });
  }
  return { gate: AUDIT_GATE, verdict: deriveVerdict(findings), findings, deferred: [], checked: 1 + amendment.radius.criteria.length + amendment.radius.stories.length + amendment.radius.screens.length, skipped: 0 };
}

const material = (prd, target) => prd["x-drift-checked"].some((p) => target === p || target.startsWith(`${p}/`) || p.startsWith(`${target}/`));

/**
 * Propose an amendment: put it on the record as proposed, its audit filed beside it.
 * Nothing in the PRD's content moves here.
 */
export function propose({ root, target, to, rationale, by, origin = "pm", _now = () => new Date() }) {
  if (!by?.trim()) throw new Refused("no-author", "propose: an amendment is attributed — say who proposes it");
  if (!rationale?.trim()) throw new Refused("no-rationale", "propose: an amendment carries its reason");
  if (typeof target !== "string" || !target.startsWith("/") || target === "/") throw new Refused("no-target", "propose: target is a JSON pointer into the PRD's content");
  if (to === undefined) throw new Refused("no-change", "propose: say what the target will hold");
  const prd = loadPrd(root);
  const { amendment, audit } = mint({ prd, proto: readDoc(root, PROTOTYPE_FILE), stories: readDoc(root, STORIES_FILE), target, to, rationale, by, origin, at: _now().toISOString() });
  saveVerdict(root, audit, join(AUDIT_GATE, amendment.id));
  savePrd(root, prd);
  if (origin === "delivery") recordSignal(funnelPath(root), { signal: "delivery-amendment", id: amendment.id, target: amendment.target, material: amendment.material }, _now);
  return { amendment, audit };
}

/**
 * Mint an amendment on a PRD in hand: resolve the target (or where it will be added),
 * compute the radius and the vocabulary it introduces, audit it, and append it as
 * proposed against the PRD as it stands. The caller has checked the arguments, and saves
 * the PRD and files the audit.
 */
export function mint({ prd, proto, stories, target, to, rationale, by, origin, at }) {
  const top = `/${target.split("/")[1]}`;
  if (forbiddenTargets().includes(top)) throw new Refused("forbidden-target", `propose: ${top} is the runner's record, not the PRD's content — it is written by the doors, never amended`);

  let pointer = target;
  let from = resolve(prd, pointer);
  let adds = false;
  if (from === undefined) {
    const parentPtr = pointer.replace(/\/[^/]*$/, "");
    const parent = resolve(prd, parentPtr);
    const last = pointer.slice(parentPtr.length + 1);
    if (Array.isArray(parent) && (last === "-" || Number(last) === parent.length)) pointer = `${parentPtr}/${parent.length}`;
    else if (!parent || typeof parent !== "object" || Array.isArray(parent)) throw new Refused("target-unresolved", `propose: ${target} does not resolve on the PRD, and nothing there to add it to`);
    adds = true;
  }

  const amendment = {
    id: nextId(prd.amendments ?? [], "AMD"), target: pointer, adds, ...(adds ? {} : { from }), to, rationale: rationale.trim(), by: by.trim(), at, origin,
    material: material(prd, pointer),
    radius: radiusOf({ prd, proto, stories, target: pointer, from: adds ? undefined : from }),
    introduces: introducedBy(prd, to),
    status: "proposed", against_version: prd.meta.version, against_hash: prd.meta.content_hash,
  };
  const audit = { ...auditOf(amendment), judged: [pin({ id: prd.id, path: PRD_FILE, doc: prd })] };
  prd.amendments = [...(prd.amendments ?? []), amendment];
  return { amendment, audit };
}

/**
 * Approve: the PRD must not have moved since the proposal, the target must still hold
 * what was proposed against, and the caller must acknowledge the radius as it is now —
 * every criterion, story and screen, restated. Then the edit lands, the version bumps
 * (minor when material), the hash is re-stamped, and the document must still validate.
 */
export function approve({ root, id, by, radius, _now = () => new Date() }) {
  if (!by?.trim()) throw new Refused("no-author", "approve: say who approves");
  const prd = loadPrd(root);
  const a = (prd.amendments ?? []).find((x) => x.id === id);
  if (!a) throw new Refused("unknown-amendment", `approve: ${id} is not on the record`);
  if (a.status !== "proposed") throw new Refused("not-proposed", `approve: ${id} is already ${a.status}`);
  if (a.against_version !== prd.meta.version || a.against_hash !== prd.meta.content_hash) {
    throw new Refused("prd-moved", `approve: the PRD is ${prd.meta.version} (${prd.meta.content_hash.slice(0, 12)}); ${id} was proposed against ${a.against_version} (${a.against_hash.slice(0, 12)}) — re-propose against what is there now`);
  }
  const current = resolve(prd, a.target);
  if (a.adds && current !== undefined) throw new Refused("target-now-exists", `approve: ${a.target} exists now; ${id} was to add it`);
  if (!a.adds && canonicalize(current) !== canonicalize(a.from)) throw new Refused("from-changed", `approve: ${a.target} no longer holds what ${id} was proposed against`, { now: current, from: a.from });

  const now = radiusOf({ prd, proto: readDoc(root, PROTOTYPE_FILE), stories: readDoc(root, STORIES_FILE), target: a.target, from: a.adds ? undefined : a.from });
  const expected = [...now.criteria, ...now.stories, ...now.screens].sort();
  const given = Array.isArray(radius) ? [...new Set(radius)].sort() : null;
  if (!given || given.join("\n") !== expected.join("\n")) {
    throw new Refused("radius-unacknowledged", `approve: acknowledge the radius as it stands — ${expected.length ? expected.join(", ") : "nothing else is touched"}`, { expected, given: given ?? [] });
  }
  const audit = auditOf({ ...a, radius: now });
  if (audit.verdict === "block") throw new Refused("audit-blocked", `approve: the audit blocks ${id} — ${audit.findings.map((f) => f.rule).join(", ")}`, audit);

  const at = _now().toISOString();
  const ruled = (prd.rulings ?? []).filter((r) => !r.superseded_by).map((r) => [r, criterionAt(prd, r.criterion)?.ac.statement]);
  const parentPtr = a.target.replace(/\/[^/]*$/, "");
  const parent = resolve(prd, parentPtr);
  const last = a.target.slice(parentPtr.length + 1);
  if (Array.isArray(parent)) parent[Number(last)] = structuredClone(a.to); else parent[last] = structuredClone(a.to);
  // A ruling whose criterion this changes stays on the record as history, superseded by it (R3).
  const superseded = ruled.filter(([r, was]) => criterionAt(prd, r.criterion)?.ac.statement !== was).map(([r]) => Object.assign(r, { superseded_by: a.id }).id);
  prd.meta.version = bumpVersion(prd.meta.version, a.material ? "minor" : "patch");
  Object.assign(a, { status: "approved", radius: now, resulting_version: prd.meta.version, decided: { by: by.trim(), at } });
  prd.flags.push({ at, section: parentPtr.split("/")[1] ?? "prd", kind: "note", note: `${a.id} approved by ${by.trim()} → ${prd.meta.version}: ${a.rationale}${expected.length ? ` · radius ${expected.join(", ")}` : ""}${superseded.length ? ` · supersedes ${superseded.join(", ")}` : ""}` });
  savePrd(root, prd);
  return { amendment: a, prd };
}

// ── agree ──

/**
 * The PM agrees to the record as it stands: this PRD and the prototype built from it.
 * Refused without a prototype, or with one built from an older PRD — the PM agrees to
 * what they have seen. Stories are written only under a current agreement; a later
 * change to either record voids it.
 */
export function agree({ root, by, _now = () => new Date() }) {
  if (!by?.trim()) throw new Refused("no-author", "agree: an agreement is attributed — say who agrees");
  const prd = loadPrd(root);
  const proto = readDoc(root, PROTOTYPE_FILE);
  if (!proto) throw new Refused("no-prototype", "agree: there is no prototype — the PM agrees to what they have seen, so build it first");
  if (proto.traces.prd.content_hash !== prd.meta.content_hash) throw new Refused("prototype-stale", `agree: the prototype was built from PRD ${proto.traces.prd.version}, and the PRD is ${prd.meta.version} — rebuild it, then agree to what it shows`);
  const at = _now().toISOString();
  const agreement = { id: nextId(prd.agreements ?? [], "AGR"), by: by.trim(), at, prd_version: prd.meta.version, prd_hash: prd.meta.content_hash, prototype_hash: proto.meta.content_hash };
  prd.agreements = [...(prd.agreements ?? []), agreement];
  prd.flags.push({ at, section: "prd", kind: "note", note: `${agreement.id} by ${agreement.by}: agreed PRD ${prd.meta.version} and the prototype built from it` });
  savePrd(root, prd);
  return { agreement, prd };
}

export function reject({ root, id, by, reason, _now = () => new Date() }) {
  if (!by?.trim()) throw new Refused("no-author", "reject: say who rejects");
  if (!reason?.trim()) throw new Refused("no-reason", "reject: a rejection carries its reason — it is the record the next proposer reads");
  const prd = loadPrd(root);
  const a = (prd.amendments ?? []).find((x) => x.id === id);
  if (!a) throw new Refused("unknown-amendment", `reject: ${id} is not on the record`);
  if (a.status !== "proposed") throw new Refused("not-proposed", `reject: ${id} is already ${a.status}`);
  const at = _now().toISOString();
  Object.assign(a, { status: "rejected", decided: { by: by.trim(), at, note: reason.trim() } });
  prd.flags.push({ at, section: a.target.split("/")[1] ?? "prd", kind: "note", note: `${a.id} rejected by ${by.trim()}: ${reason.trim()}` });
  savePrd(root, prd);
  return { amendment: a, prd };
}
