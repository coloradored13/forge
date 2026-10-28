// owns: R11, R14 · discovery — one repo per project (SPEC §2). Discovery's setup creates
// it — git init, first commit, private remote — or attaches an existing one, and lays
// down `discovery/` and `forge/` beside the product. Three refusals keep the pipeline
// checkout holding code, evals and fixtures only: a project inside this checkout, a
// new project over a non-empty directory, an existing project without `.git`. What it
// needs (git, an identity, gh signed in, a free repo name) is checked before it writes,
// and a setup that stops partway is finished by running it again (DH1b part 2).

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, dirname, basename, sep } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { GENERATED } from "../../shared/runners.mjs";

export const PIPELINE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DEFAULT_PARENT = join(homedir(), "Forge");
export const PROJECT_FILE = join("forge", "project.json");
export const LEDGER = join("forge", "discovery", "calls.jsonl");
/** Present while a new project's setup is unfinished. Never committed, so no clone inherits it. */
export const SETUP_MARKER = join("forge", ".setup-incomplete");
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
/** What setup needs before it writes, each refused with its remedy. Attaching needs the first two. */
const PREREQS = [
  ["git", ["--version"], "no-git", "git is not installed — install git (on a Mac: xcode-select --install)"],
  ["git", ["var", "GIT_COMMITTER_IDENT"], "no-git-identity", "git has no identity to commit with — set git config --global user.name and user.email"],
  ["gh", ["--version"], "no-gh", "the GitHub CLI is not installed — install gh (brew install gh)"],
  ["gh", ["auth", "status", "--hostname", "github.com"], "gh-signed-out", "the GitHub CLI is not signed in to github.com — run gh auth login"],
];

/** Forge's own unfinished setup at `root` — the record a retry finishes — or null. */
export function partialProject(root) {
  const file = join(root, PROJECT_FILE);
  if (!existsSync(file)) return null;
  return existsSync(join(root, SETUP_MARKER)) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

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
  const projectFile = join(root, PROJECT_FILE);
  const prior = existsSync(projectFile) ? JSON.parse(readFileSync(projectFile, "utf8")) : null;
  const resuming = !existing && Boolean(prior) && existsSync(join(root, SETUP_MARKER));
  if (existing) {
    if (!existsSync(join(root, ".git"))) throw new SetupRefused("not-a-repo", `setup: ${root} has no .git — attach a repository, or create a new project`);
  } else if (existsSync(root) && readdirSync(root).length && !prior) {
    throw new SetupRefused("exists", `setup: ${root} already exists and is not empty — attach it with existing, or pick another path`);
  }
  if (prior && prior.slug !== slug) throw new SetupRefused("other-project", `setup: ${root} is already the Forge project "${prior.slug}"`);
  if (!existing && prior && !resuming) throw new SetupRefused("exists", `setup: ${root} is already a Forge project — attach it with existing, or pick another path`);

  // Nothing is written until what setup needs is there. A new project's folder may not exist yet.
  const pre = (cmd, args) => _exec(cmd, args, { cwd: existing ? root : homedir() });
  for (const [cmd, args, code, remedy] of PREREQS.slice(0, existing ? 2 : 4)) {
    try { pre(cmd, args); } catch { throw new SetupRefused(code, `setup: ${remedy}, then try again`); }
  }
  let repo = null;
  if (!existing) {
    let seen = "";
    try { seen = pre("gh", ["repo", "view", slug, "--json", "url,sshUrl,isEmpty"]); } catch { seen = ""; }
    repo = seen.trim() ? JSON.parse(seen) : null;
    if (repo && !resuming) throw new SetupRefused("repo-taken", `setup: a GitHub repo named ${slug} already exists on this account — pick another name, or attach a clone of it`);
  }

  const run = (cmd, args) => _exec(cmd, args, { cwd: root });
  const created = !existing;
  if (created) {
    mkdirSync(root, { recursive: true });
    if (!existsSync(join(root, "README.md"))) writeFileSync(join(root, "README.md"), `# ${title ?? slug}\n\nA Forge project. \`discovery/\` holds the PM's artifacts; \`forge/\` holds run records and the provenance manifest; everything else is the product.\n`);
  }
  // Both paths, every time: a project Forge attaches needs this as much as one it creates,
  // and more — its `.gitignore` was written for whatever it was before Forge's runners ran
  // in it. Reconciling is idempotent, so setting a project up twice adds nothing twice.
  const ignored = reconcileIgnore(root);
  for (const d of ["discovery", "forge"]) mkdirSync(join(root, d), { recursive: true });

  const project = prior ?? {
    slug, title: title ?? slug, created: _now().toISOString(),
    repo: { path: root, remote: null },
    models, budget, ledger: LEDGER,
  };
  const save = () => writeFileSync(projectFile, JSON.stringify(project, null, 2) + "\n");
  const unfinished = () => writeFileSync(join(root, SETUP_MARKER), "Forge setup has not finished — run setup again with the same name.\n");
  if (created) unfinished();
  save();

  if (created) {
    // Each step is skipped when an earlier attempt finished it; the record stays incomplete
    // until the last commit lands, so running setup again finishes what is missing.
    try {
      const fresh = !existsSync(join(root, ".git"));
      if (fresh) run("git", ["init", "-q"]);
      if (fresh || !succeeds(() => run("git", ["rev-parse", "--verify", "-q", "HEAD"]))) {
        run("git", ["add", "-A", "--", ".", `:!${SETUP_MARKER}`]);
        run("git", ["commit", "-q", "-m", "forge: project setup"]);
      }
      if (!repo) run("gh", ["repo", "create", slug, "--private", "--source", root, "--push"]);
      else adopt({ repo, slug, run });
      project.repo.remote = run("git", ["remote", "get-url", "origin"]) || null;
      rmSync(join(root, SETUP_MARKER), { force: true });
      save();
      run("git", ["add", PROJECT_FILE]);
      run("git", ["commit", "-q", "-m", "forge: record the remote"]);
    } catch (e) {
      unfinished();
      if (e instanceof SetupRefused) throw e;
      throw new SetupRefused("setup-unfinished", `setup: stopped before it finished — ${String(e?.message ?? e).split("\n")[0]}. Fix that, then try again: setup finishes what is missing`);
    }
  } else {
    // An unfinished setup's marker is never committed, here as in a new project's first commit;
    // it goes only once the attach has landed.
    run("git", ["add", "--", "forge", "discovery", ".gitignore", `:!${SETUP_MARKER}`]);
    run("git", ["commit", "-q", "-m", "forge: attach project", "--allow-empty"]);
    rmSync(join(root, SETUP_MARKER), { force: true });
  }

  return { root, created, remote: project.repo.remote, project, ignored };
}

const succeeds = (fn) => { try { fn(); return true; } catch { return false; } };
const norm = (u) => String(u).trim().replace(/\/+$/, "").replace(/\.git$/i, "").toLowerCase();

/**
 * An unfinished setup's GitHub repo, judged by what is on it. With a matching `origin`: an
 * empty remote gets the push it missed, one already holding this setup commit is done, and
 * anything else is someone else's history. Without one, only an empty repo is taken over.
 */
function adopt({ repo, slug, run }) {
  const taken = new SetupRefused("repo-taken", `setup: the GitHub repo ${slug} holds other history — pick another name, or attach a clone of it`);
  let origin = null;
  // As configured, not as `insteadOf` rewrites it: the comparison is about which repository it names.
  try { origin = run("git", ["config", "--get", "remote.origin.url"]); } catch { origin = null; }
  // gh writes an HTTPS origin with `.git`; `gh repo view` reports the browser URL without it.
  const same = (a) => [repo.url, repo.sshUrl].some((u) => u && norm(u) === norm(a));
  if (origin && same(origin)) {
    const refs = run("git", ["ls-remote", "origin"]);
    if (!refs.trim()) run("git", ["push", "-u", "origin", "HEAD"]);
    else if (!refs.includes(run("git", ["rev-parse", "HEAD"]))) throw taken;
  } else if (!origin && repo.isEmpty) {
    run("git", ["remote", "add", "origin", repo.url]);
    run("git", ["push", "-u", "origin", "HEAD"]);
  } else throw taken;
}

/** The project record a Discovery door works from. A setup that has not finished is not one. */
export function loadProject(root) {
  const file = join(root, PROJECT_FILE);
  if (!existsSync(file)) throw new SetupRefused("no-project", `${root} is not a Forge project — run setup first`);
  const project = JSON.parse(readFileSync(file, "utf8"));
  if (existsSync(join(root, SETUP_MARKER))) throw new SetupRefused("setup-incomplete", `${root}: setup has not finished — run it again with the same name to finish it`);
  return project;
}

export function ledgerPath(root) {
  return join(root, loadProject(root).ledger ?? LEDGER);
}
