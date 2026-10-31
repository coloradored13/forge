// owns: R1, R10, R15 · shared — unknown spend is not a free call.
import { isDeepStrictEqual as equal } from "node:util";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { suite, withRoot } from "./_harness.mjs";
import { seedProject, seedDelivery } from "./_fixture.mjs";
import { call, rows, tally, totals, estimate, quote } from "../shared/agent-call/index.mjs";
import { append } from "../shared/agent-call/ledger.mjs";
import { routes } from "../discovery/console/index.mjs";
import { quoteStrip } from "../shared/console/index.mjs";
import { exportHandoff } from "../discovery/export/index.mjs";
import { validate } from "../shared/schema/index.mjs";

const { check, done } = suite("honest spend · unknown is not zero", 28);
const identity = { half: "discovery", stage: "workshop", role: "workshop", model: "claude-opus-5" };
const result = { type: "result", subtype: "success", is_error: false };
const ledgerAt = root => join(root, "forge/discovery/calls.jsonl");

// Deliberately bypass scripted(): it supplies a result and defaults missing cost.
for (const [name, messages, failure, usd, unknown] of [
  ["throw before result", [], "stream broke", 0, true],
  ["clean EOF without result", [{ type: "assistant", message: { content: [{ type: "text", text: "partial" }] } }], null, 0, true],
  ["result with omitted cost", [result], null, 0, true],
  ["result with null cost", [{ ...result, total_cost_usd: null }], null, 0, true],
  ["genuine zero", [{ ...result, total_cost_usd: 0 }], null, 0, false],
  ["error result with cost", [{ ...result, is_error: true, errors: ["model failed"], total_cost_usd: 0.25 }], null, 0.25, false],
  ["known cost followed by throw", [{ ...result, total_cost_usd: 0.5 }], "late stream failure", 0.5, false],
]) {
  await withRoot({}, async root => {
    const ledger = ledgerAt(root);
    const _query = () => (async function* () { yield* messages; if (failure) throw new Error(failure); })();
    let error;
    try { await call({ ...identity, kind: "converse", system: "s", prompt: "p", cwd: root, ledger, _query }); }
    catch (e) { error = e; }
    const raw = readFileSync(ledger, "utf8").trim().split("\n").map(JSON.parse);
    const [row] = rows(ledger);
    const failed = Boolean(failure || messages.some(m => m.is_error));
    check(`${name}: one closed call replaces its start, with the original success/error semantics`,
      raw.length === 2 && raw[0].ok === null && !("usd" in raw[0]) && raw[0].call === row.call &&
      rows(ledger).length === 1 && row.ok === !failed && Boolean(error) === failed &&
      (failed ? row.error.includes(failure ?? "model failed") : !("error" in row)), JSON.stringify(row));
    check(`${name}: ${unknown ? "unreported cost is explicitly unknown" : "reported cost stays known, with no unknown flag"}`,
      row.usd === usd && (unknown ? row.usd_unknown === true : !("usd_unknown" in row)), JSON.stringify(row));
  });
}

await withRoot({}, root => {
  const ledger = ledgerAt(root);
  const add = row => append(ledger, { ...identity, ...row });
  add({ call: "closed", ok: null });
  add({ call: "closed", ok: true, usd: 1 });
  add({ call: "unknown", ok: null });
  add({ call: "unknown", ok: true, usd: 0, usd_unknown: true });
  add({ ok: true, usd: 0 }); // legacy known zero, no call id
  add({ call: "failed", ok: false, usd: 0.25 });
  add({ call: "failed-unknown", ok: false, usd: 0, usd_unknown: true });
  add({ call: "open", ok: null });
  add({ call: "open-unknown", ok: null, usd_unknown: true });
  const list = rows(ledger), count = tally(list), grouped = totals(ledger, ["stage"]).workshop;
  check("starts and outcomes coalesce in start order; legacy rows and open calls survive",
    list.length === 7 && list[0].call === "closed" && list[0].ok === true && list[1].call === "unknown" && !list[2].call);
  check("tally counts open plus flagged once, including failed unknowns; spend and unfinished stay unchanged",
    equal(count, { calls: 7, usd: 1.25, unfinished: 2, unknown: 4 }), JSON.stringify(count));
  check("grouped totals count the same four unknown calls without changing prior fields",
    equal(grouped, { calls: 7, usd: 1.25, unfinished: 2, unknown: 4, ms: 0, tokens: { input: 0, output: 0, cache_read: 0, cache_create: 0 } }), JSON.stringify(grouped));
  check("estimates exclude failures, open calls and unknown successes but retain genuine zero",
    equal(estimate(ledger, identity), { usd: 0.5, n: 2, basis: "history" }), JSON.stringify(estimate(ledger, identity)));
  add({ half: "delivery", stage: "build", ok: true, usd: 2 });
  const halves = totals(ledger, ["half"]);
  check("unknown counts stay in their own group; known-only groups explicitly report zero",
    halves.discovery.unknown === 4 && halves.discovery.calls === 7 && halves.discovery.usd === 1.25 &&
    halves.delivery.unknown === 0 && halves.delivery.calls === 1 && halves.delivery.usd === 2 && halves.delivery.unfinished === 0, JSON.stringify(halves));
  check("an empty tally explicitly reports zero unknowns", equal(tally([]), { calls: 0, usd: 0, unfinished: 0, unknown: 0 }));
});

await withRoot({}, root => {
  const ledger = ledgerAt(root);
  append(ledger, { ...identity, ok: true, usd: 0, usd_unknown: true });
  check("all-unknown success history is no history, never a zero-dollar estimate",
    equal(estimate(ledger, identity), { usd: null, n: 0, basis: "none" }), JSON.stringify(estimate(ledger, identity)));
  append(ledger, { ...identity, ok: true, usd: 1 });
  check("a known $1 success plus an unknown success estimates $1, not $0.50",
    equal(estimate(ledger, identity), { usd: 1, n: 1, basis: "history" }), JSON.stringify(estimate(ledger, identity)));
});

await withRoot({}, async parent => {
  const root = seedProject(parent), ledger = ledgerAt(root);
  const board = async () => (await routes({ root }).find(r => r.method === "GET" && r.path === "/board").handler()).body;
  const strip = () => quoteStrip(quote(ledger, { ...identity, budget: 5 }));
  append(ledger, { ...identity, ok: true, usd: 1 });
  const knownBoard = await board();
  check("known-cost board line is byte-identical and has no unknown disclosure",
    knownBoard.includes('<p class="quote">$1.00 · 1 calls</p>') && !knownBoard.includes("unknown cost"));
  check("known-cost quote strip is byte-identical",
    strip() === '<p class="quote">~$1.00 a call (1 so far) · $1.00 of $5.00 spent · $4.00 remains</p>', strip());
  append(ledger, { ...identity, ok: true, usd: 0, usd_unknown: true });
  append(ledger, { ...identity, call: "open", ok: null, usd_unknown: true });
  const unknownBoard = await board(), unknownStrip = strip();
  const costLine = unknownBoard.match(/<h2>Cost<\/h2><p[^>]*>([\s\S]*?)<\/p>/)?.[1].replace(/<[^>]*>/g, "");
  check("board cost line discloses two unknown calls without inventing spend or double-counting the open call",
    costLine?.includes("$1.00") && costLine.includes("3 calls") && costLine.includes("2 calls of unknown cost") && !costLine.includes("3 calls of unknown cost"));
  check("the actual pre-trigger quote pipeline discloses unknown calls and keeps the known estimate",
    unknownStrip.includes("2 calls of unknown cost") && unknownStrip.includes("~$1.00 a call (1 so far)") && !unknownStrip.includes("$0.50"), unknownStrip);
});

await withRoot({}, async parent => {
  const { disc } = await seedDelivery(parent);
  const ledger = ledgerAt(disc);
  const row = { ...identity, call: "legacy-projection", ok: true, usd: 0 };
  append(ledger, row);
  const options = { root: disc, exit: "delivery", by: "Brad", _exec: () => { throw new Error("unexpected command"); }, _fetch: () => { throw new Error("unexpected network"); }, _env: {} };
  const before = (await exportHandoff(options)).handoff;
  append(ledger, { ...row, usd_unknown: true });
  const after = (await exportHandoff(options)).handoff;
  check("legacy handoff cost, including by_stage, is unchanged when a zero becomes unknown",
    equal(after.cost, before.cost) && equal(after.cost, { usd: 0.05, calls: 2, by_stage: { design: { usd: 0.05, calls: 1 }, workshop: { usd: 0, calls: 1 } } }), JSON.stringify(after.cost));
  check("handoff still validates; unknown fields remain forbidden at cost and by_stage levels",
    validate("handoff", after).ok && !validate("handoff", { ...after, cost: { ...after.cost, unknown: 1 } }).ok &&
    !validate("handoff", { ...after, cost: { ...after.cost, by_stage: { ...after.cost.by_stage, workshop: { usd: 0, calls: 1, unknown: 1 } } } }).ok);
});

done();
