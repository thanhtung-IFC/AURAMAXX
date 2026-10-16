/* Run the actual worker bridge and worker message handler with a synthetic detector. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const realModel=process.env.FACE_TEST_REAL_MODEL==='1';
const detector=`export async function createDirectLandmarker(){return {detect(){const end=performance.now()+90;while(performance.now()<end){}return {faceLandmarks:[[{x:.5,y:.5,z:0}]]};},detectForVideo(bitmap,timestamp){return this.detect(bitmap);},close(){}};}`;
let testResult=null;
let modelDiagnostic='';
const server=http.createServer((request,response)=>{
  if(request.url.startsWith('/diagnostic?')){modelDiagnostic=new URL(request.url,'http://local').searchParams.get('message');response.end('ok');return;}
  if(request.url.startsWith('/result?')){testResult=new URL(request.url,'http://local').searchParams.get('value');response.end('ok');return;}
  if(request.url==='/js/face/landmarker.js'&&realModel){response.setHeader('Content-Type','application/javascript');response.end(`import {createDirectLandmarker as actual} from './real-landmarker.js';export async function createDirectLandmarker(mode){try{return await actual(mode)}catch(error){await fetch('/diagnostic?message='+encodeURIComponent(error.stack||String(error)));throw error;}}`);return;}
  if(request.url==='/js/face/real-landmarker.js'){response.setHeader('Content-Type','application/javascript');response.end(fs.readFileSync(path.join(root,'frontend/js/face/landmarker.js')));return;}
  if(request.url==='/js/face/landmarker.js'&&!realModel){response.setHeader('Content-Type','application/javascript');response.end(detector);return;}
  if(request.url.startsWith('/js/face/')){
    const file=path.resolve(root,'frontend',request.url.slice(1));
    if(!file.startsWith(path.join(root,'frontend','js','face')+path.sep)||!fs.existsSync(file)){response.writeHead(404).end();return;}
    response.setHeader('Content-Type','application/javascript');response.end(fs.readFileSync(file));return;
  }
  response.setHeader('Content-Type','text/html; charset=utf-8');
  response.end(`<!doctype html><body><script type="module">
  import {createWorkerLandmarker} from '/js/face/landmarker-worker-client.js';
  import {sampleFrameLight} from '/js/face/analysis.js';
  import {FaceAcquisition} from '/js/face/face-acquisition.js';
  const check=(condition,label)=>{if(!condition)throw new Error(label)};
  try {
    const lit=document.createElement('canvas');lit.width=100;lit.height=100;
    const lightContext=lit.getContext('2d');lightContext.fillStyle='#fff';lightContext.fillRect(0,0,100,100);lightContext.fillStyle='#444';lightContext.fillRect(25,25,50,50);
    const points=Array.from({length:478},()=>({x:.5,y:.5,z:0}));points[10].y=.25;points[152].y=.75;points[234].x=.25;points[454].x=.75;
    const sample=document.createElement('canvas');
    const faceLight=sampleFrameLight(lit,sample,points),wholeLight=sampleFrameLight(lit,sample);
    check(faceLight.mean<80&&wholeLight.mean>180,'bright background does not hide a dark face');
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;
    const model=await createWorkerLandmarker('VIDEO');
    let heartbeats=0;const heartbeat=setInterval(()=>heartbeats++,5);
    const request=model.detectForVideo(canvas,1);
    let busy=false;try{await model.detectForVideo(canvas,2)}catch{busy=true}
    check(busy,'no overlapping inference');
    const result=await request;
    check(${realModel} ? result.faceLandmarks.length===0 : result.faceLandmarks[0][0].x===.5,'landmarks transferred');
    if(!${realModel})check(heartbeats>=4,'UI thread stays responsive during expensive detection');
    clearInterval(heartbeat);
    let invalid=false;try{await model.detect(null)}catch{invalid=true}
    check(invalid,'invalid input rejected');
    await model.detectForVideo(canvas,3);
    const pending=model.detectForVideo(canvas,4);model.close();
    let stopped=false;try{await pending}catch(error){stopped=error.name==='AbortError'}
    check(stopped,'close cancels pending bitmap or inference');
    model.close();
    const imageModel=await createWorkerLandmarker('IMAGE');
    const imageResult=await imageModel.detect(canvas);
    check(${realModel} ? imageResult.faceLandmarks.length===0 : imageResult.faceLandmarks[0][0].x===.5,'IMAGE mode works');
    if(${realModel}){
      const response=await fetch('https://storage.googleapis.com/mediapipe-assets/portrait.jpg');
      check(response.ok,'official portrait fixture downloads');
      const bitmap=await createImageBitmap(await response.blob());
      const portrait=document.createElement('canvas');portrait.width=bitmap.width;portrait.height=bitmap.height;
      portrait.getContext('2d').drawImage(bitmap,0,0);bitmap.close();
      const acquisition=new FaceAcquisition();
      check((await acquisition.detectImage(imageModel,portrait)).faceLandmarks.length===1,'real face passes anatomical validation');
      const dimPortrait=document.createElement('canvas');dimPortrait.width=portrait.width;dimPortrait.height=portrait.height;
      const context=dimPortrait.getContext('2d');context.drawImage(portrait,0,0);context.fillStyle='rgba(0,0,0,.8)';context.fillRect(0,0,portrait.width,portrait.height);
      check((await acquisition.detectImage(imageModel,dimPortrait)).faceLandmarks.length===1,'real face is detected with simulated low light');
      acquisition.release();
    }
    imageModel.close();
    const dim=document.createElement('canvas');dim.width=128;dim.height=128;
    const dimContext=dim.getContext('2d'),gradient=dimContext.createLinearGradient(0,0,128,128);
    gradient.addColorStop(0,'#111');gradient.addColorStop(1,'#444');dimContext.fillStyle=gradient;dimContext.fillRect(0,0,128,128);
    const mesh=Array.from({length:478},()=>({x:.5,y:.5,z:0}));
    for(const [i,x,y] of [[10,.5,.2],[152,.5,.8],[234,.3,.5],[454,.7,.5],[33,.38,.4],[263,.62,.4],[61,.44,.66],[291,.56,.66]])mesh[i]={x,y,z:0};
    const intensity=input=>input.getContext('2d').getImageData(64,64,1,1).data[0];
    const before=intensity(dim),times=[];
    const recovery=new FaceAcquisition();
    const dimDetector={detectForVideo:async(input,time)=>{times.push(time);return {faceLandmarks:intensity(input)>70?[mesh]:[]};}};
    const recovered=await recovery.detectForVideo(dimDetector,dim,10,640);
    check(recovered.faceLandmarks.length===1&&times.length===2&&times[1]>times[0],'real canvas exposure recovery and increasing timestamps');
    check(intensity(dim)===before,'recovery preserves original capture pixels');
    check((await recovery.detectForVideo(dimDetector,dim,110,640)).faceLandmarks.length===1&&times.length===3,'low-light recovery persists without extra passes');
    recovery.release();
    document.body.dataset.result='PASS';document.body.textContent='Worker bridge passed';
  }catch(error){document.body.dataset.result='FAIL: '+error.message;}
  await fetch('/result?value='+encodeURIComponent(document.body.dataset.result));
  </script></body>`);
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const output=path.join(root,'.test-output');fs.mkdirSync(output,{recursive:true});
  const profile=fs.mkdtempSync(path.join(output,'face-worker-'));
  try {
    const edge=spawn(process.env.EDGE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      ['--headless=new','--disable-gpu','--disable-extensions','--no-first-run','--no-default-browser-check','--user-data-dir='+profile,'--remote-debugging-port=0','http://127.0.0.1:'+server.address().port],
      {windowsHide:true,stdio:['ignore','pipe','pipe']});
    let dom='',diagnostics='';edge.stdout.on('data',data=>dom+=data);edge.stderr.on('data',data=>diagnostics+=data);
    try {
      const deadline=Date.now()+(realModel?75000:25000);
      while(!testResult&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,40));
      assert.equal(testResult,'PASS',(testResult||'Worker browser timed out: '+diagnostics.slice(-500))+' '+modelDiagnostic);
    }finally{edge.kill();}
    console.log(realModel?'PASS: real MediaPipe VIDEO/IMAGE in Web Worker, official portrait and dimmed portrait, geometry validation, exposure recovery and cancellation.':'PASS: actual Web Worker, bitmap transfer, UI responsiveness, single inference, recovery, cancellation and face light sampling.');
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
