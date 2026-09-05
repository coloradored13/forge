// owns: R14 · discovery — the trackers a backlog can be projected to: GitHub Issues
// (the project's own repository, through the gh the PM already has) and Jira Cloud (a
// site and a token). Either is a projection of the snapshot with the same ids — an
// issue per requirement, an issue per story under it — never a chain link. One upsert
// model for both: an item whose hash is unchanged since the last handoff is left alone,
// a changed one is updated in place, one that is gone is reported, not touched; keys
// are written back onto the snapshot as each issue is made, so a failure midway resumes
// and never duplicates. The rendering to files is not a tracker; every export writes it.

import { Refused, renderPrd } from "../record/index.mjs";

export const KINDS = ["github", "jira"];
/** Jira issue type names by role; a site that names them differently says so in the tracker option. */
export const TYPES = { idea: "Idea", epic: "Epic", story: "Story" };
/** The Jira idea is not an item; its key is filed under this id. */
export const IDEA = "PRD";

/**
 * The tracker this export goes to: the option given, filled from the last handoff's
 * tracker of the same kind, or — with no option — whatever the last handoff had. Keys
 * carry forward only to the same place (the same repository; the same site and
 * project) — an issue number means nothing anywhere else, so a new place is a fresh
 * projection. Null means files only.
 */
export function resolveTracker(opts, previous, project) {
  const prev = previous?.tracker ?? null;
  if (opts == null) return prev;
  if (!KINDS.includes(opts.kind)) throw new Refused("bad-tracker", `export: a tracker is one of ${KINDS.join(", ")} — "${opts.kind}" is not one`);
  const last = prev?.kind === opts.kind ? prev : null;
  if (opts.kind === "github") {
    const repo = opts.repo ?? last?.repo ?? repoOf(project?.repo?.remote);
    if (!repo) throw new Refused("bad-tracker", "export: GitHub Issues needs a repository — the project's remote is not on GitHub, so say owner/name");
    const same = last?.repo === repo ? last : null;
    return { kind: "github", repo, keys: { ...(same?.keys ?? {}) } };
  }
  const site = opts.site ?? last?.site, project_ = opts.project ?? last?.project;
  if (!site || !project_) throw new Refused("bad-tracker", "export: Jira needs the site and the project key");
  const same = last?.site === site && last?.project === project_ ? last : null;
  return { kind: "jira", site, project: project_, ideas: opts.ideas ?? same?.ideas ?? null, types: { ...TYPES, ...(same?.types ?? {}), ...(opts.types ?? {}) }, keys: { ...(same?.keys ?? {}) } };
}

/** owner/name from a GitHub remote, ssh or https; null for anything else. */
export function repoOf(remote) {
  const m = typeof remote === "string" && remote.match(/^(?:git@github\.com:|https:\/\/github\.com\/)([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/);
  return m ? m[1] : null;
}

/** Bring the tracker to the snapshot (the door has already checked credentials). Returns what was created, updated, left alone and gone. */
export async function project({ handoff, previous, prd, save, root, _fetch, _env, _exec }) {
  const t = handoff.tracker;
  const before = new Map((previous?.items ?? []).map((it) => [`${it.kind}:${it.id}`, it.hash]));
  const now = new Map(handoff.items.map((it) => [`${it.kind}:${it.id}`, it.hash]));
  const out = { kind: t.kind, created: [], updated: [], unchanged: [], removed: [] };
  const moved = (kind, id) => before.get(`${kind}:${id}`) !== now.get(`${kind}:${id}`);
  // create(fields) → key · update(key, fields)
  const io = t.kind === "github" ? github(t, { _exec, root }) : jira(t, { _fetch, _env });

  const upsert = async (id, changed, fields) => {
    const key = t.keys[id];
    if (key !== undefined && !changed) { out.unchanged.push(id); return key; }
    if (key !== undefined) { await io.update(key, fields); out.updated.push(id); return key; }
    const made = await io.create(fields);
    t.keys[id] = made;
    save();
    out.created.push(id);
    return made;
  };

  if (t.kind === "jira" && t.ideas) {
    const prdMoved = previous?.contract.prd.content_hash !== handoff.contract.prd.content_hash;
    const had = IDEA in t.keys;
    const key = await upsert(IDEA, prdMoved, io.idea(handoff));
    if (!had || prdMoved) await io.attach(key, prd);
  }
  for (const req of handoff.contract.requirements) await upsert(req.id, moved("requirement", req.id), io.epic(req, handoff));
  for (const story of handoff.stories.stories) {
    const epic = handoff.stories.epics.find((e) => e.id === story.epic);
    const parent = epic && t.keys[epic.req_ref];
    if (parent === undefined) throw new Refused("tracker-parent-missing", `export: ${story.id} sits under ${story.epic}, whose requirement has no issue in the tracker`, story.epic);
    await upsert(story.id, moved("story", story.id), io.story(story, parent, handoff));
  }
  out.removed = Object.keys(t.keys).filter((id) => id !== IDEA && !now.has(`requirement:${id}`) && !now.has(`story:${id}`));
  return out;
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const trace = (handoff, ...ids) => `Traces: ${[...ids, `PRD v${handoff.contract.prd.version} ${handoff.contract.prd.content_hash.slice(0, 12)}`, `handoff v${handoff.version}`].join(" · ")}`;

// ── GitHub Issues, through gh ──

function github(t, { _exec, root }) {
  const api = (method, path, fields) => {
    const args = ["api", "-X", method, `repos/${t.repo}/${path}`, ...Object.entries(fields).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => ["-f", `${k}[]=${x}`]) : [["-f", `${k}=${v}`]]).flat())];
    let out;
    try { out = _exec("gh", args, { cwd: root }); } catch (e) { throw new Refused("tracker-error", `export: gh ${method} ${path} failed — ${String(e.stderr ?? e.message).trim()}`, t.kind); }
    return out ? JSON.parse(out) : {};
  };
  return {
    create: async (fields) => api("POST", "issues", fields).number,
    update: async (number, fields) => { api("PATCH", `issues/${number}`, fields); },
    epic: (req, handoff) => ({
      title: clip(`${req.id} · ${req.statement}`, 256), labels: ["epic", req.id],
      body: [req.statement, `**Done when:** ${req.done_definition}`, req.acceptance_criteria.map((ac) => `- ${req.id}/${ac.id} — ${ac.statement}`).join("\n"), `_${trace(handoff, req.id)}_`].join("\n\n"),
    }),
    story: (story, parent, handoff) => ({
      title: clip(story.statement, 256), labels: ["story", story.id, ...story.req_refs, ...story.screen_refs],
      body: [
        `Part of #${parent}`, story.statement,
        ...story.scenarios.map((sc) => `**${sc.name}** — proves ${sc.proves.join(", ")}\n\`\`\`gherkin\n${sc.gherkin.trim()}\n\`\`\``),
        `**Screens:** ${story.screen_refs.join(", ") || "(none)"}`, `_${trace(handoff, story.id, ...story.req_refs)}_`,
      ].join("\n\n"),
    }),
  };
}

// ── Jira Cloud, REST v3 ──

function jira(t, { _fetch, _env }) {
  const auth = `Basic ${Buffer.from(`${_env.JIRA_EMAIL}:${_env.JIRA_API_TOKEN}`).toString("base64")}`;
  const base = t.site.replace(/\/+$/, "");
  const api = async (method, path, body, headers = {}) => {
    const form = body instanceof FormData;
    const res = await _fetch(`${base}/rest/api/3${path}`, {
      method,
      headers: { Authorization: auth, Accept: "application/json", ...(body && !form ? { "Content-Type": "application/json" } : {}), ...headers },
      body: form ? body : body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Refused("tracker-error", `export: Jira ${method} ${path} → ${res.status} ${await res.text()}`, t.kind);
    return res.status === 204 ? null : res.json();
  };
  // Atlassian Document Format, the little of it a description needs.
  const text = (s) => ({ type: "text", text: s });
  const p = (s) => ({ type: "paragraph", content: [text(s)] });
  const code = (s, language) => ({ type: "codeBlock", attrs: { language }, content: [text(s)] });
  const bullets = (items) => ({ type: "bulletList", content: items.map((s) => ({ type: "listItem", content: [p(s)] })) });
  const adf = (...content) => ({ type: "doc", version: 1, content: content.flat() });
  return {
    create: async (fields) => (await api("POST", "/issue", { fields })).key,
    update: async (key, fields) => { await api("PUT", `/issue/${key}`, { fields }); },
    attach: async (key, prd) => {
      const form = new FormData();
      form.append("file", new Blob([JSON.stringify(prd, null, 2) + "\n"], { type: "application/json" }), "prd.json");
      form.append("file", new Blob([`# ${prd.meta.title}\n\n${renderPrd(prd)}\n`], { type: "text/markdown" }), "prd.md");
      await api("POST", `/issue/${key}/attachments`, form, { "X-Atlassian-Token": "no-check" });
    },
    idea: (handoff) => {
      const c = handoff.contract, { cost } = handoff;
      return {
        project: { key: t.ideas }, issuetype: { name: t.types.idea }, summary: clip(c.title, 255),
        description: adf(
          p(`Who: ${c.problem.who}`), p(`Problem: ${c.problem.problem}`), p(`Crux: ${c.problem.crux}`),
          p(`Objective: ${c.okr.objective}`), p(`MVP line: ${c.mvp.line}`),
          p(`Discovery cost: $${cost.usd.toFixed(2)} over ${cost.calls} model calls.`),
          p(trace(handoff)),
        ),
      };
    },
    epic: (req, handoff) => ({
      project: { key: t.project }, issuetype: { name: t.types.epic }, summary: clip(`${req.id} · ${req.statement}`, 255), labels: [req.id],
      description: adf(p(req.statement), p(`Done when: ${req.done_definition}`), bullets(req.acceptance_criteria.map((ac) => `${req.id}/${ac.id} — ${ac.statement}`)), p(trace(handoff, req.id))),
    }),
    story: (story, parent, handoff) => ({
      project: { key: t.project }, issuetype: { name: t.types.story }, summary: clip(story.statement, 255), parent: { key: parent },
      labels: [story.id, ...story.req_refs, ...story.screen_refs],
      description: adf(
        p(story.statement),
        story.scenarios.flatMap((sc) => [p(`${sc.name} — proves ${sc.proves.join(", ")}`), code(sc.gherkin.trim(), "gherkin")]),
        p(`Screens: ${story.screen_refs.join(", ") || "(none)"}`),
        p(trace(handoff, story.id, ...story.req_refs)),
      ),
    }),
  };
}
