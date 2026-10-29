// owns: R10, R15 · shared — display isolation's HTTP contract, without a browser.
import { suite, withRoot, scripted } from "./_harness.mjs";
import { seedProject, seedPrototype } from "./_fixture.mjs";
import { serve } from "../shared/console/index.mjs";
import { routes, nav } from "../discovery/console/index.mjs";
const { check, done } = suite("display isolation", 10);
// CSP uses the first occurrence of a directive, not a later restrictive duplicate.
const directives = value => (value ?? "").split(";").filter(s => s.trim()).reduce((out, s) => { const [key, ...tokens] = s.trim().split(/\s+/); if (!(key in out)) out[key] = tokens.sort().join(" "); return out; }, {});
check("CSP comparison respects the first duplicate directive", directives("script-src *; script-src 'unsafe-inline'")["script-src"] === "*");
await withRoot({}, async tmp => {
  const root = seedProject(tmp); seedPrototype(root);
  const srv = await serve({ routes: routes({ root, _query: scripted().query }), nav });
  try {
    const view = await fetch(srv.url + "/prototype"), body = await view.text();
    check("wrapper restricts frame destinations to self", view.status === 200 && directives(view.headers.get("content-security-policy"))["frame-src"] === "'self'");
    const iframe = body.match(/<iframe\b[^>]*>/i)?.[0] ?? "";
    check("wrapper frames raw HTML with exactly scripts and forms allowed", /\bsrc=["']\/prototype\/index.html["']/.test(iframe) && /\bsandbox=["']allow-scripts allow-forms["']/.test(iframe));
    check("wrapper retains console navigation", /<nav>/.test(body) && /href="\/board"/.test(body));
    const raw = await fetch(srv.url + "/prototype/index.html", { headers: { "Sec-Fetch-Dest": "iframe" } });
    const csp = directives(raw.headers.get("content-security-policy"));
    const expected = { sandbox: "allow-forms allow-scripts", "default-src": "'none'", "script-src": "'unsafe-inline'", "style-src": "'unsafe-inline'", "img-src": "blob: data:", "connect-src": "'none'", "form-action": "'none'", "frame-ancestors": "'self'" };
    check("frame response has every isolation directive and published HTML", raw.status === 200 && (await raw.text()).includes("<h1>Run sheet</h1>") && Object.entries(expected).every(([k, v]) => csp[k] === v), JSON.stringify(csp));
    const board = await (await fetch(srv.url + "/board")).text();
    check("board opens wrapper, not raw HTML", /href="\/prototype">open<\/a>/.test(board) && !/href="\/prototype\/index.html"/.test(board));
    for (const dest of [undefined, "document", "empty"]) {
      const r = await fetch(srv.url + "/prototype/index.html", { headers: dest ? { "Sec-Fetch-Dest": dest } : {} }), text = await r.text();
      check(`non-frame ${dest ?? "missing metadata"} receives only a pointer`, r.status === 200 && /href="\/prototype"/.test(text) && !/<iframe\b|<h1>Run sheet<\/h1>/.test(text));
    }
  } finally { await srv.close(); }
});
await withRoot({}, async tmp => {
  const srv = await serve({ routes: routes({ root: seedProject(tmp) }), nav });
  try {
    const r = await fetch(srv.url + "/prototype"), text = await r.text();
    check("unpublished prototype has an empty view linking to board", r.status === 200 && !/<iframe\b/.test(text) && /href="\/board"/.test(text) && /no |not |yet/i.test(text));
  } finally { await srv.close(); }
});
done();
