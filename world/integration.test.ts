import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { Ledger } from './ledger.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function isolatedWorld(): Promise<{ root: string; api: typeof import('./pipeline.ts'); cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), 'allworld-lane6-'));
  await cp(path.join(REPO_ROOT, 'world'), path.join(root, 'world'), { recursive: true });
  await symlink(path.join(REPO_ROOT, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  const api = await import(pathToFileURL(path.join(root, 'world', 'pipeline.ts')).href) as typeof import('./pipeline.ts');
  return { root, api, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('Accra plan publishes deterministically and completed resume verifies every immutable hash', async () => {
  const isolated = await isolatedWorld();
  try {
    const plan = await isolated.api.loadPlan(path.join(isolated.root, 'world/pilots/accra-config.json'));
    const result = await isolated.api.runPlan(plan, { maxJobs: 1, durationMs: 30_000 });
    assert.equal(result.failures.length, 0, JSON.stringify(result));
    const completed = result.jobs.find(job => job.status === 'completed');
    assert.ok(completed);
    const receipt = completed.result as { manifestHash: string; manifestPath: string };
    const manifest = await readFile(path.join(isolated.api.OUTPUT_ROOT, receipt.manifestPath));
    assert.equal(await import('./pack.ts').then(({ sha256 }) => sha256(manifest)), receipt.manifestHash);
    const again = await isolated.api.runPlan(plan, { maxJobs: 1, durationMs: 30_000 });
    assert.equal(again.failures.length, 0);
    assert.equal((again.jobs.find(job => job.status === 'completed')?.result as typeof receipt).manifestHash, receipt.manifestHash);
    const decoded = JSON.parse(manifest.toString('utf8')) as { tiles: Array<{ path: string; sha256: string }> };
    const tile = decoded.tiles[0];
    assert.ok(tile);
    const tilePath = path.join(isolated.api.OUTPUT_ROOT, tile.path);
    const original = await readFile(tilePath);
    try {
      await writeFile(tilePath, Buffer.from('corrupt'));
      await assert.rejects(isolated.api.runPlan(plan, { maxJobs: 1, durationMs: 30_000 }), /tile hash is corrupt/);
    } finally { await writeFile(tilePath, original); }
    await assert.rejects(isolated.api.runPlan({ ...plan, region: { ...plan.region, countryCode: 'NG' } }), /Nigeria/);
    assert.ok((await isolated.api.status()).some(job => job.status === 'completed'));
  } finally { await isolated.cleanup(); }
});

test('queue execution compiles the claimed payload when another plan is ahead in the queue', async () => {
  const isolated = await isolatedWorld();
  try {
    const planPath = path.join(isolated.root, 'world/pilots/accra-config.json');
    const base = await isolated.api.loadPlan(planPath);
    await assert.rejects(isolated.api.compileInWorker(base, 1), /compile exceeded 1 ms job duration/);
    await assert.rejects(isolated.api.runPlan({ ...base, input: { ...base.input, sha256: '0'.repeat(64) } }), /exact local GeoJSON input bytes/);
    const a = { ...base, region: { ...base.region, id: 'queue-alpha', name: 'Queue alpha' } };
    const b = { ...base, region: { ...base.region, id: 'queue-beta', name: 'Queue beta' } };
    const alpha = isolated.api.jobIdentity(a), beta = isolated.api.jobIdentity(b);
    const ordered = alpha.id < beta.id ? [a, b] as const : [b, a] as const;
    const firstIdentity = isolated.api.jobIdentity(ordered[0]), nextIdentity = isolated.api.jobIdentity(ordered[1]);
    await isolated.api.validateBuildRoots();
    const ledger = new Ledger(isolated.api.LEDGER_PATH);
    try {
      for (const identity of [firstIdentity, nextIdentity]) ledger.enqueue({ ...identity, kind: 'compile-region', maxAttempts: 2 });
    } finally { ledger.close(); }
    const partial = await isolated.api.runPlan(ordered[1], { maxJobs: 1, durationMs: 30_000 });
    assert.equal(partial.jobs.find(job => job.id === firstIdentity.id)?.status, 'completed');
    assert.equal(partial.jobs.find(job => job.id === nextIdentity.id)?.status, 'queued');
    const result = partial.jobs.find(job => job.id === firstIdentity.id)!.result as { manifestPath: string };
    const manifest = JSON.parse((await readFile(path.join(isolated.api.OUTPUT_ROOT, result.manifestPath))).toString('utf8')) as { region: { id: string } };
    assert.equal(manifest.region.id, ordered[0].region.id);
  } finally { await isolated.cleanup(); }
});

test('runner lock serializes concurrent runs and ledger symlinks fail before SQLite opens', async () => {
  const isolated = await isolatedWorld();
  try {
    const plan = await isolated.api.loadPlan(path.join(isolated.root, 'world/pilots/accra-config.json'));
    await isolated.api.validateBuildRoots();
    const outside = path.join(isolated.root, 'outside.sqlite');
    await writeFile(outside, 'do not open');
    await symlink(outside, isolated.api.LEDGER_PATH, 'file');
    await assert.rejects(isolated.api.runPlan(plan), /symlink path refused/);
    await rm(isolated.api.LEDGER_PATH);
    const results = await Promise.allSettled([
      isolated.api.runPlan(plan, { maxJobs: 1, durationMs: 30_000 }),
      isolated.api.runPlan(plan, { maxJobs: 1, durationMs: 30_000 }),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  } finally { await isolated.cleanup(); }
});

test('a symlinked .cache is rejected before creating world-build in its target', async () => {
  const isolated = await isolatedWorld();
  try {
    const redirected = path.join(isolated.root, 'redirected-cache');
    await mkdir(redirected);
    await symlink(redirected, path.join(isolated.root, '.cache'), 'dir');
    await assert.rejects(isolated.api.validateBuildRoots(), /symlink/);
    await assert.rejects(stat(path.join(redirected, 'world-build')), { code: 'ENOENT' });
  } finally { await isolated.cleanup(); }
});
