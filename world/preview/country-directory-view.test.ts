import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { COUNTRY_DIRECTORY_COMPILER, COUNTRY_DIRECTORY_LIMITS } from '../country-directory-types.ts';
import type { CountryDirectoryManifest, CountryOutlineIndex } from '../country-directory-types.ts';
import type { InventoryNode } from '../production-types.ts';
import { CountryDirectoryJsonCache, directoryAssetUrl, fetchCountryOutline, validateCountryDirectoryIdentity, validateCountryDirectoryManifest, validateCountryDirectoryNodeIndex, validateCountryOutlineIndex } from './country-directory-view.ts';

const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
const canonical = (value: unknown): string => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value as object).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
const candidate = { id: 'candidate-10m', url: 'https://example.test/candidate.geojson', release: 'reviewed-candidate', license: 'Public-domain', attribution: 'Candidate source', sha256: 'a'.repeat(64), bytes: 1000 };
const baseline = { id: 'accepted-110m', url: 'https://example.test/baseline.geojson', release: 'accepted-baseline', license: 'Public-domain', attribution: 'Baseline source', sha256: 'b'.repeat(64), bytes: 900 };
const continentId = 'continent:africa';
const countryId = 'country:natural-earth:NE_ID%3A1';
const manifestValue = {
  schemaVersion: 1, compiler: COUNTRY_DIRECTORY_COMPILER, source: candidate, baselineSource: baseline, baselineInventoryHash: 'c'.repeat(64),
  sourceUnitCount: 2, nodeCount: 4, outlineCount: 1, partCount: 2,
  rootNodePath: `nodes/${'d'.repeat(64)}.json`, identityPath: `identity/${'e'.repeat(64)}.json`,
  rollups: [{ id: continentId, name: 'Africa', countryCount: 2, sourceUnitCount: 2, exceptionCount: 0 }],
  representation: 'whole-polygon-groups', limits: { partBytes: 512000, countryBytes: 2097152, positions: 100000 }, exceptions: [],
};
const manifest = validateCountryDirectoryManifest(manifestValue);
const candidateNode: InventoryNode = { id: countryId, parentId: continentId, name: 'Example', kind: 'country', countryCode: 'AA', bounds: [0,0,4,4],
  sourceFeatureIds: ['candidate-10m:NE_ID:1'], provider: 'world', outline: 'available', exceptions: [] };
const nigeriaNode: InventoryNode = { id: 'legacy-ng', parentId: continentId, name: 'Nigeria', kind: 'country', countryCode: 'NG', bounds: null,
  sourceFeatureIds: ['candidate-10m:NE_ID:159'], provider: 'legacy-ng', outline: 'missing', exceptions: ['protected legacy Nigeria provider'] };
const outerA = [[0,0],[2,0],[2,2],[0,2],[0,0]];
const holeA = [[0.5,0.5],[1,0.5],[1,1],[0.5,1],[0.5,0.5]];
const outerB = [[3,0],[4,0],[4,1],[3,1],[3,0]];
const polygons = [[outerA,holeA],[outerB]];
const partA = { type: 'MultiPolygon', coordinates: [polygons[0]] };
const partB = { type: 'MultiPolygon', coordinates: [polygons[1]] };
const partAText = canonical(partA), partBText = canonical(partB);
const outlineIndexValue = {
  schemaVersion: 1, countryId, sourceRef: candidateNode.sourceFeatureIds[0], geometryType: 'MultiPolygon', polygonCount: 2,
  coordinatePositions: 15, totalPartBytes: Buffer.byteLength(partAText) + Buffer.byteLength(partBText),
  parts: [
    { path: `outlines/${hash(partAText)}.json`, polygonOffset: 0, polygonCount: 1, bytes: Buffer.byteLength(partAText), coordinatePositions: 10 },
    { path: `outlines/${hash(partBText)}.json`, polygonOffset: 1, polygonCount: 1, bytes: Buffer.byteLength(partBText), coordinatePositions: 5 },
  ],
};
const outlineIndex = outlineIndexValue as CountryOutlineIndex;

test('strictly binds manifest limits, producer, baselines, rollups, and only content-addressed links', () => {
  assert.equal(manifest.source.id, 'candidate-10m');
  assert.throws(() => validateCountryDirectoryManifest({ ...manifestValue, compiler: 'unknown' }), /schema\/compiler/);
  assert.throws(() => validateCountryDirectoryManifest({ ...manifestValue, identityPath: '../attempt.json' }), /content-hashed/);
  assert.throws(() => validateCountryDirectoryManifest({ ...manifestValue, limits: { ...manifestValue.limits, partBytes: 999999 } }), /limits differ/);
  assert.throws(() => validateCountryDirectoryManifest({ ...manifestValue, rollups: [...manifestValue.rollups, manifestValue.rollups[0]] }), /rollups are duplicated/);
  assert.throws(() => validateCountryDirectoryManifest({ ...manifestValue, rollups: [{ ...manifestValue.rollups[0], sourceUnitCount: 1 }] }), /do not conserve/);
});

test('identity sidecar conserves canonical NE_ID identities and exactly one protected Nigeria row', () => {
  const identity = { schemaVersion: 1, baselineSourceId: baseline.id, candidateSourceId: candidate.id, baselineUnits: 2, candidateUnits: 2,
    retained: [
      { featureKey: 'NE_ID:1', countryId: countryId, baselineName: 'Example', candidateName: 'Example', metadataChanged: false },
      { featureKey: 'NE_ID:159', countryId: 'legacy-ng', baselineName: 'Nigeria', candidateName: 'Nigeria', metadataChanged: false },
    ], added: [], missing: [], protectedCountryId: 'legacy-ng', exceptions: [] };
  assert.equal(validateCountryDirectoryIdentity(identity, manifest).retained.length, 2);
  assert.throws(() => validateCountryDirectoryIdentity({ ...identity, retained: identity.retained.slice(0,1) }, manifest), /conserve/);
  assert.throws(() => validateCountryDirectoryIdentity({ ...identity, retained: [{ ...identity.retained[0], countryId: 'country:natural-earth:NE_ID%3A159' }, identity.retained[1]] }, manifest), /exactly one protected Nigeria|stable Natural Earth identity/);
  assert.throws(() => validateCountryDirectoryIdentity({ ...identity, retained: [{ ...identity.retained[0], featureKey: 'NE_ID:01' }, identity.retained[1]] }, manifest), /canonical Natural Earth/);
});

test('validates root/continent/country links against expected hierarchy, pinned source, provider, and Nigeria protection', () => {
  const root = { schemaVersion: 1, node: { id: 'world:earth', parentId: null, name: 'World', kind: 'world', countryCode: null, bounds: null,
    sourceFeatureIds: [], provider: 'world', outline: 'missing', exceptions: [] }, outlineIndexPath: null,
    children: [{ id: continentId, name: 'Africa', path: `nodes/${'f'.repeat(64)}.json` }] };
  assert.equal(validateCountryDirectoryNodeIndex(root, manifest, 'world:earth', null).children.length, 1);
  assert.throws(() => validateCountryDirectoryNodeIndex(root, manifest, 'world:earth', 'other'), /identity or parent/);
  assert.throws(() => validateCountryDirectoryNodeIndex({ ...root, extra: true }, manifest, 'world:earth', null), /missing or unknown/);
  assert.throws(() => validateCountryDirectoryNodeIndex({ ...root, children: [{ ...root.children[0], path: '../outside' }] }, manifest, 'world:earth', null), /child node path/);
  const countryIndex = { schemaVersion: 1, node: candidateNode, outlineIndexPath: `outline-index/${'1'.repeat(64)}.json`, children: [] };
  assert.equal(validateCountryDirectoryNodeIndex(countryIndex, manifest, countryId, continentId).node.countryCode, 'AA');
  assert.throws(() => validateCountryDirectoryNodeIndex({ ...countryIndex, node: { ...candidateNode, sourceFeatureIds: ['other:NE_ID:1'] } }, manifest, countryId, continentId), /do not match candidate source/);
  assert.throws(() => validateCountryDirectoryNodeIndex({ ...countryIndex, node: nigeriaNode, outlineIndexPath: `outline-index/${'1'.repeat(64)}.json` }, manifest, 'legacy-ng', continentId), /source references do not match|Nigeria|legacy|outline/);
});

test('validates part offsets, count conservation, byte metadata, and safe reference paths', () => {
  assert.deepEqual(validateCountryOutlineIndex(outlineIndex, manifest, candidateNode).parts.map(part => part.polygonOffset), [0,1]);
  assert.throws(() => validateCountryOutlineIndex({ ...outlineIndexValue, parts: [{ ...outlineIndexValue.parts[0], path: '../private' }, outlineIndexValue.parts[1]] }, manifest, candidateNode), /path is invalid/);
  assert.throws(() => validateCountryOutlineIndex({ ...outlineIndexValue, parts: [{ ...outlineIndexValue.parts[0], polygonOffset: 1 }, outlineIndexValue.parts[1]] }, manifest, candidateNode), /contiguous polygon offsets/);
  assert.throws(() => validateCountryOutlineIndex({ ...outlineIndexValue, totalPartBytes: outlineIndexValue.totalPartBytes + 1 }, manifest, candidateNode), /do not conserve/);
  assert.throws(() => validateCountryOutlineIndex(outlineIndexValue, manifest, nigeriaNode), /Nigeria outline requests are prohibited/);
});

test('fetches and reconstructs multipart MultiPolygon with holes and original polygon order under aggregate limits', async () => {
  let overBudgetRequests = 0;
  const sizes = [512000,512000,512000,512000,49152];
  const oversizedIndex = { ...outlineIndexValue, polygonCount: 5, coordinatePositions: 25, totalPartBytes: COUNTRY_DIRECTORY_LIMITS.countryBytes,
    parts: sizes.map((bytes, polygonOffset) => ({ path: `outlines/${'f'.repeat(64)}.json`, polygonOffset, polygonCount: 1, coordinatePositions: 5, bytes })) };
  await assert.rejects(fetchCountryOutline({ getJson: async () => { overBudgetRequests++; return { value: oversizedIndex, bytes: 1500 }; } },
    new URL('http://127.0.0.1:5191/'), { ...manifest, partCount: 5 }, candidateNode, `outline-index/${'1'.repeat(64)}.json`, new AbortController().signal), /declared parts exceed/);
  assert.equal(overBudgetRequests,1,'reject the index budget before requesting any geometry part');
  const indexHash = '1'.repeat(64), base = new URL('http://127.0.0.1:5191/');
  const responses = new Map<string, { value: unknown; bytes: number }>([
    [`/world-output/country-inventory/outline-index/${indexHash}.json`, { value: outlineIndexValue, bytes: Buffer.byteLength(canonical(outlineIndexValue)) }],
    [`/world-output/country-inventory/outlines/${hash(partAText)}.json`, { value: partA, bytes: Buffer.byteLength(partAText) }],
    [`/world-output/country-inventory/outlines/${hash(partBText)}.json`, { value: partB, bytes: Buffer.byteLength(partBText) }],
  ]);
  const calls: string[] = [];
  const client = { getJson: async (url: string) => { calls.push(new URL(url).pathname); const result = responses.get(new URL(url).pathname); if (!result) throw new Error('unexpected asset'); return result; } };
  const result = await fetchCountryOutline(client, base, manifest, candidateNode, `outline-index/${indexHash}.json`, new AbortController().signal);
  assert.deepEqual(result, { type: 'MultiPolygon', coordinates: polygons });
  assert.equal(calls.length, 3);
  assert.equal(COUNTRY_DIRECTORY_LIMITS.requests, 2);
});

test('refuses extra ordinates, mismatched part bytes, and every Nigeria outline before requesting assets', async () => {
  const indexHash = '1'.repeat(64), base = new URL('https://example.test/'); let calls = 0;
  const client = { getJson: async (_url: string, _hash: string, _limit: number, _signal: AbortSignal) => {
    calls++;
    return { value: outlineIndexValue, bytes: Buffer.byteLength(canonical(outlineIndexValue)) };
  } };
  await assert.rejects(fetchCountryOutline(client, base, manifest, nigeriaNode, null, new AbortController().signal), /Nigeria outline requests are prohibited/);
  assert.equal(calls, 0);
  const extraDimPart = { type: 'MultiPolygon', coordinates: [[[[0,0,100],[2,0],[2,2],[0,2],[0,0]]]] };
  const mixedClient = { getJson: async (url: string) => {
    calls++;
    if (new URL(url).pathname.includes('outline-index')) return { value: outlineIndexValue, bytes: Buffer.byteLength(canonical(outlineIndexValue)) };
    return { value: extraDimPart, bytes: outlineIndexValue.parts[0]!.bytes };
  } };
  await assert.rejects(fetchCountryOutline(mixedClient, base, manifest, candidateNode, `outline-index/${indexHash}.json`, new AbortController().signal), /geometry position/);
  const wrongBytesClient = { getJson: async (url: string) => new URL(url).pathname.includes('outline-index')
    ? { value: outlineIndexValue, bytes: Buffer.byteLength(canonical(outlineIndexValue)) }
    : { value: partA, bytes: outlineIndexValue.parts[0]!.bytes + 1 } };
  await assert.rejects(fetchCountryOutline(wrongBytesClient, base, manifest, candidateNode, `outline-index/${indexHash}.json`, new AbortController().signal), /byte count differs/);
});

test('country JSON cache enforces verified hashes, actual byte caps, cache accounting and signal state', async () => {
  const body = new TextEncoder().encode('{"ready":true}'), bodyHash = createHash('sha256').update(body).digest('hex'); let fetches = 0, downloaded = 0;
  const cache = new CountryDirectoryJsonCache({ fetcher: async () => { fetches++; return new Response(body); }, downloaded: bytes => { downloaded += bytes; } });
  const signal = new AbortController().signal, url = 'https://assets.example.test/x.json';
  assert.deepEqual((await cache.getJson(url, bodyHash, 512, signal)).value, { ready: true });
  await cache.getJson(url, bodyHash, 512, signal);
  assert.equal(fetches, 1); assert.equal(downloaded, body.byteLength); assert.equal(cache.byteLength, body.byteLength);
  await assert.rejects(cache.getJson(url, bodyHash, 2, signal), /cached .* byte limit/);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(cache.getJson(url, bodyHash, 512, aborted.signal), /aborted/);
  const tamperedCache = new CountryDirectoryJsonCache({ fetcher: async () => new Response('{"no":true}') });
  await assert.rejects(tamperedCache.getJson(url, bodyHash, 512, signal), /hash mismatch/);
});

test('deduplicates cache byte accounting when same hash is fetched concurrently', async () => {
  const body = new TextEncoder().encode('{"same":true}'), bodyHash = createHash('sha256').update(body).digest('hex'); let entered = 0, open!: () => void;
  const bothEntered = new Promise<void>(resolve => { open = resolve; });
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const cache = new CountryDirectoryJsonCache({ fetcher: async () => { entered++; if (entered === 2) open(); await gate; return new Response(body); } });
  const signal = new AbortController().signal, url = 'https://assets.example.test/same.json';
  const first = cache.getJson(url, bodyHash, 512, signal), second = cache.getJson(url, bodyHash, 512, signal);
  await bothEntered; release(); await Promise.all([first, second]);
  assert.equal(cache.byteLength, body.byteLength);
});

test('aborting a blocked reader awaits cancellation before releasing the two-request permit', async () => {
  const first = new AbortController(), second = new AbortController(), queued = new AbortController();
  const cancelOrder: string[] = []; let firstStarted!: () => void; const started = new Promise<void>(resolve => { firstStarted = resolve; });
  const body = new TextEncoder().encode('{"ok":true}'), validHash = createHash('sha256').update(body).digest('hex');
  let calls = 0;
  const fetcher: typeof fetch = async input => {
    calls++; const label = String(input).endsWith('/one') ? 'one' : String(input).endsWith('/two') ? 'two' : 'queued';
    if (label === 'queued') { cancelOrder.push('queued-start'); return new Response(body); }
    firstStarted();
    let deliver!: (value: ReadableStreamReadResult<Uint8Array>) => void;
    const pending = new Promise<ReadableStreamReadResult<Uint8Array>>(resolve => { deliver = resolve; });
    let firstRead = true;
    const reader = {
      read: async () => { if (firstRead) { firstRead = false; return { done: false, value: new Uint8Array([123]) }; } return pending; },
      cancel: async () => { cancelOrder.push(`${label}-cancel`); deliver({ done: true, value: undefined }); await new Promise(resolve => setTimeout(resolve, 5)); cancelOrder.push(`${label}-closed`); },
      releaseLock: () => { cancelOrder.push(`${label}-release`); },
    };
    return { ok: true, headers: new Headers(), body: { getReader: () => reader } } as unknown as Response;
  };
  const cache = new CountryDirectoryJsonCache({ fetcher });
  const p1 = cache.getJson('https://assets.example.test/one', '1'.repeat(64), 512, first.signal);
  const p2 = cache.getJson('https://assets.example.test/two', '2'.repeat(64), 512, second.signal);
  await started;
  const p3 = cache.getJson('https://assets.example.test/queued', validHash, 512, queued.signal);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, 2,'third request waits while both reader permits are occupied');
  first.abort(new DOMException('cancel first read','AbortError'));
  await assert.rejects(p1,/cancel first read/);
  assert.deepEqual(await p3, { value: { ok: true }, bytes: body.byteLength });
  assert.ok(cancelOrder.indexOf('one-closed') < cancelOrder.indexOf('queued-start'));
  second.abort(new DOMException('cancel second read','AbortError'));
  await assert.rejects(p2,/cancel second read/);
});

test('queued permit granted just before an abort is returned to the next waiter', async () => {
  const active = new AbortController(), next = new AbortController(), third = new AbortController();
  let fetchStarted!: () => void; const entered = new Promise<void>(resolve => { fetchStarted = resolve; });
  let activeCalls = 0;
  let resolveActive!: () => void; const hold = new Promise<void>(resolve => { resolveActive = resolve; });
  const goodBytes = new TextEncoder().encode('{"ok":1}'), goodHash = createHash('sha256').update(goodBytes).digest('hex'); let thirdStarted = false;
  const fetcher: typeof fetch = async input => {
    if (String(input).endsWith('/active') || String(input).endsWith('/active-2')) { activeCalls++; if (activeCalls === 2) fetchStarted(); await hold; return new Response(goodBytes); }
    if (String(input).endsWith('/third')) thirdStarted = true;
    return new Response(goodBytes);
  };
  const cache = new CountryDirectoryJsonCache({ fetcher });
  // Occupy both request slots so `next` enters the queue.
  const p1 = cache.getJson('https://assets.example.test/active', goodHash, 512, active.signal);
  const p2 = cache.getJson('https://assets.example.test/active-2', goodHash, 512, active.signal);
  await entered;
  let reads = 0;
  const raceSignal = {
    get aborted() { reads++; return reads >= 3; }, reason: new DOMException('abort after grant','AbortError'),
    addEventListener() {}, removeEventListener() {},
  } as unknown as AbortSignal;
  const queuedPromise = cache.getJson('https://assets.example.test/next', goodHash, 512, raceSignal);
  const p3 = cache.getJson('https://assets.example.test/third', goodHash, 512, third.signal);
  await new Promise(resolve => setTimeout(resolve, 0));
  resolveActive();
  await assert.rejects(queuedPromise,/abort after grant/);
  await Promise.all([p1,p2,p3]);
  assert.equal(thirdStarted,true);
});

test('directory URLs remain inside the dedicated public namespace', () => {
  assert.equal(directoryAssetUrl(new URL('https://example.test/'), 'identity', 'a'.repeat(64)).pathname, `/world-output/country-inventory/identity/${'a'.repeat(64)}.json`);
  assert.throws(() => directoryAssetUrl(new URL('https://example.test/'), 'nodes', '../private'), /hash is invalid/);
});
