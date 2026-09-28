/* ── kernel helpers ── */
function agWaitKernel() {
  return new Promise((res, rej) => {
    if (kernelReady) {
      res();
      return;
    }
    let n = 0;
    const iv = setInterval(() => {
      if (kernelReady) {
        clearInterval(iv);
        res();
      } else if (++n > 240) {
        clearInterval(iv);
        rej(new Error("kernel did not become ready"));
      }
    }, 500);
  });
}
function agWaitIdle() {
  return new Promise((res) => {
    if (!busy) {
      res(true);
      return;
    }
    const iv = setInterval(() => {
      if (!busy || agStop) {
        clearInterval(iv);
        res(!busy);
      }
    }, 200);
  });
}
async function agRunCell(cell) {
  await agWaitKernel();
  if (!(await agWaitIdle())) return false;
  focusAgCell(cell);
  return (await runCell(cell, { agent: true })) === true;
}
async function agRunCellsForTool(list) {
  const out = [],
    budget = { images: 0 };
  for (let i = 0; i < list.length; i++) {
    const cell = list[i];
    if (agStop) {
      out.push({
        type: "text",
        text:
          "Stopped by the human before running " +
          list
            .slice(i)
            .map((c) => c.id)
            .join(", ") +
          ".",
      });
      break;
    }
    if (!(await agRunCell(cell))) {
      out.push({
        type: "text",
        text: "ERROR: the kernel could not run cell " + cell.id + " (busy or not ready); nothing further was executed.",
      });
      break;
    }
    const hadErr = (cell.outputs || []).some((o) => o.kind === "error");
    txDom(
      "c",
      chip(
        "▶ ran " + cellTag(cell) + " · " + (cell.runtime != null ? fmtDur(cell.runtime) : "—"),
        hadErr ? "err" : "run",
        cell.id,
      ),
    );
    out.push({ type: "text", text: "cell_id: " + cell.id }, ...(await marshalCell(cell, budget)));
    if (hadErr) {
      if (i < list.length - 1)
        out.push({
          type: "text",
          text:
            "Stopped at the first error; not run: " +
            list
              .slice(i + 1)
              .map((c) => c.id)
              .join(", "),
        });
      break;
    }
  }
  return out;
}
function cellLabel(cell) {
  return "[" + (indexOf(cell) + 1) + "]";
}
function cellTag(cell) {
  return "cell " + (indexOf(cell) + 1);
}
function focusAgCell(cell) {
  if (cell && cell.el) {
    selectCell(cell.id, "command");
    cell.el.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}
