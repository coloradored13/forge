#!/usr/bin/env node
// owns: R14 · shared — the import rule. A half imports from itself and shared/ only;
// shared/ imports from shared/ only. Static: every import/export-from/require/import()
// specifier in a source file, resolved against the file it sits in.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";

export const HALVES = ["discovery", "delivery", "shared"];
export const SOURCE = /\.(mjs|cjs|js|ts|tsx|jsx)$/;

const SPEC =
  /\b(?:import|export)\s+(?:[^'"`;]*?\s+from\s+)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

export function walk(dir, out = []) {
  let names;
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (SOURCE.test(n)) out.push(p);
  }
  return out;
}

/** Which half a repo-relative path belongs to, or null. */
export function halfOf(rel) {
  const top = rel.split(sep)[0];
  return HALVES.includes(top) ? top : null;
}

/** Halves `from` may import. */
export function allowed(from) {
  return from === "shared" ? ["shared"] : [from, "shared"];
}

/**
 * Every specifier in a file, resolved to a repo-relative path when it is
 * relative or half-rooted ("discovery/x"); bare package names are skipped.
 */
export function specifiers(file, root) {
  const src = readFileSync(file, "utf8");
  const out = [];
  for (const m of src.matchAll(SPEC)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (!spec) continue;
    let target;
    if (spec.startsWith(".")) target = relative(root, resolve(dirname(file), spec));
    else if (HALVES.some((h) => spec === h || spec.startsWith(`${h}/`))) target = spec;
    else continue;
    out.push({ spec, target, line: src.slice(0, m.index).split("\n").length });
  }
  return out;
}

/** Violations across the tree: [{file, line, spec, from, to}]. */
export function violations(root) {
  const out = [];
  for (const h of HALVES) {
    for (const file of walk(join(root, h))) {
      const rel = relative(root, file);
      const from = halfOf(rel);
      for (const s of specifiers(file, root)) {
        const to = halfOf(s.target);
        if (to && !allowed(from).includes(to)) out.push({ file: rel, line: s.line, spec: s.spec, from, to });
      }
    }
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const root = resolve(process.argv[2] ?? ".");
  const v = violations(root);
  for (const x of v) console.log(`${x.file}:${x.line}  ${x.from} → ${x.to}  (${x.spec})`);
  console.log(v.length ? `${v.length} import-rule violation(s)` : "import rule holds");
  process.exit(v.length ? 1 : 0);
}
