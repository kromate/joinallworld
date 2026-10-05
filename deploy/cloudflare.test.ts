import { loadCityContent as preloadCityContent } from '../src/game/cities/registry.ts';
await Promise.all(['lagos', 'ibadan'].map(preloadCityContent));
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { claimsFor, makeKey, signToken } from '../server/accounts/test-tokens.ts';
import { TOKEN_KEYS_URL } from '../server/accounts/token.ts';

/** The pieces of the pinned tooling (miniflare, esbuild) these tests use; the packages live in deploy/tooling, not in the repo's own dependencies. */
interface StubSocket { addEventListener(type: 'message', listener: (event: { data: string }) => void): void; addEventListener(type: 'close', listener: (event: { code: number }) => void): void; accept(): void; send(data: string): void; close(): void }
type MiniflareResponse = Response & { webSocket?: StubSocket | null }
/** A row of a table in the object's SQLite storage; the tests read `value`, `secret`, `name`, `n`, ... as they know their query. */
type Row = { value: string; secret: string; name: string; n: number; [column: string]: string | number }
/** Never empty: a query with no rows fails on the first property read, as before. */
type Rows = [Row, ...Row[]]
interface ObjectStorage { exec(query: string, ...bindings: (string | number | null)[]): Promise<Rows> }
interface MiniflareInstance {
  ready: Promise<URL>
  dispose(): Promise<void>
  dispatchFetch(url: string, init?: RequestInit & { headers?: Record<string, string> }): Promise<MiniflareResponse>
  unsafeGetDurableObjectStorage(script: string, className: string, id: { name: string }): Promise<ObjectStorage>
  unsafeEvictDurableObject(script: string, className: string, id: { name: string; webSockets?: 'hibernate' }): Promise<void>
}
interface MiniflareTooling {
  Miniflare: new (options: Record<string, unknown>) => MiniflareInstance
  convertV4MiniflareOptions(options: Record<string, unknown>): Record<string, unknown>
}
interface BundleOptions { entryPoints: string[]; outfile: string; bundle: boolean; format: string; platform: string; external: string[] }
interface EsbuildTooling { build(options: BundleOptions): Promise<unknown> }
const require = createRequire(resolve(process.env.JOINALLWORLD_TOOLS || 'deploy/tooling', 'package.json'));
const { Miniflare, convertV4MiniflareOptions } = require('miniflare') as MiniflareTooling;
const { build: esbuild } = require('esbuild') as EsbuildTooling;
const build: (options: BundleOptions) => Promise<unknown> = process.env.JOINALLWORLD_BUNDLER_ROLLUP ? async options => {
 const { rollup } = await import('rollup');
 const bundle = await rollup({ input: options.entryPoints[0] as string, external: options.external });
 await bundle.write({ file: options.outfile, format: 'esm' }); await bundle.close();
} : esbuild;

/** A player the tests created: the session's public fields and the cookie to send. */
interface Device { id: string; name: string; cookie: string; device?: string; [field: string]: unknown }
interface Member { id: string; name: string; muted: boolean; enabled: boolean; position: { x: number; z: number } }
/**
 * A frame received on a socket. The tests assert on the fields they expect, so a field a frame does not carry fails
 * its assertion rather than the type check.
 */
interface Frame {
  type: string; code: string; error: string; id: string; from: string; clientId: string; body: string; answer: string; reason?: string
  members: [Member, ...Member[]]
  conv: { id: string; with: string }
  message: { body: string; from: { id: string } }
  by: { name: string }
  [field: string]: unknown
}
/** The last table-state frame a socket was sent (a Whot table at the buka). */
interface TableState {
  type: string
  n: number
  you: number
  toMove: number[]
  table: { status: string; seats: { name: string; bot?: boolean }[] }
  view: { hand: { s: string }[]; playable: number[] }
  result: { calledOff: boolean; text: string; winners: number[] }
}
/** A socket with the frames it has received. `state` is set by the first table-state frame; the table steps read it only after one arrived. */
interface Peer { who: Device; send(message: object): void; next(): Promise<Frame>; until(type: string, tries?: number): Promise<Frame>; seen: Frame[]; state: TableState }

/**
 * `clockShiftMs`: the object's clock runs this far ahead (a test of something that depends on the hour of the day cannot wait for it).
 * `sleeps`: the object may sleep while sockets are connected (SLEEP_BETWEEN_BEATS) — for a test that puts it to sleep
 * (`hibernate`). By default it stays in memory while anyone is connected, and an eviction would wait for it for ever.
 */
async function fixture(t: TestContext, { clockShiftMs = 0, sleeps = false, ...overrides }: Record<string, unknown> & { clockShiftMs?: number; sleeps?: boolean } = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-do-test-'));
  const bundle = join(folder, 'worker.mjs');
  await build({ entryPoints: [new URL('./cloudflare-worker.ts', import.meta.url).pathname], outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
  const options = { name: 'joinallworld-conformance', script: (clockShiftMs ? `Date.now = ((real) => () => real() + ${Math.round(clockShiftMs)})(Date.now.bind(Date));\n` : '') + await readFile(bundle, 'utf8'), modules: true, compatibilityDate: '2026-10-01', durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, durableObjectsPersist: join(folder, 'storage'), bindings: { BUILD_ID: 'local-conformance' } as Record<string, string>, assets: { directory: new URL('../dist', import.meta.url).pathname, binding: 'ASSETS', run_worker_first: true, routerConfig: { has_user_worker: true }, assetConfig: { not_found_handling: 'single-page-application' } }, ...overrides };
  if (sleeps) options.bindings = { ...options.bindings, SLEEP_BETWEEN_BEATS: '1' };
  // What the object wrote to its console is kept (and still shown): a test can say what must never be logged.
  const lines: string[] = [], handleStructuredLogs = ({ level, message }: { level: string; message: string }) => { lines.push(message); (level === 'error' || level === 'warn' ? console.error : console.log)(message); };
  let mf = new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: join(folder, 'storage'), unsafeInspectDurableObjects: true, handleStructuredLogs });
  const sockets: StubSocket[] = [];
  /**
   * Every response the test was handed. A body nobody read (a status check on a 150 KB image) keeps its connection busy, and
   * Miniflare's dispose() waits for every connection to the runtime to finish: with the runtime already stopped it never
   * does, so a whole run hung there. `stop` cancels what was left unread, and gives dispose a deadline so a hang is a failure.
   */
  const handed: MiniflareResponse[] = [];
  const send = async (url: string, init?: RequestInit & { headers?: Record<string, string> }) => { const response = await mf.dispatchFetch(url, init); handed.push(response); return response; };
  const within = <T>(step: string, work: Promise<T>, ms = 30000) => { let timer: NodeJS.Timeout; return Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(`${step} did not finish within ${ms} ms`)), ms); })]).finally(() => clearTimeout(timer)); };
  async function stop() {
    for (const socket of sockets) try { socket.close(); } catch {}
    sockets.length = 0;
    for (const response of handed.splice(0)) if (!response.bodyUsed && response.body && !response.body.locked) await response.body.cancel().catch(() => {});
    await within('Miniflare dispose', mf.dispose());
  }
  t.after(async () => { await stop(); await rm(folder, { recursive: true, force: true }); });
  await mf.ready;
  const origin = 'https://joinallworld.test';
  async function request(path: string, body?: object | null, cookie?: string | null, headers: Record<string, string> = {}) {
    return send(origin + path, { method: body ? 'POST' : 'GET', headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  }
  async function device(name: string): Promise<Device> {
    const response = await request('/api/session', { name });
    assert.equal(response.status, 200);
    const setCookie = response.headers.get('set-cookie');
    assert.match(setCookie as string, /HttpOnly/); assert.match(setCookie as string, /SameSite=Lax/); assert.match(setCookie as string, /Secure/);
    const body = await response.json();
    return { ...body.session, cookie: (setCookie as string).split(';')[0] as string };
  }
  const action = (device: Device, fields: object) => request('/api/action', { actionId: `${Date.now()}:${randomUUID()}`, cityId: 'lagos', ...fields }, device.cookie);
  const life = async (device: Device) => (await (await request('/api/life?city=lagos', null, device.cookie)).json()).state;
  async function socket(device: Device) {
    const response = await send(origin + '/socket', { headers: { origin, cookie: device.cookie, upgrade: 'websocket' } });
    assert.equal(response.status, 101);
    const ws = response.webSocket as StubSocket;
    const queue: Frame[] = [], pending: ((item: Frame) => void)[] = [], heartbeats: number[] = [];
    ws.addEventListener('message', event => { const item = JSON.parse(event.data) as Frame; if (item.type === 'heartbeat') { heartbeats.push(Date.now()); ws.send(JSON.stringify({type:'heartbeat-ack'})); return; } const listener = pending.shift(); if (listener) listener(item); else queue.push(item); });
    ws.accept(); sockets.push(ws);
    return { ws, heartbeats, send: (message: object) => ws.send(JSON.stringify(message)), next: (): Promise<Frame> => queue.length ? Promise.resolve(queue.shift() as Frame) : new Promise<Frame>((resolve, reject) => { const timer = setTimeout(() => reject(Error('Socket message timeout')), 3000); pending.push((item: Frame) => { clearTimeout(timer); resolve(item); }); }) };
  }
  const storage = () => mf.unsafeGetDurableObjectStorage('joinallworld-conformance', 'JoinAllworldState', { name: 'joinallworld-v1' });
  /**
   * TIME ON THE WORKER. The object's clock is the real one and cannot be moved, so a test lets time pass for ONE life the
   * way the conformance tests above do: its stored `updatedAt` (and the absolute times of its activity cooldowns) is moved
   * back, and the next request settles the elapsed time through the engine exactly as a real wait would.
   */
  async function skip(device: Device, ms: number, cityId = 'lagos') {
    const db = await storage(), secret = device.cookie.slice(11);
    const session = JSON.parse((await db.exec('SELECT value FROM sessions WHERE secret = ?', secret))[0].value);
    const entry = session.cities[cityId];
    entry.updatedAt -= ms;
    for (const [id, readyAt] of Object.entries(entry.state.travel?.cooldowns ?? {})) entry.state.travel.cooldowns[id] = (readyAt as number) - ms;
    await db.exec('UPDATE sessions SET value = ? WHERE secret = ?', JSON.stringify(session), secret);
  }
  /** The next Lagos day for one life: the day its last paid work was counted on becomes yesterday. */
  async function nextDay(device: Device, cityId = 'lagos') {
    const db = await storage(), secret = device.cookie.slice(11);
    const session = JSON.parse((await db.exec('SELECT value FROM sessions WHERE secret = ?', secret))[0].value);
    const work = session.cities[cityId].state.civic.work;
    if (work.last !== null) work.last -= 1;
    await db.exec('UPDATE sessions SET value = ? WHERE secret = ?', JSON.stringify(session), secret);
  }
  const upgrade = (headers: Record<string, string>) => send(origin + '/socket', { headers: { upgrade: 'websocket', ...headers } });
  /** Make `count` requests, fifty at a time, reading every answer; how many of each status came back. */
  async function spend(count: number, make: (index: number) => Promise<MiniflareResponse>): Promise<Record<number, number>> {
    const statuses: Record<number, number> = {};
    for (let done = 0; done < count; done += 50) await Promise.all(Array.from({ length: Math.min(50, count - done) }, async (_, i) => { const response = await make(done + i); statuses[response.status] = (statuses[response.status] ?? 0) + 1; await response.arrayBuffer(); }));
    return statuses;
  }
  return { spend, logged: () => lines.join('\n'), atHost: (host: string,path: string,method='GET') => send(host+path,{method}), request, device, action, life, socket, storage, upgrade, origin, skip, nextDay, fetch: (path: string, init?: RequestInit & { headers?: Record<string, string> }) => send(origin + path, init), hibernate: () => mf.unsafeEvictDurableObject('joinallworld-conformance', 'JoinAllworldState', { name: 'joinallworld-v1', webSockets: 'hibernate' }), restart: async () => { await stop(); mf = new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: join(folder, 'storage'), unsafeInspectDurableObjects: true, handleStructuredLogs }); await within('Miniflare restart', mf.ready); } };
}

test('Cloudflare: public IDs, origin isolation, atomic duplicate fare, replay window and restart durability', async t => {
  const f = await fixture(t), a = await f.device('Ada'), b = await f.device('Bola');
  assert.notEqual(a.id, a.cookie.slice(11));
  assert.equal((await f.request('/api/life?city=lagos')).status, 401);
  assert.equal((await f.request('/api/session', { name: 'Mallory' }, null, { origin: 'https://evil.test' })).status, 403);
  const action = { actionId: `${Date.now()}:${randomUUID()}`, type: 'travel', id: 'library', mode: 'cab' };
  const values = await Promise.all([f.action(a, action), f.action(a, action)]).then(results => Promise.all(results.map(x => x.json())));
  assert.deepEqual(values.map(x => x.state.cash), [4600, 4600]); assert.equal(values.filter(x => x.duplicate).length, 1);
  assert.equal((await f.life(b)).cash, 5000);
  const before = JSON.stringify(await (await f.storage()).exec('SELECT value FROM sessions'));
  const conflict = await f.action(a, { ...action, id: 'park' }); assert.equal(conflict.status, 409); assert.equal((await conflict.json()).error, 'action_id_conflict');
  assert.equal(JSON.stringify(await (await f.storage()).exec('SELECT value FROM sessions')), before);
  const expired = await f.action(a, { ...action, actionId: `${Date.now() - 86401000}:${randomUUID()}` }); assert.equal(expired.status, 409); assert.equal((await expired.json()).error, 'action_expired');
  const future = await f.action(a, { ...action, actionId: `${Date.now() + 60000}:${randomUUID()}` }); assert.equal(future.status, 409); assert.equal((await future.json()).error, 'action_expired');
  await f.restart(); assert.equal((await f.life(a)).cash, 4600);
  assert.equal((await (await f.action(a, action)).json()).duplicate, true);
});

test('Cloudflare: settlement once across restart, sliding expiry, expired token never reads archived life', async t => {
  const f = await fixture(t), a = await f.device('Ada');
  await f.action(a, { type: 'spot', id: 'trees' }); await f.action(a, { type: 'activity', id: 'chill' });
  const storage = await f.storage();
  const rows = await storage.exec('SELECT value FROM sessions');
  const session = JSON.parse(rows[0].value);
  session.cities.lagos.updatedAt -= 12000; session.expiresAt = Date.now() + 60000;
  await storage.exec('UPDATE sessions SET value = ?, expires_at = ? WHERE secret = ?', JSON.stringify(session), session.expiresAt, a.cookie.slice(11));
  await f.restart();
  assert.equal((await f.life(a)).needs.fun, 60); assert.equal((await f.life(a)).needs.fun, 60);
  const currentStorage = await f.storage();
  const renewed = JSON.parse((await currentStorage.exec('SELECT value FROM sessions'))[0].value);
  assert.ok(renewed.expiresAt > Date.now() + 29 * 86400000);
  renewed.expiresAt = Date.now() - 1;
  await currentStorage.exec('UPDATE sessions SET value = ?, expires_at = ? WHERE secret = ?', JSON.stringify(renewed), renewed.expiresAt, a.cookie.slice(11));
  assert.equal((await f.request('/api/session', null, a.cookie)).status, 401);
  const fresh = await f.device('New life'); assert.notEqual(fresh.id, a.id);
  const archives = await currentStorage.exec('SELECT value FROM archived_lives');
  assert.equal(archives.length, 1); assert.equal(JSON.parse(archives[0].value).cities.lagos.state.needs.fun, 60);
  assert.ok(!archives[0].value.includes(a.cookie.slice(11)));
});

test('Cloudflare: two clients presence, chat dedupe, signaling isolation and travel eviction', async t => {
  const f = await fixture(t, { sleeps: true }), a = await f.device('Ada'), b = await f.device('Bola');
  const x = await f.socket(a), y = await f.socket(b);
  x.send({ type: 'join', cityId: 'lagos', venueId: 'park' });
  const solo = await x.next(); assert.equal(solo.members.length, 1); assert.ok(!JSON.stringify(solo).includes(a.cookie.slice(11))); assert.equal(solo.members[0].muted, true);
  y.send({ type: 'join', cityId: 'ibadan', venueId: 'park' }); await y.next();
  x.send({ type: 'signal', to: b.id, data: { candidate: 'test' } }); assert.equal((await x.next()).code, 'peer_not_in_room');
  y.send({ type: 'join', cityId: 'lagos', venueId: 'park' }); await x.next(); await y.next();
  x.send({ type: 'signal', to: b.id, data: { candidate: 'test' } }); assert.equal((await y.next()).from, a.id);
  const chat = { type: 'chat', body: 'Hello', clientId: randomUUID() };
  x.send(chat); const first = await x.next(); assert.equal((await y.next()).id, first.id); assert.ok(!JSON.stringify(first).includes(a.cookie.slice(11)));
  const receipts = await (await f.storage()).exec('SELECT value FROM chat_receipts');
  assert.ok(!JSON.stringify(receipts).includes('Hello')); assert.ok(!JSON.stringify(receipts).includes('Ada'));
  await f.hibernate();
  x.send(chat); assert.equal((await x.next()).id, first.id);
  x.send({ type: 'voice-state', enabled: true, muted: true });
  assert.equal((await x.next()).members.find(member => member.id === a.id)?.muted, true); await y.next();
  await f.hibernate();
  y.send({ type: 'voice-state', enabled: true, muted: true });
  assert.equal((await x.next()).members.filter(member => member.enabled).length, 2); await y.next();
  x.send({ type: 'chat', body: '', clientId: 'bad-chat' }); assert.equal((await x.next()).clientId, 'bad-chat');
  await f.action(a, { type: 'travel', id: 'library', mode: 'cab' });
  assert.equal((await x.next()).code, 'venue_mismatch'); assert.equal((await y.next()).members.length, 1);
  x.send({ type: 'join', cityId: 'lagos', venueId: 'library' }); assert.equal((await x.next()).code, 'venue_mismatch');
  // The object was put to sleep twice above and made again: the instance it replaced is not reached by this one's requests (no "different Durable Object" I/O).
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.ok(!/World sync failed|different Durable Object/.test(f.logged()), f.logged().split('\n').filter(line => /World sync failed|different Durable Object/.test(line)).join('\n'));
});

test('Cloudflare: a replaced object instance leaves the room watcher alone: no cross-instance I/O, presence still updates, no stray frames', async t => {
  const f = await fixture(t, { sleeps: true }), a = await f.device('Ada'), b = await f.device('Bola');
  const x = await f.socket(a), y = await f.socket(b);
  x.send({ type: 'join', cityId: 'lagos', venueId: 'park' }); await x.next();
  y.send({ type: 'join', cityId: 'lagos', venueId: 'park' }); await x.next(); await y.next();
  // Put the object to sleep twice: each time a new instance is made, and the ones it replaced are still in memory.
  await f.hibernate();
  x.send({ type: 'voice-state', enabled: true, muted: true }); await x.next(); await y.next();
  await f.hibernate();
  y.send({ type: 'voice-state', enabled: true, muted: true }); await x.next(); await y.next();
  // A life change inside the current instance's transaction reaches the room watcher of every instance in this isolate.
  await f.action(a, { type: 'travel', id: 'library', mode: 'cab' });
  assert.equal((await x.next()).code, 'venue_mismatch');
  assert.equal((await y.next()).members.length, 1, 'the room still updates: the one who left is gone');
  await assert.rejects(x.next(), /timeout/, 'the replaced instances send nothing of their own');
  assert.ok(!/different Durable Object|Cannot perform I\/O|Request failed|World sync failed/i.test(f.logged()), f.logged());
});

test('Cloudflare: socket auth, expired open connection and disconnect after hibernation', async t => {
  const f = await fixture(t, { sleeps: true }), a = await f.device('Ada'), b = await f.device('Bola');
  assert.equal((await f.upgrade({ cookie: a.cookie })).status, 403);
  assert.equal((await f.upgrade({ cookie: a.cookie, origin: 'https://foreign.test' })).status, 403);
  assert.equal((await f.upgrade({ origin: f.origin })).status, 401);
  assert.equal((await f.request('/socket', null, a.cookie)).status, 403);
  const x = await f.socket(a), y = await f.socket(b);
  x.send({ type: 'join', cityId: 'lagos', venueId: 'park' }); await x.next();
  y.send({ type: 'join', cityId: 'lagos', venueId: 'park' }); await x.next(); await y.next();
  await f.hibernate();
  const storage = await f.storage();
  const row = (await storage.exec('SELECT value FROM sessions WHERE secret = ?', a.cookie.slice(11)))[0];
  const session = JSON.parse(row.value); session.expiresAt = Date.now() - 1;
  await storage.exec('UPDATE sessions SET value=?,expires_at=? WHERE secret=?', JSON.stringify(session), session.expiresAt, a.cookie.slice(11));
  x.send({ type: 'chat', body: 'Expired', clientId: 'expired' });
  assert.equal((await x.next()).code, 'device_session_required'); assert.equal((await y.next()).members.length, 1);
  assert.equal((await f.upgrade({ origin: f.origin, cookie: a.cookie })).status, 401);
});

test('Cloudflare: voice cap, per-session socket cap, and a session’s request limit follows it to another address', async t => {
  const f = await fixture(t), members = [];
  for (let index = 0; index < 9; index++) {
    const device = await f.device(`Voice ${index}`), socket = await f.socket(device);
    socket.send({ type: 'join', cityId: 'lagos', venueId: 'park' });
    for (const member of members) await member.next(); await socket.next();
    socket.send({ type: 'voice-state', enabled: true, muted: true });
    if (index < 8) { for (const member of members) await member.next(); await socket.next(); }
    else assert.equal((await socket.next()).code, 'voice_room_full');
    members.push(socket);
  }
  const device = await f.device('Many tabs');
  for (let count = 0; count < 8; count++) await f.socket(device);
  assert.equal((await f.upgrade({ origin: f.origin, cookie: device.cookie })).status, 503);
  // The session's allowance for a minute, spent for real (the count is in memory, where no test can set it).
  assert.deepEqual(await f.spend(600, () => f.request('/api/session', null, device.cookie)), { 200: 600 });
  assert.equal((await f.request('/api/session', null, device.cookie)).status, 429);
  assert.equal((await f.request('/api/session', null, device.cookie, { 'cf-connecting-ip': '192.0.2.44' })).status, 429);
});

test('Cloudflare: a short limiter full of other people’s live counts turns no newcomer away — it makes room, in memory; long windows and the operator’s rows are stored and survive', async t => {
  const token = 'worker-operator-token-0123456789-abcdef';
  const f = await fixture(t, { bindings: { BUILD_ID: 'local-conformance', MODERATOR_TOKEN: token } }), storage = await f.storage(), far = Date.now() + 3600000;
  const limits = async (): Promise<{ short: number; long: number; protected: number }> => (await (await f.request('/api/mod/overview', null, null, { authorization: `Bearer ${token}` })).json()).store.limits;
  await f.request('/api/health');
  // A long-window row and an operator row, as stored; then a flood: more live short counts than the class may hold, each from another address.
  await storage.exec('INSERT OR REPLACE INTO rate_limits_protected(key,started_at,count,expires_at) VALUES(?,?,?,?)', 'mod:fail:operator', Date.now(), 1, far);
  await storage.exec('INSERT OR REPLACE INTO rate_limits_long(key,started_at,count,expires_at) VALUES(?,?,?,?)', 'upgrade:long-window', Date.now(), 7, far + 86400000);
  assert.deepEqual(await f.spend(10400, i => f.request('/api/health', null, null, { 'cf-connecting-ip': `10.${Math.floor(i / 62500)}.${Math.floor(i / 250) % 250}.${1 + (i % 250)}` })), { 200: 10400 }, 'no address was refused its first request');
  const held = await limits();
  assert.ok(held.short > 9000 && held.short <= 10000, `the short class is full and inside its bound (${held.short})`);
  // A visitor from an address never seen before: a session, a life, an action, a socket.
  const fresh = { 'cf-connecting-ip': '198.51.100.77' };
  const made = await f.request('/api/session', { name: 'Newcomer' }, null, fresh);
  assert.equal(made.status, 200, 'a new visitor is not refused because the class is full');
  const cookie = (made.headers.get('set-cookie') as string).split(';')[0] as string; await made.text();
  assert.equal((await f.request('/api/life?city=lagos', null, cookie, fresh)).status, 200);
  assert.equal((await f.upgrade({ origin: f.origin, cookie, 'cf-connecting-ip': '198.51.100.78' })).status, 101);
  for (let i = 0; i < 20; i++) assert.equal((await f.request('/api/health', null, null, { 'cf-connecting-ip': `198.51.100.${100 + i}` })).status, 200, `address ${i}`);
  assert.ok((await limits()).short <= 10000, 'the class stays inside its bound');
  // The flood wrote no row: a short count is not stored, and the old table of short rows is not made any more.
  assert.equal((await storage.exec("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'rate_limits'"))[0].n, 0);
  // The long window kept its count and the operator's row is still there — and both are still there after a restart.
  assert.equal((await storage.exec("SELECT count AS n FROM rate_limits_long WHERE key = 'upgrade:long-window'"))[0].n, 7);
  assert.equal((await storage.exec("SELECT COUNT(*) AS n FROM rate_limits_protected WHERE key = 'mod:fail:operator'"))[0].n, 1);
  await f.restart();
  const after = await f.storage();
  assert.equal((await after.exec("SELECT count AS n FROM rate_limits_long WHERE key = 'upgrade:long-window'"))[0].n, 7);
  assert.equal((await after.exec("SELECT COUNT(*) AS n FROM rate_limits_protected WHERE key = 'mod:fail:operator'"))[0].n, 1);
  assert.equal((await limits()).short, 0, 'short counts start again with the object');
});

test('Cloudflare: a flood of hour-long rows cannot erase the operator guard or a session’s limit, and a newcomer still gets a session', async t => {
  const token = 'worker-operator-token-0123456789-abcdef';
  const f = await fixture(t, { bindings: { BUILD_ID: 'local-conformance', MODERATOR_TOKEN: token } }), storage = await f.storage();
  const ip = (n: number) => ({ 'cf-connecting-ip': `203.0.${Math.floor(n / 250)}.${1 + (n % 250)}` });
  // The operator guard: 100 token-less tries from many addresses fill its window; the next one is refused with 429.
  for (let i = 0; i < 100; i++) assert.equal((await f.request('/api/mod/overview', null, null, ip(i))).status, 401, `try ${i}`);
  assert.equal((await f.request('/api/mod/overview', null, null, ip(300))).status, 429, 'the guard is at its cap');
  // A session close to its limit.
  const ada = await f.device('Ada');
  assert.deepEqual(await f.spend(599, () => f.request('/api/session', null, ada.cookie)), { 200: 599 });
  // The flood: the hour-long table full (what unauthenticated e-mail requests used to leave), then more new keys arriving.
  await storage.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 10000) INSERT OR REPLACE INTO rate_limits_long(key,started_at,count,expires_at) SELECT 'growth:email:flood-' || i, ${Date.now()}, 1, ${Date.now() + 3600000} + i FROM n`);
  for (let i = 0; i < 30; i++) await f.request('/api/growth/email', { consent: true, email: `x${i}@example.test` }, null, ip(400 + i));
  assert.equal((await storage.exec("SELECT COUNT(*) AS n FROM rate_limits_long WHERE key LIKE 'growth:email:203.%'"))[0].n, 0, 'a request without a session makes no hour-long row');
  for (let i = 0; i < 300; i++) await f.request('/api/health', null, null, ip(800 + i));
  assert.ok((await storage.exec('SELECT COUNT(*) AS n FROM rate_limits_long'))[0].n <= 10000, 'the long table stays inside its bound');
  // Nothing short or protected was erased: the guard still refuses, and the session's count went on from 599.
  assert.equal((await f.request('/api/mod/overview', null, null, ip(301))).status, 429, 'mod-fail:all still refuses at its cap');
  assert.equal((await f.request('/api/session', null, ada.cookie)).status, 200);
  assert.equal((await f.request('/api/session', null, ada.cookie)).status, 429, 'the session’s own count was not forgotten');
  assert.equal((await f.request('/api/session', null, ada.cookie)).status, 429, 'the session is still held to its limit');
  const fresh = await f.request('/api/session', { name: 'Newcomer' }, null, ip(2000));
  assert.equal(fresh.status, 200, 'a newcomer is not turned away'); await fresh.text();
});

test('Cloudflare: proximity survives hibernation, movement avoids SQL writes and private homes stay isolated', async t => {
  const f = await fixture(t, { sleeps: true }), a = await f.device('Ada'), b = await f.device('Bola');
  const x = await f.socket(a), y = await f.socket(b);
  x.send({ type: 'join', cityId: 'lagos', venueId: 'park' }); await x.next();
  y.send({ type: 'join', cityId: 'lagos', venueId: 'park' }); await x.next(); await y.next();
  const storage = await f.storage();
  const before = JSON.stringify(await storage.exec('SELECT * FROM sessions'));
  x.send({ type: 'move', x: 12, z: 0 });
  assert.deepEqual((await x.next()).members.find(m => m.id === a.id)?.position, { x: 12, z: 0 }); await y.next();
  assert.equal(JSON.stringify(await storage.exec('SELECT * FROM sessions')), before);
  await f.hibernate();
  x.send({ type: 'signal', to: b.id, data: { candidate: 'synthetic' } }); assert.equal((await x.next()).code, 'peer_out_of_range');
  x.send({ type: 'move', x: 11, z: 0 }); await x.next(); await y.next();
  x.send({ type: 'signal', to: b.id, data: { candidate: 'synthetic' } }); assert.equal((await y.next()).from, a.id);
  x.send({ type: 'move', x: 21, z: 0 }); assert.equal((await x.next()).code, 'invalid_position');
  for (let i = 0; i < 3; i++) { x.send({ type: 'move', x: i, z: 0 }); await x.next(); await y.next(); }
  x.send({ type: 'move', x: 0, z: 0 }); assert.equal((await x.next()).code, 'move_rate_limited');
  const currentStorage = await f.storage();
  for (const row of await currentStorage.exec('SELECT secret,value FROM sessions')) {
    const session = JSON.parse(row.value); session.cities.lagos.state.location = 'home'; session.cities.lagos.state.activeAction = null;
    await currentStorage.exec('UPDATE sessions SET value=? WHERE secret=?', JSON.stringify(session), row.secret);
  }
  x.send({ type: 'join', cityId: 'lagos', venueId: 'home' }); await y.next(); assert.equal((await x.next()).members.length, 1);
  y.send({ type: 'join', cityId: 'lagos', venueId: 'home' }); assert.equal((await y.next()).members.length, 1);
  x.send({ type: 'signal', to: b.id, data: { candidate: 'synthetic' } }); assert.equal((await x.next()).code, 'peer_not_in_room');
  const voice = await (await f.request('/api/voice-config', null, a.cookie)).json(); assert.equal(voice.turnConfigured, false); assert.equal(voice.radius, 12);
});

test('Cloudflare: twelve devices behind one IP retain independent HTTP allowance and receipts stay outside hot sessions', async t => {
  const f = await fixture(t, { sleeps: true });
  const devices = [];
  for (let i = 0; i < 12; i++) devices.push(await f.device(`Player ${i}`));
  for (const device of devices) for (let i = 0; i < 51; i++) assert.equal((await f.request('/api/session', null, device.cookie)).status, 200);
  const a = devices[0] as Device;
  const action = { actionId: `${Date.now()}:${randomUUID()}`, type: 'travel', id: 'library', mode: 'cab' };
  assert.equal((await (await f.action(a, action)).json()).state.cash, 4600);
  const storage = await f.storage();
  const session = JSON.parse((await storage.exec('SELECT value FROM sessions WHERE secret=?', a.cookie.slice(11)))[0].value);
  assert.equal(session.actions, undefined);
  assert.equal((await storage.exec('SELECT COUNT(*) AS n FROM action_receipts'))[0].n, 1);
  await f.hibernate();
  assert.equal((await (await f.action(a, action)).json()).duplicate, true);
  assert.equal((await f.request('/api/voice-config', null, (devices[1] as Device).cookie)).status, 403);
  const socket = await f.socket(devices[1] as Device); socket.send({ type: 'join', cityId: 'lagos', venueId: 'park' }); await socket.next();
  for (let i = 0; i < 6; i++) assert.equal((await f.request('/api/voice-config', null, (devices[1] as Device).cookie)).status, 200);
  assert.equal((await f.request('/api/voice-config', null, (devices[1] as Device).cookie)).status, 429);
});

test('Cloudflare: gradual home nap cancellation survives eviction without repeating gains', async t => {
  const f = await fixture(t, { sleeps: true }), a = await f.device('Ada'); await f.life(a);
  let storage = await f.storage();
  const session = JSON.parse((await storage.exec('SELECT value FROM sessions'))[0].value);
  session.cities.lagos.state.location = 'home'; session.cities.lagos.state.needs.energy = 20;
  await storage.exec('UPDATE sessions SET value=? WHERE secret=?', JSON.stringify(session), a.cookie.slice(11));
  assert.equal((await (await f.action(a, { type: 'spot', id: 'bedroom' })).json()).ok, true);
  assert.equal((await (await f.action(a, { type: 'activity', id: 'nap' })).json()).ok, true);
  const started = JSON.parse((await storage.exec('SELECT value FROM sessions'))[0].value);
  started.cities.lagos.updatedAt -= 3000;
  await storage.exec('UPDATE sessions SET value=? WHERE secret=?', JSON.stringify(started), a.cookie.slice(11));
  await f.hibernate();
  const cancelled = await (await f.action(a, { type: 'cancel' })).json(); assert.equal(cancelled.ok, true); assert.equal(cancelled.state.activeAction, null);
  assert.ok(cancelled.state.needs.energy >= 26 && cancelled.state.needs.energy < 28);
  await f.restart();
  const after = await f.life(a); assert.equal(after.needs.energy, cancelled.state.needs.energy);
});

test('Cloudflare: an Ogun trip survives the object sleeping; the fare is charged once and a reload shows the new city', async t => {
  const f = await fixture(t, { sleeps: true });
  const opened = await f.request('/api/session', { name: 'Ada', onboarding: true });
  const a = { ...(await opened.json()).session, cookie: (opened.headers.get('set-cookie') as string).split(';')[0] as string };
  const step = async (type: string, payload: object = {}, cityId = 'lagos') => (await (await f.action(a, { type, payload, cityId })).json());
  assert.equal((await step('onboarding.quick-start', { look: (await import('../src/quick-start/look-model.ts')).presetLook('owambe') })).ok, true);
  for (const [type, payload] of [['onboarding.traits', { traits: ['smooth-talker', 'clean-pikin'] }], ['onboarding.dream', { dream: 'everybodys-padi' }], ['onboarding.lottery', {}], ['onboarding.home', { lga: 'ikeja', via: 'manual' }]] as const) assert.equal((await step(type, payload)).ok, true, type);
  const before = (await f.life(a)).cash;
  const sent = await step('estate.relocate', { to: 'ota', mode: 'road' });
  assert.equal(sent.ok, true);
  assert.equal(sent.state.cash, before - 2000, 'the Ota fare is charged at departure');
  await f.hibernate();
  const midway = await f.life(a);
  assert.equal(midway.activeAction.kind, 'intercity'); assert.equal(midway.cash, before - 2000);
  assert.equal((await step('estate.relocate', { to: 'ota', mode: 'road' })).ok, false, 'a second departure while travelling is refused');
  await f.skip(a, 61000);
  await f.hibernate();
  const arrived = await f.life(a);
  assert.deepEqual([arrived.estate.city, arrived.cash, arrived.activeAction], ['ota', before - 2000, null]);
  await f.restart();
  const reloaded = await (await f.request('/api/life?city=ota', null, a.cookie)).json();
  assert.deepEqual([reloaded.state.estate.city, reloaded.state.cash, reloaded.state.location], ['ota', before - 2000, arrived.location], 'a reload shows the same city, wallet and place');
  assert.equal(reloaded.state.ledger.filter((line: { amount: number }) => line.amount === -2000).length, 1, 'one fare in the ledger');
});

test('Cloudflare: real static HTML receives response security and cache headers', async t => {
  const f = await fixture(t); const response = await f.request('/');
  assert.equal(response.status, 200); assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); assert.equal(response.headers.get('cache-control'), 'no-cache'); assert.match(await response.text(), /Allworld/);
});

test('Cloudflare: the page is strict until accounts are configured, then allows the identity endpoints and Google\'s button, and the popup-friendly opener policy', async t => {
  const directive = (policy: string, name: string) => policy.split('; ').find(part => part.startsWith(`${name} `)) ?? '';
  const plain = await fixture(t);
  const off = await plain.request('/'); await off.arrayBuffer();
  assert.ok(!/google/.test(off.headers.get('content-security-policy') as string));
  assert.equal(off.headers.get('cross-origin-opener-policy'), 'same-origin');
  const bindings = { BUILD_ID: 'local-conformance', ACCOUNTS_FIREBASE_PROJECT_ID: 'demo-allworld-test', ACCOUNTS_FIREBASE_API_KEY: 'AIzaFakeFakeFakeFakeFakeFakeFakeFake1' };
  const email = await fixture(t, { bindings }), withEmail = await email.request('/'); await withEmail.arrayBuffer();
  assert.equal(directive(withEmail.headers.get('content-security-policy') as string, 'connect-src'), "connect-src 'self' wss://joinallworld.test https://cloudflareinsights.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com");
  assert.equal(withEmail.headers.get('cross-origin-opener-policy'), 'same-origin', 'no Google client id: no popup');
  const google = await fixture(t, { bindings: { ...bindings, ACCOUNTS_GOOGLE_CLIENT_ID: '123456789012-fakefakefake.apps.googleusercontent.com' } });
  const response = await google.request('/some/deep/link'); await response.arrayBuffer();
  const csp = response.headers.get('content-security-policy') as string;
  assert.match(directive(csp, 'script-src'), /https:\/\/accounts\.google\.com\/gsi\/client$/);
  assert.equal(directive(csp, 'frame-src'), 'frame-src https://accounts.google.com/gsi/');
  assert.match(directive(csp, 'style-src'), /https:\/\/accounts\.google\.com\/gsi\/style$/);
  assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
});

test('Cloudflare: the game page, a deep link, module pages, the API and an asset carry their security headers', async t => {
  const telemetry = { TELEMETRY_ENV: 'production', SENTRY_DSN_CLIENT: 'https://abcdef0123456789@o123.ingest.example-sentry.test/456', POSTHOG_KEY: 'phc_fakefakefake', POSTHOG_HOST: 'https://eu.i.example-posthog.test' };
  const plain = await fixture(t), configured = await fixture(t, { bindings: { BUILD_ID: 'local-conformance', ...telemetry } });
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => `'sha256-${createHash('sha256').update(match[1] as string).digest('base64')}'`);
  assert.equal(hashes.length, 2);
  const directive = (policy: string, name: string) => policy.split('; ').find(part => part.startsWith(`${name} `)) ?? '';
  for (const path of ['/', '/some/deep/link']) {
    const response = await plain.request(path); await response.arrayBuffer();
    assert.equal(response.status, 200);
    const csp = response.headers.get('content-security-policy') as string;
    assert.equal(directive(csp, 'script-src'), `script-src 'self' ${hashes.join(' ')} https://static.cloudflareinsights.com`, 'the built page\'s inline scripts, by hash');
    assert.equal(directive(csp, 'connect-src'), "connect-src 'self' wss://joinallworld.test https://cloudflareinsights.com", 'no telemetry host unless configured');
    assert.match(csp, /default-src 'self'; /); assert.match(csp, /frame-ancestors 'none'; upgrade-insecure-requests$/);
    assert.deepEqual([response.headers.get('strict-transport-security'), response.headers.get('x-frame-options'), response.headers.get('x-content-type-options'), response.headers.get('referrer-policy'), response.headers.get('cross-origin-opener-policy'), response.headers.get('cache-control')],
      ['max-age=31536000; includeSubDomains', 'DENY', 'nosniff', 'strict-origin-when-cross-origin', 'same-origin', 'no-cache'], path);
    assert.match(response.headers.get('permissions-policy') as string, /microphone=\(self\), geolocation=\(self\)/);
  }
  const head = await plain.fetch('/', { method: 'HEAD' });
  assert.match(head.headers.get('content-security-policy') as string, /script-src 'self' 'sha256-/, 'HEAD gets the policy too');
  const withTelemetry = await configured.request('/'); await withTelemetry.arrayBuffer();
  assert.equal(directive(withTelemetry.headers.get('content-security-policy') as string, 'connect-src'), "connect-src 'self' wss://joinallworld.test https://o123.ingest.example-sentry.test https://eu.i.example-posthog.test https://cloudflareinsights.com");
  const share = await plain.request('/s/unknown-code'); await share.arrayBuffer();
  assert.match(share.headers.get('content-security-policy') as string, /^default-src 'none'; .*upgrade-insecure-requests$/);
  assert.deepEqual([share.headers.get('referrer-policy'), share.headers.get('strict-transport-security'), share.headers.get('cross-origin-opener-policy')], ['no-referrer', 'max-age=31536000; includeSubDomains', 'same-origin']);
  const mail = await plain.request('/e/unsubscribe?t=unknown'); await mail.arrayBuffer();
  assert.match(mail.headers.get('content-security-policy') as string, /^default-src 'none'; .*upgrade-insecure-requests$/);
  const api = await plain.request('/api/does-not-exist'); await api.arrayBuffer();
  assert.deepEqual([api.status, api.headers.get('cache-control'), api.headers.get('x-content-type-options'), api.headers.get('cross-origin-resource-policy'), api.headers.get('strict-transport-security')], [404, 'no-store', 'nosniff', 'same-origin', 'max-age=31536000; includeSubDomains']);
  const refused = await plain.request('/api/session', { name: 'x' }, null, { origin: 'https://evil.example' }); await refused.arrayBuffer();
  assert.deepEqual([refused.status, refused.headers.get('cross-origin-resource-policy')], [403, 'same-origin'], 'the Worker\'s own refusals are sealed too');
  const asset = (/src="(\/assets\/[^"]+)"/.exec(await (await plain.request('/')).text()) as RegExpExecArray)[1] as string;
  const file = await plain.request(asset); await file.arrayBuffer();
  assert.deepEqual([file.status, file.headers.get('x-content-type-options'), file.headers.get('content-security-policy')], [200, 'nosniff', null]);
});

test('Cloudflare: pre-job saves hydrate and award a completed shift once after restart', async t => {
  const f = await fixture(t), a = await f.device('Ada'); await f.life(a);
  let storage = await f.storage();
  const session = JSON.parse((await storage.exec('SELECT value FROM sessions'))[0].value);
  delete session.cities.lagos.state.job; delete session.cities.lagos.state.completedShifts;
  session.cities.lagos.state.homeOwned = true; session.cities.lagos.state.spot = 'work'; session.cities.lagos.updatedAt = 'malformed';
  await storage.exec('UPDATE sessions SET value=? WHERE secret=?', JSON.stringify(session), a.cookie.slice(11));
  assert.equal((await f.life(a)).completedShifts, 0);
  assert.equal((await (await f.action(a, { type: 'apply-job', id: 'community-helper' })).json()).ok, true);
  const shift = { type: 'activity', id: 'helper-shift', actionId: `${Date.now()}:${randomUUID()}` };
  assert.equal((await (await f.action(a, shift)).json()).ok, true);
  const started = JSON.parse((await storage.exec('SELECT value FROM sessions'))[0].value); started.cities.lagos.updatedAt -= 10000;
  await storage.exec('UPDATE sessions SET value=? WHERE secret=?', JSON.stringify(started), a.cookie.slice(11));
  assert.equal((await f.life(a)).completedShifts, 0);
  await f.restart(); storage = await f.storage();
  const halfway = JSON.parse((await storage.exec('SELECT value FROM sessions'))[0].value); halfway.cities.lagos.updatedAt -= 10000;
  await storage.exec('UPDATE sessions SET value=? WHERE secret=?', JSON.stringify(halfway), a.cookie.slice(11));
  const done = await f.life(a); assert.equal(done.cash, 5300); assert.equal(done.completedShifts, 1); assert.equal(done.homeOwned, true);
  assert.equal((await (await f.action(a, shift)).json()).duplicate, true); assert.equal((await f.life(a)).cash, 5300);
});


test('Cloudflare: only two nominated relay testers mint, global budget survives hibernation, errors hide secrets', async t => {
  const publicId = '11111111-1111-4111-8111-111111111111'; let calls = 0; let providerFailure;
  const f = await fixture(t, { sleeps: true, bindings: { TURN_TEST_PUBLIC_IDS: publicId, TURN_KEY_ID: 'a'.repeat(32), TURN_API_TOKEN: 'synthetic-api-secret' }, outboundService: async (request: Request) => {
    calls++; try { assert.equal(new URL(request.url).origin, 'https://rtc.live.cloudflare.com'); assert.deepEqual(await request.json(), { ttl: 600 }); } catch (error) { providerFailure = (error as Error).message; }
    return new Response(JSON.stringify({ iceServers: [{ urls: 'turn:turn.cloudflare.com:3478', username: 'synthetic-user', credential: 'synthetic-short-lived' }] }), { status: 201 });
  } });
  const a = await f.device('Tester'), b = await f.device('Other'); const storage = await f.storage();
  const session = JSON.parse((await storage.exec('SELECT value FROM sessions WHERE secret=?', a.cookie.slice(11)))[0].value); session.publicId = publicId;
  await storage.exec('UPDATE sessions SET public_id=?,value=? WHERE secret=?', publicId, JSON.stringify(session), a.cookie.slice(11));
  assert.equal((await f.request('/api/voice-config', null, a.cookie)).status, 403); assert.equal(calls, 0);
  const x = await f.socket(a), y = await f.socket(b); x.send({ type: 'join', cityId: 'lagos', venueId: 'park' }); await x.next(); y.send({ type: 'join', cityId: 'lagos', venueId: 'park' }); await x.next(); await y.next();
  assert.equal((await (await f.request('/api/voice-config', null, b.cookie)).json()).turnConfigured, false); assert.equal(calls, 0);
  const response = await f.request('/api/voice-config', null, a.cookie); const body = await response.json(); assert.equal(response.status, 200, body.error); assert.equal(providerFailure, undefined); assert.equal(calls, 1); assert.equal(body.turnConfigured, true); assert.equal(JSON.stringify(body).includes('synthetic-api-secret'), false); assert.equal(calls, 1);
  await storage.exec('UPDATE turn_budget SET issued=8'); await f.hibernate();
  const limited = await f.request('/api/voice-config', null, a.cookie); assert.equal(limited.status, 429); assert.equal((await limited.json()).error, 'relay_test_limit'); assert.equal(calls, 1);
});

test('Recovery parity: Node and Worker share onboarding, social, blocking, civic, paid retry and authority refusals', async t=>{
 const {fixture:nodeFixture}=await import('../server/test-fixture.ts');
 const edge=await fixture(t), node=await nodeFixture(t,{now:Date.now});
 /** What both hosts' fixtures offer the shared script (method syntax: the Node fixture takes a narrower cookie and body). */
 interface Driver { device(name: string): Promise<{ id: string; cookie: string }>; request(path: string, body?: object | null, cookie?: string | null): Promise<Response> }
 async function sequence(f: Driver){
   const a=await f.device('Ada'),b=await f.device('Bola'),out=[];
   const call=async(path: string,body?: object | null,who: { cookie: string } | undefined=a)=>{const r=await f.request(path,body,who?.cookie);const data=await r.json();return {status:r.status,...data};};
   for(const who of [a,b])await call('/api/social/me',null,who);
   out.push((await call('/api/social/friends/request',{to:b.id,cityId:'lagos'})).code);
   out.push((await call('/api/social/friends/answer',{from:a.id,accept:true,cityId:'lagos'},b)).code);
   const dm={to:b.id,body:'Hello friend',clientId:'portable-message'};
   const first=await call('/api/social/messages',dm);const retry=await call('/api/social/messages',dm);
   out.push([first.ok,retry.duplicate,first.message?.body]);
   out.push((await call('/api/social/block',{id:b.id,cityId:'lagos'})).code);
   out.push((await call('/api/social/messages',{...dm,clientId:'blocked-message'})).code);
   out.push((await call('/api/social/unblock',{id:b.id})).code);
   const action={actionId:`${Date.now()}:${randomUUID()}`,cityId:'lagos',type:'travel',id:'library',mode:'cab'};
   const paid=await call('/api/action',action),duplicate=await call('/api/action',action);
   out.push([paid.ok,paid.state.cash,duplicate.duplicate,duplicate.state.cash]);
   out.push((await call('/api/action',{...action,id:'park'})).error);
   const naked=await call('/api/action',{...action,actionId:`${Date.now()}:${randomUUID()}`,type:'civic.run'});out.push([naked.ok,naked.code,naked.state.cash]);
   out.push((await call('/api/civic/prefs',{richList:false})).status);
   out.push((await call('/api/civic/radio?city=lagos&venue=../bad')).error);
   out.push((await call('/api/auth/login',{email:'nobody@example.invalid'})).status);
   const created=await f.request('/api/session',{name:'Chidi',onboarding:true});const fresh={cookie:(created.headers.get('set-cookie') as string).split(';')[0] as string} as Device;
   out.push((await call('/api/action',{actionId:`${Date.now()}:${randomUUID()}`,cityId:'lagos',type:'spot',id:'trees'},fresh)).code);
   return out;
 }
 const expected=await sequence(node),actual=await sequence(edge);assert.deepEqual(actual,expected);
 assert.ok(expected.includes('blocked'));assert.ok(expected.includes('requested'));assert.ok(expected.includes('accepted'));assert.ok(expected.includes('onboarding_required'));
 await edge.restart();
});

test('Recovery Worker: SQL receipt failure rolls back debit; feature write failure does not acknowledge friendship',async t=>{
 const f=await fixture(t),a=await f.device('Ada'),b=await f.device('Bola');
 await f.life(a);for(const who of [a,b])assert.equal((await f.request('/api/social/me',null,who.cookie)).status,200);
 const storage=await f.storage();
 await storage.exec("CREATE TRIGGER reject_receipt BEFORE INSERT ON action_receipts BEGIN SELECT RAISE(ABORT,'injected receipt failure'); END");
 const action={actionId:`${Date.now()}:${randomUUID()}`,type:'travel',id:'library',mode:'cab'};
 const failed=await f.action(a,action);assert.equal(failed.status,503);const refusal=await failed.json();assert.equal(refusal.error,'storage_unavailable');assert.match(refusal.reason,/nothing was changed/);assert.ok(!JSON.stringify(refusal).includes('injected'),'the SQL error itself is never sent');assert.equal((await f.life(a)).cash,5000);
 await storage.exec('DROP TRIGGER reject_receipt');
 assert.equal((await (await f.action(a,action)).json()).state.cash,4600);assert.equal((await (await f.action(a,action)).json()).duplicate,true);
 await storage.exec("CREATE TRIGGER reject_feature BEFORE UPDATE ON collections BEGIN SELECT RAISE(ABORT,'injected feature failure'); END");
 const friend=()=>f.request('/api/social/friends/request',{to:b.id,cityId:'lagos'},a.cookie);
 assert.equal((await friend()).status,503);await storage.exec('DROP TRIGGER reject_feature');
 const retry=await (await friend()).json();assert.equal(retry.code,'requested');assert.notEqual(retry.duplicate,true);
 await f.restart();assert.equal((await (await friend()).json()).duplicate,true);assert.equal((await f.life(a)).cash,4600);
});

test('Recovery Worker: committed block changes presence and survives hibernation before signaling',async t=>{
 const f=await fixture(t, { sleeps: true }),a=await f.device('Ada'),b=await f.device('Bola');
 for(const who of [a,b])await f.request('/api/social/me',null,who.cookie);
 const x=await f.socket(a),y=await f.socket(b);
 x.send({type:'join',cityId:'lagos',venueId:'park'});await x.next();y.send({type:'join',cityId:'lagos',venueId:'park'});await x.next();await y.next();
 const response=await f.request('/api/social/block',{id:b.id,cityId:'lagos'},a.cookie);assert.equal((await response.json()).code,'blocked');
 assert.deepEqual((await x.next()).members.map(m=>m.id),[a.id]);assert.deepEqual((await y.next()).members.map(m=>m.id),[b.id]);
 await f.hibernate();x.send({type:'signal',to:b.id,data:{candidate:'synthetic'}});assert.equal((await x.next()).code,'peer_not_in_room');
});

test('Review B1: a new socket never postpones the already scheduled heartbeat',async t=>{
 const f=await fixture(t),a=await f.device('Ada'),b=await f.device('Bola');const x=await f.socket(a),opened=Date.now();
 await new Promise(resolve=>setTimeout(resolve,6000));await f.socket(b);
 await new Promise(resolve=>setTimeout(resolve,5500));
 assert.ok(x.heartbeats.length>=1,'first alarm must run despite the later upgrade');assert.ok((x.heartbeats[0] as number)<opened+11500);
});
test('Review B2: expired rate keys free capacity at their own windows; long windows remain enforced',async t=>{
 const f=await fixture(t),ada=await f.device('Ada');const storage=await f.storage(),now=Date.now();
 // The stored long class, full of rows whose windows are over, and one whose window is not.
 await storage.exec("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<10000) INSERT INTO rate_limits_long(key,started_at,count,expires_at) SELECT 'expired-'||x,?,1,? FROM n",now-7200000,now-1);
 await storage.exec('INSERT INTO rate_limits_long(key,started_at,count,expires_at) VALUES(?,?,?,?)','long-window',now-1000,5,now+86400000);
 // A request that counts against an hour (an e-mail address given by a player with a session) needs a row of its own.
 assert.equal((await f.request('/api/growth/email',{consent:true,email:'ada@example.test'},ada.cookie)).status,200);
 assert.equal((await storage.exec("SELECT COUNT(*) AS count FROM rate_limits_long WHERE key LIKE 'expired-%'"))[0].count,0);
 assert.equal((await storage.exec("SELECT count FROM rate_limits_long WHERE key='long-window'"))[0].count,5);
 assert.ok((await storage.exec("SELECT COUNT(*) AS n FROM rate_limits_long WHERE key LIKE 'growth:%'"))[0].n>=1,'the new long window has its row');
});
test('Review B3: heartbeat acknowledgements hit the frame limiter before session storage reads',async t=>{
 const f=await fixture(t),a=await f.device('Ada'),x=await f.socket(a),storage=await f.storage();
 // A minute's allowance of frames, spent for real; the last one is answered, so its answer says all of them were counted.
 for(let i=0;i<599;i++)x.send({type:'heartbeat-ack'});
 x.send({type:'people-list',cityId:'lagos'});await x.next();
 // If session validation runs first, malformed storage yields an internal error instead.
 await storage.exec('UPDATE sessions SET value=? WHERE secret=?','malformed-json',a.cookie.slice(11));
 x.send({type:'heartbeat-ack'});assert.equal((await x.next()).code,'rate_limited');
});



test('Continuity preparation: old-character bridge is apex-only, safe-method-only and uncached',async t=>{
 const f=await fixture(t);
 const response=await f.atHost('https://joinallworld.com','/old-character.html');assert.equal(response.status,200);
 assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.match(response.headers.get('content-security-policy') as string,/connect-src https:\/\/v1\.joinallworld\.com/);
 assert.match(await response.text(),/Continue with my character/);
 const head=await f.atHost('https://joinallworld.com','/old-character.html','HEAD');assert.equal(head.status,200);assert.equal(await head.text(),'');
 assert.equal((await f.atHost('https://joinallworld.com','/old-character.html','POST')).status,405);
 assert.equal((await f.atHost('https://joinallworld.test','/old-character.html')).status,404);
});

// ---- THE COMBINED GAME ON THE WORKER -----------------------------------------------------------------------------------
// The same journey `npm run new-player` plays against the Node host, over HTTP and WebSockets as the browser drives it:
// quick start → settle in with a local government (a plot is allocated in its shard) → a mission is collected → a share
// link and its preview page → the invite landing → a whole game of Whot over two sockets → the referral pays after real
// work. Then the invitations and the campus, and the operator surface. Time passes for one life at a time (f.skip).

const CITY = 'lagos';
/** What a combined-game test needs on top of the fixture: the calls a browser makes, and patience for one frame type. */
async function combined(t: TestContext, overrides?: Record<string, unknown>) {
  const { viewLife, createLife } = await import('../src/life.ts');
  const { presetLook } = await import('../src/quick-start/look-model.ts');
  const f = await fixture(t, overrides);
  const call = async (path: string, body?: object | null, who?: Device) => { const response = await f.request(path, body, who?.cookie); const data = await response.json(); return { status: response.status, headers: response.headers, ...data }; };
  const get = (path: string, who?: Device) => call(path, null, who), post = (path: string, body: object, who?: Device) => call(path, body, who);
  const life = async (who: Device) => (await get(`/api/life?city=${CITY}`, who)).state;
  const act = (who: Device, type: string, payload?: object) => post('/api/action', { actionId: `${Date.now()}:${randomUUID()}`, cityId: CITY, type, ...(payload ? { payload } : {}) }, who);
  async function ok(who: Device, type: string, payload?: object, code?: string) {
    const result = await act(who, type, payload);
    assert.equal(result.ok, true, `${who.name} ${type} was refused: ${result.status} ${result.error ?? result.code} — ${result.reason ?? ''}`);
    if (code) assert.equal(result.code, code, `${who.name} ${type}`);
    return result.state;
  }
  const view = (state: { t: number }) => viewLife(createLife(state, { now: state.t, cityId: CITY }), { now: state.t, cityId: CITY });
  /** Stand at a spot and run one activity to its end. */
  async function run(who: Device, spot: string, id: string) {
    if ((await life(who)).spot !== spot) await ok(who, 'spot', { id: spot }, 'selected');
    const started = await ok(who, 'activity', { id }, 'started');
    await f.skip(who, started.activeAction.duration * 1000 + 500);
    const state = await life(who);
    assert.equal(state.activeAction, null, `${id} finished`);
    return state;
  }
  /** Travel and wait out the trip; a roadside event on arrival is answered with its last choice (never costs money). */
  async function travel(who: Device, id: string, mode = 'danfo') {
    const started = await ok(who, 'travel', { id, mode }, 'started');
    await f.skip(who, started.activeAction.duration * 1000 + 500);
    let state = await life(who);
    assert.equal(state.location, id, `${who.name} arrived at ${id}`);
    if (state.travel.event) state = await ok(who, 'world.roadside', { choice: (view(state).travel.event as { choices: { id: string }[] }).choices.at(-1)?.id as string }, 'resolved');
    return state;
  }
  /** One paid Community helper shift at Freedom Park: a Lagos day of paid work. */
  async function paidWork(who: Device) {
    if ((await life(who)).location !== 'park') await travel(who, 'park', 'trek');
    if (!(await life(who)).job) await ok(who, 'apply-job', { id: 'community-helper' }, 'applied');
    for (let rests = 0; rests < 8 && (await life(who)).needs.energy < 30; rests++) await run(who, 'trees', 'chill');
    return run(who, 'work', 'helper-shift');
  }
  /** What the landing does when Play is tapped: a session for the name, then the look, confirmed exactly once. */
  async function play(name: string, { preset = 'owambe', joining = false, device }: { preset?: string; joining?: boolean; device?: string } = {}) {
    const opened = await f.request('/api/session', { name, onboarding: true });
    assert.equal(opened.status, 200);
    const who = { name, cookie: (opened.headers.get('set-cookie') as string).split(';')[0] as string, id: (await opened.json()).session.id, device };
    const held = await life(who);
    assert.deepEqual([held.onboarding.stage, held.onboarding.required, held.location], ['guest', true, 'park']);
    assert.equal((await act(who, 'spot', { id: 'trees' })).code, 'onboarding_required', 'nothing can be done before Play');
    const request = { actionId: `${Date.now()}:${randomUUID()}`, cityId: CITY, type: 'onboarding.quick-start', payload: { look: presetLook(preset), ...(joining ? { joining: true } : {}) } };
    const first = await post('/api/action', request, who), again = await post('/api/action', request, who);
    assert.deepEqual([first.code, again.code, again.duplicate], ['playing', 'playing', true], 'a double tap on Play is one start');
    assert.equal((await get('/api/social/me', who)).me.name, name);
    return { who, state: first.state };
  }
  async function settle(who: Device, lga: string) {
    await ok(who, 'onboarding.traits', { traits: ['smooth-talker', 'clean-pikin'] }, 'traits_saved');
    await ok(who, 'onboarding.dream', { dream: 'everybodys-padi' }, 'dream_saved');
    await ok(who, 'onboarding.lottery', {}, 'rolled');
    return ok(who, 'onboarding.home', { lga, via: 'manual' }, 'life_started');
  }
  /** A socket with the frames it has received by type; `until(type)` waits for the next one of that type. */
  async function peer(who: Device): Promise<Peer> {
    const socket = await f.socket(who), seen: Frame[] = [];
    const until = async (type: string, tries = 40): Promise<Frame> => { for (let i = 0; i < tries; i++) { const message = await socket.next(); seen.push(message); if (message.type === type) return message; } throw Error(`No ${type} frame`); };
    return { who, send: socket.send, next: socket.next, until, seen, state: null as unknown as TableState };
  }
  const reasons = (state: { ledger: { reason: string; amount: number }[] }, prefix: string) => state.ledger.filter(line => line.reason.startsWith(prefix)).map(line => line.amount);
  return { ...f, call, get, post, life, act, ok, view, run, travel, paidWork, play, settle, peer, reasons, hello: (who: Device) => post('/api/growth/hello', { cityId: CITY, device: who.device }, who) };
}

test('Combined game on the Worker: quick start, settle in with a plot, a mission, a share page, the invite landing, Whot over two sockets, the referral', async t => {
  const { REFERRAL, TABLE_REWARDS } = await import('../src/game/content/growth.ts');
  const { MISSION_REWARDS } = await import('../src/game/content/missions.ts');
  const { NPCS } = await import('../src/game/cities/lagos/regulars.ts');
  const { joinIdFrom, linkParts } = await import('../src/quick-start/model.ts');
  const f = await combined(t, { bindings: { BUILD_ID: 'local-conformance', PUBLIC_ORIGIN: 'https://play.example' } });
  const LGA = 'ikeja', TABLE = 'buka-corner', ORIGIN = 'https://play.example';

  // 1. landing → Play: a guest in the park, with no missions, no house, in no directory.
  const { who: ada, state: arrived } = await f.play('Ada', { device: 'device-ada-0000000001' });
  assert.deepEqual([arrived.location, arrived.spot, arrived.onboarding.stage, arrived.onboarding.required, arrived.cash], ['park', 'trees', 'guest', false, 5000]);
  assert.deepEqual([(await f.get(`/api/world/me?city=${CITY}`, ada)).placed, f.view(arrived).missions.daily.length], [false, 0]);
  assert.equal((await f.act(ada, 'estate.set-lga', { lga: LGA })).code, 'settle_required');
  assert.equal((await f.act(ada, 'unilag.apply', { programme: 'computer' })).code, 'settle_required', 'a guest cannot enrol before settling in');
  let state = await f.run(ada, 'trees', 'play-ayo');
  assert.deepEqual([state.goals.chain, state.cash], [1, 5500], 'the first goal pays');
  state = await f.run(ada, 'people', `npc-${(Object.values(NPCS).find(npc => npc.venue === 'park') as { id: string }).id}-hello`);

  // 2. settle in with a local government: the free starter house, on a plot the server sets aside in that shard.
  state = await f.settle(ada, LGA);
  assert.deepEqual([state.location, state.onboarding.stage, state.estate.lga, state.estate.living, state.economy.rent.house], ['home', 'settled', LGA, 'own', null]);
  const mine = await f.get(`/api/world/me?city=${CITY}`, ada);
  assert.deepEqual([mine.placed, mine.lga, mine.plot?.lga], [true, LGA, LGA]);
  state = await f.life(ada);
  assert.deepEqual(state.estate.plot, mine.plot, 'the plot is recorded in her life');
  const houses = await f.get(`/api/world/lga/${LGA}/estate/${mine.plot.estate}/houses?city=${CITY}`, ada);
  assert.ok(houses.houses.some((house: { id: string; you: boolean; p: number }) => house.id === ada.id && house.you === true && house.p === mine.plot.plot), 'her house is in that estate’s listing');
  const area = await f.get(`/api/world/lga/${LGA}?city=${CITY}`, ada);
  assert.deepEqual([area.yours, area.residents, area.houses], [true, 1, 1]);
  assert.deepEqual((await f.get(`/api/world/lga/${LGA}/people?city=${CITY}`, ada)).items.map((item: { id: string; home: string }) => [item.id, item.home]), [[ada.id, 'own']]);
  // The shard is rows of one name; no other local government was read or written.
  const shards = await (await f.storage()).exec('SELECT name, COUNT(*) AS n FROM world_shards GROUP BY name');
  assert.deepEqual(shards.map(row => row.name), [`${CITY}.${LGA}`]);

  // 3. missions were dealt when she settled in: one is finished and collected, once.
  let missions = f.view(state).missions;
  assert.deepEqual([missions.locked, missions.daily.length], [null, 3]);
  const recipes = {
    'd-meal': () => f.run(ada, 'kitchen', 'home-soak-garri'), 'd-fresh': () => f.run(ada, 'bathroom', 'bath'),
    'd-fun': async () => { await f.travel(ada, 'park'); return f.run(ada, 'trees', 'play-ayo'); }, 'd-paid': () => f.paidWork(ada),
    'd-two-places': async () => { await f.travel(ada, 'park'); return f.travel(ada, 'amala-shitta'); }, 'd-new-place': () => f.travel(ada, 'amala-shitta'),
    'd-train': async () => { await f.travel(ada, 'park'); await f.run(ada, 'art', 'park-shoot-sculptures'); return f.run(ada, 'art', 'park-shoot-sculptures'); },
    'd-gist': async () => { await f.travel(ada, 'park'); for (let i = 0; i < 3; i++) await f.run(ada, 'trees', 'play-ayo'); return f.life(ada); },
    'd-greet': async () => { await f.travel(ada, 'park'); for (const npc of f.view(await f.life(ada)).social.here.slice(0, 2)) await f.run(ada, 'people', `npc-${npc.id}-hello`); return f.life(ada); },
  };
  // Every mission the dealer can deal to a life with no job and no event today is covered: the three kinds are dealt one each,
  // and the life kind (d-meal, d-fresh, d-fun, d-paid, d-train) always has a recipe; d-shift is never dealt without a job.
  // d-train and d-gist have recipes too, so no deal can leave the test with nothing to do.
  const chosen = missions.daily.find(mission => mission.done && !mission.claimed) ?? missions.daily.find(mission => Object.hasOwn(recipes, mission.id));
  assert.ok(chosen, `one of today’s missions can be done: ${missions.daily.map(mission => mission.id).join(', ')}`);
  if (!chosen.done) await (recipes as Record<string, () => Promise<unknown>>)[chosen.id]?.();
  const purse = (await f.life(ada)).cash, claimed = await f.act(ada, 'missions.claim', { id: chosen.id });
  assert.deepEqual([claimed.code, claimed.state.cash], ['claimed', purse + MISSION_REWARDS.daily.cash]);
  assert.equal((await f.act(ada, 'missions.claim', { id: chosen.id })).code, 'already_claimed', 'a mission pays once');

  // 4. to the buka; a share link that invites a friend to the Whot table there, and its preview page.
  if ((await f.life(ada)).location !== 'amala-shitta') await f.travel(ada, 'amala-shitta');
  const adaSocket = await f.peer(ada);
  adaSocket.send({ type: 'join', cityId: CITY, venueId: 'amala-shitta' }); await adaSocket.until('presence');
  assert.equal((await f.hello(ada)).ok, true);
  const shared = await f.post('/api/growth/share', { cityId: CITY, kind: 'table', table: TABLE }, ada);
  assert.deepEqual([shared.ok, shared.code, shared.share.path], [true, 'shared', `/s/${shared.share.code}`]);
  const code = shared.share.code;
  assert.equal((await f.post('/api/growth/share', { cityId: CITY, kind: 'table', table: TABLE }, ada)).share.code, code, 'the same card twice is the same link');
  const page = await f.fetch(`/s/${code}`, { redirect: 'manual' }), html = await page.text();
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('set-cookie'), null, 'the preview page sets no cookie');
  assert.match(page.headers.get('content-security-policy') as string, /default-src 'none'/);
  assert.deepEqual([page.headers.get('x-frame-options'), page.headers.get('x-content-type-options'), page.headers.get('referrer-policy')], ['DENY', 'nosniff', 'no-referrer']);
  assert.ok(!/<script/i.test(html) && !/\son[a-z]+=/i.test(html), 'no script and no inline handler: a crawler that runs nothing sees everything');
  const meta = (key: string) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`).exec(html)?.[1];
  assert.match(meta('og:title') as string, /Ada/); assert.match(meta('og:title') as string, /Whot/);
  assert.deepEqual([meta('og:type'), meta('og:site_name'), meta('og:url'), meta('og:image'), meta('twitter:card'), meta('twitter:image')],
    ['website', 'Allworld', `${ORIGIN}/s/${code}`, `${ORIGIN}/og/allworld.png`, 'summary_large_image', `${ORIGIN}/og/allworld.png`]);
  const target = (/<meta http-equiv="refresh" content="0;url=([^"]+)"/.exec(html) as RegExpExecArray)[1]?.replaceAll('&amp;', '&');
  assert.equal(target, `/?join=${ada.id}&ref=${code}&table=${TABLE}`);
  assert.equal((await f.fetch(`/s/${code}`, { method: 'HEAD' })).status, 200);
  // A code nobody made is still the module's page — the same 404 page, under the same headers, as on Node.
  const none = await f.fetch('/s/zzzzzzzz'); assert.equal(none.status, 404); assert.match(none.headers.get('content-security-policy') as string, /default-src 'none'/); assert.ok(!/<script/i.test(await none.text()));
  // A house link (/v/<public id>) is the game's own page: the landing reads the id from the address.
  const houseLink = await f.fetch(`/v/${ada.id}`); assert.equal(houseLink.status, 200); assert.match(await houseLink.text(), /<title>Allworld/);
  assert.equal(joinIdFrom(`/v/${ada.id}`, ''), ada.id);
  // The game's own page, as a crawler receives it from the Worker: the default preview image is absolute.
  const home = await (await f.fetch('/')).text();
  assert.match(home, /<meta property="og:image" content="https:\/\/play\.example\/og\/allworld\.png"/);
  assert.equal((await f.fetch('/og/allworld.png')).status, 200);
  const headOf = (name: string) => new RegExp(`<(?:meta|link) (?:(?:property|name|rel)="${name}") (?:content|href)="([^"]*)"`).exec(home)?.[1];
  assert.equal(headOf('canonical'), `${ORIGIN}/`); assert.equal(headOf('og:url'), `${ORIGIN}/`); assert.equal(headOf('og:image'), `${ORIGIN}/og/allworld.png`); assert.equal(headOf('twitter:image'), `${ORIGIN}/og/allworld.png`);
  assert.ok(/<title>[^<]{1,60}<\/title>/.test(home) && (headOf('description') ?? '').length <= 155 && headOf('robots') === 'index,follow' && !home.includes('joinallworld.com'));
  const ld = [...home.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)].flatMap(m => JSON.parse(m[1] as string) as { '@type': string; url: string }[]);
  assert.deepEqual(ld.map(item => item['@type']), ['VideoGame', 'WebSite']); assert.ok(ld.every(item => item.url === `${ORIGIN}/`));
  const robots = await f.fetch('/robots.txt'), sitemap = await f.fetch('/sitemap.xml');
  assert.deepEqual([robots.status, sitemap.status], [200, 200]);
  assert.match(robots.headers.get('content-type') as string, /^text\/plain/); assert.equal(sitemap.headers.get('content-type'), 'application/xml; charset=utf-8');
  assert.match(await robots.text(), /Disallow: \/api\/[\s\S]*Sitemap: /);
  // The sitemap and the manifest are made by code on this host (server/site-files.ts), not served as assets; the sitemap names the public origin.
  assert.equal(await sitemap.text(), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${ORIGIN}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n</urlset>\n`);
  const manifest = await f.fetch('/manifest.webmanifest');
  assert.deepEqual([manifest.status, manifest.headers.get('content-type'), manifest.headers.get('x-content-type-options')], [200, 'application/manifest+json', 'nosniff']);
  assert.deepEqual(Object.keys(JSON.parse(await manifest.text()) as object).slice(0, 3), ['name', 'short_name', 'description']);
  const head = await f.fetch('/sitemap.xml', { method: 'HEAD' });
  assert.deepEqual([head.status, head.headers.get('content-type'), await head.text()], [200, 'application/xml; charset=utf-8', '']);
  assert.equal((await f.fetch('/sitemap.xml', { method: 'POST' })).status, 405);
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/); assert.match(html, new RegExp(`<link rel="canonical" href="${ORIGIN}/s/${code}">`)); assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');
  // The landing reads the link with the same pure functions the browser runs.
  const url = new URL(target, ORIGIN), link = { join: joinIdFrom(url.pathname, url.search), ...linkParts(url.pathname, url.search) };
  assert.deepEqual(link, { join: ada.id, ref: code, table: TABLE });

  // 5. the invite landing: Bola taps Play and lands in the buka beside Ada, with the referral attached and nothing paid.
  const { who: bola, state: fresh } = await f.play('Bola', { preset: 'street', joining: true, device: 'device-bola-000000002' });
  assert.deepEqual([fresh.location, fresh.message], ['park', ''], 'the quick start holds back its welcome: the banner says it');
  const linked = await f.post('/api/growth/referral/link', { cityId: CITY, code: link.ref, device: bola.device }, bola);
  assert.deepEqual([linked.ok, linked.code, linked.by], [true, 'linked', 'Ada']);
  const answer = await f.post('/api/social/join', { host: link.join, cityId: CITY }, bola);
  assert.deepEqual([answer.ok, answer.code, answer.venue, answer.host?.name], [true, 'joined', 'amala-shitta', 'Ada'], JSON.stringify(answer));
  let bolaState = await f.life(bola);
  assert.deepEqual([bolaState.location, bolaState.onboarding.joined, bolaState.onboarding.stage, bolaState.cash], ['amala-shitta', true, 'guest', 5000]);
  const bolaSocket = await f.peer(bola);
  bolaSocket.send({ type: 'join', cityId: CITY, venueId: 'amala-shitta' });
  assert.deepEqual((await bolaSocket.until('presence')).members.map(member => member.name).sort(), ['Ada', 'Bola'], 'the two of them are in the same room');
  assert.equal((await f.post('/api/social/join', { host: link.join, cityId: CITY }, bola)).code, 'here', 'asking again changes nothing');

  // 6. the table the link named: a whole game of Whot, one human against the other, over their own sockets.
  const peers = [adaSocket, bolaSocket];
  // A socket's messages are handled in order, so the answer to a `table-list` sent after a request marks the point
  // where everything before it has been handled: each peer keeps the last table-state it was sent up to that point.
  const settled = async (one: Peer) => { one.send({ type: 'table-list', cityId: CITY }); for (let i = 0; i < 60; i++) { const message = await one.next(); one.seen.push(message); if (message.type === 'table-state') one.state = message as unknown as TableState; if (message.type === 'error') assert.fail(`${one.who.name}: ${message.code} ${message.reason ?? ''}`); if (message.type === 'tables') return; } throw Error('No answer to table-list'); };
  const tell = async (peer: Peer, type: string, body: object = {}) => { peer.send({ type, cityId: CITY, table: TABLE, ...body }); await settled(peer); for (const one of peers) if (one !== peer) await settled(one); };
  await tell(adaSocket, 'table-sit');
  await tell(bolaSocket, 'table-sit');
  await tell(adaSocket, 'table-start');
  assert.deepEqual([adaSocket.state.table.status, adaSocket.state.table.seats.map(seat => [seat.name, Boolean(seat.bot)]), adaSocket.state.you, bolaSocket.state.you], ['playing', [['Ada', false], ['Bola', false]], 0, 1]);
  assert.deepEqual([adaSocket.state.view.hand.length, bolaSocket.state.view.hand.length], [5, 5]);
  const choose = (table: TableState['view']) => (table.playable.length ? { t: 'play', i: table.playable[0] as number, ...(table.hand[table.playable[0] as number]?.s === 'whot' ? { shape: 'circle' } : {}) } : { t: 'draw' });
  let moves = 0;
  while (adaSocket.state.table.status === 'playing') {
    const mover = peers.find(one => one.state.toMove.includes(one.state.you));
    assert.ok(mover && moves < 2000, 'someone seated is to move');
    await tell(mover, 'table-move', { n: mover.state.n, move: choose(mover.state.view) });
    moves += 1;
  }
  const result = adaSocket.state.result;
  assert.deepEqual([adaSocket.state.table.status, result.calledOff, typeof result.text], ['over', false, 'string']);
  // No socket was ever sent the other player's hand, the market's order or the seed.
  assert.equal(peers.some(one => one.seen.some(message => /"hands"|"market":\[|"seed"/.test(JSON.stringify(message)))), false);
  const winner = result.winners.length ? peers[result.winners[0] as number] : null;
  for (const one of peers) {
    const before = (await f.life(one.who)).cash, paid = await f.post('/api/growth/tables/claim', { cityId: CITY }, one.who), won = one === winner;
    assert.deepEqual(paid.results.map((item: { game: string; won: boolean; code: string }) => [item.game, item.won, item.code]), [['whot', won, won ? 'paid' : 'counted']]);
    assert.equal((await f.life(one.who)).cash - before, won ? TABLE_REWARDS.win : 0);
    assert.deepEqual((await f.post('/api/growth/tables/claim', { cityId: CITY }, one.who)).results, [], 'and it is applied once');
  }

  // 7. the referral pays both sides — only after real work on real Lagos days, and once each.
  const gifts = async () => ({ welcome: f.reasons(await f.life(bola), 'Welcome gift'), reward: f.reasons(await f.life(ada), 'Referral reward') });
  await f.hello(bola); await f.hello(ada);
  assert.deepEqual(await gifts(), { welcome: [], reward: [] }, 'playing a game together pays no referral');
  bolaState = await f.paidWork(bola);
  assert.equal(bolaState.civic.work.days, 1);
  await f.hello(bola); await f.hello(ada);
  assert.deepEqual(await gifts(), { welcome: [REFERRAL.welcome], reward: [] }, 'his welcome gift after his first paid day; her reward still waits');
  // The next Lagos day (and the shift's cooldown behind him): a second day of paid work, and the referral counts.
  await f.nextDay(bola); await f.skip(bola, 5 * 3600000);
  await f.paidWork(bola);
  assert.equal((await f.life(bola)).civic.work.days, REFERRAL.countWorkDays);
  await f.hello(bola);
  assert.deepEqual((await gifts()).reward, [], 'counted, and owed to Ada until she is here');
  const adaBefore = await f.life(ada), told = await f.hello(ada), adaAfter = await f.life(ada);
  assert.deepEqual([told.referral.counted, told.referral.invited.map((friend: { name: string; state: string }) => [friend.name, friend.state])], [1, [['Bola', 'counted']]]);
  assert.deepEqual([adaAfter.cash - adaBefore.cash, adaAfter.goals.stars - adaBefore.goals.stars], [REFERRAL.reward, REFERRAL.rewardStars]);
  for (let i = 0; i < 2; i++) { await f.hello(bola); await f.hello(ada); }
  assert.deepEqual([(await gifts()).welcome.length, (await gifts()).reward.length], [1, 1]);

  // 8. the object restarted on the same storage: lives, the plot and the receipts read back; nothing is paid again.
  const kept = { plot: (await f.get(`/api/world/me?city=${CITY}`, ada)).plot, ada: (await f.life(ada)).cash, bola: (await f.life(bola)).cash };
  await f.restart();
  assert.deepEqual([(await f.get(`/api/world/me?city=${CITY}`, ada)).plot, (await f.life(ada)).cash, (await f.life(bola)).cash], [kept.plot, kept.ada, kept.bola]);
  assert.deepEqual([(await f.get(`/api/world/lga/${LGA}?city=${CITY}`, ada)).residents, (await f.get(`/api/world/me?city=${CITY}`, bola)).placed], [1, false]);
  await f.hello(ada); await f.hello(bola);
  assert.deepEqual([(await gifts()).welcome.length, (await gifts()).reward.length], [1, 1], 'nothing is paid again after a restart');
  const replayed = await f.post('/api/growth/referral/link', { cityId: CITY, code, device: bola.device }, bola);
  assert.deepEqual([replayed.code, replayed.duplicate], ['linked', true], 'the same link again is the same link');
  // Nothing stored for others carries a cookie secret, a device token or an address.
  const stored = JSON.stringify(await (await f.storage()).exec("SELECT value FROM collections UNION ALL SELECT value FROM collection_parts UNION ALL SELECT text FROM world_shards"));
  for (const who of [ada, bola]) assert.ok(!stored.includes(who.cookie.slice(11)), `${who.name}’s cookie secret is in no collection or shard`);
  assert.ok(!stored.includes('device-bola') && !stored.includes('device-ada'), 'a device token is stored only as a salted hash');
});

test('Invitations on the Worker: house link, friend request, first DM, knock and let-in — over sockets, across a sleep', async t => {
  const f = await combined(t, { sleeps: true });
  const { who: ada } = await f.play('Ada'), { who: bola } = await f.play('Bola', { preset: 'street' });
  await f.settle(ada, 'ikeja');
  const me = await f.get('/api/social/me', ada);
  assert.equal(me.invitePath, `/v/${ada.id}`, 'the house link Phone → Invite shows');
  const a = await f.peer(ada), b = await f.peer(bola);

  // A friend request over the socket; the answer over HTTP; both are told on their sockets.
  b.send({ type: 'friend-request', to: ada.id, cityId: CITY });
  assert.deepEqual([(await b.until('friend-result')).code, ((await a.until('friend-request')).from as unknown as { name: string }).name], ['requested', 'Bola']);
  assert.equal((await f.post('/api/social/friends/answer', { from: bola.id, accept: true, cityId: CITY }, ada)).code, 'accepted');
  assert.equal((await b.until('friend-accepted')).by.name, 'Ada');

  // The first message of a conversation: the frame names who it is WITH, which is what lets an open new chat adopt it
  // (src/ui/panels/social-client.js). A retry of the same client id is stored once and delivered once.
  const dm = { to: bola.id, body: 'Come and see my place', clientId: `${Date.now()}:${randomUUID()}` };
  const sent = await f.post('/api/social/messages', dm, ada), again = await f.post('/api/social/messages', dm, ada);
  assert.deepEqual([sent.code, again.duplicate, again.message.seq], ['sent', true, sent.message.seq]);
  const first = await b.until('dm');
  assert.deepEqual([first.conv.with, first.conv.id, first.message.body, first.message.from.id], [ada.id, sent.conv.id, 'Come and see my place', ada.id]);

  // The object sleeps with both sockets connected: presence and the conversation are still there when it wakes.
  await f.hibernate();
  b.send({ type: 'dm-send', conv: sent.conv.id, body: 'On my way!', clientId: `${Date.now()}:${randomUUID()}` });
  assert.equal((await b.until('dm-sent')).message.body, 'On my way!');
  let reply = await a.until('dm'); while (reply.message.body !== 'On my way!') reply = await a.until('dm'); // her own first message is echoed to her sockets too
  assert.deepEqual([reply.message.from.id, reply.conv.id], [bola.id, sent.conv.id]);
  assert.deepEqual((await f.get(`/api/social/conversations/${sent.conv.id}`, bola)).messages.map((message: { body: string }) => message.body), ['Come and see my place', 'On my way!']);

  // A house visit: a friend is not a guest; knock → let in → the host's Home room → the visit ends.
  b.send({ type: 'join', cityId: CITY, venueId: 'home', hostId: ada.id });
  assert.equal((await b.until('error')).code, 'not_a_guest');
  a.send({ type: 'join', cityId: CITY, venueId: 'home' }); await a.until('presence');
  assert.equal((await f.post('/api/social/house/knock', { host: ada.id, cityId: CITY }, bola)).code, 'knocking');
  assert.deepEqual((await a.until('invite-knock')).from, { id: bola.id, name: 'Bola' });
  assert.equal((await f.post('/api/social/house/answer', { visitor: bola.id, answer: 'accept' }, ada)).code, 'accepted');
  assert.equal((await b.until('invite-answer')).answer, 'accepted');
  b.send({ type: 'join', cityId: CITY, venueId: 'home', hostId: ada.id });
  const inside = await b.until('presence');
  assert.deepEqual(inside.members.map(member => member.name).sort(), ['Ada', 'Bola']);
  assert.ok(inside.members.every(member => member.enabled === false && member.muted === true), 'a house visit does not turn voice on');
  // Asleep and awake again: the guest is still in the host's room, and house chat still reaches both.
  await f.hibernate();
  b.send({ type: 'chat', body: 'Nice place!', clientId: 'house-1' });
  assert.deepEqual([(await a.until('chat')).body, ((await b.until('chat')).from as unknown as { name: string }).name], ['Nice place!', 'Bola']);
  assert.equal((await f.post('/api/social/house/leave', { host: ada.id }, bola)).code, 'left');
  assert.equal((await b.until('error')).code, 'visit_ended');
  b.send({ type: 'join', cityId: CITY, venueId: 'home', hostId: ada.id });
  assert.equal((await b.until('error')).code, 'not_a_guest');
  // The secret of neither player was ever sent to the other.
  for (const [mine, theirs] of [[a, bola], [b, ada]] as [Peer, Device][]) assert.ok(!JSON.stringify(mine.seen).includes(theirs.cookie.slice(11)));
});

test('UNILAG on the Worker: a visitor walks the campus, rides the shuttle once, and only a settled life may enrol', async t => {
  const f = await combined(t, { sleeps: true });
  const { who: ada } = await f.play('Ada'), { who: guest } = await f.play('Guest', { preset: 'street' });
  await f.settle(ada, 'lagos-mainland');
  // The campus is a Lagos venue on the mainland; a guest may visit but not become a student.
  await f.travel(guest, 'unilag'); await f.travel(ada, 'unilag');
  assert.equal((await f.act(guest, 'unilag.apply', { programme: 'computer' })).code, 'settle_required');
  assert.notEqual((await f.act(ada, 'unilag.apply', { programme: 'computer' })).code, 'settle_required');
  assert.equal((await f.ok(ada, 'unilag.trail.visit', {}, 'trail_visited')).unilagCommunity.trail.length, 1);
  // Campus positions: a join starts at the main gate; a walkable point is relayed in campus coordinates, the lagoon is refused.
  const a = await f.peer(ada), g = await f.peer(guest);
  a.send({ type: 'join', cityId: CITY, venueId: 'unilag' });
  assert.deepEqual((await a.until('presence')).members[0].position, { x: -286, z: -112 });
  g.send({ type: 'join', cityId: CITY, venueId: 'unilag' }); await g.until('presence'); await a.until('presence');
  a.send({ type: 'move', x: 120, z: -160 });
  assert.deepEqual((await g.until('presence')).members.find(member => member.id === ada.id)?.position, { x: 120, z: -160 });
  a.send({ type: 'move', x: 360, z: 0 });
  assert.equal((await a.until('error')).code, 'invalid_position');
  await f.hibernate();
  g.send({ type: 'move', x: -280, z: -110 });
  let after = await a.until('presence'); while (after.members.find(member => member.id === guest.id)?.position.x !== -280) after = await a.until('presence');
  assert.deepEqual(after.members.map(member => [member.name, member.position]).sort(), [['Ada', { x: 120, z: -160 }], ['Guest', { x: -280, z: -110 }]], 'positions survive the sleep');
  // The shuttle: one fare for one action id, and the ride ends at the stop it was bought for.
  const fare = { actionId: `${Date.now()}:${randomUUID()}`, cityId: CITY, type: 'campus-shuttle', payload: { destination: 'senate' } };
  const before = (await f.life(ada)).cash, ride = await f.post('/api/action', fare, ada), replay = await f.post('/api/action', fare, ada);
  assert.deepEqual([ride.code, ride.state.cash, replay.duplicate, replay.state.cash], ['started', before - 50, true, before - 50]);
  // The shuttle is a ride inside the venue (the timed action declares moves: false): the rider stays in the campus room.
  assert.equal(ride.state.location, 'unilag');
  await f.skip(ada, ride.state.activeAction.duration * 1000 + 500);
  const arrived = await f.life(ada);
  assert.deepEqual([arrived.activeAction, arrived.spot, arrived.cash, arrived.unilagShuttle.rides], [null, 'senate', before - 50, 1]);
  // The shared campus view, and the ballot: identity comes from the stored life, and the public action route cannot vote.
  const shared = await f.get(`/api/campus?city=${CITY}`, ada);
  assert.deepEqual([shared.available, shared.city, Array.isArray(shared.election.candidates), shared.goal.target], [true, CITY, true, 200]);
  assert.equal((await f.get('/api/campus?city=ibadan', ada)).available, false);
  assert.deepEqual([(await f.act(ada, 'unilag.election.vote', { candidate: ada.id })).code, (await f.act(ada, 'unilag.election.nominate', {})).code], ['server_only', 'server_only']);
  const ballot = await f.post('/api/campus/vote', { cityId: CITY, actionId: `${Date.now()}:${randomUUID()}`, candidateId: guest.id, studentId: 'ULG-0000-000000', name: 'Forged' }, guest);
  assert.notEqual(ballot.ok, true, 'a guest has no ballot');
  assert.equal((await (await f.storage()).exec("SELECT COUNT(*) AS n FROM collections WHERE name = 'campus'"))[0].n, 0, 'a refused ballot stored nothing');
});

test('Worker host surface: operator routes are off without the token and bearer-only with it; keys, pages and outside requests fail closed', async t => {
  // Without MODERATOR_TOKEN there is no operator surface at all.
  const plain = await combined(t);
  for (const path of ['/api/mod/overview', '/api/mod/growth/metrics']) assert.equal((await plain.fetch(path, { headers: { authorization: 'Bearer anything-at-all-anything-at-all' } })).status, 404);
  const health = await plain.get('/api/health');
  assert.deepEqual([health.ok, health.transport, health.build, health.buildId], [true, 'cloudflare', 'local-conformance', 'local-conformance']);
  // Telemetry is off unless configured, and says so without creating a session.
  const config = await plain.fetch('/api/telemetry/config', { headers: { origin: plain.origin } });
  assert.deepEqual([(await config.json()).enabled, config.headers.get('set-cookie')], [false, null]);
  // The push key is made once and kept in the object's own storage: the same after a restart, and never in a collection.
  const { who: ada } = await plain.play('Ada');
  const key = (await plain.get('/api/growth/push/key', ada)).publicKey;
  assert.match(key, /^[A-Za-z0-9_-]{80,100}$/);
  await plain.restart();
  assert.equal((await plain.get('/api/growth/push/key', ada)).publicKey, key);
  const db = await plain.storage();
  assert.deepEqual((await db.exec('SELECT name FROM host_keys ORDER BY name')).map(row => row.name), ['vapid']);
  assert.ok(!JSON.stringify(await db.exec('SELECT value FROM collections')).includes(key), 'key material is not in the game’s collections');
  // An e-mail page is served by the object with the host's fixed headers; a bad token is one answer for every kind of bad link.
  const confirm = await plain.fetch('/e/confirm?t=not-a-token');
  assert.deepEqual([confirm.status, confirm.headers.get('x-frame-options'), confirm.headers.get('cache-control')], [200, 'DENY', 'no-store']);
  const posted = await plain.fetch('/e/confirm?t=not-a-token', { method: 'POST' });
  assert.equal(posted.status, 400); assert.ok(!/<script/i.test(await posted.text()));
  assert.equal(confirm.headers.get('x-robots-tag'), 'noindex, nofollow'); assert.match(await confirm.text(), /<meta name="robots" content="noindex, nofollow">/);
  assert.equal((await plain.fetch('/assets/nothing', { method: 'POST' })).status, 405, 'no other path outside /api/ takes a POST');
  // A problem report: exactly once for its client id.
  const report = { cityId: CITY, category: 'bug', text: 'The danfo did not stop.', clientId: `${Date.now()}:${randomUUID()}` };
  const filed = await plain.post('/api/support/reports', report, ada), refiled = await plain.post('/api/support/reports', report, ada);
  assert.deepEqual([filed.status, refiled.status, refiled.duplicate], [200, 200, true], JSON.stringify(filed));

  // With the token: no Origin needed (a bearer header is never sent by a browser on its own), a wrong token is refused,
  // and the token is in no response.
  const token = 'worker-operator-token-0123456789-abcdef';
  const f = await combined(t, { bindings: { BUILD_ID: 'local-conformance', MODERATOR_TOKEN: token } });
  assert.equal((await f.fetch('/api/mod/overview')).status, 401);
  assert.equal((await f.fetch('/api/mod/overview', { headers: { authorization: `Bearer ${token.slice(0, -1)}x` } })).status, 401);
  assert.equal((await f.fetch('/api/mod/overview', { headers: { cookie: `sid=${token}` } })).status, 401, 'never a cookie');
  const overview = await f.fetch('/api/mod/overview', { headers: { authorization: `Bearer ${token}` } }), body = await overview.text();
  assert.equal(overview.status, 200); assert.ok(!body.includes(token));
  const metrics = await f.fetch('/api/mod/growth/metrics', { headers: { authorization: `Bearer ${token}` } });
  assert.equal(metrics.status, 200);
  // Every other route still needs the page's own origin.
  assert.equal((await f.fetch('/api/session', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.test' }, body: JSON.stringify({ name: 'Mallory' }) })).status, 403);
});

test('assets: a missing hashed file is a 404 (never index.html); a real one is immutable; a deep link is still the page', async t => {
  const dist = await mkdtemp(join(tmpdir(), 'joinallworld-dist-'));
  t.after(() => rm(dist, { recursive: true, force: true }));
  await mkdir(join(dist, 'assets'));
  await writeFile(join(dist, 'index.html'), '<!doctype html><head></head><body>game</body>');
  await writeFile(join(dist, 'assets', 'app-abc123.js'), 'console.log(1)');
  const f = await fixture(t, { assets: { directory: dist, binding: 'ASSETS', run_worker_first: true, routerConfig: { has_user_worker: true }, assetConfig: { not_found_handling: 'single-page-application' } } });
  const missing = await f.fetch('/assets/x-123.js');
  assert.deepEqual([missing.status, missing.headers.get('content-type'), missing.headers.get('cache-control')], [404, 'text/plain; charset=utf-8', 'no-store']);
  assert.ok(!(await missing.text()).includes('<'));
  const real = await f.fetch('/assets/app-abc123.js');
  assert.equal(real.status, 200); assert.match(real.headers.get('content-type') as string, /javascript/); assert.equal(real.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  const deep = await f.fetch('/some/deep/link');
  assert.equal(deep.status, 200); assert.match(deep.headers.get('content-type') as string, /text\/html/); assert.equal(deep.headers.get('cache-control'), 'no-cache');
  assert.ok((await deep.text()).includes('game'));
});

// ---- accounts (server/routes/auth.ts) on the Worker: the same routes over the SQLite tables ----
const ACCOUNT_PROJECT = 'allworld-edge-project';
/** The 64 characters of base64url, in value order. */
const EDGE_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** Placeholders in the shape of the provider's public configuration; none of them names anything real. */
const ACCOUNT_BINDINGS = { BUILD_ID: 'local-conformance', ACCOUNTS_FIREBASE_PROJECT_ID: ACCOUNT_PROJECT, ACCOUNTS_FIREBASE_API_KEY: 'edge-web-api-key-0000000000000000000000', ACCOUNTS_GOOGLE_CLIENT_ID: '1234567890-edgeclient.apps.googleusercontent.com' };
/** The Worker with accounts configured and a stand-in provider: its keys are made here and served to the Worker's own outbound requests. */
async function accountsFixture(t: TestContext, extraBindings: Record<string, string> = {}, sleeps = false) {
  const key = await makeKey('edge-key-1');
  const outbound: { url: string; body: unknown }[] = [];
  const f = await fixture(t, { sleeps, bindings: { ...ACCOUNT_BINDINGS, ...extraBindings }, outboundService: async (request: Request) => {
    const url = request.url.split('?')[0] as string;
    outbound.push({ url, body: request.method === 'POST' ? await request.json().catch(() => null) : null });
    if (url === TOKEN_KEYS_URL) return new Response(JSON.stringify({ keys: [key.jwk] }), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  let minted = 0, address = 0;
  /** Every request names another client address, so one test's sign-ins are not one address's ten a minute. */
  const from = () => ({ 'cf-connecting-ip': `203.0.113.${(address++ % 250) + 1}` });
  const token = (subject: string, extra: Record<string, unknown> = {}) => signToken(key, claimsFor(ACCOUNT_PROJECT, Date.now(), { subject, email: `${subject.toLowerCase()}@example.com`, n: ++minted, ...extra }));
  const state = async (cookie?: string | null) => (await f.request('/api/account', null, cookie, from())).json();
  const change = async (path: string, body: Record<string, unknown>, cookie?: string | null) => f.request(path, { ...body, csrf: cookie ? (await state(cookie)).csrf : null }, cookie, from());
  /** The same, with PROOF: a fresh ID token of `subject`. */
  const proved = async (path: string, body: Record<string, unknown>, cookie: string | null | undefined, subject: string) => change(path, { ...body, idToken: await token(subject) }, cookie);
  async function signIn(subject: string, cookie?: string | null, extra: Record<string, unknown> = {}) {
    const response = await change('/api/account/sign-in', { idToken: await token(subject, extra) }, cookie);
    const set = response.headers.get('set-cookie');
    return { status: response.status, body: await response.json(), cookie: set ? set.split(';')[0] as string : '', setCookie: set ?? '' };
  }
  async function player(name: string) { const device = await f.device(name); await f.life(device); return device; }
  const whoAmI = async (cookie: string) => { const response = await f.request('/api/session', null, cookie, from()); const body = await response.json(); return { status: response.status, id: body.session?.id, name: body.session?.name }; };
  const errorOf = async (response: Response) => [response.status, (await response.json()).error];
  return { ...f, key, outbound, token, state, change, proved, signIn, player, whoAmI, errorOf, from };
}

test('Cloudflare: the founder is every player’s first friend — tagged, once, kept on the player’s side, final when ended, over rows that survive a restart', async t => {
  // The stand-in provider gives subject `Founder` the address founder@example.com; the Worker is told its hash.
  const hash = createHash('sha256').update('founder@example.com').digest('hex');
  const f = await accountsFixture(t, { FOUNDER_EMAIL_SHA256: hash });
  const me = async (who: { cookie: string }) => (await f.request('/api/social/me', null, who.cookie, f.from())).json();
  // A player from before the founder: nothing happens yet.
  const ada = await f.player('Ada');
  assert.deepEqual((await me(ada)).friends, []);
  const device = await f.player('Zed');
  const zed = { id: device.id, cookie: (await f.signIn('Founder', device.cookie)).cookie };
  assert.equal((await me(zed)).me.id, zed.id);
  // The earlier player on their next session, and a new one on their first.
  const bola = await f.player('Bola');
  for (const who of [ada, bola]) {
    const mine = await me(who);
    assert.deepEqual(mine.friends.map((friend: { id: string; founder?: boolean }) => [friend.id, friend.founder]), [[zed.id, true]]);
    assert.deepEqual(mine.conversations.map((conv: { with: string; unread: number }) => [conv.with, conv.unread]), [[zed.id, 1]]);
  }
  const founder = await me(zed);
  assert.deepEqual([founder.updates, founder.conversations, founder.friendsMore], [[], [], { total: 2, next: null }]);
  assert.deepEqual(founder.friends.map((friend: { id: string }) => friend.id).sort(), [ada.id, bola.id].sort());
  // Ended by the player: not made again, also after the object restarts.
  assert.equal((await (await f.request('/api/social/friends/remove', { id: zed.id, cityId: 'lagos' }, ada.cookie, f.from())).json()).code, 'removed');
  await f.restart();
  assert.deepEqual((await me(ada)).friends, []);
  assert.deepEqual((await me(bola)).friends.map((friend: { id: string; founder?: boolean }) => [friend.id, friend.founder]), [[zed.id, true]]);
  assert.equal((await me(bola)).conversations.length, 1);
  const stored = JSON.parse((JSON.parse(await storage_(f, "SELECT value FROM collections WHERE name = 'social'")) as { value: string }[])[0]?.value ?? '{}') as { founder: { id: string }; players: Record<string, { friends: Record<string, number>; founder?: { id: string } }> };
  assert.deepEqual([stored.founder.id, stored.players[zed.id]?.friends, stored.players[ada.id]?.founder?.id, stored.players[bola.id]?.founder?.id], [zed.id, {}, zed.id, zed.id]);
});

test('Cloudflare: an empty FOUNDER_EMAIL_SHA256 switches the founder off', async t => {
  const f = await accountsFixture(t, { FOUNDER_EMAIL_SHA256: '' });
  const device = await f.player('Zed');
  const zed = { id: device.id, cookie: (await f.signIn('Founder', device.cookie)).cookie };
  await (await f.request('/api/social/me', null, zed.cookie, f.from())).text();
  const ada = await f.player('Ada');
  const mine = await (await f.request('/api/social/me', null, ada.cookie, f.from())).json();
  assert.deepEqual([mine.friends, mine.conversations], [[], []]);
});

test('Cloudflare: accounts are off unless configured — one disabled answer, every other account route a 404, no outbound request', async t => {
  let outbound = 0;
  const f = await fixture(t, { outboundService: async () => { outbound++; return new Response('{}', { status: 200 }); } });
  const state = await f.request('/api/account'); assert.equal(state.status, 200);
  assert.deepEqual(Object.keys(await state.json()).sort(), ['enabled', 'serverTime']);
  for (const [path, body] of [['/api/account/sign-in', { idToken: 'x' }], ['/api/account/sign-out-everywhere', {}], ['/api/account/delete', { confirm: 'delete' }], ['/api/account/character', { use: 'x' }], ['/api/account/password-reset', { email: 'ada@example.com' }], ['/api/account/export', { idToken: 'x' }]] as const) {
    const response = await f.request(path, body); assert.equal(response.status, 404, path); assert.equal(response.headers.get('set-cookie'), null); await response.text();
  }
  const a = await f.device('Ada'); assert.equal((await f.life(a)).cash, 5000);
  const storage = await f.storage();
  assert.equal((await storage.exec('SELECT COUNT(*) AS n FROM accounts'))[0].n, 0); assert.equal((await storage.exec('SELECT COUNT(*) AS n FROM account_devices'))[0].n, 0);
  assert.equal(outbound, 0);
});

test('Cloudflare: accounts — save, restore on another device, the merge choice, sign out, sign out everywhere and delete, over rows that survive a restart', async t => {
  const f = await accountsFixture(t), ada = await f.player('Ada');
  const open = await f.state(ada.cookie);
  assert.deepEqual([open.enabled, open.provider, open.guest, open.account], [true, { apiKey: ACCOUNT_BINDINGS.ACCOUNTS_FIREBASE_API_KEY, googleClientId: ACCOUNT_BINDINGS.ACCOUNTS_GOOGLE_CLIENT_ID }, true, null]);
  // Save: the guest's character becomes the account's, under a new cookie with the cookie's usual flags.
  const laptop = await f.signIn('UidAda', ada.cookie);
  assert.deepEqual([laptop.status, laptop.body.outcome, laptop.body.created, laptop.body.character], [200, 'linked', true, { id: ada.id, name: 'Ada' }]);
  assert.match(laptop.cookie, /^__Host-sid=[0-9a-f-]{36}$/); assert.notEqual(laptop.cookie, ada.cookie);
  assert.match(laptop.setCookie, /HttpOnly/); assert.match(laptop.setCookie, /SameSite=Lax/); assert.match(laptop.setCookie, /Secure/);
  assert.deepEqual(await f.whoAmI(laptop.cookie), { status: 200, id: ada.id, name: 'Ada' }); assert.equal((await f.whoAmI(ada.cookie)).status, 401);
  const storage = await f.storage();
  const account = JSON.parse((await storage.exec('SELECT value FROM accounts'))[0].value);
  assert.deepEqual([account.subject, account.email, account.provider, account.publicId, account.devices], ['UidAda', 'uidada@example.com', 'password', ada.id, [laptop.cookie.slice(11)]]);
  const row = (await storage.exec('SELECT secret,value FROM sessions WHERE public_id = ?', ada.id))[0];
  assert.equal(row.secret, account.sessionKey); assert.notEqual(row.secret, laptop.cookie.slice(11)); assert.equal(JSON.parse(row.value).account, account.id);
  assert.deepEqual((await storage.exec('SELECT secret,account_id FROM account_devices')).map(item => [item.secret, item['account_id']]), [[laptop.cookie.slice(11), account.id]]);
  // The key the character is stored under is not a credential, and no answer sends it.
  assert.equal((await f.whoAmI(`__Host-sid=${row.secret}`)).status, 401); assert.equal((await f.upgrade({ origin: f.origin, cookie: `__Host-sid=${row.secret}` })).status, 401);
  const renewed = await f.request('/api/life?city=lagos', null, laptop.cookie); assert.equal(renewed.headers.get('set-cookie')?.split(';')[0], laptop.cookie); assert.ok(!(await renewed.text()).includes(row.secret));
  // Restore: another device signs in and plays the same character; the game works through the binding (an action, its receipt, a retry).
  const phone = await f.signIn('UidAda');
  assert.deepEqual([phone.body.outcome, phone.body.created], ['restored', false]);
  const travel = { actionId: `${Date.now()}:${randomUUID()}`, type: 'travel', id: 'library', mode: 'cab' };
  const moved = await (await f.action({ ...ada, cookie: phone.cookie }, travel)).json(); assert.equal(moved.state.cash, 4600);
  assert.equal((await (await f.action({ ...ada, cookie: laptop.cookie }, travel)).json()).duplicate, true, 'the same action id from the other device is the same action');
  assert.equal((await f.life({ ...ada, cookie: laptop.cookie })).cash, 4600);
  await f.restart();
  assert.deepEqual(await f.whoAmI(phone.cookie), { status: 200, id: ada.id, name: 'Ada' }, 'bindings and the character survive a restart');
  assert.equal((await f.state(phone.cookie)).account.devices, 2);
  // Merge: a device with its own played life signs in. The account's character stays active; the device's is set aside.
  const bola = await f.player('Bola'), tablet = await f.signIn('UidAda', bola.cookie);
  assert.deepEqual([tablet.body.outcome, tablet.body.character, tablet.body.parked.id, tablet.body.parked.name], ['parked', { id: ada.id, name: 'Ada' }, bola.id, 'Bola']);
  const current = await f.storage();
  const aside = JSON.parse((await current.exec('SELECT value FROM archived_lives WHERE public_id = ?', bola.id))[0].value);
  assert.equal(aside.account, account.id); assert.equal(aside.cities.lagos.state.cash, 5000);
  // The explicit choice, both ways; neither life loses anything.
  const chosen = await f.proved('/api/account/character', { use: bola.id }, tablet.cookie, 'UidAda'); assert.equal(chosen.status, 200); await chosen.text();
  assert.deepEqual(await f.whoAmI(tablet.cookie), { status: 200, id: bola.id, name: 'Bola' }); assert.equal((await f.life({ ...bola, cookie: tablet.cookie })).cash, 5000);
  assert.deepEqual(await f.errorOf(await f.proved('/api/account/character', { use: randomUUID() }, tablet.cookie, 'UidAda')), [404, 'character_not_found']);
  assert.equal((await f.proved('/api/account/character', { use: ada.id }, tablet.cookie, 'UidAda')).status, 200);
  assert.equal((await f.life({ ...ada, cookie: tablet.cookie })).cash, 4600);
  assert.equal((await current.exec('SELECT COUNT(*) AS n FROM sessions WHERE public_id IN (?,?)', ada.id, bola.id))[0].n, 1);
  // (Eight proofs per account per five minutes: the clock here is the real one, so the window is cleared instead of waited out.)
  await current.exec('DELETE FROM rate_limits_protected');
  // Sign out: this device only.
  const out = await f.change('/api/account/sign-out', {}, tablet.cookie);
  assert.equal(out.status, 200); assert.match(out.headers.get('set-cookie') as string, /^__Host-sid=; HttpOnly; SameSite=Lax; Path=\/; Max-Age=0; Secure$/); await out.text();
  assert.equal((await f.whoAmI(tablet.cookie)).status, 401); assert.equal((await f.whoAmI(phone.cookie)).status, 200);
  // Sign out everywhere: every other device.
  const everywhere = await f.proved('/api/account/sign-out-everywhere', {}, phone.cookie, 'UidAda'); assert.equal((await everywhere.json()).ended, 1);
  assert.equal((await f.whoAmI(laptop.cookie)).status, 401); assert.equal((await f.whoAmI(phone.cookie)).status, 200);
  assert.deepEqual((await current.exec('SELECT secret FROM account_devices')).map(item => item.secret), [phone.cookie.slice(11)]);
  // Export, then delete with a fresh token: the active character is handed back as a guest life; the set-aside one goes with the account.
  const exported = await (await f.proved('/api/account/export', {}, phone.cookie, 'UidAda')).json();
  assert.deepEqual([exported.account.email, exported.character.id, exported.setAside.map((item: { id: string }) => item.id)], ['uidada@example.com', ada.id, [bola.id]]);
  assert.ok(!JSON.stringify(exported).includes(phone.cookie.slice(11)) && !JSON.stringify(exported).includes('UidAda'));
  assert.deepEqual(await f.errorOf(await f.change('/api/account/delete', { confirm: 'delete' }, phone.cookie)), [401, 'invalid_token']);
  assert.deepEqual(await f.errorOf(await f.change('/api/account/delete', { confirm: 'delete', idToken: await f.token('UidMallory') }, phone.cookie)), [403, 'account_mismatch']);
  const gone = await f.change('/api/account/delete', { confirm: 'delete', idToken: await f.token('UidAda') }, phone.cookie);
  assert.equal(gone.status, 200); const guest = (gone.headers.get('set-cookie') as string).split(';')[0] as string; assert.equal((await gone.json()).kept, true);
  assert.deepEqual(await f.whoAmI(guest), { status: 200, id: ada.id, name: 'Ada' }); assert.equal((await f.whoAmI(phone.cookie)).status, 401);
  assert.equal((await current.exec('SELECT COUNT(*) AS n FROM accounts'))[0].n, 0); assert.equal((await current.exec('SELECT COUNT(*) AS n FROM account_devices'))[0].n, 0);
  assert.equal((await current.exec('SELECT COUNT(*) AS n FROM archived_lives WHERE public_id = ?', bola.id))[0].n, 0);
  assert.ok(!JSON.parse((await current.exec('SELECT value FROM sessions WHERE public_id = ?', ada.id))[0].value).account);
  // The audit trail holds events and a reference: no token, address, subject or cookie. Nothing of a token was stored or logged.
  const log = JSON.parse((await current.exec("SELECT value FROM collections WHERE name = 'accountLog'"))[0].value);
  assert.deepEqual(log.audit.map((line: { event: string }) => line.event), ['created', 'linked', 'restored', 'parked', 'parked', 'switched', 'parked', 'switched', 'signed_out', 'signed_out_everywhere', 'deleted']);
  for (const secret of ['UidAda', 'example.com', 'eyJ', phone.cookie.slice(11)]) assert.ok(!JSON.stringify(log.audit).includes(secret), secret);
  assert.ok(!/eyJ[A-Za-z0-9_-]{10,}/.test(f.logged()), 'no token is logged');
  assert.deepEqual([...new Set(f.outbound.map(request => request.url))], [TOKEN_KEYS_URL], 'the only outbound request was for the provider’s keys');
});

test('Cloudflare: accounts — fixation, CSRF, token replay, unverified address, one answer for every bad token, limits, and sockets closed on sign-out', async t => {
  const f = await accountsFixture(t, {}, true), ada = await f.player('Ada');
  // An unverified address links nothing.
  const unverified = await f.signIn('UidAda', ada.cookie, { verified: false });
  assert.deepEqual([unverified.status, unverified.body.error, unverified.setCookie], [403, 'email_unverified', '']);
  const storage = await f.storage();
  assert.equal((await storage.exec('SELECT COUNT(*) AS n FROM accounts'))[0].n, 0);
  // Every kind of bad token gets the same answer.
  const stranger = await makeKey('edge-key-1'), at = Math.floor(Date.now() / 1000), answers = new Set<string>();
  for (const idToken of [await f.token('UidAda', { exp: at - 5 }), await f.token('UidAda', { iat: at - 900 }), await f.token('UidAda', { aud: 'another-project' }), await f.token('UidAda', { iss: 'https://accounts.google.com' }), await signToken(stranger, claimsFor(ACCOUNT_PROJECT, Date.now())), 'not.a.token']) {
    const response = await f.request('/api/account/sign-in', { idToken }, null, f.from());
    assert.equal(response.headers.get('set-cookie'), null); answers.add(JSON.stringify([response.status, (await response.json()).error]));
  }
  assert.deepEqual([...answers], ['[401,"invalid_token"]']);
  // Token replay: one token, one sign-in.
  const idToken = await f.token('UidAda');
  const first = await f.request('/api/account/sign-in', { idToken, csrf: (await f.state(ada.cookie)).csrf }, ada.cookie, f.from());
  assert.equal(first.status, 200); const mine = (first.headers.get('set-cookie') as string).split(';')[0] as string; await first.text();
  assert.deepEqual(await f.errorOf(await f.request('/api/account/sign-in', { idToken }, null, f.from())), [401, 'invalid_token']);
  assert.ok(!JSON.stringify(await storage.exec("SELECT value FROM collections WHERE name = 'accountLog'")).includes(idToken.split('.')[2] as string), 'what is remembered of a used token is a digest');
  // … and it survives a restart, under every spelling of the token.
  await f.restart();
  const [head, body, signature] = idToken.split('.') as [string, string, string], last = EDGE_B64.indexOf(signature.at(-1) as string);
  const respelled = [idToken, ...Array.from({ length: 15 }, (_, n) => `${head}.${body}.${signature.slice(0, -1)}${EDGE_B64[last - (last % 16) + ((last % 16) + n + 1) % 16]}`), `${idToken}=`, `${idToken}==`, ` ${idToken}`, `${idToken}\n`];
  for (const variant of respelled) {
    assert.deepEqual(await f.errorOf(await f.request('/api/account/sign-in', { idToken: variant }, null, f.from())), [401, 'invalid_token'], `replay after a restart as ${JSON.stringify(variant.slice(-4))}`);
    assert.deepEqual(await f.errorOf(await f.request('/api/account/delete', { idToken: variant, confirm: 'delete', erase: true, csrf: (await f.state(mine)).csrf }, mine, f.from())), [401, 'invalid_token'], 'a used token is not the fresh token a delete needs');
  }
  assert.equal((await f.whoAmI(mine)).status, 200, 'the account was not deleted');
  // Fixation: a cookie planted before sign-in is never the signed-in cookie.
  const attacker = await f.player('Mallory'), victim = await f.signIn('UidAda', attacker.cookie);
  assert.equal(victim.status, 200); assert.notEqual(victim.cookie, attacker.cookie);
  assert.equal((await f.whoAmI(attacker.cookie)).status, 401); assert.equal((await f.state(attacker.cookie)).account, null);
  // CSRF: the Origin must name this host, and the session's own token must come with the request.
  const good = (await f.state(mine)).csrf;
  for (const [path, body] of [['/api/account/sign-out', {}], ['/api/account/sign-out-everywhere', { idToken: 'x' }], ['/api/account/export', { idToken: 'x' }], ['/api/account/delete', { confirm: 'delete', idToken: 'x' }], ['/api/account/sign-in', { idToken: 'x' }]] as const) {
    const bare = await f.fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', cookie: mine }, body: JSON.stringify({ ...body, csrf: good }) });
    assert.deepEqual(await f.errorOf(bare), [403, 'origin_required'], `${path} without an Origin`);
    assert.deepEqual(await f.errorOf(await f.request(path, { ...body, csrf: good }, mine, { origin: 'https://evil.test' })), [403, 'origin_rejected'], path);
    assert.deepEqual(await f.errorOf(await f.request(path, { ...body, csrf: good }, mine, { 'sec-fetch-site': 'cross-site' })), [403, 'origin_required'], path);
    assert.deepEqual(await f.errorOf(await f.request(path, body, mine)), [403, 'csrf_rejected'], `${path} without the token`);
    assert.deepEqual(await f.errorOf(await f.request(path, { ...body, csrf: 'A'.repeat(43) }, mine)), [403, 'csrf_rejected'], path);
  }
  assert.equal((await f.state(mine)).account.devices, 2, 'no refused request changed anything');
  // A signed-in device's socket is in the room as the character, is revoked when the character leaves, and is closed when the device signs out.
  const x = await f.socket({ ...ada, cookie: mine }), y = await f.socket({ ...ada, cookie: victim.cookie });
  x.send({ type: 'join', cityId: 'lagos', venueId: 'park' }); const presence = await x.next();
  assert.equal(presence.members[0].id, ada.id); assert.ok(!JSON.stringify(presence).includes(mine.slice(11)));
  await f.hibernate();
  await f.action({ ...ada, cookie: victim.cookie }, { type: 'travel', id: 'library', mode: 'cab' });
  assert.equal((await x.next()).code, 'venue_mismatch', 'an action from the other device revokes this device’s room');
  const closed = new Promise<number>((resolve) => { y.ws.addEventListener('close', event => resolve(event.code)); });
  await (await f.change('/api/account/sign-out', {}, victim.cookie)).text();
  assert.equal(await closed, 4401);
  assert.equal((await f.upgrade({ origin: f.origin, cookie: victim.cookie })).status, 401, 'a signed-out cookie opens no socket');
  // The device that stayed signed in is still answered as the character (in transit now, so no room admits it): not as a stranger.
  x.send({ type: 'join', cityId: 'lagos', venueId: 'library' }); assert.equal((await x.next()).code, 'venue_mismatch');
  // Limits: ten attempts a minute from one address; a reset is answered the same for any address and never waits for the provider.
  const one = { 'cf-connecting-ip': '198.51.100.7' };
  for (let i = 0; i < 10; i++) assert.equal((await f.request('/api/account/sign-in', { idToken: 'not.a.token' }, null, one)).status, 401);
  assert.deepEqual(await f.errorOf(await f.request('/api/account/sign-in', { idToken: await f.token('UidBola') }, null, one)), [429, 'account_rate_limited']);
  const resets = [];
  for (const email of ['known@example.com', 'unknown@example.com']) { const response = await f.request('/api/account/password-reset', { email }, null, { 'cf-connecting-ip': '198.51.100.8' }); resets.push(JSON.stringify([response.status, (await response.json()).ok])); }
  assert.deepEqual(resets, ['[200,true]', '[200,true]']);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.deepEqual(f.outbound.filter(request => request.url.includes('sendOobCode')).map(request => request.body), [{ requestType: 'PASSWORD_RESET', email: 'known@example.com' }, { requestType: 'PASSWORD_RESET', email: 'unknown@example.com' }]);
  assert.ok(!/example\.com|eyJ[A-Za-z0-9_-]{10,}/.test(f.logged()), 'neither an address nor a token is logged');
});

test('Cloudflare: accounts hardening — a flood of resets and junk sign-ins fills nothing that matters: rows stay bounded, a new visitor gets a session and a real sign-in works', async t => {
  const f = await accountsFixture(t), storage = await f.storage();
  // What the reviewer did, in small: requests from many addresses, each to another address, far past the shared bucket.
  const statuses = new Map<number, number>();
  for (let batch = 0; batch < 12; batch++) await Promise.all(Array.from({ length: 50 }, async (_, i) => {
    const n = batch * 50 + i;
    const response = await f.request('/api/account/password-reset', { email: `victim${n}@example.com` }, null, { 'cf-connecting-ip': `2001:db8:${n.toString(16)}::1` });
    statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1); await response.text();
  }));
  assert.equal(statuses.get(200), 120); assert.equal(statuses.get(429), 480);
  const rows = (await storage.exec('SELECT COUNT(*) AS n FROM rate_limits_protected'))[0].n;
  assert.ok(rows <= 241, `a refused request made no row of its own (${rows} rows for 120 accepted requests)`);
  // Junk sign-ins from thirty addresses do not spend the shared sign-in bucket.
  for (let address = 0; address < 30; address++) await Promise.all(Array.from({ length: 10 }, async (_, i) => { const response = await f.request('/api/account/sign-in', { idToken: `junk.${address}.${i}` }, null, { 'cf-connecting-ip': `198.51.100.${address + 1}` }); assert.equal(response.status, 401); await response.text(); }));
  assert.equal((await storage.exec("SELECT COUNT(*) AS n FROM rate_limits_protected WHERE key = 'account:sign-in'"))[0].n, 0, 'the shared bucket was not touched by tokens that did not verify');
  // Nor do validly signed tokens of throwaway, unconfirmed accounts.
  for (let batch = 0; batch < 8; batch++) await Promise.all(Array.from({ length: 40 }, async (_, i) => { const n = batch * 40 + i; const response = await f.request('/api/account/sign-in', { idToken: await f.token(`UidThrowaway${n}`, { verified: false }) }, null, { 'cf-connecting-ip': `2001:db8:aaaa:${n.toString(16)}::1` }); assert.equal(response.status, 403); await response.text(); }));
  assert.equal((await storage.exec("SELECT COUNT(*) AS n FROM rate_limits_protected WHERE key = 'account:sign-in' OR key LIKE 'account:sign-in:id:%'"))[0].n, 0, '320 unconfirmed sign-ups from 320 addresses counted against nothing shared');
  assert.equal((await storage.exec("SELECT COUNT(*) AS n FROM rate_limits_protected WHERE key NOT LIKE 'account:sign-in%' AND key NOT LIKE 'account:reset%'"))[0].n, 0, 'every account key starts account:sign-in or account:reset');
  // Now the worst case the stored class allows: full of long-lived rows. (A full short class is the flood test above.)
  const far = Date.now() + 3600000;
  await storage.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 4000) INSERT OR REPLACE INTO rate_limits_protected(key,started_at,count,expires_at) SELECT 'account:reset:to:flood-' || i, ${Date.now()}, 3, ${far} + i FROM n`);
  const fresh = { 'cf-connecting-ip': '203.0.113.240' };
  const made = await f.request('/api/session', { name: 'Newcomer' }, null, fresh);
  assert.equal(made.status, 200, 'a new visitor’s POST /api/session succeeds');
  const cookie = (made.headers.get('set-cookie') as string).split(';')[0] as string; await made.text();
  await f.request('/api/life?city=lagos', null, cookie, fresh);
  const csrf = (await (await f.request('/api/account', null, cookie, fresh)).json()).csrf;
  const signed = await f.request('/api/account/sign-in', { idToken: await f.token('UidNewcomer'), csrf }, cookie, { 'cf-connecting-ip': '203.0.113.241' });
  assert.equal(signed.status, 200, 'and a valid sign-in succeeds'); assert.equal((await signed.json()).outcome, 'linked');
  assert.ok((await storage.exec('SELECT COUNT(*) AS n FROM rate_limits_protected'))[0].n <= 20000);
});

test('Cloudflare: accounts hardening — __Host-sid: an old `sid` guest keeps their life and is upgraded, a planted `sid` loses to it, and a binding is honoured under the new name only', async t => {
  const f = await accountsFixture(t), old = await f.player('Oldtimer');
  assert.match(old.cookie, /^__Host-sid=[0-9a-f-]{36}$/, 'every new cookie has the protected name');
  const secret = old.cookie.slice(11), legacy = `sid=${secret}`; // the same session as a browser that got its cookie before the change holds it
  const visit = await f.request('/api/life?city=lagos', null, legacy);
  assert.equal(visit.status, 200); assert.equal((await visit.json()).state.cash, 5000);
  assert.deepEqual(visit.headers.getSetCookie(), [`__Host-sid=${secret}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000; Secure`], 'the new name is set and `sid` is NOT removed: the previous build, which reads only `sid`, would still find this guest after a rollback');
  // The browser now holds both; that works, and so does `sid` alone. No answer to a guest clears `sid`.
  for (const cookie of [`${legacy}; ${old.cookie}`, legacy, old.cookie]) {
    const response = await f.request('/api/session', null, cookie);
    assert.equal(response.status, 200); assert.ok(!response.headers.getSetCookie().some(line => line.startsWith('sid=')), cookie); await response.text();
  }
  assert.equal((await (await f.request('/api/session', { name: 'Oldtimer' }, legacy)).json()).session.id, old.id);
  assert.equal((await f.upgrade({ origin: f.origin, cookie: legacy })).headers.getSetCookie()[0], `__Host-sid=${secret}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000; Secure`, 'a socket opened with the old name is upgraded too');
  const who = async (cookie: string) => { const answer = await f.whoAmI(cookie); return answer.status === 200 ? answer.id : answer.status; };
  const attacker = await f.player('Mallory'), planted = `sid=${attacker.cookie.slice(11)}`;
  assert.equal(await who(`${planted}; ${old.cookie}`), old.id, 'sid=attacker; __Host-sid=victim → the victim');
  assert.equal(await who(`${old.cookie}; ${planted}`), old.id);
  // A guest not upgraded yet sees what the previous build did: the first `sid` is the cookie.
  assert.equal(await who(`${legacy}; ${planted}`), old.id, 'sid=victim; sid=attacker → the first, as before');
  assert.equal(await who(`${planted}; ${legacy}`), attacker.id, 'sid=attacker; sid=victim → the first, as before');
  assert.equal(await who(`${attacker.cookie}; ${old.cookie}`), 401, 'two values under the protected name → nobody');
  // Signed in: the binding is honoured as __Host-sid, and not when the same value arrives as `sid`.
  const signed = await f.signIn('UidOld', old.cookie);
  assert.match(signed.setCookie, /^__Host-sid=[0-9a-f-]{36}; HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000; Secure$/);
  const binding = signed.cookie.slice(11);
  assert.equal(await who(signed.cookie), old.id);
  assert.equal(await who(`sid=${binding}`), 401); assert.equal(await who(`sid=${binding}; ${planted}`), 401);
  assert.equal((await f.state(`sid=${binding}`)).account, null);
  // Signing out is where `sid` is removed.
  const out = await f.change('/api/account/sign-out', {}, `${planted}; ${signed.cookie}`);
  assert.deepEqual(out.headers.getSetCookie(), ['__Host-sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure']); await out.text();
  const back = await f.signIn('UidOld');
  assert.equal(await who(back.cookie), old.id);
  assert.equal((await f.upgrade({ origin: f.origin, cookie: `sid=${binding}` })).status, 401);
  assert.equal(await who(`${planted}; ${back.cookie}`), old.id, 'a guest cookie planted beside a signed-in browser changes nothing');
  // Over https an Origin naming this host over plain http is another origin.
  assert.equal((await f.request('/api/session', { name: 'Downgrade' }, null, { origin: f.origin.replace('https://', 'http://') })).status, 403);
});

test('Cloudflare: accounts hardening — a character archived by the 30-day sweep comes back whole from the Worker store', async t => {
  const f = await accountsFixture(t), ada = await f.player('Ada');
  const signed = await f.signIn('UidAda', ada.cookie);
  const storage = await f.storage();
  const row = (await storage.exec('SELECT secret,value FROM sessions WHERE public_id = ?', ada.id))[0], record = JSON.parse(row.value);
  record.character = { v: 1, city: 'lagos', movedAt: 123, from: 'ibadan' }; record.legacyLives = { 'lagos:99': record.cities.lagos }; record.legacyLifeCities = { 'lagos:99': 'lagos' }; record.onboarding = true; record.expiresAt = Date.now() - 1;
  await storage.exec('UPDATE sessions SET value = ?, expires_at = ? WHERE secret = ?', JSON.stringify(record), record.expiresAt, row.secret);
  assert.equal((await f.whoAmI(signed.cookie)).status, 401);
  await f.device('Sweeper'); // the sweep archives the expired character
  const archived = JSON.parse((await storage.exec('SELECT value FROM archived_lives WHERE public_id = ?', ada.id))[0].value);
  assert.deepEqual(Object.keys(archived).sort(), ['archivedAt', 'character', 'cities', 'legacyLifeCities', 'legacyLives', 'name', 'onboarding', 'publicId']);
  const back = await f.signIn('UidAda');
  assert.deepEqual([back.body.outcome, back.body.character], ['restored', { id: ada.id, name: 'Ada' }]);
  const restored = JSON.parse((await storage.exec('SELECT value FROM sessions WHERE public_id = ?', ada.id))[0].value);
  assert.deepEqual([restored.character, Object.keys(restored.legacyLives), restored.legacyLifeCities, restored.onboarding, restored.account], [{ v: 1, city: 'lagos', movedAt: 123, from: 'ibadan' }, ['lagos:99'], { 'lagos:99': 'lagos' }, true, 'fb:UidAda']);
  assert.equal((await storage.exec('SELECT COUNT(*) AS n FROM archived_lives WHERE public_id = ?', ada.id))[0].n, 0);
  // The pre-hijack on this host too: linking a character into an account that already existed ends the earlier binding.
  const early = await f.signIn('UidVictim'), victim = await f.player('Victim'), arrived = await f.signIn('UidVictim', victim.cookie);
  assert.deepEqual([arrived.body.outcome, arrived.body.ended, arrived.body.devices], ['linked', 1, 1]); assert.equal((await f.whoAmI(early.cookie)).status, 401);
});

test('Cloudflare: the welcome message — one per new account, after the sign-in is answered, never again on another device or after a restart; nothing without the mailer', async t => {
  const key = await makeKey('edge-key-1'), mails: { subject: string; personalizations: { to: { email: string }[] }[]; content: { type: string; value: string }[] }[] = [];
  let mailStatus = 200;
  const f = await fixture(t, { bindings: { ...ACCOUNT_BINDINGS, PUBLIC_ORIGIN: 'https://play.example', ZEPTOMAIL_AUTH: 'Zoho-enczapikey placeholder-not-a-key', EMAIL_FROM_ADDRESS: 'hello@mail.example.com' }, outboundService: async (request: Request) => {
    if (request.url === TOKEN_KEYS_URL) return new Response(JSON.stringify({ keys: [key.jwk] }), { status: 200, headers: { 'cache-control': 'public, max-age=3600' } });
    if (request.url === 'https://api.zeptomail.com/v1.1/sg/email') { mails.push(await request.json()); return new Response('{}', { status: mailStatus }); }
    return new Response('{}', { status: 200 });
  } });
  let n = 0;
  const signIn = async (subject: string, cookie?: string) => {
    const csrf = cookie ? (await (await f.request('/api/account', null, cookie)).json()).csrf : null;
    const response = await f.request('/api/account/sign-in', { idToken: await signToken(key, claimsFor(ACCOUNT_PROJECT, Date.now(), { subject, email: `${subject.toLowerCase()}@example.com`, n: ++n })), csrf }, cookie, { 'cf-connecting-ip': `203.0.113.${n}` });
    return { status: response.status, cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] as string, body: await response.json() };
  };
  const waitFor = async (count: number, ms = 3000) => { const until = Date.now() + ms; while (mails.length < count && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20)); await new Promise(resolve => setTimeout(resolve, 150)); };
  const ada = await f.device('Ada'); await f.life(ada);
  // Two first sign-ins at once: one account, one message.
  const [first, second] = await Promise.all([signIn('UidAda', ada.cookie), signIn('UidAda')]);
  assert.deepEqual([first.status, second.status], [200, 200]); assert.deepEqual([first.body.created, second.body.created].sort(), [false, true]);
  await waitFor(1);
  assert.equal(mails.length, 1);
  assert.deepEqual([mails[0]?.subject, mails[0]?.personalizations[0]?.to[0]?.email], ['Welcome to Allworld: your character is saved', 'uidada@example.com']);
  const text = mails[0]?.content.find(part => part.type === 'text/plain')?.value ?? '';
  assert.ok(text.includes('Allworld is a digital world you can live in.') && text.includes('saved to this account — sign in on any device to continue.') && text.includes('Open Allworld: https://play.example/'));
  const storage = await f.storage();
  assert.equal(typeof JSON.parse((await storage.exec('SELECT value FROM accounts'))[0].value).welcome, 'number');
  // Another device, and a restart, send nothing more.
  await signIn('UidAda'); await f.restart(); await signIn('UidAda'); await waitFor(2, 600);
  assert.equal(mails.length, 1, 'exactly once per account, also across a restart');
  // A mailer that is down does not fail or slow the sign-in; the message stays owed.
  mailStatus = 503;
  const before = Date.now(), eve = await signIn('UidEve');
  assert.equal(eve.status, 200); assert.ok(Date.now() - before < 1500);
  await waitFor(4, 5000);
  const current = await f.storage();
  const log = JSON.parse((await current.exec("SELECT value FROM collections WHERE name = 'accountLog'"))[0].value);
  assert.deepEqual(log.welcome.map((item: { id: string; tries: number; claimedAt?: number }) => [item.id, item.tries, item.claimedAt]), [['fb:UidEve', 1, undefined]]);
  assert.ok(!/example\.com/.test(f.logged()), 'no address is logged');
});

test('Worker: comeback mail is claimed before it is sent — concurrent rounds and an eviction send it once, and an object with no mailer or no opted-in player does no work', async t => {
  const token = 'worker-operator-token-0123456789-abcdef';
  const sent: { subject: string; text: string; post: string }[] = [];
  const outboundService = async (request: Request) => {
    if (new URL(request.url).origin !== 'https://api.zeptomail.com') return new Response('no', { status: 404 });
    const body = await request.json() as { subject: string; content: { value: string }[]; headers?: Record<string, string> };
    sent.push({ subject: body.subject, text: body.content[0]?.value ?? '', post: body.headers?.['List-Unsubscribe-Post'] ?? '' });
    return new Response(null, { status: 202 });
  };
  const live = { BUILD_ID: 'local-conformance', MODERATOR_TOKEN: token, PUBLIC_ORIGIN: 'https://joinallworld.test', ZEPTOMAIL_AUTH: 'Zoho-enczapikey SYNTHETIC', EMAIL_FROM_ADDRESS: 'hello@mail.joinallworld.test' };
  // The object's clock is moved to 12:30 Lagos time (11:30 UTC): the rules never send at night, and the test cannot wait for noon.
  const DAY_MS = 86400000, clockShiftMs = (11.5 * 3600000 - (Date.now() % DAY_MS) + DAY_MS) % DAY_MS;
  const f = await fixture(t, { sleeps: true, bindings: live, outboundService, clockShiftMs });
  const operator = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  type Round = { comeback?: { ran: boolean; jobs?: number; reason?: string } };
  const run = async () => (await (await f.fetch('/api/mod/growth/outreach/run', { method: 'POST', headers: operator, body: '{}' })).json()) as Round;
  const post = async (path: string, body: object, who: Device) => (await (await f.request(path, body, who.cookie)).json()) as Record<string, unknown>;
  const comebackMails = () => sent.filter(mail => !/^(Confirm your|You are in)/.test(mail.subject));

  // Nobody has an address: one look at most, and nothing stored for the feature.
  assert.deepEqual((await run()).comeback, { ran: true, jobs: 0 });
  assert.equal((await storage_(f, "SELECT value FROM collections WHERE name = 'growth'")).includes('"comeback"'), false);

  // Ada opts in (double opt-in), keeps only the needs switch on, and is then away with a hungry character.
  const ada = await f.device('Ada');
  await f.life(ada);
  await post('/api/growth/hello', { cityId: 'lagos' }, ada);
  await post('/api/growth/consent', { cityId: 'lagos', age: 'adult' }, ada);
  await post('/api/growth/email', { email: 'ada@example.com', consent: true }, ada);
  const link = /https:\/\/joinallworld\.test(\/e\/confirm\?t=[A-Za-z0-9_.-]+)/.exec(sent.at(-1)?.text ?? '')?.[1];
  assert.ok(link, 'the confirmation mail carries its link');
  assert.equal((await f.fetch(link, { method: 'POST' })).status, 200);
  const saved = await post('/api/growth/comeback', { cityId: 'lagos', types: { friends: false, milestones: false, events: false, away: false, week: false } }, ada);
  assert.deepEqual([saved.code, (saved.comeback as { on: boolean; types: Record<string, boolean> }).on, Object.values((saved.comeback as { types: Record<string, boolean> }).types).filter(Boolean).length], ['saved', true, 1]);
  const db = await f.storage();
  const secret = ada.cookie.split('=')[1] ?? '', PAST = 6 * 86400000;
  const session = JSON.parse((await db.exec('SELECT value FROM sessions WHERE secret = ?', secret))[0].value);
  session.cities.lagos.updatedAt -= PAST; session.cities.lagos.state.needs.hunger = 5;
  await db.exec('UPDATE sessions SET value = ? WHERE secret = ?', JSON.stringify(session), secret);
  const growth = JSON.parse((await db.exec("SELECT value FROM collections WHERE name = 'growth'"))[0].value);
  growth.players[ada.id].seen -= PAST;
  await db.exec("UPDATE collections SET value = ? WHERE name = 'growth'", JSON.stringify(growth));

  // Three rounds at the same moment, then the object is evicted and two more.
  const first = await Promise.all([run(), run(), run()]);
  assert.equal(first.reduce((sum, round) => sum + (round.comeback?.jobs ?? 0), 0), 1, 'one of the concurrent rounds claimed it');
  await f.hibernate();
  await run(); await run();
  const stored = JSON.parse((await db.exec("SELECT value FROM collections WHERE name = 'growth'"))[0].value);
  assert.equal(comebackMails().length, 1, 'once, however many rounds and restarts');
  assert.equal(comebackMails()[0]?.subject, 'Ada is hungry');
  assert.equal(comebackMails()[0]?.post, 'List-Unsubscribe=One-Click');
  assert.equal(stored.comeback[ada.id].sent.length, 1, 'the claim is in the stored ledger');
  assert.equal(Object.values(stored.comebackStats as Record<string, Record<string, { sent: number }>>).some(day => day.need?.sent === 1), true);
  assert.equal(JSON.stringify(stored.comeback).includes('@'), false, 'no address in the comeback record');

  // An object without a mailer does nothing at all.
  const dry = await fixture(t, { sleeps: true, bindings: { BUILD_ID: 'local-conformance', MODERATOR_TOKEN: token } });
  const result = await (await dry.fetch('/api/mod/growth/outreach/run', { method: 'POST', headers: operator, body: '{}' })).json() as Round;
  assert.deepEqual(result.comeback, { ran: false, reason: 'not_configured' });
});

test('Worker: an account holder is a comeback recipient — on from the start, and the welcome is in the same ledger', async t => {
  const key = await makeKey('edge-key-1'), mails: { subject: string; headers?: Record<string, string>; personalizations: { to: { email: string }[] }[] }[] = [];
  const token = 'worker-operator-token-0123456789-abcdef';
  const DAY_MS = 86400000, clockShiftMs = (11.5 * 3600000 - (Date.now() % DAY_MS) + DAY_MS) % DAY_MS;
  // `sleeps`: this test reads the stored record straight after the visit that made it, and a visit is a lazy change (held in memory by default).
  const f = await fixture(t, { sleeps: true, clockShiftMs, bindings: { ...ACCOUNT_BINDINGS, MODERATOR_TOKEN: token, PUBLIC_ORIGIN: 'https://play.example', ZEPTOMAIL_AUTH: 'Zoho-enczapikey placeholder-not-a-key', EMAIL_FROM_ADDRESS: 'hello@mail.example.com' }, outboundService: async (request: Request) => {
    if (request.url === TOKEN_KEYS_URL) return new Response(JSON.stringify({ keys: [key.jwk] }), { status: 200, headers: { 'cache-control': 'public, max-age=3600' } });
    if (request.url === 'https://api.zeptomail.com/v1.1/sg/email') { mails.push(await request.json()); return new Response('{}', { status: 200 }); }
    return new Response('{}', { status: 200 });
  } });
  const ada = await f.device('Ada'); await f.life(ada);
  const csrf = (await (await f.request('/api/account', null, ada.cookie)).json()).csrf;
  const response = await f.request('/api/account/sign-in', { idToken: await signToken(key, claimsFor(ACCOUNT_PROJECT, Date.now() + clockShiftMs, { subject: 'UidAda', email: 'uidada@example.com', n: 1 })), csrf }, ada.cookie, { 'cf-connecting-ip': '203.0.113.9' });
  const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0] as string;
  assert.equal((await response.json()).created, true);
  const until = Date.now() + 3000; while (!mails.length && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20));
  const hello = async () => (await (await f.request('/api/growth/hello', { cityId: 'lagos' }, cookie)).json()).contact.comeback as { source: string; on: boolean; address: string };
  const view = await hello();
  assert.deepEqual([view.source, view.on, mails[0]?.subject], ['account', true, 'Welcome to Allworld: your character is saved']);
  assert.ok(!view.address.includes('uidada'), 'only a masked address is shown');
  const db = await f.storage();
  const growth = JSON.parse((await db.exec("SELECT value FROM collections WHERE name = 'growth'"))[0].value);
  assert.equal(growth.comeback[ada.id].acct, true);
  assert.equal(JSON.stringify(growth.comeback).includes('@'), false, 'no address in the comeback record');
  // The welcome is in the ledger on the next look, so a character that is long away and hungry is still not written to within the day.
  const row = (await db.exec('SELECT secret,value FROM sessions WHERE public_id = ?', ada.id))[0];
  const record = JSON.parse(row.value); record.cities.lagos.updatedAt -= 6 * DAY_MS; record.cities.lagos.state.needs.hunger = 5;
  await db.exec('UPDATE sessions SET value = ? WHERE secret = ?', JSON.stringify(record), row.secret);
  growth.comeback[ada.id].next = 0;
  await db.exec("UPDATE collections SET value = ? WHERE name = 'growth'", JSON.stringify(growth));
  const run = () => f.fetch('/api/mod/growth/outreach/run', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
  await run();
  const after = JSON.parse((await db.exec("SELECT value FROM collections WHERE name = 'growth'"))[0].value);
  assert.deepEqual(after.comeback[ada.id].sent.map((entry: { type: string }) => entry.type), ['welcome'], 'the welcome holds the day');
  assert.equal(mails.length, 1);
});

async function storage_(f: { storage(): Promise<ObjectStorage> }, query: string): Promise<string> {
  const rows = await (await f.storage()).exec(query).catch(() => []);
  return JSON.stringify(rows);
}

test('Cloudflare: a character pin written by an earlier build is not trusted — the newest life is the character, on persisted storage, and stays so across restarts', async t => {
  const f = await fixture(t);
  const session = async (d: Device) => { const row = (await (await f.storage()).exec('SELECT value FROM sessions WHERE public_id = ?', d.id))[0]; return JSON.parse(row.value); };
  const write = async (d: Device, record: Record<string, unknown>) => (await f.storage()).exec('UPDATE sessions SET value = ? WHERE public_id = ?', JSON.stringify(record), d.id);
  const both = async (name: string, pin: { v: number; city: string; movedAt?: number; from?: string } | null, lagosNewest: boolean) => {
    const d = await f.device(name);
    await f.life(d);
    const record = await session(d), lagos = record.cities.lagos;
    lagos.state.cash = 76000;
    const ibadan = structuredClone(lagos);
    ibadan.state.estate.city = 'ibadan'; ibadan.state.cash = 300;
    lagos.updatedAt = lagosNewest ? 5000 : 2000; ibadan.updatedAt = lagosNewest ? 2000 : 5000;
    record.cities.ibadan = ibadan;
    if (pin) record.character = pin; else delete record.character;
    await write(d, record);
    return d;
  };
  const answer = async (d: Device, city: string) => { const r = await f.request(`/api/life?city=${city}`, null, d.cookie); return { status: r.status, body: await r.json() as Record<string, unknown> & { state?: { cash: number } } }; };
  const stale = await both('Stale', { v: 1, city: 'ibadan' }, true);
  const right = await both('Right', { v: 1, city: 'ibadan' }, false);
  const moved = await both('Moved', { v: 2, city: 'ibadan', movedAt: 500, from: 'lagos' }, true);
  await f.restart();
  // (a) the earlier pin says Ibadan, Lagos was played last: Lagos answers, Ibadan is kept under older characters.
  const a = await answer(stale, 'lagos');
  assert.equal(a.status, 200); assert.equal(a.body.state?.cash, 76000);
  const older = await (await f.request('/api/characters', null, stale.cookie)).json() as { active: string; legacy: { city: string; cash: number }[] };
  assert.deepEqual([older.active, older.legacy.map((x) => [x.city, x.cash])], ['lagos', [['ibadan', 300]]]);
  // (b) the earlier pin is right: Ibadan.
  const b = await answer(right, 'lagos');
  assert.deepEqual([b.status, b.body.error, b.body.city], [409, 'city_moved', 'ibadan']);
  // (d) a recorded move is honoured even though Lagos is newer.
  const d = await answer(moved, 'lagos');
  assert.deepEqual([d.status, d.body.error, d.body.city], [409, 'city_moved', 'ibadan']);
  // Nothing lost, and it is stable across another restart.
  const kept = async () => { const r = await session(stale); return JSON.stringify([Object.keys(r.cities), r.cities.lagos.state.cash, Object.values(r.legacyLives as Record<string, { state: { cash: number } }>).map((x) => x.state.cash), r.character]); };
  const lagosKept = await kept();
  await f.restart();
  assert.equal((await answer(stale, 'lagos')).body.state?.cash, 76000);
  assert.equal(await kept(), lagosKept);
  assert.equal((await session(stale)).character.v, 2);
  // Switching to the older character and back loses nothing.
  const swap = async (id: string) => (await (await f.request('/api/characters/switch', { id, clientId: `${Date.now()}:${randomUUID()}` }, stale.cookie)).json()) as { ok?: boolean; city?: string };
  const switched = await swap(Object.keys((await session(stale)).legacyLives)[0] as string);
  assert.deepEqual([switched.ok, switched.city], [true, 'ibadan']);
  assert.equal((await answer(stale, 'ibadan')).body.state?.cash, 300);
  assert.equal((await swap(Object.keys((await session(stale)).legacyLives)[0] as string)).city, 'lagos');
  assert.equal((await answer(stale, 'lagos')).body.state?.cash, 76000);
});

test('Worker row budget: a connected player who only polls writes nothing; an action writes three rows; a restart keeps what was acknowledged and forgets only what was lazy', async t => {
  const token = 'worker-operator-token-0123456789-abcdef';
  const f = await fixture(t, { bindings: { BUILD_ID: 'local-conformance', MODERATOR_TOKEN: token } });
  type Rows = { total: number; tables: Record<string, number>; sources: Record<string, { rows: number }> };
  const overview = async (): Promise<{ rows: Rows; held: number; limits: { short: number; protected: number } }> => (await (await f.request('/api/mod/overview', null, null, { authorization: `Bearer ${token}` })).json()).store;
  /** Rows written between two readings, by table — without the operator's own budget row, which each reading costs. */
  const since = (before: Rows, after: Rows): Record<string, number> => Object.fromEntries(Object.entries(after.tables).map(([table, rows]) => [table, rows - (before.tables[table] ?? 0)] as const).filter(([table, rows]) => rows !== 0 && table !== 'rate_limits_protected'));
  const ada = await f.device('Ada'), x = await f.socket(ada);
  await f.life(ada);
  x.send({ type: 'join', cityId: 'lagos', venueId: 'park' }); await x.next();
  const poll = async (): Promise<void> => { for (const path of ['/api/life?city=lagos', '/api/world/pulse', '/api/civic/pulse?city=lagos', '/api/social/people?city=lagos', '/api/session']) { const response = await f.request(path, null, ada.cookie); assert.ok(response.status < 500, `${path} answered ${response.status}`); await response.arrayBuffer(); } };
  // The first poll of each kind, and the first beat, make what does not exist yet (a collection, a resident's entry): those are written.
  await poll(); await new Promise(resolve => setTimeout(resolve, 11000)); await poll();
  // From here on: what a page that is only open does, for longer than two beats — it answers the heartbeat, moves, and polls.
  const quiet = (await overview()).rows;
  for (let round = 0; round < 5; round++) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    x.send({ type: 'move', x: 1 + round, z: 2 });
    await poll();
  }
  assert.ok(x.heartbeats.length >= 2, 'the beat ran');
  const polled = await overview();
  const wrote = Object.entries(polled.rows.sources).filter(([name, source]) => name !== '/api/mod/overview' && source.rows !== (quiet.sources[name]?.rows ?? 0)).map(([name, source]) => `${name} ${JSON.stringify(source)}`);
  assert.deepEqual(wrote, [], 'no kind of work wrote a row');
  assert.deepEqual(since(quiet, polled.rows), {}, 'twenty-five seconds of beats, moves and polls wrote no row — not a limit, not the alarm, not the session');
  assert.ok(polled.limits.short >= 2, 'the limits were counted, in memory');
  // One action: the session row and its receipt (the row and its primary-key entry).
  const trip = { actionId: `${Date.now()}:${randomUUID()}`, cityId: 'lagos', type: 'travel', payload: { id: 'library', mode: 'trek' } };
  assert.equal((await (await f.request('/api/action', trip, ada.cookie)).json()).ok, true);
  const acted = await overview();
  assert.deepEqual(since(polled.rows, acted.rows), { sessions: 1, action_receipts: 2 });
  // The operator guard is a stored limit: a hundred token-less tries fill it, and it is still full after a restart.
  for (let i = 0; i < 100; i++) await (await f.request('/api/mod/overview', null, null, { 'cf-connecting-ip': `203.0.113.${1 + (i % 200)}` })).arrayBuffer();
  assert.equal((await f.request('/api/mod/overview', null, null, { 'cf-connecting-ip': '203.0.113.250' })).status, 429);
  const storage = await f.storage();
  const receipts = (await storage.exec('SELECT COUNT(*) AS n FROM action_receipts'))[0].n;
  // A database that still has the index no query read: opening it drops the index for the price of one row, whatever the table holds.
  await storage.exec('CREATE INDEX action_expiry ON action_receipts(action_at)');
  await f.restart();
  assert.equal((await f.request('/api/mod/overview', null, null, { 'cf-connecting-ip': '203.0.113.251' })).status, 429, 'the guard outlived the restart');
  const woken = await overview();
  assert.ok((woken.rows.tables['(schema)'] ?? 0) <= 2, `starting on stored data wrote ${woken.rows.tables['(schema)'] ?? 0} schema rows`);
  assert.equal(woken.held, 0); assert.ok(woken.limits.short <= 2, 'short limits start again: only the requests made since are counted');
  const after = await f.storage();
  assert.equal((await after.exec("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'action_expiry'"))[0].n, 0);
  assert.equal((await after.exec('SELECT COUNT(*) AS n FROM action_receipts'))[0].n, receipts, 'no receipt was lost with the index');
  // The session still works, and the action is still done: its id is a duplicate.
  assert.equal((await f.request('/api/session', null, ada.cookie)).status, 200);
  assert.equal((await (await f.request('/api/action', trip, ada.cookie)).json()).duplicate, true);
});
