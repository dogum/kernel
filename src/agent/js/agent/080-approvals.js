/* ── approval gates ── */
function askApproval(label) {
  return new Promise((res) => {
    const tx = $("#agTx");
    const el = document.createElement("div");
    el.className = "ag-approve";
    el.dataset.k = "c";
    el.innerHTML =
      "<span>" + agEsc(label) + '</span><button class="ok">APPROVE</button><button class="skip">SKIP</button>';
    tx.appendChild(el);
    tx.scrollTop = tx.scrollHeight;
    const done = (value) => {
      if (agApprovalResolver !== done) return;
      agApprovalResolver = null;
      el.className = "ag-chips";
      el.replaceChildren();
      fillTranscriptChips(el, chip(label + (value ? " — approved" : " — skipped")));
      txPersist();
      res(value);
    };
    agApprovalResolver = done;
    el.querySelector(".ok").addEventListener("click", () => done(true));
    el.querySelector(".skip").addEventListener("click", () => done(false));
  });
}
function resolveApproval(value) {
  const fn = agApprovalResolver;
  if (fn) fn(!!value);
}
