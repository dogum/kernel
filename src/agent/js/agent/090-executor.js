/* ── tool executor ── */
async function execTool(tu){
  const inp=tu.input||{},name=tu.name;
  try{
    if(tu.invalidInput)return [{type:'text',text:'ERROR: INVALID_JSON — the arguments for '+name+' could not be parsed. Nothing was executed; re-issue the call with complete JSON arguments.'}];
    const spec=AG_TOOLS.find(t=>t.name===name),missing=spec?(spec.input_schema.required||[]).filter(k=>inp[k]==null):[];if(missing.length)return [{type:'text',text:'ERROR: '+name+' requires '+missing.join(', ')+'. Nothing was executed.'}];
    const exclusion=agentStateExclusionReason(name,inp);if(exclusion)return [{type:'text',text:exclusion}];
    if(name==='update_plan'){
      const before=runPlanSignature(),seen=new Set();agPlan=(Array.isArray(inp.steps)?inp.steps:[]).slice(0,30).map((s,i)=>{let id=String(s.id||('step_'+(i+1))).replace(/[^A-Za-z0-9_.-]/g,'_').slice(0,48);if(seen.has(id))id+='_'+(i+1);seen.add(id);return {id,title:String(s.title||id).slice(0,180),status:['pending','in_progress','completed'].includes(s.status)?s.status:'pending'}});if(runPlanSignature()!==before)noteRunProgress('plan');if(agRun)agRun.plan=clonePlain(agPlan);renderPlanStrip();renderRunControl();await runEvent('plan_updated',String(inp.explanation||'Plan updated').slice(0,300));scheduleThreadSave();return [{type:'text',text:JSON.stringify({ok:true,steps:agPlan.length})}];
    }
    if(name==='finish_run'){
      const unfinished=(agPlan||[]).filter(s=>s.status!=='completed'),summary=String(inp.summary||'').trim().slice(0,1000),checked=validateCompletionEvidence(inp.evidence),evidence=checked.evidence,limitations=(Array.isArray(inp.limitations)?inp.limitations:[]).map(x=>String(x||'').trim().slice(0,500)).filter(Boolean).slice(0,20);
      if(unfinished.length){const reason='Completion rejected: '+unfinished.length+' visible plan step'+(unfinished.length===1?' is':'s are')+' unfinished ('+unfinished.map(s=>s.id).join(', ')+'). Continue the work and update the plan from actual evidence before requesting completion.',guard=await recordCompletionRejection(reason);return [{type:'text',text:reason+(guard.pause?' KERNEL will pause this run after committing the tool result because two no-progress completion retries were already used.':'')}]}
      if(!summary||!evidence.length||checked.errors.length){const reason='Completion rejected: provide a concise summary and at least one valid evidence item. Every evidence item must reference a fresh executed cell or present artifact by stable ID.'+(checked.errors.length?' Validation errors: '+checked.errors.join('; '):''),guard=await recordCompletionRejection(reason);return [{type:'text',text:reason+(guard.pause?' KERNEL will pause this run after committing the tool result because two no-progress completion retries were already used.':'')}]}
      if(agRun){agRun.completionGuardCount=0;agRun.completionPauseReason='';agRun.completionAccepted={at:Date.now(),summary,evidence,evidenceSignature:completionEvidenceSignature(evidence),limitations,planSignature:runPlanSignature()}}await runEvent('completion_accepted',summary);return [{type:'text',text:JSON.stringify({ok:true,completion:'accepted',evidenceItems:evidence.length,limitations:limitations.length})+'\nKERNEL accepted the completion request. Return the concise final answer now without requesting more tools.'}];
    }
    if(name==='add_cells'){
      const arr=Array.isArray(inp.cells)?inp.cells:[];
      if(!arr.length)return [{type:'text',text:'No cells given.'}];
      let at=cells.length;
      if(inp.after_cell_id){const ac=findCell(inp.after_cell_id);if(ac&&getCellContextPolicy(ac.id)==='excluded')return [{type:'text',text:'BLOCKED: the human excluded the target cell from agent context.'}];if(ac)at=indexOf(ac)+1}
      const added=[];
      for(let i=0;i<arr.length;i++){
        const spec=arr[i],type=spec.type==='markdown'?'markdown':'code';
        const cell=insertCell(at+i,type,false);
        cell.source=String(spec.source||'');
        if(cell.taEl)cell.taEl.value=cell.source;
        paint(cell);
        if(type==='markdown')showRendered(cell,true);
        added.push({cell_id:cell.id,index:indexOf(cell),type});
        txDom('c',chip('+ '+type+' · '+cellTag(cell),'',cell.id));
      }
      schedulePersist();
      recomputeDependencies();
      focusAgCell(findCell(added[added.length-1].cell_id));
      const result=[{type:'text',text:JSON.stringify({added})}];
      if(inp.run===true)result.push(...await agRunCellsForTool(added.map(a=>findCell(a.cell_id)).filter(c=>c&&c.type==='code')));
      return result;
    }
    if(name==='run_cell'){
      const cell=findCell(inp.cell_id);
      if(!cell)return [{type:'text',text:'ERROR: no cell with id '+inp.cell_id}];
      if(cell.type!=='code')return [{type:'text',text:'Not a code cell.'}];
      if(!await agRunCell(cell))return [{type:'text',text:'ERROR: the kernel could not run this cell right now (busy or not ready). Nothing was executed.'}];
      const hadErr=cell.outputs&&cell.outputs.some(o=>o.kind==='error');
      txDom('c',chip('▶ ran '+cellTag(cell)+' · '+(cell.runtime!=null?fmtDur(cell.runtime):'—'),hadErr?'err':'run',cell.id));
      return await marshalCell(cell);
    }
    if(name==='run_all'){
      await agWaitKernel();
      let start=0;
      if(inp.from_cell_id){const fc=findCell(inp.from_cell_id);if(fc)start=indexOf(fc)}
      const lines=[];let lastCell=null,errCell=null;
      for(let j=start;j<cells.length;j++){
        const c2=cells[j];
        if(c2.type!=='code'){showRendered(c2,true);continue}
        if(!await agRunCell(c2)){lines.push(cellLabel(c2)+' NOT RUN · kernel busy or not ready');break}
        lastCell=c2;
        const bad=c2.outputs&&c2.outputs.some(o=>o.kind==='error');
        lines.push(cellLabel(c2)+' '+(bad?'ERROR':'ok')+' · '+(c2.runtime!=null?fmtDur(c2.runtime):'—')+' · '+(c2.outputs?c2.outputs.length:0)+' outputs');
        if(bad){errCell=c2;break}
        if(agStop){lines.push('(stopped by the human)');break}
      }
      txDom('c',chip('▶ ran '+lines.length+' cells'+(errCell?' · stopped at error':''),errCell?'err':'run'));
      let blocks=[{type:'text',text:lines.join('\n')||'No code cells to run.'}];
      const detail=errCell||lastCell;
      if(detail)blocks=blocks.concat(await marshalCell(detail));
      return blocks;
    }
    if(name==='edit_cell'){
      const ce=findCell(inp.cell_id);
      if(!ce)return [{type:'text',text:'ERROR: no cell with id '+inp.cell_id}];
      if(getCellContextPolicy(ce.id)==='excluded')return [{type:'text',text:'BLOCKED: the human excluded this cell from agent context.'}];
      ce.source=String(inp.source||'');
      if(ce.taEl)ce.taEl.value=ce.source;
      paint(ce);
      if(ce.type==='markdown')showRendered(ce,true);
      schedulePersist();
      recomputeDependencies();
      txDom('c',chip('✎ edited '+cellTag(ce),'',ce.id));
      if(inp.run===true&&ce.type==='code')return [{type:'text',text:'{"ok":true}'},...await agRunCellsForTool([ce])];
      return [{type:'text',text:'{"ok":true}'}];
    }
    if(name==='read_cell'){
      const cr=findCell(inp.cell_id);
      if(!cr)return [{type:'text',text:'ERROR: no cell with id '+inp.cell_id}];
      if(getCellContextPolicy(cr.id)==='excluded')return [{type:'text',text:'BLOCKED: the human excluded this cell from agent context.'}];
      txDom('c',chip('read '+cellTag(cr),'',cr.id));
      let bb=[{type:'text',text:'source:\n'+agTrunc(cr.taEl?cr.taEl.value:cr.source,AG_MAX_TEXT)}];
      if(cr.type==='code')bb=bb.concat(await marshalCell(cr));
      return bb;
    }
    if(name==='inspect_namespace'){
      await agWaitKernel();
      const raw=await runPy('_inspect_ns()');
      txDom('c',chip('⌕ namespace'));
      try{
        const rows=JSON.parse(raw);
        if(!rows.length)return [{type:'text',text:'(namespace is empty)'}];
        return [{type:'text',text:rows.map(r=>r.name+' · '+r.type+' · '+(r.info||'')+(r.size?' · '+r.size:'')).join('\n')}];
      }catch(e){return [{type:'text',text:agTrunc(raw,AG_MAX_TEXT)}]}
    }
    if(name==='inspect_variable'){
      await agWaitKernel();
      if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(inp.name||'')))return [{type:'text',text:'ERROR: invalid identifier'}];
      const det=await runPy('_var_detail('+JSON.stringify(inp.name)+')');
      txDom('c',chip('⌕ '+inp.name));
      return [{type:'text',text:agTrunc(det,AG_MAX_TEXT)}];
    }
    if(name==='list_data_files'){
      txDom('c',chip('⌕ data files'));
      const visible=dataFiles.filter(d=>getArtifactContextPolicy(d.id)!=='excluded');if(!visible.length)return [{type:'text',text:dataFiles.length?'(all mounted artifacts are excluded by the human)':'(no files mounted — the human can add them with + Data)'}];
      return [{type:'text',text:visible.map(d=>'artifact://'+d.id+' · '+d.name+' · '+artifactStage(d)+' · '+(d.name.split('.').pop()||'file').toUpperCase()+' · '+(d.size||0)+' bytes'+(d.preview?'\n  preview: '+agTrunc(d.preview,240):'')).join('\n')+(visible.length<dataFiles.length?'\n('+String(dataFiles.length-visible.length)+' excluded artifact(s) omitted)':'')}];
    }
    if(name==='read_data_file'){
      const d=dataEntry(inp.path);if(!d)return [{type:'text',text:'ERROR: no artifact at '+String(inp.path)}];if(getArtifactContextPolicy(d.id)==='excluded')return [{type:'text',text:'BLOCKED: the human excluded this artifact from agent context.'}];const off=Math.max(0,inp.offset|0),lim=Math.max(256,Math.min(12000,inp.limit|0||4000)),bytes=d.bytes instanceof Uint8Array?d.bytes:new Uint8Array(d.bytes||[]),text=new TextDecoder('utf-8',{fatal:false}).decode(bytes);txDom('c',chip('⌕ '+d.name+' @ '+off));return [{type:'text',text:'artifact://'+d.id+' · characters '+off+'..'+Math.min(text.length,off+lim)+' of '+text.length+'\n'+text.slice(off,off+lim)+(off+lim<text.length?'\n[more available: offset '+(off+lim)+']':'')}];
    }
    if(name==='save_data_file'){
      await agWaitKernel();
      let fname;try{fname=safeArtifactPath(inp.filename)}catch(e){return [{type:'text',text:'ERROR: '+e.message}]}
      const existing=dataEntry(fname);if(existing&&getArtifactContextPolicy(existing.id)==='excluded')return [{type:'text',text:'BLOCKED: the human excluded this artifact from agent context.'}];
      try{
        if(inp.content!=null)await pyFS.write(fname,new TextEncoder().encode(String(inp.content)));
        const buf=await pyFS.read(fname);
        let preview='';
        try{preview=new TextDecoder('utf-8',{fatal:false}).decode(buf.slice(0,8192)).slice(0,4000)}catch(e){}
        const old=dataEntry(fname),rec={id:old&&old.id||artifactId(),name:fname,path:fname,size:buf.length,type:'',preview,origin:'agent',stage:inp.lifecycle==='final'?'final':'scratch',createdAt:old&&old.createdAt||Date.now(),updatedAt:Date.now(),fingerprint:buf.length+':'+crc32(buf),producer:{runId:agRun&&agRun.id||null,cellId:inp.source_cell_id||null,threadId:agThreadId,toolCallId:tu.id,actor:'agent',at:Date.now()},bytes:buf.slice(),blob:null,fsStat:null};
        const ent=dataFiles.find(d=>d.name===fname);
        if(ent)Object.assign(ent,rec);else dataFiles.push(rec);
        renderDataChips();renderDataList();recomputeDependencies();scheduleWorkspacePersist();
        txDom('c',chip('⤴ '+rec.stage+' '+fname+' · '+buf.length+' bytes'));
        return [{type:'text',text:JSON.stringify({ok:true,artifact_id:rec.id,path:fname,lifecycle:rec.stage,size:buf.length})}];
      }catch(err){
        return [{type:'text',text:'ERROR: could not publish "'+fname+'" — '+String(err&&err.message?err.message:err)+'. Write it first (e.g., df.to_csv("'+fname+'")) or pass content.'}];
      }
    }
    if(name==='set_artifact_stage'){const d=dataEntry(inp.artifact_id);if(!d)return [{type:'text',text:'ERROR: artifact not found'}];if(getArtifactContextPolicy(d.id)==='excluded')return [{type:'text',text:'BLOCKED: the human excluded this artifact from agent context.'}];if(artifactStage(d)==='input')return [{type:'text',text:'ERROR: uploaded inputs keep the input lifecycle; create a derived working result instead.'}];setArtifactStage(d.id,inp.stage==='final'?'final':'scratch');txDom('c',chip('◆ '+artifactStage(d)+' '+d.name));return [{type:'text',text:JSON.stringify({ok:true,artifact_id:d.id,stage:artifactStage(d)})}]}
    if(name==='set_notebook_name'){
      const nm=String(inp.name||'').trim().slice(0,80);
      if(!nm)return [{type:'text',text:'ERROR: empty name'}];
      nbName=nm;setNbTitle();
      try{
        const lib=readLib();const e2=lib.notebooks.find(n=>n.id===nbId);
        if(e2){e2.name=nm;e2.updated=Date.now();writeLib(lib)}
        const d=loadCellsFor(nbId)||{cells:[]};d.name=nm;localStorage.setItem(nbKey(nbId),JSON.stringify(d));
      }catch(e){}
      if(ui.left)renderLibrary();
      txDom('c',chip('✎ named "'+nm+'"'));
      return [{type:'text',text:'{"ok":true}'}];
    }
    if(name==='delete_cell'){
      const cd=findCell(inp.cell_id);
      if(!cd)return [{type:'text',text:'ERROR: no cell with id '+inp.cell_id}];
      if(getCellContextPolicy(cd.id)==='excluded')return [{type:'text',text:'BLOCKED: the human excluded this cell from agent context.'}];
      const lbl=cellTag(cd);
      deleteCell(cd);
      recomputeDependencies();
      txDom('c',chip('✕ deleted '+lbl));
      return [{type:'text',text:'{"ok":true}'}];
    }
    if(name==='move_cell'){
      const cm=findCell(inp.cell_id);
      if(!cm)return [{type:'text',text:'ERROR: no cell with id '+inp.cell_id}];
      if(getCellContextPolicy(cm.id)==='excluded')return [{type:'text',text:'BLOCKED: the human excluded this cell from agent context.'}];
      const i0=indexOf(cm),i1=Math.max(0,Math.min(cells.length-1,inp.to_index|0));
      cells.splice(i0,1);cells.splice(i1,0,cm);
      render();selectCell(cm.id,'command');schedulePersist();recomputeDependencies();
      txDom('c',chip('⇅ moved to cell '+(i1+1),null,cm.id));
      return [{type:'text',text:'{"ok":true}'}];
    }
    return [{type:'text',text:'ERROR: unknown tool '+name}];
  }catch(err){
    return [{type:'text',text:'ERROR (tool '+name+'): '+String(err&&err.message?err.message:err)}];
  }
}

