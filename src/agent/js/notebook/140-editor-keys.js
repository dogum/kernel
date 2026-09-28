/* ===== editor keystrokes ===== */
function editorKey(e, cell){
  const ta=cell.taEl;
  if(cmp.open){
    if(e.key==="ArrowDown"){ e.preventDefault(); cmp.move(1); return; }
    if(e.key==="ArrowUp"){ e.preventDefault(); cmp.move(-1); return; }
    if(e.key==="Enter" || e.key==="Tab"){ e.preventDefault(); cmp.accept(cell); return; }
    if(e.key==="Escape"){ e.preventDefault(); cmp.hide(); return; }
  }
  if((e.key===" "||e.code==="Space") && e.ctrlKey){ e.preventDefault(); cmp.trigger(cell, true); return; }
  if(e.key==="Enter" && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey){ e.preventDefault(); cmp.hide(); runAndAdvance(cell); return; }
  if(e.key==="Enter" && (e.metaKey||e.ctrlKey)){ e.preventDefault(); cmp.hide(); runCell(cell); return; }
  if(e.key==="Enter" && e.altKey){ e.preventDefault(); cmp.hide(); runCell(cell).then(()=>insertCell(indexOf(cell)+1,"code",true)); return; }
  if(e.key==="Escape"){ e.preventDefault(); cmp.hide(); ta.blur(); selectCell(cell.id,"command"); return; }
  if(e.key==="Tab"){ e.preventDefault(); handleTab(ta, e.shiftKey, cell); return; }
  if(e.key==="Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && cell.type==="code"){ e.preventDefault(); autoIndent(ta, cell); return; }
}
function handleTab(ta, dedent, cell){
  const s=ta.selectionStart, e=ta.selectionEnd, val=ta.value, unit="    ";
  if(s===e && !dedent){
    ta.value=val.slice(0,s)+unit+val.slice(s);
    ta.selectionStart=ta.selectionEnd=s+unit.length;
  } else {
    const lineStart=val.lastIndexOf("\n",s-1)+1;
    let lineEnd=val.indexOf("\n",e); if(lineEnd===-1) lineEnd=val.length;
    const lines=val.slice(lineStart,lineEnd).split("\n");
    let delta=0, firstDelta=0;
    const out=lines.map((ln,i)=>{
      if(dedent){ const m=ln.match(/^( {1,4}|\t)/); if(m){ const r=m[0].length; if(i===0) firstDelta=-r; delta-=r; return ln.slice(r);} return ln; }
      if(i===0) firstDelta=unit.length; delta+=unit.length; return unit+ln;
    });
    ta.value=val.slice(0,lineStart)+out.join("\n")+val.slice(lineEnd);
    ta.selectionStart=Math.max(lineStart, s+firstDelta); ta.selectionEnd=e+delta;
  }
  cell.source=ta.value; paint(cell); schedulePersist();
}
function autoIndent(ta, cell){
  const s=ta.selectionStart, val=ta.value;
  const lineStart=val.lastIndexOf("\n",s-1)+1;
  const line=val.slice(lineStart,s);
  let indent=(line.match(/^[ \t]*/)||[""])[0];
  if(line.trim().endsWith(":")) indent+="    ";
  const ins="\n"+indent;
  ta.value=val.slice(0,s)+ins+val.slice(ta.selectionEnd);
  ta.selectionStart=ta.selectionEnd=s+ins.length;
  cell.source=ta.value; paint(cell); schedulePersist();
}

