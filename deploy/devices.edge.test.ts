// One character open on several devices (docs/DEVICES.md), on the Worker host: the same rules as server/devices.test.ts
// through the Durable Object. Three sockets of one session stand for three devices of one character: an account's
// browsers reach their character through bindings and then share its sockets exactly as these do (the account routes on
// this host are tested in cloudflare.test.ts). Also here: the hint still reaches every socket after the object has slept
// and lost its memory, because a socket's attachment carries who it is; and, as the object runs when deployed (in memory
// while anyone is connected, quiet changes held there), what a device finds when the object started again on its storage.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { layoutBindings } from '../server/testing/sqliteStorage.ts';

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
interface Frame { type: string; code?: string; callId?: string; state?: string; role?: string; kind?: string; calls?: string; elsewhere?: boolean; rev?: number; by?: string[]; updates?: boolean; conv?: { id: string; unread: number }; peer?: { id: string; name: string }; from?: { id: string; name: string }; [field: string]: unknown }
interface Peer { send(message: object): void; next(timeout?: number): Promise<Frame>; until(type: string): Promise<Frame>; drain(): Promise<Frame[]>; close(): void }
interface Life { state: { cash: number; location: string; activeAction: unknown }; rev: number; ok?: boolean; code?: string; duplicate?: boolean }
const pause = (ms: number): Promise<void> => new Promise((done) => { setTimeout(done, ms); });

/** `sleeps`: the object may sleep while sockets are connected (SLEEP_BETWEEN_BEATS), for a test that puts it to sleep. */
async function fixture(t: TestContext, sleeps = false) {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-devices-'));
  const bundle = join(folder, 'worker.mjs');
  await build({ entryPoints: [new URL('./cloudflare-worker.ts', import.meta.url).pathname], outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
  const options = { name: 'joinallworld-devices', script: await readFile(bundle, 'utf8'), modules: true, compatibilityDate: '2026-10-01', durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, durableObjectsPersist: join(folder, 'storage'), bindings: { ...layoutBindings(), BUILD_ID: 'local-devices', ...(sleeps ? { SLEEP_BETWEEN_BEATS: '1' } : {}) }, assets: { directory: new URL('../dist', import.meta.url).pathname, binding: 'ASSETS', run_worker_first: true, routerConfig: { has_user_worker: true }, assetConfig: { not_found_handling: 'single-page-application' } } };
  const start = () => new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: join(folder, 'storage'), unsafeInspectDurableObjects: true, handleStructuredLogs: () => {} });
  let mf = start();
  const sockets: StubSocket[] = [], handed: MiniflareResponse[] = [];
  const within = <T>(step: string, work: Promise<T>, ms = 30000) => { let timer: NodeJS.Timeout; return Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(`${step} did not finish within ${ms} ms`)), ms); })]).finally(() => clearTimeout(timer)); };
  const send = async (url: string, init?: RequestInit & { headers?: Record<string, string> }) => { const response = await mf.dispatchFetch(url, init); handed.push(response); return response; };
  async function stop() {
    for (const socket of sockets.splice(0)) try { socket.close(); } catch { /* closed */ }
    for (const response of handed.splice(0)) if (!response.bodyUsed && response.body && !response.body.locked) await response.body.cancel().catch(() => {});
    await within('Miniflare dispose', mf.dispose());
  }
  t.after(async () => { await stop(); await rm(folder, { recursive: true, force: true }); });
  /** The runtime stops and starts again on the same storage: everything the object held in memory is gone, and every socket is closed. */
  const restart = async () => { await stop(); mf = start(); await mf.ready; };
  await mf.ready;
  const origin = 'https://joinallworld.test';
  const request = (path: string, body?: object | null, cookie?: string) => send(origin + path, { method: body ? 'POST' : 'GET', headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  async function device(name: string): Promise<Device> {
    const response = await request('/api/session', { name });
    assert.equal(response.status, 200);
    const body = await response.json() as { session: { id: string; name: string } };
    const who = { ...body.session, cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '' };
    assert.equal((await request('/api/social/me', null, who.cookie)).status, 200);
    return who;
  }
  async function socket(who: Device): Promise<Peer> {
    const response = await send(origin + '/socket', { headers: { origin, cookie: who.cookie, upgrade: 'websocket' } });
    assert.equal(response.status, 101);
    const ws = response.webSocket as StubSocket;
    const queue: Frame[] = [], waiting: ((frame: Frame) => void)[] = [];
    ws.addEventListener('message', (event) => {
      const frame = JSON.parse(event.data) as Frame;
      if (frame.type === 'heartbeat') { ws.send(JSON.stringify({ type: 'heartbeat-ack' })); return; }
      const wait = waiting.shift(); if (wait) wait(frame); else queue.push(frame);
    });
    ws.accept(); sockets.push(ws);
    const next = (timeout = 4000) => queue.length ? Promise.resolve(queue.shift() as Frame) : new Promise<Frame>((resolveFrame, reject) => { const timer = setTimeout(() => reject(Error('Socket message timeout')), timeout); waiting.push((frame) => { clearTimeout(timer); resolveFrame(frame); }); });
    const peer: Peer = {
      send: (message) => ws.send(JSON.stringify(message)), next,
      until: async (type) => { for (let i = 0; i < 100; i++) { const frame = await next(); if (frame.type === type) return frame; } throw Error(`No ${type} frame`); },
      // Everything sent before the answer to a settings read (frames from one socket arrive in order).
      drain: async () => { peer.send({ type: 'call-settings' }); const seen: Frame[] = []; for (let i = 0; i < 100; i++) { const frame = await next(); if (frame.type === 'call-settings') return seen; seen.push(frame); } throw Error('No settings reply'); },
      close: () => ws.close(),
    };
    return peer;
  }
  const life = async (who: Device): Promise<Life> => (await request('/api/life?city=lagos', null, who.cookie)).json() as Promise<Life>;
  const act = async (who: Device, fields: object, actionId = `${Date.now()}:${randomUUID()}`): Promise<Life> => (await request('/api/action', { actionId, cityId: 'lagos', ...fields }, who.cookie)).json() as Promise<Life>;
  /** Ada on three sockets (three devices of one character) and Bola, a friend, on one; everything announced so far has gone out. */
  async function household() {
    const ada = await device('Ada'), bola = await device('Bola');
    await life(ada);
    assert.equal(((await (await request('/api/social/friends/request', { to: bola.id, cityId: 'lagos' }, ada.cookie)).json()) as { code: string }).code, 'requested');
    assert.equal(((await (await request('/api/social/friends/answer', { from: ada.id, accept: true, cityId: 'lagos' }, bola.cookie)).json()) as { code: string }).code, 'accepted');
    const a = await socket(ada), b = await socket(ada), c = await socket(ada), friend = await socket(bola);
    await pause(150);
    for (const peer of [a, b, c, friend]) await peer.drain();
    return { ada, bola, a, b, c, friend };
  }
  return { request, device, socket, life, act, household, restart, hibernate: () => mf.unsafeEvictDurableObject('joinallworld-devices', 'JoinAllworldState', { name: 'joinallworld-v1', webSockets: 'hibernate' }) };
}
let counter = 0;
const invite = (peer: Peer, to: string): void => peer.send({ type: 'call-invite', to, clientId: `edge-d${++counter}` });
const of = (frames: Frame[], prefix: string): Frame[] => frames.filter((frame) => frame.type.startsWith(prefix));
const SDP = { sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n' };

test('on the Worker: an accepted command is announced to every socket of the character with its revision and cause; revisions only go up; two commands at once resolve as one', async (t) => {
  const f = await fixture(t);
  const { ada, a, b, c, friend } = await f.household();
  const before = await f.life(ada);
  assert.equal(typeof before.rev, 'number');
  const actionId = `${Date.now()}:${randomUUID()}`;
  const done = await f.act(ada, { type: 'travel', id: 'library', mode: 'cab' }, actionId);
  assert.equal(done.ok, true);
  assert.ok(done.rev > before.rev);
  for (const peer of [a, b, c]) {
    const frame = await peer.until('life-changed');
    assert.ok((frame.rev ?? 0) >= done.rev);
    assert.deepEqual(frame.by, [actionId]);
  }
  const read = await f.life(ada);
  assert.deepEqual([read.state.cash, read.rev > done.rev], [done.state.cash, true]);
  await pause(150);
  assert.deepEqual(of(await friend.drain(), 'life-'), [], 'another player hears nothing of it');
  // A quiet read announces nothing.
  for (const peer of [a, b, c]) await peer.drain();
  await f.life(ada); await f.life(ada);
  await pause(150);
  assert.deepEqual(of(await a.drain(), 'life-'), []);
  // Two devices at the same moment: the trip is running, so one cancel is accepted and the other gets its ordinary refusal;
  // and one action id sent twice is one action.
  const [one, two] = await Promise.all([f.act(ada, { type: 'cancel' }), f.act(ada, { type: 'cancel' })]);
  assert.deepEqual([one.ok, two.ok].sort(), [false, true]);
  assert.equal(one.state.cash, two.state.cash);
  const again = `${Date.now()}:${randomUUID()}`;
  const [first, second] = await Promise.all([f.act(ada, { type: 'travel', id: 'library', mode: 'cab' }, again), f.act(ada, { type: 'travel', id: 'library', mode: 'cab' }, again)]);
  assert.deepEqual([first.ok, second.ok, [first, second].filter((answer) => answer.duplicate === true).length, first.state.cash === second.state.cash], [true, true, 1, true]);
});

test('on the Worker: after the object slept and lost its memory, every socket of the character is still told, and what one device read is read on the others', async (t) => {
  const f = await fixture(t, true);
  const { ada, bola, a, b, c } = await f.household();
  await f.hibernate();
  const done = await f.act(ada, { type: 'spot', id: 'trees' });
  assert.equal(done.ok, true);
  for (const peer of [a, b, c]) assert.ok(((await peer.until('life-changed')).rev ?? 0) >= done.rev);
  const sent = await (await f.request('/api/social/messages', { to: ada.id, body: 'Hello Ada', clientId: `${Date.now()}:${randomUUID()}` }, bola.cookie)).json() as { conv: { id: string } };
  for (const peer of [a, b, c]) assert.equal((await peer.until('dm')).conv?.id, sent.conv.id);
  assert.equal((await f.request(`/api/social/conversations/${sent.conv.id}/read`, {}, ada.cookie)).status, 200);
  for (const peer of [a, b, c]) { const frame = await peer.until('social-read'); assert.deepEqual([frame.conv?.id, frame.conv?.unread], [sent.conv.id, 0]); }
  a.send({ type: 'call-settings', calls: 'friends' });
  for (const peer of [a, b, c]) assert.equal((await peer.until('call-settings')).calls, 'friends');
  // Presence: two of three sockets close and the friend is told nothing; the player is still online.
  const friend = await f.socket(bola);
  await friend.drain();
  a.close(); b.close();
  await pause(200);
  assert.deepEqual(of(await friend.drain(), 'people-presence'), []);
  const overview = await (await f.request('/api/social/me', null, bola.cookie)).json() as { friends: { id: string; status: string }[] };
  assert.notEqual(overview.friends.find((item) => item.id === ada.id)?.status, 'offline');
});

test('on the Worker: a call rings every device, one answers and carries it, the others can neither signal nor end it, and closing them changes nothing', async (t) => {
  const f = await fixture(t);
  const { ada, bola, a, b, c, friend } = await f.household();
  invite(friend, ada.id);
  const rung = await Promise.all([a, b, c].map((peer) => peer.until('call-incoming')));
  assert.equal(new Set(rung.map((frame) => frame.callId)).size, 1);
  const callId = rung[0]?.callId as string;
  assert.equal((await friend.until('call-state')).state, 'ringing');
  b.send({ type: 'call-accept', callId });
  const mine = await b.until('call-state');
  assert.deepEqual([mine.state, mine.elsewhere], ['accepted', undefined]);
  for (const peer of [a, c]) { const other = await peer.until('call-state'); assert.deepEqual([other.state, other.elsewhere, other.peer?.id], ['accepted', true, bola.id]); }
  assert.equal((await friend.until('call-state')).state, 'accepted');
  friend.send({ type: 'call-signal', callId, kind: 'offer', data: SDP });
  assert.equal((await b.until('call-signal')).kind, 'offer');
  assert.deepEqual([of(await a.drain(), 'call-signal').length, of(await c.drain(), 'call-signal').length], [0, 0], 'signalling reaches the answering socket only');
  a.send({ type: 'call-signal', callId, kind: 'answer', data: SDP });
  assert.equal((await a.until('error')).code, 'call_elsewhere');
  a.send({ type: 'call-hangup', callId });
  assert.equal((await a.until('error')).code, 'call_elsewhere');
  // A device that did not answer closes; another one opens late and is told the call is elsewhere.
  a.close();
  const late = await f.socket(ada);
  const passive = await late.until('call-state');
  assert.deepEqual([passive.state, passive.elsewhere, passive.callId, passive.role], ['accepted', true, callId, 'callee']);
  assert.deepEqual(of(await friend.drain(), 'call-state'), [], 'the caller heard nothing');
  // The device that carries the call drops while two others stay connected: over for everyone, and nothing rings again.
  b.close();
  assert.equal((await friend.until('call-state')).state, 'ended');
  for (const peer of [c, late]) assert.equal((await peer.until('call-state')).state, 'ended');
  await pause(150);
  assert.deepEqual(of(await c.drain(), 'call-incoming'), []);
});

test('on the Worker: a decline on any device stops them all; a call placed on one device shows on the others, which cannot cancel it; a device closed while ringing declines nothing', async (t) => {
  const f = await fixture(t);
  const { ada, bola, a, b, c, friend } = await f.household();
  invite(friend, ada.id);
  const first = (await a.until('call-incoming')).callId as string;
  await b.until('call-incoming'); await c.until('call-incoming'); await friend.until('call-state');
  c.send({ type: 'call-decline', callId: first });
  for (const peer of [a, b, c, friend]) assert.equal((await peer.until('call-state')).state, 'declined');
  // Outgoing, from the first device.
  invite(a, bola.id);
  const incoming = await friend.until('call-incoming');
  assert.deepEqual([(await a.until('call-state')).state], ['ringing']);
  for (const peer of [b, c]) { const passive = await peer.until('call-state'); assert.deepEqual([passive.state, passive.elsewhere, passive.role], ['ringing', true, 'caller']); }
  b.send({ type: 'call-cancel', callId: incoming.callId });
  assert.equal((await b.until('error')).code, 'call_elsewhere');
  a.send({ type: 'call-cancel', callId: incoming.callId });
  for (const peer of [a, b, c, friend]) assert.equal((await peer.until('call-state')).state, 'cancelled');
  // Ringing again; one ringing device closes: the others still ring, and one of them answers.
  await pause(100);
  invite(friend, ada.id);
  const second = (await a.until('call-incoming')).callId as string;
  await b.until('call-incoming'); await c.until('call-incoming'); await friend.until('call-state');
  a.close();
  await pause(150);
  assert.deepEqual(of(await friend.drain(), 'call-state'), [], 'still ringing');
  c.send({ type: 'call-accept', callId: second });
  assert.equal((await c.until('call-state')).state, 'accepted');
  assert.equal((await b.until('call-state')).elsewhere, true);
});

test('on the Worker, as deployed: the object starts again on its storage with quiet changes unwritten — a device that reconnects is given a higher revision than any it held, the life and the friends as they were acknowledged, a fresh live snapshot, and the hint at the next change', { timeout: 120000 }, async (t) => {
  const f = await fixture(t);
  const { ada, bola, a, b } = await f.household();
  // Acknowledged before the restart: Ada bought a look around, Bola set off for the library.
  const spent = await f.act(ada, { type: 'spot', id: 'trees' });
  assert.equal(spent.ok, true);
  assert.equal((await f.act(bola, { type: 'travel', id: 'library', mode: 'trek' })).ok, true);
  await a.until('life-changed'); await b.until('life-changed');
  a.send({ type: 'live-watch', cityId: 'lagos' });
  const watched = await a.until('live-snapshot') as Frame & { friends: { id: string; status: string; trip?: { to: string } }[] };
  assert.deepEqual(watched.friends.map((spot) => [spot.id, spot.status, spot.trip?.to]), [[bola.id, 'online', 'library']]);
  // Quiet polls from two devices: each is a later answer, and none of them is written.
  let held = spent.rev;
  for (let i = 0; i < 6; i++) { const read = await f.life(ada); assert.ok(read.rev > held); held = read.rev; }
  await f.restart();
  // Both come back. Nothing acknowledged is lost, and no answer is older than one a device already took.
  const again = await f.life(ada);
  assert.ok(again.rev > held, `the revision after the restart (${again.rev}) is above the last one given before it (${held})`);
  assert.equal(again.state.cash, spent.state.cash);
  assert.ok((await f.life(bola)).state.activeAction, 'the trip that was acknowledged is still running');
  const overview = await (await f.request('/api/social/me', null, ada.cookie)).json() as { friends: { id: string; status: string }[] };
  assert.deepEqual(overview.friends.map((item) => [item.id, item.status]), [[bola.id, 'offline']], 'the friendship is stored; nobody is connected yet');
  const a2 = await f.socket(ada), b2 = await f.socket(ada);
  a2.send({ type: 'live-watch', cityId: 'lagos' });
  const fresh = await a2.until('live-snapshot') as Frame & { friends: { id: string; status: string }[] };
  assert.deepEqual(fresh.friends.map((spot) => [spot.id, spot.status]), [[bola.id, 'offline']]);
  // The friend reconnects: where the stored life has him, not where anything in memory had him.
  await f.socket(bola);
  for (let i = 0; ; i++) {
    const move = await a2.until('live-move') as Frame & { spots?: { id: string; status: string; trip?: { to: string } }[] };
    const spot = move.spots?.find((item) => item.id === bola.id);
    if (spot?.status === 'online') { assert.equal(spot.trip?.to, 'library'); break; }
    assert.ok(i < 20, 'Bola never came online');
  }
  // And the next change is announced to the other device, with a revision above everything before.
  await b2.drain();
  const done = await f.act(ada, { type: 'spot', id: 'drinks' });
  assert.equal(done.ok, true);
  assert.ok(done.rev > again.rev);
  assert.ok(((await b2.until('life-changed')).rev ?? 0) >= done.rev);
});
