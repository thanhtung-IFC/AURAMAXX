const assert = require('node:assert/strict');
(async () => {
  const { CaptureStability } = await import('../frontend/js/face/capture-stability.js');
  const face = (x=.5,width=.3) => {
    const points = Array.from({length:478},()=>({x,y:.5,z:0}));
    points[234].x=x-width/2; points[454].x=x+width/2;
    return points;
  };
  let gate = new CaptureStability();
  let result;
  for (let time=0;time<=700;time+=100) result=gate.update(face(),0,time,true);
  assert.equal(result.stable,true,'settled face accepted');
  result=gate.update(face(),0,800,false);
  assert.equal(result.progress,0,'lost quality resets window');
  gate=new CaptureStability();
  for(let time=0;time<=900;time+=100) {
    result=gate.update(face(.5+time/100*.006),0,time,true);
    assert.equal(result.stable,false,'slow continuous drift rejected');
  }
  gate=new CaptureStability();
  gate.update(face(),0,0,true);
  result=gate.update(face(),0,1000,true);
  assert.equal(result.progress,0,'gap is not counted as stable time');
  for(let time=1100;time<=1700;time+=100) result=gate.update(face(),0,time,true);
  assert.equal(result.stable,true,'settles again after gap');
  result=gate.update(face(),9,1800,true);
  assert.equal(result.stable,false,'pose jump resets window');
  console.log('PASS: capture stability, slow drift, pose changes, gaps and quality resets.');
})().catch(error=>{console.error(error);process.exitCode=1;});
