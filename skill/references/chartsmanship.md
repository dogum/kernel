# Chartsmanship for KERNEL notebooks

How to make charts that communicate, using only what the runtime supports. Default to
static matplotlib; use interactive Plotly / `display_html` when exploration genuinely
benefits the reader.

## Table of contents
1. The non-negotiables
2. A matplotlib house style
3. Recipes: line, small multiples, twin axis, distribution
4. Equations in figures (mathtext)
5. Interactive Plotly (`display_plotly`)
6. Custom interactive HTML (`display_html`)
7. Choosing static vs. interactive

## 1. The non-negotiables

Every chart, without exception:
- has a **title** that states the takeaway, not just the variables;
- labels **both axes, with units**;
- has a **legend** when there is more than one series;
- uses a deliberate `figsize` and ends with `fig.tight_layout()`;
- shows **one idea**. If two ideas, use two charts (small multiples).

A beautiful chart with no labels is a failed chart. Labels first, polish second.

## 2. A matplotlib house style

Set this once in the imports cell; it lifts every later figure:

```python
import matplotlib.pyplot as plt

plt.rcParams.update({
    "figure.figsize": (9, 5),
    "figure.dpi": 110,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.grid": True,
    "grid.alpha": 0.25,
    "axes.titlesize": 13,
    "axes.titleweight": "bold",
    "axes.labelsize": 11,
    "legend.frameon": False,
    "font.size": 11,
})
```

Then per figure, prefer the object-oriented API (`fig, ax = plt.subplots()`) over the
stateful `plt.` calls — it scales to multi-panel figures and is easier to read.

## 3. Recipes

**Line chart with a clear takeaway title:**
```python
fig, ax = plt.subplots()
ax.plot(daily.index, daily["algae"], label="algae")
ax.plot(daily.index, daily["grazers"], label="grazers")
ax.set_title("Grazer blooms lag algae blooms by ~6 days")
ax.set_xlabel("date"); ax.set_ylabel("population (individuals / m²)")
ax.legend()
fig.tight_layout()
```

**Small multiples** (preferred over cramming series onto one axis):
```python
fig, axes = plt.subplots(1, 3, figsize=(12, 4), sharex=True)
for ax, col in zip(axes, ["algae", "grazers", "predators"]):
    ax.plot(daily.index, daily[col])
    ax.set_title(col); ax.set_xlabel("date")
axes[0].set_ylabel("population")
fig.suptitle("Three trophic levels, same time axis", y=1.02, fontweight="bold")
fig.tight_layout()
```

**Twin axis** (only when the two series share an x but differ wildly in scale; label both
y-axes and merge the legends):
```python
fig, ax = plt.subplots()
ax.plot(t, population, label="population")
ax2 = ax.twinx()
ax2.plot(t, storminess, "--", alpha=0.6, label="storminess")
ax.set_xlabel("day"); ax.set_ylabel("population"); ax2.set_ylabel("storm index")
l1, lab1 = ax.get_legend_handles_labels()
l2, lab2 = ax2.get_legend_handles_labels()
ax.legend(l1 + l2, lab1 + lab2, loc="upper right")
fig.tight_layout()
```

**Distribution** with a reference line and its meaning called out:
```python
fig, ax = plt.subplots(figsize=(7, 4.2))
ax.hist(residuals, bins=24)
ax.axvline(0, ls="--", label="zero error")
ax.set_title("Forecast residuals are roughly centered on zero")
ax.set_xlabel("actual − predicted"); ax.set_ylabel("count")
ax.legend()
fig.tight_layout()
```

## 4. Equations in figures (mathtext)

Markdown cells do not render LaTeX, so when an equation belongs in the narrative, draw it:
```python
fig, ax = plt.subplots(figsize=(6, 1.4))
ax.axis("off")
ax.text(0.5, 0.5, r"$\hat{y} = \beta_0 + \sum_{i} \beta_i x_i$",
        ha="center", va="center", fontsize=20)
fig.tight_layout()
```
mathtext supports a large LaTeX subset (Greek, sums, fractions, subscripts/superscripts).
Use `\frac` for fractions — mathtext does **not** support `\dfrac` (and other amsmath-only
commands), which silently fails to render.

## 5. Interactive Plotly (`display_plotly`)

For zoom/pan/hover/lasso exploration. Plotly is pure-Python; install once.

```python
%pip install plotly
import plotly.express as px

fig = px.scatter(
    df, x="x", y="y", color="cluster",
    hover_data=["signal"], title="Clusters in feature space (hover for detail)",
    height=520,
)
fig.update_layout(template="plotly_white", legend_orientation="h")
display_plotly(fig, height=540)
```

Notes:
- `display_plotly` handles the HTML/CDN wiring; you just pass the figure.
- Use `scattergl` (via `px.scatter(..., render_mode="webgl")` or graph_objects
  `go.Scattergl`) for more than a few thousand points.
- Round float arrays before plotting many points to keep the embedded JSON small.
- Set a `title` and axis titles just like matplotlib — interactivity is not a substitute
  for labels.

## 6. Custom interactive HTML (`display_html`)

When you want d3, a hand-built control, or any standalone HTML/JS document. The string is
rendered in a sandboxed iframe (scripts run; no access to the parent page). Load libraries
from a CDN inside the document.

```python
spec = {"points": df[["x", "y"]].round(3).to_dict("records")}
html = """<!doctype html><html><head><meta charset="utf-8">
<script src="https://d3js.org/d3.v7.min.js"></script>
<style>html,body{margin:0;font-family:system-ui}</style></head>
<body><svg id="c" width="100%" height="100%"></svg>
<script>
  const data = __DATA__;
  // ... d3 code drawing into #c ...
</script></body></html>""".replace("__DATA__", json.dumps(spec))
display_html(html, height=560)
```

Patterns that work well through `display_html`:
- Plotly built by hand (when you want full control over the figure JSON).
- Bokeh or Altair exported to standalone HTML (`altair` chart → `chart.to_html()`).
- A small custom dashboard / control that reacts to user input in the frame.

Keep the embedded data modest (round and sample); it is serialized into the notebook.

## 7. Choosing static vs. interactive

- **Static matplotlib** when the chart makes a *point* the reader should absorb at a
  glance, when it will be read in print/PDF, or when there are few series. This is the
  default and usually the right call.
- **Interactive** when the value is in *exploration* — many points to hover, a time series
  to zoom into, clusters to lasso, a surface to rotate. Reach for `display_plotly` first;
  drop to `display_html` only when you need control Plotly doesn't give you.
- Don't make a chart interactive just because you can. Interactivity that adds nothing is
  noise, and it inflates the notebook.
