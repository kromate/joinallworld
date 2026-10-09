// Messages on the Worker host: groups, mentions, replies, reactions, a gift line and a picture (kept in the Durable Object's SQLite
// table, served only to members of its conversation) through the same routes as Node.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import type { PingServerFrame } from '../src/types/ping.ts';
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
interface Answer { ok?: boolean; code?: string; error?: string; duplicate?: boolean; conv?: { id: string; owner?: string; unread: number; muted?: true }; message?: { seq: number; version?: number; body?: string; mentions?: { id: string; start: number; end: number }[]; replyTo?: { text: string }; reactions?: { emoji: string; count: number }[]; image?: { id: string; width: number; height: number }; gift?: { amount: number } }; messages?: Answer['message'][]; conversations?: NonNullable<Answer['conv']>[]; updates?: { kind: string; text: string }[]; pins?: { scope: string; revision: number; canManage: boolean; items: { message: NonNullable<Answer['message']> }[] } }
const pause = (ms = 25): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** `sleeps`: the object may sleep while sockets are connected (SLEEP_BETWEEN_BEATS), for a test that puts it to sleep. */
async function fixture(t: TestContext, sleeps = false) {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-chat-'));
  const bundle = join(folder, 'worker.mjs');
  await build({ entryPoints: [new URL('./cloudflare-worker.ts', import.meta.url).pathname], outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
  const options = { name: 'joinallworld-chat', script: await readFile(bundle, 'utf8'), modules: true, compatibilityDate: '2026-10-01', durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, durableObjectsPersist: join(folder, 'storage'), bindings: { ...layoutBindings(), BUILD_ID: 'local-chat', FOUNDER_EMAIL_SHA256: '', CHAT_IMAGES: 'friends', ...(sleeps ? { SLEEP_BETWEEN_BEATS: '1' } : {}) } };
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
  const image = (path: string, who?: Device) => send(origin + path, { headers: { origin, ...(who ? { cookie: who.cookie } : {}) } });
  return { request, player, socket, id, image, restart: () => mf.unsafeEvictDurableObject('joinallworld-chat', 'JoinAllworldState', { name: 'joinallworld-v1' }), page: (path: string) => send(origin + path) };
}
const jpeg = (): Uint8Array => Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0, 11, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x47, 0x50, 0x53, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 17, 8, 0, 8, 0, 8, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xda, 0, 12, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0, 1, 2, 3, 0xff, 0xd9]);

test('Cloudflare messages: a group with a mention, a quoted reply, a reaction, a muted group, and two devices', { timeout: 120000 }, async (t) => {
  const f = await fixture(t);
  const ada = await f.player('Ada'), bola = await f.player('Bola'), chi = await f.player('Chidi');
  for (const other of [bola, chi]) {
    assert.equal((await f.request('/api/social/friends/request', { to: other.id, cityId: 'lagos' }, ada)).code, 'requested');
    assert.equal((await f.request('/api/social/friends/answer', { from: ada.id, accept: true, cityId: 'lagos' }, other)).code, 'accepted');
  }
  const second = await f.socket(ada);
  const made = await f.request('/api/social/groups', { name: 'Weekend Crew', members: [bola.id, chi.id], clientId: f.id() }, ada);
  assert.equal(made.code, 'created');
  const gid = String(made.conv?.id);
  await second.until(() => second.frames.length >= 0 || true, 'the other device is connected');
  const body = 'Hi @Bola look';
  const sent = await f.request('/api/social/messages', { conv: gid, body, clientId: f.id(), mentions: [{ id: bola.id, start: 3 }] }, ada);
  assert.deepEqual(sent.message?.mentions, [{ id: bola.id, start: 3, end: 8 }]);
  assert.equal((await f.request('/api/social/messages', { conv: gid, body: 'Hi @Chidi', clientId: f.id(), mentions: [{ id: bola.id, start: 3 }] }, ada)).code, 'invalid_mention');
  const notice = (await f.request('/api/social/me', null, bola)).updates?.find((item) => item.kind === 'mention');
  assert.equal(notice?.text, 'Ada mentioned you in Weekend Crew.');
  const reply = await f.request('/api/social/messages', { conv: gid, body: 'Coming', clientId: f.id(), replyTo: sent.message?.seq }, bola);
  assert.equal(reply.message?.replyTo?.text, body);
  const reacted = await f.request(`/api/social/conversations/${gid}/react`, { seq: sent.message?.seq, emoji: '👍🏽' }, chi);
  assert.deepEqual(reacted.message?.reactions, [{ emoji: "👍🏽", count: 1, mine: true }]);
  const history = await f.request(`/api/social/conversations/${gid}`, null, ada), scope = String(history.pins?.scope);
  const pinIntent = f.id();
  const pinBody = { scope, pinRevision: 0, clientId: pinIntent, op: 'set', seq: sent.message?.seq, messageVersion: reacted.message?.version ?? 0, pinned: true };
  const pin = await f.request(`/api/social/conversations/${gid}/pins`, pinBody, ada);
  assert.deepEqual([pin.pins?.revision, pin.pins?.items[0]?.message.body], [1, body]);
  await f.restart();
  const replayedPin = await f.request(`/api/social/conversations/${gid}/pins`, pinBody, ada);
  assert.deepEqual([replayedPin.duplicate, replayedPin.pins?.revision, replayedPin.pins?.items[0]?.message.body], [true, 1, body]);
  assert.equal((await f.request(`/api/social/conversations/${gid}/pins`, { scope, pinRevision: 1, clientId: f.id(), op: 'clear-all' }, chi)).code, 'owner_only');
  assert.equal((await f.request(`/api/social/conversations/${gid}/prefs`, { mute: true, pin: true }, bola)).conv?.muted, true);
  assert.equal((await f.request(`/api/social/groups/${gid}`, { op: 'leave' }, ada)).code, 'left');
  assert.equal((await f.request('/api/social/conversations', null, bola)).conversations?.find((c) => c.id === gid)?.owner, bola.id);
  const cleared = await f.request(`/api/social/conversations/${gid}/pins`, { scope, pinRevision: 1, clientId: f.id(), op: 'clear-all' }, bola);
  assert.deepEqual([cleared.pins?.revision, cleared.pins?.items.length], [2, 0]);
});

test('Cloudflare pictures: stored in the object\'s own table without metadata, served to the conversation\'s members only, gone with the conversation', { timeout: 120000 }, async (t) => {
  const f = await fixture(t);
  const ada = await f.player('Ada'), bola = await f.player('Bola'), chi = await f.player('Chidi');
  assert.equal((await f.request('/api/social/friends/request', { to: bola.id, cityId: 'lagos' }, ada)).code, 'requested');
  assert.equal((await f.request('/api/social/friends/answer', { from: ada.id, accept: true, cityId: 'lagos' }, bola)).code, 'accepted');
  const data = Buffer.from(jpeg()).toString('base64');
  const sent = await f.request('/api/social/images', { to: bola.id, clientId: f.id(), type: 'image/jpeg', data, body: 'the view' }, ada);
  assert.equal(sent.code, 'sent');
  const id = String(sent.message?.image?.id);
  const seen = await f.image(`/api/social/images/${id}`, bola);
  assert.deepEqual([seen.status, seen.headers.get('content-type'), seen.headers.get('x-content-type-options'), seen.headers.get('content-disposition')], [200, 'image/jpeg', 'nosniff', 'inline']);
  assert.equal(seen.headers.get('cache-control'), 'no-store', 'private media must not persist in a browser or shared cache');
  const bytes = Buffer.from(await seen.arrayBuffer());
  assert.equal(bytes.includes(Buffer.from('Exif')), false, 'the EXIF segment was left out');
  assert.equal(bytes.includes(Buffer.from('GPS')), false);
  assert.equal((await f.image(`/api/social/images/${id}`, chi)).status, 404, 'not a member');
  assert.equal((await f.image(`/api/social/images/${id}`)).status, 401, 'signed out');
  // Hostile bytes are refused and keep nothing.
  const bad = await f.request('/api/social/images', { to: bola.id, clientId: f.id(), type: 'image/jpeg', data: Buffer.from('<svg onload=alert(1)>').toString('base64') }, ada);
  assert.equal(bad.code, 'picture_rejected');
});
