/* ===== example links: ?example=<name> opens a curated agent run from the repository ===== */
/* Only names of folders in examples/ are accepted, the notebook is fetched from this repository, and nothing runs:
   the outputs on screen are the ones the original run produced. A notebook that already has work in it is kept;
   the example opens in a new notebook. */
const EXAMPLE_BASE = "https://raw.githubusercontent.com/dogum/kernel/main/examples/";
let exampleWaitMs = 180000; // how long to wait for boot, a restart or a running cell before giving up

function isBlankNotebook() {
  return (
    !dataFiles.length &&
    cells.every((c) => !String((c.taEl ? c.taEl.value : c.source) || "").trim() && !(c.outputs || []).length)
  );
}

// A paused or failed run can be resumed and would run its pending tools against whatever the notebook then holds.
function hasUnfinishedRun() {
  return !!(agRun && !RUN_TERMINAL.has(agRun.status));
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
    // have started during the download, so wait for the kernel and check again.
    for (let waited = 0; busy && waited < exampleWaitMs; waited += 250) await new Promise((r) => setTimeout(r, 250));
    // Reuse the current notebook only when it is empty and its agent has nothing unfinished; otherwise open a new one.
    const reuse = isBlankNotebook() && !hasUnfinishedRun();
    if (agRunning || busy || (!reuse && !(await newNotebook()))) {
      closeToast();
      refuse();
      return;
    }
    fromIpynb(notebook);
    nbName = name;
    setNbTitle();
    persist();
    await saveWorkspaceState();
    if (ui.left) renderLibrary();
    closeToast();
    toast("Opened the " + name + " example. The outputs are from the original agent run; Run all recomputes them.");
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
