// Fresh Node process: validate sealed outputs and stream-copy/hash every public asset exactly once.
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { opendir, mkdir, readFile, writeFile } from 'node:fs/promises'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { here, hashFile, outDir, root, sha } from './phase-common-v7.mjs'

const publicDir = path.join(root, 'public')
const sourcePinsBytes = await readFile(path.join(here, 'source-pins-npc-v1.json'))
const sourcePins = JSON.parse(sourcePinsBytes)
const finalizerBytes = await readFile(path.join(here, 'finalizer-pins-v7.json'))
const finalizerPins = JSON.parse(finalizerBytes)
const compiledBytes = await readFile(path.join(here, 'compile-v7-record.json'))
const compiled = JSON.parse(compiledBytes)
if (sourcePins.schema !== 'environment-next-phase-v7-npc-startup-source-pins/1' || finalizerPins.schema !== 'environment-next-phase-v7-finalizer-pins/3') throw new Error('v7 source/finalizer pin schemas invalid')
if (finalizerPins.status !== 'PRE_FINALIZATION_SEALED' || compiled.schema !== 'environment-next-phase-v7-compiled-record/2') throw new Error('v7 finalization records invalid')
if (compiled.sourcePinsSha256 !== sha(sourcePinsBytes) || compiled.importClosureVerified !== true) throw new Error('v7 compile record does not match source pin/runtime closure')
const ownPath = 'evidence/graphics-loop/environment-next-phase-v7/npc-startup-fix-v1/remote-diagnostic-v1/cpu/finalize-package-v7.mjs'
const ownPin = finalizerPins.files.find((item) => item.path === ownPath)
if (!ownPin || await hashFile(fileURLToPath(import.meta.url)) !== ownPin.sha256) throw new Error('Finalizer source differs from its sealed hash')
for (const item of finalizerPins.files) if (await hashFile(path.join(root, item.path)) !== item.sha256) throw new Error(`Finalizer sealed file changed: ${item.path}`)
const compiledPaths = new Set(compiled.outputs.map((item) => item.path))
for (const item of compiled.outputs) if (await hashFile(path.join(outDir, ...item.path.split('/'))) !== item.sha256) throw new Error(`Compiled output changed: ${item.path}`)
const mapSources = sourcePins.files.filter((item) => /^src\/game\/cities\/[^/]+\/map\.ts$/.test(item.path)).length
const mapChunks = [...compiledPaths].filter((name) => /^chunks\/map-[A-Z0-9]{8}\.js$/.test(name)).length
if (mapSources !== 40 || compiled.cityMapSourceCount !== 40 || mapChunks !== 40 || compiled.cityMapChunkCount !== 40) throw new Error('Full city-map source/chunk closure failed')
const imports = compiled.importMap?.imports
if (!imports || imports.three !== './vendor/three.module.js' || !compiledPaths.has('vendor/three.core.js')) throw new Error('Shared Three core/module outputs missing')
for (const [specifier, target] of Object.entries(imports)) if (!target.startsWith('./') || !compiledPaths.has(target.slice(2))) throw new Error(`Missing import map target ${specifier} -> ${target}`)
const html = await readFile(path.join(outDir, 'index.html'), 'utf8')
const match = /<script type="importmap">([^<]+)<\/script>/.exec(html)
if (!match || JSON.stringify(JSON.parse(match[1]).imports) !== JSON.stringify(imports) || !html.includes('src="./app/viewer.js"')) throw new Error('Compiled HTML import map/entry differs from sealed record')

const outputRecords = compiled.outputs.map((item) => ({ ...item }))
const outputNames = new Set(compiledPaths)
const publicPins = new Map(sourcePins.files.filter((item) => item.path.startsWith('public/')).map((item) => [item.path, item.sha256]))
const publicRecords = []
let publicBytes = 0
function mime(file) { return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf' })[path.extname(file).toLowerCase()] ?? 'application/octet-stream' }
async function copyPublic(relative = '') {
  for await (const entry of await opendir(path.join(publicDir, relative))) {
    const next = path.posix.join(relative.split(path.sep).join('/'), entry.name)
    const source = path.join(publicDir, ...next.split('/'))
    const target = path.join(outDir, ...next.split('/'))
    if (entry.isDirectory()) { await mkdir(target, { recursive: true }); await copyPublic(next); continue }
    if (!entry.isFile()) throw new Error(`Unsupported public entry: ${next}`)
    if (outputNames.has(next)) throw new Error(`Public/compiled output collision: ${next}`)
    const expected = publicPins.get(`public/${next}`)
    if (!expected) throw new Error(`Public file not pinned: ${next}`)
    await mkdir(path.dirname(target), { recursive: true })
    const hash = createHash('sha256'); let bytes = 0
    const tap = new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); bytes += chunk.byteLength; callback(null, chunk) } })
    await pipeline(createReadStream(source), tap, createWriteStream(target, { flags: 'wx' }))
    const digest = hash.digest('hex')
    if (digest !== expected) throw new Error(`Public source changed from full pre/post seal: ${next}`)
    publicRecords.push({ source: `public/${next}`, output: next, bytes, sha256: digest })
    outputRecords.push({ path: next, bytes, sha256: digest, mime: mime(target), kind: 'copied-public' })
    outputNames.add(next); publicBytes += bytes
  }
}
await copyPublic()
if (publicRecords.length !== publicPins.size) throw new Error(`Public inventory mismatch: ${publicRecords.length} copied / ${publicPins.size} pinned`)
outputRecords.sort((a, b) => a.path.localeCompare(b.path)); publicRecords.sort((a, b) => a.output.localeCompare(b.output))
const manifest = {
  schema: 'environment-next-phase-v7-diagnostic-manifest/3', status: 'BUILT_DIAGNOSTIC_NOT_PRODUCTION_CERTIFICATE',
  createdAt: new Date().toISOString(), node: process.version, threeVersion: sourcePins.threeVersion,
  sourcePinsSha256: sha(sourcePinsBytes), sourcePinsFile: 'source-pins-npc-v1.json', compileRecordSha256: sha(compiledBytes), compileRecordFile: 'compile-v7-record.json',
  method: 'Full source/public inventory separately sealed and verified pre/post compile. Three core/module, addons and application compile in fresh serial Node processes, each checking actually consumed sources. This finalizer validates outputs and streams all public files exactly once.',
  importedThreeSpecifiers: compiled.importedThreeSpecifiers, importMap: imports, importClosureVerified: compiled.importClosureVerified, importReferenceCount: compiled.importReferenceCount,
  consumedInputs: compiled.consumedInputs, cityMapSourceCount: mapSources, cityMapChunkCount: mapChunks,
  publicFileCount: publicRecords.length, publicRawBytes: publicBytes, outputFileCount: outputRecords.length,
  outputRawBytes: outputRecords.reduce((sum, item) => sum + item.bytes, 0), outputs: outputRecords, publicFiles: publicRecords,
}
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
await writeFile(path.join(outDir, 'build-manifest.json'), manifestBytes, { flag: 'wx' })
const receipt = { status: 'FINALIZED_DIAGNOSTIC_READY_FOR_PARENT_REVIEW', publicFiles: publicRecords.length, publicBytes, outputFiles: outputRecords.length, outputRawBytes: manifest.outputRawBytes, manifestSha256: sha(manifestBytes), sourcePinsSha256: sha(sourcePinsBytes), finalizerPinsSha256: sha(finalizerBytes), compileRecordSha256: sha(compiledBytes) }
await writeFile(path.join(here, 'finalization-v7-observed.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' })
process.stdout.write(JSON.stringify(receipt) + '\n')
