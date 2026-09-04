#!/usr/bin/env node
// owns: R10 · shared — eval: every module owns its place. The header check says no
// on a seeded module with no header, a rule the registry does not know, or a half
// that disagrees with the path; yes on a good one; and holds on the real tree.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { suite, withRoot, ROOT } from "./_harness.mjs";
import { problems, registry } from "../tools/owns.mjs";

const { check, done } = suite("owns · module headers");

const RULES = readFileSync(join(ROOT, "shared", "rules.json"), "utf8");

withRoot({
  "shared/rules.json": RULES,
  "shared/bare.mjs": "export const x = 1;",
  "shared/unknown.mjs": "// owns: R99 · shared\nexport const x = 1;",
  "delivery/wrong-half.mjs": "// owns: R9 · discovery\nexport const x = 1;",
  "tools/late.mjs": "//\n//\n//\n//\n//\n// owns: R10 · shared\n",
  "discovery/good.mjs": "// owns: R3, R4 · discovery\nexport const x = 1;",
  "evals/good.mjs": "#!/usr/bin/env node\n// owns: R15 · shared — eval\n",
  "tools/good.ts": "/** owns: R14 · shared */\nexport const x = 1;",
}, (root) => {
  const p = problems(root);
  const by = (f) => p.filter((x) => x.file === f).map((x) => x.problem).join(" | ");
  check("a module with no header is refused", by("shared/bare.mjs").includes("no owns: header"));
  check("a rule id the registry does not know is refused", by("shared/unknown.mjs").includes("R99"));
  check("a half that disagrees with the path is refused", by("delivery/wrong-half.mjs").includes("lives in delivery/"));
  check("a header past the first five lines does not count", by("tools/late.mjs").includes("no owns: header"));
  check("a good header passes — multi-rule, shebang, block comment, .ts", !p.some((x) => x.file.endsWith("good.mjs") || x.file.endsWith("good.ts")), JSON.stringify(p));
  check("exactly the four seeded defects are reported", p.length === 4, `${p.length}: ${p.map((x) => x.file).join(", ")}`);
});

// ── registry shape ──
{
  const reg = registry(ROOT);
  const ids = reg.rules.map((r) => r.id);
  check("the registry lists R1..R15 exactly once each",
    ids.length === 15 && new Set(ids).size === 15 && ids.every((id, i) => id === `R${i + 1}`), ids.join(","));
  check("every rule names one enforcer", reg.rules.every((r) => typeof r.enforcer === "string" && r.enforcer.length > 0));
  check("every rule names its half", reg.rules.every((r) => ["discovery", "delivery", "both"].includes(r.half)));
  // R10: one enforcer per rule, so the eval column may repeat but the enforcer may not.
  const enforcers = reg.rules.map((r) => r.enforcer);
  check("no two rules share an enforcer", new Set(enforcers).size === enforcers.length,
    enforcers.filter((e, i) => enforcers.indexOf(e) !== i).join("; "));
}

// ── the real tree ──
{
  const p = problems(ROOT);
  check("every module in the repo owns its place", p.length === 0, p.map((x) => `${x.file}: ${x.problem}`).join("; "));
}

done();
