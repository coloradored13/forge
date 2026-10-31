// owns: R14, R15 · discovery — scripted, files-only package for validator and browser evals.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { scripted } from "./_harness.mjs";
import { seedProject, seedStories, SCREENS } from "./_fixture.mjs";
import { generate } from "../discovery/prototype/index.mjs";
import { agree } from "../discovery/doors/index.mjs";
import { exportHandoff, PACKAGES } from "../discovery/export/index.mjs";

export const HTML = `<!doctype html><title>Portable Dock</title><h1>Run sheet — café</h1>
<button id="record">Record exception</button><output id="result">Ready</output>
<script>document.querySelector('#record').onclick=()=>document.querySelector('#result').textContent='Exception recorded';</script>`;
export const read = (dir, file) => fs.readFileSync(join(dir, file));
export const manifest = dir => JSON.parse(read(dir, "manifest.json"));
export const writeManifest = (dir, value) => fs.writeFileSync(join(dir, "manifest.json"), JSON.stringify(value));
export const sha = bytes => createHash("sha256").update(bytes).digest("hex");
// Rehash intentional semantic defects so their findings cannot be explained by tamper alone.
export function payload(dir, path, bytes) {
  fs.writeFileSync(join(dir, path), bytes);
  const m = manifest(dir), data = read(dir, path);
  m.files = m.files.filter(f => f.path !== path);
  m.files.push({ path, sha256: sha(data), bytes: data.length });
  writeManifest(dir, m);
}
export async function exported(parent) {
  const root = seedProject(parent);
  const q = scripted({ structured: { html: HTML, screens: SCREENS, uncovered: ["REQ-4"], notes: "Portable fixture", open_questions: [] } });
  await generate({ root, _query: q.query });
  assert.equal(q.calls.length, 1);
  agree({ root, by: "Package PM" }); seedStories(root);
  const noIO = () => { throw new Error("unexpected external IO"); };
  const result = await exportHandoff({ root, exit: "team", by: "Package PM", tracker: false, _env: {}, _fetch: noIO, _exec: noIO });
  return { root, dir: join(root, PACKAGES, `handoff-v${result.handoff.version}`) };
}
export function readable(dir) {
  assert.equal(JSON.parse(read(dir, "handoff.json")).project.slug, "dock");
  assert.match(read(dir, "HANDOFF.md").toString(), /Dock/);
  for (const f of manifest(dir).files) {
    const bytes = read(dir, f.path);
    assert.equal(sha(bytes), f.sha256, f.path);
    assert.equal(bytes.length, f.bytes, f.path);
  }
}
