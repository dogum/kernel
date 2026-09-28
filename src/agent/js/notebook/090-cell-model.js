/* ===== cell model, dependency graph, and freshness ===== */
const PY_DEP_WORDS = new Set(
  "False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case print len range int float str list dict set tuple bool bytes type isinstance enumerate zip map filter sorted reversed sum min max abs round open input super object repr format getattr setattr hasattr self cls".split(
    " ",
  ),
);
let dependencyRevision = 0,
  kernelGeneration = 0,
  activeToolContext = null,
  environmentSnapshot = null;
function sourceHash(src) {
  let h = 2166136261;
  for (let i = 0; i < String(src).length; i++) {
    h ^= String(src).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
function analyzeCellSource(src) {
  src = String(src || "");
  const explicit = [];
  src.replace(/^\s*#\s*depends-on\s*:\s*(.+)$/gim, (m, x) => {
    x.split(/[\s,]+/)
      .filter(Boolean)
      .forEach((id) => explicit.push(id));
  });
  let clean = src
    .replace(/'''[\s\S]*?'''|"""[\s\S]*?"""/g, " ")
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, " ")
    .replace(/#.*$/gm, " ");
  const defines = new Set(),
    uses = new Set(),
    imports = new Set(),
    files = new Set();
  let m;
  const defRe =
    /^\s*(?:async\s+def|def|class)\s+([A-Za-z_]\w*)|^\s*(?:from\s+([A-Za-z_]\w*(?:\.\w+)*)\s+import\s+([^\n]+)|import\s+([^\n]+))|^\s*([A-Za-z_]\w*)\s*(?::[^=\n]+)?\s*(?:(?:\*\*|\/\/|<<|>>|[+\-*/%&|^])?=)(?!=)/gm;
  while ((m = defRe.exec(clean))) {
    if (m[1]) defines.add(m[1]);
    if (m[2]) {
      imports.add(m[2]);
      String(m[3] || "")
        .split(",")
        .forEach((x) =>
          defines.add(
            x
              .trim()
              .split(/\s+as\s+/)
              .pop()
              .replace(/\W.*$/, "") || "",
          ),
        );
    }
    if (m[4])
      String(m[4])
        .split(",")
        .forEach((x) => {
          const p = x.trim().split(/\s+as\s+/);
          imports.add(p[0]);
          defines.add((p[1] || p[0].split(".")[0]).trim());
        });
    if (m[5]) defines.add(m[5]);
  }
  const idRe = /\b[A-Za-z_]\w*\b/g;
  while ((m = idRe.exec(clean))) {
    const x = m[0];
    if (!PY_DEP_WORDS.has(x) && !defines.has(x)) uses.add(x);
  }
  const assignReadRe = /^\s*([A-Za-z_]\w*)\s*(?::[^=\n]+)?\s*((?:\*\*|\/\/|<<|>>|[+\-*/%&|^])?=)(?!=)([^\n]*)/gm;
  while ((m = assignReadRe.exec(clean))) {
    const lhs = m[1],
      op = m[2],
      rhs = m[3] || "";
    if (op !== "=" || new RegExp("\\b" + lhs + "\\b").test(rhs)) uses.add(lhs);
  }
  const fileRe =
    /(?:open|read_csv|read_excel|read_json|read_parquet|load|read_text|read_bytes)\s*\(\s*["']([^"']+)["']/g;
  while ((m = fileRe.exec(src))) files.add(m[1]);
  return {
    defines: [...defines].filter(Boolean),
    uses: [...uses],
    imports: [...imports],
    files: [...files],
    explicit: [...new Set(explicit)],
    uncertain: /\b(?:exec|eval|globals|locals)\s*\(|(?:from\s+\S+\s+import\s+\*)/.test(clean),
  };
}
function artifactFingerprint(d) {
  return (d && d.fingerprint) || ((d && d.size) || 0) + ":" + crc32((d && d.bytes) || new Uint8Array());
}
function recomputeDependencies() {
  const last = new Map();
  dependencyRevision++;
  for (const c of cells) {
    if (c.type !== "code") {
      c.analysis = { defines: [], uses: [], files: [], explicit: [], uncertain: false };
      c.dependencies = [];
      continue;
    }
    c.analysis = analyzeCellSource(c.taEl ? c.taEl.value : c.source);
    const deps = new Set(c.analysis.explicit.filter((id) => id !== c.id && !!findCell(id)));
    for (const name of c.analysis.uses) {
      const id = last.get(name);
      if (id && id !== c.id) deps.add(id);
    }
    if (c.analysis.uncertain)
      for (const prev of cells.slice(0, indexOf(c))) if (prev.type === "code") deps.add(prev.id);
    c.dependencies = [...deps];
    for (const name of c.analysis.defines) last.set(name, c.id);
  }
  refreshNotebookFreshness();
}
function cellFreshness(cell) {
  if (cell.type !== "code" || !cell.outputs || !cell.outputs.length) return { state: "never", reasons: [] };
  const p = cell.provenance;
  if (!p) return { state: "historical", reasons: ["saved output has no lineage"] };
  const reasons = [];
  if (p.sourceHash !== sourceHash(cell.taEl ? cell.taEl.value : cell.source)) reasons.push("source changed");
  const snap = new Map((p.dependencies || []).map((d) => [d.cellId, d]));
  for (const id of cell.dependencies || []) {
    const up = findCell(id),
      old = snap.get(id);
    if (!up) reasons.push("dependency removed");
    else if (!old) reasons.push("dependency graph changed");
    else if (sourceHash(up.taEl ? up.taEl.value : up.source) !== old.sourceHash)
      reasons.push("upstream source changed");
    else if (up.provenance && old.runId && up.provenance.runId !== old.runId) reasons.push("upstream reran");
    else if (up.freshness === "stale") reasons.push("upstream output is stale");
  }
  for (const f of p.artifacts || []) {
    const now = dataFiles.find((d) => d.id === f.artifactId || d.name === f.path);
    if (!now) reasons.push("input removed: " + f.path);
    else if (artifactFingerprint(now) !== f.fingerprint) reasons.push("input changed: " + f.path);
  }
  const envHash = environmentSnapshot && (environmentSnapshot.runtimeHash || environmentSnapshot.hash);
  if (p.environmentHash && envHash && p.environmentHash !== envHash) reasons.push("environment changed");
  if ((p.staleReasons || []).length) reasons.push(...p.staleReasons);
  return { state: reasons.length ? "stale" : "fresh", reasons: [...new Set(reasons)] };
}
function refreshNotebookFreshness() {
  for (const c of cells) {
    const f = cellFreshness(c);
    c.freshness = f.state;
    c.staleReasons = f.reasons;
    if (c.el) {
      c.el.classList.toggle("stale", f.state === "stale");
      c.el.classList.toggle("historical", f.state === "historical");
      if (c.staleEl) {
        c.staleEl.textContent = f.state === "stale" ? "STALE" : "HISTORY";
        c.staleEl.title = f.reasons.join(" · ");
      }
    }
  }
  if (ui && ui.splitOutputs) for (const c of cells) if (c.type === "code") syncCardFor(c);
}
function mkCell(type, source, id) {
  return {
    id: id || uid(),
    type: type || "code",
    source: source || "",
    outputs: [],
    execCount: null,
    editing: false,
    collapsed: false,
    provenance: null,
    dependencies: [],
    analysis: null,
    freshness: "never",
    staleReasons: [],
    el: null,
  };
}

function paint(cell) {
  if (!cell.codeEl) return;
  const v = cell.taEl.value;
  const tail = v.endsWith("\n") ? "\n" : "";
  cell.codeEl.innerHTML = (cell.type === "code" ? hlPython(v) : esc(v)) + tail;
  if (cell.phEl) cell.phEl.style.display = v.length ? "none" : "";
}

function buildCell(cell) {
  const sec = document.createElement("section");
  sec.className = "cell " + (cell.type === "code" ? "code" : "md");
  sec.dataset.id = cell.id;

  const gutter = document.createElement("div");
  gutter.className = "gutter";
  const exec = document.createElement("span");
  exec.className = "exec";
  gutter.appendChild(exec);
  const etime = document.createElement("span");
  etime.className = "exec-time";
  if (cell.runtime) etime.textContent = fmtDur(cell.runtime);
  gutter.appendChild(etime);
  const stale = document.createElement("span");
  stale.className = "cell-stale";
  gutter.appendChild(stale);

  const body = document.createElement("div");
  body.className = "body";

  // editor
  const editor = document.createElement("div");
  editor.className = "editor";
  const pre = document.createElement("pre");
  pre.className = "hl";
  const code = document.createElement("code");
  pre.appendChild(code);
  const ta = document.createElement("textarea");
  ta.className = "ta";
  ta.spellcheck = false;
  ta.value = cell.source;
  ta.setAttribute("autocomplete", "off");
  ta.setAttribute("autocapitalize", "off");
  ta.setAttribute("autocorrect", "off");
  const ph = document.createElement("div");
  ph.className = "ph";
  ph.textContent = cell.type === "code" ? "# Python  ·  ⇧⏎ to run" : "# Markdown  ·  ⇧⏎ to render";
  editor.appendChild(pre);
  editor.appendChild(ta);
  editor.appendChild(ph);

  // rendered markdown
  const mdr = document.createElement("div");
  mdr.className = "md-rendered";
  mdr.hidden = true;

  // collapsed peek (one-line summary shown when cell is collapsed)
  const peek = document.createElement("div");
  peek.className = "collapsed-peek";

  // outputs
  const outs = document.createElement("div");
  outs.className = "outputs";
  outs.hidden = true;

  // tools
  const tools = document.createElement("div");
  tools.className = "cell-tools";
  tools.innerHTML =
    '<button class="ct run" data-act="run" title="Run (⇧⏎)">' +
    ICON.run +
    "</button>" +
    '<button class="ct" data-act="up" title="Move up">' +
    ICON.up +
    "</button>" +
    '<button class="ct" data-act="down" title="Move down">' +
    ICON.down +
    "</button>" +
    '<button class="ct" data-act="add" title="Insert below">' +
    ICON.add +
    "</button>" +
    '<button class="ct type" data-act="type" title="Toggle code/markdown">' +
    (cell.type === "code" ? "py" : "md") +
    "</button>" +
    '<button class="ct col" data-act="collapse" title="Collapse / expand"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg></button>' +
    '<button class="ct ctx-pin" data-act="context" title="Agent context: auto">ctx</button>' +
    '<button class="ct ai" data-act="ai" title="Ask the agent about this cell (opens the Agent panel)">ai</button>' +
    '<button class="ct del" data-act="del" title="Delete">' +
    ICON.del +
    "</button>";

  body.appendChild(editor);
  body.appendChild(mdr);
  body.appendChild(peek);
  body.appendChild(outs);
  body.appendChild(tools);
  sec.appendChild(gutter);
  sec.appendChild(body);

  cell.el = sec;
  cell.taEl = ta;
  cell.codeEl = code;
  cell.preEl = pre;
  cell.outEl = outs;
  cell.mdEl = mdr;
  cell.execEl = exec;
  cell.timeEl = etime;
  cell.staleEl = stale;
  cell.phEl = ph;
  cell.peekEl = peek;
  cell.typeBtn = tools.querySelector('[data-act="type"]');
  cell.colBtn = tools.querySelector('[data-act="collapse"]');
  cell.ctxBtn = tools.querySelector('[data-act="context"]');
  sec.addEventListener("mouseenter", () => linkHover(cell.id, true));
  sec.addEventListener("mouseleave", () => linkHover(cell.id, false));

  // events
  ta.addEventListener("input", () => {
    cell.source = ta.value;
    paint(cell);
    schedulePersist();
    recomputeDependencies();
    if (cell.type === "code") cmp.onInput(cell);
    renderWelcome();
  });
  ta.addEventListener("focus", () => {
    selectCell(cell.id, "edit");
  });
  ta.addEventListener("keydown", (e) => editorKey(e, cell));
  ta.addEventListener("blur", () => {
    cmp.hideSoon();
  });
  ta.addEventListener("scroll", () => {
    cmp.hide();
  });
  sec.addEventListener("mousedown", (e) => {
    if (e.target.closest(".cell-tools")) return;
    if (e.target === ta) return;
    selectCell(cell.id, "command");
  });
  mdr.addEventListener("dblclick", () => {
    enterEdit(cell);
  });
  peek.addEventListener("click", () => {
    setCollapsed(cell, false);
  });
  tools.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    e.stopPropagation();
    const act = b.dataset.act;
    if (act === "run") runFrom(cell);
    else if (act === "up") moveCell(cell, -1);
    else if (act === "down") moveCell(cell, 1);
    else if (act === "add") insertCell(indexOf(cell) + 1, "code", true);
    else if (act === "type") toggleType(cell);
    else if (act === "context") cycleCellContext(cell.id);
    else if (act === "ai") {
      if (typeof agAskAboutCell === "function") agAskAboutCell(cell);
    } else if (act === "collapse") setCollapsed(cell, !cell.collapsed);
    else if (act === "del") deleteCell(cell);
  });

  paint(cell);
  renderOutputs(cell);
  refreshExec(cell);
  if (cell.type === "markdown" && cell.source.trim() && !cell.editing) showRendered(cell, true);
  applyCollapsed(cell);
  updateCellContextButton(cell);
  return sec;
}
