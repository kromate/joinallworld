// Read-only publisher input snapshot: no build, install, network, or package emission.
import { createHash } from 'node:crypto'
import { createReadStream, statSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const fixture = 'evidence/graphics-loop/environment-next-phase-v6'
const output = path.join(root, fixture, 'root-publication-snapshot-v2.json')
const sha = data => createHash('sha256').update(data).digest('hex')
async function hashFile(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
async function filesUnder(relativeDir, relative = '') {
  const absolute = path.join(root, relativeDir, relative)
  const result = []
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name === 'node_modules') continue
    if (entry.isFile() && /^root-publication-snapshot-v\d+\.json$/.test(entry.name)) continue
    const next = path.posix.join(relative.split(path.sep).join('/'), entry.name)
    if (entry.isDirectory()) result.push(...await filesUnder(relativeDir, next))
    else if (entry.isFile()) result.push(path.posix.join(relativeDir, next))
    else throw new Error(`Refusing non-regular publisher input: ${path.join(absolute, entry.name)}`)
  }
  return result
}

const direct = [
  'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', '.nvmrc',
  ...await filesUnder(fixture),
]
const inputs = []
for (const dir of ['src', 'public', 'scripts', 'server', 'deploy', 'world']) {
  inputs.push(...await filesUnder(dir))
}
inputs.push(...direct)
const paths = [...new Set(inputs)].sort((a, b) => a.localeCompare(b))
const records = []
for (const relative of paths) {
  const file = path.resolve(root, relative)
  if (!file.startsWith(`${root}${path.sep}`)) throw new Error(`Publisher input escaped checkout: ${relative}`)
  records.push({ path: relative, bytes: statSync(file).size, sha256: await hashFile(file) })
}
const available = new Set(paths)
const existing = relative => {
  const candidates = [relative, ...['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.json', '.vue', '.css', '.glsl', '.vert', '.frag', '.wasm', '.glb', '.png', '.svg', '.webp', '.jpg', '.jpeg'].map(ext => `${relative}${ext}`),
    ...['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.json', '.vue'].map(ext => path.posix.join(relative, `index${ext}`))]
  return candidates.find(candidate => available.has(candidate)) ?? null
}
const importPattern = /^\s*(?:import|export)\b[^;\n]*?\bfrom\s*[\"']([^\"']+)[\"']|^\s*import\s*[\"']([^\"']+)[\"']|\bimport\s*\(\s*([\"'])([^\"']+)\3\s*\)/gm
const sourceFiles = paths.filter(file => {
  const sourceArea = file.startsWith('src/') || file.startsWith('scripts/') || file.startsWith('server/') || file.startsWith('deploy/') || file.startsWith(`${fixture}/`)
  return (file.startsWith('src/') || file.startsWith(`${fixture}/`)) && !/\.(?:test|spec)\.(?:ts|tsx|js|mjs)$/.test(file)
})
const unresolved = []
let relativeImportCount = 0
let cityMapImportCount = 0
const packageJson = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(root, 'package.json'), 'utf8'))
const mapTarget = packageJson.imports?.['#city-map/*']?.browser
if (mapTarget !== './src/game/cities/*/map.ts') throw new Error(`Unexpected production city-map alias: ${mapTarget}`)
for (const importer of sourceFiles) {
  if (!/\.(?:ts|tsx|mts|js|jsx|mjs|vue)$/.test(importer)) continue
  const raw = await (await import('node:fs/promises')).readFile(path.join(root, importer), 'utf8')
  const text = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  importPattern.lastIndex = 0
  for (let match; (match = importPattern.exec(text));) {
    const specifier = match[1] ?? match[2] ?? match[4]
    if (specifier.includes('${')) continue
    if (specifier.startsWith('#city-map/')) {
      cityMapImportCount++
      const city = specifier.slice('#city-map/'.length)
      const target = mapTarget.replace('*', city).replace(/^\.\//, '')
      if (!available.has(target)) unresolved.push({ importer, specifier, reason: 'city-map browser target missing' })
      continue
    }
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      relativeImportCount++
      const raw = specifier.split(/[?#]/, 1)[0]
      const target = existing(path.posix.normalize(path.posix.join(path.posix.dirname(importer), raw)))
      if (!target) unresolved.push({ importer, specifier, reason: 'relative target absent from pinned snapshot' })
    } else if (specifier.startsWith('/src/')) {
      relativeImportCount++
      const target = existing(specifier.slice(1))
      if (!target) unresolved.push({ importer, specifier, reason: 'absolute source alias target absent' })
    }
  }
}
if (unresolved.length) throw new Error(`Relative import resolution failed (${unresolved.length}): ${JSON.stringify(unresolved.slice(0, 20))}`)
const cityMaps = records.filter(item => /^src\/game\/cities\/[^/]+\/map\.ts$/.test(item.path)).length
if (cityMaps !== 40) throw new Error(`Expected all 40 city-map source modules, found ${cityMaps}`)
const payload = {
  schema: 'allworld-environment-v6-root-publication-snapshot/1',
  status: 'LOCAL_SOURCE_AND_DEPENDENCY_INPUTS_SEALED_NO_BUILD',
  scope: 'Complete primary src/public source plus repository scripts/server/deploy sources, v6 candidate/review/package recipe closure, and package/lock/config manifests. node_modules is intentionally excluded; dependency integrity is represented by the lockfile. Includes project-relative import resolution preflight. Does not certify compiled output, download size, runtime, or mobile performance.',
  dependencyPolicy: 'No node_modules files are included; dependency versions and integrity are pinned by package.json/package-lock.json.',
  counts: { totalFiles: records.length, sourceFiles: records.filter(item => item.path.startsWith('src/')).length,
    publicFiles: records.filter(item => item.path.startsWith('public/')).length, cityMapModules: cityMaps,
    recipeFiles: records.filter(item => item.path.startsWith(`${fixture}/package-recipe-v1/`)).length,
    relativeImportsResolved: relativeImportCount, cityMapImportsResolved: cityMapImportCount },
  files: records,
}
const bytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`)
writeFileSync(output, bytes, { flag: 'wx' })
process.stdout.write(JSON.stringify({ status: payload.status, counts: payload.counts, manifestSha256: sha(bytes), bytes: bytes.byteLength }) + '\n')
