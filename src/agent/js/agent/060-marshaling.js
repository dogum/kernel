/* ── output marshaling ── */
function agTrunc(t,n){t=String(t==null?'':t);return t.length>n?t.slice(0,n)+'…[truncated]':t}
function agShrink(b64,mime){
  return new Promise(res=>{
    if(!b64||b64.length<2000000){res({b64,mime:mime||'image/png'});return}
    const img=new Image();
    img.onload=()=>{const w=Math.min(1200,img.width),h=Math.round(img.height*w/img.width);
      const c=document.createElement('canvas');c.width=w;c.height=h;
      c.getContext('2d').drawImage(img,0,0,w,h);
      res({b64:c.toDataURL('image/png').split(',')[1],mime:'image/png'})};
    img.onerror=()=>res({b64,mime:mime||'image/png'});
    img.src='data:'+(mime||'image/png')+';base64,'+b64;
  });
}
async function marshalCell(cell,budget){
  const blocks=[];let imgs=0;
  const hadErr=cell.outputs&&cell.outputs.some(o=>o.kind==='error');
  blocks.push({type:'text',text:'Cell ['+(cell.execCount!=null?cell.execCount:'?')+'] · '+(cell.runtime!=null?fmtDur(cell.runtime):'—')+(hadErr?' · ERROR':'')});
  const outs=cell.outputs||[];
  if(!outs.length){blocks.push({type:'text',text:'Cell ran, no output.'});return blocks}
  for(const o of outs){
    if(o.kind==='stream')blocks.push({type:'text',text:(o.name==='stderr'?'stderr: ':'stdout: ')+agTrunc(o.text,AG_MAX_TEXT)});
    else if(o.kind==='text')blocks.push({type:'text',text:agTrunc(o.text,AG_MAX_TEXT)});
    else if(o.kind==='error')blocks.push({type:'text',text:'ERROR:\n'+agTrunc(o.text,AG_MAX_ERR)});
    else if(o.kind==='image'){
      imgs++;
      if(imgs>AG_MAX_IMG||(budget&&budget.images>=AG_MAX_IMG*2))continue;if(budget)budget.images++;
      const im=await agShrink(o.b64,o.mime);
      blocks.push({type:'image',source:{type:'base64',media_type:im.mime,data:im.b64}});
    }
    else if(o.kind==='html'){
      const ex=String(o.html||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
      blocks.push({type:'text',text:'[HTML output rendered]'+(ex&&ex.length<1200?' — '+ex:'')});
    }
    else if(o.kind==='iframe_html')blocks.push({type:'text',text:'[interactive output rendered — not visible to you; print a text summary if you must reason about it]'});
  }
  if(imgs>AG_MAX_IMG)blocks.push({type:'text',text:'['+(imgs-AG_MAX_IMG)+' more figures omitted]'});
  return blocks;
}

