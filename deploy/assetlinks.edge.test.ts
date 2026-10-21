// /.well-known/assetlinks.json on the Worker host (server/site-files.ts, docs/STORE.md): a 404 while PLAY_SIGNING_SHA256 is unset or is not a SHA-256
// fingerprint (the single-page fallback must never answer it with the game's page), the Digital Asset Links JSON once it is set, and a 404 on the admin address.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

interface MiniflareInstance { ready: Promise<URL>; dispose(): Promise<void>; dispatchFetch(url: string, init?: RequestInit & { headers?: Record<string, string> }): Promise<Response> }
interface MiniflareTooling { Miniflare: new (options: Record<string, unknown>) => MiniflareInstance; convertV4MiniflareOptions(options: Record<string, unknown>): Record<string, unknown> }
interface BundleOptions { entryPoints: string[]; outfile: string; bundle: boolean; format: string; platform: string; external: string[] }
const require = createRequire(resolve(process.env['JOINALLWORLD_TOOLS'] || 'deploy/tooling', 'package.json'));
const { Miniflare, convertV4MiniflareOptions } = require('miniflare') as MiniflareTooling;
const { build } = require('esbuild') as { build(options: BundleOptions): Promise<unknown> };

const PRINT = Array.from({ length: 32 }, (_, i) => (i * 7 % 256).toString(16).padStart(2, '0').toUpperCase()).join(':');

async function worker(t: TestContext, bindings: Record<string, string>, builtAssets = false) {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-assetlinks-'));
  const dist = join(folder, 'dist');
  await mkdir(join(dist, 'assets'), { recursive: true });
  await writeFile(join(dist, 'index.html'), '<!doctype html><title>The game</title><div id="app"></div>');
  await writeFile(join(dist, 'adminshell.html'), '<!doctype html><title>Allworld staff</title><div id="app"></div>');
  const bundle = join(folder, 'worker.mjs');
  await build({ entryPoints: [new URL('./cloudflare-worker.ts', import.meta.url).pathname], outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
  const options = {
    name: 'joinallworld-assetlinks', script: await readFile(bundle, 'utf8'), modules: true, compatibilityDate: '2026-10-01',
    durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, bindings: { BUILD_ID: 'assetlinks-test', ...bindings },
    assets: { directory: builtAssets ? resolve('dist') : dist, binding: 'ASSETS', run_worker_first: true, routerConfig: { has_user_worker: true }, assetConfig: { not_found_handling: 'single-page-application' } },
  };
  const mf = new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: join(folder, 'storage'), handleStructuredLogs: () => {} });
  t.after(async () => { await mf.dispose(); await rm(folder, { recursive: true, force: true }); });
  await mf.ready;
  return async (base: string, path: string, init: RequestInit = {}) => { const r = await mf.dispatchFetch(base + path, init as RequestInit & { headers?: Record<string, string> }); return { status: r.status, type: r.headers.get('content-type'), nosniff: r.headers.get('x-content-type-options'), text: await r.text() }; };
}

test('on the Worker assetlinks.json is a 404 until the signing fingerprint is set, never the game page', async (t) => {
  const get = await worker(t, {});
  const game = 'https://joinallworld.test';
  const missing = await get(game, '/.well-known/assetlinks.json');
  assert.deepEqual([missing.status, missing.type, missing.text], [404, 'application/json', '{"error":"not_found"}']);
  assert.equal((await get(game, '/manifest.webmanifest')).status, 200, 'the other site files are untouched');
});

test('on the Worker a set fingerprint is published as Digital Asset Links, on the game address only; a bad one publishes nothing', async (t) => {
  const get = await worker(t, { PLAY_SIGNING_SHA256: PRINT.toLowerCase(), ADMIN_HOST: 'admin.joinallworld.test' });
  const game = 'https://joinallworld.test';
  const found = await get(game, '/.well-known/assetlinks.json');
  assert.deepEqual([found.status, found.type, found.nosniff], [200, 'application/json', 'nosniff']);
  assert.deepEqual(JSON.parse(found.text), [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'com.joinallworld.app', sha256_cert_fingerprints: [PRINT] } }]);
  assert.equal(await (await get(game, '/.well-known/assetlinks.json', { method: 'HEAD' })).text, '');
  assert.equal((await get('https://admin.joinallworld.test', '/.well-known/assetlinks.json')).status, 404, 'the admin address serves none of the game\'s files');

  const wrong = await worker(t, { PLAY_SIGNING_SHA256: 'REPLACE-WITH-PLAY-SHA256' });
  assert.equal((await wrong(game, '/.well-known/assetlinks.json')).status, 404);
});


test('Worker public rules, deletion instructions and app payment refusal use the shared server policy', async t => {
  const get = await worker(t, {}, true)
  const game = 'https://joinallworld.test'
  for (const path of ['/terms', '/privacy']) {
    const page = await get(game, path)
    assert.equal(page.status, 200, page.text)
    assert.match(page.text, /width=device-width/)
    assert.match(page.text, /lawyer/)
    if (path === '/privacy') assert.match(page.text, /id="delete"/)
  }
  for (const path of ['/api/earn/pay', '/api/promote/order', '/api/civic/ads/rent']) {
    const refused = await get(game, path, { method: 'POST', headers: { 'X-Allworld-App': 'play', 'Content-Type': 'application/json' }, body: '{}' })
    assert.equal(refused.status, 403, path + ": " + refused.text)
    assert.equal(JSON.parse(refused.text).error, 'play_payment_unavailable')
  }
})
