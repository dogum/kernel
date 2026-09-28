# Agent specifications

KERNEL·A's behavior is specified in layers. Each spec keeps the contracts of the ones before it unless it says otherwise.

| Spec | Covers |
|---|---|
| [`agent-v2.4.md`](agent-v2.4.md) | **Current.** Cache-stable prompts, add-and-run tools, effective-token budgets, provider retries, the Claude adapter, the interruptible Python worker, and content-addressed storage. |
| [`agent-v2.3.md`](agent-v2.3.md) | Durable runs and recovery, completion-safe autonomy, lineage and stale outputs, the artifact workspace, checkpoints and forks, and portable handoff. |
| [`agent-v2.md`](agent-v2.md) | Anthropic, OpenAI, and xAI adapters, threads, context management, and portable workspaces. |
| [`agent-v1.md`](agent-v1.md) | The original Anthropic-only design and tool contract, kept for history. |

A change to agent behavior updates the current spec in the same pull request. The acceptance checks each spec lists live in `tests/`.
