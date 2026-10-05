// One-to-one calls (server/social/calls.ts) on the Worker host: the same rules through the Durable Object, the ring ending
// on time on the real clock, and a call ending gracefully when the object loses its memory.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

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
/** A frame as the tests read it: only the fields they assert on. */
interface Frame { type: string; code?: string; callId?: string; state?: string; clientId?: string; kind?: string; calls?: string; elsewhere?: boolean; from?: { id: string; name: string }; expiresAt?: number; data?: unknown; [field: string]: unknown }
interface Peer { send(message: object): void; next(timeout?: number): Promise<Frame>; until(type: string): Promise<Frame>; drain(): Promise<Frame[]>; close(): void }

async function fixture(t: TestContext) {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-calls-'));
  const bundle = join(folder, 'worker.mjs');
  await build({ entryPoints: [new URL('./cloudflare-worker.ts', import.meta.url).pathname], outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
  const options = { name: 'joinallworld-calls', script: await readFile(bundle, 'utf8'), modules: true, compatibilityDate: '2026-10-01', durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, durableObjectsPersist: join(folder, 'storage'), bindings: { BUILD_ID: 'local-calls' }, assets: { directory: new URL('../dist', import.meta.url).pathname, binding: 'ASSETS', run_worker_first: true, routerConfig: { has_user_worker: true }, assetConfig: { not_found_handling: 'single-page-application' } } };
  const mf = new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: join(folder, 'storage'), unsafeInspectDurableObjects: true, handleStructuredLogs: () => {} });
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
  async function device(name: string): Promise<Device> {
    const response = await request('/api/session', { name });
    assert.equal(response.status, 200);
    const body = await response.json() as { session: { id: string; name: string } };
    const who = { ...body.session, cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '' };
    assert.equal((await request('/api/social/me', null, who.cookie)).status, 200);
    return who;
  }
  async function befriend(a: Device, b: Device) {
    assert.equal(((await (await request('/api/social/friends/request', { to: b.id, cityId: 'lagos' }, a.cookie)).json()) as { code: string }).code, 'requested');
    assert.equal(((await (await request('/api/social/friends/answer', { from: a.id, accept: true, cityId: 'lagos' }, b.cookie)).json()) as { code: string }).code, 'accepted');
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
  return { request, device, befriend, socket, hibernate: () => mf.unsafeEvictDurableObject('joinallworld-calls', 'JoinAllworldState', { name: 'joinallworld-v1', webSockets: 'hibernate' }) };
}
let counter = 0;
const invite = (peer: Peer, to: string): void => peer.send({ type: 'call-invite', to, clientId: `edge${++counter}` });
const callFrames = (frames: Frame[]): Frame[] => frames.filter((frame) => frame.type.startsWith('call-'));
const SDP = { sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n' };

test('on the Worker: friends ring, the callee sees the name, strangers and blocked players read unreachable, nothing is relayed before accept', async (t) => {
  const f = await fixture(t);
  const ada = await f.device('Ada'), bola = await f.device('Bola'), cleo = await f.device('Cleo');
  await f.befriend(ada, bola);
  const a = await f.socket(ada), b = await f.socket(bola), c = await f.socket(cleo);
  // The default is friends only.
  invite(c, bola.id);
  assert.equal((await c.until('call-state')).state, 'unreachable');
  assert.deepEqual(callFrames(await b.drain()), []);
  invite(a, bola.id);
  const incoming = await b.until('call-incoming');
  assert.deepEqual(incoming.from, { id: ada.id, name: 'Ada' });
  assert.equal((await a.until('call-state')).state, 'ringing');
  const callId = incoming.callId as string;
  // Before accept: no signalling either way, and a third party learns nothing.
  a.send({ type: 'call-signal', callId, kind: 'offer', data: SDP });
  assert.equal((await a.until('error')).code, 'invalid_call');
  c.send({ type: 'call-signal', callId, kind: 'offer', data: SDP });
  assert.equal((await c.until('call-state')).state, 'ended');
  assert.deepEqual(callFrames(await b.drain()), []);
  b.send({ type: 'call-accept', callId });
  assert.equal((await b.until('call-state')).state, 'accepted');
  assert.equal((await a.until('call-state')).state, 'accepted');
  // After accept: relay between the two only, and a third party still cannot inject.
  a.send({ type: 'call-signal', callId, kind: 'offer', data: SDP });
  assert.deepEqual([(await b.until('call-signal')).kind, callFrames(await c.drain()).length], ['offer', 0]);
  b.send({ type: 'call-signal', callId, kind: 'answer', data: SDP });
  assert.equal((await a.until('call-signal')).kind, 'answer');
  c.send({ type: 'call-signal', callId, kind: 'ice', data: { candidate: 'x' } });
  assert.equal((await c.until('call-state')).state, 'ended');
  assert.deepEqual(callFrames(await a.drain()), []);
  assert.deepEqual(callFrames(await b.drain()), []);
  // One call at a time: a third player cannot ring a player who is in a call, and learns nothing more.
  await f.befriend(cleo, bola);
  invite(c, bola.id);
  assert.equal((await c.until('call-state')).state, 'unreachable');
  // Hang up ends it for both.
  a.send({ type: 'call-hangup', callId });
  assert.equal((await a.until('call-state')).state, 'ended');
  assert.equal((await b.until('call-state')).state, 'ended');
});

test('on the Worker: the setting, a block in either direction, a decline, a busy callee and a closed socket', async (t) => {
  const f = await fixture(t);
  const ada = await f.device('Ada'), bola = await f.device('Bola'), cleo = await f.device('Cleo');
  await f.befriend(ada, bola);
  const a = await f.socket(ada), b = await f.socket(bola), c = await f.socket(cleo);
  b.send({ type: 'call-settings' });
  assert.equal((await b.until('call-settings')).calls, 'friends');
  b.send({ type: 'call-settings', calls: 'everyone' });
  assert.equal((await b.until('call-settings')).calls, 'everyone');
  invite(c, bola.id);
  const stranger = await b.until('call-incoming');
  assert.equal((await c.until('call-state')).state, 'ringing');
  c.send({ type: 'call-cancel', callId: stranger.callId });
  assert.equal((await b.until('call-state')).state, 'cancelled');
  assert.equal((await c.until('call-state')).state, 'cancelled');
  b.send({ type: 'call-settings', calls: 'nobody' });
  assert.equal((await b.until('call-settings')).calls, 'nobody');
  invite(a, bola.id);
  assert.equal((await a.until('call-state')).state, 'unreachable');
  b.send({ type: 'call-settings', calls: 'everyone' });
  await b.until('call-settings');
  // A block by the callee: unreachable, with nothing sent to them.
  assert.equal((await f.request('/api/social/block', { id: cleo.id, cityId: 'lagos' }, bola.cookie)).status, 200);
  invite(c, bola.id);
  assert.equal((await c.until('call-state')).state, 'unreachable');
  // A block by the caller.
  assert.equal((await f.request('/api/social/block', { id: bola.id, cityId: 'lagos' }, cleo.cookie)).status, 200);
  invite(c, bola.id);
  assert.equal((await c.until('call-state')).state, 'unreachable');
  assert.deepEqual(callFrames(await b.drain()), []);
  // A decline.
  invite(a, bola.id);
  const first = await b.until('call-incoming'); await a.until('call-state');
  b.send({ type: 'call-decline', callId: first.callId });
  assert.equal((await a.until('call-state')).state, 'declined');
  // A closed socket ends an accepted call for the other side.
  invite(a, bola.id);
  const second = await b.until('call-incoming'); await a.until('call-state');
  b.send({ type: 'call-accept', callId: second.callId }); await a.until('call-state');
  b.close();
  const ended = await a.until('call-state');
  assert.equal(ended.state, 'ended');
});

test('on the Worker: a ring that is not answered ends close to 30 seconds, for both sides', { timeout: 90000 }, async (t) => {
  const f = await fixture(t);
  const ada = await f.device('Ada'), bola = await f.device('Bola');
  await f.befriend(ada, bola);
  const a = await f.socket(ada), b = await f.socket(bola);
  invite(a, bola.id);
  const incoming = await b.until('call-incoming');
  await a.until('call-state');
  const started = Date.now();
  const ended = await Promise.all([a.next(40000), b.next(40000)]);
  const elapsed = Date.now() - started;
  assert.deepEqual(ended.map((frame) => frame.state), ['timeout', 'timeout']);
  assert.ok(elapsed >= 25000 && elapsed <= 36000, `ended after ${elapsed} ms`);
  b.send({ type: 'call-accept', callId: incoming.callId });
  assert.equal((await b.until('call-state')).state, 'ended', 'too late to answer');
});

test('on the Worker: when the object is evicted mid-call, the other side is told it ended, and new calls work afterwards', async (t) => {
  const f = await fixture(t);
  const ada = await f.device('Ada'), bola = await f.device('Bola');
  await f.befriend(ada, bola);
  const a = await f.socket(ada), b = await f.socket(bola);
  invite(a, bola.id);
  const incoming = await b.until('call-incoming'); await a.until('call-state');
  b.send({ type: 'call-accept', callId: incoming.callId });
  await b.until('call-state'); await a.until('call-state');
  // A call keeps the object awake (a timer is pending), so an eviction drops its sockets: the call table is gone with it.
  // Each side must hear that the call is over, or reconnect to a clean table.
  await f.hibernate();
  const told = await b.next(5000);
  assert.deepEqual([told.type, told.state, told.callId], ['call-state', 'ended', incoming.callId]);
  const a2 = await f.socket(ada), b2 = await f.socket(bola);
  invite(a2, bola.id);
  assert.equal((await b2.until('call-incoming')).from?.name, 'Ada');
  assert.equal((await a2.until('call-state')).state, 'ringing');
});
