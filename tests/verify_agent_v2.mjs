#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";

const files = ["docs/kernel-agent.html", "docs/kernel-agent-mobile.html"];
const html = Object.fromEntries(files.map((file) => [file, fs.readFileSync(file, "utf8")]));

function scripts(text) {
  return [...text.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .filter((body) => body.trim());
}

function sharedRuntime(text) {
  const start = text.indexOf("const HARNESS = `");
  const end = text.indexOf("/* live theme:", start);
  assert.ok(start >= 0 && end > start, "shared runtime markers exist");
  return text.slice(start, end);
}

function functionSource(text, name) {
  const start = text.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const brace = text.indexOf("{", start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = brace; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") { quote = char; continue; }
    if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

for (const file of files) {
  for (const [index, body] of scripts(html[file]).entries()) {
    assert.doesNotThrow(() => new Function(body), `${file} inline script ${index} parses`);
  }
}

const desktop = html[files[0]];
const mobile = html[files[1]];
assert.equal(sharedRuntime(desktop), sharedRuntime(mobile), "desktop and mobile share one agent runtime");

for (const [label, needle] of [
  ["Anthropic provider", "anthropic:{label:'Anthropic'"],
  ["OpenAI provider", "openai:{label:'OpenAI'"],
  ["xAI provider", "xai:{label:'xAI'"],
  ["Anthropic Messages adapter", "streamAnthropic(ctx)"],
  ["Responses adapter", "streamResponses(ctx)"],
  ["privacy-safe Responses calls", "store:false"],
  ["OpenAI reasoning continuation", "reasoning.encrypted_content"],
  ["model discovery", "discoverModels(announce)"],
  ["xAI model discovery", "'/language-models'"],
  ["typed token accounting", "reasoning_tokens"],
  ["durable threads", "createObjectStore(\"threads\""],
  ["portable workspaces", "format:\"kernel-workspace\""],
  ["active-only compaction", "Earlier-thread checkpoint"],
  ["Markdown chat", "renderAgentMarkdown"],
  ["stable cell ids", "cell_id:c.id"],
]) assert.ok(desktop.includes(needle), `includes ${label}`);

assert.ok(!desktop.includes("slice(-300)"), "transcript is not silently capped");
assert.ok(!desktop.includes("while(out.length>1500000"), "full messages are not silently dropped");
assert.ok(desktop.includes('id="agThreadSelect"'), "thread selector is rendered");
assert.ok(desktop.includes('id="ctxInput"') && desktop.includes('id="ctxOutput"'), "input/output usage is visible");
assert.ok(mobile.includes('id="btnWorkspace"'), "mobile exposes workspace ZIP export");
assert.ok(mobile.includes('id="varsSort"'), "mobile exposes variable sorting");
for (const exportName of ["agExportBundle", "downloadWorkspaceZip"]) {
  const body = functionSource(desktop, exportName);
  assert.ok(!body.includes("agKey") && !body.includes("agConfigs"), `${exportName} cannot serialize provider keys`);
}

const zipStart = desktop.indexOf("const ZIP_UTF8=");
const zipEnd = desktop.indexOf("function downloadBlob", zipStart);
assert.ok(zipStart >= 0 && zipEnd > zipStart, "ZIP implementation is present");
const zipFactory = new Function(`${desktop.slice(zipStart, zipEnd)};return {zipStore,zipReadStore}`);
const { zipStore, zipReadStore } = zipFactory();
const input = [
  { name: "manifest.json", data: new TextEncoder().encode('{"ok":true}') },
  { name: "data/uploads/δ.csv", data: new Uint8Array([0, 1, 2, 250, 255]) },
];
const archive = zipStore(input);
const restored = zipReadStore(archive);
assert.equal(new TextDecoder().decode(restored.get("manifest.json")), '{"ok":true}', "ZIP text round-trips");
assert.deepEqual([...restored.get("data/uploads/δ.csv")], [0, 1, 2, 250, 255], "ZIP binary round-trips");

const adapterFactory = new Function(`
  const clonePlain=(value)=>JSON.parse(JSON.stringify(value));
  let agProvider='openai';
  ${functionSource(desktop, "anthropicMessages")}
  ${functionSource(desktop, "responseInput")}
  ${functionSource(desktop, "canonicalResponseOutput")}
  ${functionSource(desktop, "sseDataLines")}
  return {anthropicMessages,responseInput,canonicalResponseOutput,sseDataLines,setProvider:(value)=>{agProvider=value}};
`);
const adapters = adapterFactory();
const rawCall = { type: "function_call", id: "fc_1", call_id: "call_1", name: "read_cell", arguments: '{"cell_id":"c1"}' };
const canonical = adapters.canonicalResponseOutput([
  { type: "reasoning", encrypted_content: "opaque", summary: [{ text: "Checked the cell." }] },
  rawCall,
  { type: "message", content: [{ type: "output_text", text: "Done." }] },
]);
assert.equal(canonical.find((block) => block.type === "tool_use").id, "call_1", "Responses call id is canonicalized");
assert.equal(canonical.find((block) => block.type === "reasoning").text, "Checked the cell.", "reasoning summary is exposed");
assert.equal(canonical.find((block) => block.type === "provider_item").item.encrypted_content, "opaque", "opaque reasoning is preserved");
const responseWire = adapters.responseInput([
  { role: "assistant", content: canonical },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: [{ type: "text", text: "cell contents" }] }] },
]);
assert.ok(responseWire.some((item) => item.id === "fc_1"), "same-provider raw function call is replayed");
assert.ok(responseWire.some((item) => item.type === "function_call_output" && item.call_id === "call_1"), "tool result maps to Responses output");
adapters.setProvider("xai");
const crossProvider = adapters.responseInput([{ role: "assistant", content: canonical }]);
assert.ok(crossProvider.some((item) => item.type === "function_call" && !item.id), "cross-provider tool call uses portable fields");
const anthropicWire = adapters.anthropicMessages([{ role: "assistant", content: canonical }]);
assert.deepEqual(Object.keys(anthropicWire[0].content.find((block) => block.type === "tool_use")).sort(), ["id", "input", "name", "type"], "Anthropic blocks contain no Responses-only fields");
const parsedSse = adapters.sseDataLines('event: ping\ndata: {"type":"one"}\n\ndata: {"type":"two"}\n\npartial');
assert.deepEqual(parsedSse.events, ['{"type":"one"}', '{"type":"two"}'], "typed SSE frames parse in order");
assert.equal(parsedSse.rest, "partial", "partial SSE frame is retained");

const contextFactory = new Function(`
  const clonePlain=(value)=>JSON.parse(JSON.stringify(value));
  const agTrunc=(text,n)=>String(text).length>n?String(text).slice(0,n)+'…[truncated]':String(text);
  const DOCS='system'; const AG_TOOLS=[]; let agMsgs=[],agLastContext=null; const agCompactAt=70,agMaxOut=512,cells=[],dataFiles=[];
  const getCellContextPolicy=()=> 'auto',getArtifactContextPolicy=()=> 'auto';
  const agCtxLimit=()=>2500; const meterUi=()=>{};
  ${functionSource(desktop, "estBlocks")}
  ${functionSource(desktop, "agEstCtx")}
  ${functionSource(desktop, "isHumanMessage")}
  ${functionSource(desktop, "prunedMessages")}
  ${functionSource(desktop, "summarizeSegments")}
  ${functionSource(desktop, "prepareContext")}
  return {run:(messages)=>{agMsgs=messages;return prepareContext()}};
`);
const context = contextFactory();
const fullHistory = [];
for (let turn = 0; turn < 6; turn += 1) {
  fullHistory.push({ role: "user", content: [{ type: "text", text: `goal-${turn} ` + "u".repeat(900) }] });
  fullHistory.push({ role: "assistant", content: [{ type: "text", text: `answer-${turn} ` + "a".repeat(900) }] });
}
const pristine = JSON.stringify(fullHistory);
const activeContext = context.run(fullHistory);
assert.ok(activeContext.stats.compacted > 0, "oversized history is checkpointed");
assert.ok(activeContext.messages.length < fullHistory.length, "active payload drops complete old turns");
assert.ok(activeContext.summary.includes("goal-0"), "checkpoint retains earlier intent");
assert.equal(JSON.stringify(fullHistory), pristine, "compaction never mutates durable history");

console.log(`KERNEL Agent v2 verification passed (${files.length} builds, provider adapters, ${archive.byteLength} byte ZIP fixture).`);
