/* ── system prompt ── */
function agOutline() {
  if (!cells.length) return "(empty notebook)";
  const rows = cells
    .map((c, i) => {
      if (getCellContextPolicy(c.id) === "excluded") return null;
      const first = ((c.taEl ? c.taEl.value : c.source) || "").split("\n")[0].slice(0, 80);
      const tags = [];
      if (getCellContextPolicy(c.id) === "pinned") tags.push("PINNED");
      if (c.freshness === "stale") tags.push("STALE");
      if (c.analysis && c.analysis.uncertain) tags.push("DEPENDENCIES UNCERTAIN");
      return (
        "[" +
        i +
        "] " +
        c.id +
        " " +
        c.type +
        (c.execCount != null ? " · ran[" + c.execCount + "]" : "") +
        (tags.length ? " · " + tags.join(" · ") : "") +
        ' "' +
        first +
        '"'
      );
    })
    .filter(Boolean);
  const omitted = cells.length - rows.length;
  return rows.join("\n") + (omitted ? "\n(" + omitted + " cell(s) explicitly excluded by the human)" : "");
}
function pinnedOutputText(c) {
  return (c.outputs || [])
    .map((o) =>
      o.kind === "error"
        ? o.text || ""
        : o.kind === "stream" || o.kind === "text"
          ? o.text
          : o.kind === "html"
            ? String(o.html || "").replace(/<[^>]+>/g, " ")
            : o.kind === "image"
              ? "[figure handle: cell://" + c.id + "/outputs]"
              : o.kind === "iframe_html"
                ? "[interactive output handle: cell://" + c.id + "/outputs]"
                : "",
    )
    .filter(Boolean)
    .join("\n");
}
function buildPinnedContext() {
  const parts = [];
  for (const c of cells)
    if (getCellContextPolicy(c.id) === "pinned") {
      parts.push(
        "### Pinned cell " +
          c.id +
          " · " +
          c.type +
          " · " +
          (c.freshness || "never") +
          "\n" +
          agTrunc(c.taEl ? c.taEl.value : c.source, 8000) +
          (c.type === "code"
            ? "\nOutput handle: cell://" + c.id + "/outputs\n" + agTrunc(pinnedOutputText(c), 3500)
            : ""),
      );
    }
  for (const d of dataFiles)
    if (getArtifactContextPolicy(d.id) === "pinned")
      parts.push(
        "### Pinned artifact artifact://" +
          d.id +
          "\npath: " +
          d.name +
          "\nstage: " +
          artifactStage(d) +
          "\nsize: " +
          d.size +
          " bytes\nfingerprint: " +
          artifactFingerprint(d) +
          (d.preview ? "\npreview:\n" + agTrunc(d.preview, 3500) : ""),
      );
  return parts.length ? "## Human-pinned active context\n" + parts.join("\n\n") : "";
}
function agRunControlContext() {
  if (!agRun) return "## KERNEL-authoritative run control\nNo durable run is active.";
  const b = agRun.budgets || {},
    hits = runBudgetReasons(agRun),
    pending = (agPlan || []).filter((s) => s.status !== "completed"),
    tools = Math.max(0, (b.maxToolCalls || 0) - (agRun.toolCalls || 0)),
    mins = Math.max(0, ((b.maxElapsedMs || 0) - runElapsed(agRun)) / 60000),
    tokens = Math.max(0, (b.maxTotalTokens || 0) - runTokens(agRun));
  return (
    "## KERNEL-authoritative run control\nstatus: " +
    agRun.status +
    " · phase: " +
    agRun.phase +
    " · autonomy: " +
    (agRun.autonomy || agAutonomy) +
    "\nremaining before current checkpoint: " +
    tools +
    " tools · " +
    mins.toFixed(1) +
    " active minutes · " +
    fmtTok(tokens) +
    " effective tokens (cache reads count 10%)\nautomatic progress extensions: " +
    (agRun.autoExtensionsUsed || 0) +
    "/" +
    (b.maxAutoExtensions || 0) +
    " used\nagent cell time limit: " +
    agCellMinutes +
    " min\nauthoritative boundary: " +
    (hits.length ? hits.join(" + ") : "none") +
    "\nunfinished visible plan steps: " +
    (pending.length ? pending.map((s) => s.id).join(", ") : "none") +
    "\nOnly KERNEL may report that a run paused, stopped, timed out, or hit a budget. Never invent or infer such a limit. For any tool-using or planned task, complete every promised step, call finish_run with executed evidence, and only then return the final user-facing answer."
  );
}
function loadedPackageNames() {
  return kernelPackages.slice();
}
/* Live notebook state travels as an append-only <kernel_state> block on the newest user-role message instead of in the system prompt, so the system prompt, tools, and every earlier turn stay byte-stable for prompt caching and for Claude's conversation-bound thinking blocks. */
function agStateParts() {
  const visible = dataFiles.filter((d) => getArtifactContextPolicy(d.id) !== "excluded"),
    packages = loadedPackageNames(),
    notebook =
      "## Notebook\nname: " +
      nbName +
      " · kernel: " +
      (kernelReady ? "ready" : "booting") +
      (kernelGeneration ? " · kernel generation " + kernelGeneration : "") +
      (environmentSnapshot ? " · environment " + environmentSnapshot.hash : "") +
      "\n" +
      agOutline() +
      "\n\n## Artifacts\n" +
      (visible.length
        ? visible
            .map(
              (d) => "artifact://" + d.id + " " + d.name + " (" + artifactStage(d) + ", " + fmtBytes(d.size || 0) + ")",
            )
            .join("\n") +
          (visible.length < dataFiles.length
            ? "\n(" + (dataFiles.length - visible.length) + " excluded artifact(s) omitted)"
            : "")
        : "(none visible)") +
      "\n\n## Loaded Python packages\n" +
      (packages.length ? packages.join(", ") : "(none yet)"),
    plan =
      agPlan && agPlan.length
        ? "## Visible plan\n" + agPlan.map((s) => "[" + s.status + "] " + s.id + " · " + s.title).join("\n") + "\n\n"
        : "";
  return { key: sourceHash(notebook), notebook, control: plan + agRunControlContext() };
}
function stampKernelState() {
  let last = agMsgs[agMsgs.length - 1];
  if (!last) return null;
  if (last.role !== "user") {
    last = { role: "user", content: [{ type: "text", text: "Continue from the current notebook state." }] };
    agMsgs.push(last);
  }
  last.content = (Array.isArray(last.content) ? last.content : []).filter((b) => b.kernel !== "state");
  let prevKey = "";
  for (let i = agMsgs.length - 2; i >= 0 && !prevKey; i--)
    for (const b of agMsgs[i].content || []) if (b.kernel === "state" && b.stateKey) prevKey = b.stateKey;
  const s = agStateParts(),
    block = {
      type: "text",
      kernel: "state",
      stateKey: s.key,
      text:
        "<kernel_state>\n" +
        (prevKey === s.key
          ? "Notebook, artifacts, and packages are unchanged since the previous kernel_state."
          : s.notebook) +
        "\n\n" +
        s.control +
        "\n</kernel_state>",
    };
  last.content.push(block);
  return block;
}
function agContextBlock(summary) {
  return [buildPinnedContext(), summary ? "## Earlier-thread checkpoint\n" + summary : ""].filter(Boolean).join("\n\n");
}
function buildSystem(summary, blocks) {
  const ctx = agContextBlock(summary);
  if (!blocks) return DOCS + (ctx ? "\n\n" + ctx : "");
  const out = [{ type: "text", text: DOCS, cache_control: { type: "ephemeral" } }];
  if (ctx) out.push({ type: "text", text: ctx, cache_control: { type: "ephemeral" } });
  return out;
}
