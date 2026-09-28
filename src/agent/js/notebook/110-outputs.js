/* ===== outputs rendering ===== */
function renderOutputs(cell) {
  const host = cell.outEl;
  host.innerHTML = "";
  const outs = cell.outputs || [];
  if (!outs.length) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  if (cell.provenance) {
    const f = cellFreshness(cell),
      who = cell.provenance.actor || "human",
      when = new Date(cell.provenance.at || Date.now()).toLocaleString();
    if (cell.execEl)
      cell.execEl.title =
        "Run by " + who + " · " + when + " · " + f.state + (f.reasons.length ? " · " + f.reasons.join("; ") : "");
    if (f.state === "stale") {
      const p = document.createElement("div");
      p.className = "out-provenance";
      p.innerHTML =
        '<span class="bad">STALE</span><span>' +
        escAttr(f.reasons.join("; ") || "inputs changed since this ran") +
        "</span><span>rerun to refresh · ran by " +
        escAttr(who) +
        " · " +
        escAttr(when) +
        "</span>";
      host.appendChild(p);
    }
  }
  for (const o of outs) {
    const d = document.createElement("div");
    if (o.kind === "stream") {
      d.className = "out out-stream" + (o.name === "stderr" ? " stderr" : "");
      d.innerHTML = "<pre>" + esc(o.text) + "</pre>";
    } else if (o.kind === "text") {
      d.className = "out out-text";
      d.innerHTML = "<pre>" + esc(o.text) + "</pre>";
    } else if (o.kind === "error") {
      d.className = "out out-err";
      const pre = document.createElement("pre");
      pre.textContent = friendlyTrace(stripAnsi(o.text || (o.error && o.error.text) || ""));
      d.appendChild(pre);
      for (const fr of (o.frames || (o.error && o.error.frames) || []).filter((x) => x && x.cellId)) {
        const target = findCell(fr.cellId),
          b = document.createElement("button");
        b.className = "out-frame-link";
        b.textContent = "↗ " + (target ? cellTag(target) : "deleted cell") + (fr.line ? ", line " + fr.line : "");
        b.title = (fr.function || "") + (fr.source ? " · " + fr.source : "");
        b.addEventListener("click", () => focusCellLine(fr.cellId, fr.line));
        d.appendChild(b);
      }
      if (typeof agFixCell === "function") {
        const fx = document.createElement("button");
        fx.className = "out-fix";
        fx.textContent = "✦ Fix with agent";
        fx.title = "Draft a request for the agent to fix and rerun this cell";
        fx.addEventListener("click", () => agFixCell(cell, o));
        d.appendChild(fx);
      }
    } else if (o.kind === "image") {
      d.className = "out out-img";
      const img = document.createElement("img"),
        mime = /^image\/(?:png|jpeg|gif|webp)$/i.test(o.mime || "") ? o.mime : "image/png",
        b64 = String(o.b64 || "");
      img.alt = "figure";
      if (/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) img.src = "data:" + mime + ";base64," + b64;
      else img.alt = "Figure omitted: invalid image payload";
      d.appendChild(img);
    } else if (o.kind === "html") {
      d.className = "out out-html";
      d.innerHTML = sanitizeHtml(o.html);
    } else if (o.kind === "iframe_html") {
      d.className = "out out-frame";
      const f = document.createElement("iframe");
      const h = Math.max(140, Math.min(1400, Number(o.height) || 480));
      f.setAttribute("sandbox", "allow-scripts allow-downloads allow-popups");
      f.setAttribute("referrerpolicy", "no-referrer");
      f.loading = "lazy";
      f.style.width = "100%";
      f.style.height = h + "px";
      f.style.border = "1px solid var(--line)";
      f.style.borderRadius = "6px";
      f.style.background = "#fff";
      f.srcdoc = String(o.html || "");
      d.appendChild(f);
    }
    const acts = outputActions(cell, o, d);
    if (acts) d.appendChild(acts);
    host.appendChild(d);
  }
}
function copyText(text) {
  const done = () => toast("Copied");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => fallback());
    return;
  }
  fallback();
  function fallback() {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      done();
    } catch (e) {
      toast("Copy is not available here", "err");
    }
    ta.remove();
  }
}
function tableToDelimited(table, sep) {
  const cellText = (v) => {
    v = String(v).replace(/\s+/g, " ").trim();
    return sep === "," && /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  return (
    [...table.querySelectorAll("tr")]
      .map((tr) => [...tr.children].map((c) => cellText(c.textContent)).join(sep))
      .join("\n") + "\n"
  );
}
function outputActions(cell, o, d) {
  const acts = document.createElement("div");
  acts.className = "out-acts";
  const add = (label, title, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      fn(b);
    });
    acts.appendChild(b);
  };
  const stem = (nbName || "notebook").replace(/[^A-Za-z0-9_-]+/g, "-") + "-cell" + (indexOf(cell) + 1);
  if (o.kind === "stream" || o.kind === "text") {
    add("COPY", "Copy this output", () => copyText(stripAnsi(o.text || "")));
    if (String(o.text || "").split("\n").length > 40) {
      d.classList.add("long");
      add("EXPAND", "Show the whole output", (b) => {
        const on = d.classList.toggle("expanded");
        b.textContent = on ? "COLLAPSE" : "EXPAND";
      });
    }
  } else if (o.kind === "error")
    add("COPY", "Copy the traceback", () => copyText(friendlyTrace(stripAnsi(o.text || ""))));
  else if (o.kind === "html") {
    const table = d.querySelector("table");
    if (table) {
      add("COPY", "Copy the table (tab-separated, pastes into spreadsheets)", () =>
        copyText(tableToDelimited(table, "\t")),
      );
      add("CSV", "Download the table as CSV", () =>
        downloadBlob(new Blob([tableToDelimited(table, ",")], { type: "text/csv" }), stem + ".csv"),
      );
    }
  } else if (o.kind === "image" && /^[A-Za-z0-9+/]*={0,2}$/.test(String(o.b64 || ""))) {
    add("PNG", "Download this figure", () => {
      const bin = atob(o.b64),
        bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      downloadBlob(new Blob([bytes], { type: o.mime || "image/png" }), stem + ".png");
    });
  }
  return acts.childElementCount ? acts : null;
}
const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, "");
/* kernel://<notebook>/<cell-id> is the stable virtual filename Python sees; people read cell positions */
function friendlyTrace(text) {
  return String(text).replace(/File "kernel:\/\/[^/"]+\/([A-Za-z0-9_-]+)", line (\d+)/g, (m, id, line) => {
    const c = findCell(id);
    return (c ? "Cell " + (indexOf(c) + 1) : "Deleted cell") + ", line " + line;
  });
}
function sanitizeHtml(h) {
  const t = document.createElement("template");
  t.innerHTML = String(h || "");
  t.content
    .querySelectorAll("script,style,base,object,embed,iframe,link,meta,form,template")
    .forEach((n) => n.remove());
  t.content.querySelectorAll("*").forEach((el) => {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase(),
        v = a.value;
      if (n.startsWith("on") || n === "srcdoc" || n === "srcset" || n === "ping") {
        el.removeAttribute(a.name);
        continue;
      }
      if (n === "style" && /(?:expression\s*\(|url\s*\(|@import)/i.test(v)) {
        el.removeAttribute(a.name);
        continue;
      }
      if (["href", "src", "xlink:href", "action", "formaction", "poster", "background"].includes(n)) {
        const safe = safeContentUrl(v, n === "src");
        if (safe === "#" && String(v).trim() !== "#") el.removeAttribute(a.name);
        else el.setAttribute(a.name, safe);
      }
    }
    if (el.tagName === "A" && el.hasAttribute("target")) el.setAttribute("rel", "noopener noreferrer");
  });
  return t.innerHTML;
}
function focusCellLine(cellId, line) {
  const c = findCell(cellId);
  if (!c || !c.el) return;
  selectCell(c.id, "edit");
  c.el.scrollIntoView({ block: "center", behavior: "smooth" });
  if (line && c.taEl) {
    const rows = c.taEl.value.split("\n");
    let at = 0;
    for (let i = 1; i < Math.min(line, rows.length + 1); i++) at += rows[i - 1].length + 1;
    c.taEl.setSelectionRange(at, Math.min(c.taEl.value.length, at + (rows[line - 1] || "").length));
  }
}
