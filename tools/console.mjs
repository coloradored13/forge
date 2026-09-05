// owns: R10 · shared — `node tools/console.mjs [root]`: the PM's console on localhost for
// one project root (default: the current directory). Composition only — the Discovery
// views and routes are the half's; the server is shared/console's. Delivery registers
// its two views here when its record exists (M2).

import { resolve } from "node:path";
import { serve } from "../shared/console/index.mjs";
import { routes, nav } from "../discovery/console/index.mjs";

const root = resolve(process.argv[2] ?? ".");
const { url } = await serve({ routes: routes({ root }), nav, port: Number(process.env.PORT ?? 0) });
console.log(`Forge console · ${root}\n${url}`);
