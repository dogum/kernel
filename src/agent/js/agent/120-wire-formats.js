/* ── canonical messages → provider wire formats ── */
function anthropicMessages(msgs, withThinking) {
  return msgs
    .map((m) => ({
      role: m.role,
      content: (m.content || [])
        .map((b) => {
          if (b.type === "text") return b.text ? { type: "text", text: b.text } : null;
          if (b.type === "image") return { type: "image", source: clonePlain(b.source) };
          if (b.type === "tool_use")
            return { type: "tool_use", id: b.id, name: b.name, input: clonePlain(b.input || {}) };
          if (b.type === "tool_result") {
            const parts = (b.content || [])
              .filter((x) => (x.type === "text" && x.text) || x.type === "image")
              .map((x) =>
                x.type === "image" ? { type: "image", source: clonePlain(x.source) } : { type: "text", text: x.text },
              );
            return {
              type: "tool_result",
              tool_use_id: b.tool_use_id,
              content: parts.length ? parts : [{ type: "text", text: "(no output)" }],
            };
          }
          if (withThinking && m.role === "assistant" && b.type === "thinking" && b.signature)
            return { type: "thinking", thinking: b.thinking || "", signature: b.signature };
          if (withThinking && m.role === "assistant" && b.type === "redacted_thinking" && b.data)
            return { type: "redacted_thinking", data: b.data };
          return null;
        })
        .filter(Boolean),
    }))
    .filter((m) => m.content.length);
}
function responseInput(msgs) {
  const out = [];
  for (const m of msgs) {
    let parts = [];
    const flush = () => {
      if (parts.length) {
        out.push({ role: m.role, content: parts });
        parts = [];
      }
    };
    for (const b of m.content || []) {
      if (b.type === "provider_item" && b.provider === agProvider) {
        flush();
        out.push(clonePlain(b.item));
        continue;
      }
      if (b.type === "text")
        parts.push({ type: m.role === "assistant" ? "output_text" : "input_text", text: b.text || "" });
      else if (b.type === "image" && m.role === "user")
        parts.push({ type: "input_image", image_url: "data:" + b.source.media_type + ";base64," + b.source.data });
      else if (b.type === "tool_use") {
        flush();
        out.push(
          b.provider === agProvider && b.provider_item
            ? clonePlain(b.provider_item)
            : { type: "function_call", call_id: b.id, name: b.name, arguments: JSON.stringify(b.input || {}) },
        );
      } else if (b.type === "tool_result") {
        flush();
        const text = (b.content || [])
          .filter((x) => x.type === "text")
          .map((x) => x.text)
          .join("\n");
        const imgs = (b.content || [])
          .filter((x) => x.type === "image")
          .map((x) => ({ type: "input_image", image_url: "data:" + x.source.media_type + ";base64," + x.source.data }));
        out.push({
          type: "function_call_output",
          call_id: b.tool_use_id,
          output: imgs.length ? [{ type: "input_text", text }, ...imgs] : text,
        });
      }
    }
    flush();
  }
  return out;
}
function responseTools() {
  return AG_TOOLS.map((t) => ({
    type: "function",
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
    strict: false,
  }));
}
function sseDataLines(buffer, flush) {
  if (flush && buffer && !/\r?\n\r?\n$/.test(buffer)) buffer += "\n\n";
  const events = [],
    chunks = buffer.split(/\r?\n\r?\n/),
    rest = chunks.pop() || "";
  for (const chunk of chunks) {
    const data = chunk
      .split(/\r?\n/)
      .filter((x) => x.startsWith("data:"))
      .map((x) => x.slice(5).trim())
      .join("\n");
    if (data && data !== "[DONE]") events.push(data);
  }
  return { events, rest };
}
function finishMarkdown(el, text) {
  if (el) {
    renderAgentMarkdown(el, text, false);
    el.classList.remove("live");
    txPersist();
  }
}
function redactText(value) {
  let s = String(value == null ? "" : value);
  for (const key of Object.values(agConfigs || {})
    .map((x) => x && x.key)
    .filter(Boolean))
    s = s.split(key).join("[REDACTED]");
  return s
    .replace(/\b(?:sk-ant-|sk-proj-|sk-|xai-)[A-Za-z0-9_\-]{8,}\b/g, "[REDACTED_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/(authorization|x-api-key|api[_-]?key|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]");
}
function providerError(message, info) {
  const e = new Error(message);
  e.name = "ProviderError";
  e.kind = "client";
  e.retryable = false;
  e.status = 0;
  e.retryAfterMs = 0;
  return Object.assign(e, info || {});
}
function agRetryableStatus(status) {
  return [408, 409, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 529].includes(Number(status));
}
function agRetryAfterMs(headers) {
  try {
    const ms = parseFloat(headers.get("retry-after-ms"));
    if (ms > 0) return ms;
    const v = headers.get("retry-after");
    if (!v) return 0;
    const s = Number(v);
    if (Number.isFinite(s)) return Math.max(0, s * 1000);
    const at = Date.parse(v);
    return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 0;
  } catch (e) {
    return 0;
  }
}
async function checkedStream(url, body, extraHeaders) {
  agAbort = new AbortController();
  if (agPauseRequested || agStop) {
    agAbortReason = agPauseRequested ? "pause" : "user_stop";
    agAbort.abort();
  }
  const label = AG_PROVIDER_DEFS[agProvider].label,
    timer = setTimeout(() => {
      agAbortReason = "connection_timeout";
      try {
        agAbort.abort();
      } catch (e) {}
    }, 45000);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      signal: agAbort.signal,
      headers: Object.assign(agHeaders(true), extraHeaders || {}),
      body: JSON.stringify(body),
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
  } catch (e) {
    if (e && e.name === "AbortError") throw e;
    throw providerError(label + " network error · " + String((e && e.message) || e), {
      kind: "network",
      retryable: true,
      beforeResponse: true,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let t = "";
    try {
      t = await res.text();
    } catch (e) {}
    throw providerError(label + " API " + res.status + (t ? " — " + agTrunc(redactText(t), 500) : ""), {
      kind: res.status === 429 ? "rate_limit" : res.status >= 500 ? "server" : "client",
      status: res.status,
      retryable: agRetryableStatus(res.status),
      retryAfterMs: agRetryAfterMs(res.headers),
    });
  }
  if (!res.body) throw providerError("Streaming response body unavailable", { kind: "network", retryable: true });
  return res;
}
async function agReadChunk(reader) {
  try {
    return await reader.read();
  } catch (e) {
    if (e && e.name === "AbortError") throw e;
    throw providerError(AG_PROVIDER_DEFS[agProvider].label + " stream interrupted · " + String((e && e.message) || e), {
      kind: "network",
      retryable: true,
    });
  }
}
function agStallTimer() {
  let timer = null;
  return {
    arm() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        agAbortReason = "stream_stall";
        if (agRun) runEvent("model_stalled", "No response data for 3 minutes");
        try {
          agAbort.abort();
        } catch (e) {}
      }, 180000);
    },
    clear() {
      clearTimeout(timer);
    },
  };
}
/* Claude model capabilities: adaptive thinking/effort on the 4.6+ and Claude 5 families, conversation-bound thinking on Opus 5.5 / Fable 5.1, server-side refusal fallbacks on Opus 5 / Fable 5 and later. */
function anthropicModelFeatures(model) {
  const m = String(model || "")
      .toLowerCase()
      .replace(/^anthropic\./, ""),
    gen5 = /^claude-(?:opus|sonnet|fable|mythos)-[5-9](?:-|$)/.test(m),
    adaptive = gen5 || /^claude-(?:opus|sonnet)-4-[6-9]/.test(m),
    display = gen5 || /^claude-opus-4-[7-9]/.test(m),
    binding = /^claude-(?:opus-5-[5-9]|opus-[6-9]|fable-5-[1-9]|fable-[6-9])/.test(m),
    fallbacks = /^claude-(?:opus|fable)-[5-9]/.test(m),
    efforts = adaptive
      ? /^claude-(?:opus|sonnet)-4-6/.test(m)
        ? ["low", "medium", "high", "max"]
        : ["low", "medium", "high", "xhigh", "max"]
      : /^claude-opus-4-5/.test(m)
        ? ["low", "medium", "high"]
        : [];
  return {
    adaptive,
    display,
    binding,
    fallbacks,
    efforts,
    maxOutput: /haiku/.test(m) ? 64000 : adaptive ? 128000 : 64000,
  };
}
function agRunMaxOut() {
  return Math.max(agMaxOut, (agRun && agRun.maxOutOverride) || 0);
}
function agOutputCap() {
  if (agModelInfo && agModelInfo.maxOutput) return agModelInfo.maxOutput;
  if (agProvider === "anthropic") return anthropicModelFeatures(agModel).maxOutput;
  return agProvider === "openai" ? 128000 : 64000;
}
function agNextMaxOut() {
  return Math.min(agOutputCap(), Math.max(agRunMaxOut() * 2, 16000));
}
function anthropicCacheBreakpoints(msgs) {
  let marked = 0;
  for (let i = msgs.length - 1; i >= 0 && marked < 2; i--) {
    if (msgs[i].role !== "user") continue;
    const c = msgs[i].content;
    for (let j = c.length - 1; j >= 0; j--) {
      if (["text", "image", "tool_result"].includes(c[j].type)) {
        c[j] = Object.assign({}, c[j], { cache_control: { type: "ephemeral" } });
        marked++;
        break;
      }
    }
  }
  return msgs;
}
function anthropicRequest(ctx) {
  const f = anthropicModelFeatures(agModel),
    compat = agAnthropicCompat,
    betas = [],
    effort =
      agReasoning && agReasoning !== "off"
        ? f.efforts.includes(agReasoning)
          ? agReasoning
          : agReasoning === "xhigh" && f.efforts.includes("high")
            ? "high"
            : ""
        : "";
  const body = {
    model: agModel,
    max_tokens: agRunMaxOut(),
    stream: true,
    system: buildSystem(ctx.summary, true),
    tools: compat ? AG_TOOLS : AG_TOOLS.map((t) => Object.assign({}, t, { eager_input_streaming: true })),
    tool_choice: { type: "auto" },
    messages: anthropicCacheBreakpoints(anthropicMessages(ctx.messages, f.adaptive)),
  };
  if (f.adaptive) {
    body.thinking = { type: "adaptive" };
    if (f.display && !compat) body.thinking.display = "summarized";
    if (f.binding && !compat) {
      body.thinking.block_binding = { prefix_mismatch_behavior: "drop_block" };
      betas.push("thinking-binding-controls-2026-08-01");
    }
  }
  if (effort) body.output_config = { effort };
  if (f.fallbacks && !compat) {
    body.fallbacks = "default";
    betas.push("server-side-fallback-2026-07-01");
  }
  return { body, betas };
}
function canonicalAnthropicContent(blocks) {
  const lastFallback = blocks.map((b) => b && b.type).lastIndexOf("fallback");
  return blocks.filter(
    (b, i) =>
      b &&
      b.type !== "fallback" &&
      !(i < lastFallback && ["thinking", "redacted_thinking", "tool_use"].includes(b.type)) &&
      !(b.type === "text" && !String(b.text || "").length),
  );
}
async function streamAnthropic(ctx) {
  const { body: request, betas } = anthropicRequest(ctx),
    res = await checkedStream(
      agEndpoint("/messages"),
      request,
      betas.length ? { "anthropic-beta": betas.join(",") } : null,
    ),
    reader = res.body.getReader(),
    dec = new TextDecoder(),
    stall = agStallTimer();
  if (betas.length) agAnthropicBetaOk = true;
  let buf = "",
    content = [],
    jsonBuf = {},
    liveEl = null,
    liveText = "",
    thinkEl = null,
    thinkText = "",
    outTok = 0,
    stopReason = "",
    stopDetails = null,
    messageComplete = false,
    servedModel = agModel;
  const streamEls = [],
    runRef = () => agRun && agRun.id;
  const closeThinking = () => {
    if (thinkEl) {
      const t = thinkText.trim();
      if (t.length <= 320 && !/\n\s*\n/.test(t)) {
        const p = txDom("p", t, true, { ephemeral: true, run: runRef() });
        thinkEl.replaceWith(p);
        streamEls.splice(streamEls.indexOf(thinkEl), 1, p);
      } else {
        thinkEl.dataset.raw = thinkText;
        const body = thinkEl.lastElementChild;
        if (body) renderAgentMarkdown(body, thinkText, false);
      }
    }
    thinkEl = null;
    thinkText = "";
  };
  stall.arm();
  try {
    for (;;) {
      const { done, value } = await agReadChunk(reader);
      if (value) {
        stall.arm();
        buf += dec.decode(value, { stream: !done });
      } else if (done) buf += dec.decode();
      const parsed = sseDataLines(buf, done);
      buf = parsed.rest;
      for (const payload of parsed.events) {
        let ev;
        try {
          ev = JSON.parse(payload);
        } catch (e) {
          continue;
        }
        if (ev.type === "message_start") {
          const m = ev.message || {},
            u = m.usage;
          if (m.model) servedModel = m.model;
          if (u) {
            const cw = u.cache_creation_input_tokens || 0,
              cr = u.cache_read_input_tokens || 0;
            agUseIn += (u.input_tokens || 0) + cw + cr;
            agUseCw += cw;
            agUseCr += cr;
            meterUi();
          }
        } else if (ev.type === "message_delta") {
          if (ev.usage) outTok = ev.usage.output_tokens || outTok;
          if (ev.delta && ev.delta.stop_reason) stopReason = ev.delta.stop_reason;
          if (ev.delta && ev.delta.stop_details) stopDetails = ev.delta.stop_details;
          meterUi();
        } else if (ev.type === "content_block_start") {
          const b = ev.content_block || {};
          if (b.type === "text") {
            closeThinking();
            content[ev.index] = { type: "text", text: b.text || "" };
            liveText = b.text || "";
            liveEl = txDom("a", liveText, true, { ephemeral: true, run: runRef() });
            liveEl.classList.add("live");
            streamEls.push(liveEl);
          } else if (b.type === "tool_use") {
            finishMarkdown(liveEl, liveText);
            liveEl = null;
            closeThinking();
            content[ev.index] = { type: "tool_use", id: b.id, name: b.name, input: {} };
            jsonBuf[ev.index] = "";
          } else if (b.type === "thinking") {
            finishMarkdown(liveEl, liveText);
            liveEl = null;
            closeThinking();
            content[ev.index] = {
              type: "thinking",
              thinking: b.thinking || "",
              signature: b.signature || "",
              provider: "anthropic",
              model: servedModel,
            };
            thinkText = b.thinking || "";
          } else if (b.type === "redacted_thinking")
            content[ev.index] = {
              type: "redacted_thinking",
              data: b.data || "",
              provider: "anthropic",
              model: servedModel,
            };
          else if (b.type === "fallback") {
            const from = (b.from && b.from.model) || "model",
              to = (b.to && b.to.model) || "fallback model";
            content[ev.index] = { type: "fallback", from, to };
            servedModel = to;
            streamEls.push(
              txDom("s", "fallback · " + from + " declined · " + to + " continued", true, {
                ephemeral: true,
                run: runRef(),
              }),
            );
            if (agRun) runEvent("model_fallback", from + " declined; " + to + " continued");
          }
        } else if (ev.type === "content_block_delta") {
          const d = ev.delta || {},
            c = content[ev.index];
          if (d.type === "text_delta" && c) {
            c.text += d.text || "";
            liveText += d.text || "";
            if (liveEl) renderAgentMarkdown(liveEl, liveText, true);
          } else if (d.type === "input_json_delta")
            jsonBuf[ev.index] = (jsonBuf[ev.index] || "") + (d.partial_json || "");
          else if (d.type === "thinking_delta" && c) {
            c.thinking += d.thinking || "";
            thinkText += d.thinking || "";
            if (thinkText.trim()) {
              if (!thinkEl) {
                thinkEl = txDom("r", "", true, { ephemeral: true, run: runRef() });
                streamEls.push(thinkEl);
              }
              thinkEl.dataset.raw = thinkText;
              const body = thinkEl.lastElementChild;
              if (body) renderAgentMarkdown(body, thinkText, true);
            }
          } else if (d.type === "signature_delta" && c) c.signature = (c.signature || "") + (d.signature || "");
        } else if (ev.type === "content_block_stop") {
          const c = content[ev.index];
          if (c && c.type === "tool_use") {
            try {
              c.input = JSON.parse(jsonBuf[ev.index] || "{}");
            } catch (e) {
              c.input = {};
              c.invalidInput = true;
            }
          }
          if (c && c.type === "text") {
            finishMarkdown(liveEl, liveText);
            liveEl = null;
          }
          if (c && c.type === "thinking") closeThinking();
        } else if (ev.type === "message_stop") messageComplete = true;
        else if (ev.type === "error") {
          const t = (ev.error && ev.error.type) || "api_error";
          throw providerError("Anthropic stream error · " + ((ev.error && ev.error.message) || t), {
            kind: t === "overloaded_error" ? "overloaded" : t === "rate_limit_error" ? "rate_limit" : "server",
            retryable: ["overloaded_error", "api_error", "rate_limit_error", "timeout_error"].includes(t),
          });
        }
      }
      if (done) break;
    }
  } finally {
    stall.clear();
    finishMarkdown(liveEl, liveText);
    closeThinking();
    const authoritative =
      messageComplete && !["max_tokens", "refusal", "model_context_window_exceeded"].includes(stopReason);
    for (const el of streamEls) {
      if (authoritative) delete el.dataset.ephemeral;
      else el.remove();
    }
    if (authoritative) txPersist();
    agUseOut += outTok;
    meterUi();
    agSaveUsage();
  }
  if (!messageComplete)
    throw providerError("Anthropic stream ended before a durable completion", { kind: "incomplete", retryable: true });
  if (stopReason === "max_tokens")
    throw providerError(
      "Anthropic response reached max output tokens (" + request.max_tokens + ") before a durable completion",
      { kind: "max_tokens" },
    );
  if (stopReason === "refusal") {
    const cat = stopDetails && stopDetails.category;
    throw providerError(
      "Claude declined this request" +
        (cat ? " (category: " + cat + ")" : "") +
        ". Rephrase it, adjust the notebook content, or choose another model in agent settings.",
      { kind: "refusal" },
    );
  }
  if (stopReason === "model_context_window_exceeded")
    throw providerError(
      "The request exceeded the model context window. Exclude content, lower max output, or start a new thread.",
      { kind: "context" },
    );
  return canonicalAnthropicContent(content);
}
function canonicalResponseOutput(items) {
  const out = [];
  for (const item of items || []) {
    if (item.type === "message") {
      const text = (item.content || [])
        .filter((x) => x.type === "output_text")
        .map((x) => x.text || "")
        .join("");
      if (text) out.push({ type: "text", text });
    } else if (item.type === "function_call") {
      // Unparseable arguments are flagged, as in the Anthropic adapter, so execTool refuses the call instead of
      // running a tool with no required fields (run_all, say) on an empty input.
      let input = {},
        invalidInput = false;
      try {
        input = JSON.parse(item.arguments || "{}");
        if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("arguments are not an object");
      } catch (e) {
        input = {};
        invalidInput = true;
      }
      out.push({
        type: "tool_use",
        id: item.call_id || item.id,
        name: item.name,
        input,
        ...(invalidInput ? { invalidInput: true } : {}),
        provider: agProvider,
        provider_item: clonePlain(item),
      });
    } else if (item.type === "reasoning") {
      out.push({ type: "provider_item", provider: agProvider, item: clonePlain(item) });
      const summary = (item.summary || []).map((x) => x.text || "").join("");
      if (summary) out.push({ type: "reasoning", text: summary });
    }
  }
  return out;
}
async function streamResponses(ctx) {
  const body = {
    model: agModel,
    instructions: buildSystem(ctx.summary, false),
    input: responseInput(ctx.messages),
    tools: responseTools(),
    tool_choice: "auto",
    stream: true,
    store: false,
    max_output_tokens: agRunMaxOut(),
    include: ["reasoning.encrypted_content"],
  };
  if (agReasoning !== "off") body.reasoning = { effort: agReasoning, summary: "auto" };
  if (agProvider === "openai") body.prompt_cache_key = "kernel-" + sourceHash(nbId + ":" + agThreadId);
  const res = await checkedStream(agEndpoint("/responses"), body),
    reader = res.body.getReader(),
    dec = new TextDecoder(),
    stall = agStallTimer();
  let buf = "",
    finalResponse = null,
    finalEvent = "",
    liveEl = null,
    liveText = "",
    reasonEl = null,
    reasonText = "";
  const streamEls = [];
  stall.arm();
  try {
    for (;;) {
      const { done, value } = await agReadChunk(reader);
      if (value) {
        stall.arm();
        buf += dec.decode(value, { stream: !done });
      } else if (done) buf += dec.decode();
      const parsed = sseDataLines(buf, done);
      buf = parsed.rest;
      for (const payload of parsed.events) {
        let ev;
        try {
          ev = JSON.parse(payload);
        } catch (e) {
          continue;
        }
        if (ev.type === "response.output_text.delta") {
          if (!liveEl) {
            liveEl = txDom("a", "", true, { ephemeral: true, run: agRun && agRun.id });
            liveEl.classList.add("live");
            streamEls.push(liveEl);
          }
          liveText += ev.delta || "";
          renderAgentMarkdown(liveEl, liveText, true);
        } else if (ev.type === "response.reasoning_summary_text.delta") {
          if (!reasonEl) {
            reasonEl = txDom("r", "", true, { ephemeral: true, run: agRun && agRun.id });
            streamEls.push(reasonEl);
          }
          reasonText += ev.delta || "";
          reasonEl.dataset.raw = reasonText;
          const b = reasonEl.lastElementChild;
          if (b) renderAgentMarkdown(b, reasonText, true);
        } else if (ev.type === "response.completed" || ev.type === "response.incomplete") {
          finalResponse = ev.response;
          finalEvent = ev.type;
        } else if (ev.type === "response.failed" || ev.type === "error") {
          const err = (ev.response && ev.response.error) || ev.error || ev,
            code = String(err.code || err.type || "");
          throw providerError(
            (err.message || ev.message || "Responses stream failed") + (code ? " (" + code + ")" : ""),
            {
              kind: /rate/i.test(code) ? "rate_limit" : "server",
              retryable: /server_error|rate_limit|overloaded|timeout|internal/i.test(code),
            },
          );
        }
      }
      if (done) break;
    }
  } finally {
    stall.clear();
    const authoritative = finalEvent === "response.completed" && finalResponse && finalResponse.status !== "incomplete";
    if (authoritative) {
      finishMarkdown(liveEl, liveText);
      if (reasonEl) {
        reasonEl.dataset.raw = reasonText;
        const b = reasonEl.lastElementChild;
        if (b) renderAgentMarkdown(b, reasonText, false);
      }
      for (const el of streamEls) delete el.dataset.ephemeral;
      txPersist();
    } else for (const el of streamEls) el.remove();
    if (finalResponse && finalResponse.usage) {
      const u = finalResponse.usage;
      agUseIn += u.input_tokens || 0;
      agUseOut += u.output_tokens || 0;
      agUseCr += (u.input_tokens_details && u.input_tokens_details.cached_tokens) || 0;
      agUseReason += (u.output_tokens_details && u.output_tokens_details.reasoning_tokens) || 0;
    }
    meterUi();
    agSaveUsage();
  }
  if (!finalResponse)
    throw providerError("Responses stream ended before completion", { kind: "incomplete", retryable: true });
  if (finalResponse.status === "incomplete") {
    const reason = (finalResponse.incomplete_details && finalResponse.incomplete_details.reason) || "limit reached";
    if (reason === "max_output_tokens")
      throw providerError(
        "Responses API reached max_output_tokens (" + body.max_output_tokens + "); no tool call was executed",
        { kind: "max_tokens" },
      );
    txDom("s", "response incomplete · " + reason);
    throw providerError("Responses API returned an incomplete response (" + reason + "); no tool call was executed", {
      kind: "incomplete",
    });
  }
  const canonical = canonicalResponseOutput(finalResponse.output || []);
  if (!liveText) {
    const text = canonical
      .filter((x) => x.type === "text")
      .map((x) => x.text)
      .join("\n");
    if (text) txDom("a", text);
  }
  if (!reasonText) {
    const reason = canonical
      .filter((x) => x.type === "reasoning")
      .map((x) => x.text)
      .join("\n");
    if (reason) txDom("r", reason);
  }
  return canonical;
}
async function apiStream() {
  stampKernelState();
  const ctx = prepareContext();
  if (ctx.unfit) throw providerError(ctx.reason, { kind: "context" });
  return agProvider === "anthropic" ? streamAnthropic(ctx) : streamResponses(ctx);
}
const AG_MAX_RETRIES = 5;
let agAnthropicCompat = false,
  agAnthropicBetaOk = false;
function agRetryDelay(attempt, retryAfterMs) {
  if (retryAfterMs > 0) return Math.min(120000, Math.max(1000, retryAfterMs));
  const base = Math.min(60000, 2000 * Math.pow(2, Math.max(0, attempt - 1)));
  return Math.round(base * (0.75 + Math.random() * 0.5));
}
function agRetrySleep(ms) {
  return new Promise((res) => {
    const end = Date.now() + ms,
      iv = setInterval(() => {
        if (agStop || agPauseRequested) {
          clearInterval(iv);
          res(false);
        } else if (Date.now() >= end) {
          clearInterval(iv);
          res(true);
        }
      }, 200);
  });
}
function agRetryInfo(err) {
  if (!err) return { retryable: false, kind: "unknown", message: "" };
  if (err.name === "ProviderError")
    return {
      retryable: !!err.retryable,
      kind: err.kind,
      status: err.status,
      retryAfterMs: err.retryAfterMs,
      beforeResponse: !!err.beforeResponse,
      message: agTrunc(err.message, 140),
    };
  if (err.name === "AbortError") {
    if (agAbortReason === "connection_timeout")
      return { retryable: true, kind: "connect_timeout", message: "Connection timed out before the stream opened" };
    if (agAbortReason === "stream_stall")
      return { retryable: true, kind: "stall", message: "The model stream stalled" };
  }
  return { retryable: false, kind: "unknown", message: String((err && err.message) || err) };
}
function agAbortError() {
  const e = new Error("Aborted by the human");
  e.name = "AbortError";
  agAbortReason = agPauseRequested ? "pause" : "user_stop";
  return e;
}
async function apiStreamWithRetry() {
  let attempt = 0,
    escalations = 0;
  for (;;) {
    try {
      return await apiStream();
    } catch (err) {
      if (agStop || agPauseRequested) throw err;
      const info = agRetryInfo(err);
      if (info.kind === "max_tokens" && agRun && escalations < 2) {
        const cur = agRunMaxOut(),
          next = agNextMaxOut();
        if (next > cur) {
          agRun.maxOutOverride = next;
          escalations++;
          await runEvent(
            "model_output_extended",
            "Output cap raised from " + cur + " to " + next + " tokens after the response hit max_tokens",
          );
          txDom("s", "output limit reached · retrying with " + fmtTok(next) + " output tokens", false, {
            ephemeral: true,
            run: agRun.id,
          });
          continue;
        }
      }
      if (
        agProvider === "anthropic" &&
        !agAnthropicCompat &&
        ((info.kind === "network" && info.beforeResponse && !agAnthropicBetaOk) ||
          (info.status === 400 &&
            /fallbacks|block_binding|display|eager_input_streaming|anthropic-beta|beta/i.test(
              String((err && err.message) || ""),
            )))
      ) {
        agAnthropicCompat = true;
        if (agRun)
          await runEvent(
            "model_compat_mode",
            "Retrying without optional Anthropic features · " + agTrunc(String((err && err.message) || err), 200),
          );
        continue;
      }
      if (!info.retryable || attempt >= AG_MAX_RETRIES) throw err;
      attempt++;
      const wait = agRetryDelay(attempt, info.retryAfterMs || 0);
      if (agRun) {
        agRun.modelRetries = (agRun.modelRetries || 0) + 1;
        await runEvent(
          "model_retry",
          info.message +
            " · retry " +
            attempt +
            "/" +
            AG_MAX_RETRIES +
            " in " +
            Math.max(1, Math.round(wait / 1000)) +
            "s",
        );
      }
      const notice = txDom(
        "w",
        info.message +
          " · retrying in " +
          Math.max(1, Math.round(wait / 1000)) +
          "s (" +
          attempt +
          "/" +
          AG_MAX_RETRIES +
          ")",
        false,
        { ephemeral: true, run: agRun && agRun.id },
      );
      const ok = await agRetrySleep(wait);
      notice.remove();
      if (!ok) throw agAbortError();
      agAbortReason = "";
    }
  }
}
