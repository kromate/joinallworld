// OWNER: foundation — the server side of enforced character creation.
// A session created with { onboarding: true } gets lives that must finish creation first;
// every other session behaves exactly as before. Fixture: see server/routes/index.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './test-fixture.ts';
import type { ActionAttempt } from './test-fixture.ts';
import type { LifeState, Look } from '../src/types/index.ts';

type Fixture = Awaited<ReturnType<typeof fixture>>;
type Frame = Record<string, unknown>;
/** A device as the tests hold it: the cookie, and the public identity when there is one. */
interface Device { cookie: string; id: string }
/** What the tests read of a JSON answer: the status, plus the few fields they look at (all optional: an error answer has none). */
interface Reply {
  status: number; error?: string; code?: string; results?: { id: string }[]; checkedIn?: boolean; counters?: { players: number }
  balances?: { name: string }[]; you?: unknown; me?: { name: string }; placed?: boolean; lga?: string; plot?: { lga: string } | null
}
const isLifeState = (value: unknown): value is LifeState => isRecord(value) && typeof value.cash === 'number' && isRecord(value.onboarding);
const isRecord = (value: unknown): value is Frame => typeof value === 'object' && value !== null;
const cookieOf = (res: Response): string => (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
/** The `session` of a /api/session answer. */
async function sessionOf(res: Response): Promise<{ id: string; name: string }> {
  const body: unknown = await res.json();
  if (!isRecord(body) || !isRecord(body.session) || typeof body.session.id !== 'string' || typeof body.session.name !== 'string') throw new Error('not a session response');
  return { id: body.session.id, name: body.session.name };
}
/** The next socket message as a plain object. */
async function frameOf(peer: { next(): Promise<unknown> }): Promise<Frame> {
  const message = await peer.next();
  if (!isRecord(message)) throw new Error('not a message');
  return message;
}

async function open(f: Fixture, body: Frame): Promise<Device & { name: string }> {
  const res = await f.request('/api/session', body);
  assert.equal(res.status, 200);
  return { cookie: cookieOf(res), ...(await sessionOf(res)) };
}
async function life(f: Fixture, device: { cookie: string }, city = 'lagos'): Promise<LifeState> {
  const body: unknown = await (await f.request(`/api/life?city=${city}`, null, device.cookie)).json();
  if (!isRecord(body) || !isLifeState(body.state)) throw new Error('not a life response');
  return body.state;
}
const LOOK: Look = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' };

const quick = (f: Fixture, device: { cookie: string }, look: Look = LOOK) => f.action(device.cookie, { type: 'onboarding.quick-start', payload: { look } });
/** Settle in: the deferred choices, then the home. Returns the last answer. */
/** The names in a presence frame's `members`. */
const namesOf = (message: Frame): unknown[] => (Array.isArray(message.members) ? message.members : []).map((member: unknown) => isRecord(member) ? member.name : undefined);
async function settle(f: Fixture, device: { cookie: string }, extra: Frame = {}) {
  await f.action(device.cookie, { type: 'onboarding.traits', payload: { traits: ['musical', 'clean-pikin'] } });
  await f.action(device.cookie, { type: 'onboarding.dream', payload: { dream: 'afrobeats-star' } });
  const rolled = await f.action(device.cookie, { type: 'onboarding.lottery', payload: {} });
  assert.equal(rolled.code, 'rolled');
  return f.action(device.cookie, { type: 'onboarding.home', payload: { house: rolled.state.onboarding.lottery?.id === 'ajebutter' ? 'lekki' : 'yaba', ...extra } });
}

test('a session created with onboarding: true is a guest: held until its look is confirmed, then playing in public, with no home until it settles in', async t => {
  const f = await fixture(t);
  const ada = await open(f, { name: 'Ada', onboarding: true });
  const start = await life(f, ada);
  assert.deepEqual([start.onboarding.stage, start.onboarding.required, start.onboarding.done, start.location, start.cash], ['guest', true, false, 'park', 5000]);

  for (const fields of [{ type: 'spot', payload: { id: 'trees' } }, { type: 'activity', id: 'chill' }, { type: 'travel', id: 'library', mode: 'trek' }, { type: 'apply-job', id: 'tech' }, { type: 'cancel' }] satisfies ActionAttempt[]) {
    const refused = await f.action(ada.cookie, fields);
    assert.deepEqual([refused.ok, refused.code], [false, 'onboarding_required'], fields.type);
    assert.match(refused.state.message, /Choose your look and tap Play first/);
    assert.deepEqual([refused.state.location, refused.state.spot, refused.state.cash, refused.state.job, refused.state.activeAction], ['park', 'amphitheatre', 5000, null, null]);
  }
  // The refusal is a recorded outcome like any other: the same action ID replays it.
  const body = { actionId: `100000:11111111-1111-4111-8111-111111111111`, cityId: 'lagos', type: 'spot', payload: { id: 'trees' } };
  const first = await (await f.request('/api/action', body, ada.cookie)).json();
  const again = await (await f.request('/api/action', body, ada.cookie)).json();
  assert.deepEqual([first.code, again.code, again.duplicate], ['onboarding_required', 'onboarding_required', true]);

  // The other city's life for the same session is a guest too.
  assert.deepEqual([(await life(f, ada, 'ibadan')).onboarding.required, (await life(f, ada, 'ibadan')).onboarding.stage], [true, 'guest']);

  // The quick start is validated like any creation step, and it is exactly-once: a double tap or a retry is one start.
  assert.equal((await quick(f, ada, { ...LOOK, hair: 'bantu-knots' })).code, 'invalid_look');
  const play = { actionId: `100000:22222222-2222-4222-8222-222222222222`, cityId: 'lagos', type: 'onboarding.quick-start', payload: { look: LOOK } };
  const [one, two] = await Promise.all([f.request('/api/action', play, ada.cookie), f.request('/api/action', play, ada.cookie)]).then((all) => Promise.all(all.map((res) => res.json())));
  assert.deepEqual([one.code, two.code, [one.duplicate, two.duplicate].filter(Boolean).length], ['playing', 'playing', 1]);
  const playing = await life(f, ada);
  assert.deepEqual([playing.onboarding.required, playing.onboarding.stage, playing.onboarding.playedAt, playing.spot], [false, 'guest', 100000, 'trees']);
  assert.deepEqual(playing.onboarding.look, LOOK);
  // Play is open in public…
  assert.equal((await f.action(ada.cookie, { type: 'activity', id: 'play-ayo' })).code, 'started');
  f.advance(7000);
  const rewarded = await life(f, ada);
  assert.deepEqual([rewarded.cash, rewarded.goals.stars, rewarded.ledger.at(-1)?.reason, rewarded.onboarding.firstAt], [5500, 1, 'Goal: Play a round of Ayo', 107000]);
  // …and everything that needs a home is refused, so nothing the economy takes as settled can exist.
  for (const fields of [{ type: 'travel', id: 'home', mode: 'trek' }, { type: 'home.grocery-buy', payload: { id: 'rice' } }, { type: 'home.kitchen-unpack' }, { type: 'property.house-move', payload: { id: 'mushin' } },
    { type: 'home.furniture-buy', payload: { item: 'plastic-chair', x: 0, y: 0, rot: 0 } }] satisfies ActionAttempt[]) {
    const refused = await f.action(ada.cookie, fields);
    assert.deepEqual([refused.ok, refused.code], [false, 'settle_required'], fields.type);
  }
  const guest = await life(f, ada);
  assert.deepEqual([guest.economy.rent.house, guest.economy.loan, guest.economy.billedWeek, guest.cash], [null, null, null, 5500]);
  // The server-only arrival cannot be sent by a player.
  assert.equal((await f.action(ada.cookie, { type: 'onboarding.arrive', payload: { venue: 'quilox' } })).code, 'server_only');

  // Settling in: every step still validated in order, life.started once, nothing earned is lost.
  assert.equal((await f.action(ada.cookie, { type: 'onboarding.home', payload: { house: 'yaba' } })).code, 'step_required');
  const moved = await settle(f, ada);
  assert.deepEqual([moved.code, moved.state.location, moved.state.onboarding.done, moved.state.onboarding.stage], ['life_started', 'home', true, 'settled']);
  assert.equal(moved.state.ledger.filter((entry) => entry.reason.startsWith('Start cash')).length, 1);
  assert.equal(moved.state.cash - 500, moved.state.onboarding.seed + (moved.state.ledger.find((entry) => entry.reason.startsWith('Start cash'))?.amount ?? NaN), 'start cash as the old flow gave it, plus the ₦500 earned as a guest');
  assert.equal((await f.action(ada.cookie, { type: 'onboarding.home', payload: { house: 'mushin' } })).code, 'already_onboarded');
  assert.equal((await f.action(ada.cookie, { type: 'spot', payload: { id: 'bathroom' } })).code, 'selected');
});

test('a session created without the flag keeps today’s behaviour, and a rename can neither add nor remove the rule', async t => {
  const f = await fixture(t);
  const old = await f.device('Bola'); // { name } only, as every existing client and test sends
  const state = await life(f, old);
  assert.deepEqual([state.onboarding.required, state.onboarding.stage, state.onboarding.done], [false, 'settled', false]);
  assert.equal((await f.action(old.cookie, { type: 'spot', payload: { id: 'trees' } })).code, 'selected');
  // An existing session cannot be switched into enforcement, even before a city's life exists…
  const renamed = await f.request('/api/session', { name: 'Bola B', onboarding: true }, old.cookie);
  assert.equal((await sessionOf(renamed)).name, 'Bola B');
  assert.equal((await life(f, old, 'ibadan')).onboarding.required, false);
  // …and an enforced session cannot rename its way out.
  const ada = await open(f, { name: 'Ada', onboarding: true });
  assert.equal((await sessionOf(await f.request('/api/session', { name: 'Ada A' }, ada.cookie))).id, ada.id);
  const enforced = await life(f, ada);
  assert.deepEqual([enforced.name, enforced.onboarding.required], ['Ada A', true]);
  assert.equal((await f.action(ada.cookie, { type: 'spot', payload: { id: 'trees' } })).code, 'onboarding_required');
  // Only the literal `true` turns it on.
  for (const value of ['true', 1, { yes: true }, null]) {
    const device = await open(f, { name: 'Chidi', onboarding: value });
    assert.equal((await life(f, device)).onboarding.required, false, JSON.stringify(value));
  }
  const file: unknown = JSON.parse(await readFile(join(f.dir, 'devices.json'), 'utf8'));
  const stored: unknown = isRecord(file) ? file.sessions : undefined;
  assert.deepEqual(Object.values(isRecord(stored) ? stored : {}).map((session) => isRecord(session) && session.onboarding === true).sort(), [false, false, false, false, false, true]);
});

test('until the quick start is confirmed a player is not in the city: no room, no presence or chat, no directory, list, counter or search', async t => {
  const f = await fixture(t);
  const get = async (path: string, device?: { cookie: string }): Promise<Reply> => {
    const res = await f.request(path, null, device?.cookie);
    const body: unknown = await res.json();
    return { ...(isRecord(body) ? body : {}), status: res.status };
  };
  const old = await f.device('Bola');
  const ada = await open(f, { name: 'Ada', onboarding: true });
  await life(f, ada); await get('/api/social/me', old);
  const b = await f.joinRoom(old);
  // Rooms: refused for every venue, including her own home and a host's home, so she is in nobody's presence or chat.
  const a = await f.socket(ada);
  for (const message of [{ venueId: 'park' }, { venueId: 'home' }, { venueId: 'home', hostId: old.id }]) {
    a.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', ...message }));
    assert.equal((await frameOf(a)).code, 'onboarding_required', JSON.stringify(message));
  }
  a.ws.send(JSON.stringify({ type: 'chat', body: 'hello?' })); assert.equal((await frameOf(a)).code, 'join_required');
  b.ws.send(JSON.stringify({ type: 'move', x: 1, z: 1 }));
  assert.deepEqual(namesOf(await frameOf(b)), ['Bola'], 'the room has not heard of her');
  // Social: not registered as a player, so she cannot be found, messaged or befriended, and cannot do so herself.
  assert.deepEqual(await get('/api/social/me', ada), { status: 403, error: 'onboarding_required' });
  assert.deepEqual((await get('/api/social/search?q=ada', old)).results, []);
  const dm = await f.request('/api/social/messages', { to: ada.id, body: 'hi', clientId: 'c-12345678' }, old.cookie);
  const refusedDm: unknown = await dm.json();
  assert.equal(isRecord(refusedDm) ? refusedDm.code : undefined, 'unknown_player');
  // Civic: a pulse answers but does not check her in; she is in no counter, directory or list.
  const pulse = await get('/api/civic/pulse?city=lagos', ada);
  assert.deepEqual([pulse.status, pulse.checkedIn, pulse.counters?.players], [200, false, 0]);
  assert.equal((await get('/api/civic/pulse?city=lagos', old)).counters?.players, 1);
  assert.ok(!JSON.stringify(await get('/api/civic/neighbours?city=lagos', old)).includes(ada.id));
  const rich = await get('/api/civic/richlist?city=lagos', ada);
  assert.deepEqual([(rich.balances ?? []).map((row) => row.name), rich.you], [['Bola'], null]);
  // She taps Play (the quick start): now she is in the city like anyone else — as a guest, in public.
  assert.equal((await quick(f, ada)).code, 'playing');
  a.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'home' }));
  assert.equal((await frameOf(a)).code, 'venue_mismatch', 'a guest has no home room: she is in the park');
  a.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId: 'park' }));
  assert.equal((await frameOf(a)).type, 'presence');
  assert.equal((await get('/api/social/me', ada)).me?.name, 'Ada');
  assert.deepEqual(((await get('/api/social/search?q=ada', old)).results ?? []).map((item) => item.id), [ada.id]);
  // …but a guest is not a resident: she has no local government and no house, so she is in no directory, estate, counter or rich list.
  f.advance(6000);
  assert.equal((await get('/api/civic/pulse?city=lagos', ada)).checkedIn, false);
  f.advance(6000);
  assert.equal((await get('/api/civic/pulse?city=lagos', old)).counters?.players, 1);
  assert.ok(!JSON.stringify(await get('/api/civic/neighbours?city=lagos', old)).includes(ada.id));
  assert.equal((await get('/api/civic/richlist?city=lagos', ada)).you, null);
  assert.deepEqual([(await get('/api/world/me?city=lagos', ada)).placed, (await get('/api/world/me?city=lagos', ada)).plot], [false, null]);
  const early = await f.action(ada.cookie, { type: 'estate.set-lga', payload: { lga: 'ikeja' } });
  assert.deepEqual([early.code, early.state.estate.lgaConfirmed], ['settle_required', false], 'a guest cannot take a local government (and so a house) without settling in');
  // Settling in — with her local government — is what makes her a resident, with a house on a plot there.
  assert.equal((await settle(f, ada, { house: undefined, lga: 'ikeja', stay: true })).code, 'life_started');
  f.advance(6000);
  assert.equal((await get('/api/civic/pulse?city=lagos', ada)).checkedIn, true);
  f.advance(6000);
  assert.equal((await get('/api/civic/pulse?city=lagos', old)).counters?.players, 2);
  assert.ok(JSON.stringify(await get('/api/civic/neighbours?city=lagos', old)).includes(ada.id));
  const placed = await get('/api/world/me?city=lagos', ada);
  assert.deepEqual([placed.placed, placed.lga, placed.plot?.lga], [true, 'ikeja', 'ikeja']);
});
