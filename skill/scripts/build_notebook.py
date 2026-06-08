#!/usr/bin/env python3
"""Assemble a valid Jupyter notebook (.ipynb, nbformat 4.5) from a simple JSON cell spec.

Always build KERNEL notebooks with this instead of hand-writing notebook JSON — it is
easy to produce subtly invalid .ipynb by hand (wrong source splitting, missing ids,
missing required fields) and KERNEL / Jupyter will reject or mangle it.

USAGE
    python scripts/build_notebook.py <cells.json> <output.ipynb> ["Notebook Title"]

CELL SPEC (the JSON file)
    Either a list of cells:
        [
          {"type": "markdown", "source": "# Title\n\nFraming sentence."},
          {"type": "code",     "source": "import pandas as pd\npd.__version__"}
        ]
    or an object with extra metadata:
        {"title": "My analysis", "cells": [ ...same cells... ]}

    Each cell:
      - "type":   "markdown" or "code"   (required)
      - "source": the full cell text as one string, with real newlines (required)

    "source" is a plain multi-line string; this script handles the line-splitting that
    the notebook format expects. The optional title (CLI arg or "title" key) is stored in
    notebook metadata only — include your own H1 title *cell* in the spec for it to show.
"""
import json
import sys
import uuid


def _lines(source: str):
    """Notebook 'source' is a list of lines, each keeping its trailing newline
    except (conventionally) the last. Empty source -> []."""
    if not source:
        return []
    return source.splitlines(keepends=True)


def build(spec, title=None):
    if isinstance(spec, dict):
        cells_in = spec.get("cells", [])
        title = title or spec.get("title")
    elif isinstance(spec, list):
        cells_in = spec
    else:
        raise ValueError("Spec must be a JSON list of cells or an object with a 'cells' list.")

    if not cells_in:
        raise ValueError("Spec contains no cells.")

    cells = []
    for n, c in enumerate(cells_in):
        if not isinstance(c, dict):
            raise ValueError(f"Cell {n} is not an object.")
        ctype = c.get("type", "code")
        if ctype not in ("code", "markdown"):
            raise ValueError(f"Cell {n} has invalid type {ctype!r} (use 'code' or 'markdown').")
        src = c.get("source", "")
        if not isinstance(src, str):
            raise ValueError(f"Cell {n} 'source' must be a string.")
        cell = {
            "cell_type": ctype,
            "id": uuid.uuid4().hex[:12],
            "metadata": {},
            "source": _lines(src),
        }
        if ctype == "code":
            cell["execution_count"] = None
            cell["outputs"] = []
        cells.append(cell)

    nb = {
        "cells": cells,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python", "version": "3.12"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    if title:
        nb["metadata"]["title"] = title
    return nb


def main(argv):
    if len(argv) < 3:
        print(__doc__)
        return 2
    spec_path, out_path = argv[1], argv[2]
    title = argv[3] if len(argv) > 3 else None
    with open(spec_path, "r", encoding="utf-8") as f:
        spec = json.load(f)
    nb = build(spec, title)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(nb, f, ensure_ascii=False, indent=1)
    n_code = sum(1 for c in nb["cells"] if c["cell_type"] == "code")
    n_md = sum(1 for c in nb["cells"] if c["cell_type"] == "markdown")
    print(f"Wrote {out_path}: {len(nb['cells'])} cells ({n_md} markdown, {n_code} code).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
