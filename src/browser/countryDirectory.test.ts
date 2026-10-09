import assert from 'node:assert/strict'
import { createHash, webcrypto } from 'node:crypto'
import { test } from 'node:test'
import type { CityCatalogueEntry } from './catalogue.ts'
import {
  openRuntimeCountryDirectory,
  type AdmittedForeignCity,
  type RuntimeCountryDirectoryConfig,
} from './countryDirectory.ts'
import type { CountryDirectoryDescriptor } from './countryDirectoryHttp.ts'

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })

const C1_COMMIT = 'c1f7c1f7369139ce559292318ba9842c23a28267'
const INVENTORY_SHA256 = '90c931e87b4758544e8de321ecb0bf3b41420cbbf9aeb504b66b93c6938c2e0b'
const encoder = new TextEncoder()
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const encode = (value: unknown): Uint8Array => encoder.encode(JSON.stringify(value))

function nigeriaRows(): readonly CityCatalogueEntry[] {
  return Object.freeze(Array.from({ length: 40 }, (_, index) => Object.freeze({
    id: index === 0 ? 'lagos' : `ng-city-${index}`,
    name: index === 0 ? 'Lagos' : `Nigeria City ${index}`,
    state: Object.freeze({ id: `ng-state-${index}`, name: `Nigeria State ${index}` }),
    lon: 3 + index / 100,
    lat: 6 + index / 100,
    open: true,
    airport: index === 0,
  })))
}

interface Fixture {
  readonly config: RuntimeCountryDirectoryConfig
  readonly routes: Map<string, Uint8Array>
  readonly calls: string[]
  readonly fetchImpl: typeof fetch
  readonly indexPath: string
  readonly shardPaths: ReadonlyMap<string, string>
}

function createFixture(
  admittedForeignCities: readonly AdmittedForeignCity[],
  mapCityRows: (iso2: string, rows: readonly Record<string, unknown>[]) => readonly unknown[] = (_iso2, rows) => rows,
  extraIndexCountry?: Readonly<{ iso2: string; name: string; status: string; cityCount: number }>,
  declaredCityCount: (iso2: string, actualCount: number) => number = (_iso2, actualCount) => actualCount,
): Fixture {
  const rowsByCountry = new Map<string, Record<string, unknown>[]>()
  for (const pair of admittedForeignCities) {
    const rows = rowsByCountry.get(pair.countryISO) ?? []
    rows.push({
      id: pair.id,
      name: `City ${pair.id}`,
      state: { id: `${pair.id}-state`, name: 'Starter district' },
      countryISO: pair.countryISO,
      countryName: `Country ${pair.countryISO.toUpperCase()}`,
      lon: 10 + rows.length / 100,
      lat: 20 + rows.length / 100,
      open: true,
      airport: rows.length === 0,
    })
    rowsByCountry.set(pair.countryISO, rows)
  }
  const nigeria = nigeriaRows()
  const allRows = new Map<string, readonly unknown[]>([['ng', nigeria.map((row) => ({ ...row }))]])
  for (const [iso2, rows] of rowsByCountry) allRows.set(iso2, mapCityRows(iso2, rows))
  const route = new Map<string, Uint8Array>()
  const shardPaths = new Map<string, string>()
  const indexCountries = [...allRows].map(([iso2, cities]) => {
    const isNigeria = iso2 === 'ng'
    const countryISO = iso2.toUpperCase()
    const name = isNigeria ? 'Nigeria' : `Country ${countryISO}`
    const status = isNigeria ? 'legacy' : 'accepted'
    const body = {
      schemaVersion: 1,
      country: { iso2: countryISO, name, status },
      cities,
      containsGeometry: false,
      containsRules: false,
      containsContent: false,
      containsTravelEdges: false,
    }
    const bytes = encode(body)
    const hash = sha(bytes)
    const path = `countries/${iso2}-${hash}.json`
    route.set(`/world-country-directory/${path}`, bytes)
    shardPaths.set(iso2, path)
    return { iso2: countryISO, name, status, path, sha256: hash, bytes: bytes.byteLength, cityCount: declaredCityCount(iso2, cities.length) }
  })
  if (extraIndexCountry) {
    const body = encode({ schemaVersion: 1, country: { iso2: extraIndexCountry.iso2, name: extraIndexCountry.name, status: extraIndexCountry.status }, cities: [], containsGeometry: false, containsRules: false, containsContent: false, containsTravelEdges: false })
    const hash = sha(body)
    const iso2 = extraIndexCountry.iso2.toLowerCase()
    const path = `countries/${iso2}-${hash}.json`
    route.set(`/world-country-directory/${path}`, body)
    indexCountries.push({ ...extraIndexCountry, path, sha256: hash, bytes: body.byteLength })
  }
  const admissionBytes = encoder.encode(`${JSON.stringify(admittedForeignCities.map(({ id, countryISO }) => ({ id, countryISO })))}\n`)
  const admissionSha256 = sha(admissionBytes)
  const indexBytes = encode({
    schemaVersion: 1,
    source: { c1Commit: C1_COMMIT, inventorySha256: INVENTORY_SHA256, admissionSha256 },
    legacy: { countryISO: 'ng', countryName: 'Nigeria', directoryPreservesAllCatalogueRows: true },
    countries: indexCountries,
  })
  const indexSha256 = sha(indexBytes)
  const indexPath = `index-${indexSha256}.json`
  route.set(`/world-country-directory/${indexPath}`, indexBytes)
  const descriptor: CountryDirectoryDescriptor = {
    // An absolute same-origin fixture URL keeps these tests portable in Node;
    // the generated browser descriptor uses the equivalent root-relative URL.
    baseUrl: 'https://game.example/world-country-directory/',
    indexPath,
    indexSha256,
    admissionSha256,
    c1Commit: C1_COMMIT,
    inventorySha256: INVENTORY_SHA256,
  }
  const calls: string[] = []
  const fetchImpl: typeof fetch = async (input) => {
    const url = input instanceof Request ? new URL(input.url) : new URL(input)
    calls.push(url.pathname)
    const bytes = route.get(url.pathname)
    return bytes ? new Response(bytes, { status: 200 }) : new Response('not found', { status: 404 })
  }
  return {
    config: { descriptor, admittedForeignCities, nigeriaCatalogue: nigeria },
    routes: route,
    calls,
    fetchImpl,
    indexPath: `/world-country-directory/${indexPath}`,
    shardPaths,
  }
}

const initialAdmissions: readonly AdmittedForeignCity[] = Object.freeze([
  { id: 'accra', countryISO: 'gh' },
  { id: 'algiers', countryISO: 'dz' },
  { id: 'lome', countryISO: 'tg' },
])

test('keeps Nigeria static and cold, then lazily loads and caches a verified foreign shard', async () => {
  const fixture = createFixture(initialAdmissions)
  const client = await openRuntimeCountryDirectory(fixture.config, { fetchImpl: fixture.fetchImpl })
  const lagos = fixture.config.nigeriaCatalogue[0]
  assert.equal(client.getCatalogue('lagos'), lagos)
  assert.equal(fixture.calls.length, 1)
  assert.equal(fixture.calls[0], fixture.indexPath)
  assert.equal(client.getCatalogue('accra'), null)
  const [accra] = await client.prepareCities(['accra'])
  assert.equal(accra?.id, 'accra')
  assert.equal(client.getCatalogue('accra'), accra)
  assert.equal(fixture.calls.length, 2)
  assert.equal(fixture.calls[1], `/world-country-directory/${fixture.shardPaths.get('gh')}`)
  assert.equal((await client.prepareCountry('ng'))[0], lagos)
  assert.equal(fixture.calls.length, 2)
  client.dispose()
  assert.equal(client.counters.residentRawBytes, 0)
  assert.equal(client.counters.pendingCountryReads, 0)
  assert.throws(() => client.getCatalogue('lagos'), /disposed/)
  await assert.rejects(client.prepareCountry('gh'), /disposed/)
})

test('supports an eleventh foreign row and multiple admitted cities in one country', async () => {
  const expanded = [
    ...initialAdmissions,
    { id: 'nairobi', countryISO: 'ke' },
    { id: 'yaounde', countryISO: 'cm' },
    { id: 'douala', countryISO: 'cm' },
    { id: 'abidjan', countryISO: 'ci' },
    { id: 'dakar', countryISO: 'sn' },
    { id: 'freetown', countryISO: 'sl' },
    { id: 'monrovia', countryISO: 'lr' },
    { id: 'addis-ababa', countryISO: 'et' },
  ] satisfies readonly AdmittedForeignCity[]
  assert.equal(expanded.length, 11)
  const fixture = createFixture(expanded)
  const client = await openRuntimeCountryDirectory(fixture.config, { fetchImpl: fixture.fetchImpl })
  assert.equal(client.getCatalogue('douala'), null)
  const rows = await client.prepareCities(['douala', 'yaounde'])
  assert.deepEqual(rows.map((row) => row.id), ['douala', 'yaounde'])
  assert.equal(fixture.calls.filter((path) => path.includes('/countries/')).length, 1)
  client.dispose()
})

test('prunes typed catalogue rows with the raw-shard LRU and reloads an evicted country', async () => {
  const fixture = createFixture(initialAdmissions)
  const indexBytes = fixture.routes.get(fixture.indexPath)
  const ghBytes = fixture.routes.get(`/world-country-directory/${fixture.shardPaths.get('gh')}`)
  const dzBytes = fixture.routes.get(`/world-country-directory/${fixture.shardPaths.get('dz')}`)
  assert.ok(indexBytes && ghBytes && dzBytes)
  const maxResidentBytes = indexBytes.byteLength + Math.max(ghBytes.byteLength, dzBytes.byteLength)
  const client = await openRuntimeCountryDirectory(fixture.config, { fetchImpl: fixture.fetchImpl, maxResidentBytes })

  await client.prepareCountry('gh')
  assert.equal(client.getCatalogue('accra')?.id, 'accra')
  const callsAfterFirstLoad = fixture.calls.length
  await client.prepareCountry('gh')
  assert.equal(fixture.calls.length, callsAfterFirstLoad, 'a resident cache hit should refresh LRU without refetching')

  await client.prepareCountry('dz')
  assert.equal(client.getCatalogue('accra'), null, 'evicted shard metadata must not remain in a second cache')
  assert.equal(client.getCatalogue('algiers')?.id, 'algiers')
  await client.prepareCountry('gh')
  assert.equal(client.getCatalogue('accra')?.id, 'accra')
  assert.equal(fixture.calls.filter((path) => path.includes('/countries/')).length, 3)
  client.dispose()
})

test('rejects unadmitted IDs, duplicate requests, and an index with extra countries', async () => {
  const fixture = createFixture(initialAdmissions)
  const client = await openRuntimeCountryDirectory(fixture.config, { fetchImpl: fixture.fetchImpl })
  await assert.rejects(client.prepareCities(['unknown-city']), /not admitted/)
  await assert.rejects(client.prepareCities(['accra', 'accra']), /duplicate city request/)
  await assert.rejects(client.prepareCountry('xx'), /country is not admitted/)
  client.dispose()

  const extra = createFixture(initialAdmissions, undefined, { iso2: 'XX', name: 'Extra', status: 'candidate', cityCount: 0 })
  await assert.rejects(openRuntimeCountryDirectory(extra.config, { fetchImpl: extra.fetchImpl }), /directory must contain exactly 4 admitted countries/)
  assert.deepEqual(extra.calls, [extra.indexPath], 'an invalid country set must fail before loading any shard')
})

test('refuses a foreign admission list whose ordered digest differs from the descriptor', async () => {
  const fixture = createFixture(initialAdmissions)
  const reordered = [...initialAdmissions].reverse()
  await assert.rejects(openRuntimeCountryDirectory({ ...fixture.config, admittedForeignCities: reordered }, { fetchImpl: fixture.fetchImpl }), /admission list does not match/)
  assert.equal(fixture.calls.length, 0)
})

test('requires a non-empty bounded foreign admission instead of treating Nigeria as a directory fallback', async () => {
  const fixture = createFixture([])
  await assert.rejects(openRuntimeCountryDirectory(fixture.config, { fetchImpl: fixture.fetchImpl }), /at least one foreign city/)
  assert.equal(fixture.calls.length, 0)
})

test('does not publish a shard with a missing, extra, cross-country, or non-finite city row', async (context) => {
  const cases: readonly { readonly label: string; readonly map: (iso2: string, rows: readonly Record<string, unknown>[]) => readonly unknown[] }[] = [
    { label: 'extra ID', map: (_iso2, rows) => [...rows, { ...rows[0], id: 'extra-city' }] },
    { label: 'wrong country', map: (_iso2, rows) => rows.map((row) => ({ ...row, countryISO: 'xx' })) },
    { label: 'non-finite coordinate', map: (_iso2, rows) => rows.map((row) => ({ ...row, lon: null })) },
  ]
  for (const item of cases) {
    await context.test(item.label, async () => {
      const fixture = createFixture(initialAdmissions, item.map)
      if (item.label === 'extra ID') {
        await assert.rejects(openRuntimeCountryDirectory(fixture.config, { fetchImpl: fixture.fetchImpl }), /city count differs from compact admission/)
        assert.deepEqual(fixture.calls, [fixture.indexPath], 'an index count mismatch must fail before loading any shard')
        return
      }
      const client = await openRuntimeCountryDirectory(fixture.config, { fetchImpl: fixture.fetchImpl })
      await assert.rejects(client.prepareCountry('gh'))
      assert.equal(fixture.calls.filter((path) => path.includes('/countries/')).length, 1)
      assert.equal(client.getCatalogue('accra'), null)
      client.dispose()
    })
  }
})

test('rejects a hash-valid extra shard row when the index declares the admitted count', async () => {
  const fixture = createFixture(initialAdmissions, (iso2, rows) => iso2 === 'gh' ? [...rows, { ...rows[0], id: 'extra-city' }] : rows, undefined,
    (iso2, actualCount) => iso2 === 'gh' ? 1 : actualCount)
  const client = await openRuntimeCountryDirectory(fixture.config, { fetchImpl: fixture.fetchImpl })
  assert.deepEqual(fixture.calls, [fixture.indexPath])
  await assert.rejects(client.prepareCountry('gh'), /disagrees with its index/)
  assert.equal(fixture.calls.filter((path) => path.includes('/countries/')).length, 1)
  assert.equal(client.getCatalogue('accra'), null, 'an invalid shard must never publish city metadata')
  client.dispose()
})
