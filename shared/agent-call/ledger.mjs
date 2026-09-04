// owns: R1 · shared — the record of what every model call cost, by half, stage and
// role. Append-only JSONL; one row per call, written by the call that spent it. What
// the console shows before a trigger ("this refine ≈ $X; you're at $Y of $Z") and what
// the budget check reads are both computed from here — nowhere else keeps a total.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export function rows(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
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
    const t = (out[key] ??= { calls: 0, usd: 0, ms: 0, tokens: { input: 0, output: 0, cache_read: 0, cache_create: 0 } });
    t.calls++;
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
  const like = rows(path).filter((r) => r.ok && r.half === half && r.role === role && (!model || r.model === model));
  if (!like.length) return { usd: null, n: 0, basis: "none" };
  return { usd: like.reduce((n, r) => n + r.usd, 0) / like.length, n: like.length, basis: "history" };
}

/** The strip a door shows before a trigger. `budget` null means uncapped. */
export function quote(path, { half, role, model, budget = null }) {
  const est = estimate(path, { half, role, model });
  const used = spent(path);
  return {
    estimate: est,
    spent: used,
    budget,
    remaining: budget == null ? null : Math.max(0, budget - used),
    over: budget != null && used >= budget,
  };
}
