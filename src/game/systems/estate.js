/**
 * OWNER: world
 * Where a life lives in the wider sense: its city, its local government, the house everyone has
 * on a plot there, how that house looks and how big it is, and moving between cities.
 * Content and prices: ../content/world.js (all original beta values).
 *
 * EVERYONE HAS A HOUSE. Each life is given one plot in its local government, free, with the
 * starter house on it — from the moment it HAS a local government: a new life chooses one with
 * 'estate.set-lga' when it settles in (the card in src/ui/panels/lga-card.js), and until then it has
 * no house and belongs nowhere (hasPlace below). A life from before local governments existed keeps
 * the one its home district lies in. The server allocates the plot (server/world/service.js) and
 * records it here with the server-only 'estate.assign'. A player can live in that house (no weekly rent) or rent
 * one of the housing tiers (content/housing.js) and keep the plot; either way the house stands on
 * the map at its address.
 *
 * STATE — state.estate
 *   city          the city this character is in (the id its life is stored under)
 *   lga           id of the local government the life belongs to, or null in a city that has none
 *   lgaAt         server ms the local government was last chosen or changed, or null
 *   lgaConfirmed  false while `lga` is only the game's guess from the home district (a life from
 *                 before local governments existed, or a creation that skipped the choice)
 *   lgaVia        'device' (found on the player's device from its position — the position itself
 *                 never reaches the server), 'manual' (picked from the list) or 'default'
 *   plot          null | { lga, estate, plot } — the address the server allocated. Null only until
 *                 the server has done so (moments after creation, or the first load of an old life)
 *   old           null | { lga, estate, plot } — the address left behind by a change of local
 *                 government, kept so the server can free that plot exactly once
 *   tier          id of HOUSE_TIERS: the size of the house ('starter' for everyone at first)
 *   style         { shape, wall, roof, door, windows, fence, yard, sign } — indexes into HOUSE_STYLE
 *   upgrade       null | { to, cost, startedAt, doneAt } — an upgrade being built. It finishes when
 *                 the server clock passes doneAt, whether or not the player is around
 *   living        'own' | 'rent' — which home Home is. While 'own' no weekly rent is charged and
 *                 the room is the tier's grid; state.property.house keeps the last rented tier
 *   ground        { week, arrears } — ground-rent billing: the last Saturday settled, and what is owed
 *   away          { [cityId]: residence } — homes kept in other cities: your Lagos house stays yours
 *   nudged        the "you can afford an upgrade" notice has been posted
 *
 * ACTIONS (every refusal names what is missing)
 *   'estate.set-lga'   { lga, via? }   confirm or change the local government. Confirming the
 *                      game's guess, or choosing for the first time, is free and immediate; after
 *                      that a change is allowed once every LGA_RULES.changeCooldownDays days. The
 *                      house moves with you to a new plot there; taking an upgraded house to a
 *                      dearer local government costs the difference in its price (moveLevy).
 *   'estate.assign'    SERVER-ONLY { lga, estate, plot }: record the plot the server allocated.
 *   'estate.style'     { style }       change the look. Free options are free; a priced option is
 *                      charged each time a field is changed to it.
 *   'estate.upgrade'   { to }          pay for a bigger house; it is built over the tier's
 *                      buildSeconds of server time. One upgrade at a time, upwards only.
 *   'estate.move-in'   {}              live in your own house: free. Furniture moves with you;
 *                      what does not fit goes to storage. Weekly rent stops.
 *   'estate.relocate'  { to, mode }    travel to another city along a CITY_LINKS link. Refused,
 *                      with the reason, while the destination is not open.
 *   Moving from your own house to a rented one is the Houses app's 'property.house-move'.
 *
 * EMITS   'home.owned' { living, house }   the home changed between rented and owned (economy.js
 *                                          stops or restarts the weekly rent)
 *         'house.moved' { id: 'own' | houseId, from, cost: 0 }   so furniture is re-fitted
 *         'house.upgraded' { tier } · 'lga.changed' { lga } · 'city.changed' { from, to }
 *         'notice.posted' { kind: 'house' | 'ground-rent', text }
 * LISTENS 'life.started' { house, lga?, via?, own? }  ·  'house.moved' { id }
 *
 * TIMED ACTION 'intercity' (moves: true): the trip between two cities. It cannot be cancelled once
 * the fare is paid. On arrival the residence of the city left is put away, the one of the city
 * reached is taken out (or a fresh one is started), and estate.city changes; the server then files
 * the life under its new city (server/world/character.js).
 */
import { emit } from '../registry.js';
import { busy, fail, finite, isRecord, naira, ok, safeCount } from '../util.js';
import { lagosTime } from '../clock.js';
import { arrive, canAfford, credit, debit } from '../api.js';
import { HOUSES, HOUSE_ORDER, DEFAULT_HOUSE } from '../content/housing.js';
import { CITY_RULES, DEFAULT_STYLE, HOUSE_STYLE, HOUSE_TIERS, LGA_RULES, OWNING, STYLE_FIELDS, TIER_ORDER, addressKey, addressLabel, cheapestUpgrade, cityRules, cleanStyle,
  lgaOf, lgaOfDistrict, lgasOf, linksFrom, moveLevy, packStyle, stylePrice, tierCost, tierOf, validPlot } from '../content/world.js';

const DAY_MS = 86400000;
/** A life still held for its look, or a guest of the quick start: it has not settled in (systems/onboarding.js THE STAGED MODEL). */
const unsettled = (state) => { const o = state?.onboarding; return Boolean(o) && o.done !== true && (o.required === true || o.stage === 'guest'); };
const MAX_CATCHUP_WEEKS = 4;
const VIAS = ['device', 'manual', 'default'];
const nowOf = (state, ctx) => (finite(ctx?.now) ? ctx.now : state.t);
/** The billing week: it increases by one at every Saturday 00:00 Lagos time (the same rule as the weekly rent). */
const billingWeek = (ms) => Math.floor((lagosTime(ms).day - 2) / 7);
const note = (state, kind, text, ctx) => emit(state, 'notice.posted', { kind, text }, ctx);
const rentedHouse = (state) => (Object.hasOwn(HOUSES, state.property?.house) ? state.property.house : DEFAULT_HOUSE);
const where = (e) => (e.plot ? addressLabel(e.city, e.plot.lga, e.plot.estate, e.plot.plot) : `${lgaOf(e.city, e.lga)?.name ?? 'your local government'} (plot being allocated)`);

function defaultLga(cityId, state) {
  const units = lgasOf(cityId);
  if (!units.length) return null;
  return (lgaOfDistrict(cityId, rentedHouse(state)) ?? units[0]).id;
}
const cleanPlot = (value, cityId) => (isRecord(value) && lgaOf(cityId, value.lga) && validPlot(value.estate, value.plot) ? { lga: value.lga, estate: value.estate, plot: value.plot } : null);

function cleanResidence(value, cityId, now) {
  const saved = isRecord(value) ? value : {};
  const unit = lgaOf(cityId, saved.lga);
  const tier = tierOf(saved.tier) ?? HOUSE_TIERS.starter;
  const up = isRecord(saved.upgrade) ? saved.upgrade : null, to = up ? tierOf(up.to) : null;
  let upgrade = null;
  if (to && to.rank > tier.rank && safeCount(up.cost) && finite(up.startedAt) && finite(up.doneAt)) {
    const startedAt = Math.max(0, Math.min(up.startedAt, now));
    // An upgrade never runs longer than its tier allows, whatever a save claims.
    upgrade = { to: to.id, cost: Math.min(up.cost, 1e9), startedAt, doneAt: Math.max(startedAt, Math.min(up.doneAt, startedAt + to.buildSeconds * 1000)) };
  }
  const ground = isRecord(saved.ground) ? saved.ground : {};
  const plot = cleanPlot(saved.plot, cityId);
  return {
    lga: unit?.id ?? null,
    lgaAt: unit && finite(saved.lgaAt) && saved.lgaAt >= 0 ? Math.min(saved.lgaAt, now) : null,
    lgaConfirmed: Boolean(unit) && saved.lgaConfirmed === true,
    lgaVia: unit && VIAS.includes(saved.lgaVia) ? saved.lgaVia : 'default',
    plot, old: cleanPlot(saved.old, cityId),
    tier: tier.id, style: cleanStyle(saved.style), upgrade,
    living: saved.living === 'own' ? 'own' : 'rent',
    ground: { week: Number.isSafeInteger(ground.week) ? Math.min(ground.week, billingWeek(now)) : null, arrears: safeCount(ground.arrears) ? Math.min(ground.arrears, 1e7) : 0 },
  };
}

function sanitize(input, state, ctx) {
  const saved = isRecord(input.estate) ? input.estate : {};
  const now = Math.max(finite(ctx?.now) ? ctx.now : 0, state.t);
  const city = cityRules(saved.city)?.id ?? cityRules(ctx?.cityId)?.id ?? 'lagos';
  const home = cleanResidence(saved, city, now);
  if (!home.lga) Object.assign(home, { lga: defaultLga(city, state), lgaAt: null, lgaConfirmed: false, lgaVia: 'default' });
  const away = {};
  if (isRecord(saved.away)) {
    for (const [id, value] of Object.entries(saved.away).slice(0, 16)) {
      if (!cityRules(id) || id === city) continue;
      away[id] = { ...cleanResidence(value, id, now), house: Object.hasOwn(HOUSES, value?.house) ? value.house : DEFAULT_HOUSE };
    }
  }
  state.estate = { city, ...home, away, nudged: saved.nudged === true };
}

// ---- actions ---------------------------------------------------------------------------------

function setLga(state, payload, ctx) {
  const e = state.estate, now = nowOf(state, ctx);
  // Chosen when the life settles in, not before: a life still being created belongs nowhere yet.
  if (unsettled(state)) return fail(state, 'settle_required', 'Settle in first: your local government is chosen when you settle in (tap the "Settle in" goal), and your free house comes with it.');
  const unit = lgaOf(e.city, payload?.lga);
  if (!unit) return fail(state, 'invalid_lga', `Choose one of the ${lgasOf(e.city).length} local governments of ${cityRules(e.city)?.name ?? 'this city'}.`);
  const via = payload?.via === 'device' ? 'device' : 'manual';
  if (unit.id === e.lga) {
    if (e.lgaConfirmed) return ok(state, 'unchanged');
    Object.assign(e, { lgaConfirmed: true, lgaAt: now, lgaVia: via });
    state.message = `${unit.name} is your local government.`;
    return ok(state, 'lga_confirmed');
  }
  // The first real choice is free and immediate; after that the cooldown applies.
  if (e.lgaConfirmed && e.lgaAt !== null && now - e.lgaAt < LGA_RULES.changeCooldownDays * DAY_MS) {
    const days = Math.ceil((e.lgaAt + LGA_RULES.changeCooldownDays * DAY_MS - now) / DAY_MS);
    return fail(state, 'lga_cooldown', `You can change your local government once every ${LGA_RULES.changeCooldownDays} days. You can change again in ${days} day${days === 1 ? '' : 's'}.`);
  }
  if (e.upgrade) return fail(state, 'upgrade_running', 'Your house is being upgraded. Wait until the builders have finished before you move it to another local government.');
  const levy = moveLevy(e.city, e.lga, unit.id, e.tier);
  if (levy > 0 && !canAfford(state, levy)) return fail(state, 'insufficient_funds', `Land is dearer in ${unit.name}: taking your ${HOUSE_TIERS[e.tier].label} there costs ${naira(levy)}; you have ${naira(state.cash)}.`);
  if (levy > 0) debit(state, levy, `Moving your ${HOUSE_TIERS[e.tier].label} to ${unit.name} (dearer land)`, ctx);
  Object.assign(e, { lga: unit.id, lgaAt: now, lgaConfirmed: true, lgaVia: via });
  state.message = `You now belong to ${unit.name}. Your house is being moved to a plot there.`;
  emit(state, 'lga.changed', { lga: unit.id }, ctx);
  return ok(state, 'lga_set');
}

/** The server allocated a plot (server/world/service.js). The one before it, if any, is remembered so it can be freed. */
function assign(state, payload) {
  const e = state.estate, plot = cleanPlot(payload, e.city);
  if (!hasPlace(state)) return fail(state, 'no_place', 'This life has not settled in: it has no local government and no house yet.');
  if (!plot || plot.lga !== e.lga) return fail(state, 'invalid_plot', 'That plot is not in your local government.');
  if (e.plot && e.plot.lga === plot.lga && e.plot.estate === plot.estate && e.plot.plot === plot.plot) return ok(state, 'unchanged');
  if (e.plot) e.old = e.plot;
  e.plot = plot;
  return ok(state, 'assigned');
}
/** The server freed the plot left behind. */
function released(state, payload) {
  const e = state.estate;
  if (e.old && payload?.lga === e.old.lga && payload?.estate === e.old.estate && payload?.plot === e.old.plot) e.old = null;
  return ok(state, 'released');
}

function restyle(state, payload, ctx) {
  const e = state.estate, wanted = payload?.style;
  if (!isRecord(wanted)) return fail(state, 'invalid_style', 'Choose a look for your house.');
  for (const field of STYLE_FIELDS) {
    const value = wanted[field] === undefined ? e.style[field] : wanted[field];
    if (!Number.isInteger(value) || value < 0 || value >= HOUSE_STYLE[field].length) return fail(state, 'invalid_style', `Choose the ${field} from the list.`);
  }
  const next = cleanStyle({ ...e.style, ...wanted });
  const price = stylePrice(e.style, next);
  if (STYLE_FIELDS.every((field) => next[field] === e.style[field])) return ok(state, 'unchanged');
  if (!canAfford(state, price)) return fail(state, 'insufficient_funds', `That look costs ${naira(price)}; you have ${naira(state.cash)}.`);
  if (price > 0) debit(state, price, 'House styling', ctx);
  e.style = next;
  state.message = price > 0 ? `Your house has its new look (${naira(price)}).` : 'Your house has its new look.';
  emit(state, 'house.styled', { price }, ctx);
  return ok(state, 'styled');
}

function upgrade(state, payload, ctx) {
  const e = state.estate, now = nowOf(state, ctx), to = tierOf(payload?.to), current = HOUSE_TIERS[e.tier];
  if (state.onboarding && state.onboarding.done !== true) return fail(state, 'onboarding_required', 'Finish creating your Sim before you build.');
  if (!to) return fail(state, 'invalid_tier', 'Choose a house from the list.');
  if (e.upgrade) return fail(state, 'upgrade_running', `The builders are still working on your ${HOUSE_TIERS[e.upgrade.to].label}: about ${Math.ceil((e.upgrade.doneAt - now) / 60000)} minutes to go.`);
  if (to.rank <= current.rank) return fail(state, 'not_an_upgrade', `You already have a ${current.label}. Choose a bigger house.`);
  const cost = tierCost(e.city, e.lga, to.id);
  if (!canAfford(state, cost)) return fail(state, 'insufficient_funds', `A ${to.label} in ${lgaOf(e.city, e.lga).name} costs ${naira(cost)}; you have ${naira(state.cash)} (${naira(cost - state.cash)} short).`);
  debit(state, cost, `House upgrade: ${to.label} at ${where(e)}`, ctx);
  e.upgrade = { to: to.id, cost, startedAt: now, doneAt: now + to.buildSeconds * 1000 };
  state.message = `The builders have started on your ${to.label}. Ready in about ${Math.ceil(to.buildSeconds / 60)} minutes — it finishes even while you are away.`;
  emit(state, 'house.upgrade-started', { to: to.id, cost }, ctx);
  note(state, 'house', `You paid ${naira(cost)} to upgrade your house at ${where(e)} to a ${to.label}.`, ctx);
  return ok(state, 'upgrade_started');
}

function moveIn(state, payload, ctx) {
  const blocked = busy(state, 'Finish or cancel your current action before moving in.');
  if (blocked) return blocked;
  const e = state.estate;
  if (e.living === 'own') return fail(state, 'already_home', 'You already live in your own house.');
  if (state.economy?.rent?.arrears > 0) return fail(state, 'rent_arrears', `Pay your ${naira(state.economy.rent.arrears)} rent arrears in Phone → Bank before you leave your rented home.`);
  const from = rentedHouse(state);
  e.living = 'own';
  emit(state, 'home.owned', { living: true, house: from }, ctx);
  emit(state, 'house.moved', { id: 'own', from, cost: 0 }, ctx);
  state.message = `You moved into your own ${HOUSE_TIERS[e.tier].label} at ${where(e)}. No weekly rent here${HOUSE_TIERS[e.tier].groundRent ? ` — only ${naira(HOUSE_TIERS[e.tier].groundRent)} ground rent on Saturdays` : ''}.`;
  return ok(state, 'moved_in');
}

/**
 * Does this life have a place in the city yet — a local government of its own, and so a house?
 * True once it has chosen one, and for a life from before local governments existed (it keeps the
 * one its home district lies in). A life that has not settled in has neither.
 */
export const hasPlace = (state) => Boolean(state?.estate?.lga) && !unsettled(state)
  && (state.estate.lgaConfirmed === true || (state.onboarding?.done === true && state.onboarding.legacy === true));

/** Why a trip to another city cannot start, or null. `ctx.openCities` lets a test open a city; no request can set it. */
export function relocateBlock(state, to, mode, ctx) {
  const e = state.estate, dest = cityRules(to);
  const link = dest ? linksFrom(e.city).find((item) => item.to === to && item.mode === mode) : null;
  if (!dest || to === e.city) return { code: 'invalid_city', reason: 'Choose another city to travel to.' };
  if (!link) return { code: 'no_route', reason: `There is no ${mode === 'air' ? 'flight' : 'road link'} from ${cityRules(e.city)?.name ?? 'here'} to ${dest.name}.` };
  const open = dest.status === 'open' || (Array.isArray(ctx?.openCities) && ctx.openCities.includes(to));
  if (!open) return { code: 'city_not_open', reason: `${dest.name} is not open yet, so nothing leaves for it. Departures start the day it opens.` };
  if (!canAfford(state, link.fare)) return { code: 'insufficient_funds', reason: `${link.label} costs ${naira(link.fare)}; you have ${naira(state.cash)}.` };
  return null;
}
function relocate(state, payload, ctx) {
  const blocked = busy(state, 'Finish or cancel your current action before leaving the city.');
  if (blocked) return blocked;
  const why = relocateBlock(state, payload?.to, payload?.mode, ctx);
  if (why) return fail(state, why.code, why.reason);
  const link = linksFrom(state.estate.city).find((item) => item.to === payload.to && item.mode === payload.mode);
  debit(state, link.fare, `${link.label} (${cityRules(state.estate.city).name} → ${cityRules(payload.to).name})`, ctx);
  state.activeAction = { kind: 'intercity', id: payload.to, duration: link.seconds, remaining: link.seconds, mode: link.mode, fare: link.fare, from: state.estate.city };
  state.message = `On the way to ${cityRules(payload.to).name}.`;
  return ok(state, 'departed');
}
function arriveInCity(state, active, ctx) {
  const e = state.estate, from = e.city, to = active.id, now = nowOf(state, ctx);
  // The home left behind is put away exactly as it is: the house stays yours.
  const { city, away, nudged, ...residence } = e;
  away[from] = { ...residence, house: rentedHouse(state) };
  const kept = away[to];
  delete away[to];
  const next = cleanResidence(kept ?? { living: 'own' }, to, now);
  const house = kept && Object.hasOwn(HOUSES, kept.house) ? kept.house : HOUSE_ORDER[0];
  Object.assign(e, { city: to, ...next });
  if (!e.lga) Object.assign(e, { lga: lgasOf(to)[0]?.id ?? null, lgaConfirmed: false, lgaVia: 'default' });
  emit(state, 'city.changed', { from, to }, ctx);
  emit(state, 'home.owned', { living: e.living === 'own', house }, ctx);
  emit(state, 'house.moved', { id: e.living === 'own' ? 'own' : house, from: 'away', cost: 0, house }, ctx);
  arrive(state, 'home', ctx, { mode: null });
  state.message = `Welcome to ${cityRules(to).name}. ${kept ? 'You are back at your home here.' : `A plot and a starter house are being set aside for you; your home in ${cityRules(from).name} stays yours.`}`;
}

function advance(state, dt, ctx) {
  const e = state.estate, now = nowOf(state, ctx);
  if (e.upgrade && now >= e.upgrade.doneAt) {
    const to = HOUSE_TIERS[e.upgrade.to];
    e.tier = to.id; e.upgrade = null;
    if (e.ground.week === null) e.ground.week = billingWeek(now);
    emit(state, 'house.upgraded', { tier: to.id }, ctx);
    if (e.living === 'own') emit(state, 'house.moved', { id: 'own', from: 'own', cost: 0 }, ctx); // the room grew: nothing is lost, the grid is re-read
    note(state, 'house', `Your ${to.label} at ${where(e)} is finished${e.living === 'own' ? ': the room is bigger now' : '. Move in from Phone → Houses'}.`, ctx);
  }
  // Not on the first day: start cash is for living on (and may be a loan), so the hint waits a Lagos day.
  const settled = state.onboarding?.done !== false && now - (state.onboarding?.completedAt ?? 0) >= DAY_MS;
  if (!e.nudged && !e.upgrade && e.tier === 'starter' && settled) {
    const cheapest = tierCost(e.city, e.lga, TIER_ORDER[1]);
    if (cheapest !== null && canAfford(state, cheapest)) {
      e.nudged = true;
      note(state, 'house', `You can afford a bigger house: a ${HOUSE_TIERS[TIER_ORDER[1]].label} on your plot costs ${naira(cheapest)}. Open Phone → Houses.`, ctx);
    }
  }
  // Ground rent: every Saturday for a house above the starter, whether or not it is lived in.
  const fee = HOUSE_TIERS[e.tier].groundRent;
  if (!fee) return;
  const week = billingWeek(now);
  if (e.ground.week === null) { e.ground.week = week; return; }
  if (week <= e.ground.week) return;
  const weeks = Math.min(week - e.ground.week, MAX_CATCHUP_WEEKS);
  e.ground.week = week;
  for (let i = 0; i < weeks; i++) {
    if (e.ground.arrears > 0 && debit(state, e.ground.arrears, 'Ground rent owed', ctx)) e.ground.arrears = 0;
    if (debit(state, fee, `Ground rent: ${HOUSE_TIERS[e.tier].label}`, ctx)) continue;
    e.ground.arrears = Math.min(fee * OWNING.groundRentArrearsWeeks, e.ground.arrears + fee);
    note(state, 'ground-rent', `Ground rent missed: ${naira(fee)} was due and you had ${naira(state.cash)}. You owe ${naira(e.ground.arrears)}; it is collected on a Saturday when your balance covers it. You keep your house.`, ctx);
  }
}

function view(state, ctx) {
  const e = state.estate, now = nowOf(state, ctx), unit = lgaOf(e.city, e.lga), city = cityRules(e.city);
  const cooldownEnds = e.lgaConfirmed && e.lgaAt !== null ? e.lgaAt + LGA_RULES.changeCooldownDays * DAY_MS : 0;
  const daysLeft = Math.ceil((cooldownEnds - now) / DAY_MS), tier = HOUSE_TIERS[e.tier];
  const cheapest = cheapestUpgrade(e.city);
  return {
    city: e.city, cityName: city?.name ?? e.city, unit: city?.unit ?? 'district',
    lga: unit ? { id: unit.id, name: unit.name, line: unit.line, land: unit.land } : null,
    lgaConfirmed: e.lgaConfirmed, lgaVia: e.lgaVia, placed: hasPlace(state),
    change: { cooldownDays: LGA_RULES.changeCooldownDays, at: cooldownEnds > now ? cooldownEnds : null,
      blocked: cooldownEnds > now ? `You can change again in ${daysLeft} day${daysLeft === 1 ? '' : 's'} (once every ${LGA_RULES.changeCooldownDays} days).` : e.upgrade ? 'Your house is being upgraded: wait for the builders to finish.' : null },
    lgas: lgasOf(e.city).map((item) => ({ id: item.id, name: item.name, line: item.line, land: item.land, levy: moveLevy(e.city, e.lga, item.id, e.tier) })),
    plot: e.plot ? { ...e.plot, key: addressKey(e.plot.lga, e.plot.estate, e.plot.plot), address: addressLabel(e.city, e.plot.lga, e.plot.estate, e.plot.plot) } : null,
    tier: { id: tier.id, label: tier.label, icon: tier.icon, grid: tier.grid, groundRent: tier.groundRent },
    style: { ...e.style }, packed: packStyle(e.style, e.tier),
    styles: Object.fromEntries(STYLE_FIELDS.map((field) => [field, HOUSE_STYLE[field].map((option, index) => ({ index, id: option.id, label: option.label, hex: option.hex ?? null, price: option.price ?? 0, chosen: e.style[field] === index }))])),
    upgrade: e.upgrade ? { to: e.upgrade.to, label: HOUSE_TIERS[e.upgrade.to].label, cost: e.upgrade.cost, startedAt: e.upgrade.startedAt, doneAt: e.upgrade.doneAt, remaining: Math.max(0, Math.ceil((e.upgrade.doneAt - now) / 1000)),
      progress: Math.max(0, Math.min(1, (now - e.upgrade.startedAt) / Math.max(1, e.upgrade.doneAt - e.upgrade.startedAt))) } : null,
    tiers: TIER_ORDER.map((id) => {
      const item = HOUSE_TIERS[id], cost = tierCost(e.city, e.lga, id) ?? item.cost;
      const blocked = item.rank <= tier.rank ? (item.id === tier.id ? 'This is your house' : 'Smaller than your house') : e.upgrade ? 'The builders are busy' : !canAfford(state, cost) ? `Need ${naira(cost - state.cash)} more` : null;
      return { id, label: item.label, icon: item.icon, grid: item.grid, cost, minutes: Math.ceil(item.buildSeconds / 60), groundRent: item.groundRent, blurb: item.blurb, current: item.id === tier.id, blocked };
    }),
    living: e.living, arrears: e.ground.arrears,
    cheapest: cheapest ? { ...cheapest, lgaName: lgaOf(e.city, cheapest.lga).name, label: HOUSE_TIERS[cheapest.tier].label } : null,
    rules: { beta: true, housesPerLife: OWNING.housesPerLife, cooldownDays: LGA_RULES.changeCooldownDays },
    links: linksFrom(e.city).map((link) => ({ ...link, name: CITY_RULES[link.to].name, open: CITY_RULES[link.to].status === 'open', hub: city?.hub?.[link.mode] ?? null,
      blocked: relocateBlock(state, link.to, link.mode, ctx)?.reason ?? (state.activeAction ? 'Finish your current action first.' : null) })),
    away: Object.entries(e.away).map(([id, home]) => ({ city: id, name: CITY_RULES[id].name, tier: HOUSE_TIERS[home.tier].label, living: home.living })),
  };
}

export default {
  id: 'estate',
  stateKeys: ['estate'],
  sanitize,
  actions: {
    'estate.set-lga': setLga,
    'estate.assign': { serverOnly: true, run: assign, refusal: 'Plots are allocated by the game server. Nothing was changed.' },
    'estate.released': { serverOnly: true, run: released, refusal: 'Plots are freed by the game server. Nothing was changed.' },
    'estate.style': restyle,
    'estate.upgrade': upgrade,
    'estate.move-in': moveIn,
    'estate.relocate': relocate,
  },
  active: {
    intercity: {
      moves: true,
      sanitize(value, state) {
        const from = state.estate.city;
        const link = linksFrom(from).find((item) => item.to === value.id && item.mode === value.mode);
        return link && value.duration === link.seconds ? { mode: link.mode, fare: link.fare, from } : null;
      },
      complete: arriveInCity,
      cancel: (state) => fail(state, 'no_cancel', 'The trip has left: it cannot be cancelled now. The fare is not refunded.'),
      /** A trip that can no longer run (the link changed) gives the fare back, once. */
      invalidated(state, value, ctx) { if (Number.isSafeInteger(value.fare) && value.fare > 0 && value.fare <= 1e6) credit(state, value.fare, 'Inter-city fare refunded', ctx); },
    },
  },
  advance,
  view,
  on: {
    /** The life has settled in a home: until a local government is chosen, the guess follows that home's district. */
    'life.started'(state, data, ctx) {
      const e = state.estate, unit = lgaOf(e.city, data?.lga);
      // Settling in with a local government (the settle-in Home card): it is the life's first choice — free, immediate and
      // confirmed — and with `own` the life lives in the free starter house there from the first moment: no weekly rent.
      if (unit && !e.lgaConfirmed) {
        Object.assign(e, { lga: unit.id, lgaAt: nowOf(state, ctx), lgaConfirmed: true, lgaVia: data.via === 'device' ? 'device' : 'manual' });
        emit(state, 'lga.changed', { lga: unit.id }, ctx);
      } else if (!e.lgaConfirmed) Object.assign(e, { lga: defaultLga(e.city, state), lgaVia: 'default' });
      if (data?.own === true && e.living !== 'own') { e.living = 'own'; emit(state, 'home.owned', { living: true, house: rentedHouse(state) }, ctx); }
    },
    /** Moving to a rented home through the Houses app ends living in the owned one (the house stays yours). */
    'house.moved'(state, data) { if (data?.id !== 'own' && data?.from !== 'away' && state.estate.living === 'own') state.estate.living = 'rent'; },
  },
};
