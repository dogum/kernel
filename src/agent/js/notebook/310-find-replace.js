/* ===== find & replace ===== */
const find = {
  matches:[], idx:-1, caseOn:false, _t:null,
  open(){
    findOpen=true;
    $("#findbar").classList.add("open"); $("#findbar").setAttribute("aria-hidden","false");
    const fi=$("#findInput");
    const cell=selectedId?findCell(selectedId):null;
    if(cell && cell.taEl){ const s=cell.taEl.value.slice(cell.taEl.selectionStart, cell.taEl.selectionEnd); if(s && !/\n/.test(s)) fi.value=s; }
    fi.focus(); fi.select();
    this.recompute();
  },
  close(){ findOpen=false; $("#findbar").classList.remove("open"); $("#findbar").setAttribute("aria-hidden","true"); },
  toggleCase(){ this.caseOn=!this.caseOn; $("#findCase").classList.toggle("on", this.caseOn); this.recompute(); },
  recompute(){
    const q=$("#findInput").value;
    this.matches=[]; this.idx=-1;
    if(q){
      const needle=this.caseOn?q:q.toLowerCase();
      cells.forEach((c,ci)=>{
        const raw=c.taEl?c.taEl.value:c.source, hay=this.caseOn?raw:raw.toLowerCase();
        let from=0,pos;
        while((pos=hay.indexOf(needle,from))!==-1){ this.matches.push({ci, start:pos, end:pos+q.length}); from=pos+Math.max(1,q.length); }
      });
    }
    if(this.matches.length){ this.idx=0; this.reveal(); }
    this.updateCount();
  },
  updateCount(){ $("#findCount").textContent=(this.matches.length?(this.idx+1):0)+"/"+this.matches.length; },
  reveal(){
    const m=this.matches[this.idx]; if(!m) return;
    const cell=cells[m.ci]; if(!cell || !cell.taEl) return;
    if(cell.collapsed){ cell.collapsed=false; applyCollapsed(cell); }
    try{ cell.taEl.setSelectionRange(m.start, m.end); }catch(e){}
    if(cell.el) cell.el.scrollIntoView({block:"center"});
    this.updateCount();
    const fi=$("#findInput"); if(document.activeElement!==fi && document.activeElement!==$("#replaceInput")) fi.focus();
  },
  next(){ if(!this.matches.length) return; this.idx=(this.idx+1)%this.matches.length; this.reveal(); },
  prev(){ if(!this.matches.length) return; this.idx=(this.idx-1+this.matches.length)%this.matches.length; this.reveal(); },
  replaceOne(){
    if(!this.matches.length) return;
    const rep=$("#replaceInput").value, m=this.matches[this.idx], cell=cells[m.ci]; if(!cell||!cell.taEl) return;
    const v=cell.taEl.value;
    cell.taEl.value=v.slice(0,m.start)+rep+v.slice(m.end);
    cell.source=cell.taEl.value; paint(cell); schedulePersist();
    this.recompute();
  },
  replaceAll(){
    const q=$("#findInput").value; if(!q) return;
    const rep=$("#replaceInput").value; let total=0;
    cells.forEach(c=>{
      const v=c.taEl?c.taEl.value:c.source; let out, n=0;
      if(this.caseOn){ const parts=v.split(q); n=parts.length-1; out=parts.join(rep); }
      else { out=""; let from=0,pos; const low=v.toLowerCase(), ql=q.toLowerCase(); while((pos=low.indexOf(ql,from))!==-1){ out+=v.slice(from,pos)+rep; from=pos+q.length; n++; } out+=v.slice(from); }
      if(n>0){ c.source=out; if(c.taEl) c.taEl.value=out; paint(c); total+=n; }
    });
    schedulePersist(); this.recompute();
    toast(total?("Replaced "+total+" occurrence"+(total>1?"s":"")):"Nothing to replace");
  }
};


