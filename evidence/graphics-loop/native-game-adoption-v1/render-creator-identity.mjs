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
const bundle = path.join(here, 'creator-identity.bundle.js');
const html = path.relative(repo, path.join(here, 'creator-identity.html')).split(path.sep).join('/');
const runId = (process.env.GITHUB_RUN_ID ?? `remote-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
const results = path.join(here, 'creator-identity-results', runId);
const chromeBin = process.env.CHROME_BIN ?? ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
  .map((name) => spawnSync('which', [name], { encoding: 'utf8' })).find((result) => result.status === 0)?.stdout.trim();
if (!chromeBin) throw new Error('Set CHROME_BIN to the remote runner Chrome/Chromium executable');
await stat(bundle).catch(() => { throw new Error('Creator identity bundle missing; run bundle-creator-identity.mjs first'); });
await mkdir(results, { recursive: true });

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
  } catch { response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); response.end('Not found'); }
});
server.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
const port = server.address().port;
const profile = await mkdtemp(path.join(os.tmpdir(), 'creator-identity-preview-'));
const chrome = spawn(chromeBin, [
  '--headless=new', '--no-sandbox', '--renderer-process-limit=1', '--disable-extensions', '--disable-background-networking',
  '--disable-dev-shm-usage', '--disable-gpu-sandbox', '--remote-debugging-port=0', '--remote-allow-origins=*',
  '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  '--no-first-run', '--no-default-browser-check', '--window-size=1100,900', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeStderr = '';
chrome.stderr.on('data', (chunk) => { chromeStderr = (chromeStderr + chunk.toString()).slice(-16_000); });
let socket;
let nextId = 0;
const pending = new Map();
const consoleErrors = [];
async function debugPort() {
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

let latest = null;
let report;
try {
  const targetResponse = await fetch(`http://127.0.0.1:${await debugPort()}/json/new?about:blank`, { method: 'PUT' });
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
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/${html}` });
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    const domReady = await evaluate(`document.readyState === 'complete' && Boolean(document.querySelector('#preview-host'))`).catch(() => false);
    latest = await evaluate('window.nativeCreatorIdentity?.sample?.() ?? null').catch(() => null);
    if (domReady && latest?.ready) break;
    await delay(200);
  }
  if (!latest?.ready) throw new Error(`Creator identity fixture did not settle before deadline: ${JSON.stringify({ latest, consoleErrors })}`);
  const captures = [];
  for (const name of ['body-front', 'head-front', 'body-profile']) {
    latest = await evaluate(`window.nativeCreatorIdentity.setView(${JSON.stringify(name)})`);
    const direct = await evaluate(`window.nativeCreatorIdentity.exportCaptures().find((capture) => capture.name === ${JSON.stringify(name)})`);
    if (!direct?.dataUrl || !direct.preserveDrawingBuffer) throw new Error(`Missing preserved direct-canvas capture for ${name}`);
    const canvasPng = Buffer.from(direct.dataUrl.slice('data:image/png;base64,'.length), 'base64');
    const canvasFilename = `creator-${name}-canvas.png`;
    await writeFile(path.join(results, canvasFilename), canvasPng);
    const screenshot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true });
    const pagePng = Buffer.from(screenshot.data, 'base64');
    const pageFilename = `creator-${name}-page.png`;
    await writeFile(path.join(results, pageFilename), pagePng);
    captures.push({ name,
      canvas: { path: canvasFilename, bytes: canvasPng.length, sha256: createHash('sha256').update(canvasPng).digest('hex'),
        width: direct.width, height: direct.height, alphaPixels: direct.alphaPixels, visiblePixels: direct.visiblePixels,
        preserveDrawingBuffer: direct.preserveDrawingBuffer },
      page: { path: pageFilename, bytes: pagePng.length, sha256: createHash('sha256').update(pagePng).digest('hex') } });
  }
  const webgl2 = await evaluate(`Boolean(document.querySelector('#preview-host canvas')?.getContext('webgl2'))`);
  const dispose = await evaluate('window.nativeCreatorIdentity.dispose()');
  const disposeAgain = await evaluate('window.nativeCreatorIdentity.dispose()');
  const comparisons = latest.comparisons ?? {};
  const checks = {
    domReadyAndProductionPreview: webgl2 === true && latest.preview?.renderCount > 0,
    creatorAndVenueReturnedBodies: Boolean(latest.creator && latest.venue),
    sameSeedReachedAndWasAcceptedByBothBodies: comparisons.sameSeedReachedAndWasAcceptedByBothBodies === true,
    sameNormalizedLookReachedBothBodies: comparisons.sameNormalizedLookReachedBothBodies === true,
    sameReturnedBodyFamily: comparisons.sameReturnedBodyFamily === true,
    sameReturnedSkeleton: comparisons.sameReturnedSkeleton === true,
    sameReturnedSkinnedGeometry: comparisons.sameReturnedSkinnedGeometry === true,
    bodyHeadAndProfileCaptures: ['body-front', 'head-front', 'body-profile'].every((name) => latest.captures?.some((capture) => capture.name === name)),
    directCanvasPixelsPreservedAndVisible: captures.length === 3 && captures.every((capture) => capture.canvas.preserveDrawingBuffer
      && capture.canvas.alphaPixels > 1_000 && capture.canvas.visiblePixels > 500 && capture.canvas.bytes > 1_000),
    noPreviewAnimationLoop: latest.preview?.animating === false,
    disposeIdempotent: dispose?.disposed === true && dispose?.repeated === false && disposeAgain?.repeated === true,
    noBrowserErrors: consoleErrors.length === 0,
  };
  report = { status: Object.values(checks).every(Boolean) ? 'identity-match-diagnostic' : 'identity-mismatch-diagnostic', checks,
    nativePreparedBodyReturnedForBothContexts: comparisons.preparedNativeBodyReturnedForBothContexts === true,
    webgl2, captures,
    identityEvidence: latest, consoleErrors, disposal: { first: dispose, second: disposeAgain } };
  await writeFile(path.join(results, 'creator-identity-report.json'), JSON.stringify(report, null, 2));
  if (!Object.values(checks).every(Boolean)) throw new Error(`Creator identity diagnostic checks failed: ${JSON.stringify(checks)}`);
} catch (error) {
  report = { status: 'failed', error: error instanceof Error ? error.message : String(error), latest, consoleErrors, chromeStderr };
  await writeFile(path.join(results, 'creator-identity-failure.json'), JSON.stringify(report, null, 2)).catch(() => {});
  throw error;
} finally {
  socket?.close(); chrome.kill('SIGTERM'); server.close();
  await delay(200);
  await rm(profile, { recursive: true, force: true });
}
