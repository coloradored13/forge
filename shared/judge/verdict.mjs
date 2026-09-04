// owns: R7 · shared — the verdict rule and the ranking rule, pure. Every gate derives
// its verdict here, never from the model; every judge is cut to k findings here, never
// asked nicely. The severity and confidence vocabularies are read from the finding
// schema — its enums are ordered heaviest first — so the words have one home.

import schema from "../schema/finding.schema.json" with { type: "json" };

const ladder = (list) => Object.fromEntries(list.map((w, i) => [w, list.length - i]));

export const SEVERITY = ladder(schema.$defs.finding.properties.severity.enum);
export const CONFIDENCE = ladder(schema.$defs.finding.properties.confidence.enum);
export const K_DEFAULT = 5;

const [BLOCKING_SEVERITY] = Object.keys(SEVERITY);
const [BLOCKING_CONFIDENCE] = Object.keys(CONFIDENCE);

/**
 * Only certain + high blocks. likely + high advises and needs a human to convert it —
 * this is what keeps one hallucinated judge finding from wedging a run. A finding with
 * no confidence reads as certain: the field is required of judges, so its absence is a
 * malformed finding and should fail loudly rather than quietly downgrade itself.
 */
export function deriveVerdict(findings = []) {
  if (findings.some((f) => f.severity === BLOCKING_SEVERITY && (f.confidence ?? BLOCKING_CONFIDENCE) === BLOCKING_CONFIDENCE)) return "block";
  if (findings.length) return "advise";
  return "pass";
}

/** severity × confidence, as one number so ordering has one definition. */
export function weight(f) {
  return (SEVERITY[f.severity] ?? 0) * 10 + (CONFIDENCE[f.confidence ?? BLOCKING_CONFIDENCE] ?? 0);
}

/**
 * Keep the k weightiest findings, stable for ties. What falls off is returned, not
 * lost: the run record counts it, and a judge that keeps over-enumerating is a funnel
 * signal (R8). Ranking by weight means a blocking finding is never dropped in favour
 * of a lighter one, so the verdict over `kept` is the verdict over all.
 */
export function rank(findings = [], k = K_DEFAULT) {
  const ordered = findings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => weight(b.f) - weight(a.f) || a.i - b.i)
    .map((x) => x.f);
  return { kept: ordered.slice(0, k), dropped: ordered.slice(k) };
}
