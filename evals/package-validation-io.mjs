// owns: R14, R15 · discovery — #104 regressions: unreadable paths and file: URL collisions.
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { suite, withRoot } from "./_harness.mjs";
import { skeleton, validate as validateSchema } from "../shared/schema/index.mjs";
import * as exporter from "../discovery/export/index.mjs";

const { check, done } = suite("package validation · IO and file URLs", 7);
async function test(label, fn) {
  try { await withRoot({}, fn); check(label, true); }
  catch (e) { check(label, false, e.stack); }
}
async function validate(dir) {
  assert.equal(typeof exporter.validatePackage, "function", "discovery/export must export validatePackage");
  const result = await exporter.validatePackage(dir);
  assert.equal(typeof result?.ok, "boolean"); assert(Array.isArray(result.findings));
  return result;
}
const good = async dir => assert.deepEqual(await validate(dir), { ok: true, findings: [] });
const finding = async (dir, rule, file) => assert.deepEqual(await validate(dir), { ok: false, findings: [{ rule, file }] });
// A schema-valid hand-made package isolates these IO/reference tests from project setup.
// The scripted export and relocated export checks remain in package-validation.mjs.
function packageAt(parent) {
  const dir = join(parent, "package"), handoff = skeleton("handoff");
  assert.equal(validateSchema("handoff", handoff).ok, true);
  fs.mkdirSync(join(dir, "prototype"), { recursive: true });
  const contents = new Map([["HANDOFF.md", "# Handoff"], ["handoff.json", JSON.stringify(handoff)], ["prototype/index.html", "<!doctype html><title>Portable</title><h1>Portable</h1>"]]);
  const write = () => {
    const files = [];
    for (const [path, content] of contents) {
      const bytes = Buffer.from(content);
      fs.writeFileSync(join(dir, path), bytes);
      files.push({ path, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length });
    }
    fs.writeFileSync(join(dir, "manifest.json"), JSON.stringify({ format: "forge-handoff-package/1", files }));
  };
  write(); return { dir, contents, write };
}
for (const kind of ["missing", "file"]) await test(`${kind} root returns package-unreadable naming .`, async parent => {
  const root = join(parent, "not-a-package");
  if (kind === "file") fs.writeFileSync(root, "not a directory");
  await finding(root, "package-unreadable", ".");
});
for (const file of ["HANDOFF.md", "handoff.json", "prototype/index.html"]) await test(`unreadable listed ${file} returns one named finding`, async parent => {
  const { dir } = packageAt(parent); await good(dir);
  const original = fs.readFileSync, target = join(dir, file);
  const fault = Object.assign(new Error("injected unreadable payload"), { code: "EACCES", path: target });
  let hits = 0;
  // Deterministic even when tests run as root: chmod 000 alone would not deny root.
  // Patch the actual filesystem boundary, including the validator's named ESM import.
  fs.readFileSync = (path, ...args) => {
    const name = path instanceof URL ? fileURLToPath(path) : Buffer.isBuffer(path) ? path.toString() : path;
    if (name === target) { hits++; throw fault; }
    return original(path, ...args);
  };
  syncBuiltinESMExports();
  try { await finding(dir, "package-unreadable", file); }
  finally {
    fs.readFileSync = original; syncBuiltinESMExports();
    assert.equal(hits, 1, "fault must reach the payload read once");
  }
  await good(dir); // restoring the filesystem seam restores a valid package
});
for (const attribute of ["src", "href"]) await test(`${attribute}=file:asset cannot match a hashed colon-named file`, async parent => {
  const { dir, contents, write } = packageAt(parent);
  contents.set("prototype/file:asset", "packaged asset bytes");
  const html = ref => attribute === "src" ? `<img src="${ref}">` : `<a href="${ref}">Asset</a>`;
  contents.set("prototype/index.html", html("./file:asset")); write(); await good(dir);
  const base = pathToFileURL(join(dir, "prototype/index.html"));
  assert.notEqual(new URL("file:asset", base).href, pathToFileURL(join(dir, "prototype/file:asset")).href);
  contents.set("prototype/index.html", html("file:asset")); write();
  await finding(dir, "package-reference-unresolved", "prototype/index.html");
});
done();
