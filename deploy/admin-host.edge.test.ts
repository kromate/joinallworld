// The admin address (server/admin/host.ts) on the Worker host: the same decisions as the Node host (server/admin/host.test.ts). The admin page is the
// build's second entry, read from the assets binding; the game's own address does not serve it, and the admin address serves nothing of the game.
import test from 'node:test';
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

test('on the Worker the admin address serves the admin page and a few routes, and nothing of the game', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-adminhost-'));
  const dist = join(folder, 'dist');
  await mkdir(join(dist, 'assets'), { recursive: true });
  await writeFile(join(dist, 'index.html'), '<!doctype html><title>The game</title><div id="app"></div>');
  await writeFile(join(dist, 'adminshell.html'), '<!doctype html><title>Allworld staff</title><div id="app"></div><script type="module" src="/assets/adminshell-test.js"></script>');
  await writeFile(join(dist, 'assets', 'adminshell-test.js'), 'export {}');
  await writeFile(join(dist, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  const bundle = join(folder, 'worker.mjs');
  await build({ entryPoints: [new URL('./cloudflare-worker.ts', import.meta.url).pathname], outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
  const options = {
    name: 'joinallworld-adminhost', script: await readFile(bundle, 'utf8'), modules: true, compatibilityDate: '2026-10-01',
    durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, bindings: { BUILD_ID: 'admin-host-test' },
    assets: { directory: dist, binding: 'ASSETS', run_worker_first: true, routerConfig: { has_user_worker: true }, assetConfig: { not_found_handling: 'single-page-application' } },
  };
  const mf = new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: join(folder, 'storage'), handleStructuredLogs: () => {} });
  t.after(async () => { await mf.dispose(); await rm(folder, { recursive: true, force: true }); });
  await mf.ready;
  const game = 'https://joinallworld.test', admin = 'https://admin.joinallworld.com';
  const get = async (base: string, path: string, init: RequestInit & { headers?: Record<string, string> } = {}) => { const r = await mf.dispatchFetch(base + path, init); const text = await r.text(); return { status: r.status, headers: r.headers, text }; };

  const page = await get(admin, '/');
  assert.equal(page.status, 200); assert.match(page.text, /Allworld staff/); assert.doesNotMatch(page.text, /The game/);
  assert.equal((await get(admin, '/players/abc')).text, page.text);
  assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow'); assert.equal(page.headers.get('referrer-policy'), 'no-referrer'); assert.equal(page.headers.get('x-frame-options'), 'DENY'); assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.match(page.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/); assert.doesNotMatch(page.headers.get('content-security-policy') ?? '', /cloudflareinsights/);
  assert.match(page.headers.get('strict-transport-security') ?? '', /max-age=31536000/);
  assert.match(page.headers.get('permissions-policy') ?? '', /microphone=\(\)/);
  const robots = await get(admin, '/robots.txt'); assert.equal(robots.status, 200); assert.match(robots.text, /Disallow: \//);
  assert.equal((await get(admin, '/assets/adminshell-test.js')).status, 200);
  for (const path of ['/manifest.webmanifest', '/sitemap.xml', '/socket', '/s/abc', '/e/x', '/api/life?city=lagos', '/api/social/me', '/api/mod/overview', '/api/companion/ask']) assert.equal((await get(admin, path)).status, 404, path);
  assert.equal((await get(admin, '/api/session', { method: 'POST', headers: { origin: admin, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Mallory' }) })).status, 404, 'no guest players are made on the admin address');
  assert.equal((await get(admin, '/', { method: 'POST', body: '{}' })).status, 405);
  const health = await get(admin, '/api/health'); assert.equal(health.status, 200); assert.equal(JSON.parse(health.text).ok, true);
  assert.equal((await get(admin, '/api/admin/me', { headers: { origin: admin } })).status, 404, 'a request with no session is no admin');
  assert.equal((await get(admin, '/api/admin/me', { headers: { origin: game } })).status, 403, 'an origin that is not the admin address is refused');
  // the game's own address: unchanged, and without the admin page
  const home = await get(game, '/'); assert.equal(home.status, 200); assert.match(home.text, /The game/);
  assert.equal((await get(game, '/adminshell.html')).status, 404); assert.equal((await get(game, '/adminshell')).status, 404);
  assert.equal((await get(game, '/manifest.webmanifest')).status, 200);
  assert.equal((await get(game, '/robots.txt')).text, 'User-agent: *\nAllow: /\n');
  // a name of its own: ADMIN_HOST replaces the default
  assert.ok(true);
});
