import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { FEATURE_IDENTITY_LIMITS, identifySourceFeature } from './feature-identity.ts';
import type { FeatureIdentityBinding, FeatureIdentityExceptionCode, FeatureIdentityResult } from './feature-identity.ts';

const binding: FeatureIdentityBinding = { provider: 'overture', release: '2026-09-23.1', layers: ['buildings', 'roads'] };
function building(id = 'b-1', coordinates: number[][][] = [[[0, 0], [1, 0], [1, 1], [0, 0]]]) {
  return { type: 'Feature', id, properties: { building: true, sourceLayer: 'buildings', sources: ['fixture'] }, geometry: { type: 'Polygon', coordinates } };
}
function road(coordinates: number[][] = [[0, 0], [1, 1]]) {
  return { type: 'Feature', id: 'b-1', properties: { highway: 'residential', sourceLayer: 'transportation', sources: ['fixture'] }, geometry: { type: 'LineString', coordinates } };
}
function admitted(value: unknown, context = binding): Extract<FeatureIdentityResult, { status: 'admitted' }> {
  const result = identifySourceFeature(value, context);
  if (result.status !== 'admitted') assert.fail(result.message);
  return result;
}
function exception(value: unknown, code: FeatureIdentityExceptionCode): void {
  const result = identifySourceFeature(value, binding);
  assert.equal(result.status, 'exception');
  if (result.status === 'exception') assert.equal(result.code, code);
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

test('tuple and complete integer-feature hash match independent literal encodings, without a newline', () => {
  const row = admitted(building());
  const tuple = '{"provider":"overture","release":"2026-09-23.1","sourceFeatureId":"b-1","sourceLayer":"buildings"}';
  const body = '{"geometry":{"coordinates":[[[0,0],[1,0],[1,1],[0,0]]],"type":"Polygon"},"id":"b-1","properties":{"building":true,"sourceLayer":"buildings","sources":["fixture"]},"type":"Feature"}';
  assert.equal(row.featureKeyHash, digest(tuple));
  assert.equal(row.bodyHash, digest(body));
  assert.equal(row.bodyBytes, Buffer.byteLength(body));
  assert.notEqual(row.bodyHash, digest(body + '\n'));
  assert.deepEqual(row.ownerAnchor, [0, 0]);
  assert.equal(row.ownerCellId, 'geo-grid-v1:l1:x360:y180');
  assert.equal(row.positions, 4);
});

test('same source tuple ignores requested layer set but separates source layers and releases', () => {
  const both = admitted(building()), single = admitted(building(), { ...binding, layers: ['buildings'] });
  assert.equal(both.featureKeyHash, single.featureKeyHash);
  assert.equal(both.bodyHash, single.bodyHash);
  assert.notEqual(both.featureKeyHash, admitted(road()).featureKeyHash);
  assert.notEqual(both.featureKeyHash, admitted(building(), { ...binding, release: '2026-10-01.1' }).featureKeyHash);
});

test('full source properties and original components change body version while key remains identical', () => {
  const base = admitted(building());
  const altered = admitted({ ...building(), properties: { ...building().properties, height: 7, sourceNote: null } });
  const altitude = admitted(building('b-1', [[[0, 0, 9], [1, 0, 9], [1, 1, 9], [0, 0, 9]]]));
  for (const changed of [altered, altitude]) {
    assert.equal(base.featureKeyHash, changed.featureKeyHash);
    assert.notEqual(base.bodyHash, changed.bodyHash, 'same tuple/different body must later be retained as a conflict');
    assert.deepEqual(base.ownerAnchor, changed.ownerAnchor);
  }
});

test('object key order is canonical but source array order is not rewritten', () => {
  const value = building(), reversedKeys = { geometry: value.geometry, properties: value.properties, id: value.id, type: value.type };
  assert.deepEqual(admitted(value), admitted(reversedKeys));
  const reversedRing = building('b-1', [value.geometry.coordinates[0]!.toReversed()]);
  assert.deepEqual(admitted(value).ownerAnchor, admitted(reversedRing).ownerAnchor);
  assert.notEqual(admitted(value).bodyHash, admitted(reversedRing).bodyHash);
});

test('multipart members and holes all participate in the actual-vertex anchor', () => {
  const outer = [[1, 1], [3, 1], [3, 3], [1, 1]], hole = [[1.5, 1.5], [2, 1.5], [2, 2], [1.5, 1.5]];
  const west = [[-2, 0], [-1, 0], [-1, 1], [-2, 0]];
  const multi = { ...building(), geometry: { type: 'MultiPolygon', coordinates: [[outer, hole], [west]] } };
  assert.deepEqual(admitted(multi).ownerAnchor, [-2, 0]);
  const swapped = { ...multi, geometry: { ...multi.geometry, coordinates: multi.geometry.coordinates.toReversed() } };
  assert.deepEqual(admitted(multi).ownerAnchor, admitted(swapped).ownerAnchor);
  assert.notEqual(admitted(multi).bodyHash, admitted(swapped).bodyHash);
  // This accounting layer does not assert polygon topology; even this exterior hole must be scanned.
  assert.deepEqual(admitted(building('b-1', [outer, west])).ownerAnchor, [-2, 0]);
});

test('seam/poles normalize only derived ownership, preserving original body and input', () => {
  const cases = [
    { points: [[180, 2], [179, 3]], anchor: [-180, 2], cell: 'geo-grid-v1:l1:x0:y184' },
    { points: [[72, 90], [73, 89]], anchor: [-180, 90], cell: 'geo-grid-v1:l1:x0:y359' },
    { points: [[-72, -90], [-73, -89]], anchor: [-180, -90], cell: 'geo-grid-v1:l1:x0:y0' },
  ];
  for (const item of cases) {
    const feature = road(item.points), before = JSON.stringify(feature), row = admitted(feature);
    assert.deepEqual(row.ownerAnchor, item.anchor);
    assert.equal(row.ownerCellId, item.cell);
    assert.equal(JSON.stringify(feature), before);
  }
  const east = admitted(road([[180, 2], [179, 3]])), west = admitted(road([[-180, 2], [179, 3]]));
  assert.equal(east.featureKeyHash, west.featureKeyHash);
  assert.notEqual(east.bodyHash, west.bodyHash);
  assert.equal(east.ownerCellId, west.ownerCellId);
});

test('exact binary-double boundary neighbours stay in their own half-open cells', () => {
  for (const [lon, expected] of [[-.5000000000000001, 358], [-.5, 359], [-.49999999999999994, 359]] as const) {
    const row = admitted(road([[lon, 0], [1, 1]]));
    assert.equal(row.ownerCellId, `geo-grid-v1:l1:x${expected}:y180`);
  }
  assert.equal(admitted(road([[0, -.5000000000000001], [1, 1]])).ownerCellId, 'geo-grid-v1:l1:x360:y178');
});

test('IDs stay exact and are never coerced, trimmed or case folded', () => {
  assert.notEqual(admitted(building('B-1')).featureKeyHash, admitted(building('b-1')).featureKeyHash);
  admitted(building('x'.repeat(256)));
  for (const id of [1, null, true]) exception({ ...building(), id }, 'unsupported-id-representation');
  for (const id of ['', 'x'.repeat(257), ' b-1', 'b 1', 'b\n1', 'b\u00a01', 'b\u00851', 'b\u007f1']) exception(building(id), 'invalid-source-id');
});

test('unsafe __proto__ fields at any depth are explicit exceptions before hashing', () => {
  const feature = building();
  const poison = JSON.parse('{"__proto__":{"hidden":7}}');
  for (const value of [{ ...feature, ...poison }, { ...feature, properties: { ...feature.properties, extra: poison } }, { ...feature, properties: { ...feature.properties, extra: [poison] } }]) {
    const before = JSON.stringify(value);
    exception(value, 'unsupported-json-tree');
    assert.equal(JSON.stringify(value), before);
  }
});

test('non-JSON/cyclic/accessor/hidden/symbol/sparse trees cannot lose data silently', () => {
  const feature = building();
  for (const value of [undefined, NaN, Infinity, 1n, () => 1, new Date(), [, 1]]) {
    exception({ ...feature, extra: value }, 'unsupported-json-tree');
  }
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  exception({ ...feature, extra: cycle }, 'unsupported-json-tree');
  const hidden = Object.defineProperty({}, 'hidden', { value: 1 });
  exception({ ...feature, extra: hidden }, 'unsupported-json-tree');
  let reads = 0;
  const accessor = Object.defineProperty({}, 'get', { enumerable: true, get() { reads++; return 1; } });
  exception({ ...feature, extra: accessor }, 'unsupported-json-tree'); assert.equal(reads, 0);
  exception({ ...feature, [Symbol('hidden')]: 1 }, 'unsupported-json-tree');
  const sparseWithExtra = [0, 1] as (number[] & { extra?: number });
  delete sparseWithExtra[0]; sparseWithExtra.extra = 7;
  exception({ ...feature, extra: sparseWithExtra }, 'unsupported-json-tree');
  class ArraySubclass extends Array<number> { }
  exception({ ...feature, extra: new ArraySubclass(1, 2) }, 'unsupported-json-tree');
});

test('depth, nodes and encoded bytes fail with bounded explicit resource exceptions', () => {
  let deep: unknown = null;
  for (let i = 0; i < FEATURE_IDENTITY_LIMITS.depth + 1; i++) deep = [deep];
  exception({ ...building(), extra: deep }, 'feature-resource-limit');
  exception({ ...building(), extra: Array(FEATURE_IDENTITY_LIMITS.nodes).fill(0) }, 'feature-resource-limit');
  // Escaped NUL text is under the preliminary UTF8 bound but exceeds canonical JSON bytes.
  exception({ ...building(), extra: '\u0000'.repeat(Math.floor(FEATURE_IDENTITY_LIMITS.bodyBytes / 6) + 1) }, 'feature-resource-limit');
});

test('preflight encoded-byte accounting preserves Unicode, escapes, primitives and number spelling', () => {
  const texts = ['plain', '\\"\b\f\n\r\t\u0000\u001f', 'é\u07ff\u0800', '😀', '\ud800', '\udfff', '\u2028\u2029'];
  const extra = { texts, '\u0000key': [true, false, null, -0, 1e-7, 1e21, 1.25] };
  const feature = { ...building(), extra }, row = admitted(feature);
  // Standard encoding independently checks the byte scanner; object ordering changes no length.
  assert.equal(row.bodyBytes, Buffer.byteLength(JSON.stringify(feature)));
  assert.equal(row.bodyHash, admitted(JSON.parse(JSON.stringify(feature))).bodyHash);
});

test('invalid geometry is accounted as an exception instead of a guessed anchor', () => {
  for (const coordinates of [[], [[0, 0]], [[0, 0], [0, 0]], [[181, 0], [1, 1]], [[0, 91], [1, 1]], [[0], [1, 1]], [[0, 0, 'bad'], [1, 1]]]) {
    exception({ ...road(), geometry: { type: 'LineString', coordinates } }, 'invalid-geometry');
  }
  exception(building('b-1', [[[0, 0], [1, 0], [1, 1], [0, 1]]]), 'invalid-geometry');
  exception(building('b-1', [[[0, 0], [1, 0], [1, 0], [0, 0]]]), 'invalid-geometry');
  exception(building('b-1', [[[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 0, 2]]]), 'invalid-geometry');
  exception({ ...building(), geometry: { type: 'Point', coordinates: [0, 0] } }, 'unsupported-geometry');
  exception({ ...building(), geometry: { type: 'MultiPolygon', coordinates: [] } }, 'invalid-geometry');
});

test('bad source tags/layers are explicit; absent receipt layer is a hard integrity failure', () => {
  exception({ ...building(), type: 'FeatureCollection' }, 'invalid-source-feature');
  exception({ ...building(), properties: null }, 'invalid-source-feature');
  exception({ ...building(), properties: { ...building().properties, sourceLayer: 'places' } }, 'unsupported-source-layer');
  exception({ ...building(), properties: { ...building().properties, building: false } }, 'invalid-source-feature');
  assert.throws(() => admitted(road(), { ...binding, layers: ['buildings'] }), /absent.*receipt/);
  for (const context of [{ ...binding, release: '' }, { ...binding, layers: [] }, { ...binding, layers: ['buildings', 'buildings'] }]) {
    assert.throws(() => identifySourceFeature(building(), context as FeatureIdentityBinding), /binding/);
  }
});

test('independent Python reconstruction verifies integer hashes and exact dyadic owner vectors', () => {
  const features: unknown[] = [building(), road(), road([[180, 2], [179, 3]]), road([[72, 90], [73, 89]])];
  for (const lon of [-.5000000000000001, -.5, -.49999999999999994, -180, 180]) features.push(road([[lon, 0], [180, 1]]));
  for (const lat of [-.5000000000000001, -.5, -.49999999999999994, -90, 90]) features.push(road([[0, lat], [1, 1]]));
  const oracle = spawnSync('python3', [fileURLToPath(new URL('./tooling/verify_feature_identity_vectors.py', import.meta.url))], {
    input: JSON.stringify({ binding, features }), encoding: 'utf8', timeout: 10_000, maxBuffer: 1_000_000,
  });
  assert.equal(oracle.error, undefined); assert.equal(oracle.status, 0, oracle.stderr);
  const rows = JSON.parse(oracle.stdout) as { keyHash: string; bodyHash: string | null; anchor: number[]; cell: string }[];
  assert.equal(rows.length, features.length);
  rows.forEach((expected, i) => {
    const actual = admitted(features[i]);
    assert.equal(actual.featureKeyHash, expected.keyHash);
    if (expected.bodyHash !== null) assert.equal(actual.bodyHash, expected.bodyHash);
    assert.deepEqual(actual.ownerAnchor, expected.anchor);
    assert.equal(actual.ownerCellId, expected.cell);
  });
});
