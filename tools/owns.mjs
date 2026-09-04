#!/usr/bin/env node
// owns: R10 · shared — the `owns:` header. Every module under a half, tools/, or
// evals/ opens with one line naming the rule(s) it holds and its half; the ids
// must exist in shared/rules.json. A module without one fails CI (SPEC §8).

import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { walk, HALVES } from "./import-rule.mjs";

export const SCANNED = [...HALVES, "tools", "evals"];
const HEADER = /^\s*(?:\/\/|#|\/\*\*?|\*)\s*owns:\s*(R\d+(?:\s*,\s*R\d+)*)\s*·\s*(discovery|delivery|shared)\b/;
const HEAD_LINES = 5;

export function registry(root) {
  return JSON.parse(readFileSync(join(root, "shared", "rules.json"), "utf8"));
}

/** Parse the header of one file: {rules, half} or null. */
export function header(file) {
  const head = readFileSync(file, "utf8").split("\n").slice(0, HEAD_LINES);
  for (const line of head) {
    const m = HEADER.exec(line);
    if (m) return { rules: m[1].split(/\s*,\s*/), half: m[2] };
  }
  return null;
}

/** Problems across the tree: [{file, problem}]. */
export function problems(root) {
  const ids = new Set(registry(root).rules.map((r) => r.id));
  const out = [];
  for (const dir of SCANNED) {
    for (const file of walk(join(root, dir))) {
      const rel = relative(root, file);
      const h = header(file);
      if (!h) { out.push({ file: rel, problem: "no owns: header in the first 5 lines" }); continue; }
      for (const id of h.rules) if (!ids.has(id)) out.push({ file: rel, problem: `${id} is not in shared/rules.json` });
      const top = rel.split("/")[0];
      if (HALVES.includes(top) && h.half !== top) out.push({ file: rel, problem: `header says ${h.half}, file lives in ${top}/` });
    }
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const root = resolve(process.argv[2] ?? ".");
  const p = problems(root);
  for (const x of p) console.log(`${x.file}  ${x.problem}`);
  console.log(p.length ? `${p.length} owns: problem(s)` : "every module owns its place");
  process.exit(p.length ? 1 : 0);
}
