// Browser end-to-end harness: serves docs/, fulfills CDN requests from Node (TLS-verified, disk-cached), and exposes
// the app closure to tests through a direct-eval hook injected only by this test server.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = process.env.KERNEL_DOCS || new URL('../../docs/', import.meta.url).pathname;
const CACHE = new URL('./.netcache/', import.meta.url).pathname;
fs.mkdirSync(CACHE, { recursive: true });

export function staticServer(port = 8765, extraHeaders = {}) {
  const srv = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    const type = p.endsWith('.html') ? 'text/html' : p.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, ...extraHeaders });
    if (p.endsWith('.html')) {
      // Test-only: expose the app closure through a direct-eval hook injected at the end of the main IIFE.
      let html = fs.readFileSync(p, 'utf8');
      const at = html.search(/\(function init\(\)\s*\{/);
      const end = at < 0 ? -1 : html.indexOf('\n})();\n</script>', html.indexOf('})();', at) + 5);
      if (end > 0) html = html.slice(0, end) + '\nwindow.__k=function(s){return eval(s)};' + html.slice(end);
      return res.end(html);
    }
    fs.createReadStream(p).pipe(res);
  });
  return new Promise(r => srv.listen(port, () => r(srv)));
}

async function passthrough(route) {
  const req = route.request();
  const url = req.url();
  if (req.method() !== 'GET') return route.continue();
  const key = crypto.createHash('sha1').update(url).digest('hex');
  const bodyFile = path.join(CACHE, key + '.bin'), metaFile = path.join(CACHE, key + '.json');
  if (fs.existsSync(metaFile)) {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    return route.fulfill({ status: meta.status, headers: meta.headers, body: fs.readFileSync(bodyFile) });
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url, { redirect: 'follow' });
      const body = Buffer.from(await r.arrayBuffer());
      const headers = { 'content-type': r.headers.get('content-type') || 'application/octet-stream', 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin' };
      if (r.ok) { fs.writeFileSync(bodyFile, body); fs.writeFileSync(metaFile, JSON.stringify({ status: r.status, headers })); }
      return route.fulfill({ status: r.status, headers, body });
    } catch (e) { if (attempt === 3) return route.abort(); await new Promise(r => setTimeout(r, 1000 * 2 ** attempt)); }
  }
}

export async function launch({ mocks = [] } = {}) {
  const browser = await chromium.launch();
  // The PWA service worker's own network fetches bypass Playwright routing (and this sandbox's TLS proxy), so tests block it.
  const context = await browser.newContext({ serviceWorkers: 'block' });
  for (const [pattern, handler] of mocks) await context.route(pattern, handler);
  await context.route(/^https:\/\/(cdn\.jsdelivr\.net|pypi\.org|files\.pythonhosted\.org|fonts\.googleapis\.com|fonts\.gstatic\.com)\//, passthrough);
  return { browser, context };
}

export async function openApp(context, file = 'kernel-agent.html', { port = 8765, log = true, init = null } = {}) {
  const page = await context.newPage();
  if (init) await page.addInitScript(init);
  page.on('pageerror', e => log && console.log('  pageerror:', e.message.slice(0, 300)));
  page.on('console', m => { if (log && m.type() === 'error' && !/favicon|404/.test(m.text())) console.log('  console.error:', m.text().slice(0, 300)); });
  await page.goto(`http://localhost:${port}/${file}`);
  await page.waitForFunction('window.__k && window.__k("kernelReady")', null, { timeout: 240000 });
  return page;
}

export const k = (page, expr) => page.evaluate(expr => window.__k(expr), expr);
export const kAsync = (page, body) => page.evaluate(body => window.__k('(async()=>{' + body + '})()'), body);
