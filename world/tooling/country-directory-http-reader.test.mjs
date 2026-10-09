import assert from 'node:assert/strict'
import { createHash, webcrypto } from 'node:crypto'
import test from 'node:test'
import {
  C1_SOURCE_SHA,
  HTTP_DIRECTORY_LIMITS,
  ROLLOUT_INVENTORY_SHA256,
  openHttpCountryDirectory,
} from './country-directory-http-reader.mjs'

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const encode = (value) => new TextEncoder().encode(JSON.stringify(value))
const asResponse = (bytes) => new Response(bytes, { status: 200 })

function createFixture({ countries = ['NG', 'LY', 'TN', 'SL'], countryOverrides = {}, indexOverrides = {} } = {}) {
  const bodies = new Map()
  const entries = []
  for (const iso2 of countries) {
    const status = iso2 === 'NG' ? 'legacy' : 'accepted-foreign'
    const value = {
      schemaVersion: 1,
      country: { iso2, name: iso2 === 'NG' ? 'Nigeria' : `Country ${iso2}`, status },
      cities: [{ id: iso2.toLowerCase() === 'ng' ? 'lagos' : `city-${iso2.toLowerCase()}`, name: `City ${iso2}`, ...(iso2 === 'LY' ? {} : { timezone: 'Africa/Test' }) }],
      containsGeometry: false,
      containsRules: false,
      containsContent: false,
      containsTravelEdges: false,
      ...countryOverrides[iso2],
    }
    const bytes = encode(value)
    const sha256 = digest(bytes)
    const path = `countries/${iso2.toLowerCase()}-${sha256}.json`
    bodies.set(path, bytes)
    entries.push({ iso2, name: value.country.name, status, path, sha256, bytes: bytes.byteLength, cityCount: value.cities.length })
  }
  const indexValue = {
    schemaVersion: 1,
    source: { c1Commit: C1_SOURCE_SHA, inventorySha256: ROLLOUT_INVENTORY_SHA256 },
    legacy: { countryISO: 'ng', countryName: 'Nigeria', directoryPreservesAllCatalogueRows: true },
    countries: entries,
    ...indexOverrides,
  }
  const indexBytes = encode(indexValue)
  const indexHash = digest(indexBytes)
  bodies.set(`index-${indexHash}.json`, indexBytes)
  const calls = []
  const fetchImpl = async (input, options = {}) => {
    calls.push({ pathname: new URL(input).pathname, signal: options.signal })
    const bytes = bodies.get(new URL(input).pathname.replace(/^\/static\//u, ''))
    if (!bytes) return new Response('missing', { status: 404 })
    return asResponse(bytes)
  }
  return { bodies, entries, indexValue, indexBytes, indexHash, calls, fetchImpl }
}

const openFixture = (fixture, options = {}) => openHttpCountryDirectory('https://example.test/static/', fixture.indexHash, {
  fetchImpl: fixture.fetchImpl,
  ...options,
})

test('fetches only the index initially and caches one verified country directory', async () => {
  const fixture = createFixture()
  const reader = await openFixture(fixture)
  assert.equal(fixture.calls.length, 1)
  assert.equal(fixture.calls[0].pathname, `/static/index-${fixture.indexHash}.json`)
  const first = await reader.getCountryDirectory('ly')
  assert.equal(fixture.calls.length, 2)
  assert.equal(first.country.iso2, 'LY')
  assert.equal('timezone' in first.cities[0], false, 'missing timezone stays missing')
  assert.equal(reader.countries().find((country) => country.iso2 === 'LY').status, 'accepted-foreign')
  assert.equal(await reader.getCountryDirectory('ly'), first)
  assert.equal(fixture.calls.length, 2)
  assert.equal(reader.counters.countryReads.get('ly'), 1)
  assert.equal(reader.counters.residentRawBytes, fixture.indexBytes.byteLength + fixture.entries.find((row) => row.iso2 === 'LY').bytes)
  reader.dispose()
})

test('rejects incorrect source identity, malformed index schema, and path traversal', async () => {
  const wrongSource = createFixture({ indexOverrides: { source: { c1Commit: '0'.repeat(40), inventorySha256: ROLLOUT_INVENTORY_SHA256 } } })
  await assert.rejects(openFixture(wrongSource), /source pins/)
  const wrongInventory = createFixture({ indexOverrides: { source: { c1Commit: C1_SOURCE_SHA, inventorySha256: '0'.repeat(64) } } })
  await assert.rejects(openFixture(wrongInventory), /source pins/)

  const badSchema = createFixture({ indexOverrides: { schemaVersion: 2 } })
  await assert.rejects(openFixture(badSchema), /schema is unsupported/)

  const traversal = createFixture()
  const ly = traversal.indexValue.countries.find((row) => row.iso2 === 'LY')
  ly.path = `countries/../${ly.path}`
  traversal.bodies.set(`index-${traversal.indexHash}.json`, encode(traversal.indexValue))
  const bytes = traversal.bodies.get(`index-${traversal.indexHash}.json`)
  const hash = digest(bytes)
  traversal.bodies.delete(`index-${traversal.indexHash}.json`)
  traversal.bodies.set(`index-${hash}.json`, bytes)
  await assert.rejects(openHttpCountryDirectory('https://example.test/static/', hash, { fetchImpl: traversal.fetchImpl }), /index entry is invalid/)
})

test('rejects tampered shard bytes and a hash-pinned shard with an unsupported schema', async () => {
  const tampered = createFixture()
  const tamperedReader = await openFixture(tampered)
  const ly = tampered.entries.find((entry) => entry.iso2 === 'LY')
  const correct = tampered.bodies.get(ly.path)
  const changed = correct.slice()
  changed[changed.length - 2] ^= 1
  tampered.bodies.set(ly.path, changed)
  await assert.rejects(tamperedReader.getCountryDirectory('ly'), /SHA-256 mismatch/)
  tamperedReader.dispose()

  const unsupported = createFixture({ countryOverrides: { LY: { schemaVersion: 2 } } })
  const reader = await openFixture(unsupported)
  await assert.rejects(reader.getCountryDirectory('ly'), /non-metadata data/)
  reader.dispose()
})

test('refuses an oversized streamed index before JSON parsing', async () => {
  const bytes = new Uint8Array(HTTP_DIRECTORY_LIMITS.indexBytes + 1)
  const indexHash = digest(bytes)
  let cancelled = false
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(bytes) },
    cancel() { cancelled = true },
  })
  await assert.rejects(openHttpCountryDirectory('https://example.test/static/', indexHash, {
    fetchImpl: async () => new Response(stream, { status: 200 }),
  }), /exceeds 131072 bytes/)
  assert.equal(cancelled, true)
})

test('cancels an HTTP error body without waiting for its cancellation promise', async () => {
  let cancelled = false
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array([1])) },
    cancel() { cancelled = true; return new Promise(() => {}) },
  })
  const indexHash = 'a'.repeat(64)
  await assert.rejects(openHttpCountryDirectory('https://example.test/static/', indexHash, {
    fetchImpl: async () => new Response(stream, { status: 500 }),
  }), /successful streamed HTTP/)
  assert.equal(cancelled, true)
})

test('oversize rejection does not hang when stream cancellation never settles', async () => {
  const bytes = new Uint8Array(HTTP_DIRECTORY_LIMITS.indexBytes + 1)
  const indexHash = digest(bytes)
  let cancelled = false
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(bytes) },
    cancel() { cancelled = true; return new Promise(() => {}) },
  })
  await assert.rejects(openHttpCountryDirectory('https://example.test/static/', indexHash, {
    fetchImpl: async () => new Response(stream, { status: 200 }),
  }), /exceeds 131072 bytes/)
  assert.equal(cancelled, true)
})

test('enforces the fixed ten-second request timeout without changing the public cap', async () => {
  const originalSetTimeout = globalThis.setTimeout
  let observedDelay
  globalThis.setTimeout = (callback, delay, ...args) => {
    observedDelay = delay
    return originalSetTimeout(callback, 0, ...args)
  }
  try {
    await assert.rejects(openHttpCountryDirectory('https://example.test/static/', 'a'.repeat(64), {
      fetchImpl: async () => new Promise(() => {}),
    }), { name: 'TimeoutError' })
    assert.equal(observedDelay, HTTP_DIRECTORY_LIMITS.timeoutMs)
    assert.equal(HTTP_DIRECTORY_LIMITS.timeoutMs, 10_000)
  } finally {
    globalThis.setTimeout = originalSetTimeout
  }
})

test('refuses a shard whose actual streamed size exceeds the shard cap and cancels its body', async () => {
  const fixture = createFixture()
  const ly = fixture.entries.find((row) => row.iso2 === 'LY')
  fixture.bodies.set(ly.path, new Uint8Array(HTTP_DIRECTORY_LIMITS.countryBytes + 1))
  const reader = await openFixture(fixture)
  let cancelled = false
  const original = fixture.fetchImpl
  const fetchImpl = async (input, options) => {
    if (new URL(input).pathname.endsWith(ly.path)) {
      const stream = new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array(HTTP_DIRECTORY_LIMITS.countryBytes + 1)) },
        cancel() { cancelled = true },
      })
      return new Response(stream, { status: 200 })
    }
    return original(input, options)
  }
  reader.dispose()
  const retryReader = await openHttpCountryDirectory('https://example.test/static/', fixture.indexHash, { fetchImpl })
  await assert.rejects(retryReader.getCountryDirectory('ly'), /exceeds 131072 bytes/)
  assert.equal(cancelled, true)
  retryReader.dispose()
})

test('bounds the number of distinct pending shard requests', async () => {
  const fixture = createFixture({ countries: ['NG', 'LY', 'TN', 'SL'] })
  const original = fixture.fetchImpl
  const pending = new Map()
  const fetchImpl = async (input, options) => {
    const pathname = new URL(input).pathname
    if (pathname.includes('/countries/')) {
      return new Promise((resolve, reject) => {
        pending.set(pathname, { resolve, signal: options.signal })
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
      })
    }
    return original(input, options)
  }
  const reader = await openHttpCountryDirectory('https://example.test/static/', fixture.indexHash, { fetchImpl })
  const first = reader.getCountryDirectory('ly')
  const second = reader.getCountryDirectory('tn')
  await Promise.resolve()
  await Promise.resolve()
  await assert.rejects(reader.getCountryDirectory('sl'), /concurrent country read limit exceeded/)
  for (const row of fixture.entries.filter((entry) => entry.iso2 === 'LY' || entry.iso2 === 'TN')) {
    pending.get(`/static/${row.path}`).resolve(asResponse(fixture.bodies.get(row.path)))
  }
  await Promise.all([first, second])
  reader.dispose()
})

test('one subscriber can cancel while another receives the shared shard result', async () => {
  const fixture = createFixture()
  const original = fixture.fetchImpl
  let resolveShard
  const fetchImpl = async (input, options) => {
    if (new URL(input).pathname.includes('/countries/')) {
      return new Promise((resolve) => { resolveShard = () => resolve(asResponse(fixture.bodies.get(fixture.entries.find((entry) => entry.iso2 === 'LY').path))) })
    }
    return original(input, options)
  }
  const reader = await openHttpCountryDirectory('https://example.test/static/', fixture.indexHash, { fetchImpl })
  const one = new AbortController()
  const two = new AbortController()
  const canceled = reader.getCountryDirectory('ly', { signal: one.signal })
  const retained = reader.getCountryDirectory('ly', { signal: two.signal })
  await Promise.resolve()
  one.abort()
  await assert.rejects(canceled, { name: 'AbortError' })
  resolveShard()
  assert.equal((await retained).country.iso2, 'LY')
  assert.equal(reader.counters.countryReads.get('ly'), 1)
  reader.dispose()
})

test('aborts underlying request when every subscriber cancels and allows a retry', async () => {
  const fixture = createFixture()
  const original = fixture.fetchImpl
  let calls = 0
  let firstSignal
  const fetchImpl = async (input, options) => {
    if (new URL(input).pathname.includes('/countries/')) {
      calls += 1
      if (calls === 1) {
        firstSignal = options.signal
        return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))
      }
    }
    return original(input, options)
  }
  const reader = await openHttpCountryDirectory('https://example.test/static/', fixture.indexHash, { fetchImpl })
  const controller = new AbortController()
  const canceled = reader.getCountryDirectory('ly', { signal: controller.signal })
  await Promise.resolve()
  controller.abort()
  await assert.rejects(canceled, { name: 'AbortError' })
  await Promise.resolve()
  assert.equal(firstSignal.aborted, true)
  assert.equal((await reader.getCountryDirectory('ly')).country.iso2, 'LY')
  assert.equal(calls, 2)
  reader.dispose()
})

test('dispose aborts pending work and prevents a late response from entering the cache', async () => {
  const fixture = createFixture()
  const original = fixture.fetchImpl
  let resolveShard
  let signal
  const fetchImpl = async (input, options) => {
    if (new URL(input).pathname.includes('/countries/')) {
      signal = options.signal
      return new Promise((resolve) => { resolveShard = () => resolve(asResponse(fixture.bodies.get(fixture.entries.find((entry) => entry.iso2 === 'LY').path))) })
    }
    return original(input, options)
  }
  const reader = await openHttpCountryDirectory('https://example.test/static/', fixture.indexHash, { fetchImpl })
  const pending = reader.getCountryDirectory('ly')
  await Promise.resolve()
  reader.dispose()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(signal.aborted, true)
  resolveShard()
  await Promise.resolve()
  await assert.rejects(reader.getCountryDirectory('ly'), /disposed/)
  assert.equal(reader.counters.residentRawBytes, 0)
})

test('counts index raw bytes toward the resident limit and leaves timezone gaps uninferred', async () => {
  const fixture = createFixture()
  const reader = await openFixture(fixture, { maxResidentBytes: fixture.indexBytes.byteLength })
  await assert.rejects(reader.getCountryDirectory('ly'), /configured resident cache/)
  assert.equal(fixture.calls.length, 1)
  assert.equal(reader.counters.residentRawBytes, fixture.indexBytes.byteLength)
  reader.dispose()

  const roomy = await openFixture(createFixture())
  const libya = await roomy.getCountryDirectory('ly')
  assert.equal(Object.hasOwn(libya.cities[0], 'timezone'), false)
  roomy.dispose()
})

test('rejects a shard with malformed UTF-8 even when its hash matches', async () => {
  const fixture = createFixture()
  const ly = fixture.entries.find((entry) => entry.iso2 === 'LY')
  const invalid = new Uint8Array([0xc3, 0x28])
  ly.sha256 = digest(invalid)
  ly.path = `countries/ly-${ly.sha256}.json`
  ly.bytes = invalid.byteLength
  fixture.bodies.set(ly.path, invalid)
  const indexBytes = encode(fixture.indexValue)
  const indexHash = digest(indexBytes)
  fixture.bodies.set(`index-${indexHash}.json`, indexBytes)
  const reader = await openHttpCountryDirectory('https://example.test/static/', indexHash, { fetchImpl: fixture.fetchImpl })
  await assert.rejects(reader.getCountryDirectory('ly'), /not valid UTF-8/)
  reader.dispose()
})
