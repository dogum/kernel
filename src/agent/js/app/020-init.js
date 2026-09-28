/* ===== init ===== */
(function init() {
  initLibrary();
  render();
  if (cells[0]) selectCell(cells[0].id, "command");
  setNbTitle();
  initPanels();
  activateNotebookAgent(nbId);
  bootKernel();
})();
