import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { bindConfiguredCapture, type CaptureBytePin } from './capture-binding.ts';
import {
  FEATURE_INDEX_CEILINGS, FEATURE_INDEX_STORAGE_CONTRACT,
  featureIndexObservationPin,
  type FeatureIndexCaptureInput, type FeatureIndexLimits, type FeatureIndexObservation,
} from './feature-index.ts';
import { identifySourceFeature } from './feature-identity.ts';
import { canonicalJson, sha256 } from './pack.ts';
import { parseCaptureJson } from './capture-json.ts';

export interface AuditCaptureInput extends FeatureIndexCaptureInput {
  requiredObservations: readonly FeatureIndexObservation[];
  /** Attempt pins are allowable SQL context, not a requirement that a row exists. */
  allowedObservationPins: readonly CaptureBytePin[];
}

export interface FeatureIndexAuditReport {
  format: 'feature-index-raw-audit-v1';
  scope: 'raw-feature-conservation-and-required-observations';
  qualifications: {
    rawIndexConservation: 'complete';
    requiredObservations: 'complete';
  };
  counts: {
    captures: number; rawFeatures: number; admitted: number; exceptions: number;
    occurrences: number; versions: number; keys: number; conflicts: number; crossOwnerConflictKeys: number;
    observations: number; requiredObservations: number;
  };
  dispositionsSha256: string;
}

const SHA = /^[a-f0-9]{64}$/;
const MAX_AUDIT_CAPTURES = 256;
const MAX_CONTEXTS_PER_CAPTURE = 8;
const MAX_CAPTURE_FEATURES = 50_000;
const MAX_OBSERVATION_BYTES = 4096;

function fail(message: string): never { throw new Error(`Feature index audit: ${message}`); }
function exactObject(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(`${label} must be a plain object.`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== keys.length || keys.some(key => {
    const descriptor = descriptors[key]; return !descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value');
  })) fail(`${label} fields are not exact data properties.`);
}
function boundedCount(value: unknown, maximum: number, label: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail(`${label} is outside its bound.`);
  return value;
}
function count(db: DatabaseSync, sql: string): number {
  const value = db.prepare(sql).get()?.n;
  if (typeof value !== 'number' && typeof value !== 'bigint') fail('SQLite returned a malformed count.');
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) fail('SQLite count is outside the safe integer range.');
  return result;
}
function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA.test(value)) fail(`${label} is not a lowercase SHA-256.`);
  return value;
}
function expectedRow(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object') fail(`${label} is absent.`);
  return value as Record<string, unknown>;
}
function checkPin(value: CaptureBytePin): CaptureBytePin {
  exactObject(value, ['sha256', 'bytes'], 'Observation pin');
  const digest = hash(value.sha256, 'Observation pin');
  const bytes = boundedCount(value.bytes, MAX_OBSERVATION_BYTES, 'Observation pin bytes', 1);
  return { sha256: digest, bytes };
}
function rowText(value: unknown, label: string): string {
  if (typeof value !== 'string') fail(`${label} is not text.`);
  return value;
}
function rowInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' && typeof value !== 'bigint') fail(`${label} is not an integer.`);
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) fail(`${label} is outside the safe integer range.`);
  return result;
}
function stableJson(value: unknown, label: string): string {
  const text = rowText(value, label);
  const parsed = parseCaptureJson(Buffer.from(text, 'utf8'), { bytes: MAX_OBSERVATION_BYTES, nodes: 128, depth: 12 });
  if (canonicalJson(parsed) !== text) fail(`${label} is not canonical JSON.`);
  return text;
}
function canonicalPin(data: string): CaptureBytePin { return { sha256: sha256(data), bytes: Buffer.byteLength(data) }; }

/**
 * Independently compare retained raw captures with a caller-owned, consistent
 * read-only SQLite snapshot. This kernel prepares SELECTs and read-only PRAGMAs
 * only; opening, leases, filesystem evidence, and worker supervision belong to
 * the caller. It never constructs FeatureIndex or performs ingestion.
 */
export function auditFeatureIndexConnection(
  db: DatabaseSync,
  limits: FeatureIndexLimits,
  inputs: Iterable<AuditCaptureInput>,
): FeatureIndexAuditReport {
  exactObject(limits, Object.keys(FEATURE_INDEX_CEILINGS), 'Index limits');
  const boundedLimits = {} as FeatureIndexLimits;
  for (const key of Object.keys(FEATURE_INDEX_CEILINGS) as Array<keyof FeatureIndexLimits>) {
    const min = key === 'databaseBytes' ? 65_536 : 1;
    boundedLimits[key] = boundedCount(limits[key], FEATURE_INDEX_CEILINGS[key], key, min);
  }

  // Input cardinality is capped before any SQL iteration. Keep only request
  // identities and small observation pin sets; feature ordinals are streamed.
  const pragma = (name: string): unknown => db.prepare(`PRAGMA ${name}`).get()?.[name];
  if (rowInteger(pragma('application_id'), 'application_id') !== FEATURE_INDEX_STORAGE_CONTRACT.applicationId
    || rowInteger(pragma('user_version'), 'user_version') !== FEATURE_INDEX_STORAGE_CONTRACT.userVersion) fail('SQLite application or schema version differs.');
  if (rowInteger(pragma('page_size'), 'page_size') !== 4096) fail('SQLite page size differs.');
  if (pragma('journal_mode') !== 'wal') fail('SQLite WAL mode differs; the copied WAL must remain visible.');
  const pageCount = rowInteger(pragma('page_count'), 'page_count');
  if (pageCount * 4096 > boundedLimits.databaseBytes) fail('SQLite database exceeds its configured byte limit.');

  const objects = db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name");
  const declared = FEATURE_INDEX_STORAGE_CONTRACT.schema;
  let schemaRows = 0;
  for (const row of objects.iterate()) {
    const name = rowText(row.name, 'Schema object name');
    const expectedType = name === 'versions_owner' || name === 'occurrences_version' ? 'index' : 'table';
    if (!Object.hasOwn(declared, name) || row.type !== expectedType || row.sql !== declared[name]) fail('SQLite schema contains an unexpected or altered object.');
    schemaRows++;
  }
  if (schemaRows !== Object.keys(declared).length) fail('SQLite schema is incomplete.');
  const metaCount = count(db, 'SELECT COUNT(*) AS n FROM meta');
  if (metaCount !== 3) fail('SQLite metadata row count differs.');
  const meta = new Map<string, string>();
  for (const row of db.prepare('SELECT key,value FROM meta ORDER BY key').iterate()) {
    meta.set(rowText(row.key, 'Metadata key'), rowText(row.value, 'Metadata value'));
  }
  if (meta.get('version') !== FEATURE_INDEX_STORAGE_CONTRACT.version
    || meta.get('identity') !== FEATURE_INDEX_STORAGE_CONTRACT.identityVersion
    || meta.get('schema') !== FEATURE_INDEX_STORAGE_CONTRACT.schemaHash) fail('SQLite metadata binding differs.');

  let integrityRows = 0;
  for (const row of db.prepare('PRAGMA integrity_check').iterate()) {
    if (row.integrity_check !== 'ok' || ++integrityRows > 1) fail('SQLite integrity check failed.');
  }
  if (integrityRows !== 1) fail('SQLite integrity check returned no result.');
  for (const _row of db.prepare('PRAGMA foreign_key_check').iterate()) fail('SQLite foreign-key check failed.');

  const actualCounts = {
    captures: count(db, 'SELECT COUNT(*) AS n FROM captures'),
    occurrences: count(db, 'SELECT COUNT(*) AS n FROM occurrences'),
    versions: count(db, 'SELECT COUNT(*) AS n FROM versions'),
    keys: count(db, 'SELECT COUNT(*) AS n FROM feature_keys'),
    conflicts: count(db, 'SELECT COUNT(*) AS n FROM conflicts'),
    observations: count(db, 'SELECT COUNT(*) AS n FROM observations'),
  };
  if (actualCounts.captures > Math.min(MAX_AUDIT_CAPTURES, boundedLimits.captures) || actualCounts.occurrences > boundedLimits.occurrences
    || actualCounts.versions > boundedLimits.versions || actualCounts.observations > boundedLimits.observations
    || actualCounts.keys > boundedLimits.versions || actualCounts.conflicts > actualCounts.keys) fail('SQLite row counts exceed configured limits.');
  const seenRequests = new Set<string>();
  const requestFeatureCounts = new Map<string, number>();
  const allowedPins = new Map<string, Set<string>>();
  const findCapture = db.prepare('SELECT capture_hash,metadata,rows,dispositions_hash,admitted,exceptions FROM captures WHERE request_hash=?');
  const findOccurrence = db.prepare('SELECT key,body,exception FROM occurrences WHERE request_hash=? AND ordinal=?');
  const findTuple = db.prepare('SELECT tuple FROM feature_keys WHERE key=?');
  const findVersion = db.prepare('SELECT owner,derived FROM versions WHERE key=? AND body=?');
  const hasSecondBody = db.prepare('SELECT 1 AS present FROM versions WHERE key=? ORDER BY body LIMIT 1 OFFSET 1');
  const findConflict = db.prepare('SELECT 1 AS present FROM conflicts WHERE key=?');
  const findSameCampaignJob = db.prepare('SELECT hash,request_hash,data FROM observations WHERE campaign_hash=? AND job_id=?');
  const firstOwner = db.prepare('SELECT owner FROM versions WHERE key=? ORDER BY body LIMIT 1');
  const hasOtherOwner = db.prepare('SELECT 1 AS present FROM versions WHERE key=? AND owner<>? LIMIT 1');
  const versionHasOccurrence = db.prepare('SELECT 1 AS present FROM occurrences WHERE key=? AND body=? LIMIT 1');
  const keyHasVersion = db.prepare('SELECT 1 AS present FROM versions WHERE key=? LIMIT 1');
  const keyHasOccurrence = db.prepare('SELECT 1 AS present FROM occurrences WHERE key=? LIMIT 1');
  const totalDigest = createHash('sha256');
  let rawFeatures = 0, admittedTotal = 0, exceptionTotal = 0, requiredObservationTotal = 0, previousRequest = '';

  // Process raw input in caller order. Do not retain extract/receipt bytes after
  // each capture; only bounded request identities, counts, and pin sets survive.
  for (const input of inputs) {
    if (seenRequests.size >= Math.min(MAX_AUDIT_CAPTURES, boundedLimits.captures)) fail('capture input count exceeds its admitted bound.');
    if (!input || typeof input !== 'object') fail('capture input is invalid.');
    exactObject(input, ['extractBytes', 'receiptBytes', 'expected', 'sourceConfiguration', 'requiredObservations', 'allowedObservationPins'], 'Capture input');
    const requestHash = hash(input.expected?.requestHash, 'Capture request hash');
    if (previousRequest && requestHash <= previousRequest) fail('capture inputs must be unique and lexicographically sorted by request hash.');
    previousRequest = requestHash; seenRequests.add(requestHash);
    if (!Array.isArray(input.requiredObservations) || input.requiredObservations.length > MAX_CONTEXTS_PER_CAPTURE
      || !Array.isArray(input.allowedObservationPins) || input.allowedObservationPins.length > MAX_CONTEXTS_PER_CAPTURE) {
      fail('per-capture observation contexts exceed the attempt bound.');
    }
    const allowed = new Set<string>();
    for (const pinValue of input.allowedObservationPins) {
      const pin = checkPin(pinValue); allowed.add(`${pin.sha256}:${pin.bytes}`);
    }
    const required = new Set<string>();
    for (const context of input.requiredObservations) {
      const pin = featureIndexObservationPin(context), data = canonicalJson(context);
      const key = `${pin.sha256}:${pin.bytes}:${data}`;
      if (required.has(key)) fail('required observation contexts contain a duplicate.');
      required.add(key);
      if (!allowed.has(`${pin.sha256}:${pin.bytes}`)) fail('required observation is not in the capture attempt pins.');
    }

    const capture = bindConfiguredCapture(input.extractBytes, input.receiptBytes, input.expected, input.sourceConfiguration);
    if (capture.requestHash !== requestHash || capture.features.length > MAX_CAPTURE_FEATURES) fail('Raw capture identity or feature count is invalid.');
    if (rawFeatures + capture.features.length > boundedLimits.occurrences) fail('Cumulative raw feature ordinals exceed the occurrence bound.');
    const metadata = canonicalJson({ ...capture, features: capture.features.length });
    const row = expectedRow(findCapture.get(requestHash), 'Capture row');
    if (row.capture_hash !== capture.captureHash || row.metadata !== metadata || row.rows !== capture.features.length) fail('Capture row metadata differs from its pinned raw capture.');

    const digest = createHash('sha256');
    const exceptions: Record<string, number> = {};
    let admitted = 0;
    for (let ordinal = 0; ordinal < capture.features.length; ordinal++) {
      const identity = identifySourceFeature(capture.features[ordinal], capture.binding);
      let key: string | null = null, body: string | null = null, exception: string | null = null;
      if (identity.status === 'admitted') {
        admitted++; key = identity.featureKeyHash; body = identity.bodyHash;
        const tuple = canonicalJson(identity.tuple);
        const tupleRow = expectedRow(findTuple.get(key), 'Feature key row');
        if (tupleRow.tuple !== tuple || sha256(tuple) !== key) fail('Raw identity tuple differs from the indexed key.');
        const derived = canonicalJson({ bodyBytes: identity.bodyBytes, ownerAnchor: identity.ownerAnchor, positions: identity.positions });
        const version = expectedRow(findVersion.get(key, body), 'Feature version row');
        if (version.owner !== identity.ownerCellId || version.derived !== derived) fail('Raw identity body, owner, or derived metadata differs from its indexed version.');
        const multipleBodies = hasSecondBody.get(key) !== undefined;
        const hasConflict = findConflict.get(key) !== undefined;
        if (hasConflict !== multipleBodies) fail('Conflict marker differs from retained body versions.');
      } else {
        exception = identity.code; exceptions[exception] = (exceptions[exception] ?? 0) + 1;
      }
      const disposition = canonicalJson({ ordinal, key, body, exception });
      digest.update(`${disposition}\n`); totalDigest.update(`${requestHash}:${disposition}\n`);
      const occurrence = expectedRow(findOccurrence.get(requestHash, ordinal), 'Occurrence row');
      if (occurrence.key !== key || occurrence.body !== body || occurrence.exception !== exception) fail('Raw ordinal differs from its indexed occurrence.');
    }
    const dispositionsHash = digest.digest('hex');
    if (row.dispositions_hash !== dispositionsHash || row.admitted !== admitted
      || row.exceptions !== canonicalJson(exceptions)) fail('Capture disposition summary differs from independently reconstructed raw features.');
    rawFeatures += capture.features.length; admittedTotal += admitted; exceptionTotal += capture.features.length - admitted;
    requestFeatureCounts.set(requestHash, capture.features.length);
    allowedPins.set(requestHash, allowed);
    requiredObservationTotal += input.requiredObservations.length;
    for (const context of input.requiredObservations) {
      const data = canonicalJson(context), pin = canonicalPin(data);
      const observation = expectedRow(db.prepare('SELECT hash,campaign_hash,job_id,request_hash,data FROM observations WHERE hash=?').get(pin.sha256), 'Required observation');
      if (observation.hash !== pin.sha256 || observation.request_hash !== requestHash || observation.data !== data
        || observation.campaign_hash !== context.campaignHash || observation.job_id !== context.jobId) fail('Required completed-campaign observation is missing or differs.');
      const collision = findSameCampaignJob.get(context.campaignHash, context.jobId);
      if (!collision || collision.hash !== pin.sha256 || collision.request_hash !== requestHash || collision.data !== data) fail('Required campaign job is associated with another capture.');
    }
  }
  if (actualCounts.captures !== seenRequests.size) fail('SQLite capture membership differs from the complete raw input set.');

  // Reverse scans prove there are no extra captures/ordinals or orphaned SQL
  // rows, without retaining feature-index-sized maps.
  let reverseCaptures = 0;
  for (const row of db.prepare('SELECT request_hash FROM captures ORDER BY request_hash').iterate()) {
    const requestHash = rowText(row.request_hash, 'Indexed capture request hash');
    if (!seenRequests.has(requestHash)) fail('SQLite contains an extra capture row.');
    reverseCaptures++;
  }
  if (reverseCaptures !== seenRequests.size) fail('SQLite capture reverse scan is incomplete.');
  let reverseOccurrences = 0;
  for (const row of db.prepare(`SELECT o.request_hash,o.ordinal,o.key,o.body,o.exception
    FROM occurrences o ORDER BY o.request_hash,o.ordinal`).iterate()) {
    const requestHash = rowText(row.request_hash, 'Occurrence request hash');
    const featureCount = requestFeatureCounts.get(requestHash);
    if (featureCount === undefined || rowInteger(row.ordinal, 'Occurrence ordinal') >= featureCount) fail('SQLite contains an extra or unowned occurrence row.');
    reverseOccurrences++;
  }
  if (reverseOccurrences !== rawFeatures) fail('SQLite occurrence reverse scan differs from raw ordinal totals.');

  // Every SQL version/key must be justified by a raw occurrence. The forward
  // comparisons above verify exact owner/derived/tuple data for every ordinal;
  // these indexed existence probes reject orphan and extra relational rows.
  for (const row of db.prepare('SELECT key,body FROM versions ORDER BY key,body').iterate()) {
    const key = hash(row.key, 'Indexed version key'), body = hash(row.body, 'Indexed version body');
    if (versionHasOccurrence.get(key, body) === undefined) fail('SQLite contains an unreferenced feature version.');
  }
  for (const row of db.prepare('SELECT key,tuple FROM feature_keys ORDER BY key').iterate()) {
    const key = hash(row.key, 'Indexed feature key'), tuple = stableJson(row.tuple, 'Indexed feature tuple');
    if (sha256(tuple) !== key || keyHasVersion.get(key) === undefined || keyHasOccurrence.get(key) === undefined) fail('SQLite contains an extra or orphaned feature key.');
  }
  let crossOwnerConflictKeys = 0;
  for (const row of db.prepare('SELECT key FROM conflicts ORDER BY key').iterate()) {
    const key = hash(row.key, 'Conflict key');
    if (hasSecondBody.get(key) === undefined
      || keyHasOccurrence.get(key) === undefined) fail('SQLite contains an extra or invalid conflict marker.');
    const owner = rowText(firstOwner.get(key)?.owner, 'Conflict version owner');
    if (hasOtherOwner.get(key, owner) !== undefined) crossOwnerConflictKeys++;
  }

  let sqlObservations = 0;
  for (const row of db.prepare('SELECT hash,campaign_hash,job_id,request_hash,data FROM observations ORDER BY hash').iterate()) {
    const requestHash = rowText(row.request_hash, 'Observation request hash');
    const allowed = allowedPins.get(requestHash);
    if (!allowed) fail('SQLite contains an observation for an unknown raw capture.');
    const data = stableJson(row.data, 'Observation data');
    const parsed = parseCaptureJson(Buffer.from(data, 'utf8'), { bytes: MAX_OBSERVATION_BYTES, nodes: 128, depth: 12 }) as FeatureIndexObservation;
    const pin = featureIndexObservationPin(parsed);
    if (pin.sha256 !== row.hash || !allowed.has(`${pin.sha256}:${pin.bytes}`)) fail('SQL observation is not authorized by an attempt pin for its capture.');
    if (parsed.campaignHash !== row.campaign_hash || parsed.jobId !== row.job_id) fail('SQL observation columns contradict canonical context data.');
    sqlObservations++;
  }
  if (sqlObservations !== actualCounts.observations) fail('SQLite observation reverse scan is incomplete.');

  // Required set inclusion was checked by exact indexed lookup above. Historical
  // allowed pins deliberately need not have a corresponding SQL row.
  return {
    format: 'feature-index-raw-audit-v1',
    scope: 'raw-feature-conservation-and-required-observations',
    qualifications: { rawIndexConservation: 'complete', requiredObservations: 'complete' },
    counts: {
      captures: actualCounts.captures, rawFeatures, admitted: admittedTotal, exceptions: exceptionTotal,
      occurrences: actualCounts.occurrences, versions: actualCounts.versions, keys: actualCounts.keys,
      conflicts: actualCounts.conflicts, crossOwnerConflictKeys,
      observations: actualCounts.observations, requiredObservations: requiredObservationTotal,
    },
    dispositionsSha256: totalDigest.digest('hex'),
  };
}
