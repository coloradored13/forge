// owns: R14 · shared — the handoff as both halves read it: where a project's handoffs
// live, which items a snapshot indexes and over which fields each is hashed (read from
// the item's own schema — R10), and the verifier that says exactly which item no longer
// matches. Discovery's export writes with this; Delivery's intake reads with this and
// nothing of Discovery's.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inlineRefs, load } from "./schema/index.mjs";
import { itemHash, resolve, verify } from "./hash.mjs";
import { deriveVerdict } from "./judge/verdict.mjs";

export const HANDOFFS = join("discovery", "handoffs");
export const GATE = "handoff-integrity";

export function handoffFile(version) {
  return join(HANDOFFS, `handoff-v${version}.json`);
}

/** Every handoff a project has exported, oldest first. */
export function readHandoffs(root) {
  const dir = join(root, HANDOFFS);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^handoff-v\d+\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")))
    .sort((a, b) => a.version - b.version);
}

export function latestHandoff(root) {
  return readHandoffs(root).at(-1) ?? null;
}

/**
 * The item kinds a snapshot indexes: where each list sits in the handoff, which schema
 * declares the item, and which field is its id. The fields hashed are every field the
 * item's schema declares for it — a field added to the schema is hashed from then on,
 * with nothing to update here.
 */
export const KINDS = {
  requirement: { at: "/contract/requirements", schema: "prd", item: "/requirements", id: "id" },
  surface: { at: "/contract/surfaces", schema: "prd", item: "/surfaces/shipped", id: "id" },
  ruling: { at: "/contract/rulings", schema: "prd", item: "/rulings", id: "id" },
  amendment: { at: "/contract/amendments", schema: "prd", item: "/amendments", id: "id" },
  epic: { at: "/stories/epics", schema: "story", item: "/epics", id: "id" },
  story: { at: "/stories/stories", schema: "story", item: "/stories", id: "id" },
  screen: { at: "/design/screens", schema: "design", item: "/screens", id: "screen_ref" },
};

const fieldCache = new Map();
/** The fields an item of this kind is hashed over, from its schema. */
export function itemFields(kind) {
  if (!fieldCache.has(kind)) {
    const { schema, item } = KINDS[kind];
    let node = inlineRefs(load(schema));
    for (const step of item.split("/").slice(1)) {
      node = node.properties?.[step];
      if (!node) throw new Error(`itemFields: ${schema} has no ${item}`);
      if (node.type === "array") node = node.items;
    }
    fieldCache.set(kind, Object.keys(node.properties ?? {}).filter((k) => !node.properties[k]["x-runner"]));
  }
  return fieldCache.get(kind);
}

/** The index a snapshot carries, recomputed from what it embeds: `{ id, kind, hash }` per item. */
export function itemsOf(handoff) {
  const out = [];
  for (const [kind, { at, id }] of Object.entries(KINDS)) {
    const list = resolve(handoff, at);
    if (!Array.isArray(list)) continue;
    for (const it of list) out.push({ id: it[id], kind, hash: itemHash(it, itemFields(kind)) });
  }
  return out;
}

/**
 * Recompute and compare — the snapshot's own content hash, and every item against the
 * index it carries. Finding-shaped like every gate; each finding names one id.
 */
export function verifyHandoff(handoff) {
  const findings = [...verify(handoff).findings];
  const listed = new Map((handoff.items ?? []).map((it) => [`${it.kind}:${it.id}`, it]));
  const live = new Map(itemsOf(handoff).map((it) => [`${it.kind}:${it.id}`, it]));
  const f = (rule, it, summary, evidence) => findings.push({ severity: "high", confidence: "certain", rule, subject: it.id, summary, evidence, remedy: "Re-export through the door; a snapshot is never edited." });
  for (const [k, it] of live) {
    const was = listed.get(k);
    if (!was) f("item-unlisted", it, `${it.id} (${it.kind}) is in the snapshot but not in its index.`, `${KINDS[it.kind].at} holds ${it.id}; /items does not.`);
    else if (was.hash !== it.hash) f("item-hash-stale", it, `${it.id} (${it.kind}) no longer matches its indexed hash.`, `indexed ${was.hash} · computed ${it.hash}`);
  }
  for (const [k, it] of listed) {
    if (!live.has(k)) f("item-missing", it, `${it.id} (${it.kind}) is indexed but not in the snapshot.`, `/items lists ${it.id}; ${KINDS[it.kind]?.at ?? "(unknown kind)"} does not hold it.`);
  }
  return { gate: GATE, verdict: deriveVerdict(findings), findings, deferred: [], checked: live.size + 1, skipped: 0 };
}

// ── how the snapshot's design reads to an agent — one rendering, used by every prompt in either half that shows it ──

/** The design as a writer or judge reads it: tokens, stylesheet, then each screen — its moment, structure, states and controls by id. */
export function renderDesign(doc) {
  const tokens = Object.entries(doc.tokens ?? {}).map(([k, v]) => `- ${k}: ${v}`).join("\n") || "(none)";
  const screens = (doc.screens ?? []).map((s) => [
    `### ${s.screen_ref} — ${s.name}`,
    `Read: ${s.moment}`,
    `Structure:\n${s.structure}`,
    `States:\n${(s.states ?? []).map((st) => `- **${st.name}**${st.entered_by ? ` (${st.entered_by})` : ""}: ${st.renders}`).join("\n")}`,
    `Controls:\n${(s.controls ?? []).map((c) => `- \`${c.id}\` ${c.kind} "${c.label}"${c.state ? ` in ${c.state}` : ""}`).join("\n") || "(none)"}`,
  ].join("\n\n")).join("\n\n");
  const parts = [`Tokens:\n${tokens}`, `Stylesheet:\n\`\`\`css\n${String(doc.stylesheet ?? "").trim()}\n\`\`\``, screens || "(no screens)"];
  if (doc.notes?.trim()) parts.push(`Writer's notes: ${doc.notes.trim()}`);
  return parts.join("\n\n");
}
