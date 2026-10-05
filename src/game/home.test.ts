import { loadCityContent as preloadCityContent } from './cities/registry.ts';
await Promise.all(['lagos', 'ibadan'].map(preloadCityContent));
// OWNER: home — tests for this owner's systems and content.
// Pattern and rules: see "HOW TO TEST" at the top of src/game/registry.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLife, dispatch, advanceLife, viewLife, spotsOf } from '../life.ts';
import { systems, emit, modify } from './registry.ts';
import { makeContext } from './util.ts';
import { FURNITURE, CATEGORIES, STARTER_FURNITURE, HOME_ACTIVITIES, KINDS, STAR_MULTIPLIER, SELL_REFUND_RATE } from './content/furniture.ts';
import { INGREDIENTS, RECIPES } from './content/food.ts';
import { HOUSES, HOUSE_ORDER, MOVE_IN_WEEKS } from './content/housing.ts';
import { CARS, CAR_ORDER } from './content/cars.ts';
import type { ActionBody, ActionResult, ActionType } from '../types/actions.ts';
import type { FurnitureDefinition } from '../types/content.ts';
import type { EngineEventMap, TripModifierData, SystemDefinition } from '../types/registry.ts';
import type { LifeContext, LifeState, TravelModeId } from '../types/life.ts';
import { isRecord } from './util.ts';
import { checkPlacement, fitInto, findFreeSpot, starterLayout, footprint, nudge, turn, windowSlot, doorSlot } from './home-layout.ts';

const NOW = Date.UTC(2026, 0, 5, 8);
const ctx = makeContext({ now: NOW, cityId: 'lagos', seed: 'home-test' });
const at = (ms: number): LifeContext => ({ ...ctx, now: NOW + ms });
// The payload is deliberately `unknown`: many tests send hostile (malformed) input to prove the server-side validation.
const act = <T extends ActionType>(state: LifeState, type: T, payload?: unknown, when = 0): ActionResult<T> =>
  dispatch(state, { type, payload } as unknown as ActionBody<T>, at(when));
const run = (state: LifeState, seconds: number, from = 0) => advanceLife(state, seconds, at(from + seconds * 1000));
/** The reason of a refused action ('' for a success or a refusal without one). */
const why = (result: { ok: boolean; reason?: string }): string => result.reason ?? '';
/** Narrows a lookup that must have found something. */
function need<T>(value: T | null | undefined, what = 'expected a value'): T { assert.ok(value, what); return value; }
/** A life standing at home (the default Yaba room) with the given overrides. */
const atHome = (saved: Record<string, unknown> = {}): LifeState => createLife({ location: 'home', ...saved }, ctx);
/** A furniture definition that must exist. */
const furniture = (id: string): FurnitureDefinition => need(FURNITURE[id], id);
/** A registered system, for the tests that hook into it. */
const system = (id: string): SystemDefinition => need(systems().find((item) => item.id === id), id);
/** checkPlacement for a placement that must be refused: the refusal itself. */
const refusal = (...args: Parameters<typeof checkPlacement>) => need(checkPlacement(...args));
/** A quoted trip for the 'travel.*' modifiers. */
const trip = (mode: TravelModeId): TripModifierData => ({ mode, destination: 'library', from: 'home', band: 'standard' });
// Deliberately loose: property.ts keeps dead branches that take mode OBJECTS (a list or a map), which the typed ModifierMap does not allow.
const modifyModes = modify as unknown as (state: LifeState, key: 'travel.modes', base: unknown, data: unknown, ctx: LifeContext) => unknown;
// Hostile coordinates (a string, NaN) are the point of one test, so the arguments are deliberately untyped.
const hostilePlacement = checkPlacement as unknown as (...args: unknown[]) => unknown;
const count = (state: LifeState, itemId: string) => state.home.items.filter((item) => item.itemId === itemId).length;
const START_KITCHEN = { rice: 2, 'tomato-paste': 2, seasoning: 6, 'veg-oil': 4, garri: 4, sugar: 5, noodles: 3, eggs: 6, bread: 2, zobo: 1, plantain: 2 };

test('home systems are registered and survive hostile saves', () => {
  for (const id of ['home', 'property']) {
    const system = need(systems().find(item => item.id === id), id);
    for (const junk of ['text', 7, [], { nested: { deep: true } }]) {
      const state = createLife({ [id]: junk }, ctx);
      for (const key of system.stateKeys) assert.notEqual(Reflect.get(state, key), junk, `${id}.${key} must be rebuilt, not copied`);
    }
  }
  const state = createLife(null, ctx);
  assert.equal(advanceLife(state, 60, { ...ctx, now: ctx.now + 60000 }).ok, true);
  assert.equal(typeof viewLife(state, ctx), 'object');
  assert.equal(typeof dispatch, 'function');
});

test('content: fixed values are exact and every original value is marked', () => {
  // Houses: grid, weekly rent and move-in cost.
  assert.deepEqual(HOUSE_ORDER.map((id) => { const house = need(HOUSES[id], 'registered house'); return [id, house.grid, house.rent, house.moveIn]; }), [
    ['mushin', 6, 2400, 7200], ['yaba', 8, 6000, 18000], ['lekki', 10, 17000, 51000], ['ikoyi', 12, 250000, 750000], ['banana', 14, 1500000, 4500000]]);
  for (const house of Object.values(HOUSES)) assert.equal(house.moveIn, MOVE_IN_WEEKS * house.rent, house.id);
  assert.deepEqual(HOUSES.yaba.betaFields, ['grid', 'moveIn']);
  // The six fixed Comfort items: footprint, stars, price — and nothing else is unmarked.
  const observed = Object.values(FURNITURE).filter((item) => !item.beta).map((item) => [item.id, item.w, item.h, item.stars, item.price]);
  assert.deepEqual(observed, [['plastic-chair', 1, 1, 0, 500], ['velvet-sofa', 2, 1, 2, 10200], ['family-sofa', 3, 1, 3, 24000],
    ['leather-sofa', 2, 1, 3, 32000], ['gold-sofa', 2, 1, 4, 55000], ['lounge-armchair', 1, 1, 2, 8500]]);
  assert.equal(CATEGORIES.length, 9);
  for (const item of Object.values(FURNITURE)) {
    assert.ok(CATEGORIES.some((category) => category.id === item.category), item.id);
    assert.ok(Object.hasOwn(KINDS, item.kind), item.id);
    assert.ok(Number.isInteger(item.price) && item.price > 0 && item.stars >= 0 && item.stars < STAR_MULTIPLIER.length && item.label && item.shape && item.blurb, item.id);
  }
  for (const category of CATEGORIES) assert.ok(Object.values(FURNITURE).some((item) => item.category === category.id), `${category.id} has items`);
  assert.equal(STAR_MULTIPLIER[1], 1, 'a one-star object gives exactly the listed amounts');
  // Kitchen: starting stock and the ten fixed recipes with their durations and locks.
  assert.deepEqual(Object.fromEntries(Object.values(INGREDIENTS).filter((item) => item.start).map((item) => [item.id, item.start])), START_KITCHEN);
  assert.equal(Object.keys(INGREDIENTS).length, 18);
  assert.deepEqual(Object.values(INGREDIENTS).filter((item) => item.beta).map((item) => item.id), ['semolina']);
  assert.deepEqual(Object.values(RECIPES).filter((recipe) => !recipe.beta).map((recipe) => [recipe.id, recipe.station, recipe.duration, recipe.requiresSkill?.level ?? 0]), [
    ['soak-garri', 'cooler', 5, 0], ['drink-zobo', 'cooler', 5, 0], ['cook-jollof', 'stove', 11, 0], ['noodles-egg', 'stove', 6, 0], ['fry-dodo', 'stove', 7, 0],
    ['egusi-eba', 'stove', 12, 2], ['efo-semo', 'stove', 12, 2], ['mackerel-stew', 'stove', 11, 0], ['peppered-chicken', 'stove', 8, 0], ['fish-plantain', 'stove', 7, 0]]);
  assert.deepEqual(need(RECIPES['cook-jollof']).ingredients, { rice: 1, 'tomato-paste': 1, seasoning: 1, 'veg-oil': 1 });
  assert.deepEqual(need(RECIPES['soak-garri']).ingredients, { garri: 1, sugar: 1 });
  for (const recipe of Object.values(RECIPES)) for (const id of Object.keys(recipe.ingredients)) assert.ok(INGREDIENTS[id], `${recipe.id} uses ${id}`);
  // Cars: the price ladder; fuel and speed are original and marked.
  assert.deepEqual(CAR_ORDER.map((id) => CARS[id].price), [350000, 900000, 1800000, 3000000, 7500000, 9500000, 15000000, 28000000, 95000000]);
  for (const car of Object.values(CARS)) assert.ok(car.beta && car.fuel > 0 && car.speed > 0 && car.speed < 1, car.id);
  assert.equal(CARS['atlantic-grand'].priceReported, true);
  // Sleep and bath timings.
  const byId = Object.fromEntries(HOME_ACTIVITIES.map((def) => [def.id, def]));
  assert.equal(need(byId.sleep).duration, 36); assert.equal(need(byId['stay-in-bed']).duration, 36);
  const ported = Object.fromEntries(spotsOf('home', 'lagos').flatMap((spot) => spot.activities).map((def) => [def.id, def]));
  assert.equal(need(ported.nap).duration, 15); assert.equal(need(ported.bath).duration, 6); assert.equal(need(need(ported.bath).effects).hygiene, 25);
});

test('placement rules: bounds, collisions, rotation, walls, door and window', () => {
  const chair = furniture('plastic-chair'), sofa = furniture('family-sofa'), lamp = furniture('wall-lamp');
  const items = [{ id: 'f1', itemId: 'family-sofa', x: 1, y: 1, rot: 0 }];
  assert.deepEqual(footprint(sofa, 0), { w: 3, h: 1 }); assert.deepEqual(footprint(sofa, 1), { w: 1, h: 3 }); assert.deepEqual(footprint(lamp, 1), { w: 1, h: 1 });
  assert.equal(checkPlacement(6, items, chair, 0, 1, 0), null);
  assert.equal(refusal(6, items, chair, 3, 1, 0).code, 'occupied');
  assert.match(refusal(6, items, chair, 3, 1, 0).reason, /overlaps your 3-Seater Family Sofa/);
  assert.equal(checkPlacement(6, items, chair, 4, 1, 0), null);
  assert.equal(refusal(6, [], sofa, 4, 0, 0).code, 'out_of_bounds');
  assert.match(refusal(6, [], sofa, 4, 0, 0).reason, /6 × 6/);
  assert.equal(checkPlacement(6, [], sofa, 5, 3, 1), null, 'rotated it stands along the wall');
  assert.equal(refusal(6, [], sofa, 5, 4, 1).code, 'out_of_bounds');
  assert.equal(checkPlacement(6, items, sofa, 2, 1, 0, 'f1'), null, 'an object does not collide with itself while moving');
  for (const bad of [[-1, 0, 0], [0, -1, 0], [6, 0, 0], [0.5, 0, 0], ['1', 0, 0], [0, 0, 1.5], [NaN, 0, 0]]) assert.ok(hostilePlacement(6, [], chair, ...bad), JSON.stringify(bad));
  // Wall items take no floor tiles, cannot cover the window or the door, and cannot share a slot.
  assert.equal(checkPlacement(6, items, lamp, 1, 0, 0), null);
  assert.equal(refusal(6, [], lamp, windowSlot(6), 0, 0).code, 'blocked');
  assert.equal(refusal(6, [], lamp, 0, doorSlot(6), 1).code, 'blocked');
  const hung = [{ id: 'f2', itemId: 'wall-lamp', x: 1, y: 0, rot: 0 }];
  assert.equal(refusal(6, hung, furniture('wall-art'), 1, 0, 0).code, 'occupied');
  assert.equal(checkPlacement(6, hung, furniture('wall-art'), 0, 1, 1), null, 'the same slot number on the other wall is free');
  assert.equal(checkPlacement(6, hung, chair, 1, 0, 0), null, 'floor under a wall item stays free');
  assert.equal(refusal(6, [], lamp, 6, 0, 0).code, 'out_of_bounds');
  // Ghost helpers stay inside the room.
  assert.deepEqual(nudge(6, sofa, { x: 3, y: 0, rot: 0 }, 1, 0), { x: 3, y: 0, rot: 0 });
  assert.deepEqual(nudge(6, chair, { x: 0, y: 0, rot: 0 }, -1, -1), { x: 0, y: 0, rot: 0 });
  assert.deepEqual(turn(6, sofa, { x: 3, y: 5, rot: 0 }), { x: 3, y: 3, rot: 1 });
  assert.deepEqual(turn(6, lamp, { x: 4, y: 0, rot: 0 }), { x: 0, y: 4, rot: 1 });
  assert.deepEqual(nudge(6, lamp, { x: 0, y: 2, rot: 1 }, 0, 1), { x: 0, y: 3, rot: 1 });
  // A full room has no free spot.
  const full = Array.from({ length: 36 }, (_, i) => ({ id: `f${i + 1}`, itemId: 'plastic-chair', x: i % 6, y: Math.floor(i / 6), rot: 0 }));
  assert.equal(findFreeSpot(6, full, chair), null);
});

test('starter room: the starter objects fit every house, and a new life has them', () => {
  const wanted = STARTER_FURNITURE.map((entry) => entry.item).sort();
  for (const item of ['spring-bed', 'radio-stool', 'kerosene-stove', 'cooler-box', 'plastic-chair', 'water-drum', 'jerry-cans', 'bucket-bowl', 'basin', 'toilet', 'wall-lamp', 'wall-calendar']) assert.ok(wanted.includes(item), item);
  assert.equal(wanted.filter((item) => item === 'wall-lamp').length, 2);
  for (const house of Object.values(HOUSES)) {
    const layout = starterLayout(house.grid);
    assert.deepEqual(layout.map((item) => item.itemId).sort(), wanted, `${house.id}: nothing left out`);
    layout.forEach((item, index) => assert.equal(checkPlacement(house.grid, layout.filter((_, other) => other !== index), furniture(item.itemId), item.x, item.y, item.rot), null, `${house.id}: ${item.itemId}`));
  }
  const state = createLife(null, ctx);
  assert.equal(state.property.house, 'yaba');
  assert.equal(state.home.items.length, STARTER_FURNITURE.length);
  assert.equal(state.home.custom, false); assert.equal(state.home.stocked, false);
  const view = viewLife(state, ctx).home;
  assert.equal(view.grid, 8); assert.equal(view.placed, 13); assert.equal(view.stored, 0); assert.equal(view.prices['plastic-chair'], 500);
  assert.equal(view.quality.bed, 1); assert.equal(view.quality.tv, 0);
  // A valid home round-trips unchanged.
  assert.deepEqual(createLife(JSON.parse(JSON.stringify(state)), ctx).home, state.home);
});

test('hostile home saves: junk is rebuilt, overlapping or out-of-room furniture is re-fitted or stored, never lost', () => {
  const hostile = createLife({ location: 'home', property: { house: 'mushin', cars: ['agama-150', 'agama-150', 'tank', 7], car: 'tank' }, home: {
    seq: -4, stocked: 'yes', custom: 1, boost: { id: 'nap', mult: 1e9, done: -1 },
    storage: { 'gold-sofa': 2, 'not-an-item': 5, 'plastic-chair': -1, 'king-bed': 1e9, __proto__: 3 },
    items: [
      { id: 'f1', itemId: 'spring-bed', x: 0, y: 0, rot: 0 },
      { id: 'f1', itemId: 'plastic-chair', x: 0, y: 0, rot: 0 },          // duplicate id, overlapping
      { id: '<script>', itemId: 'plastic-chair', x: 99, y: -5, rot: 7 },  // outside the room
      { id: 'f3', itemId: 'ghost-item', x: 1, y: 1, rot: 0 },             // unknown item
      { id: 'f4', itemId: 'wall-lamp', x: 3, y: 0, rot: 0 },              // on the window
      { id: 'f5', itemId: 'family-sofa', x: 'left', y: null, rot: {} },
      'junk', null, 7, [],
    ] } }, ctx);
  assert.equal(hostile.property.house, 'mushin'); assert.deepEqual(hostile.property.cars, ['agama-150']); assert.equal(hostile.property.car, 'agama-150');
  assert.deepEqual(hostile.home.items.map((item) => item.itemId), ['spring-bed', 'plastic-chair', 'plastic-chair', 'wall-lamp', 'family-sofa']);
  assert.equal(new Set(hostile.home.items.map((item) => item.id)).size, 5, 'ids are unique');
  hostile.home.items.forEach((item, index) => assert.equal(checkPlacement(6, hostile.home.items.filter((_, other) => other !== index), furniture(item.itemId), item.x, item.y, item.rot), null, item.itemId));
  assert.deepEqual(hostile.home.storage, { 'gold-sofa': 2, 'king-bed': 99 });
  assert.equal(hostile.home.stocked, false); assert.equal(hostile.home.custom, false); assert.equal(hostile.home.boost, null);
  assert.ok(hostile.home.seq > 5);
  // More furniture than the room can hold: the overflow is stored, the total is conserved.
  const crowd = Array.from({ length: 50 }, (_, i) => ({ id: `f${i + 1}`, itemId: 'plastic-chair', x: 0, y: 0, rot: 0 }));
  const packed = createLife({ property: { house: 'mushin' }, home: { items: crowd } }, ctx);
  assert.equal(packed.home.items.length, 36); assert.equal(packed.home.storage['plastic-chair'], 14);
  assert.deepEqual(createLife(JSON.parse(JSON.stringify(packed)), ctx).home, packed.home, 'sanitizing twice changes nothing');
  for (const junk of [{ items: 'bed' }, { items: [[]] }, { items: null, stocked: true }]) assert.ok(Array.isArray(createLife({ home: junk }, ctx).home.items));
});

test('buy mode: charged on place through the ledger, with server-side bounds and collision checks', () => {
  const state = atHome();
  const seen: unknown[] = [];
  const hooks = need(system('home').on);
  const original = hooks['item.bought'];
  hooks['item.bought'] = (s, data) => { seen.push(data); };
  try {
    const bought = act(state, 'home.furniture-buy', { item: 'plastic-chair', x: 6, y: 6, rot: 0 });
    assert.deepEqual([bought.ok, bought.code], [true, 'bought']);
    assert.equal(state.cash, 4500);
    assert.deepEqual(state.ledger.at(-1), { at: NOW, amount: -500, reason: 'Bought Plastic Chair', balance: 4500 });
    assert.equal(count(state, 'plastic-chair'), 2); assert.equal(state.home.custom, true);
    assert.deepEqual(seen, [{ id: 'plastic-chair', item: 'plastic-chair', price: 500, kind: 'furniture' }]);
  } finally { if (original) hooks['item.bought'] = original; else delete hooks['item.bought']; }
  const placed = need(state.home.items.at(-1));
  assert.deepEqual([placed.x, placed.y, placed.rot], [6, 6, 0]);
  // Every refusal names what is wrong and charges nothing.
  const overlap = act(state, 'home.furniture-buy', { item: 'plastic-chair', x: 6, y: 6, rot: 0 });
  assert.equal(overlap.code, 'occupied'); assert.match(why(overlap), /overlaps your Plastic Chair/);
  const outside = act(state, 'home.furniture-buy', { item: 'family-sofa', x: 6, y: 7, rot: 0 });
  assert.equal(outside.code, 'out_of_bounds'); assert.match(why(outside), /8 × 8/);
  const poor = act(state, 'home.furniture-buy', { item: 'gold-sofa', x: 3, y: 4, rot: 0 });
  assert.equal(poor.code, 'insufficient_funds'); assert.match(why(poor), /₦55,000.*₦4,500.*₦50,500 short/);
  for (const payload of [{}, { item: 'nope', x: 1, y: 1 }, { item: '__proto__', x: 1, y: 1 }, { item: ['plastic-chair'], x: 1, y: 1 }]) assert.equal(act(state, 'home.furniture-buy', payload).code, 'invalid_item');
  for (const payload of [{ item: 'plastic-chair' }, { item: 'plastic-chair', x: '1', y: 1 }, { item: 'plastic-chair', x: 1.5, y: 1 }, { item: 'plastic-chair', x: 1, y: 1, rot: 'north' }]) assert.equal(act(state, 'home.furniture-buy', payload).code, 'invalid_position');
  assert.equal(state.cash, 4500); assert.equal(state.home.items.length, 14);
  // Wall items go on walls; rotation picks the wall.
  assert.equal(act(state, 'home.furniture-buy', { item: 'wall-lamp', x: 4, y: 3, rot: 0 }).code, 'blocked', 'the window is at back-wall slot 4');
  assert.equal(act(state, 'home.furniture-buy', { item: 'wall-lamp', x: 5, y: 3, rot: 0 }).code, 'bought');
  assert.deepEqual([need(state.home.items.at(-1)).x, need(state.home.items.at(-1)).y], [5, 0], 'pinned to the back wall');
  // Buy is refused away from home and while busy.
  const away = createLife(null, ctx);
  const refused = act(away, 'home.furniture-buy', { item: 'plastic-chair', x: 6, y: 6, rot: 0 });
  assert.equal(refused.code, 'not_home'); assert.match(why(refused), /Go home/); assert.equal(away.cash, 5000);
  act(state, 'spot', { id: 'bathroom' }); act(state, 'activity', { id: 'bath' });
  assert.equal(act(state, 'home.furniture-buy', { item: 'plastic-chair', x: 6, y: 5, rot: 0 }).code, 'busy');
});

test('the shop.price modifier discounts furniture and groceries, and the view shows the discounted price', () => {
  const perk = system('goals');
  perk.modifiers = { ...(perk.modifiers || {}), 'shop.price': (value) => value * 0.9 };
  try {
    const state = atHome();
    assert.equal(viewLife(state, ctx).home.prices['velvet-sofa'], 9180);
    assert.equal(act(state, 'home.furniture-buy', { item: 'plastic-chair', x: 6, y: 6, rot: 0 }).code, 'bought');
    assert.equal(state.cash, 4550);
    assert.equal(act(state, 'home.grocery-buy', { id: 'rice', packs: 2 }).code, 'delivered');
    assert.equal(state.cash, 4550 - 1080);
    assert.equal(need(viewLife(state, ctx).property.cars[0]).price, 315000);
  } finally { delete need(perk.modifiers)['shop.price']; }
});

test('move, rotate, store, re-place and sell: positions are validated and the refund is half the price', () => {
  const state = atHome({ cash: 60000 });
  act(state, 'home.furniture-buy', { item: 'gold-sofa', x: 3, y: 4, rot: 0 });
  const sofa = need(state.home.items.at(-1));
  assert.equal(act(state, 'home.furniture-move', { id: sofa.id, x: 4, y: 4, rot: 0 }).code, 'moved');
  assert.equal(act(state, 'home.furniture-move', { id: sofa.id, x: 4, y: 3, rot: 1 }).code, 'moved');
  assert.deepEqual([sofa.x, sofa.y, sofa.rot], [4, 3, 1]);
  const bump = act(state, 'home.furniture-move', { id: sofa.id, x: 0, y: 0, rot: 0 });
  assert.equal(bump.code, 'occupied'); assert.match(why(bump), /Spring Bed/); assert.deepEqual([sofa.x, sofa.y], [4, 3]);
  assert.equal(act(state, 'home.furniture-move', { id: 'f999', x: 1, y: 1, rot: 0 }).code, 'invalid_object');
  assert.equal(state.cash, 5000, 'moving is free');
  assert.equal(act(state, 'home.furniture-store', { id: sofa.id }).code, 'stored');
  assert.deepEqual(state.home.storage, { 'gold-sofa': 1 }); assert.equal(count(state, 'gold-sofa'), 0);
  assert.equal(act(state, 'home.furniture-place', { item: 'gold-sofa', x: 0, y: 0, rot: 0 }).code, 'occupied');
  assert.equal(state.home.storage['gold-sofa'], 1, 'a refused placement keeps the item in storage');
  assert.equal(act(state, 'home.furniture-place', { item: 'gold-sofa', x: 3, y: 4, rot: 0 }).code, 'placed');
  assert.deepEqual(state.home.storage, {}); assert.equal(state.cash, 5000, 'placing from storage is free');
  assert.equal(act(state, 'home.furniture-place', { item: 'gold-sofa', x: 3, y: 6, rot: 0 }).code, 'not_in_storage');
  const sold = act(state, 'home.furniture-sell', { id: need(state.home.items.at(-1)).id });
  assert.equal(sold.code, 'sold'); assert.equal(SELL_REFUND_RATE, 0.5);
  assert.equal(state.cash, 5000 + 27500); assert.equal(need(state.ledger.at(-1)).reason, 'Sold Royal Gold Sofa'); assert.match(state.message, /₦27,500 \(50% of its price\)/);
  assert.equal(act(state, 'home.furniture-sell', { id: sofa.id }).code, 'invalid_object', 'cannot sell the same object twice');
  assert.equal(act(state, 'home.furniture-sell', { item: 'gold-sofa' }).code, 'invalid_object', 'nothing of that kind in storage');
  assert.equal(state.cash, 32500);
  const away = createLife({ cash: 100 }, ctx);
  assert.equal(act(away, 'home.furniture-sell', { id: 'f1' }).code, 'not_home');
});

test('starter kitchen: stocked once on arriving home, at life.started, or by unpacking', () => {
  const state = createLife({ cash: 100 }, ctx);
  assert.deepEqual(state.inventory, {});
  act(state, 'travel', { id: 'home', mode: 'trek' });
  run(state, need(state.activeAction).duration); // the trek from Freedom Park crosses the lagoon
  assert.equal(state.location, 'home'); assert.match(state.message, /^Arrived at Home\./);
  assert.deepEqual(state.inventory, START_KITCHEN); assert.equal(state.home.stocked, true);
  state.inventory.rice = 0;
  emit(state, 'travel.arrived', { venue: 'home', from: 'park', mode: null }, ctx);
  assert.equal(state.inventory.rice, 0, 'not restocked on later arrivals');
  const placedAtHome = atHome();
  assert.equal(act(placedAtHome, 'home.kitchen-unpack').code, 'unpacked'); assert.deepEqual(placedAtHome.inventory, START_KITCHEN);
  const again = act(placedAtHome, 'home.kitchen-unpack'); assert.equal(again.code, 'already_unpacked'); assert.ok(why(again)); assert.equal(placedAtHome.inventory.eggs, 6);
  assert.deepEqual(viewLife(placedAtHome, ctx).home.kitchen.slice(0, 2), [{ id: 'rice', label: 'Long-grain Rice', icon: '🍚', count: 2 }, { id: 'tomato-paste', label: 'Tomato Paste', icon: '🥫', count: 2 }]);
});

test('life.started assigns the chosen house, lays out the starter room for its grid and stocks the kitchen', () => {
  const state = createLife(null, ctx);
  // Made-up body, traits, dream and lottery ids: only the house matters to these systems.
  emit(state, 'life.started', { body: 'a', traits: ['x', 'y'], dream: 'd', lottery: 'l', house: 'mushin' } as unknown as EngineEventMap['life.started'], ctx);
  assert.equal(state.property.house, 'mushin');
  assert.equal(state.home.items.length, STARTER_FURNITURE.length);
  for (const item of state.home.items) { const size = footprint(furniture(item.itemId), item.rot); assert.ok(item.x + size.w <= 6 && item.y + size.h <= 6, item.itemId); }
  assert.deepEqual(state.inventory, START_KITCHEN);
  assert.equal(state.cash, 5000, 'the starting house costs no move-in fee');
  emit(state, 'life.started', { house: 'castle' } as unknown as EngineEventMap['life.started'], ctx); // hostile: an unknown house id
  assert.equal(state.property.house, 'mushin', 'an unknown house id is ignored');
  assert.deepEqual(state.inventory, START_KITCHEN, 'stocked only once');
  // A player who already rearranged keeps their furniture when the event arrives.
  const custom = atHome({ cash: 60000 });
  act(custom, 'home.furniture-buy', { item: 'gold-sofa', x: 3, y: 4, rot: 0 });
  emit(custom, 'life.started', { house: 'lekki' } as unknown as EngineEventMap['life.started'], ctx); // partial event data
  assert.equal(count(custom, 'gold-sofa'), 1); assert.equal(custom.property.house, 'lekki');
});

test('kitchen: cooler and stove share one inventory; ingredients are used on completion and cooking grants XP', () => {
  const state = atHome({ needs: { hunger: 10 } });
  act(state, 'home.kitchen-unpack');
  const garri = act(state, 'activity', { id: 'home-soak-garri' });
  assert.equal(garri.code, 'started');
  assert.deepEqual([state.inventory.garri, state.inventory.sugar], [4, 5], 'nothing is taken at the start');
  run(state, 5);
  assert.equal(state.needs.hunger, 45); assert.deepEqual([state.inventory.garri, state.inventory.sugar], [3, 4]);
  assert.match(state.message, /Soak Garri & Sugar completed\. Used 1 × Yellow Garri, 1 × Cube Sugar\./);
  act(state, 'activity', { id: 'home-cook-jollof' }, 5000);
  assert.deepEqual(state.activeAction, { kind: 'activity', id: 'home-cook-jollof', duration: 11, remaining: 11 });
  run(state, 11, 5000);
  assert.deepEqual([state.inventory.rice, state.inventory['tomato-paste'], state.inventory.seasoning, state.inventory['veg-oil']], [1, 1, 5, 3]);
  assert.equal(state.needs.hunger, 90); assert.equal(state.skills.cooking, 100);
  assert.ok(state.moodlets.some((moodlet) => moodlet.id === 'home-jollof'));
  assert.equal(state.cash, 5000, 'recipes are free');
  // Zobo: the last bottle disappears from the inventory and the card then names what is missing.
  act(state, 'activity', { id: 'home-drink-zobo' }, 20000); run(state, 5, 20000);
  assert.equal(state.inventory.zobo, undefined);
  const dry = act(state, 'activity', { id: 'home-drink-zobo' }, 30000);
  assert.equal(dry.code, 'missing_items'); assert.equal(why(dry), 'Need Zobo. Order in Phone → Groceries.');
});

test('meal.eaten is emitted for home meals with the recipe id', () => {
  const heard: unknown[] = [];
  const probe = system('goals');
  probe.on = { ...(probe.on || {}), 'meal.eaten': (state, data) => { heard.push(data); } };
  try {
    const state = atHome(); act(state, 'home.kitchen-unpack');
    act(state, 'activity', { id: 'home-noodles-egg' }); run(state, 6);
    act(state, 'activity', { id: 'garri' }, 6000); run(state, 5, 6000);
    assert.deepEqual(heard, [{ id: 'noodles-egg', source: 'home' }, { id: 'garri', source: 'home' }]);
  } finally { delete need(probe.on)['meal.eaten']; }
});

test('interrupted cooking never costs ingredients: cancel and reload mid-cook', () => {
  const state = atHome({ needs: { hunger: 20 } });
  act(state, 'home.kitchen-unpack');
  const before = { ...state.inventory };
  act(state, 'activity', { id: 'home-cook-jollof' });
  run(state, 4);
  assert.equal(act(state, 'cancel', {}, 4000).code, 'cancelled');
  run(state, 60, 4000);
  assert.deepEqual(state.inventory, before, 'cancel: every ingredient is still there');
  assert.equal(state.skills.cooking, 0); assert.equal(state.needs.hunger, 20);
  // Reload 0.7 s into the cook: the action continues on the server and completes with the meal.
  act(state, 'activity', { id: 'home-cook-jollof' }, 70000);
  run(state, 0.7, 70000);
  const reloaded = createLife(JSON.parse(JSON.stringify(state)), at(70700));
  assert.equal(need(reloaded.activeAction).id, 'home-cook-jollof'); assert.deepEqual(reloaded.inventory, before);
  run(reloaded, 30, 70700);
  assert.equal(reloaded.activeAction, null);
  assert.deepEqual([reloaded.inventory.rice, reloaded.inventory['tomato-paste'], reloaded.inventory.seasoning, reloaded.inventory['veg-oil']], [1, 1, 5, 3]);
  assert.equal(reloaded.needs.hunger, 65); assert.equal(reloaded.skills.cooking, 100);
  const twice = createLife(JSON.parse(JSON.stringify(reloaded)), at(101000));
  run(twice, 30, 101000);
  assert.deepEqual(twice.inventory, reloaded.inventory, 'a second reload debits nothing more');
});

test('recipe locks: the skill is reported first, then the missing ingredients, then the missing appliance', () => {
  const state = atHome(); act(state, 'home.kitchen-unpack');
  const skill = act(state, 'activity', { id: 'home-egusi-eba' });
  assert.equal(skill.code, 'skill_required'); assert.match(why(skill), /Requires Cooking level 2 \(yours is 0\)/);
  state.skills.cooking = 300;
  const items = act(state, 'activity', { id: 'home-egusi-eba' });
  assert.equal(items.code, 'missing_items'); assert.equal(why(items), 'Need Ground Egusi, Palm Oil. Order in Phone → Groceries.');
  assert.equal(why(act(state, 'activity', { id: 'home-mackerel-stew' })), 'Need Mackerel. Order in Phone → Groceries.');
  assert.equal(why(act(state, 'activity', { id: 'home-peppered-chicken' })), 'Need Frozen Chicken. Order in Phone → Groceries.');
  assert.equal(why(act(state, 'activity', { id: 'home-fish-plantain' })), 'Need Smoked Fish. Order in Phone → Groceries.');
  const cards = viewLife(state, ctx).activities.cards;
  assert.equal(need(need(cards.find((card) => card.id === 'home-efo-semo')).blocked).code, 'missing_items');
  assert.equal(need(cards.find((card) => card.id === 'home-cook-jollof')).blocked, null);
  assert.equal(cards.length, 11, 'eleven recipes; the free dry garri is not listed while the cooler can soak some');
  assert.equal(cards.some((card) => card.id === 'garri'), false);
  // Out of sugar: the cooler can no longer soak garri, so the free fallback is listed and nobody goes hungry.
  const sugar = need(state.inventory.sugar); state.inventory.sugar = 0;
  const empty = viewLife(state, ctx).activities.cards;
  assert.deepEqual([empty.length, need(empty.find((card) => card.id === 'garri')).label, need(empty.find((card) => card.id === 'garri')).blocked], [12, 'Eat Dry Garri', null]);
  assert.equal(need(need(empty.find((card) => card.id === 'home-soak-garri')).blocked).code, 'missing_items');
  state.inventory.sugar = sugar;
  // Hidden is not removed: a save that is half-way through the old "garri" still loads and finishes.
  const old = createLife({ ...structuredClone(state), activeAction: { kind: 'activity', id: 'garri', duration: 5, remaining: 2 } }, ctx);
  assert.deepEqual([need(old.activeAction).id, need(old.activeAction).remaining], ['garri', 2]);
  const hungry = old.needs.hunger; old.needs.hunger = 40;
  advanceLife(old, 3, { ...ctx, now: ctx.now + 3000 });
  assert.deepEqual([old.activeAction, old.needs.hunger], [null, 60]); void hungry;
  // Sell the stove: stove recipes now ask for one; the cooler still works.
  act(state, 'home.furniture-sell', { id: need(state.home.items.find((item) => item.itemId === 'kerosene-stove')).id });
  const noStove = act(state, 'activity', { id: 'home-cook-jollof' });
  assert.equal(noStove.code, 'furniture_required'); assert.match(why(noStove), /Needs a stove or cooker in your room\. Open Buy/);
  assert.equal(act(state, 'activity', { id: 'home-soak-garri' }).code, 'started');
});

test('groceries: delivered to the kitchen immediately, anywhere, with validated quantities', () => {
  const state = createLife(null, ctx);
  const order = act(state, 'home.grocery-buy', { id: 'egusi', packs: 2 });
  assert.equal(order.code, 'delivered'); assert.equal(state.inventory.egusi, 4); assert.equal(state.cash, 5000 - 1600);
  assert.deepEqual([need(state.ledger.at(-1)).amount, need(state.ledger.at(-1)).reason], [-1600, 'Groceries: 4 × Ground Egusi']);
  assert.equal(act(state, 'home.grocery-buy', { id: 'palm-oil' }).code, 'delivered'); assert.equal(state.inventory['palm-oil'], 4);
  for (const packs of [0, -1, 1.5, '2', 21, 1e9]) assert.equal(act(state, 'home.grocery-buy', { id: 'rice', packs }).code, 'invalid_quantity', String(packs));
  for (const id of ['caviar', '__proto__', null, 7]) assert.equal(act(state, 'home.grocery-buy', { id }).code, 'invalid_item');
  const poor = act(state, 'home.grocery-buy', { id: 'chicken', packs: 5 });
  assert.equal(poor.code, 'insufficient_funds'); assert.match(why(poor), /₦10,000/); assert.equal(state.inventory.chicken, undefined);
  state.inventory.garri = 9998;
  const full = act(state, 'home.grocery-buy', { id: 'garri' });
  assert.equal(full.code, 'kitchen_full'); assert.equal(state.inventory.garri, 9998);
  assert.equal(state.cash, 5000 - 1600 - 600);
  // Bought ingredients unlock the recipe once the skill is there.
  const cook = atHome({ skills: { cooking: 300 }, inventory: { egusi: 1, 'palm-oil': 1, garri: 1 } });
  assert.equal(act(cook, 'activity', { id: 'home-egusi-eba' }).code, 'started');
  run(cook, 12); assert.deepEqual(cook.inventory, {}); assert.equal(cook.needs.hunger, 100);
});

test('bed: sleep and stay in bed raise energy gradually and waking early keeps the gain', () => {
  const state = atHome({ spot: 'bedroom', needs: { energy: 10, fun: 10 } });
  assert.equal(act(state, 'activity', { id: 'home-sleep' }).code, 'started');
  assert.equal(need(state.activeAction).duration, 36);
  run(state, 10); assert.equal(state.needs.energy, 35);
  run(state, 10, 10000); assert.equal(state.needs.energy, 60);
  assert.equal(act(state, 'cancel', {}, 20000).code, 'cancelled');
  run(state, 30, 20000); assert.equal(state.needs.energy, 60, 'waking early keeps what was gained');
  const whole = atHome({ spot: 'bedroom', needs: { energy: 5 } });
  act(whole, 'activity', { id: 'home-sleep' }); run(whole, 36);
  assert.equal(whole.needs.energy, 95); assert.equal(whole.activeAction, null);
  const lazy = atHome({ spot: 'bedroom', needs: { energy: 10, fun: 10 } });
  act(lazy, 'activity', { id: 'home-stay-in-bed' }); run(lazy, 36);
  assert.ok(Math.abs(lazy.needs.energy - 53.2) < 1e-6); assert.ok(Math.abs(lazy.needs.fun - 31.6) < 1e-6);
  // No bed, no sleep — but the ported nap on the floor still works, so the player is never trapped.
  for (const bed of whole.home.items.filter((item) => furniture(item.itemId).kind === 'bed')) act(whole, 'home.furniture-sell', { id: bed.id }, 40000);
  const refused = act(whole, 'activity', { id: 'home-sleep' }, 40000);
  assert.equal(refused.code, 'furniture_required'); assert.match(why(refused), /Needs a bed in your room/);
  assert.equal(act(whole, 'activity', { id: 'nap' }, 40000).code, 'started');
});

test('better furniture gives better results: beds restore faster, stoves feed and teach more', () => {
  const rest = (bed?: string) => {
    const state = atHome({ spot: 'bedroom', cash: 300000, needs: { energy: 0 } });
    act(state, 'home.furniture-sell', { id: need(state.home.items.find((item) => item.itemId === 'spring-bed')).id });
    if (bed) assert.equal(act(state, 'home.furniture-buy', { item: bed, x: 0, y: 3, rot: 0 }).code, 'bought');
    assert.equal(act(state, 'activity', { id: bed ? 'home-sleep' : 'nap' }).code, 'started');
    for (let second = 0; second < 10; second++) run(state, 1, second * 1000);
    return state;
  };
  assert.ok(Math.abs(rest('spring-bed').needs.energy - 25) < 1e-6, 'one star: exactly the listed rate');
  assert.ok(Math.abs(rest('sleeping-mat').needs.energy - 20) < 1e-6, 'no stars: 0.8 ×');
  assert.ok(Math.abs(rest('ortho-bed').needs.energy - 37.5) < 1e-6, 'three stars: 1.5 ×');
  const king = rest('king-bed');
  assert.ok(Math.abs(king.needs.energy - 45) < 1e-6, 'four stars: 1.8 ×');
  // An early wake keeps the boosted gain and pays nothing afterwards; a full sleep pays the whole boost once.
  act(king, 'cancel', {}, 10000); run(king, 100, 10000); assert.ok(Math.abs(king.needs.energy - 45) < 1e-6); assert.equal(king.home.boost, null);
  const one = atHome({ spot: 'bedroom', cash: 300000, needs: { energy: 0 } });
  act(one, 'home.furniture-buy', { item: 'ortho-bed', x: 3, y: 4, rot: 0 });
  act(one, 'activity', { id: 'nap' }); run(one, 500);
  assert.equal(one.needs.energy, 45, 'the ported nap is boosted too: 15 s × 2 × 1.5, even settled in one step'); assert.equal(one.home.boost, null);
  const reloaded = atHome({ spot: 'bedroom', cash: 300000, needs: { energy: 0 } });
  act(reloaded, 'home.furniture-buy', { item: 'ortho-bed', x: 3, y: 4, rot: 0 });
  act(reloaded, 'activity', { id: 'nap' }); run(reloaded, 5);
  const copy = createLife(JSON.parse(JSON.stringify(reloaded)), at(5000));
  run(copy, 10, 5000); assert.equal(copy.needs.energy, 45, 'the boost survives a reload without paying twice');
  // Completion effects and XP scale with the stove; bath with the shower.
  const cook = atHome({ cash: 400000, needs: { hunger: 0 } }); act(cook, 'home.kitchen-unpack');
  act(cook, 'home.furniture-buy', { item: 'chef-range', x: 3, y: 4, rot: 0 });
  act(cook, 'activity', { id: 'home-cook-jollof' }); run(cook, 11);
  assert.equal(cook.needs.hunger, 81); assert.equal(cook.skills.cooking, 180);
  const wash = atHome({ spot: 'bathroom', cash: 100000, needs: { hygiene: 0, bladder: 10 } });
  act(wash, 'activity', { id: 'bath' }); run(wash, 6); assert.equal(wash.needs.hygiene, 25, 'bucket bath: +25');
  act(wash, 'home.furniture-buy', { item: 'shower-cubicle', x: 3, y: 4, rot: 0 }, 6000);
  act(wash, 'activity', { id: 'bath' }, 6000); run(wash, 6, 6000); assert.equal(wash.needs.hygiene, 62.5);
  act(wash, 'activity', { id: 'home-use-toilet' }, 12000); run(wash, 4, 12000); assert.equal(wash.needs.bladder, 80);
  assert.equal(viewLife(cook, ctx).home.quality.stove, 1.8);
});

test('catalogue objects unlock their actions: sitting area and skills corner', () => {
  const state = atHome({ cash: 2000000, needs: { fun: 10, energy: 50 } });
  assert.deepEqual(spotsOf('home', 'lagos').map((spot) => spot.id), ['kitchen', 'bathroom', 'bedroom', 'living', 'study']);
  assert.equal(act(state, 'spot', { id: 'living' }).code, 'selected');
  assert.equal(act(state, 'activity', { id: 'home-watch-tv' }).code, 'furniture_required');
  act(state, 'activity', { id: 'home-listen-radio' }); run(state, 10); assert.equal(state.needs.fun, 22);
  act(state, 'activity', { id: 'home-sit-down' }, 10000); run(state, 8, 10000);
  assert.ok(Math.abs(state.needs.fun - 25.2) < 1e-6, 'a no-star plastic chair gives 0.8 × the listed +4');
  act(state, 'home.furniture-buy', { item: 'small-tv', x: 3, y: 4, rot: 0 }, 20000);
  act(state, 'activity', { id: 'home-watch-tv' }, 20000); run(state, 12, 20000);
  assert.ok(Math.abs(state.needs.fun - 47.7) < 1e-6, 'two-star TV: 18 × 1.25');
  act(state, 'home.furniture-buy', { item: 'generator', x: 4, y: 4, rot: 0 }, 40000);
  assert.equal(viewLife(state, ctx).home.quality.tv, 1.5, 'a generator powers the TV: 1.25 × 1.2');
  act(state, 'spot', { id: 'study' }, 40000);
  const locked = viewLife(state, at(40000)).activities.cards;
  assert.equal(locked.length, 7); assert.ok(locked.every((card) => card.blocked?.code === 'furniture_required'));
  act(state, 'home.furniture-buy', { item: 'laptop-desk', x: 3, y: 5, rot: 0 }, 40000);
  act(state, 'home.furniture-buy', { item: 'gym-mat', x: 5, y: 3, rot: 0 }, 40000);
  act(state, 'activity', { id: 'home-code-practice' }, 40000); run(state, 14, 40000);
  assert.equal(state.skills.coding, 60, '40 XP × 1.25 (two stars) × 1.2 (powered)');
  act(state, 'activity', { id: 'home-workout' }, 60000); run(state, 12, 60000);
  assert.equal(state.skills.fitness, 40);
  state.needs.energy = 5;
  const tired = act(state, 'activity', { id: 'home-workout' }, 80000);
  assert.equal(tired.code, 'needs_required'); assert.match(why(tired), /Energy 15\+/);
  // Every furniture kind with actions has at least one activity, and every activity's kind has a catalogue item.
  for (const def of HOME_ACTIVITIES) assert.ok(Object.values(FURNITURE).some((item) => item.kind === def.needs), def.id);
  for (const [kind, meta] of Object.entries(KINDS)) if (meta.spot) assert.ok([...HOME_ACTIVITIES.map((def) => def.needs), ...Object.values(RECIPES).map((recipe) => recipe.station), 'bath'].includes(kind), kind);
});

test('a pleasant room lifts the mood on arriving home; the starter room does not', () => {
  const plain = createLife(null, ctx);
  act(plain, 'travel', { id: 'home', mode: 'trek' }); run(plain, 5);
  assert.deepEqual(plain.moodlets, []);
  const nice = atHome({ cash: 200000 });
  act(nice, 'home.furniture-buy', { item: 'aquarium', x: 3, y: 4, rot: 0 });
  act(nice, 'home.furniture-buy', { item: 'potted-plant', x: 4, y: 4, rot: 0 });
  emit(nice, 'travel.arrived', { venue: 'home', from: 'park', mode: null }, ctx);
  assert.deepEqual(nice.moodlets.map((moodlet) => [moodlet.id, moodlet.value]), [['lovely-home', 3]]);
  assert.equal(viewLife(nice, ctx).home.ambience, 4);
});

test('houses: moving costs three weeks of rent, emits house.moved, and furniture moves with you', () => {
  const state = atHome({ cash: 200000 });
  act(state, 'home.furniture-buy', { item: 'family-sofa', x: 0, y: 6, rot: 0 });
  act(state, 'home.furniture-buy', { item: 'gold-sofa', x: 6, y: 6, rot: 0 });
  const owned = [...state.home.items.map((item) => item.itemId)].sort();
  const heard: unknown[] = [];
  const probe = system('goals');
  probe.on = { ...(probe.on || {}), 'house.moved': (s, data) => { heard.push(data); } };
  try {
    const cash = state.cash;
    const up = act(state, 'property.house-move', { id: 'lekki' });
    assert.deepEqual([up.ok, up.code], [true, 'moved']);
    assert.equal(state.cash, cash - 51000); assert.equal(state.property.house, 'lekki');
    assert.deepEqual([need(state.ledger.at(-1)).amount, need(state.ledger.at(-1)).reason], [-51000, 'Landlord and agent: Mini-flat, Lekki Phase 1']);
    assert.deepEqual(heard, [{ id: 'lekki', from: 'yaba', cost: 51000 }]);
    assert.deepEqual(state.home.items.map((item) => item.itemId).sort(), owned, 'a bigger room keeps everything in place');
    assert.equal(viewLife(state, ctx).home.grid, 10);
    // Down to the 6 × 6 room: what no longer fits is re-fitted, and the rest goes to storage.
    const down = act(state, 'property.house-move', { id: 'mushin' });
    assert.equal(down.code, 'moved'); assert.equal(state.cash, cash - 51000 - 7200);
    const after = [...state.home.items.map((item) => item.itemId), ...Object.entries(state.home.storage).flatMap(([id, n]) => Array(n).fill(id))].sort();
    assert.deepEqual(after, owned, 'nothing is lost in a move');
    state.home.items.forEach((item, index) => assert.equal(checkPlacement(6, state.home.items.filter((_, other) => other !== index), furniture(item.itemId), item.x, item.y, item.rot), null, item.itemId));
  } finally { delete need(probe.on)['house.moved']; }
  // Refusals.
  const same = act(state, 'property.house-move', { id: 'mushin' }); assert.equal(same.code, 'already_home'); assert.ok(why(same));
  const poor = act(state, 'property.house-move', { id: 'banana' });
  assert.equal(poor.code, 'insufficient_funds'); assert.match(why(poor), /₦4,500,000/); assert.equal(state.property.house, 'mushin');
  for (const id of ['castle', '__proto__', null, {}]) assert.equal(act(state, 'property.house-move', { id }).code, 'invalid_house');
  const view = viewLife(state, ctx).property;
  assert.equal(view.rent, 2400); assert.equal(view.nextHouse, 'yaba');
  assert.deepEqual(view.houses.map((house) => [house.id, house.current, Boolean(house.blocked)]), [['mushin', true, true], ['yaba', false, false], ['lekki', false, false], ['ikoyi', false, true], ['banana', false, true]]);
  assert.match(need(need(view.houses[3]).blocked), /^Need ₦/);
});

test('a move that overflows the room stores the furniture and it can be re-placed or sold', () => {
  const chairs = Array.from({ length: 40 }, (_, i) => ({ id: `f${i + 1}`, itemId: 'plastic-chair', x: i % 8, y: Math.floor(i / 8), rot: 0 }));
  const state = createLife({ location: 'home', cash: 10000, home: { items: chairs, custom: true, stocked: true } }, ctx);
  assert.equal(state.home.items.length, 40);
  assert.equal(act(state, 'property.house-move', { id: 'mushin' }).code, 'moved');
  assert.equal(state.home.items.length, 36); assert.deepEqual(state.home.storage, { 'plastic-chair': 4 });
  assert.match(state.message, /4 objects did not fit and went to storage/);
  assert.equal(viewLife(state, ctx).home.stored, 4);
  assert.equal(act(state, 'home.furniture-place', { item: 'plastic-chair', x: 0, y: 0, rot: 0 }).code, 'occupied');
  assert.equal(act(state, 'home.furniture-sell', { item: 'plastic-chair' }).code, 'sold');
  assert.equal(state.home.storage['plastic-chair'], 3); assert.equal(state.cash, 10000 - 7200 + 250);
  act(state, 'home.furniture-sell', { id: need(state.home.items[0]).id });
  assert.equal(act(state, 'home.furniture-place', { item: 'plastic-chair', x: 0, y: 0, rot: 0 }).code, 'placed');
  assert.equal(state.home.storage['plastic-chair'], 2);
  assert.deepEqual(fitInto(6, [{ id: 'f1', itemId: 'king-bed', x: 5, y: 5, rot: 0 }]).items, [{ id: 'f1', itemId: 'king-bed', x: 0, y: 0, rot: 0 }]);
});

test('cars: buy, drive, switch and sell; an owned car adds a fuel-only travel mode', () => {
  const state = createLife({ cash: 2000000 }, ctx);
  const modes = [{ id: 'trek', fare: 0 }, { id: 'cab', fare: 400 }];
  assert.deepEqual(modifyModes(state, 'travel.modes', modes, {}, ctx), modes, 'no car: modes unchanged');
  assert.equal(modify(state, 'travel.fare', 400, trip('car'), ctx), 400);
  const heard: unknown[] = [];
  const probe = system('goals');
  probe.on = { ...(probe.on || {}), 'car.bought': (s, data) => { heard.push(data); } };
  try {
    assert.equal(act(state, 'property.car-buy', { id: 'agama-150' }).code, 'bought');
    assert.deepEqual(heard, [{ id: 'agama-150', price: 350000 }]);
  } finally { delete need(probe.on)['car.bought']; }
  assert.equal(state.cash, 1650000); assert.equal(need(state.ledger.at(-1)).reason, 'Bought Agama 150 Motorbike');
  assert.deepEqual(state.property, { house: 'yaba', cars: ['agama-150'], car: 'agama-150' });
  assert.equal(act(state, 'property.car-buy', { id: 'agama-150' }).code, 'already_owned');
  const poor = act(state, 'property.car-buy', { id: 'marina-v6' }); assert.equal(poor.code, 'insufficient_funds'); assert.match(why(poor), /₦3,000,000/);
  for (const id of ['tank', '__proto__', null]) assert.equal(act(state, 'property.car-buy', { id }).code, 'invalid_car');
  // Travel hooks: the list form and the map form both gain a 'car' mode; fare is fuel only; time shrinks.
  const list = modifyModes(state, 'travel.modes', modes, {}, ctx);
  assert.ok(Array.isArray(list));
  assert.deepEqual(list.at(-1), { id: 'car', label: 'Drive · Agama 150 Motorbike', icon: '🏍️', fare: 30, fuelOnly: true, car: 'agama-150' });
  assert.equal(modes.length, 2, 'the base list is not mutated');
  const mapped = modifyModes(state, 'travel.modes', { trek: { id: 'trek', fare: 0 } }, {}, ctx);
  assert.ok(isRecord(mapped) && isRecord(mapped.car));
  assert.equal(mapped.car.fare, 30);
  assert.equal(modify(state, 'travel.fare', 400, trip('car'), ctx), 30);
  assert.equal(modify(state, 'travel.fare', 400, trip('cab'), ctx), 400);
  assert.equal(modify(state, 'travel.duration', 20, trip('car'), ctx), 15);
  assert.equal(modify(state, 'travel.duration', 20, trip('danfo'), ctx), 20);
  assert.equal(act(state, 'property.car-buy', { id: 'tokunbo-saloon' }).code, 'bought');
  assert.equal(state.property.car, 'tokunbo-saloon'); assert.equal(modify(state, 'travel.fare', 0, trip('car'), ctx), 60);
  assert.equal(act(state, 'property.car-use', { id: 'agama-150' }).code, 'selected'); assert.equal(state.property.car, 'agama-150');
  assert.equal(act(state, 'property.car-use', { id: 'marina-v6' }).code, 'not_owned');
  const cash = state.cash;
  assert.equal(act(state, 'property.car-sell', { id: 'agama-150' }).code, 'sold');
  assert.equal(state.cash, cash + 210000); assert.equal(state.property.car, 'tokunbo-saloon');
  assert.equal(act(state, 'property.car-sell', { id: 'agama-150' }).code, 'not_owned');
  const view = viewLife(state, ctx).property;
  assert.equal(need(view.car).id, 'tokunbo-saloon'); assert.equal(need(view.cars.find((car) => car.id === 'tokunbo-saloon')).driving, true);
  assert.match(need(need(view.cars.find((car) => car.id === 'marina-v6')).blocked), /^Need ₦/);
  // Saved cars survive a reload.
  assert.deepEqual(createLife(JSON.parse(JSON.stringify(state)), ctx).property, state.property);
});
