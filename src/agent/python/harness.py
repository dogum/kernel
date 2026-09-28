import sys, io, ast, base64, json, os, traceback, warnings, linecache, platform
from pyodide.code import eval_code_async
os.environ.setdefault("MPLBACKEND", "AGG")
warnings.filterwarnings("ignore", message=r".*non-interactive.*cannot be shown.*", category=UserWarning)
warnings.filterwarnings("ignore", message=r".*non-GUI backend.*", category=UserWarning)

# ---- ordered output stream: prints, figures, displays and the cell result appear in execution order ----
_OUT = []
_PENDING = []

class _StreamCap:
    def __init__(self, name): self._name = name
    def write(self, s):
        if s: _PENDING.append((self._name, s))
        return len(s) if s else 0
    def writelines(self, lines):
        for s in lines: self.write(s)
    def flush(self): pass
    def isatty(self): return False

def _flush_streams():
    if not _PENDING: return
    name, buf = None, []
    for n, t in _PENDING:
        if n != name and buf:
            _OUT.append({"kind":"stream", "name":name, "text":"".join(buf)}); buf = []
        name = n; buf.append(t)
    if buf: _OUT.append({"kind":"stream", "name":name, "text":"".join(buf)})
    _PENDING.clear()

def _emit_fig(fig):
    b = io.BytesIO()
    fig.savefig(b, format="png", bbox_inches="tight", dpi=110)
    _OUT.append({"kind":"image", "mime":"image/png", "b64":base64.b64encode(b.getvalue()).decode("ascii")})

def _capture_open_figs(close=True):
    if "matplotlib" not in sys.modules: return 0
    try:
        import matplotlib.pyplot as plt
    except Exception:
        return 0
    nums = plt.get_fignums()
    if not nums: return 0
    _flush_streams()
    for num in nums:
        try: _emit_fig(plt.figure(num))
        except Exception: pass
    if close: plt.close("all")
    return len(nums)

def _emit_obj(o):
    _flush_streams()
    rh = getattr(o, "_repr_html_", None)
    if callable(rh):
        try:
            h = rh()
            if h:
                _OUT.append({"kind":"html", "html":str(h)}); return
        except Exception:
            pass
    np = sys.modules.get("numpy")
    if np is not None and isinstance(o, (np.integer, np.floating, np.bool_)):
        o = o.item()
    try: _OUT.append({"kind":"text", "text":repr(o)})
    except Exception: _OUT.append({"kind":"text", "text":"<unrepresentable object>"})

# ---- display helpers available inside user cells ----
def display(*objs):
    """Render objects inline, in order (uses _repr_html_ when available)."""
    for o in objs: _emit_obj(o)

def display_html(html, height=480):
    """Display trusted interactive HTML in a sandboxed iframe output."""
    try: h = int(height)
    except Exception: h = 480
    h = max(140, min(1400, h))
    _flush_streams()
    _OUT.append({"kind":"iframe_html", "html":str(html), "height":h})

def display_iframe(html, height=480):
    """Alias for display_html (handy for Plotly / Bokeh standalone documents)."""
    display_html(html, height)

def display_plotly(fig, height=520):
    """One-liner for Plotly figures: render an interactive chart via the CDN build."""
    try:
        html = fig.to_html(include_plotlyjs="cdn", full_html=True,
                           config={"responsive": True, "displaylogo": False})
    except Exception as e:
        raise TypeError("display_plotly expects a Plotly figure; got %s (%s)" % (type(fig).__name__, e))
    display_html(html, height)

def _new_kernel_ns():
    return {
        "__name__": "__main__",
        "display": display,
        "display_html": display_html,
        "display_iframe": display_iframe,
        "display_plotly": display_plotly,
    }

_KNS = _new_kernel_ns()

def _kernel_reset():
    global _KNS
    _KNS = _new_kernel_ns()
    _KTRASH.clear()
    if "matplotlib" in sys.modules:
        try:
            import matplotlib.pyplot as plt
            plt.close("all")
        except Exception:
            pass
    return "ok"

def _fmt_exc():
    et, ev, tb = sys.exc_info()
    frames = []
    display_tb = tb
    if tb is not None:
        cur = tb
        while cur is not None:
            if str(cur.tb_frame.f_code.co_filename).startswith("kernel://"):
                display_tb = cur
                break
            cur = cur.tb_next
        for fr in traceback.extract_tb(tb):
            nbid = cellid = None
            if str(fr.filename).startswith("kernel://"):
                parts = str(fr.filename)[9:].split("/", 1)
                if len(parts) == 2: nbid, cellid = parts
            frames.append({"filename":str(fr.filename), "notebookId":nbid,
                           "cellId":cellid, "line":int(fr.lineno or 0),
                           "function":str(fr.name or ""), "source":str(fr.line or "")})
    if isinstance(ev, SyntaxError):
        fn = str(getattr(ev, "filename", "") or "")
        nbid = cellid = None
        if fn.startswith("kernel://"):
            parts = fn[9:].split("/", 1)
            if len(parts) == 2: nbid, cellid = parts
        frames.append({"filename":fn, "notebookId":nbid, "cellId":cellid,
                       "line":int(getattr(ev, "lineno", 0) or 0), "function":"<syntax>",
                       "source":str(getattr(ev, "text", "") or "").rstrip()})
    return {"text":"".join(traceback.format_exception(et, ev, display_tb)),
            "ename":getattr(et, "__name__", "Error"), "evalue":str(ev), "frames":frames}

def _install_mpl_hooks():
    # Make plt.show()/fig.show() flush pending output + capture the figure in place:
    # correct ordering AND no Agg "non-interactive" warning (we never reach the real backend).
    if "matplotlib" not in sys.modules:
        return
    try:
        import matplotlib.pyplot as plt
        import matplotlib.figure as _mfig
    except Exception:
        return
    if not getattr(plt, "_kernel_patched", False):
        def _show(*a, **k): _capture_open_figs(close=True)
        plt.show = _show
        try: plt._kernel_patched = True
        except Exception: pass
    if not getattr(_mfig.Figure, "_kernel_patched", False):
        def _fig_show(self, *a, **k):
            _flush_streams()
            try: _emit_fig(self)
            except Exception: pass
            try:
                import matplotlib.pyplot as _plt; _plt.close(self)
            except Exception: pass
        try:
            _mfig.Figure.show = _fig_show
            _mfig.Figure._kernel_patched = True
        except Exception:
            pass

async def _kernel_run(src, filename="<cell>"):
    global _OUT, _PENDING
    _OUT, _PENDING = [], []
    error = None
    _install_mpl_hooks()
    old_out, old_err = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = _StreamCap("stdout"), _StreamCap("stderr")
    try:
        linecache.cache[str(filename)] = (len(src), None, src.splitlines(True), str(filename))
        val = await eval_code_async(src, globals=_KNS, filename=str(filename))
        _install_mpl_hooks()
        _flush_streams()
        _capture_open_figs(close=True)
        if val is not None:
            _KNS["_"] = val
            _emit_obj(val)
    except BaseException:
        error = _fmt_exc()
    finally:
        _flush_streams()
        _capture_open_figs(close=True)
        sys.stdout, sys.stderr = old_out, old_err
    return json.dumps({"outputs": _OUT, "error": error})

def _environment_snapshot():
    try:
        import importlib.metadata as _md
        packages = sorted({(d.metadata.get("Name") or "unknown", d.version or "") for d in _md.distributions()}, key=lambda x:x[0].lower())
    except Exception:
        packages = []
    return json.dumps({"python":sys.version.split()[0], "implementation":platform.python_implementation(),
                       "platform":platform.platform(), "packages":[{"name":n,"version":v} for n,v in packages]})

def _human_bytes(n):
    try:
        n = float(n)
    except Exception:
        return ""
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return ("%d B" % int(n)) if unit == "B" else ("%.1f %s" % (n, unit))
        n /= 1024.0
    return ""

def _var_bytes(v, tn):
    try:
        if tn == "DataFrame":
            return int(v.memory_usage(deep=True).sum())
        if tn == "Series":
            return int(v.memory_usage(deep=True))
        if tn == "ndarray":
            return int(v.nbytes)
    except Exception:
        return None
    return None

def _inspect_ns():
    import types as _t
    skip = (_t.ModuleType, _t.FunctionType, _t.BuiltinFunctionType, _t.MethodType, type)
    rows = []
    for k in list(_KNS.keys()):
        if k.startswith("_"):
            continue
        v = _KNS.get(k)
        if isinstance(v, skip):
            continue
        tn = type(v).__name__
        info = ""
        try:
            if tn == "DataFrame":
                info = "%d \u00d7 %d" % (v.shape[0], v.shape[1])
            elif tn == "Series":
                info = "%d values" % len(v)
            elif tn == "ndarray":
                sh = getattr(v, "shape", None)
                info = " \u00d7 ".join(str(int(n)) for n in sh) if sh else "scalar"
            elif tn in ("list", "tuple", "set", "dict", "frozenset"):
                info = "%d items" % len(v)
            elif tn in ("str", "bytes"):
                info = "%d chars" % len(v)
            else:
                r = repr(v)
                info = r if len(r) <= 60 else (r[:59] + "\u2026")
        except Exception:
            info = ""
        b = _var_bytes(v, tn)
        rows.append({"name": k, "type": tn, "info": info, "bytes": b if b is not None else 0, "size": _human_bytes(b) if b is not None else ""})
    rows.sort(key=lambda r: r["name"].lower())
    return json.dumps(rows)

_KTRASH = {}

def _del_var(name):
    if name in _KNS:
        _KTRASH.pop(name, None)
        _KTRASH[name] = _KNS.pop(name)
        while len(_KTRASH) > 8:
            _KTRASH.pop(next(iter(_KTRASH)))
    return "ok"

def _undel_var(name):
    if name not in _KTRASH:
        return "gone"
    if name in _KNS:
        return "exists"
    _KNS[name] = _KTRASH.pop(name)
    return "ok"

def _short(x):
    try:
        if isinstance(x, float):
            return "%.4g" % x
        s = str(x)
    except Exception:
        s = "?"
    return s if len(s) <= 40 else (s[:39] + "\u2026")

def _var_detail(name):
    v = _KNS.get(name, None)
    tn = type(v).__name__
    out = {"name": name, "type": tn, "kind": "other", "lines": [], "repr": ""}
    try:
        if tn == "DataFrame":
            out["kind"] = "dataframe"
            out["shape"] = [int(v.shape[0]), int(v.shape[1])]
            cols = list(v.columns)[:8]
            out["columns"] = [str(c) for c in cols]
            out["dtypes"] = [[str(c), str(v[c].dtype)] for c in cols]
            if v.shape[1] > 8:
                out["dtypes_more"] = int(v.shape[1] - 8)
            rows = []
            for _, r in v.head(8)[cols].iterrows():
                rows.append([_short(r[c]) for c in cols])
            out["head"] = rows
        elif tn == "Series":
            out["kind"] = "series"
            out["lines"].append(["dtype", str(v.dtype)])
            out["lines"].append(["length", str(len(v))])
            try:
                out["lines"].append(["nulls", str(int(v.isna().sum()))])
            except Exception:
                pass
            import pandas as _pd
            if _pd.api.types.is_numeric_dtype(v):
                for lbl, fn in (("min", v.min), ("max", v.max), ("mean", v.mean), ("std", v.std)):
                    try:
                        out["lines"].append([lbl, _short(fn())])
                    except Exception:
                        pass
            else:
                try:
                    out["lines"].append(["unique", str(int(v.nunique()))])
                    vc = v.value_counts().head(3)
                    out["lines"].append(["top", ", ".join("%s (%d)" % (_short(i), int(c)) for i, c in vc.items())])
                except Exception:
                    pass
        elif tn == "ndarray":
            out["kind"] = "ndarray"
            out["lines"].append(["dtype", str(v.dtype)])
            out["lines"].append(["shape", str(tuple(v.shape))])
            try:
                import numpy as _np
                if _np.issubdtype(v.dtype, _np.number):
                    out["lines"].append(["min", _short(v.min())])
                    out["lines"].append(["max", _short(v.max())])
                    out["lines"].append(["mean", _short(v.mean())])
            except Exception:
                pass
        elif tn == "dict":
            out["kind"] = "mapping"
            out["lines"].append(["keys", str(len(v))])
            out["keys"] = [_short(k) for k in list(v.keys())[:12]]
            if len(v) > 12:
                out["keys_more"] = int(len(v) - 12)
        elif tn in ("list", "tuple", "set", "frozenset"):
            out["kind"] = "sequence"
            out["lines"].append(["length", str(len(v))])
            out["items"] = [_short(x) for x in list(v)[:12]]
            if len(v) > 12:
                out["items_more"] = int(len(v) - 12)
        else:
            out["kind"] = "scalar"
            r = repr(v)
            out["repr"] = r if len(r) <= 600 else (r[:600] + "\u2026")
    except Exception as e:
        out["kind"] = "other"
        out["repr"] = "detail unavailable: %s" % e
    return json.dumps(out)

def _complete(src, line, col):
    try:
        import jedi
    except Exception:
        return json.dumps({"ready": False, "items": []})
    try:
        script = jedi.Interpreter(src, [_KNS])
        comps = script.complete(line, col)
        items = [{"name": c.name, "complete": c.complete, "type": c.type} for c in comps[:60]]
        return json.dumps({"ready": True, "items": items})
    except Exception:
        return json.dumps({"ready": True, "items": []})
