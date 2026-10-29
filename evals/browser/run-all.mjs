// owns: R15 · shared — browser evals run in separate processes; skips are never passes.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const suites = readdirSync(here).filter(f => f.endsWith(".mjs") && !f.startsWith("_") && f !== "run-all.mjs").sort();
const rows = suites.map(f => {
  const start = Date.now();
  const r = spawnSync(process.execPath, [join(here, "_suite.mjs"), join(here, f)], { encoding: "utf8", timeout: 120_000, killSignal: "SIGKILL" });
  const out = (r.stdout ?? "") + (r.stderr ?? "") + (r.error ? String(r.error) : "");
  const state = r.status === 0 && /^BROWSER_SUITE_COMPLETE$/m.test(out) ? "PASS" : r.status === 77 && /^SKIPPED: /m.test(out) ? "SKIPPED" : "FAIL";
  return { f, state, out, ms: Date.now() - start };
});
console.log("\n  forge browser evals\n");
for (const r of rows) {
  const note = r.state === "SKIPPED" ? r.out.trim() : (r.out.match(/\d+\/\d+ passed/) ?? [""])[0];
  console.log(`  ${r.state}  ${r.f.replace(/\.mjs$/, "").padEnd(18)} ${note} ${r.ms} ms`);
  if (r.state === "FAIL") console.log(r.out);
}
const count = state => rows.filter(r => r.state === state).length;
console.log(`\n  ${count("PASS")}/${rows.length} suites passed; ${count("SKIPPED")} skipped; ${count("FAIL")} failed\n`);
process.exitCode = !rows.length || count("FAIL") || (process.env.CI !== undefined && count("SKIPPED")) ? 1 : 0;
