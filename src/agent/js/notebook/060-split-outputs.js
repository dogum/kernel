/* ----- split outputs: relocate cell.outEl between inline body and a right-panel card ----- */
function firstLine(cell){
  const s=(cell.taEl?cell.taEl.value:cell.source)||"";
  const ln=s.split("\n").find(l=>l.trim()) || "(empty)";
  return ln.trim().slice(0,80);
}
function inlineHome(cell){ return cell.el?cell.el.querySelector(".body"):null; }
const outputCards=new Map();
function returnOutputInline(cell){
  const body=inlineHome(cell); if(!body||!cell.outEl) return;
  if(cell.outEl.parentNode!==body){
    const tools=body.querySelector(".cell-tools");
    body.insertBefore(cell.outEl, tools);
  }
}
function makeCard(cell){
  const card=document.createElement("div"); card.className="out-card"; card.dataset.id=cell.id;
  const head=document.createElement("div"); head.className="out-card-h";
  const ex=document.createElement("span"); ex.className="out-card-ex"; ex.textContent=cell.execCount!=null?("["+cell.execCount+"]"):"[ ]";
  const lbl=document.createElement("span"); lbl.className="out-card-lbl"; lbl.textContent=firstLine(cell);
  const home=document.createElement("button");home.className="out-card-home";home.textContent="↙";home.title="Move all outputs inline";
  home.addEventListener("click",e=>{e.stopPropagation();setSplitOutputs(false)});
  head.appendChild(ex); head.appendChild(lbl);head.appendChild(home); card.appendChild(head);
  card.appendChild(cell.outEl);card._outEl=cell.outEl;
  head.addEventListener("click",()=>{const current=findCell(card.dataset.id);if(current){selectCell(current.id,"command");if(current.el)current.el.scrollIntoView({block:"center"})}});
  card.addEventListener("mouseenter",()=>linkHover(card.dataset.id,true));
  card.addEventListener("mouseleave",()=>linkHover(card.dataset.id,false));
  outputCards.set(cell.id,card);
  return card;
}
function outputCard(cell){
  let card=outputCards.get(cell.id);
  if(!card)return makeCard(cell);
  if(card._outEl!==cell.outEl){card.querySelector(".outputs")?.remove();card.appendChild(cell.outEl);card._outEl=cell.outEl}
  const ex=card.querySelector(".out-card-ex");if(ex)ex.textContent=cell.execCount!=null?("["+cell.execCount+"]"):"[ ]";
  const lbl=card.querySelector(".out-card-lbl");if(lbl)lbl.textContent=firstLine(cell);
  return card;
}
function hasOut(cell){ return cell.type==="code" && cell.outputs && cell.outputs.length; }
function layoutOutputs(){
  const list=$("#outList"); if(!list) return;
  if(!ui.splitOutputs){
    for(const c of cells) if(c.type==="code") returnOutputInline(c);
    list.replaceChildren();outputCards.clear();
    updateOutputsSectionUI(); return;
  }
  const frag=document.createDocumentFragment();
  let n=0;
  for(const cell of cells){
    if(!hasOut(cell)) continue;
    frag.appendChild(outputCard(cell));
    n++;
  }
  if(!n){ const e=document.createElement("div"); e.className="out-empty"; e.textContent="Run a code cell — its output lands here, synced to the cell."; frag.appendChild(e); }
  list.replaceChildren(frag);
  for(const id of [...outputCards.keys()])if(!cells.some(c=>c.id===id&&hasOut(c)))outputCards.delete(id);
  updateOutputsSectionUI();
}
function syncCardFor(cell){
  const list=$("#outList"); if(!list||!ui.splitOutputs) return;
  const empty=list.querySelector(".out-empty"); if(empty) empty.remove();
  let card=outputCards.get(cell.id)||list.querySelector('.out-card[data-id="'+cell.id+'"]');
  if(!hasOut(cell)){ if(card){ returnOutputInline(cell); card.remove();outputCards.delete(cell.id); } updateOutputsSectionUI(); if(!list.querySelector(".out-card")){ layoutOutputs(); } return; }
  if(!card){
    card=outputCard(cell);
    // insert in document order: before the first existing card whose cell comes later
    const i=indexOf(cell); let anchor=null;
    for(const other of list.querySelectorAll(".out-card")){ const oi=cells.findIndex(c=>c.id===other.dataset.id); if(oi>i){ anchor=other; break; } }
    list.insertBefore(card, anchor);
  } else {
    const ex=card.querySelector(".out-card-ex"); if(ex) ex.textContent=cell.execCount!=null?("["+cell.execCount+"]"):"[ ]";
    const lbl=card.querySelector(".out-card-lbl"); if(lbl) lbl.textContent=firstLine(cell);
  }
  updateOutputsSectionUI();
}
function updateOutputsSectionUI(){
  const hint=$("#outHint"), list=$("#outList"), count=$("#outCount");
  if(!hint||!list||!count) return;
  const on=!!ui.splitOutputs;
  hint.style.display=on?"none":"";
  list.style.display=on?"":"none";
  const n=list.querySelectorAll(".out-card").length;
  count.textContent=on?(n+(n===1?" output":" outputs")):"inline";
}
let _linkId=null;
function linkHover(id,on){
  if(!ui.splitOutputs) return;
  const list=$("#outList"); const card=list?list.querySelector('.out-card[data-id="'+id+'"]'):null;
  if(on && !card) return;
  const cell=findCell(id);
  if(cell&&cell.el) cell.el.classList.toggle("linked", on);
  if(card) card.classList.toggle("linked", on);
  if(on){ _linkId=id; if(card) card.scrollIntoView({block:"nearest"}); }
  else if(_linkId===id){ _linkId=null; }
}
function setSplitOutputs(on){
  ui.splitOutputs=!!on;
  if(on){ ui.right=true; ui.secOut=true; }
  applyUI(); saveUI();
  layoutOutputs();
}

function initPanels(){
  loadUI(); applyUI();
  if(ui.left){ renderLibrary(); renderDataList(); }
  document.querySelectorAll(".panel-toggle").forEach(b=>{
    b.addEventListener("click",()=>{
      const sec=b.closest(".panel-section"); sec.classList.toggle("collapsed");
      const open=!sec.classList.contains("collapsed"), k=b.dataset.sec;
      if(k==="nb") ui.secNb=open; else if(k==="data") ui.secData=open;
      else if(k==="out") ui.secOut=open; else if(k==="vars") ui.secVars=open;
      saveUI();
    });
  });
  document.querySelectorAll(".panel-grip").forEach(g=>{
    g.addEventListener("mousedown", e=>{
      e.preventDefault();
      const side=g.dataset.side, startX=e.clientX, startW=(side==="left")?ui.leftW:(side==="agent"?ui.agentW:ui.rightW);
      document.body.classList.add("resizing");
      function mv(ev){ let w=(side==="right")?startW-(ev.clientX-startX):startW+(ev.clientX-startX); if(side==="agent"){ w=Math.max(280,Math.min(560,w)); ui.agentW=w; $("#agentPanel").style.width=w+"px"; } else if(side==="left"){ w=Math.max(180,Math.min(520,w)); ui.leftW=w; $("#leftPanel").style.width=w+"px"; } else { w=Math.max(180,Math.min(520,w)); ui.rightW=w; $("#rightPanel").style.width=w+"px"; } }
      function up(){ document.body.classList.remove("resizing"); document.removeEventListener("mousemove",mv); document.removeEventListener("mouseup",up); saveUI(); }
      document.addEventListener("mousemove",mv); document.addEventListener("mouseup",up);
    });
  });
  $("#outEnable").addEventListener("click", ()=>setSplitOutputs(true));
  updateOutputsSectionUI();
  if(ui.splitOutputs) layoutOutputs();
}

