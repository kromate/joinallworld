import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../')
export const here = path.join(root, 'evidence/graphics-loop/environment-next-phase-v7/sofa-upholstery-v1')
export const outDir = path.join(here, 'static-sofa-v1')
export const pinPath = path.join(here, 'source-pins-sofa-v1.json')
export const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
export const rel = (file) => path.relative(root, file).split(path.sep).join('/')
export function insideRoot(file, label = 'input') {
  const relative = path.relative(root, file)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${label} escaped project root: ${file}`)
}
export async function hashFile(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
export async function loadPins() {
  const bytes = await readFile(pinPath)
  const pins = JSON.parse(bytes)
  if (pins.schema !== 'sofa-upholstery-v1-source-pins/3' || pins.status !== 'PREBUILD_SEALED') throw new Error('sofa-v1 source pins are not sealed')
  return { bytes, digest: sha(bytes), pins, expected: new Map(pins.files.map((item) => [item.path, item.sha256])) }
}
export async function assertPinned(file, expected, label = 'consumed source') {
  insideRoot(file, label)
  const relative = rel(file)
  const pinned = expected.get(relative)
  if (!pinned) throw new Error(`${label} is absent from source pin manifest: ${relative}`)
  const actual = await hashFile(file)
  if (actual !== pinned) throw new Error(`${label} differs from source pin: ${relative}`)
  return { path: relative, sha256: actual }
}
