#!/usr/bin/env node
// owns: R3, R4, R14 · shared — DH1a.2 4a: pending reactions hold stories and every exit.
import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { suite, scripted, withRoot } from "./_harness.mjs";
import { seedDelivery, put, EPICS, STORIES } from "./_fixture.mjs";
import { load, outputContract, validate } from "../shared/schema/index.mjs";
import { contentHash } from "../shared/hash.mjs";
import { loadPrd, savePrd } from "../discovery/workshop/index.mjs";
import * as doors from "../discovery/doors/index.mjs";
import { write } from "../discovery/stories/index.mjs";
import { readiness, exportHandoff, EXITS } from "../discovery/export/index.mjs";
import { Refused, readDoc, PRD_FILE, PROTOTYPE_FILE, STORIES_FILE } from "../discovery/record/index.mjs";

const { check, done } = suite("discovery-reactions · pending proposal holds the backlog", 107);
const attempt = async (fn) => { try { return { value: await fn() }; } catch (error) { return { error }; } };
const bytes = (root, file) => existsSync(join(root, file)) ? readFileSync(join(root, file), "utf8") : null;
const tree = (root, dir) => !existsSync(join(root, dir)) ? null : JSON.stringify(readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
  .filter((f) => f.isFile()).map((f) => { const path = join(f.parentPath, f.name); return [path, readFileSync(path, "utf8")]; }).sort());
const noService = () => { throw new Error("unexpected external service"); };
const reaction = (prd, proto, proposal, id = "RX-2") => ({ id, by: "PM", at: "2026-10-16T12:00:00Z", text: "Please reconsider the owner.",
  seen: { prd_hash: prd.meta.content_hash, prototype_hash: proto.meta.content_hash }, proposal, screens: ["SCREEN-1"], note: "Ownership needs a decision." });

await withRoot({}, async (parent) => {
  const { disc: root } = await seedDelivery(parent), before = loadPrd(root), prd = structuredClone(before);
  prd.reactions = [reaction(prd, readDoc(root, PROTOTYPE_FILE), null)];
  const out = await attempt(() => savePrd(root, prd));
  check("reactions is a runner-owned array omitted from model output", load("prd").properties.reactions?.type === "array"
    && load("prd").properties.reactions?.["x-runner"] === true && !outputContract("prd").properties.reactions);
  check("runner saves reactions without changing accepted content, version or agreement", !out.error && validate("prd", loadPrd(root)).ok
    && JSON.stringify(loadPrd(root).reactions) === JSON.stringify(prd.reactions) && contentHash(loadPrd(root)) === before.meta.content_hash
    && JSON.stringify(loadPrd(root).requirements) === JSON.stringify(before.requirements) && loadPrd(root).meta.version === before.meta.version
    && JSON.stringify(loadPrd(root).agreements) === JSON.stringify(before.agreements), out.error?.message);
});

for (const mode of ["new", "rewrite", "older-pending", "stale-seen", "combined", "no-line", "no-prototype", "approved", "rejected", "null"]) await withRoot({}, async (parent) => {
  const { disc: root } = await seedDelivery(parent);
  // AMD-1 stays proposed but has no reaction: only the referenced amendment may hold.
  doors.propose({ root, by: "PM", target: "/open_questions/0/owner", to: "someone else", rationale: "unrelated" });
  const { amendment } = doors.propose({ root, by: "PM", target: "/open_questions/1/owner", to: "receiving lead", rationale: "reaction" });
  if (mode === "approved") doors.approve({ root, by: "PM", id: amendment.id, radius: [] });
  if (mode === "rejected") doors.reject({ root, by: "PM", id: amendment.id, reason: "keep the owner" });
  const prd = loadPrd(root), proto = readDoc(root, PROTOTYPE_FILE);
  // Direct runner seeding keeps behavioral tests reachable before the schema exists (4b's react is deferred).
  prd.reactions = [reaction(prd, proto, null, "RX-1"), reaction(prd, proto, mode === "null" ? null : amendment.id)];
  if (mode === "older-pending") prd.reactions.push({ ...reaction(prd, proto, null, "RX-3"), at: "2026-10-16T12:01:00Z" });
  if (mode === "stale-seen") prd.reactions[1].seen = { prd_hash: "0".repeat(64), prototype_hash: "1".repeat(64) };
  if (mode === "combined") {
    prd.agreements = [];
    proto.open_questions = [{ id: "PQ-1", question: "Who decides?", blocking: true, status: "open" }];
    put(root, PROTOTYPE_FILE, JSON.stringify(proto));
  }
  if (mode === "no-line") prd.mvp = null;
  put(root, PRD_FILE, JSON.stringify(prd));
  if (mode === "no-prototype") unlinkSync(join(root, PROTOTYPE_FILE));
  if (mode === "new") unlinkSync(join(root, STORIES_FILE));
  const held = ["new", "rewrite", "older-pending", "stale-seen", "combined"].includes(mode), allowed = ["approved", "rejected", "null"].includes(mode);
  const expected = held ? "reaction-pending" : mode;
  const before = tree(root, "discovery"), q = scripted({ structured: { epics: EPICS, stories: STORIES, notes: "reaction control", open_questions: [] } });
  const out = await attempt(() => write({ root, _query: q.query }));
  check(`${mode}: write ${allowed ? "succeeds" : `refuses ${expected}`}`, allowed ? !out.error && readDoc(root, STORIES_FILE)?.notes === "reaction control"
    : out.error instanceof Refused && out.error.code === expected, out.error?.message ?? "write succeeded");
  check(`${mode}: ${allowed ? "one scripted call" : "zero calls and no Discovery writes"}`, allowed ? q.calls.length === 1
    : q.calls.length === 0 && tree(root, "discovery") === before, `calls=${q.calls.length}`);
  if (held) check(`${mode}: refusal names the reaction and its amendment`, out.error instanceof Refused
    && /\bRX-2\b/.test(out.error.message) && /\bAMD-2\b/.test(out.error.message), out.error?.message);
  if (!["new", "rewrite", "older-pending", "stale-seen", "approved", "rejected", "null"].includes(mode)) return;
  for (const exit of EXITS) {
    const ready = readiness(root, exit), f = ready.findings.find((f) => f.rule === "reaction-pending");
    check(`${mode}/${exit}: readiness ${held ? "holds with an actionable finding" : "clears"}`, held
      ? ready.verdict === "block" && f?.subject === prd.id && f.severity === "high" && f.confidence === "certain"
        && /\bapprove\b/i.test(f.remedy) && /reject/i.test(f.remedy) && f.remedy !== f.summary
      : ready.verdict !== "block" && !f, JSON.stringify(ready.findings));
    if (mode === "new") continue; // Export requires an existing backlog; rewrite covers that gate.
    const saved = bytes(root, PRD_FILE), handoffs = tree(root, "discovery/handoffs");
    const exported = await attempt(() => exportHandoff({ root, exit, by: "PM", _exec: noService, _fetch: noService, _env: {} }));
    check(`${mode}/${exit}: export ${held ? "refuses without publishing" : "succeeds"}`, held
      ? exported.error instanceof Refused && exported.error.code === "not-ready" && exported.error.detail?.some((f) => f.rule === "reaction-pending")
        && bytes(root, PRD_FILE) === saved && tree(root, "discovery/handoffs") === handoffs
      : !!exported.value, exported.error?.message);
  }
});
// Recovery follows the amendment's version/hash guard, not the reaction's seen hashes.
const unavailable = (text = "") => /(?:cannot|can't|can no longer|no longer)[^.]*approv|not approv/i.test(text);
const currentGuidance = (text = "") => /\bapprove\b/i.test(text) && /\breject\b/i.test(text) && !unavailable(text);
const staleGuidance = (text = "") => unavailable(text)
  && /reject/i.test(text) && /\b(?:re-?propose|propose\s+again)\b/i.test(text) && /current/i.test(text)
  && !/\bapprove\s+or\s+reject/i.test(text);
for (const mode of ["current", "hash-only", "version-only", "missing-prototype"]) await withRoot({}, async (parent) => {
  const { disc: root } = await seedDelivery(parent);
  const { amendment: a } = doors.propose({ root, by: "PM", target: "/open_questions/0/owner", to: "new owner", rationale: "reaction" });
  const seen = reaction(loadPrd(root), readDoc(root, PROTOTYPE_FILE), a.id, "RX-1");
  if (mode === "version-only") {
    const other = doors.propose({ root, by: "PM", target: "/open_questions/1/owner", to: "another owner", rationale: "unrelated" });
    doors.approve({ root, by: "PM", id: other.amendment.id, radius: [] });
  }
  if (mode === "hash-only") { const p = loadPrd(root); p.problem.crux += " at night"; savePrd(root, p); }
  const prd = loadPrd(root), stale = mode === "hash-only" || mode === "version-only";
  check(`${mode}: isolate the approval guard`, (a.against_version !== prd.meta.version) === (mode === "version-only")
    && (a.against_hash !== prd.meta.content_hash) === (mode === "hash-only"));
  prd.reactions = [seen]; put(root, PRD_FILE, JSON.stringify(prd));
  if (mode === "missing-prototype") unlinkSync(join(root, PROTOTYPE_FILE));
  const before = tree(root, "discovery"), q = scripted(), out = await attempt(() => write({ root, _query: q.query }));
  check(`${mode}: story refusal retains door precedence`, out.error instanceof Refused
    && out.error.code === (mode === "missing-prototype" ? "no-prototype" : "reaction-pending"));
  check(`${mode}: refused story writes nothing and calls no model`, q.calls.length === 0 && tree(root, "discovery") === before);
  if (mode !== "missing-prototype") check(`${mode}: story guidance matches available recovery`, /RX-1/.test(out.error?.message) && /AMD-1/.test(out.error?.message)
    && (stale ? staleGuidance(out.error?.message) : currentGuidance(out.error?.message)), out.error?.message);
  if (stale) {
    const approval = await attempt(() => doors.approve({ root, by: "PM", id: a.id, radius: [] }));
    check(`${mode}: approval really refuses prd-moved without writes`, approval.error instanceof Refused
      && approval.error.code === "prd-moved" && tree(root, "discovery") === before);
  }
  for (const exit of EXITS) {
    const ready = readiness(root, exit), f = ready.findings.find((f) => f.rule === "reaction-pending");
    check(`${mode}/${exit}: pending readiness survives with usable recovery`, ready.verdict === "block" && f?.subject === prd.id
      && f.severity === "high" && f.confidence === "certain" && /AMD-1/.test(f.remedy)
      && (stale ? staleGuidance(f.remedy) : currentGuidance(f.remedy)), JSON.stringify(f));
    const saved = bytes(root, PRD_FILE), handoffs = tree(root, "discovery/handoffs");
    const exported = await attempt(() => exportHandoff({ root, exit, by: "PM", _exec: noService, _fetch: noService, _env: {} }));
    check(`${mode}/${exit}: export stays refused without publishing`, exported.error instanceof Refused
      && (mode === "missing-prototype" ? exported.error.code === "no-prototype"
        : exported.error.code === "not-ready" && exported.error.detail?.some((f) => f.rule === "reaction-pending"))
      && bytes(root, PRD_FILE) === saved && tree(root, "discovery/handoffs") === handoffs);
  }
});
done();
