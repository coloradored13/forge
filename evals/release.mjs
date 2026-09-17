#!/usr/bin/env node
// owns: R2, R11 · delivery — eval: release. The manifest is a projection of records already
// filed, and the only claim it makes on its own behalf is that its checker passes in a
// clone nobody has touched. So this suite ends by doing exactly that: seeding a project,
// running the round, cloning the result, and running the shipped checker there — then
// breaking things one at a time to watch it refuse.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { suite, withRoot, scripted } from "./_harness.mjs";
import { seedBuild, builder, put, BUILT, FORGE_GIT } from "./_fixture.mjs";
import { runStage } from "../delivery/run/index.mjs";
import { round as qaRound } from "../delivery/qa/index.mjs";
import * as H from "../shared/hash.mjs";
import {
  chainOf, checkRelease, shipment, round, buildManifest,
  MANIFEST_FILE, VERIFIER_FILE, VERIFIER_SOURCE, ARITHMETIC,
} from "../delivery/release/index.mjs";
import { readRun, takeHandoff } from "../delivery/state/index.mjs";
import { BRANCH } from "../delivery/build/index.mjs";

const { check, done } = suite("release · the manifest, and a checker that runs without us", 20);

// ── the vendored hash must not drift from the original ──
// The checker carries its own copy of the algorithm so it needs nothing from Forge. That
// duplication is deliberate and it is also the risk: two copies can disagree and nobody
// would know until a manifest failed to verify somewhere it mattered.
const src = readFileSync(VERIFIER_SOURCE, "utf8");
const carried = (() => {
  const a = src.indexOf("const sortDeep"), b = src.indexOf("// ── the checks ──");
  return new Function("createHash", src.slice(a, b) + "\nreturn { sha256, contentHash, atPointer };")(createHash);
})();
const HASH_CASES = [
  { "x-drift-checked": ["/a"], a: 1, b: [3, 2], meta: { content_hash: "ignored" } },
  { "x-drift-checked": ["/z", "/y/x"], z: "café", y: { x: null } },
  { "x-drift-checked": ["/k"], k: [1, { m: "ü" }] },
  { "x-drift-checked": ["/s"], s: "日本語" },
  { "x-drift-checked": ["/a", "/missing"], a: { deep: [1, 2] } },
  { "x-drift-checked": ["/tests"], tests: [] },
];
check("the checker's carried hash agrees with shared/hash.mjs on every case — one copy drifting from the other is a manifest that verifies here and nowhere else",
  HASH_CASES.every((c) => carried.sha256(c) === H.sha256(c) && carried.contentHash(c) === H.contentHash(c)),
  JSON.stringify(HASH_CASES.filter((c) => carried.contentHash(c) !== H.contentHash(c))));

check("and it refuses in the same words on an artifact that declares no pointers — hashing nothing would mint a hash that means nothing",
  (() => {
    const say = (f) => { try { f({ a: 1 }); return "(no refusal)"; } catch (e) { return e.message; } };
    return say(carried.contentHash) === say(H.contentHash);
  })());

check("the checker imports nothing but node builtins — it has to run in a clone with nothing installed and no Forge on the machine",
  [...src.matchAll(/^import .*? from "([^"]+)";/gm)].every((m) => m[1].startsWith("node:")),
  JSON.stringify([...src.matchAll(/^import .*? from "([^"]+)";/gm)].map((m) => m[1])));

check("every arithmetic rule release can file is declared, and none is a judge's", new Set(ARITHMETIC).size === ARITHMETIC.length && ARITHMETIC.includes("verify-failed"));

// ── the chain is built down from the contract, so a dropped promise cannot hide ──
const intake = {
  work_items: [
    { id: "STORY-1", criteria: [{ id: "REQ-1/AC-1", statement: "It is recorded." }, { id: "REQ-1/AC-2", statement: "Nothing is bound to this one." }], screens: [{ screen_ref: "SCREEN-1" }] },
    { id: "REQ-4", criteria: [{ id: "REQ-4/AC-1", statement: "It survives a reload." }], screens: [] },
  ],
};
const sdd = { items: [
  { work_item: "STORY-1", tests: [{ id: "T-1", proves: ["REQ-1/AC-1"] }] },
  { work_item: "REQ-4", tests: [{ id: "T-4", proves: ["REQ-4/AC-1"] }] },
] };
const build = { items: [{ work_item: "STORY-1", commit: "a".repeat(40) }, { work_item: "REQ-4", commit: "b".repeat(40) }] };

let chain = chainOf({ intake, sdd, build, qa: { tests: [{ id: "T-1", suite: "unit", title: "T-1 records it", passed: true }, { id: "T-4", suite: "unit", title: "T-4 reloads", passed: false }] } });
check("one row per criterion the contract carries, in id order, each tied to its item and the commit that built it",
  chain.map((r) => r.criterion).join() === "REQ-1/AC-1,REQ-1/AC-2,REQ-4/AC-1" && chain[0].commits[0] === "a".repeat(40) && chain[0].screens.join() === "SCREEN-1",
  JSON.stringify(chain.map((r) => `${r.criterion}@${r.work_item}`)));

check("a criterion nothing was ever bound to still gets a row, saying so — the manifest exists to make a quietly dropped promise impossible to miss",
  chain[1].tests.length === 0 && chain[1].discharged === false, JSON.stringify(chain[1]));

check("discharged is read off the executed record and nothing else: a test that ran and passed discharges, one that failed does not",
  chain[0].discharged === true && chain[2].discharged === false && chain[2].tests[0].ran === true,
  JSON.stringify(chain.map((r) => `${r.criterion}:${r.discharged}`)));

chain = chainOf({ intake, sdd, build, qa: { tests: [] } });
check("a test the binding named that never ran has not passed — an unmeasured criterion is never a discharged one",
  chain.every((r) => !r.discharged) && chain[0].tests[0].ran === false && chain[0].tests[0].passed === false,
  JSON.stringify(chain[0].tests));

// ── the verdict ──
// Every criterion bound and passing — the unbound one above is left out on purpose here.
const bound = { work_items: [{ id: "STORY-1", criteria: [{ id: "REQ-1/AC-1", statement: "It is recorded." }], screens: [] }] };
let f = checkRelease({ chain: chainOf({ intake: bound, sdd, build, qa: { tests: [{ id: "T-1", passed: true }] } }) }, { ok: true, out: "" });
check("everything discharged and the clone verifies: no finding at all", f.length === 0, JSON.stringify(f));

f = checkRelease({ chain: [] }, { ok: false, out: "boom" });
check("a checker that does not pass in a fresh clone is the finding that matters — until then the manifest is a claim about this machine",
  f.length === 1 && f[0].rule === "verify-failed" && /clone/.test(f[0].evidence) && f[0].severity === "high", JSON.stringify(f));

f = checkRelease({ chain: chainOf({ intake, sdd, build, qa: { tests: [] } }) }, { ok: true, out: "" });
check("each undischarged criterion is named with why — no test bound, or bound and never run, or run and failed",
  f.length === 3 && f.every((x) => x.rule === "criterion-undischarged") &&
  /no test is bound to it/.test(f.find((x) => x.subject === "REQ-1/AC-2").evidence) &&
  /did not run/.test(f.find((x) => x.subject === "REQ-1/AC-1").evidence),
  JSON.stringify(f.map((x) => x.subject)));

// ── end to end: seed, release, clone, and run the shipped checker there ──
await withRoot({}, async (tmp) => {
  const { cold } = await seedBuild(tmp, { files: { "README.md": "# Dock\n" } });
  const b = builder([BUILT(), BUILT("b"), BUILT("c")],
    { 0: (cwd) => put(cwd, "src/exceptions/store.js", "a"), 1: (cwd) => put(cwd, "src/deliveries/store.js", "b"), 2: (cwd) => put(cwd, "src/queue/q.js", "c") });
  await runStage(cold, { stage: "build", _query: b.query });

  // qa, with both seams scripted: every bound test runs and passes, every item comes back clean.
  const out = ["ok 1 - T-1 passes", "ok 2 - T-2 passes", "ok 3 - T-3 passes", "ok 4 - T-4 passes"].join("\n");
  await qaRound(cold, { _exec: async () => ({ ok: true, out }), _query: scripted({ structured: { findings: [], deferred: [], checked: 1, skipped: 0 } }).query });

  const run = readRun(cold);
  const ship = shipment(cold, run);
  check("the release ships what it pins: the records live outside git and the contract lives under discovery/, so a manifest pinning them where they lie is one nobody else can check",
    ship.some((s) => s.what.startsWith("handoff") && s.to === join("forge", "handoff-v1.json")) &&
    ship.every((s) => s.to.startsWith("forge/")) && ship.length >= 5,
    JSON.stringify(ship.map((s) => `${s.from} → ${s.to}`)));

  const r = await round(cold, { argv: ["node", "forge", "advance"] });
  check("the round files a verdict at a path the loop can read, and pins the contract and the manifest",
    typeof r.file === "string" && r.verdict.gate === "release" && r.verdict.judged.length === 2,
    JSON.stringify({ file: r.file, judged: r.verdict.judged.map((p) => p.id) }));

  check("the checker passes in a clone it had never seen — the whole of what this stage claims (SPEC §5: `verify` passes in a fresh clone)",
    r.verified.ok === true && /checks passed/.test(String(r.verified.out)),
    String(r.verified.out).slice(0, 500));

  check("and with every criterion discharged, the verdict is a pass",
    r.verdict.verdict === "pass" && r.verdict.findings.length === 0,
    JSON.stringify(r.verdict.findings.map((x) => `${x.rule}:${x.subject}`)));

  // ── now break it, one thing at a time, in a clone of the released branch ──
  const clone = join(tmp, "tamper");
  execFileSync("git", ["clone", "--quiet", "--branch", BRANCH, "--single-branch", cold, clone], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...FORGE_GIT } });
  const verify = () => {
    try { execFileSync("node", [VERIFIER_FILE], { cwd: clone, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); return { ok: true, out: "" }; }
    catch (e) { return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }; }
  };
  check("the shipped checker passes in that clone too, before anything is touched", verify().ok === true);

  const pinned = join(clone, "forge", "delivery", "sdd.json");
  const was = readFileSync(pinned, "utf8");
  writeFileSync(pinned, was.replace(/}\s*$/, ', "tampered": true }'));
  let v = verify();
  check("editing a pinned record is caught — a pin that no longer matches means the manifest describes something that is no longer here",
    v.ok === false && /pinned: the binding/.test(v.out), v.out.slice(0, 300));
  writeFileSync(pinned, was);
  check("and putting it back restores the pass — the check is the bytes, not a flag somebody set", verify().ok === true);

  const checker = join(clone, VERIFIER_FILE);
  const orig = readFileSync(checker, "utf8");
  writeFileSync(checker, orig.replace("// ── the checks ──", "// ── the checks ── (edited)"));
  v = verify();
  check("editing the checker itself is caught by its own hash — a checker somebody rewrote must not pass as the one that shipped",
    v.ok === false && /the verifier's bytes/.test(v.out), v.out.slice(0, 300));
  writeFileSync(checker, orig);

  const mf = join(clone, MANIFEST_FILE);
  const m = JSON.parse(readFileSync(mf, "utf8"));
  m.chain[0].discharged = !m.chain[0].discharged;
  writeFileSync(mf, JSON.stringify(m, null, 2) + "\n");
  v = verify();
  check("a manifest edited to claim a criterion was discharged fails its own stamp — the one thing it exists to report cannot be quietly rewritten",
    v.ok === false && /hashes to its own stamp/.test(v.out), v.out.slice(0, 300));
});

done();
