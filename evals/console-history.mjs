// owns: R10, R15 · discovery — readable kept output, identity and read-only HTTP access.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { request } from "node:http";
import { readFileSync, readdirSync, statSync, utimesSync } from "node:fs";
import { basename, join } from "node:path";
import { suite, withRoot, scripted } from "./_harness.mjs";
import { seedProject, seedPrototype, seedStories, seedDesign, writeHtml } from "./_fixture.mjs";
import { serve, esc } from "../shared/console/index.mjs";
import { routes, nav } from "../discovery/console/index.mjs";
import * as views from "../discovery/console/views.mjs";
import { generate } from "../discovery/prototype/index.mjs";
import { readDoc, saveDoc, keepOutgoing, isSigned, renderPrototype, renderStories, renderDesign, PROTOTYPE_FILE, STORIES_FILE, DESIGN_FILE, HTML_FILE } from "../discovery/record/index.mjs";
const { check, done } = suite("console history", 31);
const kinds = [["prototype", PROTOTYPE_FILE, "prototype", renderPrototype], ["stories", STORIES_FILE, "story", renderStories], ["design", DESIGN_FILE, "design", renderDesign]];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const bytes = (root, file) => readFileSync(join(root, file));
const tree = root => JSON.stringify(readdirSync(root, { recursive: true }).sort().filter(p => statSync(join(root, p)).isFile()).map(p => [p, hash(bytes(root, p))]));
const links = (text, kind) => [...text.matchAll(new RegExp(`href="/artifact/${kind}/history/([^"#?]+)"`, "g"))].map(m => m[1]);
const none = text => /no (?:earlier|history)|none (?:is )?kept|no (?:earlier )?versions? (?:is |are )?kept/i.test(text) || /<h[2-6][^>]*>[^<]*history[^<]*<\/h[2-6]>[^]*?\bnone\b/i.test(text);
const label = (text, doc) => new RegExp(`PRD\\s*(?:v(?:ersion)?\\s*)?${doc.traces.prd.version.replaceAll(".", "\\.")}`, "i").test(text.replace(/<[^>]*>/g, " ")) && text.includes(doc.meta.content_hash.slice(0, 12));
const noIO = () => { throw Error("unexpected external IO"); };
function seed(tmp) { const root = seedProject(tmp); seedPrototype(root); seedStories(root); seedDesign(root); return root; }
async function consoleFor(root, fn) {
  const srv = await serve({ routes: routes({ root, _query: noIO, _exec: noIO, _fetch: noIO, _env: {} }), nav });
  // node:http preserves encoded dot/slash paths; fetch/URL normalization can erase a traversal probe.
  const get = path => new Promise((resolve, reject) => { const req = request(srv.url, { path }, res => { let text = ""; res.setEncoding("utf8"); res.on("data", c => { text += c; }); res.on("end", () => resolve({ status: res.statusCode, text })); }); req.on("error", reject); req.setTimeout(5000, () => req.destroy(Error("history HTTP request timed out"))); req.end(); });
  try { await fn(get); } finally { await srv.close(); }
}
for (const [kind, file, schema, render] of kinds) await withRoot({}, async tmp => {
  const root = seed(tmp);
  await consoleFor(root, async get => { const page = await get(`/artifact/${kind}`); check(`${kind}: first version says none kept`, page.status === 200 && none(page.text) && links(page.text, kind).length === 0); });
  const saved = [];
  if (kind === "prototype") writeHtml(root, "<!doctype html><p>KEPT-HTML-ONLY</p>");
  // Model-free replacements use the same keep/save boundary as the writers; never invent meta.version.
  for (let i = 1; i <= 3; i++) {
    const doc = readDoc(root, file); if (kind === "prototype") doc.file_hash = hash(bytes(root, HTML_FILE)); doc.notes = `Unique ${kind} revision ${i} <safe>`; doc.traces.prd.version = `${[9, 2, 7][i - 1]}.0.0`;
    if (kind === "stories") doc.epics[0].title = doc.notes;
    delete doc.signoff; saveDoc(root, file, schema, doc);
    if (kind === "design") doc.signoff = { by: `Designer ${i}`, at: `2026-10-0${i}T12:00:00.000Z`, content_hash: doc.meta.content_hash, review: { gate: "design-review", verdict: "pass" } };
    saveDoc(root, file, schema, doc);
    const key = basename(keepOutgoing(root, kind, file, kind === "prototype" ? HTML_FILE : undefined));
    saved.push({ key, doc: readDoc(root, file) });
    if (kind === "design") assert(isSigned(saved.at(-1).doc));
    utimesSync(join(root, `discovery/history/${key}.json`), 1000 + i, 1000 + i);
  }
  const [first, second, current] = saved;
  await consoleFor(root, async get => {
    const page = await get(`/artifact/${kind}`), board = await get("/board");
    const view = typeof views.historyView === "function" ? JSON.stringify(views.historyView(root, kind)) : "";
    check(`${kind}: newest mtime first, current whole-file copy excluded`, page.status === 200 && view.includes(first.key) && view.includes(second.key) && JSON.stringify(links(page.text, kind)) === JSON.stringify([second.key, first.key]));
    check(`${kind}: earlier labels show traced PRD, hash and design signer`, [first, second].every(h => { const row = [...page.text.matchAll(/<tr>[^]*?<\/tr>/g)].map(m => m[0]).find(row => row.includes(h.key)) ?? ""; return label(row, h.doc) && (kind !== "design" || row.includes(h.doc.signoff.by)); }));
    const heading = page.text.match(/<h1>[^]*?<\/h1>/)?.[0] ?? "", row = board.text.match(new RegExp(`<tr><td>${kind}</td>[^]*?</tr>`))?.[0] ?? "";
    check(`${kind}: current heading and board use traced PRD label`, label(heading, current.doc) && label(row, current.doc) && (kind !== "design" || heading.includes(current.doc.signoff.by) && row.includes(current.doc.signoff.by)));
    const before = tree(root), old = await get(`/artifact/${kind}/history/${first.key}`);
    check(`${kind}: earlier page renders only kept version, read-only`, old.status === 200 && /earlier version/i.test(old.text) && old.text.includes(esc(render(first.doc, { file: false }))) && !old.text.includes(esc(current.doc.notes)) && !/<form\b|\baction\s*=/i.test(old.text) && tree(root) === before);
    if (kind === "prototype") check("kept prototype never points at or embeds HTML", old.status === 200 && !old.text.includes("KEPT-HTML-ONLY") && !old.text.includes(HTML_FILE) && !old.text.includes(first.key + ".html") && !old.text.includes(bytes(root, `discovery/history/${first.key}.html`).toString()) && !/<iframe\b/i.test(old.text) && (await get(`/artifact/prototype/history/${first.key}.html`)).status === 404);
    for (const h of [first, second]) utimesSync(join(root, `discovery/history/${h.key}.json`), 2000, 2000);
    check(`${kind}: equal mtimes use ascending key order`, JSON.stringify(links((await get(`/artifact/${kind}`)).text, kind)) === JSON.stringify([first.key, second.key].sort()));
  });
});
for (const [kind, file, schema] of kinds) await withRoot({}, async tmp => {
  const root = seed(tmp), saved = [];
  for (let i = 1; i <= 3; i++) { const doc = readDoc(root, file); doc.traces.prd.version = `${i}.0.0`; saveDoc(root, file, schema, doc); saved.push({ key: basename(keepOutgoing(root, kind, file)), hash: readDoc(root, file).meta.content_hash }); }
  assert.equal(new Set(saved.map(h => h.hash)).size, 1); assert.equal(new Set(saved.map(h => h.key)).size, 3);
  await consoleFor(root, async get => { const keys = links((await get(`/artifact/${kind}`)).text, kind); check(`${kind}: equal content with different traces remains history`, keys.length === 2 && saved.slice(0, 2).every(h => keys.includes(h.key)) && !keys.includes(saved[2].key)); });
});
await withRoot({}, async tmp => {
  const root = seed(tmp), saved = bytes(root, PROTOTYPE_FILE), q = scripted({ resultError: "scripted history failure" });
  let error; try { await generate({ root, _query: q.query, _sleep: async () => {} }); } catch (e) { error = e; }
  const key = `prototype-${hash(saved).slice(0, 12)}`;
  assert.match(error?.message ?? "", /scripted history failure/); assert.equal(q.calls.length, 1); assert.deepEqual(bytes(root, PROTOTYPE_FILE), saved); assert.deepEqual(bytes(root, `discovery/history/${key}.json`), saved);
  await consoleFor(root, async get => { const page = await get("/artifact/prototype"); check("failed rebuild's identical outgoing copy is not earlier history", page.status === 200 && links(page.text, "prototype").length === 0 && none(page.text) && (await get(`/artifact/prototype/history/${key}`)).status === 404); });
});
await withRoot({}, async tmp => {
  const root = seed(tmp), storyKey = basename(keepOutgoing(root, "stories", STORIES_FILE));
  const story = readDoc(root, STORIES_FILE); story.notes = "New current stories"; saveDoc(root, STORIES_FILE, "story", story);
  await consoleFor(root, async get => {
    const before = tree(root);
    for (const key of [storyKey, "prototype-000000000000", "%2Fetc%2Fpasswd", "%2E%2E%2Fprd", "%252E%252E%252Fprd"]) { const r = await get(`/artifact/prototype/history/${key}`); check(`HTTP rejects unlisted or encoded key ${key}`, r.status === 404 && tree(root) === before); }
    // A standalone dot segment normalizes before matching: it safely opens the current artifact.
    const current = await get("/artifact/prototype/"), normalized = await get("/artifact/prototype/history/%2E%2E");
    check("HTTP normalized dot segment opens only the current artifact", current.status === 200 && normalized.status === 200 && normalized.text === current.text && tree(root) === before);
    const prd = await get("/artifact/prd"); check("PRD exposes no kept-version links", prd.status === 200 && !/href="[^\"]*\/history\//.test(prd.text));
  });
  const before = tree(root); let result;
  try { result = typeof views.historyView === "function" && views.historyView(root, "prototype"); } catch {}
  check("historyView reads without record writes", Boolean(result) && tree(root) === before);
});
done();
