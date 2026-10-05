// Live location (server/social/live.ts) on the Worker host: the same frames through the Durable Object, and the
// subscription rebuilt — with a fresh snapshot — after the object was evicted while its sockets hibernated.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import type { LiveMoveFrame, LiveSnapshotFrame, LiveSpot } from '../src/types/live.ts';

interface StubSocket { addEventListener(type: 'message', listener: (event: { data: string }) => void): void; accept(): void; send(data: string): void; close(): void }
type MiniflareResponse = Response & { webSocket?: StubSocket | null }
interface MiniflareInstance {
  ready: Promise<URL>
  dispose(): Promise<void>
  dispatchFetch(url: string, init?: RequestInit & { headers?: Record<string, string> }): Promise<MiniflareResponse>
  unsafeEvictDurableObject(script: string, className: string, id: { name: string; webSockets?: 'hibernate' }): Promise<void>
}
interface MiniflareTooling { Miniflare: new (options: Record<string, unknown>) => MiniflareInstance; convertV4MiniflareOptions(options: Record<string, unknown>): Record<string, unknown> }
interface BundleOptions { entryPoints: string[]; outfile: string; bundle: boolean; format: string; platform: string; external: string[] }
const require = createRequire(resolve(process.env['JOINALLWORLD_TOOLS'] || 'deploy/tooling', 'package.json'));
const { Miniflare, convertV4MiniflareOptions } = require('miniflare') as MiniflareTooling;
const { build } = require('esbuild') as { build(options: BundleOptions): Promise<unknown> };

interface Device { id: string; name: string; cookie: string }
type LiveFrame = LiveSnapshotFrame | LiveMoveFrame
const pause = (ms = 25): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** `sleeps`: the object may sleep while sockets are connected (SLEEP_BETWEEN_BEATS), for a test that puts it to sleep. */
async function fixture(t: TestContext, sleeps = false) {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-live-'));
  const bundle = join(folder, 'worker.mjs');
  await build({ entryPoints: [new URL('./cloudflare-worker.ts', import.meta.url).pathname], outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
  const options = { name: 'joinallworld-live', script: await readFile(bundle, 'utf8'), modules: true, compatibilityDate: '2026-10-01', durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, durableObjectsPersist: join(folder, 'storage'), bindings: { BUILD_ID: 'local-live', FOUNDER_EMAIL_SHA256: '', ...(sleeps ? { SLEEP_BETWEEN_BEATS: '1' } : {}) }, assets: { directory: new URL('../dist', import.meta.url).pathname, binding: 'ASSETS', run_worker_first: true, routerConfig: { has_user_worker: true }, assetConfig: { not_found_handling: 'single-page-application' } } };
  const mf = new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: join(folder, 'storage'), unsafeInspectDurableObjects: true, handleStructuredLogs: () => {} });
  const sockets: StubSocket[] = [], handed: MiniflareResponse[] = [];
  const within = <T>(step: string, work: Promise<T>, ms = 30000) => { let timer: NodeJS.Timeout; return Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(`${step} did not finish within ${ms} ms`)), ms); })]).finally(() => clearTimeout(timer)); };
  const send = async (url: string, init?: RequestInit & { headers?: Record<string, string> }) => { const response = await mf.dispatchFetch(url, init); handed.push(response); return response; };
  t.after(async () => {
    for (const socket of sockets.splice(0)) try { socket.close(); } catch { /* closed */ }
    for (const response of handed.splice(0)) if (!response.bodyUsed && response.body && !response.body.locked) await response.body.cancel().catch(() => {});
    await within('Miniflare dispose', mf.dispose());
    await rm(folder, { recursive: true, force: true });
  });
  await mf.ready;
  const origin = 'https://joinallworld.test';
  const request = async <T = Record<string, unknown>>(path: string, body: object | null, who?: Device): Promise<T> => {
    const response = await send(origin + path, { method: body ? 'POST' : 'GET', headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}), ...(who ? { cookie: who.cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return await response.json() as T;
  };
  /** A player who exists for the social features: a life in Lagos, and the overview read once. */
  async function player(name: string): Promise<Device> {
    const response = await send(origin + '/api/session', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    assert.equal(response.status, 200);
    const who: Device = { ...(await response.json() as { session: { id: string; name: string } }).session, cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '' };
    await request('/api/life?city=lagos', null, who); await request('/api/social/me', null, who);
    return who;
  }
  const action = (who: Device, type: string, fields: object = {}) => request<{ ok: boolean; code: string; state?: { activeAction?: { duration: number } | null } }>('/api/action', { actionId: `${Date.now()}:${randomUUID()}`, cityId: 'lagos', type, ...fields }, who);
  /** A socket that answers the host's heartbeat and keeps every live frame it is sent. */
  async function socket(who: Device) {
    const response = await send(origin + '/socket', { headers: { origin, cookie: who.cookie, upgrade: 'websocket' } });
    assert.equal(response.status, 101);
    const ws = response.webSocket as StubSocket, frames: LiveFrame[] = [];
    ws.addEventListener('message', (event) => {
      const frame = JSON.parse(event.data) as { type: string };
      if (frame.type === 'heartbeat') ws.send(JSON.stringify({ type: 'heartbeat-ack' }));
      if (frame.type === 'live-snapshot' || frame.type === 'live-move') frames.push(frame as LiveFrame);
    });
    ws.accept(); sockets.push(ws);
    const spot = (id: string): LiveSpot | undefined => frames.flatMap((frame) => (frame.type === 'live-snapshot' ? frame.friends : frame.spots ?? [])).filter((item) => item.id === id).at(-1);
    async function until<T>(read: () => T | undefined | null | false, what: string): Promise<T> {
      for (let i = 0; i < 300; i++) { const value = read(); if (value) return value; await pause(); }
      throw new Error(`Never happened: ${what}`);
    }
    return { ws, frames, spot, until, snapshots: () => frames.filter((frame): frame is LiveSnapshotFrame => frame.type === 'live-snapshot'), city: () => frames.map((frame) => frame.city).filter(Boolean).at(-1) ?? null };
  }
  return { request, player, action, socket, hibernate: () => mf.unsafeEvictDurableObject('joinallworld-live', 'JoinAllworldState', { name: 'joinallworld-v1', webSockets: 'hibernate' }) };
}

test('Cloudflare live location: snapshot on watch, one frame per change, and a rebuilt subscription after the object slept', { timeout: 120000 }, async (t) => {
  const f = await fixture(t, true);
  const ada = await f.player('Ada'), bola = await f.player('Bola'), cy = await f.player('Cyril');
  assert.equal((await f.request<{ code: string }>('/api/social/friends/request', { to: bola.id, cityId: 'lagos' }, ada)).code, 'requested');
  assert.equal((await f.request<{ code: string }>('/api/social/friends/answer', { from: ada.id, accept: true, cityId: 'lagos' }, bola)).code, 'accepted');

  const a = await f.socket(ada), c = await f.socket(cy);
  a.ws.send(JSON.stringify({ type: 'live-watch', cityId: 'lagos' })); c.ws.send(JSON.stringify({ type: 'live-watch', cityId: 'lagos' }));
  const first = await a.until(() => a.snapshots()[0], 'a snapshot');
  assert.deepEqual(first.friends.map((spot) => [spot.id, spot.status]), [[bola.id, 'offline']]);
  assert.ok(Math.abs(first.at - Date.now()) < 5000, 'the frame carries the server clock');
  assert.deepEqual((await c.until(() => c.snapshots()[0], 'a snapshot')).friends, [], 'a stranger follows nobody');

  // Bola connects, then starts a trip: one frame each, from the stored life.
  await f.socket(bola);
  assert.deepEqual(await a.until(() => (a.spot(bola.id)?.status === 'online' ? a.spot(bola.id) : null), 'Bola online'), { id: bola.id, status: 'online', cityId: 'lagos', venue: 'park' });
  await c.until(() => c.city()?.venues.park === 3, 'three players at the park');
  const before = Date.now();
  const started = await f.action(bola, 'travel', { id: 'library', mode: 'trek' });
  assert.equal(started.ok, true);
  const trip = await a.until(() => a.spot(bola.id)?.trip, 'the trip');
  assert.deepEqual([trip.from, trip.to, trip.mode, trip.duration], ['park', 'library', 'trek', started.state?.activeAction?.duration]);
  assert.ok(trip.startedAt >= before - 50 && trip.startedAt <= Date.now() + 50, 'the server time the trip began');
  await c.until(() => c.city()?.moving === 1 && c.city()?.venues.park === 2, 'the city counts him as moving');
  assert.ok(c.frames.every((frame) => frame.type === 'live-snapshot' ? frame.friends.length === 0 : frame.spots === undefined), 'the stranger was sent counts, never a spot');

  // The object is evicted while the sockets hibernate: what it kept in memory is gone, the sockets and what they watch are not.
  await f.hibernate();
  const had = a.snapshots().length, moved = a.frames.length;
  assert.equal((await f.action(bola, 'cancel')).ok, true);
  const again = await a.until(() => (a.snapshots().length > had ? a.snapshots().at(-1) : null), 'a fresh snapshot after the sleep');
  assert.equal(again.city?.cityId, 'lagos', 'still in the room of the city it watched');
  await a.until(() => a.spot(bola.id)?.venue === 'park' && !a.spot(bola.id)?.trip, 'Bola back at the park');
  assert.ok(a.frames.length > moved);
  await c.until(() => c.city()?.venues.park === 3 && c.city()?.moving === 0, 'the counts are whole again');
  // And changes keep arriving as frames afterwards.
  assert.equal((await f.action(bola, 'travel', { id: 'library', mode: 'trek' })).ok, true);
  await a.until(() => a.spot(bola.id)?.trip?.to === 'library', 'the next trip');
});
