// owns: R1, R14 · shared — the only place a model is invoked. Every call names its half,
// stage and role; the model comes from one config; the budget is checked before the
// call and refused at the cap (never degraded); a usage gap pauses; and the ledger
// records model, tokens, cost, duration and every tool use whether the call succeeded
// or not — a started row before the model runs, so a call the process died inside of
// is on the record as unfinished. The seam is drawn here too (R14): a Delivery agent
// runs sandboxed with the record fenced — discovery/ denied to it outright, forge/
// denied to its writes — at its cwd and at the project root when the cwd is a worktree
// of it; a tool use that reached in anyway is a refusal with the row as proof, like a
// judge's write. That is containment of the record, and it is what this file enforces;
// containing what a builder may change in the product is delivery/build's, against the
// sdd's surface. Every agent's environment is an allowlist (PASSED), so the pipeline's
// own credentials never reach one.

import { randomUUID } from "node:crypto";
import { isAbsolute, resolve, sep } from "node:path";
import { Refused } from "../refused.mjs";
import { modelFor } from "./models.mjs";
import { append, spent } from "./ledger.mjs";
import { isUsageGap, withUsagePause } from "./usage-pause.mjs";

export { modelFor, roles, defaults } from "./models.mjs";
export { rows, spent, totals, estimate, standing, quote, tally } from "./ledger.mjs";
export { withUsagePause, isUsageGap, waitMsFor, singleAttempt } from "./usage-pause.mjs";

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
 * The environment an agent runs in — the shape of a working shell, named one variable at
 * a time. A denylist would be a claim about what the shell holds that no one can keep: an
 * ssh agent socket, a Kaggle token, the parent session's messaging token were all in the
 * shell the first real calls ran from. So the list says what passes; what it does not
 * name does not. HOME carries the CLI's own sign-in (its config and keychain), PATH
 * carries `node` — an agent that cannot find `node` is not contained, it is broken.
 * CLAUDE_CONFIG_DIR is a locator the CLI honours when set. A model API key is not on
 * the list: the pipeline signs in through the CLI, and a key in a builder's shell is a
 * decision to take when a run needs one.
 */
export const PASSED = ["HOME", "PATH", "TMPDIR", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "TERM", "CLAUDE_CONFIG_DIR"];
/**
 * Credentials the pipeline holds for its own doors (a tracker export, a release) and no
 * agent has any business with. Not a filter — the allowlist is — but the names the seam
 * eval proves are never on it, so a future edit to PASSED cannot let one through quietly.
 */
export const HELD_BACK = ["JIRA_EMAIL", "JIRA_API_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"];
const environment = () => Object.fromEntries(PASSED.filter((k) => k in process.env).map((k) => [k, process.env[k]]));
/** What no Delivery agent reads: the seam is a snapshot it was handed, not a directory it opens. */
const CONTAINED = "discovery";
/** What no Delivery agent writes: the pipeline's record, which the runner writes from what an agent returns. */
const RECORD = "forge";
/**
 * Where a builder's shell may reach: the package registry and the browser binaries a
 * product's tests install, and its own ports. What the sandbox does with a domain off
 * this list is the sandbox's default, not a strictness this file claims.
 */
const BUILDER_NETWORK = { allowedDomains: ["registry.npmjs.org", "registry.yarnpkg.com", "playwright.azureedge.net", "cdn.playwright.dev"], allowLocalBinding: true };

/**
 * @param half         discovery | delivery
 * @param stage        e.g. stories, sdd
 * @param role         a key in models.json under this half: writer | reviewer | judge | workshop
 * @param kind         tool policy: judge | compose | writer | builder | converse | extract (default judge — the safe one)
 * @param system       the assembled system prompt (shared/prompt)
 * @param prompt       the input
 * @param cwd          what Read/Glob/Grep (and any writes) see
 * @param root         the project root when cwd is a worktree of it (default cwd) — the
 *                     record is fenced at both, since a worktree's git dir points home
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
  system, prompt, cwd, root = cwd, outputSchema, maxTurns, resume,
  ledger, budget = null, models = {},
  onEvent, _query, _sleep,
}) {
  if (!HALVES.includes(half)) throw new Error(`call: half must be one of ${HALVES.join(", ")}, got ${half}`);
  if (!stage || !role) throw new Error("call: stage and role are required — every call is accounted");
  if (!ledger) throw new Error("call: a ledger path is required — every call is recorded");
  if (!TOOLS[kind]) throw new Error(`call: unknown kind ${kind}`);
  if (half === "delivery" && !cwd) throw new Error("call: a Delivery call names its cwd — containment is drawn around it");
  const model = modelFor({ half, role }, models);

  if (budget != null) {
    const used = spent(ledger);
    if (used >= budget) throw new BudgetError({ spent: used, budget, half, stage, role });
  }

  const label = `${half}/${stage}/${role}`;
  return withUsagePause(() => once({ half, stage, role, kind, model, system, prompt, cwd, root, outputSchema, maxTurns, resume, ledger, onEvent, _query }),
    { label, onEvent, _sleep });
}

async function once({ half, stage, role, kind, model, system, prompt, cwd, root, outputSchema, maxTurns, resume, ledger, onEvent, _query }) {
  const query = _query ?? (await import("@anthropic-ai/claude-agent-sdk")).query;
  const started = Date.now();
  const toolUses = [];
  let text = "", structured, result, errorKind, sessionId;

  const policy = TOOLS[kind];
  const fence = half === "delivery" ? fences(cwd, root) : null;
  const options = {
    model,
    systemPrompt: system,
    cwd,
    // SDK isolation: omitted, the SDK loads the operator's settings, CLAUDE.md, hooks and
    // every configured MCP server under the identity — the first real call carried 44k
    // tokens of them. An agent sees what the pipeline assembled and nothing else.
    settingSources: [],
    strictMcpConfig: true,
    tools: policy.allowed,
    allowedTools: policy.allowed,
    disallowedTools: NEVER,
    permissionMode: policy.mode,
    // The environment an agent gets is the allowlist and nothing else. Passed explicitly:
    // omitted, the SDK inherits process.env whole; passed, it is the whole environment.
    env: environment(),
    ...(fence ? containment(fence, kind) : {}),
    ...(maxTurns ? { maxTurns } : {}),
    ...(resume ? { resume } : {}),
    ...(outputSchema ? { outputFormat: { type: "json_schema", schema: outputSchema } } : {}),
  };

  // On the record before the model runs: a process killed inside the call leaves this
  // row, and the ledger reads it as a call whose outcome is unknown — never as nothing.
  const id = randomUUID();
  append(ledger, { call: id, at: new Date(started).toISOString(), half, stage, role, kind, model, ok: null });

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

  // Containment, after the fact: the sandbox refused the access before it happened; this
  // is the chokepoint saying so on the record and refusing the call — a Delivery agent
  // that reached for the record did not do the work it was given.
  const breach = fence ? toolUses.find((t) => touches(t, cwd, fence)) : null;
  if (breach) errorKind = `containment: ${breach.name} ${targetOf(breach.input)}`;

  const row = record({ ok: !errorKind, error: errorKind ? String(errorKind).split("\n")[0] : undefined });
  if (breach) {
    throw new Refused("containment", `${half}/${stage}/${role}: ${breach.name} touched ${targetOf(breach.input)} — Delivery reads the handoff through its prompt, never ${CONTAINED}/, and the runner writes ${RECORD}/ (R14)`, { tools: row.tools });
  }
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
      call: id,
      at: new Date(started).toISOString(),
      half, stage, role, kind, model,
      ok, ...(error ? { error } : {}),
      usd: result?.total_cost_usd ?? 0,
      ms: Date.now() - started,
      turns: result?.num_turns ?? 0,
      tokens,
      tools: toolUses.map((t) => ({ name: t.name, target: targetOf(t.input) })),
    });
  }
}

/**
 * The record's directories as absolute paths at the cwd and at the root — the same
 * directory once when they coincide. `read` is what no Delivery agent opens; `write` is
 * what none changes, which includes everything in `read`.
 */
function fences(cwd, root) {
  const at = (name) => [...new Set([resolve(cwd, name), resolve(root, name)])];
  const read = at(CONTAINED);
  return { read, write: [...read, ...at(RECORD)] };
}

/**
 * The SDK's side of the seam, set before the model runs: the sandbox denies the fenced
 * directories to every command — reads of discovery/, writes of both — and refuses to
 * start if it cannot be had (a run that degrades to unsandboxed is the v1 fusion by
 * accident); the Read, Edit and Write tools are denied the same paths by permission
 * rule, which is what governs them. A builder's shell also gets the network it needs to
 * install; every other kind gets the sandbox's default.
 */
function containment({ read, write }, kind) {
  const rule = (tool, dir) => `${tool}(/${dir}/**)`;
  return {
    sandbox: {
      enabled: true, failIfUnavailable: true,
      filesystem: { denyRead: read, denyWrite: write },
      ...(kind === "builder" ? { network: BUILDER_NETWORK } : {}),
    },
    settings: { permissions: { deny: [...read.map((d) => rule("Read", d)), ...write.flatMap((d) => [rule("Edit", d), rule("Write", d)])] } },
  };
}

/** The one string a tool use is about, for the row and the event line. */
function targetOf(input = {}) {
  const v = [input.file_path, input.notebook_path, input.command, input.path, input.pattern].find((x) => typeof x === "string" && x.trim());
  return v ? v.slice(0, 160) : "";
}

const WRITERS = new Set(["Write", "Edit", "NotebookEdit"]);

/**
 * Did this tool use reach into a fence? File paths are resolved against the cwd; a shell
 * line is split into tokens and any token that is a path — it carries a separator — is
 * resolved the same way. Every tool is held to the read fence. The write fence is held
 * on the tools that write by path — a shell line that names forge/ may be reading it,
 * and a redirect into it is the sandbox's to refuse, not this line's to guess. A bare
 * word is not a path: `--grep discovery` is not a read, and `ls discovery` is the
 * sandbox's to refuse.
 */
function touches({ name, input = {} }, cwd, { read, write }) {
  const paths = [input.file_path, input.notebook_path, input.path].filter((p) => typeof p === "string" && p.trim());
  if (typeof input.command === "string") {
    for (const tok of input.command.split(/\s+/)) {
      const bare = tok.replace(/^["']+|["']+$/g, "");
      if (bare.includes("/")) paths.push(bare);
    }
  }
  const fenced = WRITERS.has(name) ? write : read;
  return paths.some((p) => {
    const abs = isAbsolute(p) ? p : resolve(cwd, p);
    return fenced.some((dir) => abs === dir || abs.startsWith(`${dir}${sep}`));
  });
}
