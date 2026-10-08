import type { GameMapCatalogue, GameMapCatalogueEntry, VerifiedGameMapBundle } from '../../../world/game-map-contract.ts';
import { GAME_MAP_CATALOGUE_LIMITS, sha256Hex, validateGameMapCatalogue, verifyGameMapBundle } from '../../../world/game-map-contract.ts';
import type { CountryDetailCatalogue, CountryDetailChoice, CountryDetailOutline, CountryDetailService } from './country-detail-types.ts';
import {
  COUNTRY_DETAIL_ATLAS_SHA256,
  COUNTRY_DETAIL_CATALOGUE_PATH,
  COUNTRY_DETAIL_CATALOGUE_SHA256,
  COUNTRY_DETAIL_DIRECTORY_MANIFEST_SHA256,
  COUNTRY_DETAIL_SOURCE_BYTES,
  COUNTRY_DETAIL_SOURCE_SHA256,
} from './country-detail-pins.generated.ts';

const CATALOGUE_CAP = Math.min(256_000, GAME_MAP_CATALOGUE_LIMITS.catalogueBytes);
const BUNDLE_CAP = Math.min(5_242_880, GAME_MAP_CATALOGUE_LIMITS.bundleBytes);
const TOTAL_CACHE_CAP = 5_000_000;
const CACHE_ENTRY_CAP = 4;
const REQUEST_TIMEOUT_MS = 20_000;
const SOURCE_LABEL = 'Natural Earth 1:10m Admin 0 Countries';
const SOURCE_URL = 'https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/';
const BOUNDARY_NOTE = 'Reference boundaries are display-only, may not represent legal or political recognition, and do not grant gameplay access.';

export interface CountryDetailPins {
  cataloguePath: string;
  catalogueSha256: string;
  atlasSha256: string;
  directoryManifestSha256: string;
  sourceSha256: string;
  sourceBytes: number;
}

export interface CountryDetailDataOptions {
  fetcher?: typeof fetch;
  pins?: CountryDetailPins;
}

interface CacheEntry { bytes: Uint8Array; used: number }

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException('Country detail request was aborted.', 'AbortError');
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', aborted);
    const aborted = () => { cleanup(); reject(abortReason(signal)); };
    signal.addEventListener('abort', aborted, { once: true });
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

async function cancelBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  if (!body) return;
  const cancellation = body.cancel().catch(() => undefined);
  await Promise.race([cancellation, new Promise<void>(resolve => setTimeout(resolve, 100))]);
}

function fetchWithAbort(fetcher: typeof fetch, input: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  const request = fetcher(input, init);
  void request.then(response => { if (signal.aborted) void cancelBody(response.body); }, () => undefined);
  return withAbort(request, signal);
}

function safeRelativePath(value: string, expectedPrefix: string): string {
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError('Country detail URL is not a safe same-origin path');
  }
  const url = new URL(value, 'https://country-detail.invalid');
  if (url.origin !== 'https://country-detail.invalid' || url.pathname !== value || url.search || url.hash || url.username || url.password || !value.startsWith(expectedPrefix)) {
    throw new TypeError('Country detail URL is outside the fixed same-origin route');
  }
  return value;
}

function responseUrlIsSafe(response: Response, requestedPath: string): void {
  if (!response.url) return;
  const request = new URL(requestedPath, globalThis.location?.origin ?? 'https://country-detail.invalid');
  const actual = new URL(response.url);
  if (actual.origin !== request.origin || actual.pathname !== request.pathname || actual.search || actual.hash || actual.username || actual.password) {
    throw new Error('Country detail response redirected outside its pinned same-origin path');
  }
}

async function assertResponse(response: Response, path: string, signal: AbortSignal, label: string): Promise<void> {
  try {
    if (signal.aborted) throw abortReason(signal);
    if (response.status !== 200 || response.redirected || response.type === 'opaque' || response.type === 'opaqueredirect') throw new Error(`${label} request failed (${response.status})`);
    responseUrlIsSafe(response, path);
    const encoding = response.headers.get('content-encoding');
    // Fetch exposes browser-decoded bytes but retains the transport encoding header. Cloudflare
    // may negotiate Zstandard; integrity and size checks below still apply to the decoded body.
    if (encoding !== null && !['identity', 'gzip', 'deflate', 'br', 'zstd'].includes(encoding.toLowerCase())) throw new Error(`${label} response encoding is unsupported`);
  } catch (error) {
    await cancelBody(response.body);
    throw error;
  }
}

async function readBounded(response: Response, cap: number, exactBytes: number | null, signal: AbortSignal): Promise<Uint8Array> {
  if (signal.aborted) { await cancelBody(response.body); throw abortReason(signal); }
  if (response.type === 'opaque' || response.type === 'opaqueredirect') throw new Error('Country detail response is opaque');
  const lengthHeader = response.headers.get('content-length');
  const encoding = response.headers.get('content-encoding')?.toLowerCase() ?? 'identity';
  if (lengthHeader !== null && (!/^\d+$/.test(lengthHeader) || Number(lengthHeader) > cap || (exactBytes !== null && encoding === 'identity' && Number(lengthHeader) !== exactBytes))) {
    await cancelBody(response.body);
    throw new RangeError('Country detail response length is invalid');
  }
  if (!response.body) throw new Error('Country detail response body is unavailable');
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try { reader = response.body.getReader(); }
  catch (error) { await cancelBody(response.body); throw error; }
  const buffer = new Uint8Array(exactBytes ?? cap);
  let total = 0;
  let abortListener: (() => void) | null = null;
  const abortPromise = new Promise<never>((_, reject) => {
    abortListener = () => reject(abortReason(signal));
    signal.addEventListener('abort', abortListener, { once: true });
  });
  const cancelBounded = async () => {
    const cancel = reader.cancel().catch(() => undefined);
    await Promise.race([cancel, new Promise<void>(resolve => setTimeout(resolve, 100))]);
  };
  let complete = false;
  try {
    for (;;) {
      if (signal.aborted) throw abortReason(signal);
      const item = await Promise.race([reader.read(), abortPromise]);
      if (item.done) { complete = true; break; }
      if (item.value.byteLength > cap - total || (exactBytes !== null && item.value.byteLength > exactBytes - total)) throw new RangeError('Country detail response exceeded its byte bound');
      buffer.set(item.value, total); total += item.value.byteLength;
    }
    if (signal.aborted) throw abortReason(signal);
    if (exactBytes !== null && total !== exactBytes) throw new Error('Country detail response did not match its exact byte pin');
    return buffer.subarray(0, total);
  } finally {
    if (abortListener) signal.removeEventListener('abort', abortListener);
    if (!complete) await cancelBounded();
    try { reader.releaseLock(); } catch { /* A pending canceled read owns the lock until it settles. */ }
  }
}

function entryUrl(entry: GameMapCatalogueEntry): string {
  if (!entry.bundlePath || !/^world-country-detail\/[a-f0-9]{64}\.txt$/.test(entry.bundlePath)) throw new Error('Country detail entry has an invalid pinned bundle path');
  return safeRelativePath(`/${entry.bundlePath}`, '/world-country-detail/');
}

function choice(entry: GameMapCatalogueEntry, catalogue: GameMapCatalogue): CountryDetailChoice {
  const continent = catalogue.directory.manifest.rollups.find(row => row.id === entry.continentId)?.name;
  if (!continent) throw new Error('Country detail entry references an unknown continent rollup');
  return {
    countryId: entry.countryId,
    name: entry.name,
    continent,
    atlasId: entry.atlasFeatureId,
    status: entry.availability === 'protected' ? 'protected' : entry.availability === 'missing-outline' ? 'missing' : 'mapped',
  };
}

function displayCatalogue(catalogue: GameMapCatalogue): CountryDetailCatalogue {
  return {
    countries: catalogue.entries.map(entry => choice(entry, catalogue)),
    sourceLabel: `${SOURCE_LABEL} · ${catalogue.source.license}`,
    sourceUrl: SOURCE_URL,
    boundaryNote: BOUNDARY_NOTE,
  };
}

function isProtected(entry: GameMapCatalogueEntry): boolean {
  return entry.countryId === 'legacy-ng' || entry.sourceIsoA2Eh === 'NG' || entry.availability === 'protected';
}

export function createCountryDetailService(options: CountryDetailDataOptions = {}): CountryDetailService {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  const pins = options.pins ?? {
    cataloguePath: COUNTRY_DETAIL_CATALOGUE_PATH,
    catalogueSha256: COUNTRY_DETAIL_CATALOGUE_SHA256,
    atlasSha256: COUNTRY_DETAIL_ATLAS_SHA256,
    directoryManifestSha256: COUNTRY_DETAIL_DIRECTORY_MANIFEST_SHA256,
    sourceSha256: COUNTRY_DETAIL_SOURCE_SHA256,
    sourceBytes: COUNTRY_DETAIL_SOURCE_BYTES,
  };
  if (!/^[a-f0-9]{64}$/.test(pins.catalogueSha256) || !/^[a-f0-9]{64}$/.test(pins.atlasSha256) ||
      !/^[a-f0-9]{64}$/.test(pins.directoryManifestSha256) || !/^[a-f0-9]{64}$/.test(pins.sourceSha256) ||
      !Number.isSafeInteger(pins.sourceBytes) || pins.sourceBytes < 1 ||
      pins.cataloguePath !== `/world-country-detail/catalogue-v1-${pins.catalogueSha256}.txt`) {
    throw new TypeError('Generated country-detail pins are invalid');
  }
  const cache = new Map<string, CacheEntry>();
  let cachedCatalogue: GameMapCatalogue | null = null;
  let cataloguePromise: Promise<GameMapCatalogue> | null = null;
  let active: AbortController | null = null;
  let generation = 0;
  let cacheBytes = 0;
  let useClock = 0;

  async function operation<T>(callerSignal: AbortSignal, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (callerSignal.aborted) throw abortReason(callerSignal);
    active?.abort(new DOMException('Superseded by a newer country detail request.', 'AbortError'));
    cataloguePromise = null;
    const controller = new AbortController(); active = controller;
    const token = ++generation;
    const forwardAbort = () => controller.abort(abortReason(callerSignal));
    callerSignal.addEventListener('abort', forwardAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(new DOMException('Country detail request timed out.', 'TimeoutError')), REQUEST_TIMEOUT_MS);
    try {
      const value = await withAbort(Promise.resolve().then(() => run(controller.signal)), controller.signal);
      if (controller.signal.aborted) throw abortReason(controller.signal);
      if (token !== generation) throw new DOMException('Country detail request was superseded.', 'AbortError');
      return value;
    } finally {
      clearTimeout(timeout); callerSignal.removeEventListener('abort', forwardAbort);
      if (active === controller) active = null;
    }
  }

  async function getCatalogue(signal: AbortSignal): Promise<GameMapCatalogue> {
    if (signal.aborted) throw abortReason(signal);
    if (cachedCatalogue) return cachedCatalogue;
    if (cataloguePromise) return cataloguePromise;
    const path = safeRelativePath(pins.cataloguePath, '/world-country-detail/');
    const promise = (async () => {
      const response = await fetchWithAbort(fetcher, path, { method: 'GET', mode: 'same-origin', credentials: 'omit', redirect: 'manual', cache: 'no-store', signal }, signal);
      await assertResponse(response, path, signal, 'Country catalogue');
      const bytes = await readBounded(response, CATALOGUE_CAP, null, signal);
      if (signal.aborted) throw abortReason(signal);
      if (await sha256Hex(bytes) !== pins.catalogueSha256) throw new Error('Country catalogue hash differs from the generated pin');
      let parsed: unknown;
      try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; }
      catch { throw new TypeError('Country catalogue is not valid UTF-8 JSON'); }
      const validated = await validateGameMapCatalogue(parsed, { atlasSha256: pins.atlasSha256, directoryManifestHash: pins.directoryManifestSha256 });
      if (signal.aborted) throw abortReason(signal);
      if (validated.source.sha256 !== pins.sourceSha256 || validated.source.bytes !== pins.sourceBytes) throw new Error('Country catalogue source differs from the generated source pin');
      cachedCatalogue = validated;
      return validated;
    })();
    cataloguePromise = promise;
    try { return await promise; }
    finally { if (cataloguePromise === promise) cataloguePromise = null; }
  }

  function touch(key: string): Uint8Array | null {
    const item = cache.get(key);
    if (!item) return null;
    item.used = ++useClock;
    return item.bytes;
  }

  function keep(key: string, bytes: Uint8Array): void {
    const copy = new Uint8Array(bytes.byteLength); copy.set(bytes);
    const existing = cache.get(key);
    if (existing) cacheBytes -= existing.bytes.byteLength;
    cache.set(key, { bytes: copy, used: ++useClock }); cacheBytes += copy.byteLength;
    while (cache.size > CACHE_ENTRY_CAP || cacheBytes > TOTAL_CACHE_CAP) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].used - b[1].used)[0];
      if (!oldest) break;
      cache.delete(oldest[0]); cacheBytes -= oldest[1].bytes.byteLength;
    }
  }

  async function verify(bytes: Uint8Array, entry: GameMapCatalogueEntry, catalogue: GameMapCatalogue, signal: AbortSignal): Promise<CountryDetailOutline> {
    if (signal.aborted) throw abortReason(signal);
    const verified: VerifiedGameMapBundle = await verifyGameMapBundle(bytes, entry, catalogue);
    if (signal.aborted) throw abortReason(signal);
    return {
      country: choice(entry, catalogue),
      geometry: verified.geometry,
      attribution: verified.attribution.join('; '),
      limitations: verified.limitations,
    };
  }

  return {
    catalogue(signal) { return operation(signal, async currentSignal => displayCatalogue(await getCatalogue(currentSignal))); },
    load(countryId, callerSignal) {
      return operation(callerSignal, async signal => {
        const catalogue = await getCatalogue(signal);
        if (signal.aborted) throw abortReason(signal);
        const entry = catalogue.entries.find(row => row.countryId === countryId);
        if (!entry) throw new Error('Country is not present in the verified catalogue');
        if (isProtected(entry)) throw new Error('Nigeria is protected and uses the existing map');
        if (entry.availability !== 'mapped') throw new Error('This country has no published outline bundle');
        const url = entryUrl(entry);
        const cacheKey = `${entry.bundleSha256}:${entry.bundleBytes}`;
        const cached = touch(cacheKey);
        if (cached) {
          if (signal.aborted) throw abortReason(signal);
          if (await sha256Hex(cached) !== entry.bundleSha256) { cache.delete(cacheKey); cacheBytes -= cached.byteLength; throw new Error('Cached country bundle failed its hash check'); }
          const outline = await verify(cached, entry, catalogue, signal);
          if (signal.aborted) throw abortReason(signal);
          return outline;
        }
        if (!entry.bundleBytes || entry.bundleBytes > BUNDLE_CAP) throw new RangeError('Country bundle exceeds the runtime byte cap');
        const response = await fetchWithAbort(fetcher, url, { method: 'GET', mode: 'same-origin', credentials: 'omit', redirect: 'manual', cache: 'no-store', signal }, signal);
        await assertResponse(response, url, signal, 'Country bundle');
        const bytes = await readBounded(response, BUNDLE_CAP, entry.bundleBytes, signal);
        if (signal.aborted) throw abortReason(signal);
        if (await sha256Hex(bytes) !== entry.bundleSha256) throw new Error('Country bundle hash differs from the catalogue pin');
        const outline = await verify(bytes, entry, catalogue, signal);
        if (signal.aborted) throw abortReason(signal);
        keep(cacheKey, bytes);
        if (signal.aborted) throw abortReason(signal);
        return outline;
      });
    },
  };
}
