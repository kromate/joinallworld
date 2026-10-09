// Fresh Node process: emit the shared Three core/module pair, validating only consumed pinned inputs.
import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { hashFile, here, loadPins, outDir, rel, root, sha } from './phase-common-v4.mjs'

const { bytes: pinsBytes, digest: sourcePinsSha256, pins, expected } = await loadPins()
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
if (pkg.imports?.['#city-map/*']?.browser !== './src/game/cities/*/map.ts') throw new Error('Production browser #city-map mapping changed')
if (pins.threeVersion !== '0.180.0') throw new Error(`Unexpected Three version ${pins.threeVersion}`)
const base = path.join(root, 'node_modules/three/build')
const inputs = [
  { path: path.join(base, 'three.core.js'), output: path.join(outDir, 'vendor/three.core.js') },
  { path: path.join(base, 'three.module.js'), output: path.join(outDir, 'vendor/three.module.js') },
]
const consumed = new Map()
const pinPlugin = {
  name: 'hash-three-vendor-on-load',
  setup(esbuild) {
    esbuild.onLoad({ filter: /\.js$/ }, async (args) => {
      const contents = await readFile(args.path)
      const sourcePath = rel(args.path)
      const digest = sha(contents)
      if (expected.get(sourcePath) !== digest) throw new Error(`Three vendor input differs from source pin: ${sourcePath}`)
      consumed.set(sourcePath, digest)
      return { contents, loader: 'js', resolveDir: path.dirname(args.path) }
    })
  },
}
await mkdir(path.join(outDir, 'vendor'), { recursive: true })
const records = []
for (const item of inputs) {
  await build({ entryPoints: [item.path], bundle: false, format: 'esm', platform: 'browser', target: 'es2022', outfile: item.output, write: true, sourcemap: false, logLevel: 'silent', plugins: [pinPlugin] })
  const sourcePath = rel(item.path)
  const digest = consumed.get(sourcePath)
  if (!digest || await hashFile(item.path) !== digest) throw new Error(`Three vendor source changed or was not consumed: ${sourcePath}`)
  records.push({ input: { path: sourcePath, sha256: digest }, output: { path: path.relative(outDir, item.output).split(path.sep).join('/'), bytes: (await readFile(item.output)).byteLength, sha256: await hashFile(item.output) } })
}
const record = { schema: 'environment-next-phase-v5-vendor-record/1', status: 'VENDOR_COMPILED', sourcePinsSha256, sourcePinsBytes: pinsBytes.byteLength, threeVersion: pins.threeVersion, inputs: records }
const recordBytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`)
await writeFile(path.join(here, 'vendor-v4-record.json'), recordBytes, { flag: 'wx' })
process.stdout.write(JSON.stringify({ status: record.status, inputCount: records.length, outputBytes: records.reduce((n, row) => n + row.output.bytes, 0), recordSha256: sha(recordBytes) }) + '\n')
