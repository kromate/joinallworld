export const C1_SOURCE_SHA = 'c1f7c1f7369139ce559292318ba9842c23a28267'
export const ROLLOUT_INVENTORY_SHA256 = '90c931e87b4758544e8de321ecb0bf3b41420cbbf9aeb504b66b93c6938c2e0b'
export const HTTP_DIRECTORY_LIMITS = Object.freeze({
  indexBytes: 128 * 1024,
  countryBytes: 128 * 1024,
  countryCount: 64,
  residentBytes: 512 * 1024,
  concurrentCountryReads: 2,
  timeoutMs: 10_000,
})

const SHA256 = /^[a-f0-9]{64}$/u
const C1_SHA = /^[a-f0-9]{40}$/u
const UPPER_ISO2 = /^[A-Z]{2}$/u
const LOWER_ISO2 = /^[a-z]{2}$/u
const HASHED_COUNTRY_PATH = /^countries\/([a-z]{2})-([a-f0-9]{64})\.json$/u

function assertSignal(signal, label) {
  if (signal !== undefined && (!signal || typeof signal.addEventListener !== 'function' || typeof signal.aborted !== 'boolean')) {
    throw new TypeError(`${label} must be an AbortSignal`)
  }
}

function abortError() {
  return new DOMException('The operation was aborted', 'AbortError')
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason ?? abortError()
}

function makeUrl(baseUrl, relativePath) {
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) throw new TypeError('baseUrl must be a non-empty URL')
  const base = new URL(baseUrl)
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new TypeError('baseUrl must be an HTTP(S) directory URL without credentials, query, or fragment')
  }
  base.pathname = `${base.pathname.replace(/\/+$/u, '')}/`
  const url = new URL(relativePath, base)
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw new TypeError('directory path escaped its base URL')
  return url
}

async function digestHex(bytes) {
  const cryptoApi = globalThis.crypto
  if (!cryptoApi?.subtle) throw new Error('WebCrypto SHA-256 is unavailable')
  const digest = await cryptoApi.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function readResponseBytes(response, limit, signal) {
  const cancelBody = (body, reason) => {
    try { Promise.resolve(body?.cancel?.(reason)).catch(() => {}) } catch {}
  }
  if (!response || response.ok !== true || !response.body || typeof response.body.getReader !== 'function') {
    cancelBody(response?.body, 'invalid country directory response')
    throw new Error('country directory response must be a successful streamed HTTP response')
  }
  const reader = response.body.getReader()
  const cancelReader = (reason) => {
    try { Promise.resolve(reader.cancel(reason)).catch(() => {}) } catch {}
  }
  const chunks = []
  let total = 0
  let abortListener
  const aborted = new Promise((_, reject) => {
    abortListener = () => {
      cancelReader(signal.reason)
      reject(signal.reason ?? abortError())
    }
    if (signal.aborted) abortListener()
    else signal.addEventListener('abort', abortListener, { once: true })
  })
  const consume = async () => {
    try {
      while (true) {
        throwIfAborted(signal)
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > limit) {
          cancelReader('country directory byte limit exceeded')
          throw new RangeError(`country directory response exceeds ${limit} bytes`)
        }
        chunks.push(value)
      }
      const bytes = new Uint8Array(total)
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
      signal.removeEventListener('abort', abortListener)
      try { reader.releaseLock() } catch {}
    }
  }
  return Promise.race([consume(), aborted])
}

async function fetchVerified({ fetchImpl, url, expectedHash, maxBytes, signal }) {
  const controller = new AbortController()
  let timer
  let parentAbort
  const abortFromParent = () => controller.abort(signal.reason ?? abortError())
  if (signal) {
    if (signal.aborted) abortFromParent()
    else signal.addEventListener('abort', abortFromParent, { once: true })
  }
  timer = setTimeout(() => controller.abort(new DOMException('Country directory request timed out', 'TimeoutError')), HTTP_DIRECTORY_LIMITS.timeoutMs)
  const abortPromise = new Promise((_, reject) => {
    parentAbort = () => reject(controller.signal.reason ?? abortError())
    if (controller.signal.aborted) parentAbort()
    else controller.signal.addEventListener('abort', parentAbort, { once: true })
  })
  const work = (async () => {
    const response = await fetchImpl(url, { method: 'GET', credentials: 'omit', cache: 'default', redirect: 'error', signal: controller.signal })
    const bytes = await readResponseBytes(response, maxBytes, controller.signal)
    const actualHash = await digestHex(bytes)
    if (actualHash !== expectedHash) throw new Error('country directory SHA-256 mismatch')
    let text
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
    catch { throw new TypeError('country directory is not valid UTF-8') }
    let value
    try { value = JSON.parse(text) }
    catch { throw new TypeError('country directory is not valid JSON') }
    return { bytes, value }
  })()
  try {
    return await Promise.race([work, abortPromise])
  } catch (error) {
    if (!controller.signal.aborted) controller.abort(error)
    throw error
  } finally {
    clearTimeout(timer)
    controller.signal.removeEventListener('abort', parentAbort)
    signal?.removeEventListener('abort', abortFromParent)
  }
}

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`)
  return value
}

function validateIndex(index, expectedC1Sha, expectedInventorySha) {
  assertRecord(index, 'country directory index')
  if (index.schemaVersion !== 1 || !Array.isArray(index.countries)) throw new TypeError('country directory index schema is unsupported')
  if (index.countries.length > HTTP_DIRECTORY_LIMITS.countryCount) throw new RangeError('country directory index exceeds country count limit')
  if (index.source?.c1Commit !== expectedC1Sha || index.source?.inventorySha256 !== expectedInventorySha) {
    throw new Error('country directory index source pins do not match the expected C1 and inventory')
  }
  if (index.legacy?.countryISO !== 'ng' || index.legacy?.countryName !== 'Nigeria' || index.legacy?.directoryPreservesAllCatalogueRows !== true) {
    throw new Error('country directory index does not preserve the Nigeria compatibility identity')
  }
  const entries = new Map()
  for (const raw of index.countries) {
    const entry = assertRecord(raw, 'country index entry')
    const iso2 = entry.iso2
    const match = typeof entry.path === 'string' ? HASHED_COUNTRY_PATH.exec(entry.path) : null
    if (typeof iso2 !== 'string' || !UPPER_ISO2.test(iso2) || entries.has(iso2.toLowerCase())
        || !SHA256.test(entry.sha256 ?? '') || !Number.isSafeInteger(entry.bytes)
        || entry.bytes < 0 || entry.bytes > HTTP_DIRECTORY_LIMITS.countryBytes
        || !match || match[1] !== iso2.toLowerCase() || match[2] !== entry.sha256
        || !Number.isSafeInteger(entry.cityCount) || entry.cityCount < 0
        || typeof entry.name !== 'string' || !entry.name.trim() || typeof entry.status !== 'string' || !entry.status.trim()) {
      throw new Error('country index entry is invalid')
    }
    entries.set(iso2.toLowerCase(), Object.freeze({ ...entry }))
  }
  const nigeria = entries.get('ng')
  if (!nigeria || nigeria.status !== 'legacy' || nigeria.name !== 'Nigeria') {
    throw new Error('country directory index omits the protected Nigeria directory')
  }
  return entries
}

function validateCountry(value, entry) {
  assertRecord(value, 'country directory')
  assertRecord(value.country, 'country directory identity')
  if (value.schemaVersion !== 1 || value.country.iso2 !== entry.iso2 || value.country.name !== entry.name
      || !Array.isArray(value.cities) || value.cities.length !== entry.cityCount
      || value.country.status !== entry.status || value.containsGeometry !== false || value.containsRules !== false
      || value.containsContent !== false || value.containsTravelEdges !== false) {
    throw new Error('country directory disagrees with its pinned index or contains non-metadata data')
  }
  return deepFreeze(value)
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

/** Read-only HTTP reader for content-hashed country metadata directories. */
export async function openHttpCountryDirectory(baseUrl, indexHash, {
  fetchImpl = globalThis.fetch,
  maxResidentBytes = HTTP_DIRECTORY_LIMITS.residentBytes,
  signal,
  expectedC1Sha = C1_SOURCE_SHA,
  expectedInventorySha = ROLLOUT_INVENTORY_SHA256,
} = {}) {
  assertSignal(signal, 'signal')
  if (!SHA256.test(indexHash ?? '') || typeof fetchImpl !== 'function'
      || !Number.isSafeInteger(maxResidentBytes) || maxResidentBytes < 1 || maxResidentBytes > HTTP_DIRECTORY_LIMITS.residentBytes
      || !C1_SHA.test(expectedC1Sha) || !SHA256.test(expectedInventorySha)) {
    throw new TypeError('valid index pin, fetch implementation, bounded resident limit, and source pins are required')
  }
  throwIfAborted(signal)
  const indexUrl = makeUrl(baseUrl, `index-${indexHash}.json`)
  const indexResponse = await fetchVerified({ fetchImpl, url: indexUrl, expectedHash: indexHash,
    maxBytes: HTTP_DIRECTORY_LIMITS.indexBytes, signal })
  throwIfAborted(signal)
  const entries = validateIndex(indexResponse.value, expectedC1Sha, expectedInventorySha)
  if (indexResponse.bytes.byteLength > maxResidentBytes) throw new RangeError('country directory index exceeds configured raw resident cache')
  const index = deepFreeze(indexResponse.value)
  const cache = new Map()
  const pending = new Map()
  const loads = new Map()
  let residentBytes = indexResponse.bytes.byteLength
  let disposed = false

  const ensureOpen = () => {
    if (disposed) throw new Error('country directory reader is disposed')
  }
  const countries = () => {
    ensureOpen()
    return index.countries
  }
  const getCountryDirectory = async (iso2, options = {}) => {
    const requestSignal = options?.signal
    assertSignal(requestSignal, 'signal')
    ensureOpen()
    throwIfAborted(requestSignal)
    if (typeof iso2 !== 'string' || !LOWER_ISO2.test(iso2)) throw new TypeError('country ISO-2 must be lowercase')
    const entry = entries.get(iso2)
    if (!entry) throw new RangeError(`unknown country: ${iso2}`)
    const cached = cache.get(iso2)
    if (cached) {
      cache.delete(iso2)
      cache.set(iso2, cached)
      return Promise.resolve(cached.value)
    }

    let record = pending.get(iso2)
    if (!record) {
      if (pending.size >= HTTP_DIRECTORY_LIMITS.concurrentCountryReads) return Promise.reject(new RangeError('concurrent country read limit exceeded'))
      if (indexResponse.bytes.byteLength + entry.bytes > maxResidentBytes) return Promise.reject(new RangeError('country shard exceeds configured resident cache'))
      record = { controller: new AbortController(), subscribers: new Set(), promise: null, settled: false }
      pending.set(iso2, record)
      const countryUrl = makeUrl(baseUrl, entry.path)
      record.promise = fetchVerified({ fetchImpl, url: countryUrl, expectedHash: entry.sha256,
        maxBytes: HTTP_DIRECTORY_LIMITS.countryBytes, signal: record.controller.signal })
        .then(({ bytes, value }) => {
          ensureOpen()
          if (pending.get(iso2) !== record) throw abortError()
          if (bytes.byteLength !== entry.bytes) throw new Error('country directory byte count differs from its index')
          const frozen = validateCountry(value, entry)
          while (residentBytes + bytes.byteLength > maxResidentBytes && cache.size) {
            const oldest = cache.keys().next().value
            residentBytes -= cache.get(oldest).bytes
            cache.delete(oldest)
          }
          if (residentBytes + bytes.byteLength > maxResidentBytes) throw new RangeError('country shard exceeds configured raw resident cache')
          cache.set(iso2, { value: frozen, bytes: bytes.byteLength })
          residentBytes += bytes.byteLength
          loads.set(iso2, (loads.get(iso2) ?? 0) + 1)
          return frozen
        })
        .finally(() => {
          record.settled = true
          if (pending.get(iso2) === record) pending.delete(iso2)
        })
      record.promise.catch(() => {})
    }
    return subscribe(record, iso2, requestSignal)
  }

  function subscribe(record, iso2, requestSignal) {
    const token = {}
    record.subscribers.add(token)
    return new Promise((resolve, reject) => {
      let finished = false
      const cleanup = () => {
        if (finished) return false
        finished = true
        requestSignal?.removeEventListener('abort', onAbort)
        record.subscribers.delete(token)
        if (!record.settled && record.subscribers.size === 0 && pending.get(iso2) === record) {
          pending.delete(iso2)
          record.controller.abort(abortError())
        }
        return true
      }
      const onAbort = () => {
        if (cleanup()) reject(requestSignal.reason ?? abortError())
      }
      if (requestSignal) requestSignal.addEventListener('abort', onAbort, { once: true })
      record.promise.then((value) => {
        if (cleanup()) resolve(value)
      }, (error) => {
        if (cleanup()) reject(error)
      })
      if (requestSignal?.aborted) onAbort()
    })
  }

  const dispose = () => {
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
    countries,
    getCountryDirectory,
    dispose,
    // These counters describe verified raw JSON bytes, not JavaScript heap use.
    get counters() {
      return Object.freeze({ indexReads: 1, countryReads: new Map(loads), pendingCountryReads: pending.size,
        residentRawBytes: residentBytes, indexRawBytes: indexResponse.bytes.byteLength })
    },
  })
}
