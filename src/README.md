# src/

The source of the two agent pages. `node scripts/build.mjs` assembles them into single self-contained files:

| Template | Builds |
|---|---|
| `agent/desktop.html` | `docs/kernel-agent.html` |
| `agent/mobile.html` | `docs/kernel-agent-mobile.html` |

Edit files here, never the built pages. After editing, `npm run format` formats the JavaScript with Prettier and rebuilds; `npm run check` (also run by CI) fails if `docs/` is out of date or the source is not formatted.

## How the pieces fit

- **Templates** are the pages' HTML. A line `<!-- @include path -->` is replaced by that file (paths are relative to `src/`, and `*` includes every match in name order).
- **JavaScript** in `agent/js/` is concatenated, in folder and then file-name order, into one `(function(){ … })()` on the page. Every file shares that one scope: a function defined in `notebook/` is visible in `agent/`, and there are no imports or exports. The number in a file name is its position; pick a number between two neighbours for a new file.
  - `notebook/`: cells, the markdown and syntax renderers, execution, the Pyodide worker, files, workspaces and storage, ZIPs, the notebook library, panels, keyboard, autocomplete, the variable inspector, find and replace.
  - `agent/`: the agent. Runs and checkpoints, threads, tools and their executor, the system prompt, context budgeting, provider wire formats, the loop, settings, and the composer.
  - `app/`: theme changes and startup (`init` runs last).
  - `mobile/`: the phone controller (bottom sheets, tab bar) and the PWA layer. Only the mobile template includes them.
- **Python** in `agent/python/harness.py` runs inside Pyodide at boot. It reaches the page through `/*@embed agent/python/harness.py*/` in `agent/js/notebook/020-harness.js`, and the build escapes it for the JavaScript string, so write plain Python.
- **CSS** in `agent/css/`: `base.css` (notebook), `layout.css` (panels), `agent.css` (agent panel and shared UI), plus `desktop.css` and `mobile.css`, which only their own page includes.
- **Markup** in `agent/markup/` is shared by both templates (the agent panel and the agent modals).
- **suite/** holds the design tokens and the app menu (the KERNEL wordmark) used across the KERNEL pages.
- **Version**: `%VERSION%` anywhere in `src/` becomes `version` from `package.json`; code reads it as `APP_VERSION`.

`docs/kernel.html` (the notebook without the agent) and `docs/index.html` are still edited directly.
