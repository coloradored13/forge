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
    compiled.set(name, ajv.compile(inlineRefs(load(name))));
  }
  return compiled.get(name);
}

/** `{ ok, errors }` — errors as `instancePath message` strings, addressable. */
export function validate(name, doc) {
  return report(validator(name), doc);
}

/** The same, against a schema document in hand — a partial contract, a seeded case. */
export function validateAgainst(schema, doc) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  return report(ajv.compile(schema), doc);
}

function report(v, doc) {
  const ok = v(doc);
  return { ok, errors: ok ? [] : (v.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`) };
}

/**
 * References replaced by their definitions, so the result stands alone. Local
 * `#/$defs/x`, or a sibling schema's field — `prd.schema.json#/properties/problem` — which
 * is how a document that embeds another (the contract the PRD compiles to, the handoff)
 * carries its fields without retyping one (R10). Keywords beside a `$ref` stay, so an
 * embedding can re-describe a field for its own reader.
 */
export function inlineRefs(schema, defs = schema.$defs ?? {}) {
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    if (typeof node.$ref === "string") {
      const { $ref, ...rest } = node;
      return { ...walk(target($ref, defs)), ...walk(rest) };
    }
    const out = {};
    for (const [k, v] of Object.entries(node)) if (k !== "$defs") out[k] = walk(v);
    return out;
  };
  return walk(schema);
}

function target(ref, defs) {
  const local = ref.match(/^#\/\$defs\/([^/]+)$/);
  if (local) {
    if (!(local[1] in defs)) throw new Error(`inlineRefs: cannot resolve ${ref}`);
    return defs[local[1]];
  }
  const sibling = ref.match(/^([a-z-]+)\.schema\.json(?:#((?:\/[^/]+)*))?$/);
  if (!sibling || !names().includes(sibling[1])) throw new Error(`inlineRefs: cannot resolve ${ref}`);
  let node = inlineRefs(load(sibling[1]));
  for (const step of (sibling[2] ?? "").split("/").slice(1)) {
    node = node?.[step];
    if (node === undefined) throw new Error(`inlineRefs: cannot resolve ${ref}`);
  }
  // The sibling's identity and its own runner marking belong to it, not to the field embedding it.
  return Object.fromEntries(Object.entries(node).filter(([k]) => !["$schema", "$id", "title", "x-runner"].includes(k)));
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
  // `x-runner` means the same thing at any depth: the runner derives it and the model is
  // never asked for it. Filtered only at the top level, a runner-owned field nested in a
  // definition was still offered on the wire — and a field a model is offered is a field
  // some model will eventually fill in.
  return strip(runnerless(out));
}

/** Drop every `x-runner` property, however deep, and any required entry that named one. */
function runnerless(node) {
  if (Array.isArray(node)) return node.map(runnerless);
  if (!node || typeof node !== "object") return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "properties" && v && typeof v === "object") {
      out.properties = Object.fromEntries(Object.entries(v).filter(([, p]) => !p?.["x-runner"]).map(([n, p]) => [n, runnerless(p)]));
    } else out[k] = runnerless(v);
  }
  if (Array.isArray(out.required) && out.properties) out.required = out.required.filter((k) => k in out.properties);
  return out;
}

/**
 * A contract cut to some of its top-level fields — what one workshop section asks the
 * model for. The keys must exist in the contract; asking for a field the schema does
 * not hold is the retyping R10 forbids, caught here rather than on the wire.
 */
export function partialContract(name, keys) {
  return partialOf(outputContract(name), keys);
}

export function partialOf(contract, keys) {
  const missing = keys.filter((k) => !(k in (contract.properties ?? {})));
  if (missing.length) throw new Error(`partialOf: ${missing.join(", ")} not in the contract`);
  return {
    ...contract,
    properties: Object.fromEntries(keys.map((k) => [k, contract.properties[k]])),
    required: (contract.required ?? []).filter((k) => keys.includes(k)),
  };
}

/**
 * An empty instance that validates: every required field present with the emptiest
 * value its type allows, enums at their first value, `const` as declared. This is how a
 * PRD exists before its first section is captured — derived, so the skeleton cannot
 * disagree with the schema it will be validated against.
 */
export function skeleton(name) {
  return skeletonOf(inlineRefs(load(name)));
}

export function skeletonOf(node) {
  if ("const" in node) return structuredClone(node.const);
  if (node.enum) return node.enum[0];
  if (node.oneOf) return skeletonOf(node.oneOf[0]);
  const type = Array.isArray(node.type) ? node.type[0] : node.type;
  switch (type) {
    case "object": return Object.fromEntries((node.required ?? []).map((k) => [k, skeletonOf(node.properties?.[k] ?? {})]));
    case "array": return [];
    case "string": return "";
    case "integer": case "number": return 0;
    case "boolean": return false;
    case "null": return null;
    default: return null;
  }
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
 * The model-facing fields as a flat list — `{ path, required, description, enum, maxLength }`
 * — read by the mechanics generator so a prompt names exactly the fields the contract
 * holds, ceilings included: a bound the contract validates but the prompt withholds is
 * learned by rejection. Walks into array items and nested objects; the path is JSON-pointer-like.
 */
export function fields(name) {
  return fieldsOf(outputContract(name));
}

export function fieldsOf(contract) {
  const out = [];
  const walk = (node, path) => {
    for (const [k, p] of Object.entries(node.properties ?? {})) {
      const here = `${path}/${k}`;
      out.push({ path: here, required: (node.required ?? []).includes(k), description: p.description ?? null, enum: p.enum ?? null, maxLength: p.maxLength ?? null });
      const inner = p.type === "array" ? p.items : p;
      if (inner?.properties) walk(inner, p.type === "array" ? `${here}[]` : here);
    }
  };
  walk(contract, "");
  return out;
}
