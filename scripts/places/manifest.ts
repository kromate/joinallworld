// Builds the place-model manifests the game reads, from the packer's reports (Node 22+, run with --experimental-strip-types).
//
//   node --experimental-strip-types scripts/places/manifest.ts [--out scripts/places/out] [--city abuja,lagos] [--merge] [--no-stage] [--no-atlas] [--check]
//
// For every <out>/<city>/<venueId>.json report whose status is "packed" it reads the three packed GLBs next to it, checks that each file
// exists and that its size, SHA-256 and GLB header are what the report says, and writes
//   scripts/places/manifest/<city>.json        committed: { schema: 'allworld-place-models', version: 1, city, atlas, venues }
//   src/scene/places/cities/<city>.ts          committed, generated: the same manifest as a lazy module (nothing enters the startup bundle)
//   src/scene/places/registry.generated.ts     committed, generated: city -> lazy import, for the cities that have a manifest
//   src/scene/places/atlas.generated.ts        committed, generated: the two atlas files (2048 and 1024)
//   public/assets/places/trim-<sha>.webp, trim-1024-<sha>.webp    the shared atlas, hashed (the 1024 one is made with cwebp)
// and, unless --no-stage, copies each packed GLB to <out>/store/<sha256>.glb: the folder the Node host serves (PLACES_DIR) and
// upload.ts reads. A venue absent from <out> is dropped from the manifest unless --merge keeps the committed entry.
// --check writes nothing and exits 1 when a committed file differs from what the current manifests and atlas would generate.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLACE_LOD_KEYS, parsePlaceManifest } from '../../src/scene/places/manifest.ts'
import type { PlaceLod, PlaceLodKey, PlaceManifest } from '../../src/scene/places/manifest.ts'

const here = dirname(fileURLToPath(import.meta.url))
export const REPO = resolve(here, '..', '..')
export const MANIFEST_DIR = join(here, 'manifest')
export const DEFAULT_OUT = join(here, 'out')
export const ATLAS_SOURCE = join(here, 'atlas', 'trim.webp')
export const PLACES_PUBLIC = join(REPO, 'public', 'assets', 'places')
export const RUNTIME_DIR = join(REPO, 'src', 'scene', 'places')
const NOT_CITIES = new Set(['fixture', 'store'])

export const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const readJson = (path: string): any => JSON.parse(readFileSync(path, 'utf8'))
const isGlb = (b: Uint8Array): boolean => b.length >= 20 && Buffer.from(b.buffer, b.byteOffset, 4).toString('latin1') === 'glTF' && new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(8, true) === b.length

export interface AtlasFiles { full: { url: string; sha256: string; size: 2048 }; small: { url: string; sha256: string; size: 1024 } }

/** The hash and file name of the shared atlas (and its 1024 variant, when it has been made). The 2048 hash is the source file's own. */
export function atlasOf(root = REPO): AtlasFiles {
  const source = readFileSync(join(root, 'scripts', 'places', 'atlas', 'trim.webp')), full = sha256Of(source)
  const dir = join(root, 'public', 'assets', 'places')
  const small = existsSync(dir) ? readdirSync(dir).find((f) => /^trim-1024-[0-9a-f]{64}\.webp$/.test(f)) : undefined
  return { full: { url: `/assets/places/trim-${full}.webp`, sha256: full, size: 2048 }, small: { url: small ? `/assets/places/${small}` : '', sha256: small ? small.slice(10, 74) : '', size: 1024 } }
}

/** Copies the 2048 atlas to its hashed name and makes the 1024 variant with cwebp. Removes older hashed atlases. Returns the files. */
export function writeAtlas(root = REPO, cwebp = process.env.CWEBP || 'cwebp'): AtlasFiles {
  const source = join(root, 'scripts', 'places', 'atlas', 'trim.webp'), dir = join(root, 'public', 'assets', 'places')
  const bytes = readFileSync(source), full = sha256Of(bytes), fullName = `trim-${full}.webp`
  mkdirSync(dir, { recursive: true })
  // cwebp is deterministic, so a rebuild of an unchanged atlas gives the same bytes and the same name. The scratch file stays out of public/.
  const scratch = mkdtempSync(join(tmpdir(), 'places-atlas-'))
  let smallName: string
  try {
    const tmp = join(scratch, 'small.webp')
    const run = spawnSync(cwebp, ['-quiet', '-resize', '1024', '1024', '-q', '88', '-m', '6', source, '-o', tmp], { encoding: 'utf8' })
    if (run.status !== 0) throw new Error(`cwebp failed (${run.error?.message ?? run.stderr}); install libwebp or set CWEBP`)
    const small = readFileSync(tmp)
    smallName = `trim-1024-${sha256Of(small)}.webp`
    writeFileSync(join(dir, smallName), small)
  } finally { rmSync(scratch, { recursive: true, force: true }) }
  writeFileSync(join(dir, fullName), bytes)
  for (const f of readdirSync(dir)) if (/^trim(?:-1024)?-[0-9a-f]{64}\.webp$/.test(f) && f !== fullName && f !== smallName) rmSync(join(dir, f))
  return atlasOf(root)
}

export interface BuildResult { manifest: PlaceManifest; skipped: { venueId: string; reason: string }[]; dropped: string[]; files: { sha256: string; path: string }[] }

/** One city's manifest from <out>/<city>/*.json. `previous` is the committed manifest (kept for absent venues only with `merge`). */
export function buildCityManifest(city: string, out: string, atlas: AtlasFiles, options: { merge?: boolean; previous?: PlaceManifest | null } = {}): BuildResult {
  const dir = join(out, city), venues: PlaceManifest['venues'] = {}, skipped: BuildResult['skipped'] = [], files: BuildResult['files'] = []
  const reports = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  for (const file of reports) {
    const venueId = file.slice(0, -5)
    let report: any
    try { report = readJson(join(dir, file)) } catch { skipped.push({ venueId, reason: 'unreadable report' }); continue }
    if (report.status !== 'packed') { skipped.push({ venueId, reason: `status ${report.status}` }); continue }
    if (report.city !== city || report.venueId !== venueId) { skipped.push({ venueId, reason: 'report names another city or venue' }); continue }
    const lods: Partial<Record<PlaceLodKey, PlaceLod>> = {}, found: BuildResult['files'] = []
    let problem = ''
    for (const key of PLACE_LOD_KEYS) {
      const p = report.packed?.[key]
      if (!p || typeof p.file !== 'string' || /[\\/]/.test(p.file)) { problem = `${key} not packed`; break }
      const path = join(dir, p.file)
      if (!existsSync(path)) { problem = `${key} file missing`; break }
      const bytes = readFileSync(path)
      if (!isGlb(bytes)) { problem = `${key} is not a GLB`; break }
      if (bytes.length !== p.bytes || sha256Of(bytes) !== p.sha256) { problem = `${key} differs from its report`; break }
      lods[key] = { sha256: p.sha256, bytes: p.bytes, brotliBytes: p.brotliBytes, triangles: p.triangles }
      found.push({ sha256: p.sha256, path })
    }
    if (problem) { skipped.push({ venueId, reason: problem }); continue }
    venues[venueId] = { archetype: report.archetype, lod0: lods.lod0!, lod1: lods.lod1!, lod2: lods.lod2! }
    files.push(...found)
  }
  const dropped: string[] = []
  for (const id of Object.keys(options.previous?.venues ?? {})) {
    if (venues[id]) continue
    if (options.merge) venues[id] = options.previous!.venues[id]!
    else dropped.push(id)
  }
  const sorted = Object.fromEntries(Object.keys(venues).sort().map((id) => [id, venues[id]!]))
  const manifest = parsePlaceManifest({ schema: 'allworld-place-models', version: 1, city, atlas: { url: atlas.full.url, sha256: atlas.full.sha256 }, venues: sorted }, city)
  return { manifest, skipped, dropped, files }
}

export const renderManifestJson = (manifest: PlaceManifest): string => `${JSON.stringify(manifest, null, 1)}\n`
export const renderCityModule = (manifest: PlaceManifest): string =>
  `// Generated by scripts/places/manifest.ts from scripts/places/manifest/${manifest.city}.json. Do not edit.\n// A lazy module: the game imports it only when a venue or the map of ${manifest.city} is shown.\nimport type { PlaceManifest } from '../manifest.ts'\n\nconst manifest: PlaceManifest = ${JSON.stringify(manifest)}\nexport default manifest\n`
export function renderRegistry(cities: readonly string[]): string {
  const rows = [...cities].sort().map((city) => `  '${city}': () => import('./cities/${city}.ts'),`).join('\n')
  return `// Generated by scripts/places/manifest.ts from scripts/places/manifest/*.json. Do not edit.\n// The cities that have place models, each a lazy import: nothing here is part of the startup bundle.\nimport type { PlaceManifest } from './manifest.ts'\n\nexport const PLACE_CITY_LOADERS: Readonly<Record<string, () => Promise<{ default: PlaceManifest }>>> = {\n${rows}\n}\n`
}
export const renderAtlasModule = (atlas: AtlasFiles): string =>
  `// Generated by scripts/places/manifest.ts from scripts/places/atlas/trim.webp. Do not edit.\n// The one shared atlas bound to every place model's material "trim": 2048 for capable devices, 1024 for Light mode and weak phones.\nexport const PLACE_ATLAS = ${JSON.stringify(atlas, null, 2)} as const\n`

function write(path: string, text: string, check: boolean, changed: string[]): void {
  const have = existsSync(path) ? readFileSync(path, 'utf8') : null
  if (have === text) return
  changed.push(path.replace(`${REPO}/`, ''))
  if (!check) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) }
}

export function main(argv = process.argv.slice(2)): number {
  const flag = (name: string): boolean => argv.includes(name)
  const value = (name: string): string | undefined => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
  const out = resolve(value('--out') ?? DEFAULT_OUT), check = flag('--check'), only = value('--city')?.split(',').filter(Boolean)
  const changed: string[] = []
  const atlas = check || flag('--no-atlas') ? atlasOf() : writeAtlas()
  if (!atlas.small.url) { console.error('The 1024 atlas is missing: run without --no-atlas / --check once (needs cwebp).'); return 1 }
  const committed = existsSync(MANIFEST_DIR) ? readdirSync(MANIFEST_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : []
  const fromOut = !check && existsSync(out) ? readdirSync(out, { withFileTypes: true }).filter((d) => d.isDirectory() && !NOT_CITIES.has(d.name) && /^[a-z][a-z0-9-]*$/.test(d.name) && (!only || only.includes(d.name))).map((d) => d.name) : []
  const manifests = new Map<string, PlaceManifest>()
  for (const city of committed) if (!fromOut.includes(city)) manifests.set(city, parsePlaceManifest(readJson(join(MANIFEST_DIR, `${city}.json`)), city))
  for (const city of fromOut) {
    const previous = existsSync(join(MANIFEST_DIR, `${city}.json`)) ? parsePlaceManifest(readJson(join(MANIFEST_DIR, `${city}.json`)), city) : null
    const built = buildCityManifest(city, out, atlas, { merge: flag('--merge'), previous })
    for (const s of built.skipped) console.log(`${city}/${s.venueId}: skipped (${s.reason})`)
    if (built.dropped.length) console.log(`${city}: dropped from the manifest (no packed report in ${out}): ${built.dropped.join(', ')}  (use --merge to keep them)`)
    if (!Object.keys(built.manifest.venues).length) { console.log(`${city}: no packed venues, nothing written`); continue }
    manifests.set(city, built.manifest)
    if (!flag('--no-stage') && !check) {
      const store = join(out, 'store'); mkdirSync(store, { recursive: true })
      for (const f of built.files) { const target = join(store, `${f.sha256}.glb`); if (!existsSync(target)) copyFileSync(f.path, target) }
    }
  }
  // An atlas change moves every manifest's atlas reference.
  for (const [city, m] of manifests) manifests.set(city, { ...m, atlas: { url: atlas.full.url, sha256: atlas.full.sha256 } })
  for (const [city, m] of manifests) {
    write(join(MANIFEST_DIR, `${city}.json`), renderManifestJson(m), check, changed)
    write(join(RUNTIME_DIR, 'cities', `${city}.ts`), renderCityModule(m), check, changed)
  }
  write(join(RUNTIME_DIR, 'registry.generated.ts'), renderRegistry([...manifests.keys()]), check, changed)
  write(join(RUNTIME_DIR, 'atlas.generated.ts'), renderAtlasModule(atlas), check, changed)
  // Generated city modules with no manifest left are stale.
  const cityModules = existsSync(join(RUNTIME_DIR, 'cities')) ? readdirSync(join(RUNTIME_DIR, 'cities')).filter((f) => f.endsWith('.ts')) : []
  for (const f of cityModules) if (!manifests.has(f.slice(0, -3))) { changed.push(`src/scene/places/cities/${f} (stale)`); if (!check) rmSync(join(RUNTIME_DIR, 'cities', f)) }
  for (const city of manifests.keys()) console.log(`${city}: ${Object.keys(manifests.get(city)!.venues).length} venues`)
  if (check) {
    if (changed.length) { console.error(`Place model files are out of date; run: node --experimental-strip-types scripts/places/manifest.ts\n  ${changed.join('\n  ')}`); return 1 }
    console.log('Place model files are current.')
  } else if (changed.length) console.log(`Wrote ${changed.length} file(s).`)
  return 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) process.exitCode = main()
