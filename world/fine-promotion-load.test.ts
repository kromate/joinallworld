import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildInventory } from './inventory.ts';
import { compileCountryDirectory, publishCountryDirectory } from './country-directory.ts';
import { buildFineDirectoryCatalogue } from './fine-directory-catalogue.ts';
import { FINE_CATALOGUE_URL } from './fine-catalogue.ts';
import { loadFinePromotionContext } from './fine-promotion-load.ts';
import type { SourceRecord } from './types.ts';

const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const metadataRow = (iso: string) => ({ boundaryID: `${iso}-ADM1-1`, boundaryISO: iso, boundaryName: iso, boundaryType: 'ADM1', admUnitCount: '3', gjDownloadURL: `https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/${iso}/ADM1/geoBoundaries-${iso}-ADM1.geojson`, boundaryCanonical: 'Province', boundaryYearRepresented: '2020', buildDate: 'Dec 12, 2023', boundarySource: 'Fixture', boundaryLicense: 'Public Domain', licenseSource: 'example.test/license' });

async function fixture(): Promise<{ root: string; reportPath: string; reportHash: string; metadataPath: string; directoryHash: string }> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'fine-promotion-load-')));
  const build = path.join(root, '.cache', 'world-build');
  const feature = (ne: number, iso2: string, iso3: string, name: string) => ({ type: 'Feature', properties: { NE_ID: ne, ADMIN: name, CONTINENT: 'Africa', ISO_A2_EH: iso2, ISO_A3_EH: iso3, ADM0_A3: iso3 }, geometry: { type: 'Polygon', coordinates: [[[ne, 0], [ne + 1, 0], [ne + 1, 1], [ne, 1], [ne, 0]]] } });
  const raw = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [feature(1, 'GH', 'GHA', 'Ghana'), feature(2, 'NG', 'NGA', 'Nigeria')] }));
  const source: SourceRecord = { id: 'natural-earth-admin0-promotion-fixture', url: 'https://example.test/ne.geojson', release: 'a'.repeat(40), license: 'Public domain', attribution: 'Synthetic fixture', sha256: hash(raw), bytes: raw.length };
  const inventory = buildInventory(source, JSON.parse(raw.toString('utf8')) as unknown);
  const metadataBytes = Buffer.from(JSON.stringify([metadataRow('GHA'), metadataRow('NGA')]));
  const pin = { sourceUrl: FINE_CATALOGUE_URL, sha256: hash(metadataBytes), bytes: metadataBytes.length, capturedAt: '2026-10-08T02:47:11Z' };
  const metadataPath = path.join(build, 'fine-catalogue-cache', `all-adm1-metadata.${pin.sha256}.json`);
  await mkdir(path.dirname(metadataPath), { recursive: true }); await writeFile(metadataPath, metadataBytes);
  const published = await publishCountryDirectory(compileCountryDirectory(source, raw, source, raw, 'd'.repeat(64)), path.join(build, 'output', 'country-inventory'), build);
  const catalogue = buildFineDirectoryCatalogue(metadataBytes, pin, inventory, JSON.parse(raw.toString('utf8')) as unknown, published.manifestHash);
  const catalogueBytes = Buffer.from(`${JSON.stringify(catalogue, null, 2)}\n`), reportHash = hash(catalogueBytes);
  const reportPath = path.join(build, 'fine-directory-catalogue', 'reports', `${reportHash}.json`);
  await mkdir(path.dirname(reportPath), { recursive: true }); await writeFile(reportPath, catalogueBytes);
  return { root, reportPath, reportHash, metadataPath, directoryHash: published.manifestHash };
}

test('loads a fully hash-pinned promotion context from the private cache without writes', async () => {
  const f = await fixture();
  try {
    const loaded = await loadFinePromotionContext({ repositoryRoot: f.root, catalogueHash: f.reportHash });
    assert.equal(loaded.catalogueHash, f.reportHash);
    assert.equal(loaded.directory.manifestHash, f.directoryHash);
    assert.equal(loaded.catalogue.countries.length, 2);
    assert.equal(loaded.catalogue.countries.find(country => country.countryId === 'legacy-ng')?.status, 'protected');
    assert.equal(hash(loaded.catalogueBytes), f.reportHash);
    assert.equal(hash(loaded.metadataBytes), loaded.catalogue.pin.sha256);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('rejects report hash mismatch, symlink report, and noncanonical repository root', async () => {
  const f = await fixture();
  try {
    await assert.rejects(loadFinePromotionContext({ repositoryRoot: f.root, catalogueHash: 'f'.repeat(64) }), /ENOENT|hash/);
    const alias = `${f.root}-alias`; await symlink(f.root, alias);
    await assert.rejects(loadFinePromotionContext({ repositoryRoot: alias, catalogueHash: f.reportHash }), /canonical|symlink/);
    await rm(f.reportPath); await symlink(f.metadataPath, f.reportPath);
    await assert.rejects(loadFinePromotionContext({ repositoryRoot: f.root, catalogueHash: f.reportHash }), /symlink|non-regular/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('rejects corrupted frozen metadata bytes before returning any context', async () => {
  const f = await fixture();
  try {
    await writeFile(f.metadataPath, 'tampered metadata');
    await assert.rejects(loadFinePromotionContext({ repositoryRoot: f.root, catalogueHash: f.reportHash }), /metadata bytes do not match report pin/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('checks report parent, source, and every country identity against the verified directory', async () => {
  for (const mutate of [
    (report: Record<string, unknown>) => { (report.parent as Record<string, unknown>).manifestHash = 'e'.repeat(64); },
    (report: Record<string, unknown>) => { ((report.coarseSources as Array<Record<string, unknown>>)[0]!).sha256 = 'e'.repeat(64); },
    (report: Record<string, unknown>) => { const row = (report.countries as Array<Record<string, unknown>>).find(country => country.countryId === 'country:natural-earth:NE_ID%3A1')!; row.name = 'Forged name'; },
    (report: Record<string, unknown>) => { const row = (report.countries as Array<Record<string, unknown>>).find(country => country.countryId === 'country:natural-earth:NE_ID%3A1')!; row.sourceFeatureIds = ['natural-earth-admin0-promotion-fixture:NE_ID:999']; },
    (report: Record<string, unknown>) => { (report.sourceCounts as Record<string, unknown>).coarseSourceUnits = 999; },
  ]) {
    const f = await fixture();
    try {
      const report = JSON.parse(await readFile(f.reportPath, 'utf8')) as Record<string, unknown>;
      mutate(report);
      const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`), reportHash = hash(bytes);
      await rm(f.reportPath); const newPath = path.join(path.dirname(f.reportPath), `${reportHash}.json`); await writeFile(newPath, bytes);
      await assert.rejects(loadFinePromotionContext({ repositoryRoot: f.root, catalogueHash: reportHash }), /parent hash|ENOENT|coarse source|differs from verified directory/);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});

test('honors a pre-aborted signal before reading private artifacts', async () => {
  const f = await fixture(), controller = new AbortController();
  controller.abort(new Error('synthetic cancellation'));
  try { await assert.rejects(loadFinePromotionContext({ repositoryRoot: f.root, catalogueHash: f.reportHash, signal: controller.signal }), /synthetic cancellation/); }
  finally { await rm(f.root, { recursive: true, force: true }); }
});
