// Fixed builder-only engine bootstrap. Supervisor verifies pins and holds the lease.
// No acquisition, network, capture ingestion, campaign completion or game access.
import assert from 'node:assert/strict';
import { constants, openSync, closeSync, fstatSync, lstatSync, realpathSync, readSync,
  readdirSync, fsyncSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { FeatureIndex, FEATURE_INDEX_VERSION, FEATURE_INDEX_CEILINGS, type FeatureIndexLimits } from '../feature-index.ts';
import { FEATURE_IDENTITY_VERSION } from '../feature-identity.ts';
import { CAPTURE_BINDING_VERSION } from '../capture-binding.ts';
import { CAPTURE_REQUEST_COMPILER } from '../capture-request.ts';
import { parseCaptureJson } from '../capture-json.ts';
import { sha256 } from '../pack.ts';

interface Binding {
  format: string; engineVersion: string; identityVersion: string; captureVersion: string; sourceCompiler: string;
  runtime: { nodeVersion: string; sqliteVersion: string };
  source: { provider: string; release: string; configuration: { sha256: string; bytes: number } };
  engineLimits: FeatureIndexLimits;
}
const nofollow = constants.O_NOFOLLOW | constants.O_NONBLOCK;
function present(file: string): boolean {
  try { lstatSync(file); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
function privateFile(file: string, maximum: number): void {
  const info = lstatSync(file);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.uid === process.getuid!()
    && (info.mode & 0o777) === 0o600 && info.nlink === 1 && info.size >= 0 && info.size <= maximum,
  'Bootstrap file must remain private, single-linked and bounded.');
}
function boundedRead(file: string, maximum: number, mode: number): Buffer {
  const fd = openSync(file, constants.O_RDONLY | nofollow);
  try {
    const before = fstatSync(fd);
    assert.ok(before.isFile() && before.uid === process.getuid!() && before.nlink === 1
      && (before.mode & 0o777) === mode && before.size > 0 && before.size <= maximum);
    const bytes = Buffer.alloc(before.size + 1); let count = 0;
    while (count < bytes.length) {
      const read = readSync(fd, bytes, count, bytes.length - count, null);
      if (!read) break;
      count += read;
    }
    const after = fstatSync(fd), named = lstatSync(file);
    const identity = (i: typeof before) => [i.dev, i.ino, i.size, i.mtimeMs, i.ctimeMs].join(':');
    assert.equal(identity(after), identity(before)); assert.equal(identity(named), identity(before));
    assert.equal(count, before.size);
    return bytes.subarray(0, count);
  } finally { closeSync(fd); }
}
function flush(file: string): void {
  const fd = openSync(file, constants.O_RDWR | nofollow);
  try {
    const held = fstatSync(fd), named = lstatSync(file);
    assert.ok(held.isFile() && held.nlink === 1 && held.uid === process.getuid!() && (held.mode & 0o777) === 0o600);
    assert.equal(held.dev, named.dev); assert.equal(held.ino, named.ino);
    fsyncSync(fd);
  } finally { closeSync(fd); }
}

export function bootstrapFeatureIndex(onBoundary: (name: string) => void = () => {}): Record<string, unknown> {
  const root = process.env.TMPDIR;
  assert.ok(root && path.isAbsolute(root) && realpathSync(root) === root);
  const directory = lstatSync(root);
  assert.ok(directory.isDirectory() && directory.uid === process.getuid!() && (directory.mode & 0o777) === 0o700);
  const descriptor = Number(process.env.WORLD_INDEX_LEASE_DESCRIPTOR);
  assert.ok(Number.isSafeInteger(descriptor) && descriptor > 2);
  const held = fstatSync(descriptor), named = lstatSync(path.join(root, 'writer.lock'));
  privateFile(path.join(root, 'writer.lock'), 0);
  assert.equal(held.dev, named.dev); assert.equal(held.ino, named.ino);
  // Keep both leases across exec/controller death; only close after the writer exits.
  const namespace = path.dirname(root), namespaceDirectory = lstatSync(namespace);
  assert.equal(realpathSync(namespace), namespace);
  assert.ok(namespaceDirectory.isDirectory() && namespaceDirectory.uid === process.getuid!()
    && (namespaceDirectory.mode & 0o777) === 0o700);
  const namespaceDescriptor = Number(process.env.WORLD_INDEX_NAMESPACE_DESCRIPTOR);
  assert.ok(Number.isSafeInteger(namespaceDescriptor) && namespaceDescriptor > 2 && namespaceDescriptor !== descriptor);
  const namespaceHeld = fstatSync(namespaceDescriptor), namespaceNamed = lstatSync(path.join(namespace, 'writer.lock'));
  privateFile(path.join(namespace, 'writer.lock'), 0);
  assert.ok(namespaceHeld.isFile() && namespaceHeld.uid === process.getuid!() && namespaceHeld.nlink === 1
    && (namespaceHeld.mode & 0o777) === 0o600 && namespaceHeld.size === 0);
  assert.equal(namespaceHeld.dev, namespaceNamed.dev); assert.equal(namespaceHeld.ino, namespaceNamed.ino);
  const raw = boundedRead(path.join(root, 'binding.json'), 4096, 0o600);
  assert.equal(sha256(raw), path.basename(root));
  const binding = parseCaptureJson(raw, { bytes: 4096, nodes: 1000, depth: 16 }) as Binding;
  assert.equal(binding.format, 'feature-index-binding-v1');
  assert.equal(binding.engineVersion, FEATURE_INDEX_VERSION); assert.equal(binding.identityVersion, FEATURE_IDENTITY_VERSION);
  assert.equal(binding.captureVersion, CAPTURE_BINDING_VERSION); assert.equal(binding.sourceCompiler, CAPTURE_REQUEST_COMPILER);
  assert.equal(binding.runtime.nodeVersion, process.version); assert.equal(binding.runtime.sqliteVersion, process.versions.sqlite);
  for (const key of Object.keys(FEATURE_INDEX_CEILINGS) as Array<keyof FeatureIndexLimits>) {
    const value = binding.engineLimits[key];
    assert.ok(Number.isSafeInteger(value) && value >= (key === 'databaseBytes' ? 65536 : 1) && value <= FEATURE_INDEX_CEILINGS[key]);
  }
  assert.equal(binding.engineLimits.databaseBytes % 4096, 0);
  // Read the configuration only from the supervisor's verified execution snapshot.
  const source = boundedRead(fileURLToPath(new URL('../acquisition-sources.json', import.meta.url)), 64000, 0o400);
  assert.equal(source.length, binding.source.configuration.bytes); assert.equal(sha256(source), binding.source.configuration.sha256);
  const config = parseCaptureJson(source, { bytes: 64000, nodes: 1000, depth: 8 }) as { provider: string; release: string };
  assert.equal(config.provider, binding.source.provider); assert.equal(config.release, binding.source.release);
  const final = path.join(root, 'features.sqlite'), staged = path.join(root, 'bootstrap.sqlite');
  const replayed = present(final);
  const allowed = new Set(['writer.lock', 'binding.json', 'features.sqlite', 'features.sqlite-wal', 'features.sqlite-shm',
    'features.sqlite-journal', 'bootstrap.sqlite', 'bootstrap.sqlite-wal', 'bootstrap.sqlite-shm',
    'bootstrap.sqlite-journal', 'audit.json', 'capture.json', 'capture.anchor.json', 'capture.execution']);
  for (const name of readdirSync(root)) assert.ok(allowed.has(name), 'Unknown bootstrap state is preserved.');
  for (const [name, maximum] of [['capture.json', 512000], ['capture.anchor.json', 4096]] as const) {
    if (present(path.join(root, name))) boundedRead(path.join(root, name), maximum, 0o600);
  }
  if (present(path.join(root, 'capture.execution'))) {
    const execution = path.join(root, 'capture.execution'), info = lstatSync(execution);
    assert.ok(info.isDirectory() && info.uid === process.getuid!() && (info.mode & 0o777) === 0o700
      && realpathSync(execution) === execution, 'Persistent capture execution must remain private and canonical.');
  }
  for (const base of [final, staged]) {
    for (const ending of ['-wal', '-shm', '-journal']) {
      if (present(base + ending)) { assert.ok(present(base), 'Orphan bootstrap sidecar is preserved.'); privateFile(base + ending, binding.engineLimits.databaseBytes); }
    }
  }
  assert.ok(!(replayed && present(staged)), 'Mixed final/staged databases are preserved.');
  const file = replayed ? final : staged;
  if (!present(file)) {
    const created = openSync(file, constants.O_RDWR | nofollow | constants.O_CREAT | constants.O_EXCL, 0o600);
    try { fsyncSync(created); } finally { closeSync(created); }
    const dir = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(dir); } finally { closeSync(dir); }
  }
  privateFile(file, binding.engineLimits.databaseBytes);
  onBoundary('empty-file');
  assert.ok(!replayed || lstatSync(file).size > 0, 'Empty final database is not an initialized index.');
  const before = lstatSync(file);
  const db = new DatabaseSync(file);
  let stats: ReturnType<FeatureIndex['stats']>;
  try {
    if (replayed) {
      assert.equal(db.prepare('PRAGMA application_id').get()!.application_id, 0x57464931,
        'Final path must already contain an initialized feature index.');
      assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 1);
    }
    const index = new FeatureIndex(db, binding.engineLimits); stats = index.stats();
    if (!replayed) assert.ok(Object.values(stats).every(value => value === 0), 'Bootstrap staging cannot contain captures.');
    onBoundary('schema-checkpointed');
    assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { db.close(); }
  privateFile(file, binding.engineLimits.databaseBytes);
  const after = lstatSync(file); assert.equal(after.dev, before.dev); assert.equal(after.ino, before.ino);
  assert.ok(!present(file + '-wal') && !present(file + '-shm') && !present(file + '-journal'),
    'Database sidecars must close before publication.');
  flush(file);
  if (!replayed) {
    assert.ok(!present(final), 'Final index appeared during bootstrap.'); onBoundary('before-rename');
    renameSync(staged, final); onBoundary('after-rename');
  }
  const dir = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(dir); } finally { closeSync(dir); }
  assert.equal(realpathSync(root), root); assert.equal(lstatSync(root).ino, directory.ino);
  assert.equal(lstatSync(root).dev, directory.dev);
  const retainedLease = lstatSync(path.join(root, 'writer.lock'));
  assert.equal(retainedLease.dev, held.dev); assert.equal(retainedLease.ino, held.ino);
  const retainedNamespace = lstatSync(path.join(namespace, 'writer.lock'));
  assert.equal(retainedNamespace.dev, namespaceHeld.dev); assert.equal(retainedNamespace.ino, namespaceHeld.ino);
  return { format: 'feature-index-bootstrap-v1', indexHash: path.basename(root), replayed,
    nodeVersion: process.version, sqliteVersion: process.versions.sqlite, stats,
    databaseBytes: lstatSync(final).size, maximumRssKiB: process.resourceUsage().maxRSS };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(bootstrapFeatureIndex()));
