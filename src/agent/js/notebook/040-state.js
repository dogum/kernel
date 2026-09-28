/* ===== state ===== */
let kernelReady = false,
  busy = false;
let cells = [],
  selectedId = null,
  mode = "command",
  execCounter = 0;
let lastD = 0;
const dataFiles = [];
let micropipReady = false,
  jediReady = false;
let nbId = null,
  nbName = "Untitled"; // current notebook
let inspectorOpen = false; // mirrors the right (Variables) panel
let findOpen = false; // find/replace bar
let _pyChain = Promise.resolve(); // serializes all Pyodide interpreter calls
