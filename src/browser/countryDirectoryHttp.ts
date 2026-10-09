export const COUNTRY_DIRECTORY_LIMITS = Object.freeze({
  indexBytes: 128 * 1024,
  countryBytes: 128 * 1024,
  countryCount: 64,
  residentBytes: 512 * 1024,
  concurrentCountryReads: 2,
  timeoutMs: 10_000,
})

const HASH256 = /^[a-f0-9]{64}$/u
const ISO2 = /^[A-Z]{2}$/u
const HASHED_PATH = /^countries\/([a-z]{2})-([a-f0-9]{64})\.json$/u
const INDEX_PATH = /^index-([a-f0-9]{64})\.json$/u
const INDEX_KEYS = new Set(['schemaVersion', 'source', 'legacy', 'countries'])
const SOURCE_KEYS = new Set(['c1Commit', 'inventorySha256', 'admissionSha256'])
const LEGACY_KEYS = new Set(['countryISO', 'countryName', 'directoryPreservesAllCatalogueRows'])
const INDEX_ENTRY_KEYS = new Set(['iso2', 'name', 'status', 'path', 'sha256', 'bytes', 'cityCount'])
const SHARD_KEYS = new Set(['schemaVersion', 'country', 'cities', 'containsGeometry', 'containsRules', 'containsContent', 'containsTravelEdges'])
const COUNTRY_KEYS = new Set(['iso2', 'name', 'status'])

export interface CountryDirectoryDescriptor {
  readonly baseUrl: string
  readonly indexPath: string
  readonly indexSha256: string
  readonly admissionSha256: string
  readonly c1Commit: string
  readonly inventorySha256: string
}

export interface CountryDirectoryIndexEntry {
  readonly iso2: string
  readonly name: string
  readonly status: string
  readonly path: string
  readonly sha256: string
  readonly bytes: number
  readonly cityCount: number
}

export interface CountryDirectoryIndex {
  readonly schemaVersion: 1
  readonly source: Readonly<{ c1Commit: string; inventorySha256: string; admissionSha256: string }>
  readonly legacy: Readonly<{ countryISO: 'ng'; countryName: 'Nigeria'; directoryPreservesAllCatalogueRows: true }>
  readonly countries: readonly CountryDirectoryIndexEntry[]
}

export interface CountryDirectoryShard {
  readonly schemaVersion: 1
  readonly country: Readonly<{ iso2: string; name: string; status: string }>
  readonly cities: readonly unknown[]
  readonly containsGeometry: false
  readonly containsRules: false
  readonly containsContent: false
  readonly containsTravelEdges: false
}

export interface CountryDirectoryReader {
  readonly index: CountryDirectoryIndex
  countries(): readonly CountryDirectoryIndexEntry[]
  /** Shard residency only; does not touch LRU order or trigger a read. */
  cachedCountryISOs(): readonly string[]
  getCountryDirectory(iso2: string, options?: { readonly signal?: AbortSignal }): Promise<CountryDirectoryShard>
  dispose(): void
  readonly counters: Readonly<{
    indexReads: 1
    countryReads: ReadonlyMap<string, number>
    pendingCountryReads: number
    residentRawBytes: number
    indexRawBytes: number
  }>
}

export interface CountryDirectoryReaderOptions {
  readonly fetchImpl?: typeof fetch
  readonly maxResidentBytes?: number
  readonly signal?: AbortSignal
  readonly expectedC1Commit: string
  readonly expectedInventorySha256: string
  readonly expectedAdmissionSha256: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key))
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted', 'AbortError')
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? abortError()
}

function validateSignal(signal: AbortSignal | undefined): void {
  if (signal !== undefined && (!signal || typeof signal.addEventListener !== 'function' || typeof signal.aborted !== 'boolean')) {
    throw new TypeError('signal must be an AbortSignal')
  }
}

function makeUrl(baseUrl: string, relativePath: string): URL {
  const pageOrigin = globalThis.location?.origin
  if (baseUrl.startsWith('/') && !pageOrigin) throw new TypeError('relative country directory base URL requires a browser origin')
  const resolvedBase = baseUrl.startsWith('/') ? new URL(baseUrl, pageOrigin) : new URL(baseUrl)
  const base = resolvedBase
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new TypeError('baseUrl must be an HTTP(S) directory URL without credentials, query, or fragment')
  }
  base.pathname = `${base.pathname.replace(/\/+$/u, '')}/`
  const url = new URL(relativePath, base)
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new TypeError('country directory path escaped its base URL')
  return url
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digestInput = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(digestInput).set(bytes)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', digestInput)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function readResponseBytes(response: Response, limit: number, signal: AbortSignal): Promise<Uint8Array> {
  const cancelBody = (body: ReadableStream<Uint8Array> | null, reason: unknown): void => {
    try { Promise.resolve(body?.cancel(reason)).catch(() => {}) } catch {}
  }
  if (!response.ok || !response.body) {
    cancelBody(response.body, 'invalid country directory response')
    throw new Error('country directory response must be a successful streamed HTTP response')
  }
  const reader = response.body.getReader()
  const cancelReader = (reason: unknown): void => {
    try { Promise.resolve(reader.cancel(reason)).catch(() => {}) } catch {}
  }
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  let onAbort = (): void => {}
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      cancelReader(signal.reason)
      reject(signal.reason ?? abortError())
    }
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
  const consume = async (): Promise<Uint8Array> => {
    try {
      while (true) {
        throwIfAborted(signal)
        const result = await reader.read()
        if (result.done) break
        totalBytes += result.value.byteLength
        if (totalBytes > limit) {
          cancelReader('country directory byte limit exceeded')
          throw new RangeError(`country directory response exceeds ${limit} bytes`)
        }
        chunks.push(result.value)
      }
      const bytes = new Uint8Array(totalBytes)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      return bytes
    } catch (error) {
      cancelReader(error)
      throw error
    } finally {
      signal.removeEventListener('abort', onAbort)
      try { reader.releaseLock() } catch {}
    }
  }
  return Promise.race([consume(), aborted])
}

async function fetchVerified(
  fetchImpl: typeof fetch,
  url: URL,
  expectedSha256: string,
  maxBytes: number,
  parentSignal?: AbortSignal,
): Promise<{ readonly bytes: Uint8Array; readonly value: unknown }> {
  const controller = new AbortController()
  const abortFromParent = (): void => controller.abort(parentSignal?.reason ?? abortError())
  if (parentSignal) {
    if (parentSignal.aborted) abortFromParent()
    else parentSignal.addEventListener('abort', abortFromParent, { once: true })
  }
  const timeout = setTimeout(() => controller.abort(new DOMException('Country directory request timed out', 'TimeoutError')),
    COUNTRY_DIRECTORY_LIMITS.timeoutMs)
  let onAbort = (): void => {}
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(controller.signal.reason ?? abortError())
    if (controller.signal.aborted) onAbort()
    else controller.signal.addEventListener('abort', onAbort, { once: true })
  })
  const work = (async () => {
    const response = await fetchImpl(url, { method: 'GET', credentials: 'omit', cache: 'default', redirect: 'error', signal: controller.signal })
    const bytes = await readResponseBytes(response, maxBytes, controller.signal)
    if (await sha256(bytes) !== expectedSha256) throw new Error('country directory SHA-256 mismatch')
    let text: string
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
    catch { throw new TypeError('country directory is not valid UTF-8') }
    try {
      const value: unknown = JSON.parse(text)
      return { bytes, value }
    }
    catch { throw new TypeError('country directory is not valid JSON') }
  })()
  try {
    return await Promise.race([work, aborted])
  } catch (error) {
    if (!controller.signal.aborted) controller.abort(error)
    throw error
  } finally {
    clearTimeout(timeout)
    controller.signal.removeEventListener('abort', onAbort)
    parentSignal?.removeEventListener('abort', abortFromParent)
  }
}

function parseIndex(value: unknown, expected: CountryDirectoryReaderOptions): { index: CountryDirectoryIndex; entries: ReadonlyMap<string, CountryDirectoryIndexEntry> } {
  if (!isRecord(value) || !hasExactKeys(value, INDEX_KEYS) || value.schemaVersion !== 1 || !Array.isArray(value.countries)
      || !isRecord(value.source) || !hasExactKeys(value.source, SOURCE_KEYS) || !isRecord(value.legacy) || !hasExactKeys(value.legacy, LEGACY_KEYS)) {
    throw new TypeError('country directory index schema is unsupported')
  }
  if (value.countries.length > COUNTRY_DIRECTORY_LIMITS.countryCount) throw new RangeError('country directory index exceeds country count limit')
  if (value.source.c1Commit !== expected.expectedC1Commit || value.source.inventorySha256 !== expected.expectedInventorySha256
      || value.source.admissionSha256 !== expected.expectedAdmissionSha256) {
    throw new Error('country directory index source pins do not match the runtime descriptor')
  }
  if (value.legacy.countryISO !== 'ng' || value.legacy.countryName !== 'Nigeria' || value.legacy.directoryPreservesAllCatalogueRows !== true) {
    throw new Error('country directory index does not preserve the Nigeria compatibility identity')
  }
  const entries = new Map<string, CountryDirectoryIndexEntry>()
  for (const item of value.countries) {
    if (!isRecord(item) || !hasExactKeys(item, INDEX_ENTRY_KEYS) || typeof item.iso2 !== 'string' || !ISO2.test(item.iso2) || entries.has(item.iso2.toLowerCase())
        || typeof item.name !== 'string' || !item.name.trim() || typeof item.status !== 'string' || !item.status.trim()
        || typeof item.path !== 'string' || !HASH256.test(typeof item.sha256 === 'string' ? item.sha256 : '')
        || !Number.isSafeInteger(item.bytes) || typeof item.bytes !== 'number' || item.bytes < 0 || item.bytes > COUNTRY_DIRECTORY_LIMITS.countryBytes
        || !Number.isSafeInteger(item.cityCount) || typeof item.cityCount !== 'number' || item.cityCount < 0) {
      throw new Error('country directory index entry is invalid')
    }
    const pathMatch = HASHED_PATH.exec(item.path)
    if (!pathMatch || pathMatch[1] !== item.iso2.toLowerCase() || pathMatch[2] !== item.sha256) throw new Error('country directory index path is invalid')
    const entry: CountryDirectoryIndexEntry = Object.freeze({
      iso2: item.iso2,
      name: item.name,
      status: item.status,
      path: item.path,
      sha256: item.sha256,
      bytes: item.bytes,
      cityCount: item.cityCount,
    })
    entries.set(entry.iso2.toLowerCase(), entry)
  }
  const nigeria = entries.get('ng')
  if (!nigeria || nigeria.name !== 'Nigeria' || nigeria.status !== 'legacy') throw new Error('country directory index omits Nigeria')
  const index: CountryDirectoryIndex = Object.freeze({
    schemaVersion: 1,
    source: Object.freeze({
      c1Commit: expected.expectedC1Commit,
      inventorySha256: expected.expectedInventorySha256,
      admissionSha256: expected.expectedAdmissionSha256,
    }),
    legacy: Object.freeze({ countryISO: 'ng', countryName: 'Nigeria', directoryPreservesAllCatalogueRows: true }),
    countries: Object.freeze([...entries.values()].map((entry) => entry)),
  })
  return { index, entries }
}

function parseShard(value: unknown, entry: CountryDirectoryIndexEntry): CountryDirectoryShard {
  if (!isRecord(value) || !hasExactKeys(value, SHARD_KEYS) || value.schemaVersion !== 1 || !isRecord(value.country)
      || !hasExactKeys(value.country, COUNTRY_KEYS) || !Array.isArray(value.cities)
      || value.country.iso2 !== entry.iso2 || value.country.name !== entry.name || value.country.status !== entry.status
      || value.cities.length !== entry.cityCount || value.containsGeometry !== false || value.containsRules !== false
      || value.containsContent !== false || value.containsTravelEdges !== false) {
    throw new Error('country directory shard disagrees with its index or contains non-metadata data')
  }
  return Object.freeze({
    schemaVersion: 1,
    country: Object.freeze({ iso2: entry.iso2, name: entry.name, status: entry.status }),
    cities: Object.freeze([...value.cities]),
    containsGeometry: false,
    containsRules: false,
    containsContent: false,
    containsTravelEdges: false,
  })
}

export async function openHttpCountryDirectory(
  descriptor: CountryDirectoryDescriptor,
  options: CountryDirectoryReaderOptions,
): Promise<CountryDirectoryReader> {
  if (!HASH256.test(descriptor.indexSha256) || !HASH256.test(descriptor.admissionSha256)
      || !HASH256.test(descriptor.inventorySha256) || !/^[a-f0-9]{40}$/u.test(descriptor.c1Commit)
      || !INDEX_PATH.test(descriptor.indexPath) || descriptor.indexPath !== `index-${descriptor.indexSha256}.json`) {
    throw new TypeError('country directory descriptor pins are invalid')
  }
  if (!Number.isSafeInteger(options.maxResidentBytes ?? COUNTRY_DIRECTORY_LIMITS.residentBytes)
      || (options.maxResidentBytes ?? COUNTRY_DIRECTORY_LIMITS.residentBytes) < 1
      || (options.maxResidentBytes ?? COUNTRY_DIRECTORY_LIMITS.residentBytes) > COUNTRY_DIRECTORY_LIMITS.residentBytes) {
    throw new TypeError('country directory resident limit is invalid')
  }
  validateSignal(options.signal)
  throwIfAborted(options.signal)
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') throw new TypeError('Fetch API is unavailable')
  const url = makeUrl(descriptor.baseUrl, descriptor.indexPath)
  const { bytes: indexBytes, value } = await fetchVerified(fetchImpl, url, descriptor.indexSha256, COUNTRY_DIRECTORY_LIMITS.indexBytes, options.signal)
  throwIfAborted(options.signal)
  const { index, entries } = parseIndex(value, options)
  const maxResidentBytes = options.maxResidentBytes ?? COUNTRY_DIRECTORY_LIMITS.residentBytes
  if (indexBytes.byteLength > maxResidentBytes) throw new RangeError('country directory index exceeds configured resident cache')

  const cache = new Map<string, { readonly value: CountryDirectoryShard; readonly bytes: number }>()
  const pending = new Map<string, PendingRead>()
  const loads = new Map<string, number>()
  let residentBytes = indexBytes.byteLength
  let disposed = false
  const ensureOpen = (): void => { if (disposed) throw new Error('country directory reader is disposed') }

  const getCountryDirectory = async (iso2: string, requestOptions: { readonly signal?: AbortSignal } = {}): Promise<CountryDirectoryShard> => {
    validateSignal(requestOptions.signal)
    ensureOpen()
    throwIfAborted(requestOptions.signal)
    if (!/^[a-z]{2}$/u.test(iso2)) throw new TypeError('country ISO-2 must be lowercase')
    const entry = entries.get(iso2)
    if (!entry) throw new RangeError(`unknown country: ${iso2}`)
    const cached = cache.get(iso2)
    if (cached) {
      cache.delete(iso2)
      cache.set(iso2, cached)
      return cached.value
    }
    let record = pending.get(iso2)
    if (!record) {
      if (pending.size >= COUNTRY_DIRECTORY_LIMITS.concurrentCountryReads) throw new RangeError('concurrent country read limit exceeded')
      if (indexBytes.byteLength + entry.bytes > maxResidentBytes) throw new RangeError('country shard exceeds configured resident cache')
      const created: PendingRead = { controller: new AbortController(), subscribers: new Set(), settled: false }
      pending.set(iso2, created)
      created.promise = fetchVerified(fetchImpl, makeUrl(descriptor.baseUrl, entry.path), entry.sha256,
        COUNTRY_DIRECTORY_LIMITS.countryBytes, created.controller.signal)
        .then(({ bytes, value: shardValue }) => {
          ensureOpen()
          if (pending.get(iso2) !== created) throw abortError()
          if (bytes.byteLength !== entry.bytes) throw new Error('country directory byte count differs from its index')
          const shard = parseShard(shardValue, entry)
          while (residentBytes + bytes.byteLength > maxResidentBytes && cache.size > 0) {
            const oldest = cache.keys().next().value
            if (oldest === undefined) break
            const evicted = cache.get(oldest)
            if (evicted) residentBytes -= evicted.bytes
            cache.delete(oldest)
          }
          if (residentBytes + bytes.byteLength > maxResidentBytes) throw new RangeError('country shard exceeds configured raw resident cache')
          cache.set(iso2, { value: shard, bytes: bytes.byteLength })
          residentBytes += bytes.byteLength
          loads.set(iso2, (loads.get(iso2) ?? 0) + 1)
          return shard
        })
        .finally(() => {
          created.settled = true
          if (pending.get(iso2) === created) pending.delete(iso2)
        })
      created.promise.catch(() => {})
      record = created
    }
    if (!record?.promise) throw new Error('country directory read was not initialized')
    return subscribe(record, iso2, requestOptions.signal)
  }

  const subscribe = (record: PendingRead, iso2: string, signal: AbortSignal | undefined): Promise<CountryDirectoryShard> => {
    const work = record.promise
    if (!work) return Promise.reject(new Error('country directory read was not initialized'))
    const token = {}
    record.subscribers.add(token)
    return new Promise((resolve, reject) => {
      let finished = false
      const cleanup = (): boolean => {
        if (finished) return false
        finished = true
        signal?.removeEventListener('abort', onAbort)
        record.subscribers.delete(token)
        if (!record.settled && record.subscribers.size === 0 && pending.get(iso2) === record) {
          pending.delete(iso2)
          record.controller.abort(abortError())
        }
        return true
      }
      const onAbort = (): void => { if (cleanup()) reject(signal?.reason ?? abortError()) }
      signal?.addEventListener('abort', onAbort, { once: true })
      work.then((shard) => { if (cleanup()) resolve(shard) }, (error: unknown) => { if (cleanup()) reject(error) })
      if (signal?.aborted) onAbort()
    })
  }

  const countries = (): readonly CountryDirectoryIndexEntry[] => {
    ensureOpen()
    return index.countries
  }
  const cachedCountryISOs = (): readonly string[] => {
    ensureOpen()
    return Object.freeze([...cache.keys()])
  }
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    for (const [iso2, record] of pending) {
      pending.delete(iso2)
      record.controller.abort(abortError())
    }
    cache.clear()
    residentBytes = 0
  }

  return Object.freeze({
    index,
    countries,
    cachedCountryISOs,
    getCountryDirectory,
    dispose,
    get counters() {
      const indexReads: 1 = 1
      return Object.freeze({ indexReads, countryReads: new Map(loads), pendingCountryReads: pending.size,
        residentRawBytes: residentBytes, indexRawBytes: indexBytes.byteLength })
    },
  })
}

interface PendingRead {
  readonly controller: AbortController
  readonly subscribers: Set<object>
  settled: boolean
  promise?: Promise<CountryDirectoryShard>
}
