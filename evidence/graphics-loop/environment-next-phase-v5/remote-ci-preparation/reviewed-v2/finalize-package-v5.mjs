// Verify compiled-only outputs, copy/hash public exactly once, and emit a restricted static-route manifest.
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { opendir, mkdir, readFile, writeFile } from 'node:fs/promises'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..')
const here = path.join(root, 'evidence/graphics-loop/environment-next-phase-v5')
const reviewed = path.join(here, 'remote-ci-preparation/reviewed-v2')
const outDir = path.join(here, 'static-v5')
const publicDir = path.join(root, 'public')
const progress = path.join(here, 'finalize-v5-progress.jsonl')
const started = Date.now()
const hardStop = setTimeout(() => { process.stderr.write('v5 finalization aborted at secondary 88s bound\n'); process.exit(124) }, 88_000)
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
async function hashFile(file) { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex') }
async function note(stage, extra = {}) {
  const row = { at: new Date().toISOString(), elapsedMs: Date.now() - started, stage, rss: process.memoryUsage().rss, heapUsed: process.memoryUsage().heapUsed, ...extra }
  await writeFile(progress, `${JSON.stringify(row)}\n`, { flag: 'a' })
  process.stdout.write(`${JSON.stringify(row)}\n`)
}
async function walk(dir, rel = '') {
  const result = []
  for await (const entry of await opendir(path.join(dir, rel))) {
    const next = path.posix.join(rel.split(path.sep).join('/'), entry.name)
    if (entry.isDirectory()) result.push(...await walk(dir, next))
    else if (entry.isFile()) result.push(path.join(dir, next))
    else throw new Error(`Nonregular file under finalization root: ${next}`)
  }
  return result
}
function mime(file) {
  return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml' })[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}
async function verifySourcePins(label, pins, expectedHash) {
  const bytes = await readFile(path.join(here, 'source-pins.json'))
  if (sha(bytes) !== expectedHash) throw new Error(`${label}: source-pin manifest changed`)
  for (const item of pins.files) if (await hashFile(path.join(root, item.path)) !== item.sha256) throw new Error(`${label}: pinned input changed: ${item.path}`)
}
await note('finalizer-start')
const sourcePinsBytes = await readFile(path.join(here, 'source-pins.json'))
const sourcePins = JSON.parse(sourcePinsBytes)
if (sourcePins.schema !== 'environment-next-phase-v5-source-pins/2' || sourcePins.status !== 'PREBUILD_SEALED') throw new Error('Reviewed v5 source pins are not sealed')
const sourcePinsHash = sha(sourcePinsBytes)
const finalizerPinsBytes = await readFile(path.join(here, 'finalizer-pins.json'))
const finalizerPins = JSON.parse(finalizerPinsBytes)
if (finalizerPins.schema !== 'environment-next-phase-v5-finalizer-pins/2' || finalizerPins.status !== 'PRE_FINALIZATION_SEALED') throw new Error('Reviewed v5 finalizer pins are not sealed')
const ownPath = 'evidence/graphics-loop/environment-next-phase-v5/remote-ci-preparation/reviewed-v2/finalize-package-v5.mjs'
const ownPin = finalizerPins.files.find((item) => item.path === ownPath)
if (!ownPin || await hashFile(fileURLToPath(import.meta.url)) !== ownPin.sha256) throw new Error('Finalizer differs from its sealed preflight hash')
for (const item of finalizerPins.files) if (await hashFile(path.join(root, item.path)) !== item.sha256) throw new Error(`Sealed compile output changed: ${item.path}`)
await verifySourcePins('pre-copy', sourcePins, sourcePinsHash)
const compiledBytes = await readFile(path.join(here, 'compile-v5-record.json'))
const compiled = JSON.parse(compiledBytes)
if (compiled.schema !== 'environment-next-phase-v5-compiled-record/1' || compiled.status !== 'COMPILED_DIAGNOSTIC_AWAITING_SINGLE_PUBLIC_COPY') throw new Error('Compile record is missing or malformed')
if (compiled.sourcePinsSha256 !== sourcePinsHash) throw new Error('Compile/source pin digests disagree')
if (compiled.importClosureVerified !== true || !Number.isInteger(compiled.importReferenceCount)) throw new Error('Compiled JavaScript import closure was not verified')
await note('source-and-compile-pins-verified', { sourceCount: sourcePins.files.length, compiledOutputs: compiled.outputs.length })

const compiledPaths = new Set(compiled.outputs.map((item) => item.path))
const currentCompiledFiles = await walk(outDir)
const currentCompiledPaths = new Set(currentCompiledFiles.map((file) => path.relative(outDir, file).split(path.sep).join('/')))
if (currentCompiledPaths.size !== compiledPaths.size || [...compiledPaths].some((name) => !currentCompiledPaths.has(name))) throw new Error('Compiled output tree differs from the sealed compile record')
for (const item of compiled.outputs) {
  const file = path.join(outDir, ...item.path.split('/'))
  if (await hashFile(file) !== item.sha256) throw new Error(`Compiled output hash changed: ${item.path}`)
}
const importMap = compiled.importMap
const imports = importMap?.imports
if (!imports || imports.three !== './vendor/three.module.js') throw new Error('Shared Three import map target changed')
for (const target of Object.values(imports)) {
  if (typeof target !== 'string' || !target.startsWith('./') || !compiledPaths.has(target.slice(2))) throw new Error(`Compiled import-map target missing: ${target}`)
}
const htmlPath = path.join(outDir, 'index.html')
const html = await readFile(htmlPath, 'utf8')
const match = /<script type="importmap">([^<]+)<\/script>/.exec(html)
if (!match || JSON.stringify(JSON.parse(match[1]).imports) !== JSON.stringify(imports)) throw new Error('Compiled HTML import map differs from sealed compile record')
if (!html.includes('src="./app/viewer.js"')) throw new Error('Compiled host entry path mismatch')
const mapSources = sourcePins.files.filter((item) => /^src\/game\/cities\/[^/]+\/map\.ts$/.test(item.path)).length
const mapChunks = [...compiledPaths].filter((name) => /^chunks\/map-[A-Z0-9]{8}\.js$/.test(name)).length
if (mapSources !== 40 || compiled.cityMapSourceCount !== mapSources || mapChunks !== mapSources || compiled.cityMapChunkCount !== mapChunks) throw new Error(`Full city-map graph mismatch: ${mapSources} source maps / ${mapChunks} compiled chunks`)

const outputRecords = compiled.outputs.map((item) => ({ ...item }))
const publicRecords = []
const outputPaths = new Set(compiledPaths)
const publicPins = new Map(sourcePins.files.filter((item) => item.path.startsWith('public/')).map((item) => [item.path, item.sha256]))
let publicBytes = 0
await note('public-copy-start', { pinnedPublicFiles: publicPins.size })
async function copyPublic(relative = '') {
  for await (const entry of await opendir(path.join(publicDir, relative))) {
    const next = path.posix.join(relative.split(path.sep).join('/'), entry.name)
    const source = path.join(publicDir, ...next.split('/'))
    const target = path.join(outDir, ...next.split('/'))
    if (entry.isDirectory()) {
      await mkdir(target, { recursive: true })
      await copyPublic(next)
      continue
    }
    if (!entry.isFile()) throw new Error(`Unsupported public entry: ${next}`)
    if (outputPaths.has(next)) throw new Error(`Public/compiled output collision: ${next}`)
    const expected = publicPins.get(`public/${next}`)
    if (!expected) throw new Error(`Public file was not sealed: ${next}`)
    await mkdir(path.dirname(target), { recursive: true })
    const digest = createHash('sha256'); let bytes = 0
    const tap = new Transform({ transform(chunk, _encoding, callback) { digest.update(chunk); bytes += chunk.byteLength; callback(null, chunk) } })
    await pipeline(createReadStream(source), tap, createWriteStream(target, { flags: 'wx' }))
    const sha256 = digest.digest('hex')
    if (sha256 !== expected) throw new Error(`Copied public file differs from source seal: ${next}`)
    publicRecords.push({ source: `public/${next}`, output: next, bytes, sha256 })
    outputRecords.push({ path: next, bytes, sha256, mime: mime(target), kind: 'copied-public' })
    outputPaths.add(next)
    publicBytes += bytes
  }
}
await copyPublic()
if (publicRecords.length !== publicPins.size) throw new Error(`Public inventory mismatch: copied ${publicRecords.length}, pinned ${publicPins.size}`)
await note('public-copy-complete', { publicFiles: publicRecords.length, publicBytes })
await verifySourcePins('post-copy', sourcePins, sourcePinsHash)
outputRecords.sort((a, b) => a.path.localeCompare(b.path))
publicRecords.sort((a, b) => a.output.localeCompare(b.output))
const manifest = {
  schema: 'environment-next-phase-v5-diagnostic-manifest/2', status: 'BUILT_DIAGNOSTIC_NOT_PRODUCTION_CERTIFICATE',
  createdAt: new Date().toISOString(), elapsedMs: Date.now() - started, node: process.version, threeVersion: sourcePins.threeVersion,
  sourcePinsSha256: sourcePinsHash, sourcePinsFile: 'source-pins.json',
  compileRecordSha256: sha(compiledBytes), compileRecordFile: 'compile-v5-record.json',
  method: 'Separate Node phases: shared Three core, actual Three addons, and full split host/city graph compiled from the v4 method; finalizer verifies compiled outputs then copies every public file exactly once. Diagnostic static package only; no compression or production budget claim.',
  importedThreeSpecifiers: compiled.importedThreeSpecifiers, importMap: imports,
  importClosureVerified: compiled.importClosureVerified, importReferenceCount: compiled.importReferenceCount,
  consumedApplicationInputs: compiled.consumedApplicationInputs, addonBuilds: compiled.addonBuilds,
  cityMapSourceCount: mapSources, cityMapChunkCount: mapChunks,
  publicFileCount: publicRecords.length, publicRawBytes: publicBytes,
  outputFileCount: outputRecords.length, outputRawBytes: outputRecords.reduce((sum, item) => sum + item.bytes, 0),
  outputs: outputRecords, publicFiles: publicRecords,
  applicationMetafileInputCount: compiled.applicationMetafileInputCount, applicationMetafileOutputCount: compiled.applicationMetafileOutputCount,
}
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
await writeFile(path.join(outDir, 'build-manifest.json'), manifestBytes, { flag: 'wx' })
const receipt = {
  status: 'FINALIZED_DIAGNOSTIC_READY_FOR_PARENT_REVIEW', elapsedMs: Date.now() - started, node: process.version,
  rss: process.memoryUsage().rss, heapUsed: process.memoryUsage().heapUsed,
  publicFiles: publicRecords.length, publicBytes, outputFiles: outputRecords.length,
  outputRawBytes: manifest.outputRawBytes, manifestSha256: sha(manifestBytes), sourcePinsSha256: sourcePinsHash,
  finalizerPinsSha256: sha(finalizerPinsBytes), compileRecordSha256: sha(compiledBytes),
}
await writeFile(path.join(here, 'finalization-v5-observed.json'), `${JSON.stringify(receipt, null, 2)}\n`)
await note('finalization-complete', receipt)
clearTimeout(hardStop)
