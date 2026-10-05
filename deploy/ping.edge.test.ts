// Ping (server/social/ping.ts) on the Worker host: the same routes and frames through the Durable Object — a ping to a
// friend who is connected, the join link checked with a key the object keeps for itself, and the join; then, in a test of
// its own, a ping that is still there (with its link still good) after the object was evicted while its sockets hibernated.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import type { PingJoinedFrame, PingIncomingFrame, PingNotice, PingServerFrame } from '../src/types/ping.ts';

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
interface Answer { ok?: boolean; code?: string; error?: string; note?: string; link?: string; moved?: string; expiresAt?: number; from?: { id: string }; notice?: PingNotice | null; incoming?: PingNotice[]; state?: { location: string } }
const pause = (ms = 25): Promise<void> => new Promise((done) => setTimeout(done, ms));

async function fixture(t: TestContext) {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-ping-'));
  const bundle = join(folder, 'worker.mjs');
  await build({ entryPoints: [new URL('./cloudflare-worker.ts', import.meta.url).pathname], outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
  const options = { name: 'joinallworld-ping', script: await readFile(bundle, 'utf8'), modules: true, compatibilityDate: '2026-10-01', durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, durableObjectsPersist: join(folder, 'storage'), bindings: { BUILD_ID: 'local-ping', FOUNDER_EMAIL_SHA256: '' } };
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
  const request = async (path: string, body: object | null, who?: Device): Promise<Answer & { status: number }> => {
    const response = await send(origin + path, { method: body ? 'POST' : 'GET', headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}), ...(who ? { cookie: who.cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, ...(await response.json() as Answer) };
  };
  async function player(name: string): Promise<Device> {
    const response = await send(origin + '/api/session', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    assert.equal(response.status, 200);
    const who: Device = { ...(await response.json() as { session: { id: string; name: string } }).session, cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '' };
    await request('/api/life?city=lagos', null, who); await request('/api/social/me', null, who);
    return who;
  }
  const id = (): string => `${Date.now()}:${randomUUID()}`;
  /** A socket that answers the host's heartbeat and keeps every ping frame it is sent. */
  async function socket(who: Device) {
    const response = await send(origin + '/socket', { headers: { origin, cookie: who.cookie, upgrade: 'websocket' } });
    assert.equal(response.status, 101);
    const ws = response.webSocket as StubSocket, frames: PingServerFrame[] = [];
    ws.addEventListener('message', (event) => {
      const frame = JSON.parse(event.data) as { type: string };
      if (frame.type === 'heartbeat') ws.send(JSON.stringify({ type: 'heartbeat-ack' }));
      if (frame.type.startsWith('ping-')) frames.push(frame as PingServerFrame);
    });
    ws.accept(); sockets.push(ws);
    async function until<T>(read: () => T | undefined | null | false, what: string): Promise<T> {
      for (let i = 0; i < 300; i++) { const value = read(); if (value) return value; await pause(); }
      throw new Error(`Never happened: ${what}`);
    }
    return { ws, frames, until };
  }
  return { request, player, socket, id, page: (path: string) => send(origin + path), hibernate: () => mf.unsafeEvictDurableObject('joinallworld-ping', 'JoinAllworldState', { name: 'joinallworld-v1', webSockets: 'hibernate' }) };
}

test('Cloudflare ping: the frame to a connected friend, the join link checked with the object’s own key, and the join', { timeout: 120000 }, async (t) => {
  const f = await fixture(t);
  const ada = await f.player('Ada'), bola = await f.player('Bola'), cy = await f.player('Cyril');
  assert.equal((await f.request('/api/social/friends/request', { to: bola.id, cityId: 'lagos' }, ada)).code, 'requested');
  assert.equal((await f.request('/api/social/friends/answer', { from: ada.id, accept: true, cityId: 'lagos' }, bola)).code, 'accepted');
  // No connection, nowhere to be joined; a stranger cannot be pinged.
  assert.equal((await f.request('/api/social/ping', { to: bola.id, clientId: f.id() }, ada)).code, 'not_live');
  const a = await f.socket(ada), b = await f.socket(bola);
  assert.equal((await f.request('/api/social/ping', { to: cy.id, clientId: f.id() }, ada)).code, 'not_friends');

  assert.equal((await f.request('/api/action', { actionId: f.id(), cityId: 'lagos', type: 'travel', payload: { id: 'library', mode: 'trek' } }, bola)).ok, true);
  assert.equal((await f.request('/api/action', { actionId: f.id(), cityId: 'lagos', type: 'cancel' }, bola)).ok, true);
  const cid = f.id(), pinged = await f.request('/api/social/ping', { to: bola.id, clientId: cid }, ada);
  assert.deepEqual([pinged.status, pinged.code, pinged.note], [200, 'pinged', 'told']);
  assert.match(String(pinged.link), /^\/j\/[A-Za-z0-9_-]{95}$/);
  const frame = await b.until(() => b.frames.find((item): item is PingIncomingFrame => item.type === 'ping-incoming'), 'the ping frame');
  assert.deepEqual([frame.notice.from.id, frame.notice.place.cityId, frame.notice.place.venue], [ada.id, 'lagos', 'park']);
  // The same request again is the same ping, with the same link (the key is the object's own, kept in its storage).
  const again = await f.request('/api/social/ping', { to: bola.id, clientId: cid }, ada);
  assert.deepEqual([again.code, again.link], ['pinged', pinged.link]);
  assert.equal((await f.request('/api/social/ping', { to: bola.id, clientId: f.id() }, ada)).code, 'cooldown');

  // The link's own address is the game's page (the single-page fallback), and what it is is asked by the page with the caller's session.
  const token = String(pinged.link).slice(3);
  assert.equal((await f.request('/api/social/ping/open', { token })).status, 401);
  assert.equal((await f.request('/api/social/ping/open', { token }, cy)).code, 'other');
  assert.equal((await f.request('/api/social/ping/open', { token: `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}` }, bola)).code, 'invalid_link');

  const mine = await f.request('/api/social/ping/open', { token }, bola);
  assert.deepEqual([mine.code, mine.from?.id, mine.notice?.from.id], ['yours', ada.id, ada.id]);
  assert.deepEqual((await f.request('/api/social/ping', null, bola)).incoming?.map((item) => item.from.id), [ada.id]);

  const joined = await f.request('/api/social/ping/join', { from: ada.id, clientId: f.id() }, bola);
  assert.deepEqual([joined.ok, joined.code], [true, 'here'], 'both at the park: nothing to move');
  assert.equal((await f.request('/api/social/ping/join', { from: ada.id, clientId: f.id() }, bola)).code, 'left', 'used up');
  const came = await a.until(() => a.frames.find((item): item is PingJoinedFrame => item.type === 'ping-joined'), 'the pinger is told');
  assert.equal(came.by.id, bola.id);
});

test('Cloudflare ping: a ping, its link and the join after the object slept', { timeout: 120000 }, async (t) => {
  const f = await fixture(t);
  const ada = await f.player('Ada'), bola = await f.player('Bola');
  assert.equal((await f.request('/api/social/friends/request', { to: bola.id, cityId: 'lagos' }, ada)).code, 'requested');
  assert.equal((await f.request('/api/social/friends/answer', { from: ada.id, accept: true, cityId: 'lagos' }, bola)).code, 'accepted');
  const a = await f.socket(ada);
  await f.socket(bola);
  const pinged = await f.request('/api/social/ping', { to: bola.id, clientId: f.id() }, ada);
  assert.equal(pinged.code, 'pinged');
  // The object is evicted while the sockets hibernate: the ping and the signing key are in storage, and the sockets are handed back.
  await f.hibernate();
  const mine = await f.request('/api/social/ping/open', { token: String(pinged.link).slice(3) }, bola);
  assert.deepEqual([mine.code, mine.notice?.from.id], ['yours', ada.id]);
  assert.deepEqual((await f.request('/api/social/ping', null, bola)).incoming?.map((item) => item.from.id), [ada.id]);
  assert.equal((await f.request('/api/social/ping/join', { from: ada.id, clientId: f.id() }, bola)).ok, true);
  const came = await a.until(() => a.frames.find((item): item is PingJoinedFrame => item.type === 'ping-joined'), 'the pinger is told after the sleep');
  assert.equal(came.by.id, bola.id);
});
