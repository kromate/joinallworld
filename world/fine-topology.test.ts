import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, link, lstat, mkdir, mkdtemp, readFile, realpath, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import type { FineSourcePin } from './fine-types.ts';
import { runFineTopology, validateFineTopologyReport } from './fine-topology.ts';

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const python = path.join(repo, '.cache', 'world-build', 'tooling', 'venv', 'bin', 'python3.12');
const sourceExtension = path.join(repo, '.cache', 'world-build', 'tooling', 'extensions', 'v1.5.6', 'osx_arm64', 'spatial.duckdb_extension');
const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const planarException = 'OGC validity uses only 2D longitude/latitude in a plane; higher ordinates are ignored and this does not establish spherical validity on the ellipsoid.';
const unsupportedException = 'Polar, global-span, or ambiguous longitude geometries are reported unsupported, not valid.';

function fixturePin(raw: Buffer): FineSourcePin {
  const digest = sha(raw), release = 'a'.repeat(40), layerId = 'RWA-ADM1-topology-test';
  const url = `https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/${release}/releaseData/gbOpen/RWA/ADM1/geoBoundaries-RWA-ADM1.geojson`;
  return { schemaVersion: 1, provider: 'geoBoundaries', source: { id: `geoboundaries:RWA:ADM1:${layerId}`, url, release,
    license: 'CC BY 4.0', attribution: 'synthetic test fixture', sha256: digest, bytes: raw.length },
    input: `.cache/world-build/fine-source-cache/${digest}.geojson`, countryCode: 'RW', countryIso3: 'RWA', adminLevel: 'ADM1',
    layerId, canonicalType: 'Province', representedYear: '2021', buildDate: '2026-10-08', expectedUnits: 1,
    originalLicense: 'CC BY 4.0', licenseEvidence: ['https://example.invalid/fixture'], metadataSha256: 'b'.repeat(64), metadataBytes: 10,
    boundaryPolicy: 'Synthetic administrative test fixture only.' };
}

function row(featureKey: string, status: 'valid' | 'invalid' | 'unsupported') {
  if (status === 'valid') return { featureKey, status, valid: true, empty: false, reason: null };
  if (status === 'invalid') return { featureKey, status, valid: false, empty: null, reason: 'OGC planar geometry is invalid' };
  return { featureKey, status, valid: null, empty: null, reason: 'global/polar unsupported' };
}
function reportFor(pin: FineSourcePin, rows: ReturnType<typeof row>[]): Record<string, unknown> {
  const validUnits = rows.filter(item => item.status === 'valid').length;
  const invalidUnits = rows.filter(item => item.status === 'invalid').length;
  const unsupportedUnits = rows.filter(item => item.status === 'unsupported').length;
  const exceptions = [planarException, ...(unsupportedUnits ? [unsupportedException] : [])];
  return { schemaVersion: 1, validator: 'duckdb-spatial-ogc-planar-v1', sourceSha256: pin.source.sha256,
    sourceBytes: pin.source.bytes, expectedUnits: rows.length, checkedUnits: validUnits + invalidUnits,
    validUnits, invalidUnits, unsupportedUnits,
    tooling: { duckdbVersion: '1.5.6', spatialVersion: '04270fe', spatialSha256: 'e326286e0ff4651680bfa2918fb22990fed50cb7d27d79dd21143ac7e74b0da9' },
    rows, exceptions };
}

test('report validator enforces pin, fixed tooling, source-key order, predicates and checked/unsupported conservation', () => {
  const source = Buffer.from('synthetic pin bytes');
  const pin = fixturePin(source);
  pin.expectedUnits = 3;
  const valid = reportFor(pin, [row('alpha', 'valid'), row('bravo', 'invalid'), row('charlie', 'unsupported')]);
  const accepted = validateFineTopologyReport(valid, pin, ['charlie', 'alpha', 'bravo']);
  assert.equal(accepted.checkedUnits, 2);
  assert.equal(accepted.unsupportedUnits, 1);
  const emptyButOgcValid = structuredClone(valid);
  (emptyButOgcValid.rows as Array<Record<string, unknown>>)[1] = { featureKey: 'bravo', status: 'invalid', valid: true, empty: true, reason: 'empty geometry' };
  assert.equal(validateFineTopologyReport(emptyButOgcValid, pin, ['alpha', 'bravo', 'charlie']).invalidUnits, 1);

  const rejected: Array<[string, (value: Record<string, unknown>) => void, RegExp]> = [
    ['source hash', value => { value.sourceSha256 = '0'.repeat(64); }, /pinned source/],
    ['runtime', value => { (value.tooling as Record<string, unknown>).spatialVersion = 'other'; }, /tooling differs/],
    ['key', value => { (value.rows as unknown[])[0] = row('different', 'valid'); }, /keys are not exact/],
    ['counts', value => { value.checkedUnits = 3; }, /conserve source units/],
    ['status booleans', value => { (value.rows as Array<Record<string, unknown>>)[0]!.valid = false; }, /inconsistent predicates/],
    ['forged scope exception', value => { value.exceptions = [planarException, 'all cases were checked']; }, /exact validator contract/],
    ['unsupported count', value => { value.checkedUnits = 1; }, /conserve source units/],
  ];
  for (const [label, mutate, expected] of rejected) {
    const forged = structuredClone(valid); mutate(forged);
    assert.throws(() => validateFineTopologyReport(forged, pin, ['alpha', 'bravo', 'charlie']), expected, label);
  }
});

test('pre-aborted run returns before creating directories or starting a child', async () => {
  const temp = await mkdtemp(path.join(await realpath(os.tmpdir()), 'fine-topology-abort-'));
  try {
    const pin = fixturePin(Buffer.from('no source is read on a pre-aborted run'));
    const controller = new AbortController(); controller.abort(new Error('cancel before start'));
    await assert.rejects(runFineTopology({ repositoryRoot: temp, pin, signal: controller.signal }), /cancel before start/);
    await assert.rejects(lstat(path.join(temp, '.cache')), { code: 'ENOENT' });
  } finally { await rm(temp, { recursive: true, force: true }); }
});

async function makeRunFixture(temp: string, geometry: unknown): Promise<{ root: string; pin: FineSourcePin; keys: string[] }> {
  const root = path.join(temp, `repo-${cryptoRandom()}`), buildRoot = path.join(root, '.cache', 'world-build');
  const cache = path.join(buildRoot, 'fine-source-cache'), extensionRoot = path.join(buildRoot, 'tooling', 'extensions', 'v1.5.6', 'osx_arm64');
  await mkdir(cache, { recursive: true }); await mkdir(extensionRoot, { recursive: true });
  const extensionPath = path.join(extensionRoot, 'spatial.duckdb_extension');
  try { await link(sourceExtension, extensionPath); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await copyFile(sourceExtension, extensionPath);
  }
  const document = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { shapeID: 'RWA-ADM1-fixture', shapeName: 'Synthetic', shapeGroup: 'RWA', shapeType: 'ADM1' }, geometry }] };
  const raw = Buffer.from(JSON.stringify(document));
  const pin = fixturePin(raw);
  pin.expectedUnits = 1;
  await import('node:fs/promises').then(fs => fs.writeFile(path.join(cache, `${pin.source.sha256}.geojson`), raw, { mode: 0o600 }));
  return { root, pin, keys: ['RWA-ADM1-fixture'] };
}
function cryptoRandom(): string { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
function rectangle(west: number, south: number, east: number, north: number): unknown {
  return { type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] };
}

test('fixed worker publishes an immutable hash-addressed report and durable completed attempt', async () => {
  if (!await stat(python).then(() => true, () => false) || !await stat(sourceExtension).then(() => true, () => false)) {
    throw new Error('private Python 3.12 or pinned cached Spatial extension is missing');
  }
  const temp = await mkdtemp(path.join(await realpath(os.tmpdir()), 'fine-topology-run-'));
  try {
    const fixture = await makeRunFixture(temp, rectangle(29, -2, 30, -1));
    const result = await runFineTopology({ repositoryRoot: fixture.root, pin: fixture.pin });
    assert.equal(result.networkBytes, 0);
    assert.equal(result.report.validUnits, 1);
    const bytes = await readFile(result.reportPath);
    assert.equal(sha(bytes), result.reportHash);
    const attemptDir = path.join(fixture.root, '.cache', 'world-build', 'fine-topology', 'attempts');
    const attempts = await readdir(attemptDir);
    assert.equal(attempts.length, 1);
    const records = (await readFile(path.join(attemptDir, attempts[0]!), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
    assert.deepEqual(records.map(record => record.event), ['started', 'worker-started', 'finished']);
    assert.equal(records.at(-1)!.status, 'success');
    await assert.rejects(lstat(path.join(fixture.root, '.cache', 'world-build', '.acquisition-build.lock')), { code: 'ENOENT' });
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('abort after fixed child spawn waits for child close before final audit and lock release', async () => {
  const temp = await mkdtemp(path.join(await realpath(os.tmpdir()), 'fine-topology-child-abort-'));
  try {
    const ring: number[][] = [[0, 0], [1, 0], [1, 1]];
    for (let index = 3; index < 130_000; index++) ring.push([0, 1]);
    ring.push([0, 0]);
    const fixture = await makeRunFixture(temp, { type: 'Polygon', coordinates: [ring] });
    const controller = new AbortController();
    const pending = runFineTopology({ repositoryRoot: fixture.root, pin: fixture.pin, signal: controller.signal });
    const attemptDir = path.join(fixture.root, '.cache', 'world-build', 'fine-topology', 'attempts');
    let attemptPath: string | undefined, childPid: number | undefined;
    const waitUntil = Date.now() + 15_000;
    while (Date.now() < waitUntil && childPid === undefined) {
      let files: string[] = [];
      try { files = await readdir(attemptDir); } catch { /* runner has not made the audit directory yet */ }
      for (const file of files) {
        const records = (await readFile(path.join(attemptDir, file), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
        if (records.some(record => record.event === 'worker-started')) {
          attemptPath = path.join(attemptDir, file);
          childPid = records.find(record => record.event === 'worker-started')!.pid as number;
          break;
        }
      }
      if (childPid === undefined) await delay(2);
    }
    assert.ok(childPid, 'fixed Python child reached its spawn event');
    controller.abort(new Error('test abort after spawn'));
    await assert.rejects(pending, /test abort after spawn/);
    const records = (await readFile(attemptPath!, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);
    assert.equal(records.at(-1)!.status, 'aborted');
    await assert.rejects(lstat(path.join(fixture.root, '.cache', 'world-build', '.acquisition-build.lock')), { code: 'ENOENT' });
    assert.throws(() => process.kill(childPid!, 0), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ESRCH');
  } finally { await rm(temp, { recursive: true, force: true }); }
});
