#!/usr/bin/env node
// owns: R3, R4, R14 · shared — D05: freshness gates and byte-keyed outgoing history.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { suite, scripted, withRoot } from "./_harness.mjs";
import { seedProject, seedPrototype, seedStories, seedDesign, refresh, writeHtml, HTML, SCREENS, EPICS, STORIES, DESIGN } from "./_fixture.mjs";
import { loadPrd, savePrd } from "../discovery/workshop/index.mjs";
import * as doors from "../discovery/doors/index.mjs";
import { generate } from "../discovery/prototype/index.mjs";
import { write } from "../discovery/stories/index.mjs";
import { write as writeDesign, review, signoff } from "../discovery/design/index.mjs";
import { readiness, exportHandoff, renderHandoff, EXITS } from "../discovery/export/index.mjs";
import { Refused, readDoc, saveDoc, staleness, PRD_FILE, PROTOTYPE_FILE, STORIES_FILE, DESIGN_FILE, HTML_FILE } from "../discovery/record/index.mjs";

const { check, done } = suite("discovery-readiness · D05 exits and outgoing history", 78);
const bytes = (root, file) => readFileSync(join(root, file), "utf8");
const hash = (s) => createHash("sha256").update(s).digest("hex");
const attempt = async (fn) => { try { return { value: await fn() }; } catch (error) { return { error }; } };
const noService = () => { throw new Error("unexpected external service"); };
const go = (root, exit) => attempt(() => exportHandoff({ root, exit, by: "PM", _exec: noService, _fetch: noService, _env: {} }));
const allowed = async (root) => { const results = []; for (const exit of EXITS) results.push(await go(root, exit)); return results.every((r) => r.value); };
const finding = (root, rule, subject, remedy, mode) => {
  const f = readiness(root).findings.find((f) => f.rule === rule);
  check(`${mode}: ${rule}: high, certain, subject and next step`, f?.severity === "high" && f.confidence === "certain" && f.subject === subject && f.remedy !== f.summary && remedy.every((r) => r.test(f.remedy)), JSON.stringify(f));
};
const designMarkdown = (root, out, stale, label) => {
  const md = out.value ? bytes(root, out.value.rendering) : "", status = md.split("\n").filter((line) => /design:|^## Design/i.test(line));
  check(`${label}: saved Markdown retains signature and ${stale ? "warns of stale design with recovery" : "shows current design"}`,
    status.length === 2 && status.every((line) => /signed by Designer/.test(line) && /\bstale\b/i.test(line) === stale)
    && (!stale || md.split(/\n\s*\n/).some((p) => /(?:regenerate|rebuild|rewrite|refresh)[^.]*design/i.test(p) && /\breview\b/i.test(p) && /\bsign(?:off)?\b/i.test(p))));
  return md;
};
const snapshots = (root) => {
  const dir = join(root, "discovery", "handoffs");
  return existsSync(dir) ? JSON.stringify(readdirSync(dir).sort().map((file) => [file, bytes(dir, file)])) : "[]";
};
const blocked = async (root, rule, exits = EXITS) => {
  for (const exit of exits) {
    const before = bytes(root, PRD_FILE), handoffs = snapshots(root), out = await go(root, exit);
    check(`${exit} refuses ${rule} without exporting`, out.error instanceof Refused && out.error.code === "not-ready"
      && out.error.detail?.some((f) => f.rule === rule) && bytes(root, PRD_FILE) === before && snapshots(root) === handoffs, out.error?.message ?? "export succeeded");
  }
};
const movePrd = (root) => { const p = loadPrd(root); p.problem.crux += " at night"; savePrd(root, p); };
const backlog = () => scripted({ structured: { epics: EPICS, stories: STORIES, notes: "", open_questions: [] } });
const rebuild = async (root, screens = SCREENS, html = HTML, before = () => {}) => {
  const q = scripted({ structured: { screens, uncovered: ["REQ-4"], notes: "", open_questions: [] } });
  await generate({ root, _query: (args) => { before(); writeHtml(root, html); return q.query(args); } });
};
const setup = async (parent) => {
  const root = seedProject(parent); seedPrototype(root); seedStories(root); seedDesign(root);
  await review({ root, _query: scripted({ structured: { findings: [], deferred: [], checked: 2, skipped: 0 } }).query });
  signoff(root, { by: "Designer" });
  return root;
};

await withRoot({}, async (parent) => {
  const root = seedProject(parent); seedPrototype(root);
  finding(root, "no-agreement", loadPrd(root).id, [/\bagree\b/i], "prototype only");
  doors.agree({ root, by: "PM" });
  check("prototype only: agreement clears the finding without stories", !readDoc(root, STORIES_FILE) && !readiness(root).findings.some((f) => /agreement/.test(f.rule)));
});

for (const mode of ["none", "prd", "prototype"]) await withRoot({}, async (parent) => {
  const root = await setup(parent), original = loadPrd(root), proto = readDoc(root, PROTOTYPE_FILE);
  if (mode !== "none") doors.agree({ root, by: "PM" });
  if (mode === "prd") movePrd(root);
  if (mode === "prototype") { proto.screens[0].name += " revised"; saveDoc(root, PROTOTYPE_FILE, "prototype", proto); }
  const rule = mode === "none" ? "no-agreement" : "agreement-stale";
  finding(root, rule, original.id, [/\bagree\b/i, ...(mode === "prd" ? [/\b(rebuild|regenerate|refresh)\b[^.]*\bprototype\b/i] : [])], mode);
  const q = backlog(), before = bytes(root, STORIES_FILE), out = await attempt(() => write({ root, _query: q.query }));
  check(`${mode}: write shares the agreement rule before any call`, out.error instanceof Refused && out.error.code === rule && q.calls.length === 0 && bytes(root, STORIES_FILE) === before);
  await blocked(root, rule);
  await refresh(root);
  check(`${mode}: refresh permits every exit`, await allowed(root));
});

for (const source of ["prd", "prototype"]) await withRoot({}, async (parent) => {
  const root = await setup(parent); doors.agree({ root, by: "PM" });
  const old = readDoc(root, STORIES_FILE);
  if (source === "prd") { movePrd(root); await rebuild(root); }
  else { const p = readDoc(root, PROTOTYPE_FILE); p.screens[0].name += " revised"; saveDoc(root, PROTOTYPE_FILE, "prototype", p); }
  doors.agree({ root, by: "PM" });
  finding(root, "stories-stale", old.id, [/\b(rewrite|write|regenerate|refresh)\b[^.]*\b(stories|backlog)\b/i], source);
  check(`${source}: stable story ids and labels do not imply freshness`, bytes(root, STORIES_FILE) === JSON.stringify(old, null, 2) + "\n" && staleness(root).stories.stale);
  await blocked(root, "stories-stale");
  await refresh(root);
  check(`${source}: current stories unblock all exits`, await allowed(root));
});

await withRoot({}, async (parent) => {
  const root = await setup(parent); doors.agree({ root, by: "PM" });
  const oldDesign = bytes(root, DESIGN_FILE);
  movePrd(root); await rebuild(root); doors.agree({ root, by: "PM" }); await write({ root, _query: backlog().query });
  finding(root, "design-stale", readDoc(root, DESIGN_FILE).id, [/\b(regenerate|rebuild|rewrite|refresh)\b[^.]*\bdesign\b/i], "prd");
  await blocked(root, "design-stale", ["delivery", "both"]);
  const team = await go(root, "team");
  check("team carries the old design with stale trace evidence", !!team.value && bytes(root, DESIGN_FILE) === oldDesign
    && JSON.stringify(team.value.handoff.design) === JSON.stringify(JSON.parse(oldDesign)) && staleness(root).design.stale
    && team.value.handoff.design.traces.prd.content_hash !== team.value.handoff.contract.prd.content_hash);
  designMarkdown(root, team, true, "prd");
  await rebuild(root, [...SCREENS, { ...SCREENS[0], id: "SCREEN-3", name: "Night shift" }]);
  const claimed = structuredClone(STORIES); claimed[0].screen_refs.push("SCREEN-3");
  doors.agree({ root, by: "PM" });
  await write({ root, _query: scripted({ structured: { epics: EPICS, stories: claimed, notes: "", open_questions: [] } }).query });
  check("SCREEN-3 setup retains the old design", bytes(root, DESIGN_FILE) === oldDesign);
  await blocked(root, "screen-undesigned");
});

for (const source of ["prototype", "stories"]) await withRoot({}, async (parent) => {
  const root = await setup(parent); doors.agree({ root, by: "PM" });
  const old = bytes(root, DESIGN_FILE);
  if (source === "prototype") {
    const proto = readDoc(root, PROTOTYPE_FILE); proto.screens[0].name += " revised";
    saveDoc(root, PROTOTYPE_FILE, "prototype", proto); doors.agree({ root, by: "PM" });
    await write({ root, _query: backlog().query });
  } else {
    const stories = structuredClone(STORIES); stories[0].statement += " At night.";
    await write({ root, _query: scripted({ structured: { epics: EPICS, stories, notes: "", open_questions: [] } }).query });
  }
  finding(root, "design-stale", readDoc(root, DESIGN_FILE).id, [/\b(regenerate|rebuild|rewrite|refresh)\b[^.]*\bdesign\b/i], source);
  await blocked(root, "design-stale", ["delivery", "both"]);
  const team = await go(root, "team");
  check(`${source}: team accepts stale design without rewriting it`, !!team.value && bytes(root, DESIGN_FILE) === old);
  const savedMarkdown = designMarkdown(root, team, true, source);
  await refresh(root);
  check(`${source}: old handoff rendering stays stale after live design refresh`, !!team.value && renderHandoff(team.value.handoff) === savedMarkdown);
  check(`${source}: refreshed design permits all exits`, await allowed(root));
});

await withRoot({}, async (parent) => {
  const root = await setup(parent); doors.agree({ root, by: "PM" });
  designMarkdown(root, await go(root, "team"), false, "current");
  const old = [PRD_FILE, PROTOTYPE_FILE, STORIES_FILE, DESIGN_FILE].map((file) => bytes(root, file));
  for (const [file, kind] of [[PRD_FILE, "prd"], [PROTOTYPE_FILE, "prototype"], [STORIES_FILE, "story"]]) {
    const doc = readDoc(root, file);
    if (kind === "prd") doc.meta.version = "99.0.0"; else doc.traces.prd.version = "99.0.0";
    if (kind === "prd") savePrd(root, doc); else saveDoc(root, file, kind, doc);
  }
  check("changed bytes and version labels leave content current", old.slice(0, 3).every((s, i) => s !== bytes(root, [PRD_FILE, PROTOTYPE_FILE, STORIES_FILE][i]))
    && !readiness(root).findings.some((f) => /stale|agreement/.test(f.rule)) && !staleness(root).design.stale);
  check("content-only freshness permits every exit", await allowed(root));
  const q = backlog(); await write({ root, _query: q.query });
  check("write also accepts byte-only changes under the agreement", q.calls.length === 1);
});

const archive = (kind, saved) => `discovery/history/${kind}-${hash(saved).slice(0, 12)}.json`;
const kept = (root, file, saved) => existsSync(join(root, file)) && bytes(root, file) === saved;
await withRoot({}, async (parent) => {
  const root = seedProject(parent); seedPrototype(root); doors.agree({ root, by: "PM" }); seedStories(root); seedDesign(root);
  const stories = bytes(root, STORIES_FILE), design = bytes(root, DESIGN_FILE), prd = bytes(root, PRD_FILE);
  check("history control: current backlog and unsigned current design", !staleness(root).stories.stale && !staleness(root).design.stale && !readDoc(root, DESIGN_FILE).signoff);
  const writer = backlog(); await write({ root, _query: writer.query });
  check("current stories are archived under an unchanged agreement", writer.calls.length === 1 && bytes(root, PRD_FILE) === prd && kept(root, archive("stories", stories), stories));
  const designer = scripted({ structured: DESIGN }); await writeDesign({ root, _query: designer.query });
  check("unsigned current design is archived on rewrite", designer.calls.length === 1 && kept(root, archive("design", design), design));
});
await withRoot({}, async (parent) => {
  const root = await setup(parent); doors.agree({ root, by: "PM" });
  const first = [STORIES_FILE, DESIGN_FILE].map((f) => bytes(root, f));
  movePrd(root); await refresh(root);
  const second = [STORIES_FILE, DESIGN_FILE].map((f) => bytes(root, f));
  movePrd(root); await refresh(root);
  for (const [i, kind] of ["stories", "design"].entries()) {
    check(`${kind}: D05 refresh retains the outgoing bytes`, kept(root, archive(kind, first[i]), first[i]));
    check(`${kind}: equal content, distinct traces have distinct whole-file keys`, JSON.parse(first[i]).meta.content_hash === JSON.parse(second[i]).meta.content_hash
      && hash(first[i]) !== hash(second[i]) && hash(first[i]) !== JSON.parse(first[i]).meta.content_hash);
    check(`${kind}: both outgoing copies survive the second refresh`, kept(root, archive(kind, first[i]), first[i]) && kept(root, archive(kind, second[i]), second[i]));
  }
});
await withRoot({}, async (parent) => {
  const root = await setup(parent), saved = bytes(root, PROTOTYPE_FILE), html = bytes(root, HTML_FILE);
  const jsonPath = archive("prototype", saved), htmlPath = jsonPath.replace(/\.json$/, ".html");
  let beforeCall = false;
  await rebuild(root, SCREENS, HTML + "<!-- new build -->", () => {
    beforeCall = kept(root, jsonPath, saved) && kept(root, htmlPath, html);
  });
  check("prototype JSON/HTML pair is archived before the builder overwrites HTML", beforeCall);
  check("archived HTML matches the outgoing record file_hash", kept(root, jsonPath, saved) && kept(root, htmlPath, html)
    && hash(bytes(root, htmlPath)) === JSON.parse(saved).file_hash && bytes(root, HTML_FILE) !== html);
});
for (const failure of ["ids-dropped", "model-error"]) await withRoot({}, async (parent) => {
  const root = seedProject(parent); seedPrototype(root);
  const saved = bytes(root, PROTOTYPE_FILE), html = bytes(root, HTML_FILE), jsonPath = archive("prototype", saved), htmlPath = jsonPath.replace(/\.json$/, ".html");
  const failedHtml = HTML + `<!-- ${failure} -->`, q = scripted(failure === "model-error" ? { resultError: "scripted model failure" }
    : { structured: { screens: SCREENS.slice(0, 1), uncovered: ["REQ-4"], notes: "", open_questions: [] } });
  const failed = await attempt(() => generate({ root, _sleep: async () => {}, _query: (args) => { writeHtml(root, failedHtml); return q.query(args); } }));
  check(`${failure}: failed builder overwrote HTML but retained the outgoing record`, q.calls.length === 1 && bytes(root, HTML_FILE) === failedHtml && bytes(root, PROTOTYPE_FILE) === saved
    && (failure === "ids-dropped" ? failed.error instanceof Refused && failed.error.code === failure : /scripted model failure/.test(failed.error?.message)));
  check(`${failure}: failed build already preserved the original pair`, kept(root, jsonPath, saved) && kept(root, htmlPath, html));
  await rebuild(root, SCREENS, HTML + "<!-- successful retry -->");
  const files = existsSync(join(root, "discovery/history")) ? readdirSync(join(root, "discovery/history")).sort() : [];
  check(`${failure}: retry keeps exactly the original hash-matched pair`, kept(root, jsonPath, saved) && kept(root, htmlPath, html)
    && hash(bytes(root, htmlPath)) === JSON.parse(saved).file_hash && JSON.stringify(files) === JSON.stringify([jsonPath, htmlPath].map((p) => p.split("/").at(-1)).sort()));
});
for (const prior of [false, true]) await withRoot({}, async (parent) => {
  const root = seedProject(parent); if (prior) { seedPrototype(root); unlinkSync(join(root, HTML_FILE)); }
  const saved = prior ? bytes(root, PROTOTYPE_FILE) : null, out = await attempt(() => rebuild(root));
  const dir = join(root, "discovery/history"), files = existsSync(dir) ? readdirSync(dir) : [];
  check(`${prior ? "missing HTML" : "first build"}: succeeds with ${prior ? "JSON-only history" : "no history"}`, !out.error && !!readDoc(root, PROTOTYPE_FILE)
    && (prior ? files.length === 1 && kept(root, archive("prototype", saved), saved) : files.length === 0), out.error?.message);
});
done();
