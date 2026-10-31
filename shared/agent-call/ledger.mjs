// owns: R1 · shared — the record of what every model call cost, by half, stage and
// role. Append-only JSONL, written by the call that spent it: a started row before the
// model runs, an outcome row after, joined by a call id — so a process killed mid-call
// leaves a call whose outcome is unknown, not nothing. Readers see one row per call.
// What the console shows before a trigger ("this refine ≈ $X; you're at $Y of $Z") and
// what the budget check reads are both computed from here — nowhere else keeps a total.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * One row per call, in the order calls began: the outcome row replaces its started row
 * where that row stood. A started row with no outcome is a call that never closed. Rows
 * without a call id — ledgers written before there was one — are read as they are.
 */
export function rows(path) {
  if (!existsSync(path)) return [];
  const out = [], at = new Map();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.call && at.has(row.call)) out[at.get(row.call)] = row;
    else { if (row.call) at.set(row.call, out.length); out.push(row); }
  }
  return out;
}

/** A call whose cost is not known: still open, or closed without the SDK reporting one. */
const unknown = (r) => r.ok === null || r.usd_unknown === true;

/** Calls, spend, the count still open and the count of unknown cost, over any set of rows — the one arithmetic every cost strip shows. */
export function tally(list) {
  return { calls: list.length, usd: list.reduce((n, r) => n + (r.usd ?? 0), 0), unfinished: list.filter((r) => r.ok === null).length, unknown: list.filter(unknown).length };
}

export function append(path, row) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(row) + "\n");
  return row;
}

/** Total spent, failed calls included — a call that errored still billed. */
export function spent(path) {
  return rows(path).reduce((n, r) => n + (r.usd ?? 0), 0);
}

/** Totals grouped by any row keys, e.g. `["half", "stage"]` or `["role", "model"]`. */
export function totals(path, by = ["half", "stage", "role"]) {
  const out = {};
  for (const r of rows(path)) {
    const key = by.map((k) => r[k] ?? "?").join(" · ");
    const t = (out[key] ??= { calls: 0, unfinished: 0, unknown: 0, usd: 0, ms: 0, tokens: { input: 0, output: 0, cache_read: 0, cache_create: 0 } });
    t.calls++;
    if (r.ok === null) t.unfinished++;
    if (unknown(r)) t.unknown++;
    t.usd += r.usd ?? 0;
    t.ms += r.ms ?? 0;
    for (const k of Object.keys(t.tokens)) t.tokens[k] += r.tokens?.[k] ?? 0;
  }
  return out;
}

/**
 * What the next call of this kind will probably cost: the mean of prior calls with the
 * same half, role and model. No history is reported as no history — a number invented
 * from a rate card would be shown with the same confidence as a measured one.
 */
export function estimate(path, { half, role, model }) {
  const like = rows(path).filter((r) => r.ok && !unknown(r) && r.half === half && r.role === role && (!model || r.model === model));
  if (!like.length) return { usd: null, n: 0, basis: "none" };
  return { usd: like.reduce((n, r) => n + r.usd, 0) / like.length, n: like.length, basis: "history" };
}

/** Where the spend stands against the cap. `budget` null means uncapped. */
export function standing(path, budget = null) {
  const used = spent(path);
  return { spent: used, unknown: rows(path).filter(unknown).length, budget, remaining: budget == null ? null : Math.max(0, budget - used), over: budget != null && used >= budget };
}

/** The strip a door shows before a trigger: what one more call is likely to cost, and where the spend stands. */
export function quote(path, { half, role, model, budget = null }) {
  return { estimate: estimate(path, { half, role, model }), ...standing(path, budget) };
}
