
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function section(start,end) {
  const a=html.indexOf(start),b=html.indexOf(end,a+start.length);
  assert(a>=0&&b>a,start); return html.slice(a,b);
}
function face(yaw=0) {
  const pts=Array.from({length:478},()=>({x:.5,y:.5,z:0}));
  const angle=yaw*Math.PI/180;
  function point(i,x,y,z=0) {
    pts[i]={x:.5+x*Math.cos(angle)+z*Math.sin(angle),y,z:-x*Math.sin(angle)+z*Math.cos(angle)};
  }
  point(234,-.2,.5);point(454,.2,.5);
  point(1,0,.48,-.08);point(10,0,.2);point(152,0,.8);
  point(33,-.12,.4);point(263,.12,.4);
  return pts;
}
function element() {
  return {innerText:'',classList:{add(){},remove(){}},style:{},src:''};
}
function rig() {
  let now=0, analyses=0;
  const messages=[],timers=new Map(),nodes=new Map();
  const frameCanvas={width:0,height:0,label:'',
    getContext(){return {drawImage:image=>{frameCanvas.label=image.label;}};},
    toDataURL(){return 'jpeg:'+this.label;}};
  const c=vm.createContext({
    Math, Number, console, performance:{now:()=>now},
    calcDistance:(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,(a.z||0)-(b.z||0)),
    document:{getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},
      createElement(){return frameCanvas;}},
    videoElement:{videoWidth:640,videoHeight:480},canvasElement:{width:640,height:480},
    captureFrame:null,captureFrameCanvas:null,captureStableSince:null,captureStableFrames:0,
    previousCapturePose:null,profileCaptureArmed:false,profileArmTimeout:null,
    CAPTURE_STABLE_MS:600,CAPTURE_MAX_AGE_MS:300,
    captureStep:2,frontalCaptureData:{deviceId:'camera',poseYaw:5},profileCaptureData:null,
    activeCameraDeviceId:'camera',activeCameraLabel:'Camera',isCameraActive:true,
    isAnalyzingSnapshot:false,isUploadingImage:false,latestLandmarks:null,isMirrored:true,
    lblBtnCapture:element(),lblCaptureGuide:element(),
    imgThumbFrontal:element(),placeholderFrontal:element(),btnRetakeFrontal:element(),checkFrontalDone:element(),
    imgThumbProfile:element(),placeholderProfile:element(),btnRetakeProfile:element(),checkProfileDone:element(),
    setTimeout(cb){const id=timers.size+1;timers.set(id,cb);return id;},
    clearTimeout(id){timers.delete(id);},
    showToast(message,type){messages.push({message,type});},
    triggerShutterFlash(){}, updateCaptureStepUI(){c.resetCaptureStability();},
    async triggerMultiViewAnalysis(){analyses++;}
  });
  vm.runInContext(section('    function calculateHeadPose(', '    // Trích xuất vector'),c);
  vm.runInContext(section('    function evaluateCapturePose(', '    function updateCaptureStepUI()'),c);
  vm.runInContext(section('    async function captureCurrentStepShot(', '    function retakeStepShot('),c);
  return {c,timers,messages,nodes,
    now(value){now=value;},
    feed(yaw,time,label='paired-frame'){
      now=time;
      const points=face(yaw);
      c.latestLandmarks=points;
      c.updateCaptureTracking(points,{width:640,height:480,label});
    },
    analyses(){return analyses;}
  };
}
function overlayCase() {
  const images=[], labels=[], drawings=[];
  const guide=[{x:20,y:20},{x:50,y:60},{x:70,y:90}];
  const c=vm.createContext({
    currentAnalysisReport:{visual_guides:{thirds_lines:[{name:'front-only',y:10}]},
      profile:{visual_guides:{eline:guide,nasolabial_rays:guide,jaw_profile_triangle:guide}}},
    currentSnapshotImage:'front-image',currentModalActiveTab:'frontal',
    frontalCaptureData:{landmarks:face(0)},profileCaptureData:{landmarks:face(25)},
    Image:class {constructor(){this.width=640;this.height=480;images.push(this);} set src(value){this.url=value;}},
    snapshotReportCanvas:{width:0,height:0},chkModalShowLines:{checked:true},chkModalShowPoints:{checked:true},
    snapshotCtx:{clearRect(){},drawImage(img){drawings.push(img.url);},beginPath(){},moveTo(){},lineTo(){},
      stroke(){},setLineDash(){},closePath(){},arc(){},fill(){},fillText(label){labels.push(label);}}
  });
  vm.runInContext(section('    function drawReportCanvasOverlay()', '    function switchModalView('),c);
  c.drawReportCanvasOverlay();
  c.currentModalActiveTab='profile';c.currentSnapshotImage='profile-image';
  c.drawReportCanvasOverlay();
  images[0].onload();
  assert.equal(drawings.length,0,'A late frontal image must not overwrite the profile tab');
  images[1].onload();
  assert.deepEqual(drawings,['profile-image']);
  assert.equal(labels.length,3,'Profile overlay must draw its three guides');
  assert(!labels.includes('front-only'),'Never draw frontal guides over a profile image');
}
async function run() {
  overlayCase();
  const r=rig(),c=r.c;
  for(const yaw of [-40,-25,0,25,40]) assert(Math.abs(c.calculateHeadPose(face(yaw)).yaw-yaw)<=1);
  assert(c.evaluateCapturePose(face(0),1).ready);
  assert(!c.evaluateCapturePose(face(20),1).ready);
  for(const yaw of [-25,25])assert(c.evaluateCapturePose(face(yaw),2).ready);
  for(const yaw of [0,-60,60])assert(!c.evaluateCapturePose(face(yaw),2).ready);
  assert(!c.evaluateCapturePose(null,2).ready);
  assert(c.evaluateCapturePose(face(25),2,5).ready);
  const cropped=face(25);cropped[10].y=-.01;
  assert(!c.evaluateCapturePose(cropped,2).ready);
  const rolled=face(25);rolled[263].y=.6;
  assert(!c.evaluateCapturePose(rolled,2).ready);

  await c.captureCurrentStepShot(); // Arm before turning.
  assert(c.profileCaptureArmed);
  for(let i=0;i<6;i++)r.feed(25,i*100);
  assert.equal(c.profileCaptureData,null,'Cannot capture before stability duration');
  r.feed(25,600,'stable-camera-frame');
  await Promise.resolve();
  assert(c.profileCaptureData,'Capture automatically while face is still tracked');
  assert.equal(c.profileCaptureData.image,'jpeg:stable-camera-frame');
  assert.equal(c.profileCaptureData.landmarks[1].x,face(25)[1].x,'Mirror display must not flip saved image or coordinates');
  assert.equal(c.profileCaptureData.relativeYaw,20);
  assert.equal(c.profileCaptureArmed,false);
  assert.equal(r.timers.size,0);
  assert.equal(r.analyses(),1);
  r.feed(25,700);
  assert.equal(r.analyses(),1,'One capture per armed request');

  const lost=rig();
  await lost.c.captureCurrentStepShot();
  for(let i=0;i<5;i++)lost.feed(25,i*100);
  lost.now(450);lost.c.latestLandmarks=null;lost.c.updateCaptureTracking(null);
  assert.equal(lost.c.captureFrame,null,'Never retain a frame after face loss');
  lost.feed(25,600);
  assert.equal(lost.c.profileCaptureData,null,'Stability must restart after face loss');
  assert.equal(lost.c.captureStableFrames,1);
  for(let i=1;i<=6;i++)lost.feed(25,600+i*100);
  assert(lost.c.profileCaptureData,'Recover tracking and capture');

  const stale=rig();
  for(let i=0;i<=6;i++)stale.feed(25,i*100);
  stale.now(1000);
  await stale.c.captureCurrentStepShot();
  assert.equal(stale.c.profileCaptureData,null,'Cannot capture expired landmarks');
  stale.c.cancelProfileAutoCapture();

  const movement=rig();
  for(let i=0;i<5;i++)movement.feed(25,i*100);
  movement.feed(35,500);
  assert.equal(movement.c.captureStableFrames,1,'Rotation must restart stability');
  movement.feed(35,900);
  assert.equal(movement.c.captureStableFrames,1,'Long frame gap must restart stability');

  const changed=rig();
  for(let i=0;i<=6;i++)changed.feed(25,i*100);
  changed.c.activeCameraDeviceId='different-camera';
  await changed.c.captureCurrentStepShot();
  assert.equal(changed.c.profileCaptureData,null,'Cannot mix cameras');

  const cancel=rig();
  await cancel.c.captureCurrentStepShot();
  cancel.c.cancelProfileAutoCapture();
  for(let i=0;i<=6;i++)cancel.feed(25,i*100);
  assert.equal(cancel.c.profileCaptureData,null,'Cancel must prevent automatic capture');
  const timeout=rig();
  await timeout.c.captureCurrentStepShot();
  [...timeout.timers.values()][0]();
  assert.equal(timeout.c.profileCaptureArmed,false,'Auto capture must time out');

  const front=rig();
  front.c.captureStep=1;
  for(let i=0;i<=6;i++)front.feed(0,i*100,'frontal-frame');
  await front.c.captureCurrentStepShot();
  assert.equal(front.c.captureStep,2);
  assert.equal(front.c.frontalCaptureData.poseYaw,0);
  assert.equal(front.c.frontalCaptureData.image,'jpeg:frontal-frame');
  assert.equal(front.c.profileCaptureData,null);
  console.log('PASS: pose rotation/calibration, both directions, crop/roll rejection, stable auto-capture, paired frames, loss/recovery, stale frames, movement, camera switch, cancel/timeout, frontal capture.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});

