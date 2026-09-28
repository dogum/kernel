#!/usr/bin/env node
// Builds the single-file apps in docs/ from the sources in src/.
//
//   node scripts/build.mjs           write docs/kernel-agent.html and docs/kernel-agent-mobile.html
//   node scripts/build.mjs --check   exit 1 if either page is out of date with src/ (CI runs this)
//
// Sources use three markers:
//   <!-- @include path -->    on a line of its own: replaced by the file (or, with a *, every matching
//                             file in name order). Paths are relative to src/. Included files may
//                             include others.
//   /*@embed path*/           inside a JavaScript template literal: replaced by the file's text, escaped
//                             for the literal (this is how src/agent/python/harness.py reaches Python).
//   %VERSION%                 anywhere: replaced by "version" from package.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(ROOT, "src");
export const PAGES = [
  ["agent/desktop.html", "docs/kernel-agent.html"],
  ["agent/mobile.html", "docs/kernel-agent-mobile.html"],
];

const INCLUDE = /^[ \t]*<!-- @include (\S+) -->[ \t]*\n/gm;
const EMBED = /\/\*@embed (\S+)\*\//g;

function read(rel) {
  const file = path.join(SRC, rel);
  if (!fs.existsSync(file)) throw new Error(`missing source file src/${rel}`);
  return fs.readFileSync(file, "utf8");
}

function expandGlob(spec) {
  if (!spec.includes("*")) return [spec];
  const dir = path.posix.dirname(spec);
  const pattern = new RegExp("^" + path.posix.basename(spec).split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
  const names = fs.readdirSync(path.join(SRC, dir)).filter((name) => pattern.test(name)).sort();
  if (!names.length) throw new Error(`@include ${spec} matched no files`);
  return names.map((name) => path.posix.join(dir, name));
}

function templateLiteral(text) {
  return text.replace(/\n$/, "").replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function expand(rel, stack = []) {
  if (stack.includes(rel)) throw new Error(`include cycle: ${[...stack, rel].join(" -> ")}`);
  const text = read(rel);
  if (text && !text.endsWith("\n")) throw new Error(`src/${rel} must end with a newline`);
  return text
    .replace(INCLUDE, (_, spec) => expandGlob(spec).map((file) => expand(file, [...stack, rel])).join(""))
    .replace(EMBED, (_, spec) => templateLiteral(read(spec)));
}

// The release version lives in package.json; sources say %VERSION% where it belongs.
export const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

export function build(template) {
  return expand(template).replaceAll("%VERSION%", VERSION);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const [template, out] of PAGES) {
    const html = build(template);
    const target = path.join(ROOT, out);
    const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
    if (check) {
      if (current !== html) { stale += 1; console.error(`${out} is out of date: run node scripts/build.mjs and commit the result`); }
    } else if (current !== html) {
      fs.writeFileSync(target, html);
      console.log(`built ${out} (${Math.round(html.length / 1024)} KB)`);
    } else {
      console.log(`${out} is up to date`);
    }
  }
  if (stale) process.exit(1);
  if (check) console.log("docs/ matches src/");
}
