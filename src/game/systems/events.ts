/**
 * OWNER: growth
 * The life's side of the events calendar (content/calendar.ts, ../calendar.ts): which events this
 * life has shown up at, and spraying naira at an event that allows it.
 *
 * An event changes no price, pay or need by itself. Finishing any activity at a venue while an
 * event is on there counts as attending it, once per occurrence.
 *
 * STATE — state.events
 *   attended   [occurrenceKey] — city-qualified outside Lagos; the last occurrences attended, newest last
 *   count      lifetime events attended
 *   spray      { day, spent } — naira sprayed on that Lagos day;  sprayed  lifetime naira sprayed
 *
 * ACTIONS
 *   'events.spray' { amount }   at a live event with `spray: true`: pay `amount` (one of SPRAY.amounts)
 *                               for Social and Fun. A pure sink: nobody receives the money. At most
 *                               SPRAY.perDay a Lagos day.
 * EMITS    'event.attended' { id, venue }     'event.sprayed' { id, amount }
 * LISTENS  'activity.completed'
 */
import { emit, isDeparting } from '../registry.ts';
import { fail, finite, isId, isRecord, naira, ok, safeCount } from '../util.ts';
import { lagosTime } from '../clock.ts';
import { canAfford, changeNeeds, debit } from '../api.ts';
import { SPRAY } from '../content/calendar.ts';
import { eventAtVenue, eventsAt } from '../calendar.ts';
import type { SystemDefinition, TypedActionHandler } from '../../types/registry.ts';
import type { LifeContext, LifeState } from '../../types/life.ts';
import { cachedCityContent, isCityId } from '../cities/registry.ts';
import { contentFor } from '../cities/runtime.ts';

const KEEP = 24;
const DAY = /^\d{1,7}$/;
const occurrenceKey = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const parts = value.split(':');
  if (parts.length === 2 && isId(parts[0]) && DAY.test(parts[1] ?? '') && contentFor('lagos').events.some((event) => event.id === parts[0])) return value; // deployed Lagos key
  if (parts.length === 3 && isCityId(parts[0]) && isId(parts[1]) && DAY.test(parts[2] ?? '')) {
    const origin = cachedCityContent(parts[0]);
    if (origin && !origin.events.some((event) => event.id === parts[1])) return null;
    return value;
  }
  return null;
};
const nowOf = (state: LifeState, ctx: LifeContext): number => (finite(ctx?.now) && ctx.now > 0 ? ctx.now : state.t);
const here = (state: LifeState, ctx: LifeContext) => (isDeparting(state) ? null : eventAtVenue(nowOf(state, ctx), state.location, ctx.cityId));
const sprayedToday = (state: LifeState, ctx: LifeContext): number => (state.events.spray.day === lagosTime(nowOf(state, ctx)).day ? state.events.spray.spent : 0);

export const spray: TypedActionHandler<'events.spray'> = (state, payload, ctx) => {
  const event = here(state, ctx), amount = payload?.amount;
  if (!event || !event.spray) return fail(state, 'no_event', 'Spraying happens at a party. Check Events for the next owambe and be there while it is on.');
  if (typeof amount !== 'number' || !SPRAY.amounts.includes(amount)) return fail(state, 'invalid_amount', `Spray ${SPRAY.amounts.map(naira).join(', ')}.`);
  const spent = sprayedToday(state, ctx);
  if (spent + amount > SPRAY.perDay) return fail(state, 'spray_limit', `You have sprayed ${naira(spent)} today. The limit is ${naira(SPRAY.perDay)} a day, so nobody empties their wallet in one night.`);
  if (!canAfford(state, amount)) return fail(state, 'insufficient_funds', `Spraying ${naira(amount)} needs ${naira(amount)}; you have ${naira(state.cash)}.`);
  debit(state, amount, `Sprayed at ${event.title}`, ctx);
  state.events.spray = { day: lagosTime(nowOf(state, ctx)).day, spent: spent + amount };
  state.events.sprayed = Math.min(Number.MAX_SAFE_INTEGER, state.events.sprayed + amount);
  const scale = amount / (SPRAY.amounts[0] ?? 1); // amounts is never empty here: it just included `amount`
  changeNeeds(state, { social: Math.min(30, SPRAY.social * Math.sqrt(scale)), fun: Math.min(20, SPRAY.fun * Math.sqrt(scale)) });
  state.message = `You sprayed ${naira(amount)} at ${event.title}. The whole place noticed.`;
  emit(state, 'event.sprayed', { id: event.id, amount }, ctx);
  return ok(state, 'sprayed');
};

export default {
  id: 'events',
  stateKeys: ['events'],
  sanitize(input, state) {
    const saved = isRecord(input.events) ? input.events : {};
    const attended: unknown[] = Array.isArray(saved.attended) ? saved.attended : [];
    state.events = {
      attended: [...new Set(attended.flatMap((key) => { const clean = occurrenceKey(key); return clean ? [clean] : []; }))].slice(-KEEP),
      count: safeCount(saved.count) ? saved.count : 0,
      spray: isRecord(saved.spray) && safeCount(saved.spray.day) && safeCount(saved.spray.spent) && saved.spray.spent <= SPRAY.perDay ? { day: saved.spray.day, spent: saved.spray.spent } : { day: 0, spent: 0 },
      sprayed: safeCount(saved.sprayed) ? saved.sprayed : 0,
    };
  },
  actions: { 'events.spray': spray },
  on: {
    'activity.completed'(state, data, ctx) {
      const event = here(state, ctx);
      if (!event || state.events.attended.includes(event.key)) return;
      state.events.attended.push(event.key);
      if (state.events.attended.length > KEEP) state.events.attended.splice(0, state.events.attended.length - KEEP);
      state.events.count = Math.min(Number.MAX_SAFE_INTEGER, state.events.count + 1);
      emit(state, 'event.attended', { id: event.id, venue: event.venue }, ctx);
    },
  },
  view(state, ctx) {
    const now = nowOf(state, ctx), event = here(state, ctx), spent = sprayedToday(state, ctx);
    return {
      live: eventsAt(now, ctx.cityId).map((item) => ({ id: item.id, key: item.key, venue: item.venue, attended: state.events.attended.includes(item.key) })),
      here: event ? { id: event.id, key: event.key, title: event.title, spray: event.spray, attended: state.events.attended.includes(event.key) } : null,
      spray: { amounts: SPRAY.amounts, perDay: SPRAY.perDay, spentToday: spent, left: Math.max(0, SPRAY.perDay - spent) },
      count: state.events.count, sprayed: state.events.sprayed,
    };
  },
} satisfies SystemDefinition<'events'>;
