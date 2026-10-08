import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { compileCountryDirectory, publishCountryDirectory } from './country-directory.ts';
import { publishCountryGrid, loadCountryGridBoundary } from './country-grid-publish.ts';
import { validateCountryGridRequest } from './country-grid.ts';
import type { SourceRecord } from './types.ts';

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
function source(raw: Buffer, suffix: string): SourceRecord {
  return { id: `country-grid-synthetic-${suffix}`, url: `https://example.invalid/${suffix}.geojson`, release: `${suffix}-release`, license: 'Public domain', attribution: 'Synthetic test geometry only', sha256: sha(raw), bytes: raw.byteLength };
}
function rawSource(): Buffer {
  const polygon = (x: number) => ({ type: 'Polygon', coordinates: [[[x, 4], [x + 0.4, 4], [x + 0.4, 4.4], [x, 4.4], [x, 4]]] });
  return Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { NE_ID: 1, ADMIN: 'Synthetic Senegal', CONTINENT: 'Africa', ISO_A2_EH: 'SN' }, geometry: polygon(-17) },
    { type: 'Feature', properties: { NE_ID: 159, ADMIN: 'Nigeria', CONTINENT: 'Africa', ISO_A2_EH: 'NG' }, geometry: polygon(3) },
  ] }));
}
async function fixture(): Promise<{ root: string; directoryRoot: string; outputRoot: string; request: ReturnType<typeof validateCountryGridRequest> }> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'country-grid-publish-')));
  const allowedRoot = path.join(root, '.cache', 'world-build'), directoryRoot = path.join(allowedRoot, 'output', 'country-inventory');
  const raw = rawSource(), candidate = source(raw, 'candidate'), baseline = source(raw, 'baseline');
  const directory = compileCountryDirectory(candidate, raw, baseline, raw, sha('synthetic baseline manifest'));
  const published = await publishCountryDirectory(directory, directoryRoot, allowedRoot);
  const request = validateCountryGridRequest({ schemaVersion: 1, id: 'senegal-test-v1', directoryManifestHash: published.manifestHash,
    countryId: 'country:natural-earth:NE_ID%3A1', level: 1,
    limits: { positions: 1000, bboxCells: 1000, cells: 1000, operations: 100_000, outputBytes: 1_000_000 } });
  return { root, directoryRoot, outputRoot: path.join(allowedRoot, 'country-grids', request.id), request };
}
async function withFixture(run: (state: Awaited<ReturnType<typeof fixture>>) => Promise<void>): Promise<void> {
  const state = await fixture(); try { await run(state); } finally { await rm(state.root, { recursive: true, force: true }); }
}
const options = (state: Awaited<ReturnType<typeof fixture>>) => ({ allowedRoot: path.join(state.root, '.cache', 'world-build'), directoryRoot: state.directoryRoot, outputRoot: state.outputRoot, durationMs: 60_000, memoryMb: 256 });

test('loads exact verified Senegal outline pins and publishes a deterministic immutable plan and completion', async () => withFixture(async state => {
  const boundary = await loadCountryGridBoundary(state.directoryRoot, state.request);
  assert.equal(boundary.node.countryCode, 'SN');
  assert.equal(boundary.pins.parts.length, 1);
  assert.deepEqual(boundary.geometry, { type: 'Polygon', coordinates: [[[ -17, 4 ], [-16.6, 4], [-16.6, 4.4], [-17, 4.4], [-17, 4]]] });
  const first = await publishCountryGrid(state.request, options(state));
  const second = await publishCountryGrid(state.request, options(state));
  assert.equal(first.cacheHit, false); assert.equal(second.cacheHit, true);
  assert.equal(first.planHash, second.planHash); assert.deepEqual(second.completion, first.completion);
  assert.equal(first.networkBytes, 0); assert.equal(first.plan.counts.selectedCells, first.plan.cells.length);
  const receipt = JSON.parse((await readFile(first.completion.path)).toString('utf8')) as Record<string, unknown>;
  assert.deepEqual(Object.keys(receipt).sort(), ['bytes', 'planHash', 'planPath', 'requestHash', 'schemaVersion']);
  assert.equal(receipt.planPath, `plans/${first.planHash}.json`);
}));

test('rejects a missing completed plan and corrupt completion without repairing either', async () => withFixture(async state => {
  const first = await publishCountryGrid(state.request, options(state));
  const completionBody = await readFile(first.completion.path);
  await writeFile(first.completion.path, Buffer.from('tampered receipt'));
  await assert.rejects(publishCountryGrid(state.request, options(state)), /completion receipt/);
  await writeFile(first.completion.path, completionBody);
  await rm(first.planPath);
  await assert.rejects(publishCountryGrid(state.request, options(state)), /missing plan|immutable collision/);
  await writeFile(first.planPath, Buffer.from('tampered'));
  await assert.rejects(publishCountryGrid(state.request, options(state)), /corrupt|mismatch/);
}));

test('resumes an exact immutable plan when its completion receipt was not yet written', async () => withFixture(async state => {
  const first = await publishCountryGrid(state.request, options(state));
  await rm(first.completion.path);
  const resumed = await publishCountryGrid(state.request, options(state));
  assert.equal(resumed.cacheHit, false);
  assert.equal(resumed.planHash, first.planHash);
  assert.equal((await readFile(first.planPath)).byteLength, first.bytes);
  assert.equal((await readFile(resumed.completion.path)).byteLength, resumed.completion.bytes);
}));

test('rejects an altered directory manifest pin and protected Nigeria', async () => withFixture(async state => {
  await assert.rejects(loadCountryGridBoundary(state.directoryRoot, { ...state.request, directoryManifestHash: 'a'.repeat(64) }), /missing|hash mismatch|manifest/);
  assert.throws(() => validateCountryGridRequest({ ...state.request, id: 'nigeria-test', countryId: 'legacy-ng' }), /Nigeria/);
}));

test('rejects temporary source/output roots that overlap or equal the allowed root', async () => withFixture(async state => {
  const root = options(state).allowedRoot;
  await assert.rejects(publishCountryGrid(state.request, { ...options(state), outputRoot: root }), /dedicated, disjoint descendants/);
  await assert.rejects(publishCountryGrid(state.request, { ...options(state), directoryRoot: root }), /dedicated, disjoint descendants/);
  await assert.rejects(publishCountryGrid(state.request, { ...options(state), outputRoot: path.join(state.directoryRoot, 'nested-output') }), /dedicated, disjoint descendants/);
  await assert.rejects(publishCountryGrid(state.request, { ...options(state), directoryRoot: path.join(state.outputRoot, 'nested-source') }), /dedicated, disjoint descendants/);
}));

test('enforces duration, memory, and request output byte bounds before publication', async () => withFixture(async state => {
  await assert.rejects(publishCountryGrid(state.request, { ...options(state), durationMs: 60_001 }), /duration\/memory/);
  await assert.rejects(publishCountryGrid(state.request, { ...options(state), memoryMb: 63 }), /duration\/memory/);
  await assert.rejects(publishCountryGrid(state.request, { ...options(state), memoryMb: 513 }), /duration\/memory/);
  const tiny = validateCountryGridRequest({ ...state.request, id: 'senegal-tiny-output', limits: { ...state.request.limits, outputBytes: 1 } });
  await assert.rejects(publishCountryGrid(tiny, { ...options(state), outputRoot: path.join(path.dirname(state.outputRoot), tiny.id) }), /output-byte limit/);
  await assert.rejects(publishCountryGrid(state.request, { ...options(state), durationMs: 1 }), /deadline|60-second/);
  const afterTimeout = await publishCountryGrid(state.request, options(state));
  assert.equal(afterTimeout.cacheHit, false);
}));

test('rejects a changed pinned source geometry part before compiling', async () => withFixture(async state => {
  const boundary = await loadCountryGridBoundary(state.directoryRoot, state.request);
  const sourceFile = path.join(state.directoryRoot, boundary.pins.parts[0]!.path);
  const original = await readFile(sourceFile);
  await writeFile(sourceFile, Buffer.from('modified source part'));
  await assert.rejects(loadCountryGridBoundary(state.directoryRoot, state.request), /hash mismatch/);
  await writeFile(sourceFile, original);
  const restored = await loadCountryGridBoundary(state.directoryRoot, state.request);
  assert.equal(restored.pins.parts[0]!.sha256, boundary.pins.parts[0]!.sha256);
}));

test('refuses symlinked output paths and aborts before publication', async () => withFixture(async state => {
  const abort = new AbortController(); abort.abort(new Error('test cancelled'));
  await assert.rejects(publishCountryGrid(state.request, { ...options(state), signal: abort.signal }), /test cancelled/);
  const outside = path.join(state.root, 'outside'); await writeFile(outside, 'x');
  await rm(state.outputRoot, { recursive: true, force: true });
  await mkdir(path.dirname(state.outputRoot), { recursive: true });
  await symlink(outside, state.outputRoot);
  await assert.rejects(publishCountryGrid(state.request, options(state)), /symlink/);
}));

test('aborts an observed live worker, awaits its exit, and permits a clean retry', async () => withFixture(async state => {
  const require = createRequire(import.meta.url);
  const threads = require('node:worker_threads') as typeof import('node:worker_threads') & { Worker: typeof import('node:worker_threads').Worker };
  const OriginalWorker = threads.Worker;
  let online = false, exited = false;
  const controller = new AbortController();
  class ObservedWorker extends OriginalWorker {
    constructor(...args: ConstructorParameters<typeof OriginalWorker>) {
      super(...args);
      this.once('online', () => { online = true; controller.abort(new Error('cancel live worker')); });
      this.once('exit', () => { exited = true; });
    }
  }
  try {
    threads.Worker = ObservedWorker;
    syncBuiltinESMExports();
    await assert.rejects(publishCountryGrid(state.request, { ...options(state), signal: controller.signal }), /cancel live worker/);
    assert.equal(online, true, 'the worker must have actually started');
    assert.equal(exited, true, 'publishCountryGrid must await worker exit before rejecting');
    assert.equal(await import('node:fs/promises').then(({ lstat }) => lstat(state.outputRoot).then(() => true, () => false)), false);
  } finally {
    threads.Worker = OriginalWorker;
    syncBuiltinESMExports();
  }
  const retry = await publishCountryGrid(state.request, options(state));
  assert.equal(retry.cacheHit, false);
  assert.ok((await readFile(retry.planPath)).byteLength > 0);
}));
