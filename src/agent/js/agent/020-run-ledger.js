/* ── durable run ledger and checkpoints ── */
const RUN_TERMINAL = new Set(["completed", "stopped", "abandoned"]);
const MUTATING_TOOLS = new Set([
  "add_cells",
  "run_cell",
  "run_all",
  "edit_cell",
  "save_data_file",
  "set_artifact_stage",
  "set_notebook_name",
  "delete_cell",
  "move_cell",
]);
function runId() {
  return "r_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
}
function checkpointId() {
  return "cp_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
}
function runElapsed(r) {
  if (!r) return 0;
  return (r.activeElapsedMs || 0) + (r.activeSince ? Math.max(0, Date.now() - r.activeSince) : 0);
}
/* Effective tokens weight provider-reported cache reads at 10% (their approximate price), so a well-cached run is budgeted by what it costs rather than by repeated prefix traffic. */
function effectiveTokens(u) {
  u = u || {};
  return Math.max(0, (u.input || 0) - 0.9 * (u.cached || 0) + (u.output || 0));
}
function runTokens(r) {
  if (!r) return 0;
  return Math.max(0, Math.round(effectiveTokens(agUsage()) - effectiveTokens(r.usageStart)));
}
function recordedRunTokens(r) {
  return Math.max(
    0,
    Math.round(effectiveTokens(r && (r.usageEnd || r.usageCurrent)) - effectiveTokens(r && r.usageStart)),
  );
}
function runBudgetReasons(r) {
  if (!r) return [];
  const b = r.budgets || {},
    out = [];
  if ((r.toolCalls || 0) >= (b.maxToolCalls || Infinity)) out.push("tool call budget reached");
  if ((b.maxElapsedMs || 0) && runElapsed(r) >= b.maxElapsedMs) out.push("active time budget reached");
  if ((b.maxTotalTokens || 0) && runTokens(r) >= b.maxTotalTokens) out.push("token budget reached");
  return out;
}
function runBudgetReason(r) {
  return runBudgetReasons(r)[0] || "";
}
function runPlanSignature() {
  return JSON.stringify((agPlan || []).map((s) => [s.id, s.title, s.status]));
}
function durableStateSignature() {
  const cellState = (cells || []).map((c) => [
      c.id,
      c.type,
      sourceHash(c.taEl ? c.taEl.value : c.source),
      c.execCount == null ? null : c.execCount,
      (c.outputs || []).length,
      (c.outputs || []).some((o) => o.kind === "error") ? "error" : "ok",
    ]),
    artifactState = (dataFiles || [])
      .map((d) => [d.id, d.path || d.name, artifactStage(d), artifactFingerprint(d), d.size || 0])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return sourceHash(JSON.stringify([nbId, nbName, cellState, artifactState]));
}
function noteRunProgress(kind) {
  if (!agRun) return;
  agRun.progressVersion = (agRun.progressVersion || 0) + 1;
  agRun.lastProgress = { at: Date.now(), kind: String(kind || "notebook") };
  agRun.completionAccepted = null;
  agRun.completionGuardCount = 0;
  agRun.completionPauseReason = "";
}
function validateCompletionEvidence(items) {
  const evidence = [],
    errors = [];
  for (const raw of (Array.isArray(items) ? items : []).slice(0, 20)) {
    const kind = raw && raw.kind,
      id = String((raw && raw.id) || ""),
      claim = String((raw && raw.claim) || "")
        .trim()
        .slice(0, 500);
    if (!claim) {
      errors.push("evidence claim is empty");
      continue;
    }
    if (kind === "cell") {
      const c = findCell(id);
      if (!c) {
        errors.push("cell " + id + " does not exist");
        continue;
      }
      if (getCellContextPolicy(c.id) === "excluded") {
        errors.push("cell " + id + " is excluded");
        continue;
      }
      const state = cellFreshness(c).state;
      if (c.type === "code" && c.execCount == null) {
        errors.push("code cell " + id + " has not executed");
        continue;
      }
      if (c.type === "code" && (c.outputs || []).some((o) => o.kind === "error")) {
        errors.push("code cell " + id + " currently ends in an error");
        continue;
      }
      if (c.type === "code" && state !== "fresh") {
        errors.push("code cell " + id + " is not fresh (" + state + ")");
        continue;
      }
      if (c.type !== "code" && !String(c.taEl ? c.taEl.value : c.source || "").trim()) {
        errors.push("markdown cell " + id + " is empty");
        continue;
      }
      evidence.push({
        kind: "cell",
        id: c.id,
        claim,
        cellType: c.type,
        executionCount: c.execCount == null ? null : c.execCount,
        freshness: state,
        sourceHash: sourceHash(c.taEl ? c.taEl.value : c.source),
      });
    } else if (kind === "artifact") {
      const d = dataEntry(id);
      if (!d || d.id !== id) {
        errors.push("artifact " + id + " does not exist by stable ID");
        continue;
      }
      if (getArtifactContextPolicy(d.id) === "excluded") {
        errors.push("artifact " + id + " is excluded");
        continue;
      }
      evidence.push({
        kind: "artifact",
        id: d.id,
        claim,
        path: d.path || d.name,
        stage: artifactStage(d),
        fingerprint: artifactFingerprint(d),
        size: d.size || 0,
      });
    } else errors.push("evidence kind must be cell or artifact");
  }
  return { evidence, errors };
}
function completionEvidenceSignature(items) {
  return JSON.stringify(
    (items || []).map((item) =>
      item.kind === "cell"
        ? ["cell", item.id, item.claim, item.cellType, item.executionCount, item.freshness, item.sourceHash]
        : ["artifact", item.id, item.claim, item.path, item.stage, item.fingerprint, item.size],
    ),
  );
}
async function recordCompletionRejection(reason) {
  if (!agRun) return { count: 0, pause: false };
  agRun.completionAccepted = null;
  agRun.completionGuardCount = (agRun.completionGuardCount || 0) + 1;
  const pause = agRun.completionGuardCount > 2;
  if (pause) agRun.completionPauseReason = reason;
  await runEvent("completion_rejected", reason);
  return { count: agRun.completionGuardCount, pause };
}
function extendRunBudgets(r, reasons, configured) {
  if (!r) return [];
  const b = r.budgets || (r.budgets = {}),
    done = [];
  for (const reason of reasons || []) {
    if (reason === "tool call budget reached") {
      const n = Math.max(1, (configured && configured.tools) || b.toolSegment || agMaxSteps);
      b.maxToolCalls = (b.maxToolCalls || 0) + n;
      done.push(n + " tools");
    } else if (reason === "active time budget reached") {
      const n = Math.max(60000, (configured && configured.elapsedMs) || b.elapsedSegmentMs || agMaxMinutes * 60000);
      b.maxElapsedMs = (b.maxElapsedMs || 0) + n;
      done.push(Math.round(n / 60000) + " active minutes");
    } else if (reason === "token budget reached") {
      const n = Math.max(1000, (configured && configured.tokens) || b.tokenSegment || agTokenBudget);
      b.maxTotalTokens = (b.maxTotalTokens || 0) + n;
      done.push(fmtTok(n) + " tokens");
    }
  }
  return done;
}
async function maybeAutoExtendBudgets(reasons) {
  if (!agRun || !reasons || !reasons.length) return false;
  const b = agRun.budgets || {},
    hard = reasons.includes("token budget reached"),
    soft = reasons.filter((x) => x !== "token budget reached"),
    limit = Math.max(0, b.maxAutoExtensions || 0),
    used = Math.max(0, agRun.autoExtensionsUsed || 0),
    progress = agRun.progressVersion || 0,
    last = agRun.lastAutoExtensionProgress == null ? 0 : agRun.lastAutoExtensionProgress;
  if (
    (agRun.autonomy || agAutonomy) !== "auto" ||
    hard ||
    !soft.length ||
    used >= limit ||
    progress <= last ||
    (agRun.consecutiveToolFailures || 0) >= 2
  )
    return false;
  const added = extendRunBudgets(agRun, soft);
  agRun.autoExtensionsUsed = used + 1;
  agRun.lastAutoExtensionProgress = progress;
  await runEvent(
    "budget_auto_extended",
    soft.join(" + ") + " · added " + added.join(" + ") + " while progress remained healthy",
  );
  return true;
}
async function enforceRunBudget(phase) {
  const reasons = runBudgetReasons(agRun);
  if (!reasons.length) return false;
  if (await maybeAutoExtendBudgets(reasons)) return false;
  const reason = reasons.join(" + ");
  await runEvent("budget_reached", reason);
  await pauseRun(reason, phase);
  return true;
}
async function saveRun(r) {
  if (!r) return;
  r.updated = Date.now();
  r.usageCurrent = agUsage();
  await kdbPut("runs", clonePlain(r));
  renderRunUi();
}
async function runEvent(type, summary, extra) {
  if (!agRun) return null;
  agRun.seq = (agRun.seq || 0) + 1;
  const ev = Object.assign({}, extra || {}, {
    seq: agRun.seq,
    at: Date.now(),
    type,
    phase: agRun.phase || "",
    summary: String(summary || "").slice(0, 500),
  });
  agRun.events = agRun.events || [];
  agRun.events.push(ev);
  await saveRun(agRun);
  return ev;
}
function currentPlanStep() {
  return (
    (agPlan || []).find((s) => s.status === "in_progress") || (agPlan || []).find((s) => s.status === "pending") || null
  );
}
function renderPlanStrip() {
  const p = currentPlanStep(),
    el = $("#agPlanStrip");
  if (!el) return;
  el.classList.toggle("show", !!p);
  $("#agPlanCurrent").textContent = p ? p.title : "";
}
function renderRunUi() {
  const m = $("#agRunMetrics"),
    pause = $("#agPause"),
    rec = $("#agRecovery");
  if (!m) return;
  renderPlanStrip();
  const cp = $("#agCheckpoint"),
    pendingBoundary = !!(agRun && agRun.pendingTools && agRun.pendingTools.length);
  if (cp) {
    cp.disabled = agRunning || busy || pendingBoundary;
    cp.title = pendingBoundary
      ? "Resume or end the pending tool batch before checkpointing"
      : "Create a point-in-time checkpoint";
  }
  if (agRun) {
    const tok = runTokens(agRun),
      mins = runElapsed(agRun) / 60000,
      ext = agRun.autoExtensionsUsed ? " · AUTO +" + agRun.autoExtensionsUsed : "";
    m.textContent =
      (agRun.status || "").toUpperCase() +
      " · " +
      (agRun.toolCalls || 0) +
      "/" +
      ((agRun.budgets && agRun.budgets.maxToolCalls) || agMaxSteps) +
      " TOOLS · " +
      fmtTok(tok) +
      " TOK · " +
      mins.toFixed(1) +
      " MIN" +
      ext;
    m.title =
      "Tool calls used / checkpoint · effective tokens (cache reads count 10%) · active minutes" +
      (ext ? " · automatic extensions used" : "");
    pause.hidden = !agRunning;
    pause.textContent = agPauseRequested ? "PAUSING…" : "PAUSE";
  } else {
    m.textContent = "NO ACTIVE RUN";
    pause.hidden = true;
  }
  const recover = agRun && ["paused", "failed", "interrupted"].includes(agRun.status) && !agRunning;
  rec.classList.toggle("show", !!recover);
  if (recover) {
    const copy = recoveryCopy(agRun);
    rec.classList.toggle("calm", copy.calm);
    $("#agRecoveryTitle").textContent = copy.title;
    $("#agRecoveryText").textContent = copy.text;
    const b = agRun.budgets || {},
      ratio = Math.max(
        b.maxToolCalls ? (agRun.toolCalls || 0) / b.maxToolCalls : 0,
        b.maxElapsedMs ? runElapsed(agRun) / b.maxElapsedMs : 0,
        b.maxTotalTokens ? runTokens(agRun) / b.maxTotalTokens : 0,
      );
    $("#agRecoveryBudget").firstElementChild.style.width = Math.min(100, ratio * 100) + "%";
    $("#agRecoveryBudget").classList.toggle("warn", ratio >= 0.8);
  }
}
/* Plain-language summary of why a run stopped and what Resume will do. */
function recoveryCopy(r) {
  const reason = String(r.pauseReason || ""),
    left = (agPlan || []).filter((s) => s.status !== "completed");
  if (r.status === "interrupted")
    return {
      calm: false,
      title: "INTERRUPTED",
      text:
        "The page closed while the agent was working. Resume continues from the last saved step" +
        (r.phase === "tool"
          ? "; the agent will check the notebook first because the last action may not have finished."
          : "."),
    };
  if (r.status === "failed")
    return {
      calm: false,
      title: "STOPPED BY AN ERROR",
      text:
        ((r.failure && r.failure.message) || "The provider request failed.") +
        " Resume retries from the last saved step.",
    };
  if (r.phase === "completion")
    return {
      calm: true,
      title: "PLAN NOT FINISHED",
      text:
        "The agent stopped before completing its plan" +
        (left.length
          ? " (" +
            left.length +
            " step" +
            (left.length === 1 ? "" : "s") +
            " left: " +
            left.map((s) => s.title || s.id).join("; ") +
            ")"
          : "") +
        ". Resume to let it continue, or end the run.",
    };
  if (/budget reached/.test(reason))
    return {
      calm: true,
      title: "CHECKPOINT REACHED",
      text:
        "This run used its " +
        reason.replace(/ budget reached/g, "").replace(/ \+ /g, " and ") +
        " allowance. Resume to continue with a fresh allowance, or end the run.",
    };
  if (/human/i.test(reason)) return { calm: true, title: "PAUSED", text: "Resume whenever you are ready." };
  return { calm: true, title: "PAUSED", text: reason || "Resume to continue from the last saved step." };
}
let runRenderSeq = 0;
function runRow(title, meta, body, actions) {
  const el = document.createElement("div");
  el.className = "run-row";
  const h = document.createElement("div");
  h.className = "run-row-h";
  const b = document.createElement("b");
  b.textContent = title;
  h.appendChild(b);
  if (meta) {
    const m = document.createElement("span");
    m.textContent = meta;
    h.appendChild(m);
  }
  el.appendChild(h);
  if (body) {
    const p = document.createElement("div");
    p.className = "run-row-p";
    p.textContent = body;
    el.appendChild(p);
  }
  if (actions && actions.length) {
    const a = document.createElement("div");
    a.className = "run-row-actions";
    for (const spec of actions) {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = spec.label;
      for (const [k, v] of Object.entries(spec.data || {})) btn.dataset[k] = v;
      a.appendChild(btn);
    }
    el.appendChild(a);
  }
  return el;
}
function renderComparisonResults() {
  const host = $("#compareResults");
  if (!host) return;
  host.replaceChildren();
  for (const item of agComparisons || []) {
    const card = document.createElement("article");
    card.className = "compare-card" + (item.error ? " err" : "");
    const h = document.createElement("h4");
    h.textContent = item.provider + " · " + item.model;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = item.error
      ? "FAILED"
      : Math.round(item.latencyMs || 0) +
        " MS · " +
        fmtTok(item.inputTokens || 0) +
        " IN · " +
        fmtTok(item.outputTokens || 0) +
        " OUT";
    const ans = document.createElement("div");
    ans.className = "answer";
    if (item.error) ans.textContent = item.error;
    else ans.innerHTML = renderMarkdown(item.text || "(no text returned)");
    card.append(h, meta, ans);
    host.appendChild(card);
  }
  if (!(agComparisons || []).length) {
    const empty = document.createElement("div");
    empty.className = "run-empty";
    empty.textContent =
      "Run a read-only comparison to inspect several configured provider/model profiles without giving them tools or write access.";
    host.appendChild(empty);
  }
}
async function renderRunControl() {
  const seq = ++runRenderSeq;
  renderRunUi();
  const plan = $("#runPlan"),
    timeline = $("#runTimeline"),
    graph = $("#runNotebook");
  if (!plan || !timeline || !graph) return;
  plan.replaceChildren();
  if (agPlan.length) {
    for (const s of agPlan) {
      const row = document.createElement("div");
      row.className = "plan-step " + s.status;
      const dot = document.createElement("span");
      dot.className = "plan-state";
      const title = document.createElement("div");
      title.className = "plan-title";
      title.textContent = s.title;
      const id = document.createElement("span");
      id.className = "plan-id";
      id.textContent = s.id;
      row.append(dot, title, id);
      plan.appendChild(row);
    }
  } else {
    const e = document.createElement("div");
    e.className = "run-empty";
    e.textContent = "No published plan yet. Multi-step agents can expose progress here with update_plan.";
    plan.appendChild(e);
  }
  timeline.replaceChildren();
  const events = (agRun && agRun.events) || [];
  if (events.length) {
    for (const ev of events.slice().reverse())
      timeline.appendChild(
        runRow(
          ev.type.replace(/_/g, " "),
          (ev.phase || "run") + " · " + new Date(ev.at).toLocaleTimeString(),
          ev.summary || "",
        ),
      );
  } else {
    const e = document.createElement("div");
    e.className = "run-empty";
    e.textContent = "No run events for this thread yet.";
    timeline.appendChild(e);
  }
  recomputeDependencies();
  graph.replaceChildren();
  for (const c of cells) {
    const deps = (c.dependencies || [])
      .map((id) => {
        const x = findCell(id);
        return x ? "[" + (indexOf(x) + 1) + "]" : id;
      })
      .join(", ");
    const files = (c.analysis && c.analysis.files) || [];
    graph.appendChild(
      runRow(
        "[" + (indexOf(c) + 1) + "] " + c.type,
        (c.freshness || "never").toUpperCase(),
        (c.analysis && c.analysis.uncertain ? "Dynamic code; dependencies are conservative.\n" : "") +
          (deps ? "Depends on " + deps + "\n" : "") +
          (files.length ? "Reads " + files.join(", ") : ""),
        [
          { label: getCellContextPolicy(c.id).toUpperCase(), data: { runCellContext: c.id } },
          { label: "FOCUS", data: { runFocus: c.id } },
        ],
      ),
    );
  }
  renderComparisonResults();
  const [checkpoints, runs] = await Promise.all([kdbCheckpoints(nbId, agThreadId), kdbRuns(nbId, agThreadId)]);
  if (seq !== runRenderSeq) return;
  runs.sort((a, b) => (b.started || 0) - (a.started || 0));
  if (runs.length) {
    const frag = document.createDocumentFragment();
    for (const r of runs.slice(0, 30))
      frag.appendChild(
        runRow(
          (r.status || "run").toUpperCase(),
          new Date(r.started || r.updated).toLocaleString(),
          (r.promptLabel || "(resumed run)") +
            "\n" +
            (r.model || "") +
            " · " +
            (r.modelCalls || 0) +
            " model · " +
            (r.toolCalls || 0) +
            " tools · " +
            fmtTok(recordedRunTokens(r)) +
            " effective tokens" +
            (r.modelRetries ? " · " + r.modelRetries + " retries" : ""),
        ),
      );
    const div = document.createElement("div");
    div.className = "data-group";
    div.textContent = "RUN HISTORY";
    timeline.prepend(div, frag);
  }
  checkpoints.sort((a, b) => (b.created || 0) - (a.created || 0));
  const cpHost = $("#runCheckpoints");
  cpHost.replaceChildren();
  if (checkpoints.length) {
    for (const cp of checkpoints)
      cpHost.appendChild(
        runRow(
          cp.label,
          new Date(cp.created).toLocaleString(),
          (cp.reason || "checkpoint") + (cp.runId ? " · run " + cp.runId : ""),
          [
            { label: "RESTORE", data: { runRestore: cp.id } },
            { label: "FORK", data: { runFork: cp.id } },
          ],
        ),
      );
  } else {
    const e = document.createElement("div");
    e.className = "run-empty";
    e.textContent = "No checkpoints yet. KERNEL creates them before runs and after committed mutating tool batches.";
    cpHost.appendChild(e);
  }
}
async function startRunRecord(checkpoint, prompt) {
  agRun = {
    id: runId(),
    notebookId: nbId,
    threadId: agThreadId,
    threadKey: nbId + ":" + agThreadId,
    status: "running",
    phase: "model",
    provider: agProvider,
    model: agModel,
    autonomy: agAutonomy,
    started: Date.now(),
    updated: Date.now(),
    activeSince: Date.now(),
    activeElapsedMs: 0,
    attempt: 1,
    toolCalls: 0,
    modelCalls: 0,
    usageStart: agUsage(),
    budgets: {
      maxToolCalls: agMaxSteps,
      maxElapsedMs: agMaxMinutes * 60000,
      maxTotalTokens: agTokenBudget,
      toolSegment: agMaxSteps,
      elapsedSegmentMs: agMaxMinutes * 60000,
      tokenSegment: agTokenBudget,
      maxAutoExtensions: agAutonomy === "auto" ? agAutoExtensions : 0,
    },
    progressVersion: 0,
    lastAutoExtensionProgress: 0,
    autoExtensionsUsed: 0,
    completionGuardCount: 0,
    completionAccepted: null,
    consecutiveToolFailures: 0,
    checkpointId: (checkpoint && checkpoint.id) || null,
    promptLabel: String(prompt || "").slice(0, 120),
    seq: 0,
    events: [],
    completedToolResults: {},
  };
  await saveRun(agRun);
  await runEvent("run_started", "Run started");
  return agRun;
}
async function pauseRun(reason, phase) {
  if (!agRun) return;
  agRun.activeElapsedMs = runElapsed(agRun);
  agRun.activeSince = null;
  agRun.status = "paused";
  agRun.phase = phase || agRun.phase || "between_tools";
  agRun.pauseReason = reason || "Paused";
  await runEvent("run_paused", agRun.pauseReason);
  agRunning = false;
  agPauseRequested = false;
  agStateUi();
  progressOff();
  await saveActiveThreadNow();
}
async function finalizeRun(status, summary) {
  if (!agRun) return;
  agRun.activeElapsedMs = runElapsed(agRun);
  agRun.activeSince = null;
  agRun.status = status;
  agRun.terminalFrom = agRun.phase || null;
  agRun.phase = "terminal";
  agRun.finished = Date.now();
  agRun.usageEnd = agUsage();
  if (summary && status === "failed") agRun.failure = { message: String(summary).slice(0, 500) };
  await runEvent("run_" + status, summary || status);
  await saveActiveThreadNow();
}
async function createCheckpoint(label, reason, run) {
  if (!nbId || busy) return null;
  if (run && run.pendingTools && run.pendingTools.length) {
    toast("Resume or end the pending tool batch before checkpointing.", "err");
    return null;
  }
  persist();
  await saveActiveThreadNow();
  const ws = await saveWorkspaceState(),
    id = checkpointId(),
    cp = {
      id,
      notebookId: nbId,
      threadId: agThreadId,
      threadKey: nbId + ":" + agThreadId,
      runId: (run && run.id) || null,
      created: Date.now(),
      label: String(label || "Checkpoint").slice(0, 100),
      reason: reason || "manual",
      cells: clonePlain(cellPayload()),
      workspace: kdbClone(ws),
      thread: {
        id: agThreadId,
        name: (readThreadIndex(nbId).threads.find((t) => t.id === agThreadId) || {}).name || "Thread",
        messages: clonePlain(agMsgs),
        transcript: txEntries(),
        usage: agUsage(),
        provider: agProvider,
        model: agModel,
        plan: clonePlain(agPlan),
        contextPolicies: clonePlain(agContextPolicies),
      },
      environment: clonePlain(environmentSnapshot || null),
    };
  await kdbPut("checkpoints", cp);
  agCurrentCheckpoint = id;
  if (run) {
    run.checkpointId = id;
    await runEvent("checkpoint_created", cp.label, { checkpointId: id });
  }
  renderRunControl();
  return cp;
}
async function discardCompletionCheckpoint(cp, previousRunCheckpoint, previousCurrent, reason) {
  if (!cp) return;
  await kdbDelete("checkpoints", cp.id);
  scheduleBlobGc();
  if (agRun && agRun.checkpointId === cp.id) agRun.checkpointId = previousRunCheckpoint || null;
  if (agCurrentCheckpoint === cp.id) agCurrentCheckpoint = previousCurrent || null;
  await runEvent(
    "checkpoint_discarded",
    "Completion candidate discarded: " + String(reason || "evidence changed").slice(0, 380),
    { checkpointId: cp.id },
  );
  renderRunControl();
}
async function repairInterruptedRun(r) {
  if (!r || !["running", "pausing"].includes(r.status)) return r;
  r.status = "interrupted";
  r.phase = r.phase || "model";
  r.activeElapsedMs = runElapsed(r);
  r.activeSince = null;
  r.failure = {
    message:
      r.phase === "tool"
        ? "A tool was active when the page closed; its outcome may be unknown."
        : "The page closed before the run reached a terminal state.",
  };
  agRun = r;
  await runEvent("recovery_detected", r.failure.message);
  const calls = [];
  for (const m of agMsgs) for (const b of m.content || []) if (b.type === "tool_use") calls.push(b);
  const done = new Set();
  for (const m of agMsgs) for (const b of m.content || []) if (b.type === "tool_result") done.add(b.tool_use_id);
  const missing = calls.filter((c) => !done.has(c.id));
  if (missing.length) {
    const blocks = missing.map((c) => ({
      type: "tool_result",
      tool_use_id: c.id,
      content: (r.completedToolResults && r.completedToolResults[c.id]) || [
        {
          type: "text",
          text: "KERNEL recovery: execution outcome was not durably confirmed. Inspect notebook state before repeating this action.",
        },
      ],
    }));
    agMsgs.push({ role: "user", content: blocks });
    r.pendingTools = [];
    r.pendingToolResults = {};
    r.pendingMutations = [];
    r.nextToolIndex = 0;
    await runEvent(
      "tool_batch_repaired",
      missing.length + " missing tool result" + (missing.length === 1 ? "" : "s") + " repaired",
    );
    await saveActiveThreadNow();
  }
  return r;
}
async function loadRunForThread() {
  const rows = await kdbRuns(nbId, agThreadId);
  rows.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  let r = rows[0] || null;
  if (r) r = await repairInterruptedRun(r);
  agRun = r && (!RUN_TERMINAL.has(r.status) || Date.now() - (r.finished || 0) < 3600000) ? r : null;
  renderRunUi();
  return agRun;
}
window.addEventListener("unhandledrejection", (e) => {
  try {
    if (agRunning && agRun) {
      const msg = String(e.reason && e.reason.message ? e.reason.message : e.reason);
      runEvent("internal_error", redactText(msg));
    }
  } catch (_) {}
});
