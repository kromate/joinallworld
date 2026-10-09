import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../');
const bundlePath = path.join(here, 'rest-contact-review.bundle.js');
const htmlRelative = path.relative(repo, path.join(here, 'rest-contact-review.html')).split(path.sep).join('/');
const runId = (process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
const resultDir = path.join(here, 'remote-results', runId);
const chromeBin = process.env.CHROME_BIN ?? ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
  .map((name) => spawnSync('which', [name], { encoding: 'utf8' })).find((result) => result.status === 0)?.stdout.trim();
if (!chromeBin) throw new Error('Set CHROME_BIN to the remote runner Chrome/Chromium executable');
await mkdir(resultDir, { recursive: true });
const base3af = '3af17a01b8bd406bfb830ca0d2ee66d2d0093d28';
const sourcePins = [
  ['src/scene/body/poses.ts', '7f328e67ec33d1c94516d76746635e45d8f90a01416176534fa0448d4e797d5e'],
  ['src/scene/body/foot-contact.ts', '6f98bb61fde23e51016148d06136fcb0b46b0b9d5c03cefc73c7ad47745df8c6'],
  ['src/scene/body/skinned.ts', '971a080a5d52bbe351f6b59e5377116d605a8a5c73d8c5e63e146db73a445aab'],
  ['src/scene/home-scene.ts', '31a744babf552bc4bcfdac00e23b59f23ed363ed7f2f94dbd06da5e8b4bcb47d'],
  ['src/game/content/furniture.ts', 'ca0fd127c340e7d10bc493020b83c87dcf09ee23ecdbfe2a6756109753bd04d5'],
];
const assetPins = [
  ['evidence/graphics-loop/authored-complete-body-v1/authored-body-compression/outcompressed/parametric-base-facial-meshopt.glb', 'dfa53941f0fb77d69e59f59fa017f72efa45eddd7e6e8b8414b4a4dba332d552'],
  ['src/scene/body/assets/clip-pack.glb', '89a2c636d3a9d1d9eac0e1125c20ca14d030c55ae27561dd8644b30645fd3d47'],
  ['evidence/graphics-loop/authored-complete-body-v1/authored-clothing/out/male_casualsuit01.glb', '1f8d4fd4b867785226a9c057562289381ae071cf5acbcca248133a3216ae476f'],
  ['evidence/graphics-loop/authored-complete-body-v1/authored-clothing/office-export/out/office-female.glb', 'fd3f4ac0985dae3d6f46469fc8f22ea22d84628c83829c77802a79b1f8f3c053'],
  ['evidence/graphics-loop/authored-complete-body-v1/authored-footwear/out/shoes01-mobile.glb', '8f4060a275356489205f298bed9874da83920c166aeacffd36746e760a465557'],
];
for (const [relative, expected] of sourcePins) {
  const bytes = execFileSync('git', ['show', `${base3af}:${relative}`], { cwd: repo });
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, `source pin ${relative}`);
}
for (const [relative, expected] of assetPins) {
  const bytes = await readFile(path.join(repo, relative));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, `asset pin ${relative}`);
}

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
const profile = await mkdtemp(path.join(os.tmpdir(), 'native-rest-review-'));
const chromeArgs = [
  '--headless=new', '--no-sandbox', '--renderer-process-limit=1', '--disable-extensions', '--disable-background-networking',
  '--disable-dev-shm-usage', '--disable-gpu-sandbox', '--remote-debugging-port=0', '--remote-allow-origins=*',
  '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  '--no-first-run', '--no-default-browser-check', '--window-size=1440,1024', `--user-data-dir=${profile}`, 'about:blank',
];
const chrome = spawn(chromeBin, chromeArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeStderr = '';
chrome.stderr.on('data', (chunk) => { chromeStderr = (chromeStderr + chunk.toString()).slice(-12000); });
let socket;
let nextId = 0;
let report;
const pending = new Map();
const consoleErrors = [];
const failedRequests = [];

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
    pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
    const timeout = setTimeout(() => { if (pending.delete(id)) reject(new Error(`CDP timed out: ${method}`)); }, 20000);
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
async function waitForState(predicate, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await evaluate('window.restContactReview?.snapshot() ?? null').catch(() => null);
    if (predicate(last)) return last;
    await delay(100);
  }
  throw new Error(`${label} timed out: ${JSON.stringify(last)}`);
}
async function capture(name, settleMs = 300) {
  await delay(settleMs);
  const state = await evaluate('window.restContactReview.snapshot()');
  const image = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true });
  const bytes = Buffer.from(image.data, 'base64');
  const filename = `${name}.png`;
  await writeFile(path.join(resultDir, filename), bytes);
  return { state, screenshot: { path: filename, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } };
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
    } else if (message.method === 'Network.loadingFailed') failedRequests.push({ requestId: message.params.requestId, errorText: message.params.errorText, canceled: message.params.canceled ?? false });
  });
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1024, deviceScaleFactor: 1, mobile: false });
  const pageUrl = `http://127.0.0.1:${port}/${htmlRelative}`;
  await cdp('Page.navigate', { url: pageUrl });
  await evaluate('window.restContactReview?.ready');
  await waitForState((state) => state?.ready === true, 'initial prepared actor');

  const captures = [];
  const families = {};
  for (const family of ['man', 'woman']) {
    await evaluate(`window.restContactReview.family(${JSON.stringify(family)})`);
    await waitForState((state) => state?.ready === true && state.family === family && state.pose === 'idle', `${family} actor rebuild`);
    await evaluate('window.restContactReview.yaw(0)');
    const idle = await capture(`${family}-idle-front`);
    families[family] = { idle: idle.state, idleScreenshot: idle.screenshot, rests: {} };
    captures.push(idle.screenshot);

    for (const item of [
      { prop: 'bed', pose: 'lie' }, { prop: 'mat', pose: 'lie' },
      { prop: 'tub', pose: 'soak' }, { prop: 'shower', pose: 'wash' },
    ]) {
      await evaluate(`window.restContactReview.prop(${JSON.stringify(item.prop)})`);
    await evaluate(`window.restContactReview.pose(${JSON.stringify(item.pose)}, true)`);
    const entered = await waitForState((state) => state?.ready === true && state.family === family && state.pose === item.pose && state.easing === false && state.prop === item.prop,
        `${family}/${item.prop} entry`);
    const restMeasurement = entered.restMeasurement;
    assert.ok(restMeasurement, `${family}/${item.prop} must return measured contact evidence`);
    assert.equal(restMeasurement.propId, item.prop);
      assert.equal(restMeasurement.supported, true, `${family}/${item.prop} sampled contact must satisfy its declared support rule: ${restMeasurement.reason}`);
      const front = await capture(`${family}-${item.prop}-${item.pose}-front`);
      assert.deepEqual(front.state.restMeasurement, restMeasurement);
      captures.push(front.screenshot);
      await evaluate('window.restContactReview.yaw(45)');
      const quarter = await capture(`${family}-${item.prop}-${item.pose}-quarter`);
      captures.push(quarter.screenshot);

      await evaluate('window.restContactReview.yaw(0)');
      await evaluate('window.restContactReview.loop(true)');
      await delay(420);
      const loop = await capture(`${family}-${item.prop}-${item.pose}-loop-038`);
      assert.equal(loop.state.pose, item.pose);
      assert.equal(loop.state.prop, item.prop);
      assert.ok(loop.state.restMeasurement, `${family}/${item.prop} loop sample has contact result`);
      assert.equal(loop.state.restMeasurement.supported, true, `${family}/${item.prop} loop contact must remain supported: ${loop.state.restMeasurement.reason}`);
      captures.push(loop.screenshot);
      await evaluate('window.restContactReview.loop(false)');

      await evaluate('window.restContactReview.exit()');
      const exited = await waitForState((state) => state?.ready === true && state.family === family && state.pose === 'idle' && state.easing === false && state.prop === null,
        `${family}/${item.prop} exit`);
      const exit = await capture(`${family}-${item.prop}-exit-idle`);
      assert.equal(exit.state.pose, 'idle');
      assert.equal(exit.state.prop, null);
      captures.push(exit.screenshot);
      families[family].rests[item.prop] = {
        pose: item.pose,
        entry: restMeasurement,
        loop: loop.state.restMeasurement,
        exitPose: exited.pose,
        screenshots: { front: front.screenshot, quarter: quarter.screenshot, loop: loop.screenshot, exit: exit.screenshot },
      };
    }
    const beforeMissingSupport = await evaluate('window.restContactReview.snapshot()');
    const unsupported = await evaluate(`(() => { try { window.restContactReview.pose('lie', false); return { accepted: true }; } catch (error) { return { accepted: false, error: String(error) }; } })()`);
    assert.equal(unsupported.accepted, false, `${family}: lie without bed/mat support must be refused`);
    const afterMissingSupport = await evaluate('window.restContactReview.snapshot()');
    assert.equal(afterMissingSupport.pose, beforeMissingSupport.pose, `${family}: unsupported lie request must preserve the visible pose`);
    families[family].missingSupportRollback = { unsupported, beforePose: beforeMissingSupport.pose, afterPose: afterMissingSupport.pose };
    await evaluate("window.restContactReview.pose('idle', false)");
    await waitForState((state) => state?.pose === 'idle' && state?.prop === null && state?.easing === false, `${family} fixture cleanup`);
  }
  assert.equal(consoleErrors.length, 0, `Browser console errors: ${consoleErrors.join(' | ')}`);
  assert.equal(failedRequests.length, 0, `Browser network failures: ${JSON.stringify(failedRequests)}`);
  report = {
    status: 'PASS', pageUrl, captures, families, consoleErrors, failedRequests,
    base3af, sourcePins: sourcePins.length, assetPins: assetPins.length,
    chrome: spawnSync(chromeBin, ['--version'], { encoding: 'utf8' }).stdout.trim(),
    notes: ['Both prepared body families were loaded from pinned GLBs.', 'Prop surfaces were reconstructed from exact 3af SHAPES geometry.',
      'Rest measurements are sampled witnesses, not whole-mesh collision proofs.', 'No mobile performance conclusion is implied.'],
  };
  await writeFile(path.join(resultDir, 'rest-contact-review.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, resultDir, captures: captures.length, chrome: report.chrome }));
} catch (error) {
  report = { status: 'FAIL', error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error), consoleErrors, failedRequests, chromeStderr };
  await writeFile(path.join(resultDir, 'rest-contact-review.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.error(report.error.stack ?? report.error.message);
  process.exitCode = 1;
} finally {
  socket?.close();
  chrome.kill('SIGTERM');
  await new Promise((resolve) => { if (chrome.exitCode !== null) resolve(); else { chrome.once('exit', resolve); setTimeout(resolve, 2500); } });
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
}
