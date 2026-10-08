import type { FineSourcePin, FineTopologyReport } from './fine-types.ts';

export const FINE_PLANAR_EXCEPTION = 'OGC validity uses only 2D longitude/latitude in a plane; higher ordinates are ignored and this does not establish spherical validity on the ellipsoid.';
export const FINE_UNSUPPORTED_EXCEPTION = 'Polar, global-span, or ambiguous longitude geometries are reported unsupported, not valid.';
const VALIDATOR = 'duckdb-spatial-ogc-planar-v1';
const DUCKDB_VERSION = '1.5.6';
const SPATIAL_VERSION = '04270fe';
const SPATIAL_SHA256 = 'e326286e0ff4651680bfa2918fb22990fed50cb7d27d79dd21143ac7e74b0da9';

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw new TypeError(`${label} has missing or unknown fields`);
}
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError('topology report contains a non-finite number'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  throw new TypeError('topology report contains a non-JSON value');
}
function text(value: unknown, label: string, max = 2048): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError(`${label} is invalid bounded text`);
  return value;
}
function compareCodepoints(left: string, right: string): number {
  const a = Array.from(left, character => character.codePointAt(0)!);
  const b = Array.from(right, character => character.codePointAt(0)!);
  for (let index = 0; index < Math.min(a.length, b.length); index++) if (a[index] !== b[index]) return a[index]! - b[index]!;
  return a.length - b.length;
}

/** Validate externally-produced planar topology evidence against the exact source pin and keys. */
export function validateFineTopologyReport(value: unknown, pin: FineSourcePin, expectedKeys: readonly string[]): FineTopologyReport {
  if (!pin || pin.schemaVersion !== 1 || !pin.source || !/^[a-f0-9]{64}$/.test(pin.source.sha256)
      || !Number.isSafeInteger(pin.source.bytes) || pin.source.bytes < 1 || pin.source.bytes > 8 * 1024 * 1024
      || !Number.isSafeInteger(pin.expectedUnits) || pin.expectedUnits < 1 || pin.expectedUnits > 32) {
    throw new TypeError('fine topology source pin basics are invalid');
  }
  if (!Array.isArray(expectedKeys) || expectedKeys.length !== pin.expectedUnits || expectedKeys.length < 1 || expectedKeys.length > 32) throw new TypeError('expected topology keys must match the pinned unit count');
  const sortedExpected = [...expectedKeys];
  if (sortedExpected.some(key => typeof key !== 'string' || !key.trim() || key.length > 256 || /[\u0000-\u001f\u007f]/.test(key)) || new Set(sortedExpected).size !== sortedExpected.length) throw new TypeError('expected topology keys are invalid or duplicated');
  sortedExpected.sort(compareCodepoints);

  const report = object(value, 'fine topology report');
  exactKeys(report, ['schemaVersion', 'validator', 'sourceSha256', 'sourceBytes', 'expectedUnits', 'checkedUnits', 'validUnits', 'invalidUnits', 'unsupportedUnits', 'tooling', 'rows', 'exceptions'], 'fine topology report');
  if (report.schemaVersion !== 1 || report.validator !== VALIDATOR || report.sourceSha256 !== pin.source.sha256 || report.sourceBytes !== pin.source.bytes || report.expectedUnits !== pin.expectedUnits) throw new Error('fine topology report does not match its pinned source or validator contract');
  const count = (candidate: unknown, label: string, max: number): number => {
    if (!Number.isSafeInteger(candidate) || (candidate as number) < 0 || (candidate as number) > max) throw new RangeError(`${label} is outside its bounded range`);
    return candidate as number;
  };
  const expected = pin.expectedUnits;
  const checkedUnits = count(report.checkedUnits, 'checkedUnits', expected);
  const validUnits = count(report.validUnits, 'validUnits', expected);
  const invalidUnits = count(report.invalidUnits, 'invalidUnits', expected);
  const unsupportedUnits = count(report.unsupportedUnits, 'unsupportedUnits', expected);
  const tooling = object(report.tooling, 'topology tooling identity');
  exactKeys(tooling, ['duckdbVersion', 'spatialVersion', 'spatialSha256'], 'topology tooling identity');
  if (tooling.duckdbVersion !== DUCKDB_VERSION || tooling.spatialVersion !== SPATIAL_VERSION || tooling.spatialSha256 !== SPATIAL_SHA256) throw new Error('fine topology report tooling differs from the pinned runtime');
  if (!Array.isArray(report.rows) || report.rows.length !== expected) throw new Error('fine topology report rows differ from expected units');
  const rows = report.rows.map((raw, index) => {
    const row = object(raw, `topology rows[${index}]`);
    exactKeys(row, ['featureKey', 'status', 'valid', 'empty', 'reason'], `topology rows[${index}]`);
    const featureKey = text(row.featureKey, `topology rows[${index}].featureKey`, 256);
    if (featureKey !== sortedExpected[index]) throw new Error('fine topology report feature keys are not exact and codepoint-sorted');
    if (row.status === 'valid') {
      if (row.valid !== true || row.empty !== false || row.reason !== null) throw new Error(`valid topology row ${featureKey} has inconsistent predicates`);
    } else if (row.status === 'invalid') {
      if (typeof row.valid !== 'boolean' || (row.empty !== true && row.empty !== false && row.empty !== null)
          || (row.valid !== false && row.empty !== true) || (row.empty === null && row.valid !== false)) throw new Error(`invalid topology row ${featureKey} has inconsistent predicates`);
      text(row.reason, `topology rows[${index}].reason`, 512);
    } else if (row.status === 'unsupported') {
      if (row.valid !== null || row.empty !== null) throw new Error(`unsupported topology row ${featureKey} must not claim predicates`);
      text(row.reason, `topology rows[${index}].reason`, 512);
    } else throw new TypeError(`topology row ${featureKey} has an unknown status`);
    return row as unknown as FineTopologyReport['rows'][number];
  });
  if (rows.filter(row => row.status === 'valid').length !== validUnits || rows.filter(row => row.status === 'invalid').length !== invalidUnits
      || rows.filter(row => row.status === 'unsupported').length !== unsupportedUnits || checkedUnits !== validUnits + invalidUnits
      || checkedUnits + unsupportedUnits !== expected) throw new Error('fine topology report status counts do not conserve source units');
  if (!Array.isArray(report.exceptions) || report.exceptions.length < 1 || report.exceptions.length > 8) throw new TypeError('fine topology exceptions are invalid');
  const exceptions = report.exceptions.map((entry, index) => text(entry, `topology exceptions[${index}]`, 1024));
  const expectedExceptions = unsupportedUnits > 0 ? [FINE_PLANAR_EXCEPTION, FINE_UNSUPPORTED_EXCEPTION] : [FINE_PLANAR_EXCEPTION];
  if (canonical(exceptions) !== canonical(expectedExceptions)) throw new Error('fine topology report exceptions differ from the exact validator contract');
  return { schemaVersion: 1, validator: VALIDATOR, sourceSha256: pin.source.sha256, sourceBytes: pin.source.bytes,
    expectedUnits: expected, checkedUnits, validUnits, invalidUnits, unsupportedUnits,
    tooling: { duckdbVersion: DUCKDB_VERSION, spatialVersion: SPATIAL_VERSION, spatialSha256: SPATIAL_SHA256 }, rows, exceptions };
}
