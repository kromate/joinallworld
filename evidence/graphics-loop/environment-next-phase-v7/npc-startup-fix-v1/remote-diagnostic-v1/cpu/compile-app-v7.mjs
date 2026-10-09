// Fresh Node process: compile only the real host/city application graph and private candidate modules.
// Every file esbuild actually consumes is hashed against the sealed pin map on load and rechecked at phase end.
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { hashFile, here, insideRoot, loadPins, outDir, rel, root, sha } from './phase-common-v7.mjs'

const { digest: sourcePinsSha256, pins, expected } = await loadPins()
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const cityPattern = packageJson.imports?.['#city-map/*']?.browser
if (cityPattern !== './src/game/cities/*/map.ts') throw new Error(`Unexpected real browser map mapping: ${cityPattern}`)
const entryPath = path.join(here, 'remote-diagnostic-v1/viewer-npc-v1.ts')
const htmlPath = path.join(here, 'remote-diagnostic-v1/index-npc-v1.html')
const exactTag = '<script type="module" src="./viewer-npc-v1.ts"></script>'
const htmlSource = await readFile(htmlPath, 'utf8')
if (htmlSource.split(exactTag).length !== 2) throw new Error('Reviewed fixture HTML entry tag changed')
const consumed = new Map()
const sourcePinsPlugin = {
  name: 'hash-every-consumed-pinned-fixture-input',
  setup(esbuild) {
    esbuild.onResolve({ filter: /^\/src\// }, (args) => {
      const resolved = path.resolve(root, args.path.slice(1)); insideRoot(resolved, 'absolute /src import'); return { path: resolved }
    })
    esbuild.onResolve({ filter: /^#city-map\// }, (args) => {
      const city = args.path.slice('#city-map/'.length)
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(city)) throw new Error(`Invalid #city-map import ${args.path}`)
      const resolved = path.resolve(root, cityPattern.replace('*', city)); insideRoot(resolved, 'browser city map import'); return { path: resolved }
    })
    esbuild.onResolve({ filter: /\?url$/ }, (args) => {
      const raw = args.path.slice(0, -4)
      const dir = path.isAbsolute(args.resolveDir) ? args.resolveDir : path.resolve(root, args.resolveDir)
      const resolved = path.resolve(dir, raw); insideRoot(resolved, '?url asset'); return { path: resolved }
    })
    esbuild.onLoad({ filter: /\.(ts|mts|js|mjs|json|css|glb|png|jpe?g|webp|avif|svg|woff2?|ttf|otf|bin|wasm)$/i }, async (args) => {
      const absolute = path.resolve(args.path)
      const contents = await readFile(absolute)
      const digest = createHash('sha256').update(contents).digest('hex')
      const sourcePath = rel(absolute)
      if (expected.get(sourcePath) !== digest) throw new Error(`Application input differs from source pin: ${sourcePath}`)
      consumed.set(sourcePath, digest)
      const ext = path.extname(args.path).toLowerCase()
      const loader = ext === '.json' ? 'json' : ext === '.css' ? 'css' : ['.glb', '.png', '.jpg', '.jpeg', '.webp', '.avif', '.svg', '.woff', '.woff2', '.ttf', '.otf', '.bin', '.wasm'].includes(ext) ? 'file' : ext === '.ts' || ext === '.mts' ? 'ts' : 'js'
      return { contents, loader, resolveDir: path.dirname(absolute) }
    })
  },
}
const result = await build({
  absWorkingDir: root, entryPoints: [entryPath], bundle: true, splitting: true, platform: 'browser', format: 'esm', target: 'es2022',
  outdir: outDir, entryNames: 'app/[name]', chunkNames: 'chunks/[name]-[hash]', assetNames: 'assets/[name]-[hash]', loader: { '.glb': 'file' },
  external: ['three', 'three/*'], plugins: [sourcePinsPlugin], write: true, metafile: true, sourcemap: false, logLevel: 'silent',
})
for (const [relative, digest] of [...consumed].sort(([a], [b]) => a.localeCompare(b))) {
  if (await hashFile(path.join(root, relative)) !== digest) throw new Error(`Consumed application input changed during compilation: ${relative}`)
}
const external = new Set()
for (const output of Object.values(result.metafile.outputs)) for (const item of output.imports ?? []) if (item.external) external.add(item.path)
const addonMap = {
  'three/addons/utils/BufferGeometryUtils.js': './vendor/addons/utils/BufferGeometryUtils.js',
  'three/examples/jsm/utils/BufferGeometryUtils.js': './vendor/addons/utils/BufferGeometryUtils.js',
  'three/examples/jsm/utils/SkeletonUtils.js': './vendor/addons/utils/SkeletonUtils.js',
  'three/examples/jsm/loaders/GLTFLoader.js': './vendor/addons/loaders/GLTFLoader.js',
  'three/examples/jsm/libs/meshopt_decoder.module.js': './vendor/addons/libs/meshopt_decoder.module.js',
}
const importMap = { imports: { three: './vendor/three.module.js' } }
for (const specifier of [...external].sort()) {
  if (specifier === 'three') continue
  const target = addonMap[specifier]
  if (!target) throw new Error(`Unbuilt external in real application graph: ${specifier}`)
  importMap.imports[specifier] = target
}
const hasStylesheet = Object.keys(result.metafile.outputs).some((name) => name.replaceAll('\\', '/').endsWith('/app/viewer.css') || name === 'app/viewer.css')
let replaced = htmlSource.replace(exactTag, `<script type="importmap">${JSON.stringify(importMap)}</script>\n  <script type="module" src="./app/viewer.js"></script>`)
if (hasStylesheet) {
  if (replaced.split('</head>').length !== 2) throw new Error('Fixture HTML has no unique head close for bundled styles')
  replaced = replaced.replace('</head>', '  <link rel="stylesheet" href="./app/viewer.css">\n</head>')
}
await writeFile(path.join(outDir, 'index.html'), replaced, { flag: 'wx' })
const consumedInputs = [...consumed].sort(([a], [b]) => a.localeCompare(b)).map(([file, digest]) => ({ path: file, sha256: digest }))
const cityMapSources = pins.files.filter((item) => /^src\/game\/cities\/[^/]+\/map\.ts$/.test(item.path)).length
const appMapChunks = Object.keys(result.metafile.outputs).filter((name) => /(?:^|\/)chunks\/map-[A-Z0-9]{8}\.js$/.test(name)).length
const outputPaths = Object.keys(result.metafile.outputs).map((name) => path.isAbsolute(name) ? name : path.resolve(root, name))
const outputs = []
for (const file of outputPaths) outputs.push({ path: rel(file), bytes: (await readFile(file)).byteLength, sha256: await hashFile(file) })
outputs.push({ path: 'evidence/graphics-loop/environment-next-phase-v7/npc-startup-fix-v1/static-npc-v1/index.html', bytes: Buffer.byteLength(replaced), sha256: sha(replaced) })
if (cityMapSources !== 40 || appMapChunks !== cityMapSources) throw new Error(`Full map graph mismatch: ${cityMapSources} pinned map sources / ${appMapChunks} emitted map chunks`)
const vendorRecord = JSON.parse(await readFile(path.join(here, 'vendor-v7-record.json'), 'utf8'))
const addonRecord = JSON.parse(await readFile(path.join(here, 'addons-v7-record.json'), 'utf8'))
if (vendorRecord.status !== 'VENDOR_COMPILED' || addonRecord.status !== 'ADDONS_COMPILED' || vendorRecord.sourcePinsSha256 !== sourcePinsSha256 || addonRecord.sourcePinsSha256 !== sourcePinsSha256) throw new Error('Prerequisite vendor/addon phase records are missing or stale')
const dependencyOutputs = [...vendorRecord.inputs.map((item) => item.output), ...addonRecord.entries.map((item) => item.output)]
for (const item of dependencyOutputs) if (await hashFile(path.join(outDir, ...item.path.split('/'))) !== item.sha256) throw new Error(`Prerequisite vendor/addon output changed: ${item.path}`)
const outputRel = new Set([...outputs.map((item) => item.path.replace('evidence/graphics-loop/environment-next-phase-v7/npc-startup-fix-v1/static-npc-v1/', '')), ...dependencyOutputs.map((item) => item.path)])
const importRefs = []
const staticOrExport = /\b(?:import|export)\s*(?:[^;]*?\bfrom\s*)?["']([^"']+)["']/g
const dynamicLiteral = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
for (const item of [...outputs.filter((record) => record.path.endsWith('.js')).map((record) => ({ path: record.path.replace('evidence/graphics-loop/environment-next-phase-v7/npc-startup-fix-v1/static-npc-v1/', '') })), ...dependencyOutputs.filter((record) => record.path.endsWith('.js'))]) {
  const local = item.path
  const code = await readFile(path.join(outDir, ...local.split('/')), 'utf8')
  for (const expression of [staticOrExport, dynamicLiteral]) {
    expression.lastIndex = 0
    for (let match; (match = expression.exec(code));) importRefs.push({ from: local, specifier: match[1] })
  }
}
for (const { from, specifier } of importRefs) {
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    if (specifier.startsWith('/')) throw new Error(`Absolute runtime import unsupported: ${from} -> ${specifier}`)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier))
    if (!outputRel.has(resolved)) throw new Error(`Unresolved runtime sibling: ${from} -> ${specifier} (${resolved})`)
  } else {
    const target = importMap.imports[specifier]
    if (!target || !outputRel.has(target.slice(2))) throw new Error(`Unmapped runtime external: ${from} -> ${specifier}`)
  }
}
const cssRefs = []
const cssRefPattern = /(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|@import\s+(?:url\()?\s*(['"])([^'"]+)\3\s*\)?)/g
for (const item of outputs.filter((record) => record.path.endsWith('.css'))) {
  const local = item.path.replace('evidence/graphics-loop/environment-next-phase-v7/npc-startup-fix-v1/static-npc-v1/', '')
  const css = await readFile(path.join(outDir, ...local.split('/')), 'utf8')
  cssRefPattern.lastIndex = 0
  for (let match; (match = cssRefPattern.exec(css));) {
    const specifier = match[2] ?? match[4]
    if (/^(?:data:|https?:|#|\/\/)/i.test(specifier)) continue
    cssRefs.push({ from: local, specifier })
  }
}
for (const { from, specifier } of cssRefs) {
  const target = specifier.startsWith('/') ? path.posix.normalize(specifier.slice(1)) : path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier))
  if (!outputRel.has(target)) throw new Error(`Unresolved CSS runtime reference: ${from} -> ${specifier} (${target})`)
}
if (hasStylesheet && !outputRel.has('app/viewer.css')) throw new Error('HTML stylesheet link target was not emitted')
const record = {
  schema: 'environment-next-phase-v7-app-record/1', status: 'APPLICATION_COMPILED', sourcePinsSha256,
  consumedInputs, externalSpecifiers: [...external].sort(), importMap, importClosureVerified: true,
  importReferenceCount: importRefs.length, cssReferenceCount: cssRefs.length, cityMapSourceCount: cityMapSources, cityMapChunkCount: appMapChunks,
  applicationMetafileInputCount: Object.keys(result.metafile.inputs).length, applicationMetafileOutputCount: Object.keys(result.metafile.outputs).length,
  outputs: outputs.map((item) => ({ ...item, path: item.path.replace('evidence/graphics-loop/environment-next-phase-v7/npc-startup-fix-v1/static-npc-v1/', '') })),
  verifiedDependencyOutputs: dependencyOutputs,
}
const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`)
await writeFile(path.join(here, 'app-v7-record.json'), bytes, { flag: 'wx' })
process.stdout.write(JSON.stringify({ status: record.status, consumedInputs: consumedInputs.length, outputs: outputs.length, mapChunks: appMapChunks, importReferences: importRefs.length, recordSha256: sha(bytes) }) + '\n')
