/* ===== collapse ===== */
function peekText(cell) {
  const raw = (cell.taEl ? cell.taEl.value : cell.source) || "";
  const first = (raw.split("\n").find((l) => l.trim().length) || "").trim();
  const more = raw.split("\n").filter((l) => l.trim().length).length;
  const tag = cell.type === "markdown" ? "md" : "py";
  return (first || "(empty)") + (more > 1 ? "   · " + more + " lines" : "");
}
function applyCollapsed(cell) {
  if (!cell.el) return;
  cell.el.classList.toggle("collapsed", !!cell.collapsed);
  if (cell.colBtn) cell.colBtn.classList.toggle("col-on", !!cell.collapsed);
  if (cell.peekEl) cell.peekEl.textContent = peekText(cell);
}
function setCollapsed(cell, on) {
  cell.collapsed = !!on;
  if (on && document.activeElement === cell.taEl) cell.taEl.blur();
  applyCollapsed(cell);
  selectCell(cell.id, "command");
  schedulePersist();
}

function refreshExec(cell) {
  if (cell.type === "markdown") {
    cell.execEl.textContent = "¶";
    cell.el.classList.remove("done");
    return;
  }
  if (cell.el.classList.contains("running")) {
    cell.execEl.textContent = "[*]";
    return;
  }
  if (cell.execCount != null) {
    cell.execEl.textContent = "[" + cell.execCount + "]";
    cell.el.classList.add("done");
  } else {
    cell.execEl.textContent = "[ ]";
    cell.el.classList.remove("done");
  }
}
