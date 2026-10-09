// Seal full production/public inputs, the actual-host fixture and its control/runner closure.
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const fixture = path.join(root, 'evidence/graphics-loop/environment-next-phase-v7')
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
const candidateNames = ['candidate-build.ts', 'candidate-home-scene.ts', 'candidate-neighbourhood-scene.ts', 'candidate-venue-scenes.ts', 'candidate-world.ts']
const fixtureNames = [
  'README.md', 'index.html', 'viewer.ts', 'readiness-protocol-v6.mjs', 'readiness-protocol-v6.d.mts',
  'readiness-protocol-v6.test.mjs', ...candidateNames,
]
const controlNames = ['scope-plan-v5.mjs', 'scope-plan-v5.test.mjs', 'remote-control-v5.mjs', 'remote-control-v5.test.mjs']
const recipeNames = [
  'README.md', 'REMOTE-REVIEW-NOTES.md', 'workflow-package-v1.yml', 'run-bounded-linux-package-v1.py',
  'phase-common-v7.mjs', 'seal-source-pins-v7.mjs', 'verify-source-pins-v7.mjs', 'compile-vendor-v7.mjs',
  'compile-addons-v7.mjs', 'compile-app-v7.mjs', 'seal-compiled-output-v7.mjs', 'seal-finalizer-v7.mjs',
  'finalize-package-v7.mjs', 'prepare-review-host-v7.mjs', 'serve-review-host-v7.py',
].map(name => `evidence/graphics-loop/environment-next-phase-v7/package-recipe-v3/${name}`)
const renderRecipeNames = [
  'review-render-cdp-v5.mjs', 'run-bounded-linux-render-v5.py', 'result-dir-contract-v5.mjs',
  'test-result-dir-contract-v5.mjs', 'package-selection-v5.mjs', 'test-package-selection-v5.mjs',
  'test-runner-contract-v5.py', 'workflow-review-v5.yml', 'seal-review-sources-v5.mjs',
  'review-sources-v5.json',
].map(name => `evidence/graphics-loop/environment-next-phase-v7/remote-review-v5/recipe/${name}`)
const direct = [
  'package.json', 'package-lock.json', 'node_modules/three/package.json', 'node_modules/three/build/three.core.js', 'node_modules/three/build/three.module.js',
  ...fixtureNames.map(name => `evidence/graphics-loop/environment-next-phase-v7/${name}`),
  ...controlNames.map(name => `evidence/graphics-loop/environment-next-phase-v7/remote-review-v5/${name}`),
  ...recipeNames, ...renderRecipeNames,
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
  process.stdout.write(JSON.stringify({ status: 'SOURCE_SEAL_PREFLIGHT_OK_NO_HASHING_NO_WRITE', requiredFiles: uniquePaths.length, cityMapSourceCount: mapCount, recipeVersion: 3 }) + '\n')
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
const payload = { schema: 'environment-next-phase-v7-source-pins/3', status: 'PREBUILD_SEALED',
  gitCommit: process.env.GITHUB_SHA ?? null, threeVersion: three.version, cityMapSourceCount: maps,
  note: 'Diagnostic full graph: complete src/public/Three addon closure plus actual-host fixture, controls, candidate copies, tests, and package recipe. This is not a production or download-budget certificate.', files }
const bytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`)
await writeFile(path.join(fixture, 'source-pins-v7.json'), bytes, { flag: 'wx' })
process.stdout.write(JSON.stringify({ status: payload.status, fileCount: files.length, cityMapSourceCount: maps, sourcePinsSha256: sha(bytes) }) + '\n')
