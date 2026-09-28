/* ===== Python syntax highlighter (self-contained) ===== */
const PYRE = new RegExp(
  [
    "(#[^\\n]*)", // comment
    "((?:[rbfRBF]{0,2})(?:\"\"\"[\\s\\S]*?\"\"\"|'''[\\s\\S]*?'''|\"(?:\\\\.|[^\"\\\\\\n])*\"|'(?:\\\\.|[^'\\\\\\n])*'))", // string
    "(@[A-Za-z_][\\w.]*)", // decorator
    "(\\b\\d[\\d_]*\\.?\\d*(?:[eE][+-]?\\d+)?j?\\b)", // number
    "(\\b(?:False|None|True|and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield|match|case)\\b)", // keyword
    "(\\b(?:print|len|range|int|float|str|list|dict|set|tuple|bool|bytes|type|isinstance|enumerate|zip|map|filter|sorted|reversed|sum|min|max|abs|round|open|input|super|object|repr|format|getattr|setattr|hasattr|self|cls)\\b)", // builtin
  ].join("|"),
  "g",
);

function hlPython(src) {
  return esc(src).replace(PYRE, (m, com, str, dec, num, kw, bif) => {
    if (com) return '<span class="t-com">' + com + "</span>";
    if (str) return '<span class="t-str">' + str + "</span>";
    if (dec) return '<span class="t-dec">' + dec + "</span>";
    if (num) return '<span class="t-num">' + num + "</span>";
    if (kw) return '<span class="t-kw">' + kw + "</span>";
    if (bif) return '<span class="t-bif">' + bif + "</span>";
    return m;
  });
}
