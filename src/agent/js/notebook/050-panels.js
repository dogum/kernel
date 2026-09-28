/* ===== v7 composable panel layout ===== */
const UI_KEY="kernel.ui.v1";
let ui={left:false,right:false,agent:false,agentW:360,leftW:262,rightW:300,secNb:true,secData:true,splitOutputs:false,secOut:true,secVars:true};
function loadUI(){ try{ const r=localStorage.getItem(UI_KEY); if(r) Object.assign(ui, JSON.parse(r)); }catch(e){} }
function saveUI(){ try{ localStorage.setItem(UI_KEY, JSON.stringify(ui)); }catch(e){} }
function applyUI(){
  const L=$("#leftPanel"), R=$("#rightPanel"); if(!L||!R) return;
  ui.leftW=Math.max(180,Math.min(520,ui.leftW||262));
  ui.rightW=Math.max(180,Math.min(520,ui.rightW||300));
  L.style.width=ui.leftW+"px"; R.style.width=ui.rightW+"px";
  L.classList.toggle("open", !!ui.left); R.classList.toggle("open", !!ui.right);
  L.setAttribute("aria-hidden", ui.left?"false":"true"); R.setAttribute("aria-hidden", ui.right?"false":"true");
  $("#secNotebooks").classList.toggle("collapsed", ui.secNb===false);
  $("#secData").classList.toggle("collapsed", ui.secData===false);
  const AG=$("#agentPanel");
  if(AG){ ui.agentW=Math.max(280,Math.min(560,ui.agentW||360));
    AG.style.width=ui.agentW+"px";
    AG.classList.toggle("open", !!ui.agent);
    AG.setAttribute("aria-hidden", ui.agent?"false":"true"); }
  const ba=$("#btnAgent"); if(ba) ba.classList.toggle("active", !!ui.agent);
  $("#secOutputs").classList.toggle("collapsed", ui.secOut===false);
  $("#secVars").classList.toggle("collapsed", ui.secVars===false);
  $("#nbTitle").classList.toggle("active", !!ui.left);
  $("#btnVars").classList.toggle("active", !!ui.right);
  inspectorOpen=!!ui.right;
}
function toggleLeft(force){ ui.left=(force!=null)?force:!ui.left; applyUI(); saveUI(); }
function toggleRight(force){ ui.right=(force!=null)?force:!ui.right; applyUI(); saveUI(); if(ui.right) refreshInspector(); }
