import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from './pack.ts';
import {
  FEATURE_INDEX_SHARD_PLAN_INPUT_FORMAT,
  encodeFeatureIndexShardPlan,
  type FeatureIndexShardPlanInput,
  type FeatureIndexShardPlanRequest,
} from './index-shard-plan.ts';
import {
  FEATURE_INDEX_SHARD_CAPTURE_CALLS_PER_WINDOW,
  FEATURE_INDEX_SHARD_WINDOW_PLAN_MAX_WINDOWS,
  deriveFeatureIndexShardWindows,
  validateFeatureIndexShardWindows,
  type FeatureIndexShardCaptureOperation,
  type FeatureIndexShardAuditOperation,
} from './index-shard-window.ts';

const hash = (value: string): string => sha256(value);

function request(index: number, contexts = 1): FeatureIndexShardPlanRequest {
  return {
    requestHash: hash(`request-${index}`),
    captureInputHash: hash(`capture-${index}`),
    requiredObservationSetHash: hash(`observations-${index}`),
    requiredObservationCount: contexts,
    auditDescriptorBytes: 100,
  };
}

function source(count: number, contexts = 1, maxCaptures = 256): FeatureIndexShardPlanInput {
  return {
    format: FEATURE_INDEX_SHARD_PLAN_INPUT_FORMAT,
    bindings: {
      campaignHash: hash('campaign'),
      countryGridPlanHash: hash('country-grid-plan'),
      sourceConfigurationHash: hash('source-configuration'),
      toolingManifestHash: hash('tooling-manifest'),
      baseIndexBindingHash: hash('base-binding'),
    },
    policy: {
      aggregateBytes: 512 * 1024 * 1024,
      registryControlBytes: 1024 * 1024,
      shardReservedBytes: 1024 * 1024,
      maxCaptures,
      descriptorBytes: 500_000,
      envelopeOverheadBytes: 1_000,
      maxShards: 256,
      maxAttempts: 8,
    },
    requests: Array.from({ length: count }, (_, index) => request(index, contexts)),
  };
}

function mutable<T>(value: T): T {
  return structuredClone(value);
}

test('4096 one-context requests produce all 16 capture windows and one audit window per shard', () => {
  const input = source(4096, 1, 256);
  const encoded = encodeFeatureIndexShardPlan(input);
  const before = JSON.stringify(input);
  const windows = deriveFeatureIndexShardWindows(encoded.plan, encoded.hash);
  const repeated = deriveFeatureIndexShardWindows(encoded.plan, encoded.hash);
  const captures = windows.windows.filter(window => window.kind === 'capture');
  const audits = windows.windows.filter(window => window.kind === 'audit');

  assert.equal(JSON.stringify(windows), JSON.stringify(repeated));
  assert.equal(JSON.stringify(input), before);
  assert.equal(windows.counts.requests, 4096);
  assert.equal(windows.counts.requiredObservationContexts, 4096);
  assert.equal(windows.counts.captureCalls, 4096);
  assert.equal(captures.length, 16);
  assert.equal(audits.length, encoded.plan.shards.length);
  assert.ok(captures.every(window => window.operations.length === FEATURE_INDEX_SHARD_CAPTURE_CALLS_PER_WINDOW));
  assert.equal(windows.windows.length, captures.length + audits.length);
  assert.ok(windows.windows.every((window, index) => window.ordinal === index));
  assert.ok(Object.isFrozen(windows) && Object.isFrozen(windows.windows) && Object.isFrozen(captures[0]));
  assert.deepEqual(validateFeatureIndexShardWindows(windows, encoded.plan, encoded.hash), windows);
});

test('4096 requests with eight contexts become 128 capture windows and retain each context ordinal', () => {
  const encoded = encodeFeatureIndexShardPlan(source(4096, 8, 16));
  const windows = deriveFeatureIndexShardWindows(encoded.plan, encoded.hash);
  const captureWindows = windows.windows.filter(window => window.kind === 'capture');
  const auditWindows = windows.windows.filter(window => window.kind === 'audit');
  const operations = captureWindows.flatMap(window => window.operations);
  const contexts = new Map<string, number[]>();

  assert.equal(windows.counts.captureCalls, 4096 * 8);
  assert.equal(windows.counts.requiredObservationContexts, 4096 * 8);
  assert.equal(captureWindows.length, 128);
  assert.equal(auditWindows.length, 256);
  assert.equal(windows.windows.length, FEATURE_INDEX_SHARD_WINDOW_PLAN_MAX_WINDOWS);
  operations.forEach((raw, ordinal) => {
    const operation = raw as { requestHash: string; contextOrdinal: number; globalOperationOrdinal: number };
    assert.equal(operation.globalOperationOrdinal, ordinal);
    const rows = contexts.get(operation.requestHash) ?? [];
    rows.push(operation.contextOrdinal);
    contexts.set(operation.requestHash, rows);
  });
  assert.equal(contexts.size, 4096);
  for (const ordinals of contexts.values()) assert.deepEqual(ordinals, [0, 1, 2, 3, 4, 5, 6, 7]);
  for (const audit of auditWindows) assert.equal(audit.operations.length, 1);
  assert.equal(validateFeatureIndexShardWindows(windows, encoded.plan, encoded.hash).counts.totalWindows, 384);
});

test('capture windows split at 256 calls, including a partial final window and cross-request context boundary', () => {
  const encoded = encodeFeatureIndexShardPlan(source(257, 1, 256));
  const windows = deriveFeatureIndexShardWindows(encoded.plan, encoded.hash);
  const captures = windows.windows.filter(window => window.kind === 'capture');
  assert.deepEqual(captures.map(window => window.operations.length), [256, 1]);
  assert.equal((captures[0]!.operations[255] as FeatureIndexShardCaptureOperation).globalOperationOrdinal, 255);
  assert.equal((captures[1]!.operations[0] as FeatureIndexShardCaptureOperation).globalOperationOrdinal, 256);

  const contextPlan = encodeFeatureIndexShardPlan(source(86, 3, 16));
  const contextWindows = deriveFeatureIndexShardWindows(contextPlan.plan, contextPlan.hash)
    .windows.filter(window => window.kind === 'capture');
  assert.deepEqual(contextWindows.map(window => window.operations.length), [256, 2]);
  const first = contextWindows[0]!.operations[255] as FeatureIndexShardCaptureOperation;
  const next = contextWindows[1]!.operations[0] as FeatureIndexShardCaptureOperation;
  assert.equal(first.requestHash, next.requestHash);
  assert.equal(first.contextOrdinal, 0);
  assert.equal(next.contextOrdinal, 1);
});

test('each audit window names one exact shard partition and preserves full plan ordinals', () => {
  const encoded = encodeFeatureIndexShardPlan(source(37, 3, 8));
  const windows = deriveFeatureIndexShardWindows(encoded.plan, encoded.hash);
  const audits = windows.windows.filter(window => window.kind === 'audit');
  const expected = new Map(encoded.plan.requests.map((item, ordinal) => [item.requestHash, { item, ordinal }]));
  const seen = new Set<string>();

  assert.equal(audits.length, encoded.plan.shards.length);
  for (const audit of audits) {
    assert.equal(audit.operations.length, 1);
    const operation = audit.operations[0] as FeatureIndexShardAuditOperation;
    const shard = encoded.plan.shards.find(item => item.id === operation.shardId)!;
    assert.deepEqual(operation.members.map(member => member.requestHash), shard.requestHashes);
    for (const member of operation.members) {
      const match = expected.get(member.requestHash as string)!;
      assert.equal(member.requestOrdinal, match.ordinal);
      assert.equal(member.captureInputHash, match.item.captureInputHash);
      assert.equal(member.requiredObservationSetHash, match.item.requiredObservationSetHash);
      assert.equal(member.requiredObservationCount, match.item.requiredObservationCount);
      assert.ok(!seen.has(member.requestHash as string));
      seen.add(member.requestHash as string);
    }
  }
  assert.equal(seen.size, encoded.plan.requestCount);
});

test('validation checks the externally pinned whole plan and rejects omitted, reordered, duplicate, or edited windows', () => {
  const encoded = encodeFeatureIndexShardPlan(source(257, 2, 64));
  const windows = deriveFeatureIndexShardWindows(encoded.plan, encoded.hash);
  assert.throws(() => deriveFeatureIndexShardWindows(encoded.plan, hash('different-plan')),
    /externally retained immutable hash/i);

  const omitted = mutable(windows);
  omitted.windows.pop();
  assert.throws(() => validateFeatureIndexShardWindows(omitted, encoded.plan, encoded.hash), /omits or adds/i);

  const reordered = mutable(windows);
  [reordered.windows[0], reordered.windows[1]] = [reordered.windows[1]!, reordered.windows[0]!];
  assert.throws(() => validateFeatureIndexShardWindows(reordered, encoded.plan, encoded.hash), /reordered|deterministic/i);

  const duplicated = mutable(windows);
  duplicated.windows[1] = structuredClone(duplicated.windows[0]!);
  assert.throws(() => validateFeatureIndexShardWindows(duplicated, encoded.plan, encoded.hash), /reordered|duplicated|deterministic/i);

  const editedContext = mutable(windows);
  const firstCapture = editedContext.windows.find(window => window.kind === 'capture')!;
  const firstOperation = firstCapture.operations[1] as { contextOrdinal: number };
  firstOperation.contextOrdinal = 0;
  assert.throws(() => validateFeatureIndexShardWindows(editedContext, encoded.plan, encoded.hash), /differs from deterministic/i);

  const forgedLimit = mutable(windows);
  Object.assign(forgedLimit.limits, { captureCallsPerWindow: 128 });
  assert.throws(() => validateFeatureIndexShardWindows(forgedLimit, encoded.plan, encoded.hash), /resource metadata/i);

  const extraSchema = mutable(windows) as unknown as Record<string, unknown>;
  extraSchema.execution = 'complete';
  assert.throws(() => validateFeatureIndexShardWindows(extraSchema, encoded.plan, encoded.hash), /unknown fields/i);

  const duplicateAuditMember = mutable(windows);
  const firstAudit = duplicateAuditMember.windows.find(window => window.kind === 'audit')!;
  const audit = firstAudit.operations[0] as { members: unknown[] };
  audit.members[1] = structuredClone(audit.members[0]);
  assert.throws(() => validateFeatureIndexShardWindows(duplicateAuditMember, encoded.plan, encoded.hash), /differs from deterministic/i);
});

test('validation rejects oversized arrays before traversal and accessors without invoking them', () => {
  const encoded = encodeFeatureIndexShardPlan(source(1));
  const windows = deriveFeatureIndexShardWindows(encoded.plan, encoded.hash);
  const oversized = mutable(windows) as unknown as Record<string, unknown>;
  oversized.windows = new Array(FEATURE_INDEX_SHARD_WINDOW_PLAN_MAX_WINDOWS + 1);
  assert.throws(() => validateFeatureIndexShardWindows(oversized, encoded.plan, encoded.hash), /deterministic bound/i);

  const accessor = mutable(windows);
  let reads = 0;
  Object.defineProperty(accessor.windows[0]!, 'kind', { enumerable: true, configurable: true, get() { reads++; return 'capture'; } });
  assert.throws(() => validateFeatureIndexShardWindows(accessor, encoded.plan, encoded.hash), /data properties/i);
  assert.equal(reads, 0);
});
