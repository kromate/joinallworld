// The caps on the Worker host (docs/CAPACITY.md): the settings reach the Durable Object, a new visitor waits for a place,
// a socket that finds every place taken is told to come back later, and what a socket carries survives a sleep although
// it is written only when it changed.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { layoutBindings } from '../server/testing/sqliteStorage.ts';

interface StubSocket { addEventListener(type: 'message', listener: (event: { data: string }) => void): void; addEventListener(type: 'close', listener: (event: { code: number; reason: string }) => void): void; accept(): void; send(data: string): void; close(): void }
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
interface Member { id: string; name: string; position: { x: number; z: number } }
interface Frame { type: string; members?: Member[]; code?: string }
const pause = (ms = 25): Promise<void> => new Promise((done) => setTimeout(done, ms));

async function fixture(t: TestContext, bindings: Record<string, string> = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-capacity-'));
  const bundle = join(folder, 'worker.mjs');
  await build({ entryPoints: [new URL('./cloudflare-worker.ts', import.meta.url).pathname], outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
  const options = { name: 'joinallworld-capacity', script: await readFile(bundle, 'utf8'), modules: true, compatibilityDate: '2026-10-01', durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, durableObjectsPersist: join(folder, 'storage'), bindings: { ...layoutBindings(), BUILD_ID: 'capacity', ...bindings }, serviceBindings: { ASSETS: () => new Response('asset') } };
  const mf = new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: join(folder, 'storage'), unsafeInspectDurableObjects: true, handleStructuredLogs: () => {} });
  const sockets: StubSocket[] = [], handed: MiniflareResponse[] = [];
  const send = async (url: string, init?: RequestInit & { headers?: Record<string, string> }) => { const response = await mf.dispatchFetch(url, init); handed.push(response); return response; };
  t.after(async () => {
    for (const socket of sockets.splice(0)) try { socket.close(); } catch { /* closed */ }
    for (const response of handed.splice(0)) if (!response.bodyUsed && response.body && !response.body.locked) await response.body.cancel().catch(() => {});
    await mf.dispose();
    await rm(folder, { recursive: true, force: true });
  });
  await mf.ready;
  const origin = 'https://joinallworld.test';
  let address = 0;
  const post = (path: string, body: object, who?: Device) => send(origin + path, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'cf-connecting-ip': `198.51.100.${1 + (address++ % 200)}`, ...(who ? { cookie: who.cookie } : {}) }, body: JSON.stringify(body) });
  const get = (path: string, who: Device) => send(origin + path, { headers: { origin, cookie: who.cookie } });
  async function player(name: string): Promise<Device> {
    const response = await post('/api/session', { name });
    assert.equal(response.status, 200);
    const who: Device = { ...(await response.json() as { session: { id: string; name: string } }).session, cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '' };
    await (await get('/api/life?city=lagos', who)).arrayBuffer();
    return who;
  }
  /** A socket that answers the heartbeat and keeps what it is sent; `closed` is how the host ended it, if it did. */
  async function socket(who: Device) {
    const response = await send(origin + '/socket', { headers: { origin, cookie: who.cookie, upgrade: 'websocket', 'cf-connecting-ip': `203.0.113.${1 + (address++ % 200)}` } });
    assert.equal(response.status, 101);
    const ws = response.webSocket as StubSocket, frames: Frame[] = [];
    let closed: { code: number; reason: string } | null = null;
    ws.addEventListener('message', (event) => { const frame = JSON.parse(event.data) as Frame; if (frame.type === 'heartbeat') ws.send(JSON.stringify({ type: 'heartbeat-ack' })); else frames.push(frame); });
    ws.addEventListener('close', (event) => { closed = { code: event.code, reason: event.reason }; });
    ws.accept(); sockets.push(ws);
    async function until<T>(read: () => T | undefined | null | false, what: string): Promise<T> {
      for (let i = 0; i < 200; i++) { const value = read(); if (value) return value; await pause(); }
      throw new Error(`Never happened: ${what}`);
    }
    return { ws, frames, until, closed: () => closed, members: () => frames.filter((frame) => frame.type === 'presence').at(-1)?.members ?? [] };
  }
  const postFrom = (ip: string, path: string, body: object, who?: Device) => send(origin + path, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(who ? { cookie: who.cookie } : {}) }, body: JSON.stringify(body) });
  return { post, postFrom, get, player, socket, hibernate: () => mf.unsafeEvictDurableObject('joinallworld-capacity', 'JoinAllworldState', { name: 'joinallworld-v1', webSockets: 'hibernate' }) };
}

test('on the Worker: a full world asks a new visitor to wait with a sentence, and the players who are in play on', async (t) => {
  const f = await fixture(t, { MAX_ACTIVE_SESSIONS: '2' });
  const ada = await f.player('Ada'); await f.player('Bola');
  const refused = await f.post('/api/session', { name: 'Chidi' });
  assert.equal(refused.status, 503);
  assert.equal(refused.headers.get('retry-after'), '30');
  assert.deepEqual(await refused.json(), { error: 'device_capacity', reason: 'The world is full right now. Your place is not lost: try again in a moment.', retryAfter: 30 });
  assert.equal((await f.get('/api/life?city=lagos', ada)).status, 200);
  assert.equal((await f.post('/api/session', { name: 'Ada Again' }, ada)).status, 200);
});

test('on the Worker: every socket taken closes a new one with "try again later"; nobody connected is dropped; a place freed is a place given', async (t) => {
  const f = await fixture(t, { MAX_SOCKETS: '2' });
  const ada = await f.player('Ada'), bola = await f.player('Bola');
  const first = await f.socket(ada), second = await f.socket(bola);
  const third = await f.socket(ada);
  assert.deepEqual(await third.until(() => third.closed(), 'the third socket is closed'), { code: 1013, reason: 'socket_capacity' });
  // The two who are connected still are: they join a room and see each other.
  first.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' })); second.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' }));
  await first.until(() => first.members().length === 2, 'both in the park');
  assert.equal(first.closed(), null); assert.equal(second.closed(), null);
  // One leaves: the next socket is taken and works.
  second.ws.close();
  await first.until(() => first.members().length === 1, 'Bola left the room');
  const next = await f.socket(bola);
  next.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' }));
  await next.until(() => next.members().length === 2, 'Bola is back');
  assert.equal(next.closed(), null);
});

test('on the Worker: what a socket carries is written when it changes, and is all there after the object slept', { timeout: 120000 }, async (t) => {
  const f = await fixture(t, { SLEEP_BETWEEN_BEATS: '1' });
  const ada = await f.player('Ada'), bola = await f.player('Bola'), cy = await f.player('Cyril');
  const a = await f.socket(ada), b = await f.socket(bola);
  a.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' })); b.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' }));
  await a.until(() => a.members().length === 2, 'both in the park');
  // Ada moves, twice; Bola stays where he is and sends nothing: his socket is written once, hers each time it changed.
  a.ws.send(JSON.stringify({ type: 'move', x: 3, z: -4 }));
  await b.until(() => b.members().find((member) => member.id === ada.id)?.position.x === 3, 'the first move');
  a.ws.send(JSON.stringify({ type: 'move', x: 7.5, z: 2 }));
  await b.until(() => b.members().find((member) => member.id === ada.id)?.position.x === 7.5, 'the second move');
  await f.hibernate();
  // The object has lost its memory. A newcomer's member list is built from what the sockets carried.
  const c = await f.socket(cy);
  c.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' }));
  const members = await c.until(() => (c.members().length === 3 ? c.members() : null), 'three in the park after the sleep');
  assert.deepEqual(members.find((member) => member.id === ada.id)?.position, { x: 7.5, z: 2 }, 'the position of her last move, not of an earlier one');
  assert.deepEqual(members.map((member) => member.name).sort(), ['Ada', 'Bola', 'Cyril']);
  // And the sockets that slept still work: a move after the sleep reaches the others.
  a.ws.send(JSON.stringify({ type: 'move', x: -2, z: 9 }));
  await c.until(() => c.members().find((member) => member.id === ada.id)?.position.x === -2, 'a move after the sleep');
  assert.equal(a.closed(), null); assert.equal(b.closed(), null);
});

test('on the Worker: too many new players from one network address are told why and when to come back, with Retry-After', async (t) => {
  const f = await fixture(t, { NEW_SESSIONS_PER_ADDRESS: '2' });
  const from = '203.0.113.9';
  const first = await f.postFrom(from, '/api/session', { name: 'Ada' });
  assert.equal(first.status, 200);
  const ada = (first.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  assert.equal((await f.postFrom(from, '/api/session', { name: 'Bola' })).status, 200);
  const refused = await f.postFrom(from, '/api/session', { name: 'Chidi' });
  assert.equal(refused.status, 429);
  const wait = Number(refused.headers.get('retry-after'));
  assert.ok(wait > 3500 && wait <= 3600, `Retry-After is what is left of the hour: ${wait}`);
  const body = await refused.json() as { error: string; reason: string; retryAfter: number };
  assert.deepEqual([body.error, body.retryAfter], ['rate_limited', wait]);
  assert.match(body.reason, /^Too many new players have started from your network in the last hour .* try again in about 60 minutes\.$/);
  // A player who is in, from that address, is not affected; neither is another address.
  assert.equal((await f.postFrom(from, '/api/session', { name: 'Ada Again' }, { id: '', name: '', cookie: ada })).status, 200);
  assert.equal((await f.postFrom('203.0.113.10', '/api/session', { name: 'Dami' })).status, 200);
});
