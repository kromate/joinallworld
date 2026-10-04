// A guest's place in a host's Home room is re-checked before any room message is forwarded: the
// visit's expiry is honoured at its own timestamp, a host who leaves (by trip or by commute) or
// who is simply gone ends the visit, and nothing waits for an HTTP request or the heartbeat.
// Two real sockets and the server's injected clock; visits are made through the normal knock and
// answer routes (nothing is written into the store by the tests). Protocol-level only: no microphone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './test-fixture.js';
import { LIMITS } from './social/service.js';
import { GUEST_RECHECK_MS, HOST_ABSENCE_GRACE_MS } from './ws/rooms.js';

const MONDAY_10AM = Date.UTC(2026, 0, 5, 9);
const say = (peer, message) => peer.ws.send(JSON.stringify(message));
async function until(peer, test, what = 'message', from = 0) {
  for (let i = 0; i < 400; i++) {
    const found = peer.log.slice(from).find(test);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw Error(`No ${what}`);
}
const isError = (code) => (message) => message.type === 'error' && message.code === code;

/** A host at home with a socket in their own Home room and one accepted guest inside, on a clock the test moves. */
async function visit(t, options = {}) {
  let time = options.start ?? 100000;
  const f = await fixture(t, { now: () => time, ...options.server });
  const world = { f, now: () => time, advance: (ms) => { time += ms; } };
  world.get = async (path, who) => { const response = await f.request(path, null, who.cookie); return { status: response.status, ...(await response.json()) }; };
  world.post = async (path, body, who) => { const response = await f.request(path, body, who.cookie); return { status: response.status, ...(await response.json()) }; };
  world.act = (who, fields) => world.post('/api/action', { actionId: `${time}:${randomUUID()}`, cityId: 'lagos', ...fields }, who);
  world.connect = async (device) => {
    const { ws } = await f.socket(device);
    const peer = { ws, id: device.id, cookie: device.cookie, log: [] };
    ws.removeAllListeners('message');
    ws.on('message', (data) => peer.log.push(JSON.parse(data.toString())));
    return peer;
  };
  const host = await f.device('Host'), guest = await f.device('Guest');
  for (const who of [host, guest]) assert.equal((await world.get('/api/social/me', who)).status, 200);
  const trip = await world.act(host, { type: 'travel', id: 'home', mode: 'trek' });
  assert.equal(trip.ok, true);
  world.advance(trip.state.activeAction.duration * 1000 + 1000);
  assert.equal((await world.get('/api/life?city=lagos', host)).state.location, 'home');
  const h = await world.connect(host), g = await world.connect(guest);
  say(h, { type: 'join', cityId: 'lagos', venueId: 'home' }); await until(h, (m) => m.type === 'presence');
  assert.equal((await world.post('/api/social/house/knock', { host: host.id, cityId: 'lagos' }, guest)).code, 'knocking');
  const acceptedAt = time;
  assert.equal((await world.post('/api/social/house/answer', { visitor: guest.id, answer: 'accept' }, host)).code, 'accepted');
  say(g, { type: 'join', cityId: 'lagos', venueId: 'home', hostId: host.id });
  await until(g, (m) => m.type === 'presence' && m.members.length === 2, 'guest admitted');
  return Object.assign(world, { host, guest, h, g, expiresAt: acceptedAt + LIMITS.visitMs });
}
/** The guest sends one chat line and one signalling marker; report what reached the host and what the guest was told. */
async function exchange({ h, g, host }, label) {
  const clientId = randomUUID(), heard = h.log.length, sent = g.log.length;
  say(g, { type: 'chat', clientId, body: label });
  say(g, { type: 'signal', to: host.id, data: { probe: label } });
  const done = () => {
    const errors = g.log.slice(sent).filter((m) => m.type === 'error').map((m) => m.code);
    const chat = h.log.slice(heard).some((m) => m.type === 'chat' && m.clientId === clientId);
    const signal = h.log.slice(heard).some((m) => m.type === 'signal' && m.data?.probe === label);
    const own = g.log.slice(sent).some((m) => m.type === 'chat' && m.clientId === clientId);
    return (chat && signal) || errors.filter((code) => code !== 'visit_ended').length >= 2 ? { chat, signal, own, errors } : null;
  };
  for (let i = 0; i < 400; i++) { const result = done(); if (result) return result; await new Promise((resolve) => setTimeout(resolve, 5)); }
  throw Error(`Exchange ${label} was neither delivered nor refused`);
}
const delivered = { chat: true, signal: true, own: true, errors: [] };

test('an accepted guest loses the room exactly when the visit expires: the first message at that instant is refused, with no HTTP call and no heartbeat', async (t) => {
  const world = await visit(t, { server: { heartbeatMs: 60000 } });
  const { f, h, g, host, guest, expiresAt } = world;
  assert.deepEqual(await exchange(world, 'during the visit'), delivered, 'control: chat and signalling reach the host');
  // One millisecond before the expiry the guest is still a guest.
  world.advance(expiresAt - world.now() - 1);
  assert.deepEqual(await exchange(world, 'last millisecond'), delivered);
  // At the expiry timestamp itself — nothing else has happened on the server — the room is closed to them.
  world.advance(1);
  assert.equal(world.now(), expiresAt);
  const heard = h.log.length;
  const late = await exchange(world, 'at expiry');
  assert.deepEqual([late.chat, late.signal, late.own], [false, false, false], 'neither frame is forwarded');
  assert.deepEqual(late.errors, ['visit_ended', 'join_required', 'join_required'], 'the guest is told the visit ended, then that each message needed a room');
  const roster = await until(h, (m) => m.type === 'presence', 'host roster', heard);
  assert.deepEqual(roster.members.map((member) => member.id), [host.id], 'the host’s room lists only the host');
  // The stored visit is closed too, and a fresh join is refused.
  const from = g.log.length;
  say(g, { type: 'join', cityId: 'lagos', venueId: 'home', hostId: host.id });
  assert.equal((await until(g, (m) => m.type === 'error', 'join refusal', from)).code, 'not_a_guest');
  assert.equal((await world.get('/api/social/me', guest)).visiting, null);
  assert.equal(f.server.store.stats().mode, 'grouped');
});

test('a guest’s entitlement is remembered for a few seconds at most, and never past the expiry', async (t) => {
  const world = await visit(t, { server: { heartbeatMs: 60000 } });
  const { f } = world;
  assert.ok(GUEST_RECHECK_MS > 0 && GUEST_RECHECK_MS <= 5000, 'a few seconds at most');
  const reads = () => f.server.store.stats().reads;
  assert.deepEqual(await exchange(world, 'first'), delivered);
  const before = reads();
  assert.deepEqual(await exchange(world, 'same instant'), delivered);
  assert.equal(reads(), before, 'inside the window the remembered answer is used: no store read');
  world.advance(GUEST_RECHECK_MS - 1);
  assert.deepEqual(await exchange(world, 'just inside'), delivered);
  assert.equal(reads(), before);
  world.advance(1);
  assert.deepEqual(await exchange(world, 'window over'), delivered);
  assert.equal(reads(), before + 1, 'once the window has passed the guest list is asked again — once for the two messages');
  // Close to the expiry the window shrinks to what is left of the visit.
  world.advance(world.expiresAt - world.now() - 1000);
  assert.deepEqual(await exchange(world, 'one second left'), delivered);
  world.advance(1000);
  assert.deepEqual((await exchange(world, 'expired inside what would have been the window')).errors, ['visit_ended', 'join_required', 'join_required']);
});

test('a guest the host asks to leave is dropped at once, and a visit in another city is no visit', async (t) => {
  const world = await visit(t, { server: { heartbeatMs: 60000 } });
  const { g, host, guest } = world;
  let from = g.log.length;
  say(g, { type: 'join', cityId: 'ibadan', venueId: 'home', hostId: host.id });
  assert.equal((await until(g, (m) => m.type === 'error', 'wrong city', from)).code, 'not_a_guest', 'the visit is for Lagos only');
  assert.deepEqual(await exchange(world, 'still inside'), delivered, 'a refused join leaves the socket where it was');
  from = g.log.length;
  assert.equal((await world.post('/api/social/house/leave', { host: host.id, guest: guest.id }, host)).code, 'left');
  assert.equal((await until(g, isError('visit_ended'), 'removal', from)).code, 'visit_ended');
  assert.deepEqual((await exchange(world, 'after removal')).errors, ['join_required', 'join_required']);
});

test('a host who starts a commute from home ends the visit at once, exactly like a host who travels', async (t) => {
  const world = await visit(t, { start: MONDAY_10AM, server: { heartbeatMs: 60000 } });
  const { h, g, host, guest } = world;
  assert.deepEqual(await exchange(world, 'before'), delivered);
  const marks = [h.log.length, g.log.length];
  const hired = await world.act(host, { type: 'apply-job', payload: { id: 'tech' } });
  assert.deepEqual([hired.ok, hired.state.activeAction?.kind, hired.state.location], [true, 'commute', 'home'], 'the host is on the way out; their recorded location is still home');
  assert.equal((await until(h, isError('venue_mismatch'), 'host revocation', marks[0])).code, 'venue_mismatch');
  assert.equal((await until(g, isError('visit_ended'), 'guest dropped', marks[1])).code, 'visit_ended');
  assert.deepEqual((await exchange(world, 'host commuting')).errors, ['join_required', 'join_required']);
  const from = g.log.length;
  say(g, { type: 'join', cityId: 'lagos', venueId: 'home', hostId: host.id });
  assert.equal((await until(g, (m) => m.type === 'error', 'join refusal', from)).code, 'not_a_guest');
  const me = await world.get('/api/social/me', guest);
  assert.equal(me.visiting, null);
  assert.ok(me.updates.some((update) => /went out, so your visit ended/.test(update.text)), 'the guest is told why');
  // Cancelling the commute does not bring the guests back by itself: the visit is over.
  assert.equal((await world.act(host, { type: 'cancel' })).code, 'cancelled');
  const again = g.log.length;
  say(g, { type: 'join', cityId: 'lagos', venueId: 'home', hostId: host.id });
  assert.equal((await until(g, (m) => m.type === 'error', 'join refusal', again)).code, 'not_a_guest');
});

test('a host with no connection in their own Home room for longer than the grace period ends the visit; a reload inside it does not', async (t) => {
  const world = await visit(t, { server: { heartbeatMs: 60000 } });
  const { f, g, host, guest } = world;
  assert.ok(HOST_ABSENCE_GRACE_MS >= 5000 && HOST_ABSENCE_GRACE_MS <= 60000);
  const alone = async (label) => { // with the host away the guest's chat comes back only to the guest
    const clientId = randomUUID(), sent = g.log.length;
    say(g, { type: 'chat', clientId, body: label });
    const reply = await until(g, (m) => (m.type === 'chat' && m.clientId === clientId) || (m.type === 'error' && m.code === 'join_required'), 'chat answer', sent);
    return reply.type === 'chat' ? 'delivered' : g.log.slice(sent).filter((m) => m.type === 'error').map((m) => m.code).join(',');
  };
  // The host's page reloads: the socket closes and a new one joins well inside the grace period.
  world.h.ws.terminate();
  await until(g, (m) => m.type === 'presence' && m.members.length === 1, 'host gone from the roster', 1);
  world.advance(HOST_ABSENCE_GRACE_MS - 1);
  assert.equal(await alone('host reloading'), 'delivered', 'inside the grace period the guest stays');
  const h2 = await world.connect(host);
  say(h2, { type: 'join', cityId: 'lagos', venueId: 'home' });
  await until(h2, (m) => m.type === 'presence' && m.members.length === 2, 'host back');
  world.advance(HOST_ABSENCE_GRACE_MS * 2);
  world.h = h2;
  assert.deepEqual(await exchange(world, 'host back'), delivered, 'the absence clock was cleared by the host coming back');
  // Now the host goes for good. Their stored life still says "at home" — only the connection is gone.
  const from = g.log.length;
  h2.ws.terminate();
  await until(g, (m) => m.type === 'presence' && m.members.length === 1, 'host gone again', from);
  world.advance(HOST_ABSENCE_GRACE_MS - 1);
  assert.equal(await alone('just inside'), 'delivered');
  world.advance(1);
  assert.equal(await alone('grace over'), 'visit_ended,join_required', 'the first message after the grace period is refused');
  // The stored visit is closed as well, so the guest cannot simply join again.
  for (let i = 0; i < 100 && (await world.get('/api/social/me', guest)).visiting; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal((await world.get('/api/social/me', guest)).visiting, null);
  const again = g.log.length;
  say(g, { type: 'join', cityId: 'lagos', venueId: 'home', hostId: host.id });
  assert.equal((await until(g, (m) => m.type === 'error', 'join refusal', again)).code, 'not_a_guest');
  assert.equal((await f.request('/api/voice-config', null, guest.cookie)).status, 403);
});

test('an idle guest is swept on the heartbeat when the host is gone or the visit is over', async (t) => {
  const world = await visit(t, { server: { heartbeatMs: 60000 } });
  const { f, g } = world;
  world.h.ws.terminate();
  await until(g, (m) => m.type === 'presence' && m.members.length === 1, 'host gone', 1);
  world.advance(HOST_ABSENCE_GRACE_MS - 1);
  let from = g.log.length;
  f.server.beat();
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(g.log.slice(from).some((m) => m.type === 'error'), false, 'inside the grace period a beat changes nothing');
  world.advance(1);
  from = g.log.length;
  f.server.beat();
  assert.equal((await until(g, isError('visit_ended'), 'swept', from)).code, 'visit_ended');
});
