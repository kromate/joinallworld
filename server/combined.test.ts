// What only shows when travel, the one main home, businesses, ping, several devices and the capacity work are in one
// server: which sockets each kind of frame reaches, a stall owned by a visitor, one allowance for gifts and purchases
// through the real routes, and a purchase made on one device of several.
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './test-fixture.ts';
import type { Device, FixtureOptions, TestSocket } from './test-fixture.ts';
import { claimsFor, fakeProvider, makeKey, signToken } from './accounts/test-tokens.ts';
import { JOURNEY_TIME } from './testing/cityJourney.ts';
import { LIVE } from './social/live.ts';
import { loadCityContent } from '../src/game/cities/registry.ts';
import { SECOND_HOME, tierCost } from '../src/game/content/world.ts';
import { TRANSFER_LIMITS } from '../src/game/content/npcs.ts';
import type { LifeState } from '../src/types/life.ts';
import type { ServerFrame } from '../src/types/protocol.ts';

await Promise.all(['lagos', 'ibadan', 'abuja'].map(loadCityContent));

const PROJECT = 'allworld-test-project';
const ENV = { ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT, ACCOUNTS_FIREBASE_API_KEY: 'test-web-api-key-0000000000000000000000' };
const DAY = 86400000, MINUTE = 60000;
type Who = { cookie: string };
type Answer = Record<string, unknown> & { status: number; state?: LifeState; rev?: number };
type Frame<T extends ServerFrame['type']> = Extract<ServerFrame, { type: T }>;
const pause = (ms = 25): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });
const must = <T>(value: T | null | undefined, what = 'value'): T => { if (value === null || value === undefined) throw new Error(`expected ${what}`); return value; };
const object = (value: unknown): Record<string, unknown> => { assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown>; };

/** A socket that keeps every frame it was sent. */
interface Ear { peer: TestSocket; frames: ServerFrame[]; of<T extends ServerFrame['type']>(type: T): Frame<T>[]; send(frame: object): void; clear(): void }
async function world(t: TestContext, options: FixtureOptions = {}) {
  const key = await makeKey('key-1'), provider = fakeProvider([key]);
  const f = await fixture(t, { env: ENV, fetch: (url, init) => provider.fetch(url, init as { body?: unknown }), log: () => {}, ...options });
  f.advance(JOURNEY_TIME - f.now());
  let minted = 0;
  const origin = (path: string, body: unknown, cookie?: string): Promise<Response> => fetch(f.base + path, { method: body === null ? 'GET' : 'POST', headers: { Origin: f.base, ...(body === null ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) }, ...(body === null ? {} : { body: JSON.stringify(body) }) });
  const answer = async (response: Response): Promise<Answer> => ({ ...object(await response.json()), status: response.status });
  const post = async (path: string, body: object, who?: Who): Promise<Answer> => answer(await f.request(path, body, who?.cookie));
  const get = async (path: string, who?: Who): Promise<Answer> => answer(await f.request(path, null, who?.cookie));
  /** A player with a life in Lagos, known to the social module. */
  async function player(name: string): Promise<Device> {
    const who = await f.device(name);
    await f.request('/api/life?city=lagos', null, who.cookie);
    await f.request('/api/social/me', null, who.cookie);
    return who;
  }
  /** Sign the same account in on this browser (with a cookie: the guest's character is saved to it) or on a new one. */
  async function signIn(subject: string, cookie?: string): Promise<Who> {
    const csrf = cookie ? ((await (await origin('/api/account', null, cookie)).json()) as { csrf: string | null }).csrf : null;
    const idToken = await signToken(key, claimsFor(PROJECT, f.now(), { subject, email: `${subject.toLowerCase()}@example.com`, n: ++minted }));
    const response = await origin('/api/account/sign-in', { idToken, csrf }, cookie);
    assert.equal(response.status, 200, 'signed in');
    await response.text();
    return { cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '' };
  }
  /** The stored record that holds a device's character: its own, or its account's. */
  const publicId = async (who: Who): Promise<string> => String(object((await get('/api/session', who)).session).id);
  const befriend = async (a: Who & { id: string }, b: Who & { id: string }): Promise<void> => {
    assert.equal((await post('/api/social/friends/request', { to: b.id, cityId: 'lagos' }, a)).code, 'requested');
    assert.equal((await post('/api/social/friends/answer', { from: a.id, accept: true, cityId: 'lagos' }, b)).code, 'accepted');
  };
  async function ear(who: Who): Promise<Ear> {
    const peer = await f.socket(who, { life: true }), frames: ServerFrame[] = [];
    peer.ws.on('message', (data) => { frames.push(JSON.parse(data.toString()) as ServerFrame); });
    return { peer, frames, of: <T extends ServerFrame['type']>(type: T) => frames.filter((frame): frame is Frame<T> => frame.type === type), send: (frame) => peer.ws.send(JSON.stringify(frame)), clear: () => { frames.length = 0; } };
  }
  async function until<T>(read: () => T | undefined | null | false, what: string): Promise<T> {
    for (let i = 0; i < 200; i++) { const value = read(); if (value) return value; await pause(10); }
    throw new Error(`Never happened: ${what}`);
  }
  /** Long enough for anything that was going to be sent to have been. */
  const quiet = (): Promise<void> => pause(Math.max(150, LIVE.tickMs * 3));
  const edit = async (who: Who, change: (state: LifeState) => void, city = 'lagos'): Promise<void> => {
    const id = await publicId(who);
    await f.server.store.transact((db) => { const state = Object.values(db.sessions).find((session) => session.publicId === id && session.cities[city as 'lagos']?.state)?.cities[city as 'lagos']?.state; assert.ok(state, `a life in ${city}`); change(state); });
  };
  const life = async (who: Who, city = 'lagos'): Promise<LifeState> => must((await get(`/api/life?city=${city}`, who)).state, `the life in ${city}`);
  const act = (who: Who, city: string, type: string, payload: object = {}) => f.action(who.cookie, { cityId: city as 'lagos', type, payload });
  /** Take a paid trip between two cities and arrive. */
  async function trip(who: Who, from: string, to: string, mode = 'road'): Promise<void> {
    const left = await act(who, from, 'estate.relocate', { to, mode });
    assert.equal(left.ok, true, `left ${from} for ${to}: ${left.code}`);
    f.advance(3 * MINUTE);
    await f.request(`/api/life?city=${from}`, null, who.cookie);
    assert.equal((await life(who, to)).estate.city, to);
  }
  /** Make a player a trader: money earned from work, hungry enough to eat, standing at a market. */
  const trader = (who: Who, city = 'lagos', venue = 'market') => edit(who, (state) => { state.cash = 300000; state.ledger = []; state.ledgerDays = []; state.location = venue; state.social.earned = 30000; state.needs.hunger = 30; }, city);
  const shop = {
    open: (who: Who, city = 'lagos', venue = 'market', extra: object = {}) => post('/api/business/open', { cityId: city, venue, type: 'food', name: 'Mama Put', colour: 'gold', icon: '🍲', requestId: f.id(), ...extra }, who),
    stock: (who: Who, items: object, city = 'lagos') => post('/api/business/stock', { cityId: city, items, requestId: f.id() }, who),
    buy: (who: Who, owner: string, product = 'jollof', units = 1, city = 'lagos', requestId = f.id()) => post('/api/business/buy', { cityId: city, shop: owner, product, units, requestId }, who),
    mine: async (who: Who, city = 'lagos') => object((await get(`/api/business/mine?city=${city}`, who)).mine),
  };
  return { f, post, get, player, signIn, befriend, ear, until, quiet, edit, life, act, trip, trader, shop };
}

// ---- (d) which sockets a frame reaches ---------------------------------------------------------------------------------

test('one character on three sockets, a friend and a stranger: a life change, a friend’s whereabouts, a call and a ping each reach exactly the sockets they are for', async (t) => {
  const w = await world(t), { f } = w;
  const guest = await w.player('Ada');
  const laptop = await w.signIn('UidAda', guest.cookie), phone = await w.signIn('UidAda'), tablet = await w.signIn('UidAda');
  const ada = { id: guest.id, cookie: laptop.cookie };
  const bola = await w.player('Bola'), chi = await w.player('Chi');
  await w.befriend(ada, bola);
  const [a, b, c, friend, stranger] = [await w.ear(laptop), await w.ear(phone), await w.ear(tablet), await w.ear(bola), await w.ear(chi)];
  const mine = [a, b, c], everyone = [a, b, c, friend, stranger];
  await w.quiet();
  for (const one of everyone) one.clear();

  // 1. A LIFE CHANGE made on the laptop: every socket of the character is told, and nobody else's.
  const actionId = `${f.now()}:${randomUUID()}`;
  const walked = await (await f.request('/api/action', { actionId, cityId: 'lagos', type: 'spot', payload: { id: 'trees' } }, laptop.cookie)).json() as { ok: boolean; rev?: number };
  assert.equal(walked.ok, true);
  for (const one of mine) { const told = await w.until(() => one.of('life-changed').at(-1), 'life-changed'); assert.ok(told.rev >= must(walked.rev)); assert.deepEqual(told.by, [actionId]); }
  await w.quiet();
  assert.deepEqual([friend, stranger].map((one) => one.of('life-changed').length), [0, 0]);

  // 2. WHEREABOUTS: the friend who watches is told where she goes; a stranger who watches is not; her own sockets that do not watch get no such frame.
  for (const one of [friend, stranger, b]) one.send({ type: 'live-watch', cityId: 'lagos' });
  for (const one of [friend, stranger, b]) await w.until(() => one.of('live-snapshot').at(-1), 'a snapshot');
  assert.deepEqual(must(friend.of('live-snapshot').at(-1)).friends.map((spot) => spot.id), [ada.id]);
  assert.deepEqual(must(stranger.of('live-snapshot').at(-1)).friends, []);
  for (const one of everyone) one.clear();
  f.advance(5000);
  assert.equal((await w.act(tablet, 'lagos', 'travel', { id: 'library', mode: 'trek' })).ok, true);
  const spotOf = (one: Ear) => one.of('live-move').flatMap((frame) => frame.spots ?? []).filter((spot) => spot.id === ada.id).at(-1);
  assert.deepEqual(must(await w.until(() => spotOf(friend)?.trip, 'the trip, told to the friend')).to, 'library');
  await w.quiet();
  assert.equal(spotOf(stranger), undefined, 'a stranger is told no friend’s place');
  assert.equal(stranger.of('live-move').every((frame) => !(frame.spots ?? []).length), true);
  assert.deepEqual([a, c].map((one) => one.of('live-move').length + one.of('live-snapshot').length), [0, 0], 'sockets that did not ask to watch are sent nothing');
  assert.equal(spotOf(b), undefined, 'her own watching socket is told the city’s counts, never herself as a friend');
  for (const one of mine) assert.ok(one.of('life-changed').length >= 1, 'the trip itself is a life change on all three');
  f.advance(20 * MINUTE);
  await f.request('/api/life?city=lagos', null, tablet.cookie);
  await w.until(() => spotOf(friend)?.venue === 'library', 'the arrival');
  await w.quiet();
  for (const one of everyone) one.clear();

  // 3. A CALL: it rings on all three and nowhere else; one device answers, and the signalling goes to that socket alone.
  friend.send({ type: 'call-invite', to: ada.id, clientId: 'c1' });
  const rings = await Promise.all(mine.map((one) => w.until(() => one.of('call-incoming').at(-1), 'a ring')));
  assert.equal(new Set(rings.map((ring) => ring.callId)).size, 1);
  const callId = must(rings[0]).callId;
  b.send({ type: 'call-accept', callId });
  await w.until(() => b.of('call-state').find((frame) => frame.state === 'accepted' && !frame.elsewhere), 'accepted on the phone');
  for (const one of [a, c]) await w.until(() => one.of('call-state').find((frame) => frame.state === 'accepted' && frame.elsewhere === true), 'answered elsewhere');
  await w.until(() => friend.of('call-state').find((frame) => frame.state === 'accepted'), 'the caller is told');
  friend.send({ type: 'call-signal', callId, kind: 'offer', data: { sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n' } });
  await w.until(() => b.of('call-signal').at(-1), 'the offer on the answering socket');
  await w.quiet();
  assert.deepEqual([a, c, stranger].map((one) => one.frames.filter((frame) => frame.type === 'call-signal').length), [0, 0, 0]);
  assert.deepEqual(stranger.frames.filter((frame) => frame.type.startsWith('call-')), [], 'a stranger hears nothing of the call');
  b.send({ type: 'call-hangup', callId });
  await w.until(() => friend.of('call-state').find((frame) => frame.state === 'ended'), 'ended');
  await w.quiet();
  for (const one of everyone) one.clear();

  // 4. A PING to her: every socket of hers is told, nobody else's. Her join, made on one device: the pinger is told on his
  //    socket, her other devices are told her life changed, and the stranger hears nothing at all.
  f.advance(MINUTE);
  const pinged = await w.post('/api/social/ping', { to: ada.id, clientId: f.id() }, bola);
  assert.deepEqual([pinged.code, pinged.note], ['pinged', 'told']);
  for (const one of mine) assert.equal(must(await w.until(() => one.of('ping-incoming').at(-1), 'the ping')).notice.from.id, bola.id);
  await w.quiet();
  assert.deepEqual([friend, stranger].map((one) => one.of('ping-incoming').length), [0, 0]);
  for (const one of everyone) one.clear();
  const joined = await w.post('/api/social/ping/join', { from: bola.id, clientId: f.id() }, phone);
  assert.deepEqual([joined.code, joined.moved], ['joined', 'venue']);
  assert.equal(must(await w.until(() => friend.of('ping-joined').at(-1), 'the pinger is told')).by.id, ada.id);
  for (const one of mine) await w.until(() => one.of('life-changed').at(-1), 'the join moved the life: every device is told');
  await w.quiet();
  assert.deepEqual(mine.map((one) => one.of('ping-joined').length), [0, 0, 0]);
  assert.deepEqual(stranger.frames.filter((frame) => frame.type.startsWith('ping-') || frame.type === 'life-changed' || frame.type.startsWith('call-')), []);
  for (const device of [laptop, phone, tablet]) assert.equal((await w.life(device)).location, 'park', 'all three read the life where the join put it');
  // A ping she takes back, and one that ends because she left, are told to the friend's socket only.
  f.advance(31 * MINUTE);
  for (const one of everyone) one.clear();
  assert.equal((await w.post('/api/social/ping', { to: bola.id, clientId: f.id() }, tablet)).code, 'pinged');
  assert.equal(must(await w.until(() => friend.of('ping-incoming').at(-1), 'her ping')).notice.from.id, ada.id);
  assert.equal((await w.post('/api/social/ping/cancel', { to: bola.id }, laptop)).code, 'cancelled');
  assert.equal(must(await w.until(() => friend.of('ping-ended').at(-1), 'taken back')).from, ada.id);
  await w.quiet();
  assert.deepEqual([...mine, stranger].map((one) => one.frames.filter((frame) => frame.type.startsWith('ping-')).length), [0, 0, 0, 0]);
});

// ---- (b) a stall and the one main home ---------------------------------------------------------------------------------

test('a visitor rents a stall where they do not live: it trades while they are away, is collected from and paid for from anywhere, and buying a home there or moving the main home never touches it', async (t) => {
  const w = await world(t), { f } = w;
  const ada = await w.player('Ada');
  await w.edit(ada, (state) => { state.cash = 400000; });
  await w.trip(ada, 'lagos', 'ibadan');
  const visiting = await w.life(ada, 'ibadan');
  assert.deepEqual([visiting.estate.lga, visiting.estate.home, Object.keys(visiting.estate.away)], [null, 'lagos', ['lagos']]);
  // A visitor, with no home and no local government in Ibadan, rents a stall at Bodija Market and stocks it.
  await w.trader(ada, 'ibadan', 'bodija-market');
  const opened = await w.shop.open(ada, 'ibadan', 'bodija-market');
  assert.deepEqual([opened.code, opened.state?.cash, opened.state?.business.opened, opened.state?.estate.lga], ['opened', 300000 - 15000, 1, null]);
  assert.equal((await w.shop.stock(ada, { jollof: 14, 'local-plate': 10, 'puff-puff': 6 }, 'ibadan')).code, 'stocked');
  const stall = async (city: string) => { const mine = await w.shop.mine(ada, city); return [mine.name, mine.cityName, mine.status, mine.venue] as const; };
  assert.deepEqual(await stall('ibadan'), ['Mama Put', 'Ibadan', 'open', 'bodija-market']);
  assert.equal((await w.shop.mine(ada, 'ibadan')).here, true);
  // She still is a visitor: the stall gave her no home, no local government and no vote here, and a guest house still takes her.
  const still = await w.life(ada, 'ibadan');
  assert.deepEqual([still.estate.lga, still.estate.home, still.estate.plot], [null, 'lagos', null]);
  await w.edit(ada, (state) => { state.needs.energy = 20; }, 'ibadan');
  assert.equal((await w.act(ada, 'ibadan', 'estate.lodge')).code, 'rested');
  assert.deepEqual(await stall('ibadan'), ['Mama Put', 'Ibadan', 'open', 'bodija-market']);

  // Home to Lagos. The stall trades without her; from Lagos she sees it, collects and pays rent ahead, and cannot restock.
  await w.trip(ada, 'ibadan', 'lagos');
  f.advance(6 * 3600000);
  const away = await w.shop.mine(ada, 'lagos');
  assert.deepEqual([away.cityName, away.here, away.status], ['Ibadan', false, 'open']);
  assert.ok(Number(away.till) > 0, 'it sold while she was in Lagos');
  const before = must((await w.life(ada)).cash);
  const collected = await w.post('/api/business/collect', { cityId: 'lagos', requestId: f.id() }, ada);
  assert.deepEqual([collected.code, collected.amount, collected.state?.cash, collected.state?.estate.city], ['collected', away.till, before + Number(away.till), 'lagos']);
  const rent = await w.post('/api/business/rent', { cityId: 'lagos', requestId: f.id() }, ada);
  assert.deepEqual([rent.code, rent.state?.cash], ['rent_paid', before + Number(away.till) - 7000]);
  assert.equal((await w.shop.stock(ada, { jollof: 1 }, 'lagos')).code, 'not_at_shop');
  // The Lagos market shows no Ibadan stall and will not rent her a second one.
  const market = await w.get('/api/business/venue?city=lagos&venue=market', ada);
  assert.deepEqual([(market.shops as unknown[]).length, market.openWhy], [0, 'You already run a business. One per player for now.']);

  // Back in Ibadan she BUYS A HOME there: the stall is as it was, to the unit and the naira in the box.
  await w.trip(ada, 'lagos', 'ibadan');
  // Everything the owner's screen is told about it (the clock stands still between the reads).
  const snapshot = () => w.shop.mine(ada, 'ibadan');
  const kept = await snapshot();
  const price = must(tierCost('ibadan', 'ibadan-north', SECOND_HOME.tier));
  const cash = must((await w.life(ada, 'ibadan')).cash);
  const bought = await w.act(ada, 'ibadan', 'estate.set-lga', { lga: 'ibadan-north', via: 'manual', home: 'buy' });
  assert.deepEqual([bought.code, bought.state.cash, bought.state.estate.home, bought.state.business.opened], ['home_bought', cash - price, 'lagos', 1]);
  assert.deepEqual(await snapshot(), kept, 'buying a home changed nothing about the stall');
  // …and NAMES IBADAN HER MAIN HOME: still the same stall, still hers, still one.
  const named = await w.act(ada, 'ibadan', 'estate.make-home');
  assert.deepEqual([named.code, named.state.estate.home, Object.keys(named.state.estate.away)], ['home_set', 'ibadan', ['lagos']]);
  assert.deepEqual(await snapshot(), kept, 'moving the main home changed nothing about the stall');
  await w.trader(ada, 'ibadan', 'bodija-market');
  assert.equal((await w.shop.stock(ada, { jollof: 1 }, 'ibadan')).code, 'stocked', 'and it is still run from its market');
  assert.equal((await w.shop.open(ada, 'ibadan', 'bodija-market')).code, 'cannot_open');
});

test('a visitor who moves the free starter house to the city of their stall, and one who leaves that city for good: the stall follows neither', async (t) => {
  const w = await world(t), { f } = w;
  const bayo = await w.player('Bayo');
  await w.edit(bayo, (state) => { state.cash = 400000; });
  await w.trip(bayo, 'lagos', 'ibadan');
  await w.trader(bayo, 'ibadan', 'bodija-market');
  assert.equal((await w.shop.open(bayo, 'ibadan', 'bodija-market')).code, 'opened');
  assert.equal((await w.shop.stock(bayo, { jollof: 10 }, 'ibadan')).code, 'stocked');
  const view = (city: string) => w.shop.mine(bayo, city);
  const kept = await view('ibadan');
  // "Make Ibadan my main home": the Lagos starter house is given up; the stall is not part of that.
  const moved = await w.act(bayo, 'ibadan', 'estate.set-lga', { lga: 'ibadan-north', via: 'manual', home: 'main' });
  assert.deepEqual([moved.code, moved.state.estate.home, Object.keys(moved.state.estate.away), moved.state.business.opened], ['home_moved', 'ibadan', [], 1]);
  assert.deepEqual(await view('ibadan'), kept);
  // He goes on to Abuja, a visitor there with no home in Lagos any more: the Ibadan stall is still his, seen and paid for from Abuja.
  await w.trip(bayo, 'ibadan', 'abuja');
  const far = await w.shop.mine(bayo, 'abuja');
  assert.deepEqual([far.name, far.cityName, far.here, far.status], ['Mama Put', 'Ibadan', false, 'open']);
  assert.equal((await w.post('/api/business/rent', { cityId: 'abuja', requestId: f.id() }, bayo)).code, 'rent_paid');
  const life = await w.life(bayo, 'abuja');
  assert.deepEqual([life.estate.lga, life.estate.home, Object.keys(life.estate.away)], [null, 'ibadan', ['ibadan']]);
});

// ---- (c) one allowance, blocks, and several devices ----------------------------------------------------------------------

test('gifts and purchases through the real routes share one allowance, in either order, and a block stops both', async (t) => {
  const w = await world(t), { f } = w;
  const ada = await w.player('Ada'), bola = await w.player('Bola'), chi = await w.player('Chi');
  await w.befriend(bola, ada); await w.befriend(chi, ada);
  for (const who of [ada, bola, chi]) await w.trader(who);
  assert.equal((await w.shop.open(ada)).code, 'opened');
  assert.equal((await w.shop.stock(ada, { jollof: 14 })).code, 'stocked');
  const gift = (from: Device, amount: number) => w.post('/api/social/transfers', { to: ada.id, cityId: 'lagos', amount, clientId: f.id() }, from);
  // Bola has earned ₦2,000 from work. A plate first (₦600), then a gift: only the rest can be given.
  await w.edit(bola, (state) => { state.social.earned = 2000; });
  assert.equal((await w.shop.buy(bola, ada.id)).code, 'bought');
  const over = await gift(bola, 1500);
  assert.deepEqual([over.ok, over.code], [false, 'gift_exceeds_earned']);
  assert.match(String(over.reason), /You can still give ₦1,400\./);
  assert.equal((await gift(bola, 1400)).code, 'sent');
  await w.edit(bola, (state) => { state.needs.hunger = 20; });
  const none = await w.shop.buy(bola, ada.id);
  assert.deepEqual([none.ok, none.code], [false, 'spend_exceeds_earned']);
  const spent = await w.life(bola);
  assert.deepEqual([spent.business.spent, spent.social.transfer.total, spent.cash], [600, 1400, 300000 - 2000]);
  // Chi the other way round: a gift first, then the stall takes only what is left of what he earned.
  await w.edit(chi, (state) => { state.social.earned = 2000; });
  assert.equal((await gift(chi, 1500)).code, 'sent');
  const two = await w.shop.buy(chi, ada.id, 'jollof', 2);
  assert.deepEqual([two.ok, two.code], [false, 'spend_exceeds_earned']);
  assert.equal((await w.shop.buy(chi, ada.id, 'jollof', 1)).code, 'spend_exceeds_earned', '₦500 is left; a plate is ₦600');
  assert.equal((await w.life(chi)).cash, 300000 - 1500);
  // A block, made by either side, closes both roads at once — and says no more than that.
  await w.edit(chi, (state) => { state.social.earned = 30000; state.needs.hunger = 20; });
  assert.equal((await w.shop.buy(chi, ada.id)).code, 'bought');
  assert.equal((await w.post('/api/social/block', { id: chi.id, cityId: 'lagos' }, ada)).ok, true);
  const cash = (await w.life(chi)).cash;
  await w.edit(chi, (state) => { state.needs.hunger = 20; });
  assert.equal((await w.shop.buy(chi, ada.id)).code, 'blocked');
  assert.equal((await gift(chi, 500)).ok, false);
  // A chat the two are not both in cannot be written to by naming it: the stall's Chat is the ordinary direct chat.
  const chat = await w.post('/api/social/messages', { to: ada.id, body: 'Is the jollof fresh?', clientId: f.id() }, bola);
  assert.equal(chat.ok, true);
  const conv = String(object(chat.conv).id);
  const intruder = await w.post('/api/social/messages', { conv, body: 'Let me in', clientId: f.id() }, chi);
  assert.deepEqual([intruder.ok, intruder.code], [false, 'not_a_member']);
  assert.equal((await w.life(chi)).cash, cash, 'nothing moved');
});

test('a purchase on one device of three: the others are told at once and read the same wallet; two devices after the last plate get one plate and one "sold out"; the owner’s devices agree on what was collected', async (t) => {
  const w = await world(t), { f } = w;
  const guest = await w.player('Ada');
  const laptop = await w.signIn('UidAda', guest.cookie), phone = await w.signIn('UidAda'), tablet = await w.signIn('UidAda');
  const ownerGuest = await w.player('Bola');
  const till = await w.signIn('UidBola', ownerGuest.cookie), office = await w.signIn('UidBola');
  await w.trader(laptop); await w.trader(till);
  assert.equal((await w.shop.open(till)).code, 'opened');
  assert.equal((await w.shop.stock(till, { jollof: 3 })).code, 'stocked');
  const [a, b, c, o1, o2] = [await w.ear(laptop), await w.ear(phone), await w.ear(tablet), await w.ear(till), await w.ear(office)];
  await w.quiet();
  for (const one of [a, b, c, o1, o2]) one.clear();
  // One plate, bought on the phone.
  const before = await w.get('/api/life?city=lagos', laptop);
  const bought = await w.shop.buy(phone, ownerGuest.id);
  assert.deepEqual([bought.code, bought.state?.cash], ['bought', 300000 - 600]);
  for (const one of [a, b, c]) assert.ok(must(await w.until(() => one.of('life-changed').at(-1), 'the purchase, told to every device')).rev > must(before.rev));
  for (const device of [laptop, tablet]) { const seen = await w.life(device); assert.deepEqual([seen.cash, seen.business.spent, seen.business.buys.count], [300000 - 600, 600, 1]); }
  await w.quiet();
  assert.deepEqual([o1, o2].map((one) => one.of('life-changed').length), [0, 0], 'a sale changes the stall, not the owner’s life');
  // Two plates are left. Three devices of the same buyer ask for two each at the same moment: one is served.
  await w.edit(laptop, (state) => { state.needs.hunger = 5; });
  const race = await Promise.all([laptop, phone, tablet].map((device) => w.shop.buy(device, ownerGuest.id, 'jollof', 2)));
  assert.deepEqual(race.map((answer) => answer.code).sort(), ['bought', 'sold_out', 'sold_out']);
  const after = await w.life(tablet);
  assert.deepEqual([after.cash, after.business.spent, after.business.buys.count], [300000 - 600 - 1200, 1800, 2], 'paid for once');
  for (const device of [laptop, phone]) assert.equal((await w.life(device)).cash, after.cash);
  // The same request sent again from another device is the same purchase.
  await w.edit(till, (state) => { state.location = 'market'; });
  assert.equal((await w.shop.stock(till, { jollof: 2 })).code, 'stocked');
  await w.edit(laptop, (state) => { state.needs.hunger = 5; });
  const requestId = f.id();
  const first = await w.shop.buy(laptop, ownerGuest.id, 'jollof', 1, 'lagos', requestId), again = await w.shop.buy(tablet, ownerGuest.id, 'jollof', 1, 'lagos', requestId);
  assert.deepEqual([first.code, again.code, (await w.life(phone)).cash], ['bought', 'bought', after.cash - 600]);
  // The owner collects on one device: the other is told, and both read the takings once.
  for (const one of [o1, o2]) one.clear();
  const box = Number((await w.shop.mine(office)).till);
  assert.equal(box, 600 + 1200 + 600);
  const collected = await w.post('/api/business/collect', { cityId: 'lagos', requestId: f.id() }, office);
  assert.deepEqual([collected.code, collected.amount], ['collected', box]);
  for (const one of [o1, o2]) await w.until(() => one.of('life-changed').at(-1), 'the takings, told to both of the owner’s devices');
  assert.equal((await w.life(till)).cash, must(collected.state).cash);
  const twice = await w.post('/api/business/collect', { cityId: 'lagos', requestId: f.id() }, till);
  assert.deepEqual([twice.ok, twice.code, twice.state?.cash ?? (await w.life(till)).cash], [false, 'nothing_to_collect', must(collected.state).cash], 'nothing is collected twice');
});
