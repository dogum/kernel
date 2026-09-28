/* ── forking ── */
async function agFork(turn, checkpoint) {
  if (agRunning) {
    toast("Wait for the current turn to finish.", "err");
    return;
  }
  if (checkpoint) {
    await restoreCheckpoint(checkpoint, true);
    return;
  }
  if (!turn || turn < 1) return;
  toast("This older turn predates exact checkpoints; forking its chat with the latest saved notebook state.");
  /* conversation: cut agMsgs before the turn-th plain user message */
  let seen = 0,
    cut = agMsgs.length;
  for (let i = 0; i < agMsgs.length; i++) {
    const m = agMsgs[i];
    if (m.role === "user" && Array.isArray(m.content) && !m.content.some((b) => b.type === "tool_result")) {
      seen++;
      if (seen === turn) {
        cut = i;
        break;
      }
    }
  }
  const forkMsgs = clonePlain(agMsgs.slice(0, cut));
  /* transcript: keep entries before the turn-th 'u' row */
  const ents = txEntries();
  let u = 0;
  const keep = [];
  for (const e of ents) {
    if (e.k === "u") {
      u++;
      if (u === turn) break;
    }
    keep.push(e);
  }
  /* duplicate the notebook and switch */
  const srcName = nbName;
  await saveActiveThreadNow();
  const newId = await duplicateNotebook(nbId);
  const lib = readLib();
  const ent = lib.notebooks.find((n) => n.id === newId);
  if (!ent) {
    toast("Fork failed.", "err");
    return;
  }
  ent.name = srcName + " ⑂";
  ent.updated = Date.now();
  writeLib(lib);
  try {
    const d = loadCellsFor(ent.id) || { cells: [] };
    d.name = ent.name;
    localStorage.setItem(nbKey(ent.id), JSON.stringify(d));
  } catch (e) {}
  const idx = readThreadIndex(newId),
    meta = idx.threads.find((t) => t.id === agThreadId) || idx.threads[0];
  if (meta) {
    idx.active = meta.id;
    meta.name = (meta.name || "Thread") + " · fork";
    writeThreadIndex(idx, newId);
    await kdbPut("threads", {
      key: threadKey(meta.id, newId),
      notebookId: newId,
      id: meta.id,
      name: meta.name,
      created: meta.created,
      updated: Date.now(),
      messages: forkMsgs,
      transcript: keep,
      usage: agUsage(),
      provider: agProvider,
      model: agModel,
    });
  }
  await switchNotebook(ent.id);
  toast('Forked — you are now on "' + ent.name + '". The original thread is untouched.');
}

function agFixCell(cell, o) {
  ui.agent = true;
  applyUI();
  saveUI();
  const lines = String((o && o.text) || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    last = (lines[lines.length - 1] || "").slice(0, 220),
    inp = $("#agIn");
  inp.value =
    "Fix the error in cell " +
    (indexOf(cell) + 1) +
    " (cell_id: " +
    cell.id +
    ")" +
    (last ? " — " + last : "") +
    ". Rerun it once it is fixed.";
  inp.focus();
  try {
    inp.setSelectionRange(inp.value.length, inp.value.length);
  } catch (e) {}
  if (!agKey) toast("Add an API key in agent settings to send this.", "err");
}
function agAskAboutCell(cell) {
  ui.agent = true;
  applyUI();
  saveUI();
  const i = indexOf(cell) + 1;
  const inp = $("#agIn");
  inp.value = "About cell [" + i + "] (cell_id: " + cell.id + "): ";
  inp.focus();
  try {
    inp.setSelectionRange(inp.value.length, inp.value.length);
  } catch (e) {}
}
