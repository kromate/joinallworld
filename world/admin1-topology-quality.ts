import type { Admin1AuditRow, Admin1InspectionReport } from './admin1-types.ts';
import type { Admin1ProductManifest } from './admin1-product-types.ts';
import {
  ADMIN1_TOPOLOGY_LIMITS, ADMIN1_TOPOLOGY_SCOPE, ADMIN1_TOPOLOGY_VALIDATOR,
  type Admin1TopologyBinding, type Admin1TopologyReport, type Admin1TopologyRow,
  type Admin1TopologyStatus, type Admin1TopologyTooling, type Admin1TopologyWorkerReport,
} from './admin1-topology-types.ts';

const SHA256 = /^[a-f0-9]{64}$/;
const SHA1 = /^[a-f0-9]{40}$/;
const own = (value: unknown, keys: readonly string[], label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key))) throw new TypeError(`${label} fields are invalid`);
  return row;
};
const integer = (value: unknown, minimum: number, maximum: number, label: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`${label} is outside its bound`);
  return value;
};
const boundedText = (value: unknown, maxBytes: number, label: string): string => {
  if (typeof value !== 'string' || value.length === 0 || new TextEncoder().encode(value).byteLength > maxBytes || /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
};
const source = (value: unknown, label: string): { sha256: string; bytes: number } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} source is invalid`);
  const row = value as Record<string, unknown>;
  if (typeof row.sha256 !== 'string' || !SHA256.test(row.sha256)) throw new TypeError(`${label} source hash is invalid`);
  return { sha256: row.sha256, bytes: integer(row.bytes, 1, ADMIN1_TOPOLOGY_LIMITS.sourceBytes, `${label} source bytes`) };
};
const tooling = (value: unknown, full: boolean): Admin1TopologyTooling => {
  const keys = full
    ? ['duckdbVersion', 'spatialVersion', 'spatialSha256', 'workerSha256', 'geometryHelperSha256']
    : ['duckdbVersion', 'spatialVersion', 'spatialSha256'];
  const row = own(value, keys, 'topology tooling');
  if (row.duckdbVersion !== '1.5.6' || row.spatialVersion !== '04270fe' || row.spatialSha256 !== 'e326286e0ff4651680bfa2918fb22990fed50cb7d27d79dd21143ac7e74b0da9') throw new TypeError('topology runtime pin mismatch');
  if (full && (typeof row.workerSha256 !== 'string' || !SHA256.test(row.workerSha256) || typeof row.geometryHelperSha256 !== 'string' || !SHA256.test(row.geometryHelperSha256))) throw new TypeError('topology source-tool hash mismatch');
  return row as unknown as Admin1TopologyTooling;
};

const workerFields = ['schemaVersion', 'validator', 'sourceSha256', 'sourceBytes', 'expectedUnits', 'tooling', 'rows'] as const;
const workerRowFields = ['sourceOrdinal', 'sourceKey', 'status', 'valid', 'empty', 'reason'] as const;
const reportFields = ['schemaVersion', 'validator', 'sourceSha256', 'sourceBytes', 'parentManifestHash', 'publicationManifestHash', 'inspectionSha256', 'expectedUnits', 'checkedUnits', 'validUnits', 'invalidUnits', 'unsupportedUnits', 'protectedUnits', 'tooling', 'rows', 'limitations'] as const;
const reportRowFields = ['sourceOrdinal', 'sourceKey', 'status', 'valid', 'empty', 'reason', 'id', 'featureSha256', 'countryId', 'joinStatus'] as const;
const statuses = new Set<Admin1TopologyStatus>(['valid', 'invalid', 'unsupported', 'protected']);

function validatePredicates(status: unknown, valid: unknown, empty: unknown, reason: unknown, label: string): asserts status is Admin1TopologyStatus {
  if (typeof status !== 'string' || !statuses.has(status as Admin1TopologyStatus)) throw new TypeError(`${label} status is invalid`);
  if (status === 'valid') {
    if (valid !== true || empty !== false || reason !== null) throw new TypeError(`${label} valid predicate tuple is inconsistent`);
  } else if (status === 'invalid') {
    if (typeof valid !== 'boolean' || typeof empty !== 'boolean' || !(valid === false || empty === true) || typeof reason !== 'string') throw new TypeError(`${label} invalid predicate tuple is inconsistent`);
  } else if (status === 'unsupported') {
    if (valid !== null || empty !== null || typeof reason !== 'string') throw new TypeError(`${label} unsupported predicate tuple is inconsistent`);
  } else if (valid !== null || empty !== null || reason !== 'protected-nigeria-no-topology') {
    throw new TypeError(`${label} protected predicate tuple is inconsistent`);
  }
  if (typeof reason === 'string') boundedText(reason, 256, `${label} reason`);
}

function validatedBinding(binding: Admin1TopologyBinding): { manifest: Admin1ProductManifest; inspection: Admin1InspectionReport; tooling: Admin1TopologyTooling; rows: Admin1AuditRow[] } {
  if (!binding || typeof binding !== 'object') throw new TypeError('topology binding is invalid');
  if (typeof binding.manifestHash !== 'string' || !SHA256.test(binding.manifestHash)) throw new TypeError('publication manifest hash is invalid');
  const manifest = binding.manifest, inspection = binding.inspection;
  if (!manifest || manifest.schemaVersion !== 1 || manifest.product !== 'natural-earth-admin1-partitions-v1' || !manifest.validation || manifest.validation.topology !== 'unverified') throw new TypeError('topology binding manifest is invalid');
  const manifestSource = source(manifest.source, 'manifest');
  const inspectionSource = source(inspection.source, 'inspection');
  if (manifestSource.sha256 !== inspectionSource.sha256 || manifestSource.bytes !== inspectionSource.bytes || manifest.parent.manifestHash !== inspection.parent.manifestHash || manifest.sourceUnits !== inspection.sourceUnits) throw new TypeError('manifest and inspection binding disagree');
  if (!SHA256.test(manifest.parent.manifestHash) || !SHA256.test(inspection.source.sha256) || !SHA256.test(manifest.inspection.sha256)) throw new TypeError('source parent binding is invalid');
  const rows = inspection.rows;
  const expected = integer(inspection.sourceUnits, 1, ADMIN1_TOPOLOGY_LIMITS.sourceUnits, 'inspection units');
  if (!Array.isArray(rows) || rows.length !== expected) throw new RangeError('inspection rows do not match source denominator');
  const ordinals = new Set<number>(), keys = new Set<string>(); let sourcePositions = 0, sourcePolygons = 0, geometryExceptions = 0;
  for (const row of rows) {
    integer(row.sourceOrdinal, 0, expected - 1, 'inspection ordinal');
    if (ordinals.has(row.sourceOrdinal) || keys.has(row.sourceKey)) throw new TypeError('inspection contains duplicate row identity');
    const sourceKeyMatch = /^NE_ID:([1-9][0-9]*)$/.exec(row.sourceKey);
    const neId = sourceKeyMatch?.[1];
    if (!sourceKeyMatch || !neId || !Number.isSafeInteger(Number(neId)) || String(Number(neId)) !== neId || row.id !== `admin1:natural-earth:${encodeURIComponent(row.sourceKey)}` || !SHA256.test(row.featureSha256)) throw new TypeError('inspection row identity/hash is invalid');
    if (!['linked', 'protected', 'unlinked', 'ambiguous'].includes(row.joinStatus)) throw new TypeError('inspection join status is invalid');
    if (row.joinStatus === 'protected') {
      if (row.adm0Code !== 'NGA' || row.countryId !== null) throw new TypeError('protected inspection row is not Nigeria');
    } else if (row.joinStatus === 'linked') {
      boundedText(row.countryId, 512, 'linked country ID');
      if (row.adm0Code === 'NGA' || row.countryId === 'legacy-ng') throw new TypeError('Nigeria source row was misclassified as linked');
    } else if (row.countryId !== null || row.adm0Code === 'NGA') throw new TypeError('unlinked or ambiguous inspection row has a country ID or Nigeria code');
    sourcePositions += integer(row.positions, 0, ADMIN1_TOPOLOGY_LIMITS.positions, 'inspection positions');
    sourcePolygons += integer(row.polygons, 0, ADMIN1_TOPOLOGY_LIMITS.positions, 'inspection polygons');
    if (row.geometryIssue !== null) { boundedText(row.geometryIssue, 256, 'structural geometry issue'); geometryExceptions++; }
    ordinals.add(row.sourceOrdinal); keys.add(row.sourceKey);
  }
  const joinCounts = {
    linked: rows.filter((row) => row.joinStatus === 'linked').length,
    protected: rows.filter((row) => row.joinStatus === 'protected').length,
    unlinked: rows.filter((row) => row.joinStatus === 'unlinked').length,
    ambiguous: rows.filter((row) => row.joinStatus === 'ambiguous').length,
  };
  if (sourcePositions > ADMIN1_TOPOLOGY_LIMITS.positions || sourcePolygons > ADMIN1_TOPOLOGY_LIMITS.positions || Object.values(joinCounts).reduce((a, b) => a + b, 0) !== expected || manifest.sourcePositions !== sourcePositions || manifest.sourcePolygons !== sourcePolygons || inspection.sourcePositions !== sourcePositions || inspection.sourcePolygons !== sourcePolygons || inspection.geometryExceptions !== geometryExceptions || manifest.emittedUnits + manifest.exceptionUnits !== expected || manifest.linked !== joinCounts.linked || manifest.protected !== joinCounts.protected || manifest.unlinked !== joinCounts.unlinked || manifest.ambiguous !== joinCounts.ambiguous || inspection.linked !== joinCounts.linked || inspection.protected !== joinCounts.protected || inspection.unlinked !== joinCounts.unlinked || inspection.ambiguous !== joinCounts.ambiguous) throw new TypeError('manifest/inspection join or geometry counts do not conserve');
  return { manifest, inspection, tooling: tooling(binding.tooling, true), rows };
}

/** Validates the bounded Python worker response against the published source and complete audit denominator. */
export function validateAdmin1TopologyWorkerReport(value: unknown, binding: Admin1TopologyBinding): Admin1TopologyWorkerReport {
  const b = validatedBinding(binding), row = own(value, workerFields, 'worker report');
  if (row.schemaVersion !== 1 || row.validator !== ADMIN1_TOPOLOGY_VALIDATOR || row.sourceSha256 !== b.manifest.source.sha256 || row.sourceBytes !== b.manifest.source.bytes || row.expectedUnits !== b.inspection.sourceUnits) throw new TypeError('worker report source/validator binding mismatch');
  const t = tooling(row.tooling, false);
  if (t.duckdbVersion !== b.tooling.duckdbVersion || t.spatialVersion !== b.tooling.spatialVersion || t.spatialSha256 !== b.tooling.spatialSha256) throw new TypeError('worker runtime differs from reviewed tooling');
  if (!Array.isArray(row.rows) || row.rows.length !== b.rows.length || row.rows.length > ADMIN1_TOPOLOGY_LIMITS.sourceUnits) throw new RangeError('worker row count differs from inspection denominator');
  const auditByKey = new Map(b.rows.map((audit) => [audit.sourceKey, audit]));
  const ordinals = new Set<number>(); let previousKey = '';
  for (const [index, raw] of row.rows.entries()) {
    const worker = own(raw, workerRowFields, `worker row ${index}`);
    const sourceOrdinal = integer(worker.sourceOrdinal, 0, b.rows.length - 1, `worker row ${index} ordinal`);
    if (ordinals.has(sourceOrdinal) || typeof worker.sourceKey !== 'string' || (previousKey !== '' && previousKey >= worker.sourceKey)) throw new TypeError('worker rows are duplicated or not lexical source-key order');
    previousKey = worker.sourceKey; ordinals.add(sourceOrdinal);
    const audit = auditByKey.get(worker.sourceKey);
    if (!audit || audit.sourceOrdinal !== sourceOrdinal) throw new TypeError('worker row does not match exact inspection key and ordinal');
    validatePredicates(worker.status, worker.valid, worker.empty, worker.reason, `worker row ${index}`);
    if ((audit.joinStatus === 'protected') !== (worker.status === 'protected') || worker.status === 'protected' && audit.adm0Code !== 'NGA') throw new TypeError('worker protection status differs from Nigeria audit identity');
    if (audit.joinStatus !== 'protected' && audit.geometryIssue !== null && worker.status !== 'unsupported') throw new TypeError('structurally unsupported source geometry was submitted as topology-valid');
  }
  return row as unknown as Admin1TopologyWorkerReport;
}

/** Binds validated worker predicates to immutable publication and inspection identities. */
export function bindAdmin1TopologyReport(value: unknown, binding: Admin1TopologyBinding): Admin1TopologyReport {
  const worker = validateAdmin1TopologyWorkerReport(value, binding), b = validatedBinding(binding);
  const auditByKey = new Map(b.rows.map((audit) => [audit.sourceKey, audit]));
  const rows: Admin1TopologyRow[] = worker.rows.map((workerRow) => {
    const audit = auditByKey.get(workerRow.sourceKey)!;
    return { ...workerRow, id: audit.id, featureSha256: audit.featureSha256, countryId: audit.countryId, joinStatus: audit.joinStatus };
  });
  const validUnits = rows.filter((row) => row.status === 'valid').length;
  const invalidUnits = rows.filter((row) => row.status === 'invalid').length;
  const unsupportedUnits = rows.filter((row) => row.status === 'unsupported').length;
  const protectedUnits = rows.filter((row) => row.status === 'protected').length;
  const report: Admin1TopologyReport = {
    schemaVersion: 1, validator: ADMIN1_TOPOLOGY_VALIDATOR,
    sourceSha256: worker.sourceSha256, sourceBytes: worker.sourceBytes,
    parentManifestHash: b.manifest.parent.manifestHash,
    publicationManifestHash: binding.manifestHash,
    inspectionSha256: b.manifest.inspection.sha256,
    expectedUnits: worker.expectedUnits, checkedUnits: validUnits + invalidUnits,
    validUnits, invalidUnits, unsupportedUnits, protectedUnits,
    tooling: b.tooling, rows, limitations: [...ADMIN1_TOPOLOGY_SCOPE],
  };
  return validateAdmin1TopologyReport(report, binding);
}

/** Strict validation for the persisted source-bound sidecar, including exact fixed scope wording. */
export function validateAdmin1TopologyReport(value: unknown, binding: Admin1TopologyBinding): Admin1TopologyReport {
  const b = validatedBinding(binding), report = own(value, reportFields, 'topology report');
  if (report.schemaVersion !== 1 || report.validator !== ADMIN1_TOPOLOGY_VALIDATOR || report.sourceSha256 !== b.manifest.source.sha256 || report.sourceBytes !== b.manifest.source.bytes || report.parentManifestHash !== b.manifest.parent.manifestHash || report.publicationManifestHash !== binding.manifestHash || report.inspectionSha256 !== b.manifest.inspection.sha256 || report.expectedUnits !== b.inspection.sourceUnits) throw new TypeError('topology report binding mismatch');
  const t = tooling(report.tooling, true);
  if (t.duckdbVersion !== b.tooling.duckdbVersion || t.spatialVersion !== b.tooling.spatialVersion || t.spatialSha256 !== b.tooling.spatialSha256 || t.workerSha256 !== b.tooling.workerSha256 || t.geometryHelperSha256 !== b.tooling.geometryHelperSha256) throw new TypeError('topology report tooling mismatch');
  if (!Array.isArray(report.limitations) || report.limitations.length !== ADMIN1_TOPOLOGY_SCOPE.length || report.limitations.some((x, i) => x !== ADMIN1_TOPOLOGY_SCOPE[i])) throw new TypeError('topology report scope wording mismatch');
  if (!Array.isArray(report.rows) || report.rows.length !== b.rows.length) throw new RangeError('topology report row count mismatch');
  const auditByKey = new Map(b.rows.map((audit) => [audit.sourceKey, audit]));
  let previousKey = '', validUnits = 0, invalidUnits = 0, unsupportedUnits = 0, protectedUnits = 0; const ordinals = new Set<number>();
  for (const [index, raw] of report.rows.entries()) {
    const row = own(raw, reportRowFields, `topology row ${index}`);
    const ordinal = integer(row.sourceOrdinal, 0, b.rows.length - 1, `topology row ${index} ordinal`);
    if (ordinals.has(ordinal) || typeof row.sourceKey !== 'string' || (previousKey !== '' && previousKey >= row.sourceKey)) throw new TypeError('topology rows are duplicated or not lexical source-key order');
    previousKey = row.sourceKey; ordinals.add(ordinal);
    const audit = auditByKey.get(row.sourceKey);
    if (!audit || audit.sourceOrdinal !== ordinal || row.id !== audit.id || row.featureSha256 !== audit.featureSha256 || row.countryId !== audit.countryId || row.joinStatus !== audit.joinStatus) throw new TypeError('topology report row differs from bound inspection identity');
    validatePredicates(row.status, row.valid, row.empty, row.reason, `topology row ${index}`);
    if ((audit.joinStatus === 'protected') !== (row.status === 'protected') || audit.joinStatus !== 'protected' && audit.geometryIssue !== null && row.status !== 'unsupported') throw new TypeError('topology report status conflicts with structural/protected audit');
    if (row.status === 'valid') validUnits++; else if (row.status === 'invalid') invalidUnits++; else if (row.status === 'unsupported') unsupportedUnits++; else protectedUnits++;
  }
  const expectedUnits = b.rows.length;
  const checkedUnits = validUnits + invalidUnits;
  if (checkedUnits !== report.checkedUnits || validUnits !== report.validUnits || invalidUnits !== report.invalidUnits || unsupportedUnits !== report.unsupportedUnits || protectedUnits !== report.protectedUnits || validUnits + invalidUnits + unsupportedUnits + protectedUnits !== expectedUnits) throw new TypeError('topology report counts do not conserve');
  return report as unknown as Admin1TopologyReport;
}
