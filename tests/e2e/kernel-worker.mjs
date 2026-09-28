import assert from 'node:assert/strict';
import fs from 'node:fs';
import { staticServer, launch, openApp, k, kAsync } from './harness.mjs';
import { startMock, anthropicStream } from './mock-provider.mjs';
const srv = await staticServer(8765);
const isoSrv = await staticServer(8767, { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' });
const mock = await startMock();
const { browser, context } = await launch();
const file = process.argv[2] || 'kernel-agent.html';
const page = await openApp(context, file);
const run = (src) => kAsync(page, `const c=insertCell(cells.length,'code',false);c.source=${JSON.stringify(src)};if(c.taEl)c.taEl.value=c.source;await runCell(c);return {id:c.id,out:c.outputs,exec:c.execCount};`);

// 1. worker mode + files + responsiveness + hard interrupt with remount
assert.match(await k(page, `$('#kernelInfo').textContent`), /worker/);
await kAsync(page, `await mountUploadedFiles([new File(['a,b\\n1,2\\n'],'data.csv',{type:'text/csv'})],false);`);
let r = await run(`x = 7\nprint(open('data.csv').read().strip())`);
assert.ok(JSON.stringify(r.out).includes('1,2'));
await k(page, `(window.__loop=(async()=>{const c=insertCell(cells.length,'code',false);c.source='while True:\\n    pass';if(c.taEl)c.taEl.value=c.source;await runCell(c);return c.outputs})(),1)`);
await page.waitForTimeout(1500);
const t0 = Date.now(); const alive = await k(page, `busy && !document.getElementById('btnInterrupt').hidden`); const lag = Date.now() - t0;
console.log('busy during loop, interrupt visible:', alive, 'page responded in', lag, 'ms');
assert.equal(alive, true); assert.ok(lag < 1000, 'page stays responsive while Python loops');
await kAsync(page, `await interruptKernel('human');`);
const loopOut = await page.evaluate(() => window.__loop);
console.log('interrupted cell output:', JSON.stringify(loopOut).slice(0, 160));
assert.match(JSON.stringify(loopOut), /KernelRestart/);
await page.waitForFunction(() => window.__k('kernelReady && !busy'));
r = await run(`print(open('data.csv').read().strip()); print('x' in globals())`);
console.log('after restart:', JSON.stringify(r.out));
assert.ok(JSON.stringify(r.out).includes('1,2') && JSON.stringify(r.out).includes('False'), 'artifacts remounted, namespace cleared');
assert.equal(await k(page, `kernelGeneration>0 && cells.slice(0,-1).every(c=>c.execCount==null)`), true);

// 2. agent cell time limit interrupts an agent-run cell; the agent learns about it and continues
await kAsync(page, `agApplyProvider('anthropic');agKey='k';agBase='http://localhost:8766';agModel='claude-opus-5-5';agCellMinutes=0.03;agRun=null;`);
mock.state.queue.push(
  () => ({ sse: anthropicStream({ blocks: [{ type: 'tool_use', id: 't1', name: 'add_cells', input: { run: true, cells: [{ type: 'code', source: 'while True:\n    pass' }] } }] }) }),
  (body) => { const tr = body.messages.at(-1).content.find(b => b.type === 'tool_result'); globalThis.__timeoutResult = tr.content.map(x => x.text).join('\n'); return { sse: anthropicStream({ blocks: [{ type: 'text', text: 'The loop was stopped by the time limit.' }] }) }; },
  () => ({ sse: anthropicStream({ blocks: [{ type: 'text', text: 'Stopping here.' }] }) }),
  () => ({ sse: anthropicStream({ blocks: [{ type: 'text', text: 'Stopping here.' }] }) }),
);
await kAsync(page, `await agentTurn('run an infinite loop');`);
console.log('agent saw:', (globalThis.__timeoutResult || '').slice(0, 200).replace(/\n/g, ' | '));
assert.match(globalThis.__timeoutResult, /KernelRestart: KERNEL restarted Python because the agent cell time limit/);
await page.waitForFunction(() => window.__k('kernelReady && !busy'));

// 3. blob store: checkpoints reference one blob; ZIP writes it once and round-trips
await kAsync(page, `await mountUploadedFiles([new File([new Uint8Array(300000).fill(7)],'big.bin')],false);await saveWorkspaceState();`);
for (let i = 0; i < 3; i++) await kAsync(page, `await createCheckpoint('cp${i}','manual',null);`);
const store = await kAsync(page, `const cps=await kdbCheckpoints(nbId);const blobs=(await kdbBlobAges()).map(b=>b.hash);return {cps:cps.length,inline:cps.some(cp=>(cp.workspace.artifacts||[]).some(a=>a.bytes)),refs:[...new Set(cps.flatMap(cp=>cp.workspace.artifacts.map(a=>a.blob)))].length,blobs:blobs.length}`);
console.log('store:', JSON.stringify(store));
assert.equal(store.inline, false, 'checkpoints hold blob references, not bytes');
assert.ok(store.refs <= 2 && store.blobs >= 2);
const [download] = await Promise.all([page.waitForEvent('download'), kAsync(page, `await downloadWorkspaceZip();`)]);
const zipPath = await download.path(); const zipBytes = fs.readFileSync(zipPath);
console.log('full ZIP bytes:', zipBytes.length);
assert.ok(zipBytes.length < 300000 * 2, 'each unique payload is written once despite several checkpoints');
const restored = await kAsync(page, `const f=new File([new Uint8Array(${JSON.stringify([...zipBytes])})],'w.kernel.zip');await importWorkspaceZip(f);const cps=await kdbCheckpoints(nbId);const big=dataFiles.find(d=>d.name==='big.bin');return {n:cps.length,size:big&&big.bytes.byteLength,ok:big&&big.bytes.every(b=>b===7),inline:cps.some(cp=>(cp.workspace.artifacts||[]).some(a=>a.bytes))}`);
console.log('imported:', JSON.stringify(restored));
assert.equal(restored.size, 300000); assert.equal(restored.ok, true); assert.equal(restored.inline, false); assert.ok(restored.n >= 3);
const fork = await kAsync(page, `const cps=(await kdbCheckpoints(nbId)).sort((a,b)=>a.created-b.created);await restoreCheckpoint(cps[cps.length-1].id,true);await new Promise(r=>setTimeout(r,500));const big=dataFiles.find(d=>d.name==='big.bin');return big&&big.bytes.byteLength`);
assert.equal(fork, 300000, 'forking from an imported checkpoint restores its artifact bytes');

// 3b. overwriting an artifact through the agent tool stores the new content, not the old hash
const over = await kAsync(page, `const t1=await execTool({id:'s1',name:'save_data_file',input:{filename:'note.txt',content:'first'}});await saveWorkspaceState();const t2=await execTool({id:'s2',name:'save_data_file',input:{filename:'note.txt',content:'second version'}});const ws=await saveWorkspaceState();const f=ws.artifacts.find(a=>a.path==='note.txt');return new TextDecoder().decode(await blobGet(f.blob))`);
assert.equal(over, 'second version', 'an overwritten artifact persists its new bytes');
// 4. legacy inline-byte checkpoints migrate to blob references; quota fallback reads stay consistent
const legacy = await kAsync(page, `await kdbPut('checkpoints',{id:'cp_legacy',notebookId:nbId,threadId:agThreadId,threadKey:nbId+':'+agThreadId,created:Date.now(),label:'legacy',cells:[],workspace:{artifacts:[{id:'f_legacy',path:'old.txt',name:'old.txt',size:3,bytes:new Uint8Array([1,2,3])}]}});const res=await gcBlobs();const cp=await kdbGet('checkpoints','cp_legacy');return {res,blob:cp.workspace.artifacts[0].blob,inline:!!cp.workspace.artifacts[0].bytes,back:[...(await blobGet(cp.workspace.artifacts[0].blob))]}`);
console.log('legacy migration:', JSON.stringify(legacy));
assert.equal(legacy.inline, false); assert.deepEqual(legacy.back, [1, 2, 3]);
const quota = await kAsync(page, `const real=kdbRequest;kdbRequest=async(store,mode,fn)=>{if(mode==='readwrite'&&store==='runs'){const e=new Error('quota');e.name='QuotaExceededError';throw e}return real(store,mode,fn)};await kdbPut('runs',{id:'r_q',notebookId:nbId,threadKey:'x',v:1});await kdbPut('runs',{id:'r_q',notebookId:nbId,threadKey:'x',v:2});const got=await kdbGet('runs','r_q');const listed=(await kdbRuns(nbId)).find(r=>r.id==='r_q');kdbRequest=real;return {got:got.v,listed:listed&&listed.v}`);
assert.deepEqual(quota, { got: 2, listed: 2 }, 'a failed write is served from memory, not a stale IndexedDB copy');

// 5. soft interrupt under cross-origin isolation keeps the namespace
const iso = await openApp(context, file, { port: 8767 });
assert.match(await k(iso, `$('#kernelInfo').textContent`), /interruptible/);
await kAsync(iso, `const c=insertCell(cells.length,'code',false);c.source='keep = 41';c.taEl&&(c.taEl.value=c.source);await runCell(c);`);
await k(iso, `(window.__loop=(async()=>{const c=insertCell(cells.length,'code',false);c.source='i=0\\nwhile True:\\n    i+=1';if(c.taEl)c.taEl.value=c.source;await runCell(c);return c.outputs})(),1)`);
await iso.waitForTimeout(1200);
await kAsync(iso, `await interruptKernel('human');`);
const softOut = await iso.evaluate(() => window.__loop);
console.log('soft interrupt output:', JSON.stringify(softOut).slice(0, 200));
assert.match(JSON.stringify(softOut), /KeyboardInterrupt/);
const kept = await kAsync(iso, `const c=insertCell(cells.length,'code',false);c.source='keep + 1';c.taEl&&(c.taEl.value=c.source);await runCell(c);return c.outputs`);
assert.match(JSON.stringify(kept), /42/, 'soft interrupt preserves variables');
await iso.close();

// 6. page-thread fallback still runs cells
const inl = await openApp(context, file, { init: () => localStorage.setItem('kernel.runtime', 'inline') });
assert.match(await k(inl, `$('#kernelInfo').textContent`), /page thread/);
const inlOut = await kAsync(inl, `const c=insertCell(cells.length,'code',false);c.source='6*7';c.taEl&&(c.taEl.value=c.source);await runCell(c);return c.outputs`);
assert.match(JSON.stringify(inlOut), /42/);
await inl.evaluate(() => localStorage.removeItem('kernel.runtime'));
console.log('kernel-worker E2E passed for', file);
await browser.close(); srv.close(); isoSrv.close(); mock.close();
