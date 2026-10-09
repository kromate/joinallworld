import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, openSync, closeSync, readSync, createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INPUT = path.resolve(process.env.ARTIFACT_DIR ?? '');
const OUT = path.resolve(process.env.RESULT_DIR ?? '');
const PIN_PATH = path.join(HERE, 'artifact-pin.json');
if (process.platform !== 'linux') throw new Error('Remote Linux only; local execution is refused');
if (!path.isAbsolute(INPUT) || !path.isAbsolute(OUT) || INPUT === OUT) throw new Error('ARTIFACT_DIR and distinct RESULT_DIR must be absolute');
const pin = JSON.parse(await readFile(PIN_PATH, 'utf8'));
if (pin.schema !== 'allworld-market-lod-v7-remote-gpu-review-pin-v2' || pin.githubRunId !== 37888890296
  || pin.commit !== 'e603cd25be04b350d63001b1d6ecbe2e1c82db28' || pin.captureMatrix?.expectedPngCount !== 24
  || JSON.stringify(pin.captureMatrix?.modes) !== JSON.stringify(['source', 'compact'])
  || JSON.stringify(pin.captureMatrix?.yawsDegrees) !== JSON.stringify([0, 90])
  || JSON.stringify(pin.captureMatrix?.poses) !== JSON.stringify(['idle', 'walk', 'interact'])) {
  throw new Error('Unexpected v2 review pin or capture matrix');
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const shaFile = async file => { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); };
async function findNamed(dir, name, found = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) await findNamed(target, name, found);
    else if (entry.name === name) found.push(target);
  }
  return found;
}
const manifests = await findNamed(INPUT, 'build-manifest.json');
if (manifests.length !== 1) throw new Error(`Expected one downloaded package manifest, got ${manifests.length}`);
const DIST = path.dirname(manifests[0]);
if (sha(await readFile(manifests[0])) !== pin.packageManifestSha256) throw new Error('Downloaded artifact is not the pinned package manifest');
const buildManifest = JSON.parse(await readFile(manifests[0], 'utf8'));
if (buildManifest.status !== pin.packageStatus || buildManifest.builderSha256 !== 'd58915d7d5ac0f3188a45643f58703803bf77caded904e1cb3b64e1f6d05300e'
  || buildManifest.inputShaGuards?.['evidence/graphics-loop/crowd-lod-market-v7/viewer-market-gpu-v7.ts'] !== 'ae57c60e2b7645412872025309ceb6fcc7ae841f0b25414510d785b2488aaa5e') {
  throw new Error('Artifact provenance/status differs from the reviewed run pin');
}
const outputRecords = new Map(buildManifest.outputs.map(item => [item.path, item]));
const verifiedOutputs = [];
for (const [relative, expected] of Object.entries(pin.outputs)) {
  const record = outputRecords.get(relative), file = path.join(DIST, relative);
  if (!record || record.bytes !== expected.bytes || record.sha256 !== expected.sha256 || await shaFile(file) !== expected.sha256) {
    throw new Error(`Pinned package output mismatch: ${relative}`);
  }
  verifiedOutputs.push({ path: relative, bytes: expected.bytes, sha256: expected.sha256 });
}
if (outputRecords.size !== Object.keys(pin.outputs).length) throw new Error('Package output inventory has unreviewed or missing files');
const inventory = JSON.parse(await readFile(path.join(DIST, 'assets/candidate-market-day-12.json'), 'utf8'));
for (const actor of pin.actors) {
  const saved = inventory.fixture?.crowd?.find(item => item.id === actor.id);
  if (!saved || saved.seed !== actor.seed || saved.look?.body !== actor.body || saved.look?.outfit !== actor.outfit) {
    throw new Error(`Pinned actor record differs from packaged inventory: ${actor.id}`);
  }
}
if (!existsSync(OUT)) await mkdir(OUT, { recursive: false });
const preexisting = await readdir(OUT);
if (preexisting.some(name => name !== 'review-cdp.log')) throw new Error('Refusing to overwrite preexisting remote review outputs');

const runtime = {
  platform: process.platform, arch: os.arch(), kernel: os.release(), node: process.version,
  runnerImage: process.env.ImageOS ?? null, runnerVersion: process.env.ImageVersion ?? null,
  githubRunId: process.env.GITHUB_RUN_ID ?? null, sourceRunId: pin.githubRunId, sourceCommit: pin.commit,
  artifactManifestSha256: pin.packageManifestSha256, rendererClaim: 'headless Chrome ANGLE SwiftShader; not hardware or phone performance evidence',
};
const mime = new Map([['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'], ['.glb', 'model/gltf-binary'], ['.json', 'application/json']]);
const routes = new Map([
  ['/', 'index.html'], ['/index.html', 'index.html'], ['/viewer.js', 'viewer.js'],
  ['/assets/base-body-male-M7EPTVJF.glb', 'assets/base-body-male-M7EPTVJF.glb'],
  ['/assets/base-body-female-FCFDQK6E.glb', 'assets/base-body-female-FCFDQK6E.glb'],
  ['/assets/clip-pack-MH5ZQFHK.glb', 'assets/clip-pack-MH5ZQFHK.glb'],
  ['/assets/candidate-market-day-12.json', 'assets/candidate-market-day-12.json'],
  ['/evidence/graphics-loop/venue-authored-people-browser-v1/candidate-market-day-12.json', 'assets/candidate-market-day-12.json'],
  ['/src/scene/body/assets/base-body-male.glb', 'assets/base-body-male-M7EPTVJF.glb'],
  ['/src/scene/body/assets/base-body-female.glb', 'assets/base-body-female-FCFDQK6E.glb'],
]);
const requestLog = [];
const server = createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method ?? '')) { res.writeHead(405).end(); return; }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
    if (url.search) { res.writeHead(404).end(); return; }
    const relative = routes.get(url.pathname);
    if (!relative) { requestLog.push({ path: url.pathname, status: 404 }); res.writeHead(404).end(); return; }
    const file = path.resolve(DIST, relative), rel = path.relative(DIST, file);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !outputRecords.has(relative)) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': mime.get(path.extname(file)) ?? 'application/octet-stream', 'cache-control': 'no-store', 'content-length': data.byteLength });
    requestLog.push({ path: url.pathname, output: relative, status: 200, bytes: data.byteLength });
    req.method === 'HEAD' ? res.end() : res.end(data);
  } catch { res.writeHead(404, { 'cache-control': 'no-store' }).end('not found'); }
});
let chrome = null, socket = null, profile = null, chromeLog = null, serverAddress = null, id = 0;
const pending = new Map(), events = { exceptions: [], consoleErrors: [], failedRequests: [], httpErrors: [] }, captures = [], pairs = [];
let chromeLogFd = null;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function send(method, params = {}) {
  const requestId = ++id;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 7000);
    pending.set(requestId, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
}
function socketData(message) {
  if (message.id) {
    const task = pending.get(message.id); if (!task) return;
    clearTimeout(task.timer); pending.delete(message.id);
    message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result);
  } else if (message.method === 'Runtime.exceptionThrown') events.exceptions.push(message.params.exceptionDetails?.text ?? 'runtime exception');
  else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') events.consoleErrors.push((message.params.args ?? []).map(arg => arg.value ?? arg.description ?? '').join(' '));
  else if (message.method === 'Network.loadingFailed') events.failedRequests.push({ error: message.params.errorText, canceled: message.params.canceled });
  else if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) events.httpErrors.push({ url: message.params.response.url, status: message.params.response.status });
}
function onData(data) { socketData(JSON.parse(data.toString())); }
async function evaluate(expression, awaitPromise = false) {
  const response = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: true });
  if (response.exceptionDetails) throw new Error(`Page evaluation failed: ${response.exceptionDetails.text}`);
  return response.result?.value;
}
async function waitFor(predicate, description, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await wait(80); }
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
  socket.on('message', onData);
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
}
async function snap(actor, mode, pose, yaw, phase) {
  const state = await evaluate(`(()=>{
    const set=(id,value)=>{const e=document.getElementById(id);e.value=String(value);e.dispatchEvent(new Event('change',{bubbles:true}));};
    set('mode',${JSON.stringify(mode)});set('pose',${JSON.stringify(pose)});set('yaw',${JSON.stringify(yaw)});set('phase',${JSON.stringify(phase)});
    document.getElementById('render').click();
    return true;
  })()`);
  if (!state) throw new Error('Could not set fixture state');
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))', true);
  await wait(60);
  const record = await evaluate(`JSON.parse(document.getElementById('status').textContent)`);
  const expectedActor = pin.actors.find(item => item.id === actor);
  const checks = {
    actor: record.actor === actor, seed: record.seed === expectedActor.seed,
    family: record.family === expectedActor.family,
    body: record.normalizedLook?.body === expectedActor.body,
    outfit: record.normalizedLook?.outfit === expectedActor.outfit,
    mode: record.mode === mode, pose: record.pose === pose, yaw: record.yawDegrees === yaw,
    walkPhase: record.walkPhase === phase,
    livePoseCheckpoint: record.exactBonePoseCheckpointAfterToggle === true,
    sourceIdentityPresent: record.sourceIdentity?.actorId === actor && typeof record.sourceIdentity?.assetSha === 'string' && /^[0-9a-f]{64}$/.test(record.sourceIdentity.assetSha),
    rendererCounts: record.renderer?.calls > 0 && record.renderer?.triangles > 0,
    compactBytesPresent: mode !== 'compact' || record.compactStorage?.totalTypedGeometryBytes > 0,
  };
  if (Object.values(checks).some(value => value !== true)) throw new Error(`Refused frame ${actor}/${mode}/${pose}/${yaw}: ${JSON.stringify({ checks, record })}`);
  const bounds = await evaluate(`(()=>{const r=document.getElementById('view').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
  const image = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false,
    clip: { ...bounds, scale: 1 } });
  const bytes = Buffer.from(image.data, 'base64');
  const filename = `${actor}-${mode}-${pose}-p${String(phase).replace('.', '_')}-yaw${yaw}.png`;
  await writeFile(path.join(OUT, filename), bytes, { flag: 'wx' });
  const storage = record.compactStorage;
  return { actor, mode, pose, yaw, phase, file: filename, bytes: bytes.byteLength, sha256: sha(bytes), checks, metrics: {
    sourceTriangles: record.sourceTriangles, compactTriangles: record.compactTriangles,
    frameTriangles: record.renderer.triangles, drawCalls: record.renderer.calls,
    typedGeometryBytes: storage?.totalTypedGeometryBytes ?? null,
    bodyIndexBytes: storage?.bodyIndexBytes ?? null, wardrobeIndexBytes: storage?.wardrobeIndexBytes ?? null,
    bodyAttributeBytes: storage?.bodyAttributeBytes ?? null, wardrobeAttributeBytes: storage?.wardrobeAttributeBytes ?? null,
    identity: record.sourceIdentity, recipeMetrics: record.recipeMetrics,
  } };
}
async function close() {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  if (chrome && chrome.exitCode === null) { chrome.kill('SIGTERM'); await Promise.race([new Promise(resolve => chrome.once('exit', resolve)), wait(1200)]); if (chrome.exitCode === null) chrome.kill('SIGKILL'); }
  if (profile) await rm(profile, { recursive: true, force: true });
  if (server.listening) await new Promise(resolve => server.close(resolve));
}
let failure = null, webgl = null, status = 'failed';
try {
  const chromeLauncherPath = await realpath(process.env.CHROME_BIN ?? '');
  const launcherHash = await shaFile(chromeLauncherPath);
  const siblingBinary = path.join(path.dirname(chromeLauncherPath), 'chrome');
  const siblingFd = existsSync(siblingBinary) ? openSync(siblingBinary, 'r') : null;
  let siblingHeader = null;
  if (siblingFd !== null) { siblingHeader = Buffer.alloc(4); readSync(siblingFd, siblingHeader, 0, 4, 0); closeSync(siblingFd); }
  const isElf = header => header?.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
  const chromePath = isElf(siblingHeader) ? await realpath(siblingBinary) : chromeLauncherPath;
  const binaryFd = openSync(chromePath, 'r'), binaryHeader = Buffer.alloc(4);
  readSync(binaryFd, binaryHeader, 0, 4, 0); closeSync(binaryFd);
  if (!isElf(binaryHeader)) throw new Error('Resolved Chrome executable is not an ELF binary');
  const launcherVersion = execFileSync(chromeLauncherPath, ['--version'], { encoding: 'utf8', timeout: 3000 }).trim();
  const binaryVersion = execFileSync(chromePath, ['--version'], { encoding: 'utf8', timeout: 3000 }).trim();
  runtime.chromeLauncherPath = chromeLauncherPath; runtime.chromeLauncherSha256 = launcherHash;
  runtime.chromePath = chromePath; runtime.chromeVersion = launcherVersion; runtime.chromeBinaryVersion = binaryVersion;
  runtime.chromeSha256 = await shaFile(chromePath);
  runtime.chromeProcessFlags = ['--single-process', '--in-process-gpu', '--no-zygote', '--renderer-process-limit=1'];
  runtime.chromeProcessTopology = 'Constrained SwiftShader diagnostic topology selected to fit the measured 768 MiB process-group budget; not representative of normal multi-process or mobile performance.';
  const address = await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address())); });
  if (!address || typeof address === 'string' || address.address !== '127.0.0.1') throw new Error('Static host must bind loopback only');
  serverAddress = address; profile = await mkdtemp(path.join(os.tmpdir(), 'market-lod-v7-cdp-'));
  chromeLog = path.join(OUT, 'chrome.log');
  chromeLogFd = openSync(chromeLog, 'wx');
  const chromeArgs = ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu-sandbox','--single-process','--in-process-gpu','--no-zygote','--renderer-process-limit=1','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader','--disable-extensions','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'];
  chrome = spawn(chromePath, chromeArgs, { stdio: ['ignore', chromeLogFd, chromeLogFd] });
  const port = await devtoolsPort(); await connect(port);
  await send('Page.navigate', { url: `http://127.0.0.1:${address.port}/` });
  await waitFor(async () => await evaluate(`document.documentElement.dataset.ready === 'controls-ready'`).catch(() => false), 'fixture controls');
  const rendererInfo = await evaluate(`(()=>{const c=document.getElementById('view'),g=c.getContext('webgl2')||c.getContext('webgl'),e=g?.getExtension('WEBGL_debug_renderer_info');return g?{version:g.getParameter(g.VERSION),vendor:g.getParameter(e?e.UNMASKED_VENDOR_WEBGL:g.VENDOR),renderer:g.getParameter(e?e.UNMASKED_RENDERER_WEBGL:g.RENDERER),shadingLanguage:g.getParameter(g.SHADING_LANGUAGE_VERSION)}:null})()`);
  webgl = rendererInfo;
  if (!String(rendererInfo?.renderer ?? '').toLowerCase().includes('swiftshader')) throw new Error(`Expected ANGLE SwiftShader, got ${JSON.stringify(rendererInfo)}`);
  for (const { id: actor, seed, family, body, outfit } of pin.actors) {
    await evaluate(`(()=>{const e=document.getElementById('actor');e.value=${JSON.stringify(actor)};const m=document.getElementById('mode');m.value='source';document.getElementById('load').click();return true})()`);
    await waitFor(async () => await evaluate(`document.documentElement.dataset.ready === 'true' && document.documentElement.dataset.actor === ${JSON.stringify(actor)} && document.documentElement.dataset.mode === 'source'`).catch(() => false), `loaded actor ${actor}`, 18000);
    let familyIdentity = null;
    for (const pose of pin.captureMatrix.poses) for (const yaw of pin.captureMatrix.yawsDegrees) {
      const phase = pose === 'walk' ? pin.captureMatrix.walkPhase : 0;
      const source = await snap(actor, 'source', pose, yaw, phase);
      const compact = await snap(actor, 'compact', pose, yaw, phase);
      if (JSON.stringify(source.metrics.identity) !== JSON.stringify(compact.metrics.identity)) throw new Error(`Identity/signature changed across geometry toggle: ${actor}/${pose}/${yaw}`);
      if (source.metrics.sourceTriangles !== compact.metrics.sourceTriangles || source.metrics.compactTriangles !== compact.metrics.compactTriangles) throw new Error(`Recipe triangle counts drifted across A/B: ${actor}/${pose}/${yaw}`);
      familyIdentity ??= source.metrics.identity;
      pairs.push({ actor, seed, family, body, outfit, pose, yaw, phase, identityEqual: true,
        source: { file: source.file, sha256: source.sha256, metrics: source.metrics },
        compact: { file: compact.file, sha256: compact.sha256, metrics: compact.metrics } });
      captures.push(source, compact);
    }
  }
  if (captures.length !== pin.captureMatrix.expectedPngCount) throw new Error(`Expected ${pin.captureMatrix.expectedPngCount} captures, got ${captures.length}`);
  for (const required of ['/evidence/graphics-loop/venue-authored-people-browser-v1/candidate-market-day-12.json',
    '/src/scene/body/assets/base-body-male.glb', '/src/scene/body/assets/base-body-female.glb']) {
    if (!requestLog.some(item => item.path === required && item.status === 200)) throw new Error(`Required fixture alias was not requested: ${required}`);
  }
  if (events.exceptions.length || events.consoleErrors.length || events.failedRequests.length || events.httpErrors.length) throw new Error(`Browser errors: ${JSON.stringify(events)}`);
  status = 'captured-diagnostic';
} catch (error) { failure = error instanceof Error ? error.stack ?? error.message : String(error); }
finally { await close(); }
if (chromeLogFd !== null) closeSync(chromeLogFd);
const report = { schema: 'allworld-market-lod-v7-remote-gpu-review-v2', status, success: status === 'captured-diagnostic' && captures.length === pin.captureMatrix.expectedPngCount,
  failure, runtime, webgl, verifiedOutputs, routeLog: requestLog, captures: captures.map(item => ({ actor: item.actor, mode: item.mode, pose: item.pose, yaw: item.yaw, phase: item.phase, file: item.file, bytes: item.bytes, sha256: item.sha256, checks: item.checks })), pairs,
  events, limits: ['SwiftShader pixels are diagnostic only, not hardware-GPU or mobile acceptance.', 'This two-identity sample does not prove all Market looks or whole-scene budgets.', 'Walk is sampled at a matched phase; no sustained-motion cadence claim.', 'No production integration or acceptance is implied.'] };
await writeFile(path.join(OUT, 'review-results.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ status, success: report.success, failure, captures: captures.length, output: OUT }, null, 2));
if (!report.success) process.exitCode = 1;
