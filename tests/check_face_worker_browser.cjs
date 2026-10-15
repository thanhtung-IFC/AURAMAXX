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
    imageModel.close();
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
    console.log(realModel?'PASS: real MediaPipe VIDEO/IMAGE in Web Worker, bitmap transfer, recovery, cancellation and face light sampling.':'PASS: actual Web Worker, bitmap transfer, UI responsiveness, single inference, recovery, cancellation and face light sampling.');
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
