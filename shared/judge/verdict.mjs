// owns: R7 · shared — the verdict rule and the ranking rule, pure. Every gate derives
// its verdict here, never from the model; every judge's findings are ordered here, never
// by the model's say-so. There is no cap: a cap does not spare the PM, it withholds
// findings and surfaces them a few per round, a regeneration each (Bakehouse, 2026-09-05).
// The severity and confidence vocabularies are read from the finding schema — its enums
// are ordered heaviest first — so the words have one home.

import schema from "../schema/finding.schema.json" with { type: "json" };

const ladder = (list) => Object.fromEntries(list.map((w, i) => [w, list.length - i]));

export const SEVERITY = ladder(schema.$defs.finding.properties.severity.enum);
export const CONFIDENCE = ladder(schema.$defs.finding.properties.confidence.enum);

/** The schema's ceiling on a summary. A mechanical finding that quotes text fits it with `fit`, the whole text riding in `evidence`. */
export const SUMMARY_MAX = schema.$defs.finding.properties.summary.maxLength;
export const fit = (s) => (s.length > SUMMARY_MAX ? `${s.slice(0, SUMMARY_MAX - 1)}…` : s);

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
 * Order the findings heaviest first, stable for ties. Everything is kept: the PM
 * disposes of each — act, refute, or carry it as residual — and a finding withheld now
 * is a regeneration later. Rank is how the PM reads, not what the PM is allowed to see.
 */
export function rank(findings = []) {
  return findings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => weight(b.f) - weight(a.f) || a.i - b.i)
    .map((x) => x.f);
}
