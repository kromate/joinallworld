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
const htmlPath = path.join(here, 'clothing-body-shoe-ab-v7.html');
const bundlePath = path.join(fixture, 'clothing-body-shoe-ab-v7.js');
const relativeHtml = path.relative(repo, htmlPath).split(path.sep).join('/');
const runId = (process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
const resultDir = path.join(here, 'remote-results', `clothing-body-shoe-ab-v7-${runId}`);
const chromeBin = process.env.CHROME_BIN ?? ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
  .map((name) => spawnSync('which', [name], { encoding: 'utf8' })).find((result) => result.status === 0)?.stdout.trim();
if (!chromeBin) throw new Error('Set CHROME_BIN to the remote runner Chrome/Chromium executable');
await stat(bundlePath).catch(() => { throw new Error('Fixture bundle is missing; run bundle-trouser-sock-trim-ab.mjs first'); });
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
const pendingNetwork = new Map();
const networkIdleWaits = [];
const clipRequestTrace = [];
const clipRequestsById = new Map();
let lastNetworkEventAt = Date.now();
let currentActorLabel = 'initial-page-load';
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
    state = await evaluate('window.clothingBodyShoeAB?.readyState ?? "loading"').catch(() => 'loading');
    if (state === 'ready' || state === 'failed') return state;
    await delay(200);
  }
  return state;
}
async function waitForNetworkIdle(label, quietMs = 600, timeoutMs = 30000) {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  while (Date.now() < deadline) {
    const quietForMs = Date.now() - lastNetworkEventAt;
    if (pendingNetwork.size === 0 && quietForMs >= quietMs) {
      const receipt = { label, status: 'idle', elapsedMs: Date.now() - startedAt, quietForMs, pending: 0 };
      networkIdleWaits.push(receipt);
      return receipt;
    }
    await delay(100);
  }
  const receipt = { label, status: 'timeout', elapsedMs: Date.now() - startedAt, pending: [...pendingNetwork.values()] };
  networkIdleWaits.push(receipt);
  throw new Error(`Network did not become idle at ${label}: ${JSON.stringify(receipt)}`);
}
async function capture(label) {
  await delay(120);
  const state = await evaluate('window.clothingBodyShoeAB.sample()');
  const dataUrl = await evaluate('document.querySelector("#stage").toDataURL("image/png")');
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) throw new Error('Canvas capture returned no PNG data URL');
  const bytes = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
  if (bytes.length < 5000) throw new Error(`Canvas PNG is suspiciously small (${bytes.length} bytes), likely a cleared drawing buffer`);
  const file = `${label}.png`;
  await writeFile(path.join(resultDir, file), bytes);
  return { state, image: { file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } };
}
async function setActor(body, outfit) {
  currentActorLabel = `${body}-${outfit}`;
  await evaluate(`window.clothingBodyShoeAB.load(${JSON.stringify(body)}, ${JSON.stringify(outfit)})`);
  assert.equal(await ready(), 'ready', `actor failed to load: ${await evaluate('document.querySelector("#status")?.textContent')}`);
  await waitForNetworkIdle(`actor-ready-${body}-${outfit}`);
}
async function capturePair(body, outfit, poseName, pose, phase, view) {
  await evaluate(`window.clothingBodyShoeAB.setPose(${JSON.stringify(pose)}, ${phase ?? 0})`);
  await evaluate(`window.clothingBodyShoeAB.setView(${JSON.stringify(view)})`);
  const sourceState = await evaluate(`window.clothingBodyShoeAB.setVariant("source"); window.clothingBodyShoeAB.sample()`);
  const source = await capture(`${body}-${outfit}-${poseName}-${view}-source`);
  const candidateState = await evaluate(`window.clothingBodyShoeAB.setVariant("candidate"); window.clothingBodyShoeAB.sample()`);
  const candidate = await capture(`${body}-${outfit}-${poseName}-${view}-candidate`);
  for (const item of [source, candidate]) {
    assert.equal(item.state.state, 'ready');
    assert.equal(item.state.family, body);
    assert.equal(item.state.outfit, outfit);
    assert.equal(item.state.pose, pose);
    assert.equal(item.state.view, view);
    assert.equal(item.state.render.canvasWidth, source.state.render.canvasWidth);
    assert.equal(item.state.render.canvasHeight, source.state.render.canvasHeight);
  }
  assert.deepEqual(sourceState.look, candidateState.look, 'A/B must keep one normalized look');
  assert.equal(sourceState.seed, candidateState.seed, 'A/B must keep one seed');
  assert.equal(sourceState.pose, candidateState.pose, 'A/B must use the same settled pose');
  assert.equal(sourceState.yawDegrees, candidateState.yawDegrees, 'A/B must use the same actor/camera yaw');
  assert.equal(sourceState.components.body.visible, true);
  assert.equal(candidateState.components.body.visible, body === 'female' && outfit === 'office' ? false : true);
  assert.equal(candidateState.components.body.candidateVisible, body === 'female' && outfit === 'office');
  return {
    body, outfit, poseName, pose, phase, view,
    look: source.state.look, seed: source.state.seed,
    source: { image: source.image, components: source.state.components, trim: source.state.trim, render: source.state.render },
    candidate: { image: candidate.image, components: candidate.state.components, trim: candidate.state.trim, bodyCoveragePatch: candidate.state.bodyCoveragePatch, bodyMask: candidate.state.bodyMaskCandidate, render: candidate.state.render },
    imageChanged: source.image.sha256 !== candidate.image.sha256,
  };
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
    if (message.method === 'Network.requestWillBeSent') {
      lastNetworkEventAt = Date.now();
      requestedUrls.set(message.params.requestId, message.params.request.url);
      pendingNetwork.set(message.params.requestId, { url: message.params.request.url, type: message.params.type ?? null, initiator: message.params.initiator?.type ?? null });
      if (message.params.request.url.includes('/clip-pack.glb')) {
        const item = {
          requestId: message.params.requestId, actorLabel: currentActorLabel,
          url: message.params.request.url, method: message.params.request.method,
          cdpTimestamp: message.params.timestamp, wallTime: message.params.wallTime,
          initiatorType: message.params.initiator?.type ?? null,
          initiatorStack: message.params.initiator?.stack?.callFrames?.map((frame) => ({ functionName: frame.functionName, url: frame.url, lineNumber: frame.lineNumber, columnNumber: frame.columnNumber })) ?? [],
          redirectResponse: message.params.redirectResponse ? { status: message.params.redirectResponse.status, mimeType: message.params.redirectResponse.mimeType, encodedDataLength: message.params.redirectResponse.encodedDataLength } : null,
          response: null, dataEvents: 0, dataLength: 0, encodedDataLength: 0, terminal: null,
        };
        clipRequestsById.set(message.params.requestId, item);
        clipRequestTrace.push(item);
      }
    }
    if (message.method === 'Network.responseReceived') {
      const item = clipRequestsById.get(message.params.requestId);
      if (item) item.response = { timestamp: message.params.timestamp, status: message.params.response.status, mimeType: message.params.response.mimeType,
        fromDiskCache: message.params.response.fromDiskCache ?? false, fromServiceWorker: message.params.response.fromServiceWorker ?? false,
        encodedDataLength: message.params.response.encodedDataLength ?? null, contentLength: message.params.response.headers?.['content-length'] ?? message.params.response.headers?.['Content-Length'] ?? null };
    }
    if (message.method === 'Network.dataReceived') {
      const item = clipRequestsById.get(message.params.requestId);
      if (item) { item.dataEvents++; item.dataLength += message.params.dataLength; item.encodedDataLength += message.params.encodedDataLength; }
    }
    if (message.method === 'Network.loadingFinished') {
      lastNetworkEventAt = Date.now();
      pendingNetwork.delete(message.params.requestId);
      const item = clipRequestsById.get(message.params.requestId);
      if (item) item.terminal = { kind: 'finished', timestamp: message.params.timestamp, encodedDataLength: message.params.encodedDataLength };
    }
    if (message.method === 'Network.loadingFailed') {
      lastNetworkEventAt = Date.now();
      const pendingRequest = pendingNetwork.get(message.params.requestId);
      failedRequests.push({ requestId: message.params.requestId, url: requestedUrls.get(message.params.requestId) ?? pendingRequest?.url ?? null, type: pendingRequest?.type ?? null, initiator: pendingRequest?.initiator ?? null, errorText: message.params.errorText, canceled: message.params.canceled ?? false });
      pendingNetwork.delete(message.params.requestId);
      const item = clipRequestsById.get(message.params.requestId);
      if (item) item.terminal = { kind: 'failed', timestamp: message.params.timestamp, errorText: message.params.errorText, canceled: message.params.canceled ?? false, blockedReason: message.params.blockedReason ?? null };
    }
  });
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1120, deviceScaleFactor: 1, mobile: false });
  const pageUrl = `http://127.0.0.1:${port}/${relativeHtml}`;
  currentActorLabel = 'initial-male-casual';
  await cdp('Page.navigate', { url: pageUrl });
  assert.equal(await ready(), 'ready', `initial actor failed: ${await evaluate('document.querySelector("#status")?.textContent').catch(String)}`);
  await waitForNetworkIdle('initial-actor-ready');

  const matrix = [
    { body: 'female', outfit: 'office', states: [
      ['idle', 'idle', null, 'front'], ['idle', 'idle', null, 'quarter'], ['idle', 'idle', null, 'side'],
      ['walk-a', 'walk', Math.PI / 2, 'front'], ['walk-a', 'walk', Math.PI / 2, 'quarter'], ['walk-a', 'walk', Math.PI / 2, 'side'],
      ['walk-b', 'walk', Math.PI * 1.5, 'front'], ['walk-b', 'walk', Math.PI * 1.5, 'side'],
      ['interact', 'interact', null, 'front'], ['interact', 'interact', null, 'side'],
    ] },
    ...['male', 'female'].flatMap((body) => ['casual'].map((outfit) => ({ body, outfit, states: [
      ['idle', 'idle', null, 'front'], ['idle', 'idle', null, 'side'],
      ['walk-a', 'walk', Math.PI / 2, 'front'], ['walk-a', 'walk', Math.PI / 2, 'side'],
      ['walk-b', 'walk', Math.PI * 1.5, 'front'], ['walk-b', 'walk', Math.PI * 1.5, 'side'],
      ['interact', 'interact', null, 'front'],
    ] }))),
    { body: 'male', outfit: 'office', states: [
      ['idle', 'idle', null, 'front'], ['idle', 'idle', null, 'side'],
      ['walk-a', 'walk', Math.PI / 2, 'front'], ['walk-a', 'walk', Math.PI / 2, 'side'],
      ['walk-b', 'walk', Math.PI * 1.5, 'front'], ['walk-b', 'walk', Math.PI * 1.5, 'side'],
      ['interact', 'interact', null, 'front'],
    ] },
  ];
  const comparisons = [];
  for (const entry of matrix) {
    await setActor(entry.body, entry.outfit);
    for (const [poseName, pose, phase, view] of entry.states) {
      comparisons.push(await capturePair(entry.body, entry.outfit, poseName, pose, phase, view));
    }
  }
  await waitForNetworkIdle('completed-comparison-matrix');
  const clipResourceTiming = await evaluate(`performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/clip-pack.glb')).map((entry) => ({ name: entry.name, startTime: entry.startTime, duration: entry.duration, transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize, decodedBodySize: entry.decodedBodySize, responseStatus: entry.responseStatus ?? null }))`);
  const clipSnapshotDiagnostics = await evaluate(`window.__clipSnapshotDiagnostics?.() ?? null`);
  const office = comparisons.filter((item) => item.body === 'female' && item.outfit === 'office');
  const pants = comparisons.filter((item) => item.body === 'male' && item.outfit === 'office');
  const casual = comparisons.filter((item) => item.outfit === 'casual');
  const visibleChangeGroups = [
    comparisons.some((item) => item.body === 'female' && item.outfit === 'office' && item.pose === 'idle' && item.view === 'front' && item.imageChanged),
    comparisons.some((item) => item.outfit === 'casual' && item.pose === 'walk' && item.view === 'front' && item.imageChanged),
    comparisons.some((item) => item.body === 'male' && item.outfit === 'office' && item.pose === 'walk' && item.view === 'front' && item.imageChanged),
  ];
  const passed = comparisons.length === 31 && failedRequests.length === 0 && consoleErrors.length === 0
    && clipSnapshotDiagnostics?.requests === 1
    && clipSnapshotDiagnostics?.bytesRead === 338060
    && clipSnapshotDiagnostics?.parseSuccesses === 5
    && clipSnapshotDiagnostics?.kitsParsed === 5
    && office.every((item) => item.candidate.bodyCoveragePatch?.seedTriangleIds?.includes(3136))
    && office.every((item) => item.candidate.bodyMask?.hiddenTriangles > item.source.components.body.existingHiddenTriangles)
    && office.every((item) => item.candidate.components.body.candidateTriangles < item.source.components.body.activeTriangles)
    && office.every((item) => item.candidate.components.body.candidateVisible && !item.candidate.components.body.visible)
    && office.every((item) => item.candidate.bodyMask?.assets?.includes('female-office-pixel-attributed-connected-blouse-coverage'))
    && pants.every((item) => item.candidate.trim?.status === 'trimmed')
    && casual.every((item) => item.candidate.trim?.status === 'trimmed')
    && visibleChangeGroups.every(Boolean)
    && comparisons.every((item) => item.source.image.bytes > 5000 && item.candidate.image.bytes > 5000);
  result = {
    status: passed ? 'PASS' : 'FAIL', diagnosticOnly: true, pageUrl,
    fixture: 'same prepared actor/look/seed/pose/camera; source versus connected office-blouse Body coverage and trouser-hem sock candidate',
    comparisons, visibleChangeGroups, failedRequests, clipRequestTrace, clipResourceTiming, clipSnapshotDiagnostics, networkIdleWaits, pendingNetwork: [...pendingNetwork.values()], consoleErrors, chromeVersion: spawnSync(chromeBin, ['--version'], { encoding: 'utf8' }).stdout.trim(),
    limitations: ['The blouse patch is a bounded source-index candidate; pixels still require independent visual acceptance.', 'Four outfits and sampled poses only; no mobile or fullgame claim.', 'Female office skirt deliberately leaves shoe geometry unchanged.'],
  };
  await writeFile(path.join(resultDir, 'clothing-body-shoe-ab-report.json'), `${JSON.stringify(result, null, 2)}\n`);
  if (!passed) throw new Error(`Clothing A/B gates failed: ${JSON.stringify({ comparisons: comparisons.length, failedRequests, consoleErrors, clipSnapshotDiagnostics, firstPatch: office[0]?.candidate.bodyCoveragePatch })}`);
  console.log(JSON.stringify({ status: result.status, resultDir, comparisons: comparisons.length }));
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  result = { ...(result ?? {}), status: 'FAIL', error: message, failedRequests, clipRequestTrace, networkIdleWaits, pendingNetwork: [...pendingNetwork.values()], consoleErrors, chromeStderr };
  await writeFile(path.join(resultDir, 'clothing-body-shoe-ab-report.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.error(message);
  process.exitCode = 1;
} finally {
  socket?.close();
  await stopChrome();
  server.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 12, retryDelay: 100 });
}
