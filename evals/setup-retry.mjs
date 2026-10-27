#!/usr/bin/env node
// owns: R10, R11, R14, R15 · discovery — setup prerequisites and ordinary retry.
// PR81 comments 6445182589/6445383165 supersede its original identity/resume rules.
// Git is real and file-only; gh is a stateful script, never an external executable.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { suite, withRoot, scripted } from "./_harness.mjs";
import { setupProject, loadProject, SetupRefused, PROJECT_FILE } from "../discovery/setup/index.mjs";
import { workshopView } from "../discovery/console/views.mjs";
import { routes } from "../discovery/console/index.mjs";
import { generate } from "../discovery/prototype/index.mjs";
import { serve } from "../shared/console/index.mjs";

const { check, done } = suite("setup · preflight, retry and console", 50);
const attempt = (fn) => { try { return { value: fn() }; } catch (error) { return { error }; } };
const snapshot = (root) => !existsSync(root) ? null : JSON.stringify(readdirSync(root, { recursive: true, withFileTypes: true }).map((e) => {
  const p = join(e.parentPath, e.name);
  return [p.slice(root.length), e.isFile() ? readFileSync(p).toString("base64") : "directory"];
}).sort());
const failure = () => Object.assign(new Error("scripted command failure"), { status: 1 });
const refused = (out, code, remedy) => {
  assert(out.error instanceof SetupRefused, out.error?.stack ?? "setup unexpectedly succeeded");
  assert.equal(out.error.code, code);
  assert.match(out.error.message, remedy);
};
const prereqs = ["git --version", "git var GIT_COMMITTER_IDENT", "gh --version", "gh auth status --hostname github.com"];
async function scenario(label, fn) {
  await withRoot({}, async (tmp) => {
    const oldHome = process.env.HOME;
    const home = join(tmp, "home"); mkdirSync(home);
    process.env.HOME = home;
    try { await fn(tmp, home); check(label, true); }
    catch (e) { check(label, false, e.stack); }
    finally { if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome; }
  });
}
function fixture(tmp, home, { https = false, rewrite = false } = {}) {
  const root = join(tmp, "oven"), remote = join(tmp, "remote.git"), calls = [];
  const env = { PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(home, "config"), GIT_ALLOW_PROTOCOL: "file", GIT_TERMINAL_PROMPT: "0" };
  writeFileSync(env.GIT_CONFIG_GLOBAL, "[user]\n name = Setup Eval\n email = setup@example.invalid\n[init]\n defaultBranch = main\n");
  const origin = https ? "https://github.com/acme/oven.git" : remote;
  // Realistic gh URLs; only Git transport is rewritten to a disposable bare repo.
  const url = https ? "https://github.com/acme/oven" : `file://${remote}`;
  const sshUrl = https ? "git@github.com:acme/oven.git" : remote;
  const git = (cwd, args) => execFileSync("git", https && !rewrite && ["push", "ls-remote"].includes(args[0])
    ? ["-c", `url.${remote}.insteadOf=${origin}`, ...args] : args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git(tmp, ["init", "--bare", "-q", remote]);
  const state = { exists: false, failCreate: false, failPush: false, failFinal: false };
  let pushes = 0;
  const push = (cwd, args) => { pushes++; if (state.failPush) throw failure(); return git(cwd, args); };
  const _exec = (cmd, args, { cwd }) => {
    calls.push({ cmd, args: [...args], cwd });
    assert(existsSync(cwd), `executor cwd must exist: ${cwd}`);
    if (cmd === "git") {
      if (args[0] === "commit" && args.includes("forge: record the remote") && state.failFinal) throw failure();
      return args[0] === "push" ? push(cwd, args) : git(cwd, args);
    }
    assert.equal(cmd, "gh", "only git and scripted gh are allowed");
    if (args[0] === "--version") return "scripted gh";
    if (args[0] === "auth") { assert.deepEqual(args, ["auth", "status", "--hostname", "github.com"]); return ""; }
    assert.equal(args[0], "repo"); assert.equal(args[2], "oven");
    if (args[1] === "view") {
      assert.deepEqual(new Set(args[args.indexOf("--json") + 1].split(",")), new Set(["url", "sshUrl", "isEmpty"]));
      return state.exists ? JSON.stringify({ url, sshUrl, isEmpty: !git(tmp, ["ls-remote", remote]) }) : "";
    }
    assert.equal(args[1], "create"); assert(args.includes("--private") && args.includes("--push"));
    if (state.failCreate) throw failure();
    assert.equal(state.exists, false, "must not recreate the repo");
    state.exists = true;
    git(cwd, ["remote", "add", "origin", origin]);
    if (rewrite) git(cwd, ["config", `url.${remote}.insteadOf`, origin]);
    return push(cwd, ["push", "-u", "origin", "HEAD"]);
  };
  return { root, remote, origin, git, state, calls, _exec, pushes: () => pushes,
    run: (extra = {}) => attempt(() => setupProject({ slug: "oven", title: "Oven", path: root, _exec, ...extra })) };
}
const complete = (f, out, remote = f.remote) => {
  assert.ifError(out.error); const p = loadProject(f.root);
  assert.equal(p.repo.remote, remote);
  assert.equal(f.git(f.root, ["status", "--porcelain"]), "");
  assert.equal(JSON.parse(f.git(f.root, ["show", `HEAD:${PROJECT_FILE}`])).repo.remote, remote);
  assert.doesNotThrow(() => workshopView(f.root));
};
const incomplete = (f) => {
  assert(existsSync(join(f.root, PROJECT_FILE)), "partial record must survive");
  assert.throws(() => loadProject(f.root), SetupRefused, "partial setup must not load as complete");
  assert.throws(() => workshopView(f.root), SetupRefused, "a project-dependent door must refuse");
};

for (const [i, code, remedy] of [[0, "no-git", /install.*git|git.*install/i], [1, "no-git-identity", /identity|user\.(name|email)|git config/i], [2, "no-gh", /install.*gh|gh.*install|GitHub CLI/i], [3, "gh-signed-out", /gh auth login|sign.in|log.in/i]]) {
  for (const kind of ["ENOENT", "exit"]) for (const target of ["absent", "empty", "attach"]) {
    const existing = target === "attach";
    await scenario(`${code} (${kind}, ${target}) precedes every write`, (tmp, home) => {
      const f = fixture(tmp, home);
      if (target === "empty") mkdirSync(f.root);
      if (existing) { mkdirSync(f.root); f.git(f.root, ["init", "-q"]); }
      const before = snapshot(f.root), calls = [];
      const _exec = (cmd, args, { cwd }) => {
        const command = [cmd, ...args].join(" "); calls.push(command);
        assert.equal(cwd, existing ? f.root : homedir()); assert(existsSync(cwd));
        if (command === prereqs[i]) throw kind === "ENOENT" ? Object.assign(new Error("missing executable"), { code: "ENOENT" }) : failure();
        return "";
      };
      const out = f.run({ existing, _exec });
      if (existing && i > 1) { // Attach deliberately never consults gh.
        assert.ifError(out.error); assert(calls.every((x) => x.startsWith("git ")));
        assert.deepEqual(calls.slice(0, 2), prereqs.slice(0, 2));
      } else {
        refused(out, code, remedy); assert.equal(snapshot(f.root), before);
        assert.deepEqual(calls, prereqs.slice(0, i + 1));
      }
    });
  }
}
await scenario("real Git missing identity refuses an absent target before mkdir", (tmp, home) => {
  const f = fixture(tmp, home);
  writeFileSync(join(home, "config"), "[user]\n useConfigOnly = true\n");
  refused(f.run(), "no-git-identity", /identity|user\.(name|email)|git config/i);
  assert.equal(snapshot(f.root), null);
  assert.deepEqual(f.calls.map((c) => [c.cmd, ...c.args].join(" ")), prereqs.slice(0, 2));
});
for (const empty of [true, false]) await scenario(`fresh setup refuses an existing ${empty ? "empty" : "nonempty"} account repo before writes`, (tmp, home) => {
  const f = fixture(tmp, home); f.state.exists = true;
  const out = f.run({ _exec: (cmd, args, opts) => cmd === "gh" && args[1] === "view" ? JSON.stringify({ url: f.remote, sshUrl: f.remote, isEmpty: empty }) : f._exec(cmd, args, opts) });
  refused(out, "repo-taken", /repo|name/i); assert.equal(snapshot(f.root), null);
  assert(!f.calls.some((c) => c.args[0] === "init" || c.args[1] === "create"));
});
await scenario("empty existing folder is new; real preflight works before mkdir", (tmp, home) => {
  const f = fixture(tmp, home); mkdirSync(f.root); complete(f, f.run());
  assert(f.calls.slice(0, 4).every((c) => c.cwd === home)); assert.equal(f.pushes(), 1);
});
await scenario("absent target and empty-output executor remain supported", (tmp) => {
  const root = join(tmp, "new"); assert.ifError(attempt(() => setupProject({ slug: "new", path: root, _exec: () => "" })).error);
  assert.equal(loadProject(root).slug, "new");
});
await scenario("local refusals precede prerequisites and preserve files", (tmp, home) => {
  const f = fixture(tmp, home); mkdirSync(f.root); writeFileSync(join(f.root, "notes"), "keep");
  const before = snapshot(f.root); refused(f.run(), "exists", /attach|path/i);
  assert.equal(snapshot(f.root), before); assert.equal(f.calls.length, 0);
});
await scenario("attach uses repository-local identity and never gh", (tmp, home) => {
  const f = fixture(tmp, home); mkdirSync(f.root); f.git(f.root, ["init", "-q"]);
  writeFileSync(join(home, "config"), "[user]\n useConfigOnly = true\n");
  f.git(f.root, ["config", "user.name", "Local"]); f.git(f.root, ["config", "user.email", "local@example.invalid"]);
  assert.ifError(f.run({ existing: true }).error); assert.equal(loadProject(f.root).slug, "oven");
  assert(f.calls.every((c) => c.cmd === "git" && c.cwd === f.root));
});
for (const stage of ["failCreate", "failPush", "failFinal"]) await scenario(`${stage}: ordinary failure stays incomplete and retry finishes without duplicate setup`, (tmp, home) => {
  const f = fixture(tmp, home); f.state[stage] = true;
  assert(f.run().error); incomplete(f);
  const head = f.git(f.root, ["rev-parse", "HEAD"]), before = f.pushes();
  if (stage === "failPush") { assert.equal(f.git(f.root, ["remote", "get-url", "origin"]), f.remote); assert.equal(f.git(tmp, ["ls-remote", f.remote]), ""); }
  if (stage === "failFinal") assert(f.git(tmp, ["ls-remote", f.remote]).includes(head));
  f.state[stage] = false; complete(f, f.run());
  assert.equal(f.calls.filter((c) => c.cmd === "git" && c.args[0] === "init").length, 1);
  assert.equal(f.git(f.root, ["log", "--format=%s"]).split("\n").filter((x) => x === "forge: project setup").length, 1);
  assert.equal(f.pushes() - before, stage === "failFinal" ? 0 : 1);
  assert(f.git(tmp, ["ls-remote", f.remote]).includes(head));
});
await scenario("partial setup refuses a different slug before commands", (tmp, home) => {
  const f = fixture(tmp, home); f.state.failCreate = true; assert(f.run().error);
  const before = snapshot(f.root), n = f.calls.length;
  refused(f.run({ slug: "other" }), "other-project", /oven/);
  assert.equal(snapshot(f.root), before); assert.equal(f.calls.length, n);
});
for (const origin of ["none", "matching", "different"]) await scenario(`partial setup refuses different remote history (${origin} origin)`, (tmp, home) => {
  const matching = origin === "matching";
  const f = fixture(tmp, home); f.state[matching ? "failPush" : "failCreate"] = true; assert(f.run().error);
  const unrelated = join(tmp, "unrelated"); mkdirSync(unrelated); f.git(unrelated, ["init", "-q"]);
  f.git(unrelated, ["commit", "--allow-empty", "-qm", "unrelated history"]); f.git(unrelated, ["push", f.remote, "HEAD"]);
  if (origin === "different") f.git(f.root, ["remote", "add", "origin", join(tmp, "other.git")]);
  f.state.failPush = f.state.failCreate = false; f.state.exists = true;
  const refs = f.git(tmp, ["ls-remote", f.remote]), before = f.pushes();
  refused(f.run(), "repo-taken", /repo|remote|name/i); incomplete(f);
  assert.equal(f.pushes(), before); assert.equal(f.git(tmp, ["ls-remote", f.remote]), refs);
});
await scenario("partial setup adopts an empty account repo without an origin", (tmp, home) => {
  const f = fixture(tmp, home); f.state.failCreate = true; assert(f.run().error);
  f.state.failCreate = false; f.state.exists = true;
  const out = f.run(), origin = f.git(f.root, ["remote", "get-url", "origin"]);
  assert([f.remote, `file://${f.remote}`].includes(origin)); complete(f, out, origin);
  assert.equal(f.pushes(), 1); assert.equal(f.calls.filter((c) => c.cmd === "gh" && c.args[1] === "create").length, 1);
});

await scenario("matching repo URL also retries an empty remote", (tmp, home) => {
  const f = fixture(tmp, home); f.state.failPush = true; assert(f.run().error);
  f.git(f.root, ["remote", "set-url", "origin", `file://${f.remote}`]);
  f.state.failPush = false; complete(f, f.run(), `file://${f.remote}`);
  assert.equal(f.pushes(), 2);
});
// PR82 regressions: gh's HTTPS clone URL differs from its browser URL.
for (const rewrite of [false, true]) for (const stage of ["failPush", "failFinal"]) {
  await scenario(`HTTPS ${stage} retry${rewrite ? " with configured insteadOf" : ""}`, (tmp, home) => {
    const f = fixture(tmp, home, { https: true, rewrite }); f.state[stage] = true;
    assert(f.run().error); incomplete(f);
    assert.equal(f.git(f.root, ["config", "--get", "remote.origin.url"]), f.origin);
    assert.equal(f.git(f.root, ["remote", "get-url", "origin"]), rewrite ? f.remote : f.origin);
    const head = f.git(f.root, ["rev-parse", "HEAD"]), before = f.pushes();
    assert.equal(Boolean(f.git(tmp, ["ls-remote", f.remote])), stage === "failFinal");
    f.state[stage] = false;
    complete(f, f.run(), rewrite ? f.remote : f.origin);
    assert.equal(f.pushes() - before, stage === "failFinal" ? 0 : 1);
    assert(f.git(tmp, ["ls-remote", f.remote]).includes(head));
    assert.equal(f.calls.filter((c) => c.cmd === "git" && c.args[0] === "init").length, 1);
    assert.equal(f.git(f.root, ["log", "--format=%s"]).split("\n").filter((x) => x === "forge: project setup").length, 1);
  });
}
await scenario("HTTPS normalization still refuses a different configured repository", (tmp, home) => {
  const f = fixture(tmp, home, { https: true, rewrite: true }); f.state.failPush = true;
  assert(f.run().error); f.state.failPush = false;
  f.git(f.root, ["remote", "set-url", "origin", "https://github.com/elsewhere/oven.git"]);
  const before = f.pushes(); refused(f.run(), "repo-taken", /repo|remote|history/i); incomplete(f);
  assert.equal(f.pushes(), before); assert.equal(f.git(tmp, ["ls-remote", f.remote]), "");
});
await scenario("a successful setup's clone loads and remains usable after attach", (tmp, home) => {
  const f = fixture(tmp, home); complete(f, f.run());
  const clone = join(tmp, "clone"); f.git(tmp, ["clone", "-q", f.remote, clone]);
  const loaded = attempt(() => loadProject(clone)), n = f.calls.length;
  assert.ifError(f.run({ path: clone, existing: true }).error);
  assert.equal(loadProject(clone).slug, "oven"); assert.ifError(loaded.error);
  assert.doesNotThrow(() => workshopView(clone));
  assert.equal(f.git(clone, ["status", "--porcelain"]), "");
  assert(f.calls.slice(n).every((c) => c.cmd === "git" && c.cwd === clone));
});
async function http(srv, path, form) {
  const res = await fetch(srv.url + path, { redirect: "manual", signal: AbortSignal.timeout(5000), ...(form ? { method: "POST", headers: { Origin: srv.url }, body: new URLSearchParams(form) } : {}) });
  return { status: res.status, location: res.headers.get("location"), text: await res.text() };
}
const input = (html, name) => html.match(/<input\b[^>]*>/g)?.find((tag) => tag.includes(`name="${name}"`)) ?? "";
const form = { slug: "oven", title: "Oven & Bread", budget: "12.5", "model.discovery.workshop": "eval-model" };
for (const partial of [false, true]) await scenario(`console ${partial ? "partial failure → reload" : "preflight failure"} → retry preserves new setup`, async (tmp, home) => {
  const f = fixture(tmp, home); let fail = true;
  f.state.failCreate = partial;
  const _exec = (cmd, args, opts) => {
    if (!partial && fail && cmd === "gh" && args[0] === "auth") throw failure();
    return f._exec(cmd, args, opts);
  };
  const q = scripted(), srv = await serve({ routes: routes({ root: f.root, _exec, _query: q.query }) });
  try {
    const failed = await http(srv, "/setup", form);
    assert(failed.status >= 400 && failed.status < 500, `status ${failed.status}`);
    assert.match(failed.text, /<form[^>]*action="\/setup"/);
    assert(!/Something failed/.test(failed.text));
    if (!partial) {
      assert.match(failed.text, /gh-signed-out/);
      assert.match(failed.text, /gh auth login|sign.in|log.in/i);
    } else assert.match(failed.text, /retry|try again|finish setup/i);
    for (const [key, val] of Object.entries(form)) assert(input(failed.text, key).includes(`value="${val.replaceAll("&", "&amp;")}"`), `lost ${key}`);
    assert(input(failed.text, "existing"));
    assert(!/\bchecked\b/.test(input(failed.text, "existing")));
    assert.equal((await http(srv, "/")).location, "/setup");
    const reload = await http(srv, "/setup"); assert.equal(reload.status, 200);
    assert.match(reload.text, /<form[^>]*action="\/setup"/);
    const setupForm = reload.text.match(/<form\b[^>]*action="\/setup"[^>]*>([\s\S]*?)<\/form>/)?.[1] ?? "";
    const controls = (setupForm.match(/<input\b[^>]*>/g) ?? []).filter((tag) => tag.includes('name="existing"'));
    assert.equal(controls.length, 1); assert.match(controls[0], /type="checkbox"/);
    const checked = /\bchecked\b/.test(controls[0]); assert.equal(checked, false);
    if (partial) {
      assert.match(reload.text, /Finish setup/i); incomplete(f);
      const before = snapshot(f.root);
      await assert.rejects(generate({ root: f.root, _query: q.query }), SetupRefused);
      assert.equal(snapshot(f.root), before); assert.equal(q.calls.length, 0);
    }
    fail = false; f.state.failCreate = false;
    const retry = await http(srv, "/setup", { ...form, ...(checked ? { existing: "1" } : {}) }); assert.equal(retry.status, 303);
    complete(f, {}); assert.equal((await http(srv, "/")).location, "/workshop");
    assert.equal(f.pushes(), 1); assert.equal(q.calls.length, 0);
  } finally { await srv.close(); }
});
await scenario("console reload of a plain repository still offers attach", async (tmp, home) => {
  const f = fixture(tmp, home); mkdirSync(f.root); f.git(f.root, ["init", "-q"]);
  const srv = await serve({ routes: routes({ root: f.root, _exec: f._exec }) });
  try { assert(/\bchecked\b/.test(input((await http(srv, "/setup")).text, "existing"))); }
  finally { await srv.close(); }
});
await scenario("a populated setup page shows the refusal code and remedy on reattach", async (tmp, home) => {
  const f = fixture(tmp, home); complete(f, f.run()); let fail = true;
  const before = snapshot(f.root), n = f.calls.length;
  const srv = await serve({ routes: routes({ root: f.root, _exec: (cmd, args, opts) => {
    if (fail && cmd === "git" && args[0] === "var") throw failure();
    return f._exec(cmd, args, opts);
  } }) });
  try {
    const submitted = { slug: "oven", existing: "1" };
    const rejected = await http(srv, "/setup", submitted);
    assert(rejected.status >= 400 && rejected.status < 500);
    assert.match(rejected.text, /no-git-identity/); assert.match(rejected.text, /git config|user\.(name|email)/i);
    assert.equal(snapshot(f.root), before);
    fail = false; assert.equal((await http(srv, "/setup", submitted)).status, 303);
    assert.equal(loadProject(f.root).slug, "oven");
    assert(f.calls.slice(n).every((c) => c.cmd === "git"));
  } finally { await srv.close(); }
});
done();
