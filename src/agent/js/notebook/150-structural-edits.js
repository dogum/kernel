/* ===== structural edits ===== */
function insertCell(idx, type, focus) {
  const cell = mkCell(type || "code", "");
  cells.splice(Math.max(0, Math.min(idx, cells.length)), 0, cell);
  render();
  if (focus) selectCell(cell.id, "edit");
  else selectCell(cell.id, "command");
  schedulePersist();
  return cell;
}
function moveCell(cell, dir) {
  const i = indexOf(cell),
    j = i + dir;
  if (j < 0 || j >= cells.length) return;
  cells.splice(i, 1);
  cells.splice(j, 0, cell);
  render();
  selectCell(cell.id, "command");
  schedulePersist();
}
function convertTo(cell, type) {
  if (cell.type === type) return;
  cell.type = type;
  cell.execCount = null;
  cell.outputs = [];
  cell.editing = false;
  render();
  selectCell(cell.id, "command");
  schedulePersist();
  scheduleWorkspacePersist();
}
function toggleType(cell) {
  convertTo(cell, cell.type === "code" ? "markdown" : "code");
}
/* Deleted cells stay restorable (toast Undo, or z in command mode) for this page session. */
const deletedCells = [];
function deleteCell(cell) {
  const i = indexOf(cell);
  const snap = {
    notebook: nbId,
    index: i,
    prev: i > 0 ? cells[i - 1].id : null,
    next: i + 1 < cells.length ? cells[i + 1].id : null,
    cell: {
      id: cell.id,
      type: cell.type,
      source: cell.taEl ? cell.taEl.value : cell.source,
      outputs: clonePlain(cell.outputs || []),
      execCount: cell.execCount,
      runtime: cell.runtime == null ? null : cell.runtime,
      provenance: clonePlain(cell.provenance || null),
      collapsed: !!cell.collapsed,
    },
    placeholder: null,
  };
  cells.splice(i, 1);
  if (!cells.length) {
    const blank = mkCell("code", "");
    cells.push(blank);
    snap.placeholder = blank.id;
  }
  render();
  const sel = cells[Math.min(i, cells.length - 1)];
  if (sel) selectCell(sel.id, "command");
  schedulePersist();
  scheduleWorkspacePersist();
  deletedCells.push(snap);
  if (deletedCells.length > 30) deletedCells.shift();
  toast("Deleted cell " + (i + 1), null, { action: { label: "Undo", run: () => undoDeleteCell(snap) } });
}
function undoDeleteCell(target) {
  let snap = null;
  if (target) {
    const at = deletedCells.indexOf(target);
    if (at < 0) {
      toast("That cell was already restored");
      return;
    }
    if (target.notebook !== nbId) {
      toast("Switch back to that notebook to restore the cell", "err");
      return;
    }
    snap = deletedCells.splice(at, 1)[0];
  } else {
    for (let i = deletedCells.length - 1; i >= 0; i--) {
      if (deletedCells[i].notebook === nbId) {
        snap = deletedCells.splice(i, 1)[0];
        break;
      }
    }
  }
  if (!snap) {
    toast("Nothing to undo");
    return;
  }
  const blank = snap.placeholder && findCell(snap.placeholder);
  if (blank && !(blank.taEl ? blank.taEl.value : blank.source).trim() && !(blank.outputs || []).length)
    cells.splice(indexOf(blank), 1);
  const c = mkCell(snap.cell.type, snap.cell.source, findCell(snap.cell.id) ? uid() : snap.cell.id);
  Object.assign(c, {
    outputs: snap.cell.outputs,
    execCount: snap.cell.execCount,
    runtime: snap.cell.runtime,
    provenance: snap.cell.provenance,
    collapsed: snap.cell.collapsed,
  });
  const next = snap.next && findCell(snap.next),
    prev = snap.prev && findCell(snap.prev);
  const at = next ? indexOf(next) : prev ? indexOf(prev) + 1 : snap.prev ? Math.min(snap.index, cells.length) : 0;
  cells.splice(at, 0, c);
  render();
  selectCell(c.id, "command");
  if (c.el) c.el.scrollIntoView({ block: "center", behavior: "smooth" });
  refreshNotebookFreshness();
  schedulePersist();
  scheduleWorkspacePersist();
  toast("Restored cell " + (indexOf(c) + 1));
}
