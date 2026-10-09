import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, openSync, closeSync, readSync, createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { verifyPhaseStableCpuArtifact } from './verify-package.mjs';
import { requireCurrentPublishedActorTrace } from './load-trace-contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INPUT = path.resolve(process.env.ARTIFACT_DIR ?? '');
const OUT = path.resolve(process.env.RESULT_DIR ?? '');
const PIN_PATH = path.join(HERE, 'artifact-pin.json');
if (process.platform !== 'linux') throw new Error('Remote Linux only; local execution is refused');
if (!path.isAbsolute(INPUT) || !path.isAbsolute(OUT) || INPUT === OUT) throw new Error('ARTIFACT_DIR and distinct RESULT_DIR must be absolute');
const pin = JSON.parse(await readFile(PIN_PATH, 'utf8'));
const placeholder = value => typeof value !== 'string' || value.includes('__ROOT_TO_PIN');
if (pin.schema !== 'allworld-market-lod-v8-phase-stable-live-motion-pin-v3' || placeholder(pin.packageManifestSha256)
  || !/^[a-f0-9]{64}$/.test(pin.packageManifestSha256) || !/^[a-f0-9]{64}$/.test(pin.sourceManifestSha256)
  || process.env.PACKAGE_RUN_ID !== String(pin.packageRunId)
  || process.env.PACKAGE_COMMIT !== pin.packageCommit || process.env.PACKAGE_BRANCH !== pin.packageBranch
  || pin.captureMatrix?.expectedPngCount !== 10 || pin.captureMatrix?.minimumLiveElapsedSeconds !== 2.4) {
  throw new Error('Live-review package pin is incomplete or disagrees with the workflow run inputs');
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const shaFile = async file => { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); };

if (!existsSync(OUT)) await mkdir(OUT, { recursive: false });
const outputEntries = await (await import('node:fs/promises')).readdir(OUT);
if (outputEntries.some(name => name !== 'review-cdp.log')) throw new Error('Refusing to overwrite existing review output');
let packaged;
try {
  packaged = await verifyPhaseStableCpuArtifact(INPUT, pin);
} catch (error) {
  const failure = error instanceof Error ? error.stack ?? error.message : String(error);
  await writeFile(path.join(OUT, 'review-results.json'), `${JSON.stringify({
    schema: 'allworld-market-lod-v8-phase-stable-live-motion-review-v3', status: 'package-verification-failed', success: false, failure,
    package: { runId: pin.packageRunId, commit: pin.packageCommit, manifestSha256: pin.packageManifestSha256 },
    limits: ['No browser launched because exact package verification failed.'],
  }, null, 2)}\n`, { flag: 'wx' });
  throw error;
}
const runtime = {
  platform: process.platform, arch: os.arch(), kernel: os.release(), node: process.version,
  runnerImage: process.env.ImageOS ?? null, runnerVersion: process.env.ImageVersion ?? null,
  reviewWorkflowRunId: process.env.GITHUB_RUN_ID ?? null, packageRunId: pin.packageRunId,
  packageBranch: pin.packageBranch, packageCommit: pin.packageCommit,
  packageManifestSha256: pin.packageManifestSha256, sourceManifestSha256: pin.sourceManifestSha256,
  rendererClaim: 'headless Chrome ANGLE SwiftShader diagnostic; not hardware or mobile performance evidence',
};
const mime = new Map([['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'], ['.glb', 'model/gltf-binary'], ['.json', 'application/json']]);
const routes = new Map([['/', 'index.html'], ['/index.html', 'index.html']]);
for (const relative of packaged.records.keys()) routes.set(`/${relative}`, relative);
const inventoryRoute = '/evidence/graphics-loop/venue-authored-people-browser-v1/candidate-market-day-12.json';
routes.set(inventoryRoute, 'assets/candidate-market-day-12.json');
for (const family of ['male', 'female']) {
  const expectedHash = family === 'male' ? 'b0078206da9f7de0bf346be8133522cf514009f03f262f716613dd196d180686'
    : '977ca5e73ba7b19af2627dab1ba0f0ef3e3d8548bf7b4d54f45faf22cd56001c';
  const emitted = [...packaged.records.entries()].find(([relative, record]) => relative.startsWith(`assets/base-body-${family}-`) && record.sha256 === expectedHash);
  if (!emitted) throw new Error(`Pinned production ${family} body asset is not in the package`);
  routes.set(`/src/scene/body/assets/base-body-${family}.glb`, emitted[0]);
}
const requestLog = [];
const server = createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method ?? '')) { res.writeHead(405).end(); return; }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
    if (url.search) { res.writeHead(404).end(); return; }
    const relative = routes.get(url.pathname);
    if (!relative) { requestLog.push({ path: url.pathname, status: 404 }); res.writeHead(404).end(); return; }
    const file = path.resolve(packaged.dist, relative), rel = path.relative(packaged.dist, file);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !packaged.records.has(relative)) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': mime.get(path.extname(file)) ?? 'application/octet-stream', 'cache-control': 'no-store', 'content-length': data.byteLength });
    requestLog.push({ path: url.pathname, output: relative, status: 200, bytes: data.byteLength });
    req.method === 'HEAD' ? res.end() : res.end(data);
  } catch { res.writeHead(404, { 'cache-control': 'no-store' }).end('not found'); }
});

let chrome = null, socket = null, profile = null, chromeLogFd = null, id = 0;
const pending = new Map();
const networkRequests = new Map();
const events = { exceptions: [], consoleErrors: [], failedRequests: [], httpErrors: [], responses: [], finishedRequests: [] };
const captures = [], pairs = [], motionRuns = [], postPauseCaptures = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function send(method, params = {}) {
  const requestId = ++id;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 7000);
    pending.set(requestId, { resolve, reject, timer }); socket.send(JSON.stringify({ id: requestId, method, params }));
  });
}
function onMessage(raw) {
  const message = JSON.parse(raw.toString());
  if (message.id) {
    const task = pending.get(message.id); if (!task) return;
    clearTimeout(task.timer); pending.delete(message.id);
    message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result);
  } else if (message.method === 'Runtime.exceptionThrown') events.exceptions.push(message.params.exceptionDetails?.text ?? 'runtime exception');
  else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') events.consoleErrors.push((message.params.args ?? []).map(arg => arg.value ?? arg.description ?? '').join(' '));
  else if (message.method === 'Network.requestWillBeSent') {
    const request = message.params.request;
    networkRequests.set(message.params.requestId, {
      requestId: message.params.requestId, url: request.url, method: request.method,
      requestTimestamp: message.params.timestamp, requestWallTime: message.params.wallTime,
      resourceType: message.params.type ?? null, loaderId: message.params.loaderId ?? null,
      frameId: message.params.frameId ?? null, initiator: message.params.initiator ?? null,
    });
  } else if (message.method === 'Network.loadingFailed') {
    const started = networkRequests.get(message.params.requestId) ?? { requestId: message.params.requestId, url: null };
    const failure = { failureTimestamp: message.params.timestamp, error: message.params.errorText,
      canceled: message.params.canceled, blockedReason: message.params.blockedReason ?? null };
    Object.assign(started, { failure });
    events.failedRequests.push({ ...started });
  } else if (message.method === 'Network.loadingFinished') {
    const started = networkRequests.get(message.params.requestId) ?? { requestId: message.params.requestId, url: null };
    Object.assign(started, { finishedTimestamp: message.params.timestamp, encodedDataLength: message.params.encodedDataLength });
    events.finishedRequests.push({ ...started });
  } else if (message.method === 'Network.responseReceived') {
    const started = networkRequests.get(message.params.requestId) ?? { requestId: message.params.requestId, url: message.params.response.url };
    const item = { ...started, responseTimestamp: message.params.timestamp, status: message.params.response.status,
      mimeType: message.params.response.mimeType, fromDiskCache: message.params.response.fromDiskCache ?? false,
      fromServiceWorker: message.params.response.fromServiceWorker ?? false,
      responseHeaders: message.params.response.headers ?? null,
      responseConnectionReused: message.params.response.connectionReused ?? null,
      responseRemoteIPAddress: message.params.response.remoteIPAddress ?? null };
    Object.assign(started, item);
    events.responses.push(item);
    if (message.params.response.status >= 400) events.httpErrors.push(item);
  }
}
async function evaluate(expression, awaitPromise = false) {
  const response = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: true });
  if (response.exceptionDetails) throw new Error(`Page evaluation failed: ${response.exceptionDetails.text}`);
  return response.result?.value;
}
async function waitFor(predicate, description, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await wait(80); }
  throw new Error(`Timed out waiting for ${description}`);
}
async function devtoolsPort() {
  const active = path.join(profile, 'DevToolsActivePort');
  await waitFor(() => existsSync(active), 'Chrome DevTools port', 8000);
  const port = Number(readFileSync(active, 'utf8').trim().split(/\r?\n/)[0]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid DevTools port');
  return port;
}
async function connect(port) {
  let targets;
  await waitFor(async () => {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); return targets.some(t => t.type === 'page' && t.webSocketDebuggerUrl); }
    catch { return false; }
  }, 'Chrome page target', 8000);
  const target = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  socket.on('message', onMessage);
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
}
async function statusRecord() { return evaluate(`JSON.parse(document.getElementById('status').textContent)`); }
async function liveState() { return evaluate('window.__marketLodLiveWalk?.state() ?? null'); }
async function setSelect(idName, value) {
  return evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(idName)});if(!e)throw Error('missing ${idName}');e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
}
async function waitStableCheckpoint(description, before = null) {
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))', true);
  const first = await liveState(); await wait(120); const second = await liveState();
  if (!first || !second || first.playing || second.playing || first.bonePoseCheckpoint !== second.bonePoseCheckpoint
    || first.elapsedSeconds !== second.elapsedSeconds) throw new Error(`${description}: paused pose did not settle`);
  if (before && second.bonePoseCheckpoint !== before) throw new Error(`${description}: pose checkpoint changed across A/B`);
  return second;
}
async function capture(actor, mode, yaw, expectedState, label = '') {
  const record = await statusRecord(), state = await liveState();
  const liveLoadTrace = await evaluate('window.__marketLodLiveWalk?.loadTrace?.() ?? null');
  const actorLoadTrace = requireCurrentPublishedActorTrace(liveLoadTrace, actor);
  const actorPin = pin.actors.find(item => item.id === actor);
  const checks = {
    actor: record.actor === actor, seed: record.seed === actorPin.seed,
    family: record.family === actorPin.family, body: record.normalizedLook?.body === actorPin.body,
    outfit: record.normalizedLook?.outfit === actorPin.outfit, mode: record.mode === mode,
    pose: record.pose === 'walk', exactPhase: record.walkPhase === state?.phase, yaw: record.yawDegrees === yaw, framing: record.framing === 'full-body',
    boundsInFrustum: record.fullBodyProjection?.boundsInFrustum === true,
    supportPlaneYZero: record.contact?.groundY === 0,
    finiteSupportSolve: record.contact?.supportSolve && Number.isFinite(record.contact.supportSolve.maxError),
    supportSolveUnclamped: record.contact?.supportSolve?.limited === false,
    twoSolesBeforeAndAfter: record.contact?.soles?.length === 2 && record.contact?.soleSamplesBeforeLastSolve?.length === 2,
    soleSamplesWithin4mm: record.contact?.soles?.every(sole => Math.abs(sole.lowestSampleY) <= 0.004) === true,
    deformedWorldBoundsMeasured: Number.isFinite(record.contact?.deformedWorldMinY) && Number.isFinite(record.contact?.deformedWorldMaxY),
    deformedGeometryNotBelowSupportBy4mm: Number.isFinite(record.contact?.deformedWorldMinY) && record.contact.deformedWorldMinY >= -0.004,
    actorLoadTracePresent: actorLoadTrace.events.some(item => item.stage === 'actor-published'),
    actorLoadTraceCurrentGeneration: actorLoadTrace.generation === Math.max(...liveLoadTrace.map(item => item.generation)),
    paused: state?.playing === false, elapsed: state?.elapsedSeconds >= pin.captureMatrix.minimumLiveElapsedSeconds,
    checkpoint: state?.bonePoseCheckpoint === expectedState.bonePoseCheckpoint,
    canvas: record.fullBodyProjection?.canvasWidth > 0 && record.fullBodyProjection?.canvasHeight > 0,
    identity: typeof record.sourceIdentity?.assetSha === 'string' && /^[a-f0-9]{64}$/.test(record.sourceIdentity.assetSha),
    renderer: record.renderer?.calls > 0 && record.renderer?.triangles > 0,
  };
  if (Object.values(checks).some(value => value !== true)) throw new Error(`Refused frame ${actor}/${mode}/yaw${yaw}: ${JSON.stringify({ checks, record, state })}`);
  const bounds = await evaluate(`(()=>{const r=document.getElementById('view').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
  const image = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false, clip: { ...bounds, scale: 1 } });
  const bytes = Buffer.from(image.data, 'base64');
  const filename = `${actor}-${mode}-livewalk-yaw${yaw}${label ? `-${label}` : ''}.png`;
  await writeFile(path.join(OUT, filename), bytes, { flag: 'wx' });
  return { actor, mode, yaw, phase: state.phase, elapsedSeconds: state.elapsedSeconds, bonePoseCheckpoint: state.bonePoseCheckpoint,
    file: filename, bytes: bytes.byteLength, sha256: sha(bytes), checks,
    metrics: { sourceTriangles: record.sourceTriangles, compactTriangles: record.compactTriangles,
      frameTriangles: record.renderer.triangles, drawCalls: record.renderer.calls,
      compactTypedGeometryBytes: record.compactStorage?.totalTypedGeometryBytes ?? null,
      fullBodyProjection: record.fullBodyProjection, contact: record.contact, loadTrace: actorLoadTrace.events,
      currentLoadGeneration: actorLoadTrace.generation,
      sourceIdentity: record.sourceIdentity,
      normalizedLook: record.normalizedLook, topology: record.topology } };
}
async function waitForLiveMotion(actor) {
  const before = await liveState();
  if (!before || before.playing || before.actor !== actor || before.pose !== 'walk') throw new Error(`Invalid initial live-walk state: ${JSON.stringify(before)}`);
  await evaluate('window.__marketLodLiveWalk.play(); true');
  const witnessPhases = new Set(), witnessBones = new Set();
  const start = Date.now();
  let current = null;
  while (Date.now() - start < 6500) {
    current = await liveState();
    if (current?.playing) {
      witnessPhases.add(Number(current.phase).toFixed(3));
      witnessBones.add(current.bonePoseCheckpoint);
    }
    if (current?.elapsedSeconds >= pin.captureMatrix.minimumLiveElapsedSeconds
      && witnessPhases.size >= 3 && witnessBones.size >= 3 && current.bonePoseCheckpoint !== before.bonePoseCheckpoint) break;
    await wait(80);
  }
  if (!current || current.elapsedSeconds < pin.captureMatrix.minimumLiveElapsedSeconds || witnessPhases.size < 3
    || witnessBones.size < 3 || current.bonePoseCheckpoint === before.bonePoseCheckpoint) {
    throw new Error(`Live walk failed its elapsed/phase/bone witness: ${JSON.stringify({ before, current, witnessPhases: [...witnessPhases], witnessBones: [...witnessBones] })}`);
  }
  await evaluate('window.__marketLodLiveWalk.pause(); true');
  const paused = await waitStableCheckpoint(`${actor} live walk pause`);
  if (paused.elapsedSeconds < pin.captureMatrix.minimumLiveElapsedSeconds) throw new Error('Paused elapsed time fell below one walk cycle');
  return { actor, initialPhase: before.phase, initialBonePoseCheckpoint: before.bonePoseCheckpoint,
    elapsedSeconds: paused.elapsedSeconds, finalPhase: paused.phase, finalBonePoseCheckpoint: paused.bonePoseCheckpoint,
    uniquePhaseWitnesses: [...witnessPhases], uniqueBonePoseWitnesses: [...witnessBones], rafWitnessesObserved: witnessBones.size,
    playingAtPause: paused.playing };
}

let chromeLog = null, serverAddress = null, webgl = null, status = 'failed', failure = null;
let serverReady = false;
try {
  const chromeLauncherPath = await realpath(process.env.CHROME_BIN ?? '');
  const launcherHash = await shaFile(chromeLauncherPath);
  const siblingBinary = path.join(path.dirname(chromeLauncherPath), 'chrome');
  const siblingFd = existsSync(siblingBinary) ? openSync(siblingBinary, 'r') : null;
  let siblingHeader = null;
  if (siblingFd !== null) { siblingHeader = Buffer.alloc(4); readSync(siblingFd, siblingHeader, 0, 4, 0); closeSync(siblingFd); }
  const isElf = header => header?.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  const chromePath = isElf(siblingHeader) ? await realpath(siblingBinary) : chromeLauncherPath;
  const binaryFd = openSync(chromePath, 'r'), binaryHeader = Buffer.alloc(4); readSync(binaryFd, binaryHeader, 0, 4, 0); closeSync(binaryFd);
  if (!isElf(binaryHeader)) throw new Error('Resolved Chrome executable is not ELF');
  runtime.chromeLauncherPath = chromeLauncherPath; runtime.chromeLauncherSha256 = launcherHash;
  runtime.chromePath = chromePath; runtime.chromeVersion = execFileSync(chromeLauncherPath, ['--version'], { encoding: 'utf8', timeout: 3000 }).trim();
  runtime.chromeSha256 = await shaFile(chromePath);
  runtime.chromeFlags = ['--single-process', '--in-process-gpu', '--no-zygote', '--renderer-process-limit=1', '--use-gl=angle', '--use-angle=swiftshader'];
  runtime.processGroupRssLimitMiB = 2048;
  runtime.chromeTopology = 'Constrained SwiftShader diagnostic configuration; not representative of ordinary multi-process or mobile performance.';
  const address = await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address())); });
  if (!address || typeof address === 'string' || address.address !== '127.0.0.1') throw new Error('Static server must bind loopback only');
  serverAddress = address; serverReady = true;
  profile = await mkdtemp(path.join(os.tmpdir(), 'market-lod-v8-phase-stable-live-v3-'));
  chromeLog = path.join(OUT, 'chrome.log'); chromeLogFd = openSync(chromeLog, 'wx');
  const args = ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu-sandbox','--single-process','--in-process-gpu','--no-zygote','--renderer-process-limit=1','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader','--disable-extensions','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'];
  chrome = spawn(chromePath, args, { stdio: ['ignore', chromeLogFd, chromeLogFd] });
  const port = await devtoolsPort(); await connect(port);
  await send('Page.navigate', { url: `http://127.0.0.1:${address.port}/` });
  await waitFor(async () => await evaluate(`document.documentElement.dataset.ready === 'controls-ready'`).catch(() => false), 'v8 fixture controls');
  const rendererInfo = await evaluate(`(()=>{const c=document.getElementById('view'),g=c.getContext('webgl2')||c.getContext('webgl'),e=g?.getExtension('WEBGL_debug_renderer_info');return g?{version:g.getParameter(g.VERSION),vendor:g.getParameter(e?e.UNMASKED_VENDOR_WEBGL:g.VENDOR),renderer:g.getParameter(e?e.UNMASKED_RENDERER_WEBGL:g.RENDERER),shadingLanguage:g.getParameter(g.SHADING_LANGUAGE_VERSION)}:null})()`);
  webgl = rendererInfo;
  if (!String(rendererInfo?.renderer ?? '').toLowerCase().includes('swiftshader')) throw new Error(`Expected ANGLE SwiftShader, got ${JSON.stringify(rendererInfo)}`);
  for (const actorPin of pin.actors) {
    const { id: actor } = actorPin;
    await evaluate(`(()=>{const a=document.getElementById('actor');a.value=${JSON.stringify(actor)};document.getElementById('mode').value='source';document.getElementById('load').click();return true})()`);
    await waitFor(async () => await evaluate(`document.documentElement.dataset.ready === 'true' && document.documentElement.dataset.actor === ${JSON.stringify(actor)} && document.documentElement.dataset.mode === 'source'`).catch(() => false), `production body load ${actor}`, 20000);
    await setSelect('framing', 'full-body'); await setSelect('yaw', 0); await setSelect('phase', 0); await setSelect('pose', 'walk');
    const motion = await waitForLiveMotion(actor); motionRuns.push(motion);
    const pausedSourceState = await waitStableCheckpoint(`${actor} post-walk source before controls`, motion.finalBonePoseCheckpoint);
    const postPauseSource = await capture(actor, 'source', 0, pausedSourceState, 'post-pause-before-yaw-mode');
    captures.push(postPauseSource); postPauseCaptures.push({ actor, phase: postPauseSource.phase, elapsedSeconds: postPauseSource.elapsedSeconds,
      bonePoseCheckpoint: postPauseSource.bonePoseCheckpoint, file: postPauseSource.file, sha256: postPauseSource.sha256,
      checks: postPauseSource.checks, metrics: postPauseSource.metrics });
    const actorPairs = [];
    for (const yaw of pin.captureMatrix.yawsDegrees) {
      await setSelect('mode', 'source');
      await setSelect('yaw', yaw);
      const sourceState = await waitStableCheckpoint(`${actor} source yaw ${yaw}`, motion.finalBonePoseCheckpoint);
      const source = await capture(actor, 'source', yaw, sourceState);
      await setSelect('mode', 'compact');
      const compactState = await waitStableCheckpoint(`${actor} compact yaw ${yaw}`, sourceState.bonePoseCheckpoint);
      const compact = await capture(actor, 'compact', yaw, compactState);
      if (source.bonePoseCheckpoint !== compact.bonePoseCheckpoint || source.phase !== compact.phase
        || JSON.stringify(source.metrics.sourceIdentity) !== JSON.stringify(compact.metrics.sourceIdentity)
        || source.metrics.sourceTriangles !== compact.metrics.sourceTriangles || source.metrics.compactTriangles !== compact.metrics.compactTriangles) {
        throw new Error(`Source/compact A/B changed actor pose, identity, or recipe counts: ${actor}/${yaw}`);
      }
      const pair = { actor, seed: actorPin.seed, family: actorPin.family, body: actorPin.body, outfit: actorPin.outfit,
        yaw, phase: source.phase, elapsedSeconds: source.elapsedSeconds,
        pairedPausedPoseCheckpoint: source.bonePoseCheckpoint,
        cameraContract: 'full-body fitted mode and same yaw; pinned v8 mode toggle does not refit camera; runtime camera matrix is not exposed by fixture API',
        source: { file: source.file, sha256: source.sha256, metrics: source.metrics },
        compact: { file: compact.file, sha256: compact.sha256, metrics: compact.metrics } };
      actorPairs.push(pair); pairs.push(pair); captures.push(source, compact);
    }
    if (actorPairs.length !== 2) throw new Error(`Expected front and side pair for ${actor}`);
  }
  if (captures.length !== pin.captureMatrix.expectedPngCount) throw new Error(`Expected ${pin.captureMatrix.expectedPngCount} images, got ${captures.length}`);
  for (const required of [inventoryRoute, '/src/scene/body/assets/base-body-male.glb', '/src/scene/body/assets/base-body-female.glb']) {
    if (!requestLog.some(item => item.path === required && item.status === 200)) throw new Error(`Pinned source route was not fetched: ${required}`);
  }
  if (events.exceptions.length || events.consoleErrors.length || events.failedRequests.length || events.httpErrors.length) throw new Error(`Browser errors: ${JSON.stringify(events)}`);
  status = 'captured-live-walk-diagnostic';
} catch (error) { failure = error instanceof Error ? error.stack ?? error.message : String(error); }
finally {
  try { if (socket?.readyState === WebSocket.OPEN) socket.close(); } catch {}
  if (chrome && chrome.exitCode === null) {
    chrome.kill('SIGTERM'); await Promise.race([new Promise(resolve => chrome.once('exit', resolve)), wait(1200)]);
    if (chrome.exitCode === null) chrome.kill('SIGKILL');
  }
  if (profile) await rm(profile, { recursive: true, force: true });
  if (server.listening) await new Promise(resolve => server.close(resolve));
  if (chromeLogFd !== null) { closeSync(chromeLogFd); chromeLogFd = null; }
}
const report = { schema: 'allworld-market-lod-v8-phase-stable-live-motion-review-v3', status,
  success: status === 'captured-live-walk-diagnostic' && captures.length === pin.captureMatrix.expectedPngCount,
  failure, runtime, webgl, package: { sourceRunId: pin.packageRunId, sourceCommit: pin.packageCommit,
    sourceBranch: pin.packageBranch, packageManifestSha256: pin.packageManifestSha256,
    packageSourceReceipt: packaged.sourceReceiptPath, packageSourceReceiptStatus: packaged.sourceReceipt.status },
  serverStarted: serverReady, routeLog: requestLog, requestLifecycle: [...networkRequests.values()], motionRuns, postPauseCaptures, pairs,
  captures: captures.map(item => ({ actor: item.actor, mode: item.mode, yaw: item.yaw,
    phase: item.phase, elapsedSeconds: item.elapsedSeconds, bonePoseCheckpoint: item.bonePoseCheckpoint,
    file: item.file, bytes: item.bytes, sha256: item.sha256, checks: item.checks, metrics: item.metrics })), events,
  limits: ['SwiftShader is diagnostic evidence only, not hardware GPU, phone performance, or battery evidence.',
    'Two saved identities do not prove all looks, outfits, all-camera angles, or whole-market budgets.',
    'The post-pause source frame is captured before any yaw/mode events; source/compact frames then use the same paused phase and exact bone checkpoint.',
    'Only production stride is exercised; the static interact pose is not a timed interaction animation.',
    'This run does not imply production integration or acceptance.'] };
await writeFile(path.join(OUT, 'review-results.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ status, success: report.success, failure, captures: captures.length, output: OUT }, null, 2));
if (!report.success) process.exitCode = 1;
