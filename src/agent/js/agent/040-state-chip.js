/* ── state chip ── */
function agStateUi() {
  const st = $("#agState");
  if (agRunning) {
    st.textContent = "RUNNING · " + AG_PROVIDER_DEFS[agProvider].label.toUpperCase();
    st.className = "ag-state run";
  } else if (agKey) {
    st.textContent = "READY · " + AG_PROVIDER_DEFS[agProvider].label.toUpperCase();
    st.className = "ag-state armed";
    st.title = "Connected to " + AG_PROVIDER_DEFS[agProvider].label + " · " + agModel;
  } else {
    st.textContent = "ADD API KEY";
    st.className = "ag-state nokey";
    st.title = "Add a provider key to start the agent";
  }
  $("#agMode").textContent = agAutonomy.toUpperCase();
  $("#agMode").classList.toggle("step", agAutonomy === "step");
  const mc = $("#agModelChip");
  if (mc) {
    mc.textContent =
      AG_PROVIDER_DEFS[agProvider].label + " · " + agModel.replace(/^claude-/, "").replace(/-\d{8}$/, "");
    mc.classList.toggle("step", /opus|reason/i.test(agModel));
    const caps = (agModelInfo && agModelInfo.capabilities) || modelCapabilities(agProvider, agModel, {}),
      tags = [fmtTok(agCtxLimit()) + " context"];
    if (caps.vision) tags.push("vision");
    if (caps.reasoning) tags.push("reasoning");
    if (caps.tools) tags.push("tools");
    mc.title = tags.join(" · ") + " · click for provider settings";
  }
  $("#agSteps").textContent = agRunning
    ? "TOOL " +
      ((agRun && agRun.toolCalls) || agSteps) +
      "/" +
      ((agRun && agRun.budgets && agRun.budgets.maxToolCalls) || agMaxSteps)
    : "";
  $("#agStop").style.display = agRunning ? "" : "none";
  $("#agSend").disabled = agRunning;
  renderRunUi();
}
