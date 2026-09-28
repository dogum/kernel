/* ===== variable inspector ===== */
let lastVarRows = [];
/* Open details stay open when the inspector refreshes after a run, so exploring a variable is a sequence of clicks. */
const openVarDetails = new Set();
function renderInspector(rows) {
  rows = Array.isArray(rows) ? rows : [];
  lastVarRows = rows;
  lastVars = rows.map((r) => r.name);
  paintInspector();
}
function paintInspector() {
  const host = $("#varsList"),
    count = $("#varsCount");
  if (!host) return;
  const q = (($("#varsFilter") && $("#varsFilter").value) || "").trim().toLowerCase();
  const sort = ($("#varsSort") && $("#varsSort").value) || "name";
  const rows = (
    q ? lastVarRows.filter((r) => r.name.toLowerCase().includes(q) || r.type.toLowerCase().includes(q)) : lastVarRows
  ).slice();
  rows.sort(
    sort === "memory"
      ? (a, b) => (b.bytes || 0) - (a.bytes || 0) || a.name.localeCompare(b.name)
      : sort === "type"
        ? (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name)
        : (a, b) => a.name.localeCompare(b.name),
  );
  host.innerHTML = "";
  if (!lastVarRows.length) {
    const e = document.createElement("div");
    e.className = "var-empty";
    e.textContent = "No variables yet — run a cell that assigns something.";
    host.appendChild(e);
  } else if (!rows.length) {
    const e = document.createElement("div");
    e.className = "var-empty";
    e.textContent = "No variables match that filter.";
    host.appendChild(e);
  } else {
    const frag = document.createDocumentFragment();
    for (const r of rows) {
      const item = document.createElement("div");
      item.className = "var-item";
      const row = document.createElement("div");
      row.className = "var-row";
      row.title = "Click for detail";
      const nm = document.createElement("span");
      nm.className = "var-name";
      nm.textContent = r.name;
      const tp = document.createElement("span");
      tp.className = "var-type";
      tp.textContent = r.type;
      const inf = document.createElement("span");
      inf.className = "var-info";
      inf.textContent = r.info || "";
      row.appendChild(nm);
      row.appendChild(tp);
      row.appendChild(inf);
      if (r.size) {
        const sz = document.createElement("span");
        sz.className = "var-size";
        sz.textContent = r.size;
        row.appendChild(sz);
      }
      const ins = document.createElement("button");
      ins.className = "var-ins";
      ins.textContent = "↳";
      ins.title = "Insert " + r.name;
      ins.addEventListener("click", (ev) => {
        ev.stopPropagation();
        insertVarName(r.name);
      });
      const del = document.createElement("button");
      del.className = "var-del";
      del.textContent = "×";
      del.title = "Delete " + r.name;
      del.addEventListener("click", (ev) => {
        ev.stopPropagation();
        delVar(r.name);
      });
      row.appendChild(ins);
      row.appendChild(del);
      const det = document.createElement("div");
      det.className = "var-detail";
      row.addEventListener("click", () => toggleVarDetail(r.name, item, det));
      item.appendChild(row);
      item.appendChild(det);
      frag.appendChild(item);
      if (openVarDetails.has(r.name)) toggleVarDetail(r.name, item, det);
    }
    host.appendChild(frag);
  }
  if (count)
    count.textContent =
      lastVarRows.length + (lastVarRows.length === 1 ? " name" : " names") + (q ? " · " + rows.length + " shown" : "");
}
async function toggleVarDetail(name, item, det) {
  if (item.classList.contains("open")) {
    item.classList.remove("open");
    openVarDetails.delete(name);
    return;
  }
  item.classList.add("open");
  openVarDetails.add(name);
  if (det.dataset.loaded) return;
  if (!kernelReady) {
    det.innerHTML = '<div class="var-loading">kernel not ready</div>';
    return;
  }
  det.innerHTML = '<div class="var-loading">loading detail…</div>';
  try {
    const raw = await runPy("_var_detail(__det_name)", { __det_name: name });
    renderVarDetail(det, JSON.parse(raw));
    det.dataset.loaded = "1";
  } catch (e) {
    det.innerHTML = '<div class="var-loading">detail unavailable</div>';
  }
}
function statList(lines) {
  const w = document.createElement("div");
  w.className = "statlist";
  (lines || []).forEach(([k, v]) => {
    const r = document.createElement("div");
    r.className = "stat";
    const a = document.createElement("span");
    a.className = "sk";
    a.textContent = k;
    const b = document.createElement("span");
    b.className = "sv";
    b.textContent = v;
    r.appendChild(a);
    r.appendChild(b);
    w.appendChild(r);
  });
  return w;
}
function chipWrap(items, more) {
  const w = document.createElement("div");
  w.className = "vd-chips";
  (items || []).forEach((x) => {
    const c = document.createElement("span");
    c.className = "vd-chip";
    c.textContent = x;
    w.appendChild(c);
  });
  if (more) {
    const m = document.createElement("span");
    m.className = "vd-chip";
    m.textContent = "+" + more;
    w.appendChild(m);
  }
  return w;
}
function headTable(cols, rows) {
  const t = document.createElement("table");
  t.className = "vd-table";
  const thead = document.createElement("thead");
  const htr = document.createElement("tr");
  (cols || []).forEach((c) => {
    const th = document.createElement("th");
    th.textContent = c;
    htr.appendChild(th);
  });
  thead.appendChild(htr);
  t.appendChild(thead);
  const tb = document.createElement("tbody");
  (rows || []).forEach((r) => {
    const tr = document.createElement("tr");
    r.forEach((v) => {
      const td = document.createElement("td");
      td.textContent = v;
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  return t;
}
function renderVarDetail(d, det) {
  d.innerHTML = "";
  if (det.kind === "dataframe") {
    const sh = document.createElement("div");
    sh.className = "vd-shape";
    sh.textContent = (det.shape ? det.shape[0] + " × " + det.shape[1] + " " : "") + "DataFrame";
    d.appendChild(sh);
    if (det.dtypes && det.dtypes.length) {
      const dl = document.createElement("div");
      dl.className = "vd-dtypes";
      det.dtypes.forEach(([c, t]) => {
        const r = document.createElement("div");
        r.className = "vd-dtype";
        const a = document.createElement("span");
        a.textContent = c;
        const b = document.createElement("span");
        b.className = "vd-dt";
        b.textContent = t;
        r.appendChild(a);
        r.appendChild(b);
        dl.appendChild(r);
      });
      if (det.dtypes_more) {
        const m = document.createElement("div");
        m.className = "vd-more";
        m.textContent = "+" + det.dtypes_more + " more columns";
        dl.appendChild(m);
      }
      d.appendChild(dl);
    }
    if (det.head && det.head.length) {
      d.appendChild(headTable(det.columns, det.head));
    }
  } else if (det.kind === "series" || det.kind === "ndarray") {
    d.appendChild(statList(det.lines));
  } else if (det.kind === "mapping") {
    d.appendChild(statList(det.lines));
    d.appendChild(chipWrap(det.keys, det.keys_more));
  } else if (det.kind === "sequence") {
    d.appendChild(statList(det.lines));
    d.appendChild(chipWrap(det.items, det.items_more));
  } else {
    const pre = document.createElement("pre");
    pre.className = "vd-repr";
    pre.textContent = det.repr || "(no detail)";
    d.appendChild(pre);
  }
  const acts = exploreActions(det);
  if (acts) d.appendChild(acts);
}
function insertVarName(name) {
  const cell = selectedId ? findCell(selectedId) : null;
  if (cell && cell.type === "code" && cell.taEl) {
    const ta = cell.taEl,
      s = ta.selectionStart,
      e = ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + name + ta.value.slice(e);
    ta.selectionStart = ta.selectionEnd = s + name.length;
    cell.source = ta.value;
    paint(cell);
    ta.focus();
    schedulePersist();
  } else {
    try {
      navigator.clipboard.writeText(name);
    } catch (_) {}
    toast("Copied " + name);
  }
}
async function delVar(name) {
  if (!kernelReady) {
    toast("Python is still starting — one moment.", "err");
    return;
  }
  if (busy) {
    toast("Wait for the running cell to finish.", "err");
    return;
  }
  try {
    await runPy("_del_var(__del_name)", { __del_name: name });
  } catch (_) {
    toast("Could not delete " + name, "err");
    return;
  }
  const gen = kernelGeneration;
  refreshInspector();
  toast("Deleted " + name, null, { action: { label: "Undo", run: () => undoDelVar(name, gen) } });
}
async function undoDelVar(name, gen) {
  if (gen !== kernelGeneration || !kernelReady) {
    toast("Python restarted since then, so " + name + " is gone.", "err");
    return;
  }
  if (busy) {
    toast("Wait for the running cell to finish.", "err");
    return;
  }
  let r = "gone";
  try {
    r = await runPy("_undel_var(__del_name)", { __del_name: name });
  } catch (_) {}
  if (r === "ok") toast("Restored " + name);
  else if (r === "exists") toast(name + " was defined again, so it was left as is.");
  else toast("Could not restore " + name, "err");
  refreshInspector();
}
/* One-click exploration from the inspector: add a code cell after the selected cell (or at the end) and run it. */
async function exploreWith(code) {
  if (!kernelReady) {
    toast("Python is still starting — one moment.", "err");
    return;
  }
  if (busy) {
    toast("Wait for the running cell to finish.", "err");
    return;
  }
  const sel = selectedId ? findCell(selectedId) : null;
  const c = insertCell(sel ? indexOf(sel) + 1 : cells.length, "code", false);
  c.source = code;
  if (c.taEl) c.taEl.value = code;
  paint(c);
  recomputeDependencies();
  renderWelcome();
  schedulePersist();
  scheduleWorkspacePersist();
  if (c.el) c.el.scrollIntoView({ block: "center", behavior: "smooth" });
  await runCell(c);
}
function exploreActions(det) {
  const n = det && det.name;
  if (!n || !/^[A-Za-z_]\w*$/.test(n)) return null;
  const acts =
    det.kind === "dataframe"
      ? [
          ["head", n + ".head(10)"],
          ["describe", n + '.describe(include="all").T'],
          ["missing values", n + ".isna().sum().sort_values(ascending=False)"],
          ["correlations", n + ".corr(numeric_only=True).round(2)"],
        ]
      : det.kind === "series"
        ? [
            ["describe", n + ".describe()"],
            ["value counts", n + ".value_counts().head(20)"],
            ["histogram", n + '.plot.hist(bins=30, title="' + n + '")'],
          ]
        : null;
  if (!acts) return null;
  const w = document.createElement("div");
  w.className = "vd-acts";
  for (const [label, code] of acts) {
    const b = document.createElement("button");
    b.className = "vd-act";
    b.textContent = label;
    b.title = "Add and run: " + code;
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      exploreWith(code);
    });
    w.appendChild(b);
  }
  return w;
}
function toggleInspector() {
  toggleRight();
}
function closeInspector() {
  toggleRight(false);
}
