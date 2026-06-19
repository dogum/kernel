# KERNEL

A complete Python notebook that runs entirely in your browser, from **one self-contained HTML file**. Pyodide under the hood — no install, no build step, no server, and nothing leaves your machine.

**[→ Launch it / see it live](https://dogum.github.io/kernel/)**

This repo bundles a few things that belong together:

1. **KERNEL** — the notebook itself (`docs/kernel.html`): a single HTML file you can open, host, or fork.
2. **`kernel-notebooks`** — a Claude skill for authoring exceptional notebooks *for this runtime*.
3. **KERNEL Agent** — a human-in-the-loop agent that builds notebooks from natural language (`docs/kernel-agent.html`; design in [`AGENT-SPEC.md`](AGENT-SPEC.md)).
4. **KERNEL·M** — a mobile / PWA build of the Agent (`docs/kernel-agent-mobile.html`): touch-friendly, installable to the home screen, and offline-capable.

## What KERNEL is

Open `kernel.html` and you have a working kernel: write Python and markdown cells, run them in execution order, and get back stdout, plots, interactive Plotly, rendered DataFrames, KaTeX math, and Mermaid diagrams. It includes a data workspace (drop in CSVs and files, preview them, insert a read snippet), a live variable inspector with click-to-expand detail, a composable panel layout that collapses back to a calm centered notebook, `.ipynb` round-trip, `.py` export, and local persistence.

It's client-only by design. The Python executes in your tab via Pyodide/WebAssembly; your data stays in the page. The only network it needs is the one-time Pyodide download (CDN, ~10 MB, cached after) and the CDN fonts.

## Install

### The notebook

There's nothing to install — it's one file.

- **Use it now:** open the [live page](https://dogum.github.io/kernel/) and click *Launch KERNEL*.
- **Run it locally:** download [`docs/kernel.html`](docs/kernel.html) and open it in a browser.
- **Host it yourself:** drop the file on any static host (it's already served from `/docs` via GitHub Pages here).

### The skill

**Claude.ai** — download [`kernel-notebooks.skill`](kernel-notebooks.skill) (or grab it from the latest Release), then Settings → Capabilities → Skills → upload.

**Claude Code** — copy the `skill/` folder into your skills directory:

```bash
git clone https://github.com/dogum/kernel.git
cp -r kernel/skill ~/.claude/skills/kernel-notebooks
```

The folder containing `SKILL.md` is what Claude Code loads.

**Anthropic API** — skills can be deployed org-wide via the API; see the [Claude docs](https://docs.claude.com).

## How it's structured

```
kernel.html ............... lives in docs/ (served live on GitHub Pages)
kernel-notebooks.skill .... packaged skill, ready to upload to Claude.ai
AGENT-SPEC.md ............. implementation spec for the agentic build
skill/
├── SKILL.md .............. runtime contract, the live-in-the-loop + multimodal sections,
│                           narrative craft, output discipline
├── references/
│   ├── runtime.md ........ the hard runtime facts (display helpers, ordered output,
│   │                       %pip vs import, the markdown feature matrix incl. KaTeX/Mermaid)
│   └── chartsmanship.md .. matplotlib house style, static vs interactive
└── scripts/
    └── build_notebook.py . assembles a valid .ipynb from a JSON cell spec
docs/
├── index.html ................. the landing / launch page
├── kernel.html ................ the notebook
├── kernel-agent.html .......... the agentic notebook (bring your own key)
├── kernel-agent-mobile.html ... the mobile / PWA build of the agent
├── kernel-agent-sw.js ......... service worker (offline cache for the PWA)
└── .nojekyll
```

`SKILL.md` is the entry point and is always in context when the skill triggers; the references are pulled in only when relevant.

## The agentic version

KERNEL Agent turns the notebook into an exploratory-analysis workbench: you describe what you want, and an agent writes the markdown and code cells, runs them, **sees** the results (text *and* figures) and iterates — with you in the loop to steer. It's a client-only, bring-your-own-key design (the key lives in your browser and is sent only to Anthropic), and its system prompt is the `kernel-notebooks` skill in this repo.

It's here. Launch it from the [live page](https://dogum.github.io/kernel/) or open [`docs/kernel-agent.html`](docs/kernel-agent.html). The full design (the agent loop, the tool contract that binds to KERNEL's real functions, how outputs including base64 figures are marshaled back so the model can see, context management, the UI, and the build phasing) is written up in [`AGENT-SPEC.md`](AGENT-SPEC.md).

What it does today, beyond the core loop:

- **Streaming transcript** — narration arrives token-by-token, with every tool call logged as a compact action chip that click-scrolls to its cell.
- **Conversations that persist and travel** — the full agent context survives reloads per notebook, and *saving the `.ipynb` embeds the conversation in the notebook's metadata*: open the file anywhere and pick the thread back up. The transcript also exports as standalone markdown.
- **Multimodal input** — paste or drag images into the chat (sketch a chart, screenshot a figure); the agent sees them.
- **Token/cost meter** — live in/out token counts and an estimated cost per notebook; the context ceiling is read from Anthropic's Models API for whatever model id you're running, and long sessions self-compact to fit the window.
- **Forking** — hover any of your messages and press ⑂ to branch the conversation into a duplicated notebook; the original thread stays intact.
- **Promote results** — a `save_data_file` tool publishes computed tables into the Data panel (and every data file has a *save* action to download it locally); `set_notebook_name` keeps notebooks titled.
- **Autonomy modes** — AUTO runs free with a Stop button; STEP gates every execution behind Approve/Skip. A model chip switches Sonnet ↔ Opus mid-session, and every cell has an *ai* button that drops it into the agent's composer.

It's a client-only, bring-your-own-key design — the key lives in your browser and is sent only to Anthropic — and its system prompt is the `kernel-notebooks` skill in this repo.

## Mobile / PWA (KERNEL·M)

`docs/kernel-agent-mobile.html` is a phone-friendly build of the Agent. The desktop layout is rebuilt as a single column: the notebook fills the screen and the Agent, Files and Variables panels become bottom sheets driven by a bottom navigation bar (swipe a sheet down to dismiss). It's also a Progressive Web App — installable to the home screen with its own icon, running standalone, and (served over https) caching the app shell and the Pyodide runtime through a service worker so it keeps working offline after the first load. It shares everything else with the Agent, including bring-your-own-key.

Open it from the [live page](https://dogum.github.io/kernel/) or [`docs/kernel-agent-mobile.html`](docs/kernel-agent-mobile.html). Install and offline need https (GitHub Pages provides it); opening the raw file over `file://` gives the responsive layout but not the service worker.

## Privacy

The notebook is fully client-side: Python runs in your browser, and your code and data never leave the page (aside from the one-time Pyodide and font downloads from CDN). The agent, when present, sends your prompts, notebook contents, and outputs only to the Anthropic API using a key you provide and that stays in your browser's local storage.

## License

Apache 2.0. See [`LICENSE`](LICENSE).
