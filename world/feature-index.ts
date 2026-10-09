import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { bindConfiguredCapture, type CaptureExpectation, type CaptureBytePin } from './capture-binding.ts';
import { FEATURE_IDENTITY_VERSION, identifySourceFeature, type FeatureIdentityResult } from './feature-identity.ts';
import { canonicalJson, sha256 } from './pack.ts';
import { parseCaptureJson } from './capture-json.ts';
import { geographicGridCell, geographicGridOwner } from './country-grid.ts';

export const FEATURE_INDEX_VERSION = 'complete-feature-index-v1';
const APPLICATION_ID = 0x57464931;
const SHA = /^[a-f0-9]{64}$/;
/** Candidate engine ceilings. File/WAL/aggregate/process supervision is a separate mandatory opener gate. */
export const FEATURE_INDEX_CEILINGS = Object.freeze({
  databaseBytes: 64 * 1024 * 1024, captures: 4096, occurrences: 250_000,
  versions: 100_000, observations: 16_384,
});
export interface FeatureIndexLimits {
  databaseBytes: number; captures: number; occurrences: number; versions: number; observations: number;
}
export interface FeatureIndexCaptureInput {
  extractBytes: Uint8Array; receiptBytes: Uint8Array; expected: CaptureExpectation;
  sourceConfiguration: { bytes: Uint8Array; pin: CaptureBytePin };
}
/** The campaign validates this context against its frozen plan before calling the engine. */
export interface FeatureIndexObservation {
  campaignHash: string; planHash: string; jobId: string; rootCellId: string; queryPath: string;
}
export interface FeatureIndexCaptureResult {
  indexVersion: typeof FEATURE_INDEX_VERSION; requestHash: string; captureHash: string;
  features: number; admitted: number; exceptions: Record<string, number>; dispositionsHash: string;
  replayed: boolean; insertedVersions: number; observationHash: string | null;
}
export interface FeatureIndexStats {
  captures: number; occurrences: number; versions: number; observations: number;
  keys: number; conflictedKeys: number;
}
type Admitted = Extract<FeatureIdentityResult, { status: 'admitted' }>;
export interface IndexedFeatureVersion { identity: Admitted; conflicted: boolean }
type CaptureRow = { capture_hash: string; metadata: string; rows: number; dispositions_hash: string; admitted: number; exceptions: string };

const DEFINITIONS: Record<string, string> = {
  meta: 'CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL CHECK(length(value)<=4096))',
  captures: `CREATE TABLE captures(request_hash TEXT PRIMARY KEY CHECK(length(request_hash)=64),
    capture_hash TEXT NOT NULL UNIQUE CHECK(length(capture_hash)=64),
    metadata TEXT NOT NULL CHECK(length(metadata)<=4096), rows INTEGER NOT NULL CHECK(rows BETWEEN 0 AND 50000),
    dispositions_hash TEXT NOT NULL CHECK(length(dispositions_hash)=64),
    admitted INTEGER NOT NULL CHECK(admitted BETWEEN 0 AND rows), exceptions TEXT NOT NULL CHECK(length(exceptions)<=1024))`,
  feature_keys: `CREATE TABLE feature_keys(key TEXT PRIMARY KEY CHECK(length(key)=64),
    tuple TEXT NOT NULL UNIQUE CHECK(length(tuple)<=4096)) WITHOUT ROWID`,
  versions: `CREATE TABLE versions(key TEXT NOT NULL REFERENCES feature_keys(key), body TEXT NOT NULL CHECK(length(body)=64),
    owner TEXT NOT NULL CHECK(length(owner)<=64), derived TEXT NOT NULL CHECK(length(derived)<=256), PRIMARY KEY(key,body)) WITHOUT ROWID`,
  conflicts: 'CREATE TABLE conflicts(key TEXT PRIMARY KEY REFERENCES feature_keys(key)) WITHOUT ROWID',
  occurrences: `CREATE TABLE occurrences(request_hash TEXT NOT NULL REFERENCES captures(request_hash),
    ordinal INTEGER NOT NULL CHECK(typeof(ordinal)='integer' AND ordinal BETWEEN 0 AND 49999), key TEXT, body TEXT, exception TEXT,
    PRIMARY KEY(request_hash,ordinal), FOREIGN KEY(key,body) REFERENCES versions(key,body),
    CHECK((key IS NOT NULL AND body IS NOT NULL AND exception IS NULL)
      OR (key IS NULL AND body IS NULL AND exception IS NOT NULL AND length(exception)<=64))) WITHOUT ROWID`,
  observations: `CREATE TABLE observations(hash TEXT PRIMARY KEY CHECK(length(hash)=64),
    campaign_hash TEXT NOT NULL CHECK(length(campaign_hash)=64), job_id TEXT NOT NULL CHECK(length(job_id)<=512),
    request_hash TEXT NOT NULL REFERENCES captures(request_hash), data TEXT NOT NULL CHECK(length(data)<=4096),
    UNIQUE(campaign_hash,job_id))`,
  versions_owner: 'CREATE INDEX versions_owner ON versions(owner,key,body)',
  occurrences_version: 'CREATE INDEX occurrences_version ON occurrences(key,body,request_hash,ordinal)',
};
const SCHEMA_HASH = sha256(canonicalJson(DEFINITIONS));

function integer(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`${label} exceeds its index bound.`);
  return value;
}
function boundedJson(value: unknown): string {
  const text = canonicalJson(value);
  if (Buffer.byteLength(text) > 4096) throw new RangeError('Compact index metadata exceeds 4096 bytes.');
  return text;
}
function versionMetadata(identity: Admitted): string {
  // Tuple/key/body/owner are already retained in dedicated columns. Keep only
  // the remaining source-derived fields here; reconstruct the public identity.
  const value = boundedJson({ bodyBytes: identity.bodyBytes, ownerAnchor: identity.ownerAnchor, positions: identity.positions });
  if (Buffer.byteLength(value) > 256) throw new RangeError('Compact version metadata exceeds 256 bytes.');
  return value;
}
function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA.test(value)) throw new TypeError(`${label} requires an exact SHA-256.`);
  return value;
}
function owner(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Global owner must be a geographic l1 cell.');
  const match = /^geo-grid-v1:l1:x(0|[1-9][0-9]{0,2}):y(0|[1-9][0-9]{0,2})$/.exec(value);
  if (!match || Number(match[1]) > 719 || Number(match[2]) > 359) throw new TypeError('Global owner must be a geographic l1 cell.');
  return value;
}
function observationData(value: FeatureIndexObservation): string {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError('Observation requires a plain context.');
  const keys = ['campaignHash', 'planHash', 'jobId', 'rootCellId', 'queryPath'];
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== keys.length || keys.some(key => !descriptors[key] || !Object.hasOwn(descriptors[key]!, 'value') || !descriptors[key]!.enumerable)) {
    throw new TypeError('Observation has unsupported context fields/accessors.');
  }
  hash(value.campaignHash, 'Campaign'); hash(value.planHash, 'Plan');
  const root = typeof value.rootCellId === 'string' && /^geo-grid-v1:l(0|[1-9]|1[0-6]):x(0|[1-9][0-9]{0,7}):y(0|[1-9][0-9]{0,7})$/.exec(value.rootCellId);
  if (!root || geographicGridCell(Number(root[1]), Number(root[2]), Number(root[3])).id !== value.rootCellId) throw new TypeError('Observation root is not a canonical query grid cell.');
  if (typeof value.jobId !== 'string' || !value.jobId.trim() || value.jobId.length > 512 || /[\u0000-\u001f\u007f]/.test(value.jobId)) throw new TypeError('Observation job ID must be bounded text.');
  for (let i = 0; i < value.jobId.length; i++) {
    const code = value.jobId.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.jobId.charCodeAt(++i);
      if (!(low >= 0xdc00 && low <= 0xdfff)) throw new TypeError('Observation job ID contains an unpaired surrogate.');
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new TypeError('Observation job ID contains an unpaired surrogate.');
  }
  if (typeof value.queryPath !== 'string' || !/^[0-3]{0,8}$/.test(value.queryPath)) throw new TypeError('Observation query path is invalid.');
  return boundedJson(value);
}

/** Validate compact context before an opener can run SQL. Membership in the
 * frozen campaign/plan remains the scheduler's responsibility. */
export function featureIndexObservationPin(value: FeatureIndexObservation): CaptureBytePin {
  const data = observationData(value);
  return { sha256: sha256(data), bytes: Buffer.byteLength(data) };
}

/**
 * Transaction engine for a caller-owned, supervised, builder-only SQLite connection.
 * No filesystem/network/ledger/game access. Opening/locking and hard WAL/file/aggregate
 * admission must be supplied by the later worker adapter; this engine alone is not
 * a production resource guarantee. It owns neither the connection nor its close.
 */
export class FeatureIndex {
  #db: DatabaseSync;
  #limits: FeatureIndexLimits;
  #failed = false;
  constructor(database: DatabaseSync, limits: FeatureIndexLimits) {
    if (!(database instanceof DatabaseSync)) throw new TypeError('Index requires its dedicated SQLite connection.');
    if (!limits || Object.getPrototypeOf(limits) !== Object.prototype
      || Reflect.ownKeys(limits).length !== Object.keys(FEATURE_INDEX_CEILINGS).length
      || Object.keys(limits).sort().join(',') !== Object.keys(FEATURE_INDEX_CEILINGS).sort().join(',')) throw new TypeError('Index limits require every explicit bound.');
    const descriptors = Object.getOwnPropertyDescriptors(limits);
    for (const key of Object.keys(FEATURE_INDEX_CEILINGS) as Array<keyof FeatureIndexLimits>) {
      if (!Object.hasOwn(descriptors[key]!, 'value')) throw new TypeError('Index limits cannot use accessors.');
      integer(limits[key], key === 'databaseBytes' ? 65536 : 1, FEATURE_INDEX_CEILINGS[key], key);
    }
    this.#db = database; this.#limits = { ...limits };
    const app = database.prepare('PRAGMA application_id').get()!.application_id;
    const version = database.prepare('PRAGMA user_version').get()!.user_version;
    const objects = Number(database.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'").get()!.n);
    // Refuse unrelated databases before changing their journal/settings/schema.
    if (objects ? app !== APPLICATION_ID : app !== 0 || version !== 0) throw new Error('SQLite connection is not an empty or recognized feature index.');
    if (objects) this.#verifySchema();
    const pageSize = Number(database.prepare('PRAGMA page_size').get()!.page_size);
    if (pageSize !== 4096) throw new Error('Feature index requires its fixed 4096-byte page size.');
    const maximum = Math.floor(limits.databaseBytes / pageSize);
    if (database.prepare(`PRAGMA max_page_count=${maximum}`).get()!.max_page_count !== maximum) throw new RangeError('Existing feature index exceeds its database quota.');
    if (database.prepare('PRAGMA journal_mode=WAL').get()!.journal_mode !== 'wal') throw new Error('Feature index requires actual file-backed WAL.');
    database.exec('PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=250; PRAGMA temp_store=MEMORY; PRAGMA cache_size=-1024; PRAGMA wal_autocheckpoint=0; PRAGMA journal_size_limit=0;');
    if (database.prepare('PRAGMA synchronous').get()!.synchronous !== 2 || database.prepare('PRAGMA foreign_keys').get()!.foreign_keys !== 1) throw new Error('Required index durability/foreign keys were not applied.');
    if (!objects) {
      database.exec('BEGIN IMMEDIATE');
      try {
        for (const sql of Object.values(DEFINITIONS)) database.exec(sql);
        const insert = database.prepare('INSERT INTO meta VALUES(?,?)');
        insert.run('version', FEATURE_INDEX_VERSION); insert.run('identity', FEATURE_IDENTITY_VERSION); insert.run('schema', SCHEMA_HASH);
        database.exec(`PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=1; COMMIT;`);
      } catch (error) { this.#rollback(); throw error; }
    }
    this.#verifySchema(); this.#checkpoint(); this.#assertCounts(this.stats());
  }
  #verifySchema(): void {
    const db = this.#db;
    if (db.prepare('PRAGMA user_version').get()!.user_version !== 1) throw new Error('Unsupported feature index schema version.');
    const count = Number(db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'").get()!.n);
    if (count !== Object.keys(DEFINITIONS).length) throw new Error('Feature index contains missing or unexpected schema objects.');
    if (Number(db.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' AND length(sql)>10000").get()!.n)) throw new Error('Feature index schema SQL exceeds its bound.');
    for (const row of db.prepare("SELECT name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'").all()) {
      if (typeof row.name !== 'string' || !Object.hasOwn(DEFINITIONS, row.name) || row.sql !== DEFINITIONS[row.name]) throw new Error('Feature index schema differs from its exact contract.');
    }
    if (Number(db.prepare('SELECT COUNT(*) n FROM meta').get()!.n) !== 3) throw new Error('Feature index metadata differs from its exact contract.');
    for (const [key, value] of [['version', FEATURE_INDEX_VERSION], ['identity', FEATURE_IDENTITY_VERSION], ['schema', SCHEMA_HASH]] as const) {
      if (db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value !== value) throw new Error('Feature index format/identity binding differs.');
    }
  }
  #rollback(): void {
    try { this.#db.exec('ROLLBACK'); } catch { /* SQLITE_FULL/IOERR may already have rolled back; original error remains fatal. */ }
  }
  #checkpoint(): void {
    const row = this.#db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()!;
    if (row.busy !== 0 || row.log !== 0 || row.checkpointed !== 0) throw new Error('Feature index checkpoint did not complete; preserve database and WAL together.');
  }
  #assertCounts(stats: FeatureIndexStats): void {
    for (const key of ['captures', 'occurrences', 'versions', 'observations'] as const) integer(stats[key], 0, this.#limits[key], key);
  }
  stats(): FeatureIndexStats {
    const count = (table: string) => Number(this.#db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n);
    return { captures: count('captures'), occurrences: count('occurrences'), versions: count('versions'),
      observations: count('observations'), keys: count('feature_keys'), conflictedKeys: count('conflicts') };
  }
  ingest(input: FeatureIndexCaptureInput, context?: FeatureIndexObservation): FeatureIndexCaptureResult {
    if (this.#failed) throw new Error('Failed index writer must be reopened before another transaction.');
    const capture = bindConfiguredCapture(input.extractBytes, input.receiptBytes, input.expected, input.sourceConfiguration);
    const metadata = boundedJson({ ...capture, features: capture.features.length });
    const contextData = context === undefined ? null : observationData(context);
    const observationHash = contextData === null ? null : sha256(contextData);
    this.#checkpoint();
    this.#db.exec('BEGIN IMMEDIATE');
    let result: FeatureIndexCaptureResult;
    try {
      const counts = this.stats(); this.#assertCounts(counts);
      const old = this.#db.prepare('SELECT * FROM captures WHERE request_hash=?').get(capture.requestHash) as CaptureRow | undefined;
      if (old && (old.capture_hash !== capture.captureHash || old.metadata !== metadata || old.rows !== capture.features.length)) throw new Error('Existing request has altered capture/configuration pins.');
      const replayed = Boolean(old);
      if (!old) {
        integer(counts.captures + 1, 0, this.#limits.captures, 'captures');
        integer(counts.occurrences + capture.features.length, 0, this.#limits.occurrences, 'occurrences');
        this.#db.prepare('INSERT INTO captures VALUES(?,?,?,?,?,?,?)').run(capture.requestHash, capture.captureHash, metadata,
          capture.features.length, '0'.repeat(64), 0, '{}');
      }
      const digest = createHash('sha256');
      const exceptions: Record<string, number> = {};
      let admitted = 0, insertedVersions = 0;
      const occurrence = this.#db.prepare('INSERT INTO occurrences VALUES(?,?,?,?,?)');
      // Prepare once per capture, rather than compiling SQL for every ordinal.
      const findKey = this.#db.prepare('SELECT tuple FROM feature_keys WHERE key=?');
      const findBodies = this.#db.prepare('SELECT body FROM versions WHERE key=? ORDER BY body LIMIT 2');
      const findConflict = this.#db.prepare('SELECT 1 FROM conflicts WHERE key=?');
      const insertKey = this.#db.prepare('INSERT INTO feature_keys VALUES(?,?)');
      const findVersion = this.#db.prepare('SELECT owner,derived FROM versions WHERE key=? AND body=?');
      const insertVersion = this.#db.prepare('INSERT INTO versions VALUES(?,?,?,?)');
      const insertConflict = this.#db.prepare('INSERT OR IGNORE INTO conflicts VALUES(?)');
      const findOccurrence = this.#db.prepare('SELECT key,body,exception FROM occurrences WHERE request_hash=? AND ordinal=?');
      for (const [ordinal, feature] of capture.features.entries()) {
        const identity = identifySourceFeature(feature, capture.binding);
        let key: string | null = null, body: string | null = null, exception: string | null = null;
        if (identity.status === 'admitted') {
          admitted++; key = identity.featureKeyHash; body = identity.bodyHash;
          const tuple = boundedJson(identity.tuple), derived = versionMetadata(identity);
          const keyRow = findKey.get(key);
          if (keyRow ? keyRow.tuple !== tuple : old !== undefined) throw new Error('Indexed source key is absent or contradicts its exact tuple.');
          const existingBodies = findBodies.all(key);
          const markedConflict = Boolean(findConflict.get(key));
          if (Boolean(keyRow) !== Boolean(existingBodies.length)) throw new Error('Indexed source key/version membership is contradictory.');
          // Check before insertion: a new body must never repair a damaged marker.
          if (markedConflict !== (existingBodies.length > 1)) throw new Error('Indexed source-key conflict marker is contradictory.');
          if (!keyRow) insertKey.run(key, tuple);
          const version = findVersion.get(key, body);
          if (version ? version.derived !== derived || version.owner !== identity.ownerCellId : old !== undefined) throw new Error('Indexed complete-body version is absent or contradictory.');
          if (!version) {
            integer(counts.versions + insertedVersions + 1, 0, this.#limits.versions, 'versions');
            insertVersion.run(key, body, identity.ownerCellId, derived);
            insertedVersions++;
            if (existingBodies.length) insertConflict.run(key);
          }
        } else {
          exception = identity.code; exceptions[exception] = (exceptions[exception] ?? 0) + 1;
        }
        digest.update(canonicalJson({ ordinal, key, body, exception }) + '\n');
        if (old) {
          const row = findOccurrence.get(capture.requestHash, ordinal);
          if (!row || row.key !== key || row.body !== body || row.exception !== exception) throw new Error('Replay ordinal disposition is missing or contradictory.');
        } else occurrence.run(capture.requestHash, ordinal, key, body, exception);
      }
      const dispositionsHash = digest.digest('hex');
      const observed = this.#db.prepare('SELECT COUNT(*) n,MIN(ordinal) first,MAX(ordinal) last FROM occurrences WHERE request_hash=?').get(capture.requestHash)!;
      if (observed.n !== capture.features.length || observed.first !== (capture.features.length ? 0 : null)
        || observed.last !== (capture.features.length ? capture.features.length - 1 : null)
        || admitted + Object.values(exceptions).reduce((a, b) => a + b, 0) !== capture.features.length) throw new Error('Capture ordinal conservation failed.');
      const exceptionData = canonicalJson(exceptions);
      if (old) {
        if (old.dispositions_hash !== dispositionsHash || old.admitted !== admitted || old.exceptions !== exceptionData) throw new Error('Replay capture summary is contradictory.');
      } else this.#db.prepare('UPDATE captures SET dispositions_hash=?,admitted=?,exceptions=? WHERE request_hash=?')
        .run(dispositionsHash, admitted, exceptionData, capture.requestHash);
      if (context && contextData !== null && observationHash !== null) {
        const previous = this.#db.prepare('SELECT hash,request_hash,data FROM observations WHERE campaign_hash=? AND job_id=?').get(context.campaignHash, context.jobId);
        if (previous) {
          if (previous.hash !== observationHash || previous.request_hash !== capture.requestHash || previous.data !== contextData) throw new Error('Campaign job observation already binds a different plan/query/capture.');
        } else {
          integer(counts.observations + 1, 0, this.#limits.observations, 'observations');
          this.#db.prepare('INSERT INTO observations VALUES(?,?,?,?,?)').run(observationHash, context.campaignHash, context.jobId, capture.requestHash, contextData);
        }
      }
      this.#db.exec('COMMIT');
      result = { indexVersion: FEATURE_INDEX_VERSION, requestHash: capture.requestHash, captureHash: capture.captureHash,
        features: capture.features.length, admitted, exceptions, dispositionsHash, replayed, insertedVersions, observationHash };
    } catch (error) { this.#rollback(); this.#failed = true; throw error; }
    // A failed post-commit checkpoint leaves the capture committed but the caller's
    // ledger pending. Reopen + verify the exact raw replay before completing a job.
    try { this.#checkpoint(); } catch (error) { this.#failed = true; throw error; }
    return result;
  }
  ownerVersions(cellId: string, options: { limit: number; after?: { key: string; body: string } }): IndexedFeatureVersion[] {
    owner(cellId); integer(options.limit, 1, 256, 'page limit');
    const key = options.after ? hash(options.after.key, 'Cursor key') : '';
    const body = options.after ? hash(options.after.body, 'Cursor body') : '';
    const rows = this.#db.prepare(`SELECT v.key,v.body,v.owner,v.derived,f.tuple,
      EXISTS(SELECT 1 FROM conflicts c WHERE c.key=v.key) AS conflict,
      EXISTS(SELECT 1 FROM versions other WHERE other.key=v.key AND other.body<>v.body) AS multiple
      FROM versions v LEFT JOIN feature_keys f ON f.key=v.key
      WHERE v.owner=? AND (v.key,v.body)>(?,?) ORDER BY v.key,v.body LIMIT ?`).all(cellId, key, body, options.limit);
    return rows.map(row => {
      if (row.conflict !== row.multiple) throw new Error('Indexed source-key conflict marker is contradictory.');
      if (typeof row.derived !== 'string' || typeof row.tuple !== 'string') throw new Error('Indexed version metadata is invalid.');
      const parsed = parseCaptureJson(Buffer.from(row.derived), { bytes: 256, nodes: 16, depth: 4 });
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Indexed version metadata is invalid.');
      const metadata = parsed as Record<string, unknown>;
      const tuple = parseCaptureJson(Buffer.from(row.tuple), { bytes: 4096, nodes: 16, depth: 4 }) as Admitted['tuple'];
      const fields = ['bodyBytes', 'ownerAnchor', 'positions'];
      if (Object.keys(parsed).length !== fields.length || fields.some(field => !Object.hasOwn(parsed, field))
        || !tuple || typeof tuple !== 'object' || Array.isArray(tuple) || Object.keys(tuple).sort().join(',') !== 'provider,release,sourceFeatureId,sourceLayer'
        || tuple.provider !== 'overture' || typeof tuple.release !== 'string' || !/^\d{4}-\d{2}-\d{2}\.\d{1,3}$/.test(tuple.release)
        || !['buildings', 'transportation'].includes(tuple.sourceLayer) || typeof tuple.sourceFeatureId !== 'string'
        || !tuple.sourceFeatureId || tuple.sourceFeatureId.length > 256 || /[\s\u0000-\u001f\u007f]/.test(tuple.sourceFeatureId)
        || sha256(boundedJson(tuple)) !== row.key
        || boundedJson(tuple) !== row.tuple
        || boundedJson(parsed) !== row.derived || geographicGridOwner(metadata.ownerAnchor as Admitted['ownerAnchor'], 1).id !== row.owner) {
        throw new Error('Indexed version metadata contradicts its key/body/owner binding.');
      }
      const identity: Admitted = { status: 'admitted', identityVersion: FEATURE_IDENTITY_VERSION, tuple,
        featureKeyHash: hash(row.key, 'Feature key'), bodyHash: hash(row.body, 'Complete body'), ownerCellId: owner(row.owner),
        ownerAnchor: metadata.ownerAnchor as Admitted['ownerAnchor'],
        bodyBytes: integer(metadata.bodyBytes, 1, 20_000_000, 'Complete body bytes'),
        positions: integer(metadata.positions, 2, 200_000, 'Source positions') };
      return { identity, conflicted: row.conflict === 1 };
    });
  }
  sourceReference(keyValue: string, bodyValue: string): { requestHash: string; ordinal: number; captureMetadata: string } | null {
    const key = hash(keyValue, 'Feature key'), body = hash(bodyValue, 'Complete body');
    const row = this.#db.prepare(`SELECT o.request_hash,o.ordinal,c.metadata FROM occurrences o
      JOIN captures c ON c.request_hash=o.request_hash WHERE o.key=? AND o.body=? ORDER BY o.request_hash,o.ordinal LIMIT 1`).get(key, body);
    if (!row) return null;
    return { requestHash: String(row.request_hash), ordinal: Number(row.ordinal), captureMetadata: String(row.metadata) };
  }
}
