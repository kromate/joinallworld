// The move between storage layouts on the real Worker runtime (docs/STORAGE.md): persisted storage across restarts, the operator's
// routes, shadow, the switch, the way back, and the rows each message costs. Run with Miniflare against the bundled Worker.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

interface MiniflareInstance { ready: Promise<URL>; dispose(): Promise<void>; dispatchFetch(url: string, init?: RequestInit & { headers?: Record<string, string> }): Promise<Response> }
interface MiniflareTooling { Miniflare: new (options: Record<string, unknown>) => MiniflareInstance; convertV4MiniflareOptions(options: Record<string, unknown>): Record<string, unknown> }
const require = createRequire(resolve(process.env['JOINALLWORLD_TOOLS'] || 'deploy/tooling', 'package.json'));
const { Miniflare, convertV4MiniflareOptions } = require('miniflare') as MiniflareTooling;
const { build } = require('esbuild') as { build(options: Record<string, unknown>): Promise<unknown> };

interface Device { id: string; name: string; cookie: string }
const TOKEN = 'storage-edge-test-token-0123456789';
const origin = 'https://joinallworld.test';

/** A Worker over a folder that outlives it: `start` again with other settings to restart it on the same storage. */
async function host(t: TestContext) {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-storage-'));
  const bundle = join(folder, 'worker.mjs');
  await build({ entryPoints: [new URL('./cloudflare-worker.ts', import.meta.url).pathname], outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
  const script = await readFile(bundle, 'utf8');
  let mf: MiniflareInstance | null = null, address = 0;
  async function start(bindings: Record<string, string> = {}): Promise<void> {
    if (mf) await mf.dispose();
    const options = { name: 'joinallworld-storage', script, modules: true, compatibilityDate: '2026-10-01', durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, durableObjectsPersist: join(folder, 'storage'),
      bindings: { BUILD_ID: 'storage', MODERATOR_TOKEN: TOKEN, FOUNDER_EMAIL_SHA256: '', ...bindings }, serviceBindings: { ASSETS: () => new Response('asset') } };
    mf = new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: join(folder, 'storage'), handleStructuredLogs: () => {} });
    await mf.ready;
  }
  t.after(async () => { await mf?.dispose(); await rm(folder, { recursive: true, force: true }); });
  const send = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<Response> => (mf as MiniflareInstance).dispatchFetch(origin + path, init);
  const post = (path: string, body: object, who?: Device) => send(path, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'cf-connecting-ip': `198.51.100.${1 + (address++ % 200)}`, ...(who ? { cookie: who.cookie } : {}) }, body: JSON.stringify(body) });
  const get = (path: string, who: Device) => send(path, { headers: { origin, cookie: who.cookie, 'cf-connecting-ip': `198.51.100.${1 + (address++ % 200)}` } });
  const operator = async (path: string, body?: object): Promise<{ status: number; json: Record<string, unknown> }> => {
    const response = await send(path, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${TOKEN}`, 'cf-connecting-ip': '203.0.113.9', ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, json: await response.json() as Record<string, unknown> };
  };
  async function player(name: string): Promise<Device> {
    const response = await post('/api/session', { name });
    assert.equal(response.status, 200);
    const who: Device = { ...(await response.json() as { session: { id: string; name: string } }).session, cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '' };
    await (await get('/api/life?city=lagos', who)).arrayBuffer(); await (await get('/api/social/me', who)).arrayBuffer();
    return who;
  }
  const rows = async (): Promise<Record<string, number>> => (((await operator('/api/mod/overview')).json['store'] as { rows: { tables: Record<string, number> } }).rows.tables);
  return { start, post, get, operator, player, rows };
}
async function befriend(h: Awaited<ReturnType<typeof host>>, a: Device, b: Device): Promise<void> {
  await (await h.post('/api/social/friends/request', { to: b.id, cityId: 'lagos' }, a)).arrayBuffer();
  await (await h.post('/api/social/friends/answer', { from: a.id, accept: true, cityId: 'lagos' }, b)).arrayBuffer();
}
const say = async (h: Awaited<ReturnType<typeof host>>, from: Device, to: Device, body: string): Promise<{ ok?: boolean; conv?: { id: string } }> => (await (await h.post('/api/social/messages', { to: to.id, body, clientId: `${Date.now()}:${crypto.randomUUID()}` }, from)).json()) as { ok?: boolean; conv?: { id: string } };
const history = async (h: Awaited<ReturnType<typeof host>>, who: Device, conv: string): Promise<string[]> => ((await (await h.get(`/api/social/conversations/${encodeURIComponent(conv)}`, who)).json()) as { messages?: { body: string }[] }).messages?.map((m) => m.body) ?? [];

test('on the Worker: shadow, the switch, a restart, the way back and the safety copy, on persisted storage', async (t) => {
  const h = await host(t);
  await h.start();
  const ada = await h.player('Ada'), bola = await h.player('Bola');
  await befriend(h, ada, bola);
  const first = await say(h, ada, bola, 'before the move');
  assert.equal(first.ok, true);
  const conv = first.conv?.id as string;
  assert.equal((await h.operator('/api/mod/store')).json['requested'], 'legacy');
  // What the same message costs in the legacy layout, for the comparison below (a message to an existing conversation).
  const legacyBefore = await h.rows();
  await say(h, bola, ada, 'legacy cost');
  const legacyAfter = await h.rows();
  const legacyRows = Object.keys(legacyAfter).reduce((sum, table) => sum + (legacyAfter[table] ?? 0) - (legacyBefore[table] ?? 0), 0);
  console.log(`rows written by one message, legacy layout: ${legacyRows} (${JSON.stringify(Object.fromEntries(Object.keys(legacyAfter).map((table) => [table, (legacyAfter[table] ?? 0) - (legacyBefore[table] ?? 0)]).filter(([, n]) => n)))})`);

  // Shadow: the first request after the restart makes the entry copy; it is kept equal and the sample finds nothing.
  await h.start({ STORE_LAYOUT: 'shadow' });
  assert.deepEqual(await history(h, bola, conv), ['before the move', 'legacy cost']);
  await say(h, bola, ada, 'in shadow');
  const compared = (await h.operator('/api/mod/store/compare')).json['collections'] as Record<string, { equal: boolean }>;
  assert.ok(Object.values(compared).every((row) => row.equal), JSON.stringify(compared));
  assert.equal(((await h.operator('/api/mod/store')).json['shadow'] as { mismatches: number }).mismatches, 0);

  // The switch, then a restart that asks for `legacy` again: the stored switch wins; only the operator's route goes back.
  const switched = await h.operator('/api/mod/store/layout', { layout: 'entries' });
  assert.equal(switched.status, 200);
  await say(h, ada, bola, 'after the switch');
  await h.start({ STORE_LAYOUT: 'legacy' });
  assert.equal((await h.operator('/api/mod/store')).json['requested'], 'entries');
  assert.deepEqual(await history(h, ada, conv), ['before the move', 'legacy cost', 'in shadow', 'after the switch']);
  assert.equal((await h.operator('/api/mod/store/safety', { action: 'drop' })).status, 409, 'the safety copy is kept 14 days');

  // A message costs a handful of rows, and reading costs none.
  const before = await h.rows();
  await say(h, bola, ada, 'counted');
  const after = await h.rows();
  const wrote = (table: string): number => (after[table] ?? 0) - (before[table] ?? 0);
  assert.ok(wrote('entries') >= 1 && wrote('entries') <= 4, `entries rows for one message: ${wrote('entries')}`);
  const entriesRows = Object.keys(after).reduce((sum, table) => sum + wrote(table), 0);
  console.log(`rows written by one message, entries layout: ${entriesRows} (${JSON.stringify(Object.fromEntries(Object.keys(after).map((table) => [table, wrote(table)]).filter(([, n]) => n)))})`);
  const quiet = await h.rows();
  await (await h.get('/api/social/me', ada)).arrayBuffer(); await history(h, ada, conv);
  assert.equal(((await h.rows())['entries'] ?? 0), quiet['entries'] ?? 0, 'reading writes no entry row');

  // The way back keeps every message.
  assert.equal((await h.operator('/api/mod/store/layout', { layout: 'legacy' })).status, 200);
  await h.start();
  assert.deepEqual(await history(h, bola, conv), ['before the move', 'legacy cost', 'in shadow', 'after the switch', 'counted']);
  assert.equal((await h.operator('/api/mod/store')).json['requested'], 'legacy');
});

test('on the Worker: the operator routes refuse a bad request and a request without the token', async (t) => {
  const h = await host(t);
  await h.start();
  const bad = await h.operator('/api/mod/store/layout', { layout: 'sideways' });
  assert.equal(bad.status, 400);
  assert.equal((await h.operator('/api/mod/store/safety', { action: 'drop' })).status, 409);
  assert.equal((await h.post('/api/mod/store/layout', { layout: 'entries' })).status, 401);
});
