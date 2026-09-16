#!/usr/bin/env node
// owns: R10 · shared — minimal Stage 1–3 entry point. The durable session is the
// interface contract; this
// CLI makes the loop usable before a dedicated workspace is built.

import { resolve } from "node:path";
import { derive, exportSession, interviewTurn, loadSession, openSession, react } from "../discovery/interview/index.mjs";

const [command = "status", ...args] = process.argv.slice(2);
const rootAt = args.indexOf("--root");
const root = resolve(rootAt >= 0 ? args[rootAt + 1] : ".");
const clean = rootAt >= 0 ? [...args.slice(0, rootAt), ...args.slice(rootAt + 2)] : args;
const text = clean.join(" ").trim();

try {
  if (command === "start") {
    if (!text) fail(`Usage: npm run interview -- start "what you are considering building" [--root path]`);
    const s = openSession({ root, seed: text });
    console.log(`${s.opening}\n\nCaptured: ${s.transcript[0].text}\nPhase: defining`);
  } else if (command === "turn") {
    if (!text) fail(`Usage: npm run interview -- turn "your answer" [--root path]`);
    showTurn(await interviewTurn({ root, text }));
  } else if (["defend", "workshop", "flag", "correct"].includes(command)) {
    if (!text) fail(`Usage: npm run interview -- ${command} "your answer" [--root path]`);
    showTurn(await interviewTurn({ root, text, action: command }));
  } else if (command === "derive") {
    const s = loadSession(root);
    console.log(`Longer operation: 1 planned model call will examine record v${s.record.version} for rules, definitions, edge cases, behavior, measures, and thresholds.`);
    const round = await derive({ root });
    console.log(JSON.stringify(round, null, 2));
  } else if (command === "react") {
    const [roundId, consequenceId, reaction, ...correction] = clean;
    if (!roundId || !consequenceId || !reaction) fail("Usage: npm run interview -- react ROUND CONSEQUENCE confirm|change|reject|unresolved [correction] [--root path]");
    console.log(JSON.stringify(react({ root, roundId, consequenceId, reaction, correction: correction.join(" ") }), null, 2));
  } else if (command === "export") {
    console.log(JSON.stringify(exportSession({ root }), null, 2));
  } else if (command === "status") {
    const s = loadSession(root);
    console.log(JSON.stringify({ id: s.id, phase: s.phase, record_version: s.record.version, pending: s.pending.length, turns: s.turns.length, active_craft: s.active_craft, derivations: s.derivations.length, last_turn: s.turns.at(-1) ?? null }, null, 2));
  } else fail(`Unknown interview command: ${command}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

function showTurn(out) {
  console.log(`[${out.posture}] ${out.reason}\n\n${out.text}\n\nActions: defend · workshop · flag · correct\n${out.telemetry.ms}ms · ${out.telemetry.calls} model call${out.telemetry.calls === 1 ? "" : "s"}`);
}

function fail(message) { throw new Error(message); }
