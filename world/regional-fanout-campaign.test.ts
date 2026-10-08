import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createRegionalFanoutCampaign } from './regional-fanout-campaign.ts';
import { publishRegionalFanout } from './regional-fanout-publish.ts';
import { runCampaign } from './campaign.ts';
import { canonicalJson, sha256 } from './pack.ts';
import type { RegionalFanoutRequest } from './regional-fanout-types.ts';

const exec = promisify(execFile);
const jsonBytes = (value: unknown) => Buffer.from(`${canonicalJson(value)}\n`);
test('regional local campaign resumes all cells, keeps a touched empty owner cell, and independently rejects rehashed coordinate changes', async () => {
  const root = await mkdtemp(path.join(await realpath(tmpdir()), 'world-regional-campaign-'));
  try {
    const input = jsonBytes({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 'crossing-road', properties: { highway: 'residential' }, geometry: { type: 'LineString', coordinates: [[0.2, 0.4], [1.4, 0.4]] } }] });
    const source = { id: 'test-source', url: 'https://example.com/source', release: 'frozen', license: 'test', attribution: 'synthetic test', sha256: sha256(input), bytes: input.length };
    const parent = { id: 'parent-extraction', parentId: 'country:test:sn', kind: 'cell' as const, countryCode: 'SN', timezone: 'Africa/Dakar', name: 'Synthetic local source', bounds: [0, 0, 2, 1] as [number, number, number, number] };
    const request: RegionalFanoutRequest = { schemaVersion: 1, id: 'synthetic', inventoryHash: 'a'.repeat(64), inventoryUnitId: parent.parentId,
      parentPlan: { region: parent, source, input: { path: path.join(root, 'parent.geojson'), sha256: source.sha256, bytes: source.bytes } }, parentAcquisition: null,
      children: [{ ...parent, id: 'a-left', bounds: [0, 0, 1, 1] }, { ...parent, id: 'b-right', bounds: [1, 0, 2, 1] }],
      limits: { inputBytes: 20_000, features: 5, coordinates: 50, children: 4, outputBytes: 100_000 } };
    await writeFile(request.parentPlan.input.path, input);
    const product = await publishRegionalFanout(request, { allowedRoot: root, outputRoot: path.join(root, 'regional-fanout', 'synthetic'), durationMs: 30_000, memoryMb: 512 });
    assert.equal(product.index.cells[1]!.status, 'empty-owned');
    assert.deepEqual(product.index.cells[1]!.ownerDependencies, ['a-left']);
    assert.equal(product.index.cells[1]!.touchingFeatureKeys.length, 1);
    const campaign = createRegionalFanoutCampaign(product, 'regional-local-test');
    assert.equal(campaign.units.length, 2); // One nonempty owner job plus protected Nigeria.
    let acquisitions = 0;
    // Existing campaign accepts the OS's lexical tmpdir and canonicalizes it internally;
    // the fan-out publisher requires an already canonical root. Both resolve to this fixture.
    const state = path.join(tmpdir(), path.relative(await realpath(tmpdir()), root), 'campaigns');
    const options = { allowedRoot: state, acquire: async () => { acquisitions++; throw new Error('local campaign must never acquire'); } };
    const partial = await runCampaign(campaign, { ...options, maxJobs: 1 });
    assert.equal(partial.status, 'stopped');
    const complete = await runCampaign(campaign, options);
    assert.equal(complete.status, 'complete', JSON.stringify(complete.jobs.map(job => ({ status: job.status, error: job.error, result: job.result }))));
    assert.equal(complete.counts.compiled, 1); // Country rollup; index separately accounts for both cells.
    assert.equal(complete.counts.protected, 1);
    const replay = await runCampaign(campaign, options);
    assert.deepEqual(replay, complete);
    assert.equal(acquisitions, 0);
    assert.ok(complete.jobs.every(job => job.attempt === 1));
    assert.throws(() => createRegionalFanoutCampaign({ ...product, plans: product.plans.slice(0, 1) }, 'bad'), /every declared cell/);
    const reportPath = path.join(root, 'report.json');
    const reportBytes = jsonBytes(complete);
    await writeFile(reportPath, reportBytes);
    const tool = fileURLToPath(new URL('./tooling/verify_regional_campaign.py', import.meta.url));
    const auditArgs = ['--root', root, '--index-path', path.relative(root, product.indexPath), '--index-hash', product.indexHash, '--report-path', 'report.json', '--report-hash', sha256(reportBytes)];
    const verified = JSON.parse((await exec('python3', [tool, ...auditArgs], { timeout: 20_000 })).stdout);
    assert.equal(verified.emittedParts, 1);
    assert.equal(verified.cells.length, 2); // Independent report still retains the full denominator.
    // Change a source coordinate, then rehash both tile and manifest and update result bytes.
    // A hash-only verifier would accept this; the independent source comparison must reject it.
    const altered = structuredClone(complete);
    const job = altered.jobs.find(j => (j.payload as { unit: { id: string } }).unit.id === 'a-left')!;
    const result = job.result as { manifestHash: string; manifestPath: string; bytes: number };
    const output = path.join(root, 'campaigns', campaign.id, 'output');
    const manifest = JSON.parse(await readFile(path.join(output, result.manifestPath), 'utf8'));
    const ref = manifest.tiles[0];
    const tile = JSON.parse(await readFile(path.join(output, ref.path), 'utf8'));
    tile.roads[0].points[0][0] = 0.21;
    const changedTile = jsonBytes(tile);
    ref.bytes = changedTile.length; ref.sha256 = sha256(changedTile); ref.path = `tiles/${ref.sha256}.json`;
    await writeFile(path.join(output, ref.path), changedTile);
    const changedManifest = jsonBytes(manifest);
    result.manifestHash = sha256(changedManifest); result.manifestPath = `manifests/${result.manifestHash}.json`; result.bytes = changedManifest.length + manifest.tiles.reduce((sum: number, r: { bytes: number }) => sum + r.bytes, 0);
    await writeFile(path.join(output, result.manifestPath), changedManifest);
    const changedReport = jsonBytes(altered);
    await writeFile(reportPath, changedReport);
    await assert.rejects(exec('python3', [tool, ...auditArgs.slice(0, -1), sha256(changedReport)], { timeout: 20_000 }), /changed or foreign emitted source part/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
