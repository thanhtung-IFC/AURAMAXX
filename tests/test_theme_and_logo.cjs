'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

console.log('--- TEST 1: Logo File and HTML References ---');
const logoPath = path.join(__dirname, '..', 'assets', 'visionface-logo.png');
const rootLogoPath = path.join(__dirname, '..', 'visionface-logo.png');
assert(fs.existsSync(logoPath), 'assets/visionface-logo.png must exist');
assert(fs.existsSync(rootLogoPath), 'visionface-logo.png in root must exist');
const logoStat = fs.statSync(logoPath);
assert(logoStat.size > 1000, 'Logo file size must be valid');
console.log('✓ Logo files exist and are valid (' + logoStat.size + ' bytes).');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');
const trackerHtml = fs.readFileSync(path.join(__dirname, '..', 'real_time_face_landmark_liveness_tracker.html'), 'utf-8');

assert.equal(indexHtml, trackerHtml, 'index.html and real_time_face_landmark_liveness_tracker.html must be identical');
assert(!indexHtml.includes('fa-globe'), 'No globe icon should remain in sidebar');
assert(indexHtml.includes('visionface-logo.png'), 'visionface-logo.png must be referenced in HTML');
assert(indexHtml.includes('assets/theme.css'), 'theme.css must be linked in HTML');
assert(indexHtml.includes('data-theme-toggle'), 'data-theme-toggle must be present in header');
console.log('✓ HTML correctly references visionface-logo.png, theme.css, and data-theme-toggle.');

console.log('\n--- TEST 2: Theme Switching Logic in theme.js ---');
const themeJs = fs.readFileSync(path.join(__dirname, '..', 'assets', 'theme.js'), 'utf-8');

function createMockEnv(initialStoredTheme = null) {
  const store = {};
  if (initialStoredTheme) store['visionface-theme'] = initialStoredTheme;

  const dataset = {};
  const classListSet = new Set();
  const root = {
    dataset,
    style: {},
    classList: {
      add: (c) => classListSet.add(c),
      remove: (c) => classListSet.delete(c),
      toggle: (c, force) => {
        if (force === undefined) {
          if (classListSet.has(c)) classListSet.delete(c); else classListSet.add(c);
        } else if (force) {
          classListSet.add(c);
        } else {
          classListSet.delete(c);
        }
      },
      contains: (c) => classListSet.has(c)
    }
  };

  const buttons = [];
  function createButton() {
    const attrs = {};
    const btn = {
      attributes: attrs,
      dataset: { themeToggle: '' },
      setAttribute: (k, v) => { attrs[k] = v; },
      getAttribute: (k) => attrs[k],
      innerHTML: '',
      title: '',
      listeners: {},
      addEventListener: (type, fn) => {
        btn.listeners[type] = btn.listeners[type] || [];
        btn.listeners[type].push(fn);
      },
      click: () => {
        if (btn.listeners['click']) {
          btn.listeners['click'].forEach(fn => fn());
        }
      }
    };
    buttons.push(btn);
    return btn;
  }

  const existingToggleBtn = createButton();

  const doc = {
    documentElement: root,
    readyState: 'complete',
    querySelectorAll: (sel) => {
      if (sel === '[data-theme-toggle]') return buttons;
      if (sel.includes('brand')) return [];
      return [];
    },
    querySelector: (sel) => {
      if (sel === '[data-theme-toggle]') return existingToggleBtn;
      if (sel.includes('font-awesome')) return { href: 'font-awesome' };
      return null;
    },
    createElement: () => createButton(),
    addEventListener: (type, fn) => {
      if (type === 'DOMContentLoaded') fn();
    }
  };

  const context = {
    document: doc,
    location: { pathname: '/' },
    localStorage: {
      getItem: (k) => store[k] || null,
      setItem: (k, v) => { store[k] = String(v); }
    },
    setTimeout: (fn) => fn(),
    Image: class { addEventListener() {} },
    URL: class { constructor(path) { this.href = path; } },
    window: { addEventListener: () => {} }
  };

  return { context, root, existingToggleBtn, store, classListSet };
}

// Subtest A: Default initialization on main app
{
  const env = createMockEnv(null);
  vm.runInNewContext(themeJs, env.context);
  assert.equal(env.root.dataset.theme, 'dark', 'Default theme on tracker should be dark');
  assert(env.classListSet.has('dark'), 'dark class must be present on html element');
  assert.equal(env.existingToggleBtn.getAttribute('aria-label'), 'Chuyển sang chế độ sáng');
  assert(env.existingToggleBtn.innerHTML.includes('Chế độ sáng'));

  // Click toggle to switch to light mode
  env.existingToggleBtn.click();
  assert.equal(env.root.dataset.theme, 'light', 'Theme must toggle to light');
  assert(!env.classListSet.has('dark'), 'dark class must be removed in light mode');
  assert.equal(env.existingToggleBtn.getAttribute('aria-label'), 'Chuyển sang chế độ tối');
  assert(env.existingToggleBtn.innerHTML.includes('Chế độ tối'));
  assert.equal(env.store['visionface-theme'], 'light', 'Preference must be saved to localStorage');

  // Click toggle again to switch back to dark mode
  env.existingToggleBtn.click();
  assert.equal(env.root.dataset.theme, 'dark', 'Theme must toggle back to dark');
  assert(env.classListSet.has('dark'), 'dark class must be re-added in dark mode');
  assert.equal(env.store['visionface-theme'], 'dark', 'Preference must be saved to localStorage');
  console.log('✓ Theme toggle switches between dark and light seamlessly and updates aria/labels.');
}

// Subtest B: Respect saved preference
{
  const envLight = createMockEnv('light');
  vm.runInNewContext(themeJs, envLight.context);
  assert.equal(envLight.root.dataset.theme, 'light', 'Saved light theme must be honored');
  assert(!envLight.classListSet.has('dark'), 'dark class must not be set when light is saved');

  const envDark = createMockEnv('dark');
  vm.runInNewContext(themeJs, envDark.context);
  assert.equal(envDark.root.dataset.theme, 'dark', 'Saved dark theme must be honored');
  assert(envDark.classListSet.has('dark'), 'dark class must be set when dark is saved');
  console.log('✓ Saved theme preferences from localStorage are strictly honored.');
}

console.log('\n--- TEST 3: CSS Coverage and Safeguards ---');
const themeCss = fs.readFileSync(path.join(__dirname, '..', 'assets', 'theme.css'), 'utf-8');

assert(themeCss.includes('html[data-theme="light"] aside'), 'CSS must style aside for light theme');
assert(themeCss.includes('html[data-theme="light"] header'), 'CSS must style header for light theme');
assert(themeCss.includes('.aspect-\\[4\\/3\\].bg-black'), 'CSS must preserve black camera box');
assert(themeCss.includes('#btnToggleCamera'), 'CSS must preserve primary action buttons');
assert(themeCss.includes('#btnRegisterFace'), 'CSS must preserve register button');
assert(themeCss.includes('.daily-task-item'), 'CSS must style daily task items for light theme');
assert(themeCss.includes('.chat-panel'), 'CSS must style chat panel for light theme');
console.log('✓ theme.css includes complete styling rules and safeguards.');

console.log('\n===========================================');
console.log('ALL THEME AND LOGO TESTS PASSED 100%!');
console.log('===========================================');
