/* ===== global keyboard (command mode + save) ===== */
let pendingD = false,
  pendingDTimer = null,
  pendingI = false,
  pendingITimer = null;
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
    e.preventDefault();
    downloadIpynb();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && (e.key === "f" || e.key === "F")) {
    e.preventDefault();
    find.open();
    return;
  }
  if (e.key === "Escape" && findOpen) {
    find.close();
    return;
  }
  const helpOpen = $("#helpScrim").classList.contains("show");
  const menuOpen = $("#moreMenu").classList.contains("open");
  if (e.key === "Escape" && menuOpen) {
    closeMenu();
    return;
  }
  if (e.key === "Escape" && helpOpen) {
    closeHelp();
    return;
  }
  if (e.key === "Escape" && inspectorOpen) {
    closeInspector();
    return;
  }
  const ae = document.activeElement;
  if (ae && (ae.tagName === "TEXTAREA" || ae.tagName === "INPUT" || (ae.closest && ae.closest("#findbar")))) return;
  if (helpOpen) return;
  let cell = selectedId ? findCell(selectedId) : null;
  if (!cell) {
    if ((e.key === "ArrowDown" || e.key === "j") && cells.length) {
      e.preventDefault();
      selectCell(cells[0].id, "command");
    }
    return;
  }
  const i = indexOf(cell);
  if (e.key === "Enter" && e.shiftKey) {
    e.preventDefault();
    runAndAdvance(cell);
    return;
  }
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    runCell(cell);
    return;
  }
  if (e.key === "Enter" && e.altKey) {
    e.preventDefault();
    runCell(cell).then(() => insertCell(i + 1, "code", true));
    return;
  }
  switch (e.key) {
    case "Enter":
      e.preventDefault();
      enterEdit(cell);
      break;
    case "ArrowDown":
    case "j":
      if (i < cells.length - 1) {
        e.preventDefault();
        selectCell(cells[i + 1].id, "command");
        if (cells[i + 1].el) cells[i + 1].el.scrollIntoView({ block: "nearest" });
      }
      break;
    case "ArrowUp":
    case "k":
      if (i > 0) {
        e.preventDefault();
        selectCell(cells[i - 1].id, "command");
        if (cells[i - 1].el) cells[i - 1].el.scrollIntoView({ block: "nearest" });
      }
      break;
    case "a":
      e.preventDefault();
      insertCell(i, "code", true);
      break;
    case "b":
      e.preventDefault();
      insertCell(i + 1, "code", true);
      break;
    case "m":
      e.preventDefault();
      convertTo(cell, "markdown");
      break;
    case "y":
      e.preventDefault();
      convertTo(cell, "code");
      break;
    case "?":
      e.preventDefault();
      openHelp();
      break;
    case "z":
      e.preventDefault();
      undoDeleteCell();
      break;
    case "i":
      if (pendingI) {
        clearTimeout(pendingITimer);
        pendingI = false;
        e.preventDefault();
        interruptFromHuman();
      } else {
        pendingI = true;
        pendingITimer = setTimeout(() => {
          pendingI = false;
        }, 600);
      }
      break;
    case "d":
      if (pendingD) {
        clearTimeout(pendingDTimer);
        pendingD = false;
        e.preventDefault();
        deleteCell(cell);
      } else {
        pendingD = true;
        pendingDTimer = setTimeout(() => {
          pendingD = false;
        }, 600);
      }
      break;
    default:
      break;
  }
});
