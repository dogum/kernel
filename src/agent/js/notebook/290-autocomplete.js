/* ===== autocomplete (jedi-backed, with a keyword/builtin fallback while jedi loads) ===== */
const PY_KEYWORDS=["False","None","True","and","as","assert","async","await","break","class","continue","def","del","elif","else","except","finally","for","from","global","if","import","in","is","lambda","nonlocal","not","or","pass","raise","return","try","while","with","yield"];
const PY_BUILTINS=["abs","all","any","ascii","bin","bool","bytearray","bytes","callable","chr","classmethod","compile","complex","delattr","dict","dir","divmod","enumerate","eval","filter","float","format","frozenset","getattr","globals","hasattr","hash","help","hex","id","input","int","isinstance","issubclass","iter","len","list","locals","map","max","min","next","object","oct","open","ord","pow","print","property","range","repr","reversed","round","set","setattr","slice","sorted","staticmethod","str","sum","super","tuple","type","vars","zip"];
let lastVars=[];

function caretCoords(ta){
  const cs=getComputedStyle(ta);
  const div=document.createElement("div");
  const copy=["fontFamily","fontSize","fontWeight","fontStyle","letterSpacing","wordSpacing","textTransform","tabSize"];
  copy.forEach(p=>{ div.style[p]=cs[p]; });
  div.style.position="absolute"; div.style.visibility="hidden"; div.style.left="-9999px"; div.style.top="0";
  div.style.whiteSpace="pre-wrap"; div.style.overflowWrap="break-word"; div.style.boxSizing="content-box";
  div.style.width=cs.width;
  const lh=parseFloat(cs.lineHeight)|| (parseFloat(cs.fontSize)*1.5);
  div.style.lineHeight=cs.lineHeight;
  div.textContent=ta.value.slice(0, ta.selectionStart);
  const mark=document.createElement("span"); mark.textContent="\u200b"; div.appendChild(mark);
  document.body.appendChild(div);
  const rect=ta.getBoundingClientRect();
  const top=rect.top + window.scrollY + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop) + (mark.offsetTop - ta.scrollTop) + lh + 2;
  const left=rect.left + window.scrollX + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft) + (mark.offsetLeft - ta.scrollLeft);
  document.body.removeChild(div);
  return {top, left, lh};
}

const cmp = {
  open:false, items:[], sel:0, cell:null, _t:null, _ht:null, _req:0,
  onInput(cell){
    clearTimeout(this._t);
    const ta=cell.taEl;
    if(ta.selectionStart!==ta.selectionEnd){ this.hide(); return; }
    const before=ta.value.slice(0, ta.selectionStart);
    const ch=before.slice(-1);
    const ident=/[A-Za-z0-9_]/.test(ch), dot=ch===".";
    if(!ident && !dot){ this.hide(); return; }
    if(ident){ const m=before.match(/[A-Za-z_][A-Za-z0-9_]*$/); if(!m){ this.hide(); return; } }
    this._t=setTimeout(()=>this.trigger(cell,false), 130);
  },
  async trigger(cell, explicit){
    if(busy || !kernelReady) return;
    const ta=cell.taEl, pos=ta.selectionStart;
    if(ta.selectionEnd!==pos){ this.hide(); return; }
    const src=ta.value, before=src.slice(0,pos);
    const line=before.split("\n").length, col=pos-(before.lastIndexOf("\n")+1);
    const token=++this._req;
    let items=[];
    if(jediReady){
      try{
        const data=JSON.parse(await runPy("_complete(__cmp_src, __cmp_line, __cmp_col)",{__cmp_src:src,__cmp_line:line,__cmp_col:col}));
        if(data && data.ready) items=data.items||[];
      }catch(e){ items=[]; }
    } else { items=this.fallback(before); }
    if(token!==this._req) return;
    if(document.activeElement!==ta || ta.selectionStart!==pos){ this.hide(); return; }
    if(!items.length){ this.hide(); if(explicit) toast(jediReady?"No suggestions here":"Autocomplete is still loading…"); return; }
    this.show(cell, items);
  },
  fallback(before){
    if(!/[A-Za-z0-9_]$/.test(before)) return [];
    const m=before.match(/[A-Za-z_][A-Za-z0-9_]*$/); const pre=m?m[0]:"";
    if(!pre) return [];
    const pool=PY_KEYWORDS.map(k=>({n:k,t:"keyword"})).concat(PY_BUILTINS.map(k=>({n:k,t:"builtin"}))).concat(lastVars.map(k=>({n:k,t:"name"})));
    const seen=new Set(), out=[];
    for(const c of pool){ if(c.n.startsWith(pre) && c.n!==pre && !seen.has(c.n)){ seen.add(c.n); out.push({name:c.n, complete:c.n.slice(pre.length), type:c.t}); } }
    return out.slice(0,40);
  },
  show(cell, items){
    this.cell=cell; this.items=items; this.sel=0; this.open=true;
    this.render();
    const pop=$("#cmpPop"), co=caretCoords(cell.taEl);
    pop.style.left=co.left+"px"; pop.style.top=co.top+"px";
    pop.classList.add("open"); pop.setAttribute("aria-hidden","false");
    const r=pop.getBoundingClientRect();
    if(r.right>window.innerWidth-10) pop.style.left=Math.max(8, window.innerWidth-12-r.width+window.scrollX)+"px";
    if(r.bottom>window.innerHeight-10) pop.style.top=Math.max(8+window.scrollY, co.top-co.lh-r.height-6)+"px";
  },
  render(){
    const pop=$("#cmpPop"); pop.innerHTML="";
    this.items.forEach((it,idx)=>{
      const row=document.createElement("div"); row.className="cmp-item"+(idx===this.sel?" sel":"");
      const k=document.createElement("span"); k.className="cmp-k"; k.textContent=(it.type||"").slice(0,4);
      const n=document.createElement("span"); n.className="cmp-n"; n.textContent=it.name;
      row.appendChild(k); row.appendChild(n);
      row.addEventListener("mousedown",e=>{ e.preventDefault(); this.sel=idx; this.accept(this.cell); });
      pop.appendChild(row);
    });
  },
  move(d){
    if(!this.items.length) return;
    const pop=$("#cmpPop"), prev=pop.children[this.sel]; if(prev) prev.classList.remove("sel");
    this.sel=(this.sel+d+this.items.length)%this.items.length;
    const cur=pop.children[this.sel]; if(cur){ cur.classList.add("sel"); cur.scrollIntoView({block:"nearest"}); }
  },
  accept(cell){
    if(!this.open || !this.items.length){ this.hide(); return; }
    const it=this.items[this.sel], ta=cell.taEl, pos=ta.selectionStart;
    const suffix=it.complete!=null?it.complete:"";
    ta.value=ta.value.slice(0,pos)+suffix+ta.value.slice(ta.selectionEnd);
    const np=pos+suffix.length; ta.selectionStart=ta.selectionEnd=np;
    cell.source=ta.value; paint(cell); schedulePersist();
    this.hide(); ta.focus();
  },
  hide(){ if(!this.open && !$("#cmpPop").classList.contains("open")) return; this.open=false; const p=$("#cmpPop"); p.classList.remove("open"); p.setAttribute("aria-hidden","true"); clearTimeout(this._t); },
  hideSoon(){ clearTimeout(this._ht); this._ht=setTimeout(()=>this.hide(), 150); }
};

