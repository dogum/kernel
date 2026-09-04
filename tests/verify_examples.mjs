#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const examplesRoot = path.join(repo, "examples");

const specs = {
  "ares-station": {
    cells: 53,
    code: 27,
    markdown: 26,
    outputs: 53,
    images: 12,
    lastCell: "markdown",
    files: ["README.md", "prompt.md", "result.ipynb", "figures/mission-overview.png"],
  },
  "regex-engine": {
    cells: 70,
    code: 34,
    markdown: 36,
    outputs: 52,
    images: 2,
    lastCell: "code",
    files: [
      "README.md",
      "prompt.md",
      "continuation.md",
      "result.ipynb",
      "artifacts/myre.py",
      "artifacts/REPORT.md",
      "figures/pathological-benchmark.png",
    ],
  },
  "lunar-settlement": {
    cells: 19,
    code: 13,
    markdown: 6,
    outputs: 29,
    images: 4,
    lastCell: "markdown",
    files: [
      "README.md",
      "prompt.md",
      "result.ipynb",
      "artifacts/ASSUMPTIONS.csv",
      "artifacts/LAUNCH_MANIFEST.csv",
      "artifacts/lunar_settlement_model.py",
      "artifacts/REPORT.md",
      "artifacts/mass_budget.png",
      "artifacts/launch_stack.png",
      "artifacts/launch_uncertainty.png",
      "artifacts/sensitivity_tornado.png",
    ],
  },
  "fleet-dna": {
    cells: 61,
    code: 50,
    markdown: 11,
    outputs: 76,
    images: 5,
    lastCell: "markdown",
    files: ["README.md", "SOURCE.md", "prompt.md", "result.ipynb", "figures/archetypes.png"],
  },
};

function outputCount(notebook) {
  return notebook.cells.reduce((total, cell) => total + (cell.outputs || []).length, 0);
}

function imageCount(notebook) {
  return notebook.cells.reduce(
    (total, cell) => total + (cell.outputs || []).filter((output) => output.data?.["image/png"]).length,
    0,
  );
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

function sha256(absolute) {
  return createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
}

for (const [slug, spec] of Object.entries(specs)) {
  const directory = path.join(examplesRoot, slug);
  for (const relative of spec.files) {
    const absolute = path.join(directory, relative);
    assert.ok(fs.existsSync(absolute), `${slug}: missing ${relative}`);
    assert.ok(fs.statSync(absolute).size > 0, `${slug}: empty ${relative}`);
  }

  const notebookPath = path.join(directory, "result.ipynb");
  const raw = fs.readFileSync(notebookPath, "utf8");
  const notebook = JSON.parse(raw);
  const code = notebook.cells.filter((cell) => cell.cell_type === "code").length;
  const markdown = notebook.cells.filter((cell) => cell.cell_type === "markdown").length;
  const errors = notebook.cells.flatMap((cell) => cell.outputs || []).filter((output) => output.output_type === "error");

  assert.equal(notebook.nbformat, 4, `${slug}: unexpected notebook format`);
  assert.equal(notebook.cells.length, spec.cells, `${slug}: cell count changed`);
  assert.equal(code, spec.code, `${slug}: code-cell count changed`);
  assert.equal(markdown, spec.markdown, `${slug}: Markdown-cell count changed`);
  assert.equal(outputCount(notebook), spec.outputs, `${slug}: output count changed`);
  assert.equal(imageCount(notebook), spec.images, `${slug}: image count changed`);
  assert.equal(notebook.cells.at(-1)?.cell_type, spec.lastCell, `${slug}: final-cell behavior changed`);
  assert.equal(errors.length, 0, `${slug}: notebook currently ends with error outputs`);

  assert.equal(notebook.metadata?.kernel_agent, undefined, `${slug}: private agent metadata is present`);
  assert.equal(notebook.metadata?.kernel_environment?.browser, undefined, `${slug}: browser fingerprint is present`);
  assert.equal(notebook.metadata?.kernel_environment?.cells, undefined, `${slug}: private cell ledger is present`);
  assert.equal(notebook.metadata?.kernel_environment?.artifacts, undefined, `${slug}: private artifact ledger is present`);
  assert.ok(
    notebook.cells.every((cell) => cell.metadata?.kernel?.provenance === undefined),
    `${slug}: internal run/tool provenance is present`,
  );
  assert.ok(!raw.includes("encrypted_content"), `${slug}: encrypted provider continuation state is present`);
}

const allFiles = walk(examplesRoot).map((absolute) => path.relative(examplesRoot, absolute));
assert.ok(!allFiles.some((name) => name.endsWith(".kernel.zip")), "full workspace archive was committed");
assert.ok(!allFiles.some((name) => name.endsWith(".kernel-run.zip")), "private run archive was committed");
assert.ok(!allFiles.some((name) => name.endsWith(".pyc")), "compiled Python cache was committed");
assert.ok(!allFiles.includes("fleet-dna/fleet_dna_vehicle_days.csv"), "Fleet DNA source CSV was committed");
assert.ok(!allFiles.includes("fleet-dna/Fleet_DNA_Data_Dictionary.pdf"), "Fleet DNA source PDF was committed");

const curatedArtifactHashes = {
  "regex-engine/artifacts/REPORT.md": "e3ae9d1889507a8f635dcfaae9c9b623473f73f86800aeb45e982597f07e8df5",
  "regex-engine/artifacts/myre.py": "cd28ec3bf978252786af8fef0497a5020b31b07991c8b7a24a27100fbaddb6dd",
  "lunar-settlement/artifacts/ASSUMPTIONS.csv": "db82f4e3be36e1d8228ca0580e37a159b094175ecb6a3130394acb41d3347ff0",
  "lunar-settlement/artifacts/LAUNCH_MANIFEST.csv": "465547dd7fb15876cb65e6d58c72c2fe19921e7beae6b4e00e04559d50756dd6",
  "lunar-settlement/artifacts/REPORT.md": "c6887a7b730a75b2ba6dfb545f085e4d98e2a3db352f2b24a8710a7efe645435",
  "lunar-settlement/artifacts/lunar_settlement_model.py": "79d813eaba60e2e10a1eff01b2b134fc12c2e9f5474d1604c15d595d72232263",
  "lunar-settlement/artifacts/launch_stack.png": "589febf594b6fa2c1e5ba4d58b0ed087756257cc4a046752604d25838ffefee8",
  "lunar-settlement/artifacts/launch_uncertainty.png": "99ecbe7db6d5b94f81f048d598abb7b40174d9fd3d037c0d2e357e110edda0a7",
  "lunar-settlement/artifacts/mass_budget.png": "3299905783d4b33710978415b1aeb6e6662f4248d283c18e7ffa12d03e6d4392",
  "lunar-settlement/artifacts/sensitivity_tornado.png": "56f17ec875b0211f251e2d3840257fba908596b39fc279a6480b4135db03d066",
};

for (const [relative, expected] of Object.entries(curatedArtifactHashes)) {
  assert.equal(sha256(path.join(examplesRoot, relative)), expected, `${relative}: curated artifact changed`);
}

const lunarModel = fs.readFileSync(
  path.join(examplesRoot, "lunar-settlement/artifacts/lunar_settlement_model.py"),
  "utf8",
);
assert.match(
  lunarModel,
  /Path\(__file__\)\.resolve\(\)\.with_name\("ASSUMPTIONS\.csv"\)/,
  "lunar-settlement: default assumptions path is not relative to the model",
);
assert.match(
  lunarModel,
  /path = DEFAULT_ASSUMPTIONS if path is None else path/,
  "lunar-settlement: explicit assumptions paths are not preserved",
);

const markdownFiles = [path.join(repo, "README.md"), ...walk(examplesRoot).filter((name) => name.endsWith(".md"))];
for (const markdownPath of markdownFiles) {
  const markdown = fs.readFileSync(markdownPath, "utf8");
  for (const match of markdown.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].trim().split(/\s+"/)[0];
    if (/^(?:https?:|mailto:|artifact:|#)/.test(target)) continue;
    const localPath = decodeURIComponent(target.split("#", 1)[0]);
    assert.ok(fs.existsSync(path.resolve(path.dirname(markdownPath), localPath)), `${markdownPath}: broken link ${target}`);
  }
}

console.log(`Example verification passed: ${Object.keys(specs).length} notebooks, ${allFiles.length} curated files.`);
