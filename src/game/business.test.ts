import { loadCityContent as preloadCityContent, playableCityIds } from './cities/registry.ts';
await Promise.all(playableCityIds().map(preloadCityContent));
// OWNER: business — the shop rules (business-model.ts), the catalogue (content/business.ts) and the life's side
// (systems/business.ts). The design is docs/BUSINESS.md. Server behaviour is in server/business.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLife, dispatch, viewLife } from '../life.ts';
import { makeContext } from './util.ts';
import { lagosDayStart, lagosTime } from './clock.ts';
import { cityContent, isOpenCityId } from './cities/registry.ts';
import { BUSINESS, BUSINESS_PRODUCTS, BUSINESS_TYPES, BUSINESS_TYPE_IDS, BUSINESS_UPGRADES, BUSINESS_VENUES, LOCAL_PLATES } from './content/business.ts';
import { BAG_LIMIT, BUSINESS_BUYING, SALES_COUNTED_PER_COLLECT } from './content/business-limits.ts';
import { TRANSFER_LIMITS } from './content/npcs.ts';
import { AD_COLOURS } from './content/civic.ts';
import {
  businessVenue, businessVenues, capacityOf, closeValue, closesAt, customersOf, dayCeiling, demandAt, isLocal, newShop, priceBand, priceBlock, productCost, productLabel, productOf,
  rateShop, rentOf, saleBlock, sellToPlayer, settleShop, shopAt, spoilOf, starsOf, stockBlock, stockCost, stockUnits, stockValue, tradeGoods, typeOf, upgradeBlock, windUp,
} from './business-model.ts';
import { allowance, buyBlock } from './systems/business.ts';
import type { ActionBody, ActionResult, ActionType } from '../types/actions.ts';
import type { BusinessTypeId, BusinessUpgradeId, BusinessVenue, ShopRecord } from '../types/business.ts';
import type { LifeContext, LifeContextInit, LifeState } from '../types/life.ts';

const HOUR = 3600000, DAY = 86400000;
/** Monday 5 January 2026, 00:00 Lagos time. */
const MIDNIGHT = lagosDayStart(lagosTime(Date.UTC(2026, 0, 5, 9)).day);
const at = (day: number, hour: number): number => MIDNIGHT + day * DAY + hour * HOUR;
function need<T>(value: T | null | undefined, what = 'expected a value'): T { assert.ok(value, what); return value; }
const LAGOS = need(businessVenue('lagos', 'market'));
/** A market with no bonus of any kind, open 07:00–20:00. */
const PLAIN: BusinessVenue = { city: 'ota', venue: 'sango-market', name: 'A market', known: [], footfall: 1, stalls: 12, hours: BUSINESS.hours };

function shop(type: BusinessTypeId = 'food', { now = at(0, 0), city = PLAIN.city, upgrades = [] as BusinessUpgradeId[], full = true } = {}): ShopRecord {
  const made = newShop({ by: { id: 'owner', name: 'Ada' }, city, venue: 'market', type, name: 'Mama Put', colour: 'green', icon: typeOf(type).icon }, now);
  made.upgrades = upgrades;
  if (full) fill(made);
  return made;
}
/** Fill the shelves in proportion to the shares. */
function fill(made: ShopRecord): void {
  const type = typeOf(made.type), capacity = capacityOf(made);
  let room = capacity - stockUnits(made);
  for (const item of type.products) { const units = Math.min(room, Math.max(0, Math.round(capacity * item.share) - (made.stock[item.id] ?? 0))); made.stock[item.id] = (made.stock[item.id] ?? 0) + units; room -= units; }
}
/** What the stock that left the shelves was sold for, at the shop's prices. */
const worth = (before: ShopRecord, after: ShopRecord): number => typeOf(before.type).products.reduce((sum, item) => sum + ((before.stock[item.id] ?? 0) - (after.stock[item.id] ?? 0)) * (before.prices[item.id] ?? 0), 0);
const copy = (made: ShopRecord): ShopRecord => JSON.parse(JSON.stringify(made)) as ShopRecord;

// ---- the catalogue ---------------------------------------------------------------------------------

test('catalogue: every type has a short menu whose shares add up, every hour of the day, and prices that leave room above cost', () => {
  assert.ok(BUSINESS_TYPE_IDS.length >= 4 && BUSINESS_TYPE_IDS.length <= 6);
  for (const id of BUSINESS_TYPE_IDS) {
    const type = BUSINESS_TYPES[id];
    assert.equal(type.id, id);
    assert.ok(type.products.length >= 2 && type.products.length <= 4, `${id}: 2 to 4 products`);
    assert.ok(Math.abs(type.products.reduce((sum, item) => sum + item.share, 0) - 1) < 1e-9, `${id}: shares add up to 1`);
    assert.equal(type.hours.length, 24);
    assert.ok(type.icons.includes(type.icon) && type.setup > 0 && type.rent > 0 && type.customers > 0 && type.capacity > 0);
    for (const item of type.products) {
      const band = priceBand(item);
      assert.equal(BUSINESS_PRODUCTS.get(item.id)?.type, id, `${item.id} is one type's product`);
      assert.ok(item.base % 10 === 0 && band.min < item.base && item.base < band.max);
      // The lowest price an owner may ask is above the highest price a unit costs, and a buyback pays less than the lowest cost.
      assert.ok(productCost(item, 'nowhere') < band.min, `${item.id}: the dearest cost is below the lowest price`);
      assert.ok(Math.round(item.base * BUSINESS.originRate) * BUSINESS.buyback < Math.round(item.base * BUSINESS.originRate), `${item.id}: a buyback pays less than any cost`);
      assert.ok(item.effects || item.mood, `${item.id} does something for a buyer`);
      for (const amount of Object.values(item.effects ?? {})) assert.ok(Math.abs(amount ?? 0) <= BUSINESS_BUYING.maxEffect);
      // A player's purchase of the dearest price fits the per-shop allowance.
      assert.ok(band.max <= BUSINESS.pairPerDay, `${item.id} can be bought at its top price`);
      for (const city of item.origin ?? []) assert.ok(isOpenCityId(city), `${item.id} comes from an open city`);
    }
  }
  assert.equal(new Set([...BUSINESS_PRODUCTS.keys()]).size, BUSINESS_TYPE_IDS.reduce((sum, id) => sum + BUSINESS_TYPES[id].products.length, 0), 'product ids are unique across types');
  assert.deepEqual(BUSINESS_UPGRADES.map((upgrade) => upgrade.id), ['front', 'display', 'storage']);
});

test('every open city rents stalls at a market, and every market the table names is one', () => {
  for (const city of playableCityIds()) {
    const markets = businessVenues(city);
    assert.ok(markets.length >= 1, `${city} has a market with stalls`);
    for (const market of markets) {
      assert.ok(market.stalls >= 1 && market.footfall > 0.5 && market.footfall < 1.5 && market.hours.close > market.hours.open);
      assert.equal(cityContent(city).venues.find((venue) => venue.id === market.venue)?.kind, 'market');
    }
    assert.ok(LOCAL_PLATES[city], `${city} has a plate of its own`);
  }
  for (const key of Object.keys(BUSINESS_VENUES)) { const [city, venue] = key.split(':'); assert.ok(businessVenue(city, venue), `${key} is a market of an open city`); }
  assert.equal(businessVenue('lagos', 'park'), null, 'a park rents no stalls');
  assert.equal(businessVenue('lagos', 'nowhere'), null);
  assert.equal(businessVenue('atlantis', 'market'), null);
  assert.deepEqual(LAGOS.hours, { open: 6, close: 20 }, 'a market with hours of its own trades in them');
  assert.deepEqual(need(businessVenue('ibadan', 'bodija-market')).hours, BUSINESS.hours);
});

test('city differences: a product is cheaper where it comes from, the plate of the day has the city’s name, and a market draws more to what it is known for', () => {
  const adire = need(BUSINESS_PRODUCTS.get('adire'));
  assert.equal(productCost(adire, 'lagos'), 1440);
  assert.equal(productCost(adire, 'abeokuta'), 720);
  assert.equal(isLocal(adire, 'abeokuta'), true);
  assert.deepEqual(tradeGoods().map((item) => item.id).sort(), ['adire', 'ankara', 'aso-oke', 'cap', 'clay-pot', 'indigo', 'leather-sandals', 'smoked-fish']);
  const plate = need(productOf('food', 'local-plate'));
  assert.equal(productLabel(plate, 'port-harcourt'), 'Bole & fish');
  assert.equal(productLabel(plate, 'ibadan'), 'Amala, gbegiri & ewedu');
  assert.equal(productLabel(plate, 'atlantis'), 'Plate of the day');
  const fabric = shop('fabric');
  assert.equal(customersOf(fabric, PLAIN), 5);
  assert.ok(Math.abs(customersOf(fabric, need(businessVenue('abeokuta', 'itoku-market'))) - 5 * BUSINESS.knownBonus) < 1e-9, 'Itoku is known for cloth');
  assert.ok(Math.abs(customersOf(shop('food'), LAGOS) - 30 * 1.15) < 1e-9, 'the Lagos market is busier, and is not known for food');
});

// ---- price and demand ------------------------------------------------------------------------------

test('demand falls as the price rises, and a price must be inside the band', () => {
  assert.deepEqual([0.5, 0.7, 1, 1.2, 1.4, 2].map((ratio) => Math.round(demandAt(ratio) * 100) / 100), [1.25, 1.25, 1, 0.7, 0.3, 0]);
  for (let ratio = 0.7; ratio < 1.4; ratio += 0.05) assert.ok(demandAt(ratio) >= demandAt(ratio + 0.05));
  const made = shop();
  assert.deepEqual(priceBand(need(productOf('food', 'jollof'))), { min: 420, max: 840 });
  assert.equal(priceBlock(made, 'jollof', 420), null);
  assert.equal(priceBlock(made, 'jollof', 840), null);
  for (const price of [419, 841, 600.5, -1, '600', null, NaN, Infinity]) assert.equal(priceBlock(made, 'jollof', price)?.code, 'price_outside_band', String(price));
  assert.equal(priceBlock(made, 'adire', 2400)?.code, 'unknown_product', 'another type’s product');
});

test('a stocked stall at base prices sells about a day’s customers in a trading day, only in trading hours, and every naira in the box is a unit off the shelf', () => {
  const made = shop('provisions'), before = copy(made);
  assert.deepEqual(settleShop(made, at(0, 7), PLAIN), [], 'nothing happens before the market opens');
  assert.equal(made.till, 0);
  settleShop(made, at(0, 13), PLAIN);
  const midday = made.served;
  assert.ok(midday > 10 && midday < 20, `about half by early afternoon (${midday})`);
  settleShop(made, at(0, 20), PLAIN);
  assert.ok(made.served >= 33 && made.served <= 36, `36 customers came, ${made.served} bought`);
  assert.equal(made.till, worth(before, made));
  assert.equal(made.total.takings, made.till);
  const closed = made.served;
  settleShop(made, at(0, 23.9), PLAIN);
  assert.equal(made.served, closed, 'nobody buys after closing time');
  assert.ok(stockUnits(made) >= 0 && Object.values(made.stock).every((units) => Number.isSafeInteger(units) && units >= 0));
});

test('reading often and reading rarely sell the same: the record is a function of time', () => {
  const once = shop('provisions'), often = shop('provisions');
  settleShop(once, at(2, 15.5), PLAIN);
  for (let t = at(0, 0); t < at(2, 15.5); t += 7 * 60000) settleShop(often, t, PLAIN);
  settleShop(often, at(2, 15.5), PLAIN);
  assert.ok(Math.abs(once.total.sold - often.total.sold) <= 2, `${once.total.sold} against ${often.total.sold}`);
  assert.equal(once.rep, often.rep);
  // A read is a copy: the stored record does not move.
  const stored = shop('food'), same = copy(stored);
  const seen = shopAt(stored, at(0, 18), PLAIN);
  assert.deepEqual(stored, same);
  assert.ok(seen.till > 0 && seen.at === at(0, 18));
  assert.deepEqual(settleShop(seen, at(0, 18), PLAIN), [], 'settling to the same time again changes nothing');
});

test('a narrow range still serves a little over half the customers, and an empty stall sells nothing', () => {
  const narrow = shop('provisions', { full: false });
  narrow.stock.zobo = 40;
  settleShop(narrow, at(0, 20), PLAIN);
  const expected = 36 * (BUSINESS.rangeFloor + (1 - BUSINESS.rangeFloor) * 0.35);
  assert.ok(Math.abs(narrow.served - expected) <= 1.5, `${narrow.served} of about ${expected.toFixed(1)}`);
  const empty = shop('provisions', { full: false });
  settleShop(empty, at(0, 20), PLAIN);
  assert.deepEqual([empty.served, empty.till, Math.round(empty.came)], [0, 0, 36]);
});

test('the dearest price sells to three in ten and the cheapest to a quarter more, never past the day’s ceiling', () => {
  const dear = shop('provisions'), cheap = shop('provisions', { upgrades: ['storage'] });
  for (const item of typeOf('provisions').products) { dear.prices[item.id] = priceBand(item).max; cheap.prices[item.id] = priceBand(item).min; }
  fill(cheap);
  settleShop(dear, at(0, 20), PLAIN); settleShop(cheap, at(0, 20), PLAIN);
  assert.ok(dear.served >= 9 && dear.served <= 12, `at the top of the band ${dear.served} of 36 bought`);
  assert.ok(cheap.served >= 42 && cheap.served <= 46, `at the bottom ${cheap.served} bought`);
  // The best case there is: five stars, a busy market known for the type, the cheapest prices, shelves that never empty.
  const best = shop('fabric', { city: 'lagos', upgrades: ['front', 'display', 'storage'] });
  best.rep = 100;
  for (const item of typeOf('fabric').products) { best.prices[item.id] = priceBand(item).min; best.stock[item.id] = 1000; }
  const busy: BusinessVenue = { ...LAGOS, footfall: 1.4, known: ['fabric'] };
  settleShop(best, at(0, 23), busy);
  assert.ok(best.npc <= dayCeiling(best), `${best.npc} sold against a ceiling of ${dayCeiling(best)}`);
  assert.equal(best.npc, dayCeiling(best), 'and the ceiling is what stopped it');
});

test('passers-by stop buying when the cash box is full, and start again once it is emptied', () => {
  const made = shop('fabric');
  for (const item of typeOf('fabric').products) made.stock[item.id] = 500;
  made.paidUntil = at(400, 0);
  settleShop(made, at(60, 0), PLAIN);
  const dearest = Math.max(...Object.values(made.prices));
  assert.ok(made.till >= BUSINESS.tillCap && made.till < BUSINESS.tillCap + dearest, `the box holds ${made.till}`);
  const held = made.total.sold;
  settleShop(made, at(70, 0), PLAIN);
  assert.equal(made.total.sold, held);
  made.till = 0;
  settleShop(made, at(71, 0), PLAIN);
  assert.ok(made.total.sold > held);
});

// ---- reputation, spoilage, upgrades ----------------------------------------------------------------

test('reputation: a day that served its customers gains, an empty or overpriced day loses, and stars scale the customers', () => {
  assert.deepEqual([0, 50, 100, 250, -9].map(starsOf), [1, 3, 5, 5, 1]);
  const good = shop('provisions');
  settleShop(good, at(1, 1), PLAIN);
  assert.equal(good.rep, BUSINESS.rep.start + BUSINESS.rep.up);
  const empty = shop('provisions', { full: false });
  settleShop(empty, at(1, 1), PLAIN);
  assert.equal(empty.rep, BUSINESS.rep.start - BUSINESS.rep.empty);
  const dear = shop('provisions');
  for (const item of typeOf('provisions').products) dear.prices[item.id] = priceBand(item).max;
  settleShop(dear, at(1, 1), PLAIN);
  assert.equal(dear.rep, BUSINESS.rep.start - BUSINESS.rep.down, 'three in ten served is a poor day');
  // Reputation stays inside 0–100 however long a stall is neglected or kept well.
  const neglected = shop('provisions', { full: false });
  neglected.paidUntil = at(400, 0);
  settleShop(neglected, at(40, 0), PLAIN);
  assert.equal(neglected.rep, 0);
  assert.equal(customersOf({ type: 'food', upgrades: [], rep: 0 }, PLAIN), 30 * BUSINESS.rep.low);
  assert.equal(customersOf({ type: 'food', upgrades: [], rep: 100 }, PLAIN), 30 * BUSINESS.rep.high);
  assert.equal(customersOf({ type: 'food', upgrades: [], rep: 50 }, PLAIN), 30);
});

test('food left at midnight spoils, less with the cooler, and other goods keep', () => {
  const food = shop('food', { full: false }), cooled = shop('food', { full: false, upgrades: ['storage'] }), soap = shop('provisions', { full: false });
  food.stock.jollof = 10; cooled.stock.jollof = 10; soap.stock.soap = 10;
  // Night only: nothing is sold, so what is missing in the morning spoiled.
  for (const made of [food, cooled, soap]) { made.at = at(0, 21); made.day = lagosTime(at(0, 21)).day; settleShop(made, at(1, 5), PLAIN); }
  assert.deepEqual([food.stock.jollof, cooled.stock.jollof, soap.stock.soap], [7, 9, 10]);
  assert.deepEqual([spoilOf(food), spoilOf(cooled), spoilOf(soap)], [0.3, 0.1, 0]);
});

test('upgrades: each once, with the capacity, customers and rent they say', () => {
  const plain = shop('food', { full: false }), big = shop('food', { full: false, upgrades: ['front', 'display', 'storage'] });
  assert.deepEqual([capacityOf(plain), rentOf(plain), customersOf(plain, PLAIN)], [30, 7000, 30]);
  assert.deepEqual([capacityOf(big), rentOf(big)], [68, 10500]);
  assert.ok(Math.abs(customersOf(big, PLAIN) - 30 * 1.3 * 1.1) < 1e-9);
  assert.equal(upgradeBlock(plain, 'front'), null);
  assert.equal(upgradeBlock(big, 'front')?.code, 'already_upgraded');
  assert.equal(upgradeBlock(plain, 'helicopter')?.code, 'unknown_upgrade');
});

// ---- stock ------------------------------------------------------------------------------------------

test('stock: the supplier’s bill, the stall’s capacity, and no way to make money by closing', () => {
  const made = shop('food', { full: false });
  assert.equal(stockCost(made, { jollof: 10, 'puff-puff': 5 }), 10 * 360 + 5 * 120);
  assert.equal(stockBlock(made, { jollof: 30 }), null);
  assert.equal(stockBlock(made, { jollof: 31 })?.code, 'no_room');
  assert.equal(stockBlock(made, {})?.code, 'nothing_chosen');
  for (const units of [0, -3, 1.5, NaN, Infinity]) assert.equal(stockBlock(made, { jollof: units })?.code, 'invalid_units', String(units));
  assert.equal(stockBlock(made, { adire: 1 })?.code, 'unknown_product');
  // Open, stock at the cheapest price there is, close: less comes back than was paid.
  for (const type of BUSINESS_TYPE_IDS) {
    const fresh = shop(type, { full: false });
    let paid = typeOf(type).setup;
    for (const item of typeOf(type).products) { const units = Math.floor(capacityOf(fresh) / typeOf(type).products.length); fresh.stock[item.id] = units; paid += units * Math.round(item.base * BUSINESS.originRate / 10) * 10; }
    assert.ok(closeValue(fresh) < paid, `${type}: closing returns ${closeValue(fresh)} of ${paid}`);
    assert.equal(closeValue(fresh), Math.floor(typeOf(type).setup * BUSINESS.closeRefund) + Math.floor(stockValue(fresh) * BUSINESS.buyback));
  }
});

// ---- rent -------------------------------------------------------------------------------------------

test('rent: taken from the cash box when it falls due, and the next period starts where the last one ended', () => {
  const made = shop('provisions');
  assert.equal(made.paidUntil, at(7, 0));
  made.till = 20000;
  const events = settleShop(made, at(7, 0.5), PLAIN);
  assert.deepEqual(events, [{ kind: 'rent', amount: 6000, at: at(7, 0) }]);
  assert.deepEqual([made.paidUntil, made.owed, made.total.rent, made.status], [at(14, 0), 0, 6000, 'open']);
  assert.equal(closesAt(made), null);
});

test('rent: a box that cannot cover it leaves the rent overdue; the stall trades on and the rent is taken the moment takings reach it', () => {
  const made = shop('provisions', { full: false });
  settleShop(made, at(6, 23), PLAIN);
  made.stock.bread = 40; // restocked the night before the rent falls due, with an empty box
  const due = settleShop(made, at(7, 6), PLAIN);
  assert.deepEqual(due, [{ kind: 'due', amount: 6000, at: at(7, 0) }]);
  assert.deepEqual([made.owed, made.status, closesAt(made)], [6000, 'open', at(10, 0)]);
  const sold = made.total.sold;
  const later = settleShop(made, at(8, 20), PLAIN);
  assert.ok(made.total.sold > sold, 'it kept trading');
  assert.equal(later.length, 1);
  assert.equal(later[0]?.kind, 'rent');
  assert.deepEqual([made.owed, made.paidUntil, made.total.rent], [0, at(14, 0), 6000]);
  assert.equal(made.total.takings, made.till + made.total.rent, 'what was taken in is in the box or went to rent');
});

test('rent: still overdue after the grace, the market winds the stall up — stock bought back, rent taken, the rest waits for the owner', () => {
  const made = shop('provisions', { full: false });
  made.stock.soap = 10; made.prices.soap = 420; // little that sells, at the dearest price
  const events = settleShop(made, at(30, 0), PLAIN);
  assert.deepEqual(events.map((event) => event.kind), ['due', 'closed']);
  assert.equal(made.status, 'closed');
  assert.equal(made.closedAt, at(7 + BUSINESS.graceDays, 0));
  assert.equal(stockUnits(made), 0);
  assert.ok(made.till >= 0 && made.till < 6000, `what is left after rent: ${made.till}`);
  const claim = made.till;
  assert.deepEqual(settleShop(made, at(60, 0), PLAIN), [], 'a closed stall never trades again');
  assert.equal(made.till, claim);
  assert.equal(saleBlock(made, 'buyer', 'soap', 1)?.code, 'shop_closed');
  // An abandoned stall owes more than its goods fetch: nothing goes below zero.
  const bare = shop('food', { full: false });
  settleShop(bare, at(30, 0), PLAIN);
  assert.deepEqual([bare.status, bare.till, bare.owed], ['closed', 0, 0]);
  // Wound up by a moderator, the owner is also owed the refund.
  const moderated = shop('food', { full: false });
  moderated.till = 1000;
  assert.equal(windUp(moderated, at(1, 0), 7500), 8500);
});

test('rent paid weeks ahead keeps a stall its owner left open until the weeks run out, and no longer', () => {
  const made = shop('provisions');
  made.paidUntil = at(28, 0);
  settleShop(made, at(27, 23), PLAIN);
  assert.equal(made.status, 'open');
  assert.ok(stockUnits(made) === 0 && made.rep === 0, 'sold out long ago, its stars gone');
  // The takings of the first days are still in the box and pay the rent once more.
  assert.equal(settleShop(made, at(28, 1), PLAIN)[0]?.kind, 'rent');
});

// ---- players ----------------------------------------------------------------------------------------

test('a sale to a player: the shop’s price, the shop’s stock, and the caps for one buyer and for one day', () => {
  const made = shop('food');
  settleShop(made, at(0, 8), PLAIN);
  const stock = made.stock.jollof ?? 0, till = made.till;
  assert.equal(saleBlock(made, 'owner', 'jollof', 1)?.code, 'own_shop');
  assert.equal(saleBlock(made, 'bola', 'adire', 1)?.code, 'unknown_product');
  for (const units of [0, 4, 1.5, -1, '2', null]) assert.equal(saleBlock(made, 'bola', 'jollof', units)?.code, 'invalid_units', String(units));
  assert.equal(saleBlock(made, 'bola', 'jollof', 2), null);
  assert.equal(sellToPlayer(made, 'bola', 'jollof', 2), 1200);
  assert.deepEqual([made.stock.jollof, made.till, made.fromPlayers, made.buyers.bola], [stock - 2, till + 1200, 1200, { s: 1200, n: 2 }]);
  assert.deepEqual(made.raters, ['bola']);
  // Six items a day from one buyer at one stall.
  assert.equal(sellToPlayer(made, 'bola', 'jollof', 3), 1800);
  assert.equal(saleBlock(made, 'bola', 'jollof', 2)?.code, 'pair_limit');
  assert.equal(saleBlock(made, 'bola', 'jollof', 1), null);
  // ₦5,000 a day from one buyer at one stall.
  const cloth = shop('fabric');
  cloth.prices['aso-oke'] = 3000;
  assert.equal(sellToPlayer(cloth, 'bola', 'aso-oke', 1), 3000);
  assert.equal(saleBlock(cloth, 'bola', 'aso-oke', 1)?.code, 'pair_limit');
  assert.equal(saleBlock(cloth, 'bola', 'ankara', 1), null);
  // ₦15,000 a day of player sales for one stall, whoever buys.
  for (const buyer of ['chi', 'dayo', 'efe', 'femi']) { cloth.stock['aso-oke'] = 5; if (!saleBlock(cloth, buyer, 'aso-oke', 1)) sellToPlayer(cloth, buyer, 'aso-oke', 1); }
  assert.equal(cloth.fromPlayers, 15000);
  assert.equal(saleBlock(cloth, 'gbenga', 'ankara', 1)?.code, 'shop_limit');
  // Sold out is sold out; and the caps are a day's.
  made.stock['puff-puff'] = 0;
  assert.equal(saleBlock(made, 'chi', 'puff-puff', 1)?.code, 'sold_out');
  cloth.paidUntil = at(30, 0);
  settleShop(cloth, at(1, 9), PLAIN);
  assert.deepEqual([cloth.fromPlayers, cloth.buyers], [0, {}]);
  assert.equal(saleBlock(cloth, 'bola', 'ankara', 1), null);
});

test('a rating: one for each purchase, a tenth of the way to the stars given', () => {
  const made = shop('food');
  assert.equal(rateShop(made, 'bola', 5), false, 'nothing bought, nothing to rate');
  sellToPlayer(made, 'bola', 'jollof', 1);
  for (const stars of [0, 6, 2.5, NaN]) assert.equal(rateShop(made, 'bola', stars), false);
  assert.equal(rateShop(made, 'bola', 5), true);
  assert.equal(made.rep, 55);
  assert.deepEqual([made.ratings, made.raters], [{ n: 1, sum: 5 }, []]);
  assert.equal(rateShop(made, 'bola', 1), false, 'once');
  sellToPlayer(made, 'chi', 'jollof', 1);
  assert.equal(rateShop(made, 'chi', 1), true);
  assert.equal(made.rep, 51.5);
  // The list of buyers who may rate is bounded.
  for (let index = 0; index < BUSINESS.raters + 20; index++) { made.stock.jollof = 5; made.buyers = {}; made.fromPlayers = 0; sellToPlayer(made, `buyer-${index}`, 'jollof', 1); }
  assert.equal(made.raters.length, BUSINESS.raters);
});

// ---- the life's side --------------------------------------------------------------------------------

const NOW = at(0, 9);
let seq = 0;
const ctxAt = (now: number, extra: LifeContextInit = {}): LifeContext => { const actionId = `b-${++seq}`; return makeContext({ now, cityId: 'lagos', seed: actionId, actionId, ...extra }); };
interface Game { state: LifeState; now: number }
function life(saved: Record<string, unknown> = {}): Game {
  const state = createLife({ cash: 50000, location: 'market', needs: { hunger: 40, energy: 60, fun: 40, social: 40, hygiene: 40, bladder: 60 }, social: { earned: 20000 }, ...saved }, ctxAt(NOW));
  state.t = NOW;
  return { state, now: NOW };
}
const act = <T extends ActionType>(game: Game, type: T, payload?: unknown, extra?: LifeContextInit): ActionResult<T> => dispatch(game.state, { type, payload } as unknown as ActionBody<T>, ctxAt(game.now, extra));
const server = (game: Game, payload: unknown): ActionResult<'business.server'> => act(game, 'business.server', payload, { internal: true });
const jollof = { op: 'buy', amount: 600, units: 1, label: 'Jollof rice & chicken', shop: 'Mama Put', effects: { hunger: 45, fun: 6 }, need: 'hunger' };
const lines = (game: Game, prefix: string) => game.state.ledger.filter((line) => line.reason.startsWith(prefix));

test('business.server is the server’s: a player cannot run it, and an unknown operation changes nothing', () => {
  const game = life(), before = JSON.stringify(game.state);
  assert.equal(act(game, 'business.server', { op: 'collect', amount: 999999, sales: 9, name: 'x' }).code, 'server_only');
  assert.equal(JSON.stringify(game.state.business), JSON.stringify(JSON.parse(before).business));
  assert.equal(game.state.cash, 50000);
  for (const payload of [{}, { op: 'mint' }, { op: 'constructor' }, { op: 'toString' }, null, 5]) assert.equal(server(game, payload).code, 'invalid_operation', JSON.stringify(payload));
  for (const op of ['open', 'spend', 'collect', 'refund', 'bag-return']) for (const amount of [-1, 1.5, '100', NaN, 2 ** 60, null]) assert.equal(server(game, { op, amount, name: 'x' }).ok, false, `${op} ${String(amount)}`);
  assert.equal(game.state.cash, 50000);
});

test('the owner’s money: setup, stock, rent and upgrades are debits; takings and a closing refund are credits; each with its own ledger line', () => {
  const game = life();
  assert.equal(server(game, { op: 'open', amount: 15000, name: 'Mama Put', city: 'lagos', venue: 'market' }).code, 'opened');
  assert.deepEqual([game.state.cash, game.state.business.opened], [35000, 1]);
  assert.equal(server(game, { op: 'spend', what: 'stock', amount: 9000, name: 'Mama Put' }).code, 'paid');
  assert.equal(server(game, { op: 'spend', what: 'rent', amount: 7000, name: 'Mama Put' }).code, 'paid');
  assert.equal(server(game, { op: 'spend', what: 'upgrade', amount: 15000, name: 'Mama Put' }).code, 'paid');
  assert.equal(server(game, { op: 'spend', what: 'stock', amount: 9000, name: 'Mama Put' }).code, 'insufficient_funds');
  assert.equal(game.state.cash, 4000);
  assert.equal(server(game, { op: 'collect', amount: 12500, sales: 31, name: 'Mama Put' }).code, 'collected');
  assert.deepEqual([game.state.cash, game.state.business.sales], [16500, 31]);
  assert.equal(server(game, { op: 'refund', amount: 9000, name: 'Mama Put' }).code, 'refunded');
  assert.deepEqual(['Shop setup: Mama Put', 'Shop stock: Mama Put', 'Shop rent: Mama Put', 'Shop upgrade: Mama Put', 'Shop takings: Mama Put', 'Shop closed: Mama Put'].map((reason) => lines(game, reason).map((line) => line.amount)),
    [[-15000], [-9000], [-7000], [-15000], [12500], [9000]]);
  // Takings are not "earned from work": they do not raise what the life may give away or spend at players' shops.
  assert.equal(game.state.social.earned, 20000);
  // The life is exactly what a reload makes of it.
  assert.deepEqual(createLife(JSON.parse(JSON.stringify(game.state)), ctxAt(game.now)).business, game.state.business);
  assert.equal(server(game, { op: 'collect', amount: Number.MAX_SAFE_INTEGER, sales: 1, name: 'x' }).code, 'balance_limit');
});

test('collected sales count toward missions, a bounded number of times', () => {
  const game = life({ missions: { seed: 7, day: lagosTime(NOW).day, week: lagosTime(NOW).week, weekly: [{ id: 'w-sales', n: 0, marks: [], claimed: false }], daily: [] }, business: { opened: 1 } });
  server(game, { op: 'collect', amount: 100, sales: 4, name: 'x' });
  assert.equal(viewLife(game.state, ctxAt(game.now)).missions.weekly.find((item) => item.id === 'w-sales')?.n, 4);
  server(game, { op: 'collect', amount: 100, sales: 10000, name: 'x' });
  assert.equal(viewLife(game.state, ctxAt(game.now)).missions.weekly.find((item) => item.id === 'w-sales')?.done, true);
  assert.ok(SALES_COUNTED_PER_COLLECT >= 10 && SALES_COUNTED_PER_COLLECT <= 50);
  assert.equal(game.state.business.sales, 10004);
});

test('buying from a player: only money earned from work, within a day’s caps, and only something the buyer can use', () => {
  const fresh = life({ social: { earned: 0 } });
  assert.equal(server(fresh, jollof).code, 'earn_first');
  assert.match(fresh.state.message, /Earn at least ₦1,000 from paid work/);
  assert.equal(fresh.state.cash, 50000);
  const game = life();
  assert.equal(server(game, jollof).code, 'bought');
  assert.deepEqual([game.state.cash, game.state.needs.hunger, game.state.needs.fun, game.state.business.spent, game.state.business.buys], [49400, 85, 46, 600, { day: lagosTime(NOW).day, spent: 600, count: 1 }]);
  assert.deepEqual(lines(game, 'Bought at Mama Put').map((line) => [line.amount, line.reason]), [[-600, 'Bought at Mama Put: 1 × Jollof rice & chicken']]);
  // Full: a meal is not sold to someone who cannot eat it.
  game.state.needs.hunger = 96;
  assert.equal(server(game, jollof).code, 'not_needed');
  assert.equal(server(game, { ...jollof, need: 'hygiene', effects: { hygiene: 30 } }).code, 'bought', 'soap is another need');
  // A mood item is not sold again while its mood lasts.
  const cloth = { op: 'buy', amount: 2400, units: 1, label: 'Adire cloth', shop: 'Iya Alaro', effects: { social: 10 }, mood: { id: 'new-cloth', label: 'New cloth', value: 6, hours: 12 } };
  assert.equal(server(game, cloth).code, 'bought');
  assert.ok(game.state.moodlets.some((item) => item.id === 'shop-new-cloth' && item.value === 6 && item.expiresAt === game.now + 12 * HOUR));
  assert.equal(server(game, cloth).code, 'already_have');
  // ₦8,000 a day in all.
  game.state.needs.hunger = 10;
  assert.equal(server(game, { ...jollof, amount: 4400 }).code, 'bought');
  assert.equal(game.state.business.buys.spent, 8000);
  assert.equal(server(game, { ...jollof, amount: 1 }).code, 'daily_shop_limit');
  // Eight purchases a day in all.
  const many = life();
  for (let index = 0; index < BUSINESS_BUYING.countPerDay; index++) { many.state.needs.hunger = 10; assert.equal(server(many, { ...jollof, amount: 100 }).code, 'bought'); }
  many.state.needs.hunger = 10;
  assert.equal(server(many, { ...jollof, amount: 100 }).code, 'daily_shop_limit');
  // Tomorrow is a new day.
  many.now += DAY; many.state.t = many.now;
  assert.equal(server(many, { ...jollof, amount: 100 }).code, 'bought');
  assert.deepEqual(many.state.business.buys, { day: lagosTime(NOW).day + 1, spent: 100, count: 1 });
  // Not enough cash, and nonsense.
  const poor = life({ cash: 300 });
  assert.equal(server(poor, jollof).code, 'insufficient_funds');
  for (const amount of [0, -5, 1.5, '600', null]) assert.equal(server(life(), { ...jollof, amount }).code, 'invalid_amount', String(amount));
});

test('what a product does is bounded, whatever the server is told to ask for', () => {
  const game = life({ needs: { hunger: 5, energy: 5, fun: 5, social: 5, hygiene: 5, bladder: 50 } });
  assert.equal(server(game, { ...jollof, need: undefined, effects: { hunger: 1e9, energy: -1e9, cash: 5, __proto__: 1, fun: 'lots', social: 2.5 }, mood: { id: 'x', label: 'x'.repeat(200), value: 1e9, hours: 1e9 } }).code, 'bought');
  assert.deepEqual([game.state.needs.hunger, game.state.needs.energy, game.state.needs.fun, game.state.needs.social], [65, 0, 5, 5]);
  const mood = need(game.state.moodlets.find((item) => item.id === 'shop-x'));
  assert.ok(mood.value <= BUSINESS_BUYING.maxMood && mood.label.length <= 40 && need(mood.expiresAt) - game.now <= BUSINESS_BUYING.maxMoodSeconds * 1000);
  assert.equal(game.state.cash, 49400, 'and it never touches money');
});

test('gifts and purchases draw on one allowance: money a life did not earn from work reaches another player by neither road', () => {
  // Earned ₦6,000 from work, holding ₦200,000 it did not work for.
  const game = life({ cash: 200000, social: { earned: 6000 } });
  const gift = (amount: number) => act(game, 'social.server', { op: 'transfer-out', to: '11111111-2222-4333-8444-555555555555', name: 'Bola', amount }, { internal: true });
  assert.equal(allowance(game.state), 6000);
  assert.equal(server(game, { ...jollof, amount: 2500 }).code, 'bought');
  assert.equal(allowance(game.state), 3500);
  // The gift rule sees what was spent at shops…
  assert.equal(gift(4000).code, 'gift_exceeds_earned');
  assert.equal(viewLife(game.state, ctxAt(game.now)).social.transfer.leftToday, 3500);
  assert.equal(gift(3000).code, 'sent');
  // …and the shop rule sees what was given away.
  game.state.needs.hunger = 10;
  assert.equal(server(game, { ...jollof, amount: 600 }).code, 'spend_exceeds_earned');
  assert.equal(server(game, { ...jollof, amount: 500 }).code, 'bought');
  assert.equal(allowance(game.state), 0);
  game.state.needs.hunger = 10;
  assert.equal(server(game, { ...jollof, amount: 100 }).code, 'spend_exceeds_earned');
  assert.equal(gift(TRANSFER_LIMITS.min).code, 'gift_exceeds_earned');
  assert.equal(game.state.cash, 200000 - 6000, 'exactly what was earned left this life, and no more can');
  const shown = viewLife(game.state, ctxAt(game.now)).business;
  assert.deepEqual([shown.canSpend, shown.buyWhy.length > 0], [0, true]);
  assert.equal(buyBlock(game.state, { amount: 1 }, ctxAt(game.now))?.code, 'spend_exceeds_earned');
});

test('the goods bag: bought for the road, bounded, unpacked onto a stall or sold back', () => {
  const game = life();
  assert.equal(server(game, { op: 'bag-add', product: 'adire', units: 20, amount: 14400, label: 'Adire cloth' }).code, 'bagged');
  assert.deepEqual([game.state.business.bag, game.state.cash], [{ adire: 20 }, 35600]);
  assert.equal(server(game, { op: 'bag-add', product: 'indigo', units: 5, amount: 3300, label: 'Indigo-dyed cloth' }).code, 'bag_full');
  assert.match(game.state.message, /4 more units/);
  assert.equal(server(game, { op: 'bag-add', product: 'indigo', units: 4, amount: 2640, label: 'Indigo-dyed cloth' }).code, 'bagged');
  assert.equal(server(game, { op: 'bag-add', product: 'indigo', units: 1, amount: 660, label: 'x' }).code, 'bag_full');
  for (const payload of [{ product: 'Bad Id', units: 1, amount: 1 }, { product: 'adire', units: 0, amount: 1 }, { product: 'adire', units: 1.5, amount: 1 }, { product: 'adire', units: 1 }]) assert.equal(server(game, { op: 'bag-add', ...payload }).code, 'invalid_operation');
  assert.deepEqual(lines(game, 'Shop goods').map((line) => line.amount), [-14400, -2640]);
  assert.equal(server(game, { op: 'bag-take', items: { adire: 21 } }).code, 'bag_short');
  assert.equal(server(game, { op: 'bag-take', items: { adire: 3, 'clay-pot': 1 } }).code, 'bag_short', 'all or nothing');
  assert.deepEqual(game.state.business.bag, { adire: 20, indigo: 4 });
  assert.equal(server(game, { op: 'bag-take', items: { adire: 20, indigo: 1 } }).code, 'unbagged');
  assert.deepEqual(game.state.business.bag, { indigo: 3 });
  assert.equal(server(game, { op: 'bag-take', items: {} }).code, 'invalid_operation');
  const view = viewLife(game.state, ctxAt(game.now)).business;
  assert.deepEqual([view.bag, view.bagRoom], [[['indigo', 3]], BAG_LIMIT - 3]);
  assert.deepEqual(createLife(JSON.parse(JSON.stringify(game.state)), ctxAt(game.now)).business, game.state.business);
  assert.equal(server(game, { op: 'bag-return', amount: 990 }).code, 'returned');
  assert.deepEqual([game.state.business.bag, lines(game, 'Shop goods returned').map((line) => line.amount)], [{}, [990]]);
  assert.equal(server(game, { op: 'bag-return', amount: 990 }).code, 'bag_short');
});

test('a saved business slice is rebuilt from hostile input, and a life saved before businesses has an empty one', () => {
  const empty = { opened: 0, sales: 0, spent: 0, buys: { day: 0, spent: 0, count: 0 }, bag: {} };
  assert.deepEqual(createLife({ cash: 100 }, ctxAt(NOW)).business, empty);
  for (const business of [null, 5, 'x', [], { opened: -1, sales: 1.5, spent: '9', buys: null, bag: [] }, { buys: { day: -1, spent: NaN, count: Infinity }, bag: { 'Bad Id': 5, adire: -1, indigo: 1.5, cap: 0, __proto__: 4 } }]) {
    assert.deepEqual(createLife({ business }, ctxAt(NOW)).business, empty, JSON.stringify(business));
  }
  // A bag can never be loaded over its limit.
  const heavy = createLife({ business: { bag: { adire: 20, indigo: 20, cap: 4 } } }, ctxAt(NOW)).business.bag;
  assert.deepEqual(heavy, { adire: 20, cap: 4 });
  const kept = createLife({ business: { opened: 2, sales: 40, spent: 1200, buys: { day: 20458, spent: 600, count: 1 }, bag: { adire: 3 } } }, ctxAt(NOW)).business;
  assert.deepEqual(kept, { opened: 2, sales: 40, spent: 1200, buys: { day: 20458, spent: 600, count: 1 }, bag: { adire: 3 } });
  assert.equal(AD_COLOURS.length >= 4, true);
});
