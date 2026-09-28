/* ── settings ── */
function agEffortChoices(provider) {
  return provider === "anthropic"
    ? [
        ["off", "Provider default"],
        ["low", "Low"],
        ["medium", "Medium"],
        ["high", "High"],
        ["xhigh", "Extra high"],
        ["max", "Max"],
      ]
    : [
        ["off", "Provider default"],
        ["low", "Low"],
        ["medium", "Medium"],
        ["high", "High"],
      ];
}
function fillAgSettings() {
  const d = AG_PROVIDER_DEFS[agProvider],
    reason = $("#agReasoning"),
    choices = agEffortChoices(agProvider);
  $("#agProvider").value = agProvider;
  reason.replaceChildren(
    ...choices.map(([value, label]) => {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = label;
      return o;
    }),
  );
  reason.value = choices.some((c) => c[0] === agReasoning) ? agReasoning : "off";
  reason.disabled = false;
  reason.title =
    agProvider === "anthropic"
      ? "Claude adaptive thinking depth (output_config.effort). Claude Opus 5.5 always thinks; effort controls how much."
      : "Responses reasoning effort";
  $("#agCellMinutes").value = agCellMinutes;
  $("#agKeyLabel").textContent = d.label.toUpperCase() + " API KEY";
  {
    const help = $("#agKeyHelp");
    if (help) help.href = d.keyUrl || "#";
  }
  $("#agKey").placeholder = d.placeholder;
  $("#agKey").value = agKey;
  $("#agBase").value = agBase;
  $("#agModel").value = agModel;
  $("#agOut").value = agMaxOut;
  $("#agCtxOverride").value = agCtxOverride || "";
  $("#agCompactAt").value = agCompactAt;
  $("#agMax").value = agMaxSteps;
  $("#agMinutes").value = agMaxMinutes;
  $("#agTokenBudget").value = agTokenBudget;
  $("#agAutoExtensions").value = agAutoExtensions;
  $("#agDiscovery").textContent = "";
}
function captureAgSettings() {
  agKey = $("#agKey").value.trim();
  agBase = ($("#agBase").value.trim() || AG_PROVIDER_DEFS[agProvider].base).replace(/\/+$/, "");
  agModel = $("#agModel").value.trim() || AG_PROVIDER_DEFS[agProvider].model;
  agMaxOut = Math.max(512, Math.min(128000, parseInt($("#agOut").value, 10) || AG_PROVIDER_DEFS[agProvider].maxOut));
  const rawCtx = parseInt($("#agCtxOverride").value, 10) || 0;
  agCtxOverride = rawCtx ? Math.max(8192, Math.min(4000000, rawCtx)) : 0;
  agCompactAt = Math.max(50, Math.min(95, parseInt($("#agCompactAt").value, 10) || 82));
  agMaxSteps = Math.max(4, Math.min(200, parseInt($("#agMax").value, 10) || 24));
  agMaxMinutes = Math.max(1, Math.min(720, parseInt($("#agMinutes").value, 10) || 30));
  agTokenBudget = Math.max(1000, Math.min(10000000, parseInt($("#agTokenBudget").value, 10) || 500000));
  agAutoExtensions = Math.max(0, Math.min(20, parseInt($("#agAutoExtensions").value, 10) || 0));
  agCellMinutes = Math.max(1, Math.min(240, parseInt($("#agCellMinutes").value, 10) || 10));
  agReasoning = $("#agReasoning").value || "off";
  agConfigs[agProvider] = {
    key: agKey,
    base: agBase,
    model: agModel,
    maxOut: agMaxOut,
    ctxOverride: agCtxOverride,
    compactAt: agCompactAt,
    reasoning: agReasoning,
    rev: AG_CONFIG_REV,
  };
}
function openAgSettings() {
  fillAgSettings();
  syncAgAuto();
  $("#agScrim").classList.add("show");
  $("#agKey").focus();
}
function closeAgSettings() {
  $("#agScrim").classList.remove("show");
}
function syncAgAuto() {
  $("#agAutoBtn").classList.toggle("active", agAutonomy === "auto");
  $("#agStepBtn").classList.toggle("active", agAutonomy === "step");
}
$("#agState").addEventListener("click", () => {
  if (!agKey && !agRunning) openAgSettings();
});
$("#agSettings").addEventListener("click", () => {
  if (agRunning) {
    toast("Finish or stop the current turn first.", "err");
    return;
  }
  openAgSettings();
});
$("#agExport").addEventListener("click", agExportMd);
$("#agX").addEventListener("click", closeAgSettings);
$("#agAutoBtn").addEventListener("click", () => {
  agAutonomy = "auto";
  syncAgAuto();
});
$("#agStepBtn").addEventListener("click", () => {
  agAutonomy = "step";
  syncAgAuto();
});
$("#agProvider").addEventListener("change", (e) => {
  captureAgSettings();
  agSaveProvider();
  agApplyProvider(e.target.value);
  agSaveProvider();
  fillAgSettings();
  agStateUi();
  meterUi();
});
$("#agDiscover").addEventListener("click", async () => {
  captureAgSettings();
  agSaveProvider();
  await discoverModels(true);
});
$("#agSave").addEventListener("click", () => {
  captureAgSettings();
  agSaveProvider();
  closeAgSettings();
  agModelInfo = null;
  agFetchModelInfo();
  agStateUi();
  meterUi();
  scheduleThreadSave();
});
$("#agClear").addEventListener("click", () => {
  agKey = "";
  $("#agKey").value = "";
  agSaveProvider();
  agStateUi();
});
$("#agScrim").addEventListener("mousedown", (e) => {
  if (e.target === $("#agScrim")) closeAgSettings();
});
[
  "agKey",
  "agBase",
  "agModel",
  "agOut",
  "agCtxOverride",
  "agCompactAt",
  "agMax",
  "agMinutes",
  "agTokenBudget",
  "agAutoExtensions",
  "agCellMinutes",
].forEach((id) => {
  document.getElementById(id).addEventListener("keydown", (e) => e.stopPropagation());
});

function openContext() {
  const ctx = prepareContext(),
    s = ctx.stats,
    limit = s.limit || 1,
    pct = Math.min(100, Math.round((s.active / limit) * 100));
  $("#ctxFull").textContent = fmtTok(s.full);
  $("#ctxActive").textContent = fmtTok(s.active);
  $("#ctxInput").textContent = fmtTok(agUseIn);
  $("#ctxOutput").textContent = fmtTok(agUseOut);
  $("#ctxBar").firstElementChild.style.width = pct + "%";
  $("#ctxBar").classList.toggle("warn", pct >= agCompactAt || s.unfit);
  $("#ctxNote").textContent = s.unfit
    ? ctx.reason
    : s.compacted
      ? s.compacted +
        " earlier turn" +
        (s.compacted === 1 ? "" : "s") +
        " compacted for the active request. Full local history is untouched."
      : "The complete thread currently fits in the active model payload.";
  $("#ctxUsageDetail").textContent =
    AG_PROVIDER_DEFS[agProvider].label +
    " · " +
    agModel +
    " · " +
    fmtTok(agCtxLimit()) +
    " context · " +
    fmtTok(s.reserve) +
    " output reserve · " +
    fmtTok(s.allowed) +
    " safe input" +
    (agModelInfo && agModelInfo.source ? " · " + agModelInfo.source : " · conservative fallback") +
    " · " +
    fmtTok(agUseCr) +
    " cache read · " +
    fmtTok(agUseCw) +
    " cache write · " +
    fmtTok(agUseReason) +
    " reasoning";
  const pins = [];
  for (const c of cells) {
    const p = getCellContextPolicy(c.id);
    if (p !== "auto") pins.push("CELL [" + (indexOf(c) + 1) + "] · " + p.toUpperCase());
  }
  for (const d of dataFiles) {
    const p = getArtifactContextPolicy(d.id);
    if (p !== "auto") pins.push("ARTIFACT " + d.name + " · " + p.toUpperCase());
  }
  pins.push("History pruning · " + fmtTok(s.pruned || 0) + " tokens removed from older rich results");
  $("#ctxSelection").textContent = pins.join("\n");
  $("#ctxScrim").classList.add("show");
}
function closeContext() {
  $("#ctxScrim").classList.remove("show");
}
$("#agContext").addEventListener("click", openContext);
$("#agUsage").addEventListener("click", openContext);
$("#ctxX").addEventListener("click", closeContext);
$("#ctxDone").addEventListener("click", closeContext);
$("#ctxExport").addEventListener("click", agExportMd);
$("#ctxReset").addEventListener("click", () => {
  if (agRunning) {
    toast("Usage cannot be reset during an active run.", "err");
    return;
  }
  agUseIn = agUseOut = agUseCw = agUseCr = agUseReason = 0;
  agSaveUsage();
  meterUi();
  openContext();
  toast("Usage counters reset.");
});
$("#ctxScrim").addEventListener("mousedown", (e) => {
  if (e.target === $("#ctxScrim")) closeContext();
});
$("#agThreadSelect").addEventListener("change", (e) => switchAgentThread(e.target.value));
$("#agThreadNew").addEventListener("click", createAgentThread);
$("#agThreadRename").addEventListener("click", renameAgentThread);
$("#agThreadDelete").addEventListener("click", deleteAgentThread);
