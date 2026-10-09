import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { appendFile, chmod, mkdir, mkdtemp, readFile, realpath, readdir, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { AcquisitionBudgetError } from './acquisition-errors.ts';
import { campaignStatus, runCampaign } from './campaign.ts';
import { compileCountryDirectory, publishCountryDirectory } from './country-directory.ts';
import { publishCountryGrid } from './country-grid-publish.ts';
import { validateCountryGridRequest } from './country-grid.ts';
import { createGridQueryCampaign, loadVerifiedGridQueryPlan } from './grid-query-binding.ts';
import { canonicalJson } from './pack.ts';
import type { AcquisitionOptions, AcquisitionRequest, AcquisitionResult } from './production-types.ts';
import type { SourceRecord } from './types.ts';
import type { FeatureIndexSessionConfiguration } from './feature-index-session.ts';
import type { GridQueryCampaign } from './grid-query-types.ts';
import { Ledger } from './ledger.ts';

const ROOT = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const TOOLING = path.join(ROOT, 'world/tooling');
const DEFAULT_PYTHON = '/Users/anthonyakpan/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
const NODE = realpathSync(path.resolve(process.env.WORLD_TEST_NODE ?? '/usr/local/bin/node'));
const PYTHON = path.resolve(process.env.WORLD_TEST_PYTHON ?? DEFAULT_PYTHON);
const sha = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const square = [[-17.2, 14.1], [-17.1, 14.1], [-17.1, 14.2], [-17.2, 14.2], [-17.2, 14.1]];
const requestLimits = { networkBytes: 50_000, outputBytes: 1_000_000, features: 100, durationMs: 60_000, memoryMb: 1024, diskBytes: 64_000_000 };
const campaignLimits = { durationMs: 600_000, jobDurationMs: 60_000, networkBytes: 200_000, inputBytes: 8_000_000, outputBytes: 2_000_000, diskBytes: 16_000_000, memoryMb: 1024, maxAttempts: 1 };

function sourceRecord(bytes: Uint8Array, id: string): SourceRecord {
  return { id: `synthetic-${id}`, url: `https://example.invalid/${id}.geojson`, release: '2026-09-23.1',
    license: 'Public domain', attribution: 'Synthetic fixture only', sha256: sha(bytes), bytes: bytes.byteLength };
}

async function fixture(id: string) {
  const tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), `campaign-feature-index-${id}-`)));
  const campaignTemp = await realpath(await mkdtemp(path.join(os.tmpdir(), `campaign-feature-state-${id}-`)));
  const allowedRoot = path.join(tmp, '.cache', 'world-build');
  const directoryRoot = path.join(allowedRoot, 'output', 'country-inventory');
  const directoryBytes = Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { NE_ID: 1, ADMIN: 'Synthetic Senegal', CONTINENT: 'Africa', ISO_A2_EH: 'SN' }, geometry: { type: 'Polygon', coordinates: [square] } },
    { type: 'Feature', properties: { NE_ID: 159, ADMIN: 'Nigeria', CONTINENT: 'Africa', ISO_A2_EH: 'NG' }, geometry: { type: 'Polygon', coordinates: [[[-1, 4], [0, 4], [0, 5], [-1, 5], [-1, 4]]] } },
  ] }));
  const source = sourceRecord(directoryBytes, `${id}-directory`), baseline = sourceRecord(directoryBytes, `${id}-baseline`);
  const compiled = compileCountryDirectory(source, directoryBytes, baseline, directoryBytes, sha(`${id}-baseline-manifest`));
  const directory = await publishCountryDirectory(compiled, directoryRoot, allowedRoot);
  const request = validateCountryGridRequest({ schemaVersion: 1, id: `${id}-grid`, directoryManifestHash: directory.manifestHash,
    countryId: 'country:natural-earth:NE_ID%3A1', level: 1,
    limits: { positions: 100, bboxCells: 100, cells: 100, operations: 100_000, outputBytes: 1_000_000 } });
  const grid = await publishCountryGrid(request, { allowedRoot, directoryRoot,
    outputRoot: path.join(allowedRoot, 'country-grids', request.id), durationMs: 60_000, memoryMb: 256 });
  const plan = await loadVerifiedGridQueryPlan(grid.planPath, grid.planHash, directory.manifestPath);
  return { tmp, campaignTemp, allowedRoot, directoryPath: directory.manifestPath, grid, plan };
}

function campaignFor(state: Awaited<ReturnType<typeof fixture>>, id: string, maxJobs = 5, maxDepth = 1, maxAttempts = 1): GridQueryCampaign {
  return createGridQueryCampaign(state.plan, { id, planHash: state.grid.planHash, maxDepth, maxJobs,
    release: '2026-09-23.1', layers: ['buildings'], requestLimits, limits: { ...campaignLimits, maxAttempts } });
}

type PythonMaterial = { pythonExecutable: string; pythonRuntime: FeatureIndexSessionConfiguration['pythonRuntime'];
  manifestBase64: string; sourceBase64: string; bindingBase64: string };
const pythonMaterials = new Map<string, Promise<PythonMaterial>>();

function getPythonMaterial(layers: string[] = ['buildings']): Promise<PythonMaterial> {
  const key = layers.join(',');
  let material = pythonMaterials.get(key);
  if (!material) {
    material = (async () => {
    const script = String.raw`
import base64, hashlib, json, os, pathlib, sys
repo=pathlib.Path(sys.argv[1]).resolve(strict=True)
sys.path.insert(0,str(repo/'world/tooling'))
os.environ['WORLD_TEST_NODE']=sys.argv[2]
from index_tooling import FILES, FORMAT, encode_tooling_manifest
from index_binding import decode_index_binding, encode_index_binding
import test_index_admission
test_index_admission.IndexAdmissionTests.setUpClass.__func__(test_index_admission.IndexAdmissionTests)
from test_index_bootstrap import pin
manifest=encode_tooling_manifest({'format':FORMAT,'files':{name:pin((repo/name).read_bytes()) for name in FILES}})
source=(repo/'world/acquisition-sources.json').read_bytes()
cls=test_index_admission.IndexAdmissionTests
binding_value=decode_index_binding(cls.bound(cls,manifest,source))
binding_value['source']['layers']=sys.argv[3].split(',')
binding=encode_index_binding(binding_value)
python=pathlib.Path(sys.executable).resolve(strict=True)
raw=python.read_bytes()
runtime={'pythonVersion':sys.version.split()[0],'sqliteVersion':__import__('sqlite3').sqlite_version,
         'pythonBytes':len(raw),'pythonSha256':hashlib.sha256(raw).hexdigest()}
print(json.dumps({'pythonExecutable':str(python),'pythonRuntime':runtime,
 'manifestBase64':base64.b64encode(manifest).decode('ascii'),
 'sourceBase64':base64.b64encode(source).decode('ascii'),
 'bindingBase64':base64.b64encode(binding).decode('ascii')},separators=(',',':')))
`;
    const stdout = execFileSync(PYTHON, ['-I', '-B', '-c', script, ROOT, NODE, key], { encoding: 'utf8',
      env: { ...process.env, WORLD_TEST_NODE: NODE }, maxBuffer: 1_000_000 });
    return JSON.parse(stdout) as PythonMaterial;
    })();
    pythonMaterials.set(key, material);
  }
  return material;
}

async function indexConfiguration(state: { campaignTemp: string }, rootName = 'index-namespace', layers: string[] = ['buildings']): Promise<FeatureIndexSessionConfiguration> {
  const material = await getPythonMaterial(layers);
  const namespaceRoot = path.join(state.campaignTemp, rootName);
  await mkdir(namespaceRoot, { mode: 0o700 });
  await chmod(namespaceRoot, 0o700);
  return { pythonExecutable: material.pythonExecutable, pythonRuntime: material.pythonRuntime,
    nodeExecutable: NODE, namespaceRoot, aggregateBytes: 64 * 1024 * 1024, repositoryRoot: ROOT,
    manifestBytes: Buffer.from(material.manifestBase64, 'base64'),
    sourceConfiguration: Buffer.from(material.sourceBase64, 'base64'),
    bindingBytes: Buffer.from(material.bindingBase64, 'base64') };
}

function makeAcquire(failFirst?: () => boolean) {
  let calls = 0;
  const acquire = async (request: AcquisitionRequest, options: AcquisitionOptions): Promise<AcquisitionResult> => {
    calls++;
    if (failFirst?.()) throw new AcquisitionBudgetError('feature-row-budget', 3);
    const { limits: _limits, ...selection } = request;
    const sourceConfig = JSON.parse(await readFile(path.join(ROOT, 'world/acquisition-sources.json'), 'utf8')) as {
      licenses: Record<string, string>; attribution: Record<string, string>;
      stac: { collections: Record<string, { url: string }> };
    };
    const requestHash = sha(canonicalJson({ compiler: 'world-source-compiler-v2', selection, sourceConfig }));
    const exceptions: string[] = [];
    const bytes = Buffer.from(JSON.stringify({ type: 'FeatureCollection', metadata: {
      provider: request.provider, release: request.release, requestHash, exceptions,
      stacIndex: { sha256: sha('synthetic fixed STAC item list'), itemCount: 640, selectedCount: 0 },
    }, features: [] }));
    const inputPath = path.join(options.allowedRoot, `${requestHash}.geojson`), receiptPath = path.join(options.allowedRoot, `${requestHash}.receipt.json`);
    await mkdir(options.allowedRoot, { recursive: true });
    await writeFile(inputPath, bytes);
    const sources = request.layers.map(layer => ({ id: `overture-${request.release}-${layer}`,
      url: sourceConfig.stac.collections[layer]!.url, release: request.release, license: sourceConfig.licenses[layer]!,
      attribution: sourceConfig.attribution[layer]!, sha256: sha(`synthetic ${layer} source`), bytes: 1 }));
    const metrics = { networkBytes: 0, outputBytes: bytes.byteLength, features: 0, elapsedMs: 1 };
    const receipt = { schemaVersion: 1, requestHash, selection, request, completedAt: '2026-10-09T00:00:00.000Z',
      inputSha256: sha(bytes), inputBytes: bytes.byteLength, metrics, upstream: [], sources, exceptions };
    await writeFile(receiptPath, `${canonicalJson(receipt)}\n`);
    const source = sourceRecord(bytes, 'zero-row-query');
    return { plan: { region: request.region, source, input: { path: inputPath, sha256: sha(bytes), bytes: bytes.byteLength } },
      requestHash, receiptPath, metrics, upstream: [], exceptions };
  };
  return { acquire, calls: () => calls };
}

function sourceJobId(campaign: GridQueryCampaign): string { return `${campaign.id}:${campaign.units[0]!.id}`; }
function row(file: string, id: string): Record<string, unknown> | undefined {
  const db = new DatabaseSync(file);
  try { return db.prepare('SELECT id,kind,input_hash,attempt,status,result FROM jobs WHERE id=?').get(id) as Record<string, unknown> | undefined; }
  finally { db.close(); }
}
function deleteJob(file: string, id: string): void {
  const db = new DatabaseSync(file);
  try { db.prepare('DELETE FROM jobs WHERE id=?').run(id); } finally { db.close(); }
}
async function snapshotTree(root: string, relative = ''): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const child = path.join(relative, entry.name), filename = path.join(root, child);
    if (entry.isDirectory()) Object.assign(result, await snapshotTree(root, child));
    else if (entry.isFile()) result[child] = sha(await readFile(filename));
  }
  return result;
}
function assertCoverage(value: unknown, expected: { enabled: boolean; captured: number; indexed: number; pending: number; leased?: number; failed?: number; untracked?: number }): void {
  assert.deepEqual(value, { scope: 'recorded-source-feature-index', geometryCoverage: 'not-compiled',
    integrity: 'independent-raw-index-audit-required', enabled: expected.enabled, jobLimit: 256, capacityBlocked: false, captured: expected.captured,
    indexed: expected.indexed, pending: expected.pending, leased: expected.leased ?? 0,
    failed: expected.failed ?? 0, untracked: expected.untracked ?? 0 });
}
type RetainedLedgerRow = { id: string; kind: string; inputHash: string; payload: unknown; maxAttempts: number; attempt: number;
  status: string; availableAt: number; priority: number; leaseUntil: number | null; result: unknown | null; error: string | null };
async function withFixture<T>(id: string, run: (state: Awaited<ReturnType<typeof fixture>>) => Promise<T>): Promise<T> {
  const state = await fixture(id);
  try { return await run(state); }
  finally { await rm(state.tmp, { recursive: true, force: true }); await rm(state.campaignTemp, { recursive: true, force: true }); }
}

test('zero-row source capture indexes through Python once, preserves the query denominator, and resumes without acquisition', async () => withFixture('backlog', async state => {
  const campaign = campaignFor(state, 'feature-index-backlog'), campaignRoot = path.join(state.campaignTemp, 'campaign-state');
  const config = await indexConfiguration(state), injected = makeAcquire();
  const common = { allowedRoot: campaignRoot, inventoryManifestPath: state.directoryPath,
    countryGridPlanPath: state.grid.planPath, acquire: injected.acquire };
  const paused = await runCampaign(campaign, { ...common, featureIndex: config, maxJobs: 1, maxIndexJobs: 0 });
  assert.equal(injected.calls(), 1);
  assertCoverage(paused.indexCoverage, { enabled: true, captured: 1, indexed: 0, pending: 1 });
  assert.equal(paused.counts.compiled, 0);
  assert.equal(paused.queryCoverage?.roots.requested, 1);
  assert.equal(paused.queryCoverage?.jobs.total, 1);
  const sourceBefore = row(path.join(campaignRoot, campaign.id, 'ledger.sqlite'), sourceJobId(campaign));
  assert.equal(sourceBefore?.attempt, 1);
  const usageBefore = await readFile(path.join(campaignRoot, campaign.id, 'usage.jsonl'));
  const resumed = await runCampaign(campaign, { ...common, featureIndex: config, maxJobs: 0, maxIndexJobs: 1 });
  assert.equal(injected.calls(), 1, 'index replay must use the durable source capture');
  assertCoverage(resumed.indexCoverage, { enabled: true, captured: 1, indexed: 1, pending: 0 });
  assert.equal(resumed.counts.compiled, 0);
  assert.equal(resumed.queryCoverage?.roots.requested, 1);
  assert.equal(resumed.queryCoverage?.jobs.total, 1, 'index claims do not enter the query denominator');
  const sourceAfter = row(path.join(campaignRoot, campaign.id, 'ledger.sqlite'), sourceJobId(campaign));
  assert.equal(sourceAfter?.result, sourceBefore?.result);
  assert.equal(sourceAfter?.attempt, sourceBefore?.attempt);
  assert.deepEqual(await readFile(path.join(campaignRoot, campaign.id, 'usage.jsonl')), usageBefore);
  const indexJob = resumed.jobs.find(job => job.kind === 'campaign-index-capture');
  assert.equal(indexJob?.id, `${campaign.id}:feature-index:${sourceJobId(campaign)}`);
  const completion = indexJob?.result as { status: string; observationHash: string; features: number };
  assert.equal(completion.status, 'capture-indexed');
  assert.equal(completion.features, 0);
  assert.match(completion.observationHash, /^[a-f0-9]{64}$/);
  const stored = await campaignStatus(campaign.id, { allowedRoot: campaignRoot });
  assertCoverage(stored.indexCoverage, { enabled: true, captured: 1, indexed: 1, pending: 0 });
}));

test('a stale index completion replays under a new live claim without charging the source again', async () => withFixture('stale-index-completion', async state => {
  const campaign = campaignFor(state, 'feature-index-stale-completion', 5, 1, 2);
  const campaignRoot = path.join(state.campaignTemp, 'campaign-state'), config = await indexConfiguration(state);
  const injected = makeAcquire(), common = { allowedRoot: campaignRoot, inventoryManifestPath: state.directoryPath,
    countryGridPlanPath: state.grid.planPath, acquire: injected.acquire, featureIndex: config };
  const captured = await runCampaign(campaign, { ...common, maxJobs: 1, maxIndexJobs: 0 });
  assert.equal(injected.calls(), 1);
  assertCoverage(captured.indexCoverage, { enabled: true, captured: 1, indexed: 0, pending: 1 });
  const ledgerPath = path.join(campaignRoot, campaign.id, 'ledger.sqlite');
  const sourceBefore = row(ledgerPath, sourceJobId(campaign));
  const usageBefore = await readFile(path.join(campaignRoot, campaign.id, 'usage.jsonl'));
  const indexId = campaign.id + ':feature-index:' + sourceJobId(campaign);
  const originalComplete = Ledger.prototype.complete;
  let forced = false;
  try {
    Ledger.prototype.complete = function(id, token, now, result): boolean {
      if (id === indexId && !forced) {
        forced = true;
        const db = new DatabaseSync(ledgerPath);
        try { db.prepare("UPDATE jobs SET lease_until=? WHERE id=? AND status='leased'").run(now - 1, id); }
        finally { db.close(); }
      }
      return originalComplete.call(this, id, token, now, result);
    };
    const lost = await runCampaign(campaign, { ...common, maxJobs: 0, maxIndexJobs: 1 });
    assert.equal(forced, true, 'the actual index completion must encounter the deliberately expired scheduler lease');
    assert.match(lost.stopped ?? '', /lease lost after ingestion/);
    assertCoverage(lost.indexCoverage, { enabled: true, captured: 1, indexed: 0, pending: 0, leased: 1 });
  } finally { Ledger.prototype.complete = originalComplete; }
  const expired = row(ledgerPath, indexId);
  assert.equal(expired?.status, 'leased');
  assert.equal(expired?.attempt, 1);
  assert.equal(row(ledgerPath, sourceJobId(campaign))?.result, sourceBefore?.result);
  assert.equal(row(ledgerPath, sourceJobId(campaign))?.attempt, sourceBefore?.attempt);
  assert.deepEqual(await readFile(path.join(campaignRoot, campaign.id, 'usage.jsonl')), usageBefore);
  const recordPath = path.join(config.namespaceRoot, sha(config.bindingBytes), 'capture.json');
  const firstRecord = JSON.parse(await readFile(recordPath, 'utf8')) as { jobs: Array<{ attempts: Array<{ observation: unknown }> }> };
  assert.equal(firstRecord.jobs[0]?.attempts.length, 1);
  const originalObservation = firstRecord.jobs[0]?.attempts[0]?.observation as { sha256: string; bytes: number };

  const replayed = await runCampaign(campaign, { ...common, maxJobs: 0, maxIndexJobs: 1 });
  assertCoverage(replayed.indexCoverage, { enabled: true, captured: 1, indexed: 1, pending: 0 });
  assert.equal(injected.calls(), 1, 'expired index replay must preserve the retained source and charge ledger');
  const settled = row(ledgerPath, indexId);
  assert.equal(settled?.status, 'completed');
  assert.equal(settled?.attempt, 2, 'the replay requires a new live scheduler claim');
  const decodedCompletion = JSON.parse(String(settled?.result)) as { attempts: number; observationHash: string };
  assert.equal(decodedCompletion.attempts, 2, 'the actual persistent capture controller charges and replays its second attempt');
  assert.equal(decodedCompletion.observationHash, originalObservation.sha256, 'deterministic replay preserves the original observation hash');
  const finalRecord = JSON.parse(await readFile(recordPath, 'utf8')) as { jobs: Array<{ attempts: Array<{ observation: unknown }> }> };
  assert.equal(finalRecord.jobs[0]?.attempts.length, 2);
  assert.deepEqual(finalRecord.jobs[0]?.attempts[1]?.observation, firstRecord.jobs[0]?.attempts[0]?.observation,
    'retry preserves the same frozen campaign observation pin');
  assert.equal(row(ledgerPath, sourceJobId(campaign))?.result, sourceBefore?.result);
  assert.equal(row(ledgerPath, sourceJobId(campaign))?.attempt, sourceBefore?.attempt);
  assert.deepEqual(await readFile(path.join(campaignRoot, campaign.id, 'usage.jsonl')), usageBefore);
  assert.equal(replayed.queryCoverage?.jobs.total, captured.queryCoverage?.jobs.total);
}));

test('legacy source captures can be indexed on resume without changing source evidence or usage', async () => withFixture('legacy', async state => {
  const campaign = campaignFor(state, 'feature-index-legacy'), campaignRoot = path.join(state.campaignTemp, 'campaign-state');
  const injected = makeAcquire(), config = await indexConfiguration(state);
  const base = { allowedRoot: campaignRoot, inventoryManifestPath: state.directoryPath,
    countryGridPlanPath: state.grid.planPath, acquire: injected.acquire };
  const old = await runCampaign(campaign, { ...base, maxJobs: 1 });
  assertCoverage(old.indexCoverage, { enabled: false, captured: 1, indexed: 0, pending: 0, untracked: 1 });
  const filename = path.join(campaignRoot, campaign.id, 'ledger.sqlite'), before = row(filename, sourceJobId(campaign));
  const usage = await readFile(path.join(campaignRoot, campaign.id, 'usage.jsonl'));
  const indexed = await runCampaign(campaign, { ...base, featureIndex: config, maxJobs: 0, maxIndexJobs: 1 });
  assert.equal(injected.calls(), 1);
  assertCoverage(indexed.indexCoverage, { enabled: true, captured: 1, indexed: 1, pending: 0 });
  const after = row(filename, sourceJobId(campaign));
  assert.equal(after?.result, before?.result);
  assert.equal(after?.attempt, before?.attempt);
  assert.deepEqual(await readFile(path.join(campaignRoot, campaign.id, 'usage.jsonl')), usage);
  assertCoverage((await campaignStatus(campaign.id, { allowedRoot: campaignRoot })).indexCoverage,
    { enabled: true, captured: 1, indexed: 1, pending: 0 });
}));

test('subdivision excludes the parent capture and indexes four child captures without raising the query cap', async () => withFixture('children', async state => {
  const campaign = campaignFor(state, 'feature-index-children', 5, 1), campaignRoot = path.join(state.campaignTemp, 'campaign-state');
  const config = await indexConfiguration(state); let first = true;
  const injected = makeAcquire(() => { if (first) { first = false; return true; } return false; });
  const common = { allowedRoot: campaignRoot, inventoryManifestPath: state.directoryPath,
    countryGridPlanPath: state.grid.planPath, acquire: injected.acquire, featureIndex: config };
  const split = await runCampaign(campaign, { ...common, maxJobs: 1, maxIndexJobs: 4 });
  assert.equal(split.jobs.find(job => job.kind === 'campaign-grid-query')?.result &&
    (split.jobs.find(job => job.kind === 'campaign-grid-query')!.result as { status: string }).status, 'query-subdivided');
  assertCoverage(split.indexCoverage, { enabled: true, captured: 0, indexed: 0, pending: 0 });
  const complete = await runCampaign(campaign, { ...common, maxJobs: 4, maxIndexJobs: 4 });
  assert.equal(injected.calls(), 5);
  assertCoverage(complete.indexCoverage, { enabled: true, captured: 4, indexed: 4, pending: 0 });
  assert.equal(complete.queryCoverage?.roots.requested, 1);
  assert.equal(complete.queryCoverage?.roots.captured, 1);
  assert.equal(complete.queryCoverage?.jobs.total, 5, 'the query cap counts one parent plus four children, not four index jobs');
  assert.equal(complete.queryCoverage?.jobs.subdivided, 1);
  assert.equal(complete.queryCoverage?.jobs.captured, 4);
  assert.equal(complete.jobs.filter(job => job.kind === 'campaign-index-capture').length, 4);
  const childIndexRows = complete.jobs.filter(job => job.kind === 'campaign-index-capture');
  const indexedSourceIds = childIndexRows.map(job => String((job.payload as { sourceJobId?: unknown }).sourceJobId));
  assert.equal(indexedSourceIds.length, 4);
  assert.equal(indexedSourceIds.includes(sourceJobId(campaign)), false,
    'the subdivided parent must not receive an index claim');
  assert.equal(indexedSourceIds.every(id => complete.jobs.some(job => job.id === id && job.kind === 'campaign-grid-query')),
    true, 'index claims must point only to the four captured child query rows');
  assert.equal(complete.counts.compiled, 0);
}));

test('changed capture bytes and changed stored configuration fail before reacquisition', async () => {
  for (const change of ['capture', 'configuration'] as const) await withFixture(`changed-${change}`, async state => {
    const campaign = campaignFor(state, `feature-index-changed-${change}`), campaignRoot = path.join(state.campaignTemp, 'campaign-state');
    const config = await indexConfiguration(state), injected = makeAcquire();
    const base = { allowedRoot: campaignRoot, inventoryManifestPath: state.directoryPath,
      countryGridPlanPath: state.grid.planPath, acquire: injected.acquire, featureIndex: config };
    const paused = await runCampaign(campaign, { ...base, maxJobs: 1, maxIndexJobs: 0 });
    assert.equal(injected.calls(), 1);
    if (change === 'capture') {
      const source = paused.jobs.find(job => job.kind === 'campaign-grid-query')!.result as { plan: { input: { path: string } } };
      await appendFile(source.plan.input.path, 'changed');
      await assert.rejects(runCampaign(campaign, { ...base, maxJobs: 0 }), /missing or corrupt|does not match|receipt/);
    } else {
      const other = await indexConfiguration(state, 'replacement-index-namespace');
      await assert.rejects(runCampaign(campaign, { ...base, featureIndex: other, maxJobs: 0 }), /immutable/);
    }
    assert.equal(injected.calls(), 1, 'invalid raw evidence/configuration cannot trigger another acquisition');
  });
});

test('status reports pending and untracked captured leaves without enqueueing, opening admission, or writing files', async () => withFixture('readonly-status', async state => {
  const campaign = campaignFor(state, 'feature-index-readonly-status'), campaignRoot = path.join(state.campaignTemp, 'campaign-state');
  const config = await indexConfiguration(state), injected = makeAcquire();
  const options = { allowedRoot: campaignRoot, inventoryManifestPath: state.directoryPath,
    countryGridPlanPath: state.grid.planPath, acquire: injected.acquire, featureIndex: config };
  const pending = await runCampaign(campaign, { ...options, maxJobs: 1, maxIndexJobs: 0 });
  assertCoverage(pending.indexCoverage, { enabled: true, captured: 1, indexed: 0, pending: 1 });
  const nsChildren = await readdir(config.namespaceRoot);
  assert.deepEqual(nsChildren, [], 'maxIndexJobs=0 must not admit or create an index root');
  const campaignDir = path.join(campaignRoot, campaign.id), beforePending = await snapshotTree(campaignDir);
  const statusPending = await campaignStatus(campaign.id, { allowedRoot: campaignRoot });
  assertCoverage(statusPending.indexCoverage, { enabled: true, captured: 1, indexed: 0, pending: 1 });
  assert.deepEqual(await snapshotTree(campaignDir), beforePending, 'status is read-only even when index work is pending');

  const indexId = `${campaign.id}:feature-index:${sourceJobId(campaign)}`;
  deleteJob(path.join(campaignDir, 'ledger.sqlite'), indexId);
  const beforeUntracked = await snapshotTree(campaignDir);
  const untracked = await campaignStatus(campaign.id, { allowedRoot: campaignRoot });
  assertCoverage(untracked.indexCoverage, { enabled: true, captured: 1, indexed: 0, pending: 0, untracked: 1 });
  assert.equal((await readdir(config.namespaceRoot)).length, 0, 'status cannot create missing index state');
  assert.deepEqual(await snapshotTree(campaignDir), beforeUntracked, 'status cannot enqueue an absent index claim or rewrite its ledger');
  assert.equal(injected.calls(), 1);
}));

test('indexes a retained zero-row Senegal capture from readonly production evidence without reacquisition or production writes', async () => {
  const actualDir = path.join(ROOT, '.cache/world-build/campaigns/senegal-grid-query-v1');
  const actualCampaignBytes = await readFile(path.join(actualDir, 'campaign.json'));
  const campaign = JSON.parse(actualCampaignBytes.toString('utf8')) as GridQueryCampaign;
  assert.equal(campaign.id, 'senegal-grid-query-v1');
  const actualLedgerPath = path.join(actualDir, 'ledger.sqlite');
  const readonlyRows = Ledger.readOnlyList(actualLedgerPath) as RetainedLedgerRow[];
  assert.equal(readonlyRows.some(job => job.status === 'leased'), false, 'fixture requires a quiescent retained campaign ledger');
  const capturedRows = readonlyRows.filter(job => job.kind === 'campaign-grid-query' && job.status === 'completed'
    && (job.result as { status?: string } | null)?.status === 'query-captured');
  assert.ok(capturedRows.length > 0, 'retained campaign must contain actual completed Senegal captures');
  assert.ok(capturedRows.some(job => (job.result as { features?: number }).features === 0),
    'retained Senegal campaign must include an actual accepted zero-row capture');

  const actualInventoryBinding = JSON.parse((await readFile(path.join(actualDir, 'inventory-binding.json'))).toString('utf8')) as { path: string; hash: string };
  const actualGridBinding = JSON.parse((await readFile(path.join(actualDir, 'grid-query-binding.json'))).toString('utf8')) as { path: string; hash: string };
  const originalSourceFiles = new Map<string, string>();
  for (const row of capturedRows) {
    const result = row.result as { plan: { input: { path: string } }; receiptPath: string };
    originalSourceFiles.set(result.plan.input.path, sha(await readFile(result.plan.input.path)));
    originalSourceFiles.set(result.receiptPath, sha(await readFile(result.receiptPath)));
  }
  const immutableFiles = [actualLedgerPath, path.join(actualDir, 'usage.jsonl'), path.join(actualDir, 'stages.jsonl'),
    path.join(actualDir, 'inventory-binding.json'), actualInventoryBinding.path,
    path.join(actualDir, 'grid-query-binding.json'), actualGridBinding.path];
  const immutableBefore = new Map<string, string>();
  for (const file of immutableFiles) immutableBefore.set(file, sha(await readFile(file)));

  const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'retained-senegal-index-')));
  const allowedRoot = path.join(temporary, 'campaigns'), campaignDir = path.join(allowedRoot, campaign.id);
  const sourceCache = path.join(campaignDir, 'source-cache');
  await mkdir(sourceCache, { recursive: true, mode: 0o700 });
  await chmod(sourceCache, 0o700);
  try {
    await mkdir(campaignDir, { recursive: true, mode: 0o700 });
    await writeFile(path.join(campaignDir, 'campaign.json'), actualCampaignBytes, { mode: 0o600 });
    await writeFile(path.join(campaignDir, 'usage.jsonl'), await readFile(path.join(actualDir, 'usage.jsonl')), { mode: 0o600 });
    await writeFile(path.join(campaignDir, 'stages.jsonl'), await readFile(path.join(actualDir, 'stages.jsonl')), { mode: 0o600 });

    const clonedRows = readonlyRows.map(job => {
      if (job.kind !== 'campaign-grid-query' || (job.result as { status?: string } | null)?.status !== 'query-captured') return job;
      const result = structuredClone(job.result) as { plan: { input: { path: string } }; receiptPath: string };
      const copy = (source: string, suffix: string): string => path.join(sourceCache, `${sha(source)}-${suffix}`);
      const extractPath = copy(result.plan.input.path, 'extract.geojson'), receiptPath = copy(result.receiptPath, 'receipt.json');
      return { ...job, result: { ...result, plan: { ...result.plan, input: { ...result.plan.input, path: extractPath } }, receiptPath } };
    });
    for (const row of capturedRows) {
      const result = row.result as { plan: { input: { path: string } }; receiptPath: string };
      const cloned = clonedRows.find(job => job.id === row.id)!.result as { plan: { input: { path: string } }; receiptPath: string };
      await writeFile(cloned.plan.input.path, await readFile(result.plan.input.path), { flag: 'wx', mode: 0o600 });
      await writeFile(cloned.receiptPath, await readFile(result.receiptPath), { flag: 'wx', mode: 0o600 });
    }

    const ledgerPath = path.join(campaignDir, 'ledger.sqlite'), ledger = new Ledger(ledgerPath);
    ledger.close();
    const db = new DatabaseSync(ledgerPath);
    try {
      const insert = db.prepare(`INSERT INTO jobs(id,kind,input_hash,payload,max_attempts,attempt,token_seq,status,available_at,priority,lease_until,lease_token,result,error)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL,?,?)`);
      for (const job of clonedRows) insert.run(job.id, job.kind, job.inputHash, canonicalJson(job.payload), job.maxAttempts,
        job.attempt, job.attempt, job.status, job.availableAt, job.priority, job.leaseUntil, job.result === null ? null : canonicalJson(job.result), job.error);
    } finally { db.close(); }

    const state = { campaignTemp: temporary };
    const config = await indexConfiguration(state, 'retained-index-namespace', ['buildings', 'roads']);
    let acquireCalls = 0;
    const report = await runCampaign(campaign, { allowedRoot, inventoryManifestPath: actualInventoryBinding.path,
      countryGridPlanPath: actualGridBinding.path, featureIndex: config, maxJobs: 0, maxIndexJobs: 1,
      acquire: async () => { acquireCalls++; throw new Error('retained capture replay must not reacquire'); } });
    assert.equal(acquireCalls, 0);
    assert.equal(report.indexCoverage?.captured, capturedRows.length);
    assert.equal(report.indexCoverage?.indexed, 1);
    assert.equal(report.indexCoverage?.pending, capturedRows.length - 1);
    assert.equal(report.queryCoverage?.jobs.total, readonlyRows.filter(job => job.kind === 'campaign-grid-query').length,
      'index-only resume must preserve the retained query denominator');
    const finalRows = Ledger.readOnlyList(ledgerPath) as RetainedLedgerRow[];
    for (const retained of readonlyRows.filter(job => job.kind === 'campaign-grid-query')) {
      const before = clonedRows.find(job => job.id === retained.id)!, after = finalRows.find(job => job.id === retained.id)!;
      assert.equal(after.attempt, retained.attempt, `source attempt changed: ${retained.id}`);
      assert.equal(after.status, retained.status, `source state changed: ${retained.id}`);
      assert.equal(after.inputHash, retained.inputHash, `source input pin changed: ${retained.id}`);
      assert.equal(canonicalJson(after.result), canonicalJson(before.result), `source result changed: ${retained.id}`);
    }
    assert.equal(sha(await readFile(path.join(campaignDir, 'usage.jsonl'))), immutableBefore.get(path.join(actualDir, 'usage.jsonl')),
      'retained usage charges are copied unchanged into the isolated resume');
    const indexed = report.jobs.find(job => job.kind === 'campaign-index-capture' && job.status === 'completed');
    assert.ok(indexed, 'one retained source capture must be indexed');
    const indexedSourceId = (indexed.payload as { sourceJobId: string }).sourceJobId;
    const selected = capturedRows.find(job => job.id === indexedSourceId);
    assert.ok(selected, 'the actual indexed source must be one of the retained captures');
    const original = selected.result as { requestHash: string; inputSha256: string; inputBytes: number; receiptSha256: string; features: number };
    assert.equal(original.features, 0, 'the retained production query must have zero supported rows');
    const clonedSelected = row(ledgerPath, String(selected.id));
    assert.equal(clonedSelected?.attempt, selected.attempt);
    const payload = indexed.payload as { campaignHash: string; planHash: string; sourceJobId: string;
      input: { expected: { requestHash: string; extract: { sha256: string; bytes: number }; receipt: { sha256: string; bytes: number } };
        observation: { campaignHash: string; planHash: string; jobId: string; rootCellId: string; queryPath: string } } };
    const sourceUnit = (selected.payload as { unit: { query: { rootCellId: string; path: string } } }).unit;
    assert.equal(payload.sourceJobId, selected.id);
    assert.equal(payload.input.expected.requestHash, original.requestHash);
    assert.equal(payload.input.expected.extract.sha256, original.inputSha256);
    assert.equal(payload.input.expected.extract.bytes, original.inputBytes);
    assert.equal(payload.input.expected.receipt.sha256, original.receiptSha256);
    assert.equal(payload.input.expected.receipt.bytes, (selected.result as { receiptBytes: number }).receiptBytes);
    const observation = payload.input.observation;
    assert.equal(observation.campaignHash, payload.campaignHash);
    assert.equal(observation.planHash, campaign.gridQuery.planHash);
    assert.equal(observation.jobId, selected.id);
    assert.equal(observation.rootCellId, sourceUnit.query.rootCellId);
    assert.equal(observation.queryPath, sourceUnit.query.path);

    for (const [file, before] of immutableBefore) assert.equal(sha(await readFile(file)), before, `production evidence changed: ${file}`);
    for (const [file, before] of originalSourceFiles) assert.equal(sha(await readFile(file)), before, `retained source bytes changed: ${file}`);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
