// Helpers for tests that look at the app's source. They parse JavaScript instead of matching text, so
// formatting (whitespace, quote style, line breaks) never changes what a test sees.
//
//   scripts(html)                 inline <script> bodies of a built page
//   functionSource(text, name)    source of the first `function name(…)` in a page or a piece of code
//   declarations(text, ...names)  source that defines each name (function, class, const/let/var)
//   has(text, snippet)            true if the snippet occurs as text, or as the same JavaScript tokens
//   codeIndex(code, snippet, from) token position of a snippet in code, for ordering checks
import * as acorn from "acorn";

const PARSE = { ecmaVersion: "latest", sourceType: "script", allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true };

export function scripts(html) {
  return [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((body) => body.trim());
}

const isHtml = (text) => /^\s*<!doctype html/i.test(text);
const programs = new Map();
function parsed(text) {
  if (!programs.has(text)) {
    const bodies = isHtml(text) ? scripts(text) : [text];
    programs.set(text, bodies.map((code) => ({ code, ast: acorn.parse(code, PARSE) })));
  }
  return programs.get(text);
}

function walk(node, visit) {
  if (!node || typeof node.type !== "string") return false;
  if (visit(node)) return true;
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (Array.isArray(value)) { for (const child of value) if (child && walk(child, visit)) return true; }
    else if (value && typeof value.type === "string" && walk(value, visit)) return true;
  }
  return false;
}

export function functionSource(text, name) {
  for (const { code, ast } of parsed(text)) {
    let found = null;
    walk(ast, (node) => {
      if (node.type === "FunctionDeclaration" && node.id && node.id.name === name) { found = code.slice(node.start, node.end); return true; }
      return false;
    });
    if (found) return found;
  }
  throw new Error(`function ${name} not found`);
}

// Top-level definitions only, so the result can be evaluated on its own.
export function declarations(text, ...names) {
  const out = [];
  for (const name of names) {
    let src = null;
    for (const { code, ast } of parsed(text)) {
      const top = ast.body.flatMap((node) => (node.type === "ExpressionStatement" && iifeBody(node)) || [node]);
      for (const node of top) {
        if ((node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") && node.id.name === name) src = code.slice(node.start, node.end);
        else if (node.type === "VariableDeclaration") {
          const d = node.declarations.find((x) => x.id.type === "Identifier" && x.id.name === name);
          if (d) src = node.declarations.length === 1 ? code.slice(node.start, node.end) : `${node.kind} ${code.slice(d.start, d.end)};`;
        }
        if (src) break;
      }
      if (src) break;
    }
    if (!src) throw new Error(`declaration ${name} not found`);
    out.push(src);
  }
  return out.join("\n");
}

function iifeBody(statement) {
  const call = statement.expression;
  const fn = call && call.type === "CallExpression" ? call.callee : null;
  return fn && (fn.type === "FunctionExpression" || fn.type === "ArrowFunctionExpression") && fn.body.type === "BlockStatement" ? fn.body.body : null;
}

function tokens(code) {
  const out = [];
  try {
    for (const t of acorn.tokenizer(code, { ecmaVersion: "latest", allowHashBang: true })) {
      if (t.type.label === "regexp") out.push(`/${t.value.pattern}/${[...t.value.flags].sort().join("")}`);
      else if (t.type.label === "string" || t.type.label === "template") out.push(`"${t.value}`);
      else out.push(t.value === undefined ? t.type.label : `${t.type.label}:${t.value}`);
    }
  } catch {
    return null;
  }
  return out;
}
const tokenCache = new Map();
function pageTokens(text) {
  if (!tokenCache.has(text)) tokenCache.set(text, (isHtml(text) ? scripts(text) : [text]).map((code) => tokens(code) || []));
  return tokenCache.get(text);
}

function find(hay, needle, from) {
  outer: for (let i = Math.max(0, from); i + needle.length <= hay.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

export function has(text, snippet) {
  if (text.includes(snippet)) return true;
  const needle = tokens(snippet);
  return !!needle && needle.length > 0 && pageTokens(text).some((hay) => find(hay, needle, 0) >= 0);
}

// Token position of a code snippet in a piece of code (not a page), at or after `from`; -1 if absent.
// Use it to check that one piece of code comes before another.
export function codeIndex(code, snippet, from = 0) {
  const needle = tokens(snippet);
  if (!needle || !needle.length || from < 0) return -1;
  return find(pageTokens(code)[0], needle, from);
}
