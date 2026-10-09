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
const bundlePath = path.join(here, 'home-journey.bundle.js');
const htmlRelative = path.relative(repo, path.join(here, 'home-journey.html')).split(path.sep).join('/');
const runId = (process.env.GITHUB_RUN_ID ?? `remote-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
const resultDir = path.join(here, 'home-journey-results', runId);
const chromeBin = process.env.CHROME_BIN ?? ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
  .map((name) => spawnSync('which', [name], { encoding: 'utf8' })).find((result) => result.status === 0)?.stdout.trim();
if (!chromeBin) throw new Error('Set CHROME_BIN to the remote runner Chrome/Chromium executable');
await stat(bundlePath).catch(() => { throw new Error('Home journey bundle missing; run bundle-home-journey.mjs first'); });
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
  } catch { response.writeHead(404); response.end('Not found'); }
});
server.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
const port = server.address().port;
const profile = await mkdtemp(path.join(os.tmpdir(), 'native-home-journey-'));
const chrome = spawn(chromeBin, [
  '--headless=new', '--no-sandbox', '--renderer-process-limit=1', '--disable-extensions', '--disable-background-networking',
  '--disable-dev-shm-usage', '--disable-gpu-sandbox', '--remote-debugging-port=0', '--remote-allow-origins=*',
  '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  '--no-first-run', '--no-default-browser-check', '--window-size=1440,1160', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeStderr = '';
chrome.stderr.on('data', (chunk) => { chromeStderr = (chromeStderr + chunk.toString()).slice(-16_000); });
let socket;
let nextId = 0;
const pending = new Map();
const consoleErrors = [];
let lastJourneySnapshot = null;

async function readDebugPort() {
  const file = path.join(profile, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try { return Number((await readFile(file, 'utf8')).split('\n')[0]); }
    catch { if (chrome.exitCode !== null) throw new Error(`Chrome exited early (${chrome.exitCode}): ${chromeStderr}`); await delay(100); }
  }
  throw new Error(`Chrome DevTools port did not appear: ${chromeStderr}`);
}
function cdp(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { if (pending.delete(id)) reject(new Error(`Chrome DevTools command timed out: ${method}`)); }, 25_000);
    pending.set(id, { resolve: (value) => { clearTimeout(timeout); resolve(value); }, reject: (error) => { clearTimeout(timeout); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? JSON.stringify(result.exceptionDetails));
  if (result.result?.subtype === 'error') throw new Error(result.result.description ?? 'Browser evaluation failed');
  return result.result?.value;
}
async function capture(name, waitMs = 180) {
  await delay(waitMs);
  const stagedSnapshot = await evaluate('window.nativeHomeJourney?.sample?.() ?? null');
  const rendered = await evaluate('window.nativeHomeJourney?.renderForCapture?.() ?? null');
  let canvasScreenshot = null;
  if (typeof rendered?.canvasPng === 'string' && rendered.canvasPng) {
    const bytes = Buffer.from(rendered.canvasPng, 'base64');
    const filename = `home-${name}-canvas.png`;
    await writeFile(path.join(resultDir, filename), bytes);
    canvasScreenshot = { path: filename, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  const { canvasPng: _canvasPng, ...renderEvidence } = rendered ?? {};
  const screenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true });
  const pageBytes = Buffer.from(screenshot.data, 'base64');
  const pageName = `home-${name}.png`;
  await writeFile(path.join(resultDir, pageName), pageBytes);
  const acknowledged = await evaluate(`window.nativeHomeJourney.acknowledgeCapture(${JSON.stringify(name)})`);
  return { name, snapshot: stagedSnapshot, acknowledged, renderEvidence, canvasScreenshot,
    screenshot: { path: pageName, bytes: pageBytes.length, sha256: createHash('sha256').update(pageBytes).digest('hex') } };
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
    else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
  });
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Log.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1160, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/${htmlRelative}` });
  const deadline = Date.now() + 160_000;
  let ready = null;
  while (Date.now() < deadline) {
    ready = await evaluate('window.nativeHomeJourney?.sample?.() ?? null').catch(() => null);
    lastJourneySnapshot = ready;
    if (ready?.ready || ready?.errors?.length) break;
    await delay(250);
  }
  if (!ready?.ready) throw new Error(`Home scene did not prepare: ${JSON.stringify(ready)}`);
  const captures = [];
  if (ready.captureRequest !== 'male-casual-standing') throw new Error(`Unexpected initial capture request: ${ready.captureRequest}`);
  captures.push(await capture('male-casual-standing', 0));
  await evaluate("window.nativeHomeJourney.runJourney(); 'journey-started'");
  const actionNames = ['bed-sleep', 'chair-rest', 'tub-soak', 'shower-bath'];
  const activityByStage = { 'bed-sleep': 'home-sleep', 'chair-rest': 'home-sit-down', 'tub-soak': 'home-long-soak', 'shower-bath': 'bath' };
  const requestedNames = actionNames.flatMap((name) => [`${name}-active`, `${name}-completed`]);
  const seen = new Set();
  while (Date.now() < deadline) {
    const state = await evaluate('window.nativeHomeJourney.sample()');
    lastJourneySnapshot = state;
    if (state.errors?.length) break;
    const requested = state.captureRequest;
    if (requested && requestedNames.includes(requested) && !seen.has(requested)) {
      seen.add(requested);
      captures.push(await capture(requested, 0));
      continue;
    }
    if (requested === 'female-office-standing' && !seen.has(requested)) {
      seen.add(requested);
      captures.push(await capture(requested, 0));
      break;
    }
    await delay(100);
  }
  if (requestedNames.some((name) => !seen.has(name))) throw new Error(`Home journey missed stage captures: ${JSON.stringify({ seen: [...seen], latest: lastJourneySnapshot, consoleErrors })}`);
  const final = await evaluate('window.nativeHomeJourney.sample()');
  if (!final.samples?.['female-office-standing']) throw new Error(`Female office look did not load: ${JSON.stringify(final)}`);
  const completed = await evaluate('window.nativeHomeJourney.sample()');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const mobile = await capture('mobile-390', 300);
  const mobileLayout = await evaluate(`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,columns:getComputedStyle(document.querySelector('.layout')).gridTemplateColumns})`);
  const disposal = await evaluate('window.nativeHomeJourney.dispose()');
  const disposalAgain = await evaluate('window.nativeHomeJourney.dispose()');
  const actionPass = actionNames.every((stage) => { const id = activityByStage[stage]; return completed.actions?.[id]?.started === 'started' && completed.actions?.[id]?.completed === 'completed'; });
  const poseActionSamples = actionNames.every((id) => completed.samples?.[id]?.actionId === activityByStage[id]
    && completed.samples?.[`${id}-completed`]?.actionId === null);
  const restCases = {
    'bed-sleep': { pose: 'lie', itemId: 'spring-bed' },
    'tub-soak': { pose: 'soak', itemId: 'bathtub' },
    'shower-bath': { pose: 'wash', itemId: 'shower-cubicle' },
  };
  const homeNativeRestMeasurements = Object.entries(restCases).every(([stage, expected]) => {
    const sample = completed.samples?.[stage];
    const receipt = sample?.nativeRestContact;
    const measuredPropIsCurrentSceneItem = sample?.visibleFurniture?.some((item) =>
      item.id === receipt?.propId && item.itemId === expected.itemId) === true;
    const feet = receipt?.measurement.footGaps;
    const bothFeetSupported = expected.pose === 'lie' || (feet !== undefined && ['left', 'right'].every((side) => {
      const foot = feet[side];
      return foot.sampled > 0 && Number.isFinite(foot.minimumGap)
        && foot.minimumGap >= -0.004 && foot.minimumGap <= 0.018;
    }));
    return sample?.actionId === activityByStage[stage] && (sample.sceneObjectPhase === 'use' || sample.sceneObjectPhase === 'rest')
      && (receipt?.phase === 'still' || (receipt?.phase === 'transition' && receipt.transitionValidated === true)) && receipt.pose === expected.pose
      && receipt.measurement.pose === expected.pose && receipt.measurement.propId === receipt.propId
      && receipt.measurement.supported === true && measuredPropIsCurrentSceneItem && bothFeetSupported
      && (expected.pose !== 'wash' || receipt.measurement.headInZone === true);
  });
  const checks = {
    webgl2: completed.webgl2 === true,
    savedHomeSceneLoaded: completed.life?.location === 'home' && completed.room?.savedFurnitureIds?.length > 0 && JSON.stringify(completed.room.savedFurnitureIds) === JSON.stringify(completed.room.renderedFurnitureIds),
    actualStarterBedAndChair: ['spring-bed', 'plastic-chair'].every((id) => completed.samples?.['male-casual-standing']?.visibleFurniture?.some((item) => item.itemId === id)),
    actionPurchasedActualTubAndShower: completed.buys?.bathtub?.code === 'bought' && completed.buys?.['shower-cubicle']?.code === 'bought',
    actualTimedActivitiesStartedAndCompleted: actionPass,
    snapshotsShowRealActiveActions: poseActionSamples,
    everyJourneyFrameWasCapturedAtItsRequestedStage: captures.filter((item) => item.name !== 'mobile-390').every((item) => item.acknowledged === true),
    sameHomeHasBothSavedIdentityRecords: captures.some((item) => item.name === 'male-casual-standing')
      && completed.samples?.['female-office-standing']?.boneCount > 0,
    playerBodyRendered: completed.samples?.['male-casual-standing']?.boneCount > 0 && completed.samples?.['male-casual-standing']?.render?.triangles > 0,
    preparedNativeBodyRendered: completed.samples?.['male-casual-standing']?.preparedNativeRigDetected === true
      && completed.samples?.['female-office-standing']?.preparedNativeRigDetected === true,
    homeNativeRestMeasurements,
    bodyGeometryChangesAcrossRequestedPoses: actionNames.every((id) => {
      const active = completed.samples?.[id]?.bodyPoseSignature;
      const standing = completed.samples?.['male-casual-standing']?.bodyPoseSignature;
      return typeof active === 'string' && active.length > 0 && active !== standing;
    }),
    sceneReachedActualFurnitureUsePhase: actionNames.every((id) => {
      const active = completed.samples?.[id];
      const ended = completed.samples?.[`${id}-completed`];
      return (active?.sceneObjectPhase === 'use' || active?.sceneObjectPhase === 'rest')
        && ended?.sceneObjectPhase === 'idle' && active.navigationWaypoints > 0;
    }),
    mobileLayoutSingleColumn: mobileLayout.width === 390 && mobileLayout.scrollWidth <= 390
      && mobileLayout.columns.split(' ').length === 1,
    browserConsoleClean: consoleErrors.length === 0,
    disposeIdempotent: disposal?.disposed === true && disposalAgain?.repeated === false,
  };
  const nativePoseContactAccepted = checks.preparedNativeBodyRendered && checks.homeNativeRestMeasurements;
  report = { status: Object.values(checks).every(Boolean) ? 'diagnostic-pass' : 'diagnostic-fail', checks, nativePoseContactAccepted,
    purpose: 'Source-only home lifecycle diagnostic; it does not confer production acceptance.',
    sceneSource: 'src/scene/home-scene.ts', lifeSource: 'src/life.ts', exactBase: 'c1f7c1f7369139ce559292318ba9842c23a28267',
    captures, mobile: { ...mobile, layout: mobileLayout }, final: completed, consoleErrors, disposal };
  await writeFile(path.join(resultDir, 'home-journey-report.json'), JSON.stringify(report, null, 2));
  if (!Object.values(checks).every(Boolean)) throw new Error(`Home journey diagnostic failed: ${JSON.stringify(checks)}`);
} catch (error) {
  report = { status: 'failed', error: error instanceof Error ? error.message : String(error), consoleErrors, chromeStderr, latest: lastJourneySnapshot };
  await writeFile(path.join(resultDir, 'home-journey-failure.json'), JSON.stringify(report, null, 2)).catch(() => {});
  throw error;
} finally {
  socket?.close(); chrome.kill('SIGTERM'); server.close();
  await delay(200);
  await rm(profile, { recursive: true, force: true });
}
