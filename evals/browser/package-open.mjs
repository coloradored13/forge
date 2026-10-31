// owns: R14, R15 · discovery — D10: the exported copy runs without its project.
import assert from "node:assert/strict";
import fs from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { withRoot } from "../_harness.mjs";
import { exported, readable } from "../_package-fixture.mjs";

export default async function packageOpen({ browser }) {
  await withRoot({}, async parent => {
    const { root, dir } = await exported(parent), copy = join(parent, "recipient");
    fs.cpSync(dir, copy, { recursive: true }); fs.renameSync(root, root + ".unavailable");
    assert(!fs.existsSync(root)); readable(copy);
    const outside = join(parent, "outside.html"); fs.writeFileSync(outside, "<h1>OUTSIDE SENTINEL</h1>");
    const context = await browser.newContext({ serviceWorkers: "block" });
    const blocked = [], allowed = [], failures = [], errors = [];
    try {
      await context.route("**/*", async route => {
        const url = new URL(route.request().url());
        let inside = false;
        if (url.protocol === "file:") {
          url.search = ""; url.hash = "";
          const rel = relative(copy, fileURLToPath(url));
          inside = rel !== "" && rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel);
        }
        if (!inside) { blocked.push(route.request().url()); await route.abort("blockedbyclient"); }
        else { allowed.push(route.request().url()); await route.continue(); }
      });
      const page = await context.newPage(); page.setDefaultTimeout(5000);
      page.on("requestfailed", req => failures.push(req.url())); page.on("pageerror", e => errors.push(e.message));
      const entry = pathToFileURL(join(copy, "prototype/index.html")).href;
      await page.goto(entry); assert.equal(await page.locator("h1").innerText(), "Run sheet — café");
      assert.equal(await page.locator("#result").innerText(), "Ready");
      await page.locator("#record").click(); assert.equal(await page.locator("#result").innerText(), "Exception recorded");
      assert(allowed.includes(entry), "guard must observe the file:// navigation");
      assert.deepEqual(blocked, []); assert.deepEqual(failures, []); assert.deepEqual(errors, []);
      console.log("PASS copied scripted prototype text, interaction, payloads and hashes with source renamed away");
      // A page-initiated file navigation avoids fetch's separate file-origin CORS block:
      // the request must reach OUR guard and be aborted, not merely fail elsewhere.
      const target = pathToFileURL(outside).href;
      const failed = page.waitForEvent("requestfailed", req => req.url() === target);
      await page.evaluate(url => { const a = document.createElement('a'); a.id = 'outside-control'; a.href = url; a.textContent = 'Outside control'; document.body.append(a); }, target);
      await page.locator("#outside-control").click(); await failed;
      assert.deepEqual(blocked, [target]); assert(failures.includes(target));
      assert.equal(await page.locator("text=OUTSIDE SENTINEL").count(), 0);
      console.log("PASS deliberate outside-copy file request observed and aborted");
      console.log("2/2 passed");
    } finally { await context.close(); }
  });
}
