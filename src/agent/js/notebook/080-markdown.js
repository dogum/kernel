/* ===== compact markdown renderer ===== */
function safeContentUrl(raw, image) {
  const u = String(raw || "")
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, "");
  if (!u) return "#";
  if (image && /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(u)) return u;
  if (/^(?:https?:|mailto:)/i.test(u) || /^(?:#|\.\.?\/|\/)[^\\]*$/.test(u)) return u;
  return "#";
}
function escAttr(s) {
  return esc(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function inlineToken(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
function mdInline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (m, c) => {
    codes.push(c);
    return "\u0000" + (codes.length - 1) + "\u0000";
  });
  s = esc(s);
  s = s.replace(
    /!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g,
    (m, a, u) =>
      '<img alt="' + escAttr(inlineToken(a)) + '" src="' + escAttr(safeContentUrl(inlineToken(u), true)) + '">',
  );
  s = s.replace(
    /\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g,
    (m, t, u) =>
      '<a href="' +
      escAttr(safeContentUrl(inlineToken(u), false)) +
      '" target="_blank" rel="noopener noreferrer">' +
      t +
      "</a>",
  );
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>").replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => "<code>" + esc(codes[+i]) + "</code>");
  return s;
}
function renderMarkdownCore(md) {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  let html = "",
    i = 0;
  const flushP = (buf) => {
    if (buf.length) {
      html += "<p>" + mdInline(buf.join(" ")) + "</p>";
      buf.length = 0;
    }
  };
  let para = [];
  while (i < lines.length) {
    let ln = lines[i];
    const fence = ln.match(/^```(\w*)\s*$/);
    if (fence) {
      flushP(para);
      const lang = fence[1];
      const code = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++;
      if (lang === "mermaid") {
        html += '<div class="mermaid">' + esc(code.join("\n")) + "</div>";
        continue;
      }
      const body = lang === "py" || lang === "python" ? hlPython(code.join("\n")) : esc(code.join("\n"));
      html += "<pre><code>" + body + "</code></pre>";
      continue;
    }
    const h = ln.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushP(para);
      const lvl = h[1].length;
      html += "<h" + lvl + ">" + mdInline(h[2]) + "</h" + lvl + ">";
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(ln)) {
      flushP(para);
      html += "<hr>";
      i++;
      continue;
    }
    if (/^\s*>/.test(ln)) {
      flushP(para);
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        q.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      html += "<blockquote>" + renderMarkdown(q.join("\n")) + "</blockquote>";
      continue;
    }
    if (/^\s*([-*+])\s+/.test(ln)) {
      flushP(para);
      const items = [];
      while (i < lines.length && /^\s*([-*+])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      html += "<ul>" + items.map((t) => "<li>" + mdInline(t) + "</li>").join("") + "</ul>";
      continue;
    }
    if (/^\s*\d+\.\s+/.test(ln)) {
      flushP(para);
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      html += "<ol>" + items.map((t) => "<li>" + mdInline(t) + "</li>").join("") + "</ol>";
      continue;
    }
    if (/^\s*\|(.+)\|\s*$/.test(ln) && i + 1 < lines.length && /^\s*\|?[\s:\-|]+\|?\s*$/.test(lines[i + 1])) {
      flushP(para);
      const cells2 = (r) =>
        r
          .replace(/^\s*\|/, "")
          .replace(/\|\s*$/, "")
          .split("|")
          .map((c) => c.trim());
      const head = cells2(ln);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|(.+)\|\s*$/.test(lines[i])) {
        rows.push(cells2(lines[i]));
        i++;
      }
      html +=
        "<table><thead><tr>" +
        head.map((c) => "<th>" + mdInline(c) + "</th>").join("") +
        "</tr></thead><tbody>" +
        rows.map((r) => "<tr>" + r.map((c) => "<td>" + mdInline(c) + "</td>").join("") + "</tr>").join("") +
        "</tbody></table>";
      continue;
    }
    if (ln.trim() === "") {
      flushP(para);
      i++;
      continue;
    }
    para.push(ln.trim());
    i++;
  }
  flushP(para);
  return html;
}
