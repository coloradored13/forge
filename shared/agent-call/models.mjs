// owns: R1 · shared — the model is chosen per role in one config. Defaults live in
// models.json; a run's setup overrides by the same `half.role` key. A role the config
// does not know is refused rather than defaulted, so a new agent cannot bill against
// a model nobody chose.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export function defaults() {
  return JSON.parse(readFileSync(join(HERE, "models.json"), "utf8")).roles;
}

/** Every `half.role` key the config knows. */
export function roles() {
  return Object.keys(defaults());
}

export function modelFor({ half, role }, overrides = {}) {
  const key = `${half}.${role}`;
  const model = overrides[key] ?? defaults()[key];
  if (!model) throw new Error(`modelFor: no model configured for ${key}; add it to shared/agent-call/models.json or the run's setup`);
  return model;
}
