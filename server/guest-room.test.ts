// A guest in a host's Home room: the one way a private room is ever shared. Covers the rule in
// server/ws/rooms.ts (join { venueId: 'home', hostId }) and the social module's guest list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './test-fixture.ts';
import { WS_MODULES } from './ws/index.ts';
import { LIMITS } from './social/service.ts';
import { venueRoomKey } from './protocol.ts';
import type { Device, FixtureOptions, TestSocket } from './test-fixture.ts';

type Fixture = Awaited<ReturnType<typeof fixture>>;
/** A frame the server sent, read loosely: the fields a test looks at, and `undefined` where a frame has none. */
interface Frame {
  type: string; code?: string; body?: string
  members: { id: string; name: string; enabled: boolean; muted: boolean }[]
  from: { id: string }; message: { body: string }; house: { role: string }
}
/** What a JSON answer may carry in these tests. */
interface Reply {
  status: number; ok?: boolean; code?: string; reason?: string
  players: { id: string; here: boolean }[]
  house: { cityId: string; guests: unknown[] }
  visiting: { host: { id: string } } | null
  updates: { text: string }[]
}
/** The people a test opened the game for after the host: callers destructure only the names they passed. */
type Others = [Device, Device, Device];
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
function must<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) throw new Error(`expected a ${what}`);
  return value;
}
const reply = async (res: Response): Promise<Reply> => {
  const body: unknown = await res.json();
  return { ...(isRecord(body) ? body : {}), status: res.status } as Reply; // the routes' documented bodies, read loosely
};
/** The next frame, read loosely. */
const next = async (peer: TestSocket): Promise<Frame> => (await peer.next()) as unknown as Frame;
const cid = () => `c-${randomUUID()}`;
const get = async (f: Fixture, path: string, who?: Device): Promise<Reply> => reply(await f.request(path, null, who?.cookie));
const post = async (f: Fixture, path: string, body: object, who?: Device): Promise<Reply> => reply(await f.request(path, body, who?.cookie));
async function until(peer: TestSocket, type: string): Promise<Frame> {
  for (let i = 0; i < 300; i++) { const message = await next(peer); if (message.type === type) return message; }
  throw Error(`No ${type} message`);
}
const say = (peer: TestSocket, message: object) => peer.ws.send(JSON.stringify(message));
const joinHome = (peer: TestSocket, hostId: string, more: object = {}) => say(peer, { type: 'join', cityId: 'lagos', venueId: 'home', hostId, ...more });

/** Host at home with a socket in their own Home room; `names` have opened the game. */
async function house(t: Parameters<typeof fixture>[0], names: string[], options?: FixtureOptions) {
  const f = await fixture(t, options);
  const devices: Device[] = [];
  for (const name of ['Host', ...names]) { const device = await f.device(name); await get(f, '/api/social/me', device); devices.push(device); }
  const host = must(devices[0], 'host'), others = devices.slice(1) as Others;
  await f.action(host.cookie, { type: 'travel', id: 'home', mode: 'trek' });
  f.advance(20000);
  const h = await f.socket(host);
  say(h, { type: 'join', cityId: 'lagos', venueId: 'home' });
  await until(h, 'presence');
  return { f, host, h, others };
}
async function letIn(f: Fixture, host: Device, guest: Device) {
  assert.equal((await post(f, '/api/social/house/knock', { host: host.id, cityId: 'lagos' }, guest)).code, 'knocking');
  assert.equal((await post(f, '/api/social/house/answer', { visitor: guest.id, answer: 'accept' }, host)).code, 'accepted');
}

test('venueRoomKey keeps its signature and behaviour for existing callers', () => {
  assert.equal(venueRoomKey.length, 3);
  assert.equal(venueRoomKey('lagos', 'park', 'me'), 'lagos:park');
  assert.equal(venueRoomKey('lagos', 'home', 'me'), 'lagos:home:me');
});

test('a non-guest is refused; an accepted guest is admitted to the host’s Home room and they share its chat', async t => {
  const { f, host, h, others: [guest, stranger] } = await house(t, ['Guest', 'Stranger']);
  const g = await f.socket(guest), s = await f.socket(stranger);
  // Nobody has been let in yet: the guest-to-be and a stranger are both refused, and so is a knock that is only pending.
  joinHome(g, host.id); assert.equal((await next(g)).code, 'not_a_guest');
  joinHome(s, host.id); assert.equal((await next(s)).code, 'not_a_guest');
  assert.equal((await post(f, '/api/social/house/knock', { host: host.id, cityId: 'lagos' }, guest)).code, 'knocking');
  joinHome(g, host.id); assert.equal((await until(g, 'error')).code, 'not_a_guest', 'knocking is not being let in');
  assert.equal((await post(f, '/api/social/house/answer', { visitor: guest.id, answer: 'accept' }, host)).code, 'accepted');
  // Let in: admitted. The guest's own life is at the park; it is the server's guest list that admits them.
  joinHome(g, host.id);
  const inside = await until(g, 'presence');
  assert.deepEqual(inside.members.map((member) => member.name).sort(), ['Guest', 'Host']);
  assert.deepEqual(inside.members.map((member) => [member.enabled, member.muted]), [[false, true], [false, true]], 'everyone starts outside voice and muted — nothing is auto-enabled');
  assert.deepEqual((await until(h, 'presence')).members.map((member) => member.id).sort(), [guest.id, host.id].sort());
  // Room chat is shared by exactly the people in the room…
  say(g, { type: 'chat', body: 'Nice place!', clientId: 'hello-1' });
  assert.deepEqual([(await until(h, 'chat')).body, (await until(g, 'chat')).from.id], ['Nice place!', guest.id]);
  // …and so is the stored house conversation.
  assert.equal((await post(f, '/api/social/messages', { conv: `h.${host.id}`, body: 'Welcome!', clientId: cid() }, host)).code, 'sent');
  assert.equal((await until(g, 'dm')).message.body, 'Welcome!');
  assert.equal((await post(f, '/api/social/messages', { conv: `h.${host.id}`, body: 'Thank you', clientId: cid() }, guest)).code, 'sent');
  assert.equal((await post(f, '/api/social/messages', { conv: `h.${host.id}`, body: 'me too', clientId: cid() }, stranger)).code, 'not_a_member');
  // The stranger is still outside: no presence, no chat, and still refused.
  joinHome(s, host.id); assert.equal((await next(s)).code, 'not_a_guest');
  say(s, { type: 'chat', body: 'psst' }); assert.equal((await next(s)).code, 'join_required');
  // Truthful presence: the host sees the guest in the listing for their home, and friends see a visit, not "at home".
  assert.deepEqual((await get(f, '/api/social/people?city=lagos', host)).players.map((player) => [player.id, player.here]), [[guest.id, true]]);
  assert.equal((await get(f, `/api/social/house/${host.id}`, guest)).house.cityId, 'lagos');
  // Voice follows the existing rules: the config needs live membership, which a current guest has.
  assert.equal((await get(f, '/api/voice-config', guest)).status, 200);
  assert.equal((await get(f, '/api/voice-config', stranger)).status, 403);
  const seen = JSON.stringify(inside);
  assert.ok(!seen.includes(host.cookie.slice(4)) && !seen.includes(guest.cookie.slice(4)), 'only public ids are sent');
});

test('the guest rule cannot be used to enter any other private room, and a malformed hostId is refused outright', async t => {
  const { f, host, others: [guest, other] } = await house(t, ['Guest', 'Other']);
  await letIn(f, host, guest);
  // Other is at home too, with nobody let in.
  await f.action(other.cookie, { type: 'travel', id: 'home', mode: 'trek' }); f.advance(20000);
  const o = await f.socket(other); say(o, { type: 'join', cityId: 'lagos', venueId: 'home' }); await until(o, 'presence');
  const g = await f.socket(guest);
  // A guest of Host is not a guest of Other.
  joinHome(g, other.id); assert.equal((await next(g)).code, 'not_a_guest');
  // The visit is for Lagos: the same host id in another city is refused.
  say(g, { type: 'join', cityId: 'ibadan', venueId: 'home', hostId: host.id }); assert.equal((await next(g)).code, 'not_a_guest');
  // hostId is only honoured for Home, and only as a public id; nothing else can shape the room key.
  for (const [venueId, hostId] of [['park', host.id], ['library', other.id], ['home', `${other.id}:x`], ['home', `lagos:home:${other.id}`], ['home', '__proto__'], ['home', ''], ['home', 5], ['home', null], ['home', { id: other.id }], ['home', [other.id]], ['home', 'home']] as [string, unknown][]) {
    say(g, { type: 'join', cityId: 'lagos', venueId, hostId });
    assert.equal((await next(g)).code, 'invalid_room', JSON.stringify([venueId, hostId]));
  }
  // Naming yourself as host is the ordinary own-home rule: this guest's life is at the park, not at home.
  joinHome(g, guest.id); assert.equal((await next(g)).code, 'venue_mismatch');
  // Without a host id the message means "my own home", exactly as before.
  say(g, { type: 'join', cityId: 'lagos', venueId: 'home' }); assert.equal((await next(g)).code, 'venue_mismatch');
  // An unknown but well-formed id, and the host's cookie secret used as an id, admit nobody.
  joinHome(g, randomUUID()); assert.equal((await next(g)).code, 'not_a_guest');
  joinHome(g, host.cookie.slice(4)); assert.equal((await next(g)).code, 'not_a_guest');
  // Other's room is untouched: one member, and the guest hears nothing from it.
  say(o, { type: 'chat', body: 'alone' }); assert.equal((await until(o, 'chat')).body, 'alone');
  joinHome(g, host.id.toUpperCase());
  assert.deepEqual((await until(g, 'presence')).members.map((member) => member.name).sort(), ['Guest', 'Host'], 'the id is canonicalised, so the guest lands in the host’s real room');
  // Blocking ends the visit at once.
  assert.equal((await post(f, '/api/social/block', { id: guest.id, cityId: 'lagos' }, host)).code, 'blocked');
  assert.equal((await until(g, 'error')).code, 'visit_ended');
  joinHome(g, host.id); assert.equal((await until(g, 'error')).code, 'not_a_guest');
});

test('without the social module nobody can be a guest: the room module refuses every host id', async t => {
  const f = await fixture(t, { wsModules: [must(WS_MODULES[0], 'room module')] });
  const host = await f.device('Host'), guest = await f.device('Guest');
  const g = await f.socket(guest);
  joinHome(g, host.id); assert.equal((await next(g)).code, 'not_a_guest');
  say(g, { type: 'join', cityId: 'lagos', venueId: 'park' }); assert.equal((await next(g)).type, 'presence', 'ordinary rooms are unaffected');
});

test('an expired or removed guest is dropped at the next validation; a guest who leaves is dropped at once', async t => {
  const { f, host, h, others: [ada, bola, chi] } = await house(t, ['Ada', 'Bola', 'Chi']);
  for (const guest of [ada, bola, chi]) await letIn(f, host, guest);
  const a = await f.socket(ada), b = await f.socket(bola), c = await f.socket(chi);
  for (const peer of [a, b, c]) { joinHome(peer, host.id); await until(peer, 'presence'); }
  // Chi leaves by themselves: out of the room at once.
  assert.equal((await post(f, '/api/social/house/leave', { host: host.id }, chi)).code, 'left');
  assert.equal((await until(c, 'error')).code, 'visit_ended');
  // The host asks Bola to leave: out at once, and cannot come back without a new knock.
  assert.equal((await post(f, '/api/social/house/leave', { host: host.id, guest: bola.id }, host)).code, 'left');
  assert.equal((await until(b, 'error')).code, 'visit_ended');
  joinHome(b, host.id); assert.equal((await until(b, 'error')).code, 'not_a_guest');
  // Ada's visit runs out. Nothing ticks on the server: she is dropped when her membership is next validated,
  // which is her own next life read or action — the same schedule as every venue membership.
  f.advance(LIMITS.visitMs + 1000);
  assert.equal((await get(f, '/api/voice-config', ada)).status, 403, 'an expired visit is no longer live membership');
  assert.equal((await get(f, '/api/life?city=lagos', ada)).status, 200);
  assert.equal((await until(a, 'error')).code, 'visit_ended');
  joinHome(a, host.id); assert.equal((await until(a, 'error')).code, 'not_a_guest');
  say(a, { type: 'chat', body: 'still here?' }); assert.equal((await until(a, 'error')).code, 'join_required');
  assert.equal((await get(f, '/api/social/me', ada)).visiting, null);
  assert.deepEqual((await get(f, `/api/social/house/${host.id}`, host)).house.guests, []);
  // A guest who never asks for anything is still dropped: the host's own validation re-checks their room.
  await letIn(f, host, chi);
  joinHome(c, host.id); await until(c, 'presence');
  f.advance(LIMITS.visitMs + 1000);
  assert.equal((await get(f, '/api/life?city=lagos', host)).status, 200);
  assert.equal((await until(c, 'error')).code, 'visit_ended');
  // The host is alone in the room again.
  say(h, { type: 'chat', body: 'quiet now', clientId: 'q-1' });
  assert.equal((await until(h, 'chat')).body, 'quiet now');
  say(h, { type: 'move', x: 1, z: 1 });
  assert.deepEqual((await until(h, 'presence')).members.map((member) => member.name), ['Host']);
});

test('the host leaving home closes the visit: guests are dropped, the guest list empties, and nobody can be let in from outside', async t => {
  const { f, host, h, others: [guest, late] } = await house(t, ['Guest', 'Late']);
  await letIn(f, host, guest);
  const g = await f.socket(guest);
  joinHome(g, host.id); await until(g, 'presence');
  assert.equal((await get(f, '/api/social/me', guest)).visiting?.host.id, host.id);
  assert.equal((await post(f, '/api/social/house/knock', { host: host.id, cityId: 'lagos' }, late)).code, 'knocking');
  // The host sets off for the park. Their own room membership ends (existing rule) and so does every visit.
  assert.equal((await f.action(host.cookie, { type: 'travel', id: 'park', mode: 'trek' })).ok, true);
  assert.equal((await until(h, 'error')).code, 'venue_mismatch');
  assert.equal((await until(g, 'error')).code, 'visit_ended');
  assert.equal((await until(g, 'invite-house')).house.role, 'none', 'the guest is told the visit is over');
  assert.equal((await get(f, '/api/social/me', guest)).visiting, null);
  assert.deepEqual((await get(f, '/api/social/me', host)).house.guests, []);
  assert.ok((await get(f, '/api/social/me', guest)).updates.some((update) => /went out, so your visit ended/.test(update.text)));
  joinHome(g, host.id); assert.equal((await until(g, 'error')).code, 'not_a_guest');
  assert.equal((await get(f, '/api/voice-config', guest)).status, 403);
  // On the road, the host cannot let the late knocker in.
  const away = await post(f, '/api/social/house/answer', { visitor: late.id, answer: 'accept' }, host);
  assert.equal(away.ok, false); assert.equal(away.code, 'host_not_home'); assert.match(away.reason ?? '', /Go home first/);
  // Even a guest who never joined the room loses the visit: the next read of the house closes it.
  f.advance(20000);
  await f.action(host.cookie, { type: 'travel', id: 'home', mode: 'trek' }); f.advance(20000);
  say(h, { type: 'join', cityId: 'lagos', venueId: 'home' }); await until(h, 'presence');
  f.advance(LIMITS.knockMs + LIMITS.knockCooldownMs);
  await letIn(f, host, late);
  assert.equal((await f.action(host.cookie, { type: 'travel', id: 'park', mode: 'trek' })).ok, true);
  const l = await f.socket(late);
  joinHome(l, host.id); assert.equal((await until(l, 'error')).code, 'not_a_guest', 'the host is out: the stored visit is closed on this very check');
  assert.equal((await get(f, '/api/social/me', late)).visiting, null);
});
