/**
 * OWNER: world
 * Travel between venues: modes, fares, trip time, need costs, opening hours, roadside events,
 * and the two small world rules that venue content relies on (activity cooldowns and chance
 * outcomes).
 *
 * ACTIONS
 *   'travel'    { id: venueId, mode }   start a trip. The fare is charged at departure.
 *   'world.roadside'  { choice }        answer the pending roadside event (state.travel.event).
 * Timed-action kind: 'travel' — { kind, id, duration, remaining, mode }. A save from before
 * per-mode travel has no `mode` and the old flat duration; it still resumes and arrives.
 *
 * RULES
 *   - Five modes (content/travel.js) plus 'car', which is offered only when a system adds it
 *     through the 'travel.modes' modifier. Trek is always offered, so nobody is ever stranded.
 *   - Every mode goes everywhere, Home included.
 *   - A closed venue cannot be travelled to. The refusal names the opening time and the wait,
 *     and the same text is what the map card and the Ride app show (view.destinations[].status).
 *   - Fare and trip time depend on the band of the route: a short hop, across town, or across
 *     the lagoon (routeBand). Need costs are applied on arrival.
 *   - Cancelling keeps the foundation's rule: the trip stops where it started and the fare is
 *     not refunded. No need cost is applied and no roadside event is rolled.
 *   - On arrival a roadside event may be offered (content/events.js). It never blocks play:
 *     it lapses when the next trip starts or after EVENT_TTL_SECONDS.
 *
 * STATE  state.travel = {
 *   home       house id used to place Home on the map (learned from 'life.started' / 'house.moved')
 *   event      null | { id, at }           pending roadside choice
 *   lastTrip   null | { mode, from, to }   the trip that just ended (readable by any listener)
 *   visited    [venueId]                   venues arrived at, in first-visit order
 *   trips      completed trips
 *   cooldowns  { [activityId]: readyAtMs }
 *   funded     true once the startup grant has been paid
 * }
 *
 * MODIFIER KEYS THIS SYSTEM CALLS (base → your adjusted value); data is { mode, destination, from, band }
 *   'travel.fare'      naira for the trip (for mode 'car' the base is fuel)
 *   'travel.duration'  seconds
 *   'travel.needCost'  { need: delta } applied on arrival — return a new object
 *   'travel.modes'     [modeId, ...] offered for this trip; add 'car' to offer the own-car mode.
 *                      data is { destination, from }
 * MODIFIERS THIS SYSTEM CONTRIBUTES
 *   'activity.block'   enforces `cooldown` and `requiresMoodlet` on any activity definition
 *
 * EVENTS EMITTED
 *   'travel.arrived'     { venue, from, mode }  emitted by api.arrive(); this system adds `mode`
 *                        to the payload from its own listener, so systems registered before it
 *                        (career) see only { venue, from } and can read state.travel.lastTrip.
 *   'venue.visited'      { venue, first }       after every arrival; first = never been before
 *   'roadside.offered'   { event }
 *   'roadside.resolved'  { event, choice, success }   success is null when nothing was rolled
 *   'health.treat'       { by }                 a roadside remedy was taken (health cures)
 *   'startup.funded'     { venue }              the pitch at CcHub won its one-time grant
 *   'activity.outcome'   { id, success }        a chance activity was rolled
 * EVENTS LISTENED TO
 *   'life.started' { house }, 'house.moved' { id }, 'activity.completed', 'travel.arrived'
 */
import { emit, modify } from '../registry.js';
import { busy, clamp, fail, finite, isRecord, naira, ok, safeCount } from '../util.js';
import { isOpen, minutesUntilOpen, formatHour, lagosTime, WEEKDAYS } from '../clock.js';
import { arrive, canAfford, credit, debit, changeNeeds, addSkillXp, addMoodlet, removeMoodlet, skillLevel, feelingsOf, findActivity, spotsOf, NEEDS } from '../api.js';
import { VENUES, COMING_SOON, HOME_SPOTS, DEFAULT_HOME, venueLabel, venueDistrict } from '../content/venues.js';
import { TRAVEL_MODES, ALL_MODES, BASE_MODE_IDS, DEFAULT_MODE, FARE_BANDS, BAND_TIME, BAND_LABELS, NEAR_DISTANCE, MIN_TRIP_SECONDS, MAX_TRIP_SECONDS, TRAVEL_DURATION } from '../content/travel.js';
import { EVENTS, EVENT_TTL_SECONDS, ACTIVITY_OUTCOMES } from '../content/events.js';

const MAP_WIDTH = 1000, MAP_HEIGHT = 700;
const MAX_COOLDOWNS = 80;

// ---- places and routes ------------------------------------------------------------------

const homeId = (state) => (Object.hasOwn(HOME_SPOTS, state?.travel?.home) ? state.travel.home : DEFAULT_HOME);

/** Map position and landmass of a venue; Home depends on which house the player lives in. */
export function placeOf(state, venueId) {
  const place = venueId === 'home' ? HOME_SPOTS[homeId(state)] : VENUES[venueId] || COMING_SOON[venueId];
  return place ? { x: place.map.x, y: place.map.y, zone: place.zone } : null;
}

/** 'near' | 'standard' | 'far' for a trip between two venues. */
export function routeBand(state, from, to) {
  const a = placeOf(state, from), b = placeOf(state, to);
  if (!a || !b) return 'standard';
  if ((a.zone === 'mainland') !== (b.zone === 'mainland')) return 'far';
  const distance = Math.hypot((a.x - b.x) * MAP_WIDTH / 100, (a.y - b.y) * MAP_HEIGHT / 100);
  return distance < NEAR_DISTANCE ? 'near' : 'standard';
}

const cleanNeeds = (value, fallback) => (isRecord(value)
  ? Object.fromEntries(Object.entries(value).filter(([need, amount]) => NEEDS.includes(need) && finite(amount) && amount !== 0).map(([need, amount]) => [need, clamp(Math.round(amount), -100, 100)]))
  : fallback);

/** Fare, trip time and need cost of one trip from where the player is, after every modifier. */
export function quote(state, destination, modeId, ctx) {
  const mode = ALL_MODES[modeId];
  const from = state.location;
  const band = routeBand(state, from, destination);
  const data = { mode: modeId, destination, from, band };
  const baseFare = FARE_BANDS[band]?.[modeId] ?? mode.fare;
  const fare = Math.max(0, Math.round(Number(modify(state, 'travel.fare', baseFare, data, ctx)) || 0));
  const baseSeconds = Math.round(mode.seconds * BAND_TIME[band]);
  const seconds = clamp(Math.round(Number(modify(state, 'travel.duration', baseSeconds, data, ctx)) || baseSeconds), MIN_TRIP_SECONDS, MAX_TRIP_SECONDS);
  const needs = cleanNeeds(modify(state, 'travel.needCost', { ...mode.needs }, data, ctx), { ...mode.needs });
  return { mode: modeId, band, fare, seconds, needs, xp: mode.xp || {} };
}

/** Mode ids offered for a trip. Trek is always first, so there is always a free way to go. */
export function modesFor(state, destination, ctx) {
  const offered = modify(state, 'travel.modes', [...BASE_MODE_IDS], { destination, from: state.location }, ctx);
  const ids = (Array.isArray(offered) ? offered : BASE_MODE_IDS).filter((id, index, list) => typeof id === 'string' && Object.hasOwn(ALL_MODES, id) && list.indexOf(id) === index);
  return ids.includes('trek') ? ids : ['trek', ...ids];
}

// ---- opening hours: one source of truth -------------------------------------------------

const waitText = (minutes) => (minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`);

/**
 * Opening state of a venue's hours at `now`, with the one label every screen shows.
 * @returns {{ open, always, hours, status, minutes, opensAt }}
 *   hours   'Open 24 hours' | '8AM – 10PM'
 *   status  'Open 24 hours' | 'Open now · closes 10PM' | 'Closed · opens 8AM (in 5h 19m)'
 */
export function openingInfo(hours, now) {
  if (!hours) return { open: true, always: true, hours: 'Open 24 hours', status: 'Open 24 hours', minutes: 0, opensAt: null };
  const range = `${formatHour(hours.open)} – ${formatHour(hours.close)}`;
  if (isOpen(hours, now)) return { open: true, always: false, hours: range, status: `Open now · closes ${formatHour(hours.close)}`, minutes: 0, opensAt: null };
  let minutes;
  if (hours.days) minutes = minutesUntilOpen(hours, now);
  else { const gap = Math.round(hours.open * 60) - lagosTime(now).minuteOfDay; minutes = ((gap % 1440) + 1440) % 1440 || 1440; }
  if (minutes === Infinity) return { open: false, always: false, hours: range, status: 'Closed', minutes, opensAt: null };
  const day = minutes >= 1440 ? `${WEEKDAYS[lagosTime(now + minutes * 60000).weekday].slice(0, 3)} ` : '';
  const opensAt = `${day}${formatHour(hours.open)}`;
  return { open: false, always: false, hours: range, status: `Closed · opens ${opensAt} (in ${waitText(minutes)})`, minutes, opensAt };
}

/**
 * Why this trip cannot start, or null. Pure: never mutates state. Does not check `busy`.
 * Codes: invalid_travel · coming_soon · already_here · travel_mode_unavailable · closed · insufficient_funds
 */
export function travelBlock(state, destination, modeId, ctx) {
  if (typeof destination === 'string' && Object.hasOwn(COMING_SOON, destination)) {
    return { code: 'coming_soon', reason: `${venueLabel(destination, ctx?.cityId)} is not open yet — it is coming soon.` };
  }
  if (typeof destination !== 'string' || !Object.hasOwn(VENUES, destination) || typeof modeId !== 'string' || !Object.hasOwn(ALL_MODES, modeId)) {
    return { code: 'invalid_travel', reason: 'Choose a valid destination and travel option.' };
  }
  if (destination === state.location) return { code: 'already_here', reason: 'You are already here.' };
  if (!modesFor(state, destination, ctx).includes(modeId)) {
    return { code: 'travel_mode_unavailable', reason: modeId === 'car' ? 'You do not own a car yet. Buy one in Phone → Cars, or pick another way to travel.' : `${ALL_MODES[modeId].label} is not available for this trip.` };
  }
  const label = venueLabel(destination, ctx?.cityId);
  const opening = openingInfo(VENUES[destination].hours, ctx?.now ?? state.t);
  if (!opening.open) {
    return { code: 'closed', reason: `${label} is closed: ${opening.opensAt ? `opens ${opening.opensAt} (in ${waitText(opening.minutes)})` : 'no opening time is set'}. You can look at it on the map, but you cannot travel there yet.` };
  }
  const { fare } = quote(state, destination, modeId, ctx);
  if (!canAfford(state, fare)) {
    return { code: 'insufficient_funds', reason: `You do not have enough cash for this fare. It costs ${naira(fare)}; you have ${naira(state.cash)}.${fare ? ' Trekking is free.' : ''}` };
  }
  return null;
}

// ---- the trip ---------------------------------------------------------------------------

function travel(state, payload, ctx) {
  const blocked = busy(state);
  if (blocked) return blocked;
  const destination = payload?.id, modeId = payload?.mode;
  const why = travelBlock(state, destination, modeId, ctx);
  if (why) return fail(state, why.code, why.reason);
  const trip = quote(state, destination, modeId, ctx);
  const label = venueLabel(destination, ctx.cityId);
  const mode = ALL_MODES[modeId];
  debit(state, trip.fare, `${mode.fuel ? 'Fuel' : mode.label} to ${label}`, ctx);
  state.travel.event = null; // an unanswered roadside choice lapses when you move on
  state.activeAction = { kind: 'travel', id: destination, duration: trip.seconds, remaining: trip.seconds, mode: modeId };
  state.message = `Travelling to ${label}.`;
  return ok(state, 'started');
}

const signed = (amount) => (amount > 0 ? `+${amount}` : `−${-amount}`);
const needsText = (needs) => Object.entries(needs).map(([need, amount]) => `${signed(amount)} ${need[0].toUpperCase()}${need.slice(1)}`).join(', ');

function pickEvent(state, modeId, ctx) {
  const fits = Object.values(EVENTS).filter((event) => event.modes.includes(modeId));
  if (!fits.length) return null;
  // The remedy seller always finds a sick trekker, so a cure is never down to luck.
  if (modeId === 'trek' && state.health?.sick === true) return EVENTS.agbo;
  if (ctx.rng() >= ALL_MODES[modeId].eventChance) return null;
  let roll = ctx.rng() * fits.reduce((sum, event) => sum + event.weight, 0);
  for (const event of fits) { roll -= event.weight; if (roll < 0) return event; }
  return fits[fits.length - 1];
}

function complete(state, active, ctx) {
  const from = state.location, destination = active.id;
  const modeId = typeof active.mode === 'string' && Object.hasOwn(ALL_MODES, active.mode) ? active.mode : null;
  // Quote before moving: the band depends on where the trip started.
  const trip = modeId ? quote(state, destination, modeId, ctx) : null;
  state.travel.lastTrip = { mode: modeId, from, to: destination };
  state.message = `Arrived at ${venueLabel(destination, ctx.cityId)}.`;
  arrive(state, destination, ctx); // listeners (weather, goals) may append to state.message
  const first = !state.travel.visited.includes(destination);
  if (first) state.travel.visited.push(destination);
  state.travel.trips = Math.min(Number.MAX_SAFE_INTEGER, state.travel.trips + 1);
  if (trip) {
    changeNeeds(state, trip.needs);
    for (const [skill, amount] of Object.entries(trip.xp)) addSkillXp(state, skill, amount, ctx);
    const costs = Object.fromEntries(Object.entries(trip.needs).filter(([, amount]) => amount < 0));
    if (Object.keys(costs).length) state.message += ` The ${ALL_MODES[modeId].label.toLowerCase()} cost you ${needsText(costs)}.`;
  }
  emit(state, 'venue.visited', { venue: destination, first }, ctx);
  const event = trip ? pickEvent(state, modeId, ctx) : null;
  if (event) {
    state.travel.event = { id: event.id, at: ctx.now };
    state.message += ` ${event.title} — choose what to do.`;
    emit(state, 'roadside.offered', { event: event.id }, ctx);
  }
}

// ---- outcomes shared by roadside choices and chance activities --------------------------

/** Apply one outcome block. Money out is taken as far as the wallet allows; it never goes negative. */
function applyOutcome(state, outcome, reason, ctx) {
  const lost = (outcome.cost || 0) + (outcome.fine || 0);
  if (lost > 0) debit(state, lost, reason, ctx, { partial: true });
  if (outcome.reward > 0) credit(state, outcome.reward, reason, ctx);
  changeNeeds(state, outcome.effects);
  for (const [skill, amount] of Object.entries(outcome.xp || {})) addSkillXp(state, skill, amount, ctx);
  if (outcome.moodlet) addMoodlet(state, outcome.moodlet, ctx);
  if (outcome.treat) emit(state, 'health.treat', { by: reason }, ctx);
}

const chanceOf = (state, check) => Math.min(check.max ?? 1, check.base + check.perLevel * skillLevel(state, check.skill));

function roadside(state, payload, ctx) {
  const pending = state.travel.event;
  const event = pending && EVENTS[pending.id];
  if (!event) return fail(state, 'no_event', 'Nothing is waiting for you by the roadside right now.');
  const choice = event.choices.find((item) => item.id === payload?.choice);
  if (!choice) return fail(state, 'invalid_choice', `Choose one of: ${event.choices.map((item) => item.label).join(', ')}.`);
  if (choice.cost && !canAfford(state, choice.cost)) {
    return fail(state, 'insufficient_funds', `“${choice.label}” costs ${naira(choice.cost)}; you have ${naira(state.cash)}. Pick another answer.`);
  }
  state.travel.event = null;
  // The paid part of a choice is charged in full (checked above); only a failed check can cost extra.
  if (choice.cost) debit(state, choice.cost, event.title, ctx);
  applyOutcome(state, { ...choice, cost: 0 }, event.title, ctx);
  let success = null, result = choice.result;
  if (choice.check) {
    success = ctx.rng() < chanceOf(state, choice.check);
    const outcome = success ? choice.check.success : choice.check.failure;
    applyOutcome(state, outcome, event.title, ctx);
    result = outcome.result;
  }
  state.message = result;
  emit(state, 'roadside.resolved', { event: event.id, choice: choice.id, success }, ctx);
  return ok(state, 'resolved');
}

function rollActivity(state, id, rule, ctx) {
  const success = ctx.rng() < chanceOf(state, rule);
  let outcome = success ? rule.success : rule.failure;
  const label = findActivity(id)?.def.label ?? id;
  if (success && outcome.once) {
    if (state.travel[outcome.once]) outcome = outcome.repeat;
    else state.travel[outcome.once] = true;
  }
  applyOutcome(state, outcome, label, ctx);
  state.message = `${label}: ${outcome.result}`;
  if (success && outcome.event) emit(state, outcome.event, { venue: state.location }, ctx);
  emit(state, 'activity.outcome', { id, success }, ctx);
}

const cooldownLeft = (state, id, now) => Math.max(0, Math.ceil(((state.travel?.cooldowns?.[id] ?? 0) - now) / 1000));

// ---- state ------------------------------------------------------------------------------

function sanitize(input, state, ctx) {
  const saved = isRecord(input.travel) ? input.travel : {};
  const now = finite(ctx?.now) ? ctx.now : state.t;
  const event = isRecord(saved.event) && typeof saved.event.id === 'string' && Object.hasOwn(EVENTS, saved.event.id) && finite(saved.event.at) ? { id: saved.event.id, at: saved.event.at } : null;
  const trip = saved.lastTrip;
  const lastTrip = isRecord(trip) && typeof trip.to === 'string' && Object.hasOwn(VENUES, trip.to) && typeof trip.from === 'string' && Object.hasOwn(VENUES, trip.from)
    && (trip.mode === null || (typeof trip.mode === 'string' && Object.hasOwn(ALL_MODES, trip.mode))) ? { mode: trip.mode, from: trip.from, to: trip.to } : null;
  const cooldowns = {};
  for (const [id, readyAt] of Object.entries(isRecord(saved.cooldowns) ? saved.cooldowns : {}).slice(0, MAX_COOLDOWNS)) {
    const seconds = findActivity(id)?.def.cooldown;
    // A cooldown can never be longer than the activity's own, whatever the save claims.
    if (finite(seconds) && seconds > 0 && finite(readyAt) && readyAt > now) cooldowns[id] = Math.min(readyAt, now + seconds * 1000);
  }
  state.travel = {
    home: typeof saved.home === 'string' && Object.hasOwn(HOME_SPOTS, saved.home) ? saved.home : DEFAULT_HOME,
    event, lastTrip,
    visited: [...new Set((Array.isArray(saved.visited) ? saved.visited : []).filter((id) => typeof id === 'string' && Object.hasOwn(VENUES, id)))],
    trips: safeCount(saved.trips) ? saved.trips : 0,
    cooldowns,
    funded: saved.funded === true,
  };
}

function setHome(state, id) { if (typeof id === 'string' && Object.hasOwn(HOME_SPOTS, id)) state.travel.home = id; }

// ---- view -------------------------------------------------------------------------------

function modeCard(state, destination, modeId, base, ctx) {
  const mode = ALL_MODES[modeId];
  const trip = quote(state, destination, modeId, ctx);
  const blocked = base || (!canAfford(state, trip.fare) ? travelBlock(state, destination, modeId, ctx) : null);
  return { id: modeId, label: mode.label, icon: mode.icon, blurb: mode.blurb, fuel: Boolean(mode.fuel), fare: trip.fare, seconds: trip.seconds, needs: trip.needs, xp: trip.xp, blocked };
}

function destinationCard(state, venue, ctx) {
  const now = ctx.now, id = venue.id, here = id === state.location;
  const opening = openingInfo(venue.hours, now);
  const place = placeOf(state, id);
  // Reasons that do not depend on the mode are worked out once and shared by every tile.
  const base = here ? { code: 'already_here', reason: 'You are already here.' } : !opening.open ? travelBlock(state, id, 'trek', ctx) : null;
  return {
    id, kind: id === 'home' ? 'home' : 'venue', label: venueLabel(id, ctx.cityId), district: id === 'home' ? HOME_SPOTS[homeId(state)].district : venueDistrict(id, ctx.cityId),
    icon: venue.icon, description: venue.description, category: venue.category, x: place.x, y: place.y, zone: place.zone,
    here, visited: state.travel.visited.includes(id), open: opening.open, hours: opening.hours, status: opening.status,
    band: here ? null : BAND_LABELS[routeBand(state, state.location, id)],
    ambient: venue.ambient?.length ? venue.ambient[Math.floor(now / 8000) % venue.ambient.length] : '',
    preview: spotsOf(id).flatMap((spot) => spot.activities.map((def) => def.label)),
    blocked: base,
    modes: modesFor(state, id, ctx).map((modeId) => modeCard(state, id, modeId, base, ctx)),
  };
}

function view(state, ctx) {
  const pending = state.travel.event && EVENTS[state.travel.event.id];
  const venues = Object.values(VENUES).map((venue) => destinationCard(state, venue, ctx));
  const soon = Object.values(COMING_SOON).map((place) => ({
    id: place.id, kind: 'soon', label: venueLabel(place.id, ctx.cityId), district: venueDistrict(place.id, ctx.cityId), icon: place.icon, description: place.description,
    category: 'soon', x: place.map.x, y: place.map.y, zone: place.zone, here: false, visited: false, open: false, hours: 'Coming soon', status: 'Coming soon',
    band: null, ambient: '', preview: [], modes: [], blocked: travelBlock(state, place.id, 'trek', ctx),
  }));
  return {
    modes: Object.values(TRAVEL_MODES), // legacy list of the five base modes with standard fares
    duration: TRAVEL_DURATION,
    defaultMode: DEFAULT_MODE,
    home: homeId(state),
    trips: state.travel.trips,
    visited: state.travel.visited.length,
    destinations: [...venues, ...soon],
    event: pending ? {
      id: pending.id, icon: pending.icon, title: pending.title, text: pending.text, at: state.travel.event.at,
      expiresIn: Math.max(0, Math.ceil(EVENT_TTL_SECONDS - (ctx.now - state.travel.event.at) / 1000)),
      choices: pending.choices.map((choice) => ({
        id: choice.id, label: choice.label, hint: choice.hint, cost: choice.cost || 0,
        chance: choice.check ? Math.round(chanceOf(state, choice.check) * 100) : null,
        blocked: choice.cost && !canAfford(state, choice.cost) ? { code: 'insufficient_funds', reason: `Costs ${naira(choice.cost)}; you have ${naira(state.cash)}.` } : null,
      })),
    } : null,
    cooldowns: Object.fromEntries(Object.keys(state.travel.cooldowns).map((id) => [id, cooldownLeft(state, id, ctx.now)]).filter(([, left]) => left > 0)),
  };
}

export default {
  id: 'travel',
  stateKeys: ['travel'],
  sanitize,
  actions: { travel, 'world.roadside': roadside },
  active: {
    travel: {
      sanitize(value, state) {
        if (!Object.hasOwn(VENUES, value.id) || value.id === state.location) return null;
        if (value.mode === undefined) return value.duration === TRAVEL_DURATION ? {} : null;
        const valid = typeof value.mode === 'string' && Object.hasOwn(ALL_MODES, value.mode) && value.duration >= MIN_TRIP_SECONDS && value.duration <= MAX_TRIP_SECONDS;
        return valid ? { mode: value.mode } : null;
      },
      complete,
    },
  },
  advance(state, dt, ctx) {
    const now = finite(ctx?.now) ? ctx.now : state.t;
    if (state.travel.event && now - state.travel.event.at >= EVENT_TTL_SECONDS * 1000) state.travel.event = null;
    for (const [id, readyAt] of Object.entries(state.travel.cooldowns)) if (readyAt <= now) delete state.travel.cooldowns[id];
  },
  view,
  on: {
    'life.started': (state, data) => setHome(state, data?.house),
    'house.moved': (state, data) => setHome(state, data?.id),
    'travel.arrived': (state, data) => {
      const trip = state.travel.lastTrip;
      if (isRecord(data) && data.mode === undefined && trip && trip.to === data.venue) data.mode = trip.mode;
    },
    'activity.completed': (state, data, ctx) => {
      const def = data?.def;
      if (!def) return;
      const now = finite(ctx?.now) ? ctx.now : state.t;
      if (finite(def.cooldown) && def.cooldown > 0) {
        const ids = Object.keys(state.travel.cooldowns);
        if (ids.length >= MAX_COOLDOWNS && !Object.hasOwn(state.travel.cooldowns, def.id)) delete state.travel.cooldowns[ids[0]];
        state.travel.cooldowns[def.id] = now + def.cooldown * 1000;
      }
      for (const id of def.clears || []) removeMoodlet(state, id);
      if (Object.hasOwn(ACTIVITY_OUTCOMES, def.id)) rollActivity(state, def.id, ACTIVITY_OUTCOMES[def.id], ctx);
    },
  },
  modifiers: {
    'activity.block': (value, state, data, ctx) => {
      const def = data?.def;
      if (value || !def) return value;
      const left = cooldownLeft(state, def.id, ctx?.now ?? state.t);
      if (left > 0) return { code: 'cooldown', reason: `You did this recently. ${def.label} is available again in ${left >= 60 ? `${Math.floor(left / 60)}m ${left % 60}s` : `${left}s`}.` };
      if (def.requiresMoodlet && !feelingsOf(state).some((feeling) => feeling.id === def.requiresMoodlet)) {
        return { code: 'not_needed', reason: def.requiresReason || 'You do not need this right now.' };
      }
      return null;
    },
  },
};
