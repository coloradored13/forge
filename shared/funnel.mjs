// owns: R8 · shared — the funnel meter. One append-only file per project where the
// runners record the signals that say whether the funnel is narrowing: a reviewer
// re-raising a settled ruling, an amendment arriving from Delivery. Nothing here decides
// anything; it is read back so calibration is not write-only. Rows are plain JSON lines a
// person can grep.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const FUNNEL = join("forge", "discovery", "funnel.jsonl");

/** The signals a runner may record, and the rule each one measures. */
export const SIGNALS = { reraised: "R3", "delivery-amendment": "R8" };

export function funnelPath(root) { return join(root, FUNNEL); }

/** Append one row. `signal` must be a known one — an unnamed signal is noise in the meter. */
export function record(path, row, _now = () => new Date()) {
  if (!SIGNALS[row?.signal]) throw new Error(`funnel: unknown signal ${row?.signal} — one of ${Object.keys(SIGNALS).join(", ")}`);
  const out = { at: _now().toISOString(), ...row };
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(out) + "\n");
  return out;
}

export function rows(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

/** Counts by signal and by gate — what the console shows beside a verdict. */
export function meter(list) {
  const by_signal = {}, by_gate = {};
  for (const r of list) {
    by_signal[r.signal] = (by_signal[r.signal] ?? 0) + (r.count ?? 1);
    if (r.gate) by_gate[r.gate] = (by_gate[r.gate] ?? 0) + (r.count ?? 1);
  }
  return { total: list.length, by_signal, by_gate };
}
