// Seal full production/public inputs, the actual-host fixture and its control/runner closure.
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../')
const fixture = path.join(root, 'evidence/graphics-loop/environment-next-phase-v7/sofa-upholstery-v1')
const sha = data => createHash('sha256').update(data).digest('hex')
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
    else throw new Error(`Refusing non-regular input: ${path.join(dir, name)}`)
  }
  return result
}
const fixtureNames = [
  'README.md', 'index-sofa-compare.html', 'viewer-sofa-compare.ts', 'home-scene-before.ts',
  'home-scene-candidate.ts', 'sofa-upholstery.test.mjs', 'source-provenance.json', 'fixture-provenance.json',
  '../readiness-protocol-v6.mjs', '../readiness-protocol-v6.d.mts', '../readiness-protocol-v6.test.mjs',
]
const recipeNames = [
  'phase-common-sofa-v1.mjs', 'verify-source-pins-sofa-v1.mjs', 'compile-vendor-sofa-v1.mjs',
  'compile-addons-sofa-v1.mjs', 'compile-app-sofa-v1.mjs', 'seal-compiled-output-sofa-v1.mjs', 'seal-finalizer-sofa-v1.mjs',
  'finalize-package-sofa-v1.mjs', 'prepare-review-host-sofa-v1.mjs', 'serve-review-host-sofa-v1.py',
].map(name => `evidence/graphics-loop/environment-next-phase-v7/sofa-upholstery-v1/remote-cpu-v1/${name}`)
const renderRecipeNames = [
  'review-render-sofa-v5.mjs', 'run-bounded-linux-render-sofa-v5.py', 'preflight-module-links-sofa-v5.mjs', 'result-dir-contract-sofa-v5.mjs',
  'test-render-contract-sofa-v5.mjs', 'test-result-dir-contract-sofa-v5.mjs', 'test-package-selection-sofa-v5.mjs',
  'test-runner-contract-sofa-v5.py', 'package-selection-sofa-v5.mjs', 'remote-control-sofa-v5.mjs', 'scope-plan-sofa-v5.mjs',
  'seal-review-sources-sofa-v5.mjs', 'review-sources-sofa-v5.json', 'workflow-integrated-sofa-v5.yml',
].map(name => `evidence/graphics-loop/environment-next-phase-v7/sofa-upholstery-v1/remote-render-v5/${name}`)
const direct = [
  'package.json', 'package-lock.json', 'node_modules/three/package.json', 'node_modules/three/build/three.core.js', 'node_modules/three/build/three.module.js',
  ...fixtureNames.map(name => path.posix.normalize(`evidence/graphics-loop/environment-next-phase-v7/sofa-upholstery-v1/${name}`)),
  ...recipeNames, ...renderRecipeNames,
  'evidence/graphics-loop/environment-next-phase-v7/sofa-upholstery-v1/remote-cpu-v5/run-bounded-linux-package-sofa-v5.py',
  'evidence/graphics-loop/environment-next-phase-v7/sofa-upholstery-v1/remote-cpu-v5/seal-source-pins-sofa-v5.mjs',
  'evidence/graphics-loop/environment-next-phase-v7/sofa-upholstery-v1/remote-cpu-v5/test-single-source-seal-sofa-v5.py',
  '.github/workflows/graphics-sofa-upholstery-v1-integrated-v5.yml',
]
const all = []
for (const dir of ['src', 'public', 'node_modules/three/examples/jsm']) {
  for (const file of await filesUnder(path.join(root, dir))) all.push(path.relative(root, file).split(path.sep).join('/'))
}
all.push(...direct)
const uniquePaths = [...new Set(all)].sort((a, b) => a.localeCompare(b))
const missingInputs = uniquePaths.filter((relative) => !existsSync(path.join(root, relative)))
if (missingInputs.length) throw new Error(`Missing required source-seal inputs (${missingInputs.length}): ${missingInputs.join(', ')}`)
for (const dir of ['src', 'public', 'node_modules/three/examples/jsm']) {
  if (!existsSync(path.join(root, dir)) || !statSync(path.join(root, dir)).isDirectory()) throw new Error(`Missing required source-seal tree: ${dir}`)
}
if (process.argv.includes('--preflight')) {
  const bad = uniquePaths.filter((relative) => !statSync(path.join(root, relative)).isFile())
  if (bad.length) throw new Error(`Required source-seal paths are not files: ${bad.join(', ')}`)
  const mapCount = uniquePaths.filter((item) => /^src\/game\/cities\/[^/]+\/map\.ts$/.test(item)).length
  if (mapCount !== 40) throw new Error(`Preflight expected all 40 city maps; found ${mapCount}`)
  process.stdout.write(JSON.stringify({ status: 'SOURCE_SEAL_PREFLIGHT_OK_NO_HASHING_NO_WRITE', requiredFiles: uniquePaths.length, cityMapSourceCount: mapCount, recipeVersion: 'sofa-integrated-v5' }) + '\n')
  process.exit(0)
}
const files = []
for (const relative of uniquePaths) {
  const absolute = path.join(root, relative)
  files.push({ path: relative, bytes: statSync(absolute).size, sha256: await hashFile(absolute) })
}
const maps = files.filter(item => /^src\/game\/cities\/[^/]+\/map\.ts$/.test(item.path)).length
if (maps !== 40) throw new Error(`Expected all 40 city map modules in the source seal, found ${maps}`)
const three = JSON.parse(await readFile(path.join(root, 'node_modules/three/package.json'), 'utf8'))
if (three.version !== '0.180.0') throw new Error(`Unexpected Three version ${three.version}`)
const payload = { schema: 'sofa-upholstery-v1-source-pins/3', status: 'PREBUILD_SEALED',
  gitCommit: process.env.GITHUB_SHA ?? null, threeVersion: three.version, cityMapSourceCount: maps,
  note: 'Diagnostic full graph: complete src/public/Three addon closure plus actual-host fixture, controls, candidate copies, tests, and package recipe. This is not a production or download-budget certificate.', files }
const bytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`)
await writeFile(path.join(fixture, 'source-pins-sofa-v1.json'), bytes, { flag: 'wx' })
process.stdout.write(JSON.stringify({ status: payload.status, fileCount: files.length, cityMapSourceCount: maps, sourcePinsSha256: sha(bytes) }) + '\n')
