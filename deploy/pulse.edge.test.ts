// The pulse (server/pulse.ts) on the Worker host: people online and total visits through the Durable Object,
// and the visit count surviving the object being evicted and restarted.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

interface StubSocket { addEventListener(type: 'message', listener: (event: { data: string }) => void): void; accept(): void; send(data: string): void; close(): void }
type MiniflareResponse = Response & { webSocket?: StubSocket | null }
type Row = { value: string; [column: string]: string | number }
interface ObjectStorage { exec(query: string, ...bindings: (string | number | null)[]): Promise<Row[]> }
interface MiniflareInstance {
  ready: Promise<URL>
  dispose(): Promise<void>
  dispatchFetch(url: string, init?: RequestInit & { headers?: Record<string, string> }): Promise<MiniflareResponse>
  unsafeGetDurableObjectStorage(script: string, className: string, id: { name: string }): Promise<ObjectStorage>
  unsafeEvictDurableObject(script: string, className: string, id: { name: string; webSockets?: 'hibernate' }): Promise<void>
}
interface MiniflareTooling { Miniflare: new (options: Record<string, unknown>) => MiniflareInstance; convertV4MiniflareOptions(options: Record<string, unknown>): Record<string, unknown> }
interface BundleOptions { entryPoints: string[]; outfile: string; bundle: boolean; format: string; platform: string; external: string[] }
const require = createRequire(resolve(process.env['JOINALLWORLD_TOOLS'] || 'deploy/tooling', 'package.json'));
const { Miniflare, convertV4MiniflareOptions } = require('miniflare') as MiniflareTooling;
const { build } = require('esbuild') as { build(options: BundleOptions): Promise<unknown> };

interface Device { id: string; name: string; cookie: string }
interface Pulse { online: number; visits: number; cities: Record<string, number> }

async function fixture(t: TestContext) {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-pulse-'));
  const bundle = join(folder, 'worker.mjs');
  await build({ entryPoints: [new URL('./cloudflare-worker.ts', import.meta.url).pathname], outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
  const options = { name: 'joinallworld-pulse', script: await readFile(bundle, 'utf8'), modules: true, compatibilityDate: '2026-10-01', durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, durableObjectsPersist: join(folder, 'storage'), bindings: { BUILD_ID: 'local-pulse' }, assets: { directory: new URL('../dist', import.meta.url).pathname, binding: 'ASSETS', run_worker_first: true, routerConfig: { has_user_worker: true }, assetConfig: { not_found_handling: 'single-page-application' } } };
  const make = () => new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: join(folder, 'storage'), unsafeInspectDurableObjects: true, handleStructuredLogs: () => {} });
  let mf = make();
  const sockets: StubSocket[] = [], handed: MiniflareResponse[] = [];
  const within = <T>(step: string, work: Promise<T>, ms = 30000) => { let timer: NodeJS.Timeout; return Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(`${step} did not finish within ${ms} ms`)), ms); })]).finally(() => clearTimeout(timer)); };
  const send = async (url: string, init?: RequestInit & { headers?: Record<string, string> }) => { const response = await mf.dispatchFetch(url, init); handed.push(response); return response; };
  // Responses nobody read keep Miniflare's dispose waiting: cancel them first and bound the dispose.
  async function stop() {
    for (const socket of sockets.splice(0)) try { socket.close(); } catch { /* closed */ }
    for (const response of handed.splice(0)) if (!response.bodyUsed && response.body && !response.body.locked) await response.body.cancel().catch(() => {});
    await within('Miniflare dispose', mf.dispose());
  }
  t.after(async () => { await stop(); await rm(folder, { recursive: true, force: true }); });
  await mf.ready;
  const origin = 'https://joinallworld.test';
  const request = (path: string, body?: object | null, cookie?: string) => send(origin + path, { method: body ? 'POST' : 'GET', headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  async function device(name: string, onboarding = false): Promise<Device> {
    const response = await request('/api/session', { name, ...(onboarding ? { onboarding: true } : {}) });
    assert.equal(response.status, 200);
    const body = await response.json() as { session: { id: string; name: string } };
    return { ...body.session, cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '' };
  }
  async function socket(who: Device) {
    const response = await send(origin + '/socket', { headers: { origin, cookie: who.cookie, upgrade: 'websocket' } });
    assert.equal(response.status, 101);
    const ws = response.webSocket as StubSocket;
    ws.addEventListener('message', (event) => { if ((JSON.parse(event.data) as { type: string }).type === 'heartbeat') ws.send(JSON.stringify({ type: 'heartbeat-ack' })); });
    ws.accept(); sockets.push(ws);
    return ws;
  }
  const pulse = async (who: Device): Promise<Pulse> => { const response = await request('/api/world/pulse', null, who.cookie); assert.equal(response.status, 200); return await response.json() as Pulse; };
  const storage = () => mf.unsafeGetDurableObjectStorage('joinallworld-pulse', 'JoinAllworldState', { name: 'joinallworld-v1' });
  return {
    request, device, socket, pulse, storage,
    hibernate: () => mf.unsafeEvictDurableObject('joinallworld-pulse', 'JoinAllworldState', { name: 'joinallworld-v1', webSockets: 'hibernate' }),
    restart: async () => { await stop(); mf = make(); await within('Miniflare restart', mf.ready); },
  };
}

test('Cloudflare pulse: online is distinct live players, visits one per player per day, both survive eviction and restart', async (t) => {
  const f = await fixture(t);
  const ada = await f.device('Ada'), guest = await f.device('Guest', true);
  assert.equal((await f.request('/api/world/pulse')).status, 401, 'a signed-in device is required');

  await f.socket(ada); await f.socket(ada); await f.socket(guest);
  const first = await f.pulse(ada);
  assert.equal(first.online, 2, 'Ada once however many sockets, and the guest');
  assert.equal(first.visits, 2, 'the first count is seeded from the two stored sessions, each once');
  assert.equal((await f.pulse(ada)).visits, 2, 'the same day is not counted twice');
  const bola = await f.device('Bola');
  assert.equal((await f.pulse(bola)).visits, 3, 'a player who arrives after the seed adds one');
  assert.equal((await f.pulse(bola)).online, 2, 'a player who only polls is not online');

  // The count is a row of the collections table, beside the other collections.
  const stored = async () => JSON.parse((await (await f.storage()).exec("SELECT value FROM collections WHERE name = 'pulse'"))[0]?.value ?? '{}') as { visits?: number };
  assert.equal((await stored()).visits, 3);

  // The object is evicted with its sockets hibernating: they are still there afterwards, and nobody is counted again.
  await f.hibernate();
  const woke = await f.pulse(ada);
  assert.equal(woke.online, 2, 'hibernating sockets still count');
  assert.equal(woke.visits, 3, 'an eviction does not count anyone again');

  // A restart of the whole host: the sockets are gone, the visits are not.
  await f.restart();
  const after = await f.pulse(bola);
  assert.equal(after.visits, 3, 'visits survive a restart');
  assert.equal(after.online, 0, 'nobody is connected any more');

  // A new Lagos day for Ada: her stored day moves back, and her next visit counts once.
  const db = await f.storage(), secret = ada.cookie.slice(ada.cookie.indexOf("=") + 1);
  const session = JSON.parse((await db.exec('SELECT value FROM sessions WHERE secret = ?', secret))[0]?.value ?? '{}') as { visitDay?: number };
  assert.equal(typeof session.visitDay, 'number');
  session.visitDay = (session.visitDay ?? 0) - 1;
  await db.exec('UPDATE sessions SET value = ? WHERE secret = ?', JSON.stringify(session), secret);
  await f.restart();
  assert.equal((await f.pulse(ada)).visits, 4);
  assert.equal((await f.pulse(ada)).visits, 4);
});
