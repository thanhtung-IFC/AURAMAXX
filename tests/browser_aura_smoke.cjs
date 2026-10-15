/* Exercise the actual Aura module and styles with deterministic provider fixtures. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.test-output');
fs.mkdirSync(output, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await fn()) return; await pause(70); }
  throw new Error('Timeout: ' + label);
}
function installMocks() {
  const original = window.fetch.bind(window);
  window.__aura = { mode: 'ok', consent: true, available: true, requests: [], conversations: [], messages: {} };
  document.cookie = 'auramaxx_csrf=fixture-token; path=/';
  window.fetch = async (url, options = {}) => {
    const pathname = new URL(url, location.origin).pathname;
    if (!pathname.startsWith('/api/')) return original(url, options);
    const state = window.__aura;
    const body = options.body ? JSON.parse(options.body) : {};
    state.requests.push({ pathname, body, csrf: new Headers(options.headers).get('X-CSRF-Token') });
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
    if (pathname.endsWith('/status')) return json({ available: state.available, status: state.available ? 'ready' : 'missing_api_key', message: 'Dịch vụ chưa sẵn sàng.' });
    if (pathname === '/api/auth/me') return json({ id: 'fixture-user' });
    if (pathname === '/api/consents') return json([{ purpose: 'ai_chat', granted: state.consent }]);
    if (pathname === '/api/aura/conversations') {
      if (options.method === 'POST') {
        const conversation = { id: crypto.randomUUID(), title: body.title, updated_at: new Date().toISOString() };
        state.conversations.unshift(conversation);
        state.messages[conversation.id] = [];
        return json(conversation, 201);
      }
      return json(state.conversations);
    }
    if (pathname.endsWith('/messages')) return json(state.messages[pathname.split('/')[4]] || []);
    if (pathname === '/api/aura/chat') {
      if (state.mode === 'http-error') return json({ detail: 'Hạn mức tạm thời. Hãy thử lại.' }, 429);
      if (state.mode === 'pending') return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true }));
      const answer = 'Xin chào! **Aura** cùng bạn.\n\n<img src=x onerror="window.injected=true">';
      const encoder = new TextEncoder();
      if (!body.conversation_id && state.mode !== 'interrupted') {
        const conversation = { id: crypto.randomUUID(), title: body.message, updated_at: new Date().toISOString() };
        state.conversations.unshift(conversation);
        state.messages[conversation.id] = [];
        body.conversation_id = conversation.id;
      }
      const data = 'data: ' + JSON.stringify({ type: 'delta', text: answer }) + '\r\n\r\n' + (state.mode === 'interrupted' ? '' : 'data: ' + JSON.stringify({ type: 'done', conversation_id: body.conversation_id }));
      if (state.mode !== 'interrupted') state.messages[body.conversation_id].push({ role: 'user', content: body.message }, { role: 'assistant', content: answer });
      const bytes = encoder.encode(data);
      // Deliberately split every UTF-8 code point and SSE boundary across chunks.
      return new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
    }
    return json({});
  };
}
let html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8')
  .replace('<script type="module" src="app.js"></script>', '<script>(' + installMocks.toString() + ')()</script><script type="module">import {initAuraAI} from "./js/pages/aura-ai.js"; import {initMobileUI} from "./js/mobile.js"; document.querySelectorAll("[data-page]").forEach(page=>page.hidden=page.dataset.page!=="aura-ai"); location.hash="aura-ai"; initMobileUI(); initAuraAI(); window.auraFixtureReady=true;</script>')
  .replace(/<link[^>]+href="https:[^>]+>/g, '');
const server = http.createServer((request, response) => {
  const relative = decodeURIComponent(new URL(request.url, 'http://local').pathname).replace(/^\/+/, '');
  if (!relative) { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); return; }
  const file = path.resolve(root, 'frontend', relative);
  if (!file.startsWith(path.join(root, 'frontend') + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'image/svg+xml');
  response.end(fs.readFileSync(file));
});
(async () => {
  let edge, ws;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const fixture = fs.mkdtempSync(path.join(output, 'aura-browser-'));
  try {
    edge = spawn(process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + fixture, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
    const debugFile = path.join(fixture, 'DevToolsActivePort');
    await until(() => fs.existsSync(debugFile), 'Edge startup');
    const port = fs.readFileSync(debugFile, 'utf8').split('\n')[0];
    const targets = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
    ws = new WebSocket(targets.find(item => item.type === 'page').webSocketDebuggerUrl);
    await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
    let serial = 0;
    const pending = new Map(), errors = [];
    ws.addEventListener('message', event => {
      const packet = JSON.parse(event.data);
      if (packet.method === 'Runtime.exceptionThrown' && !/extension:/.test(packet.params.exceptionDetails.url || '')) errors.push(packet.params.exceptionDetails);
      if (!packet.id) return;
      const task = pending.get(packet.id);
      if (!task) return;
      pending.delete(packet.id); clearTimeout(task.timer);
      packet.error ? task.reject(new Error(JSON.stringify(packet.error))) : task.resolve(packet.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++serial;
      pending.set(id, { resolve, reject, timer: setTimeout(() => reject(new Error(method + ' timed out')), 20000) });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const screenshot = async name => fs.writeFileSync(path.join(output, name), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    const ask = async text => {
      await evaluate(`document.querySelector('#chat-input').value=${JSON.stringify(text)};document.querySelector('#chat-form').requestSubmit()`);
      await until(() => evaluate(`document.querySelector('#chat-stop').hidden`), 'chat finished');
    };
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port });
    await until(() => evaluate(`window.auraFixtureReady && !document.querySelector('#chat-input').disabled`), 'Aura initialized');
    await screenshot('aura-ai-desktop.png');
    await click('[data-chat-suggestion]');
    assert.ok((await evaluate(`document.querySelector('#chat-input').value`)).length > 20);
    assert.equal(await evaluate(`__aura.requests.filter(item=>item.pathname.endsWith('/chat')).length`), 0, 'suggestion waits for send');
    await ask('Chăm sóc da?');
    assert.equal(await evaluate(`document.querySelectorAll('.chat-message-assistant strong').length`), 1, 'Markdown rendered');
    assert.equal(await evaluate(`!!window.injected || !!document.querySelector('#chat-body img')`), false, 'HTML escaped');
    assert.equal(await evaluate(`__aura.requests.find(item=>item.pathname.endsWith('/chat')).csrf`), 'fixture-token');
    assert.equal(await evaluate(`document.querySelector('#aura-status-label').textContent`), 'AI đã kết nối');
    await ask('Giải thích thêm');
    assert.equal(await evaluate(`document.querySelectorAll('.chat-message').length`), 4);
    await screenshot('aura-ai-conversation.png');
    await evaluate(`__aura.mode='http-error'`); await ask('Thử lại nhé');
    assert.equal(await evaluate(`document.querySelector('#chat-input').value`), 'Thử lại nhé');
    assert.equal(await evaluate(`document.querySelectorAll('.chat-message-error').length`), 1);
    await evaluate(`__aura.mode='ok'`); await click('.chat-message-error .chat-message-action');
    await until(() => evaluate(`document.querySelector('#chat-stop').hidden`), 'retry finished');
    assert.equal(await evaluate(`document.querySelectorAll('.chat-message-error').length`), 0);
    assert.equal(await evaluate(`document.querySelectorAll('.chat-message').length`), 6, 'retry removes failed turn');
    await evaluate(`__aura.mode='interrupted'`); await ask('Bị ngắt');
    assert.ok((await evaluate(`document.querySelector('.chat-message-error').textContent`)).includes('chưa được lưu'));
    await evaluate(`__aura.mode='pending';document.querySelector('#chat-input').value='Dừng';document.querySelector('#chat-form').requestSubmit();document.querySelector('#chat-form').requestSubmit()`);
    await until(() => evaluate(`!document.querySelector('#chat-stop').hidden`), 'pending');
    await click('#chat-stop');
    await until(() => evaluate(`document.querySelector('#chat-stop').hidden`), 'stop');
    assert.ok((await evaluate(`document.querySelector('.chat-message-error').textContent`)).includes('Đã dừng'));
    await evaluate(`document.querySelector('#chat-history-search').value='zzzz';document.querySelector('#chat-history-search').dispatchEvent(new Event('input'))`);
    assert.equal(await evaluate(`document.querySelectorAll('.chat-conversation-item').length`), 0);
    await evaluate(`document.querySelector('#chat-history-search').value='';document.querySelector('#chat-history-search').dispatchEvent(new Event('input'))`);
    assert.equal(await evaluate(`document.querySelectorAll('.chat-conversation-item').length`), 1);
    await click('.chat-conversation-item');
    await until(() => evaluate(`!document.querySelector('#chat-input').disabled`), 'history loaded');
    assert.equal(await evaluate(`document.querySelectorAll('.chat-message').length`), 6, 'saved history reopens');
    await evaluate(`__aura.mode='ok';document.querySelector('#toast-region').replaceChildren()`);
    await click('#chat-new');
    await until(() => evaluate(`!document.querySelector('#chat-input').disabled`), 'new conversation');
    assert.equal(await evaluate(`document.querySelector('#chat-connection-state').dataset.state`), 'ready');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate(`window.scrollTo(0,0)`); await pause(200);
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth + 1`), true, 'mobile overflow');
    await screenshot('aura-ai-mobile.png');
    await click('#chat-history-toggle');
    assert.equal(await evaluate(`document.querySelector('#chat-history-toggle').getAttribute('aria-expanded')`), 'true');
    await click('#chat-history-toggle');
    await evaluate(`document.querySelector('#chat-input').focus()`);
    // Emulate iOS: the layout viewport stays tall while only the visible area shrinks.
    await evaluate(`Object.defineProperty(visualViewport,'height',{configurable:true,value:460});visualViewport.dispatchEvent(new Event('resize'))`);
    await until(() => evaluate(`document.documentElement.dataset.mobileKeyboard==='true'`),'keyboard with unchanged layout viewport');
    await pause(200);
    assert.equal(await evaluate(`innerHeight===844 && document.querySelector('#chat-send').getBoundingClientRect().bottom<=visualViewport.height+visualViewport.offsetTop`),true,'send visible when only visual viewport shrinks');
    await evaluate(`delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'))`);
    await until(() => evaluate(`document.documentElement.dataset.mobileKeyboard==='false'`),'visual viewport restored');
    await send('Emulation.setDeviceMetricsOverride', { width:390, height:460, deviceScaleFactor:1, mobile:true });
    await until(() => evaluate(`document.documentElement.dataset.mobileKeyboard==='true'`),'keyboard reduces the visual viewport');
    await pause(200);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.mobile-nav')).display==='none' && getComputedStyle(document.querySelector('#chat-input')).fontSize==='16px'`),true,'keyboard frees navigation space and readable input');
    const composer=await evaluate(`(()=>{const r=document.querySelector('#chat-send').getBoundingClientRect();return{top:r.top,bottom:r.bottom,height:r.height,viewport:visualViewport.height};})()`);
    assert.ok(composer.top>=0 && composer.bottom<=composer.viewport && composer.height>=44,'send remains above keyboard: '+JSON.stringify(composer));
    await screenshot('aura-ai-mobile-keyboard.png');
    await evaluate(`document.querySelector('#chat-input').blur()`);
    await send('Emulation.setDeviceMetricsOverride', { width:320, height:667, deviceScaleFactor:1, mobile:true });
    await until(() => evaluate(`document.documentElement.dataset.mobileKeyboard==='false'`),'navigation returns after keyboard closes');
    assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1 && getComputedStyle(document.querySelector('.mobile-nav')).display==='grid'`),true,'small phone chat and restored navigation');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    await evaluate(`document.documentElement.dataset.theme='light'`); await pause(200);
    await screenshot('aura-ai-light.png');
    await evaluate(`__aura.available=false`); await click('#chat-reconnect');
    await until(() => evaluate(`document.querySelector('#aura-status-badge').dataset.state==='offline'`), 'unconfigured');
    assert.equal(await evaluate(`document.querySelector('#chat-input').disabled`), true);
    await evaluate(`__aura.available=true;__aura.consent=false;dispatchEvent(new CustomEvent('auramaxx:consent-changed',{detail:{purpose:'ai_chat',granted:false}}))`);
    await until(() => evaluate(`document.querySelector('#chat-access-notice').textContent.includes('đồng ý')`), 'consent revoked');
    assert.equal(await evaluate(`document.querySelectorAll('.chat-message').length`), 0, 'revocation clears visible messages');
    assert.deepEqual(errors, []);
    console.log('PASS: Aura desktop/mobile/light, SSE UTF-8/CRLF/EOF, Markdown/XSS, CSRF, history/search, retry, stop, service status and consent.');
  } finally { ws?.close(); edge?.kill(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
