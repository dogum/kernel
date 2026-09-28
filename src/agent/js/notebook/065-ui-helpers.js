const $=s=>document.querySelector(s);
const nb=$("#notebook");
const uid=()=>"c"+Math.random().toString(36).slice(2,9);
const nuid=()=>"nb"+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

function toast(msg,kind,opts){
  const host=$("#toastHost"); const t=document.createElement("div");
  t.className="toast"+(kind?(" "+kind):""); const text=document.createElement("span"); text.textContent=String(msg); t.appendChild(text);
  let timer=null; const close=()=>{ clearTimeout(timer); t.classList.remove("show"); t.classList.add("closing"); setTimeout(()=>t.remove(),250); };
  if(opts&&opts.action){ const b=document.createElement("button"); b.className="toast-act"; b.textContent=opts.action.label||"Undo"; b.addEventListener("click",()=>{ if(t.classList.contains("closing")) return; close(); try{ opts.action.run(); }catch(e){ console.error(e); } }); t.appendChild(b); }
  host.appendChild(t);
  requestAnimationFrame(()=>t.classList.add("show"));
  timer=setTimeout(close, opts&&opts.action?7000:(kind==="err"?4200:2600));
  return close;
}
function setStatus(text,s,full){ $("#statusText").textContent=text; $("#status").dataset.s=s; $("#status").title=full||""; const ib=document.getElementById("btnInterrupt"); if(ib) ib.hidden=!(s==="busy"&&busy&&kernelReady); }
function pkgSummary(verb,names){
  const list=(names||[]).map(x=>String(x).trim()).filter(Boolean);
  if(list.length<=3) return verb+" "+list.join(", ")+"…";
  return verb+" "+list.slice(0,3).join(", ")+" +"+(list.length-3)+" more…";
}
let _prog=0;
function progressOn(){ _prog++; const el=$("#progress"); if(el) el.classList.add("active"); }
function progressOff(){ _prog=Math.max(0,_prog-1); if(_prog===0){ const el=$("#progress"); if(el) el.classList.remove("active"); } }
function markSaving(){ const el=$("#saveState"); if(el){ el.dataset.s="saving"; el.textContent="Saving…"; } }
function markSaved(){ const el=$("#saveState"); if(!el) return; el.dataset.s="saved"; const t=new Date(); el.textContent="Saved "+String(t.getHours()).padStart(2,"0")+":"+String(t.getMinutes()).padStart(2,"0"); }
function fmtDur(ms){ if(ms<1000) return Math.round(ms)+" ms"; return (ms/1000).toFixed(ms<10000?2:1)+" s"; }

