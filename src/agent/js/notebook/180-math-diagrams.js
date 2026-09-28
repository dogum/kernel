/* ----- lazy KaTeX (math) + Mermaid (diagrams) for markdown cells ----- */
const KATEX_BASE="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/";
const MERMAID_SRC="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js";
const KATEX_OPTS={delimiters:[{left:"$$",right:"$$",display:true},{left:"\\[",right:"\\]",display:true},{left:"$",right:"$",display:false},{left:"\\(",right:"\\)",display:false}],throwOnError:false,ignoredTags:["script","style","textarea","pre","code","option"]};
let _katexP=null, _mermaidP=null;
function ensureKatex(){
  if(window.renderMathInElement) return Promise.resolve();
  if(_katexP) return _katexP;
  _katexP=(async()=>{ await loadCss(KATEX_BASE+"katex.min.css"); await loadScript(KATEX_BASE+"katex.min.js"); await loadScript(KATEX_BASE+"contrib/auto-render.min.js"); })();
  return _katexP;
}
function ensureMermaid(){
  if(window.mermaid) return Promise.resolve();
  if(_mermaidP) return _mermaidP;
  _mermaidP=(async()=>{ await loadScript(MERMAID_SRC); try{ const dark=document.documentElement.getAttribute("data-theme")==="dark"; window.mermaid.initialize({startOnLoad:false, securityLevel:"strict", theme:dark?"dark":"neutral", fontFamily:"var(--sans)"}); }catch(e){} })();
  return _mermaidP;
}
async function typesetMarkdown(el){
  if(!el) return;
  if(/\$|\\\(|\\\[/.test(el.textContent||"")){
    try{ await ensureKatex(); if(window.renderMathInElement) window.renderMathInElement(el, KATEX_OPTS); }catch(e){}
  }
  const nodes=el.querySelectorAll(".mermaid:not([data-done])");
  if(nodes.length){
    try{
      await ensureMermaid();
      nodes.forEach(n=>n.setAttribute("data-done","1"));
      if(window.mermaid&&window.mermaid.run) await window.mermaid.run({nodes:[...nodes]});
    }catch(e){ nodes.forEach(n=>{ n.classList.add("mermaid-err"); }); }
  }
}
