import assert from 'node:assert/strict';
import { staticServer, launch, openApp, k, kAsync } from './harness.mjs';
import { startMock, anthropicStream, responsesStream } from './mock-provider.mjs';
const srv = await staticServer();
const mock = await startMock();
const { browser, context } = await launch();
const page = await openApp(context, process.argv[2] || 'kernel-agent.html');
const lastUserBlocks = (body) => body.messages[body.messages.length - 1].content;
const toolResultText = (body) => lastUserBlocks(body).filter(b => b.type === 'tool_result').flatMap(tr => tr.content.map(x => x.text || '')).join('\n');
const setup = (provider, model) => kAsync(page, `agApplyProvider('${provider}');agKey='test-key';agBase='http://localhost:8766'+('${provider}'==='anthropic'?'':'/v1');agModel='${model}';agAutonomy='auto';agStateUi();`);

// ---------- 1. Anthropic Opus 5.5: thinking + add_cells run:true + finish_run
await setup('anthropic', 'claude-opus-5-5');
let cellId = null;
mock.state.queue.push(
  () => ({ sse: anthropicStream({ usage: { input_tokens: 9000, cache_creation_input_tokens: 7000 }, blocks: [
    { type: 'thinking', thinking: 'Plan: add a cell and run it.', signature: 'sigA' },
    { type: 'tool_use', id: 'tu1', name: 'add_cells', input: { run: true, cells: [{ type: 'markdown', source: '## Compute' }, { type: 'code', source: 'x = 21*2\nprint(x)' }] } }] }) }),
  (body) => { const r = toolResultText(body); cellId = JSON.parse(r.split('\n')[0]).added[1].cell_id; return { sse: anthropicStream({ usage: { input_tokens: 300, cache_read_input_tokens: 9500 }, blocks: [
    { type: 'thinking', thinking: '', signature: 'sigB' },
    { type: 'tool_use', id: 'tu2', name: 'finish_run', input: { summary: 'Computed 42', evidence: [{ kind: 'cell', id: cellId, claim: 'prints 42' }] } }] }) }; },
  () => ({ sse: anthropicStream({ usage: { input_tokens: 200, cache_read_input_tokens: 9900 }, blocks: [{ type: 'text', text: 'Done: x is 42.' }] }) }),
);
await kAsync(page, `await agentTurn('compute 21*2');`);
let st = await k(page, `({status:agRun.status,tools:agRun.toolCalls,models:agRun.modelCalls,out:JSON.stringify(cells.map(c=>c.outputs)),eff:runTokens(agRun),raw:agUseIn+agUseOut,cr:agUseCr})`);
console.log('run1', JSON.stringify(st).slice(0, 300));
assert.equal(st.status, 'completed'); assert.equal(st.tools, 2, 'add+run and finish in 2 tool calls'); assert.equal(st.models, 3);
assert.ok(st.out.includes('42'));
assert.equal(st.eff, Math.round(st.raw - 0.9 * st.cr), 'cache reads count 10% in the effective budget');
const reqs = mock.state.requests.slice(-3);
const [r1, r2, r3] = reqs.map(r => r.body);
// system is frozen and cached; tools unchanged
assert.deepEqual(r1.system, r2.system, 'system prompt is byte-stable across the tool loop');
assert.deepEqual(r2.system, r3.system);
assert.ok(r1.system[0].cache_control, 'DOCS block carries a cache breakpoint');
assert.deepEqual(r1.tools, r2.tools); assert.ok(r1.tools.every(t => t.eager_input_streaming === true));
assert.deepEqual(r1.thinking, { type: 'adaptive', display: 'summarized', block_binding: { prefix_mismatch_behavior: 'drop_block' } });
assert.deepEqual(r1.output_config, { effort: 'medium' }); assert.equal(r1.fallbacks, 'default'); assert.equal(r1.max_tokens, 64000);
assert.equal(reqs[0].headers['anthropic-beta'], 'thinking-binding-controls-2026-08-01,server-side-fallback-2026-07-01');
// prefix stability: request 2's messages[0..] equal request 3's except cache_control marks and the new tail
const strip = (x) => JSON.parse(JSON.stringify(x, (k, v) => k === 'cache_control' ? undefined : v));
assert.deepEqual(strip(r3.messages.slice(0, r2.messages.length)), strip(r2.messages), 'earlier turns are byte-identical (append-only)');
assert.ok(JSON.stringify(r1.messages[0]).includes('<kernel_state>'), 'state block is stamped on the newest user message');
assert.ok(!JSON.stringify(r1.system).includes('Live notebook outline'), 'no volatile state in system');
// thinking replay unchanged
assert.deepEqual(r2.messages[1].content[0], { type: 'thinking', thinking: 'Plan: add a cell and run it.', signature: 'sigA' });
// cache breakpoints on the last two user messages
const marks = r3.messages.map((m, i) => m.content.some(b => b.cache_control) ? i : -1).filter(i => i >= 0);
assert.deepEqual(marks, [r3.messages.length - 3, r3.messages.length - 1]);
// the add_cells result carries outputs in the same call
assert.ok(toolResultText(r2).includes('stdout: 42'), 'add_cells run:true returns outputs');
const tx = await k(page, `txEntries().map(e=>e.k).join(',')`);
console.log('transcript kinds', tx);
assert.ok(tx.includes('p'), 'short thinking renders as a progress line');

// ---------- 2. retries: 529 then stream error then success; max_tokens escalation
await kAsync(page, `agRun=null;`);
mock.state.queue.push(
  { status: 529, headers: { 'retry-after': '1' }, json: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } },
  () => ({ sse: anthropicStream({ blocks: [{ type: 'text', text: 'partial' }], errorEvent: { type: 'overloaded_error', message: 'Overloaded' } }) }),
  () => ({ sse: anthropicStream({ blocks: [{ type: 'text', text: 'cut off' }], stop_reason: 'max_tokens' }) }),
  (body) => ({ sse: anthropicStream({ blocks: [{ type: 'text', text: 'Recovered answer with max_tokens=' + body.max_tokens }] }) }),
);
const before = mock.state.requests.length;
await kAsync(page, `await agentTurn('just say hi');`);
st = await k(page, `({status:agRun.status,retries:agRun.modelRetries,override:agRun.maxOutOverride,events:agRun.events.map(e=>e.type).join(',')})`);
console.log('run2', JSON.stringify(st));
assert.equal(st.status, 'completed'); assert.equal(st.retries, 2); assert.equal(st.override, 128000);
assert.equal(mock.state.requests.length - before, 4);
assert.equal(mock.state.requests.at(-1).body.max_tokens, 128000);
const txt = await k(page, `txEntries().filter(e=>e.k==='a').map(e=>e.t).join('|')`);
assert.ok(txt.includes('Recovered answer') && !txt.includes('partial') && !txt.includes('cut off'), 'only authoritative output is durable');

// ---------- 3. refusal with server fallback + invalid tool JSON guard
await kAsync(page, `agRun=null;`);
mock.state.queue.push(
  () => ({ sse: anthropicStream({ blocks: [{ type: 'thinking', thinking: 'x', signature: 's1' }, { type: 'tool_use', id: 'tu_bad', name: 'delete_cell', input: { cell_id: 'nope' } }, { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-5' } }, { type: 'text', text: 'Fallback answered.' }] }) }),
);
await kAsync(page, `await agentTurn('fallback case');`);
st = await k(page, `({status:agRun.status,last:JSON.stringify(agMsgs[agMsgs.length-1])})`);
console.log('run3', st.status, st.last.slice(0, 200));
assert.equal(st.status, 'completed'); assert.ok(!st.last.includes('tool_use') && !st.last.includes('thinking'), 'pre-fallback tool_use/thinking are dropped');

// ---------- 4. OpenAI: prompt_cache_key, instructions stable, add_cells run
await kAsync(page, `agRun=null;`);
await setup('openai', 'gpt-5.6');
let cid2 = null;
mock.state.queue.push(
  () => ({ sse: responsesStream({ items: [{ type: 'reasoning', summary: 'thinking', encrypted: 'e1' }, { type: 'function_call', call_id: 'c1', name: 'add_cells', arguments: { run: true, cells: [{ type: 'code', source: 'y=5\ny*3' }] } }] }) }),
  (body) => { const out = body.input.find(i => i.type === 'function_call_output'); cid2 = JSON.parse(String(out.output).split('\n')[0]).added[0].cell_id; return { sse: responsesStream({ usage: { input_tokens: 20000, input_tokens_details: { cached_tokens: 18000 } }, items: [{ type: 'function_call', call_id: 'c2', name: 'finish_run', arguments: { summary: 'y*3=15', evidence: [{ kind: 'cell', id: cid2, claim: '15' }] } }] }) }; },
  () => ({ sse: responsesStream({ items: [{ type: 'message', text: 'Result 15.' }] }) }),
);
const b4 = mock.state.requests.length;
await kAsync(page, `await agentTurn('compute y*3');`);
st = await k(page, `({status:agRun.status})`);
const oreq = mock.state.requests.slice(b4).map(r => r.body);
console.log('run4', st.status, oreq.map(r => [r.prompt_cache_key, r.max_output_tokens, r.instructions.length]));
assert.equal(st.status, 'completed');
assert.ok(oreq[0].prompt_cache_key && oreq.every(r => r.prompt_cache_key === oreq[0].prompt_cache_key));
assert.ok(oreq.every(r => r.instructions === oreq[0].instructions), 'instructions are byte-stable');
assert.deepEqual(oreq[2].input.slice(0, oreq[1].input.length), oreq[1].input, 'Responses input is append-only');
// ---------- 5. one-time config migration: the old Sonnet 4.6 / 8192-token defaults move to Opus 5.5 / 64K; explicit choices stay
const migrated = await openApp(context, process.argv[2] || 'kernel-agent.html', { init: () => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('kernel.agent.provider.v2', 'anthropic'); localStorage.setItem('kernel.agent.providers.v2', JSON.stringify({ anthropic: { key: 'k', model: 'claude-sonnet-4-6', maxOut: 8192, reasoning: 'off' }, openai: { key: 'o', model: 'gpt-5.6', maxOut: 20000 } })); } } });
const cfg = await k(migrated, `(agApplyProvider('anthropic'),{model:agModel,out:agMaxOut,effort:agReasoning,openaiOut:agConfigs.openai.maxOut,rev:agConfigs.anthropic.rev})`);
console.log('migrated config', JSON.stringify(cfg));
assert.deepEqual(cfg, { model: 'claude-opus-5-5', out: 64000, effort: 'medium', openaiOut: 20000, rev: 4 });
await migrated.close();
console.log('agent-loop E2E passed for', process.argv[2] || 'kernel-agent.html');
await browser.close(); srv.close(); mock.close();
