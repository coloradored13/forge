#!/usr/bin/env node
// owns: R3, R4, R14 · shared — D05: freshness gates and byte-keyed outgoing history.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { suite, scripted, withRoot } from "./_harness.mjs";
import { seedProject, seedPrototype, seedStories, seedDesign, refresh, writeHtml, HTML, SCREENS, EPICS, STORIES } from "./_fixture.mjs";
import { loadPrd, savePrd } from "../discovery/workshop/index.mjs";
import * as doors from "../discovery/doors/index.mjs";
import { generate } from "../discovery/prototype/index.mjs";
import { write } from "../discovery/stories/index.mjs";
import { review, signoff } from "../discovery/design/index.mjs";
import { readiness, exportHandoff, EXITS } from "../discovery/export/index.mjs";
import { Refused, readDoc, saveDoc, staleness, PRD_FILE, PROTOTYPE_FILE, STORIES_FILE, DESIGN_FILE, HTML_FILE } from "../discovery/record/index.mjs";

const { check, done } = suite("discovery-readiness · D05 exits and outgoing history", 59);
const bytes = (root, file) => readFileSync(join(root, file), "utf8");
const hash = (s) => createHash("sha256").update(s).digest("hex");
const attempt = async (fn) => { try { return { value: await fn() }; } catch (error) { return { error }; } };
const noService = () => { throw new Error("unexpected external service"); };
const go = (root, exit) => attempt(() => exportHandoff({ root, exit, by: "PM", _exec: noService, _fetch: noService, _env: {} }));
const allowed = async (root) => { const results = []; for (const exit of EXITS) results.push(await go(root, exit)); return results.every((r) => r.value); };
const finding = (root, rule, subject, remedy) => {
  const f = readiness(root).findings.find((f) => f.rule === rule);
  check(`${rule}: high, certain, subject and next step`, f?.severity === "high" && f.confidence === "certain" && f.subject === subject && remedy.test(f.remedy), JSON.stringify(f));
};
const blocked = async (root, rule, exits = EXITS) => {
  for (const exit of exits) {
    const before = bytes(root, PRD_FILE), out = await go(root, exit);
    check(`${exit} refuses ${rule} without exporting`, out.error instanceof Refused && out.error.code === "not-ready"
      && out.error.detail?.some((f) => f.rule === rule) && bytes(root, PRD_FILE) === before, out.error?.message ?? "export succeeded");
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

for (const mode of ["none", "prd", "prototype"]) await withRoot({}, async (parent) => {
  const root = await setup(parent), original = loadPrd(root), proto = readDoc(root, PROTOTYPE_FILE);
  if (mode !== "none") doors.agree({ root, by: "PM" });
  if (mode === "prd") movePrd(root);
  if (mode === "prototype") { proto.screens[0].name += " revised"; saveDoc(root, PROTOTYPE_FILE, "prototype", proto); }
  const rule = mode === "none" ? "no-agreement" : "agreement-stale";
  finding(root, rule, original.id, /agree/i);
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
  finding(root, "stories-stale", old.id, /writ|regenerat/i);
  check(`${source}: stable story ids and labels do not imply freshness`, bytes(root, STORIES_FILE) === JSON.stringify(old, null, 2) + "\n" && staleness(root).stories.stale);
  await blocked(root, "stories-stale");
  await refresh(root);
  check(`${source}: current stories unblock all exits`, await allowed(root));
});

await withRoot({}, async (parent) => {
  const root = await setup(parent); doors.agree({ root, by: "PM" });
  const oldDesign = bytes(root, DESIGN_FILE);
  movePrd(root); await rebuild(root); doors.agree({ root, by: "PM" }); await write({ root, _query: backlog().query });
  finding(root, "design-stale", readDoc(root, DESIGN_FILE).id, /design/i);
  await blocked(root, "design-stale", ["delivery", "both"]);
  const team = await go(root, "team");
  check("team carries the old design with stale trace evidence", !!team.value && bytes(root, DESIGN_FILE) === oldDesign
    && JSON.stringify(team.value.handoff.design) === JSON.stringify(JSON.parse(oldDesign)) && staleness(root).design.stale
    && team.value.handoff.design.traces.prd.content_hash !== team.value.handoff.contract.prd.content_hash);
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
  finding(root, "design-stale", readDoc(root, DESIGN_FILE).id, /design/i);
  await blocked(root, "design-stale", ["delivery", "both"]);
  check(`${source}: team accepts stale design without rewriting it`, !!(await go(root, "team")).value && bytes(root, DESIGN_FILE) === old);
  await refresh(root);
  check(`${source}: refreshed design permits all exits`, await allowed(root));
});

await withRoot({}, async (parent) => {
  const root = await setup(parent); doors.agree({ root, by: "PM" });
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
done();
