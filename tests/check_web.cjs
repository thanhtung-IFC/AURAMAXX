
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'real_time_face_landmark_liveness_tracker.html'), 'utf8');
assert.equal(html, fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
  if (script[1].trim()) new vm.Script(script[1]);
}
function section(start, end) {
  const pos = html.indexOf(start);
  assert(pos >= 0, start);
  const endPos = html.indexOf(end, pos + start.length);
  assert(endPos > pos, end);
  return html.slice(pos, endPos);
}
const silent = { log() {}, warn() {}, error() {} };
function ui() {
  return { innerText: '', innerHTML: '', disabled: false, className: '', classList: { add() {}, remove() {} } };
}
function context(extra) {
  return vm.createContext({ console: silent, ...extra });
}
const uploadSource = section('    async function handleImageUpload(e)', '    function displayAnalysisReport');
const points = Array.from({length: 478}, (_, i) => ({ x: i / 478, y: 0.2, z: 0 }));
async function uploadCase(mode) {
  let captured = null, closed = 0;
  const messages = [];
  const c = context({
    isUploadingImage: false, isAnalyzingSnapshot: false,
    latestLandmarks: [{x: 99, y: 99}],
    FileReader: class {
      readAsDataURL() { this.result = 'data:image/jpeg;base64,fixture'; this.onload(); }
    },
    Image: class {
      constructor() { this.naturalWidth = 1200; this.naturalHeight = 900; }
      set src(value) { mode === 'decode-error' ? this.onerror() : this.onload(); }
    },
    createFaceMeshEngine() {
      return {
        onResults(cb) { this.cb = cb; },
        async initialize() { if (mode === 'init-error') throw new Error('init failed'); },
        async send() {
          if (mode === 'send-error') throw new Error('send failed');
          c.latestLandmarks = [{x: 88, y: 88}]; // Camera update during image inference.
          this.cb({ multiFaceLandmarks: mode === 'no-face' ? [] : [points] });
        },
        async close() { closed++; }
      };
    },
    async captureAndAnalyzeFace(...args) { captured = args; },
    showToast(message, type) { messages.push({message, type}); }
  });
  vm.runInContext(uploadSource, c);
  const target = { files: [{}], value: 'file' };
  await c.handleImageUpload({target});
  assert.equal(target.value, '');
  assert.equal(c.isUploadingImage, false);
  assert.equal(closed, mode === 'decode-error' ? 0 : 1);
  if (mode === 'success') {
    assert(captured);
    assert.equal(captured[1].length, 478);
    assert.equal(captured[1][0].x, points[0].x);
    assert.equal(captured[2], 1200);
    assert.equal(captured[3], 900);
  } else {
    assert.equal(captured, null);
    assert(messages.some(m => m.type === 'error'));
  }
}
async function payloadCase(profile) {
  let payload;
  const c = context({
    isAnalyzingSnapshot: false, isPythonBackendAvailable: true, PYTHON_BACKEND_URL: 'http://localhost:8000',
    cancelProfileAutoCapture() {},
    frontalCaptureData: {image: 'frontal', landmarks: points, width: 1200, height: 900},
    profileCaptureData: profile ? {image: 'profile', landmarks: points} : null,
    canvasElement: {width: 640, height: 480},
    btnRunMultiViewAnalysis: ui(), showToast() {},
    async fetch(url, options) {
      payload = JSON.parse(options.body);
      return {ok: true, async json() {return {success: true};}};
    },
    runClientMultiViewAnalysis() {throw new Error('unexpected client fallback');},
    currentAnalysisReport: null, currentSnapshotImage: null, currentModalActiveTab: '',
    displayAnalysisReport() {}, updateCaptureStepUI() {}
  });
  vm.runInContext(section('    async function triggerMultiViewAnalysis()', '    // Hàm tương thích ngược'), c);
  await c.triggerMultiViewAnalysis();
  assert.equal(payload.width, 1200);
  assert.equal(payload.height, 900);
  if (profile) {
    assert(payload.frontal && payload.profile);
    assert.equal(payload.image, undefined);
  } else {
    assert.equal(payload.image, 'frontal');
    assert.equal(payload.landmarks.length, 478);
    assert.equal(payload.frontal, undefined);
  }
  assert.equal(c.isAnalyzingSnapshot, false);
}
async function setupCase() {
  let closed = 0;
  const c = context({
    faceMesh: null, faceMeshSetupPromise: null,
    aiStatusText: ui(), aiIndicator: ui(), showToast() {}, handleMeshResults() {},
    FaceMesh: class {
      setOptions() {} onResults() {}
      async initialize() {throw new Error('wasm unavailable');}
      async close() {closed++;}
    }
  });
  vm.runInContext(section('    function createFaceMeshEngine()', '    function updateCameraSyncUI()'), c);
  assert.equal(await c.setupFaceMeshEngine(), null);
  assert.equal(c.faceMesh, null);
  assert.equal(c.faceMeshSetupPromise, null);
  assert.equal(closed, 1);
  assert.equal(c.aiStatusText.innerText, 'Lỗi nạp mô hình AI');
}
async function frameCase() {
  const callbacks = [];
  let draws = 0, sends = 0;
  const c = context({
    isCameraActive: true, isProcessingFrame: false, frameCallbackId: null,
    inferenceFrameCanvas: null, lastInferenceVideoTime: -1,
    document: {createElement() {return {getContext() {return {drawImage() {}};}};}},
    videoElement: {readyState: 2, paused: false, ended: false, videoWidth: 640, videoHeight: 480},
    canvasElement: {width: 640, height: 480},
    canvasCtx: {save() {}, restore() {}, clearRect() {}, drawImage() {draws++;}},
    chkShowGuideLines: {checked: false}, drawOvalAlignmentGuide() {},
    faceMesh: {async send() {sends++; throw new Error('WebGL failed');}, async close() {}},
    cancelProfileAutoCapture() {}, updateCaptureTracking() {},
    latestLandmarks: points, matchCard: ui(), aiIndicator: ui(), aiStatusText: ui(),
    faceStatusBadge: ui(), lblLatency: ui(), performance: {now: () => 1},
    showToast() {}, updateFpsCounter() {}, cancelAnimationFrame() {},
    requestAnimationFrame(cb) {callbacks.push(cb); return callbacks.length;}
  });
  vm.runInContext(section('    function startFrameProcessingLoop()', '    async function startCameraStream'), c);
  c.startFrameProcessingLoop();
  await callbacks.shift()();
  assert.equal(c.faceMesh, null);
  assert.equal(c.latestLandmarks, null);
  assert.equal(c.isProcessingFrame, false);
  assert.equal(c.aiStatusText.innerText, 'Lỗi xử lý AI');
  await callbacks.shift()();
  assert.equal(draws, 2);
  assert.equal(sends, 1);
  assert(callbacks.length > 0);
}
async function captureCase() {
  const c = context({
    latestLandmarks: null, canvasElement: {width: 640, height: 480},
    cancelProfileAutoCapture() {},
    frontalCaptureData: null, profileCaptureData: {image: 'old profile'},
    imgThumbFrontal: ui(), placeholderFrontal: ui(), checkFrontalDone: ui(), btnRetakeFrontal: ui(),
    imgThumbProfile: ui(), placeholderProfile: ui(), checkProfileDone: ui(), btnRetakeProfile: ui(),
    captureStep: 1, updateCaptureStepUI() {}, async triggerMultiViewAnalysis() {},
    async captureCurrentStepShot() {}
  });
  vm.runInContext(section('    async function captureAndAnalyzeFace(', '    // ========================================================================='), c);
  await c.captureAndAnalyzeFace('image', points, 1200, 900);
  assert.equal(c.profileCaptureData, null);
  assert.equal(c.frontalCaptureData.width, 1200);
  assert.equal(c.frontalCaptureData.height, 900);
  assert.equal(c.frontalCaptureData.landmarks.length, 478);
  await assert.rejects(c.captureAndAnalyzeFace('image', null), /khuôn mặt/);
}

function startupCase() {
  const ids = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map(m => m[1]));
  const nodes = new Map(), events = [];
  function node() {
    return { listeners: [], hidden: false,
      getContext() { return {}; },
      addEventListener(name, handler) { this.listeners.push({name, handler}); },
      classList: {add() {}, remove() {}},
      getBoundingClientRect() { return {width:640, height:480}; }
    };
  }
  function get(id) {
    if (!ids.has(id)) return null;
    if (!nodes.has(id)) nodes.set(id, node());
    return nodes.get(id);
  }
  get('outputCanvas').parentElement = node();
  const c = context({
    document: {readyState:'loading', getElementById:get, querySelector:get},
    window: {
      location: {origin:'http://localhost:8000',protocol:'http:',hostname:'localhost',port:'8000'},
      addEventListener(name, handler) {events.push({name, handler});}
    },
    navigator: {mediaDevices: {addEventListener() {}}},
    performance: {now:()=>0}, localStorage: {getItem:()=>null}
  });
  const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].at(-1)[1];
  vm.runInContext(script, c);
  assert(events.some(e=>e.name==='DOMContentLoaded' && e.handler===c.initApp),
    'Startup must reach initApp registration without a ReferenceError');
  const capture = get('btnCaptureCurrentStep').listeners.filter(e=>e.name==='click');
  assert.equal(capture.length, 1, 'Capture must not execute twice for the same click');
  let hidden = false;
  get('modalAnalysisReport').classList.add = name => {hidden = name==='hidden';};
  c.closeAnalysisReport();
  assert(hidden);
}

(async () => {
  startupCase();
  for (const mode of ['success', 'no-face', 'decode-error', 'init-error', 'send-error']) await uploadCase(mode);
  await payloadCase(false);
  await payloadCase(true);
  await setupCase();
  await frameCase();
  await captureCase();
  console.log('PASS: HTML syntax/sync, image isolation/dimensions, no-face/decode/init/send failures, single/multi-view payloads, camera continuity, stale profile reset.');
})().catch(error => {console.error(error); process.exitCode = 1;});


