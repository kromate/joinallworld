import type { EnqueueInput } from './ledger.ts';
import { canonicalJson, sha256 } from './pack.ts';
import { assertValidatedFeatureIndexAuditProof, featureIndexAuditWorkerDigest,
  type FeatureIndexSessionAuditProof } from './feature-index-session.ts';

export const CAMPAIGN_INDEX_AUDIT_KIND = 'campaign-index-audit';
export const CAMPAIGN_INDEX_AUDIT_JOB_FORMAT = 'campaign-index-audit-job-v1';
export const CAMPAIGN_INDEX_AUDIT_COMPLETION_FORMAT = 'campaign-index-audit-completion-v1';
export const FEATURE_INDEX_AUDIT_FORMAT = 'feature-index-raw-audit-v1';
const SHA = /^[a-f0-9]{64}$/;
const MAX_REPORT_BYTES = 128_000;
const MAX_RECORD_BYTES = 16_000;
const MAX_NODES = 100_000;
const MAX_DEPTH = 48;

export interface CampaignIndexAuditFrozenInput {
  campaignId: string;
  campaignHash: string;
  inventoryHash: string;
  planHash: string;
  indexHash: string;
  configurationHash: string;
  captureControllerRecord: { sha256: string; bytes: number };
  completeCaptureSetSha256: string;
  requiredObservationSetSha256: string;
  auditInputSha256: string;
  auditFormat: typeof FEATURE_INDEX_AUDIT_FORMAT;
}

export type AuditQualification = 'complete' | 'incomplete' | 'failed';
export interface CampaignIndexAuditCompletionOptions {
  /** Hash independently reconstructed from canonical contexts in fenced completed campaign-index rows. */
  knownCanonicalObservationSetSha256?: string;
}

function chargeString(value: string, label: string, budget: { bytes: number }): void {
  const charge = (bytes: number) => {
    budget.bytes -= bytes;
    if (budget.bytes < 0) throw new RangeError(`${label} exceeds its bounded byte limit.`);
  };
  charge(2); // JSON quotes
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 0x22 || code === 0x5c || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) charge(2);
    else if (code < 0x20 || (code >= 0xd800 && code <= 0xdfff
        && !(code <= 0xdbff && i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff))) charge(6);
    else if (code >= 0xd800 && code <= 0xdbff) { charge(4); i++; }
    else if (code > 0x7f) charge(code < 0x800 ? 2 : 3);
    else charge(1);
  }
}

function cloneJson(value: unknown, label: string, budget: { nodes: number; bytes: number }, seen = new Set<object>(), depth = 0): unknown {
  if (depth > MAX_DEPTH || --budget.nodes < 0) throw new RangeError(`${label} exceeds its bounded depth/node limit.`);
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError(`${label} contains a non-finite number.`);
    budget.bytes -= JSON.stringify(value).length;
    if (budget.bytes < 0) throw new RangeError(`${label} exceeds its bounded byte limit.`);
    return value;
  }
  if (typeof value === 'string') { chargeString(value, label, budget); return value; }
  if (!value || typeof value !== 'object' || seen.has(value)) throw new TypeError(`${label} must be acyclic JSON data.`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const length = value.length;
      if (length > budget.nodes) throw new RangeError(`${label} exceeds its bounded node limit.`);
      const keys = Reflect.ownKeys(value);
      if (keys.length !== length + 1 || keys.some(key => typeof key !== 'string' || (key !== 'length' && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)))) {
        throw new TypeError(`${label} array has extra properties.`);
      }
      budget.bytes -= 2 + Math.max(0, length - 1); // brackets and commas
      if (budget.bytes < 0) throw new RangeError(`${label} exceeds its bounded byte limit.`);
      const result: unknown[] = [];
      for (let index = 0; index < length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw new TypeError(`${label} array has a hole or accessor.`);
        result.push(cloneJson(descriptor.value, label, budget, seen, depth + 1));
      }
      return result;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError(`${label} records must be plain objects.`);
    const keys = Reflect.ownKeys(value), output: Record<string, unknown> = {};
    if (keys.length > budget.nodes) throw new RangeError(`${label} exceeds its bounded node limit.`);
    budget.bytes -= 2 + Math.max(0, keys.length - 1); // braces and commas
    if (budget.bytes < 0) throw new RangeError(`${label} exceeds its bounded byte limit.`);
    for (const key of keys) {
      if (typeof key !== 'string') throw new TypeError(`${label} has a symbol key.`);
      chargeString(key, label, budget);
      budget.bytes -= 1; // colon
      if (budget.bytes < 0) throw new RangeError(`${label} exceeds its bounded byte limit.`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw new TypeError(`${label} has an accessor or hidden field.`);
      Object.defineProperty(output, key, { value: cloneJson(descriptor.value, label, budget, seen, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    return output;
  } finally { seen.delete(value); }
}

function exact(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
      || Reflect.ownKeys(value).length !== keys.length) throw new TypeError(`${label} has invalid fields.`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) if (!descriptors[key] || !Object.hasOwn(descriptors[key]!, 'value') || !descriptors[key]!.enumerable) {
    throw new TypeError(`${label} requires exact enumerable data fields.`);
  }
  return value as Record<string, unknown>;
}

function boundedText(value: unknown, label: string, maximum = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError(`${label} is invalid bounded text.`);
  return value;
}
function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA.test(value)) throw new TypeError(`${label} must be a lowercase SHA-256.`);
  return value;
}
function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError(`${label} is outside its fixed bound.`);
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function freezeInput(value: CampaignIndexAuditFrozenInput): CampaignIndexAuditFrozenInput {
  const copy = cloneJson(value, 'Campaign audit input', { nodes: 1000, bytes: MAX_RECORD_BYTES }) as Record<string, unknown>;
  const fields = ['campaignId', 'campaignHash', 'inventoryHash', 'planHash', 'indexHash', 'configurationHash',
    'captureControllerRecord', 'completeCaptureSetSha256', 'requiredObservationSetSha256', 'auditInputSha256', 'auditFormat'];
  exact(copy, fields, 'Campaign audit input');
  const pin = exact(copy.captureControllerRecord, ['sha256', 'bytes'], 'Capture controller record pin');
  const frozen = {
    campaignId: boundedText(copy.campaignId, 'Campaign ID'),
    campaignHash: hash(copy.campaignHash, 'Campaign hash'), inventoryHash: hash(copy.inventoryHash, 'Inventory hash'),
    planHash: hash(copy.planHash, 'Plan hash'), indexHash: hash(copy.indexHash, 'Index hash'),
    configurationHash: hash(copy.configurationHash, 'Configuration hash'),
    captureControllerRecord: { sha256: hash(pin.sha256, 'Capture controller record hash'), bytes: integer(pin.bytes, 1, 512_000, 'Capture controller record bytes') },
    completeCaptureSetSha256: hash(copy.completeCaptureSetSha256, 'Complete capture set hash'),
    requiredObservationSetSha256: hash(copy.requiredObservationSetSha256, 'Required observation set hash'),
    auditInputSha256: hash(copy.auditInputSha256, 'Audit logical input hash'), auditFormat: copy.auditFormat,
  };
  if (frozen.auditFormat !== FEATURE_INDEX_AUDIT_FORMAT) throw new TypeError('Audit format differs from the fixed raw-index audit contract.');
  return { ...frozen, auditFormat: FEATURE_INDEX_AUDIT_FORMAT };
}

/** Deterministic single-ID audit job. A changed final membership conflicts at the same Ledger ID. */
export function campaignIndexAuditJob(value: CampaignIndexAuditFrozenInput, campaignMaxAttempts: number,
    attemptLimit = campaignMaxAttempts): EnqueueInput {
  const input = freezeInput(value);
  integer(campaignMaxAttempts, 1, 8, 'Campaign retry limit');
  integer(attemptLimit, 1, 8, 'Audit attempt limit');
  if (attemptLimit > campaignMaxAttempts) throw new RangeError('Audit retries cannot exceed the frozen campaign retry limit.');
  const id = `${input.campaignId}:feature-index-audit:${input.indexHash}`;
  const payload = { format: CAMPAIGN_INDEX_AUDIT_JOB_FORMAT, ...input, campaignMaxAttempts, attemptLimit };
  const immutablePayload = deepFreeze(payload);
  return { id, kind: CAMPAIGN_INDEX_AUDIT_KIND, inputHash: sha256(canonicalJson(immutablePayload)), payload: immutablePayload,
    maxAttempts: attemptLimit, priority: 0 };
}

type QualificationSet = {
  rawIndexConservation: AuditQualification;
  readOnlyStatePreserved: AuditQualification;
  campaignObservationCompleteness?: AuditQualification;
};
export interface CampaignIndexAuditCompletion {
  format: typeof CAMPAIGN_INDEX_AUDIT_COMPLETION_FORMAT;
  status: 'audit-complete' | 'audit-incomplete' | 'audit-failed';
  campaignId: string; campaignHash: string; inventoryHash: string; planHash: string;
  indexHash: string; configurationHash: string;
  captureControllerRecord: { sha256: string; bytes: number };
  completeCaptureSetSha256: string; requiredObservationSetSha256: string; auditInputSha256: string;
  auditFormat: typeof FEATURE_INDEX_AUDIT_FORMAT;
  controllerInputSha256: string; controllerRecordSha256: string; reportSha256: string; attempts: number;
  qualifications: QualificationSet; reasons: string[];
}

export interface QualifiedCampaignIndexAuditCompletion extends CampaignIndexAuditCompletion {
  status: 'audit-complete';
  proof: FeatureIndexSessionAuditProof;
  workerReportSha256: string;
  qualifications: {
    rawIndexConservation: 'complete';
    readOnlyStatePreserved: 'complete';
    campaignObservationCompleteness: 'complete';
  };
  reasons: [];
}

function qualification(value: unknown): AuditQualification {
  return value === 'complete' || value === 'failed' || value === 'incomplete' ? value : 'incomplete';
}

function reportEvidence(value: unknown, input: CampaignIndexAuditFrozenInput, attemptLimit: number) {
  const report = cloneJson(value, 'Campaign audit report', { nodes: MAX_NODES, bytes: MAX_REPORT_BYTES });
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw new TypeError('Campaign audit report must be an object.');
  const full = report as Record<string, unknown>;
  const worker = exact(full.audit, ['format', 'indexHash', 'inputSha256', 'captureRecordSha256', 'nodeVersion', 'sqliteVersion',
    'result', 'databaseBytes', 'maximumRssKiB'], 'Raw audit worker report');
  if (worker.indexHash !== input.indexHash || worker.captureRecordSha256 !== input.captureControllerRecord.sha256) {
    throw new Error('Audit worker index or durable capture record differs from the frozen input.');
  }
  hash(worker.inputSha256, 'Audit physical worker input');
  const result = exact(worker.result, ['format', 'scope', 'qualifications', 'counts', 'dispositionsSha256'], 'Raw audit result');
  if (worker.format !== 'feature-index-audit-worker-v1' || result.format !== input.auditFormat
      || result.scope !== 'raw-feature-conservation-and-required-observations') throw new Error('Audit report format or scope differs.');
  const workerQualifications = exact(result.qualifications, ['rawIndexConservation', 'requiredObservations'], 'Audit qualifications');
  const controller = exact(full.auditController, ['attempts', 'inputSha256', 'recordSha256', 'replayed', 'scope'], 'Audit controller report');
  if (controller.inputSha256 !== input.auditInputSha256
      || controller.scope !== 'raw-feature-conservation-and-required-observations; global campaign membership is not established by pins alone'
      || typeof controller.replayed !== 'boolean') {
    throw new Error('Audit controller logical input or frozen membership differs.');
  }
  integer(controller.attempts, 1, attemptLimit, 'Audit controller attempts');
  hash(controller.inputSha256, 'Audit controller logical input');
  hash(controller.recordSha256, 'Audit controller record');
  return { report, worker, controller, workerQualifications };
}

function completion(value: CampaignIndexAuditFrozenInput, reportValue: unknown, attemptLimit: number,
    options?: CampaignIndexAuditCompletionOptions): CampaignIndexAuditCompletion {
  const input = freezeInput(value);
  integer(attemptLimit, 1, 8, 'Audit attempt limit');
  if (options !== undefined) exact(options, ['knownCanonicalObservationSetSha256'], 'Audit completion options');
  const membership = options?.knownCanonicalObservationSetSha256;
  if (membership !== undefined && hash(membership, 'Known canonical observation set') !== input.requiredObservationSetSha256) {
    throw new Error('Known campaign observation membership differs from its frozen required set.');
  }
  const evidence = reportEvidence(reportValue, input, attemptLimit);
  const qualifications: QualificationSet = {
    rawIndexConservation: qualification(evidence.workerQualifications.rawIndexConservation),
    readOnlyStatePreserved: qualification(evidence.workerQualifications.readOnlyStatePreserved),
  };
  const reasons: string[] = [];
  if (qualifications.rawIndexConservation !== 'complete') reasons.push('raw-index-conservation-not-complete');
  if (qualifications.readOnlyStatePreserved !== 'complete') reasons.push('read-only-preservation-not-qualified');
  if (membership !== undefined) {
    qualifications.campaignObservationCompleteness = qualification(evidence.workerQualifications.campaignObservationCompleteness);
    if (qualifications.campaignObservationCompleteness !== 'complete'
        || evidence.controller.requiredObservationSetSha256 !== input.requiredObservationSetSha256) {
      qualifications.campaignObservationCompleteness = 'incomplete';
      reasons.push('campaign-observation-membership-not-qualified');
    }
  } else reasons.push('campaign-observation-membership-not-supplied');
  if (!Object.hasOwn(evidence.workerQualifications, 'readOnlyStatePreserved')) reasons.push('read-only-state-evidence-unavailable');
  const states = [qualifications.rawIndexConservation, qualifications.readOnlyStatePreserved,
    qualifications.campaignObservationCompleteness];
  const status = states.includes('failed') ? 'audit-failed'
    : states.every(state => state === 'complete') ? 'audit-complete' : 'audit-incomplete';
  const worker = evidence.worker as Record<string, unknown>;
  const controller = evidence.controller as Record<string, unknown>;
  const result: CampaignIndexAuditCompletion = {
    format: CAMPAIGN_INDEX_AUDIT_COMPLETION_FORMAT, status,
    campaignId: input.campaignId, campaignHash: input.campaignHash, inventoryHash: input.inventoryHash,
    planHash: input.planHash, indexHash: input.indexHash, configurationHash: input.configurationHash,
    captureControllerRecord: input.captureControllerRecord,
    completeCaptureSetSha256: input.completeCaptureSetSha256,
    requiredObservationSetSha256: input.requiredObservationSetSha256,
    auditInputSha256: input.auditInputSha256, auditFormat: input.auditFormat,
    controllerInputSha256: controller.inputSha256 as string,
    controllerRecordSha256: controller.recordSha256 as string,
    reportSha256: sha256(canonicalJson(evidence.report)), attempts: controller.attempts as number,
    qualifications, reasons,
  };
  return result;
}

/** Returns an explicit incomplete draft when report evidence omits global qualifications. */
export function buildCampaignIndexAuditCompletion(input: CampaignIndexAuditFrozenInput, report: unknown,
    attemptLimit: number, options?: CampaignIndexAuditCompletionOptions): CampaignIndexAuditCompletion {
  return completion(input, report, attemptLimit, options);
}

/** Exact semantic verifier for a completion receipt; it never infers ledger leases or missing qualifications. */
export function validateCampaignIndexAuditCompletion(value: unknown, input: CampaignIndexAuditFrozenInput,
    report: unknown, attemptLimit: number, options?: CampaignIndexAuditCompletionOptions): CampaignIndexAuditCompletion {
  const expected = completion(input, report, attemptLimit, options);
  const actual = cloneJson(value, 'Campaign audit completion', { nodes: 1000, bytes: MAX_RECORD_BYTES });
  const fields = ['format', 'status', 'campaignId', 'campaignHash', 'inventoryHash', 'planHash', 'indexHash', 'configurationHash',
    'captureControllerRecord', 'completeCaptureSetSha256', 'requiredObservationSetSha256', 'auditInputSha256', 'auditFormat',
    'controllerInputSha256', 'controllerRecordSha256', 'reportSha256', 'attempts', 'qualifications', 'reasons'];
  exact(actual, fields, 'Campaign audit completion');
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error('Campaign audit completion differs from its frozen input and bounded report.');
  return expected;
}

function qualifiedCompletion(inputValue: CampaignIndexAuditFrozenInput, proofValue: unknown, workerReportValue: unknown,
    attemptsValue: number, attemptLimitValue: number): QualifiedCampaignIndexAuditCompletion {
  // The SDK's private WeakSet brand proves this object came from its actual held-control verifier.
  assertValidatedFeatureIndexAuditProof(proofValue);
  const input = freezeInput(inputValue);
  const attempts = integer(attemptsValue, 1, integer(attemptLimitValue, 1, 8, 'Audit attempt limit'), 'Audit attempts');
  const proof = cloneJson(proofValue, 'Validated audit proof', { nodes: 1000, bytes: MAX_RECORD_BYTES }) as Record<string, unknown>;
  exact(proof, ['format', 'indexHash', 'captureControllerRecord', 'captureSetSha256', 'requiredObservationsSha256',
    'auditInputSha256', 'knownCanonicalObservationSetSha256', 'originalStateSha256', 'workerReportSha256',
    'controllerRecordSha256', 'qualifications'], 'Validated audit proof');
  const pin = exact(proof.captureControllerRecord, ['sha256', 'bytes'], 'Proof capture controller record pin');
  const proofQualifications = exact(proof.qualifications,
    ['rawIndexConservation', 'readOnlyStatePreserved', 'campaignObservationCompleteness'], 'Proof qualifications');
  if (proof.format !== 'feature-index-session-audit-proof-v1' || proof.indexHash !== input.indexHash
      || pin.sha256 !== input.captureControllerRecord.sha256 || pin.bytes !== input.captureControllerRecord.bytes
      || proof.captureSetSha256 !== input.completeCaptureSetSha256
      || proof.requiredObservationsSha256 !== input.requiredObservationSetSha256
      || proof.knownCanonicalObservationSetSha256 !== input.requiredObservationSetSha256
      || proof.auditInputSha256 !== input.auditInputSha256) {
    throw new Error('Validated audit proof differs from the frozen campaign/index membership.');
  }
  hash(proof.originalStateSha256, 'Proof original-state hash');
  const proofReportHash = hash(proof.workerReportSha256, 'Proof worker report hash');
  const controllerRecordHash = hash(proof.controllerRecordSha256, 'Proof audit controller record hash');
  for (const key of ['rawIndexConservation', 'readOnlyStatePreserved', 'campaignObservationCompleteness']) {
    if (proofQualifications[key] !== 'complete') throw new Error('Validated audit proof lacks all three qualified states.');
  }
  const worker = cloneJson(workerReportValue, 'Qualified raw audit worker report', { nodes: 20_000, bytes: 64_000 });
  const workerRecord = exact(worker, ['format', 'indexHash', 'inputSha256', 'captureRecordSha256', 'nodeVersion',
    'sqliteVersion', 'result', 'databaseBytes', 'maximumRssKiB'], 'Qualified raw audit worker report');
  if (featureIndexAuditWorkerDigest(worker) !== proofReportHash || workerRecord.format !== 'feature-index-audit-worker-v1'
      || workerRecord.indexHash !== input.indexHash
      || workerRecord.captureRecordSha256 !== input.captureControllerRecord.sha256) {
    throw new Error('Qualified worker report digest or frozen identity differs from its proof.');
  }
  hash(workerRecord.inputSha256, 'Qualified physical worker input hash');
  const result = exact(workerRecord.result, ['format', 'scope', 'qualifications', 'counts', 'dispositionsSha256'], 'Qualified raw audit result');
  if (result.format !== input.auditFormat || result.scope !== 'raw-feature-conservation-and-required-observations') {
    throw new Error('Qualified worker report scope differs from the fixed audit contract.');
  }
  const rawQualifications = exact(result.qualifications, ['rawIndexConservation', 'requiredObservations'], 'Qualified worker qualifications');
  if (rawQualifications.rawIndexConservation !== 'complete' || rawQualifications.requiredObservations !== 'complete') {
    throw new Error('Qualified worker report does not establish raw conservation and required contexts.');
  }
  boundedText(workerRecord.nodeVersion, 'Qualified worker Node version');
  boundedText(workerRecord.sqliteVersion, 'Qualified worker SQLite version');
  integer(workerRecord.databaseBytes, 1, Number.MAX_SAFE_INTEGER, 'Qualified worker database bytes');
  integer(workerRecord.maximumRssKiB, 0, Number.MAX_SAFE_INTEGER, 'Qualified worker maximum RSS');
  hash(result.dispositionsSha256, 'Qualified disposition digest');
  const counts = exact(result.counts, ['captures', 'rawFeatures', 'admitted', 'exceptions', 'occurrences', 'versions',
    'keys', 'conflicts', 'crossOwnerConflictKeys', 'observations', 'requiredObservations'], 'Qualified worker counts');
  const countValues = Object.fromEntries(Object.entries(counts).map(([key, value]) =>
    [key, integer(value, 0, Number.MAX_SAFE_INTEGER, `Qualified worker ${key}`)]));
  if (countValues.captures! > 256 || countValues.admitted! + countValues.exceptions! > Number.MAX_SAFE_INTEGER
      || countValues.admitted! + countValues.exceptions! !== countValues.rawFeatures
      || countValues.requiredObservations! > countValues.observations!) {
    throw new Error('Qualified worker counts exceed fixed bounds or fail conservation.');
  }
  const completion: QualifiedCampaignIndexAuditCompletion = {
    format: CAMPAIGN_INDEX_AUDIT_COMPLETION_FORMAT, status: 'audit-complete',
    campaignId: input.campaignId, campaignHash: input.campaignHash, inventoryHash: input.inventoryHash,
    planHash: input.planHash, indexHash: input.indexHash, configurationHash: input.configurationHash,
    captureControllerRecord: input.captureControllerRecord, completeCaptureSetSha256: input.completeCaptureSetSha256,
    requiredObservationSetSha256: input.requiredObservationSetSha256, auditInputSha256: input.auditInputSha256,
    auditFormat: input.auditFormat, controllerInputSha256: input.auditInputSha256,
    controllerRecordSha256: controllerRecordHash, reportSha256: proofReportHash, attempts,
    qualifications: { rawIndexConservation: 'complete', readOnlyStatePreserved: 'complete',
      campaignObservationCompleteness: 'complete' }, reasons: [], proof: proofValue as FeatureIndexSessionAuditProof,
    workerReportSha256: proofReportHash,
  };
  return deepFreeze(completion);
}

/** Creates a globally qualified receipt only from an SDK-branded audit proof and its exact worker report. */
export function buildQualifiedCampaignIndexAuditCompletion(input: CampaignIndexAuditFrozenInput, proof: FeatureIndexSessionAuditProof,
    workerReport: unknown, attempts: number, attemptLimit: number): QualifiedCampaignIndexAuditCompletion {
  return qualifiedCompletion(input, proof, workerReport, attempts, attemptLimit);
}

/** Rejects any receipt that differs from the actual SDK-branded proof, worker report, or frozen tuple. */
export function validateQualifiedCampaignIndexAuditCompletion(value: unknown, input: CampaignIndexAuditFrozenInput,
    proof: FeatureIndexSessionAuditProof, workerReport: unknown, attempts: number, attemptLimit: number): QualifiedCampaignIndexAuditCompletion {
  const expected = qualifiedCompletion(input, proof, workerReport, attempts, attemptLimit);
  const actual = cloneJson(value, 'Qualified campaign audit completion', { nodes: 2000, bytes: MAX_RECORD_BYTES });
  exact(actual, ['format', 'status', 'campaignId', 'campaignHash', 'inventoryHash', 'planHash', 'indexHash',
    'configurationHash', 'captureControllerRecord', 'completeCaptureSetSha256', 'requiredObservationSetSha256',
    'auditInputSha256', 'auditFormat', 'controllerInputSha256', 'controllerRecordSha256', 'reportSha256', 'attempts',
    'qualifications', 'reasons', 'proof', 'workerReportSha256'], 'Qualified campaign audit completion');
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error('Qualified campaign audit completion differs from its validated proof and report.');
  return expected;
}
