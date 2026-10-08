import { SETTLEMENT_PRODUCT_LIMITS } from '../settlement-product-types.ts';
import { validateSettlementCountryPoints, validateSettlementManifest } from './settlement-view.ts';
import { SETTLEMENT_PREVIEW_LIMITS, type SettlementBinding, type SettlementClientOptions, type SettlementReadResult, type SettlementReaderSnapshot } from './settlement-client-types.ts';

const MANIFEST_LIMIT = 256 * 1024;
const POINTS_LIMIT = 512_000;
const DEFAULT_CACHE = SETTLEMENT_PRODUCT_LIMITS.browserCacheBytes;
const HASH = /^[a-f0-9]{64}$/u;
const MANIFEST_PATH = /^\/world-output\/selected-places\/manifests\/([a-f0-9]{64})\.json$/u;

type CacheEntry = { bytes: Uint8Array };
type Waiter = { resolve: (release: () => void) => void; reject: (error: Error) => void; signal: AbortSignal; abort: () => void; cancelTimer: () => void };

function sameSource(a: SettlementBinding['parentSource'], b: SettlementBinding['parentSource']): boolean {
  return a.id === b.id && a.url === b.url && a.release === b.release && a.license === b.license
    && a.attribution === b.attribution && a.sha256 === b.sha256 && a.bytes === b.bytes;
}
function digest(bytes: Uint8Array): Promise<string> {
  const copied = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return crypto.subtle.digest('SHA-256', copied).then(value => [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, '0')).join(''));
}
function abortError(message = 'settlement request aborted'): Error {
  return new DOMException(message, 'AbortError');
}

/** Same-origin, hash-bound selected-place reader. It never requests unselected country assets. */
export class SettlementReader {
  private readonly origin: string;
  private readonly fetcher: typeof fetch;
  private readonly maxCacheBytes: number;
  private readonly changed?: SettlementClientOptions['changed'];
  private readonly cache = new Map<string, CacheEntry>();
  private cacheByteCount = 0;
  private downloaded = 0;
  private starts = 0;
  private active = 0;
  private readonly queue: Waiter[] = [];

  constructor(options: SettlementClientOptions) {
    let origin: URL;
    try { origin = new URL(options.origin); } catch { throw new TypeError('settlement origin must be an HTTP(S) origin'); }
    if ((origin.protocol !== 'https:' && origin.protocol !== 'http:') || origin.origin !== options.origin
      || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
      throw new TypeError('settlement origin must be an HTTP(S) origin');
    }
    if (options.cacheBytes !== undefined && (!Number.isSafeInteger(options.cacheBytes) || options.cacheBytes < 1 || options.cacheBytes > DEFAULT_CACHE)) {
      throw new RangeError('settlement cacheBytes must be a positive value no larger than 5 MiB');
    }
    this.origin = origin.origin;
    this.fetcher = options.fetcher ?? ((input, init) => globalThis.fetch(input, init));
    this.maxCacheBytes = options.cacheBytes ?? DEFAULT_CACHE;
    this.changed = options.changed;
  }

  get snapshot(): SettlementReaderSnapshot {
    return { downloadedBytes: this.downloaded, cacheBytes: this.cacheByteCount, cacheEntries: this.cache.size,
      requestStarts: this.starts, inflightRequests: this.active, queuedRequests: this.queue.length };
  }

  clearCache(): void { this.cache.clear(); this.cacheByteCount = 0; this.publish(); }

  async load(manifestUrl: string, manifestHash: string, binding: SettlementBinding, signal?: AbortSignal): Promise<SettlementReadResult> {
    const started = performance.now();
    const deadline = started + SETTLEMENT_PREVIEW_LIMITS.requestMs;
    const check = () => {
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : abortError();
      if (performance.now() >= deadline) throw new DOMException('settlement request deadline exceeded', 'TimeoutError');
    };
    check();
    if (binding.provider !== 'world' && binding.provider !== 'legacy-ng') throw new TypeError('settlement provider is unsupported');
    if (binding.provider === 'legacy-ng' && binding.countryId === 'legacy-ng') {
      return { status: 'protected', manifestHash: null, manifest: null, country: null, points: null, cached: false };
    }
    if (binding.provider === 'legacy-ng' || binding.countryId === 'legacy-ng') throw new TypeError('legacy Nigeria binding is inconsistent');
    const manifestAddress = this.validateManifestUrl(manifestUrl, manifestHash);
    let release: (() => void) | undefined;
    try {
    check();
    const manifestKey = `${manifestAddress.href}:${manifestHash}`;
    const cachedManifest = this.cacheGet(manifestKey);
    if (!cachedManifest) release = await this.acquire(deadline, signal);
    const manifestBytes = cachedManifest ?? await this.requestBytes(manifestAddress, MANIFEST_LIMIT, deadline, signal);
    check();
    if (await digest(manifestBytes) !== manifestHash) throw new TypeError('settlement manifest content hash mismatch');
    const manifest = validateSettlementManifest(this.parseJson(manifestBytes, 'settlement manifest'));
    if (manifest.parent.manifestHash !== binding.parentManifestHash || !sameSource(manifest.parent.source, binding.parentSource)) {
      throw new TypeError('settlement manifest is bound to a different parent inventory');
    }
    const country = manifest.countries.find(item => item.countryId === binding.countryId);
    if (!country) throw new TypeError('selected country is absent from the settlement manifest');
    if (country.status === 'missing') {
      check();
      if (!cachedManifest) this.cacheSet(manifestKey, manifestBytes);
      return { status: 'missing', manifestHash, manifest, country, points: null, cached: !!cachedManifest };
    }
    if (country.status === 'protected') throw new TypeError('only legacy Nigeria may be a protected settlement country');
    const ref = country.points;
    if (!ref) throw new TypeError('available settlement country has no point asset');
    const pointAddress = new URL(`/world-output/selected-places/${ref.path}`, this.origin);
    const pointKey = `${pointAddress.href}:${ref.sha256}`;
    const cachedPoints = this.cacheGet(pointKey);
    if (!cachedPoints && !release) release = await this.acquire(deadline, signal);
    const pointsBytes = cachedPoints ?? await this.requestBytes(pointAddress, POINTS_LIMIT, deadline, signal, ref.bytes);
    check();
    if (pointsBytes.byteLength !== ref.bytes || await digest(pointsBytes) !== ref.sha256) throw new TypeError('settlement country point asset hash or length mismatch');
    const points = validateSettlementCountryPoints(this.parseJson(pointsBytes, 'settlement country points'), manifest, country);
    check();
    if (!cachedManifest) this.cacheSet(manifestKey, manifestBytes);
    if (!cachedPoints) this.cacheSet(pointKey, pointsBytes);
    return { status: 'available', manifestHash, manifest, country, points, cached: !!cachedManifest && !!cachedPoints };
    } finally { release?.(); }
  }

  private validateManifestUrl(value: string, hash: string): URL {
    if (!HASH.test(hash)) throw new TypeError('manifest hash must be a lowercase SHA-256');
    if (typeof value !== 'string') throw new TypeError('manifest URL is invalid');
    let url: URL;
    try { url = new URL(value, this.origin); } catch { throw new TypeError('manifest URL is invalid'); }
    const match = MANIFEST_PATH.exec(url.pathname);
    const isRelative = value.startsWith('/') && !value.startsWith('//');
    if (url.origin !== this.origin || url.protocol !== new URL(this.origin).protocol || url.username || url.password
      || url.search || url.hash || !match || match[1] !== hash || url.href !== `${this.origin}${url.pathname}`
      || (isRelative ? value !== url.pathname : value !== url.href)) {
      throw new TypeError('manifest URL is outside the exact same-origin hash-addressed route');
    }
    return url;
  }

  private parseJson(bytes: Uint8Array, label: string): unknown {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new TypeError(`${label} is not valid UTF-8`); }
    try { return JSON.parse(text) as unknown; } catch { throw new TypeError(`${label} is not valid JSON`); }
  }

  private async requestBytes(url: URL, cap: number, deadline: number, signal?: AbortSignal, exactBytes?: number): Promise<Uint8Array> {
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;
    let response: Response | undefined;
    try {
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : abortError();
      if (performance.now() >= deadline) throw new DOMException('settlement request deadline exceeded', 'TimeoutError');
      this.starts++;
      this.publish();
      controller = new AbortController();
      abortListener = () => controller?.abort(signal?.reason instanceof Error ? signal.reason : abortError());
      signal?.addEventListener('abort', abortListener, { once: true });
      timer = setTimeout(() => controller?.abort(new DOMException('settlement request deadline exceeded', 'TimeoutError')), Math.max(0, deadline - performance.now()));
      let rejectAbort!: (error: Error) => void;
      const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
      const abortFetch = () => rejectAbort(controller?.signal.reason instanceof Error ? controller.signal.reason : abortError());
      controller.signal.addEventListener('abort', abortFetch, { once: true });
      try {
        response = await Promise.race([this.fetcher(url.href, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json' } }), aborted]);
      } finally { controller.signal.removeEventListener('abort', abortFetch); }
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : abortError();
      if (performance.now() >= deadline) throw new DOMException('settlement request deadline exceeded', 'TimeoutError');
      if (!response.ok || response.status !== 200) { await this.cancelBody(response); throw new Error(`settlement request returned HTTP ${response.status}`); }
      if (response.redirected || response.url !== url.href) { await this.cancelBody(response); throw new TypeError('settlement response URL does not match the requested asset'); }
      const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
      if (!(contentType === 'application/json' || (contentType.startsWith('application/') && contentType.endsWith('+json')))) {
        await this.cancelBody(response); throw new TypeError('settlement response MIME type is not JSON');
      }
      const encoding = response.headers.get('content-encoding');
      if (encoding && encoding.toLowerCase() !== 'identity') { await this.cancelBody(response); throw new TypeError('settlement response content encoding is unsupported'); }
      const lengthHeader = response.headers.get('content-length');
      if (lengthHeader !== null && (!/^\d+$/u.test(lengthHeader) || !Number.isSafeInteger(Number(lengthHeader))
        || Number(lengthHeader) > cap || (exactBytes !== undefined && Number(lengthHeader) !== exactBytes))) {
        await this.cancelBody(response); throw new RangeError('settlement response content length is invalid or over budget');
      }
      return await this.readBody(response, cap, controller.signal, deadline);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abortListener) signal?.removeEventListener('abort', abortListener);
      if (controller && !controller.signal.aborted) controller.abort();
      if (response?.body && !response.bodyUsed) await this.cancelBody(response);
    }
  }

  private async readBody(response: Response, cap: number, signal: AbortSignal | undefined, deadline: number): Promise<Uint8Array> {
    if (!response.body) throw new TypeError('settlement response has no body');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let abortReject!: (error: Error) => void;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const aborted = new Promise<never>((_, reject) => { abortReject = reject; });
    const onAbort = () => { void reader.cancel().catch(() => undefined); abortReject(signal?.reason instanceof Error ? signal.reason : abortError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      while (true) {
        if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : abortError();
        const remaining = deadline - performance.now();
        if (remaining <= 0) throw new DOMException('settlement request deadline exceeded', 'TimeoutError');
        const timed = new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new DOMException('settlement request deadline exceeded', 'TimeoutError')), remaining); });
        const result = await Promise.race([reader.read(), aborted, timed]);
        if (timeout !== undefined) clearTimeout(timeout);
        if (result.done) break;
        const chunk = result.value;
        total += chunk.byteLength; this.downloaded += chunk.byteLength; this.publish();
        if (total > cap) throw new RangeError('settlement response exceeded its byte limit');
        chunks.push(chunk.slice());
      }
      const out = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
      return out;
    } finally {
      signal?.removeEventListener('abort', onAbort);
      if (timeout !== undefined) clearTimeout(timeout);
      try { await Promise.race([reader.cancel(), new Promise(resolve => setTimeout(resolve, 100))]); } catch { /* cancellation is best-effort and bounded */ }
      try { reader.releaseLock(); } catch { /* a late native read may still hold it */ }
    }
  }

  private async cancelBody(response: Response): Promise<void> {
    if (!response.body) return;
    try { await Promise.race([response.body.cancel(), new Promise(resolve => setTimeout(resolve, 100))]); } catch { /* bounded cleanup */ }
  }

  private async acquire(deadline: number, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : abortError();
    if (performance.now() >= deadline) throw new DOMException('settlement request deadline exceeded', 'TimeoutError');
    if (this.active < 2) return this.acquireSlot(signal);
    if (this.queue.length >= SETTLEMENT_PREVIEW_LIMITS.queuedRequests) throw new RangeError('settlement request queue is full');
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal: signal ?? new AbortController().signal, abort: () => undefined, cancelTimer: () => undefined };
      const timer = setTimeout(() => { this.removeWaiter(waiter); reject(new DOMException('settlement request deadline exceeded', 'TimeoutError')); }, Math.max(0, deadline - performance.now()));
      waiter.cancelTimer = () => clearTimeout(timer);
      waiter.abort = () => { clearTimeout(timer); this.removeWaiter(waiter); reject(waiter.signal.reason instanceof Error ? waiter.signal.reason : abortError()); };
      if (signal) signal.addEventListener('abort', waiter.abort, { once: true });
      this.queue.push(waiter); this.publish();
    });
  }

  private acquireSlot(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : abortError());
    this.active++; this.publish();
    let done = false;
    return Promise.resolve(() => {
      if (done) return; done = true; this.active--;
      const waiter = this.queue.shift();
      if (waiter) { waiter.cancelTimer(); waiter.signal.removeEventListener('abort', waiter.abort); waiter.resolve(this.makeRelease()); }
      this.publish();
    });
  }
  private makeRelease(): () => void {
    this.active++; this.publish();
    let done = false;
    return () => { if (done) return; done = true; this.active--; const next = this.queue.shift(); if (next) { next.cancelTimer(); next.signal.removeEventListener('abort', next.abort); next.resolve(this.makeRelease()); } this.publish(); };
  }
  private removeWaiter(waiter: Waiter): void {
    const index = this.queue.indexOf(waiter);
    if (index >= 0) this.queue.splice(index, 1);
    waiter.cancelTimer(); waiter.signal.removeEventListener('abort', waiter.abort); this.publish();
  }

  private cacheGet(key: string): Uint8Array | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    this.cache.delete(key); this.cache.set(key, entry); return entry.bytes.slice();
  }
  private cacheSet(key: string, bytes: Uint8Array): void {
    if (bytes.byteLength > this.maxCacheBytes) return;
    const old = this.cache.get(key); if (old) { this.cacheByteCount -= old.bytes.byteLength; this.cache.delete(key); }
    while (this.cache.size >= SETTLEMENT_PREVIEW_LIMITS.cacheEntries || this.cacheByteCount + bytes.byteLength > this.maxCacheBytes) {
      const first = this.cache.keys().next().value as string | undefined; if (first === undefined) break;
      const removed = this.cache.get(first)!; this.cache.delete(first); this.cacheByteCount -= removed.bytes.byteLength;
    }
    this.cache.set(key, { bytes: bytes.slice() }); this.cacheByteCount += bytes.byteLength; this.publish();
  }
  private publish(): void { try { this.changed?.({ ...this.snapshot }); } catch { /* observers cannot corrupt reader state */ } }
}
