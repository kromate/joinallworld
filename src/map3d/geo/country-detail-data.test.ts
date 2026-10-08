import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalGameMapJson, sha256Hex } from '../../../world/game-map-contract.ts';
import { createCountryDetailService } from './country-detail-data.ts';
import type { CountryDetailPins } from './country-detail-data.ts';

const h = (digit: string) => digit.repeat(64);
const source = { id: 'natural-earth-admin0-10m-test', url: 'https://www.naturalearthdata.com/test', release: 'test-release', license: 'Public domain', attribution: 'Natural Earth', sha256: h('1'), bytes: 10 };

function jsonBytes(value: unknown): Uint8Array { return new TextEncoder().encode(`${canonicalGameMapJson(value)}\n`); }
async function hash(value: Uint8Array): Promise<string> { return sha256Hex(value); }
function response(bytes: Uint8Array, status = 200): Response { return new Response(Buffer.from(bytes), { status, headers: { 'content-length': String(bytes.byteLength), 'content-type': 'text/plain; charset=utf-8' } }); }

async function fixture(mappedCount = 6, missingCount = 0) {
  const entries: Record<string, unknown>[] = [];
  const bundleBodies = new Map<string, Uint8Array>();
  const manifest = {
    schemaVersion: 1, compiler: 'country-directory-compiler-v1', source,
    baselineSource: { ...source, id: 'natural-earth-admin0-10m-baseline', sha256: h('2') }, baselineInventoryHash: h('3'),
    sourceUnitCount: mappedCount + missingCount + 1, nodeCount: mappedCount + missingCount + 3, outlineCount: mappedCount, partCount: mappedCount,
    rootNodePath: `nodes/${h('4')}.json`, identityPath: `identity/${h('5')}.json`,
    rollups: [{ id: 'continent:test', name: 'Test', countryCount: mappedCount + missingCount + 1, sourceUnitCount: mappedCount + missingCount + 1, exceptionCount: missingCount }],
    representation: 'whole-polygon-groups', limits: { partBytes: 512000, countryBytes: 2097152, positions: 100000 }, exceptions: [],
  };
  const directoryManifestHash = await hash(new TextEncoder().encode(canonicalGameMapJson(manifest)));
  const coords = [[[[-1, 0], [1, 0], [0, 1], [-1, 0]]]];
  for (let i = 1; i <= mappedCount; i++) {
    const countryId = `country:natural-earth:NE_ID%3A${i}`;
    const sourceRef = `${source.id}:NE_ID:${i}`;
    const partBody = jsonBytes({ type: 'MultiPolygon', coordinates: coords });
    const partHash = await hash(partBody), partPath = `outlines/${partHash}.json`;
    const outlineIndex = { schemaVersion: 1, countryId, sourceRef, geometryType: 'Polygon', polygonCount: 1, coordinatePositions: 4, totalPartBytes: partBody.byteLength, parts: [{ path: partPath, polygonOffset: 0, polygonCount: 1, bytes: partBody.byteLength, coordinatePositions: 4 }] };
    const outlineIndexBytes = jsonBytes(outlineIndex), outlineIndexHash = await hash(outlineIndexBytes), outlineIndexPath = `outline-index/${outlineIndexHash}.json`;
    const node = { id: countryId, parentId: 'continent:test', name: `Country ${i}`, kind: 'country', countryCode: `A${String.fromCharCode(65 + i)}`, bounds: [-1, 0, 1, 1], sourceFeatureIds: [sourceRef], provider: 'world', outline: 'available', exceptions: [] };
    const nodeIndexBytes = jsonBytes({ schemaVersion: 1, node, outlineIndexPath, children: [] });
    const nodePath = `nodes/${await hash(nodeIndexBytes)}.json`;
    const bundleObject = {
      schemaVersion: 1, kind: 'country-detail-bundle', countryId, sourceRef, directoryManifestHash, atlasSha256: h('a'),
      assets: [
        { path: nodePath, encoding: 'base64', bytes: nodeIndexBytes.byteLength, sha256: await hash(nodeIndexBytes), body: Buffer.from(nodeIndexBytes).toString('base64') },
        { path: outlineIndexPath, encoding: 'base64', bytes: outlineIndexBytes.byteLength, sha256: await hash(outlineIndexBytes), body: Buffer.from(outlineIndexBytes).toString('base64') },
        { path: partPath, encoding: 'base64', bytes: partBody.byteLength, sha256: partHash, body: Buffer.from(partBody).toString('base64') },
      ], attribution: [source.attribution],
    };
    const bundle = jsonBytes(bundleObject), bundleHash = await hash(bundle);
    bundleBodies.set(`/world-country-detail/${bundleHash}.txt`, bundle);
    entries.push({ countryId, name: `Country ${i}`, sourceRef, sourceIsoA2Eh: `A${String.fromCharCode(65 + i)}`, continentId: 'continent:test', nodePath, availability: 'mapped', crosswalkState: 'not-in-coarse-atlas', atlasFeatureId: null, bundlePath: `world-country-detail/${bundleHash}.txt`, bundleSha256: bundleHash, bundleBytes: bundle.byteLength, exception: null });
  }
  for (let i = 1; i <= missingCount; i++) {
    const featureId = 100 + i;
    entries.push({ countryId: `country:natural-earth:NE_ID%3A${featureId}`, name: `Missing ${i}`, sourceRef: `${source.id}:NE_ID:${featureId}`, sourceIsoA2Eh: null, continentId: 'continent:test', nodePath: `nodes/${h('7')}.json`, availability: 'missing-outline', crosswalkState: 'not-in-coarse-atlas', atlasFeatureId: null, bundlePath: null, bundleSha256: null, bundleBytes: null, exception: 'Synthetic missing outline' });
  }
  entries.push({ countryId: 'legacy-ng', name: 'Nigeria', sourceRef: `${source.id}:NE_ID:999`, sourceIsoA2Eh: 'NG', continentId: 'continent:test', nodePath: `nodes/${h('6')}.json`, availability: 'protected', crosswalkState: 'not-in-coarse-atlas', atlasFeatureId: 'ng', bundlePath: null, bundleSha256: null, bundleBytes: null, exception: 'Protected' });
  entries.sort((a, b) => String(a.countryId) < String(b.countryId) ? -1 : String(a.countryId) > String(b.countryId) ? 1 : 0);
  // Contract sorting is Unicode codepoint ordering; these ASCII identifiers have the same order.
  const crosswalk = Array.from({ length: 236 }, (_, index) => {
    const first = String.fromCharCode(97 + Math.floor(index / 26)), second = String.fromCharCode(97 + index % 26);
    return { atlasFeatureId: `${first}${second}`, sourceIsoA2Eh: null, sourceNeId: null, countryId: null, state: 'unmatched', evidence: null };
  }).sort((a, b) => a.atlasFeatureId < b.atlasFeatureId ? -1 : a.atlasFeatureId > b.atlasFeatureId ? 1 : 0);
  const catalogueObject = {
    schemaVersion: 1, kind: 'country-detail-catalogue', atlas: { path: 'src/map3d/geo/data/world.ts', sha256: h('a'), bytes: 100, sourceScale: '1:50m' },
    source, directory: { manifestPath: `manifests/${directoryManifestHash}.json`, manifestHash: directoryManifestHash, baselineInventoryHash: h('3'), manifest },
    crosswalk, entries,
  };
  const catalogueBytes = jsonBytes(catalogueObject);
  const pins: CountryDetailPins = { cataloguePath: `/world-country-detail/catalogue-v1-${await hash(catalogueBytes)}.txt`, catalogueSha256: await hash(catalogueBytes), atlasSha256: h('a'), directoryManifestSha256: directoryManifestHash, sourceSha256: source.sha256, sourceBytes: source.bytes };
  return { catalogueBytes, bundleBodies, pins, entries };
}

test('catalogue is fetched explicitly once, validates, and loads a bounded verified bundle once', async () => {
  const data = await fixture(1); let calls = 0;
  const service = createCountryDetailService({ pins: data.pins, fetcher: async input => {
    calls++;
    const path = String(input);
    if (path === data.pins.cataloguePath) return response(data.catalogueBytes);
    const body = data.bundleBodies.get(path); return body ? response(body) : response(new Uint8Array(), 404);
  } });
  assert.equal(calls, 0);
  const signal = new AbortController().signal;
  const catalogue = await service.catalogue(signal);
  assert.equal(catalogue.countries.length, 2);
  assert.equal(catalogue.countries.find(row => row.countryId === 'legacy-ng')?.status, 'protected');
  assert.equal(calls, 1);
  const outline = await service.load('country:natural-earth:NE_ID%3A1', signal);
  assert.equal(outline.geometry.type, 'Polygon');
  assert.match(outline.attribution, /Natural Earth/);
  const again = await service.load('country:natural-earth:NE_ID%3A1', signal);
  assert.deepEqual(again.geometry, outline.geometry);
  assert.equal(calls, 2);
});

test('Nigeria and missing rows never request a bundle; malformed catalogue hash and paths fail closed', async () => {
  const data = await fixture(1, 1); let bundleCalls = 0;
  const service = createCountryDetailService({ pins: data.pins, fetcher: async input => {
    const path = String(input); if (path === data.pins.cataloguePath) return response(data.catalogueBytes);
    bundleCalls++; return response(data.bundleBodies.get(path) ?? new Uint8Array(), 404);
  } });
  await assert.rejects(service.load('legacy-ng', new AbortController().signal), /protected/i);
  const catalogue = await service.catalogue(new AbortController().signal);
  assert.equal(catalogue.countries.find(row => row.name === 'Missing 1')?.status, 'missing');
  await assert.rejects(service.load('country:natural-earth:NE_ID%3A101', new AbortController().signal), /no published outline/i);
  assert.equal(bundleCalls, 0);
  assert.throws(() => createCountryDetailService({ pins: { ...data.pins, cataloguePath: '//evil.test/file' }, fetcher: async () => { throw new Error('must not fetch'); } }), /Generated country-detail pins are invalid/);
  const wrongCatalogueHash = h('f');
  const badHash = createCountryDetailService({ pins: { ...data.pins, cataloguePath: `/world-country-detail/catalogue-v1-${wrongCatalogueHash}.txt`, catalogueSha256: wrongCatalogueHash }, fetcher: async () => response(data.catalogueBytes) });
  await assert.rejects(badHash.catalogue(new AbortController().signal), /hash/i);
  const badSourcePin = createCountryDetailService({ pins: { ...data.pins, sourceSha256: h('f') }, fetcher: async () => response(data.catalogueBytes) });
  await assert.rejects(badSourcePin.catalogue(new AbortController().signal), /source differs/i);
  const foreign = response(data.catalogueBytes);
  Object.defineProperty(foreign, 'url', { value: 'https://evil.example/world-country-detail/catalogue.txt' });
  const foreignOrigin = createCountryDetailService({ pins: data.pins, fetcher: async () => foreign });
  await assert.rejects(foreignOrigin.catalogue(new AbortController().signal), /outside its pinned same-origin path/i);
});

test('bundle failures do not enter the cache and a later retry can succeed', async () => {
  const data = await fixture(1); let bundleCalls = 0, first = true;
  const service = createCountryDetailService({ pins: data.pins, fetcher: async input => {
    const path = String(input); if (path === data.pins.cataloguePath) return response(data.catalogueBytes);
    bundleCalls++;
    const body = data.bundleBodies.get(path)!;
    if (first) { first = false; return response(body.subarray(0, body.byteLength - 1)); }
    return response(body);
  } });
  const signal = new AbortController().signal;
  await service.catalogue(signal);
  await assert.rejects(service.load('country:natural-earth:NE_ID%3A1', signal));
  await service.load('country:natural-earth:NE_ID%3A1', signal);
  assert.equal(bundleCalls, 2);
});

test('browser-decoded gzip, deflate, Brotli and Zstandard transport verifies catalogue and bundle bytes', async () => {
  const data = await fixture(1);
  // These responses model Fetch's already-decoded body and retained wire headers. Decoding
  // itself belongs to the browser and is separately exercised against the production CDN.
  for (const encoding of ['gzip', 'deflate', 'br', 'zstd', 'ZSTD']) {
    const service = createCountryDetailService({ pins: data.pins, fetcher: async input => {
      const path = String(input);
      const body = path === data.pins.cataloguePath ? data.catalogueBytes : data.bundleBodies.get(path)!;
      return new Response(Buffer.from(body), { headers: { 'content-encoding': encoding, 'content-length': String(body.byteLength - 1) } });
    } });
    const catalogue = await service.catalogue(new AbortController().signal);
    assert.equal(catalogue.countries.length, 2, encoding);
    const outline = await service.load('country:natural-earth:NE_ID%3A1', new AbortController().signal);
    assert.equal(outline.country.name, 'Country 1', encoding);
  }
});

test('Zstandard headers cannot bypass decoded byte pins, hashes or cache admission', async () => {
  const data = await fixture(1); let bundleCalls = 0;
  const service = createCountryDetailService({ pins: data.pins, fetcher: async input => {
    const path = String(input); if (path === data.pins.cataloguePath) return response(data.catalogueBytes);
    const original = data.bundleBodies.get(path)!;
    const body = new Uint8Array(original); bundleCalls++;
    if (bundleCalls === 1) body[0] ^= 1;
    const delivered = bundleCalls === 2 ? body.subarray(0, body.byteLength - 1) : body;
    return new Response(Buffer.from(delivered), { headers: { 'content-encoding': 'zstd', 'content-length': '1' } });
  } });
  const signal = new AbortController().signal;
  await assert.rejects(service.load('country:natural-earth:NE_ID%3A1', signal), /hash differs/);
  await assert.rejects(service.load('country:natural-earth:NE_ID%3A1', signal), /exact byte pin/);
  await service.load('country:natural-earth:NE_ID%3A1', signal);
  await service.load('country:natural-earth:NE_ID%3A1', signal);
  assert.equal(bundleCalls, 3, 'only the verified third response enters the cache');
});

test('unknown or stacked transport encodings are rejected and canceled before reading', async () => {
  const data = await fixture(1);
  for (const encoding of ['unknown', 'gzip, zstd']) {
    let reads = 0, canceled = 0;
    const service = createCountryDetailService({ pins: data.pins, fetcher: async () => new Response(
      new ReadableStream<Uint8Array>({ pull() { reads++; }, cancel() { canceled++; } }, { highWaterMark: 0 }),
      { headers: { 'content-encoding': encoding } },
    ) });
    await assert.rejects(service.catalogue(new AbortController().signal), /encoding is unsupported/);
    assert.equal(reads, 0); assert.equal(canceled, 1);
  }
});

test('compressed response cannot conceal an oversized decoded stream', async () => {
  const data = await fixture(1); let canceled = 0;
  const service = createCountryDetailService({ pins: data.pins, fetcher: async input => {
    const path = String(input); if (path === data.pins.cataloguePath) return response(data.catalogueBytes);
    const body = data.bundleBodies.get(path)!;
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(body); controller.enqueue(new Uint8Array([0])); },
      cancel() { canceled++; },
    }), { headers: { 'content-encoding': 'zstd', 'content-length': '1' } });
  } });
  await assert.rejects(service.load('country:natural-earth:NE_ID%3A1', new AbortController().signal), /exceeded its byte bound/);
  assert.equal(canceled, 1);
});

test('raw bundle cache retains at most four verified entries and reloads the evicted least-recently-used entry', async () => {
  const data = await fixture(5); let bundleCalls = 0;
  const service = createCountryDetailService({ pins: data.pins, fetcher: async input => {
    const path = String(input); if (path === data.pins.cataloguePath) return response(data.catalogueBytes);
    bundleCalls++; const body = data.bundleBodies.get(path); return body ? response(body) : response(new Uint8Array(), 404);
  } });
  const signal = new AbortController().signal;
  await service.catalogue(signal);
  for (let i = 1; i <= 5; i++) await service.load(`country:natural-earth:NE_ID%3A${i}`, signal);
  assert.equal(bundleCalls, 5);
  await service.load('country:natural-earth:NE_ID%3A1', signal);
  assert.equal(bundleCalls, 6);
});

test('fatal UTF-8 and exact-length failures cancel their response streams', async () => {
  const data = await fixture(1); let canceled = 0;
  const cancelledStream = (bytes: Uint8Array): Response => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(bytes); controller.close(); },
    cancel() { canceled++; },
  }));
  const invalid = new Uint8Array([0xff]); const invalidHash = await hash(invalid);
  const badUtf8Pins = { ...data.pins, catalogueSha256: invalidHash, cataloguePath: `/world-country-detail/catalogue-v1-${invalidHash}.txt` };
  const badUtf8 = createCountryDetailService({ pins: badUtf8Pins, fetcher: async () => cancelledStream(invalid) });
  await assert.rejects(badUtf8.catalogue(new AbortController().signal), /UTF-8/i);
  const service = createCountryDetailService({ pins: data.pins, fetcher: async input => {
    const path = String(input); if (path === data.pins.cataloguePath) return response(data.catalogueBytes);
    const body = data.bundleBodies.get(path)!;
    return new Response(new ReadableStream<Uint8Array<ArrayBuffer>>({ start(controller) { controller.enqueue(Buffer.from(body)); }, cancel() { canceled++; } }), { headers: { 'content-length': String(body.byteLength - 1) } });
  } });
  await service.catalogue(new AbortController().signal);
  await assert.rejects(service.load('country:natural-earth:NE_ID%3A1', new AbortController().signal), /length/i);
  assert.ok(canceled >= 1);
});

test('new operation aborts a stale response, then permits a clean retry', async () => {
  const data = await fixture(1); let release!: (value: Response) => void; let bundleCalls = 0;
  const service = createCountryDetailService({ pins: data.pins, fetcher: async input => {
    const path = String(input);
    if (path === data.pins.cataloguePath) return response(data.catalogueBytes);
    bundleCalls++;
    if (bundleCalls === 1) return await new Promise<Response>(resolve => { release = resolve; });
    return response(data.bundleBodies.get(path)!);
  } });
  const signal = new AbortController().signal;
  await service.catalogue(signal);
  const stale = service.load('country:natural-earth:NE_ID%3A1', signal);
  await new Promise(resolve => setImmediate(resolve));
  const fresh = service.load('country:natural-earth:NE_ID%3A1', signal);
  await assert.rejects(stale);
  await fresh;
  release?.(response(new Uint8Array()));
  assert.equal(bundleCalls, 2);
});
