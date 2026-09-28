/* ===== boot ===== */
/* ----- Pyodide runs in a dedicated Web Worker so long or runaway cells never freeze the page, and can be interrupted.
   kernelWorkerMain is serialized into the worker; when a worker cannot start (for example a restrictive file:// context) the
   same function runs on the page thread with an identical message protocol, trading interruptibility for compatibility. ----- */
function kernelWorkerMain(scope) {
  let py = null,
    chain = Promise.resolve();
  const packages = () => (py && py.loadedPackages ? Object.keys(py.loadedPackages) : []);
  const plain = (v) => {
    if (v && typeof v.toJs === "function") {
      const out = v.toJs({ dict_converter: Object.fromEntries });
      try {
        v.destroy();
      } catch (e) {}
      return out;
    }
    return v;
  };
  const parent = (path) => {
    const i = path.lastIndexOf("/");
    if (i > 0) py.FS.mkdirTree(path.slice(0, i));
  };
  const ops = {
    async boot(a) {
      await scope.load(a.indexURL + "pyodide.js");
      py = await globalThis.loadPyodide({ indexURL: a.indexURL });
      if (a.interruptBuffer) py.setInterruptBuffer(a.interruptBuffer);
      await py.runPythonAsync(a.harness);
      const version = await py.runPythonAsync("import sys; sys.version.split()[0]");
      return { version: String(version), packages: packages(), interruptible: !!a.interruptBuffer };
    },
    async run(a) {
      for (const [k, v] of Object.entries(a.vars || {})) py.globals.set(k, v);
      return { value: plain(await py.runPythonAsync(a.code)), packages: packages() };
    },
    async loadFromImports(a, id) {
      await py.loadPackagesFromImports(a.src, {
        messageCallback: (m) => scope.postMessage({ id, progress: String(m) }),
      });
      return { packages: packages() };
    },
    async loadPackage(a) {
      await py.loadPackage(a.names);
      return { packages: packages() };
    },
    fsWrite(a) {
      parent(a.path);
      py.FS.writeFile(a.path, a.bytes);
      return true;
    },
    fsRead(a) {
      return py.FS.readFile(a.path);
    },
    fsUnlink(a) {
      try {
        py.FS.unlink(a.path);
      } catch (e) {}
      return true;
    },
    fsStat(a) {
      const out = {};
      for (const path of a.paths || []) {
        try {
          const s = py.FS.stat(path);
          out[path] = { size: s.size, mtime: +s.mtime };
        } catch (e) {
          out[path] = null;
        }
      }
      return out;
    },
  };
  scope.onmessage = (e) => {
    const d = e.data || {};
    chain = chain.then(async () => {
      try {
        if (!ops[d.op]) throw new Error("Unknown kernel operation " + d.op);
        if (d.op !== "boot" && !py) throw new Error("Python is not initialized in this kernel");
        const result = await ops[d.op](d.args || {}, d.id);
        scope.postMessage(
          { id: d.id, ok: true, result },
          d.op === "fsRead" && result && result.buffer ? [result.buffer] : [],
        );
      } catch (err) {
        scope.postMessage({
          id: d.id,
          ok: false,
          error: { name: (err && err.name) || "Error", message: String((err && err.message) || err) },
        });
      }
    });
  };
}
const kw = { mode: "", worker: null, pending: new Map(), seq: 0, iv: null, interruptible: false, url: "" };
let kernelPackages = [],
  kernelInterruptReason = "";
function kwOnMessage(e) {
  const d = e.data || {},
    p = kw.pending.get(d.id);
  if (!p) return;
  if (d.progress != null) {
    if (p.onProgress) p.onProgress(d.progress);
    return;
  }
  kw.pending.delete(d.id);
  if (d.ok) p.resolve(d.result);
  else
    p.reject(
      Object.assign(new Error((d.error && d.error.message) || "Python worker error"), {
        name: (d.error && d.error.name) || "Error",
      }),
    );
}
function kwFailAll(err) {
  const pending = [...kw.pending.values()];
  kw.pending = new Map();
  for (const p of pending) p.reject(err);
}
function kwCall(op, args, onProgress) {
  return new Promise((resolve, reject) => {
    if (!kw.worker) {
      reject(new Error("Python kernel is not running"));
      return;
    }
    const id = ++kw.seq;
    kw.pending.set(id, { resolve, reject, onProgress });
    try {
      kw.worker.postMessage({ id, op, args });
    } catch (e) {
      kw.pending.delete(id);
      reject(e);
    }
  });
}
function kwStart(mode) {
  kw.pending = new Map();
  kw.iv = null;
  kw.interruptible = false;
  if (mode !== "inline" && typeof Worker !== "undefined") {
    try {
      const src = "self.load=async u=>importScripts(u);(" + kernelWorkerMain.toString() + ")(self);";
      if (kw.url) URL.revokeObjectURL(kw.url);
      kw.url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      const w = new Worker(kw.url);
      w.onmessage = kwOnMessage;
      w.onerror = (ev) => {
        ev.preventDefault && ev.preventDefault();
        kwFailAll(new Error("Python worker failed: " + (ev.message || "unknown error")));
      };
      kw.worker = w;
      kw.mode = "worker";
      if (typeof SharedArrayBuffer !== "undefined" && globalThis.crossOriginIsolated)
        kw.iv = new Uint8Array(new SharedArrayBuffer(1));
      return;
    } catch (e) {
      console.warn("Web Worker unavailable; running Python on the page thread", e);
    }
  }
  const scope = {
    load: loadScript,
    onmessage: null,
    postMessage: (data) => queueMicrotask(() => kwOnMessage({ data })),
  };
  kernelWorkerMain(scope);
  kw.worker = { postMessage: (data) => scope.onmessage({ data }), terminate() {} };
  kw.mode = "inline";
}
async function kwBoot(mode) {
  kwStart(mode);
  const info = await kwCall("boot", { indexURL: PYODIDE_BASE, harness: HARNESS, interruptBuffer: kw.iv });
  kernelPackages = info.packages || [];
  kw.interruptible = !!info.interruptible && kw.mode === "worker";
  return info;
}
function kernelModeLabel() {
  return kw.mode === "worker" ? (kw.interruptible ? " · worker · interruptible" : " · worker") : " · page thread";
}
function pyTask(fn) {
  const p = _pyChain.then(fn);
  _pyChain = p.catch(() => {});
  return p;
}
function runPy(code, vars) {
  return pyTask(() =>
    kwCall("run", { code, vars }).then((r) => {
      if (r && r.packages) kernelPackages = r.packages;
      return r ? r.value : undefined;
    }),
  );
}
const pyFS = {
  write: (path, bytes) => kwCall("fsWrite", { path, bytes }),
  read: (path) => kwCall("fsRead", { path }),
  unlink: (path) => kwCall("fsUnlink", { path }),
  stat: (paths) => kwCall("fsStat", { paths }),
};
async function remountArtifacts() {
  for (const d of dataFiles) {
    try {
      if (d.bytes)
        await pyFS.write(d.path || d.name, d.bytes instanceof Uint8Array ? d.bytes : new Uint8Array(d.bytes));
    } catch (e) {
      console.warn("Could not remount", d.name, e);
    }
  }
}
function interruptExplanation(reason) {
  return reason === "timeout"
    ? "the agent cell time limit (" + agCellMinutes + " min) was reached"
    : reason === "stop"
      ? "the human pressed Stop"
      : reason === "restart"
        ? "the human restarted the kernel"
        : "the human pressed Interrupt";
}
/* Soft interrupt (KeyboardInterrupt, namespace kept) when the page is cross-origin isolated; otherwise the worker is replaced,
   artifacts are remounted, and every cell's execution count is cleared because the Python namespace is gone. */
async function interruptKernel(reason, force) {
  if (!busy || kw.mode !== "worker") return false;
  kernelInterruptReason = reason || "human";
  if (!force && kw.interruptible && kw.iv) {
    kw.iv[0] = 2;
    const t0 = Date.now();
    while (busy && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 100));
    if (!busy) return true;
  }
  await restartKernelHard(kernelInterruptReason);
  return true;
}
async function restartKernelHard(reason) {
  kernelReady = false;
  setStatus("Restarting Python…", "busy");
  try {
    kw.worker.terminate();
  } catch (e) {}
  kwFailAll(
    Object.assign(
      new Error(
        "KERNEL restarted Python because " +
          interruptExplanation(reason) +
          ". All variables were cleared; rerun upstream cells before continuing.",
      ),
      { name: "KernelRestart" },
    ),
  );
  _pyChain = Promise.resolve();
  micropipReady = false;
  jediReady = false;
  kernelGeneration++;
  execCounter = 0;
  for (const cell of cells) {
    cell.execCount = null;
    if (cell.el) refreshExec(cell);
  }
  try {
    await kwBoot(kw.mode);
    await remountArtifacts();
    kernelReady = true;
    setStatus("Ready", "ok");
    $("#kernelInfo").textContent = "Python restarted" + kernelModeLabel();
    try {
      await captureEnvironment();
    } catch (e) {}
    refreshNotebookFreshness();
    loadExtras();
  } catch (err) {
    kernelReady = false;
    try {
      kw.worker.terminate();
    } catch (e) {}
    kw.worker = null;
    kwFailAll(new Error("Python kernel is not running"));
    setStatus("Kernel failed", "err");
    $("#kernelInfo").textContent = "Python failed to restart · press Restart to try again";
    toast("Python could not restart · press Restart to try again · " + String((err && err.message) || err), "err");
  } finally {
    try {
      await refreshInspector();
    } catch (_) {}
  }
}
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error("Failed to load " + src));
    document.head.appendChild(s);
  });
}
function loadCss(href) {
  return new Promise((res) => {
    if (document.querySelector('link[href="' + href + '"]')) return res();
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = href;
    l.onload = res;
    l.onerror = res;
    document.head.appendChild(l);
  });
}
