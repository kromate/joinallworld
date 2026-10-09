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
const bundlePath = path.join(here, 'prepared-viewer.bundle.js');
const htmlRelative = path.relative(repo, path.join(here, 'prepared-viewer.html')).split(path.sep).join('/');
const runId = (process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
const resultDir = path.join(here, 'remote-results', runId);
const chromeBin = process.env.CHROME_BIN ?? ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
  .map((name) => spawnSync('which', [name], { encoding: 'utf8' })).find((result) => result.status === 0)?.stdout.trim();
if (!chromeBin) throw new Error('Set CHROME_BIN to the remote runner Chrome/Chromium executable');
await stat(bundlePath).catch(() => { throw new Error('Prepared viewer bundle missing; run bundle-prepared-viewer.mjs first'); });
await mkdir(resultDir, { recursive: true });

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'], ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'], ['.glb', 'model/gltf-binary'], ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
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
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
});
server.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
const port = server.address().port;
const profile = await mkdtemp(path.join(os.tmpdir(), 'native-prepared-review-'));
const chromeArgs = [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-port=0', '--remote-allow-origins=*',
  '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader-webgl',
  '--window-size=1440,1120', `--user-data-dir=${profile}`, 'about:blank',
];
const chrome = spawn(chromeBin, chromeArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeStderr = '';
chrome.stderr.on('data', (chunk) => { chromeStderr = (chromeStderr + chunk.toString()).slice(-12_000); });
let socket;
let report;
let nextId = 0;
const pending = new Map();
const consoleErrors = [];

async function readDebugPort() {
  const file = path.join(profile, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 100; attempt++) {
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
    const timeout = setTimeout(() => { if (pending.delete(id)) reject(new Error(`Chrome DevTools command timed out: ${method}`)); }, 20_000);
    const item = pending.get(id);
    item.resolve = (value) => { clearTimeout(timeout); resolve(value); };
    item.reject = (error) => { clearTimeout(timeout); reject(error); };
  });
}

async function evaluate(expression) {
  const response = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text ?? JSON.stringify(response.exceptionDetails));
  if (response.result?.subtype === 'error') throw new Error(response.result.description ?? 'Browser evaluation failed');
  return response.result?.value;
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
    } else if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails?.text ?? 'Browser exception');
    else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
    }
  });
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1120, deviceScaleFactor: 1, mobile: false });
  const pageUrl = `http://127.0.0.1:${port}/${htmlRelative}`;
  await cdp('Page.navigate', { url: pageUrl });
  const deadline = Date.now() + 110_000;
  let readyState = 'loading';
  while (Date.now() < deadline) {
    readyState = await evaluate('window.nativePreparedReview?.readyState ?? "loading"').catch(() => 'loading');
    if (readyState === 'ready' || readyState === 'failed') break;
    await delay(250);
  }
  if (readyState !== 'ready') {
    const failure = await evaluate('window.nativePreparedReview?.sample?.() ?? null').catch((error) => ({ error: String(error) }));
    throw new Error(`Prepared viewer did not become ready (${readyState}): ${JSON.stringify(failure)}`);
  }
  const appearanceChange = await evaluate('window.nativePreparedReview.changeNpcIdentityAndPalette()');
  const interaction = await evaluate('window.nativePreparedReview.interact()');
  await delay(1_200);
  const screenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true });
  const screenshotBytes = Buffer.from(screenshot.data, 'base64');
  const screenshotPath = path.join(resultDir, 'prepared-viewer.png');
  await writeFile(screenshotPath, screenshotBytes);
  const preProbeSnapshot = await evaluate('window.nativePreparedReview.sample()');
  const contactGate = Object.fromEntries(['player', 'npc'].map((key) => {
    const diagnostic = preProbeSnapshot.actors?.[key]?.contactDiagnostics;
    return [key, {
      samples: diagnostic?.samples ?? 0,
      maxError: diagnostic?.maxError ?? null,
      limitedSamples: diagnostic?.limitedSamples ?? null,
      passed: Number.isFinite(diagnostic?.maxError) && diagnostic.maxError <= 0.004 && diagnostic.limitedSamples === 0 && diagnostic.samples > 0,
    }];
  }));
  const unsupportedProbe = await evaluate('window.nativePreparedReview.probeUnsupportedPose()');
  const postProbeSnapshot = await evaluate('window.nativePreparedReview.sample()');
  const npcRestoredIdle = postProbeSnapshot.actors?.npc?.pose === 'idle';
  const pageStatus = await evaluate('document.querySelector("#status")?.textContent ?? "missing status"');
  const success = preProbeSnapshot?.state === 'ready'
    && preProbeSnapshot.errors?.length === 0
    && Object.values(contactGate).every((contact) => contact.passed)
    && preProbeSnapshot.actors?.player?.family === 'male'
    && preProbeSnapshot.actors?.npc?.family === 'female'
    && preProbeSnapshot.actors?.player?.preparedMetrics?.clothingTriangles > 0
    && preProbeSnapshot.actors?.npc?.preparedMetrics?.clothingTriangles > 0
    && preProbeSnapshot.actors?.npc?.look?.face === 'round'
    && npcRestoredIdle
    && appearanceChange?.accepted === true
    && interaction?.accepted === true
    && consoleErrors.length === 0;
  report = {
    status: success ? 'PASS' : 'FAIL',
    pageUrl,
    screenshot: { path: path.basename(screenshotPath), bytes: screenshotBytes.length, sha256: createHash('sha256').update(screenshotBytes).digest('hex') },
    pageStatus,
    appearanceChange,
    interaction,
    actors: preProbeSnapshot?.actors,
    errorsBeforeExpectedProbe: preProbeSnapshot?.errors ?? [],
    errorsAfterProbe: postProbeSnapshot?.errors ?? [],
    contactGate,
    contactLimitEvents: preProbeSnapshot?.contactLimitEvents ?? [],
    npcRestoredIdle,
    unsupportedProbe,
    surfacedFactoryLimits: preProbeSnapshot?.actors?.player?.preparedMetrics?.contactLimitations,
    shaderConsoleErrors: consoleErrors,
    browserConsoleErrors: consoleErrors,
    chrome: spawnSync(chromeBin, ['--version'], { encoding: 'utf8' }).stdout.trim(),
    constraints: { oneSharedKit: true, nativeFactory: 'prepareNativeSkinnedBody', localBuildOrBrowser: false },
  };
  await writeFile(path.join(resultDir, 'prepared-review.json'), `${JSON.stringify(report, null, 2)}\n`);
  if (!success) throw new Error(`Prepared viewer contract failed: ${JSON.stringify({ pageStatus, contactGate, npcRestoredIdle, errors: preProbeSnapshot?.errors, actors: preProbeSnapshot?.actors })}`);
  console.log(JSON.stringify({ status: report.status, resultDir, screenshot: report.screenshot, pageStatus, unsupportedProbe }));
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  report = report ? { ...report, status: 'FAIL', error: message } : { status: 'FAIL', error: message, browserConsoleErrors: consoleErrors, chromeStderr };
  await writeFile(path.join(resultDir, 'prepared-review.json'), `${JSON.stringify(report, null, 2)}\n`);
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
