// OWNER: quick start — the server side of the first minute: exactly-once creation, the invite landing
// (POST /api/social/join) and the guards that keep a guest out of every state the economy takes as settled.
// Fixture: see server/routes/index.ts ("HOW TO TEST").
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './test-fixture.ts';
import { readFile } from 'node:fs/promises';
import { JOIN_WINDOW_MS } from '../src/game/systems/onboarding.ts';
import type { LifeState, Look } from '../src/types/index.ts';

type Fixture = Awaited<ReturnType<typeof fixture>>;
type Frame = Record<string, unknown>;
interface Who { name: string; cookie: string; id: string }
/** What the tests read of a JSON answer: the status, plus the few fields they look at (all optional: an error answer has none). */
interface Reply { status: number; ok?: boolean; code?: string; error?: string; host?: { id: string; name: string }; venue?: string; hostStatus?: string }
const isRecord = (value: unknown): value is Frame => typeof value === 'object' && value !== null;
const isLifeState = (value: unknown): value is LifeState => isRecord(value) && typeof value.cash === 'number' && isRecord(value.onboarding);
const frameOf = (value: unknown): Frame => (isRecord(value) ? value : {});
const replyOf = (body: unknown, status: number): Reply => ({ ...(isRecord(body) ? body : {}), status });

const LOOK: Look = { body: 'woman', hair: 'braids', outfit: 'casual', fabric: 'ankara', skin: 'skin-6', hairColor: 'soft-black', outfitColor: 'orange', bottomsColor: 'teal' };
async function open(f: Fixture, name: string): Promise<Who> {
  const res = await f.request('/api/session', { name, onboarding: true });
  assert.equal(res.status, 200);
  const body: unknown = await res.json(), session = isRecord(body) ? body.session : undefined;
  return { name, cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '', id: isRecord(session) && typeof session.id === 'string' ? session.id : '' };
}
async function life(f: Fixture, who: { cookie: string }): Promise<LifeState> {
  const body: unknown = await (await f.request('/api/life?city=lagos', null, who.cookie)).json();
  if (!isRecord(body) || !isLifeState(body.state)) throw new Error('not a life response');
  return body.state;
}
const post = async (f: Fixture, path: string, body: Frame, who?: { cookie: string }): Promise<Reply> => { const res = await f.request(path, body, who?.cookie); return replyOf(await res.json(), res.status); };
const get = async (f: Fixture, path: string, who: { cookie: string }): Promise<Reply> => { const res = await f.request(path, null, who.cookie); return replyOf(await res.json(), res.status); };
/** A guest who has tapped Play. */
async function guest(f: Fixture, name: string) {
  const who = await open(f, name);
  await life(f, who);
  assert.equal((await f.action(who.cookie, { type: 'onboarding.quick-start', payload: { look: LOOK } })).code, 'playing');
  return who;
}
/** Settle a guest in (moves home unless `stay`). */
async function settle(f: Fixture, who: { cookie: string }, extra: Frame = {}) {
  await f.action(who.cookie, { type: 'onboarding.traits', payload: { traits: ['musical', 'clean-pikin'] } });
  await f.action(who.cookie, { type: 'onboarding.dream', payload: { dream: 'afrobeats-star' } });
  const rolled = await f.action(who.cookie, { type: 'onboarding.lottery', payload: {} });
  const moved = await f.action(who.cookie, { type: 'onboarding.home', payload: { house: rolled.state.onboarding.lottery.id === 'ajebutter' ? 'lekki' : 'yaba', ...extra } });
  assert.equal(moved.code, 'life_started');
  return moved.state;
}
/** Travel and wait out the trip (the last roadside choice is free). */
async function go(f: Fixture, who: { cookie: string }, id: string) {
  const started = await f.action(who.cookie, { type: 'travel', id, mode: 'danfo' });
  assert.equal(started.code, 'started', started.state.message);
  f.advance((started.state.activeAction?.duration ?? NaN) * 1000);
  let state = await life(f, who);
  if (state.travel.event) state = (await f.action(who.cookie, { type: 'world.roadside', payload: { choice: 'decline' } })).state;
  assert.equal(state.location, id);
  return state;
}
async function inRoom(f: Fixture, who: { cookie: string }, venueId: string, hostId?: string): Promise<{ peer: Awaited<ReturnType<Fixture['socket']>>; answer: Frame }> {
  const peer = await f.socket(who);
  peer.ws.send(JSON.stringify({ type: 'join', cityId: 'lagos', venueId, ...(hostId ? { hostId } : {}) }));
  const answer = await peer.next();
  return { peer, answer: isRecord(answer) ? answer : {} };
}

test('creation is exactly once: one session is one life, however often Play is sent, retried or reloaded', async t => {
  const f = await fixture(t);
  const ada = await open(f, 'Ada');
  // The life is made by the first read; reads in parallel (a reload racing the first load) still make one.
  const [a, b, c] = await Promise.all([life(f, ada), life(f, ada), life(f, ada)]);
  assert.deepEqual([a.onboarding.bornAt, b.onboarding.bornAt, c.onboarding.bornAt], [100000, 100000, 100000]);
  // Play under one action id: a double tap, then a retry after a "lost" answer, then again after a reload a minute later.
  const play = { actionId: `${f.now()}:33333333-3333-4333-8333-333333333333`, cityId: 'lagos', type: 'onboarding.quick-start', payload: { look: LOOK } };
  const answers: Frame[] = await Promise.all([f.request('/api/action', play, ada.cookie), f.request('/api/action', play, ada.cookie)]).then((all) => Promise.all(all.map(async (res) => frameOf(await res.json()))));
  f.advance(60000);
  answers.push(frameOf(await (await f.request('/api/action', play, ada.cookie)).json()));
  assert.deepEqual(answers.map((answer) => answer.code), ['playing', 'playing', 'playing']);
  assert.equal(answers.filter((answer) => answer.duplicate).length, 2, 'applied once, replayed twice');
  const state = await life(f, ada);
  assert.deepEqual([state.onboarding.playedAt, state.onboarding.stage, state.onboarding.required, state.name], [100000, 'guest', false, 'Ada']);
  // The same id with another look is refused, not applied.
  const other = await f.request('/api/action', { ...play, payload: { look: { ...LOOK, hair: 'afro' } } }, ada.cookie);
  const conflict: unknown = await other.json();
  assert.deepEqual([other.status, isRecord(conflict) ? conflict.error : undefined], [409, 'action_id_conflict']);
  // The stored data holds one session with one life per city asked for.
  await f.flush();
  const file: unknown = JSON.parse(await readFile(`${f.dir}/devices.json`, 'utf8'));
  const stored: unknown = isRecord(file) ? file.sessions : undefined;
  assert.deepEqual(Object.values(isRecord(stored) ? stored : {}).map((session) => Object.keys(isRecord(session) && isRecord(session.cities) ? session.cities : {})), [['lagos']]);
  // A name the filter refuses creates nothing at all.
  const refused = await f.request('/api/session', { name: 'ab', onboarding: true });
  assert.equal(refused.status, 400);
  assert.equal(refused.headers.get('set-cookie'), null);
});

test('invite landing: a brand-new guest is put in the inviter’s public venue — once, free, and only while they are really there', async t => {
  const f = await fixture(t);
  const ada = await guest(f, 'Ada');
  await settle(f, ada);
  await get(f, '/api/social/me', ada);
  await go(f, ada, 'library');
  const room = await inRoom(f, ada, 'library');
  assert.equal(room.answer.type, 'presence');

  // Before Play nothing about the inviter is answered: the visitor is not in the city yet.
  const early = await open(f, 'Bola');
  await life(f, early);
  assert.deepEqual(await post(f, '/api/social/join', { host: ada.id, cityId: 'lagos' }, early), { status: 403, error: 'onboarding_required' });
  // No session at all: nothing.
  assert.equal((await post(f, '/api/social/join', { host: ada.id, cityId: 'lagos' })).status, 401);

  const bola = await guest(f, 'Bola');
  const before = await life(f, bola);
  const landed = await post(f, '/api/social/join', { host: ada.id, cityId: 'lagos' }, bola);
  assert.deepEqual([landed.ok, landed.code, landed.host, landed.venue, landed.hostStatus], [true, 'joined', { id: ada.id, name: 'Ada' }, 'library', 'out']);
  const after = await life(f, bola);
  assert.deepEqual([after.location, after.cash, after.activeAction, after.onboarding.joined, after.onboarding.stage], ['library', before.cash, null, true, 'guest'], 'there at once, free, still a guest');
  assert.equal((await inRoom(f, bola, 'library')).answer.type, 'presence', 'and admitted to that venue’s room');
  // Again: they already share the venue. From somewhere else: the one arrival is used, nothing is disclosed.
  assert.deepEqual([(await post(f, '/api/social/join', { host: ada.id, cityId: 'lagos' }, bola)).code], ['here']);
  await go(f, bola, 'park');
  const second = await post(f, '/api/social/join', { host: ada.id, cityId: 'lagos' }, bola);
  assert.deepEqual([second.code, second.venue, (await life(f, bola)).location], ['out', undefined, 'park']);

  // A settled player is never moved by a link, and is not told the venue.
  const chidi = await guest(f, 'Chidi');
  await settle(f, chidi, { stay: true });
  const settled = await post(f, '/api/social/join', { host: ada.id, cityId: 'lagos' }, chidi);
  assert.deepEqual([settled.code, settled.venue, (await life(f, chidi)).location], ['out', undefined, 'park']);
  // A guest past the first minutes is not moved either.
  const dayo = await guest(f, 'Dayo');
  f.advance(JOIN_WINDOW_MS + 1000);
  room.peer.ws.send(JSON.stringify({ type: 'move', x: 1, z: 1 })); await room.peer.next(); // Ada is still connected
  const late = await post(f, '/api/social/join', { host: ada.id, cityId: 'lagos' }, dayo);
  assert.deepEqual([late.code, late.venue, (await life(f, dayo)).location], ['out', undefined, 'park']);
  // The venue is never taken from the request, and the server-only arrival is not a player action.
  const eve = await guest(f, 'Eve');
  assert.equal((await post(f, '/api/social/join', { host: ada.id, cityId: 'lagos', venue: 'quilox' }, eve)).venue, 'library');
  assert.equal((await f.action(eve.cookie, { type: 'onboarding.arrive', payload: { venue: 'quilox' } })).code, 'server_only');
  // Blocked either way, unknown ids and one's own link say nothing.
  await post(f, '/api/social/block', { id: eve.id, cityId: 'lagos' }, ada);
  const femi = await guest(f, 'Femi');
  assert.equal((await post(f, '/api/social/join', { host: ada.id, cityId: 'lagos' }, eve)).code, 'unknown_player');
  assert.equal((await post(f, '/api/social/join', { host: '11111111-2222-4333-8444-555555555555', cityId: 'lagos' }, femi)).code, 'unknown_player');
  assert.equal((await post(f, '/api/social/join', { host: femi.id, cityId: 'lagos' }, femi)).code, 'self');
  assert.equal((await post(f, '/api/social/join', { host: 'nope', cityId: 'lagos' }, femi)).status, 400);
});

test('invite landing fallbacks: at home the visitor knocks (the existing flow, as a guest); offline they stay in the park', async t => {
  const f = await fixture(t);
  const ada = await guest(f, 'Ada');
  await settle(f, ada); // she is at home
  await get(f, '/api/social/me', ada);
  const bola = await guest(f, 'Bola');
  // Offline: nothing to join, the visitor stays where they arrived.
  const offline = await post(f, '/api/social/join', { host: ada.id, cityId: 'lagos' }, bola);
  assert.deepEqual([offline.ok, offline.code, offline.host?.name, offline.venue, (await life(f, bola)).location], [true, 'offline', 'Ada', undefined, 'park']);
  // At home and connected: the landing says so, and the knock flow lets a guest in.
  const home = await inRoom(f, ada, 'home');
  assert.equal(home.answer.type, 'presence');
  const atHome = await post(f, '/api/social/join', { host: ada.id, cityId: 'lagos' }, bola);
  assert.deepEqual([atHome.code, atHome.hostStatus, atHome.venue], ['at_home', 'home', undefined]);
  assert.equal((await post(f, '/api/social/house/knock', { host: ada.id, cityId: 'lagos' }, bola)).code, 'knocking');
  assert.equal((await post(f, '/api/social/house/answer', { visitor: bola.id, answer: 'accept' }, ada)).code, 'accepted');
  const visit = await inRoom(f, bola, 'home', ada.id);
  assert.equal(visit.answer.type, 'presence', 'a guest of the quick start can visit a friend’s home');
  const visiting = await life(f, bola);
  assert.deepEqual([visiting.location, visiting.onboarding.stage, visiting.economy.rent.house, visiting.onboarding.joined], ['park', 'guest', null, false], 'visiting changes nothing about the guest’s own life');
  // A guest cannot host: their own home room does not exist.
  const own = await inRoom(f, bola, 'home');
  assert.equal(own.answer.code, 'venue_mismatch');
});

test('no path lets a guest into a settled state: every home, rent, loan and house action over HTTP, across reloads and a week of bills', async t => {
  const f = await fixture(t);
  const ada = await guest(f, 'Ada');
  const refused: unknown[] = [];
  for (const fields of [{ type: 'travel', id: 'home', mode: 'trek' }, { type: 'travel', id: 'home', mode: 'danfo' }, { type: 'home.furniture-buy', payload: { item: 'plastic-chair', x: 0, y: 0, rot: 0 } },
    { type: 'home.furniture-move', payload: { id: 'f1', x: 1, y: 1, rot: 0 } }, { type: 'home.furniture-sell', payload: { id: 'f1' } }, { type: 'home.furniture-store', payload: { id: 'f1' } },
    { type: 'home.furniture-place', payload: { item: 'plastic-chair', x: 0, y: 0, rot: 0 } }, { type: 'home.grocery-buy', payload: { id: 'rice' } }, { type: 'home.kitchen-unpack' },
    { type: 'property.house-move', payload: { id: 'mushin' } }, { type: 'property.house-move', payload: { id: 'yaba' } }]) {
    const result = await f.action(ada.cookie, fields);
    refused.push(result.code);
    assert.equal(result.ok, false, fields.type);
  }
  assert.deepEqual([...new Set(refused)], ['settle_required']);
  for (const fields of [{ type: 'economy.pay-rent' }, { type: 'economy.pay-loan', payload: { mode: 'all' } }, { type: 'onboarding.home', payload: { house: 'yaba' } }, { type: 'onboarding.home', payload: { house: 'yaba', stay: true } },
    { type: 'onboarding.lottery' }, { type: 'onboarding.dream', payload: { dream: 'afrobeats-star' } }, { type: 'onboarding.boutique-buy', payload: { kind: 'hair', id: 'afro' } }]) {
    assert.equal((await f.action(ada.cookie, fields)).ok, false, `${fields.type} needs the steps before it`);
  }
  // A week later, past a Saturday: still nothing billed, nothing owed, no home.
  f.advance(8 * 86400000);
  const state = await life(f, ada);
  assert.deepEqual([state.cash, state.ledger.length, state.economy.rent, state.economy.loan, state.economy.billedWeek, state.economy.started, state.home.stocked, state.inventory, state.location],
    [5000, 0, { house: null, arrears: 0, missed: 0 }, null, null, false, false, {}, 'park']);
  // Settling in then creates exactly what the old flow created, once.
  const moved = await settle(f, ada);
  const rents: Record<string, number> = { mushin: 2400, yaba: 6000, lekki: 17000 };
  const rent = rents[moved.property.house ?? ''] ?? NaN;
  assert.deepEqual([moved.economy.started, moved.economy.rent.house, moved.home.stocked, moved.home.items.length > 0, moved.location], [true, moved.property.house, true, true, 'home']);
  assert.equal(moved.ledger.filter((entry) => entry.reason.startsWith('Start cash')).length, 1);
  assert.ok(rent > 0);
});
