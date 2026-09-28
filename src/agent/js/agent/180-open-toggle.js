/* ── open/toggle ── */
function openAgent(){ui.agent=true;applyUI();saveUI();$("#agIn").focus()}
$("#btnAgent").addEventListener('click',()=>{ui.agent=!ui.agent;applyUI();saveUI();if(ui.agent)$("#agIn").focus()});
window.addEventListener('keydown',e=>{
  if((e.metaKey||e.ctrlKey)&&!e.altKey&&(e.key==='j'||e.key==='J')){e.preventDefault();openAgent()}
});
function flushDurableState(){try{persist()}catch(e){}try{saveActiveThreadNow()}catch(e){}try{saveWorkspaceState()}catch(e){}try{if(agRun)saveRun(agRun)}catch(e){}}
window.addEventListener('pagehide',flushDurableState);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushDurableState()});

agStateUi();agFetchModelInfo();if(agModelMigrated)setTimeout(()=>toast('Anthropic default model is now '+AG_PROVIDER_DEFS.anthropic.model+' · change it in agent settings'),1600);


