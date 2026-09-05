// owns: R2 · shared — the MVP line as a gate input. One reader of `prd.mvp` for every
// reviewer, judge and compiler in both halves: what the line says, what sits past it,
// and the arithmetic that keeps the line honest — every committed requirement is on
// one side of it, and nothing it names is missing from the document.

import { deriveVerdict } from "./judge/verdict.mjs";

/** Whether the PM has drawn the line yet. Before that, scope is not a gate input. */
export function lineDrawn(prd) {
  return Boolean(prd?.mvp?.line?.trim());
}

/** The `scope` a mechanics half takes (shared/prompt), or null before the line exists. */
export function scopeOf(prd) {
  if (!lineDrawn(prd)) return null;
  return {
    mvp: prd.mvp.line.trim(),
    deferred: (prd.mvp.past ?? []).map((p) => `${p.ref} — ${p.why}`),
  };
}

/**
 * Finding-shaped, so the line is checked through the same channel as every other
 * gate. Certain + high: the document contradicts its own line.
 */
export function checkScope(prd) {
  const findings = [];
  const reqs = new Map((prd.requirements ?? []).map((r) => [r.id, r]));
  const ids = new Set([
    ...reqs.keys(),
    ...(prd.surfaces?.shipped ?? []).map((s) => s.id),
    ...(prd.shape?.lifecycles ?? []).map((l) => l.id),
  ]);
  const inside = new Set(prd.mvp?.inside ?? []);
  const past = new Map((prd.mvp?.past ?? []).map((p) => [p.ref, p]));
  const f = (rule, subject, summary, evidence, remedy) => findings.push({ severity: "high", confidence: "certain", rule, subject, summary, evidence, remedy });

  if (!lineDrawn(prd)) {
    f("mvp-line-missing", "/mvp/line", "The MVP line has not been drawn.", "`/mvp/line` is empty.", "Draw the line in the requirements section: one sentence, what ships and what does not.");
  }
  for (const id of inside) {
    if (!reqs.has(id)) f("mvp-inside-unknown", id, `${id} is inside the line but is not a requirement.`, `\`/mvp/inside\` names ${id}; \`/requirements\` has no such id.`, "Remove it from the line or add the requirement.");
    if (past.has(id)) f("mvp-both-sides", id, `${id} is both inside and past the line.`, `\`/mvp/inside\` and \`/mvp/past\` both name ${id}.`, "Put it on one side.");
  }
  for (const [ref] of past) {
    if (!ids.has(ref)) f("mvp-past-unknown", ref, `${ref} sits past the line but nothing in the document has that id.`, `\`/mvp/past\` names ${ref}; no requirement, surface or lifecycle carries it.`, "Point the deferral at something the document holds, or drop it.");
  }
  for (const r of reqs.values()) {
    if (r.status === "committed" && !inside.has(r.id) && !past.has(r.id)) {
      f("mvp-unplaced", r.id, `${r.id} is committed but on neither side of the line.`, `\`/requirements\` ${r.id} status \`committed\`; absent from \`/mvp/inside\` and \`/mvp/past\`.`, "Place it inside the line or past it with a reason.");
    }
    if (inside.has(r.id) && r.status !== "committed") {
      f("mvp-inside-not-committed", r.id, `${r.id} is inside the line with status ${r.status}.`, `\`/mvp/inside\` names ${r.id}; its status is \`${r.status}\`.`, "Inside the line means committed. Change one.");
    }
  }
  const checked = reqs.size + past.size + 1;
  return { gate: "mvp-line", verdict: deriveVerdict(findings), findings, deferred: [], checked, skipped: 0 };
}
