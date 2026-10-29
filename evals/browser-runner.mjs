// owns: R15 · shared — runner contracts use fake packages/processes, never a browser.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { suite, withRoot, ROOT } from "./_harness.mjs";
const { check, done } = suite("browser runner", 34);
const pass = 'export default async () => console.log("1/1 passed");';
const fake = body => `export const chromium = { launch: async () => { ${body} } };`;
const good = fake('return { close: async () => console.log("CLOSED") };');
function run({ module = good, suites = { "one.mjs": pass }, ci, extra = {} } = {}) {
  return withRoot({}, tmp => {
    const dir = join(tmp, "browser"); mkdirSync(dir);
    for (const f of ["run-all.mjs", "_suite.mjs"]) copyFileSync(join(ROOT, "evals/browser", f), join(dir, f));
    if (module !== null) {
      const pkg = join(tmp, "node_modules/playwright"); mkdirSync(pkg, { recursive: true });
      writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "playwright", type: "module", exports: "./index.mjs" }));
      writeFileSync(join(pkg, "index.mjs"), module);
    }
    for (const [f, body] of Object.entries({ ...suites, ...extra })) writeFileSync(join(dir, f), body);
    const env = { PATH: process.env.PATH, HOME: tmp, GIT_CONFIG_NOSYSTEM: "1" };
    if (ci !== undefined) env.CI = ci; // never inherit CI into a local-mode case
    const r = spawnSync(process.execPath, [join(dir, "run-all.mjs")], { env, encoding: "utf8", timeout: 15_000 });
    return { status: r.status, out: r.stdout + r.stderr };
  });
}
const result = (label, args, status, summary, detail) => {
  const r = run(args);
  check(label, r.status === status && r.out.includes(summary) && (!detail || r.out.includes(detail)), r.out);
};
for (const ci of [undefined, "true"]) {
  result(`missing module ${ci ? "CI" : "local"}`, { module: null, ci }, ci ? 1 : 0, "0/1 suites passed; 1 skipped; 0 failed", "playwright module");
  result(`missing executable ${ci ? "CI" : "local"}`, { module: fake('throw new Error("browserType.launch: Executable doesn\'t exist at /missing/headless-shell");'), ci }, ci ? 1 : 0, "0/1 suites passed; 1 skipped; 0 failed", "headless-shell");
}
result("CI present but empty still rejects skips", { module: null, ci: "" }, 1, "1 skipped");
result("passing launch does not consult full-browser executablePath", {}, 0, "1/1 suites passed; 0 skipped; 0 failed");
result("installed browser launch failure", { module: fake('throw new Error("sandbox denied");') }, 1, "0/1 suites passed; 0 skipped; 1 failed", "sandbox denied");
result("transitive missing dependency fails", { module: 'import "missing-transitive-dependency";' }, 1, "0 skipped; 1 failed", "missing-transitive-dependency");
result("arbitrary import error fails", { module: 'throw new Error("broken import");' }, 1, "0 skipped; 1 failed", "broken import");
result("suite failure closes browser", { suites: { "one.mjs": 'export default async () => { throw new Error("bad assertion"); };' } }, 1, "0 skipped; 1 failed", "CLOSED");
result("premature exit zero fails", { suites: { "one.mjs": "process.exit(0);" } }, 1, "0 skipped; 1 failed");
result("child crash fails", { suites: { "one.mjs": 'process.kill(process.pid, "SIGKILL");' } }, 1, "0 skipped; 1 failed");
result("mixed pass and fail", { suites: { "a.mjs": pass, "b.mjs": 'export default () => { throw new Error("fail"); };' } }, 1, "1/2 suites passed; 0 skipped; 1 failed");
// Both children use the same fake package: only b's launch simulates an absent executable.
const mixed = fake('if (process.argv[2].endsWith("b.mjs")) throw new Error("Executable doesn\'t exist at /shell"); return { close: async () => {} };');
for (const ci of [undefined, "true"]) result(`mixed pass and skip ${ci ? "CI" : "local"}`, { module: mixed, suites: { "a.mjs": pass, "b.mjs": pass }, ci }, ci ? 1 : 0, "1/2 suites passed; 1 skipped; 0 failed");
result("browser cleanup failure fails", { module: fake('return { close: async () => { throw new Error("close failed"); } };') }, 1, "0 skipped; 1 failed", "close failed");
result("helper and non-module files excluded", { extra: { "_helper.mjs": 'throw Error("helper ran")', "notes.txt": "not code" } }, 0, "1/1 suites passed");
result("empty discovery fails", { suites: {} }, 1, "0/0 suites passed");
// Execute the real root runner in a sandbox with a poison browser child.
await withRoot({}, async tmp => {
  copyFileSync(join(ROOT, "evals/run-all.mjs"), join(tmp, "run-all.mjs"));
  mkdirSync(join(tmp, "browser"));
  writeFileSync(join(tmp, "browser/poison.mjs"), 'throw Error("browser discovered");');
  writeFileSync(join(tmp, "ordinary.mjs"), 'console.log("1/1 passed");');
  const r = spawnSync(process.execPath, [join(tmp, "run-all.mjs")], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: tmp } });
  check("root discovery remains browser-free", r.status === 0 && /1\/1 suites passed/.test(r.stdout), r.stdout + r.stderr);
});
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json")));
check("package script invokes nested runner", pkg.scripts["evals:browser"] === "node evals/browser/run-all.mjs");
check("Playwright is exactly pinned in manifest and lock", /^\d+\.\d+\.\d+$/.test(pkg.devDependencies?.playwright) && JSON.parse(readFileSync(join(ROOT, "package-lock.json"))).packages["node_modules/playwright"]?.version === pkg.devDependencies.playwright);
function browserJob(yaml) {
  const job = yaml.match(/^  browser:\s*\n((?:^(?: {4}.*|\s*)\n?)*)/m)?.[1] ?? "";
  const commands = [...job.matchAll(/^\s+- run:\s*(.+)$/gm)].map(m => m[1].trim());
  const install = commands.indexOf("npm ci"), shell = commands.indexOf("npx playwright install --with-deps --only-shell chromium"), runIndex = commands.indexOf("npm run evals:browser");
  return install >= 0 && shell > install && runIndex > shell && !/continue-on-error:\s*true/.test(job) && !/^\s*(?:-\s*)?if\s*:/m.test(job);
}
const commands = ["npm ci", "npx playwright install --with-deps --only-shell chromium", "npm run evals:browser"];
const workflow = (cmds, name = "browser") => `jobs:\n  ${name}:\n    runs-on: ubuntu-latest\n    steps:\n${cmds.map(c => `      - run: ${c}\n`).join("")}`;
check("wiring control accepts ordered browser steps", browserJob(workflow(commands)));
check("wiring control rejects commands in another job", !browserJob(workflow([], "browser") + workflow(commands, "evals").replace("jobs:\n", "")));
check("wiring control rejects reversed steps", !browserJob(workflow([...commands].reverse())));
check("wiring control rejects commented commands", !browserJob(workflow(commands).replaceAll("- run:", "# - run:")));
check("wiring control rejects ignored failures", !browserJob(workflow(commands) + "    continue-on-error: true\n"));
check("wiring control rejects missing npm ci", !browserJob(workflow(commands.slice(1))));
check("wiring control rejects disabled job", !browserJob(workflow(commands) + "    if: false\n"));
check("wiring control rejects disabled step", !browserJob(workflow(commands) + "        if: ${{ false }}\n"));
check("wiring control rejects push-only browser job", !browserJob(workflow(commands) + "    if: github.event_name == 'push'\n"));
check("wiring control rejects conditional step before run", !browserJob(workflow(commands).replace("    steps:", "    steps:\n      - if: github.event_name == 'push'\n        uses: actions/checkout@v4")));
check("wiring control rejects conditional step after run", !browserJob(workflow(commands) + "        if: ${{ github.event_name == 'push' }}\n"));
check("wiring control permits conditions outside browser job and comments", browserJob(workflow(commands) + "    # if: documentation only\n  other:\n    if: github.event_name == 'push'\n    steps:\n      - run: echo other\n"));
const yaml = readFileSync(join(ROOT, ".github/workflows/verify.yml"), "utf8");
check("browser job installs dependencies, shell, then runs suites", browserJob(yaml), "browser job absent or incorrectly ordered");
done();
