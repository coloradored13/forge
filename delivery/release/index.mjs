// owns: R2, R11 · delivery — the last stage. The product leaves with its own provenance:
// one row per criterion tying the promise to the executed evidence and the commits that
// made it, committed into the project's repository beside a checker that needs nothing
// but node and the clone.
//
// Nothing here is a new judgement. Every field is copied from a record some gate already
// filed, which is why release has no judge (SPEC §5): a stage that re-decided anything at
// the end would be the one place the chain's authority came from nowhere. The arithmetic
// is the whole verdict, and its hardest part is not computed here at all — the manifest
// and its verifier are committed, the repository is cloned afresh, and the verifier is run
// there. A verifier that only ever passes in the directory that wrote it proves nothing
// about what a stranger receives.
//
// The chain is built downward from the contract, not upward from what was built. Walking
// up from the commits would only ever find criteria that someone had already worked on,
// and a promise silently dropped between the handoff and the build is exactly the failure
// a manifest exists to make impossible to miss.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { readDoc, saveDoc, saveVerdict } from "../../shared/store.mjs";
import { Refused } from "../../shared/refused.mjs";
import { contentHash } from "../../shared/hash.mjs";
import { pin, deriveVerdict, rank } from "../../shared/judge/index.mjs";
import { readRun, takeHandoff, LEDGER } from "../state/index.mjs";
import { rows } from "../../shared/agent-call/index.mjs";
import { INTAKE_FILE } from "../intake/index.mjs";
import { loadSdd, covered, SDD_FILE } from "../sdd/index.mjs";
import { loadBuild, BUILD_FILE, BRANCH, WORKTREE } from "../build/index.mjs";
import { loadQa, QA_FILE } from "../qa/index.mjs";

export const GATE = "release";
/** Where the manifest and its checker live in the product's repo — beside the run record. */
export const MANIFEST_FILE = join("forge", "manifest.json");
export const VERIFIER_FILE = join("forge", "verify.mjs");
export const VERDICT_FILE = join("forge", "delivery", "reviews", "release.json");
/** The checker as it is authored here, before it is vendored into the project. */
export const VERIFIER_SOURCE = new URL("./verify.mjs", import.meta.url).pathname;
/** The release's own checkout — full, not sparse: it commits into `forge/`, which build's worktree excludes. */
export const RELEASE_WORKTREE = join(".worktrees", "release");

/** Checked by running things; release has no judge, so this is the whole of its verdict (R10). */
export const ARITHMETIC = ["criterion-undischarged", "verify-failed", "manifest-invalid", "commit-unreachable"];

const COMMITTER = { GIT_AUTHOR_NAME: "Forge", GIT_AUTHOR_EMAIL: "forge@forge.local", GIT_COMMITTER_NAME: "Forge", GIT_COMMITTER_EMAIL: "forge@forge.local" };

export function loadManifest(root) { return readDoc(root, MANIFEST_FILE); }

function git(cwd, args, { ok = true } = {}) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...COMMITTER } }).trim();
  } catch (e) {
    if (!ok) return null;
    throw new Error(`git ${args[0]}: ${String(e.stderr ?? e.message).trim().split("\n")[0]}`);
  }
}

/**
 * The chain, one row per criterion the contract carries. Built by walking the contract
 * down through the slice into the binding and the executed record — so a criterion that
 * nothing was ever bound to still gets a row, saying exactly that.
 */
export function chainOf({ intake, sdd, build, qa }) {
  // What the run was never equipped to ask, from qa's own record of it.
  const waiting = new Map((qa?.unprovable ?? []).map((u) => [u.id, u.needs]));
  const byItem = new Map((sdd?.items ?? []).map((it) => [it.work_item, it]));
  // An item merged into another is bound through its coverer, so read the union.
  const coverer = new Map();
  for (const it of sdd?.items ?? []) for (const id of covered(it)) coverer.set(id, it);
  const built = new Map((build?.items ?? []).map((b) => [b.work_item, b]));
  const ran = new Map((qa?.tests ?? []).map((t) => [t.id, t]));

  const chain = [];
  for (const w of intake?.work_items ?? []) {
    const it = coverer.get(w.id) ?? byItem.get(w.id) ?? null;
    const b = it ? built.get(it.work_item) : null;
    const commits = b?.commit ? [b.commit] : [];
    for (const c of w.criteria ?? []) {
      const tests = (it?.tests ?? [])
        .filter((t) => (t.proves ?? []).includes(c.id))
        .map((t) => {
          const got = ran.get(t.id);
          return { id: t.id, suite: got?.suite ?? null, title: got?.title ?? null, ran: Boolean(got), passed: Boolean(got?.passed) };
        });
      chain.push({
        criterion: c.id,
        statement: c.statement ?? "",
        requirement: String(c.id).split("/")[0],
        story: w.id?.startsWith("STORY-") ? w.id : null,
        work_item: it?.work_item ?? w.id,
        screens: (w.screens ?? []).map((s) => s.screen_ref).filter(Boolean),
        tests,
        commits,
        // Read off the executed record, never decided here: a criterion is discharged when
        // a test bound to it ran and passed, and by nothing else.
        discharged: tests.some((t) => t.passed),
        // And when it is not: whether the product failed the promise, or nobody here was
        // equipped to ask it. Only when EVERY bound test waited — one test that could have
        // run and did not pass makes this an ordinary undischarged criterion.
        ...(tests.length && !tests.some((t) => t.passed) && tests.every((t) => waiting.has(t.id))
          ? { unprovable: [...new Set(tests.flatMap((t) => waiting.get(t.id) ?? []))] }
          : {}),
      });
    }
  }
  return chain.sort((a, b) => a.criterion.localeCompare(b.criterion, "en"));
}

/** Every gate's last verdict, and what it came to. Its bytes are pinned with the rest. */
function verdictsOf(root, run) {
  const out = [];
  for (const [gate, st] of Object.entries(run.stages ?? {})) {
    if (!st.verdict) continue;
    const doc = readDoc(root, st.verdict);
    if (!doc) continue;
    out.push({ gate, verdict: doc.verdict, path: st.verdict, round: st.round ?? 0 });
  }
  return out;
}

/**
 * What the release ships, and where each thing lands in the product's repo.
 *
 * The records live outside git today — untracked under `forge/` — and the signed contract
 * lives under `discovery/`, which Delivery's own containment keeps off the build branch
 * (R14). A manifest whose pins point at neither is a manifest nobody but this machine can
 * check, so the release copies what it pins into `forge/` and commits it there. The
 * contract travels as `forge/handoff-vN.json`: Delivery already works from that snapshot —
 * intake reads it — and the manifest's chain quotes its criteria regardless, so shipping
 * it publishes nothing the release was not already carrying. Discovery's working artifacts
 * stay where they are.
 *
 * `from` is read now; `to` is where a reader will find it. The copy is byte-for-byte, so
 * the pin taken here is the pin that will hold in the clone.
 */
export function shipment(root, run) {
  const out = [];
  const add = (what, from, to = from) => { if (existsSync(join(root, from))) out.push({ what, from, to }); };
  add(`handoff v${run.handoff.version}`, run.handoff.path, join("forge", `handoff-v${run.handoff.version}.json`));
  add("the run record", join("forge", "run.json"));
  add("the intake", INTAKE_FILE);
  add("the binding", SDD_FILE);
  add("the build record", BUILD_FILE);
  add("what ran", QA_FILE);
  for (const [gate, st] of Object.entries(run.stages ?? {})) if (st.verdict) add(`${gate} verdict`, st.verdict);
  return out.sort((a, b) => a.to.localeCompare(b.to, "en"));
}

/**
 * Every shipped record by the sha256 of its bytes. Bytes rather than a document hash on
 * purpose: verdicts are written unstamped and carry no `x-drift-checked`, so no single
 * document hash covers every record — and a checker that had to know which kind of
 * artifact it was holding would be a checker with a way to be subtly wrong. Reading a
 * file and hashing it has none.
 */
function pinsOf(root, ship) {
  return ship.map(({ what, from, to }) => ({ what, path: to, sha256: sha256File(join(root, from)) }));
}

/** What the run cost, from the ledger (R1) — the whole of it, and by stage. */
function costOf(root) {
  const all = rows(join(root, LEDGER)).filter((r) => r.usd != null);
  const by_stage = {};
  for (const r of all) by_stage[r.stage] = Number(((by_stage[r.stage] ?? 0) + r.usd).toFixed(4));
  return { usd: Number(all.reduce((n, r) => n + r.usd, 0).toFixed(4)), calls: all.length, by_stage };
}

/** Everything the gates said and did not stop for — the advisories a reader is owed. */
function advisoriesOf(root, run) {
  const out = [];
  for (const st of Object.values(run.stages ?? {})) {
    if (!st.verdict) continue;
    const doc = readDoc(root, st.verdict);
    if (!doc || doc.verdict === "block") continue;
    out.push(...(doc.findings ?? []));
  }
  return rank(out);
}

function deferralsOf(root, run) {
  const out = [];
  for (const st of Object.values(run.stages ?? {})) {
    if (!st.verdict) continue;
    out.push(...(readDoc(root, st.verdict)?.deferred ?? []));
  }
  return out;
}

/** Build the manifest document — a projection of records already filed, never a source. */
export function buildManifest(root, { run, handoff, ship, argv = [] } = {}) {
  const intake = readDoc(root, INTAKE_FILE);
  const sdd = loadSdd(root);
  const build = loadBuild(root);
  const qa = loadQa(root);
  if (!intake) throw new Refused("no-intake", "release: no intake on record — the contract was never taken in");
  if (!sdd) throw new Refused("no-binding", "release: no binding on record — sdd runs before release");
  if (!build) throw new Refused("no-build", "release: nothing has been built");
  if (!qa) throw new Refused("no-proof", "release: nothing has been run — qa proves what release ships");

  const wt = join(root, WORKTREE);
  const commit = existsSync(wt) ? git(wt, ["rev-parse", BRANCH], { ok: false }) : git(root, ["rev-parse", BRANCH], { ok: false });

  return {
    id: run.id,
    meta: {},
    built_at: new Date().toISOString(),
    argv,
    handoff: { version: run.handoff.version, path: run.handoff.path, content_hash: contentHash(handoff) },
    ...(commit ? { product: { branch: BRANCH, commit } } : {}),
    chain: chainOf({ intake, sdd, build, qa }),
    verdicts: verdictsOf(root, run),
    pins: pinsOf(root, ship ?? shipment(root, run)),
    advisories: advisoriesOf(root, run),
    deferrals: deferralsOf(root, run),
    drift: intake.drift ?? { against: null, unchanged: [], changed: [], added: [], removed: [] },
    cost: costOf(root),
    verifier: { path: VERIFIER_FILE, sha256: sha256File(VERIFIER_SOURCE) },
    "x-drift-checked": ["/chain", "/handoff", "/verdicts", "/pins"],
  };
}

const sha256File = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

/**
 * The release checkout: a full worktree on the build branch. The build's own worktree is
 * sparse against `forge/` so its agents cannot read the record (R14) — which is exactly
 * where the manifest must be written, so release takes its own.
 */
export function worktree(root) {
  const top = git(root, ["rev-parse", "--show-toplevel"], { ok: false });
  if (top === null) throw new Refused("no-repo", `release: ${root} is not a git repository`);
  if (git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${BRANCH}`], { ok: false }) === null) {
    throw new Refused("no-branch", `release: ${root} has no ${BRANCH} — build runs before release`);
  }
  const wt = join(root, RELEASE_WORKTREE);
  if (!existsSync(join(wt, ".git")) || git(wt, ["rev-parse", "--is-inside-work-tree"], { ok: false }) === null) {
    git(root, ["worktree", "prune"]);
    rmSync(wt, { recursive: true, force: true });
    mkdirSync(dirname(join(root, RELEASE_WORKTREE)), { recursive: true });
    git(root, ["worktree", "add", "--force", wt, BRANCH]);
  }
  git(wt, ["checkout", "-q", BRANCH]);
  git(wt, ["merge", "--ff-only", "-q", BRANCH], { ok: false });
  return wt;
}

/**
 * Commit the manifest and the vendored checker onto the product's branch, and return the
 * commit. They go in together, always: a manifest without its checker asks to be believed,
 * and a checker without its manifest has nothing to check.
 */
export function commitRelease(root, manifest, ship = []) {
  const wt = worktree(root);
  const paths = [MANIFEST_FILE, VERIFIER_FILE, ...ship.map((s) => s.to)];
  for (const rel of paths) mkdirSync(dirname(join(wt, rel)), { recursive: true });
  // The records first, then the manifest that pins them — so the bytes a pin was taken
  // over are the bytes committed beside it, in the same commit, always.
  for (const s of ship) cpSync(join(root, s.from), join(wt, s.to));
  writeFileSync(join(wt, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + "\n");
  cpSync(VERIFIER_SOURCE, join(wt, VERIFIER_FILE));
  git(wt, ["add", "--force", "--", ...paths]);
  if (git(wt, ["diff", "--cached", "--name-only"]) === "") return git(wt, ["rev-parse", "HEAD"]);
  git(wt, ["commit", "-q", "-m", `release: provenance manifest for ${manifest.id}\n\n${manifest.chain.length} criteria, ${manifest.chain.filter((r) => r.discharged).length} discharged.`]);
  return git(wt, ["rev-parse", "HEAD"]);
}

/**
 * Clone the branch into a fresh directory and run the vendored checker there. This is the
 * arithmetic that matters: a checker that passes only where it was written has proved
 * nothing about the repository somebody else receives. Nothing from this process is
 * carried in — no node_modules, no environment, no Forge.
 */
export function verifyFreshClone(root, { _exec } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "forge-release-"));
  const clone = join(tmp, "clone");
  try {
    const cloned = git(tmp, ["clone", "--quiet", "--branch", BRANCH, "--single-branch", root, clone], { ok: false });
    if (cloned === null) return { ok: false, out: `git clone of ${BRANCH} failed`, clone: null };
    const run = _exec
      ? _exec(["node", VERIFIER_FILE], { cwd: clone })
      : (() => {
        try {
          const out = execFileSync("node", [VERIFIER_FILE], { cwd: clone, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 });
          return { ok: true, out };
        } catch (e) {
          return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` || String(e.message) };
        }
      })();
    return { ...run, clone };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** What the manifest and the fresh clone say, finding-shaped like every gate. */
export function checkRelease(manifest, verified) {
  const findings = [];
  const f = (severity, rule, subject, summary, evidence, remedy) => findings.push({ severity, confidence: "certain", rule, subject, summary, evidence, remedy });

  if (!verified.ok) {
    f("high", "verify-failed", "forge/verify.mjs", "The vendored verifier did not pass in a fresh clone.",
      `A clone of \`${BRANCH}\` was made in a temporary directory and \`node ${VERIFIER_FILE}\` run there. Output: ${String(verified.out).slice(0, 1200)}`,
      "The manifest ships as the product's own evidence. Until it verifies in a clone nobody has touched, it is a claim about this machine.");
  }

  // A criterion the contract carries that nothing discharged. Not the manifest's failure —
  // the manifest is correct to say so — but a release that ships them silently is the
  // failure this stage exists to prevent, so each one is named.
  for (const r of manifest.chain.filter((x) => !x.discharged)) {
    const why = r.unprovable?.length ? `this machine could not walk it: the test(s) wait on ${r.unprovable.join(", ")}`
      : !r.tests.length ? "no test is bound to it"
        : r.tests.every((t) => !t.ran) ? "its test(s) did not run"
          : "its test(s) ran and did not pass";
    f("high", "criterion-undischarged", r.criterion, `${r.criterion} is not discharged by anything that ran.`,
      `${r.statement}\n  on ${r.work_item} — ${why}: ${r.tests.map((t) => `${t.id} ${t.ran ? (t.passed ? "passed" : "failed") : "did not run"}`).join("; ") || "(none)"}`,
      "Discharge it, bind evidence for it in sdd, or dispose of it on the record — a release does not quietly drop a promise the contract carries.");
  }
  return findings;
}

/**
 * One round: build the manifest from the records, commit it with its checker into the
 * product's repo, clone that repo afresh, and run the checker there. No model is called —
 * release has no judge, and the verdict is what the arithmetic says.
 */
export async function round(root, ctx = {}) {
  const run = readRun(root);
  const handoff = takeHandoff(root, run.handoff.version).handoff;

  ctx.onEvent?.("building the manifest");
  const ship = shipment(root, run);
  const manifest = buildManifest(root, { run, handoff, ship, argv: ctx.argv ?? [] });
  const doc = saveDoc(root, MANIFEST_FILE, "manifest", manifest);
  ctx.onEvent?.(`${doc.chain.length} criteria · ${doc.chain.filter((r) => r.discharged).length} discharged · ${doc.pins.length} record(s) pinned`);

  const commit = commitRelease(root, doc, ship);
  ctx.onEvent?.(`manifest, verifier and ${ship.length} record(s) committed to ${BRANCH} at ${String(commit).slice(0, 7)}`);

  ctx.onEvent?.("cloning afresh and verifying");
  const verified = verifyFreshClone(root, ctx);
  ctx.onEvent?.(`fresh clone: ${verified.ok ? "verify passed" : "verify FAILED"}`);

  const findings = rank(checkRelease(doc, verified));
  const verdict = {
    gate: GATE,
    verdict: deriveVerdict(findings),
    findings,
    deferred: [],
    checked: doc.chain.length,
    skipped: 0,
    judged: [
      pin({ id: `handoff-v${run.handoff.version}`, path: run.handoff.path, doc: handoff }),
      pin({ id: doc.id, path: MANIFEST_FILE, doc }),
    ],
    cost: { model: "none", usd: 0, ms: 0 },
  };
  saveVerdict(root, VERDICT_FILE, verdict);
  return { doc, verdict, file: VERDICT_FILE, commit, verified };
}

/** A re-judge rebuilds from the same records and verifies again — nothing here is a model's. */
export const rejudge = round;
