// owns: R14 · discovery — the export door: the ready gate — every join green, every hash
// whole — and the three exits: hand off to a team through Jira, send to Delivery, or both.
// Whichever exit, the door writes the same thing: a versioned handoff snapshot — the
// contract the PRD compiles to, the backlog, the design and the prototype as they stood,
// hashed per item. Jira is a projection of that snapshot with the same ids, its keys
// written back onto it, never a chain link. What goes to Delivery carries a signed
// design; what goes to a team carries the design as it stands, with its state on record.

import { validate } from "../../shared/schema/index.mjs";
import { verify } from "../../shared/hash.mjs";
import { pin, deriveVerdict } from "../../shared/judge/index.mjs";
import { checkScope, lineDrawn } from "../../shared/scope.mjs";
import { totals } from "../../shared/agent-call/ledger.mjs";
import { handoffFile, latestHandoff, itemsOf } from "../../shared/handoff.mjs";
import { loadProject, ledgerPath } from "../setup/index.mjs";
import { loadPrd, savePrd, PRD_FILE } from "../workshop/index.mjs";
import { Refused, readDoc, saveDoc, saveVerdict, isSigned, renderPrd, PROTOTYPE_FILE, STORIES_FILE, DESIGN_FILE } from "../record/index.mjs";
import { checkPrototype } from "../prototype/index.mjs";
import { checkStories } from "../stories/index.mjs";
import { checkDesign } from "../design/index.mjs";

export const GATE = "export-ready";
export const EXITS = ["team", "delivery", "both"];
/** Jira issue type names by role; a site that names them differently says so in the jira option. */
export const TYPES = { idea: "Idea", epic: "Epic", story: "Story" };
/** The idea is not an item; its key is filed under this id. */
export const IDEA = "PRD";

// ── the ready gate ──

/** Every join recomputed live and every document's hash checked — one finding-shaped verdict, pinned to what it read. */
export function readiness(root) {
  const prd = loadPrd(root);
  return readinessOf({ prd, proto: readDoc(root, PROTOTYPE_FILE), stories: readDoc(root, STORIES_FILE), design: readDoc(root, DESIGN_FILE) });
}

export function readinessOf({ prd, proto, stories, design }) {
  const joins = [checkScope(prd)];
  if (proto) joins.push(checkPrototype(prd, proto));
  if (proto && stories) joins.push(checkStories(prd, proto, stories));
  if (proto && stories && design) joins.push(checkDesign(proto, stories, design));
  const docs = [[prd, PRD_FILE], [proto, PROTOTYPE_FILE], [stories, STORIES_FILE], [design, DESIGN_FILE]].filter(([d]) => d);
  for (const [doc] of docs) joins.push(verify(doc));
  const findings = joins.flatMap((j) => j.findings);
  return {
    gate: GATE, verdict: deriveVerdict(findings), findings, deferred: [],
    checked: joins.reduce((n, j) => n + j.checked, 0), skipped: 0,
    judged: docs.map(([doc, path]) => pin({ id: doc.id, path, doc })),
  };
}

// ── the contract ──

/** The PRD compiled to what Delivery builds against: its own fields, filtered to the line; rulings in force, approved amendments, open questions. */
export function compile(prd) {
  const inside = new Set(prd.mvp?.inside ?? []);
  const past = new Set((prd.mvp?.past ?? []).map((p) => p.ref));
  const contract = {
    prd: { version: prd.meta.version, content_hash: prd.meta.content_hash },
    title: prd.meta.title, slug: prd.meta.slug,
    problem: prd.problem, shape: prd.shape, solution: prd.solution, okr: prd.okr, constraints: prd.constraints, mvp: prd.mvp,
    surfaces: (prd.surfaces?.shipped ?? []).filter((s) => !past.has(s.id)),
    requirements: (prd.requirements ?? []).filter((r) => inside.has(r.id)),
    rulings: prd.rulings ?? [],
    amendments: (prd.amendments ?? []).filter((a) => a.status === "approved"),
    open_questions: (prd.open_questions ?? []).filter((q) => q.status === "open"),
  };
  const v = validate("contract", contract);
  if (!v.ok) throw new Refused("contract-invalid", `export: the PRD does not compile — ${v.errors.slice(0, 5).join("; ")}`, v.errors);
  return structuredClone(contract);
}

// ── the door ──

/**
 * Export. Refused: an exit that is not one of the three; no named person; a team exit
 * with no Jira site and project (given now or on the last handoff) or no credentials in
 * the environment; no line, prototype or backlog; a record whose joins do not add up
 * (`not-ready`, the findings attached); and — for Delivery or both — no design, or a
 * design nobody has signed. Then the snapshot is written as the next version, Jira is
 * brought to match it (create · update · leave alone, by item hash), and the PRD takes
 * a flag. Credentials are read from JIRA_EMAIL and JIRA_API_TOKEN and written nowhere.
 */
export async function exportHandoff({ root, exit, by, jira: jiraOpts, _now = () => new Date(), _fetch = fetch, _env = process.env }) {
  if (!EXITS.includes(exit)) throw new Refused("bad-exit", `export: the door has three exits — ${EXITS.join(", ")} — and "${exit}" is not one`);
  if (!by?.trim()) throw new Refused("no-author", "export: a handoff is a named person's word — say who");
  const project = loadProject(root);
  const prd = loadPrd(root);
  const previous = latestHandoff(root);
  const toJira = exit !== "delivery";
  const jira = toJira ? jiraConfig(jiraOpts, previous) : (previous?.jira ?? null);
  if (toJira && !jira) throw new Refused("no-jira", "export: handing off to a team goes through Jira — say the site and the project key");
  if (toJira && !(_env.JIRA_EMAIL && _env.JIRA_API_TOKEN)) throw new Refused("no-credentials", "export: JIRA_EMAIL and JIRA_API_TOKEN must be in the environment; they are never written to a record");
  if (!lineDrawn(prd)) throw new Refused("no-line", "export: nothing leaves before the MVP line is drawn");
  const proto = readDoc(root, PROTOTYPE_FILE);
  if (!proto) throw new Refused("no-prototype", "export: there is no prototype — the backlog claims screens it must have");
  const stories = readDoc(root, STORIES_FILE);
  if (!stories) throw new Refused("no-stories", "export: there is no backlog to hand off");
  const design = readDoc(root, DESIGN_FILE);

  const verdict = readinessOf({ prd, proto, stories, design });
  saveVerdict(root, verdict);
  if (verdict.verdict === "block") throw new Refused("not-ready", "export: the record does not add up — every join is green before anything leaves", verdict.findings);
  if (exit !== "team") {
    if (!design) throw new Refused("no-design", "export: Delivery builds what the design states, and there is no design", "none");
    if (!isSigned(design)) throw new Refused("design-unsigned", "export: what goes to Delivery is signed — sign the design first", "unsigned");
  }

  const version = (previous?.version ?? 0) + 1;
  const handoff = {
    id: `handoff-${project.slug}-v${version}`, version, exported_at: _now().toISOString(), by: by.trim(), exit,
    project: { slug: project.slug, title: project.title, remote: project.repo?.remote ?? null },
    contract: compile(prd), prototype: proto, stories, design, items: [], jira, cost: costOf(root), meta: {},
    "x-drift-checked": ["/contract", "/prototype", "/stories", "/design"],
  };
  handoff.items = itemsOf(handoff);
  const file = handoffFile(version);
  const save = () => saveDoc(root, file, "handoff", handoff);
  save();

  const projected = toJira ? await projectToJira({ handoff, previous, prd, save, _fetch, _env }) : null;

  if (jira?.keys[IDEA]) prd.meta.links = { ...(prd.meta.links ?? {}), jira_idea: jira.keys[IDEA] };
  const tally = projected ? ` · Jira ${jira.project}: ${projected.created.length} created, ${projected.updated.length} updated, ${projected.unchanged.length} unchanged` : "";
  prd.flags.push({ at: handoff.exported_at, section: "export", kind: "note", note: `handoff v${version} exported (${exit}) by ${handoff.by}${tally}` });
  savePrd(root, prd);
  return { handoff, file, verdict, jira: projected };
}

/** Site, project and idea project from the option or the last handoff; keys always carry forward. */
function jiraConfig(opts, previous) {
  const prev = previous?.jira ?? null;
  const site = opts?.site ?? prev?.site, project = opts?.project ?? prev?.project;
  if (!site || !project) return null;
  return { site, project, ideas: opts?.ideas ?? prev?.ideas ?? null, types: { ...TYPES, ...(prev?.types ?? {}), ...(opts?.types ?? {}) }, keys: { ...(prev?.keys ?? {}) } };
}

function costOf(root) {
  const t = totals(ledgerPath(root), ["stage"]);
  const sum = (k) => Object.values(t).reduce((n, v) => n + v[k], 0);
  return { usd: sum("usd"), calls: sum("calls"), by_stage: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, { usd: v.usd, calls: v.calls }])) };
}

// ── Jira: a projection with the same ids ──

/**
 * Bring Jira to the snapshot. The idea (when an ideas project is set) with the PRD
 * attached; an epic per requirement inside the line; a story per story under its epic.
 * Ids ride as labels and in every description. An item whose hash is unchanged since
 * the last handoff is left alone; a changed one is updated in place; one that is gone
 * is reported, not touched — the team may have moved it. Keys are written back onto
 * the snapshot as each issue is made, so a failure midway resumes, never duplicates.
 */
async function projectToJira({ handoff, previous, prd, save, _fetch, _env }) {
  const jira = handoff.jira;
  const api = client({ site: jira.site, email: _env.JIRA_EMAIL, token: _env.JIRA_API_TOKEN, _fetch });
  const before = new Map((previous?.items ?? []).map((it) => [`${it.kind}:${it.id}`, it.hash]));
  const now = new Map(handoff.items.map((it) => [`${it.kind}:${it.id}`, it.hash]));
  const out = { created: [], updated: [], unchanged: [], removed: [] };

  const upsert = async (id, changed, fields) => {
    const key = jira.keys[id];
    if (key && !changed) { out.unchanged.push(id); return key; }
    if (key) { await api("PUT", `/issue/${key}`, { fields }); out.updated.push(id); return key; }
    const made = await api("POST", "/issue", { fields });
    jira.keys[id] = made.key;
    save();
    out.created.push(id);
    return made.key;
  };
  const moved = (kind, id) => before.get(`${kind}:${id}`) !== now.get(`${kind}:${id}`);

  if (jira.ideas) {
    const prdMoved = previous?.contract.prd.content_hash !== handoff.contract.prd.content_hash;
    const had = Boolean(jira.keys[IDEA]);
    const key = await upsert(IDEA, prdMoved, ideaFields(handoff));
    if (!had || prdMoved) await attachPrd(api, key, prd);
  }
  for (const req of handoff.contract.requirements) await upsert(req.id, moved("requirement", req.id), epicFields(req, handoff));
  for (const story of handoff.stories.stories) {
    const epic = handoff.stories.epics.find((e) => e.id === story.epic);
    const parent = epic && jira.keys[epic.req_ref];
    if (!parent) throw new Refused("jira-parent-missing", `export: ${story.id} sits under ${story.epic}, whose requirement has no epic in Jira`, story.epic);
    await upsert(story.id, moved("story", story.id), storyFields(story, parent, handoff));
  }
  out.removed = Object.keys(jira.keys).filter((id) => id !== IDEA && !now.has(`requirement:${id}`) && !now.has(`story:${id}`));
  return out;
}

function client({ site, email, token, _fetch }) {
  const auth = `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
  const base = site.replace(/\/+$/, "");
  return async (method, path, body, headers = {}) => {
    const form = body instanceof FormData;
    const res = await _fetch(`${base}/rest/api/3${path}`, {
      method,
      headers: { Authorization: auth, Accept: "application/json", ...(body && !form ? { "Content-Type": "application/json" } : {}), ...headers },
      body: form ? body : body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Refused("jira-error", `export: Jira ${method} ${path} → ${res.status} ${await res.text()}`, res.status);
    return res.status === 204 ? null : res.json();
  };
}

async function attachPrd(api, key, prd) {
  const form = new FormData();
  form.append("file", new Blob([JSON.stringify(prd, null, 2) + "\n"], { type: "application/json" }), "prd.json");
  form.append("file", new Blob([`# ${prd.meta.title}\n\n${renderPrd(prd)}\n`], { type: "text/markdown" }), "prd.md");
  await api("POST", `/issue/${key}/attachments`, form, { "X-Atlassian-Token": "no-check" });
}

// Atlassian Document Format, the little of it a description needs.
const text = (t) => ({ type: "text", text: t });
const p = (t) => ({ type: "paragraph", content: [text(t)] });
const code = (t, language) => ({ type: "codeBlock", attrs: { language }, content: [text(t)] });
const bullets = (items) => ({ type: "bulletList", content: items.map((t) => ({ type: "listItem", content: [p(t)] })) });
const adf = (...content) => ({ type: "doc", version: 1, content: content.flat() });
const clip = (s, n = 255) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const trace = (handoff, ...ids) => `Traces: ${[...ids, `PRD v${handoff.contract.prd.version} ${handoff.contract.prd.content_hash.slice(0, 12)}`, `handoff v${handoff.version}`].join(" · ")}`;

function ideaFields(handoff) {
  const c = handoff.contract, { cost, jira } = handoff;
  return {
    project: { key: jira.ideas }, issuetype: { name: jira.types.idea }, summary: clip(c.title),
    description: adf(
      p(`Who: ${c.problem.who}`), p(`Problem: ${c.problem.problem}`), p(`Crux: ${c.problem.crux}`),
      p(`Objective: ${c.okr.objective}`), p(`MVP line: ${c.mvp.line}`),
      p(`Discovery cost: $${cost.usd.toFixed(2)} over ${cost.calls} model calls.`),
      p(trace(handoff)),
    ),
  };
}

function epicFields(req, handoff) {
  const { jira } = handoff;
  return {
    project: { key: jira.project }, issuetype: { name: jira.types.epic }, summary: clip(`${req.id} · ${req.statement}`), labels: [req.id],
    description: adf(
      p(req.statement), p(`Done when: ${req.done_definition}`),
      bullets(req.acceptance_criteria.map((ac) => `${req.id}/${ac.id} — ${ac.statement}`)),
      p(trace(handoff, req.id)),
    ),
  };
}

function storyFields(story, parent, handoff) {
  const { jira } = handoff;
  return {
    project: { key: jira.project }, issuetype: { name: jira.types.story }, summary: clip(story.statement), parent: { key: parent },
    labels: [story.id, ...story.req_refs, ...story.screen_refs],
    description: adf(
      p(story.statement),
      story.scenarios.flatMap((sc) => [p(`${sc.name} — proves ${sc.proves.join(", ")}`), code(sc.gherkin.trim(), "gherkin")]),
      p(`Screens: ${story.screen_refs.join(", ") || "(none)"}`),
      p(trace(handoff, story.id, ...story.req_refs)),
    ),
  };
}
