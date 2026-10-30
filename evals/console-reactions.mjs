// owns: R1, R3, R10, R15 · discovery — DH1b 4b reaction controls and writer-only notes.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { suite, scripted, withRoot } from "./_harness.mjs";
import { seedProject, seedPrototype, HTML, SCREENS } from "./_fixture.mjs";
import { serve, esc } from "../shared/console/index.mjs";
import { routes, nav } from "../discovery/console/index.mjs";
import { react, reject, answer } from "../discovery/doors/index.mjs";
import { loadPrd } from "../discovery/workshop/index.mjs";
import { readDoc, saveDoc, Refused, PROTOTYPE_FILE } from "../discovery/record/index.mjs";
import { loadProject, ledgerPath, PROJECT_FILE } from "../discovery/setup/index.mjs";
import { append } from "../shared/agent-call/ledger.mjs";
import { BudgetError, modelFor } from "../shared/agent-call/index.mjs";
import { generate } from "../discovery/prototype/index.mjs";
const { check, done } = suite("console reactions", 21);
const none = { change: null, rationale: "", note: "Keep the current wording <please>." };
const edit = { change: { criterion: "REQ-1/AC-1", statement: "An exception records a reason and timestamp." }, rationale: "Traceability.", note: "Review this change." };
const text = 'Please show <strong>my words</strong> & "details".', by = "PM <owner>";
const noIO = () => { throw Error("unexpected external IO"); };
const seen = root => ({ prd_hash: loadPrd(root).meta.content_hash, prototype_hash: readDoc(root, PROTOTYPE_FILE).meta.content_hash });
const tree = root => readdirSync(join(root, "discovery"), { recursive: true, withFileTypes: true }).filter(f => f.isFile()).map(f => { const p = join(f.parentPath, f.name); return [p, readFileSync(p, "utf8")]; }).sort();
const forms = html => [...html.matchAll(/<form\b[^]*?<\/form>/g)].map(m => m[0]);
const formAt = (html, action) => forms(html).find(f => f.includes(`action="${action}"`)) ?? "";
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
const inputs = html => [...html.matchAll(/<input\b[^>]*>/g)].map(m => attrs(m[0]));
const rowFor = (html, id) => [...html.matchAll(/<tr\b[^]*?<\/tr>/g)].map(m => m[0]).find(row => new RegExp(`\\b${id}\\b`).test(row)) ?? "";
async function test(label, fn) {
  try { await withRoot({}, async tmp => { const root = seedProject(tmp); seedPrototype(root); await fn(root); }); check(label, true); }
  catch (e) { check(label, false, e.stack); }
}
async function consoleFor(root, q, fn, injected) {
  const table = routes({ root, _query: q.query, _sleep: async () => {}, _exec: noIO, _fetch: noIO, _env: {} });
  const srv = await serve({ routes: table.map(r => r.path === injected?.path ? { ...r, handler: () => { throw injected.error; } } : r), nav });
  const get = async path => { const r = await fetch(srv.url + path); assert.equal(r.status, 200); return r.text(); };
  const post = async (path, fields) => {
    const r = await fetch(srv.url + path, { method: "POST", headers: { Origin: srv.url }, body: new URLSearchParams(fields), redirect: "manual" });
    return { status: r.status, buffering: r.headers.get("x-accel-buffering"), body: await r.text() };
  };
  try { await fn({ get, post, table }); } finally { await srv.close(); }
}
// Read actual hidden controls when present; fallback lets route checks fail independently
// at the missing route on the red baseline instead of every check stopping at the form.
function fields(root, page, extra = {}) {
  const hidden = inputs(formAt(page, "/prototype/react")).filter(i => i.type === "hidden");
  return { ...(hidden.length ? Object.fromEntries(hidden.map(i => [i.name, i.value])) : seen(root)), text, by, ...extra };
}
function question(root) {
  const doc = readDoc(root, PROTOTYPE_FILE);
  doc.open_questions = [{ id: "PQ-1", question: "Who records <the reason>?", blocking: false, status: "open" }, { id: "PQ-2", question: "SETTLED QUESTION", blocking: false, status: "answered", ruling: "RUL-1" }];
  doc.questions_issued = 2; saveDoc(root, PROTOTYPE_FILE, "prototype", doc);
}
await test("form below frame posts text, optional open question, by and viewed hashes", async root => {
  question(root);
  await consoleFor(root, scripted({ structured: none }), async ({ get }) => {
    const page = await get("/prototype"), f = formAt(page, "/prototype/react");
    assert.ok(f, "missing reaction form"); assert.match(f, /method="post"/i);
    assert.match(f, /<textarea\b[^>]*name="text"/); assert.ok(inputs(f).some(i => i.name === "by"));
    const select = f.match(/<select\b[^>]*name="pq"[^]*?<\/select>/)?.[0] ?? "";
    assert.ok(select); assert.doesNotMatch(select.split(">")[0], /\brequired\b/);
    assert.match(select, /<option\b[^>]*value=""/); assert.match(select, /value="PQ-1"/);
    assert.ok(select.includes(esc("Who records <the reason>?"))); assert.ok(!select.includes("PQ-2"));
    const hidden = inputs(f).filter(i => i.type === "hidden");
    for (const hash of Object.values(seen(root))) assert.ok(hidden.some(i => i.name && i.value === hash), "missing viewed hash");
    assert.ok(page.indexOf("</iframe>") < page.indexOf(f));
  });
});
// Scope the quote to the reaction controls below the frame, not another page quote.
function reactionQuote(page) {
  const f = formAt(page, "/prototype/react");
  assert.ok(f, "missing reaction form");
  const frameEnd = page.indexOf("</iframe>"), formStart = page.indexOf(f);
  assert.ok(frameEnd >= 0 && frameEnd < formStart);
  const quote = page.slice(frameEnd, formStart).match(/<p\b[^>]*class="quote(?: [^"]*)?"[^>]*>[^]*?<\/p>/)?.[0];
  assert.ok(quote, "missing quote associated with the reaction form");
  assert.match(f, /<button\b[^>]*>React<\/button>/);
  assert.ok(page.indexOf(quote, frameEnd) < formStart + f.indexOf("<button"), "quote must precede React");
  return quote;
}
await test("React quote names writer's model, not the distinct reviewer model, before its button", async root => {
  const project = loadProject(root), reviewer = "reviewer-only-test-model";
  const writer = modelFor({ half: "discovery", role: "writer" }, project.models);
  assert.notEqual(writer, reviewer);
  writeFileSync(join(root, PROJECT_FILE), JSON.stringify({ ...project, models: { ...project.models, "discovery.reviewer": reviewer } }));
  await consoleFor(root, scripted(), async ({ get }) => {
    const quote = reactionQuote(await get("/prototype"));
    assert.ok(quote.includes(`<code>${esc(writer)}</code>`), "React quote must name the writer model");
    assert.ok(!quote.includes(reviewer), "React quote must exclude the reviewer model");
  });
});
await test("React quote estimates writer costs only when reviewer shares its model", async root => {
  const project = loadProject(root), model = modelFor({ half: "discovery", role: "writer" }, project.models);
  writeFileSync(join(root, PROJECT_FILE), JSON.stringify({ ...project, models: { ...project.models, "discovery.reviewer": model } }));
  // The writer mean is $0.20 (two calls); reviewer-only is $0.90 and pooled is $0.43.
  for (const [role, usd] of [["writer", 0.10], ["writer", 0.30], ["reviewer", 0.90]]) {
    append(ledgerPath(root), { half: "discovery", stage: "react", role, model, usd, ok: true });
  }
  await consoleFor(root, scripted(), async ({ get }) => {
    const quote = reactionQuote(await get("/prototype"));
    assert.ok(quote.includes("~$0.20 a call (2 so far)"), "React estimate must use only successful writer costs");
    assert.doesNotMatch(quote, /~\$0\.(?:90|43) a call/);
  });
});
await test("POST streams editor progress, persists proposal, returns to prototype and board decisions", async root => {
  question(root); const q = scripted({ structured: edit, text: "EDITOR-PROGRESS" });
  await consoleFor(root, q, async ({ get, post }) => {
    const r = await post("/prototype/react", fields(root, await get("/prototype"), { pq: "PQ-1" }));
    assert.equal(r.status, 200, "reaction must be a streamed route"); assert.equal(r.buffering, "no");
    assert.ok(r.body.includes("EDITOR-PROGRESS")); assert.match(r.body, /location\.replace\("\/prototype"\)/);
    assert.equal(q.calls.length, 1); const prd = loadPrd(root), rx = prd.reactions.at(-1), a = prd.amendments.at(-1);
    assert.equal(rx.text, text); assert.equal(rx.by, by); assert.equal(rx.pq, "PQ-1"); assert.deepEqual(rx.seen, seen(root)); assert.equal(rx.proposal, a.id);
    const row = rowFor(await get("/prototype"), rx.id);
    for (const part of [esc(by), esc(text), a.id, "proposed", 'href="/board"']) assert.ok(row.includes(part), `reaction row lacks ${part}`);
    const boardRow = rowFor(await get("/board"), a.id);
    for (const action of ["approve", "reject"]) assert.ok(formAt(boardRow, `/doors/${action}`).includes(`value="${a.id}"`));
  });
});
await test("no-question POST persists no-change note and renders it in its row", async root => {
  const q = scripted({ structured: none });
  await consoleFor(root, q, async ({ get, post }) => {
    const r = await post("/prototype/react", fields(root, await get("/prototype"), { pq: "" }));
    assert.equal(r.status, 200); assert.match(r.body, /location\.replace\("\/prototype"\)/);
    assert.equal(q.calls.length, 1); const rx = loadPrd(root).reactions.at(-1);
    assert.equal(rx.proposal, null); assert.equal(rx.pq, undefined);
    const row = rowFor(await get("/prototype"), rx.id);
    for (const part of [esc(none.note), esc(text), esc(by)]) assert.ok(row.includes(part));
    assert.ok(!row.includes(none.note)); assert.ok(formAt(await get("/prototype"), "/prototype/react"));
  });
});
await test("rows newest first and proposal status follows rejection", async root => {
  const first = await react({ root, text: "Older reaction", by, seen: seen(root), _query: scripted({ structured: edit }).query });
  reject({ root, id: first.amendment.id, by, reason: "Keep current behavior" });
  const second = await react({ root, text: "Newer reaction", by, seen: seen(root), _query: scripted({ structured: none }).query });
  await consoleFor(root, scripted(), async ({ get }) => {
    const page = await get("/prototype"), older = rowFor(page, first.reaction.id), newer = rowFor(page, second.reaction.id);
    assert.ok(older && newer); assert.ok(page.indexOf(newer) < page.indexOf(older));
    assert.ok(older.includes(first.amendment.id)); assert.match(older, /rejected/); assert.doesNotMatch(older, /proposed/);
    assert.ok(newer.includes(esc(none.note)));
  });
});
for (const moved of ["prd", "prototype"]) await test(`${moved} hash moved: revision-moved, byte-identical record and Back to prototype`, async root => {
  const q = scripted({ structured: none });
  await consoleFor(root, q, async ({ get, post }) => {
    const f = fields(root, await get("/prototype"));
    if (moved === "prd") { answer({ root, req: "REQ-1", oq: "OQ-1", answer: "Until the shift ends.", by }); seedPrototype(root); }
    else { const doc = readDoc(root, PROTOTYPE_FILE); doc.screens[0].name += " revised"; saveDoc(root, PROTOTYPE_FILE, "prototype", doc); }
    const before = tree(root), r = await post("/prototype/react", f);
    assert.match(r.body, /revision-moved/); assert.match(r.body, /href="\/prototype">Back<\/a>/);
    assert.equal(q.calls.length, 0); assert.deepEqual(tree(root), before);
  });
});
// The pq on a moved form may itself contain markup. Post-call pq is a valid id:
// a boundary injection below also proves both fields are escaped from error.detail,
// not echoed from the request or resolved from current prototype questions.
for (const code of ["revision-moved", "reaction-invalid"]) await test(`${code}: real refusal preserves escaped PM text and selected question`, async root => {
  question(root); const q = scripted({ structured: { ...edit, change: { criterion: "REQ-99/AC-1", statement: "Invalid target" } } });
  await consoleFor(root, q, async ({ get, post }) => {
    const pq = code === "revision-moved" ? 'PQ-1 <picked> & "old"' : "PQ-1", f = fields(root, await get("/prototype"), { pq });
    if (code === "revision-moved") { const doc = readDoc(root, PROTOTYPE_FILE); doc.screens[0].name += " revised"; saveDoc(root, PROTOTYPE_FILE, "prototype", doc); }
    const before = tree(root), r = await post("/prototype/react", f);
    assert.match(r.body, new RegExp(code)); assert.ok(r.body.includes(esc(text))); assert.ok(r.body.includes(esc(pq)));
    assert.ok(!r.body.includes(text)); if (pq !== "PQ-1") assert.ok(!r.body.includes(pq));
    assert.match(r.body, /href="\/prototype">Back<\/a>/); assert.deepEqual(tree(root), before);
    assert.equal(q.calls.length, code === "revision-moved" ? 0 : 1);
  });
});
await test("budget refusal returns escaped words and question without a call or record write", async root => {
  question(root);
  writeFileSync(join(root, PROJECT_FILE), JSON.stringify({ ...loadProject(root), budget: 0 }));
  const q = scripted({ structured: none });
  await consoleFor(root, q, async ({ get, post, table }) => {
    const f = fields(root, await get("/prototype"), { pq: "PQ-1" }), before = tree(root);
    const r = await post("/prototype/react", f);
    assert.equal(r.status, 200); assert.equal(r.buffering, "no");
    assert.match(r.body, /<code>budget<\/code>/); assert.match(r.body, /href="\/prototype">Back<\/a>/);
    assert.equal(q.calls.length, 0); assert.deepEqual(tree(root), before);
    assert.ok(r.body.includes(esc(text)), "budget refusal dropped the PM's words");
    assert.ok(!r.body.includes(text), "budget refusal rendered raw markup");
    assert.ok(r.body.includes(esc(f.pq)), "budget refusal dropped the selected question");
    // HTTP cannot expose the exception class: check the same real work boundary as well.
    const route = table.find(r => r.path === "/prototype/react" && r.method === "POST");
    const out = await route.handler({ form: f });
    await assert.rejects(() => out.work(() => {}), e => {
      assert.ok(e instanceof BudgetError); assert.equal(e.code, "budget");
      assert.deepEqual(e.detail, { text, pq: "PQ-1" }); return true;
    });
    assert.equal(q.calls.length, 0); assert.deepEqual(tree(root), before);
  });
});
for (const code of ["revision-moved", "reaction-invalid"]) await test(`${code}: own refusal detail is escaped, not request values`, async root => {
  const detail = { text: "DETAIL <em>words</em> & only", pq: 'DETAIL <question> & "only"' };
  // Inject the door's error at its work boundary, retaining the actual route and shared stream renderer.
  const table = routes({ root, _query: noIO }); const route = table.find(r => r.path === "/prototype/react" && r.method === "POST");
  assert.ok(route, "missing reaction route");
  const out = await route.handler({ form: { ...seen(root), text: "REQUEST-WORDS", pq: "REQUEST-QUESTION", by } });
  assert.equal(typeof out.work, "function");
  const srv = await serve({ routes: [{ method: "POST", path: "/prototype/react", handler: () => ({ ...out, work: async () => { throw new Refused(code, "react: scripted refusal", detail); } }) }] });
  try {
    const r = await fetch(srv.url + "/prototype/react", { method: "POST", headers: { Origin: srv.url }, body: new URLSearchParams({}) }), body = await r.text();
    assert.ok(body.includes(esc(detail.text))); assert.ok(body.includes(esc(detail.pq)));
    for (const raw of [detail.text, detail.pq, "REQUEST-WORDS", "REQUEST-QUESTION"]) assert.ok(!body.includes(raw));
  } finally { await srv.close(); }
});
await test("other-door refusal does not expose reaction-shaped object detail", async root => {
  const detail = { text: "OTHER-DOOR-WORDS <safe>", pq: "OTHER-DOOR-QUESTION" };
  await consoleFor(root, scripted(), async ({ post }) => {
    const r = await post("/doors/approve", {}); assert.equal(r.status, 409); assert.match(r.body, /revision-moved/);
    for (const value of Object.values(detail)) { assert.ok(!r.body.includes(value)); assert.ok(!r.body.includes(esc(value))); }
  }, { path: "/doors/approve", error: new Refused("revision-moved", "approve: scripted refusal", detail) });
});
await test("pending reaction suppresses form, names reaction and links to board", async root => {
  const out = await react({ root, text, by, seen: seen(root), _query: scripted({ structured: edit }).query });
  await consoleFor(root, scripted(), async ({ get }) => {
    const page = await get("/prototype"); assert.equal(formAt(page, "/prototype/react"), "");
    const notice = [...page.matchAll(/<p\b[^]*?<\/p>/g)].map(m => m[0]).find(p => p.includes(out.reaction.id) && /pending|wait|approve|reject/i.test(p)) ?? "";
    assert.ok(notice, "missing pending reaction notice");
    assert.match(notice, /href="\/board"/, "pending notice must link to the board itself");
  });
});
await test("stale prototype suppresses form and directs rebuild on board", async root => {
  answer({ root, req: "REQ-1", oq: "OQ-1", answer: "Until the shift ends.", by });
  await consoleFor(root, scripted(), async ({ get }) => {
    const page = await get("/prototype"); assert.equal(formAt(page, "/prototype/react"), "");
    const notice = [...page.matchAll(/<p\b[^]*?<\/p>/g)].map(m => m[0]).find(p => /rebuild/i.test(p)) ?? "";
    assert.ok(notice, "missing rebuild notice");
    assert.match(notice, /href="\/board"/, "rebuild notice must link to the board itself");
  });
});
await test("absent prototype retains generate guidance and has no frame or reaction form", async root => {
  await withRoot({}, async tmp => consoleFor(seedProject(tmp), scripted(), async ({ get }) => {
    const page = await get("/prototype"); assert.match(page, /No prototype is published yet/); assert.match(page, /generate.*href="\/board"/);
    assert.doesNotMatch(page, /<iframe/); assert.equal(formAt(page, "/prototype/react"), "");
  }));
});
await test("heading names traced PRD version then prototype hash, never bare v", async root => {
  const doc = readDoc(root, PROTOTYPE_FILE); doc.traces.prd.version = "7.2.0"; saveDoc(root, PROTOTYPE_FILE, "prototype", doc);
  await consoleFor(root, scripted(), async ({ get }) => {
    const heading = (await get("/prototype")).match(/<h1>[^]*?<\/h1>/)?.[0] ?? "";
    assert.match(heading, /from PRD v7\.2\.0/); assert.ok(heading.includes(doc.meta.content_hash.slice(0, 12)));
    assert.ok(heading.indexOf("7.2.0") < heading.indexOf(doc.meta.content_hash.slice(0, 12))); assert.doesNotMatch(heading, />v<|\bvundefined\b|\bvnull\b/);
  });
});
await test("Generate has no notes input", async root => {
  await consoleFor(root, scripted(), async ({ get }) => { const f = formAt(await get("/board"), "/prototype/generate"); assert.ok(f); assert.doesNotMatch(f, /name="notes"/); });
});
await test("Stories and Design retain notes boxes with wording-only label", async root => {
  await consoleFor(root, scripted(), async ({ get }) => {
    const page = await get("/board");
    for (const action of ["/stories/write", "/design/write"]) { const f = formAt(page, action); assert.match(f, /<textarea\b[^>]*name="notes"/); assert.ok(f.includes("notes to the writer — wording and presentation only; product changes go through a reaction")); }
  });
});
await test("generate ignores passed notes in both prompt and system prompt", async root => {
  const q = scripted({ structured: { html: HTML, screens: SCREENS, uncovered: ["REQ-4"], notes: "Builder record note", open_questions: [] } });
  await generate({ root, notes: "UNAPPROVED-PRODUCT-FEEDBACK", _query: q.query }); assert.equal(q.calls.length, 1);
  for (const prompt of [q.calls[0].prompt, q.calls[0].options.systemPrompt]) assert.doesNotMatch(prompt, /UNAPPROVED-PRODUCT-FEEDBACK|The PM's notes/);
});
done();
