#!/usr/bin/env node
// Runs the browser end-to-end suites against both builds. Needs the dev dependencies and a Chromium build:
//   npm ci && npx playwright install chromium && npm run test:e2e
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const here = fileURLToPath(new URL(".", import.meta.url));
try { await import("playwright"); } catch { console.log("Skipping browser E2E: the playwright package is not installed."); process.exit(0); }
let failed = 0;
for (const suite of ["agent-loop.mjs", "kernel-worker.mjs", "ui.mjs"]) for (const build of ["kernel-agent.html", "kernel-agent-mobile.html"]) {
  const r = spawnSync(process.execPath, [here + suite, build], { stdio: "inherit", env: { ...process.env, NODE_NO_WARNINGS: "1" } });
  if (r.status !== 0) { failed += 1; console.error(`FAILED: ${suite} on ${build}`); }
}
// the phone suite opens both builds itself, as a phone would
const phone = spawnSync(process.execPath, [here + "phone.mjs"], { stdio: "inherit", env: { ...process.env, NODE_NO_WARNINGS: "1" } });
if (phone.status !== 0) { failed += 1; console.error("FAILED: phone.mjs"); }
if (failed) process.exit(1);
console.log("Browser E2E passed: agent loop, kernel worker, and UI on desktop and mobile builds, and the phone layout.");
