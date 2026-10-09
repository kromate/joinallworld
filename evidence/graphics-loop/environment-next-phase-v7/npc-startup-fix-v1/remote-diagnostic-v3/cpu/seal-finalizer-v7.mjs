// Seal compiler outputs and the single-copy finalizer immediately before packaging.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { here, hashFile, outDir, root, sha } from './phase-common-v7.mjs'

const pinsBytes = await readFile(path.join(here, 'source-pins-npc-v2.json'))
const pins = JSON.parse(pinsBytes)
const compiledBytes = await readFile(path.join(here, 'compile-v7-record.json'))
const compiled = JSON.parse(compiledBytes)
if (pins.schema !== 'environment-next-phase-v7-npc-startup-source-pins/2' || pins.status !== 'PREBUILD_SEALED') throw new Error('v7 source pins are not sealed')
if (compiled.schema !== 'environment-next-phase-v7-compiled-record/2' || compiled.status !== 'COMPILED_DIAGNOSTIC_AWAITING_SINGLE_PUBLIC_COPY') throw new Error('v7 compile record missing or invalid')
if (compiled.sourcePinsSha256 !== sha(pinsBytes) || compiled.importClosureVerified !== true) throw new Error('Compile/source pin or runtime closure receipt mismatch')
const files = []
for (const relative of [
  'evidence/graphics-loop/environment-next-phase-v7/npc-startup-fix-v1/source-pins-npc-v2.json',
  'evidence/graphics-loop/environment-next-phase-v7/npc-startup-fix-v1/compile-v7-record.json',
  'evidence/graphics-loop/environment-next-phase-v7/npc-startup-fix-v1/remote-diagnostic-v3/cpu/finalize-package-v7.mjs',
  'evidence/graphics-loop/environment-next-phase-v7/npc-startup-fix-v1/remote-diagnostic-v3/cpu/seal-finalizer-v7.mjs',
  'evidence/graphics-loop/environment-next-phase-v7/npc-startup-fix-v1/remote-diagnostic-v3/cpu/html-entry-contract-npc-v2.mjs',
]) files.push({ path: relative, sha256: await hashFile(path.join(root, relative)) })
const outputs = []
for (const item of compiled.outputs) {
  const actual = await hashFile(path.join(outDir, ...item.path.split('/')))
  if (actual !== item.sha256) throw new Error(`Compiled output changed before finalizer seal: ${item.path}`)
  outputs.push({ path: `evidence/graphics-loop/environment-next-phase-v7/npc-startup-fix-v1/static-npc-v2/${item.path}`, sha256: actual, bytes: item.bytes })
}
files.push(...outputs)
files.sort((a, b) => a.path.localeCompare(b.path))
const record = { schema: 'environment-next-phase-v7-finalizer-pins/3', status: 'PRE_FINALIZATION_SEALED', createdAt: new Date().toISOString(), files }
const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`)
await writeFile(path.join(here, 'finalizer-pins-v7.json'), bytes)
process.stdout.write(JSON.stringify({ status: record.status, files: files.length, compiledOutputs: outputs.length, sha256: sha(bytes) }) + '\n')
