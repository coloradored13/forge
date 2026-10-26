#!/usr/bin/env node
// owns: R2, R10, R15 · shared — DH1b 1a: a compose/writer returns HTML; only the
// runner publishes it. Scripted tool uses do not execute: options are the containment
// evidence. Run this file alone on f8ad980 too; no new production imports are needed.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { suite, scripted, withRoot } from "./_harness.mjs";
import { seedProject, seedPrototype, SCREENS, HTML, writeHtml } from "./_fixture.mjs";
import { generate } from "../discovery/prototype/index.mjs";
import { HTML_FILE, PROTOTYPE_FILE, PRD_FILE } from "../discovery/record/index.mjs";
import { PROJECT_FILE, ledgerPath } from "../discovery/setup/index.mjs";
import { rows } from "../shared/agent-call/ledger.mjs";
import { outputContract, validateAgainst } from "../shared/schema/index.mjs";

const { check, done } = suite("discovery-containment · DH1b 1a", 100);
const cap = 1_048_576, model = "writer-containment-sentinel";
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const build = (extra = {}) => ({ screens: SCREENS, uncovered: ["REQ-4"], notes: "", open_questions: [], html: HTML + "<!-- new refused candidate -->", ...extra });
const attempt = async (fn) => { try { return { value: await fn() }; } catch (error) { return { error }; } };
const bytes = (root, file) => existsSync(join(root, file)) ? readFileSync(join(root, file)).toString("base64") : null;
const snapshot = (root) => [PRD_FILE, PROTOTYPE_FILE, HTML_FILE].map((f) => bytes(root, f));
// Only keepOutgoing's history and call ledger may change on refusal, including new files.
const otherFiles = (root, rel = "") => readdirSync(join(root, rel), { withFileTypes: true }).flatMap((d) => {
  const path = join(rel, d.name);
  if (path === "discovery/history" || join(root, path) === ledgerPath(root)) return [];
  return d.isDirectory() ? otherFiles(root, path) : [[path, bytes(root, path)]];
});
const noTmp = (root) => !existsSync(join(root, HTML_FILE + ".tmp"));
const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "../shared/schema/prototype-build.schema.json");

await withRoot({}, async (parent) => {
  const root = seedProject(parent);
  const project = JSON.parse(readFileSync(join(root, PROJECT_FILE), "utf8"));
  writeFileSync(join(root, PROJECT_FILE), JSON.stringify({ ...project, models: { "discovery.writer": model } }));
  // Supply old HTML only here: policy assertions must survive the old runner's throw.
  writeHtml(root);
  const q = scripted({ structured: build() });
  await attempt(() => generate({ root, _query: q.query }));
  const o = q.calls[0]?.options ?? {}, contract = o.outputFormat?.schema;
  check("exactly one builder call at project root", q.calls.length === 1 && o.cwd === root);
  check("compose tools are exactly Read/Glob/Grep", eq(o.tools, ["Read", "Glob", "Grep"]));
  check("allowedTools independently contains only Read/Glob/Grep", eq(o.allowedTools, ["Read", "Glob", "Grep"]));
  check("default permission mode", o.permissionMode === "default");
  check("NotebookEdit remains denied", o.disallowedTools?.includes("NotebookEdit"));
  check("writer-specific project model reaches the wire", o.model === model);
  const ledger = rows(ledgerPath(root));
  check("one ledger call billed as writer at prototype stage", ledger.length === 1 && ledger[0].role === "writer" && ledger[0].stage === "prototype");
  check("wire contract requires string html and is closed", o.outputFormat?.type === "json_schema" && contract?.properties?.html?.type === "string" && contract?.required?.includes("html") && contract?.additionalProperties === false);
  const loaded = await attempt(() => outputContract("prototype-build"));
  check("wire uses prototype-build", !!loaded.value && eq(contract, loaded.value), loaded.error?.message);
  check("mechanics names prototype-build and required /html", /Output contract — `prototype-build`/.test(o.systemPrompt) && /`\/html` \(required\)/.test(o.systemPrompt));
  check("prompt no longer asks the builder to write a project file", !/Write one file/.test(q.calls[0]?.prompt));
  const source = await attempt(() => JSON.parse(readFileSync(schemaPath, "utf8")));
  check("wire schema reuses all four prototype fields by reference", ["screens", "uncovered", "notes", "open_questions"].every((key) => source.value?.properties?.[key]?.$ref === `prototype.schema.json#/properties/${key}`), source.error?.message);
  check("persisted prototype contract has no html", !Object.hasOwn(outputContract("prototype").properties, "html"));
  check("wire contract accepts the control and rejects missing html, wrong type and extras", !!contract && validateAgainst(contract, build()).ok
    && !validateAgainst(contract, (({ html, ...rest }) => rest)(build())).ok
    && !validateAgainst(contract, build({ html: 42 })).ok && !validateAgainst(contract, { ...build(), extra: true }).ok);
});

const refused = async (label, script, code) => withRoot({}, async (parent) => {
  const root = seedProject(parent); seedPrototype(root);
  const before = snapshot(root), tree = otherFiles(root), q = scripted(script);
  const out = await attempt(() => generate({ root, _query: q.query, _sleep: async () => {} }));
  check(`${label}: ${code}`, q.calls.length === 1 && (code === "throw" ? /containment scripted failure/.test(out.error?.message) : out.error?.code === code), out.error?.message ?? "returned successfully");
  check(`${label}: PRD, prototype, HTML and other files unchanged; no tmp`, eq(snapshot(root), before) && eq(otherFiles(root), tree) && noTmp(root));
});
// Higher-priority defects are paired with lower-priority ones to test refusal order.
for (const name of ["Write", "Edit", "Bash", "NotebookEdit"]) for (const target of [PRD_FILE, HTML_FILE]) {
  await refused(`${name} at ${target}`, { structured: target === HTML_FILE ? build() : undefined, toolUses: [{ name, input: { file_path: target, notebook_path: target, command: `echo forbidden > ${target}` } }] }, "wrote");
}
await refused("no structured output", {}, "no-structured-output");
await refused("missing html", { structured: (({ html, ...rest }) => rest)(build()) }, "prototype-invalid");
await refused("invalid shape before blank html", { structured: build({ screens: "invalid", html: " " }) }, "prototype-invalid");
await refused("closed contract", { structured: { ...build(), extra: true } }, "prototype-invalid");
await refused("non-string html", { structured: build({ html: 42 }) }, "prototype-invalid");
await refused("blank before dropped IDs", { structured: build({ html: " \n\t", screens: [] }) }, "no-html");
await refused("blank before size cap", { structured: build({ html: " ".repeat(cap + 1) }) }, "no-html");
await refused("UTF-8 bytes over cap before external URL", { structured: build({ html: '<a href="https://example.test">' + "é".repeat(cap / 2), screens: [] }) }, "html-too-large");
await refused("exactly one UTF-8 byte over cap", { structured: build({ html: "é".repeat(cap / 2) + "x" }) }, "html-too-large");
await refused("external before dropped IDs", { structured: build({ html: '<a href="https://example.test">go</a>', screens: [] }) }, "html-external");
await refused("dropped IDs", { structured: build({ screens: SCREENS.slice(0, 1) }) }, "ids-dropped");
await refused("thrown call", { throwWith: "containment scripted failure" }, "throw");
await refused("failed model result", { resultError: "containment scripted failure" }, "throw");

const external = [
  '<img src="  HtTp://example.test/a">', '<a href=" HTTPS://example.test">x</a>',
  '<form action="ws://example.test">', '<button formaction="wss://example.test">x</button>',
  '<video poster="ftp://example.test/a">', '<img srcset="//example.test/a 1x">',
  '<style>p { background: url( "  https://example.test/a" ); }</style>',
  '<style>@import "https://example.test/a";</style>',
  '<style>@import url(//example.test/a);</style>',
  "<img src='https://example.test/a'>", '<img src=https://example.test/a>',
  '<p style="background:url(https://example.test/a)">x</p>',
];
for (const [i, html] of external.entries()) await refused(`external reference ${i + 1}`, { structured: build({ html }) }, "html-external");

// A unique marker prevents an earlier file from passing as the published result.
const marker = "<!-- DH1b returned HTML: café 🛠 -->\n";
const nearCap = marker + "x".repeat(cap - 1 - Buffer.byteLength(marker));
for (const [label, html, prior] of [
  ["first build", HTML + marker, false], ["replacement", HTML + marker, true],
  ["one UTF-8 byte under cap", nearCap, true], ["exact cap", nearCap + "x", true],
  ["fragment and data URI", '<a href="#local">local</a><img src="data:image/png;base64,AA==">' + marker, true],
  ["plain network text", '<p>https://example.test ws://example.test</p>' + marker, true],
  ["src-looking plain text", '<p>src="https://example.test"</p>' + marker, true],
  ["CSS-url-looking plain text", '<p>url(https://example.test)</p>' + marker, true],
  ["inert data-src attribute", '<div data-src="https://example.test">mock</div>' + marker, true],
  ["HTML comment with network reference", '<!-- <img src="https://example.test"> -->' + marker, true],
]) await withRoot({}, async (parent) => {
  const root = seedProject(parent); if (prior) seedPrototype(root);
  const before = bytes(root, PRD_FILE), old = bytes(root, HTML_FILE), q = scripted({ structured: build({ html }) });
  const out = await attempt(() => generate({ root, _query: q.query }));
  const doc = existsSync(join(root, PROTOTYPE_FILE)) ? JSON.parse(readFileSync(join(root, PROTOTYPE_FILE), "utf8")) : null;
  check(`${label}: publishes exactly returned UTF-8 bytes with sha256`, !!out.value && old !== Buffer.from(html).toString("base64") && bytes(root, HTML_FILE) === Buffer.from(html).toString("base64") && doc?.file_hash === hash(Buffer.from(html)), out.error?.message);
  check(`${label}: persisted and returned records omit html; PRD unchanged; no tmp`, !!out.value && doc && !Object.hasOwn(doc, "html") && !Object.hasOwn(out.value.prototype, "html") && bytes(root, PRD_FILE) === before && noTmp(root));
});
done();
