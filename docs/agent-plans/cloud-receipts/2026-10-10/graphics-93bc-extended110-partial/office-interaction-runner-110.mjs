// One actual public office fixture session using the external-only 110-frame diagnostic bundle.
// The only fixture edits are manifest-pinned source-text instrumentation performed at build time.
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const repo = path.resolve(process.env.ALLWORLD_INTEGRATION_ROOT ?? '/workspace/remote-verification/repositories/worker-graphics-native-interaction-temporal-29df');
const expectedHead = '93bc1acc87dc7e80373910d20a25daf6078e5b24';
const actualHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
const sourceStatus = spawnSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
if (actualHead !== expectedHead || sourceStatus !== '') throw new Error(`Frozen source preflight failed: head=${actualHead}; status=${JSON.stringify(sourceStatus)}`);
const fixtureDir = path.join(repo, 'evidence/graphics-loop/native-game-adoption-v1');
const htmlRelative = path.relative(repo, path.join(fixtureDir, 'game-fixture.html')).split(path.sep).join('/');
const fixtureBundleRoute = `/${path.relative(repo, path.join(fixtureDir, 'game-fixture.bundle.js')).split(path.sep).join('/')}`;
const bundlePath = '/workspace/remote-verification/worker-results/native-interaction-temporal/extended110/game-fixture.instrumented.bundle.js';
const manifestPath = '/workspace/remote-verification/worker-results/native-interaction-temporal/extended110/instrumented-bundle-manifest.json';
const instrumentedManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const sourceClipDurationSeconds = instrumentedManifest.interactClipDurationSeconds;
if (!(Number.isFinite(sourceClipDurationSeconds) && sourceClipDurationSeconds > 0)) throw new Error('Pinned interact clip duration is missing');
const resultDir = process.env.NATIVE_TEMPORAL_RESULTS ?? '/workspace/remote-verification/worker-results/native-interaction-temporal/extended110/actual-run';
const requireFromRepo = createRequire(path.join(repo, 'package.json'));
const WebSocket = requireFromRepo('ws');
const chromeBin = process.env.CHROME_BIN ?? ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
  .map((name) => spawnSync('which', [name], { encoding: 'utf8' })).find((result) => result.status === 0)?.stdout.trim();
if (!chromeBin) throw new Error('No Chrome/Chromium found; set CHROME_BIN to the existing remote browser');
await mkdir(resultDir, { recursive: true });

const mime = new Map([['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'], ['.json', 'application/json'], ['.glb', 'model/gltf-binary'],
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg']]);
const server = createServer(async (request, response) => {
  try {
    const requested = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
    const filename = path.resolve(repo, `.${requested}`);
    if (!filename.startsWith(`${repo}${path.sep}`)) throw new Error('Path escaped repository');
    const bytes = await readFile(requested === fixtureBundleRoute ? bundlePath : filename);
    response.writeHead(200, { 'content-type': mime.get(path.extname(filename).toLowerCase()) ?? 'application/octet-stream',
      'cache-control': 'no-store', 'content-length': bytes.length });
    response.end(bytes);
  } catch {
    response.writeHead(404); response.end('Not found');
  }
});
server.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
const port = server.address().port;
const profile = await mkdtemp(path.join(os.tmpdir(), 'native-office-extended110-'));
const chromeArgs = ['--headless=new', '--no-sandbox', '--renderer-process-limit=1', '--disable-extensions',
  '--disable-background-networking', '--disable-dev-shm-usage', '--disable-gpu-sandbox', '--remote-debugging-port=0',
  '--remote-allow-origins=*', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
  '--use-gl=angle', '--use-angle=swiftshader', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,1160', '--js-flags=--max-old-space-size=2048', `--user-data-dir=${profile}`, 'about:blank'];
const chrome = spawn(chromeBin, chromeArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeStderr = '';
chrome.stderr.on('data', (chunk) => { chromeStderr = (chromeStderr + chunk.toString()).slice(-12_000); });
let socket;
let nextId = 0;
const pending = new Map();
const consoleErrors = [];
const startedAt = Date.now();
const deadline = startedAt + 112_000;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function readDebugPort() {
  const file = path.join(profile, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try { return Number((await readFile(file, 'utf8')).split('\n')[0]); }
    catch { if (chrome.exitCode !== null) throw new Error(`Chrome exited early (${chrome.exitCode}): ${chromeStderr}`); await delay(100); }
  }
  throw new Error(`Chrome DevTools port did not appear: ${chromeStderr}`);
}
function cdp(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { if (pending.delete(id)) reject(new Error(`CDP timeout: ${method}`)); }, 18_000);
    pending.set(id, { resolve(value) { clearTimeout(timeout); resolve(value); }, reject(error) { clearTimeout(timeout); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? JSON.stringify(result.exceptionDetails));
  if (result.result?.subtype === 'error') throw new Error(result.result.description ?? 'Browser evaluation failed');
  return result.result?.value;
}
function contactQuality(contact) {
  const sides = contact?.sides ?? [];
  const ids = sides.map((side) => side.side).sort();
  const completeSides = sides.length === 2 && JSON.stringify(ids) === JSON.stringify(['left', 'right']);
  const matrices = Object.values(contact?.footBoneMatrices ?? {});
  const fullFootMatrices = matrices.length === 4 && matrices.every((value) => value
    && Array.isArray(value.matrixWorld) && value.matrixWorld.length === 16 && value.matrixWorld.every(Number.isFinite)
    && Array.isArray(value.position) && value.position.length === 3 && value.position.every(Number.isFinite)
    && Array.isArray(value.quaternion) && value.quaternion.length === 4 && value.quaternion.every(Number.isFinite)
    && Number.isFinite(value.quaternionNorm) && Math.abs(value.quaternionNorm - 1) < 1e-4
    && Array.isArray(value.scale) && value.scale.length === 3 && value.scale.every(Number.isFinite));
  const sideResults = sides.map((side) => {
    const samples = side.deformedSoleSamples ?? [];
    const callbackCovered = side.callbackSupportCoverageComplete === true
      && side.callbackSupportCoverage === `${samples.length}/${samples.length}`;
    const finite = samples.every((point) => [point.x, point.y, point.z, point.callbackTargetY, point.sceneFloorY, point.gapToSceneFloor]
      .every(Number.isFinite));
    const physicalClearance = samples.every((point) => point.gapToSceneFloor >= -0.004);
    return { side: side.side, pointCount: samples.length, callbackCovered, finite, physicalClearance,
      nearestAbsoluteGapMeters: side.nearestAbsoluteGapToSceneFloor,
      minimumSignedGapMeters: side.minimumSignedGapToSceneFloor,
      reach: side.nativeLegReach?.withinReach === true,
      pass: callbackCovered && finite && physicalClearance && side.nearestAbsoluteGapToSceneFloor <= 0.004
        && side.minimumSignedGapToSceneFloor >= -0.004 && side.nativeLegReach?.withinReach === true };
  });
  return { completeSides, fullFootMatrices, footBoneMatrices: contact?.footBoneMatrices ?? null,
    pointCount: sideResults.reduce((n, side) => n + side.pointCount, 0),
    sideResults, pass: completeSides && fullFootMatrices && sideResults.every((side) => side.pass) };
}
function quaternionAngleRadians(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 4 || b.length !== 4
      || ![...a, ...b].every(Number.isFinite)) return null;
  const dot = Math.min(1, Math.abs(a.reduce((sum, value, index) => sum + value * b[index], 0)));
  return 2 * Math.acos(dot);
}
function wristStageEvidence(beforeIdleTransforms, representativeTrace, returnedIdleTransforms) {
  const stages = representativeTrace?.stages;
  if (!stages) return { available: false };
  const sides = {};
  for (const side of ['Left', 'Right']) {
    const hand = `mixamorig${side}Hand`;
    const corrected = stages.correctedNeutral?.[hand]?.quaternion;
    const afterGesture = stages.afterGesture?.[hand]?.quaternion;
    const beforeWrist = stages.beforeWristController?.[hand]?.quaternion;
    const afterWrist = stages.afterWristController?.[hand]?.quaternion;
    const beforeIdleHand = beforeIdleTransforms?.[hand]?.quaternion;
    const afterIdleHand = returnedIdleTransforms?.[hand]?.quaternion;
    sides[side.toLowerCase()] = {
      idleLocalHandQuaternionBefore: beforeIdleHand ?? null,
      correctedNeutralToIdleRadians: quaternionAngleRadians(corrected, beforeIdleHand),
      gestureDeltaFromCorrectedNeutralRadians: quaternionAngleRadians(corrected, afterGesture),
      wristControllerDeltaRadians: quaternionAngleRadians(beforeWrist, afterWrist),
      returnedIdleLocalHandQuaternion: afterIdleHand ?? null,
      returnedIdleDeltaFromBeforeRadians: quaternionAngleRadians(beforeIdleHand, afterIdleHand),
    };
  }
  return { available: true, clipName: representativeTrace.clipName, clipSampleSeconds: representativeTrace.sampleSeconds,
    clipDurationSeconds: representativeTrace.duration, wristControllerResult: representativeTrace.wristControllerResult ?? null, sides };
}
async function capture(name, npcId, cameraName, contactPhase) {
  if (Date.now() > deadline) throw new Error('112-second browser deadline expired');
  // One synchronous browser task keeps the direct-canvas pixels, live pose, blink, step
  // progress, and full deformed shoe geometry tied to the same actor frame.
  const data = await evaluate(`(() => {
    const fixture = window.nativeGameFixture;
    fixture.setCamera(${JSON.stringify(cameraName)});
    const render = fixture.renderForCapture();
    const contact = fixture.sampleNpcSoles(${JSON.stringify(npcId)}, ${JSON.stringify(contactPhase)});
    const snapshot = fixture.sample();
    return { render, contact, snapshot, progress: window.__nativeTemporalLoopProgress ?? null,
      actionStartedAt: window.__nativeTemporalPlayerActionStartedAt ?? null,
      actionFinishedAt: window.__nativeTemporalPlayerActionFinishedAt ?? null,
      handlerDone: window.__nativeTemporalHandlerDone ?? null,
      actionError: window.__nativeTemporalActionError ?? null };
  })()`);
  if (!data?.render || typeof data.render.canvasPng !== 'string' || data.render.canvasPng.length === 0) {
    throw new Error(`${name}: direct-canvas capture unavailable: ${JSON.stringify(data?.render?.canvasPngError ?? null)}`);
  }
  const pngBytes = Buffer.from(data.render.canvasPng, 'base64');
  const canvasPath = `${name}-canvas.png`;
  await writeFile(path.join(resultDir, canvasPath), pngBytes);
  const contactPath = `${name}-shoe-evidence.json`;
  const contactBytes = Buffer.from(`${JSON.stringify(data.contact, null, 2)}\n`);
  await writeFile(path.join(resultDir, contactPath), contactBytes);
  const pageCapture = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true });
  const pageBytes = Buffer.from(pageCapture.data, 'base64');
  const pagePath = `${name}-page.png`;
  await writeFile(path.join(resultDir, pagePath), pageBytes);
  const actor = data.snapshot?.npcs?.[npcId];
  const quality = contactQuality(data.contact);
  return { name, npcId, cameraName, elapsedMs: Date.now() - startedAt,
    progress: data.progress, npcPose: actor?.gamePose, armLandmarks: actor?.armLandmarks ?? null,
    armLocalTransforms: actor?.armLocalTransforms ?? null, wristTrace: actor?.wristTrace ?? null,
    stepMetrics: actor?.stepMetrics ?? null,
    interaction: data.snapshot?.interaction,
    player: { pose: data.snapshot?.player?.pose, requestedMode: data.snapshot?.player?.requestedMode,
      cameraActorFrame: data.snapshot?.cameraActorFrame },
    look: actor?.look ?? null, jaw: actor?.jaw, blink: actor?.blink,
    cameraActorFrame: data.snapshot?.cameraActorFrame,
    directCanvas: { path: canvasPath, bytes: pngBytes.length, sha256: hash(pngBytes),
      drawCalls: data.render.drawCalls, triangles: data.render.triangles,
      actorPixelContrast: data.render.actorPixelContrast, actorRegionContrast: data.render.actorRegionContrast },
    pageScreenshot: { path: pagePath, bytes: pageBytes.length, sha256: hash(pageBytes) },
    shoeEvidence: { path: contactPath, bytes: contactBytes.length, sha256: hash(contactBytes),
      phase: data.contact?.phase, quality } };
}
async function waitForReady() {
  while (Date.now() < deadline) {
    const snapshot = await evaluate('window.nativeGameFixture?.sample?.() ?? null').catch(() => null);
    if (snapshot?.readyState === 'ready' || snapshot?.readyState === 'failed') {
      if (snapshot.readyState !== 'ready') throw new Error(`Fixture failed preparation: ${JSON.stringify(snapshot)}`);
      return snapshot;
    }
    await delay(200);
  }
  throw new Error('Fixture readiness exceeded bounded browser deadline');
}
async function waitForFrame(npcId, targetFrame, actionDeadline) {
  while (Date.now() < actionDeadline && Date.now() < deadline) {
    const state = await evaluate(`({ progress: window.__nativeTemporalLoopProgress ?? null,
      done: window.__nativeTemporalHandlerDone ?? null, error: window.__nativeTemporalActionError ?? null,
      interaction: window.nativeGameFixture.sample().interaction })`);
    if (state.error) throw new Error(`${npcId}: real player action rejected: ${state.error}`);
    if (state.done) throw new Error(`${npcId}: player handler returned before target frame ${targetFrame}`);
    if (state.progress?.npcId === npcId && state.progress.frame >= targetFrame) return state.progress;
    await delay(10);
  }
  throw new Error(`${npcId}: timed out waiting for live frame ${targetFrame}`);
}
async function waitForPlayerAction(npcId, actionDeadline) {
  while (Date.now() < actionDeadline && Date.now() < deadline) {
    const state = await evaluate(`({ done: window.__nativeTemporalHandlerDone ?? null,
      error: window.__nativeTemporalActionError ?? null,
      interaction: window.nativeGameFixture.sample().interaction })`);
    if (state.error) throw new Error(`${npcId}: actual NPC-card action failed: ${state.error}`);
    if (state.done === true) return state.interaction;
    await delay(15);
  }
  throw new Error(`${npcId}: NPC card action did not finish before timeout; next action not started`);
}

async function runNpcAction(npcId) {
  await evaluate('window.__nativeTemporalTraceWrist = true');
  const frontCamera = `${npcId}-close`;
  const profileCamera = `${npcId}-close-profile`;
  await evaluate(`window.nativeGameFixture.setMode('idle'); window.nativeGameFixture.setCamera(${JSON.stringify(frontCamera)})`);
  const before = await capture(`${npcId}-before-idle`, npcId, frontCamera, 'before-player-action-idle');
  const offers = await evaluate(`window.nativeGameFixture.sample().npcs[${JSON.stringify(npcId)}]?.actions?.map(action => action.activity) ?? []`);
  const activityId = `npc-${npcId}-hello`;
  if (offers.filter((activity) => activity === activityId).length !== 1) {
    throw new Error(`${npcId}: expected one exact currently offered action ${activityId}; offers=${JSON.stringify(offers)}`);
  }
  const buttonId = `npc-action-${npcId}-hello`;
  const click = await evaluate(`(() => { const button = document.getElementById(${JSON.stringify(buttonId)});
    if (!(button instanceof HTMLButtonElement)) throw new Error('Missing actual offered NPC action button ${buttonId}');
    button.click();
    return { started: window.__nativeTemporalActionPromise instanceof Promise,
      playerPose: window.nativeGameFixture.sample().player?.pose,
      interaction: window.nativeGameFixture.sample().interaction }; })()`);
  if (!click.started || click.playerPose !== 'interact' || click.interaction?.npcId !== npcId
      || click.interaction?.activityId !== activityId || click.interaction?.completed !== false) {
    throw new Error(`${npcId}: real NPC-card click did not start the expected live action: ${JSON.stringify(click)}`);
  }
  const actionDeadline = Date.now() + 25_000;
  const captures = [];
  for (const target of [
    { frame: 8, name: 'active-f08-front', camera: frontCamera },
    { frame: 22, name: 'blink-f22-front', camera: frontCamera },
    { frame: 29, name: 'post-blink-f29-profile', camera: profileCamera },
    { frame: 36, name: 'active-post-blink-f36-front', camera: frontCamera },
    { frame: 54, name: 'player-active-f54-front', camera: 'player-close' },
    { frame: 66, name: 'after-clip-f66-profile', camera: profileCamera },
    { frame: 108, name: 'late-active-f108-front', camera: frontCamera },
  ]) {
    const progress = await waitForFrame(npcId, target.frame, actionDeadline);
    const item = await capture(`${npcId}-${target.name}`, npcId, target.camera, `live-frame-${progress.frame}`);
    if (item.progress?.npcId !== npcId || item.progress.frame < target.frame || item.npcPose !== 'interact'
        || item.interaction?.npcId !== npcId || item.interaction?.activityId !== activityId || item.interaction?.completed !== false) {
      throw new Error(`${npcId}: active frame capture lost identity/lifecycle at ${target.name}: ${JSON.stringify({ progress: item.progress, pose: item.npcPose, interaction: item.interaction })}`);
    }
    if (!item.shoeEvidence.quality.pass) throw new Error(`${npcId}: live-frame shoe contact failed at ${target.name}: ${JSON.stringify(item.shoeEvidence.quality)}`);
    captures.push(item);
  }
  const completedInteraction = await waitForPlayerAction(npcId, actionDeadline);
  const action = await evaluate('window.__nativeTemporalActionPromise');
  if (action?.npcId !== npcId || action.activityId !== activityId || action.completed !== true
      || action.npcPoseDuringInteraction !== 'interact' || action.npcPoseAfterCompletion !== 'idle'
      || action.talkLoopFrames !== 110 || action.talkLoopFrameMetrics?.length !== 110) {
    throw new Error(`${npcId}: actual action promise result failed identity or 110-step completion: ${JSON.stringify({ id: action?.npcId, activity: action?.activityId, completed: action?.completed, frames: action?.talkLoopFrames, metrics: action?.talkLoopFrameMetrics?.length })}`);
  }
  if (completedInteraction?.playerModeRestored !== true || completedInteraction?.playerPoseAfterRestore !== 'idle') {
    throw new Error(`${npcId}: real action handler did not restore the player's previous idle mode: ${JSON.stringify(completedInteraction)}`);
  }
  const returnNpc = await capture(`${npcId}-returned-idle-front`, npcId, frontCamera, 'actual-player-action-returned-idle');
  const returnPlayer = await capture(`${npcId}-returned-player-idle-front`, npcId, 'player-close', 'returned-player-idle');
  if (returnNpc.npcPose !== 'idle' || returnNpc.interaction?.npcId !== npcId || returnNpc.interaction?.completed !== true
      || returnPlayer.player.pose !== 'idle' || !returnNpc.shoeEvidence.quality.pass || !returnPlayer.shoeEvidence.quality.pass) {
    throw new Error(`${npcId}: returned-idle native geometry/lifecycle/player restoration failed`);
  }
  const costs = action.talkLoopFrameMetrics;
  const armTravel = (side) => {
    const bone = `mixamorig${side}Hand`;
    const positions = captures.map((item) => item.armLandmarks?.[bone]).filter((point) => Array.isArray(point) && point.length === 3);
    const origin = before.armLandmarks?.[bone];
    const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    return { validSamples: positions.length,
      maxActiveFrameTravelMeters: positions.length > 1 ? Math.max(...positions.flatMap((point, index) =>
        positions.slice(index + 1).map((other) => distance(point, other)))) : null,
      maxFromIdleMeters: positions.length && Array.isArray(origin) ? Math.max(...positions.map((point) => distance(point, origin))) : null };
  };
  const armTrajectory = { left: armTravel('Left'), right: armTravel('Right') };
  const representativeWristTrace = captures.find((item) => item.progress?.frame === 22)?.wristTrace ?? captures[1]?.wristTrace ?? null;
  const wristEvidence = wristStageEvidence(before.armLocalTransforms, representativeWristTrace, returnNpc.armLocalTransforms);
  const venueStepMetrics = returnNpc.stepMetrics;
  return { npcId, activityId, offeredActivities: offers, playerActionPath: `button#${buttonId}.click -> mode interact -> performNpcAction -> normal finally restores idle`,
    before, click, captures, action, measuredSourceSeconds: costs.at(-1)?.sourceSeconds ?? null,
    timing: { activeStepCount: costs.length,
      totalStepCrowdMs: costs.reduce((sum, frame) => sum + frame.stepMs, 0),
      averageStepCrowdMs: costs.reduce((sum, frame) => sum + frame.stepMs, 0) / costs.length,
      maxStepCrowdMs: Math.max(...costs.map((frame) => frame.stepMs)),
      totalFrameWorkMs: costs.reduce((sum, frame) => sum + frame.frameWorkMs, 0),
      averageFrameWorkMs: costs.reduce((sum, frame) => sum + frame.frameWorkMs, 0) / costs.length,
      maxFrameWorkMs: Math.max(...costs.map((frame) => frame.frameWorkMs)),
      averageDrawMs: costs.reduce((sum, frame) => sum + frame.drawMs, 0) / costs.length,
      frameMetrics: costs },
    returnNpc, returnPlayer, armTrajectory, representativeWristTrace, wristEvidence, venueStepMetrics,
    blinkEvidence: { baseline: before.blink,
      samples: [captures[1], captures[2], captures[3]].map((item) => ({ frame: item.progress.frame, sourceSeconds: item.progress.sourceSeconds, blink: item.blink })),
      returned: returnNpc.blink },
    contactEvidence: [before, ...captures, returnNpc, returnPlayer].map((item) => ({ name: item.name, ...item.shoeEvidence })) };
}

let finalReport;
try {
  const bundleBytes = await readFile(bundlePath);
  if (hash(bundleBytes) !== instrumentedManifest.outputSha256) throw new Error('Diagnostic bundle does not match its source-pinned manifest');
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
  const ready = await waitForReady();
  const mrs = await runNpcAction('mrs-okafor');
  const dapo = await runNpcAction('dapo');
  const baselineBlinkMatches = (action) => ['nativeFacialBlinkLeft', 'nativeFacialBlinkRight'].every((name) => {
    const before = action.before.blink?.[name], after = action.returnNpc.blink?.[name];
    return Number.isFinite(before) && Number.isFinite(after) && Math.abs(before - after) < 1e-6;
  });
  const blinkPulseMatches = (action) => {
    const sample = action.blinkEvidence.samples.find((item) => item.frame >= 21 && item.frame <= 23);
    const left = sample?.blink?.nativeFacialBlinkLeft, right = sample?.blink?.nativeFacialBlinkRight;
    return Number.isFinite(left) && Number.isFinite(right) && left > 0.8 && right > 0.8;
  };
  const blinkPostPulseRestored = (action) => ['nativeFacialBlinkLeft', 'nativeFacialBlinkRight'].every((name) => {
    const before = action.before.blink?.[name];
    return [action.captures[2], action.captures[3]].every((capture) => {
      const selectedBaseline = capture?.blink?.[name];
      return Number.isFinite(before) && Number.isFinite(selectedBaseline) && Math.abs(before - selectedBaseline) < 1e-6;
    });
  });
  const checks = {
    readyRealOffice: ready.life?.location === 'office' && ready.nativeCoverage?.allRequestedActorsPrepared === true,
    exactOfferedPlayerActionsCompletedSerially: [mrs, dapo].every((action) => action.action.started?.code === 'started'
      && action.action.completed === true && action.action.activityId === action.activityId
      && action.action.npcPoseAfterCompletion === 'idle' && action.action.npcPoseLifecyclePass === true),
    actualPlayerModeAndPoseRestored: [mrs, dapo].every((action) => action.click.playerPose === 'interact'
      && action.returnNpc.interaction?.playerModeRestored === true && action.returnPlayer.player.pose === 'idle'),
    atLeast110NaturalActiveSamplesAndBeyondSourceClipDuration: [mrs, dapo].every((action) => action.timing.activeStepCount >= 110
      && action.measuredSourceSeconds > sourceClipDurationSeconds
      && action.captures.find((item) => item.progress.sourceSeconds < sourceClipDurationSeconds)
      && action.captures.find((item) => item.progress.sourceSeconds > sourceClipDurationSeconds)),
    fullShoeGeometryPassAtEveryCapturedNpcFrame: [mrs, dapo].every((action) => action.contactEvidence.every((sample) => sample.quality.pass)),
    synchronizedJawMovesAndRestores: [mrs, dapo].every((action) => action.action.talkLoopSynchronized === true
      && action.action.jawPeak.Body > action.action.jawBefore.Body
      && action.action.jawRestored === true),
    actualBlinkPulseAndBaselineRestore: [mrs, dapo].every((action) => blinkPulseMatches(action)
      && blinkPostPulseRestored(action) && baselineBlinkMatches(action)),
    sourceArmLandmarksMoveDuringRealAction: [mrs, dapo].every((action) => Object.values(action.armTrajectory).some((side) =>
      side.validSamples >= 2 && side.maxActiveFrameTravelMeters > 0.025 && side.maxFromIdleMeters > 0.025)),
    measuredVenuePoseContactAndExpressionCalls: [mrs, dapo].every((action) => {
      const metrics = action.venueStepMetrics;
      return metrics?.npcId === action.npcId
        && metrics.sampleUseCalls === action.timing.activeStepCount
        && metrics.contactSolveCalls === action.timing.activeStepCount
        && metrics.expressionStepCalls === action.timing.activeStepCount
        && [metrics.sampleUseTotalMs, metrics.contactSolveTotalMs, metrics.expressionStepTotalMs,
          metrics.sampleUseMaxMs, metrics.contactSolveMaxMs, metrics.expressionStepMaxMs].every(Number.isFinite);
    }),
    directPixelMotionAndVisibleActor: [mrs, dapo].every((action) => {
      const front = action.captures.filter((item) => item.cameraName.endsWith('-close'));
      return front.length >= 2 && new Set(front.map((item) => item.directCanvas.sha256)).size > 1
        && [...action.captures, action.returnNpc, action.returnPlayer].every((item) => item.directCanvas.bytes > 0
          && item.directCanvas.triangles > 0 && item.cameraActorFrame?.wholeActorVisible === true);
    }),
    consoleClean: consoleErrors.length === 0,
  };
  finalReport = { schema: 'joinallworld.native-office-interaction-temporal-110.v1',
    status: Object.values(checks).every(Boolean) ? 'pass' : 'fail', sourceHead: actualHead,
    instrumentation: instrumentedManifest,
    sourceClipEvidence: { path: 'src/scene/body/assets/clip-pack.glb', sha256: instrumentedManifest.clipPackSha256,
      interactDurationSeconds: sourceClipDurationSeconds,
      provenance: 'Maximum input-accessor timestamp parsed from the GLB JSON chunk of the same hash-pinned local clip pack before bundling' },
    diagnosticProtocol: { instrumentationIsExternalBundleOnly: true, changesWereInMemoryStringTransforms: true,
      actionStartsByClickingOriginalNpcCardButton: true, actionLifeCompletionNotAdvancedUntilAfter110RealStepWaits: true,
      venueStepSeconds: 1 / 30, intendedFrames: 110, exactActionPromisesWaitedBeforeNextNpc: true,
      wristStageCapture: 'enabled by an external global flag; in-memory factory transform records actual native local transforms after corrected neutral, after measured gesture, and immediately before/after wrist controller',
      eachImageAndFullShoeProbeCapturedInOneSynchronousPageTask: true, browser: chromeBin,
      renderer: 'headless WebGL through SwiftShader; not physical-device certification', timeLimitSeconds: 120, rssLimitBytes: 2147483648 },
    checks, npcActions: { mrs, dapo }, consoleErrors, elapsedMs: Date.now() - startedAt };
  const reportPath = path.join(resultDir, 'temporal-office-110-report.json');
  await writeFile(reportPath, `${JSON.stringify(finalReport, null, 2)}\n`);
  const reportBytes = await readFile(reportPath);
  console.log(JSON.stringify({ status: finalReport.status, resultDir, reportPath, reportSha256: hash(reportBytes), elapsedMs: finalReport.elapsedMs, checks }, null, 2));
  if (finalReport.status !== 'pass') throw new Error(`Extended temporal fixture checks failed: ${JSON.stringify(checks)}`);
} catch (error) {
  const failure = { status: 'failed', message: error instanceof Error ? error.message : String(error),
    elapsedMs: Date.now() - startedAt, chromeStderr, consoleErrors };
  await writeFile(path.join(resultDir, 'temporal-office-110-failure.json'), `${JSON.stringify(failure, null, 2)}\n`).catch(() => {});
  throw error;
} finally {
  if (socket) socket.close();
  chrome.kill('SIGTERM');
  await new Promise((resolve) => { if (chrome.exitCode !== null) resolve(); else { chrome.once('exit', resolve); setTimeout(() => { chrome.kill('SIGKILL'); resolve(); }, 3_000); } });
  await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  await new Promise((resolve) => server.close(resolve));
}
