'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../assets/session.js'), 'utf8');

async function scenario({ prefix = '/api', embedded = false, role = 'user', status = 200 } = {}) {
  const navigations = [], messages = [];
  const window = {
    VISIONFACE_API_PREFIX: prefix,
    location: {
      href: 'http://localhost:8000/account.html', origin: 'http://localhost:8000',
      hostname: 'localhost', pathname: '/account.html',
      assign: target => navigations.push(target),
    },
    async fetch(input) {
      if (String(input).endsWith('/auth/me')) {
        return { ok: true, json: async () => ({ account: { id: 'account-1', role }, csrf_token: 'csrf-1' }) };
      }
      return { ok: status >= 200 && status < 300, status };
    },
  };
  window.parent = embedded ? { postMessage: (...args) => messages.push(args) } : window;
  vm.runInNewContext(source, {
    window, URL, Headers,
    document: { querySelectorAll: () => [], getElementById: () => null },
  });
  await window.VisionAuth.ready;
  return { window, navigations, messages };
}

(async () => {
  for (const role of ['user', 'admin']) {
    const result = await scenario({ role });
    await result.window.VisionAuth.logout();
    assert.equal(result.window.VisionAuth.state.account, null);
    assert.equal(result.window.VisionAuth.state.csrf, null);
    assert.deepEqual(result.navigations, [role === 'admin' ? '/admin-login.html' : '/login.html']);
  }

  const embedded = await scenario({ prefix: '/api/vision', embedded: true });
  await embedded.window.VisionAuth.logout();
  assert.equal(embedded.window.VisionAuth.state.account, null);
  assert.equal(embedded.window.VisionAuth.state.csrf, null);
  assert.equal(embedded.messages[0][0].type, 'auramaxx:logged-out');
  assert.equal(embedded.messages[0][1], 'http://localhost:8000');
  assert.deepEqual(embedded.navigations, []);

  const integrated = await scenario({ prefix: '/api/vision', status: 401 });
  await integrated.window.VisionAuth.logout();
  assert.deepEqual(integrated.navigations, ['/#my-aura']);
  assert.equal(integrated.window.VisionAuth.state.csrf, null);

  const failed = await scenario({ status: 500 });
  await assert.rejects(() => failed.window.VisionAuth.logout(), /Chưa đăng xuất được/);
  assert.equal(failed.window.VisionAuth.state.account.id, 'account-1');
  assert.equal(failed.window.VisionAuth.state.csrf, 'csrf-1');
  assert.deepEqual(failed.navigations, []);
  console.log('5 logout scenarios passed: user, admin, embedded, expired session, server failure.');
})().catch(error => { console.error(error); process.exitCode = 1; });
