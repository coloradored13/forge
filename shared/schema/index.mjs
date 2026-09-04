// owns: R10 · shared — the single home for every artifact shape. A field is declared once
// here and derived everywhere else: the model's output contract (`x-runner` fields cut,
// refs inlined), the mechanics half of a prompt (descriptions read from here), and the
// validator a runner applies afterwards. Nothing downstream retypes a field.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv/dist/2020.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Every schema in this directory, by name (`finding`, `prd`, …). */
export function names() {
  return readdirSync(HERE).filter((f) => f.endsWith(".schema.json")).map((f) => f.replace(/\.schema\.json$/, "")).sort();
}

export function load(name) {
  return JSON.parse(readFileSync(join(HERE, `${name}.schema.json`), "utf8"));
}

const compiled = new Map();
function validator(name) {
  if (!compiled.has(name)) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    compiled.set(name, ajv.compile(load(name)));
  }
  return compiled.get(name);
}

/** `{ ok, errors }` — errors as `instancePath message` strings, addressable. */
export function validate(name, doc) {
  const v = validator(name);
  const ok = v(doc);
  return { ok, errors: ok ? [] : (v.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`) };
}

/** Local `#/$defs/x` references replaced by their definitions, so the result stands alone. */
export function inlineRefs(schema, defs = schema.$defs ?? {}) {
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    if (typeof node.$ref === "string") {
      const m = node.$ref.match(/^#\/\$defs\/([^/]+)$/);
      if (!m || !(m[1] in defs)) throw new Error(`inlineRefs: cannot resolve ${node.$ref}`);
      return walk(defs[m[1]]);
    }
    const out = {};
    for (const [k, v] of Object.entries(node)) if (k !== "$defs") out[k] = walk(v);
    return out;
  };
  return walk(schema);
}

/**
 * The part of a schema the model is asked to produce: every property not marked
 * `x-runner`, required list trimmed to match, refs inlined, ids and titles dropped.
 * This is what goes on the wire as the structured-output schema.
 */
export function outputContract(name) {
  return contractOf(load(name));
}

/** The derivation itself, over a schema document, so an eval can seed one. */
export function contractOf(full) {
  const model = { ...full };
  delete model.$schema; delete model.$id; delete model.title; delete model.description;
  model.properties = Object.fromEntries(Object.entries(full.properties ?? {}).filter(([, p]) => !p["x-runner"]));
  model.required = (full.required ?? []).filter((k) => k in model.properties);
  const out = inlineRefs(model, full.$defs);
  return strip(out);
}

/** Vendor extensions (`x-*`) are for this repo, not the model. */
function strip(node) {
  if (Array.isArray(node)) return node.map(strip);
  if (!node || typeof node !== "object") return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) if (!k.startsWith("x-")) out[k] = strip(v);
  return out;
}

/**
 * The model-facing fields as a flat list — `{ path, required, description, enum }` —
 * read by the mechanics generator so a prompt names exactly the fields the contract
 * holds. Walks into array items and nested objects; the path is JSON-pointer-like.
 */
export function fields(name) {
  return fieldsOf(outputContract(name));
}

export function fieldsOf(contract) {
  const out = [];
  const walk = (node, path) => {
    for (const [k, p] of Object.entries(node.properties ?? {})) {
      const here = `${path}/${k}`;
      out.push({ path: here, required: (node.required ?? []).includes(k), description: p.description ?? null, enum: p.enum ?? null });
      const inner = p.type === "array" ? p.items : p;
      if (inner?.properties) walk(inner, p.type === "array" ? `${here}[]` : here);
    }
  };
  walk(contract, "");
  return out;
}
