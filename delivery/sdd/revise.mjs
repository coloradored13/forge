// owns: R6, R5 · delivery — what a round may revise. A regeneration is not a second
// writing: an item no finding names and no changed input touches comes back character
// for character, so the build reads a moved hash as a change of substance and never as
// the writer's second phrasing. The scope is derived, never declared — the items the
// findings name, by every id the record knows, and the items whose work item changed —
// told to the writer per item, and held: an item outside it that came back different is
// the previous item again, verbatim, and the churn is filed low on the round. The one
// line the set may move on a carried item is a shared interface a revised item names too.

import { canonicalize } from "../../shared/hash.mjs";
import { fit } from "../../shared/judge/index.mjs";

/** The rule the carry files — arithmetic (R10): declared to the judge as checked elsewhere, never blocks. */
export const CARRIED = "item-carried";
const ITEM_KEYS = ["approach", "interfaces", "tests", "controls", "surface", "risks"];

/**
 * The items a revision may touch, and why. A finding names things by id — an item, a
 * test, a criterion, a scenario, a screen, an interface — and each resolves to the items
 * it is on; a subject that resolves to nothing is read again in the summary and evidence,
 * and a finding that names nothing anywhere widens the scope to every item: a revision
 * never narrows on a guess. An intake that moved since the previous binding puts the
 * items whose work item changed in scope; the previous intake not on record widens it too.
 * The carry's own finding names an item restored last round and opens nothing.
 * @param prior        the previous binding
 * @param review       the verdict on it, or null
 * @param intake       the intake record this round binds against
 * @param priorIntake  the intake the previous binding was bound against, or null when it is not on record
 * @returns { all: string | null, items: Map<work_item, string[]> } — `all` is the reason every item is in scope, or null; `items` the reasons per item (every item when `all`)
 */
export function scopeOfRevision({ prior, review, intake, priorIntake }) {
  const work = intake.work_items ?? [];
  const items = new Map();
  const open = (id, why) => { const had = items.get(id) ?? []; if (!had.includes(why)) had.push(why); items.set(id, had); };
  const everything = (why) => { for (const w of work) items.set(w.id, [why]); return { all: why, items }; };
  const known = idsOf(prior, intake);

  for (const f of review?.findings ?? []) {
    if (f.rule === CARRIED) continue;
    const bySubject = resolve(f.subject ?? "", known);
    const named = bySubject.length ? bySubject : resolve(`${f.summary ?? ""} ${f.evidence ?? ""}`, known);
    if (!named.length) return everything(`a finding names nothing the record knows: "${f.subject}" (${f.rule})`);
    for (const { id, on } of named) for (const item of on) open(item, `${id} (${f.rule})`);
  }
  if (prior.traces?.intake?.content_hash !== intake.meta?.content_hash) {
    if (!priorIntake) return everything("the intake changed since the previous binding, and the one it was bound against is not on record");
    const before = new Map((priorIntake.work_items ?? []).map((w) => [w.id, w]));
    for (const w of work) {
      const was = before.get(w.id);
      if (!was) open(w.id, "a new work item");
      else if (canonicalize(withScenarios(was, priorIntake)) !== canonicalize(withScenarios(w, intake))) open(w.id, "its work item changed");
    }
  }
  return { all: null, items };
}

/** A work item with the scenarios it names, so a step that changed changes the item. */
function withScenarios(w, intake) {
  const scenarios = new Map((intake.scenarios ?? []).map((s) => [s.id, s]));
  return { w, scenarios: (w.scenarios ?? []).map((id) => scenarios.get(id) ?? id) };
}

/** Every id the record knows → the items it is on, in the binding's order. */
function idsOf(prior, intake) {
  const on = new Map();
  const add = (id, item) => { if (!id) return; const had = on.get(id) ?? []; if (!had.includes(item)) had.push(item); on.set(id, had); };
  for (const w of intake.work_items ?? []) {
    add(w.id, w.id);
    for (const c of w.criteria ?? []) add(c.id, w.id);
    for (const s of w.scenarios ?? []) add(s, w.id);
    for (const s of w.screens ?? []) add(s.screen_ref, w.id);
  }
  for (const it of prior.items ?? []) {
    for (const t of it.tests ?? []) add(t.id, it.work_item);
    for (const i of it.interfaces ?? []) add(i.name, it.work_item);
    for (const c of it.controls ?? []) add(c.screen_ref, it.work_item);
  }
  return on;
}

/**
 * The ids in a text, as tokens: longest first, each match consumed so an id is never read
 * inside a longer one (`REQ-4` inside `REQ-4/AC-1`, `T-4` inside `T-48`), in the order
 * they appear.
 * @returns [{ id, on: [work_item] }]
 */
function resolve(text, known) {
  const found = [];
  let rest = text;
  for (const id of [...known.keys()].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`(?<![A-Za-z0-9_-])${id.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![A-Za-z0-9_-])`, "g");
    rest = rest.replace(re, (m, at) => { found.push({ id, at, on: known.get(id) }); return " ".repeat(m.length); });
  }
  return found.sort((a, b) => a.at - b.at);
}

/**
 * Hold the new binding to the scope. An item outside it that came back different is the
 * previous item again, verbatim — except an interface line a revised item names too,
 * which the set may have moved: that line is taken as written, and only that. An item
 * outside the scope that came back missing is restored. Each restore is one finding, low
 * and certain, naming the fields that moved. A scope of everything restores nothing.
 * @returns { items, findings }
 */
export function carry(prior, doc, scope, intake) {
  if (scope.all) return { items: doc.items, findings: [] };
  const wrote = new Map((doc.items ?? []).map((it) => [it.work_item, it]));
  const known = new Set((intake.work_items ?? []).map((w) => w.id));
  const revised = (prior.items ?? []).filter((it) => scope.items.has(it.work_item)).concat((doc.items ?? []).filter((it) => scope.items.has(it.work_item)));
  const movable = new Set(revised.flatMap((it) => (it.interfaces ?? []).map((i) => i.name)));
  const findings = [];
  const file = (kept, moved) => findings.push({
    severity: "low", confidence: "certain", rule: CARRIED, subject: kept.work_item,
    summary: fit(`${kept.work_item} came back ${moved ? `changed — ${moved.join(", ")} —` : "missing"} with no finding naming it and its work item unchanged; the previous binding is carried verbatim.`),
    evidence: `\`/items\` ${kept.work_item} · ${moved ? moved.map((k) => `${k} was ${short(kept[k])}`).join(" · ") : "no entry in the writer's binding"} · restored from the previous binding`,
    remedy: "Revise an item only where a finding or a changed input touches it — the build hashes each item, and a change with no cause is a rebuild that says nothing.",
  });
  const items = [];
  for (const was of prior.items ?? []) {
    const it = wrote.get(was.work_item);
    if (scope.items.has(was.work_item)) { if (it) items.push(it); continue; }
    if (!known.has(was.work_item)) { if (it) items.push(it); continue; }
    const kept = { ...was, interfaces: takeLines(was, it, movable) };
    if (!it) { items.push(kept); file(kept, null); continue; }
    if (canonicalize(kept) === canonicalize(it)) { items.push(it); continue; }
    items.push(kept);
    file(kept, ITEM_KEYS.filter((k) => canonicalize(kept[k] ?? null) !== canonicalize(it[k] ?? null)));
  }
  for (const it of doc.items ?? []) if (!(prior.items ?? []).some((was) => was.work_item === it.work_item)) items.push(it);
  return { items, findings };
}

/** The previous item's interface lines, with those a revised item names too taken as the writer wrote them — added, moved, or dropped. */
function takeLines(was, it, movable) {
  const wrote = new Map((it?.interfaces ?? []).map((i) => [i.name, i]));
  const lines = (was.interfaces ?? []).flatMap((i) => (movable.has(i.name) ? (wrote.has(i.name) ? [wrote.get(i.name)] : it ? [] : [i]) : [i]));
  for (const [name, line] of wrote) if (movable.has(name) && !(was.interfaces ?? []).some((i) => i.name === name)) lines.push(line);
  return lines;
}

function short(v) {
  const s = canonicalize(v ?? null);
  return s.length > 120 ? `${s.slice(0, 117)}...` : s;
}
