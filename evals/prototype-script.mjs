#!/usr/bin/env node
// owns: R2, R15 · shared — DH1b 6: parse-only publication gate. Scripted builds,
// including first builds and rebuilds, keep publication atomic and retain billed cost.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { suite, withRoot, scripted } from "./_harness.mjs";
import { seedProject, SCREENS, HTML } from "./_fixture.mjs";
import { generate, GATE } from "../discovery/prototype/index.mjs";
import { Refused, HTML_FILE, PROTOTYPE_FILE, REVIEWS, readVerdict } from "../discovery/record/index.mjs";
import { ledgerPath } from "../discovery/setup/index.mjs";
import { rows } from "../shared/agent-call/ledger.mjs";

const { check, done } = suite("prototype-script · DH1b 6 parse-only publication", 176);
const build = (html) => ({ html, screens: structuredClone(SCREENS), uncovered: ["REQ-4"], notes: "Script gate fixture", open_questions: [] });
const bytes = (root, file) => existsSync(join(root, file)) ? readFileSync(join(root, file)) : null;
const same = (a, b) => a === null ? b === null : b !== null && a.equals(b);
const files = [HTML_FILE, PROTOTYPE_FILE, join(REVIEWS, `${GATE}.json`)];
const attempt = async (fn) => { try { return { value: await fn() }; } catch (error) { return { error }; } };
const describe = (out) => out.error ? `${out.error.code}: ${out.error.message}` : "published";
const broken = "if(a)h+='x'+(1):'';";
const invalid = [
  ["classic", `<script>${broken}</script>`, /script/i],
  ["empty type", `<script type="">${broken}</script>`, /script/i],
  ["text JavaScript MIME", `<script type="text/javascript">${broken}</script>`, /script/i],
  ["application JavaScript MIME", `<script type="application/javascript">${broken}</script>`, /script/i],
  ["module", '<script type="module">export const value = ;</script>', /script|module/i],
  ["handler", '<button onclick="if (">Broken</button>', /onclick/i],
  ["second script", `<script>const fine = 1;</script><script>${broken}</script>`, /script/i],
  // Attribute-looking text inside a value must not hide an inline classic script.
  ["src text inside a quoted value", '<script data-note=" src=local.js">if(</script>', /script/i],
  ["type text inside a quoted value", '<script data-note=" type=application/json">if(</script>', /script/i],
  // Consuming whole values must still find actual handlers in these tag forms.
  ["unquoted handler", '<button onclick=if(>Broken</button>', /onclick/i],
  ["handler after bare attribute", '<button disabled onclick="if (">Broken</button>', /onclick/i],
  ["self-closing handler", '<img onerror="if ("/>', /onerror/i],
  ["handler still invalid after entity decoding", '<button onclick="return &quot;unterminated;">Broken</button>', /onclick/i],
  ["inline script tag handler", '<script onload="if (">const ready = true;</script>', /onload/i],
  ["src script tag handler", '<script src="local.js" onerror="if ("></script>', /onerror/i],
];

for (const [name, fragment, location] of invalid) {
  for (const rebuild of [false, true]) {
    await withRoot({}, async (parent) => {
      const root = seedProject(parent);
      if (rebuild) {
        const initial = scripted({ structured: build(HTML) });
        // Setup must actually publish all three files; any setup error aborts the suite.
        await generate({ root, _query: initial.query });
        if (files.some((file) => bytes(root, file) === null)) throw new Error("incomplete rebuild fixture");
      }
      const before = files.map((file) => bytes(root, file));
      const callsBefore = rows(ledgerPath(root)).length;
      const sdk = scripted({ structured: build(HTML + fragment), usd: 0.37 });
      const out = await attempt(() => generate({ root, _query: sdk.query, _sleep: async () => { throw new Error("unexpected retry sleep"); } }));
      const label = `${name}, ${rebuild ? "rebuild" : "first build"}`;
      // Require both location and a useful parser diagnostic without pinning parser wording.
      check(`${label}: refuses as html-script-invalid with location and parser message`,
        out.error instanceof Refused && out.error.code === "html-script-invalid" && location.test(out.error.message)
          && /unexpected|syntax|token|expected|unterminated|expression/i.test(out.error.message.replace(/html-script-invalid/g, "")), describe(out));
      for (const [i, file] of files.entries()) {
        check(`${label}: ${file} stays ${rebuild ? "byte-identical" : "absent"}`, same(before[i], bytes(root, file)));
      }
      const ledger = rows(ledgerPath(root)), last = ledger.at(-1);
      check(`${label}: one billed call, no automatic retry`, sdk.calls.length === 1 && ledger.length === callsBefore + 1
        && last.stage === "prototype" && last.role === "writer" && last.usd === 0.37 && last.ok === true, JSON.stringify(last));
    });
  }
}

const valid = [
  ["classic, module-only syntax, and a handler function body", '<script>const count = 1;</script><script type="module">export const source = import.meta.url; await Promise.resolve();</script><button onclick="return false;">OK</button>'],
  ["empty and JavaScript MIME types", '<script type="">let empty = 1;</script><script type="text/javascript">let text = 2;</script><script type="application/javascript">let app = 3;</script>'],
  ["non-JavaScript JSON text", '<script type="application/json">{"message":"not JavaScript"}</script>'],
  ["non-JavaScript template", `<script type="text/template">${broken}</script>`],
  ["HTML comment containing broken script and handler", `<!-- <script>${broken}</script><button onclick="if ("> -->`],
  ["external local script body is not inline JavaScript", `<script src="local.js">${broken}</script>`],
  // If validation executes this classic script it throws. Parsing alone must publish it.
  ["parseable runtime failure is outside the gate", '<script>throw new Error("must never execute while publishing");</script>'],
  ["handler text inside a double-quoted title", `<button title=" onclick='if('">OK</button>`],
  ["handler text inside a single-quoted title before a real valid handler", `<button title=' onclick="if("' onclick="return false;">OK</button>`],
  ["handler with named quote entities", '<button onclick="say(&quot;hi&quot;);">OK</button>'],
  ["handler with encoded logical AND", '<button onclick="return ready &amp;&amp; enabled;">OK</button>'],
  ["handler with numeric quote entities", '<button onclick="say(&#39;hi&#39;);">OK</button>'],
  ["valid script tag handler function body", '<script onload="return false;">const ready = true;</script>'],
];
for (const [name, fragment] of valid) {
  await withRoot({}, async (parent) => {
    const root = seedProject(parent), html = HTML + fragment;
    const sdk = scripted({ structured: build(html) });
    const out = await attempt(() => generate({ root, _query: sdk.query }));
    check(`${name}: publishes exact HTML`, !out.error && bytes(root, HTML_FILE)?.equals(Buffer.from(html)), describe(out));
    check(`${name}: publishes record and passing arithmetic after one call`, !out.error && bytes(root, PROTOTYPE_FILE) !== null
      && readVerdict(root, GATE)?.verdict === "pass" && sdk.calls.length === 1);
  });
}

done();
