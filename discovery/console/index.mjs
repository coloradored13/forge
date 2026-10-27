// owns: R1, R10 · discovery — the PM's console: the four Discovery views rendered from
// their view models, every trigger a form on a door with its cost shown first, every
// long door streamed to the page. Nothing here reads the record but through the views,
// nothing moves it but through the doors, and a refusal is the door's own words. The
// Delivery run view is Delivery's (delivery/console); the release view answers with the
// milestone that brings its record.

import { join } from "node:path";
import { esc, usd, when, short, badge, table, dl, form, quoteStrip, refusalHtml, TONE, verdictLine, findingRows, findingsHtml } from "../../shared/console/index.mjs";
import { setupProject, SetupRefused } from "../setup/index.mjs";
import { openPrd, turn, extract } from "../workshop/index.mjs";
import { generate } from "../prototype/index.mjs";
import { write as writeStories, review as reviewStories } from "../stories/index.mjs";
import { write as writeDesign, review as reviewDesign, signoff } from "../design/index.mjs";
import { answer, propose, approve, reject, agree } from "../doors/index.mjs";
import { exportHandoff } from "../export/index.mjs";
import { readDoc, renderPrd, renderPrototype, renderStories, renderDesign, HTML_FILE } from "../record/index.mjs";
import { VIEWS, ARTIFACTS, setupView, workshopView, boardView, exportView } from "./views.mjs";
import { singleAttempt } from "../../shared/agent-call/index.mjs";

// A Discovery request from the console makes one model attempt: a usage gap refuses with its
// reset instead of holding the page for hours (plan line 27). Delivery and direct calls pause.
const once = (table) => table.map((r) => ({ ...r, handler: async (ctx) => {
  const out = await singleAttempt.run(true, () => r.handler(ctx));
  return out?.work ? { ...out, work: (log) => singleAttempt.run(true, () => out.work(log)) } : out;
} }));

/** The nav, from the spec's six. */
export const nav = VIEWS.map((v) => ({ href: `/${v.key}`, label: v.label }));

const RENDER = { prd: renderPrd, prototype: renderPrototype, stories: renderStories, design: renderDesign };
const STATUS = { complete: "ok", in_progress: "warn", pending: "muted" };
const list = (xs, sep = ", ") => (xs?.length ? esc(xs.join(sep)) : `<span class="muted">none</span>`);
const blank = (s) => (s?.trim() ? s.trim() : undefined);
const jsonOrText = (s) => { try { return JSON.parse(s); } catch { return s; } };

// ── setup ──

function setupPage(v, { values, error } = {}) {
  // a call's likely cost is the ledger's mean for that role and model — never a rate card (R1); Delivery's roles are priced on the run view
  const history = (r) => (r.estimate == null ? `<span class="muted">${r.half === "delivery" && v.project ? "priced on the Delivery run view" : "—"}</span>` : r.estimate.basis === "none" ? `<span class="muted">no history yet</span>` : `~${usd(r.estimate.usd)} a call <span class="muted">(${r.estimate.n} so far)</span>`);
  const rolesTable = table(["role", "half", "model", "", "a call, from history"], v.roles.map((r) => [`<code>${esc(r.key)}</code>`, esc(r.half), `<code>${esc(r.model)}</code>`, r.overridden ? badge(`override · default ${r.default}`, "warn") : badge("default", "muted"), history(r)]));
  if (!v.project) {
    // A refused setup comes back with what the PM typed; an unfinished one is finished, not attached.
    const val = (name, fallback) => values?.[name] ?? fallback;
    return { title: "Setup", body: `<h1>${v.resume ? "Finish setting up" : "Set up a project"}</h1><p class="muted">${esc(v.root)}</p>`
      + (error ? refusalHtml(error) : "")
      + (v.resume && !error ? `<p class="note">Setup stopped partway. Finish setup to complete what is missing — nothing needs cleaning up.</p>` : "") + form({
      action: "/setup", submit: v.resume ? "Finish setup" : "Set up",
      fields: [
        { name: "slug", label: "slug", value: val("slug", v.slug), required: true },
        { name: "title", label: "title", value: val("title", v.title ?? "") },
        { name: "existing", label: "this path is already a repository — attach it", type: "checkbox", checked: values ? Boolean(values.existing) : v.existing },
        { name: "budget", label: "budget in USD (blank: no cap — cost is the subscription's)", type: "number", step: "0.01", value: val("budget", v.budget ?? "") },
        ...v.roles.map((r) => ({ name: `model.${r.key}`, label: `model · ${r.key}`, value: val(`model.${r.key}`, r.model) })),
      ],
      note: "A new project is its own repository: git init, a private remote through gh, then its first commits. The models and the budget set here are what every door reads.",
    }) };
  }
  const s = v.standing;
  const standing = s.budget == null ? `<p class="quote">${usd(s.spent)} spent · no cap</p>` : `<p class="quote${s.over ? " over" : ""}">${usd(s.spent)} of ${usd(s.budget)} spent · ${usd(s.remaining)} remains${s.over ? " · " + badge("over budget", "bad") : ""}</p>`;
  return { title: "Setup", body: `<h1>${esc(v.project.title)} <span class="muted">${esc(v.project.slug)}</span></h1>`
    + dl([["root", esc(v.root)], ["remote", esc(v.project.repo?.remote ?? "none")], ["created", when(v.project.created)]])
    + `<h2>Model per role</h2>${rolesTable}<p class="note">Set at setup and read by every call; the ledger records which model each verdict came from.</p>`
    + `<h2>Budget</h2>${standing}`
    + `<h2>Cost by stage</h2>${table(["stage", "calls", "usd"], v.cost.map((c) => [esc(c.stage), c.calls, usd(c.usd)]))}` };
}

// ── workshop ──

function workshopPage(v, key) {
  if (!v.prd) {
    return { title: "Workshop", body: `<h1>Open the PRD</h1>` + form({
      action: "/workshop/open", submit: "Open",
      fields: [
        { name: "title", label: "title", value: v.offer.title, required: true },
        { name: "slug", label: "slug", value: v.offer.slug, required: true },
        { name: "seed", label: "the idea, as you would say it", type: "textarea", rows: 4, required: true },
        { name: "owner", label: "owner", value: "" },
      ],
      note: "The seed is kept verbatim. The workshop then takes one section at a time — shape before scope.",
    }) };
  }
  const c = v.current;
  const sections = `<p>${v.sections.map((s) => `<a href="/workshop/${esc(s.key)}"${s.key === c.key ? ' class="current"' : ""}>${esc(s.label)}</a> ${badge(s.status, STATUS[s.status] ?? "muted")}${s.turns ? ` <span class="muted">${s.turns} ${s.turns === 1 ? "turn" : "turns"}</span>` : ""}`).join(" &nbsp;·&nbsp; ")}</p>`;
  const transcript = v.transcript.length
    ? `<div class="transcript">${v.transcript.map((r) => `<p class="${esc(r.from)}"><span class="who">${esc(r.from)} · ${when(r.at)}${r.mode ? ` · ${esc(r.mode)}` : ""}${r.usd != null ? ` · ${usd(r.usd)}` : ""}${r.signals?.length ? ` · ${esc(r.signals.join(" "))}` : ""}</span>${esc(r.text)}</p>`).join("")}</div>`
    : `<p class="muted">no turns yet</p>`;
  const doors = c.why
    ? `<p class="refusal">${esc(c.why)}</p>`
    : quoteStrip(v.quote)
      + form({ action: `/workshop/${c.key}/turn`, submit: "Say it", fields: [{ name: "text", label: "your turn", type: "textarea", rows: 4, required: true }] })
      + form({ action: `/workshop/${c.key}/extract`, submit: "Extract", note: `Reads this section's transcript into the PRD's fields; the section's status moves with it. Same model, same quote.` });
  return { title: `Workshop · ${c.label}`, body: `<h1>${esc(v.prd.title)} <span class="muted">v${esc(v.prd.version)} · ${esc(v.prd.doc_status)}${v.line_drawn ? " · line drawn" : ""}</span></h1>${sections}`
    + `<h2>${esc(c.label)}</h2>${transcript}${doors}`
    + `<h2>Captured so far</h2><pre>${esc(v.captured)}</pre>`
    + (v.flags.length ? `<h2>Flags on record</h2>${table(["at", "section", "kind", "note"], v.flags.map((f) => [when(f.at), esc(f.section), badge(f.kind, f.kind === "note" ? "muted" : "warn"), esc(f.note)]))}` : "") };
}

// ── board ──

function artifactRow(a) {
  const state = !a.present ? badge("absent", "muted")
    : [a.stale ? badge(`stale · ${a.moved.join("+")} moved${a.since.length ? ` · since ${a.since.join(", ")}` : ""}`, "warn") : badge("current", "ok"), a.kind === "design" ? (a.signed ? badge(`signed by ${a.signoff.by}`, "ok") : badge("unsigned", "muted")) : ""].join(" ");
  const links = a.present ? [`<a href="/artifact/${esc(a.kind)}">read</a>`, a.html ? `<a href="/prototype/index.html">open</a>` : ""].filter(Boolean).join(" · ") : "";
  return [esc(a.kind), a.present ? `v${esc(a.version)} <code>${esc(short(a.hash))}</code>` : "—", state, a.gates.map(verdictLine).join("<br>") || `<span class="muted">—</span>`, links];
}

function boardPage(v) {
  const by = { name: "by", label: "by", required: true };
  const w = quoteStrip(v.quotes.writer), r = quoteStrip(v.quotes.reviewer);
  const present = Object.fromEntries(v.artifacts.map((a) => [a.kind, a.present]));
  const doors = `<div class="cols">`
    + `<section><h3>Prototype</h3>${w}${form({ action: "/prototype/generate", submit: present.prototype ? "Regenerate" : "Generate", fields: [{ name: "notes", label: "notes to the writer", type: "textarea", rows: 2 }] })}</section>`
    + `<section><h3>Stories</h3>${w}${form({ action: "/doors/agree", submit: "Agree", fields: [by], note: "Agree to this PRD and the prototype built from it. Stories are written only from the revision the PM agreed." })}${form({ action: "/stories/write", submit: present.stories ? "Rewrite" : "Write", fields: [{ name: "notes", label: "notes to the writer", type: "textarea", rows: 2 }] })}${r}${form({ action: "/stories/review", submit: "Review" })}</section>`
    + `<section><h3>Design</h3>${w}${form({ action: "/design/write", submit: present.design ? "Rewrite" : "Write", fields: [{ name: "notes", label: "notes to the writer", type: "textarea", rows: 2 }] })}${r}${form({ action: "/design/review", submit: "Review" })}`
    + form({ action: "/design/signoff", submit: "Sign", fields: [by, { name: "note", label: "note" }, { name: "override_reason", label: "override a BLOCK — reason on the record", value: "" }], note: "Signing needs a fresh reviewer verdict on this exact design. Over a BLOCK, the reason is the record." }) + `</section></div>`;

  const open = v.open_questions.filter((q) => q.status === "open");
  const questions = table(["id", "question", "owner", "status"], v.open_questions.map((q) => [esc(q.id), esc(q.question), esc(q.owner), badge(q.status, q.status === "open" ? "warn" : "muted")]));
  const answerForm = form({
    action: "/doors/answer", submit: "Answer",
    fields: [
      { name: "oq", label: "open question", type: "select", options: [["", "— state a question instead —"], ...open.map((q) => [q.id, `${q.id} ${q.question}`])] },
      { name: "pq", label: "or a question the prototype asks", type: "select", options: [["", "—"], ...v.prototype_questions.map((q) => [q.id, `${q.id}${q.blocking ? " (blocks stories)" : ""} ${q.question}`])] },
      { name: "question", label: "the question, if not one of those" },
      { name: "req", label: "the requirement it becomes a criterion of", type: "select", required: true, options: v.requirements.map((q) => [q.id, `${q.id}${q.inside ? "" : " (past the line)"} ${q.statement}`]) },
      { name: "answer", label: "answer", type: "textarea", rows: 2, required: true },
      { name: "criterion", label: "criterion wording (blank: the answer, verbatim)" },
      by,
    ],
    note: "A ruling becomes an acceptance criterion and bumps the PRD's minor version; what traces the old version shows stale.",
  });
  const rulings = table(["id", "question", "answer", "criterion"], v.rulings.map((x) => [esc(x.id) + (x.oq ? ` <span class="muted">${esc(x.oq)}</span>` : ""), esc(x.question), esc(x.answer), `<code>${esc(x.criterion)}</code>`]));

  const amendRow = (a) => {
    const rad = a.radius_now ?? a.radius;
    const radius = [...rad.criteria, ...rad.stories, ...rad.screens];
    const decide = a.status !== "proposed" ? `${badge(a.status, a.status === "approved" ? "ok" : "muted")}${a.decided ? `<br><span class="muted">${esc(a.decided.by)} · ${when(a.decided.at)}${a.decided.note ? ` · ${esc(a.decided.note)}` : ""}</span>` : ""}`
      : form({ action: "/doors/approve", submit: "Approve", fields: [{ name: "id", type: "hidden", value: a.id }, ...radius.map((id) => ({ name: "radius", label: `touches ${id}`, type: "checkbox", value: id })), by], note: radius.length ? "Approving acknowledges every item the change touches, as they stand now." : "Nothing else is touched." })
        + form({ action: "/doors/reject", submit: "Reject", fields: [{ name: "id", type: "hidden", value: a.id }, { name: "reason", label: "reason", required: true }, by] });
    return [`${esc(a.id)}<br><span class="muted">${esc(a.origin)} · ${esc(a.by)} · ${when(a.at)}</span>`, `<code>${esc(a.target)}</code>${a.material ? " " + badge("material", "warn") : ""}<br><span class="muted">${a.adds ? "adds" : `from ${esc(JSON.stringify(a.from))}`}</span><br>to ${esc(JSON.stringify(a.to))}`, esc(a.rationale), `${list(radius)}${rad.terms.length ? `<br><span class="muted">terms: ${esc(rad.terms.join(", "))}</span>` : ""}${a.introduces?.length ? `<br><span class="muted">introduces: ${esc(a.introduces.join(", "))}</span>` : ""}`, decide];
  };
  const amendments = table(["amendment", "target", "rationale", "radius", "decision"], v.amendments.map(amendRow));
  const proposeForm = form({
    action: "/doors/propose", submit: "Propose",
    fields: [{ name: "target", label: "target — a JSON pointer into the PRD's content, e.g. /requirements/0/statement", required: true }, { name: "to", label: "what it will hold (JSON, or plain text)", type: "textarea", rows: 2, required: true }, { name: "rationale", label: "rationale", type: "textarea", rows: 2, required: true }, by],
    note: "A proposal is audited at mint: its radius and any vocabulary it introduces are on the record before anyone approves it.",
  });

  const cost = `<p class="quote">${usd(v.cost.usd)} · ${v.cost.calls} calls</p>` + table(["stage", "calls", "usd"], Object.entries(v.cost.by_stage).map(([k, c]) => [esc(k), c.calls, usd(c.usd)]));

  return { title: "Board", body: `<h1>${esc(v.prd.title)} <span class="muted">v${esc(v.prd.version)} · <code>${esc(short(v.prd.hash))}</code> · ${esc(v.prd.doc_status)}</span></h1>${v.line ? `<p>MVP line: ${esc(v.line)}</p>` : `<p class="muted">the MVP line is not drawn</p>`}`
    + `<h2>Artifacts</h2>${table(["artifact", "version", "state", "gates", ""], v.artifacts.map(artifactRow))}`
    + findingsHtml(v.gates)
    + `<h2>Doors</h2>${doors}`
    + `<h2>Open questions</h2>${questions}${open.length || v.requirements.length ? answerForm : ""}`
    + `<h2>Rulings</h2>${rulings}`
    + `<h2>Amendments</h2>${amendments}${proposeForm}`
    + `<h2>Cost</h2>${cost}` };
}

// ── export ──

function exportPage(v) {
  const ready = v.readiness;
  const readiness = `<p>${esc(ready.gate)}: ${badge(ready.verdict, TONE[ready.verdict] ?? "warn")} <span class="muted">${ready.checked} checked · ${ready.skipped} skipped</span></p>`
    + (ready.findings.length ? table(["severity", "rule", "subject", "what"], findingRows(ready.findings)) : "");
  const tracker = v.tracker ? `<p>${esc(v.tracker.kind)} · ${esc(v.tracker.where)} · ${v.tracker.keyed} items keyed <span class="muted">as of handoff v${v.tracker.version}</span></p>` : `<p class="muted">files only — no tracker projected yet</p>`;
  const handoffs = table(["version", "exit", "by", "exported", "tracker", "design", "cost", ""], v.handoffs.map((h) => [`v${h.version}`, esc(h.exit), esc(h.by), when(h.exported_at), h.tracker ? esc(`${h.tracker.kind} · ${h.tracker.kind === "github" ? h.tracker.repo : `${h.tracker.site} · ${h.tracker.project}`} · ${Object.keys(h.tracker.keys ?? {}).length} keyed`) : `<span class="muted">files only</span>`, esc(h.design), `${usd(h.cost?.usd)} · ${h.cost?.calls ?? 0} calls`, `<code>${esc(h.file)}</code>`]));
  const exportForm = form({
    action: "/export", submit: "Export",
    fields: [
      { name: "exit", label: "exit", type: "select", required: true, options: v.exits.map((e) => [e, e]) },
      { name: "tracker", label: "tracker (team and both exits)", type: "select", options: [["", v.tracker ? `as before — ${v.tracker.kind} · ${v.tracker.where}` : "files only"], ...v.trackers.map((t) => [t, t])] },
      { name: "repo", label: "GitHub owner/name", value: v.repo ?? "" },
      { name: "site", label: "Jira site" }, { name: "project", label: "Jira project key" }, { name: "ideas", label: "Jira Product Discovery ideas project (optional)" },
      { name: "by", label: "by", required: true },
    ],
    note: `The design is <b>${esc(v.design)}</b>. Delivery and both need it signed. Jira credentials come from <code>JIRA_EMAIL</code> and <code>JIRA_API_TOKEN</code> in the environment and are never written to a record.`,
  });
  return { title: "Export", body: `<h1>Export</h1><h2>Ready?</h2>${readiness}<h2>Tracker</h2>${tracker}<h2>Handoffs</h2>${handoffs}<h2>Export</h2>${exportForm}` };
}

function landsPage(key) {
  const v = VIEWS.find((x) => x.key === key);
  return { title: v.label, body: `<h1>${esc(v.label)}</h1><p class="muted">This view is a projection of the release manifest and lands with it at ${esc(v.lands)}.</p>` };
}

// ── routes ──

/**
 * The route table for one project root. Seams pass through to the doors — a scripted
 * `_query` for evals, the real SDK otherwise — so the console never holds a call of its own.
 */
export function routes({ root, _query, _sleep, _exec, _fetch, _env } = {}) {
  const seams = { ...(_query ? { _query } : {}), ...(_sleep ? { _sleep } : {}) };
  const exportSeams = { ...(_exec ? { _exec } : {}), ...(_fetch ? { _fetch } : {}), ...(_env ? { _env } : {}) };
  const home = () => setupView(root).project ? (workshopView(root).prd ? "/board" : "/workshop") : "/setup";
  const work = (title, back, fn) => ({ title, back, work: fn });

  const trackerOf = (f) => {
    if (!blank(f.tracker)) return undefined;
    if (f.tracker === "github") return { kind: "github", ...(blank(f.repo) ? { repo: f.repo.trim() } : {}) };
    return { kind: f.tracker, site: blank(f.site), project: blank(f.project), ...(blank(f.ideas) ? { ideas: f.ideas.trim() } : {}) };
  };

  return once([
    { method: "GET", path: "/", handler: () => ({ redirect: home() }) },
    { method: "GET", path: "/setup", handler: () => setupPage(setupView(root)) },
    { method: "POST", path: "/setup", handler: ({ form: f }) => {
      const models = Object.fromEntries(Object.entries(f).filter(([k, v]) => k.startsWith("model.") && blank(v)).map(([k, v]) => [k.slice(6), v.trim()]).filter(([k, v]) => v !== setupView(root).roles.find((r) => r.key === k)?.default));
      try {
        setupProject({ slug: f.slug, title: blank(f.title), path: root, existing: Boolean(f.existing), models, budget: blank(f.budget) ? Number(f.budget) : null, ...(_exec ? { _exec } : {}) });
      } catch (e) {
        if (!(e instanceof SetupRefused)) throw e;
        return { ...setupPage(setupView(root), { values: f, error: e }), status: 409 };
      }
      return { redirect: "/setup" };
    } },
    { method: "GET", path: "/workshop", handler: () => workshopPage(workshopView(root)) },
    { method: "GET", path: "/workshop/:key", handler: ({ params }) => workshopPage(workshopView(root, params.key), params.key) },
    { method: "POST", path: "/workshop/open", handler: ({ form: f }) => { openPrd({ root, title: f.title, slug: f.slug, seed: f.seed, owner: blank(f.owner) }); return { redirect: "/workshop" }; } },
    { method: "POST", path: "/workshop/:key/turn", handler: ({ params, form: f }) => work(`Workshop · ${params.key}`, `/workshop/${params.key}`, async (onEvent) => { await turn({ root, key: params.key, text: f.text, onEvent, ...seams }); return `/workshop/${params.key}`; }) },
    { method: "POST", path: "/workshop/:key/extract", handler: ({ params }) => work(`Extract · ${params.key}`, `/workshop/${params.key}`, async (onEvent) => { await extract({ root, key: params.key, onEvent, ...seams }); return `/workshop/${params.key}`; }) },
    { method: "GET", path: "/board", handler: () => boardPage(boardView(root)) },
    { method: "GET", path: "/artifact/:kind", handler: ({ params }) => {
      const a = ARTIFACTS.find((x) => x.kind === params.kind);
      const doc = a && readDoc(root, a.file);
      if (!doc) return { title: "Not found", status: 404, body: `<h1>Not found</h1><p class="muted">no ${esc(params.kind)} on the record</p>` };
      return { title: params.kind, body: `<h1>${esc(params.kind)} <span class="muted">v${esc(doc.meta.version)} · <code>${esc(short(doc.meta.content_hash))}</code></span></h1><pre>${esc(RENDER[params.kind](doc))}</pre>` };
    } },
    { method: "GET", path: "/prototype/index.html", handler: () => ({ file: join(root, HTML_FILE), headers: { "content-security-policy": "sandbox allow-scripts" } }) },
    { method: "POST", path: "/prototype/generate", handler: ({ form: f }) => work("Prototype", "/board", async (onEvent) => { await generate({ root, notes: blank(f.notes), onEvent, ...seams }); return "/board"; }) },
    { method: "POST", path: "/stories/write", handler: ({ form: f }) => work("Stories", "/board", async (onEvent) => { await writeStories({ root, notes: blank(f.notes), onEvent, ...seams }); return "/board"; }) },
    { method: "POST", path: "/stories/review", handler: () => work("Story review", "/board", async (onEvent) => { await reviewStories({ root, onEvent, ...seams }); return "/board"; }) },
    { method: "POST", path: "/design/write", handler: ({ form: f }) => work("Design", "/board", async (onEvent) => { await writeDesign({ root, notes: blank(f.notes), onEvent, ...seams }); return "/board"; }) },
    { method: "POST", path: "/design/review", handler: () => work("Design review", "/board", async (onEvent) => { await reviewDesign({ root, onEvent, ...seams }); return "/board"; }) },
    { method: "POST", path: "/design/signoff", handler: ({ form: f }) => { signoff(root, { by: f.by, note: blank(f.note), ...(blank(f.override_reason) ? { override: { reason: f.override_reason.trim() } } : {}) }); return { redirect: "/board" }; } },
    { method: "POST", path: "/doors/answer", handler: ({ form: f }) => { answer({ root, req: f.req, oq: blank(f.oq), pq: blank(f.pq), question: blank(f.question), answer: f.answer, criterion: blank(f.criterion), by: f.by }); return { redirect: "/board" }; } },
    { method: "POST", path: "/doors/propose", handler: ({ form: f }) => { propose({ root, target: f.target?.trim(), to: f.to === undefined ? undefined : jsonOrText(f.to), rationale: f.rationale, by: f.by }); return { redirect: "/board" }; } },
    { method: "POST", path: "/doors/approve", handler: ({ form: f }) => { approve({ root, id: f.id, by: f.by, radius: [].concat(f.radius ?? []) }); return { redirect: "/board" }; } },
    { method: "POST", path: "/doors/agree", handler: ({ form: f }) => { agree({ root, by: f.by }); return { redirect: "/board" }; } },
    { method: "POST", path: "/doors/reject", handler: ({ form: f }) => { reject({ root, id: f.id, by: f.by, reason: f.reason }); return { redirect: "/board" }; } },
    { method: "GET", path: "/export", handler: () => exportPage(exportView(root)) },
    { method: "POST", path: "/export", handler: async ({ form: f }) => { await exportHandoff({ root, exit: f.exit, by: f.by, tracker: trackerOf(f), ...exportSeams }); return { redirect: "/export" }; } },
    { method: "GET", path: "/release", handler: () => landsPage("release") },
  ]);
}
