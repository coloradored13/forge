// owns: R15 · shared — suites export an async function ({ browser }); throw on failure.
// Resolve separately: a missing transitive dependency is a broken install, not a skip.
import { pathToFileURL } from "node:url";
let browser;
try {
  let module;
  try { module = import.meta.resolve("playwright"); }
  catch (e) {
    if (e.code !== "ERR_MODULE_NOT_FOUND" || !e.message.startsWith("Cannot find package 'playwright'")) throw e;
    console.log("SKIPPED: playwright module is not installed");
    process.exitCode = 77;
  }
  if (module) {
    const { chromium } = await import(module);
    try { browser = await chromium.launch({ headless: true }); }
    catch (e) {
      if (!/Executable doesn't exist at /.test(e.message)) throw e;
      console.log(`SKIPPED: ${e.message.split("\n")[0]}`);
      process.exitCode = 77;
    }
    if (browser) await (await import(pathToFileURL(process.argv[2]))).default({ browser });
  }
} catch (e) {
  console.error(e.stack ?? e);
  process.exitCode = 1;
} finally {
  // Do not use harness.done(): it exits before asynchronous resource cleanup.
  if (browser) try { await browser.close(); } catch (e) { console.error(e); process.exitCode = 1; }
}

if ((process.exitCode ?? 0) === 0) console.log("BROWSER_SUITE_COMPLETE");
