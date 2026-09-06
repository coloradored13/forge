// owns: R7 · shared — the one judge runner for every LLM gate, both halves. It assembles
// the prompt, calls through the chokepoint with no write surface, drops what re-raises a
// settled ruling, ranks the findings, derives the verdict, pins what was judged, and
// validates the record before returning it. Three things are never the model's: the
// verdict, the pins, and whether a ruling is open.

import { call } from "../agent-call/index.mjs";
import { outputContract, validate } from "../schema/index.mjs";
import { identity, mechanics, assemble } from "../prompt/index.mjs";
import { record } from "../funnel.mjs";
import { deriveVerdict, rank, fit } from "./verdict.mjs";
import { pin } from "./freshness.mjs";

export { deriveVerdict, rank, weight, fit, SEVERITY, CONFIDENCE, SUMMARY_MAX } from "./verdict.mjs";
export { pin, verdictFreshness } from "./freshness.mjs";
export { renderFindingsForAgent } from "./render.mjs";

const WRITES = new Set(["Write", "Edit", "NotebookEdit", "Bash"]);

/** The config role a gate bills by default, per half — must exist in models.json. */
export const JUDGE_ROLE = { discovery: "reviewer", delivery: "judge" };

/**
 * A finding re-raises a ruling when it is about the ruling itself or the question the
 * ruling answered — by id, in its subject or its text. A finding about the criterion
 * the ruling became is not a re-raise: the criterion is spec now and may be held to.
 */
export function splitReraised(findings, rulings = []) {
  const kept = [], reraised = [];
  for (const f of findings) {
    const text = [f.subject, f.rule, f.summary, f.evidence].filter(Boolean).join(" ");
    const hit = rulings.find((r) => f.subject === r.id || (r.oq && f.subject === r.oq) || new RegExp(`(?<![\\w-])${r.id}(?![\\w-])`).test(text));
    if (hit) reraised.push({ ...f, ruling: hit.id }); else kept.push(f);
  }
  return { kept, reraised };
}

/**
 * @param gate       stable gate id — what the verdict is filed under
 * @param half       discovery | delivery
 * @param stage      the stage being judged
 * @param role       the config role billed (default: Discovery reviewer, Delivery judge)
 * @param identity   path to the authored identity .md
 * @param sections   ordered [heading, body] pairs — the judge's input
 * @param artifacts  [{ id, path, doc }] — what is being judged; pinned into `judged`
 * @param scope, rulings, arithmetic   → mechanics (see shared/prompt); rulings also
 *                   filter the answer — a re-raised ruling is removed and counted (R3)
 * @param funnel     path to the project's funnel.jsonl; re-raises are recorded there (R8)
 * @param cwd, ledger, budget, models, onEvent, _query, _sleep   → agent-call
 */
export async function runJudge({
  gate, half, stage, role = JUDGE_ROLE[half],
  identity: identityPath, sections = [], artifacts = [],
  scope, rulings = [], arithmetic, funnel,
  cwd, ledger, budget, models, onEvent, _query, _sleep,
}) {
  if (!gate) throw new Error("runJudge: a gate id is required");
  const system = assemble({
    identity: identity(identityPath),
    mechanics: mechanics({ kind: half === "discovery" ? "reviewer" : "judge", schema: "finding", scope, rulings, arithmetic }),
  });
  const input = sections.map(([h, body]) => `## ${h}\n\n${body}`).join("\n\n");
  const judged = artifacts.map(pin);

  const r = await call({
    half, stage, role, kind: "judge", system, prompt: input, cwd,
    outputSchema: outputContract("finding"), ledger, budget, models, onEvent, _query, _sleep,
  });

  const wrote = r.toolUses.filter((t) => WRITES.has(t.name));
  if (wrote.length) {
    throw new Error(`${gate}: the judge used ${wrote.map((t) => t.name).join(", ")} despite having no write surface`);
  }
  if (!r.structured) throw new Error(`${gate}: the judge returned no structured output`);

  const { kept: open, reraised } = splitReraised(r.structured.findings ?? [], rulings);
  const findings = rank(open);
  if (funnel) {
    for (const f of reraised) record(funnel, { signal: "reraised", gate, rule: f.rule, subject: f.subject, ruling: f.ruling });
  }
  const verdict = {
    gate,
    verdict: deriveVerdict(findings),
    findings,
    deferred: r.structured.deferred ?? [],
    checked: r.structured.checked ?? 0,
    skipped: r.structured.skipped ?? 0,
    reraised: reraised.length,
    judged,
    cost: { model: r.model, usd: r.usd, ms: r.ms },
  };
  const v = validate("finding", verdict);
  if (!v.ok) throw new Error(`${gate}: the verdict does not validate — ${v.errors.join("; ")}`);
  return verdict;
}

/**
 * One judge call per item, merged into one stage verdict by the same rule one call
 * uses, so a stage cannot disagree with its own parts. An item whose judge failed is a
 * finding, not a silence: nothing about it has been checked. Per-item verdicts ride
 * alongside for the record.
 */
export async function runPerItemJudge({ gate, items, onEvent, ...rest }) {
  const perItem = [];
  const all = [];
  const deferred = [];
  const judged = [];
  let checked = 0, skipped = 0, reraised = 0, usd = 0, ms = 0, model = null;

  for (const item of items) {
    try {
      const v = await runJudge({ ...rest, gate, sections: item.sections, artifacts: item.artifacts ?? [], onEvent: (e) => onEvent?.(`${item.id} ${e}`) });
      perItem.push({ id: item.id, verdict: v });
      checked += v.checked; skipped += v.skipped; reraised += v.reraised; usd += v.cost.usd; ms += v.cost.ms; model ??= v.cost.model;
      all.push(...v.findings); deferred.push(...v.deferred); judged.push(...v.judged);
      onEvent?.(`${item.id} ${v.verdict} · ${v.findings.length} finding(s)`);
    } catch (e) {
      skipped++;
      all.push({
        severity: "high", confidence: "certain", rule: "judge-failed", subject: item.id,
        summary: fit(`The ${gate} gate could not judge ${item.id}: ${String(e.message).split("\n")[0]}`),
        evidence: "The judge did not run, so nothing about this item has been checked.",
        remedy: "Re-run the gate. A stage cannot be approved on items nobody judged.",
      });
    }
  }

  const findings = rank(all);
  const verdict = {
    gate, verdict: deriveVerdict(findings), findings, deferred, checked, skipped, reraised, judged,
    cost: { model: model ?? "none", usd, ms },
  };
  const v = validate("finding", verdict);
  if (!v.ok) throw new Error(`${gate}: the merged verdict does not validate — ${v.errors.join("; ")}`);
  return { verdict, items: perItem };
}
