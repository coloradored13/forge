// owns: R1 · shared — the only place a model is invoked. Every call names its half,
// stage and role; the model comes from one config; the budget is checked before the
// call and refused at the cap (never degraded); a usage gap pauses; and one ledger row
// records model, tokens, cost and duration whether the call succeeded or not.

import { modelFor } from "./models.mjs";
import { append, spent } from "./ledger.mjs";
import { isUsageGap, withUsagePause } from "./usage-pause.mjs";

export { modelFor, roles, defaults } from "./models.mjs";
export { rows, spent, totals, estimate, standing, quote } from "./ledger.mjs";
export { withUsagePause, isUsageGap, waitMsFor } from "./usage-pause.mjs";

export const HALVES = ["discovery", "delivery"];

export class BudgetError extends Error {
  constructor({ spent, budget, half, stage, role }) {
    super(`budget: $${spent.toFixed(2)} of $${budget.toFixed(2)} spent — ${half}/${stage}/${role} refused before the model ran`);
    this.code = "budget";
    Object.assign(this, { spent, budget, half, stage, role });
  }
}

/**
 * The one tool policy per kind of agent. A judge has no write surface at all; a
 * conversant has no tools at all — an interrogator holding a Write tool is an
 * interrogator that will eventually use it (v1 chat route, kept verbatim). An extractor
 * reads a transcript it is handed and returns structured output; it too holds nothing.
 * A composer reads the record and returns a structured artifact the runner writes — it
 * sees the same surface a judge does and has no write of its own.
 */
export const TOOLS = {
  judge: { allowed: ["Read", "Glob", "Grep"], mode: "default" },
  compose: { allowed: ["Read", "Glob", "Grep"], mode: "default" },
  writer: { allowed: ["Read", "Write", "Edit", "Glob", "Grep"], mode: "acceptEdits" },
  builder: { allowed: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"], mode: "acceptEdits" },
  converse: { allowed: [], mode: "default" },
  extract: { allowed: [], mode: "default" },
};
const NEVER = ["WebFetch", "WebSearch", "Task", "NotebookEdit"];

/**
 * @param half         discovery | delivery
 * @param stage        e.g. stories, sdd
 * @param role         a key in models.json under this half: writer | reviewer | judge | workshop
 * @param kind         tool policy: judge | compose | writer | builder | converse | extract (default judge — the safe one)
 * @param system       the assembled system prompt (shared/prompt)
 * @param prompt       the input
 * @param cwd          what Read/Glob/Grep (and any writes) see
 * @param outputSchema structured-output schema, or omit for text
 * @param resume       a session id from a prior call — real multi-turn state, not a
 *                     transcript flattened into a prompt (a model shown a document about
 *                     a conversation reads it differently from the conversation)
 * @param ledger       path to the run's calls.jsonl — required; an unrecorded call is a leak
 * @param budget       usd cap read against the ledger; null = uncapped
 * @param models       per-role overrides from the run's setup
 * @param onEvent      progress lines; a silent multi-minute call is indistinguishable from a hung one
 * @param _query       test seam for the SDK's query()
 */
export async function call({
  half, stage, role, kind = "judge",
  system, prompt, cwd, outputSchema, maxTurns, resume,
  ledger, budget = null, models = {},
  onEvent, _query, _sleep,
}) {
  if (!HALVES.includes(half)) throw new Error(`call: half must be one of ${HALVES.join(", ")}, got ${half}`);
  if (!stage || !role) throw new Error("call: stage and role are required — every call is accounted");
  if (!ledger) throw new Error("call: a ledger path is required — every call is recorded");
  if (!TOOLS[kind]) throw new Error(`call: unknown kind ${kind}`);
  const model = modelFor({ half, role }, models);

  if (budget != null) {
    const used = spent(ledger);
    if (used >= budget) throw new BudgetError({ spent: used, budget, half, stage, role });
  }

  const label = `${half}/${stage}/${role}`;
  return withUsagePause(() => once({ half, stage, role, kind, model, system, prompt, cwd, outputSchema, maxTurns, resume, ledger, onEvent, _query }),
    { label, onEvent, _sleep });
}

async function once({ half, stage, role, kind, model, system, prompt, cwd, outputSchema, maxTurns, resume, ledger, onEvent, _query }) {
  const query = _query ?? (await import("@anthropic-ai/claude-agent-sdk")).query;
  const started = Date.now();
  const toolUses = [];
  let text = "", structured, result, errorKind, sessionId;

  const policy = TOOLS[kind];
  const options = {
    model,
    systemPrompt: system,
    cwd,
    tools: policy.allowed,
    allowedTools: policy.allowed,
    disallowedTools: NEVER,
    permissionMode: policy.mode,
    ...(maxTurns ? { maxTurns } : {}),
    ...(resume ? { resume } : {}),
    ...(outputSchema ? { outputFormat: { type: "json_schema", schema: outputSchema } } : {}),
  };

  try {
    for await (const msg of query({ prompt, options })) {
      if (msg.session_id) sessionId = msg.session_id;
      if (msg.type === "assistant") {
        if (msg.error) errorKind = msg.error;
        for (const b of msg.message?.content ?? []) {
          if (b.type === "tool_use") {
            toolUses.push({ name: b.name, input: b.input ?? {} });
            onEvent?.(`${b.name} ${String(b.input?.file_path ?? b.input?.command ?? b.input?.pattern ?? "").slice(0, 80)}`);
          } else if (b.type === "text" && b.text.trim()) {
            text += b.text;
            onEvent?.(`· ${b.text.trim().slice(0, 80)}`);
          }
        }
      }
      if (msg.type === "result") {
        result = msg;
        if (msg.structured_output !== undefined) structured = msg.structured_output;
        if (msg.is_error) {
          // An error result names its subtype; the detail is in `errors`, or in
          // `result` when the turn ended on an API error under a success subtype.
          const detail = (msg.errors ?? []).join("; ") || (msg.subtype === "success" ? String(msg.result ?? "") : "");
          errorKind ||= detail ? `${msg.subtype}: ${detail}` : msg.subtype;
        }
      }
    }
  } catch (e) {
    record({ ok: false, error: String(e?.message ?? e).split("\n")[0] });
    throw e;
  }

  const row = record({ ok: !errorKind, error: errorKind ? String(errorKind).split("\n")[0] : undefined });
  if (errorKind) {
    const message = `${half}/${stage}/${role} failed: ${errorKind}`;
    // A usage gap surfaces as a result error too; the pause wrapper reads the message.
    throw new Error(isUsageGap(errorKind) ? `${message} (usage limit)` : message);
  }

  return { text, structured, toolUses, sessionId, model: row.model, usd: row.usd, ms: row.ms, turns: row.turns, tokens: row.tokens };

  function record({ ok, error }) {
    const usage = Object.values(result?.modelUsage ?? {});
    const tokens = usage.length
      ? {
          input: usage.reduce((n, u) => n + (u.inputTokens ?? 0), 0),
          output: usage.reduce((n, u) => n + (u.outputTokens ?? 0), 0),
          cache_read: usage.reduce((n, u) => n + (u.cacheReadInputTokens ?? 0), 0),
          cache_create: usage.reduce((n, u) => n + (u.cacheCreationInputTokens ?? 0), 0),
        }
      : {
          input: result?.usage?.input_tokens ?? 0,
          output: result?.usage?.output_tokens ?? 0,
          cache_read: result?.usage?.cache_read_input_tokens ?? 0,
          cache_create: result?.usage?.cache_creation_input_tokens ?? 0,
        };
    return append(ledger, {
      at: new Date(started).toISOString(),
      half, stage, role, kind, model,
      ok, ...(error ? { error } : {}),
      usd: result?.total_cost_usd ?? 0,
      ms: Date.now() - started,
      turns: result?.num_turns ?? 0,
      tokens,
    });
  }
}
