// owns: R14, R15 · discovery — DH1b 5b package boundary; no real tracker or model.
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { suite, withRoot, scripted } from "./_harness.mjs";
import { seedProject, seedPrototype, seedStories, seedDesign, writeHtml } from "./_fixture.mjs";
import { agree } from "../discovery/doors/index.mjs";
import { review, signoff } from "../discovery/design/index.mjs";
import { exportHandoff, costOf, GATE } from "../discovery/export/index.mjs";
import { saveDoc, saveVerdict, PROTOTYPE_FILE, HTML_FILE, Refused } from "../discovery/record/index.mjs";
import { readHandoffs, handoffFile } from "../shared/handoff.mjs";
import { append } from "../shared/agent-call/ledger.mjs";
import { ledgerPath } from "../discovery/setup/index.mjs";

const { check, done } = suite("handoff package · DH1b 5b", 16);
const PACKAGES = "discovery/packages";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const read = (root, file) => fs.readFileSync(join(root, file));
const json = (root, file) => JSON.parse(read(root, file));
const noIO = () => { throw new Error("unexpected external IO"); };
const options = root => ({ root, exit: "team", by: "Package PM", tracker: false, _env: {}, _exec: noIO, _fetch: noIO });
const names = root => fs.existsSync(join(root, PACKAGES)) ? fs.readdirSync(join(root, PACKAGES)).sort() : [];
// Include empty directories as well as exact bytes; no ignored file can hide a write.
function snapshot(root) {
  const result = {};
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name), key = relative(root, path);
      result[key] = entry.isDirectory() ? null : fs.readFileSync(path).toString("base64");
      if (entry.isDirectory()) walk(path);
    }
  }
  walk(root); return result;
}
async function ready(parent, delivery = false) {
  const root = seedProject(parent);
  const proto = seedPrototype(root);
  // Non-ASCII plus CRLF catches text normalization and character-count byte sizes.
  proto.file_hash = writeHtml(root, "<!doctype html>\r\n<title>Dock — café 🚢</title>\r\n<main>Ready</main>\r\n");
  saveDoc(root, PROTOTYPE_FILE, "prototype", proto);
  agree({ root, by: "Package PM" }); seedStories(root);
  if (delivery) {
    seedDesign(root);
    await review({ root, _query: scripted({ structured: { findings: [], deferred: [], checked: 2, skipped: 0 } }).query });
    signoff(root, { by: "Designer" });
  }
  return root;
}
async function scenario(label, run) {
  // Report every independent scenario even before the writer exists. No skip/xfail.
  try { await withRoot({}, run); check(label, true); }
  catch (error) { check(label, false, error.stack); }
}
function packageOf(root, result, html) {
  const h = result.handoff, dir = join(root, PACKAGES, `handoff-v${h.version}`);
  assert.deepEqual(read(dir, "handoff.json"), read(root, result.file));
  assert.deepEqual(read(dir, "HANDOFF.md"), read(root, result.rendering));
  assert.deepEqual(read(dir, "prototype/index.html"), html);
  const manifest = json(dir, "manifest.json");
  // 5b's minimal wire shape, deliberately outside the legacy handoff schema.
  assert.equal(manifest.format, "forge-handoff-package/1");
  assert.deepEqual(manifest.handoff, { id: h.id, version: h.version, exit: h.exit });
  assert.deepEqual(manifest.source, {
    prd: h.contract.prd,
    prototype: { content_hash: h.prototype.meta.content_hash, file_hash: h.prototype.file_hash },
  });
  const files = ["HANDOFF.md", "handoff.json", "prototype/index.html"].sort();
  assert.deepEqual(manifest.files.map(f => f.path).sort(), files);
  assert.deepEqual(Object.entries(snapshot(dir)).filter(([, value]) => value !== null).map(([path]) => path).sort(), [...files, "manifest.json"].sort());
  for (const entry of manifest.files) {
    const bytes = read(dir, entry.path);
    assert.equal(entry.sha256, sha(bytes), entry.path);
    assert.equal(entry.bytes, bytes.length, entry.path);
  }
  assert.equal(sha(html), manifest.source.prototype.file_hash);
  assert.deepEqual(manifest.omissions, ["acceptance plan", "recipient verifier"]);
  return manifest;
}
for (const exit of ["team", "delivery", "both"]) await scenario(`${exit}: exact bytes, complete manifest and source revision`, async parent => {
  const root = await ready(parent, exit !== "team"), html = read(root, HTML_FILE);
  const result = await exportHandoff({ ...options(root), exit });
  packageOf(root, result, html);
  assert.deepEqual(names(root), ["handoff-v1"]);
});

function tracker(root, changeHtml = false) {
  const calls = [];
  return { calls, _exec: (cmd, args) => {
    assert.equal(cmd, "gh"); assert.deepEqual(args.slice(0, 4), ["api", "-X", "POST", "repos/acme/dock/issues"]);
    calls.push(args);
    if (changeHtml) fs.writeFileSync(join(root, HTML_FILE), "<title>Changed during tracker projection</title>");
    return JSON.stringify({ number: 100 + calls.length });
  } };
}
for (const change of [false, true]) await scenario(change ? "tracker mutation cannot replace captured HTML bytes" : "tracker keys are finalized before JSON and Markdown are packaged", async parent => {
  const root = await ready(parent), html = read(root, HTML_FILE), seam = tracker(root, change);
  const result = await exportHandoff({ ...options(root), tracker: { kind: "github", repo: "acme/dock" }, _exec: seam._exec });
  assert.equal(seam.calls.length, 5);
  assert.deepEqual(result.handoff.tracker.keys, { "REQ-1": 101, "REQ-2": 102, "REQ-4": 103, "STORY-1": 104, "STORY-2": 105 });
  packageOf(root, result, html);
  if (change) assert.notDeepEqual(read(root, HTML_FILE), html);
});
await scenario("unknown spend is named in manifest without extending legacy cost", async parent => {
  const root = await ready(parent), ledger = ledgerPath(root);
  const row = { call: "cost", half: "discovery", stage: "workshop", ok: true, usd: 0 };
  append(ledger, row); const legacy = costOf(root);
  append(ledger, { ...row, usd_unknown: true });
  const result = await exportHandoff(options(root));
  assert.deepEqual(result.handoff.cost, legacy);
  assert.deepEqual(legacy, { usd: 0, calls: 1, by_stage: { workshop: { usd: 0, calls: 1 } } });
  const manifest = packageOf(root, result, read(root, HTML_FILE));
  assert.deepEqual(manifest.spend, { usd: 0, calls: 1, unfinished: 0, unknown: 1 });
});
for (const defect of ["missing", "mismatched"]) for (const gate of ["absent", "existing"]) await scenario(`${defect} HTML with ${gate} verdict: refusal preserves all files and makes no tracker calls`, async parent => {
  const root = await ready(parent), seam = tracker(root);
  if (gate === "existing") saveVerdict(root, { gate: GATE, verdict: "pass", findings: [], deferred: [], checked: 1, skipped: 0, judged: [] });
  if (defect === "missing") fs.unlinkSync(join(root, HTML_FILE));
  else fs.appendFileSync(join(root, HTML_FILE), "<!-- moved -->");
  const before = snapshot(root);
  let error; try { await exportHandoff({ ...options(root), tracker: { kind: "github", repo: "acme/dock" }, _exec: seam._exec }); } catch (e) { error = e; }
  // Assert preservation even if the current implementation unexpectedly succeeds.
  assert.deepEqual(snapshot(root), before);
  assert.equal(seam.calls.length, 0);
  assert(error instanceof Refused, "HTML preflight must refuse");
  assert.deepEqual(readHandoffs(root), []); assert.deepEqual(names(root), []);
});
await scenario("readiness refusal writes neither legacy handoff nor package", async parent => {
  const root = await ready(parent); // no signed design for delivery
  await assert.rejects(exportHandoff({ ...options(root), exit: "delivery" }), e => e instanceof Refused && e.code === "no-design");
  assert.deepEqual(readHandoffs(root), []); assert.deepEqual(names(root), []);
});
for (const populated of [false, true]) await scenario(`${populated ? "populated" : "empty"} existing package directory is protected`, async parent => {
  const root = await ready(parent), destination = join(root, PACKAGES, "handoff-v1");
  fs.mkdirSync(destination, { recursive: true });
  if (populated) fs.writeFileSync(join(destination, "keep.bin"), Buffer.from([0, 255, 10]));
  const before = snapshot(destination), inode = fs.statSync(destination).ino;
  await assert.rejects(exportHandoff(options(root)));
  assert.equal(fs.statSync(destination).ino, inode); assert.deepEqual(snapshot(destination), before);
  assert.deepEqual(names(root), ["handoff-v1"]);
});
for (const operation of ["writeFileSync", "renameSync"]) await scenario(`${operation} failure cleans staging, retains legacy v1 and retries as v2`, async parent => {
  const root = await ready(parent), html = read(root, HTML_FILE), original = fs[operation];
  const base = join(root, PACKAGES) + "/", sentinel = new Error(`injected package ${operation}`);
  let hits = 0, partial = false, attempted, error;
  fs[operation] = (...args) => {
    if (typeof args[0] === "string" && args[0].startsWith(base)) {
      hits++; attempted = args.slice(0, 2);
      if (operation === "writeFileSync") { original(args[0], "partial bytes"); partial = true; }
      throw sentinel;
    }
    return original(...args);
  };
  syncBuiltinESMExports();
  try { await exportHandoff(options(root)); } catch (e) { error = e; }
  finally { fs[operation] = original; syncBuiltinESMExports(); }
  assert.equal(hits, 1, "fault must actually reach the package boundary");
  assert(error, "the injected IO failure must fail the export");
  assert.notEqual(attempted[0], join(root, PACKAGES, "handoff-v1"), "publication starts in staging");
  if (operation === "renameSync") assert.equal(attempted[1], join(root, PACKAGES, "handoff-v1"));
  if (operation === "writeFileSync") assert(partial, "failure follows a partial write");
  assert.deepEqual(names(root), [], "no final or temporary directory survives");
  const retained = readHandoffs(root); assert.deepEqual(retained.map(h => h.version), [1]);
  const legacy = read(root, handoffFile(1)), markdown = read(root, handoffFile(1).replace(/\.json$/, ".md"));
  const retry = await exportHandoff(options(root)); assert.equal(retry.handoff.version, 2);
  assert.deepEqual(read(root, handoffFile(1)), legacy);
  assert.deepEqual(read(root, handoffFile(1).replace(/\.json$/, ".md")), markdown);
  packageOf(root, retry, html); assert.deepEqual(names(root), ["handoff-v2"]);
});
await scenario("legacy cost remains unchanged by unknown flag independently of package availability", async parent => {
  const root = await ready(parent), ledger = ledgerPath(root);
  append(ledger, { call: "one", half: "discovery", stage: "workshop", ok: true, usd: 0 });
  const before = costOf(root);
  append(ledger, { call: "one", half: "discovery", stage: "workshop", ok: true, usd: 0, usd_unknown: true });
  assert.deepEqual((await exportHandoff(options(root))).handoff.cost, before);
});
done();
