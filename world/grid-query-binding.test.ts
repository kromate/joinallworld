import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { compileCountryDirectory, publishCountryDirectory } from './country-directory.ts';
import { publishCountryGrid } from './country-grid-publish.ts';
import { validateCountryGridRequest } from './country-grid.ts';
import { createGridQueryCampaign, loadVerifiedGridQueryPlan, makeGridQueryUnit } from './grid-query-binding.ts';
import { createGridQueryResolver } from './grid-query.ts';
import type { SourceRecord } from './types.ts';
import type { GridQueryCampaign } from './grid-query-types.ts';

const sha = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const square = (x: number, y: number) => [[x,y],[x+0.4,y],[x+0.4,y+0.4],[x,y+0.4],[x,y]];
function raw(): Buffer { return Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { NE_ID: 1, ADMIN: 'Synthetic Senegal', CONTINENT: 'Africa', ISO_A2_EH: 'SN' }, geometry: { type: 'Polygon', coordinates: [square(-17, 14)] } },
  { type: 'Feature', properties: { NE_ID: 159, ADMIN: 'Nigeria', CONTINENT: 'Africa', ISO_A2_EH: 'NG' }, geometry: { type: 'Polygon', coordinates: [square(3, 4)] } },
] })); }
function source(bytes: Buffer, id: string): SourceRecord { return { id: `synthetic-${id}`, url: `https://example.invalid/${id}.geojson`, release: `${id}-fixture`, license: 'Public domain', attribution: 'Synthetic fixture, not geographic evidence', sha256: sha(bytes), bytes: bytes.byteLength }; }
async function fixture() {
 const tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'grid-query-binding-')));
 const allowedRoot = path.join(tmp, '.cache', 'world-build'), directoryRoot = path.join(allowedRoot, 'output', 'country-inventory');
 const bytes = raw(), src = source(bytes, 'candidate'), baseline = source(bytes, 'baseline');
 const dir = compileCountryDirectory(src, bytes, baseline, bytes, sha('synthetic baseline manifest'));
 const publishedDirectory = await publishCountryDirectory(dir, directoryRoot, allowedRoot);
 const request = validateCountryGridRequest({ schemaVersion: 1, id: 'query-fixture', directoryManifestHash: publishedDirectory.manifestHash,
  countryId: 'country:natural-earth:NE_ID%3A1', level: 1,
  limits: { positions: 1000, bboxCells: 1000, cells: 1000, operations: 100_000, outputBytes: 1_000_000 } });
 const outputRoot = path.join(allowedRoot, 'country-grids', request.id);
 const grid = await publishCountryGrid(request, { allowedRoot, directoryRoot, outputRoot, durationMs: 60_000, memoryMb: 256 });
 return { tmp, allowedRoot, directoryRoot, outputRoot, directoryHash: publishedDirectory.manifestHash, directoryManifestPath: path.join(directoryRoot, 'manifests', `${publishedDirectory.manifestHash}.json`), request, grid };
}
async function withFixture(run: (value: Awaited<ReturnType<typeof fixture>>) => Promise<void>): Promise<void> {
 const value = await fixture(); try { await run(value); } finally { await rm(value.tmp, { recursive: true, force: true }); }
}
const acquisitionLimits = { networkBytes: 1_000_000, outputBytes: 1_000_000, features: 100, durationMs: 60_000, memoryMb: 1024, diskBytes: 64_000_000 };
const campaignLimits = { durationMs: 600_000, jobDurationMs: 60_000, networkBytes: 2_000_000, inputBytes: 2_000_000, outputBytes: 2_000_000, diskBytes: 16_000_000, memoryMb: 1024, maxAttempts: 2 };
function campaignFor(plan: Awaited<ReturnType<typeof loadVerifiedGridQueryPlan>>, planHash: string): GridQueryCampaign {
 return createGridQueryCampaign(plan, { id: 'query-campaign', planHash, maxDepth: 3, maxJobs: 16, release: '2026-09-23.1', layers: ['buildings', 'roads'], requestLimits: acquisitionLimits, limits: campaignLimits });
}

test('loads only a completed immutable country-grid plan and creates deterministic root requests', async () => withFixture(async state => {
 const plan = await loadVerifiedGridQueryPlan(state.grid.planPath, state.grid.planHash, state.directoryManifestPath);
 const campaign = campaignFor(plan, state.grid.planHash);
 assert.equal(campaign.schemaVersion, 2);
 assert.equal(campaign.inventoryKind, 'country-directory');
 assert.equal(campaign.inventoryHash, state.directoryHash);
 assert.equal(campaign.gridQuery.planHash, state.grid.planHash);
 assert.throws(() => campaignFor(plan, 'a'.repeat(64)), /plan hash/);
 assert.deepEqual(campaign.units.map(unit => unit.priority), plan.cells.map((_, i) => i));
 assert.deepEqual(campaign.units.map(unit => unit.query.path), plan.cells.map(() => ''));
 for (const [i, unit] of campaign.units.entries()) {
  assert.equal(unit.kind, 'grid-query');
  assert.equal(unit.request.region.kind, 'cell');
  assert.equal(unit.request.region.id, unit.query.rootCellId);
  assert.deepEqual(unit.request.region.bounds, plan.cells[i]!.bounds);
  assert.equal(unit.request.region.countryCode, 'SN');
 }
 assert.equal((await loadVerifiedGridQueryPlan(state.grid.planPath, state.grid.planHash, state.directoryManifestPath)).requestHash, plan.requestHash);
}));

test('rejects mismatched plan hash, missing completion, and changed directory binding without repairs', async () => withFixture(async state => {
 await assert.rejects(loadVerifiedGridQueryPlan(state.grid.planPath, 'a'.repeat(64), state.directoryManifestPath), /hash/);
 await rm(state.grid.completion.path);
 await assert.rejects(loadVerifiedGridQueryPlan(state.grid.planPath, state.grid.planHash, state.directoryManifestPath), /ENOENT|missing/);
 await assert.equal((await readFile(state.grid.planPath)).byteLength, state.grid.bytes);
}));

test('subdivision helper derives exact dyadic bounds and preserves root request identity', async () => withFixture(async state => {
 const plan = await loadVerifiedGridQueryPlan(state.grid.planPath, state.grid.planHash, state.directoryManifestPath);
 const campaign = campaignFor(plan, state.grid.planHash), root = campaign.units[0]!;
 const resolver = createGridQueryResolver(plan, campaign.gridQuery);
 const child = makeGridQueryUnit(plan, { rootCellId: root.query.rootCellId, path: '2' }, campaign.gridQuery, root, resolver);
 const [west, south, east, north] = root.request.region.bounds;
 assert.deepEqual(child.request.region.bounds, [west, south + (north - south) / 2, west + (east - west) / 2, north]);
 assert.equal(child.priority, root.priority);
 assert.equal(child.inventoryUnitId, root.inventoryUnitId);
 assert.equal(child.request.release, root.request.release);
 assert.deepEqual(child.request.layers, root.request.layers);
 assert.equal(child.id, `grid-query:${root.query.rootCellId}:q2`);
 assert.throws(() => makeGridQueryUnit(plan, { rootCellId: root.query.rootCellId, path: '3333' }, campaign.gridQuery, root), /depth/);
 assert.throws(() => makeGridQueryUnit(plan, { rootCellId: root.query.rootCellId, path: '0' }, { ...campaign.gridQuery, planHash: 'b'.repeat(64) }, root), /binding|plan/);
}));

test('refuses path traversal and symlinked plan ancestors', async () => withFixture(async state => {
 const external = path.join(state.tmp, 'outside.json'); await writeFile(external, await readFile(state.grid.planPath));
 await assert.rejects(loadVerifiedGridQueryPlan(external, state.grid.planHash, state.directoryManifestPath), /path|namespace/);
 const plans = path.dirname(state.grid.planPath), saved = `${plans}-saved`;
 await rename(plans, saved); await symlink(saved, plans);
 await assert.rejects(loadVerifiedGridQueryPlan(state.grid.planPath, state.grid.planHash, state.directoryManifestPath), /symlink/);
}));

test('requires the directory manifest path to match the plan-bound inventory hash', async () => withFixture(async state => {
 const wrong = path.join(state.directoryRoot, 'manifests', `${'a'.repeat(64)}.json`);
 await assert.rejects(loadVerifiedGridQueryPlan(state.grid.planPath, state.grid.planHash, wrong), /symlink|country directory manifest path/);
 assert.equal((await readFile(state.grid.planPath)).byteLength, state.grid.bytes);
}));
