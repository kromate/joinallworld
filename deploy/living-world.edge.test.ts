// Real Worker practice API: identity, retries and persisted cursor continuity across supported layouts.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import type { DrivingResponse } from '../src/types/living-world.ts';

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
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-driving-'));
  const bundle = join(folder, 'worker.mjs');
  await build({ entryPoints: [new URL('./cloudflare-worker.ts', import.meta.url).pathname], outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
  const script = await readFile(bundle, 'utf8');
  let mf: MiniflareInstance | null = null, address = 0;
  async function start(bindings: Record<string, string> = {}): Promise<void> {
    if (mf) await mf.dispose();
    const options = { name: 'joinallworld-driving', script, modules: true, compatibilityDate: '2026-10-01', durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, durableObjectsPersist: join(folder, 'storage'),
      bindings: { BUILD_ID: 'driving-fixture', MODERATOR_TOKEN: TOKEN, FOUNDER_EMAIL_SHA256: '', ...bindings }, serviceBindings: { ASSETS: () => new Response('asset') } };
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
    const response = await post('/api/session', { name, onboarding: true });
    assert.equal(response.status, 200);
    const who: Device = { ...(await response.json() as { session: { id: string; name: string } }).session, cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '' };
    await (await get('/api/life?city=lagos', who)).arrayBuffer();
    return who;
  }
  const rows = async (): Promise<Record<string, number>> => (((await operator('/api/mod/overview')).json['store'] as { rows: { tables: Record<string, number> } }).rows.tables);
  return { start, post, get, operator, player, rows };
}

const LOOK = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' }
const requestId = () => `${Date.now()}:${crypto.randomUUID()}`
const path = '/api/living-world/driving'

test('on the Worker: a free guest practice cursor survives shadow, entries restart and layout reversal; retries step once', async t => {
  const h = await host(t)
  await h.start()
  const ada = await h.player('Ada'), bola = await h.player('Bola')
  for (const who of [ada, bola]) {
    const confirm = await h.post('/api/action', { actionId: requestId(), cityId: 'lagos', type: 'onboarding.quick-start', payload: { look: LOOK } }, who)
    assert.equal((await confirm.json() as { code: string }).code, 'playing')
  }
  const startedResponse = await h.post(path + '/start', { cityId: 'lagos', requestId: requestId() }, ada)
  assert.equal(startedResponse.status, 200)
  const started = await startedResponse.json() as DrivingResponse
  assert.equal(started.ok, true)
  assert.ok(started.session)
  const session = started.session!
  await delay(250)
  const packet = { cityId: 'lagos', journeyId: session.journeyId, sequence: 1, frames: [{ throttle: 1, brake: 0, steer: 0 }] }
  const [a, b] = await Promise.all([h.post(path + '/input', packet, ada), h.post(path + '/input', packet, ada)])
  const results = await Promise.all([a.json(), b.json()]) as DrivingResponse[]
  assert.ok(results.every(result => result.ok))
  assert.equal(results.filter(result => result.duplicate).length, 1)
  assert.ok(results.every(result => result.session?.revision === 2 && result.session.nextSequence === 2))
  const paused = await (await h.get(path + '?city=lagos', ada)).json() as DrivingResponse
  assert.equal(paused.session?.state.status, 'paused')
  assert.equal(paused.session?.state.speed, 0)
  assert.ok(paused.session!.state.position.z > 0)
  const expected = paused.session
  const foreign = await h.post(path + '/resume', { cityId: 'lagos', journeyId: session.journeyId, revision: expected!.revision, requestId: requestId() }, bola)
  assert.equal(foreign.status, 200)
  assert.equal((await foreign.json() as DrivingResponse).code, 'no_journey', 'another actor cannot resume Ada’s lesson')

  await h.start({ STORE_LAYOUT: 'shadow' })
  const shadow = await (await h.get(path + '?city=lagos', ada)).json() as DrivingResponse
  assert.deepEqual(shadow.session, expected)
  const compared = (await h.operator('/api/mod/store/compare')).json['collections'] as Record<string, { equal: boolean }>
  assert.equal(compared['livingWorld']?.equal, true)
  assert.equal(((await h.operator('/api/mod/store')).json['shadow'] as { mismatches: number }).mismatches, 0)
  assert.equal((await h.operator('/api/mod/store/layout', { layout: 'entries' })).status, 200)
  await h.start({ STORE_LAYOUT: 'legacy' })
  assert.equal((await h.operator('/api/mod/store')).json['requested'], 'entries')
  assert.deepEqual((await (await h.get(path + '?city=lagos', ada)).json() as DrivingResponse).session, expected)

  const before = await h.rows()
  const resumed = await (await h.post(path + '/resume', { cityId: 'lagos', journeyId: session.journeyId, revision: expected!.revision, requestId: requestId() }, ada)).json() as DrivingResponse
  assert.equal(resumed.ok, true)
  const after = await h.rows()
  const changedEntries = (after['entries'] ?? 0) - (before['entries'] ?? 0)
  assert.ok(changedEntries >= 1 && changedEntries <= 5, `one actor transition writes a bounded positive number of entry rows: ${changedEntries}`)
  const stop = await (await h.post(path + '/pause', { cityId: 'lagos', journeyId: session.journeyId, revision: resumed.session!.revision, requestId: requestId() }, ada)).json() as DrivingResponse
  assert.equal(stop.ok, true)
  assert.equal((await h.operator('/api/mod/store/layout', { layout: 'legacy' })).status, 200)
  await h.start()
  assert.deepEqual((await (await h.get(path + '?city=lagos', ada)).json() as DrivingResponse).session, stop.session)
  assert.equal((await h.operator('/api/mod/store')).json['requested'], 'legacy')
})
