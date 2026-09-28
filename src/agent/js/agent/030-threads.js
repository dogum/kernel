/* ── full-fidelity per-notebook threads ── */
function threadIndexKey(id) {
  return "kernel.agent.threadindex." + (id || nbId || "anon");
}
function threadKey(id, notebook) {
  return (notebook || nbId) + ":" + id;
}
function readThreadIndex(id) {
  try {
    const x = JSON.parse(localStorage.getItem(threadIndexKey(id)) || "null");
    if (x && Array.isArray(x.threads)) {
      x.v = 3;
      return x;
    }
  } catch (e) {}
  return { v: 3, active: null, threads: [] };
}
function writeThreadIndex(idx, id) {
  try {
    localStorage.setItem(threadIndexKey(id), JSON.stringify(idx));
  } catch (e) {}
}
function newThreadMeta(name) {
  const id = "t_" + uid(),
    now = Date.now();
  return { id, name: name || "Thread", created: now, updated: now };
}
async function ensureThreadIndex(id) {
  let idx = readThreadIndex(id);
  if (!idx.threads.length) {
    const meta = newThreadMeta("Main thread");
    idx = { v: 3, active: meta.id, threads: [meta] };
    writeThreadIndex(idx, id);
    let msgs = [],
      transcript = [],
      usage = {};
    try {
      msgs = JSON.parse(localStorage.getItem("kernel.agent.msgs." + id) || "[]");
    } catch (e) {}
    try {
      transcript = JSON.parse(localStorage.getItem("kernel.agent.tx." + id) || "[]");
    } catch (e) {}
    try {
      usage = JSON.parse(localStorage.getItem("kernel.agent.usage." + id) || "{}");
    } catch (e) {}
    await kdbPut("threads", {
      key: threadKey(meta.id, id),
      notebookId: id,
      id: meta.id,
      name: meta.name,
      created: meta.created,
      updated: meta.updated,
      messages: Array.isArray(msgs) ? msgs : [],
      transcript: Array.isArray(transcript) ? transcript : [],
      usage,
      plan: [],
      comparisons: [],
      contextPolicies: { cells: {}, artifacts: {} },
    });
  }
  if (!idx.active || !idx.threads.some((t) => t.id === idx.active)) {
    idx.active = idx.threads[0].id;
    writeThreadIndex(idx, id);
  }
  return idx;
}
function renderThreadSelect() {
  const sel = $("#agThreadSelect"),
    idx = readThreadIndex(nbId);
  if (!sel) return;
  sel.replaceChildren(
    ...idx.threads.map((t) => {
      const o = document.createElement("option");
      o.value = t.id;
      o.textContent = t.name;
      o.selected = t.id === agThreadId;
      return o;
    }),
  );
}
function txEntries() {
  const out = [];
  $("#agTx")
    .querySelectorAll("[data-k]")
    .forEach((el) => {
      const k = el.dataset.k;
      if (k === "w" || el.dataset.ephemeral === "1") return;
      const x = {
        k,
        t: k === "c" ? el.innerHTML : el.dataset.raw != null ? el.dataset.raw : k === "img" ? el.src : el.textContent,
      };
      if (el.dataset.checkpoint) x.checkpoint = el.dataset.checkpoint;
      if (el.dataset.run) x.run = el.dataset.run;
      out.push(x);
    });
  return out;
}
async function saveActiveThreadNow() {
  if (agLoadingThread || !agThreadId || !agTxNb) return;
  clearTimeout(agThreadTimer);
  const idx = readThreadIndex(agTxNb),
    meta = idx.threads.find((t) => t.id === agThreadId);
  if (!meta) return;
  meta.updated = Date.now();
  writeThreadIndex(idx, agTxNb);
  await kdbPut("threads", {
    key: threadKey(agThreadId, agTxNb),
    notebookId: agTxNb,
    id: agThreadId,
    name: meta.name,
    created: meta.created,
    updated: meta.updated,
    messages: clonePlain(agMsgs),
    transcript: txEntries(),
    usage: agUsage(),
    provider: agProvider,
    model: agModel,
    plan: clonePlain(agPlan),
    comparisons: clonePlain(agComparisons),
    contextPolicies: clonePlain(agContextPolicies),
    activeRunId: (agRun && agRun.id) || null,
  });
}
function scheduleThreadSave() {
  if (agLoadingThread) return;
  clearTimeout(agThreadTimer);
  agThreadTimer = setTimeout(() => saveActiveThreadNow(), 650);
}
function agSaveMsgs() {
  scheduleThreadSave();
}
function txPersist() {
  scheduleThreadSave();
}
function agStripMsgs(msgs) {
  return clonePlain(msgs || []);
}
async function activateNotebookAgent(id) {
  if (!id) return;
  agLoadingThread = true;
  try {
    const idx = await ensureThreadIndex(id);
    agTxNb = id;
    agThreadId = idx.active;
    let rec = await kdbGet("threads", threadKey(agThreadId, id));
    if (!rec) {
      const m = idx.threads.find((t) => t.id === agThreadId);
      rec = { messages: [], transcript: [], usage: {}, name: m && m.name };
    }
    if (rec.provider && AG_PROVIDER_DEFS[rec.provider]) {
      agApplyProvider(rec.provider);
      if (rec.model) agModel = rec.model;
    }
    agMsgs = Array.isArray(rec.messages) ? rec.messages : [];
    agPlan = Array.isArray(rec.plan) ? rec.plan : [];
    agComparisons = Array.isArray(rec.comparisons) ? rec.comparisons : [];
    agContextPolicies =
      rec.contextPolicies && typeof rec.contextPolicies === "object"
        ? rec.contextPolicies
        : { cells: {}, artifacts: {} };
    agContextPolicies.cells = agContextPolicies.cells || {};
    agContextPolicies.artifacts = agContextPolicies.artifacts || {};
    agLoadUsage(rec.usage);
    txLoad(rec.transcript || []);
    renderThreadSelect();
    for (const c of cells) updateCellContextButton(c);
    agLastContext = null;
    agStateUi();
    meterUi();
    agFetchModelInfo();
  } finally {
    agLoadingThread = false;
  }
  await loadRunForThread();
  await saveActiveThreadNow();
  renderRunControl();
}
async function switchAgentThread(id) {
  if (agRunning || id === agThreadId) return;
  await saveActiveThreadNow();
  const idx = readThreadIndex(nbId);
  if (!idx.threads.some((t) => t.id === id)) return;
  idx.active = id;
  writeThreadIndex(idx, nbId);
  await activateNotebookAgent(nbId);
}
async function createAgentThread() {
  if (agRunning) return;
  await saveActiveThreadNow();
  const idx = await ensureThreadIndex(nbId),
    m = newThreadMeta("Thread " + (idx.threads.length + 1));
  idx.threads.push(m);
  idx.active = m.id;
  writeThreadIndex(idx, nbId);
  await kdbPut("threads", {
    key: threadKey(m.id),
    notebookId: nbId,
    id: m.id,
    name: m.name,
    created: m.created,
    updated: m.updated,
    messages: [],
    transcript: [],
    usage: {},
    plan: [],
    comparisons: [],
    contextPolicies: { cells: {}, artifacts: {} },
  });
  await activateNotebookAgent(nbId);
  $("#agIn").focus();
}
async function renameAgentThread() {
  const idx = readThreadIndex(nbId),
    m = idx.threads.find((t) => t.id === agThreadId);
  if (!m) return;
  const name = await appPrompt("Rename chat thread", m.name, "Rename");
  if (name == null) return;
  m.name = name.trim().slice(0, 80) || "Thread";
  m.updated = Date.now();
  writeThreadIndex(idx, nbId);
  renderThreadSelect();
  await saveActiveThreadNow();
}
async function deleteAgentThread() {
  if (agRunning) return;
  let idx = readThreadIndex(nbId);
  if (idx.threads.length === 1) {
    toast("Keep at least one thread.", "err");
    return;
  }
  const m = idx.threads.find((t) => t.id === agThreadId);
  if (!m || !confirm('Delete thread "' + m.name + '" and its run/checkpoint history?')) return;
  const [runs, checkpoints] = await Promise.all([kdbRuns(nbId, m.id), kdbCheckpoints(nbId, m.id)]);
  await kdbDelete("threads", threadKey(m.id));
  for (const r of runs) await kdbDelete("runs", r.id);
  for (const cp of checkpoints) await kdbDelete("checkpoints", cp.id);
  scheduleBlobGc();
  idx.threads = idx.threads.filter((t) => t.id !== m.id);
  idx.active = idx.threads[0].id;
  writeThreadIndex(idx, nbId);
  await activateNotebookAgent(nbId);
}
function agExportBundle() {
  const tx = txEntries();
  if (!tx.length && !agMsgs.length) return null;
  return {
    v: 3,
    saved: new Date().toISOString(),
    notebook: nbName,
    thread: { id: agThreadId, name: (readThreadIndex(nbId).threads.find((t) => t.id === agThreadId) || {}).name },
    transcript: tx,
    messages: clonePlain(agMsgs),
    usage: agUsage(),
    plan: clonePlain(agPlan),
    comparisons: clonePlain(agComparisons),
    contextPolicies: clonePlain(agContextPolicies),
  };
}
function agImportMeta(meta) {
  if (!meta || typeof meta !== "object") return;
  queueMicrotask(async () => {
    const idx = await ensureThreadIndex(nbId),
      m = newThreadMeta((meta.thread && meta.thread.name) || "Imported thread");
    idx.threads.push(m);
    idx.active = m.id;
    writeThreadIndex(idx, nbId);
    await kdbPut("threads", {
      key: threadKey(m.id),
      notebookId: nbId,
      id: m.id,
      name: m.name,
      created: m.created,
      updated: m.updated,
      messages: clonePlain(meta.messages || []),
      transcript: clonePlain(meta.transcript || []),
      usage: clonePlain(meta.usage || {}),
      plan: clonePlain(meta.plan || []),
      comparisons: clonePlain(meta.comparisons || []),
      contextPolicies: clonePlain(meta.contextPolicies || { cells: {}, artifacts: {} }),
    });
    await activateNotebookAgent(nbId);
    txDom("s", "conversation restored from notebook", true);
  });
}
function agSlug() {
  return (
    (nbName || "kernel-notebook")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "kernel-notebook"
  );
}
function agExportMd() {
  const e = txEntries();
  if (!e.length) {
    toast("Nothing to export yet.");
    return;
  }
  let md = "# KERNEL·A conversation — " + nbName + "\n\n_" + new Date().toISOString() + "_\n\n";
  const tmp = document.createElement("div");
  for (const x of e) {
    if (x.k === "u") md += "**You:** " + x.t + "\n\n";
    else if (x.k === "a") md += x.t + "\n\n";
    else if (x.k === "r") md += "> Reasoning summary: " + x.t + "\n\n";
    else if (x.k === "p") md += "> " + x.t + "\n\n";
    else if (x.k === "c") {
      tmp.innerHTML = x.t;
      md += "`" + tmp.textContent.trim() + "`\n\n";
    } else if (x.k === "e") md += "> ERROR: " + x.t + "\n\n";
  }
  downloadBlob(new Blob([md], { type: "text/markdown" }), agSlug() + "-conversation.md");
  toast("Conversation exported.");
}
function closeLiveFence(text) {
  const n = (String(text).match(/```/g) || []).length;
  return n % 2 ? text + "\n```" : text;
}
function renderAgentMarkdown(el, text, live) {
  el.dataset.raw = text;
  if (live) {
    el._agPending = text;
    if (!el._agFrame)
      el._agFrame = requestAnimationFrame(() => {
        el._agFrame = null;
        el.innerHTML = renderMarkdown(closeLiveFence(el._agPending || ""));
      });
    return;
  }
  if (el._agFrame) {
    cancelAnimationFrame(el._agFrame);
    el._agFrame = null;
  }
  el.innerHTML = renderMarkdown(text);
  typesetMarkdown(el);
}
function txLoad(arr) {
  agTurnSeq = 0;
  $("#agTx").replaceChildren();
  if (arr && arr.length) {
    arr.forEach((e) => txDom(e.k, e.t, true, e));
    txDom("s", "earlier session", true, { ephemeral: true });
  } else {
    txDom("s", "new conversation", true, { ephemeral: true });
    txDom(
      "a",
      "I write, run, and read notebook cells with you. Choose a provider, mount data with + Data, then describe an analysis — or ask what I can do.",
      true,
    );
  }
}
function fillTranscriptChips(el, content) {
  const t = document.createElement("template");
  t.innerHTML = String(content || "");
  const found = [...t.content.querySelectorAll(".ag-chip")],
    rows = found.length ? found : [t.content];
  for (const row of rows) {
    const span = document.createElement("span"),
      classes = row.classList || { contains: () => false };
    span.className = "ag-chip" + (classes.contains("err") ? " err" : "") + (classes.contains("run") ? " run" : "");
    span.textContent = row.textContent || "";
    const cell = row.getAttribute && row.getAttribute("data-cell");
    if (cell && /^[A-Za-z0-9_.:-]{1,200}$/.test(cell)) {
      span.classList.add("click");
      span.dataset.cell = cell;
    }
    el.appendChild(span);
  }
}
function txDom(kind, content, restoring, meta) {
  const tx = $("#agTx");
  let el;
  if (kind === "u") {
    el = document.createElement("div");
    el.className = "ag-u";
    el.textContent = content;
    el.dataset.raw = content;
    el.dataset.turn = String(++agTurnSeq);
    const fk = document.createElement("button");
    fk.className = "ag-fork";
    fk.textContent = "⑂";
    fk.title = "Fork from here — duplicate the notebook and rewind this thread";
    el.appendChild(fk);
  } else if (kind === "a") {
    el = document.createElement("div");
    el.className = "ag-a";
    renderAgentMarkdown(el, content, false);
  } else if (kind === "r") {
    el = document.createElement("details");
    el.className = "ag-reason";
    const s = document.createElement("summary");
    s.textContent = "Reasoning summary";
    const b = document.createElement("div");
    b.className = "ag-reason-body";
    renderAgentMarkdown(b, content, false);
    el.dataset.raw = content;
    el.append(s, b);
  } else if (kind === "c") {
    const last = tx.lastElementChild;
    if (
      !restoring &&
      last &&
      last.dataset.k === "c" &&
      last.classList.contains("ag-chips") &&
      !last.dataset.ephemeral
    ) {
      fillTranscriptChips(last, content);
      tx.scrollTop = tx.scrollHeight;
      txPersist();
      return last;
    }
    el = document.createElement("div");
    el.className = "ag-chips";
    fillTranscriptChips(el, content);
  } else if (kind === "e") {
    el = document.createElement("div");
    el.className = "ag-chips";
    el.dataset.raw = content;
    el.innerHTML = '<span class="ag-chip err">' + agEsc(content) + "</span>";
  } else if (kind === "p") {
    el = document.createElement("div");
    el.className = "ag-progress";
    el.textContent = content;
    el.dataset.raw = content;
  } else if (kind === "w") {
    el = document.createElement("div");
    el.className = "ag-working";
    el.innerHTML = '<span class="dotp"></span>' + agEsc(content);
  } else if (kind === "img") {
    el = document.createElement("img");
    el.className = "ag-img";
    const src = String(content || "");
    if (/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(src)) el.src = src;
    else {
      el.alt = "Stored image omitted: unsupported source";
      el.classList.add("blocked");
    }
    el.dataset.raw = el.src || "";
  } else {
    el = document.createElement("div");
    el.className = "ag-sys";
    el.textContent = "— " + content + " —";
  }
  meta = meta || {};
  el.dataset.k = kind;
  if (meta.checkpoint) el.dataset.checkpoint = meta.checkpoint;
  if (meta.run) el.dataset.run = meta.run;
  if (meta.ephemeral) el.dataset.ephemeral = "1";
  tx.appendChild(el);
  tx.scrollTop = tx.scrollHeight;
  if (!restoring) txPersist();
  return el;
}
function chip(label, cls, cellId) {
  return (
    '<span class="ag-chip ' +
    (cls || "") +
    (cellId ? " click" : "") +
    (cellId ? '" data-cell="' + cellId : "") +
    '">' +
    agEsc(label) +
    "</span>"
  );
}
$("#agTx").addEventListener("click", (e) => {
  const f = e.target.closest(".ag-fork");
  if (f) {
    agFork(parseInt(f.parentElement.dataset.turn, 10), f.parentElement.dataset.checkpoint);
    return;
  }
  const c = e.target.closest("[data-cell]");
  if (c) {
    const cell = findCell(c.dataset.cell);
    if (cell && cell.el) {
      selectCell(cell.id, "command");
      cell.el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }
});
