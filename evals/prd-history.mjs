// owns: R3, R4, R10, R15 · discovery — PRD history only at successful version boundaries.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, utimesSync } from "node:fs";
import { join, basename } from "node:path";
import { suite, withRoot, scripted } from "./_harness.mjs";
import { seedProject, seedPrototype, seedStories } from "./_fixture.mjs";
import { answer, propose, approve, reject, react, agree } from "../discovery/doors/index.mjs";
import { loadPrd, PRD_FILE } from "../discovery/workshop/index.mjs";
import { keepOutgoing, renderPrd, PROTOTYPE_FILE } from "../discovery/record/index.mjs";
import { serve, esc } from "../shared/console/index.mjs";
import { routes, nav } from "../discovery/console/index.mjs";
const { check, done } = suite("PRD history", 20);
const hash = b => createHash("sha256").update(b).digest("hex");
const bytes = (root, file = PRD_FILE) => readFileSync(join(root, file));
const keyOf = b => `prd-${hash(b).slice(0, 12)}`;
const kept = root => existsSync(join(root, "discovery/history")) ? readdirSync(join(root, "discovery/history")).filter(f => f.startsWith("prd-")).sort() : [];
const snapshot = root => JSON.stringify(readdirSync(root, { recursive: true }).sort().filter(p => statSync(join(root, p)).isFile()).map(p => [p, hash(bytes(root, p))]));
const links = text => [...text.matchAll(/href="\/artifact\/prd\/history\/([^"#?]+)"/g)].map(m => m[1]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const radius = a => [...a.radius.criteria, ...a.radius.stories, ...a.radius.screens];
const by = "History PM", target = "/requirements/0/acceptance_criteria/0/statement";
const amendment = (root, to) => propose({ root, target, to, rationale: "Clarify the criterion", by }).amendment;
const respond = root => answer({ root, req: "REQ-1", oq: "OQ-1", answer: "An exception can be recorded after the truck has left.", by });
const noIO = () => { throw Error("unexpected external IO"); };
async function consoleFor(root, fn) {
  const srv = await serve({ routes: routes({ root, _query: noIO, _exec: noIO, _fetch: noIO, _env: {} }), nav, port: 0 });
  const get = async path => { const r = await fetch(`${srv.url}${path}`); return { status: r.status, text: await r.text() }; };
  try { await fn(get); } finally { await srv.close(); }
}
await withRoot({}, async tmp => {
  const root = seedProject(tmp); seedPrototype(root); seedStories(root);
  // Agreement changes workflow bytes without moving the version: the outgoing copy must include it.
  agree({ root, by });
  check("agreement keeps no PRD before the first bump", kept(root).length === 0);
  const first = bytes(root), firstKey = keyOf(first), firstDoc = JSON.parse(first);
  respond(root);
  check("answer keeps exactly the outgoing whole-file hash key and bytes", same(kept(root), [firstKey + ".json"]) && bytes(root, `discovery/history/${firstKey}.json`).equals(first));
  const a = amendment(root, "An exception carries the delivery and a reason.");
  const second = bytes(root), secondKey = keyOf(second), secondDoc = JSON.parse(second);
  assert.notEqual(firstDoc.meta.version, secondDoc.meta.version);
  assert.equal(secondDoc.amendments.at(-1).status, "proposed");
  check("proposal does not keep an intermediate state of the version", same(kept(root), [firstKey + ".json"]));
  approve({ root, id: a.id, by, radius: radius(a) });
  const current = bytes(root), currentKey = keyOf(current);
  assert.notEqual(loadPrd(root).meta.version, secondDoc.meta.version);
  const expected = [firstKey + ".json", secondKey + ".json"].sort();
  check("approve keeps two versions exactly once, including final proposed state", same(kept(root), expected) && bytes(root, `discovery/history/${firstKey}.json`).equals(first) && bytes(root, `discovery/history/${secondKey}.json`).equals(second));
  // Retry after success must neither archive the new current version nor alter an old copy.
  const beforeRetry = snapshot(root);
  assert.throws(() => approve({ root, id: a.id, by, radius: radius(a) }), e => e.code === "not-proposed");
  check("repeated approval leaves all history bytes and current bytes alone", snapshot(root) === beforeRetry && same(kept(root), expected));
  for (const [i, key] of [firstKey, secondKey].entries()) if (existsSync(join(root, `discovery/history/${key}.json`))) utimesSync(join(root, `discovery/history/${key}.json`), 1000 + i, 1000 + i);
  await consoleFor(root, async get => {
    const page = await get("/artifact/prd");
    check("list contains exactly two outgoing versions newest first, not current", page.status === 200 && same(links(page.text), [secondKey, firstKey]) && !links(page.text).includes(currentKey));
    check("each row labels its own PRD version and content hash", [[firstKey, firstDoc], [secondKey, secondDoc]].every(([key, doc]) => {
      const row = [...page.text.matchAll(/<tr>[^]*?<\/tr>/g)].map(m => m[0]).find(r => r.includes(key)) ?? "";
      return row.includes(`v${doc.meta.version}`) && row.includes(doc.meta.content_hash.slice(0, 12));
    }));
    const before = snapshot(root), old = await get(`/artifact/prd/history/${firstKey}`);
    check("older page uses renderPrd and preserves the original criterion", old.status === 200 && old.text.includes(esc(renderPrd(firstDoc))) && old.text.includes(firstDoc.requirements[0].acceptance_criteria[0].statement) && !old.text.includes(a.to));
    check("opening listed PRD is read-only with no forms or record writes", old.status === 200 && !/<form\b|\baction\s*=/i.test(old.text) && snapshot(root) === before && bytes(root).equals(current));
    for (const key of [firstKey, secondKey]) if (existsSync(join(root, `discovery/history/${key}.json`))) utimesSync(join(root, `discovery/history/${key}.json`), 2000, 2000);
    check("equal history mtimes sort by ascending key", same(links((await get("/artifact/prd")).text), [firstKey, secondKey].sort()));
    // A physically present current copy is still unlisted and cannot be opened by guessing its key.
    keepOutgoing(root, "prd", PRD_FILE);
    const beforeRead = snapshot(root);
    check("identical current copy is excluded from both list and access", same(links((await get("/artifact/prd")).text), [firstKey, secondKey].sort()) && (await get(`/artifact/prd/history/${currentKey}`)).status === 404 && snapshot(root) === beforeRead);
    const protoKey = basename(keepOutgoing(root, "prototype", PROTOTYPE_FILE));
    const before404 = snapshot(root);
    check("unknown PRD key is 404 without writes", (await get("/artifact/prd/history/prd-000000000000")).status === 404 && snapshot(root) === before404);
    check("prototype key under PRD history is 404 without writes", (await get(`/artifact/prd/history/${protoKey}`)).status === 404 && snapshot(root) === before404);
  });
});
await withRoot({}, async tmp => {
  const root = seedProject(tmp); seedPrototype(root); seedStories(root);
  const a = amendment(root, "An exception carries the delivery and a reason."), before = bytes(root);
  assert(radius(a).length > 0);
  assert.throws(() => approve({ root, id: a.id, by, radius: [] }), e => e.code === "radius-unacknowledged");
  check("radius-unacknowledged approval keeps nothing and preserves PRD", kept(root).length === 0 && bytes(root).equals(before));
  reject({ root, id: a.id, by, reason: "Keep the original wording" });
  check("reject changes state without version bump or history", loadPrd(root).amendments.at(-1).status === "rejected" && loadPrd(root).meta.version === JSON.parse(before).meta.version && kept(root).length === 0);
  const proto = seedPrototype(root), version = loadPrd(root).meta.version;
  const q = scripted({ structured: { change: null, rationale: "", note: "The prototype already fits." } });
  const result = await react({ root, by, text: "Keep this behavior", seen: { prd_hash: loadPrd(root).meta.content_hash, prototype_hash: proto.meta.content_hash }, _query: q.query, _sleep: async () => {} });
  assert.equal(q.calls.length, 1); assert.equal(result.reaction.proposal, null);
  check("scripted no-change reaction keeps no PRD or new version", kept(root).length === 0 && loadPrd(root).meta.version === version && loadPrd(root).reactions.length === 1);
});
await withRoot({}, async tmp => {
  const root = seedProject(tmp); seedPrototype(root); seedStories(root);
  // This must reach savePrd's schema validation, not an earlier radius or audit refusal (#95).
  const a = amendment(root, null), before = bytes(root), beforeHistory = kept(root);
  assert.equal(a.target, target); assert.equal(a.to, null); assert(radius(a).length > 0);
  let error; try { approve({ root, id: a.id, by, radius: radius(a) }); } catch (e) { error = e; }
  check("fully acknowledged null statement reaches late prd-invalid refusal", error?.code === "prd-invalid" && /statement.*string/.test(error.message));
  check("late save refusal leaves PRD byte-identical and no history", bytes(root).equals(before) && same(kept(root), beforeHistory) && kept(root).length === 0);
});
await withRoot({}, async tmp => {
  const root = seedProject(tmp); respond(root);
  const before = bytes(root), history = kept(root), record = snapshot(root);
  assert.throws(() => respond(root), e => e.code === "already-ruled");
  check("already-ruled answer adds no archive and changes no record bytes", bytes(root).equals(before) && same(kept(root), history) && snapshot(root) === record);
  check("successful answer preceding refused retry retains exactly one version", history.length === 1);
});
done();
