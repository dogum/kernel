import assert from 'node:assert/strict';
import { staticServer, launch, newContext, openApp, k, kAsync } from './harness.mjs';
const srv = await staticServer(8765);
const { browser, context } = await launch();
const file = process.argv[2] || 'kernel-agent.html';
const mobile = /mobile/.test(file);
const page = await openApp(context, file);
await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
const run = (src) => kAsync(page, `const c=insertCell(cells.length,'code',false);c.source=${JSON.stringify(src)};if(c.taEl)c.taEl.value=c.source;await runCell(c);return {id:c.id,out:c.outputs,exec:c.execCount};`);
const toastAct = (text, nth = 0) => page.locator('.toast:not(.closing)', { hasText: text }).nth(nth).locator('.toast-act');
const clearToasts = () => page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));

// 1. idle chrome: Interrupt only appears while a cell runs; the page never scrolls sideways
assert.equal(await k(page, `getComputedStyle(document.getElementById('btnInterrupt')).display`), 'none');
assert.ok(await k(page, `document.scrollingElement.scrollWidth <= innerWidth`), 'no horizontal page scroll');

// 1b. the brand opens the app menu (other KERNEL apps, project page, theme); nothing floats over the notebook
assert.equal(await k(page, `!!document.getElementById('dna-dock')`), false, 'no floating dock');
await page.click('#suiteBtn');
assert.equal(await k(page, `document.getElementById('suiteBtn').getAttribute('aria-expanded')`), 'true');
assert.equal(await k(page, `document.querySelectorAll('#suiteMenu a.sm-item[href$=".html"]').length`), 3, 'two other apps and the project page are links');
assert.match(await k(page, `document.querySelector('#suiteMenu .sm-item.cur').textContent`), mobile ? /KERNEL·M/ : /KERNEL·A/);
const theme0 = await k(page, `document.documentElement.dataset.theme||'light'`);
await page.click('#suiteMenu [data-sm="theme"]');
assert.notEqual(await k(page, `document.documentElement.dataset.theme`), theme0, 'theme toggles from the menu');
await page.click('#suiteMenu [data-sm="theme"]');
await page.keyboard.press('Escape');
assert.equal(await k(page, `document.getElementById('suiteMenu').classList.contains('open') || document.activeElement.id!=='suiteBtn'`), false, 'Escape closes and returns focus');

// 2. first run: the welcome card offers a sample that loads, runs, and then gets out of the way
assert.equal(await k(page, `!!document.querySelector('.welcome') && !document.querySelector('.welcome').hidden`), true);
await page.click('[data-w="sample"]');
await page.waitForFunction(() => window.__k('cells.length>=3 && cells.every(c=>c.type!=="code"||c.execCount!=null) && !busy'), null, { timeout: 120000 });
assert.equal(await k(page, `!!dataEntry('sample_sales.csv')`), true);
assert.equal(await k(page, `!document.querySelector('.welcome') || document.querySelector('.welcome').hidden`), true, 'welcome hides once the notebook has content');
assert.match(await k(page, `document.querySelector('.out-html table').textContent`), /revenue/);

// 3. outputs read naturally: plain numbers, tracebacks name cells, errors offer a fix, tables export
let r = await run('df.revenue.mean()');
assert.doesNotMatch(JSON.stringify(r.out), /np\.float64|numpy/, 'numpy scalars print as plain numbers');
r = await run('df.revenu.sum()');
const tb = await k(page, `findCell(${JSON.stringify(r.id)}).el.querySelector('.out-err').textContent`);
assert.match(tb, /Cell \d+, line 1/); assert.doesNotMatch(tb, /kernel:\/\//);
assert.equal(await k(page, `!!findCell(${JSON.stringify(r.id)}).el.querySelector('.out-fix')`), true, 'errors offer Fix with agent');
assert.ok(await k(page, `[...document.querySelectorAll('.out-acts button')].some(b=>/CSV/.test(b.textContent))`), 'tables offer CSV export');
r = await run('for i in range(80): print(i)');
assert.equal(await k(page, `findCell(${JSON.stringify(r.id)}).el.querySelector('.out.long')!==null`), true, 'long output is clipped with an expand control');

// 4. delete undo: each toast restores its own cell, in notebook order, whichever is clicked first
await clearToasts();
const before = await k(page, `cells.map(c=>c.id).join()`);
await kAsync(page, `deleteCell(cells[1]); deleteCell(cells[1]);`);
await toastAct('Deleted cell', 0).click();
await toastAct('Deleted cell', 0).click();
assert.equal(await k(page, `cells.map(c=>c.id).join()`), before, 'oldest-first undo keeps notebook order');
assert.equal(await kAsync(page, `const n=cells.length; undoDeleteCell(deletedCells[0]||{}); return cells.length===n`), true, 'a spent Undo does nothing');
await kAsync(page, `selectCell(cells[2].id,'command'); deleteCell(cells[2]);`);
await page.keyboard.press('z');
assert.equal(await k(page, `cells.map(c=>c.id).join()`), before, 'z restores the last deleted cell');

// 5. clear-outputs undo
await clearToasts();
const withOut = await k(page, `cells.filter(c=>c.outputs&&c.outputs.length).length`);
await kAsync(page, `clearOutputs();`);
assert.equal(await k(page, `cells.filter(c=>c.outputs&&c.outputs.length).length`), 0);
await toastAct('Outputs cleared').click();
assert.equal(await k(page, `cells.filter(c=>c.outputs&&c.outputs.length).length`), withOut);

// 6. inspector: explore a DataFrame in one click; deleting a variable can be undone
await kAsync(page, `toggleRight(true); await refreshInspector();`);
await page.waitForFunction(() => window.__k(`lastVars.includes('df')`));
await page.locator('#varsList .var-row', { hasText: 'df' }).first().click();
await page.locator('#varsList .vd-act', { hasText: 'describe' }).first().click();
await page.waitForFunction(() => window.__k(`!busy && cells.some(c=>/\\.describe\\(include/.test(c.source)&&c.execCount!=null)`));
assert.ok(await k(page, `cells.some(c=>/\\.describe\\(include/.test(c.source) && JSON.stringify(c.outputs).includes('revenue'))`), 'describe cell added and run');
await page.waitForFunction(() => !!document.querySelector('#varsList .var-item.open .vd-acts'), null, { timeout: 10000 });
r = await run('s = df.revenue');
await kAsync(page, `await exploreWith('import matplotlib.pyplot as plt\\ns.plot.hist(bins=30, title="s")');`);
assert.ok(await k(page, `JSON.stringify(cells.find(c=>/plot\\.hist/.test(c.source)).outputs).includes('image')`), 'histogram renders a figure');
await clearToasts();
await page.waitForFunction(() => window.__k('!busy'));
await kAsync(page, `await delVar('df'); await refreshInspector();`);
assert.equal(await k(page, `lastVars.includes('df')`), false);
await toastAct('Deleted df').click();
await page.waitForFunction(() => window.__k(`lastVars.includes('df')`));
r = await run('df.shape');
assert.match(JSON.stringify(r.out), /600, 9/, 'restored variable keeps its value');
await kAsync(page, `toggleRight(false);`);

// 7. files: drop anywhere to mount; clicking a data row previews it; removal can be undone
await page.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['a,b\n1,2\n'], 'dropped.csv', { type: 'text/csv' })); const s = document.querySelector('.sheet'); s.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: dt })); s.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); });
await page.waitForFunction(() => window.__k(`!!dataEntry('dropped.csv')`));
await kAsync(page, `toggleLeft(true); renderDataList();`);
await page.locator('#dataList .data-row', { hasText: 'dropped.csv' }).locator('.data-meta').click();
await page.waitForFunction(() => !!document.querySelector('#dataList .data-preview table'));
assert.ok(await k(page, `Math.round(document.querySelector('#dataList .data-name').getBoundingClientRect().width) > 100`), 'data names stay readable');
await clearToasts();
await kAsync(page, `await removeData('dropped.csv');`);
await toastAct('Removed dropped.csv').click();
await page.waitForFunction(() => window.__k(`!!dataEntry('dropped.csv')`));
await kAsync(page, `toggleLeft(false);`);

// 8. layout: the cell toolbar never covers code; on phones the composer's SEND stays above the tab bar
await kAsync(page, `selectCell(cells[1].id,'command'); cells[1].el.scrollIntoView({block:'center'});`);
await page.waitForTimeout(300);
assert.equal(await k(page, `(()=>{const c=cells[1],a=c.el.querySelector('.cell-tools').getBoundingClientRect(),b=c.preEl.getBoundingClientRect(),cs=getComputedStyle(c.preEl);const top=b.top+parseFloat(cs.paddingTop),bottom=b.bottom-parseFloat(cs.paddingBottom);return a.bottom<=top+1||a.top>=bottom-1})()`), true, 'cell toolbar clear of the code');
if (mobile) {
  await kAsync(page, `ui.agent=true; applyUI();`);
  await page.waitForTimeout(500);
  assert.ok(await k(page, `document.getElementById('agSend').getBoundingClientRect().bottom <= document.getElementById('mob-bar').getBoundingClientRect().top`), 'SEND above the tab bar');
  await kAsync(page, `ui.agent=false; applyUI();`);
}
// 9. example links open a curated run without running it, and never overwrite work in progress
const notebooks = (p) => k(p, `readLib().notebooks.length`);
const count9 = await notebooks(page), current9 = await k(page, `nbId`);
await kAsync(page, `await openExample('regex-engine');`);
assert.equal(await notebooks(page), count9 + 1, 'a notebook with work opens the example in a new notebook');
assert.equal(await k(page, `nbName`), 'regex-engine');
assert.ok(await k(page, `cells.length > 5 && cells.some((c) => (c.outputs || []).length)`), 'the original outputs are shown');
assert.ok(await k(page, `readLib().notebooks.some((n) => n.id === ${JSON.stringify(current9)})`), 'the previous notebook is kept');
await clearToasts();
await kAsync(page, `await openExample('../secrets');`);
assert.ok(await k(page, `[...document.querySelectorAll('.toast')].some((t) => /isn't valid/.test(t.textContent))`), 'only example names are accepted');
await kAsync(page, `await openExample('no-such-example');`);
assert.ok(await k(page, `[...document.querySelectorAll('.toast')].some((t) => /no example called/.test(t.textContent))`), 'a missing example says so');
// an agent run (or a cell still running) never lets an example replace the notebook it is working in
const guarded = await kAsync(page, `const before = nbId + cells.map((c) => c.id).join(); const books = readLib().notebooks.length; agRunning = true; try { await openExample('lunar-settlement'); } finally { agRunning = false; } return { same: nbId + cells.map((c) => c.id).join() === before, books: readLib().notebooks.length === books, told: [...document.querySelectorAll('.toast')].some((t) => /Finish or stop/.test(t.textContent)) }`);
assert.deepEqual(guarded, { same: true, books: true, told: true }, 'an active run blocks opening an example');
const midRun = await kAsync(page, `const before = nbId + cells.map((c) => c.id).join(); const realFetch = window.fetch; window.fetch = (...args) => new Promise((resolve) => setTimeout(() => { agRunning = true; resolve(realFetch(...args)); }, 50)); try { await openExample('lunar-settlement'); } finally { window.fetch = realFetch; agRunning = false; } return nbId + cells.map((c) => c.id).join() === before`);
assert.equal(midRun, true, 'a run that starts during the download also blocks the import');
assert.equal(await kAsync(page, `const id = nbId; agRunning = true; let made; try { made = await newNotebook(); } finally { agRunning = false; } return made === false && nbId === id`), true, 'newNotebook reports when it refuses');
const stillBusy = await kAsync(page, `const before = nbId + cells.map((c) => c.id).join(); const books = readLib().notebooks.length; exampleWaitMs = 300; busy = true; try { await openExample('lunar-settlement'); } finally { busy = false; exampleWaitMs = 180000; } return nbId + cells.map((c) => c.id).join() === before && readLib().notebooks.length === books`);
assert.equal(stillBusy, true, 'a kernel that stays busy (restart, running cell) blocks the import');
const pausedBlank = await kAsync(page, `await newNotebook(); const blankId = nbId, books = readLib().notebooks.length; agRun = { id: 'paused-run', status: 'paused' }; await openExample('lunar-settlement'); return { moved: nbId !== blankId, added: readLib().notebooks.length === books + 1, blankKept: readLib().notebooks.some((n) => n.id === blankId), opened: nbName === 'lunar-settlement' }`);
assert.deepEqual(pausedBlank, { moved: true, added: true, blankKept: true, opened: true }, 'a blank notebook with an unfinished run is left alone; the example opens in a new notebook');
await clearToasts();
const locked = await kAsync(page, `notebookSwitching = true; try { await agentTurn('hello'); } finally { notebookSwitching = false; } return { running: agRunning, told: [...document.querySelectorAll('.toast')].some((t) => /notebook switch/.test(t.textContent)) }`);
assert.deepEqual(locked, { running: false, told: true }, 'runs cannot start while notebooks switch');
const cellsLocked = await kAsync(page, `const c = insertCell(cells.length, 'code', false); c.source = 'switch_probe = 1'; c.taEl.value = c.source; const gen = kernelGeneration; notebookSwitching = true; let ran; try { ran = await runCell(c); await restartKernel(); } finally { notebookSwitching = false; } return { ran, exec: c.execCount, sameKernel: kernelGeneration === gen }`);
assert.deepEqual(cellsLocked, { ran: false, exec: null, sameKernel: true }, 'cells and restarts wait for a notebook switch too');
const claimed = await kAsync(page, `const c = insertCell(cells.length, 'code', false); c.source = 'claim_probe = 2'; c.taEl.value = c.source; const id = nbId; const realRefresh = refreshReferencedArtifacts; let switched; refreshReferencedArtifacts = async (...args) => { switched = await newNotebook(); return realRefresh(...args); }; let ran; try { ran = await runCell(c); } finally { refreshReferencedArtifacts = realRefresh; } return { switched, ran, sameNotebook: nbId === id }`);
assert.deepEqual(claimed, { switched: false, ran: true, sameNotebook: true }, 'a switch cannot start while a cell prepares its files');
const midSwitch = await kAsync(page, `await newNotebook(); const before = nbId + cells.map((c) => c.id).join(); exampleWaitMs = 300; notebookSwitching = true; try { await openExample('lunar-settlement'); } finally { notebookSwitching = false; exampleWaitMs = 180000; } return nbId + cells.map((c) => c.id).join() === before`);
assert.equal(midSwitch, true, 'an example never imports into a notebook that is still being switched to');
const raced = await kAsync(page, `const c = insertCell(cells.length, 'code', false); c.source = 'raced_probe = 3'; c.taEl.value = c.source; const realSave = saveWorkspaceState; let first = true; saveWorkspaceState = async (...args) => { if (first) { first = false; agRunning = true; } return realSave(...args); }; try { await openExample('regex-engine'); } finally { saveWorkspaceState = realSave; agRunning = false; } return { imported: nbName === 'regex-engine', blank: isBlankNotebook() }`);
assert.deepEqual(raced, { imported: false, blank: true }, 'a run that gets going during the switch stops the import');
const reset = await kAsync(page, `const c = insertCell(cells.length, 'code', false); c.source = 'stale_probe = 7'; c.taEl.value = c.source; await runCell(c); cells.slice().forEach((x) => deleteCell(x)); const id = nbId, blank = isBlankNotebook(); await openExample('lunar-settlement'); return { blank, reused: nbId === id, imported: nbName === 'lunar-settlement', stale: await runPy("'stale_probe' in _KNS") }`);
assert.deepEqual(reset, { blank: true, reused: true, imported: true, stale: false }, 'an example reusing a blank notebook starts from a clean Python namespace');
const typed = await kAsync(page, `await newNotebook(); const realIsolate = isolateNotebookRuntime; isolateNotebookRuntime = async (...args) => { cells[0].source = 'typed_meanwhile = 1'; cells[0].taEl.value = cells[0].source; return realIsolate(...args); }; try { await openExample('regex-engine'); } finally { isolateNotebookRuntime = realIsolate; } return { imported: nbName === 'regex-engine', kept: cells.length === 1 && cells[0].taEl.value === 'typed_meanwhile = 1' }`);
assert.deepEqual(typed, { imported: false, kept: true }, 'work added while Python resets is not replaced by the example');
await clearToasts();
await kAsync(page, `await openExample('fleet-dna')`);
assert.equal(await toastAct('needs public data').textContent(), 'Where to get them', 'an example that needs outside data says so and links to where to get it');
const fresh = await newContext(browser);
const linked = await openApp(fresh, file + '?example=lunar-settlement');
await linked.waitForFunction(() => window.__k(`nbName === 'lunar-settlement' && cells.length > 3`));
assert.equal(await notebooks(linked), 1, 'a blank browser opens the example in its empty notebook');
assert.equal(await linked.evaluate(() => location.search), '', 'the link parameter is removed after use');
await fresh.close();
// a linked example waits for startup to restore saved files, so a notebook with files but blank cells is never overwritten
const saved = await newContext(browser);
const first = await openApp(saved, file);
await kAsync(first, `await mountUploadedFiles([new File(['a,b\\n1,2\\n'], 'keep.csv', { type: 'text/csv' })], false); persist(); await saveWorkspaceState();`);
const savedId = await k(first, `nbId`);
await first.close();
const reopened = await openApp(saved, file + '?example=lunar-settlement');
await reopened.waitForFunction(() => window.__k(`nbName === 'lunar-settlement'`), null, { timeout: 60000 });
const kept = await kAsync(reopened, `const w = await kdbGet('workspaces', ${JSON.stringify(savedId)}); return { files: ((w && w.artifacts) || []).map((a) => a.name), moved: nbId !== ${JSON.stringify(savedId)} }`);
assert.deepEqual(kept, { files: ['keep.csv'], moved: true }, 'the saved notebook keeps its files and the example opens in a new notebook');
await saved.close();

console.log('UI E2E passed for', file);
await browser.close(); srv.close();
