# In-browser Python runtime contract

Everything a notebook author needs to know about how the runtime executes code and renders
output. The runtime is CPython on WebAssembly (Pyodide) running entirely in the browser, with
one persistent kernel shared across all cells. (KERNEL is the reference implementation; the
names below — `display_html`, `display_plotly`, the ordering rules — are the contract any
compatible runtime should honor.)

## Table of contents
1. Execution model
2. Output ordering
3. Display helpers (exact signatures)
4. matplotlib
5. Packages: import vs `%pip`
6. The markdown feature matrix
7. Data files
8. Things that don't exist here
9. Performance notes

## 1. Execution model

- **One persistent namespace.** Variables, imports, and functions defined in one cell are
  available in every later cell, exactly like Jupyter. Build state up incrementally.
- **Top-level `await` is allowed.** Cells run with `eval_code_async`, so
  `await something()` works at cell top level.
- **Last-expression echo.** If a cell's final statement is an expression, its value is
  displayed: rich HTML via `_repr_html_` when the object provides it (pandas DataFrame,
  Series, styled objects), otherwise `repr()`. A trailing `;` or ending on an assignment
  suppresses the echo.
- **`_`** holds the last echoed value, as in a REPL.
- **Errors** show a trimmed traceback starting at the user's cell frame.

## 2. Output ordering

Each cell's outputs are emitted as a single **ordered** stream in execution order:
stdout/stderr fragments, figures, `display_*` calls, and finally the cell's return value.

Practical consequences:
- `print("loading...")` then a plot then a returned table renders as: text, figure, table.
- Figures created without an explicit `show()` are captured **right before** the cell's
  final value, so they appear above a returned table.
- `plt.show()` / `fig.show()` are intercepted to flush pending text and capture the figure
  *at that point* in the stream — so multiple show() calls interleaved with prints render
  in the right order. They never emit the Agg "non-interactive" warning.

## 3. Display helpers (exact signatures)

These are injected into every cell's namespace — no import needed.

```python
display(*objs)
# Render one or more objects inline, in order. Uses _repr_html_ when available,
# else repr(). Use when you want to show several things from one cell.

display_html(html: str, height: int = 480)
# Render a trusted HTML string in a sandboxed <iframe srcdoc> (scripts allowed,
# no same-origin access to the parent). height is clamped to [140, 1400].
# This is the path for any custom interactive output: d3, hand-written JS,
# a Bokeh/Altair standalone export, a Plotly doc, an HTML table you built, etc.

display_iframe(html: str, height: int = 480)
# Alias for display_html.

display_plotly(fig, height: int = 520)
# Convenience for Plotly figures. Internally calls
# fig.to_html(include_plotlyjs="cdn", full_html=True, config=...) and shows it via
# display_html. Requires `%pip install plotly` earlier in the notebook. Raises a clear
# TypeError if passed a non-Plotly object.
```

Security/behavior note: `display_html` content runs in a sandboxed iframe and may load
scripts from a CDN (that's how Plotly renders), but cannot reach the parent page. The
last-expression and `display()` HTML path is sanitized (scripts/`on*=` stripped) and
rendered inline — so use `display_html` when you genuinely need scripts to run.

## 4. matplotlib

- Backend is Agg (non-interactive); figures are rasterized to PNG and shown inline.
- Just build figures — they are auto-captured. `plt.show()` is optional.
- For crisp output use a reasonable `figsize` and `fig.tight_layout()`. KERNEL renders at
  ~110 dpi with `bbox_inches="tight"`.
- `import matplotlib.pyplot as plt` triggers a one-time package load on first use; put it
  in the early imports cell.
- LaTeX-style math is available inside matplotlib via mathtext (`r"$\alpha$"` in
  titles/labels/`ax.text`) — use it for math that must live on a chart. For equations in the
  narrative, markdown cells now typeset KaTeX directly (see §6), so prefer `$…$` / `$$…$$`
  there.

## 5. Packages: import vs `%pip`

**Bundled with Pyodide — import directly, KERNEL auto-loads them:**
numpy, pandas, scipy, scikit-learn (`sklearn`), matplotlib, sympy, networkx, statsmodels,
Pillow (`PIL`), beautifulsoup4 (`bs4`), lxml, regex, pyyaml (`yaml`), and more.

**Pure-Python packages from PyPI — install once with the magic, then import:**
```python
%pip install plotly altair humanize
```
`%pip install` (or `!pip install`) is handled before the rest of the cell runs; it uses
micropip, which can install any pure-Python wheel on PyPI plus anything Pyodide has
pre-built. Good candidates: plotly, altair, humanize, tabulate, python-dateutil extras.

**Not installable** (C/native extensions Pyodide hasn't built, or needs an OS): torch,
tensorflow, polars, duckdb (varies), psycopg2, anything needing CUDA/threads/sockets.

The authoritative, current list of pre-built packages is at
`https://pyodide.org/en/stable/usage/packages-in-pyodide.html` — when unsure whether a
specific package is available, prefer one from the bundled scientific stack, or generate
the data synthetically rather than reaching for an unavailable dependency.

## 6. The markdown feature matrix

KERNEL's markdown renderer supports:

| Feature | Supported | Notes |
|---|---|---|
| Headings `#`–`######` | yes | |
| Paragraphs | yes | |
| Bullet lists `- * +` | yes | **flat only — no nesting** |
| Numbered lists `1.` | yes | flat only |
| GFM tables `\| a \| b \|` | yes | needs the `---` separator row |
| Blockquotes `>` | yes | can contain nested markdown |
| Fenced code ```` ``` ```` | yes | ` ```python ` is syntax-highlighted |
| Inline `code` | yes | |
| **bold** / *italic* / ~~strike~~ | yes | `**`/`__`, `*`/`_`, `~~` |
| Links `[t](url)` / images `![a](url)` | yes | links open in a new tab |
| LaTeX math `$...$` / `$$...$$` | **yes** | KaTeX: `$…$` inline, `$$…$$` display |
| Mermaid diagrams ```` ```mermaid ```` | **yes** | fl/sequence/state/ER/gantt etc. |
| Nested lists / task lists / footnotes | **NO** | flatten the structure instead |

Equations typeset with KaTeX, so write them directly in the narrative: `$…$` inline,
`$$…$$` (or `\[ … \]`) for display. Diagrams render from a ```mermaid fenced block. Reserve
matplotlib mathtext for math that must live *inside* a chart (axis labels, annotations),
where KaTeX cannot reach — and there, use `\frac`, not `\dfrac`.

## 7. Data files

The **+Data** button mounts uploaded files into the Pyodide working directory. Read them
with ordinary file APIs:
```python
df = pd.read_csv("uploaded.csv")
text = open("notes.txt").read()
```
If the notebook is meant to be self-contained (no upload), generate a realistic synthetic
dataset with a seeded RNG and say so in the prose.

## 8. Things that don't exist here

- **Networking:** no `requests`, `urllib` to arbitrary hosts, or raw sockets. Don't fetch
  remote data at runtime; mount it or synthesize it. (A `display_html` iframe may load a
  charting library from a CDN, but Python-side network calls are not reliable.)
- **ipywidgets / `%matplotlib widget` / `%matplotlib notebook`:** no widget comm protocol.
  For interactivity use `display_plotly` or `display_html`.
- **Threads, multiprocessing, subprocess:** single-threaded WASM; design accordingly.
- **GPU / CUDA:** none.
- **Other Jupyter magics:** only `%pip` / `!pip install` are special-cased. Don't rely on
  `%matplotlib inline` (it's the default), `%timeit`, `%%bash`, etc.

## 9. Performance notes

- First import of a heavy package (pandas, matplotlib, scikit-learn) downloads and
  initializes it once; subsequent cells are fast. Front-load imports.
- Keep individual outputs reasonable — a 50k-row DataFrame repr or a 4000-point Plotly
  scatter is fine; a million points will be slow. Sample or aggregate for display.
- Big base64 PNGs and large iframes inflate the notebook; prefer one clear chart over ten.
