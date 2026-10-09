// Stage manifest-listed output routes by hardlink; never launches the local server.
import { createHash } from 'node:crypto'
import { link } from 'node:fs/promises'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../')
const here = path.join(root, 'evidence/graphics-loop/environment-next-phase-v7/sofa-upholstery-v1')
const bundleDir = path.join(here, 'static-sofa-v1')
const hostDir = path.join(here, 'static-fixture-sofa-v1')
const manifest = JSON.parse(await readFile(path.join(bundleDir, 'build-manifest.json'), 'utf8'))
const pins = JSON.parse(await readFile(path.join(here, 'source-pins-sofa-v1.json'), 'utf8'))
if (manifest.status !== 'BUILT_DIAGNOSTIC_NOT_PRODUCTION_CERTIFICATE') throw new Error('Unexpected reviewed sofa-v1 bundle status')
if (pins.schema !== 'sofa-upholstery-v1-source-pins/3') throw new Error('Unexpected reviewed sofa-v1 source pin schema')
const pinsBytes = await readFile(path.join(here, 'source-pins-sofa-v1.json'))
if (createHash('sha256').update(pinsBytes).digest('hex') !== manifest.sourcePinsSha256) throw new Error('Bundle/source pin digest mismatch')
await mkdir(hostDir, { recursive: false })
const outputs = []
for (const item of manifest.outputs) {
  const source = path.join(bundleDir, ...item.path.split('/'))
  const target = path.join(hostDir, ...item.path.split('/'))
  await mkdir(path.dirname(target), { recursive: true })
  await link(source, target)
  outputs.push({ path: item.path, sha256: item.sha256 })
}
const inputs = Object.fromEntries(pins.files.map((item) => [item.path, item.sha256]))
const hostManifest = { schema: 'fixture-hosting-v2-manifest/1', status: 'DIAGNOSTIC_STATIC_HOST_ONLY', fixtureSourcePinsSha256: manifest.sourcePinsSha256, outputs, inputs }
const bytes = Buffer.from(`${JSON.stringify(hostManifest, null, 2)}\n`)
await writeFile(path.join(hostDir, 'build-manifest.json'), bytes, { flag: 'wx' })
const receipt = {
  status: 'MANIFEST_HOST_STAGED_NOT_LAUNCHED', hostRelativePath: 'evidence/graphics-loop/environment-next-phase-v7/sofa-upholstery-v1',
  serverCommand: 'python3 evidence/graphics-loop/environment-next-phase-v7/sofa-upholstery-v1/remote-cpu-v1/serve-review-host-sofa-v1.py',
  hostManifestSha256: createHash('sha256').update(bytes).digest('hex'), sourcePinsSha256: manifest.sourcePinsSha256,
  outputCount: outputs.length, inputCount: Object.keys(inputs).length, hardlinksOnlyForStaticOutputs: true,
}
await writeFile(path.join(here, 'review-host-sofa-v1-staged.json'), `${JSON.stringify(receipt, null, 2)}\n`)
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
