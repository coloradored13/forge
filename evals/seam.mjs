#!/usr/bin/env node
// owns: R14 · shared — eval: the seam. The static half — the import rule — and the
// project-repo half: one repo per project, created or attached by Discovery's setup,
// never a directory inside the pipeline checkout. The cold half: Delivery takes a
// handoff in a temp root holding nothing of Discovery's record, reports drift per id
// against a seeded edit, compiles the backlog, asks its questions within budget, and
// the run's machine takes the result through its doors. Containment: a Delivery agent
// that touches discovery/ is refused at the chokepoint and its ledger row says so; the
// SDK is told the same before the model runs. git, gh and the SDK are scripted — no real
// repo, no model (R15).

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { suite, withRoot, scripted, ROOT } from "./_harness.mjs";
import { seedProject, seedPrototype, seedStories, seedDesign, STORIES, seedBuild, builder, roundCtx, put, gitIn, BUILT } from "./_fixture.mjs";
import { round as buildRound, worktree, WORKTREE, BRANCH, RECORD } from "../delivery/build/index.mjs";
import { violations } from "../tools/import-rule.mjs";
import { load, inlineRefs, outputContract, fields, validate } from "../shared/schema/index.mjs";
import { stamp, verify } from "../shared/hash.mjs";
import { KINDS, itemFields, itemsOf, verifyHandoff, readHandoffs, latestHandoff, handoffFile, HANDOFFS } from "../shared/handoff.mjs";
import { call, HELD_BACK, PASSED } from "../shared/agent-call/index.mjs";
import { rows as ledgerRows } from "../shared/agent-call/ledger.mjs";
import { rows as funnelRows, funnelPath } from "../shared/funnel.mjs";
import { SUMMARY_MAX } from "../shared/judge/index.mjs";
import { createRun, readRun, transition, adoptHandoff, LEDGER } from "../delivery/state/index.mjs";
import { intake, parseGherkin, INTAKE_FILE, VERDICT_FILE, GATE as INTAKE_GATE, QUESTION_BUDGET } from "../delivery/intake/index.mjs";
import { setupProject, loadProject, ledgerPath, insidePipeline, SetupRefused, PIPELINE_ROOT } from "../discovery/setup/index.mjs";
import { loadPrd } from "../discovery/workshop/index.mjs";
import { readDoc, readVerdict, isSigned, DESIGN_FILE, REVIEWS } from "../discovery/record/index.mjs";
import { answer } from "../discovery/doors/index.mjs";
import { review, signoff } from "../discovery/design/index.mjs";
import { exportHandoff, readiness, compile, designState, renderHandoff, repoOf, GATE as EXPORT_GATE, EXITS, IDEA, TRACKERS } from "../discovery/export/index.mjs";

const { check, done } = suite("seam · import rule, project repo, handoff", 146);

const RULES = `{"rules":[],"halves":["discovery","delivery","shared"]}`;

// ── the rule says no ──
withRoot({
  "shared/rules.json": RULES,
  "shared/hash.mjs": "export const h = 1;",
  "discovery/prd.mjs": "export const prd = 1;",
  "delivery/intake/static.mjs": `import { prd } from "../../discovery/prd.mjs";`,
  "delivery/intake/dynamic.mjs": `const m = await import("../../discovery/prd.mjs");`,
  "delivery/intake/rooted.mjs": `import { prd } from "discovery/prd.mjs";`,
  "delivery/intake/reexport.mjs": `export { prd } from "../../discovery/prd.mjs";`,
  "delivery/intake/required.cjs": `const { prd } = require("../../discovery/prd.mjs");`,
  "shared/leak.mjs": `import { x } from "../delivery/intake/static.mjs";`,
  "discovery/peek.mjs": `import { x } from "../delivery/intake/static.mjs";`,
}, (root) => {
  const v = violations(root);
  const files = new Set(v.map((x) => x.file));
  check("a static import from delivery/ into discovery/ is refused", files.has("delivery/intake/static.mjs"));
  check("a dynamic import() is refused", files.has("delivery/intake/dynamic.mjs"));
  check("a half-rooted specifier (\"discovery/…\") is refused", files.has("delivery/intake/rooted.mjs"));
  check("a re-export is refused", files.has("delivery/intake/reexport.mjs"));
  check("a require() is refused", files.has("delivery/intake/required.cjs"));
  check("shared/ importing a half is refused", files.has("shared/leak.mjs"));
  check("discovery/ importing delivery/ is refused", files.has("discovery/peek.mjs"));
  check("each violation names file, line, and both halves",
    v.every((x) => x.file && x.line > 0 && x.from && x.to), JSON.stringify(v[0]));
  check("nothing else is flagged", v.length === 7, `${v.length}: ${[...files].join(", ")}`);
});

// ── the rule says yes ──
withRoot({
  "shared/rules.json": RULES,
  "shared/hash.mjs": "export const h = 1;",
  "shared/judge/derive.mjs": `import { h } from "../hash.mjs";`,
  "delivery/intake/ok.mjs": `import { h } from "../../shared/hash.mjs";\nimport { slice } from "./slice.mjs";\nimport { readFileSync } from "node:fs";\nimport ajv from "ajv";`,
  "delivery/intake/slice.mjs": "export const slice = 1;",
  "discovery/prd.mjs": `import { h } from "../shared/hash.mjs";`,
}, (root) => {
  const v = violations(root);
  check("shared → shared, half → shared, half → itself, packages, node: all pass", v.length === 0, JSON.stringify(v));
});

// ── the real tree ──
{
  const v = violations(ROOT);
  check("the repo holds the import rule", v.length === 0, v.map((x) => `${x.file}:${x.line} ${x.from}→${x.to}`).join("; "));
}

// ── the project repo: one per project, its own, outside this checkout ──
withRoot({ "pipeline/shared/rules.json": RULES, "pipeline/SPEC.md": "#", "taken/notes.txt": "n", "theirs/.git/HEAD": "ref", "theirs/src/app.js": "x", "other/.git/HEAD": "ref", "other/forge/project.json": `{"slug":"someone-else"}` }, (tmp) => {
  const pipelineRoot = join(tmp, "pipeline");
  const parent = join(tmp, "projects");
  const execs = [];
  const _exec = (cmd, args, { cwd }) => {
    execs.push({ cmd, args, cwd });
    if (cmd === "git" && args[0] === "remote") return "git@github.com:acme/oven.git";
    return "";
  };
  const refusal = (opts) => { try { setupProject({ parent, pipelineRoot, _exec, ...opts }); return null; } catch (e) { return e; } };

  const inside = refusal({ slug: "oven", path: join(pipelineRoot, "runs", "oven") });
  check("a project inside the pipeline checkout is refused — the checkout holds code, evals and fixtures only",
    inside instanceof SetupRefused && inside.code === "inside-pipeline" && execs.length === 0, inside?.message);
  check("insidePipeline reads real paths, and the real default is this checkout", insidePipeline(join(pipelineRoot, "x"), pipelineRoot) && !insidePipeline(parent, pipelineRoot) && insidePipeline(join(ROOT, "evals"), PIPELINE_ROOT) && PIPELINE_ROOT === ROOT);
  // A symlink to the checkout, and a path under it that does not exist yet: the door must
  // still see through — this is how macOS's /var → /private/var tmp root first slipped past.
  symlinkSync(pipelineRoot, join(tmp, "link"));
  const viaLink = refusal({ slug: "oven", path: join(tmp, "link", "runs", "oven") });
  check("a not-yet-existing path under a symlink to the checkout is still inside it",
    insidePipeline(join(tmp, "link", "runs", "oven"), pipelineRoot) && viaLink instanceof SetupRefused && viaLink.code === "inside-pipeline" && !existsSync(join(pipelineRoot, "runs")), viaLink?.message);
  const over = refusal({ slug: "taken", path: join(tmp, "taken") });
  check("a new project over an existing directory is refused", over instanceof SetupRefused && over.code === "exists" && existsSync(join(tmp, "taken", "notes.txt")) && !existsSync(join(tmp, "taken", "forge")));
  const notRepo = refusal({ slug: "taken", path: join(tmp, "taken"), existing: true });
  check("attaching a directory that is not a repository is refused", notRepo instanceof SetupRefused && notRepo.code === "not-a-repo");
  const slug = refusal({ slug: "Oven Two" });
  check("a slug that is not a repo name is refused", slug instanceof SetupRefused && slug.code === "slug");
  const other = refusal({ slug: "oven", path: join(tmp, "other"), existing: true });
  check("attaching a repo that is already another Forge project is refused", other instanceof SetupRefused && other.code === "other-project" && /someone-else/.test(other.message));
  check("no refusal ran git or gh", execs.length === 0);

  // The good path: a new project.
  const made = setupProject({ slug: "oven", title: "Oven", parent, pipelineRoot, _exec, budget: 25, models: { "discovery.workshop": "claude-sonnet-5" } });
  const root = join(parent, "oven");
  check("a new project lands at <parent>/<slug> with discovery/, forge/ and forge/project.json beside a README and .gitignore",
    made.root === root && made.created && existsSync(join(root, "discovery")) && existsSync(join(root, "forge", "project.json")) && existsSync(join(root, "README.md")) && existsSync(join(root, ".gitignore")));
  const cmds = execs.map((e) => `${e.cmd} ${e.args.slice(0, 2).join(" ")}`);
  check("the sequence is git init → add → commit → gh repo create --private → record the remote → commit, all in the project root",
    cmds.join(" | ") === "git init -q | git add -A | git commit -q | gh repo create | git remote get-url | git add forge/project.json | git commit -q" && execs.every((e) => e.cwd === root), cmds.join(" | "));
  const gh = execs.find((e) => e.cmd === "gh");
  check("the remote is private and the source is the project root", gh.args.includes("--private") && gh.args[gh.args.indexOf("--source") + 1] === root && gh.args.includes("--push"));
  const project = loadProject(root);
  check("project.json records slug, title, path, remote, models, budget and the ledger path",
    project.slug === "oven" && project.title === "Oven" && project.repo.path === root && project.repo.remote === "git@github.com:acme/oven.git" && project.models["discovery.workshop"] === "claude-sonnet-5" && project.budget === 25 &&
    ledgerPath(root) === join(root, "forge", "discovery", "calls.jsonl") && made.remote === project.repo.remote, JSON.stringify(project));

  // The good path: attach an existing repo.
  execs.length = 0;
  const theirs = join(tmp, "theirs");
  const attached = setupProject({ slug: "theirs", title: "Theirs", path: theirs, existing: true, pipelineRoot, _exec });
  check("attaching lays down discovery/ and forge/project.json, commits them, and creates no remote",
    !attached.created && attached.remote === null && existsSync(join(theirs, "forge", "project.json")) && existsSync(join(theirs, "discovery")) && existsSync(join(theirs, "src", "app.js")) &&
    !execs.some((e) => e.cmd === "gh") && execs.map((e) => e.args[0]).join() === "add,commit", JSON.stringify(execs.map((e) => e.args)));
  const again = setupProject({ slug: "theirs", path: theirs, existing: true, pipelineRoot, _exec });
  check("re-attaching the same project is idempotent — project.json is kept, not rewritten", again.project.created === attached.project.created && JSON.parse(readFileSync(join(theirs, "forge", "project.json"), "utf8")).title === "Theirs");
  check("a directory that is not a project cannot be loaded", (() => { try { loadProject(join(tmp, "taken")); return false; } catch (e) { return e.code === "no-project"; } })());
});

// ── R14 · the handoff's schemas hold no field of their own: the contract is the PRD's fields, the handoff embeds the documents' ──
{
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const strip = (n) => JSON.parse(JSON.stringify(n, (k, v) => (k.startsWith("x-") || k === "description" ? undefined : v)));
  check("the contract's problem is the PRD's problem, inlined from its schema — not retyped",
    same(strip(outputContract("contract").properties.problem), strip(outputContract("prd").properties.problem)));
  check("the contract's requirements are the PRD's, criteria and all", fields("contract").some((f) => f.path === "/requirements[]/acceptance_criteria[]/statement"));
  check("the handoff reaches through the contract to the same fields, and through the backlog to a scenario's gherkin",
    fields("handoff").some((f) => f.path === "/contract/requirements[]/acceptance_criteria[]/statement") && fields("handoff").some((f) => f.path === "/stories/stories[]/scenarios[]/gherkin"));
  const described = inlineRefs({ properties: { p: { $ref: "prd.schema.json#/properties/problem", description: "mine" } } }).properties.p;
  check("a keyword beside a sibling ref stays — the embedding re-describes the field; the sibling's identity does not ride along",
    described.description === "mine" && described.type === "object" && !("$id" in described) && !("title" in described));
  const bogus = (ref) => { try { inlineRefs({ properties: { p: { $ref: ref } } }); return null; } catch (e) { return e.message; } };
  check("a ref to a sibling field that does not exist is refused, as is a ref to no schema", /cannot resolve/.test(bogus("prd.schema.json#/properties/nope") ?? "") && /cannot resolve/.test(bogus("nope.schema.json") ?? ""));
  check("the handoff schema's runner fields are exactly what an agent never writes, and nothing on its wire is a ref",
    same(Object.keys(outputContract("handoff").properties), ["contract", "prototype", "stories", "design"]) && !JSON.stringify(outputContract("handoff")).includes("$ref"));
}

// ── R14 · the item index: hashed over the item's own schema fields; the verifier names the item ──
{
  const reqFields = Object.keys(load("prd").properties.requirements.items.properties);
  check("a requirement is hashed over every field its schema declares — add one to the PRD schema and it is hashed from then on", JSON.stringify(itemFields("requirement")) === JSON.stringify(reqFields));
  check("a design screen is hashed over the design schema's screen fields, keyed by screen_ref", itemFields("screen").includes("controls") && KINDS.screen.id === "screen_ref");
  check("every kind's field list is non-empty and holds its id", Object.entries(KINDS).every(([k, { id }]) => itemFields(k).length > 0 && itemFields(k).includes(id)));
}

// ── the export door: the ready gate, three exits, the snapshot and its rendering, a tracker as a projection ──
function jiraScript({ fail } = {}) {
  const calls = [];
  const n = {};
  const fetch = async (url, init) => {
    const u = new URL(url);
    const body = init.body instanceof FormData ? { files: init.body.getAll("file").map((f) => f.name) } : init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method, path: u.pathname, host: u.host, body, headers: init.headers });
    if (fail?.(calls.length, init.method, u.pathname)) return new Response("no such issue type", { status: 400 });
    if (init.method === "POST" && u.pathname === "/rest/api/3/issue") { const k = body.fields.project.key; return Response.json({ key: `${k}-${(n[k] = (n[k] ?? 0) + 1)}` }); }
    if (init.method === "POST" && /\/attachments$/.test(u.pathname)) return Response.json([{ filename: "prd.json" }]);
    if (init.method === "PUT") return new Response(null, { status: 204 });
    return new Response("unexpected", { status: 500 });
  };
  return { fetch, calls };
}
/** gh, scripted: every call recorded as { method, path, fields, cwd }; issues numbered from 1. */
function ghScript({ fail } = {}) {
  const calls = [];
  let n = 0;
  const exec = (cmd, args, { cwd }) => {
    if (cmd !== "gh") throw new Error(`unexpected ${cmd}`);
    const fields = {};
    for (let i = 0; i < args.length; i++) if (args[i] === "-f") { const [k, v] = args[++i].split(/=(.*)/s); if (k.endsWith("[]")) (fields[k.slice(0, -2)] ??= []).push(v); else fields[k] = v; }
    calls.push({ method: args[2], path: args[3], fields, cwd });
    if (fail?.(calls.length)) { const e = new Error("gh: HTTP 422"); e.stderr = "gh: Validation Failed (HTTP 422)"; throw e; }
    return args[2] === "POST" ? JSON.stringify({ number: ++n }) : "";
  };
  return { exec, calls };
}
const ENV = { JIRA_EMAIL: "pm@acme.test", JIRA_API_TOKEN: "tok-secret-9f3a" };
const JIRA = { kind: "jira", site: "https://acme.atlassian.net/", project: "DOCK", ideas: "IDEAS" };
const noExec = () => { throw new Error("no command expected"); };
const refusal = (fn) => Promise.resolve().then(fn).then(() => null, (e) => e);
const clean = () => scripted({ structured: { findings: [], deferred: [], checked: 2, skipped: 0 } }).query;
const seqOf = (calls) => calls.map((c) => `${c.method} ${c.path.replace("/rest/api/3", "")}`).join(" | ");

await withRoot({}, async (tmp) => {
  const root = seedProject(tmp);
  const j = jiraScript();
  const go = (exit, opts = {}) => exportHandoff({ root, exit, by: "Brad", tracker: JIRA, _fetch: j.fetch, _env: ENV, _exec: noExec, _now: () => new Date("2026-09-05T12:00:00Z"), ...opts });

  // Refusals, in the order the door asks — nothing written, nothing fetched.
  check("EXITS are the spec's three; TRACKERS are the two we project to", EXITS.join() === "team,delivery,both" && TRACKERS.join() === "github,jira");
  const bad = await refusal(() => go("jira"));
  check("an exit that is not one of the three is refused", bad?.code === "bad-exit", bad?.message);
  const anon = await refusal(() => go("team", { by: " " }));
  check("no named person, no handoff", anon?.code === "no-author");
  const trello = await refusal(() => go("team", { tracker: { kind: "trello" } }));
  check("a tracker we do not project to is refused before anything is read", trello?.code === "bad-tracker", trello?.message);
  const noSite = await refusal(() => go("team", { tracker: { kind: "jira", project: "DOCK" } }));
  check("Jira without a site is refused", noSite?.code === "bad-tracker");
  const noCreds = await refusal(() => go("team", { _env: {} }));
  check("Jira with no credentials in the environment is refused", noCreds?.code === "no-credentials");
  const noProto = await refusal(() => go("delivery"));
  check("a Delivery exit needs no tracker, and is refused without a prototype", noProto?.code === "no-prototype", noProto?.message);
  seedPrototype(root);
  const noStories = await refusal(() => go("team"));
  check("…and without a backlog", noStories?.code === "no-stories");
  check("no refusal wrote a handoff, a verdict or a flag, or reached Jira",
    !existsSync(join(root, HANDOFFS)) && readVerdict(root, EXPORT_GATE) === null && loadPrd(root).flags.length === 0 && j.calls.length === 0);

  // The ready gate stands on its own: recomputed live, pinned to what it read.
  seedStories(root);
  const ready = readiness(root);
  check("readiness on a clean record passes, checks every join and every hash, and pins the three documents it read",
    ready.gate === EXPORT_GATE && ready.verdict === "pass" && ready.checked > 10 && ready.judged.map((p) => p.path).join() === "discovery/prd.json,discovery/prototype.json,discovery/stories.json", JSON.stringify(ready));
  check("a readiness verdict is a valid finding document", validate("finding", ready).ok, validate("finding", ready).errors.join("; "));

  // The contract: the PRD's fields, filtered to the line.
  const prd0 = loadPrd(root);
  const contract = compile(prd0);
  check("the contract holds the requirements inside the line and the surfaces not past it — REQ-3 and SURF-2 stay behind",
    contract.requirements.map((r) => r.id).join() === "REQ-1,REQ-2,REQ-4" && contract.surfaces.map((s) => s.id).join() === "SURF-1" && contract.prd.content_hash === prd0.meta.content_hash && contract.title === "Dock", JSON.stringify(contract.requirements.map((r) => r.id)));
  check("the contract validates against its schema and carries the open questions", validate("contract", contract).ok && contract.open_questions.length === 2);

  // Team exit, no design yet: the snapshot ships with design null, and Jira is brought to it.
  const v1 = await go("team");
  const h1 = v1.handoff;
  check("the first export is handoff v1 at discovery/handoffs/handoff-v1.json, validated, hashed, its index recomputable",
    v1.file === handoffFile(1) && existsSync(join(root, v1.file)) && h1.version === 1 && h1.id === "handoff-dock-v1" && validate("handoff", h1).ok && verifyHandoff(h1).verdict === "pass" && verify(h1).verdict === "pass", validate("handoff", h1).errors.join("; "));
  check("the snapshot embeds the documents as they stood — each still verifies on its own pointers — and the design is null with the exit and the author recorded",
    verify(h1.stories).verdict === "pass" && verify(h1.prototype).verdict === "pass" && h1.design === null && h1.exit === "team" && h1.by === "Brad" && h1.exported_at === "2026-09-05T12:00:00.000Z" && h1.project.slug === "dock" && h1.project.remote === "git@github.com:acme/dock.git");
  const kinds = (h) => h.items.reduce((m, it) => ({ ...m, [it.kind]: (m[it.kind] ?? 0) + 1 }), {});
  check("the index holds one entry per item: 3 requirements, 1 surface, 2 epics, 2 stories — hashed per item",
    JSON.stringify(kinds(h1)) === JSON.stringify({ requirement: 3, surface: 1, epic: 2, story: 2 }) && h1.items.every((it) => /^[0-9a-f]{64}$/.test(it.hash)), JSON.stringify(kinds(h1)));
  check("the ready verdict is filed under export-ready, fresh on the three documents", readVerdict(root, EXPORT_GATE)?.verdict === "pass" && v1.verdict.judged.length === 3);
  check("cost rides in from the ledger — nothing spent yet", h1.cost.usd === 0 && h1.cost.calls === 0 && Object.keys(h1.cost.by_stage).length === 0);

  // The rendering beside it: what a team reads with no tracker at all.
  const md1 = readFileSync(join(root, v1.rendering), "utf8");
  check("a rendering sits beside the snapshot as handoff-v1.md and is not a handoff itself",
    v1.rendering === "discovery/handoffs/handoff-v1.md" && readHandoffs(root).length === 1 && md1 === renderHandoff(h1));
  check("it says what this is, where it went and what the design's state is, then the contract, the backlog and the prototype",
    md1.startsWith("# Dock — handoff v1 (team)\n") && /by Brad · PRD v\S+ [0-9a-f]{12} · design: none/.test(md1) && /^Tracker: Jira DOCK — PRD IDEAS-1, REQ-1 DOCK-1/m.test(md1) && md1.includes("## Requirements inside the line") && md1.includes("  - REQ-1/AC-2: A submitted exception cannot be edited.") && md1.includes("## Backlog") && md1.includes("```gherkin") && md1.includes("## Design — none") && md1.includes("## Prototype"), md1.slice(0, 400));
  check("the rendering names no REQ-3 and no SURF-2 — it is the contract, not the PRD", !md1.includes("REQ-3") && !md1.includes("SURF-2"));

  // Jira: idea with the PRD attached, an epic per requirement, a story under its epic.
  check("the sequence is idea → attachments → three epics → two stories, all against the site given",
    seqOf(j.calls) === "POST /issue | POST /issue/IDEAS-1/attachments | POST /issue | POST /issue | POST /issue | POST /issue | POST /issue" && j.calls.every((c) => c.host === "acme.atlassian.net"), seqOf(j.calls));
  check("every call carries Basic auth from the environment and asks for JSON", j.calls.every((c) => c.headers.Authorization === `Basic ${Buffer.from("pm@acme.test:tok-secret-9f3a").toString("base64")}` && c.headers.Accept === "application/json"));
  const idea = j.calls[0].body.fields;
  check("the idea goes to the ideas project as an Idea, titled by the PRD, describing who/problem/crux, objective, the line, the cost and the trace",
    idea.project.key === "IDEAS" && idea.issuetype.name === "Idea" && idea.summary === "Dock" && JSON.stringify(idea.description).includes("Crux: recording at the door, one-handed") && JSON.stringify(idea.description).includes("Discovery cost: $0.00 over 0 model calls") && JSON.stringify(idea.description).includes("handoff v1"), JSON.stringify(idea).slice(0, 300));
  check("the PRD is attached to the idea as prd.json and prd.md, with the token Atlassian requires for uploads", j.calls[1].body.files.join() === "prd.json,prd.md" && j.calls[1].headers["X-Atlassian-Token"] === "no-check" && !("Content-Type" in j.calls[1].headers));
  const epics = j.calls.slice(2, 5).map((c) => c.body.fields);
  check("each epic is a DOCK Epic labelled with its REQ id, its criteria listed by join id",
    epics.map((e) => e.labels.join()).join("|") === "REQ-1|REQ-2|REQ-4" && epics.every((e) => e.project.key === "DOCK" && e.issuetype.name === "Epic") && JSON.stringify(epics[0].description).includes("REQ-1/AC-2 — A submitted exception cannot be edited."), JSON.stringify(epics[0]).slice(0, 300));
  const stories = j.calls.slice(5).map((c) => c.body.fields);
  check("each story is a DOCK Story under its requirement's epic, labelled with its own id, its REQ and its SCREEN, its scenarios as gherkin",
    stories[0].parent.key === h1.tracker.keys["REQ-1"] && stories[1].parent.key === h1.tracker.keys["REQ-2"] && stories[0].labels.join() === "STORY-1,REQ-1,SCREEN-1" && stories[0].description.content.some((b) => b.type === "codeBlock" && b.attrs.language === "gherkin") && JSON.stringify(stories[0].description).includes("proves REQ-1/AC-1"), JSON.stringify(stories[0].labels));
  check("every key is written back onto the snapshot, the idea under PRD; the PRD links the idea; the flag says what left and where",
    h1.tracker.kind === "jira" && Object.keys(h1.tracker.keys).sort().join() === "PRD,REQ-1,REQ-2,REQ-4,STORY-1,STORY-2" && h1.tracker.keys[IDEA] === "IDEAS-1" && loadPrd(root).meta.links.jira_idea === "IDEAS-1" && /^handoff v1 exported \(team\) by Brad · Jira DOCK: 6 created, 0 updated, 0 unchanged$/.test(loadPrd(root).flags.at(-1).note), loadPrd(root).flags.at(-1).note);
  check("the projection reports what it did", v1.tracker.kind === "jira" && v1.tracker.created.length === 6 && v1.tracker.updated.length === 0 && v1.tracker.removed.length === 0);
  const written = readFileSync(join(root, v1.file), "utf8") + readFileSync(join(root, "discovery", "prd.json"), "utf8") + md1;
  check("no credential is written to any record or rendering", !written.includes("tok-secret") && !written.includes("pm@acme.test"));
  check("the keys did not move the hash — tracker and cost are outside the snapshot's content", verify({ ...h1, tracker: null }).verdict === "pass" && verifyHandoff({ ...h1, tracker: null, cost: { usd: 9, calls: 9, by_stage: {} } }).verdict === "pass");

  // Exporting again with nothing changed: a new version, and Jira is not touched.
  j.calls.length = 0;
  const v2 = await go("team", { tracker: undefined });
  check("a re-export is v2 beside v1, carries the tracker and its keys from v1 without being told them, and makes no call — every item is unchanged",
    v2.handoff.version === 2 && readHandoffs(root).length === 2 && v2.handoff.tracker.site === JIRA.site && v2.handoff.tracker.keys["STORY-2"] === h1.tracker.keys["STORY-2"] && j.calls.length === 0 && v2.tracker.unchanged.length === 6 && v2.tracker.created.length === 0, JSON.stringify(v2.tracker));

  // The design: a team takes it as it stands; Delivery takes it signed.
  const noDesign = await refusal(() => go("delivery"));
  check("Delivery with no design is refused, and the detail says none", noDesign?.code === "no-design" && noDesign.detail === "none");
  seedDesign(root);
  const unsigned = await refusal(() => go("delivery"));
  check("Delivery with an unsigned design is refused — the user's ruling: if it goes to Delivery it is signed", unsigned?.code === "design-unsigned" && unsigned.detail === "unsigned" && readHandoffs(root).length === 2);
  const both = await refusal(() => go("both"));
  check("both exits together are held to the same signature", both?.code === "design-unsigned");
  const v3 = await go("team", { tracker: undefined });
  check("a team takes the design as it stands — embedded, unsigned, with its screens indexed; no gate, no staleness check",
    v3.handoff.version === 3 && v3.handoff.design !== null && !("signoff" in v3.handoff.design) && !isSigned(v3.handoff.design) && kinds(v3.handoff).screen === 2 && j.calls.length === 0, JSON.stringify(kinds(v3.handoff)));
  check("the rendering says the design is unsigned and renders it whole", readFileSync(join(root, v3.rendering), "utf8").includes("## Design — unsigned\n\nDirection:") && designState(v3.handoff.design) === "unsigned");
  await review({ root, _query: clean() });
  signoff(root, { by: "Ana Ruiz" });
  const v4 = await go("delivery");
  check("once signed, Delivery takes it: the sign-off rides in the snapshot with the name on it, the reviewer's verdict beside it",
    v4.handoff.version === 4 && v4.handoff.exit === "delivery" && isSigned(v4.handoff.design) && v4.handoff.design.signoff.by === "Ana Ruiz" && v4.handoff.design.signoff.review.gate === "design-reviewer" && verifyHandoff(v4.handoff).verdict === "pass");
  check("a Delivery exit makes no call and still carries the keys forward; the review it took to get here is in the cost; the flag names no tracker", j.calls.length === 0 && v4.tracker === null && v4.handoff.tracker.keys[IDEA] === "IDEAS-1" && v4.handoff.cost.calls === 1 && "design" in v4.handoff.cost.by_stage && v4.verdict.judged.length === 4 && loadPrd(root).flags.at(-1).note === "handoff v4 exported (delivery) by Brad", JSON.stringify(v4.handoff.cost));
  check("the design signed in the snapshot is the design on disk, hash for hash; the rendering says who signed", v4.handoff.design.meta.content_hash === readDoc(root, DESIGN_FILE).meta.content_hash && /design: signed by Ana Ruiz at 20\d\d-/.test(readFileSync(join(root, v4.rendering), "utf8")));

  // The PRD moves under the backlog: a ruling writes a criterion nobody proves yet. The gate says so, by id.
  answer({ root, req: "REQ-1", oq: "OQ-1", answer: "Yes, until the shift ends.", criterion: "An exception can be recorded until the shift ends.", by: "Brad" });
  const notReady = await refusal(() => go("both"));
  const unproved = notReady?.detail?.find((f) => f.rule === "criterion-unproved");
  check("a criterion no story proves blocks every exit as not-ready, the findings attached, naming REQ-1/AC-3",
    notReady?.code === "not-ready" && unproved && /REQ-1\/AC-3/.test(unproved.subject + unproved.evidence) && readHandoffs(root).length === 4, notReady?.message);
  check("the blocking readiness verdict is on file — the console can show it — and the PRD took no export flag", readVerdict(root, EXPORT_GATE).verdict === "block" && !/handoff v5/.test(loadPrd(root).flags.at(-1).note));
  check("a stale design is not a gate: the stories moved under it, the design still verifies signed", isSigned(readDoc(root, DESIGN_FILE)));

  // The backlog catches up; both exits. Changed items are updated in Jira, unchanged left alone, the ruling rides in the contract.
  const proving = structuredClone(STORIES);
  proving[0].scenarios.push({ name: "After the truck has left", gherkin: "Given a delivery whose truck has left\nWhen I record an exception before the shift ends\nThen the exception is recorded against that delivery", proves: ["REQ-1/AC-3"] });
  seedStories(root, { stories: proving });
  j.calls.length = 0;
  const v5 = await go("both", { tracker: undefined });
  check("both: v5 exported, the PRD moved so the idea is updated and the PRD re-attached; REQ-1's epic and STORY-1 are updated in place; nothing is created",
    v5.handoff.version === 5 && v5.handoff.exit === "both" && seqOf(j.calls) === "PUT /issue/IDEAS-1 | POST /issue/IDEAS-1/attachments | PUT /issue/DOCK-1 | PUT /issue/DOCK-4" && v5.tracker.updated.join() === "PRD,REQ-1,STORY-1" && v5.tracker.unchanged.join() === "REQ-2,REQ-4,STORY-2" && v5.tracker.created.length === 0, seqOf(j.calls));
  check("the updated epic carries the new criterion and the updated story its new scenario", JSON.stringify(j.calls[2].body.fields.description).includes("REQ-1/AC-3") && JSON.stringify(j.calls[3].body.fields.description).includes("After the truck has left"));
  check("the contract carries the ruling and the criterion it wrote; the ruling is an indexed item and is rendered", v5.handoff.contract.rulings.length === 1 && v5.handoff.contract.rulings[0].criterion === "REQ-1/AC-3" && kinds(v5.handoff).ruling === 1 && v5.handoff.contract.prd.version === loadPrd(root).meta.version && v5.handoff.contract.requirements[0].acceptance_criteria.length === 3 && /## Rulings[^]*RUL-1[^]*Yes, until the shift ends\. → REQ-1\/AC-3 — Brad/.test(readFileSync(join(root, v5.rendering), "utf8")));
  check("the handoffs read back in order and the latest is v5, a rendering beside each", readHandoffs(root).map((h) => h.version).join() === "1,2,3,4,5" && latestHandoff(root).version === 5 && readdirSync(join(root, HANDOFFS)).length === 10);

  // Tampering with a snapshot is named by item.
  const forged = structuredClone(v5.handoff);
  forged.stories.stories[1].statement = "As a supervisor…";
  const tampered = verifyHandoff(forged);
  check("an edited story in a snapshot fails as item-hash-stale on STORY-2 and content-hash-mismatch on the snapshot",
    tampered.verdict === "block" && tampered.findings.some((f) => f.rule === "item-hash-stale" && f.subject === "STORY-2") && tampered.findings.some((f) => f.rule === "content-hash-mismatch"), JSON.stringify(tampered.findings.map((f) => f.rule)));
  const dropped = structuredClone(v5.handoff);
  dropped.items = dropped.items.filter((it) => it.id !== "REQ-4");
  const extra = structuredClone(v5.handoff);
  extra.items.push({ id: "REQ-9", kind: "requirement", hash: "0".repeat(64) });
  check("an item in the snapshot missing from its index is item-unlisted; an index entry with no item is item-missing",
    verifyHandoff(dropped).findings.some((f) => f.rule === "item-unlisted" && f.subject === "REQ-4") && verifyHandoff(extra).findings.some((f) => f.rule === "item-missing" && f.subject === "REQ-9"));
  check("the same snapshot untouched still passes", verifyHandoff(v5.handoff).verdict === "pass" && itemsOf(v5.handoff).length === v5.handoff.items.length);

  // A second project, no Jira anywhere: files only, then GitHub Issues through the gh the PM already has.
  const oven = seedProject(tmp, { slug: "oven" });
  seedPrototype(oven); seedStories(oven);
  const g = ghScript();
  const goOven = (exit, opts = {}) => exportHandoff({ root: oven, exit, by: "Brad", _exec: g.exec, _fetch: noExec, _env: {}, ...opts });
  const files = await goOven("team");
  check("a team exit with no tracker is files only — the snapshot and its rendering, no call anywhere, and the flag says so",
    files.handoff.tracker === null && files.tracker === null && g.calls.length === 0 && existsSync(join(oven, files.rendering)) && readFileSync(join(oven, files.rendering), "utf8").includes("Tracker: none — these files are the handoff") && loadPrd(oven).flags.at(-1).note === "handoff v1 exported (team) by Brad · files only", loadPrd(oven).flags.at(-1).note);
  check("repoOf reads owner/name from an ssh or https GitHub remote and nothing else", repoOf("git@github.com:acme/oven.git") === "acme/oven" && repoOf("https://github.com/acme/oven.git") === "acme/oven" && repoOf("https://github.com/acme/oven") === "acme/oven" && repoOf("git@gitlab.com:acme/oven.git") === null && repoOf(null) === null);
  const gh1 = await goOven("team", { tracker: { kind: "github" } });
  const t1 = gh1.handoff.tracker;
  check("GitHub Issues: the repository is the project's own remote unless told otherwise; the sequence is three epics then two stories, every call in the project root",
    t1.kind === "github" && t1.repo === "acme/oven" && g.calls.map((c) => `${c.method} ${c.path}`).join(" | ") === Array(5).fill("POST repos/acme/oven/issues").join(" | ") && g.calls.every((c) => c.cwd === oven), g.calls.map((c) => `${c.method} ${c.path}`).join(" | "));
  const [e1, , , s1] = g.calls.map((c) => c.fields);
  check("each epic is titled by its REQ id and statement, labelled epic + REQ-n, its criteria by join id in the body",
    e1.title.startsWith("REQ-1 · ") && e1.labels.join() === "epic,REQ-1" && e1.body.includes("- REQ-1/AC-2 — A submitted exception cannot be edited.") && e1.body.includes("**Done when:**") && /handoff v2/.test(e1.body), JSON.stringify(e1).slice(0, 300));
  check("each story is labelled story + its own id, REQ and SCREEN, and is part of its requirement's issue, scenarios fenced as gherkin",
    s1.labels.join() === "story,STORY-1,REQ-1,SCREEN-1" && s1.body.startsWith(`Part of #${t1.keys["REQ-1"]}\n\n`) && s1.body.includes("```gherkin\n") && s1.body.includes("proves REQ-1/AC-1"), JSON.stringify(s1).slice(0, 300));
  check("issue numbers are written back as the keys; the flag names the repository; the rendering lists them as #n",
    JSON.stringify(t1.keys) === JSON.stringify({ "REQ-1": 1, "REQ-2": 2, "REQ-4": 3, "STORY-1": 4, "STORY-2": 5 }) && gh1.tracker.created.length === 5 && loadPrd(oven).flags.at(-1).note === "handoff v2 exported (team) by Brad · GitHub acme/oven: 5 created, 0 updated, 0 unchanged" && /^Tracker: GitHub acme\/oven — REQ-1 #1, REQ-2 #2/m.test(readFileSync(join(oven, gh1.rendering), "utf8")) && !("jira_idea" in (loadPrd(oven).meta.links ?? {})), loadPrd(oven).flags.at(-1).note);
  check("a snapshot with a GitHub tracker validates", validate("handoff", gh1.handoff).ok, validate("handoff", gh1.handoff).errors.join("; "));
  g.calls.length = 0;
  const gh2 = await goOven("team");
  check("a re-export carries the GitHub tracker forward and makes no call", gh2.handoff.tracker.repo === "acme/oven" && g.calls.length === 0 && gh2.tracker.unchanged.length === 5);
  answer({ root: oven, req: "REQ-2", oq: "OQ-2", answer: "The last one wins.", criterion: "Only the most recent exception on a delivery is shown.", by: "Brad" });
  const proving2 = structuredClone(STORIES);
  proving2[1].scenarios.push({ name: "Two exceptions", gherkin: "Given a delivery with two exceptions\nWhen I open it\nThen only the most recent exception is shown", proves: ["REQ-2/AC-2"] });
  seedStories(oven, { stories: proving2 });
  const gh3 = await goOven("team");
  check("changed items are patched in place — REQ-2's issue and STORY-2's — and nothing else is touched",
    g.calls.map((c) => `${c.method} ${c.path}`).join(" | ") === "PATCH repos/acme/oven/issues/2 | PATCH repos/acme/oven/issues/5" && gh3.tracker.updated.join() === "REQ-2,STORY-2" && gh3.tracker.unchanged.join() === "REQ-1,REQ-4,STORY-1" && g.calls[0].fields.body.includes("REQ-2/AC-2") && g.calls[0].fields.labels.join() === "epic,REQ-2", g.calls.map((c) => `${c.method} ${c.path}`).join(" | "));
  const elsewhere = await goOven("team", { tracker: { kind: "github", repo: "acme/oven-backlog" } });
  check("a different repository is a fresh projection: the keys do not carry across, five issues are created there, and the next export follows it",
    elsewhere.handoff.tracker.repo === "acme/oven-backlog" && elsewhere.tracker.created.length === 5 && g.calls.slice(-5).every((c) => c.path === "repos/acme/oven-backlog/issues" && c.method === "POST") && elsewhere.handoff.tracker.keys["REQ-1"] === 6 && (await goOven("team")).handoff.tracker.repo === "acme/oven-backlog", JSON.stringify(elsewhere.handoff.tracker));
  const noRemote = seedProject(tmp, { slug: "mill" });
  seedPrototype(noRemote); seedStories(noRemote);
  writeFileSync(join(noRemote, "forge", "project.json"), JSON.stringify({ ...loadProject(noRemote), repo: { ...loadProject(noRemote).repo, remote: "git@gitlab.com:acme/mill.git" } }));
  const noRepo = await refusal(() => exportHandoff({ root: noRemote, exit: "team", by: "Brad", tracker: { kind: "github" }, _exec: noExec, _fetch: noExec, _env: {} }));
  check("GitHub with a remote that is not on GitHub and no repository given is refused", noRepo?.code === "bad-tracker" && /owner\/name/.test(noRepo.message), noRepo?.message);

  // gh fails midway: the snapshot stands with the keys it got; the next export resumes.
  const failing = ghScript({ fail: (n) => n === 2 });
  const midway = await refusal(() => exportHandoff({ root: noRemote, exit: "team", by: "Brad", tracker: { kind: "github", repo: "acme/mill" }, _exec: failing.exec, _fetch: noExec, _env: {} }));
  const partial = latestHandoff(noRemote);
  check("a tracker error is a refusal naming the call and the kind; the snapshot was already written, holding the first epic's key; the PRD took no flag",
    midway?.code === "tracker-error" && /gh POST issues failed — gh: Validation Failed/.test(midway.message) && midway.detail === "github" && partial?.version === 1 && JSON.stringify(partial.tracker.keys) === JSON.stringify({ "REQ-1": 1 }) && loadPrd(noRemote).flags.length === 0, midway?.message);
  const resumed = ghScript();
  const again = await exportHandoff({ root: noRemote, exit: "team", by: "Brad", _exec: resumed.exec, _fetch: noExec, _env: {} });
  check("the next export resumes: REQ-1 is left alone, the remaining epics and stories are created — nothing duplicated",
    again.handoff.version === 2 && resumed.calls.length === 4 && again.tracker.created.join() === "REQ-2,REQ-4,STORY-1,STORY-2" && again.tracker.unchanged.join() === "REQ-1" && again.handoff.tracker.keys["REQ-1"] === 1, resumed.calls.map((c) => c.path).join(" | "));

  // Jira fails midway the same way.
  const kiln = seedProject(tmp, { slug: "kiln" });
  seedPrototype(kiln); seedStories(kiln);
  const jf = jiraScript({ fail: (n) => n === 4 });
  const jMid = await refusal(() => exportHandoff({ root: kiln, exit: "team", by: "Brad", tracker: JIRA, _fetch: jf.fetch, _env: ENV, _exec: noExec }));
  const jPartial = latestHandoff(kiln);
  check("a Jira error is a refusal naming the call; the snapshot holds the idea and the first epic's keys",
    jMid?.code === "tracker-error" && /Jira POST \/issue → 400/.test(jMid.message) && jMid.detail === "jira" && jPartial?.version === 1 && Object.keys(jPartial.tracker.keys).sort().join() === "PRD,REQ-1", jMid?.message);
  const jr = jiraScript();
  const jAgain = await exportHandoff({ root: kiln, exit: "team", by: "Brad", _fetch: jr.fetch, _env: ENV, _exec: noExec });
  check("the next export resumes: the idea and REQ-1 are left alone, the rest created — nothing duplicated",
    jAgain.handoff.version === 2 && seqOf(jr.calls) === "POST /issue | POST /issue | POST /issue | POST /issue" && jAgain.tracker.created.join() === "REQ-2,REQ-4,STORY-1,STORY-2" && jAgain.tracker.unchanged.join() === "PRD,REQ-1", seqOf(jr.calls));
  check("the reviews directory holds the export verdict beside the others", existsSync(join(kiln, REVIEWS, `${EXPORT_GATE}.json`)));
});

// ── R14 · cold intake: a handoff taken in a root holding nothing of Discovery's record; drift per id against a seeded edit; the door is the PM's ──
const LONG_QUESTION = `Which reason applies when a case is short and damaged? ${"The reviewer set out every reading of the criterion, the two screens each reading would touch, and the scenario neither reading names; ".repeat(3)}the PM has not chosen.`;
await withRoot({}, async (tmp) => {
  const T0 = new Date("2026-09-06T09:00:00Z");
  // Discovery, whole, somewhere else: a signed handoff, then an edit that moves REQ-1 and STORY-1 and adds a ruling.
  const asked = [
    { subject: "STORY-1", question: "Is a shortfall of zero cases an exception?", blocking: false },
    { subject: "STORY-1", question: "Can two exceptions be recorded against one delivery?", blocking: false },
    // A reviewer's question at Bakehouse length — past the schema's ceiling on a finding's summary (2026-09-05).
    { subject: "STORY-1", question: LONG_QUESTION, blocking: false },
  ];
  const disc = seedProject(tmp, { slug: "dock" });
  seedPrototype(disc);
  seedStories(disc, { open_questions: [...asked, { subject: "REQ-2", question: "Does the run sheet show deliveries already received?", blocking: true }] });
  seedDesign(disc);
  await review({ root: disc, _query: clean() });
  signoff(disc, { by: "Ana Ruiz" });
  const go = () => exportHandoff({ root: disc, exit: "delivery", by: "Brad", _exec: noExec, _fetch: noExec, _env: {}, _now: () => T0 });
  const v1 = await go();
  answer({ root: disc, req: "REQ-1", oq: "OQ-1", answer: "Yes, until the shift ends.", criterion: "An exception can be recorded until the shift ends.", by: "Brad" });
  const proving = structuredClone(STORIES);
  proving[0].scenarios.push({ name: "After the truck has left", gherkin: "Given a delivery whose truck has left\nWhen I record an exception before the shift ends\nThen the exception is recorded against that delivery", proves: ["REQ-1/AC-3"] });
  seedStories(disc, { stories: proving, open_questions: asked });
  const v2 = await go();
  check("Discovery stands at v2: the edit moved REQ-1 and STORY-1 and added RUL-1", v2.handoff.version === 2 && v2.handoff.contract.rulings.length === 1 && v2.handoff.stories.open_questions.length === 3);

  // The cold root: a repository holding the handoffs and nothing else of Discovery's.
  const cold = join(tmp, "cold");
  mkdirSync(join(cold, ".git"), { recursive: true });
  mkdirSync(join(cold, HANDOFFS), { recursive: true });
  for (const f of readdirSync(join(disc, HANDOFFS))) copyFileSync(join(disc, HANDOFFS, f), join(cold, HANDOFFS, f));
  check("the cold root holds two handoffs and no PRD, stories, design, prototype or review",
    readHandoffs(cold).length === 2 && readdirSync(join(cold, "discovery")).join() === "handoffs" && !existsSync(join(cold, "discovery", "prd.json")));
  const noRun = await refusal(() => intake(cold));
  check("intake with no run is refused — the run pins the handoff intake takes", noRun?.code === "no-run", noRun?.message);
  createRun(cold, { by: "Brad", version: 1, now: T0 });

  const first = intake(cold, { now: T0 });
  const rec = first.record;
  check("intake takes the pinned snapshot, v1, and writes one record that validates and is stamped",
    rec.handoff.version === 1 && rec.handoff.content_hash === v1.handoff.meta.content_hash && validate("intake", rec).ok && verify(rec).verdict === "pass" && existsSync(join(cold, INTAKE_FILE)), validate("intake", rec).errors?.join("; "));
  const d = rec.drift;
  check("drift is reported per id against the live snapshot, v2: REQ-1 and STORY-1 changed, RUL-1 added, nothing removed, every other item unchanged",
    d.against.version === 2 && d.against.content_hash === v2.handoff.meta.content_hash && d.changed.map((c) => c.id).join() === "REQ-1,STORY-1" && d.added.map((a) => `${a.kind}:${a.id}`).join() === "ruling:RUL-1" && d.removed.length === 0 && d.unchanged.length === itemsOf(v1.handoff).length - 2 && ["REQ-2", "REQ-4", "EPIC-1", "STORY-2", "SCREEN-1"].every((id) => d.unchanged.includes(id)), JSON.stringify(d).slice(0, 400));
  const req1 = d.changed[0];
  check("a change names the field and carries both sides — REQ-1's criteria went from two to three",
    req1.fields.length === 1 && req1.fields[0].field === "acceptance_criteria" && req1.fields[0].was.length === 2 && req1.fields[0].now.length === 3 && req1.fields[0].now[2].id === "AC-3", JSON.stringify(req1));
  check("nothing is resolved: the record compiles v1 — three scenarios, not four", rec.scenarios.length === 3 && !rec.scenarios.some((s) => s.name === "After the truck has left"));

  // Compile: every scenario to steps with a skeleton; the joins re-run.
  const s1 = rec.scenarios[0];
  check("a scenario compiles to its story, name, the criteria it proves, the screens it runs on and its steps",
    s1.id === "STORY-1/1" && s1.story === "STORY-1" && s1.proves.join() === "REQ-1/AC-1" && s1.screens.join() === "SCREEN-1" && s1.steps.map((st) => st.kind).join() === "given,when,then", JSON.stringify(s1));
  check("a step keeps its text and gets a skeleton id the sdd writer fills",
    s1.steps[0].text === "a delivery from Harvest Foods on the run sheet" && s1.steps[0].step === "given_a_delivery_from_harvest_foods_on_the_run_sheet" && s1.steps[2].step.startsWith("then_the_exception_shows"), JSON.stringify(s1.steps));
  check("And and But inherit the keyword before them; a line with no keyword is refused",
    parseGherkin("Given a\nAnd b\nWhen c\nBut d\nThen e\nAnd f").map((s) => s.kind).join() === "given,given,when,when,then,then" && (() => { try { parseGherkin("Given a\nthe truck leaves"); return false; } catch (e) { return e.code === "bad-gherkin"; } })());

  // Slice: work items.
  const wi = rec.work_items;
  check("work items: one per story, one per non-functional requirement inside the line — ids are the backlog's, no new namespace",
    wi.map((w) => `${w.kind}:${w.id}`).join() === "story:STORY-1,story:STORY-2,requirement:REQ-4", JSON.stringify(wi.map((w) => w.id)));
  check("a story item carries its epic, statement, criteria by join id with their text, the design's screens with their controls and states, and its scenarios",
    wi[0].epic === "EPIC-1" && wi[0].criteria.map((c) => c.id).join() === "REQ-1/AC-1,REQ-1/AC-2" && wi[0].criteria[1].statement === "A submitted exception cannot be edited." && wi[0].screens[0].screen_ref === "SCREEN-1" && wi[0].screens[0].controls.join() === "reason-chip,record-exception" && wi[0].screens[0].states.join() === "choosing,recorded" && wi[0].scenarios.join() === "STORY-1/1,STORY-1/2", JSON.stringify(wi[0]).slice(0, 400));
  check("a requirement item carries the criterion, no screens, no scenarios — verified by measurement or inspection", wi[2].criteria.map((c) => c.id).join() === "REQ-4/AC-1" && wi[2].screens.length === 0 && wi[2].scenarios.length === 0 && wi[2].epic === null);

  // Ask: the questions the snapshot still carries go back across the seam.
  const q = rec.questions;
  check("questions: the contract's two open questions unattributed, the stories' three on STORY-1 and one blocking on REQ-2's story",
    q.length === 6 && q.filter((x) => x.source === "contract" && x.story === null).length === 2 && q.filter((x) => x.story === "STORY-1").length === 3 && q.find((x) => x.blocking)?.story === "STORY-2", JSON.stringify(q.map((x) => [x.source, x.story, x.blocking])));
  check("a story over the budget is a funnel signal — recorded against R13, never trimmed",
    rec.budget.per_story === QUESTION_BUDGET && JSON.stringify(rec.budget.over) === JSON.stringify([{ story: "STORY-1", count: 3 }]) && funnelRows(funnelPath(cold)).some((r) => r.signal === "intake-questions" && r.story === "STORY-1" && r.count === 3 && r.budget === 2), JSON.stringify(funnelRows(funnelPath(cold))));
  check("existing: the cold root is greenfield — no product files, no manifest", rec.existing.mode === "greenfield" && rec.existing.manifest === null && rec.existing.files === 0);

  // The verdict: finding-shaped, pinned to the handoff, filed where the machine reads it.
  const verdict = JSON.parse(readFileSync(join(cold, VERDICT_FILE), "utf8"));
  check("the verdict is a finding document pinned to the handoff it took; the blocking question blocks; drift and the other questions advise; the joins passed",
    first.verdict === VERDICT_FILE && validate("finding", verdict).ok && verdict.gate === INTAKE_GATE && verdict.verdict === "block" && verdict.judged.length === 1 && verdict.judged[0].path === handoffFile(1) && verdict.judged[0].content_hash === v1.handoff.meta.content_hash && verdict.findings.filter((f) => f.rule === "drift").length === 3 && verdict.findings.filter((f) => f.rule === "question").length === 6 && verdict.findings.filter((f) => f.rule === "question-budget").length === 1 && !verdict.findings.some((f) => f.rule.startsWith("join")), JSON.stringify(verdict.findings.map((f) => `${f.rule}:${f.subject}:${f.severity}`)));
  check("the drift finding tells the PM the door: proceed on v1 or adopt v2", /adopt/.test(verdict.findings.find((f) => f.rule === "drift").remedy) && /v2/.test(verdict.findings.find((f) => f.rule === "drift").evidence));
  const longQ = verdict.findings.filter((f) => f.rule === "question").find((f) => f.evidence.includes(LONG_QUESTION));
  check("a question longer than a summary may be still crosses: the finding fits the schema, the summary is clipped, the question rides whole in the evidence and in the record",
    LONG_QUESTION.length > SUMMARY_MAX && longQ !== undefined && longQ.summary.length <= SUMMARY_MAX && longQ.summary.endsWith("…") && rec.questions.some((x) => x.question === LONG_QUESTION), longQ?.summary.length);

  // The machine takes it: finish on the verdict; approve is refused on the block; the PM's edit is adopted and the verdict in review goes stale with the contract it judged — intake re-judges on v2 (a recompile: intake has no writer), no round spent.
  transition(cold, { stage: "intake", event: "start", by: "runner", now: T0 });
  const fin = transition(cold, { stage: "intake", event: "finish", by: "runner", verdict: first.verdict, now: T0 });
  const held = await refusal(() => transition(cold, { stage: "intake", event: "approve", by: "Brad", now: T0 }));
  check("finish takes the filed verdict into review; approve is refused as judge-blocked — the blocking question is the door",
    fin.run.stages.intake.status === "review" && fin.run.stages.intake.verdict === VERDICT_FILE && held?.code === "judge-blocked", held?.message);
  const adopted = adoptHandoff(cold, { version: 2, by: "Brad", now: T0 });
  check("adopting v2 moves the pin and sends intake — in review on a block judged against v1 — stale at round 0: the answer in Discovery is the door, not a regeneration",
    readRun(cold).handoff.version === 2 && adopted.moved.join() === "intake" && readRun(cold).stages.intake.status === "stale" && readRun(cold).stages.intake.round === 0 && readRun(cold).flags.at(-1).event === "moved" && /v1 → v2/.test(readRun(cold).flags.at(-1).reason), JSON.stringify(readRun(cold).stages.intake));
  transition(cold, { stage: "intake", event: "rejudge", by: "wrapper", now: T0 });
  const second = intake(cold, { now: T0 });
  const rec2 = second.record;
  check("intake on v2: no drift — the pin is the latest; the ruling rides in the contract; four scenarios; OQ-1 answered leaves four questions, the budget still exceeded",
    rec2.handoff.version === 2 && rec2.drift.against === null && rec2.drift.changed.length === 0 && rec2.scenarios.length === 4 && rec2.questions.length === 4 && !rec2.questions.some((x) => x.blocking) && rec2.budget.over.length === 1, JSON.stringify(rec2.drift));
  check("the record's hash moved with the compile — a judge that pinned intake.json goes stale with it", rec2.meta.content_hash !== rec.meta.content_hash);
  const cleared = transition(cold, { stage: "intake", event: "clear", by: "wrapper", verdict: second.verdict, now: T0 });
  check("the re-judge advises — questions and the budget signal — and clears to approved at round 0: answering a snapshot's question costs no round (R5)",
    cleared.run.stages.intake.round === 0 && JSON.parse(readFileSync(join(cold, VERDICT_FILE), "utf8")).verdict === "advise" && cleared.run.stages.intake.status === "approved" && cleared.run.stages.intake.verdict === second.verdict);
  check("the funnel holds one budget row per intake — the meter, not a tally of rounds", funnelRows(funnelPath(cold)).filter((r) => r.signal === "intake-questions").length === 2);

  // Tampering with the pinned file is caught at the door: by item when the edit left the stamp, by the pin when it re-stamped itself.
  const file = join(cold, handoffFile(2));
  const kept = readFileSync(file, "utf8");
  const edited = JSON.parse(kept);
  edited.stories.stories[1].statement = "As a supervisor, I want the run sheet, so that I can watch.";
  writeFileSync(file, JSON.stringify(edited));
  const forged = await refusal(() => intake(cold, { now: T0 }));
  writeFileSync(file, JSON.stringify(stamp(edited)));
  const restamped = await refusal(() => intake(cold, { now: T0 }));
  check("a snapshot edited under its pin is refused — handoff-integrity names the item; a self-consistent re-stamp is handoff-moved, the pin being the run's word on what it took",
    forged?.code === "handoff-integrity" && /STORY-2/.test(forged.message) && restamped?.code === "handoff-moved", `${forged?.code} · ${restamped?.code}`);
  writeFileSync(file, kept);

  // ── R14 · read containment: a Delivery agent that touches discovery/ is refused at the chokepoint; the row records it; the SDK is told first ──
  const ledger = join(cold, LEDGER);
  process.env.JIRA_API_TOKEN = "tok-secret-9f3a"; process.env.JIRA_EMAIL = "pm@acme.test"; process.env.GH_TOKEN = "gho-secret";
  process.env.SSH_AUTH_SOCK = "/tmp/agent.sock"; process.env.X_TOKEN = "x-secret-not-on-any-list";
  const agent = (q, over = {}) => call({ half: "delivery", stage: "build", role: "writer", kind: "builder", system: "s", prompt: "p", cwd: cold, ledger, _query: q.query, ...over });
  const peek = scripted({ toolUses: [{ name: "Read", input: { file_path: "src/app.mjs" } }, { name: "Bash", input: { command: "cat discovery/prd.json" } }] });
  const refused = await refusal(() => agent(peek));
  check("a Delivery agent reading discovery/ is refused at the chokepoint — the code names containment, the message the tool and what it touched",
    refused?.code === "containment" && /Bash/.test(refused.message) && /cat discovery\/prd\.json/.test(refused.message), refused?.message);
  const row = ledgerRows(ledger).at(-1);
  check("the ledger row records every tool use with its target, ok false and the error naming containment",
    row.ok === false && /^containment: Bash/.test(row.error) && row.tools.map((t) => `${t.name} ${t.target}`).join(" | ") === "Read src/app.mjs | Bash cat discovery/prd.json", JSON.stringify(row));
  const opts = peek.calls[0].options;
  check("the SDK is told the same before the model runs: sandbox on, refuse if unavailable, discovery/ denied to reads and writes, forge/ denied to writes — the record is the runner's — the Read, Edit and Write tools denied the same paths; a builder's network is the package registries",
    opts.sandbox?.enabled === true && opts.sandbox.failIfUnavailable === true && opts.sandbox.filesystem.denyRead.join() === join(cold, "discovery") && opts.sandbox.filesystem.denyWrite.join() === [join(cold, "discovery"), join(cold, "forge")].join() && opts.settings?.permissions?.deny.join() === [`Read(/${join(cold, "discovery")}/**)`, `Edit(/${join(cold, "discovery")}/**)`, `Write(/${join(cold, "discovery")}/**)`, `Edit(/${join(cold, "forge")}/**)`, `Write(/${join(cold, "forge")}/**)`].join() && opts.sandbox.network.allowedDomains.includes("registry.npmjs.org") && opts.sandbox.network.allowLocalBinding === true, JSON.stringify({ sandbox: opts.sandbox, settings: opts.settings }));
  check("an agent's environment is the allowlist and nothing else: the pipeline's credentials are absent, so is everything the shell happens to hold — an ssh agent socket, a token on no list — while HOME and PATH arrive as they are",
    Object.keys(opts.env).every((k) => PASSED.includes(k)) && HELD_BACK.every((k) => !(k in opts.env)) && !("SSH_AUTH_SOCK" in opts.env) && !("X_TOKEN" in opts.env) && opts.env.PATH === process.env.PATH && opts.env.HOME === process.env.HOME,
    Object.keys(opts.env).filter((k) => !PASSED.includes(k)).join() || "(all on the list)");
  check("the allowlist names the shape of a working shell, never a credential: HOME and PATH on it, no held-back name on it, nothing matching TOKEN, SECRET, KEY or SOCK",
    PASSED.includes("HOME") && PASSED.includes("PATH") && HELD_BACK.every((k) => !PASSED.includes(k)) && PASSED.every((k) => !/TOKEN|SECRET|KEY|SOCK|PASSWORD/.test(k)), PASSED.join());
  const abs = scripted({ toolUses: [{ name: "Read", input: { file_path: join(cold, "discovery", "handoffs", "handoff-v2.json") } }] });
  const absolute = await refusal(() => agent(abs));
  const write = scripted({ toolUses: [{ name: "Write", input: { file_path: "./discovery/prd.json", content: "{}" } }] });
  const wrote = await refusal(() => agent(write));
  check("an absolute path into discovery/ is the same refusal — the handoff reaches an agent through its prompt — and so is a write there",
    absolute?.code === "containment" && wrote?.code === "containment" && /Write/.test(wrote.message), wrote?.message);
  const fine = scripted({ toolUses: [{ name: "Read", input: { file_path: "src/app.mjs" } }, { name: "Grep", input: { pattern: "discovery", path: "src" } }, { name: "Bash", input: { command: "npm test -- --grep discovery" } }] });
  const ok = await agent(fine);
  const okRow = ledgerRows(ledger).at(-1);
  check("a call that stays inside the product is fine — the word is not the path — and its tool uses are on its row too",
    ok.text === "ok" && okRow.ok === true && okRow.tools.map((t) => `${t.name} ${t.target}`).join(" | ") === "Read src/app.mjs | Grep src | Bash npm test -- --grep discovery", JSON.stringify(okRow.tools));
  const disco = scripted({ toolUses: [{ name: "Read", input: { file_path: "discovery/prd.json" } }] });
  await call({ half: "discovery", stage: "stories", role: "writer", kind: "compose", system: "s", prompt: "p", cwd: disc, ledger, _query: disco.query });
  check("Discovery's own agents read their record — containment is the seam's, not a rule against reading; their environment is the same allowlist",
    ledgerRows(ledger).at(-1).ok === true && disco.calls[0].options.sandbox === undefined && Object.keys(disco.calls[0].options.env).every((k) => PASSED.includes(k)) && !("JIRA_API_TOKEN" in disco.calls[0].options.env) && !("SSH_AUTH_SOCK" in disco.calls[0].options.env) && disco.calls[0].options.env.HOME === process.env.HOME,
    Object.keys(disco.calls[0].options.env).filter((k) => !PASSED.includes(k)).join() || "(all on the list)");
  const gone = scripted({ resultError: "Sandbox unavailable: bubblewrap is not installed" });
  const failed = await refusal(() => agent(gone));
  check("a sandbox the SDK cannot provide is a failed call named on its row — never a call run unsandboxed",
    /Sandbox unavailable/.test(failed?.message) && ledgerRows(ledger).at(-1).ok === false && /Sandbox unavailable/.test(ledgerRows(ledger).at(-1).error), failed?.message);
  delete process.env.JIRA_API_TOKEN; delete process.env.JIRA_EMAIL; delete process.env.GH_TOKEN; delete process.env.SSH_AUTH_SOCK; delete process.env.X_TOKEN;
});

// ── R14 · the build's checkout: a worktree with nothing of the record in it, fenced at both roots, and a record-write discarded ──
await withRoot({}, async (tmp) => {
  const { cold } = await seedBuild(tmp, { slug: "ferry", files: { "README.md": "# Ferry\n", "src/index.js": "export {};\n", "package.json": "{\"name\":\"ferry\"}\n" } });
  const wt = join(cold, WORKTREE);
  const ledger = join(cold, LEDGER);
  check("the seed is a repository whose main holds the product, the handoffs and the run record — the record is in git, as a project's would be", gitIn(cold, ["ls-files"]).split("\n").join() === "README.md,discovery/handoffs/handoff-v1.json,discovery/handoffs/handoff-v1.md,forge/run.json,package.json,src/index.js");
  const got = worktree(cold);
  check("the worktree is `.worktrees/build` on `forge/build`, cut from the project's head: the product is there, the record's directories are not — sparse, not deleted — and the project's own status does not see the worktree",
    got === wt && gitIn(wt, ["rev-parse", "--abbrev-ref", "HEAD"]) === BRANCH && gitIn(wt, ["rev-parse", "HEAD"]) === gitIn(cold, ["rev-parse", "main"]) && readdirSync(wt).sort().join() === ".git,README.md,package.json,src" && RECORD.every((d) => !existsSync(join(wt, d))) && gitIn(wt, ["ls-files"]).split("\n").includes("forge/run.json") && readFileSync(join(cold, ".git", "info", "exclude"), "utf8").split("\n").includes(".worktrees/build/") && !gitIn(cold, ["status", "--short"]).includes(".worktrees"), `${readdirSync(wt).join()} · ${gitIn(cold, ["status", "--short"])}`);
  check("asking again is the same worktree, not a second one", worktree(cold) === wt && gitIn(cold, ["worktree", "list"]).split("\n").length === 2);

  // The builder runs in the worktree, told both roots: the worktree's and the project's record directories are denied.
  const b = builder([BUILT()], { 0: (cwd) => put(cwd, "src/exceptions/store.js", "export {};\n") });
  const r1 = await buildRound(cold, { ...roundCtx(cold), _query: b.query });
  const o = b.calls[0].options;
  check("the builder's cwd is the worktree; the SDK is told the fence at both roots — discovery/ under each denied to reads, discovery/ and forge/ under each denied to writes, the tools denied the same — and the network is the registries, local binding allowed",
    o.cwd === wt && o.sandbox.filesystem.denyRead.join() === [join(wt, "discovery"), join(cold, "discovery")].join() && o.sandbox.filesystem.denyWrite.join() === [join(wt, "discovery"), join(cold, "discovery"), join(wt, "forge"), join(cold, "forge")].join() && o.settings.permissions.deny.length === 2 + 2 * 4 && o.settings.permissions.deny.includes(`Write(/${join(cold, "forge")}/**)`) && o.settings.permissions.deny.includes(`Read(/${join(wt, "discovery")}/**)`) && o.sandbox.network.allowedDomains.includes("registry.npmjs.org") && o.sandbox.network.allowLocalBinding === true && o.sandbox.failIfUnavailable === true, JSON.stringify({ cwd: o.cwd, sandbox: o.sandbox, deny: o.settings.permissions.deny }));
  check("the builder's environment is the allowlist, its ledger row is delivery/build/builder as a builder, and the item it built is committed on the branch",
    Object.keys(o.env).every((k) => PASSED.includes(k)) && ledgerRows(ledger).at(-1).half === "delivery" && ledgerRows(ledger).at(-1).stage === "build" && ledgerRows(ledger).at(-1).role === "builder" && ledgerRows(ledger).at(-1).kind === "builder" && ledgerRows(ledger).at(-1).ok === true && r1.doc.items[0].status === "built", JSON.stringify(ledgerRows(ledger).at(-1)));

  // A builder that writes under forge/ in its worktree: the path is outside the sparse cone, so git's bookkeeping would not show it — the runner walks the record's directories and finds it.
  const sneaky = builder([BUILT()], { 0: (cwd) => { put(cwd, "src/deliveries/store.js", "export {};\n"); put(cwd, "forge/delivery/build.json", "{\"items\":[]}"); } });
  const r2 = await buildRound(cold, { ...roundCtx(cold, { review: r1.verdict }), _query: sneaky.query });
  const s2 = r2.doc.items[1];
  check("a file put under forge/ in the worktree is in the change set and is a record-write: the item is violated, its work discarded, nothing of it on the branch, the worktree's forge/ gone again, the project's own record untouched",
    s2.status === "violated" && s2.changed.join() === "forge/delivery/build.json,src/deliveries/store.js" && s2.violations.map((v) => `${v.rule}:${v.path}`).join() === "record-write:forge/delivery/build.json" && r2.verdict.findings[0].rule === "record-write" && /under the pipeline's record/.test(r2.verdict.findings[0].summary) && !existsSync(join(wt, "forge")) && !existsSync(join(wt, "src", "deliveries")) && gitIn(cold, ["log", "--format=%s", BRANCH]).split("\n").length === 2 && JSON.parse(readFileSync(join(cold, "forge", "delivery", "build.json"), "utf8")).items.length === 3, JSON.stringify(s2));
  check("STORY-1 was reused across that round — its binding unchanged, its commit standing — for no call; the two calls were STORY-2's and REQ-4's, which stood blocked and depend on nothing", r2.doc.items[0].reused === true && sneaky.calls.length === 2 && r2.doc.items[2].status === "blocked", `${sneaky.calls.length} · ${r2.doc.items.map((i) => `${i.work_item}:${i.status}`).join()}`);

  // The chokepoint's after-the-fact fence, from the worktree: a write aimed at the project's record, and a read reaching up into its discovery/, are both refused and both on the ledger.
  const across = { half: "delivery", stage: "build", role: "builder", kind: "builder", system: "s", prompt: "p", cwd: wt, root: cold, ledger };
  const reach = scripted({ toolUses: [{ name: "Write", input: { file_path: join(cold, "forge", "delivery", "build.json"), content: "{}" } }] });
  const reached = await refusal(() => call({ ...across, _query: reach.query }));
  const climb = scripted({ toolUses: [{ name: "Read", input: { file_path: "../../discovery/handoffs/handoff-v1.json" } }] });
  const climbed = await refusal(() => call({ ...across, _query: climb.query }));
  check("a Write at the project's forge/ from the worktree is containment; so is a Read that climbs to the project's discovery/; each on its row",
    reached?.code === "containment" && /Write/.test(reached.message) && /forge\/delivery\/build\.json/.test(reached.message) && climbed?.code === "containment" && /Read/.test(climbed.message) && ledgerRows(ledger).slice(-2).every((r) => r.ok === false && /^containment/.test(r.error)), `${reached?.message} · ${climbed?.message}`);
  const readsForge = scripted({ toolUses: [{ name: "Read", input: { file_path: join(cold, "forge", "run.json") } }, { name: "Bash", input: { command: "ls ../../forge" } }] });
  const read = await call({ ...across, _query: readsForge.query });
  check("reading the project's forge/ is not a breach — the fence on forge/ is on writes; the record is not secret, only not the builder's to write", read.text === "ok" && ledgerRows(ledger).at(-1).ok === true);

  // No repository: the round refuses before any call, by name.
  const bare = join(tmp, "bare"); mkdirSync(join(bare, ".git"), { recursive: true });
  const { cold: other } = await seedBuild(tmp, { slug: "quay", files: { "README.md": "# Quay\n" } });
  const norepo = await refusal(() => worktree(join(tmp, "bare")));
  const nested = join(other, "nested"); mkdirSync(nested, { recursive: true });
  const inside = await refusal(() => worktree(nested));
  check("a root with a `.git` directory that is not a repository is no-repo; so is a directory inside someone else's repository — the build is in the project's own, at its top",
    norepo?.code === "no-repo" && inside?.code === "no-repo", `${norepo?.code} · ${inside?.code}`);
});

done();
