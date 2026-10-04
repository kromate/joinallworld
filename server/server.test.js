import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createServer } from './server.js';

async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'joinallworld-test-'));
  let time = 100000;
  const server = await createServer({ dataDir: dir, now: () => time, sessionTtlMs: 2592000000, ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const sockets = [];
  t.after(async () => { for (const ws of sockets) ws.terminate(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  async function request(path, body, cookie) {
    return fetch(base + path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  }
  async function device(name) { const res = await request('/api/session', { name }); return { cookie: res.headers.get('set-cookie').split(';')[0], ...(await res.json()).session }; }
  async function action(cookie, fields) { return (await request('/api/action', { actionId: `${time}:${randomUUID()}`, cityId: 'lagos', ...fields }, cookie)).json(); }
  async function socket(device) {
    const ws = new WebSocket(base.replace('http', 'ws') + '/socket', { headers: { Cookie: device.cookie, Origin: base } });
    sockets.push(ws); const queue = []; const waiting = [];
    ws.on('message', data => { const message = JSON.parse(data.toString()); const wait = waiting.shift(); if (wait) wait(message); else queue.push(message); });
    await once(ws, 'open');
    return { ws, next: () => queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(Error('Message timeout')), 2000); waiting.push(message => { clearTimeout(timeout); resolve(message); }); }) };
  }
  return { base, request, device, action, socket, advance: ms => { time += ms; }, dir };
}

test('device auth, isolation, concurrent duplicate fare, and server time persist', async t => {
  const f = await fixture(t); const a = await f.device('Ada');
  assert.notEqual(a.id, a.cookie.slice(4));
  const b = await f.device('Bola');
  assert.equal((await f.request('/api/life?city=lagos')).status, 401);
  const actionId = `100000:${randomUUID()}`;
  const fields = { actionId, type: 'travel', id: 'library', mode: 'cab' };
  const [first, second] = await Promise.all([f.action(a.cookie, fields), f.action(a.cookie, fields)]);
  assert.equal(first.state.cash, 4600); assert.equal(second.state.cash, 4600); assert.equal(second.duplicate, true);
  assert.equal((await (await f.request('/api/life?city=lagos', null, b.cookie)).json()).state.cash, 5000);
  assert.equal((await (await f.request('/api/life?city=ibadan', null, a.cookie)).json()).state.cash, 5000);
  f.advance(6000);
  const settled = (await (await f.request('/api/life?city=lagos', null, a.cookie)).json()).state;
  assert.equal(settled.location, 'library'); assert.equal(settled.activeAction, null);
  const conflict = await f.request('/api/action', { ...fields, cityId: 'lagos', id: 'park' }, a.cookie);
  assert.equal(conflict.status, 409);
  const reloaded = await createServer({ dataDir: f.dir, now: () => 106000 });
  reloaded.listen(0, '127.0.0.1'); await once(reloaded, 'listening');
  const response = await fetch(`http://127.0.0.1:${reloaded.address().port}/api/life?city=lagos`, { headers: { Cookie: a.cookie } });
  assert.equal((await response.json()).state.cash, 4600);
  reloaded.closeAllConnections(); await new Promise(resolve => reloaded.close(resolve));
});

test('activity completion awards effects once and cancel grants no effects', async t => {
  const f = await fixture(t); const a = await f.device('Ada');
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
  const f = await fixture(t); const a = await f.device('Ada'); const b = await f.device('Bola');
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
  const f = await fixture(t);
  const res = await fetch(f.base + '/api/session', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Ada' }) });
  assert.equal(res.status, 403);
  const a = await f.device('Ada');
  const ws = new WebSocket(f.base.replace('http', 'ws') + '/socket', { headers: { Cookie: a.cookie, Origin: 'https://evil.example' } });
  const error = await new Promise(resolve => ws.once('error', resolve));
  assert.match(error.message, /403/);
});


test('expired IDs reject replay while fresh IDs work and old receipts are removed', async t => {
  const f = await fixture(t); const a = await f.device('Ada');
  const old = { actionId: `100000:${randomUUID()}`, type: 'travel', id: 'library', mode: 'cab' };
  assert.equal((await f.action(a.cookie, old)).state.cash, 4600);
  f.advance(86400001);
  assert.equal((await f.request('/api/action', { ...old, cityId: 'lagos' }, a.cookie)).status, 409);
  assert.equal((await f.action(a.cookie, { type: 'travel', id: 'park', mode: 'cab' })).state.cash, 4200);
  const database = JSON.parse(await (await import('node:fs/promises')).readFile(join(f.dir, 'devices.json'), 'utf8'));
  assert.equal(Object.keys(database.sessions[a.cookie.slice(4)].actions).length, 1);
});

test('venue membership uses server location and chat failures correlate client IDs', async t => {
  const f = await fixture(t); const a = await f.device('Ada'); const x = await f.socket(a);
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
  const f = await fixture(t); const a = await f.device('Ada'); f.advance(2592000001);
  assert.equal((await f.request('/api/life?city=lagos', null, a.cookie)).status, 401);
});


test('voice room limits eight distinct speakers and exposes public session IDs only', async t => {
  const f = await fixture(t); const peers = [];
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
  const f = await fixture(t); const a = await f.device('Ada');
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
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/session`, { headers: { Cookie: `sid=${secret}` } })).status, 401);
  const database = JSON.parse(await (await import('node:fs/promises')).readFile(join(dir, 'devices.json'), 'utf8'));
  assert.equal(Object.values(database.archivedLives)[0].cities.lagos.state.cash, 4321);
  assert.ok(!JSON.stringify(database).includes(secret));
});


test('day29 authenticated use renews cookie and keeps the same wallet valid on day31', async t => {
  const f = await fixture(t); const a = await f.device('Ada');
  await f.action(a.cookie, { type: 'travel', id: 'library', mode: 'cab' });
  f.advance(29 * 86400000);
  const active = await f.request('/api/session', null, a.cookie);
  assert.equal(active.status, 200);
  assert.match(active.headers.get('set-cookie'), /Max-Age=2592000/);
  assert.equal((await active.json()).serverTime, 100000 + 29 * 86400000);
  f.advance(2 * 86400000);
  const life = await f.request('/api/life?city=lagos', null, a.cookie);
  assert.equal(life.status, 200); assert.match(life.headers.get('set-cookie'), /HttpOnly/);
  const state = await life.json(); assert.equal(state.state.cash, 4600); assert.equal(state.serverTime, 100000 + 31 * 86400000);
  const action = await f.request('/api/action', { actionId: `${state.serverTime}:${randomUUID()}`, cityId: 'lagos', type: 'travel', id: 'park', mode: 'cab' }, a.cookie);
  assert.equal(action.status, 200); assert.match(action.headers.get('set-cookie'), /SameSite=Lax/); assert.equal((await action.json()).serverTime, state.serverTime);
});

test('archived saves do not consume active capacity and remain unchanged', async t => {
  const f = await fixture(t, { maxActiveSessions: 1 }); const a = await f.device('Ada');
  await f.action(a.cookie, { type: 'travel', id: 'library', mode: 'cab' });
  assert.equal((await f.request('/api/session', { name: 'Bola' })).status, 503);
  f.advance(30 * 86400000 + 1);
  const replacement = await f.request('/api/session', { name: 'Bola' }); assert.equal(replacement.status, 200);
  const readDatabase = async () => JSON.parse(await (await import('node:fs/promises')).readFile(join(f.dir, 'devices.json'), 'utf8'));
  const database = await readDatabase();
  assert.equal(Object.keys(database.sessions).length, 1); assert.equal(database.archivedLives[a.id].cities.lagos.state.cash, 4600);
  const preserved = JSON.stringify(database.archivedLives[a.id]);
  await f.request('/api/session', null, replacement.headers.get('set-cookie').split(';')[0]);
  assert.equal(JSON.stringify((await readDatabase()).archivedLives[a.id]), preserved);
});


test('proximity signaling follows validated positions and exclusive radius12', async t => {
  const f = await fixture(t); const a = await f.device('Ada'); const b = await f.device('Bola');
  const x = await f.socket(a); const y = await f.socket(b);
  x.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' }));
  assert.deepEqual((await x.next()).members[0].position, { x: 0, z: 0 });
  y.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' })); await x.next(); await y.next();
  x.ws.send(JSON.stringify({ type: 'move', x: 21, z: 0 })); assert.equal((await x.next()).code, 'invalid_position');
  x.ws.send(JSON.stringify({ type: 'move', x: 20, z: 0 }));
  assert.deepEqual((await x.next()).members.find(member => member.id === a.id).position, { x: 20, z: 0 }); await y.next();
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
  const f = await fixture(t); const a = await f.device('Ada'); const x = await f.socket(a);
  x.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' })); await x.next();
  for (let i = 0; i < 5; i++) { x.ws.send(JSON.stringify({ type: 'move', x: i, z: 0 })); assert.equal((await x.next()).type, 'presence'); }
  x.ws.send(JSON.stringify({ type: 'move', x: 9, z: 0 })); assert.equal((await x.next()).code, 'move_rate_limited');
  f.advance(1001); x.ws.send(JSON.stringify({ type: 'move', x: 9, z: 0 })); assert.equal((await x.next()).members[0].position.x, 9);
});

test('voice configuration requires auth and explicitly reports absent TURN', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/voice-config')).status, 401);
  const a = await f.device('Ada'); const response = await f.request('/api/voice-config', null, a.cookie);
  const config = await response.json();
  assert.equal(config.turnConfigured, false); assert.equal(config.mode, 'stun-only'); assert.equal(config.radius, 12); assert.equal(config.serverTime, 100000);
  assert.equal(config.iceServers[0].urls, 'stun:stun.l.google.com:19302'); assert.ok(!JSON.stringify(config).includes(a.cookie.slice(4)));
});

test('short-lived TURN provider receives public identity and response strips unrelated secrets', async t => {
  let received;
  const f = await fixture(t, { voiceConfigProvider: async session => { received = session; return { iceServers: [{ urls: ['turn:relay.example:3478'], username: 'temporary-user', credential: 'temporary-password', providerSecret: 'hidden-api-key' }], expiresAt: 3700000, providerSecret: 'hidden-api-key' }; } });
  const a = await f.device('Ada'); const response = await f.request('/api/voice-config', null, a.cookie); const config = await response.json();
  assert.deepEqual(received, { id: a.id, name: 'Ada' }); assert.equal(config.turnConfigured, true); assert.equal(config.mode, 'turn'); assert.equal(config.expiresAt, 3700000);
  assert.equal(config.iceServers[0].credential, 'temporary-password'); assert.ok(!JSON.stringify(config).includes('hidden-api-key')); assert.ok(!JSON.stringify(config).includes(a.cookie.slice(4)));
});

test('failed or expired TURN configuration returns a credential-free error', async t => {
  const f = await fixture(t, { voiceConfigProvider: async () => { throw Error('hidden-provider-api-key'); } });
  const a = await f.device('Ada'); const response = await f.request('/api/voice-config', null, a.cookie);
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'voice_config_unavailable' });
  const expired = await fixture(t, { voiceConfigProvider: async () => ({ iceServers: [{ urls: 'turn:relay.example', username: 'test', credential: 'secret' }], expiresAt: 99999 }) });
  const b = await expired.device('Bola'); assert.equal((await expired.request('/api/voice-config', null, b.cookie)).status, 503);
});


test('movement keeps JSON unchanged between at-most-minute session renewals', async t => {
  const f = await fixture(t); const a = await f.device('Ada'); const x = await f.socket(a);
  x.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' })); await x.next();
  const filesystem = await import('node:fs/promises');
  const signature = async () => { const info = await filesystem.stat(join(f.dir, 'devices.json'), { bigint: true }); return `${info.ino}:${info.mtimeNs}`; };
  const baseline = await signature();
  for (let i = 0; i < 5; i++) { x.ws.send(JSON.stringify({ type: 'move', x: i, z: 0 })); await x.next(); assert.equal(await signature(), baseline); }
  f.advance(60000); x.ws.send(JSON.stringify({ type: 'move', x: 5, z: 0 })); await x.next();
  const renewed = await signature(); assert.notEqual(renewed, baseline);
  for (let i = 0; i < 4; i++) { x.ws.send(JSON.stringify({ type: 'move', x: i, z: 0 })); await x.next(); assert.equal(await signature(), renewed); }
});

test('departure removes room membership immediately and city switching removes prior presence', async t => {
  const f = await fixture(t); const a = await f.device('Ada'); const b = await f.device('Bola');
  const x = await f.socket(a); const y = await f.socket(b);
  x.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' })); await x.next();
  y.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' })); await x.next(); await y.next();
  assert.equal((await f.action(a.cookie, { type: 'travel', id: 'library', mode: 'cab' })).ok, true);
  assert.equal((await x.next()).code, 'venue_mismatch'); assert.equal((await y.next()).members.length, 1);
  x.ws.send(JSON.stringify({ type: 'signal', to: b.id, data: { candidate: 'after departure' } })); assert.equal((await x.next()).code, 'join_required');
  x.ws.send(JSON.stringify({ type: 'join', cityId: 'ibadan', venueId: 'park' })); assert.equal((await x.next()).members.length, 1);
  y.ws.send(JSON.stringify({ type: 'join', cityId: 'ibadan', venueId: 'park' })); assert.equal((await x.next()).members.length, 2); await y.next();
  x.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' })); assert.equal((await x.next()).code, 'venue_mismatch');
  f.advance(6000); x.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'library' }));
  assert.equal((await y.next()).members.length, 1); assert.equal((await x.next()).members.length, 1);
});


test('home presence chat and signals stay isolated between device identities', async t => {
  const f = await fixture(t); const a = await f.device('Ada'); const b = await f.device('Bola');
  await f.action(a.cookie, { type: 'travel', id: 'home', mode: 'trek' }); await f.action(b.cookie, { type: 'travel', id: 'home', mode: 'trek' }); f.advance(6000);
  const x = await f.socket(a); const y = await f.socket(b); const same = await f.socket(a);
  x.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'home' })); assert.equal((await x.next()).members.length, 1);
  y.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'home' })); assert.equal((await y.next()).members.length, 1);
  same.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'home' })); assert.equal((await same.next()).members.length, 1); await x.next();
  x.ws.send(JSON.stringify({ type: 'signal', to: b.id, data: { candidate: 'other home' } })); assert.equal((await x.next()).code, 'peer_not_in_room');
  x.ws.send(JSON.stringify({ type: 'chat', body: 'Private home', clientId: 'home-chat' })); const chat = await x.next(); assert.equal((await same.next()).id, chat.id);
  y.ws.send(JSON.stringify({ type: 'voice-state', enabled: true, muted: true })); const own = await y.next(); assert.equal(own.type, 'presence'); assert.equal(own.members[0].id, b.id);
  assert.equal((await f.request('/api/life?city=lagos', null, a.cookie)).status, 200);
  x.ws.send(JSON.stringify({ type: 'chat', body: 'Still home', clientId: 'home-chat-2' })); assert.equal((await x.next()).type, 'chat'); assert.equal((await same.next()).type, 'chat');
});
