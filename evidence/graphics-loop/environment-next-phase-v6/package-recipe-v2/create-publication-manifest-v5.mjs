// Seal publish inputs only. No build, install, network, node_modules, generated source pin, or runtime output.
import { createHash } from 'node:crypto'
import { createReadStream, statSync, writeFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const fixture = 'evidence/graphics-loop/environment-next-phase-v6'
const recipe = `${fixture}/package-recipe-v2`
const reviewer = `${fixture}/remote-review-v3`
const reviewerV2 = `${fixture}/remote-review-v2`
const output = path.join(root, recipe, 'publication-manifest-v5.json')
const sha = (data) => createHash('sha256').update(data).digest('hex')
async function hashFile(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
async function filesUnder(relativeDir, relative = '') {
  const absolute = path.join(root, relativeDir, relative)
  const result = []
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    const next = path.posix.join(relative.split(path.sep).join('/'), entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || /^downloaded(?:-|$)/.test(entry.name) || entry.name === 'results' || entry.name === 'remote-results') continue
      result.push(...await filesUnder(relativeDir, next))
    } else if (entry.isFile()) {
      if ((/^(?:source-pins-v6|publication-manifest-v\d+|root-publication-snapshot-v\d+)\.json$/.test(entry.name) || new Set(['download.log','download-receipt.json','publication.json','push.log','push-receipt.json','push-required.log','push-required-receipt.json','root-required-publication-files.json','root-actual-artifact-review.json']).has(entry.name) || entry.name.endsWith('.log'))) continue
      result.push(path.posix.join(relativeDir, next))
    } else throw new Error(`Refusing non-regular publisher input: ${path.join(absolute, entry.name)}`)
  }
  return result
}
const direct = [
  'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json', '.nvmrc',
  ...['README.md', 'candidate-build.ts', 'candidate-home-scene.ts', 'candidate-neighbourhood-scene.ts', 'candidate-venue-scenes.ts',
    'candidate-world.ts', 'index.html', 'readiness-protocol-v6.d.mts', 'readiness-protocol-v6.mjs', 'readiness-protocol-v6.test.mjs', 'viewer.ts']
    .map(name => `${fixture}/${name}`),
]
const inputs = []
for (const dir of ['src', 'public', 'world', 'scripts', 'server', 'deploy', recipe, reviewerV2, reviewer]) inputs.push(...await filesUnder(dir))
inputs.push(...direct, '.github/workflows/graphics-environment-next-phase-v6-render-review-v3.yml')
const paths = [...new Set(inputs)].sort((a, b) => a.localeCompare(b))
const records = []
for (const relative of paths) {
  const file = path.resolve(root, relative)
  if (!file.startsWith(`${root}${path.sep}`)) throw new Error(`Publisher input escaped root: ${relative}`)
  const info = statSync(file)
  if (!info.isFile()) throw new Error(`Publisher input is not a file: ${relative}`)
  records.push({ path: relative, bytes: info.size, sha256: await hashFile(file) })
}
const available = new Set(paths)
const extensions = ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.json', '.vue', '.css', '.glsl', '.vert', '.frag', '.wasm', '.glb', '.png', '.svg', '.webp', '.jpg', '.jpeg']
function existing(base) {
  const candidates = [base, ...extensions.map(ext => `${base}${ext}`), ...['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.json', '.vue'].map(ext => path.posix.join(base, `index${ext}`))]
  return candidates.find(candidate => available.has(candidate)) ?? null
}
const importPattern = /^\s*(?:import|export)\b[^;\n]*?\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']|\bimport\s*\(\s*(["'])([^"']+)\3\s*\)/gm
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const mapTarget = packageJson.imports?.['#city-map/*']?.browser
if (mapTarget !== './src/game/cities/*/map.ts') throw new Error(`Unexpected #city-map browser map: ${mapTarget}`)
const unresolved = []
let relativeImportsResolved = 0
let cityMapImportsResolved = 0
for (const importer of paths) {
  if (!/\.(?:ts|tsx|mts|js|jsx|mjs|vue)$/.test(importer) || /\.(?:test|spec)\.(?:ts|tsx|js|mjs)$/.test(importer)) continue
  if (!(importer.startsWith('src/') || importer.startsWith(`${recipe}/`) || importer.startsWith(`${reviewerV2}/`) || importer.startsWith(`${reviewer}/`) || importer.startsWith(`${fixture}/`))) continue
  let text = (await readFile(path.join(root, importer), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  importPattern.lastIndex = 0
  for (let match; (match = importPattern.exec(text));) {
    const specifier = match[1] ?? match[2] ?? match[4]
    if (specifier.includes('${')) continue
    if (specifier.startsWith('#city-map/')) {
      cityMapImportsResolved++
      const target = mapTarget.replace('*', specifier.slice('#city-map/'.length)).replace(/^\.\//, '')
      if (!available.has(target)) unresolved.push({ importer, specifier, reason: 'city map target missing' })
    } else if (specifier.startsWith('/src/')) {
      relativeImportsResolved++
      if (!existing(specifier.slice(1))) unresolved.push({ importer, specifier, reason: 'absolute source alias target missing' })
    } else if (specifier.startsWith('./') || specifier.startsWith('../')) {
      relativeImportsResolved++
      const target = existing(path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier.split(/[?#]/, 1)[0])) )
      if (!target) unresolved.push({ importer, specifier, reason: 'relative import target missing' })
    }
  }
}
if (unresolved.length) throw new Error(`Source closure preflight failed (${unresolved.length}): ${JSON.stringify(unresolved.slice(0, 20))}`)
const cityMapModules = records.filter(item => /^src\/game\/cities\/[^/]+\/map\.ts$/.test(item.path)).length
if (cityMapModules !== 40) throw new Error(`Expected all 40 city maps; found ${cityMapModules}`)
const payload = {
  schema: 'allworld-environment-v6-package-v2-render-v3-publication-inputs/3',
  status: 'SOURCE_PUBLICATION_INPUTS_SEALED_NO_BUILD',
  scope: 'Complete src/public/world/scripts/server/deploy source closure, v6 actual-host candidate and fixture, package-recipe-v2, remote-review-v2, package/lock and build config. Excludes node_modules, source-pins-v6.json, build outputs, downloaded/results and prior publication snapshots. Dependency integrity is represented by package-lock.json; this manifest is not a compiled package or release/mobile certificate.',
  counts: { files: records.length, bytes: records.reduce((sum, item) => sum + item.bytes, 0), sourceFiles: records.filter(item => item.path.startsWith('src/')).length,
    publicFiles: records.filter(item => item.path.startsWith('public/')).length, cityMapModules, relativeImportsResolved, cityMapImportsResolved },
  files: records,
}
const bytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`)
writeFileSync(output, bytes, { flag: 'wx' })
process.stdout.write(JSON.stringify({ status: payload.status, counts: payload.counts, manifestPath: path.relative(root, output), manifestSha256: sha(bytes) }) + '\n')
