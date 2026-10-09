import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const out = 'evidence/graphics-loop/expressive-character-v1/results'; mkdirSync(out, { recursive: true });
const profile = mkdtempSync(path.join(tmpdir(), 'allworld-face-'));
const server = spawn(process.execPath, ['--max-old-space-size=192', 'evidence/graphics-loop/expressive-character-v1/serve.mjs'], { stdio: ['ignore', 'inherit', 'inherit'] });
const chrome = spawn(process.env.CHROME_BIN || '/usr/bin/google-chrome', ['--headless=new', '--no-sandbox', '--renderer-process-limit=1', '--disable-extensions', '--disable-background-networking', '--disable-dev-shm-usage', '--disable-gpu-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'inherit', 'inherit'] });
let chromeError = null;
chrome.on('error', error => { chromeError = error; });
let ws, id = 0; const pending = new Map(), errors = [], network = [], cases = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function retry(url) { for (let i = 0; i < 100; i++) { try { const r = await fetch(url); if (r.ok) return r; } catch {} await wait(100); } throw new Error(`Timeout: ${url}`); }
function send(method, params = {}) { return new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); ws.send(JSON.stringify({ id: key, method, params })); setTimeout(() => { if (pending.has(key)) { pending.delete(key); reject(new Error(`CDP timeout ${method}`)); } }, 20000).unref(); }); }
async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; }
let failure = null;
try {
  const page = process.env.STATIC_PREVIEW === '1' ? '/character-preview.html' : '/evidence/graphics-loop/expressive-character-v1/index.html';
  await retry('http://127.0.0.1:5197' + page);
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) {
    if (chromeError) throw chromeError;
    if (chrome.exitCode !== null) throw new Error(`Chrome exited ${chrome.exitCode}`);
    await wait(100);
  }
  const port = Number(readFileSync(portFile, 'utf8').split('\n')[0]);
  if (!Number.isInteger(port) || port <= 0) throw new Error('Invalid Chrome port');
  const targets = await (await retry(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.addEventListener('message', event => { const m = JSON.parse(event.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p?.reject(new Error(JSON.stringify(m.error))); else p?.resolve(m.result); } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails); else if (m.method === 'Network.loadingFinished') network.push(m.params); });
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 780, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:5197' + page });
  for (let i = 0; i < 200 && !(await evaluate('!!window.characterReady')); i++) { if (errors.length) throw new Error(JSON.stringify(errors)); await wait(100); }
  if (!(await evaluate('!!window.characterReady'))) throw new Error('Character never became ready');
  for (const body of ['woman', 'man']) for (const expression of ['neutral', 'grin']) for (const focus of ['head', 'body']) {
    const name = `${body}-${expression}-${focus}`;
    await evaluate(`window.characterReview.set(${JSON.stringify({ body, expression, focus, pose: focus === 'body' ? 'walk' : 'idle' })})`);
    await evaluate('window.characterReview.sample(0.4, -0.2)');
    const screenshot = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${out}/${name}.png`, Buffer.from(screenshot.data, 'base64'));
    cases.push({ name, ...(await evaluate('window.characterReview.snapshot()')) });
    if (focus === 'head' && expression === 'grin') {
      await evaluate('window.characterReview.sample(0.4, Math.PI / 2)');
      const image = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${out}/${body}-grin-profile.png`, Buffer.from(image.data, 'base64'));
    }
  }
  await evaluate("window.characterReview.set({body:'woman',expression:'smile',focus:'head',pose:'walk'})");
  await evaluate("document.querySelector('#play').click()");
  await wait(4700);
  const moving = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${out}/woman-smile-moving.png`, Buffer.from(moving.data, 'base64'));
  await wait(1600);
  cases.push({ name: 'woman-smile-6-second-play', ...(await evaluate('window.characterReview.snapshot()')) });
  const settled = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${out}/woman-smile-settled.png`, Buffer.from(settled.data, 'base64'));
  if (errors.length) throw new Error('Browser exceptions');
} catch (error) { failure = String(error.stack || error); }
finally {
  ws?.close(); for (const process of [chrome, server]) { process.kill('SIGTERM'); await Promise.race([new Promise(resolve => process.once('exit', resolve)), wait(1000)]); if (process.exitCode === null) process.kill('SIGKILL'); }
  rmSync(profile, { recursive: true, force: true });
  writeFileSync(`${out}/review.json`, JSON.stringify({ commit: process.env.GITHUB_SHA, status: failure ? 'failed' : 'captured-awaiting-visual-review', failure, cases, errors, encodedTransferBytes: network.reduce((sum, item) => sum + item.encodedDataLength, 0), caveat: 'Remote SwiftShader developer preview; timings and dev transfers are not mobile/release measurements.', cleanup: 'Owned browser/server terminated and profile removed' }, null, 2));
}
if (failure) throw new Error(failure);
