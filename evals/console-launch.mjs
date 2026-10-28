#!/usr/bin/env node
// owns: R10, R14, R15 · shared — launch without setup writes, from npm or directly.
// PR83 / 6458749389: containment follows existing symlink ancestors, even for absent children.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, readFileSync, readdirSync, symlinkSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { suite, withRoot, ROOT } from "./_harness.mjs";

const { check, done } = suite("console launch · caller path, containment and port", 18);
const launcher = join(ROOT, "tools/console.mjs"), checkout = resolve(ROOT);
async function scenario(label, fn) {
  await withRoot({}, async (tmp) => {
    // Observe real binds without replacing the server or changing launcher output.
    writeFileSync(join(tmp, "observe.mjs"), `import { Server } from "node:net";
import { writeSync } from "node:fs";
const listen = Server.prototype.listen;
Server.prototype.listen = function (...args) {
  writeSync(3, "attempt\\n"); this.once("listening", () => writeSync(3, "listening\\n"));
  return listen.apply(this, args);
};`);
    try { await fn(tmp); check(label, true); }
    catch (e) { check(label, false, e.stack); }
  });
}
// Resolve on either a printed URL or exit, not just success: baseline failures must reach done().
async function child(tmp, { args = [], cwd = checkout, init = tmp, port = "0" }, inspect) {
  const env = { PATH: process.env.PATH, HOME: tmp, GIT_CONFIG_NOSYSTEM: "1", GIT_ALLOW_PROTOCOL: "file" };
  // Never inherit npm's INIT_CWD or a developer's PORT/credentials.
  if (init !== null) env.INIT_CWD = init;
  if (port !== null) env.PORT = port;
  const proc = spawn(process.execPath, ["--import", join(tmp, "observe.mjs"), launcher, ...args], { cwd, env, stdio: ["ignore", "pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "", binds = "", exited = false, timer;
  const closed = new Promise((resolve) => proc.once("close", (code, signal) => { exited = true; resolve({ code, signal }); }));
  const ready = new Promise((resolve, reject) => {
    proc.once("error", reject);
    proc.stdout.on("data", (s) => { stdout += s; if (/http:\/\/(127\.0\.0\.1|localhost):\d+/.test(stdout)) resolve(); });
    proc.stderr.on("data", (s) => stderr += s);
    proc.stdio[3].on("data", (s) => binds += s);
    closed.then(resolve);
    timer = setTimeout(() => reject(new Error(`launcher timed out: ${stderr}`)), 5000);
  });
  try {
    await ready; clearTimeout(timer);
    const url = stdout.match(/http:\/\/(?:127\.0\.0\.1|localhost):\d+/)?.[0];
    await inspect({ stdout, stderr, binds, url, ...(exited ? await closed : {}) });
  } finally {
    clearTimeout(timer);
    if (!exited) proc.kill("SIGTERM");
    const force = setTimeout(() => proc.kill("SIGKILL"), 1000);
    await closed; clearTimeout(force);
  }
}
async function allowed(tmp, opts, expected) {
  const existed = existsSync(expected), entries = existed ? readdirSync(expected).sort() : null;
  try { await child(tmp, opts, async (r) => {
    assert(r.url, r.stderr || "no URL"); assert.equal(r.code, undefined);
    assert(r.stdout.includes(expected), `folder missing: ${r.stdout}`);
    const port = Number(new URL(r.url).port); assert(port > 0 && port <= 65535);
    const response = await fetch(r.url + "/", { redirect: "manual", signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 303); assert.equal(response.headers.get("location"), "/setup");
    await response.arrayBuffer();
    const setup = await fetch(r.url + "/setup", { signal: AbortSignal.timeout(3000) });
    assert.equal(setup.status, 200); assert((await setup.text()).includes(expected), "routes must use the resolved folder too");
    assert.equal(existsSync(expected), existed, "launch must not create the project folder");
    if (existed) assert.deepEqual(readdirSync(expected).sort(), entries);
  }); } finally { if (!existed) rmSync(expected, { recursive: true, force: true }); }
}
async function refused(tmp, opts, code, remedy, absent) {
  if (absent) assert(!existsSync(absent), "fixture requires a fresh target");
  try { await child(tmp, opts, (r) => {
    assert.equal(r.code, 1, `launcher did not exit 1: ${r.stdout} ${r.stderr}`);
    assert.equal(r.url, undefined, "a refusal must not advertise a listener");
    assert(!r.binds.includes("listening"), "a refusal must never open a listener");
    if (code !== "port-in-use") assert.equal(r.binds, "", "invalid launches must refuse before binding");
    assert.match(r.stderr, new RegExp(`^${code}:`, "m")); assert.match(r.stderr, remedy);
    if (absent) assert(!existsSync(absent), "refusal created its target");
  }); } finally { if (absent) rmSync(absent, { recursive: true, force: true }); }
}
for (const mode of ["relative", "absolute", "direct", "no-arg-npm", "no-arg-direct", "prefix-sibling"]) {
  await scenario(`allowed ${mode}: expected folder, PORT=0, setup redirect, no writes`, async (tmp) => {
    const sibling = checkout + "-launch-sibling-" + tmp.split("/").at(-1);
    const expected = mode === "prefix-sibling" ? sibling : mode.startsWith("no-arg") ? tmp : join(tmp, "new project");
    const direct = mode === "direct" || mode === "no-arg-direct";
    const args = mode.startsWith("no-arg") ? [] : [mode === "absolute" || mode === "prefix-sibling" ? expected : "new project"];
    await allowed(tmp, { args, init: direct ? null : mode === "absolute" ? checkout : tmp, cwd: direct ? tmp : checkout }, expected);
  });
}
for (const mode of ["checkout", "inside", "dotdot", "symlink-child", "symlink-init"]) {
  await scenario(`refused ${mode}: checkout containment before creation/listening`, async (tmp) => {
    const name = "launch-absent-" + tmp.split("/").at(-1), absent = join(checkout, name);
    const alias = join(tmp, "alias"); symlinkSync(checkout, alias, "dir");
    const args = mode === "checkout" || mode === "symlink-init" ? []
      : [mode === "inside" ? absent : mode === "dotdot" ? join(checkout, "..", checkout.split("/").at(-1), name) : join(alias, name)];
    // Keep '..' lexical in the argument; path.join would normalize it before the launcher sees it.
    if (mode === "dotdot") args[0] = `${checkout}/../${checkout.split("/").at(-1)}/${name}`;
    await refused(tmp, { args, init: mode === "symlink-init" ? alias : checkout }, "forge-checkout", /npm run console --\s+\S+/, absent);
  });
}
async function occupied(port, fn) {
  const server = createServer(); let owned = false;
  try {
    await new Promise((resolve, reject) => {
      server.once("error", (e) => e.code === "EADDRINUSE" && port === 4747 ? resolve() : reject(e));
      server.listen(port, "127.0.0.1", () => { owned = true; resolve(); });
    });
    // Another process may already own 4747; it still supplies the occupied-port condition.
    await fn(owned ? server.address().port : port);
  } finally { if (owned) await new Promise((resolve) => server.close(resolve)); }
}
for (const useDefault of [true, false]) await scenario(`${useDefault ? "default 4747" : "PORT override"}: occupied port refuses without fallback`, (tmp) =>
  occupied(useDefault ? 4747 : 0, (port) => refused(tmp, { args: [join(tmp, "new")], port: useDefault ? null : String(port) }, "port-in-use", new RegExp(`(?=[\\s\\S]*${port})(?=[\\s\\S]*PORT)`), join(tmp, "new"))));
for (const port of ["abc", "70000", "-1", "1.5"]) await scenario(`bad PORT=${port}: named refusal without creating folder`, (tmp) =>
  refused(tmp, { args: [join(tmp, "new")], port }, "bad-port", /PORT/, join(tmp, "new")));
await scenario("README documents the launch command and package retains its console script", () => {
  assert.match(readFileSync(join(ROOT, "README.md"), "utf8"), /npm run console -- /);
  assert.match(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts.console, /\bnode\s+tools\/console\.mjs\b/);
});
done();
