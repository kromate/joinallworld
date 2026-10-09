import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalJson, sha256 } from './pack.ts';
import { prepareFeatureIndexShardBinding } from './feature-index-session.ts';
import { encodeFeatureIndexShardPlan, type FeatureIndexShardPlanInput } from './index-shard-plan.ts';

// Runs on the pinned remote diagnostic runtime. No source rows, registry, roots,
// network or game data are opened by this pure cross-language comparison.
const python = process.env.WORLD_TEST_PYTHON;
const tooling = fileURLToPath(new URL('./tooling/', import.meta.url));
const MiB = 1024 * 1024;
const base = Buffer.from(canonicalJson({
  format: 'feature-index-binding-v1', engineVersion: 'complete-feature-index-v1',
  identityVersion: 'overture-complete-feature-owner-v1', captureVersion: 'overture-pinned-capture-v1',
  sourceCompiler: 'world-source-compiler-v2',
  source: { provider: 'overture', release: '2026-01-21.0', layers: ['buildings', 'roads'],
    configuration: { sha256: 'c'.repeat(64), bytes: 1297 } },
  toolingManifest: { sha256: 'd'.repeat(64), bytes: 2000 },
  runtime: { nodeVersion: 'v22.19.0', sqliteVersion: '3.50.4', nodeSha256: 'e'.repeat(64), nodeBytes: 160 * MiB },
  engineLimits: { databaseBytes: MiB, captures: 256, occurrences: 4000, versions: 3000, observations: 2048 },
  processLimits: { fileBytes: MiB, cpuSeconds: 10, wallSeconds: 15, heapMiB: 256, rssBytes: 96 * MiB },
  reservedBytes: 16 * MiB,
}), 'ascii');

const reader = String.raw`
import hashlib,json,resource,sys
resource.setrlimit(resource.RLIMIT_CORE,(0,0))
resource.setrlimit(resource.RLIMIT_CPU,(10,10))
resource.setrlimit(resource.RLIMIT_FSIZE,(65536,65536))
resource.setrlimit(resource.RLIMIT_NOFILE,(64,64))
sys.path.insert(0,sys.argv[1])
from index_registry_worker import validate_shard_plan
data=sys.stdin.buffer.read(2097152+4096+5)
if len(data)<5 or len(data)>2097152+4096+4: raise ValueError('fixture input bound')
size=int.from_bytes(data[:4],'big')
if not 1<=size<=4096: raise ValueError('fixture base bound')
result=validate_shard_plan(data[4+size:],{'sha256':sys.argv[2],'bytes':int(sys.argv[3])},data[4:4+size])
canonical=json.dumps(result['plan'],sort_keys=True,separators=(',',':')).encode('ascii')
report={'planHash':hashlib.sha256(canonical).hexdigest(),'requestCount':result['plan']['requestCount'],
        'reservations':[dict(row,bindingBytes=row['bindingBytes'].decode('ascii')) for row in result['reservations']]}
out=json.dumps(report,sort_keys=True,separators=(',',':'))
if len(out.encode('ascii'))>65536: raise ValueError('fixture report bound')
print(out)
`;

function input(count: number, maxCaptures: number, descriptorBytes: number, charges?: number[]): FeatureIndexShardPlanInput {
  return {
    format: 'feature-index-shard-plan-input-v1',
    bindings: { campaignHash: 'a'.repeat(64), countryGridPlanHash: 'b'.repeat(64),
      sourceConfigurationHash: 'c'.repeat(64), toolingManifestHash: 'd'.repeat(64), baseIndexBindingHash: sha256(base) },
    policy: { aggregateBytes: 512 * MiB, registryControlBytes: MiB, shardReservedBytes: 16 * MiB,
      maxCaptures, descriptorBytes, envelopeOverheadBytes: 100, maxShards: 256, maxAttempts: 8 },
    requests: Array.from({ length: count }, (_, i) => ({ requestHash: (i + 1).toString(16).padStart(64, '0'),
      captureInputHash: sha256(`capture-${i}`), requiredObservationSetHash: sha256(`contexts-${i}`),
      requiredObservationCount: i % 8 + 1, auditDescriptorBytes: charges?.[i] ?? 200 })).reverse(),
  };
}

function compare(value: FeatureIndexShardPlanInput, expectedCounts: number[]) {
  assert.ok(python && python.startsWith('/'), 'WORLD_TEST_PYTHON must pin the diagnostic Python executable.');
  const encoded = encodeFeatureIndexShardPlan(value);
  assert.deepEqual(encoded.plan.shards.map(shard => shard.requestCount), expectedCounts);
  const prefix = Buffer.alloc(4); prefix.writeUInt32BE(base.byteLength);
  const result = spawnSync(python, ['-I', '-B', '-c', reader, tooling, encoded.hash, String(encoded.bytes.byteLength)], {
    input: Buffer.concat([prefix, base, encoded.bytes]), timeout: 15_000, maxBuffer: 65_536,
    env: { PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8',
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const actual = JSON.parse(result.stdout);
  const reservations = encoded.plan.shards.map(shard => {
    const binding = prepareFeatureIndexShardBinding(base, { planHash: encoded.hash,
      shardId: sha256(shard.id), membershipHash: sha256(canonicalJson(shard.requestHashes)),
      baseIndexBindingHash: sha256(base) });
    return { indexHash: binding.indexHash, bindingBytes: Buffer.from(binding.bytes).toString('ascii'), reservedBytes: 16 * MiB };
  }).sort((a, b) => a.indexHash.localeCompare(b.indexHash));
  assert.deepEqual(actual, { planHash: encoded.hash, requestCount: value.requests.length, reservations });
}

test('Python recomputes actual TypeScript greedy plans and exact child bindings across both partition constraints', () => {
  compare(input(5, 4, 1000, [600, 400, 300, 700, 250]), [2, 2, 1]);
  compare(input(5, 2, 1000, [100, 100, 100, 100, 100]), [2, 2, 1]);
});

test('Python recomputes all 4096 requests from the actual TypeScript encoder without dropping any shard or member', () => {
  compare(input(4096, 256, 100_000), Array(16).fill(256));
});
