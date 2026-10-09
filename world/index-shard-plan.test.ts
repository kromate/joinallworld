import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, sha256 } from './pack.ts';
import {
  FEATURE_INDEX_SHARD_PLAN_INPUT_FORMAT, FEATURE_INDEX_SHARD_PLAN_MAX_BYTES,
  FEATURE_INDEX_REGISTRY_ALLOWANCE_BYTES,
  encodeFeatureIndexShardPlan, planFeatureIndexShards, validateFeatureIndexShardPlan,
  type FeatureIndexShardPlanInput, type FeatureIndexShardPlanRequest,
} from './index-shard-plan.ts';

const h = (char: string) => char.repeat(64);
const policy = (overrides: Partial<FeatureIndexShardPlanInput['policy']> = {}): FeatureIndexShardPlanInput['policy'] => ({
  aggregateBytes: 64 * 1024 * 1024, registryControlBytes: 1024 * 1024, shardReservedBytes: 2 * 1024 * 1024,
  maxCaptures: 2, descriptorBytes: 1000, envelopeOverheadBytes: 100, maxShards: 16, maxAttempts: 4,
  ...overrides,
});
function request(char: string, bytes: number, contexts = 1): FeatureIndexShardPlanRequest {
  return { requestHash: h(char), captureInputHash: h(String.fromCharCode(char.charCodeAt(0) + 1)),
    requiredObservationSetHash: h(String.fromCharCode(char.charCodeAt(0) + 2)),
    requiredObservationCount: contexts, auditDescriptorBytes: bytes };
}
function input(requests: FeatureIndexShardPlanRequest[], policyOverride: Partial<FeatureIndexShardPlanInput['policy']> = {}): FeatureIndexShardPlanInput {
  return { format: FEATURE_INDEX_SHARD_PLAN_INPUT_FORMAT,
    bindings: { campaignHash: h('a'), countryGridPlanHash: h('b'), sourceConfigurationHash: h('c'),
      toolingManifestHash: h('d'), baseIndexBindingHash: h('e') },
    policy: policy(policyOverride), requests };
}

test('shard plan sorts membership, is deterministic, freezes output, and encodes a bounded canonical plan', () => {
  const source = input([request('5', 250), request('3', 300), request('1', 400), request('4', 700), request('2', 600)]);
  const before = canonicalJson(source);
  const first = planFeatureIndexShards(source);
  const second = planFeatureIndexShards(source);
  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.equal(encodeFeatureIndexShardPlan({ ...source, requests: [...source.requests].reverse() }).hash, encodeFeatureIndexShardPlan(source).hash);
  assert.equal(canonicalJson(source), before);
  assert.deepEqual(first.requests.map(item => item.requestHash), [h('1'), h('2'), h('3'), h('4'), h('5')]);
  assert.equal(first.scope, 'namespace-batch');
  assert.equal(first.admission, 'not-admitted');
  assert.equal(first.geometryCoverage, 'not-compiled');
  assert.equal(first.occupancy, 'not-checked');
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.requests) && Object.isFrozen(first.shards[0]));
  const encoded = encodeFeatureIndexShardPlan(source);
  assert.equal(encoded.hash, sha256(encoded.bytes));
  assert.ok(encoded.bytes.byteLength <= FEATURE_INDEX_SHARD_PLAN_MAX_BYTES);
  assert.deepEqual(validateFeatureIndexShardPlan(first), first);
});

test('greedy partitions split on both capture count and charged descriptor capacity without splitting requests', () => {
  const units = [request('1', 600, 2), request('2', 400, 1), request('3', 300, 3), request('4', 700, 1), request('5', 250, 2)];
  const byDescriptor = planFeatureIndexShards(input(units, { maxCaptures: 4 }));
  assert.deepEqual(byDescriptor.shards.map(shard => shard.requestHashes.map(value => value[0])), [['1', '2'], ['3', '4'], ['5']]);
  assert.deepEqual(byDescriptor.shards.map(shard => shard.descriptorBytes), [1000, 1000, 250]);
  assert.deepEqual(byDescriptor.shards.map(shard => shard.requiredObservationCount), [3, 4, 2]);
  const byCount = planFeatureIndexShards(input(units.map(unit => ({ ...unit, auditDescriptorBytes: 10 })), { maxCaptures: 2 }));
  assert.deepEqual(byCount.shards.map(shard => shard.requestCount), [2, 2, 1]);
  assert.ok(byCount.shards.every(shard => shard.requestHashes.length === shard.requestCount));
  assert.ok(byCount.shards.every(shard => shard.envelopeBytes === shard.descriptorBytes + byCount.policy.envelopeOverheadBytes));
});

test('a request that cannot fit and aggregate reservation exhaustion refuse the entire plan', () => {
  assert.throws(() => planFeatureIndexShards(input([request('1', 1001)])), /Audit descriptor bytes|fit one shard/i);
  const needsThree = input([request('1', 600), request('2', 400), request('3', 300), request('4', 700), request('5', 250)],
    { maxCaptures: 4, aggregateBytes: FEATURE_INDEX_REGISTRY_ALLOWANCE_BYTES + 1024 * 1024 + 2 * 2_097_152 });
  assert.throws(() => planFeatureIndexShards(needsThree), /namespace aggregate quota/i);
  assert.throws(() => planFeatureIndexShards(input([request('1', 600), request('2', 400), request('3', 300)], { maxShards: 1 })), /maximum shard count/i);
});

test('validator recomputes shard IDs, membership, totals, statuses, and rejects rehashed partial forgeries', () => {
  const plan = planFeatureIndexShards(input([request('1', 600), request('2', 400), request('3', 300)]));
  assert.throws(() => validateFeatureIndexShardPlan({ ...plan, descriptorBytes: plan.descriptorBytes + 1 }), /differ from deterministic/i);
  const requests = plan.requests.map(item => ({ ...item }));
  requests[0]!.captureInputHash = h('9');
  const rehashedMembership = { ...plan, requests, membershipSha256: sha256(canonicalJson(requests)) };
  assert.throws(() => validateFeatureIndexShardPlan(rehashedMembership), /differ from deterministic/i);
  assert.throws(() => validateFeatureIndexShardPlan({ ...plan, admission: 'admitted' }), /planning-only/i);
  assert.throws(() => validateFeatureIndexShardPlan({ ...plan, extra: true }), /unknown fields/i);
});

test('fixed policy and input-size bounds reject invalid quotas, unknown fields, oversized arrays, and giant strings', () => {
  assert.throws(() => planFeatureIndexShards(input([], { aggregateBytes: 512 * 1024 * 1024 + 1 })), /fixed integer bound/i);
  assert.throws(() => planFeatureIndexShards(input([], { registryControlBytes: 1024 * 1024 + 1 })), /fixed integer bound/i);
  assert.throws(() => planFeatureIndexShards(input([], { shardReservedBytes: 65_535 })), /fixed integer bound/i);
  assert.throws(() => planFeatureIndexShards(input([], { descriptorBytes: 500_000, envelopeOverheadBytes: 12_001 })), /512000/i);
  assert.throws(() => planFeatureIndexShards({ ...input([]), stale: true }), /unknown fields/i);
  let read = false;
  const tooMany = new Array(4097);
  Object.defineProperty(tooMany, '0', { enumerable: true, get() { read = true; return request('1', 1); } });
  assert.throws(() => planFeatureIndexShards({ ...input([]), requests: tooMany }), /4096/i);
  assert.equal(read, false);
  const huge = 'x'.repeat(FEATURE_INDEX_SHARD_PLAN_MAX_BYTES + 10);
  assert.throws(() => planFeatureIndexShards(input([{ ...request('1', 1), requestHash: huge }])), /bounded canonical JSON byte limit/i);
});

test('namespace reservation includes the fixed 17 MiB registry allowance and an additional planning margin', () => {
  const fixed = FEATURE_INDEX_REGISTRY_ALLOWANCE_BYTES;
  const margin = 1024 * 1024;
  const shard = 65_536;
  const exactFit = input([request('1', 1)], { aggregateBytes: fixed + margin + shard,
    registryControlBytes: margin, shardReservedBytes: shard });
  const plan = planFeatureIndexShards(exactFit);
  assert.equal(plan.fixedRegistryAllowanceBytes, fixed);
  assert.equal(plan.namespaceChargeBytes, fixed + margin + shard);
  assert.throws(() => planFeatureIndexShards(input([request('1', 1)], { aggregateBytes: fixed + margin + shard - 1,
    registryControlBytes: margin, shardReservedBytes: shard })), /namespace aggregate quota/i);
});

test('input accessors and duplicate request membership are rejected without getter evaluation', () => {
  const accessor = { ...input([request('1', 1)]) } as Record<string, unknown>;
  let read = false;
  Object.defineProperty(accessor, 'policy', { enumerable: true, get() { read = true; return policy(); } });
  assert.throws(() => planFeatureIndexShards(accessor), /data properties/i);
  assert.equal(read, false);
  assert.throws(() => planFeatureIndexShards(input([request('1', 2), request('1', 3)])), /duplicate request hash/i);
});

test('quota-only edits cannot mint new shard identities and retained plan pins reject coherent alternatives', () => {
  const source = input([request('1', 100), request('2', 100)]);
  const original = encodeFeatureIndexShardPlan(source);
  const changedQuota = encodeFeatureIndexShardPlan({ ...source, policy: { ...source.policy,
    aggregateBytes: 128 * 1024 * 1024, shardReservedBytes: 4 * 1024 * 1024 } });
  assert.deepEqual(changedQuota.plan.shards.map(shard => shard.id), original.plan.shards.map(shard => shard.id));
  assert.notEqual(changedQuota.hash, original.hash);
  assert.deepEqual(validateFeatureIndexShardPlan(original.plan, original.hash), original.plan);
  assert.throws(() => validateFeatureIndexShardPlan(changedQuota.plan, original.hash), /externally retained immutable hash/i);
  const changedCapture = planFeatureIndexShards({ ...source,
    requests: source.requests.map((unit, ordinal) => ordinal ? unit : { ...unit, captureInputHash: h('a') }) });
  assert.notEqual(changedCapture.shards[0]!.id, original.plan.shards[0]!.id);
});

test('receipt request count is checked before traversing hostile oversized membership', () => {
  const plan = planFeatureIndexShards(input([request('1', 100)]));
  let read = false;
  const requests = new Array(4097);
  Object.defineProperty(requests, '0', { enumerable: true, get() { read = true; return request('1', 1); } });
  assert.throws(() => validateFeatureIndexShardPlan({ ...plan, requests }), /request\/shard count limits/i);
  assert.equal(read, false);
});
