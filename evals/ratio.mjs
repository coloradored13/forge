#!/usr/bin/env node
// owns: R10 · shared — report: scaffolding-to-prompt ratio (SPEC §8). A trend, not
// a gate — it never fails. Scaffolding is every source line under the halves,
// tools/, and evals/; prompt is every line of an authored identity half
// (`**/prompts/*.md`). v1 ended at 33 : 1.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { walk, HALVES } from "../tools/import-rule.mjs";
import { ROOT } from "./_harness.mjs";

const lines = (f) => readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).length;

function prompts(dir, out = []) {
  let names;
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) prompts(p, out);
    else if (/\.md$/.test(n) && /(^|\/)prompts\//.test(relative(ROOT, p))) out.push(p);
  }
  return out;
}

const code = [...HALVES, "tools", "evals"].flatMap((d) => walk(join(ROOT, d)));
const prose = HALVES.flatMap((d) => prompts(join(ROOT, d)));
const c = code.reduce((n, f) => n + lines(f), 0);
const p = prose.reduce((n, f) => n + lines(f), 0);

const D = "\x1b[90m", X = "\x1b[0m";
console.log(`\n  ${D}ratio · scaffolding to prompt${X}\n`);
console.log(`  scaffolding  ${String(c).padStart(6)} lines in ${code.length} modules`);
console.log(`  prompt       ${String(p).padStart(6)} lines in ${prose.length} identity files`);
console.log(`  ratio        ${p ? (c / p).toFixed(1) + " : 1" : "— (no prompts yet)"}   ${D}v1 ended at 33 : 1${X}\n`);
process.exit(0);
