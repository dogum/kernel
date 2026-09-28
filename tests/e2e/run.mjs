#!/usr/bin/env node
// Runs the browser end-to-end suites against both builds. Requires the `playwright` package and a Chromium build:
//   npm install --no-save playwright && npx playwright install chromium && node tests/e2e/run.mjs
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const here = fileURLToPath(new URL(".", import.meta.url));
try { await import("playwright"); } catch { console.log("Skipping browser E2E: the playwright package is not installed."); process.exit(0); }
let failed = 0;
for (const suite of ["agent-loop.mjs", "kernel-worker.mjs"]) for (const build of ["kernel-agent.html", "kernel-agent-mobile.html"]) {
  const r = spawnSync(process.execPath, [here + suite, build], { stdio: "inherit", env: { ...process.env, NODE_NO_WARNINGS: "1" } });
  if (r.status !== 0) { failed += 1; console.error(`FAILED: ${suite} on ${build}`); }
}
if (failed) process.exit(1);
console.log("Browser E2E passed: agent loop and kernel worker on desktop and mobile builds.");
