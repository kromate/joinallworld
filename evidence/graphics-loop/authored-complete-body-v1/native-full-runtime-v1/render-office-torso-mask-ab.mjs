import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../');
const bundlePath = path.join(here, 'office-torso-mask-ab.bundle.js');
const htmlRelative = path.relative(repo, path.join(here, 'office-torso-mask-ab.html')).split(path.sep).join('/');
const runId = (process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
const resultDir = path.join(here, 'remote-results', `office-torso-mask-ab-${runId}`);
const chromeBin = process.env.CHROME_BIN ?? ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
  .map((name) => spawnSync('which', [name], { encoding: 'utf8' })).find((result) => result.status === 0)?.stdout.trim();
if (!chromeBin) throw new Error('Set CHROME_BIN to the remote runner Chrome/Chromium executable');
await stat(bundlePath).catch(() => { throw new Error('Fixture bundle missing; run bundle-office-torso-mask-ab.mjs first'); });
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
const profile = await mkdtemp(path.join(os.tmpdir(), 'office-torso-mask-ab-'));
const chromeArgs = [
  '--headless=new', '--no-sandbox', '--renderer-process-limit=1', '--disable-extensions', '--disable-background-networking',
  '--disable-dev-shm-usage', '--disable-gpu-sandbox', '--remote-debugging-port=0', '--remote-allow-origins=*',
  '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  '--no-first-run', '--no-default-browser-check', '--window-size=1440,1120', `--user-data-dir=${profile}`, 'about:blank',
];
const chrome = spawn(chromeBin, chromeArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeStderr = '';
chrome.stderr.on('data', (chunk) => { chromeStderr = (chromeStderr + chunk.toString()).slice(-12000); });
let socket;
let nextId = 0;
let report;
const pending = new Map();
const consoleErrors = [];
const failedRequests = [];
const requestedUrls = new Map();

async function readDebugPort() {
  const file = path.join(profile, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 300; attempt++) {
    try { return Number((await readFile(file, 'utf8')).split('\n')[0]); }
    catch { if (chrome.exitCode !== null) throw new Error(`Chrome exited early (${chrome.exitCode}): ${chromeStderr}`); await delay(100); }
  }
  throw new Error(`Chrome DevTools port did not appear: ${chromeStderr}`);
}
function cdp(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { if (pending.delete(id)) reject(new Error(`CDP timeout: ${method}`)); }, 20000);
    pending.set(id, { resolve: (value) => { clearTimeout(timeout); resolve(value); }, reject: (error) => { clearTimeout(timeout); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const response = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text ?? JSON.stringify(response.exceptionDetails));
  if (response.result?.subtype === 'error') throw new Error(response.result.description ?? 'Browser evaluate failed');
  return response.result?.value;
}
async function capture(name) {
  await delay(350);
  const state = await evaluate('window.officeTorsoMaskAB.sample()');
  const image = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true });
  const bytes = Buffer.from(image.data, 'base64');
  const filename = `${name}.png`;
  await writeFile(path.join(resultDir, filename), bytes);
  return { state, screenshot: { path: filename, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } };
}

try {
  const debugPort = await readDebugPort();
  const targetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' });
  if (!targetResponse.ok) throw new Error(`Chrome target creation failed (${targetResponse.status})`);
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
    if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails?.text ?? 'Browser exception');
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
    if (message.method === 'Network.requestWillBeSent') requestedUrls.set(message.params.requestId, { url: message.params.request.url, method: message.params.request.method });
    if (message.method === 'Network.loadingFailed') failedRequests.push({ ...requestedUrls.get(message.params.requestId), errorText: message.params.errorText, canceled: message.params.canceled ?? false });
  });
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Network.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1120, deviceScaleFactor: 1, mobile: false });
  const pageUrl = `http://127.0.0.1:${port}/${htmlRelative}`;
  await cdp('Page.navigate', { url: pageUrl });
  const deadline = Date.now() + 110000;
  let ready = 'loading';
  while (Date.now() < deadline) {
    ready = await evaluate('window.officeTorsoMaskAB?.readyState ?? "loading"').catch(() => 'loading');
    if (ready === 'ready' || ready === 'failed') break;
    await delay(250);
  }
  if (ready !== 'ready') throw new Error(`A/B viewer not ready (${ready}): ${await evaluate('document.querySelector("#status")?.textContent ?? "no status"').catch(String)}`);

  const captures = [];
  const comparisons = [];
  for (const pose of ['idle', 'walk', 'interact']) for (const view of ['front', 'profile', 'back']) {
    await evaluate(`window.officeTorsoMaskAB.setPose(${JSON.stringify(pose)})`);
    await evaluate(`window.officeTorsoMaskAB.setView(${JSON.stringify(view)})`);
    await evaluate('window.officeTorsoMaskAB.setVariant("existing")');
    const baseline = await capture(`${pose}-${view}-existing`);
    await evaluate('window.officeTorsoMaskAB.setVariant("candidate")');
    const candidate = await capture(`${pose}-${view}-candidate`);
    const a = baseline.state.factory;
    const b = candidate.state.factory;
    assert.equal(a.pose, b.pose, `${pose}/${view} pose must match across A/B`);
    assert.deepEqual(a.actorPosition, b.actorPosition);
    assert.deepEqual(a.actorQuaternion, b.actorQuaternion);
    assert.deepEqual(a.actorScale, b.actorScale);
    assert.deepEqual(a.bodyMatrixWorld, b.bodyMatrixWorld);
    assert.deepEqual(a.candidateMatrixWorld, b.candidateMatrixWorld);
    assert.deepEqual(b.candidateMatrixWorld, b.bodyMatrixWorld);
    assert.deepEqual(a.garmentMatrixWorld, b.garmentMatrixWorld);
    assert.equal(b.bodyTriangles, a.bodyTriangles - 26, 'candidate should hide exactly 26 additional source triangles');
    assert.equal(a.activeBodyVisible, true); assert.equal(a.candidateVisible, false);
    assert.equal(b.activeBodyVisible, false); assert.equal(b.candidateVisible, true);
    captures.push(baseline, candidate);
    comparisons.push({ pose, view, sameActorPoseAndTransforms: true, sameLook: JSON.stringify(baseline.state.look) === JSON.stringify(candidate.state.look), sourceTriangles: a.bodyTriangles, candidateTriangles: b.bodyTriangles, images: [baseline.screenshot, candidate.screenshot] });
  }
  const success = captures.length === 18 && comparisons.every((pair) => pair.sameActorPoseAndTransforms && pair.sameLook)
    && failedRequests.length === 0 && consoleErrors.length === 0;
  report = {
    status: success ? 'PASS' : 'FAIL',
    pageUrl,
    actorLook: { body: 'woman', outfit: 'office', hair: 'afro', skin: 'skin3', outfitColor: 'red', bottomsColor: 'cream', face: 'round', expression: 'smile', seed: 'prepared-npc-v1' },
    exactFactory: { family: 'female', retargetMode: 'directions', actorPosition: [0.78, 0, 0], actorYaw: 0 },
    sourceTriangleIds: [2308, 2309, 2325, 2353, 2362, 2363, 2366, 2367, 2368, 2369, 2433, 3120, 3121, 3124, 3136, 3137, 15562, 15578, 15594, 15604, 15605, 15608, 15609, 15610, 15611, 16363],
    comparisons, captures: captures.map(({ screenshot }) => screenshot),
    failedRequests, consoleErrors,
    limitations: ['One female office look only.', 'GPU pixel A/B is diagnostic, not production approval.', 'Six poses/views do not cover continuous motion or other garments.'],
    chrome: spawnSync(chromeBin, ['--version'], { encoding: 'utf8' }).stdout.trim(),
    constraints: { localBuildOrBrowser: false, rootFactoryAndBodyMaskUnion: true, fixedActorPoseAndViewPerAB: true },
  };
  await writeFile(path.join(resultDir, 'office-torso-mask-ab-review.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (!success) throw new Error(`Torso A/B checks failed: ${JSON.stringify({ failedRequests, consoleErrors, comparisons })}`);
  console.log(JSON.stringify({ status: report.status, resultDir, captures: report.captures.length, comparisons: report.comparisons.length }));
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  report = report ? { ...report, status: 'FAIL', error: message } : { status: 'FAIL', error: message, failedRequests, consoleErrors, chromeStderr };
  await writeFile(path.join(resultDir, 'office-torso-mask-ab-review.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.error(message);
  process.exitCode = 1;
} finally {
  socket?.close();
  chrome.kill('SIGTERM');
  await new Promise((resolve) => { if (chrome.exitCode !== null) resolve(); else { chrome.once('exit', resolve); setTimeout(resolve, 2500); } });
  server.close();
  await rm(profile, { recursive: true, force: true });
  await rm(bundlePath, { force: true });
}
