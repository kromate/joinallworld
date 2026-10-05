// OWNER: business — player-owned shops on the Node host: the shared run (server/testing/businessJourney.ts), then what
// only this host can show: blocks, shared devices and networks, a visitor from another city, the operator's routes,
// hostile input and what is stored. The rules themselves are in src/game/business.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './test-fixture.ts';
import { businessJourney } from './testing/businessJourney.ts';
import { JOURNEY_TIME } from './testing/cityJourney.ts';
import { loadCityContent } from '../src/game/cities/registry.ts';
import { BUSINESS } from '../src/game/content/business.ts';
import type { LifeState } from '../src/types/life.ts';
import type { Database } from './types.ts';

await Promise.all(['lagos', 'ibadan', 'abeokuta'].map(loadCityContent));

type Fixture = Awaited<ReturnType<typeof fixture>>;
type Device = Awaited<ReturnType<Fixture['device']>>;
type Answer = Record<string, unknown> & { status: number; state?: LifeState };
const DAY = 86400000;
const object = (value: unknown): Record<string, unknown> => { assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown>; };
const list = (value: unknown): Record<string, unknown>[] => { assert.ok(Array.isArray(value)); return value.map(object); };

/** A fixture on a Monday morning with the market open, and the helpers of every test here. */
async function harness(t: Parameters<typeof fixture>[0], options: Parameters<typeof fixture>[1] = {}) {
  const f = await fixture(t, options);
  f.advance(JOURNEY_TIME - f.now());
  const post = async (path: string, body: object, device?: Device, headers: Record<string, string> = {}): Promise<Answer> => {
    const response = await fetch(f.base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(device ? { Cookie: device.cookie } : {}), ...headers }, body: JSON.stringify(body) });
    return { ...object(await response.json()), status: response.status };
  };
  const get = async (path: string, device?: Device, headers: Record<string, string> = {}): Promise<Answer> => {
    const response = await fetch(f.base + path, { headers: { ...(device ? { Cookie: device.cookie } : {}), ...headers } });
    return { ...object(await response.json()), status: response.status };
  };
  const edit = (device: Device, change: (state: LifeState) => void, city = 'lagos') => f.server.store.transact((db) => { const state = db.sessions[device.cookie.slice(4)]?.cities[city as 'lagos']?.state; assert.ok(state); change(state); });
  /** A player standing in the Lagos market with money earned from work. */
  async function trader(name: string): Promise<Device> {
    const device = await f.device(name);
    await f.request('/api/life?city=lagos', null, device.cookie);
    await edit(device, (state) => { state.cash = 100000; state.ledger = []; state.ledgerDays = []; state.location = 'market'; state.social.earned = 30000; state.needs.hunger = 30; });
    await f.request('/api/social/me', null, device.cookie);
    return device;
  }
  const open = (device: Device, extra: object = {}) => post('/api/business/open', { cityId: 'lagos', venue: 'market', type: 'food', name: 'Mama Put', colour: 'gold', icon: '🍲', requestId: f.id(), ...extra }, device);
  const stock = (device: Device, items: object) => post('/api/business/stock', { cityId: 'lagos', items, requestId: f.id() }, device);
  const buy = (device: Device, shop: string, product = 'jollof', units = 1, headers: Record<string, string> = {}) => post('/api/business/buy', { cityId: 'lagos', shop, product, units, requestId: f.id() }, device, headers);
  const database = async (): Promise<Database> => { await f.flush(); return JSON.parse(await readFile(join(f.dir, 'devices.json'), 'utf8')) as Database; };
  return { f, post, get, edit, trader, open, stock, buy, database };
}

test('a shop from opening to winding up, on the Node host', { timeout: 60000 }, async (t) => {
  const f = await fixture(t);
  f.advance(JOURNEY_TIME - f.now());
  const result = await businessJourney({
    now: f.now,
    request: (path, body, cookie) => f.request(path, body, cookie),
    elapse: async (_device, _city, ms) => { f.advance(ms); },
    edit: async (device, city, change) => { await f.server.store.transact((db) => { const state = db.sessions[device.cookie.slice(device.cookie.indexOf('=') + 1)]?.cities[city as 'lagos']?.state; assert.ok(state); change(state as unknown as Record<string, unknown>); }); },
    age: async (ms) => { f.advance(ms); },
  });
  assert.deepEqual([result.setup, result.bought, result.raced, result.closed], [15000, 1400, ['bought', 'sold_out'], true]);
  assert.ok(result.collected > 1400);
});

test('routes: under /api/business, guarded by the host, strict about input, and nothing personal without a session', async (t) => {
  const { f, get, post, trader } = await harness(t);
  const ada = await trader('Ada');
  assert.deepEqual(await get('/api/business/venue?city=atlantis&venue=market', ada), { status: 400, error: 'invalid_city' });
  assert.equal((await get('/api/business/venue?city=lagos&venue=../x', ada)).error, 'invalid_venue');
  assert.equal((await get('/api/business/venue?city=lagos', ada)).error, 'invalid_venue');
  assert.equal((await fetch(`${f.base}/api/business/venue?city=lagos&venue=market`, { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await get('/api/business/mine?city=lagos')).status, 401);
  for (const path of ['open', 'stock', 'price', 'collect', 'rent', 'upgrade', 'close', 'bag', 'bag/stock', 'bag/return', 'buy', 'rate', 'report']) {
    assert.equal((await post(`/api/business/${path}`, { cityId: 'lagos', requestId: f.id() })).status, 401, path);
    assert.equal((await post(`/api/business/${path}`, { cityId: 'atlantis', requestId: f.id() }, ada)).error, 'invalid_city', path);
  }
  for (const path of ['open', 'stock', 'collect', 'rent', 'upgrade', 'close', 'bag', 'bag/stock', 'bag/return', 'buy']) assert.equal((await post(`/api/business/${path}`, { cityId: 'lagos' }, ada)).status, 400, `${path} needs a request id`);
  // With no shop every owner route says so and charges nothing.
  for (const path of ['stock', 'collect', 'rent', 'upgrade', 'close', 'bag/stock']) {
    const refused = await post(`/api/business/${path}`, { cityId: 'lagos', requestId: f.id(), items: { jollof: 1 }, upgrade: 'front' }, ada);
    assert.deepEqual([refused.ok, refused.code, refused.state?.cash], [false, 'no_shop', 100000], path);
  }
  assert.equal((await post('/api/business/price', { cityId: 'lagos', prices: { jollof: 600 } }, ada)).code, 'no_shop');
  for (const body of [{ shop: 5 }, { shop: '__proto__' }, { shop: 'constructor', product: 'jollof', units: 1 }, {}]) assert.equal((await post('/api/business/buy', { cityId: 'lagos', requestId: f.id(), ...body }, ada)).code, 'no_such_shop');
  assert.equal((await post('/api/business/rate', { cityId: 'lagos', shop: 'nobody', stars: 5 }, ada)).code, 'no_such_shop');
});

test('the owner must stand at the market to open, stock, price and upgrade; a buyer must stand there to buy', async (t) => {
  const { f, post, edit, trader, open, stock, buy } = await harness(t);
  const ada = await trader('Ada'), bola = await trader('Bola');
  await edit(ada, (state) => { state.location = 'home'; });
  assert.deepEqual([(await open(ada)).code, (await open(ada)).reason], ['cannot_open', 'Go to Market to rent a stall there.']);
  await edit(ada, (state) => { state.location = 'market'; });
  assert.equal((await open(ada)).code, 'opened');
  assert.equal((await stock(ada, { jollof: 10 })).code, 'stocked');
  await edit(ada, (state) => { state.location = 'park'; });
  for (const [path, body] of [['stock', { items: { jollof: 1 } }], ['price', { prices: { jollof: 500 } }], ['upgrade', { upgrade: 'display' }], ['bag/stock', {}]] as const) {
    const refused = await post(`/api/business/${path}`, { cityId: 'lagos', requestId: f.id(), ...body }, ada);
    assert.equal(refused.code, 'not_at_shop', path);
    assert.match(String(refused.reason), /^Go to Market in Lagos to /);
  }
  // From anywhere: rent ahead, and the view.
  const rent = await post('/api/business/rent', { cityId: 'lagos', requestId: f.id() }, ada);
  assert.deepEqual([rent.code, rent.state?.cash, object(rent.mine).here], ['rent_paid', 100000 - 15000 - 3600 - 7000, false]);
  await edit(bola, (state) => { state.location = 'park'; });
  assert.equal((await buy(bola, ada.id)).code, 'not_at_shop');
  await edit(bola, (state) => { state.location = 'market'; });
  assert.equal((await buy(bola, ada.id)).code, 'bought');
});

test('upgrades, rent ahead and closing by choice: each charged once, and closing returns less than was put in', async (t) => {
  const { f, post, trader, open, stock, get } = await harness(t);
  const ada = await trader('Ada');
  await open(ada);
  await stock(ada, { jollof: 10 });
  const upgrade = f.id();
  const first = await post('/api/business/upgrade', { cityId: 'lagos', upgrade: 'display', requestId: upgrade }, ada);
  const repeat = await post('/api/business/upgrade', { cityId: 'lagos', upgrade: 'display', requestId: upgrade }, ada);
  assert.deepEqual([first.code, repeat.duplicate, repeat.state?.cash], ['upgraded', true, 100000 - 15000 - 3600 - 15000]);
  assert.equal((await post('/api/business/upgrade', { cityId: 'lagos', upgrade: 'display', requestId: f.id() }, ada)).code, 'already_upgraded');
  assert.equal((await post('/api/business/upgrade', { cityId: 'lagos', upgrade: 'jetpack', requestId: f.id() }, ada)).code, 'unknown_upgrade');
  // Rent may be paid at most four periods ahead.
  const codes: unknown[] = [];
  for (let index = 0; index < BUSINESS.rentAhead + 1; index++) codes.push((await post('/api/business/rent', { cityId: 'lagos', requestId: f.id() }, ada)).code);
  assert.deepEqual(codes, ['rent_paid', 'rent_paid', 'rent_paid', 'paid_ahead', 'paid_ahead']);
  const mine = object((await get('/api/business/mine?city=lagos', ada)).mine);
  assert.equal(mine.paidUntil, f.now() + 4 * 7 * DAY);
  const cash = 100000 - 15000 - 3600 - 15000 - 3 * 7000;
  const closing = f.id();
  const closed = await post('/api/business/close', { cityId: 'lagos', requestId: closing }, ada);
  // Half of setup and upgrade, half the stock's lowest cost, and the box; the rent paid ahead is not returned.
  assert.deepEqual([closed.code, closed.amount, closed.state?.cash, closed.mine], ['closed', 15000 + 10 * 180 * 0.5 + Number(mine.till), cash + 15000 + 900 + Number(mine.till), null]);
  assert.equal((await post('/api/business/close', { cityId: 'lagos', requestId: closing }, ada)).duplicate, true);
  assert.equal((await post('/api/business/close', { cityId: 'lagos', requestId: f.id() }, ada)).code, 'no_shop');
  assert.ok(Number(closed.state?.cash) < 100000, 'opening and closing is a loss');
});

test('blocked players, shared devices and shared networks cannot be used to pass money through a stall', async (t) => {
  const { f, post, get, trader, open, stock, buy } = await harness(t, { trustProxy: true });
  const ada = await trader('Ada'), bola = await trader('Bola'), chi = await trader('Chi'), dayo = await trader('Dayo');
  await open(ada, { type: 'fabric', icon: '🧵' });
  await stock(ada, { ankara: 4, adire: 3, 'aso-oke': 3 });
  // A block either way: no Buy, and the card says so.
  assert.equal((await post('/api/social/block', { id: ada.id, cityId: 'lagos' }, bola)).ok, true);
  assert.equal(list((await get('/api/business/venue?city=lagos&venue=market', bola)).shops)[0]?.blocked, true);
  assert.deepEqual([(await buy(bola, ada.id, 'ankara')).code, (await buy(bola, ada.id, 'ankara')).state?.cash], ['blocked', 100000]);
  // A buyer on a device the owner has used.
  for (const who of [ada, chi]) assert.equal((await post('/api/growth/hello', { cityId: 'lagos', device: 'device-0000-0000-0001' }, who)).status, 200);
  assert.equal((await buy(chi, ada.id, 'ankara')).code, 'same_device');
  // Two buyers behind one address share one buyer's allowance at a stall (₦5,000 a day).
  const address = { 'X-Forwarded-For': '203.0.113.9' };
  const first = await buy(dayo, ada.id, 'aso-oke', 1, address);
  assert.deepEqual([first.code, first.amount], ['bought', 3000]);
  const eve = await trader('Eve');
  assert.equal((await buy(eve, ada.id, 'aso-oke', 1, address)).code, 'pair_limit');
  assert.equal((await buy(eve, ada.id, 'ankara', 1, address)).code, 'bought');
  const femi = await trader('Femi');
  assert.equal((await buy(femi, ada.id, 'aso-oke', 1, { 'X-Forwarded-For': '198.51.100.7' })).code, 'bought', 'a buyer on another network has their own allowance');
  assert.ok(f.logs.length >= 0);
});

test('a buyer who has not worked cannot buy, and what is spent at stalls comes out of what may be given away', async (t) => {
  const { edit, trader, open, stock, buy, get } = await harness(t);
  const ada = await trader('Ada'), newcomer = await trader('Newcomer');
  await open(ada);
  await stock(ada, { jollof: 10 });
  await edit(newcomer, (state) => { state.social.earned = 0; });
  const refused = await buy(newcomer, ada.id);
  assert.deepEqual([refused.code, refused.state?.cash], ['earn_first', 100000]);
  await edit(newcomer, (state) => { state.social.earned = 1500; });
  assert.equal((await buy(newcomer, ada.id, 'jollof', 2)).code, 'bought');
  await edit(newcomer, (state) => { state.needs.hunger = 20; });
  assert.equal((await buy(newcomer, ada.id, 'jollof', 1)).code, 'spend_exceeds_earned', '₦1,200 of ₦1,500 is spent; ₦600 more is not there');
  const life = object((await get('/api/life?city=lagos', newcomer)).state) as unknown as LifeState;
  assert.deepEqual([life.business.spent, life.cash], [1200, 98800]);
});

test('an owner in another city still sees the shop, collects and pays rent; the shop keeps selling without them', async (t) => {
  const { f, post, get, trader, open, stock } = await harness(t);
  const ada = await trader('Ada');
  await open(ada);
  await stock(ada, { jollof: 14, 'local-plate': 10, 'puff-puff': 6 });
  const left = await f.action(ada.cookie, { type: 'estate.relocate', payload: { to: 'ibadan', mode: 'road' }, actionId: f.id() });
  assert.equal(left.ok, true, `${left.code}: ${left.state?.message}`);
  f.advance(6 * 3600000);
  // The first read after the trip files the character under the city it arrived in.
  await get('/api/life?city=lagos', ada);
  assert.equal(object((await get('/api/life?city=ibadan', ada)).state).location !== undefined, true);
  const away = object((await get('/api/business/mine?city=ibadan', ada)).mine);
  assert.deepEqual([away.cityName, away.here, away.status], ['Lagos', false, 'open']);
  assert.ok(Number(away.till) > 0, 'it sold while the owner was on the road');
  const collected = await post('/api/business/collect', { cityId: 'ibadan', requestId: f.id() }, ada);
  assert.deepEqual([collected.code, collected.amount, collected.state?.estate.city], ['collected', away.till, 'ibadan']);
  assert.equal((await post('/api/business/rent', { cityId: 'ibadan', requestId: f.id() }, ada)).code, 'rent_paid');
  assert.equal((await post('/api/business/stock', { cityId: 'ibadan', items: { jollof: 1 }, requestId: f.id() }, ada)).code, 'not_at_shop');
  assert.equal((await post('/api/business/collect', { cityId: 'lagos', requestId: f.id() }, ada)).status, 409, 'the caller names the city their character is in');
  // The market in Ibadan shows no Lagos stall, and says why this owner cannot open another.
  const bodija = await get('/api/business/venue?city=ibadan&venue=bodija-market', ada);
  assert.deepEqual([list(bodija.shops).length, bodija.openWhy, object(bodija.mine).name], [0, 'You already run a business. One per player for now.', 'Mama Put']);
});

test('trade goods: bought where they come from by the owner of the right stall, carried, and unpacked at the stall', async (t) => {
  const { f, post, edit, trader, open } = await harness(t);
  const ada = await trader('Ada');
  const bag = (body: object) => post('/api/business/bag', { cityId: 'lagos', venue: 'market', requestId: f.id(), ...body }, ada);
  assert.equal((await bag({ product: 'ankara', units: 2 })).code, 'no_shop_for_it');
  await open(ada, { type: 'fabric', icon: '🧵' });
  assert.equal((await bag({ product: 'adire', units: 2 })).code, 'not_sold_here', 'adire is Abeokuta’s');
  assert.equal((await bag({ product: 'ankara', units: 99 })).code, 'invalid_units');
  const packed = await bag({ product: 'ankara', units: 12 });
  assert.deepEqual([packed.code, packed.state?.cash, list(packed.bag)], ['bagged', 100000 - 25000 - 12 * 600, [{ id: 'ankara', label: 'Ankara wax print', icon: '🧵', n: 12 }]]);
  const unpacked = await post('/api/business/bag/stock', { cityId: 'lagos', requestId: f.id() }, ada);
  assert.deepEqual([unpacked.code, unpacked.units, object(unpacked.mine).units, list(unpacked.bag)[0]?.n], ['unpacked', 10, 10, 2], 'what fits goes on the shelf');
  assert.equal((await post('/api/business/bag/stock', { cityId: 'lagos', requestId: f.id() }, ada)).code, 'nothing_to_unpack');
  const back = await post('/api/business/bag/return', { cityId: 'lagos', requestId: f.id() }, ada);
  assert.deepEqual([back.code, back.amount, list(back.bag)], ['returned', 2 * 300, []]);
  await edit(ada, (state) => { state.location = 'home'; state.business.bag = { ankara: 1 }; });
  assert.equal((await post('/api/business/bag/return', { cityId: 'lagos', requestId: f.id() }, ada)).code, 'not_at_market');
});

test('reports and the operator: a name is removed, a stall is closed with its refund, and both are audited and told', async (t) => {
  const { f, post, get, trader, open, stock, database } = await harness(t, { moderatorToken: 'operator-token-for-tests-0123456789' });
  const operator = { Authorization: 'Bearer operator-token-for-tests-0123456789' };
  const ada = await trader('Ada'), bola = await trader('Bola');
  await open(ada);
  await stock(ada, { jollof: 10 });
  assert.equal((await post('/api/business/report', { cityId: 'lagos', shop: ada.id, reason: 'name' }, ada)).code, 'own_shop');
  assert.equal((await post('/api/business/report', { cityId: 'lagos', shop: ada.id, reason: 'because' }, bola)).code, 'invalid_report');
  for (let index = 0; index < 2; index++) assert.equal((await post('/api/business/report', { cityId: 'lagos', shop: ada.id, reason: 'name' }, bola)).code, 'reported');
  assert.equal((await get('/api/mod/business/reports')).status, 401);
  const reports = await get('/api/mod/business/reports', undefined, operator);
  assert.deepEqual(list(reports.reports).map((report) => [report.shop, report.name, report.by, report.reason, report.live]), [[ada.id, 'Mama Put', bola.id, 'name', true]], 'one report per reporter per stall');
  assert.equal((await post('/api/mod/business/rename', { shop: 'nobody' }, undefined, operator)).status, 404);
  const renamed = await post('/api/mod/business/rename', { shop: ada.id, reason: 'not a name' }, undefined, operator);
  assert.deepEqual([renamed.code, renamed.removed], ['renamed', 'Mama Put']);
  const plain = object((await get('/api/business/mine?city=lagos', ada)).mine);
  assert.match(String(plain.name), /^Food stall [0-9a-f]{4}$/);
  const closed = await post('/api/mod/business/close', { shop: ada.id }, undefined, operator);
  assert.deepEqual([closed.code, closed.owed], ['closed', 7500 + 900 + Number(plain.till)]);
  const mine = object((await get('/api/business/mine?city=lagos', ada)).mine);
  assert.deepEqual([mine.status, mine.till], ['closed', closed.owed]);
  const paid = await post('/api/business/collect', { cityId: 'lagos', requestId: f.id() }, ada);
  assert.deepEqual([paid.code, paid.amount, paid.mine], ['collected', closed.owed, null]);
  const told = list((await get('/api/social/me', ada)).updates).filter((update) => update.kind === 'business').map((update) => String(update.text));
  assert.ok(told.some((line) => line.includes('removed your stall’s name')) && told.some((line) => line.includes('A moderator closed')));
  const db = await database();
  assert.deepEqual((db.moderation?.audit ?? []).map((line) => line.action).filter((action) => action.startsWith('shop-')), ['shop-rename', 'shop-close']);
  assert.deepEqual(db.business, { v: 1, shops: {}, reports: [], seq: 1 });
});

test('what is stored: public ids and names only, one record per owner, and a poll writes nothing', async (t) => {
  const { f, get, trader, open, stock, buy, database } = await harness(t);
  const ada = await trader('Ada'), bola = await trader('Bola');
  await open(ada);
  await stock(ada, { jollof: 10 });
  await buy(bola, ada.id);
  const stored = JSON.stringify((await database()).business);
  for (const device of [ada, bola]) assert.ok(!stored.includes(device.cookie.slice(4)), 'the collection never holds a session secret');
  assert.ok(!stored.includes('127.0.0.1'));
  assert.deepEqual(Object.keys(object((await database()).business?.shops)), [ada.id]);
  // Hours pass and both players look, again and again: the stored record does not move.
  for (let index = 0; index < 5; index++) {
    f.advance(1800000);
    await get('/api/business/venue?city=lagos&venue=market', bola);
    await get('/api/business/mine?city=lagos', ada);
  }
  assert.equal(JSON.stringify((await database()).business), stored);
  assert.ok(Number(object((await get('/api/business/mine?city=lagos', ada)).mine).till) > 600, 'though the shop the players see has been selling');
});
