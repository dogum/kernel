/* ── composer ── */
function agSendMsg(){
  const v=$("#agIn").value.trim();
  if((!v&&!agImgs.length)||agRunning)return;if(busy){toast('Wait for the running cell to finish.','err');return}
  $("#agIn").value='';
  agentTurn(v);
}
$("#agSend").addEventListener('click',agSendMsg);
$("#agStop").addEventListener('click',()=>{agStop=true;agAbortReason='user_stop';resolveApproval(false);if(busy&&activeToolContext&&kw.mode==='worker'&&(kw.interruptible||confirm('Stop the running cell too? This page cannot interrupt Python in place, so stopping it restarts Python and clears all variables. Cancel lets the cell finish before the run stops.')))interruptKernel('stop');if(agAbort){try{agAbort.abort()}catch(e){}}$("#agStop").textContent='STOPPING…';setTimeout(()=>{$("#agStop").textContent='STOP'},1500)});
$("#agMode").addEventListener('click',()=>{agAutonomy=agAutonomy==='auto'?'step':'auto';try{localStorage.setItem(AG_AUTO,agAutonomy)}catch(e){}agStateUi()});
$("#agModelChip").addEventListener('click',()=>{if(agRunning){toast("Finish the current turn first.","err");return}openAgSettings()});
$("#agIn").addEventListener('keydown',e=>{
  e.stopPropagation();
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();agSendMsg()}
});
function renderThumbs(){
  $("#agThumbs").innerHTML=agImgs.map((im,i)=>
    '<span class="ag-thumb"><img src="'+im.url+'"><button data-rm="'+i+'" title="remove">✕</button></span>').join('');
}
$("#agThumbs").addEventListener('click',e=>{
  const b=e.target.closest('[data-rm]');
  if(b){agImgs.splice(+b.dataset.rm,1);renderThumbs()}
});
async function agAddImage(file){
  if(!file||agImgs.length>=4)return;
  const okTypes=['image/png','image/jpeg','image/webp','image/gif'];
  const mt=okTypes.includes(file.type)?file.type:'image/png';
  const url=await new Promise(res=>{const r=new FileReader();r.onload=()=>res(r.result);r.readAsDataURL(file)});
  const b64=String(url).split(',')[1]||'';
  const sh=await agShrink(b64,mt);
  agImgs.push({media_type:sh.mime,data:sh.b64,url:'data:'+sh.mime+';base64,'+sh.b64});
  renderThumbs();
}
$("#agIn").addEventListener('paste',e=>{
  const items=e.clipboardData&&e.clipboardData.items;if(!items)return;
  for(const it of items){
    if(it.type&&it.type.indexOf('image/')===0){e.preventDefault();agAddImage(it.getAsFile())}
  }
});
const agPanelEl=document.getElementById('agentPanel');
agPanelEl.addEventListener('dragover',e=>{if(e.dataTransfer&&[...e.dataTransfer.types].includes('Files')){e.preventDefault()}});
agPanelEl.addEventListener('drop',e=>{
  const fs=e.dataTransfer&&e.dataTransfer.files;if(!fs||!fs.length)return;
  let any=false;
  for(const f of fs)if(f.type&&f.type.indexOf('image/')===0){any=true;agAddImage(f)}
  if(any)e.preventDefault();
});

