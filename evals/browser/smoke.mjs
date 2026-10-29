// owns: R10, R15 · shared — a real browser reads the seeded console; no models or remote services.
import assert from "node:assert/strict";
import { withRoot, scripted } from "../_harness.mjs";
import { seedProject } from "../_fixture.mjs";
import { serve } from "../../shared/console/index.mjs";
import { routes, nav } from "../../discovery/console/index.mjs";
import { routes as deliveryRoutes } from "../../delivery/console/index.mjs";

export default async function smoke({ browser }) {
  await withRoot({}, async tmp => {
    const root = seedProject(tmp), q = scripted();
    const srv = await serve({ routes: [...routes({ root, _query: q.query }), ...deliveryRoutes({ root, _query: q.query })], nav, port: 0 });
    let context;
    try {
      context = await browser.newContext();
      // Fail closed on unintended external requests, even if a future view adds assets.
      await context.route("**/*", route => new URL(route.request().url()).origin === srv.url ? route.continue() : route.abort());
      const page = await context.newPage();
      const response = await page.goto(srv.url + "/");
      assert.equal(response.status(), 200);
      assert.equal(new URL(page.url()).pathname, "/board");
      assert.deepEqual(await page.locator("header nav a").evaluateAll(as => as.map(a => ({ href: a.getAttribute("href"), label: a.textContent }))), [
        { href: "/setup", label: "Setup" }, { href: "/workshop", label: "Workshop" },
        { href: "/board", label: "Board" }, { href: "/export", label: "Export" },
        { href: "/run", label: "Delivery run" }, { href: "/release", label: "Release" },
      ]);
      assert.match(await page.locator("main").innerText(), /Dock/);
      assert.match(await page.locator("main").innerText(), /A dock lead records an exception at the door against a delivery/);
      assert.equal(q.calls.length, 0);
    } finally {
      try { if (context) await context.close(); } finally { await srv.close(); }
    }
  });
  console.log("6/6 passed");
}
