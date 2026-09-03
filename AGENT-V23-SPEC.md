# KERNEL Agent v2.3 — Durable Runs, Notebook Intelligence, and Handoff

Status: implemented on `feat/kernel-v2.3`.

KERNEL v2.3 is one release built on the v2 provider/thread/workspace foundation. It does not
replace the provider adapters or turn KERNEL into a general IDE. It makes a notebook-agent run
durable, inspectable, reproducible, and portable.

## 1. Product invariants

1. **The notebook remains the source of truth.** The human and agent use the same cells,
   execution path, outputs, files, and Python namespace.
2. **A run is a durable state machine.** Model calls, tool boundaries, plans, budgets,
   interruptions, and checkpoints survive reloads.
3. **Recovery never silently repeats an ambiguous mutation.** A model request may be safely
   retried from the last committed message boundary. A tool whose outcome is unknown requires
   inspection, retry, or skip.
4. **Full history stays full.** Context selection, lazy output handles, and compaction affect
   only the outbound request.
5. **Lineage is advisory and honest.** Static Python dependencies can be uncertain. Imported
   outputs without lineage are historical/unknown, never falsely fresh.
6. **Portable exports have explicit trust boundaries.** A full ZIP is lossless. A share-safe
   ZIP includes only the notebook, human-visible metadata, and approved final artifacts by
   default.
7. **Provider parity stays capability-driven.** Anthropic, OpenAI, and xAI share the same
   run/tool contract while the UI reports provider/model capabilities without promising
   unsupported behavior.
8. **Desktop and mobile keep one byte-identical core.** The sync and verification gates remain
   mandatory.

## 2. Durable run model

Every human request creates a run with one stable `runId` used by the agent ledger, cell
output provenance, produced artifacts, checkpoints, and comparison records.

Run statuses are:

- `running`: work is active;
- `pausing`: a Python cell is finishing before a safe pause;
- `paused`: resumable from a committed boundary;
- `failed`: resumable after a provider, parsing, or tool failure;
- `completed`: the model returned without further tool calls;
- `stopped`: the human intentionally ended the run;
- `interrupted`: the page disappeared while work was active.

Run phases distinguish `model`, `tool`, `between_tools`, `budget`, `approval`, and `terminal`.
The run record stores provider/model, start/update/finish times, active elapsed time, a budget
snapshot, usage at start and current deltas, current tool cursor, plan, failure summary, and
checkpoint relationship.

### 2.1 Event ledger

Each run contains an ordered append-only event array. Sequence numbers are monotonic and an
existing sequence is never overwritten. High-value events are:

- run started, resumed, paused, stopped, failed, interrupted, or completed;
- model requested, responded, incomplete, stalled, or failed;
- tool started, completed, failed, skipped, or ambiguous;
- plan updated;
- budget reached;
- checkpoint created or restored;
- recovery detected.

Streaming tokens are not ledger events. Live byte/text counters may update the run projection
without creating a log row per delta.

### 2.2 Commit boundaries and recovery

Canonical assistant content is committed only after a provider response completes
authoritatively. Every completed tool result is persisted with the thread and run before the
next model request.

On activation, a formerly `running` or `pausing` run becomes `interrupted` and receives a
recovery event. If the canonical history contains tool calls without results, KERNEL repairs
them from durable completed results. An unconfirmed tool receives an explicit ambiguous result
that instructs the model to inspect current notebook state before repeating work.

Reload during a model stream is retried from the last canonical boundary. Reload during a
tool is never treated as proof the tool did or did not complete.

### 2.3 Pause, resume, retry, and stop

- Pause aborts a provider stream or waits for a running Pyodide cell to finish, then persists
  a resumable boundary.
- Resume continues without inserting a duplicate human message.
- Retry increments an attempt and reissues from the last committed boundary.
- Stop is terminal and distinct from pause.
- A stalled initial connection and a stalled response stream both produce explicit failures;
  user stop, pause, deadline, and network abort remain distinguishable.

## 3. Budgets and visible plan

Each run snapshots three user settings:

| Budget | Default | Enforcement |
|---|---:|---|
| Tool calls | 24 | Before the next tool |
| Active elapsed time | 30 minutes | Before requests/tools and after a Python cell |
| Reported total tokens | 500,000 | After provider usage and before the next request |

The per-response output-token setting remains separate. A budget hit pauses rather than
deletes state. Resuming starts a new budget segment while preserving cumulative run metrics.

Multi-step work uses the `update_plan` tool. Plan steps have stable IDs, titles, and
`pending`, `in_progress`, or `completed` status. The compact run dock shows the current step,
elapsed time, tools, tokens, pause/resume state, and links to the complete plan and timeline.
Plans expose decisions and progress, not hidden chain-of-thought.

## 4. Notebook dependency and freshness model

KERNEL analyzes each code cell for top-level definitions, references, imports, and explicit
`# depends-on: <cell-id>` directives. The browser heuristic is deliberately conservative and
marks dynamic constructs such as wildcard imports, `exec`, or `eval` as uncertain.

Reads bind to the nearest preceding cell that defines the name. This creates an advisory
directed graph keyed by stable cell ID. Reordering recomputes the graph.

Executed output provenance records:

- source hash and execution time;
- actor (`human` or `agent`), thread, run, and tool call;
- upstream cell IDs and their source/run hashes;
- referenced artifact fingerprints;
- environment fingerprint;
- success/error state.

Output states are:

- `fresh`: current source and known upstream lineage match;
- `stale`: a known source, dependency, file, or environment mismatch exists;
- `historical`: saved/imported output lacks enough lineage to prove freshness.

Editing or rerunning an upstream cell propagates staleness through reverse edges. Restarting
the Python kernel makes the live namespace cold but does not falsely label unchanged saved
output stale.

Structured tracebacks retain notebook ID, stable cell ID, source line, and function when the
runtime provides them. App-owned traceback buttons navigate to the exact cell/line.

## 5. Explicit active context

Cell and artifact context policy is `auto`, `pinned`, or `excluded` and is saved per thread.

- Auto sends the notebook outline and bounded artifact metadata.
- Pinned sends bounded source/output or artifact preview plus freshness/provenance.
- Excluded is omitted from the prompt and cannot be read through an agent read tool.

Because Pyodide uses one live namespace and mounted filesystem, KERNEL blocks agent execution,
namespace inspection, and filesystem-backed save tools while any code cell or artifact is
excluded. This conservative barrier prevents an indirect tool bypass when runtime values
cannot be attributed safely; human-run cells remain available.

Pinned content is counted before ordinary history. It is never silently discarded by thread
compaction. If pins alone exceed the active budget, sending stops with an actionable omission
report. The context dialog lists pinned, excluded, pruned, checkpointed, and lazy-handled
content.

Large cell/file output stays in the workspace and enters messages as a stable handle plus a
bounded preview. The agent can explicitly read a later chunk instead of carrying the full
payload through every request.

## 6. Artifact workspace

Workspace records migrate from v2 `files` to v3 `artifacts`. Each artifact has:

- stable ID and normalized relative POSIX path;
- bytes, media type, size, timestamps, and fingerprint;
- origin (`upload`, `cell`, or `agent`);
- lifecycle (`input`, `scratch`, or `final`);
- producer provenance and optional parent artifacts;
- context policy.

Paths reject absolute roots, NULs, empty/traversal components, and unsafe aliases. Folder
uploads preserve relative paths. Duplicate paths receive deterministic suffixes instead of
silently overwriting another file.

The Data panel renders a folder tree grouped by Inputs, Working, and Final Results. Users can
preview, insert a read snippet, download, promote/demote, pin/exclude, and remove artifacts.
Previews are bounded and safe: tables for CSV/TSV, formatted JSON/text, object URLs for media,
sandboxed HTML, and metadata/hex for unknown binary data.

## 7. Environment snapshot

KERNEL captures the app version, Python/Pyodide versions, loaded/installed packages, browser
platform, cell/source fingerprints, and artifact fingerprints. It refreshes after package
installation and before exports. The snapshot is descriptive; imports do not silently install
arbitrary packages.

Full ZIPs include `environment.json` and a readable `requirements.txt` snapshot. Notebook
metadata carries the latest environment summary.

## 8. Checkpoints and forks

KERNEL creates a point-in-time checkpoint at run start and after committed mutating tool batches, and
users may create a named checkpoint manually. A checkpoint captures cells, rendered outputs,
files, active-thread messages/transcript/usage/plan, provider/model identity, and environment
metadata. It never contains provider keys.

A tool-batch checkpoint is created only after every corresponding `tool_result` has entered
canonical history and been persisted. Manual checkpoints are unavailable while a paused tool
batch is pending; ending that run first commits completed and skipped results so no checkpoint
or continuing thread can contain unmatched tool calls.

Forking from a human turn resolves to the checkpoint created immediately before that turn.
The new notebook restores that point-in-time state and records its parent notebook/checkpoint.
The source remains untouched. Restoring over an existing notebook requires explicit
confirmation; forking is the default recovery action.

## 9. Provider/model comparison

Comparison mode is intentionally read-only. It accepts one prompt and one or more
`provider:model` profiles whose provider keys are already configured. Each profile receives
the same notebook outline and pinned context with no mutation tools. Results report answer,
latency, input/output tokens, provider/model, and error status. Comparison results are saved
to the active thread and may be exported, but never enter the canonical conversation unless
the human explicitly copies one.

This provides an honest model shootout without allowing contenders to mutate the same
notebook or pretending that prose quality proves executable correctness.

## 10. Full and share-safe exports

The v3 full archive contains:

```text
manifest.json
notebook.ipynb
environment.json
requirements.txt
threads/*.json
runs/*.json
checkpoints/*.json
data/inputs/*
data/scratch/*
data/final/*
README.txt
```

The importer accepts both v2 and v3 archives. A v2 file becomes an input or final artifact
according to its origin.

Share-safe export defaults to:

- notebook cells and rendered outputs included;
- approved final artifacts included;
- uploads, scratch files, canonical provider continuation items, diagnostics, run ledger,
  and chat threads excluded;
- environment and provenance summaries included;
- provider configuration and keys always excluded.

The export scans copied text for common API keys, bearer tokens, private-key blocks, and
credential assignments. Findings are reported before download. The scanner is assistance,
not a guarantee, and never mutates live notebook/workspace state.

## 11. Redacted diagnostics

Diagnostics use an allowlist, not a recursive dump. They contain app/schema version,
provider/model, API origin, run status/phase/budgets/timing/usage, sanitized event summaries,
storage availability/errors, cell/output/file counts, and environment versions.

They exclude prompts, assistant prose, cell sources, tool arguments/results, previews, file
bytes, images, full URLs/query strings, headers, and provider keys. A final redaction pass
removes key-like strings and authorization fields without erasing numeric token counts.

## 12. Persistence and compatibility

`kernel.workspace.v2` advances its IndexedDB schema. Existing `workspaces` and `threads`
remain readable. New run/checkpoint records use stable keys and notebook/thread indexes.
Database open failures may retry; blocked upgrades and version changes close cleanly. The
in-memory fallback supports the same data shapes and continues warning users to export before
closing.

Restored transcript actions are rebuilt as app-owned text and allowlisted cell links rather
than trusted as archive HTML. Stored transcript images accept only supported inline image data,
so opening an archive cannot inject active chip markup or trigger an arbitrary remote image load.

Notebook deletion removes its workspace, threads, runs, and checkpoints. Duplication copies
the current workspace and threads but not historical run ledgers unless initiated from a
checkpoint fork.

## 13. Acceptance gates

Automated verification must cover:

- inline-script parsing and desktop/mobile core equality;
- v2 provider adapter contracts with no Anthropic regression;
- run transitions, monotonic events, recovery repair, pause/resume, retry, and budgets;
- final SSE events and incomplete-response handling;
- dependency resolution, uncertainty, and transitive stale propagation;
- context pin inclusion/exclusion and pin-overflow refusal;
- path traversal rejection, deterministic collisions, artifact lifecycle and lineage;
- structured traceback routing;
- checkpoint point-in-time fork fidelity;
- diagnostics and share-safe exports seeded with fake secrets;
- inert transcript restoration and authoritative-only stream persistence;
- v2 import compatibility and v3 Unicode/binary ZIP round-trip;
- provider configuration/key exclusion from every export.

Live provider calls remain BYO-key smoke tests. Static/provider-fixture tests must still prove
the request/response transformations and all non-network state behavior.

## 14. v2.3.1 completion and autonomy stabilization

The v2.3.1 patch distinguishes a provider ending its response from KERNEL proving that a run is
complete. Any run that published a plan or used a tool must pass an application-owned completion
contract:

- the visible plan has no `pending` or `in_progress` steps;
- the agent calls `finish_run` with a concise summary and structured evidence claims referencing stable cell or artifact IDs;
- KERNEL validates every reference itself: code-cell evidence must be freshly executed and error-free, while artifact evidence must still exist and remain included in context;
- the accepted completion still matches the current plan version;
- no later notebook mutation has invalidated that acceptance.

If a model returns without tools before satisfying this contract, KERNEL records
`completion_rejected` and automatically asks it to continue. After two consecutive completion
attempts without new notebook/plan progress, the run pauses in the `completion` phase for human
inspection rather than looping or displaying a false success. Simple conversational answers that
never create a plan or use a tool remain lightweight and may finish directly.

Rejected `finish_run` tool calls use that same bounded counter; a third no-progress rejection is
committed as a canonical tool result before the run pauses. Any remaining calls in that provider
batch are recorded as skipped and never execute. Once `finish_run` is accepted, KERNEL revalidates
the cited cells and artifacts after the completion checkpoint has finished persisting and
immediately before the synchronous terminal transition. The candidate checkpoint is discarded and
completion is rejected if any reference disappeared, became excluded, went stale, errored, or
changed since acceptance.

The active system context contains an authoritative run-control block with remaining tool, active
time, and token capacity plus the exact active boundary reason. Models are explicitly forbidden to
invent a timeout, pause, stop, or budget condition. Those states are emitted only by KERNEL.

In AUTO mode, tool-call and active-time values become progress checkpoints. KERNEL may extend them
by the configured segment while:

- at least one durable notebook or plan change occurred since the previous extension;
- fewer than two consecutive tool failures occurred;
- the configured automatic-extension count has not been exhausted; and
- the hard reported-token budget has not been reached.

The token budget remains a mandatory human boundary because it most directly controls provider cost.
STEP mode never auto-extends. Every automatic or explicit extension is an event in the durable run
ledger, and the run dock exposes the number of automatic extensions used. Provider connection and
stream-stall health timers remain separate from notebook execution and run budgets.

For review and support transfers, v2.3.1 also adds a clearly labeled **private run ZIP**. It contains
the current notebook, outputs, artifacts, environment, complete threads, and durable run ledgers but
does not read or serialize historical checkpoints. It is neither redacted nor share-safe. The normal
full ZIP retains every checkpoint and exact restore/fork behavior, while the existing share-safe ZIP
continues to remove private conversation and run history.
