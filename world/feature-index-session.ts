import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { constants } from 'node:fs';
import { access, lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { parseCaptureJson } from './capture-json.ts';
import { CAPTURE_BINDING_VERSION, type CaptureBytePin, type CaptureExpectation } from './capture-binding.ts';
import { featureIndexObservationPin, type FeatureIndexCaptureResult, type FeatureIndexObservation, type FeatureIndexStats } from './feature-index.ts';
import { canonicalJson, sha256 } from './pack.ts';

const INIT_FORMAT = 'feature-index-session-init-v1';
const READY_FORMAT = 'feature-index-session-ready-v1';
const CAPTURE_FORMAT = 'feature-index-session-capture-v1';
const RESULT_FORMAT = 'feature-index-session-result-v1';
const CLOSE_FORMAT = 'feature-index-session-close-v1';
const DONE_FORMAT = 'feature-index-session-done-v1';
const MAX_INIT_BYTES = 256_000;
const MAX_LINE_BYTES = 128_000;
const MAX_STDERR_BYTES = 64_000;
const MAX_STDOUT_BYTES = 256 * MAX_LINE_BYTES + 2 * MAX_LINE_BYTES;
const MAX_CAPTURE_JOBS = 256;
const MAX_SESSION_MS = 600_000;
const MAX_PYTHON_COORDINATOR_RSS = 96 * 1024 * 1024;
const MAX_INT = Number.MAX_SAFE_INTEGER;
const SHA = /^[a-f0-9]{64}$/;
const PYTHON_FIELDS = ['pythonVersion', 'sqliteVersion', 'pythonBytes', 'pythonSha256'] as const;

export interface FeatureIndexPythonRuntime {
  pythonVersion: string; sqliteVersion: string; pythonBytes: number; pythonSha256: string;
}
export interface FeatureIndexSessionConfig {
  pythonExecutable: string;
  pythonRuntime: FeatureIndexPythonRuntime;
  nodeExecutable: string;
  namespaceRoot: string;
  aggregateBytes: number;
  repositoryRoot: string;
  manifestBytes: Uint8Array;
  sourceConfiguration: Uint8Array;
  bindingBytes: Uint8Array;
}
export type FeatureIndexSessionConfiguration = FeatureIndexSessionConfig;
export interface PreparedFeatureIndexSessionConfiguration extends FeatureIndexSessionConfig { readonly indexHash: string }
export interface FeatureIndexSessionOptions { signal?: AbortSignal; durationMs?: number }
export interface FeatureIndexCaptureInput {
  extractPath: string; receiptPath: string; expected: CaptureExpectation;
  observation: FeatureIndexObservation | null;
}
export interface FeatureIndexSessionReady { indexHash: string; admission: Record<string, unknown> }
export interface FeatureIndexSession {
  readonly indexHash: string;
  readonly ready: FeatureIndexSessionReady;
  ingestCapture(input: FeatureIndexCaptureInput): Promise<Record<string, unknown>>;
  close(): Promise<{ indexHash: string; captures: number }>;
}

export class FeatureIndexSessionUnreaped extends Error {
  readonly child: ChildProcessWithoutNullStreams;
  readonly processGroup: number;
  constructor(child: ChildProcessWithoutNullStreams, cause: unknown) {
    super('Feature index session process group could not be confirmed terminal; retain its owned handle and all index state.', { cause });
    this.name = 'FeatureIndexSessionUnreaped';
    this.child = child;
    this.processGroup = child.pid ?? -1;
  }
}

/** The subprocess, nested worker, durable record, and pinned inputs were all confirmed terminal. */
export class FeatureIndexSessionTerminated extends Error {
  constructor(cause: unknown) {
    super('Feature index session terminated after a confirmed graceful interruption.', { cause });
    this.name = 'FeatureIndexSessionTerminated';
  }
}

function exactObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || keys.some(key => !own.includes(key))) throw new TypeError(`${label} fields differ from the fixed protocol.`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      throw new TypeError(`${label} fields must be enumerable data properties.`);
    }
  }
  return value as Record<string, unknown>;
}

function cloneJson(value: unknown, label: string, seen = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${label} contains a non-finite number.`);
    return value;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) throw new TypeError(`${label} must be acyclic JSON data.`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      if (Reflect.ownKeys(value).some(key => typeof key === 'symbol')
          || Object.keys(descriptors).some(key => key !== 'length'
            && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))) {
        throw new TypeError(`${label} array has extra properties.`);
      }
      const output: unknown[] = [];
      for (let index = 0; index < value.length; index++) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw new TypeError(`${label} array has a hole or accessor.`);
        output.push(cloneJson(descriptor.value, label, seen));
      }
      return output;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new TypeError(`${label} objects must be plain JSON records.`);
    }
    const output: Record<string, unknown> = {};
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') throw new TypeError(`${label} has a symbol key.`);
      const descriptor = descriptors[key];
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw new TypeError(`${label} has an accessor or hidden field.`);
      Object.defineProperty(output, key, { value: cloneJson(descriptor.value, label, seen), enumerable: true, writable: true, configurable: true });
    }
    return output;
  } finally { seen.delete(value); }
}

function asciiJsonLine(value: unknown, maximum: number, label: string): Buffer {
  const text = canonicalJson(value);
  let ascii = '';
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    ascii += code <= 0x7f ? text[index]! : `\\u${code.toString(16).padStart(4, '0')}`;
  }
  const bytes = Buffer.from(`${ascii}\n`, 'ascii');
  if (bytes.byteLength > maximum) throw new RangeError(`${label} exceeds its fixed line byte bound.`);
  return bytes;
}

/** Strict bounded duplicate-free JSONL frame parser shared by the session and source tests. */
export function parseFeatureIndexSessionLine(bytes: Uint8Array, maximum = MAX_LINE_BYTES): unknown {
  if (!Number.isSafeInteger(maximum) || maximum < 2 || maximum > MAX_INIT_BYTES) throw new RangeError('Feature index session line bound is invalid.');
  if (!(bytes instanceof Uint8Array) || bytes.buffer instanceof SharedArrayBuffer
      || bytes.byteLength < 2 || bytes.byteLength > maximum || bytes[bytes.byteLength - 1] !== 0x0a) {
    throw new RangeError('Feature index session line must be bounded immutable bytes ending in newline.');
  }
  const body = bytes.subarray(0, bytes.byteLength - 1);
  const value = parseCaptureJson(body, { bytes: maximum - 1, nodes: 100_000, depth: 48 });
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Feature index session frame must be a JSON object.');
  return value;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} is outside its strict integer bound.`);
  }
  return value;
}
function sha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA.test(value)) throw new TypeError(`${label} must be a lowercase SHA-256.`);
  return value;
}
function boundedText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(`${label} must be bounded control-free text.`);
  }
  return value;
}
function pin(value: unknown, maximum: number, label: string): CaptureBytePin {
  const item = exactObject(value, ['sha256', 'bytes'], `${label} pin`);
  return { sha256: sha(item.sha256, `${label} hash`), bytes: integer(item.bytes, 1, maximum, `${label} bytes`) };
}
function canonicalAbsolute(value: unknown, label: string): string {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value
      || value.includes('\\') || value.includes('\0') || value.split(path.sep).some(part => part === '.' || part === '..')) {
    throw new TypeError(`${label} must be a canonical absolute path.`);
  }
  if (Buffer.byteLength(value, 'utf8') > 4096 || !/^[\x00-\x7f]*$/.test(value)) throw new TypeError(`${label} must be bounded ASCII path text.`);
  return value;
}

function validatePythonRuntime(value: unknown): FeatureIndexPythonRuntime {
  const runtime = exactObject(value, PYTHON_FIELDS, 'Python runtime pin');
  const pythonVersion = boundedText(runtime.pythonVersion, 32, 'Python version');
  const sqliteVersion = boundedText(runtime.sqliteVersion, 32, 'SQLite version');
  if (!/^[0-9]{1,3}(?:\.[0-9]{1,3}){2}$/.test(pythonVersion)
      || !/^[0-9]{1,3}(?:\.[0-9]{1,3}){2}$/.test(sqliteVersion)) throw new TypeError('Python/SQLite versions are not canonical version strings.');
  return { pythonVersion, sqliteVersion, pythonBytes: integer(runtime.pythonBytes, 1, 256 * 1024 * 1024, 'Python executable bytes'),
    pythonSha256: sha(runtime.pythonSha256, 'Python executable hash') };
}

function validateCaptureInput(value: FeatureIndexCaptureInput): FeatureIndexCaptureInput {
  const input = exactObject(value, ['extractPath', 'receiptPath', 'expected', 'observation'], 'Capture input');
  const extractPath = canonicalAbsolute(input.extractPath, 'Extract path');
  const receiptPath = canonicalAbsolute(input.receiptPath, 'Receipt path');
  if (extractPath === receiptPath) throw new TypeError('Extract and receipt paths must be distinct.');
  const expectedValue = exactObject(input.expected, ['requestHash', 'request', 'extract', 'receipt'], 'Capture expectation');
  const requestHash = sha(expectedValue.requestHash, 'Capture request hash');
  const request = cloneJson(expectedValue.request, 'Capture request');
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new TypeError('Capture request must be a JSON object.');
  const expected = { requestHash, request, extract: pin(expectedValue.extract, 20_000_000, 'Extract'),
    receipt: pin(expectedValue.receipt, 1_000_000, 'Receipt') } as CaptureExpectation;
  let observation: FeatureIndexObservation | null = null;
  if (input.observation !== null) {
    const obs = exactObject(input.observation, ['campaignHash', 'planHash', 'jobId', 'rootCellId', 'queryPath'], 'Observation');
    observation = {
      campaignHash: boundedText(obs.campaignHash, 64, 'Campaign hash'), planHash: boundedText(obs.planHash, 64, 'Plan hash'),
      jobId: boundedText(obs.jobId, 512, 'Observation job ID'), rootCellId: boundedText(obs.rootCellId, 128, 'Observation root cell'),
      queryPath: typeof obs.queryPath === 'string' ? obs.queryPath : (() => { throw new TypeError('Observation query path must be text.'); })(),
    };
    featureIndexObservationPin(observation);
  }
  return { extractPath, receiptPath, expected, observation };
}

type PythonBinding = {
  toolingManifest: CaptureBytePin; source: { configuration: CaptureBytePin };
  runtime: { nodeVersion: string; sqliteVersion: string; nodeBytes: number; nodeSha256: string }; reservedBytes: number;
};
type SessionProcessLimits = { fileBytes: number; cpuSeconds: number; wallSeconds: number; heapMiB: number; rssBytes: number;
  engineLimits: { databaseBytes: number; captures: number; occurrences: number; versions: number; observations: number } };
type PreparedData = { config: FeatureIndexSessionConfig; runtime: FeatureIndexPythonRuntime; bindingValue: Record<string, unknown>;
  binding: PythonBinding; indexHash: string; manifest: Record<string, unknown> };
const PREPARED_CONFIGURATIONS = new WeakMap<object, PreparedData>();

function decodeCanonical(bytes: Uint8Array, label: string): Record<string, unknown> {
  const parsed = parseCaptureJson(bytes, { bytes: 4096, nodes: 2_000, depth: 24 });
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError(`${label} must be a JSON object.`);
  if (canonicalJson(parsed) !== new TextDecoder('utf-8', { fatal: true }).decode(bytes)) throw new TypeError(`${label} must use canonical JSON bytes.`);
  return parsed as Record<string, unknown>;
}

function validateBinding(value: Record<string, unknown>): PythonBinding {
  exactObject(value, ['format', 'engineVersion', 'identityVersion', 'captureVersion', 'sourceCompiler', 'source',
    'toolingManifest', 'runtime', 'engineLimits', 'processLimits', 'reservedBytes'], 'Index binding');
  if (value.format !== 'feature-index-binding-v1' || value.engineVersion !== 'complete-feature-index-v1'
      || value.identityVersion !== 'overture-complete-feature-owner-v1' || value.captureVersion !== 'overture-pinned-capture-v1'
      || value.sourceCompiler !== 'world-source-compiler-v2') throw new TypeError('Index binding versions differ from the fixed engine contract.');
  const source = exactObject(value.source, ['provider', 'release', 'layers', 'configuration'], 'Binding source');
  const runtime = exactObject(value.runtime, ['nodeVersion', 'sqliteVersion', 'nodeSha256', 'nodeBytes'], 'Bound Node runtime');
  const reservedBytes = integer(value.reservedBytes, 65536, 512 * 1024 * 1024, 'Index reservation');
  if (source.provider !== 'overture' || typeof source.release !== 'string'
      || !/^\d{4}-\d{2}-\d{2}\.\d{1,3}$/.test(source.release)) throw new TypeError('Index source provider or release differs from the fixed Overture contract.');
  if (!Array.isArray(source.layers) || ![['buildings'], ['roads'], ['buildings', 'roads']].some(layers => canonicalJson(layers) === canonicalJson(source.layers))) {
    throw new TypeError('Index source layers must be a canonical non-empty Overture layer set.');
  }
  if (typeof runtime.nodeVersion !== 'string' || !/^v22\.\d{1,3}\.\d{1,3}$/.test(runtime.nodeVersion)
      || typeof runtime.sqliteVersion !== 'string' || !/^3\.\d{1,3}\.\d{1,3}$/.test(runtime.sqliteVersion)) {
    throw new TypeError('Bound Node/SQLite runtime versions differ from the fixed engine contract.');
  }
  const engineLimits = exactObject(value.engineLimits,
    ['databaseBytes', 'captures', 'occurrences', 'versions', 'observations'], 'Engine limits');
  const processLimits = validateBindingProcess(value);
  const databaseBytes = integer(engineLimits.databaseBytes, 65_536, 64 * 1024 * 1024, 'Database limit');
  if (databaseBytes % 4096 !== 0 || databaseBytes > processLimits.fileBytes || processLimits.fileBytes > reservedBytes) {
    throw new RangeError('Database, process-file, and reservation limits are contradictory.');
  }
  const minimumCaptureReservation = 4 * processLimits.fileBytes + 2 * 512_000 + 3 * 1024 * 1024 + 65_536;
  if (reservedBytes < minimumCaptureReservation) throw new RangeError('Index reservation cannot hold durable capture state and sidecars.');
  return { toolingManifest: pin(value.toolingManifest, 64_000, 'Tooling manifest'),
    source: { configuration: pin(source.configuration, 64_000, 'Source configuration') },
    runtime: { nodeVersion: runtime.nodeVersion,
      sqliteVersion: runtime.sqliteVersion,
      nodeBytes: integer(runtime.nodeBytes, 1, 256 * 1024 * 1024, 'Node executable bytes'),
      nodeSha256: sha(runtime.nodeSha256, 'Node executable hash') }, reservedBytes };
}

function decodeManifest(bytes: Uint8Array, expected: CaptureBytePin): Record<string, unknown> {
  if (bytes.byteLength !== expected.bytes || sha256(bytes) !== expected.sha256) throw new Error('Tooling manifest bytes differ from the binding pin.');
  const value = parseCaptureJson(bytes, { bytes: 64_000, nodes: 10_000, depth: 16 });
  const manifest = exactObject(value, ['format', 'files'], 'Tooling manifest');
  if (manifest.format !== 'feature-index-tooling-inputs-v1') throw new TypeError('Tooling manifest format is unsupported.');
  if (canonicalJson(value) !== new TextDecoder('utf-8', { fatal: true }).decode(bytes)) throw new TypeError('Tooling manifest must use canonical JSON bytes.');
  const files = manifest.files;
  if (!files || typeof files !== 'object' || Array.isArray(files) || Object.keys(files).length < 1 || Object.keys(files).length > 128) throw new TypeError('Tooling manifest file pins must be a bounded object.');
  for (const [name, value] of Object.entries(files as Record<string, unknown>)) {
    if (!name.startsWith('world/') || name.includes('..') || name.includes('\\') || !/^[\x21-\x7e]+$/.test(name)) throw new TypeError('Tooling manifest contains a noncanonical source path.');
    pin(value, 1_048_576, `Tooling source ${name}`);
  }
  const admission = exactObject((files as Record<string, unknown>)['world/tooling/index_admission.py'], ['sha256', 'bytes'], 'Admission CLI source pin');
  pin(admission, 1_048_576, 'Admission CLI source');
  return { ...manifest, files: files as Record<string, unknown>, admission };
}

function identity(info: Awaited<ReturnType<typeof lstat>>): string {
  return [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs, info.uid, info.mode, info.nlink].join(':');
}

async function verifyPinnedFile(filename: string, expected: CaptureBytePin, label: string, executable = false): Promise<string> {
  const canonical = canonicalAbsolute(filename, `${label} path`);
  const info = await lstat(canonical);
  const resolved = await realpath(canonical);
  if (resolved !== canonical || info.isSymbolicLink() || !info.isFile() || info.nlink !== 1
      || (info.uid !== 0 && info.uid !== process.getuid?.()) || (info.mode & 0o022) !== 0
      || (executable && ((info.mode & 0o111) === 0 || !(await access(canonical, constants.X_OK).then(() => true, () => false))))
      || info.size !== expected.bytes || expected.bytes < 1 || expected.bytes > 256 * 1024 * 1024) {
    throw new TypeError(`${label} file is not a canonical owned file matching its pin.`);
  }
  const before = identity(info), bytes = await readFile(canonical), after = await lstat(canonical);
  if (bytes.byteLength !== expected.bytes || sha256(bytes) !== expected.sha256 || identity(after) !== before) {
    throw new Error(`${label} bytes/inode changed or differ from their retained pin.`);
  }
  return canonical;
}

async function verifyRepositoryRoot(rootValue: string): Promise<string> {
  const root = canonicalAbsolute(rootValue, 'Repository root');
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(root) !== root) throw new TypeError('Repository root must be a canonical real directory.');
  return root;
}

function admissionReady(value: unknown, indexHash: string, reservedBytes: number): FeatureIndexSessionReady {
  const frame = exactObject(value, ['format', 'indexHash', 'admission'], 'Session ready');
  if (frame.format !== READY_FORMAT || frame.indexHash !== indexHash) throw new Error('Session ready identity differs from the pinned binding.');
  const admission = exactObject(frame.admission,
    ['indexHash', 'reservedBytes', 'replayed', 'rootDevice', 'rootInode', 'lockDevice', 'lockInode'], 'Admission report');
  if (admission.indexHash !== indexHash || admission.reservedBytes !== reservedBytes || typeof admission.replayed !== 'boolean') {
    throw new Error('Admission report differs from its index binding.');
  }
  for (const key of ['rootDevice', 'lockDevice']) integer(admission[key], 0, MAX_INT, key);
  for (const key of ['rootInode', 'lockInode']) integer(admission[key], 1, MAX_INT, key);
  return { indexHash, admission };
}

function validateFootprint(value: unknown, aggregateLimit: number, label: string): Record<string, unknown> {
  const report = exactObject(value, ['scope', 'files', 'logicalBytes', 'chargedBytes', 'directoryAllocatedBytes', 'aggregateLimitBytes'], label);
  boundedText(report.scope, 128, `${label} scope`);
  if (!report.files || typeof report.files !== 'object' || Array.isArray(report.files)) throw new TypeError(`${label} files must be a record.`);
  integer(report.logicalBytes, 0, aggregateLimit, `${label} logical bytes`);
  integer(report.chargedBytes, 0, aggregateLimit, `${label} charged bytes`);
  integer(report.directoryAllocatedBytes, 0, aggregateLimit, `${label} directory bytes`);
  if (report.aggregateLimitBytes !== aggregateLimit) throw new Error(`${label} aggregate differs from its immutable allowance.`);
  const files = report.files as Record<string, unknown>;
  const names = Object.keys(files);
  if (names.length > 32) throw new RangeError(`${label} contains too many inventoried files.`);
  let logical = 0, charged = integer(report.directoryAllocatedBytes, 0, aggregateLimit, `${label} directory bytes`);
  for (const name of names) {
    if (!name || name.length > 128) throw new TypeError(`${label} contains an invalid file name.`);
    const entry = exactObject(files[name], ['logicalBytes', 'allocatedBytes'], `${label} file ${name}`);
    const fileLogical = integer(entry.logicalBytes, 0, aggregateLimit, `${label} file logical bytes`);
    const fileAllocated = integer(entry.allocatedBytes, 0, aggregateLimit, `${label} file allocated bytes`);
    logical += fileLogical; charged += Math.max(fileLogical, fileAllocated);
  }
  if (logical !== report.logicalBytes || charged !== report.chargedBytes) throw new Error(`${label} byte totals do not conserve its file inventory.`);
  return report;
}

function validateCaptureReport(value: unknown, input: FeatureIndexCaptureInput, binding: PythonBinding,
                               processLimits: SessionProcessLimits, indexHash: string): Record<string, unknown> {
  const full = exactObject(value, ['ingest', 'guard', 'footprint', 'executionSnapshotChargedBytes',
    'captureEnvelopeChargedBytes', 'captureController'], 'Capture report');
  const session = exactObject(full.captureController,
    ['attempts', 'attemptLimit', 'jobs', 'jobLimit', 'reservedWallSeconds', 'reconciledInterruptedAttempts', 'recordSha256', 'scope'], 'Capture controller report');
  const attempts = integer(session.attempts, 1, 8, 'Capture attempts');
  integer(session.attemptLimit, attempts, 8, 'Capture attempt limit');
  const jobs = integer(session.jobs, 1, 256, 'Capture jobs');
  integer(session.jobLimit, jobs, 256, 'Capture job limit');
  if (session.reservedWallSeconds !== attempts * processLimits.wallSeconds) throw new Error('Capture controller wall reservation is inconsistent.');
  integer(session.reconciledInterruptedAttempts, 0, 1, 'Reconciled interrupted attempts');
  sha(session.recordSha256, 'Capture durable record');
  const expectedScope = input.observation === null
    ? 'Pinned capture replay only; no campaign observation/completion or country coverage.'
    : 'Pinned capture replay and atomic supplied observation; campaign membership/completion and country coverage require the scheduler.';
  if (session.scope !== expectedScope) throw new Error('Capture controller report scope differs from its observation.');

  integer(full.executionSnapshotChargedBytes, 0, 1024 * 1024, 'Execution snapshot charge');
  const envelopeCharge = integer(full.captureEnvelopeChargedBytes, 1, 65_536, 'Capture envelope charge');
  validateFootprint(full.footprint, binding.reservedBytes, 'Terminal footprint');

  const worker = exactObject(full.ingest,
    ['format', 'indexHash', 'inputSha256', 'nodeVersion', 'sqliteVersion', 'result', 'stats', 'databaseBytes', 'maximumRssKiB'], 'Ingestion worker report');
  if (worker.format !== 'feature-index-ingest-v1' || worker.indexHash !== indexHash
      || worker.nodeVersion !== binding.runtime.nodeVersion || worker.sqliteVersion !== binding.runtime.sqliteVersion) throw new Error('Ingestion worker identity differs from the admitted runtime/index.');
  sha(worker.inputSha256, 'Ingestion envelope hash');
  const databaseBytes = integer(worker.databaseBytes, 4096, processLimits.fileBytes, 'Index database bytes');
  if (databaseBytes % 4096 !== 0) throw new Error('Index database size is not page-aligned.');
  integer(worker.maximumRssKiB, 1, Math.floor(processLimits.rssBytes / 1024), 'Worker maximum RSS KiB');
  const stats = exactObject(worker.stats, ['captures', 'occurrences', 'versions', 'observations', 'keys', 'conflictedKeys'], 'Index statistics') as unknown as FeatureIndexStats;
  const engineLimits = processLimits.engineLimits;
  for (const [key, count] of Object.entries(stats)) {
    const bound = key in engineLimits ? engineLimits[key as keyof typeof engineLimits] : engineLimits.versions;
    integer(count, 0, typeof bound === 'number' ? bound : MAX_INT, `Index ${key}`);
  }
  if (input.observation !== null && stats.observations < 1) throw new Error('Index did not report its fenced observation.');

  const outcome = exactObject(worker.result,
    ['indexVersion', 'requestHash', 'captureHash', 'features', 'admitted', 'exceptions', 'dispositionsHash', 'replayed', 'insertedVersions', 'observationHash'], 'Capture outcome') as unknown as FeatureIndexCaptureResult;
  const observationHash = input.observation === null ? null : featureIndexObservationPin(input.observation).sha256;
  if (outcome.indexVersion !== 'complete-feature-index-v1' || outcome.requestHash !== input.expected.requestHash
      || outcome.observationHash !== observationHash || typeof outcome.replayed !== 'boolean') {
    throw new Error('Capture outcome differs from its request or fenced observation.');
  }
  const expectedCaptureHash = sha256(canonicalJson({ version: CAPTURE_BINDING_VERSION,
    requestHash: input.expected.requestHash, extract: input.expected.extract, receipt: input.expected.receipt }));
  if (outcome.captureHash !== expectedCaptureHash) throw new Error('Capture hash differs from the exact frozen raw input pins.');
  sha(outcome.captureHash, 'Capture hash'); sha(outcome.dispositionsHash, 'Disposition hash');
  const features = integer(outcome.features, 0, processLimits.engineLimits.occurrences, 'Capture feature count');
  const admitted = integer(outcome.admitted, 0, features, 'Admitted capture features');
  integer(outcome.insertedVersions, 0, processLimits.engineLimits.versions, 'Inserted feature versions');
  if (!outcome.exceptions || typeof outcome.exceptions !== 'object' || Array.isArray(outcome.exceptions)) throw new TypeError('Capture exception counts must be a record.');
  let excluded = 0;
  for (const [name, count] of Object.entries(outcome.exceptions)) {
    boundedText(name, 128, 'Capture exception category'); excluded += integer(count, 1, features, `Capture exception ${name}`);
  }
  if (admitted + excluded !== features || outcome.insertedVersions > admitted || (outcome.replayed && outcome.insertedVersions !== 0)) {
    throw new Error('Capture counts do not conserve original feature dispositions.');
  }

  const guard = exactObject(full.guard,
    ['worker', 'case', 'returnCode', 'inheritedLease', 'inheritedNamespaceLease', 'terminationSignal', 'reason', 'elapsedMs',
      'maximumObservedWorkerRssBytes', 'limits', 'scratchFilesBeforeRecovery', 'stdout', 'stderr'], 'Fixed worker guard result');
  if (guard.worker !== 'index-capture-ingest' || guard.case !== null || guard.returnCode !== 0
      || guard.inheritedLease !== true || guard.inheritedNamespaceLease !== true
      || guard.terminationSignal !== null || guard.reason !== 'exit') throw new Error('Fixed worker guard did not confirm successful terminal execution.');
  if (typeof guard.elapsedMs !== 'number' || !Number.isFinite(guard.elapsedMs) || guard.elapsedMs < 0
      || guard.elapsedMs > processLimits.wallSeconds * 1000
      || integer(guard.maximumObservedWorkerRssBytes, 1, processLimits.rssBytes, 'Guard maximum RSS') > processLimits.rssBytes) {
    throw new Error('Fixed worker guard counters exceed their admitted bounds.');
  }
  if (typeof guard.stdout !== 'string' || Buffer.byteLength(guard.stdout) > 1_000_000
      || typeof guard.stderr !== 'string' || Buffer.byteLength(guard.stderr) > MAX_STDERR_BYTES) throw new RangeError('Fixed worker output exceeds its guard bounds.');
  const nested = parseCaptureJson(Buffer.from(guard.stdout), { bytes: 1_000_000, nodes: 100_000, depth: 48 });
  if (canonicalJson(nested) !== canonicalJson(worker)) throw new Error('Guarded child output differs from the returned worker report.');
  const limits = exactObject(guard.limits, ['fileBytes', 'cpuSeconds', 'coreBytes', 'wallSeconds', 'v8HeapMiB', 'sampledRssBytes'], 'Applied worker limits');
  if (integer(limits.fileBytes, 65_536, processLimits.fileBytes, 'Applied file limit') > processLimits.fileBytes
      || integer(limits.cpuSeconds, 1, processLimits.cpuSeconds, 'Applied CPU limit') > processLimits.cpuSeconds
      || limits.coreBytes !== 0 || integer(limits.wallSeconds, 1, processLimits.wallSeconds, 'Applied wall limit') > processLimits.wallSeconds
      || limits.v8HeapMiB !== processLimits.heapMiB
      || integer(limits.sampledRssBytes, 64 * 1024 * 1024, processLimits.rssBytes, 'Applied sampled RSS limit') > processLimits.rssBytes) {
    throw new Error('Fixed worker applied limits differ from the admitted process bounds.');
  }
  return value as Record<string, unknown>;
}

/** Validate the actual per-index admission report against its bound root and lock inodes. */
export function validateFeatureIndexSessionReady(value: unknown, indexHash: string, reservedBytes: number): FeatureIndexSessionReady {
  return admissionReady(value, indexHash, reservedBytes);
}

export function validateFeatureIndexSessionResult(value: unknown, id: number, indexHash: string,
                                                   input: FeatureIndexCaptureInput, binding: PythonBinding,
                                                   processLimits: SessionProcessLimits): Record<string, unknown> {
  const frame = exactObject(value, ['format', 'id', 'indexHash', 'report'], 'Capture result');
  if (frame.format !== RESULT_FORMAT || frame.id !== id || frame.indexHash !== indexHash) throw new Error('Capture result ordering or identity differs from the live request.');
  return validateCaptureReport(frame.report, input, binding, processLimits, indexHash);
}

export function validateFeatureIndexSessionDone(value: unknown, indexHash: string, captures: number): { indexHash: string; captures: number } {
  const frame = exactObject(value, ['format', 'indexHash', 'captures'], 'Session done');
  if (frame.format !== DONE_FORMAT || frame.indexHash !== indexHash || frame.captures !== captures) throw new Error('Session terminal counters differ from sent capture calls.');
  return { indexHash, captures };
}

class LineReader {
  #pending = Buffer.alloc(0);
  #lines: Buffer[] = [];
  #waiters: Array<{ resolve: (value: Buffer) => void; reject: (error: Error) => void }> = [];
  #failure: Error | undefined;
  #closed = false;
  #total = 0;
  constructor(child: ChildProcessWithoutNullStreams) {
    child.stdout.on('data', (chunk: Buffer | string) => {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      this.#total += data.byteLength;
      if (this.#total > MAX_STDOUT_BYTES) return this.fail(new RangeError('Session stdout exceeds its total protocol bound.'));
      this.#pending = Buffer.concat([this.#pending, data]);
      for (;;) {
        const newline = this.#pending.indexOf(0x0a);
        if (newline < 0) break;
        if (newline + 1 > MAX_LINE_BYTES) return this.fail(new RangeError('Session reply exceeds its line bound.'));
        const line = this.#pending.subarray(0, newline + 1);
        this.#pending = this.#pending.subarray(newline + 1);
        this.#deliver(line);
      }
      if (this.#pending.byteLength >= MAX_LINE_BYTES) this.fail(new RangeError('Session reply exceeds its line bound.'));
    });
    child.stdout.once('end', () => {
      if (this.#pending.byteLength) this.fail(new Error('Session stdout ended with a truncated protocol line.'));
      this.#closed = true; this.#flushClosed();
    });
    child.stdout.once('error', error => this.fail(error));
  }
  #deliver(line: Buffer): void {
    const waiter = this.#waiters.shift();
    if (waiter) waiter.resolve(line); else this.#lines.push(line);
  }
  #flushClosed(): void {
    if (!this.#closed) return;
    while (this.#waiters.length) this.#waiters.shift()!.reject(this.#failure ?? new Error('Session exited before its next protocol reply.'));
  }
  fail(error: Error): void { this.#failure ??= error; this.#closed = true; this.#flushClosed(); }
  next(): Promise<Buffer> {
    if (this.#lines.length) return Promise.resolve(this.#lines.shift()!);
    if (this.#failure) return Promise.reject(this.#failure);
    if (this.#closed) return Promise.reject(new Error('Session exited before its next protocol reply.'));
    return new Promise((resolve, reject) => this.#waiters.push({ resolve, reject }));
  }
  assertExhausted(): void {
    if (!this.#closed || this.#failure || this.#pending.byteLength || this.#lines.length || this.#waiters.length) {
      throw new Error('Session emitted extra, truncated, or unconsumed protocol output after done.');
    }
  }
  takeQueued(): Buffer[] {
    if (!this.#closed || this.#failure || this.#pending.byteLength || this.#waiters.length) {
      throw new Error('Session output did not close cleanly for terminal verification.');
    }
    return this.#lines.splice(0);
  }
}

function awaitChildClose(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if ((child.exitCode !== null || child.signalCode !== null) && child.stdout.closed && child.stderr.closed && child.stdin.destroyed) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Owned session did not close before its reap deadline.')); }, timeoutMs);
    timer.unref();
    const close = (code: number | null, signal: NodeJS.Signals | null) => { cleanup(); resolve({ code, signal }); };
    const error = (cause: Error) => { cleanup(); reject(cause); };
    const cleanup = () => { clearTimeout(timer); child.off('close', close); child.off('error', error); };
    child.once('close', close); child.once('error', error);
  });
}

function sampleOwnedPythonRssKiB(pid: number): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile('/bin/ps', ['-p', String(pid), '-o', 'rss='], {
      encoding: 'utf8', timeout: 1000, maxBuffer: 4096, killSignal: 'SIGKILL', shell: false,
      windowsHide: true, env: { PATH: '/usr/bin:/bin' },
    }, (error, stdout, stderr) => {
      if (error) return reject(new Error('Could not sample the owned Python coordinator RSS.', { cause: error }));
      const output = String(stdout);
      if (Buffer.byteLength(output, 'ascii') > 4096 || !/^\s*[0-9]+\s*$/.test(output)) {
        return reject(new Error(`Owned Python RSS sample was unavailable or malformed: ${String(stderr).slice(0, 512)}`));
      }
      const kib = Number(output.trim());
      if (!Number.isSafeInteger(kib) || kib < 1) return reject(new Error('Owned Python RSS sample is outside its strict integer bound.'));
      resolve(kib);
    });
  });
}

async function terminateOwnedGroup(child: ChildProcessWithoutNullStreams): Promise<void> {
  if((child.exitCode!==null||child.signalCode!==null)&&child.stdout.closed&&child.stderr.closed&&child.stdin.destroyed)return;
  if (!child.pid) throw new FeatureIndexSessionUnreaped(child, new Error('Owned Python process has no PID.'));
  const group = -child.pid;
  const signalGroup = (signal: NodeJS.Signals) => {
    try { process.kill(group, signal); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  };
  try {
    signalGroup('SIGTERM');
    try { await awaitChildClose(child, 6_000); return; }
    catch { signalGroup('SIGKILL'); await awaitChildClose(child, 2_000); }
  } catch (error) {
    try { signalGroup('SIGKILL'); await awaitChildClose(child, 2_000); }
    catch { throw new FeatureIndexSessionUnreaped(child, error); }
  }
}

async function checkSessionPaths(config: FeatureIndexSessionConfig, binding: PythonBinding,
                                 manifest: Record<string, unknown>, runtime: FeatureIndexPythonRuntime) {
  const repositoryRoot = await verifyRepositoryRoot(config.repositoryRoot);
  const pythonExecutable = await verifyPinnedFile(config.pythonExecutable,
    { sha256: runtime.pythonSha256, bytes: runtime.pythonBytes }, 'Python executable', true);
  const admissionPin = manifest.admission as CaptureBytePin;
  const cliPath = path.join(repositoryRoot, 'world/tooling/index_admission.py');
  await verifyPinnedFile(cliPath, admissionPin, 'Admission CLI source');
  const nodeExecutable = canonicalAbsolute(config.nodeExecutable, 'Node executable');
  // The fixed coordinator verifies this same Node pin again inside the admitted controller.
  await verifyPinnedFile(nodeExecutable, { sha256: binding.runtime.nodeSha256, bytes: binding.runtime.nodeBytes }, 'Node executable', true);
  const namespaceRoot = canonicalAbsolute(config.namespaceRoot, 'Namespace root');
  const ns = await lstat(namespaceRoot);
  if (!ns.isDirectory() || ns.isSymbolicLink() || await realpath(namespaceRoot) !== namespaceRoot
      || (ns.mode & 0o777) !== 0o700 || (ns.uid !== process.getuid?.())) throw new TypeError('Namespace root must be an owned canonical private directory.');
  return { repositoryRoot, pythonExecutable, nodeExecutable, namespaceRoot };
}

/** Open one held Python admission and process captures sequentially through its exact JSONL protocol. */
export async function openFeatureIndexSession(configValue: FeatureIndexSessionConfig,
                                              options: FeatureIndexSessionOptions = {}): Promise<FeatureIndexSession> {
  const prepared = configValue && typeof configValue === 'object'
    ? PREPARED_CONFIGURATIONS.get(configValue) ?? prepareSessionConfiguration(configValue)
    : prepareSessionConfiguration(configValue);
  const { config: copiedConfig, runtime, bindingValue, binding, indexHash, manifest } = prepared;
  const { manifestBytes, sourceConfiguration, bindingBytes, aggregateBytes } = copiedConfig;
  const durationMs = options.durationMs ?? MAX_SESSION_MS;
  if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > MAX_SESSION_MS) throw new RangeError('Session duration must be 1..600,000 ms.');
  const signal = options.signal;
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('Session signal must be an AbortSignal.');
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Feature index session was aborted before spawn.');
  const verifiedPaths = await checkSessionPaths(copiedConfig, binding, manifest, runtime);
  const indexHashAfter = sha256(bindingBytes);
  if (indexHashAfter !== indexHash) throw new Error('Pinned index binding changed during validation.');

  const init = { format: INIT_FORMAT, namespaceRoot: verifiedPaths.namespaceRoot, aggregateBytes,
    repositoryRoot: verifiedPaths.repositoryRoot, manifestBase64: Buffer.from(manifestBytes).toString('base64'),
    sourceConfigurationBase64: Buffer.from(sourceConfiguration).toString('base64'), bindingBase64: Buffer.from(bindingBytes).toString('base64'),
    pythonRuntime: runtime, node: verifiedPaths.nodeExecutable };
  const initLine = asciiJsonLine(init, MAX_INIT_BYTES, 'Session init');
  const child = spawn(verifiedPaths.pythonExecutable, ['-I', '-B', path.join(verifiedPaths.repositoryRoot, 'world/tooling/index_admission.py'), '--capture-session'], {
    cwd: verifiedPaths.repositoryRoot, detached: true, shell: false, windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: path.dirname(verifiedPaths.pythonExecutable), PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1' },
  });
  const reader = new LineReader(child);
  let terminalError: Error | undefined;
  let readySeen = false;
  let sessionCaptureCount = 0;
  let pendingCaptureId: number | undefined;
  let pendingResponse: Record<string, unknown> | undefined;
  let terminalDoneFrame: Record<string, unknown> | undefined;
  let rejectControl!: (error: Error) => void;
  const controlled = new Promise<never>((_, reject) => { rejectControl = reject; });
  void controlled.catch(() => {});
  let termination: Promise<void> | undefined;
  const terminate = () => termination ??= terminateOwnedGroup(child);
  const failSession = (error: Error) => {
    if (terminalError) return;
    terminalError = error; rejectControl(error);
    void terminate().catch(unreaped => { terminalError = unreaped instanceof Error ? unreaped : new Error(String(unreaped)); });
  };
  let rssTimer: NodeJS.Timeout | undefined;
  let activeRssSample: Promise<void> | undefined;
  let rssMonitorError: Error | undefined;
  const samplePythonRss = async (): Promise<void> => {
    if (activeRssSample) return activeRssSample;
    if (child.exitCode !== null || child.signalCode !== null) return;
    const pid = child.pid;
    // A spawn event may not have assigned the child PID yet; the periodic pass
    // will begin once the owned ChildProcess exposes it.
    if (!pid) return;
    const sample = (async () => {
      let kib: number;
      try { kib = await sampleOwnedPythonRssKiB(pid); }
      catch (error) {
        if (child.exitCode !== null || child.signalCode !== null) return;
        throw error;
      }
      if (child.exitCode !== null || child.signalCode !== null) return;
      if (kib * 1024 > MAX_PYTHON_COORDINATOR_RSS) {
        throw new RangeError('Owned Python session coordinator exceeded its 96 MiB RSS ceiling.');
      }
    })();
    activeRssSample = sample;
    try { await sample; }
    finally { if (activeRssSample === sample) activeRssSample = undefined; }
  };
  const recordRssFailure = (error: unknown) => {
    rssMonitorError = error instanceof Error ? error : new Error(String(error));
    failSession(rssMonitorError);
  };
  const stopRssSampling = async () => {
    if (rssTimer) { clearInterval(rssTimer); rssTimer = undefined; }
    const active = activeRssSample;
    if (active) {
      try { await active; } catch (error) { rssMonitorError ??= error instanceof Error ? error : new Error(String(error)); }
    }
  };
  let stderrBytes = 0;
  child.stderr.on('data', (chunk: Buffer | string) => {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); stderrBytes += data.byteLength;
    if (stderrBytes > MAX_STDERR_BYTES) failSession(new RangeError('Session stderr exceeds 64 KiB.'));
  });
  child.stdin.on('error', error => failSession(error));
  let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  let closeError: Error | undefined;
  // Leave room for the finite session deadline to signal the Python supervisor,
  // reap its nested fixed worker, emit done, and then close its own pipes.
  const closed = awaitChildClose(child, durationMs + 8_000).then(value => { exitInfo = value; }, error => { closeError = error; });
  const deadlineTimer = setTimeout(() => failSession(new Error('Feature index session exceeded its finite wall deadline.')), durationMs);
  deadlineTimer.unref();
  const pollPythonRss = () => { void samplePythonRss().catch(recordRssFailure); };
  pollPythonRss();
  rssTimer = setInterval(pollPythonRss, 100);
  rssTimer.unref();
  const abort = () => failSession(signal?.reason instanceof Error ? signal.reason : new Error('Feature index session was aborted.'));
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const readFrame = async (max = MAX_LINE_BYTES): Promise<Record<string, unknown>> => {
    if (terminalError) throw terminalError;
    const line = await Promise.race([reader.next(), controlled]);
    const parsed = parseFeatureIndexSessionLine(line, max);
    return parsed as Record<string, unknown>;
  };
  const send = async (bytes: Buffer): Promise<void> => {
    if (terminalError) throw terminalError;
    if (!child.stdin.writable || child.stdin.destroyed) throw new Error('Feature index session stdin is no longer writable.');
    await new Promise<void>((resolve, reject) => {
      child.stdin.write(bytes, error => error ? reject(error) : resolve());
    });
  };
  const abortOwned = async (cause: unknown): Promise<never> => {
    clearTimeout(deadlineTimer); signal?.removeEventListener('abort', abort);
    try { await terminate(); await closed; await stopRssSampling(); }
    catch (error) { throw error instanceof FeatureIndexSessionUnreaped ? error : new FeatureIndexSessionUnreaped(child, error); }
    if (closeError || !exitInfo) throw new FeatureIndexSessionUnreaped(child, closeError ?? new Error('Owned session close was not confirmed.'));
    if (!readySeen) throw new FeatureIndexSessionUnreaped(child, new Error('Session ended before its ready/done lifecycle could be verified.'));
    try {
      const frames = reader.takeQueued();
      let next = 0, expectedCaptures = sessionCaptureCount;
      const possibleResult = pendingResponse ?? (frames[next] ? parseFeatureIndexSessionLine(frames[next]!) as Record<string, unknown> : undefined);
      if (possibleResult && Object.hasOwn(possibleResult, 'id')) {
        if (pendingCaptureId === undefined || possibleResult.format !== RESULT_FORMAT || possibleResult.id !== pendingCaptureId
            || possibleResult.indexHash !== indexHash
            || (Object.hasOwn(possibleResult, 'report') === Object.hasOwn(possibleResult, 'error'))
            || Object.keys(possibleResult).length !== 4) throw new Error('Interrupted session produced an uncorrelated capture reply.');
        if (Object.hasOwn(possibleResult, 'error')
            && (typeof possibleResult.error !== 'string' || Buffer.byteLength(possibleResult.error, 'utf8') > 4096)) {
          throw new Error('Interrupted session error reply exceeds its protocol bound.');
        }
        if (!pendingResponse) next++;
        expectedCaptures++;
      } else if (pendingResponse) throw new Error('Interrupted session lost its pending capture reply identity.');
      if (terminalDoneFrame && frames.length - next !== 0) throw new Error('Interrupted session emitted output after its terminal frame.');
      if (!terminalDoneFrame && frames.length - next !== 1) throw new Error('Interrupted session did not emit exactly one terminal frame.');
      const doneFrame = terminalDoneFrame ?? parseFeatureIndexSessionLine(frames[next]!) as Record<string, unknown>;
      validateFeatureIndexSessionDone(doneFrame, indexHash, expectedCaptures);
      if (exitInfo.code !== 1 || exitInfo.signal !== null) throw new Error('Interrupted session did not use its confirmed nonzero terminal exit.');
      reader.assertExhausted();
      await verifyPinnedFile(verifiedPaths.pythonExecutable, { sha256: runtime.pythonSha256, bytes: runtime.pythonBytes }, 'Python executable', true);
      await verifyPinnedFile(path.join(verifiedPaths.repositoryRoot, 'world/tooling/index_admission.py'), manifest.admission as CaptureBytePin, 'Admission CLI source');
    } catch (error) {
      throw new FeatureIndexSessionUnreaped(child, error);
    }
    throw new FeatureIndexSessionTerminated(rssMonitorError ?? cause);
  };
  try {
    await send(initLine);
    const readyFrame = await readFrame(MAX_LINE_BYTES);
    const ready = admissionReady(readyFrame, indexHash, binding.reservedBytes);
    readySeen = true;
    if (terminalError) throw terminalError;
    const rootPath = path.join(verifiedPaths.namespaceRoot, indexHash);
    const rootInfo = await lstat(rootPath), lockInfo = await lstat(path.join(rootPath, 'writer.lock'));
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory() || rootInfo.uid !== process.getuid?.() || (rootInfo.mode & 0o777) !== 0o700
        || lockInfo.isSymbolicLink() || !lockInfo.isFile() || lockInfo.uid !== process.getuid?.() || lockInfo.nlink !== 1
        || lockInfo.size !== 0 || (lockInfo.mode & 0o777) !== 0o600
        || rootInfo.dev !== ready.admission.rootDevice || rootInfo.ino !== ready.admission.rootInode
        || lockInfo.dev !== ready.admission.lockDevice || lockInfo.ino !== ready.admission.lockInode) {
      throw new Error('Session admission inode report differs from actual root/lock files.');
    }
    const limitsObj = validateBindingProcess(bindingValue);
    let state: 'ready' | 'inflight' | 'closing' | 'closed' | 'failed' = 'ready';
    let inFlight: Promise<Record<string, unknown>> | undefined;
    const api: FeatureIndexSession = {
      indexHash,
      ready,
      async ingestCapture(rawInput) {
        if (state !== 'ready' || inFlight) throw new Error('Feature index session accepts exactly one operation at a time.');
        if (sessionCaptureCount >= MAX_CAPTURE_JOBS) throw new RangeError('Feature index session reached its fixed 256-capture ceiling.');
        const input = validateCaptureInput(cloneJson(rawInput, 'Capture input') as FeatureIndexCaptureInput);
        asciiJsonLine(input.expected, 64_000, 'Capture expectation');
        const id = sessionCaptureCount + 1;
        const line = asciiJsonLine({ format: CAPTURE_FORMAT, id, extractPath: input.extractPath, receiptPath: input.receiptPath,
          expected: input.expected, observation: input.observation }, MAX_LINE_BYTES, 'Capture input');
        pendingCaptureId = id; pendingResponse = undefined;
        state = 'inflight';
        const operation = (async () => {
          try {
            await send(line);
            const frame = await readFrame();
            pendingResponse = frame;
            if (terminalError) throw terminalError;
            if (Object.hasOwn(frame, 'error')) {
              const result = exactObject(frame, ['format', 'id', 'indexHash', 'error'], 'Capture error result');
              if (result.format !== RESULT_FORMAT || result.id !== id || result.indexHash !== indexHash) throw new Error('Capture error response identity/order differs from the current call.');
              if (typeof result.error !== 'string' || Buffer.byteLength(result.error, 'utf8') > 4096 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result.error)) throw new TypeError('Capture error text exceeds its bounded response shape.');
              sessionCaptureCount++;
              pendingCaptureId = undefined; pendingResponse = undefined;
              state = 'ready';
              throw new Error(result.error);
            }
            const report = validateFeatureIndexSessionResult(frame, id, indexHash, input, binding, limitsObj);
            sessionCaptureCount++; pendingCaptureId = undefined; pendingResponse = undefined; state = 'ready';
            return report;
          } catch (error) {
            if (state === 'inflight') state = 'failed';
            if (state === 'failed') return await abortOwned(error);
            throw error;
          } finally { inFlight = undefined; }
        })();
        inFlight = operation;
        return operation;
      },
      async close() {
        if (state !== 'ready' || inFlight) throw new Error('Cannot close a session with an in-flight or failed capture.');
        state = 'closing';
        try {
          await send(asciiJsonLine({ format: CLOSE_FORMAT }, MAX_LINE_BYTES, 'Session close'));
          child.stdin.end();
          const doneFrame = await readFrame();
          terminalDoneFrame = doneFrame;
          if (terminalError) throw terminalError;
          const done = validateFeatureIndexSessionDone(doneFrame, indexHash, sessionCaptureCount);
          await closed;
          await stopRssSampling();
          if (closeError || !exitInfo || exitInfo.code !== 0 || exitInfo.signal !== null) throw closeError ?? new Error('Session did not exit successfully after its done frame.');
          reader.assertExhausted();
          await verifyPinnedFile(verifiedPaths.pythonExecutable, { sha256: runtime.pythonSha256, bytes: runtime.pythonBytes }, 'Python executable', true);
          await verifyPinnedFile(path.join(verifiedPaths.repositoryRoot, 'world/tooling/index_admission.py'), manifest.admission as CaptureBytePin, 'Admission CLI source');
          if (terminalError) throw terminalError;
          state = 'closed';
          clearTimeout(deadlineTimer); signal?.removeEventListener('abort', abort);
          return done;
        } catch (error) {
          state = 'failed';
          return await abortOwned(error);
        }
      },
    };
    return api;
  } catch (error) {
    return await abortOwned(error);
  }
}

function validateBindingProcess(binding: Record<string, unknown>): SessionProcessLimits {
  const processLimits = exactObject(binding.processLimits, ['fileBytes', 'cpuSeconds', 'wallSeconds', 'heapMiB', 'rssBytes'], 'Process limits');
  const engineLimits = exactObject(binding.engineLimits,
    ['databaseBytes', 'captures', 'occurrences', 'versions', 'observations'], 'Engine limits');
  integer(processLimits.fileBytes, 65_536, 64 * 1024 * 1024, 'File byte limit');
  integer(processLimits.cpuSeconds, 1, 60, 'CPU limit'); integer(processLimits.wallSeconds, 1, 60, 'Worker wall limit');
  integer(processLimits.heapMiB, 64, 1536, 'Heap limit'); integer(processLimits.rssBytes, 64 * 1024 * 1024, 512 * 1024 * 1024, 'Worker RSS limit');
  integer(engineLimits.databaseBytes, 65_536, 64 * 1024 * 1024, 'Database limit');
  integer(engineLimits.captures, 1, 4096, 'Capture count limit'); integer(engineLimits.occurrences, 1, 250_000, 'Occurrence limit');
  integer(engineLimits.versions, 1, 100_000, 'Version limit'); integer(engineLimits.observations, 1, 16_384, 'Observation limit');
  return { ...processLimits, engineLimits } as unknown as SessionProcessLimits;
}

function prepareSessionConfiguration(configValue: unknown): PreparedData {
  const configRecord = exactObject(configValue, ['pythonExecutable', 'pythonRuntime', 'nodeExecutable', 'namespaceRoot', 'aggregateBytes',
    'repositoryRoot', 'manifestBytes', 'sourceConfiguration', 'bindingBytes'], 'Feature index session config');
  const runtime = validatePythonRuntime(configRecord.pythonRuntime);
  const copyInputBytes = (value: unknown, label: string, maximum: number): Buffer => {
    if (!(value instanceof Uint8Array) || value.buffer instanceof SharedArrayBuffer || value.byteLength < 1 || value.byteLength > maximum) {
      throw new TypeError(`${label} must be bounded unshared bytes.`);
    }
    return Buffer.from(value);
  };
  const manifestBytes = copyInputBytes(configRecord.manifestBytes, 'Manifest', 64_000);
  const sourceConfiguration = copyInputBytes(configRecord.sourceConfiguration, 'Source configuration', 64_000);
  const bindingBytes = copyInputBytes(configRecord.bindingBytes, 'Binding', 4096);
  const bindingValue = decodeCanonical(bindingBytes, 'Index binding');
  const binding = validateBinding(bindingValue);
  const indexHash = sha256(bindingBytes);
  const manifest = decodeManifest(manifestBytes, binding.toolingManifest);
  if (sourceConfiguration.byteLength !== binding.source.configuration.bytes
      || sha256(sourceConfiguration) !== binding.source.configuration.sha256) throw new Error('Source configuration differs from its index binding pin.');
  const aggregateBytes = integer(configRecord.aggregateBytes, 17 * 1024 * 1024 + 65_536, 512 * 1024 * 1024, 'Namespace aggregate bytes');
  const pythonExecutable = canonicalAbsolute(configRecord.pythonExecutable, 'Python executable');
  const nodeExecutable = canonicalAbsolute(configRecord.nodeExecutable, 'Node executable');
  const namespaceRoot = canonicalAbsolute(configRecord.namespaceRoot, 'Namespace root');
  const repositoryRoot = canonicalAbsolute(configRecord.repositoryRoot, 'Repository root');
  const config: FeatureIndexSessionConfig = { pythonExecutable, pythonRuntime: runtime, nodeExecutable, namespaceRoot,
    aggregateBytes, repositoryRoot, manifestBytes, sourceConfiguration, bindingBytes };
  return { config, runtime, bindingValue, binding, indexHash, manifest };
}

/** Pure defensive config snapshot for campaign metadata: no filesystem reads, process starts, or SQLite. */
export function prepareFeatureIndexSessionConfiguration(configValue: FeatureIndexSessionConfig): PreparedFeatureIndexSessionConfiguration {
  if (configValue && typeof configValue === 'object') {
    const old = PREPARED_CONFIGURATIONS.get(configValue);
    if (old) return configValue as PreparedFeatureIndexSessionConfiguration;
  }
  const data = prepareSessionConfiguration(configValue);
  const prepared = Object.defineProperties({}, {
    pythonExecutable: { value: data.config.pythonExecutable, enumerable: true },
    pythonRuntime: { value: Object.freeze({ ...data.runtime }), enumerable: true },
    nodeExecutable: { value: data.config.nodeExecutable, enumerable: true },
    namespaceRoot: { value: data.config.namespaceRoot, enumerable: true },
    aggregateBytes: { value: data.config.aggregateBytes, enumerable: true },
    repositoryRoot: { value: data.config.repositoryRoot, enumerable: true },
    manifestBytes: { enumerable: true, get: () => Buffer.from(data.config.manifestBytes) },
    sourceConfiguration: { enumerable: true, get: () => Buffer.from(data.config.sourceConfiguration) },
    bindingBytes: { enumerable: true, get: () => Buffer.from(data.config.bindingBytes) },
    indexHash: { value: data.indexHash, enumerable: true },
  });
  Object.freeze(prepared);
  PREPARED_CONFIGURATIONS.set(prepared, data);
  return prepared as PreparedFeatureIndexSessionConfiguration;
}
