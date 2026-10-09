const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../assets/session.js'), 'utf8');
function rig(page) {
  const links = [{ href: '/admin-login.html', getAttribute() { return '/admin-login.html'; } }];
  let redirect, calls = 0;
  const message = { textContent: '' };
  const window = {
    location: { hostname: 'example.github.io', pathname: '/AURAMAXX/' + page,
      origin: 'https://example.github.io', href: 'https://example.github.io/AURAMAXX/' + page,
      replace(url) { redirect = url; } },
    fetch: async () => { calls++; throw new Error('Unexpected network request'); }
  };
  const document = {
    currentScript: { src: 'https://example.github.io/AURAMAXX/assets/session.js' },
    querySelectorAll: selector => selector === 'a[href^="/"]' ? links : [],
    getElementById: () => message
  };
  vm.runInNewContext(source, { window, document, URL, Headers });
  return { window, message, links, redirect: () => redirect, calls: () => calls };
}
(async () => {
  for (const page of ['', 'index.html', 'admin.html', 'account.html']) {
    const r = rig(page);
    await r.window.VisionAuth.ready;
    assert.equal(r.redirect(), 'https://example.github.io/AURAMAXX/login.html');
    assert.equal(r.links[0].href, 'https://example.github.io/AURAMAXX/admin-login.html');
    assert.equal(r.calls(), 0);
  }
  for (const page of ['login.html', 'admin-login.html']) {
    const r = rig(page);
    assert.equal(r.redirect(), undefined);
    assert.match(r.message.textContent, /máy chủ Python/);
    await assert.rejects(r.window.VisionAuth.fetch('/api/auth/user/login', { method: 'POST' }), /máy chủ Python/);
    assert.equal(r.calls(), 0);
  }
  console.log('PASS: GitHub Pages project-path navigation, login redirect and explicit backend requirement.');
})().catch(error => { console.error(error); process.exitCode = 1; });
