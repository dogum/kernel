#!/usr/bin/env node
// Records docs/media/agent-demo.gif: KERNEL·A loads the sample dataset, and the agent answers a question about it by
// writing and running cells. The model is a local mock that streams a scripted Anthropic conversation, so no key is
// needed and the recording is repeatable; the Python, the tables and the chart are real, and the closing summary is
// computed from the actual data.
//
//   npm ci && npx playwright install chromium
//   npm run demo
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import gifenc from "gifenc";
import pngjs from "pngjs";
import { staticServer, launch, openApp, k, kAsync } from "../tests/e2e/harness.mjs";
import { anthropicStream } from "../tests/e2e/mock-provider.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, "docs/media/agent-demo.gif");
const WIDTH = 1200, HEIGHT = 720, FRAME_MS = 110;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { GIFEncoder, quantize, applyPalette } = gifenc;
const { PNG } = pngjs;

// ---- a mock Anthropic endpoint that streams each event with a delay, so text appears as it would live ----
const script = [];
const mock = http.createServer(async (req, res) => {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  let body = "";
  for await (const chunk of req) body += chunk;
  const step = script.shift();
  if (!step) { res.writeHead(500, cors); return res.end("{}"); }
  const turn = step(JSON.parse(body));
  res.writeHead(200, { ...cors, "content-type": "text/event-stream" });
  await sleep(turn.wait ?? 700);
  for (const event of anthropicStream({ blocks: turn.blocks }).split("\n\n").filter(Boolean)) {
    res.write(event + "\n\n");
    await sleep(/text_delta/.test(event) ? 55 : /input_json_delta/.test(event) ? 12 : 30);
  }
  res.end();
});
await new Promise((r) => mock.listen(8766, r));
const toolResult = (body) => body.messages.at(-1).content.filter((b) => b.type === "tool_result").map((b) => b.content.map((x) => x.text || "").join("\n")).join("\n");
const addedIds = (body) => JSON.parse(toolResult(body).split("\n")[0]).added.map((a) => a.cell_id);

// ---- page ----
const srv = await staticServer();
const { browser, context } = await launch();
const page = await openApp(context, "kernel-agent.html", { log: false });
await page.setViewportSize({ width: WIDTH, height: HEIGHT });
await kAsync(page, `await kwCall("loadFromImports", { src: "import pandas\\nimport matplotlib" });`); // load packages up front so they don't dominate the video
await page.evaluate(() => {
  const c = document.createElement("div");
  c.id = "demo-cursor";
  c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2l14 8-6 1.6L8 18z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  Object.assign(c.style, { position: "fixed", left: "640px", top: "420px", zIndex: 2147483647, pointerEvents: "none", transition: "left .55s cubic-bezier(.3,.7,.2,1), top .55s cubic-bezier(.3,.7,.2,1)" });
  document.body.appendChild(c);
});
async function pointAndClick(selector) {
  const box = await page.locator(selector).first().boundingBox();
  await page.evaluate(({ x, y }) => Object.assign(document.getElementById("demo-cursor").style, { left: x + "px", top: y + "px" }), { x: box.x + box.width / 2 - 4, y: box.y + box.height / 2 - 3 });
  await sleep(700);
  await page.locator(selector).first().click();
}

// ---- frames ----
const frames = [];
let recording = true;
const recorder = (async () => {
  while (recording) {
    const started = Date.now();
    frames.push({ png: await page.screenshot({ type: "png", caret: "initial" }), at: started });
    await sleep(Math.max(0, FRAME_MS - (Date.now() - started)));
  }
})();

await sleep(1400);
await pointAndClick('[data-w="sample"]');
await page.waitForFunction(() => window.__k('cells.length>=3 && cells.every(c=>c.type!=="code"||c.execCount!=null) && !busy'), null, { timeout: 120000 });
await sleep(1500);

// the closing summary is computed from the real data, so every number in it is true
const facts = JSON.parse(await kAsync(page, `return await runPy(${JSON.stringify(`
import json
df = _KNS["df"]
t = df.pivot_table(index="region", columns="channel", values="revenue", aggfunc="sum")
tot = t.sum(axis=1).sort_values(ascending=False)
ch = t.sum().sort_values(ascending=False)
json.dumps({"regions": [[r, float(v)] for r, v in tot.items()], "channels": [[c, float(v)] for c, v in ch.items()],
            "leader": {r: t.loc[r].idxmax() for r in t.index}})
`)});`));
const kfmt = (v) => (v / 1000).toFixed(1) + "k";
const [topRegion, secondRegion] = facts.regions, lowRegion = facts.regions.at(-1);
const total = facts.channels.reduce((s, [, v]) => s + v, 0);
const [topChannel] = facts.channels[0];
const exceptions = Object.entries(facts.leader).filter(([, c]) => c !== topChannel);
const summary =
  `**${topRegion[0]}** brings in the most revenue (${kfmt(topRegion[1])}), ahead of ${secondRegion[0]} (${kfmt(secondRegion[1])}); ${lowRegion[0]} is lowest (${kfmt(lowRegion[1])}).\n\n` +
  `- **${topChannel}** is the largest channel, ${Math.round((facts.channels[0][1] / total) * 100)}% of revenue, then ${facts.channels.slice(1).map(([c, v]) => `${c} ${Math.round((v / total) * 100)}%`).join(" and ")}.\n` +
  (exceptions.length
    ? `- ${topChannel} leads in every region except ${exceptions.map(([r, c]) => `${r}, where ${c} comes first`).join("; ")}.\n`
    : `- ${topChannel} leads in every region.\n`) +
  `\nThe chart is in the notebook if you want to dig into one region.`;

// the conversation
let pivotId = null, chartId = null;
script.push(
  () => ({ blocks: [
    { type: "thinking", thinking: "Total revenue by region and channel, then chart the split.", signature: "demo1" },
    { type: "text", text: "I'll total revenue by region and channel first." },
    { type: "tool_use", id: "t1", name: "add_cells", input: { run: true, cells: [
      { type: "markdown", source: "## Revenue by region and channel" },
      { type: "code", source: 'by_rc = df.pivot_table(index="region", columns="channel", values="revenue", aggfunc="sum").round(0)\nby_rc["total"] = by_rc.sum(axis=1)\nby_rc.sort_values("total", ascending=False)' },
    ] } },
  ] }),
  (body) => { pivotId = addedIds(body)[1]; return { blocks: [
    { type: "text", text: "A stacked bar chart makes the channel mix easier to compare." },
    { type: "tool_use", id: "t2", name: "add_cells", input: { run: true, cells: [
      { type: "code", source: 'import matplotlib.pyplot as plt\nax = by_rc.drop(columns="total").sort_values("Online").plot.barh(stacked=True, figsize=(7, 3), title="Revenue by region and channel")\nax.set_xlabel("revenue")\nplt.tight_layout()' },
    ] } },
  ] }; },
  (body) => { chartId = addedIds(body)[0]; return { wait: 400, blocks: [
    { type: "tool_use", id: "t3", name: "finish_run", input: { summary: "Revenue by region and channel, with a chart.", evidence: [
      { kind: "cell", id: pivotId, claim: "totals by region and channel" },
      { kind: "cell", id: chartId, claim: "stacked bar chart of the channel mix" },
    ] } },
  ] }; },
  () => ({ wait: 400, blocks: [{ type: "text", text: summary }] }),
);
await kAsync(page, `agApplyProvider('anthropic');agKey='demo';agBase='http://localhost:8766';agModel='claude-opus-5-5';agAutonomy='auto';agStateUi();`);

await pointAndClick("#btnAgent");
await sleep(600);
await pointAndClick("#agIn");
await page.keyboard.type("Which region and channel bring in the most revenue? Chart it and tell me what stands out.", { delay: 28 });
await sleep(500);
await pointAndClick("#agSend");
await page.evaluate(() => { document.getElementById("demo-cursor").style.opacity = "0"; });
await page.waitForFunction(() => window.__k("agRun && agRun.status === 'completed' && !agRunning"), null, { timeout: 120000 });
await page.evaluate((id) => {
  window.__k(`findCell(${JSON.stringify(id)})`).el.scrollIntoView({ block: "center", behavior: "smooth" });
  const tx = document.getElementById("agTx");
  tx.scrollTo({ top: tx.scrollHeight, behavior: "smooth" });
}, chartId);
await sleep(3200);
recording = false;
await recorder;
await browser.close(); srv.close(); mock.close();

// ---- encode: one palette for the whole video, and each frame stores only the pixels that changed ----
const decoded = frames.map((f) => ({ ...PNG.sync.read(f.png), at: f.at }));
const { width, height } = decoded[0];
const sample = decoded.filter((_, i) => i % Math.ceil(decoded.length / 12) === 0);
const pool = new Uint8Array(sample.length * width * height * 4);
sample.forEach((f, i) => pool.set(f.data, i * width * height * 4));
const palette = quantize(pool, 255);
while (palette.length < 256) palette.push([255, 0, 255]);
const TRANSPARENT = 255;
const gif = GIFEncoder();
let shown = null, pending = null;
const flush = () => { if (pending) gif.writeFrame(pending.index, width, height, pending.opts); };
decoded.forEach((f, i) => {
  const index = applyPalette(f.data, palette.slice(0, 255));
  const delay = i + 1 < decoded.length ? decoded[i + 1].at - f.at : 3000;
  if (!shown) { pending = { index, opts: { palette, delay } }; shown = index; return; }
  const diff = new Uint8Array(index.length).fill(TRANSPARENT);
  let changed = 0;
  for (let p = 0; p < index.length; p += 1) if (index[p] !== shown[p]) { diff[p] = index[p]; changed += 1; }
  if (!changed) { pending.opts.delay += delay; return; }
  flush();
  pending = { index: diff, opts: { delay, transparent: true, transparentIndex: TRANSPARENT, dispose: 1 } };
  shown = index;
});
pending.opts.delay += 2500; // hold the final frame
flush();
gif.finish();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, gif.bytes());
console.log(`wrote ${path.relative(ROOT, OUT)}: ${frames.length} frames, ${((frames.at(-1).at - frames[0].at) / 1000).toFixed(1)} s, ${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB`);
