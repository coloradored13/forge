// owns: R1 · shared — a call that hits the subscription cap waits instead of dying.
// The same call succeeds verbatim once the window resets, so treating a billing clock
// as a defect spent a door (sometimes an escalation) in v1. The retry re-runs the whole
// callable; every caller writes output only at the end, which is what makes coarse
// retry safe. Ported from v1 tools/usage.mjs.

const USAGE_PATTERNS = [
  /usage limit/i,
  /rate.?limit/i,
  /overloaded/i,
  /\b429\b/,
  /quota/i,
  /capacity/i,
  /usage cap/i,
  /limit (?:reached|exceeded)/i,
];

/** Does this error text describe a usage or capacity gap rather than a defect? */
export function isUsageGap(text) {
  const s = String(text ?? "");
  return USAGE_PATTERNS.some((p) => p.test(s));
}

/** 5m, 10m, 20m, then 30m repeating — bounded overall by the caller's budget. */
export function waitMsFor(attempt) {
  return Math.min(5 * 60_000 * 2 ** attempt, 30 * 60_000);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn`; on a usage gap, pause and retry until it succeeds or the pause budget
 * (default 6h) is spent. Any other failure rethrows at once — a real defect must keep
 * failing loudly.
 */
export async function withUsagePause(fn, { label = "agent", onEvent, maxTotalMs = 6 * 60 * 60_000, _sleep = sleep } = {}) {
  let attempt = 0;
  let waited = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (!isUsageGap(e?.message ?? e)) throw e;
      const wait = waitMsFor(attempt);
      const first = String(e?.message ?? e).split("\n")[0];
      if (waited + wait > maxTotalMs) {
        throw new Error(`${label}: usage gap outlasted the ${Math.round(maxTotalMs / 3_600_000)}h pause budget — ${first}`);
      }
      onEvent?.(`usage gap — pausing ${Math.round(wait / 60_000)}m before retrying ${label} (${first})`);
      await _sleep(wait);
      waited += wait;
      attempt += 1;
    }
  }
}
