/* live theme: kernels flip without a reload (agent runs survive Alt+T) */
window.addEventListener('ut-theme',function(){
  try{
    if(window.mermaid){
      const dk=document.documentElement.getAttribute("data-theme")==="dark";
      window.mermaid.initialize({startOnLoad:false, securityLevel:"strict", theme:dk?"dark":"neutral", fontFamily:"var(--sans)"});
    }
  }catch(e){}
  try{ cells.forEach(c=>{ if(c.type==="markdown") showRendered(c,true); }); }catch(e){}
});

