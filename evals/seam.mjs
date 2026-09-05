#!/usr/bin/env node
// owns: R14 · shared — eval: the seam. The static half — the import rule — and the
// project-repo half: one repo per project, created or attached by Discovery's setup,
// never a directory inside the pipeline checkout. The cold-intake half (a handoff read
// in a temp root with discovery/ absent) joins at M2 and lives in this file. git and gh
// are scripted — no real repo is ever created here (R15).

import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { suite, withRoot, ROOT } from "./_harness.mjs";
import { violations } from "../tools/import-rule.mjs";
import { setupProject, loadProject, ledgerPath, insidePipeline, SetupRefused, PIPELINE_ROOT } from "../discovery/setup/index.mjs";

const { check, done } = suite("seam · import rule, project repo");

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

// ── the project repo: one per project, its own, outside this checkout ──
withRoot({ "pipeline/shared/rules.json": RULES, "pipeline/SPEC.md": "#", "taken/notes.txt": "n", "theirs/.git/HEAD": "ref", "theirs/src/app.js": "x", "other/.git/HEAD": "ref", "other/forge/project.json": `{"slug":"someone-else"}` }, (tmp) => {
  const pipelineRoot = join(tmp, "pipeline");
  const parent = join(tmp, "projects");
  const execs = [];
  const _exec = (cmd, args, { cwd }) => {
    execs.push({ cmd, args, cwd });
    if (cmd === "git" && args[0] === "remote") return "git@github.com:acme/oven.git";
    return "";
  };
  const refusal = (opts) => { try { setupProject({ parent, pipelineRoot, _exec, ...opts }); return null; } catch (e) { return e; } };

  const inside = refusal({ slug: "oven", path: join(pipelineRoot, "runs", "oven") });
  check("a project inside the pipeline checkout is refused — the checkout holds code, evals and fixtures only",
    inside instanceof SetupRefused && inside.code === "inside-pipeline" && execs.length === 0, inside?.message);
  check("insidePipeline reads real paths, and the real default is this checkout", insidePipeline(join(pipelineRoot, "x"), pipelineRoot) && !insidePipeline(parent, pipelineRoot) && insidePipeline(join(ROOT, "evals"), PIPELINE_ROOT) && PIPELINE_ROOT === ROOT);
  // A symlink to the checkout, and a path under it that does not exist yet: the door must
  // still see through — this is how macOS's /var → /private/var tmp root first slipped past.
  symlinkSync(pipelineRoot, join(tmp, "link"));
  const viaLink = refusal({ slug: "oven", path: join(tmp, "link", "runs", "oven") });
  check("a not-yet-existing path under a symlink to the checkout is still inside it",
    insidePipeline(join(tmp, "link", "runs", "oven"), pipelineRoot) && viaLink instanceof SetupRefused && viaLink.code === "inside-pipeline" && !existsSync(join(pipelineRoot, "runs")), viaLink?.message);
  const over = refusal({ slug: "taken", path: join(tmp, "taken") });
  check("a new project over an existing directory is refused", over instanceof SetupRefused && over.code === "exists" && existsSync(join(tmp, "taken", "notes.txt")) && !existsSync(join(tmp, "taken", "forge")));
  const notRepo = refusal({ slug: "taken", path: join(tmp, "taken"), existing: true });
  check("attaching a directory that is not a repository is refused", notRepo instanceof SetupRefused && notRepo.code === "not-a-repo");
  const slug = refusal({ slug: "Oven Two" });
  check("a slug that is not a repo name is refused", slug instanceof SetupRefused && slug.code === "slug");
  const other = refusal({ slug: "oven", path: join(tmp, "other"), existing: true });
  check("attaching a repo that is already another Forge project is refused", other instanceof SetupRefused && other.code === "other-project" && /someone-else/.test(other.message));
  check("no refusal ran git or gh", execs.length === 0);

  // The good path: a new project.
  const made = setupProject({ slug: "oven", title: "Oven", parent, pipelineRoot, _exec, budget: 25, models: { "discovery.workshop": "claude-sonnet-5" } });
  const root = join(parent, "oven");
  check("a new project lands at <parent>/<slug> with discovery/, forge/ and forge/project.json beside a README and .gitignore",
    made.root === root && made.created && existsSync(join(root, "discovery")) && existsSync(join(root, "forge", "project.json")) && existsSync(join(root, "README.md")) && existsSync(join(root, ".gitignore")));
  const cmds = execs.map((e) => `${e.cmd} ${e.args.slice(0, 2).join(" ")}`);
  check("the sequence is git init → add → commit → gh repo create --private → record the remote → commit, all in the project root",
    cmds.join(" | ") === "git init -q | git add -A | git commit -q | gh repo create | git remote get-url | git add forge/project.json | git commit -q" && execs.every((e) => e.cwd === root), cmds.join(" | "));
  const gh = execs.find((e) => e.cmd === "gh");
  check("the remote is private and the source is the project root", gh.args.includes("--private") && gh.args[gh.args.indexOf("--source") + 1] === root && gh.args.includes("--push"));
  const project = loadProject(root);
  check("project.json records slug, title, path, remote, models, budget and the ledger path",
    project.slug === "oven" && project.title === "Oven" && project.repo.path === root && project.repo.remote === "git@github.com:acme/oven.git" && project.models["discovery.workshop"] === "claude-sonnet-5" && project.budget === 25 &&
    ledgerPath(root) === join(root, "forge", "discovery", "calls.jsonl") && made.remote === project.repo.remote, JSON.stringify(project));

  // The good path: attach an existing repo.
  execs.length = 0;
  const theirs = join(tmp, "theirs");
  const attached = setupProject({ slug: "theirs", title: "Theirs", path: theirs, existing: true, pipelineRoot, _exec });
  check("attaching lays down discovery/ and forge/project.json, commits them, and creates no remote",
    !attached.created && attached.remote === null && existsSync(join(theirs, "forge", "project.json")) && existsSync(join(theirs, "discovery")) && existsSync(join(theirs, "src", "app.js")) &&
    !execs.some((e) => e.cmd === "gh") && execs.map((e) => e.args[0]).join() === "add,commit", JSON.stringify(execs.map((e) => e.args)));
  const again = setupProject({ slug: "theirs", path: theirs, existing: true, pipelineRoot, _exec });
  check("re-attaching the same project is idempotent — project.json is kept, not rewritten", again.project.created === attached.project.created && JSON.parse(readFileSync(join(theirs, "forge", "project.json"), "utf8")).title === "Theirs");
  check("a directory that is not a project cannot be loaded", (() => { try { loadProject(join(tmp, "taken")); return false; } catch (e) { return e.code === "no-project"; } })());
});

done();
