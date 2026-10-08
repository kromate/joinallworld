import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { AcquisitionBudgetError } from './acquisition-errors.ts';
import { campaignStatus, runCampaign, validateCampaign } from './campaign.ts';
import { compileCountryDirectory, publishCountryDirectory } from './country-directory.ts';
import { publishCountryGrid } from './country-grid-publish.ts';
import { validateCountryGridRequest } from './country-grid.ts';
import { createGridQueryCampaign, loadVerifiedGridQueryPlan } from './grid-query-binding.ts';
import type { AcquisitionOptions, AcquisitionRequest, AcquisitionResult } from './production-types.ts';
import type { SourceRecord } from './types.ts';

const sha = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const square = [[-17.2, 14.1], [-17.1, 14.1], [-17.1, 14.2], [-17.2, 14.2], [-17.2, 14.1]];
const sourceRecord = (bytes: Uint8Array, id: string): SourceRecord => ({
  id: `synthetic-${id}`, url: `https://example.invalid/${id}.geojson`, release: `${id}-fixture`,
  license: 'Public domain', attribution: 'Synthetic fixture only', sha256: sha(bytes), bytes: bytes.byteLength,
});

async function fixture(id: string) {
  const tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'grid-query-campaign-products-')));
  const campaignTemp = await mkdtemp(path.join(os.tmpdir(), 'grid-query-campaign-state-'));
  const allowedRoot = path.join(tmp, '.cache', 'world-build');
  const directoryRoot = path.join(allowedRoot, 'output', 'country-inventory');
  const sourceBytes = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { NE_ID: 1, ADMIN: 'Synthetic Senegal', CONTINENT: 'Africa', ISO_A2_EH: 'SN' }, geometry: { type: 'Polygon', coordinates: [square] } },
    { type: 'Feature', properties: { NE_ID: 159, ADMIN: 'Nigeria', CONTINENT: 'Africa', ISO_A2_EH: 'NG' }, geometry: { type: 'Polygon', coordinates: [[[-1, 4], [0, 4], [0, 5], [-1, 5], [-1, 4]]] } },
  ] }));
  const source = sourceRecord(sourceBytes, `${id}-source`), baseline = sourceRecord(sourceBytes, `${id}-baseline`);
  const compiledDirectory = compileCountryDirectory(source, sourceBytes, baseline, sourceBytes, sha(`${id}-baseline-manifest`));
  const directory = await publishCountryDirectory(compiledDirectory, directoryRoot, allowedRoot);
  const gridRequest = validateCountryGridRequest({ schemaVersion: 1, id: `${id}-grid`, directoryManifestHash: directory.manifestHash,
    countryId: 'country:natural-earth:NE_ID%3A1', level: 1,
    limits: { positions: 100, bboxCells: 100, cells: 100, operations: 100_000, outputBytes: 1_000_000 } });
  const grid = await publishCountryGrid(gridRequest, { allowedRoot, directoryRoot, outputRoot: path.join(allowedRoot, 'country-grids', gridRequest.id), durationMs: 60_000, memoryMb: 256 });
  const plan = await loadVerifiedGridQueryPlan(grid.planPath, grid.planHash, directory.manifestPath);
  return { tmp, campaignTemp, allowedRoot, directoryRoot, directoryPath: directory.manifestPath, directoryHash: directory.manifestHash, grid, plan };
}

const requestLimits = { networkBytes: 50_000, outputBytes: 1_000_000, features: 100, durationMs: 60_000, memoryMb: 1024, diskBytes: 64_000_000 };
const limits = { durationMs: 600_000, jobDurationMs: 60_000, networkBytes: 200_000, inputBytes: 8_000_000, outputBytes: 2_000_000, diskBytes: 16_000_000, memoryMb: 1024, maxAttempts: 1 };
function campaignFor(state: Awaited<ReturnType<typeof fixture>>, id: string, overrides: { maxDepth?: number; maxJobs?: number } = {}) {
  return createGridQueryCampaign(state.plan, { id, planHash: state.grid.planHash, maxDepth: overrides.maxDepth ?? 2,
    maxJobs: overrides.maxJobs ?? state.plan.cells.length + 4, release: '2026-09-23.1', layers: ['buildings'], requestLimits, limits });
}

function makeAcquire(state: Awaited<ReturnType<typeof fixture>>, beforeReturn?: (request: AcquisitionRequest, call: number) => void | Promise<void>, historicalNetworkBytes = 0) {
  let calls = 0;
  const acquire = async (request: AcquisitionRequest, options: AcquisitionOptions): Promise<AcquisitionResult> => {
    const call = ++calls;
    await beforeReturn?.(request, call);
    const { limits: _limits, ...selection } = request;
    const sourceConfig = JSON.parse(await readFile(new URL('./acquisition-sources.json', import.meta.url), 'utf8')) as unknown;
    const requestHash = sha(canonical({ compiler: 'world-source-compiler-v2', selection, sourceConfig }));
    const bytes = Buffer.from(`${canonical({ type: 'FeatureCollection', metadata: { requestHash }, features: [] })}\n`);
    const inputPath = path.join(options.allowedRoot, `${requestHash}.geojson`);
    const receiptPath = path.join(options.allowedRoot, `${requestHash}.receipt.json`);
    await mkdir(options.allowedRoot, { recursive: true });
    await writeFile(inputPath, bytes);
    const configured = sourceConfig as { licenses: { buildings: string }; attribution: { buildings: string }; stac: { collections: { buildings: { url: string } } } };
    const metrics = { networkBytes: 0, outputBytes: bytes.byteLength, features: 0, elapsedMs: 1 };
    const receiptMetrics = { ...metrics, networkBytes: historicalNetworkBytes };
    const receiptUpstream = historicalNetworkBytes > 0 ? [{ url: 'https://stac.overturemaps.org/2026-09-23.1/buildings/building/collection.json', etag: null, bytes: historicalNetworkBytes }] : [];
    const sources = [{ id: `overture-2026-09-23.1-buildings`, url: configured.stac.collections.buildings.url, release: '2026-09-23.1',
      license: configured.licenses.buildings, attribution: configured.attribution.buildings, sha256: sha('synthetic query source'), bytes: 1 }];
    const receipt = { schemaVersion: 1, requestHash, selection, request, completedAt: new Date().toISOString(), inputSha256: sha(bytes), inputBytes: bytes.byteLength,
      metrics: receiptMetrics, upstream: receiptUpstream, sources, exceptions: [] };
    await writeFile(receiptPath, `${canonical(receipt)}\n`);
    const result: AcquisitionResult = {
      plan: { region: request.region, source: sourceRecord(bytes, 'query-extract'), input: { path: inputPath, sha256: sha(bytes), bytes: bytes.byteLength } },
      requestHash, receiptPath, metrics, upstream: [], exceptions: [],
    };
    return result;
  };
  return { acquire, calls: () => calls };
}

function editLedgerResult(file: string, jobId: string, edit: (value: Record<string, unknown>) => void): void {
  const db = new DatabaseSync(file);
  try {
    const row = db.prepare('SELECT result FROM jobs WHERE id=?').get(jobId) as { result: string | null } | undefined;
    assert.ok(row?.result, `completed result exists for ${jobId}`);
    const result = JSON.parse(row.result) as Record<string, unknown>;
    edit(result);
    db.prepare('UPDATE jobs SET result=? WHERE id=?').run(canonical(result), jobId);
  } finally { db.close(); }
}

function deleteLedgerJob(file: string, jobId: string): void {
  const db = new DatabaseSync(file);
  try { db.prepare('DELETE FROM jobs WHERE id=?').run(jobId); } finally { db.close(); }
}

async function withFixture(run: (state: Awaited<ReturnType<typeof fixture>>) => Promise<void>): Promise<void> {
  const state = await fixture('campaign-test');
  try { await run(state); } finally { await rm(state.tmp, { recursive: true, force: true }); await rm(state.campaignTemp, { recursive: true, force: true }); }
}

test('captures a zero-supported-feature extract as source-query evidence, not compiled geometry', async () => withFixture(async state => {
  assert.equal(state.plan.cells.length, 1, 'fixture isolates one frozen root cell');
  const campaign = campaignFor(state, 'zero-query-test');
  const injected = makeAcquire(state, undefined, 17);
  const report = await runCampaign(campaign, { allowedRoot: path.join(state.campaignTemp, 'campaign-state'), inventoryManifestPath: state.directoryPath,
    countryGridPlanPath: state.grid.planPath, acquire: injected.acquire });
  assert.equal(report.status, 'complete', report.failures.join('; '));
  assert.equal(injected.calls(), 1);
  assert.deepEqual(report.queryCoverage?.roots, { requested: 1, captured: 1, exception: 0, pending: 0 });
  assert.deepEqual(report.queryCoverage?.jobs, { total: 1, subdivided: 0, captured: 1, zeroSupportedFeatures: 1, failed: 0, queued: 0, leased: 0 });
  assert.equal(report.queryCoverage?.coverage, 'source-query-only');
  assert.equal(report.queryCoverage?.geometryCoverage, 'not-compiled');
  assert.equal(report.queryCoverage?.supportedFeatureRows, 0);
  assert.equal(report.counts.compiled, 0);
  const capture = report.jobs[0]!.result as { metrics: { networkBytes: number }; upstream: unknown[]; receiptPath: string };
  const historicalReceipt = JSON.parse(await readFile(capture.receiptPath, 'utf8')) as { metrics: { networkBytes: number }; upstream: Array<{ bytes: number }> };
  assert.equal(capture.metrics.networkBytes, 0, 'cache-return metrics report no current request traffic');
  assert.deepEqual(capture.upstream, [], 'cache-return acquisition result omits historical upstream rows');
  assert.equal(historicalReceipt.metrics.networkBytes, 17, 'the immutable receipt retains the original acquisition measurement');
  assert.equal(historicalReceipt.upstream.reduce((sum, row) => sum + row.bytes, 0), 17);
}));

test('typed budget failure atomically subdivides, persists measured usage, and resumes every child', async () => withFixture(async state => {
  const campaign = campaignFor(state, 'split-resume-test');
  let failedOnce = false;
  const first = makeAcquire(state, (_request, call) => {
    if (!failedOnce && call === 1) { failedOnce = true; throw new AcquisitionBudgetError('feature-row-budget', 3); }
  });
  const campaignRoot = path.join(state.campaignTemp, 'campaign-state');
  const paused = await runCampaign(campaign, { allowedRoot: campaignRoot, inventoryManifestPath: state.directoryPath,
    countryGridPlanPath: state.grid.planPath, acquire: first.acquire, maxJobs: 1 });
  assert.equal(paused.status, 'stopped');
  assert.equal(paused.jobs.length, 5);
  const parent = paused.jobs.find(job => job.id === `${campaign.id}:${campaign.units[0]!.id}`)!;
  assert.equal(parent.status, 'completed');
  assert.equal((parent.result as { status: string }).status, 'query-subdivided');
  assert.equal(paused.jobs.filter(job => job.status === 'queued').length, 4);
  assert.equal(first.calls(), 1);
  const usage = (await readFile(path.join(campaignRoot, campaign.id, 'usage.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { phase: string; networkBytes: number });
  assert.ok(usage.some(row => row.phase === 'settled' && row.networkBytes === 3), 'typed failure charges its measured bytes');

  const resumed = makeAcquire(state);
  const complete = await runCampaign(campaign, { allowedRoot: campaignRoot, inventoryManifestPath: state.directoryPath,
    countryGridPlanPath: state.grid.planPath, acquire: resumed.acquire });
  assert.equal(complete.status, 'complete', complete.failures.join('; '));
  assert.equal(resumed.calls(), 4);
  assert.equal(complete.queryCoverage?.roots.captured, 1);
  assert.equal(complete.queryCoverage?.jobs.subdivided, 1);
  assert.equal(complete.queryCoverage?.jobs.captured, 4);
  assert.equal(complete.queryCoverage?.jobs.zeroSupportedFeatures, 4);
  const status = await campaignStatus(campaign.id, { allowedRoot: campaignRoot });
  assert.deepEqual(status.queryCoverage, complete.queryCoverage);
}));

test('one opaque child failure leaves the subdivided root exceptional and never counts compiled coverage', async () => withFixture(async state => {
  const campaign = campaignFor(state, 'split-child-failure-test'), campaignRoot = path.join(state.campaignTemp, campaign.id);
  let split = false;
  const rootAcquire = makeAcquire(state, (_request, call) => {
    if (call === 1 && !split) { split = true; throw new AcquisitionBudgetError('feature-row-budget', 3); }
  });
  const options = { allowedRoot: campaignRoot, inventoryManifestPath: state.directoryPath, countryGridPlanPath: state.grid.planPath };
  const paused = await runCampaign(campaign, { ...options, acquire: rootAcquire.acquire, maxJobs: 1 });
  assert.equal(paused.status, 'stopped');
  assert.equal(paused.jobs.length, 5);

  const childAcquire = makeAcquire(state, (_request, call) => {
    if (call === 1) throw new Error('opaque child transport interruption');
  });
  const resumed = await runCampaign(campaign, { ...options, acquire: childAcquire.acquire });
  assert.equal(childAcquire.calls(), 4, `${resumed.jobs.map(job => `${String(job.id)}=${String(job.status)}`).join(', ')}; ${resumed.failures.join('; ')}`);
  assert.equal(resumed.status, 'exception');
  assert.equal(resumed.counts.compiled, 0);
  assert.equal(resumed.queryCoverage?.roots.exception, 1);
  assert.equal(resumed.queryCoverage?.roots.captured, 0);
  assert.equal(resumed.queryCoverage?.jobs.subdivided, 1);
  assert.equal(resumed.queryCoverage?.jobs.failed, 1);
  assert.equal(resumed.queryCoverage?.jobs.captured, 3);
}));

test('opaque transport failure is charged at its full reservation and never triggers subdivision', async () => withFixture(async state => {
  const campaign = campaignFor(state, 'opaque-query-test'), campaignRoot = path.join(state.campaignTemp, 'campaign-state');
  let calls = 0;
  const acquire = async (): Promise<AcquisitionResult> => { calls++; throw new Error('transport interrupted'); };
  const report = await runCampaign(campaign, { allowedRoot: campaignRoot, inventoryManifestPath: state.directoryPath,
    countryGridPlanPath: state.grid.planPath, acquire });
  assert.equal(report.status, 'exception');
  assert.equal(calls, 1);
  assert.equal(report.jobs.length, 1);
  assert.equal(report.jobs[0]?.status, 'failed');
  assert.equal(report.queryCoverage?.jobs.failed, 1);
  assert.equal(report.queryCoverage?.jobs.subdivided, 0);
  const usage = (await readFile(path.join(campaignRoot, campaign.id, 'usage.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { phase: string; networkBytes: number });
  assert.ok(usage.some(row => row.phase === 'settled' && row.networkBytes === requestLimits.networkBytes), 'opaque failure retains the full bounded network reservation');
}));

test('depth and job caps make a typed subdivision terminal without enqueuing partial children', async () => withFixture(async state => {
  for (const [id, options] of [['depth-cap-test', { maxDepth: 0 }], ['job-cap-test', { maxDepth: 2, maxJobs: 1 }]] as const) {
    const campaign = campaignFor(state, id, options), campaignRoot = path.join(state.campaignTemp, id);
    let calls = 0;
    const acquire = async (): Promise<AcquisitionResult> => { calls++; throw new AcquisitionBudgetError('selected-item-count', 2); };
    const report = await runCampaign(campaign, { allowedRoot: campaignRoot, inventoryManifestPath: state.directoryPath,
      countryGridPlanPath: state.grid.planPath, acquire });
    assert.equal(report.status, 'exception');
    assert.equal(report.jobs.length, 1, 'atomic subdivision never leaves a partial child set');
    assert.equal(report.jobs[0]?.status, 'failed');
    assert.equal(report.queryCoverage?.jobs.subdivided, 0);
    assert.equal(report.queryCoverage?.roots.exception, 1);
    assert.equal(calls, 1);
  }
}));

test('completed captures fail closed on changed source or receipt and do not reacquire', async () => withFixture(async state => {
  for (const [id, corruptReceipt] of [['corrupt-source-test', false], ['corrupt-receipt-test', true]] as const) {
    const campaign = campaignFor(state, id), campaignRoot = path.join(state.campaignTemp, id), injected = makeAcquire(state);
    const options = { allowedRoot: campaignRoot, inventoryManifestPath: state.directoryPath, countryGridPlanPath: state.grid.planPath, acquire: injected.acquire };
    const initial = await runCampaign(campaign, options);
    assert.equal(initial.status, 'complete', initial.failures.join('; '));
    const result = initial.jobs[0]!.result as { plan: { input: { path: string } }; receiptPath: string };
    await appendFile(corruptReceipt ? result.receiptPath : result.plan.input.path, 'corruption');
    await assert.rejects(campaignStatus(campaign.id, { allowedRoot: campaignRoot }), /missing or corrupt|receipt does not bind|does not match/);
    await assert.rejects(runCampaign(campaign, options), /missing or corrupt|receipt does not bind|does not match/);
    assert.equal(injected.calls(), 1, 'resume must validate immutable evidence before considering new acquisition');
  }
}));

test('initially queued and missing-ledger roots remain pending; resume reseeds the exact root once', async () => withFixture(async state => {
  const campaign = campaignFor(state, 'pending-root-resume-test'), campaignRoot = path.join(state.campaignTemp, campaign.id);
  const injected = makeAcquire(state);
  const options = { allowedRoot: campaignRoot, inventoryManifestPath: state.directoryPath, countryGridPlanPath: state.grid.planPath, acquire: injected.acquire };
  const paused = await runCampaign(campaign, { ...options, maxJobs: 0 });
  assert.equal(paused.status, 'stopped');
  const pending = await campaignStatus(campaign.id, { allowedRoot: campaignRoot });
  assert.equal(pending.status, 'running');
  assert.equal(pending.queryCoverage?.roots.pending, 1);
  assert.equal(pending.queryCoverage?.roots.captured, 0);

  deleteLedgerJob(path.join(campaignRoot, campaign.id, 'ledger.sqlite'), `${campaign.id}:${campaign.units[0]!.id}`);
  const lost = await campaignStatus(campaign.id, { allowedRoot: campaignRoot });
  assert.equal(lost.status, 'running');
  assert.equal(lost.queryCoverage?.roots.pending, 1);
  assert.equal(lost.queryCoverage?.jobs.total, 0);

  const complete = await runCampaign(campaign, options);
  assert.equal(injected.calls(), 1);
  assert.equal(complete.status, 'complete', complete.failures.join('; '));
  assert.equal(complete.jobs.length, 1, 'resume reseeds the frozen root instead of duplicating it');
  assert.equal(complete.queryCoverage?.jobs.total, 1);
  assert.equal(complete.queryCoverage?.roots.captured, 1);
}));

test('status and resume reject forged completed-capture metrics without another acquisition', async () => withFixture(async state => {
  for (const [id, field, value] of [
    ['bad-output-metric-test', 'outputBytes', 1],
    ['bad-nonfinite-metric-test', 'networkBytes', null],
  ] as const) {
    const campaign = campaignFor(state, id), campaignRoot = path.join(state.campaignTemp, id), injected = makeAcquire(state);
    const options = { allowedRoot: campaignRoot, inventoryManifestPath: state.directoryPath, countryGridPlanPath: state.grid.planPath, acquire: injected.acquire };
    const initial = await runCampaign(campaign, options);
    assert.equal(initial.status, 'complete', initial.failures.join('; '));
    const jobId = `${campaign.id}:${campaign.units[0]!.id}`;
    editLedgerResult(path.join(campaignRoot, campaign.id, 'ledger.sqlite'), jobId, result => {
      const metrics = result.metrics as Record<string, unknown>;
      metrics[field] = value;
    });
    await assert.rejects(campaignStatus(campaign.id, { allowedRoot: campaignRoot }), /metric|capture|receipt|byte/);
    await assert.rejects(runCampaign(campaign, options), /metric|capture|receipt|byte/);
    assert.equal(injected.calls(), 1, 'forged displayed metrics cannot cause reacquisition');
  }
}));

test('root denominator omission, foreign root bounds, and schema 1 grid-query substitution are rejected', async () => withFixture(async state => {
  const campaign = campaignFor(state, 'denominator-test');
  const omitted = { ...campaign, units: [] };
  assert.throws(() => validateCampaign(omitted), /at least one explicit source unit/);
  const moved = structuredClone(campaign);
  moved.units[0]!.request.region.bounds = [0, 0, 0.5, 0.5];
  const campaignRoot = path.join(state.campaignTemp, 'campaign-state');
  await assert.rejects(runCampaign(moved, { allowedRoot: campaignRoot, inventoryManifestPath: state.directoryPath,
    countryGridPlanPath: state.grid.planPath, acquire: makeAcquire(state).acquire }), /exact country\/cell|root request/);
  assert.throws(() => validateCampaign({ ...campaign, schemaVersion: 1 }), /schemaVersion|unknown campaign field/);
}));
