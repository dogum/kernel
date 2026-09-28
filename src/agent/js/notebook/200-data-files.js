/* ===== data files mounted into the kernel FS ===== */
function fileExt(name){ const m=/\.([A-Za-z0-9]+)$/.exec(name); return m?m[1].toLowerCase():""; }
function fmtBytes(n){ if(n<1024) return n+" B"; if(n<1048576) return (n/1024).toFixed(1)+" KB"; return (n/1048576).toFixed(1)+" MB"; }
function artifactId(){return "f_"+uid()}
function safeArtifactPath(raw){
  const s=String(raw||"").replace(/\\/g,"/").trim();if(!s||s.includes("\0")||s.startsWith("/")||/^[A-Za-z]:/.test(s))throw new Error("unsafe or empty file path");
  const parts=s.split("/");if(parts.some(p=>!p||p==="."||p===".."))throw new Error("file path traversal is not allowed");
  const clean=parts.map(p=>p.replace(/[\u0000-\u001f\u007f]/g,"").slice(0,120));if(clean.some(p=>!p))throw new Error("file path contains an empty component");return clean.join("/").slice(0,480);
}
function collisionSafePath(raw,taken){const path=safeArtifactPath(raw),dot=path.lastIndexOf("."),slash=path.lastIndexOf("/"),base=dot>slash?path.slice(0,dot):path,ext=dot>slash?path.slice(dot):"";let out=path,n=2;while(taken(out))out=base+" ("+(n++)+")"+ext;return out}
function uniqueArtifactPath(raw,ignoreId){return collisionSafePath(raw,out=>dataFiles.some(d=>(d.path||d.name)===out&&d.id!==ignoreId))}
function ensureFsParent(path){/* the kernel worker creates parent folders on write */}
function dataEntry(name){ return dataFiles.find(d=>d.id===name||d.name===name||d.path===name); }
function artifactStage(d){return d.stage||(d.origin==="upload"?"input":"final")}
function renderDataChips(){
  const host=$("#dataChips"); host.innerHTML="";
  for(const d of dataFiles.slice(0,6)){ const c=document.createElement("span"); c.className="data-chip"; c.textContent=(d.name||"").split("/").pop();c.title=d.name+" · "+artifactStage(d); host.appendChild(c); }
}
function snippetFor(name){
  const q=JSON.stringify(name), ext=fileExt(name);
  if(ext==="csv") return 'import pandas as pd\ndf = pd.read_csv('+q+')\ndf.head()';
  if(ext==="tsv"||ext==="tab") return 'import pandas as pd\ndf = pd.read_csv('+q+', sep="\\t")\ndf.head()';
  if(ext==="json") return 'import json\nwith open('+q+') as f:\n    data = json.load(f)\ndata';
  if(ext==="xlsx"||ext==="xls") return 'import pandas as pd\ndf = pd.read_excel('+q+')\ndf.head()';
  if(ext==="parquet") return 'import pandas as pd\ndf = pd.read_parquet('+q+')\ndf.head()';
  if(ext==="npy") return 'import numpy as np\narr = np.load('+q+')\narr';
  if(["txt","md","log","py","yaml","yml","html","xml"].includes(ext)) return 'text = open('+q+').read()\nprint(text[:1000])';
  return 'data = open('+q+', "rb").read()\nlen(data)';
}
function insertReadSnippet(name){
  const base=selectedId?indexOf(findCell(selectedId)):cells.length-1;
  const c=insertCell(Math.max(base+1,0),"code",false);
  const src=snippetFor(name);
  c.source=src; if(c.taEl) c.taEl.value=src; paint(c);
  selectCell(c.id,"edit"); schedulePersist();
  closeData(); toast("Inserted read snippet for "+name);
}
async function removeData(name){
  const d=dataEntry(name);if(!d)return;try{ if(kernelReady) await pyFS.unlink(d.name); }catch(_){ }
  if(d._previewUrl)URL.revokeObjectURL(d._previewUrl);const i=dataFiles.indexOf(d); if(i>=0) dataFiles.splice(i,1);
  recomputeDependencies();
  renderDataChips(); renderDataList(); scheduleWorkspacePersist();
  const snap=Object.assign({},d,{_previewUrl:null,blob:null,fsStat:null}),home=nbId;
  toast("Removed "+d.name, null, {action:{label:"Undo", run:()=>restoreData(snap,i,home)}});
}
async function restoreData(snap,index,home){
  if(home!==nbId){ toast("Switch back to that notebook to restore "+snap.name,"err"); return; }
  if(dataEntry(snap.id)||dataEntry(snap.name)){ toast(snap.name+" is already mounted"); return; }
  try{ if(kernelReady&&snap.bytes) await pyFS.write(snap.name, snap.bytes); }catch(e){ toast("Could not restore "+snap.name,"err"); return; }
  dataFiles.splice(Math.min(Math.max(index,0),dataFiles.length),0,snap);
  recomputeDependencies(); renderDataChips(); renderDataList(); scheduleWorkspacePersist(); toast("Restored "+snap.name);
}
function setArtifactStage(id,stage){const d=dataEntry(id);if(!d)return;d.stage=stage;d.updatedAt=Date.now();renderDataList();scheduleWorkspacePersist();toast((stage==="final"?"Promoted ":"Moved to working · ")+d.name)}
function openData(){ toggleLeft(true); ui.secData=true; applyUI(); saveUI(); renderDataList(); }
function closeData(){ /* panels persist */ }
function parseDelimitedPreview(text,delimiter){
  const rows=[];let row=[],field="",q=false;for(let i=0;i<text.length&&rows.length<50;i++){const c=text[i];if(c==='"'){if(q&&text[i+1]==='"'){field+='"';i++}else q=!q}else if(c===delimiter&&!q){row.push(field);field=""}else if((c==='\n'||c==='\r')&&!q){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);rows.push(row.slice(0,20));row=[];field=""}else field+=c}if((field||row.length)&&rows.length<50){row.push(field);rows.push(row.slice(0,20))}return rows;
}
async function renderArtifactPreview(d,host){
  host.replaceChildren();const bytes=d.bytes instanceof Uint8Array?d.bytes:new Uint8Array(d.bytes||[]),ext=fileExt(d.name),mime=d.type||"";
  if(["png","jpg","jpeg","gif","webp","svg"].includes(ext)||mime.startsWith("image/")){const blob=new Blob([bytes],{type:mime||("image/"+(ext==="jpg"?"jpeg":ext))});if(d._previewUrl)URL.revokeObjectURL(d._previewUrl);d._previewUrl=URL.createObjectURL(blob);const img=document.createElement("img");img.src=d._previewUrl;img.alt=d.name;host.appendChild(img);return}
  const text=new TextDecoder("utf-8",{fatal:false}).decode(bytes.slice(0,262144));
  if(ext==="csv"||ext==="tsv"||ext==="tab"){const rows=parseDelimitedPreview(text,ext==="csv"?",":"\t"),table=document.createElement("table");rows.forEach((r,i)=>{const tr=document.createElement("tr");r.forEach(v=>{const x=document.createElement(i?"td":"th");x.textContent=v;tr.appendChild(x)});table.appendChild(tr)});host.appendChild(table);return}
  if(ext==="json"){const pre=document.createElement("pre");try{pre.textContent=JSON.stringify(JSON.parse(text),null,2).slice(0,30000)}catch(e){pre.textContent=text.slice(0,30000)}host.appendChild(pre);return}
  if(ext==="html"||mime==="text/html"){const f=document.createElement("iframe");f.setAttribute("sandbox","");f.setAttribute("referrerpolicy","no-referrer");f.srcdoc=text.slice(0,200000);host.appendChild(f);return}
  if(/^(?:txt|md|log|py|ya?ml|xml)$/i.test(ext)||mime.startsWith("text/")){const pre=document.createElement("pre");pre.textContent=text.slice(0,30000);host.appendChild(pre);return}
  const pre=document.createElement("pre");pre.textContent=(d.type||"binary")+" · "+fmtBytes(bytes.length)+"\n"+[...bytes.slice(0,64)].map(x=>x.toString(16).padStart(2,"0")).join(" ");host.appendChild(pre);
}
function renderArtifactRow(d){
  const row=document.createElement("div");row.className="data-row";const top=document.createElement("div");top.className="data-top";const meta=document.createElement("div");meta.className="data-meta";const nm=document.createElement("div");nm.className="data-name";nm.textContent=(d.name||"").split("/").pop();nm.title=d.name;const sub=document.createElement("div");sub.className="data-sub";sub.textContent=(fileExt(d.name)||"file").toUpperCase()+" · "+fmtBytes(d.size||0);const st=document.createElement("span");st.className="data-stage "+artifactStage(d);st.textContent=artifactStage(d);sub.appendChild(st);meta.append(nm,sub);
  const acts=document.createElement("div");acts.className="data-acts";const prev=document.createElement("div");prev.className="data-preview";
  const pv=document.createElement("button");pv.className="data-act";pv.textContent="preview";pv.addEventListener("click",async()=>{if(!prev.classList.contains("open"))await renderArtifactPreview(d,prev);prev.classList.toggle("open");pv.textContent=prev.classList.contains("open")?"hide":"preview"});acts.appendChild(pv);meta.title="Preview "+d.name;meta.addEventListener("click",()=>pv.click());
  const ins=document.createElement("button");ins.className="data-act";ins.textContent="insert";ins.addEventListener("click",()=>insertReadSnippet(d.name));acts.appendChild(ins);
  const cx=document.createElement("button");cx.className="data-act";cx.textContent=(getArtifactContextPolicy(d.id)==="pinned"?"pinned":getArtifactContextPolicy(d.id)==="excluded"?"excluded":"context");cx.addEventListener("click",()=>cycleArtifactContext(d.id));acts.appendChild(cx);
  if(artifactStage(d)!=="input"){const pr=document.createElement("button");pr.className="data-act";pr.textContent=artifactStage(d)==="final"?"working":"final";pr.addEventListener("click",()=>setArtifactStage(d.id,artifactStage(d)==="final"?"scratch":"final"));acts.appendChild(pr)}
  const sv=document.createElement("button");sv.className="data-act";sv.textContent="download";sv.addEventListener("click",()=>downloadBlob(new Blob([d.bytes||new Uint8Array()],{type:d.type||"application/octet-stream"}),(d.name||"file").split("/").pop()));acts.appendChild(sv);
  const rm=document.createElement("button");rm.className="data-act danger";rm.textContent="remove";rm.addEventListener("click",()=>removeData(d.id));acts.appendChild(rm);top.append(meta,acts);row.append(top,prev);return row;
}
function appendArtifactTree(host,items,prefix){
  const folders=new Map(),files=[];for(const d of items){const rel=(d.name||"").slice(prefix.length),parts=rel.split("/");if(parts.length===1)files.push(d);else{const k=parts[0];if(!folders.has(k))folders.set(k,[]);folders.get(k).push(d)}}
  for(const [name,inside] of [...folders].sort((a,b)=>a[0].localeCompare(b[0]))){const det=document.createElement("details");det.className="data-folder";det.open=true;const sum=document.createElement("summary");sum.textContent=name;const body=document.createElement("div");body.className="data-folder-body";appendArtifactTree(body,inside,prefix+name+"/");det.append(sum,body);host.appendChild(det)}
  for(const d of files.sort((a,b)=>a.name.localeCompare(b.name)))host.appendChild(renderArtifactRow(d));
}
function renderDataList(){
  renderWelcome();
  const host=$("#dataList"); if(!host) return; host.replaceChildren();
  if(!dataFiles.length){
    const e=document.createElement("div"); e.className="data-empty";
    e.textContent="No files mounted yet. Upload a CSV, JSON, or any file to read it from your code.";
    host.appendChild(e); return;
  }
  const stages=[['input','INPUTS'],['scratch','WORKING'],['final','FINAL RESULTS']];for(const [stage,label] of stages){const items=dataFiles.filter(d=>artifactStage(d)===stage);if(!items.length)continue;const group=document.createElement("div");group.className="data-group";group.textContent=label;host.appendChild(group);appendArtifactTree(host,items,"")}
}

