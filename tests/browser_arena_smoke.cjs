/* Arena integration QA with disposable SQLite data and an isolated browser. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const root = process.cwd();
const fixture = fs.mkdtempSync(path.join(root, '.test-output', 'arena-preview-'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    try { const result = await fn(); if (result) return result; } catch {}
    await pause(150);
  }
  throw new Error('Timeout: ' + label);
}
function connect(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', event => {
    const reply = JSON.parse(event.data);
    const request = pending.get(reply.id);
    if (!request) return;
    pending.delete(reply.id);
    clearTimeout(request.timer);
    reply.error ? request.reject(new Error(JSON.stringify(reply.error))) : request.resolve(reply.result);
  });
  return (method, params = {}) => new Promise((resolve, reject) => {
    const serial = ++id;
    const timer = setTimeout(() => { pending.delete(serial); reject(new Error(method + ' timed out')); }, 25000);
    pending.set(serial, { resolve, reject, timer });
    ws.send(JSON.stringify({ id: serial, method, params }));
  });
}
(async () => {
  let server, edge, ws;
  try {
    const socket = net.createServer();
    await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
    const port = socket.address().port;
    await new Promise(resolve => socket.close(resolve));
    const base = 'http://127.0.0.1:' + port;
    server = spawn(path.join(root, '.venv/Scripts/python.exe'), ['-B', 'run_web.py'], {
      cwd: root, windowsHide: true, stdio: 'ignore',
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PORT: String(port), HOST: '127.0.0.1',
        FACE_DB_BACKEND: 'sqlite', FACE_DATABASE_PATH: path.join(fixture, 'faces.sqlite3'),
        AURAMAXX_DB_PATH: path.join(fixture, 'app.sqlite3'), SUPABASE_DATABASE_URL: '',
        DATABASE_URL: '', AURAMAXX_DB_BACKEND: 'sqlite', AUTH_COOKIE_SECURE: 'false',
        AI_PROVIDER: 'none', AI_API_KEY: '' },
    });
    await until(async () => (await fetch(base + '/api/health')).ok, 'server startup');
    const profile = path.join(fixture, 'edge-profile');
    fs.mkdirSync(profile);
    edge = spawn(process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
      '--disable-extensions', '--disable-component-extensions-with-background-pages', '--disable-sync', '--remote-debugging-port=0',
      '--user-data-dir=' + profile, 'about:blank',
    ], { windowsHide: true, stdio: 'ignore' });
    const debugPort = await until(() => fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0], 'Edge startup');
    const targets = await (await fetch('http://127.0.0.1:' + debugPort + '/json')).json();
    ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
    const send = connect(ws);
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await send('Page.enable');
    await send('Runtime.enable');

    const errors=[];
    ws.addEventListener('message', event=>{const data=JSON.parse(event.data);if(data.method==='Runtime.exceptionThrown' && !/extension:/.test(data.params.exceptionDetails.url||''))errors.push(data.params.exceptionDetails.text);});
    await send('Page.navigate', {url:base+'/#arena'});
    await until(()=>evaluate('document.querySelectorAll("[data-select-bot]").length===5'), 'arena catalog');
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1080,deviceScaleFactor:1,mobile:false});
    await evaluate('document.querySelector(".arena-bot-card").scrollIntoView({behavior:"instant",block:"start"})');
    await until(()=>evaluate('[...document.querySelectorAll("#arena-bot-list img")].every(img=>img.complete&&img.naturalWidth>0)'), 'bot portraits decoded');
    const portraits=await evaluate('[...document.querySelectorAll("[data-select-bot]")].map(button=>({id:button.dataset.selectBot,src:button.querySelector("img").currentSrc,x:button.getBoundingClientRect().x,y:button.getBoundingClientRect().y,style:button.querySelector("[data-portrait-style]").dataset.portraitStyle}))');
    assert.deepEqual(portraits.map(item=>item.id),['rookie','casual','skilled','elite','champion']);
    portraits.forEach((item,i)=>{assert(item.src.includes('/'+item.id+'-'));assert(Math.abs(item.y-portraits[0].y)<2);if(i)assert(item.x>portraits[i-1].x);});
    assert.deepEqual(portraits.slice(0,2).map(item=>item.style),['pixel','pixel']);
    await evaluate('document.fonts.ready.then(()=>true)');
    const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await click('[data-select-bot="rookie"]');
    assert.equal(await evaluate('document.querySelector("#arena-bot-start").disabled'),true);
    await evaluate(`import('/js/theme.js').then(m=>m.setTheme('light'))`);
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1080,deviceScaleFactor:1,mobile:false});
    await pause(500);
    const screenshot=async name=>fs.writeFileSync(path.join(root,'.test-output',name+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
    await screenshot('arena-desktop-guest-light');
    await evaluate(`(async()=>{const {api}=await import('/js/api.js');await api.post('/api/auth/register',{email:'arena-browser-'+Date.now()+'@example.test',password:'Arena browser password 123',display_name:'Arena Explorer'});await api.post('/api/consents',{purpose:'face_analysis',granted:true});window.dispatchEvent(new CustomEvent('auramaxx:auth-changed'));return true;})()`);
    await until(()=>evaluate('!!document.querySelector("#arena-profile-form")'),'signed in arena');
    const makeReport=score=>evaluate(`import('/js/face/report.js').then(m=>m.setFaceReport({proportions:{rule_of_thirds:{harmony_score:${score}}},nose:{nose_aesthetic_score:${score}},jawline:{jawline_sharpness_score:${score}},skin:{smoothness_score:${score}},measurement_quality:{front_pose:{yaw_deg:2,roll_deg:1,clipped:false,face_height_fraction:.55,image_width:1280,image_height:720}}}))`);
    await makeReport(72);
    await click('[data-select-bot="casual"]');
    assert.equal(await evaluate('document.querySelector("#arena-bot-start").disabled'),false);
    await click('#arena-bot-start');
    await until(()=>evaluate('document.querySelectorAll(".arena-match-row").length===1 && !document.querySelector("#arena-bot-start").disabled'),'first practice result');
    await click('#arena-bot-start');
    await until(()=>evaluate('!document.querySelector("#arena-bot-start").disabled'),'replayed practice');
    assert.equal(await evaluate(`import('/js/api.js').then(async m=>(await m.api.get('/api/arena/bot-matches/history')).length)`),1);
    await click('[data-select-bot="champion"]');await click('#arena-bot-start');
    await until(()=>evaluate('document.querySelectorAll(".arena-match-row").length===2'),'second opponent');
    await click('[data-history-filter="win"]');
    assert.equal(await evaluate('document.querySelectorAll(".arena-match-row").length'),1);
    await click('[data-history-filter="loss"]');
    assert.equal(await evaluate('document.querySelectorAll(".arena-match-row").length'),1);
    await click('[data-history-filter="all"]');
    await click('[data-bot-filter="challenge"]');
    assert.equal(await evaluate('document.querySelectorAll("[data-select-bot]").length'),2);
    await click('[data-arena-recommend]');
    assert.equal(await evaluate('document.querySelectorAll("[data-select-bot]").length'),5);
    await evaluate('document.querySelector(".arena-profile-settings").open=true;document.querySelector("#arena-display-name").value="Arena <Explorer>";document.querySelector("[name=leaderboard_public]").checked=true;document.querySelector("#arena-profile-form").requestSubmit()');
    await until(()=>evaluate('document.querySelector(".arena-profile-identity b")?.textContent==="Arena <Explorer>"'),'profile saved');
    assert.equal(await evaluate('document.querySelector(".arena-player-copy b").textContent'),'Arena <Explorer>');
    await click('[data-arena-tab="new"]');
    await until(()=>evaluate('document.querySelector("[role=tabpanel]").getAttribute("aria-labelledby")==="arena-tab-new"'),'tab semantics');
    await click('[data-arena-tab="all"]');
    await evaluate('document.querySelector(".arena-profile-settings").open=false;document.querySelector(".arena-bot-score-preview").open=true;document.querySelector(".arena-match-row details").open=true');
    assert.equal(await evaluate('document.querySelectorAll(".arena-match-detail .arena-comparison-row").length'),8);
    for(const width of [1895,1280,768,390,320]){
      await send('Emulation.setDeviceMetricsOverride',{width,height:1080,deviceScaleFactor:1,mobile:false});
      for(const theme of ['light','dark']){
        await evaluate(`import('/js/theme.js').then(m=>m.setTheme('${theme}'))`);await pause(450);
        const layout=await evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth,theme:document.documentElement.dataset.theme,buttons:document.querySelectorAll("[data-select-bot]").length,title:document.querySelector("#arena-title").getBoundingClientRect().height,titleColor:getComputedStyle(document.querySelector("#arena-title")).color})');
        assert(layout.scroll<=layout.width,JSON.stringify(layout));
        if(width<=760){assert(await evaluate('document.querySelector("#arena-bot-list").scrollWidth>document.querySelector("#arena-bot-list").clientWidth'),'portraits scroll horizontally on mobile');}
        console.log('LAYOUT',JSON.stringify(layout));
        if(width===1895||width===390){await evaluate('window.scrollTo({top:0,behavior:"instant"})');await pause(100);await screenshot(`arena-${width}-${theme}`);}
      }
    }
    await makeReport(72);
    await evaluate(`import('/js/face/report.js').then(m=>m.setFaceReport({proportions:{rule_of_thirds:{harmony_score:72}},nose:{nose_aesthetic_score:72},jawline:{jawline_sharpness_score:72},skin:{smoothness_score:72},measurement_quality:{front_pose:{yaw_deg:25,roll_deg:0}}}))`);
    assert.equal(await evaluate('document.querySelector("#arena-bot-start").disabled'),true,'poor pose blocks practice');
    await makeReport(72);
    await evaluate(`(async()=>{const {api}=await import('/js/api.js');await api.post('/api/consents',{purpose:'face_analysis',granted:false});window.dispatchEvent(new CustomEvent('auramaxx:consent-changed',{detail:{purpose:'face_analysis',granted:false}}));})()`);
    await until(()=>evaluate('document.querySelectorAll(".arena-match-row").length===0'),'revocation clears history');
    assert.equal(await evaluate(`import('/js/face/report.js').then(m=>m.getFaceReport())`),null);
    assert.equal(await evaluate(`import('/js/api.js').then(async m=>(await m.api.get('/api/arena/bot-matches/summary')).matches_played)`),0);
    assert.deepEqual(errors,[]);
    console.log('PASS: practice, replay, filters, profile escaping, quality gate, consent deletion and 10 responsive/theme layouts.');
  } finally {
    ws?.close();
    edge?.kill();
    server?.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
