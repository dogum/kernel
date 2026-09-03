#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";

const desktopPath = "docs/kernel-agent.html";
const mobilePath = "docs/kernel-agent-mobile.html";
const desktop = fs.readFileSync(desktopPath, "utf8");
const mobile = fs.readFileSync(mobilePath, "utf8");

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
  let start = text.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  if (text.slice(Math.max(0, start - 6), start) === "async ") start -= 6;
  const tail = text.slice(start + 1);
  const next = /\n(?:async )?function [A-Za-z_$]/.exec(tail);
  return text.slice(start, next ? start + 1 + next.index : text.length).trimEnd();
}

for (const [file, text] of [[desktopPath, desktop], [mobilePath, mobile]]) {
  for (const [index, body] of scripts(text).entries()) {
    assert.doesNotThrow(() => new Function(body), `${file} inline script ${index} parses`);
  }
  const ids = [...text.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, `${file} has unique DOM ids`);
}
assert.equal(sharedRuntime(desktop), sharedRuntime(mobile), "desktop and mobile have a byte-identical core");
assert.ok(/function init\(\)\{[\s\S]*?initPanels\(\);\s*activateNotebookAgent\(nbId\);\s*bootKernel\(\);/.test(desktop), "desktop initializes the active notebook thread");
assert.ok(/function init\(\)\{[\s\S]*?initPanels\(\);\s*activateNotebookAgent\(nbId\);\s*bootKernel\(\);/.test(mobile), "mobile initializes the active notebook thread");
assert.ok(!functionSource(desktop,"cloneNotebookWorkspace").includes("id:artifactId()"), "notebook duplication preserves artifact IDs used by lineage and context policy");
assert.ok(functionSource(desktop,"kdbOpen").includes("db.close();kdbPromise=null"), "a version-changed IndexedDB connection can reopen cleanly");
const deleteThread=functionSource(desktop,"deleteAgentThread");
assert.ok(deleteThread.includes("kdbRuns(nbId,m.id)") && deleteThread.includes("kdbCheckpoints(nbId,m.id)"), "deleting a thread also deletes its private run and checkpoint history");

for (const id of [
  "agRunBar", "agRuns", "agCheckpoint", "agPause", "agRecovery", "agResume", "agAbandon",
  "runScrim", "runPlan", "runTimeline", "runCheckpoints", "runNotebook", "compareProfiles",
  "comparePrompt", "compareResults", "ctxSelection", "dataFolderUpload", "fileFolder",
  "agAutoExtensions", "runPrivateZip",
]) assert.ok(desktop.includes(`id="${id}"`) && mobile.includes(`id="${id}"`), `${id} exists in both builds`);
assert.ok(desktop.includes('data-mi="runZip"') && mobile.includes('data-mi="runZip"'), "private run ZIP is available in both More menus");

for (const [label, needle] of [
  ["v2.3 contract", "AGENT-V23-SPEC.md"],
  ["run store", 'createObjectStore("runs"'],
  ["checkpoint store", 'createObjectStore("checkpoints"'],
  ["run recovery", "repairInterruptedRun"],
  ["pause and resume", "resumeAgentRun"],
  ["three budgets", "maxTotalTokens"],
  ["event ledger", "tool_batch_committed"],
  ["visible plan", "update_plan"],
  ["dependency analysis", "analyzeCellSource"],
  ["output provenance", "environmentHash"],
  ["context controls", "agContextPolicies"],
  ["artifact lifecycle", "set_artifact_stage"],
  ["folder uploads", "webkitRelativePath"],
  ["environment snapshot", "_environment_snapshot"],
  ["exact checkpoint fork", "restoreCheckpoint(checkpoint,true)"],
  ["read-only comparison", "compareProfile"],
  ["share-safe archive", "kernel-share"],
  ["diagnostics allowlist", "kernel-diagnostics"],
  ["completion contract", "finish_run"],
  ["adaptive AUTO budgets", "budget_auto_extended"],
]) assert.ok(desktop.includes(needle), `includes ${label}`);

const discoveryFactory=new Function(`
  ${functionSource(desktop,"contextFromModel")}
  ${functionSource(desktop,"compatibleDiscoveredModel")}
  ${functionSource(desktop,"modelCapabilities")}
  return {contextFromModel,compatibleDiscoveredModel,modelCapabilities};
`);
const discovery=discoveryFactory();
assert.equal(discovery.contextFromModel({context_length:500000}),500000,"xAI context_length metadata is recognized");
assert.equal(discovery.contextFromModel({capabilities:{context_window:1000000}}),1000000,"nested provider context metadata is recognized");
assert.equal(discovery.compatibleDiscoveredModel("openai","text-embedding-3-large",{}),false,"OpenAI embedding models are excluded from the agent picker");
assert.equal(discovery.compatibleDiscoveredModel("xai","grok-imagine-image",{input_modalities:["image"]}),false,"xAI image-only models are excluded from the agent picker");
assert.equal(discovery.modelCapabilities("openai","gpt-5.6",{}).tools,true,"known Responses text models retain tool capability fallback");
assert.equal(discovery.modelCapabilities("xai","grok-code-fast-1",{input_modalities:["text"]}).vision,false,"explicit text-only modalities override name heuristics");

const pathFactory = new Function(`
  let dataFiles=[];
  ${functionSource(desktop, "safeArtifactPath")}
  ${functionSource(desktop, "collisionSafePath")}
  ${functionSource(desktop, "uniqueArtifactPath")}
  return {safeArtifactPath, uniqueArtifactPath, setFiles:(value)=>{dataFiles=value}};
`);
const paths = pathFactory();
assert.equal(paths.safeArtifactPath("folder/δ data.csv"), "folder/δ data.csv", "safe Unicode relative paths survive");
for (const unsafe of ["", "/etc/passwd", "../secret", "a/../secret", "a//b", "C:\\secret", "\u0001"]) {
  assert.throws(() => paths.safeArtifactPath(unsafe), `rejects unsafe path ${JSON.stringify(unsafe)}`);
}
paths.setFiles([{ id: "f1", path: "folder/report.csv", name: "folder/report.csv" }]);
assert.equal(paths.uniqueArtifactPath("folder/report.csv"), "folder/report (2).csv", "collisions receive a deterministic suffix");

const archiveFactory = new Function(`
  ${functionSource(desktop, "safeArtifactPath")}
  ${functionSource(desktop, "archiveEntityId")}
  ${functionSource(desktop, "hydrateCheckpointArtifacts")}
  return {hydrateCheckpointArtifacts};
`);
const archiveValidation = archiveFactory();
const checkpointFixture = { id:"cp_1",threadId:"t_1",cells:[],workspace:{artifacts:[{id:"f_1",path:"results/δ.csv",size:3,entry:"checkpoint-artifacts/cp_1/0001.bin"}]}};
const hydratedCheckpoint = archiveValidation.hydrateCheckpointArtifacts(structuredClone(checkpointFixture), new Map([["checkpoint-artifacts/cp_1/0001.bin", new Uint8Array([1,2,3])]]));
assert.deepEqual([...hydratedCheckpoint.workspace.artifacts[0].bytes], [1,2,3], "checkpoint artifacts are validated before hydration");
const unsafeCheckpoint = structuredClone(checkpointFixture);unsafeCheckpoint.workspace.artifacts[0].path="../escape.csv";
assert.throws(() => archiveValidation.hydrateCheckpointArtifacts(unsafeCheckpoint, new Map([["checkpoint-artifacts/cp_1/0001.bin", new Uint8Array([1,2,3])]])), /traversal/, "checkpoint paths cannot escape the workspace");

const depsFactory = new Function(`
  const PY_DEP_WORDS=new Set("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case print len range int float str list dict set tuple bool bytes type isinstance enumerate zip map filter sorted reversed sum min max abs round open input super object repr format getattr setattr hasattr self cls".split(" "));
  let dependencyRevision=0,kernelGeneration=0,environmentSnapshot={runtimeHash:"env-1"},cells=[],dataFiles=[];
  const ui={splitOutputs:false},syncCardFor=()=>{},findCell=(id)=>cells.find((c)=>c.id===id)||null,indexOf=(c)=>cells.indexOf(c),artifactFingerprint=(d)=>d.fingerprint||"";
  ${functionSource(desktop, "sourceHash")}
  ${functionSource(desktop, "analyzeCellSource")}
  ${functionSource(desktop, "recomputeDependencies")}
  ${functionSource(desktop, "cellFreshness")}
  ${functionSource(desktop, "refreshNotebookFreshness")}
  return {sourceHash,analyzeCellSource,recomputeDependencies,refreshNotebookFreshness,setCells:(value)=>{cells=value;return cells}};
`);
const deps = depsFactory();
assert.equal(deps.analyzeCellSource('exec("x=1")').uncertain, true, "dynamic execution is marked uncertain");
assert.ok(deps.analyzeCellSource("df = df.dropna()").uses.includes("df"), "self-referential assignment keeps its upstream read");
assert.ok(deps.analyzeCellSource("x += 1").uses.includes("x"), "augmented assignment keeps its upstream read");
assert.ok(!deps.analyzeCellSource("x = 1").uses.includes("x"), "a plain assignment does not invent an upstream read");
const graph = deps.setCells([
  { id: "c1", type: "code", source: "x = 1", outputs: [{}], el: null },
  { id: "c2", type: "code", source: "y = x + 1", outputs: [{}], el: null },
  { id: "c3", type: "code", source: "z = y + 1", outputs: [{}], el: null },
  { id: "c4", type: "code", source: "x = 2", outputs: [], el: null },
  { id: "c5", type: "code", source: "q = x + 1", outputs: [], el: null },
]);
deps.recomputeDependencies();
assert.deepEqual(graph[1].dependencies, ["c1"], "a read binds to the nearest preceding definition");
assert.deepEqual(graph[4].dependencies, ["c4"], "a later redefinition takes precedence");
for (const c of graph.slice(0, 3)) {
  c.provenance = {
    sourceHash: deps.sourceHash(c.source), environmentHash: "env-1", artifacts: [], staleReasons: [],
    dependencies: c.dependencies.map((id) => ({ cellId: id, sourceHash: deps.sourceHash(graph.find((x) => x.id === id).source), runId: "run-1" })),
    runId: "run-1",
  };
}
deps.refreshNotebookFreshness();
assert.ok(graph.slice(0, 3).every((c) => c.freshness === "fresh"), "matching lineage is fresh");
graph[0].source = "x = 99";
deps.recomputeDependencies();
assert.equal(graph[0].freshness, "stale", "editing executed source marks its output stale");
assert.equal(graph[2].freshness, "stale", "staleness propagates transitively");
const reassignmentGraph=deps.setCells([{id:"seed",type:"code",source:"df = raw",outputs:[],el:null},{id:"clean",type:"code",source:"df = df.dropna()",outputs:[],el:null}]);
deps.recomputeDependencies();
assert.deepEqual(reassignmentGraph[1].dependencies,["seed"],"a read-then-write cell depends on the preceding definition");
const imported = deps.setCells([{ id: "old", type: "code", source: "1", outputs: [{}], provenance: null, el: null }]);
deps.recomputeDependencies();
assert.equal(imported[0].freshness, "historical", "outputs without lineage are historical, not falsely fresh");

const runFactory = new Function(`
  let agUseIn=0,agUseOut=0,agRun=null;const saved=[];
  ${functionSource(desktop, "runElapsed")}
  ${functionSource(desktop, "runTokens")}
  ${functionSource(desktop, "runBudgetReasons")}
  ${functionSource(desktop, "runBudgetReason")}
  async function saveRun(run){saved.push(JSON.parse(JSON.stringify(run)))}
  ${functionSource(desktop, "runEvent")}
  return {budget:(r,usage)=>{agRun=r;agUseIn=usage.input;agUseOut=usage.output;return runBudgetReason(r)},event:async(r,type,extra)=>{agRun=r;return runEvent(type,"summary",extra)},saved};
`);
const run = runFactory();
const budgetBase = { toolCalls: 2, activeElapsedMs: 100, activeSince: null, usageStart: { input: 10, output: 5 }, budgets: { maxToolCalls: 2, maxElapsedMs: 1000, maxTotalTokens: 100 } };
assert.equal(run.budget(structuredClone(budgetBase), { input: 10, output: 5 }), "tool call budget reached", "tool budget is enforced before the next tool");
const tokenRun = structuredClone(budgetBase);tokenRun.toolCalls=0;tokenRun.budgets.maxToolCalls=9;
assert.equal(run.budget(tokenRun, { input: 90, output: 30 }), "token budget reached", "reported input plus output tokens enforce the run budget");
const eventRun = { seq: 0, phase: "tool", events: [] };
const ev1 = await run.event(eventRun, "one", { seq: 99, type: "tamper" });
const ev2 = await run.event(eventRun, "two", {});
assert.deepEqual([ev1.seq, ev2.seq], [1, 2], "event sequence is monotonic and cannot be overridden");
assert.deepEqual([ev1.type, ev2.type], ["one", "two"], "event type cannot be overridden");

const adaptiveBudgetFactory = new Function(`
  let agUseIn=0,agUseOut=0,agRun=null,agAutonomy="auto",agMaxSteps=10,agMaxMinutes=30,agTokenBudget=500000;const events=[];
  const fmtTok=(n)=>String(n);
  ${functionSource(desktop, "runElapsed")}
  ${functionSource(desktop, "runTokens")}
  ${functionSource(desktop, "runBudgetReasons")}
  ${functionSource(desktop, "runBudgetReason")}
  ${functionSource(desktop, "extendRunBudgets")}
  async function runEvent(type,summary){events.push({type,summary})}
  ${functionSource(desktop, "maybeAutoExtendBudgets")}
  return {run:async(r,usage)=>{agRun=r;agUseIn=usage.input||0;agUseOut=usage.output||0;const reasons=runBudgetReasons(r),extended=await maybeAutoExtendBudgets(reasons);return {r,reasons,extended,events:[...events]}}};
` )();
const healthyExtension = await adaptiveBudgetFactory.run({autonomy:"auto",toolCalls:10,progressVersion:2,lastAutoExtensionProgress:1,autoExtensionsUsed:0,consecutiveToolFailures:0,usageStart:{input:0,output:0},budgets:{maxToolCalls:10,maxElapsedMs:600000,maxTotalTokens:500000,toolSegment:10,maxAutoExtensions:2}}, {input:10,output:1});
assert.equal(healthyExtension.extended,true,"AUTO extends a reached tool checkpoint when notebook progress continued");
assert.equal(healthyExtension.r.budgets.maxToolCalls,20,"AUTO extends only the reached tool checkpoint by its configured segment");
assert.equal(healthyExtension.r.autoExtensionsUsed,1,"automatic extensions are durable and bounded");
const hardToken = await adaptiveBudgetFactory.run({autonomy:"auto",toolCalls:0,progressVersion:2,lastAutoExtensionProgress:1,autoExtensionsUsed:0,usageStart:{input:0,output:0},budgets:{maxToolCalls:10,maxElapsedMs:600000,maxTotalTokens:100,maxAutoExtensions:3}}, {input:100,output:1});
assert.equal(hardToken.extended,false,"the explicit token budget remains a hard human boundary");
const stalledExtension = await adaptiveBudgetFactory.run({autonomy:"auto",toolCalls:10,progressVersion:1,lastAutoExtensionProgress:1,autoExtensionsUsed:0,usageStart:{input:0,output:0},budgets:{maxToolCalls:10,maxElapsedMs:600000,maxTotalTokens:500000,toolSegment:10,maxAutoExtensions:3}}, {input:1,output:1});
assert.equal(stalledExtension.extended,false,"AUTO does not extend a tool loop with no new progress");

const completionFactory = new Function(`
  let agRun=null,agPlan=[],agMsgs=[],paused=null,saves=0,evidenceMode="valid";const events=[],notices=[];
  ${functionSource(desktop, "runPlanSignature")}
  ${functionSource(desktop, "completionEvidenceSignature")}
  function validateCompletionEvidence(items){
    if(evidenceMode==="missing")return {evidence:[],errors:["cell proof no longer exists"]};
    const evidence=JSON.parse(JSON.stringify(items||[]));
    if(evidenceMode==="changed"&&evidence[0])evidence[0].sourceHash="changed-after-acceptance";
    return {evidence,errors:[]};
  }
  async function runEvent(type,summary){events.push({type,summary})}
  async function pauseRun(reason,phase){paused={reason,phase};agRun.status="paused"}
  function txDom(kind,text){notices.push({kind,text})}
  async function saveActiveThreadNow(){saves++}
  ${functionSource(desktop, "recordCompletionRejection")}
  ${functionSource(desktop, "completionContractReason")}
  ${functionSource(desktop, "enforceCompletionContract")}
  return {check:async(r,plan)=>{agRun=r;agPlan=plan;agMsgs=[];paused=null;const result=await enforceCompletionContract();return {result,r,messages:agMsgs,paused,events:[...events],notices:[...notices],saves}},signature:(plan)=>{agPlan=plan;return runPlanSignature()},evidenceSignature:completionEvidenceSignature,setEvidenceMode:(mode)=>{evidenceMode=mode}};
`)();
assert.equal((await completionFactory.check({toolCalls:0},[])).result,"accepted","a simple no-tool answer remains lightweight");
const pendingPlan=[{id:"build",title:"Build",status:"in_progress"},{id:"report",title:"Report",status:"pending"}];
const guardedRun={toolCalls:4,completionGuardCount:0};
const firstGuard=await completionFactory.check(guardedRun,pendingPlan);
assert.equal(firstGuard.result,"continue","an unfinished planned run is continued rather than falsely completed");
assert.match(firstGuard.messages[0].content[0].text,/Do not summarize or claim a pause\/limit/,"the continuation explicitly rejects invented limits");
await completionFactory.check(guardedRun,pendingPlan);
const thirdGuard=await completionFactory.check(guardedRun,pendingPlan);
assert.equal(thirdGuard.result,"paused","repeated no-progress completion attempts pause safely instead of looping forever");
assert.equal(thirdGuard.paused.phase,"completion","the pause exposes completion as the authoritative reason");
const donePlan=[{id:"build",title:"Build",status:"completed"}];
const doneSignature=completionFactory.signature(donePlan);
const acceptedEvidence=[{kind:"cell",id:"proof",claim:"Verification passed",cellType:"code",executionCount:3,freshness:"fresh",sourceHash:"source-v1"}];
const acceptedRun={toolCalls:4,completionAccepted:{planSignature:doneSignature,evidence:acceptedEvidence,evidenceSignature:completionFactory.evidenceSignature(acceptedEvidence)}};
assert.equal((await completionFactory.check(structuredClone(acceptedRun),donePlan)).result,"accepted","finish evidence matching the completed plan unlocks successful completion");
completionFactory.setEvidenceMode("missing");
const missingEvidence=await completionFactory.check(structuredClone(acceptedRun),donePlan);
assert.equal(missingEvidence.result,"continue","deleted accepted evidence blocks finalization");
assert.match(missingEvidence.messages[0].content[0].text,/no longer valid/,"the continuation explains that accepted evidence disappeared");
completionFactory.setEvidenceMode("changed");
assert.equal((await completionFactory.check(structuredClone(acceptedRun),donePlan)).result,"continue","changed accepted evidence blocks finalization");
completionFactory.setEvidenceMode("valid");
assert.equal((await completionFactory.check({toolCalls:4},donePlan)).result,"continue","a completed plan still requires the explicit finish contract");
const evidenceFactory = new Function(`
  let cells=[],dataFiles=[],cellPolicies={},artifactPolicies={};
  function findCell(id){return cells.find((c)=>c.id===id)}
  function dataEntry(ref){return dataFiles.find((d)=>d.id===ref||d.path===ref||d.name===ref)}
  function getCellContextPolicy(id){return cellPolicies[id]||"auto"}
  function getArtifactContextPolicy(id){return artifactPolicies[id]||"auto"}
  function cellFreshness(cell){return {state:cell.freshness||"never"}}
  function sourceHash(source){return "hash:"+String(source||"")}
  function artifactStage(artifact){return artifact.stage||"scratch"}
  function artifactFingerprint(artifact){return "fingerprint:"+artifact.id}
  ${functionSource(desktop,"validateCompletionEvidence")}
  return {
    validate:validateCompletionEvidence,
    set:(nextCells,nextFiles,nextCellPolicies={},nextArtifactPolicies={})=>{cells=nextCells;dataFiles=nextFiles;cellPolicies=nextCellPolicies;artifactPolicies=nextArtifactPolicies},
  };
`)();
const freshCell={id:"cell_fresh",type:"code",source:"print(1)",execCount:7,freshness:"fresh",outputs:[{kind:"stream",text:"1"}]};
const finalArtifact={id:"artifact_final",path:"results/report.csv",name:"report.csv",stage:"final",size:42};
evidenceFactory.set([freshCell],[finalArtifact]);
const validEvidence=evidenceFactory.validate([{kind:"cell",id:"cell_fresh",claim:"The verification cell passed"},{kind:"artifact",id:"artifact_final",claim:"The final report exists"}]);
assert.equal(validEvidence.errors.length,0,"fresh cells and present artifacts form valid completion evidence");
assert.deepEqual(validEvidence.evidence.map((item)=>item.kind),["cell","artifact"],"validated evidence is normalized and application-owned");
assert.match(evidenceFactory.validate([{kind:"artifact",id:"results/report.csv",claim:"Path alias"}]).errors[0],/stable ID/,"artifact evidence cannot substitute a mutable path for its stable ID");
for(const cell of [
  {...freshCell,id:"cell_never",execCount:null,freshness:"never"},
  {...freshCell,id:"cell_stale",freshness:"stale"},
  {...freshCell,id:"cell_error",outputs:[{kind:"error",ename:"AssertionError"}]},
]){
  evidenceFactory.set([cell],[finalArtifact]);
  assert.equal(evidenceFactory.validate([{kind:"cell",id:cell.id,claim:"Unsupported claim"}]).evidence.length,0,`${cell.id} cannot prove completion`);
}
evidenceFactory.set([freshCell],[finalArtifact],{cell_fresh:"excluded"},{artifact_final:"excluded"});
assert.equal(evidenceFactory.validate([{kind:"cell",id:"cell_fresh",claim:"Hidden"},{kind:"artifact",id:"artifact_final",claim:"Hidden"}]).evidence.length,0,"excluded state cannot be cited as completion evidence");
assert.ok(desktop.includes("enum:['cell','artifact']"),"finish_run exposes structured stable-ID evidence to providers");
assert.ok(functionSource(desktop,"execTool").includes("validateCompletionEvidence(inp.evidence)") && functionSource(desktop,"execTool").includes("recordCompletionRejection(reason)") && functionSource(desktop,"execTool").includes("completionAccepted") && functionSource(desktop,"execTool").includes("Completion rejected"),"finish_run is application-validated and rejected calls enter the bounded completion guard");
assert.ok(functionSource(desktop,"completionContractReason").includes("completionEvidenceSignature(checked.evidence)"),"accepted evidence is revalidated immediately before finalization");
assert.ok(functionSource(desktop,"agentTurn").includes("enforceCompletionContract") && functionSource(desktop,"agentTurn").includes("Run completed after completion contract"),"no-tool model output cannot bypass the completion contract");
assert.ok(functionSource(desktop,"agRunControlContext").includes("Only KERNEL may report"),"the model receives authoritative run-state and anti-hallucination guidance");
assert.ok(!functionSource(desktop,"checkedStream").includes("runElapsed"),"a soft active-time checkpoint cannot masquerade as a connection timeout");

const recoveryFactory = new Function(`
  const clonePlain=(value)=>JSON.parse(JSON.stringify(value));let agMsgs=[],agRun=null,saves=0;
  ${functionSource(desktop, "runElapsed")}
  async function saveRun(){}
  ${functionSource(desktop, "runEvent")}
  async function saveActiveThreadNow(){saves++}
  ${functionSource(desktop, "repairInterruptedRun")}
  return {run:async(r,messages)=>{agMsgs=messages;const out=await repairInterruptedRun(r);return {out,messages:agMsgs,saves}}};
`);
const recovery = recoveryFactory();
const recovered = await recovery.run({ status:"running",phase:"tool",activeElapsedMs:5,activeSince:null,seq:0,events:[],pendingTools:[{id:"a"},{id:"b"}],completedToolResults:{a:[{type:"text",text:"done"}]} },[
  { role:"assistant",content:[{type:"tool_use",id:"a",name:"edit_cell",input:{}},{type:"tool_use",id:"b",name:"run_cell",input:{}}] },
]);
assert.equal(recovered.out.status, "interrupted", "reload converts a live run into an interrupted run");
assert.equal(recovered.out.pendingTools.length, 0, "recovery clears the executable pending cursor");
const repaired = recovered.messages.at(-1).content;
assert.equal(repaired[0].content[0].text, "done", "durably completed results are restored");
assert.match(repaired[1].content[0].text, /not durably confirmed/, "ambiguous tools are not silently repeated");

const checkpointBoundaryFactory=new Function(`
  const MUTATING_TOOLS=new Set(["edit_cell"]),clonePlain=(value)=>JSON.parse(JSON.stringify(value));
  let agRun=null,agMsgs=[],agStop=false,agPauseRequested=false,agAutonomy="auto",activeToolContext=null,agThreadId="thread",nbId="notebook",agSteps=0,rejectedFinish=false;
  let checkpoints=[],order=[],paused=null;
  const runBudgetReason=()=>"",enforceRunBudget=async()=>false,noteRunProgress=()=>{},redactText=String,agStateUi=()=>{},txDom=()=>{},persist=()=>{};
  async function runEvent(){}
  async function pauseRun(reason,phase){paused={reason,phase};agRun.status="paused"}
  async function askApproval(){return true}
  async function execTool(){if(rejectedFinish)agRun.completionPauseReason="invalid completion evidence";return [{type:"text",text:rejectedFinish?"Completion rejected":"ok"}]}
  async function saveWorkspaceState(){order.push("workspace")}
  async function saveActiveThreadNow(){order.push("thread")}
  async function createCheckpoint(label,reason,run){order.push("checkpoint");checkpoints.push({label,pending:clonePlain(run.pendingTools),messages:clonePlain(agMsgs),mutations:clonePlain(run.pendingMutations)});return {id:"cp"}}
  async function saveRun(){}
  async function finalizeRun(){}
  ${functionSource(desktop,"completePendingTools")}
  return {run:async(resumed,rejected=false)=>{checkpoints=[];order=[];paused=null;agStop=false;rejectedFinish=rejected;const tool={id:"call_1",name:rejected?"finish_run":"edit_cell",input:rejected?{}:{cell_id:"c1"}};agMsgs=[{role:"assistant",content:[{type:"tool_use",...tool}]}];agRun={id:"run",pendingTools:[tool],pendingToolResults:resumed?{call_1:[{type:"text",text:"ok"}]}:{},pendingMutations:resumed&&!rejected?["edit_cell"]:[],nextToolIndex:resumed?1:0,toolCalls:resumed?1:0,completedToolResults:{},completionPauseReason:""};const ok=await completePendingTools(nbId);return {ok,checkpoints,order,messages:agMsgs,paused}}};
`)();
for(const resumed of [false,true]){
  const committed=await checkpointBoundaryFactory.run(resumed),cp=committed.checkpoints[0];
  assert.equal(cp.pending.length,0,"a checkpoint never captures an executable pending cursor");
  assert.equal(cp.messages.at(-1).content[0].type,"tool_result","a mutation checkpoint includes its canonical tool result");
  assert.ok(committed.order.indexOf("thread")<committed.order.indexOf("checkpoint"),"tool results persist before mutation checkpoint capture");
}
const rejectedCompletionBatch=await checkpointBoundaryFactory.run(false,true);
assert.equal(rejectedCompletionBatch.ok,false,"a third rejected finish_run stops the automatic model loop");
assert.equal(rejectedCompletionBatch.paused.phase,"completion","the rejected finish_run pauses at the authoritative completion boundary");
assert.equal(rejectedCompletionBatch.messages.at(-1).content[0].type,"tool_result","the rejected finish_run result is committed before pausing");
assert.ok(functionSource(desktop,"createCheckpoint").includes("run.pendingTools&&run.pendingTools.length"),"manual checkpoints refuse an unmatched pending tool batch");
assert.ok(functionSource(desktop,"agentTurn").includes("Resume or end the current run"),"a new prompt cannot orphan an unfinished run boundary");

const adapterFactory = new Function(`
  ${functionSource(desktop, "sseDataLines")}
  return {sseDataLines};
`);
const adapters = adapterFactory();
assert.deepEqual(adapters.sseDataLines('data: {"last":true}', true).events, ['{"last":true}'], "a final unterminated SSE frame is processed");
assert.equal(adapters.sseDataLines('data: partial', false).events.length, 0, "an incomplete live SSE frame remains buffered");
const responseStream = functionSource(desktop, "streamResponses"),anthropicStream=functionSource(desktop, "streamAnthropic"),toolLoop=functionSource(desktop, "completePendingTools");
assert.ok(responseStream.includes("finalResponse.status==='incomplete'"), "incomplete Responses output cannot execute tools");
assert.ok(responseStream.includes("finalEvent==='response.completed'") && responseStream.includes("delete el.dataset.ephemeral"), "only authoritative Responses output becomes durable transcript content");
assert.ok(anthropicStream.includes("ev.type==='message_stop'") && anthropicStream.includes("!messageComplete"), "Anthropic requires its authoritative message stop before committing output");
assert.ok(toolLoop.includes("tool_'+outcome") && toolLoop.includes("outcome='failed'") && toolLoop.includes("inspect current notebook state before repeating"), "unexpected tool failures are committed as inspect-before-retry results");

const securityFactory = new Function(`
  let agConfigs={openai:{key:"sk-proj-THIS_IS_A_FAKE_SECRET_123"}};
  const esc=(s)=>String(s).replace(/[&<>]/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
  ${functionSource(desktop, "safeContentUrl")}
  ${functionSource(desktop, "redactText")}
  return {safeContentUrl,redactText};
`);
const security = securityFactory();
assert.equal(security.safeContentUrl("javascript:alert(1)", false), "#", "javascript links are rejected");
assert.equal(security.safeContentUrl("https://example.com/a", false), "https://example.com/a", "HTTPS links remain usable");
const secretText = 'sk-proj-THIS_IS_A_FAKE_SECRET_123\nAuthorization: Bearer token.value\npassword=hunter2\n-----BEGIN TEST PRIVATE KEY-----\nabc\n-----END TEST PRIVATE KEY-----';
const redacted = security.redactText(secretText);
assert.ok(!redacted.includes("THIS_IS_A_FAKE_SECRET") && !redacted.includes("hunter2") && !redacted.includes("token.value") && !redacted.includes("abc"), "configured and patterned credentials are redacted");
const sanitizer = functionSource(desktop, "sanitizeHtml");
assert.ok(sanitizer.includes('n.startsWith("on")') && sanitizer.includes('n==="srcset"') && sanitizer.includes("script,style") && sanitizer.includes("iframe"), "rich HTML sanitizer blocks active content and URL side channels");
const transcriptChips=functionSource(desktop,"fillTranscriptChips"),transcriptDom=functionSource(desktop,"txDom");
assert.ok(transcriptChips.includes("span.textContent") && transcriptDom.includes("fillTranscriptChips(el,content)"), "restored action chips are reconstructed as inert app-owned DOM");
assert.ok(transcriptDom.includes("Stored image omitted: unsupported source"), "restored transcript images cannot trigger arbitrary remote loads");
assert.ok(functionSource(desktop,"renderOutputs").includes("Figure omitted: invalid image payload"), "restored image outputs use a validated DOM path");

const tracebackFormatter = desktop.slice(desktop.indexOf("def _fmt_exc():"), desktop.indexOf("def _install_mpl_hooks():"));
assert.ok(tracebackFormatter.includes('startswith("kernel://")') && tracebackFormatter.includes('"notebookId":nbid') && tracebackFormatter.includes('"cellId":cellid') && tracebackFormatter.includes('"line":int(fr.lineno or 0)'), "structured Python tracebacks retain notebook, stable cell, and source-line routing metadata");
assert.ok(desktop.includes('linecache.cache[str(filename)]') && desktop.includes('"kernel://"+nbId+"/"+cell.id'), "cell source and stable virtual filename are registered before execution");
const tracebackRenderer = functionSource(desktop,"renderOutputs"),tracebackNavigator=functionSource(desktop,"focusCellLine");
assert.ok(tracebackRenderer.includes('focusCellLine(fr.cellId,fr.line)') && tracebackNavigator.includes('setSelectionRange'), "traceback actions navigate to the exact cell and source line");

const exclusionFactory=new Function(`
  let cells=[],dataFiles=[],agContextPolicies={cells:{},artifacts:{}};
  ${functionSource(desktop,"getCellContextPolicy")}
  ${functionSource(desktop,"getArtifactContextPolicy")}
  ${functionSource(desktop,"agentStateExclusionReason")}
  return {reason:agentStateExclusionReason,set:(nextCells,nextFiles,policies)=>{cells=nextCells;dataFiles=nextFiles;agContextPolicies=policies}};
`);
const exclusions=exclusionFactory();
exclusions.set([{id:"hidden",type:"code"}],[],{cells:{hidden:"excluded"},artifacts:{}});
for(const tool of ["run_cell","run_all","inspect_namespace","inspect_variable"])assert.match(exclusions.reason(tool,{}),/BLOCKED: 1 excluded code cell/,`${tool} cannot bypass an excluded cell through shared runtime state`);
assert.match(exclusions.reason("save_data_file",{}),/BLOCKED:/,"filesystem-backed save cannot copy hidden shared state");
assert.equal(exclusions.reason("save_data_file",{content:"model-owned"}),"","model-owned save content does not read shared runtime state");
exclusions.set([{id:"note",type:"markdown"}],[{id:"private"}],{cells:{note:"excluded"},artifacts:{private:"excluded"}});
assert.match(exclusions.reason("inspect_namespace",{}),/excluded artifact/,"namespace inspection cannot bypass an excluded mounted artifact");
const execToolSource=functionSource(desktop,"execTool");
assert.ok(execToolSource.includes("agentStateExclusionReason(name,inp)") && execToolSource.includes("getCellContextPolicy(ce.id)==='excluded'") && execToolSource.includes("getArtifactContextPolicy(existing.id)==='excluded'"),"runtime and direct mutation tools enforce exclusion at execution time");

const contextFactory = new Function(`
  const clonePlain=(value)=>JSON.parse(JSON.stringify(value)),AG_OLD_TEXT=18000,agTrunc=(value,n)=>String(value||"").slice(0,n);
  let agMsgs=[],cells=[],dataFiles=[],agContextPolicies={cells:{},artifacts:{}};
  const getCellContextPolicy=(id)=>agContextPolicies.cells[id]||"auto",getArtifactContextPolicy=(id)=>agContextPolicies.artifacts[id]||"auto";
  ${functionSource(desktop, "isHumanMessage")}
  ${functionSource(desktop, "prunedMessages")}
  return {prune:(messages,nextCells,nextFiles,policies)=>{agMsgs=messages;cells=nextCells;dataFiles=nextFiles;agContextPolicies=policies;return prunedMessages()}};
`);
const context = contextFactory();
const fullHistory = [
  {role:"assistant",content:[{type:"tool_use",id:"call_cell",name:"read_cell",input:{cell_id:"secret",source:"TOPSECRET_CELL"},provider_item:{type:"function_call",arguments:"TOPSECRET_CELL"}}]},
  {role:"user",content:[{type:"tool_result",tool_use_id:"call_cell",content:[{type:"text",text:"TOPSECRET_RESULT"}]}]},
  {role:"assistant",content:[{type:"tool_use",id:"call_state",name:"run_all",input:{}}]},
  {role:"user",content:[{type:"tool_result",tool_use_id:"call_state",content:[{type:"text",text:"TOPSECRET_STATE"}]}]},
  {role:"assistant",content:[{type:"tool_use",id:"call_files",name:"list_data_files",input:{}}]},
  {role:"user",content:[{type:"tool_result",tool_use_id:"call_files",content:[{type:"text",text:"artifact://private_file · private/input.csv"}]}]},
];
const outbound = context.prune(fullHistory,[{id:"secret"}],[{id:"private_file",path:"private/input.csv"}],{cells:{secret:"excluded"},artifacts:{private_file:"excluded"}});
const outboundText=JSON.stringify(outbound),storedText=JSON.stringify(fullHistory);
assert.ok(storedText.includes("TOPSECRET_CELL") && storedText.includes("TOPSECRET_RESULT"), "the full local thread remains lossless");
for(const secret of ["TOPSECRET_CELL","TOPSECRET_RESULT","TOPSECRET_STATE","private/input.csv"])assert.ok(!outboundText.includes(secret), `excluded context omits ${secret}`);
assert.ok(!outboundText.includes("provider_item"), "excluded provider-native function payloads are rebuilt without the hidden arguments");

const contextBudgetFactory=new Function(`
  const clonePlain=(value)=>JSON.parse(JSON.stringify(value)),AG_OLD_TEXT=1500,agTrunc=(value,n)=>String(value||"").slice(0,n),DOCS="system",AG_TOOLS=[];
  let agMsgs=[],agLastContext=null,pinned="",cells=[],dataFiles=[];const agCompactAt=82,agMaxOut=512,agCtxLimit=()=>2400,meterUi=()=>{},getCellContextPolicy=()=>"auto",getArtifactContextPolicy=()=>"auto",buildPinnedContext=()=>pinned;
  ${functionSource(desktop,"estBlocks")}
  ${functionSource(desktop,"agEstCtx")}
  ${functionSource(desktop,"isHumanMessage")}
  ${functionSource(desktop,"prunedMessages")}
  ${functionSource(desktop,"summarizeSegments")}
  ${functionSource(desktop,"prepareContext")}
  return {run:(messages,pin)=>{agMsgs=messages;pinned=pin;return prepareContext()}};
`);
const contextBudget=contextBudgetFactory();
const pinOverflow=contextBudget.run([{role:"user",content:[{type:"text",text:"new request"}]}],"P".repeat(10000));
assert.equal(pinOverflow.unfit,true,"oversized pinned context refuses to send instead of silently dropping the pin");
assert.match(pinOverflow.reason,/lower max output|Exclude content/,"pin overflow returns an actionable remedy");

const fullExport = functionSource(desktop, "downloadWorkspaceZip");
const privateRunExport = functionSource(desktop, "downloadPrivateRunZip");
const shareExport = functionSource(desktop, "downloadShareSafeZip");
const diagnostics = functionSource(desktop, "diagnosticSnapshot");
assert.ok(fullExport.includes('version:3') && fullExport.includes('runs/') && fullExport.includes('checkpoints/'), "full export contains the v3 durable state");
assert.ok(fullExport.includes('includeCheckpoints?await kdbCheckpoints(nbId):[]') && fullExport.includes('export_profile:includeCheckpoints?"full":"private-run"'), "private run export omits checkpoint reads while preserving notebook, thread, run, and artifact state");
assert.ok(privateRunExport.includes('includeCheckpoints:false'), "private run ZIP requests the checkpoint-free review profile");
const workspaceImport = functionSource(desktop, "importWorkspaceZip");
assert.ok(workspaceImport.includes("![2,3].includes"), "workspace import remains compatible with v2 and v3");
assert.ok(workspaceImport.includes("checkpointMap.get(r.checkpointId)"), "import remaps run/checkpoint links instead of severing them");
assert.ok(shareExport.includes("includeConversation:false") && shareExport.includes("artifactStage(f)==='final'"), "share-safe export excludes conversation and selects only final artifacts");
assert.ok(!shareExport.includes("kdbThreads(") && !shareExport.includes("kdbRuns(") && !shareExport.includes("kdbCheckpoints("), "share-safe export cannot serialize thread/run/checkpoint stores");
assert.ok(!diagnostics.includes("cellPayload(") && !diagnostics.includes("collectWorkspaceFiles(") && !diagnostics.includes("clonePlain(agMsgs"), "diagnostics use counts rather than source, files, or message bodies");
for (const body of [fullExport, shareExport, diagnostics, functionSource(desktop, "agExportBundle")]) {
  assert.ok(!body.includes("AG_CONFIG_KEY") && !body.includes("localStorage.getItem(AG_CONFIG_KEY"), "exports never read the credential store");
}
const compare = functionSource(desktop, "compareProfile");
assert.ok(compare.includes("read-only comparison mode") && !/\btools\s*:/.test(compare), "comparison profiles receive no mutation tools");

const sw = fs.readFileSync("docs/kernel-agent-sw.js", "utf8");
assert.ok(sw.includes("kernel-a-mobile-v231-1"), "service-worker cache is versioned for v2.3.1");
assert.ok(sw.includes("k.indexOf('kernel-a-mobile-')===0"), "activation deletes only KERNEL-owned caches");
assert.ok(fs.readFileSync("AGENT-V23-SPEC.md", "utf8").includes("## 13. Acceptance gates"), "the v2.3 acceptance contract is committed");

console.log("KERNEL Agent v2.3.1 verification passed (completion integrity, adaptive budgets, durability, lineage, portability, security, and desktop/mobile parity).");
