/* ----- drop files anywhere on the page to mount them (the agent panel keeps image drops for chat) ----- */
(function () {
  let depth = 0,
    overlay = null;
  const isFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");
  const show = (on) => {
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "drop-overlay";
      overlay.innerHTML =
        '<div><b>Drop to mount files</b><span>Read them from Python by name, e.g. pd.read_csv("file.csv")</span></div>';
      document.body.appendChild(overlay);
    }
    overlay.classList.toggle("on", on);
  };
  document.addEventListener("dragenter", (e) => {
    if (!isFiles(e)) return;
    depth++;
    show(!(e.target.closest && e.target.closest("#agentPanel")));
  });
  document.addEventListener("dragleave", (e) => {
    if (!isFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) show(false);
  });
  document.addEventListener("dragover", (e) => {
    if (!isFiles(e)) return;
    e.preventDefault();
    if (overlay) overlay.classList.toggle("on", !(e.target.closest && e.target.closest("#agentPanel")));
  });
  document.addEventListener("drop", (e) => {
    depth = 0;
    show(false);
    if (!isFiles(e) || e.defaultPrevented) return;
    e.preventDefault();
    const files = [...e.dataTransfer.files];
    if (files.length) {
      openData();
      mountUploadedFiles(files, false);
    }
  });
})();
async function mountUploadedFiles(files, keepFolders) {
  files = [...files];
  if (!files.length) return;
  if (!kernelReady) {
    toast("Kernel still booting — one moment.", "err");
    return;
  }
  const TEXT = ["csv", "tsv", "tab", "txt", "md", "log", "json", "py", "yaml", "yml", "html", "xml"];
  let ok = 0;
  for (const f of files) {
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      const proposed = keepFolders && f.webkitRelativePath ? f.webkitRelativePath : f.name,
        path = uniqueArtifactPath(proposed);
      await pyFS.write(path, buf);
      let preview = "";
      if (TEXT.includes(fileExt(path))) {
        try {
          preview = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, 8192)).slice(0, 4000);
        } catch (_) {}
      }
      const rec = {
        id: artifactId(),
        name: path,
        path,
        size: f.size,
        type: f.type,
        preview,
        origin: "upload",
        stage: "input",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        fingerprint: f.size + ":" + crc32(buf),
        bytes: buf.slice(),
      };
      dataFiles.push(rec);
      ok++;
    } catch (err) {
      toast("Could not mount " + f.name + " · " + String(err.message || err), "err");
      console.error(err);
    }
  }
  renderDataChips();
  renderDataList();
  recomputeDependencies();
  scheduleWorkspacePersist();
  if (ok) toast(ok + " file" + (ok > 1 ? "s" : "") + " mounted" + (keepFolders ? " with folders" : ""));
}
$("#fileData").addEventListener("change", async (e) => {
  await mountUploadedFiles(e.target.files, false);
  e.target.value = "";
});
$("#fileFolder").addEventListener("change", async (e) => {
  await mountUploadedFiles(e.target.files, true);
  e.target.value = "";
});
