import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SETTLEMENT_COMPILER, SETTLEMENT_PRODUCT, type SettlementProductManifest } from '../settlement-product-types.ts';
import { SettlementReader } from './settlement-reader.ts';
import type { SettlementBinding } from './settlement-client-types.ts';

const release = 'a'.repeat(40), hash = async (bytes: Uint8Array) => {
  const copied = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', copied))].map(x => x.toString(16).padStart(2, '0')).join('');
};
const enc = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const parentHash = 'e'.repeat(64);
const parentSource = {
  id: `natural-earth-admin0-10m-${release}`,
  url: `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${release}/geojson/ne_10m_admin_0_countries.geojson`,
  release, license: 'Public-domain', attribution: 'Synthetic parent source fixture', sha256: 'd'.repeat(64), bytes: 234,
};
type Fixture = { manifestHash: string; manifestUrl: string; manifest: SettlementProductManifest; pointsBody: Uint8Array; binding: SettlementBinding; bodies: Map<string, Uint8Array> };

async function fixture(): Promise<Fixture> {
  const countryId = 'country:natural-earth:NE_ID%3A1';
  const pointsValue = { schemaVersion: 1, product: SETTLEMENT_PRODUCT, countryId, sourceSha256: 'b'.repeat(64), parentManifestHash: parentHash,
    sourceUnits: 4, emittedUnits: 1, rows: [{ sourceOrdinal: 3, sourceKey: 'NE_ID:1', id: 'place:natural-earth:NE_ID%3A1', name: 'Accra', nameAscii: 'Accra', sourceClass: 'Populated place', scaleRank: 4, coordinates: [-0.2, 5.6] }] };
  const pointsBody = enc(pointsValue), pointsHash = await hash(pointsBody);
  const secondCountryId = 'country:natural-earth:NE_ID%3A2';
  const otherPointsBody = enc({ ...pointsValue, countryId: secondCountryId, sourceUnits: 1, rows: [{ ...pointsValue.rows[0], sourceOrdinal: 4, sourceKey: 'NE_ID:2', id: 'place:natural-earth:NE_ID%3A2', name: 'Kumasi' }] });
  const otherPointsHash = await hash(otherPointsBody);
  const manifest: SettlementProductManifest = {
    schemaVersion: 1, product: SETTLEMENT_PRODUCT, compiler: SETTLEMENT_COMPILER,
    source: { id: `natural-earth-places-10m-${release}`, url: `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${release}/geojson/ne_10m_populated_places.geojson`, release, license: 'Public-domain', attribution: 'Synthetic places source fixture', sha256: 'b'.repeat(64), bytes: 321 },
    parent: { manifestHash: parentHash, source: parentSource }, joinPolicy: 'literal-ADM0_A3-v1', keyField: 'NE_ID', countryField: 'ADM0_A3',
    representation: 'selected-source-point-geometry', validation: 'source-bound-structural-with-explicit-exceptions',
    sourceUnits: 6, validPoints: 3, linked: 5, protected: 1, unlinked: 0, ambiguous: 0, invalidRows: 3, emittedUnits: 2, exceptionUnits: 4,
    inspection: { path: `reports/${'a'.repeat(64)}.json`, sha256: 'a'.repeat(64), bytes: 1024 },
    countries: [
      { countryId, status: 'available', sourceUnits: 4, emittedUnits: 1, points: { path: `points/${pointsHash}.json`, sha256: pointsHash, bytes: pointsBody.byteLength } },
      { countryId: secondCountryId, status: 'available', sourceUnits: 1, emittedUnits: 1, points: { path: `points/${otherPointsHash}.json`, sha256: otherPointsHash, bytes: otherPointsBody.byteLength } },
      { countryId: 'country:natural-earth:NE_ID%3A3', status: 'missing', sourceUnits: 0, emittedUnits: 0, points: null },
      { countryId: 'legacy-ng', status: 'protected', sourceUnits: 1, emittedUnits: 0, points: null },
    ],
    limitations: ['Selected reference points are not exhaustive.', 'This is not a legal boundary assertion.', 'No Admin 1 containment is included.', 'Points are not playable destinations.'],
  };
  const manifestBody = enc(manifest), manifestHash = await hash(manifestBody);
  const manifestUrl = `https://atlas.test/world-output/selected-places/manifests/${manifestHash}.json`;
  return { manifestHash, manifestUrl, manifest, pointsBody, binding: { countryId, countryName: 'Synthetic', provider: 'world', parentManifestHash: parentHash, parentSource },
    bodies: new Map([[manifestUrl, manifestBody], [`https://atlas.test/world-output/selected-places/points/${pointsHash}.json`, pointsBody], [`https://atlas.test/world-output/selected-places/points/${otherPointsHash}.json`, otherPointsBody]]) };
}

function response(url: string, bytes: Uint8Array, headers: Record<string, string> = {}): Response {
  const responseHeaders: Record<string, string> = { 'content-type': 'application/json', ...headers };
  const omitLength = responseHeaders['content-length'] === '';
  if (omitLength) delete responseHeaders['content-length'];
  if (!omitLength && !Object.hasOwn(responseHeaders, 'content-length')) responseHeaders['content-length'] = String(bytes.byteLength);
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const result = new Response(body, { status: 200, headers: responseHeaders });
  Object.defineProperty(result, 'url', { value: url });
  return result;
}

test('fetches only the manifest and selected country, then revalidates cached bytes without more traffic', async () => {
  const f = await fixture(), requested: string[] = [];
  const reader = new SettlementReader({ origin: 'https://atlas.test', fetcher: async (input, init) => {
    const url = String(input); requested.push(url); assert.equal(init?.redirect, 'error');
    const bytes = f.bodies.get(url); if (!bytes) throw new Error('unexpected eager request'); return response(url, bytes);
  } });
  const first = await reader.load(f.manifestUrl, f.manifestHash, f.binding);
  assert.equal(first.status, 'available'); assert.equal(first.cached, false); assert.equal(first.points?.rows[0]?.name, 'Accra');
  assert.equal(requested.length, 2); assert.match(requested[1]!, /\/points\//u);
  const cached = await reader.load(f.manifestUrl, f.manifestHash, f.binding);
  assert.equal(cached.cached, true); assert.equal(requested.length, 2);
  cached.points!.rows[0]!.name = 'mutated';
  assert.equal((await reader.load(f.manifestUrl, f.manifestHash, f.binding)).points?.rows[0]?.name, 'Accra');
  assert.equal(reader.snapshot.requestStarts, 2);
  assert.equal(reader.snapshot.downloadedBytes, f.bodies.get(f.manifestUrl)!.byteLength + f.pointsBody.byteLength);
  const second = await reader.load(new URL(f.manifestUrl).pathname, f.manifestHash, { ...f.binding, countryId: 'country:natural-earth:NE_ID%3A2', countryName: 'Other' });
  assert.equal(second.status, 'available'); assert.equal(second.points?.rows[0]?.name, 'Kumasi');
  assert.equal(requested.length, 3); assert.match(requested[2]!, /\/points\//u);
});

test('protected and missing selections do not request country points; parent mismatch stops before points', async () => {
  const f = await fixture(); let calls = 0;
  const reader = new SettlementReader({ origin: 'https://atlas.test', fetcher: async input => {
    calls++; const bytes = f.bodies.get(String(input)); if (!bytes) throw new Error('unexpected request'); return response(String(input), bytes);
  } });
  const protectedResult = await reader.load('https://atlas.test/world-output/selected-places/manifests/' + 'f'.repeat(64) + '.json', 'f'.repeat(64),
    { countryId: 'legacy-ng', countryName: 'Nigeria', provider: 'legacy-ng', parentManifestHash: parentHash, parentSource });
  assert.equal(protectedResult.status, 'protected'); assert.equal(calls, 0);
  const missing = await reader.load(f.manifestUrl, f.manifestHash, { ...f.binding, countryId: 'country:natural-earth:NE_ID%3A3' });
  assert.equal(missing.status, 'missing'); assert.equal(calls, 1);
  const otherReader = new SettlementReader({ origin: 'https://atlas.test', fetcher: async input => { calls++; const bytes = f.bodies.get(String(input)); if (!bytes) throw new Error('unexpected request'); return response(String(input), bytes); } });
  await assert.rejects(otherReader.load(f.manifestUrl, f.manifestHash, { ...f.binding, parentManifestHash: 'c'.repeat(64) }), /different parent/);
  await assert.rejects(otherReader.load(f.manifestUrl, f.manifestHash, { ...f.binding, parentSource: { ...parentSource, attribution: 'Different source' } }), /different parent/);
  assert.equal(calls, 3);
});

test('rejects unsafe manifest URLs before traffic and wrong asset hashes without caching', async () => {
  const f = await fixture(); let calls = 0;
  const reader = new SettlementReader({ origin: 'https://atlas.test', fetcher: async input => { calls++; const url = String(input); const bytes = f.bodies.get(url); if (!bytes) throw new Error('unexpected request'); return response(url, bytes); } });
  const relative = new URL(f.manifestUrl).pathname;
  for (const url of [f.manifestUrl + '?x=1', f.manifestUrl.replace('https://atlas.test', 'https://evil.test'), f.manifestUrl.replace(f.manifestHash, 'f'.repeat(64)), relative.replace('/world-output/', '/other/../world-output/')]) {
    await assert.rejects(reader.load(url, f.manifestHash, f.binding));
  }
  assert.equal(calls, 0);
  const bad = new SettlementReader({ origin: 'https://atlas.test', fetcher: async input => { const url = String(input); calls++; const bytes = f.bodies.get(url); return response(url, url === f.manifestUrl && bytes ? bytes : new Uint8Array([123])); } });
  await assert.rejects(bad.load(f.manifestUrl, f.manifestHash, f.binding), /content length/);
  assert.equal(bad.snapshot.cacheEntries, 0);
});

test('enforces response byte and MIME bounds and retains observed failed-body accounting', async () => {
  const f = await fixture();
  const oversized = new SettlementReader({ origin: 'https://atlas.test', fetcher: async input => response(String(input), new Uint8Array(256 * 1024 + 1), { 'content-length': '' }) });
  await assert.rejects(oversized.load(f.manifestUrl, f.manifestHash, f.binding), /byte limit/);
  assert.equal(oversized.snapshot.downloadedBytes, 256 * 1024 + 1);
  const wrongMime = new SettlementReader({ origin: 'https://atlas.test', fetcher: async input => response(String(input), new Uint8Array([1]), { 'content-type': 'text/html' }) });
  await assert.rejects(wrongMime.load(f.manifestUrl, f.manifestHash, f.binding), /MIME/);
  assert.equal(wrongMime.snapshot.downloadedBytes, 0);
});

test('rejects same-length point tampering by hash and rejects wrong final response URL', async () => {
  const f = await fixture();
  const corrupted = new SettlementReader({ origin: 'https://atlas.test', fetcher: async input => {
    const url = String(input), bytes = f.bodies.get(url);
    if (!bytes) throw new Error('unexpected request');
    const copy = bytes.slice();
    if (url !== f.manifestUrl) copy[copy.length - 3] = copy[copy.length - 3]! ^ 1;
    return response(url, copy);
  } });
  await assert.rejects(corrupted.load(f.manifestUrl, f.manifestHash, f.binding), /hash or length mismatch/);
  assert.equal(corrupted.snapshot.cacheEntries, 0);
  assert.equal(corrupted.snapshot.downloadedBytes, f.bodies.get(f.manifestUrl)!.byteLength + f.pointsBody.byteLength);
  const wrongUrl = new SettlementReader({ origin: 'https://atlas.test', fetcher: async input => {
    const url = String(input), bytes = f.bodies.get(url); if (!bytes) throw new Error('unexpected request');
    return response('https://elsewhere.test/redirected', bytes);
  } });
  await assert.rejects(wrongUrl.load(f.manifestUrl, f.manifestHash, f.binding), /response URL/);
});

test('concurrent fresh loads are capped at two and aborted queued work leaves no waiter', async () => {
  const f = await fixture();
  const controller = new AbortController();
  let waitForFetch!: () => void;
  const entered = new Promise<void>(resolve => { waitForFetch = resolve; });
  let fetches = 0;
  const reader = new SettlementReader({ origin: 'https://atlas.test', fetcher: (_input, init) => {
    fetches++; waitForFetch();
    return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }));
  } });
  const jobs = Array.from({ length: 34 }, () => reader.load(f.manifestUrl, f.manifestHash, f.binding, controller.signal));
  await entered;
  for (let tries = 0; tries < 100 && reader.snapshot.queuedRequests < 32; tries++) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(reader.snapshot.inflightRequests, 2); assert.equal(reader.snapshot.queuedRequests, 32); assert.equal(fetches, 2);
  const extra = await reader.load(f.manifestUrl, f.manifestHash, f.binding).catch(error => error);
  assert.ok(extra instanceof RangeError);
  controller.abort(new DOMException('fixture cancel', 'AbortError'));
  const results = await Promise.allSettled(jobs);
  assert.equal(results.filter(result => result.status === 'rejected').length, 34);
  assert.equal(reader.snapshot.inflightRequests, 0); assert.equal(reader.snapshot.queuedRequests, 0);
  const already = new AbortController(); already.abort();
  await assert.rejects(reader.load(f.manifestUrl, f.manifestHash, f.binding, already.signal), { name: 'AbortError' });
  assert.equal(reader.snapshot.requestStarts, 2);
});

test('complete cache hits bypass two occupied fetch slots', async () => {
  const f = await fixture(); let blockSecond = false, secondCalls = 0;
  const reader = new SettlementReader({ origin: 'https://atlas.test', fetcher: async (input, init) => {
    const url = String(input), bytes = f.bodies.get(url); if (!bytes) throw new Error('unexpected request');
    if (blockSecond && url.endsWith('/' + f.manifest.countries[1]!.points!.path)) {
      secondCalls++;
      return await new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }));
    }
    return response(url, bytes);
  } });
  await reader.load(f.manifestUrl, f.manifestHash, f.binding);
  const otherBinding = { ...f.binding, countryId: 'country:natural-earth:NE_ID%3A2' };
  blockSecond = true;
  const a = new AbortController(), b = new AbortController();
  const pendingA = reader.load(f.manifestUrl, f.manifestHash, otherBinding, a.signal);
  const pendingB = reader.load(f.manifestUrl, f.manifestHash, otherBinding, b.signal);
  for (let tries = 0; tries < 100 && reader.snapshot.inflightRequests < 2; tries++) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(reader.snapshot.inflightRequests, 2); assert.equal(secondCalls, 2);
  const cached = await reader.load(f.manifestUrl, f.manifestHash, f.binding);
  assert.equal(cached.cached, true); assert.equal(reader.snapshot.queuedRequests, 0);
  a.abort(); b.abort();
  await Promise.allSettled([pendingA, pendingB]);
  assert.equal(reader.snapshot.inflightRequests, 0);
});

test('byte LRU evicts the least-recent selected-country asset and reloads only that asset', async () => {
  const f = await fixture(), manifestBytes = f.bodies.get(f.manifestUrl)!;
  const firstPath = `https://atlas.test/world-output/selected-places/${f.manifest.countries[0]!.points!.path}`;
  const secondPath = `https://atlas.test/world-output/selected-places/${f.manifest.countries[1]!.points!.path}`;
  const firstBytes = f.bodies.get(firstPath)!, secondBytes = f.bodies.get(secondPath)!;
  const cacheBytes = manifestBytes.byteLength + Math.max(firstBytes.byteLength, secondBytes.byteLength);
  const requested: string[] = [];
  const reader = new SettlementReader({ origin: 'https://atlas.test', cacheBytes, fetcher: async input => {
    const url = String(input), bytes = f.bodies.get(url); if (!bytes) throw new Error('unexpected request'); requested.push(url); return response(url, bytes);
  } });
  await reader.load(f.manifestUrl, f.manifestHash, f.binding);
  await reader.load(f.manifestUrl, f.manifestHash, { ...f.binding, countryId: 'country:natural-earth:NE_ID%3A2' });
  assert.ok(reader.snapshot.cacheBytes <= cacheBytes);
  await reader.load(f.manifestUrl, f.manifestHash, f.binding);
  assert.deepEqual(requested, [f.manifestUrl, firstPath, secondPath, firstPath]);
  assert.equal(reader.snapshot.requestStarts, 4);
});

test('same-origin path, HTTP status, source binding and rehashed malformed point JSON fail closed', async () => {
  const f = await fixture();
  const relativeReader = new SettlementReader({ origin: 'https://atlas.test', fetcher: async input => {
    const url = String(input), bytes = f.bodies.get(url); if (!bytes) throw new Error('unexpected request'); return response(url, bytes);
  } });
  await relativeReader.load(new URL(f.manifestUrl).pathname, f.manifestHash, f.binding);
  const badStatus = new SettlementReader({ origin: 'https://atlas.test', fetcher: async input => {
    const url = String(input), bytes = f.bodies.get(url); if (!bytes) throw new Error('unexpected request');
    const result = new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { status: 404, headers: { 'content-type': 'application/json' } });
    Object.defineProperty(result, 'url', { value: url }); return result;
  } });
  await assert.rejects(badStatus.load(f.manifestUrl, f.manifestHash, f.binding), /HTTP 404/);

  const original = f.bodies.get(`https://atlas.test/world-output/selected-places/${f.manifest.countries[0]!.points!.path}`)!;
  const invalidText = new TextDecoder().decode(original).replace('[-0.2,5.6]', '[1e999,5.6]');
  const invalidPoints = new TextEncoder().encode(invalidText), invalidHash = await hash(invalidPoints);
  const alteredManifest = structuredClone(f.manifest);
  const alteredRef = alteredManifest.countries[0]!.points!;
  alteredRef.sha256 = invalidHash; alteredRef.path = `points/${invalidHash}.json`; alteredRef.bytes = invalidPoints.byteLength;
  const alteredManifestBytes = enc(alteredManifest), alteredManifestHash = await hash(alteredManifestBytes);
  const alteredUrl = `https://atlas.test/world-output/selected-places/manifests/${alteredManifestHash}.json`;
  const bodies = new Map([[alteredUrl, alteredManifestBytes], [`https://atlas.test/world-output/selected-places/${alteredRef.path}`, invalidPoints]]);
  const badShape = new SettlementReader({ origin: 'https://atlas.test', fetcher: async input => {
    const url = String(input), bytes = bodies.get(url); if (!bytes) throw new Error('unexpected request'); return response(url, bytes);
  } });
  await assert.rejects(badShape.load(alteredUrl, alteredManifestHash, f.binding), /coordinates/);
  assert.equal(badShape.snapshot.cacheEntries, 0);
});

test('cache limits are exact and clearCache preserves lifetime request accounting', async () => {
  const f = await fixture(); let calls = 0;
  const reader = new SettlementReader({ origin: 'https://atlas.test', cacheBytes: 1024, fetcher: async input => { calls++; const url = String(input); const bytes = f.bodies.get(url); if (!bytes) throw new Error('unexpected request'); return response(url, bytes); } });
  await reader.load(f.manifestUrl, f.manifestHash, f.binding);
  const before = reader.snapshot; assert.ok(before.cacheBytes <= 1024); assert.ok(before.cacheEntries <= 256);
  reader.clearCache(); assert.equal(reader.snapshot.cacheBytes, 0); assert.equal(reader.snapshot.requestStarts, before.requestStarts);
});

test('default fetch preserves the Window receiver and already-aborted reasons are preserved', async () => {
  const f = await fixture();
  const original = globalThis.fetch;
  try {
    globalThis.fetch = function(this: typeof globalThis, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      assert.equal(this, globalThis);
      const url = String(input), bytes = f.bodies.get(url);
      if (!bytes || init?.redirect !== 'error') return Promise.reject(new Error('unexpected default fetch arguments'));
      return Promise.resolve(response(url, bytes));
    };
    const reader = new SettlementReader({ origin: 'https://atlas.test' });
    const result = await reader.load(f.manifestUrl, f.manifestHash, f.binding);
    assert.equal(result.status, 'available');
    const reason = new DOMException('deadline fixture', 'TimeoutError'), aborted = new AbortController();
    aborted.abort(reason);
    await assert.rejects(reader.load(f.manifestUrl, f.manifestHash, f.binding, aborted.signal), error => error === reason);
    await assert.rejects(reader.load(f.manifestUrl, f.manifestHash, { ...f.binding, provider: 'unsupported' } as unknown as SettlementBinding), /provider is unsupported/);
  } finally { globalThis.fetch = original; }
});
