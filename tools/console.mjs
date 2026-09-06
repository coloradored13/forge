// owns: R10 · shared — `node tools/console.mjs [root]`: the PM's console on localhost for
// one project root (default: the current directory). Composition only — each half's views
// and routes are the half's, the server is shared/console's, and the two halves meet here
// because neither may import the other. Discovery's nav names the six views; Delivery
// answers the run view, and the release view lands with its record (M3).

import { resolve } from "node:path";
import { serve } from "../shared/console/index.mjs";
import { routes as discoveryRoutes, nav } from "../discovery/console/index.mjs";
import { routes as deliveryRoutes } from "../delivery/console/index.mjs";

const root = resolve(process.argv[2] ?? ".");
const { url } = await serve({ routes: [...discoveryRoutes({ root }), ...deliveryRoutes({ root })], nav, port: Number(process.env.PORT ?? 0) });
console.log(`Forge console · ${root}\n${url}`);
