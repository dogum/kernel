# KERNEL

A complete Python notebook that runs entirely in your browser, from **one self-contained HTML file**. Pyodide under the hood — no install, no build step, no server, and nothing leaves your machine.

**[→ Launch it / see it live](https://dogum.github.io/kernel/)**

This repo bundles a few things that belong together:

1. **KERNEL** — the notebook itself (`docs/kernel.html`): a single HTML file you can open, host, or fork.
2. **`kernel-notebooks`** — a Claude skill for authoring exceptional notebooks *for this runtime*.
3. **KERNEL Agent v2** — a multi-provider, human-in-the-loop agent that builds notebooks from natural language (`docs/kernel-agent.html`; architecture in [`AGENT-V2-SPEC.md`](AGENT-V2-SPEC.md)).
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
AGENT-SPEC.md ............. original Anthropic-only agent specification
AGENT-V2-SPEC.md .......... provider, thread, context and workspace architecture
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
scripts/
└── sync_agent_builds.mjs ..... syncs the shared desktop/mobile runtime
tests/
└── verify_agent_v2.mjs ....... syntax, parity, contract and ZIP checks
```

`SKILL.md` is the entry point and is always in context when the skill triggers; the references are pulled in only when relevant.

## KERNEL Agent v2

KERNEL Agent turns the notebook into an exploratory-analysis workbench: you describe what you want, and an agent writes the markdown and code cells, runs them, **sees** the results (text *and* figures), and iterates with you in the loop. It is a client-only, bring-your-own-key design with first-class adapters for Anthropic, OpenAI, and xAI/Grok. Keys remain in browser storage and requests go directly to the API base you select.

Launch it from the [live page](https://dogum.github.io/kernel/) or open [`docs/kernel-agent.html`](docs/kernel-agent.html). [`AGENT-V2-SPEC.md`](AGENT-V2-SPEC.md) records the provider contract, persistence model, compaction rules, migration behavior, and acceptance gates; [`AGENT-SPEC.md`](AGENT-SPEC.md) remains the historical v1 design and tool-contract background.

What it does today, beyond the core loop:

- **Provider parity** — Anthropic uses the native Messages API; OpenAI and xAI use the Responses API with the same KERNEL tool loop, multimodal results, stop behavior, and token accounting. Responses calls set `store: false`, and OpenAI reasoning continuation items are preserved locally.
- **Live Markdown transcript** — narration streams token-by-token and renders headings, tables, code, math, and Mermaid when complete. Reasoning summaries use a separate progressive-disclosure panel; tool calls remain compact, click-to-cell action chips.
- **Multiple threads per notebook** — create, rename, switch, or delete independent threads without mixing notebooks. Full messages and transcripts live in IndexedDB rather than a size-capped localStorage string.
- **Conversations that persist and travel** — `.ipynb` remains a standard notebook and embeds the active thread for compatibility. One-click `.kernel.zip` export carries the notebook, rendered outputs, every thread, uploaded inputs, promoted results, and active selection; open the ZIP on another device to resume. API keys are deliberately excluded.
- **Multimodal input** — paste or drag images into the chat (sketch a chart, screenshot a figure); the agent sees them.
- **Explicit context accounting** — input, output, cache, and reasoning token counters are exposed. Context limits come from provider model discovery when available, with editable conservative fallbacks. At the configured threshold, only the active API payload is checkpointed and compacted; the full local thread is never deleted.
- **Forking** — hover any of your messages and press ⑂ to branch the conversation into a duplicated notebook; the original thread stays intact.
- **Notebook-isolated workspaces** — stable cell IDs, outputs, user uploads, and agent results are restored only with their notebook. Switching notebooks snapshots state and resets the Python namespace so data cannot leak across workspaces.
- **Faster output and variable surfaces** — inline/panel output changes move existing DOM nodes instead of rebuilding rich output; the variable panel adds deterministic name/type/memory sorting and explicit refresh.
- **Autonomy modes** — AUTO runs free with a Stop button; STEP gates execution behind Approve/Skip. Every cell has an *ai* button that drops a stable cell reference into the composer.

Provider model discovery is available from settings. Custom API base URLs are supported for compatible gateways; if a provider blocks direct browser CORS, use a gateway you control and trust.

## Mobile / PWA (KERNEL·M)

`docs/kernel-agent-mobile.html` is a phone-friendly build of the Agent. The desktop layout is rebuilt as a single column: the notebook fills the screen and the Agent, Files and Variables panels become bottom sheets driven by a bottom navigation bar (swipe a sheet down to dismiss). It's also a Progressive Web App — installable to the home screen with its own icon, running standalone, and (served over https) caching the app shell and the Pyodide runtime through a service worker so it keeps working offline after the first load. It shares everything else with the Agent, including bring-your-own-key.

Open it from the [live page](https://dogum.github.io/kernel/) or [`docs/kernel-agent-mobile.html`](docs/kernel-agent-mobile.html). Install and offline need https (GitHub Pages provides it); opening the raw file over `file://` gives the responsive layout but not the service worker.

## Privacy

The notebook is fully client-side: Python runs in your browser, and your code and data never leave the page unless you use the agent. The agent sends the active prompt, notebook state, and relevant outputs directly to the provider/API base you select (Anthropic, OpenAI, xAI, or a compatible gateway) using a key stored in this browser. Responses requests explicitly disable provider-side response storage where the protocol supports it. Workspace ZIPs never include API keys.

## License

Apache 2.0. See [`LICENSE`](LICENSE).
