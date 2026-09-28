/* ===== example links: ?example=<name> opens a curated agent run from the repository ===== */
/* Only names of folders in examples/ are accepted, the notebook is fetched from this repository, and nothing runs:
   the outputs on screen are the ones the original run produced. A notebook that already has work in it is kept;
   the example opens in a new notebook. */
const EXAMPLE_BASE = "https://raw.githubusercontent.com/dogum/kernel/main/examples/";
// Examples whose runs read public data this repository doesn't include. Each has a SOURCE.md saying where to get it.
const EXAMPLES_NEEDING_DATA = ["fleet-dna"];
let exampleWaitMs = 180000; // how long to wait for boot, a restart or a running cell before giving up

function isBlankNotebook() {
  return (
    !dataFiles.length &&
    cells.every((c) => !String((c.taEl ? c.taEl.value : c.source) || "").trim() && !(c.outputs || []).length)
  );
}

// Python is running or restarting, a cell is preparing to run, or a notebook switch is still saving and restoring.
function notebookOccupied() {
  return busy || cellStarting || notebookSwitching;
}

// A blank notebook can still hold Python state from cells that ran and were then deleted, so give it a clean runtime,
// as a new notebook gets. The switch lock keeps cells, runs, restarts and switches from starting while Python resets.
async function resetBlankNotebook() {
  notebookSwitching = true;
  try {
    await isolateNotebookRuntime();
    return true;
  } finally {
    notebookSwitching = false;
  }
}

// The agent's history counts as work too. An earlier conversation would be sent as context with the next request
// about the example, and a paused or failed run could be resumed against it.
function hasAgentHistory() {
  return !!(
    agMsgs.length ||
    agPlan.length ||
    agComparisons.length ||
    agRun ||
    readThreadIndex(nbId).threads.length > 1
  );
}

function canReuseNotebook() {
  return isBlankNotebook() && !hasAgentHistory();
}

async function openExample(name) {
  if (!/^[a-z0-9-]{1,64}$/.test(String(name || ""))) {
    toast("That example link isn't valid.", "err");
    return;
  }
  const refuse = () => toast("Finish or stop the current run before opening an example.", "err");
  if (agRunning) {
    refuse();
    return;
  }
  const closeToast = toast("Opening the " + name + " example…");
  progressOn();
  try {
    const res = await fetch(EXAMPLE_BASE + name + "/result.ipynb", { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status === 404 ? "there is no example called " + name : "HTTP " + res.status);
    const notebook = await res.json();
    // Importing while Python boots, restarts or runs a cell would mix the example with that execution, and a run may
    // have started during the download, so wait for the kernel and check again. Until startup, or a notebook switch,
    // has restored the notebook's saved files it can look blank when it isn't, so wait for those too.
    for (let waited = 0; (notebookOccupied() || !startupSettled) && waited < exampleWaitMs; waited += 250)
      await new Promise((r) => setTimeout(r, 250));
    if (!startupRestored) {
      closeToast();
      toast("Python hasn't started, so the example can't open safely. Reload the page and try again.", "err");
      return;
    }
    // Reuse the current notebook only when it and its agent have no work in them; otherwise open a new one.
    const reuse = canReuseNotebook();
    if (
      agRunning ||
      notebookOccupied() ||
      !(await (reuse ? resetBlankNotebook() : newNotebook())) ||
      agRunning ||
      notebookOccupied()
    ) {
      // the last check covers a run or cell that got going during the reset's or switch's awaits
      closeToast();
      refuse();
      return;
    }
    // work added meanwhile to the notebook the example would fill, whether reused or just created, is kept
    if (!canReuseNotebook()) {
      closeToast();
      toast(
        "Something was added to the notebook while the example was opening, so it was kept. Try the example again.",
        "err",
      );
      return;
    }
    fromIpynb(notebook);
    nbName = name;
    setNbTitle();
    persist();
    await saveWorkspaceState();
    if (ui.left) renderLibrary();
    closeToast();
    const opened = "Opened the " + name + " example. The outputs are from the original agent run";
    if (!EXAMPLES_NEEDING_DATA.includes(name)) toast(opened + "; Run all recomputes them.");
    else {
      const sources = "https://github.com/dogum/kernel/blob/main/examples/" + name + "/SOURCE.md";
      const action = { label: "Where to get them", run: () => window.open(sources, "_blank", "noopener") };
      toast(opened + ". Rerunning it needs public data that isn't included; add those files first.", "", { action });
    }
  } catch (err) {
    closeToast();
    toast("Could not open the example · " + String(err && err.message ? err.message : err), "err");
  } finally {
    progressOff();
  }
}

function openLinkedExample() {
  let name = null;
  try {
    name = new URL(location.href).searchParams.get("example");
  } catch (e) {}
  if (!name) return;
  // drop the parameter so a reload doesn't import the example again
  try {
    history.replaceState(null, "", location.pathname + location.hash);
  } catch (e) {}
  openExample(name);
}
