import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createServer } from './server.ts';

import { fixture } from './test-fixture.ts';
import type { AddressInfo } from 'node:net';
import type { FixtureOptions } from './test-fixture.ts';
import type { ActionAttempt } from './test-fixture.ts';
import type { AllworldServer } from './server.ts';
import type { Database } from './types.ts';
import type { LifeState } from '../src/types/index.ts';

/** What a JSON answer may carry in these tests (the documented bodies, read loosely). */
interface Body {
  ok?: boolean; code?: string; duplicate?: boolean; error?: string; serverTime: number; state: LifeState
  turnConfigured: boolean; mode: string; radius: number; expiresAt: number
  iceServers: { urls: string | string[]; credential?: string }[]
}
type Typed = Omit<Response, 'json'> & { json(): Promise<Body> };
/** A frame the server sent, read loosely: the fields a test looks at, and `undefined` where a frame has none. */
interface Frame {
  type: string; code?: string; error?: string; clientId?: string; id?: string; from?: string; to?: string
  data: { candidate?: string }; members: { id: string; enabled: boolean; position: { x: number; z: number } }[]
}
interface Peer { ws: WebSocket; next(): Promise<Frame> }
const portOf = (server: AllworldServer): number => (server.address() as AddressInfo).port;
const must = <T>(value: T | null | undefined, what = 'value'): T => {
  if (value === null || value === undefined) throw new Error(`expected a ${what}`);
  return value;
};
const fetchTyped = (...args: Parameters<typeof fetch>): Promise<Typed> => fetch(...args) as unknown as Promise<Typed>;
/** The fixture with its requests and sockets read as the documented bodies and frames. */
async function fixtureOf(t: Parameters<typeof fixture>[0], options?: FixtureOptions) {
  const f = await fixture(t, options);
  const peer = (raw: Awaited<ReturnType<typeof f.socket>>): Peer => ({ ws: raw.ws, next: async () => (await raw.next()) as unknown as Frame });
  return {
    ...f,
    request: (...args: Parameters<typeof f.request>): Promise<Typed> => f.request(...args) as unknown as Promise<Typed>,
    socket: async (...args: Parameters<typeof f.socket>): Promise<Peer> => peer(await f.socket(...args)),
    joinRoom: async (...args: Parameters<typeof f.joinRoom>): Promise<Peer> => peer(await f.joinRoom(...args)),
  };
}

test('device auth, isolation, concurrent duplicate fare, and server time persist', async t => {
  const f = await fixtureOf(t); const a = await f.device('Ada');
  assert.notEqual(a.id, a.cookie.slice(4));
  const b = await f.device('Bola');
  assert.equal((await f.request('/api/life?city=lagos')).status, 401);
  const actionId = `100000:${randomUUID()}`;
  const fields: ActionAttempt = { actionId, type: 'travel', id: 'library', mode: 'cab' };
  const [first, second] = await Promise.all([f.action(a.cookie, fields), f.action(a.cookie, fields)]);
  assert.equal(first.state.cash, 4600); assert.equal(second.state.cash, 4600); assert.equal(second.duplicate, true);
  assert.equal((await (await f.request('/api/life?city=lagos', null, b.cookie)).json()).state.cash, 5000);
  const otherCity = await f.request('/api/life?city=ibadan', null, a.cookie);
  assert.deepEqual([otherCity.status, (await otherCity.json()).error], [409, 'city_moved']);
  f.advance(6000);
  const settled = (await (await f.request('/api/life?city=lagos', null, a.cookie)).json()).state;
  assert.equal(settled.location, 'library'); assert.equal(settled.activeAction, null);
  const conflict = await f.request('/api/action', { ...fields, cityId: 'lagos', id: 'park' }, a.cookie);
  assert.equal(conflict.status, 409);
  const reloaded = await createServer({ dataDir: f.dir, now: () => 106000 });
  reloaded.listen(0, '127.0.0.1'); await once(reloaded, 'listening');
  const response = await fetchTyped(`http://127.0.0.1:${portOf(reloaded)}/api/life?city=lagos`, { headers: { Cookie: a.cookie } });
  assert.equal((await response.json()).state.cash, 4600);
  reloaded.closeAllConnections(); await new Promise(resolve => reloaded.close(resolve));
});

test('activity completion awards effects once and cancel grants no effects', async t => {
  const f = await fixtureOf(t); const a = await f.device('Ada');
  await f.action(a.cookie, { type: 'spot', id: 'trees' });
  await f.action(a.cookie, { type: 'activity', id: 'chill' });
  f.advance(12000);
  const read = async () => (await (await f.request('/api/life?city=lagos', null, a.cookie)).json()).state;
  assert.equal((await read()).needs.fun, 60); assert.equal((await read()).needs.fun, 60);
  await f.action(a.cookie, { type: 'activity', id: 'chill' });
  await f.action(a.cookie, { type: 'cancel' }); f.advance(12000);
  assert.equal((await read()).needs.fun, 60);
});

test('rooms expose actual presence, dedupe chat, and block cross-room signaling', async t => {
  const f = await fixtureOf(t); const a = await f.device('Ada'); const b = await f.device('Bola');
  const x = await f.socket(a); const y = await f.socket(b);
  x.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' })); const solo = await x.next(); assert.equal(solo.members.length, 1); assert.ok(!JSON.stringify(solo).includes(a.cookie.slice(4)));
  y.ws.send(JSON.stringify({ type: 'join', cityId: 'ibadan', venueId: 'park' })); await y.next();
  x.ws.send(JSON.stringify({ type: 'signal', to: b.id, data: { candidate: 'test' } })); assert.equal((await x.next()).error, 'peer_not_in_room');
  y.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' }));
  assert.equal((await x.next()).members.length, 2); await y.next();
  x.ws.send(JSON.stringify({ type: 'signal', to: b.id, data: { candidate: 'test' } })); const signal = await y.next(); assert.equal(signal.from, a.id); assert.ok(!JSON.stringify(signal).includes(a.cookie.slice(4)));
  const chat = { type: 'chat', body: 'Hello', clientId: randomUUID() };
  x.ws.send(JSON.stringify(chat)); const original = await x.next(); assert.ok(!JSON.stringify(original).includes(a.cookie.slice(4))); assert.equal((await y.next()).id, original.id);
  x.ws.send(JSON.stringify(chat)); assert.equal((await x.next()).id, original.id);
  y.ws.close(); await once(y.ws, 'close'); assert.equal((await x.next()).members.length, 1);
});

test('rejects hostile HTTP origins and websocket origins', async t => {
  const f = await fixtureOf(t);
  const res = await fetchTyped(f.base + '/api/session', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Ada' }) });
  assert.equal(res.status, 403);
  const a = await f.device('Ada');
  const ws = new WebSocket(f.base.replace('http', 'ws') + '/socket', { headers: { Cookie: a.cookie, Origin: 'https://evil.example' } });
  const error = await new Promise<Error>(resolve => ws.once('error', resolve));
  assert.match(error.message, /403/);
});


test('expired IDs reject replay while fresh IDs work and old receipts are removed', async t => {
  const f = await fixtureOf(t); const a = await f.device('Ada');
  const old: ActionAttempt = { actionId: `100000:${randomUUID()}`, type: 'travel', id: 'library', mode: 'cab' };
  assert.equal((await f.action(a.cookie, old)).state.cash, 4600);
  f.advance(86400001);
  assert.equal((await f.request('/api/action', { ...old, cityId: 'lagos' }, a.cookie)).status, 409);
  assert.equal((await f.action(a.cookie, { type: 'travel', id: 'park', mode: 'cab' })).state.cash, 4200);
  const database = JSON.parse(await (await import('node:fs/promises')).readFile(join(f.dir, 'devices.json'), 'utf8'));
  assert.equal(Object.keys(database.sessions[a.cookie.slice(4)].actions).length, 1);
});

test('venue membership uses server location and chat failures correlate client IDs', async t => {
  const f = await fixtureOf(t); const a = await f.device('Ada'); const x = await f.socket(a);
  x.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'library' }));
  assert.equal((await x.next()).code, 'venue_mismatch');
  x.ws.send(JSON.stringify({ type: 'chat', clientId: 'retry-1', body: 'Hello' }));
  const error = await x.next(); assert.equal(error.clientId, 'retry-1'); assert.equal(error.code, 'join_required');
  await f.action(a.cookie, { type: 'travel', id: 'library', mode: 'cab' });
  x.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'library' })); assert.equal((await x.next()).code, 'venue_mismatch');
  f.advance(6000);
  x.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'library' })); assert.equal((await x.next()).members.length, 1);
});

test('expired sessions cannot read persisted life', async t => {
  const f = await fixtureOf(t); const a = await f.device('Ada'); f.advance(2592000001);
  assert.equal((await f.request('/api/life?city=lagos', null, a.cookie)).status, 401);
});


test('voice room limits eight distinct speakers and exposes public session IDs only', async t => {
  const f = await fixtureOf(t); const peers = [];
  for (let i = 0; i < 9; i++) {
    const device = await f.device(`Person ${i}`); const peer = await f.socket(device);
    peer.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' })); await peer.next();
    peers.push(peer);
    for (const earlier of peers.slice(0, -1)) await earlier.next();
    peer.ws.send(JSON.stringify({ type: 'voice-state', enabled: true, muted: true }));
    const result = await peer.next();
    if (i < 8) { assert.equal(result.members.filter(member => member.enabled).length, i + 1); for (const earlier of peers.slice(0, -1)) await earlier.next(); }
    else assert.equal(result.code, 'voice_room_full');
    const session = await f.request('/api/session', null, device.cookie);
    assert.ok(!(await session.text()).includes(device.cookie.slice(4)));
    assert.equal((await f.request('/api/session', null, `sid=${device.id}`)).status, 401);
  }
});


test('expired credentials archive durable wallet without retaining authentication secret', async t => {
  const f = await fixtureOf(t); const a = await f.device('Ada');
  await f.action(a.cookie, { type: 'travel', id: 'library', mode: 'cab' });
  f.advance(2592000001);
  assert.equal((await f.request('/api/life?city=lagos', null, a.cookie)).status, 401);
  await f.device('Another person');
  const database = JSON.parse(await (await import('node:fs/promises')).readFile(join(f.dir, 'devices.json'), 'utf8'));
  assert.equal(database.sessions[a.cookie.slice(4)], undefined);
  assert.equal(database.archivedLives[a.id].cities.lagos.state.cash, 4600);
  assert.ok(!JSON.stringify(database.archivedLives).includes(a.cookie.slice(4)));
});

test('legacy exposed credentials are revoked while existing saves are archived', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'joinallworld-legacy-'));
  const secret = randomUUID();
  await (await import('node:fs/promises')).writeFile(join(dir, 'devices.json'), JSON.stringify({ version: 1, sessions: { [secret]: { id: secret, name: 'Old Ada', cities: { lagos: { state: { cash: 4321 } } }, actions: {} } } }));
  const server = await createServer({ dataDir: dir });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  assert.equal((await fetchTyped(`http://127.0.0.1:${portOf(server)}/api/session`, { headers: { Cookie: `sid=${secret}` } })).status, 401);
  const database = JSON.parse(await (await import('node:fs/promises')).readFile(join(dir, 'devices.json'), 'utf8'));
  assert.equal(must(must(Object.values((database as Database).archivedLives ?? {})[0]).cities.lagos).state.cash, 4321);
  assert.ok(!JSON.stringify(database).includes(secret));
});


test('day29 authenticated use renews cookie and keeps the same wallet valid on day31', async t => {
  const f = await fixtureOf(t); const a = await f.device('Ada');
  await f.action(a.cookie, { type: 'travel', id: 'library', mode: 'cab' });
  f.advance(29 * 86400000);
  const active = await f.request('/api/session', null, a.cookie);
  assert.equal(active.status, 200);
  assert.match(must(active.headers.get('set-cookie')), /Max-Age=2592000/);
  assert.equal((await active.json()).serverTime, 100000 + 29 * 86400000);
  f.advance(2 * 86400000);
  const life = await f.request('/api/life?city=lagos', null, a.cookie);
  assert.equal(life.status, 200); assert.match(must(life.headers.get('set-cookie')), /HttpOnly/);
  const state = await life.json(); assert.equal(state.state.cash, 4600); assert.equal(state.serverTime, 100000 + 31 * 86400000);
  const action = await f.request('/api/action', { actionId: `${state.serverTime}:${randomUUID()}`, cityId: 'lagos', type: 'travel', id: 'park', mode: 'cab' }, a.cookie);
  assert.equal(action.status, 200); assert.match(must(action.headers.get('set-cookie')), /SameSite=Lax/); assert.equal((await action.json()).serverTime, state.serverTime);
});

test('archived saves do not consume active capacity and remain unchanged', async t => {
  const f = await fixtureOf(t, { maxActiveSessions: 1 }); const a = await f.device('Ada');
  await f.action(a.cookie, { type: 'travel', id: 'library', mode: 'cab' });
  assert.equal((await f.request('/api/session', { name: 'Bola' })).status, 503);
  f.advance(30 * 86400000 + 1);
  const replacement = await f.request('/api/session', { name: 'Bola' }); assert.equal(replacement.status, 200);
  const readDatabase = async () => JSON.parse(await (await import('node:fs/promises')).readFile(join(f.dir, 'devices.json'), 'utf8'));
  const database = await readDatabase();
  assert.equal(Object.keys(database.sessions).length, 1); assert.equal(database.archivedLives[a.id].cities.lagos.state.cash, 4600);
  const preserved = JSON.stringify(database.archivedLives[a.id]);
  await f.request('/api/session', null, must(replacement.headers.get('set-cookie')).split(';')[0]);
  assert.equal(JSON.stringify((await readDatabase()).archivedLives[a.id]), preserved);
});


test('proximity signaling follows validated positions and exclusive radius12', async t => {
  const f = await fixtureOf(t); const a = await f.device('Ada'); const b = await f.device('Bola');
  const x = await f.socket(a); const y = await f.socket(b);
  x.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' }));
  assert.deepEqual(must((await x.next()).members[0]).position, { x: 0, z: 0 });
  y.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' })); await x.next(); await y.next();
  x.ws.send(JSON.stringify({ type: 'move', x: 21, z: 0 })); assert.equal((await x.next()).code, 'invalid_position');
  x.ws.send(JSON.stringify({ type: 'move', x: 20, z: 0 }));
  assert.deepEqual(must((await x.next()).members.find(member => member.id === a.id)).position, { x: 20, z: 0 }); await y.next();
  x.ws.send(JSON.stringify({ type: 'signal', to: b.id, data: { description: { type: 'offer', sdp: 'test' } } }));
  assert.equal((await x.next()).code, 'peer_out_of_range');
  y.ws.send(JSON.stringify({ type: 'move', x: 8, z: 0 })); await x.next(); await y.next();
  x.ws.send(JSON.stringify({ type: 'signal', to: b.id, data: { candidate: 'boundary' } })); assert.equal((await x.next()).code, 'peer_out_of_range');
  y.ws.send(JSON.stringify({ type: 'move', x: 8.1, z: 0 })); await x.next(); await y.next();
  x.ws.send(JSON.stringify({ type: 'signal', to: b.id, data: { candidate: 'nearby' } })); assert.equal((await y.next()).data.candidate, 'nearby');
  y.ws.send(JSON.stringify({ type: 'move', x: 7.9, z: 0 })); await x.next(); await y.next();
  x.ws.send(JSON.stringify({ type: 'signal', to: b.id, data: { candidate: 'far' } })); assert.equal((await x.next()).code, 'peer_out_of_range');
});

test('movement accepts five updates per second and resets its rate window', async t => {
  const f = await fixtureOf(t); const a = await f.device('Ada'); const x = await f.socket(a);
  x.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' })); await x.next();
  for (let i = 0; i < 5; i++) { x.ws.send(JSON.stringify({ type: 'move', x: i, z: 0 })); assert.equal((await x.next()).type, 'presence'); }
  x.ws.send(JSON.stringify({ type: 'move', x: 9, z: 0 })); assert.equal((await x.next()).code, 'move_rate_limited');
  f.advance(1001); x.ws.send(JSON.stringify({ type: 'move', x: 9, z: 0 })); assert.equal(must((await x.next()).members[0]).position.x, 9);
});

test('voice configuration requires auth and explicitly reports absent TURN', async t => {
  const f = await fixtureOf(t);
  assert.equal((await f.request('/api/voice-config')).status, 401);
  const a = await f.device('Ada'); await f.joinRoom(a); const response = await f.request('/api/voice-config', null, a.cookie);
  const config = await response.json();
  assert.equal(config.turnConfigured, false); assert.equal(config.mode, 'stun-only'); assert.equal(config.radius, 12); assert.equal(config.serverTime, 100000);
  assert.equal(must(config.iceServers[0]).urls, 'stun:stun.l.google.com:19302'); assert.ok(!JSON.stringify(config).includes(a.cookie.slice(4)));
});

test('short-lived TURN provider receives public identity and response strips unrelated secrets', async t => {
  let received;
  const f = await fixtureOf(t, { voiceConfigProvider: async session => { received = session; return { iceServers: [{ urls: ['turn:relay.example:3478'], username: 'temporary-user', credential: 'temporary-password', providerSecret: 'hidden-api-key' }], expiresAt: 3700000, providerSecret: 'hidden-api-key' }; } });
  const a = await f.device('Ada'); await f.joinRoom(a); const response = await f.request('/api/voice-config', null, a.cookie); const config = await response.json();
  assert.deepEqual(received, { id: a.id, name: 'Ada' }); assert.equal(config.turnConfigured, true); assert.equal(config.mode, 'turn'); assert.equal(config.expiresAt, 3700000);
  assert.equal(must(config.iceServers[0]).credential, 'temporary-password'); assert.ok(!JSON.stringify(config).includes('hidden-api-key')); assert.ok(!JSON.stringify(config).includes(a.cookie.slice(4)));
});

test('failed or expired TURN configuration returns a credential-free error', async t => {
  const f = await fixtureOf(t, { voiceConfigProvider: async () => { throw Error('hidden-provider-api-key'); } });
  const a = await f.device('Ada'); await f.joinRoom(a); const response = await f.request('/api/voice-config', null, a.cookie);
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'voice_config_unavailable' });
  const expired = await fixtureOf(t, { voiceConfigProvider: async () => ({ iceServers: [{ urls: 'turn:relay.example', username: 'test', credential: 'secret' }], expiresAt: 99999 }) });
  const b = await expired.device('Bola'); await expired.joinRoom(b); assert.equal((await expired.request('/api/voice-config', null, b.cookie)).status, 503);
});


test('movement keeps JSON unchanged between at-most-minute session renewals', async t => {
  const f = await fixtureOf(t); const a = await f.device('Ada'); const x = await f.socket(a);
  x.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' })); await x.next();
  const filesystem = await import('node:fs/promises');
  const signature = async () => { const info = await filesystem.stat(join(f.dir, 'devices.json'), { bigint: true }); return `${info.ino}:${info.mtimeNs}`; };
  // Joining settled the life, and the world service then recorded the plot it allocated: let that write land first.
  await f.server.world.idle(); await f.flush();
  const baseline = await signature();
  for (let i = 0; i < 5; i++) { x.ws.send(JSON.stringify({ type: 'move', x: i, z: 0 })); await x.next(); assert.equal(await signature(), baseline); }
  f.advance(60000); x.ws.send(JSON.stringify({ type: 'move', x: 5, z: 0 })); await x.next();
  const renewed = await signature(); assert.notEqual(renewed, baseline);
  for (let i = 0; i < 4; i++) { x.ws.send(JSON.stringify({ type: 'move', x: i, z: 0 })); await x.next(); assert.equal(await signature(), renewed); }
});

test('departure removes room membership immediately and cross-city room joins are refused', async t => {
  const f = await fixtureOf(t); const a = await f.device('Ada'); const b = await f.device('Bola');
  const x = await f.socket(a); const y = await f.socket(b);
  x.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' })); await x.next();
  y.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' })); await x.next(); await y.next();
  assert.equal((await f.action(a.cookie, { type: 'travel', id: 'library', mode: 'cab' })).ok, true);
  assert.equal((await x.next()).code, 'venue_mismatch'); assert.equal((await y.next()).members.length, 1);
  x.ws.send(JSON.stringify({ type: 'signal', to: b.id, data: { candidate: 'after departure' } })); assert.equal((await x.next()).code, 'join_required');
  x.ws.send(JSON.stringify({ type: 'join', cityId: 'ibadan', venueId: 'park' })); assert.equal((await x.next()).code, 'city_moved');
  y.ws.send(JSON.stringify({ type: 'join', cityId: 'ibadan', venueId: 'park' })); assert.equal((await y.next()).code, 'city_moved');
  x.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' })); assert.equal((await x.next()).code, 'venue_mismatch');
  f.advance(6000); x.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'library' }));
  assert.equal((await x.next()).members.length, 1);
});


test('home presence chat and signals stay isolated between device identities', async t => {
  const f = await fixtureOf(t); const a = await f.device('Ada'); const b = await f.device('Bola');
  await f.action(a.cookie, { type: 'travel', id: 'home', mode: 'trek' }); await f.action(b.cookie, { type: 'travel', id: 'home', mode: 'trek' }); f.advance(19000); // the trek home takes 18 s
  const x = await f.socket(a); const y = await f.socket(b); const same = await f.socket(a);
  x.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'home' })); assert.equal((await x.next()).members.length, 1);
  y.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'home' })); assert.equal((await y.next()).members.length, 1);
  same.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'home' })); assert.equal((await same.next()).members.length, 1); await x.next();
  x.ws.send(JSON.stringify({ type: 'signal', to: b.id, data: { candidate: 'other home' } })); assert.equal((await x.next()).code, 'peer_not_in_room');
  x.ws.send(JSON.stringify({ type: 'chat', body: 'Private home', clientId: 'home-chat' })); const chat = await x.next(); assert.equal((await same.next()).id, chat.id);
  y.ws.send(JSON.stringify({ type: 'voice-state', enabled: true, muted: true })); const own = await y.next(); assert.equal(own.type, 'presence'); assert.equal(must(own.members[0]).id, b.id);
  assert.equal((await f.request('/api/life?city=lagos', null, a.cookie)).status, 200);
  x.ws.send(JSON.stringify({ type: 'chat', body: 'Still home', clientId: 'home-chat-2' })); assert.equal((await x.next()).type, 'chat'); assert.equal((await same.next()).type, 'chat');
});


test('TURN mint requires a live venue socket and is capped at six requests per minute', async t => {
  let minted = 0;
  const f = await fixtureOf(t, { voiceConfigProvider: async () => { minted++; return { iceServers: [{ urls: 'turn:relay.example', username: 'test', credential: 'temporary' }], expiresAt: 3700000 }; } });
  const a = await f.device('Ada');
  const absent = await f.request('/api/voice-config', null, a.cookie); assert.equal(absent.status, 403); assert.equal(minted, 0);
  const x = await f.joinRoom(a);
  for (let i = 0; i < 6; i++) assert.equal((await f.request('/api/voice-config', null, a.cookie)).status, 200);
  const capped = await f.request('/api/voice-config', null, a.cookie); assert.equal(capped.status, 429); assert.equal((await capped.json()).error, 'voice_config_rate_limited'); assert.equal(minted, 6);
  f.advance(60000); assert.equal((await f.request('/api/voice-config', null, a.cookie)).status, 200); assert.equal(minted, 7);
  await f.action(a.cookie, { type: 'travel', id: 'library', mode: 'trek' }); assert.equal((await x.next()).code, 'venue_mismatch');
  assert.equal((await f.request('/api/voice-config', null, a.cookie)).status, 403); assert.equal(minted, 7);
});

test('Home transport: an invalid mode is refused without charging, a paid ride charges its fare once, trek is free', async t => {
  const f = await fixtureOf(t); const a = await f.device('Ada'); const b = await f.device('Bola');
  const invalid = await f.action(a.cookie, { type: 'travel', id: 'home', mode: 'jetpack' });
  assert.equal(invalid.ok, false); assert.equal(invalid.code, 'invalid_travel'); assert.equal(invalid.state.cash, 5000); assert.equal(invalid.state.activeAction, null);
  // Freedom Park → Home crosses the lagoon: the far-band fares apply and are taken at departure.
  for (const [mode, fare] of [['cab', 550], ['keke', 200], ['danfo', 200], ['okada', 300]] as [string, number][]) {
    const rider = await f.device(`Rider ${mode}`);
    const actionId = `100000:${randomUUID()}`;
    const body = { actionId, cityId: 'lagos', type: 'travel', id: 'home', mode };
    const result = await (await f.request('/api/action', body, rider.cookie)).json();
    assert.equal(result.ok, true, mode); assert.equal(result.state.cash, 5000 - fare, mode); assert.equal(result.state.location, 'park');
    const replay = await (await f.request('/api/action', body, rider.cookie)).json();
    assert.equal(replay.duplicate, true); assert.equal(replay.state.cash, 5000 - fare, `${mode} is charged once`);
  }
  const free = await f.action(b.cookie, { type: 'travel', id: 'home', mode: 'trek' }); assert.equal(free.ok, true); assert.equal(free.state.cash, 5000);
});

test('out-of-range signal error identifies public peer without echoing cookie secret', async t => {
  const f = await fixtureOf(t); const a = await f.device('Ada'); const b = await f.device('Bola');
  const x = await f.joinRoom(a); const y = await f.joinRoom(b); await x.next();
  x.ws.send(JSON.stringify({ type: 'move', x: 20, z: 0 })); await x.next(); await y.next();
  x.ws.send(JSON.stringify({ type: 'signal', to: b.id, data: { candidate: 'far' } })); const denied = await x.next(); assert.equal(denied.code, 'peer_out_of_range'); assert.equal(denied.to, b.id);
  x.ws.send(JSON.stringify({ type: 'signal', to: a.cookie.slice(4), data: { candidate: 'secret' } })); const own = await x.next(); assert.equal(own.to, undefined); assert.ok(!JSON.stringify(own).includes(a.cookie.slice(4)));
  // The caller's own public id is not echoed either, and no frame of this exchange carries the secret.
  x.ws.send(JSON.stringify({ type: 'signal', to: a.id, data: { candidate: 'self' } })); const self = await x.next(); assert.equal(self.to, undefined); assert.ok(!JSON.stringify(self).includes(a.cookie.slice(4)));
  x.ws.send(JSON.stringify({ type: 'signal', to: b.id, data: { candidate: 'far again' } })); const again = await x.next(); assert.equal(again.to, b.id); assert.ok(!JSON.stringify(again).includes(a.cookie.slice(4)));
});


test('job enrollment and shift receipts survive reload and reward completion once', async t => {
  const f = await fixtureOf(t); const a = await f.device('Ada');
  const enrollment: ActionAttempt = { actionId: `100000:${randomUUID()}`, type: 'apply-job', id: 'community-helper' };
  const applied = await f.action(a.cookie, enrollment); assert.equal(applied.ok, true); assert.equal(applied.state.job, 'community-helper');
  const duplicate = await f.action(a.cookie, enrollment); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.state.cash, 5000);
  await f.action(a.cookie, { type: 'spot', id: 'work' });
  const shift: ActionAttempt = { actionId: `100000:${randomUUID()}`, type: 'activity', id: 'helper-shift' };
  assert.equal((await f.action(a.cookie, shift)).ok, true); f.advance(10000);
  const midway = await (await f.request('/api/life?city=lagos', null, a.cookie)).json(); assert.equal(must(midway.state.activeAction).remaining, 10); assert.equal(midway.state.cash, 5000);
  const reloaded = await createServer({ dataDir: f.dir, now: () => 121000 });
  reloaded.listen(0, '127.0.0.1'); await once(reloaded, 'listening');
  t.after(async () => { reloaded.closeAllConnections(); await new Promise(resolve => reloaded.close(resolve)); });
  const base = `http://127.0.0.1:${portOf(reloaded)}`;
  const read = async () => (await (await fetchTyped(base + '/api/life?city=lagos', { headers: { Cookie: a.cookie } })).json()).state;
  const completed = await read(); assert.equal(completed.cash, 5300); assert.equal(completed.completedShifts, 1); assert.equal(completed.job, 'community-helper'); assert.equal(completed.needs.energy, 40); assert.equal(completed.needs.hunger, 45); assert.equal(completed.activeAction, null);
  assert.equal((await read()).cash, 5300); assert.equal((await read()).completedShifts, 1);
  const retried = await fetchTyped(base + '/api/action', { method: 'POST', headers: { Cookie: a.cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...shift, cityId: 'lagos' }) });
  const receipt = await retried.json(); assert.equal(receipt.duplicate, true); assert.equal(receipt.state.cash, 5300); assert.equal(receipt.state.activeAction, null); assert.equal(receipt.state.completedShifts, 1);
});


test('pre-job saves hydrate before timers and complete their first shift with a finite counter', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'joinallworld-pre-job-')); const secret = randomUUID(); const publicId = randomUUID();
  const filesystem = await import('node:fs/promises'); let time = 100000;
  const oldState = { cash: 5000, name: 'Ada', homeOwned: true, needs: { hunger: 50, energy: 50, fun: 50, social: 50, hygiene: 50, bladder: 50 }, location: 'park', spot: 'work', activeAction: null, message: '' };
  await filesystem.writeFile(join(dir, 'devices.json'), JSON.stringify({ version: 1, sessions: { [secret]: { secret, publicId, name: 'Ada', expiresAt: 2592100000, cities: { lagos: { state: oldState, updatedAt: 'malformed' } }, actions: {} } } }));
  let server = await createServer({ dataDir: dir, now: () => time });
  const listen = async () => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${portOf(server)}`; };
  let base = await listen();
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  const request = async (path: string, body?: object): Promise<Body> => { const response = await fetchTyped(base + path, { method: body ? 'POST' : 'GET', headers: { Cookie: `sid=${secret}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify({ actionId: `${time}:${randomUUID()}`, cityId: 'lagos', ...body }) : undefined }); return response.json(); };
  const hydrated = (await request('/api/life?city=lagos')).state;
  assert.equal(hydrated.job, null); assert.equal(hydrated.completedShifts, 0); assert.equal(hydrated.cash, 5000); assert.equal(hydrated.homeOwned, true);
  assert.equal((await request('/api/action', { type: 'apply-job', id: 'community-helper' })).ok, true);
  assert.equal((await request('/api/action', { type: 'activity', id: 'helper-shift' })).ok, true);
  time += 10000; const midway = (await request('/api/life?city=lagos')).state; assert.equal(must(midway.activeAction).remaining, 10); assert.equal(midway.completedShifts, 0);
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  server = await createServer({ dataDir: dir, now: () => time }); base = await listen();
  assert.equal(must((await request('/api/life?city=lagos')).state.activeAction).remaining, 10);
  time += 10000; const done = (await request('/api/life?city=lagos')).state;
  assert.equal(done.cash, 5300); assert.equal(done.completedShifts, 1); assert.equal(done.job, 'community-helper'); assert.equal(done.homeOwned, true); assert.equal(done.activeAction, null);
  assert.equal((await request('/api/life?city=lagos')).state.completedShifts, 1);
});
