// owns: R10, R14, R15 · shared — Discovery refusal/recovery views and files-only console exports.
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { suite, withRoot, scripted } from "./_harness.mjs";
import { seedProject, seedPrototype, seedStories, seedDesign, DESIGN } from "./_fixture.mjs";
import { serve, refusalHtml, esc } from "../shared/console/index.mjs";
import { routes, nav } from "../discovery/console/index.mjs";
import { routes as deliveryRoutes } from "../delivery/console/index.mjs";
import { exportView } from "../discovery/console/views.mjs";
import { loadPrd, savePrd } from "../discovery/workshop/index.mjs";
import { agree, answer, propose } from "../discovery/doors/index.mjs";
import { review, signoff } from "../discovery/design/index.mjs";
import { exportHandoff, readiness, EXITS } from "../discovery/export/index.mjs";
import { readDoc, saveDoc, Refused, PROTOTYPE_FILE, STORIES_FILE, DESIGN_FILE } from "../discovery/record/index.mjs";
import { latestHandoff } from "../shared/handoff.mjs";
import { load } from "../shared/schema/index.mjs";
const { check, done } = suite("console handoff", 59);
const clean = () => scripted({ structured: { findings: [], deferred: [], checked: 2, skipped: 0 } }).query;
const noIO = () => { throw new Error("unexpected external IO"); };
const safe = { _exec: noIO, _fetch: noIO, _env: {} };
const refused = fn => Promise.resolve().then(fn).then(() => null, e => e);
async function ready(tmp) {
  const root = seedProject(tmp); seedPrototype(root); agree({ root, by: "PM" }); seedStories(root); seedDesign(root);
  await review({ root, _query: clean() }); signoff(root, { by: "Designer" }); return root;
}
async function consoleFor(root, fn, seams = safe, injected) {
  const srv = await serve({ routes: [...routes({ root, _query: clean(), ...seams }).map(r => r.path === injected?.path ? { ...r, handler: () => { throw injected.error; } } : r), ...deliveryRoutes({ root, _query: clean() })], nav });
  const get = async path => { const r = await fetch(srv.url + path); return { status: r.status, text: await r.text() }; };
  const post = async (path, fields = {}) => {
    const body = new URLSearchParams(); for (const [key, value] of Object.entries(fields)) for (const v of [].concat(value)) body.append(key, v);
    const r = await fetch(srv.url + path, { method: "POST", headers: { Origin: srv.url }, body, redirect: "manual" });
    return { status: r.status, text: await r.text(), location: r.headers.get("location") };
  };
  try { return await fn({ get, post }); } finally { await srv.close(); }
}
await withRoot({}, async tmp => {
  const root = await ready(tmp);
  await consoleFor(root, async ({ post }) => {
    for (const [path, back] of [["/workshop/open", "/workshop"], ["/design/signoff", "/board"], ...["answer", "propose", "approve", "agree", "reject"].map(n => [`/doors/${n}`, "/board"]), ["/export", "/export"]]) {
      const r = await post(path);
      check(`${path} refusal returns to its form view`, r.status === 409 && r.text.includes(`href="${back}">Back</a>`) && !r.text.includes('href="javascript:history.back()"') && r.text.includes('class="refusal"'), r.text);
    }
    const r = await post("/run/setup");
    check("Delivery refusal without a declared view retains history.back", r.status === 409 && r.text.includes('href="javascript:history.back()">Back</a>'), r.text);
  });
});
for (const kind of ["not-ready", "arithmetic-blocked", "review-blocked", "audit-blocked"]) await withRoot({}, async tmp => {
  const root = await ready(tmp); let path, fields, call, injected;
  if (kind === "not-ready") {
    answer({ root, req: "REQ-1", oq: "OQ-1", answer: "Only until the shift ends.", by: "PM" });
    path = "/export"; fields = { exit: "team", by: "PM" }; call = () => exportHandoff({ root, ...fields, ...safe });
  } else if (kind === "audit-blocked") {
    const { audit } = propose({ root, target: "/problem/crux", to: "Teleportation", rationale: "Test vocabulary audit", by: "PM" });
    // Today's audit emits only medium findings (advise), so exercise this refusal's
    // documented shape at the route boundary without inventing a new blocking rule.
    path = "/doors/approve"; fields = {}; injected = new Refused("audit-blocked", "approve: seeded audit refusal", audit);
    call = () => { throw injected; };
  } else {
    if (kind === "arithmetic-blocked") seedDesign(root, { ...DESIGN, screens: [DESIGN.screens[0]] });
    else await review({ root, _query: scripted({ structured: { findings: [{ severity: "high", confidence: "certain", rule: "standard-not-kept", subject: "SCREEN-1", summary: "Wrong emphasis", evidence: "Record button", remedy: "Restore the declared emphasis <safely>." }], deferred: [], checked: 1, skipped: 0 } }).query });
    path = "/design/signoff"; fields = { by: "Designer" }; call = () => signoff(root, fields);
  }
  const e = await refused(call), findings = Array.isArray(e?.detail) ? e.detail : e?.detail?.findings;
  await consoleFor(root, async ({ post }) => {
    const r = await post(path, fields);
    check(`${kind} shows actual findings and remedies`, e?.code === kind && findings?.length > 0 && r.status === 409 && r.text.includes('class="refusal"') && findings.every(f => r.text.includes(esc(f.rule)) && r.text.includes(esc(f.summary)) && (!f.remedy || r.text.includes(esc(f.remedy)))), r.text);
  }, safe, injected ? { path, error: injected } : undefined);
});
check("non-finding object detail remains hidden", !refusalHtml(new Refused("example", "Refused", { internal: "DO-NOT-RENDER" })).includes("DO-NOT-RENDER"));
await withRoot({}, async tmp => {
  const detail = { findings: [{ severity: "high", confidence: "certain", rule: "delivery-test", subject: "STORY-1", summary: "Seeded failure", evidence: "Seeded evidence", remedy: "Repair the seeded Delivery finding." }] };
  const srv = await serve({ routes: [{ method: "GET", path: "/delivery-fixture", handler: () => { throw new Refused("blocked", "Delivery fixture", detail); } }] });
  try { const r = await fetch(srv.url + "/delivery-fixture"), text = await r.text(); check("shared renderer handles finding objects on routes without a Discovery view", r.status === 409 && text.includes(detail.findings[0].remedy) && text.includes('class="refusal"') && text.includes("history.back()")); } finally { await srv.close(); }
});
for (const [file, code, message] of [[PROTOTYPE_FILE, "no-prototype", "export: there is no prototype — generate one on the board first"], [STORIES_FILE, "no-stories", "export: there is no backlog to hand off — write the stories on the board first"]]) await withRoot({}, async tmp => {
  const root = await ready(tmp); rmSync(join(root, file)); const e = await refused(() => exportHandoff({ root, exit: "team", by: "PM", ...safe }));
  check(`${code} names the recovery`, e?.code === code && e.message === message, e?.message);
});
await withRoot({}, async tmp => {
  const root = await ready(tmp); answer({ root, req: "REQ-1", oq: "OQ-1", answer: "Until the shift ends.", by: "PM" });
  const findings = readiness(root).findings;
  await consoleFor(root, async ({ get }) => {
    const { text } = await get("/board");
    for (const kind of ["stories", "design"]) {
      const row = text.match(new RegExp(`<tr><td>${kind}</td>[\\s\\S]*?</tr>`))?.[0] ?? "", f = findings.find(f => f.rule === `${kind}-stale`);
      check(`${kind} stale row uses the readiness remedy`, Boolean(f?.remedy) && row.includes("stale") && row.includes(esc(f.remedy)), row);
    }
  });
});
const states = ["ready", "stale-design", "unsigned", "no-stories", "no-prototype", "no-design"];
for (const state of states) for (const exit of EXITS) await withRoot({}, async tmp => {
  const root = await ready(tmp);
  if (state.startsWith("no-")) rmSync(join(root, { "no-stories": STORIES_FILE, "no-prototype": PROTOTYPE_FILE, "no-design": DESIGN_FILE }[state]));
  if (state === "unsigned") { const d = readDoc(root, DESIGN_FILE); delete d.signoff; saveDoc(root, DESIGN_FILE, "design", d); }
  if (state === "stale-design") { const s = readDoc(root, STORIES_FILE); s.stories[0].statement += " at the door"; saveDoc(root, STORIES_FILE, "story", s); }
  const allowed = state === "ready" || (exit === "team" && ["stale-design", "unsigned", "no-design"].includes(state));
  const view = exportView(root), v = view.readinessByExit?.[exit];
  const code = { "stale-design": "design-stale", unsigned: "design-unsigned" }[state] ?? state;
  await consoleFor(root, async ({ get }) => {
    const page = await get("/export"), e = await refused(() => exportHandoff({ root, exit, by: "PM", ...safe }));
    const visible = page.text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
    const labels = [...visible.matchAll(/\b(team|delivery|both)\s*(?:[:—-]\s*)?(?:export-ready\s*:\s*)?(pass|block)\b/gi)];
    const i = labels.findIndex(m => m[1].toLowerCase() === exit), label = labels[i];
    const section = label ? visible.slice(label.index, labels[i + 1]?.index) : "";
    const expectedCode = state === "stale-design" ? "not-ready" : code;
    const properRefusal = e instanceof Refused && (e.code === expectedCode || e.code === "not-ready" && e.detail?.some?.(f => f.rule === code));
    check(`${state}: ${exit} view and door agree`, label?.[2].toLowerCase() === (allowed ? "pass" : "block") && page.status === 200 && v?.verdict === (allowed ? "pass" : "block") && (allowed ? !e : properRefusal) && (allowed || (v.findings.some(f => f.rule === code) && v.findings.every(f => f.remedy && section.includes(esc(f.remedy))))), JSON.stringify({ v, code: e?.code }));
  });
});
await withRoot({}, async tmp => { const root = await ready(tmp); check("exportView retains readiness", JSON.stringify(exportView(root).readiness) === JSON.stringify(readiness(root))); });
for (const exit of EXITS) for (const mode of ["door-false", "console", "smuggled", "undefined"]) await withRoot({}, async tmp => {
  const root = await ready(tmp), calls = []; let number = 0;
  const seams = { _env: {}, _fetch: (...args) => { calls.push(["fetch", ...args]); throw Error("unexpected fetch"); }, _exec: (cmd, args) => { calls.push([cmd, ...args]); assert.equal(cmd, "gh"); return args[2] === "POST" ? JSON.stringify({ number: ++number }) : ""; } };
  const prior = await exportHandoff({ root, exit: "team", by: "PM", tracker: { kind: "github", repo: "acme/dock" }, ...seams });
  assert(calls.length > 0); const old = readFileSync(join(root, prior.file), "utf8"), keys = structuredClone(prior.handoff.tracker); calls.length = 0;
  let error, status;
  if (mode === "console" || mode === "smuggled") await consoleFor(root, async ({ post }) => { status = (await post("/export", { exit, by: "PM", ...(mode === "smuggled" ? { tracker: "github", repo: "other/repo" } : {}) })).status; }, seams);
  else error = await refused(() => exportHandoff({ root, exit, by: "PM", tracker: mode === "door-false" ? false : undefined, ...seams }));
  const last = latestHandoff(root), md = readFileSync(join(root, `discovery/handoffs/handoff-v${last.version}.md`), "utf8");
  check(`${exit} ${mode}: tracker semantics and prior keys preserved`, !error && (status === undefined || status === 303) && last.version === 2 && last.exit === exit && calls.length === 0 && readFileSync(join(root, prior.file), "utf8") === old && (mode === "undefined" ? JSON.stringify(last.tracker) === JSON.stringify(keys) : last.tracker === null && md.includes("Tracker: none — these files are the handoff")), JSON.stringify({ status, error: error?.code, tracker: last.tracker, calls: calls.length }));
});
await withRoot({}, async tmp => {
  const root = await ready(tmp); const proposal = propose({ root, target: "/problem/crux", to: "recording at the door", rationale: "Keep it simple", by: "PM" }).amendment;
  let board, view;
  await consoleFor(root, async ({ get }) => {
    const page = await get("/export");
    check("tracker controls hidden with availability and design explanation", !/\bname\s*=\s*["']?(?:tracker|repo|site|project|ideas)(?=["'\s>])/i.test(page.text) && /tracker sync[^<]*(?:not|isn't|isn&#39;t|unavailable)/i.test(page.text) && page.text.includes("The design is") && page.text.includes("Delivery and both need it signed"), page.text);
    board = (await get("/board")).text; view = exportView(root);
  });
  await consoleFor(root, async ({ get }) => {
    const after = (await get("/board")).text;
    check("restart preserves board, pending proposal, actions and readiness", after === board && after.includes(proposal.id) && after.includes('action="/doors/approve"') && after.includes('action="/doors/reject"') && JSON.stringify(exportView(root)) === JSON.stringify(view));
  });
});
check("handoff null description describes this export, not all history", /this export.*files only/i.test(load("handoff").properties.tracker.description) && !/only ever/.test(load("handoff").properties.tracker.description));
// A files-only snapshot is not the baseline of a later explicit tracker projection.
for (const mode of ["unchanged", "changed", "undefined"]) await withRoot({}, async tmp => {
  const root = await ready(tmp), calls = []; let number = 0;
  const tracker = { kind: "github", repo: "acme/dock" };
  const seams = { _env: {}, _fetch: noIO, _exec: (cmd, args) => { assert.equal(cmd, "gh"); calls.push(args); return args[2] === "POST" ? JSON.stringify({ number: ++number }) : ""; } };
  const first = await exportHandoff({ root, exit: "team", by: "PM", tracker, ...seams });
  assert.equal(calls.length, Object.keys(first.handoff.tracker.keys).length);
  const old = readFileSync(join(root, first.file), "utf8"), keys = structuredClone(first.handoff.tracker.keys);
  const changedText = "As a worker, I want a revised receipt, so that I can check the record";
  if (mode === "changed") { const s = readDoc(root, STORIES_FILE); s.stories.find(s => s.id === "STORY-1").statement = changedText; saveDoc(root, STORIES_FILE, "story", s); }
  calls.length = 0; let status;
  await consoleFor(root, async ({ post }) => { status = (await post("/export", { exit: "team", by: "PM" })).status; }, seams);
  const middle = latestHandoff(root), middleBytes = readFileSync(join(root, `discovery/handoffs/handoff-v${middle.version}.json`), "utf8");
  const filesOnly = status === 303 && middle.version === 2 && middle.tracker === null && calls.length === 0;
  calls.length = 0;
  const last = await exportHandoff({ root, exit: "team", by: "PM", tracker: mode === "undefined" ? undefined : tracker, ...seams });
  const kept = readFileSync(join(root, first.file), "utf8") === old && readFileSync(join(root, `discovery/handoffs/handoff-v${middle.version}.json`), "utf8") === middleBytes;
  const expectedCalls = mode === "changed" ? calls.length === 1 && calls[0][2] === "PATCH" && calls[0][3] === `repos/acme/dock/issues/${keys["STORY-1"]}` && calls[0].some(a => a.startsWith("title=") && a.includes(changedText)) : calls.length === 0;
  check(`tracker resume ${mode}: projection baseline, keys and files-only semantics`, filesOnly && kept && last.handoff.version === 3 && expectedCalls && (mode === "undefined" ? last.handoff.tracker === null : last.handoff.tracker?.kind === tracker.kind && last.handoff.tracker.repo === tracker.repo && isDeepStrictEqual(last.handoff.tracker.keys, keys)), JSON.stringify({ status, filesOnly, calls: calls.map(a => a.slice(0, 4)), tracker: last.handoff.tracker }));
});
for (const state of ["no-agreement", "agreement-stale", "current"]) await withRoot({}, async tmp => {
  const root = await ready(tmp);
  if (state !== "current") answer({ root, req: "REQ-1", oq: "OQ-1", answer: "Until the shift ends.", by: "PM" });
  if (state === "no-agreement") { const prd = loadPrd(root); prd.agreements = []; savePrd(root, prd); }
  const findings = readiness(root).findings, f = findings.find(f => f.rule === state);
  await consoleFor(root, async ({ get }) => {
    const page = await get("/board"), row = page.text.match(/<tr><td>prototype<\/td>[\s\S]*?<\/tr>/)?.[0] ?? "";
    check(`prototype ${state}: recovery belongs to its row`, page.status === 200 && (state === "current" ? row.includes("current") && !row.includes("stale") && !row.includes("→") && !findings.some(f => ["no-agreement", "agreement-stale"].includes(f.rule)) : Boolean(f?.remedy) && row.includes("stale") && row.includes(esc(f.remedy))), row);
  });
});
done();
