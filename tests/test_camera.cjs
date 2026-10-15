const assert = require('node:assert/strict');
(async () => {
  const { openCamera, fittedFrame, CameraWorkload, CameraConfigurator } = await import('../frontend/js/face/camera.js');
  const { performanceHint } = await import('../frontend/js/performance.js');
  function device(capabilities={}, initial={width:1280,height:720,frameRate:24}, rejectConfiguration=false) {
    let settings={...initial}, stops=0;
    const configurations=[];
    const track={getCapabilities:()=>capabilities,getSettings:()=>settings,stop:()=>stops++,applyConstraints:async constraints=>{
      configurations.push(constraints);
      if(rejectConfiguration)throw new DOMException('Unsupported','OverconstrainedError');
      settings={...settings,width:constraints.width?.ideal||settings.width,height:constraints.height?.ideal||settings.height};
    }};
    return {stream:{getTracks:()=>[track],getVideoTracks:()=>[track]},track,configurations,get stops(){return stops;}};
  }
  const capable=device({width:{max:3840},height:{max:2160},focusMode:['continuous'],exposureMode:['continuous']});
  const calls=[];
  let opened=await openCamera({mediaDevices:{getUserMedia:async c=>{calls.push(c);return capable.stream;}}});
  assert.equal(calls[0].audio,false);
  assert.deepEqual([opened.settings.width,opened.settings.height],[1920,1080],'capable camera uses Full HD');
  assert.equal(capable.configurations[1].width.ideal,1920,'focus controls preserve negotiated resolution');
  assert.equal(capable.configurations[1].advanced[0].focusMode,'continuous');
  const portrait=device({width:{max:1080},height:{max:1920}},{width:720,height:1280});
  opened=await openCamera({mediaDevices:{getUserMedia:async()=>portrait.stream}});
  assert.deepEqual([opened.settings.width,opened.settings.height],[1080,1920],'portrait stream preserves orientation');
  const old=device(); delete old.track.getCapabilities; delete old.track.applyConstraints;
  opened=await openCamera({mediaDevices:{getUserMedia:async()=>old.stream}});
  assert.equal(opened.stream,old.stream,'older camera APIs stay usable');
  const failedUpgrade=device({width:{max:1920},height:{max:1080}},undefined,true);
  opened=await openCamera({mediaDevices:{getUserMedia:async()=>failedUpgrade.stream}});
  assert.equal(opened.settings.width,1280,'failed upgrade retains usable stream');
  let attempts=0;
  await assert.rejects(openCamera({mediaDevices:{getUserMedia:async()=>{attempts++;throw new DOMException('Busy','NotReadableError');}}}),{name:'NotReadableError'});
  assert.equal(attempts,1,'busy camera does not loop permission/open requests');
  const fallback=device(), selections=[];
  opened=await openCamera({deviceId:'disconnected',mediaDevices:{getUserMedia:async c=>{
    selections.push(c.video);
    if(selections.length===1){const error=new DOMException('Gone','OverconstrainedError');error.constraint='deviceId';throw error;}
    return fallback.stream;
  }}});
  assert.equal(opened.fallback,true);
  assert.equal(selections[1].deviceId,undefined);
  const same=device(), constraints=[];
  await openCamera({deviceId:'usb',mediaDevices:{getUserMedia:async c=>{
    constraints.push(c.video);if(constraints.length===1){const error=new DOMException('FPS','OverconstrainedError');error.constraint='frameRate';throw error;}return same.stream;
  }}});
  assert.equal(constraints[1].deviceId.exact,'usb','configuration fallback keeps chosen camera');
  await assert.rejects(openCamera({strictFacing:true,facingMode:'environment',mediaDevices:{getUserMedia:async c=>{
    assert.equal(c.video.facingMode.exact,'environment');const error=new DOMException('No rear camera','OverconstrainedError');error.constraint='facingMode';throw error;
  }}}),/không cung cấp camera/,'missing rear camera is reported instead of silently reusing front');
  const controller=new AbortController(), late=device(); let release;
  const pending=openCamera({signal:controller.signal,mediaDevices:{getUserMedia:()=>new Promise(resolve=>release=resolve)}});
  await new Promise(resolve=>setImmediate(resolve)); controller.abort();
  await assert.rejects(pending,{name:'AbortError'});
  release(late.stream); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(late.stops,1,'late permission grant releases cancelled stream');
  const configuring=device({width:{max:1920},height:{max:1080}}), configureAbort=new AbortController();let finishConfiguration;
  configuring.track.applyConstraints=()=>new Promise(resolve=>finishConfiguration=resolve);
  const configuration=openCamera({signal:configureAbort.signal,mediaDevices:{getUserMedia:async()=>configuring.stream}});
  await new Promise(resolve=>setImmediate(resolve));configureAbort.abort();
  assert.ok(configuring.stops>=1,'cancel releases hardware while applyConstraints is pending');
  finishConfiguration();await assert.rejects(configuration,{name:'AbortError'});
  assert.deepEqual(fittedFrame(1080,1920,960),{width:540,height:960});
  assert.deepEqual(fittedFrame(640,480,1920),{width:640,height:480},'never upscale capture');
  const workload=new CameraWorkload({now:0});let time=0;
  for(let i=0;i<3;i++){workload.observe(900,{now:time});time+=100;}
  for(let i=0;i<30;i++){workload.observe(10,{now:time});time+=100;}
  assert.equal(workload.phase,'ready');
  assert.equal(workload.tier,'quality','warmup spikes excluded from initial calibration');
  workload.observe(600,{now:time});time+=100;
  for(let i=0;i<15;i++){workload.observe(10,{now:time});time+=100;}
  assert.equal(workload.tier,'quality','brief spike does not cause tier oscillation');
  for(let i=0;i<35;i++){workload.observe(180,{now:time});time+=200;}
  assert.equal(workload.tier,'economy','sustained pressure lowers tier');
  for(let i=0;i<20;i++){workload.observe(10,{now:time});time+=200;}
  assert.equal(workload.tier,'economy','recovery waits for sustained evidence');
  for(let i=0;i<180;i++){workload.observe(10,{now:time});time+=200;}
  assert.equal(workload.longestEdge,960,'sustained recovery restores detail');
  workload.observe(NaN); workload.reset({mode:'economy',now:0});
  for(let i=0;i<80;i++)workload.observe(1,{now:i*100});
  assert.equal(workload.tier,'economy','manual choice stays fixed');
  workload.setLiveness(true,8000);
  assert.equal(workload.interval,66,'liveness retains normal sampling cadence');
  assert.equal(workload.longestEdge,640,'liveness retains input detail');
  workload.setLiveness(false,8100);
  assert.equal(workload.interval,125,'economy cadence returns after liveness');
  workload.reset({now:0});
  for(let i=0;i<40;i++)workload.observe(10,{now:i*100,uiDelay:90});
  assert.equal(workload.tier,'economy','UI pressure influences calibration even with fast inference');
  assert.equal(performanceHint({hardwareConcurrency:4}),'economy');
  assert.equal(performanceHint({hardwareConcurrency:8,deviceMemory:8}),'balanced','hardware hints never assume high performance');
  assert.equal(performanceHint({}),'balanced','missing RAM/core APIs are supported');
  const serial=device({}, {width:1920,height:1080}), originalApply=serial.track.applyConstraints;
  let releaseFirst,active=0,maxActive=0;
  serial.track.applyConstraints=async c=>{active++;maxActive=Math.max(maxActive,active);if(!releaseFirst)await new Promise(resolve=>releaseFirst=resolve);await originalApply(c);active--;};
  const configurator=new CameraConfigurator(serial.track);
  const first=configurator.configure({height:1080,frameRate:30});
  await new Promise(resolve=>setImmediate(resolve));
  const skipped=configurator.configure({height:720,frameRate:20});
  const last=configurator.configure({height:720,frameRate:24});
  releaseFirst();await Promise.all([first,skipped,last]);
  assert.equal(maxActive,1,'camera configuration never overlaps');
  assert.equal(serial.configurations.length,2,'rapid changes coalesce to the latest selection');
  assert.equal(serial.configurations.at(-1).frameRate.max,24);
  const stopped=device(), stoppedConfigurator=new CameraConfigurator(stopped.track);
  const queued=stoppedConfigurator.configure({height:720});stoppedConfigurator.close();
  assert.equal(await queued,false);assert.equal(stopped.configurations.length,0,'stop discards queued configuration');
  console.log('PASS: camera negotiation/cancellation, timed calibration, hysteresis, manual modes, UI load, liveness cadence, hardware hints and serialized configuration.');
})().catch(error=>{console.error(error);process.exitCode=1;});
