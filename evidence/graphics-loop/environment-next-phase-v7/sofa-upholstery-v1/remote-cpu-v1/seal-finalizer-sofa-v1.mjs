// Seal compiler outputs and the single-copy finalizer immediately before packaging.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { here, hashFile, outDir, root, sha } from './phase-common-sofa-v1.mjs'

const pinsBytes = await readFile(path.join(here, 'source-pins-sofa-v1.json'))
const pins = JSON.parse(pinsBytes)
const compiledBytes = await readFile(path.join(here, 'compile-sofa-v1-record.json'))
const compiled = JSON.parse(compiledBytes)
if (pins.schema !== 'sofa-upholstery-v1-source-pins/3' || pins.status !== 'PREBUILD_SEALED') throw new Error('sofa-v1 source pins are not sealed')
if (compiled.schema !== 'sofa-upholstery-v1-compiled-record/2' || compiled.status !== 'COMPILED_DIAGNOSTIC_AWAITING_SINGLE_PUBLIC_COPY') throw new Error('sofa-v1 compile record missing or invalid')
if (compiled.sourcePinsSha256 !== sha(pinsBytes) || compiled.importClosureVerified !== true) throw new Error('Compile/source pin or runtime closure receipt mismatch')
const files = []
for (const relative of [
  'evidence/graphics-loop/environment-next-phase-v7/sofa-upholstery-v1/source-pins-sofa-v1.json',
  'evidence/graphics-loop/environment-next-phase-v7/sofa-upholstery-v1/compile-sofa-v1-record.json',
  'evidence/graphics-loop/environment-next-phase-v7/sofa-upholstery-v1/remote-cpu-v1/finalize-package-sofa-v1.mjs',
  'evidence/graphics-loop/environment-next-phase-v7/sofa-upholstery-v1/remote-cpu-v1/seal-finalizer-sofa-v1.mjs',
]) files.push({ path: relative, sha256: await hashFile(path.join(root, relative)) })
const outputs = []
for (const item of compiled.outputs) {
  const actual = await hashFile(path.join(outDir, ...item.path.split('/')))
  if (actual !== item.sha256) throw new Error(`Compiled output changed before finalizer seal: ${item.path}`)
  outputs.push({ path: `evidence/graphics-loop/environment-next-phase-v7/sofa-upholstery-v1/static-sofa-v1/${item.path}`, sha256: actual, bytes: item.bytes })
}
files.push(...outputs)
files.sort((a, b) => a.path.localeCompare(b.path))
const record = { schema: 'sofa-upholstery-v1-finalizer-pins/3', status: 'PRE_FINALIZATION_SEALED', createdAt: new Date().toISOString(), files }
const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`)
await writeFile(path.join(here, 'finalizer-pins-sofa-v1.json'), bytes)
process.stdout.write(JSON.stringify({ status: record.status, files: files.length, compiledOutputs: outputs.length, sha256: sha(bytes) }) + '\n')
