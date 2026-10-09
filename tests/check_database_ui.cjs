
'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm');
const html=require('./web_source.cjs')();
function section(start,end) {
 const a=html.indexOf(start),b=html.indexOf(end,a+start.length);assert(a>=0&&b>a,start);return html.slice(a,b);
}
function button() {return {callback:null,addEventListener(event,cb){this.callback=cb;},getAttribute(name){return name==='data-index'?'0':'person-id';}};}
function rig(mode) {
 let saves=0,loads=0,registered=0,lastBody=null;
 const messages=[],del=button(),add=button(),clear=button();
 const c=vm.createContext({
  isCameraActive:true,latestLandmarks:Array.from({length:478},()=>({x:.5,y:.4,z:0})),
  usePythonEngine:true,isPythonBackendAvailable:true,PYTHON_BACKEND_URL:'http://localhost:8000',
  inputPersonName:{value:'New person',focus(){}},
  registeredDatabase:[{id:'person-id',name:'An',date:'12:00:00',sample_count:2}],
  registeredList:{innerHTML:'',appendChild(){},querySelectorAll(selector){return selector==='.btn-delete-user'?[del]:[add];}},
  lblUserCount:{innerText:''},btnClearAllFaces:clear,
  document:{createElement(){return {className:'',innerHTML:''};}},
  escapeHtml:s=>s,showToast(message,type){messages.push({message,type});},
  saveRegisteredFaces(){saves++;},async loadRegisteredFaces(){loads++;},
  extractFaceVector(){return [.1];},
  async fetch(url,options) {
   lastBody=JSON.parse(options.body);
   if(mode==='network')throw new Error('network failure');
   return {ok:mode==='success',async json(){if(mode==='bad-json')throw new Error('invalid response');return {success:mode==='success',message:'database failure'};}};
  }
 });
 vm.runInContext(section('    async function registerCurrentFace(', '    function performFaceMatching('),c);
 vm.runInContext(section('    function renderFaceListUI()', '    async function registerCurrentFace('),c);
 vm.runInContext(section("    btnClearAllFaces.addEventListener('click'", '    btnTriggerChallenge.addEventListener'),c);
 return {c,del,add,clear,messages,saves:()=>saves,loads:()=>loads,body:()=>lastBody};
}
(async()=>{
 for(const mode of ['http-error','network','bad-json']) {
  const r=rig(mode);
  await r.c.registerCurrentFace();
  assert.equal(r.saves(),0,'Backend failure must not silently write LocalStorage');
  assert.equal(r.c.registeredDatabase.length,1);
  assert.equal(r.c.inputPersonName.value,'New person');
  assert(r.messages.some(m=>m.type==='error'));
  r.c.renderFaceListUI();
  await r.del.callback({});
  assert.equal(r.c.registeredDatabase.length,1,'Failed deletion must retain the displayed person');
  assert.equal(r.saves(),0);
  await r.clear.callback();
  assert.equal(r.c.registeredDatabase.length,1,'Failed clear must retain the displayed list');
  assert.equal(r.saves(),0);
 }
 const success=rig('success');
 await success.c.registerCurrentFace({userId:'person-id',name:'An'});
 assert.equal(success.body().user_id,'person-id');
 assert.equal(success.body().name,'An');
 assert.equal(success.loads(),1);
 assert.equal(success.saves(),0);
 success.c.renderFaceListUI();
 assert.equal(success.c.lblUserCount.innerText,'1 người · 2 mẫu');
 await success.del.callback({});
 assert.equal(success.body().id,'person-id');
 assert.equal(success.loads(),2);
 await success.clear.callback();
 assert.deepEqual(success.body(),{});
 assert.equal(success.loads(),3);
 assert.equal(success.saves(),0);
 let added;
 success.c.registerCurrentFace=options=>{added=options;};
 success.add.callback();
 assert.equal(added.userId,'person-id');
 assert.equal(added.name,'An');
 const empty=rig('success');
 empty.c.registeredDatabase[0].sample_count=0;
 let renderedRow;
 empty.c.registeredList.appendChild=row=>{renderedRow=row;};
 empty.c.renderFaceListUI();
 assert.equal(empty.c.lblUserCount.innerText,'1 người · 0 mẫu');
 assert(renderedRow.innerHTML.includes('0 mẫu'),'A profile created in SQL has no face sample yet');
 delete empty.c.registeredDatabase[0].sample_count;
 empty.c.renderFaceListUI();
 assert.equal(empty.c.lblUserCount.innerText,'1 người · 1 mẫu','Legacy local profiles still have one sample');
 console.log('PASS: backend errors never become local successes; add-sample, counts, register/delete/clear reload SQLite state.');
})().catch(e=>{console.error(e);process.exitCode=1;});

