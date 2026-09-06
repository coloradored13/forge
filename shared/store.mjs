// owns: R10 · shared — one way to write a record, either half. A document is stamped,
// validated against its schema and written whole (tmp + rename) or not at all: an invalid
// document is never on disk, and a reader never sees half of one. A verdict is written the
// same way, validated as a finding document. Readers return null for an absent file — the
// caller decides whether absence is a refusal.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { validate } from "./schema/index.mjs";
import { stamp } from "./hash.mjs";
import { Refused } from "./refused.mjs";

export function readDoc(root, file) {
  const p = join(root, file);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

/** Stamp, validate, write whole. The refusal names the schema and the first fields that do not fit. */
export function saveDoc(root, file, schema, doc) {
  stamp(doc);
  const v = validate(schema, doc);
  if (!v.ok) throw new Refused(`${schema}-invalid`, `${file}: the document does not fit its schema — ${v.errors.slice(0, 5).join("; ")}`, v.errors);
  writeWhole(join(root, file), doc);
  return doc;
}

/** A gate's verdict, filed at `file`. A verdict that does not fit the finding shape is not a verdict. */
export function saveVerdict(root, file, verdict) {
  const v = validate("finding", verdict);
  if (!v.ok) throw new Refused("verdict-invalid", `${verdict?.gate}: the verdict does not validate — ${v.errors.slice(0, 5).join("; ")}`, v.errors);
  writeWhole(join(root, file), verdict);
  return file;
}

function writeWhole(path, doc) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(doc, null, 2) + "\n");
  renameSync(`${path}.tmp`, path);
}
