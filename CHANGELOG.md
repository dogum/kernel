# Changelog

Notable changes to KERNEL, KERNEL·A (the agent), and KERNEL·M (the phone build). Versions follow [semantic versioning](https://semver.org/); the current one is `version` in `package.json`.

## [Unreleased]

### For contributors
- The agent pages are built from `src/` by `scripts/build.mjs`. The code is split into about 60 files: notebook, agent, startup, and mobile JavaScript, CSS, shared markup, and the Python harness as a real `.py` file. The build still produces one self-contained HTML file per page.
- The source is formatted with Prettier. Checking every file's syntax tree before and after showed the formatting changed no code.
- Tests read the app through a JavaScript parser (`tests/lib/source.mjs`) instead of regexes, so formatting can't break them.
- `npm run build | check | format | test | test:e2e`, plus a CONTRIBUTING guide, issue templates, and a release workflow.
- The version lives in `package.json` and is filled in at build time.

## [2.4.0] - 2026-09-28

### Agent
- Prompts are stable enough for the provider to cache them: the system prompt and tools never change within a thread, and live notebook state goes in an append-only block on the newest message.
- Budgets count effective tokens: cache reads cost about a tenth.
- `add_cells` and `edit_cell` take `run: true`, so writing a cell and seeing its output is one tool call.
- Rate limits, overloads, dropped or stalled streams, and truncated responses retry automatically.
- Claude Opus 5.5 is the default, with adaptive thinking, effort control, and server-side fallbacks.

### Notebook
- Python runs in a Web Worker, so a runaway cell never freezes the page. Interrupt it from the toolbar or with `i i`.
- Files are stored once by content hash, so checkpoints and ZIP exports no longer duplicate them.
- Undo instead of dialogs: deleting a cell, a variable, or a file, and clearing outputs, show an Undo toast. `z` restores the last deleted cell.
- A first-run card with a sample dataset. Files dropped anywhere on the page are mounted. One-click head, describe, missing values, correlations, value counts, and histograms from the variable inspector. Tables copy as TSV or download as CSV, and figures download as PNG.
- Errors offer *Fix with agent*, and tracebacks name the cell (`Cell 4, line 1`).
- The KERNEL wordmark opens the app menu (other KERNEL apps, project page, theme), replacing the floating dock.
- On phones, sheets clear the tab bar, SEND stays visible, and the cell toolbar no longer covers code.

### Docs
- Four curated real-world agent runs in `examples/`.

## [2.3.1] - 2026-09-03
- Completion-safe autonomy: a run that used tools must finish its visible plan and pass the `finish_run` evidence check, so a model that simply stops calling tools can't claim success.

## [2.3.0] - 2026-09-03
- Durable runs with checkpoints, pause and resume, and recovery after reload. Cell and file lineage with stale-output detection. An artifact workspace. Exact checkpoints and forks. Portable `.kernel.zip` handoff. See [`AGENT-V23-SPEC.md`](AGENT-V23-SPEC.md).

## [2.0.0] - 2026-09-03
- KERNEL Agent v2: Anthropic, OpenAI, and xAI adapters, several threads per notebook, and portable workspaces. See [`AGENT-V2-SPEC.md`](AGENT-V2-SPEC.md).

## 2026-06-19
- KERNEL·M, the agent as an installable, offline-capable phone app.

## [0.1.0] - 2026-06-07
- KERNEL, a Python notebook in one HTML file, with the `kernel-notebooks` Claude skill and the GitHub Pages site.
