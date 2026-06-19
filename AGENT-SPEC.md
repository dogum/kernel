# KERNEL Agent — Capstone Specification

> A natural-language, human-in-the-loop agent that builds and explores Python notebooks
> *inside* KERNEL: it writes markdown and code cells, runs them, **sees** the results
> (text **and** images), and iterates — turning KERNEL into an agentic exploratory-analysis
> workbench. This is the design document behind the shipped implementation — §17
> records how it maps to the build.

---

## 1. Goal

Let a person describe an analysis in plain language ("explore this CSV and find what predicts
churn") and have an agent **author the notebook live**: alternating narration (markdown) and
code, executing each step, reading the outputs back to decide the next move, and pausing for
the human to steer. The human and agent share one artifact — the notebook — and both can edit
it. The agent is a **pair-analyst, not an autopilot**.

The behavioral contract for the agent already exists: it's the `kernel-notebooks` skill, whose
"Working live, in the loop" and "Reading outputs so you can actually see" sections were written
to be this agent's system prompt. This spec defines the *machinery* that lets the model in that
skill act on a running KERNEL.

---

## 2. Design principles (fit with KERNEL)

- **Single file, no build.** The agent ships inside `kernel.html` as more JS — no bundler, CDN
  deps only (the Anthropic call is a `fetch`).
- **Composable-panel native.** The agent UI is another dockable panel in the existing system
  (toggle/resize/collapse, persisted in `kernel.ui.v1`). It must collapse back to the calm
  centered notebook like everything else.
- **Quiet, instrument-grade design language.** Transcript and action log use the mono "readout"
  voice, one accent for active state, hairline structure. No chat-bubble gradients.
- **BYO-key, client-only.** The key lives in `localStorage`, the request goes directly to
  `api.anthropic.com` with `anthropic-dangerous-direct-browser-access: true`, and nothing
  touches any intermediary. Same pattern KERNEL already uses for browser API calls.
- **The notebook is the single source of truth.** The agent operates on `cells[]` through the
  same functions a human uses; it never maintains a shadow copy.

---

## 3. Architecture at a glance

```
Human types a request in the Agent panel
        │
        ▼
Build messages = [ system(skill + runtime preamble + notebook outline),
                   ...history,
                   user(request) ]
        │
        ▼
┌──────────────────────────  AGENT LOOP  ──────────────────────────┐
│  POST /v1/messages  (stream, tools enabled)                       │
│      │                                                            │
│      ├─ assistant TEXT  → stream into transcript (narration)      │
│      └─ assistant TOOL_USE → execute against KERNEL:              │
│             add_cells / run_cell / inspect_* / edit_cell / ...    │
│                   │                                               │
│                   ▼                                               │
│           tool_result content blocks                              │
│             • text (stdout, tables, tracebacks — truncated)       │
│             • image (base64 PNG figures — the agent "sees")       │
│      │                                                            │
│      ▼                                                            │
│  append assistant msg + tool_result msg → loop back to POST       │
└───────────────────────────────────────────────────────────────────┘
        │
   loop ends when: assistant returns text with NO tool_use (hands back),
   OR max_steps hit (pause + ask), OR human presses Stop.
        │
        ▼
Human reads, edits cells, types next request → next turn (state refreshed)
```

---

## 4. The agent loop (turn structure)

A **user turn** is one human message → one autonomous run of the loop above.

- The loop alternates `assistant` (text + optional tool_use blocks) and `user` (tool_result
  blocks), exactly per the Anthropic tools protocol.
- **Continue** while the assistant emits `tool_use`. Execute *all* tool_use blocks in a single
  assistant message, return *all* their results in the next `user` message (one tool_result per
  tool_use_id), then call again.
- **Stop the loop** when any of:
  1. The assistant replies with text and **no** tool_use → it's handing back to the human.
  2. `max_steps` reached (default 24 tool calls / turn) → pause, post a "still going — continue?"
     prompt to the human.
  3. Human presses **Stop** → abort after the in-flight tool finishes (never mid-`runCell`).
  4. API error / key invalid → surface in the transcript, halt.
- Between turns the human may edit/run cells manually; the next turn's state snapshot (§7)
  reflects those edits, so the agent stays in sync.

---

## 5. Tool contract (the spine)

Tools are Anthropic tool definitions; each maps to existing KERNEL functions. Cell handles are
KERNEL's `cell.id` strings. All tools are synchronous from the model's view (the loop awaits
KERNEL before returning the result).

### 5.1 `add_cells`
Add one or more cells in order — the normal way the agent proposes a step (a markdown framing
cell + the code cell it sets up).
```jsonc
input: {
  cells: [ { type: "markdown" | "code", source: "string" } ],   // 1..n, in order
  after_cell_id?: "string"        // insert after this cell; omit = append at end
}
```
- Binds to: `insertCell(idx, type, false)` per cell, then set `cell.source`, `paint(cell)`;
  markdown cells are immediately rendered (`showRendered(cell, true)` — so math/Mermaid typeset);
  `schedulePersist()`.
- Does **not** run code cells (keep add and run separate — lets the agent stage then run).
- Returns: `{ added: [ { cell_id, index, type } ] }`.

### 5.2 `run_cell`
Execute one code cell and return its outputs (this is how the agent *sees*).
```jsonc
input: { cell_id: "string" }
```
- Binds to: `await runCell(cell)` (reuses the existing serialized `pyTask` chain, so it can't
  collide with a human-triggered run).
- Returns: tool_result content blocks per §6 (text + images), including exec count, runtime, and
  an error flag.

### 5.3 `run_all` / `run_from`
```jsonc
input: { from_cell_id?: "string" }   // omit = run all from top; stops on first error
```
- Binds to: the existing `runAll` / run-from logic.
- Returns: a compact per-cell summary line for each successful cell (`[n] ok · 1.2s · 2 outputs`)
  and **full** outputs (per §6) only for the final cell and any errored cell — to bound tokens.

### 5.4 `edit_cell`
```jsonc
input: { cell_id: "string", source: "string" }
```
- Binds to: set `cell.source`, update `cell.taEl.value`, `paint(cell)`, `schedulePersist()`.
- Returns: `{ ok: true }`. (Primary use: fix a cell after reading a traceback.)

### 5.5 `read_cell`
Re-read a cell's current source + outputs without re-running (e.g., to look again, or read a
cell the human edited).
```jsonc
input: { cell_id: "string" }
```
- Returns: `{ source }` + outputs as §6 content blocks.

### 5.6 `inspect_namespace`
```jsonc
input: {}
```
- Binds to: `runPy("_inspect_ns()")`. Returns the variable rows (name / type / info / size) as a
  compact text list. Lets the agent see what's in scope before reusing it.

### 5.7 `inspect_variable`
```jsonc
input: { name: "string" }
```
- Binds to: `runPy("_var_detail(__name)")`. Returns the structured detail (DataFrame head +
  dtypes, Series stats, ndarray shape/min/max/mean, dict/list samples, scalar repr) as text —
  so the agent can look closely at data *as text* it can reason over.

### 5.8 `list_data_files`
```jsonc
input: {}
```
- Binds to: the `dataFiles[]` array. Returns name / type / size / a short preview per mounted
  file, so the agent knows what it can read with `pd.read_csv("name")`.

### 5.9 Housekeeping (Phase D+)
`delete_cell { cell_id }`, `move_cell { cell_id, to_index }` → bind to existing cell ops +
`render()`. Optional in v1.

> **Narration is not a tool.** The agent talks to the human via plain assistant **text**, which
> streams into the transcript. Keep it tight (the skill instructs this). The loop ends naturally
> when the assistant produces text without tool_use.

---

## 6. Output marshaling — how the agent "sees"

The whole point. After `run_cell` (or `read_cell`), KERNEL converts `cell.outputs` (its ordered
output objects) into a tool_result content array, **preserving execution order**:

| `cell.outputs` kind | → tool_result block |
|---|---|
| `stream` (stdout/stderr) | `text` block, prefixed `stdout:`/`stderr:`; truncate to `MAX_TEXT` (~4000 chars) with `…[truncated]` |
| `text` | `text` block, truncated as above |
| `error` | `text` block, **clearly marked `ERROR`**, traceback kept fuller (~6000 chars) |
| `image` (`{mime,b64}`) | **`image` block**: `{type:"image", source:{type:"base64", media_type: mime||"image/png", data: b64}}` — this is the figure the model sees |
| `html` | `text` block `[HTML output rendered]`; include a short sanitized text excerpt if small |
| `iframe_html` (Plotly / custom) | `text` block `[interactive output rendered — not visible to you; print a text summary if you must reason about it]` |

Prepend one header text block: `Cell [{execCount}] · {runtime}` (+ `· ERROR` if any). If no
outputs: `Cell ran, no output.`

**Budgets (configurable):**
- `MAX_IMAGES_PER_RESULT` (default 4) — extra figures replaced by `[N more figures omitted]`.
- Oversized images: if a PNG exceeds ~1.5 MB, KERNEL re-encodes/downscales via `<canvas>` before
  sending (Phase C+; keeps token/cost sane).
- `MAX_TEXT` per text block as above.

**Cross-turn context control (important for long sessions):** keep the **last 2** run results with
their images intact; in older assistant/tool messages, strip image blocks (replace with
`[figure from an earlier step]`) and truncate large text bodies. Keep *all* narration text. This
bounds context growth while preserving the conversation's logic. Implement as a pass over the
message history before each `POST`.

**Guidance lives in the skill, not the code:** the skill already tells the agent to *plot it if
it needs to see it*, to summarize data with `head()`/`describe()` rather than dumping a 10k-row
frame, and to print a text summary alongside interactive output. The marshaler just has to honor
those outputs faithfully.

---

## 7. System prompt & context management

**System prompt** = the `kernel-notebooks` skill + a runtime preamble:
1. `SKILL.md` body (the live-loop + multimodal + runtime-facts sections are the load-bearing
   parts). Include `references/runtime.md` (the hard contract) verbatim; condense
   `references/chartsmanship.md` to its house-style bullets or load on demand.
2. A short operating note: "You drive KERNEL through the tools below; the human watches the
   notebook build live; narrate briefly between tool calls."
3. **A live notebook outline**, regenerated at the *start of each user turn* (so it reflects any
   human edits): one line per cell — `[index] {cell_id} {type} {ran?·exec} "{first source line}"`.
4. **Runtime state**: `kernelReady`, best-effort list of imported/loaded packages, and mounted
   data file names.

Maintain the full `messages[]` history in memory for the duration of a notebook session; prune
per §6. Optionally persist the conversation per-notebook (Phase E) under a key like
`kernel.agent.{nbId}`.

---

## 8. KERNEL integration surface (bind to these real things)

The agent layer should call existing KERNEL internals, not reinvent them:

- **Cells & rendering:** `cells[]`, `mkCell(type,source)`, `insertCell(idx,type,focus)`,
  `findCell(id)`, `indexOf(cell)`, `render()`, `paint(cell)`, `selectCell(id,mode)`,
  `showRendered(cell,true)` (renders markdown incl. KaTeX/Mermaid), `schedulePersist()`.
- **Execution:** `runCell(cell)` (async; serialized via the internal `pyTask` chain), `runAll`,
  the `busy` / `kernelReady` flags, `runPy(src)` for direct harness calls.
- **Outputs:** `cell.outputs` objects with `kind ∈ {stream,text,error,image,html,iframe_html}`,
  `cell.execCount`, `cell.runtime`. (`buildOutputs` is what already turns harness results into
  these.) Image outputs carry `{mime, b64}`.
- **Namespace & data:** harness `_inspect_ns()` → variable rows; `_var_detail(name)` → structured
  detail; `dataFiles[]` → mounted files.
- **API plumbing:** reuse KERNEL's `loadScript`/`fetch` patterns; key in `localStorage`; header
  `anthropic-dangerous-direct-browser-access: true`.
- **Panels:** the `ui` object + `applyUI()`/`saveUI()`/`initPanels()` + `.panel`/`.panel-section`
  CSS — the agent panel is built the same way as Notebooks/Data/Variables.

---

## 9. UI — the Agent panel

A dockable panel obeying the existing composable-panel system.

- **Placement (recommendation):** its own toggle in the topbar opening a **left dock** panel
  (default width ~360px), since a transcript wants height. It can coexist with the right
  Outputs/Variables dock — agent on the left, results on the right is a natural exploratory
  layout. (Alternative: a third stacked section in the right dock — the panel
  machinery supports either. The shipped build gives the agent its own left dock; see §17.)
- **Contents:**
  - **Transcript**: the agent's narration as quiet prose; each tool call shown as a compact mono
    **action chip** in the readout voice — `+ code cell [4]`, `ran [4] · 1.2s`, `inspected df`,
    `✎ edited [4]`. Errors flagged in the alert hue.
  - **Input box** + send; **Stop** button (visible while the loop runs); a thin progress
    indicator reusing the existing top progress bar during API calls / runs.
  - **Settings affordance**: API key, model, autonomy mode, max steps, max images.
- **Live authoring:** cells appear in the notebook as the agent adds them; selection follows the
  agent's current cell so the human's eye tracks it. If Outputs-split is on, figures land in the
  right dock as usual.

---

## 10. Configuration & API

- **Key:** `localStorage["kernel.anthropic.key"]`; prompt to set on first agent use; never sent
  anywhere but `api.anthropic.com`.
- **Request:** `POST https://api.anthropic.com/v1/messages`, headers `x-api-key`,
  `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`,
  `content-type: application/json`. Stream with SSE (`stream: true`) for live narration.
- **Model:** default a Sonnet-class model for loop speed/cost (e.g. `claude-sonnet-4-x`); offer
  an Opus-class option (e.g. `claude-opus-4-x`) for harder reasoning. Keep the model id a
  configurable string so it survives model updates.
- **Params (defaults, all configurable):** `max_tokens` per call ~4096; `temperature` ~0.4;
  `max_steps` per turn 24; `MAX_IMAGES_PER_RESULT` 4; `MAX_TEXT` 4000.
- **Tools** passed on every call; `tool_choice: auto`.

---

## 11. Human-in-the-loop & autonomy

- **Auto (default):** the agent runs the loop autonomously to a natural stop or `max_steps`; the
  human watches cells build and can **Stop** anytime. Best for flow.
- **Step:** gate the *consequential* tools — `run_cell`/`run_all` and any `%pip install` — behind
  a one-tap **Approve / Skip** prompt; let `add_cells` and `inspect_*` proceed freely. Best for
  careful or expensive work.
- Always: Stop button; freely edit/run cells between turns (reflected via the §7 snapshot);
  `max_steps` pause asks before continuing.

---

## 12. Safety & guardrails

- **Sandbox containment:** all agent code runs in Pyodide — no host filesystem, sockets, or
  subprocess. Arbitrary code is contained to the tab; the realistic risks are **cost** and
  **runaway loops**, not system compromise.
- **Loop bounds:** `max_steps` + Stop + the natural "no tool_use" exit.
- **Gating:** in Step mode, require approval for `run_*` and `%pip install`.
- **Key hygiene:** client-only, never logged, only to Anthropic.
- **Cost visibility (Phase E):** a small token/cost meter in the panel; warn on large image
  payloads.
- **Determinism:** the skill already instructs seeding RNGs so reruns reproduce.

---

## 13. Failure modes & handling

| Situation | Handling |
|---|---|
| Kernel not ready | Queue the first run until `kernelReady`, or tool returns "kernel still booting" and the agent waits/retries |
| Kernel busy (human run in flight) | `runCell` already serializes via `pyTask`; the agent's run simply queues |
| Code raises | Return the traceback (marked ERROR); skill says read it and `edit_cell` to fix before continuing |
| `%pip` install fails | Surface the failure text; agent picks an available package or explains the limit |
| Model loops without progress | `max_steps` pause; human decides |
| Context too large | §6 pruning pass each turn (drop old images, truncate old text) |
| API/key error | Surface in transcript, halt the loop, point to settings |
| Human edits a cell mid-session | Next turn's outline snapshot reflects it; `read_cell` gets exact current source |

---

## 14. Build phasing (how it was sequenced)

- **Phase A — Plumbing & one-shot author.** Agent panel UI + BYO-key/model settings + the message
  loop with **only `add_cells`**. The agent drafts a whole notebook from a prompt; cells appear,
  markdown renders. Validates tool→KERNEL binding and the system prompt. *(No execution yet.)*
- **Phase B — Execute & read text.** Add `run_cell` / `run_all` / `read_cell` / `edit_cell`,
  returning **text** outputs; the agent runs steps and fixes its own tracebacks. This is the core
  analyst loop with text-only sight.
- **Phase C — Multimodal sight.** Return **base64 images as image blocks**; add
  `inspect_namespace` / `inspect_variable` / `list_data_files`; image budget + downscaling. Now
  the agent sees plots and inspects data closely — the exploratory-analysis payoff.
- **Phase D — Human-in-the-loop.** Stop, autonomy modes (auto/step), approval gates for run/pip,
  edit-between-turns reconciliation, `max_steps` pause.
- **Phase E — Polish & persistence.** Streaming narration, action-chip log, token/cost meter,
  per-notebook conversation persistence, theming, keyboard shortcuts, settings UX.

Phases A–C make it genuinely useful; D–E make it pleasant and safe to live in.

---

## 15. Non-goals (v1)

- No server/backend; no proxy; client-only.
- No non-Anthropic providers (keep the call site abstract enough to add later, but don't build it).
- No multi-file or multi-notebook agent projects; one notebook at a time.
- No execution outside Pyodide; no host I/O.
- Not a replacement for the human — it proposes and runs; the human owns the analysis.

---

## 16. Decisions that were open during design

1. **Autonomy default** — Auto (flowy) vs Step (approve each run). Recommendation: Auto, with Step
   available and `%pip`/`run` always gateable.
2. **Agent panel placement** — own left dock (recommended) vs a third section in the right dock.
3. **Conversation persistence** — persist the agent transcript per notebook, or keep it
   session-only? (Recommend persist in Phase E.)
4. **Default model** — Sonnet-class for the loop (recommended) with an Opus toggle.
5. **`add_cells` autonomy** — keep add and run separate (recommended) vs an `add_and_run_code`
   convenience tool.

All five were resolved during the build — §17 records the outcomes.


---

## 17. Implementation status (June 2026)

Built and shipped, Phases A–E complete. Deltas from this spec as written:

- **Agent panel** — its own dedicated left dock (`#agentPanel`, 280–560px, own grip),
  not a section of the library panel (§9's recommendation, taken).
- **Streaming** — SSE with live narration and a working indicator; Stop aborts the
  in-flight stream; 120s no-data timeout (§10, done).
- **Beyond spec** — conversations persist per notebook *and embed in the saved
  `.ipynb`* (restored on open); transcript exports as markdown; ⑂ fork any user turn
  into a duplicated notebook; paste/drag images into the chat (multimodal turns);
  token/cost meter with cache-aware accounting; context ceiling read live from the
  Models API with self-compaction at 85%; **prompt caching** (the skill/tools prefix is
  cached across loop steps at ~10% read price); `save_data_file` and
  `set_notebook_name` tools; Sonnet↔Opus quick switch; per-cell *ai* button; live theme
  flip without reload; a turn is pinned to its notebook (switching cancels cleanly).
- **Open decisions (§16), as resolved** — autonomy defaults to Auto with Step available;
  agent panel is its own left dock; conversations persist (and travel in the file);
  default model is Sonnet-class with Opus one click away; `add_cells` stays separate
  from running.

## 18. Mobile / PWA variant (KERNEL·M)

A phone-friendly build ships as `docs/kernel-agent-mobile.html` — the same agent, made
responsive and progressive without touching the desktop layout. Everything below is
additive and gated to a `max-width:760px` media query:

- **Single-column workspace.** The four docked columns collapse; the notebook is full
  width and the Agent / Files / Variables panels become **bottom sheets** (drag-handle to
  dismiss, backdrop to close), driven by a bottom navigation bar. One sheet open at a
  time. The Agent deliberately stays a sheet *over* the live notebook so you can still
  watch it author cells.
- **Touch + viewport.** Larger tap targets, a horizontally scrollable toolbar, a 16px
  editor font to defeat iOS focus-zoom, and `dvh` + safe-area insets for the bar and dock.
- **Installable PWA.** A blob web-app manifest, generated icons (192 / 512 / maskable +
  apple-touch), `display: standalone`, theme-color synced to the in-app theme, and an
  install affordance (Android `beforeinstallprompt`; iOS Add-to-Home hint).
- **Offline.** `kernel-agent-sw.js` caches the app shell (network-first) and the Pyodide /
  CDN assets (cache-first) so it loads offline after the first online run; the Anthropic
  API is never cached. The service worker only registers over https.

Implementation note: the mobile UI controller is injected *inside* the app's main IIFE so
it can drive the existing panel state (`ui` / `applyUI`), while the PWA layer is a separate
standalone script. The build is produced from `kernel-agent.html` by a small assembler, so
the variant tracks the agent automatically.
