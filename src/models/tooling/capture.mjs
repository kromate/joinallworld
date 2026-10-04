// Adapted from the user-supplied parity/shots/shot.mjs headless CDP workflow.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root=process.cwd(),out=resolve(root,'src/models/evidence'),cache=resolve(root,'src/models/.cache');
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
  const args=process.argv.slice(2),interactions=args.includes('--interactions'),requests=args.filter(a=>!a.startsWith('--'));const cases=requests.length?requests:['vehicles:street:grid'];const report=[];
  for(const entry of cases){
    const [category,detail,mode='grid',type='',time='day',skin='skin-7']=entry.split(':');const query=new URLSearchParams({category,detail,capture:'1',time,skin});
    if(mode==='grid')query.set('grid','1');else if(['hair','outfit'].includes(mode))query.set('sheet',mode);if(type)query.set('type',type);
    const start=errors.length;await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
    await cdp('Page.navigate',{url:'http://127.0.0.1:3400/models.html?'+query});
    let ready;for(let i=0;i<180;i++){ready=await run('document.body?.dataset.ready');if(ready==='true'||ready==='error')break;await sleep(100);}
    if(ready!=='true')throw new Error(await run('document.getElementById("error")?.textContent')||`Preview failed: ${entry}`);
    const height=await run('Math.min(16000,document.documentElement.scrollHeight)');await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height,deviceScaleFactor:1,mobile:false});await sleep(250);
    const before=await run('document.body.dataset.renderCount');await sleep(200);const after=await run('document.body.dataset.renderCount');
    const metrics=await run('Array.from(document.querySelectorAll(".tile")).map(t=>({name:t.querySelector("h2").textContent,metrics:t.querySelector(".metrics").textContent}))');
    const png=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});const name=entry.replaceAll(':','-');await writeFile(resolve(out,name+'.png'),Buffer.from(png.data,'base64'));
    const result={name,height,idle:before===after,models:metrics,errors:errors.slice(start)};report.push(result);console.log(JSON.stringify(result));
  }
  if(interactions){
    const waitReady=async()=>{for(let i=0;i<180;i++){if(await run('document.body.dataset.ready === "true"'))return;await sleep(50);}throw new Error('Control rebuild did not finish');};
    await cdp('Page.navigate',{url:'http://127.0.0.1:3400/models.html?category=environment&type=kiosk'});await sleep(100);await waitReady();
    const baseMemory=await run('document.body.dataset.gpuGeometries');
    for(let i=0;i<6;i++){await run('document.querySelector("[data-detail=showcase]").click()');await waitReady();await run('document.querySelector("[data-detail=street]").click()');await waitReady();}
    const endMemory=await run('document.body.dataset.gpuGeometries');if(baseMemory!==endMemory)throw new Error(`Geometry leak: ${baseMemory} -> ${endMemory}`);
    await run('document.querySelector("[data-category=people]").click()');await waitReady();
    const personMemory=await run('document.body.dataset.gpuGeometries');
    await run('document.getElementById("pose").value="walk";document.getElementById("pose").dispatchEvent(new Event("input"));document.getElementById("phase").value=".4";document.getElementById("phase").dispatchEvent(new Event("input"))');
    if(personMemory!==await run('document.body.dataset.gpuGeometries'))throw new Error('Pose changed geometry allocation');
    await run('document.querySelector("[data-category=geo]").click()');await waitReady();
    await run('document.getElementById("model").value="nigeria";document.getElementById("model").dispatchEvent(new Event("change"))');await waitReady();
    await run('document.getElementById("feature").value="NG-LA";document.getElementById("feature").dispatchEvent(new Event("change"));document.getElementById("zoom").checked=true');
    for(const value of [0,.5,1]){await run(`document.getElementById('phase').value='${value}';document.getElementById('phase').dispatchEvent(new Event('input'))`);const shot=await cdp('Page.captureScreenshot',{format:'png'});await writeFile(resolve(out,`transition-nigeria-lagos-${value}.png`),Buffer.from(shot.data,'base64'));}
    await run('document.getElementById("open-region").click()');await waitReady();const regionTitle=await run('document.querySelector(".tile h2").textContent');if(regionTitle!=='Lagos')throw new Error(`Region drilldown failed: ${regionTitle}`);
    await run('document.getElementById("whole-map").click()');await waitReady();
    await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await sleep(100);
    const overflow=await run('document.documentElement.scrollWidth>window.innerWidth');if(overflow)throw new Error('Mobile preview overflows horizontally');
    const mobile=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(resolve(out,'mobile-preview.png'),Buffer.from(mobile.data,'base64'));
    const proof={geometryMemory:{before:baseMemory,after:endMemory},personPoseReusesGeometry:true,regionDrilldown:regionTitle,mobileHorizontalOverflow:overflow,errors};
    if(errors.length)throw new Error(errors.join('\n'));await writeFile(resolve(out,'interaction-results.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
  }
  let previous=[];try{previous=JSON.parse(await readFile(resolve(out,'capture-results.json'),'utf8'));}catch{}
  const byName=new Map(previous.map(item=>[item.name,item]));for(const item of report)byName.set(item.name,item);
  await writeFile(resolve(out,'capture-results.json'),JSON.stringify([...byName.values()],null,2));
}finally{ws?.close();chrome.kill();await sleep(150);await rm(profile,{recursive:true,force:true});}
