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
import { validateCaptureViewport } from './capture-viewport-contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INPUT = path.resolve(process.env.ARTIFACT_DIR ?? '');
const OUT = path.resolve(process.env.RESULT_DIR ?? '');
const PIN_PATH = path.join(HERE, 'artifact-pin.json');
if (process.platform !== 'linux') throw new Error('Remote Linux only; local execution is refused');
if (!path.isAbsolute(INPUT) || !path.isAbsolute(OUT) || INPUT === OUT) throw new Error('ARTIFACT_DIR and distinct RESULT_DIR must be absolute');
const pin = JSON.parse(await readFile(PIN_PATH, 'utf8'));
const placeholder = value => typeof value !== 'string' || value.includes('__ROOT_TO_PIN');
if (pin.schema !== 'allworld-market-lod-v8-floor-toggle-live-pin-v5' || placeholder(pin.packageManifestSha256)
  || !/^[a-f0-9]{64}$/.test(pin.packageManifestSha256) || !/^[a-f0-9]{64}$/.test(pin.sourceManifestSha256)
  || process.env.PACKAGE_RUN_ID !== String(pin.packageRunId)
  || process.env.PACKAGE_COMMIT !== pin.packageCommit || process.env.PACKAGE_BRANCH !== pin.packageBranch
  || pin.captureMatrix?.expectedPngCount !== 8 || pin.captureMatrix?.minimumLiveElapsedSeconds !== 2.4 || pin.captureMatrix?.yawDegrees !== 0) {
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
    schema: 'allworld-market-lod-v8-floor-toggle-live-review-v5', status: 'package-verification-failed', success: false, failure,
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
const captures = [], pairs = [], motionRuns = [], postPauseCaptures = [], diagnosticIo = [];
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
async function scrollViewIntoCaptureViewport() {
  await evaluate(`(()=>{const view=document.getElementById('view');if(!view)throw Error('missing review canvas');view.scrollIntoView({block:'center',inline:'center',behavior:'instant'});return true})()`);
  const rects = await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>{const view=document.getElementById('view');const a=view.getBoundingClientRect();requestAnimationFrame(()=>{const b=view.getBoundingClientRect();const root=document.documentElement;resolve({first:{x:a.x,y:a.y,width:a.width,height:a.height},second:{x:b.x,y:b.y,width:b.width,height:b.height},inner:{width:innerWidth,height:innerHeight},documentViewport:{clientWidth:root.clientWidth,clientHeight:root.clientHeight,innerWidth,innerHeight,scrollbarWidth:innerWidth-root.clientWidth,scrollbarHeight:innerHeight-root.clientHeight},scroll:{x:scrollX,y:scrollY},visual:{offsetLeft:visualViewport?.offsetLeft??0,offsetTop:visualViewport?.offsetTop??0,pageLeft:visualViewport?.pageLeft??scrollX,pageTop:visualViewport?.pageTop??scrollY,width:visualViewport?.width??innerWidth,height:visualViewport?.height??innerHeight}})})}))`, true);
  const metrics = await send('Page.getLayoutMetrics');
  const layoutViewport = { width: metrics.cssLayoutViewport?.clientWidth, height: metrics.cssLayoutViewport?.clientHeight };
  const pageCoordinates = { scrollX: rects.scroll?.x, scrollY: rects.scroll?.y,
    layoutPageX: metrics.cssLayoutViewport?.pageX, layoutPageY: metrics.cssLayoutViewport?.pageY,
    pageX: metrics.cssVisualViewport?.pageX, pageY: metrics.cssVisualViewport?.pageY };
  const sameRect = ['x', 'y', 'width', 'height'].every(key => Number.isFinite(rects.first?.[key])
    && Number.isFinite(rects.second?.[key]) && Math.abs(rects.first[key] - rects.second[key]) <= 0.25);
  const result = validateCaptureViewport(rects.second, layoutViewport, rects.visual, pageCoordinates, rects.documentViewport);
  if (!sameRect || !result.valid) {
    throw new Error(`Review canvas is not stably and fully visible with coherent document/scrollbar metrics: ${JSON.stringify({ sameRect, result, rects, layoutViewport })}`);
  }
  return { ...result, stableAcrossTwoAnimationFrames: sameRect, innerViewport: rects.inner,
    scrollCoordinates: rects.scroll, visualViewport: rects.visual, layoutViewport,
    pageCoordinates, pageMetrics: { layout: metrics.cssLayoutViewport, visual: metrics.cssVisualViewport } };
}
async function waitStableCheckpoint(description, before = null) {
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))', true);
  const first = await liveState(); await wait(120); const second = await liveState();
  if (!first || !second || first.playing || second.playing || first.bonePoseCheckpoint !== second.bonePoseCheckpoint
    || first.elapsedSeconds !== second.elapsedSeconds) throw new Error(`${description}: paused pose did not settle`);
  if (before && second.bonePoseCheckpoint !== before) throw new Error(`${description}: pose checkpoint changed across A/B`);
  return second;
}
async function capture(actor, mode, yaw, expectedState, label = '', expectedFloorVisible = false) {
  const beforeViewportScroll = await liveState();
  const captureViewport = await scrollViewIntoCaptureViewport();
  const record = await statusRecord(), state = await liveState();
  if (!beforeViewportScroll || state?.bonePoseCheckpoint !== beforeViewportScroll.bonePoseCheckpoint
    || state?.phase !== beforeViewportScroll.phase || state?.elapsedSeconds !== beforeViewportScroll.elapsedSeconds) {
    throw new Error(`Viewport scroll changed the paused production pose: ${JSON.stringify({ beforeViewportScroll, state })}`);
  }
  const liveLoadTrace = await evaluate('window.__marketLodLiveWalk?.loadTrace?.() ?? null');
  const actorLoadTrace = requireCurrentPublishedActorTrace(liveLoadTrace, actor);
  const actorPin = pin.actors.find(item => item.id === actor);
  const checks = {
    floorVisible: record.groundReferenceVisible === expectedFloorVisible,
    renderSurface: record.renderSurface?.drawingBuffer?.width === record.renderSurface?.canvasAttributes?.width && record.renderSurface?.drawingBuffer?.height === record.renderSurface?.canvasAttributes?.height && record.renderSurface?.glViewport?.length === 4 && record.renderSurface?.glScissorBox?.length === 4,
    floorRenderDiagnostic: Array.isArray(record.renderOrderDiagnostic?.floor?.path) && Array.isArray(record.renderOrderDiagnostic?.floor?.material),
    cameraState: Array.isArray(record.cameraState?.worldMatrix) && record.cameraState.worldMatrix.length === 16 && Array.isArray(record.cameraState.projectionMatrix) && record.cameraState.projectionMatrix.length === 16,
    actor: record.actor === actor, seed: record.seed === actorPin.seed,
    family: record.family === actorPin.family, body: record.normalizedLook?.body === actorPin.body,
    outfit: record.normalizedLook?.outfit === actorPin.outfit, mode: record.mode === mode,
    pose: record.pose === 'walk', exactPhase: record.walkPhase === state?.phase, yaw: record.yawDegrees === yaw, framing: record.framing === 'full-body',
    boundsInFrustum: record.fullBodyProjection?.boundsInFrustum === true,
    supportPlaneYZero: record.contact?.groundY === 0,
    finiteSupportSolve: record.contact?.supportSolve && Number.isFinite(record.contact.supportSolve.maxError),
    supportSolveUnclamped: record.contact?.supportSolve?.limited === false,
    twoSolesBeforeAndAfter: record.contact?.soles?.length === 2 && record.contact?.soleSamplesBeforeLastSolve?.length === 2,
    captureCanvasFullyVisible: captureViewport.valid === true && captureViewport.stableAcrossTwoAnimationFrames === true
      && captureViewport.layoutViewportMatchesDocument === true && captureViewport.scrollbarMetricsAgree === true,
    renderSurfaceSizeMatchesVisibleCanvas: Math.abs(record.renderSurface?.cssRect?.width - captureViewport.rect.width) <= 0.5
      && Math.abs(record.renderSurface?.cssRect?.height - captureViewport.rect.height) <= 0.5,
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
  const bounds = captureViewport.rect;
  const image = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false, clip: captureViewport.clip });
  const bytes = Buffer.from(image.data, 'base64');
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) throw new Error(`Invalid PNG for ${actor}/${mode}/${expectedFloorVisible}`);
  const pngSize = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (pngSize.width !== Math.round(bounds.width) || pngSize.height !== Math.round(bounds.height)) throw new Error(`Screenshot dimensions disagree with visible canvas clip: ${actor} ${JSON.stringify({ pngSize, captureViewport })}`);
  const filename = `${actor}-${mode}-floor-${expectedFloorVisible ? 'visible' : 'hidden'}-livewalk-yaw${yaw}${label ? `-${label}` : ''}.png`;
  await writeFile(path.join(OUT, filename), bytes, { flag: 'wx' });
  return { actor, mode, floorVisible: expectedFloorVisible, yaw, pngSize, phase: state.phase, elapsedSeconds: state.elapsedSeconds, bonePoseCheckpoint: state.bonePoseCheckpoint,
    file: filename, bytes: bytes.byteLength, sha256: sha(bytes), checks,
    metrics: { sourceTriangles: record.sourceTriangles, compactTriangles: record.compactTriangles,
      frameTriangles: record.renderer.triangles, drawCalls: record.renderer.calls,
      compactTypedGeometryBytes: record.compactStorage?.totalTypedGeometryBytes ?? null,
      fullBodyProjection: record.fullBodyProjection, contact: record.contact, loadTrace: actorLoadTrace.events,
      currentLoadGeneration: actorLoadTrace.generation,
      sourceIdentity: record.sourceIdentity, cameraState: record.cameraState, renderSurface: record.renderSurface, renderOrderDiagnostic: record.renderOrderDiagnostic,
      captureViewport, normalizedLook: record.normalizedLook, topology: record.topology } };
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
  profile = await mkdtemp(path.join(os.tmpdir(), 'market-lod-v8-floor-toggle-v5-'));
  const earlyInstrumentation = `(() => { const events=[]; const push=(item)=>{events.push({...item,at:performance.now(),wallTime:Date.now()});if(events.length>1200)events.splice(0,events.length-1200)}; const urls=new WeakMap(); const originalAbort=AbortController.prototype.abort; AbortController.prototype.abort=function(reason){push({kind:'abort',reason:String(reason??''),stack:new Error('AbortController.abort').stack});return originalAbort.call(this,reason)}; const originalFetch=window.fetch.bind(window); window.fetch=async function(input,init){const url=typeof input==='string'?input:(input?.url??String(input));push({kind:'fetch-start',url,method:init?.method??input?.method??'GET'});try{const response=await originalFetch(input,init);push({kind:'fetch-response',url,status:response.status,contentLength:response.headers.get('content-length')});if(response.body)urls.set(response.body,url);return response}catch(error){push({kind:'fetch-error',url,error:String(error),stack:error?.stack??null});throw error}}; const originalGetReader=ReadableStream.prototype.getReader; ReadableStream.prototype.getReader=function(...args){const url=urls.get(this)??null;const reader=originalGetReader.apply(this,args);const originalRead=reader.read.bind(reader);let total=0;reader.read=(...readArgs)=>originalRead(...readArgs).then(result=>{if(result?.value?.byteLength)total+=result.value.byteLength;if(result?.done)push({kind:'stream-done',url,totalBytes:total});return result});return reader}; const originalArrayBuffer=Response.prototype.arrayBuffer;Response.prototype.arrayBuffer=function(...args){const url=this.body?urls.get(this.body)??null:null;return originalArrayBuffer.apply(this,args).then(buffer=>{push({kind:'response-arrayBuffer-done',url,totalBytes:buffer.byteLength});return buffer})};Object.defineProperty(window,'__floorDiagnosticIoTrace',{value:events,configurable:false}); })();`;
  chromeLog = path.join(OUT, 'chrome.log'); chromeLogFd = openSync(chromeLog, 'wx');
  const args = ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu-sandbox','--single-process','--in-process-gpu','--no-zygote','--renderer-process-limit=1','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader','--disable-extensions','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'];
  chrome = spawn(chromePath, args, { stdio: ['ignore', chromeLogFd, chromeLogFd] });
  const port = await devtoolsPort(); await connect(port);
  await send('Page.addScriptToEvaluateOnNewDocument', { source: earlyInstrumentation });
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
    const paused = await waitStableCheckpoint(`${actor} post-walk source before floor/mode controls`, motion.finalBonePoseCheckpoint);
    const actorPairs = [];
    const setFloor = async (visible) => {
      const result = await evaluate(`window.__marketLodGroundReference?.setVisible(${visible}); true`);
      if (!result) throw new Error(`Floor toggle API unavailable for ${actor}`);
      const state = await evaluate('window.__marketLodGroundReference?.state() ?? null');
      if (state !== visible) throw new Error(`Floor visibility toggle did not settle: wanted ${visible}, got ${state}`);
      const settled = await waitStableCheckpoint(`${actor} floor ${visible ? 'visible' : 'hidden'}`, paused.bonePoseCheckpoint);
      return settled;
    };
    await setSelect('mode', 'source');
    await setFloor(false);
    const sourceHidden = await capture(actor, 'source', 0, paused, 'same-paused-pose', false);
    await setFloor(true);
    const sourceVisible = await capture(actor, 'source', 0, paused, 'same-paused-pose', true);
    await setSelect('mode', 'compact');
    const compactVisibleState = await waitStableCheckpoint(`${actor} compact visible`, paused.bonePoseCheckpoint);
    const compactVisible = await capture(actor, 'compact', 0, compactVisibleState, 'same-paused-pose', true);
    await setFloor(false);
    const compactHiddenState = await waitStableCheckpoint(`${actor} compact hidden`, paused.bonePoseCheckpoint);
    const compactHidden = await capture(actor, 'compact', 0, compactHiddenState, 'same-paused-pose', false);
    const frames = [sourceHidden, sourceVisible, compactVisible, compactHidden];
    if (frames.some(frame => frame.bonePoseCheckpoint !== paused.bonePoseCheckpoint || frame.phase !== paused.phase))
      throw new Error(`Floor/mode A/B changed the frozen pose for ${actor}`);
    const cameraContract = JSON.stringify(sourceHidden.metrics.cameraState);
    if (frames.some(frame => JSON.stringify(frame.metrics.cameraState) !== cameraContract))
      throw new Error(`Floor/mode A/B changed the camera matrix for ${actor}`);
    const pair = { actor, seed: actorPin.seed, family: actorPin.family, body: actorPin.body, outfit: actorPin.outfit,
      pausedPhase: paused.phase, elapsedSeconds: paused.elapsedSeconds, pairedPausedPoseCheckpoint: paused.bonePoseCheckpoint,
      exactCameraState: sourceHidden.metrics.cameraState,
      cameraContract: 'fixed full-body yaw0; identical live stride sample; floor and geometry toggles must preserve exact bones',
      sourceHidden: { file: sourceHidden.file, sha256: sourceHidden.sha256, metrics: sourceHidden.metrics },
      sourceVisible: { file: sourceVisible.file, sha256: sourceVisible.sha256, metrics: sourceVisible.metrics },
      compactVisible: { file: compactVisible.file, sha256: compactVisible.sha256, metrics: compactVisible.metrics },
      compactHidden: { file: compactHidden.file, sha256: compactHidden.sha256, metrics: compactHidden.metrics } };
    actorPairs.push(pair); pairs.push(pair); captures.push(...frames);
    const ioTrace = await evaluate('window.__floorDiagnosticIoTrace ?? null');
    if (!Array.isArray(ioTrace)) throw new Error('Early fetch/abort instrumentation did not install');
    diagnosticIo.push({ actor, events: ioTrace });
    if (actorPairs.length !== 1) throw new Error(`Expected one fixed-camera four-frame group for ${actor}`);
  }
  if (captures.length !== pin.captureMatrix.expectedPngCount) throw new Error(`Expected ${pin.captureMatrix.expectedPngCount} images, got ${captures.length}`);
  for (const required of [inventoryRoute, '/src/scene/body/assets/base-body-male.glb', '/src/scene/body/assets/base-body-female.glb']) {
    if (!requestLog.some(item => item.path === required && item.status === 200)) throw new Error(`Pinned source route was not fetched: ${required}`);
  }
  if (events.exceptions.length || events.consoleErrors.length || events.failedRequests.length || events.httpErrors.length) throw new Error(`Browser errors: ${JSON.stringify(events)}`);
  status = 'captured-floor-visibility-causal-diagnostic';
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
const report = { schema: 'allworld-market-lod-v8-floor-toggle-live-review-v5', status,
  success: status === 'captured-floor-visibility-causal-diagnostic' && captures.length === pin.captureMatrix.expectedPngCount,
  failure, runtime, webgl, package: { sourceRunId: pin.packageRunId, sourceCommit: pin.packageCommit,
    sourceBranch: pin.packageBranch, packageManifestSha256: pin.packageManifestSha256,
    packageSourceReceipt: packaged.sourceReceiptPath, packageSourceReceiptStatus: packaged.sourceReceipt.status },
  serverStarted: serverReady, routeLog: requestLog, requestLifecycle: [...networkRequests.values()], motionRuns, postPauseCaptures, pairs, diagnosticIo,
  captures: captures.map(item => ({ actor: item.actor, mode: item.mode, floorVisible: item.floorVisible, yaw: item.yaw, pngSize: item.pngSize,
    phase: item.phase, elapsedSeconds: item.elapsedSeconds, bonePoseCheckpoint: item.bonePoseCheckpoint,
    file: item.file, bytes: item.bytes, sha256: item.sha256, checks: item.checks, metrics: item.metrics })), events,
  limits: ['SwiftShader is diagnostic evidence only, not hardware GPU, phone performance, or battery evidence.',
    'Two saved identities do not prove all looks, outfits, all-camera angles, or whole-market budgets.',
    'All four floor/source/compact combinations per actor use the same paused phase, fixed camera yaw, and exact bone checkpoint.',
    'Abort/fetch/stream events are diagnostic only; every CDP failed request remains fatal.',
    'Viewport-contained canvas crops prevent page-background truncation; a floor-hidden screenshot alone does not prove floor occlusion.',
    'Early AbortController/fetch/stream instrumentation records diagnostics only and does not excuse CDP failed requests.',
    'Only production stride is exercised; the static interact pose is not a timed interaction animation.',
    'This run does not imply production integration or acceptance.'] };
await writeFile(path.join(OUT, 'review-results.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ status, success: report.success, failure, captures: captures.length, output: OUT }, null, 2));
if (!report.success) process.exitCode = 1;
