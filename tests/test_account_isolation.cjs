'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dailySource = fs.readFileSync(path.join(__dirname, '../assets/daily.js'), 'utf8');

// Mock localStorage
class MockLocalStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

function createDOMContext(storage, account) {
  const elements = new Map();
  function getEl(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        textContent: '',
        innerText: '',
        innerHTML: '',
        className: '',
        classList: {
          add(...cls) {},
          remove(...cls) {},
          toggle(...cls) {}
        },
        dataset: {},
        addEventListener() {},
        querySelectorAll() { return []; },
        closest() { return null; },
        appendChild(child) {},
        removeChild(child) {},
        hidden: false
      });
    }
    return elements.get(id);
  }

  const document = {
    readyState: 'complete',
    getElementById(id) { return getEl(id); },
    querySelectorAll() { return []; },
    addEventListener() {},
    createElement(tag) { return getEl('el_' + Math.random()); },
    body: { append() {} }
  };

  const window = {
    document,
    localStorage: storage,
    VisionAuth: {
      state: { account },
      ready: Promise.resolve({ account })
    },
    addEventListener() {},
    scrollTo() {},
    setInterval() {},
    setTimeout(fn) { fn(); return 1; },
    clearTimeout() {}
  };

  const sandbox = {
    window,
    document,
    localStorage: storage,
    console,
    Date,
    Math,
    JSON,
    parseInt,
    isNaN,
    String,
    Array,
    Set,
    Map,
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {}
  };

  return { sandbox, window };
}

async function run() {
  console.log('--- TEST 1: Legacy global storage cleanup ---');
  const sharedStorage = new MockLocalStorage();
  sharedStorage.setItem('visionface_daily_unlocked', 'true');
  sharedStorage.setItem('visionface_latest_report', JSON.stringify({ score: 99 }));
  sharedStorage.setItem('visionface_daily_streak', '10');

  // Load daily.js in context with account 1
  const user1 = { id: 'acc_user_1', username: 'user1' };
  const ctx1 = createDOMContext(sharedStorage, user1);
  vm.runInNewContext(dailySource, ctx1.sandbox);

  // Wait for async init
  await ctx1.window.VisionAuth.ready;
  await new Promise(r => setTimeout(r, 50));

  // Verify legacy global keys were removed
  assert.equal(sharedStorage.getItem('visionface_daily_unlocked'), null, 'Legacy global key must be removed');
  assert.equal(sharedStorage.getItem('visionface_latest_report'), null, 'Legacy global report must be removed');
  assert.equal(sharedStorage.getItem('visionface_daily_streak'), null, 'Legacy global streak must be removed');
  console.log('✓ Legacy global keys cleaned up properly.');

  console.log('--- TEST 2: User 1 fresh state (unlocked = false, streak = 0) ---');
  assert.equal(ctx1.window.DailyRoutine.manager.isUnlocked(), false, 'Fresh user 1 must NOT be unlocked');
  assert.equal(ctx1.window.DailyRoutine.manager.getLatestReport(), null, 'Fresh user 1 must have null report');
  assert.equal(ctx1.window.DailyRoutine.manager.getStreakInfo().streak, 0, 'Fresh user 1 must have streak 0');
  console.log('✓ User 1 starts with locked status and 0 streak.');

  console.log('--- TEST 3: User 1 performs scan -> unlocks Daily Routine ---');
  const user1Report = {
    overall_harmony_score: 82.5,
    proportions: { face_shape: 'Trái xoan (Oval)' },
    symmetry: { overall_symmetry_score: 88 }
  };
  ctx1.window.DailyRoutine.onFaceAnalysisComplete(user1Report, 'data:image/jpeg;base64,user1photo');

  assert.equal(ctx1.window.DailyRoutine.manager.isUnlocked(), true, 'User 1 must be unlocked after scan');
  assert.equal(ctx1.window.DailyRoutine.manager.getLatestReport().overall_harmony_score, 82.5, 'User 1 report matches');
  assert.equal(ctx1.window.DailyRoutine.manager.getLatestSnapshot(), 'data:image/jpeg;base64,user1photo');
  console.log('✓ User 1 scan unlocked and stored under User 1 scoped key.');

  console.log('--- TEST 4: User 1 completes all tasks -> streak increases to 1 ---');
  const tasks1 = ctx1.window.DailyRoutine.manager.getTodayTasks();
  for (const t of tasks1) {
    ctx1.window.DailyRoutine.manager.toggleTaskCompleted(t.id);
  }
  assert.equal(ctx1.window.DailyRoutine.manager.getStreakInfo().streak, 1, 'User 1 streak must be 1 after all tasks done');
  console.log('✓ User 1 streak incremented to 1.');

  console.log('--- TEST 5: User 1 logs out, User 2 logs in (Isolation Check) ---');
  // User 2 logs into the same browser/domain (shares sharedStorage)
  const user2 = { id: 'acc_user_2', username: 'user2' };
  const ctx2 = createDOMContext(sharedStorage, user2);
  vm.runInNewContext(dailySource, ctx2.sandbox);

  await ctx2.window.VisionAuth.ready;
  await new Promise(r => setTimeout(r, 50));

  // User 2 MUST NOT have User 1's data!
  assert.equal(ctx2.window.DailyRoutine.manager.isUnlocked(), false, 'User 2 MUST NOT be unlocked from User 1!');
  assert.equal(ctx2.window.DailyRoutine.manager.getLatestReport(), null, 'User 2 report MUST be null!');
  assert.equal(ctx2.window.DailyRoutine.manager.getLatestSnapshot(), null, 'User 2 snapshot MUST be null!');
  assert.equal(ctx2.window.DailyRoutine.manager.getStreakInfo().streak, 0, 'User 2 streak MUST be 0!');
  console.log('✓ COMPLETE ISOLATION: User 2 sees ZERO data from User 1!');

  console.log('--- TEST 6: User 2 performs scan with different metrics ---');
  const user2Report = {
    overall_harmony_score: 91.0,
    proportions: { face_shape: 'Vuông (Square)' },
    symmetry: { overall_symmetry_score: 95 }
  };
  ctx2.window.DailyRoutine.onFaceAnalysisComplete(user2Report, 'data:image/jpeg;base64,user2photo');
  assert.equal(ctx2.window.DailyRoutine.manager.isUnlocked(), true, 'User 2 is now unlocked');
  assert.equal(ctx2.window.DailyRoutine.manager.getLatestReport().overall_harmony_score, 91.0, 'User 2 has their own report');
  assert.equal(ctx2.window.DailyRoutine.manager.getLatestSnapshot(), 'data:image/jpeg;base64,user2photo');
  console.log('✓ User 2 data saved independently.');

  console.log('--- TEST 7: User 2 logs out, User 1 logs back in ---');
  const ctx1Return = createDOMContext(sharedStorage, user1);
  vm.runInNewContext(dailySource, ctx1Return.sandbox);

  await ctx1Return.window.VisionAuth.ready;
  await new Promise(r => setTimeout(r, 50));

  assert.equal(ctx1Return.window.DailyRoutine.manager.isUnlocked(), true, 'User 1 is still unlocked');
  assert.equal(ctx1Return.window.DailyRoutine.manager.getLatestReport().overall_harmony_score, 82.5, 'User 1 has their original report (82.5, not 91.0)');
  assert.equal(ctx1Return.window.DailyRoutine.manager.getLatestSnapshot(), 'data:image/jpeg;base64,user1photo');
  assert.equal(ctx1Return.window.DailyRoutine.manager.getStreakInfo().streak, 1, 'User 1 maintains streak 1');
  console.log('✓ User 1 data restored intact without interference from User 2.');

  console.log('\n===========================================');
  console.log('ALL ACCOUNT ISOLATION TESTS PASSED 100%!');
  console.log('===========================================');
}

run().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
