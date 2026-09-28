// Phone layout: a phone opening KERNEL·A lands on KERNEL·M, and the phone page fits the screen, keeps a one-row
// header, reaches every toolbar action from ⋯, and lines the code editor up with its highlighting.
import assert from 'node:assert/strict';
import { staticServer, launch, newContext, openApp, k, kAsync, PHONE } from './harness.mjs';
const srv = await staticServer(8765);
const { browser } = await launch();
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

// 1. KERNEL·A on a phone becomes KERNEL·M, with the link's parameters intact
const phone = await newContext(browser, [], PHONE);
const linked = await openApp(phone, 'kernel-agent.html?example=lunar-settlement');
assert.equal(await linked.evaluate(() => location.pathname.split('/').pop()), 'kernel-agent-mobile.html', 'a phone opening KERNEL·A gets the phone layout');
await linked.waitForFunction(() => window.__k(`nbName === 'lunar-settlement'`), null, { timeout: 60000 });
assert.ok(await fits(linked), 'the phone page never scrolls sideways');
assert.ok((await linked.evaluate(() => document.querySelector('.topbar').getBoundingClientRect().height)) <= 52, 'the phone header is one compact row');
assert.match(await linked.evaluate(() => document.querySelector('meta[name="viewport"]').content), /maximum-scale=1/, 'iOS keeps compact fields without zooming on focus');

// 2. ⋯ holds the toolbar's actions on a phone
await linked.click('#btnMore');
const items = await linked.evaluate(() => [...document.querySelectorAll('#moreMenu .menu-item')].filter((b) => b.offsetParent).map((b) => b.dataset.mi));
for (const mi of ['newNb', 'openNb', 'saveIpynb', 'saveZip', 'restart', 'clearOutputs']) assert.ok(items.includes(mi), `the ⋯ menu offers ${mi}`);
const routed = await kAsync(linked, `const realSave = downloadIpynb, realRestart = restartKernel; const hits = []; downloadIpynb = () => hits.push('save'); restartKernel = () => hits.push('restart'); try { document.querySelector('[data-mi="saveIpynb"]').click(); document.querySelector('#btnMore').click(); document.querySelector('[data-mi="restart"]').click(); } finally { downloadIpynb = realSave; restartKernel = realRestart; } return hits`);
assert.deepEqual(routed, ['save', 'restart'], 'the phone menu items run their actions');

// 3. compact code still lines up with its highlighting, and table buttons sit below the table
const c = await kAsync(linked, `const c = insertCell(cells.length, 'code', false); c.source = 'import pandas as pd\\npd.DataFrame({"a": range(3), "b": list("xyz")})'; c.taEl.value = c.source; await runCell(c); const ta = getComputedStyle(c.taEl), hl = getComputedStyle(c.el.querySelector('.hl')); const table = c.el.querySelector('.out table'), acts = c.el.querySelector('.out-acts'); return { font: [ta.fontSize, ta.lineHeight] + '' === [hl.fontSize, hl.lineHeight] + '', size: parseFloat(hl.fontSize), below: !!(table && acts) && acts.getBoundingClientRect().top >= table.getBoundingClientRect().bottom }`);
assert.deepEqual(c, { font: true, size: 12, below: true }, 'code is compact and aligned, and COPY/CSV never cover a table');
assert.ok(await fits(linked), 'a notebook with outputs still fits the screen');
const runTimes = await kAsync(linked, `for (const c of cells) if (c.timeEl) c.timeEl.textContent = '12.43 s'; return [...document.querySelectorAll('.cell .exec-time')].filter((t) => t.textContent).map((t) => { const r = document.createRange(); r.selectNodeContents(t); return r.getBoundingClientRect().left >= t.closest('.cell').getBoundingClientRect().left; })`);
assert.ok(runTimes.length && runTimes.every(Boolean), 'a long run time stays inside its cell');

// 4. sheets fit their contents
await k(linked, `window.__kaMobile.only('left')`);
await linked.waitForTimeout(450);
const sheet = await linked.evaluate(() => ({ h: document.querySelector('#leftPanel').getBoundingClientRect().height, vh: innerHeight }));
assert.ok(sheet.h < sheet.vh * 0.86, 'a short Files sheet is shorter than the screen');
await k(linked, `window.__kaMobile.closeAll()`);
await linked.waitForTimeout(400);

// 5. RUN ALL in the tab bar is lit while the run lasts, then goes back to normal
const runTab = '#mob-bar .mb-btn[data-k="run"]';
await linked.click(runTab);
assert.equal(await linked.evaluate((s) => document.querySelector(s).classList.contains('active'), runTab), true, 'RUN ALL lights up when tapped');
await linked.waitForFunction((s) => !document.querySelector(s).classList.contains('active'), runTab, { timeout: 60000 });
await phone.close();

// 6. ?layout=desktop keeps KERNEL·A on a phone, for the tab, and it still fits the screen
const kept = await newContext(browser, [], PHONE);
const desk = await openApp(kept, 'kernel-agent.html?layout=desktop');
assert.deepEqual(await desk.evaluate(() => [location.pathname.split('/').pop(), location.search, sessionStorage.getItem('kernel.layout')]), ['kernel-agent.html', '', 'desktop'], 'layout=desktop keeps this page and drops the parameter');
assert.ok(await fits(desk), 'the desktop layout fits a phone screen too');
await desk.reload();
await desk.waitForFunction('window.__k && window.__k("kernelReady")', null, { timeout: 240000 });
assert.equal(await desk.evaluate(() => location.pathname.split('/').pop()), 'kernel-agent.html', 'the choice lasts for the tab');
await kept.close();

console.log('Phone layout E2E passed');
await browser.close(); srv.close();
