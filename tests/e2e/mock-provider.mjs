// Scriptable mock for Anthropic Messages + OpenAI/xAI Responses streaming APIs.
import http from 'node:http';

export function sse(events) { return events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''); }

// blocks: {type:'text',text} | {type:'tool_use',id,name,input} | {type:'thinking',thinking,signature} | {type:'redacted_thinking',data} | {type:'fallback',from,to}
export function anthropicStream({ blocks = [], stop_reason, usage = {}, model = 'claude-opus-5-5', truncate = false, errorEvent = null } = {}) {
  const u = { input_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...usage };
  const ev = [{ type: 'message_start', message: { id: 'msg_' + Math.random().toString(36).slice(2), type: 'message', role: 'assistant', model, content: [], usage: { input_tokens: u.input_tokens, cache_read_input_tokens: u.cache_read_input_tokens, cache_creation_input_tokens: u.cache_creation_input_tokens, output_tokens: 1 } } }];
  blocks.forEach((b, index) => {
    if (b.type === 'text') { ev.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } }); for (const part of b.text.match(/[\s\S]{1,20}/g) || ['']) ev.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: part } }); }
    else if (b.type === 'tool_use') { ev.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } }); const j = JSON.stringify(b.input); for (const part of j.match(/[\s\S]{1,30}/g) || []) ev.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: part } }); }
    else if (b.type === 'thinking') { ev.push({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } }); if (b.thinking) ev.push({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: b.thinking } }); ev.push({ type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: b.signature || 'sig_' + index } }); }
    else if (b.type === 'redacted_thinking') ev.push({ type: 'content_block_start', index, content_block: { type: 'redacted_thinking', data: b.data } });
    else if (b.type === 'fallback') ev.push({ type: 'content_block_start', index, content_block: { type: 'fallback', from: b.from, to: b.to } });
    ev.push({ type: 'content_block_stop', index });
  });
  if (errorEvent) { ev.push({ type: 'error', error: errorEvent }); return sse(ev); }
  const stop = stop_reason || (blocks.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn');
  ev.push({ type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: usage.output_tokens || 50 } });
  if (!truncate) ev.push({ type: 'message_stop' });
  return sse(ev);
}

// items: {type:'message',text} | {type:'function_call',call_id,name,arguments} | {type:'reasoning',summary,encrypted}
export function responsesStream({ items = [], usage = {}, status = 'completed', incomplete_reason } = {}) {
  const output = [], ev = [];
  for (const it of items) {
    if (it.type === 'message') { for (const part of it.text.match(/[\s\S]{1,20}/g) || ['']) ev.push({ type: 'response.output_text.delta', delta: part }); output.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: it.text }] }); }
    else if (it.type === 'function_call') output.push({ type: 'function_call', id: 'fc_' + it.call_id, call_id: it.call_id, name: it.name, arguments: typeof it.arguments === 'string' ? it.arguments : JSON.stringify(it.arguments) });
    else if (it.type === 'reasoning') { output.push({ type: 'reasoning', id: 'rs_' + Math.random().toString(36).slice(2), summary: it.summary ? [{ type: 'summary_text', text: it.summary }] : [], encrypted_content: it.encrypted || 'enc' }); if (it.summary) ev.push({ type: 'response.reasoning_summary_text.delta', delta: it.summary }); }
  }
  const u = { input_tokens: 1000, output_tokens: 50, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 }, ...usage };
  const response = { id: 'resp_x', status, output, usage: u, incomplete_details: status === 'incomplete' ? { reason: incomplete_reason || 'max_output_tokens' } : null };
  ev.push({ type: status === 'incomplete' ? 'response.incomplete' : 'response.completed', response });
  return sse(ev);
}

export function startMock(port = 8766) {
  const state = { requests: [], queue: [], models: [] };
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-expose-headers': '*' };
  const srv = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    let body = ''; for await (const c of req) body += c;
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && /\/models$/.test(url.pathname)) { res.writeHead(200, { ...cors, 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: state.models, has_more: false })); }
    let parsed = null; try { parsed = JSON.parse(body); } catch (e) {}
    state.requests.push({ path: url.pathname, headers: req.headers, body: parsed, at: Date.now() });
    let next = state.queue.shift();
    if (typeof next === 'function') next = await next(parsed, state.requests.length - 1, req.headers);
    if (!next) { res.writeHead(500, { ...cors, 'content-type': 'application/json' }); return res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'mock queue empty' } })); }
    if (next.delayMs) await new Promise(r => setTimeout(r, next.delayMs));
    if (next.status && next.status !== 200) { res.writeHead(next.status, { ...cors, 'content-type': 'application/json', ...(next.headers || {}) }); return res.end(JSON.stringify(next.json || { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })); }
    res.writeHead(200, { ...cors, 'content-type': 'text/event-stream', ...(next.headers || {}) });
    if (next.dropAfterBytes) { res.write(next.sse.slice(0, next.dropAfterBytes)); return res.destroy(); }
    res.end(next.sse);
  });
  return new Promise(r => srv.listen(port, () => r({ srv, state, close: () => srv.close() })));
}
