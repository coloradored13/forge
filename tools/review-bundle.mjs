#!/usr/bin/env node
// owns: R15 · shared — the falsification bundle: everything an outside reviewer needs to
// attack this architecture, and nothing that would tell them what to think about it.
//
// The directive asks for review "without the accumulated defense of current design
// decisions", and that constrains what may go in. The spec, the registry, the source, the
// evals and one real run's evidence — all of it. The reasoning behind any decision, the
// defects we already know about, the questions we are already arguing with ourselves
// about: none of it. A reviewer told where to look has been steered, and a reviewer who
// independently finds what we found is worth ten who agree with a briefing.
//
//   node tools/review-bundle.mjs           # writes the bundle beside the repo
//   node tools/review-bundle.mjs --out DIR
//
// Two files, because the evals are larger than everything else together and reviewers
// read them for a different purpose: the architecture first, then whether its own tests
// could ever have caught the architecture being wrong.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEXT = new Set([".mjs", ".js", ".json", ".md"]);
const SOURCE = ["shared", "discovery", "delivery", "tools"];
// This generator is not part of the architecture under review, and putting its brief
// inside the source it bundles would hand a reviewer the framing twice.
const SKIP = /node_modules|\.git|\.worktrees|review-bundle\.mjs/;

const git = (args) => { try { return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return "(unknown)"; } };

function files(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const p = join(d, e.name);
      if (SKIP.test(p)) continue;
      if (e.isDirectory()) walk(p);
      else if (TEXT.has(extname(e.name))) out.push(p);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

const fence = (p) => {
  const rel = relative(ROOT, p);
  const lang = extname(p).slice(1).replace("mjs", "js");
  return `### \`${rel}\`\n\n\`\`\`${lang}\n${readFileSync(p, "utf8")}\n\`\`\`\n`;
};

const COMMIT = git(["rev-parse", "HEAD"]);
const SHORT = COMMIT.slice(0, 7);

const BRIEF = `# Falsification review — Forge v2, round two

You are reviewing a software architecture. **Your job is to falsify it, not to improve it.**
Do not propose features. Do not suggest refactors. Do not comment on style.

You are being given the specification, the repository, its test suites, and evidence from
one real run. You are deliberately **not** being given the development team's reasoning for
any decision, nor any list of defects they already know about. If a design looks
intentional, that is not evidence that it is sound. If a mechanism looks carefully
justified in a comment, the comment is part of what you are auditing, not a reason to move on.

---

## The claim under test

> Given a signed handoff — a product contract a human approved — agents can build the
> product without the human reading every line of code, and the system produces enough
> independent evidence that the human can rationally trust the result.

Everything here exists to support that claim. Find the places where the evidence does not
actually support it: where a chain of checks can report success while the underlying claim
is false.

---

## What is new since the last round

Stated as fact, without argument for any of it:

- A **release** stage now exists. It writes a provenance manifest into the product's own
  repository with a vendored verifier beside it, and its verdict is whether that verifier
  passes in a fresh clone.
- A verdict's findings can name the stage that must redo the work, and the loop acts on it.
- A builder can report that an item already **stands** rather than being built.
- Per-item judgements carry forward under conditions; those conditions changed.
- The round cap and the doors around it changed.
- The pipeline has been run end to end against one product, which reached release.

---

## Attack these specifically

For each, either construct a concrete failure or say plainly that you could not.

1. **The release manifest and its verifier.** The manifest claims to let a reader trust the
   product without reading it. Find what it can assert that it has not earned — a check
   that passes over a product that does not do what the contract says, a pin that does not
   pin, a chain link that is decorative. The verifier is vendored into the product's repo
   and re-derives what it can from the repository alone; find what it implies it has
   checked and has not.

2. **Refusals, silences and the difference between them.** Agents in this system can
   decline to do work. Find every place an agent's correct refusal is indistinguishable,
   to the runner, from a failure — or from having done nothing at all — and say what the
   consequence is.

3. **Carry-forward.** Judgements and built items are sometimes reused rather than redone,
   under stated conditions. Attack the conditions: construct a case where something is
   carried that should have been redone, and one where the record cannot afterwards tell
   which happened.

4. **Doors and counters.** Rounds are capped, caps are escalated past with a reason, stages
   are stopped, reopened and re-judged. Find a sequence of legal transitions that gets more
   rounds, or a different outcome, than the rules intend — and one where the record cannot
   distinguish an honest use from an abuse.

5. **Self-confirming evals.** \`evals/\` is in the second file. Find suites that would pass
   whether or not the property they claim to test actually holds: tests written against the
   implementation's behaviour rather than against the rule, assertions that cannot fail,
   counts with no denominator, fixtures that make the tested case unreachable.

6. **Assumptions from one product.** This architecture has been exercised against exactly
   one product, greenfield, in JavaScript, with a browser and a unit suite. Identify
   mechanisms whose correctness depends on properties of that product rather than on
   anything general — and say what a second, materially different product would break.

7. **Prose as control-plane data.** Find places where free text produced by a model is
   parsed, matched, or otherwise used to make an execution decision.

8. **Correlated writer, judge and test.** Every agent role runs on the same model family.
   Find places where the writer's misunderstanding and the judge's check would fail in the
   same direction, so the check cannot catch the error.

9. **Economics as a correctness surface.** The run evidence below includes what the run
   cost, by stage and by role. Find where the design's cost shape would push an operator
   toward turning off a check, and whether anything stops them.

---

## How to report

For each finding: **the claim it falsifies**, **the concrete path** (file, function, the
sequence of events), **what a reader of the evidence would wrongly believe**, and **how
you would demonstrate it**. Rank by whether the chain can report success while the claim
is false — that class first, everything else after.

If you cannot falsify something you expected to, say so explicitly. A reviewer who reports
only findings is indistinguishable from one that found nothing and said something anyway.

---

Repository at commit \`${COMMIT}\`.
`;

const SAMPLE = 15;
/** Every undischarged row, then enough discharged ones to make the shape legible. */
function sampled(chain) {
  const short = chain.filter((c) => !c.discharged);
  for (const c of chain) { if (short.length >= SAMPLE) break; if (c.discharged) short.push(c); }
  return short;
}

function evidence() {
  const bake = process.env.FORGE_RUN_ROOT ?? join(process.env.HOME ?? "", "Forge", "bakehouse");
  const read = (p) => { try { return JSON.parse(readFileSync(join(bake, p), "utf8")); } catch { return null; } };
  const m = read("forge/manifest.json");
  const run = read("forge/run.json");
  if (!m || !run) return "## Run evidence\n\n(no run record found)\n";

  const ledger = (p) => { try { return readFileSync(join(bake, p), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.usd != null); } catch { return []; } };
  const d = ledger("forge/delivery/calls.jsonl"), dis = ledger("forge/discovery/calls.jsonl");
  const byStage = {}, byRole = {};
  for (const r of d) { byStage[r.stage] = (byStage[r.stage] ?? 0) + r.usd; byRole[r.role] = (byRole[r.role] ?? 0) + r.usd; }
  const sum = (a) => a.reduce((n, r) => n + r.usd, 0).toFixed(2);

  return [
    "## Run evidence — one product, start to release",
    "",
    "The manifest the product carries in its own repository, the run record that produced it,",
    "and what it cost. The manifest is the artifact the trust claim rests on: read it as a",
    "reader of the shipped repo would, with no access to anything else here.",
    "",
    `- criteria: **${m.chain.length}**, discharged **${m.chain.filter((c) => c.discharged).length}**`,
    `- work items: **${new Set(m.chain.map((c) => c.work_item)).size}** · tests **${new Set(m.chain.flatMap((c) => c.tests.map((t) => t.id))).size}** · commits credited **${[...new Set(m.chain.flatMap((c) => c.commits))].length}**`,
    `- advisories on the manifest: **${m.advisories.length}** · deferrals **${m.deferrals.length}** · pins **${m.pins.length}**`,
    `- stage verdicts: ${m.verdicts.map((v) => `${v.gate} ${v.verdict}`).join(" · ")}`,
    `- rounds: ${Object.entries(run.stages).map(([k, v]) => `${k} ${v.status}/${v.round}`).join(" · ")}`,
    `- human interventions on the record: **${run.flags.length}** flags — ${Object.entries(run.flags.reduce((a, f) => (a[f.event] = (a[f.event] ?? 0) + 1, a), {})).map(([k, v]) => `${k} ${v}`).join(", ")}; **${run.flags.filter((f) => f.override).length}** overrode a guard`,
    `- cost: Delivery **$${sum(d)}** over ${d.length} calls · Discovery **$${sum(dis)}** over ${dis.length}`,
    `  - by stage: ${Object.entries(byStage).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} $${v.toFixed(2)}`).join(" · ")}`,
    `  - by role: ${Object.entries(byRole).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} $${v.toFixed(2)}`).join(" · ")}`,
    "",
    "### The manifest as shipped",
    "",
    `Every field, with the criterion chain sampled: ${sampled(m.chain).length} of ${m.chain.length} rows, chosen to`,
    "include every row the release does not claim to have discharged. The elided rows differ",
    "only in their ids and statements — if the sample cannot be attacked, the rest will not help.",
    "",
    "```json",
    JSON.stringify({ ...m, chain: sampled(m.chain) }, null, 1),
    "```",
    "",
    "### The run record",
    "",
    "```json",
    JSON.stringify(run, null, 1),
    "```",
    "",
  ].join("\n");
}

const out = (() => {
  const i = process.argv.indexOf("--out");
  return i > 0 ? process.argv[i + 1] : join(process.env.HOME ?? ".", "Downloads");
})();
mkdirSync(out, { recursive: true });

const spec = ["## The specification", "", "### `SPEC.md`", "", readFileSync(join(ROOT, "SPEC.md"), "utf8"), "",
  "### `shared/rules.json`", "", "```json", readFileSync(join(ROOT, "shared", "rules.json"), "utf8"), "```", ""].join("\n");

const source = ["## The source", ""].concat(SOURCE.flatMap((d) => files(join(ROOT, d))).map(fence)).join("\n");
const one = [BRIEF, "---", "", spec, "---", "", evidence(), "---", "", source].join("\n");

const evals = [
  `# Falsification review — Forge v2, round two · the test suites`,
  "",
  "The second half of the bundle. Attack vector 5 is the point of this file: these suites",
  "are what the architecture offers as proof that its own rules hold. Find the ones that",
  "would pass whether or not the rule holds.",
  "",
  `Repository at commit \`${COMMIT}\`.`,
  "",
  "---",
  "",
].concat(files(join(ROOT, "evals")).map(fence)).join("\n");

const a = join(out, `forge-review-2-${SHORT}.md`);
const b = join(out, `forge-review-2-${SHORT}-evals.md`);
writeFileSync(a, one);
writeFileSync(b, evals);

const kb = (s) => `${Math.round(s / 1024)}KB`;
process.stdout.write(`${a}  ${kb(statSync(a).size)}\n${b}  ${kb(statSync(b).size)}\n\ncommit ${COMMIT}\n`);
