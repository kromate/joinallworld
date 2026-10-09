// Seal the exact commit's full production/public graph and reviewed v5 fixture closure.
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..')
const here = path.join(root, 'evidence/graphics-loop/environment-next-phase-v5')
const reviewed = path.join(here, 'remote-ci-preparation/reviewed-v3-fix1')
const sha = (data) => createHash('sha256').update(data).digest('hex')
async function hashFile(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
async function filesUnder(dir, rel = '') {
  const result = []
  for (const entry of await readdir(path.join(dir, rel), { withFileTypes: true })) {
    const name = path.posix.join(rel.split(path.sep).join('/'), entry.name)
    if (entry.isDirectory()) result.push(...await filesUnder(dir, name))
    else if (entry.isFile()) result.push(path.join(dir, name))
    else throw new Error(`Refusing non-regular source input: ${path.join(dir, name)}`)
  }
  return result
}
const candidateRecord = JSON.parse(await readFile(path.join(here, 'candidate-source-record.json'), 'utf8'))
for (const source of candidateRecord.sourceInputs ?? []) {
  if (await hashFile(path.join(root, source.path)) !== source.sha256) throw new Error(`Candidate clone production input changed: ${source.path}`)
}
for (const candidate of candidateRecord.candidateCopies ?? []) {
  if (!candidate.outputPath || await hashFile(path.join(here, candidate.outputPath)) !== candidate.output?.sha256) {
    throw new Error(`Private candidate clone output changed: ${candidate.outputPath ?? candidate.name}`)
  }
}
const files = []
for (const dir of ['src', 'public', 'node_modules/three/examples/jsm']) {
  for (const absolute of await filesUnder(path.join(root, dir))) {
    files.push({ path: path.relative(root, absolute).split(path.sep).join('/'), sha256: await hashFile(absolute) })
  }
}
const directInputs = [
  'package.json', 'package-lock.json', 'node_modules/three/package.json', 'node_modules/three/build/three.core.js', 'node_modules/three/build/three.module.js',
  ...['viewer.ts', 'index.html', 'candidate-source-record.json', 'candidate-build.ts', 'candidate-home-scene.ts', 'candidate-neighbourhood-scene.ts', 'candidate-venue-scenes.ts', 'candidate-world.ts', 'README.md', 'source-provenance.json'].map((name) => `evidence/graphics-loop/environment-next-phase-v5/${name}`),
  ...['README.md', 'REMOTE-REVIEW-NOTES.md', 'workflow.yml', 'run-bounded-linux-reviewed-v3-fix1.py', 'phase-common-v3.mjs', 'seal-source-pins-v3.mjs', 'verify-source-pins-v3.mjs', 'compile-vendor-v3.mjs', 'compile-addons-v3.mjs', 'compile-app-v3.mjs', 'seal-compiled-output-v3.mjs', 'seal-finalizer-v3.mjs', 'finalize-package-v3.mjs', 'prepare-review-host-v3.mjs', 'serve-review-host-reviewed-v3-fix1.py'].map((name) => `evidence/graphics-loop/environment-next-phase-v5/remote-ci-preparation/reviewed-v3-fix1/${name}`),
]
for (const source of candidateRecord.sourceInputs ?? []) files.push({ path: source.path, sha256: source.sha256 })
for (const relative of directInputs) files.push({ path: relative, sha256: await hashFile(path.join(root, relative)) })
files.sort((a, b) => a.path.localeCompare(b.path))
const unique = [...new Map(files.map((item) => [item.path, item])).values()]
const cityMapCount = unique.filter((item) => /^src\/game\/cities\/[^/]+\/map\.ts$/.test(item.path)).length
if (cityMapCount !== 40) throw new Error(`Expected all 40 city map modules, found ${cityMapCount}`)
const threePackage = JSON.parse(await readFile(path.join(root, 'node_modules/three/package.json'), 'utf8'))
if (threePackage.version !== '0.180.0') throw new Error(`Unexpected Three version ${threePackage.version}`)
const payload = {
  schema: 'environment-next-phase-v5-source-pins/3', status: 'PREBUILD_SEALED',
  createdAt: new Date().toISOString(), gitCommit: process.env.GITHUB_SHA ?? null,
  note: 'Full commit-pinned src/public/Three/candidate closure. Individual vendor, addon and application compilers consume only independently pinned inputs in fresh processes; full inventory is reverified in separate pre/post phases.',
  threeVersion: threePackage.version, cityMapSourceCount: cityMapCount, files: unique,
}
const bytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`)
await writeFile(path.join(here, 'source-pins-v3.json'), bytes)
process.stdout.write(JSON.stringify({ status: payload.status, files: unique.length, cityMapSourceCount: cityMapCount, manifestSha256: sha(bytes), threeVersion: payload.threeVersion }, null, 2) + '\n')
