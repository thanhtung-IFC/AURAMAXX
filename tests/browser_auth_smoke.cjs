/* Real Edge UI smoke test against disposable SQLite data. Windows + Node 22+. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { try { const value = await fn(); if (value) return value; } catch {} await pause(100); }
  throw new Error('Timeout: ' + label);
}
function cdp(ws) {
  let serial = 0; const pending = new Map();
  ws.addEventListener('message', event => {
    const data = JSON.parse(event.data); if (!data.id) return;
    const task = pending.get(data.id); if (!task) return;
    pending.delete(data.id); clearTimeout(task.timer);
    data.error ? task.reject(new Error(JSON.stringify(data.error))) : task.resolve(data.result);
  });
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out')); }, 20000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
}
(async () => {
  let fixture, edge, base, ws, send;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'visionface-edge-'));
  try {
    fixture = spawn(path.join(root, '.venv/Scripts/python.exe'), ['-B', 'tests/browser_auth_server.py'], { cwd: root, windowsHide: true });
    let output = ''; fixture.stdout.on('data', data => { output += data; }); fixture.stderr.on('data', data => process.stderr.write(data));
    const port = await until(() => output.match(/^\d+\r?$/m)?.[0]?.trim(), 'fixture startup');
    base = 'http://127.0.0.1:' + port;
    const executable = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    edge = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
    const debugPort = await until(() => fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0], 'Edge startup');
    const targets = await (await fetch('http://127.0.0.1:' + debugPort + '/json')).json();
    ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
    send = cdp(ws);
    await send('Page.enable');
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const go = async url => { await send('Page.navigate', { url: base + url }); await until(() => evaluate(`location.pathname === ${JSON.stringify(url)} && document.readyState === 'complete'`), url); };
    const fill = async values => evaluate(Object.entries(values).map(([id, value]) => `document.getElementById(${JSON.stringify(id)}).value=${JSON.stringify(value)}`).join(';'));
    const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    await go('/admin-login.html');
    await fill({ username: 'admin', password: 'Browser temp password 123' }); await click('#submitLogin');
    await until(() => evaluate(`location.pathname === '/account.html' && !!document.getElementById('savePassword')`), 'forced password change');
    await fill({ currentPassword: 'Browser temp password 123', newPassword: 'Browser new password 123', confirmPassword: 'Browser new password 123' }); await click('#savePassword');
    await until(() => evaluate(`location.pathname === '/admin-login.html' && !!document.getElementById('submitLogin')`), 'password changed');
    await fill({ username: 'admin', password: 'Browser new password 123' }); await click('#submitLogin');
    await until(() => evaluate(`location.pathname === '/admin.html' && document.getElementById('peopleCount')?.textContent === '1'`), 'admin dashboard');
    assert.equal(await evaluate('window.injected === undefined'), true, 'Names must render as text');
    await click('#peopleRows button');
    await until(() => evaluate(`!!document.querySelector('#personDetail select')`), 'person detail');
    assert.match(await evaluate(`document.getElementById('personDetail').textContent`), /geometric-v1/);
    await evaluate(`const owner=document.querySelector('#personDetail select'); owner.value=[...owner.options].find(option=>option.textContent.startsWith('bob ')).value; document.querySelector('#personDetail form').requestSubmit()`);
    await until(() => evaluate(`document.getElementById('adminMessage').textContent.includes('Đã lưu')`), 'owner saved');
    await click('[data-tab="accounts"]');
    await until(() => evaluate(`document.querySelectorAll('#accountRows tr').length === 2`), 'accounts');
    await click('#accountRows [data-action="toggle-status"]');
    await until(() => evaluate(`document.querySelector('#accountRows [data-action="toggle-status"]').textContent === 'Mở khóa'`), 'lock user');
    await click('#accountRows [data-action="toggle-status"]');
    await until(() => evaluate(`document.querySelector('#accountRows [data-action="toggle-status"]').textContent === 'Khóa'`), 'unlock user');
    await click('#accountsPanel summary');
    await fill({ createUsername: 'charlie', createDisplayName: 'Người dùng do admin tạo' });
    await click('#createAccountForm button');
    await until(() => evaluate(`!document.getElementById('temporaryPasswordPanel').hidden && document.getElementById('temporaryPasswordRecipient').textContent.includes('charlie')`), 'admin creates user');
    assert.equal(await evaluate(`document.getElementById('issuedTemporaryPassword').type`), 'password');
    await click('#toggleTemporaryPassword');
    assert.equal(await evaluate(`document.getElementById('issuedTemporaryPassword').type`), 'text');
    await click('#dismissTemporaryPassword');
    assert.equal(await evaluate(`document.getElementById('issuedTemporaryPassword').value`), '');
    await click('#accountRows tr:nth-child(2) [data-action="account-detail"]');
    await until(() => evaluate(`document.getElementById('editUsername')?.value === 'bob'`), 'linked account detail');
    assert.match(await evaluate(`document.getElementById('accountDetail').textContent`), /1 mẫu/);
    await fill({ editUsername: 'bobby', editDisplayName: 'Bob đã cập nhật' });
    await click('#editAccountForm button');
    await until(() => evaluate(`document.getElementById('adminMessage').textContent.includes('Đã cập nhật thông tin tài khoản') && document.getElementById('editUsername')?.value === 'bobby'`), 'edit login info');
    await fill({ resetTemporaryPassword: 'Browser reset password 123' });
    await click('#resetUserPasswordForm button');
    await until(() => evaluate(`document.getElementById('issuedTemporaryPassword').value === 'Browser reset password 123'`), 'admin resets user password');
    await click('#accountDetail [data-action="linked-person"]');
    await until(() => evaluate(`!document.getElementById('peoplePanel').hidden`), 'account to person link');
    assert.equal(await evaluate(`document.getElementById('issuedTemporaryPassword').value`), '');
    await click('[data-tab="audit"]');
    await until(() => evaluate(`document.querySelectorAll('#auditRows tr').length >= 6`), 'audit log');
    assert.match(await evaluate(`document.getElementById('auditSource').textContent`), /SQLite.*audit_logs/);
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'Mobile layout overflow');
    await click('[data-logout]');
    await until(() => evaluate(`location.pathname === '/admin-login.html'`), 'logout');
    await go('/login.html'); await click('#tabRegister');
    await fill({ displayName: 'Người dùng thử', username: 'alice', password: 'Browser user password 123' }); await click('#submitLogin');
    await until(() => evaluate(`document.getElementById('loginMessage').textContent.includes('Đã tạo tài khoản')`), 'user signup');
    await fill({ username: 'bobby', password: 'Browser reset password 123' }); await click('#submitLogin');
    await until(() => evaluate(`location.pathname === '/account.html' && !!document.getElementById('savePassword')`), 'user must replace temporary password');
    await fill({ currentPassword: 'Browser reset password 123', newPassword: 'Browser private password 123', confirmPassword: 'Browser private password 123' }); await click('#savePassword');
    await until(() => evaluate(`location.pathname === '/login.html' && !!document.getElementById('submitLogin')`), 'user password replaced');
    await fill({ username: 'bobby', password: 'Browser private password 123' }); await click('#submitLogin');
    await until(() => evaluate(`location.pathname === '/'`), 'user login');
    await go('/account.html');
    const result = await evaluate(`(async()=>{const me=await(await fetch('/api/auth/me')).json(); const faces=await(await fetch('/api/faces')).json(); const admin=await fetch('/api/admin/people'); return {role:me.account.role,count:faces.total,admin:admin.status,hidden:document.querySelector('[data-admin-only]').hidden};})()`);
    assert.deepEqual(result, { role: 'user', count: 1, admin: 403, hidden: true });
    console.log('PASS: Edge admin/user login, create user, linked account details, edit login, temporary password display/reset/change, lock/unlock, audit, mobile layout, logout and access restrictions.');
  } finally {
    if (base) await fetch(base + '/__fixture_stop').catch(() => {});
    if (send) await send('Browser.close').catch(() => {});
    ws?.close();
    if (!base) fixture?.kill();
    await pause(1000);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
