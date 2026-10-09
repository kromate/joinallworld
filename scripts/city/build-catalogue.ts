import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { CityLink, CityModule } from '../../src/types/content.ts'
import { buildCountryDirectory, C1_BASELINE_KEYS, C1_BASELINE_PINS, C1_COMMIT, INVENTORY_SHA256, parseC1CatalogueRows, sha256, validateRuntimeAdmission } from './runtime-admission.ts'
import type { AdmissionRow, C1BaselineKey, CatalogueRow, DirectoryCity } from './runtime-admission.ts'

const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '../..'))
const citiesDir = join(root, 'src/game/cities')
const cataloguePath = join(citiesDir, 'catalogue.generated.ts')
const loadersPath = join(citiesDir, 'loaders.generated.ts')
const routesPath = join(citiesDir, 'routes.generated.ts')
const rolloutDir = join(root, 'world/playable-africa-rollout')
const admissionPath = join(rolloutDir, 'runtime-admission.json')
const generatedNigeriaPath = join(citiesDir, 'nigeria-catalogue.generated.ts')
const generatedForeignAdmissionPath = join(citiesDir, 'foreign-admission.generated.ts')
const generatedForeignLoadersPath = join(citiesDir, 'foreign-loaders.generated.ts')
const generatedDirectoryDescriptorPath = join(citiesDir, 'country-directory.generated.ts')
const generatedTrustedFactsPath = join(citiesDir, 'trusted-city-facts.generated.ts')
const publicDirectory = join(root, 'public/world-country-directory')
const check = process.argv.includes('--check')

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const unknownArray = (value: unknown): value is unknown[] => Array.isArray(value)
const isCityModule = (value: unknown): value is CityModule => record(value)
  && typeof value.id === 'string'
  && record(value.rules)
  && value.rules.id === value.id
  && typeof value.loadContent === 'function'
  && typeof value.loadMap === 'function'

const C1_SNAPSHOT_PATHS: Readonly<Record<C1BaselineKey, string>> = Object.freeze({
  catalogue: 'world/playable-africa-rollout/runtime-baseline/c1/catalogue.generated.ts.txt',
  loaders: 'world/playable-africa-rollout/runtime-baseline/c1/loaders.generated.ts.txt',
  routes: 'world/playable-africa-rollout/runtime-baseline/c1/routes.generated.ts.txt',
  catalogueSource: 'world/playable-africa-rollout/runtime-baseline/c1/catalogue.ts.txt',
})
type C1SnapshotKey = C1BaselineKey

function readC1Snapshot(key: C1SnapshotKey): string {
  const pin = C1_BASELINE_PINS[key]
  const bytes = readBoundedPinnedFile(C1_SNAPSHOT_PATHS[key], pin.bytes)
  if (bytes.byteLength !== pin.bytes || sha256(bytes) !== pin.sha256) throw new Error(`immutable C1 source snapshot failed its fixed ${key} pin`)
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw new TypeError(`immutable C1 source snapshot is not valid UTF-8: ${key}`) }
}

interface FilePin { path: string; bytes: number; sha256: string }

function readBoundedPinnedFile(pathInRepo: string, limit: number): Buffer {
  if (!pathInRepo || pathInRepo.includes('\\') || pathInRepo.startsWith('/') || pathInRepo.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new TypeError(`source pin path is not normalized and repository-relative: ${pathInRepo}`)
  }
  if (typeof constants.O_NOFOLLOW !== 'number') throw new Error('O_NOFOLLOW is required to verify extension source pins')
  const filename = resolve(root, pathInRepo)
  const relativePath = relative(root, filename)
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) throw new Error('extension source pin escaped the repository root')
  let current = root
  const rootStat = lstatSync(current)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || realpathSync(root) !== root) throw new Error('repository root must be a canonical real directory')
  const segments = relativePath.split(/[\\/]/u)
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    if (!segment) throw new Error('source pin contains an empty path component')
    current = join(current, segment)
    const info = lstatSync(current)
    if (info.isSymbolicLink() || (index < segments.length - 1 && !info.isDirectory())) throw new Error(`source pin traverses a symlink or non-directory: ${pathInRepo}`)
  }
  const descriptor = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const initial = fstatSync(descriptor)
    if (!initial.isFile() || initial.size < 0 || initial.size > limit) throw new RangeError(`source pin is not a bounded regular file: ${pathInRepo}`)
    const content = Buffer.alloc(initial.size)
    let offset = 0
    while (offset < content.length) {
      const count = readSync(descriptor, content, offset, content.length - offset, offset)
      if (count <= 0) throw new Error(`source pin changed while reading: ${pathInRepo}`)
      offset += count
    }
    const final = fstatSync(descriptor)
    if (initial.dev !== final.dev || initial.ino !== final.ino || initial.size !== final.size) throw new Error(`source pin changed while reading: ${pathInRepo}`)
    return content
  } finally { closeSync(descriptor) }
}

function requireFilePin(value: unknown, label: string, maximumBytes: number): FilePin {
  if (!record(value) || typeof value.path !== 'string' || typeof value.bytes !== 'number' || !Number.isSafeInteger(value.bytes)
      || value.bytes < 0 || value.bytes > maximumBytes || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.sha256)) {
    throw new TypeError(`${label} is not a valid bounded source pin`)
  }
  return { path: value.path, bytes: value.bytes, sha256: value.sha256 }
}

function parsePinnedJson(bytes: Buffer, label: string): unknown {
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw new TypeError(`${label} is not valid UTF-8`) }
  try { return JSON.parse(text) }
  catch { throw new TypeError(`${label} is not valid JSON`) }
}

function verifyExtensionSourcePackets(rows: readonly AdmissionRow[]): ReadonlySet<string> {
  const verified = new Set<string>()
  const cityAssetNames = ['facts.ts', 'geometry.ts', 'index.ts', 'content.ts', 'map.ts'] as const
  for (const row of rows) {
    if (!row.countryISO || !row.sourcePacket) throw new Error(`extension ${row.id} has no source packet pin`)
    let totalBytesRead = 0
    const packetPin = { path: row.sourcePacket.path, sha256: row.sourcePacket.sha256 }
    const packetBytes = readBoundedPinnedFile(packetPin.path, 256 * 1024)
    totalBytesRead += packetBytes.byteLength
    if (sha256(packetBytes) !== packetPin.sha256) throw new Error(`extension packet SHA-256 mismatch: ${packetPin.path}`)
    const parsedPacket = parsePinnedJson(packetBytes, `extension packet ${packetPin.path}`)
    if (!record(parsedPacket) || parsedPacket.schemaVersion !== 1 || !unknownArray(parsedPacket.destinationIds)
        || parsedPacket.destinationIds.length > 64 || !unknownArray(parsedPacket.sourceFiles) || parsedPacket.sourceFiles.length > 128
        || parsedPacket.destinationIds.some((id) => typeof id !== 'string') || !parsedPacket.destinationIds.includes(row.id)) {
      throw new Error(`extension packet does not declare ${row.id} in its destination IDs and source pins`)
    }
    const receiptPath = `world/playable-africa-rollout/receipts/${row.id}.json`
    const packetPins = new Map<string, FilePin>()
    for (const value of parsedPacket.sourceFiles) {
      const pin = requireFilePin(value, `${row.id} packet source file`, 8 * 1024 * 1024)
      if (packetPins.has(pin.path)) throw new Error(`extension packet repeats source pin ${pin.path}`)
      packetPins.set(pin.path, pin)
    }
    const receiptPin = packetPins.get(receiptPath)
    if (!receiptPin) throw new Error(`extension packet does not pin ${receiptPath}`)
    const receiptBytes = readBoundedPinnedFile(receiptPin.path, 256 * 1024)
    totalBytesRead += receiptBytes.byteLength
    if (receiptBytes.byteLength !== receiptPin.bytes || sha256(receiptBytes) !== receiptPin.sha256) throw new Error(`extension receipt pin mismatch: ${receiptPin.path}`)
    const parsedReceipt = parsePinnedJson(receiptBytes, `extension receipt ${receiptPin.path}`)
    if (!record(parsedReceipt) || parsedReceipt.cityId !== row.id || parsedReceipt.countryIso2 !== row.countryISO.toUpperCase() || !record(parsedReceipt.assets)) {
      throw new Error(`extension receipt identity differs from its explicit admission row: ${row.id}`)
    }
    for (const assetName of cityAssetNames) {
      const assetPath = `src/game/cities/${row.id}/${assetName}`
      const packetAssetPin = packetPins.get(assetPath)
      const rawReceiptAssetPin = parsedReceipt.assets[assetName]
      if (!record(rawReceiptAssetPin)) throw new Error(`extension receipt omits the ${assetName} asset pin`)
      const receiptAssetPin = requireFilePin({ ...rawReceiptAssetPin, path: assetPath }, `${row.id} receipt asset ${assetName}`, 8 * 1024 * 1024)
      if (!packetAssetPin || packetAssetPin.bytes !== receiptAssetPin.bytes || packetAssetPin.sha256 !== receiptAssetPin.sha256) {
        throw new Error(`extension packet and receipt asset pins disagree for ${assetPath}`)
      }
      if (totalBytesRead + packetAssetPin.bytes > 16 * 1024 * 1024) throw new RangeError(`extension source verification exceeds its 16 MiB total read limit: ${row.id}`)
      const content = readBoundedPinnedFile(assetPath, 8 * 1024 * 1024)
      totalBytesRead += content.byteLength
      if (content.byteLength !== packetAssetPin.bytes || sha256(content) !== packetAssetPin.sha256) throw new Error(`extension asset pin mismatch: ${assetPath}`)
    }
    verified.add(row.id)
  }
  return verified
}

const admissionInput: unknown = JSON.parse(readFileSync(admissionPath, 'utf8'))
const baselineCatalogueText = readC1Snapshot('catalogue')
const baselineLoadersText = readC1Snapshot('loaders')
const baselineRoutesText = readC1Snapshot('routes')
const baselineCatalogueSourceText = readC1Snapshot('catalogueSource')
const admission = validateRuntimeAdmission(admissionInput, parseC1CatalogueRows(baselineCatalogueText))
const manifest = admission.manifest
for (const key of C1_BASELINE_KEYS) {
  const expected = C1_BASELINE_PINS[key]
  const pin = manifest.baseline.files[key]
  if (pin.path !== expected.path || pin.bytes !== expected.bytes || pin.sha256 !== expected.sha256) throw new Error(`runtime admission ${key} baseline pin differs from its immutable C1 snapshot identity`)
}
const baselineRows = parseC1CatalogueRows(baselineCatalogueText)
const ordered = manifest.rows.map((row) => row.id)
const verifiedExtensions = verifyExtensionSourcePackets(manifest.rows.slice(baselineRows.length))

interface DiscoveredCity { id: string; exportName: string; rules: CityModule['rules'] }
const cities: DiscoveredCity[] = []
for (const folder of ordered) {
  if (manifest.rows.findIndex((row) => row.id === folder) >= baselineRows.length && !verifiedExtensions.has(folder)) throw new Error(`extension ${folder} was not source-packet verified`)
  if (!existsSync(join(citiesDir, folder, 'index.ts'))) throw new Error(`admitted city module is missing: ${folder}/index.ts`)
  const namespace: unknown = await import(pathToFileURL(join(citiesDir, folder, 'index.ts')).href)
  if (!record(namespace)) throw new Error(`${folder}/index.ts did not export a module namespace`)
  const found = Object.entries(namespace).find((entry): entry is [string, CityModule] => isCityModule(entry[1]) && entry[1].id === folder)
  if (!found) throw new Error(`${folder}/index.ts must export one CityModule whose id matches its folder`)
  cities.push({ id: folder, exportName: found[0], rules: found[1].rules })
}

const rowById = new Map<string, CatalogueRow>()
for (const row of baselineRows) rowById.set(row[0], row)
for (const row of manifest.rows.slice(baselineRows.length)) {
  const module = cities.find((city) => city.id === row.id)
  if (!module || typeof row.countryISO !== 'string' || typeof row.countryName !== 'string'
      || module.rules.country.id !== row.countryISO || module.rules.country.name !== row.countryName) {
    throw new Error(`explicit extension ${row.id} does not match its selected module country identity`)
  }
  const rules = module.rules
  const derived = [module.id, rules.name, rules.state.id, rules.state.name, rules.atlas.lon, rules.atlas.lat, rules.hubs.some((hub) => hub.mode === 'air') ? 1 : 0, row.countryISO, row.countryName] as const
  rowById.set(row.id, derived)
}
for (let index = 0; index < baselineRows.length; index += 1) {
  const row = baselineRows[index]
  const module = cities[index]
  if (!row || !module) throw new Error('C1 catalogue row and module ordering differ')
  const rules = module.rules
  const moduleCountryMatches = row.length === 9
    ? rules.country.id === row[7] && rules.country.name === row[8]
    : (rules.country.id === 'ng' || rules.country.id === 'nigeria') && rules.country.name === 'Nigeria'
  if (rules.name !== row[1] || rules.state.id !== row[2] || rules.state.name !== row[3]
      || rules.atlas.lon !== row[4] || rules.atlas.lat !== row[5]
      || Number(rules.hubs.some((hub) => hub.mode === 'air')) !== row[6]
      || !moduleCountryMatches) {
    throw new Error(`current module ${module.id} differs from its pinned C1 catalogue row`)
  }
}

const quote = (value: string): string => JSON.stringify(value)
const catalogueLines = cities.map(({ id, rules }) => {
  const country = rules.country.id === 'ng' || rules.country.id === 'nigeria' ? '' : `,${quote(rules.country.id)},${quote(rules.country.name)}`
  return `  [${quote(id)},${quote(rules.name)},${quote(rules.state.id)},${quote(rules.state.name)},${rules.atlas.lon},${rules.atlas.lat},${rules.hubs.some((hub) => hub.mode === 'air') ? 1 : 0}${country}],`
})
const catalogueRows = catalogueLines.join('\n')
const catalogue = `// Generated by scripts/city/build-catalogue.ts. Do not add cities here by hand.\nimport type { CityCatalogueRow } from './catalogue.ts'\n\nexport const GENERATED_CITY_CATALOGUE_ROWS = Object.freeze([\n${catalogueRows}\n] satisfies readonly CityCatalogueRow[])\n`

const loaderLines = cities.map(({ id, exportName }) => `  async()=>(await import(${quote(`./${id}/index.ts`)})).${exportName},`)
const loaderRows = loaderLines.join('\n')
const loaders = `// Generated by scripts/city/build-catalogue.ts. Do not add cities here by hand.\nimport type { CityModuleLoader } from './catalogue.ts'\n\nexport const GENERATED_CITY_LOADERS = Object.freeze([\n${loaderRows}\n] satisfies readonly CityModuleLoader[])\n`

for (let index = 0; index < cities.length; index += 1) {
  const bytes = Buffer.byteLength((catalogueLines[index] ?? '').trim()) + Buffer.byteLength((loaderLines[index] ?? '').trim())
  if (bytes > 150) throw new Error(`${cities[index]?.id ?? `City ${index}`} adds ${bytes} raw catalogue bytes; keep its id, labels, or module export compact (limit 150)`)
}

const links = new Map<string, CityLink>()
for (const city of cities) for (const link of city.rules.links) {
  const key = `${[link.a, link.b].sort().join('|')}|${link.mode}`
  const existing = links.get(key)
  if (existing && JSON.stringify(existing) !== JSON.stringify(link)) throw new Error(`Conflicting city link ${key}`)
  links.set(key, link)
}
const routeJson = JSON.stringify([...links.values()], null, 2).replace(/^/gm, '  ')
const routes = `// Generated by scripts/city/build-catalogue.ts. Do not add routes here by hand.\nimport type { CityLink } from '../../types/content.ts'\n\nexport const AUTHORED_CITY_LINKS = Object.freeze(${routeJson.trimStart()} satisfies readonly CityLink[])\n`

const catalogueCityEntries: DirectoryCity[] = cities.map(({ id, rules }) => {
  const row = rowById.get(id)
  if (!row) throw new Error(`admitted city ${id} has no explicit row`)
  const foreign = row.length === 9
  return {
    id, name: rules.name,
    state: { id: rules.state.id, name: rules.state.name },
    ...(foreign ? { countryISO: String(row[7]), countryName: String(row[8]) } : {}),
    lon: rules.atlas.lon, lat: rules.atlas.lat, open: true,
    airport: rules.hubs.some((hub) => hub.mode === 'air'),
  }
})
const nigeriaCities = catalogueCityEntries.filter((city) => city.countryISO === undefined)
const foreignCities = catalogueCityEntries.filter((city) => city.countryISO !== undefined)
const foreignTrustedFactsLines = foreignCities.map((city) => `  ${JSON.stringify([city.id, city.name, 'foreign', city.countryISO, city.lon, city.lat, city.airport ? 1 : 0])},`).join('\n')
const trustedCityFacts = `// Generated from validated admitted city modules. No HTTP data supplies routing authority.\nimport { NIGERIA_CITY_CATALOGUE_ROWS } from './nigeria-catalogue.generated.ts'\n\nexport type TrustedCityFactsRow = readonly [id: string, name: string, source: 'nigeria' | 'foreign', countryId: string, lon: number, lat: number, airport: 0 | 1]\n\nconst FOREIGN_TRUSTED_CITY_FACTS = [\n${foreignTrustedFactsLines}\n] satisfies readonly TrustedCityFactsRow[]\n\nexport const TRUSTED_CITY_FACTS_ROWS: readonly TrustedCityFactsRow[] = Object.freeze([\n  ...NIGERIA_CITY_CATALOGUE_ROWS.map(([id, name, , , lon, lat, airport]) => Object.freeze([id, name, 'nigeria', 'ng', lon, lat, airport] as const)),\n  ...FOREIGN_TRUSTED_CITY_FACTS.map((row) => Object.freeze(row)),\n])\n`
const nigeriaCityLines = nigeriaCities.map((city) => {
  const row = rowById.get(city.id)
  if (!row || row.length !== 7) throw new Error(`Nigeria city ${city.id} must retain its original seven-field C1 row`)
  return `  ${JSON.stringify(row)},`
}).join('\n')
const nigeriaLoaderLines = cities.filter(({ id }) => nigeriaCities.some((city) => city.id === id)).map(({ id, exportName }) => `  ${quote(id)}: async()=>(await import(${quote(`./${id}/index.ts`)})).${exportName},`).join('\n')
const nigeriaCatalogue = `// Generated from the reviewed Africa runtime admission.\nimport type { CityCatalogueEntry, CityCatalogueRow, CityModuleLoader } from './catalogue.ts'\n\nexport const NIGERIA_CITY_CATALOGUE_ROWS = Object.freeze([\n${nigeriaCityLines}\n] satisfies readonly CityCatalogueRow[])\n\nexport const NIGERIA_CITY_CATALOGUE: readonly CityCatalogueEntry[] = Object.freeze(NIGERIA_CITY_CATALOGUE_ROWS.map(([id, name, stateId, stateName, lon, lat, airport]) => Object.freeze({\n  id, name, state: Object.freeze({ id: stateId, name: stateName }), lon, lat, open: true, airport: airport === 1,\n})))\n\nexport const NIGERIA_CITY_LOADERS: Readonly<Record<string, CityModuleLoader>> = Object.freeze({\n${nigeriaLoaderLines}\n})\n`
const foreignAdmissionLines = admission.foreignCities.map(({ id, countryISO }) => `  Object.freeze({ id: ${quote(id)}, countryISO: ${quote(countryISO)} }),`).join('\n')
const foreignAdmission = `// Generated from the reviewed Africa runtime admission.\nexport const FOREIGN_ADMITTED_CITIES = Object.freeze([\n${foreignAdmissionLines}\n] as const)\n`
const foreignLoaderLines = cities.filter(({ id }) => foreignCities.some((city) => city.id === id)).map(({ id, exportName }) => `  ${quote(id)}: async()=>(await import(${quote(`./${id}/index.ts`)})).${exportName},`).join('\n')
const foreignLoaders = `// Generated from the reviewed Africa runtime admission.\nimport type { CityModuleLoader } from './catalogue.ts'\n\nexport const FOREIGN_CITY_LOADERS: Readonly<Record<string, CityModuleLoader>> = Object.freeze({\n${foreignLoaderLines}\n})\n`
const directory = buildCountryDirectory({ cities: catalogueCityEntries, admissionSha256: admission.admissionSha256 })
const directoryDescriptor = `// Generated by scripts/city/build-catalogue.ts. Do not edit by hand.\nexport const COUNTRY_DIRECTORY_DESCRIPTOR = Object.freeze({\n  baseUrl: '/world-country-directory/',\n  indexPath: ${quote(directory.indexPath)},\n  indexSha256: ${quote(directory.indexSha256)},\n  admissionSha256: ${quote(admission.admissionSha256)},\n  c1Commit: ${quote(C1_COMMIT)},\n  inventorySha256: ${quote(INVENTORY_SHA256)},\n} as const)\n`

const baselineOnly = manifest.rows.length === baselineRows.length
if (baselineOnly) {
  const baselineCities = cities.slice(0, baselineRows.length)
  const baselineCatalogueLines = baselineCities.map(({ id, rules }) => {
    const row = rowById.get(id) ?? []
    const country = row.length === 9 ? `,${quote(String(row[7]))},${quote(String(row[8]))}` : ''
    return `  [${quote(id)},${quote(rules.name)},${quote(rules.state.id)},${quote(rules.state.name)},${rules.atlas.lon},${rules.atlas.lat},${rules.hubs.some((hub) => hub.mode === 'air') ? 1 : 0}${country}],`
  }).join('\n')
  const baselineLoaderLines = baselineCities.map(({ id, exportName }) => `  async()=>(await import(${quote(`./${id}/index.ts`)})).${exportName},`).join('\n')
  if (sha256(Buffer.from(`${catalogue.split('export const GENERATED_CITY_CATALOGUE_ROWS')[0]}export const GENERATED_CITY_CATALOGUE_ROWS = Object.freeze([\n${baselineCatalogueLines}\n] satisfies readonly CityCatalogueRow[])\n`)) !== sha256(Buffer.from(baselineCatalogueText))
      || sha256(Buffer.from(`${loaders.split('export const GENERATED_CITY_LOADERS')[0]}export const GENERATED_CITY_LOADERS = Object.freeze([\n${baselineLoaderLines}\n] satisfies readonly CityModuleLoader[])\n`)) !== sha256(Buffer.from(baselineLoadersText))) {
    throw new Error('current Nigeria/foreign catalogue or loader serialization differs from immutable C1')
  }
  const baselineLinks = new Map<string, CityLink>()
  for (const city of baselineCities) for (const link of city.rules.links) {
    const key = `${[link.a, link.b].sort().join('|')}|${link.mode}`
    const existing = baselineLinks.get(key)
    if (existing && JSON.stringify(existing) !== JSON.stringify(link)) throw new Error(`Conflicting C1 city link ${key}`)
    baselineLinks.set(key, link)
  }
  const baselineRouteJson = JSON.stringify([...baselineLinks.values()], null, 2).replace(/^/gm, '  ')
  const baselineRoutes = `// Generated by scripts/city/build-catalogue.ts. Do not add routes here by hand.\nimport type { CityLink } from '../../types/content.ts'\n\nexport const AUTHORED_CITY_LINKS = Object.freeze(${baselineRouteJson.trimStart()} satisfies readonly CityLink[])\n`
  if (baselineRoutes !== baselineRoutesText) throw new Error('current C1 route serialization differs from immutable C1')
}

const outputs: Array<readonly [string, string]> = [
  [cataloguePath, catalogue], [loadersPath, loaders], [routesPath, routes],
  [generatedNigeriaPath, nigeriaCatalogue], [generatedForeignAdmissionPath, foreignAdmission],
  [generatedForeignLoadersPath, foreignLoaders], [generatedDirectoryDescriptorPath, directoryDescriptor],
  [generatedTrustedFactsPath, trustedCityFacts],
  [join(publicDirectory, directory.indexPath), directory.indexContent.toString('utf8')],
  ...directory.directories.map((entry) => [join(publicDirectory, entry.path), entry.content.toString('utf8')] as const),
]
let stale = false
for (const [path, text] of outputs) {
  if (existsSync(path) && readFileSync(path, 'utf8') === text) continue
  stale = true
  if (!check) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  }
  else console.error(`${relative(root, path)} is stale; run npm run cities:catalogue`)
}
if (check && stale) process.exitCode = 1
else if (!check) console.log(`City catalogue generated for ${cities.length} open cities.`)
