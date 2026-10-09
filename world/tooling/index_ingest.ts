// Fixed, pinned-input capture ingestion for an already charged feature index.
// This is not acquisition, observation ingestion, campaign completion or coverage.
import assert from 'node:assert/strict';
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { bindConfiguredCapture, type CaptureExpectation } from '../capture-binding.ts';
import { parseCaptureJson } from '../capture-json.ts';
import { sha256 } from '../pack.ts';
import { FeatureIndex, type FeatureIndexLimits, type FeatureIndexCaptureResult } from '../feature-index.ts';
import { bootstrapFeatureIndex } from './index_bootstrap.ts';

const SHA256 = /^[a-f0-9]{64}$/;
const nofollow = constants.O_NOFOLLOW | constants.O_NONBLOCK;

interface BigIdentity {
  dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint;
  uid: bigint; mode: bigint; nlink: bigint; isFile(): boolean;
}
interface Pin { sha256: string; bytes: number }
interface CaptureEnvelope {
  format: 'feature-index-ingest-input-v1';
  expected: CaptureExpectation;
  extractDescriptor: number;
  receiptDescriptor: number;
}
interface FeatureBinding {
  source: { provider: string; release: string; layers: string[]; configuration: Pin };
  engineLimits: FeatureIndexLimits;
}

function exactObject(value: unknown, keys: string[], label: string): Record<string, unknown> {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object.`);
  const object = value as Record<string, unknown>;
  assert.deepEqual(Reflect.ownKeys(object).sort(), [...keys].sort(), `${label} fields differ.`);
  return object;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  assert.ok(typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    `${label} is outside its fixed integer bound.`);
  return value;
}

function pin(value: unknown, maximum: number, label: string): Pin {
  const item = exactObject(value, ['sha256', 'bytes'], `${label} pin`);
  assert.ok(typeof item.sha256 === 'string' && SHA256.test(item.sha256), `${label} SHA-256 is invalid.`);
  return { sha256: item.sha256, bytes: integer(item.bytes, 1, maximum, `${label} bytes`) };
}

function descriptor(raw: string | undefined, label: string): number {
  assert.ok(raw !== undefined && /^[0-9]{1,10}$/.test(raw), `${label} must be a bounded decimal descriptor.`);
  return integer(Number(raw), 3, 2147483647, label);
}

function stable(info: BigIdentity): string {
  return [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs,
    info.uid, info.mode, info.nlink].join(':');
}

function privateDescriptor(fd: number, maximum: number, label: string): Buffer {
  const before = fstatSync(fd, { bigint: true }) as BigIdentity;
  assert.ok(before.isFile() && before.uid === BigInt(process.getuid!())
    && (before.mode & 0o777n) === 0o600n && before.nlink === 0n
    && before.size > 0n && before.size <= BigInt(maximum),
  `${label} must be an anonymous owned private regular file of bounded size.`);
  const size = Number(before.size);
  const bytes = Buffer.alloc(size + 1);
  let count = 0;
  while (count < bytes.length) {
    const read = readSync(fd, bytes, count, bytes.length - count, count);
    if (read === 0) break;
    count += read;
  }
  const after = fstatSync(fd, { bigint: true }) as BigIdentity;
  assert.equal(stable(after), stable(before), `${label} descriptor changed while reading.`);
  assert.equal(count, size, `${label} changed size while reading.`);
  return bytes.subarray(0, count);
}

function privatePath(file: string, maximum: number, mode: number, label: string): Buffer {
  const fd = openSync(file, constants.O_RDONLY | nofollow);
  try {
    const before = fstatSync(fd, { bigint: true }) as BigIdentity;
    const named = lstatSync(file, { bigint: true }) as BigIdentity;
    assert.ok(before.isFile() && before.uid === BigInt(process.getuid!()) && before.nlink === 1n
      && (before.mode & 0o777n) === BigInt(mode) && before.size > 0n && before.size <= BigInt(maximum),
    `${label} must remain an owned private single-link bounded file.`);
    assert.equal(stable(named), stable(before), `${label} changed during open.`);
    const size = Number(before.size), bytes = Buffer.alloc(size + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = readSync(fd, bytes, count, bytes.length - count, count);
      if (read === 0) break;
      count += read;
    }
    const after = fstatSync(fd, { bigint: true }) as BigIdentity;
    const namedAfter = lstatSync(file, { bigint: true }) as BigIdentity;
    assert.equal(stable(after), stable(before), `${label} descriptor changed while reading.`);
    assert.equal(stable(namedAfter), stable(before), `${label} path changed while reading.`);
    assert.equal(count, size, `${label} changed size while reading.`);
    return bytes.subarray(0, count);
  } finally { closeSync(fd); }
}

function parseEnvelope(bytes: Buffer): CaptureEnvelope {
  const value = parseCaptureJson(bytes, { bytes: 64000, nodes: 20_000, depth: 32 });
  const envelope = exactObject(value,
    ['format', 'expected', 'extractDescriptor', 'receiptDescriptor'], 'Capture envelope');
  assert.equal(envelope.format, 'feature-index-ingest-input-v1');
  const expected = exactObject(envelope.expected,
    ['requestHash', 'request', 'extract', 'receipt'], 'Capture expectations');
  assert.ok(typeof expected.requestHash === 'string' && SHA256.test(expected.requestHash),
    'Expected request hash is invalid.');
  const extract = pin(expected.extract, 20_000_000, 'Extract');
  const receipt = pin(expected.receipt, 1_000_000, 'Receipt');
  return {
    format: 'feature-index-ingest-input-v1',
    expected: { requestHash: expected.requestHash, request: expected.request as CaptureExpectation['request'],
      extract, receipt },
    extractDescriptor: integer(envelope.extractDescriptor, 3, 2147483647, 'Extract descriptor'),
    receiptDescriptor: integer(envelope.receiptDescriptor, 3, 2147483647, 'Receipt descriptor'),
  };
}

function captureBytes(fd: number, expected: Pin, maximum: number, label: string): Buffer {
  const before = fstatSync(fd, { bigint: true }) as BigIdentity;
  assert.ok(before.isFile() && before.uid === BigInt(process.getuid!()) && before.nlink === 1n
    && (before.mode & 0o022n) === 0n && before.size === BigInt(expected.bytes)
    && before.size <= BigInt(maximum), `${label} descriptor differs from its bounded private pin.`);
  const size = Number(before.size), bytes = Buffer.alloc(size + 1);
  let count = 0;
  while (count < bytes.length) {
    const read = readSync(fd, bytes, count, bytes.length - count, count);
    if (read === 0) break;
    count += read;
  }
  const after = fstatSync(fd, { bigint: true }) as BigIdentity;
  assert.equal(stable(after), stable(before), `${label} descriptor changed while reading.`);
  assert.equal(count, size, `${label} descriptor changed size while reading.`);
  const result = bytes.subarray(0, count);
  assert.equal(sha256(result), expected.sha256, `${label} bytes differ from their pinned SHA-256.`);
  return result;
}

function readBinding(raw: Buffer): FeatureBinding {
  const binding = parseCaptureJson(raw, { bytes: 4096, nodes: 1000, depth: 16 });
  const top = exactObject(binding, ['format', 'engineVersion', 'identityVersion', 'captureVersion',
    'sourceCompiler', 'source', 'toolingManifest', 'runtime', 'engineLimits', 'processLimits', 'reservedBytes'],
  'Feature binding');
  assert.equal(top.format, 'feature-index-binding-v1');
  const source = exactObject(top.source, ['provider', 'release', 'layers', 'configuration'], 'Binding source');
  assert.ok(typeof source.provider === 'string' && typeof source.release === 'string'
    && Array.isArray(source.layers), 'Binding source identity is invalid.');
  return { source: { provider: source.provider, release: source.release, layers: source.layers as string[],
    configuration: pin(source.configuration, 64000, 'Source configuration') },
    engineLimits: top.engineLimits as FeatureIndexLimits };
}

function validateRootAndLeases(root: string, leaseFd: number, namespaceFd: number): {
  rootInfo: BigIdentity; databasePath: string;
} {
  assert.ok(path.isAbsolute(root) && realpathSync(root) === root, 'Index root must be canonical and absolute.');
  const rootInfo = lstatSync(root, { bigint: true }) as BigIdentity;
  assert.ok(rootInfo.isFile() === false && (rootInfo.mode & 0o170000n) === 0o040000n
    && rootInfo.uid === BigInt(process.getuid!()) && (rootInfo.mode & 0o777n) === 0o700n,
  'Index root must remain an owned private directory.');
  const namespace = path.dirname(root);
  assert.equal(realpathSync(namespace), namespace, 'Namespace root must remain canonical.');
  const namespaceInfo = lstatSync(namespace, { bigint: true }) as BigIdentity;
  assert.ok((namespaceInfo.mode & 0o170000n) === 0o040000n && namespaceInfo.uid === BigInt(process.getuid!())
    && (namespaceInfo.mode & 0o777n) === 0o700n, 'Namespace root must remain private.');
  for (const [fd, directory, label] of [[leaseFd, root, 'Index'], [namespaceFd, namespace, 'Namespace']] as const) {
    const held = fstatSync(fd, { bigint: true }) as BigIdentity;
    const lockPath = path.join(directory, 'writer.lock');
    const named = lstatSync(lockPath, { bigint: true }) as BigIdentity;
    assert.ok(held.isFile() && held.uid === BigInt(process.getuid!()) && held.nlink === 1n
      && (held.mode & 0o777n) === 0o600n && held.size === 0n, `${label} lease descriptor is unsafe.`);
    assert.equal(held.dev, named.dev, `${label} lock device changed.`);
    assert.equal(held.ino, named.ino, `${label} lock inode changed.`);
  }
  return { rootInfo, databasePath: path.join(root, 'features.sqlite') };
}

function privateDatabase(file: string, maximum: number): BigIdentity {
  const info = lstatSync(file, { bigint: true }) as BigIdentity;
  assert.ok(info.isFile() && info.uid === BigInt(process.getuid!()) && info.nlink === 1n
    && (info.mode & 0o777n) === 0o600n && info.size > 0n && info.size <= BigInt(maximum),
  'Final feature database must remain a private bounded regular file.');
  return info;
}

export function ingestFeatureIndex(onBoundary: (name: string) => void = () => {}): Record<string, unknown> {
  const root = process.env.TMPDIR;
  assert.ok(root && path.isAbsolute(root) && realpathSync(root) === root, 'TMPDIR must be the canonical index root.');
  const metadataFd = descriptor(process.env.WORLD_INDEX_CAPTURE_DESCRIPTOR, 'Capture metadata descriptor');
  const expectedMetadataSha = process.env.WORLD_INDEX_CAPTURE_SHA256;
  assert.ok(expectedMetadataSha && SHA256.test(expectedMetadataSha), 'Capture metadata SHA-256 is invalid.');
  const leaseFd = descriptor(process.env.WORLD_INDEX_LEASE_DESCRIPTOR, 'Index lease descriptor');
  const namespaceFd = descriptor(process.env.WORLD_INDEX_NAMESPACE_DESCRIPTOR, 'Namespace lease descriptor');
  assert.ok(new Set([metadataFd, leaseFd, namespaceFd]).size === 3,
    'Capture metadata and lease descriptors must be distinct.');

  const metadata = privateDescriptor(metadataFd, 64000, 'Capture metadata');
  const metadataSha = sha256(metadata);
  assert.equal(metadataSha, expectedMetadataSha, 'Capture metadata hash differs from its fixed environment pin.');
  const envelope = parseEnvelope(metadata);
  assert.ok(new Set([metadataFd, envelope.extractDescriptor, envelope.receiptDescriptor, leaseFd, namespaceFd]).size === 5,
    'Capture and lease descriptors must all be distinct.');
  const extractBytes = captureBytes(envelope.extractDescriptor, envelope.expected.extract, 20_000_000, 'Extract');
  const receiptBytes = captureBytes(envelope.receiptDescriptor, envelope.expected.receipt, 1_000_000, 'Receipt');

  const { databasePath } = validateRootAndLeases(root, leaseFd, namespaceFd);
  const configurationPath = fileURLToPath(new URL('../acquisition-sources.json', import.meta.url));
  const sourceConfigurationBytes = privatePath(configurationPath, 64000, 0o400, 'Source configuration');
  const bindingBytes = privatePath(path.join(root, 'binding.json'), 4096, 0o600, 'Index binding');
  assert.equal(sha256(bindingBytes), path.basename(root), 'Binding digest differs from its charged root name.');
  const binding = readBinding(bindingBytes);
  const request = envelope.expected.request as unknown;
  assert.ok(request !== null && typeof request === 'object' && !Array.isArray(request),
    'Capture request must be an object.');
  const requestLayers = (request as Record<string, unknown>).layers;
  assert.ok(Array.isArray(requestLayers) && requestLayers.every(layer => typeof layer === 'string'
    && binding.source.layers.includes(layer)),
  'Capture request layers must be a subset of the admitted binding source layers.');
  assert.equal(sourceConfigurationBytes.length, binding.source.configuration.bytes,
    'Source configuration length differs from its binding pin.');
  assert.equal(sha256(sourceConfigurationBytes), binding.source.configuration.sha256,
    'Source configuration digest differs from its binding pin.');

  // Validate the full capture before bootstrapFeatureIndex can open SQLite or run SQL.
  bindConfiguredCapture(extractBytes, receiptBytes, envelope.expected, {
    bytes: sourceConfigurationBytes, pin: binding.source.configuration,
  });
  const boot = bootstrapFeatureIndex();
  assert.equal(boot.format, 'feature-index-bootstrap-v1');
  assert.equal(boot.indexHash, path.basename(root));
  assert.equal(boot.nodeVersion, process.version);
  assert.equal(boot.sqliteVersion, process.versions.sqlite);

  const leases = validateRootAndLeases(root, leaseFd, namespaceFd);
  const before = privateDatabase(databasePath, binding.engineLimits.databaseBytes);
  const db = new DatabaseSync(databasePath);
  let result: FeatureIndexCaptureResult;
  let stats: ReturnType<FeatureIndex['stats']>;
  try {
    const opened = privateDatabase(databasePath, binding.engineLimits.databaseBytes);
    assert.equal(opened.dev, before.dev); assert.equal(opened.ino, before.ino);
    const index = new FeatureIndex(db, binding.engineLimits);
    const originalExec = db.exec.bind(db);
    Object.defineProperty(db, 'exec', { configurable: true, writable: true, value: (sql: string) => {
      originalExec(sql);
      if (sql === 'COMMIT') onBoundary('after-commit');
    }});
    onBoundary('before-transaction');
    result = index.ingest({ extractBytes, receiptBytes, expected: envelope.expected,
      sourceConfiguration: { bytes: sourceConfigurationBytes, pin: binding.source.configuration } });
    onBoundary('after-checkpoint');
    stats = index.stats();
    assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally {
    db.close();
  }
  const after = privateDatabase(databasePath, binding.engineLimits.databaseBytes);
  assert.equal(after.dev, before.dev); assert.equal(after.ino, before.ino);
  assert.equal(realpathSync(root), root);
  const rootAfter = lstatSync(root, { bigint: true }) as BigIdentity;
  assert.equal(rootAfter.dev, leases.rootInfo.dev); assert.equal(rootAfter.ino, leases.rootInfo.ino);
  validateRootAndLeases(root, leaseFd, namespaceFd);
  const maximumRssKiB = process.resourceUsage().maxRSS;
  assert.ok(Number.isSafeInteger(maximumRssKiB) && maximumRssKiB > 0, 'Maximum RSS is unavailable.');
  return {
    format: 'feature-index-ingest-v1',
    indexHash: path.basename(root),
    inputSha256: metadataSha,
    nodeVersion: process.version,
    sqliteVersion: process.versions.sqlite,
    result,
    stats,
    databaseBytes: Number(after.size),
    maximumRssKiB,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 2, 'Capture ingestion accepts no command-line arguments.');
  console.log(JSON.stringify(ingestFeatureIndex()));
}
