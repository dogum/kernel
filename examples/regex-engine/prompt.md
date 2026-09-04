You are operating autonomously in a Jupyter notebook running Pyodide in the
browser. No internet, no subprocess, no compilers. You have the Python stdlib,
and numpy/matplotlib are available (micropip if not).

GOAL: Build a regular expression engine from scratch and prove it correct by
differential-testing it against Python's own `re` module.

Work in many small cells. Never write one giant cell. After every cell, read
the actual output before deciding the next move.

PHASE 0 — Probe the environment.
Empirically determine, do not assume: Python version, which of
numpy/matplotlib/scipy/sympy import, whether micropip works, whether the
filesystem is writable, whether threading/multiprocessing/socket exist,
recursion limit, and rough single-core speed (time a fixed integer loop).
Print a table of findings. Every later decision must respect it.

PHASE 1 — Build `myre.py` on the virtual filesystem, importable, with:
  - a tokenizer and recursive-descent parser to an AST
  - support for: literals, `.`, `*`, `+`, `?`, `|`, grouping, character
    classes `[a-z^]`, escapes, anchors `^` `$`
  - Thompson construction to an NFA, then subset construction to a DFA
  - `myre.fullmatch(pattern, text) -> bool`
  - zero regex usage anywhere in your implementation (obviously)

PHASE 2 — Write a random *pattern* generator and a random *string* generator.
Differential-test: for each random (pattern, string) pair, compare your engine
against `re.fullmatch`. On mismatch, automatically shrink the pattern and the
string to a minimal reproducing case, print it, diagnose the root cause in one
sentence, patch the source file, reload the module, and re-run.

Do not move on until 20,000 consecutive random cases agree. I expect you to
find and fix at least three real bugs. If you find zero, your generator is too
weak — make it nastier and say so.

PHASE 3 — Benchmark. Include the pathological case `a?^n a^n` against
`a^n` for n = 1..20, which makes CPython's backtracking engine blow up while
a DFA stays linear. Plot both curves on a log-scale y axis. Also plot
compile-time vs pattern length and DFA state count vs pattern length.

PHASE 4 — Write `REPORT.md` to disk: environment table, architecture, every
bug you found with its minimal repro and the fix, benchmark numbers, and an
honest section on what your engine does NOT support. Print it at the end.

HARD RULES
- Do not ask me any questions. Make a decision, note the assumption, continue.
- If something errors, that is data. Print the traceback, form a hypothesis,
  test the hypothesis, then fix. Never silently swallow an exception.
- Never claim something works without showing the cell output that proves it.
- Keep a running `progress` dict and print it between phases.
- Stop only when Phase 4 is complete or you hit a hard wall you can prove is
  a Pyodide limitation.
