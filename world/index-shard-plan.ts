import { canonicalJson, sha256 } from './pack.ts';

export const FEATURE_INDEX_SHARD_PLAN_INPUT_FORMAT = 'feature-index-shard-plan-input-v1';
export const FEATURE_INDEX_SHARD_PLAN_FORMAT = 'feature-index-shard-plan-v1';
export const FEATURE_INDEX_SHARD_ID_FORMAT = 'feature-index-shard-id-v1';
export const FEATURE_INDEX_SHARD_PLAN_MAX_BYTES = 2 * 1024 * 1024;
export const FEATURE_INDEX_SHARD_PLAN_MAX_REQUESTS = 4096;
export const FEATURE_INDEX_REGISTRY_ALLOWANCE_BYTES = 17 * 1024 * 1024;

const MAX_AGGREGATE = 512 * 1024 * 1024;
const MAX_REGISTRY = 1024 * 1024;
const MAX_DESCRIPTOR_ENVELOPE = 512_000;
const MAX_SHARD_CAPTURES = 256;
const MAX_SHARDS = 256;
const MAX_ATTEMPTS = 8;
const MAX_NODES = 150_000;
const MAX_DEPTH = 16;
const SHA256 = /^[a-f0-9]{64}$/;

export interface FeatureIndexShardPlanRequest {
  requestHash: string;
  captureInputHash: string;
  requiredObservationSetHash: string;
  requiredObservationCount: number;
  /** Prepared ASCII descriptor charge including one array separator; runtime independently verifies it. */
  auditDescriptorBytes: number;
}

export interface FeatureIndexShardPlanInput {
  format: typeof FEATURE_INDEX_SHARD_PLAN_INPUT_FORMAT;
  bindings: {
    campaignHash: string;
    countryGridPlanHash: string;
    sourceConfigurationHash: string;
    toolingManifestHash: string;
    baseIndexBindingHash: string;
  };
  policy: {
    aggregateBytes: number;
    registryControlBytes: number;
    shardReservedBytes: number;
    maxCaptures: number;
    descriptorBytes: number;
    envelopeOverheadBytes: number;
    maxShards: number;
    maxAttempts: number;
  };
  requests: FeatureIndexShardPlanRequest[];
}

export interface FeatureIndexShardPlanShard {
  id: string;
  ordinal: number;
  requestHashes: string[];
  requestCount: number;
  descriptorBytes: number;
  envelopeBytes: number;
  requiredObservationCount: number;
  reservedBytes: number;
}

export interface FeatureIndexShardPlan {
  format: typeof FEATURE_INDEX_SHARD_PLAN_FORMAT;
  inputFormat: typeof FEATURE_INDEX_SHARD_PLAN_INPUT_FORMAT;
  scope: 'namespace-batch';
  admission: 'not-admitted';
  geometryCoverage: 'not-compiled';
  occupancy: 'not-checked';
  fixedRegistryAllowanceBytes: number;
  bindings: FeatureIndexShardPlanInput['bindings'];
  policy: FeatureIndexShardPlanInput['policy'];
  requestCount: number;
  requiredObservationCount: number;
  descriptorBytes: number;
  membershipSha256: string;
  requests: FeatureIndexShardPlanRequest[];
  shards: FeatureIndexShardPlanShard[];
  namespaceChargeBytes: number;
}

function exact(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) {
    throw new TypeError(`${label} has missing or unknown fields.`);
  }
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      throw new TypeError(`${label} fields must be enumerable data properties.`);
    }
    Object.defineProperty(output, key, { value: descriptor.value, enumerable: true, writable: true, configurable: true });
  }
  return output;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} is outside its fixed integer bound.`);
  }
  return value;
}
function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`${label} must be a lowercase SHA-256.`);
  return value;
}

function chargeString(value: string, budget: { bytes: number }, label: string): void {
  const charge = (bytes: number) => {
    budget.bytes -= bytes;
    if (budget.bytes < 0) throw new RangeError(`${label} exceeds its bounded canonical JSON byte limit.`);
  };
  charge(2);
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

/** Bounded JSON copy used for externally supplied plan receipts. */
function boundedClone(value: unknown, label: string, budget = { nodes: MAX_NODES, bytes: FEATURE_INDEX_SHARD_PLAN_MAX_BYTES }, seen = new Set<object>(), depth = 0): unknown {
  if (depth > MAX_DEPTH || --budget.nodes < 0) throw new RangeError(`${label} exceeds its bounded depth/node limit.`);
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError(`${label} contains a non-finite number.`);
    budget.bytes -= JSON.stringify(value).length;
    if (budget.bytes < 0) throw new RangeError(`${label} exceeds its bounded canonical JSON byte limit.`);
    return value;
  }
  if (typeof value === 'string') { chargeString(value, budget, label); return value; }
  if (!value || typeof value !== 'object' || seen.has(value)) throw new TypeError(`${label} must be acyclic JSON data.`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const length = value.length;
      if (length > MAX_NODES || length > budget.nodes) throw new RangeError(`${label} exceeds its bounded array/node limit.`);
      const keys = Reflect.ownKeys(value);
      if (keys.length !== length + 1 || keys.some(key => typeof key !== 'string'
          || (key !== 'length' && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)))) {
        throw new TypeError(`${label} array has a hole or extra property.`);
      }
      budget.bytes -= 2 + Math.max(0, length - 1);
      if (budget.bytes < 0) throw new RangeError(`${label} exceeds its bounded canonical JSON byte limit.`);
      const copy: unknown[] = [];
      for (let i = 0; i < length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${label} array has an accessor or hole.`);
        copy.push(boundedClone(descriptor.value, label, budget, seen, depth + 1));
      }
      return copy;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} contains a non-plain object.`);
    const keys = Reflect.ownKeys(value);
    if (keys.length > budget.nodes) throw new RangeError(`${label} exceeds its bounded object/node limit.`);
    budget.bytes -= 2 + Math.max(0, keys.length - 1);
    if (budget.bytes < 0) throw new RangeError(`${label} exceeds its bounded canonical JSON byte limit.`);
    const copy: Record<string, unknown> = {};
    for (const key of keys) {
      if (typeof key !== 'string') throw new TypeError(`${label} contains a symbol key.`);
      chargeString(key, budget, label);
      budget.bytes -= 1;
      if (budget.bytes < 0) throw new RangeError(`${label} exceeds its bounded canonical JSON byte limit.`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${label} contains an accessor or hidden field.`);
      Object.defineProperty(copy, key, { value: boundedClone(descriptor.value, label, budget, seen, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    return copy;
  } finally { seen.delete(value); }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

function normalizeInput(value: unknown): FeatureIndexShardPlanInput {
  // Reject an oversized request array before recursively copying any request values.
  const top = exact(value, ['format', 'bindings', 'policy', 'requests'], 'Shard-plan input');
  if (!Array.isArray(top.requests)) throw new TypeError('Shard-plan requests must be an array.');
  if (top.requests.length > FEATURE_INDEX_SHARD_PLAN_MAX_REQUESTS) throw new RangeError('Shard plan exceeds 4096 request units.');
  const safe = boundedClone(top, 'Shard-plan input') as Record<string, unknown>;
  const root = exact(safe, ['format', 'bindings', 'policy', 'requests'], 'Shard-plan input');
  if (root.format !== FEATURE_INDEX_SHARD_PLAN_INPUT_FORMAT) throw new TypeError('Shard-plan input format differs from the fixed contract.');
  const bindingsValue = exact(root.bindings, ['campaignHash', 'countryGridPlanHash', 'sourceConfigurationHash',
    'toolingManifestHash', 'baseIndexBindingHash'], 'Shard-plan bindings');
  const bindings = {
    campaignHash: hash(bindingsValue.campaignHash, 'Campaign hash'),
    countryGridPlanHash: hash(bindingsValue.countryGridPlanHash, 'Country grid plan hash'),
    sourceConfigurationHash: hash(bindingsValue.sourceConfigurationHash, 'Source configuration hash'),
    toolingManifestHash: hash(bindingsValue.toolingManifestHash, 'Tooling manifest hash'),
    baseIndexBindingHash: hash(bindingsValue.baseIndexBindingHash, 'Base index binding hash'),
  };
  const policyValue = exact(root.policy, ['aggregateBytes', 'registryControlBytes', 'shardReservedBytes', 'maxCaptures',
    'descriptorBytes', 'envelopeOverheadBytes', 'maxShards', 'maxAttempts'], 'Shard-plan policy');
  const policy = {
    aggregateBytes: integer(policyValue.aggregateBytes, 1, MAX_AGGREGATE, 'Aggregate bytes'),
    registryControlBytes: integer(policyValue.registryControlBytes, 1, MAX_REGISTRY, 'Registry control bytes'),
    shardReservedBytes: integer(policyValue.shardReservedBytes, 65_536, MAX_AGGREGATE, 'Shard reserved bytes'),
    maxCaptures: integer(policyValue.maxCaptures, 1, MAX_SHARD_CAPTURES, 'Maximum captures per shard'),
    descriptorBytes: integer(policyValue.descriptorBytes, 1, MAX_DESCRIPTOR_ENVELOPE, 'Descriptor bytes per shard'),
    envelopeOverheadBytes: integer(policyValue.envelopeOverheadBytes, 1, MAX_DESCRIPTOR_ENVELOPE, 'Envelope overhead bytes'),
    maxShards: integer(policyValue.maxShards, 1, MAX_SHARDS, 'Maximum shards'),
    maxAttempts: integer(policyValue.maxAttempts, 1, MAX_ATTEMPTS, 'Maximum attempts'),
  };
  if (policy.descriptorBytes + policy.envelopeOverheadBytes > MAX_DESCRIPTOR_ENVELOPE) {
    throw new RangeError('Descriptor capacity plus frozen envelope overhead exceeds 512000 bytes.');
  }
  if (policy.registryControlBytes > policy.aggregateBytes) throw new RangeError('Registry control charge exceeds the aggregate namespace quota.');
  if (!Array.isArray(root.requests) || root.requests.length > FEATURE_INDEX_SHARD_PLAN_MAX_REQUESTS) {
    throw new RangeError('Shard plan requires at most 4096 request units.');
  }
  const requests: FeatureIndexShardPlanRequest[] = [];
  let inputBytes = Buffer.byteLength(canonicalJson({ format: FEATURE_INDEX_SHARD_PLAN_INPUT_FORMAT, bindings, policy, requests: [] }), 'utf8');
  for (let i = 0; i < root.requests.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(root.requests, String(i));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Shard-plan request array has a hole or accessor.');
    const item = exact(descriptor.value, ['requestHash', 'captureInputHash', 'requiredObservationSetHash',
      'requiredObservationCount', 'auditDescriptorBytes'], `Shard-plan request ${i}`);
    const request = {
      requestHash: hash(item.requestHash, 'Request hash'),
      captureInputHash: hash(item.captureInputHash, 'Capture input hash'),
      requiredObservationSetHash: hash(item.requiredObservationSetHash, 'Required observation set hash'),
      requiredObservationCount: integer(item.requiredObservationCount, 1, 8, 'Required observation count'),
      auditDescriptorBytes: integer(item.auditDescriptorBytes, 1, policy.descriptorBytes, 'Audit descriptor bytes'),
    };
    const itemBytes = Buffer.byteLength(canonicalJson(request), 'utf8');
    inputBytes += itemBytes + (requests.length ? 1 : 0);
    if (inputBytes > FEATURE_INDEX_SHARD_PLAN_MAX_BYTES) throw new RangeError('Shard-plan input exceeds 2 MiB canonical JSON.');
    requests.push(request);
  }
  inputBytes = Buffer.byteLength(canonicalJson({ format: FEATURE_INDEX_SHARD_PLAN_INPUT_FORMAT, bindings, policy,
    requests: requests.slice().sort((a, b) => a.requestHash < b.requestHash ? -1 : a.requestHash > b.requestHash ? 1 : 0) }), 'utf8');
  if (inputBytes > FEATURE_INDEX_SHARD_PLAN_MAX_BYTES) throw new RangeError('Shard-plan input exceeds 2 MiB canonical JSON.');
  requests.sort((a, b) => a.requestHash < b.requestHash ? -1 : a.requestHash > b.requestHash ? 1 : 0);
  for (let i = 1; i < requests.length; i++) if (requests[i - 1]!.requestHash === requests[i]!.requestHash) {
    throw new Error('Shard plan contains a duplicate request hash.');
  }
  return { format: FEATURE_INDEX_SHARD_PLAN_INPUT_FORMAT, bindings, policy, requests };
}

function freezePolicy(policy: FeatureIndexShardPlanInput['policy']): FeatureIndexShardPlanInput['policy'] {
  return { ...policy };
}

function computePlan(input: FeatureIndexShardPlanInput): FeatureIndexShardPlan {
  const requests = input.requests;
  const policy = input.policy;
  const descriptorCapacity = policy.descriptorBytes;
  const groups: FeatureIndexShardPlanRequest[][] = [];
  let group: FeatureIndexShardPlanRequest[] = [];
  let descriptorTotal = 0;
  for (const request of requests) {
    if (request.auditDescriptorBytes > descriptorCapacity) throw new RangeError(`Request ${request.requestHash} cannot fit one shard.`);
    if (group.length && (group.length >= policy.maxCaptures || descriptorTotal + request.auditDescriptorBytes > descriptorCapacity)) {
      groups.push(group); group = []; descriptorTotal = 0;
    }
    group.push(request); descriptorTotal += request.auditDescriptorBytes;
  }
  if (group.length) groups.push(group);
  if (groups.length > policy.maxShards) throw new RangeError('Shard plan exceeds its frozen maximum shard count.');
  const namespaceChargeBytes = FEATURE_INDEX_REGISTRY_ALLOWANCE_BYTES + policy.registryControlBytes
    + groups.length * policy.shardReservedBytes;
  if (!Number.isSafeInteger(namespaceChargeBytes) || namespaceChargeBytes > policy.aggregateBytes) {
    throw new RangeError('Shard reservations and registry controls exceed the namespace aggregate quota.');
  }
  const membershipSha256 = sha256(canonicalJson(requests));
  const shards: FeatureIndexShardPlanShard[] = groups.map((members, ordinal) => {
    const memberHashes = members.map(member => member.requestHash);
    const descriptorBytes = members.reduce((sum, member) => sum + member.auditDescriptorBytes, 0);
    const requiredObservationCount = members.reduce((sum, member) => sum + member.requiredObservationCount, 0);
    const idHash = sha256(canonicalJson({ format: FEATURE_INDEX_SHARD_ID_FORMAT, bindings: input.bindings,
      membershipSha256, ordinal, requestHashes: memberHashes }));
    return { id: `shard-${String(ordinal).padStart(3, '0')}-${idHash}`, ordinal,
      requestHashes: memberHashes, requestCount: members.length, descriptorBytes,
      envelopeBytes: descriptorBytes + policy.envelopeOverheadBytes, requiredObservationCount,
      reservedBytes: policy.shardReservedBytes };
  });
  const plan: FeatureIndexShardPlan = {
    format: FEATURE_INDEX_SHARD_PLAN_FORMAT, inputFormat: FEATURE_INDEX_SHARD_PLAN_INPUT_FORMAT,
    scope: 'namespace-batch', admission: 'not-admitted', geometryCoverage: 'not-compiled', occupancy: 'not-checked',
    fixedRegistryAllowanceBytes: FEATURE_INDEX_REGISTRY_ALLOWANCE_BYTES,
    bindings: { ...input.bindings }, policy: freezePolicy(policy), requestCount: requests.length,
    requiredObservationCount: requests.reduce((sum, request) => sum + request.requiredObservationCount, 0),
    descriptorBytes: requests.reduce((sum, request) => sum + request.auditDescriptorBytes, 0),
    membershipSha256, requests: requests.map(request => ({ ...request })), shards, namespaceChargeBytes,
  };
  if (canonicalByteLength(plan) > FEATURE_INDEX_SHARD_PLAN_MAX_BYTES) throw new RangeError('Emitted shard plan exceeds 2 MiB canonical JSON.');
  return deepFreeze(plan);
}

function canonicalByteLength(value: unknown, budget = { bytes: FEATURE_INDEX_SHARD_PLAN_MAX_BYTES, nodes: MAX_NODES }, seen = new Set<object>(), depth = 0): number {
  if (depth > MAX_DEPTH || --budget.nodes < 0) throw new RangeError('Emitted plan exceeds fixed depth/node limits.');
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('Emitted plan has a non-finite number.');
    budget.bytes -= JSON.stringify(value).length;
  } else if (typeof value === 'string') chargeString(value, budget, 'Emitted plan');
  else if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);
    try {
      if (Array.isArray(value)) {
        if (value.length > budget.nodes) throw new RangeError('Emitted plan exceeds fixed node limits.');
        const keys = Reflect.ownKeys(value);
        if (keys.length !== value.length + 1) throw new TypeError('Emitted plan array is not dense.');
        budget.bytes -= 2 + Math.max(0, value.length - 1);
        for (let i = 0; i < value.length; i++) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
          if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Emitted plan array has an accessor or hole.');
          canonicalByteLength(descriptor.value, budget, seen, depth + 1);
        }
      } else {
        const keys = Reflect.ownKeys(value);
        if (keys.length > budget.nodes) throw new RangeError('Emitted plan exceeds fixed node limits.');
        budget.bytes -= 2 + Math.max(0, keys.length - 1);
        for (const key of keys) {
          if (typeof key !== 'string') throw new TypeError('Emitted plan has a symbol key.');
          chargeString(key, budget, 'Emitted plan'); budget.bytes--;
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Emitted plan has an accessor or hidden field.');
          canonicalByteLength(descriptor.value, budget, seen, depth + 1);
        }
      }
    } finally { seen.delete(value); }
  } else throw new TypeError('Emitted plan is not finite acyclic JSON data.');
  if (budget.bytes < 0) throw new RangeError('Emitted shard plan exceeds 2 MiB canonical JSON.');
  return FEATURE_INDEX_SHARD_PLAN_MAX_BYTES - budget.bytes;
}

/** Plans a deterministic finite shard batch; it does not admit indexes or compile geometry. */
export function planFeatureIndexShards(input: unknown): FeatureIndexShardPlan {
  return computePlan(normalizeInput(input));
}

/** Recomputes internal consistency. Persisted callers must also supply their independently retained plan hash. */
export function validateFeatureIndexShardPlan(value: unknown, expectedHash?: string): FeatureIndexShardPlan {
  const fields = ['format', 'inputFormat', 'scope', 'admission', 'geometryCoverage', 'occupancy',
    'fixedRegistryAllowanceBytes', 'bindings', 'policy', 'requestCount', 'requiredObservationCount',
    'descriptorBytes', 'membershipSha256', 'requests', 'shards', 'namespaceChargeBytes'];
  const top = exact(value, fields, 'Shard plan receipt');
  if (!Array.isArray(top.requests) || top.requests.length > FEATURE_INDEX_SHARD_PLAN_MAX_REQUESTS
      || !Array.isArray(top.shards) || top.shards.length > MAX_SHARDS) {
    throw new RangeError('Shard plan receipt exceeds its request/shard count limits.');
  }
  if (expectedHash !== undefined) hash(expectedHash, 'Expected immutable plan hash');
  const copy = boundedClone(value, 'Shard plan receipt') as Record<string, unknown>;
  const plan = exact(copy, ['format', 'inputFormat', 'scope', 'admission', 'geometryCoverage', 'occupancy',
    'fixedRegistryAllowanceBytes', 'bindings', 'policy',
    'requestCount', 'requiredObservationCount', 'descriptorBytes', 'membershipSha256', 'requests', 'shards', 'namespaceChargeBytes'], 'Shard plan receipt');
  if (plan.format !== FEATURE_INDEX_SHARD_PLAN_FORMAT || plan.inputFormat !== FEATURE_INDEX_SHARD_PLAN_INPUT_FORMAT
      || plan.scope !== 'namespace-batch' || plan.admission !== 'not-admitted'
      || plan.geometryCoverage !== 'not-compiled' || plan.occupancy !== 'not-checked') {
    throw new TypeError('Shard plan scope/status differs from the fixed planning-only contract.');
  }
  const recomputed = planFeatureIndexShards({ format: plan.inputFormat, bindings: plan.bindings, policy: plan.policy, requests: plan.requests });
  const encoded = canonicalJson(copy);
  if (encoded !== canonicalJson(recomputed)) throw new Error('Shard plan totals or membership differ from deterministic recomputation.');
  if (expectedHash !== undefined && sha256(encoded) !== expectedHash) throw new Error('Shard plan differs from its externally retained immutable hash.');
  return recomputed;
}

/** Encodes the exact deterministic plan as canonical UTF-8 JSON. */
export function encodeFeatureIndexShardPlan(input: unknown): { plan: FeatureIndexShardPlan; hash: string; bytes: Uint8Array } {
  const plan = planFeatureIndexShards(input);
  const encoded = canonicalJson(plan);
  const bytes = Buffer.from(encoded, 'utf8');
  if (bytes.byteLength > FEATURE_INDEX_SHARD_PLAN_MAX_BYTES) throw new RangeError('Encoded shard plan exceeds 2 MiB.');
  return { plan, hash: sha256(bytes), bytes };
}
