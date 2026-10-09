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
const html = path.relative(repo, path.join(here, 'idle-pose-diagnostic.html')).split(path.sep).join('/');
const runId = (process.env.GITHUB_RUN_ID ?? `remote-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
const results = path.join(here, 'idle-pose-results', runId);
const chromeBin = process.env.CHROME_BIN ?? ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
  .map((name) => spawnSync('which', [name], { encoding: 'utf8' })).find((result) => result.status === 0)?.stdout.trim();
if (!chromeBin) throw new Error('Set CHROME_BIN to the remote Chrome/Chromium executable');
await stat(path.join(here, 'idle-pose-diagnostic.bundle.js')).catch(() => { throw new Error('Run bundle-idle-pose-diagnostic.mjs first'); });
const inputManifestPath = path.join(here, 'idle-pose-diagnostic-input-manifest.json');
const inputManifest = JSON.parse(await readFile(inputManifestPath, 'utf8'));
if (inputManifest.schema !== 'native-idle-diagnostic-inputs-v1') throw new Error('Idle diagnostic input manifest schema mismatch');
for (const [relative, pin] of Object.entries(inputManifest.files)) {
  const bytes = await readFile(path.join(repo, relative));
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== pin.sha256 || bytes.length !== pin.bytes) throw new Error(`Idle diagnostic pinned input changed: ${relative}`);
}
await mkdir(results, { recursive: true });

const mime = new Map([['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json'], ['.glb', 'model/gltf-binary'], ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg']]);
const server = createServer(async (request, response) => {
  try {
    const requested = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
    const filename = path.resolve(repo, `.${requested}`);
    if (!filename.startsWith(`${repo}${path.sep}`)) throw new Error('Asset path escaped checkout');
    const bytes = await readFile(filename);
    response.writeHead(200, { 'content-type': mime.get(path.extname(filename).toLowerCase()) ?? 'application/octet-stream',
      'cache-control': 'no-store', 'content-length': bytes.length });
    response.end(bytes);
  } catch { response.writeHead(404); response.end('not found'); }
});
server.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
const port = server.address().port, profile = await mkdtemp(path.join(os.tmpdir(), 'native-idle-diagnostic-'));
const chrome = spawn(chromeBin, ['--headless=new', '--no-sandbox', '--renderer-process-limit=1', '--disable-extensions',
  '--disable-background-networking', '--disable-dev-shm-usage', '--disable-gpu', '--disable-gpu-sandbox',
  '--remote-debugging-port=0', '--remote-allow-origins=*', '--no-first-run', '--no-default-browser-check',
  '--window-size=900,700', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeStderr = '', socket, nextId = 0;
chrome.stderr.on('data', (chunk) => { chromeStderr = (chromeStderr + chunk.toString()).slice(-12_000); });
const pending = new Map();
const consoleErrors = [];
async function debugPort() {
  const file = path.join(profile, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try { return Number((await readFile(file, 'utf8')).split('\n')[0]); }
    catch { if (chrome.exitCode !== null) throw new Error(`Chrome exited early: ${chromeStderr}`); await delay(100); }
  }
  throw new Error(`Chrome DevTools port did not appear: ${chromeStderr}`);
}
function cdp(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { if (pending.delete(id)) reject(new Error(`CDP timeout: ${method}`)); }, 15_000);
    pending.set(id, { resolve: (value) => { clearTimeout(timeout); resolve(value); }, reject: (error) => { clearTimeout(timeout); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const value = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (value.exceptionDetails) throw new Error(value.exceptionDetails.text ?? JSON.stringify(value.exceptionDetails));
  return value.result?.value;
}
const sha = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');
let report, latest;
try {
  const response = await fetch(`http://127.0.0.1:${await debugPort()}/json/new?about:blank`, { method: 'PUT' });
  if (!response.ok) throw new Error(`Chrome target creation failed (${response.status})`);
  const target = await response.json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.id && pending.has(message.id)) {
      const item = pending.get(message.id); pending.delete(message.id);
      if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') consoleErrors.push(message.params.exceptionDetails?.text ?? 'browser exception');
    else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') consoleErrors.push(message.params.args.map((arg) => arg.value ?? '').join(' '));
  });
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/${html}` });
  const deadline = Date.now() + 98_000;
  while (Date.now() < deadline) {
    latest = await evaluate('window.nativeIdleDiagnostic?.sample?.() ?? null').catch(() => null);
    if (latest && latest.status !== 'loading') break;
    await delay(100);
  }
  if (!latest || latest.status !== 'ready') throw new Error(`Idle diagnosis did not complete successfully: ${JSON.stringify({ latest, consoleErrors })}`);
  const owned = path.join(here, 'owned-src/src/scene/body/native/native-full-runtime-v1/native-prepared-factory.ts');
  const fixture = path.join(here, 'game-fixture.ts');
  report = { ...latest, pins: { factoryPath: path.relative(repo, owned), factorySha256: await sha(owned),
    savedLookSourcePath: path.relative(repo, fixture), savedLookSourceSha256: await sha(fixture), inputs: inputManifest.files }, consoleErrors };
  if (consoleErrors.length || Object.values(latest.checks ?? {}).some((value) => value !== true)) throw new Error('Idle diagnostic checks failed');
  await writeFile(path.join(results, 'idle-pose-diagnostic-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, result: path.join(results, 'idle-pose-diagnostic-report.json'), pins: report.pins,
    source: report.source, modes: Object.fromEntries(Object.entries(report.modes).map(([mode, value]) => [mode,
      { poseAfterShow: value.poseAfterShow, stages: value.stages.map((stage) => ({ stage: stage.stage, solve: stage.solve })) }])) }));
} catch (error) {
  report = { status: 'failed', error: error instanceof Error ? error.message : String(error), latest, consoleErrors, chromeStderr };
  await writeFile(path.join(results, 'idle-pose-diagnostic-failure.json'), JSON.stringify(report, null, 2)).catch(() => {});
  throw error;
} finally {
  socket?.close(); chrome.kill('SIGTERM'); server.close();
  await delay(150); await rm(profile, { recursive: true, force: true });
}
