#!/usr/bin/env node
import fs from "node:fs";

const args = process.argv.slice(2);
const check = args.includes("--check");
const paths = args.filter((arg) => arg !== "--check");
const sourcePath = paths[0] || "docs/kernel-agent.html";
const targetPath = paths[1] || "docs/kernel-agent-mobile.html";
const source = fs.readFileSync(sourcePath, "utf8");
const originalTarget = fs.readFileSync(targetPath, "utf8");
let target = originalTarget;

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

target = target.replace(
  '  initPanels();\n  bootKernel();\n})();\n\n/* ===== mobile UI controller',
  '  initPanels();\n  activateNotebookAgent(nbId);\n  bootKernel();\n})();\n\n/* ===== mobile UI controller',
);

target = target.replace(/<title>[^<]*<\/title>/, '<title>KERNEL·A v2.3.1 — agentic notebook · mobile (PWA)</title>');
target = target.replace(/<h1>KERNEL<span class="brand-a">·A(?: v[\d.]+)?<\/span><\/h1>/, '<h1>KERNEL<span class="brand-a">·A v2.3.1</span></h1>');
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
if (!target.includes('id="dataFolderUpload"')) {
  const folderButton = source.match(/^\s*<button class="panel-add" id="dataFolderUpload"[^\n]*$/m)?.[0];
  if (!folderButton) throw new Error("Missing desktop folder-upload button");
  target = target.replace(/(^\s*<button class="panel-add" id="dataUpload"[^\n]*$)/m, `$1\n${folderButton}`);
}
if (!target.includes('data-mi="shareZip"')) {
  const shareItems = source.match(/^\s*<button class="menu-item" data-mi="shareZip"[^\n]*\n\s*<button class="menu-item" data-mi="diagnostics"[^\n]*$/m)?.[0];
  if (!shareItems) throw new Error("Missing desktop share/diagnostics menu items");
  target = target.replace(/(^\s*<button class="menu-item" data-mi="downloadPy"[^\n]*$)/m, `$1\n${shareItems}`);
}
if (!target.includes('data-mi="runZip"')) {
  const runZipItem = source.match(/^\s*<button class="menu-item" data-mi="runZip"[^\n]*$/m)?.[0];
  if (!runZipItem) throw new Error("Missing desktop private-run ZIP menu item");
  target = target.replace(/(^\s*<button class="menu-item" data-mi="downloadPy"[^\n]*$)/m, `$1\n${runZipItem}`);
}
const fileInput = source.match(/^<input type="file" id="fileIpynb"[^\n]*$/m)?.[0];
if (!fileInput) throw new Error("Missing desktop notebook file input");
target = target.replace(/^<input type="file" id="fileIpynb"[^\n]*$/m, fileInput);
const folderInput = source.match(/^<input type="file" id="fileFolder"[^\n]*$/m)?.[0];
if (!folderInput) throw new Error("Missing desktop folder file input");
if (target.includes('id="fileFolder"')) target = target.replace(/^<input type="file" id="fileFolder"[^\n]*$/m, folderInput);
else target = target.replace(/(^<input type="file" id="fileData"[^\n]*$)/m, `$1\n${folderInput}`);

if (check) {
  if (target !== originalTarget) throw new Error(`${targetPath} is out of sync; run node scripts/sync_agent_builds.mjs`);
  console.log(`KERNEL·A v2.3.1 desktop/mobile sync verified for ${targetPath}`);
} else {
  fs.writeFileSync(targetPath, target);
  console.log(`Synced shared KERNEL·A v2.3.1 runtime and UI into ${targetPath}`);
}
