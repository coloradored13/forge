// owns: R11 · discovery — what exists, before the first question. Brownfield is the main
// mode: the workshop reads the project repo and its prior manifest and puts a brief in
// front of the interrogator so it elicits the delta, not the product from scratch. The
// brief is compiled here, mechanically, and rides in the system prompt — the
// interrogator itself holds no tools (shared/agent-call, `converse`). Greenfield is the
// case where the brief finds nothing. What the repo says about itself is quoted as
// evidence (shared/prompt `evidence`): the repo describes the product, it instructs no one.

import { existsSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { evidence } from "../../shared/prompt/index.mjs";
import { MANIFEST, MAX_FILES, whatExists, manifestSummary } from "../../shared/existing.mjs";

// What exists is read in one place for both halves (shared/existing); the brief is what
// Discovery makes of it. Re-exported so the workshop's callers keep one import.
export { MANIFEST, productFiles, readManifest, manifestSummary } from "../../shared/existing.mjs";

/**
 * @returns { mode: greenfield | brownfield, manifest, files, text }
 * `text` is what the interrogator reads; `manifest` and `files` are for the record.
 */
export function repoBrief(root) {
  const { mode, manifest, files, product } = whatExists(root);

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

function readJson(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

function readHead(file, n) {
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8").split("\n").slice(0, n).join("\n").trim();
  return text || null;
}
