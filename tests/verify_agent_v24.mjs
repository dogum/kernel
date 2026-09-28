#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import { declarations, functionSource, has } from "./lib/source.mjs";

const desktopPath = "docs/kernel-agent.html";
const mobilePath = "docs/kernel-agent-mobile.html";
const desktop = fs.readFileSync(desktopPath, "utf8");
const mobile = fs.readFileSync(mobilePath, "utf8");

const fns = (...names) => names.map((name) => functionSource(desktop, name)).join("\n");
const docs = new Function(`${declarations(desktop, "DOCS")};return DOCS`)();

/* ---------- release identity and parity ---------- */
assert.ok(has(desktop, "·A v2.4.0") && has(mobile, "·A v2.4.0"), "both builds identify as v2.4.0");
assert.ok(has(desktop, "model:'claude-opus-5-5'") && has(desktop, "maxOut:64000"), "Anthropic defaults to Claude Opus 5.5 with room for thinking");
for (const id of ["btnInterrupt", "agCellMinutes"]) assert.ok(has(desktop, `id="${id}"`) && has(mobile, `id="${id}"`), `${id} exists in both builds`);
const outsideWorker = desktop.replace(functionSource(desktop, "kernelWorkerMain"), "");
for (const api of ["FS", "globals", "runPythonAsync", "loadPackage"]) assert.ok(!has(outsideWorker, `pyodide.${api}`), `only the kernel worker touches pyodide.${api}`);

/* ---------- 7: the stable prompt teaches the completion contract ---------- */
for (const needle of ["finish_run", "update_plan", "<kernel_state>", "run: true", "Only KERNEL reports pauses"]) assert.ok(docs.includes(needle), `operating note covers ${needle}`);
assert.ok(!docs.includes("stop calling tools and hand back"), "the old contradictory hand-back instruction is gone");

/* ---------- 8: Anthropic request shape ---------- */
const anthropic = new Function(`
  let agModel="claude-opus-5-5",agReasoning="medium",agAnthropicCompat=false;const AG_TOOLS=[{name:"a",input_schema:{type:"object"}}];
  const clonePlain=(v)=>JSON.parse(JSON.stringify(v)),agRunMaxOut=()=>64000,buildSystem=()=>[{type:"text",text:"DOCS",cache_control:{type:"ephemeral"}}];
  ${fns("anthropicModelFeatures", "anthropicMessages", "anthropicCacheBreakpoints", "anthropicRequest", "canonicalAnthropicContent")}
  return {anthropicModelFeatures,anthropicMessages,anthropicCacheBreakpoints,canonicalAnthropicContent,request:(model,effort,compat,messages)=>{agModel=model;agReasoning=effort;agAnthropicCompat=!!compat;return anthropicRequest({summary:"",messages})}};
`)();
const f55 = anthropic.anthropicModelFeatures("claude-opus-5-5");
assert.deepEqual([f55.adaptive, f55.display, f55.binding, f55.fallbacks, f55.maxOutput], [true, true, true, true, 128000], "Opus 5.5 gets adaptive thinking, summaries, binding, fallbacks, 128K output");
assert.deepEqual(anthropic.anthropicModelFeatures("claude-opus-5").binding, false, "Opus 5 does not run the conversation-binding check");
assert.deepEqual(anthropic.anthropicModelFeatures("claude-sonnet-4-6").efforts, ["low", "medium", "high", "max"], "4.6 models have no xhigh effort");
assert.equal(anthropic.anthropicModelFeatures("claude-sonnet-4-6").display, false, "4.6 models keep their default thinking display");
assert.equal(anthropic.anthropicModelFeatures("claude-haiku-4-5").adaptive, false, "Haiku 4.5 never receives adaptive thinking");
const history = [
  { role: "user", content: [{ type: "text", text: "go" }, { type: "text", kernel: "state", text: "<kernel_state>s1</kernel_state>" }] },
  { role: "assistant", content: [{ type: "thinking", thinking: "plan", signature: "sig" }, { type: "text", text: "" }, { type: "tool_use", id: "t1", name: "a", input: {} }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "" }] }, { type: "text", kernel: "state", text: "<kernel_state>s2</kernel_state>" }] },
];
const opus = anthropic.request("claude-opus-5-5", "medium", false, history);
assert.deepEqual(opus.body.thinking, { type: "adaptive", display: "summarized", block_binding: { prefix_mismatch_behavior: "drop_block" } });
assert.deepEqual(opus.body.output_config, { effort: "medium" });
assert.equal(opus.body.fallbacks, "default");
assert.deepEqual(opus.betas, ["thinking-binding-controls-2026-08-01", "server-side-fallback-2026-07-01"]);
assert.ok(opus.body.tools.every((t) => t.eager_input_streaming === true && !t.cache_control), "tools stream eagerly and carry no breakpoint of their own");
assert.deepEqual(opus.body.messages[1].content[0], { type: "thinking", thinking: "plan", signature: "sig" }, "thinking blocks replay unchanged");
assert.ok(!opus.body.messages[1].content.some((b) => b.type === "text"), "empty text blocks are never sent");
assert.deepEqual(opus.body.messages[2].content[0].content, [{ type: "text", text: "(no output)" }], "empty tool results stay valid");
assert.deepEqual(opus.body.messages.map((m) => m.content.some((b) => b.cache_control)), [true, false, true], "the newest two user turns carry cache breakpoints");
const sonnet = anthropic.request("claude-sonnet-4-6", "xhigh", false, history);
assert.deepEqual(sonnet.body.thinking, { type: "adaptive" }); assert.deepEqual(sonnet.body.output_config, { effort: "high" }, "unsupported xhigh degrades to high");
assert.equal(sonnet.betas.length, 0); assert.equal(sonnet.body.fallbacks, undefined);
const haiku = anthropic.request("claude-haiku-4-5", "medium", false, history);
assert.equal(haiku.body.thinking, undefined); assert.equal(haiku.body.output_config, undefined);
assert.ok(!haiku.body.messages[1].content.some((b) => b.type === "thinking"), "thinking is not replayed to a model that is not thinking");
const compat = anthropic.request("claude-opus-5-5", "medium", true, history);
assert.deepEqual([compat.betas.length, compat.body.fallbacks, compat.body.thinking.display, compat.body.tools[0].eager_input_streaming], [0, undefined, undefined, undefined], "compatibility mode drops every optional beta feature");
const afterFallback = anthropic.canonicalAnthropicContent([{ type: "thinking", thinking: "x", signature: "s" }, { type: "tool_use", id: "bad", name: "a", input: {} }, { type: "text", text: "partial" }, { type: "fallback", from: "a", to: "b" }, { type: "tool_use", id: "good", name: "a", input: {} }]);
assert.deepEqual(afterFallback.map((b) => b.id || b.type), ["text", "good"], "calls and thinking before a refusal fallback are never executed or replayed");

/* ---------- 1: append-only state and epoch-stable pruning ---------- */
const context = new Function(`
  const clonePlain=(v)=>JSON.parse(JSON.stringify(v)),AG_OLD_TEXT=20,agTrunc=(v,n)=>String(v||"").length>n?String(v).slice(0,n)+"…":String(v||"");
  let agMsgs=[],cells=[],dataFiles=[],state={key:"k1",notebook:"NB1",control:"CTRL"};const getCellContextPolicy=()=>"auto",getArtifactContextPolicy=()=>"auto",agPruneStep=()=>6,agStateParts=()=>state;
  ${fns("agPruneHorizon", "prunedMessages", "stampKernelState")}
  return {agPruneHorizon,prune:(m)=>{agMsgs=m;return prunedMessages()},stamp:(m,next)=>{agMsgs=m;if(next)state=next;stampKernelState();return agMsgs}};
`)();
const horizons = [];
for (let r = 0; r <= 30; r += 1) {
  const msgs = [];
  for (let i = 0; i < r; i += 1) msgs.push({ role: "assistant", content: [] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "t" + i, content: [] }] });
  horizons.push(context.agPruneHorizon(msgs, 6, 3));
}
assert.deepEqual([...new Set(horizons)], [0, 12, 24, 36, 48], "the compression horizon moves only in fixed epochs");
const grow = (n) => { const out = [{ role: "user", content: [{ type: "text", text: "go" }] }]; for (let i = 0; i < n; i += 1) out.push({ role: "assistant", content: [{ type: "tool_use", id: "t" + i, name: "run_cell", input: {} }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "t" + i, content: [{ type: "text", text: "result-" + i + "-" + "x".repeat(60) }] }] }); return out; };
let stableSteps = 0;
for (let n = 1; n < 30; n += 1) {
  const a = context.prune(grow(n)), b = context.prune(grow(n + 1));
  if (JSON.stringify(b.slice(0, a.length)) === JSON.stringify(a)) stableSteps += 1;
}
assert.ok(stableSteps >= 24, `earlier turns stay byte-identical between epochs (${stableSteps}/29 steps)`);
const stamped = context.stamp([{ role: "user", content: [{ type: "text", text: "go" }] }]);
assert.equal(stamped[0].content.at(-1).kernel, "state");
const second = context.stamp([...stamped, { role: "assistant", content: [{ type: "text", text: "ok" }] }, { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: [] }] }]);
assert.equal(JSON.stringify(second[0]), JSON.stringify(stamped[0]), "an earlier state block is frozen");
assert.match(second.at(-1).content.at(-1).text, /unchanged since the previous kernel_state/, "unchanged notebook state is summarized, not repeated");
const restamped = context.stamp(second, { key: "k2", notebook: "NB2", control: "CTRL2" });
assert.equal(restamped.at(-1).content.filter((b) => b.kernel === "state").length, 1, "the newest message keeps exactly one current state block");
assert.match(restamped.at(-1).content.at(-1).text, /NB2/);
const afterAssistant = context.stamp([{ role: "user", content: [{ type: "text", text: "go" }] }, { role: "assistant", content: [{ type: "text", text: "done" }] }]);
assert.equal(afterAssistant.at(-1).role, "user", "a request never ends on an assistant turn (no prefill)");

/* ---------- 3: effective-token budget ---------- */
const budget = new Function(`let agUseIn=0,agUseOut=0,agUseCr=0,agUseCw=0,agUseReason=0;${fns("agUsage", "effectiveTokens", "runTokens")};return {set:(i,o,c)=>{agUseIn=i;agUseOut=o;agUseCr=c},runTokens,effectiveTokens}`)();
budget.set(100000, 2000, 90000);
assert.equal(budget.runTokens({ usageStart: { input: 0, output: 0, cached: 0 } }), 21000, "cache reads count 10% of their volume");

/* ---------- 4: retry, escalation, and compatibility ---------- */
const retry = new Function(`
  const AG_PROVIDER_DEFS={anthropic:{label:"Anthropic"}},AG_MAX_RETRIES=5,fmtTok=String;const agTrunc=(v,n)=>String(v).slice(0,n);
  let agProvider="anthropic",agStop=false,agPauseRequested=false,agAbortReason="",agAnthropicCompat=false,agAnthropicBetaOk=false,agRun={},agMaxOut=64000,agModelInfo=null,agModel="claude-opus-5-5",script=[],calls=[],slept=[];const events=[];
  ${fns("providerError", "agRetryableStatus", "agRetryAfterMs", "agRetryInfo", "agAbortError", "agRetryDelay", "anthropicModelFeatures", "agRunMaxOut", "agOutputCap", "agNextMaxOut", "apiStreamWithRetry")}
  async function apiStream(){calls.push({max:agRunMaxOut(),compat:agAnthropicCompat});const next=script.shift();if(next instanceof Error)throw next;return next}
  async function agRetrySleep(ms){slept.push(ms);if(script.stopDuringSleep){agStop=true;return false}return true}
  async function runEvent(type,summary){events.push(type)}
  function txDom(){return {remove(){}}}
  return {providerError,agRetryableStatus,agRetryAfterMs,agRetryDelay,run:async(s,opts={})=>{script=s;script.stopDuringSleep=opts.stop;calls=[];slept=[];events.length=0;agStop=false;agRun={};agAnthropicCompat=false;agAnthropicBetaOk=!!opts.betaOk;try{return {result:await apiStreamWithRetry(),calls,slept,events:[...events]}}catch(error){return {error,calls,slept,events:[...events]}}}};
`)();
assert.deepEqual([408, 429, 500, 503, 529, 400, 401, 404].map(retry.agRetryableStatus), [true, true, true, true, true, false, false, false]);
assert.equal(retry.agRetryAfterMs(new Headers({ "retry-after": "3" })), 3000);
assert.equal(retry.agRetryAfterMs(new Headers({ "retry-after-ms": "250" })), 250);
for (let a = 1; a <= 8; a += 1) { const d = retry.agRetryDelay(a, 0); assert.ok(d >= 1500 && d <= 75000, `backoff ${a} is bounded`); }
assert.equal(retry.agRetryDelay(1, 500000), 120000, "retry-after is honored but capped");
const E = (msg, info) => retry.providerError(msg, info);
let out = await retry.run([E("529", { status: 529, retryable: true, kind: "server" }), E("reset", { kind: "network", retryable: true }), ["ok"]], { betaOk: true });
assert.deepEqual(out.result, ["ok"]); assert.equal(out.slept.length, 2); assert.deepEqual(out.events, ["model_retry", "model_retry"]);
out = await retry.run([E("cut", { kind: "max_tokens" }), E("cut", { kind: "max_tokens" }), ["done"]]);
assert.deepEqual(out.calls.map((c) => c.max), [64000, 128000], "max_tokens escalates once to the model output cap"); assert.ok(out.error, "a response that still hits the cap surfaces instead of looping");
out = await retry.run([E("400 fallbacks is not permitted", { status: 400 }), ["ok"]]);
assert.deepEqual(out.calls.map((c) => c.compat), [false, true], "a gateway that rejects optional features gets one compatibility retry");
out = await retry.run([E("offline", { kind: "network", retryable: true, beforeResponse: true }), ["ok"]]);
assert.deepEqual(out.calls.map((c) => c.compat), [false, true], "a pre-response failure before any beta success retries without betas");
out = await retry.run([E("bad request", { status: 400 })], { betaOk: true });
assert.ok(out.error && out.calls.length === 1, "non-retryable errors surface immediately");
out = await retry.run(Array.from({ length: 8 }, () => E("529", { status: 529, retryable: true })), { betaOk: true });
assert.equal(out.calls.length, 6, "retries are bounded");
out = await retry.run([E("529", { status: 529, retryable: true }), ["never"]], { betaOk: true, stop: true });
assert.equal(out.error && out.error.name, "AbortError", "Stop during a backoff wait aborts the retry loop");

/* ---------- 5: kernel worker protocol ---------- */
const workerMain = new Function(`${functionSource(desktop, "kernelWorkerMain")};return kernelWorkerMain`)();
const files = new Map(), globals = new Map();
globalThis.loadPyodide = async () => ({
  loadedPackages: { micropip: "default" }, setInterruptBuffer() {},
  globals: { set: (k, v) => globals.set(k, v) },
  runPythonAsync: async (code) => (code.includes("sys.version") ? "3.13.2" : code === "boom" ? Promise.reject(new Error("PythonError: boom")) : "ran:" + code + ":" + JSON.stringify([...globals])),
  loadPackagesFromImports: async (src, o) => o.messageCallback("Loading numpy"),
  loadPackage: async () => {},
  FS: { mkdirTree() {}, writeFile: (p, b) => files.set(p, b), readFile: (p) => { if (!files.has(p)) throw new Error("ENOENT"); return new Uint8Array(files.get(p)); }, unlink: (p) => files.delete(p), stat: (p) => { if (!files.has(p)) throw new Error("ENOENT"); return { size: files.get(p).length, mtime: new Date(5) }; } },
});
const posted = [], scope = { load: async () => {}, postMessage: (d) => posted.push(d) };
workerMain(scope);
const call = (id, op, args) => { scope.onmessage({ data: { id, op, args } }); };
call(1, "run", { code: "early" });
call(2, "boot", { indexURL: "x/", harness: "H" });
call(3, "run", { code: "cell", vars: { __cell_src: "1+1" } });
call(4, "fsWrite", { path: "a/b.csv", bytes: new Uint8Array([1, 2]) });
call(5, "fsStat", { paths: ["a/b.csv", "missing"] });
call(6, "fsRead", { path: "a/b.csv" });
call(7, "loadFromImports", { src: "import numpy" });
call(8, "run", { code: "boom" });
call(9, "nope", {});
await new Promise((r) => setTimeout(r, 20));
const byId = Object.fromEntries(posted.filter((p) => p.progress == null).map((p) => [p.id, p]));
assert.match(byId[1].error.message, /not initialized/, "work sent before boot fails clearly instead of touching a null interpreter");
assert.equal(byId[2].result.version, "3.13.2");
assert.match(byId[3].result.value, /__cell_src/, "run sets its variables before executing");
assert.deepEqual(byId[5].result, { "a/b.csv": { size: 2, mtime: 5 }, missing: null });
assert.deepEqual([...byId[6].result], [1, 2]);
assert.ok(posted.some((p) => p.id === 7 && p.progress === "Loading numpy"), "package progress streams back to the page");
assert.equal(byId[8].ok, false); assert.match(byId[9].error.message, /Unknown kernel operation/);
assert.deepEqual(posted.filter((p) => p.progress == null).map((p) => p.id), [1, 2, 3, 4, 5, 6, 7, 8, 9], "operations complete strictly in order");

/* ---------- 6: content-addressed artifact bytes ---------- */
const blobs = new Function(`
  let dataFiles=[];const store=new Map();${functionSource(desktop, "crc32").replace(/^function crc32/, "let crcTable=null;function crc32")}
  async function blobGet(hash){return store.get(hash)||null}
  ${fns("blobHash", "artifactBytes")}
  return {blobHash,artifactBytes,setFiles:(f)=>{dataFiles=f},store};
`)();
const hash = await blobs.blobHash(new TextEncoder().encode("abc"));
assert.equal(hash, "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "artifact payloads are keyed by SHA-256");
blobs.store.set("h-old", new Uint8Array([1])); blobs.setFiles([{ id: "f1", blob: "h-new", bytes: new Uint8Array([9]) }]);
assert.deepEqual([...await blobs.artifactBytes({ id: "f1", blob: "h-old" })], [1], "a checkpoint reference reads its own content, not the live file with the same id");
assert.deepEqual([...await blobs.artifactBytes({ id: "f1", bytes: new Uint8Array([7]) })], [7], "legacy embedded bytes win over live data");
assert.deepEqual([...await blobs.artifactBytes({ id: "zz", blob: "h-new" })], [9], "live bytes are reused when the content hash matches");
const zip = new Function(`${declarations(desktop, ...["ZIP_UTF8", "crcTable", "crc32", "zipHeader", "z16", "z32", "joinBytes", "zipStore", "zipStoreParts", "zipReadStore"])};return {zipStore,zipStoreParts,zipReadStore}`)();
const entries = [{ name: "a.txt", data: new TextEncoder().encode("hello") }, { name: "b.bin", data: new Uint8Array([0, 255]) }];
const parts = zip.zipStoreParts(entries);
assert.ok(Array.isArray(parts) && parts.length > 3, "exports stream ZIP parts instead of one joined buffer");
assert.deepEqual(new Uint8Array(await new Blob(parts).arrayBuffer()), zip.zipStore(entries), "Blob parts and the joined archive are byte-identical");
assert.deepEqual([...zip.zipReadStore(zip.zipStore(entries)).get("b.bin")], [0, 255]);
const exportSource = functionSource(desktop, "downloadWorkspaceZip");
assert.ok(has(exportSource, "written.has(hash)") && has(exportSource, "new Blob(zipStoreParts(entries)"), "full exports write each unique payload once from Blob parts");
assert.ok(has(functionSource(desktop, "gcBlobs"), "cutoff") && !has(functionSource(desktop, "kdbEach"), "catch"), "garbage collection never sweeps from a partial scan or races recent writes");

/* ---------- 2: add-and-run tools ---------- */
const agTools = new Function(`${declarations(desktop, "AG_TOOLS")};return AG_TOOLS`)();
for (const tool of ["add_cells", "edit_cell"]) assert.equal(agTools.find((t) => t.name === tool).input_schema.properties.run.type, "boolean", `${tool} accepts run:true`);
const exclusion = new Function(`let cells=[{id:"h",type:"code"}],dataFiles=[],agContextPolicies={cells:{h:"excluded"},artifacts:{}};${fns("getCellContextPolicy", "getArtifactContextPolicy", "agentStateExclusionReason")};return agentStateExclusionReason`)();
assert.match(exclusion("add_cells", { run: true, cells: [] }), /BLOCKED/, "add-and-run respects the shared-runtime exclusion barrier");
assert.equal(exclusion("add_cells", { cells: [] }), "", "staging cells without running stays allowed");

console.log("KERNEL Agent v2.4.0 verification passed (cache-stable prompts, Claude adapter, retries, add-and-run, effective budgets, worker protocol, and content-addressed artifacts).");
