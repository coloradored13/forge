#!/usr/bin/env node
// owns: R14 · shared — eval: the import rule. At M0 this is the static half of the
// seam; the cold-intake half (a handoff read in a temp root with discovery/ absent)
// joins at M2 and lives in this file.

import { suite, withRoot, ROOT } from "./_harness.mjs";
import { violations } from "../tools/import-rule.mjs";

const { check, done } = suite("seam · import rule");

const RULES = `{"rules":[],"halves":["discovery","delivery","shared"]}`;

// ── the rule says no ──
withRoot({
  "shared/rules.json": RULES,
  "shared/hash.mjs": "export const h = 1;",
  "discovery/prd.mjs": "export const prd = 1;",
  "delivery/intake/static.mjs": `import { prd } from "../../discovery/prd.mjs";`,
  "delivery/intake/dynamic.mjs": `const m = await import("../../discovery/prd.mjs");`,
  "delivery/intake/rooted.mjs": `import { prd } from "discovery/prd.mjs";`,
  "delivery/intake/reexport.mjs": `export { prd } from "../../discovery/prd.mjs";`,
  "delivery/intake/required.cjs": `const { prd } = require("../../discovery/prd.mjs");`,
  "shared/leak.mjs": `import { x } from "../delivery/intake/static.mjs";`,
  "discovery/peek.mjs": `import { x } from "../delivery/intake/static.mjs";`,
}, (root) => {
  const v = violations(root);
  const files = new Set(v.map((x) => x.file));
  check("a static import from delivery/ into discovery/ is refused", files.has("delivery/intake/static.mjs"));
  check("a dynamic import() is refused", files.has("delivery/intake/dynamic.mjs"));
  check("a half-rooted specifier (\"discovery/…\") is refused", files.has("delivery/intake/rooted.mjs"));
  check("a re-export is refused", files.has("delivery/intake/reexport.mjs"));
  check("a require() is refused", files.has("delivery/intake/required.cjs"));
  check("shared/ importing a half is refused", files.has("shared/leak.mjs"));
  check("discovery/ importing delivery/ is refused", files.has("discovery/peek.mjs"));
  check("each violation names file, line, and both halves",
    v.every((x) => x.file && x.line > 0 && x.from && x.to), JSON.stringify(v[0]));
  check("nothing else is flagged", v.length === 7, `${v.length}: ${[...files].join(", ")}`);
});

// ── the rule says yes ──
withRoot({
  "shared/rules.json": RULES,
  "shared/hash.mjs": "export const h = 1;",
  "shared/judge/derive.mjs": `import { h } from "../hash.mjs";`,
  "delivery/intake/ok.mjs": `import { h } from "../../shared/hash.mjs";\nimport { slice } from "./slice.mjs";\nimport { readFileSync } from "node:fs";\nimport ajv from "ajv";`,
  "delivery/intake/slice.mjs": "export const slice = 1;",
  "discovery/prd.mjs": `import { h } from "../shared/hash.mjs";`,
}, (root) => {
  const v = violations(root);
  check("shared → shared, half → shared, half → itself, packages, node: all pass", v.length === 0, JSON.stringify(v));
});

// ── the real tree ──
{
  const v = violations(ROOT);
  check("the repo holds the import rule", v.length === 0, v.map((x) => `${x.file}:${x.line} ${x.from}→${x.to}`).join("; "));
}

done();
