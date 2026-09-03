# KERNEL

A complete Python notebook that runs entirely in your browser, from **one self-contained HTML file**. Pyodide under the hood — no install, no build step, no server, and nothing leaves your machine.

**[→ Launch it / see it live](https://dogum.github.io/kernel/)**

This repo bundles a few things that belong together:

1. **KERNEL** — the notebook itself (`docs/kernel.html`): a single HTML file you can open, host, or fork.
2. **`kernel-notebooks`** — a Claude skill for authoring exceptional notebooks *for this runtime*.
3. **KERNEL Agent v2.3.1** — a durable, multi-provider notebook agent that can plan, execute, recover, compare models, and carry a complete workspace between devices (`docs/kernel-agent.html`; architecture in [`AGENT-V23-SPEC.md`](AGENT-V23-SPEC.md)).
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
AGENT-V23-SPEC.md ......... durable runs, lineage, artifacts and handoff architecture
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
├── verify_agent_v2.mjs ....... provider compatibility and v2 regression checks
└── verify_agent_v23.mjs ...... durability, lineage, safety and handoff checks
```

`SKILL.md` is the entry point and is always in context when the skill triggers; the references are pulled in only when relevant.

## KERNEL Agent v2.3.1

KERNEL Agent turns the notebook into an exploratory-analysis workbench: you describe what you want, and an agent writes the markdown and code cells, runs them, **sees** the results (text *and* figures), and iterates with you in the loop. It is a client-only, bring-your-own-key design with first-class adapters for Anthropic, OpenAI, and xAI/Grok. Keys remain in browser storage and requests go directly to the API base you select.

Launch it from the [live page](https://dogum.github.io/kernel/) or open [`docs/kernel-agent.html`](docs/kernel-agent.html). [`AGENT-V23-SPEC.md`](AGENT-V23-SPEC.md) is the current release contract. [`AGENT-V2-SPEC.md`](AGENT-V2-SPEC.md) records the provider/thread foundation, and [`AGENT-SPEC.md`](AGENT-SPEC.md) remains the historical v1 design and tool-contract background.

What it does today, beyond the core loop:

- **Provider parity** — Anthropic uses the native Messages API; OpenAI and xAI use the Responses API with the same KERNEL tool loop, multimodal results, stop behavior, and token accounting. Responses calls set `store: false`, and encrypted reasoning continuation items are preserved locally when returned.
- **Live Markdown transcript** — narration streams token-by-token and renders headings, tables, code, math, and Mermaid when complete. Reasoning summaries use a separate progressive-disclosure panel; tool calls remain compact, click-to-cell action chips.
- **Multiple threads per notebook** — create, rename, switch, or delete independent threads without mixing notebooks. Full messages and transcripts live in IndexedDB rather than a size-capped localStorage string.
- **Durable runs and recovery** — every request has a persisted run, phase, event timeline, visible plan, token/tool/time budgets, safe pause/resume, and recovery after reload. An ambiguous interrupted mutation is never silently repeated.
- **Completion-safe autonomy** — a tool-using or planned run must complete its visible plan and pass the `finish_run` evidence contract. A provider merely stopping tool calls cannot create a false success; AUTO extends tool/time checkpoints only while durable progress continues, while the token budget remains a hard cost boundary.
- **Notebook intelligence** — KERNEL tracks conservative Python dependencies, cell/file/environment provenance, and `fresh`, `stale`, or `historical` output state. Structured tracebacks navigate back to the exact cell and source line.
- **Artifact workspace** — uploads, working files, and final results have stable IDs, safe folder paths, previews, lifecycle controls, provenance, and notebook isolation. Folder upload preserves relative paths and collisions never silently overwrite data.
- **Exact checkpoints and forks** — runs checkpoint notebook cells, rendered outputs, artifacts, environment, and thread state. Restore in place or fork a new notebook from that exact point without changing the source.
- **Conversations that persist and travel** — one-click `.kernel.zip` export carries the notebook, outputs, all threads, artifacts, durable runs, usage, environment, and checkpoints; open it elsewhere to resume. A separate share-safe ZIP strips chat/run history and inputs, scans copied text, and includes approved final results only.
- **Compact private run handoff** — a checkpoint-free `.kernel-run.zip` preserves the current notebook, outputs, artifacts, complete threads, and run ledgers for debugging or review without repeatedly embedding every historical checkpoint. It remains private and unredacted.
- **Multimodal input** — paste or drag images into the chat (sketch a chart, screenshot a figure); the agent sees them.
- **Explicit context control** — input, output, cache, and reasoning tokens are exposed. Pin or exclude cells and artifacts; large results use bounded handles; compaction changes only the active API payload, never the full local thread. When shared runtime state cannot be isolated safely, agent execution/inspection stops rather than bypass an exclusion; human cell controls remain available.
- **Read-only model comparison** — send the same notebook-grounded prompt to up to six configured provider/model profiles and compare answers, latency, and reported token use without giving contenders mutation tools.
- **Notebook-isolated workspaces** — stable cell IDs, outputs, user uploads, and agent results are restored only with their notebook. Switching notebooks snapshots state and resets the Python namespace so data cannot leak across workspaces.
- **Faster output and variable surfaces** — inline/panel output changes move existing DOM nodes instead of rebuilding rich output; the variable panel adds deterministic name/type/memory sorting and explicit refresh.
- **Autonomy modes** — AUTO runs free with a Stop button; STEP gates execution behind Approve/Skip. Every cell has an *ai* button that drops a stable cell reference into the composer.
- **Redacted diagnostics** — export an allowlisted support bundle with versions, counters, and sanitized run events, never prompts, source, file contents, tool payloads, or provider credentials.

Provider model discovery is available from settings. Custom API base URLs are supported for compatible gateways; if a provider blocks direct browser CORS, use a gateway you control and trust.

Release checks:

```bash
node scripts/sync_agent_builds.mjs --check
node tests/verify_agent_v2.mjs
node tests/verify_agent_v23.mjs
```

## Mobile / PWA (KERNEL·M)

`docs/kernel-agent-mobile.html` is a phone-friendly build of the Agent. The desktop layout is rebuilt as a single column: the notebook fills the screen and the Agent, Files and Variables panels become bottom sheets driven by a bottom navigation bar (swipe a sheet down to dismiss). It's also a Progressive Web App — installable to the home screen with its own icon, running standalone, and (served over https) caching the app shell and the Pyodide runtime through a service worker so it keeps working offline after the first load. It shares everything else with the Agent, including bring-your-own-key.

Open it from the [live page](https://dogum.github.io/kernel/) or [`docs/kernel-agent-mobile.html`](docs/kernel-agent-mobile.html). Install and offline need https (GitHub Pages provides it); opening the raw file over `file://` gives the responsive layout but not the service worker.

## Privacy

The notebook is fully client-side: Python runs in your browser, and your code and data never leave the page unless you use the agent. The agent sends the selected active context directly to the provider/API base you choose (Anthropic, OpenAI, xAI, or a compatible gateway) using a key stored in this browser. Responses requests explicitly disable provider-side response storage where the protocol supports it. Exports never serialize provider configuration or stored keys; because a full workspace is intentionally lossless, user-authored prompts/cells/files are preserved verbatim. Inspect a share-safe archive's redaction report before redistributing it.

## License

Apache 2.0. See [`LICENSE`](LICENSE).
