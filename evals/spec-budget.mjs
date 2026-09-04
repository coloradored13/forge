#!/usr/bin/env node
// owns: R10 · shared — eval: SPEC.md stays under its word budget (SPEC §8: 3,500,
// raised once, not again). The count strips code spans, tables' pipes, and markdown
// punctuation, so it is the count a reader would make.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { suite, withRoot, ROOT } from "./_harness.mjs";

const { check, done } = suite("spec-budget · SPEC.md ≤ 3,500 words");

export const BUDGET = 3500;

export function words(md) {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, (m) => m.slice(1, -1))
    .replace(/[|#>*_]/g, " ")
    .split(/\s+/)
    .filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

export function overBudget(root) {
  const n = words(readFileSync(join(root, "SPEC.md"), "utf8"));
  return { n, over: n > BUDGET };
}

withRoot({ "SPEC.md": Array.from({ length: BUDGET + 1 }, (_, i) => `w${i}`).join(" ") }, (root) => {
  const r = overBudget(root);
  check("a spec one word over the budget is refused", r.over, `${r.n}`);
});
withRoot({ "SPEC.md": "# t\n\n| a | b |\n|---|---|\n| `x` | y |\n\n" + Array.from({ length: BUDGET - 10 }, (_, i) => `w${i}`).join(" ") }, (root) => {
  const r = overBudget(root);
  // t, a, b, x, y — five words the markdown carries; the pipes and rule row are none.
  check("a spec under the budget passes; pipes and code spans are not words", !r.over && r.n === BUDGET - 10 + 5, `${r.n}`);
});
withRoot({ "SPEC.md": "one two three" }, (root) => {
  // A budget that is not a gate is a trend; this one is a gate.
  const before = overBudget(root).n;
  writeFileSync(join(root, "SPEC.md"), "one two three " + Array.from({ length: BUDGET }, () => "more").join(" "));
  check("growing past the budget flips the verdict", before === 3 && overBudget(root).over);
});

{
  const r = overBudget(ROOT);
  check(`SPEC.md is within budget (${r.n} / ${BUDGET})`, !r.over, `${r.n}`);
}

done();
