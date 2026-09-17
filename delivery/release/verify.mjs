#!/usr/bin/env node
// owns: R11 · delivery — the provenance verifier, as it is committed into the product's own repository.
//
// This file is vendored: it is copied beside the manifest and must run in a fresh clone
// with nothing installed, no network, and no Forge anywhere on the machine. So it imports
// node builtins only, and it carries its own copy of the canonical-hash algorithm rather
// than importing shared/hash.mjs. That duplication is the point — a verifier that needed
// the thing it verifies would be checking that Forge agrees with itself. An eval holds the
// copy to the original on the same inputs, so the two cannot drift silently.
//
// What it can prove, it proves from the repository: that every commit the manifest credits
// is really in this history, that every artifact it pinned still hashes to what was pinned,
// that its own bytes are the bytes the manifest names, and that the chain's arithmetic
// holds. What it cannot prove, it says nothing about — a verifier that implied it had
// re-judged the work would be worth less than one that says plainly what it checked.
//
//   node forge/verify.mjs            # from the root of a clone
//   node forge/verify.mjs --json     # the same, as a record
//
// Exit 0 when every check passes, 1 when any fails, 2 when it cannot run at all.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const MANIFEST = join(HERE, "manifest.json");

// ── the hash, carried (mirrors shared/hash.mjs · sha256/canonical-json/v1) ──

const sortDeep = (v) =>
  Array.isArray(v) ? v.map(sortDeep)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]))
      : v;

const toAscii = (s) => s.replace(/[\u0080-\uFFFF]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
const canonicalize = (v) => toAscii(JSON.stringify(sortDeep(v)));
const sha256 = (v) => createHash("sha256").update(canonicalize(v)).digest("hex");

/** JSON pointer (RFC 6901) lookup; undefined when any step is absent. Named around `node:path`'s own resolve, which this file also uses. */
function atPointer(doc, pointer) {
  if (pointer === "" || pointer === "/") return doc;
  let cur = doc;
  for (const raw of pointer.split("/").slice(1)) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (cur === null || typeof cur !== "object" || !(key in cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

/**
 * The hash of what the artifact says it covers. The pointer list rides in the file, so this
 * needs no knowledge of the artifact's type — and provenance (`traces`, `meta`, workflow
 * state) is left out on purpose: regenerating an artifact whose text is unchanged must not
 * stale its children. No pointers, or none that resolve, is a refusal — hashing nothing
 * would mint a hash that means nothing.
 */
function contentHash(doc) {
  const pointers = doc?.["x-drift-checked"];
  if (!Array.isArray(pointers) || pointers.length === 0) {
    throw new Error("contentHash: the artifact carries no x-drift-checked pointers");
  }
  const picked = {};
  for (const p of pointers) {
    const v = atPointer(doc, p);
    if (v !== undefined) picked[p] = v;
  }
  if (Object.keys(picked).length === 0) {
    throw new Error(`contentHash: none of ${pointers.join(", ")} resolve on the artifact`);
  }
  return sha256(picked);
}

/** A file's bytes, hashed. What every pin in the manifest is. */
const sha256File = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

// ── the checks ──

const checks = [];
const check = (ok, name, detail = "") => checks.push({ ok: Boolean(ok), name, detail: String(detail) });

function git(args) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

function main() {
  if (!existsSync(MANIFEST)) {
    process.stderr.write(`verify: no manifest at ${MANIFEST}\n`);
    return 2;
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  } catch (e) {
    process.stderr.write(`verify: the manifest is not readable JSON — ${e.message}\n`);
    return 2;
  }

  // 1. The manifest is the document it says it is.
  const stamped = manifest.meta?.content_hash;
  check(stamped && contentHash(manifest) === stamped,
    "the manifest hashes to its own stamp",
    stamped ? `stamped ${stamped}, recomputed ${contentHash(manifest)}` : "no meta.content_hash");

  // 2. This verifier is the one the manifest shipped with. A checker somebody edited after
  //    the fact must not be able to pass itself off as the checker that was committed.
  const mine = sha256File(fileURLToPath(import.meta.url));
  check(manifest.verifier?.sha256 === mine,
    "the verifier's bytes are the bytes the manifest names",
    `manifest ${manifest.verifier?.sha256}, this file ${mine}`);

  // 3. Every record the manifest pinned is still byte-for-byte what was pinned. A pin that
  //    no longer matches means the manifest describes something that is no longer here.
  //    Bytes, so this needs to know nothing about what kind of document it is holding.
  for (const p of manifest.pins ?? []) {
    const at = join(ROOT, p.path);
    if (!existsSync(at)) { check(false, `pinned: ${p.what}`, `${p.path} is not in this clone`); continue; }
    const got = sha256File(at);
    check(got === p.sha256, `pinned: ${p.what}`, got === p.sha256 ? p.path : `${p.path}: pinned ${p.sha256}, on disk ${got}`);
  }

  // 4. Every commit the chain credits is really in this history. A manifest can claim any
  //    sha; only the repository can say whether it is one of its own.
  const commits = [...new Set((manifest.chain ?? []).flatMap((r) => r.commits ?? []))];
  const head = git(["rev-parse", "HEAD"]);
  check(head !== null, "this is a git repository", head ?? "git rev-parse HEAD failed");
  let missing = [];
  if (head !== null) {
    for (const c of commits) {
      const type = git(["cat-file", "-t", c]);
      if (type !== "commit") missing.push(c);
    }
  }
  check(missing.length === 0, `every credited commit is in this history (${commits.length})`,
    missing.length ? `not found: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ` (+${missing.length - 5})` : ""}` : "");

  // 5. The chain's arithmetic. `discharged` is not an opinion: it is true exactly when a
  //    bound test ran and passed, and a row that says otherwise is a manifest that lies
  //    about the one thing it exists to report.
  const chain = manifest.chain ?? [];
  const wrong = chain.filter((r) => r.discharged !== (r.tests ?? []).some((t) => t.passed));
  check(wrong.length === 0, `discharged matches the executed record on every row (${chain.length})`,
    wrong.length ? `disagrees on ${wrong.slice(0, 5).map((r) => r.criterion).join(", ")}` : "");

  // 6. Nothing was quietly dropped: every criterion appears once, and none is nameless.
  const ids = chain.map((r) => r.criterion);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  check(dupes.length === 0 && ids.every(Boolean), "every criterion appears exactly once",
    dupes.length ? `repeated: ${[...new Set(dupes)].join(", ")}` : "");

  // ── what it found ──
  const failed = checks.filter((c) => !c.ok);
  const undischarged = chain.filter((r) => !r.discharged);

  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify({ ok: failed.length === 0, checks, undischarged: undischarged.map((r) => r.criterion) }, null, 2) + "\n");
  } else {
    for (const c of checks) process.stdout.write(`${c.ok ? "ok  " : "FAIL"}  ${c.name}${c.detail ? `\n        ${c.detail}` : ""}\n`);
    process.stdout.write(`\n${checks.length - failed.length}/${checks.length} checks passed\n`);
    // Not a failure of the manifest — a fact about the release, and the reader's to weigh.
    if (undischarged.length) {
      process.stdout.write(`\n${undischarged.length} criterion(s) the release does not claim to have discharged:\n`);
      for (const r of undischarged) process.stdout.write(`  ${r.criterion} — ${r.statement}\n`);
    }
  }
  return failed.length === 0 ? 0 : 1;
}

process.exit(main());
