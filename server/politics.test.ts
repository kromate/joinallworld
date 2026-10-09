// OWNER: politics — the routes on the Node host: levies on a real stall purchase, decrees, salaries, a state candidacy and parties.
// The pure rules are in server/politics/rules.test.ts. Design: docs/POLITICS.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCityContent } from '../src/game/cities/registry.ts';
import { PARTY, QUORUM, SEATS } from '../src/game/content/politics.ts';
import type { GovResponse } from '../src/types/civic.ts';
import type { LifeState } from '../src/types/life.ts';
import { DAY, harness, object } from './testing/politicsHarness.ts';
import { JOURNEY_TIME } from './testing/cityJourney.ts';

await Promise.all(['lagos', 'ibadan'].map(loadCityContent));

const list = (value: unknown): Record<string, unknown>[] => { assert.ok(Array.isArray(value)); return value.map(object); };

test('levies set by a mayor, a governor and a president are added to a stall purchase and paid into their treasuries', { timeout: 60000 }, async (t) => {
  const { f, post, get, player, elect, overview } = await harness(t);
  const owner = await player('Owner'), buyer = await player('Buyer'), mayor = await player('Mayor'), governor = await player('Governor'), president = await player('President'), weaver = await player('Weaver');
  assert.equal((await post('/api/business/open', { cityId: 'lagos', venue: 'market', type: 'food', name: 'Mama Put', colour: 'gold', icon: '🍲', requestId: f.id() }, owner)).code, 'opened');
  assert.equal((await post('/api/business/stock', { cityId: 'lagos', items: { jollof: 10 }, requestId: f.id() }, owner)).code, 'stocked');
  assert.equal((await post('/api/business/price', { cityId: 'lagos', prices: { jollof: 701 } }, owner)).code, 'priced');
  const untaxedMarket = await get('/api/business/venue?city=lagos&venue=market', buyer);
  const untaxedShops = Array.isArray(untaxedMarket.shops) ? untaxedMarket.shops.map(object) : [];
  const untaxedStall = untaxedShops.find((entry) => object(entry.owner).id === owner.id);
  assert.ok(untaxedStall);
  const untaxedJollof = list(untaxedStall.items).find((entry) => entry.id === 'jollof');
  assert.ok(untaxedJollof);
  const untaxedQuote = list(untaxedJollof.quotes).find((entry) => entry.units === 1);
  assert.ok(untaxedQuote);
  assert.deepEqual([untaxedQuote.total, untaxedQuote.tax], [701, 0]);
  await get('/api/civic/pulse?city=lagos', mayor); // a city's civic record exists once someone has been through it
  await post('/api/civic/pulse', {}, mayor);
  await elect(mayor, 'city:lagos', QUORUM.city); await elect(governor, 'state:lagos', QUORUM.state); await elect(president, 'nation:ng', QUORUM.nation);

  // Nobody else can decree; the officeholders can, each only for their own office and inside the range.
  assert.equal((await post('/api/politics/decree', { cityId: 'lagos', tier: 'city', lever: 'marketLevy', value: 5 }, buyer)).code, 'not_in_office');
  assert.equal((await post('/api/politics/decree', { cityId: 'lagos', tier: 'city', lever: 'marketLevy', value: 11 }, mayor)).code, 'out_of_range');
  assert.equal((await post('/api/politics/decree', { cityId: 'lagos', tier: 'city', lever: 'vat', value: 5 }, mayor)).code, 'unknown_lever');
  assert.equal((await post('/api/politics/decree', { cityId: 'lagos', tier: 'city', lever: 'marketLevy', value: 10 }, mayor)).code, 'decreed');
  assert.equal((await post('/api/politics/decree', { cityId: 'lagos', tier: 'state', lever: 'salesTax', value: 5 }, governor)).code, 'decreed');
  assert.equal((await post('/api/politics/decree', { cityId: 'lagos', tier: 'nation', lever: 'vat', value: 15 }, president)).code, 'decreed');
  assert.equal((await post('/api/politics/decree', { cityId: 'lagos', tier: 'nation', lever: 'tradeDuty', value: 25 }, president)).code, 'decreed');
  const seen = await overview(buyer);
  assert.deepEqual(seen.seats.map((seat) => [seat.tier, seat.levers.map((lever) => [lever.id, lever.value])]), [['city', [['marketLevy', 10], ['citySentence', 10], ['cityBail', 0]]], ['state', [['salesTax', 5], ['stateSentence', 15], ['stateBail', 0]]], ['nation', [['vat', 15], ['nationSentence', 20], ['nationBail', 0], ['tradeDuty', 25]]]]);
  assert.deepEqual(seen.seats.map((seat) => seat.you?.isOfficeholder), [false, false, false]);
  assert.deepEqual((await overview(mayor)).seats.map((seat) => seat.you?.isOfficeholder), [true, false, false]);

  // A purchase pays the price to the stall and each office's levy, rounded down, to its treasury.
  const before = (await get('/api/life?city=lagos', buyer)).state?.cash ?? 0;
  const market = await get('/api/business/venue?city=lagos&venue=market', buyer);
  const stalls = Array.isArray(market.shops) ? market.shops.map(object) : [];
  const stall = stalls.find((entry) => object(entry.owner).id === owner.id);
  assert.ok(stall);
  const item = list(stall.items).find((entry) => entry.id === 'jollof');
  assert.ok(item);
  const quotes = list(item.quotes);
  const quote = quotes.find((entry) => entry.units === 1);
  assert.ok(quote);
  const currentTax = (units: number) => Math.floor(701 * units * 10 / 100) + Math.floor(701 * units * 5 / 100) + Math.floor(701 * units * 15 / 100);
  assert.deepEqual(quotes.map((entry) => [entry.units, entry.total, entry.tax]), [1, 2, 3].map((units) => [units, 701 * units + currentTax(units), currentTax(units)]), 'each quantity quote rounds the three levies against the combined base amount');
  const buyerCashBeforeStale = before;
  const ownerTillBeforeStale = Number(object((await get('/api/business/mine?city=lagos', owner)).mine).till);
  const staleTax = await post('/api/business/buy', { cityId: 'lagos', shop: owner.id, product: 'jollof', units: 1, expectedPrice: 701, expectedTotal: Number(untaxedQuote.total), requestId: f.id() }, buyer);
  assert.equal(staleTax.code, 'quote_changed', 'a quote is rejected when tax changes even though the menu price stays the same');
  assert.equal((await get('/api/life?city=lagos', buyer)).state?.cash, buyerCashBeforeStale);
  assert.equal(Number(object((await get('/api/business/mine?city=lagos', owner)).mine).till), ownerTillBeforeStale);
  const bought = await post('/api/business/buy', { cityId: 'lagos', shop: owner.id, product: 'jollof', units: 1, expectedPrice: Number(item.price), expectedTotal: Number(quote.total), requestId: f.id() }, buyer);
  assert.equal(bought.code, 'bought');
  const price = bought.amount ?? 0, city = Math.floor(price * 10 / 100), state = Math.floor(price * 5 / 100), nation = Math.floor(price * 15 / 100);
  assert.ok(price > 0 && city > 0 && state > 0 && nation > 0);
  assert.equal(before - (bought.state?.cash ?? 0), price + city + state + nation, 'the buyer pays the price and the three levies');
  assert.ok(bought.state?.ledger.some((line) => line.reason === 'Tax on purchase at Mama Put' && line.amount === -(city + state + nation)));
  const after = await overview(buyer);
  assert.deepEqual(after.seats.map((seat) => seat.treasury.balance), [city, state, nation]);
  assert.equal(after.seats[0]?.treasury.ledger[0]?.kind, 'levy');

  // Trade duty: goods bought for the road cost the duty on top, which goes to the federal treasury.
  assert.equal((await post('/api/business/open', { cityId: 'lagos', venue: 'market', type: 'fabric', name: 'Weave', colour: 'gold', icon: '🧵', requestId: f.id() }, weaver)).code, 'opened');
  const cash = (await get('/api/life?city=lagos', weaver)).state?.cash ?? 0;
  const bagged = await post('/api/business/bag', { cityId: 'lagos', venue: 'market', product: 'ankara', units: 2, requestId: f.id() }, weaver);
  assert.equal(bagged.code, 'bagged');
  const spent = cash - (bagged.state?.cash ?? 0), duty = Math.floor(spent / 1.25 * 25 / 100);
  assert.ok(spent > 0 && Math.abs(spent - Math.round(spent / 1.25) - duty) <= 1, `the cost carries a 25% duty (spent ${spent})`);
  assert.equal((await overview(buyer)).seats[2]?.treasury.balance, nation + spent - Math.round(spent / 1.25));

  // A salary is a fifth of the treasury, drawn once per term, paid into the wallet.
  const mayorCash = (await get('/api/life?city=lagos', mayor)).state?.cash ?? 0;
  const drew = await post('/api/politics/salary', { cityId: 'lagos', tier: 'city', requestId: f.id() }, mayor);
  assert.equal(drew.code, 'paid');
  assert.equal((drew.state?.cash ?? 0) - mayorCash, Math.floor(city * 0.2));
  assert.equal((await post('/api/politics/salary', { cityId: 'lagos', tier: 'city', requestId: f.id() }, mayor)).code, 'already_drawn');
  assert.equal((await post('/api/politics/salary', { cityId: 'lagos', tier: 'city', requestId: f.id() }, buyer)).code, 'not_in_office');

  // The decrees lapse with the term: a week later every lever is back at its base.
  f.advance(7 * DAY);
  assert.ok((await overview(buyer)).seats.every((seat) => seat.levers.every((lever) => lever.value === lever.base)));
});

test('a seat above the city: the filing fee is the seat’s own, goes to its treasury, and the candidate stands under their party', { timeout: 60000 }, async (t) => {
  const { f, post, get, player, overview, stored } = await harness(t);
  const ada = await player('Ada'), bola = await player('Bola');
  const refused = await post('/api/politics/party/found', { cityId: 'lagos', name: 'ab', motto: 'Plant more', colour: 'green', requestId: f.id() }, ada);
  assert.equal(refused.code, 'text_too_short');
  assert.equal((await post('/api/politics/party/found', { cityId: 'lagos', name: 'Green Hands', motto: 'Plant more', colour: 'pink-elephant', requestId: f.id() }, ada)).code, 'invalid_colour');
  const cash = (await get('/api/life?city=lagos', ada)).state?.cash ?? 0;
  const founded = await post('/api/politics/party/found', { cityId: 'lagos', name: 'Green Hands', motto: 'Plant more', colour: 'green', requestId: f.id() }, ada);
  assert.equal(founded.code, 'founded');
  assert.equal(cash - (founded.state?.cash ?? 0), PARTY.fee);
  assert.equal((await post('/api/politics/party/found', { cityId: 'lagos', name: 'green hands', motto: 'Same again', colour: 'red', requestId: f.id() }, bola)).code, 'name_taken');
  assert.equal((await post('/api/politics/party/found', { cityId: 'lagos', name: 'Second try', motto: 'Not again', colour: 'red', requestId: f.id() }, ada)).code, 'founder_limit');
  const party = (await overview(bola)).parties[0];
  assert.deepEqual([party?.name, party?.members, party?.mine], ['Green Hands', 1, false]);
  assert.equal((await post('/api/politics/party/join', { cityId: 'lagos', party: party?.id }, bola)).code, 'joined');
  assert.equal((await post('/api/politics/party/join', { cityId: 'lagos', party: party?.id }, bola)).code, 'already_member');

  // Nominations are open (Monday). The state seat costs its own fee and the money goes to the state treasury.
  const run = await post('/api/civic/gov/run', { cityId: 'lagos', tier: 'state', slogan: 'A greener state', requestId: f.id() }, bola);
  assert.equal(run.code, 'declared');
  assert.equal(100000 - (run.state as LifeState).cash, SEATS.state.fee);
  const ballot = await get('/api/civic/gov?city=lagos&tier=state', bola) as unknown as GovResponse;
  assert.deepEqual(ballot.election.candidates.map((item) => [item.name, item.slogan]), [['Bola', 'A greener state']]);
  assert.equal((await get('/api/civic/gov?city=lagos', bola) as unknown as GovResponse).election.candidates.length, 0, 'the city ballot is its own');
  const seat = (await overview(bola)).seats[1];
  assert.deepEqual([seat?.treasury.balance, seat?.parties[bola.id] === party?.id, seat?.quorum, seat?.fee], [SEATS.state.fee, true, QUORUM.state, SEATS.state.fee]);
  assert.equal((await post('/api/civic/gov/run', { cityId: 'lagos', tier: 'president', slogan: 'x', requestId: f.id() }, bola)).error, 'invalid_tier');
  // The state candidacy did not touch the city ballot, and a leaver stands as an independent next time.
  assert.equal((await post('/api/politics/party/leave', { cityId: 'lagos' }, bola)).code, 'left');
  assert.equal((await post('/api/politics/party/leave', { cityId: 'lagos' }, bola)).code, 'no_party');
  const db = await stored();
  assert.deepEqual(Object.keys(db.politics?.scopes ?? {}), ['state:lagos']);
  assert.ok(!JSON.stringify(db.politics).includes(ada.cookie.slice(4)), 'the record never holds a session secret');
});

test('an election with too few votes is void: the seat stays empty and nothing can be decreed', { timeout: 60000 }, async (t) => {
  const { f, post, player, elect, overview } = await harness(t);
  const lone = await player('Lone');
  await elect(lone, 'nation:ng', QUORUM.nation - 1);
  assert.equal((await post('/api/politics/decree', { cityId: 'lagos', tier: 'nation', lever: 'vat', value: 15 }, lone)).code, 'not_in_office');
  assert.equal((await post('/api/politics/salary', { cityId: 'lagos', tier: 'nation', requestId: f.id() }, lone)).code, 'not_in_office');
  assert.equal((await overview(lone)).seats[2]?.you?.isOfficeholder, false);
  await elect(lone, 'nation:ng', QUORUM.nation);
  assert.equal((await overview(lone)).seats[2]?.you?.isOfficeholder, true);
});
