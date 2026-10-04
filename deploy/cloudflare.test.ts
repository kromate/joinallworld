import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

/** The pieces of the pinned tooling (miniflare, esbuild) these tests use; the packages live in deploy/tooling, not in the repo's own dependencies. */
interface StubSocket { addEventListener(type: 'message', listener: (event: { data: string }) => void): void; accept(): void; send(data: string): void; close(): void }
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

async function fixture(t: TestContext, overrides: Record<string, unknown> = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'joinallworld-do-test-'));
  const bundle = join(folder, 'worker.mjs');
  await build({ entryPoints: [new URL('./cloudflare-worker.ts', import.meta.url).pathname], outfile: bundle, bundle: true, format: 'esm', platform: 'neutral', external: ['cloudflare:workers'] });
  const options = { name: 'joinallworld-conformance', script: await readFile(bundle, 'utf8'), modules: true, compatibilityDate: '2026-10-01', durableObjects: { JOINALLWORLD: { className: 'JoinAllworldState', useSQLite: true } }, durableObjectsPersist: join(folder, 'storage'), bindings: { BUILD_ID: 'local-conformance' }, assets: { directory: new URL('../dist', import.meta.url).pathname, binding: 'ASSETS', run_worker_first: true, routerConfig: { has_user_worker: true }, assetConfig: { not_found_handling: 'single-page-application' } }, ...overrides };
  let mf = new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: join(folder, 'storage'), unsafeInspectDurableObjects: true });
  const sockets: StubSocket[] = [];
  t.after(async () => { for (const socket of sockets) try { socket.close(); } catch {} await mf.dispose(); await rm(folder, { recursive: true, force: true }); });
  await mf.ready;
  const origin = 'https://joinallworld.test';
  async function request(path: string, body?: object | null, cookie?: string | null, headers: Record<string, string> = {}) {
    return mf.dispatchFetch(origin + path, { method: body ? 'POST' : 'GET', headers: { origin, ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
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
    const response = await mf.dispatchFetch(origin + '/socket', { headers: { origin, cookie: device.cookie, upgrade: 'websocket' } });
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
    const db = await storage(), secret = device.cookie.slice(4);
    const session = JSON.parse((await db.exec('SELECT value FROM sessions WHERE secret = ?', secret))[0].value);
    const entry = session.cities[cityId];
    entry.updatedAt -= ms;
    for (const [id, readyAt] of Object.entries(entry.state.travel?.cooldowns ?? {})) entry.state.travel.cooldowns[id] = (readyAt as number) - ms;
    await db.exec('UPDATE sessions SET value = ? WHERE secret = ?', JSON.stringify(session), secret);
  }
  /** The next Lagos day for one life: the day its last paid work was counted on becomes yesterday. */
  async function nextDay(device: Device, cityId = 'lagos') {
    const db = await storage(), secret = device.cookie.slice(4);
    const session = JSON.parse((await db.exec('SELECT value FROM sessions WHERE secret = ?', secret))[0].value);
    const work = session.cities[cityId].state.civic.work;
    if (work.last !== null) work.last -= 1;
    await db.exec('UPDATE sessions SET value = ? WHERE secret = ?', JSON.stringify(session), secret);
  }
  const upgrade = (headers: Record<string, string>) => mf.dispatchFetch(origin + '/socket', { headers: { upgrade: 'websocket', ...headers } });
  return { atHost: (host: string,path: string,method='GET') => mf.dispatchFetch(host+path,{method}), request, device, action, life, socket, storage, upgrade, origin, skip, nextDay, fetch: (path: string, init?: RequestInit & { headers?: Record<string, string> }) => mf.dispatchFetch(origin + path, init), hibernate: () => mf.unsafeEvictDurableObject('joinallworld-conformance', 'JoinAllworldState', { name: 'joinallworld-v1', webSockets: 'hibernate' }), restart: async () => { for (const socket of sockets) socket.close(); await mf.dispose(); mf = new Miniflare({ ...convertV4MiniflareOptions(options), resourcePersistencePath: join(folder, 'storage'), unsafeInspectDurableObjects: true }); await mf.ready; } };
}

test('Cloudflare: public IDs, origin isolation, atomic duplicate fare, replay window and restart durability', async t => {
  const f = await fixture(t), a = await f.device('Ada'), b = await f.device('Bola');
  assert.notEqual(a.id, a.cookie.slice(4));
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
  await storage.exec('UPDATE sessions SET value = ?, expires_at = ? WHERE secret = ?', JSON.stringify(session), session.expiresAt, a.cookie.slice(4));
  await f.restart();
  assert.equal((await f.life(a)).needs.fun, 60); assert.equal((await f.life(a)).needs.fun, 60);
  const currentStorage = await f.storage();
  const renewed = JSON.parse((await currentStorage.exec('SELECT value FROM sessions'))[0].value);
  assert.ok(renewed.expiresAt > Date.now() + 29 * 86400000);
  renewed.expiresAt = Date.now() - 1;
  await currentStorage.exec('UPDATE sessions SET value = ?, expires_at = ? WHERE secret = ?', JSON.stringify(renewed), renewed.expiresAt, a.cookie.slice(4));
  assert.equal((await f.request('/api/session', null, a.cookie)).status, 401);
  const fresh = await f.device('New life'); assert.notEqual(fresh.id, a.id);
  const archives = await currentStorage.exec('SELECT value FROM archived_lives');
  assert.equal(archives.length, 1); assert.equal(JSON.parse(archives[0].value).cities.lagos.state.needs.fun, 60);
  assert.ok(!archives[0].value.includes(a.cookie.slice(4)));
});

test('Cloudflare: two clients presence, chat dedupe, signaling isolation and travel eviction', async t => {
  const f = await fixture(t), a = await f.device('Ada'), b = await f.device('Bola');
  const x = await f.socket(a), y = await f.socket(b);
  x.send({ type: 'join', cityId: 'lagos', venueId: 'park' });
  const solo = await x.next(); assert.equal(solo.members.length, 1); assert.ok(!JSON.stringify(solo).includes(a.cookie.slice(4))); assert.equal(solo.members[0].muted, true);
  y.send({ type: 'join', cityId: 'ibadan', venueId: 'park' }); await y.next();
  x.send({ type: 'signal', to: b.id, data: { candidate: 'test' } }); assert.equal((await x.next()).code, 'peer_not_in_room');
  y.send({ type: 'join', cityId: 'lagos', venueId: 'park' }); await x.next(); await y.next();
  x.send({ type: 'signal', to: b.id, data: { candidate: 'test' } }); assert.equal((await y.next()).from, a.id);
  const chat = { type: 'chat', body: 'Hello', clientId: randomUUID() };
  x.send(chat); const first = await x.next(); assert.equal((await y.next()).id, first.id); assert.ok(!JSON.stringify(first).includes(a.cookie.slice(4)));
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
});

test('Cloudflare: socket auth, expired open connection and disconnect after hibernation', async t => {
  const f = await fixture(t), a = await f.device('Ada'), b = await f.device('Bola');
  assert.equal((await f.upgrade({ cookie: a.cookie })).status, 403);
  assert.equal((await f.upgrade({ cookie: a.cookie, origin: 'https://foreign.test' })).status, 403);
  assert.equal((await f.upgrade({ origin: f.origin })).status, 401);
  assert.equal((await f.request('/socket', null, a.cookie)).status, 403);
  const x = await f.socket(a), y = await f.socket(b);
  x.send({ type: 'join', cityId: 'lagos', venueId: 'park' }); await x.next();
  y.send({ type: 'join', cityId: 'lagos', venueId: 'park' }); await x.next(); await y.next();
  await f.hibernate();
  const storage = await f.storage();
  const row = (await storage.exec('SELECT value FROM sessions WHERE secret = ?', a.cookie.slice(4)))[0];
  const session = JSON.parse(row.value); session.expiresAt = Date.now() - 1;
  await storage.exec('UPDATE sessions SET value=?,expires_at=? WHERE secret=?', JSON.stringify(session), session.expiresAt, a.cookie.slice(4));
  x.send({ type: 'chat', body: 'Expired', clientId: 'expired' });
  assert.equal((await x.next()).code, 'device_session_required'); assert.equal((await y.next()).members.length, 1);
  assert.equal((await f.upgrade({ origin: f.origin, cookie: a.cookie })).status, 401);
});

test('Cloudflare: voice cap, per-session socket cap, durable rate-limit rejection', async t => {
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
  const storage = await f.storage();
  await f.request("/api/session", null, device.cookie);
  await storage.exec("UPDATE rate_limits SET count=600 WHERE key LIKE 'http:session:%'");
  await f.hibernate();
  assert.equal((await f.request('/api/session', null, device.cookie)).status, 429);
  assert.equal((await f.request('/api/session', null, device.cookie, { 'cf-connecting-ip': '192.0.2.44' })).status, 429);
});

test('Cloudflare: proximity survives hibernation, movement avoids SQL writes and private homes stay isolated', async t => {
  const f = await fixture(t), a = await f.device('Ada'), b = await f.device('Bola');
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
  const f = await fixture(t);
  const devices = [];
  for (let i = 0; i < 12; i++) devices.push(await f.device(`Player ${i}`));
  for (const device of devices) for (let i = 0; i < 51; i++) assert.equal((await f.request('/api/session', null, device.cookie)).status, 200);
  const a = devices[0] as Device;
  const action = { actionId: `${Date.now()}:${randomUUID()}`, type: 'travel', id: 'library', mode: 'cab' };
  assert.equal((await (await f.action(a, action)).json()).state.cash, 4600);
  const storage = await f.storage();
  const session = JSON.parse((await storage.exec('SELECT value FROM sessions WHERE secret=?', a.cookie.slice(4)))[0].value);
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
  const f = await fixture(t), a = await f.device('Ada'); await f.life(a);
  let storage = await f.storage();
  const session = JSON.parse((await storage.exec('SELECT value FROM sessions'))[0].value);
  session.cities.lagos.state.location = 'home'; session.cities.lagos.state.needs.energy = 20;
  await storage.exec('UPDATE sessions SET value=? WHERE secret=?', JSON.stringify(session), a.cookie.slice(4));
  assert.equal((await (await f.action(a, { type: 'spot', id: 'bedroom' })).json()).ok, true);
  assert.equal((await (await f.action(a, { type: 'activity', id: 'nap' })).json()).ok, true);
  const started = JSON.parse((await storage.exec('SELECT value FROM sessions'))[0].value);
  started.cities.lagos.updatedAt -= 3000;
  await storage.exec('UPDATE sessions SET value=? WHERE secret=?', JSON.stringify(started), a.cookie.slice(4));
  await f.hibernate();
  const cancelled = await (await f.action(a, { type: 'cancel' })).json(); assert.equal(cancelled.ok, true); assert.equal(cancelled.state.activeAction, null);
  assert.ok(cancelled.state.needs.energy >= 26 && cancelled.state.needs.energy < 28);
  await f.restart();
  const after = await f.life(a); assert.equal(after.needs.energy, cancelled.state.needs.energy);
});

test('Cloudflare: real static HTML receives response security and cache headers', async t => {
  const f = await fixture(t); const response = await f.request('/');
  assert.equal(response.status, 200); assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); assert.equal(response.headers.get('cache-control'), 'no-cache'); assert.match(await response.text(), /Allworld/);
});

test('Cloudflare: pre-job saves hydrate and award a completed shift once after restart', async t => {
  const f = await fixture(t), a = await f.device('Ada'); await f.life(a);
  let storage = await f.storage();
  const session = JSON.parse((await storage.exec('SELECT value FROM sessions'))[0].value);
  delete session.cities.lagos.state.job; delete session.cities.lagos.state.completedShifts;
  session.cities.lagos.state.homeOwned = true; session.cities.lagos.state.spot = 'work'; session.cities.lagos.updatedAt = 'malformed';
  await storage.exec('UPDATE sessions SET value=? WHERE secret=?', JSON.stringify(session), a.cookie.slice(4));
  assert.equal((await f.life(a)).completedShifts, 0);
  assert.equal((await (await f.action(a, { type: 'apply-job', id: 'community-helper' })).json()).ok, true);
  const shift = { type: 'activity', id: 'helper-shift', actionId: `${Date.now()}:${randomUUID()}` };
  assert.equal((await (await f.action(a, shift)).json()).ok, true);
  const started = JSON.parse((await storage.exec('SELECT value FROM sessions'))[0].value); started.cities.lagos.updatedAt -= 10000;
  await storage.exec('UPDATE sessions SET value=? WHERE secret=?', JSON.stringify(started), a.cookie.slice(4));
  assert.equal((await f.life(a)).completedShifts, 0);
  await f.restart(); storage = await f.storage();
  const halfway = JSON.parse((await storage.exec('SELECT value FROM sessions'))[0].value); halfway.cities.lagos.updatedAt -= 10000;
  await storage.exec('UPDATE sessions SET value=? WHERE secret=?', JSON.stringify(halfway), a.cookie.slice(4));
  const done = await f.life(a); assert.equal(done.cash, 5300); assert.equal(done.completedShifts, 1); assert.equal(done.homeOwned, true);
  assert.equal((await (await f.action(a, shift)).json()).duplicate, true); assert.equal((await f.life(a)).cash, 5300);
});


test('Cloudflare: only two nominated relay testers mint, global budget survives hibernation, errors hide secrets', async t => {
  const publicId = '11111111-1111-4111-8111-111111111111'; let calls = 0; let providerFailure;
  const f = await fixture(t, { bindings: { TURN_TEST_PUBLIC_IDS: publicId, TURN_KEY_ID: 'a'.repeat(32), TURN_API_TOKEN: 'synthetic-api-secret' }, outboundService: async (request: Request) => {
    calls++; try { assert.equal(new URL(request.url).origin, 'https://rtc.live.cloudflare.com'); assert.deepEqual(await request.json(), { ttl: 600 }); } catch (error) { providerFailure = (error as Error).message; }
    return new Response(JSON.stringify({ iceServers: [{ urls: 'turn:turn.cloudflare.com:3478', username: 'synthetic-user', credential: 'synthetic-short-lived' }] }), { status: 201 });
  } });
  const a = await f.device('Tester'), b = await f.device('Other'); const storage = await f.storage();
  const session = JSON.parse((await storage.exec('SELECT value FROM sessions WHERE secret=?', a.cookie.slice(4)))[0].value); session.publicId = publicId;
  await storage.exec('UPDATE sessions SET public_id=?,value=? WHERE secret=?', publicId, JSON.stringify(session), a.cookie.slice(4));
  assert.equal((await f.request('/api/voice-config', null, a.cookie)).status, 403); assert.equal(calls, 0);
  const x = await f.socket(a), y = await f.socket(b); x.send({ type: 'join', cityId: 'lagos', venueId: 'park' }); await x.next(); y.send({ type: 'join', cityId: 'lagos', venueId: 'park' }); await x.next(); await y.next();
  assert.equal((await (await f.request('/api/voice-config', null, b.cookie)).json()).turnConfigured, false); assert.equal(calls, 0);
  const response = await f.request('/api/voice-config', null, a.cookie); const body = await response.json(); assert.equal(response.status, 200, body.error); assert.equal(providerFailure, undefined); assert.equal(calls, 1); assert.equal(body.turnConfigured, true); assert.equal(JSON.stringify(body).includes('synthetic-api-secret'), false); assert.equal(calls, 1);
  await storage.exec('UPDATE turn_budget SET issued=8'); await f.hibernate();
  const limited = await f.request('/api/voice-config', null, a.cookie); assert.equal(limited.status, 429); assert.equal((await limited.json()).error, 'relay_test_limit'); assert.equal(calls, 1);
});

test('Recovery parity: Node and Worker share onboarding, social, blocking, civic, paid retry and authority refusals', async t=>{
 const {fixture:nodeFixture}=await import('../server/test-fixture.js');
 const edge=await fixture(t), node=await nodeFixture(t,{now:Date.now});
 async function sequence(f: Pick<Awaited<ReturnType<typeof fixture>>, 'device' | 'request'>){
   const a=await f.device('Ada'),b=await f.device('Bola'),out=[];
   const call=async(path: string,body?: object | null,who: Device | undefined=a)=>{const r=await f.request(path,body,who?.cookie);const data=await r.json();return {status:r.status,...data};};
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
 const f=await fixture(t),a=await f.device('Ada'),b=await f.device('Bola');
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
 const f=await fixture(t);await f.device('Ada');const storage=await f.storage(),now=Date.now();
 await storage.exec("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<10000) INSERT INTO rate_limits(key,started_at,count,expires_at) SELECT 'expired-'||x,?,1,? FROM n",now-1000,now-1);
 await storage.exec('INSERT INTO rate_limits(key,started_at,count,expires_at) VALUES(?,?,?,?)','long-window',now-1000,5,now+86400000);
 assert.equal((await f.request('/api/health',null,null,{'cf-connecting-ip':'192.0.2.79'})).status,200);
 assert.equal((await storage.exec("SELECT COUNT(*) AS count FROM rate_limits WHERE key LIKE 'expired-%'"))[0].count,0);
 assert.equal((await storage.exec("SELECT count FROM rate_limits WHERE key='long-window'"))[0].count,5);
});
test('Review B3: heartbeat acknowledgements hit the frame limiter before session storage reads',async t=>{
 const f=await fixture(t),a=await f.device('Ada'),x=await f.socket(a),storage=await f.storage();
 await storage.exec('INSERT INTO rate_limits(key,started_at,count,expires_at) VALUES(?,?,?,?)',`ws:${a.id}`,Date.now(),600,Date.now()+60000);
 // If session validation runs first, malformed storage yields an internal error instead.
 await storage.exec('UPDATE sessions SET value=? WHERE secret=?','malformed-json',a.cookie.slice(4));
 x.send({type:'heartbeat-ack'});assert.equal((await x.next()).code,'rate_limited');
 assert.equal((await storage.exec('SELECT count FROM rate_limits WHERE key=?',`ws:${a.id}`))[0].count,601);
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
  const { NPCS } = await import('../src/game/content/npcs.ts');
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
    'd-greet': async () => { await f.travel(ada, 'park'); for (const npc of f.view(await f.life(ada)).social.here.slice(0, 2)) await f.run(ada, 'people', `npc-${npc.id}-hello`); return f.life(ada); },
  };
  // BUG: flaky (pre-existing, seen once in ~5 runs). The three daily missions are dealt at random and `recipes` covers only
  // seven ids, so a deal of d-train, d-gem and d-gist (no recipe) fails the next assertion. Not fixed here.
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
    ['website', 'Allworld', `${ORIGIN}/s/${code}`, `${ORIGIN}/og/allworld.jpg`, 'summary_large_image', `${ORIGIN}/og/allworld.jpg`]);
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
  assert.match(home, /<meta property="og:image" content="https:\/\/play\.example\/og\/allworld\.jpg"/);
  assert.equal((await f.fetch('/og/allworld.jpg')).status, 200);
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
  for (const who of [ada, bola]) assert.ok(!stored.includes(who.cookie.slice(4)), `${who.name}’s cookie secret is in no collection or shard`);
  assert.ok(!stored.includes('device-bola') && !stored.includes('device-ada'), 'a device token is stored only as a salted hash');
});

test('Invitations on the Worker: house link, friend request, first DM, knock and let-in — over sockets, across a sleep', async t => {
  const f = await combined(t);
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
  for (const [mine, theirs] of [[a, bola], [b, ada]] as [Peer, Device][]) assert.ok(!JSON.stringify(mine.seen).includes(theirs.cookie.slice(4)));
});

test('UNILAG on the Worker: a visitor walks the campus, rides the shuttle once, and only a settled life may enrol', async t => {
  const f = await combined(t);
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
