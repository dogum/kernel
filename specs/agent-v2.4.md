# KERNEL Agent v2.4 — Efficient, Interruptible, and Robust Runs

Status: implemented on `claude/python-notebook-project-review-ppwmbf`.

v2.4 keeps every v2.3 contract ([`agent-v2.3.md`](agent-v2.3.md)): durable runs, lineage,
checkpoints, completion-safe autonomy, and portable handoff. It changes how a run *spends* time and
money, and how the runtime behaves when Python misbehaves. The four curated examples motivated each
change: their runs reported 1–4% prompt-cache hits, one tool call per model call, token budgets that
paused runs every 15–20 calls, and a full workspace ZIP that could not be allocated.

## 1. Product invariants (additions)

1. **The prompt prefix is append-only.** The system prompt and tool list are byte-stable for a
   thread. Earlier turns change only at fixed compression epochs, a compaction, or a human context
   policy change.
2. **Python never blocks the page.** Cells run in a worker, and any running cell can be interrupted.
3. **A transient provider failure is not a run failure.** Model requests retry from the last
   committed boundary, which v2.3 already defines as safe to repeat.
4. **Budgets measure cost, not traffic.** Cache reads count at their approximate price.
5. **An artifact payload is stored once.** Checkpoints and exports reference content by hash.

## 2. Cache-stable prompt architecture

- **Frozen system prompt.** `system` (Anthropic) and `instructions` (Responses) contain the skill
  documentation plus, only when present, human-pinned context and an earlier-thread compaction
  summary. Both change only through deliberate human action or compaction.
- **`<kernel_state>` blocks.** Before each model request KERNEL stamps the newest user-role message
  with a state block: notebook outline with stable cell IDs, visible artifacts, loaded packages, the
  visible plan, and authoritative run control (remaining tools, active minutes, effective tokens,
  cell time limit). Only the newest message's block may be replaced; once a model has answered, a
  block is frozen. If notebook, artifacts, and packages are unchanged since the previous block, the
  new block says so instead of repeating them. The blocks are canonical thread content, so they
  persist, export, and restore with the thread.
- **Epoch compression.** Messages before a compression horizon have their rich content compressed:
  figures, long tool text, long code inputs, user images, earlier state blocks, and replayed
  thinking. The horizon advances only in steps of 6–24 tool results (scaled to the context window)
  and always keeps at least the 3 newest tool results at full fidelity. Between steps every earlier
  message is byte-identical.
- **Breakpoints and keys.** Anthropic requests mark the skill block, the context block, and the last
  block of the two newest user messages. OpenAI requests send a per-thread `prompt_cache_key`.

## 3. Add-and-run tools

`add_cells` and `edit_cell` accept `run: true`. New or edited code cells execute in order in the same
tool call, execution stops at the first error, and outputs (text, tables, tracebacks, figures, with a
shared figure budget) are returned in that tool result. STEP mode asks before running; skipping
applies the change without running it. The shared-runtime exclusion barrier treats a run request like
`run_cell`. Agent runs wait for an idle kernel and report honestly when a cell could not run, instead
of returning earlier outputs as if they were fresh.

## 4. Effective-token budget

`effective tokens = input − 0.9 × cache reads + output`, using provider-reported usage. The run budget,
run dock, run history, run-control block, and diagnostics use this measure. The budget remains a hard
human boundary that AUTO never extends.

## 5. Provider resilience

- **Retries.** HTTP 408/409/425/429/5xx/529, network failures before or during a stream, stalled
  streams (no bytes for three minutes), connection timeouts, retryable SSE error events, and streams
  that end without an authoritative completion retry up to five times. Backoff is exponential with
  jitter (2 s base, 60 s cap); `retry-after` and `retry-after-ms` override it (120 s cap). Waits are
  interruptible by Pause and Stop, and every retry is a `model_retry` ledger event.
- **Output escalation.** Defaults are 64K output tokens for Anthropic and OpenAI and 32K for xAI.
  A response cut off by `max_tokens` or `max_output_tokens` is retried with twice the cap, up to the
  model limit (from the Models API when known), recorded as `model_output_extended`.
- **Compatibility mode.** If an Anthropic endpoint rejects an optional feature (400 naming it), or
  the very first beta-carrying request fails before a response, KERNEL retries once without optional
  features for the rest of the session and records `model_compat_mode`.
- **Tool-input validation.** Unparseable streamed tool arguments or missing required fields return an
  error result without executing anything.

## 6. Claude adapter

- Default model `claude-opus-5-5`. Existing configurations that still hold the previous default
  (`claude-sonnet-4-6`, 8192 output tokens, no effort) migrate once; explicit choices survive.
- Claude 4.6+ and Claude 5 models receive `thinking: {type: "adaptive"}`. Claude 4.7+ and Claude 5
  models also receive `display: "summarized"`. Effort (`output_config.effort`) is explicit (default
  `medium`), and levels a model does not support degrade (for example `xhigh` → `high` on 4.6).
- Thinking and redacted-thinking blocks are stored with their signatures and replayed unchanged on
  requests that enable thinking. Claude Opus 5.5 and Fable 5.1 requests set
  `block_binding.prefix_mismatch_behavior: "drop_block"` (beta `thinking-binding-controls-2026-08-01`),
  so an epoch compression, compaction, or context-policy change drops invalidated blocks instead of
  failing the request.
- Claude Opus 5 / Fable 5 and later send `fallbacks: "default"` (beta
  `server-side-fallback-2026-07-01`). Tool calls and thinking that precede the final fallback
  boundary are never executed or replayed. A `refusal` stop, a context-window stop, or a `max_tokens`
  stop never commits output.
- Tools stream their inputs eagerly. Short thinking text (progress updates between tool calls) renders
  as transcript status lines, and longer text renders as a collapsible reasoning summary.

## 7. Interruptible Python worker

- Pyodide runs in a dedicated Web Worker created from an inline script. A strictly ordered message
  protocol covers boot, run (with per-call variables), package loading with progress, and filesystem
  write/read/unlink/stat. If a worker cannot start, the same code runs on the page thread
  (`kernel.runtime = inline` forces this for debugging).
- **Interrupt** (toolbar, `i i` in command mode, agent Stop, or the agent cell time limit): when the page
  is cross-origin isolated, a SharedArrayBuffer interrupt raises `KeyboardInterrupt` in place, partial
  output is kept, and variables survive. Otherwise, or if Python does not stop within three seconds,
  KERNEL replaces the worker, remounts every artifact, increments the kernel generation, and clears
  every execution count. Human-initiated restarts that would clear variables ask first.
- Agent-run cells have a configurable time limit (default 10 minutes). The tool result tells the model
  what happened and that upstream cells must be rerun after a restart.
- A worker that fails to restart leaves a clear failed state; Restart tries again.

## 8. Content-addressed artifact storage

- IndexedDB schema 3 adds a `blobs` store keyed by `sha256:<hex>` (`crc32:` with byte comparison in
  non-secure contexts) with a `created` index. Workspaces and checkpoints store `{blob}` references.
- Artifact persistence stats the worker filesystem and re-reads only files whose size or mtime
  changed.
- Garbage collection is a mark-and-sweep over workspace, checkpoint, and live references. Legacy
  records with embedded bytes migrate to references one at a time. A sweep aborts on any storage
  error and never removes blobs written in this session or within the last ten minutes.
- Values that failed to persist (quota, unavailable storage) live in memory and are read ahead of
  stale IndexedDB copies; a full quota has its own warning.

## 9. Exports

Full and private-run ZIPs write each unique payload once. Later references reuse the first entry name,
which v2.3 importers already resolve, so the archive format is unchanged. Archives are assembled
from `Blob` parts rather than one contiguous buffer. Imports store payloads as blobs.

## 10. Acceptance gates

Static and fixture verification (`tests/verify_agent_v24.mjs`) covers: the operating-note contract;
the Claude request shape and feature matrix; thinking replay; cache breakpoints; fallback
boundaries; epoch stability of compression; append-only state stamping; effective-token accounting;
retry classification, bounds, escalation, and compatibility; the worker protocol against a fake
interpreter; SHA-256 addressing; artifact byte precedence; ZIP parts; GC safety; and the add-and-run
tools and exclusion barrier.

Browser verification (`tests/e2e/run.mjs`, Playwright with a mock provider) runs both builds
through complete agent loops on Anthropic and Responses. It asserts:

- byte-stable system prompts and append-only history;
- retries on 529 responses and stream errors;
- `max_tokens` escalation;
- refusal fallbacks and one-time config migration;
- page responsiveness during an infinite loop, hard and soft interrupts, the agent cell time limit,
  and the page-thread fallback;
- deduplicated checkpoints, ZIP round-trip, fork restoration, legacy migration, and quota-safe reads.

Live provider calls remain bring-your-own-key smoke tests.
