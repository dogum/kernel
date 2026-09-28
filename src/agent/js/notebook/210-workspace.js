/* ===== durable per-notebook workspace (large state lives in IndexedDB) ===== */
const KDB_NAME="kernel.workspace.v2",KDB_VERSION=3;
let kdbPromise=null,workspaceTimer=null,workspaceLoading=false,workspaceArchiveImport=false;
const kdbMemory={workspaces:new Map(),threads:new Map(),runs:new Map(),checkpoints:new Map(),blobs:new Map()};let kdbWarned=false,kdbQuotaWarned=false,kdbLastError=null;
function kdbFallback(error){kdbLastError=error||kdbLastError;const quota=error&&(error.name==="QuotaExceededError"||/quota/i.test(String(error.message||"")));if(quota&&!kdbQuotaWarned){kdbQuotaWarned=true;console.warn("Browser storage quota reached; keeping new workspace state in memory",error);toast("Browser storage is full · Save ZIP now, then delete old notebooks or checkpoints.","err");return}if(!kdbWarned){kdbWarned=true;console.warn("Persistent workspace storage unavailable; using an in-memory fallback",error);toast("Persistent browser storage is unavailable · Save ZIP before closing.","err")}}
function kdbKey(value){return value&&(value.key||value.id||value.notebookId||value.hash)}
function kdbClone(value){try{return structuredClone(value)}catch(e){return value}}
function kdbOpen(){
  if(kdbPromise)return kdbPromise;
  kdbPromise=new Promise((resolve,reject)=>{
    if(!window.indexedDB){reject(new Error("IndexedDB unavailable"));return}
    const req=indexedDB.open(KDB_NAME,KDB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains("workspaces"))db.createObjectStore("workspaces",{keyPath:"notebookId"});
      if(!db.objectStoreNames.contains("threads")){
        const st=db.createObjectStore("threads",{keyPath:"key"});st.createIndex("notebookId","notebookId",{unique:false});
      }
      if(!db.objectStoreNames.contains("runs")){const st=db.createObjectStore("runs",{keyPath:"id"});st.createIndex("notebookId","notebookId",{unique:false});st.createIndex("threadKey","threadKey",{unique:false});st.createIndex("updated","updated",{unique:false})}
      if(!db.objectStoreNames.contains("checkpoints")){const st=db.createObjectStore("checkpoints",{keyPath:"id"});st.createIndex("notebookId","notebookId",{unique:false});st.createIndex("threadKey","threadKey",{unique:false});st.createIndex("created","created",{unique:false})}
      if(!db.objectStoreNames.contains("blobs")){const st=db.createObjectStore("blobs",{keyPath:"hash"});st.createIndex("created","created",{unique:false})}
    };
    req.onsuccess=()=>{const db=req.result;db.onversionchange=()=>{db.close();kdbPromise=null};resolve(db)};req.onblocked=()=>{kdbPromise=null;reject(new Error("Close other KERNEL tabs to upgrade workspace storage"))};req.onerror=()=>{kdbLastError=req.error||new Error("Could not open workspace database");kdbPromise=null;reject(kdbLastError)};
  });
  return kdbPromise;
}
async function kdbRequest(store,mode,fn){
  const db=await kdbOpen();
  return await new Promise((resolve,reject)=>{
    const tx=db.transaction(store,mode),st=tx.objectStore(store);let req,result;
    try{req=fn(st)}catch(e){reject(e);return}
    req.onsuccess=()=>{result=req.result};req.onerror=()=>reject(req.error||new Error("Workspace database operation failed"));tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error||new Error("Workspace transaction aborted"));tx.onerror=()=>reject(tx.error||new Error("Workspace transaction failed"));
  });
}
/* A value that failed to persist lives in kdbMemory and is always newer than its IndexedDB copy, so reads prefer it. */
async function kdbGet(store,key){if(kdbMemory[store].has(key))return kdbClone(kdbMemory[store].get(key));try{return await kdbRequest(store,"readonly",st=>st.get(key))}catch(e){kdbFallback(e);return null}}
async function kdbPut(store,value){const key=kdbKey(value);try{const out=await kdbRequest(store,"readwrite",st=>st.put(value));kdbMemory[store].delete(key);return out}catch(e){kdbFallback(e);kdbMemory[store].set(key,kdbClone(value));return key}}
function kdbOverlay(store,rows,match){const byKey=new Map((rows||[]).map(r=>[kdbKey(r),r]));for(const [key,value] of kdbMemory[store])if(match(value))byKey.set(key,kdbClone(value));return [...byKey.values()]}
/* kdbEach and kdbBlobAges reject on storage errors on purpose: garbage collection must never sweep from a partial scan. */
async function kdbEach(store,fn){const db=await kdbOpen();await new Promise((resolve,reject)=>{const tx=db.transaction(store,"readonly"),req=tx.objectStore(store).openCursor();req.onsuccess=()=>{const c=req.result;if(c){fn(c.value);c.continue()}};req.onerror=()=>reject(req.error);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error("scan aborted"))});for(const value of kdbMemory[store].values())fn(value)}
async function kdbBlobAges(){const db=await kdbOpen();return await new Promise((resolve,reject)=>{const out=[],tx=db.transaction("blobs","readonly"),req=tx.objectStore("blobs").index("created").openKeyCursor();req.onsuccess=()=>{const c=req.result;if(c){out.push({hash:c.primaryKey,created:c.key});c.continue()}};req.onerror=()=>reject(req.error);tx.oncomplete=()=>resolve(out);tx.onerror=()=>reject(tx.error)})}
async function kdbHas(store,key){if(kdbMemory[store].has(key))return true;try{return (await kdbRequest(store,"readonly",st=>st.count(key)))>0}catch(e){kdbFallback(e);return false}}
async function kdbDelete(store,key){kdbMemory[store].delete(key);try{return await kdbRequest(store,"readwrite",st=>st.delete(key))}catch(e){kdbFallback(e)}}
async function kdbThreads(notebookId){
  try{
    const db=await kdbOpen();
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction("threads","readonly"),idx=tx.objectStore("threads").index("notebookId"),req=idx.getAll(IDBKeyRange.only(notebookId));
      req.onsuccess=()=>resolve(kdbOverlay("threads",req.result||[],t=>t.notebookId===notebookId));req.onerror=()=>reject(req.error);
    });
  }catch(e){kdbFallback(e);return [...kdbMemory.threads.values()].filter(t=>t.notebookId===notebookId).map(kdbClone)}
}
async function kdbByIndex(store,index,value){
  try{const db=await kdbOpen();return await new Promise((resolve,reject)=>{const tx=db.transaction(store,"readonly"),req=tx.objectStore(store).index(index).getAll(IDBKeyRange.only(value));let result=[];req.onsuccess=()=>{result=req.result||[]};req.onerror=()=>reject(req.error);tx.oncomplete=()=>resolve(kdbOverlay(store,result,x=>x&&x[index]===value));tx.onerror=()=>reject(tx.error)})}
  catch(e){kdbFallback(e);return [...kdbMemory[store].values()].filter(x=>x&&x[index]===value).map(kdbClone)}
}
function kdbRuns(notebookId,threadId){return kdbByIndex("runs",threadId?"threadKey":"notebookId",threadId?(notebookId+":"+threadId):notebookId)}
function kdbCheckpoints(notebookId,threadId){return kdbByIndex("checkpoints",threadId?"threadKey":"notebookId",threadId?(notebookId+":"+threadId):notebookId)}
function clonePlain(value){return value==null?value:JSON.parse(JSON.stringify(value))}
function scheduleWorkspacePersist(){
  if(workspaceLoading)return;
  clearTimeout(workspaceTimer);workspaceTimer=setTimeout(()=>saveWorkspaceState(),550);
  const el=$("#saveState");if(el)el.classList.add("workspace-saving");
}
/* ----- content-addressed artifact bytes: workspaces and checkpoints store {blob:hash} references, so a checkpoint
   costs metadata instead of another copy of every file, and exports write each unique payload once ----- */
const blobKnown=new Set(),blobSession=new Set();
async function blobHash(bytes){try{if(globalThis.crypto&&crypto.subtle){const d=new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));let hex="";for(const b of d)hex+=b.toString(16).padStart(2,"0");return "sha256:"+hex}}catch(e){}return "crc32:"+bytes.byteLength+":"+crc32(bytes).toString(16)}
function sameBytes(a,b){if(!a||!b||a.byteLength!==b.byteLength)return false;for(let i=0;i<a.byteLength;i++)if(a[i]!==b[i])return false;return true}
async function blobPut(bytes){bytes=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes||[]);let hash=await blobHash(bytes);blobSession.add(hash);if(blobKnown.has(hash))return hash;if(await kdbHas("blobs",hash)){if(hash.startsWith("sha256:")||sameBytes(await blobGet(hash),bytes)){blobKnown.add(hash);return hash}hash+=":"+Date.now().toString(36);blobSession.add(hash)}await kdbPut("blobs",{hash,size:bytes.byteLength,bytes:bytes.slice(),created:Date.now()});blobKnown.add(hash);return hash}
async function blobGet(hash){if(!hash)return null;const r=await kdbGet("blobs",hash);return r&&r.bytes?(r.bytes instanceof Uint8Array?r.bytes:new Uint8Array(r.bytes)):null}
async function artifactBytes(f){if(!f)throw new Error("missing artifact");if(f.bytes)return f.bytes instanceof Uint8Array?f.bytes:new Uint8Array(f.bytes);if(f.blob){const live=dataFiles.find(d=>d.blob===f.blob&&d.bytes);if(live)return live.bytes instanceof Uint8Array?live.bytes:new Uint8Array(live.bytes);const b=await blobGet(f.blob);if(b)return b}throw new Error("artifact data is missing for "+(f.path||f.name||f.id))}
async function externalizeArtifacts(list){const out=[];for(const f of (list||[])){if(!f)continue;const meta=Object.assign({},f);if(!meta.blob||meta.bytes)meta.blob=await blobPut(await artifactBytes(f));if(!Number.isFinite(meta.size)&&f.bytes)meta.size=f.bytes.byteLength;delete meta.bytes;delete meta.fsStat;out.push(meta)}return out}
let blobGcTimer=null;
function scheduleBlobGc(delay){clearTimeout(blobGcTimer);blobGcTimer=setTimeout(()=>{gcBlobs().catch(e=>console.warn("Artifact storage cleanup failed",e))},delay||4000)}
/* Mark-and-sweep over workspace and checkpoint references. Legacy records that still embed bytes are migrated to blob references
   one at a time. Blobs written during this session or in the last ten minutes (possibly by another tab) are never swept,
   so a save racing the sweep cannot lose data, and any storage error aborts the sweep. */
async function gcBlobs(){
  const refs=new Set(blobSession),legacyWorkspaces=[],legacyCheckpoints=[];
  const scan=(list,onLegacy)=>{let legacy=false;for(const f of (list||[])){if(f&&f.blob)refs.add(f.blob);if(f&&f.bytes)legacy=true}if(legacy)onLegacy()};
  await kdbEach("workspaces",w=>scan(w.artifacts||w.files,()=>legacyWorkspaces.push(w.notebookId)));
  await kdbEach("checkpoints",cp=>scan(cp.workspace&&(cp.workspace.artifacts||cp.workspace.files),()=>legacyCheckpoints.push(cp.id)));
  for(const d of dataFiles)if(d.blob)refs.add(d.blob);
  for(const id of legacyCheckpoints){const cp=await kdbGet("checkpoints",id);if(!cp||!cp.workspace)continue;cp.workspace.artifacts=await externalizeArtifacts(cp.workspace.artifacts||cp.workspace.files);delete cp.workspace.files;for(const f of cp.workspace.artifacts)refs.add(f.blob);await kdbPut("checkpoints",cp)}
  for(const id of legacyWorkspaces){if(id===nbId)continue;const w=await kdbGet("workspaces",id);if(!w)continue;w.artifacts=await externalizeArtifacts(w.artifacts||w.files);delete w.files;for(const f of w.artifacts)refs.add(f.blob);await kdbPut("workspaces",w)}
  const cutoff=Date.now()-600000;let removed=0;for(const {hash,created} of await kdbBlobAges())if(!refs.has(hash)&&(created||0)<cutoff){await kdbDelete("blobs",hash);blobKnown.delete(hash);removed++}
  return {removed,migrated:legacyWorkspaces.length+legacyCheckpoints.length};
}
async function collectWorkspaceFiles(){
  let stats={};if(kernelReady&&dataFiles.length){try{stats=await pyFS.stat(dataFiles.map(d=>d.path||d.name))}catch(e){}}
  const out=[];
  for(const d of dataFiles){
    try{await refreshArtifactFromKernel(d,stats[d.path||d.name])}catch(e){}
    if(!d.bytes&&!d.blob)continue;
    if(!d.blob)d.blob=await blobPut(d.bytes);
    out.push({id:d.id||artifactId(),name:d.name,path:d.name,size:d.size||(d.bytes?d.bytes.byteLength:0),type:d.type||"",preview:d.preview||"",origin:d.origin||"upload",stage:artifactStage(d),createdAt:d.createdAt||Date.now(),updatedAt:d.updatedAt||Date.now(),fingerprint:d.fingerprint||artifactFingerprint(d),producer:clonePlain(d.producer||null),derivedFrom:clonePlain(d.derivedFrom||[]),blob:d.blob});
  }
  return out;
}
async function saveWorkspaceState(id){
  clearTimeout(workspaceTimer);id=id||nbId;if(!id||id!==nbId||workspaceLoading)return;
  const rec={v:3,notebookId:id,updated:Date.now(),artifacts:await collectWorkspaceFiles(),outputs:cells.filter(c=>c.type==="code"&&(c.outputs.length||c.execCount!=null)).map(c=>({cellId:c.id,outputs:clonePlain(c.outputs),execCount:c.execCount,runtime:c.runtime==null?null:c.runtime,provenance:clonePlain(c.provenance||null)})),environment:clonePlain(environmentSnapshot||null)};
  await kdbPut("workspaces",rec);
  const el=$("#saveState");if(el)el.classList.remove("workspace-saving");
  return rec;
}
async function clearMountedData(){
  if(kernelReady){for(const d of dataFiles){try{await pyFS.unlink(d.name)}catch(_){}}}
  dataFiles.splice(0,dataFiles.length);renderDataChips();renderDataList();
}
async function isolateNotebookRuntime(){
  if(kernelReady){try{await runPy("_kernel_reset()") }catch(e){console.warn("namespace reset failed",e)}}
  await clearMountedData();lastVarRows=[];paintInspector();
}
async function restoreWorkspaceState(id){
  workspaceLoading=true;
  try{
    await clearMountedData();
    const rec=await kdbGet("workspaces",id);
    const stored=rec&&(rec.artifacts||rec.files);if(Array.isArray(stored)){
      for(const f of stored){
        let bytes;try{bytes=f.bytes?(f.bytes instanceof Uint8Array?f.bytes:new Uint8Array(f.bytes)):await blobGet(f.blob)}catch(e){bytes=null}if(!bytes){console.warn("Artifact bytes are missing",f.path||f.name);continue}
        let path;try{path=safeArtifactPath(f.path||f.name)}catch(e){console.warn("Skipped unsafe artifact path",f.name);continue}try{if(kernelReady)await pyFS.write(path,bytes)}catch(e){console.warn("Could not remount",path,e)}
        dataFiles.push({id:f.id||artifactId(),name:path,path,size:bytes.byteLength,type:f.type||"",preview:f.preview||"",origin:f.origin||"upload",stage:f.stage||(f.origin==="upload"?"input":"final"),createdAt:f.createdAt||Date.now(),updatedAt:f.updatedAt||Date.now(),fingerprint:f.fingerprint||bytes.byteLength+":"+crc32(bytes),producer:clonePlain(f.producer||null),derivedFrom:clonePlain(f.derivedFrom||[]),bytes,blob:f.bytes?null:(f.blob||null)});
      }
    }
    const byId=new Map(((rec&&rec.outputs)||[]).map(o=>[o.cellId,o]));
    for(const cell of cells){
      const o=byId.get(cell.id);if(!o)continue;
      cell.outputs=clonePlain(o.outputs)||[];cell.execCount=o.execCount==null?null:o.execCount;cell.runtime=o.runtime==null?null:o.runtime;cell.provenance=clonePlain(o.provenance||cell.provenance||null);
      renderOutputs(cell);refreshExec(cell);if(cell.timeEl&&cell.runtime!=null)cell.timeEl.textContent=fmtDur(cell.runtime);
    }
    execCounter=cells.reduce((m,c)=>c.execCount!=null?Math.max(m,c.execCount):m,0);environmentSnapshot=clonePlain(rec&&rec.environment||environmentSnapshot||null);
    recomputeDependencies();renderDataChips();renderDataList();if(ui.splitOutputs)layoutOutputs();
  }finally{workspaceLoading=false}
}
async function deleteNotebookWorkspace(id){
  await kdbDelete("workspaces",id);for(const t of await kdbThreads(id))await kdbDelete("threads",t.key);for(const r of await kdbRuns(id))await kdbDelete("runs",r.id);for(const c of await kdbCheckpoints(id))await kdbDelete("checkpoints",c.id);scheduleBlobGc();
}
async function cloneNotebookWorkspace(fromId,toId){
  const src=fromId===nbId?await saveWorkspaceState(fromId):await kdbGet("workspaces",fromId);
  if(src){const arts=await externalizeArtifacts(src.artifacts||src.files||[]);await kdbPut("workspaces",Object.assign({},src,{v:3,notebookId:toId,updated:Date.now(),artifacts:arts,files:undefined,outputs:clonePlain(src.outputs||[])}))}
  const idxRaw=localStorage.getItem("kernel.agent.threadindex."+fromId);if(idxRaw)localStorage.setItem("kernel.agent.threadindex."+toId,idxRaw);
  for(const t of await kdbThreads(fromId))await kdbPut("threads",Object.assign({},t,{key:toId+":"+t.id,notebookId:toId,updated:Date.now()}));
}
async function captureEnvironment(){
  let py={python:"unknown",packages:[]};try{if(kernelReady)py=JSON.parse(await runPy("_environment_snapshot()"))}catch(e){console.warn("Environment snapshot failed",e)}
  const base={capturedAt:new Date().toISOString(),appVersion:"2.4.0",pyodideVersion:"0.29.4",pythonVersion:py.python||"unknown",implementation:py.implementation||"",platform:py.platform||"",browser:{userAgent:navigator.userAgent||"",language:navigator.language||""},packages:Array.isArray(py.packages)?py.packages:[],cells:cells.map(c=>({id:c.id,hash:sourceHash(c.taEl?c.taEl.value:c.source)})),artifacts:dataFiles.map(d=>({id:d.id,path:d.name,fingerprint:artifactFingerprint(d) }))};base.runtimeHash=sourceHash(base.pythonVersion+JSON.stringify(base.packages));base.hash=sourceHash(base.runtimeHash+JSON.stringify(base.cells)+JSON.stringify(base.artifacts));environmentSnapshot=base;scheduleWorkspacePersist();return base;
}
function requirementsSnapshot(env){return ((env&&env.packages)||[]).map(p=>p.name+(p.version?"=="+p.version:"")).sort((a,b)=>a.localeCompare(b)).join("\n")+"\n"}

