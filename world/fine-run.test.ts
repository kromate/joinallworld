import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildInventory, publishInventory } from './inventory.ts';
import { runFineBuild } from './fine-run.ts';
import type { FineSourcePin } from './fine-types.ts';
import type { SourceRecord } from './types.ts';

const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const release = 'a'.repeat(40);
const pinFor = (raw: Buffer): FineSourcePin => {
  const sourceHash = hash(raw);
  return {
    schemaVersion: 1, provider: 'geoBoundaries',
    source: { id: 'geoboundaries:RWA:ADM1:test-layer', url: `https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/${release}/releaseData/gbOpen/RWA/ADM1/geoBoundaries-RWA-ADM1.geojson`, release, license: 'CC-BY-4.0', attribution: 'Synthetic test fixture only', sha256: sourceHash, bytes: raw.byteLength },
    input: `.cache/world-build/fine-source-cache/${sourceHash}.geojson`, countryCode: 'RW', countryIso3: 'RWA', adminLevel: 'ADM1', layerId: 'RWA-ADM1-test-layer', canonicalType: 'Province',
    representedYear: '2021', buildDate: '2026-10-08', expectedUnits: 1, originalLicense: 'CC BY 4.0',
    licenseEvidence: ['https://example.invalid/license', 'synthetic fixture only'], metadataSha256: 'b'.repeat(64), metadataBytes: 128,
    boundaryPolicy: 'Synthetic test polygon only; not a legal boundary assertion.',
  };
};
function fineBytes(positions = 5) {
  const ring: number[][] = [[29, -2], [30, -2], [30, -1], [29, -1], [29, -2]];
  if (positions > ring.length) {
    const dense: number[][] = [];
    for (let i = 0; i < positions - 1; i++) {
      const angle = i / (positions - 1) * Math.PI * 2;
      dense.push([29.5 + Math.cos(angle) * 0.4, -1.5 + Math.sin(angle) * 0.4]);
    }
    dense.push(dense[0]!);
    ring.splice(0, ring.length, ...dense);
  }
  return Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { shapeID: 'RWA-ADM1-001', shapeName: 'Test Province', shapeGroup: 'RWA', shapeType: 'ADM1' }, geometry: { type: 'Polygon', coordinates: [ring] } }] }));
}
const coarseSource: SourceRecord = { id: 'synthetic-admin0', url: 'https://example.invalid/admin0', release: 'test', license: 'public-domain', attribution: 'Synthetic test fixture', sha256: 'a'.repeat(64), bytes: 1 };
const coarseGeometry = (west: number, south: number, east: number, north: number) => ({ type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });
const coarseGeo = { type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { NE_ID: 1, ADMIN: 'Rwanda', CONTINENT: 'Africa', ISO_A2_EH: 'RW' }, geometry: coarseGeometry(28, -3, 31, -1) },
  { type: 'Feature', properties: { NE_ID: 2, ADMIN: 'Nigeria', CONTINENT: 'Africa', ISO_A2_EH: 'NG' }, geometry: coarseGeometry(3, 4, 15, 14) },
] };
async function makeFixture<T>(run: (fixture: { repoRoot: string; buildRoot: string; sourcePath: string; raw: Buffer; pin: FineSourcePin; coarseHash: string }) => Promise<T>, raw = fineBytes()) {
  const temp = await mkdtemp(path.join(await realpath(os.tmpdir()), 'fine-runner-'));
  try {
    const repoRoot = path.join(await realpath(temp), 'repo'); await mkdir(repoRoot);
    const buildRoot = path.join(repoRoot, '.cache', 'world-build'); await mkdir(buildRoot, { recursive: true });
    const inventoryRoot = path.join(buildRoot, 'output', 'inventory');
    const inventory = buildInventory(coarseSource, coarseGeo);
    const published = await publishInventory(inventory, inventoryRoot, buildRoot);
    const pin = pinFor(raw), sourcePath = path.join(repoRoot, pin.input);
    await mkdir(path.dirname(sourcePath), { recursive: true }); await writeFile(sourcePath, raw);
    return await run({ repoRoot, buildRoot, sourcePath, raw, pin, coarseHash: published.manifestHash });
  } finally { await rm(temp, { recursive: true, force: true }); }
}
const run = (f: { repoRoot: string; pin: FineSourcePin; coarseHash: string; registry?: string; migration?: string; signal?: AbortSignal; durationMs?: number }) => runFineBuild({
  repositoryRoot: f.repoRoot, coarseInventoryHash: f.coarseHash, pin: f.pin,
  ...(f.registry ? { previousRegistryPath: f.registry } : {}), ...(f.migration ? { migrationPath: f.migration } : {}),
  ...(f.signal ? { signal: f.signal } : {}), ...(f.durationMs ? { durationMs: f.durationMs } : {}),
});

test('cache-only runner publishes immutable fine assets, reuses them deterministically and records bounded attempts', async () => makeFixture(async fixture => {
  const first = await run(fixture), second = await run(fixture);
  assert.equal(first.manifestHash, second.manifestHash);
  assert.equal(first.manifestPath, second.manifestPath);
  assert.equal(first.bytes, second.bytes);
  assert.equal(first.units, 1);
  assert.equal(first.networkBytes, 0);
  const attempts = await readdir(path.join(fixture.buildRoot, 'fine-attempts'));
  assert.equal(attempts.length, 2);
  for (const name of attempts) {
    const attempt = JSON.parse(await readFile(path.join(fixture.buildRoot, 'fine-attempts', name), 'utf8')) as { status: string; networkBytes: number; requestHash: string };
    assert.equal(attempt.status, 'succeeded'); assert.equal(attempt.networkBytes, 0); assert.match(attempt.requestHash, /^[a-f0-9]{64}$/);
  }
  const fineRoot = path.join(fixture.buildRoot, 'output', 'fine');
  const walk = async (directory: string): Promise<string[]> => {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.filter(entry => entry.isDirectory()).map(entry => walk(path.join(directory, entry.name))));
    return [...entries.filter(entry => entry.isFile()).map(entry => entry.name), ...nested.flat()];
  };
  const files = await walk(fineRoot);
  assert.equal(files.some(name => /\.(?:sqlite|db)$/i.test(name)), false, 'fine builder does not create a database');
}));

test('source tampering fails closed and retains a final failure audit record', async () => makeFixture(async fixture => {
  const changed = Buffer.from(fixture.raw); changed[changed.length - 2] = changed[changed.length - 2]! ^ 1; await writeFile(fixture.sourcePath, changed);
  await assert.rejects(run(fixture), /pinned length and SHA-256/);
  const attempts = await readdir(path.join(fixture.buildRoot, 'fine-attempts'));
  const record = JSON.parse(await readFile(path.join(fixture.buildRoot, 'fine-attempts', attempts[0]!), 'utf8')) as { status: string };
  assert.equal(record.status, 'failed');
  assert.equal(await readdir(path.join(fixture.buildRoot, 'output', 'fine')).then(() => true, () => false), false);
}));

test('symlinked cache ancestors are refused before creating data outside the repository', async () => makeFixture(async fixture => {
  const outside = path.join(path.dirname(fixture.repoRoot), 'outside'); await mkdir(outside);
  await rm(path.join(fixture.repoRoot, '.cache'), { recursive: true, force: true });
  await symlink(outside, path.join(fixture.repoRoot, '.cache'));
  await assert.rejects(run(fixture), /symlink/);
  assert.deepEqual(await readdir(outside), []);
}));

test('tampered immutable manifest collision fails without replacing the collision', async () => makeFixture(async fixture => {
  const first = await run(fixture);
  const original = await readFile(first.manifestPath);
  await writeFile(first.manifestPath, Buffer.from('tampered collision'));
  await assert.rejects(run(fixture), /immutable output collision/);
  assert.equal((await readFile(first.manifestPath)).toString(), 'tampered collision');
  assert.notDeepEqual(await readFile(first.manifestPath), original);
  const attempts = await readdir(path.join(fixture.buildRoot, 'fine-attempts'));
  const records = await Promise.all(attempts.map(name => readFile(path.join(fixture.buildRoot, 'fine-attempts', name), 'utf8').then(value => JSON.parse(value) as { status: string })));
  assert.ok(records.some(record => record.status === 'failed'));
}));

async function waitForWorkerStart(buildRoot: string): Promise<void> {
  const directory = path.join(buildRoot, 'fine-attempts'), deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const names = await readdir(directory).catch(() => []);
    for (const name of names) {
      const record = await readFile(path.join(directory, name), 'utf8').then(value => JSON.parse(value) as { status?: string }, () => null);
      if (record?.status === 'running') return;
      if (record?.status === 'failed' || record?.status === 'timed-out') throw new Error(`runner stopped before worker start: ${record.status}`);
    }
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  throw new Error('fine worker did not reach its online state in time');
}

test('abort during worker execution waits for thread exit before releasing the shared build lock', async () => makeFixture(async fixture => {
  const controller = new AbortController();
  const running = run({ ...fixture, signal: controller.signal });
  await waitForWorkerStart(fixture.buildRoot);
  controller.abort(new Error('test abort while fine worker is online'));
  await assert.rejects(running, /abort|deadline|timed out/i);
  const attempts = await readdir(path.join(fixture.buildRoot, 'fine-attempts'));
  assert.equal(attempts.length, 1);
  const record = JSON.parse(await readFile(path.join(fixture.buildRoot, 'fine-attempts', attempts[0]!), 'utf8')) as { status: string };
  assert.equal(record.status, 'aborted');
  const { withAcquisitionBuildLock } = await import('./acquire.ts');
  assert.equal(await withAcquisitionBuildLock(fixture.buildRoot, async () => 'lock recovered', { timeoutMs: 1_000 }), 'lock recovered');
}, fineBytes(39_000)));

test('wall deadline bounds shared-lock waiting without inventing an unaudited worker attempt', async () => makeFixture(async fixture => {
  const { withAcquisitionBuildLock } = await import('./acquire.ts');
  await withAcquisitionBuildLock(fixture.buildRoot, async () => {
    await assert.rejects(run({ ...fixture, durationMs: 50 }), /lock|deadline|timed out/i);
    assert.equal(await readdir(path.join(fixture.buildRoot, 'fine-attempts')).then(names => names.length, () => 0), 0);
  }, { timeoutMs: 1_000 });
}, fineBytes(39_000)));

test('preflight traversal rejects overlarge entry sets and excessive depth', async () => makeFixture(async fixture => {
  const fineRoot = path.join(fixture.buildRoot, 'output', 'fine'); await mkdir(fineRoot, { recursive: true });
  const many = path.join(fineRoot, 'many'); await mkdir(many);
  for (let i = 0; i < 4_097; i++) await writeFile(path.join(many, `entry-${i}`), '');
  await assert.rejects(run(fixture), /4,096-entry/);
  await rm(fineRoot, { recursive: true, force: true });
  let deep = fineRoot;
  for (let i = 0; i < 9; i++) { deep = path.join(deep, `d${i}`); await mkdir(deep, { recursive: true }); }
  await assert.rejects(run(fixture), /depth-8/);
}));
