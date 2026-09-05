// owns: R2 · discovery — the prototype: the PRD made tangible so the PM can find what is
// wrong with it. One builder call through the chokepoint writes one HTML file and returns
// the record of its screens; the runner refuses a write anywhere else, hashes the file,
// keeps screen ids sticky, and holds the record to the line's arithmetic — every shipped
// surface inside the line has a screen, every functional requirement inside the line is on
// a screen or listed as uncovered, nothing past the line is shown. No AI reviews the
// prototype: the PM is the loop here.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { skeleton, outputContract, validateAgainst } from "../../shared/schema/index.mjs";
import { identity, mechanics, assemble } from "../../shared/prompt/index.mjs";
import { call } from "../../shared/agent-call/index.mjs";
import { deriveVerdict, pin } from "../../shared/judge/index.mjs";
import { scopeOf } from "../../shared/scope.mjs";
import { loadProject, ledgerPath } from "../setup/index.mjs";
import { loadPrd, existingIds, PRD_FILE } from "../workshop/index.mjs";
import { Refused, readDoc, saveDoc, saveVerdict, traceOf, rulingsOf, renderPrd, PROTOTYPE_FILE, HTML_FILE } from "../record/index.mjs";

const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), "prompts");
export const GATE = "prototype-arithmetic";
export const ARITHMETIC = ["surface-without-screen", "screen-surface-unknown", "screen-past-line", "ref-unknown", "req-unaccounted", "uncovered-yet-covered"];
const EDITS = new Set(["Write", "Edit"]);

export function loadPrototype(root) { return readDoc(root, PROTOTYPE_FILE); }

export function fileHash(root) {
  return createHash("sha256").update(readFileSync(join(root, HTML_FILE))).digest("hex");
}

/**
 * Build or rebuild the prototype. Refused before the line is drawn — there is nothing
 * to hold the prototype to. The builder writes exactly one file; the record it returns
 * is validated, its screen ids must survive from the previous build, and the arithmetic
 * is checked and filed as a gate verdict beside it.
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
    mechanics: mechanics({ kind: "writer", schema: "prototype", scope, rulings: rulingsOf(prd), arithmetic: ARITHMETIC }),
  });
  const prompt = [
    renderPrd(prd),
    priorIds.length ? `## Existing screens — keep these ids for the same screens; mint new ones only for new screens\n\n${priorIds.map((p) => `- ${p.id}: ${p.label}`).join("\n")}` : "",
    notes?.trim() ? `## The PM's notes on the last build\n\n${notes.trim()}` : "",
    `## Where to write\n\nWrite one file, \`${HTML_FILE}\`, relative to the project root. Nothing else — the record of screens comes back as your structured answer, not as a file.`,
  ].filter(Boolean).join("\n\n");

  const res = await call({
    half: "discovery", stage: "prototype", role: "writer", kind: "writer",
    system, prompt, cwd: root, outputSchema: outputContract("prototype"),
    ledger: ledgerPath(root), budget: project.budget, models: project.models,
    onEvent, _query, _sleep,
  });

  const target = resolve(root, HTML_FILE);
  const elsewhere = res.toolUses.filter((t) => EDITS.has(t.name) && resolve(root, String(t.input?.file_path ?? "")) !== target);
  if (elsewhere.length) throw new Refused("wrote-elsewhere", `prototype: the builder wrote ${elsewhere.map((t) => t.input?.file_path).join(", ")} — the only file is ${HTML_FILE}`, elsewhere);
  if (!existsSync(target)) throw new Refused("no-html", `prototype: ${HTML_FILE} was not written`);
  if (res.structured === undefined) throw new Refused("no-structured-output", "prototype: the builder returned no record of its screens");
  const v = validateAgainst(outputContract("prototype"), res.structured);
  if (!v.ok) throw new Refused("prototype-invalid", `prototype: the record does not fit the contract — ${v.errors.slice(0, 5).join("; ")}`, v.errors);

  const doc = { ...skeleton("prototype"), id: `proto-${prd.meta.slug}`, traces: traceOf(prd), file: HTML_FILE, file_hash: fileHash(root), ...res.structured };
  const kept = new Set(doc.screens.map((s) => s.id));
  const dropped = priorIds.filter((p) => !kept.has(p.id));
  if (dropped.length) throw new Refused("ids-dropped", `prototype: the rebuild dropped ${dropped.map((p) => p.id).join(", ")} — screen ids are sticky; a screen that went away keeps its id with no requirements`, dropped);

  saveDoc(root, PROTOTYPE_FILE, "prototype", doc);
  const arithmetic = { ...checkPrototype(prd, doc), judged: [pin({ id: prd.id, path: PRD_FILE, doc: prd }), pin({ id: doc.id, path: PROTOTYPE_FILE, doc })] };
  saveVerdict(root, arithmetic);
  return { prototype: doc, arithmetic, model: res.model, usd: res.usd };
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
