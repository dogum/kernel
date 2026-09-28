/* ── durable agent loop ── */
function completionContractReason() {
  if (!agRun) return "";
  const planned = (agPlan || []).length > 0,
    worked = (agRun.toolCalls || 0) > 0;
  if (!planned && !worked) return "";
  const unfinished = (agPlan || []).filter((s) => s.status !== "completed");
  if (unfinished.length)
    return (
      unfinished.length +
      " visible plan step" +
      (unfinished.length === 1 ? " remains" : "s remain") +
      " unfinished: " +
      unfinished.map((s) => s.id).join(", ")
    );
  const accepted = agRun.completionAccepted;
  if (!accepted || accepted.planSignature !== runPlanSignature())
    return "finish_run has not accepted executed evidence for the current completed plan";
  const checked = validateCompletionEvidence(accepted.evidence);
  if (checked.errors.length || checked.evidence.length !== (accepted.evidence || []).length)
    return (
      "accepted completion evidence is no longer valid: " +
      (checked.errors.join("; ") || "an evidence item disappeared")
    );
  const expected = accepted.evidenceSignature || completionEvidenceSignature(accepted.evidence);
  if (completionEvidenceSignature(checked.evidence) !== expected)
    return "accepted completion evidence changed after validation";
  return "";
}
async function enforceCompletionContract() {
  const reason = completionContractReason();
  if (!reason) return "accepted";
  const guard = await recordCompletionRejection(reason);
  if (guard.pause) {
    agRun.completionPauseReason = "";
    await pauseRun("Completion contract unmet after two automatic continuations: " + reason, "completion");
    return "paused";
  }
  const instruction =
    "KERNEL completion guard: the run is not complete because " +
    reason +
    ". Do not summarize or claim a pause/limit. Continue from the next unfinished step, update the visible plan from actual results, and call finish_run only after all promised work is complete.";
  agMsgs.push({ role: "user", content: [{ type: "text", text: instruction }] });
  txDom("s", "not finished yet · continuing (" + reason + ")");
  await saveActiveThreadNow();
  return "continue";
}
async function completePendingTools(turnNb) {
  const tus = agRun && Array.isArray(agRun.pendingTools) ? agRun.pendingTools : [];
  if (!tus.length) return true;
  agRun.pendingToolResults = agRun.pendingToolResults || {};
  agRun.pendingMutations = agRun.pendingMutations || [];
  let batchFailure = "";
  for (let i = Math.max(0, agRun.nextToolIndex || 0); i < tus.length; i++) {
    if (!agStop && agPauseRequested) {
      await pauseRun("Paused by the human", "between_tools");
      return false;
    }
    if (!agStop && (await enforceRunBudget("between_tools"))) return false;
    const tu = tus[i],
      beforeState = MUTATING_TOOLS.has(tu.name) ? durableStateSignature() : null;
    let blocks,
      outcome = "completed";
    if (nbId !== turnNb) {
      agStop = true;
      outcome = "skipped";
      blocks = [{ type: "text", text: "The human switched notebooks — this run is cancelled. Do not act further." }];
    } else if (agStop) {
      outcome = "skipped";
      blocks = [{ type: "text", text: "The human pressed Stop. End the run and do not execute this tool." }];
    } else {
      agRun.phase = "tool";
      agRun.activeTool = { id: tu.id, name: tu.name, index: i };
      activeToolContext = { runId: agRun.id, actor: "agent", threadId: agThreadId, toolCallId: tu.id };
      await runEvent("tool_started", tu.name, { toolCallId: tu.id, toolName: tu.name });
      try {
        const editRun = (tu.name === "add_cells" || tu.name === "edit_cell") && tu.input && tu.input.run === true;
        if (agAutonomy === "step" && (tu.name === "run_cell" || tu.name === "run_all" || editRun)) {
          const ok = await askApproval(
            tu.name === "run_all"
              ? "run all cells?"
              : tu.name === "add_cells"
                ? "add " + (tu.input.cells || []).length + " cell(s) and run them?"
                : tu.name === "edit_cell"
                  ? "edit and rerun this cell?"
                  : "run cell?",
          );
          if (ok) blocks = await execTool(tu);
          else if (editRun)
            blocks = (
              await execTool(Object.assign({}, tu, { input: Object.assign({}, tu.input, { run: false }) }))
            ).concat([{ type: "text", text: "The human skipped execution: the change was applied but not run." }]);
          else {
            outcome = "skipped";
            blocks = [{ type: "text", text: "Human skipped this action." }];
          }
        } else blocks = await execTool(tu);
      } catch (e) {
        outcome = "failed";
        batchFailure = redactText(String((e && e.message) || e));
        blocks = [
          {
            type: "text",
            text:
              "KERNEL tool failure: " +
              batchFailure +
              ". The outcome may be partial; inspect current notebook state before repeating this action.",
          },
        ];
      } finally {
        activeToolContext = null;
      }
    }
    blocks = Array.isArray(blocks) ? blocks : [{ type: "text", text: String(blocks || "") }];
    agRun.pendingToolResults[tu.id] = clonePlain(blocks);
    agRun.completedToolResults = agRun.completedToolResults || {};
    agRun.completedToolResults[tu.id] = clonePlain(blocks);
    agRun.nextToolIndex = i + 1;
    agRun.toolCalls = (agRun.toolCalls || 0) + 1;
    agSteps = agRun.toolCalls;
    agRun.activeTool = null;
    const reportedFailure = blocks.some(
      (b) =>
        b &&
        b.type === "text" &&
        (/^(?:ERROR\b|BLOCKED:|KERNEL tool failure:)/.test(String(b.text || "").trim()) ||
          / · ERROR(?:\n|$)/.test(String(b.text || ""))),
    );
    agRun.consecutiveToolFailures =
      outcome === "failed" || reportedFailure ? (agRun.consecutiveToolFailures || 0) + 1 : 0;
    const mutated =
      outcome === "completed" &&
      !reportedFailure &&
      beforeState !== null &&
      beforeState !== durableStateSignature() &&
      !agStop;
    if (mutated) {
      noteRunProgress(tu.name);
      agRun.pendingMutations.push(tu.name);
    }
    await runEvent("tool_" + outcome, outcome === "failed" ? batchFailure : tu.name, {
      toolCallId: tu.id,
      toolName: tu.name,
      stateChanged: mutated,
    });
    if (mutated) {
      persist();
      await saveWorkspaceState();
    }
    if (agRun.completionPauseReason) {
      for (let j = i + 1; j < tus.length; j++) {
        const later = tus[j],
          skipped = [
            {
              type: "text",
              text: "Not executed because KERNEL reached the terminal completion-retry guard. This batch will be committed and paused; resume explicitly after inspecting the plan and evidence.",
            },
          ];
        agRun.pendingToolResults[later.id] = skipped;
        agRun.completedToolResults[later.id] = skipped;
        await runEvent("tool_skipped", later.name + " · terminal completion guard", {
          toolCallId: later.id,
          toolName: later.name,
        });
      }
      agRun.nextToolIndex = tus.length;
      break;
    }
    if (batchFailure) {
      for (let j = i + 1; j < tus.length; j++) {
        const later = tus[j],
          skipped = [
            {
              type: "text",
              text: "Not executed because an earlier tool failed. Inspect notebook state before deciding whether to retry.",
            },
          ];
        agRun.pendingToolResults[later.id] = skipped;
        agRun.completedToolResults[later.id] = skipped;
        await runEvent("tool_skipped", later.name + " · earlier tool failed", {
          toolCallId: later.id,
          toolName: later.name,
        });
      }
      agRun.nextToolIndex = tus.length;
      break;
    }
    agStateUi();
    if (!agStop && i < tus.length - 1) {
      if (agPauseRequested) {
        await pauseRun("Paused by the human", "between_tools");
        return false;
      }
      if (await enforceRunBudget("between_tools")) return false;
    }
  }
  const results = tus.map((tu) => ({
      type: "tool_result",
      tool_use_id: tu.id,
      content: clonePlain(
        agRun.pendingToolResults[tu.id] || [{ type: "text", text: "No durable tool result was recorded." }],
      ),
    })),
    mutations = [...new Set(agRun.pendingMutations || [])];
  agMsgs.push({ role: "user", content: results });
  agRun.pendingTools = [];
  agRun.pendingToolResults = {};
  agRun.nextToolIndex = 0;
  agRun.phase = "between_tools";
  await runEvent(
    "tool_batch_committed",
    results.length + " tool result" + (results.length === 1 ? "" : "s") + " committed",
  );
  await saveActiveThreadNow();
  if (mutations.length) {
    await createCheckpoint("After " + mutations.join(", ").slice(0, 80), "tool_boundary", agRun);
    agRun.pendingMutations = [];
    await saveRun(agRun);
  }
  if (batchFailure) {
    txDom("e", "Tool failed · " + batchFailure);
    await finalizeRun("failed", batchFailure);
    return false;
  }
  if (agStop) {
    txDom("s", "stopped");
    await finalizeRun("stopped", "Stopped by the human");
    return false;
  }
  if (agRun.completionPauseReason) {
    const reason = agRun.completionPauseReason;
    agRun.completionPauseReason = "";
    await pauseRun("Completion contract unmet after two automatic continuations: " + reason, "completion");
    return false;
  }
  return true;
}
async function resumeAgentRun() {
  if (agRunning || !agRun || RUN_TERMINAL.has(agRun.status)) return;
  if (notebookSwitching) {
    toast("Wait for the notebook switch to finish.", "err");
    return;
  }
  if (!agKey) {
    openAgSettings();
    return;
  }
  const reasons = runBudgetReasons(agRun);
  agRun.autonomy = agAutonomy;
  agRun.budgets = agRun.budgets || {};
  agRun.budgets.maxAutoExtensions = (agRun.autoExtensionsUsed || 0) + (agAutonomy === "auto" ? agAutoExtensions : 0);
  if (reasons.length) {
    const added = extendRunBudgets(agRun, reasons, {
      tools: agMaxSteps,
      elapsedMs: agMaxMinutes * 60000,
      tokens: agTokenBudget,
    });
    await runEvent("budget_extended", "Explicit resume added " + added.join(" + "));
  }
  agentTurn("", { resume: true });
}
async function agentTurn(text, options) {
  options = options || {};
  if (agRunning) return;
  if (notebookSwitching) {
    toast("Wait for the notebook switch to finish.", "err");
    return;
  }
  if (!options.resume && agRun && !RUN_TERMINAL.has(agRun.status)) {
    toast("Resume or end the current run before starting a new request.", "err");
    return;
  }
  if (busy) {
    toast("Wait for the running cell to finish.", "err");
    return;
  }
  if (!agKey) {
    openAgSettings();
    return;
  }
  const turnNb = nbId;
  let paused = false;
  try {
    agRunning = true;
    agStop = false;
    agPauseRequested = false;
    agAbortReason = "";
    agSteps = 0;
    agStateUi();
    progressOn();
    if (options.resume) {
      if (!agRun || RUN_TERMINAL.has(agRun.status)) return;
      agRun.status = "running";
      if (agRun.phase === "terminal")
        agRun.phase = agRun.pendingTools && agRun.pendingTools.length ? "between_tools" : "between_models";
      agRun.activeSince = Date.now();
      agRun.pauseReason = "";
      agRun.failure = null;
      agRun.attempt = (agRun.attempt || 1) + 1;
      await runEvent("run_resumed", "Run resumed at " + (agRun.phase || "model"));
    } else {
      const imgs = agImgs.slice();
      agImgs = [];
      renderThumbs();
      const utext = text || "Look at the attached image" + (imgs.length > 1 ? "s" : "") + ".";
      const cp = await createCheckpoint("Before: " + utext.slice(0, 72), "run_start");
      await startRunRecord(cp, utext);
      imgs.forEach((im) => txDom("img", im.url, false, { run: agRun.id }));
      txDom("u", utext, false, { checkpoint: cp && cp.id, run: agRun.id });
      agMsgs.push({
        role: "user",
        content: [
          ...imgs.map((im) => ({
            type: "image",
            source: { type: "base64", media_type: im.media_type, data: im.data },
          })),
          { type: "text", text: utext },
        ],
      });
      await saveActiveThreadNow();
    }
    if (agRun.pendingTools && agRun.pendingTools.length) {
      if (!(await completePendingTools(turnNb))) {
        paused = agRun.status === "paused";
        return;
      }
    }
    for (;;) {
      if (agPauseRequested) {
        await pauseRun("Paused by the human", "between_models");
        paused = true;
        return;
      }
      if (await enforceRunBudget("between_models")) {
        paused = true;
        return;
      }
      agRun.phase = "model";
      agRun.modelCalls = (agRun.modelCalls || 0) + 1;
      await runEvent("model_requested", AG_PROVIDER_DEFS[agProvider].label + " · " + agModel);
      const w = txDom("w", "calling " + agModel + "…", false, { ephemeral: true, run: agRun.id });
      let content;
      try {
        content = await apiStreamWithRetry();
      } finally {
        w.remove();
      }
      agMsgs.push({ role: "assistant", content });
      await runEvent("model_responded", (content.filter((b) => b.type === "tool_use").length || 0) + " tool call(s)");
      await saveActiveThreadNow();
      const tus = content.filter((b) => b.type === "tool_use");
      if (!tus.length) {
        const completion = await enforceCompletionContract();
        if (completion === "continue") continue;
        if (completion === "paused") {
          paused = true;
          break;
        }
        const previousRunCheckpoint = agRun.checkpointId || null,
          previousCurrent = agCurrentCheckpoint,
          completionCheckpoint = await createCheckpoint("Completion candidate", "run_complete_pending", agRun),
          postCheckpointReason = completionContractReason();
        if (postCheckpointReason) {
          const guarded = await enforceCompletionContract();
          await discardCompletionCheckpoint(
            completionCheckpoint,
            previousRunCheckpoint,
            previousCurrent,
            postCheckpointReason,
          );
          if (guarded === "paused") {
            paused = true;
            break;
          }
          continue;
        }
        if (completionCheckpoint) {
          completionCheckpoint.label = "Completed run";
          completionCheckpoint.reason = "run_complete";
        }
        await finalizeRun("completed", "Run completed after completion contract");
        if (completionCheckpoint) await kdbPut("checkpoints", completionCheckpoint);
        break;
      }
      agRun.pendingTools = clonePlain(tus);
      agRun.pendingToolResults = {};
      agRun.pendingMutations = [];
      agRun.nextToolIndex = 0;
      await saveRun(agRun);
      if (!(await completePendingTools(turnNb))) {
        paused = agRun.status === "paused";
        break;
      }
    }
  } catch (err) {
    const msg = redactText(String(err && err.message ? err.message : err));
    if (err && err.name === "AbortError") {
      if (agAbortReason === "pause") {
        await pauseRun("Paused by the human", agRun && agRun.phase);
        paused = true;
      } else if (agAbortReason === "user_stop" || agStop) {
        txDom("s", "stopped");
        await finalizeRun("stopped", "Stopped by the human");
      } else {
        const label =
          agAbortReason === "connection_timeout"
            ? "Connection timed out before the stream opened"
            : "The model stream stalled";
        txDom("e", label);
        await finalizeRun("failed", label);
      }
    } else if (nbId !== turnNb) {
      if (agRun) await finalizeRun("stopped", "Notebook changed during the run");
    } else {
      txDom("e", msg);
      await finalizeRun("failed", msg);
    }
  } finally {
    if (!paused) agPauseRequested = false;
    agRunning = false;
    agAbort = null;
    agAbortReason = "";
    activeToolContext = null;
    resolveApproval(false);
    agStateUi();
    progressOff();
    txPersist();
    agSaveMsgs();
    renderRunControl();
  }
}
