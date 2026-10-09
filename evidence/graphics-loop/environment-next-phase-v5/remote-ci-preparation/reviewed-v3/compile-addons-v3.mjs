// Fresh Node process: compile actual Three examples against the one external Three singleton.
import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { hashFile, here, loadPins, outDir, root, sha } from './phase-common-v3.mjs'

const { digest: sourcePinsSha256, expected } = await loadPins()
const entries = [
  { input: 'node_modules/three/examples/jsm/utils/BufferGeometryUtils.js', output: 'utils/BufferGeometryUtils' },
  { input: 'node_modules/three/examples/jsm/utils/SkeletonUtils.js', output: 'utils/SkeletonUtils' },
  { input: 'node_modules/three/examples/jsm/loaders/GLTFLoader.js', output: 'loaders/GLTFLoader' },
  { input: 'node_modules/three/examples/jsm/libs/meshopt_decoder.module.js', output: 'libs/meshopt_decoder.module' },
]
const consumed = new Map()
const pinPlugin = {
  name: 'verify-actually-consumed-three-addon-inputs',
  setup(esbuild) {
    esbuild.onLoad({ filter: /\.(?:js|mjs|cjs|json)$/ }, async (args) => {
      const contents = await readFile(args.path)
      const sourcePath = path.relative(root, args.path).split(path.sep).join('/')
      const digest = sha(contents)
      if (expected.get(sourcePath) !== digest) throw new Error(`Three addon dependency differs from source pin: ${sourcePath}`)
      const pin = { path: sourcePath, sha256: digest }
      consumed.set(pin.path, pin.sha256)
      return { contents, loader: path.extname(args.path) === '.json' ? 'json' : 'js', resolveDir: path.dirname(args.path) }
    })
  },
}
await mkdir(path.join(outDir, 'vendor/addons'), { recursive: true })
const records = []
for (const entry of entries) {
  const input = path.join(root, entry.input)
  const source = await assertPinned(input, expected, 'Three addon entry')
  const output = path.join(outDir, 'vendor/addons', `${entry.output}.js`)
  const result = await build({ absWorkingDir: root, entryPoints: [input], bundle: true, external: ['three'], format: 'esm', platform: 'browser', target: 'es2022', outfile: output, write: true, sourcemap: false, logLevel: 'silent', plugins: [pinPlugin], metafile: true })
  if (await hashFile(input) !== source.sha256) throw new Error(`Three addon entry changed during compile: ${source.path}`)
  for (const [filename, digest] of consumed) if (await hashFile(path.join(root, filename)) !== digest) throw new Error(`Consumed Three addon dependency changed during compile: ${filename}`)
  records.push({ entry: source, output: { path: path.relative(outDir, output).split(path.sep).join('/'), bytes: (await readFile(output)).byteLength, sha256: await hashFile(output) }, inputCount: Object.keys(result.metafile.inputs).length })
}
const consumedInputs = [...consumed].sort(([a], [b]) => a.localeCompare(b)).map(([file, digest]) => ({ path: file, sha256: digest }))
const record = { schema: 'environment-next-phase-v5-addon-record/1', status: 'ADDONS_COMPILED', sourcePinsSha256, entries: records, consumedInputs }
const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`)
await writeFile(path.join(here, 'addons-v3-record.json'), bytes, { flag: 'wx' })
process.stdout.write(JSON.stringify({ status: record.status, entryCount: records.length, consumedInputCount: consumedInputs.length, outputBytes: records.reduce((n, row) => n + row.output.bytes, 0), recordSha256: sha(bytes) }) + '\n')
