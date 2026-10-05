import { cachedCityContent } from '../cities/registry.ts';
import { cityReference, readCityReference } from '../cities/references.ts';
import { project, UNITS_PER_KM } from '../../geo/frame.ts';
import { houseSpotFor, defaultHouseFor } from '../cities/housingRuntime.ts';
import { contentFor, venueFor, venuesFor } from '../cities/runtime.ts';
/**
 * OWNER: world
 * Travel between venues: modes, fares, trip time, need costs, opening hours, roadside events,
 * and the two small world rules that venue content relies on (activity cooldowns and chance
 * outcomes).
 *
 * ACTIONS
 *   'travel'    { id: venueId, mode }   start a trip. The fare is charged at departure.
 *   'world.roadside'  { choice }        answer the pending roadside event (state.travel.event).
 * Timed-action kind: 'travel' — { kind, id, duration, remaining, mode, fare }. `fare` is the naira
 * charged at departure, kept so the travel screen can say exactly what a cancel forfeits. A save
 * from before per-mode travel has no `mode` and the old flat duration, and an older trip has no
 * `fare`; both still resume and arrive.
 *
 * RULES
 *   - Five modes (content/travel.ts) plus 'car', which is offered only when a system adds it
 *     through the 'travel.modes' modifier. Trek is always offered, so nobody is ever stranded.
 *   - Road modes go everywhere, Home included. Boat requires a declared pair of jetties.
 *   - A closed venue cannot be travelled to. The refusal names the opening time and the wait,
 *     and the same text is what the map card and the Ride app show (view.destinations[].status).
 *   - Fare and trip time depend on the band of the route: a short hop, across town, or across
 *     the lagoon (routeBand). Need costs are applied on arrival.
 *   - Cancelling keeps the foundation's rule: the trip stops where it started and the fare is
 *     not refunded. No need cost is applied and no roadside event is rolled.
 *   - On arrival a roadside event may be offered (content/events.ts). It never blocks play:
 *     it lapses when the next trip starts or after EVENT_TTL_SECONDS.
 *
 * STATE  state.travel = {
 *   home       house id used to place Home on the map (learned from 'life.started' / 'house.moved')
 *   event      null | { id, at }           pending roadside choice
 *   lastTrip   null | { mode, from, to }   the trip that just ended (readable by any listener)
 *   visited    [city-qualified venue key]                   venues arrived at, in first-visit order
 *   trips      completed trips
 *   cooldowns  { [city-qualified activity key]: readyAtMs }
 *   funded     true once the startup grant has been paid
 *   gigs       { day, count }   paid gigs finished on Lagos day `day` (the daily gig limit)
 *   eventDays  { [eventId]: day }  the Lagos day a once-a-day roadside event was last offered
 * }
 *
 * THE DAILY GIG LIMIT (original beta rule, GIG_DAILY_LIMIT in content/venues.ts)
 *   A gig is a venue activity that pays (a `reward`, or a chance outcome that pays more than once)
 *   and is not a job's shift. Each one finished counts; once the day's limit is reached every gig
 *   is refused with 'gig_limit' and a reason that says when they reopen. Job shifts are untouched.
 *
 * MODIFIER KEYS THIS SYSTEM CALLS (base → your adjusted value); data is { mode, destination, from, band }
 *   'travel.fare'      naira for the trip (for mode 'car' the base is fuel)
 *   'travel.duration'  seconds
 *   'travel.needCost'  { need: delta } applied on arrival — return a new object
 *   'travel.modes'     [modeId, ...] offered for this trip; add 'car' to offer the own-car mode.
 *                      data is { destination, from }
 * MODIFIERS THIS SYSTEM CONTRIBUTES
 *   'activity.block'   enforces `cooldown`, `requiresMoodlet` and the daily gig limit on any activity definition
 *
 * EVENTS EMITTED
 *   'travel.arrived'     { venue, from, mode }  emitted by api.arrive(); this system passes the mode
 *                        it travelled by, so every listener sees it whatever its registration order.
 *   'venue.visited'      { venue, first }       after every arrival; first = never been before
 *   'roadside.offered'   { event }
 *   'roadside.resolved'  { event, choice, success }   success is null when nothing was rolled
 *   'health.treat'       { by }                 a roadside remedy was taken (health cures)
 *   'startup.funded'     { venue }              the pitch at CcHub won its one-time grant
 *   'activity.outcome'   { id, success }        a chance activity was rolled
 * EVENTS LISTENED TO
 *   'life.started' { house }, 'house.moved' { id }, 'activity.completed'
 */
import type { ActivityDefinition, ActivityOutcomeRule, ActivitySuccessOutcome, Block, ComingSoonDefinition, FareBands, OutcomeBlock, RoadsideEvent, RouteBand, SkillCheck, VenueDefinition, VenueZone } from '../../types/content.ts';
import type { ActivityId, HouseId, LifeContext, LifeState, NeedMap, RoadsideEventId, SkillMap, TravelAction, TravelModeId, VenueId } from '../../types/life.ts';
import type { TravelBlockCode } from '../../types/actions.ts';
import { LEFT_OUT, PLAYS } from '../profile.ts';
import type { SavedInput, SystemDefinition } from '../../types/registry.ts';
import type { TravelDestination, TravelModeCard, TravelView } from '../../types/view.ts';
import { emit, modify } from '../registry.ts';
import { busy, clamp, fail, finite, isRecord, naira, ok, safeCount } from '../util.ts';
import { openingInfo } from '../clock.ts';
import { arrive, canAfford, credit, debit, changeNeeds, addSkillXp, addMoodlet, removeMoodlet, skillLevel, feelingsOf, findActivity, spotsOf, NEEDS } from '../api.ts';
import { lgaOf } from '../content/world.ts';
import { COMING_SOON, DEFAULT_HOME, GIG_DAILY_LIMIT, venueLabel, venueDistrict } from '../content/venues.ts';
import { lagosTime } from '../clock.ts';
import { TRAVEL_MODES, ALL_MODES, BASE_MODE_IDS, DEFAULT_MODE, FARE_BANDS, BAND_TIME, BAND_LABELS, NEAR_DISTANCE, MIN_TRIP_SECONDS, MAX_TRIP_SECONDS, TRAVEL_DURATION } from '../content/travel.ts';
import { EVENTS, EVENT_TTL_SECONDS, ACTIVITY_OUTCOMES } from '../content/events.ts';

const MAP_WIDTH = 1000, MAP_HEIGHT = 700;
const MAX_COOLDOWNS = 80;
const MAX_VISITED = 512;
/** The longest authored cooldown is a day: a timer for a city whose content is not loaded cannot honestly run longer. */
const MAX_COLD_COOLDOWN_MS = 86_400_000;
/** Upper bound accepted for a saved trip's `fare` (no route costs anywhere near this). */
const MAX_TRIP_FARE = 1_000_000;

/** Fare, trip time and need cost of one quoted trip. */
interface TripQuote { mode: TravelModeId; band: RouteBand; fare: number; seconds: number; needs: NeedMap; xp: SkillMap }

// ---- places and routes ------------------------------------------------------------------

// Lookups by an id that is not yet known to be a key; the same objects, typed as open tables.
const comingSoon: Partial<Record<string, ComingSoonDefinition>> = COMING_SOON;
const outcomeRules: Partial<Record<string, ActivityOutcomeRule>> = ACTIVITY_OUTCOMES;
const fareBands: Partial<Record<RouteBand, FareBands['near']>> = FARE_BANDS;
const needNames: readonly string[] = NEEDS;
const isVenue = (id: unknown, cityId: string): id is VenueId => typeof id === 'string' && Boolean(venueFor(cityId, id));
const GEOGRAPHIC_BANDS = Object.freeze({ nearKm: 3, farKm: 15, beta: true });
const localModes = (city: string) => contentFor(city).localModes ?? Object.values(TRAVEL_MODES);
const modeFor = (city: string, id: TravelModeId) => localModes(city).find(mode => mode.id === id) ?? ALL_MODES[id];
const localRoute = (state: LifeState, destination: string) => contentFor(state.estate.city).localRoutes?.find(route => (route.a === state.location && route.b === destination) || (route.b === state.location && route.a === destination));
function modeAllowed(state: LifeState, destination: string, mode: TravelModeId): boolean {
  const zones = contentFor(state.estate.city).localModeZones?.filter(zone => zone.mode === mode);
  if (!zones?.length) return true;
  return zones.some(zone => {
    const includes = (id: string) => id !== 'home' ? zone.venueIds.includes(id)
      : state.estate.living === 'own' ? Boolean(state.estate.lga && zone.ownedHomeUnitIds.includes(state.estate.lga))
        : zone.rentedHomeIds.includes(state.property.house);
    return includes(state.location) && includes(destination);
  });
}
const isModeId = (id: unknown): id is TravelModeId => typeof id === 'string' && Object.hasOwn(ALL_MODES, id);
const isEventId = (id: unknown): id is RoadsideEventId => typeof id === 'string' && Object.hasOwn(EVENTS, id);
const outcomeRuleOf = (id: string): ActivityOutcomeRule | undefined => (Object.hasOwn(ACTIVITY_OUTCOMES, id) ? outcomeRules[id] : undefined);

const homeId = (state: LifeState): HouseId => {
  const home = state?.travel?.home;
  return houseSpotFor(state.estate.city, home) ? home as HouseId : defaultHouseFor(state.estate.city).id;
};

/** Map position and landmass of a venue; Home depends on which house the player lives in. */
export function placeOf(state: LifeState, venueId: VenueId): { x: number; y: number; zone: VenueZone } | null {
  // Home in a house the player built: the landmass of its local government; the middle of the map for distance.
  if (venueId === 'home' && state?.estate?.living === 'own') return { x: 50, y: 50, zone: lgaOf(state.estate.city, state.estate.plot?.lga ?? state.estate.lga)?.zone ?? 'mainland' };
  const place = venueId === 'home' ? houseSpotFor(state.estate.city, homeId(state)) : venueFor(state.estate.city, venueId) || comingSoon[venueId];
  return place ? { x: place.map.x, y: place.map.y, zone: place.zone } : null;
}

/** 'near' | 'standard' | 'far' for a trip between two venues. */
export function routeBand(state: LifeState, from: VenueId, to: VenueId): RouteBand {
  const geographic = (id: string) => {
    if (id === 'home' && state.estate.living === 'own') return undefined;
    if (id === 'home') return contentFor(state.estate.city).housing.find(home => home.definition.id === homeId(state))?.position;
    const position = contentFor(state.estate.city).venues.find(venue => venue.id === id)?.position;
    return position?.kind === 'lon-lat' ? position : undefined;
  };
  const origin = geographic(from), destination = geographic(to);
  if (origin && destination) {
    const a = project(origin.lon, origin.lat), b = project(destination.lon, destination.lat);
    const km = Math.hypot(a.x - b.x, a.z - b.z) / UNITS_PER_KM;
    return km < GEOGRAPHIC_BANDS.nearKm ? 'near' : km > GEOGRAPHIC_BANDS.farKm ? 'far' : 'standard';
  }
  const a = placeOf(state, from), b = placeOf(state, to);
  if (!a || !b) return 'standard';
  if ((a.zone === 'mainland') !== (b.zone === 'mainland')) return 'far';
  const distance = Math.hypot((a.x - b.x) * MAP_WIDTH / 100, (a.y - b.y) * MAP_HEIGHT / 100);
  return distance < NEAR_DISTANCE ? 'near' : 'standard';
}

const cleanNeeds = (value: unknown, fallback: NeedMap): NeedMap => (isRecord(value)
  ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => needNames.includes(entry[0]) && finite(entry[1]) && entry[1] !== 0).map(([need, amount]) => [need, clamp(Math.round(amount), -100, 100)]))
  : fallback);

/** Fare, trip time and need cost of one trip from where the player is, after every modifier. */
export function quote(state: LifeState, destination: VenueId, modeId: TravelModeId, ctx: LifeContext): TripQuote {
  const mode = modeFor(state.estate.city, modeId);
  const from = state.location;
  const band = routeBand(state, from, destination);
  const data = { mode: modeId, destination, from, band };
  const waterRoute = modeId === 'boat' ? localRoute(state, destination) : undefined;
  if (modeId === 'boat' && !waterRoute) throw new Error('Boat travel requires a declared jetty route');
  const baseFare = waterRoute?.fare ?? (contentFor(state.estate.city).localModes ? mode.fare : fareBands[band]?.[modeId] ?? mode.fare);
  const fare = Math.max(0, Math.round(Number(modify(state, 'travel.fare', baseFare, data, ctx)) || 0));
  const baseSeconds = waterRoute?.seconds ?? Math.round(mode.seconds * BAND_TIME[band]);
  const seconds = clamp(Math.round(Number(modify(state, 'travel.duration', baseSeconds, data, ctx)) || baseSeconds), MIN_TRIP_SECONDS, MAX_TRIP_SECONDS);
  const needs = cleanNeeds(modify(state, 'travel.needCost', { ...mode.needs }, data, ctx), { ...mode.needs });
  return { mode: modeId, band, fare, seconds, needs, xp: mode.xp || {} };
}

/** Mode ids offered for a trip. Trek is always first, so there is always a free way to go. */
export function modesFor(state: LifeState, destination: VenueId, ctx: LifeContext): TravelModeId[] {
  const offered = modify(state, 'travel.modes', localModes(state.estate.city).map(mode => mode.id), { destination, from: state.location }, ctx);
  const waterRoute = localRoute(state, destination);
  const ids = (Array.isArray(offered) ? offered : BASE_MODE_IDS).filter((id, index, list) => typeof id === 'string' && Object.hasOwn(ALL_MODES, id) && list.indexOf(id) === index && (id !== 'boat' || Boolean(waterRoute)));
  if (waterRoute && !ids.includes('boat')) ids.push('boat');
  const allowed = ids.filter(id => modeAllowed(state, destination, id));
  return allowed.includes('trek') ? allowed : ['trek', ...allowed];
}

// ---- opening hours: one source of truth -------------------------------------------------

const waitText = (minutes: number): string => (minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`);

/** Opening state of a venue's hours with the one label every screen shows — see clock.js. */
export { openingInfo };

/**
 * Why this trip cannot start, or null. Pure: never mutates state. Does not check `busy`.
 * Codes: invalid_travel · coming_soon · already_here · travel_mode_unavailable · closed · insufficient_funds
 */
export function travelBlock(state: LifeState, destination: unknown, modeId: unknown, ctx: LifeContext): Block<TravelBlockCode> | null {
  if (destination === 'unilag' && state.estate.city !== 'lagos') {
    return { code: 'campus_lagos_only', reason: 'UNILAG is in Lagos. Choose Lagos from the world map to visit.' };
  }
  if (typeof destination === 'string' && Object.hasOwn(COMING_SOON, destination)) {
    return { code: 'coming_soon', reason: `${venueLabel(destination, ctx?.cityId)} is not open yet — it is coming soon.` };
  }
  if (!isVenue(destination, ctx.cityId) || !isModeId(modeId)) {
    return { code: 'invalid_travel', reason: 'Choose a valid destination and travel option.' };
  }
  if (destination === state.location) return { code: 'already_here', reason: 'You are already here.' };
  if (!modesFor(state, destination, ctx).includes(modeId)) {
    return { code: 'travel_mode_unavailable', reason: modeId === 'car' ? 'You do not own a car yet. Buy one in Phone → Cars, or pick another way to travel.' : `${modeFor(state.estate.city, modeId).label} is not available for this trip.` };
  }
  const label = venueLabel(destination, ctx?.cityId);
  const opening = openingInfo(venueFor(ctx.cityId, destination)?.hours, ctx?.now ?? state.t);
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

function travel(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext) {
  const blocked = busy(state);
  if (blocked) return blocked;
  const destination = payload?.id, modeId = payload?.mode;
  const why = travelBlock(state, destination, modeId, ctx);
  if (why) return fail(state, why.code, why.reason);
  // travelBlock only returns null for a known venue and mode; this narrows the untrusted payload.
  if (!isVenue(destination, ctx.cityId) || !isModeId(modeId)) return fail(state, 'invalid_travel', 'Choose a valid destination and travel option.');
  const trip = quote(state, destination, modeId, ctx);
  const label = venueLabel(destination, ctx.cityId);
  const mode = modeFor(state.estate.city, modeId);
  debit(state, trip.fare, `${mode.fuel ? 'Fuel' : mode.label} to ${label}`, ctx);
  state.travel.event = null; // an unanswered roadside choice lapses when you move on
  state.activeAction = { kind: 'travel', id: destination, duration: trip.seconds, remaining: trip.seconds, mode: modeId, fare: trip.fare };
  state.message = `Travelling to ${label}.`;
  return ok(state, 'started');
}

const signed = (amount: number): string => (amount > 0 ? `+${amount}` : `−${-amount}`);
const needsText = (needs: Record<string, number>): string => Object.entries(needs).map(([need, amount]) => `${signed(amount)} ${need.charAt(0).toUpperCase()}${need.slice(1)}`).join(', ');

/** Is this activity a gig for the daily limit? */
export const isGig = (def: ActivityDefinition | null | undefined): boolean => !!def && !def.requiresJob && ((def.reward ?? 0) > 0
  || ((outcomeRuleOf(def.id)?.success?.reward ?? 0) > 0 && !outcomeRuleOf(def.id)?.success.once));
const gigsToday = (state: LifeState, now: number): number => (state.travel.gigs.day === lagosTime(now).day ? state.travel.gigs.count : 0);

function pickEvent(state: LifeState, modeId: TravelModeId, ctx: LifeContext): RoadsideEvent | null {
  if (modeId === 'boat') return null;
  const today = lagosTime(ctx.now).day;
  const fits = Object.values(EVENTS).filter((event) => event.modes.includes(modeId) && !(event.oncePerDay && state.travel.eventDays[event.id] === today));
  if (!fits.length) return null;
  // The remedy seller always finds a sick trekker, so a cure is never down to luck.
  if (modeId === 'trek' && state.health?.sick === true) return EVENTS.agbo;
  if (ctx.rng() >= modeFor(state.estate.city, modeId).eventChance) return null;
  let roll = ctx.rng() * fits.reduce((sum, event) => sum + event.weight, 0);
  for (const event of fits) { roll -= event.weight; if (roll < 0) return event; }
  return fits[fits.length - 1] ?? null;
}

function complete(state: LifeState, active: TravelAction, ctx: LifeContext): void {
  const from = state.location, destination = active.id;
  const modeId = isModeId(active.mode) ? active.mode : null;
  // Quote before moving: the band depends on where the trip started.
  const trip = modeId ? quote(state, destination, modeId, ctx) : null;
  state.travel.lastTrip = { mode: modeId, from, to: destination };
  state.message = `Arrived at ${venueLabel(destination, ctx.cityId)}.`;
  arrive(state, destination, ctx, { mode: modeId }); // listeners (weather, goals) may append to state.message
  const identity = cityReference(state.estate.city, destination);
  const first = !state.travel.visited.includes(identity);
  if (first) state.travel.visited = [...state.travel.visited, identity].slice(-MAX_VISITED);
  state.travel.trips = Math.min(Number.MAX_SAFE_INTEGER, state.travel.trips + 1);
  if (trip) {
    changeNeeds(state, trip.needs);
    for (const [skill, amount] of Object.entries(trip.xp)) addSkillXp(state, skill, amount, ctx);
    const costs = Object.fromEntries(Object.entries(trip.needs).filter(([, amount]) => amount < 0));
    if (Object.keys(costs).length) state.message += ` The ${modeFor(state.estate.city, trip.mode).label.toLowerCase()} cost you ${needsText(costs)}.`;
  }
  emit(state, 'venue.visited', { venue: destination, first }, ctx);
  const event = trip ? pickEvent(state, trip.mode, ctx) : null;
  if (event) {
    if (event.oncePerDay) state.travel.eventDays[event.id] = lagosTime(ctx.now).day;
    state.travel.event = { id: event.id, at: ctx.now };
    state.message += ` ${event.title} — choose what to do.`;
    emit(state, 'roadside.offered', { event: event.id }, ctx);
  }
}

// ---- outcomes shared by roadside choices and chance activities --------------------------

/** Apply one outcome block. Money out is taken as far as the wallet allows; it never goes negative. */
function applyOutcome(state: LifeState, outcome: OutcomeBlock, reason: string, ctx: LifeContext): void {
  const lost = (outcome.cost || 0) + (outcome.fine || 0);
  if (lost > 0) debit(state, lost, reason, ctx, { partial: true });
  if ((outcome.reward ?? 0) > 0) credit(state, outcome.reward ?? 0, reason, ctx);
  changeNeeds(state, outcome.effects);
  for (const [skill, amount] of Object.entries(outcome.xp || {})) addSkillXp(state, skill, amount, ctx);
  if (outcome.moodlet) addMoodlet(state, outcome.moodlet, ctx);
  if (outcome.treat) emit(state, 'health.treat', { by: reason }, ctx);
}

const chanceOf = (state: LifeState, check: SkillCheck<unknown, unknown>): number => Math.min(check.max ?? 1, check.base + check.perLevel * skillLevel(state, check.skill));

function roadside(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext) {
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

function rollActivity(state: LifeState, id: ActivityId, rule: ActivityOutcomeRule, ctx: LifeContext): void {
  const success = ctx.rng() < chanceOf(state, rule);
  let outcome: ActivitySuccessOutcome = success ? rule.success : rule.failure;
  const label = findActivity(id, ctx.cityId)?.def.label ?? id;
  if (success && outcome.once) {
    if (state.travel[outcome.once]) {
      // Every `once` outcome in content has a `repeat`; paying the one-time reward again would be silent corruption.
      if (!outcome.repeat) throw new Error(`activity ${id}: the one-time outcome "${outcome.once}" has no repeat outcome`);
      outcome = outcome.repeat;
    }
    else state.travel[outcome.once] = true;
  }
  applyOutcome(state, outcome, label, ctx);
  state.message = `${label}: ${outcome.result}`;
  if (success && outcome.event) emit(state, outcome.event, { venue: state.location }, ctx);
  emit(state, 'activity.outcome', { id, success }, ctx);
}

/** The starter job's shift has one break for the whole character: it is filed once, whichever city's counter it was worked at. */
const SHARED_SHIFT = 'helper-shift';
const isStarterShift = (def: { requiresJob?: unknown; careerTrack?: unknown } | undefined): boolean => Boolean(def?.requiresJob) && !def?.careerTrack;
const cooldownKey = (city: string, def: { id: string; requiresJob?: unknown; careerTrack?: unknown }): string => isStarterShift(def) ? SHARED_SHIFT : cityReference(city, def.id);
const cooldownLeft = (state: LifeState, id: string, now: number): number => {
  const def = findActivity(id, state.estate.city)?.def;
  const book = state.travel?.cooldowns ?? {};
  // A break filed under the city (by a build before the starter break was shared) still counts.
  const readyAt = Math.max(book[def ? cooldownKey(state.estate.city, def) : cityReference(state.estate.city, id)] ?? 0, book[cityReference(state.estate.city, id)] ?? 0);
  return Math.max(0, Math.ceil((readyAt - now) / 1000));
};

const hasActivity = (city: string, id: string): boolean => Boolean(findActivity(id, city));
const hasVenue = (city: string, id: string): boolean => Boolean(venueFor(city, id));
const cleanVisits = (value: unknown, city: string): string[] => [...new Set((Array.isArray(value) ? value : []).slice(-MAX_VISITED).flatMap(key => {
  const reference = readCityReference(key, city, hasVenue);
  return reference ? [cityReference(reference.cityId, reference.id)] : [];
}))];
function cleanCooldowns(value: unknown, city: string, now: number): Record<string, number> {
  const kept: Record<string, number> = {};
  for (const [key, readyAt] of Object.entries(isRecord(value) ? value : {}).slice(0, MAX_COOLDOWNS)) {
    if (!finite(readyAt) || readyAt <= now || readyAt > Number.MAX_SAFE_INTEGER) continue;
    const reference = readCityReference(key, city, hasActivity);
    if (!reference) continue;
    const identity = cityReference(reference.cityId, reference.id);
    if (!cachedCityContent(reference.cityId)) { kept[identity] = Math.min(readyAt, now + MAX_COLD_COOLDOWN_MS); continue; }
    const seconds = findActivity(reference.id, reference.cityId)?.def.cooldown;
    // Active-city rules always bound the timer. A cold origin is checked when its content loads.
    if (finite(seconds) && seconds > 0) kept[identity] = Math.min(readyAt, now + seconds * 1000);
  }
  return kept;
}

// ---- state ------------------------------------------------------------------------------

function sanitize(input: SavedInput, state: LifeState, ctx: LifeContext): void {
  const saved = isRecord(input.travel) ? input.travel : {};
  const now = finite(ctx?.now) ? ctx.now : state.t;
  const event = isRecord(saved.event) && isEventId(saved.event.id) && finite(saved.event.at) ? { id: saved.event.id, at: saved.event.at } : null;
  const trip = saved.lastTrip;
  const lastTrip = isRecord(trip) && isVenue(trip.to, ctx.cityId) && isVenue(trip.from, ctx.cityId)
    && (trip.mode === null || isModeId(trip.mode)) ? { mode: trip.mode, from: trip.from, to: trip.to } : null;
  const cooldowns = cleanCooldowns(saved.cooldowns, ctx.cityId, now);
  state.travel = {
    home: houseSpotFor(ctx.cityId, saved.home) ? String(saved.home) : defaultHouseFor(ctx.cityId).id,
    event, lastTrip,
    visited: cleanVisits(saved.visited, ctx.cityId),
    trips: safeCount(saved.trips) ? saved.trips : 0,
    cooldowns,
    funded: saved.funded === true,
    gigs: isRecord(saved.gigs) && safeCount(saved.gigs.day) && safeCount(saved.gigs.count) ? { day: saved.gigs.day, count: Math.min(saved.gigs.count, GIG_DAILY_LIMIT) } : { day: 0, count: 0 },
    eventDays: Object.fromEntries(Object.entries(isRecord(saved.eventDays) ? saved.eventDays : {}).filter(([id, day]) => isEventId(id) && EVENTS[id].oncePerDay && safeCount(day))),
  };
}

function setHome(state: LifeState, id: unknown): void { if (typeof id === 'string' && houseSpotFor(state.estate.city, id)) state.travel.home = id; }

// ---- view -------------------------------------------------------------------------------

function modeCard(state: LifeState, destination: VenueId, modeId: TravelModeId, base: Block<TravelBlockCode> | null, ctx: LifeContext): TravelModeCard {
  const mode = modeFor(state.estate.city, modeId);
  const trip = quote(state, destination, modeId, ctx);
  const blocked = base || (!canAfford(state, trip.fare) ? travelBlock(state, destination, modeId, ctx) : null);
  return { id: modeId, label: mode.label, icon: mode.icon, blurb: mode.blurb, fuel: Boolean(mode.fuel), fare: trip.fare, seconds: trip.seconds, needs: trip.needs, xp: trip.xp, blocked };
}

function destinationCard(state: LifeState, venue: VenueDefinition, ctx: LifeContext): TravelDestination {
  const now = ctx.now, id = venue.id, here = id === state.location;
  const opening = openingInfo(venue.hours, now);
  const place = placeOf(state, id)!; // non-null: id is a key of VENUES, which placeOf always finds
  // Reasons that do not depend on the mode are worked out once and shared by every tile.
  const base: Block<TravelBlockCode> | null = venue.cities && !(venue.cities as readonly string[]).includes(ctx.cityId) ? travelBlock(state, id, 'trek', ctx) : here ? { code: 'already_here', reason: 'You are already here.' } : !opening.open ? travelBlock(state, id, 'trek', ctx) : null;
  return {
    id, kind: id === 'home' ? 'home' : 'venue', label: venueLabel(id, ctx.cityId), district: id === 'home' ? (state.estate?.living === 'own' ? lgaOf(state.estate.city, state.estate.plot?.lga ?? state.estate.lga)?.name ?? 'Your house' : houseSpotFor(state.estate.city, homeId(state))?.district ?? '') : venueDistrict(id, ctx.cityId),
    icon: venue.icon, description: venue.description, category: venue.category, x: place.x, y: place.y, zone: place.zone,
    here, visited: state.travel.visited.includes(cityReference(state.estate.city, id)), open: opening.open, hours: opening.hours, status: opening.status,
    band: here ? null : (contentFor(state.estate.city).localModes && routeBand(state, state.location, id) === 'far' ? 'Longer city trip' : BAND_LABELS[routeBand(state, state.location, id)]),
    ambient: venue.ambient?.length ? venue.ambient[Math.floor(now / 8000) % venue.ambient.length] ?? '' : '',
    preview: spotsOf(id, ctx.cityId).flatMap((spot) => spot.activities.map((def) => def.label)),
    blocked: base,
    modes: modesFor(state, id, ctx).map((modeId) => modeCard(state, id, modeId, base, ctx)),
  };
}

function view(state: LifeState, ctx: LifeContext): TravelView {
  const queued = state.travel.event;
  const pending = queued && EVENTS[queued.id];
  const trip = state.activeAction?.kind === 'travel' ? state.activeAction : null;
  // A visitor has no home in this city until it chooses a local government: Home is not offered as a place (unless the life stands in it).
  const placed = Boolean(state.estate.lga);
  const venues = venuesFor(ctx.cityId).filter((venue) => !venue.cities || (venue.cities as readonly string[]).includes(ctx.cityId)).filter((venue) => placed || venue.id !== 'home' || state.location === 'home').map((venue) => destinationCard(state, venue, ctx));
  const soon = Object.values(COMING_SOON).map((place): TravelDestination => ({
    id: place.id, kind: 'soon', label: venueLabel(place.id, ctx.cityId), district: venueDistrict(place.id, ctx.cityId), icon: place.icon, description: place.description,
    category: 'soon', x: place.map.x, y: place.map.y, zone: place.zone, here: false, visited: false, open: false, hours: 'Coming soon', status: 'Coming soon',
    band: null, ambient: '', preview: [], modes: [], blocked: travelBlock(state, place.id, 'trek', ctx),
  }));
  return {
    modes: [...localModes(state.estate.city)],
    duration: TRAVEL_DURATION,
    defaultMode: DEFAULT_MODE,
    home: homeId(state),
    trips: state.travel.trips,
    visited: state.travel.visited.filter(key => readCityReference(key, ctx.cityId, hasVenue)?.cityId === ctx.cityId).length,
    destinations: [...venues, ...soon],
    event: pending && queued ? {
      id: pending.id, icon: pending.icon, title: pending.title, text: pending.text, at: queued.at,
      expiresIn: Math.max(0, Math.ceil(EVENT_TTL_SECONDS - (ctx.now - queued.at) / 1000)),
      choices: pending.choices.map((choice) => ({
        id: choice.id, label: choice.label, hint: choice.hint, cost: choice.cost || 0,
        chance: choice.check ? Math.round(chanceOf(state, choice.check) * 100) : null,
        blocked: choice.cost && !canAfford(state, choice.cost) ? { code: 'insufficient_funds', reason: `Costs ${naira(choice.cost)}; you have ${naira(state.cash)}.` } : null,
      })),
    } : null,
    cooldowns: Object.fromEntries(Object.keys(state.travel.cooldowns).flatMap((key): [string, number][] => {
      const reference = readCityReference(key, ctx.cityId, hasActivity);
      if (reference?.cityId !== ctx.cityId) return [];
      const left = cooldownLeft(state, reference.id, ctx.now);
      return left > 0 ? [[reference.id, left]] : [];
    }).concat(contentFor(ctx.cityId).workplaces.flatMap((place): [string, number][] => {
      const left = !place.definition.track ? cooldownLeft(state, place.definition.shift.id, ctx.now) : 0;
      return left > 0 ? [[place.definition.shift.id, left]] : [];
    }))),
    gigs: { limit: GIG_DAILY_LIMIT, used: gigsToday(state, ctx.now), left: Math.max(0, GIG_DAILY_LIMIT - gigsToday(state, ctx.now)) },
    // The gigs offered at the spot the player stands at (activity ids), so the venue panel can show the counter beside them.
    gigsHere: (spotsOf(state.location, ctx.cityId).find((spot) => spot.id === state.spot)?.activities || []).filter(isGig).map((def) => def.id),
    // The trip in progress: where it started (a cancel leaves the player there), how, and the fare already paid (null on an older save).
    active: trip ? { from: state.location, to: trip.id, mode: typeof trip.mode === 'string' ? trip.mode : null, fare: typeof trip.fare === 'number' && Number.isSafeInteger(trip.fare) ? trip.fare : null, refundable: false } : null,
  };
}

/**
 * What only a host that plays the game runs: player actions, settling time and event listeners. The browser reads lives, it never plays them,
 * so its build leaves this out (PLAYS is false there: src/game/profile.ts).
 */
const play = PLAYS ? {
  actions: { travel, 'world.roadside': roadside },
  advance(state, dt, ctx) {
    const now = finite(ctx?.now) ? ctx.now : state.t;
    if (state.travel.event && now - state.travel.event.at >= EVENT_TTL_SECONDS * 1000) state.travel.event = null;
    for (const [id, readyAt] of Object.entries(state.travel.cooldowns)) if (readyAt <= now) delete state.travel.cooldowns[id];
  },
  on: {
    'life.started': (state, data) => setHome(state, data?.house),
    'house.moved': (state, data) => setHome(state, data?.house ?? data?.id),
    'city.changed'(state, { from }, ctx) {
      state.travel.cooldowns = cleanCooldowns(state.travel.cooldowns, from, ctx.now);
      state.travel.visited = cleanVisits(state.travel.visited, from);
      state.travel.lastTrip = null;
      state.travel.event = null;
    },
    'activity.completed': (state, data, ctx) => {
      const def = data?.def;
      if (!def) return;
      const now = finite(ctx?.now) ? ctx.now : state.t;
      if (finite(def.cooldown) && def.cooldown > 0) {
        const key = cooldownKey(state.estate.city, def), ids = Object.keys(state.travel.cooldowns);
        if (ids.length >= MAX_COOLDOWNS && !Object.hasOwn(state.travel.cooldowns, key)) delete state.travel.cooldowns[ids[0] ?? ''];
        state.travel.cooldowns[key] = now + def.cooldown * 1000;
      }
      if (isGig(def)) {
        const day = lagosTime(now).day;
        state.travel.gigs = { day, count: Math.min(GIG_DAILY_LIMIT, gigsToday(state, now) + 1) };
      }
      for (const id of def.clears || []) removeMoodlet(state, id);
      const rule = outcomeRuleOf(def.id);
      if (rule) rollActivity(state, def.id, rule, ctx);
    },
  },
} satisfies Pick<SystemDefinition<'travel'>, 'actions' | 'advance' | 'on'> : LEFT_OUT;

export default {
  id: 'travel',
  stateKeys: ['travel'],
  sanitize,
  active: {
    travel: {
      moves: true,
      sanitize(value, state, ctx) {
        if (!venueFor(ctx.cityId, value.id) || value.id === state.location) return null;
        if (value.mode === undefined) return value.duration === TRAVEL_DURATION ? {} : null;
        if (!isModeId(value.mode) || value.duration < MIN_TRIP_SECONDS || value.duration > MAX_TRIP_SECONDS || !modeAllowed(state, value.id, value.mode) || (value.mode === 'boat' && !localRoute(state, value.id))) return null;
        return { mode: value.mode, ...(typeof value.fare === 'number' && Number.isSafeInteger(value.fare) && value.fare >= 0 && value.fare <= MAX_TRIP_FARE ? { fare: value.fare } : {}) };
      },
      complete,
    },
  },
  view,
  modifiers: {
    'activity.block': (value, state, data, ctx) => {
      const def = data?.def;
      if (value || !def) return value;
      const left = cooldownLeft(state, def.id, ctx?.now ?? state.t);
      if (left > 0) return { code: 'cooldown', reason: `You did this recently. ${def.label} is available again in ${left >= 60 ? `${Math.floor(left / 60)}m ${left % 60}s` : `${left}s`}.` };
      if (isGig(def) && gigsToday(state, ctx?.now ?? state.t) >= GIG_DAILY_LIMIT) {
        return { code: 'gig_limit', reason: `You have done today’s ${GIG_DAILY_LIMIT} paid gigs. Gigs open again at midnight, Nigerian time. Your job’s shift is not affected.` };
      }
      if (def.requiresMoodlet && !feelingsOf(state).some((feeling) => feeling.id === def.requiresMoodlet)) {
        return { code: 'not_needed', reason: def.requiresReason || 'You do not need this right now.' };
      }
      return null;
    },
  },
  ...play,
} satisfies SystemDefinition<'travel'>;
