// owns: R14, R15 · discovery — DH1b 5c contract; deliberately red until validatePackage exists.
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { join, relative, isAbsolute } from "node:path";
import { suite, withRoot } from "./_harness.mjs";
import { exported, read, manifest, writeManifest, payload, readable, HTML } from "./_package-fixture.mjs";
import * as exporter from "../discovery/export/index.mjs";
import { checkHtml } from "../discovery/prototype/index.mjs";

const cases = [];
const test = (label, fn) => cases.push([label, fn]);
async function validate(dir) {
  assert.equal(typeof exporter.validatePackage, "function", "discovery/export must export validatePackage");
  const result = await exporter.validatePackage(dir); // any throw is a failure, including on bad packages
  assert.equal(typeof result?.ok, "boolean"); assert(Array.isArray(result.findings));
  for (const f of result.findings) { assert.equal(typeof f.rule, "string"); assert.equal(typeof f.file, "string"); }
  return result;
}
async function good(dir) { assert.deepEqual(await validate(dir), { ok: true, findings: [] }); }
async function bad(dir, rule, file) {
  const result = await validate(dir);
  assert.equal(result.ok, false);
  assert(result.findings.some(f => f.rule === rule && f.file === file), `${rule} must name ${file}: ${JSON.stringify(result.findings)}`);
  return result;
}
const scenario = (name, fn) => test(name, parent => exported(parent).then(({ dir, root }) => fn(dir, parent, root)));
scenario("fresh scripted export validates and all payloads/hash records read", async dir => { readable(dir); await good(dir); });
scenario("relocated export validates after source project disappears", async (dir, parent, root) => {
  const copy = join(parent, "empty-copy"); fs.cpSync(dir, copy, { recursive: true }); fs.renameSync(root, root + ".away");
  assert(!fs.existsSync(root)); readable(copy); await good(copy);
});
scenario("edited HTML has file-modified", async dir => { fs.appendFileSync(join(dir, "prototype/index.html"), "<!-- tamper -->"); await bad(dir, "package-file-modified", "prototype/index.html"); });
for (const field of ["sha256", "bytes"]) scenario(`independent ${field} mismatch`, async dir => {
  const m = manifest(dir), f = m.files.find(f => f.path === "HANDOFF.md"); f[field] = field === "bytes" ? f.bytes + 1 : "0".repeat(64); writeManifest(dir, m);
  await bad(dir, "package-file-modified", "HANDOFF.md");
});
for (const file of ["handoff.json", "HANDOFF.md", "prototype/index.html"]) {
  scenario(`listed missing ${file}`, async dir => { fs.unlinkSync(join(dir, file)); await bad(dir, "package-file-missing", file); });
  scenario(`required ${file} omitted from disk and manifest`, async dir => {
    fs.unlinkSync(join(dir, file)); const m = manifest(dir); m.files = m.files.filter(f => f.path !== file); writeManifest(dir, m);
    await bad(dir, "package-file-required", file);
  });
}
scenario("added unlisted file", async dir => { fs.writeFileSync(join(dir, "extra.txt"), "extra"); await bad(dir, "package-file-unlisted", "extra.txt"); });
scenario("unknown format", async dir => { const m = manifest(dir); m.format = "forge-handoff-package/999"; writeManifest(dir, m); await bad(dir, "package-format-unknown", "manifest.json"); });
for (const path of ["../outside.txt", "/outside.txt"]) scenario(`unsafe listed path ${path}`, async dir => {
  const m = manifest(dir); m.files.push({ path, sha256: "0".repeat(64), bytes: 0 }); writeManifest(dir, m); await bad(dir, "package-path-unsafe", path);
});
for (const value of ["{", "null", '{"files":{}}', '{"files":[{}]}', '{"files":[{"path":4,"sha256":"x","bytes":0}]}', '{"files":[{"path":"x","sha256":4,"bytes":0}]}', '{"files":[{"path":"x","sha256":"x","bytes":0.5}]}']) scenario(`unreadable manifest ${value}`, async dir => {
  fs.writeFileSync(join(dir, "manifest.json"), value); await bad(dir, "package-manifest-unreadable", "manifest.json");
});
scenario("missing manifest", async dir => { fs.unlinkSync(join(dir, "manifest.json")); await bad(dir, "package-manifest-unreadable", "manifest.json"); });
for (const value of ["{", "{}"]) scenario(`handoff JSON parse/schema ${value}`, async dir => { payload(dir, "handoff.json", value); await bad(dir, "package-json-unreadable", "handoff.json"); });
// Match the builder's declared reference surface; no arbitrary JavaScript network analysis.
const refs = [
  x => `<img src="${x}">`, x => `<a href="${x}">link</a>`, x => `<form action="${x}"></form>`,
  x => `<button formaction="${x}">send</button>`, x => `<video poster="${x}"></video>`,
  x => `<img srcset="${x} 1x, ${x} 2x">`, x => `<style>body{background:url('${x}')}</style>`,
  x => `<p style="background:url('${x}')">x</p>`, x => `<style>@import '${x}';</style>`,
];
for (const [i, ref] of refs.entries()) {
  scenario(`declared network reference ${i + 1} agrees with builder`, async dir => {
    const html = HTML + ref("https://example.invalid/asset"); assert.throws(() => checkHtml(html), e => e.code === "html-external");
    payload(dir, "prototype/index.html", html); await bad(dir, "package-reference-external", "prototype/index.html");
  });
  scenario(`declared unresolved local reference ${i + 1}`, async dir => {
    const html = HTML + ref("missing.svg"); checkHtml(html); payload(dir, "prototype/index.html", html);
    await bad(dir, "package-reference-unresolved", "prototype/index.html");
  });
}
for (const suffix of ["", "?v=1", "#mark", "?v=1#mark"]) scenario(`listed local logo resolves ${suffix || "plain"}`, async dir => {
  payload(dir, "prototype/logo.svg", '<svg xmlns="http://www.w3.org/2000/svg"/>');
  payload(dir, "prototype/index.html", HTML + `<img src="logo.svg${suffix}">`); await good(dir);
});
scenario("missing listed logo gives missing AND unresolved", async dir => {
  payload(dir, "prototype/logo.svg", "<svg/>"); payload(dir, "prototype/index.html", HTML + '<img src="logo.svg?v=1#mark">'); fs.unlinkSync(join(dir, "prototype/logo.svg"));
  const r = await bad(dir, "package-file-missing", "prototype/logo.svg");
  assert(r.findings.some(f => f.rule === "package-reference-unresolved" && f.file === "prototype/index.html"));
});
scenario("existing but unlisted logo is unresolved", async dir => {
  fs.writeFileSync(join(dir, "prototype/logo.svg"), "<svg/>"); payload(dir, "prototype/index.html", HTML + '<img src="logo.svg">');
  await bad(dir, "package-reference-unresolved", "prototype/index.html");
});
scenario("non-file references and address mentions are ignored", async dir => {
  const html = HTML + '<img src="data:image/svg+xml;base64,PHN2Zy8+"><a href="blob:local">blob</a><a href="javascript:void(0)">action</a><a href="#part">part</a><!-- <img src="https://example.invalid/comment"> --><p data-url="https://example.invalid/data">https://example.invalid/text</p>';
  checkHtml(html); payload(dir, "prototype/index.html", html); await good(dir);
});
// Instrument actual fs entry points, including named ESM imports and promise APIs. Resolve
// aliases before reads; reject an outside target before its bytes can be opened. This is an
// IO regression trap, not a claim about arbitrary native addons or subprocesses.
function watchOutside(outside) {
  const originals = [], attempts = [];
  const realpath = fs.realpathSync;
  const guard = path => {
    if (typeof path === "number") return;
    let target; try { target = realpath(path instanceof URL ? fileURLToPath(path) : path); } catch { return; }
    const rel = relative(realpath(outside), target);
    if (rel === "" || (rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel))) { attempts.push(target); throw new Error("outside sentinel read attempted"); }
  };
  for (const [object, names] of [[fs, ["readFileSync", "readFile", "openSync", "open", "createReadStream", "readdirSync", "readdir", "opendirSync", "opendir"]], [fsp, ["readFile", "open", "readdir", "opendir"]]]) for (const name of names) {
    const original = object[name]; originals.push(() => { object[name] = original; });
    object[name] = (...args) => { guard(args[0]); return original.apply(object, args); };
  }
  syncBuiltinESMExports();
  return { attempts, restore() { originals.reverse().forEach(f => f()); syncBuiltinESMExports(); } };
}
for (const kind of ["listed file", "parent directory", "manifest", "unlisted link"]) scenario(`never follow symlink: ${kind}`, async (dir, parent) => {
  const outside = join(parent, "outside"); fs.mkdirSync(outside);
  let link;
  if (kind === "parent directory") {
    fs.cpSync(join(dir, "prototype"), join(outside, "prototype"), { recursive: true }); fs.rmSync(join(dir, "prototype"), { recursive: true });
    link = "prototype"; fs.symlinkSync(join(outside, "prototype"), join(dir, link));
  } else {
    link = kind === "manifest" ? "manifest.json" : kind === "listed file" ? "HANDOFF.md" : "unlisted-link";
    fs.writeFileSync(join(outside, "sentinel"), kind === "unlisted link" ? "outside" : read(dir, link));
    if (kind !== "unlisted link") fs.unlinkSync(join(dir, link));
    fs.symlinkSync(join(outside, "sentinel"), join(dir, link));
  }
  const watch = watchOutside(outside);
  try {
    // Negative control: reading through this exact alias must trip the observation hook.
    assert.throws(() => fs.readFileSync(join(dir, link, ...(kind === "parent directory" ? ["index.html"] : []))), /outside sentinel read attempted/);
    assert.equal(watch.attempts.length, 1); watch.attempts.length = 0;
    try { await bad(dir, "package-path-unsafe", link); }
    finally { assert.deepEqual(watch.attempts, [], "validator attempted to read outside bytes"); }
  } finally { watch.restore(); }
});
const { check, done } = suite("package validation · DH1b 5c", 54);
for (const [label, fn] of cases) {
  try { await withRoot({}, fn); check(label, true); }
  catch (e) { check(label, false, e.stack); }
}
done();
