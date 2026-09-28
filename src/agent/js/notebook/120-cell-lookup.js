/* ===== cell lookup / ordering ===== */
function findCell(id){ return cells.find(c=>c.id===id)||null; }
function indexOf(cell){ return cells.indexOf(cell); }

function render(){
  nb.innerHTML="";
  for(const cell of cells){ nb.appendChild(buildCell(cell)); }
  renderWelcome();
  $("#cellCount").textContent=cells.length;
  if(selectedId){ const c=findCell(selectedId); if(c&&c.el) c.el.classList.add("selected"); }
  if(ui&&ui.splitOutputs) layoutOutputs();
  if(ui&&ui.left) renderLibrary();
  recomputeDependencies();
}

