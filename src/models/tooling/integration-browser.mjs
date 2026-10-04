// Adapted from the user-supplied parity/shots/shot.mjs headless CDP workflow.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root=process.cwd(),out=resolve(root,'src/models/evidence/integration'),cache=resolve(root,'src/models/.cache');
await mkdir(out,{recursive:true});await mkdir(cache,{recursive:true});
const profile=await mkdtemp(resolve(cache,'model-chrome-'));
const chrome=spawn('/Users/anthonyakpan/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell',
  ['--remote-debugging-port=3409',`--user-data-dir=${profile}`,'--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--hide-scrollbars','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let ws;
try{
  let targets;for(let i=0;i<40;i++){try{targets=await(await fetch('http://127.0.0.1:3409/json')).json();break;}catch{await sleep(100);}}
  if(!targets)throw new Error('Private screenshot browser did not start');
  ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let id=0;const pending=new Map(),errors=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m.result??m.error);pending.delete(m.id);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);};
  const cdp=(method,params={})=>new Promise((r,j)=>{const requestId=++id;const timeout=setTimeout(()=>{pending.delete(requestId);j(new Error(`CDP timeout: ${method}`));},30000);pending.set(requestId,result=>{clearTimeout(timeout);r(result);});ws.send(JSON.stringify({id:requestId,method,params}));});
  const run=async expression=>{const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description);return r.result?.value;};
  await cdp('Runtime.enable');await cdp('Page.enable');

  const base='http://127.0.0.1:3401';
  const session=await fetch(base+'/api/session',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({name:'Models QA',onboarding:true})});
  if(!session.ok)throw new Error('Guest session could not open');
  const cookie=session.headers.get('set-cookie').split(';')[0],cookieName=cookie.slice(0,cookie.indexOf('=')),secret=cookie.slice(cookie.indexOf('=')+1);
  if(cookieName!=='models_sid')throw new Error('Integration cookie is not isolated');
  const headers={'Content-Type':'application/json',Origin:base,Cookie:cookie};
  const act=async(type,payload)=>{const response=await fetch(base+'/api/action',{method:'POST',headers,body:JSON.stringify({actionId:Date.now()+":"+crypto.randomUUID(),cityId:'lagos',type,payload})});const result=await response.json();if(!result.ok)throw new Error(type+': '+JSON.stringify(result));return result;};
  await fetch(base+'/api/life?city=lagos',{headers});
  for(const [type,payload] of [['onboarding.look',{look:{body:'woman',hair:'braids',outfit:'casual',fabric:'ankara',skin:'skin-5',hairColor:'black',outfitColor:'green',bottomsColor:'navy'}}],['onboarding.traits',{traits:['musical','tech-bro-or-sis']}],['onboarding.dream',{dream:'yaba-unicorn'}],['onboarding.lottery',{}],['onboarding.home',{house:'yaba'}]])await act(type,payload);
  const initial=await (await fetch(base+'/api/life?city=lagos',{headers})).json().then(x=>({name:x.state.name,cash:x.state.cash,look:x.state.onboarding.look}));
  await cdp('Network.enable');await cdp('Network.setCookie',{name:cookieName,value:secret,domain:'127.0.0.1',path:'/',httpOnly:true});
  await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await cdp('Page.navigate',{url:base+'/'+(process.env.MODEL_QA_QUERY||'')});await sleep(2500);
  const shot=async name=>{const png=await cdp('Page.captureScreenshot',{format:'png'});await writeFile(resolve(out,name+'.png'),Buffer.from(png.data,'base64'));};
  await shot(process.env.MODEL_QA_QUERY?'fallback-home':'home');
  const inspect=()=>run('({text:document.body.innerText.slice(0,5000),buttons:Array.from(document.querySelectorAll("button")).filter(b=>b.getBoundingClientRect().width>0).map(b=>({text:b.innerText,action:b.dataset.action,panel:b.dataset.panel,aria:b.getAttribute("aria-label"),id:b.id})),world:{...document.querySelector(".wm")?.dataset},geography:{...document.querySelector(".wm-model-stage")?.dataset}})');
  console.log(JSON.stringify(await inspect()));
  const steps=process.argv[2]?JSON.parse(await readFile(process.argv[2],'utf8')):[];const evidence=[];
  for(const step of steps){if(step.size)await cdp('Emulation.setDeviceMetricsOverride',{width:step.size[0],height:step.size[1],deviceScaleFactor:1,mobile:step.size[0]<600});if(step.action)await act(step.action,step.payload||{});let result;if(step.js){result=await run(step.js);console.log(step.name,JSON.stringify(result));}if(step.drag){const rect=await run('(()=>{const r=document.querySelector(".wm-model-canvas").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');await cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:rect.x,y:rect.y,button:'left',clickCount:1});await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:rect.x+65,y:rect.y,button:'left',buttons:1});await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:rect.x+65,y:rect.y,button:'left',clickCount:1});}await sleep(step.wait??600);if(step.name)await shot(step.name);const snapshot=await inspect();evidence.push({step:step.name,result,...snapshot});console.log(JSON.stringify({step:step.name,...snapshot}));}
  await cdp('Page.reload');await sleep(1600);const persisted=await run('fetch("/api/life?city=lagos").then(r=>r.json()).then(x=>({name:x.state?.name,location:x.state?.location,cash:x.state?.cash,look:x.state?.onboarding?.look}))');
  if(persisted.name!==initial.name||JSON.stringify(persisted.look)!==JSON.stringify(initial.look))throw new Error('Identity/look did not survive reload');
  if(process.env.MODEL_QA_LOCATION&&persisted.location!==process.env.MODEL_QA_LOCATION)throw new Error('Arrival did not persist');
  await writeFile(resolve(out,process.env.MODEL_QA_QUERY?'fallback-results.json':'browser-results.json'),JSON.stringify({cookieIsolated:true,errors,initial,persisted,steps:evidence},null,2));
  console.log(JSON.stringify({errors,persisted,cookieIsolated:true}));if(errors.length)throw new Error(errors.join('\n'));
}finally{ws?.close();chrome.kill();await sleep(150);await rm(profile,{recursive:true,force:true});}
