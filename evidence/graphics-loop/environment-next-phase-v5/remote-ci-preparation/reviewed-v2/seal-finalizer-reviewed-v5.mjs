// Seal the compiled-only output and finalizer immediately before the one public-copy phase.
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { opendir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..')
const here = path.join(root, 'evidence/graphics-loop/environment-next-phase-v5')
const outDir = path.join(here, 'static-v5')
const reviewed = path.join(here, 'remote-ci-preparation/reviewed-v2')
const sha = (data) => createHash('sha256').update(data).digest('hex')
async function hashFile(file) { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex') }
async function walk(dir, rel = '') {
  const result = []
  for await (const entry of await opendir(path.join(dir, rel))) {
    const next = path.posix.join(rel.split(path.sep).join('/'), entry.name)
    if (entry.isDirectory()) result.push(...await walk(dir, next))
    else if (entry.isFile()) result.push(path.join(dir, next))
    else throw new Error(`Nonregular compiled output: ${next}`)
  }
  return result
}
const pinsPath = path.join(here, 'source-pins.json')
const pinsBytes = await readFile(pinsPath)
const sourcePins = JSON.parse(pinsBytes)
if (sourcePins.schema !== 'environment-next-phase-v5-source-pins/2' || sourcePins.status !== 'PREBUILD_SEALED') throw new Error('Reviewed v5 source pins are not sealed')
const compiledPath = path.join(here, 'compile-v5-record.json')
const compiledBytes = await readFile(compiledPath)
const compiled = JSON.parse(compiledBytes)
if (compiled.schema !== 'environment-next-phase-v5-compiled-record/1' || compiled.status !== 'COMPILED_DIAGNOSTIC_AWAITING_SINGLE_PUBLIC_COPY') throw new Error('Compiled-only record is missing or invalid')
if (compiled.sourcePinsSha256 !== sha(pinsBytes)) throw new Error('Compiled record source-pin digest mismatch')
const files = []
for (const relative of [
  'evidence/graphics-loop/environment-next-phase-v5/source-pins.json',
  'evidence/graphics-loop/environment-next-phase-v5/compile-v5-record.json',
  'evidence/graphics-loop/environment-next-phase-v5/remote-ci-preparation/reviewed-v2/finalize-package-v5.mjs',
  'evidence/graphics-loop/environment-next-phase-v5/remote-ci-preparation/reviewed-v2/seal-finalizer-reviewed-v5.mjs',
]) files.push({ path: relative, sha256: await hashFile(path.join(root, relative)) })
const compileOutputs = []
for (const item of compiled.outputs) {
  const file = path.join(outDir, ...item.path.split('/'))
  const actual = await hashFile(file)
  if (actual !== item.sha256) throw new Error(`Compiled output changed before finalizer seal: ${item.path}`)
  compileOutputs.push({ path: `evidence/graphics-loop/environment-next-phase-v5/static-v5/${item.path}`, sha256: actual, bytes: item.bytes })
}
files.push(...compileOutputs)
files.sort((a, b) => a.path.localeCompare(b.path))
const record = { schema: 'environment-next-phase-v5-finalizer-pins/2', status: 'PRE_FINALIZATION_SEALED', createdAt: new Date().toISOString(), files }
const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`)
await writeFile(path.join(here, 'finalizer-pins.json'), bytes)
process.stdout.write(JSON.stringify({ status: record.status, fileCount: files.length, compiledOutputs: compileOutputs.length, pinsSha256: sha(bytes) }, null, 2) + '\n')
