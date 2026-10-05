import { localUnitDescription } from './cities/runtime.ts';
import { allCityLinks, cityRules, loadCityContent as preloadCityContent } from './cities/registry.ts';
await Promise.all(['lagos', 'ibadan'].map(preloadCityContent));
// OWNER: world — the house everyone has, local governments, styles, upgrades and travel between cities.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLife, dispatch, advanceLife, viewLife } from '../life.ts';
import { hasPlace } from './systems/estate.ts';
import { makeContext, isRecord } from './util.ts';
import type { ActionBody } from '../types/actions.ts';
import type { ActionOutcome, LifeContext, LifeContextInit, LifeState, WorldCityId } from '../types/life.ts';
import { HOUSES } from './content/housing.ts';
import { ESTATE, HOUSE_STYLE, HOUSE_TIERS, LAGOS_LGAS, LGA_CAPACITY, LGA_RULES, STYLE_FIELDS, TIER_ORDER, addressKey, addressLabel, cleanStyle, lgaOf, lgaOfDistrict, moveLevy, packStyle, stylePrice, tierCost, unpackStyle } from './content/world.ts';

const MONDAY_9AM = Date.UTC(2026, 0, 5, 8), DAY = 86400000;
const at = (now = MONDAY_9AM, seed = 'estate', extra: LifeContextInit = {}): LifeContext => makeContext({ now, cityId: 'lagos', seed, ...extra });
/** A value a test needs to be there: fails the test, with a message, instead of being read as `undefined`/`null`. */
const found = <T>(value: T | null | undefined, what: string): T => { assert.ok(value !== null && value !== undefined, `${what} exists`); return value; };
/** The reason a refused action gave. */
const reasonOf = (result: ActionOutcome): string => { assert.equal(result.ok, false); return found(result.ok ? undefined : result.reason, 'a reason'); };
// Payloads here include deliberately wrong ones (an unknown local government, extra fields a client might send), so the typed
// action body is crossed once, here: the engine's own validation is what is being tested.
const act = (state: LifeState, type: string, payload: object, ctx: LifeContext = at()): ActionOutcome => dispatch(state, { type, payload } as unknown as ActionBody, ctx);
const LOOK = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' };
/**
 * A life taken through creation (which knows nothing of local governments), then — as the settle-in
 * card does — given its local government and, with `own`, moved into the house that comes with it.
 */
function onboard({ house = 'yaba', lga = null, own = false, via }: { house?: string; lga?: string | null; own?: boolean; via?: string } = {}, outcome = 'lapo-baby') {
  const state = createLife(null, at(MONDAY_9AM, 'new', { isNew: true, requireOnboarding: true }));
  act(state, 'onboarding.look', { look: LOOK }); act(state, 'onboarding.traits', { traits: ['musical', 'tech-bro-or-sis'] }); act(state, 'onboarding.dream', { dream: 'yaba-unicorn' });
  for (let i = 0; i < 500 && state.onboarding.lottery?.id !== outcome; i++) { state.onboarding.lottery = null; act(state, 'onboarding.lottery', {}, at(MONDAY_9AM, `roll-${i}`)); }
  let result = act(state, 'onboarding.home', { house });
  if (lga) result = act(state, 'estate.set-lga', { lga, ...(via ? { via } : {}) });
  if (own) result = act(state, 'estate.move-in', {});
  return { state, result };
}
/** cash = what the life was seeded with + every ledger line: no naira from nowhere. */
const conserved = (state: LifeState, seed: number) => assert.equal(state.cash, seed + state.ledger.reduce((sum, line) => sum + line.amount, 0));
const settle = (state: LifeState, to: number) => advanceLife(state, (to - state.t) / 1000, at(to, `settle-${to}`));

test('the twenty local governments of Lagos: ids, prices and capacity are data; addresses are deterministic', () => {
  assert.equal(LAGOS_LGAS.length, 20);
  assert.equal(new Set(LAGOS_LGAS.map((lga) => lga.id)).size, 20);
  for (const name of ['Agege', 'Ajeromi-Ifelodun', 'Alimosho', 'Amuwo-Odofin', 'Apapa', 'Badagry', 'Epe', 'Eti-Osa', 'Ibeju-Lekki', 'Ifako-Ijaiye', 'Ikeja', 'Ikorodu', 'Kosofe', 'Lagos Island', 'Lagos Mainland', 'Mushin', 'Ojo', 'Oshodi-Isolo', 'Somolu', 'Surulere']) assert.ok(LAGOS_LGAS.some((lga) => lga.name === name), name);
  for (const lga of LAGOS_LGAS) { assert.equal(lga.beta, true); assert.ok(lga.land >= 60000 && localUnitDescription('lagos', lga.id).length > 10); }
  // The rented-home districts map onto local governments, so an old save has one.
  assert.deepEqual(Object.keys(HOUSES).map((id) => lgaOfDistrict('lagos', id)?.id), ['mushin', 'lagos-mainland', 'eti-osa', 'eti-osa', 'eti-osa']);
  assert.equal(LGA_CAPACITY, 100352);
  assert.equal(addressKey('ikeja', 41, 2 * ESTATE.plots + 6), 'ikeja/41/2/6');
  assert.equal(addressLabel('lagos', 'ikeja', 41, 2 * ESTATE.plots + 6), 'Plot 7, Street 3, Estate 42, Ikeja');
  // Dear land makes building dear; the plot itself is free.
  const bqCost = (lga: string) => found(tierCost('lagos', lga, 'bq'), `a price in ${lga}`);
  assert.ok(bqCost('eti-osa') > bqCost('ikeja') && bqCost('ikeja') > bqCost('badagry'));
  assert.equal(tierCost('lagos', 'badagry', 'starter'), 0);
  assert.equal(moveLevy('lagos', 'eti-osa', 'badagry', 'villa'), 0);
});

test('a house style is a few small numbers: it packs into one integer and back, and only priced options cost', () => {
  for (const field of STYLE_FIELDS) assert.ok(HOUSE_STYLE[field].length >= 2 && !found(HOUSE_STYLE[field][0], `${field} default`).price, `${field} has a free default`);
  const style = { shape: 3, wall: 7, roof: 5, door: 2, windows: 3, fence: 1, yard: 6, sign: 1 };
  for (const tier of TIER_ORDER) assert.deepEqual(unpackStyle(packStyle(style, tier)), { tier, style });
  assert.ok(packStyle(style, 'villa') < 2 ** 21);
  assert.deepEqual(cleanStyle({ shape: 99, wall: -1, roof: 'x', door: 1.5 }), { shape: 0, wall: 0, roof: 0, door: 0, windows: 0, fence: 0, yard: 0, sign: 0 });
  assert.deepEqual(unpackStyle(-5), unpackStyle(0));
  assert.equal(stylePrice(cleanStyle({}), cleanStyle({ wall: 1, roof: 2, door: 3 })), 0);
  assert.equal(stylePrice(cleanStyle({}), style), 8000 + 1000 + 1000 + 1500 + 2000 + 3500);
});

test('settling in: a new life has no place until it chooses a local government; the choice is an id and nothing else; its own house has no rent', () => {
  // Creation is untouched by all this: it ends with a rented home and only a GUESS at the local government.
  const fresh = createLife(null, at(MONDAY_9AM, 'new', { isNew: true, requireOnboarding: true }));
  assert.equal(hasPlace(fresh), false, 'a life still being created belongs nowhere');
  assert.equal(act(fresh, 'estate.set-lga', { lga: 'ikeja' }).code, 'onboarding_required');
  const { state: guest } = onboard({ house: 'mushin' });
  assert.deepEqual([guest.estate.lga, guest.estate.lgaConfirmed, guest.estate.lgaVia, hasPlace(guest), viewLife(guest, at()).estate.placed], ['mushin', false, 'default', false, false]);
  assert.equal(act(guest, 'estate.set-lga', { lga: 'atlantis' }).code, 'invalid_lga');
  // The choice: a server-validated id. Coordinates a client sends along are not kept anywhere.
  const chosen = act(guest, 'estate.set-lga', { lga: 'ikeja', via: 'device', lat: 6.6, lon: 3.35, position: { latitude: 6.6, longitude: 3.35 } });
  assert.equal(chosen.code, 'lga_set');
  assert.deepEqual([guest.estate.lga, guest.estate.lgaConfirmed, guest.estate.lgaVia, hasPlace(guest)], ['ikeja', true, 'device', true]);
  assert.ok(!/6\.6|3\.35|latitude|position/.test(JSON.stringify(guest)));
  assert.equal(guest.economy.rent.house, 'mushin', 'still a tenant until they move into their own house');
  // Moving into the house that came with the plot: free, the starter room, and no weekly rent from then on.
  const { state: own, result } = onboard({ house: 'mushin', lga: 'alimosho', own: true });
  assert.equal(result.code, 'moved_in');
  assert.deepEqual([own.estate.living, own.estate.tier, own.economy.rent.house, own.cash], ['own', 'starter', null, 76000]);
  assert.equal(viewLife(own, at()).economy.rent, null);
  assert.equal(own.home.items.every((item) => item.x < HOUSE_TIERS.starter.grid && item.y < HOUSE_TIERS.starter.grid), true);
  const before = own.cash;
  settle(own, MONDAY_9AM + 6 * DAY);
  assert.equal(own.ledger.some((line) => /Rent/.test(line.reason)), false);
  assert.equal(own.cash, before - 12000, 'the loan instalment is still collected; rent is not');
  conserved(own, 5000);
});

test('an old save gets a local government from its home district and keeps everything else', () => {
  const legacy = createLife({ name: 'Old', cash: 12345, property: { house: 'lekki', cars: [], car: null }, location: 'home' }, at(MONDAY_9AM, 'old'));
  assert.deepEqual([legacy.estate.lga, legacy.estate.lgaConfirmed, legacy.estate.living, legacy.estate.tier, legacy.cash, legacy.property.house], ['eti-osa', false, 'rent', 'starter', 12345, 'lekki']);
  assert.equal(hasPlace(legacy), true, 'a life from before local governments has the one its home lies in, and a house there');
  assert.deepEqual(createLife(legacy, at(MONDAY_9AM, 'old')), legacy, 'sanitize is stable');
  // Confirming the guess is free and starts no cooldown problem; choosing another one right after is the one free change.
  assert.equal(act(legacy, 'estate.set-lga', { lga: 'eti-osa' }).code, 'lga_confirmed');
  assert.equal(act(legacy, 'estate.set-lga', { lga: 'eti-osa' }).code, 'unchanged');
});

test('changing local government: once every seven days, and an upgraded house pays the difference to move to dearer land', () => {
  const { state } = onboard({ house: 'mushin', own: true, lga: 'badagry' });
  assert.equal(act(state, 'estate.set-lga', { lga: 'nowhere' }).code, 'invalid_lga');
  const refused = act(state, 'estate.set-lga', { lga: 'ikeja' });
  assert.equal(refused.code, 'lga_cooldown'); assert.match(reasonOf(refused), /once every 7 days.*7 days/);
  const later = MONDAY_9AM + LGA_RULES.changeCooldownDays * DAY;
  settle(state, later);
  assert.equal(act(state, 'estate.set-lga', { lga: 'ikeja' }, at(later)).code, 'lga_set');
  assert.equal(state.ledger.some((line) => /Moving your/.test(line.reason)), false, 'a starter house moves free');
  // With a bigger house the levy is the difference in its price between the two places.
  state.estate.tier = 'bq';
  const again = later + LGA_RULES.changeCooldownDays * DAY;
  settle(state, again);
  const cash = state.cash, levy = moveLevy('lagos', 'ikeja', 'eti-osa', 'bq');
  assert.ok(levy > 0);
  assert.equal(act(state, 'estate.set-lga', { lga: 'eti-osa' }, at(again)).code, 'lga_set');
  assert.equal(state.cash, cash - levy);
  conserved(state, 5000);
});

test('the server-only plot assignment: refused to a player, idempotent, and the plot left behind is remembered once', () => {
  const { state } = onboard({ house: 'mushin', own: true, lga: 'ikeja' });
  assert.equal(act(state, 'estate.assign', { lga: 'ikeja', estate: 0, plot: 3 }).code, 'server_only');
  const server = at(MONDAY_9AM, 'server', { internal: true });
  assert.equal(act(state, 'estate.assign', { lga: 'mushin', estate: 0, plot: 3 }, server).code, 'invalid_plot', 'only in the life’s own local government');
  assert.equal(act(state, 'estate.assign', { lga: 'ikeja', estate: 512, plot: 0 }, server).code, 'invalid_plot');
  assert.equal(act(state, 'estate.assign', { lga: 'ikeja', estate: 0, plot: 3 }, server).code, 'assigned');
  assert.equal(act(state, 'estate.assign', { lga: 'ikeja', estate: 0, plot: 3 }, server).code, 'unchanged');
  assert.deepEqual([state.estate.plot, state.estate.old], [{ lga: 'ikeja', estate: 0, plot: 3 }, null]);
  assert.equal(found(viewLife(state, at()).estate.plot, 'a plot').address, 'Plot 4, Street 1, Estate 1, Ikeja');
  state.estate.lga = 'mushin';
  act(state, 'estate.assign', { lga: 'mushin', estate: 2, plot: 9 }, server);
  assert.deepEqual(state.estate.old, { lga: 'ikeja', estate: 0, plot: 3 });
  act(state, 'estate.released', { lga: 'ikeja', estate: 0, plot: 3 }, server);
  assert.equal(state.estate.old, null);
});

test('styling: free options cost nothing, priced ones are charged through the ledger, bad values are refused', () => {
  const { state } = onboard({ house: 'mushin', own: true, lga: 'ikeja' });
  const cash = state.cash;
  assert.equal(act(state, 'estate.style', { style: { wall: 2, roof: 1, door: 3 } }).code, 'styled');
  assert.equal(state.cash, cash);
  assert.equal(act(state, 'estate.style', { style: { wall: 2 } }).code, 'unchanged');
  assert.equal(act(state, 'estate.style', { style: { wall: 99 } }).code, 'invalid_style');
  assert.equal(act(state, 'estate.style', { style: { shape: 2, fence: 3 } }).code, 'styled');
  assert.equal(state.cash, cash - 5000 - 4000);
  assert.equal(state.ledger.at(-1)?.reason, 'House styling');
  assert.equal(viewLife(state, at()).estate.packed, packStyle(state.estate.style, 'starter'));
  state.cash = 0; state.ledger = []; // (a broke life for the refusal)
  const broke = createLife({ ...state, cash: 100 }, at());
  assert.equal(act(broke, 'estate.style', { style: { yard: 6 } }).code, 'insufficient_funds');
});

test('upgrading with a local government outside the active city is refused, not thrown, and costs nothing', () => {
  const { state } = onboard({ house: 'mushin', own: true, lga: 'badagry' }, 'ajebutter');
  const cash = state.cash;
  state.estate.city = 'ibadan' as typeof state.estate.city; // Badagry is not an Ibadan local government
  const refused = act(state, 'estate.upgrade', { to: 'bq' });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'insufficient_funds', 'the refusal the action already has for a house that cannot be paid for');
  assert.deepEqual([state.cash, state.estate.upgrade], [cash, null]);
});

test('upgrading: paid once, built on server time even while away, then ground rent on Saturdays; the room grows without losing furniture', () => {
  const { state } = onboard({ house: 'mushin', own: true, lga: 'badagry' }, 'ajebutter');
  const seed = 5000, cost = found(tierCost('lagos', 'badagry', 'bq'), 'a price'), cash = state.cash;
  assert.equal(act(state, 'estate.upgrade', { to: 'starter' }).code, 'not_an_upgrade');
  assert.equal(act(state, 'estate.upgrade', { to: 'palace' }).code, 'invalid_tier');
  assert.equal(act(state, 'estate.upgrade', { to: 'bq' }).code, 'upgrade_started');
  assert.equal(state.cash, cash - cost);
  assert.equal(act(state, 'estate.upgrade', { to: 'bungalow' }).code, 'upgrade_running');
  assert.equal(act(state, 'estate.set-lga', { lga: 'epe' }).code, 'lga_cooldown');
  const view = viewLife(state, at(MONDAY_9AM + 300000)).estate;
  const upgrade = found(view.upgrade, 'an upgrade in view');
  assert.deepEqual([upgrade.to, upgrade.remaining, Math.round(upgrade.progress * 100)], ['bq', 300, 50]);
  assert.equal(state.estate.tier, 'starter');
  const items = state.home.items.length;
  // The player closes the game; an hour later the server settles the life: the house is finished.
  settle(state, MONDAY_9AM + 3600000);
  assert.deepEqual([state.estate.tier, state.estate.upgrade], ['bq', null]);
  assert.equal(state.home.items.length, items);
  assert.match(found(state.social.notices.findLast((notice) => notice.kind === 'house'), 'a house notice').text, /Two-room house .* is finished/);
  // Saturday: ground rent, by its own ledger line; never weekly rent.
  settle(state, MONDAY_9AM + 6 * DAY);
  assert.equal(state.ledger.filter((line) => line.reason === 'Ground rent: Two-room house').length, 1);
  assert.equal(state.ledger.at(-1)?.amount, -HOUSE_TIERS.bq.groundRent);
  conserved(state, seed);
  assert.deepEqual(createLife(state, at(state.t)), state, 'nothing in the slice is lost at the next load');
});

test('renting stays a choice: moving to a rented home restarts the weekly rent, moving back into your own house stops it; furniture is kept', () => {
  const { state } = onboard({ house: 'mushin', own: true, lga: 'ikeja' }, 'ajebutter');
  assert.equal(act(state, 'estate.move-in', {}).code, 'already_home');
  assert.equal(act(state, 'property.house-move', { id: 'yaba' }).code, 'moved');
  assert.deepEqual([state.estate.living, state.economy.rent.house, state.property.house], ['rent', 'yaba', 'yaba']);
  const placed = state.home.items.length + Object.values(state.home.storage).reduce((sum, count) => sum + count, 0);
  assert.equal(act(state, 'estate.move-in', {}).code, 'moved_in');
  assert.deepEqual([state.estate.living, state.economy.rent.house], ['own', null]);
  assert.equal(state.home.items.length + Object.values(state.home.storage).reduce((sum, count) => sum + count, 0), placed, 'what does not fit the smaller room is in storage, not gone');
  assert.equal(state.home.items.every((item) => item.x < 6 && item.y < 6), true);
  // The same tier can be rented again later: it is no longer "where you already live".
  assert.equal(act(state, 'property.house-move', { id: 'yaba' }).code, 'moved');
  conserved(state, 5000);
});

test('cities connect as data, while a trip to closed Abuja is refused without charging', () => {
  for (const id of ['lagos', 'ibadan', 'abeokuta', 'ota', 'ijebu-ode', 'sagamu', 'port-harcourt', 'abuja', 'kano'] satisfies WorldCityId[]) assert.equal(cityRules(id)?.status, 'open');
  const soon: WorldCityId[] = ['aba', 'owerri', 'kaduna'];
  for (const id of soon) { const city = cityRules(id); assert.ok(city, 'registered city'); assert.equal(city.status, 'soon'); }
  for (const link of allCityLinks()) { assert.ok(cityRules(link.a) && cityRules(link.b) && ['road', 'rail', 'air'].includes(link.mode) && link.fare > 0 && link.seconds >= 30 && link.seconds <= 600 && link.beta); }
  const { state } = onboard({ house: 'mushin', own: true, lga: 'ikeja' }, 'ajebutter');
  const cash = state.cash;
  state.estate.city = 'port-harcourt';
  const refused = act(state, 'estate.relocate', { to: 'owerri', mode: 'road' });
  assert.equal(refused.code, 'city_not_open'); assert.match(reasonOf(refused), /Owerri is not open yet/);
  state.estate.city = 'lagos';
  assert.equal(act(state, 'estate.relocate', { to: 'ibadan', mode: 'air' }).code, 'no_route');
  assert.equal(act(state, 'estate.relocate', { to: 'lagos', mode: 'road' }).code, 'invalid_city');
  assert.equal(state.cash, cash); assert.equal(state.activeAction, null);
  const links = viewLife(state, at()).estate.links;
  assert.equal(links.length, 12)
  assert.deepEqual(links.filter((link) => link.to === 'ibadan').map((link) => [link.mode, link.open, link.blocked]), [['road', true, null], ['rail', true, null]])
  const openCities = new Set(['ibadan', 'abeokuta', 'ota', 'ijebu-ode', 'sagamu', 'port-harcourt', 'abuja', 'kano']);
  assert.equal(links.filter((link) => openCities.has(link.to)).every((link) => link.open), true);
  assert.equal(links.filter((link) => !openCities.has(link.to)).every((link) => !link.open && /not open yet/.test(found(link.blocked, 'a blocked reason'))), true);
});

test('one character between cities: money, skills and people travel; the home left behind is kept and found again on return', () => {
  const { state } = onboard({ house: 'mushin', own: true, lga: 'ikeja' }, 'ajebutter');
  const server = at(MONDAY_9AM, 'server', { internal: true });
  act(state, 'estate.assign', { lga: 'ikeja', estate: 4, plot: 20 }, server);
  act(state, 'estate.style', { style: { wall: 3 } });
  // The slice is { skill: xp }, so an object under 'tech' (not even a SkillId) is not the real shape; kept as the original test wrote it.
  const skillBag: Record<string, unknown> = state.skills;
  skillBag.tech = { ...(isRecord(skillBag.tech) ? skillBag.tech : {}), level: 3 };
  const skills = structuredClone(state.skills), cash = state.cash, look = structuredClone(state.onboarding.look);
  assert.equal(act(state, 'estate.relocate', { to: 'ibadan', mode: 'road' }, at(MONDAY_9AM, 'go')).code, 'departed');
  assert.equal(state.cash, cash - 3500);
  assert.equal(act(state, 'cancel', {}).code, 'no_cancel');
  assert.deepEqual([state.activeAction?.kind, state.estate.city], ['intercity', 'lagos']);
  settle(state, MONDAY_9AM + 121000);
  assert.deepEqual([state.estate.city, state.location, state.activeAction, state.estate.plot, state.estate.lga], ['ibadan', 'agodi-gardens', null, null, null]);
  assert.equal(hasPlace(state), false, 'a first arrival is a visitor until a local government is chosen');
  assert.deepEqual(found(state.estate.away.lagos, 'the home left in lagos').plot, { lga: 'ikeja', estate: 4, plot: 20 });
  assert.equal(found(state.estate.away.lagos, 'the home left in lagos').style.wall, 3);
  assert.deepEqual([state.skills, state.onboarding.look, state.cash], [skills, look, cash - 3500]);
  // The stored state survives a load in its new city, and comes home to exactly what was left.
  const reloaded = createLife(state, makeContext({ now: state.t, cityId: 'ibadan', seed: 'load' }));
  assert.deepEqual(reloaded.estate, state.estate);
  const back = makeContext({ now: state.t, cityId: 'ibadan', seed: 'back' });
  assert.equal(dispatch(reloaded, { type: 'estate.relocate', payload: { to: 'lagos', mode: 'road' } }, back).code, 'departed');
  advanceLife(reloaded, 121, makeContext({ now: reloaded.t + 121000, cityId: 'ibadan', seed: 'home' }));
  assert.deepEqual([reloaded.estate.city, reloaded.estate.lga, reloaded.estate.plot, reloaded.estate.style.wall, reloaded.estate.living], ['lagos', 'ikeja', { lga: 'ikeja', estate: 4, plot: 20 }, 3, 'own']);
  assert.ok(reloaded.estate.away.ibadan);
  conserved(reloaded, 5000);
});

test('hostile saves: every field of the slice is rebuilt or dropped', () => {
  const hostile = createLife({ estate: { city: 'mars', lga: '__proto__', lgaAt: 1e30, lgaConfirmed: 'yes', plot: { lga: 'ikeja', estate: -1, plot: 1e9 }, old: 'x', tier: 'palace', style: { wall: 400, roof: null },
    upgrade: { to: 'villa', cost: -5, startedAt: 0, doneAt: 1e30 }, living: 'hotel', ground: { week: 1e30, arrears: -4 }, away: { mars: {}, lagos: {}, abuja: { tier: 'villa', plot: { lga: 'x', estate: 0, plot: 0 } }, ibadan: { tier: 'villa', plot: { lga: 'x', estate: 0, plot: 0 } } }, nudged: 1 } }, at());
  const e = hostile.estate;
  assert.deepEqual([e.city, e.lga, e.lgaAt, e.lgaConfirmed, e.plot, e.old, e.tier, e.upgrade, e.living, e.ground, e.nudged], ['lagos', 'lagos-mainland', null, false, null, null, 'starter', null, 'rent', { week: null, arrears: 0 }, false]);
  assert.deepEqual(Object.keys(e.away).sort(), ['abuja', 'ibadan'], 'known legacy homes remain; unregistered and atlas-only labels are not residences'); assert.equal(found(e.away.ibadan, 'a legacy Ibadan residence').plot, null);
  assert.equal(lgaOf('lagos', 'constructor'), null);
  // An upgrade can never be made to last longer than its tier allows.
  const long = createLife({ estate: { lga: 'ikeja', upgrade: { to: 'bq', cost: 60000, startedAt: MONDAY_9AM - 1000, doneAt: MONDAY_9AM + 1e12 } } }, at());
  const longUpgrade = found(long.estate.upgrade, 'an upgrade');
  assert.equal(longUpgrade.doneAt, longUpgrade.startedAt + HOUSE_TIERS.bq.buildSeconds * 1000);
});
