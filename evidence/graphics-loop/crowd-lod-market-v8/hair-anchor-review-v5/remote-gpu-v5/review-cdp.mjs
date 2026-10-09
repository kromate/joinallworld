import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, openSync, closeSync, readSync, createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { verifyHairAnchorCpuArtifact } from './verify-package.mjs';
import { requireCurrentPublishedActorTrace } from './load-trace-contract.mjs';
import { validateCaptureViewport } from './capture-viewport-contract.mjs';
import { compareReviewCaptures } from './hair-geometry-diagnostic.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INPUT = path.resolve(process.env.ARTIFACT_DIR ?? '');
const OUT = path.resolve(process.env.RESULT_DIR ?? '');
const PIN_PATH = path.resolve(process.env.HAIR_REVIEW_PIN_PATH ?? path.join(HERE, 'artifact-pin.json'));
if (process.platform !== 'linux') throw new Error('Remote Linux only; local execution is refused');
if (!path.isAbsolute(INPUT) || !path.isAbsolute(OUT) || INPUT === OUT) throw new Error('ARTIFACT_DIR and distinct RESULT_DIR must be absolute');
const pin = JSON.parse(await readFile(PIN_PATH, 'utf8'));
const placeholder = value => typeof value !== 'string' || value.includes('__ROOT_TO_PIN');
if (pin.schema !== 'allworld-market-lod-v8-hair-anchor-live-pin-v5'
  || placeholder(pin.packageRunId) || !/^\d+$/.test(String(pin.packageRunId))
  || placeholder(pin.packageCommit) || placeholder(pin.packageBranch) || placeholder(pin.packageManifestSha256)
  || placeholder(pin.builderSha256) || placeholder(pin.sourceManifestSha256)
  || !/^[a-f0-9]{64}$/.test(pin.packageManifestSha256) || !/^[a-f0-9]{64}$/.test(pin.sourceManifestSha256)
  || process.env.PACKAGE_RUN_ID !== String(pin.packageRunId)
  || process.env.PACKAGE_COMMIT !== pin.packageCommit || process.env.PACKAGE_BRANCH !== pin.packageBranch
  || !/^[a-f0-9]{64}$/.test(pin.candidateGeometrySha256) || pin.captureMatrix?.expectedPngCount !== 16 || pin.captureMatrix?.fixedPhase !== 0.25 || pin.captureMatrix?.minimumLiveElapsedSeconds !== 2.4 || JSON.stringify(pin.captureMatrix?.yawsDegrees) !== JSON.stringify([0, 90]) || JSON.stringify(pin.captureMatrix?.hairModes) !== JSON.stringify(['source','candidate']) || pin.actors.length !== 2 || pin.captureMatrix?.bodyGeometryModes?.join(',') !== 'source,compact') {
  throw new Error('Live-review package pin is incomplete or disagrees with the workflow run inputs');
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const shaFile = async file => { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); };

if (!existsSync(OUT)) await mkdir(OUT, { recursive: false });
const outputEntries = await (await import('node:fs/promises')).readdir(OUT);
if (outputEntries.some(name => name !== 'review-cdp.log')) throw new Error('Refusing to overwrite existing review output');
let packaged;
try {
  packaged = await verifyHairAnchorCpuArtifact(INPUT, pin);
} catch (error) {
  const failure = error instanceof Error ? error.stack ?? error.message : String(error);
  await writeFile(path.join(OUT, 'review-results.json'), `${JSON.stringify({
    schema: 'allworld-market-lod-v8-hair-anchor-live-review-v5', status: 'package-verification-failed', success: false, failure,
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
const geometryGuardDiagnostics = [];
async function persistGeometryDiagnostics() {
  await writeFile(path.join(OUT, 'hair-geometry-guard-operands.json'), `${JSON.stringify({
    schema: 'allworld-market-lod-v8-hair-geometry-guard-operands-v5',
    status: 'diagnostic-only-invalid-until-all-strict-checks-pass',
    cpuPackageRunId: pin.packageRunId, cpuPackageCommit: pin.packageCommit,
    captures: captures.map(item => ({ actor: item.actor, hairAnchor: item.hairAnchor, mode: item.mode, yaw: item.yaw,
      file: item.file, sha256: item.sha256, normalizedLook: item.metrics.normalizedLook,
      cameraState: item.metrics.cameraState, actualHairGeometryWitness: item.metrics.actualHairGeometryWitness,
      recipeHairMap: item.metrics.recipeMetrics?.wardrobe?.find(entry => entry.id === `hair:${item.metrics.normalizedLook?.hair}`) ?? null })),
    comparisons: geometryGuardDiagnostics,
    note: 'Persisted before any comparison can reject the pair. Diagnostic PNGs are not accepted captures unless exactGuardPassed is true for every pair and the full result succeeds.',
  }, null, 2)}\n`);
}
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
async function capture(actor, mode, hairAnchor, yaw, expectedState, expectedCameraState) {
  const beforeViewportScroll = await liveState();
  const captureViewport = await scrollViewIntoCaptureViewport();
  const freshHairWitness = await evaluate('window.__marketLodHairReview?.refreshWitness?.() ?? null', true);
  if (!freshHairWitness) throw new Error(`No fresh hair geometry witness at settled capture: ${actor}/${hairAnchor}/${mode}/yaw${yaw}`);
  const record = await statusRecord(), state = await liveState();
  if (!beforeViewportScroll || state?.bonePoseCheckpoint !== beforeViewportScroll.bonePoseCheckpoint
    || state?.phase !== beforeViewportScroll.phase || state?.elapsedSeconds !== beforeViewportScroll.elapsedSeconds) {
    throw new Error(`Viewport scroll changed the paused production pose: ${JSON.stringify({ beforeViewportScroll, state })}`);
  }
  const liveLoadTrace = await evaluate('window.__marketLodLiveWalk?.loadTrace?.() ?? null');
  const actorLoadTrace = requireCurrentPublishedActorTrace(liveLoadTrace, actor);
  const actorPin = pin.actors.find(item => item.id === actor);
  const hairWitness = record.actualHairGeometryWitness;
  const eyeWitness = hairWitness?.eyeVisibilityFromActualEyeUvTriangles;
  const placement = hairWitness?.placement;
  const checks = {
    renderSurface: record.renderSurface?.drawingBuffer?.width === record.renderSurface?.canvasAttributes?.width
      && record.renderSurface?.drawingBuffer?.height === record.renderSurface?.canvasAttributes?.height
      && record.renderSurface?.glViewport?.length === 4 && record.renderSurface?.glScissorBox?.length === 4,
    cameraState: Array.isArray(record.cameraState?.worldMatrix) && record.cameraState.worldMatrix.length === 16
      && Array.isArray(record.cameraState.projectionMatrix) && record.cameraState.projectionMatrix.length === 16,
    frozenCamera: JSON.stringify(record.cameraState) === JSON.stringify(expectedCameraState),
    actor: record.actor === actor, seed: record.seed === actorPin.seed,
    family: record.family === actorPin.family, body: record.normalizedLook?.body === actorPin.body,
    outfit: record.normalizedLook?.outfit === actorPin.outfit,
    mode: record.mode === mode, hairAnchorMode: record.hairAnchorMode === hairAnchor,
    hairCandidateCode: record.hairCandidateModuleSha256 === pin.candidateGeometrySha256,
    pose: record.pose === 'walk', exactPhase: record.walkPhase === state?.phase && Math.abs(record.walkPhase - pin.captureMatrix.fixedPhase) < 1e-8,
    yaw: record.yawDegrees === yaw, framing: record.framing === 'full-body',
    boundsInFrustum: record.fullBodyProjection?.boundsInFrustum === true,
    sourceIdentity: typeof record.sourceIdentity?.assetSha === 'string' && /^[a-f0-9]{64}$/.test(record.sourceIdentity.assetSha),
    hairPlacementModeAndStyle: placement?.mode === hairAnchor && placement?.style === record.normalizedLook?.hair,
    actualHeadSamples: Number.isInteger(hairWitness?.actualHeadVertexBoundsWorldSceneUnits?.vertexCount) && hairWitness.actualHeadVertexBoundsWorldSceneUnits.vertexCount > 0,
    actualScalpSamples: Number.isInteger(hairWitness?.actualScalpVertexBoundsWorldSceneUnits?.vertexCount) && hairWitness.actualScalpVertexBoundsWorldSceneUnits.vertexCount > 0,
    actualGeneratedHair: Number.isInteger(hairWitness?.generatedHairVertices) && hairWitness.generatedHairVertices > 0
      && Number.isInteger(hairWitness?.generatedHairTriangles) && hairWitness.generatedHairTriangles > 0,
    hairStyleAttributes: ['color', 'skinIndex', 'skinWeight'].every(name =>
      Number.isInteger(hairWitness?.hairAttributeSignatures?.[name]?.bytes)
      && /^[a-f0-9]{64}$/.test(hairWitness.hairAttributeSignatures[name].sha256)),
    hairToHeadVertexProximity: Number.isFinite(hairWitness?.nearestGeneratedHairToHeadVertexDistanceSceneUnits?.min)
      && Number.isFinite(hairWitness?.nearestGeneratedHairToHeadVertexDistanceSceneUnits?.median),
    bothEyeUvReports: eyeWitness && Number.isInteger(eyeWitness.left?.sampledActualBodyTriangles)
      && Number.isInteger(eyeWitness.right?.sampledActualBodyTriangles)
      && Number.isInteger(eyeWitness.left?.hairOccludedSamples) && Number.isInteger(eyeWitness.right?.hairOccludedSamples),
    cameraCaptureContained: captureViewport.valid === true && captureViewport.stableAcrossTwoAnimationFrames === true
      && captureViewport.layoutViewportMatchesDocument === true && captureViewport.scrollbarMetricsAgree === true,
    renderSurfaceSizeMatchesVisibleCanvas: Math.abs(record.renderSurface?.cssRect?.width - captureViewport.rect.width) <= 0.5
      && Math.abs(record.renderSurface?.cssRect?.height - captureViewport.rect.height) <= 0.5,
    actorLoadTracePresent: actorLoadTrace.events.some(item => item.stage === 'actor-published'),
    actorLoadTraceCurrentGeneration: actorLoadTrace.generation === Math.max(...liveLoadTrace.map(item => item.generation)),
    paused: state?.playing === false, elapsed: state?.elapsedSeconds >= pin.captureMatrix.minimumLiveElapsedSeconds,
    checkpoint: state?.bonePoseCheckpoint === expectedState.bonePoseCheckpoint,
    canvas: record.fullBodyProjection?.canvasWidth > 0 && record.fullBodyProjection?.canvasHeight > 0,
    renderer: record.renderer?.calls > 0 && record.renderer?.triangles > 0,
  };
  if (Object.values(checks).some(value => value !== true)) throw new Error(`Refused frame ${actor}/${hairAnchor}/${mode}/yaw${yaw}: ${JSON.stringify({ checks, record, state })}`);
  const bounds = captureViewport.rect;
  const image = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false, clip: captureViewport.clip });
  const bytes = Buffer.from(image.data, 'base64');
  if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) throw new Error(`Invalid PNG for ${actor}/${hairAnchor}/${mode}/yaw${yaw}`);
  const pngSize = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (pngSize.width !== Math.round(bounds.width) || pngSize.height !== Math.round(bounds.height)) throw new Error(`Screenshot dimensions disagree with visible canvas clip: ${actor} ${JSON.stringify({ pngSize, captureViewport })}`);
  const filename = `${actor}-${hairAnchor}-${mode}-walk-yaw${yaw}.png`;
  await writeFile(path.join(OUT, filename), bytes, { flag: 'wx' });
  return { actor, hairAnchor, mode, yaw, pngSize, phase: state.phase, elapsedSeconds: state.elapsedSeconds,
    bonePoseCheckpoint: state.bonePoseCheckpoint, file: filename, bytes: bytes.byteLength, sha256: sha(bytes), checks,
    metrics: { sourceTriangles: record.sourceTriangles, compactTriangles: record.compactTriangles,
      frameTriangles: record.renderer.triangles, drawCalls: record.renderer.calls, fullBodyProjection: record.fullBodyProjection,
      cameraState: record.cameraState, renderSurface: record.renderSurface, captureViewport, normalizedLook: record.normalizedLook,
      sourceIdentity: record.sourceIdentity, hairCandidateModuleSha256: record.hairCandidateModuleSha256,
      hairAnchorMode: record.hairAnchorMode, actualHairGeometryWitness: hairWitness,
      recipeMetrics: record.recipeMetrics, topology: record.topology } };
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
  runtime.chromeFlags = ['--use-gl=angle', '--use-angle=swiftshader'];
  runtime.processGroupRssLimitMiB = 2048;
  runtime.chromeTopology = 'Constrained SwiftShader diagnostic configuration; not representative of ordinary multi-process or mobile performance.';
  const address = await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address())); });
  if (!address || typeof address === 'string' || address.address !== '127.0.0.1') throw new Error('Static server must bind loopback only');
  serverAddress = address; serverReady = true;
  profile = await mkdtemp(path.join(os.tmpdir(), 'market-lod-v8-hair-anchor-v1-'));
  const earlyInstrumentation = `(() => { const events=[]; const push=(item)=>{events.push({...item,at:performance.now(),wallTime:Date.now()});if(events.length>1200)events.splice(0,events.length-1200)}; const urls=new WeakMap(); const originalAbort=AbortController.prototype.abort; AbortController.prototype.abort=function(reason){push({kind:'abort',reason:String(reason??''),stack:new Error('AbortController.abort').stack});return originalAbort.call(this,reason)}; const originalFetch=window.fetch.bind(window); window.fetch=async function(input,init){const url=typeof input==='string'?input:(input?.url??String(input));push({kind:'fetch-start',url,method:init?.method??input?.method??'GET'});try{const response=await originalFetch(input,init);push({kind:'fetch-response',url,status:response.status,contentLength:response.headers.get('content-length')});if(response.body)urls.set(response.body,url);return response}catch(error){push({kind:'fetch-error',url,error:String(error),stack:error?.stack??null});throw error}}; const originalGetReader=ReadableStream.prototype.getReader; ReadableStream.prototype.getReader=function(...args){const url=urls.get(this)??null;const reader=originalGetReader.apply(this,args);const originalRead=reader.read.bind(reader);let total=0;reader.read=(...readArgs)=>originalRead(...readArgs).then(result=>{if(result?.value?.byteLength)total+=result.value.byteLength;if(result?.done)push({kind:'stream-done',url,totalBytes:total});return result});return reader}; const originalArrayBuffer=Response.prototype.arrayBuffer;Response.prototype.arrayBuffer=function(...args){const url=this.body?urls.get(this.body)??null:null;return originalArrayBuffer.apply(this,args).then(buffer=>{push({kind:'response-arrayBuffer-done',url,totalBytes:buffer.byteLength});return buffer})};Object.defineProperty(window,'__hairAnchorDiagnosticIoTrace',{value:events,configurable:false}); })();`;
  chromeLog = path.join(OUT, 'chrome.log'); chromeLogFd = openSync(chromeLog, 'wx');
  const args = ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader','--disable-extensions','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'];
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
    const actorFrames = [];
    let baselineCameraByYaw = {}, sourceWitness = null, referenceCheckpoint = null;
    for (const hairAnchor of pin.captureMatrix.hairModes) {
      await evaluate(`(()=>{const actorEl=document.getElementById('actor'),hairEl=document.getElementById('hair-anchor'),modeEl=document.getElementById('mode');actorEl.value=${JSON.stringify(actor)};hairEl.value=${JSON.stringify(hairAnchor)};modeEl.value='source';document.getElementById('load').click();return true})()`);
      await waitFor(async () => await evaluate(`document.documentElement.dataset.ready === 'true' && document.documentElement.dataset.actor === ${JSON.stringify(actor)} && document.documentElement.dataset.mode === 'source' && document.documentElement.dataset.hairAnchor === ${JSON.stringify(hairAnchor)}`).catch(() => false), `hair mode load ${actor}/${hairAnchor}`, 20000);
      await setSelect('framing', 'full-body'); await setSelect('yaw', 0); await setSelect('phase', pin.captureMatrix.fixedPhase); await setSelect('pose', 'walk');
      const motion = await waitForLiveMotion(actor); motionRuns.push({ ...motion, hairAnchor });
      await setSelect('phase', pin.captureMatrix.fixedPhase);
      const paused = await waitStableCheckpoint(`${actor}/${hairAnchor} fixed walk phase`);
      if (referenceCheckpoint && paused.bonePoseCheckpoint !== referenceCheckpoint) throw new Error(`Actor skeleton pose differs across hair modes: ${actor}`);
      referenceCheckpoint ??= paused.bonePoseCheckpoint;
      const modeFrames = [];
      for (const yaw of pin.captureMatrix.yawsDegrees) {
        await setSelect('yaw', yaw);
        await setSelect('mode', 'source');
        if (hairAnchor === 'source') {
          await setSelect('framing', 'full-body');
        } else {
          const camera = baselineCameraByYaw?.[yaw];
          if (!camera) throw new Error(`Missing source-mode frozen camera for ${actor} yaw ${yaw}`);
          const setCamera = await evaluate(`window.__marketLodHairReview?.setCameraState(${JSON.stringify({ position: camera.position, quaternion: camera.quaternion, target: camera.target })}); true`);
          if (!setCamera) throw new Error('Hair review frozen-camera API unavailable');
        }
        const sourceRecord = await statusRecord(), sourceState = await liveState();
        if (sourceState?.bonePoseCheckpoint !== paused.bonePoseCheckpoint || sourceState?.phase !== pin.captureMatrix.fixedPhase) throw new Error(`Source pose did not match fixed phase ${actor}/${hairAnchor}`);
        if (hairAnchor === 'source') {
          baselineCameraByYaw ??= {};
          baselineCameraByYaw[yaw] = sourceRecord.cameraState;
        }
        const sourceShot = await capture(actor, 'source', hairAnchor, yaw, paused, baselineCameraByYaw[yaw]);
        captures.push(sourceShot);
        await persistGeometryDiagnostics();
        await setSelect('mode', 'compact');
        const frozenCamera = baselineCameraByYaw[yaw];
        await evaluate(`window.__marketLodHairReview?.setCameraState(${JSON.stringify({ position: frozenCamera.position, quaternion: frozenCamera.quaternion, target: frozenCamera.target })}); true`);
        const compactState = await waitStableCheckpoint(`${actor}/${hairAnchor}/compact yaw${yaw}`, paused.bonePoseCheckpoint);
        const compactShot = await capture(actor, 'compact', hairAnchor, yaw, compactState, frozenCamera);
        captures.push(compactShot);
        await persistGeometryDiagnostics();
        const geometryDiagnostic = compareReviewCaptures(sourceShot, compactShot, `hair:${sourceShot.metrics.normalizedLook?.hair}`);
        geometryGuardDiagnostics.push({ actor, hairAnchor, yaw, strict: geometryDiagnostic });
        await persistGeometryDiagnostics();
        const sourceHair = sourceShot.metrics.actualHairGeometryWitness;
        if (hairAnchor === 'source') sourceWitness ??= sourceHair;
        if (sourceWitness && JSON.stringify(sourceWitness.placement.radii) !== JSON.stringify(sourceHair.placement.radii)) throw new Error(`Hair dimensions changed across anchor modes: ${actor}`);
        const cameraContract = JSON.stringify(frozenCamera);
        if (JSON.stringify(sourceShot.metrics.cameraState) !== cameraContract || JSON.stringify(compactShot.metrics.cameraState) !== cameraContract) throw new Error(`Camera changed across source/compact A/B: ${actor}/${hairAnchor}/yaw${yaw}`);
        const pair = { actor, seed: actorPin.seed, family: actorPin.family, body: actorPin.body, outfit: actorPin.outfit,
          hairAnchor, yaw, fixedPhase: pin.captureMatrix.fixedPhase, elapsedSeconds: paused.elapsedSeconds,
          sameActorBoneCheckpoint: paused.bonePoseCheckpoint, cameraState: frozenCamera,
          cameraContract: 'Same body bounds camera from source hair mode, replayed exactly across anchor modes and source/compact geometry.',
          source: { file: sourceShot.file, sha256: sourceShot.sha256, metrics: sourceShot.metrics },
          compact: { file: compactShot.file, sha256: compactShot.sha256, metrics: compactShot.metrics } };
        modeFrames.push(pair); pairs.push(pair); actorFrames.push(pair);
      }
      const ioTrace = await evaluate('window.__hairAnchorDiagnosticIoTrace ?? null');
      if (!Array.isArray(ioTrace)) throw new Error('Early fetch/abort instrumentation did not install');
      diagnosticIo.push({ actor, hairAnchor, events: ioTrace });
      if (modeFrames.length !== 2) throw new Error(`Expected front/profile images for ${actor}/${hairAnchor}`);
      const failedGuards = geometryGuardDiagnostics.filter(item => !item.strict.exactGuardPassed);
      if (failedGuards.length) throw new Error(`Strict geometry A/B guard rejected diagnostic pairs after all requested views were recorded: ${JSON.stringify(failedGuards.map(item => ({ actor: item.actor, hairAnchor: item.hairAnchor, yaw: item.yaw, checks: item.strict.checks })))}`);
    }
    if (actorFrames.length !== pin.captureMatrix.yawsDegrees.length * pin.captureMatrix.hairModes.length) throw new Error(`Expected one source/compact pair per pinned yaw for ${actor}`);
    if (pin.captureMatrix.hairModes.length > 1) {
      const sourcePair = actorFrames.find(item => item.hairAnchor === 'source' && item.yaw === 0);
      const candidatePair = actorFrames.find(item => item.hairAnchor === 'candidate' && item.yaw === 0);
      if (!sourcePair || !candidatePair || sourcePair.fixedPhase !== candidatePair.fixedPhase
        || sourcePair.sameActorBoneCheckpoint !== candidatePair.sameActorBoneCheckpoint) throw new Error(`Hair source/candidate identity or pose did not pair: ${actor}`);
      const sourceMeta = sourcePair.source.metrics, candidateMeta = candidatePair.source.metrics;
      const sourceHair = sourceMeta.actualHairGeometryWitness, candidateHair = candidateMeta.actualHairGeometryWitness;
      if (JSON.stringify(sourceMeta.normalizedLook) !== JSON.stringify(candidateMeta.normalizedLook)
        || JSON.stringify(sourceHair.actualHeadVertexBoundsWorldSceneUnits) !== JSON.stringify(candidateHair.actualHeadVertexBoundsWorldSceneUnits)
        || JSON.stringify(sourceHair.actualScalpVertexBoundsWorldSceneUnits) !== JSON.stringify(candidateHair.actualScalpVertexBoundsWorldSceneUnits)
        || sourceHair.generatedHairVertices !== candidateHair.generatedHairVertices
        || sourceHair.generatedHairTriangles !== candidateHair.generatedHairTriangles
        || JSON.stringify(sourceHair.hairAttributeSignatures) !== JSON.stringify(candidateHair.hairAttributeSignatures)
        || JSON.stringify(sourceHair.placement.radii) !== JSON.stringify(candidateHair.placement.radii)) {
        throw new Error(`Hair-only candidate changed look, posed head/scalp vertices, or style geometry dimensions for ${actor}`);
      }
    }
  }
  if (captures.length !== pin.captureMatrix.expectedPngCount) throw new Error(`Expected ${pin.captureMatrix.expectedPngCount} images, got ${captures.length}`);
  const required = [inventoryRoute, ...new Set(pin.actors.map(actor => `/src/scene/body/assets/base-body-${actor.family}.glb`))];
  for (const route of required) {
    if (!requestLog.some(item => item.path === route && item.status === 200)) throw new Error(`Pinned source route was not fetched: ${route}`);
  }
  if (events.exceptions.length || events.consoleErrors.length || events.failedRequests.length || events.httpErrors.length) throw new Error(`Browser errors: ${JSON.stringify(events)}`);
  status = 'captured-hair-anchor-16-view-diagnostic';
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
const report = { schema: 'allworld-market-lod-v8-hair-anchor-live-review-v5', status,
  success: status === 'captured-hair-anchor-16-view-diagnostic' && captures.length === pin.captureMatrix.expectedPngCount,
  failure, runtime, webgl, package: { sourceRunId: pin.packageRunId, sourceCommit: pin.packageCommit,
    sourceBranch: pin.packageBranch, packageManifestSha256: pin.packageManifestSha256,
    packageSourceReceipt: packaged.sourceReceiptPath, packageSourceReceiptStatus: packaged.sourceReceipt.status },
  serverStarted: serverReady, routeLog: requestLog, requestLifecycle: [...networkRequests.values()], motionRuns, postPauseCaptures, pairs, diagnosticIo,
  geometryGuardDiagnostics,
  captures: captures.map(item => ({ actor: item.actor, mode: item.mode, hairAnchor: item.hairAnchor, yaw: item.yaw, pngSize: item.pngSize,
    phase: item.phase, elapsedSeconds: item.elapsedSeconds, bonePoseCheckpoint: item.bonePoseCheckpoint,
    file: item.file, bytes: item.bytes, sha256: item.sha256, checks: item.checks, metrics: item.metrics })), events,
  limits: ['SwiftShader is diagnostic evidence only, not hardware GPU, phone performance, or battery evidence.',
    'Two saved identities do not prove all looks, outfits, all-camera angles, or whole-market budgets.',
    'Head/hairstyle vertex proximity and UV-ray counts do not establish continuous scalp contact or pixel-level eye visibility; the PNGs require independent visual review.',
    'The sixteen source/candidate × source/compact geometry diagnostic frames share one saved identity, exact paused walk phase, and frozen camera per yaw; any strict guard mismatch fails the run.',
    'Abort/fetch/stream traces are diagnostic only; every CDP failed request remains fatal.',
    'Viewport-contained canvas crops prevent page-background truncation.',
    'Only production stride is exercised; no timed interaction animation is claimed.',
    'This run does not imply production integration or acceptance.'] };
await writeFile(path.join(OUT, 'review-results.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ status, success: report.success, failure, captures: captures.length, output: OUT }, null, 2));
if (!report.success) process.exitCode = 1;
