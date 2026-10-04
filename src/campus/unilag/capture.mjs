/** Dev-only screenshot probe adapted from the parity owner's shots/shot.mjs.
 * A private Chromium instance, no server session, no user-browser profile.
 */
import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const output=fileURLToPath(new URL('./evidence/',import.meta.url));mkdirSync(output,{recursive:true});
const profile=mkdtempSync(output+'.chromium-');
const bin='/Users/anthonyakpan/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const chrome=spawn(bin,['--remote-debugging-port=3419',`--user-data-dir=${profile}`,'--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--hide-scrollbars','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const errors=[];let ws;
try{
 let targets;for(let i=0;i<40;i++){try{targets=await(await fetch('http://127.0.0.1:3419/json')).json();break;}catch{await sleep(100);}}
 if(!targets)throw Error('Private Chromium did not start');
 ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 let id=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.id&&pending.has(m.id)){pending.get(m.id)(m.result??m.error);pending.delete(m.id);}};
 const cdp=(method,params={})=>new Promise(r=>{pending.set(++id,r);ws.send(JSON.stringify({id,method,params}));});
 const run=async expression=>{const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;};
 await cdp('Runtime.enable');await cdp('Page.enable');
 await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
 await cdp('Page.navigate',{url:'http://127.0.0.1:3410/campus.html'});
 for(let i=0;i<50;i++){if(await run('Boolean(globalThis.campusPreview)'))break;await sleep(100);}
 const shot=async name=>{await sleep(180);const r=await cdp('Page.captureScreenshot',{format:'png'});writeFileSync(output+name+'.png',Buffer.from(r.data,'base64'));};
 const initial=await run('({stats:campusPreview.campus.stats(),frames:campusPreview.frames})');await sleep(600);
 const idle=await run('({frames:campusPreview.frames,idle:campusPreview.idle})');
 await shot('main-gate-day');
 const matrix=[];
 const places=process.argv.includes('--all')?['main-gate','cafeteria','senate','sports-centre','medical-centre','engineering','second-gate','dli','lagoon-front','library','access-bank','mariere-hall','auditorium']:['senate','library','cafeteria','lagoon-front'];
 for(const place of places)for(const time of process.argv.includes('--all')?['day','night']:['day']){
   const record=await run(`(()=>{const p=campusPreview;p.jump(${JSON.stringify(place)});p.setTime(${JSON.stringify(time)});return {stats:p.campus.stats(),render:p.renderer.info.render,position:p.campus.position};})()`);
   matrix.push({place,time,...record});await shot(place+'-'+time);
 }
 await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await run("campusPreview.jump('senate');campusPreview.setTime('day');campusPreview.draw()");await shot('phone-senate');
 const phone=await run('({scroll:document.documentElement.scrollWidth,width:innerWidth,stats:campusPreview.renderer.info.render})');
 const report={initial,idle,phone,matrix,errors};writeFileSync(output+'render-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{ws?.close();chrome.kill();await new Promise(r=>chrome.once('exit',r));rmSync(profile,{recursive:true,force:true});}
