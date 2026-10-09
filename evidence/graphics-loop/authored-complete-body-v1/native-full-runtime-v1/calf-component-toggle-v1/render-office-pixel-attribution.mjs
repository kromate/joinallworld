import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../');
const fixture = here;
const htmlPath = path.join(here, 'office-pixel-attribution-v1.html');
const bundlePath = path.join(fixture, 'office-pixel-attribution-v1.bundle.js');
const relativeHtml = path.relative(repo, htmlPath).split(path.sep).join('/');
const runId = (process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
const resultDir = path.join(here, '../remote-results', `office-pixel-attribution-${runId}`);
const chromeBin = process.env.CHROME_BIN ?? ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
  .map((name) => spawnSync('which', [name], { encoding: 'utf8' })).find((result) => result.status === 0)?.stdout.trim();
if (!chromeBin) throw new Error('Set CHROME_BIN to the remote runner Chrome/Chromium executable');
await stat(bundlePath).catch(() => { throw new Error('Fixture bundle is missing; run bundle-office-pixel-attribution.mjs first'); });
  await mkdir(resultDir, { recursive: true });

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'], ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'], ['.glb', 'model/gltf-binary'], ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
]);
const server = createServer(async (request, response) => {
  try {
    const requested = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
    const filename = path.resolve(repo, `.${requested}`);
    if (!filename.startsWith(`${repo}${path.sep}`)) throw new Error('Path escaped repository root');
    const bytes = await readFile(filename);
    response.writeHead(200, { 'content-type': mime.get(path.extname(filename).toLowerCase()) ?? 'application/octet-stream', 'cache-control': 'no-store', 'content-length': bytes.length });
    response.end(bytes);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
});
server.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
const port = server.address().port;
const profile = await mkdir(path.join(os.tmpdir(), `trouser-sock-trim-ab-${runId}`), { recursive: false }).then(() => path.join(os.tmpdir(), `trouser-sock-trim-ab-${runId}`));
const args = [
  '--headless=new', '--no-sandbox', '--renderer-process-limit=1', '--disable-extensions', '--disable-background-networking',
  '--disable-dev-shm-usage', '--disable-gpu-sandbox', '--remote-debugging-port=0', '--remote-allow-origins=*',
  '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  '--no-first-run', '--no-default-browser-check', '--window-size=1440,1120', `--user-data-dir=${profile}`, 'about:blank',
];
const chrome = spawn(chromeBin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeStderr = '';
chrome.stderr.on('data', (chunk) => { chromeStderr = (chromeStderr + chunk.toString()).slice(-10000); });
const requestedUrls = new Map();
const failedRequests = [];
const consoleErrors = [];
const pending = new Map();
let socket;
let nextId = 0;

async function debugPort() {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 200; attempt++) {
    try { return Number((await readFile(portFile, 'utf8')).split('\n')[0]); }
    catch { if (chrome.exitCode !== null) throw new Error(`Chrome exited (${chrome.exitCode}): ${chromeStderr}`); await delay(100); }
  }
  throw new Error(`Chrome DevTools port not available: ${chromeStderr}`);
}
function cdp(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { if (pending.delete(id)) reject(new Error(`CDP timeout ${method}`)); }, 15000);
    pending.set(id, { resolve: (value) => { clearTimeout(timeout); resolve(value); }, reject: (error) => { clearTimeout(timeout); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const value = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (value.exceptionDetails) throw new Error(value.exceptionDetails.text ?? JSON.stringify(value.exceptionDetails));
  if (value.result?.subtype === 'error') throw new Error(value.result.description ?? 'Browser evaluation failed');
  return value.result?.value;
}
async function ready() {
  const deadline = Date.now() + 100000;
  let state = 'loading';
  while (Date.now() < deadline) {
    state = await evaluate('window.officePixelAttribution?.readyState ?? "loading"').catch(() => 'loading');
    if (state === 'ready' || state === 'failed') return state;
    await delay(200);
  }
  return state;
}
async function capturePixelAttribution() {
  const data = await evaluate('window.officePixelAttribution.inspectScreenPixel(543, 165)');
  const dataUrl = await evaluate('document.querySelector("#stage").toDataURL("image/png")');
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) throw new Error('Direct canvas capture did not return a PNG data URL');
  const bytes = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
  const file = 'female-office-idle-front.png';
  await writeFile(path.join(resultDir, file), bytes);
  return { data, image: { file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } };
}

async function stopChrome() {
  if (chrome.exitCode === null) chrome.kill('SIGTERM');
  if (chrome.exitCode === null) await Promise.race([new Promise((resolve) => chrome.once('exit', resolve)), delay(2000)]);
  if (chrome.exitCode === null) { chrome.kill('SIGKILL'); await Promise.race([new Promise((resolve) => chrome.once('exit', resolve)), delay(2000)]); }
}
let result;
try {
  const wsPort = await debugPort();
  const targetResponse = await fetch(`http://127.0.0.1:${wsPort}/json/new?about:blank`, { method: 'PUT' });
  assert.ok(targetResponse.ok, `Chrome target creation failed: ${targetResponse.status}`);
  const target = await targetResponse.json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.id && pending.has(message.id)) {
      const item = pending.get(message.id); pending.delete(message.id);
      if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails?.text ?? 'browser exception');
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
    if (message.method === 'Network.requestWillBeSent') requestedUrls.set(message.params.requestId, message.params.request.url);
    if (message.method === 'Network.loadingFailed') failedRequests.push({ url: requestedUrls.get(message.params.requestId) ?? null, errorText: message.params.errorText, canceled: message.params.canceled ?? false });
  });
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1120, deviceScaleFactor: 1, mobile: false });
  const pageUrl = `http://127.0.0.1:${port}/${relativeHtml}`;
  await cdp('Page.navigate', { url: pageUrl });
  const readyState = await ready();
  assert.equal(readyState, 'ready', `pixel attribution viewer failed: ${await evaluate('document.querySelector("#status")?.textContent').catch(String)}`);
  await delay(300);
  const sample = await capturePixelAttribution();
  const passed = sample.data.state === 'pixel-attribution' && sample.data.sourceBodyHit !== null
    && sample.data.activeGarmentHit !== null && Number.isInteger(sample.data.sourceBodyHit.sourceFaceIndex)
    && sample.data.garmentDistanceBehindBodyMetres !== null && sample.image.bytes > 1000
    && failedRequests.length === 0 && consoleErrors.length === 0;
  result = {
    status: passed ? 'PASS' : 'FAIL', diagnosticOnly: true, pageUrl,
    requestedPagePixel: [543, 165], sample: sample.data, image: sample.image,
    failedRequests, consoleErrors, chrome: spawnSync(chromeBin, ['--version'], { encoding: 'utf8' }).stdout.trim(),
    limitations: ['Single female-office idle/front pixel only.', 'A ray proves local geometry depth, not that a hide patch improves the rendered image.', 'No other poses, camera angles, outfits, or production integration are covered.'],
  };
  await writeFile(path.join(resultDir, 'office-pixel-attribution-review.json'), `${JSON.stringify(result, null, 2)}\n`);
  if (!passed) throw new Error(`Office pixel attribution gate failed: ${JSON.stringify({ sample: sample.data, failedRequests, consoleErrors })}`);
  console.log(JSON.stringify({ status: result.status, resultDir, sourceFaceIndex: sample.data.sourceBodyHit.sourceFaceIndex, garmentFaceIndex: sample.data.activeGarmentHit.faceIndex }));
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  result = { ...(result ?? {}), status: 'FAIL', error: message, failedRequests, consoleErrors, chromeStderr };
  await writeFile(path.join(resultDir, 'office-pixel-attribution-review.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.error(message);
  process.exitCode = 1;
} finally {
  socket?.close();
  await stopChrome();
  server.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 12, retryDelay: 100 });
}
