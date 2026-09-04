// owns: R7 · shared — the one judge runner for every LLM gate, both halves. It assembles
// the prompt, calls through the chokepoint with no write surface, cuts the findings to
// k, derives the verdict, pins what was judged, and validates the record before
// returning it. Three things are never the model's: the verdict, the cap, the pins.

import { call } from "../agent-call/index.mjs";
import { outputContract, validate } from "../schema/index.mjs";
import { identity, mechanics, assemble } from "../prompt/index.mjs";
import { deriveVerdict, rank, K_DEFAULT } from "./verdict.mjs";
import { pin } from "./freshness.mjs";

export { deriveVerdict, rank, weight, K_DEFAULT, SEVERITY, CONFIDENCE } from "./verdict.mjs";
export { pin, verdictFreshness } from "./freshness.mjs";
export { renderFindingsForAgent } from "./render.mjs";

const WRITES = new Set(["Write", "Edit", "NotebookEdit", "Bash"]);

/** The config role a gate bills by default, per half — must exist in models.json. */
export const JUDGE_ROLE = { discovery: "reviewer", delivery: "judge" };

/**
 * @param gate       stable gate id — what the verdict is filed under
 * @param half       discovery | delivery
 * @param stage      the stage being judged
 * @param role       the config role billed (default: Discovery reviewer, Delivery judge)
 * @param identity   path to the authored identity .md
 * @param sections   ordered [heading, body] pairs — the judge's input
 * @param artifacts  [{ id, path, doc }] — what is being judged; pinned into `judged`
 * @param k, scope, rulings, arithmetic   → mechanics (see shared/prompt)
 * @param cwd, ledger, budget, models, onEvent, _query, _sleep   → agent-call
 */
export async function runJudge({
  gate, half, stage, role = JUDGE_ROLE[half],
  identity: identityPath, sections = [], artifacts = [],
  k = K_DEFAULT, scope, rulings, arithmetic,
  cwd, ledger, budget, models, onEvent, _query, _sleep,
}) {
  if (!gate) throw new Error("runJudge: a gate id is required");
  const system = assemble({
    identity: identity(identityPath),
    mechanics: mechanics({ kind: half === "discovery" ? "reviewer" : "judge", schema: "finding", k, scope, rulings, arithmetic }),
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

  const { kept, dropped } = rank(r.structured.findings ?? [], k);
  const verdict = {
    gate,
    verdict: deriveVerdict(kept),
    findings: kept,
    deferred: r.structured.deferred ?? [],
    checked: r.structured.checked ?? 0,
    skipped: r.structured.skipped ?? 0,
    dropped: dropped.length,
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
export async function runPerItemJudge({ gate, items, k = K_DEFAULT, onEvent, ...rest }) {
  const perItem = [];
  const all = [];
  const deferred = [];
  const judged = [];
  let checked = 0, skipped = 0, usd = 0, ms = 0, model = null;

  for (const item of items) {
    try {
      const v = await runJudge({ ...rest, gate, k, sections: item.sections, artifacts: item.artifacts ?? [], onEvent: (e) => onEvent?.(`${item.id} ${e}`) });
      perItem.push({ id: item.id, verdict: v });
      checked += v.checked; skipped += v.skipped; usd += v.cost.usd; ms += v.cost.ms; model ??= v.cost.model;
      all.push(...v.findings); deferred.push(...v.deferred); judged.push(...v.judged);
      onEvent?.(`${item.id} ${v.verdict} · ${v.findings.length} finding(s)`);
    } catch (e) {
      skipped++;
      all.push({
        severity: "high", confidence: "certain", rule: "judge-failed", subject: item.id,
        summary: `The ${gate} gate could not judge ${item.id}: ${String(e.message).split("\n")[0]}`.slice(0, 400),
        evidence: "The judge did not run, so nothing about this item has been checked.",
        remedy: "Re-run the gate. A stage cannot be approved on items nobody judged.",
      });
    }
  }

  const { kept, dropped } = rank(all, k);
  const verdict = {
    gate, verdict: deriveVerdict(kept), findings: kept, deferred, checked, skipped, dropped: dropped.length, judged,
    cost: { model: model ?? "none", usd, ms },
  };
  const v = validate("finding", verdict);
  if (!v.ok) throw new Error(`${gate}: the merged verdict does not validate — ${v.errors.join("; ")}`);
  return { verdict, items: perItem };
}
