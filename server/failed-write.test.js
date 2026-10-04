// What a player and the rest of the server see when the data file cannot be written.
// The store-level guarantee is tested in store.test.js; this file drives it through real HTTP
// and WebSocket requests with an injected write failure (test-fixture.js flakyDisk).
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, flakyDisk } from './test-fixture.js';
import { createServer } from './server.js';

const HOUR = 3600000;
const TOKEN = 'operator-token-for-tests-0123456789';
const get = async (f, path, who) => { const res = await f.request(path, null, who?.cookie); return { status: res.status, ...(await res.json()) }; };
const post = async (f, path, body, who) => { const res = await f.request(path, body, who?.cookie); return { status: res.status, ...(await res.json()) }; };
const database = async (f) => JSON.parse(await readFile(join(f.dir, 'devices.json'), 'utf8'));
const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(peer, check) {
  for (let i = 0; i < 300; i++) { const message = await peer.next(); if (typeof check === 'string' ? message.type === check : check(message)) return message; }
  throw Error('No such message');
}
const life = async (f, who) => (await get(f, '/api/life?city=lagos', who)).state;
/** Two friends old enough to send gifts, the sender holding earned money (seeded: the rules themselves stay on). */
async function friends(f, names) {
  const devices = [];
  for (const name of names) { const device = await f.device(name); await get(f, '/api/social/me', device); await life(f, device); devices.push(device); }
  const [a, b] = devices;
  await f.server.store.transact((db) => {
    const session = (who) => Object.values(db.sessions).find((item) => item.publicId === who.id);
    for (const who of devices) db.social.players[who.id].first = f.now() - 25 * HOUR;
    db.social.players[a.id].friends[b.id] = db.social.players[b.id].friends[a.id] = f.now() - 2 * HOUR;
    const state = session(a).cities.lagos.state; state.cash = 10000; state.social.earned = 5000;
  });
  return devices;
}

test('a departure whose write fails did not happen: 503, the life and the room are unchanged; the same action id then applies exactly once', async (t) => {
  const disk = flakyDisk();
  const f = await fixture(t, { disk, heartbeatMs: 60000 });
  const A = await f.device('Ada'), B = await f.device('Bola');
  const a = await f.joinRoom(A), b = await f.joinRoom(B);
  a.ws.send(JSON.stringify({ type: 'voice-state', enabled: true, muted: false }));
  await until(b, (m) => m.type === 'presence' && m.members.some((x) => x.id === A.id && x.enabled));
  const before = await life(f, A);
  assert.equal(before.location, 'park');

  disk.fail = 'ENOSPC';
  const action = { actionId: f.id(), cityId: 'lagos', type: 'travel', id: 'library', mode: 'danfo' };
  const failed = await post(f, '/api/action', action, A);
  assert.deepEqual([failed.status, failed.error], [503, 'storage_unavailable']);
  assert.match(failed.reason, /nothing was changed/i);
  // Nothing happened, in memory or on disk: she has not left, was not charged, and holds no receipt.
  const during = await get(f, '/api/life?city=lagos', A);
  assert.equal(during.status, 200, 'a quiet poll still works while writes fail');
  assert.equal(during.storage, 'failing', 'and says that nothing is being saved');
  assert.deepEqual([during.state.location, during.state.activeAction, during.state.cash], ['park', null, before.cash]);
  assert.equal(await f.server.store.read((db) => Object.values(db.sessions).find((item) => item.publicId === A.id).actions[action.actionId]), undefined);
  // So the room is exactly as consistent as before: she is still a member, not revoked, and can still signal.
  a.ws.send(JSON.stringify({ type: 'signal', to: B.id, data: { probe: 'still here' } }));
  assert.deepEqual((await until(b, 'signal')).data, { probe: 'still here' });
  b.ws.send(JSON.stringify({ type: 'voice-state', enabled: false, muted: true }));
  const roster = await until(b, 'presence');
  assert.equal(roster.members.find((m) => m.id === A.id)?.enabled, true);
  assert.equal((await database(f)).sessions[A.cookie.slice(4)].cities.lagos.state.location, 'park');

  // The disk is back. The SAME request is applied now — once.
  disk.fail = null;
  const retry = await post(f, '/api/action', action, A);
  assert.deepEqual([retry.status, retry.ok, retry.code, retry.duplicate], [200, true, 'started', undefined]);
  assert.equal(retry.storage, undefined);
  assert.equal(retry.state.cash, before.cash - 150, 'one fare');
  assert.equal((await until(a, 'error')).code, 'venue_mismatch');
  await until(b, (m) => m.type === 'presence' && !m.members.some((x) => x.id === A.id));
  a.ws.send(JSON.stringify({ type: 'signal', to: B.id, data: { probe: 'gone' } }));
  assert.equal((await until(a, 'error')).code, 'join_required');
  const again = await post(f, '/api/action', action, A);
  assert.deepEqual([again.status, again.duplicate, again.state.cash], [200, true, before.cash - 150], 'a third send is a repeat, not a second trip');
  assert.equal((await database(f)).sessions[A.cookie.slice(4)].cities.lagos.state.cash, before.cash - 150);
  assert.equal(f.logs.filter((line) => /Store write failed/.test(line)).length, 1, 'the outage was logged once');
  assert.ok(f.logs.every((line) => !line.includes(A.cookie.slice(4))), 'no log line carries a session secret');
});

test('an outcome that could not be saved is not shown, and a restart after the failure finds only what was acknowledged', async (t) => {
  const disk = flakyDisk();
  const f = await fixture(t, { disk });
  const A = await f.device('Ada');
  const start = await life(f, A);
  const trip = { actionId: f.id(), cityId: 'lagos', type: 'travel', id: 'library', mode: 'danfo' };
  assert.equal((await post(f, '/api/action', trip, A)).code, 'started');
  f.advance(60000); // the trip has ended; settling it is an outcome, so it must be saved before it is answered
  disk.fail = 'EIO';
  const arrival = await get(f, '/api/life?city=lagos', A);
  assert.deepEqual([arrival.status, arrival.error], [503, 'storage_unavailable']);
  const lazy = { actionId: f.id(), cityId: 'lagos', type: 'spot', id: 'trees' };
  assert.equal((await post(f, '/api/action', lazy, A)).status, 503);
  assert.equal((await get(f, '/api/session', A)).status, 200, 'who am I still answers (the renewal is skipped)');
  assert.equal((await get(f, '/api/civic/gov?city=lagos', A)).status, 200, 'reads still answer');

  // The process stops while the disk is still failing. A new process reads the file.
  f.server.closeAllConnections(); await new Promise((resolve) => f.server.close(resolve));
  const again = await createServer({ dataDir: f.dir, now: f.now, sessionTtlMs: 2592000000 });
  again.listen(0, '127.0.0.1'); await once(again, 'listening');
  t.after(async () => { again.closeAllConnections(); await new Promise((resolve) => again.close(resolve)); });
  const call = async (path, body) => { const res = await fetch(`http://127.0.0.1:${again.address().port}${path}`, { method: body ? 'POST' : 'GET', headers: { Cookie: A.cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, ...(await res.json()) }; };
  const arrived = await call('/api/life?city=lagos');
  assert.deepEqual([arrived.status, arrived.state.location, arrived.state.cash, arrived.storage], [200, 'library', start.cash - 150, undefined], 'the acknowledged trip is there; its settlement is computed again and saved');
  const replay = await call('/api/action', trip);
  assert.deepEqual([replay.duplicate, replay.state.cash], [true, start.cash - 150], 'the acknowledged action kept its receipt');
  const fresh = await call('/api/action', { ...lazy, id: 'shelves' });
  assert.notEqual(fresh.duplicate, true, 'the rejected action left no receipt behind');
});

test('a gift whose write fails moves no money; the same client id then moves it exactly once', async (t) => {
  const disk = flakyDisk();
  const f = await fixture(t, { disk });
  const [ada, bola] = await friends(f, ['Ada', 'Bola']);
  const gift = { to: bola.id, amount: 500, cityId: 'lagos', clientId: f.id() };
  const balances = async () => { await get(f, '/api/social/me', bola); return [(await life(f, ada)).cash, (await life(f, bola)).cash]; };
  const before = await balances();
  disk.fail = 'ENOSPC';
  const failed = await post(f, '/api/social/transfers', gift, ada);
  assert.deepEqual([failed.status, failed.error], [503, 'storage_unavailable']);
  disk.fail = null;
  assert.deepEqual(await balances(), before, 'no debit, no credit, nothing waiting');
  assert.equal((await database(f)).social.pending?.[bola.id], undefined);
  const [one, two] = await Promise.all([post(f, '/api/social/transfers', gift, ada), post(f, '/api/social/transfers', gift, ada)]);
  assert.deepEqual([one.ok, two.ok, [one.duplicate, two.duplicate].filter(Boolean).length], [true, true, 1], 'two copies racing: one applied, one repeat');
  assert.deepEqual(await balances(), [before[0] - 500, before[1] + 500]);
});

test('caches follow the file: a block, a mute and a house visit that could not be saved are not in force', async (t) => {
  const disk = flakyDisk();
  const f = await fixture(t, { disk, moderatorToken: TOKEN, heartbeatMs: 60000 });
  const [ada, bola] = await friends(f, ['Ada', 'Bola']);
  const mod = async (path, body) => { const res = await fetch(f.base + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${TOKEN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: res.status, ...(await res.json()) }; };
  const a = await f.joinRoom(ada), b = await f.joinRoom(bola);
  await until(a, (m) => m.type === 'presence' && m.members.length === 2);

  disk.fail = 'ENOSPC';
  // A block that could not be saved: answered 503, and neither the stored list nor the room's in-memory index has it.
  assert.equal((await post(f, '/api/social/block', { id: bola.id, cityId: 'lagos' }, ada)).status, 503);
  a.ws.send(JSON.stringify({ type: 'chat', body: 'can you still hear me?', clientId: 'c-1' }));
  await until(b, (m) => m.type === 'chat' && m.body === 'can you still hear me?'); // the two still share the room
  // A mute that could not be saved: 503, and the player is not muted.
  assert.equal((await mod('/api/mod/mutes', { id: bola.id, minutes: 10, reason: 'Testing' })).status, 503);
  b.ws.send(JSON.stringify({ type: 'chat', body: 'not muted', clientId: 'c-2' }));
  await until(a, (m) => m.type === 'chat' && m.body === 'not muted');
  const overview = await mod('/api/mod/overview');
  assert.deepEqual([overview.status, overview.mutes, overview.store.failing, overview.storage], [200, 0, true, 'failing'], 'the operator can still read, and is told');
  disk.fail = null;
  assert.deepEqual((await get(f, '/api/social/me', ada)).blocked, []);

  // Once writes work, the same requests take effect — in the file and in memory together.
  assert.equal((await mod('/api/mod/mutes', { id: bola.id, minutes: 10, reason: 'Testing' })).code, 'muted');
  b.ws.send(JSON.stringify({ type: 'chat', body: 'muted now', clientId: 'c-3' }));
  assert.equal((await until(b, 'error')).code, 'muted');
  assert.equal((await post(f, '/api/social/block', { id: bola.id, cityId: 'lagos' }, ada)).code, 'blocked');
  await until(a, (m) => m.type === 'presence' && m.members.length === 1);
});

test('house visits during a write outage: letting someone in fails cleanly, and the heartbeat still ends an expired visit', async (t) => {
  const disk = flakyDisk();
  const f = await fixture(t, { disk, heartbeatMs: 60000 });
  const host = await f.device('Host'), guest = await f.device('Guest');
  for (const who of [host, guest]) { await get(f, '/api/social/me', who); await life(f, who); }
  await f.action(host.cookie, { type: 'travel', id: 'home', mode: 'trek' });
  f.advance(20000);
  const h = await f.socket(host);
  h.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'home' }));
  await until(h, 'presence');
  const g = await f.socket(guest);
  const joinHome = () => g.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'home', hostId: host.id }));
  assert.equal((await post(f, '/api/social/house/knock', { host: host.id, cityId: 'lagos' }, guest)).code, 'knocking');

  disk.fail = 'ENOSPC';
  assert.equal((await post(f, '/api/social/house/answer', { visitor: guest.id, answer: 'accept' }, host)).status, 503);
  joinHome();
  assert.equal((await until(g, 'error')).code, 'not_a_guest', 'an unsaved let-in admits nobody');
  disk.fail = null;
  assert.equal((await post(f, '/api/social/house/answer', { visitor: guest.id, answer: 'accept' }, host)).code, 'accepted');
  joinHome();
  await until(g, (m) => m.type === 'presence' && m.members.length === 2);

  // The visit runs out while the disk is failing again. Reads still work, so the beat still drops the guest.
  disk.fail = 'ENOSPC';
  f.advance(31 * 60000);
  f.server.beat();
  assert.equal((await until(g, 'error')).code, 'visit_ended');
  joinHome();
  assert.equal((await until(g, 'error')).code, 'not_a_guest');
  disk.fail = null;
});

test('the store adds no background retry: after a failed write nothing is pending, so nothing loops or floods the log', async (t) => {
  const disk = flakyDisk();
  const f = await fixture(t, { disk, lazyFlushMs: 10 });
  const A = await f.device('Ada');
  await life(f, A);
  disk.fail = 'ENOSPC';
  const writes = disk.writes;
  for (let i = 0; i < 5; i++) { f.advance(1000); assert.equal((await get(f, '/api/life?city=lagos', A)).status, 200); }
  await tick(120);
  const attempts = disk.writes - writes;
  assert.ok(attempts >= 1 && attempts <= 5, `one write attempt per poll at most (${attempts}), none on a timer afterwards`);
  await tick(120);
  assert.equal(disk.writes - writes, attempts, 'no retry loop');
  assert.equal(f.logs.filter((line) => /Store write failed/.test(line)).length, 1);
  disk.fail = null;
});
