#!/usr/bin/env node
// owns: R14 · shared — eval: the seam. The static half — the import rule — and the
// project-repo half: one repo per project, created or attached by Discovery's setup,
// never a directory inside the pipeline checkout. The cold-intake half (a handoff read
// in a temp root with discovery/ absent) joins at M2 and lives in this file. git and gh
// are scripted — no real repo is ever created here (R15).

import { existsSync, readFileSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { suite, withRoot, scripted, ROOT } from "./_harness.mjs";
import { seedProject, seedPrototype, seedStories, seedDesign, STORIES } from "./_fixture.mjs";
import { violations } from "../tools/import-rule.mjs";
import { load, inlineRefs, outputContract, fields, validate } from "../shared/schema/index.mjs";
import { verify } from "../shared/hash.mjs";
import { KINDS, itemFields, itemsOf, verifyHandoff, readHandoffs, latestHandoff, handoffFile, HANDOFFS } from "../shared/handoff.mjs";
import { setupProject, loadProject, ledgerPath, insidePipeline, SetupRefused, PIPELINE_ROOT } from "../discovery/setup/index.mjs";
import { loadPrd } from "../discovery/workshop/index.mjs";
import { readDoc, readVerdict, isSigned, DESIGN_FILE, REVIEWS } from "../discovery/record/index.mjs";
import { answer } from "../discovery/doors/index.mjs";
import { review, signoff } from "../discovery/design/index.mjs";
import { exportHandoff, readiness, compile, GATE as EXPORT_GATE, EXITS, IDEA } from "../discovery/export/index.mjs";

const { check, done } = suite("seam · import rule, project repo, handoff");

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

// ── the export door: the ready gate, three exits, the snapshot, Jira as a projection ──
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
const ENV = { JIRA_EMAIL: "pm@acme.test", JIRA_API_TOKEN: "tok-secret-9f3a" };
const JIRA = { site: "https://acme.atlassian.net/", project: "DOCK", ideas: "IDEAS" };
const refusal = (fn) => Promise.resolve().then(fn).then(() => null, (e) => e);
const clean = () => scripted({ structured: { findings: [], deferred: [], checked: 2, skipped: 0 } }).query;

await withRoot({}, async (tmp) => {
  const root = seedProject(tmp);
  const j = jiraScript();
  const go = (exit, opts = {}) => exportHandoff({ root, exit, by: "Brad", jira: JIRA, _fetch: j.fetch, _env: ENV, _now: () => new Date("2026-09-05T12:00:00Z"), ...opts });

  // Refusals, in the order the door asks — nothing written, nothing fetched.
  check("EXITS are the spec's three", EXITS.join() === "team,delivery,both");
  const bad = await refusal(() => go("jira"));
  check("an exit that is not one of the three is refused", bad?.code === "bad-exit", bad?.message);
  const anon = await refusal(() => go("team", { by: " " }));
  check("no named person, no handoff", anon?.code === "no-author");
  const noJira = await refusal(() => go("team", { jira: undefined }));
  check("a team exit with no Jira site and project is refused before anything is read", noJira?.code === "no-jira", noJira?.message);
  const noCreds = await refusal(() => go("team", { _env: {} }));
  check("a team exit with no credentials in the environment is refused", noCreds?.code === "no-credentials");
  const noProto = await refusal(() => go("delivery"));
  check("a Delivery exit needs no Jira, and is refused without a prototype", noProto?.code === "no-prototype", noProto?.message);
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

  // Jira: idea with the PRD attached, an epic per requirement, a story under its epic.
  const seq = j.calls.map((c) => `${c.method} ${c.path.replace("/rest/api/3", "")}`);
  check("the sequence is idea → attachments → three epics → two stories, all against the site given",
    seq.join(" | ") === "POST /issue | POST /issue/IDEAS-1/attachments | POST /issue | POST /issue | POST /issue | POST /issue | POST /issue" && j.calls.every((c) => c.host === "acme.atlassian.net"), seq.join(" | "));
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
    stories[0].parent.key === h1.jira.keys["REQ-1"] && stories[1].parent.key === h1.jira.keys["REQ-2"] && stories[0].labels.join() === "STORY-1,REQ-1,SCREEN-1" && stories[0].description.content.some((b) => b.type === "codeBlock" && b.attrs.language === "gherkin") && JSON.stringify(stories[0].description).includes("proves REQ-1/AC-1"), JSON.stringify(stories[0].labels));
  check("every key is written back onto the snapshot, the idea under PRD; the PRD links the idea; the flag says what left and what Jira got",
    Object.keys(h1.jira.keys).sort().join() === "PRD,REQ-1,REQ-2,REQ-4,STORY-1,STORY-2" && h1.jira.keys[IDEA] === "IDEAS-1" && loadPrd(root).meta.links.jira_idea === "IDEAS-1" && /^handoff v1 exported \(team\) by Brad · Jira DOCK: 6 created, 0 updated, 0 unchanged$/.test(loadPrd(root).flags.at(-1).note), loadPrd(root).flags.at(-1).note);
  check("the projection reports what it did", v1.jira.created.length === 6 && v1.jira.updated.length === 0 && v1.jira.removed.length === 0);
  const written = readFileSync(join(root, v1.file), "utf8") + readFileSync(join(root, "discovery", "prd.json"), "utf8");
  check("no credential is written to any record", !written.includes("tok-secret") && !written.includes("pm@acme.test"));
  check("the keys did not move the hash — Jira and cost are outside the snapshot's content", verify({ ...h1, jira: null }).verdict === "pass" && verifyHandoff({ ...h1, jira: null, cost: { usd: 9, calls: 9, by_stage: {} } }).verdict === "pass");

  // Exporting again with nothing changed: a new version, and Jira is not touched.
  j.calls.length = 0;
  const v2 = await go("team", { jira: undefined });
  check("a re-export is v2 beside v1, carries site, project and keys from v1 without being told them, and makes no Jira call — every item is unchanged",
    v2.handoff.version === 2 && readHandoffs(root).length === 2 && v2.handoff.jira.site === JIRA.site && v2.handoff.jira.keys["STORY-2"] === h1.jira.keys["STORY-2"] && j.calls.length === 0 && v2.jira.unchanged.length === 6 && v2.jira.created.length === 0, JSON.stringify(v2.jira));

  // The design: a team takes it as it stands; Delivery takes it signed.
  const noDesign = await refusal(() => go("delivery"));
  check("Delivery with no design is refused, and the detail says none", noDesign?.code === "no-design" && noDesign.detail === "none");
  seedDesign(root);
  const unsigned = await refusal(() => go("delivery"));
  check("Delivery with an unsigned design is refused — the user's ruling: if it goes to Delivery it is signed", unsigned?.code === "design-unsigned" && unsigned.detail === "unsigned" && readHandoffs(root).length === 2);
  const both = await refusal(() => go("both"));
  check("both exits together are held to the same signature", both?.code === "design-unsigned");
  const v3 = await go("team", { jira: undefined });
  check("a team takes the design as it stands — embedded, unsigned, with its screens indexed; no gate, no staleness check",
    v3.handoff.version === 3 && v3.handoff.design !== null && !("signoff" in v3.handoff.design) && !isSigned(v3.handoff.design) && kinds(v3.handoff).screen === 2 && j.calls.length === 0, JSON.stringify(kinds(v3.handoff)));
  await review({ root, _query: clean() });
  signoff(root, { by: "Ana Ruiz" });
  const v4 = await go("delivery");
  check("once signed, Delivery takes it: the sign-off rides in the snapshot with the name on it, the reviewer's verdict beside it",
    v4.handoff.version === 4 && v4.handoff.exit === "delivery" && isSigned(v4.handoff.design) && v4.handoff.design.signoff.by === "Ana Ruiz" && v4.handoff.design.signoff.review.gate === "design-reviewer" && verifyHandoff(v4.handoff).verdict === "pass");
  check("a Delivery exit makes no Jira call and still carries the keys forward; the review it took to get here is in the cost", j.calls.length === 0 && v4.jira === null && v4.handoff.jira.keys[IDEA] === "IDEAS-1" && v4.handoff.cost.calls === 1 && "design" in v4.handoff.cost.by_stage && v4.verdict.judged.length === 4, JSON.stringify(v4.handoff.cost));
  check("the design signed in the snapshot is the design on disk, hash for hash", v4.handoff.design.meta.content_hash === readDoc(root, DESIGN_FILE).meta.content_hash);

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
  const v5 = await go("both", { jira: undefined });
  const seq5 = j.calls.map((c) => `${c.method} ${c.path.replace("/rest/api/3", "")}`);
  check("both: v5 exported, the PRD moved so the idea is updated and the PRD re-attached; REQ-1's epic and STORY-1 are updated in place; nothing is created",
    v5.handoff.version === 5 && v5.handoff.exit === "both" && seq5.join(" | ") === "PUT /issue/IDEAS-1 | POST /issue/IDEAS-1/attachments | PUT /issue/DOCK-1 | PUT /issue/DOCK-4" && v5.jira.updated.join() === "PRD,REQ-1,STORY-1" && v5.jira.unchanged.join() === "REQ-2,REQ-4,STORY-2" && v5.jira.created.length === 0, seq5.join(" | "));
  check("the updated epic carries the new criterion and the updated story its new scenario", JSON.stringify(j.calls[2].body.fields.description).includes("REQ-1/AC-3") && JSON.stringify(j.calls[3].body.fields.description).includes("After the truck has left"));
  check("the contract carries the ruling and the criterion it wrote; the ruling is an indexed item", v5.handoff.contract.rulings.length === 1 && v5.handoff.contract.rulings[0].criterion === "REQ-1/AC-3" && kinds(v5.handoff).ruling === 1 && v5.handoff.contract.prd.version === loadPrd(root).meta.version && v5.handoff.contract.requirements[0].acceptance_criteria.length === 3);
  check("the handoffs read back in order and the latest is v5", readHandoffs(root).map((h) => h.version).join() === "1,2,3,4,5" && latestHandoff(root).version === 5 && readdirSync(join(root, HANDOFFS)).length === 5);

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

  // A second project: Jira fails midway, the snapshot stands with the keys it got, and the next export resumes.
  const oven = seedProject(tmp, { slug: "oven" });
  seedPrototype(oven); seedStories(oven);
  const failing = jiraScript({ fail: (n) => n === 4 });
  const midway = await refusal(() => exportHandoff({ root: oven, exit: "team", by: "Brad", jira: JIRA, _fetch: failing.fetch, _env: ENV }));
  const partial = latestHandoff(oven);
  check("a Jira error is a refusal naming the call; the snapshot was already written, holding the idea and the first epic's keys",
    midway?.code === "jira-error" && /POST \/issue → 400/.test(midway.message) && partial?.version === 1 && Object.keys(partial.jira.keys).sort().join() === "PRD,REQ-1" && loadPrd(oven).flags.length === 0, midway?.message);
  const resumed = jiraScript();
  const again = await exportHandoff({ root: oven, exit: "team", by: "Brad", _fetch: resumed.fetch, _env: ENV });
  const seqR = resumed.calls.map((c) => `${c.method} ${c.path.replace("/rest/api/3", "")}`);
  check("the next export resumes: the idea and REQ-1 are left alone, the remaining epics and stories are created — nothing duplicated",
    again.handoff.version === 2 && seqR.join(" | ") === "POST /issue | POST /issue | POST /issue | POST /issue" && again.jira.created.join() === "REQ-2,REQ-4,STORY-1,STORY-2" && again.jira.unchanged.join() === "PRD,REQ-1" && again.handoff.jira.keys["REQ-1"] === partial.jira.keys["REQ-1"], seqR.join(" | "));
  check("the reviews directory holds the export verdict beside the others", existsSync(join(oven, REVIEWS, `${EXPORT_GATE}.json`)));
});

done();
