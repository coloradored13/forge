// owns: R2 · discovery — the prototype: the PRD made tangible so the PM can find what is
// wrong with it. One builder call through the chokepoint returns the page and the record of
// its screens, and writes nothing (D13); the runner checks the page, publishes and hashes it,
// keeps screen ids sticky, and holds the record to the line's arithmetic — every shipped
// surface inside the line has a screen, every functional requirement inside the line is on
// a screen or listed as uncovered, nothing past the line is shown. No AI reviews the
// prototype: the PM is the loop here.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { skeleton, outputContract, validate, validateAgainst } from "../../shared/schema/index.mjs";
import { stamp } from "../../shared/hash.mjs";
import { identity, mechanics, assemble } from "../../shared/prompt/index.mjs";
import { call } from "../../shared/agent-call/index.mjs";
import { deriveVerdict, pin } from "../../shared/judge/index.mjs";
import { scopeOf } from "../../shared/scope.mjs";
import { loadProject, ledgerPath } from "../setup/index.mjs";
import { loadPrd, existingIds, PRD_FILE } from "../workshop/index.mjs";
import { Refused, readDoc, saveDoc, saveVerdict, keepOutgoing, traceOf, rulingsOf, renderPrd, PROTOTYPE_FILE, HTML_FILE } from "../record/index.mjs";

const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), "prompts");
export const GATE = "prototype-arithmetic";
export const ARITHMETIC = ["surface-without-screen", "screen-surface-unknown", "screen-past-line", "ref-unknown", "req-unaccounted", "uncovered-yet-covered"];
const WRITES = new Set(["Write", "Edit", "Bash", "NotebookEdit"]);
const MAX_HTML = 1_048_576; // UTF-8 bytes
const NETWORK = /^(?:https?:|wss?:|ftp:|\/\/)/i;

export function loadPrototype(root) { return readDoc(root, PROTOTYPE_FILE); }

export function fileHash(root) {
  return createHash("sha256").update(readFileSync(join(root, HTML_FILE))).digest("hex");
}

/**
 * Build or rebuild the prototype. Refused before the line is drawn — there is nothing
 * to hold the prototype to. The builder returns the page and its record and writes nothing;
 * the record is validated, its screen ids must survive from the previous build, and the
 * page is checked before anything published moves. Then the page is written whole and the
 * record saved, and the arithmetic is filed as a gate verdict beside it. A refused or failed
 * build leaves the published pair as it was. The previous record and its HTML are kept in
 * the history as a pair before the call — the HTML only while it is still the one the record
 * describes, so a hand-edited page never replaces an archived pair.
 */
export async function generate({ root, notes, onEvent, _query, _sleep }) {
  const project = loadProject(root);
  const prd = loadPrd(root);
  const scope = scopeOf(prd);
  if (!scope) throw new Refused("no-line", "prototype: the MVP line is not drawn — the prototype shows what is inside it, so there must be an inside");
  const prior = loadPrototype(root);
  const priorIds = prior ? existingIds(prior, ["screens"]) : [];

  const system = assemble({
    identity: identity(join(PROMPTS, "builder.md")),
    mechanics: mechanics({ kind: "writer", schema: "prototype-build", scope, rulings: rulingsOf(prd), arithmetic: ARITHMETIC }),
  });
  const prompt = [
    renderPrd(prd),
    priorIds.length ? `## Existing screens — keep these ids for the same screens; mint new ones only for new screens\n\n${priorIds.map((p) => `- ${p.id}: ${p.label}`).join("\n")}` : "",
    notes?.trim() ? `## The PM's notes on the last build\n\n${notes.trim()}` : "",
    "## What to return\n\nReturn the whole page as `html`, with the record of its screens, in your structured answer. Write no file: the runner publishes the page.",
  ].filter(Boolean).join("\n\n");

  keepOutgoing(root, "prototype", PROTOTYPE_FILE, prior && existsSync(join(root, HTML_FILE)) && fileHash(root) === prior.file_hash ? HTML_FILE : undefined);
  const res = await call({
    half: "discovery", stage: "prototype", role: "writer", kind: "compose",
    system, prompt, cwd: root, outputSchema: outputContract("prototype-build"),
    ledger: ledgerPath(root), budget: project.budget, models: project.models,
    onEvent, _query, _sleep,
  });

  const wrote = res.toolUses.filter((t) => WRITES.has(t.name));
  if (wrote.length) throw new Refused("wrote", `prototype: the builder used ${wrote.map((t) => t.name).join(", ")} — it returns the page, the runner publishes it`, wrote);
  if (res.structured === undefined) throw new Refused("no-structured-output", "prototype: the builder returned no record of its screens");
  const v = validateAgainst(outputContract("prototype-build"), res.structured);
  if (!v.ok) throw new Refused("prototype-invalid", `prototype: the build does not fit the contract — ${v.errors.slice(0, 5).join("; ")}`, v.errors);
  const { html, ...record } = res.structured;
  checkHtml(html);

  const doc = { ...skeleton("prototype"), id: `proto-${prd.meta.slug}`, traces: traceOf(prd), file: HTML_FILE, file_hash: createHash("sha256").update(html).digest("hex"), ...record };
  Object.assign(doc, questionsOf(doc.open_questions, prior, prd.rulings ?? []));
  const kept = new Set(doc.screens.map((s) => s.id));
  const dropped = priorIds.filter((p) => !kept.has(p.id));
  if (dropped.length) throw new Refused("ids-dropped", `prototype: the rebuild dropped ${dropped.map((p) => p.id).join(", ")} — screen ids are sticky; a screen that went away keeps its id with no requirements`, dropped);

  const valid = validate("prototype", stamp(structuredClone(doc))); // checked before the page moves
  if (!valid.ok) throw new Refused("prototype-invalid", `prototype: the record does not fit its schema — ${valid.errors.slice(0, 5).join("; ")}`, valid.errors);
  const target = join(root, HTML_FILE);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(`${target}.tmp`, html);
  renameSync(`${target}.tmp`, target);
  saveDoc(root, PROTOTYPE_FILE, "prototype", doc);
  const arithmetic = { ...checkPrototype(prd, doc), judged: [pin({ id: prd.id, path: PRD_FILE, doc: prd }), pin({ id: doc.id, path: PROTOTYPE_FILE, doc })] };
  saveVerdict(root, arithmetic);
  return { prototype: doc, arithmetic, model: res.model, usd: res.usd };
}

/**
 * The page the builder returned, checked before it is published: present, within the size
 * cap, and with no network reference in a tag's attribute, a <style> block or a style
 * attribute. Text, comments and data-* attributes that merely mention an address are not
 * references.
 */
export function checkHtml(html) {
  if (!html.trim()) throw new Refused("no-html", "prototype: the builder returned an empty page");
  const size = Buffer.byteLength(html, "utf8");
  if (size > MAX_HTML) throw new Refused("html-too-large", `prototype: the page is ${size} bytes; the cap is ${MAX_HTML}`);
  const page = html.replace(/<!--[\s\S]*?-->/g, "");
  const refs = [], css = [...page.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  for (const [tag] of page.matchAll(/<[a-z][^\s>\/]*(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    for (const m of tag.matchAll(/\s(src|href|action|formaction|poster|srcset|style)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      const name = m[1].toLowerCase(), value = m[2] ?? m[3] ?? m[4];
      if (name === "style") css.push(value);
      else refs.push(...(name === "srcset" ? value.split(",").map((c) => c.trim().split(/\s+/)[0]) : [value]));
    }
  }
  for (const sheet of css) {
    for (const m of sheet.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) refs.push(m[1] ?? m[2] ?? m[3]);
    for (const m of sheet.matchAll(/@import\s+(?:"([^"]*)"|'([^']*)')/gi)) refs.push(m[1] ?? m[2]);
  }
  const external = refs.map((r) => r.trim()).filter((r) => NETWORK.test(r));
  if (external.length) throw new Refused("html-external", `prototype: the page reaches the network — ${external.slice(0, 5).join(", ")}; a prototype runs from disk`, external);
}

/**
 * The runner's half of each question the builder asks. A question a ruling settled is
 * answered, whatever the builder thinks (R3); otherwise the same question keeps its id
 * and status from the last build. A blocker is the PM's to settle: a rebuild that asks it
 * as non-blocking, or no longer asks it, leaves it blocking until it is answered. A new
 * question takes the number after the highest ever issued, so no id names two questions.
 */
export function questionsOf(asked, prior, rulings) {
  const key = (q) => String(q ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const num = (id) => Number(String(id ?? "").split("-")[1]) || 0;
  const before = prior?.open_questions ?? [];
  let n = Math.max(prior?.questions_issued ?? 0, ...before.map((q) => num(q.id)), ...rulings.map((r) => num(r.pq)));
  const settled = (q) => rulings.find((r) => (q.id && r.pq === q.id) || key(r.question) === key(q.question));
  const once = asked.filter((q, i) => asked.findIndex((x) => key(x.question) === key(q.question)) === i);
  const now = once.map(({ question, blocking }) => {
    const was = before.find((p) => key(p.question) === key(question));
    const ruled = settled({ id: was?.id, question });
    const id = was?.id ?? ruled?.pq ?? `PQ-${++n}`;
    return ruled ? { id, question, blocking, status: "answered", ruling: ruled.id } : { id, question, blocking: blocking || Boolean(was?.blocking), status: "open" };
  });
  const kept = before.filter((p) => p.blocking && !settled(p) && !now.some((q) => q.id === p.id));
  return { open_questions: [...now, ...kept], questions_issued: n };
}

/**
 * The line's arithmetic over the prototype (R2), finding-shaped like every gate. All
 * certain + high: each is the record contradicting the PRD or itself.
 */
export function checkPrototype(prd, proto) {
  const findings = [];
  const f = (rule, subject, summary, evidence, remedy) => findings.push({ severity: "high", confidence: "certain", rule, subject, summary, evidence, remedy });
  const reqs = new Map((prd.requirements ?? []).map((r) => [r.id, r]));
  const reqIds = new Set(reqs.keys());
  const inside = new Set(prd.mvp?.inside ?? []);
  // Only a functional requirement is a screen's to show; non-functional and constraint are
  // verified by measurement or inspection (prd.schema) and are not forced onto a screen.
  const functional = [...inside].filter((r) => reqs.get(r)?.type === "functional");
  const past = new Set((prd.mvp?.past ?? []).map((p) => p.ref));
  const surfaces = new Map((prd.surfaces?.shipped ?? []).map((s) => [s.id, s]));
  const screens = proto.screens ?? [];
  const uncovered = new Set(proto.uncovered ?? []);
  const onScreen = new Set(screens.flatMap((s) => s.req_refs));

  for (const s of screens) {
    if (!surfaces.has(s.surface_ref)) f("screen-surface-unknown", s.id, `${s.id} claims surface ${s.surface_ref}, which the PRD does not ship.`, `\`/screens\` ${s.id} surface_ref \`${s.surface_ref}\`; \`/surfaces/shipped\` has no such id.`, "Point the screen at a shipped surface.");
    else if (past.has(s.surface_ref)) f("screen-past-line", s.id, `${s.id} is on ${s.surface_ref}, which sits past the line.`, `\`/mvp/past\` names ${s.surface_ref}.`, "Drop the screen, or move the surface inside the line on the record.");
    for (const r of s.req_refs) {
      if (!reqIds.has(r)) f("ref-unknown", s.id, `${s.id} references ${r}, which is not a requirement.`, `\`/screens\` ${s.id} req_refs names ${r}; \`/requirements\` has no such id.`, "Reference a requirement the PRD holds.");
      else if (!inside.has(r)) f("screen-past-line", s.id, `${s.id} shows ${r}, which is not inside the line.`, `\`/mvp/inside\` does not name ${r}.`, "Show only what is inside the line; a deferred requirement is not demonstrated.");
    }
  }
  for (const [id, s] of surfaces) {
    if (past.has(id)) continue;
    if (!screens.some((sc) => sc.surface_ref === id)) f("surface-without-screen", id, `${id} ships inside the line but the prototype has no screen on it.`, `\`/surfaces/shipped\` ${id}: ${s.statement}; no \`/screens\` entry has surface_ref ${id}.`, "Build at least one screen a person would use on this surface.");
  }
  for (const r of uncovered) {
    if (!reqIds.has(r)) f("ref-unknown", r, `${r} is listed as uncovered but is not a requirement.`, `\`/uncovered\` names ${r}; \`/requirements\` has no such id.`, "List only requirements the PRD holds.");
    else if (onScreen.has(r)) f("uncovered-yet-covered", r, `${r} is listed as uncovered and is also on a screen.`, `\`/uncovered\` names ${r}; ${screens.filter((s) => s.req_refs.includes(r)).map((s) => s.id).join(", ")} show it.`, "It is one or the other.");
  }
  for (const r of functional) {
    if (!onScreen.has(r) && !uncovered.has(r)) f("req-unaccounted", r, `${r} is inside the line but is on no screen and not listed as uncovered.`, `\`/mvp/inside\` names ${r}; no \`/screens\` entry references it; \`/uncovered\` omits it.`, "Show it, or say you did not.");
  }
  const checked = screens.length + [...surfaces.keys()].filter((id) => !past.has(id)).length + functional.length;
  return { gate: GATE, verdict: deriveVerdict(findings), findings, deferred: [], checked, skipped: 0 };
}
