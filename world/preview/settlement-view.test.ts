import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  validateSettlementCountryPoints,
  validateSettlementManifest,
} from './settlement-view.ts';
import { SETTLEMENT_COMPILER, SETTLEMENT_PRODUCT, type SettlementCountryRef, type SettlementProductManifest } from '../settlement-product-types.ts';

const release = 'a'.repeat(40);
const parentHash = 'e'.repeat(64);
const pointsPath = `points/${'c'.repeat(64)}.json`;
const source = {
  id: `natural-earth-places-10m-${release}`,
  url: `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${release}/geojson/ne_10m_populated_places.geojson`,
  release, license: 'Public-domain', attribution: 'Synthetic labelled Natural Earth place fixture',
  sha256: 'b'.repeat(64), bytes: 321,
};
const parentSource = {
  id: `natural-earth-admin0-10m-${release}`,
  url: `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${release}/geojson/ne_10m_admin_0_countries.geojson`,
  release, license: 'Public-domain', attribution: 'Synthetic labelled Natural Earth admin0 fixture',
  sha256: 'd'.repeat(64), bytes: 234,
};

function fixture(): SettlementProductManifest {
  const ids = ['country:natural-earth:NE_ID%3A1', 'country:natural-earth:NE_ID%3A2'];
  const countries: SettlementCountryRef[] = ids.map((countryId, index) => ({
    countryId, status: index === 0 ? 'available' : 'missing', sourceUnits: index === 0 ? 4 : 0,
    emittedUnits: index === 0 ? 1 : 0,
    points: index === 0 ? { path: pointsPath, sha256: 'c'.repeat(64), bytes: 300 } : null,
  }));
  countries.push({ countryId: 'legacy-ng', status: 'protected', sourceUnits: 1, emittedUnits: 0, points: null });
  return {
    schemaVersion: 1, product: SETTLEMENT_PRODUCT, compiler: SETTLEMENT_COMPILER,
    source, parent: { manifestHash: parentHash, source: parentSource },
    joinPolicy: 'literal-ADM0_A3-v1', keyField: 'NE_ID', countryField: 'ADM0_A3',
    representation: 'selected-source-point-geometry', validation: 'source-bound-structural-with-explicit-exceptions',
    sourceUnits: 5, validPoints: 5, linked: 4, protected: 1,
    unlinked: 0, ambiguous: 0, invalidRows: 0, emittedUnits: 1, exceptionUnits: 4,
    inspection: { path: `reports/${'a'.repeat(64)}.json`, sha256: 'a'.repeat(64), bytes: 1_024 },
    countries,
    limitations: [
      'Selected populated places are not an exhaustive settlement inventory.',
      'The cartographic country depiction is not a legal boundary assertion.',
      'No Admin 1 containment is included.',
      'Points do not represent buildings, navigation or playable destinations.',
    ],
  };
}

function point(overrides: Record<string, unknown> = {}) {
  return {
    sourceOrdinal: 4, sourceKey: 'NE_ID:1', id: 'place:natural-earth:NE_ID%3A1',
    name: 'Example Place', nameAscii: 'Example Place', sourceClass: 'Populated place', scaleRank: 4, coordinates: [3.4, 6.5],
    ...overrides,
  };
}
function payload(manifest: SettlementProductManifest, overrides: Record<string, unknown> = {}) {
  const country = manifest.countries[0]!;
  return {
    schemaVersion: 1, product: SETTLEMENT_PRODUCT, countryId: country.countryId,
    sourceSha256: manifest.source.sha256, parentManifestHash: manifest.parent.manifestHash,
    sourceUnits: country.sourceUnits, emittedUnits: country.emittedUnits, rows: [point()], ...overrides,
  };
}

test('accepts a small synthetic source-bound manifest and retains its parent identities', () => {
  const validated = validateSettlementManifest(fixture());
  assert.equal(validated.countries.length, 3);
  assert.equal(validated.countries.at(-1)?.countryId, 'legacy-ng');
  assert.equal(validated.countries.at(-1)?.points, null);
  assert.equal(validated.emittedUnits, 1);
});

test('rejects unknown schema fields and source or parent provenance drift', () => {
  const valid = fixture();
  assert.throws(() => validateSettlementManifest({ ...valid, surprise: true }), /unknown fields/);
  assert.throws(() => validateSettlementManifest({ ...valid, source: { ...valid.source, url: 'https://example.invalid/places.geojson' } }), /pinned Natural Earth artifact/);
  assert.throws(() => validateSettlementManifest({ ...valid, source: { ...valid.source, id: 'wrong-id' } }), /pinned Natural Earth artifact/);
  assert.throws(() => validateSettlementManifest({ ...valid, parent: { ...valid.parent, manifestHash: 'bad-hash' } }), /manifest hash/);
  assert.throws(() => validateSettlementManifest({ ...valid, compiler: 'selected-place-compiler-v0' }), /unsupported/);
});

test('accepts independently pinned valid Natural Earth source releases and editorial limitation text', () => {
  const valid = fixture(), otherRelease = 'f'.repeat(40);
  const parent = { ...valid.parent, source: {
    ...valid.parent.source,
    id: `natural-earth-admin0-10m-${otherRelease}`,
    release: otherRelease,
    url: `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${otherRelease}/geojson/ne_10m_admin_0_countries.geojson`,
  } };
  const result = validateSettlementManifest({ ...valid, parent, limitations: ['Official administration and playability are outside this product.'] });
  assert.equal(result.parent.source.release, otherRelease);
});

test('rejects inconsistent global and country count conservation', () => {
  const valid = fixture();
  assert.throws(() => validateSettlementManifest({ ...valid, linked: 3 }), /count conservation/);
  assert.throws(() => validateSettlementManifest({ ...valid, exceptionUnits: 0 }), /count conservation/);
  assert.throws(() => validateSettlementManifest({ ...valid, validPoints: 4 }), /count conservation/);
  const impossible = fixture();
  impossible.emittedUnits = 2; impossible.exceptionUnits = 3; impossible.invalidRows = 4; impossible.validPoints = 1;
  impossible.countries[0] = { ...impossible.countries[0]!, emittedUnits: 2 };
  assert.throws(() => validateSettlementManifest(impossible), /count conservation/);
  const countries = [...valid.countries]; countries[0] = { ...countries[0]!, emittedUnits: 0 };
  assert.throws(() => validateSettlementManifest({ ...valid, countries }), /status and point asset|country totals/);
});

test('accepts an empty point source without claiming global completeness', () => {
  const empty = fixture();
  empty.sourceUnits = 0; empty.validPoints = 0; empty.linked = 0; empty.protected = 0;
  empty.unlinked = 0; empty.ambiguous = 0; empty.invalidRows = 0; empty.emittedUnits = 0; empty.exceptionUnits = 0;
  empty.countries = empty.countries.map(country => ({
    countryId: country.countryId, status: country.countryId === 'legacy-ng' ? 'protected' : 'missing', sourceUnits: 0, emittedUnits: 0, points: null,
  }));
  const result = validateSettlementManifest(empty);
  assert.equal(result.sourceUnits, 0);
  assert.equal(result.countries.find(country => country.countryId === 'legacy-ng')?.status, 'protected');
});

test('requires sorted unique refs and the protected Nigeria no-asset invariant', () => {
  const valid = fixture();
  const countries = [...valid.countries]; [countries[0], countries[1]] = [countries[1]!, countries[0]!];
  assert.throws(() => validateSettlementManifest({ ...valid, countries }), /sorted and unique/);
  const nigeria = [...valid.countries]; nigeria[nigeria.length - 1] = { ...nigeria.at(-1)!, points: { path: pointsPath, sha256: 'c'.repeat(64), bytes: 300 }, status: 'available', emittedUnits: 1 };
  assert.throws(() => validateSettlementManifest({ ...valid, countries: nigeria, emittedUnits: 2, exceptionUnits: 3 }), /Nigeria must remain protected/);
  assert.throws(() => validateSettlementManifest({ ...valid, countries: valid.countries.slice(0, -1) }), /exactly one Nigeria/);
});

test('accepts an exact selected-country payload and preserves original point values', () => {
  const manifest = validateSettlementManifest(fixture());
  const country = manifest.countries[0]!;
  const result = validateSettlementCountryPoints(payload(manifest), manifest, country);
  assert.deepEqual(result.rows[0]?.coordinates, [3.4, 6.5]);
  assert.equal(result.rows[0]?.name, 'Example Place');
  assert.equal(result.rows[0]?.sourceOrdinal, 4);
});

test('rejects point payloads with wrong country, source, parent, reference or counts', () => {
  const manifest = validateSettlementManifest(fixture()), country = manifest.countries[0]!;
  assert.throws(() => validateSettlementCountryPoints(payload(manifest, { countryId: 'legacy-ng' }), manifest, country), /different source, parent, country, or count/);
  assert.throws(() => validateSettlementCountryPoints(payload(manifest, { sourceSha256: 'f'.repeat(64) }), manifest, country), /different source/);
  assert.throws(() => validateSettlementCountryPoints(payload(manifest, { parentManifestHash: 'f'.repeat(64) }), manifest, country), /different source/);
  assert.throws(() => validateSettlementCountryPoints(payload(manifest, { emittedUnits: 2 }), manifest, country), /different source/);
  assert.throws(() => validateSettlementCountryPoints(payload(manifest, { unknown: 1 }), manifest, country), /unknown fields/);
  assert.throws(() => validateSettlementCountryPoints(payload(manifest), manifest, manifest.countries.at(-1)!), /available manifest reference/);
});

test('rejects duplicate or noncanonical identities, ordinals, labels, ranks and coordinates', () => {
  const manifest = validateSettlementManifest(fixture()), country = manifest.countries[0]!;
  for (const invalid of [
    point({ sourceKey: 'NE_ID:01' }), point({ id: 'place:natural-earth:wrong' }), point({ sourceOrdinal: 5 }),
    point({ scaleRank: 11 }), point({ name: '' }), point({ name: 'é'.repeat(129) }),
    point({ coordinates: [1, 2, 3] }), point({ coordinates: [Number.NaN, 2] }), point({ coordinates: [181, 0] }),
  ]) {
    assert.throws(() => validateSettlementCountryPoints(payload(manifest, { rows: [invalid] }), manifest, country));
  }
  const twoPointRaw = fixture();
  twoPointRaw.emittedUnits = 2; twoPointRaw.exceptionUnits = 3;
  twoPointRaw.countries[0] = { ...twoPointRaw.countries[0]!, emittedUnits: 2 };
  const twoPointManifest = validateSettlementManifest(twoPointRaw), twoPointCountry = twoPointManifest.countries[0]!;
  const second = point({ sourceOrdinal: 5, sourceKey: 'NE_ID:2', id: 'place:natural-earth:NE_ID%3A2' });
  assert.throws(() => validateSettlementCountryPoints(payload(twoPointManifest, { rows: [point(), { ...second, sourceOrdinal: 4 }] }), twoPointManifest, twoPointCountry), /ordinals must be unique/);
  assert.throws(() => validateSettlementCountryPoints(payload(twoPointManifest, { rows: [point(), point({ sourceOrdinal: 3 })] }), twoPointManifest, twoPointCountry), /IDs, source keys, and ordinals must be unique/);
  assert.throws(() => validateSettlementCountryPoints(payload(manifest, { rows: [] }), manifest, country), /rows do not match/);
});
