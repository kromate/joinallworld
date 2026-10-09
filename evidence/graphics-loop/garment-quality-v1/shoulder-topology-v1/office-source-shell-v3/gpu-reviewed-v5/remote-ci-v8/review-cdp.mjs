import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, closeSync, createReadStream, existsSync, mkdirSync, openSync, readSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { verifySnapshot } from './verify-snapshot.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '../../../../../../..');
const DIST = path.join(HERE, 'dist'), OUTPUT = process.env.RESULT_DIR ? path.join(process.env.RESULT_DIR, 'browser-artifacts') : null;
const expected = process.argv[2];
const stagePath = process.env.RESULT_DIR ? path.join(process.env.RESULT_DIR, 'browser-stages.jsonl') : null;
const stageStart = Date.now();
function stage(name, details = {}) { if (!stagePath) throw new Error('Missing stage artifact path'); appendFileSync(stagePath, `${JSON.stringify({ at: new Date().toISOString(), elapsedMs: Date.now() - stageStart, stage: name, ...details })}\n`, { flag: 'a' }); }
if (stagePath && existsSync(stagePath)) throw new Error('Refusing to overwrite browser stage breadcrumbs');
if (process.platform !== 'linux') throw new Error('This artifact review is remote Linux only');
if (!OUTPUT || !path.isAbsolute(OUTPUT)) throw new Error('RESULT_DIR must be an explicit absolute artifact directory');
const snapshot = await verifySnapshot(expected);
if (existsSync(OUTPUT) && readdirSync(OUTPUT).length) throw new Error('Refusing to overwrite browser artifacts');
mkdirSync(OUTPUT, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function fileSha256(file) { const h=createHash('sha256'); for await (const chunk of createReadStream(file)) h.update(chunk); return h.digest('hex'); }
function firstFourBytes(file) { const fd=openSync(file,'r'), bytes=Buffer.alloc(4); try { const count=readSync(fd,bytes,0,4,0); return count===4?bytes:null; } finally { closeSync(fd); } }
const chromeLauncherPath = await realpath(process.env.CHROME_BIN ?? '');
const launcherSha256 = await fileSha256(chromeLauncherPath);
const siblingBinary = path.join(path.dirname(chromeLauncherPath), 'chrome');
const siblingHeader = existsSync(siblingBinary) ? firstFourBytes(siblingBinary) : null;
const chromePath = siblingHeader?.equals(Buffer.from([0x7f,0x45,0x4c,0x46])) ? await realpath(siblingBinary) : chromeLauncherPath;
const binaryHeader = firstFourBytes(chromePath);
if (!binaryHeader.equals(Buffer.from([0x7f,0x45,0x4c,0x46]))) throw new Error('Could not resolve the actual Chrome ELF binary');
const chromeVersion = execFileSync(chromeLauncherPath, ['--version'], { encoding: 'utf8', timeout: 3000 }).trim();
const chromeBinaryVersion = execFileSync(chromePath, ['--version'], { encoding: 'utf8', timeout: 3000 }).trim();
const chromeSha256 = await fileSha256(chromePath);
const runtime = { node: process.version, platform: process.platform, kernel: os.release(), arch: os.arch(), runnerImage: process.env.ImageOS ?? null, runnerVersion: process.env.ImageVersion ?? null,
  chromeLauncherPath, chromeLauncherSha256: launcherSha256, chromePath, chromeVersion, chromeBinaryVersion, chromeSha256, manifestSha256: snapshot.manifestSha256, rendererMode: 'headless Chrome ANGLE SwiftShader in forced single-process topology; diagnostic only, not representative Chrome memory/runtime or phone/performance evidence', chromeTopologyFlags: ['--single-process','--in-process-gpu','--no-zygote','--renderer-process-limit=1'] };
stage('controller-started', { manifestSha256: runtime.manifestSha256, chromePath, chromeSha256, topology: runtime.chromeTopologyFlags });

const mime = new Map([['.html','text/html; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.glb','model/gltf-binary'],['.json','application/json']]);
const server = createServer(async (req, res) => {
  try {
    if (!['GET','HEAD'].includes(req.method ?? '')) { res.writeHead(405).end(); return; }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
    const requestPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.resolve(DIST, `.${requestPath}`), rel = path.relative(DIST, file);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) { res.writeHead(403).end(); return; }
    const data = await readFile(file); res.writeHead(200, { 'content-type': mime.get(path.extname(file)) ?? 'application/octet-stream', 'cache-control': 'no-store', 'content-length': data.byteLength });
    if (req.method === 'HEAD') res.end(); else res.end(data);
  } catch { res.writeHead(404, { 'cache-control': 'no-store' }).end('not found'); }
});
let chrome = null, ws = null, serverAddress, profile, chromeLog, serverClosed = false, nextId = 0;
const pending = new Map(), browserEvents = { runtimeExceptions: [], consoleErrors: [], failedRequests: [], httpErrors: [] };
let snapshotIndex = 0;
function cdpsend(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 8000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
}
function eventPayload(message) {
  if (message.method === 'Runtime.exceptionThrown') browserEvents.runtimeExceptions.push(message.params.exceptionDetails);
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') browserEvents.consoleErrors.push(message.params.args?.map(arg => arg.value ?? arg.description ?? '').join(' '));
  if (message.method === 'Network.loadingFailed') browserEvents.failedRequests.push({ requestId: message.params.requestId, errorText: message.params.errorText, canceled: message.params.canceled });
  if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) browserEvents.httpErrors.push({ url: message.params.response.url, status: message.params.response.status });
}
function onSocketData(data) {
  const message = JSON.parse(data.toString());
  if (message.id) { const item = pending.get(message.id); if (!item) return; clearTimeout(item.timer); pending.delete(message.id); if (message.error) item.reject(new Error(`${message.error.message}: ${JSON.stringify(message.error.data ?? null)}`)); else item.resolve(message.result); }
  else eventPayload(message);
}
async function evaluate(expression, awaitPromise = false) {
  const result = await cdpsend('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(`Page evaluation failed: ${result.exceptionDetails.text}`);
  return result.result?.value;
}
async function waitFor(predicate, description, timeoutMs = 12000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`Timed out waiting for ${description}`);
}
async function browserPort() {
  const active = path.join(profile, 'DevToolsActivePort');
  await waitFor(() => existsSync(active), 'Chrome DevToolsActivePort', 8000);
  const lines = readFileSync(active, 'utf8').trim().split(/\r?\n/), port = Number(lines[0]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid Chrome DevTools port');
  return port;
}
async function connectPage(port) {
  let targets;
  await waitFor(async () => { try { const r = await fetch(`http://127.0.0.1:${port}/json/list`); targets = await r.json(); return Array.isArray(targets) && targets.some(t => t.type === 'page' && t.webSocketDebuggerUrl); } catch { return false; } }, 'Chrome page target', 8000);
  const target = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.on('message', onSocketData);
  await cdpsend('Page.enable'); await cdpsend('Runtime.enable'); await cdpsend('Log.enable'); await cdpsend('Network.enable');
  await cdpsend('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
}
async function capture(body, yaw, focus, variant) {
  stage('capture-before', { body, pose: 'reach', seconds: 0.6, yaw, focus, variant });
  await evaluate(`window.__OFFICE_CHART_FIXTURE__.setPose('reach',0.6);window.__OFFICE_CHART_FIXTURE__.setYaw(${yaw});window.__OFFICE_CHART_FIXTURE__.setFocus('${focus}');window.__OFFICE_CHART_FIXTURE__.setVariant('${variant}')`);
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))', true);
  await new Promise(resolve => setTimeout(resolve, 120));
  const snapshotValue = await evaluate('window.__OFFICE_CHART_FIXTURE__.snapshot()');
  const errors = await evaluate('window.__OFFICE_CHART_FIXTURE__.shaderErrors()');
  const normalProof = snapshotValue?.[variant]?.sourceNormalProvenance;
  const checks = { comparisonValid: snapshotValue?.comparisonValid === true, sameRetainedOverlay: snapshotValue?.source?.fingerprintFNV32 === snapshotValue?.chart?.fingerprintFNV32, sameSourceChartTopology: snapshotValue?.source?.sourceChartTopologyFingerprint === snapshotValue?.chart?.sourceChartTopologyFingerprint, sourceAttributeCount: snapshotValue?.source?.sourceShellAttributeCount === 7, chartAttributeCount: snapshotValue?.chart?.sourceShellAttributeCount === 11, normalSourceIndexMatchesRaw: normalProof?.fullIndexSha256 === snapshotValue?.[variant]?.sourceIndexSha256, normalOnlyPrivateRebuild: normalProof?.normalOnlyMutation === true && normalProof?.productionDisplayedNormalsMutated === false && normalProof?.nonNormalAttributesByteIdentical === true && normalProof?.fullIndexByteIdentical === true, fullSourceFacesFinite: normalProof?.fullTopology?.triangleCount === 9002 && normalProof?.fullTopology?.nonFiniteNormals === 0 && normalProof?.fullTopology?.nonFiniteFaces === 0 && normalProof?.fullTopology?.degenerateFaces === 0, clippedZeroNormalsRepairedOnShellSupport: normalProof?.supportVerticesZeroUnderMaskedNormals > 0 && normalProof?.supportVerticesZeroAfterFullNormals === 0, body: snapshotValue?.body === body, requestedOutfit: snapshotValue?.requestedOutfit === 'office', pose: snapshotValue?.pose === 'reach', reachSeconds: snapshotValue?.reachSeconds === 0.6,
    yaw: snapshotValue?.yawDegrees === yaw, focus: snapshotValue?.focus === focus, selected: snapshotValue?.selected === variant, chartAdapter: variant !== 'chart' || snapshotValue?.chart?.shellShaderKey === 'allworld-source-corner-skinning-v1', renderedTriangles: snapshotValue?.renderedTriangles > 0, renderCalls: snapshotValue?.renderCalls > 0, shaderErrorsEmpty: Array.isArray(errors) && errors.length === 0 };
  if (Object.values(checks).some(value => value !== true)) throw new Error(`Frame refused: ${JSON.stringify({ body, yaw, focus, variant, checks, snapshot: snapshotValue, errors })}`);
  stage('render-capture-before', { body, pose: 'reach', seconds: 0.6, yaw, focus, variant });
  const shot = await cdpsend('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  const fileName = `${body}-reach0_6-yaw${yaw}-${focus}-${variant}.png`;
  writeFileSync(path.join(OUTPUT, fileName), Buffer.from(shot.data, 'base64'));
  snapshotIndex++;
  stage('capture-after', { body, pose: 'reach', seconds: 0.6, yaw, focus, variant, file: fileName, screenshotBytes: Buffer.from(shot.data, 'base64').byteLength, renderedTriangles: snapshotValue.renderedTriangles, renderCalls: snapshotValue.renderCalls });
  return { file: fileName, sha256: sha(Buffer.from(shot.data, 'base64')), bytes: Buffer.from(shot.data, 'base64').byteLength, body, pose: 'reach', seconds: 0.6, yaw, focus, variant, checks, snapshot: snapshotValue };
}
let cleanupPromise = null;
async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
  if (ws && ws.readyState === WebSocket.OPEN) { try { ws.close(); } catch {} }
  if (chrome && chrome.exitCode === null) { chrome.kill('SIGTERM'); await Promise.race([new Promise(resolve => chrome.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 1200))]); if (chrome.exitCode === null) chrome.kill('SIGKILL'); }
  if (!serverClosed) { serverClosed = true; await new Promise(resolve => server.close(() => resolve())); }
  if (chromeLog !== undefined) closeSync(chromeLog);
  if (profile) rmSync(profile, { recursive: true, force: true });
  })();
  return cleanupPromise;
}
let finalStatus = 'failed', failure = null, captures = [], webgl = null, terminating = false;
process.on('SIGTERM', () => { if (terminating) return; terminating = true; try { stage('controller-sigterm', { screenshotCount: captures.length }); } catch {} void cleanup().finally(() => process.exit(143)); });
try {
  if (!existsSync(path.join(DIST, 'index.html')) || !existsSync(path.join(DIST, 'build-manifest.json'))) throw new Error('Static bundle is missing');
  serverAddress = await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address())); });
  stage('loopback-server-listening', { port: serverAddress?.port ?? null, address: serverAddress?.address ?? null });
  if (!serverAddress || typeof serverAddress === 'string' || serverAddress.address !== '127.0.0.1') throw new Error('Fixture server did not bind loopback only');
  profile = await mkdtemp(path.join(os.tmpdir(), 'office-source-chart-v3-chrome-')); chromeLog = openSync(path.join(OUTPUT, 'chrome.log'), 'wx');
  const chromeArgs = ['--single-process','--in-process-gpu','--no-zygote','--renderer-process-limit=1','--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader','--disable-extensions','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'];
  stage('chrome-launch-before', { chromePath, flags: chromeArgs.filter(arg => arg.startsWith('--')), topology: runtime.chromeTopologyFlags });
  chrome = spawn(chromePath, chromeArgs, { stdio: ['ignore','ignore',chromeLog], env: { ...process.env } });
  stage('chrome-launch-after', { pid: chrome.pid ?? null });
  chrome.once('error', error => { failure = String(error); });
  stage('devtools-port-wait-before'); const port = await browserPort(); stage('devtools-port-ready', { port });
  stage('cdp-connect-before', { port }); await connectPage(port); stage('cdp-connect-after', { port });
  const pageUrl = `http://127.0.0.1:${serverAddress.port}/`; stage('navigation-before', { url: pageUrl });
  await cdpsend('Page.navigate', { url: pageUrl }); stage('navigation-after', { url: pageUrl });
  await waitFor(async () => (await evaluate('Boolean(window.__OFFICE_CHART_FIXTURE__)').catch(() => false)), 'viewer API');
  stage('viewer-api-ready'); stage('load-before');
  const initial = await evaluate('window.__OFFICE_CHART_FIXTURE__.load()', true);
  const loadStatus = await evaluate("document.getElementById('status')?.textContent ?? null");
  const loadSnapshot = await evaluate('window.__OFFICE_CHART_FIXTURE__.snapshot()');
  stage('load-after', { returned: initial, uiStatus: loadStatus, snapshot: loadSnapshot });
  if (typeof loadStatus === 'string' && loadStatus.startsWith('Fixture failed closed:')) throw new Error(`Fixture rejected during initial load: ${loadStatus}`);
  await waitFor(async () => (await evaluate('window.__OFFICE_CHART_FIXTURE__.snapshot()').catch(() => null))?.comparisonValid === true, 'matched actual body/chart guard');
  stage('comparison-ready', { body: 'man' });
  // `load()` is intentionally awaited even though its UI handler catches internal errors; the snapshot guard above fails closed.
  if (initial === false) throw new Error('Viewer load returned false');
  for (const body of ['man','woman']) {
    if (body !== 'man') {
      await evaluate(`window.__OFFICE_CHART_FIXTURE__.setBody('${body}')`, true);
      await waitFor(async () => { const value=await evaluate('window.__OFFICE_CHART_FIXTURE__.snapshot()').catch(()=>null); return value?.comparisonValid===true && value?.body===body; }, `${body} matched actor guard`);
      stage('body-ready', { body });
    }
    for (const yaw of [0,45,90]) {
      const focus = yaw === 0 ? 'full' : 'shoulder';
      for (const variant of ['source','chart']) captures.push(await capture(body,yaw,focus,variant));
    }
  }
  webgl = await evaluate(`(()=>{const c=document.getElementById('scene'),g=c.getContext('webgl2')||c.getContext('webgl'),e=g?.getExtension('WEBGL_debug_renderer_info');return g?{version:g.getParameter(g.VERSION),vendor:g.getParameter(e?e.UNMASKED_VENDOR_WEBGL:g.VENDOR),renderer:g.getParameter(e?e.UNMASKED_RENDERER_WEBGL:g.RENDERER),shadingLanguage:g.getParameter(g.SHADING_LANGUAGE_VERSION)}:null})()`);
  if (captures.length !== 12) throw new Error(`Expected exactly 12 matched PNGs, captured ${captures.length}`);
  if (!webgl?.renderer || !String(webgl.renderer).toLowerCase().includes('swiftshader')) throw new Error(`Expected actual SwiftShader backend, received ${JSON.stringify(webgl)}`);
  if (browserEvents.runtimeExceptions.length || browserEvents.consoleErrors.length || browserEvents.failedRequests.length || browserEvents.httpErrors.length) throw new Error('Browser reported runtime, console, network, or HTTP errors');
  if (shaderErrorsFor(captures)) throw new Error('Page snapshot reports a shader compilation error');
  finalStatus = 'captured';
} catch (error) { failure = error instanceof Error ? error.stack ?? error.message : String(error); try { stage('controller-error', { error: String(error) }); } catch {} }
finally { try { stage('cleanup-before', { finalStatus, screenshotCount: captures.length }); } catch {} await cleanup(); try { stage('cleanup-after', { finalStatus, screenshotCount: captures.length }); } catch {} }
const after = await verifySnapshot(expected).catch(error => ({ error: String(error) }));
const sourceUnchanged = !after.error && JSON.stringify(snapshot.sourceHashes) === JSON.stringify(after.sourceHashes);
const stageBreadcrumbs = existsSync(stagePath) ? readFileSync(stagePath, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) : [];
const report = { status: finalStatus, success: finalStatus === 'captured' && sourceUnchanged && captures.length === 12, failure, runtime, stageBreadcrumbCount: stageBreadcrumbs.length, sourceUnchanged, browser: { port: serverAddress?.port ?? null, webgl, shaderErrors: captures.flatMap(item => item.snapshot?.shaderErrors ?? []), events: browserEvents, screenshotCount: captures.length }, captures,
  limits: ['Remote Linux headless Chrome/ANGLE SwiftShader forced single-process diagnostic only; process topology is deliberately nonstandard.', 'Not representative of normal multiprocess Chrome memory/runtime, mobile GPU performance, battery, device memory, or visual acceptance.', 'Standard skinned normal deformation is unverified.', 'Both actors use the exact same production source mask and zero-ease source chart; the shader adapter changes position skinning only.'] };
writeFileSync(path.join(OUTPUT, 'review-results.json'), `${JSON.stringify(report,null,2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ status: report.status, success: report.success, failure: report.failure, screenshotCount: report.browser.screenshotCount, webgl, sourceUnchanged }, null, 2));
if (!report.success) process.exitCode = 1;
function shaderErrorsFor(items) { return items.some(item => !Array.isArray(item.snapshot?.shaderErrors) || item.snapshot.shaderErrors.length !== 0); }
