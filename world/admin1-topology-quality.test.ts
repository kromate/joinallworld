import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN1_TOPOLOGY_SCOPE,
  ADMIN1_TOPOLOGY_VALIDATOR,
  type Admin1TopologyBinding,
  type Admin1TopologyWorkerReport,
} from './admin1-topology-types.ts';
import { bindAdmin1TopologyReport, validateAdmin1TopologyReport, validateAdmin1TopologyWorkerReport } from './admin1-topology-quality.ts';

const hash = (digit: string): string => digit.repeat(64);
const extension = 'e326286e0ff4651680bfa2918fb22990fed50cb7d27d79dd21143ac7e74b0da9';
const source = { id: 'fixture', url: 'https://example.invalid/source', release: 'r1', license: 'fixture', attribution: 'fixture', sha256: hash('a'), bytes: 100 };
const tooling = { duckdbVersion: '1.5.6' as const, spatialVersion: '04270fe' as const, spatialSha256: extension, workerSha256: hash('b'), geometryHelperSha256: hash('c') };
const key = (id: number): string => `NE_ID:${id}`;
const auditRow = (ordinal: number, id: number, joinStatus: 'linked' | 'protected', code: string | null, countryId: string | null, geometryIssue: string | null = null) => ({
  sourceOrdinal: ordinal, sourceKey: key(id), id: `admin1:natural-earth:NE_ID%3A${id}`, featureSha256: hash(String((id % 9) + 1)),
  adm0Code: code, countryId, joinStatus, positions: 4, polygons: 1, featureBytes: 40, propertiesBytes: 20, geometryIssue,
});
const binding = (): Admin1TopologyBinding => {
  const rows = [auditRow(0, 1, 'linked', 'AAA', 'country:aaa'), auditRow(1, 2, 'protected', 'NGA', null), auditRow(2, 3, 'linked', 'BBB', 'country:bbb', 'position-outside-wgs84')];
  const inspection = { schemaVersion: 1, inspector: 'natural-earth-admin1-structural-v1', source, parent: { manifestHash: hash('d'), source }, sourceUnits: 3, sourcePositions: 12, sourcePolygons: 3, linked: 2, protected: 1, unlinked: 0, ambiguous: 0, geometryExceptions: 1, largestFeatureBytes: 40, largestFeaturePositions: 4, countries: [{ countryId: 'country:aaa', units: 1 }, { countryId: 'country:bbb', units: 1 }], missingCountries: [], rows, limitations: [] };
  const manifest = { schemaVersion: 1, product: 'natural-earth-admin1-partitions-v1', source, parent: { manifestHash: hash('d'), source }, validation: { structural: 'passed-with-explicit-exceptions', topology: 'unverified' }, sourceUnits: 3, sourcePositions: 12, sourcePolygons: 3, linked: 2, protected: 1, unlinked: 0, ambiguous: 0, emittedUnits: 2, exceptionUnits: 1, inspection: { path: `reports/${hash('e')}.json`, sha256: hash('e'), bytes: 200 }, globalIndex: { path: `indexes/${hash('f')}.json`, sha256: hash('f'), bytes: 100 }, partitions: [], countries: [], limitations: [] };
  return { manifestHash: hash('f'), manifest, inspection, tooling } as Admin1TopologyBinding;
};
const workerReport = (): Admin1TopologyWorkerReport => ({
  schemaVersion: 1, validator: ADMIN1_TOPOLOGY_VALIDATOR, sourceSha256: source.sha256, sourceBytes: source.bytes, expectedUnits: 3,
  tooling: { duckdbVersion: '1.5.6', spatialVersion: '04270fe', spatialSha256: extension },
  rows: [
    { sourceOrdinal: 0, sourceKey: key(1), status: 'valid', valid: true, empty: false, reason: null },
    { sourceOrdinal: 1, sourceKey: key(2), status: 'protected', valid: null, empty: null, reason: 'protected-nigeria-no-topology' },
    { sourceOrdinal: 2, sourceKey: key(3), status: 'unsupported', valid: null, empty: null, reason: 'structural-geometry-unsupported' },
  ],
});

test('binds worker results to inspection identity and derives conserved report counts', () => {
  const b = binding(), worker = workerReport();
  assert.equal(validateAdmin1TopologyWorkerReport(worker, b).rows.length, 3);
  const result = bindAdmin1TopologyReport(worker, b);
  assert.deepEqual([result.checkedUnits, result.validUnits, result.invalidUnits, result.unsupportedUnits, result.protectedUnits], [1, 1, 0, 1, 1]);
  assert.equal(result.rows[0]?.id, 'admin1:natural-earth:NE_ID%3A1');
  assert.equal(result.rows[1]?.countryId, null);
  assert.deepEqual(result.limitations, [...ADMIN1_TOPOLOGY_SCOPE]);
  assert.deepEqual(validateAdmin1TopologyReport(result, b), result);
});

test('rejects a worker row with a forged property key or ordinal', () => {
  const b = binding(), value = workerReport(); value.rows[0]!.sourceKey = key(3);
  assert.throws(() => validateAdmin1TopologyWorkerReport(value, b), /lexical|exact inspection/);
  const other = workerReport(); other.rows[0]!.sourceOrdinal = 2;
  assert.throws(() => validateAdmin1TopologyWorkerReport(other, b), /exact inspection/);
});

test('rejects invalid predicate tuples, bogus protection and unreported structural geometry failures', () => {
  const b = binding(), invalid = workerReport(); invalid.rows[0]!.valid = false;
  assert.throws(() => validateAdmin1TopologyWorkerReport(invalid, b), /predicate tuple/);
  const unprotected = workerReport(); unprotected.rows[1]!.status = 'valid'; unprotected.rows[1]!.valid = true; unprotected.rows[1]!.empty = false; unprotected.rows[1]!.reason = null;
  assert.throws(() => validateAdmin1TopologyWorkerReport(unprotected, b), /protection status/);
  const submitted = workerReport(); submitted.rows[2]!.status = 'valid'; submitted.rows[2]!.valid = true; submitted.rows[2]!.empty = false; submitted.rows[2]!.reason = null;
  assert.throws(() => validateAdmin1TopologyWorkerReport(submitted, b), /structurally unsupported/);
});

test('rejects changed source pins, runtime pins and malformed bounded reasons', () => {
  const b = binding(), changed = workerReport(); changed.sourceSha256 = hash('9');
  assert.throws(() => validateAdmin1TopologyWorkerReport(changed, b), /source\/validator binding/);
  const wrongTool = workerReport(); wrongTool.tooling.spatialVersion = 'different' as '04270fe';
  assert.throws(() => validateAdmin1TopologyWorkerReport(wrongTool, b), /runtime pin mismatch/);
  const reason = workerReport(); reason.rows[2]!.reason = 'x'.repeat(257);
  assert.throws(() => validateAdmin1TopologyWorkerReport(reason, b), /reason is invalid/);
});

test('rejects incomplete, duplicate and unordered membership', () => {
  const b = binding(), short = workerReport(); short.rows.pop();
  assert.throws(() => validateAdmin1TopologyWorkerReport(short, b), /row count/);
  const duplicate = workerReport(); duplicate.rows[2]!.sourceOrdinal = 0;
  assert.throws(() => validateAdmin1TopologyWorkerReport(duplicate, b), /duplicated or not lexical/);
  const unordered = workerReport(); unordered.rows.reverse();
  assert.throws(() => validateAdmin1TopologyWorkerReport(unordered, b), /lexical source-key/);
});

test('report validation rejects forged audit identity, counters and scope wording', () => {
  const b = binding(), report = bindAdmin1TopologyReport(workerReport(), b);
  const identity = structuredClone(report); identity.rows[0]!.featureSha256 = hash('9');
  assert.throws(() => validateAdmin1TopologyReport(identity, b), /differs from bound inspection/);
  const counts = structuredClone(report); counts.validUnits = 0;
  assert.throws(() => validateAdmin1TopologyReport(counts, b), /counts do not conserve/);
  const scope = structuredClone(report); scope.limitations[0] = 'Everything is valid.';
  assert.throws(() => validateAdmin1TopologyReport(scope, b), /scope wording/);
});

test('binding rejects inconsistent source counts and invalid audit identities', () => {
  const b = binding(); b.manifest.sourceUnits = 10;
  assert.throws(() => validateAdmin1TopologyWorkerReport(workerReport(), b), /manifest and inspection binding/);
  const broken = binding(); broken.inspection.rows[1]!.adm0Code = 'GHA';
  assert.throws(() => validateAdmin1TopologyWorkerReport(workerReport(), broken), /protected inspection row/);
});

test('rejects inconsistent source IDs, unsafe NE_ID strings, and aggregate positions above cap', () => {
  const badId = binding(); badId.inspection.rows[0]!.id = 'admin1:natural-earth:NE_ID%3A999';
  assert.throws(() => validateAdmin1TopologyWorkerReport(workerReport(), badId), /identity\/hash/);
  const huge = binding(); huge.inspection.rows[0]!.sourceKey = 'NE_ID:9007199254740992'; huge.inspection.rows[0]!.id = `admin1:natural-earth:${encodeURIComponent(huge.inspection.rows[0]!.sourceKey)}`;
  assert.throws(() => validateAdmin1TopologyWorkerReport(workerReport(), huge), /identity\/hash/);
  const aggregate = binding(); for (const row of aggregate.inspection.rows) row.positions = 1_000_001;
  aggregate.inspection.sourcePositions = 3_000_003; aggregate.manifest.sourcePositions = 3_000_003;
  assert.throws(() => validateAdmin1TopologyWorkerReport(workerReport(), aggregate), /counts do not conserve/);
});

test('preserves protected Nigeria even when its structural audit records a geometry exception', () => {
  const b = binding(); b.inspection.rows[1]!.geometryIssue = 'position-outside-wgs84'; b.inspection.geometryExceptions = 2;
  assert.equal(validateAdmin1TopologyWorkerReport(workerReport(), b).rows[1]?.status, 'protected');
  const report = bindAdmin1TopologyReport(workerReport(), b);
  assert.equal(validateAdmin1TopologyReport(report, b).protectedUnits, 1);
});
