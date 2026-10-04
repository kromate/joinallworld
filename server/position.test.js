// Where a player stands in a venue is one thing: the `move` a client sends is what the room's
// `presence` shows to the others AND what the voice signalling gate measures. And the caller's own
// session response says which cities it has lives in — to the caller only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './test-fixture.js';

const say = (peer, message) => peer.ws.send(JSON.stringify(message));
/** The next message of a type, skipping others (a watcher's nudges, presence frames of somebody else's change). */
async function nextOf(peer, type, match = () => true) {
  for (let i = 0; i < 20; i++) { const message = await peer.next(); if (message.type === type && match(message)) return message; }
  throw new Error(`no ${type} message arrived`);
}
const member = (presence, id) => presence.members.find((item) => item.id === id);

test('two real sockets: A moves and B sees where A stands; signalling is refused out of range and allowed in range', async (t) => {
  const f = await fixture(t);
  const ada = await f.device('Ada Mover'), bola = await f.device('Bola Watcher');
  await f.request('/api/life?city=lagos', null, ada.cookie); await f.request('/api/life?city=lagos', null, bola.cookie);
  const a = await f.joinRoom(ada), b = await f.joinRoom(bola);
  const joined = await nextOf(a, 'presence', (message) => message.members.length === 2);
  assert.deepEqual(member(joined, ada.id).position, { x: 0, z: 0 });
  assert.deepEqual(member(joined, bola.id).position, { x: 0, z: 0 }, 'the origin until a position is reported');
  assert.deepEqual(Object.keys(member(joined, bola.id)).sort(), ['enabled', 'id', 'muted', 'name', 'position'], 'presence carries the public identity, the position and the voice flags — nothing else');
  assert.equal(member(joined, bola.id).enabled, false, 'nobody is in voice by joining a room');

  say(a, { type: 'move', x: 14, z: -3.5 });
  const seen = await nextOf(b, 'presence', (message) => member(message, ada.id)?.position.x === 14);
  assert.deepEqual(member(seen, ada.id).position, { x: 14, z: -3.5 }, 'B sees exactly where A stands');
  assert.deepEqual(member(seen, bola.id).position, { x: 0, z: 0 }, 'B has not moved');
  say(b, { type: 'move', x: -3, z: 0 });
  await nextOf(a, 'presence', (message) => member(message, bola.id)?.position.x === -3);

  // 17 units apart: more than the 12-unit voice radius. The server refuses to forward the signal.
  say(a, { type: 'signal', to: bola.id, data: { description: { type: 'offer', sdp: 'x' } } });
  const refused = await nextOf(a, 'error');
  assert.equal(refused.error, 'peer_out_of_range');
  // A walks over: the same signal is now delivered, from A's public id.
  f.advance(1500);
  say(a, { type: 'move', x: 2, z: 0 });
  await nextOf(b, 'presence', (message) => member(message, ada.id)?.position.x === 2);
  say(a, { type: 'signal', to: bola.id, data: { description: { type: 'offer', sdp: 'x' } } });
  const signal = await nextOf(b, 'signal');
  assert.equal(signal.from, ada.id);

  // Positions are validated and rate-limited exactly as before.
  f.advance(1500);
  say(a, { type: 'move', x: 25, z: 0 });
  assert.equal((await nextOf(a, 'error')).error, 'invalid_position');
  say(a, { type: 'move', x: 'here', z: 0 });
  assert.equal((await nextOf(a, 'error')).error, 'invalid_position');
  for (let i = 0; i < 6; i++) say(a, { type: 'move', x: i, z: 0 });
  assert.equal((await nextOf(a, 'error')).error, 'move_rate_limited');
});

test('a player who has not finished character creation, or who is on a trip, is in no room and so is never shown', async (t) => {
  const f = await fixture(t);
  const ada = await f.device('Ada Present');
  await f.request('/api/life?city=lagos', null, ada.cookie);
  const a = await f.joinRoom(ada);
  // A brand-new session that must still create its Sim.
  const created = await f.request('/api/session', { name: 'New Arrival', onboarding: true });
  const fresh = { cookie: created.headers.get('set-cookie').split(';')[0], ...(await created.json()).session };
  await f.request('/api/life?city=lagos', null, fresh.cookie);
  const n = await f.socket(fresh);
  say(n, { type: 'join', cityId: 'lagos', venueId: 'park' });
  assert.equal((await nextOf(n, 'error')).error, 'onboarding_required');
  say(n, { type: 'move', x: 1, z: 1 });
  assert.equal((await nextOf(n, 'error')).error, 'join_required', 'no room, so no position to report');
  // Someone who then sets off on a trip leaves the room: the others' list no longer has them, and their move is refused.
  const bola = await f.device('Bola Leaving');
  await f.request('/api/life?city=lagos', null, bola.cookie);
  const b = await f.joinRoom(bola);
  await nextOf(a, 'presence', (message) => message.members.length === 2);
  say(b, { type: 'move', x: 4, z: 4 });
  await nextOf(a, 'presence', (message) => member(message, bola.id)?.position.x === 4);
  const trip = await f.action(bola.cookie, { type: 'travel', id: 'library', mode: 'trek' });
  assert.equal(trip.ok, true);
  const after = await nextOf(a, 'presence', (message) => !member(message, bola.id));
  assert.deepEqual(after.members.map((item) => item.id), [ada.id], 'the departing player is gone from the room at once');
  say(b, { type: 'move', x: 5, z: 5 });
  assert.equal((await nextOf(b, 'error', (message) => message.error !== 'venue_mismatch')).error, 'join_required');
});

test('the session response tells the caller — and only the caller — which cities the session has lives in', async (t) => {
  const f = await fixture(t);
  const opened = await f.request('/api/session', { name: 'Ada Cities' });
  const cookie = opened.headers.get('set-cookie').split(';')[0];
  const first = (await opened.json()).session;
  assert.deepEqual(first.cities, [], 'a new session has no life yet');
  assert.deepEqual(Object.keys(first).sort(), ['cities', 'id', 'name']);
  await f.request('/api/life?city=lagos', null, cookie);
  assert.deepEqual((await (await f.request('/api/session', null, cookie)).json()).session.cities, ['lagos']);
  await f.request('/api/life?city=ibadan', null, cookie);
  const both = (await (await f.request('/api/session', null, cookie)).json()).session;
  assert.deepEqual(both.cities, ['lagos', 'ibadan'], 'a returning Ibadan player is recognised from the server, on any device');
  assert.deepEqual((await (await f.request('/api/session', { name: 'Ada Cities' }, cookie)).json()).session.cities, ['lagos', 'ibadan'], 'a rename answers the same shape');
  // Nobody else learns it: not presence, not chat.
  const other = await f.device('Bola Other');
  await f.request('/api/life?city=lagos', null, other.cookie);
  const a = await f.joinRoom({ cookie }), b = await f.joinRoom(other);
  const presence = await nextOf(a, 'presence', (message) => message.members.length === 2);
  assert.ok(presence.members.every((item) => !('cities' in item)), 'presence never carries the city list');
  say(a, { type: 'chat', body: 'hello', clientId: 'c1' });
  const chat = await nextOf(b, 'chat');
  assert.deepEqual(Object.keys(chat.from).sort(), ['id', 'name'], 'a chat line carries the public identity only');
  assert.equal((await f.request('/api/session')).status, 401, 'without a session there is nothing to list');
});
