// Visiting a home (server/social/visit.ts) on the Worker host: the same routes through the Durable Object — the choice of who may
// come in, the house link signed with a key the object keeps for itself and read by a browser with no session, the door's refusals
// and the invitation's, and then, in a test of its own, a link that still works (and a key that did not change) after the object was
// evicted. A walk-in needs a host standing in their Home room, which a Worker test cannot reach in real time: the walk-in itself is
// played on Node (server/visit.test.ts) against the same shared code.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
interface Answer { ok?: boolean; code?: string; error?: string; reason?: string; door?: { who: string; out: boolean; chosen: boolean }; link?: { id: string; path: string; uses: number; max?: number }; links?: { id: string; path: string }[]; host?: { name: string }; invited?: { id: string }[]; skipped?: { reason: string }[]; invites?: { from: { id: string } }[]; friends?: { id: string; visit?: string }[] }
const pause = (ms = 25): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** `sleeps`: the object may sleep while sockets are connected (SLEEP_BETWEEN_BEATS), for a test that puts it to sleep. */
async function fixture(t: TestContext, sleeps = false) {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-visit-'));
  const bundle = join(folder, 'worker.mjs');
  await build({ entryPoints: [new URL('./cloudflare-worker.ts', import.meta.url).pathname], outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
  const options = { name: 'joinallworld-visit', script: await readFile(bundle, 'utf8'), modules: true, compatibilityDate: '2026-10-01', durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, durableObjectsPersist: join(folder, 'storage'), bindings: { BUILD_ID: 'local-visit', FOUNDER_EMAIL_SHA256: '', ...(sleeps ? { SLEEP_BETWEEN_BEATS: '1' } : {}) } };
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
  /** A socket that answers the host's heartbeat and keeps every house frame it is sent. */
  async function socket(who: Device) {
    const response = await send(origin + '/socket', { headers: { origin, cookie: who.cookie, upgrade: 'websocket' } });
    assert.equal(response.status, 101);
    const ws = response.webSocket as StubSocket, frames: { type: string }[] = [];
    ws.addEventListener('message', (event) => {
      const frame = JSON.parse(event.data) as { type: string };
      if (frame.type === 'heartbeat') ws.send(JSON.stringify({ type: 'heartbeat-ack' }));
      if (frame.type.startsWith('invite-')) frames.push(frame);
    });
    ws.accept(); sockets.push(ws);
    async function until<T>(read: () => T | undefined | null | false, what: string): Promise<T> {
      for (let i = 0; i < 300; i++) { const value = read(); if (value) return value; await pause(); }
      throw new Error(`Never happened: ${what}`);
    }
    return { ws, frames, until };
  }
  return { request, player, socket, id, page: (path: string) => send(origin + path), hibernate: () => mf.unsafeEvictDurableObject('joinallworld-visit', 'JoinAllworldState', { name: 'joinallworld-v1', webSockets: 'hibernate' }) };
}


test('Cloudflare visit: the choice of who may come in, the signed house link read with no session, the door’s refusals, the invitation', { timeout: 120000 }, async (t) => {
  const f = await fixture(t);
  const ada = await f.player('Ada'), bola = await f.player('Bola'), cy = await f.player('Cyril');
  assert.equal((await f.request('/api/social/friends/request', { to: bola.id, cityId: 'lagos' }, ada)).code, 'requested');
  assert.equal((await f.request('/api/social/friends/answer', { from: ada.id, accept: true, cityId: 'lagos' }, bola)).code, 'accepted');
  // A new player walks in by default; the choice is stored and changes what friends see.
  assert.deepEqual((await f.request('/api/social/visit/door', null, ada)).door, { who: 'walk', out: false, chosen: true });
  assert.deepEqual((await f.request('/api/social/me', null, bola)).friends?.map((friend) => friend.visit), ['walk']);
  assert.equal((await f.request('/api/social/visit/door', { who: 'invited' }, ada)).ok, true);
  assert.deepEqual((await f.request('/api/social/me', null, bola)).friends?.map((friend) => friend.visit), ['invited']);
  assert.equal((await f.request('/api/social/visit/door', { who: 'everyone' }, ada)).status, 400);
  // Visiting: refused with a plain sentence while the host is not home; a stranger is refused the same way.
  assert.equal((await f.request('/api/social/visit/enter', { host: ada.id }, bola)).code, 'only_invited');
  assert.equal((await f.request('/api/social/visit/door', { who: 'walk' }, ada)).ok, true);
  const refused = await f.request('/api/social/visit/enter', { host: ada.id }, bola);
  assert.deepEqual([refused.ok, refused.code], [false, 'host_offline']);
  assert.equal((await f.request('/api/social/visit/invite', { to: [bola.id] }, ada)).code, 'not_home', 'an invitation needs the host at home');
  // The link: made, signed with the object's own key, read by a browser with no session (display name only), and ended.
  const made = await f.request('/api/social/visit/link', { max: 2 }, ada);
  assert.deepEqual([made.ok, made.code, made.link?.max, made.link?.uses], [true, 'made', 2, 0]);
  assert.match(String(made.link?.path), /^\/h\/[A-Za-z0-9_-]{85}$/);
  const token = String(made.link?.path).slice(3);
  const peeked = await f.request('/api/social/visit/peek', { token });
  assert.deepEqual([peeked.status, peeked.code, peeked.host?.name], [200, 'open', 'Ada']);
  assert.equal((await f.request('/api/social/visit/peek', { token: `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}` })).code, 'ended');
  assert.equal((await f.request('/api/social/visit/link/enter', { token })).status, 401, 'coming in needs a session');
  const waiting = await f.request('/api/social/visit/link/enter', { token }, cy);
  assert.deepEqual([waiting.ok, waiting.code], [false, 'host_offline'], 'never into an empty home');
  assert.equal((await f.request('/api/social/visit/links', null, ada)).links?.length, 1);
  assert.equal((await f.request('/api/social/visit/link/end', { id: String(made.link?.id) }, ada)).code, 'ended');
  assert.equal((await f.request('/api/social/visit/peek', { token })).code, 'ended');
  assert.equal((await f.request('/api/social/visit/close', { closed: true }, ada)).closed, true);
  assert.equal((await f.request('/api/social/visit/enter', { host: ada.id }, bola)).code, 'door_shut');
});

test('Cloudflare visit: a house link and the key that signed it are still good after the object slept', { timeout: 120000 }, async (t) => {
  const f = await fixture(t, true);
  const ada = await f.player('Ada');
  await f.socket(ada);
  const made = await f.request('/api/social/visit/link', {}, ada);
  assert.equal(made.code, 'made');
  const token = String(made.link?.path).slice(3);
  await f.hibernate();
  assert.deepEqual([(await f.request('/api/social/visit/peek', { token })).code, (await f.request('/api/social/visit/peek', { token })).host?.name], ['open', 'Ada']);
  assert.equal((await f.request('/api/social/visit/links', null, ada)).links?.[0]?.path, made.link?.path, 'the same link: the signing key did not change');
});
