import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { FINE_VIEW_LIMITS, fetchFineJson, validateFineIndex, validateFineIndexProvenance, validateFineManifest, validateFineOutline } from './fine-view.ts';

const commit = 'a'.repeat(40), sourceHash = 'b'.repeat(64), coarseHash = 'c'.repeat(64), metadataHash = 'd'.repeat(64);
const countryId = 'country:natural-earth%3ANE_ID%3A123';
const pin = {
  schemaVersion: 1, provider: 'geoBoundaries',
  source: { id: 'geoboundaries:rwa:adm1-source', url: `https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/${commit}/releaseData/gbOpen/RWA/ADM1/geoBoundaries-RWA-ADM1.geojson`, release: commit, license: 'CC BY 4.0 (geoBoundaries gbOpen)', attribution: 'geoBoundaries; source: The Rwanda Geo Portal', sha256: sourceHash, bytes: 1000 },
  input: `.cache/world-build/fine-source-cache/${sourceHash}.geojson`, countryCode: 'RW', countryIso3: 'RWA', adminLevel: 'ADM1', layerId: 'RWA-ADM1-91480417', canonicalType: 'Province', representedYear: '2020', buildDate: 'Dec 12, 2023', expectedUnits: 1,
  originalLicense: 'Creative Commons Attribution 4.0 (CC BY 4.0)', licenseEvidence: ['https://www.geoboundaries.org/api/current/gbOpen/RWA/ADM1/'], metadataSha256: metadataHash, metadataBytes: 128, boundaryPolicy: 'source depiction',
};
const manifest = { schemaVersion: 1, countryId, coarseInventoryHash: coarseHash, source: pin, sourceUnitCount: 1,
  nodeIndexPath: `node-index/${'e'.repeat(64)}.json`, registryPath: `registries/${'f'.repeat(64)}.json`, coveragePath: `coverage/${'1'.repeat(64)}.json`, exceptions: [] };
const node = { id: `admin:geoBoundaries:${'2'.repeat(64)}`, parentId: countryId, countryCode: 'RW', name: 'North', kind: 'admin', adminLevel: 'ADM1', adminType: 'Province', bounds: [28,-3,31,-1], aliases: [], sourceRef: { sourceId: pin.source.id, release: commit, layerId: pin.layerId, featureKey: '91480417B1' }, coverage: 'geographic-outline', exceptions: ['source boundary depiction'] } as const;
const index = { schemaVersion: 1, countryId, nodes: [{ node, outlinePath: `outlines/${'3'.repeat(64)}.json` }] };
const square = { type: 'Polygon', coordinates: [[[29,-2],[30,-2],[30,-1],[29,-1],[29,-2]], [[29.2,-1.8],[29.4,-1.8],[29.4,-1.6],[29.2,-1.6],[29.2,-1.8]]] };

test('validates exact fine manifest/source pins and parent inventory identity', () => {
  assert.equal(validateFineManifest(manifest, coarseHash, countryId).source.layerId, pin.layerId);
  assert.throws(() => validateFineManifest({ ...manifest, extra: true }, coarseHash, countryId), /missing or unknown fields/);
  assert.throws(() => validateFineManifest(manifest, '0'.repeat(64), countryId), /different country or coarse inventory/);
  assert.throws(() => validateFineManifest(manifest, coarseHash, 'legacy-ng'), /expected coarse inventory identity/);
  assert.throws(() => validateFineManifest({ ...manifest, sourceUnitCount: 2 }, coarseHash, countryId), /does not match/);
  assert.throws(() => validateFineManifest({ ...manifest, nodeIndexPath: `nodes/${'e'.repeat(64)}.json` }, coarseHash, countryId), /node index path/);
  assert.throws(() => validateFineManifest({ ...manifest, registryPath: '../secret' }, coarseHash, countryId), /registry path/);
  assert.throws(() => validateFineManifest({ ...manifest, coveragePath: `coverage/${'G'.repeat(64)}.json` }, coarseHash, countryId), /coverage path/);
});

test('rejects malformed pin provenance, unhashed inputs and protected Nigeria', () => {
  assert.throws(() => validateFineManifest({ ...manifest, source: { ...pin, source: { ...pin.source, release: 'short' } } }, coarseHash, countryId), /full commit/);
  assert.throws(() => validateFineManifest({ ...manifest, source: { ...pin, source: { ...pin.source, url: 'https://example.org/fake.geojson' } } }, coarseHash, countryId), /exact pinned/);
  assert.throws(() => validateFineManifest({ ...manifest, source: { ...pin, input: '.cache/world-build/other.geojson' } }, coarseHash, countryId), /input path/);
  assert.throws(() => validateFineManifest({ ...manifest, source: { ...pin, countryCode: 'NG' } }, coarseHash, countryId), /protected Nigeria/);
  assert.throws(() => validateFineManifest({ ...manifest, source: { ...pin, metadataSha256: 'bad' } }, coarseHash, countryId), /metadata pin/);
  assert.throws(() => validateFineManifest({ ...manifest, source: { ...pin, licenseEvidence: [] } }, coarseHash, countryId), /license evidence/);
  assert.doesNotThrow(() => validateFineManifest({ ...manifest, source: { ...pin, licenseEvidence: ['CC BY 4.0 evidence record'] } }, coarseHash, countryId));
});

test('validates fine index counts, unique IDs/source keys, parent and release-qualified provenance', () => {
  assert.equal(validateFineIndex(index, countryId, 1).nodes[0]!.node.name, 'North');
  assert.throws(() => validateFineIndex(index, countryId, 2), /count is invalid/);
  assert.throws(() => validateFineIndex({ ...index, nodes: [{ ...index.nodes[0], outlinePath: '../outside' }] }, countryId, 1), /outline path/);
  assert.throws(() => validateFineIndex({ ...index, nodes: [{ node: { ...node, id: 'bad' }, outlinePath: index.nodes[0]!.outlinePath }] }, countryId, 1), /ID is invalid/);
  assert.throws(() => validateFineIndex({ ...index, nodes: [{ node: { ...node, parentId: 'country:other' }, outlinePath: index.nodes[0]!.outlinePath }] }, countryId, 1), /hierarchy or coverage/);
  assert.throws(() => validateFineIndex({ ...index, nodes: [{ node: { ...node, countryCode: 'NG' }, outlinePath: index.nodes[0]!.outlinePath }] }, countryId, 1), /protected/);
  assert.throws(() => validateFineIndex({ ...index, nodes: [{ node: { ...node, sourceRef: { ...node.sourceRef, release: 'mutable' } }, outlinePath: index.nodes[0]!.outlinePath }] }, countryId, 1), /commit-pinned/);
  assert.throws(() => validateFineIndex({ ...index, nodes: [{ node: { ...node, sourceRef: { ...node.sourceRef, layerId: 'GHA-ADM2-x' } }, outlinePath: index.nodes[0]!.outlinePath }] }, countryId, 1), /layer is invalid/);
  const two = [{ ...index.nodes[0] }, { ...index.nodes[0], node: { ...node, id: `admin:geoBoundaries:${'4'.repeat(64)}` } }];
  assert.throws(() => validateFineIndex({ ...index, nodes: two }, countryId, 2), /feature keys must be unique/);
});

test('binds index provenance to its manifest and selected coarse country', () => {
  const validatedManifest = validateFineManifest(manifest, coarseHash, countryId);
  const validatedIndex = validateFineIndex(index, countryId, 1);
  assert.equal(validateFineIndexProvenance(validatedIndex, validatedManifest, 'RW').nodes.length, 1);
  assert.throws(() => validateFineIndexProvenance(validatedIndex, validatedManifest, 'GH'), /does not match selected coarse country/);
  for (const changed of [
    { ...node, countryCode: 'GH' },
    { ...node, adminType: 'District' },
    { ...node, sourceRef: { ...node.sourceRef, sourceId: 'another-source' } },
    { ...node, sourceRef: { ...node.sourceRef, release: 'e'.repeat(40) } },
    { ...node, sourceRef: { ...node.sourceRef, layerId: 'RWA-ADM1-other-layer' } },
  ]) {
    const parsed = validateFineIndex({ ...index, nodes: [{ ...index.nodes[0], node: changed }] }, countryId, 1);
    assert.throws(() => validateFineIndexProvenance(parsed, validatedManifest, 'RW'), /provenance does not match/);
  }
});

test('validates bounded closed WGS84 polygons and rejects malformed CRS/coordinates', () => {
  assert.equal(validateFineOutline(square).type, 'Polygon');
  assert.throws(() => validateFineOutline({ ...square, crs: { type: 'name', properties: { name: 'EPSG:3857' } } }), /unknown fields/);
  assert.throws(() => validateFineOutline({ type: 'Polygon', coordinates: [[[29,-2],[30,-2],[30,-1],[29,-1]]] }), /not closed/);
  assert.throws(() => validateFineOutline({ type: 'Polygon', coordinates: [[[29,-2],[30,-2],[30,-1],[29,-1],[29,-2,100,200,300]]] }), /position/);
  assert.throws(() => validateFineOutline({ type: 'Polygon', coordinates: [[[181,0],[179,0],[179,1],[181,1],[181,0]]] }), /WGS84/);
  assert.throws(() => validateFineOutline({ type: 'GeometryCollection', coordinates: [] }), /Polygon or MultiPolygon/);
  const largeRing = Array.from({ length: 40_001 }, (_, i) => [i % 2, (i % 3) / 10]);
  largeRing[0] = [0, 0]; largeRing[largeRing.length - 1] = [0, 0];
  assert.throws(() => validateFineOutline({ type: 'Polygon', coordinates: [largeRing] }), /40,000/);
});

test('fetches hash-verified JSON with a hard byte cap and optional signal', async () => {
  assert.equal(FINE_VIEW_LIMITS.requestTimeoutMs, 25_000);
  const bytes = new TextEncoder().encode('{"ok":true}'), hash = createHash('sha256').update(bytes).digest('hex');
  const controller = new AbortController(); let seenSignal: AbortSignal | null = null;
  const fetcher: typeof fetch = async (_url, init) => { seenSignal = init?.signal ?? null; return new Response(bytes, { headers: { 'content-length': String(bytes.byteLength) } }); };
  const fetched = await fetchFineJson('https://cdn.example.test/fine.json', hash, 512, controller.signal, fetcher);
  assert.deepEqual(fetched.value, { ok: true }); assert.equal(fetched.bytes, bytes.byteLength); assert.ok(seenSignal); assert.notEqual(seenSignal, controller.signal);
  await assert.rejects(fetchFineJson('https://cdn.example.test/fine.json', '0'.repeat(64), 512, controller.signal, fetcher), /hash mismatch/);
  await assert.rejects(fetchFineJson('https://cdn.example.test/fine.json', hash, 2, controller.signal, fetcher), /byte limit/);
  await assert.rejects(fetchFineJson('file:///tmp/fine.json', hash, 512, controller.signal, fetcher), /URL\/hash/);
  await assert.rejects(fetchFineJson('http://cdn.example.test/fine.json', hash, 512, controller.signal, fetcher), /URL\/hash/);
  await assert.rejects(fetchFineJson('http://user:pass@127.0.0.1/fine.json', hash, 512, controller.signal, fetcher), /URL\/hash/);
  await assert.rejects(fetchFineJson('https://cdn.example.test/fine.json', hash, 2 * 1024 * 1024 + 1, controller.signal, fetcher), /byte limit/);
  for (const loopback of ['127.0.0.1', 'localhost', '[::1]']) {
    const loopbackResult = await fetchFineJson(`http://${loopback}:5191/fine.json`, hash, 512, controller.signal, fetcher);
    assert.deepEqual(loopbackResult.value, { ok: true });
  }
  const aborted = new AbortController();
  const waitingFetcher: typeof fetch = async (_url, init) => new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
  });
  const pending = fetchFineJson('https://cdn.example.test/fine.json', hash, 512, aborted.signal, waitingFetcher);
  aborted.abort(new DOMException('cancelled', 'AbortError'));
  await assert.rejects(pending, /cancelled/);
  await assert.rejects(fetchFineJson('https://cdn.example.test/fine.json', hash, 512, aborted.signal, fetcher), /cancelled/);
});
