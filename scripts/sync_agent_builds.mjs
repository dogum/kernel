#!/usr/bin/env node
import fs from "node:fs";

const sourcePath = process.argv[2] || "docs/kernel-agent.html";
const targetPath = process.argv[3] || "docs/kernel-agent-mobile.html";
const source = fs.readFileSync(sourcePath, "utf8");
let target = fs.readFileSync(targetPath, "utf8");

function section(text, start, end) {
  const a = text.indexOf(start);
  const b = text.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`Missing section: ${start} … ${end}`);
  return text.slice(a, b);
}

function replaceSection(text, start, end, replacement) {
  const a = text.indexOf(start);
  const b = text.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`Missing target section: ${start} … ${end}`);
  return text.slice(0, a) + replacement + text.slice(b);
}

const v2Style = section(source, '<style id="kernel-agent-v2">', '<style id="dna-suite">');
if (target.includes('<style id="kernel-agent-v2">')) {
  target = replaceSection(target, '<style id="kernel-agent-v2">', '<style id="dna-suite">', v2Style);
} else {
  target = target.replace('<style id="dna-suite">', v2Style + '<style id="dna-suite">');
}

target = replaceSection(
  target,
  '  <aside class="panel panel-agent"',
  '  <aside class="panel panel-left"',
  section(source, '  <aside class="panel panel-agent"', '  <aside class="panel panel-left"'),
);
target = replaceSection(
  target,
  '<div class="scrim" id="agScrim">',
  '<div class="scrim" id="helpScrim">',
  section(source, '<div class="scrim" id="agScrim">', '<div class="scrim" id="helpScrim">'),
);
target = replaceSection(
  target,
  'const HARNESS = `',
  '/* live theme:',
  section(source, 'const HARNESS = `', '/* live theme:'),
);

target = target.replace(/<title>[^<]*<\/title>/, '<title>KERNEL·A v2 — agentic notebook · mobile (PWA)</title>');
target = target.replace('<h1>KERNEL<span class="brand-a">·A</span></h1>', '<h1>KERNEL<span class="brand-a">·A v2</span></h1>');
target = target.replace('id="btnOpen" title="Open .ipynb"', 'id="btnOpen" title="Open .ipynb or .kernel.zip"');
if (!target.includes('id="btnWorkspace"')) {
  const zipButton = source.match(/^\s*<button class="btn" id="btnWorkspace"[^\n]*$/m)?.[0];
  if (!zipButton) throw new Error("Missing desktop workspace button");
  target = target.replace(/(^\s*<button class="btn" id="btnSave"[^\n]*$)/m, `$1\n${zipButton}`);
}
if (!target.includes('id="varsSort"')) {
  const tools = source.match(/^\s*<div class="var-tools"[^\n]*$/m)?.[0];
  if (!tools) throw new Error("Missing desktop variable tools");
  target = target.replace(/(^\s*<div class="panel-search"><input id="varsFilter"[^\n]*$)/m, `$1\n${tools}`);
}
const fileInput = source.match(/^<input type="file" id="fileIpynb"[^\n]*$/m)?.[0];
if (!fileInput) throw new Error("Missing desktop notebook file input");
target = target.replace(/^<input type="file" id="fileIpynb"[^\n]*$/m, fileInput);

fs.writeFileSync(targetPath, target);
console.log(`Synced shared KERNEL·A v2 runtime and UI into ${targetPath}`);
