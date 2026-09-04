// owns: R15 · shared — the eval harness. Every suite seeds its own state in a temp
// root and asserts both directions: the gate says no on a seeded defect, yes on a
// seeded good case, and then holds on the real tree.

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const G = "\x1b[32m", R = "\x1b[31m", D = "\x1b[90m", X = "\x1b[0m";

export function suite(name) {
  let pass = 0, fail = 0;
  console.log(`\n  ${D}${name}${X}\n`);
  const check = (label, ok, detail = "") => {
    console.log(`  ${ok ? G + "PASS" + X : R + "FAIL" + X}  ${label}`);
    if (!ok && detail) console.log(`        ${D}${String(detail).slice(0, 240)}${X}`);
    ok ? pass++ : fail++;
  };
  const done = () => {
    console.log(`\n  ${fail ? R : G}${pass}/${pass + fail} passed${X}\n`);
    process.exit(fail ? 1 : 0);
  };
  return { check, done };
}

/** Run fn with a fresh temp root seeded from {relpath: content}; always cleaned. */
export function withRoot(files, fn) {
  const root = mkdtempSync(join(tmpdir(), "forge-eval-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(join(root, dirname(rel)), { recursive: true });
      writeFileSync(join(root, rel), content);
    }
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
