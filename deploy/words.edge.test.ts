// The word list on the Worker host. The list (about 3.2 MB once inflated) is a server-only module inside the Worker's script, stored
// front-coded, deflated and text encoded (about 1 MB). These tests keep four promises: every file of the deploy package stays under the
// pipeline's per-file limit, evaluating the script at start-up does not inflate or touch the list, the list is inflated once by `ready()`
// within a generous bound on both hosts (Node and the Worker runtime), and lookups are right for every length. Module evaluation time in
// Node is the proxy for the platform's start-up CPU limit (about 400 ms), which is far above these budgets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { FIRST_LENGTH, PACKED, WORD_COUNTS } from '../src/words/data/dictionary.ts';
import { unpackDictionary } from '../scripts/words/pack.ts';
import { layoutBindings } from '../server/testing/sqliteStorage.ts';

interface MiniflareInstance { ready: Promise<URL>; dispose(): Promise<void>; dispatchFetch(url: string): Promise<Response> }
interface MiniflareTooling { Miniflare: new (options: Record<string, unknown>) => MiniflareInstance; convertV4MiniflareOptions(options: Record<string, unknown>): Record<string, unknown> }
interface BundleOptions { entryPoints: string[]; outfile: string; bundle: boolean; format: string; platform: string; external?: string[]; alias?: Record<string, string> }
const require = createRequire(resolve(process.env['JOINALLWORLD_TOOLS'] || 'deploy/tooling', 'package.json'));
const { Miniflare, convertV4MiniflareOptions } = require('miniflare') as MiniflareTooling;
const { build } = require('esbuild') as { build(options: BundleOptions): Promise<unknown> };
const here = (path: string): string => new URL(path, import.meta.url).pathname;

/** What the platform allows a Worker script to be, compressed (the smaller, free-plan figure is used so the guard has room), and the budgets of this test. */
const LIMITS = { fileBytes: 5_000_000, gzipBytes: 3_000_000, dictionaryImportMs: 200, workerImportMs: 400, dictionaryHeapBytes: 4_000_000, readyMs: 1000, warmMs: 500, lookupUs: 20 };

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

/** Every file under a folder, with its size. */
async function filesUnder(folder: string): Promise<Array<{ path: string; bytes: number }>> {
  const found: Array<{ path: string; bytes: number }> = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) found.push(...(await filesUnder(path)));
    else found.push({ path, bytes: (await stat(path)).size });
  }
  return found;
}

test('the Worker script and every built asset stay inside the per-file limit, and the list is one string per length of at most 13 letters', async (t) => {
  const { folder, files } = await bundles();
  t.after(() => rm(folder, { recursive: true, force: true }));
  const script = await readFile(files.real);
  const size = { raw: (await stat(files.real)).size, gzip: gzipSync(script, { level: 9 }).length };
  console.log(`Worker script: ${size.raw} bytes, ${size.gzip} gzipped`);
  assert.ok(size.raw <= LIMITS.fileBytes, `the Worker script is ${size.raw} bytes raw (the pipeline takes at most 5 MiB per file; guard ${LIMITS.fileBytes})`);
  assert.ok(size.gzip <= LIMITS.gzipBytes, `the Worker script is ${size.gzip} bytes gzipped (guard ${LIMITS.gzipBytes})`);
  const built = await filesUnder(here('../dist')).catch(() => []);
  for (const file of built) assert.ok(file.bytes <= LIMITS.fileBytes, `${file.path} is ${file.bytes} bytes (guard ${LIMITS.fileBytes})`);
  const lists = unpackDictionary(FIRST_LENGTH, WORD_COUNTS, PACKED);
  assert.deepEqual(Object.keys(lists).map(Number), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  for (const [length, text] of Object.entries(lists)) assert.equal(text.length % Number(length), 0, `length ${length} is fixed width`);
});

test('evaluating the Worker script does not inflate, parse, split or index the list', async (t) => {
  const { folder, files } = await bundles();
  t.after(() => rm(folder, { recursive: true, force: true }));
  const measure = (file: string): Record<string, number> => fresh(`const before = process.memoryUsage().heapUsed, t0 = performance.now(); await import(${JSON.stringify(file)}); console.log(JSON.stringify({ ms: performance.now() - t0, heap: process.memoryUsage().heapUsed - before }))`);
  const untouched = fresh(`const words = await import(${JSON.stringify(files.dictionary)}); let early = 0; try { words.isWord('hello'); early = 1 } catch {} console.log(JSON.stringify({ ready: Number(words.isReady()), early }))`);
  assert.deepEqual(untouched, { ready: 0, early: 0 }, 'importing the list must not inflate it, and a lookup before ready() must refuse');
  const dictionary = measure(files.dictionary), worker = measure(files.worker);
  console.log(`import: the list ${dictionary['ms']?.toFixed(1)} ms, the whole Worker ${worker['ms']?.toFixed(1)} ms`);
  assert.ok((dictionary['ms'] ?? Infinity) < LIMITS.dictionaryImportMs, `the list takes ${dictionary['ms']} ms to evaluate`);
  assert.ok((dictionary['heap'] ?? Infinity) < LIMITS.dictionaryHeapBytes, `the list holds ${dictionary['heap']} bytes of heap after evaluation: something inflated it`);
  assert.ok((worker['ms'] ?? Infinity) < LIMITS.workerImportMs, `the Worker script takes ${worker['ms']} ms to evaluate (the platform allows about 400)`);
});

/** Words to look up for each length: the first, a middle one and the last of the list, plus near misses that are not in it. */
function samples(): { real: string[]; fake: string[] } {
  const lists = unpackDictionary(FIRST_LENGTH, WORD_COUNTS, PACKED);
  const real: string[] = [], fake: string[] = [];
  for (const [key, text] of Object.entries(lists)) {
    const width = Number(key), count = text.length / width, all = new Set<string>();
    for (let at = 0; at < text.length; at += width) all.add(text.slice(at, at + width));
    for (const index of [0, 1, count >> 1, count - 2, count - 1]) real.push(text.slice(index * width, (index + 1) * width));
    for (const word of [text.slice(0, width), text.slice((count - 1) * width)]) {
      for (const tail of ['q', 'z', 'x']) { const near = word.slice(0, -1) + tail; if (!all.has(near)) fake.push(near); }
      const longer = `${word}s`.slice(0, width); if (!all.has(longer)) fake.push(longer);
    }
    for (const word of ['a'.repeat(width), 'z'.repeat(width), 'zzzzq'.padEnd(width, 'q').slice(0, width)]) if (!all.has(word)) fake.push(word);
  }
  fake.push('', 'a', 'qqqqqqqqqqqqqq', 'HELLO', 'he llo');
  return { real, fake };
}

test('the list is inflated once by ready(), within a bound, and the first game of Weave and every lookup are right', async (t) => {
  const { folder, files } = await bundles();
  t.after(() => rm(folder, { recursive: true, force: true }));
  const { real, fake } = samples();
  const found = fresh(`
    const weave = await import(${JSON.stringify(files.weave)}), words = await import(${JSON.stringify(files.dictionary)});
    const heap = process.memoryUsage().heapUsed, t0 = performance.now(); await words.ready(); const inflate = performance.now() - t0;
    const again = performance.now(); await words.ready(); const second = performance.now() - again;
    const t2 = performance.now(); await weave.warm(); const warm = performance.now() - t2;
    const made = process.memoryUsage().heapUsed - heap, letters = 'abcdefghijklmnopqrstuvwxyz', N = 50000;
    let hits = 0; const t1 = performance.now();
    for (let i = 0; i < N; i++) { let w = ''; for (let k = 0; k < 2 + (i % 12); k++) w += letters[(i * 7 + k * 13) % 26]; if (words.isWord(w)) hits++ }
    const one = performance.now(); words.isWord('hello'); const single = (performance.now() - one) * 1000;
    const missed = ${JSON.stringify(real)}.filter((w) => !words.isWord(w)).length, wrong = ${JSON.stringify(fake)}.filter((w) => words.isWord(w)).length;
    console.log(JSON.stringify({ inflate, second, warm, made, lookupUs: (performance.now() - t1) / N * 1000, single, hits, missed, wrong, words: Number(words.isWord('hello')) + Number(words.isWord('zzzzq')) * 10 }))`);
  console.log(`first inflate: ${found['inflate']?.toFixed(1)} ms; first Weave tables: ${found['warm']?.toFixed(1)} ms; a lookup ${found['lookupUs']?.toFixed(2)} µs`);
  assert.ok((found['inflate'] ?? Infinity) < LIMITS.readyMs, `inflating the list takes ${found['inflate']} ms`);
  assert.ok((found['second'] ?? Infinity) < 5, `a second ready() takes ${found['second']} ms: it inflated again`);
  assert.ok((found['warm'] ?? Infinity) < LIMITS.warmMs, `building the computer player's tables takes ${found['warm']} ms`);
  assert.ok((found['lookupUs'] ?? Infinity) < LIMITS.lookupUs, `one lookup takes ${found['lookupUs']} µs`);
  assert.equal(found['missed'], 0, 'every sampled real word is found');
  assert.equal(found['wrong'], 0, 'no sampled fake word is found');
  assert.equal(found['words'], 1, 'hello is a word and zzzzq is not');
});

test('the Worker script starts under Miniflare with the list inside it', async (t) => {
  const { folder, files } = await bundles();
  t.after(() => rm(folder, { recursive: true, force: true }));
  const options = {
    name: 'joinallworld-words', script: await readFile(files.real, 'utf8'), modules: true, compatibilityDate: '2026-10-01',
    durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, durableObjectsPersist: join(folder, 'storage'),
    bindings: { ...layoutBindings(), BUILD_ID: 'local-words', FOUNDER_EMAIL_SHA256: '' },
  };
  const miniflare = new Miniflare(convertV4MiniflareOptions(options));
  t.after(() => miniflare.dispose());
  const base = (await miniflare.ready).origin;
  const answer = await miniflare.dispatchFetch(`${base}/api/health`);
  assert.equal(answer.status, 200);
  assert.equal(((await answer.json()) as { build: string }).build, 'local-words');
});

test('the Worker runtime inflates the list on first use and answers lookups', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-words-runtime-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const entry = join(folder, 'entry.ts');
  await writeFile(entry, `import { isReady, isWord, ready } from ${JSON.stringify(here('../src/words/dict.ts'))};
const started = Date.now();
export default {
  async fetch(request: Request): Promise<Response> {
    const before = isReady();
    const t0 = Date.now(); await ready(); const inflateMs = Date.now() - t0;
    const words = new URL(request.url).searchParams.get('words')?.split(',') ?? [];
    return Response.json({ before, after: isReady(), inflateMs, results: words.map(isWord), age: Date.now() - started });
  },
};
`);
  const script = join(folder, 'runtime.mjs');
  await build({ entryPoints: [entry], outfile: script, bundle: true, format: 'esm', platform: 'neutral' });
  const { real, fake } = samples();
  const miniflare = new Miniflare(convertV4MiniflareOptions({ name: 'joinallworld-words-runtime', script: await readFile(script, 'utf8'), modules: true, compatibilityDate: '2026-10-01' }));
  t.after(() => miniflare.dispose());
  const base = (await miniflare.ready).origin;
  const ask = async (words: string[]) => (await (await miniflare.dispatchFetch(`${base}/?words=${words.join(',')}`)).json()) as { before: boolean; after: boolean; inflateMs: number; results: boolean[] };
  const first = await ask(['hello', 'zzzzq', ...real, ...fake.filter((word) => /^[a-z]+$/.test(word))]);
  const fakes = fake.filter((word) => /^[a-z]+$/.test(word));
  console.log(`Worker runtime: first inflate ${first.inflateMs} ms`);
  assert.equal(first.before, false, 'nothing is inflated before the first use');
  assert.equal(first.after, true);
  assert.ok(first.inflateMs < LIMITS.readyMs, `inflating takes ${first.inflateMs} ms in the Worker runtime`);
  assert.deepEqual(first.results, [true, false, ...real.map(() => true), ...fakes.map(() => false)]);
  assert.equal((await ask(['hello'])).before, true, 'the second request finds the list already inflated');
});
