/* ===== constants ===== */
/* The build fills in the version from package.json. */
const APP_VERSION = "%VERSION%";
const PYODIDE_BASE = "https://cdn.jsdelivr.net/pyodide/v0.29.4/full/";
const STORE_KEY = "kernel.notebook.v1";
const LIB_KEY = "kernel.library.v1";
const nbKey = (id) => "kernel.nb." + id;
