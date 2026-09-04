#!/usr/bin/env node
// owns: R14 · shared — eval: provenance. Seeded at M1 with the chain arithmetic every
// artifact stands on: one canonical form (Python parity pinned), a content hash over
// the artifact's own x-drift-checked subset, per-item hashes, and a verifier that says
// no on a tampered field and yes on a clean one. The manifest verifier joins at M3.

import { suite } from "./_harness.mjs";
import { canonicalize, sha256, resolve, contentHash, itemHash, stamp, stampItems, verify, ALGORITHM } from "../shared/hash.mjs";

const { check, done } = suite("provenance · hash chain");

// ── canonical form ──
{
  // Pinned from python3: json.dumps(v, sort_keys=True, separators=(",",":"), ensure_ascii=True)
  const v = { b: "é😀", a: [2, 1], n: { z: 1, y: null } };
  const PY = '{"a":[2,1],"b":"\\u00e9\\ud83d\\ude00","n":{"y":null,"z":1}}';
  const PY_SHA = "aee92486764e8f007a21c8b5141c1870760c3db3fb66bd7d5616d0c023aa0d9d";
  check("keys sorted, arrays ordered, no whitespace, non-ASCII escaped — Python parity", canonicalize(v) === PY, canonicalize(v));
  check("the digest matches Python's over the same bytes", sha256(v) === PY_SHA, sha256(v));
  check("key order does not change the hash", sha256({ x: 1, y: [{ b: 2, a: 1 }] }) === sha256({ y: [{ a: 1, b: 2 }], x: 1 }));
  check("array order does change the hash — order is content", sha256({ a: [1, 2] }) !== sha256({ a: [2, 1] }));
  check("the algorithm id is v1's, so v1 hashes still verify", ALGORITHM === "sha256/canonical-json/v1");
}

// ── pointers ──
{
  const doc = { a: { "b/c": { "~d": 1 } }, list: [10, 20] };
  check("JSON pointers resolve, with ~1 and ~0 escapes", resolve(doc, "/a/b~1c/~0d") === 1 && resolve(doc, "/list/1") === 20);
  check("a missing step is undefined, not a throw", resolve(doc, "/a/nope/x") === undefined && resolve(null, "/a") === undefined);
}

// ── content hash and stamp ──
{
  const doc = { id: "PRD-1", crux: "one bakery, one run sheet", requirements: [{ id: "REQ-1", statement: "s" }], traces: { x: "y" }, "x-drift-checked": ["/crux", "/requirements"] };
  stamp(doc);
  check("stamp writes the hash and the algorithm", doc.meta.hash_algorithm === ALGORITHM && /^[0-9a-f]{64}$/.test(doc.meta.content_hash));
  check("a clean artifact verifies", verify(doc).verdict === "pass" && verify(doc).checked === 1);

  const before = doc.meta.content_hash;
  doc.traces.x = "changed";
  check("provenance is outside the hash — a trace change does not stale the artifact", contentHash(doc) === before && verify(doc).verdict === "pass");

  doc.crux = "two bakeries";
  const v = verify(doc);
  check("a covered field changed → content-hash-mismatch, block, with stored and computed in the evidence",
    v.verdict === "block" && v.findings.length === 1 && v.findings[0].rule === "content-hash-mismatch" && v.findings[0].confidence === "certain" &&
    v.findings[0].evidence.includes(before) && v.findings[0].evidence.includes(contentHash(doc)), JSON.stringify(v));

  let e1 = null; try { contentHash({ id: "x" }); } catch (e) { e1 = e; }
  let e2 = null; try { contentHash({ id: "x", "x-drift-checked": ["/nope"] }); } catch (e) { e2 = e; }
  check("no pointers is a refusal, not an empty hash", /no x-drift-checked/.test(e1?.message ?? ""));
  check("pointers that resolve to nothing are a refusal", /none of \/nope resolve/.test(e2?.message ?? ""));
}

// ── per-item hashes ──
{
  const FIELDS = ["id", "statement", "acceptance_criteria"];
  const doc = {
    id: "handoff-1",
    stories: [{ id: "STORY-1", statement: "a", acceptance_criteria: ["x"], status: "draft" }, { id: "STORY-2", statement: "b", acceptance_criteria: [] }],
    "x-drift-checked": ["/stories"],
  };
  stampItems(doc.stories, { fields: FIELDS });
  stamp(doc);
  const items = [{ pointer: "/stories", fields: FIELDS }];
  check("items stamped and the document over them verify", verify(doc, { items }).verdict === "pass" && verify(doc, { items }).checked === 3);
  check("an item's hash covers its substance only", (() => { const h = doc.stories[0].hash; doc.stories[0].status = "signed"; return itemHash(doc.stories[0], FIELDS) === h; })());

  doc.stories[1].statement = "b — edited in Jira";
  const v = verify(doc, { items });
  check("a tampered item is named — item-hash-stale on STORY-2 — and the document hash fails with it",
    v.verdict === "block" && v.findings.map((f) => `${f.rule}:${f.subject}`).join(",") === "item-hash-stale:STORY-2,content-hash-mismatch:handoff-1", JSON.stringify(v.findings.map((f) => f.subject)));
}

done();
