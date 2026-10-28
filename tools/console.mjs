// owns: R10 · shared — `npm run console -- <folder>`: the PM's console on localhost for
// one project folder (default: the caller's directory). Composition only — each half's views
// and routes are the half's, the server is shared/console's, and the two halves meet here
// because neither may import the other. Discovery's nav names the six views; Delivery
// answers the run view, and the release view lands with its record (M3).

import { existsSync, realpathSync, writeSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "../shared/console/index.mjs";
import { routes as discoveryRoutes, nav } from "../discovery/console/index.mjs";
import { routes as deliveryRoutes } from "../delivery/console/index.mjs";

const USAGE = "npm run console -- ~/Forge/my-product";
// Written synchronously: on macOS a piped stderr would lose an async write to exit().
const refuse = (code, remedy) => { writeSync(2, `${code}: ${remedy}\n`); process.exit(1); };
// A folder that may not exist yet: its nearest existing ancestor's real path, with the rest put back.
const real = (p) => existsSync(p) ? realpathSync(p) : join(real(dirname(p)), basename(p));

// npm runs scripts from the package root; INIT_CWD is where it was called from.
const root = resolve(process.env.INIT_CWD || process.cwd(), process.argv[2] ?? ".");
const checkout = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const target = real(root);
if (target === checkout || target.startsWith(checkout + sep)) refuse("forge-checkout", `${root} is in the Forge checkout — name a project folder outside it: ${USAGE}`);
// A fixed default keeps the URL across restarts; a busy port is refused, never swapped.
const raw = process.env.PORT ?? "4747", port = Number(raw);
if (!/^\d+$/.test(raw) || port > 65535) refuse("bad-port", `PORT must be a whole number from 0 to 65535, not "${raw}"`);

const { url } = await serve({ routes: [...discoveryRoutes({ root }), ...deliveryRoutes({ root })], nav, port })
  .catch((e) => e.code === "EADDRINUSE" ? refuse("port-in-use", `port ${port} is in use — another console may be running; stop it, or run on another port: PORT=<port> ${USAGE}`) : Promise.reject(e));
console.log(`Forge console · ${root}\n${url}`);
