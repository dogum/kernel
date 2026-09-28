/* ===== .ipynb round-trip ===== */
function splitLines(src) {
  if (src === "") return [];
  const p = src.split("\n");
  return p.map((ln, i) => (i < p.length - 1 ? ln + "\n" : ln)).filter((ln, i, a) => !(i === a.length - 1 && ln === ""));
}
const joinText = (v) => (Array.isArray(v) ? v.join("") : String(v == null ? "" : v));
function outputsToIpynb(outs, ec) {
  const r = [];
  for (const o of outs || []) {
    if (o.kind === "stream") {
      const text = o.name === "stderr" ? cleanKernelStderr(o.text) : o.text;
      if (text) r.push({ output_type: "stream", name: o.name || "stdout", text: splitLines(text) });
    } else if (o.kind === "text")
      r.push({
        output_type: "execute_result",
        execution_count: ec == null ? null : ec,
        data: { "text/plain": splitLines(o.text) },
        metadata: {},
      });
    else if (o.kind === "html")
      r.push({
        output_type: "execute_result",
        execution_count: ec == null ? null : ec,
        data: { "text/html": splitLines(o.html), "text/plain": ["[HTML output]"] },
        metadata: {},
      });
    else if (o.kind === "iframe_html")
      r.push({
        output_type: "display_data",
        data: { "text/html": splitLines(o.html), "text/plain": ["[interactive HTML output]"] },
        metadata: { kernel: { kind: "iframe_html", height: o.height || 480 } },
      });
    else if (o.kind === "image") r.push({ output_type: "display_data", data: { "image/png": o.b64 }, metadata: {} });
    else if (o.kind === "error") {
      const L = splitLines(stripAnsi(o.text));
      r.push({
        output_type: "error",
        ename: o.ename || "Error",
        evalue: o.evalue || (L[L.length - 1] || "").trim(),
        traceback: L,
      });
    }
  }
  return r;
}
function toIpynb(options) {
  options = options || {};
  const includeConversation = options.includeConversation !== false;
  return {
    cells: cells.map((c) => {
      const frames = (c.outputs || [])
        .filter((o) => o.kind === "error" && o.frames && o.frames.length)
        .flatMap((o) => o.frames);
      const base = {
        cell_type: c.type,
        metadata: {
          kernel: {
            cell_id: c.id,
            collapsed: !!c.collapsed,
            provenance: c.provenance || undefined,
            error_frames: frames.length ? frames : undefined,
          },
        },
        source: splitLines(c.taEl ? c.taEl.value : c.source),
      };
      if (c.type === "code") {
        base.execution_count = c.execCount == null ? null : c.execCount;
        base.outputs = outputsToIpynb(c.outputs, c.execCount);
      }
      return base;
    }),
    metadata: {
      kernel_agent:
        includeConversation && typeof agExportBundle === "function" ? agExportBundle() || undefined : undefined,
      kernel_environment: environmentSnapshot || undefined,
      kernelspec: { name: "python3", display_name: "Python 3 (Pyodide)", language: "python" },
      language_info: { name: "python", mimetype: "text/x-python", file_extension: ".py" },
      kernel_app: "KERNEL",
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}
function ipynbToOutputs(outs) {
  const r = [];
  for (const o of outs || []) {
    const t = o.output_type;
    if (t === "stream") {
      const name = o.name || "stdout";
      const text = name === "stderr" ? cleanKernelStderr(joinText(o.text)) : joinText(o.text);
      if (text) r.push({ kind: "stream", name, text });
    } else if (t === "execute_result" || t === "display_data") {
      const d = o.data || {};
      if (d["image/png"])
        r.push({ kind: "image", mime: "image/png", b64: joinText(d["image/png"]).replace(/\s+/g, "") });
      if (d["application/vnd.jupyter.widget-view+json"]) {
        r.push({ kind: "text", text: "[widget output from the source notebook — run the cell to regenerate]" });
      } else if (d["text/html"]) {
        const html = joinText(d["text/html"]);
        const meta = o.metadata && o.metadata.kernel;
        if (meta && meta.kind === "iframe_html") r.push({ kind: "iframe_html", html, height: meta.height || 480 });
        else if (/jupyter-widgets|widget-view\+json|widgetsnbextension/i.test(html))
          r.push({ kind: "text", text: "[widget output from the source notebook — run the cell to regenerate]" });
        else r.push({ kind: "html", html });
      } else if (d["text/plain"] && !d["image/png"]) r.push({ kind: "text", text: joinText(d["text/plain"]) });
    } else if (t === "error")
      r.push({
        kind: "error",
        ename: o.ename || "Error",
        evalue: o.evalue || "",
        text:
          o.traceback && o.traceback.length
            ? stripAnsi(o.traceback.join("\n"))
            : (o.ename || "Error") + ": " + (o.evalue || ""),
      });
  }
  return r;
}
function fromIpynb(obj) {
  if (!obj || !Array.isArray(obj.cells)) throw new Error("Not a valid .ipynb notebook");
  const seenIds = new Set(),
    nc = obj.cells.map((c) => {
      const t = c.cell_type === "code" ? "code" : "markdown";
      const src = Array.isArray(c.source) ? c.source.join("") : c.source || "";
      const km = c.metadata && c.metadata.kernel;
      let cid = km && km.cell_id;
      if (!cid || seenIds.has(cid)) cid = uid();
      seenIds.add(cid);
      const cell = mkCell(t, src, cid);
      cell.collapsed = !!(km && km.collapsed);
      cell.provenance = (km && km.provenance) || null;
      if (t === "code") {
        cell.execCount = typeof c.execution_count === "number" ? c.execution_count : null;
        cell.outputs = ipynbToOutputs(c.outputs || []);
        const er = cell.outputs.find((o) => o.kind === "error");
        if (er && km && Array.isArray(km.error_frames)) er.frames = clonePlain(km.error_frames);
      }
      return cell;
    });
  cells = nc.length ? nc : [mkCell("code", "")];
  execCounter = cells.reduce((m, c) => (c.execCount != null && c.execCount > m ? c.execCount : m), 0);
  selectedId = null;
  render();
  if (cells[0]) selectCell(cells[0].id, "command");
  schedulePersist();
  if (obj.metadata && obj.metadata.kernel_environment)
    environmentSnapshot = clonePlain(obj.metadata.kernel_environment);
  try {
    if (!workspaceArchiveImport) agImportMeta(obj.metadata && obj.metadata.kernel_agent);
  } catch (e) {}
}
function downloadIpynb() {
  const blob = new Blob([JSON.stringify(toIpynb(), null, 1)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (typeof agSlug === "function" ? agSlug() : "kernel-notebook") + ".ipynb";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Saved " + (typeof agSlug === "function" ? agSlug() : "kernel-notebook") + ".ipynb — conversation embedded");
}
