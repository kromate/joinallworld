// Where a player stands in a venue is one thing: the `move` a client sends is what the room's
// `presence` shows to the others AND what the voice signalling gate measures. And the caller's own
// session response says which cities it has lives in — to the caller only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './test-fixture.ts';

type Frame = Record<string, unknown>;
interface Member { id: string; name: string; enabled: boolean; muted: boolean; position: { x: number; z: number } }
interface Presence extends Frame { type: 'presence'; members: Member[] }
/** What a test needs of a socket from the fixture. */
interface Peer { ws: { send(data: string): void }; next(): Promise<unknown> }
const isFrame = (value: unknown): value is Frame => typeof value === 'object' && value !== null;
const isPresence = (value: unknown): value is Presence => isFrame(value) && value.type === 'presence' && Array.isArray(value.members);
const say = (peer: Peer, message: Frame) => peer.ws.send(JSON.stringify(message));
/** The next message of a type, skipping others (a watcher's nudges, presence frames of somebody else's change). */
async function nextOf(peer: Peer, type: string, match: (message: Frame) => boolean = () => true): Promise<Frame> {
  for (let i = 0; i < 20; i++) { const message = await peer.next(); if (isFrame(message) && message.type === type && match(message)) return message; }
  throw new Error(`no ${type} message arrived`);
}
async function nextPresence(peer: Peer, match: (presence: Presence) => boolean): Promise<Presence> {
  for (let i = 0; i < 20; i++) { const message = await peer.next(); if (isPresence(message) && match(message)) return message; }
  throw new Error('no presence message arrived');
}
const member = (presence: Presence, id: string): Member | undefined => presence.members.find((item) => item.id === id);
interface SessionView { id: string; name: string; cities: string[] }
const isSessionBody = (value: unknown): value is { session: SessionView } => isFrame(value) && isFrame(value.session) && Array.isArray(value.session.cities);
/** The `session` of a /api/session answer, narrowed from the untrusted body. */
async function sessionOf(res: Response): Promise<SessionView> {
  const body: unknown = await res.json();
  if (!isSessionBody(body)) throw new Error('not a session response');
  return body.session;
}
/** The `name=value` half of the Set-Cookie header. */
const cookieOf = (res: Response): string => (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

test('two real sockets: A moves and B sees where A stands; signalling is refused out of range and allowed in range', async (t) => {
  const f = await fixture(t);
  const ada = await f.device('Ada Mover'), bola = await f.device('Bola Watcher');
  await f.request('/api/life?city=lagos', null, ada.cookie); await f.request('/api/life?city=lagos', null, bola.cookie);
  const a = await f.joinRoom(ada), b = await f.joinRoom(bola);
  const joined = await nextPresence(a, (message) => message.members.length === 2);
  assert.deepEqual(member(joined, ada.id)?.position, { x: 0, z: 0 });
  assert.deepEqual(member(joined, bola.id)?.position, { x: 0, z: 0 }, 'the origin until a position is reported');
  assert.deepEqual(Object.keys(member(joined, bola.id) ?? {}).sort(), ['enabled', 'id', 'muted', 'name', 'position'], 'presence carries the public identity, the position and the voice flags — nothing else');
  assert.equal(member(joined, bola.id)?.enabled, false, 'nobody is in voice by joining a room');

  say(a, { type: 'move', x: 14, z: -3.5 });
  const seen = await nextPresence(b, (message) => member(message, ada.id)?.position.x === 14);
  assert.deepEqual(member(seen, ada.id)?.position, { x: 14, z: -3.5 }, 'B sees exactly where A stands');
  assert.deepEqual(member(seen, bola.id)?.position, { x: 0, z: 0 }, 'B has not moved');
  say(b, { type: 'move', x: -3, z: 0 });
  await nextPresence(a, (message) => member(message, bola.id)?.position.x === -3);

  // 17 units apart: more than the 12-unit voice radius. The server refuses to forward the signal.
  say(a, { type: 'signal', to: bola.id, data: { description: { type: 'offer', sdp: 'x' } } });
  const refused = await nextOf(a, 'error');
  assert.equal(refused.error, 'peer_out_of_range');
  // A walks over: the same signal is now delivered, from A's public id.
  f.advance(1500);
  say(a, { type: 'move', x: 2, z: 0 });
  await nextPresence(b, (message) => member(message, ada.id)?.position.x === 2);
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
  const fresh = { cookie: cookieOf(created), ...(await sessionOf(created)) };
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
  await nextPresence(a, (message) => message.members.length === 2);
  say(b, { type: 'move', x: 4, z: 4 });
  await nextPresence(a, (message) => member(message, bola.id)?.position.x === 4);
  const trip = await f.action(bola.cookie, { type: 'travel', id: 'library', mode: 'trek' });
  assert.equal(trip.ok, true);
  const after = await nextPresence(a, (message) => !member(message, bola.id));
  assert.deepEqual(after.members.map((item) => item.id), [ada.id], 'the departing player is gone from the room at once');
  say(b, { type: 'move', x: 5, z: 5 });
  assert.equal((await nextOf(b, 'error', (message) => message.error !== 'venue_mismatch')).error, 'join_required');
});

test('the session response exposes only the active life, and a GET cannot create another city life', async (t) => {
  const f = await fixture(t);
  const opened = await f.request('/api/session', { name: 'Ada Cities' });
  const cookie = cookieOf(opened);
  const first = await sessionOf(opened);
  assert.deepEqual(first.cities, [], 'a new session has no life yet');
  assert.deepEqual(Object.keys(first).sort(), ['cities', 'id', 'name']);
  await f.request('/api/life?city=lagos', null, cookie);
  assert.deepEqual((await sessionOf(await f.request('/api/session', null, cookie))).cities, ['lagos']);
  const refused = await f.request('/api/life?city=ibadan', null, cookie);
  assert.deepEqual([refused.status, (await refused.json()).error], [409, 'city_moved']);
  const current = await sessionOf(await f.request('/api/session', null, cookie));
  assert.deepEqual(current.cities, ['lagos'], 'the refused read creates no second life');
  assert.deepEqual((await sessionOf(await f.request('/api/session', { name: 'Ada Cities' }, cookie))).cities, ['lagos'], 'a rename answers the same shape');
  // Nobody else learns it: not presence, not chat.
  const other = await f.device('Bola Other');
  await f.request('/api/life?city=lagos', null, other.cookie);
  const a = await f.joinRoom({ cookie }), b = await f.joinRoom(other);
  const presence = await nextPresence(a, (message) => message.members.length === 2);
  assert.ok(presence.members.every((item) => !('cities' in item)), 'presence never carries the city list');
  say(a, { type: 'chat', body: 'hello', clientId: 'c1' });
  const chat = await nextOf(b, 'chat');
  assert.deepEqual(Object.keys(isFrame(chat.from) ? chat.from : {}).sort(), ['id', 'name'], 'a chat line carries the public identity only');
  assert.equal((await f.request('/api/session')).status, 401, 'without a session there is nothing to list');
});
