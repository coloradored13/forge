// owns: R14 · shared — one canonical form for every artifact, a content hash over each
// artifact's own `x-drift-checked` subset, per-item hashes for the handoff, and a
// verifier that names exactly which hash no longer matches. Ported from v1
// tools/hash.mjs; the algorithm id and the bytes it hashes are unchanged.

import { createHash } from "node:crypto";
import { deriveVerdict } from "./judge/verdict.mjs";

export const ALGORITHM = "sha256/canonical-json/v1";

/** Keys sorted recursively; arrays keep their order — order is content. */
export function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]));
  }
  return v;
}

/** Every non-ASCII code unit as \uXXXX, so Python's json.dumps(ensure_ascii) agrees. */
export function toAscii(s) {
  return s.replace(/[\u0080-\uFFFF]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

export function canonicalize(v) {
  return toAscii(JSON.stringify(sortDeep(v)));
}

export function sha256(v) {
  return createHash("sha256").update(canonicalize(v)).digest("hex");
}

/** JSON pointer (RFC 6901) lookup; undefined when any step is absent. */
export function resolve(doc, pointer) {
  if (pointer === "" || pointer === "/") return doc;
  let cur = doc;
  for (const raw of pointer.split("/").slice(1)) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (cur === null || typeof cur !== "object" || !(key in cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

/**
 * The hash of what the artifact says it covers. The pointer list rides in the file, so
 * a verifier needs no knowledge of the artifact's type — and provenance (`traces`,
 * `meta`, workflow state) is left out on purpose: regenerating an artifact whose text
 * is unchanged must not stale its children. No pointers, or none that resolve, is a
 * refusal: hashing nothing would mint a hash that means nothing.
 */
export function contentHash(doc) {
  const pointers = doc?.["x-drift-checked"];
  if (!Array.isArray(pointers) || pointers.length === 0) {
    throw new Error("contentHash: the artifact carries no x-drift-checked pointers");
  }
  const picked = {};
  for (const p of pointers) {
    const v = resolve(doc, p);
    if (v !== undefined) picked[p] = v;
  }
  if (Object.keys(picked).length === 0) {
    throw new Error(`contentHash: none of ${pointers.join(", ")} resolve on the artifact`);
  }
  return sha256(picked);
}

/** The hash of one item over the fields that are its substance, whichever are present. */
export function itemHash(item, fields) {
  const picked = {};
  for (const f of fields) if (item?.[f] !== undefined) picked[f] = item[f];
  if (Object.keys(picked).length === 0) throw new Error(`itemHash: none of ${fields.join(", ")} present`);
  return sha256(picked);
}

/** Write `meta.content_hash` and the algorithm. Returns the same object. */
export function stamp(doc) {
  doc.meta ??= {};
  doc.meta.hash_algorithm = ALGORITHM;
  doc.meta.content_hash = contentHash(doc);
  return doc;
}

/** Write `<key>` on every item over `fields`. Returns the same array. */
export function stampItems(items, { fields, key = "hash" }) {
  for (const it of items) it[key] = itemHash(it, fields);
  return items;
}

/**
 * Recompute and compare. The result is finding-shaped so hash integrity reports through
 * the same channel as every other gate; each finding names the stored and computed
 * value, which is the whole of the evidence.
 */
export function verify(doc, { items = [] } = {}) {
  const findings = [];
  let checked = 0;

  for (const { pointer, fields, key = "hash" } of items) {
    const list = resolve(doc, pointer);
    if (!Array.isArray(list)) continue;
    for (const [i, it] of list.entries()) {
      checked++;
      const subject = it?.id ?? `${pointer}/${i}`;
      const computed = itemHash(it, fields);
      if (it[key] !== computed) {
        findings.push({
          severity: "high", confidence: "certain", rule: "item-hash-stale", subject,
          summary: `${subject}: ${key} does not match its content.`,
          evidence: `stored ${it[key] ?? "(absent)"} · computed ${computed}`,
          remedy: "Re-stamp through the door that changed it; never by hand.",
        });
      }
    }
  }

  checked++;
  const computed = contentHash(doc);
  const stored = doc?.meta?.content_hash;
  if (stored !== computed) {
    findings.push({
      severity: "high", confidence: "certain", rule: "content-hash-mismatch", subject: doc?.id ?? "(artifact)",
      summary: "meta.content_hash does not match the x-drift-checked content.",
      evidence: `stored ${stored ?? "(absent)"} · computed ${computed}`,
      remedy: "Re-stamp through the door that changed it; never by hand.",
    });
  }

  return { gate: "hash-integrity", verdict: deriveVerdict(findings), findings, deferred: [], checked, skipped: 0 };
}
