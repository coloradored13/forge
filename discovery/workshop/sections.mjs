// owns: R12 · discovery — the workshop's sections, in order. Shape comes before scope:
// the whole product's lifecycles, vocabulary, attribution and clocks are elicited before
// the requirements are written and the MVP line is drawn through them. Each section
// names the PRD fields a later extraction fills — the fields themselves live in
// shared/schema/prd.schema.json and are never restated here.

export const SECTIONS = [
  { key: "problem",      label: "Problem & Value",              fields: ["problem"],                        kill: true },
  { key: "shape",        label: "Shape",                        fields: ["shape"] },
  { key: "solution",     label: "Solution & Scope",             fields: ["solution", "surfaces"] },
  { key: "requirements", label: "Requirements & the MVP line",  fields: ["requirements", "surfaces", "mvp"] },
  { key: "metrics",      label: "Objective & Key Results",      fields: ["okr"] },
  { key: "readiness",    label: "Engineering Readiness",        fields: ["open_questions", "constraints"] },
];

/** The section that draws the line. Everything after it runs with scope as a gate input. */
export const LINE_SECTION = "requirements";

export function section(key) {
  const s = SECTIONS.find((x) => x.key === key);
  if (!s) throw new Error(`workshop: no section ${key} — one of ${SECTIONS.map((x) => x.key).join(", ")}`);
  return s;
}

export function indexOf(key) {
  return SECTIONS.findIndex((x) => x.key === key);
}
