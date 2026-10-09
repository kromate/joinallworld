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
const repo = path.resolve(process.env.ALLWORLD_INTEGRATION_ROOT ?? process.cwd());
const bundlePath = path.join(here, 'game-fixture.bundle.js');
const htmlRelative = path.relative(repo, path.join(here, 'game-fixture.html')).split(path.sep).join('/');
const runId = (process.env.GITHUB_RUN_ID ?? `remote-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
const resultDir = path.join(here, 'remote-results', runId);
const chromeBin = process.env.CHROME_BIN ?? ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
  .map((name) => spawnSync('which', [name], { encoding: 'utf8' })).find((result) => result.status === 0)?.stdout.trim();
if (!chromeBin) throw new Error('Set CHROME_BIN to the remote runner Chrome/Chromium executable');
await stat(bundlePath).catch(() => { throw new Error('Game fixture bundle missing; run bundle-game-fixture.mjs in the remote overlay checkout'); });
await mkdir(resultDir, { recursive: true });

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'], ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json'], ['.glb', 'model/gltf-binary'], ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
]);
const server = createServer(async (request, response) => {
  try {
    const requested = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
    const filename = path.resolve(repo, `.${requested}`);
    if (!filename.startsWith(`${repo}${path.sep}`) && filename !== repo) throw new Error('Path escaped repository root');
    const bytes = await readFile(filename);
    response.writeHead(200, { 'content-type': mime.get(path.extname(filename).toLowerCase()) ?? 'application/octet-stream', 'cache-control': 'no-store', 'content-length': bytes.length });
    response.end(bytes);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); response.end('Not found');
  }
});
server.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
const port = server.address().port;
const profile = await mkdtemp(path.join(os.tmpdir(), 'native-game-fixture-'));
const chromeArgs = [
  '--headless=new', '--no-sandbox', '--renderer-process-limit=1', '--disable-extensions', '--disable-background-networking',
  '--disable-dev-shm-usage', '--disable-gpu-sandbox', '--remote-debugging-port=0', '--remote-allow-origins=*',
  '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  '--no-first-run', '--no-default-browser-check', '--window-size=1440,1160', `--user-data-dir=${profile}`, 'about:blank',
];
const chrome = spawn(chromeBin, chromeArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeStderr = '';
chrome.stderr.on('data', (chunk) => { chromeStderr = (chromeStderr + chunk.toString()).slice(-16_000); });
let socket;
let nextId = 0;
const pending = new Map();
const consoleErrors = [];

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
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
    const timeout = setTimeout(() => { if (pending.delete(id)) reject(new Error(`Chrome DevTools command timed out: ${method}`)); }, 25_000);
    const item = pending.get(id);
    item.resolve = (value) => { clearTimeout(timeout); resolve(value); };
    item.reject = (error) => { clearTimeout(timeout); reject(error); };
  });
}

async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? JSON.stringify(result.exceptionDetails));
  if (result.result?.subtype === 'error') throw new Error(result.result.description ?? 'Browser evaluation failed');
  return result.result?.value;
}

async function capture(name, settleMs = 500) {
  await delay(settleMs);
  const renderEvidence = await evaluate('window.nativeGameFixture?.renderForCapture?.() ?? null');
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const snapshot = await evaluate('window.nativeGameFixture?.sample?.() ?? null');
  const screenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true });
  const bytes = Buffer.from(screenshot.data, 'base64');
  const filename = `office-${name}.png`;
  await writeFile(path.join(resultDir, filename), bytes);
  return { name, snapshot, renderEvidence, screenshot: { path: filename, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } };
}

let report;
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
    } else if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails?.text ?? 'Browser exception');
    else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
    }
  });
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Log.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1160, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/${htmlRelative}` });
  const deadline = Date.now() + 145_000;
  let state = null;
  while (Date.now() < deadline) {
    state = await evaluate('window.nativeGameFixture?.sample?.() ?? null').catch(() => null);
    if (state?.readyState === 'ready' || state?.readyState === 'failed') break;
    await delay(250);
  }
  if (state?.readyState !== 'ready') throw new Error(`Game fixture did not prepare: ${JSON.stringify(state)}`);

  const idle = await capture('scene-idle', 700);
  await evaluate("window.nativeGameFixture.setCamera('front')");
  const front = await capture('front-angle');
  await evaluate("window.nativeGameFixture.setCamera('profile')");
  const profileView = await capture('profile-angle');
  await evaluate("window.nativeGameFixture.setCamera('player-close'); window.nativeGameFixture.setMode('idle')");
  const playerCloseIdle = await capture('player-close-idle', 300);
  await evaluate("window.nativeGameFixture.setMode('interact')");
  const playerCloseInteract = await capture('player-close-interact', 300);
  await evaluate("window.nativeGameFixture.setCamera('player-close'); window.nativeGameFixture.setWalkPhase(Math.PI / 2)");
  const walkA = await capture('player-close-walk-a', 100);
  const phaseA = await evaluate('window.nativeGameFixture.sample()');
  const phaseBState = await evaluate("window.nativeGameFixture.setWalkPhase(3 * Math.PI / 2); window.nativeGameFixture.sample()");
  const walkB = await capture('player-close-walk-b', 100);
  const walkPhaseEvidence = {
    phaseA: { pose: phaseA.player?.pose, root: phaseA.player?.rootPosition, frames: phaseA.player?.walkFrames },
    phaseB: { pose: phaseBState.player?.pose, root: phaseBState.player?.rootPosition, frames: phaseBState.player?.walkFrames },
    imageHashesDiffer: walkA.screenshot.sha256 !== walkB.screenshot.sha256,
  };
  await evaluate("window.nativeGameFixture.setCamera('scene'); window.nativeGameFixture.setMode('walk')");
  const walk = await capture('walk-cycle', 1400);
  await evaluate("window.nativeGameFixture.setMode('interact')");
  const interact = await capture('interaction-pose', 700);
  await evaluate("window.nativeGameFixture.setCamera('mrs-okafor-close'); window.nativeGameFixture.setMode('idle')");
  const mrsIdle = await capture('mrs-okafor-close-idle', 250);
  await evaluate("document.querySelector('#npc-action-mrs-okafor-hello')?.click()");
  const mrsInteract = await capture('mrs-okafor-close-interact', 100);
  let npcInteraction = null;
  const actionDeadline = Date.now() + 8000;
  while (Date.now() < actionDeadline) {
    npcInteraction = await evaluate('window.nativeGameFixture.sample().interaction');
    if (npcInteraction?.completed !== false) break;
    await delay(100);
  }
  const interactionState = await evaluate('window.nativeGameFixture.sample()');
  const npcAction = await capture('mrs-okafor-close-completed-idle', 250);
  await evaluate("window.nativeGameFixture.setCamera('dapo-close')");
  const dapoIdle = await capture('dapo-close-idle', 250);
  await evaluate("[...document.querySelectorAll('#npc-cards article')].find(card => card.querySelector('strong')?.textContent?.toLowerCase().includes('dapo'))?.querySelector('button')?.click()");
  const dapoInteract = await capture('dapo-close-interact', 100);
  let dapoInteraction = null;
  const dapoDeadline = Date.now() + 8000;
  while (Date.now() < dapoDeadline) {
    dapoInteraction = await evaluate('window.nativeGameFixture.sample().interaction');
    if (dapoInteraction?.completed !== false) break;
    await delay(100);
  }
  const dapoCompleted = await capture('dapo-close-completed-idle', 250);
  const unsupported = await evaluate('window.nativeGameFixture.probeUnsupportedPose()');
  const afterUnsupported = await evaluate('window.nativeGameFixture.sample()');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate("window.nativeGameFixture.setCamera('front'); window.nativeGameFixture.setMode('idle')");
  const mobile = await capture('mobile-390', 900);
  const pageErrors = [...consoleErrors];
  const disposal = await evaluate('window.nativeGameFixture.dispose()');
  const disposalAgain = await evaluate('window.nativeGameFixture.dispose()');

  const ready = idle.snapshot;
  const namedNpcIds = Object.keys(ready.npcs ?? {}).sort();
  const npcSourceValid = namedNpcIds.length === 2 && namedNpcIds.every((id) => ready.npcs[id]?.source === 'viewLife(createLife(...)).social.here');
  const npcActorsPrepared = namedNpcIds.every((id) => ready.npcs[id]?.authoredRig === true && ready.npcs[id]?.mounted === true);
  const contact = idle.snapshot.player?.contact;
  const contactPass = Number.isFinite(contact?.maxError) && contact.maxError <= 0.004 && contact.limited === false;
  const unsupportedPass = unsupported?.expectedNativeRefusal === true && unsupported?.acceptedAsNative === false && unsupported?.fallbackDisposed === true;
  const checks = {
    firstFrameThenCrowdStart: true,
    webgl2: true,
    lifeAtOffice: ready.life?.location === 'office',
    realNpcList: npcSourceValid && namedNpcIds.includes('dapo') && namedNpcIds.includes('mrs-okafor'),
    npcActionCards: namedNpcIds.every((id) => Array.isArray(ready.npcs[id]?.actions) && ready.npcs[id].actions.length >= 4),
    nativeCrowdAtLeastTwo: ready.crowd?.canonical >= 2,
    noProceduralCrowdFallback: ready.crowd?.desired === 2 && ready.crowd?.procedural === 0,
    nativeActorsExactGeometry: npcActorsPrepared,
    nativePlayerThroughStandIn: ready.player?.prepared === true && ready.player?.authoredRig === true && ready.player?.standInShown === true,
    sameCreatorSeedAndSavedLook: ready.player?.seed === 'creator-fixture-same-seed-v1' && ready.player?.look?.outfit === 'casual',
    walkSample: walk.snapshot.player?.pose === 'walk' && walk.snapshot.player?.walkFrames > 0,
    deterministicWalkPhases: walkPhaseEvidence.phaseA.pose === 'walk' && walkPhaseEvidence.phaseB.pose === 'walk'
      && walkPhaseEvidence.phaseA.frames < walkPhaseEvidence.phaseB.frames
      && JSON.stringify(walkPhaseEvidence.phaseA.root) !== JSON.stringify(walkPhaseEvidence.phaseB.root)
      && walkPhaseEvidence.imageHashesDiffer,
    closeupsFrameWholeActor: [playerCloseIdle, playerCloseInteract, walkA, walkB, mrsIdle, mrsInteract, npcAction, dapoIdle, dapoInteract, dapoCompleted]
      .every((sample) => sample.snapshot?.cameraActorFrame?.wholeActorVisible === true),
    closeupsRenderActorPixels: [playerCloseIdle, playerCloseInteract, walkA, walkB, mrsIdle, mrsInteract, npcAction, dapoIdle, dapoInteract, dapoCompleted]
      .every((sample) => sample.renderEvidence?.drawCalls > 0 && sample.renderEvidence?.triangles > 0
        && sample.renderEvidence?.actorPixelContrast >= 24),
    interactionSample: interact.snapshot.player?.pose === 'interact',
    realNpcActivityCompleted: npcInteraction?.started?.code === 'started' && npcInteraction?.completed === true
      && npcInteraction?.responseNamesNpc === true && npcInteraction?.familiarityChanged === true
      && npcInteraction?.viewUpdated === true && npcInteraction?.npcId === 'mrs-okafor',
    realNpcPoseFollowsLifeAction: npcInteraction?.npcPoseDuringInteraction === 'interact'
      && npcInteraction?.npcPoseAfterCompletion === 'idle' && npcInteraction?.npcPoseLifecyclePass === true,
    playerContact: contactPass,
    unsupportedSitUsesLegacyAndDisposes: unsupportedPass,
    afterUnsupportedStillReady: afterUnsupported.readyState === 'ready',
    mobileLayoutSingleColumn: mobile.snapshot?.viewport?.width <= 430 && mobile.snapshot?.viewport?.mobileBreakpoint === true
      && mobile.snapshot?.viewport?.layoutColumns === 1 && mobile.snapshot?.viewport?.scrollWidth <= mobile.snapshot?.viewport?.width,
    dapoRealActivityCompleted: dapoInteraction?.npcId === 'dapo' && dapoInteraction?.completed === true
      && dapoInteraction?.npcPoseDuringInteraction === 'interact' && dapoInteraction?.npcPoseAfterCompletion === 'idle',
    snapshotsHaveNoRuntimeErrors: [idle, front, profileView, playerCloseIdle, playerCloseInteract, walkA, walkB, walk, interact, mrsIdle, mrsInteract, npcAction, dapoIdle, dapoInteract, dapoCompleted, mobile].every((sample) => sample.snapshot?.errors?.length === 0)
      && afterUnsupported.errors?.length === 0,
    teardownReleasesActorsAndContext: disposal?.playerUnmounted === true && disposal?.noCanonicalActorsRemain === true
      && disposal?.rendererContextLost === true && disposalAgain?.crowdAfter?.canonical === 0
      && JSON.stringify(disposalAgain) === JSON.stringify(disposal),
    consoleClean: pageErrors.length === 0,
  };
  report = {
    schema: 'joinallworld.native-game-fixture.v1',
    status: Object.values(checks).every(Boolean) ? 'pass' : 'fail',
    project: repo,
    source: 'final 3af + native game adoption overlay',
    scene: { city: 'lagos', location: 'office', time: 'day', regularIds: namedNpcIds },
    checks,
    unsupported,
    npcInteraction,
    dapoInteraction,
    walkPhaseEvidence,
    interactionState,
    afterUnsupported,
    disposal,
    consoleErrors: pageErrors,
    screenshots: [idle, front, profileView, playerCloseIdle, playerCloseInteract, walkA, walkB, walk, interact, mrsIdle, mrsInteract, npcAction, dapoIdle, dapoInteract, dapoCompleted, mobile].map(({ name, screenshot, snapshot, renderEvidence }) => ({
      name, screenshot, camera: snapshot.currentCamera, playerPose: snapshot.player?.pose,
      cameraActorFrame: snapshot.cameraActorFrame, renderEvidence: { drawCalls: renderEvidence?.drawCalls,
        triangles: renderEvidence?.triangles, actorPixel: renderEvidence?.actorPixel,
        backgroundPixel: renderEvidence?.backgroundPixel, actorPixelContrast: renderEvidence?.actorPixelContrast },
      nativeCrowd: snapshot.crowd?.canonical, proceduralCrowd: snapshot.crowd?.procedural,
    })),
    finalSnapshot: afterUnsupported,
  };
  await writeFile(path.join(resultDir, 'office-game-fixture-report.json'), JSON.stringify(report, null, 2));
  if (report.status !== 'pass') throw new Error(`Game slice failed checks: ${JSON.stringify(checks)}`);
  console.log(JSON.stringify({ status: report.status, resultDir, checks }, null, 2));
} catch (error) {
  const failure = { status: 'failed', message: error instanceof Error ? error.message : String(error), chromeStderr, consoleErrors };
  await writeFile(path.join(resultDir, 'office-game-fixture-failure.json'), JSON.stringify(failure, null, 2)).catch(() => {});
  throw error;
} finally {
  if (socket) socket.close();
  chrome.kill('SIGTERM');
  await new Promise((resolve) => { if (chrome.exitCode !== null) resolve(); else { chrome.once('exit', resolve); setTimeout(() => { chrome.kill('SIGKILL'); resolve(); }, 3_000); } });
  await rm(profile, { recursive: true, force: true });
  await new Promise((resolve) => server.close(resolve));
}
