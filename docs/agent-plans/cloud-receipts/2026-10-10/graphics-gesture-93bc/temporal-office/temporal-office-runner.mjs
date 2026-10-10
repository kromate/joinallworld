// External diagnostic harness for frozen public-241 office fixture.
// It never changes the fixture or production sources. Run only after the parent
// compiler gate passes and under the machine-wide heavy/browser/server slots.
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const repo = path.resolve(process.env.ALLWORLD_INTEGRATION_ROOT ?? '/workspace/remote-verification/repositories/worker-graphics-native-interaction-temporal-29df');
const expectedHead = '93bc1acc87dc7e80373910d20a25daf6078e5b24';
const actualHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
const sourceStatus = spawnSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
if (actualHead !== expectedHead || sourceStatus !== '') throw new Error(`Frozen source preflight failed: head=${actualHead}, status=${JSON.stringify(sourceStatus)}`);
const fixtureDir = path.join(repo, 'evidence/graphics-loop/native-game-adoption-v1');
const htmlRelative = path.relative(repo, path.join(fixtureDir, 'game-fixture.html')).split(path.sep).join('/');
const fixtureBundleRoute = `/${path.relative(repo, path.join(fixtureDir, 'game-fixture.bundle.js')).split(path.sep).join('/')}`;
const bundlePath = process.env.NATIVE_TEMPORAL_BUNDLE ?? '/workspace/remote-verification/worker-results/native-interaction-temporal/game-fixture.bundle.js';
const resultDir = process.env.NATIVE_TEMPORAL_RESULTS ?? '/workspace/remote-verification/worker-results/native-interaction-temporal/actual-run';
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
const profile = await mkdtemp(path.join(os.tmpdir(), 'native-office-temporal-'));
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

async function readDebugPort() {
  const file = path.join(profile, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 200; attempt++) {
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
async function capture(name) {
  if (Date.now() > deadline) throw new Error('112-second browser deadline expired');
  const direct = await evaluate('window.nativeGameFixture.renderForCapture()');
  const png = Buffer.from(direct.canvasPng ?? '', 'base64');
  const canvasPath = `${name}-canvas.png`;
  if (png.length) await writeFile(path.join(resultDir, canvasPath), png);
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const snapshot = await evaluate('window.nativeGameFixture.sample()');
  const screenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true });
  const pagePng = Buffer.from(screenshot.data, 'base64');
  const pagePath = `${name}-page.png`;
  await writeFile(path.join(resultDir, pagePath), pagePng);
  return { name, elapsedMs: Date.now() - startedAt, snapshot,
    directCanvas: { path: canvasPath, bytes: png.length, sha256: createHash('sha256').update(png).digest('hex'),
      drawCalls: direct.drawCalls, triangles: direct.triangles, actorPixelContrast: direct.actorPixelContrast,
      actorRegionContrast: direct.actorRegionContrast, actorRegionPixels: direct.actorRegionPixels },
    pageScreenshot: { path: pagePath, bytes: pagePng.length, sha256: createHash('sha256').update(pagePng).digest('hex') } };
}
async function assertReady() {
  let state;
  while (Date.now() < deadline) {
    state = await evaluate('window.nativeGameFixture?.sample?.() ?? null').catch(() => null);
    if (state?.readyState === 'ready' || state?.readyState === 'failed') break;
    await delay(250);
  }
  if (state?.readyState !== 'ready') throw new Error(`Fixture not ready: ${JSON.stringify(state)}`);
  return state;
}
async function runAction(npcId, cameraName, cameraSecond) {
  await evaluate(`window.nativeGameFixture.setCamera(${JSON.stringify(cameraName)})`);
  const offered = await evaluate(`window.nativeGameFixture.sample().npcs[${JSON.stringify(npcId)}]?.actions?.map(a => a.activity) ?? []`);
  const activityId = `npc-${npcId}-hello`;
  if (!offered.includes(activityId)) throw new Error(`${npcId}: real viewLife no longer offers ${activityId}; actions=${JSON.stringify(offered)}`);
  const started = await evaluate(`(window.__nativeTemporalAction = window.nativeGameFixture.performNpcAction(${JSON.stringify(npcId)}, ${JSON.stringify(activityId)}), window.__nativeTemporalDone = null, window.__nativeTemporalError = null, window.__nativeTemporalAction.then(v => window.__nativeTemporalDone = v, e => window.__nativeTemporalError = String(e)), 'started')`);
  if (started !== 'started') throw new Error(`${npcId}: could not start direct action promise`);
  const captures = [];
  for (const [name, waitMs] of [['interaction-t180', 180], ['interaction-t540', 360], ['interaction-t900', 360]]) {
    await delay(waitMs);
    if (Date.now() > deadline) throw new Error('112-second browser deadline expired');
    const running = await evaluate('window.__nativeTemporalDone === null && window.__nativeTemporalError === null');
    if (!running) break;
    if (name === 'interaction-t540') await evaluate(`window.nativeGameFixture.setCamera(${JSON.stringify(cameraSecond)})`);
    const item = await capture(`${npcId}-${name}`);
    const npc = item.snapshot?.npcs?.[npcId];
    captures.push({ ...item, temporal: { interactionStatus: item.snapshot?.interaction?.completed,
      npcPose: npc?.gamePose, jaw: npc?.jaw, nativeVenueFootContactSolve: npc?.nativeVenueFootContactSolve ?? null,
      cameraActorFrame: item.snapshot?.cameraActorFrame } });
    if (npc?.gamePose !== 'interact' || item.snapshot?.interaction?.completed !== false) {
      throw new Error(`${npcId}: active capture was not a real in-progress interaction (${JSON.stringify({ pose: npc?.gamePose, completed: item.snapshot?.interaction?.completed })})`);
    }
  }
  let action = null;
  while (Date.now() < deadline) {
    const state = await evaluate('({done: window.__nativeTemporalDone, error: window.__nativeTemporalError, interaction: window.nativeGameFixture.sample().interaction})');
    if (state.error) throw new Error(`${npcId}: action promise rejected: ${state.error}`);
    if (state.done) { action = state.done; break; }
    if (state.interaction?.npcId !== npcId || state.interaction?.completed !== false) {
      throw new Error(`${npcId}: action identity/completion state changed before its promise resolved`);
    }
    await delay(100);
  }
  if (!action) throw new Error(`${npcId}: action did not complete before deadline; no next action started`);
  if (action.npcId !== npcId || action.started?.code !== 'started' || action.completed !== true
      || action.npcPoseDuringInteraction !== 'interact' || action.npcPoseAfterCompletion !== 'idle') {
    throw new Error(`${npcId}: action returned wrong identity or lifecycle: ${JSON.stringify(action)}`);
  }
  const returned = await capture(`${npcId}-returned-idle`);
  const npc = returned.snapshot?.npcs?.[npcId];
  if (npc?.gamePose !== 'idle' || returned.snapshot?.interaction?.npcId !== npcId
      || returned.snapshot?.interaction?.completed !== true) throw new Error(`${npcId}: returned idle snapshot failed exact identity/pose check`);
  return { npcId, activityId, offeredActivities: offered, captures, action,
    returnedIdle: { ...returned, temporal: { npcPose: npc?.gamePose, jaw: npc?.jaw,
      cameraActorFrame: returned.snapshot?.cameraActorFrame } } };
}

let report;
try {
  if (!await (await import('node:fs/promises')).stat(bundlePath).then(() => true, () => false)) throw new Error(`Frozen fixture bundle missing: ${bundlePath}`);
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
  const ready = await assertReady();
  const evidence = [];
  await evaluate("window.nativeGameFixture.setCamera('player-close'); window.nativeGameFixture.setMode('idle')");
  evidence.push(await capture('player-front-idle'));
  await evaluate("window.nativeGameFixture.setCamera('player-close-profile'); window.nativeGameFixture.setMode('idle')");
  evidence.push(await capture('player-profile-idle'));
  await evaluate("window.nativeGameFixture.setCamera('player-close'); window.nativeGameFixture.setMode('walk')");
  evidence.push(await capture('player-front-walk'));
  await evaluate("window.nativeGameFixture.setCamera('player-close-profile'); window.nativeGameFixture.setMode('walk')");
  evidence.push(await capture('player-profile-walk'));
  await evaluate("window.nativeGameFixture.setCamera('player-close'); window.nativeGameFixture.setMode('interact')");
  evidence.push(await capture('player-front-interact'));
  await evaluate("window.nativeGameFixture.setCamera('player-close-profile'); window.nativeGameFixture.setMode('interact')");
  evidence.push(await capture('player-profile-interact'));
  const mrs = await runAction('mrs-okafor', 'mrs-okafor-close', 'mrs-okafor-close-profile');
  const dapo = await runAction('dapo', 'dapo-close-profile', 'dapo-close');
  const checks = {
    realOfficeReady: ready.life?.location === 'office' && ready.nativeCoverage?.allRequestedActorsPrepared === true,
    playerSixDirectCaptures: evidence.length === 6 && evidence.every((item) => item.directCanvas.bytes > 0),
    bothNPCActionPromisesCompletedSerially: [mrs, dapo].every((item) => item.action.completed === true)
      && mrs.action.npcId === 'mrs-okafor' && dapo.action.npcId === 'dapo',
    activeSamplesWereRealInteractions: [mrs, dapo].every((item) => item.captures.length >= 1
      && item.captures.every((capture) => capture.temporal.npcPose === 'interact' && capture.temporal.interactionStatus === false)),
    exactReturnedIdle: [mrs, dapo].every((item) => item.returnedIdle.temporal.npcPose === 'idle'
      && item.action.npcPoseAfterCompletion === 'idle' && item.action.npcPoseLifecyclePass === true),
    phaseShoeWitnessesPass: [mrs, dapo].every((item) => item.action.nativeShoeContactEvidence?.length === 3
      && item.action.nativeShoeContactDiagnosticPass === true),
    jawRestored: [mrs, dapo].every((item) => item.action.jawRestored === true),
    actorsVisible: [...evidence, ...mrs.captures, mrs.returnedIdle, ...dapo.captures, dapo.returnedIdle]
      .every((item) => item.snapshot?.cameraActorFrame?.wholeActorVisible === true),
    directActorPixels: [...evidence, ...mrs.captures, mrs.returnedIdle, ...dapo.captures, dapo.returnedIdle]
      .every((item) => item.directCanvas.drawCalls > 0 && item.directCanvas.triangles > 0 && item.directCanvas.bytes > 0),
    consoleClean: consoleErrors.length === 0,
  };
  report = { schema: 'joinallworld.native-office-temporal-diagnostic.v1', status: Object.values(checks).every(Boolean) ? 'pass' : 'fail',
    source: { repo, head: actualHead, fixture: path.relative(repo, path.join(fixtureDir, 'game-fixture.ts')),
      bundle: bundlePath, browser: chromeBin, renderer: 'headless SwiftShader/WebGL; not physical-device certification' },
    protocol: { singleBrowser: true, directPerformNpcActionPromise: true, awaitExactCompletionBeforeNextAction: true,
      activePollIntervalMs: 100, actionTimeoutMs: 112000, noConcurrentActions: true,
      captures: 'direct canvas PNG plus page screenshot and fixture sample; NPC results include the fixture-authored placement/during/returned shoe geometry probes, while intermediate-frame snapshots expose solver metadata only' },
    checks, playerCaptures: evidence.map(({ name, elapsedMs, snapshot, directCanvas, pageScreenshot }) => ({ name, elapsedMs,
      mode: snapshot.player?.pose, requestedMode: snapshot.player?.requestedMode, frame: snapshot.player?.walkFrames,
      camera: snapshot.currentCamera, cameraActorFrame: snapshot.cameraActorFrame, directCanvas, pageScreenshot })),
    mrs, dapo, consoleErrors, elapsedMs: Date.now() - startedAt };
  await writeFile(path.join(resultDir, 'temporal-office-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, resultDir, elapsedMs: report.elapsedMs, checks }, null, 2));
} catch (error) {
  const failure = { status: 'failed', message: error instanceof Error ? error.message : String(error), elapsedMs: Date.now() - startedAt, chromeStderr, consoleErrors };
  await writeFile(path.join(resultDir, 'temporal-office-failure.json'), JSON.stringify(failure, null, 2)).catch(() => {});
  throw error;
} finally {
  if (socket) socket.close();
  chrome.kill('SIGTERM');
  await new Promise((resolve) => { if (chrome.exitCode !== null) resolve(); else { chrome.once('exit', resolve); setTimeout(() => { chrome.kill('SIGKILL'); resolve(); }, 3_000); } });
  await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  await new Promise((resolve) => server.close(resolve));
}
