// owns: R3, R4, R14, R15 · discovery — D03 through real forms, with scripted models.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { withRoot, scripted } from "../_harness.mjs";
import { setup, accepted, DECISION } from "../_bookings.mjs";
import { loadPrd } from "../../discovery/workshop/index.mjs";
import { readDoc, agreementGap, PROTOTYPE_FILE, HTML_FILE, STORIES_FILE } from "../../discovery/record/index.mjs";
import { serve } from "../../shared/console/index.mjs";
import { routes, nav } from "../../discovery/console/index.mjs";

const noService = () => { throw new Error("unexpected external service"); };
const bytes = (root, file) => readFileSync(join(root, file));
async function submit(page, action, fields = {}, destination = "/board") {
  const form = page.locator(`form[action="${action}"]`);
  for (const [name, value] of Object.entries(fields)) await form.locator(`[name="${name}"]`).fill(value);
  await Promise.all([
    page.waitForEvent("framenavigated", frame => frame === page.mainFrame() && new URL(frame.url()).pathname === destination),
    form.locator('button[type="submit"]').click(),
  ]);
  await page.waitForLoadState("load");
}

export default async function journey({ browser }) {
  for (const decision of ["approve", "reject"]) await withRoot({}, async parent => {
    const { root, backlog } = await setup(parent), before = loadPrd(root);
    const proto = readDoc(root, PROTOTYPE_FILE), protoBytes = bytes(root, PROTOTYPE_FILE), htmlBytes = bytes(root, HTML_FILE), storyBytes = bytes(root, STORIES_FILE);
    const fresh = structuredClone(backlog);
    fresh.stories[0].scenarios.push({ name: "Pickup prevents cancellation", gherkin: "Given my booking has been picked up\nWhen I view it\nThen cancellation is unavailable", proves: ["REQ-1/AC-3"] });
    const q = scripted({ structuredSeq: [
      { change: { requirement: "REQ-1", statement: DECISION }, rationale: "Pickup ends cancellation.", note: "Review the policy." },
      { html: "<!doctype html><title>Booking</title><p>No cancellation after pickup.</p>", screens: proto.screens, uncovered: [], notes: "", open_questions: [] }, fresh,
    ] });
    const srv = await serve({ routes: routes({ root, _query: q.query, _exec: noService, _fetch: noService, _env: {} }), nav, port: 0 });
    const context = await browser.newContext();
    context.setDefaultTimeout(15000);
    context.setDefaultNavigationTimeout(15000);
    try {
      await context.route("**/*", route => new URL(route.request().url()).origin === srv.url ? route.continue() : route.abort());
      const page = await context.newPage();
      await page.goto(srv.url + "/prototype");
      const reaction = page.locator('form[action="/prototype/react"]');
      await reaction.locator('[name="pq"]').selectOption("PQ-1");
      await submit(page, "/prototype/react", { text: "No cancellations after pickup.", by: "PM" }, "/prototype");
      assert.equal(q.calls.length, 1);
      assert.match(await page.locator("main").innerText(), /proposed/);
      assert.equal(await page.locator('form[action="/prototype/react"]').count(), 0, "pending reaction cannot be repeated");
      assert.deepEqual(accepted(loadPrd(root)), accepted(before));
      assert.deepEqual(bytes(root, PROTOTYPE_FILE), protoBytes);
      assert.deepEqual(bytes(root, HTML_FILE), htmlBytes);
      await page.getByRole("link", { name: "decide on the board" }).press("Enter");
      await page.waitForURL(srv.url + "/board");
      const row = page.locator("tr").filter({ has: page.locator('form[action="/doors/approve"]') });
      assert.match(await row.innerText(), /reaction/);
      assert.ok((await row.innerText()).includes(DECISION));
      const a = loadPrd(root).amendments[0];
      assert.deepEqual(await row.locator('input[name="radius"]').evaluateAll(xs => xs.map(x => x.value).sort()), [...a.radius.criteria, ...a.radius.stories, ...a.radius.screens].sort());
      // Pending proposals block rewriting without consulting the writer.
      await submit(page, "/stories/write", {}, "/stories/write");
      assert.match(await page.locator(".refusal").innerText(), /reaction-pending/);
      assert.equal(q.calls.length, 1);
      assert.deepEqual(bytes(root, STORIES_FILE), storyBytes);
      await page.getByRole("link", { name: "Back", exact: true }).press("Enter");
      await page.waitForURL(srv.url + "/board");
      if (decision === "reject") {
        await submit(page, "/doors/reject", { by: "PM", reason: "Keep the question open." });
        assert.match(await page.locator("tr").filter({ hasText: a.id }).innerText(), /rejected.*PM/s);
        assert.deepEqual(accepted(loadPrd(root)), accepted(before));
        assert.deepEqual(loadPrd(root).rulings, before.rulings);
        assert.deepEqual(bytes(root, PROTOTYPE_FILE), protoBytes);
        assert.deepEqual(bytes(root, HTML_FILE), htmlBytes);
        assert.equal(readDoc(root, PROTOTYPE_FILE).open_questions[0].status, "open");
        await submit(page, "/stories/write", {}, "/stories/write");
        assert.match(await page.locator(".refusal").innerText(), /blocking-question/);
        assert.equal(q.calls.length, 1);
        assert.deepEqual(bytes(root, STORIES_FILE), storyBytes);
      } else {
        for (const box of await row.locator('input[name="radius"]').all()) await box.check();
        await submit(page, "/doors/approve", { by: "PM" });
        const approved = loadPrd(root);
        assert.notEqual(approved.meta.content_hash, before.meta.content_hash);
        assert.deepEqual(approved.requirements[0].acceptance_criteria.at(-1), { id: "AC-3", statement: DECISION });
        assert.equal(readDoc(root, PROTOTYPE_FILE).open_questions[0].status, "answered");
        const artifact = page.locator("tr").filter({ has: page.locator('a[href="/artifact/prototype"]') });
        assert.match(await artifact.innerText(), /stale/);
        assert.match(await artifact.innerText(), /prototype/i);
        await page.getByRole("link", { name: "open", exact: true }).press("Enter");
        await page.waitForURL(srv.url + "/prototype");
        assert.match(await page.locator("main").innerText(), /rebuild it/);
        assert.equal(await page.locator('form[action="/prototype/react"]').count(), 0);
        await page.getByRole("link", { name: "back to the board" }).press("Enter");
        await page.waitForURL(srv.url + "/board");
        await submit(page, "/prototype/generate");
        assert.doesNotMatch(await artifact.innerText(), /stale/);
        await submit(page, "/doors/agree", { by: "PM" });
        assert.equal(agreementGap(loadPrd(root), readDoc(root, PROTOTYPE_FILE)), null);
        await submit(page, "/stories/write");
        assert.equal(q.calls.length, 3);
        assert.equal(readDoc(root, STORIES_FILE).traces.prd.content_hash, approved.meta.content_hash);
        await page.getByRole("link", { name: "Export", exact: true }).press("Enter");
        await page.waitForURL(srv.url + "/export");
        await page.locator('form[action="/export"] [name="exit"]').selectOption("team");
        await submit(page, "/export", { by: "PM" }, "/export");
        const files = readdirSync(join(root, "discovery/handoffs")).filter(f => f.endsWith(".json"));
        assert.equal(files.length, 1);
        assert.ok((await page.locator("main").innerText()).includes(files[0]));
        const handoff = JSON.parse(bytes(root, "discovery/handoffs/" + files[0]));
        assert.deepEqual(handoff.contract.requirements[0].acceptance_criteria.at(-1), { id: "AC-3", statement: DECISION });
      }
    } finally { await context.close(); await srv.close(); }
  });
  console.log("2/2 passed");
}
