/* Exercise the merged UI in headless Edge using disposable SQLite databases. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const nativeFixture = require('./native_browser_fixture.cjs');
const outputRoot = path.join(root, '.test-output');
fs.mkdirSync(outputRoot, { recursive: true });
const fixture = fs.mkdtempSync(path.join(outputRoot, 'unified-'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const value = await fn(); if (value) return value; } catch {}
    await pause(100);
  }
  throw new Error('Timeout: ' + label);
}
function cdp(ws, exceptions) {
  let serial = 0;
  const pending = new Map();
  ws.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (data.method === 'Runtime.exceptionThrown') exceptions.push(data.params.exceptionDetails);
    if (!data.id) return;
    const task = pending.get(data.id);
    if (!task) return;
    pending.delete(data.id);
    clearTimeout(task.timer);
    data.error ? task.reject(new Error(JSON.stringify(data.error))) : task.resolve(data.result);
  });
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out')); }, Math.max(20000,(params.timeout || 0)+3000));
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
(async () => {
  let server, edge, ws, send, serverLog = '';
  try {
    const socket = net.createServer();
    await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
    const port = socket.address().port;
    await new Promise(resolve => socket.close(resolve));
    const base = 'http://127.0.0.1:' + port;
    const seeded = spawnSync(path.join(root, '.venv/Scripts/python.exe'), ['-B', '-c',
      "import sys; from face_store import FaceStore; from auth_store import AuthStore; store=FaceStore(sys.argv[1]); store.initialize(); auth=AuthStore(store); auth.initialize(); account=auth.create_account('browser_owner','Browser owner','Browser owner password 123',role='admin'); store.register('<img src=x onerror=window.injected=true>',[.1]*60,owner_account_id=account['id'])",
      path.join(fixture, 'faces.sqlite3')], { cwd: root, windowsHide: true, encoding: 'utf-8' });
    assert.equal(seeded.status, 0, seeded.stderr);
    server = spawn(path.join(root, '.venv/Scripts/python.exe'), ['-B', 'run_web.py'], {
      cwd: root, windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PORT: String(port), HOST: '127.0.0.1',
        FACE_DB_BACKEND: 'sqlite', FACE_DATABASE_PATH: path.join(fixture, 'faces.sqlite3'),
        AURAMAXX_DB_PATH: path.join(fixture, 'app.sqlite3'), SUPABASE_DATABASE_URL: '',
        AURAMAXX_DB_BACKEND: 'sqlite',
        AUTH_COOKIE_SECURE: 'false', AI_PROVIDER: 'none', AI_API_KEY: '' },
    });
    server.stdout.on('data', chunk => { serverLog += chunk; });
    server.stderr.on('data', chunk => { serverLog += chunk; });
    await until(async () => (await fetch(base + '/api/health')).ok, 'server startup');
    const profile = path.join(fixture, 'edge-profile');
    fs.mkdirSync(profile);
    edge = spawn(process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank',
    ], { windowsHide: true, stdio: 'ignore' });
    const debugPort = await until(() => fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0], 'Edge startup');
    const targets = await (await fetch('http://127.0.0.1:' + debugPort + '/json')).json();
    ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
    const exceptions = [];
    send = cdp(ws, exceptions);
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: nativeFixture.injection });
    ws.addEventListener('message', async event => {
      const packet = JSON.parse(event.data);
      if (packet.method !== 'Fetch.requestPaused') return;
      const {requestId, request} = packet.params;
      let body, type='application/javascript';
      if (request.url.endsWith('/js/face/landmarker.js')) body=nativeFixture.model;
      else if (request.url.endsWith('/api/aura/status')) { type='application/json';body=JSON.stringify({available:true,status:'ready'}); }
      else if (request.url.endsWith('/api/aura/chat')) {
        type='text/event-stream';
        const payload=JSON.parse(request.postData);
        body='data: '+JSON.stringify({type:'delta',text:'Routine fixture response'})+'\n\n'+'data: '+JSON.stringify({type:'done',conversation_id:payload.conversation_id})+'\n\n';
      }
      if (body !== undefined) await send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:type}],body:Buffer.from(body).toString('base64')});
      else await send('Fetch.continueRequest',{requestId});
    });
    await send('Fetch.enable',{patterns:[{urlPattern:'*/js/face/landmarker.js'},{urlPattern:'*/api/aura/status'},{urlPattern:'*/api/aura/chat'}]});
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const route = async name => {
      await evaluate(`location.hash=${JSON.stringify(name)}`);
      await until(() => evaluate(`!document.querySelector('[data-page="${name}"]').hidden`), name);
    };
    await send('Page.navigate', { url: base });
    await until(() => evaluate(`document.querySelector('#api-status')?.dataset.state === 'online'`), 'main app connected');
    await route('face-lab');
    assert.equal(await evaluate(`document.querySelector('iframe') === null && document.querySelector('[data-face-mode]') === null`),true);
    await click('#face-start-camera');
    await until(() => evaluate(`location.pathname === '/login.html' && !!document.querySelector('#username')`),'original login page');
    assert.equal(await evaluate(`!!document.querySelector('.journey-steps') && document.querySelector('#username').type === 'text'`),true);
    await click('#theme-toggle');
    assert.equal(await evaluate(`document.documentElement.dataset.theme`),'light');
    fs.writeFileSync(path.join(outputRoot,'native-login-desktop.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await click('#tabRegister');
    const email='browser-'+Date.now()+'@example.test';
    await evaluate(`document.querySelector('#displayName').value='Browser member';document.querySelector('#username').value=${JSON.stringify(email)};document.querySelector('#password').value='Browser unified password 123';document.querySelector('#loginForm').requestSubmit()`);
    await until(() => evaluate(`location.hash === '#face-lab' && !!document.querySelector('#face-start-camera')`),'signup returns to face lab');
    assert.equal(await evaluate(`document.documentElement.dataset.theme`),'light');
    await click('#theme-toggle');
    await route('my-aura');
    await until(() => evaluate(`document.querySelector('.profile-card h2').textContent === 'Browser member'`),'display name shared');
    for (const purpose of ['face_analysis','health_tracking','ai_chat']) {
      await until(() => evaluate(`!document.querySelector('[data-consent="${purpose}"]').disabled`),'consent enabled');
      await click(`[data-consent="${purpose}"]`);
      await until(() => evaluate(`document.querySelector('[data-consent="${purpose}"]').checked && !document.querySelector('[data-consent="${purpose}"]').disabled`),'consent saved');
    }
    await route('face-lab');
    await evaluate(`window.__cameraFailure='NotReadableError'`);
    await click('#face-start-camera');
    await until(() => evaluate(`document.querySelector('#face-live-message').dataset.state === 'error' && !document.querySelector('#face-start-camera').disabled`),'camera failure allows retry');
    await evaluate(`window.__cameraFailure=null;window.__fixtureFaceCount=2`);
    await click('#face-start-camera');
    await until(() => evaluate(`document.querySelector('#face-live-state').textContent.includes('nhi')`),'multiple face guard');
    assert.equal(await evaluate(`document.querySelector('#face-capture').disabled`),true);
    await evaluate(`window.__fixtureFaceCount=1`);
    await until(() => evaluate(`!document.querySelector('#face-capture').disabled`),'stable frontal capture');
    await evaluate(`document.querySelector('#face-device').value='fixture-usb';document.querySelector('#face-device').dispatchEvent(new Event('change'))`);
    await until(() => evaluate(`document.querySelector('#face-video').srcObject?.getVideoTracks()[0]?.getSettings().deviceId === 'fixture-usb' && !document.querySelector('#face-capture').disabled`),'USB switch and stable capture');
    await until(() => evaluate(`document.querySelector('#face-ear').textContent !== '\u2014'`),'real server liveness');
    await click('#face-challenge-start');
    await until(() => evaluate(`window.__visionRequests.some(item=>item.url.endsWith('/challenge/start'))`),'challenge started');
    await click('#face-capture');
    await evaluate(`document.querySelector('#face-person-name').value='Native Face';document.querySelector('#face-register-form').requestSubmit()`);
    await until(() => evaluate(`document.querySelector('#face-people-list').textContent.includes('Native Face')`),'native registration');
    await evaluate(`window.__fixtureYaw=25`);
    await click('#face-auto-profile');
    await until(() => evaluate(`!document.querySelector('#face-retake-profile').hidden`),'stable profile auto capture');
    await click('#face-analyze');
    await until(() => evaluate(`!document.querySelector('#face-result-content').hidden && document.querySelectorAll('.face-engine-detail').length >= 6`),'original Python analysis in native report');
    const analyzed=await evaluate(`window.__visionRequests.find(item=>item.url.endsWith('/analyze_face')).body`);
    assert.equal(analyzed.frontal.landmarks.length,478);assert.equal(analyzed.profile.landmarks.length,478);
    assert.ok(analyzed.frontal.image.startsWith('data:image/jpeg'));assert.ok(analyzed.profile.poseYaw >= 15);
    assert.equal(await evaluate(`document.querySelectorAll('.face-report-figure').length`),2);
    fs.writeFileSync(path.join(outputRoot,'native-face-desktop.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await route('arena');
    await until(() => evaluate(`!!document.querySelector('[data-select-bot="rookie"]')`),'bot catalog');
    await click('[data-select-bot="rookie"]');
    await route('face-lab');
    await click('[data-face-action="bot"]');
    await until(() => evaluate(`document.querySelector('#face-bot-battle-outcome').textContent.includes('ELO')`),'BOT uses original report measurements');
    await click('[data-face-action="routine"]');
    await until(() => evaluate(`location.hash === '#aura-ai' && document.querySelector('#chat-attach-report').checked && !document.querySelector('#chat-input').disabled`),'report attached to native AI composer');
    assert.equal(await evaluate(`window.__visionRequests.filter(item=>item.url.endsWith('/aura/chat')).length`),0,'AI waits for explicit send');
    await click('#chat-send');
    await until(() => evaluate(`document.querySelector('.chat-message-assistant')?.textContent.includes('Routine fixture response')`),'AI response');
    const chatPayload=await evaluate(`window.__visionRequests.find(item=>item.url.endsWith('/aura/chat')).body`);
    assert.ok(chatPayload.analysis.overall_harmony_score >= 0);
    assert.equal(JSON.stringify(chatPayload).includes('data:image'),false);
    assert.equal(JSON.stringify(chatPayload).includes('landmarks'),false);
    await route('face-lab');
    assert.equal(await evaluate(`document.querySelector('#face-video').srcObject === null`),true,'camera stops after leaving');
    await click('[data-face-action="delete"]');
    await route('aura-ai');
    assert.equal(await evaluate(`document.querySelector('#chat-attach-report').checked`),false,'cleared report cannot be attached');
    const uploadSynthetic = () => evaluate(`(async()=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const context=canvas.getContext('2d');const gradient=context.createLinearGradient(0,0,640,480);gradient.addColorStop(0,'#555');gradient.addColorStop(1,'#ccc');context.fillStyle=gradient;context.fillRect(0,0,640,480);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const data=new DataTransfer();data.items.add(new File([blob],'fixture.png',{type:'image/png'}));const input=document.querySelector('#face-upload');input.files=data.files;input.dispatchEvent(new Event('change'));})()`);
    await route('face-lab');
    await evaluate(`window.__fixtureFaceCount=0;window.__fixtureYaw=0`);
    const beforeUpload=await evaluate(`window.__visionRequests.filter(item=>item.url.endsWith('/analyze_face')).length`);
    await uploadSynthetic();
    await until(() => evaluate(`document.querySelector('#face-live-message').dataset.state === 'error' && document.querySelector('#face-progress').hidden`),'upload rejects no face');
    assert.equal(await evaluate(`window.__visionRequests.filter(item=>item.url.endsWith('/analyze_face')).length`),beforeUpload);
    await evaluate(`window.__fixtureFaceCount=1`);
    await uploadSynthetic();
    await until(() => evaluate(`!document.querySelector('#face-result-content').hidden && document.querySelector('#face-progress').hidden`),'single image analysis with original engine');
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await evaluate(`document.querySelector('#face-result-content').scrollIntoView({block:'start'})`);
    await pause(500);
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth+1`),true);
    fs.writeFileSync(path.join(outputRoot,'native-face-mobile.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await route('health-hub');
    await until(() => evaluate(`!!document.querySelector('#habit-entry-form') && !document.querySelector('#habit-value').disabled`), 'health journal');
    await evaluate(`document.querySelector('#habit-category').value='water';document.querySelector('#habit-value').value='2';document.querySelector('#habit-entry-form').requestSubmit()`);
    await until(() => evaluate(`document.querySelector('#habit-records').textContent.includes('2')`), 'habit saved');
    await route('progress');
    await until(() => evaluate(`document.querySelector('.progress-total strong')?.textContent === '1'`), 'progress uses saved habit');
    await route('arena');
    await until(() => evaluate(`!!document.querySelector('#arena-profile-form') && document.querySelectorAll('.arena-bot-card').length > 0`), 'arena loaded');
    for (const name of ['home', 'face-lab', 'arena', 'health-hub', 'aura-ai', 'progress', 'my-aura']) {
      await route(name);
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      assert.equal(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth + 1`), true, 'mobile overflow: ' + name);
    }
    fs.writeFileSync(path.join(outputRoot, 'unified-mobile.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await click('#logout-button');
    await until(() => evaluate(`document.querySelector('.profile-card h2').textContent === 'Chưa đăng nhập'`), 'logout');
    await send('Page.navigate', { url: base + '/manage' });
    await until(() => evaluate(`!document.querySelector('#manage-access')?.hidden`), 'owner login guard');
    await send('Page.navigate', { url: base + '/#my-aura' });
    await until(() => evaluate(`!!document.querySelector('[data-auth-open="login"]')`), 'main auth ready');
    await click('[data-auth-open="login"]');
    await until(() => evaluate(`location.pathname === '/login.html' && !!document.querySelector('#loginForm')`),'owner login page');
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth+1`),true,'original login mobile layout');
    fs.writeFileSync(path.join(outputRoot,'native-login-mobile.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await evaluate(`document.querySelector('#username').value='browser_owner';document.querySelector('#password').value='Browser owner password 123';document.querySelector('#loginForm').requestSubmit()`);
    await until(() => evaluate(`!document.querySelector('[data-unified-admin]').hidden`), 'owner role');
    await click('[data-unified-admin]');
    await until(() => evaluate(`location.pathname === '/manage' && !document.querySelector('#manage-content')?.hidden && !!document.querySelector('#managed-accounts tr')`), 'single admin area');
    assert.equal(await evaluate(`(async()=> (await fetch('/api/vision/admin/accounts')).status)()`), 410);
    await evaluate(`window.confirm=()=>true`);
    await click('#open-create-account');
    await evaluate(`document.querySelector('#managed-username').value='owner_created';document.querySelector('#managed-display-name').value='Managed by owner';document.querySelector('#managed-account-form').requestSubmit()`);
    await until(() => evaluate(`document.querySelector('#managed-password-dialog').open && !!document.querySelector('#managed-temporary-password').value`), 'owner creates account');
    assert.equal(await evaluate(`document.querySelector('#managed-temporary-password').type`), 'password');
    await click('#close-managed-password');
    assert.equal(await evaluate(`document.querySelector('#managed-temporary-password').value`), '');
    await evaluate(`document.querySelector('#account-search').value='owner_created';document.querySelector('#account-search').dispatchEvent(new Event('input'))`);
    await until(() => evaluate(`document.querySelectorAll('#managed-accounts tr').length === 1`), 'filter owned accounts');
    await click('#managed-accounts .manage-actions button:nth-child(2)');
    await until(() => evaluate(`document.querySelector('#managed-accounts').textContent.includes('Đã khóa')`), 'lock account');
    await click('#managed-accounts .manage-actions button:nth-child(2)');
    await until(() => evaluate(`document.querySelector('#managed-accounts').textContent.includes('Hoạt động')`), 'unlock account');
    await click('[data-manage-tab="people"]');
    await until(() => evaluate(`document.querySelectorAll('#managed-people tr').length === 2`), 'owner sees all face profiles');
    assert.equal(await evaluate(`window.injected === undefined`), true);
    await click('#managed-people button');
    await evaluate(`document.querySelector('#managed-person-name').value='Owner updated profile';document.querySelector('#managed-person-form').requestSubmit()`);
    await until(() => evaluate(`document.querySelector('#managed-people').textContent.includes('Owner updated profile')`), 'owner edits face profile');
    await click('[data-manage-tab="data"]');
    await until(() => evaluate(`document.querySelector('#managed-data').textContent.includes('water')`), 'owner sees app data');
    await click('#create-backup');
    await until(() => evaluate(`!document.querySelector('#backup-download').hidden`), 'verified backup');
    assert.equal(await evaluate(`(async()=>{const response=await fetch(document.querySelector('#backup-download').href);return response.ok && response.headers.get('content-type').includes('application/zip')})()`), true);
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth + 1`), true, 'owner mobile layout');
    fs.writeFileSync(path.join(outputRoot, 'owner-management-mobile.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    if (process.env.AURAMAXX_TEST_REAL_MEDIAPIPE === '1') {
      const actual=await send('Runtime.evaluate',{awaitPromise:true,returnByValue:true,timeout:60000,expression:`(async()=>{const {createLandmarker}=await import('/js/face/landmarker.js?real-sdk-check='+Date.now());const detector=await createLandmarker('IMAGE');try{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;canvas.getContext('2d').fillRect(0,0,640,480);return {faces:detector.detect(canvas).faceLandmarks.length};}finally{detector.close();}})()`});
      assert.equal(actual.exceptionDetails,undefined,JSON.stringify(actual.exceptionDetails));
      assert.deepEqual(actual.result.value,{faces:0});
      console.log('PASS: actual pinned MediaPipe module, WASM/model download, IMAGE inference and detector disposal.');
    }
    assert.deepEqual(exceptions, [], 'uncaught browser errors');
    console.log('PASS: original login and return path; native VisionFace camera, liveness, profiles, multi-view Python report; explicit routine/AI attachment; seven mobile pages; owner management and verified backup. Devices/landmarks and AI provider use test fixtures.');
  } catch (error) {
    fs.writeFileSync(path.join(outputRoot, 'unified-server.log'), serverLog);
    if (send) {
      const debug=await send('Runtime.evaluate',{expression:`JSON.stringify({url:location.href,message:document.querySelector('#face-live-message')?.textContent,result:document.querySelector('#face-result-content')?.textContent,errors:document.querySelector('#loginMessage')?.textContent})`,returnByValue:true}).catch(()=>null);
      if (debug) console.error(debug.result.value);
      const screenshot=await send('Page.captureScreenshot',{format:'png'}).catch(()=>null);
      if(screenshot)fs.writeFileSync(path.join(outputRoot,'native-failure.png'),Buffer.from(screenshot.data,'base64'));
    }
    throw error;
  } finally {
    if (send) await send('Browser.close').catch(() => {});
    ws?.close();
    edge?.kill();
    server?.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
