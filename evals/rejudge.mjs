#!/usr/bin/env node
// owns: R5 · shared — eval: rejudge. Seeded at M1 with the freshness arithmetic: a
// verdict is about the hashes it pinned; fresh when every pin matches the artifact on
// disk, stale naming the artifact when one does not, unknown when nothing was pinned.
// The stale → rejudging transition joins at M2 with the state machine.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { suite, withRoot } from "./_harness.mjs";
import { pin, verdictFreshness } from "../shared/judge/index.mjs";
import { stamp } from "../shared/hash.mjs";

const { check, done } = suite("rejudge · verdict freshness");

const story = (id, statement) => stamp({ id, statement, "x-drift-checked": ["/statement"] });

withRoot({}, (root) => {
  const a = story("STORY-1", "As a baker, I want the run sheet…");
  const b = story("STORY-2", "As a baker, I want to mark a bake done…");
  writeFileSync(join(root, "STORY-1.json"), JSON.stringify(a));
  writeFileSync(join(root, "STORY-2.json"), JSON.stringify(b));
  const verdict = { gate: "story-reviewer", verdict: "pass", findings: [], deferred: [], checked: 2, skipped: 0,
    judged: [pin({ id: "STORY-1", path: "STORY-1.json", doc: a }), pin({ id: "STORY-2", path: "STORY-2.json", doc: b })] };

  check("every pin matches → fresh", verdictFreshness(verdict, { root }).fresh === true);

  b.statement = "As a baker, I want to mark a bake done and note the reason…";
  stamp(b);
  writeFileSync(join(root, "STORY-2.json"), JSON.stringify(b));
  const f = verdictFreshness(verdict, { root });
  check("an artifact re-stamped since judging → stale, naming it with both hashes",
    f.fresh === false && f.stale.length === 1 && f.stale[0].id === "STORY-2" && f.stale[0].judged === verdict.judged[1].content_hash && f.stale[0].current === b.meta.content_hash,
    JSON.stringify(f));

  writeFileSync(join(root, "STORY-1.json"), JSON.stringify({ id: "STORY-1", statement: "edited by hand, never re-stamped", meta: a.meta, "x-drift-checked": ["/statement"] }));
  check("a hand edit that kept the old hash still reads as the pinned version — freshness is a hash comparison, integrity is hash.verify's job",
    verdictFreshness(verdict, { root }).stale.map((s) => s.id).join() === "STORY-2");

  writeFileSync(join(root, "STORY-2.json"), "");
  const g = verdictFreshness(verdict, { root });
  check("a missing or unreadable artifact is not the one the judge saw", g.fresh === false && g.stale[0].current === null);

  check("no pins → unknown, not fresh: presence is never evidence", verdictFreshness({ ...verdict, judged: [] }, { root }).fresh === null && verdictFreshness({ gate: "g" }, { root }).fresh === null);

  let err = null;
  try { pin({ id: "X", path: "x.json", doc: { id: "X" } }); } catch (e) { err = e; }
  check("an unstamped artifact cannot be pinned", /no meta\.content_hash/.test(err?.message ?? ""));
});

done();
