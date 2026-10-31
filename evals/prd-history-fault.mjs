// owns: R3, R4, R15 · discovery — a failed history copy cannot strand a linked ruling.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { suite, withRoot, scripted } from "./_harness.mjs";
import { seedProject, seedPrototype, seedStories } from "./_fixture.mjs";
import { answer, react, approve } from "../discovery/doors/index.mjs";
import { loadPrd, PRD_FILE } from "../discovery/workshop/index.mjs";
import { readDoc, saveDoc, PROTOTYPE_FILE } from "../discovery/record/index.mjs";
const { check, done } = suite("PRD history copy failure", 8);
const bytes = (root, file) => readFileSync(join(root, file));
const by = "History PM", statement = "An exception carries the delivery and a reason.";
for (const door of ["answer", "approve"]) await withRoot({}, async tmp => {
  const root = seedProject(tmp), proto = seedPrototype(root); seedStories(root);
  proto.open_questions = [{ id: "PQ-1", question: "Who records the reason?", blocking: true, status: "open" }];
  saveDoc(root, PROTOTYPE_FILE, "prototype", proto);
  let act;
  if (door === "answer") act = () => answer({ root, by, req: "REQ-1", pq: "PQ-1", answer: statement });
  else {
    const editor = scripted({ structured: { change: { criterion: "REQ-1/AC-1", statement }, rationale: "Clarify the criterion", note: "Keep the reason." } });
    const { amendment: a } = await react({ root, by, pq: "PQ-1", text: statement,
      seen: { prd_hash: loadPrd(root).meta.content_hash, prototype_hash: proto.meta.content_hash }, _query: editor.query });
    assert.equal(editor.calls.length, 1); assert.equal(a.pq, "PQ-1");
    act = () => approve({ root, by, id: a.id, radius: [...a.radius.criteria, ...a.radius.stories, ...a.radius.screens] });
  }
  const outgoing = bytes(root, PRD_FILE), prototype = bytes(root, PROTOTYPE_FILE), version = loadPrd(root).meta.version;
  const history = join(root, "discovery/history"), key = `prd-${createHash("sha256").update(outgoing).digest("hex").slice(0, 12)}.json`, destination = join(history, key);
  // An empty directory at the exact copy destination makes writeFileSync fail even as root.
  // It is a fault fixture, not an archived JSON file; remove only this empty directory to recover.
  mkdirSync(destination, { recursive: true });
  let error; try { act(); } catch (e) { error = e; }
  check(`${door}: copy actually fails at its outgoing destination`, error?.code === "EISDIR" && error.path === destination, error?.message);
  check(`${door}: copy failure leaves both records byte-identical and no archive`, bytes(root, PRD_FILE).equals(outgoing) && bytes(root, PROTOTYPE_FILE).equals(prototype) && readdirSync(history, { withFileTypes: true }).every(e => !e.isFile()));
  rmdirSync(destination);
  let result, retryError; try { result = act(); } catch (e) { retryError = e; }
  const prd = loadPrd(root), pq = readDoc(root, PROTOTYPE_FILE).open_questions[0], ruling = prd.rulings?.[0];
  check(`${door}: retry succeeds and settles its linked question exactly once`, Boolean(result) && !retryError && prd.meta.version !== version && prd.rulings.length === 1 && ruling.pq === "PQ-1" && pq.status === "answered" && pq.ruling === ruling.id && prd.requirements[0].acceptance_criteria.some(ac => `REQ-1/${ac.id}` === ruling.criterion && ac.statement === statement) && (door !== "approve" || prd.amendments.at(-1).status === "approved"), retryError?.code);
  const files = readdirSync(history);
  check(`${door}: recovery keeps exactly one correct outgoing copy`, files.length === 1 && files[0] === key && bytes(root, `discovery/history/${key}`).equals(outgoing));
});
done();
