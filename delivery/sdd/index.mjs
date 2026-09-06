// owns: R2 · delivery — sdd: the binding. One writer reads the intake's work items and
// the signed design and returns, per item, how it is built, the interfaces it exposes,
// the tests that prove each criterion by id and the design controls it wires by id —
// before any code. The runner holds the set to the arithmetic SPEC §5 names (controls ⊂
// design; tests ↔ criteria; shared interfaces verbatim; a blocking question blocks) and
// files that verdict without a model when it blocks; otherwise one judge per item asks what only judgement answers,
// including the one question that never blocks: what failure class nothing here tests
// (R2 — it rides in `deferred`, never a finding). sdd never invents an interface, and it
// never decides a question the snapshot still carries: the question crosses as a question.

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
import { LEDGER } from "../state/index.mjs";
import { INTAKE_FILE } from "../intake/index.mjs";

const PROMPTS = join(dirname(fileURLToPath(import.meta.url)), "prompts");
export const GATE = "sdd";
export const SDD_FILE = join("forge", "delivery", "sdd.json");
export const VERDICT_FILE = join("forge", "delivery", "reviews", "sdd.json");
/** Checked mechanically, never the judge's to report (R10). */
export const ARITHMETIC = ["item-unbound", "item-bound-twice", "item-unknown", "control-not-in-design", "criterion-untested", "criterion-not-on-item", "scenario-unknown", "test-id-duplicate", "interface-disagrees", "interface-unshared", "question"];
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
  const doc = await write(root, ctx);
  return judgeAll(root, { ...ctx, doc });
}

/** A re-judge (R5): the standing binding judged again against a moved handoff — never a regeneration. */
export async function rejudge(root, ctx) {
  const doc = loadSdd(root);
  if (!doc) throw new Refused("no-sdd", "sdd: there is no binding to re-judge");
  return judgeAll(root, { ...ctx, doc });
}

async function write(root, { run, handoff, intake, review, onEvent, _query, _sleep }) {
  const contract = handoff.contract;
  const prior = loadSdd(root);
  const system = assemble({
    identity: identity(join(PROMPTS, "writer.md")),
    mechanics: mechanics({ kind: "writer", schema: "sdd", scope: scopeOf(contract), rulings: rulingsOf(contract), arithmetic: ARITHMETIC }),
  });
  const findings = review ? renderFindingsForAgent(review) : null;
  const prompt = [
    `## Work items\n\n${intake.work_items.map((w) => renderWorkItem(w, intake)).join("\n\n")}`,
    `## The signed design\n\n${renderDesign(handoff.design)}`,
    contract.constraints?.length ? `## Constraints\n\n${contract.constraints.map((c) => `- ${c}`).join("\n")}` : "",
    intake.questions.length ? `## Questions the snapshot still carries — not yours to decide\n\n${intake.questions.map((q) => `- ${q.id} (${q.subject ?? q.source}${q.blocking ? ", blocking" : ""}): ${q.question}`).join("\n")}` : "",
    intake.existing.mode === "brownfield" ? evidence("What the repository holds", renderExisting(intake.existing)) : "",
    prior && findings ? `## The previous binding\n\n${prior.items.map(renderItem).join("\n\n")}` : "",
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

  const doc = {
    id: `sdd-${run.id}`, meta: {},
    traces: { handoff: { version: handoff.version, content_hash: handoff.meta.content_hash }, intake: { content_hash: intake.meta.content_hash } },
    ...res.structured,
    "x-drift-checked": ["/items", "/questions"],
  };
  return saveDoc(root, SDD_FILE, "sdd", doc);
}

async function judgeAll(root, { run, handoff, intake, doc, onEvent, _query, _sleep }) {
  const judged = pins(run, handoff, intake, doc);
  const arithmetic = checkBinding(intake, handoff.design, doc);
  if (arithmetic.verdict === "block") {
    const verdict = { ...arithmetic, judged, cost: { model: "none", usd: 0, ms: 0 } };
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
  const findings = rank([...arithmetic.findings, ...judge.findings]);
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

export function renderItem(it) {
  return [
    `### ${it.work_item}`,
    `Approach: ${it.approach}`,
    `Interfaces:\n${it.interfaces.map((i) => `- \`${i.name}\`: \`${i.signature}\`${i.shared ? " (shared)" : ""}`).join("\n") || "(none)"}`,
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

// ── the arithmetic (SPEC §5): controls ⊂ design; tests ↔ criteria; shared interfaces verbatim ──

/**
 * Finding-shaped like every gate. Exactly one binding per work item and none for an item
 * the intake does not carry; every control the design's, on its screen; every criterion
 * on the item proved by a test and no test proving a criterion the item does not carry;
 * every scenario named one the item runs; test ids unique across the set; an interface
 * two items name written the same way by both, and marked shared by both. And the
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
