import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import { appendFileSync, closeSync, createReadStream, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp, readFile, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { assertOwnedResultDirectory } from './result-dir-contract-v3.mjs'
import { validatePackageSelection } from './package-selection-v3.mjs'
import { persistCaptureReceipt, waitForReadinessReceipt, waitForSceneSnapshot } from '../remote-control-v3.mjs'
import { capturesForScope, LIMITS, REVIEW_SCOPES, persistLifecycleProgress, validateCaptureSnapshot } from '../scope-plan-v3.mjs'

const ROOT = process.cwd()
const FIXTURE = path.join(ROOT, 'evidence/graphics-loop/environment-next-phase-v6')
const REVIEW = path.join(FIXTURE, 'remote-review-v3/recipe')
const PACKAGE_ROOT = path.resolve(process.env.PACKAGE_ROOT ?? path.join(REVIEW, 'package-input'))
const BUNDLE = path.join(PACKAGE_ROOT, 'static-v6')
const DIST = BUNDLE
const RESULT = process.env.RESULT_DIR
const EXPECTED_REVIEW_SHA = process.argv[2]
const SELECTED_PACKAGE_RUN_ID = '37899632982'
const SELECTED_PACKAGE_COMMIT = '03986c2a778e6e191bec905a493de251c45baa11'
const REVIEW_PINS = path.join(REVIEW, 'review-sources-v3.json')
const SOURCE_PINS = path.join(PACKAGE_ROOT, 'source-pins-v6.json')
const BUNDLE_MANIFEST = path.join(BUNDLE, 'build-manifest.json')
const FINAL_RECEIPT = path.join(PACKAGE_ROOT, 'finalization-v6-observed.json')
const FINALIZER_PINS = path.join(PACKAGE_ROOT, 'finalizer-pins-v6.json')
const COMPILE_RECORD = path.join(PACKAGE_ROOT, 'compile-v6-record.json')
const EXPECTED_PACKAGE_COMMIT = process.env.PACKAGE_COMMIT_SHA
const PACKAGE_RUN_ID = process.env.PACKAGE_RUN_ID
const PACKAGE_ARTIFACT = process.env.PACKAGE_ARTIFACT
const EXPECTED_REVIEW_COMMIT = process.env.REVIEW_COMMIT_SHA
const REVIEW_SCOPE = process.env.REVIEW_SCOPE
const PORT = 0
const PLACEHOLDER_BODY = Buffer.from('not found')

if (process.platform !== 'linux') throw new Error('Remote render review is Linux-only')
if (!RESULT || !path.isAbsolute(RESULT)) throw new Error('RESULT_DIR must be an absolute per-run output directory')
if (!/^[a-f0-9]{64}$/.test(EXPECTED_REVIEW_SHA ?? '')) throw new Error('Expected review-pins SHA-256 argument is required')
if (PACKAGE_RUN_ID !== SELECTED_PACKAGE_RUN_ID || EXPECTED_PACKAGE_COMMIT !== SELECTED_PACKAGE_COMMIT || PACKAGE_ARTIFACT !== `environment-whole-slice-v6-package-v2-${SELECTED_PACKAGE_RUN_ID}`) throw new Error('Selected package must be the independently successful v2 CPU run')
validatePackageSelection({ runId: PACKAGE_RUN_ID, commit: EXPECTED_PACKAGE_COMMIT, artifact: PACKAGE_ARTIFACT })
if (!Object.hasOwn(REVIEW_SCOPES, REVIEW_SCOPE ?? '')) throw new Error('REVIEW_SCOPE is not one of the sealed v6 scene-pair/lifecycle scopes')
assertOwnedResultDirectory(RESULT, process.env.SUPERVISOR_OWNER_TOKEN)
mkdirSync(RESULT, { recursive: true })

const stageLogPath = path.join(RESULT, 'stage-events.jsonl')
let stageSequence = 0
let lastObservedStage = 'controller-start'
let browserTerminating = false
let cleanupOnSignal = null
let stageChromePid = null
function stageEvent(name, fields = {}) {
  lastObservedStage = name
  const event = { sequence: ++stageSequence, at: new Date().toISOString(), elapsedMs: Number(process.hrtime.bigint() / 1000000n), stage: name, ...fields }
  try { appendFileSync(stageLogPath, `${JSON.stringify(event)}\n`, { encoding: 'utf8' }) } catch {}
  console.log(JSON.stringify({ stage: name, ...fields }))
}
stageEvent('controller-start', { pid: process.pid, packageRun: PACKAGE_RUN_ID, node: process.version })
process.on('SIGTERM', () => {
  if (browserTerminating) return
  browserTerminating = true
  stageEvent('signal-received', { signal: 'SIGTERM', lastStage: lastObservedStage, chromePid: stageChromePid })
  if (cleanupOnSignal) void cleanupOnSignal().finally(() => process.exit(143))
  else process.exit(143)
})

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
async function hashFile(file) {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(file)) h.update(chunk)
  return h.digest('hex')
}
function inside(root, relative) {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).some(part => part === '..' || part === '')) throw new Error(`Unsafe manifest path: ${relative}`)
  const target = path.resolve(root, relative), rel = path.relative(path.resolve(root), target)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Path escaped root: ${relative}`)
  return target
}
async function walk(dir, relative = '') {
  const { opendir } = await import('node:fs/promises')
  const result = []
  for await (const entry of await opendir(path.join(dir, relative))) {
    const next = path.posix.join(relative.split(path.sep).join('/'), entry.name)
    if (entry.isDirectory()) result.push(...await walk(dir, next))
    else if (entry.isFile()) result.push(path.join(dir, ...next.split('/')))
    else throw new Error(`Non-regular output path: ${next}`)
  }
  return result
}

stageEvent('recipe-pin-read-start')
const pinsBytes = await readFile(REVIEW_PINS)
if (sha(pinsBytes) !== EXPECTED_REVIEW_SHA) throw new Error('Review source pin manifest digest mismatch')
const reviewPins = JSON.parse(pinsBytes)
if (reviewPins.schema !== 'environment-next-phase-v6-remote-review-source-pins/1') throw new Error('Unexpected render-review v2 source pin schema')
async function verifyReviewSources() {
  for (const item of reviewPins.files) if (await hashFile(inside(ROOT, item.path)) !== item.sha256) throw new Error(`Render review source changed: ${item.path}`)
  if (await hashFile(REVIEW_PINS) !== EXPECTED_REVIEW_SHA) throw new Error('Review source pin manifest changed')
}
stageEvent('recipe-pin-verified', { pinnedFiles: reviewPins.files.length })
await verifyReviewSources()
stageEvent('recipe-sources-verified')

stageEvent('package-receipt-read-start')
const sourcePinsBytes = await readFile(SOURCE_PINS)
const sourcePins = JSON.parse(sourcePinsBytes)
const bundleManifestBytes = await readFile(BUNDLE_MANIFEST)
const bundleManifest = JSON.parse(bundleManifestBytes)
const finalReceipt = JSON.parse(await readFile(FINAL_RECEIPT, 'utf8'))
const finalizerPinsBytes = await readFile(FINALIZER_PINS)
const finalizerPins = JSON.parse(finalizerPinsBytes)
const compileBytes = await readFile(COMPILE_RECORD)
const compileRecord = JSON.parse(compileBytes)
const sourcePinsSha = sha(sourcePinsBytes)
if (sourcePins.schema !== 'environment-next-phase-v6-source-pins/3' || sourcePins.status !== 'PREBUILD_SEALED') throw new Error('Package source pins are not sealed for v6')
if (bundleManifest.schema !== 'environment-next-phase-v6-diagnostic-manifest/3' || bundleManifest.status !== 'BUILT_DIAGNOSTIC_NOT_PRODUCTION_CERTIFICATE') throw new Error('Bundle is not a completed v6 diagnostic package')
if (compileRecord.schema !== 'environment-next-phase-v6-compiled-record/2' || compileRecord.status !== 'COMPILED_DIAGNOSTIC_AWAITING_SINGLE_PUBLIC_COPY') throw new Error('Split-v6 compiler record is invalid')
if (finalizerPins.schema !== 'environment-next-phase-v6-finalizer-pins/3' || finalizerPins.status !== 'PRE_FINALIZATION_SEALED') throw new Error('Split-v6 finalizer pin record is invalid')
if (bundleManifest.sourcePinsSha256 !== sourcePinsSha) throw new Error('Source pin digest does not match package manifest')
if (compileRecord.sourcePinsSha256 !== sourcePinsSha || bundleManifest.compileRecordSha256 !== sha(compileBytes)) throw new Error('Split-v6 compile record and manifest do not match the source pins')
if (sourcePins.gitCommit !== EXPECTED_PACKAGE_COMMIT) throw new Error('Downloaded package source pins do not match the selected package commit')
if (!/^[a-f0-9]{40}$/.test(EXPECTED_REVIEW_COMMIT ?? '')) throw new Error('Render-review recipe checkout commit is missing')
const checkedOutCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', timeout: 3000 }).trim()
if (checkedOutCommit !== EXPECTED_REVIEW_COMMIT) throw new Error('Checkout does not match render-review recipe commit')
if (sha(bundleManifestBytes) !== finalReceipt.manifestSha256 || sha(finalizerPinsBytes) !== finalReceipt.finalizerPinsSha256 || sha(compileBytes) !== finalReceipt.compileRecordSha256) throw new Error('Finalization receipts do not match package manifests')
if (finalReceipt.sourcePinsSha256 !== sourcePinsSha) throw new Error('Finalization receipt does not match package sources')
if (finalReceipt.status !== 'FINALIZED_DIAGNOSTIC_READY_FOR_PARENT_REVIEW') throw new Error('Package finalization was not successful')
if (compileRecord.importClosureVerified !== true || bundleManifest.importClosureVerified !== true || !Number.isInteger(bundleManifest.importReferenceCount)) throw new Error('Compiled JavaScript closure receipt is missing')
const sourceVerification = []
for (const name of ['source-precompile-v6.json', 'source-postcompile-v6.json']) {
  const receipt = JSON.parse(await readFile(path.join(PACKAGE_ROOT, name), 'utf8'))
  if (receipt.status !== 'VERIFIED' || receipt.sourcePinsSha256 !== sourcePinsSha || receipt.fileCount !== sourcePins.files.length) throw new Error(`Full source verification receipt invalid: ${name}`)
  sourceVerification.push({ file: name, phase: receipt.phase, fileCount: receipt.fileCount, bytesRead: receipt.bytesRead })
}
stageEvent('package-receipts-validated', { sourceFileCount: sourcePins.files.length, cityMaps: sourcePins.cityMapSourceCount })
const phaseRecords = {}
for (const [name, status] of [['vendor-v6-record.json', 'VENDOR_COMPILED'], ['addons-v6-record.json', 'ADDONS_COMPILED'], ['app-v6-record.json', 'APPLICATION_COMPILED']]) {
  const record = JSON.parse(await readFile(path.join(PACKAGE_ROOT, name), 'utf8'))
  if (record.status !== status || record.sourcePinsSha256 !== sourcePinsSha) throw new Error(`Split compiler phase receipt invalid: ${name}`)
  phaseRecords[name] = record
}
const finalizerPinPaths = new Map(finalizerPins.files.map(item => [item.path, item.sha256]))
if (finalizerPinPaths.get('evidence/graphics-loop/environment-next-phase-v6/source-pins-v6.json') !== sourcePinsSha) throw new Error('Finalizer pin list does not seal the v6 source manifest')
for (const item of compileRecord.outputs) {
  const pathInPins = `evidence/graphics-loop/environment-next-phase-v6/static-v6/${item.path}`
  if (finalizerPinPaths.get(pathInPins) !== item.sha256) throw new Error(`Compiled output missing from finalizer pins: ${item.path}`)
}
const sourceHashByPath = new Map(sourcePins.files.map(item => [item.path, item.sha256]))
for (const item of compileRecord.consumedInputs) if (sourceHashByPath.get(item.path) !== item.sha256) throw new Error(`Compile receipt consumed input differs from source seal: ${item.path}`)
const compiledPhaseOutputs = [
  ...phaseRecords['vendor-v6-record.json'].inputs.map(item => item.output),
  ...phaseRecords['addons-v6-record.json'].entries.map(item => item.output),
  ...phaseRecords['app-v6-record.json'].outputs,
]
if (compiledPhaseOutputs.length !== compileRecord.outputs.length) throw new Error('Phase output inventory differs from combined v6 compile receipt')
for (const item of compiledPhaseOutputs) {
  const merged = compileRecord.outputs.find(output => output.path === item.path)
  if (!merged || merged.sha256 !== item.sha256 || merged.bytes !== item.bytes) throw new Error(`Phase output receipt mismatch: ${item.path}`)
}
// Revalidate all files at the remote-render boundary, streaming hashes rather than loading assets.
stageEvent('package-source-verification-start', { total: sourcePins.files.length })
for (let index = 0; index < sourcePins.files.length; index++) {
  const item = sourcePins.files[index]
  if (await hashFile(inside(ROOT, item.path)) !== item.sha256) throw new Error(`Pinned package input changed: ${item.path}`)
  if (index % 512 === 0) stageEvent('package-source-verification-progress', { checked: index, total: sourcePins.files.length })
}
stageEvent('package-source-verification-complete', { total: sourcePins.files.length })
const outputs = new Map()
for (const item of bundleManifest.outputs) {
  if (!item || typeof item.path !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error('Malformed package output entry')
  if (outputs.has(item.path)) throw new Error(`Duplicate output route: ${item.path}`)
  outputs.set(item.path, item)
}
const compiledByPath = new Map(compileRecord.outputs.map(item => [item.path, item]))
const finalizedCompiled = bundleManifest.outputs.filter(item => item.kind !== 'copied-public')
if (compiledByPath.size !== finalizedCompiled.length) throw new Error('Final manifest compiled-output set differs from v6 compile receipt')
for (const item of finalizedCompiled) {
  const compiled = compiledByPath.get(item.path)
  if (!compiled || compiled.sha256 !== item.sha256 || compiled.bytes !== item.bytes) throw new Error(`Final manifest changed compiled output: ${item.path}`)
}
const publicPins = new Map(sourcePins.files.filter(item => item.path.startsWith('public/')).map(item => [item.path, item.sha256]))
if (bundleManifest.publicFileCount !== publicPins.size || bundleManifest.publicFiles?.length !== publicPins.size) throw new Error('Final public file inventory differs from the complete source pin set')
for (const item of bundleManifest.publicFiles) {
  if (!publicPins.has(item.source) || publicPins.get(item.source) !== item.sha256 || item.output !== item.source.slice('public/'.length)) throw new Error(`Public output/source pin mismatch: ${item.source}`)
  const output = outputs.get(item.output)
  if (!output || output.sha256 !== item.sha256 || output.bytes !== item.bytes || output.kind !== 'copied-public') throw new Error(`Copied public route not present in output manifest: ${item.output}`)
}
const actualFiles = await walk(DIST)
const actualPaths = new Set(actualFiles.filter(file => !file.endsWith(`${path.sep}build-manifest.json`)).map(file => path.relative(DIST, file).split(path.sep).join('/')))
if (actualPaths.size !== outputs.size || [...outputs.keys()].some(route => !actualPaths.has(route))) throw new Error('Static host file tree differs from its pinned output manifest')
let verifiedOutputCount = 0
stageEvent('package-output-verification-start', { total: outputs.size })
for (const [route, item] of outputs) {
  if (await hashFile(inside(DIST, route)) !== item.sha256) throw new Error(`Static host output hash mismatch: ${route}`)
  verifiedOutputCount++
  if (verifiedOutputCount % 512 === 0) stageEvent('package-output-verification-progress', { checked: verifiedOutputCount, total: outputs.size })
}
if (!outputs.has('index.html') || !outputs.has('app/viewer.js')) throw new Error('Actual fixture entrypoint is missing')
if (outputs.get('vendor/three.core.js') == null || outputs.get('vendor/three.module.js') == null) throw new Error('Three runtime siblings are missing')
if (!bundleManifest.importMap?.three || !outputs.has(bundleManifest.importMap.three.replace(/^\.\//, ''))) throw new Error('Shared Three core import-map route is missing')
if (bundleManifest.cityMapSourceCount !== 40 || bundleManifest.cityMapChunkCount !== 40) throw new Error('Full city map chunk graph is absent')
await verifyReviewSources()
stageEvent('package-validation-complete', { verifiedSourceFiles: sourcePins.files.length, verifiedOutputFiles: verifiedOutputCount,
  publicFileCount: bundleManifest.publicFileCount, outputRawBytes: bundleManifest.outputRawBytes, cityMapChunks: bundleManifest.cityMapChunkCount })

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json'], ['.txt', 'text/plain; charset=utf-8'], ['.glb', 'model/gltf-binary'],
  ['.bin', 'application/octet-stream'], ['.wasm', 'application/wasm'], ['.png', 'image/png'], ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'], ['.webp', 'image/webp'], ['.avif', 'image/avif'], ['.svg', 'image/svg+xml'],
])
let requestCount = 0
const httpErrors = []
const server = createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method ?? '')) { res.writeHead(405).end(); return }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/favicon.ico') { res.writeHead(204).end(); return }
    const raw = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
    const route = raw.replace(/^\//, '')
    const item = outputs.get(route)
    if (!item) { httpErrors.push({ route, status: 404 }); res.writeHead(404, { 'cache-control': 'no-store' }).end(PLACEHOLDER_BODY); return }
    const file = inside(DIST, route)
    const stat = await (await import('node:fs/promises')).stat(file)
    if (!stat.isFile() || stat.size !== item.bytes) throw new Error(`Route size mismatch: ${route}`)
    res.writeHead(200, { 'content-type': item.mime || MIME.get(path.extname(file).toLowerCase()) || 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-length': stat.size })
    if (req.method === 'HEAD') res.end()
    else {
      const stream = createReadStream(file)
      stream.on('error', error => { httpErrors.push({ route, error: String(error) }); res.destroy(error) })
      stream.pipe(res)
    }
    requestCount++
  } catch (error) {
    httpErrors.push({ route: req.url, error: error instanceof Error ? error.message : String(error) })
    if (!res.headersSent) res.writeHead(500, { 'cache-control': 'no-store' }).end('fixture server error')
    else res.destroy()
  }
})

let chrome = null
let ws = null
let profile = null
let chromeLog = null
let serverAddress = null
let cleanupPromise = null
const pending = new Map()
const browserEvents = { runtimeExceptions: [], consoleErrors: [], failedRequests: [], httpErrors: [] }
let nextId = 0
const captures = []
const transitions = []
const lifecycle = {}
let webgl = null
let finalStatus = 'failed'
let failure = null
let sourceUnchanged = true
const runtime = { node: process.version, platform: process.platform, arch: os.arch(), kernel: os.release(), chromeLauncherPath: null, chromeLauncherSha256: null, chromePath: null, chromeVersion: null, chromeBinaryVersion: null, chromeSha256: null,
  rendererMode: 'remote Linux headless Chrome / ANGLE SwiftShader; screenshot/render diagnostics only, not phone or GPU performance acceptance',
  packageSourcePinsSha256: sourcePinsSha, packageManifestSha256: sha(bundleManifestBytes), reviewPinsSha256: EXPECTED_REVIEW_SHA, verifiedSourceFiles: sourcePins.files.length,
  verifiedOutputFiles: verifiedOutputCount, outputRawBytes: bundleManifest.outputRawBytes, cityMapSources: bundleManifest.cityMapSourceCount, cityMapChunks: bundleManifest.cityMapChunkCount }

function cdpsend(method, params = {}) {
  const id = ++nextId
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 7000)
    pending.set(id, { resolve, reject, timer })
    ws.send(JSON.stringify({ id, method, params }))
  })
}
function eventPayload(message) {
  if (message.method === 'Runtime.exceptionThrown') browserEvents.runtimeExceptions.push(message.params.exceptionDetails)
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') browserEvents.consoleErrors.push(message.params.args?.map(arg => arg.value ?? arg.description ?? '').join(' '))
  if (message.method === 'Network.loadingFailed') browserEvents.failedRequests.push({ requestId: message.params.requestId, errorText: message.params.errorText, canceled: message.params.canceled })
  if (message.method === 'Network.responseReceived' && message.params.response.status >= 400) browserEvents.httpErrors.push({ url: message.params.response.url, status: message.params.response.status })
}
function onSocketData(data) {
  let message
  try { message = JSON.parse(data.toString()) } catch { return }
  if (message.id) {
    const item = pending.get(message.id)
    if (!item) return
    clearTimeout(item.timer); pending.delete(message.id)
    if (message.error) item.reject(new Error(`${message.error.message}: ${JSON.stringify(message.error.data ?? null)}`))
    else item.resolve(message.result)
  } else eventPayload(message)
}
async function evaluate(expression, awaitPromise = false) {
  const result = await cdpsend('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: true })
  if (result.exceptionDetails) throw new Error(`Page evaluation failed: ${result.exceptionDetails.text}`)
  if (result.result?.subtype === 'error') throw new Error(result.result.description ?? 'Page evaluation returned an error')
  return result.result?.value
}
async function waitFor(predicate, description, timeoutMs = 10000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) { if (await predicate()) return true; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw new Error(`Timed out waiting for ${description}`)
}
async function browserPort() {
  const active = path.join(profile, 'DevToolsActivePort')
  await waitFor(() => existsSync(active), 'Chrome DevToolsActivePort', 8000)
  const lines = readFileSync(active, 'utf8').trim().split(/\r?\n/), port = Number(lines[0])
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid Chrome DevTools port')
  return port
}
async function connectPage(port) {
  let targets
  await waitFor(async () => {
    try { const response = await fetch(`http://127.0.0.1:${port}/json/list`); targets = await response.json(); return Array.isArray(targets) && targets.some(target => target.type === 'page' && target.webSocketDebuggerUrl) }
    catch { return false }
  }, 'Chrome page target', 8000)
  const target = targets.find(item => item.type === 'page' && item.webSocketDebuggerUrl)
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
  ws.on('message', onSocketData)
  await cdpsend('Page.enable'); await cdpsend('Runtime.enable'); await cdpsend('Log.enable'); await cdpsend('Network.enable')
  await cdpsend('Page.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
}
async function setSelect(selector, value) {
  return evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`)
}
async function currentSnapshot() {
  return evaluate(`window.__graphicsReviewV6?.snapshot?.() ?? null`)
}
async function waitReady(timeoutMs = 15000) {
  await waitFor(async () => await evaluate(`document.querySelector('#wait-ready')?.disabled === false`).catch(() => false), 'readiness control availability', 2500)
  const initial = await currentSnapshot()
  const priorIds = initial?.controlState?.readinessWaitReceipts?.map(item => item.id).filter(Number.isInteger) ?? []
  const afterId = priorIds.length ? Math.max(...priorIds) : 0
  const result = await waitForReadinessReceipt(currentSnapshot, async () => evaluate(`(()=>{const b=document.querySelector('#wait-ready');if(!b||b.disabled)return null;b.click();return window.__graphicsReviewV6?.snapshot?.()?.controlState?.activeReadinessWaitId??null})()`),
    { afterId, timeoutMs, pollMs: 100 })
  return result
}
function summarizeResource(resource) {
  if (!resource || typeof resource !== 'object') return { status: 'unsupported' }
  return { status: resource.status, retainedEntries: resource.retainedEntries, byteSizeSupport: resource.byteSizeSupport,
    entriesWithBytes: Array.isArray(resource.resources) ? resource.resources.filter(item => item.transferSize || item.encodedBodySize || item.decodedBodySize).length : 0,
    totalTransferBytes: Array.isArray(resource.resources) ? resource.resources.reduce((sum, item) => sum + (item.transferSize || 0), 0) : null,
    totalEncodedBytes: Array.isArray(resource.resources) ? resource.resources.reduce((sum, item) => sum + (item.encodedBodySize || 0), 0) : null }
}
async function snapshotAndCapture(label, expectedPlace, expectedTime, readinessTimeoutMs = 15000) {
  stageEvent('scene-readiness-wait-start', { label, place: expectedPlace, time: expectedTime })
  let waited
  try { waited = await waitReady(readinessTimeoutMs) }
  catch (error) { waited = { waitId: null, receipt: null, timedOut: true, error: String(error) } }
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))', true)
  const snapshot = await currentSnapshot()
  const identityChecks = { place: snapshot?.fixture?.place === expectedPlace, time: snapshot?.fixture?.time === expectedTime,
    variant: snapshot?.fixture?.variant === 'candidate', canvasPresent: Boolean(snapshot?.canvas?.drawingBuffer?.width && snapshot?.canvas?.drawingBuffer?.height),
    sceneReady: snapshot?.capture?.validForSceneReview === true,
    canonicalHomeBody: expectedPlace !== 'home' || snapshot?.capture?.validForCanonicalVisualReview === true }
  const shot = await cdpsend('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  const png = Buffer.from(shot.data, 'base64')
  const file = `${label}.png`
  writeFileSync(path.join(RESULT, file), png, { flag: 'wx' })
  const validation = validateCaptureSnapshot(snapshot, { place: expectedPlace, time: expectedTime })
  const durable = await persistCaptureReceipt(RESULT, { sequence: captures.length + 1, label, imageFile: file, snapshot,
    expected: { place: expectedPlace, time: expectedTime }, wait: waited })
  const row = { label, file, sha256: sha(png), bytes: png.byteLength, expectedPlace, expectedTime, identityChecks,
    readiness: snapshot?.readiness ?? null, readinessWait: waited, capture: snapshot?.capture ?? null, fixture: snapshot?.fixture ?? null,
    canvas: snapshot?.canvas ?? null, host: snapshot?.host ?? null, resources: summarizeResource(snapshot?.network), renderCount: snapshot?.host?.renderCount ?? null,
    diagnosticsValid: validation.valid && Object.values(identityChecks).every(Boolean), persistedReceipt: durable.sequence,
    browserEventCounts: { runtimeExceptions: browserEvents.runtimeExceptions.length, consoleErrors: browserEvents.consoleErrors.length, failedRequests: browserEvents.failedRequests.length, httpErrors: browserEvents.httpErrors.length } }
  captures.push(row)
  if (!row.diagnosticsValid) finalStatus = 'captured-with-review-gaps'
  stageEvent('scene-capture-complete', { label, place: expectedPlace, time: expectedTime, diagnosticsValid: row.diagnosticsValid,
    renderCount: row.renderCount, screenshotBytes: png.byteLength })
  console.log(JSON.stringify({ stage: 'scene-capture', label, diagnosticsValid: row.diagnosticsValid, renderCount: row.renderCount, bytes: png.byteLength }))
  return row
}
async function savePageScreenshot(label) {
  const shot = await cdpsend('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  const bytes = Buffer.from(shot.data, 'base64')
  const file = `${label}.png`
  writeFileSync(path.join(RESULT, file), bytes, { flag: 'wx' })
  return { file, sha256: sha(bytes), bytes: bytes.byteLength }
}
function persistedCaptureRows() {
  const file = path.join(RESULT, 'captures-progress.jsonl')
  if (!existsSync(file)) return []
  const text = readFileSync(file, 'utf8')
  const complete = text.endsWith('\n') ? text : text.slice(0, text.lastIndexOf('\n') + 1)
  return complete.split('\n').filter(Boolean).map(line => JSON.parse(line))
}
function persistLifecycleReceipt(record) {
  const fd = openSync(path.join(RESULT, 'lifecycle-progress.jsonl'), 'a', 0o600)
  try { appendFileSync(fd, `${JSON.stringify(record)}\n`); fsyncSync(fd) } finally { closeSync(fd) }
  return record
}
async function captureLifecycle(label, snapshot, details = {}) {
  const image = await savePageScreenshot(`${label}.png`)
  return persistLifecycleReceipt({ label, at: new Date().toISOString(), image, snapshot, details })
}
async function selectScene(place, time, timeoutMs = 8000) {
  stageEvent('scene-transition-request', { place, time })
  const before = await currentSnapshot()
  await evaluate(`window.__graphicsReviewV6?.selectScene(${JSON.stringify(place)},${JSON.stringify(time)})`)
  const transitioned = await waitForSceneSnapshot(currentSnapshot, { place, time }, { timeoutMs, pollMs: 100 })
  const row = { place, time, requestedAt: new Date().toISOString(), priorHostDiagnostics: before?.host ?? null,
    settled: transitioned.settled, observedFixture: transitioned.snapshot?.fixture ?? null, observedHostLocation: transitioned.snapshot?.host?.location ?? null,
    elapsedMs: transitioned.elapsedMs }
  transitions.push(row)
  stageEvent('scene-transition-status', row)
  if (!transitioned.settled) throw new Error(`Structured scene transition did not settle: ${place}/${time}`)
}

async function cleanup() {
  if (cleanupPromise) return cleanupPromise
  stageEvent('cleanup-start', { chromePid: stageChromePid, serverListening: server.listening })
  cleanupPromise = (async () => {
    if (ws && ws.readyState === WebSocket.OPEN) { try { ws.close() } catch {} }
    if (chrome && chrome.exitCode === null) {
      chrome.kill('SIGTERM')
      await Promise.race([new Promise(resolve => chrome.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 1200))])
      if (chrome.exitCode === null) chrome.kill('SIGKILL')
    }
    await new Promise(resolve => server.close(() => resolve()))
    if (chromeLog !== null) closeSync(chromeLog)
    if (profile) rmSync(profile, { recursive: true, force: true })
    stageEvent('cleanup-complete', { chromeExitCode: chrome?.exitCode ?? null, serverListening: server.listening })
  })()
  return cleanupPromise
}
cleanupOnSignal = cleanup

try {
  stageEvent('chrome-identity-start')
  const chromeLauncherPath = await realpath(process.env.CHROME_BIN ?? '')
  const chromeLauncherVersion = execFileSync(chromeLauncherPath, ['--version'], { encoding: 'utf8', timeout: 3000 }).trim()
  const chromeLauncherSha256 = await hashFile(chromeLauncherPath)
  const siblingBinary = path.join(path.dirname(chromeLauncherPath), 'chrome')
  let siblingHeader = null
  if (existsSync(siblingBinary)) {
    const siblingFd = openSync(siblingBinary, 'r')
    siblingHeader = Buffer.alloc(4)
    readSync(siblingFd, siblingHeader, 0, 4, 0)
    closeSync(siblingFd)
  }
  const isElf = (header) => header?.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ?? false
  const chromePath = isElf(siblingHeader) ? await realpath(siblingBinary) : chromeLauncherPath
  const binaryFd = openSync(chromePath, 'r')
  const binaryHeader = Buffer.alloc(4)
  readSync(binaryFd, binaryHeader, 0, 4, 0)
  closeSync(binaryFd)
  if (!isElf(binaryHeader)) throw new Error('Resolved Chrome executable is not an ELF binary')
  const chromeBinaryVersion = execFileSync(chromePath, ['--version'], { encoding: 'utf8', timeout: 3000 }).trim()
  runtime.chromeLauncherPath = chromeLauncherPath
  runtime.chromeLauncherSha256 = chromeLauncherSha256
  runtime.chromePath = chromePath
  runtime.chromeVersion = chromeLauncherVersion
  runtime.chromeBinaryVersion = chromeBinaryVersion
  runtime.chromeSha256 = await hashFile(chromePath)
  runtime.chromeProcessFlags = ['--single-process', '--in-process-gpu', '--no-zygote', '--renderer-process-limit=1']
  runtime.chromeProcessTopology = 'Remote SwiftShader diagnostic topology; screenshots/counters only, not normal multiprocess or mobile performance.'
  stageEvent('chrome-identity-ready', { chromeVersion: runtime.chromeVersion, chromeBinaryVersion: runtime.chromeBinaryVersion, chromePath: runtime.chromePath })
  stageEvent('loopback-server-start')
  serverAddress = await new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', () => resolve(server.address())) })
  if (!serverAddress || typeof serverAddress === 'string' || serverAddress.address !== '127.0.0.1') throw new Error('Fixture routes did not bind to loopback')
  stageEvent('loopback-server-ready', { address: serverAddress.address, port: serverAddress.port })
  profile = await mkdtemp(path.join(os.tmpdir(), 'environment-v6-render-chrome-'))
  chromeLog = openSync(path.join(RESULT, 'chrome.log'), 'wx')
  const chromeArgs = ['--headless=new', '--single-process', '--in-process-gpu', '--no-zygote', '--renderer-process-limit=1', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--disable-extensions', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank']
  stageEvent('chrome-launch-start', { chromePath: runtime.chromePath, flags: runtime.chromeProcessFlags })
  chrome = spawn(chromePath, chromeArgs, { stdio: ['ignore', 'ignore', chromeLog], env: { ...process.env } })
  stageChromePid = chrome.pid ?? null
  stageEvent('chrome-process-started', { chromePid: stageChromePid })
  chrome.once('error', error => { failure = String(error) })
  stageEvent('devtools-port-wait')
  const port = await browserPort()
  stageEvent('devtools-port-ready', { port })
  await connectPage(port)
  stageEvent('cdp-page-connected')
  stageEvent('viewer-navigation-start', { url: `http://127.0.0.1:${serverAddress.port}/` })
  await cdpsend('Page.navigate', { url: `http://127.0.0.1:${serverAddress.port}/` })
  stageEvent('viewer-navigation-sent')
  await waitFor(async () => await evaluate(`Boolean(document.querySelector('#wait-ready') && document.querySelector('#place'))`).catch(() => false), 'actual-host viewer controls')
  stageEvent('viewer-controls-ready')
  await waitFor(async () => await evaluate(`(document.querySelector('#status')?.textContent ?? '').includes('Host mounted') || (document.querySelector('#status')?.textContent ?? '').startsWith('Fixture failed:')`).catch(() => false), 'actual host mount status', 15000)
  const mountStatus = await evaluate(`document.querySelector('#status')?.textContent ?? ''`)
  stageEvent('viewer-host-status', { status: mountStatus })
  if (mountStatus.startsWith('Fixture failed:')) throw new Error(`Actual fixture mount failed: ${mountStatus}`)

  await evaluate(`(()=>{const c=document.querySelector('#host canvas'),g=c?.getContext('webgl2')||c?.getContext('webgl'),e=g?.getExtension('WEBGL_debug_renderer_info');return g?{version:g.getParameter(g.VERSION),vendor:g.getParameter(e?e.UNMASKED_VENDOR_WEBGL:g.VENDOR),renderer:g.getParameter(e?e.UNMASKED_RENDERER_WEBGL:g.RENDERER),shadingLanguage:g.getParameter(g.SHADING_LANGUAGE_VERSION)}:null})()`).then(value => { webgl = value })
  if (!webgl) throw new Error('No WebGL context was observed on the actual host canvas')
  stageEvent('webgl-context-ready', { renderer: webgl.renderer, version: webgl.version })

  if (REVIEW_SCOPES[REVIEW_SCOPE].kind === 'scene-pair') {
    for (const target of capturesForScope(REVIEW_SCOPE)) {
      await selectScene(target.place, target.time, 8000)
      const row = await snapshotAndCapture(`candidate-${target.place}-${target.time}`, target.place, target.time, captures.length === 0 ? 8000 : 3500)
      if (!row.diagnosticsValid) { failure = `Fail-closed scene review: ${target.place}/${target.time} did not satisfy stable readiness/canonical guards`; break }
    }
  } else {
    const anchor = REVIEW_SCOPES[REVIEW_SCOPE].anchor
    await selectScene(anchor.place, anchor.time, 8000)
    const ready = await waitReady(8000)
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))', true)
    let state = await currentSnapshot()
    const anchorValid = validateCaptureSnapshot(state, anchor).valid && state?.capture?.validForCanonicalVisualReview === true
    lifecycle.anchor = await captureLifecycle('lifecycle-anchor', state, { readinessWait: ready, canonicalAnchorValid: anchorValid })
    if (anchorValid) {
      const before = state
      await evaluate(`document.querySelector('[data-walk="0,-0.7"]')?.click()`)
      await new Promise(resolve => setTimeout(resolve, 800))
      await evaluate(`document.querySelector('#snapshot')?.click()`)
      state = await currentSnapshot()
      const request = state?.controlState?.lastWalkRequest ?? null
      const observation = state?.controlState?.lastWalkObservation ?? null
      const positionChanged = Boolean(before?.host?.avatar && state?.host?.avatar && (before.host.avatar.x !== state.host.avatar.x || before.host.avatar.z !== state.host.avatar.z))
      const walkEvidenceValid = Boolean(Number.isInteger(request?.id) && request.id > 0 && typeof request.accepted === 'boolean'
        && request.context?.place === anchor.place && observation?.requestId === request.id
        && Number.isFinite(observation.x) && Number.isFinite(observation.z) && typeof observation.blocked === 'boolean'
        && typeof observation.positionChanged === 'boolean')
      lifecycle.walk = await captureLifecycle('lifecycle-walk-request', state, { request, observation, positionChanged, walkEvidenceValid })

      const generation = state?.controlState?.hostGeneration ?? 0
      await evaluate(`document.querySelector('#rebuild')?.click()`)
      await waitFor(async () => {
        const current = await currentSnapshot().catch(() => null)
        return Boolean(current && current.controlState?.hostGeneration > generation && !current.controlState?.mounting && !current.controlState?.disposed && current.host?.location === anchor.place)
      }, 'structured dispose/rebuild restoration', 8000)
      const rebuiltWait = await waitReady(8000)
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))', true)
      state = await currentSnapshot()
      const rebuiltValid = validateCaptureSnapshot(state, anchor).valid && state?.capture?.validForCanonicalVisualReview === true
      lifecycle.rebuild = await captureLifecycle('lifecycle-rebuilt-anchor', state, { readinessWait: rebuiltWait, canonicalAnchorValid: rebuiltValid, generationBefore: generation })

      await evaluate(`document.querySelector('#dispose')?.click()`)
      await waitFor(async () => {
        const current = await currentSnapshot().catch(() => null)
        return Boolean(current?.controlState?.disposed && current.controlState?.mounting === false && current.canvas == null)
      }, 'structured permanent dispose', 4000)
      state = await currentSnapshot()
      lifecycle.permanentDispose = await captureLifecycle('lifecycle-permanent-dispose', state, { disposed: state?.controlState?.disposed === true, canvasPresent: state?.canvas?.present ?? null })
      lifecycle.permanentDisposeVerified = state?.controlState?.disposed === true && state?.canvas == null
    } else {
      lifecycle.skipped = 'Canonical anchor readiness failed; lifecycle actions were not exercised.'
      persistLifecycleReceipt({ label: 'lifecycle-actions-skipped', at: new Date().toISOString(), reason: lifecycle.skipped, snapshot: state })
    }
    lifecycle.valid = Boolean(anchorValid && lifecycle.walk?.details?.walkEvidenceValid && lifecycle.rebuild?.details?.canonicalAnchorValid && lifecycle.permanentDisposeVerified)
  }

  const durableCaptureCount = persistedCaptureRows().length
  const pairValid = REVIEW_SCOPES[REVIEW_SCOPE].kind === 'scene-pair' && durableCaptureCount === 4 && captures.length === 4 && captures.every(row => row.diagnosticsValid)
  const lifecycleValid = REVIEW_SCOPES[REVIEW_SCOPE].kind === 'lifecycle-only' && lifecycle.valid === true
  finalStatus = pairValid || lifecycleValid ? 'captured-valid-scope' : 'captured-with-review-gaps'
} catch (error) {
  failure = error instanceof Error ? error.stack ?? error.message : String(error)
  stageEvent('controller-error', { lastStage: lastObservedStage, error: failure })
} finally {
  await cleanup()
}

await verifyReviewSources().catch(error => { sourceUnchanged = false; failure = [failure, `Post-run source verification failed: ${String(error)}`].filter(Boolean).join('\n'); finalStatus = 'source-changed' })
const report = {
  schema: 'environment-next-phase-v6-remote-render-review/6', status: finalStatus,
  success: finalStatus === 'captured-valid-scope' && !failure && !httpErrors.length && !browserEvents.runtimeExceptions.length && !browserEvents.consoleErrors.length && !browserEvents.failedRequests.length && !browserEvents.httpErrors.length,
  failure, runtime, sourceUnchanged, server: { port: serverAddress?.port ?? null, loopbackOnly: true, requests: requestCount, errors: httpErrors },
  browser: { webgl, canvasPage: { width: 1280, height: 900, deviceScaleFactor: 1 }, events: browserEvents },
  captures, durableCaptureCount: persistedCaptureRows().length, transitions, lifecycle, reviewScope: REVIEW_SCOPE,
  limits: ['Remote Linux Chrome/ANGLE SwiftShader scene review only; not physical phone/GPU timing or visual acceptance.', 'Synthetic deterministic Lagos fixture, not a full application onboarding journey or live server session.', 'Resource Timing and renderer counters are diagnostics; no packet trace, real GPU time, battery, or thermal claim.']
}
writeFileSync(path.join(RESULT, 'render-review-results.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
stageEvent('controller-final-report', { status: report.status, success: report.success, captureCount: report.durableCaptureCount, reviewScope: REVIEW_SCOPE, failure: failure ?? null })
console.log(JSON.stringify({ status: report.status, success: report.success, failure: report.failure, captures: report.durableCaptureCount, reviewScope: REVIEW_SCOPE, sourceUnchanged: report.sourceUnchanged, browserEvents: browserEvents }, null, 2))
if (!report.success) process.exitCode = 1
