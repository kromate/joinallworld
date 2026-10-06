// The word list on the Worker host. The list (about 3.2 MB) is a server-only module inside the Worker's script, so these tests keep three
// promises: the script stays inside the platform's size limits, evaluating the script at start-up does not touch the list (no parse, no
// split, no index: it stays one string per length), and a lookup is a binary search on that string. Module evaluation time in Node is the
// proxy for the platform's start-up CPU limit (about 400 ms), which is far above these budgets. The Miniflare run shows the script still starts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';

interface MiniflareInstance { ready: Promise<URL>; dispose(): Promise<void>; dispatchFetch(url: string): Promise<Response> }
interface MiniflareTooling { Miniflare: new (options: Record<string, unknown>) => MiniflareInstance; convertV4MiniflareOptions(options: Record<string, unknown>): Record<string, unknown> }
interface BundleOptions { entryPoints: string[]; outfile: string; bundle: boolean; format: string; platform: string; external?: string[]; alias?: Record<string, string> }
const require = createRequire(resolve(process.env['JOINALLWORLD_TOOLS'] || 'deploy/tooling', 'package.json'));
const { Miniflare, convertV4MiniflareOptions } = require('miniflare') as MiniflareTooling;
const { build } = require('esbuild') as { build(options: BundleOptions): Promise<unknown> };
const here = (path: string): string => new URL(path, import.meta.url).pathname;

/** What the platform allows a Worker script to be, compressed (the smaller, free-plan figure is used so the guard has room), and the budgets of this test. */
const LIMITS = { gzipBytes: 3_000_000, dictionaryImportMs: 200, workerImportMs: 400, dictionaryHeapBytes: 16_000_000, warmMs: 500, lookupUs: 20 };

async function bundles() {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-words-'));
  const stub = join(folder, 'workers-stub.mjs');
  await writeFile(stub, 'export class DurableObject { constructor(state, env) { this.ctx = state; this.env = env } }\n');
  const files = { worker: join(folder, 'worker.mjs'), real: join(folder, 'real.mjs'), dictionary: join(folder, 'dictionary.mjs'), weave: join(folder, 'weave.mjs') };
  await build({ entryPoints: [here('./cloudflare-worker.ts')], outfile: files.real, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
  await build({ entryPoints: [here('./cloudflare-worker.ts')], outfile: files.worker, bundle: true, format: 'esm', platform: 'neutral', alias: { 'cloudflare:workers': stub } });
  await build({ entryPoints: [here('../src/words/dict.ts')], outfile: files.dictionary, bundle: true, format: 'esm', platform: 'neutral' });
  await build({ entryPoints: [here('../src/tables/weave.ts')], outfile: files.weave, bundle: true, format: 'esm', platform: 'neutral' });
  return { folder, files };
}
/** Run a module in a fresh Node process and answer what its script printed as JSON. */
function fresh(script: string): Record<string, number> {
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout.trim().split('\n').pop() ?? '{}') as Record<string, number>;
}

test('the Worker script stays inside the size limit, and the list is one string per length of at most 13 letters', async (t) => {
  const { folder, files } = await bundles();
  t.after(() => rm(folder, { recursive: true, force: true }));
  const script = await readFile(files.real);
  const size = { raw: (await stat(files.real)).size, gzip: gzipSync(script, { level: 9 }).length };
  console.log(`Worker script: ${size.raw} bytes, ${size.gzip} gzipped`);
  assert.ok(size.gzip <= LIMITS.gzipBytes, `the Worker script is ${size.gzip} bytes gzipped (guard ${LIMITS.gzipBytes})`);
  const { default: packed } = await import('../src/words/data/dictionary.ts');
  assert.deepEqual(Object.keys(packed).map(Number), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  for (const [length, text] of Object.entries(packed)) assert.equal(text.length % Number(length), 0, `length ${length} is fixed width`);
});

test('evaluating the Worker script does not parse, split or index the list; the list itself loads in a few milliseconds', async (t) => {
  const { folder, files } = await bundles();
  t.after(() => rm(folder, { recursive: true, force: true }));
  const measure = (file: string): Record<string, number> => fresh(`const before = process.memoryUsage().heapUsed, t0 = performance.now(); await import(${JSON.stringify(file)}); console.log(JSON.stringify({ ms: performance.now() - t0, heap: process.memoryUsage().heapUsed - before }))`);
  const dictionary = measure(files.dictionary), worker = measure(files.worker);
  console.log(`import: the list ${dictionary['ms']?.toFixed(1)} ms, the whole Worker ${worker['ms']?.toFixed(1)} ms`);
  assert.ok((dictionary['ms'] ?? Infinity) < LIMITS.dictionaryImportMs, `the list takes ${dictionary['ms']} ms to evaluate`);
  assert.ok((dictionary['heap'] ?? Infinity) < LIMITS.dictionaryHeapBytes, `the list holds ${dictionary['heap']} bytes of heap after evaluation: it was turned into something other than strings`);
  assert.ok((worker['ms'] ?? Infinity) < LIMITS.workerImportMs, `the Worker script takes ${worker['ms']} ms to evaluate (the platform allows about 400)`);
});

test('the first game of Weave builds the computer player\'s tables within a small budget, and a lookup is a binary search with no index', async (t) => {
  const { folder, files } = await bundles();
  t.after(() => rm(folder, { recursive: true, force: true }));
  const found = fresh(`
    const weave = await import(${JSON.stringify(files.weave)}), words = await import(${JSON.stringify(files.dictionary)});
    const heap = process.memoryUsage().heapUsed, t0 = performance.now(); weave.warm(); const warm = performance.now() - t0;
    const made = process.memoryUsage().heapUsed - heap, letters = 'abcdefghijklmnopqrstuvwxyz', N = 50000;
    let hits = 0; const t1 = performance.now();
    for (let i = 0; i < N; i++) { let w = ''; for (let k = 0; k < 2 + (i % 12); k++) w += letters[(i * 7 + k * 13) % 26]; if (words.isWord(w)) hits++ }
    console.log(JSON.stringify({ warm, made, lookupUs: (performance.now() - t1) / N * 1000, hits, words: Number(words.isWord('hello')) + Number(words.isWord('zzzzq')) * 10 }))`);
  console.log(`first use: ${found['warm']?.toFixed(1)} ms; a lookup ${found['lookupUs']?.toFixed(2)} µs`);
  assert.ok((found['warm'] ?? Infinity) < LIMITS.warmMs, `building the computer player's tables takes ${found['warm']} ms`);
  assert.ok((found['lookupUs'] ?? Infinity) < LIMITS.lookupUs, `one lookup takes ${found['lookupUs']} µs`);
  assert.equal(found['words'], 1, 'hello is a word and zzzzq is not');
});

test('the Worker script starts under Miniflare with the list inside it', async (t) => {
  const { folder, files } = await bundles();
  t.after(() => rm(folder, { recursive: true, force: true }));
  const options = {
    name: 'joinallworld-words', script: await readFile(files.real, 'utf8'), modules: true, compatibilityDate: '2026-10-01',
    durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, durableObjectsPersist: join(folder, 'storage'),
    bindings: { BUILD_ID: 'local-words', FOUNDER_EMAIL_SHA256: '' },
  };
  const miniflare = new Miniflare(convertV4MiniflareOptions(options));
  t.after(() => miniflare.dispose());
  const base = (await miniflare.ready).origin;
  const answer = await miniflare.dispatchFetch(`${base}/api/health`);
  assert.equal(answer.status, 200);
  assert.equal(((await answer.json()) as { build: string }).build, 'local-words');
});
