---
name: kernel-notebooks
description: >-
  Author exceptional Python notebooks (.ipynb) for a rich in-browser Python notebook
  runtime built on Pyodide / WebAssembly (such as KERNEL): well-structured, narrated
  analyses with rich markdown, clean code, publication-quality matplotlib, and genuinely
  interactive Plotly / HTML output. Use this skill whenever the user wants to create,
  generate, scaffold, draft, or substantially improve a Python notebook, data-analysis
  notebook, computational essay, or .ipynb file — or wants existing code or a dataset
  turned into one — and especially for an in-browser or Pyodide environment. Trigger it
  even when the user doesn't say "notebook" explicitly, e.g. "walk me through this
  dataset in Python", "build an analysis of X", or "make an interactive chart of Y". The
  skill knows the runtime's display helpers (display, display_html, display_plotly), how
  output ordering works, which Pyodide packages are available vs. need %pip, the exact
  markdown features that render, and how to make charts that actually communicate.
---

# Authoring great in-browser Python notebooks

The target is a rich in-browser Python notebook runtime built on Pyodide (CPython on
WebAssembly): one persistent kernel, Jupyter-style cells, last-expression echo, rich HTML
output, inline matplotlib, `%pip install`, and a small set of `display_*` helpers for
interactive output. (KERNEL is the reference implementation; everything here applies to any
runtime that honors the same contract — see `references/runtime.md`.) Your job is to produce
notebooks that feel like a thoughtful human analyst wrote them — a narrated argument that
happens to be runnable — using exactly the capabilities the runtime has and none it doesn't.
You may be **assembling a finished notebook** in one pass, or **driving a live kernel turn by
turn** with a human watching (see "Working live, in the loop"); the craft below applies to
both, but the live loop has its own discipline.

A great notebook is not a script with comments. It is a sequence of small, rerunnable steps,
each introduced by prose that says what is about to happen and why, followed by code,
followed by an output worth looking at, followed by a sentence interpreting it. The reader
should be able to skim the markdown alone and understand the whole story.

## The workflow

1. **Clarify the goal and the inputs.** What question does the notebook answer? Is the input
   a dataset the user supplied, existing code to convert, a mounted file (via the **+Data**
   button → read from the working directory), or a synthetic dataset you generate? If you
   were given data, inspect its real columns/shape before writing analysis against guessed
   ones. If you were given code, see "Working from existing code or data" below.
2. **Outline the narrative as section headers** before writing any code. A typical arc:
   framing → setup/imports → load & inspect → clean/feature-build → analysis/model →
   visualize → conclusion. Pick the arc that fits; don't pad.
3. **Write the cells.** Alternate markdown and code. Keep each code cell to one idea. End
   cells on the value worth showing (see "Output discipline").
4. **Pressure-test the result before you narrate it.** This is the difference between a
   demo and a real analysis. Before writing confident prose about a finding, confirm the
   finding actually exists: that the model converged, the cascade spread, the correlation is
   real, the clusters separate, the fit tracks the data. If the result is degenerate — a
   simulation that fizzles, an R² near zero, one cluster swallowing everything, a flat curve
   — **change the setup until there is real signal**, then narrate the true result. Never
   write a confident story over noise. If a result genuinely is null, say so plainly and
   show why; a clear negative result is honest, a fake positive is not.
5. **Assemble a valid `.ipynb`** with the bundled script — never hand-write notebook JSON.
   Write a cell spec (a JSON list) and run:
   ```bash
   python scripts/build_notebook.py cells.json output.ipynb "Notebook Title"
   ```
   The script emits nbformat 4.5 the runtime imports cleanly. See the script header for the
   spec format.
6. **Sanity-check the runtime fit.** Re-read every import and chart against
   `references/runtime.md` — no `requests`, no ipywidgets, no LaTeX in markdown, correct
   `%pip` vs. plain import. A notebook that errors on cell 1 is worthless. When you can run
   code, execute the cells in order (with `display_*` stubbed) to catch breakage before
   delivery.

## Working live, in the loop

When you are driving a *running* kernel turn by turn rather than assembling a finished file,
the job is exploratory analysis with a human watching. The rhythm is a loop, not a one-shot:

1. **Propose one coherent step** — a markdown framing cell and the code cell it sets up, not
   ten cells you haven't seen run. Small steps keep you and the human oriented.
2. **Run it and read what comes back.** Outputs return *in execution order* as a mix of:
   stream text (stdout/stderr), **figures as PNG images you can actually see**, rich
   tables/HTML rendered to text, and tracebacks. Look before you leap.
3. **Interpret, then decide the next step from the evidence** — not from what you assumed the
   data would say. Drop a one-sentence takeaway in a markdown cell, then propose the next move.
4. **Loop with the human.** Surface forks ("we could model this two ways…"), pause before
   expensive or destructive steps, and let them redirect. You are a pair-analyst, not an
   autopilot. The pressure-test rule (step 4 of the workflow) still holds: confirm a finding
   is real before you narrate it.

### Reading outputs so you can actually see

You only "see" what a cell emits, so emit deliberately — the output *is* your sensory input:

- **To judge a distribution, shape, fit, or trend, draw it.** A matplotlib / `display_plotly`
  figure comes back to you as an image; that is how you inspect a result visually. If you
  need to see it, plot it — then interpret what the picture shows.
- **To reason over data, summarize it as text:** `df.head()`, `df.describe()`, `df.dtypes`,
  `value_counts()`, `df.shape`. **Never end a cell on a 10,000-row frame** — the whole thing
  streams back into your context and tells you little; a 10-row head tells you more.
- **Read tracebacks and repair the cell** before continuing. A run that errors and barrels
  onward is worse than one that stops and fixes itself.
- **Build on persistent state.** The kernel keeps everything in scope across cells (the
  Variables panel shows what's live) — reuse a frame you built three steps ago instead of
  recomputing it, and inspect an unfamiliar object before you assume its shape.

## Working from existing code or data

Often the input is not a blank prompt but **existing workbench code** or **a dataset** that
should become a notebook. Do not dump it into one cell. Convert it into a narrated notebook:

- **Read it for intent first.** Identify the steps the code performs (load, transform,
  model, plot) and the story the data tells. The notebook's structure should follow that
  intent, not the original line order.
- **Split into rerunnable steps**, one idea per cell, in the section arc above. Hoist
  imports to a single early cell. Pull magic numbers into named constants.
- **Add the narration the code lacks**: a framing cell, a sentence of setup before each
  step, and a takeaway after each result. This is most of the value you add.
- **Upgrade the outputs to the runtime.** Replace `print(df)` with a rendered DataFrame;
  turn a static chart into `display_plotly` when interactivity helps; typeset equations with
  `$…$` / `$$…$$` (KaTeX) and make a pipeline or state machine legible with a ```mermaid
  diagram instead of a paragraph describing it.
- **Preserve behavior.** Don't silently change logic or results while restructuring; if you
  fix a real bug, call it out in prose.

## Structure that reads well

- **Open with a title cell**: an `#` H1, one or two sentences of framing, and a short
  bulleted list of what the reader will see. No code yet.
- **One imports cell, early.** Group all imports there so first-run package loading happens
  once and later cells are fast. Set display options here too (`pd.set_option`, a seeded
  `np.random.default_rng`, matplotlib style).
- **Section by section**: each analytical step gets a `##`/`###` header, 1–3 sentences of
  setup, the code, and then — crucially — a sentence of *takeaway* after the output. The
  takeaway is what separates a notebook from a transcript.
- **Close with a conclusion cell** that states what was found, the caveats, and one or two
  next steps. This is the part readers remember.

### The rhythm, concretely

Three consecutive cells showing the markdown → code → takeaway beat:

> **(markdown)** `## 2. Does engagement predict retention?` <br>
> We regress 30-day retention on first-week engagement, controlling for cohort size.
>
> **(code)** ```...fit model...; coef_table``` &nbsp;(cell ends on the rich table, not `print`)
>
> **(markdown)** Engagement is the dominant signal (β = 0.41, p < 0.001); cohort size
> barely matters once it's included — so onboarding, not scale, is the lever.

Every section repeats that beat. No orphan code cells, no walls of prose.

## Output discipline (this is where ordering matters)

The runtime builds each cell's output as a single ordered stream: prints, figures,
`display_*` calls, and the cell's final value appear in the exact order they were produced.
Use that.

- **Let the last expression render.** End a cell on `df.head()`, a `Series`, a metrics
  table, or a fitted-model summary — the runtime shows its rich `_repr_html_` (DataFrames
  become real tables). Do **not** wrap it in `print()`, which collapses it to plain text.
- **`print()` for narration of values mid-cell** (shapes, counts, chosen parameters); the
  rich result for the headline object at the end.
- **`display(a, b, c)`** when you need to show several objects in order within one cell.
- **Figures auto-display.** Just build the figure; it's captured inline. `plt.show()` is
  optional and harmless — figures created before the final value appear before it.
- A cell that both plots and returns a table renders **plot then table**, matching execution
  order — put the plot code before the final expression if that's the order you want.

## Visualization

Default to **static matplotlib** for clarity and print-fidelity; reach for **interactive**
when hovering, zooming, or panning genuinely helps the reader explore.

- Every chart: a title, axis labels **with units**, a legend when there is more than one
  series, a sensible `figsize`, and `fig.tight_layout()`. A chart without labels is a
  failure regardless of how pretty it is.
- One idea per chart. If you're tempted to put five series on one axis, ask whether two
  small-multiples would read better.
- **Interactive Plotly** is a one-liner: `%pip install plotly` once, then
  `display_plotly(fig, height=520)` — a fully interactive chart (zoom, pan, hover, lasso) in
  a sandboxed frame.
- **Custom interactive HTML/JS** (d3, a hand-built widget, a Bokeh/Altair export):
  `display_html(html_string, height=520)` drops trusted HTML into a sandboxed iframe.
- See `references/chartsmanship.md` for concrete recipes, a matplotlib house style, and the
  Plotly / `display_html` patterns.

## Code craftsmanship

- Idiomatic, readable Python: clear names, small functions, vectorized pandas/numpy over
  Python loops. A notebook is read more than it is run.
- Seed every random process (`np.random.default_rng(SEED)`) so the narrative is reproducible
  across reruns.
- Comment the *why*, not the *what*. The prose cell already said what; the comment explains a
  non-obvious choice.
- Prefer composing state across cells (the kernel is persistent) over recomputing — but keep
  each cell independently rerunnable given the cells above it.

## Hard runtime facts (do not violate)

These come from how the Pyodide runtime actually behaves. Full detail in
`references/runtime.md`.

- **Bundled scientific stack — just `import`:** numpy, pandas, scipy, scikit-learn,
  matplotlib, sympy, networkx, statsmodels, Pillow, beautifulsoup4, lxml, regex. The runtime
  auto-loads these on first import (the heavy ones — scipy/sklearn/statsmodels — take a
  moment the first time).
- **Pure-Python extras — `%pip install <name>` first:** e.g. plotly, altair, humanize.
  micropip pulls them from PyPI.
- **Will NOT work:** `requests` and raw sockets/threads/`subprocess` (no real OS/network
  layer); ipywidgets and `%matplotlib widget` (no widget comm — use `display_html` /
  `display_plotly` instead); any C-extension package Pyodide hasn't built (torch, tensorflow,
  polars, etc.).
- **Markdown renders:** headings, **flat** bullet/numbered lists, GFM tables, blockquotes,
  fenced code (Python is syntax-highlighted), inline
  `code`/**bold**/*italic*/~~strike~~/links/images, **LaTeX math via KaTeX** (`$…$` inline,
  `$$…$$` display), and **Mermaid diagrams** inside a ```mermaid fenced block. It does **NOT**
  nest lists. Use `$…$` / `$$…$$` freely for equations, and reach for ```mermaid for
  flowcharts, sequence/state/ER diagrams, and pipeline schematics. (Reserve matplotlib
  mathtext for labels *inside* a chart, where KaTeX can't reach — use `\frac`, not `\dfrac`,
  there.)
- **Data files** mounted via **+Data** land in the working directory; read them with
  `open("name")` / `pd.read_csv("name")`.

## Anti-patterns (rewrite if you catch these)

- One giant cell doing everything → split into rerunnable steps.
- `print(df)` for a DataFrame → end the cell on the DataFrame so it renders as a table.
- A chart with no title/labels → add them; state units.
- Narrating a result you never checked → a fizzled sim or near-zero R² dressed up as a
  finding. Pressure-test first; fix the setup or report the null honestly.
- `import requests` / network calls that assume a server → generate or mount the data.
- `$\sum_i x_i$` rendered as a matplotlib *figure* when the markdown cell would typeset it →
  use `$…$` / `$$…$$` directly; reserve mathtext for labels inside a chart.
- Walls of markdown with no code, or walls of code with no narration → alternate.
- Skipping the takeaway sentence after a result → always interpret what was just shown.

## Reference files

- `references/runtime.md` — the full runtime/Pyodide contract: display helpers (exact
  signatures), output ordering, the `%pip` vs import rule, package availability, the markdown
  feature matrix, and gotchas.
- `references/chartsmanship.md` — a matplotlib house style, small-multiples and twin-axis
  recipes, the `display_plotly` and `display_html` patterns with complete examples, and how
  to choose static vs. interactive.
- `scripts/build_notebook.py` — assembles a valid nbformat 4.5 `.ipynb` from a JSON cell
  spec. Always build notebooks with this rather than emitting JSON by hand.
