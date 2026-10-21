// Places (docs/PLACES.md) on the Worker host: the same `join` with `place` and the same routes through the Durable Object. Two
// players stand in the Square and hear each other; a group's room is furnished, opened with its link and closed again; and, in
// a test of its own, sockets standing in a place are still standing there — and the furniture is still in the room — after the
// object slept. The rules themselves are played on Node (server/places.test.ts) against the same shared code.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { SHARING_TERMS_VERSION } from '../src/types/sharing.ts'

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
interface Frame { type: string; code?: string; error?: string; body?: string; members?: { id: string }[] }
interface RoomAnswer { id: string; name: string; role: string; rev: number; items: { id: string; itemId: string }[]; link?: { on: boolean; path?: string }; here: { id: string; member: boolean }[] }
interface Answer { ok?: boolean; code?: string; error?: string; reason?: string; conv?: { id: string }; room?: RoomAnswer; rooms?: { id: string }[]; square?: { here: number; people: { id: string }[] } }
const pause = (ms = 25): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** `sleeps`: the object may sleep while sockets are connected (SLEEP_BETWEEN_BEATS), for a test that puts it to sleep. */
async function fixture(t: TestContext, sleeps = false) {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-places-'));
  const bundle = join(folder, 'worker.mjs');
  await build({ entryPoints: [new URL('./cloudflare-worker.ts', import.meta.url).pathname], outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
  const options = { name: 'joinallworld-places', script: await readFile(bundle, 'utf8'), modules: true, compatibilityDate: '2026-10-01', durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, durableObjectsPersist: join(folder, 'storage'), bindings: { BUILD_ID: 'local-visit', FOUNDER_EMAIL_SHA256: '', ...(sleeps ? { SLEEP_BETWEEN_BEATS: '1' } : {}) }, assets: { directory: new URL('../dist', import.meta.url).pathname, binding: 'ASSETS', run_worker_first: true, routerConfig: { has_user_worker: true }, assetConfig: { not_found_handling: 'single-page-application' } } };
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
    assert.equal((await request('/api/sharing/terms', { version: SHARING_TERMS_VERSION, over13: true }, who)).status, 200);
    await request('/api/life?city=lagos', null, who); await request('/api/social/me', null, who);
    return who;
  }
  const id = (): string => `${Date.now()}:${randomUUID()}`;
  /** A socket that answers the host's heartbeat and keeps every house frame it is sent. */
  async function socket(who: Device) {
    const response = await send(origin + '/socket', { headers: { origin, cookie: who.cookie, upgrade: 'websocket' } });
    assert.equal(response.status, 101);
    const ws = response.webSocket as StubSocket, frames: Frame[] = [];
    ws.addEventListener('message', (event) => {
      const frame = JSON.parse(event.data) as Frame;
      if (frame.type === 'heartbeat') ws.send(JSON.stringify({ type: 'heartbeat-ack' }));
      if (frame.type !== 'heartbeat') frames.push(frame);
    });
    ws.accept(); sockets.push(ws);
    async function until<T>(read: () => T | undefined | null | false, what: string): Promise<T> {
      for (let i = 0; i < 300; i++) { const value = read(); if (value) return value; await pause(); }
      throw new Error(`Never happened: ${what}`);
    }
    return { ws, frames, until };
  }
  return { request, player, socket, id, page: (path: string) => send(origin + path), hibernate: () => mf.unsafeEvictDurableObject('joinallworld-places', 'JoinAllworldState', { name: 'joinallworld-v1', webSockets: 'hibernate' }) };
}



const say = (peer: { ws: StubSocket }, message: object): void => peer.ws.send(JSON.stringify(message));

test('Cloudflare places: two players stand in the Square; a group room is furnished, opened by its link and closed again', { timeout: 120000 }, async (t) => {
  const f = await fixture(t);
  const ada = await f.player('Ada'), bola = await f.player('Bola'), cy = await f.player('Cyril');
  const a = await f.socket(ada), b = await f.socket(bola);
  say(a, { type: 'join', place: 'square' });
  await a.until(() => a.frames.find((frame) => frame.type === 'presence' && frame.members?.some((member) => member.id === ada.id)), 'Ada is in the Square');
  say(b, { type: 'join', place: 'square' });
  await a.until(() => a.frames.find((frame) => frame.type === 'presence' && frame.members?.length === 2), 'Ada sees Bola arrive');
  say(b, { type: 'chat', body: 'hello from far away', clientId: 'c-1' });
  await a.until(() => a.frames.find((frame) => frame.type === 'chat' && frame.body === 'hello from far away'), 'the line reaches the other side of the Square');
  const seen = await f.request('/api/places/square', null, ada);
  assert.deepEqual([seen.code, seen.square?.here, seen.square?.people.map((person) => person.id)], ['ok', 2, [bola.id]]);
  say(a, { type: 'join', place: 'room', roomId: 'g.999' });
  await a.until(() => a.frames.find((frame) => frame.type === 'error' && (frame.code ?? frame.error) === 'not_admitted'), 'a room that is not there admits nobody');

  // A group of one, its room, a change to the furniture, and the link.
  const made = await f.request('/api/social/groups', { name: 'Night shift', members: [], clientId: f.id() }, ada);
  assert.equal(made.code, 'created', made.reason);
  const id = String(made.conv?.id);
  const first = await f.request(`/api/places/room?id=${id}`, null, ada);
  assert.deepEqual([first.code, first.room?.role, first.room?.rev], ['ok', 'member', 0]);
  const added = await f.request('/api/places/room/edit', { id, edit: { op: 'add', id: 'pedgetest001', itemId: 'potted-plant' } }, ada);
  assert.deepEqual([added.code, added.room?.rev], ['changed', 1], added.reason);
  assert.equal((await f.request('/api/places/room/edit', { id, edit: { op: 'add', id: 'pedgetest001', itemId: 'potted-plant' } }, ada)).code, 'same', 'a repeated request adds the piece once');
  assert.equal((await f.request(`/api/places/room?id=${id}`, null, cy)).code, 'not_admitted');
  const on = await f.request('/api/places/room/link', { id, on: true }, ada);
  assert.equal(on.code, 'on', on.reason);
  const token = String(on.room?.link?.path).slice(3);
  assert.match(token, /^\d+-[A-Za-z0-9_-]{22}$/);
  assert.equal((await f.request('/api/places/room/peek', { token })).code, 'open');
  assert.equal((await f.request('/api/places/room/enter', { token })).status, 401, 'coming in needs a session');
  const inside = await f.request('/api/places/room/enter', { token }, cy);
  assert.deepEqual([inside.code, inside.room?.role, inside.room?.link], ['inside', 'visitor', undefined], inside.reason);
  const c = await f.socket(cy);
  say(c, { type: 'join', place: 'room', roomId: id });
  await c.until(() => c.frames.find((frame) => frame.type === 'presence' && frame.members?.some((member) => member.id === cy.id)), 'the visitor stands in the room');
  assert.equal((await f.request('/api/places/room/edit', { id, edit: { op: 'remove', id: 'pedgetest001' } }, cy)).code, 'not_a_member');
  assert.equal((await f.request('/api/places/room/link', { id, on: false }, ada)).code, 'off');
  await c.until(() => c.frames.find((frame) => frame.type === 'error' && (frame.code ?? frame.error) === 'place_ended'), 'switching the link off sends the visitor out');
  assert.equal((await f.request('/api/places/room/peek', { token })).code, 'ended');
});

test('Cloudflare places: people standing in the Square are still there, and a room keeps its furniture, after the object slept', { timeout: 120000 }, async (t) => {
  const f = await fixture(t, true);
  const ada = await f.player('Ada'), bola = await f.player('Bola');
  const a = await f.socket(ada), b = await f.socket(bola);
  say(a, { type: 'join', place: 'square' }); say(b, { type: 'join', place: 'square' });
  await a.until(() => a.frames.find((frame) => frame.type === 'presence' && frame.members?.length === 2), 'both are in the Square');
  const made = await f.request('/api/social/groups', { name: 'Night shift', members: [], clientId: f.id() }, ada);
  const id = String(made.conv?.id);
  assert.equal((await f.request('/api/places/room/edit', { id, edit: { op: 'add', id: 'pedgetest002', itemId: 'potted-plant' } }, ada)).code, 'changed');
  await f.hibernate();
  say(b, { type: 'chat', body: 'still here after the nap', clientId: 'c-2' });
  await a.until(() => a.frames.find((frame) => frame.type === 'chat' && frame.body === 'still here after the nap'), 'a line still crosses the Square');
  const after = await f.request(`/api/places/room?id=${id}`, null, ada);
  assert.deepEqual([after.code, after.room?.rev, after.room?.items.some((item) => item.id === 'pedgetest002')], ['ok', 1, true]);
  assert.equal((await f.request('/api/places/square', null, ada)).square?.here, 2);
});
