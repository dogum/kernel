/* ===== selection & edit/command mode ===== */
function selectCell(id, m){
  if(selectedId && selectedId!==id){ const p=findCell(selectedId); if(p&&p.el) p.el.classList.remove("selected"); }
  selectedId=id; mode=m||"command";
  const cell=findCell(id); if(!cell) return;
  if(cell.el) cell.el.classList.add("selected");
  if(mode==="edit"){
    if(cell.type==="markdown" && cell.el.classList.contains("rendered")) showRendered(cell,false);
    if(document.activeElement!==cell.taEl) cell.taEl.focus();
  } else {
    if(document.activeElement===cell.taEl) cell.taEl.blur();
  }
}
function enterEdit(cell){
  if(cell.type==="markdown") showRendered(cell,false);
  cell.editing=true;
  selectCell(cell.id,"edit");
}

/* ── math masking: protect $…$ / $$…$$ / \(…\) / \[…\] from the markdown pass,
   restore verbatim after — KaTeX auto-render then finds clean delimiters ── */
function renderMarkdown(src){
  const F=[],C=[],M=[];
  let s=String(src==null?'':src);
  /* 1 · shelve fenced code (math inside fences stays literal) */
  s=s.replace(/```[\s\S]*?```/g, m=>{F.push(m);return '\uE100'+(F.length-1)+'\uE101'});
  /* 2 · shelve inline code spans */
  s=s.replace(/`[^`\n]+`/g, m=>{C.push(m);return '\uE200'+(C.length-1)+'\uE201'});
  /* 3 · shelve math (display first, then inline with currency guards) */
  s=s.replace(/\$\$([\s\S]+?)\$\$/g, m=>{M.push(m);return '\uE000'+(M.length-1)+'\uE001'});
  s=s.replace(/\\\[([\s\S]+?)\\\]/g, m=>{M.push(m);return '\uE000'+(M.length-1)+'\uE001'});
  s=s.replace(/\\\(([\s\S]+?)\\\)/g, m=>{M.push(m);return '\uE000'+(M.length-1)+'\uE001'});
  s=s.replace(/(^|[^\\$])\$(?![\s$])((?:\\.|[^$\n])+?)(?<![\s\\])\$(?!\d)/g,
    (m,pre,body)=>{M.push('$'+body+'$');return pre+'\uE000'+(M.length-1)+'\uE001'});
  /* 4 · code back in place for the real renderer */
  s=s.replace(/\uE200(\d+)\uE201/g,(m,i)=>C[+i]);
  s=s.replace(/\uE100(\d+)\uE101/g,(m,i)=>F[+i]);
  /* 5 · markdown, then math restored as escaped text in intact nodes */
  let html=renderMarkdownCore(s);
  html=html.replace(/\uE000(\d+)\uE001/g,(m,i)=>esc(M[+i]));
  return html;
}

function showRendered(cell, on){
  if(cell.type!=="markdown") return;
  const ed=cell.el.querySelector(".editor");
  if(on){
    cell.mdEl.innerHTML=renderMarkdown(cell.source);
    cell.mdEl.hidden=false; if(ed) ed.style.display="none";
    cell.el.classList.add("rendered"); cell.editing=false;
    typesetMarkdown(cell.mdEl);
  } else {
    cell.mdEl.hidden=true; if(ed) ed.style.display="";
    cell.el.classList.remove("rendered"); cell.editing=true;
  }
}

