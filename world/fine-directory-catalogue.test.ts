import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildFineDirectoryCatalogue } from './fine-directory-catalogue.ts';
import { FINE_CATALOGUE_URL } from './fine-catalogue.ts';
import { buildFineDirectoryCatalogueFromCache } from './fine-directory-catalogue-cli.ts';
import { compileCountryDirectory, publishCountryDirectory } from './country-directory.ts';
import { readdir, symlink } from 'node:fs/promises';
import { withAcquisitionBuildLock } from './acquire.ts';
import type { SourceRecord } from './types.ts';
import type { WorldInventory } from './production-types.ts';

const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const metadataRow = (iso: string) => ({ boundaryID: `${iso}-ADM1-1`, boundaryISO: iso, boundaryName: iso, boundaryType: 'ADM1', admUnitCount: '3', gjDownloadURL: `https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/${iso}/ADM1/geoBoundaries-${iso}-ADM1.geojson` });

function fixture() {
  const source = { id: 'natural-earth-admin0-10m-fixture', url: 'https://example.test/ne-10m.geojson', release: 'a'.repeat(40), license: 'Public-domain', attribution: 'Natural Earth fixture', sha256: 'b'.repeat(64), bytes: 100 };
  const nodes: WorldInventory['nodes'] = [
    { id: 'world:earth', parentId: null, name: 'World', kind: 'world', countryCode: null, bounds: null, sourceFeatureIds: [], provider: 'world', outline: 'missing', exceptions: [] },
    { id: 'continent:africa', parentId: 'world:earth', name: 'Africa', kind: 'continent', countryCode: null, bounds: null, sourceFeatureIds: [], provider: 'world', outline: 'missing', exceptions: [] },
    { id: 'country:GHA:1', parentId: 'continent:africa', name: 'Ghana', kind: 'country', countryCode: 'GH', bounds: null, sourceFeatureIds: [`${source.id}:NE_ID:1`], provider: 'world', outline: 'missing', exceptions: [] },
    { id: 'legacy-ng', parentId: 'continent:africa', name: 'Nigeria', kind: 'country', countryCode: 'NG', bounds: null, sourceFeatureIds: [`${source.id}:NE_ID:2`], provider: 'legacy-ng', outline: 'missing', exceptions: [] },
  ];
  const inventory: WorldInventory = { schemaVersion: 1, sources: [source], nodes, outlines: [], sourceUnitCount: 2, exceptions: [] };
  const rawGeoJSON = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { NE_ID: 1, ISO_A3_EH: 'GHA', ADM0_A3: 'GHA' }, geometry: null },
    { type: 'Feature', properties: { NE_ID: 2, ISO_A3_EH: 'NGA', ADM0_A3: 'NGA' }, geometry: null },
  ] };
  const metadataBytes = Buffer.from(JSON.stringify([metadataRow('GHA'), metadataRow('NGA')]));
  const pin = { sourceUrl: FINE_CATALOGUE_URL, sha256: hash(metadataBytes), bytes: metadataBytes.length, capturedAt: '2026-10-08T02:47:11Z' };
  return { source, inventory, rawGeoJSON, metadataBytes, pin };
}

async function cacheFixture(paddingBytes = 0): Promise<{ root: string; cache: string; directoryHash: string }> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'fine-directory-catalogue-')));
  const cache = path.join(root, '.cache', 'world-build');
  const metadata = Buffer.from(JSON.stringify([metadataRow('GHA'), metadataRow('NGA')]));
  const metadataHash = hash(metadata), metadataPin = { sourceUrl: FINE_CATALOGUE_URL, sha256: metadataHash, bytes: metadata.length, capturedAt: '2026-10-08T02:47:11Z' };
  const feature = (ne: number, iso2: string, iso3: string, name: string) => ({ type: 'Feature', properties: { NE_ID: ne, ADMIN: name, CONTINENT: 'Africa', ISO_A2_EH: iso2, ISO_A3_EH: iso3, ADM0_A3: iso3, fixturePadding: 'x'.repeat(paddingBytes) }, geometry: { type: 'Polygon', coordinates: [[[-1, 0], [0, 0], [0, 1], [-1, 1], [-1, 0]]] } });
  const sourceBytes = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [feature(1, 'GH', 'GHA', 'Ghana'), feature(2, 'NG', 'NGA', 'Nigeria')] }));
  const source: SourceRecord = { id: 'natural-earth-admin0-10m-test', url: 'https://example.test/ne-10m.geojson', release: 'a'.repeat(40), license: 'Public-domain', attribution: 'Fixture only', sha256: hash(sourceBytes), bytes: sourceBytes.length };
  const baselineSource: SourceRecord = { ...source, id: 'natural-earth-admin0-110m-test', release: 'b'.repeat(40) };
  const compiled = compileCountryDirectory(source, sourceBytes, baselineSource, sourceBytes, 'd'.repeat(64));
  const published = await publishCountryDirectory(compiled, path.join(cache, 'output', 'country-inventory'), cache);
  const metadataPath = path.join(cache, 'fine-catalogue-cache', `all-adm1-metadata.${metadataHash}.json`);
  const input = `.cache/world-build/country-source-cache/${source.sha256}.geojson`;
  await mkdir(path.dirname(metadataPath), { recursive: true }); await mkdir(path.dirname(path.join(root, input)), { recursive: true });
  await writeFile(metadataPath, metadata); await writeFile(path.join(root, input), sourceBytes);
  await mkdir(path.join(root, 'world'), { recursive: true });
  await writeFile(path.join(root, 'world', 'fine-catalogue-sources.json'), JSON.stringify({ schemaVersion: 1, purpose: 'metadata-discovery-only', pin: metadataPin }));
  await writeFile(path.join(root, 'world', 'inventory-10m-sources.json'), JSON.stringify({ schemaVersion: 1, source, input, sourceFeatureCount: 2 }));
  return { root, cache, directoryHash: published.manifestHash };
}

test('emits a distinct v2 metadata discovery report bound to exact 10m directory manifest and all map units', () => {
  const x = fixture(), parentHash = 'c'.repeat(64);
  const report = buildFineDirectoryCatalogue(x.metadataBytes, x.pin, x.inventory, x.rawGeoJSON, parentHash);
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.purpose, 'metadata-discovery-only');
  assert.deepEqual(report.parent, { product: 'country-directory', manifestHash: parentHash });
  assert.equal(report.sourceCounts.coarseSourceUnits, 2);
  assert.equal(report.sourceCounts.coarseCountryNodes, 2);
  assert.equal(report.countries.length, 2);
  assert.equal(report.countries.find(country => country.countryId === 'legacy-ng')?.status, 'protected');
  assert.ok(report.exceptions.some(exception => exception.includes('pinned 1:10m country-directory')));
  assert.ok(!report.exceptions.some(exception => exception.includes('1:110m')));
});

test('rejects an unpinned parent or metadata bytes that do not match the exact metadata pin', () => {
  const x = fixture();
  assert.throws(() => buildFineDirectoryCatalogue(x.metadataBytes, x.pin, x.inventory, x.rawGeoJSON, '../' + 'd'.repeat(62)), /SHA-256/);
  assert.throws(() => buildFineDirectoryCatalogue(Buffer.from('[]'), x.pin, x.inventory, x.rawGeoJSON, 'c'.repeat(64)), /pin/);
});

test('cache CLI verifies the complete published directory and emits a deterministic private report with zero network', async () => {
  const { root, directoryHash } = await cacheFixture();
  try {
    const first = await buildFineDirectoryCatalogueFromCache({ repositoryRoot: root, directoryHash });
    const second = await buildFineDirectoryCatalogueFromCache({ repositoryRoot: root, directoryHash });
    assert.equal(first.status, 'verified'); assert.equal(first.networkBytes, 0); assert.equal(first.mapUnits, 2);
    assert.equal(first.reportHash, second.reportHash); assert.equal(first.reportPath, second.reportPath);
    const emitted = JSON.parse(await readFile(String(first.reportPath), 'utf8')) as { schemaVersion: number; parent: { manifestHash: string }; exceptions: string[] };
    assert.equal(emitted.schemaVersion, 2); assert.equal(emitted.parent.manifestHash, directoryHash);
    assert.ok(!emitted.exceptions.some(exception => exception.includes('1:110m')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('failed worker leaves a durable terminal audit record before releasing the shared lock', async () => {
  const { root, cache, directoryHash } = await cacheFixture();
  try {
    const configPath = path.join(root, 'world/inventory-10m-sources.json');
    const config = JSON.parse(await readFile(configPath, 'utf8')) as { input: string };
    const cachedSource = path.join(root, config.input);
    await writeFile(cachedSource, 'tampered');
    await assert.rejects(buildFineDirectoryCatalogueFromCache({ repositoryRoot: root, directoryHash }), /match the frozen pin/);
    const attempts = path.join(cache, 'fine-directory-catalogue/attempts');
    const files = await readdir(attempts);
    assert.equal(files.length, 1);
    const terminal = JSON.parse(await readFile(path.join(attempts, files[0]!), 'utf8')) as { status: string; error?: string };
    assert.equal(terminal.status, 'failed'); assert.match(terminal.error ?? '', /frozen pin/);
    await withAcquisitionBuildLock(path.join(root, '.cache/world-build'), async () => undefined, { timeoutMs: 1_000 });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('aborting a running worker waits for termination and records an aborted attempt', async () => {
  const { root, cache, directoryHash } = await cacheFixture(6 * 1024 * 1024);
  const controller = new AbortController();
  try {
    const build = buildFineDirectoryCatalogueFromCache({ repositoryRoot: root, directoryHash, signal: controller.signal });
    let pendingFound = false;
    const attempts = path.join(cache, 'fine-directory-catalogue/attempts');
    for (let i = 0; i < 2_000 && !pendingFound; i++) {
      try {
        for (const file of await readdir(attempts)) {
          const record = JSON.parse(await readFile(path.join(attempts, file), 'utf8')) as { status?: string };
          if (record.status === 'pending') { pendingFound = true; break; }
        }
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (!pendingFound) await new Promise(resolve => setTimeout(resolve, 1));
    }
    assert.equal(pendingFound, true, 'runner should start a durable attempt before invoking the worker');
    controller.abort(new Error('synthetic abort during worker execution'));
    await assert.rejects(build, /synthetic abort/);
    const records = await readdir(attempts);
    const terminal = JSON.parse(await readFile(path.join(attempts, records[0]!), 'utf8')) as { status: string };
    assert.equal(terminal.status, 'aborted');
    await withAcquisitionBuildLock(path.join(root, '.cache/world-build'), async () => undefined, { timeoutMs: 1_000 });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('refuses symlink output and aggregate output budget before starting an audited attempt', async () => {
  const symlinkFixture = await cacheFixture();
  try {
    const output = path.join(symlinkFixture.cache, 'fine-directory-catalogue');
    await mkdir(output, { recursive: true });
    const outside = path.join(symlinkFixture.root, 'outside'); await mkdir(outside);
    await symlink(outside, path.join(output, 'reports'));
    await assert.rejects(buildFineDirectoryCatalogueFromCache({ repositoryRoot: symlinkFixture.root, directoryHash: symlinkFixture.directoryHash }), /symlink/);
  } finally { await rm(symlinkFixture.root, { recursive: true, force: true }); }

  const budgetFixture = await cacheFixture();
  try {
    const output = path.join(budgetFixture.cache, 'fine-directory-catalogue');
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, 'filler.bin'), Buffer.alloc(19 * 1024 * 1024 + 64 * 1024));
    await assert.rejects(buildFineDirectoryCatalogueFromCache({ repositoryRoot: budgetFixture.root, directoryHash: budgetFixture.directoryHash }), /reserved space under 20 MiB/);
    await assert.rejects(lstat(path.join(output, 'attempts')), { code: 'ENOENT' });
  } finally { await rm(budgetFixture.root, { recursive: true, force: true }); }
});
