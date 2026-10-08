import {
  SETTLEMENT_COMPILER,
  SETTLEMENT_PRODUCT,
  SETTLEMENT_PRODUCT_LIMITS as LIMITS,
  type SettlementAssetRef,
  type SettlementCountryPoints,
  type SettlementCountryRef,
  type SettlementPointRecord,
  type SettlementProductManifest,
} from '../settlement-product-types.ts';
import type { SourceRecord } from '../types.ts';

const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/u;
const PLACES_URL = (release: string) => `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${release}/geojson/ne_10m_populated_places.geojson`;
const ADMIN0_URL = (release: string) => `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${release}/geojson/ne_10m_admin_0_countries.geojson`;
const COUNTRY_ID = /^country:natural-earth:NE_ID%3A([1-9][0-9]*)$/;

const own = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
};

function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new TypeError(`${label} has missing or unknown fields`);
  }
}

function safeText(value: unknown, label: string, maxBytes: number): string {
  if (typeof value !== 'string' || value.length === 0 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${label} must be non-empty bounded text`);
  }
  if (new TextEncoder().encode(value).byteLength > maxBytes) throw new RangeError(`${label} exceeds its UTF-8 byte limit`);
  return value;
}

function positiveInt(value: unknown, label: string, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new RangeError(`${label} is outside its integer range`);
  }
  return value;
}

function count(value: unknown, label: string, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${label} is outside its count range`);
  }
  return value;
}

function validCountryId(value: unknown): value is string {
  if (value === 'legacy-ng') return true;
  if (typeof value !== 'string') return false;
  const match = COUNTRY_ID.exec(value);
  if (!match) return false;
  const key = Number(match[1]);
  return Number.isSafeInteger(key) && key > 0 && String(key) === match[1];
}

function sourceRecord(value: unknown, kind: 'places' | 'admin0'): SourceRecord {
  const row = own(value, `${kind} source`);
  exact(row, ['id', 'url', 'release', 'license', 'attribution', 'sha256', 'bytes'], `${kind} source`);
  const release = row.release;
  const cap = kind === 'places' ? LIMITS.sourceBytes : LIMITS.parentSourceBytes;
  const expectedId = typeof release === 'string' ? `natural-earth-${kind === 'places' ? 'places' : 'admin0'}-10m-${release}` : '';
  const expectedUrl = typeof release === 'string' ? (kind === 'places' ? PLACES_URL(release) : ADMIN0_URL(release)) : '';
  if (typeof release !== 'string' || !COMMIT.test(release) || row.id !== expectedId || row.url !== expectedUrl
    || row.license !== 'Public-domain') {
    throw new TypeError(`${kind} source does not match the pinned Natural Earth artifact and release`);
  }
  safeText(row.attribution, `${kind} attribution`, 2048);
  if (typeof row.sha256 !== 'string' || !HASH.test(row.sha256)
    || typeof row.bytes !== 'number' || !Number.isSafeInteger(row.bytes) || row.bytes < 1 || row.bytes > cap) {
    throw new TypeError(`${kind} source hash or byte count is invalid`);
  }
  return row as unknown as SourceRecord;
}

function assetRef(value: unknown, kind: 'report' | 'points'): SettlementAssetRef {
  const row = own(value, `${kind} asset reference`);
  exact(row, ['path', 'sha256', 'bytes'], `${kind} asset reference`);
  const pattern = kind === 'report' ? /^reports\/([a-f0-9]{64})\.json$/u : /^points\/([a-f0-9]{64})\.json$/u;
  const match = typeof row.path === 'string' ? pattern.exec(row.path) : null;
  if (!match || row.sha256 !== match[1]) throw new TypeError(`${kind} path must embed its exact content hash`);
  const cap = kind === 'report' ? LIMITS.reportBytes : LIMITS.countryBytes;
  const bytes = positiveInt(row.bytes, `${kind} byte length`, cap);
  return { path: row.path as string, sha256: row.sha256 as string, bytes };
}

function safeLimitations(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) throw new TypeError('settlement limitations are missing or excessive');
  const limitations = value.map((item, index) => safeText(item, `limitation ${index}`, 2048));
  if (new Set(limitations).size !== limitations.length) throw new TypeError('settlement limitations must be unique');
  return limitations;
}

function countryRef(value: unknown, index: number): SettlementCountryRef {
  const row = own(value, `settlement country ${index}`);
  exact(row, ['countryId', 'status', 'sourceUnits', 'emittedUnits', 'points'], `settlement country ${index}`);
  const countryId = row.countryId;
  if (!validCountryId(countryId)) {
    throw new TypeError(`settlement country ${index} has an invalid country identity`);
  }
  if (row.status !== 'available' && row.status !== 'missing' && row.status !== 'protected') {
    throw new TypeError(`settlement country ${index} status is invalid`);
  }
  const sourceUnits = count(row.sourceUnits, `settlement country ${index} source units`, LIMITS.sourceUnits);
  const emittedUnits = count(row.emittedUnits, `settlement country ${index} emitted units`, LIMITS.sourceUnits);
  if (emittedUnits > sourceUnits) throw new RangeError(`settlement country ${index} emits more points than source rows`);
  const points = row.points === null ? null : assetRef(row.points, 'points');
  if (countryId === 'legacy-ng') {
    if (row.status !== 'protected' || emittedUnits !== 0 || points !== null) {
      throw new TypeError('Nigeria must remain protected with zero emitted points and no asset');
    }
  } else if (row.status === 'protected') {
    throw new TypeError('only the legacy Nigeria provider may be protected');
  }
  if (row.status === 'available' ? emittedUnits < 1 || points === null : emittedUnits !== 0 || points !== null) {
    throw new TypeError(`settlement country ${index} status and point asset do not agree`);
  }
  return { countryId: countryId as string, status: row.status, sourceUnits, emittedUnits, points };
}

/** Validate the exact admitted, source-bound selected-place product envelope. */
export function validateSettlementManifest(value: unknown): SettlementProductManifest {
  const row = own(value, 'settlement manifest');
  exact(row, ['schemaVersion', 'product', 'compiler', 'source', 'parent', 'joinPolicy', 'keyField', 'countryField', 'representation', 'validation',
    'sourceUnits', 'validPoints', 'linked', 'protected', 'unlinked', 'ambiguous', 'invalidRows', 'emittedUnits', 'exceptionUnits', 'inspection', 'countries', 'limitations'], 'settlement manifest');
  if (row.schemaVersion !== 1 || row.product !== SETTLEMENT_PRODUCT || row.compiler !== SETTLEMENT_COMPILER
    || row.joinPolicy !== 'literal-ADM0_A3-v1' || row.keyField !== 'NE_ID' || row.countryField !== 'ADM0_A3'
    || row.representation !== 'selected-source-point-geometry'
    || row.validation !== 'source-bound-structural-with-explicit-exceptions') {
    throw new TypeError('settlement manifest schema, compiler, or representation is unsupported');
  }
  const source = sourceRecord(row.source, 'places');
  const parent = own(row.parent, 'settlement parent');
  exact(parent, ['manifestHash', 'source'], 'settlement parent');
  if (typeof parent.manifestHash !== 'string' || !HASH.test(parent.manifestHash)) throw new TypeError('settlement parent manifest hash is invalid');
  const parentSource = sourceRecord(parent.source, 'admin0');

  const sourceUnits = count(row.sourceUnits, 'settlement source units', LIMITS.sourceUnits);
  const validPoints = count(row.validPoints, 'valid point count', sourceUnits);
  const linked = count(row.linked, 'linked count', sourceUnits);
  const protectedCount = count(row.protected, 'protected count', sourceUnits);
  const unlinked = count(row.unlinked, 'unlinked count', sourceUnits);
  const ambiguous = count(row.ambiguous, 'ambiguous count', sourceUnits);
  const invalidRows = count(row.invalidRows, 'invalid row count', sourceUnits);
  const emittedUnits = count(row.emittedUnits, 'emitted point count', sourceUnits);
  const exceptionUnits = count(row.exceptionUnits, 'exception row count', sourceUnits);
  if (sourceUnits !== linked + protectedCount + unlinked + ambiguous || exceptionUnits !== sourceUnits - emittedUnits
    || invalidRows < sourceUnits - validPoints || invalidRows > sourceUnits || emittedUnits > linked
    || emittedUnits > validPoints || emittedUnits > sourceUnits - invalidRows) {
    throw new RangeError('settlement manifest count conservation failed');
  }
  const inspection = assetRef(row.inspection, 'report');

  if (!Array.isArray(row.countries) || row.countries.length < 1 || row.countries.length > LIMITS.countries) {
    throw new TypeError('settlement manifest parent country references exceed the country cap');
  }
  const countries = row.countries.map(countryRef);
  if (countries.some((country, index) => index > 0 && countries[index - 1]!.countryId >= country.countryId)) {
    throw new TypeError('settlement country references must be sorted and unique');
  }
  const nigeria = countries.filter(country => country.countryId === 'legacy-ng');
  if (nigeria.length !== 1 || countries.filter(country => country.status === 'protected').length !== 1
    || nigeria[0]!.sourceUnits !== protectedCount) throw new TypeError('settlement manifest must preserve exactly one Nigeria ref and derive the protected count from it');
  const countrySourceTotal = countries.reduce((sum, country) => sum + country.sourceUnits, 0);
  const countryEmittedTotal = countries.reduce((sum, country) => sum + country.emittedUnits, 0);
  if (countrySourceTotal !== linked + protectedCount || countryEmittedTotal !== emittedUnits) {
    throw new RangeError('settlement country totals do not conserve linked/protected/emitted rows');
  }
  const pointPaths = countries.flatMap(country => country.points ? [country.points.path] : []);
  if (new Set(pointPaths).size !== pointPaths.length) throw new TypeError('settlement country point assets must be unique per country');
  const limitations = safeLimitations(row.limitations);
  return { schemaVersion: 1, product: SETTLEMENT_PRODUCT, compiler: SETTLEMENT_COMPILER, source, parent: { manifestHash: parent.manifestHash as string, source: parentSource },
    joinPolicy: 'literal-ADM0_A3-v1', keyField: 'NE_ID', countryField: 'ADM0_A3', representation: 'selected-source-point-geometry',
    validation: 'source-bound-structural-with-explicit-exceptions', sourceUnits, validPoints, linked, protected: protectedCount, unlinked, ambiguous,
    invalidRows, emittedUnits, exceptionUnits, inspection, countries, limitations };
}

function sourceKey(value: unknown): string {
  if (typeof value !== 'string' || !/^NE_ID:[1-9][0-9]*$/u.test(value)) throw new TypeError('settlement source key is not a canonical NE_ID');
  const number = Number(value.slice(6));
  if (!Number.isSafeInteger(number) || number < 1 || String(number) !== value.slice(6)) throw new TypeError('settlement source key integer is invalid');
  return value;
}

function pointRecord(value: unknown, index: number, manifest: SettlementProductManifest): SettlementPointRecord {
  const row = own(value, `settlement point ${index}`);
  exact(row, ['sourceOrdinal', 'sourceKey', 'id', 'name', 'nameAscii', 'sourceClass', 'scaleRank', 'coordinates'], `settlement point ${index}`);
  const ordinal = row.sourceOrdinal;
  if (typeof ordinal !== 'number' || !Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= manifest.sourceUnits) {
    throw new RangeError(`settlement point ${index} source ordinal is outside the raw source`);
  }
  const key = sourceKey(row.sourceKey);
  if (row.id !== `place:natural-earth:${encodeURIComponent(key)}`) throw new TypeError(`settlement point ${index} ID does not derive from its source key`);
  const name = safeText(row.name, `settlement point ${index} name`, LIMITS.textBytes);
  const nameAscii = safeText(row.nameAscii, `settlement point ${index} ASCII name`, LIMITS.textBytes);
  const sourceClass = safeText(row.sourceClass, `settlement point ${index} source class`, LIMITS.textBytes);
  if (typeof row.scaleRank !== 'number' || !Number.isSafeInteger(row.scaleRank) || row.scaleRank < 0 || row.scaleRank > 10) {
    throw new RangeError(`settlement point ${index} scale rank must be an integer from 0 to 10`);
  }
  if (!Array.isArray(row.coordinates) || row.coordinates.length !== 2
    || row.coordinates.some(coordinate => typeof coordinate !== 'number' || !Number.isFinite(coordinate))) {
    throw new TypeError(`settlement point ${index} coordinates must be exactly two finite numbers`);
  }
  const [longitude, latitude] = row.coordinates as number[];
  if (longitude! < -180 || longitude! > 180 || latitude! < -90 || latitude! > 90) {
    throw new RangeError(`settlement point ${index} coordinates are outside WGS84`);
  }
  return { sourceOrdinal: ordinal, sourceKey: key, id: row.id as string,
    name, nameAscii, sourceClass, scaleRank: row.scaleRank, coordinates: [longitude!, latitude!] };
}

/** Validate one selected non-Nigeria country payload against its exact manifest reference. */
export function validateSettlementCountryPoints(value: unknown, manifest: SettlementProductManifest, country: SettlementCountryRef): SettlementCountryPoints {
  const expected = manifest.countries.find(item => item.countryId === country.countryId);
  if (!expected || expected.status !== 'available' || !country.points
    || country.countryId !== expected.countryId || country.status !== expected.status
    || country.sourceUnits !== expected.sourceUnits || country.emittedUnits !== expected.emittedUnits
    || country.points.path !== expected.points?.path || country.points.sha256 !== expected.points?.sha256
    || country.points.bytes !== expected.points?.bytes) throw new TypeError('selected settlement country does not match an available manifest reference');
  if (country.countryId === 'legacy-ng') throw new TypeError('protected Nigeria has no settlement point payload');
  const row = own(value, 'settlement country points');
  exact(row, ['schemaVersion', 'product', 'countryId', 'sourceSha256', 'parentManifestHash', 'sourceUnits', 'emittedUnits', 'rows'], 'settlement country points');
  if (row.schemaVersion !== 1 || row.product !== SETTLEMENT_PRODUCT || row.countryId !== expected.countryId
    || row.sourceSha256 !== manifest.source.sha256 || row.parentManifestHash !== manifest.parent.manifestHash
    || row.sourceUnits !== expected.sourceUnits || row.emittedUnits !== expected.emittedUnits) {
    throw new TypeError('settlement country points are bound to a different source, parent, country, or count');
  }
  if (!Array.isArray(row.rows) || row.rows.length !== expected.emittedUnits || row.rows.length > LIMITS.countryPoints) {
    throw new RangeError('settlement country point rows do not match the manifest count or cap');
  }
  const rows = row.rows.map((point, index) => pointRecord(point, index, manifest));
  const ids = new Set<string>(), keys = new Set<string>(), ordinals = new Set<number>();
  for (let index = 0; index < rows.length; index++) {
    const point = rows[index]!;
    if (ids.has(point.id) || keys.has(point.sourceKey) || ordinals.has(point.sourceOrdinal)) throw new TypeError('settlement point IDs, source keys, and ordinals must be unique');
    if (index > 0 && rows[index - 1]!.sourceKey >= point.sourceKey) throw new TypeError('settlement point rows must be strictly sorted by source key');
    ids.add(point.id); keys.add(point.sourceKey); ordinals.add(point.sourceOrdinal);
  }
  return { schemaVersion: 1, product: SETTLEMENT_PRODUCT, countryId: expected.countryId, sourceSha256: manifest.source.sha256,
    parentManifestHash: manifest.parent.manifestHash, sourceUnits: expected.sourceUnits, emittedUnits: expected.emittedUnits, rows };
}
