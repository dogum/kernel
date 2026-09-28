/* ===== persistence + notebook library (source/type/stable id/collapsed) ===== */
let persistTimer=null;
function schedulePersist(){ markSaving(); clearTimeout(persistTimer); persistTimer=setTimeout(persist, 400); }

function readLib(){
  try{ const r=localStorage.getItem(LIB_KEY); if(!r) return null; const d=JSON.parse(r); if(!d||!Array.isArray(d.notebooks)) return null; return d; }catch(e){ return null; }
}
function writeLib(lib){ try{ localStorage.setItem(LIB_KEY, JSON.stringify(lib)); }catch(e){} }
function libEntry(id){ const lib=readLib(); return lib?lib.notebooks.find(n=>n.id===id):null; }

function cellPayload(){ return cells.map(c=>({id:c.id,type:c.type, source:c.taEl?c.taEl.value:c.source, collapsed:!!c.collapsed,provenance:c.provenance||null})); }

function persist(){
  if(!nbId) return;
  const now=Date.now();
  try{ localStorage.setItem(nbKey(nbId), JSON.stringify({ v:3, name:nbName, cells:cellPayload(), updated:now })); }catch(e){}
  const lib=readLib();
  if(lib){
    const ent=lib.notebooks.find(n=>n.id===nbId);
    if(ent){ ent.name=nbName; ent.updated=now; lib.current=nbId; writeLib(lib); }
  }
  markSaved();
}

function loadCellsFor(id){
  try{
    const r=localStorage.getItem(nbKey(id)); if(!r) return null;
    const d=JSON.parse(r); if(!d||!Array.isArray(d.cells)) return null;
    return d;
  }catch(e){ return null; }
}

function applyNotebook(id){
  const data=loadCellsFor(id);
  const ent=libEntry(id);
  nbId=id; nbName=(ent&&ent.name)||(data&&data.name)||"Untitled";
  const list=(data&&data.cells&&data.cells.length)?data.cells:[{type:"code",source:"",collapsed:false}];
  const seen=new Set();cells=list.map(c=>{let id=c.id;if(!id||seen.has(id))id=uid();seen.add(id);const cell=mkCell(c.type==="markdown"?"markdown":"code", c.source||"", id); cell.collapsed=!!c.collapsed;cell.provenance=c.provenance||null;return cell; });
  selectedId=null; execCounter=0;
  setNbTitle();
}
function setNbTitle(){ const el=$("#nbTitleText"); if(el) el.textContent=nbName||"Untitled"; }

/* migrate a legacy single-notebook save into the library, if present */
function migrateLegacy(lib){
  try{
    const raw=localStorage.getItem(STORE_KEY); if(!raw) return false;
    const data=JSON.parse(raw);
    if(!data||!Array.isArray(data.cells)||!data.cells.length) return false;
    const id=nuid(), now=Date.now();
    localStorage.setItem(nbKey(id), JSON.stringify({ v:3, name:"Untitled", cells:data.cells.map(c=>({id:c.id||uid(),type:c.type==="markdown"?"markdown":"code", source:c.source||"", collapsed:false})), updated:now }));
    lib.notebooks.unshift({id, name:"Untitled", updated:now});
    lib.current=id;
    localStorage.removeItem(STORE_KEY);
    return true;
  }catch(e){ return false; }
}

/* called once at startup: ensure a library exists and load the current notebook */
function initLibrary(){
  let lib=readLib();
  if(!lib){ lib={notebooks:[], current:null}; migrateLegacy(lib); writeLib(lib); }
  if(!lib.notebooks.length){
    const id=nuid(), now=Date.now();
    lib.notebooks.push({id, name:"Untitled", updated:now});
    lib.current=id; writeLib(lib);
    localStorage.setItem(nbKey(id), JSON.stringify({ v:3, name:"Untitled", cells:[{id:uid(),type:"code",source:"",collapsed:false}], updated:now }));
  }
  const cur=(lib.current && lib.notebooks.some(n=>n.id===lib.current)) ? lib.current : lib.notebooks[0].id;
  applyNotebook(cur);
}

function createNotebook(name){
  const lib=readLib()||{notebooks:[],current:null};
  const id=nuid(), now=Date.now();
  lib.notebooks.unshift({id, name:name||"Untitled", updated:now});
  lib.current=id; writeLib(lib);
  localStorage.setItem(nbKey(id), JSON.stringify({ v:3, name:name||"Untitled", cells:[{id:uid(),type:"code",source:"",collapsed:false}], updated:now }));
  return id;
}

async function newNotebook(){
  if(agRunning||busy){toast("Finish or stop the current run first.","err");return}
  persist();await saveActiveThreadNow();await saveWorkspaceState();await isolateNotebookRuntime();
  const id=createNotebook("Untitled");
  applyNotebook(id);
  render();
  if(cells[0]) selectCell(cells[0].id,"edit");
  await restoreWorkspaceState(id);await activateNotebookAgent(id);refreshInspector();
  if(ui.left) renderLibrary();
  toast("New notebook");
}
async function switchNotebook(id){
  if(id===nbId){ closeLibrary(); return; }
  if(agRunning||busy){toast("Finish or stop the current run first.","err");return}
  persist();await saveActiveThreadNow();await saveWorkspaceState();await isolateNotebookRuntime();
  applyNotebook(id);
  render();
  if(cells[0]) selectCell(cells[0].id,"command");
  closeLibrary();
  await restoreWorkspaceState(id);await activateNotebookAgent(id);refreshInspector();
  if(ui.left) renderLibrary();
}
function appPrompt(title, value, okLabel){
  return new Promise(res=>{
    const scrim=$("#promptScrim"), inp=$("#promptInput");
    $("#promptTitle").textContent=title; $("#promptOk").textContent=okLabel||"OK";
    inp.value=value||"";
    scrim.classList.add("show");
    requestAnimationFrame(()=>{ inp.focus(); inp.select(); });
    function done(v){ scrim.classList.remove("show"); cleanup(); res(v); }
    function onKey(e){ e.stopPropagation(); if(e.key==="Enter"){ e.preventDefault(); done(inp.value); } else if(e.key==="Escape"){ e.preventDefault(); done(null); } }
    function onOk(){ done(inp.value); }
    function onCancel(){ done(null); }
    function onScrim(e){ if(e.target===scrim) done(null); }
    function cleanup(){
      inp.removeEventListener("keydown",onKey);
      $("#promptOk").removeEventListener("click",onOk);
      $("#promptCancel").removeEventListener("click",onCancel);
      $("#promptX").removeEventListener("click",onCancel);
      scrim.removeEventListener("mousedown",onScrim);
    }
    inp.addEventListener("keydown",onKey);
    $("#promptOk").addEventListener("click",onOk);
    $("#promptCancel").addEventListener("click",onCancel);
    $("#promptX").addEventListener("click",onCancel);
    scrim.addEventListener("mousedown",onScrim);
  });
}
function renameNotebook(id){
  const ent=libEntry(id); if(!ent) return;
  appPrompt("Rename notebook", ent.name||"Untitled", "Rename").then(name=>{
    if(name==null) return;
    const nm=name.trim()||"Untitled";
    const lib=readLib(); const e2=lib.notebooks.find(n=>n.id===id); if(e2){ e2.name=nm; e2.updated=Date.now(); writeLib(lib); }
    try{ const d=loadCellsFor(id)||{cells:[]}; d.name=nm; localStorage.setItem(nbKey(id), JSON.stringify(d)); }catch(e){}
    if(id===nbId){ nbName=nm; setNbTitle(); }
    renderLibrary();
  });
}
async function duplicateNotebook(id){
  if(busy&&id===nbId){toast("Finish the current run first.","err");return null}
  const src=loadCellsFor(id); const ent=libEntry(id);
  const baseName=((ent&&ent.name)||"Untitled")+" copy";
  const newId=nuid(), now=Date.now();
  const lib=readLib();
  lib.notebooks.unshift({id:newId, name:baseName, updated:now}); writeLib(lib);
  const payload={ v:3, name:baseName, cells:(src&&src.cells)?src.cells.map(c=>Object.assign({},c)):[{id:uid(),type:"code",source:"",collapsed:false}], updated:now };
  try{ localStorage.setItem(nbKey(newId), JSON.stringify(payload)); }catch(e){}
  await cloneNotebookWorkspace(id,newId);renderLibrary();
  toast("Duplicated");
  return newId;
}
async function deleteNotebook(id){
  if((busy||agRunning)&&id===nbId){toast("Finish or stop the current run first.","err");return}
  const lib=readLib(); if(!lib) return;
  if(lib.notebooks.length<=1){ toast("Can't delete the only notebook.","err"); return; }
  const ent=lib.notebooks.find(n=>n.id===id);
  if(!confirm("Delete \""+((ent&&ent.name)||"notebook")+"\"? This can't be undone.")) return;
  lib.notebooks=lib.notebooks.filter(n=>n.id!==id);
  try{ localStorage.removeItem(nbKey(id)); }catch(e){}
  await deleteNotebookWorkspace(id);
  try{localStorage.removeItem("kernel.agent.threadindex."+id);localStorage.removeItem("kernel.agent.tx."+id);localStorage.removeItem("kernel.agent.msgs."+id);localStorage.removeItem("kernel.agent.usage."+id)}catch(e){}
  if(id===nbId){
    const nextId=lib.notebooks[0].id; lib.current=nextId; writeLib(lib);
    await isolateNotebookRuntime();applyNotebook(nextId); render(); if(cells[0]) selectCell(cells[0].id,"command");await restoreWorkspaceState(nextId);await activateNotebookAgent(nextId);refreshInspector();
  } else { writeLib(lib); }
  renderLibrary();
}

/* library modal */
function openLibrary(){ persist(); toggleLeft(true); ui.secNb=true; applyUI(); saveUI(); renderLibrary(); renderDataList(); }
function closeLibrary(){ /* panels persist */ }
function fmtAgo(ts){
  if(!ts) return "";
  const s=Math.floor((Date.now()-ts)/1000);
  if(s<60) return "just now";
  if(s<3600) return Math.floor(s/60)+" min ago";
  if(s<86400) return Math.floor(s/3600)+" hr ago";
  const d=Math.floor(s/86400); return d===1?"yesterday":(d+" days ago");
}
function nbCellTypes(id){
  if(id===nbId) return cells.map(c=>c.type==="markdown"?"markdown":"code");
  const d=loadCellsFor(id);
  return (d&&d.cells)?d.cells.map(c=>c.type==="markdown"?"markdown":"code"):[];
}
function buildMap(types){
  const map=document.createElement("div"); map.className="lib-map";
  const cap=42, shown=types.slice(0,cap);
  shown.forEach(t=>{ const k=document.createElement("span"); k.className="lib-tick "+(t==="markdown"?"md":"code"); map.appendChild(k); });
  if(types.length>cap){ const m=document.createElement("span"); m.className="lib-more"; m.textContent="+"+(types.length-cap); map.appendChild(m); }
  return map;
}
function renderLibrary(){
  const lib=readLib(); const host=$("#libList"); if(!host) return;
  host.innerHTML="";
  const items=(lib?lib.notebooks.slice():[]).sort((a,b)=>(b.updated||0)-(a.updated||0));
  for(const n of items){
    const row=document.createElement("div"); row.className="lib-row"+(n.id===nbId?" current":"");
    const dot=document.createElement("span"); dot.className="lib-dot";
    const meta=document.createElement("div"); meta.className="lib-meta";
    const nm=document.createElement("div"); nm.className="lib-name"; nm.textContent=n.name||"Untitled";
    const types=nbCellTypes(n.id);
    const sub=document.createElement("div"); sub.className="lib-sub"; sub.textContent=(n.id===nbId?"current · ":"")+types.length+" cell"+(types.length===1?"":"s")+" · "+fmtAgo(n.updated);
    meta.appendChild(nm); meta.appendChild(sub);
    if(types.length) meta.appendChild(buildMap(types));
    const acts=document.createElement("div"); acts.className="lib-acts";
    const mkBtn=(label,cls,fn)=>{ const b=document.createElement("button"); b.className="lib-act"+(cls?" "+cls:""); b.textContent=label; b.addEventListener("click",ev=>{ ev.stopPropagation(); fn(); }); return b; };
    acts.appendChild(mkBtn("rename","",()=>renameNotebook(n.id)));
    acts.appendChild(mkBtn("duplicate","",()=>duplicateNotebook(n.id)));
    acts.appendChild(mkBtn("delete","danger",()=>deleteNotebook(n.id)));
    row.appendChild(dot); row.appendChild(meta); row.appendChild(acts);
    row.addEventListener("click",()=>switchNotebook(n.id));
    host.appendChild(row);
  }
}

