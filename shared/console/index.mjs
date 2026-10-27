// owns: R10 · shared — the console's machinery, half-agnostic: one small http server on
// localhost, HTML rendered from data a half's views compute, forms that POST to the
// half's doors. No framework, no build step, no dependency. A door that takes minutes
// streams its progress lines, then sends the browser back to the view. A refusal renders
// as the door's own words — its code and message — with a 4xx; the record does not move.

import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";

// ── text ──

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const usd = (n) => (n == null ? "—" : `$${Number(n).toFixed(2)}`);
export const when = (iso) => (iso ? String(iso).replace("T", " ").slice(0, 16) : "—");
export const short = (hash) => (hash ? String(hash).slice(0, 12) : "—");

// ── pieces ──

/** A word with a tone: ok · warn · bad · muted. State is a word, never a colour alone. */
export function badge(text, tone = "muted") {
  return `<span class="badge ${esc(tone)}">${esc(text)}</span>`;
}

export function table(head, rows) {
  if (!rows.length) return `<p class="muted">none</p>`;
  return `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c ?? ""}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

export function dl(pairs) {
  return `<dl>${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v ?? "—"}</dd>`).join("")}</dl>`;
}

/**
 * A form that POSTs to a door. fields: [{ name, label, type = text | textarea | select |
 * hidden | checkbox, value, options: [[value, label]], required, rows, checked }]. A
 * checkbox submits its value when checked; several with one name arrive as a list. The
 * submit is the door's own verb.
 */
export function form({ action, fields = [], submit, note }) {
  const one = (f) => {
    // Boxes in a list share a name, so the value keeps each id its own — the label toggles the box it names.
    const id = `${action}-${f.name}${f.type === "checkbox" ? `-${f.value ?? "1"}` : ""}`.replace(/\W+/g, "-");
    const req = f.required ? " required" : "";
    if (f.type === "hidden") return `<input type="hidden" name="${esc(f.name)}" value="${esc(f.value)}">`;
    const text = `<span>${esc(f.label ?? f.name)}</span>`;
    let control;
    if (f.type === "textarea") control = `<textarea id="${id}" name="${esc(f.name)}" rows="${f.rows ?? 3}"${req}>${esc(f.value)}</textarea>`;
    else if (f.type === "select") control = `<select id="${id}" name="${esc(f.name)}"${req}>${(f.options ?? []).map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(f.value ?? "") ? " selected" : ""}>${esc(l ?? v)}</option>`).join("")}</select>`;
    else if (f.type === "checkbox") return `<label class="check" for="${id}"><input type="checkbox" id="${id}" name="${esc(f.name)}" value="${esc(f.value ?? "1")}"${f.checked ? " checked" : ""}>${text}</label>`;
    else control = `<input type="${esc(f.type ?? "text")}" id="${id}" name="${esc(f.name)}" value="${esc(f.value)}"${req}${f.step ? ` step="${esc(f.step)}"` : ""}>`;
    return `<label for="${id}">${text}${control}</label>`;
  };
  return `<form method="post" action="${esc(action)}">${fields.map(one).join("")}${note ? `<p class="note">${note}</p>` : ""}<button type="submit">${esc(submit)}</button></form>`;
}

/** A verdict's tone. Anything not pass or block — advise — is a warning. */
export const TONE = { pass: "ok", block: "bad" };

/** A verdict as one line: the gate, the word, stale by pin if so, how many findings, the model and what it cost. */
export function verdictLine(g) {
  if (g.verdict === null) return `<span class="muted">${esc(g.gate)}: no verdict</span>`;
  return `${esc(g.gate)}: ${badge(g.verdict, TONE[g.verdict] ?? "warn")}${g.fresh === false ? " " + badge("stale", "warn") : ""}${g.findings.length ? ` <span class="muted">${g.findings.length} finding${g.findings.length === 1 ? "" : "s"}</span>` : ""}${g.model ? ` <code>${esc(g.model)}</code>` : ""}${g.usd != null ? ` <span class="muted">${usd(g.usd)}</span>` : ""}`;
}

/** Findings as the schema shapes them: severity × confidence, the rule, the subject, the summary, the evidence a human checks in ten seconds. */
export const findingRows = (findings, first = () => []) => findings.map((f) => [...first(f), `${badge(f.severity, f.severity === "high" ? "bad" : f.severity === "medium" ? "warn" : "muted")} ${badge(f.confidence, "muted")}`, esc(f.rule), esc(f.subject), `${esc(f.summary)}<br><span class="muted">${esc(f.evidence)}</span>${f.remedy ? `<br><span class="muted">→ ${esc(f.remedy)}</span>` : ""}`]);

/** The findings and the deferrals across a set of gates, each row naming its gate. */
export function findingsHtml(gates, { deferredTitle = "Deferred — noticed past the line (R2)" } = {}) {
  const rows = gates.flatMap((g) => findingRows(g.findings, () => [esc(g.gate)]));
  const deferred = gates.flatMap((g) => g.deferred.map((d) => [esc(g.gate), esc(d.subject), esc(d.summary), esc(d.beyond)]));
  return (rows.length ? `<h2>Findings</h2>${table(["gate", "severity", "rule", "subject", "what"], rows)}` : "")
    + (deferred.length ? `<h2>${esc(deferredTitle)}</h2>${table(["gate", "subject", "what", "beyond"], deferred)}` : "");
}

/** The cost strip before a trigger (R1): what the next call is likely to cost, and where the spend stands. */
export function quoteStrip(q) {
  const est = q.estimate?.usd == null ? `no history yet` : `~${usd(q.estimate.usd)} a call (${q.estimate.n} so far)`;
  const cap = q.budget == null ? "no cap" : `${usd(q.spent)} of ${usd(q.budget)} spent · ${usd(q.remaining)} remains`;
  return `<p class="quote${q.over ? " over" : ""}">${q.model ? `<code>${esc(q.model)}</code> · ` : ""}${esc(est)} · ${esc(cap)}${q.over ? " · " + badge("over budget", "bad") : ""}</p>`;
}

export function refusalHtml(e) {
  const code = e?.code ? `<code>${esc(e.code)}</code> ` : "";
  const detail = e?.detail !== undefined && typeof e.detail !== "object" ? `<p class="muted">${esc(String(e.detail))}</p>` : "";
  return `<p class="refusal">${code}${esc(e?.message ?? String(e))}</p>${detail}`;
}

// ── the page ──

const CSS = `
:root{--ink:#1c1a17;--paper:#f7f4ee;--rule:#d9d3c7;--muted:#6b665d;--ok:#2f6f3e;--warn:#9a6b00;--bad:#a12d22;--accent:#3a4f8a;color-scheme:light}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.45 ui-sans-serif,system-ui,sans-serif}
header{display:flex;gap:1.25rem;align-items:baseline;padding:.75rem 1.25rem;border-bottom:1px solid var(--rule);flex-wrap:wrap}
header .brand{font-weight:600;letter-spacing:.02em}nav a{color:var(--muted);text-decoration:none;margin-right:1rem}nav a.current{color:var(--ink);border-bottom:2px solid var(--accent)}
main{max-width:64rem;margin:0 auto;padding:1.25rem}h1{font-size:1.4rem;margin:.25rem 0 1rem}h2{font-size:1.05rem;margin:1.75rem 0 .5rem;border-bottom:1px solid var(--rule);padding-bottom:.25rem}
section{margin-bottom:1rem}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{text-align:left;padding:.35rem .5rem;border-bottom:1px solid var(--rule);vertical-align:top}th{color:var(--muted);font-weight:500;font-size:.85rem}
dl{display:grid;grid-template-columns:max-content 1fr;gap:.25rem 1rem}dt{color:var(--muted)}dd{margin:0}
.badge{display:inline-block;padding:0 .45em;border-radius:3px;font-size:.8rem;border:1px solid currentColor}.badge.ok{color:var(--ok)}.badge.warn{color:var(--warn)}.badge.bad{color:var(--bad)}.badge.muted{color:var(--muted)}
.muted{color:var(--muted)}.note{color:var(--muted);font-size:.9rem}code{font-size:.9em}pre{white-space:pre-wrap;background:#fff;border:1px solid var(--rule);padding:.75rem;overflow-x:auto;font-size:.85rem}
form{display:grid;gap:.5rem;margin:.75rem 0 1rem;padding:.75rem;border:1px solid var(--rule);background:#fff}form label{display:grid;gap:.15rem}form label span{color:var(--muted);font-size:.85rem}
form label.check{grid-template-columns:auto 1fr;align-items:center;gap:.5rem}form label.check span{color:var(--ink);font-size:.95rem}input[type=checkbox]{margin:0;width:1rem;height:1rem;padding:0}
input,textarea,select{font:inherit;padding:.35rem .5rem;border:1px solid var(--rule);border-radius:3px;background:var(--paper);color:var(--ink)}button{font:inherit;justify-self:start;padding:.4rem .9rem;border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:3px;cursor:pointer}button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.quote{margin:.25rem 0;font-size:.9rem;color:var(--muted)}.quote.over{color:var(--bad)}.refusal{padding:.75rem;border-left:4px solid var(--bad);background:#fff}.log{font-size:.85rem;min-height:4rem}
.transcript p{margin:.5rem 0;padding:.5rem .75rem;background:#fff;border:1px solid var(--rule)}.transcript p.pm{border-left:3px solid var(--accent)}.transcript .who{color:var(--muted);font-size:.8rem;display:block}
.stale{color:var(--warn)}.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(18rem,1fr));gap:1rem}
`;

/** The shell. `nav` is [{ href, label, current }]; the body is trusted HTML the caller built. */
export function page({ title, nav = [], body, brand = "Forge" }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · ${esc(brand)}</title><style>${CSS}</style></head><body><header><span class="brand">${esc(brand)}</span><nav>${nav.map((n) => `<a href="${esc(n.href)}"${n.current ? ' class="current"' : ""}>${esc(n.label)}</a>`).join("")}</nav></header><main>${body}</main></body></html>`;
}

// ── the server ──

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".md": "text/markdown; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };
const BODY_LIMIT = 1 << 20;

function compile(path) {
  const keys = [];
  const re = new RegExp("^" + path.replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return "/([^/]+)"; }) + "/?$");
  return { re, keys };
}

function readForm(req) {
  return new Promise((ok, no) => {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > BODY_LIMIT) { no(new Error("body too large")); req.destroy(); } });
    // A repeated field (a checkbox list) arrives as an array; anything else as its string.
    req.on("end", () => ok([...new URLSearchParams(body)].reduce((o, [k, v]) => ({ ...o, [k]: k in o ? [].concat(o[k], v) : v }), {})));
    req.on("error", no);
  });
}

/**
 * Serve a route table on localhost.
 * routes: [{ method, path, handler }] — path like "/workshop/:key/turn"; handler(ctx) with
 * ctx = { params, query, form, url } returns one of
 *   { title, body }                       a page (status 200 unless given)
 *   { redirect }                          303 to a view — every door POST ends here
 *   { file, type? }                       one file from the record, as it is
 *   { title, work: async (event) => href, back }   a long door: progress streamed, then on to `href`
 * A thrown error with a `code` is a refusal (409); anything else is a 500. Both render
 * the error's own words. `nav` is the half's view list; the current view is marked by path.
 */
export function serve({ routes, nav = [], port = 0, host = "127.0.0.1", brand }) {
  const compiled = routes.map((r) => ({ ...r, ...compile(r.path) }));
  const navFor = (pathname) => nav.map((n) => ({ ...n, current: pathname === n.href || pathname.startsWith(n.href + "/") }));
  const send = (res, status, html) => { res.writeHead(status, { "content-type": TYPES[".html"] }); res.end(html); };
  const errorPage = (res, pathname, e) => send(res, e?.code ? 409 : 500, page({ title: e?.code ? "Refused" : "Error", nav: navFor(pathname), body: `<h1>${e?.code ? "The door refused" : "Something failed"}</h1>${refusalHtml(e)}<p><a href="javascript:history.back()">Back</a></p>`, brand }));

  // Trust comes from the address this server listens on, never from the request: a page on
  // another origin, a rebinding name or a sandboxed prototype cannot drive a door (D13).
  let trusted = new Set(), origins = new Set(), busy = false;
  const refuse = (res, status, pathname, code, message) => send(res, status, page({ title: "Refused", nav: navFor(pathname), body: `<h1>The console refused</h1>${refusalHtml({ code, message })}`, brand }));

  const server = createServer(async (req, res) => {
    if (!trusted.has(req.headers.host)) return refuse(res, 403, "/", "untrusted-host", `this console answers only at ${[...trusted][0]} — open it from the address it printed`);
    const url = new URL(req.url, `http://${req.headers.host}`);
    const { pathname } = url;
    const mutating = req.method === "POST";
    if (mutating && !origins.has(req.headers.origin)) return refuse(res, 403, pathname, "untrusted-origin", "a change must come from this console's own page");
    // One change at a time, held until its long work finishes, not just its handler.
    if (mutating && busy) return refuse(res, 409, pathname, "busy", "another change is still running — wait for it to finish, then try again");
    if (mutating) busy = true;
    try {
      const route = compiled.find((r) => r.method === req.method && r.re.test(pathname));
      if (!route) return send(res, 404, page({ title: "Not found", nav: navFor(pathname), body: `<h1>Not found</h1><p class="muted">${esc(pathname)}</p>`, brand }));
      const m = route.re.exec(pathname);
      const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const form = req.method === "POST" ? await readForm(req) : {};
      const out = await route.handler({ params, query: Object.fromEntries(url.searchParams), form, url });

      if (out.redirect) { res.writeHead(303, { location: out.redirect }); return res.end(); }
      if (out.file) {
        if (!existsSync(out.file)) return send(res, 404, page({ title: "Not found", nav: navFor(pathname), body: `<h1>Not found</h1><p class="muted">${esc(out.file)}</p>`, brand }));
        res.writeHead(200, { "content-type": out.type ?? TYPES[extname(out.file)] ?? "application/octet-stream", ...(out.headers ?? {}) });
        return res.end(readFileSync(out.file));
      }
      if (out.work) {
        // A door that takes minutes: the page opens at once, each progress line lands as it happens.
        res.writeHead(200, { "content-type": TYPES[".html"], "x-accel-buffering": "no" });
        const shell = page({ title: out.title, nav: navFor(pathname), body: `<h1>${esc(out.title)}</h1><pre class="log">`, brand });
        res.write(shell.slice(0, shell.lastIndexOf("</main>")));
        let href;
        try {
          href = await out.work((line) => res.write(esc(line) + "\n"));
        } catch (e) {
          res.write(`</pre>${refusalHtml(e)}<p><a href="${esc(out.back ?? "/")}">Back</a></p></main></body></html>`);
          return res.end();
        }
        res.write(`</pre><p>Done — <a href="${esc(href)}">continue</a>.</p><script>location.replace(${JSON.stringify(href)})</script></main></body></html>`);
        return res.end();
      }
      return send(res, out.status ?? 200, page({ title: out.title, nav: navFor(pathname), body: out.body, brand }));
    } catch (e) {
      return errorPage(res, pathname, e);
    } finally {
      if (mutating) busy = false;
    }
  });

  return new Promise((ok, no) => {
    server.once("error", no);
    server.listen(port, host, () => {
      const a = server.address();
      trusted = new Set([`${host}:${a.port}`, `localhost:${a.port}`]);
      origins = new Set([...trusted].map((t) => `http://${t}`));
      ok({ server, url: `http://${host}:${a.port}`, port: a.port, close: () => new Promise((r) => server.close(r)) });
    });
  });
}
