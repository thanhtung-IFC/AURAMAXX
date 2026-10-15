/* Real browser checks for startup cost and page lifecycle, using disposable data. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.test-output');
fs.mkdirSync(output, { recursive: true });
const fixture = fs.mkdtempSync(path.join(output, 'performance-'));
const baseline = process.env.AUDIT_BASELINE === '1';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { const value = await fn(); if (value) return value; } catch {}
    await pause(100);
  }
  throw new Error('Timeout: ' + label);
}

(async () => {
  let server, edge, ws, log = '';
  const pending = new Map(), exceptions = [];
  try {
    const socket = net.createServer();
    await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
    const port = socket.address().port;
    await new Promise(resolve => socket.close(resolve));
    const base = 'http://127.0.0.1:' + port;
    server = spawn(path.join(root, '.venv/Scripts/python.exe'), ['-X', 'utf8', '-B', 'run_web.py'], {
      cwd: process.env.AUDIT_SOURCE_ROOT || root, windowsHide: true,
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1',
        FACE_DB_BACKEND: 'sqlite', AURAMAXX_DB_BACKEND: 'sqlite',
        FACE_DATABASE_PATH: path.join(fixture, 'faces.sqlite3'),
        AURAMAXX_DB_PATH: path.join(fixture, 'app.sqlite3'),
        AUTH_COOKIE_SECURE: 'false', AI_PROVIDER: 'none', AI_API_KEY: '' },
    });
    server.stdout.on('data', chunk => { log += chunk; });
    server.stderr.on('data', chunk => { log += chunk; });
    await until(async () => (await fetch(base + '/api/health')).ok, 'server startup');
    const profile = path.join(fixture, 'edge-profile');
    fs.mkdirSync(profile);
    edge = spawn(process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      ...(process.env.EDGE_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
      '--disable-extensions', '--disable-component-extensions-with-background-pages', '--disable-sync',
      '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank',
    ], { windowsHide: true, stdio: 'ignore' });
    const debugPort = await until(() => fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0], 'Edge startup');
    const targets = await (await fetch('http://127.0.0.1:' + debugPort + '/json')).json();
    ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    let serial = 0;
    ws.addEventListener('message', event => {
      const data = JSON.parse(event.data);
      if (data.method === 'Runtime.exceptionThrown' && !/^(chrome-extension|ms-browser-extension):/.test(data.params.exceptionDetails.url || '')) exceptions.push(data.params.exceptionDetails);
      const task = pending.get(data.id);
      if (!task) return;
      pending.delete(data.id);
      clearTimeout(task.timer);
      data.error ? task.reject(new Error(JSON.stringify(data.error))) : task.resolve(data.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++serial;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out')); }, 20000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      window.__requests = []; window.__pendingRequests = 0; window.__lastRequest = 0;
      const original = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const url = new URL(String(args[0]), location.href).pathname;
        if (!url.startsWith('/api/')) return original(...args);
        window.__requests.push(url); window.__pendingRequests++; window.__lastRequest = performance.now();
        try { return await original(...args); }
        finally { window.__pendingRequests--; window.__lastRequest = performance.now(); }
      };
    })();` });
    const settled = () => until(() => evaluate(`document.readyState === 'complete' && window.__pendingRequests === 0 && performance.now() - window.__lastRequest > 300`), 'requests settled');
    await send('Page.navigate', { url: base });
    await until(() => evaluate(`document.querySelector('#api-status')?.dataset.state === 'online'`), 'app connected');
    await settled();
    const snapshot = await evaluate(`(() => {
      const scripts = performance.getEntriesByType('resource').filter(e => e.name.startsWith(location.origin) && new URL(e.name).pathname.endsWith('.js'));
      return { scripts: scripts.map(e => new URL(e.name).pathname), scriptCount: scripts.length,
        decodedScriptBytes: scripts.reduce((sum, e) => sum + e.decodedBodySize, 0),
        encodedScriptBytes: scripts.reduce((sum, e) => sum + e.encodedBodySize, 0), requests: window.__requests };
    })()`);
    fs.writeFileSync(path.join(output, baseline ? 'performance-before.json' : 'performance-after.json'), JSON.stringify(snapshot, null, 2));
    console.log(JSON.stringify(snapshot, null, 2));
    if (baseline) return;
    for (const name of ['face-lab-native', 'landmarker', 'arena', 'health-hub', 'progress', 'aura-ai']) {
      assert.ok(!snapshot.scripts.some(script => script === '/js/pages/' + name + '.js' || script === '/js/face/' + name + '.js'), name + ' deferred on home');
    }
    assert.deepEqual(snapshot.requests.filter(url => /\/api\/(arena|aura|habits|vision\/faces)/.test(url)), [], 'inactive pages make no API requests');

    let pausedModule;
    ws.addEventListener('message', event => {
      const data = JSON.parse(event.data);
      if (data.method === 'Fetch.requestPaused') pausedModule = data.params.requestId;
    });
    const route = async name => {
      await evaluate(`location.hash=${JSON.stringify(name)}`);
      await until(() => evaluate(`!document.querySelector('[data-page="${name}"]').hidden && document.querySelector('[data-page="${name}"]').getAttribute('aria-busy') !== 'true'`), 'route ' + name);
      await settled();
    };
    // A slow download must not initialize a page the user has already left.
    await send('Fetch.enable', { patterns: [{ urlPattern: '*/js/pages/face-lab-native.js' }] });
    await evaluate(`location.hash='face-lab'`);
    await until(() => pausedModule, 'face module download paused');
    await route('home');
    await send('Fetch.continueRequest', { requestId: pausedModule });
    await send('Fetch.disable');
    await until(() => evaluate(`!document.querySelector('[data-page="face-lab"]').hasAttribute('aria-busy')`), 'stale module completed');
    assert.equal(await evaluate(`!!document.querySelector('#face-start-camera')`), false, 'inactive face page was not initialized');

    // Import failures expose a working reload action, keeping the current route.
    pausedModule = null;
    await send('Fetch.enable', { patterns: [{ urlPattern: '*/js/pages/progress.js' }] });
    await evaluate(`location.hash='progress'`);
    await until(() => pausedModule, 'progress module paused');
    await send('Fetch.failRequest', { requestId: pausedModule, errorReason: 'InternetDisconnected' });
    await until(() => evaluate(`!!document.querySelector('[data-page="progress"] .page-load-status button')`), 'import error offers reload');
    await send('Fetch.disable');
    await evaluate(`document.querySelector('[data-page="progress"] .page-load-status button').click()`);
    await until(() => evaluate(`location.hash === '#progress' && document.querySelector('#api-status')?.dataset.state === 'online' && !document.querySelector('.page-load-status')`), 'page recovers after reload');
    await settled();

    await route('health-hub');
    await route('progress');
    await route('face-lab');
    await until(() => evaluate(`!!document.querySelector('#face-start-camera')`), 'face controls');
    await route('arena');
    await until(() => evaluate(`!!document.querySelector('#arena-bot-list button')`), 'arena loaded');
    await evaluate(`location.hash='aura-ai'; window.dispatchEvent(new CustomEvent('auramaxx:ai-request',{detail:{message:'Explain my report',attach:false}}))`);
    await until(() => evaluate(`document.querySelector('#chat-input').value === 'Explain my report'`), 'prompt survives lazy loading');
    await settled();
    await route('home');
    await evaluate(`window.__requests = []; window.dispatchEvent(new CustomEvent('auramaxx:auth-changed'))`);
    await settled();
    assert.deepEqual(await evaluate(`window.__requests.filter(url => ['/api/arena','/api/aura','/api/habits','/api/vision/faces','/api/progress'].some(prefix => url.startsWith(prefix)))`), [], 'auth change clears hidden pages without fetching them');
    await route('arena');
    await evaluate(`window.__requests = []; location.hash='home'; location.hash='arena'`);
    await settled();
    const botsRequests = await evaluate(`window.__requests.filter(url => url === '/api/arena/bots').length`);
    assert.ok(botsRequests <= 1, 'repeated navigation does not duplicate arena initialization');

    // Simulate a server that finishes a request after its AbortSignal was fired.
    await route('home');
    await evaluate(`(() => {
      window.__progressReplies = [];
      window.__originalFetch = window.fetch;
      window.fetch = (url, options = {}) => new URL(url, location.href).pathname === '/api/progress/summary'
        ? new Promise(resolve => window.__progressReplies.push({resolve, signal: options.signal}))
        : window.__originalFetch(url, options);
      location.hash = 'progress';
    })()`);
    await until(() => evaluate(`window.__progressReplies.length === 1`), 'first progress request');
    await evaluate(`window.dispatchEvent(new CustomEvent('auramaxx:auth-changed'))`);
    await until(() => evaluate(`window.__progressReplies.length === 2`), 'new account progress request');
    assert.equal(await evaluate(`window.__progressReplies[0].signal.aborted`), true, 'old account request aborted');
    await evaluate(`(async () => {
      const reply = total => new Response(JSON.stringify({total_entries:total,categories:[],entries:[]}),{headers:{'Content-Type':'application/json'}});
      window.__progressReplies[1].resolve(reply(0));
      await new Promise(resolve => setTimeout(resolve, 20));
      window.__progressReplies[0].resolve(reply(99));
      await new Promise(resolve => setTimeout(resolve, 20));
    })()`);
    assert.equal(await evaluate(`!!document.querySelector('.progress-data-summary')`), false, 'late private response is discarded');
    await evaluate(`window.fetch = window.__originalFetch`);
    await route('home');

    // One write should trigger exactly one journal refresh.
    await evaluate(`(async () => {
      const {api} = await import('/js/api.js');
      await api.post('/api/auth/register',{email:'performance-' + Date.now() + '@example.test',password:'Performance test password 123',display_name:'Performance test'});
      await api.post('/api/consents',{purpose:'health_tracking',granted:true,policy_version:'v1'});
      window.dispatchEvent(new CustomEvent('auramaxx:auth-changed'));
    })()`);
    await route('health-hub');
    await evaluate(`window.__requests = []; document.querySelector('#habit-category').value='water'; document.querySelector('#habit-value').value='250'; document.querySelector('#habit-entry-form').requestSubmit()`);
    await until(() => evaluate(`document.querySelectorAll('.habit-record').length === 1`), 'habit saved');
    await settled();
    assert.equal(await evaluate(`window.__requests.filter(url => url === '/api/habits').length`), 2, 'one POST and one GET after saving');
    await evaluate(`window.__requests = []; document.querySelector('.habit-delete').click()`);
    await until(() => evaluate(`document.querySelectorAll('.habit-record').length === 0`), 'habit deleted');
    await settled();
    assert.equal(await evaluate(`window.__requests.filter(url => url === '/api/habits').length`), 1, 'one GET after deleting');
    assert.deepEqual(exceptions, [], 'no application exceptions');
    console.log('Browser performance smoke passed.');
    await send('Browser.close').catch(() => {});
  } catch (error) {
    fs.writeFileSync(path.join(fixture, 'server.log'), log);
    throw error;
  } finally {
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('Browser closed')); }
    ws?.close(); edge?.kill(); server?.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
