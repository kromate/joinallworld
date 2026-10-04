/**
 * OWNER: growth
 * The life's side of the events calendar (content/calendar.js, ../calendar.js): which events this
 * life has shown up at, and spraying naira at an event that allows it.
 *
 * An event changes no price, pay or need by itself. Finishing any activity at a venue while an
 * event is on there counts as attending it, once per occurrence.
 *
 * STATE — state.events
 *   attended   [occurrenceKey] — the last occurrences attended, newest last (so each counts once)
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
import { emit, isDeparting } from '../registry.js';
import { fail, finite, isRecord, naira, ok, safeCount } from '../util.js';
import { lagosTime } from '../clock.js';
import { canAfford, changeNeeds, debit } from '../api.js';
import { SPRAY } from '../content/calendar.js';
import { eventAtVenue, eventsAt } from '../calendar.js';

const KEEP = 24;
const KEY = /^[a-z0-9-]{1,40}:\d{1,7}$/;
const nowOf = (state, ctx) => (finite(ctx?.now) && ctx.now > 0 ? ctx.now : state.t);
const here = (state, ctx) => (isDeparting(state) ? null : eventAtVenue(nowOf(state, ctx), state.location, ctx?.cityId ?? 'lagos'));
const sprayedToday = (state, ctx) => (state.events.spray.day === lagosTime(nowOf(state, ctx)).day ? state.events.spray.spent : 0);

export function spray(state, payload, ctx) {
  const event = here(state, ctx), amount = payload?.amount;
  if (!event || !event.spray) return fail(state, 'no_event', 'Spraying happens at a party. Check Events for the next owambe and be there while it is on.');
  if (!SPRAY.amounts.includes(amount)) return fail(state, 'invalid_amount', `Spray ${SPRAY.amounts.map(naira).join(', ')}.`);
  const spent = sprayedToday(state, ctx);
  if (spent + amount > SPRAY.perDay) return fail(state, 'spray_limit', `You have sprayed ${naira(spent)} today. The limit is ${naira(SPRAY.perDay)} a day, so nobody empties their wallet in one night.`);
  if (!canAfford(state, amount)) return fail(state, 'insufficient_funds', `Spraying ${naira(amount)} needs ${naira(amount)}; you have ${naira(state.cash)}.`);
  debit(state, amount, `Sprayed at ${event.title}`, ctx);
  state.events.spray = { day: lagosTime(nowOf(state, ctx)).day, spent: spent + amount };
  state.events.sprayed = Math.min(Number.MAX_SAFE_INTEGER, state.events.sprayed + amount);
  const scale = amount / SPRAY.amounts[0];
  changeNeeds(state, { social: Math.min(30, SPRAY.social * Math.sqrt(scale)), fun: Math.min(20, SPRAY.fun * Math.sqrt(scale)) });
  state.message = `You sprayed ${naira(amount)} at ${event.title}. The whole place noticed.`;
  emit(state, 'event.sprayed', { id: event.id, amount }, ctx);
  return ok(state, 'sprayed');
}

export default {
  id: 'events',
  stateKeys: ['events'],
  sanitize(input, state) {
    const saved = isRecord(input.events) ? input.events : {};
    state.events = {
      attended: [...new Set((Array.isArray(saved.attended) ? saved.attended : []).filter((key) => typeof key === 'string' && KEY.test(key)))].slice(-KEEP),
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
      live: eventsAt(now, ctx?.cityId ?? 'lagos').map((item) => ({ id: item.id, key: item.key, venue: item.venue, attended: state.events.attended.includes(item.key) })),
      here: event ? { id: event.id, key: event.key, title: event.title, spray: event.spray, attended: state.events.attended.includes(event.key) } : null,
      spray: { amounts: SPRAY.amounts, perDay: SPRAY.perDay, spentToday: spent, left: Math.max(0, SPRAY.perDay - spent) },
      count: state.events.count, sprayed: state.events.sprayed,
    };
  },
};
