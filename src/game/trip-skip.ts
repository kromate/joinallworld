/**
 * OWNER: world
 * Skipping the rest of a trip for game money: the 'travel.skip' action and the offer the screens show.
 * Prices and limits: content/travel.ts (TRIP_SKIP, tripSkipFee). Registered by systems/travel.ts.
 *
 * WHAT CAN BE SKIPPED
 *   - a trip between two cities (timed-action kind 'intercity'), at any point with TRIP_SKIP.minRemainingSeconds or more left;
 *   - a trip between two venues (kind 'travel') while more than TRIP_SKIP.localMinRemainingSeconds is left.
 *   Nothing else is a trip here: the automatic commute is free and can be cancelled, and the campus shuttle keeps its own rules.
 *
 * WHAT A SKIP DOES
 *   It charges the price and then ends the trip through the engine's own completion (advanceActive with exactly the
 *   seconds that were left), so the arrival is the one a waited-out trip has: the same handler, the same events
 *   ('travel.arrived', 'venue.visited', 'city.changed'), the same need costs, XP, roadside roll and message. Only two
 *   things differ: the money paid, and the clock — a skip does not move it. The game runs on the server's clock, so the
 *   seconds skipped are simply not waited; background decay, bills, opening hours and daily limits follow that clock as
 *   they always do and none of them is brought forward or avoided.
 *
 * THE PRICE THAT WAS SHOWN
 *   The price falls as the trip goes on, and a screen is a moment behind the server. A request may carry `quote`, the
 *   price on the button that was pressed. A quote the server's price has since fallen below is charged as shown while it
 *   is no older than TRIP_SKIP.quoteGraceSeconds (never less than the server's own price); a quote BELOW the server's
 *   price is refused with 'price_changed' and nothing is charged. Without a quote the server's price is charged.
 *
 * THE FIRST ONE IS FREE
 *   The first skip between cities of each character costs nothing (TRIP_SKIP.firstIntercityFree). It is remembered as
 *   `state.travel.skipped`, false until a trip between cities is skipped (and on every save from before skipping).
 */
import type { Block } from '../types/content.ts';
import type { IntercityAction, LifeContext, LifeState, TravelAction } from '../types/life.ts';
import type { TripSkipCode } from '../types/actions.ts';
import type { TripSkipOffer } from '../types/view.ts';
import { cityRules } from './cities/registry.ts';
import { TRIP_SKIP, tripSkipFee } from './content/travel.ts';
import { venueLabel } from './content/venues.ts';
import { advanceActive, canAfford, debit } from './api.ts';
import { fail, naira, ok, safeCount } from './util.ts';

type Trip = TravelAction | IntercityAction;
const tripOf = (state: LifeState): Trip | null => {
  const active = state.activeAction;
  return active && (active.kind === 'intercity' || active.kind === 'travel') ? active : null;
};
const isFree = (state: LifeState, trip: Trip): boolean => trip.kind === 'intercity' && TRIP_SKIP.firstIntercityFree && state.travel.skipped !== true;
/** The server's price for skipping this trip with `remaining` seconds left. */
const priceOf = (state: LifeState, trip: Trip, remaining: number): number => (isFree(state, trip) ? 0
  : trip.kind === 'intercity' ? tripSkipFee('intercity', remaining, trip.fare) : tripSkipFee('local', remaining));

/**
 * What the screens show while a trip runs, or null when there is nothing to offer (no trip, or a trip inside the city
 * that is too short to sell). Pure: never mutates state. `blocked` says why the button is off.
 */
export function skipOffer(state: LifeState): TripSkipOffer | null {
  const trip = tripOf(state);
  if (!trip) return null;
  const left = trip.remaining;
  if (trip.kind === 'travel' && left <= TRIP_SKIP.localMinRemainingSeconds) return null;
  const fee = priceOf(state, trip, left), free = isFree(state, trip);
  const blocked: Block<'almost_there' | 'insufficient_funds'> | null = left < TRIP_SKIP.minRemainingSeconds
    ? { code: 'almost_there', reason: 'You arrive in a moment. Waiting is free.' }
    : !canAfford(state, fee) ? { code: 'insufficient_funds', reason: `You need ${naira(fee - state.cash)} more` } : null;
  return { kind: trip.kind, fee, free, confirm: fee >= TRIP_SKIP.confirmFrom, blocked };
}

/** 'travel.skip' { quote? }: pay and arrive now. */
export function skipTrip(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext) {
  const trip = tripOf(state);
  if (!trip) return fail<TripSkipCode>(state, 'not_travelling', 'You are not on a trip, so there is nothing to skip.');
  const left = trip.remaining;
  if (left < TRIP_SKIP.minRemainingSeconds) return fail<TripSkipCode>(state, 'almost_there', 'You arrive in a moment. Waiting is free, so nothing was charged.');
  if (trip.kind === 'travel' && left <= TRIP_SKIP.localMinRemainingSeconds) {
    return fail<TripSkipCode>(state, 'too_short', `This trip is almost over. A trip inside the city can be skipped only while more than ${TRIP_SKIP.localMinRemainingSeconds} seconds are left. Nothing was charged.`);
  }
  const fee = priceOf(state, trip, left), quote = payload?.quote;
  let charge = fee;
  if (safeCount(quote)) {
    if (quote < fee) return fail<TripSkipCode>(state, 'price_changed', `Skipping the rest of this trip now costs ${naira(fee)}. Nothing was charged.`);
    if (quote <= priceOf(state, trip, Math.min(trip.duration, left + TRIP_SKIP.quoteGraceSeconds))) charge = quote;
  }
  if (!canAfford(state, charge)) {
    return fail<TripSkipCode>(state, 'insufficient_funds', `Skipping the rest of this trip costs ${naira(charge)}; you have ${naira(state.cash)}. You need ${naira(charge - state.cash)} more, or wait: the price falls as you get closer.`);
  }
  const free = isFree(state, trip);
  const where = trip.kind === 'intercity' ? `(${cityRules(trip.from)?.name ?? trip.from} → ${cityRules(trip.id)?.name ?? trip.id})` : `to ${venueLabel(trip.id, ctx.cityId)}`;
  if (charge > 0) debit(state, charge, `Trip skipped ${where}`, ctx);
  if (trip.kind === 'intercity') state.travel.skipped = true;
  // The engine's own completion, with exactly the seconds that were left: the arrival of a trip that was waited out.
  if (advanceActive(state, left, ctx) !== 'completed') throw new Error('A skipped trip must complete');
  state.message = `${state.message} ${charge > 0 ? `You skipped the rest of the trip for ${naira(charge)}.` : free ? 'You skipped the rest of the trip. The first skip between cities is free.' : 'You skipped the rest of the trip.'}`.trim();
  return ok(state, 'skipped');
}
