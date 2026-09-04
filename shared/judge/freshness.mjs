// owns: R5 · shared — a verdict is about the hashes it pinned, and nothing else. Fresh
// means every pin still matches the artifact on disk; a verdict with no pins is
// unknown, not fresh. Presence of a verdict file is never evidence. Ported from v1
// tools/judges.mjs verdictFreshness.

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The pin a runner writes for one artifact it handed the judge. */
export function pin({ id, path, doc }) {
  const content_hash = doc?.meta?.content_hash;
  if (!content_hash) throw new Error(`pin: ${id} at ${path} has no meta.content_hash — stamp it before judging`);
  return { id, path, content_hash };
}

export function verdictFreshness(verdict, { root }) {
  const pins = verdict?.judged;
  if (!Array.isArray(pins) || !pins.length) return { fresh: null, stale: [] };

  const stale = [];
  for (const p of pins) {
    let current = null;
    try {
      current = JSON.parse(readFileSync(join(root, p.path), "utf8"))?.meta?.content_hash ?? null;
    } catch {
      // A missing or unreadable artifact is not the one the judge saw.
    }
    if (!current || current !== p.content_hash) stale.push({ id: p.id, path: p.path, judged: p.content_hash, current });
  }
  return { fresh: stale.length === 0, stale };
}
