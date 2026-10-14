'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../assets/account.js'), 'utf8');

async function scenario({ adminReturn, account }) {
  const navigations = [], listeners = {};
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: id === 'newPassword' || id === 'confirmPassword' ? 'New password 123' : '',
      textContent: '', disabled: false,
      addEventListener: (type, callback) => { listeners[id + ':' + type] = callback; },
      reset() {},
    });
    return elements.get(id);
  };
  vm.runInNewContext(source, {
    URLSearchParams,
    document: { getElementById: element },
    window: { location: { search: adminReturn ? '?next=%2Fmanage' : '', assign: url => navigations.push(url) }, VISIONFACE_API_PREFIX: '/api/vision' },
    VisionAuth: {
      ready: Promise.resolve({ account }), state: { account },
      fetch: async () => ({ ok: true, json: async () => ({ success: true }) }),
    },
  });
  await Promise.resolve();
  if (account) await listeners['passwordForm:submit']({ preventDefault() {} });
  return navigations;
}

(async () => {
  assert.deepEqual(await scenario({ adminReturn: true, account: { role: 'admin' } }), ['/admin-login.html?password_changed=1']);
  assert.deepEqual(await scenario({ adminReturn: false, account: { role: 'user' } }), ['/#my-aura']);
  assert.deepEqual(await scenario({ adminReturn: true, account: null }), ['/admin-login.html']);
  console.log('3 password return scenarios passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
