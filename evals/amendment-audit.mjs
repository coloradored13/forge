#!/usr/bin/env node
// owns: R4 · shared — eval: amendment-audit. An amendment computes its blast radius —
// every criterion, story and screen that references what changes — and the vocabulary
// it introduces, at mint; the PM approves the radius, not just the edit. Both
// directions: the door refuses what cannot be amended and what has moved, and a clean
// proposal lands with the version, the hash, the audit and the record all agreeing.

import { join } from "node:path";
import { existsSync } from "node:fs";
import { suite, withRoot } from "./_harness.mjs";
import { seedProject, seedPrototype, seedStories } from "./_fixture.mjs";
import { load, validate } from "../shared/schema/index.mjs";
import { verify, resolve } from "../shared/hash.mjs";
import { verdictFreshness } from "../shared/judge/index.mjs";
import { rows, funnelPath } from "../shared/funnel.mjs";
import { loadPrd, savePrd } from "../discovery/workshop/index.mjs";
import { Refused, readDoc, readVerdict, staleness, REVIEWS } from "../discovery/record/index.mjs";
import { answer, propose, approve, reject, forbiddenTargets, radiusOf, introducedBy, auditOf, AUDIT_GATE } from "../discovery/doors/index.mjs";

const { check, done } = suite("amendment-audit · R4 the radius is approved, not just the edit");

const refusal = (fn) => { try { fn(); return null; } catch (e) { return e; } };
const same = (a, b) => a.length === b.length && [...a].sort().join(" ") === [...b].sort().join(" ");
const by = "Brad";
const at = new Date("2026-09-04T11:00:00Z");
const TO = "A dock lead records an exception at the kiosk against a delivery.";

// ── what cannot be amended ──
await withRoot({}, (parent) => {
  const root = seedProject(parent);
  const runner = Object.entries(load("prd").properties).filter(([, p]) => p["x-runner"]).map(([k]) => `/${k}`);
  check(`the forbidden targets are derived from the schema's x-runner fields (${runner.length}), never listed by hand`, same(forbiddenTargets(), runner) && runner.includes("/rulings") && runner.includes("/amendments") && runner.includes("/flags"), runner.join(","));
  for (const t of [...runner, "/"]) {
    const e = refusal(() => propose({ root, target: t === "/" ? "/" : `${t}/0`, to: "x", rationale: "r", by }));
    check(`propose refuses ${t}`, e instanceof Refused && (e.code === "forbidden-target" || e.code === "no-target"), e?.code ?? "no refusal");
  }
  for (const [code, args] of [
    ["no-author", { target: "/requirements/0/statement", to: "x", rationale: "r" }],
    ["no-rationale", { target: "/requirements/0/statement", to: "x", by }],
    ["no-target", { target: "requirements/0", to: "x", rationale: "r", by }],
    ["no-change", { target: "/requirements/0/statement", rationale: "r", by }],
    ["target-unresolved", { target: "/requirements/7/statement", to: "x", rationale: "r", by }],
    ["target-unresolved", { target: "/requirements/9", to: "x", rationale: "r", by }],
  ]) {
    const e = refusal(() => propose({ root, ...args }));
    check(`propose refuses ${code} (${args.target})`, e instanceof Refused && e.code === code, e?.code ?? "no refusal");
  }
  check("nothing refused touched the record", loadPrd(root).amendments.length === 0 && !existsSync(join(root, REVIEWS, AUDIT_GATE)));
});

// ── the radius and the audit, computed at mint ──
await withRoot({}, (parent) => {
  const root = seedProject(parent);
  seedPrototype(root);
  seedStories(root);
  const before = loadPrd(root);

  const pure = radiusOf({ prd: before, proto: readDoc(root, "discovery/prototype.json"), stories: readDoc(root, "discovery/stories.json"), target: "/requirements/0/statement", from: before.requirements[0].statement });
  check("radiusOf: a requirement's statement reaches its criteria, the stories that deliver it, the screens that show it, and the term it uses",
    same(pure.criteria, ["REQ-1/AC-1", "REQ-1/AC-2"]) && same(pure.stories, ["STORY-1"]) && same(pure.screens, ["SCREEN-1"]) && same(pure.terms, ["exception"]), JSON.stringify(pure));
  const ac = radiusOf({ prd: before, proto: readDoc(root, "discovery/prototype.json"), stories: readDoc(root, "discovery/stories.json"), target: "/requirements/1/acceptance_criteria/0", from: before.requirements[1].acceptance_criteria[0] });
  check("radiusOf: one criterion reaches itself and the scenario that proves it; its term reaches what else uses the term",
    same(ac.criteria, ["REQ-2/AC-1"]) && same(ac.stories, ["STORY-1", "STORY-2"]) && same(ac.screens, ["SCREEN-2"]) && same(ac.terms, ["run sheet"]), JSON.stringify(ac));
  const surf = radiusOf({ prd: before, proto: readDoc(root, "discovery/prototype.json"), stories: null, target: "/surfaces/shipped/0", from: before.surfaces.shipped[0] });
  check("radiusOf: a surface reaches its screens; without a backlog there are no stories", same(surf.screens, ["SCREEN-1", "SCREEN-2"]) && surf.stories.length === 0 && surf.criteria.length === 0, JSON.stringify(surf));
  const term = radiusOf({ prd: before, proto: readDoc(root, "discovery/prototype.json"), stories: readDoc(root, "discovery/stories.json"), target: "/shape/vocabulary/0/definition", from: before.shape.vocabulary[0].definition });
  check("radiusOf: redefining a term reaches everything that uses the term", same(term.terms, ["exception"]) && same(term.criteria, ["REQ-1/AC-1", "REQ-1/AC-2"]) && same(term.stories, ["STORY-1"]) && same(term.screens, ["SCREEN-1"]), JSON.stringify(term));
  check("introducedBy: only the words the PRD does not already use", introducedBy(before, TO).join() === "kiosk" && introducedBy(before, before.requirements[0].statement).length === 0);
  check("auditOf: undeclared vocabulary advises — the PM's acknowledgement is the gate, the audit is the record", auditOf({ id: "AMD-0", target: "/x", to: TO, introduces: ["kiosk"], radius: { criteria: [], stories: [], screens: [] } }).verdict === "advise" && auditOf({ id: "AMD-0", target: "/x", to: "", introduces: [], radius: { criteria: [], stories: [], screens: [] } }).verdict === "pass");

  const { amendment: a, audit } = propose({ root, target: "/requirements/0/statement", to: TO, rationale: "the door has a kiosk now", by, _now: () => at });
  const prd = loadPrd(root);
  check("AMD-1 is on the record as proposed, against the version and hash it was minted on, with from and to",
    a.id === "AMD-1" && a.status === "proposed" && a.against_version === "0.1.0" && a.against_hash === before.meta.content_hash && a.from === before.requirements[0].statement && a.to === TO && a.adds === false && a.origin === "pm" && a.by === "Brad" && a.at === at.toISOString(), JSON.stringify(a));
  check("the radius and the introduced vocabulary ride on the amendment", same(a.radius.criteria, ["REQ-1/AC-1", "REQ-1/AC-2"]) && same(a.radius.stories, ["STORY-1"]) && same(a.radius.screens, ["SCREEN-1"]) && a.radius.terms.join() === "exception" && a.introduces.join() === "kiosk" && a.material === true);
  check("proposing moves nothing in the content: same hash, same version, the target untouched", prd.meta.content_hash === before.meta.content_hash && prd.meta.version === "0.1.0" && prd.requirements[0].statement === before.requirements[0].statement && validate("prd", prd).ok);
  const file = join(root, REVIEWS, AUDIT_GATE, "AMD-1.json");
  const onDisk = readVerdict(root, join(AUDIT_GATE, "AMD-1"));
  check("the audit is filed under the gate by amendment id, validates, advises on undeclared-vocabulary, and pins the PRD it audited",
    existsSync(file) && validate("finding", onDisk).ok && onDisk.verdict === "advise" && onDisk.findings.map((f) => f.rule).join() === "undeclared-vocabulary" && /kiosk/.test(onDisk.findings[0].summary) && onDisk.judged[0].content_hash === before.meta.content_hash && verdictFreshness(onDisk, { root }).fresh && audit.checked === 1 + 2 + 1 + 1, JSON.stringify(onDisk));

  // Adds.
  const add1 = propose({ root, target: "/requirements/0/acceptance_criteria/2", to: { id: "AC-3", statement: "An exception names the door it was recorded at." }, rationale: "which door", by });
  const add2 = propose({ root, target: "/constraints/-", to: "No exception leaves the site network.", rationale: "legal", by });
  check("adding at the end of an array, by index or by -, is an add at the resolved index with no from", add1.amendment.adds && add1.amendment.target === "/requirements/0/acceptance_criteria/2" && !("from" in add1.amendment) && add2.amendment.adds && add2.amendment.target === "/constraints/0");
  const patch = propose({ root, target: "/open_questions/0/owner", to: "receiving lead", rationale: "ops handed it over", by });
  check("a target outside the drift-checked content is not material, and words the PRD already uses introduce nothing", patch.amendment.material === false && patch.amendment.radius.criteria.length === 0 && patch.amendment.introduces.length === 0, JSON.stringify(patch.amendment.introduces));

  // Approve refuses.
  const nope = (args) => refusal(() => approve({ root, by, ...args }));
  check("approve refuses an unknown or already-decided amendment", nope({ id: "AMD-9" })?.code === "unknown-amendment" && nope({ id: "AMD-1" })?.code === "radius-unacknowledged");
  const half = nope({ id: "AMD-1", radius: ["REQ-1/AC-1", "STORY-1", "SCREEN-1"] });
  check("approve refuses a radius that is not the whole radius, and says what is expected", half?.code === "radius-unacknowledged" && same(half.detail.expected, ["REQ-1/AC-1", "REQ-1/AC-2", "STORY-1", "SCREEN-1"]) && half.detail.given.length === 3, JSON.stringify(half?.detail));
  check("approve refuses a radius with extras — the acknowledgement is exact", nope({ id: "AMD-1", radius: ["REQ-1/AC-1", "REQ-1/AC-2", "STORY-1", "SCREEN-1", "SCREEN-2"] })?.code === "radius-unacknowledged");
  check("approve refuses without an author", refusal(() => approve({ root, id: "AMD-1", radius: [] }))?.code === "no-author");

  // A non-material approval: patch bump.
  const p = approve({ root, id: patch.amendment.id, by, radius: [], _now: () => at });
  check("a non-material amendment lands with a patch bump and the target holding the new value", p.prd.meta.version === "0.1.1" && p.prd.open_questions[0].owner === "receiving lead" && p.amendment.status === "approved" && p.amendment.resulting_version === "0.1.1" && p.amendment.decided.by === "Brad");
  check("approval re-stamps and the document verifies; the flag trail has it", verify(loadPrd(root)).verdict === "pass" && loadPrd(root).flags.some((f) => /AMD-4 approved by Brad → 0\.1\.1/.test(f.note)), JSON.stringify(loadPrd(root).flags));

  // The PRD moved (a patch is a move too) — everything proposed against 0.1.0 must be re-proposed.
  const moved = nope({ id: "AMD-1", radius: ["REQ-1/AC-1", "REQ-1/AC-2", "STORY-1", "SCREEN-1"] });
  check("approve refuses an amendment proposed against a PRD that has since moved", moved?.code === "prd-moved" && /0\.1\.1/.test(moved.message) && /0\.1\.0/.test(moved.message), moved?.message);
  check("a rejected amendment carries its reason on the record and in the flags", reject({ root, id: "AMD-1", by, reason: "no kiosk this cycle", _now: () => at }).amendment.decided.note === "no kiosk this cycle" && loadPrd(root).flags.some((f) => /AMD-1 rejected by Brad: no kiosk/.test(f.note)));
  check("reject refuses what is not proposed, and a rejection without a reason", refusal(() => reject({ root, id: "AMD-1", by, reason: "again" }))?.code === "not-proposed" && refusal(() => reject({ root, id: "AMD-2", by }))?.code === "no-reason");
  check("approve refuses what is already decided", nope({ id: "AMD-1", radius: [] })?.code === "not-proposed");
});

// ── a clean material approval; then from-changed and target-now-exists ──
await withRoot({}, (parent) => {
  const root = seedProject(parent);
  seedPrototype(root);
  seedStories(root);
  const before = loadPrd(root);
  const { amendment: a } = propose({ root, target: "/requirements/0/statement", to: TO, rationale: "the door has a kiosk now", by });
  const ok = approve({ root, id: a.id, by, radius: ["SCREEN-1", "STORY-1", "REQ-1/AC-2", "REQ-1/AC-1"], _now: () => at });
  const prd = loadPrd(root);
  check("a material amendment lands: minor bump, the target holds `to`, the hash moved, the document verifies",
    ok.prd.meta.version === "0.2.0" && prd.requirements[0].statement === TO && prd.meta.content_hash !== before.meta.content_hash && verify(prd).verdict === "pass" && validate("prd", prd).ok);
  check("the record shows approved with the radius as it stood, the resulting version and who decided",
    prd.amendments[0].status === "approved" && prd.amendments[0].resulting_version === "0.2.0" && same(prd.amendments[0].radius.stories, ["STORY-1"]) && prd.amendments[0].decided.by === "Brad" && prd.amendments[0].decided.at === at.toISOString());
  check("the flag names the amendment, the version and the radius", prd.flags.some((f) => /AMD-1 approved by Brad → 0\.2\.0: the door has a kiosk now · radius REQ-1\/AC-1, REQ-1\/AC-2, SCREEN-1, STORY-1/.test(f.note)), JSON.stringify(prd.flags));
  const s = staleness(root);
  check("the prototype and the stories now wear the badge, naming AMD-1 as what moved the PRD since they were made",
    s.prototype.stale && s.prototype.since.join() === "AMD-1" && s.stories.stale && s.stories.prd_moved && !s.stories.prototype_moved && s.stories.since.join() === "AMD-1", JSON.stringify(s));

  // from-changed: the target moves under the proposal outside the hashed content, so the
  // version and hash still match — only the value differs from what was proposed against.
  const b = propose({ root, target: "/open_questions/0/question", to: "Can an exception be recorded after the truck has left the yard?", rationale: "sharper", by });
  const edited = loadPrd(root);
  edited.open_questions[0].question = "Something else entirely?";
  savePrd(root, edited);
  check("the edit outside the drift-checked content moved neither version nor hash", loadPrd(root).meta.version === "0.2.0" && loadPrd(root).meta.content_hash === prd.meta.content_hash);
  const fc = refusal(() => approve({ root, id: b.amendment.id, by, radius: [] }));
  check("approve refuses when the target no longer holds what was proposed against, and says what is there now", fc?.code === "from-changed" && fc.detail.now === "Something else entirely?" && fc.detail.from === "Can an exception be recorded after the truck has left?", fc?.code);

  // target-now-exists: an add whose slot got filled.
  const c = propose({ root, target: "/open_questions/-", to: { id: "OQ-3", question: "Is a photo required?", owner: "ops", status: "open" }, rationale: "asked at the door", by });
  const filled = loadPrd(root);
  filled.open_questions.push({ id: "OQ-3", question: "Filled by hand.", owner: "ops", status: "open" });
  savePrd(root, filled);
  check("an add resolves to the index it will take", c.amendment.adds && c.amendment.target === "/open_questions/2");
  check("approve refuses an add whose slot now exists", refusal(() => approve({ root, id: c.amendment.id, by, radius: [] }))?.code === "target-now-exists");

  // The answer door is a move too: a ruling between proposal and approval refuses the approval.
  const d = propose({ root, target: "/requirements/1/statement", to: "A dock lead sees the run sheet for the shift, newest truck first.", rationale: "order", by });
  answer({ root, req: "REQ-2", oq: "OQ-2", answer: "The receiving lead.", by });
  check("a ruling landing after a proposal is a move: approve refuses prd-moved", refusal(() => approve({ root, id: d.amendment.id, by, radius: ["REQ-2/AC-1", "REQ-2/AC-2", "STORY-1", "STORY-2", "SCREEN-2"] }))?.code === "prd-moved");

  // Origin delivery: the funnel hears about it (R8).
  const e = propose({ root, target: "/requirements/0/acceptance_criteria/0/statement", to: "An exception carries the delivery, the vendor, a reason and a photo.", rationale: "the build needs it", by: "delivery/sdd", origin: "delivery" });
  const funnel = rows(funnelPath(root));
  check("an amendment from Delivery is a funnel row: id, target, material", e.amendment.origin === "delivery" && funnel.length === 1 && funnel[0].signal === "delivery-amendment" && funnel[0].id === e.amendment.id && funnel[0].material === true, JSON.stringify(funnel));
  check("the approved edit is what resolve() finds at the pointer — no hand edit anywhere in the chain", resolve(loadPrd(root), "/requirements/0/statement") === TO);
});

done();
