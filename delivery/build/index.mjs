// owns: R2, R14, R1 · delivery — build: the code, contained per work item, accounted from
// base. One builder call per binding item, in the binding's order, each in a worktree of
// the project on the build branch — a checkout that holds nothing of the record (R14) —
// starting from the branch's head. The change set is the diff from that base, whoever
// committed, and it is held to the item's surface (R2): a path outside it, or under the
// pipeline's own directories, discards the item's work and is a finding. A clean item is
// committed by the runner; a blocked one is a finding with the builder's reason, and the
// round halts there, the rest unbuilt. No judge: the verdict is this arithmetic, filed
// for $0 — QA is the judge. An item whose binding has not moved and whose commit stands
// is reused for $0 (R1): manifest currency, so a second round rebuilds what the findings
// name and nothing else.

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { outputContract, validateAgainst } from "../../shared/schema/index.mjs";
import { identity, mechanics, assemble } from "../../shared/prompt/index.mjs";
import { call } from "../../shared/agent-call/index.mjs";
import { deriveVerdict, rank, pin, fit, renderFindingsForAgent } from "../../shared/judge/index.mjs";
import { itemHash } from "../../shared/hash.mjs";
import { scopeOf } from "../../shared/scope.mjs";
import { renderDesign } from "../../shared/handoff.mjs";
import { readDoc, saveDoc, saveVerdict } from "../../shared/store.mjs";
import { Refused } from "../../shared/refused.mjs";
import { LEDGER } from "../state/index.mjs";
import { INTAKE_FILE } from "../intake/index.mjs";
import { loadSdd, SDD_FILE, renderWorkItem, renderItem } from "../sdd/index.mjs";

const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), "prompts");
export const GATE = "build";
export const BUILD_FILE = join("forge", "delivery", "build.json");
export const VERDICT_FILE = join("forge", "delivery", "reviews", "build.json");
/** The branch the build's commits land on, in a worktree beside the project's own checkout. */
export const BRANCH = "forge/build";
export const WORKTREE = join(".worktrees", "build");
/** The pipeline's own directories: not in the worktree, and a path under them in a change set is a `record-write`. */
export const RECORD = ["discovery", "forge"];
/** Never part of a change set: what a build installs, and the worktrees themselves. */
export const IGNORED = ["node_modules/**", ".worktrees/**"];
/** Checked mechanically, never the builder's to report (R10). */
export const ARITHMETIC = ["surface-escape", "record-write", "builder-blocked", "unbuilt", "binding-moved"];
/** The fields of a binding item a build is from — their hash is the manifest currency. */
export const BOUND = ["approach", "interfaces", "tests", "controls", "surface", "risks"];
/** The runner commits as the pipeline, whatever the operator's git identity is. */
const COMMITTER = { GIT_AUTHOR_NAME: "Forge", GIT_AUTHOR_EMAIL: "forge@forge.local", GIT_COMMITTER_NAME: "Forge", GIT_COMMITTER_EMAIL: "forge@forge.local" };

export function loadBuild(root) { return readDoc(root, BUILD_FILE); }

/**
 * One round: every binding item in order — reused where its build stands, built where it
 * does not, unbuilt past the first that blocks or violates — then the arithmetic filed as
 * the verdict, pinned to the handoff, the intake record, the binding and the build record.
 * @param ctx  { run, handoff, intake, review, onEvent, _query, _sleep }
 *             `review` is the previous round's verdict, or null — the items its findings name are rebuilt.
 * @returns { doc, verdict, file }
 */
export async function round(root, ctx) {
  const sdd = loadSdd(root);
  if (!sdd) throw new Refused("no-sdd", "build: there is no binding to build from — sdd runs first");
  const doc = await buildAll(root, { ...ctx, sdd });
  return file(root, { ...ctx, sdd, doc });
}

/**
 * A re-judge (R5): the standing build held to the binding as it now stands — never a
 * rebuild. An item whose binding hash moved is `binding-moved`; one the binding has and
 * the build does not is `unbuilt`. A block here regenerates, which rebuilds exactly those.
 */
export async function rejudge(root, ctx) {
  const doc = loadBuild(root);
  if (!doc) throw new Refused("no-build", "build: there is no build to re-judge");
  const sdd = loadSdd(root);
  if (!sdd) throw new Refused("no-sdd", "build: there is no binding to re-judge against");
  return file(root, { ...ctx, sdd, doc, currency: true });
}

// ── the round ──

async function buildAll(root, { run, handoff, intake, sdd, review, onEvent, _query, _sleep }) {
  const prior = loadBuild(root);
  const wt = worktree(root);
  const redo = new Set((review?.findings ?? []).map((f) => f.subject));
  const items = [];
  let halted = null;
  for (const it of sdd.items) {
    const binding_hash = itemHash(it, BOUND);
    const was = prior?.items.find((p) => p.work_item === it.work_item);
    if (was?.status === "built" && was.binding_hash === binding_hash && !redo.has(it.work_item) && stands(wt, was.commit)) {
      items.push({ ...was, reused: true });
      onEvent?.(`${it.work_item} reused — binding unchanged, ${was.commit.slice(0, 7)} stands`);
      continue;
    }
    if (halted) {
      items.push(entry(it.work_item, { status: "unbuilt", binding_hash, summary: `Not built: the round halted at ${halted}.`, reason: `the round halted at ${halted}` }));
      continue;
    }
    // whatever a dead call left in the worktree is nobody's: the base is the branch's head, clean
    discard(wt);
    const base = head(wt);
    onEvent?.(`${it.work_item} building from ${base.slice(0, 7)}`);
    const report = await build(root, wt, { run, handoff, intake, sdd, item: it, review, base, onEvent, _query, _sleep });
    const changed = changeSet(wt, base);
    const violations = contain(changed, it.surface);
    const { status, summary, suggestions, reason } = report;
    if (violations.length) {
      discard(wt);
      halted = it.work_item;
      items.push(entry(it.work_item, { status: "violated", binding_hash, base, changed, violations, summary, suggestions, reason: `the change set left the surface: ${violations.map((v) => `${v.path} (${v.rule})`).join(", ")}` }));
      onEvent?.(`${it.work_item} violated — ${violations.length} path(s) it may not change; discarded`);
      continue;
    }
    if (status === "blocked" || !changed.length) {
      discard(wt);
      halted = it.work_item;
      const why = status === "blocked" ? reason ?? "the builder gave no reason" : "the builder reported built and changed nothing";
      items.push(entry(it.work_item, { status: "blocked", binding_hash, base, changed, summary, suggestions, reason: why }));
      onEvent?.(`${it.work_item} blocked — ${why}`);
      continue;
    }
    const commit = commitAll(wt, `${it.work_item}: ${summary.split("\n")[0].slice(0, 72)}`);
    items.push(entry(it.work_item, { status: "built", binding_hash, base, commit, changed, summary, suggestions }));
    onEvent?.(`${it.work_item} built — ${changed.length} path(s), ${commit.slice(0, 7)}`);
  }
  const doc = {
    id: `build-${run.id}`, meta: {},
    traces: { handoff: { version: handoff.version, content_hash: handoff.meta.content_hash }, intake: { content_hash: intake.meta.content_hash }, sdd: { content_hash: sdd.meta.content_hash } },
    branch: BRANCH, items,
    "x-drift-checked": ["/items", "/branch"],
  };
  return saveDoc(root, BUILD_FILE, "build", doc);
}

function entry(work_item, { status, binding_hash, base = null, commit = null, changed = [], violations = [], summary, suggestions = [], reason = null }) {
  return { work_item, status, binding_hash, reused: false, base, commit, changed, violations, summary: fit(summary), suggestions, reason };
}

/** One builder call for one item, in the worktree, fenced at both roots. Returns the validated report. */
async function build(root, wt, { run, handoff, intake, sdd, item, review, base, onEvent, _query, _sleep }) {
  const contract = handoff.contract;
  const w = intake.work_items.find((x) => x.id === item.work_item);
  if (!w) throw new Refused("item-unknown", `build: ${item.work_item} is bound but is not a work item the intake carries`);
  const refs = new Set(w.screens.map((s) => s.screen_ref));
  const shared = sdd.items.filter((o) => o !== item).flatMap((o) => o.interfaces.filter((i) => i.shared).map((i) => `- ${o.work_item} · \`${i.name}\`: \`${i.signature}\``));
  const questions = [
    ...intake.questions.map((q) => `- ${q.id} (${q.subject ?? q.source}${q.blocking ? ", blocking" : ""}): ${q.question}`),
    ...sdd.questions.map((q) => `- binding (${q.subject}${q.blocking ? ", blocking" : ""}): ${q.question}`),
  ];
  // The findings on this item's own previous build; `unbuilt` says nothing about its work and is not shown.
  const mine = review ? { ...review, findings: review.findings.filter((f) => f.subject === item.work_item && f.rule !== "unbuilt") } : null;
  const system = assemble({
    identity: identity(join(PROMPTS, "builder.md")),
    mechanics: mechanics({ kind: "writer", schema: "build-report", scope: scopeOf(contract), rulings: rulingsOf(contract), arithmetic: ARITHMETIC }),
  });
  const prompt = [
    `## Where you are\n\nYour working directory is a checkout of the product on branch \`${BRANCH}\` at commit ${base}. Everything you change from here is this item's change set, and it is held to the surface in the binding below. Commit nothing: the runner commits what stays inside the surface and discards what does not.`,
    `## The work item\n\n${renderWorkItem(w, intake)}`,
    `## The binding — build exactly this\n\n${renderItem(item)}`,
    `## Shared interfaces the other items name — exact, character for character\n\n${shared.join("\n") || "(none)"}`,
    `## The signed design — the screens this item runs on\n\n${refs.size ? renderDesign({ ...handoff.design, screens: handoff.design.screens.filter((s) => refs.has(s.screen_ref)) }) : "(this item runs on no screen)"}`,
    contract.constraints?.length ? `## Constraints\n\n${contract.constraints.map((c) => `- ${c}`).join("\n")}` : "",
    questions.length ? `## Questions the snapshot still carries — not yours to decide\n\n${questions.join("\n")}` : "",
    mine?.findings.length ? `## The findings on the previous build of this item\n\n${renderFindingsForAgent(mine)}` : "",
  ].filter(Boolean).join("\n\n");

  const res = await call({
    half: "delivery", stage: GATE, role: "builder", kind: "builder",
    system, prompt, root, cwd: wt, outputSchema: outputContract("build-report"),
    ledger: join(root, LEDGER), budget: run.budget, models: run.models, onEvent, _query, _sleep,
  });
  if (res.structured === undefined) throw new Refused("no-structured-output", `build: the builder returned no report on ${item.work_item}`);
  const v = validateAgainst(outputContract("build-report"), res.structured);
  if (!v.ok) throw new Refused("build-report-invalid", `build: the report on ${item.work_item} does not fit the contract — ${v.errors.slice(0, 5).join("; ")}`, v.errors);
  return res.structured;
}

// ── the verdict: arithmetic, filed without a model ──

function file(root, { run, handoff, intake, sdd, doc, currency = false }) {
  const findings = rank(currency ? checkCurrency(sdd, doc) : checkBuild(doc));
  const verdict = {
    gate: GATE, verdict: deriveVerdict(findings), findings, deferred: [],
    checked: sdd.items.length, skipped: 0,
    judged: [
      pin({ id: `handoff-v${handoff.version}`, path: run.handoff.path, doc: handoff }),
      pin({ id: intake.id, path: INTAKE_FILE, doc: intake }),
      pin({ id: sdd.id, path: SDD_FILE, doc: sdd }),
      pin({ id: doc.id, path: BUILD_FILE, doc }),
    ],
    cost: { model: "none", usd: 0, ms: 0 },
  };
  saveVerdict(root, VERDICT_FILE, verdict);
  return { doc, verdict, file: VERDICT_FILE };
}

/** What the round's own record says went wrong, per item, in the item's name — finding-shaped like every gate. */
export function checkBuild(doc) {
  const findings = [];
  const f = (rule, subject, summary, evidence, remedy) => findings.push({ severity: "high", confidence: "certain", rule, subject, summary: fit(summary), evidence, remedy });
  for (const it of doc.items ?? []) {
    if (it.status === "violated") {
      for (const v of it.violations) {
        if (v.rule === "record-write") f("record-write", it.work_item, `${it.work_item} wrote ${v.path}, under the pipeline's record — which no build touches.`, `changed from ${it.base}: ${v.path}; the record is ${RECORD.map((d) => `${d}/`).join(" and ")}. The change set (${it.changed.length} paths) was discarded.`, "The record is written by the runner from what the builder returns; what a build has to say, it says in its report.");
        else f("surface-escape", it.work_item, `${it.work_item} changed ${v.path}, outside its surface.`, `${v.path} matches none of the binding's surface globs; the change set (${it.changed.length} paths) was discarded.`, "Change only what the binding's surface names. A file the item needs outside it is a binding question — widen the surface in sdd, never in the build.");
      }
    } else if (it.status === "blocked") {
      f("builder-blocked", it.work_item, `${it.work_item} was not built: ${it.reason}`, `report: ${it.summary}`, "Answer what it turns on — through Discovery if it is the contract or the design, in sdd if it is the binding — or override on the record.");
    } else if (it.status === "unbuilt") {
      f("unbuilt", it.work_item, `${it.work_item} was not built: ${it.reason}.`, "items are built in the binding's order, and the round halts at the first that is not.", "Clear the item the round halted at; the next round builds on from there.");
    }
  }
  return findings;
}

/** Manifest currency: every binding item has a standing build from the binding as it now hashes. */
export function checkCurrency(sdd, doc) {
  const findings = [];
  const built = new Map((doc.items ?? []).map((it) => [it.work_item, it]));
  for (const it of sdd.items ?? []) {
    const was = built.get(it.work_item);
    const hash = itemHash(it, BOUND);
    if (!was || was.status !== "built") findings.push({ severity: "high", confidence: "certain", rule: "unbuilt", subject: it.work_item, summary: `${it.work_item} has no standing build.`, evidence: was ? `build record: ${it.work_item} is ${was.status}` : `build record: no entry for ${it.work_item}`, remedy: "Regenerate — the round builds exactly the items named here." });
    else if (was.binding_hash !== hash) findings.push({ severity: "high", confidence: "certain", rule: "binding-moved", subject: it.work_item, summary: `${it.work_item} was built from a binding that has since moved.`, evidence: `built from ${was.binding_hash}; the binding now hashes ${hash}`, remedy: "Regenerate — the item is rebuilt from the binding as it stands; the others are reused for $0." });
  }
  return findings;
}

// ── containment (ported from v1 tools/containment.mjs): the change set against the surface ──

/**
 * Every path in the change set that is not allowed there: under the record is
 * `record-write`; outside every surface glob is `surface-escape`. Globs are relative to
 * the repository root: `**` crosses directories (and `foo/**` matches `foo` itself), `*`
 * does not, `?` is one character.
 */
export function contain(changed, surface = []) {
  const record = RECORD.map((d) => globToRegExp(`${d}/**`));
  const allowed = surface.map(globToRegExp);
  const out = [];
  for (const path of changed) {
    if (record.some((r) => r.test(path))) out.push({ path, rule: "record-write" });
    else if (!allowed.some((r) => r.test(path))) out.push({ path, rule: "surface-escape" });
  }
  return out;
}

export function globToRegExp(glob) {
  let re = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") { re += "(?:.*/)?"; i += 2; } // `**/`: any directories, or none
        else if (i + 2 === glob.length && glob[i - 1] === "/") { re = re.slice(0, -1) + "(?:/.*)?"; i += 1; } // trailing `/**`: the directory, or anything under it
        else { re += ".*"; i += 1; }
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(re + "$");
}

// ── the worktree and the accounting: git, the runner's own tool ──

/**
 * The build's checkout: `.worktrees/build` on the build branch (cut from the project's
 * head the first time), sparse so the record's directories are not there to read (R14).
 * The worktree is excluded from the project's own status, never committed.
 */
export function worktree(root) {
  const top = git(root, ["rev-parse", "--show-toplevel"], { ok: false });
  if (top === null || !existsSync(root) || realpathSync(top) !== realpathSync(root)) throw new Refused("no-repo", `build: ${root} is not a git repository — Delivery builds in the project's own repo`);
  const wt = join(root, WORKTREE);
  if (git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${BRANCH}`], { ok: false }) === null) {
    if (git(root, ["rev-parse", "--verify", "--quiet", "HEAD"], { ok: false }) === null) throw new Refused("no-base", `build: ${root} has no commit to build from`);
    git(root, ["branch", BRANCH, "HEAD"]);
  }
  exclude(root, `${WORKTREE}/`);
  if (!existsSync(join(wt, ".git")) || git(wt, ["rev-parse", "--is-inside-work-tree"], { ok: false }) === null) {
    git(root, ["worktree", "prune"]);
    rmSync(wt, { recursive: true, force: true });
    mkdirSync(dirname(wt), { recursive: true });
    git(root, ["worktree", "add", "--no-checkout", wt, BRANCH]);
    git(wt, ["sparse-checkout", "set", "--no-cone", "/*", ...RECORD.map((d) => `!/${d}/`)]);
    git(wt, ["checkout", "-q", BRANCH]);
  }
  return wt;
}

/**
 * What changed from base, whoever changed it: tracked paths that differ, what is untracked
 * and not ignored, and whatever stands under the record's directories — those are outside
 * the sparse cone, so git's own bookkeeping would not show a file put there.
 */
export function changeSet(wt, base) {
  const ignored = IGNORED.map(globToRegExp);
  const tracked = git(wt, ["diff", "--name-only", base]).split("\n");
  const untracked = git(wt, ["ls-files", "--others", "--exclude-standard"]).split("\n");
  const record = RECORD.flatMap((d) => filesUnder(join(wt, d)).map((p) => relative(wt, p)));
  return [...new Set([...tracked, ...untracked, ...record].map((p) => p.trim()).filter((p) => p && !ignored.some((r) => r.test(p))))].sort();
}

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)]));
}

function head(wt) { return git(wt, ["rev-parse", "HEAD"]); }
function stands(wt, commit) { return !!commit && git(wt, ["merge-base", "--is-ancestor", commit, "HEAD"], { ok: false }) !== null; }
/** Back to the branch's head: tracked changes, untracked files, and anything put under the record's directories. */
function discard(wt) {
  git(wt, ["reset", "-q", "--hard", "HEAD"]);
  git(wt, ["clean", "-qfd"]);
  for (const d of RECORD) rmSync(join(wt, d), { recursive: true, force: true });
}
function commitAll(wt, message) {
  git(wt, ["add", "-A"]);
  git(wt, ["commit", "-q", "-m", message]);
  return head(wt);
}

function exclude(root, line) {
  const f = join(root, ".git", "info", "exclude");
  const held = existsSync(f) ? readFileSync(f, "utf8") : "";
  if (held.split("\n").includes(line)) return;
  mkdirSync(dirname(f), { recursive: true });
  appendFileSync(f, `${held && !held.endsWith("\n") ? "\n" : ""}${line}\n`);
}

/** Run git; trimmed stdout. `ok: false` returns null on a non-zero exit instead of throwing. */
function git(cwd, args, { ok = true } = {}) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...COMMITTER } }).trim();
  } catch (e) {
    if (!ok) return null;
    const detail = String(e.stderr ?? e.message).trim().split("\n")[0];
    throw new Error(`git ${args[0]}: ${detail}`);
  }
}

/** The contract's rulings as mechanics takes them (R3). */
function rulingsOf(contract) {
  return (contract.rulings ?? []).map((r) => ({ id: r.id, oq: r.oq, question: r.question, answer: r.answer }));
}
