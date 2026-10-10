/* Real Edge UI checks with mocked AI responses; no credentials are used. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
async function browserTests() {
  const check = (condition, label) => { if (!condition) throw new Error(label); };
  const el = id => document.getElementById(id);
  const ask = async text => {
    el('chatInput').value = text;
    el('chatForm').requestSubmit();
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  try {
    check(el('chatPanel').hidden, 'initially closed');
    el('chatToggle').click();
    check(!el('chatPanel').hidden, 'open');
    const payloads = [];
    window.fetch = async (url, options) => {
      payloads.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ success: true, reply: '<img src=x onerror="window.chatInjected=true"> Gợi ý' }) };
    };
    window.VisionChat.setAnalysis({ proportions: { face_shape: 'Oval' }, image: 'PRIVATE', landmarks: [1] });
    await ask('Kiểu tóc nào?');
    check(payloads[0].analysis.proportions.face_shape === 'Oval', 'report attached');
    check(!('image' in payloads[0].analysis) && !('landmarks' in payloads[0].analysis), 'no images/landmarks');
    check(!window.chatInjected && !document.querySelector('#chatMessages img'), 'safe text rendering');
    check(document.querySelectorAll('.chat-message-model').length === 2, 'answer rendered');
    await ask('Giải thích thêm');
    check(payloads[1].history.length === 2, 'follow-up history');
    el('chatAttach').click();
    await ask('Hỏi chung');
    check(payloads[2].analysis === null && payloads[2].history.length === 0, 'opt-out removes context/history');
    window.fetch = async () => ({ ok: false, json: async () => ({ success: false, message: 'Gemini hết hạn mức' }) });
    await ask('Thử lại');
    check(el('chatStatus').textContent.includes('hết hạn mức'), 'provider error');
    check(el('chatInput').value === 'Thử lại' && !el('chatSend').disabled, 'retry enabled');
    window.VisionChat.setAnalysis(null);
    check(document.querySelectorAll('.chat-message').length === 1, 'new report clears conversation');
    const bounds = el('chatPanel').getBoundingClientRect();
    check(bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight, 'panel fits viewport');
    el('chatClose').click();
    check(el('chatPanel').hidden, 'close');
    document.body.dataset.testResult = 'PASS';
  } catch (error) { document.body.dataset.testResult = 'FAIL: ' + error.message; }
}
(async () => {
  const fixture = http.createServer((request, response) => {
    if (request.url === '/assets/chat.js' || request.url === '/assets/chat.css') {
      response.setHeader('Content-Type', request.url.endsWith('.js') ? 'application/javascript' : 'text/css');
      response.end(fs.readFileSync(path.join(root, request.url.slice(1))));
    } else {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/assets/chat.css"></head><body><script src="/assets/chat.js"></script><script>(' + browserTests.toString() + ')()</script></body></html>');
    }
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  try {
    for (const dimensions of ['1000,900', '375,667']) {
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'visionface-chat-'));
      const edge = spawn(process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + profile,
          '--window-size=' + dimensions, '--dump-dom', '--virtual-time-budget=5000', 'http://127.0.0.1:' + fixture.address().port],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '', diagnostics = '';
      edge.stdout.on('data', data => { output += data; });
      edge.stderr.on('data', data => { diagnostics += data; });
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { edge.kill(); reject(new Error('Edge timed out')); }, 30000);
        edge.on('error', error => { clearTimeout(timeout); reject(error); });
        edge.on('exit', () => { clearTimeout(timeout); resolve(); });
      });
      assert.match(output, /data-test-result="PASS"/, output.match(/data-test-result="[^"]*"/)?.[0] || 'Browser returned no test result: ' + diagnostics.slice(-1500));
    }
    console.log('PASS: desktop/mobile chat, report attachment, safe output, history, opt-out, errors/retry and reset.');
  } finally {
    await new Promise(resolve => fixture.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
