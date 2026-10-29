#!/usr/bin/env node
// owns: R10 · shared — eval: coherence. One concept, one home: every place a concept is
// restated is joined back to the home and the join is checked both ways. Absorbs v1's
// prompts (identity refusals), schema-coverage (contract ↔ mechanics) and module-graph
// (declared deps ↔ imports, imports ↔ uses). Seeded cases first, then the real tree.
// The console is a projection of the record — every view is checked against the record
// it was read from, and every trigger on it goes through a door with its cost shown first.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { suite, withRoot, scripted, ROOT } from "./_harness.mjs";
import { refresh, seedProject, seedPrototype, seedStories, seedDesign, seedDelivery, coldRoot, reexport, BINDING, STORIES } from "./_fixture.mjs";
import { names, load, contractOf, fieldsOf, fields, outputContract } from "../shared/schema/index.mjs";
import { identity, mechanics, namedFields, target } from "../shared/prompt/index.mjs";
import { SEVERITY, CONFIDENCE, JUDGE_ROLE } from "../shared/judge/index.mjs";
import { HALVES, defaults, roles } from "../shared/agent-call/index.mjs";
import { serve } from "../shared/console/index.mjs";
import { setupView, workshopView, boardView, exportView, VIEWS } from "../discovery/console/views.mjs";
import { routes } from "../discovery/console/index.mjs";
import { runView, doorsFor } from "../delivery/console/views.mjs";
import { routes as deliveryRoutes } from "../delivery/console/index.mjs";
import { readRun, transition, DEFAULTS as RUN_DEFAULTS, LEDGER } from "../delivery/state/index.mjs";
import { VERDICT_FILE as SDD_VERDICT } from "../delivery/sdd/index.mjs";
import { readDoc } from "../shared/store.mjs";
import { append as appendLedger } from "../shared/agent-call/ledger.mjs";
import { setupProject, loadProject, PROJECT_FILE } from "../discovery/setup/index.mjs";
import { loadPrd, readTranscript } from "../discovery/workshop/index.mjs";
import { SECTIONS } from "../discovery/workshop/sections.mjs";
import { review as reviewDesign, REVIEW_GATE as DESIGN_REVIEW } from "../discovery/design/index.mjs";
import { agree } from "../discovery/doors/index.mjs";
import { GATE as EXPORT_GATE } from "../discovery/export/index.mjs";
import rules from "../shared/rules.json" with { type: "json" };

const { check, done } = suite("coherence · one home per concept", 210);

const same = (a, b) => a.length === b.length && [...a].sort().join("\0") === [...b].sort().join("\0");
const deepKeys = (node, out = new Set()) => {
  if (Array.isArray(node)) node.forEach((n) => deepKeys(n, out));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) { out.add(k); deepKeys(v, out); }
  return out;
};

// ── output contract: the model sees the schema minus the runner's fields ──
{
  const seeded = {
    $id: "x", title: "t", type: "object",
    required: ["a", "g"],
    properties: {
      a: { type: "string", maxLength: 40, "x-note": "kept field, dropped extension" },
      g: { type: "string", "x-runner": true },
      list: { type: "array", items: { $ref: "#/$defs/item" } },
    },
    $defs: { item: { type: "object", properties: { s: { enum: ["hi", "lo"] } } } },
  };
  const c = contractOf(seeded);
  check("seeded: an x-runner field is cut from properties and required", !("g" in c.properties) && same(c.required, ["a"]));
  check("seeded: a plain field survives with its enum reachable through the inlined ref", "a" in c.properties && c.properties.list.items.properties.s.enum.join() === "hi,lo");
  const keys = deepKeys(c);
  check("seeded: nothing the model should not see remains — no $ref, $defs, $id, title, x-*", ![...keys].some((k) => k === "$ref" || k === "$defs" || k === "$id" || k === "title" || k.startsWith("x-")), [...keys].join(","));
  check("seeded: fieldsOf walks into array items with the [] marker", same(fieldsOf(c).map((f) => f.path), ["/a", "/list", "/list[]/s"]));
  check("seeded: fieldsOf carries a field's ceiling, and null where there is none", fieldsOf(c).find((f) => f.path === "/a").maxLength === 40 && fieldsOf(c).find((f) => f.path === "/list").maxLength === null);
}
for (const name of names()) {
  const full = load(name);
  const c = outputContract(name);
  const runner = Object.entries(full.properties ?? {}).filter(([, p]) => p["x-runner"]).map(([k]) => k);
  check(`${name}: contract drops exactly the x-runner fields (${runner.join(", ") || "none"})`,
    runner.every((k) => !(k in c.properties)) && Object.keys(full.properties).filter((k) => !runner.includes(k)).every((k) => k in c.properties));
  const keys = [...deepKeys(c)];
  check(`${name}: contract is self-contained on the wire`, !keys.some((k) => k === "$ref" || k === "$defs" || k.startsWith("x-")), keys.filter((k) => k === "$ref" || k.startsWith("x-")).join(","));
}

// ── mechanics ↔ contract: the prompt names every field the contract holds, and none it lacks ──
{
  for (const name of names()) {
    for (const kind of ["judge", "writer"]) {
      const text = mechanics({ kind, schema: name, scope: { mvp: "m", deferred: [] }, rulings: [{ id: "Q1", question: "q", answer: "a" }], arithmetic: ["r"] });
      const named = namedFields(text);
      const held = fields(name).map((f) => f.path);
      check(`${name}/${kind}: mechanics names exactly the contract's fields (${held.length})`, same(named, held),
        `named-not-held ${named.filter((p) => !held.includes(p)).join(",")} · held-not-named ${held.filter((p) => !named.includes(p)).join(",")}`);
      for (const f of fields(name).filter((f) => f.enum)) {
        check(`${name}/${kind}: every enum value of ${f.path} is offered in the prompt`, f.enum.every((v) => text.includes(`\`${v}\``)));
      }
      // A ceiling the contract validates is a ceiling the model is told, on the line that names the field —
      // a model that learns it only by rejection writes to it, and one that cannot squeeze under it fails the call.
      // And told the ceiling alone, it writes to the ceiling (Bakehouse sdd: mean 382 of 400, one at 403 after
      // five retries) — so the same line carries a target under it, derived from it, that a miscount cannot overrun.
      for (const f of fields(name).filter((f) => f.maxLength != null)) {
        const line = text.split("\n").find((l) => l.includes(`\`${f.path}\``)) ?? "";
        check(`${name}/${kind}: the ceiling on ${f.path} is stated where the field is named (${f.maxLength})`, line.includes(`at most ${f.maxLength} characters`), line);
        const aim = Number(line.match(/aim for (\d+)/)?.[1]);
        check(`${name}/${kind}: the line names a target well under the ceiling on ${f.path}`, aim > 0 && aim <= f.maxLength * 0.8 && aim === target(f.maxLength), line);
      }
    }
  }
  const capped = fields("finding").filter((f) => f.maxLength != null).map((f) => f.path);
  check("the finding contract's summaries are capped — the ceiling checks above are not vacuous", capped.includes("/findings[]/summary") && capped.includes("/deferred[]/summary"), capped.join(","));
  const drifted = mechanics({ kind: "judge", schema: "finding" }) + "\n- `/findings[]/bogus` (required)";
  check("seeded: a field the prompt names but the contract lacks is caught", !same(namedFields(drifted), fields("finding").map((f) => f.path)));

  // The severity and confidence ladders the ranking text quotes are the schema's, in order.
  const text = mechanics({ kind: "judge", schema: "finding" });
  const sev = fields("finding").find((f) => f.path === "/findings[]/severity").enum;
  const conf = fields("finding").find((f) => f.path === "/findings[]/confidence").enum;
  check("ranking quotes the schema's severity ladder in its order", text.includes(`(${sev.join(" > ")})`) && same(Object.keys(SEVERITY), sev));
  check("ranking quotes the schema's confidence ladder in its order", text.includes(`(${conf.join(" > ")})`) && same(Object.keys(CONFIDENCE), conf));
  check("the blocking pair in the ranking text is the top of each ladder", text.includes(`\`${sev[0]}\` + \`${conf[0]}\` blocks`));
}

// ── identity: authored, never substituted ──
withRoot({
  "holed.md": "# Reviewer\n\nYou review {{stage}} for {{product}}.",
  "empty.md": "\n\n",
  "clean.md": "# Reviewer\n\nYou hold stories to the bar a senior PM would.",
}, (root) => {
  const attempt = (f) => { try { identity(join(root, f)); return null; } catch (e) { return e.message; } };
  const holed = attempt("holed.md");
  check("seeded: a holed identity is refused, naming its holes", /\{\{stage\}\}, \{\{product\}\}/.test(holed ?? ""), holed);
  check("seeded: an empty identity is refused", /is empty/.test(attempt("empty.md") ?? ""));
  check("seeded: a clean identity loads as written", attempt("clean.md") === null && identity(join(root, "clean.md")).startsWith("# Reviewer"));
});
{
  const prompts = [];
  for (const half of HALVES) walk(join(ROOT, half), (f) => { if (/\/prompts\/[^/]+\.md$/.test(f)) prompts.push(f); });
  const bad = prompts.filter((f) => { try { identity(f); return false; } catch { return true; } });
  check(`real tree: every identity under the halves loads (${prompts.length} found, ${bad.length} refused)`, bad.length === 0, bad.map((f) => relative(ROOT, f)).join(","));
}

// ── models: one config, keyed half.role, holding every role a runner bills by default ──
{
  const keys = Object.keys(defaults());
  const malformed = keys.filter((k) => { const [h, r, ...more] = k.split("."); return !HALVES.includes(h) || !r || more.length; });
  check(`models.json keys are <half>.<role> over the calling halves (${keys.length})`, keys.length > 0 && malformed.length === 0, malformed.join(","));
  const missing = Object.entries(JUDGE_ROLE).map(([h, r]) => `${h}.${r}`).filter((k) => !keys.includes(k));
  check("the judge runner's default role per half is configured", missing.length === 0, missing.join(","));
  const bogus = Object.values(defaults()).filter((m) => typeof m !== "string" || !/^claude-/.test(m));
  check("every configured model is a claude model id", bogus.length === 0, bogus.join(","));
}

// ── rules: the registry and the spec are the same list; implemented rules are proved where the registry says ──
{
  const spec = readFileSync(join(ROOT, "SPEC.md"), "utf8");
  const inSpec = new Map([...spec.matchAll(/^\*\*(R\d+) · (.+?)\*\* `(\w+)`$/gm)].map((m) => [m[1], { statement: m[2], half: m[3] }]));
  check(`rules.json and SPEC.md §3 hold the same rule ids (${rules.rules.length})`, same([...inSpec.keys()], rules.rules.map((r) => r.id)),
    `spec-only ${[...inSpec.keys()].filter((id) => !rules.rules.some((r) => r.id === id)).join(",")} · registry-only ${rules.rules.filter((r) => !inSpec.has(r.id)).map((r) => r.id).join(",")}`);
  const differ = rules.rules.filter((r) => inSpec.get(r.id) && (inSpec.get(r.id).statement !== r.statement || inSpec.get(r.id).half !== r.half)).map((r) => r.id);
  check("each rule's statement and half read the same in both homes", differ.length === 0, differ.join(","));

  // The *enforcer* clause under each rule, read in sequence, is the registry's enforcer (code spans are prose here) and eval.
  const clauses = new Map();
  let current = null;
  for (const line of spec.split("\n")) {
    const h = line.match(/^\*\*(R\d+) · /);
    if (h) current = h[1];
    const e = current && line.match(/^\*evidence\* .*\*enforcer\* (.+?)(?: · eval `([a-z-]+)`(?:, [^·]+)?)?$/);
    if (e) clauses.set(current, { enforcer: e[1].replace(/`/g, ""), eval: e[2] ?? null });
  }
  const enforcerDrift = rules.rules.filter((r) => !clauses.has(r.id) || clauses.get(r.id).enforcer !== r.enforcer || clauses.get(r.id).eval !== r.eval)
    .map((r) => `${r.id}: registry "${r.enforcer}" / ${r.eval} · spec "${clauses.get(r.id)?.enforcer}" / ${clauses.get(r.id)?.eval}`);
  check("each rule's enforcer and eval read the same in both homes", clauses.size === rules.rules.length && enforcerDrift.length === 0, enforcerDrift.join("; "));

  const WORDS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14 };
  const [, word, tenLine] = spec.match(/^- \*\*Evals, ([a-z]+)\*\* — (.+)$/m) ?? [, "", ""];
  const ten = [...tenLine.matchAll(/`([a-z-]+)`/g)].map((m) => m[1]);
  // The word and the list are two statements of one number, and either can drift.
  check(`SPEC §6 says ${word || "(no count)"} and names that many evals`, WORDS[word] === ten.length && ten.length > 0, `${word}: ${ten.join(",")}`);
  const stray = rules.rules.filter((r) => r.eval && !ten.includes(r.eval)).map((r) => `${r.id}→${r.eval}`);
  check("every eval a rule names is one §6 lists", stray.length === 0, stray.join(","));
  const claimed = new Map([...tenLine.matchAll(/`([a-z-]+)` \(([^)]*)\)/g)].flatMap((m) => [...m[2].matchAll(/R\d+/g)].map((r) => [r[0], m[1]])));
  const disagree = rules.rules.filter((r) => r.eval && claimed.has(r.id) && claimed.get(r.id) !== r.eval).map((r) => `${r.id}: registry ${r.eval}, §6 ${claimed.get(r.id)}`);
  check("where §6 assigns a rule to an eval, the registry agrees", disagree.length === 0, disagree.join("; "));

  // A rule some module owns is implemented; its named eval must then exercise it.
  const owned = new Set();
  const evalOwns = new Map();
  for (const dir of [...HALVES, "shared"]) walk(join(ROOT, dir), (f) => { for (const id of ownsOf(f)) owned.add(id); });
  for (const f of readdirSync(join(ROOT, "evals"))) if (f.endsWith(".mjs")) evalOwns.set(f.replace(/\.mjs$/, ""), ownsOf(join(ROOT, "evals", f)));
  const unproved = rules.rules.filter((r) => r.eval && owned.has(r.id) && !(evalOwns.get(r.eval) ?? []).includes(r.id)).map((r) => `${r.id} via ${r.eval}`);
  check(`every implemented rule with a named eval is owned by that eval (${[...owned].filter((id) => rules.rules.find((r) => r.id === id)?.eval).length} checked)`, unproved.length === 0, unproved.join(","));
  const absent = ten.filter((e) => !evalOwns.has(e));
  check(`evals present so far: ${ten.length - absent.length}/10${absent.length ? ` (pending: ${absent.join(", ")})` : ""}`, true);
}

// ── module graph: declarations are checked, not trusted ──
{
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const deps = new Set(Object.keys(pkg.dependencies ?? {}));
  const dev = new Set(Object.keys(pkg.devDependencies ?? {}));
  const mods = [];
  for (const dir of [...HALVES, "shared", "tools"]) walk(join(ROOT, dir), (f) => { if (/\.(mjs|cjs|js|ts|tsx|jsx)$/.test(f)) mods.push(f); });

  const seeded = graphOf(`import { a, b, c, d } from "./x.mjs";\nimport fs from "node:fs";\nimport Ajv from "ajv/dist/2020.js";\nimport y from "left-pad";\nexport const z = { ...c("k"), v: a + fs.x, w: fs.d };`);
  check("seeded: bare imports resolve to their package name", same(seeded.packages, ["ajv", "left-pad"]));
  check("seeded: an imported name that is never used is caught — a spread is a use, a property access is not", same(seeded.unused, ["b", "d", "Ajv", "y"]), seeded.unused.join(","));

  const undeclared = [], devOnly = [], unused = [];
  for (const f of mods) {
    const g = graphOf(readFileSync(f, "utf8"));
    for (const p of g.packages) {
      if (dev.has(p) && !deps.has(p)) devOnly.push(`${relative(ROOT, f)} → ${p}`);
      else if (!deps.has(p)) undeclared.push(`${relative(ROOT, f)} → ${p}`);
    }
    for (const n of g.unused) unused.push(`${relative(ROOT, f)}: ${n}`);
  }
  check(`real tree: every package a module imports is a declared dependency (${mods.length} modules)`, undeclared.length === 0, undeclared.join("; "));
  check("real tree: no production module imports a devDependency", devOnly.length === 0, devOnly.join("; "));
  check("real tree: no module imports a name it never uses", unused.length === 0, unused.join("; "));
}

// ── console: the record projected, never retyped; cost before every trigger (R1); freshness by pin, never by presence (R5) ──
await withRoot({}, async (tmp) => {
  check("the six views are the spec's six, in its order", VIEWS.map((v) => v.key).join() === "setup,workshop,board,export,run,release", VIEWS.map((v) => v.key).join());

  // Setup: no project yet → the offer; a project → model per role from the one config, overrides visible.
  const bare = join(tmp, "bare");
  mkdirSync(bare);
  const s0 = setupView(bare);
  check("with no project, setup offers to create one at the root: slug from the directory, every role the config knows at its default",
    s0.project === null && s0.slug === "bare" && s0.existing === false && s0.roles.map((r) => r.key).join() === roles().join() && s0.roles.every((r) => r.model === defaults()[r.key] && !r.overridden), JSON.stringify(s0).slice(0, 200));
  const root = seedProject(tmp);
  const project = loadProject(root);
  writeFileSync(join(root, PROJECT_FILE), JSON.stringify({ ...project, models: { "discovery.reviewer": "claude-sonnet-5" }, budget: 20 }, null, 2) + "\n");
  const s1 = setupView(root);
  check("a project's setup shows model per role — the override on the reviewer named, every other role at the shared default, Delivery's three roles (writer, judge, builder) beside Discovery's",
    s1.project.slug === "dock" && s1.roles.length === roles().length && s1.roles.find((r) => r.key === "discovery.reviewer").model === "claude-sonnet-5" && s1.roles.find((r) => r.key === "discovery.reviewer").overridden && s1.roles.find((r) => r.key === "delivery.judge").model === defaults()["delivery.judge"] && s1.roles.filter((r) => r.half === "delivery").map((r) => r.role).join() === "writer,judge,builder", JSON.stringify(s1.roles));
  check("budget and spend come from the record and the ledger — nothing spent yet, the whole budget remains", s1.standing.budget === 20 && s1.standing.spent === 0 && s1.standing.remaining === 20 && s1.standing.over === false && s1.cost.length === 0);

  // Workshop: sections in the spec's order, shape before scope surfaced as a reason, the quote before the first turn.
  const w0 = workshopView(root);
  check("the workshop view lists the sections in their one order and opens on the first that is not complete",
    w0.sections.map((s) => s.key).join() === SECTIONS.map((s) => s.key).join() && w0.current.key === "problem" && w0.transcript.length === 0, JSON.stringify(w0.sections.map((s) => s.key)));
  check("a section that cannot open yet says why — shape first (R12) — rather than offering a turn", w0.sections.find((s) => s.key === "requirements").may_open === false && /shape/.test(workshopView(root, "requirements").current.why), workshopView(root, "requirements").current.why);
  check("the quote strip is on the view before any turn: model, no history, the budget and what remains", w0.quote.model === defaults()["discovery.workshop"] && w0.quote.estimate.basis === "none" && w0.quote.remaining === 20);
  check("what the record already holds is on the view, derived by the workshop's own summary", w0.captured.includes("MVP line: One door, one shift, no exports."));

  // Board: artifacts with staleness from the record; gates fresh by pin; the doors' state.
  seedPrototype(root); agree({ root, by: "Brad" }); seedStories(root); seedDesign(root);
  const b0 = boardView(root);
  const art = (b, kind) => b.artifacts.find((a) => a.kind === kind);
  check("the board lists the four artifacts in pipeline order, each present, none stale, the design unsigned",
    b0.artifacts.map((a) => a.kind).join() === "prd,prototype,stories,design" && b0.artifacts.every((a) => a.present) && !art(b0, "prototype").stale && !art(b0, "stories").stale && art(b0, "design").signed === false, JSON.stringify(b0.artifacts.map((a) => [a.kind, a.present, a.stale])));
  check("no verdict has been filed, so every gate reads absent — never inferred from anything but the record", b0.gates.every((g) => g.verdict === null && g.fresh === null) && b0.gates.some((g) => g.gate === DESIGN_REVIEW), JSON.stringify(b0.gates));
  check("the doors' state is the PRD's: two open questions, no rulings, no amendments", b0.open_questions.length === 2 && b0.rulings.length === 0 && b0.amendments.length === 0);
  check("the board quotes the writer and the reviewer before either is triggered", b0.quotes.writer.model === defaults()["discovery.writer"] && b0.quotes.reviewer.model === "claude-sonnet-5" && b0.quotes.reviewer.budget === 20);

  await reviewDesign({ root, _query: scripted({ structured: { findings: [], deferred: [], checked: 2, skipped: 0 }, usd: 0.4 }).query });
  const b1 = boardView(root);
  const gate = (b, g) => b.gates.find((x) => x.gate === g);
  check("a filed verdict shows on its gate with its verdict, its model and what it cost — fresh, because its pins match the record",
    gate(b1, DESIGN_REVIEW).verdict === "pass" && gate(b1, DESIGN_REVIEW).fresh === true && gate(b1, DESIGN_REVIEW).model === "claude-sonnet-5" && gate(b1, DESIGN_REVIEW).usd === 0.4, JSON.stringify(gate(b1, DESIGN_REVIEW)));
  check("the cost on the board is the ledger's: one call, by stage", b1.cost.calls === 1 && b1.cost.usd === 0.4 && Object.keys(b1.cost.by_stage).join() === "design" && setupView(root).standing.remaining === 19.6);

  // The server: every view answers; a door POST lands on the record; a refusal writes nothing.
  const q = scripted({ text: "🏛️ What breaks first when the signal drops?", usd: 0.2 });
  // the two halves meet only in composition — neither imports the other (tools/console does what this line does)
  const srv = await serve({ routes: [...routes({ root, _query: q.query, _exec: () => "", _fetch: () => { throw new Error("no fetch"); }, _env: {} }), ...deliveryRoutes({ root })], port: 0 });
  try {
    const get = async (p, headers = {}) => { const r = await fetch(srv.url + p, { redirect: "manual", headers }); return { status: r.status, location: r.headers.get("location"), text: await r.text() }; };
    const post = async (p, form) => { const r = await fetch(srv.url + p, { method: "POST", headers: { Origin: srv.url }, body: new URLSearchParams(form), redirect: "manual" }); return { status: r.status, location: r.headers.get("location"), text: await r.text() }; };
    const home = await get("/");
    check("the root redirects to the board once a PRD exists", home.status === 303 && home.location === "/board", `${home.status} ${home.location}`);
    const pages = await Promise.all(VIEWS.map((v) => get(`/${v.key}`)));
    check("all six views answer 200; the run view is Delivery's setup until a run exists, and the release view says in one line that it lands with its record", pages.every((p) => p.status === 200) && /Set up Delivery/.test(pages[4].text) && /No handoff Delivery may take|has no <code>\.git<\/code>/.test(pages[4].text) && /M3/.test(pages[5].text), pages.map((p) => p.status).join());
    check("setup prices a Discovery role from the ledger — the design reviewer has one call of history, the writer none, and Delivery's roles are priced on their own view", /discovery\.reviewer<\/code>[^\n]*~\$0\.40 a call/.test(pages[0].text) && /discovery\.writer<\/code>[^\n]*no history yet/.test(pages[0].text) && /delivery\.judge<\/code>[^\n]*priced on the Delivery run view/.test(pages[0].text) && setupView(root).roles.find((r) => r.key === "discovery.reviewer").estimate.n === 1 && setupView(root).roles.find((r) => r.key === "delivery.judge").estimate === null, pages[0].text.match(/<tr>[^\n]*discovery\.reviewer[^\n]*<\/tr>/)?.[0]);
    check("the setup page shows the model per role and the board wears the design-reviewer verdict", pages[0].text.includes("claude-sonnet-5") && pages[0].text.includes("delivery.judge") && pages[2].text.includes(DESIGN_REVIEW) && /pass/.test(pages[2].text));
    check("the prototype the PM reacts to is served from the record's own file", (await get("/prototype/index.html", { "Sec-Fetch-Dest": "iframe" })).text.includes("<h1>Run sheet</h1>"));

    // Export: readiness live, the design's state, the handoffs and their tracker.
    const e0 = exportView(root);
    check("the export view carries the ready gate recomputed live, the exits, and no handoff yet", e0.readiness.gate === EXPORT_GATE && e0.readiness.verdict === "pass" && e0.exits.join() === "team,delivery,both" && e0.handoffs.length === 0 && e0.tracker === null && e0.design === "unsigned", JSON.stringify(e0.readiness.verdict));
    const exported = await post("/export", { exit: "team", by: "Brad", tracker: "" });
    const e1 = exportView(root);
    check("exporting through the console is the export door: v1 on the record, files only, and the view says which tracker — none",
      exported.status === 303 && exported.location === "/export" && e1.handoffs.length === 1 && e1.handoffs[0].exit === "team" && e1.handoffs[0].tracker === null && e1.tracker === null, `${exported.status} ${exported.location} ${JSON.stringify(e1.handoffs)}`);
    const withKeys = JSON.parse(readFileSync(join(root, "discovery/handoffs/handoff-v1.json"), "utf8"));
    withKeys.tracker = { kind: "github", repo: "acme/dock", keys: { "REQ-1": "1", "REQ-2": "2", "STORY-1": "3" } };
    writeFileSync(join(root, "discovery/handoffs/handoff-v1.json"), JSON.stringify(withKeys, null, 2) + "\n");
    const e2 = exportView(root);
    check("tracker state is the latest handoff's: kind, where, and how many items carry a key", e2.tracker.kind === "github" && e2.tracker.where === "acme/dock" && e2.tracker.keyed === 3 && (await get("/export")).text.includes("acme/dock"), JSON.stringify(e2.tracker));

    const ruled = await post("/doors/answer", { req: "REQ-1", oq: "OQ-1", answer: "Yes, until the shift ends.", by: "Brad" });
    const prd = loadPrd(root);
    check("answering through the console is the answer door: a ruling on the PRD, a criterion on the requirement, then back to the board",
      ruled.status === 303 && ruled.location === "/board" && prd.rulings.length === 1 && prd.rulings[0].by === "Brad" && prd.requirements[0].acceptance_criteria.length === 3, `${ruled.status} ${ruled.location} ${prd.rulings.length}`);
    const b2 = boardView(root);
    check("the PRD moved, so the board says so: every downstream artifact stale since RUL-1, and the verdict that was fresh is fresh no longer — by pin, not presence",
      art(b2, "prototype").stale && art(b2, "stories").since.join() === "RUL-1" && art(b2, "design").stale && gate(b2, DESIGN_REVIEW).verdict === "pass" && gate(b2, DESIGN_REVIEW).fresh === false && existsSync(join(root, "discovery/reviews", `${DESIGN_REVIEW}.json`)), JSON.stringify(gate(b2, DESIGN_REVIEW)));
    const refused = await post("/doors/answer", { req: "REQ-1", oq: "OQ-1", answer: "Again.", by: "Brad" });
    check("a refusal renders as the door's own words — its code and message — with a 4xx, and the record did not move",
      refused.status === 409 && refused.text.includes("already-ruled") && refused.text.includes("a settled question is not re-answered") && loadPrd(root).rulings.length === 1, `${refused.status} ${refused.text.slice(0, 200)}`);
    const notReady = await post("/export", { exit: "team", by: "Brad", tracker: "" });
    check("a ruling the stories do not yet prove is a record that does not add up — the export door refuses through the console and no handoff is filed",
      notReady.status === 409 && notReady.text.includes("not-ready") && exportView(root).handoffs.length === 1 && exportView(root).readiness.verdict === "block", `${notReady.status} ${exportView(root).readiness.verdict}`);

    // Amendments through the console: propose, then the radius as it stands now — one box per item, each beside its own label — approved only whole.
    const proposed = await post("/doors/propose", { target: "/requirements/0/statement", to: "A dock lead records an exception at the door against a delivery, one-handed.", rationale: "The crux says one-handed; the requirement should too.", by: "Brad" });
    const amd = boardView(root).amendments.at(-1);
    const radius = amd ? [...amd.radius_now.criteria, ...amd.radius_now.stories, ...amd.radius_now.screens] : [];
    check("proposing through the console is the propose door: the amendment on the record, its radius recomputed against the record as it stands", proposed.status === 303 && amd?.status === "proposed" && radius.length >= 3, `${proposed.status} ${JSON.stringify(amd?.radius_now)}`);
    const boxes = [...(await get("/board")).text.matchAll(/<label class="check" for="([^"]+)"><input type="checkbox" id="([^"]+)" name="radius" value="([^"]+)"><span>touches ([^<]+)<\/span><\/label>/g)];
    check("the board wears the radius as checkboxes — each box before its own label, each with its own id, so the label toggles the box it names",
      boxes.length === radius.length && boxes.every((m) => m[1] === m[2] && m[3] === m[4]) && new Set(boxes.map((m) => m[2])).size === radius.length && same(boxes.map((m) => m[3]), radius), `${boxes.length}/${radius.length} ${JSON.stringify(boxes.map((m) => m[3]))}`);
    const partial = await post("/doors/approve", { id: amd.id, by: "Brad", radius: radius[0] });
    check("one box ticked arrives as one value and the door refuses it — the radius is acknowledged whole or not at all", partial.status === 409 && partial.text.includes("radius-unacknowledged") && loadPrd(root).amendments.at(-1).status === "proposed", `${partial.status} ${partial.text.slice(0, 200)}`);
    const whole = new URLSearchParams({ id: amd.id, by: "Brad" }); for (const r of radius) whole.append("radius", r);
    const approved = await fetch(srv.url + "/doors/approve", { method: "POST", headers: { Origin: srv.url }, body: whole, redirect: "manual" });
    check("every box ticked arrives as a list and the approve door takes it: the amendment approved, the requirement changed, back to the board",
      approved.status === 303 && approved.headers.get("location") === "/board" && loadPrd(root).amendments.at(-1).status === "approved" && loadPrd(root).requirements[0].statement.endsWith("one-handed."), `${approved.status} ${loadPrd(root).amendments.at(-1).status}`);

    const turned = await post("/workshop/problem/turn", { text: "Dock leads lose exceptions between shifts." });
    const rows = readTranscript(root, "problem");
    check("a workshop turn through the console streams its progress and lands on the transcript — through the scripted seam, no model touched (R15)",
      turned.status === 200 && rows.length === 2 && rows[1].from === "workshop" && rows[1].mode === "socratic" && rows[1].usd === 0.2 && q.calls.length === 1 && /workshop\/problem/.test(turned.text), `${turned.status} ${rows.length} ${q.calls.length}`);
    check("the quote after the turn has history to stand on", workshopView(root, "problem").quote.estimate.basis === "history" && workshopView(root, "problem").quote.estimate.usd === 0.2);

  } finally {
    await srv.close();
  }

  // A project with no PRD: the workshop offers to open one, the root leads there.
  const { root: fresh } = setupProject({ slug: "kiln", title: "Kiln", parent: tmp, _exec: () => "" });
  const wf = workshopView(fresh);
  check("before a PRD exists the workshop view is the offer to open one, titled by the project", wf.prd === null && wf.offer.slug === "kiln" && wf.offer.title === "Kiln");
  const srv2 = await serve({ routes: routes({ root: fresh }), port: 0 });
  try {
    const r = await fetch(srv2.url + "/", { redirect: "manual" });
    check("the root of a project without a PRD leads to the workshop", r.status === 303 && r.headers.get("location") === "/workshop");
    const opened = await fetch(srv2.url + "/workshop/open", { method: "POST", headers: { Origin: srv2.url }, body: new URLSearchParams({ title: "Kiln", slug: "kiln", seed: "Fire the load once, not twice." }), redirect: "manual" });
    check("opening the PRD through the console is openPrd, then the workshop", opened.status === 303 && opened.headers.get("location") === "/workshop" && loadPrd(fresh).seed === "Fire the load once, not twice.");
  } finally {
    await srv2.close();
  }
});

// ── console · Delivery: the run view is the run record projected — state in the machine's word, cost from the ledger, doors from the table ──
await withRoot({}, async (tmp) => {
  const CLEAN = (item) => ({ findings: [], deferred: [{ subject: item, summary: `${item}: the second recording against the same delivery in the same second.`, beyond: "untested" }], checked: 1, skipped: 0 });
  const PROVES_NOTHING = { ...CLEAN("STORY-1"), findings: [{ severity: "high", confidence: "certain", rule: "test-proves-nothing", subject: "T-2", summary: "T-2 asserts that no exported function changes the row without naming a function that is called or what is read afterwards.", evidence: "asserts: \"no exported function changes the row\" · REQ-1/AC-2: A submitted exception cannot be edited.", remedy: "Name the calls attempted and the read that follows each." }] };
  let t = Date.parse("2026-09-06T12:00:00Z");
  const clock = () => new Date(t);
  const tick = (ms = 1000) => { t += ms; };
  const { disc, cold: ran } = await seedDelivery(tmp);
  const cold = coldRoot(tmp, disc, "dock-fresh");
  const nogit = join(tmp, "nogit"); mkdirSync(nogit);

  check("the doors per shown state are one table: dead running restarts or stops, a dead re-judge only stops, blocked is the human's three, approved reopens",
    doorsFor({ shown: "dead", status: "running" }).join() === "run,stop" && doorsFor({ shown: "dead", status: "rejudging" }).join() === "stop" && doorsFor({ shown: "blocked", status: "blocked" }).join() === "escalate,approve,stop" && doorsFor({ shown: "approved", status: "approved" }).join() === "reopen" && doorsFor({ shown: "stale", status: "stale" }).join() === "rejudge,stop" && doorsFor({ shown: "pending", status: "pending" }).join() === "run");

  // Before a run: the setup, with each handoff asked the door's own question and the estimate honest about history.
  const s0 = runView(cold);
  check("with no run the view is the setup: the repo verified, the one handoff takeable and signed, offered, and the round priced as 'no history' — ten calls (sdd's writer and three judges, one builder per item, one oracle per item), no number",
    s0.run === null && s0.project === true && s0.handoffs.length === 1 && s0.handoffs[0].refusal === null && s0.handoffs[0].signed === true && s0.handoffs[0].exit === "delivery" && s0.offer === 1 && s0.estimate.calls === 10 && s0.estimate.usd === null && s0.roles.map((r) => r.key).join() === "delivery.writer,delivery.judge,delivery.builder" && s0.defaults === RUN_DEFAULTS, JSON.stringify(s0.handoffs));
  const s1 = runView(nogit);
  check("a root that is not a repository is told so, and offered nothing", s1.project === false && s1.handoffs.length === 0 && s1.offer === null && s1.estimate === null);
  const tampered = JSON.parse(readFileSync(join(cold, "discovery/handoffs/handoff-v1.json"), "utf8"));
  tampered.version = 2; tampered.stories.stories[0].statement += " Edited by hand.";
  writeFileSync(join(cold, "discovery/handoffs/handoff-v2.json"), JSON.stringify(tampered, null, 2) + "\n");
  const s2 = runView(cold);
  check("a handoff edited after export is on the list with the take door's refusal in its own words — and is not the one offered",
    s2.handoffs.length === 2 && s2.handoffs[1].refusal?.code === "handoff-integrity" && /never edited/.test(s2.handoffs[1].refusal.message) && s2.offer === 1, JSON.stringify(s2.handoffs[1].refusal));

  // The reopened writer's answer to the reason: the standing binding with T-2 rewritten to name what it calls and reads.
  // STORY-2 and REQ-4 come back as they were, so their round-1 judgements stand and only STORY-1 is judged again (R1).
  const REBOUND = structuredClone(BINDING); REBOUND.items[0].tests[1].asserts = "each exported function called with the row's id throws or returns the row unchanged, and a read afterwards returns the original reason";
  const script = scripted({ structuredSeq: [BINDING, PROVES_NOTHING, CLEAN("STORY-2"), CLEAN("REQ-4"), REBOUND, CLEAN("STORY-1")], usd: [0.8, 0.2, 0.2, 0.2, 0.8, 0.2] });
  const srv = await serve({ routes: deliveryRoutes({ root: cold, _query: script.query, _now: clock }), port: 0 });
  const get = async (p) => { const r = await fetch(srv.url + p, { redirect: "manual" }); return { status: r.status, location: r.headers.get("location"), text: await r.text() }; };
  const post = async (p, form) => { const r = await fetch(srv.url + p, { method: "POST", headers: { Origin: srv.url }, body: new URLSearchParams(form), redirect: "manual" }); return { status: r.status, location: r.headers.get("location"), text: await r.text() }; };
  try {
    const offer = await get("/run");
    check("the setup page: the takeable handoff and the refused one, 'no history yet' where the price would be, the defaults in the form, one model field per Delivery role",
      offer.status === 200 && /Set up Delivery/.test(offer.text) && /takeable/.test(offer.text) && /handoff-integrity/.test(offer.text) && /no history yet/.test(offer.text) && /no Delivery history to price them yet/.test(offer.text) && offer.text.includes(`name="cap" value="${RUN_DEFAULTS.cap}"`) && offer.text.includes(`name="liveness" value="5"`) && offer.text.includes(`name="model.delivery.judge"`), offer.text.slice(0, 300));
    const bad = await post("/run/setup", { by: "Brad", version: "2", cap: "1" });
    check("setting up on the tampered handoff is the door's refusal, with a 4xx and no run written", bad.status === 409 && /handoff-integrity/.test(bad.text) && readRun(cold) === null, `${bad.status}`);
    const set = await post("/run/setup", { by: "Brad", version: "1", cap: "1", ceiling: "3", liveness: "2", budget: "", "model.delivery.writer": defaults()["delivery.writer"], "model.delivery.judge": "claude-sonnet-5" });
    const run0 = readRun(cold);
    check("setting up through the console is createRun: the pin, the rounds, the window in minutes made milliseconds, no budget, and only the model that differs from the default recorded as an override",
      set.status === 303 && set.location === "/run" && run0.handoff.version === 1 && run0.cap === 1 && run0.ceiling === 3 && run0.liveness_ms === 120_000 && run0.budget === null && JSON.stringify(run0.models) === JSON.stringify({ "delivery.judge": "claude-sonnet-5" }) && run0.by === "Brad", `${set.status} ${JSON.stringify(run0?.models)}`);
    const again = await post("/run/setup", { by: "Brad", version: "1" });
    check("a second setup is refused — one run per root", again.status === 409 && /run-exists/.test(again.text));

    const p0 = await get("/run");
    const v0 = runView(cold, { now: clock() });
    check("the run page before any round: every stage pending in that word, round 0 of 1, intake alone offers Run (the order the runner keeps), sdd offers nothing yet, Advance is offered, and the judge's override is on the roles",
      p0.status === 200 && p0.text.includes(run0.id) && v0.stages.every((s) => s.shown === "pending") && v0.stages[0].doors.join() === "run" && v0.stages[1].doors.length === 0 && v0.advance === true && p0.text.includes('action="/run/intake/run"') && p0.text.includes('action="/run/advance"') && !p0.text.includes('action="/run/sdd/run"') && /0 of 1/.test(p0.text) && /override · default/.test(p0.text) && /no Delivery history/.test(p0.text), JSON.stringify(v0.stages.map((s) => [s.stage, s.shown, s.doors])));

    // Advance through the console: intake approves, sdd blocks at a cap of one — the run page is the loop's outcome in the machine's words.
    const adv = await post("/run/advance", { by: "Brad" });
    const v1 = runView(cold, { now: clock() });
    const sdd = v1.stages.find((s) => s.stage === "sdd");
    check("Advance streams the episode and lands on the record: intake approved, sdd blocked at round 1 of a cap of 1 — no Run door anywhere, the human's three on sdd, Advance withdrawn",
      adv.status === 200 && /blocked at the cap/.test(adv.text) && v1.stages.map((s) => `${s.stage}:${s.shown}:${s.round}`).join() === "intake:approved:1,sdd:blocked:1,build:pending:0,qa:pending:0,release:pending:0" && sdd.doors.join() === "escalate,approve,stop" && v1.stages.every((s) => !s.doors.includes("run")) && v1.advance === false && script.calls.length === 4, `${adv.status} ${JSON.stringify(v1.stages.map((s) => [s.stage, s.shown, s.round, s.doors]))}`);
    check("the verdicts on the page are the filed ones, read by the path the machine recorded and fresh by their pins: intake advises on the snapshot's two open questions with no model behind it (arithmetic), sdd blocks with the judge's model and cost",
      v1.gates.length === 2 && v1.gates[0].verdict === "advise" && v1.gates[0].findings.length === 2 && v1.gates[0].findings.every((f) => f.rule === "question") && v1.gates[0].fresh === true && v1.gates[0].model === null && v1.gates[1].verdict === "block" && v1.gates[1].fresh === true && v1.gates[1].model === "claude-sonnet-5" && Math.abs(v1.gates[1].usd - 0.6) < 1e-9 && v1.gates[1].findings.length === 1 && v1.gates[1].findings[0].rule === "test-proves-nothing" && v1.gates[1].deferred.length === 3, JSON.stringify(v1.gates.map((g) => [g.gate, g.verdict, g.fresh, g.model, g.usd])));
    check("cost is the ledger's, by stage and over the run: intake nothing, sdd one writer and three judges", v1.stages[0].cost.calls === 0 && v1.stages[1].cost.calls === 4 && Math.abs(v1.stages[1].cost.usd - 1.4) < 1e-9 && v1.cost.calls === 4 && Math.abs(v1.cost.usd - 1.4) < 1e-9);
    check("the next sdd round now has a price — the writer's one call and the judge's three, on the models this run chose; the run's own number stays 'no history' while the builder has none",
      v1.estimate.stages[1].usd !== null && Math.abs(v1.estimate.stages[1].usd - 1.4) < 1e-9 && v1.estimate.stages[1].roles[1].model === "claude-sonnet-5" && v1.estimate.stages[1].roles[1].n === 3 && v1.estimate.stages[2].usd === null && v1.estimate.usd === null, JSON.stringify([v1.estimate.stages[1], v1.estimate.stages[2].usd, v1.estimate.usd]));
    const p1 = await get("/run");
    check("the page wears it: blocked in that word, 1 of 1, the finding with its rule and evidence, three deferrals marked untested, Escalate and Approve with the reason over the block, the funnel empty, the flags empty",
      /blocked/.test(p1.text) && /1 of 1/.test(p1.text) && /test-proves-nothing/.test(p1.text) && /A submitted exception cannot be edited/.test(p1.text) && (p1.text.match(/untested/g) ?? []).length >= 3 && p1.text.includes('action="/run/sdd/escalate"') && p1.text.includes('action="/run/sdd/approve"') && /over the block/.test(p1.text) && /nothing has crossed the seam/.test(p1.text) && !p1.text.includes('action="/run/advance"') && /\$1\.40/.test(p1.text), p1.text.slice(0, 200));

    // A call the process died inside of: its started row is all the ledger holds. The view counts it and says so; it prices nothing.
    appendLedger(join(cold, LEDGER), { call: "killed-1", at: clock().toISOString(), half: "delivery", stage: "sdd", role: "judge", kind: "judge", model: "claude-sonnet-5", ok: null });
    const vk = runView(cold, { now: clock() });
    const pk = await get("/run");
    check("a killed call is on the page as one unfinished: counted among sdd's calls and the run's, the cost unchanged, the round's price still from the three that finished",
      vk.stages[1].cost.calls === 5 && vk.stages[1].cost.unfinished === 1 && Math.abs(vk.stages[1].cost.usd - 1.4) < 1e-9 && vk.cost.calls === 5 && vk.cost.unfinished === 1 && vk.estimate.stages[1].roles[1].n === 3 && /5 calls · \$1\.40 · <span class="badge warn">1 unfinished<\/span>/.test(pk.text), `${JSON.stringify(vk.stages[1].cost)} ${JSON.stringify(vk.cost)} ${(pk.text.match(/\d+ calls · \$[\d.]+[^<]*/g) ?? []).join(" | ")}`);

    // The human's door over a block: approve with a reason is the override, flagged with the guard it stepped over; without one it is refused.
    const refusedApprove = await post("/run/sdd/approve", { by: "Brad" });
    check("approving a block without a word is refused by the table's guard — the record does not move", refusedApprove.status === 409 && /non-block|judge-blocked/.test(refusedApprove.text) && readRun(cold).stages.sdd.status === "blocked", `${refusedApprove.status} ${refusedApprove.text.slice(0, 200)}`);
    const over = await post("/run/sdd/approve", { by: "Brad", override_reason: "T-2 is rewritten in the build ticket; the residual is on the manifest." });
    const run1 = readRun(cold);
    check("approving with a reason is the override: sdd approved, one flag on record with the guard it stepped over and the human's name, then back to the run",
      over.status === 303 && run1.stages.sdd.status === "approved" && run1.flags.filter((f) => f.override).length === 1 && run1.flags.at(-1).guard === "judge-blocked" && run1.flags.at(-1).by === "Brad" && /rewritten in the build ticket/.test(run1.flags.at(-1).reason), JSON.stringify(run1.flags));
    const p2 = await get("/run");
    const v2 = runView(cold, { now: clock() });
    check("the flag is on the page with its guard, and Advance is offered — the next stage is build, which the loop now runs; qa runs too, and so does release — every stage the pipeline has is now one the loop can run",
      /judge-blocked/.test(p2.text) && /rewritten in the build ticket/.test(p2.text) &&  p2.text.includes('action="/run/advance"') && v2.advance === true && v2.stages[2].stage === "build" && v2.stages[2].authored === true && v2.stages[2].doors.includes("run") && v2.stages[3].stage === "qa" && v2.stages[3].authored === true && v2.stages[4].stage === "release" && v2.stages[4].authored === true, JSON.stringify(v2.stages.map((s) => [s.stage, s.authored, s.doors])));
    const noStage = await post("/run/oven/stop", { by: "Brad", reason: "x" });
    check("a stage that is not one is refused by name", noStage.status === 409 && /no-stage/.test(noStage.text));

    // Reopen redoes the stage through the console — the episode streams like Advance — then stop with a reason: transitions through the one table, each a flag.
    const misnamed = await post("/run/sdd/reopen", { by: "Brad", reason: "the binding needs the T-2 rewrite before build reads it", items: "STORY-1, STORY-9" });
    check("the reopen form offers the items it is about, blank for every item; ids typed there are split and checked at the door — one the intake does not carry is refused by name in the streamed page before anything runs, sdd still approved",
      p2.text.includes('name="items"') && /blank redoes every item/.test(p2.text) && misnamed.status === 200 && /The door refused|item-unknown/.test(misnamed.text) && /item-unknown/.test(misnamed.text) && /STORY-9/.test(misnamed.text) && readRun(cold).stages.sdd.status === "approved" && script.calls.length === 4, `${misnamed.status} ${misnamed.text.slice(0, 200)}`);
    const reopened = await post("/run/sdd/reopen", { by: "Brad", reason: "the binding needs the T-2 rewrite before build reads it", items: "" });
    const runR = readRun(cold);
    check("Reopen streams the redo and lands on the record: sdd approved again at round 1 of the cap — one writer, one judge for STORY-1 whose T-2 the redo rewrote, STORY-2 and REQ-4 standing on round 1's judgements and the page saying so — the reopen a flag with the human's reason, the reopened mark cleared by the approval, the writer told why it is redoing — the standing binding and the judge's findings in front of it",
      reopened.status === 200 && /approved/.test(reopened.text) && /STORY-2 stands — same prompt, and its judge read nothing else, \$0/.test(reopened.text) && /REQ-4 stands/.test(reopened.text) && runR.stages.sdd.status === "approved" && runR.stages.sdd.round === 1 && !("reopened" in runR.stages.sdd) && runR.flags.at(-1).event === "reopen" && runR.flags.at(-1).override === false && /T-2 rewrite/.test(runR.flags.at(-1).reason) && script.calls.length === 6 && readDoc(cold, SDD_VERDICT).items.map((i) => `${i.id}:${i.stands ? "stands" : "judged"}`).join() === "STORY-1:judged,STORY-2:stands,REQ-4:stands" && /## Why the binding is reopened\n\nthe binding needs the T-2 rewrite before build reads it\n\n— Brad/.test(script.calls[4].prompt) && /## The previous binding/.test(script.calls[4].prompt) && /## The judge's findings on the previous binding/.test(script.calls[4].prompt) && /Every item is to revise: the binding is reopened\./.test(script.calls[4].prompt), `${reopened.status} ${JSON.stringify([runR.stages.sdd.status, runR.stages.sdd.round, runR.flags.at(-1), script.calls.length])}`);
    const pR = await get("/run");
    check("the redo is on the page: the reopen flag with its reason, the binding's verdict now the redo's pass, build still the next stage with Advance offered",
      /T-2 rewrite/.test(pR.text) && runView(cold, { now: clock() }).gates[1].verdict === "pass" && runView(cold, { now: clock() }).stages[2].stage === "build" && pR.text.includes('action="/run/advance"'), pR.text.slice(0, 200));
    const stopped = await post("/run/sdd/stop", { by: "Brad", reason: "parking it for the day" });
    const run2 = readRun(cold);
    check("stop through the console is the table's: stopped with the reason on a flag after the reopen's; a stopped stage offers Run again",
      stopped.status === 303 && run2.stages.sdd.status === "stopped" && run2.flags.slice(-2).map((f) => `${f.event}:${f.override}`).join() === "reopen:false,stop:false" && runView(cold, { now: clock() }).stages[1].doors.join() === "run" && /Start again/.test((await get("/run")).text), JSON.stringify(run2.flags.slice(-2)));
  } finally {
    await srv.close();
  }

  // Liveness in the machine's word: a stage the wrapper opened and never heartbeat again reads `dead` once the window passes, and the door is to start it again or stop it.
  transition(ran, { stage: "intake", event: "start", by: "runner", now: clock() });
  const alive = runView(ran, { now: clock() });
  tick(RUN_DEFAULTS.liveness_ms + 1);
  const dead = runView(ran, { now: clock() });
  check("a running stage inside the window shows running; past it, dead — in that word, with the silence measured — and the doors are start again or stop, never wait",
    alive.stages[0].shown === "running" && alive.stages[0].doors.join() === "stop" && dead.stages[0].shown === "dead" && dead.stages[0].status === "running" && dead.stages[0].silent_ms > RUN_DEFAULTS.liveness_ms && dead.stages[0].doors.join() === "run,stop" && dead.advance === true, JSON.stringify(dead.stages[0]));
  const srv2 = await serve({ routes: deliveryRoutes({ root: ran, _query: scripted({ structuredSeq: [BINDING, CLEAN("STORY-1"), CLEAN("STORY-2"), CLEAN("REQ-4")] }).query, _now: clock }), port: 0 });
  try {
    const page = await (await fetch(srv2.url + "/run")).text();
    check("the page says dead and offers Start again", />dead</.test(page) && /Start again/.test(page) && page.includes('action="/run/intake/run"'));
    const restarted = await fetch(srv2.url + "/run/intake/run", { method: "POST", headers: { Origin: srv2.url }, body: new URLSearchParams({ by: "Brad" }), redirect: "manual" });
    const runR = readRun(ran);
    check("starting again through the console is the runner's recovery over a dead stage: intake approved, the restart flagged with the silence it stepped over",
      restarted.status === 200 && runR.stages.intake.status === "approved" && runR.flags.some((f) => /restarted over a dead stage/.test(f.reason) && /silent/.test(f.note ?? "")), JSON.stringify(runR.flags));

    // Adopt: Discovery moves a story and re-exports; the run page offers v2; adopting through the console moves the pin and sends the approved stage stale.
    const reworded = structuredClone(STORIES);
    reworded[1].statement = reworded[1].statement.replace(/so that .*$/, "so that I can plan the dock before the first truck.");
    seedStories(disc, { stories: reworded });
    await refresh(disc);
    await reexport(disc, ran, { now: clock() });
    const before = runView(ran, { now: clock() });
    const adopted = await fetch(srv2.url + "/run/adopt", { method: "POST", headers: { Origin: srv2.url }, body: new URLSearchParams({ by: "Brad", version: "2" }), redirect: "manual" });
    const after = runView(ran, { now: clock() });
    check("a newer takeable handoff is adoptable on the view and the page; adopting through the console moves the pin to v2 and the approved stage to stale, whose door is Re-judge — never Run",
      before.adoptable.join() === "2" && adopted.status === 303 && after.run.handoff.version === 2 && after.adoptable.length === 0 && after.stages[0].shown === "stale" && after.stages[0].doors.join() === "rejudge,stop" && after.advance === true && /Re-judge/.test(await (await fetch(srv2.url + "/run")).text()), JSON.stringify(after.stages[0]));
  } finally {
    await srv2.close();
  }
});

done();

// ── helpers ──
function walk(dir, fn) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    if (e === "node_modules" || e.startsWith(".")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, fn); else fn(p);
  }
}

function ownsOf(file) {
  const head = readFileSync(file, "utf8").split("\n").slice(0, 5).join("\n");
  const m = head.match(/owns:\s*((?:R\d+)(?:\s*,\s*R\d+)*)/);
  return m ? m[1].split(/\s*,\s*/) : [];
}

/** Static: bare package specifiers, and imported bindings not referenced in the body. */
function graphOf(src) {
  const packages = new Set();
  const unused = [];
  const IMPORT = /^import\s+(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\})?\s*(?:\*\s+as\s+([\w$]+))?\s*(?:from\s+)?["']([^"']+)["']/gm;
  for (const m of src.matchAll(IMPORT)) {
    const [, def, named, star, spec] = m;
    if (!spec.startsWith(".") && !spec.startsWith("/") && !spec.startsWith("node:")) {
      packages.add(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);
    }
    const bound = [def, star, ...(named ?? "").split(",").map((s) => s.trim().split(/\s+as\s+/).pop()).filter(Boolean)].filter(Boolean);
    const rest = src.replace(m[0], "");
    // A property access (`x.b`) is not a use of the binding; a spread (`...b`) is.
    for (const b of bound) if (!new RegExp(`(?<![\\w$])(?<![^.]\\.)${b.replace(/\$/g, "\\$")}(?![\\w$])`).test(rest)) unused.push(b);
  }
  return { packages: [...packages].sort(), unused };
}
