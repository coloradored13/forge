// owns: R11 · discovery — what exists, before the first question. Brownfield is the main
// mode: the workshop reads the project repo and its prior manifest and puts a brief in
// front of the interrogator so it elicits the delta, not the product from scratch. The
// brief is compiled here, mechanically, and rides in the system prompt — the
// interrogator itself holds no tools (shared/agent-call, `converse`). Greenfield is the
// case where the brief finds nothing. What the repo says about itself is quoted as
// evidence (shared/prompt `evidence`): the repo describes the product, it instructs no one.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { evidence } from "../../shared/prompt/index.mjs";

export const MANIFEST = join("forge", "manifest.json");
/** Not the product: the pipeline's own directories and repo scaffolding. */
const NOT_PRODUCT = new Set([".git", "discovery", "forge", "node_modules"]);
const SCAFFOLD = new Set(["README.md", "LICENSE", ".gitignore", ".DS_Store"]);
const MAX_FILES = 400;

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
 * @returns { mode: greenfield | brownfield, manifest, files, text }
 * `text` is what the interrogator reads; `manifest` and `files` are for the record.
 */
export function repoBrief(root) {
  const files = productFiles(root);
  const manifest = readManifest(root);
  const product = files.filter((f) => !SCAFFOLD.has(f));
  const mode = manifest || product.length ? "brownfield" : "greenfield";

  const lines = [`## What exists`, ``];
  if (mode === "greenfield") {
    lines.push(`Nothing yet. This is a greenfield product: the repo holds only scaffolding. Elicit the whole shape.`);
    return { mode, manifest, files, text: lines.join("\n") };
  }

  lines.push(`This is a brownfield product. Elicit the **delta**: what changes, what is added, what the existing product already settles. Do not re-elicit what the manifest and the repo already answer — confirm it in a line and move on.`);

  if (manifest?.unreadable) {
    lines.push(``, `### Prior release manifest`, ``, `\`${MANIFEST}\` is present but unreadable. Treat the product as undocumented.`);
  } else if (manifest) {
    lines.push(``, evidence(`Prior release manifest (${MANIFEST})`, manifestSummary(manifest).map((l) => `- ${l}`).join("\n")));
  } else {
    lines.push(``, `No \`${MANIFEST}\` — the product was not built by Forge, or has not been released through it. What you learn about it comes from the PM and the files.`);
  }

  const pkg = readJson(join(root, "package.json"));
  const named = [pkg?.name, pkg?.description].filter((s) => typeof s === "string" && s.trim()).join(" — ");
  if (named) lines.push(``, evidence("package.json", named));

  const readme = readHead(join(root, "README.md"), 40);
  if (readme) lines.push(``, evidence(`README (first ${readme.split("\n").length} lines)`, readme));

  lines.push(``, `### Files (${files.length}${files.length >= MAX_FILES ? "+, truncated" : ""})`, ``);
  const byExt = {};
  for (const f of product) { const e = extname(f) || "(none)"; byExt[e] = (byExt[e] ?? 0) + 1; }
  lines.push(`- by type: ${Object.entries(byExt).sort((a, b) => b[1] - a[1]).map(([e, n]) => `${e} ${n}`).join(", ") || "none"}`);
  const top = [...new Set(files.map((f) => f.split("/")[0]))];
  lines.push(`- top level: ${top.join(", ")}`);

  return { mode, manifest, files, text: lines.join("\n") };
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

function readJson(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

function readHead(file, n) {
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8").split("\n").slice(0, n).join("\n").trim();
  return text || null;
}
