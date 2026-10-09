// One bounded, write-to-disk diagnostic build of the actual whole Lagos host graph.
// Three is emitted once as a shared vendor. Actual imported Three addons are compiled separately
// against that external singleton. All other application/city source remains the real full graph.
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { opendir, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..')
const here = path.join(root, 'evidence/graphics-loop/environment-next-phase-v5')
const outDir = path.join(here, 'static-v5')
const progressFile = path.join(here, 'compile-v5-progress.jsonl')
const pinsFile = path.join(here, 'source-pins.json')
const maxMs = 88_000
const started = Date.now()
const hardStop = setTimeout(() => { process.stderr.write('v5 diagnostic build aborted at 88s bound\n'); process.exit(124) }, maxMs)
const sha = (data) => createHash('sha256').update(data).digest('hex')
const mem = () => ({ rss: process.memoryUsage().rss, heapUsed: process.memoryUsage().heapUsed })
async function hashFile(file) {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(file)) h.update(chunk)
  return h.digest('hex')
}
async function note(stage, extra = {}) {
  const row = { at: new Date().toISOString(), elapsedMs: Date.now() - started, stage, ...mem(), ...extra }
  await writeFile(progressFile, `${JSON.stringify(row)}\n`, { flag: 'a' })
  process.stdout.write(`${JSON.stringify(row)}\n`)
}
function projectRelative(file) { return path.relative(root, file).split(path.sep).join('/') }
function insideRoot(file, label) {
  const rel = path.relative(root, file)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`${label} escaped project root: ${file}`)
}
async function verifyPins(label) {
  const pins = JSON.parse(await readFile(pinsFile, 'utf8'))
  if (pins.status !== 'PREBUILD_SEALED' || pins.schema !== 'environment-next-phase-v5-source-pins/2') throw new Error('Source pin record is not sealed')
  for (const item of pins.files) {
    const file = path.join(root, item.path)
    if (await hashFile(file) !== item.sha256) throw new Error(`${label}: pinned input changed: ${item.path}`)
  }
  return pins
}
await rm(progressFile, { force: true })
await note('preflight-start')
const pins = await verifyPins('preflight')
const pinsHash = sha(await readFile(pinsFile))
if (pins.threeVersion !== '0.180.0') throw new Error(`Unexpected Three pin ${pins.threeVersion}`)
await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })
const entryPath = path.join(here, 'viewer.ts')
const htmlPath = path.join(here, 'index.html')
const exactScriptTag = '<script type="module" src="./viewer.ts"></script>'
const htmlSource = await readFile(htmlPath, 'utf8')
if (htmlSource.split(exactScriptTag).length !== 2) throw new Error('Fixture HTML script tag differs from reviewed exact form')
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const cityPattern = packageJson.imports?.['#city-map/*']?.browser
if (cityPattern !== './src/game/cities/*/map.ts') throw new Error(`Unexpected real package browser mapping: ${cityPattern}`)
const consumed = new Map()
const sourceLoader = {
  name: 'actual-source-pins-and-production-resolution',
  setup(esbuild) {
    esbuild.onResolve({ filter: /^\/src\// }, (args) => {
      const resolved = path.resolve(root, args.path.slice(1)); insideRoot(resolved, 'absolute /src path'); return { path: resolved }
    })
    esbuild.onResolve({ filter: /^#city-map\// }, (args) => {
      const city = args.path.slice('#city-map/'.length)
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(city)) throw new Error(`Invalid #city-map specifier ${args.path}`)
      const resolved = path.resolve(root, cityPattern.replace('*', city)); insideRoot(resolved, 'browser #city-map path'); return { path: resolved }
    })
    esbuild.onResolve({ filter: /\?url$/ }, (args) => {
      const raw = args.path.slice(0, -4)
      const dir = path.isAbsolute(args.resolveDir) ? args.resolveDir : path.resolve(root, args.resolveDir)
      const resolved = path.resolve(dir, raw); insideRoot(resolved, '?url asset'); return { path: resolved }
    })
    esbuild.onLoad({ filter: /\.(ts|mts|js|mjs|json|glb|png|jpe?g|webp|avif|svg|woff2?|ttf|otf|bin|wasm)$/i }, async (args) => {
      const absolute = path.resolve(args.path); insideRoot(absolute, 'source input')
      const contents = await readFile(absolute)
      consumed.set(absolute, sha(contents))
      const ext = path.extname(args.path).toLowerCase()
      const loader = ext === '.json' ? 'json' : ext === '.glb' || ['.png', '.jpg', '.jpeg', '.webp', '.avif', '.svg', '.woff', '.woff2', '.ttf', '.otf', '.bin', '.wasm'].includes(ext) ? 'file' : ext === '.ts' || ext === '.mts' ? 'ts' : 'js'
      return { contents, loader, resolveDir: path.dirname(absolute) }
    })
  },
}
const threeCore = path.join(root, 'node_modules/three/build/three.core.js')
const vendorCore = path.join(root, 'node_modules/three/build/three.module.js')
await note('three-core-compile-start')
const core = await build({ absWorkingDir: root, entryPoints: [threeCore], bundle: false, format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(outDir, 'vendor/three.core.js'), write: true, sourcemap: false, logLevel: 'silent' })
const moduleBuild = await build({ absWorkingDir: root, entryPoints: [vendorCore], bundle: false, format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(outDir, 'vendor/three.module.js'), write: true, sourcemap: false, logLevel: 'silent' })
await note('three-core-compile-done', { outputFiles: (core.outputFiles?.length ?? 0) + (moduleBuild.outputFiles?.length ?? 0) || 'written', threeCoreSourceSha256: await hashFile(threeCore), threeModuleSourceSha256: await hashFile(vendorCore) })
if (global.gc) global.gc()

const addonEntries = [
  { in: path.join(root, 'node_modules/three/examples/jsm/utils/BufferGeometryUtils.js'), out: 'utils/BufferGeometryUtils' },
  { in: path.join(root, 'node_modules/three/examples/jsm/utils/SkeletonUtils.js'), out: 'utils/SkeletonUtils' },
  { in: path.join(root, 'node_modules/three/examples/jsm/loaders/GLTFLoader.js'), out: 'loaders/GLTFLoader' },
  { in: path.join(root, 'node_modules/three/examples/jsm/libs/meshopt_decoder.module.js'), out: 'libs/meshopt_decoder.module' },
]
await note('three-addon-compile-start', { entries: addonEntries.map((entry) => projectRelative(entry.in)) })
const addonResults = []
for (const entry of addonEntries) {
  const result = await build({ absWorkingDir: root, entryPoints: [{ in: entry.in, out: entry.out }], bundle: true, external: ['three'], format: 'esm', platform: 'browser', target: 'es2022', outfile: path.join(outDir, 'vendor/addons', `${entry.out}.js`), write: true, sourcemap: false, logLevel: 'silent', metafile: true })
  addonResults.push({ entry: projectRelative(entry.in), outputs: result.metafile ? Object.keys(result.metafile.outputs) : [] })
  if (global.gc) global.gc()
  await note('three-addon-compiled', { entry: projectRelative(entry.in), outputBytes: (await (async () => { const p = path.join(outDir, 'vendor/addons', `${entry.out}.js`); return (await readFile(p)).byteLength })()) })
}

await note('actual-full-city-graph-start')
const app = await build({
  absWorkingDir: root, entryPoints: [entryPath], bundle: true, splitting: true, platform: 'browser', format: 'esm', target: 'es2022',
  outdir: outDir, entryNames: 'app/[name]', chunkNames: 'chunks/[name]-[hash]', assetNames: 'assets/[name]-[hash]', loader: { '.glb': 'file' },
  external: ['three', 'three/*'], plugins: [sourceLoader], write: true, metafile: true, sourcemap: false, logLevel: 'silent',
})
await note('actual-full-city-graph-done', { inputs: Object.keys(app.metafile.inputs).length, outputs: Object.keys(app.metafile.outputs).length })
const externalSpecifiers = new Set()
for (const output of Object.values(app.metafile.outputs)) for (const item of output.imports ?? []) if (item.external) externalSpecifiers.add(item.path)
const required = [...externalSpecifiers].sort()
const addonMap = {
  'three/addons/utils/BufferGeometryUtils.js': './vendor/addons/utils/BufferGeometryUtils.js',
  'three/examples/jsm/utils/BufferGeometryUtils.js': './vendor/addons/utils/BufferGeometryUtils.js',
  'three/examples/jsm/utils/SkeletonUtils.js': './vendor/addons/utils/SkeletonUtils.js',
  'three/examples/jsm/loaders/GLTFLoader.js': './vendor/addons/loaders/GLTFLoader.js',
  'three/examples/jsm/libs/meshopt_decoder.module.js': './vendor/addons/libs/meshopt_decoder.module.js',
}
const importMap = { imports: { three: './vendor/three.module.js' } }
for (const specifier of required) {
  if (specifier === 'three') continue
  const target = addonMap[specifier]
  if (!target) throw new Error(`Unbuilt external import in actual graph: ${specifier}`)
  importMap.imports[specifier] = target
}
const script = '<script type="module" src="./app/viewer.js"></script>'
const html = htmlSource.replace(exactScriptTag, `<script type="importmap">${JSON.stringify(importMap)}</script>\n  ${script}`)
const htmlBytes = Buffer.from(html)
await writeFile(path.join(outDir, 'index.html'), htmlBytes, { flag: 'wx' })

const outputRecords = []
async function recordOutput(file, kind) {
  const bytes = await readFile(file)
  outputRecords.push({ path: path.relative(outDir, file).split(path.sep).join('/'), bytes: bytes.byteLength, sha256: sha(bytes), mime: mimeFor(file), kind })
}
function mimeFor(file) {
  return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.bin': 'application/octet-stream' })[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}
const generated = []
async function collectGenerated(dir, rel = '') {
  for await (const ent of await opendir(path.join(dir, rel))) {
    const name = path.posix.join(rel.split(path.sep).join('/'), ent.name)
    if (ent.isDirectory()) await collectGenerated(dir, name)
    else if (ent.isFile()) generated.push(path.join(dir, name))
    else throw new Error(`Nonregular generated output: ${name}`)
  }
}
await collectGenerated(outDir)
if (!generated.length) throw new Error('Full-host compiler emitted no files')
for (const file of generated) await recordOutput(file, path.relative(outDir, file).startsWith('vendor/') ? 'three-vendor-or-addon' : 'esbuild-application')
const generatedRel = new Set(outputRecords.map((record) => record.path))
for (const target of Object.values(importMap.imports)) {
  if (typeof target !== 'string' || !target.startsWith('./') || !generatedRel.has(target.slice(2))) throw new Error(`Missing compiled import-map target ${target}`)
}
if (!generatedRel.has('app/viewer.js') || !generatedRel.has('vendor/three.module.js') || !generatedRel.has('vendor/three.core.js')) throw new Error('Required host entry/shared Three core/module output missing')
const importRefs = []
const staticOrExport = /\b(?:import|export)\s*(?:[^;]*?\bfrom\s*)?["']([^"']+)["']/g
const dynamicLiteral = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
for (const item of outputRecords.filter((record) => record.path.endsWith('.js'))) {
  const code = await readFile(path.join(outDir, ...item.path.split('/')), 'utf8')
  for (const expression of [staticOrExport, dynamicLiteral]) {
    expression.lastIndex = 0
    for (let match; (match = expression.exec(code));) importRefs.push({ from: item.path, specifier: match[1] })
  }
}
for (const { from, specifier } of importRefs) {
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    if (specifier.startsWith('/')) throw new Error(`Absolute runtime import is unsupported: ${from} -> ${specifier}`)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier))
    if (!generatedRel.has(resolved)) throw new Error(`Unresolved relative runtime import: ${from} -> ${specifier} (${resolved})`)
  } else {
    const target = importMap.imports[specifier]
    if (!target) throw new Error(`Unmapped bare runtime import: ${from} -> ${specifier}`)
    if (!target.startsWith('./') || !generatedRel.has(target.slice(2))) throw new Error(`Import-map runtime target is absent: ${specifier} -> ${target}`)
  }
}
const cityMapSources = pins.files.filter((item) => /^src\/game\/cities\/[^/]+\/map\.ts$/.test(item.path)).length
const cityMapChunks = [...generatedRel].filter((name) => /^chunks\/map-[A-Z0-9]{8}\.js$/.test(name)).length
if (cityMapSources !== 40 || cityMapChunks !== cityMapSources) throw new Error(`Full city map graph mismatch: ${cityMapSources} pinned modules / ${cityMapChunks} emitted chunks`)
const consumedHashes = {}
for (const [absolute, digest] of [...consumed].sort(([a], [b]) => a.localeCompare(b))) {
  if (await hashFile(absolute) !== digest) throw new Error(`Consumed source changed during compile: ${projectRelative(absolute)}`)
  consumedHashes[projectRelative(absolute)] = digest
}
const postPins = await verifyPins('postcompile')
if (sha(await readFile(pinsFile)) !== pinsHash) throw new Error('Source-pins manifest itself changed during compile')
for (const item of generated) {
  const record = outputRecords.find((entry) => entry.path === path.relative(outDir, item).split(path.sep).join('/'))
  if (!record || await hashFile(item) !== record.sha256) throw new Error(`Compiled output changed before compile receipt: ${record?.path ?? item}`)
}
outputRecords.sort((a, b) => a.path.localeCompare(b.path))
const compiled = {
  schema: 'environment-next-phase-v5-compiled-record/1', status: 'COMPILED_DIAGNOSTIC_AWAITING_SINGLE_PUBLIC_COPY',
  createdAt: new Date().toISOString(), elapsedMs: Date.now() - started, node: process.version, threeVersion: pins.threeVersion,
  sourcePinsSha256: pinsHash, sourcePinsFile: 'source-pins.json',
  method: 'v4 shared Three core and three.module sibling + separate actual addon entrypoints + full split production host/city graph. This phase emits no public files; the later finalizer copies/hash-checks public exactly once.',
  importedThreeSpecifiers: required, importMap, consumedApplicationInputs: consumedHashes, addonBuilds: addonResults,
  importClosureVerified: true, importReferenceCount: importRefs.length, importClosureRule: 'Every compiled JavaScript static import, export-from, and literal dynamic import resolves to an emitted sibling/chunk or an explicit import-map target.',
  cityMapSourceCount: cityMapSources, cityMapChunkCount: cityMapChunks,
  outputFileCount: outputRecords.length, outputRawBytes: outputRecords.reduce((sum, item) => sum + item.bytes, 0),
  outputs: outputRecords, applicationMetafileInputCount: Object.keys(app.metafile.inputs).length,
  applicationMetafileOutputCount: Object.keys(app.metafile.outputs).length,
}
const compiledBytes = Buffer.from(`${JSON.stringify(compiled, null, 2)}\n`)
await writeFile(path.join(here, 'compile-v5-record.json'), compiledBytes, { flag: 'wx' })
await note('compile-complete', { elapsedMs: Date.now() - started, outputs: outputRecords.length, outputRawBytes: compiled.outputRawBytes, cityMapSources, cityMapChunks, compileRecordSha256: sha(compiledBytes) })
clearTimeout(hardStop)
