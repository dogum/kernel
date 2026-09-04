# Real KERNEL Agent runs

These are curated captures of four autonomous notebook runs made in KERNEL Agent v2.3.0. They are not hand-authored showcase notebooks: the prompts, decisions, corrections, outputs, and awkward edges are preserved so the repository contains evidence of what the harness actually did.

| Example | What it tests | Result |
|---|---|---|
| [Ares Station operations](ares-station/) | Long, open-ended simulation, anomaly detection, forecasting, optimization, stress testing, and executive reporting | A 4,320-hour synthetic colony twin, seven diagnosed incidents, a time-aware maintenance model, and a stress-tested operating policy |
| [Regex engine](regex-engine/) | Iterative software construction, differential testing, shrinking, self-repair, and benchmarking | A from-scratch NFA/DFA engine, three repaired semantic bugs, and 20,000 consecutive agreements with Python `re.fullmatch` |
| [Lunar settlement launch model](lunar-settlement/) | Assumption management, bottom-up systems modeling, integer logistics, Monte Carlo uncertainty, and artifact production | Baseline 121 planned successful launches; P10/P50/P90 of 112/134/161 under explicitly uncertain assumptions |
| [Fleet DNA electrification](fleet-dna/) | Real, wide public data; dictionary interpretation; data-quality forensics; leakage-safe modeling; stability analysis; and engineering recommendations | Three duty-cycle archetypes, ten actual representative days, and grouped out-of-vehicle vocation prediction |

## What each example contains

- `prompt.md` is the exact initial user prompt.
- `result.ipynb` contains the original visible cells and rendered outputs and opens in KERNEL or another Jupyter-compatible viewer.
- A representative image is kept for quick browsing, either in `figures/` or in the original artifact bundle; the notebooks contain the complete figure set.
- `artifacts/` contains original registered final artifacts when they were recovered from the workspace archive.
- The example README records run shape, provider-reported usage, important outcomes, and limitations.

## Curation and privacy

The notebooks are distribution copies, not private workspace backups. Curation removes complete chat and provider message history, encrypted continuation items, internal run/tool/thread identifiers, browser user-agent data, checkpoint history, and repeated artifact snapshots. Visible notebook cells and outputs are retained. In the Fleet DNA notebook, several long verbatim data-dictionary dumps were replaced by a curation notice; the official document remains linked in [`fleet-dna/SOURCE.md`](fleet-dna/SOURCE.md).

Provider token counts are cumulative over the iterative tool loop. They measure repeated API payload traffic, not the length of the initial prompt or the number of unique words in the notebook.

## Why the full workspace ZIPs are not here

Full `.kernel.zip` files are recovery artifacts. Each exact checkpoint includes its notebook state and checkpoint artifact payloads, so image-heavy notebooks and large uploads recur throughout the archive. The exporter then assembles all ZIP entries into one browser-memory buffer. That made the Ares recovery ZIP about 119 MiB, and a Fleet DNA run with a 20 MiB source CSV eventually failed with `Array buffer allocation failed` before download.

For sharing or review, use the curated notebook/artifact pattern shown here, KERNEL's share-safe export, or the checkpoint-free private-run ZIP. Keep the full workspace ZIP for cases where exact checkpoint restoration is actually required.

## Validation

From the repository root:

```bash
node tests/verify_examples.mjs
```

The check parses every notebook, verifies the expected run shape and final-cell behavior, rejects private agent metadata and checkpoint archives, and confirms that no notebook currently ends in an error output.
