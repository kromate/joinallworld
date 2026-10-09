import { canonicalJson, sha256 } from './pack.ts';
import {
  FEATURE_INDEX_SHARD_PLAN_FORMAT,
  validateFeatureIndexShardPlan,
  type FeatureIndexShardPlan,
  type FeatureIndexShardPlanRequest,
} from './index-shard-plan.ts';

export const FEATURE_INDEX_SHARD_WINDOWS_FORMAT = 'feature-index-shard-windows-v1';
export const FEATURE_INDEX_SHARD_WINDOW_FORMAT = 'feature-index-shard-window-v1';
export const FEATURE_INDEX_SHARD_WINDOW_ID_FORMAT = 'feature-index-shard-window-id-v1';
export const FEATURE_INDEX_SHARD_CAPTURE_CALLS_PER_WINDOW = 256;
// Planning-object bound only: structural maximum is 32,768 context calls, 4,096 audit members and 256 shards.
// It is not a session wire or campaign storage allowance; callers must fit those separate frozen budgets.
export const FEATURE_INDEX_SHARD_WINDOW_PLAN_MAX_BYTES = 24 * 1024 * 1024;
export const FEATURE_INDEX_SHARD_WINDOW_PLAN_MAX_WINDOWS = 384;

const WINDOW_LIMITS = Object.freeze({
  captureCallsPerWindow: FEATURE_INDEX_SHARD_CAPTURE_CALLS_PER_WINDOW,
  sessionWallMs: 600_000,
  coordinatorRssBytes: 96 * 1024 * 1024,
  lineBytes: 128_000,
  auditDescriptorsPerWindow: 256,
  auditDescriptorBytes: 512_000,
});
const SHA256 = /^[a-f0-9]{64}$/;

export interface FeatureIndexShardCaptureOperation {
  shardId: string;
  requestHash: string;
  requestOrdinal: number;
  globalOperationOrdinal: number;
  contextOrdinal: number;
  captureInputHash: string;
  requiredObservationSetHash: string;
}

export interface FeatureIndexShardAuditMember {
  requestHash: string;
  requestOrdinal: number;
  captureInputHash: string;
  requiredObservationSetHash: string;
  requiredObservationCount: number;
}

export interface FeatureIndexShardAuditOperation {
  shardId: string;
  members: FeatureIndexShardAuditMember[];
}

export interface FeatureIndexShardWindow {
  format: typeof FEATURE_INDEX_SHARD_WINDOW_FORMAT;
  id: string;
  ordinal: number;
  kind: 'capture' | 'audit';
  operations: Array<FeatureIndexShardCaptureOperation | FeatureIndexShardAuditOperation>;
}

export interface FeatureIndexShardWindows {
  format: typeof FEATURE_INDEX_SHARD_WINDOWS_FORMAT;
  scope: 'planning-only';
  status: 'not-executed';
  planHash: string;
  planFormat: typeof FEATURE_INDEX_SHARD_PLAN_FORMAT;
  limits: typeof WINDOW_LIMITS;
  counts: {
    requests: number;
    requiredObservationContexts: number;
    captureCalls: number;
    captureWindows: number;
    auditWindows: number;
    totalWindows: number;
  };
  windows: FeatureIndexShardWindow[];
}

function exactObject(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be a plain object.`);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key))) {
    throw new TypeError(`${label} has missing or unknown fields.`);
  }
  const result: Record<string, unknown> = {};
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${label} fields must be enumerable data properties.`);
    }
    Object.defineProperty(result, key, { value: descriptor.value, enumerable: true, writable: true, configurable: true });
  }
  return result;
}

function boundedArray(value: unknown, maximum: number, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  const length = value.length;
  if (length > maximum) throw new RangeError(`${label} exceeds its deterministic bound.`);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1 || keys.some(key => typeof key !== 'string'
      || (key !== 'length' && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)))) {
    throw new TypeError(`${label} has a hole or extra property.`);
  }
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${label} has an accessor or hole.`);
    }
    result.push(descriptor.value);
  }
  return result;
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function makeWindow(planHash: string, ordinal: number, kind: 'capture' | 'audit', operations: FeatureIndexShardWindow['operations']): FeatureIndexShardWindow {
  const id = sha256(canonicalJson({ format: FEATURE_INDEX_SHARD_WINDOW_ID_FORMAT, planHash, ordinal, kind, operations }));
  return { format: FEATURE_INDEX_SHARD_WINDOW_FORMAT, id, ordinal, kind, operations };
}

function derive(plan: FeatureIndexShardPlan, planHash: string): FeatureIndexShardWindows {
  const ordinalByRequest = new Map<string, number>();
  const requestByHash = new Map<string, FeatureIndexShardPlanRequest>();
  plan.requests.forEach((request, ordinal) => {
    ordinalByRequest.set(request.requestHash, ordinal);
    requestByHash.set(request.requestHash, request);
  });

  const windows: FeatureIndexShardWindow[] = [];
  let pending: FeatureIndexShardCaptureOperation[] = [];
  let globalOperationOrdinal = 0;
  let requiredObservationContexts = 0;
  const flushCapture = () => {
    if (!pending.length) return;
    windows.push(makeWindow(planHash, windows.length, 'capture', pending));
    pending = [];
  };

  for (const shard of plan.shards) {
    for (const requestHash of shard.requestHashes) {
      const request = requestByHash.get(requestHash);
      const requestOrdinal = ordinalByRequest.get(requestHash);
      if (!request || requestOrdinal === undefined) throw new Error('Validated shard plan has inconsistent request membership.');
      requiredObservationContexts += request.requiredObservationCount;
      for (let contextOrdinal = 0; contextOrdinal < request.requiredObservationCount; contextOrdinal++) {
        pending.push({ shardId: shard.id, requestHash, requestOrdinal, globalOperationOrdinal,
          contextOrdinal, captureInputHash: request.captureInputHash,
          requiredObservationSetHash: request.requiredObservationSetHash });
        globalOperationOrdinal++;
        if (pending.length === FEATURE_INDEX_SHARD_CAPTURE_CALLS_PER_WINDOW) flushCapture();
      }
    }
  }
  flushCapture();

  for (const shard of plan.shards) {
    const members = shard.requestHashes.map(requestHash => {
      const request = requestByHash.get(requestHash);
      const requestOrdinal = ordinalByRequest.get(requestHash);
      if (!request || requestOrdinal === undefined) throw new Error('Validated shard plan has inconsistent audit membership.');
      return { requestHash, requestOrdinal, captureInputHash: request.captureInputHash,
        requiredObservationSetHash: request.requiredObservationSetHash,
        requiredObservationCount: request.requiredObservationCount };
    });
    const operation: FeatureIndexShardAuditOperation = { shardId: shard.id, members };
    windows.push(makeWindow(planHash, windows.length, 'audit', [operation]));
  }

  if (windows.length > FEATURE_INDEX_SHARD_WINDOW_PLAN_MAX_WINDOWS) throw new Error('Window plan exceeds its fixed shard/request geometry.');
  const captureWindows = windows.filter(window => window.kind === 'capture').length;
  const auditWindows = windows.length - captureWindows;
  const result: FeatureIndexShardWindows = {
    format: FEATURE_INDEX_SHARD_WINDOWS_FORMAT,
    scope: 'planning-only',
    status: 'not-executed',
    planHash,
    planFormat: FEATURE_INDEX_SHARD_PLAN_FORMAT,
    limits: { ...WINDOW_LIMITS },
    counts: { requests: plan.requestCount, requiredObservationContexts,
      captureCalls: globalOperationOrdinal, captureWindows, auditWindows, totalWindows: windows.length },
    windows,
  };
  const bytes = Buffer.byteLength(canonicalJson(result), 'utf8');
  if (bytes > FEATURE_INDEX_SHARD_WINDOW_PLAN_MAX_BYTES) {
    throw new RangeError('Deterministic window plan exceeds its fixed 24 MiB output bound.');
  }
  return freezeDeep(result);
}

/** Derive all fixed capture and audit windows from the complete externally pinned plan. */
export function deriveFeatureIndexShardWindows(planValue: unknown, expectedPlanHash: string): FeatureIndexShardWindows {
  if (typeof expectedPlanHash !== 'string' || expectedPlanHash.length !== 64 || !SHA256.test(expectedPlanHash)) {
    throw new TypeError('Expected shard plan hash must be a lowercase SHA-256.');
  }
  const plan = validateFeatureIndexShardPlan(planValue, expectedPlanHash);
  return derive(plan, expectedPlanHash);
}

function equalCaptureOperation(value: unknown, expected: FeatureIndexShardCaptureOperation): void {
  const actual = exactObject(value, ['shardId', 'requestHash', 'requestOrdinal', 'globalOperationOrdinal',
    'contextOrdinal', 'captureInputHash', 'requiredObservationSetHash'], 'Capture window operation');
  for (const key of ['shardId', 'requestHash', 'requestOrdinal', 'globalOperationOrdinal', 'contextOrdinal',
    'captureInputHash', 'requiredObservationSetHash'] as const) {
    if (actual[key] !== expected[key]) throw new Error('Capture operation differs from deterministic full-plan membership.');
  }
}

function equalAuditOperation(value: unknown, expected: FeatureIndexShardAuditOperation): void {
  const actual = exactObject(value, ['shardId', 'members'], 'Audit window operation');
  if (actual.shardId !== expected.shardId) throw new Error('Audit operation shard differs from deterministic full-plan membership.');
  const members = boundedArray(actual.members, 256, 'Audit window members');
  if (members.length !== expected.members.length) throw new Error('Audit operation omits or adds planned requests.');
  for (let index = 0; index < members.length; index++) {
    const member = exactObject(members[index], ['requestHash', 'requestOrdinal', 'captureInputHash',
      'requiredObservationSetHash', 'requiredObservationCount'], `Audit member ${index}`);
    const wanted = expected.members[index]!;
    for (const key of ['requestHash', 'requestOrdinal', 'captureInputHash', 'requiredObservationSetHash',
      'requiredObservationCount'] as const) {
      if (member[key] !== wanted[key]) throw new Error('Audit member differs from deterministic full-plan membership.');
    }
  }
}

/** Recompute and compare every bounded window; caller-provided prefixes/cursors are never accepted. */
export function validateFeatureIndexShardWindows(
  value: unknown, planValue: unknown, expectedPlanHash: string,
): FeatureIndexShardWindows {
  const expected = deriveFeatureIndexShardWindows(planValue, expectedPlanHash);
  const actual = exactObject(value, ['format', 'scope', 'status', 'planHash', 'planFormat', 'limits', 'counts', 'windows'], 'Shard windows');
  if (actual.format !== expected.format || actual.scope !== expected.scope || actual.status !== expected.status
      || actual.planHash !== expected.planHash || actual.planFormat !== expected.planFormat) {
    throw new Error('Shard window identity or planning-only status differs from the pinned full plan.');
  }
  const limits = exactObject(actual.limits, ['captureCallsPerWindow', 'sessionWallMs', 'coordinatorRssBytes',
    'lineBytes', 'auditDescriptorsPerWindow', 'auditDescriptorBytes'], 'Window limits');
  for (const key of Object.keys(WINDOW_LIMITS) as Array<keyof typeof WINDOW_LIMITS>) {
    if (limits[key] !== expected.limits[key]) throw new Error('Window resource metadata differs from its frozen contract.');
  }
  const counts = exactObject(actual.counts, ['requests', 'requiredObservationContexts', 'captureCalls',
    'captureWindows', 'auditWindows', 'totalWindows'], 'Window counts');
  for (const key of ['requests', 'requiredObservationContexts', 'captureCalls', 'captureWindows', 'auditWindows', 'totalWindows'] as const) {
    if (counts[key] !== expected.counts[key]) throw new Error('Window counts differ from complete deterministic recomputation.');
  }
  const windows = boundedArray(actual.windows, FEATURE_INDEX_SHARD_WINDOW_PLAN_MAX_WINDOWS, 'Shard windows');
  if (windows.length !== expected.windows.length) throw new Error('Window plan omits or adds deterministic full-plan windows.');
  for (let index = 0; index < windows.length; index++) {
    const window = exactObject(windows[index], ['format', 'id', 'ordinal', 'kind', 'operations'], `Window ${index}`);
    const wanted = expected.windows[index]!;
    if (window.format !== wanted.format || window.id !== wanted.id || window.ordinal !== wanted.ordinal || window.kind !== wanted.kind) {
      throw new Error('Shard windows are reordered, duplicated, or differ from deterministic recomputation.');
    }
    const operations = boundedArray(window.operations, FEATURE_INDEX_SHARD_CAPTURE_CALLS_PER_WINDOW, `Window ${index} operations`);
    if (operations.length !== wanted.operations.length) throw new Error('Window omits or adds planned operations.');
    for (let operation = 0; operation < operations.length; operation++) {
      if (wanted.kind === 'capture') equalCaptureOperation(operations[operation], wanted.operations[operation] as FeatureIndexShardCaptureOperation);
      else equalAuditOperation(operations[operation], wanted.operations[operation] as FeatureIndexShardAuditOperation);
    }
  }
  return expected;
}
