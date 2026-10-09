import { createHash } from 'node:crypto'

const SHA256 = /^[a-f0-9]{64}$/u
const CITY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

export const C1_COMMIT = 'c1f7c1f7369139ce559292318ba9842c23a28267'
export const INVENTORY_SHA256 = '90c931e87b4758544e8de321ecb0bf3b41420cbbf9aeb504b66b93c6938c2e0b'
export const C1_BASELINE_KEYS = ['catalogue', 'loaders', 'routes', 'catalogueSource'] as const
export type C1BaselineKey = typeof C1_BASELINE_KEYS[number]
export interface C1BaselinePin { readonly path: string; readonly bytes: number; readonly sha256: string }
export const C1_BASELINE_PINS: Readonly<Record<C1BaselineKey, C1BaselinePin>> = Object.freeze({
  catalogue: Object.freeze({ path: 'src/game/cities/catalogue.generated.ts', bytes: 3692, sha256: '88a49bd6230cfe7da918ef808e2df5ee087524bb5f725570bda96697f13b531b' }),
  loaders: Object.freeze({ path: 'src/game/cities/loaders.generated.ts', bytes: 2962, sha256: 'c9a3a7255c8aee9ef2137f0a24d610de0a4c540e3f7298ac8d62370c6e98eb21' }),
  routes: Object.freeze({ path: 'src/game/cities/routes.generated.ts', bytes: 8088, sha256: '334b0a83bcc69dc4b347a3ab35b664b1cf2488e54257b4f66856c9278f48cd0c' }),
  catalogueSource: Object.freeze({ path: 'src/game/cities/catalogue.ts', bytes: 2494, sha256: 'e9307cc3625922a338c7534f96709001555c0b86ff54dad528db306c64260a03' }),
})

export type CatalogueRow = readonly [string, string, string, string, number, number, 0 | 1]
  | readonly [string, string, string, string, number, number, 0 | 1, string, string]
export type ForeignCityPin = Readonly<{ id: string; countryISO: string }>
export type AdmissionRow = Readonly<{
  id: string
  countryISO: string | null
  countryName?: string
  sourcePacket?: Readonly<{ path: string; sha256: string }>
}>
export interface RuntimeAdmissionManifest {
  readonly schemaVersion: 1
  readonly baseline: Readonly<{ c1Commit: string; files: Readonly<Record<C1BaselineKey, C1BaselinePin>> }>
  readonly inventorySha256: string
  readonly rows: readonly AdmissionRow[]
  readonly foreignCities: readonly ForeignCityPin[]
  readonly admissionSha256: string
}
export interface ValidatedAdmission {
  readonly manifest: RuntimeAdmissionManifest
  readonly foreignCities: readonly ForeignCityPin[]
  readonly admissionSha256: string
}
export interface DirectoryCity {
  readonly id: string
  readonly name: string
  readonly state: Readonly<{ id: string; name: string }>
  readonly countryISO?: string
  readonly countryName?: string
  readonly lon: number
  readonly lat: number
  readonly open: boolean
  readonly airport: boolean
}
export interface CountryDirectory {
  readonly index: Readonly<Record<string, unknown>>
  readonly indexContent: Buffer
  readonly indexSha256: string
  readonly indexPath: string
  readonly directories: readonly Readonly<{
    iso2: string
    name: string
    status: 'legacy' | 'accepted'
    path: string
    sha256: string
    bytes: number
    cityCount: number
    content: Buffer
  }>[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCatalogueRow(value: unknown): value is CatalogueRow {
  return Array.isArray(value) && (value.length === 7 || value.length === 9)
    && typeof value[0] === 'string' && CITY_ID.test(value[0])
    && typeof value[1] === 'string' && value[1].trim().length > 0
    && typeof value[2] === 'string' && value[2].trim().length > 0
    && typeof value[3] === 'string' && value[3].trim().length > 0
    && typeof value[4] === 'number' && Number.isFinite(value[4]) && value[4] >= -180 && value[4] <= 180
    && typeof value[5] === 'number' && Number.isFinite(value[5]) && value[5] >= -90 && value[5] <= 90
    && (value[6] === 0 || value[6] === 1)
    && (value.length === 7 || (typeof value[7] === 'string' && /^[a-z]{2}$/u.test(value[7]) && typeof value[8] === 'string'))
}

function isForeignPin(value: unknown): value is ForeignCityPin {
  return isRecord(value) && typeof value.id === 'string' && CITY_ID.test(value.id)
    && typeof value.countryISO === 'string' && /^[a-z]{2}$/u.test(value.countryISO)
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function stableJson(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value)}\n`, 'utf8')
}

export function parseC1CatalogueRows(source: string): readonly CatalogueRow[] {
  const rows: CatalogueRow[] = []
  for (const match of source.matchAll(/^  (\[.*\]),$/gm)) {
    const serialized = match[1]
    if (!serialized) throw new Error('could not parse a C1 catalogue row')
    let value: unknown
    try { value = JSON.parse(serialized) }
    catch { throw new TypeError('C1 catalogue contains invalid JSON row data') }
    if (!isCatalogueRow(value)) throw new TypeError('C1 catalogue row has an unsupported shape')
    rows.push(value)
  }
  return Object.freeze(rows)
}

function parseAdmissionManifest(value: unknown): RuntimeAdmissionManifest {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.baseline)
      || value.baseline.c1Commit !== C1_COMMIT || !isRecord(value.baseline.files)
      || value.inventorySha256 !== INVENTORY_SHA256 || !Array.isArray(value.rows)
      || !Array.isArray(value.foreignCities) || typeof value.admissionSha256 !== 'string' || !SHA256.test(value.admissionSha256)) {
    throw new TypeError('runtime admission manifest does not match the reviewed C1 and inventory pins')
  }
  if (Object.keys(value.baseline.files).length !== C1_BASELINE_KEYS.length) throw new Error('runtime admission must pin exactly the four immutable C1 source files')
  for (const key of C1_BASELINE_KEYS) {
    const rawPin = value.baseline.files[key]
    const expected = C1_BASELINE_PINS[key]
    if (!isRecord(rawPin) || rawPin.path !== expected.path || rawPin.bytes !== expected.bytes || rawPin.sha256 !== expected.sha256) {
      throw new Error(`runtime admission ${key} baseline pin differs from the immutable C1 identity`)
    }
  }
  const baselineFiles: Readonly<Record<C1BaselineKey, C1BaselinePin>> = Object.freeze({
    catalogue: C1_BASELINE_PINS.catalogue,
    loaders: C1_BASELINE_PINS.loaders,
    routes: C1_BASELINE_PINS.routes,
    catalogueSource: C1_BASELINE_PINS.catalogueSource,
  })
  const rows: AdmissionRow[] = []
  for (const raw of value.rows) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !CITY_ID.test(raw.id)) throw new TypeError('runtime admission row has an invalid city ID')
    if (raw.countryISO === null) {
      if (Object.hasOwn(raw, 'countryName') || Object.hasOwn(raw, 'sourcePacket')) throw new TypeError(`Nigeria row ${raw.id} must keep its C1 metadata shape`)
      rows.push(Object.freeze({ id: raw.id, countryISO: null }))
      continue
    }
    if (typeof raw.countryISO !== 'string' || !/^[a-z]{2}$/u.test(raw.countryISO)
        || typeof raw.countryName !== 'string' || !raw.countryName.trim()) throw new TypeError(`foreign row ${raw.id} needs ISO and country name`)
    if (raw.sourcePacket !== undefined) {
      if (!isRecord(raw.sourcePacket) || typeof raw.sourcePacket.path !== 'string' || !raw.sourcePacket.path.trim()
          || !/^world\/playable-africa-rollout\/batches\/[a-z0-9]+(?:-[a-z0-9]+)*\.json$/u.test(raw.sourcePacket.path)
          || typeof raw.sourcePacket.sha256 !== 'string' || !SHA256.test(raw.sourcePacket.sha256)) {
        throw new TypeError(`extension row ${raw.id} source packet pin is malformed`)
      }
      rows.push(Object.freeze({ id: raw.id, countryISO: raw.countryISO, countryName: raw.countryName,
        sourcePacket: Object.freeze({ path: raw.sourcePacket.path, sha256: raw.sourcePacket.sha256 }) }))
    } else rows.push(Object.freeze({ id: raw.id, countryISO: raw.countryISO, countryName: raw.countryName }))
  }
  const foreignCities: ForeignCityPin[] = []
  for (const raw of value.foreignCities) {
    if (!isForeignPin(raw)) throw new TypeError('foreign admission entry is malformed')
    foreignCities.push(Object.freeze({ id: raw.id, countryISO: raw.countryISO }))
  }
  return Object.freeze({
    schemaVersion: 1,
    baseline: Object.freeze({ c1Commit: C1_COMMIT, files: Object.freeze(baselineFiles) }),
    inventorySha256: INVENTORY_SHA256,
    rows: Object.freeze(rows), foreignCities: Object.freeze(foreignCities),
    admissionSha256: value.admissionSha256,
  })
}

/** Validate the reviewed current admission against the immutable C1 catalogue rows. */
export function validateRuntimeAdmission(value: unknown, baselineRows: readonly CatalogueRow[]): ValidatedAdmission {
  const manifest = parseAdmissionManifest(value)
  if (baselineRows.length !== 50 || manifest.rows.length < baselineRows.length) throw new Error('runtime admission must preserve the complete 50-row C1 catalogue prefix')
  const ids = new Set<string>()
  const foreign: ForeignCityPin[] = []
  for (let index = 0; index < manifest.rows.length; index += 1) {
    const pin = manifest.rows[index]
    if (!pin || ids.has(pin.id)) throw new Error(`runtime admission row ${index} has an invalid or duplicate city ID`)
    ids.add(pin.id)
    if (index < baselineRows.length) {
      const row = baselineRows[index]
      if (!row || pin.id !== row[0]) throw new Error(`runtime admission row ${index} is invalid or out of C1 order`)
      if (row.length === 7) {
        if (pin.countryISO !== null || pin.countryName !== undefined || pin.sourcePacket !== undefined) throw new Error(`Nigeria row ${row[0]} must keep its original country-metadata shape`)
      } else {
        const countryISO = row[7]
        const countryName = row[8]
        if (pin.countryISO !== countryISO || pin.countryName !== countryName || pin.sourcePacket !== undefined) throw new Error(`foreign row ${row[0]} country identity differs from C1`)
        foreign.push(Object.freeze({ id: row[0], countryISO }))
      }
    } else {
      if (!pin.countryISO || !pin.countryName || !pin.sourcePacket) throw new Error(`extension row ${pin.id} needs an explicit country identity and reviewed source-packet SHA-256`)
      foreign.push(Object.freeze({ id: pin.id, countryISO: pin.countryISO }))
    }
  }
  if (baselineRows.filter((row) => row.length === 7).length !== 40) throw new Error('Nigeria admission must preserve all 40 C1 rows in their original positions')
  if (foreign.length !== manifest.foreignCities.length || foreign.some((entry, index) => {
    const expected = manifest.foreignCities[index]
    return !expected || entry.id !== expected.id || entry.countryISO !== expected.countryISO
  })) throw new Error('foreign admission list must exactly match ordered C1 and explicitly pinned extension rows')
  const admissionSha256 = sha256(stableJson(foreign))
  if (admissionSha256 !== manifest.admissionSha256) throw new Error('runtime admission SHA-256 does not match its canonical ordered foreign allowlist')
  return Object.freeze({ manifest, foreignCities: Object.freeze(foreign), admissionSha256 })
}

/** Build metadata-only shards for the exact already-open C1 and explicitly admitted catalogue rows. */
export function buildCountryDirectory({ cities, admissionSha256 }: { cities: readonly DirectoryCity[]; admissionSha256: string }): CountryDirectory {
  if (cities.length < 50 || cities.length > 10_000 || !SHA256.test(admissionSha256)) throw new TypeError('C1 cities, bounded explicit extensions, and the reviewed admission hash are required')
  const countries = new Map<string, { iso2: string; name: string; status: 'legacy' | 'accepted'; cities: DirectoryCity[] }>()
  const cityIds = new Set<string>()
  for (const city of cities) {
    const expectedKeys = city.countryISO
      ? ['id', 'name', 'state', 'countryISO', 'countryName', 'lon', 'lat', 'open', 'airport']
      : ['id', 'name', 'state', 'lon', 'lat', 'open', 'airport']
    if (!isRecord(city) || JSON.stringify(Object.keys(city)) !== JSON.stringify(expectedKeys)
        || !CITY_ID.test(city.id) || typeof city.name !== 'string' || !city.name.trim()
        || !isRecord(city.state) || JSON.stringify(Object.keys(city.state)) !== JSON.stringify(['id', 'name'])
        || typeof city.state.id !== 'string' || !city.state.id.trim() || typeof city.state.name !== 'string' || !city.state.name.trim()
        || !Number.isFinite(city.lon) || !Number.isFinite(city.lat) || typeof city.open !== 'boolean' || typeof city.airport !== 'boolean'
        || (city.countryISO !== undefined && (!/^[a-z]{2}$/u.test(city.countryISO) || typeof city.countryName !== 'string' || !city.countryName.trim()))) {
      throw new TypeError('country directory city must contain only exact CityCatalogueEntry metadata fields')
    }
    if (cityIds.has(city.id)) throw new Error(`duplicate country directory city ID ${city.id}`)
    cityIds.add(city.id)
    const iso2 = city.countryISO ? city.countryISO.toUpperCase() : 'NG'
    const name = city.countryISO ? city.countryName : 'Nigeria'
    if (!name) throw new TypeError(`country name is missing for ${city.id}`)
    const existing = countries.get(iso2)
    if (existing && existing.name !== name) throw new Error(`country name conflict for ${iso2}`)
    const status = iso2 === 'NG' ? 'legacy' : 'accepted'
    const country = existing ?? { iso2, name, status, cities: [] }
    if (country.status !== status) throw new Error(`country status conflict for ${iso2}`)
    country.cities.push(city)
    countries.set(iso2, country)
  }
  if (countries.size > 64 || countries.get('NG')?.cities.length !== 40) throw new Error('directory must preserve 40 Nigeria cities and remain within the 64-country limit')

  const directories = [...countries.values()].sort((a, b) => a.iso2 < b.iso2 ? -1 : a.iso2 > b.iso2 ? 1 : 0).map((entry) => {
    const body = {
      schemaVersion: 1,
      country: { iso2: entry.iso2, name: entry.name, status: entry.status },
      cities: entry.cities,
      containsGeometry: false,
      containsRules: false,
      containsContent: false,
      containsTravelEdges: false,
    }
    const content = stableJson(body)
    if (content.byteLength > 128 * 1024) throw new RangeError(`${entry.iso2} metadata shard exceeds 128 KiB`)
    const hash = sha256(content)
    return Object.freeze({ iso2: entry.iso2, name: entry.name, status: entry.status,
      path: `countries/${entry.iso2.toLowerCase()}-${hash}.json`, sha256: hash,
      bytes: content.byteLength, cityCount: entry.cities.length, content })
  })
  const index = {
    schemaVersion: 1,
    source: { c1Commit: C1_COMMIT, inventorySha256: INVENTORY_SHA256, admissionSha256 },
    legacy: { countryISO: 'ng', countryName: 'Nigeria', directoryPreservesAllCatalogueRows: true },
    countries: directories.map(({ iso2, name, status, path, sha256: hash, bytes, cityCount }) => ({ iso2, name, status, path, sha256: hash, bytes, cityCount })),
  }
  const indexContent = stableJson(index)
  if (indexContent.byteLength > 128 * 1024) throw new RangeError('country directory index exceeds 128 KiB')
  if (indexContent.byteLength + directories.reduce((sum, entry) => sum + entry.bytes, 0) > 512 * 1024) throw new RangeError('country directory exceeds the 512 KiB total raw metadata limit')
  const indexSha256 = sha256(indexContent)
  return Object.freeze({ index, indexContent, indexSha256, indexPath: `index-${indexSha256}.json`, directories: Object.freeze(directories) })
}
