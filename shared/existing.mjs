// owns: R11 · shared — what exists, read the same way by both halves: the product's own
// files and the prior release manifest the product carries. Discovery's workshop compiles
// a brief from it so the interrogator elicits the delta; Delivery's intake records it so
// a brownfield build starts from what is there. Nothing of either half's record is read
// here — the pipeline's own directories are not the product.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const MANIFEST = join("forge", "manifest.json");
/** Not the product: the pipeline's own directories and repo scaffolding. */
const NOT_PRODUCT = new Set([".git", "discovery", "forge", "node_modules"]);
const SCAFFOLD = new Set(["README.md", "LICENSE", ".gitignore", ".DS_Store"]);
export const MAX_FILES = 400;

/** Every product file, root-relative, capped — a brief is a brief. */
export function productFiles(root) {
  const out = [];
  const walk = (dir) => {
    let names;
    try { names = readdirSync(dir).sort(); } catch { return; }
    for (const n of names) {
      if (out.length >= MAX_FILES) return;
      const p = join(dir, n);
      const rel = relative(root, p);
      if (dir === root && NOT_PRODUCT.has(n)) continue;
      if (n === "node_modules" || n === ".git") continue;
      if (statSync(p).isDirectory()) walk(p); else out.push(rel);
    }
  };
  walk(root);
  return out;
}

/** The prior release's manifest, if the product carries one (M3 writes it). */
export function readManifest(root) {
  const file = join(root, MANIFEST);
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, "utf8")); } catch (e) { return { unreadable: String(e.message).split("\n")[0] }; }
}

/**
 * @returns { mode: greenfield | brownfield, manifest, files, product }
 * `files` is everything that is not the pipeline's; `product` drops the scaffolding too.
 * Greenfield is the case where nothing but scaffolding is found and no manifest.
 */
export function whatExists(root) {
  const files = productFiles(root);
  const manifest = readManifest(root);
  const product = files.filter((f) => !SCAFFOLD.has(f));
  const mode = manifest || product.length ? "brownfield" : "greenfield";
  return { mode, manifest, files, product };
}

/** What a manifest says about the release, whatever fields it carries — the schema lands at M3. */
export function manifestSummary(m) {
  const out = [];
  const meta = m.meta ?? {};
  if (m.id) out.push(`id ${m.id}`);
  if (meta.release ?? m.release) out.push(`release ${meta.release ?? m.release}`);
  if (meta.content_hash) out.push(`content hash ${meta.content_hash}`);
  if (m.contract?.version || m.contract?.content_hash) out.push(`contract ${[m.contract.version, m.contract.content_hash].filter(Boolean).join(" · ")}`);
  for (const k of ["requirements", "criteria", "stories", "screens", "tests", "verdicts", "advisories", "deferrals"]) {
    const v = m[k];
    if (Array.isArray(v)) out.push(`${v.length} ${k}${v.length && v[0]?.id ? ` (${v.slice(0, 8).map((x) => x.id).join(", ")}${v.length > 8 ? ", …" : ""})` : ""}`);
  }
  if (!out.length) out.push(`keys: ${Object.keys(m).join(", ") || "none"}`);
  return out;
}
