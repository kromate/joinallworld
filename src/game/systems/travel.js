/**
 * OWNER: world
 * Travel between venues: modes, fares, duration, need costs, roadside events.
 *
 * Ported starter behaviour (extend freely): every trip takes TRAVEL_DURATION seconds, the
 * fare is charged on departure and not refunded on cancel, Home accepts only the free trek.
 * Action: 'travel' { id: venueId, mode }.   Timed-action kind: 'travel'.
 * State: none of its own yet (use `state.travel` for anything you add and list it in stateKeys).
 * Emits 'travel.arrived' (via api.arrive). Fare passes through modify('travel.fare', fare, { mode, destination }).
 */
import { modify } from '../registry.js';
import { busy, fail, naira, ok } from '../util.js';
import { arrive, canAfford, debit } from '../api.js';
import { VENUES, venueLabel } from '../content/venues.js';
import { TRAVEL_MODES, TRAVEL_DURATION } from '../content/travel.js';

function travel(state, payload, ctx) {
  const blocked = busy(state);
  if (blocked) return blocked;
  const destination = payload?.id, mode = payload?.mode;
  if (typeof destination !== 'string' || !Object.hasOwn(VENUES, destination) || typeof mode !== 'string' || !Object.hasOwn(TRAVEL_MODES, mode)) {
    return fail(state, 'invalid_travel', 'Choose a valid destination and travel option.');
  }
  const venue = VENUES[destination];
  if (venue.travelMode && mode !== venue.travelMode) {
    return fail(state, destination === 'home' ? 'home_travel_free_only' : 'travel_mode_unavailable',
      `${venue.label} uses free beta travel. Choose ${TRAVEL_MODES[venue.travelMode].label.toLowerCase()}.`);
  }
  if (destination === state.location) return fail(state, 'already_here', 'You are already here.');
  const fare = Math.max(0, Math.round(modify(state, 'travel.fare', TRAVEL_MODES[mode].fare, { mode, destination }, ctx)));
  if (!canAfford(state, fare)) return fail(state, 'insufficient_funds', `You do not have enough cash for this fare. It costs ${naira(fare)}; you have ${naira(state.cash)}.`);
  const label = venueLabel(destination, ctx.cityId);
  debit(state, fare, `${TRAVEL_MODES[mode].label} to ${label}`, ctx);
  state.activeAction = { kind: 'travel', id: destination, duration: TRAVEL_DURATION, remaining: TRAVEL_DURATION };
  state.message = `Travelling to ${label}.`;
  return ok(state, 'started');
}

export default {
  id: 'travel',
  stateKeys: [],
  sanitize() {},
  actions: { travel },
  active: {
    travel: {
      sanitize(value, state) {
        return Object.hasOwn(VENUES, value.id) && value.id !== state.location && value.duration === TRAVEL_DURATION ? {} : null;
      },
      complete(state, active, ctx) {
        arrive(state, active.id, ctx);
        state.message = `Arrived at ${venueLabel(active.id, ctx.cityId)}.`;
      },
    },
  },
  advance() {},
  view() { return { modes: Object.values(TRAVEL_MODES), duration: TRAVEL_DURATION }; },
};
