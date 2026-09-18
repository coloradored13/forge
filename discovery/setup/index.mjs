// owns: R11, R14 · discovery — one repo per project (SPEC §2). Discovery's setup creates
// it — git init, first commit, private remote — or attaches an existing one, and lays
// down `discovery/` and `forge/` beside the product. Three refusals keep the pipeline
// checkout holding code, evals and fixtures only: a project inside this checkout, a
// new project over an existing directory, an existing project without `.git`.

import { existsSync, mkdirSync, writeFileSync, readFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, dirname, basename, sep } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { GENERATED } from "../../shared/runners.mjs";

export const PIPELINE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DEFAULT_PARENT = join(homedir(), "Forge");
export const PROJECT_FILE = join("forge", "project.json");
export const LEDGER = join("forge", "discovery", "calls.jsonl");
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** What every project keeps out of its repository, whatever it is built with. */
const IGNORE_BASE = ["node_modules/", ".DS_Store"];

/**
 * What the project's `.gitignore` must carry: the ordinary things, and whatever the
 * runners Forge will run there leave beside the product (shared/runners `generates`).
 *
 * Forge writes this file and Forge chooses those runners, so it writes the one that
 * follows from the other. Left incomplete, the runner's output reads to Delivery's
 * change-set accounting as source a builder touched outside its surface — which is how a
 * builder came to be blocked for verifying its own tests.
 */
export const ignoreLines = () => [...IGNORE_BASE, ...GENERATED];

/**
 * Write the file, or add to it what it does not yet carry. Reconciling rather than
 * overwriting is what makes this safe on a project Forge did not create: an existing
 * `.gitignore` is the project's, and lines it already has — in any order, with whatever
 * comments around them — are left exactly as they are. Returns what had to be added.
 */
export function reconcileIgnore(root) {
  const f = join(root, ".gitignore");
  const held = existsSync(f) ? readFileSync(f, "utf8") : null;
  const lines = new Set((held ?? "").split("\n").map((l) => l.trim()));
  const missing = ignoreLines().filter((l) => !lines.has(l));
  if (!missing.length) return [];
  const body = held === null
    ? `${missing.join("\n")}\n`
    : `${held}${held.endsWith("\n") || held === "" ? "" : "\n"}${missing.join("\n")}\n`;
  writeFileSync(f, body);
  return missing;
}

export class SetupRefused extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** Default executor: run a command in a directory, return trimmed stdout. */
export function exec(cmd, args, { cwd }) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/**
 * The real path of `p` even when `p` does not exist yet: the nearest existing ancestor is
 * resolved through its symlinks and the missing tail rejoined. A path that only `resolve`s
 * would compare unequal to a `realpath`ed root under a symlinked parent (macOS's /var →
 * /private/var), and the door would open.
 */
function realish(p) {
  const abs = resolve(p);
  if (existsSync(abs)) return realpathSync(abs);
  const parent = dirname(abs);
  return parent === abs ? abs : join(realish(parent), basename(abs));
}

/** Whether `target` is the pipeline checkout or inside it. Real paths, so a symlink cannot hide it. */
export function insidePipeline(target, pipelineRoot = PIPELINE_ROOT) {
  const p = realish(pipelineRoot);
  const t = realish(target);
  return t === p || t.startsWith(p + sep);
}

/**
 * @param slug       the project's id — also the repo name and the default directory
 * @param title
 * @param path       where the project lives; default `<parent>/<slug>`
 * @param existing   attach a repo that already exists instead of creating one
 * @param models     per-role overrides for this project's Discovery calls
 * @param budget     usd cap for Discovery, or null
 * @param _exec      test seam for git and gh — evals never create a real repo (R15)
 */
export function setupProject({
  slug, title, path, parent = DEFAULT_PARENT, existing = false,
  models = {}, budget = null, pipelineRoot = PIPELINE_ROOT, _exec = exec, _now = () => new Date(),
}) {
  if (!SLUG.test(slug ?? "")) throw new SetupRefused("slug", `setup: slug must match ${SLUG}, got ${JSON.stringify(slug)}`);
  const root = resolve(path ?? join(parent, slug));

  if (insidePipeline(root, pipelineRoot)) {
    throw new SetupRefused("inside-pipeline", `setup: ${root} is inside the pipeline checkout — a project is its own repo, never a directory here`);
  }
  if (existing) {
    if (!existsSync(join(root, ".git"))) throw new SetupRefused("not-a-repo", `setup: ${root} has no .git — attach a repository, or create a new project`);
  } else if (existsSync(root)) {
    throw new SetupRefused("exists", `setup: ${root} already exists — attach it with existing, or pick another path`);
  }

  const projectFile = join(root, PROJECT_FILE);
  if (existsSync(projectFile)) {
    const prior = JSON.parse(readFileSync(projectFile, "utf8"));
    if (prior.slug !== slug) throw new SetupRefused("other-project", `setup: ${root} is already the Forge project "${prior.slug}"`);
  }

  const run = (cmd, args) => _exec(cmd, args, { cwd: root });
  const created = !existing;
  if (created) {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "README.md"), `# ${title ?? slug}\n\nA Forge project. \`discovery/\` holds the PM's artifacts; \`forge/\` holds run records and the provenance manifest; everything else is the product.\n`);
  }
  // Both paths, every time: a project Forge attaches needs this as much as one it creates,
  // and more — its `.gitignore` was written for whatever it was before Forge's runners ran
  // in it. Reconciling is idempotent, so setting a project up twice adds nothing twice.
  const ignored = reconcileIgnore(root);
  for (const d of ["discovery", "forge"]) mkdirSync(join(root, d), { recursive: true });

  const project = existsSync(projectFile) ? JSON.parse(readFileSync(projectFile, "utf8")) : {
    slug, title: title ?? slug, created: _now().toISOString(),
    repo: { path: root, remote: null },
    models, budget, ledger: LEDGER,
  };
  writeFileSync(projectFile, JSON.stringify(project, null, 2) + "\n");

  if (created) {
    run("git", ["init", "-q"]);
    run("git", ["add", "-A"]);
    run("git", ["commit", "-q", "-m", "forge: project setup"]);
    run("gh", ["repo", "create", slug, "--private", "--source", root, "--push"]);
    project.repo.remote = run("git", ["remote", "get-url", "origin"]) || null;
    writeFileSync(projectFile, JSON.stringify(project, null, 2) + "\n");
    run("git", ["add", PROJECT_FILE]);
    run("git", ["commit", "-q", "-m", "forge: record the remote"]);
  } else {
    run("git", ["add", "forge", "discovery", ".gitignore"]);
    run("git", ["commit", "-q", "-m", "forge: attach project", "--allow-empty"]);
  }

  return { root, created, remote: project.repo.remote, project, ignored };
}

/** The project record a Discovery door works from. */
export function loadProject(root) {
  const file = join(root, PROJECT_FILE);
  if (!existsSync(file)) throw new SetupRefused("no-project", `${root} is not a Forge project — run setup first`);
  return JSON.parse(readFileSync(file, "utf8"));
}

export function ledgerPath(root) {
  return join(root, loadProject(root).ledger ?? LEDGER);
}
