#!/usr/bin/env node
// owns: R15 · shared — runs every eval in this directory, each in its own process
// against its own temp root, and reports one line per suite. Reports (ratio) run
// too but cannot fail. Exit 1 if any gate failed.

import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const G = "\x1b[32m", R = "\x1b[31m", D = "\x1b[90m", X = "\x1b[0m";

const suites = readdirSync(HERE)
  .filter((f) => f.endsWith(".mjs") && !f.startsWith("_") && f !== "run-all.mjs")
  .sort();

let failed = 0;
const rows = [];
for (const f of suites) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(HERE, f)], { encoding: "utf8" });
  const ms = Date.now() - t0;
  const ok = r.status === 0;
  if (!ok) failed++;
  const tally = (r.stdout.match(/(\d+)\/(\d+) passed/) ?? [])[0] ?? "";
  rows.push({ f, ok, ms, tally, out: r.stdout + r.stderr });
}

console.log(`\n  ${D}forge evals${X}\n`);
for (const x of rows) {
  console.log(`  ${x.ok ? G + "PASS" + X : R + "FAIL" + X}  ${x.f.replace(/\.mjs$/, "").padEnd(18)} ${x.tally.padEnd(14)} ${D}${x.ms} ms${X}`);
}
for (const x of rows.filter((r) => !r.ok)) {
  console.log(`\n  ${R}── ${x.f} ──${X}\n${x.out}`);
}
console.log(`\n  ${failed ? R : G}${rows.length - failed}/${rows.length} suites passed${X}\n`);
process.exit(failed ? 1 : 0);
