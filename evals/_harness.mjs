// owns: R15 · shared — the eval harness. Every suite seeds its own state in a temp
// root and asserts both directions: the gate says no on a seeded defect, yes on a
// seeded good case, and then holds on the real tree.

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const G = "\x1b[32m", R = "\x1b[31m", D = "\x1b[90m", X = "\x1b[0m";

/**
 * A suite, and the number of checks it must run. `expected` is the denominator: without
 * one a count says what ran, never what exists, and the two part silently. `done()` calls
 * `process.exit`, so an async section still pending is discarded with no throw and no
 * warning — one dropped `await` turned a 70-check suite into a green `50/50`. A suite
 * that reaches `done()` having run any other number fails, whatever its checks said.
 */
export function suite(name, expected) {
  if (!Number.isInteger(expected) || expected < 1) throw new Error(`suite(${name}): an expected check count is required — a count with no denominator reports what ran, not what exists`);
  let pass = 0, fail = 0;
  console.log(`\n  ${D}${name}${X}\n`);
  const check = (label, ok, detail = "") => {
    console.log(`  ${ok ? G + "PASS" + X : R + "FAIL" + X}  ${label}`);
    if (!ok && detail) console.log(`        ${D}${String(detail).slice(0, 240)}${X}`);
    ok ? pass++ : fail++;
  };
  const done = () => {
    const ran = pass + fail;
    if (ran !== expected) {
      console.log(`  ${R}FAIL${X}  the suite ran ${ran} checks, not the ${expected} it declares`);
      console.log(`        ${D}${ran < expected ? `${expected - ran} never ran — a dropped await is discarded by process.exit, a throw stops the file` : `${ran - expected} more than declared — update the count deliberately`}${X}`);
      fail++;
    }
    // Against what the suite declares, never against what it happened to run — a tally
    // whose denominator is its own numerator is the defect this guard exists to catch.
    console.log(`\n  ${fail ? R : G}${pass}/${expected} passed${X}\n`);
    process.exit(fail ? 1 : 0);
  };
  return { check, done };
}

/**
 * A scripted SDK: yields what `query()` would — a text block, optional tool uses, a
 * result with cost, usage and structured output — and records every invocation so a
 * suite can read what reached the wire. `text` and `usd` may be arrays, and
 * `structuredSeq` a list, to script successive calls. `toolUses` are tool names, or
 * `{ name, input }` when the suite needs to script what the tool was pointed at. No
 * model is ever called through this (R15).
 */
export function scripted({ text = "ok", structured, structuredSeq, usd = 0.05, tokens = { in: 1000, out: 200 }, throwWith, resultError, toolUses = [], sessionId = "sess-1" } = {}) {
  const calls = [];
  const throws = throwWith == null ? [] : Array.isArray(throwWith) ? [...throwWith] : [throwWith];
  const nth = (v, i) => (Array.isArray(v) ? v[Math.min(i, v.length - 1)] : v);
  const query = ({ prompt, options }) => {
    const i = calls.length;
    calls.push({ prompt, options });
    if (throws.length) { const e = throws.shift(); if (e) throw new Error(e); }
    const out = structuredSeq ? structuredSeq[Math.min(i, structuredSeq.length - 1)] : structured;
    return (async function* () {
      yield { type: "system", subtype: "init", session_id: sessionId };
      const uses = toolUses.map((t) => (typeof t === "string" ? { type: "tool_use", name: t, input: { file_path: "x" } } : { type: "tool_use", name: t.name, input: t.input ?? {} }));
      yield { type: "assistant", session_id: sessionId, message: { content: [...uses, { type: "text", text: nth(text, i) }] } };
      yield {
        type: "result", session_id: sessionId, subtype: resultError ? "error_during_execution" : "success", is_error: !!resultError, errors: resultError ? [resultError] : [],
        total_cost_usd: nth(usd, i), num_turns: 3, structured_output: out,
        modelUsage: { [options.model]: { inputTokens: tokens.in, outputTokens: tokens.out, cacheReadInputTokens: 7, cacheCreationInputTokens: 3, costUSD: nth(usd, i) } },
      };
    })();
  };
  return { query, calls };
}

/**
 * Run fn with a fresh temp root seeded from {relpath: content}; always cleaned. fn may
 * be async — the root lives until its promise settles.
 */
export function withRoot(files, fn) {
  const root = mkdtempSync(join(tmpdir(), "forge-eval-"));
  const clean = () => rmSync(root, { recursive: true, force: true });
  let out;
  try {
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(join(root, dirname(rel)), { recursive: true });
      writeFileSync(join(root, rel), content);
    }
    out = fn(root);
  } catch (e) {
    clean();
    throw e;
  }
  if (out && typeof out.then === "function") return out.finally(clean);
  clean();
  return out;
}
