import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const out = 'evidence/graphics-loop/authored-complete-body-v1/results'; mkdirSync(out, { recursive: true });
const profile = mkdtempSync(path.join(tmpdir(), 'allworld-face-'));
const server = spawn(process.execPath, ['--max-old-space-size=192', 'evidence/graphics-loop/authored-complete-body-v1/serve.mjs'], { stdio: ['ignore', 'inherit', 'inherit'] });
const chrome = spawn(process.env.CHROME_BIN || '/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--renderer-process-limit=1', '--disable-extensions', '--disable-background-networking', '--disable-dev-shm-usage', '--disable-gpu-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'inherit', 'inherit'] });
let chromeError = null;
chrome.on('error', error => { chromeError = error; });
let ws, id = 0; const pending = new Map(), errors = [], network = [], requests = new Map(), cases = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function retry(url) { for (let i = 0; i < 100; i++) { try { const r = await fetch(url); if (r.ok) return r; } catch {} await wait(100); } throw new Error(`Timeout: ${url}`); }
function send(method, params = {}) { return new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); ws.send(JSON.stringify({ id: key, method, params })); setTimeout(() => { if (pending.has(key)) { pending.delete(key); reject(new Error(`CDP timeout ${method}`)); } }, 20000).unref(); }); }
async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; }
let failure = null;
try {
  const page = process.env.STATIC_PREVIEW === '1' ? '/character-preview.html' : '/evidence/graphics-loop/authored-complete-body-v1/index.html';
  await retry('http://127.0.0.1:5199' + page);
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 300 && !existsSync(portFile); i++) {
    if (chromeError) throw chromeError;
    if (chrome.exitCode !== null) throw new Error(`Chrome exited ${chrome.exitCode}`);
    await wait(100);
  }
  const port = Number(readFileSync(portFile, 'utf8').split('\n')[0]);
  if (!Number.isInteger(port) || port <= 0) throw new Error('Invalid Chrome port');
  const targets = await (await retry(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.addEventListener('message', event => { const m = JSON.parse(event.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p?.reject(new Error(JSON.stringify(m.error))); else p?.resolve(m.result); } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails); else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push({consoleError:m.params.args}); else if (m.method === 'Network.requestWillBeSent') requests.set(m.params.requestId, new URL(m.params.request.url).protocol); else if (m.method === 'Network.loadingFinished') network.push({ ...m.params, protocol: requests.get(m.params.requestId) }); });
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 780, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:5199' + page });
  for (let i = 0; i < 200 && !(await evaluate('!!window.characterReady')); i++) { if (errors.length) throw new Error(JSON.stringify(errors)); await wait(100); }
  if (!(await evaluate('!!window.characterReady'))) throw new Error('Character never became ready');
  async function capture(name) {
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${out}/${name}.png`, Buffer.from(screenshot.data, 'base64'));
    const snapshot = await evaluate('window.characterReview.snapshot()');
    const frames = snapshot.frames; delete snapshot.frames;
    cases.push({ name, ...snapshot, frameSamples: frames.length });
  }
  for (const body of ['woman', 'man']) {
    if(process.env.REST_ONLY==='1'){
      await evaluate(`window.characterReview.set(${JSON.stringify({body,expression:'neutral',pose:'rest',focus:'body'})})`);
      for(const [label,angle]of [['front',-.2],['profile',Math.PI/2]]){
        await evaluate(`window.characterReview.sample(0,${angle})`);await capture(body+'-native-rest-'+label);
      }
      await evaluate("window.characterReview.set({focus:'head'})");
      await evaluate('window.characterReview.sample(0,-.2)');await capture(body+'-native-rest-face');
      continue;
    }
    await evaluate(`window.characterReview.set(${JSON.stringify({ body, expression: 'grin', pose: 'idle', focus: 'body' })})`);
    for (const [angleName, angle] of [['front', -.2], ['profile', Math.PI / 2]]) {
      await evaluate(`window.characterReview.sample(.4, ${angle})`);
      await capture(body + '-idle-' + angleName);
    }
    for (const pose of ['walk']) {
      await evaluate(`window.characterReview.set(${JSON.stringify({pose})})`);
      for (const [frameName, time, angle] of [['front-a', .25, -.2], ['front-b', .8, -.2], ['profile', .55, Math.PI / 2]]) {
        await evaluate(`window.characterReview.sample(${time}, ${angle})`);
        await capture(body + '-' + pose + '-' + frameName);
      }
    }
    for (const pose of ['sit','interact','cook','eat','drink']) {
      await evaluate(`window.characterReview.set(${JSON.stringify({pose,expression:'neutral',focus:'body'})})`);
      await evaluate('window.characterReview.sample(.4,1.5707963267948966)');
      await capture(body+'-'+pose+'-profile');
    }
    await evaluate("window.characterReview.set({pose:'idle', focus:'head'})");
    for (const expression of ['neutral', 'grin', 'blink', 'talk']) {
      await evaluate(`window.characterReview.set(${JSON.stringify({expression})})`);
      await evaluate('window.characterReview.sample(.4, -.2)');
      await capture(body + '-face-' + expression);
    }
    if(body==='woman')for(const hairMode of ['singlepass','cutout']){
      await evaluate(`window.characterReview.set(${JSON.stringify({hairMode,expression:'neutral',focus:'head'})})`);
      await evaluate('window.characterReview.sample(.4,-.2)');await capture('woman-hair-'+hairMode);
    }
    if(body==='woman'){
      await evaluate("window.characterReview.set({hairMode:'solidcurl',expression:'neutral',focus:'head'})");
      await evaluate('window.characterReview.sample(.4,-.2)');await capture('woman-solid-curls-front');
      await evaluate('window.characterReview.sample(.4,1.5707963267948966)');await capture('woman-solid-curls-profile');
    }
    await evaluate("window.characterReview.set({outfit:'office',motionMode:'actions',pose:'idle',focus:'body',expression:'neutral'})");
    for(const [label,angle]of [['front',-.2],['profile',Math.PI/2]]){
      await evaluate(`window.characterReview.sample(.4,${angle})`);await capture(body+'-office-idle-'+label);
    }
    await evaluate("window.characterReview.set({pose:'sit'})");
    await evaluate('window.characterReview.sample(.4,1.5707963267948966)');await capture(body+'-office-sit-profile');
    await evaluate("window.characterReview.set({outfit:'casual',motionMode:'sourceclip',focus:'body',expression:'neutral'})");
    for(const sourceClip of ['jog','dance','cook','eat','drink','sit','lie-down']){
      await evaluate(`window.characterReview.set(${JSON.stringify({sourceClip})})`);
      await evaluate(`window.characterReview.sample(${sourceClip==='lie-down'?2.0:.5},1.5707963267948966)`);
      await capture(body+'-source-'+sourceClip+'-profile');
    }
    await evaluate("window.characterReview.set({outfit:'casual',motionMode:'actions',hairMode:'source',expression:'talk',pose:'walk',focus:'body'})");
    await evaluate('window.characterReview.sample(0,-.2)');
    await evaluate(`(() => {
      const stream=document.querySelector('#canvas').captureStream(24);
      const chunks=[];
      const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:1000000});
      recorder.addEventListener('dataavailable',event=>{if(event.data.size)chunks.push(event.data);});
      window.motionRecording={stream,recorder,chunks};recorder.start();
    })()`);
    await evaluate("document.querySelector('#play').click()"); await wait(2100);
    await capture(body + '-moving-walk-talk');
    await wait(4200); await capture(body + '-six-second-play');
    const video=await evaluate(`new Promise((resolve,reject)=>{
      const {stream,recorder,chunks}=window.motionRecording;
      recorder.addEventListener('stop',()=>{
        stream.getTracks().forEach(track=>track.stop());
        const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;
        reader.readAsDataURL(new Blob(chunks,{type:'video/webm'}));window.motionRecording=null;
      },{once:true});recorder.stop();
    })`);
    writeFileSync(`${out}/${body}-walk-talk.webm`,Buffer.from(video,'base64'));
  }
  await send('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:true});
  for (const body of ['woman', 'man']) {
    await evaluate(`window.characterReview.set(${JSON.stringify({body,expression:'grin',pose:process.env.REST_ONLY==='1'?'rest':'idle',focus:'body'})})`);
    await capture(body + '-390px-body');
    await evaluate("window.characterReview.set({focus:'head'})");
    await capture(body + '-390px-face');
  }
  if (errors.length) throw new Error('Browser exceptions');
} catch (error) { failure = String(error.stack || error); }
finally {
  ws?.close(); for (const process of [chrome, server]) { process.kill('SIGTERM'); await Promise.race([new Promise(resolve => process.once('exit', resolve)), wait(1000)]); if (process.exitCode === null) process.kill('SIGKILL'); }
  rmSync(profile, { recursive: true, force: true });
  writeFileSync(`${out}/review.json`, JSON.stringify({ commit: process.env.GITHUB_SHA, status: failure ? 'failed' : 'captured-awaiting-visual-review', failure, cases, errors, httpEncodedTransferBytes: network.filter(item => item.protocol === 'http:' || item.protocol === 'https:').reduce((sum, item) => sum + item.encodedDataLength, 0), inlineDataDecodedBytes: network.filter(item => item.protocol === 'data:').reduce((sum, item) => sum + item.encodedDataLength, 0), caveat: 'Remote SwiftShader developer preview; timings and dev transfers are not mobile/release measurements.', cleanup: 'Owned browser/server terminated and profile removed' }, null, 2));
}
if (failure) throw new Error(failure);
