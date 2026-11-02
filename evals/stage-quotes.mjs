#!/usr/bin/env node
// owns: R1, R15 · shared — DH1b 6: each paid trigger quotes its own stage and
// role; budget standing still includes the whole project. No server or model runs.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { suite, withRoot } from "./_harness.mjs";
import { seedProject, seedPrototype } from "./_fixture.mjs";
import { append, estimate, quote, standing } from "../shared/agent-call/ledger.mjs";
import { modelFor } from "../shared/agent-call/index.mjs";
import { ledgerPath, loadProject, PROJECT_FILE } from "../discovery/setup/index.mjs";
import { routes } from "../discovery/console/index.mjs";

const { check, done } = suite("stage-quotes · DH1b 6 estimates and paid buttons", 28);
const near = (a, b) => typeof a === "number" && Math.abs(a - b) < 1e-9;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const identity = { half: "discovery", role: "writer", model: modelFor({ half: "discovery", role: "writer" }) };
const history = (usd, n) => ({ usd, n, basis: "history" });
const none = { usd: null, n: 0, basis: "none" };

await withRoot({}, (root) => {
  const ledger = join(root, "calls.jsonl");
  const row = (stage, usd, extra = {}) => append(ledger, { ...identity, stage, ok: true, usd, ...extra });
  row("workshop", 0.08);
  row("workshop", 0.12);
  row("prototype", 1.40);
  row("stories", 1.00);
  row("prototype", undefined, { call: "open", ok: null });
  row("prototype", 0, { usd_unknown: true });
  row("prototype", 0.30, { ok: false });
  row("prototype", 9, { model: "other-model" });
  row("prototype", 5, { half: "delivery" });
  row("reaction", 0, { usd_unknown: true });
  const options = { ...identity, stage: "prototype", budget: 20 };
  check("prototype estimate excludes extractions, other stages, open/unknown/failed rows, other models and halves",
    equal(estimate(ledger, options), history(1.40, 1)), JSON.stringify(estimate(ledger, options)));
  check("workshop writer counts only extractions", equal(estimate(ledger, { ...identity, stage: "workshop" }), history(0.10, 2)));
  const legacy = estimate(ledger, identity);
  check("without stage the existing cross-stage mean and sample count survive", near(legacy.usd, 0.65) && legacy.n === 4 && legacy.basis === "history", JSON.stringify(legacy));
  check("quote forwards stage to the estimate", equal(quote(ledger, options).estimate, history(1.40, 1)), JSON.stringify(quote(ledger, options)));
  check("a stage with only unknown cost has no estimate", equal(estimate(ledger, { ...identity, stage: "reaction" }), none));
  check("quote without stage keeps the existing estimate", equal(quote(ledger, identity).estimate, legacy));
  const allModels = estimate(ledger, { half: "discovery", role: "writer", stage: "prototype" });
  check("omitting model still includes all models within the requested stage", near(allModels.usd, 5.20) && allModels.n === 2, JSON.stringify(allModels));
  const q = quote(ledger, options);
  check("stage quote budget counts every half, stage, model, failed cost and unknown call",
    near(q.spent, 16.90) && near(q.remaining, 3.10) && q.budget === 20 && q.unknown === 3 && q.over === false, JSON.stringify(q));
  const { estimate: ignored, ...budget } = q;
  check("stage filtering leaves standing exactly project-wide", equal(budget, standing(ledger, 20)));
});

const page = async (root, path, params = {}) => (await routes({ root }).find((r) => r.method === "GET" && r.path === path).handler({ params })).body;
// Read the quote before this specific form, not an amount elsewhere on the page.
// The stories Agree form may stand between its writer quote and Write.
function beforeButton(html, action) {
  const at = html.indexOf(`action="${action}"`);
  if (at < 0) return "";
  const before = html.slice(0, at);
  return [...before.matchAll(/<p class="quote(?: over)?">([\s\S]*?)<\/p>/g)].at(-1)?.[1] ?? "";
}

await withRoot({}, async (parent) => {
  const root = seedProject(parent), ledger = ledgerPath(root);
  append(ledger, { ...identity, stage: "workshop", ok: true, usd: 0.10 });
  const html = await page(root, "/board");
  check("Generate says no history yet when only extraction history exists", beforeButton(html, "/prototype/generate").includes("no history yet"), beforeButton(html, "/prototype/generate"));
});

await withRoot({}, async (parent) => {
  const root = seedProject(parent), ledger = ledgerPath(root);
  writeFileSync(join(root, PROJECT_FILE), JSON.stringify({ ...loadProject(root), budget: 20 }));
  seedPrototype(root); // React is offered only for a current prototype.
  const buttons = [
    ["Say it", "workshop", "workshop", 0.11, "/workshop/:key", "/workshop/problem/turn"],
    ["Extract", "workshop", "writer", 0.22, "/workshop/:key", "/workshop/problem/extract"],
    ["Generate", "prototype", "writer", 1.40, "/board", "/prototype/generate"],
    ["stories Write", "stories", "writer", 0.33, "/board", "/stories/write"],
    ["stories Review", "stories", "reviewer", 0.44, "/board", "/stories/review"],
    ["design Write", "design", "writer", 0.55, "/board", "/design/write"],
    ["design Review", "design", "reviewer", 0.66, "/board", "/design/review"],
    ["React", "reaction", "writer", 0.77, "/prototype", "/prototype/react"],
  ];
  for (const [, stage, role, usd] of buttons) {
    append(ledger, { half: "discovery", stage, role, model: modelFor({ half: "discovery", role }), ok: true, usd });
  }
  append(ledger, { ...identity, half: "delivery", stage: "sdd", ok: true, usd: 2 });
  append(ledger, { ...identity, stage: "prototype", ok: false, usd: 0.50 });
  append(ledger, { ...identity, stage: "prototype", call: "open", ok: null });
  append(ledger, { ...identity, stage: "design", ok: true, usd: 0, usd_unknown: true });
  const pages = new Map();
  for (const path of new Set(buttons.map((b) => b[4]))) pages.set(path, await page(root, path, { key: "problem" }));
  for (const [label, , role, usd, path, action] of buttons) {
    const strip = beforeButton(pages.get(path), action);
    check(`${label}: its own stage and role estimate, model and sample count`,
      strip.includes(`~$${usd.toFixed(2)} a call (1 so far)`) && strip.includes(modelFor({ half: "discovery", role })), strip);
    check(`${label}: project-wide spent, remaining and unknown cost`,
      strip.includes("$6.98 of $20.00 spent") && strip.includes("$13.02 remains") && strip.includes("2 calls of unknown cost"), strip);
  }
  const workshop = pages.get("/workshop/:key");
  const extractForm = workshop.match(/<form\b[^>]*action="\/workshop\/problem\/extract"[\s\S]*?<\/form>/)?.[0] ?? "";
  check("Extract note drops the false shared-quote and moving-status claims", !!extractForm && !/same model, same quote|status moves with it/i.test(extractForm), extractForm);
  check("Extract note explains capture and that the section stays open until workshop completion",
    /transcript|PRD|fields|extract/i.test(extractForm) && /open/i.test(extractForm) && /workshop/i.test(extractForm) && /complete/i.test(extractForm), extractForm);
});

done();
