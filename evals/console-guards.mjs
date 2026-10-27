#!/usr/bin/env node
// owns: R1, R10, R15 · shared — console trust, isolation and mutation lifetime.
// Real routes and loopback HTTP; every model and external executor is scripted.
import { request } from "node:http";
import { readdirSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { suite, withRoot, scripted } from "./_harness.mjs";
import { seedProject, seedPrototype, seedDelivery, BINDING } from "./_fixture.mjs";
import { serve } from "../shared/console/index.mjs";
import { routes } from "../discovery/console/index.mjs";
import { routes as deliveryRoutes } from "../delivery/console/index.mjs";
import { turn, readTranscript } from "../discovery/workshop/index.mjs";
import { readRun, createRun } from "../delivery/state/index.mjs";

const { check, done } = suite("console guards · trusted requests through completed work", 52);
const snapshot = (root) => JSON.stringify(readdirSync(root, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => [join(e.parentPath, e.name).slice(root.length), readFileSync(join(e.parentPath, e.name)).toString("base64")]).sort());
// node:http lets Host vary while the socket always targets this ephemeral loopback server.
function http(srv, path, { method = "GET", origin, host = `127.0.0.1:${srv.port}`, form = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port: srv.port, path, method, headers: { host, ...(origin === undefined ? {} : { origin }), "content-type": "application/x-www-form-urlencoded" } }, (res) => {
      let text = "";
      res.setEncoding("utf8").on("data", (s) => text += s).on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.setTimeout(5000, () => req.destroy(new Error(`HTTP timeout: ${path}`)));
    req.on("error", reject);
    req.end(method === "POST" ? new URLSearchParams(form).toString() : undefined);
  });
}
const post = (srv, path, form = {}, headers = {}) => http(srv, path, { method: "POST", origin: srv.url, form, ...headers });
const refused = (r) => r.status >= 400 && r.status < 500 && /refus|origin|host|busy|running|wait|progress/i.test(r.text);
const succeeded = (r) => r.status === 200 && /Done —/.test(r.text) && !/class="refusal"/.test(r.text);
const text = { text: "A guarded turn" };
const path = "/workshop/problem/turn";

// Every trust refusal has a fresh fixture and an allowed PM submission at the same door.
const origins = [undefined, "null", "http://foreign.invalid", "wrong-port", "https", "prefix", "substring"];
for (const originCase of origins) await withRoot({}, async (tmp) => {
  const root = seedProject(tmp), q = scripted({ text: "🏛️ Trusted reply" });
  const srv = await serve({ routes: routes({ root, _query: q.query }) });
  try {
    const origin = originCase === "wrong-port" ? "http://127.0.0.1:1" : originCase === "https" ? srv.url.replace("http:", "https:") : originCase === "prefix" ? `${srv.url}.evil.invalid` : originCase === "substring" ? `http://evil.invalid/${srv.url}` : originCase;
    const before = snapshot(root), r = await post(srv, path, text, { origin });
    check(`Origin ${originCase}: refused before the door, bytes unchanged`, refused(r) && q.calls.length === 0 && snapshot(root) === before);
    check(`Origin ${originCase}: trusted PM can submit`, succeeded(await post(srv, path, text)) && readTranscript(root, "problem").length >= 2);
  } finally { await srv.close(); }
});
for (const host of ["foreign.invalid", "foreign-port", "127.0.0.1:1", "localhost:1"]) await withRoot({}, async (tmp) => {
  const root = seedProject(tmp), q = scripted();
  let entered = 0;
  const table = routes({ root, _query: q.query }).map((r) => ({ ...r, handler: (ctx) => { entered++; return r.handler(ctx); } }));
  const srv = await serve({ routes: table });
  try {
    const before = snapshot(root);
    const authority = host === "foreign-port" ? `foreign.invalid:${srv.port}` : host;
    const get = await http(srv, "/setup", { host: authority });
    const bad = await post(srv, path, text, { host: authority, origin: `http://${authority}` });
    check(`Host ${host}: navigation and matching forged Origin refused before handlers`, refused(get) && refused(bad) && entered === 0 && q.calls.length === 0 && snapshot(root) === before);
    check(`Host ${host}: real authority permits navigation without Origin and PM post`, (await http(srv, "/setup")).status === 200 && succeeded(await post(srv, path, text)));
  } finally { await srv.close(); }
});
await withRoot({}, async (tmp) => {
  const root = seedProject(tmp); seedPrototype(root);
  const srv = await serve({ routes: routes({ root, _query: scripted().query }) });
  try {
    const r = await http(srv, "/prototype/index.html");
    const sandbox = (r.headers["content-security-policy"] ?? "").split(";").map((s) => s.trim()).find((s) => /^sandbox(?:\s|$)/.test(s));
    check("prototype serves its HTML with only allow-scripts in its sandbox", r.status === 200 && r.text.includes("<h1>Run sheet</h1>") && sandbox === "sandbox allow-scripts");
    check("localhost authority and Origin are accepted", (await http(srv, "/setup", { host: `localhost:${srv.port}` })).status === 200 && succeeded(await post(srv, path, text, { host: `localhost:${srv.port}`, origin: `http://localhost:${srv.port}` })));
  } finally { await srv.close(); }
});
for (const origin of [undefined, "null", "http://foreign.invalid"]) await withRoot({}, async (tmp) => {
  const root = join(tmp, "new-project"); let executions = 0;
  const srv = await serve({ routes: routes({ root, _exec: () => { executions++; return ""; } }) });
  try {
    const before = snapshot(tmp), form = { slug: "new-project" };
    const r = await post(srv, "/setup", form, { origin });
    check(`setup Origin ${origin}: no executor or files touched`, refused(r) && executions === 0 && snapshot(tmp) === before);
    // A bad baseline may already have created it: don't turn an expected failure into a harness exception.
    const allowed = await post(srv, "/setup", form);
    check(`setup Origin ${origin}: trusted setup creates the project`, allowed.status === 303 && executions > 0);
  } finally { await srv.close(); }
});

await withRoot({}, async (tmp) => {
  const { disc: root } = await seedDelivery(tmp);
  mkdirSync(join(root, ".git"), { recursive: true }); createRun(root, { by: "PM", version: 1 });
  const q = scripted({ text: "🏛️ Finished" });
  let release, entered;
  const held = new Promise((r) => release = r), started = new Promise((r) => entered = r);
  const query = (args) => {
    const stream = q.query(args), first = q.calls.length === 1;
    return (async function* () { if (first) { entered(); await held; } yield* stream; })();
  };
  const srv = await serve({ routes: [...routes({ root, _query: query }), ...deliveryRoutes({ root, _query: scripted().query })] });
  let pending;
  try {
    pending = post(srv, path, text);
    await Promise.race([started, pending.then(() => { throw new Error("door did not start"); })]);
    const before = snapshot(root);
    const different = await post(srv, "/doors/propose", { target: "/problem/crux", to: "Guarded revision", rationale: "PM correction", by: "PM" });
    check("busy: a different mutation refuses with a wait/retry remedy and no writes", refused(different) && /wait|retry|try again|finish/i.test(different.text) && snapshot(root) === before && q.calls.length === 1);
    const duplicate = await post(srv, path, text);
    check("busy: duplicate submit refuses without a second call or writes", refused(duplicate) && /wait|retry|try again|finish/i.test(duplicate.text) && snapshot(root) === before && q.calls.length === 1);
    const crossHalf = await post(srv, "/run/intake/run", { by: "PM" });
    check("busy: Delivery also refuses while Discovery works, without writes", refused(crossHalf) && /wait|retry|try again|finish/i.test(crossHalf.text) && snapshot(root) === before);
    check("navigation still works during long work", (await http(srv, "/setup")).status === 200);
    release();
    check("first request finishes its streamed work", succeeded(await pending));
    check("different mutation allowed after work completes", (await post(srv, "/doors/propose", { target: "/problem/crux", to: "Next revision", rationale: "PM correction", by: "PM" })).status === 303);
    check("duplicate allowed after work completes", succeeded(await post(srv, path, text)));
    check("Delivery allowed after Discovery work completes", succeeded(await post(srv, "/run/intake/run", { by: "PM" })) && readRun(root).stages.intake.status === "approved");
  } finally { release(); if (pending) await pending; await srv.close(); }
});

for (const failure of ["handler-refusal", "handler-throw", "work-refusal", "work-throw", "usage"]) await withRoot({}, async (tmp) => {
  const root = seedProject(tmp); mkdirSync(join(root, ".git"), { recursive: true });
  const reset = "2099-01-02T15:04:00Z", waits = [];
  const q = scripted({ throwWith: failure === "usage" ? [`usage limit reached — resets at ${reset}`, null] : failure === "work-throw" ? ["scripted work failure", null] : undefined });
  // A generic handler crash is independent of setup's recoverable command failures.
  const srv = await serve({ routes: [...routes({ root, _query: q.query, _sleep: async (ms) => waits.push(ms) }),
    { method: "POST", path: "/test/handler-throw", handler: () => { throw new Error("scripted handler failure"); } },
  ] });
  try {
    const r = failure === "handler-refusal" ? await post(srv, "/workshop/open", { slug: "dock", seed: "already exists" }) : failure === "handler-throw" ? await post(srv, "/test/handler-throw") : failure === "work-refusal" ? await post(srv, "/workshop/problem/extract") : await post(srv, path, text);
    check(`${failure}: renders failure at the appropriate transport status`, (failure === "handler-refusal" ? r.status === 409 : failure === "handler-throw" ? r.status === 500 : r.status === 200) && /class="refusal"/.test(r.text) && (failure !== "usage" || r.text.includes(reset)));
    if (failure === "usage") check("Discovery console usage gap makes exactly one query and no sleep", q.calls.length === 1 && waits.length === 0 && readTranscript(root, "problem").length === 0);
    check(`${failure}: guard released for the next successful door`, succeeded(await post(srv, path, text)));
  } finally { await srv.close(); }
});

await withRoot({}, async (tmp) => {
  const root = seedProject(tmp), q = scripted({ throwWith: ["usage limit — resets at 4pm", null] }), waits = [];
  const result = await turn({ root, key: "problem", text: "Direct caller", _query: q.query, _sleep: async (ms) => waits.push(ms) }).catch((error) => ({ error }));
  check("direct Discovery retains usage-gap retry: two queries, one sleep, successful turn", !result.error && q.calls.length === 2 && waits.length === 1 && waits[0] === 300000 && readTranscript(root, "problem").length === 2);
});
for (const trusted of [false, true]) await withRoot({}, async (tmp) => {
  const { cold: root } = await seedDelivery(tmp), waits = [];
  const clean = { findings: [], deferred: [], checked: 1, skipped: 0 };
  const q = scripted({ structuredSeq: [BINDING, BINDING, clean, clean, clean], throwWith: ["usage limit — resets at 4pm", null] });
  const srv = await serve({ routes: deliveryRoutes({ root, _query: q.query, _sleep: async (ms) => waits.push(ms) }) });
  try {
    await post(srv, "/run/intake/run", { by: "PM" }); // arithmetic only; sdd starts the model
    const before = snapshot(root);
    const r = await post(srv, "/run/sdd/run", { by: "PM" }, { origin: trusted ? srv.url : "null" });
    if (!trusted) check("Delivery rejects untrusted POST before any call or write", refused(r) && q.calls.length === 0 && snapshot(root) === before);
    else check("Delivery console retains usage pause and succeeds", succeeded(r) && q.calls.length === 5 && q.calls[0].prompt === q.calls[1].prompt && waits.length === 1 && waits[0] === 300000 && readRun(root).stages.sdd.status === "approved");
  } finally { await srv.close(); }
});
done();
