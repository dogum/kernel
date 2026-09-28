/* ===== example links: ?example=<name> opens a curated agent run from the repository ===== */
/* Only names of folders in examples/ are accepted, the notebook is fetched from this repository, and nothing runs:
   the outputs on screen are the ones the original run produced. A notebook that already has work in it is kept;
   the example opens in a new notebook. */
const EXAMPLE_BASE = "https://raw.githubusercontent.com/dogum/kernel/main/examples/";

function isBlankNotebook() {
  return (
    !dataFiles.length &&
    cells.every((c) => !String((c.taEl ? c.taEl.value : c.source) || "").trim() && !(c.outputs || []).length)
  );
}

async function openExample(name) {
  if (!/^[a-z0-9-]{1,64}$/.test(String(name || ""))) {
    toast("That example link isn't valid.", "err");
    return;
  }
  const closeToast = toast("Opening the " + name + " example…");
  progressOn();
  try {
    const res = await fetch(EXAMPLE_BASE + name + "/result.ipynb", { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status === 404 ? "there is no example called " + name : "HTTP " + res.status);
    const notebook = await res.json();
    if (!isBlankNotebook()) {
      // switching notebooks resets Python, so wait for boot (or a running cell) to finish first
      for (let waited = 0; busy && waited < 180000; waited += 250) await new Promise((r) => setTimeout(r, 250));
      await newNotebook();
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
