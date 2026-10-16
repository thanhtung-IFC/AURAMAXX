const assert = require('node:assert/strict');

(async () => {
  const { FaceAcquisition, hasFaceGeometry, exposureLookup } = await import('../frontend/js/face/face-acquisition.js');
  const { CaptureStability } = await import('../frontend/js/face/capture-stability.js');
  const face = (yaw = 0) => {
    const points = Array.from({ length: 478 }, () => ({ x: .5, y: .5, z: 0 }));
    for (const [i, x, y] of [[10,.5,.2],[152,.5,.8],[234,.3,.5],[454,.7,.5],
      [33,.38,.4],[263,.62,.4],[1,.5,.51],[61,.44,.66],[291,.56,.66]]) points[i] = { x, y, z: 0 };
    const angle = yaw * Math.PI / 180;
    for (const point of points) { const x = point.x - .5; point.x = .5 + x * Math.cos(angle); point.z = -x * Math.sin(angle); }
    return points;
  };
  const result = points => ({ faceLandmarks: points ? [points] : [] });
  class Canvas {
    constructor() { this.width = 1; this.height = 1; this.writes = 0; }
    getContext() { return this; }
    drawImage(source) { this.source = source; this.exposure = source.exposure; this.corrected = null; this.writes++; }
    getImageData() {
      const data = new Uint8ClampedArray(this.width * this.height * 4);
      for (let pixel = 0; pixel < data.length / 4; pixel++) {
        const value = this.exposure === 'dark' ? 12 + (pixel % 127) / 3 : 35 + pixel % 200;
        data.set([value, value, value, 255], pixel * 4);
      }
      return { data };
    }
    putImageData(image) { this.corrected = image.data; this.writes++; }
  }
  const source = (width = 1920, height = 1080, exposure = 'normal') => Object.assign(new Canvas(), { width, height, exposure });
  const acquisition = () => new FaceAcquisition({ createCanvas: () => new Canvas() });

  for (const yaw of [-40, -20, 0, 20, 40]) for (const ratio of [16/9, 4/3, 9/16]) {
    assert.equal(hasFaceGeometry(face(yaw), ratio), true, `valid face at yaw ${yaw}, aspect ${ratio}`);
  }
  for (const invalid of [null, [], Array(478).fill({ x:.5,y:.5,z:0 }), face().slice(0,467)]) assert.equal(hasFaceGeometry(invalid), false);
  const corrupt = face(); corrupt[200].x = NaN;
  assert.equal(hasFaceGeometry(corrupt), false, 'non-finite landmarks outside pose anchors are rejected');
  const mouth = face(); mouth[61].y = mouth[291].y = .3;
  assert.equal(hasFaceGeometry(mouth), false, 'impossible eye/mouth ordering is rejected');
  assert.equal(hasFaceGeometry(face(), 0), false);

  const dark = source(64,64,'dark'), darkPixels = dark.getImageData().data;
  const lookup = exposureLookup(darkPixels);
  assert.ok(lookup && lookup[35] > 35, 'low-light detail is brightened');
  assert.equal(lookup[0], 0, 'black remains black');
  for (let i=1; i<256; i++) assert.ok(lookup[i] >= lookup[i-1], 'correction preserves intensity order');
  assert.equal(exposureLookup(new Uint8ClampedArray(4096)), null, 'blank images are not amplified');
  assert.equal(exposureLookup(source(64,64).getImageData().data), null, 'ordinary exposure needs no correction');

  let gate = acquisition(), calls = [];
  const original = source();
  const smallFaceDetector = { async detectForVideo(input,time) { calls.push({width:input.width,height:input.height,time}); return result(input.width >= 960 ? face() : null); } };
  assert.equal((await gate.detectForVideo(smallFaceDetector,original,10,640)).faceLandmarks.length, 1, 'higher resolution reacquires a missed face');
  assert.deepEqual(calls.map(call => call.width), [640,960]);
  assert.ok(calls[1].time > calls[0].time, 'retry uses a strictly increasing video timestamp');
  const stable = new CaptureStability();
  for (let time=110; time<=810; time+=100) {
    const found = await gate.detectForVideo(smallFaceDetector,original,time,640);
    assert.equal(found.faceLandmarks.length, 1, 'recovered resolution is held during capture settling');
    stable.update(found.faceLandmarks[0],0,time,true);
  }
  assert.equal(stable.update(face(),0,910,true).stable,true);
  assert.equal(original.writes,0,'original capture image remains untouched');
  assert.ok(calls.every(call => call.width/call.height === 16/9), 'full-frame aspect ratio is preserved');

  gate = acquisition(); calls = [];
  const empty = { async detectForVideo(input,time) { calls.push(time); return result(null); } };
  const dimSource = source(640,480,'dark');
  for (const time of [10,110,210,310,410,510]) await gate.detectForVideo(empty,dimSource,time,640);
  assert.equal(calls.length,8,'at most one extra inference per 500 ms while no face is visible');
  assert.ok(calls.every((time,index) => !index || time > calls[index-1]));
  gate = acquisition(); calls = [];
  await gate.detectForVideo(empty,source(320,240),10,960);
  assert.equal(calls.length,1,'no duplicate inference when resolution and exposure cannot improve');
  assert.equal(gate.inferenceCanvas.width,320,'low resolution cameras are never upscaled');

  gate = acquisition(); let count = 0;
  const group = { async detectForVideo() { count++; return {faceLandmarks:[face(),corrupt]}; } };
  assert.equal((await gate.detectForVideo(group,original,10)).faceLandmarks.length,2,'second face is never filtered away');
  assert.equal(count,1,'multiple faces bypass enhancement');
  gate = acquisition(); count = 0;
  const recoveryGroup = { async detectForVideo() { return ++count===1 ? result(null) : {faceLandmarks:[face(),face(20)]}; } };
  assert.equal((await gate.detectForVideo(recoveryGroup,original,10)).faceLandmarks.length,2,'multiple faces found during recovery still block capture');
  gate = acquisition();
  assert.equal((await gate.detectForVideo({detectForVideo:async()=>result(corrupt)},original,10)).faceLandmarks.length,0,'invalid meshes do not reach matching or capture');
  gate = acquisition();
  await gate.detectForVideo(smallFaceDetector,original,10);
  assert.equal((await gate.detectForVideo(empty,original,110)).faceLandmarks.length,0,'lost face never reuses a previous mesh');

  gate = acquisition(); let resolve;
  const pending = gate.detectForVideo({detectForVideo:()=>new Promise(done=>{resolve=done;})},original,10);
  gate.reset(); resolve(result(face()));
  assert.deepEqual((await pending).faceLandmarks,[],'reset discards in-flight results');
  assert.equal(gate.boostUntil,0,'cancelled inference cannot restore old recovery state');

  gate = acquisition(); count = 0;
  const imageDetector = { async detect(input) { count++; return result(input.corrected ? face() : null); } };
  assert.equal((await gate.detectImage(imageDetector,dimSource)).faceLandmarks.length,1,'uploaded images use the same low-light recovery');
  assert.equal(count,2);
  assert.equal(dimSource.writes,0,'uploaded original remains untouched');
  assert.equal(gate.recoveryCanvas.width,dimSource.width);
  gate.release();
  assert.equal(gate.recoveryCanvas.width,1,'release clears retained image buffers');

  gate = acquisition(); count = 0;
  const dimDetector = { async detectForVideo(input) { count++; return result(input.corrected ? face() : null); } };
  const dimStable = new CaptureStability();
  for (let time=10;time<=810;time+=100) {
    const found = await gate.detectForVideo(dimDetector,dimSource,time,640);
    assert.equal(found.faceLandmarks.length,1,'exposure recovery stays usable on following frames');
    dimStable.update(found.faceLandmarks[0],0,time,true);
  }
  assert.equal(count,10,'recovered low-light tracking needs one pass per subsequent frame');
  assert.equal(dimStable.update(face(),0,910,true).stable,true,'low-light recovery lasts through capture settling');

  assert.deepEqual(new CaptureStability().update(null,0,0,true),{stable:false,progress:0},'incomplete tracking fails safely');
  console.log('PASS: face geometry, exposure correction, bounded recovery, capture settling, full-frame coordinates, groups, cancellation and IMAGE mode.');
})().catch(error=>{console.error(error);process.exitCode=1;});
