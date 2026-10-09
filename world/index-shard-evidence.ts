import { featureIndexObservationPin, type FeatureIndexObservation } from './feature-index.ts';
import { asciiJsonLine, prepareFeatureIndexSessionAudit, type FeatureIndexSessionAuditInput } from './feature-index-session.ts';
import type { FeatureIndexShardPlanRequest } from './index-shard-plan.ts';
import type { CaptureBytePin } from './capture-binding.ts';
import { sha256 } from './pack.ts';

const MAX_ATTEMPTS = 8;
const MAX_LINE_BYTES = 128_000;
const MAX_DESCRIPTOR_BYTES = 512_000;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_DATABASE_BYTES = 64 * 1024 * 1024;

export interface FeatureIndexShardAuditDescriptor {
  extractPath: string;
  receiptPath: string;
  expectedBase64: string;
  requiredObservations: FeatureIndexObservation[];
  allowedObservationPins: CaptureBytePin[];
}

export interface PreparedFeatureIndexShardPlanRequest {
  request: FeatureIndexShardPlanRequest;
  input: FeatureIndexSessionAuditInput;
  descriptor: FeatureIndexShardAuditDescriptor;
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Prepare one plan unit from the exact audit input used by the held audit
 * session. Hashes bind ASCII/Python canonical bytes; they are not source or
 * historical-attempt provenance proofs.
 */
export function prepareFeatureIndexShardPlanRequest(
  inputValue: FeatureIndexSessionAuditInput,
  attemptLimit: number,
): PreparedFeatureIndexShardPlanRequest {
  if (!Number.isSafeInteger(attemptLimit) || attemptLimit < 1 || attemptLimit > MAX_ATTEMPTS) {
    throw new RangeError('Shard request attempt limit must be in1..8.');
  }
  const prepared = prepareFeatureIndexSessionAudit([inputValue], attemptLimit);
  const input = prepared.inputs[0]!;
  const contexts = input.requiredObservations;
  if (contexts.length < 1 || contexts.length > MAX_ATTEMPTS || contexts.length > attemptLimit) {
    throw new RangeError('Every prepared required observation needs one durable capture attempt.');
  }

  const expectedBytes = asciiJsonLine(input.expected, 64_001, 'Shard capture expectation').subarray(0, -1);
  const expectedBase64 = expectedBytes.toString('base64');
  const requiredObservations = contexts.map(value => ({ ...value }));
  const allowedObservationPins = contexts.map(featureIndexObservationPin)
    .sort((a, b) => a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : a.bytes - b.bytes)
    .map(value => ({ sha256: value.sha256, bytes: value.bytes }));
  const descriptor: FeatureIndexShardAuditDescriptor = {
    extractPath: input.extractPath,
    receiptPath: input.receiptPath,
    expectedBase64,
    requiredObservations,
    allowedObservationPins,
  };
  const descriptorLine = asciiJsonLine(descriptor, MAX_DESCRIPTOR_BYTES + 1, 'Shard audit descriptor');
  const auditDescriptorBytes = descriptorLine.byteLength; // canonical descriptor bytes plus its LF/comma allowance
  if (auditDescriptorBytes > MAX_DESCRIPTOR_BYTES) throw new RangeError('Shard audit descriptor exceeds512000 bytes.');

  const durableCaptureInput = {
    expected: { sha256: sha256(expectedBytes), bytes: expectedBytes.byteLength },
    extractPath: input.extractPath,
    receiptPath: input.receiptPath,
  };
  const captureInputHash = sha256(asciiJsonLine(durableCaptureInput, MAX_LINE_BYTES, 'Durable capture input').subarray(0, -1));
  const requiredObservationSetHash = sha256(asciiJsonLine(contexts, MAX_LINE_BYTES, 'Required observation set').subarray(0, -1));
  const request: FeatureIndexShardPlanRequest = {
    requestHash: input.expected.requestHash,
    captureInputHash,
    requiredObservationSetHash,
    requiredObservationCount: contexts.length,
    auditDescriptorBytes,
  };

  // The audit wire uses an ordinal (0..255); the ingest wire uses a numeric
  // id. Check worst legal values, and every required context, before planning.
  asciiJsonLine({ format: 'feature-index-session-audit-capture-v1', id: Number.MAX_SAFE_INTEGER, ordinal: 255,
    ...input }, MAX_LINE_BYTES, 'Shard audit capture frame');
  for (const observation of contexts) {
    asciiJsonLine({ format: 'feature-index-session-capture-v1', id: Number.MAX_SAFE_INTEGER,
      extractPath: input.extractPath, receiptPath: input.receiptPath, expected: input.expected, observation },
    MAX_LINE_BYTES, 'Shard capture ingest frame');
  }

  return freezeDeep({ request, input, descriptor });
}

function boundedInteger(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} is outside its fixed bound.`);
  }
  return value;
}

/**
 * Return an upper bound for the fixed Python audit envelope wrapper, including
 * one byte of descriptor-list separator allowance. Device/inode are quoted
 * 19-digit strings here, which conservatively costs two extra bytes each
 * versus the actual non-negative JSON integers.
 */
export function calculateFeatureIndexShardEnvelopeOverhead(
  namespaceRoot: string,
  fileBytes: number,
  databaseBytes: number,
): number {
  boundedInteger(fileBytes, 65_536, MAX_FILE_BYTES, 'Shard process file limit');
  boundedInteger(databaseBytes, 65_536, MAX_DATABASE_BYTES, 'Shard database limit');
  if (databaseBytes % 4096 !== 0 || databaseBytes > fileBytes) {
    throw new RangeError('Shard database limit must be page-aligned and no greater than the process file limit.');
  }
  if (typeof namespaceRoot !== 'string' || namespaceRoot.length > 4096 || !namespaceRoot.startsWith('/')
      || (namespaceRoot !== '/' && namespaceRoot.endsWith('/')) || namespaceRoot.includes('\\')
      || /[\u0000-\u001f\u007f]/.test(namespaceRoot) || namespaceRoot.includes('//')
      || namespaceRoot.split('/').some(part => part === '.' || part === '..')
      || Buffer.byteLength(namespaceRoot, 'utf8') > 4096 || !/^[\x00-\x7f]*$/.test(namespaceRoot)) {
    throw new TypeError('Shard namespace root must be a bounded canonical absolute POSIX path.');
  }
  const digest = 'f'.repeat(64);
  const snapshotPath = `${namespaceRoot === '/' ? '' : namespaceRoot}/${digest}/audit.execution`;
  const wrapper = {
    format: 'feature-index-audit-input-v1',
    indexHash: digest,
    captureRecord: { sha256: digest, bytes: MAX_DESCRIPTOR_BYTES },
    snapshotRoot: { path: snapshotPath, device: '9'.repeat(19), inode: '9'.repeat(19) },
    database: { sha256: digest, bytes: databaseBytes },
    wal: { sha256: digest, bytes: fileBytes },
    captures: [],
  };
  return asciiJsonLine(wrapper, 100_000, 'Shard audit envelope overhead').byteLength + 1;
}
