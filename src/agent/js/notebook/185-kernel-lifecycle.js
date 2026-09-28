/* ===== kernel lifecycle: boot, extras, restart, clear outputs ===== */
/* Startup restores the open notebook's saved files only after Python boots; until then dataFiles is empty even for a
   notebook that has files. startupRestored says the restore happened, startupSettled that boot finished either way.
   startupAgent is init's activation of the notebook's agent, which loads its saved run; boot waits for it too. */
let startupSettled = false,
  startupRestored = false,
  startupAgent = null;
async function bootKernel() {
  setStatus("Loading Pyodide…", "boot");
  progressOn();
  $("#kernelInfo").textContent = "Pyodide · downloading runtime (~10 MB, cached after)";
  try {
    let mode = "worker";
    try {
      if (localStorage.getItem("kernel.runtime") === "inline") mode = "inline";
    } catch (e) {}
    let info;
    try {
      info = await kwBoot(mode);
    } catch (err) {
      if (kw.mode !== "worker") throw err;
      console.warn("Python worker failed to boot; using the page thread", err);
      try {
        kw.worker.terminate();
      } catch (e) {}
      info = await kwBoot("inline");
    }
    const ver = info.version;
    kernelReady = true;
    setStatus("Ready", "ok");
    $("#kernelInfo").textContent = "Python " + ver + " · Pyodide 0.29.4" + kernelModeLabel();
    await restoreWorkspaceState(nbId);
    startupRestored = true;
    await captureEnvironment();
    refreshNotebookFreshness();
    // a paused run has to be known before startup counts as settled, or the notebook can look free when it isn't
    if (startupAgent) await startupAgent.catch((e) => console.warn("Agent activation failed at startup", e));
    if (agTxNb !== nbId) await activateNotebookAgent(nbId);
    scheduleBlobGc(20000);
    toast("Kernel ready · Python " + ver);
    loadExtras();
  } catch (err) {
    kernelReady = false;
    setStatus("Kernel failed", "err");
    $("#kernelInfo").textContent = "Pyodide failed to load";
    toast(
      "Could not load Pyodide. Check your internet connection, then reload. · " +
        String(err && err.message ? err.message : err),
      "err",
    );
    console.error(err);
  } finally {
    startupSettled = true;
    progressOff();
  }
}
async function loadExtras() {
  // background, lock-serialized so it never collides with a user run
  try {
    await ensureMicropip();
  } catch (e) {
    console.warn("micropip unavailable", e);
  }
  try {
    await runPy("import micropip\nawait micropip.install(list(__jedi_pkgs))\nimport jedi", { __jedi_pkgs: ["jedi"] });
    jediReady = true;
    if (kernelInfoHasVer()) $("#kernelInfo").textContent += " · autocomplete ready";
  } catch (e) {
    jediReady = false;
    console.warn("jedi unavailable; autocomplete uses a basic fallback", e);
  }
}
function kernelInfoHasVer() {
  return /Python/.test($("#kernelInfo").textContent || "");
}
async function restartKernel() {
  if (notebookSwitching) {
    toast("Wait for the notebook switch to finish.", "err");
    return;
  }
  if (!kernelReady) {
    if (!kw.worker && kw.mode === "worker") {
      await restartKernelHard("restart");
      return;
    }
    toast("Kernel not ready.", "err");
    return;
  }
  if (busy) {
    if (kw.mode === "worker" && confirm("Stop the running cell and restart Python? All variables will be cleared."))
      await interruptKernel("restart", true);
    else if (kw.mode !== "worker") toast("Wait for the current run to finish.", "err");
    return;
  }
  cmp.hide();
  busy = true;
  setStatus("Restarting…", "busy");
  try {
    await runPy("_kernel_reset()");
    kernelGeneration++;
    execCounter = 0;
    for (const cell of cells) {
      cell.execCount = null;
      cell.runtime = null;
      if (cell.timeEl) cell.timeEl.textContent = "";
      refreshExec(cell);
    }
    toast("Kernel restarted · variables cleared");
  } catch (err) {
    toast("Restart failed.", "err");
    console.error(err);
  } finally {
    try {
      await refreshInspector();
    } catch (_) {}
    busy = false;
    setStatus("Ready", "ok");
  }
}
function clearOutputs() {
  const snap = cells
      .filter((c) => (c.outputs && c.outputs.length) || c.execCount != null)
      .map((c) => ({
        id: c.id,
        outputs: c.outputs,
        execCount: c.execCount,
        runtime: c.runtime,
        provenance: c.provenance,
      })),
    home = nbId;
  for (const cell of cells) {
    cell.outputs = [];
    cell.execCount = null;
    cell.runtime = null;
    cell.provenance = null;
    if (cell.timeEl) cell.timeEl.textContent = "";
    renderOutputs(cell);
    refreshExec(cell);
  }
  if (ui.splitOutputs) layoutOutputs();
  schedulePersist();
  scheduleWorkspacePersist();
  if (!snap.length) {
    toast("No outputs to clear");
    return;
  }
  toast("Outputs cleared", null, {
    action: {
      label: "Undo",
      run: () => {
        if (home !== nbId) return;
        for (const s of snap) {
          const c = findCell(s.id);
          if (!c || (c.outputs && c.outputs.length) || c.execCount != null) continue;
          Object.assign(c, {
            outputs: s.outputs,
            execCount: s.execCount,
            runtime: s.runtime,
            provenance: s.provenance,
          });
          if (c.timeEl) c.timeEl.textContent = c.runtime != null ? fmtDur(c.runtime) : "";
          renderOutputs(c);
          refreshExec(c);
        }
        if (ui.splitOutputs) layoutOutputs();
        refreshNotebookFreshness();
        schedulePersist();
        scheduleWorkspacePersist();
        toast("Outputs restored");
      },
    },
  });
}
/* newNotebook lives in the notebook-library section below */
