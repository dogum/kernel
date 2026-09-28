/* ===== execution ===== */
function cleanKernelStderr(text) {
  return String(text || "")
    .split(/\r?\n/)
    .filter((line) => !/UserWarning:\s*FigureCanvasAgg is non-interactive, and thus cannot be shown/.test(line))
    .join("\n")
    .trimEnd();
}
function buildOutputs(res) {
  const out = [];
  for (const o of res.outputs || []) {
    if (o.kind === "stream" && o.name === "stderr") {
      const t = cleanKernelStderr(o.text);
      if (t) out.push({ kind: "stream", name: "stderr", text: t });
    } else if (o.kind === "stream") {
      if (o.text) out.push(o);
    } else {
      out.push(o);
    }
  }
  if (res.error) {
    const er = typeof res.error === "string" ? { text: res.error, frames: [] } : res.error;
    out.push({
      kind: "error",
      text: er.text || String(er),
      ename: er.ename || "Error",
      evalue: er.evalue || "",
      frames: Array.isArray(er.frames) ? er.frames : [],
    });
  }
  return out;
}
function provenanceInputs(cell) {
  const dependencies = (cell.dependencies || []).map((id) => {
    const c = findCell(id);
    return {
      cellId: id,
      sourceHash: c ? sourceHash(c.taEl ? c.taEl.value : c.source) : null,
      runId: (c && c.provenance && c.provenance.runId) || null,
    };
  });
  const artifacts = ((cell.analysis && cell.analysis.files) || []).map((path) => {
    const d = dataFiles.find((x) => x.name === path || x.path === path);
    return d
      ? { artifactId: d.id || null, path: d.name, fingerprint: artifactFingerprint(d) }
      : { artifactId: null, path, fingerprint: null };
  });
  return { dependencies, artifacts };
}
async function refreshArtifactFromKernel(d, stat) {
  if (!kernelReady) return false;
  const path = d.path || d.name;
  if (!stat) {
    try {
      stat = (await pyFS.stat([path]))[path];
    } catch (e) {
      return false;
    }
  }
  if (!stat) return false;
  if (d.bytes && d.fsStat && d.fsStat.size === stat.size && d.fsStat.mtime === stat.mtime) return false;
  const raw = await pyFS.read(path),
    bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw),
    fingerprint = bytes.byteLength + ":" + crc32(bytes);
  d.fsStat = { size: stat.size, mtime: stat.mtime };
  if (d.fingerprint === fingerprint && d.bytes) return false;
  const changed = !!d.fingerprint;
  d.bytes = bytes;
  d.size = bytes.byteLength;
  d.fingerprint = fingerprint;
  d.blob = null;
  if (changed) d.updatedAt = Date.now();
  if (/^(?:csv|tsv|tab|txt|md|log|json|py|yaml|yml|html|xml)$/.test(fileExt(d.name)))
    try {
      d.preview = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 8192)).slice(0, 4000);
    } catch (e) {}
  return true;
}
async function refreshReferencedArtifacts(cell) {
  if (!kernelReady) return;
  for (const path of (cell.analysis && cell.analysis.files) || []) {
    const d = dataEntry(path);
    if (!d) continue;
    try {
      await refreshArtifactFromKernel(d);
    } catch (e) {}
  }
}
function extractPip(src) {
  const re = /^\s*[%!]pip\s+install\s+(.+?)\s*$/;
  const pkgs = [],
    rest = [];
  for (const line of src.split("\n")) {
    const m = line.match(re);
    if (m) {
      for (const tok of m[1].split(/\s+/)) {
        if (tok && !tok.startsWith("-")) pkgs.push(tok);
      }
      rest.push("");
    } else rest.push(line);
  }
  return { pkgs, rest: rest.join("\n") };
}
async function ensureMicropip() {
  if (micropipReady) return;
  await pyTask(() =>
    kwCall("loadPackage", { names: "micropip" }).then((r) => {
      kernelPackages = r.packages || kernelPackages;
    }),
  );
  micropipReady = true;
}
async function refreshInspector() {
  if (!kernelReady) return;
  try {
    renderInspector(JSON.parse(await runPy("_inspect_ns()")));
  } catch (e) {}
}
async function runCell(cell, opts) {
  opts = opts || {};
  if (cell.type === "markdown") {
    cell.source = cell.taEl ? cell.taEl.value : cell.source;
    showRendered(cell, true);
    schedulePersist();
    return true;
  }
  if (!kernelReady) {
    toast("Kernel still booting — one moment.", "err");
    return false;
  }
  // a switch resets Python partway through, which would cut this cell off or leave its state in the next notebook
  if (notebookSwitching) {
    toast("Wait for the notebook switch to finish.", "err");
    return false;
  }
  if (busy) {
    toast("Kernel is busy with another cell.", "err");
    return false;
  }
  cmp.hide();
  let src = cell.taEl ? cell.taEl.value : cell.source;
  const sourceAtRun = src;
  cell.source = src;
  recomputeDependencies();
  await refreshReferencedArtifacts(cell);
  if (busy) {
    toast("Kernel is busy with another cell.", "err");
    return false;
  }
  const lineage = provenanceInputs(cell),
    execCtx = activeToolContext || { runId: "exec_" + uid(), actor: "human", threadId: null, toolCallId: null };
  const inheritedStale = (cell.dependencies || [])
    .filter((id) => {
      const c = findCell(id);
      return c && cellFreshness(c).state === "stale";
    })
    .map((id) => "upstream stale: " + id);
  if (!src.trim()) {
    cell.outputs = [];
    cell.execCount = ++execCounter;
    cell.runtime = null;
    cell.provenance = null;
    if (cell.timeEl) cell.timeEl.textContent = "";
    renderOutputs(cell);
    refreshExec(cell);
    refreshNotebookFreshness();
    schedulePersist();
    scheduleWorkspacePersist();
    return true;
  }
  busy = true;
  cell.el.classList.add("running");
  cell.el.classList.remove("done");
  cell.execEl.textContent = "[*]";
  if (cell.timeEl) cell.timeEl.textContent = "";
  kernelInterruptReason = "";
  if (kw.iv) kw.iv[0] = 0;
  setStatus("Running…", "busy");
  progressOn();
  const collected = [];
  const t0 = performance.now(),
    limitTimer =
      opts.agent && agCellMinutes
        ? setTimeout(() => {
            interruptKernel("timeout");
          }, agCellMinutes * 60000)
        : null;
  try {
    const pip = extractPip(src);
    if (pip.pkgs.length) {
      setStatus(pkgSummary("Installing", pip.pkgs), "busy", "Installing " + pip.pkgs.join(", "));
      collected.push({ kind: "stream", name: "stdout", text: "Installing " + pip.pkgs.join(", ") + " …\n" });
      cell.outputs = collected.slice();
      renderOutputs(cell);
      try {
        await ensureMicropip();
        await runPy("import micropip\nawait micropip.install(list(__pip_pkgs))", { __pip_pkgs: pip.pkgs });
        collected[collected.length - 1] = {
          kind: "stream",
          name: "stdout",
          text: "Installed " + pip.pkgs.join(", ") + "\n",
        };
        await captureEnvironment();
        src = pip.rest;
      } catch (perr) {
        collected[collected.length - 1] = {
          kind: "error",
          text: "pip install failed: " + String(perr && perr.message ? perr.message : perr),
        };
        cell.outputs = collected.slice();
        cell.execCount = ++execCounter;
        return true;
      }
    }
    if (src.trim()) {
      setStatus("Running…", "busy");
      try {
        await pyTask(() =>
          kwCall("loadFromImports", { src }, (m) => {
            if (/^Loading/.test(m)) {
              const names = m.replace(/^Loading\s*/, "").split(/,\s*/);
              setStatus(pkgSummary("Loading", names), "busy", m);
            }
          }).then((r) => {
            kernelPackages = r.packages || kernelPackages;
          }),
        );
      } catch (_) {}
      setStatus("Running…", "busy");
      const raw = await runPy("await _kernel_run(__cell_src, __cell_filename)", {
        __cell_src: src,
        __cell_filename: "kernel://" + nbId + "/" + cell.id,
      });
      cell.outputs = collected.concat(buildOutputs(JSON.parse(raw)));
      if (kernelInterruptReason)
        cell.outputs.push({
          kind: "stream",
          name: "stderr",
          text:
            "KERNEL interrupted this cell because " +
            interruptExplanation(kernelInterruptReason) +
            ". Variables defined before the interrupt remain.\n",
        });
    } else {
      cell.outputs = collected.slice();
    }
    cell.execCount = ++execCounter;
  } catch (err) {
    cell.outputs = collected.concat([
      {
        kind: "error",
        text:
          (err && err.name === "KernelRestart" ? "KernelRestart: " : "") +
          String(err && err.message ? err.message : err),
      },
    ]);
    cell.execCount = err && err.name === "KernelRestart" ? null : ++execCounter;
    if (!(err && err.name === "KernelRestart")) console.error(err);
  } finally {
    clearTimeout(limitTimer);
    kernelInterruptReason = "";
    if (kw.iv) kw.iv[0] = 0;
    const dt = performance.now() - t0;
    cell.runtime = dt;
    cell.provenance = {
      runId: execCtx.runId,
      actor: execCtx.actor || "human",
      threadId: execCtx.threadId || null,
      toolCallId: execCtx.toolCallId || null,
      at: Date.now(),
      sourceHash: sourceHash(sourceAtRun),
      dependencies: lineage.dependencies,
      artifacts: lineage.artifacts,
      environmentHash: (environmentSnapshot && (environmentSnapshot.runtimeHash || environmentSnapshot.hash)) || null,
      kernelGeneration,
      status: cell.outputs && cell.outputs.some((o) => o.kind === "error") ? "error" : "success",
      staleReasons: inheritedStale,
    };
    cell.el.classList.remove("running");
    renderOutputs(cell);
    refreshExec(cell);
    applyCollapsed(cell);
    if (ui.splitOutputs) syncCardFor(cell);
    if (cell.timeEl)
      cell.timeEl.textContent = cell.outputs && cell.outputs.some((o) => o.kind === "error") ? "" : fmtDur(dt);
    setStatus(kernelReady ? "Ready" : "Kernel failed", kernelReady ? "ok" : "err");
    progressOff();
    schedulePersist();
    scheduleWorkspacePersist();
    refreshNotebookFreshness();
    try {
      await refreshInspector();
    } catch (_) {}
    busy = false;
  }
  return true;
}
function runFrom(cell) {
  return runCell(cell);
}
async function runAndAdvance(cell) {
  await runCell(cell);
  const i = indexOf(cell);
  if (i === cells.length - 1) {
    insertCell(i + 1, "code", true);
  } else {
    const n = cells[i + 1];
    selectCell(n.id, "command");
    if (n.el) n.el.scrollIntoView({ block: "nearest" });
  }
}
async function runAll() {
  if (!kernelReady) {
    toast("Kernel still booting — one moment.", "err");
    return;
  }
  if (busy) {
    toast("Kernel is busy.", "err");
    return;
  }
  const t0 = performance.now();
  let n = 0,
    failed = false;
  for (const cell of cells) {
    if (cell.type === "code") {
      if (cell.el) cell.el.scrollIntoView({ block: "center", behavior: "smooth" });
      await runCell(cell);
      n++;
      if (cell.outputs && cell.outputs.some((o) => o.kind === "error")) {
        failed = true;
        break;
      }
    } else showRendered(cell, true);
  }
  const dt = performance.now() - t0;
  if (failed) toast("Stopped at an error after " + n + " cell" + (n !== 1 ? "s" : "") + " (" + fmtDur(dt) + ")", "err");
  else toast("Ran " + n + " cell" + (n !== 1 ? "s" : "") + " in " + fmtDur(dt));
}

function setAllCollapsed(on) {
  for (const c of cells) {
    c.collapsed = !!on;
    applyCollapsed(c);
  }
  if (selectedId) selectCell(selectedId, "command");
  schedulePersist();
}
async function restartAndRunAll() {
  if (busy) {
    toast("Kernel is busy.", "err");
    return;
  }
  await restartKernel();
  await runAll();
}
function downloadPy() {
  const parts = ["# " + (nbName || "notebook") + "  ·  exported from KERNEL"];
  for (const c of cells) {
    const src = (c.taEl ? c.taEl.value : c.source) || "";
    parts.push(
      c.type === "markdown"
        ? src
            .split("\n")
            .map((l) => ("# " + l).replace(/\s+$/, ""))
            .join("\n")
        : src,
    );
  }
  const blob = new Blob([parts.join("\n\n") + "\n"], { type: "text/x-python" });
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = (nbName || "notebook").replace(/[^\w.-]+/g, "_") + ".py";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Downloaded .py");
}
function toggleMenu(open) {
  const m = $("#moreMenu");
  const show = open != null ? open : !m.classList.contains("open");
  if (show) {
    const mi = $("#miSplit");
    if (mi) mi.textContent = ui.splitOutputs ? "Move outputs inline" : "Move outputs to panel";
  }
  m.classList.toggle("open", show);
  m.setAttribute("aria-hidden", show ? "false" : "true");
}
function closeMenu() {
  toggleMenu(false);
}
