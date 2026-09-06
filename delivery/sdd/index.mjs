// owns: R2 · delivery — sdd: the binding. One writer reads the intake's work items and
// the signed design and returns, per item, how it is built, the interfaces it exposes,
// the tests that prove each criterion by id and the design controls it wires by id —
// before any code. The runner holds the set to the arithmetic SPEC §5 names (controls ⊂
// design; tests ↔ criteria; shared interfaces verbatim; dependencies derived and acyclic;
// a blocking question blocks) and files that verdict without a model when it blocks;
// otherwise one judge per item asks what only judgement answers,
// including the one question that never blocks: what failure class nothing here tests
// (R2 — it rides in `deferred`, never a finding). sdd never invents an interface, and it
// never decides a question the snapshot still carries: the question crosses as a question.
// A second round revises what the findings name and what a changed input touches; the rest
// is carried verbatim and held to it (revise.mjs).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { outputContract, validateAgainst } from "../../shared/schema/index.mjs";
import { identity, mechanics, assemble, evidence } from "../../shared/prompt/index.mjs";
import { call } from "../../shared/agent-call/index.mjs";
import { runPerItemJudge, deriveVerdict, rank, pin, fit, renderFindingsForAgent } from "../../shared/judge/index.mjs";
import { scopeOf } from "../../shared/scope.mjs";
import { renderDesign } from "../../shared/handoff.mjs";
import { readDoc, saveDoc, saveVerdict } from "../../shared/store.mjs";
import { Refused } from "../../shared/refused.mjs";
import { LEDGER, rounds } from "../state/index.mjs";
import { INTAKE_FILE } from "../intake/index.mjs";
import { scopeOfRevision, carry, CARRIED } from "./revise.mjs";

const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), "prompts");
export const GATE = "sdd";
export const SDD_FILE = join("forge", "delivery", "sdd.json");
export const VERDICT_FILE = join("forge", "delivery", "reviews", "sdd.json");
/** Checked mechanically, never the judge's to report (R10). */
export const ARITHMETIC = ["item-unbound", "item-bound-twice", "item-unknown", "control-not-in-design", "control-unbound", "criterion-untested", "criterion-not-on-item", "scenario-unknown", "test-id-duplicate", "interface-disagrees", "interface-unshared", "interface-from-unknown", "dependency-cycle", "question", CARRIED];
/** The `beyond` a judge writes on the one failure class nothing tests — fixed, so release can list them apart from scope deferrals. */
export const UNTESTED = "untested";
const WRITES = new Set(["Write", "Edit", "Bash", "NotebookEdit"]);

export function loadSdd(root) { return readDoc(root, SDD_FILE); }

/**
 * One round: write the binding, hold it to the arithmetic, judge what passes it. An
 * arithmetic block is filed as the round's verdict with no judge called — a binding that
 * does not add up is not worth a model's opinion (R1). Otherwise the judge's findings and
 * the arithmetic's advisories are one verdict, pinned to the handoff, the intake record
 * and the binding.
 * @param ctx  { run, handoff, intake, review, onEvent, _query, _sleep }
 *             `review` is the previous round's verdict, or null — its findings ride into the writer.
 * @returns { doc, verdict, file }
 */
export async function round(root, ctx) {
  const { doc, carried } = await write(root, ctx);
  return judgeAll(root, { ...ctx, doc, carried });
}

/** A re-judge (R5): the standing binding judged again against a moved handoff — never a regeneration. */
export async function rejudge(root, ctx) {
  const doc = loadSdd(root);
  if (!doc) throw new Refused("no-sdd", "sdd: there is no binding to re-judge");
  return judgeAll(root, { ...ctx, doc, carried: [] });
}

/**
 * Compose the binding. With a previous binding and a verdict on it, this is a revision:
 * the writer sees the previous items marked, per item, revise or carry verbatim, and the
 * runner holds it to that — what it changed without cause is restored and filed
 * (revise.mjs). A reopen (`reopened`: the human's by and reason) is a revision of every
 * item: the writer reads the reason above the previous binding and the verdict that stood
 * on it. @returns { doc, carried } — the binding on disk and the carry's findings.
 */
async function write(root, { run, handoff, intake, review, reopened = null, onEvent, _query, _sleep }) {
  const contract = handoff.contract;
  const prior = loadSdd(root);
  const system = assemble({
    identity: identity(join(PROMPTS, "writer.md")),
    mechanics: mechanics({ kind: "writer", schema: "sdd", scope: scopeOf(contract), rulings: rulingsOf(contract), arithmetic: ARITHMETIC }),
  });
  const findings = review ? renderFindingsForAgent(review) : null;
  const scope = prior && (review || reopened) ? scopeOfRevision({ prior, review, intake, priorIntake: priorIntakeOf(root, prior, intake), reopened }) : null;
  const mark = (it) => (scope.items.has(it.work_item) ? `revise: ${scope.items.get(it.work_item).join(", ")}` : "carry verbatim");
  const prompt = [
    `## Work items\n\n${intake.work_items.map((w) => renderWorkItem(w, intake)).join("\n\n")}`,
    `## ${VOCABULARY}\n\n${renderVocabulary(contract)}`,
    `## The signed design\n\n${renderDesign(handoff.design)}`,
    contract.constraints?.length ? `## Constraints\n\n${contract.constraints.map((c) => `- ${c}`).join("\n")}` : "",
    intake.questions.length ? `## Questions the snapshot still carries — not yours to decide\n\n${intake.questions.map((q) => `- ${q.id} (${q.subject ?? q.source}${q.blocking ? ", blocking" : ""}): ${q.question}`).join("\n")}` : "",
    intake.existing.mode === "brownfield" ? evidence("What the repository holds", renderExisting(intake.existing)) : "",
    reopened ? `## Why the binding is reopened\n\n${reopened.reason}\n\n— ${reopened.by}` : "",
    scope ? `## The previous binding\n\n${REVISION}${scope.all ? ` Every item is to revise: ${scope.all}.` : ""}\n\n${prior.items.map((it) => renderItem(it, mark(it))).join("\n\n")}` : "",
    findings ? `## The judge's findings on the previous binding\n\n${findings}` : "",
  ].filter(Boolean).join("\n\n");

  const res = await call({
    half: "delivery", stage: GATE, role: "writer", kind: "compose",
    system, prompt, cwd: root, outputSchema: outputContract("sdd"),
    ledger: join(root, LEDGER), budget: run.budget, models: run.models, onEvent, _query, _sleep,
  });

  const wrote = res.toolUses.filter((t) => WRITES.has(t.name));
  if (wrote.length) throw new Refused("wrote", `sdd: the writer used ${wrote.map((t) => t.name).join(", ")} — it composes, the runner writes`, wrote);
  if (res.structured === undefined) throw new Refused("no-structured-output", "sdd: the writer returned no binding");
  const v = validateAgainst(outputContract("sdd"), res.structured);
  if (!v.ok) throw new Refused("sdd-invalid", `sdd: the binding does not fit the contract — ${v.errors.slice(0, 5).join("; ")}`, v.errors);
  const { items, findings: carried } = scope ? carry(prior, res.structured, scope, intake) : { items: res.structured.items, findings: [] };

  const doc = {
    id: `sdd-${run.id}`, meta: {},
    traces: { handoff: { version: handoff.version, content_hash: handoff.meta.content_hash }, intake: { content_hash: intake.meta.content_hash } },
    ...res.structured, items,
    "x-drift-checked": ["/items", "/questions"],
  };
  return { doc: saveDoc(root, SDD_FILE, "sdd", doc), carried };
}

/** The intake the previous binding was bound against — kept with the round that filed it (R8) — or null when it is the current one or not on record. */
function priorIntakeOf(root, prior, intake) {
  const want = prior.traces?.intake?.content_hash;
  if (!want || want === intake.meta?.content_hash) return intake;
  for (const r of rounds(root, GATE)) {
    const kept = (r.kept ?? []).find((k) => k.path === INTAKE_FILE && k.content_hash === want);
    if (kept) { try { return JSON.parse(readFileSync(join(root, r.dir, kept.as), "utf8")); } catch { return null; } }
  }
  return null;
}

/** The legend the writer reads above the previous binding — the marks, not the rule (the identity holds the rule). */
const REVISION = "Each item is marked: *revise* — a finding names it or its work item changed — or *carry verbatim*.";

async function judgeAll(root, { run, handoff, intake, doc, carried = [], onEvent, _query, _sleep }) {
  const judged = pins(run, handoff, intake, doc);
  const arithmetic = checkBinding(intake, handoff.design, doc);
  if (arithmetic.verdict === "block") {
    const verdict = { ...arithmetic, findings: rank([...arithmetic.findings, ...carried]), judged, cost: { model: "none", usd: 0, ms: 0 } };
    saveVerdict(root, VERDICT_FILE, verdict);
    return { doc, verdict, file: VERDICT_FILE };
  }
  const contract = handoff.contract;
  const byId = new Map(intake.work_items.map((w) => [w.id, w]));
  const items = doc.items.map((it) => {
    const w = byId.get(it.work_item);
    const refs = new Set(w.screens.map((s) => s.screen_ref));
    const others = doc.items.filter((o) => o !== it).flatMap((o) => o.interfaces.map((i) => `- ${o.work_item} · \`${i.name}\`: \`${i.signature}\``));
    return {
      id: it.work_item,
      sections: [
        ["The work item", renderWorkItem(w, intake)],
        [VOCABULARY, renderVocabulary(contract)],
        ["The signed design — the screens this item runs on", refs.size ? renderDesign({ ...handoff.design, screens: handoff.design.screens.filter((s) => refs.has(s.screen_ref)) }) : "(this item runs on no screen)"],
        ["The binding", renderItem(it)],
        ["Interfaces the other items name", others.join("\n") || "(none)"],
        ["Questions the snapshot still carries", intake.questions.map((q) => `- ${q.id} (${q.subject ?? q.source}): ${q.question}`).join("\n") || "(none)"],
      ],
    };
  });
  const { verdict: judge } = await runPerItemJudge({
    gate: GATE, half: "delivery", stage: GATE, identity: join(PROMPTS, "judge.md"), items,
    scope: scopeOf(contract), rulings: rulingsOf(contract), arithmetic: ARITHMETIC,
    cwd: root, ledger: join(root, LEDGER), budget: run.budget, models: run.models, onEvent, _query, _sleep,
  });
  const findings = rank([...arithmetic.findings, ...carried, ...judge.findings]);
  const verdict = {
    gate: GATE, verdict: deriveVerdict(findings), findings, deferred: judge.deferred,
    checked: arithmetic.checked + judge.checked, skipped: judge.skipped, reraised: judge.reraised, judged, cost: judge.cost,
  };
  saveVerdict(root, VERDICT_FILE, verdict);
  return { doc, verdict, file: VERDICT_FILE };
}

/** What a verdict on the binding is about: the snapshot it was bound from, the intake record, the binding. */
function pins(run, handoff, intake, doc) {
  return [
    pin({ id: `handoff-v${handoff.version}`, path: run.handoff.path, doc: handoff }),
    pin({ id: intake.id, path: INTAKE_FILE, doc: intake }),
    pin({ id: doc.id, path: SDD_FILE, doc }),
  ];
}

/** The contract's rulings as mechanics takes them (R3). */
function rulingsOf(contract) {
  return (contract.rulings ?? []).map((r) => ({ id: r.id, oq: r.oq, question: r.question, answer: r.answer }));
}

// ── how the record reads to an agent ──

/** The contract's defined terms, as every Discovery writer and reviewer sees them — a word the PRD defines is not a question. */
const VOCABULARY = "Vocabulary — the contract's words";
function renderVocabulary(contract) {
  return (contract.shape?.vocabulary ?? []).map((t) => `- **${t.term}**: ${t.definition}`).join("\n") || "(none defined)";
}

export function renderWorkItem(w, intake) {
  const scenarios = new Map((intake.scenarios ?? []).map((s) => [s.id, s]));
  const parts = [
    `### ${w.id} — ${w.kind}${w.epic ? ` in ${w.epic}` : ""}`,
    w.statement,
    `Criteria:\n${w.criteria.map((c) => `- ${c.id}: ${c.statement}`).join("\n") || "(none)"}`,
    `Screens:\n${w.screens.map((s) => `- ${s.screen_ref}${s.name ? ` ${s.name}` : ""} · controls ${s.controls.map((c) => `\`${c}\``).join(", ") || "(none)"} · states ${s.states.join(", ") || "(none)"}`).join("\n") || "(none)"}`,
  ];
  const sc = w.scenarios.map((id) => scenarios.get(id)).filter(Boolean);
  if (sc.length) parts.push(`Scenarios:\n${sc.map((s) => `- ${s.id} "${s.name}" proves ${s.proves.join(", ")}\n${s.steps.map((st) => `    ${st.kind} ${st.text}`).join("\n")}`).join("\n")}`);
  return parts.join("\n\n");
}

/** One item as a reader sees it; `mark` is what the round may do with it (revise: why · carry verbatim), on the heading. */
export function renderItem(it, mark = null) {
  return [
    `### ${it.work_item}${mark ? ` — ${mark}` : ""}`,
    `Approach: ${it.approach}`,
    `Interfaces:\n${it.interfaces.map((i) => `- \`${i.name}\`: \`${i.signature}\`${i.shared ? " (shared)" : ""}${i.from ? ` · from ${i.from}` : ""}`).join("\n") || "(none)"}`,
    `Tests:\n${it.tests.map((t) => `- ${t.id} [${t.level}] proves ${t.proves.join(", ")}${t.scenario ? ` · ${t.scenario}` : ""}\n    exercises: ${t.exercises}\n    asserts: ${t.asserts}`).join("\n") || "(none)"}`,
    `Controls: ${it.controls.map((c) => `${c.screen_ref}/\`${c.control}\``).join(", ") || "(none)"}`,
    `Surface: ${it.surface.join(", ") || "(none)"}`,
    `Risks:\n${it.risks.map((r) => `- ${r}`).join("\n") || "(none)"}`,
  ].join("\n\n");
}

function renderExisting(ex) {
  const lines = [`mode: ${ex.mode}`, `files: ${ex.files}`, `top level: ${ex.top_level.join(", ") || "(none)"}`];
  if (ex.manifest) lines.push(`prior manifest at ${ex.manifest.path}: ${ex.manifest.summary.join(" · ")}`);
  return lines.join("\n");
}

// ── the arithmetic (SPEC §5): controls ⊂ design; tests ↔ criteria; shared interfaces verbatim; dependencies derived, acyclic ──

/**
 * What each item depends on, derived from the binding — never declared. Two ways: a
 * control bound on a screen the item does not run on depends on the item that runs there
 * and binds it (that item builds the control; this one's tests drive it); an interface
 * named `from` another item depends on that item (it builds the interface; this one calls
 * it). Items the intake does not carry are left out — `item-unknown` is their finding.
 * @returns { deps: Map<work_item, [{ item, via, screen_ref?, control?, name? }]> in the binding's order of the items depended on — `via` the way in words, the fields the way by id,
 *            unowned: [{ item, screen_ref, control }] foreign controls no item running there binds,
 *            unknownFrom: [{ item, name, from, why }] `from` naming no item, an item not naming the interface, or itself }
 */
export function dependenciesOf(doc, intake) {
  const work = new Map((intake.work_items ?? []).map((w) => [w.id, w]));
  const items = (doc.items ?? []).filter((it) => work.has(it.work_item));
  const at = new Map(items.map((it, i) => [it.work_item, i]));
  const runsOn = (it, ref) => work.get(it.work_item).screens.some((s) => s.screen_ref === ref);
  const binds = (it, ref, id) => it.controls.some((c) => c.screen_ref === ref && c.control === id);
  const deps = new Map(), unowned = [], unknownFrom = [];
  for (const it of items) {
    const ways = [];
    for (const c of it.controls) {
      if (runsOn(it, c.screen_ref)) continue;
      const owners = items.filter((o) => o !== it && runsOn(o, c.screen_ref) && binds(o, c.screen_ref, c.control));
      if (owners.length === 0) unowned.push({ item: it.work_item, screen_ref: c.screen_ref, control: c.control });
      for (const o of owners) ways.push({ item: o.work_item, via: `${c.screen_ref}/\`${c.control}\``, screen_ref: c.screen_ref, control: c.control });
    }
    for (const i of it.interfaces) {
      if (!i.from) continue;
      const from = (doc.items ?? []).find((o) => o.work_item === i.from);
      const why = i.from === it.work_item ? "itself" : !from ? "no item" : !from.interfaces.some((x) => x.name === i.name) ? "does not name" : null;
      if (why) { unknownFrom.push({ item: it.work_item, name: i.name, from: i.from, why }); continue; }
      if (at.has(i.from)) ways.push({ item: i.from, via: `\`${i.name}\``, name: i.name });
    }
    const seen = new Set();
    deps.set(it.work_item, ways.filter((w) => !seen.has(`${w.item} ${w.via}`) && seen.add(`${w.item} ${w.via}`)).sort((a, b) => at.get(a.item) - at.get(b.item)));
  }
  return { deps, unowned, unknownFrom };
}

/**
 * The order the build takes: each item after what it depends on, the binding's order
 * otherwise — a depth-first walk in binding order, dependencies pulled forward, everything
 * else where the writer put it. A ring has no order: `order` is null and `cycle` is the
 * ring, first item to itself. One home (R10): sdd blocks on the ring, build walks the order.
 * @returns { order: [binding item] | null, cycle: [work_item] | null }
 */
export function buildOrder(doc, intake) {
  const { deps } = dependenciesOf(doc, intake);
  const item = new Map((doc.items ?? []).map((it) => [it.work_item, it]));
  const order = [], state = new Map(), path = [];
  const visit = (id) => {
    if (state.get(id) === "done") return null;
    if (state.get(id) === "open") return [...path.slice(path.indexOf(id)), id];
    state.set(id, "open"); path.push(id);
    for (const d of deps.get(id)) { const ring = visit(d.item); if (ring) return ring; }
    path.pop(); state.set(id, "done"); order.push(item.get(id));
    return null;
  };
  for (const id of deps.keys()) { const ring = visit(id); if (ring) return { order: null, cycle: ring }; }
  return { order, cycle: null };
}

/**
 * Finding-shaped like every gate. Exactly one binding per work item and none for an item
 * the intake does not carry; every control the design's, on its screen; a control on a
 * screen the item does not run on bound by an item that does; every criterion on the item
 * proved by a test and no test proving a criterion the item does not carry; every scenario
 * named one the item runs; test ids unique across the set; an interface two items name
 * written the same way by both, and marked shared by both; an interface named `from` an
 * item that exists and names it; the dependencies those two make acyclic. And the
 * binding's own questions: one the writer marked blocking blocks the stage — a human
 * answers it in Discovery or overrides on the record; the writer cannot — and one it did
 * not advises, so it crosses as a question and never as a decision.
 */
export function checkBinding(intake, design, doc) {
  const findings = [];
  const f = (severity, rule, subject, summary, evidence, remedy) => findings.push({ severity, confidence: "certain", rule, subject, summary, evidence, remedy });
  for (const q of doc.questions ?? []) {
    const subject = q.subject ?? "binding";
    if (q.blocking) f("high", "question", subject, fit(`A blocking question on the binding: ${q.question}`), `\`/questions\` · subject ${q.subject ?? "—"} · blocking · ${q.question}`, "Answer it in Discovery and adopt the re-export, or override with the reason on record — the writer asked because it could not decide without guessing.");
    else findings.push({ severity: "low", confidence: "likely", rule: "question", subject, summary: fit(`A question on the binding: ${q.question}`), evidence: `\`/questions\` · subject ${q.subject ?? "—"} · ${q.question}`, remedy: "Carry it, or answer it in Discovery — the build reads it as a question, not a decision." });
  }
  const work = new Map((intake.work_items ?? []).map((w) => [w.id, w]));
  const screens = new Map((design.screens ?? []).map((s) => [s.screen_ref, new Set((s.controls ?? []).map((c) => c.id))]));
  const bound = new Map();
  const testIds = new Map();
  const named = new Map();

  for (const it of doc.items ?? []) {
    const w = work.get(it.work_item);
    if (!w) { f("high", "item-unknown", it.work_item, `${it.work_item} is bound but is not a work item the intake carries.`, `\`/items\` names ${it.work_item}; the intake's \`/work_items\` does not.`, "Bind the intake's work items and nothing else."); continue; }
    bound.set(it.work_item, (bound.get(it.work_item) ?? 0) + 1);
    for (const c of it.controls) {
      const on = screens.get(c.screen_ref);
      if (!on) f("high", "control-not-in-design", it.work_item, `${it.work_item} binds \`${c.control}\` on ${c.screen_ref}, a screen the signed design does not have.`, `\`/items\` ${it.work_item} controls names ${c.screen_ref}; the design's \`/screens\` has no such screen_ref.`, "Bind controls on screens the design holds.");
      else if (!on.has(c.control)) f("high", "control-not-in-design", it.work_item, `${it.work_item} binds \`${c.control}\` on ${c.screen_ref}, which the signed design does not carry.`, `${c.screen_ref} controls: ${[...on].map((x) => `\`${x}\``).join(", ") || "(none)"}; \`${c.control}\` is not among them.`, "Bind a control the design gave an id, or raise the missing control as a question — sdd never invents an interface.");
    }
    const carried = new Set(w.criteria.map((c) => c.id));
    const scenarios = new Set(w.scenarios);
    const proved = new Set();
    for (const t of it.tests) {
      const seen = testIds.get(t.id);
      if (seen && seen !== it.work_item) f("high", "test-id-duplicate", t.id, `${t.id} is used by ${seen} and ${it.work_item}.`, `\`/items\` ${seen} and ${it.work_item} both hold a test ${t.id}.`, "Test ids are one namespace across the set — QA and the manifest join on them.");
      else if (seen) f("high", "test-id-duplicate", t.id, `${t.id} appears twice on ${it.work_item}.`, `\`/items\` ${it.work_item} tests holds ${t.id} more than once.`, "One id per test.");
      testIds.set(t.id, it.work_item);
      for (const c of t.proves) {
        if (!carried.has(c)) f("high", "criterion-not-on-item", t.id, `${t.id} on ${it.work_item} proves ${c}, a criterion the item does not carry.`, `${it.work_item} criteria: ${[...carried].join(", ") || "(none)"}; ${t.id} proves ${c}.`, "A test proves its own item's criteria; a criterion on another item is that item's test.");
        else proved.add(c);
      }
      if (t.scenario && !scenarios.has(t.scenario)) f("high", "scenario-unknown", t.id, `${t.id} implements ${t.scenario}, which is not a scenario of ${it.work_item}.`, `${it.work_item} scenarios: ${[...scenarios].join(", ") || "(none)"}.`, "Name a scenario the item runs, or null.");
    }
    for (const c of carried) {
      if (!proved.has(c)) f("high", "criterion-untested", c, `${c} on ${it.work_item} has no test.`, `${c}: ${w.criteria.find((x) => x.id === c)?.statement}; no test on ${it.work_item} names it in \`proves\`.`, "Write the test that proves it — exercises and asserts — or raise in a question why it cannot be tested yet.");
    }
    for (const i of it.interfaces) {
      named.set(i.name, [...(named.get(i.name) ?? []), { item: it.work_item, signature: i.signature, shared: i.shared }]);
    }
  }
  for (const [id, n] of bound) {
    if (n > 1) f("high", "item-bound-twice", id, `${id} has ${n} bindings.`, `\`/items\` holds ${n} entries with work_item ${id}.`, "One binding per work item.");
  }
  for (const id of work.keys()) {
    if (!bound.has(id)) f("high", "item-unbound", id, `${id} is a work item and has no binding.`, `the intake's \`/work_items\` holds ${id}; \`/items\` has no entry with work_item ${id}.`, "Bind every work item — a build starts from the binding, and an item without one is built from nothing.");
  }
  const { deps, unowned, unknownFrom } = dependenciesOf(doc, intake);
  for (const u of unowned) {
    const on = screens.get(u.screen_ref);
    if (!on || !on.has(u.control)) continue; // control-not-in-design already holds it
    const there = [...work.values()].filter((w) => w.screens.some((s) => s.screen_ref === u.screen_ref)).map((w) => w.id);
    f("high", "control-unbound", u.item, `${u.item} drives \`${u.control}\` on ${u.screen_ref}, a screen it does not run on, and no item that runs there binds it — nobody builds it.`, there.length ? `${u.screen_ref} is run on by ${there.join(", ")}; none of them binds \`${u.control}\`.` : `no work item runs on ${u.screen_ref}.`, "Bind the control on the item that runs on that screen — this item's test drives it, that item's build wires it — or raise the gap as a question.");
  }
  for (const u of unknownFrom) {
    const said = u.why === "itself" ? `${u.from}, itself` : u.why === "no item" ? `${u.from}, which is not an item in the binding` : `${u.from}, which does not name \`${u.name}\``;
    f("high", "interface-from-unknown", u.item, `${u.item} names \`${u.name}\` from ${said}.`, `\`/items\` ${u.item} interfaces \`${u.name}\` from: ${u.from} · ${u.why === "no item" ? `no \`/items\` entry has work_item ${u.from}` : u.why === "itself" ? "an item does not consume its own interface" : `${u.from} interfaces: ${(doc.items.find((o) => o.work_item === u.from)?.interfaces ?? []).map((x) => `\`${x.name}\``).join(", ") || "(none)"}`}.`, "`from` names the item that builds the interface — one that exists and names it; leave `from` off the item that builds it.");
  }
  const ring = buildOrder(doc, intake).cycle;
  if (ring) {
    const way = (a, b) => deps.get(a).filter((d) => d.item === b).map((d) => d.via).join(", ");
    f("high", "dependency-cycle", ring[0], `${ring.join(" → ")}: each depends on the next; no order builds them.`, ring.slice(0, -1).map((a, i) => `${a} → ${ring[i + 1]} via ${way(a, ring[i + 1])}`).join(" · "), "Break the ring: move the driven control or the consumed interface onto one item, or split the item that holds both ends.");
  }
  for (const [name, uses] of named) {
    const signatures = new Set(uses.map((u) => u.signature));
    if (uses.length > 1 && signatures.size > 1) f("high", "interface-disagrees", name, `\`${name}\` is written ${signatures.size} ways across ${uses.map((u) => u.item).join(", ")}.`, uses.map((u) => `${u.item}: \`${u.signature}\``).join(" · "), "One signature, character for character — the arithmetic compares them verbatim.");
    for (const u of uses) {
      if (uses.length > 1 && !u.shared) f("medium", "interface-unshared", u.item, `${u.item} names \`${name}\` as its own; ${uses.filter((o) => o !== u).map((o) => o.item).join(", ")} name${uses.length > 2 ? "" : "s"} it too.`, `\`/items\` ${u.item} interfaces \`${name}\` shared: false; also named by ${uses.filter((o) => o !== u).map((o) => o.item).join(", ")}.`, "Mark it shared on every item that names it.");
      if (uses.length === 1 && u.shared) f("medium", "interface-unshared", u.item, `${u.item} marks \`${name}\` shared; no other item names it.`, `\`/items\` ${u.item} interfaces \`${name}\` shared: true; no other item's interfaces holds \`${name}\`.`, "Shared means another item names it — mark it the item's own, or name it there.");
    }
  }
  return { gate: GATE, verdict: deriveVerdict(findings), findings, deferred: [], checked: (doc.items ?? []).length + work.size + (doc.questions ?? []).length, skipped: 0 };
}
