/* ===== wiring ===== */
$("#btnNew").addEventListener("click", newNotebook);
$("#nbTitle").addEventListener("click", () => {
  if (ui.left) toggleLeft(false);
  else openLibrary();
});
$("#libNew").addEventListener("click", () => {
  newNotebook();
});
$("#btnVars").addEventListener("click", toggleInspector);
$("#findCase").addEventListener("click", () => find.toggleCase());
$("#findPrev").addEventListener("click", () => find.prev());
$("#findNext").addEventListener("click", () => find.next());
$("#findRepl").addEventListener("click", () => find.replaceOne());
$("#findAll").addEventListener("click", () => find.replaceAll());
$("#findX").addEventListener("click", () => find.close());
$("#findInput").addEventListener("input", () => {
  clearTimeout(find._t);
  find._t = setTimeout(() => find.recompute(), 120);
});
$("#findInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    e.shiftKey ? find.prev() : find.next();
  }
});
$("#replaceInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    find.replaceOne();
  }
});
$("#btnOpen").addEventListener("click", () => $("#fileIpynb").click());
$("#btnSave").addEventListener("click", downloadIpynb);
$("#btnWorkspace").addEventListener("click", downloadWorkspaceZip);
$("#btnData").addEventListener("click", openData);
$("#dataUpload").addEventListener("click", () => {
  if (!kernelReady) {
    toast("Kernel still booting — one moment.", "err");
    return;
  }
  $("#fileData").click();
});
$("#dataFolderUpload").addEventListener("click", () => {
  if (!kernelReady) {
    toast("Kernel still booting — one moment.", "err");
    return;
  }
  $("#fileFolder").click();
});
$("#btnMore").addEventListener("click", (e) => {
  e.stopPropagation();
  toggleMenu();
});
$("#moreMenu").addEventListener("click", (e) => {
  const b = e.target.closest("[data-mi]");
  if (!b) return;
  closeMenu();
  const a = b.dataset.mi;
  if (a === "newNb") newNotebook();
  else if (a === "openNb") $("#btnOpen").click();
  else if (a === "saveZip") downloadWorkspaceZip();
  else if (a === "restartRun") restartAndRunAll();
  else if (a === "splitOut") setSplitOutputs(!ui.splitOutputs);
  else if (a === "collapseAll") setAllCollapsed(true);
  else if (a === "expandAll") setAllCollapsed(false);
  else if (a === "clearOutputs") clearOutputs();
  else if (a === "downloadPy") downloadPy();
  else if (a === "runZip") downloadPrivateRunZip();
  else if (a === "shareZip") downloadShareSafeZip();
  else if (a === "diagnostics") exportDiagnostics();
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".menu-wrap")) closeMenu();
});
$("#varsFilter").addEventListener("input", paintInspector);
$("#varsSort").addEventListener("change", paintInspector);
$("#varsRefresh").addEventListener("click", refreshInspector);
$("#btnRunAll").addEventListener("click", runAll);
$("#btnRestart").addEventListener("click", restartKernel);
async function interruptFromHuman() {
  if (!busy) return;
  if (kw.mode !== "worker") {
    toast("This browser is running Python on the page thread, so a running cell cannot be interrupted.", "err");
    return;
  }
  if (
    !kw.interruptible &&
    !confirm(
      "This page is not cross-origin isolated, so interrupting restarts Python and clears all variables. Continue?",
    )
  )
    return;
  await interruptKernel("human");
}
{
  const ib = document.getElementById("btnInterrupt");
  if (ib) ib.addEventListener("click", interruptFromHuman);
}
$("#btnClear").addEventListener("click", clearOutputs);
$("#btnHelp").addEventListener("click", openHelp);
$("#helpX").addEventListener("click", closeHelp);
$("#helpScrim").addEventListener("mousedown", (e) => {
  if (e.target === $("#helpScrim")) closeHelp();
});
document.querySelectorAll(".add-btn").forEach((btn) => {
  btn.addEventListener("click", () => insertCell(cells.length, btn.dataset.add, true));
});

$("#fileIpynb").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    if (/\.zip$/i.test(f.name)) {
      await importWorkspaceZip(f);
    } else {
      if (agRunning || busy) throw new Error("finish or stop the current run first");
      await saveActiveThreadNow();
      await saveWorkspaceState();
      fromIpynb(JSON.parse(await f.text()));
      await saveWorkspaceState();
      toast("Opened " + f.name);
    }
  } catch (err) {
    toast("Could not open notebook · " + String(err && err.message ? err.message : err), "err");
  }
  e.target.value = "";
});
