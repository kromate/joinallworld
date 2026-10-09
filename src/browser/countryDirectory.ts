import type { CityCatalogueEntry } from '../game/cities/catalogue.ts'
import {
  COUNTRY_DIRECTORY_LIMITS,
  openHttpCountryDirectory,
  type CountryDirectoryDescriptor,
  type CountryDirectoryIndexEntry,
  type CountryDirectoryReader,
  type CountryDirectoryReaderOptions,
} from './countryDirectoryHttp.ts'

export interface AdmittedForeignCity {
  readonly id: string
  /** Lowercase ISO-2, matching CityCatalogueEntry.countryISO. */
  readonly countryISO: string
}

export interface RuntimeCountryDirectoryConfig {
  readonly descriptor: CountryDirectoryDescriptor
  /** Exact generated order; SHA-256 of JSON.stringify(list) plus LF matches admissionSha256. */
  readonly admittedForeignCities: readonly AdmittedForeignCity[]
  /** The unchanged 40-row Nigeria catalogue already available in the bootstrap bundle. */
  readonly nigeriaCatalogue: readonly CityCatalogueEntry[]
}

export interface RuntimeCountryDirectoryOptions {
  readonly fetchImpl?: typeof fetch
  readonly maxResidentBytes?: number
  readonly signal?: AbortSignal
}

export interface RuntimeCountryDirectory {
  /** Source metadata only. This method does not grant runtime admission or change city status. */
  countries(): readonly CountryDirectoryIndexEntry[]
  /** Nigeria is already in the bootstrap catalogue; foreign rows load only when requested. */
  prepareCountry(iso2: string, options?: { readonly signal?: AbortSignal }): Promise<readonly CityCatalogueEntry[]>
  /** Prepares needed countries serially and returns the requested rows in input order. */
  prepareCities(ids: readonly string[], options?: { readonly signal?: AbortSignal }): Promise<readonly CityCatalogueEntry[]>
  /** Returns static Nigeria or a previously prepared foreign row; unprepared rows return null. */
  getCatalogue(id: string): CityCatalogueEntry | null
  dispose(): void
  readonly counters: CountryDirectoryReader['counters']
}

const CITY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const LOWER_ISO2 = /^[a-z]{2}$/u
const MAX_FOREIGN_COUNTRIES = COUNTRY_DIRECTORY_LIMITS.countryCount - 1
const MAX_ADMITTED_FOREIGN_CITIES = 2048
const NIGERIA_CITY_COUNT = 40
const TOTAL_COUNTRY_COUNT = (count: number): number => count + 1
const CITY_KEYS = new Set(['id', 'name', 'state', 'countryISO', 'countryName', 'lon', 'lat', 'open', 'airport'])
const STATE_KEYS = new Set(['id', 'name'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key))
}

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string`)
  return value
}

function assertFinite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be finite`)
  return value
}

function assertSignal(signal: AbortSignal | undefined): void {
  if (signal !== undefined && (!signal || typeof signal.addEventListener !== 'function' || typeof signal.aborted !== 'boolean')) {
    throw new TypeError('signal must be an AbortSignal')
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
}

function validateAdmission(pairs: readonly AdmittedForeignCity[]): Map<string, string[]> {
  if (pairs.length < 1) throw new RangeError('runtime admission must contain at least one foreign city')
  if (pairs.length > MAX_ADMITTED_FOREIGN_CITIES) throw new RangeError('runtime admission exceeds its city identity limit')
  const byCountry = new Map<string, string[]>()
  const seenIds = new Set<string>()
  for (const pair of pairs) {
    if (!isRecord(pair) || !hasExactKeys(pair, new Set(['id', 'countryISO']))) {
      throw new TypeError('foreign admission entries must contain exactly id and countryISO')
    }
    const id = assertNonEmptyString(pair.id, 'admitted city id')
    const iso2 = assertNonEmptyString(pair.countryISO, `${id}.countryISO`)
    if (!CITY_ID.test(id) || !LOWER_ISO2.test(iso2) || iso2 === 'ng' || seenIds.has(id)) {
      throw new Error('foreign admission contains an invalid or duplicate city identity')
    }
    seenIds.add(id)
    const cityIds = byCountry.get(iso2) ?? []
    cityIds.push(id)
    byCountry.set(iso2, cityIds)
  }
  if (byCountry.size > MAX_FOREIGN_COUNTRIES) throw new RangeError('runtime admission exceeds the country directory limit')
  return byCountry
}

async function verifyAdmissionHash(pairs: readonly AdmittedForeignCity[], expectedSha256: string): Promise<void> {
  const stablePairs = pairs.map(({ id, countryISO }) => ({ id, countryISO }))
  const bytes = new TextEncoder().encode(`${JSON.stringify(stablePairs)}\n`)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  const actual = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  if (actual !== expectedSha256) throw new Error('foreign admission list does not match its pinned SHA-256')
}

function validateNigeriaCatalogue(rows: readonly CityCatalogueEntry[]): Map<string, CityCatalogueEntry> {
  if (rows.length !== NIGERIA_CITY_COUNT) throw new Error(`static Nigeria catalogue must preserve all ${NIGERIA_CITY_COUNT} rows`)
  const byId = new Map<string, CityCatalogueEntry>()
  for (const row of rows) {
    if (!row || typeof row !== 'object' || !CITY_ID.test(row.id) || byId.has(row.id)
        || !assertNonEmptyString(row.name, 'Nigeria city name')
        || !row.state || !assertNonEmptyString(row.state.id, 'Nigeria state id')
        || !assertNonEmptyString(row.state.name, 'Nigeria state name')
        || !Number.isFinite(row.lon) || row.lon < -180 || row.lon > 180
        || !Number.isFinite(row.lat) || row.lat < -90 || row.lat > 90
        || typeof row.open !== 'boolean' || typeof row.airport !== 'boolean'
        || row.countryISO !== undefined || row.countryName !== undefined) {
      throw new Error('static Nigeria catalogue row is invalid or foreign-qualified')
    }
    byId.set(row.id, row)
  }
  return byId
}

function validateForeignCatalogueRow(value: unknown, expectedId: string, iso2: string, countryName: string): CityCatalogueEntry {
  if (!isRecord(value) || !hasExactKeys(value, CITY_KEYS)) throw new TypeError('country shard city row has an unsupported catalogue shape')
  if (value.id !== expectedId || typeof value.id !== 'string' || !CITY_ID.test(value.id)) throw new Error('country shard city ID differs from the compact admission')
  const name = assertNonEmptyString(value.name, `${expectedId}.name`)
  if (!isRecord(value.state) || !hasExactKeys(value.state, STATE_KEYS)) throw new TypeError(`${expectedId}.state has an unsupported catalogue shape`)
  const stateId = assertNonEmptyString(value.state.id, `${expectedId}.state.id`)
  const stateName = assertNonEmptyString(value.state.name, `${expectedId}.state.name`)
  const lon = assertFinite(value.lon, `${expectedId}.lon`)
  const lat = assertFinite(value.lat, `${expectedId}.lat`)
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) throw new RangeError(`${expectedId} coordinates are outside WGS84 bounds`)
  if (value.open !== true || typeof value.airport !== 'boolean' || value.countryISO !== iso2 || value.countryName !== countryName) {
    throw new Error(`${expectedId} row country or catalogue status differs from its admitted directory`)
  }
  const state = Object.freeze({ id: stateId, name: stateName })
  return Object.freeze({
    id: expectedId,
    name,
    state,
    countryISO: iso2,
    countryName,
    lon,
    lat,
    open: true,
    airport: value.airport,
  })
}

function validateIndexCountrySet(
  index: CountryDirectoryReader['index'],
  expected: ReadonlyMap<string, readonly string[]>,
): void {
  const totalCountryCount = TOTAL_COUNTRY_COUNT(expected.size)
  if (index.countries.length !== totalCountryCount) throw new Error(`directory must contain exactly ${totalCountryCount} admitted countries`)
  const expectedCountries = new Set(['ng', ...expected.keys()])
  const actualCountries = new Set(index.countries.map((entry) => entry.iso2.toLowerCase()))
  if (actualCountries.size !== totalCountryCount || [...expectedCountries].some((iso2) => !actualCountries.has(iso2))) {
    throw new Error('country directory index country set differs from static and compact admission')
  }
  for (const entry of index.countries) {
    const iso2 = entry.iso2.toLowerCase()
    if (iso2 === 'ng') {
      if (entry.name !== 'Nigeria' || entry.status !== 'legacy' || entry.cityCount !== NIGERIA_CITY_COUNT) {
        throw new Error('Nigeria directory index entry differs from the preserved baseline')
      }
    } else if (entry.status !== 'accepted' || entry.cityCount !== expected.get(iso2)?.length) {
      throw new Error(`${iso2} directory city count differs from compact admission`)
    }
  }
}

export async function openRuntimeCountryDirectory(
  config: RuntimeCountryDirectoryConfig,
  options: RuntimeCountryDirectoryOptions = {},
): Promise<RuntimeCountryDirectory> {
  const admittedByCountry = validateAdmission(config.admittedForeignCities)
  const nigeriaById = validateNigeriaCatalogue(config.nigeriaCatalogue)
  for (const id of nigeriaById.keys()) {
    if (config.admittedForeignCities.some((pair) => pair.id === id)) throw new Error(`foreign admission duplicates Nigeria city ${id}`)
  }
  await verifyAdmissionHash(config.admittedForeignCities, config.descriptor.admissionSha256)
  const expectedForeignIds = new Map<string, string>()
  for (const [iso2, ids] of admittedByCountry) for (const id of ids) expectedForeignIds.set(id, iso2)
  const readerOptions: CountryDirectoryReaderOptions = {
    maxResidentBytes: options.maxResidentBytes ?? COUNTRY_DIRECTORY_LIMITS.residentBytes,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    expectedC1Commit: config.descriptor.c1Commit,
    expectedInventorySha256: config.descriptor.inventorySha256,
    expectedAdmissionSha256: config.descriptor.admissionSha256,
  }
  const reader: CountryDirectoryReader = await openHttpCountryDirectory(config.descriptor, readerOptions)
  try {
    validateIndexCountrySet(reader.index, admittedByCountry)
    const loaded = new Map<string, readonly CityCatalogueEntry[]>()
    const loadedById = new Map<string, CityCatalogueEntry>()
    const ensureOpen = (): void => { if (disposed) throw new Error('runtime country directory is disposed') }
    const pruneLoaded = (): void => {
      const resident = new Set(reader.cachedCountryISOs())
      for (const [iso2, rows] of loaded) {
        if (resident.has(iso2)) continue
        loaded.delete(iso2)
        for (const row of rows) {
          if (loadedById.get(row.id) === row) loadedById.delete(row.id)
        }
      }
    }
    let disposed = false
    const prepareCountry = async (iso2: string, requestOptions: { readonly signal?: AbortSignal } = {}): Promise<readonly CityCatalogueEntry[]> => {
      assertSignal(requestOptions.signal)
      throwIfAborted(requestOptions.signal)
      ensureOpen()
      if (!LOWER_ISO2.test(iso2)) throw new TypeError('country ISO-2 must be lowercase')
      if (iso2 === 'ng') return Object.freeze([...config.nigeriaCatalogue])
      const expectedIds = admittedByCountry.get(iso2)
      if (!expectedIds) throw new RangeError(`country is not admitted: ${iso2}`)
      const shard = await reader.getCountryDirectory(iso2, requestOptions)
      ensureOpen()
      throwIfAborted(requestOptions.signal)
      pruneLoaded()
      const existing = loaded.get(iso2)
      if (existing) return existing
      if (shard.cities.length !== expectedIds.length) throw new Error(`${iso2} shard has missing or extraneous city rows`)
      const indexEntry = reader.index.countries.find((entry) => entry.iso2.toLowerCase() === iso2)
      if (!indexEntry) throw new Error(`${iso2} is missing from the verified country index`)
      const rows = shard.cities.map((row, index) => {
        const expectedId = expectedIds[index]
        if (expectedId === undefined) throw new Error(`${iso2} shard has an extraneous city row`)
        return validateForeignCatalogueRow(row, expectedId, iso2, indexEntry.name)
      })
      const rowIds = new Set(rows.map((row) => row.id))
      if (rowIds.size !== expectedIds.length) throw new Error(`${iso2} shard contains duplicate city rows`)
      const frozenRows = Object.freeze(rows)
      if (reader.cachedCountryISOs().includes(iso2)) {
        loaded.set(iso2, frozenRows)
        for (const row of frozenRows) loadedById.set(row.id, row)
      }
      return frozenRows
    }
    const prepareCities = async (ids: readonly string[], requestOptions: { readonly signal?: AbortSignal } = {}): Promise<readonly CityCatalogueEntry[]> => {
      assertSignal(requestOptions.signal)
      throwIfAborted(requestOptions.signal)
      ensureOpen()
      const requested = new Set<string>()
      const countriesToPrepare = new Set<string>()
      for (const id of ids) {
        if (requested.has(id)) throw new Error(`duplicate city request: ${id}`)
        requested.add(id)
        if (nigeriaById.has(id)) continue
        const countryISO = expectedForeignIds.get(id)
        if (!countryISO) throw new RangeError(`city is not admitted: ${id}`)
        countriesToPrepare.add(countryISO)
      }
      const preparedById = new Map<string, CityCatalogueEntry>()
      for (const iso2 of countriesToPrepare) {
        throwIfAborted(requestOptions.signal)
        const rows = await prepareCountry(iso2, requestOptions)
        for (const row of rows) preparedById.set(row.id, row)
      }
      throwIfAborted(requestOptions.signal)
      ensureOpen()
      return Object.freeze(ids.map((id) => {
        const nigeria = nigeriaById.get(id)
        if (nigeria) return nigeria
        const foreign = preparedById.get(id)
        if (!foreign) throw new Error(`admitted city was not published after preparation: ${id}`)
        return foreign
      }))
    }
    const getCatalogue = (id: string): CityCatalogueEntry | null => {
      ensureOpen()
      pruneLoaded()
      return nigeriaById.get(id) ?? loadedById.get(id) ?? null
    }
    const countries = (): readonly CountryDirectoryIndexEntry[] => {
      ensureOpen()
      return reader.countries()
    }
    const dispose = (): void => {
      if (disposed) return
      disposed = true
      loaded.clear()
      loadedById.clear()
      reader.dispose()
    }
    return Object.freeze({ countries, prepareCountry, prepareCities, getCatalogue, dispose,
      get counters() { if (!disposed) pruneLoaded(); return reader.counters } })
  } catch (error) {
    reader.dispose()
    throw error
  }
}
