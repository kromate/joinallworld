// Full inventory verification runs in its own short-lived process before and after compilation.
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const here = path.join(root, 'evidence/graphics-loop/environment-next-phase-v7')
const label = process.argv[2]
if (!['precompile', 'postcompile'].includes(label)) throw new Error('Expected precompile or postcompile')
const pinsBytes = await readFile(path.join(here, 'source-pins-v7.json'))
const pins = JSON.parse(pinsBytes)
if (pins.schema !== 'environment-next-phase-v7-source-pins/3' || pins.status !== 'PREBUILD_SEALED') throw new Error('Source pins are not sealed for v7')
const sha = (data) => createHash('sha256').update(data).digest('hex')
const started = Date.now()
let totalBytes = 0
for (const item of pins.files) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path.join(root, item.path))) { hash.update(chunk); totalBytes += chunk.byteLength }
  if (hash.digest('hex') !== item.sha256) throw new Error(`${label}: pinned input changed: ${item.path}`)
}
if (sha(await readFile(path.join(here, 'source-pins-v7.json'))) !== sha(pinsBytes)) throw new Error(`${label}: pin manifest changed while verifying`)
const receipt = { schema: 'environment-next-phase-v7-source-verification/1', status: 'VERIFIED', phase: label, sourcePinsSha256: sha(pinsBytes), fileCount: pins.files.length, bytesRead: totalBytes, elapsedMs: Date.now() - started, node: process.version }
await writeFile(path.join(here, `source-${label}-v7.json`), `${JSON.stringify(receipt, null, 2)}\n`)
process.stdout.write(`${JSON.stringify(receipt)}\n`)
