/**
 * OWNER: world
 * Safety nets: so that a player is never stuck. Numbers: content/relief.ts. Registered by systems/travel.ts (the odd jobs, the
 * bench and the tap, the repayment action) and systems/estate.ts (the ride on credit, the "What you can do now" card).
 *
 * THE RIDE DEBT
 *   `state.travel.rideDebt` (absent when nothing is owed) is what a ride home on credit still costs. It is repaid by
 *   repayFromEarnings(), which the three places that pay a player for something they did call: a finished activity that pays (a
 *   shift, a gig, an odd job), a stall's takings collected, and a gift received. RIDE_CREDIT.share of each of those, rounded
 *   up, goes to the debt as a ledger line before it can be spent. 'travel.repay-ride' pays it from cash on request.
 *
 * ODD JOBS, BENCH, TAP
 *   Three ordinary activities attached to the public place every city opens a newcomer to (publicArrivalVenue), so a visitor
 *   always has paid work, a rest and a drink where they stand. Each is limited by a cooldown shared across cities, and the odd job
 *   also by the daily gig limit and by being short of money.
 */
import { publicArrivalVenue } from './cities/runtime.ts';
import { BENCH, ODD_JOBS, ODD_JOBS_CASH_BELOW, RELIEF_BELOW, RIDE_CREDIT, TAP } from './content/relief.ts';
import { debit } from './systems/wallet.ts';
import { emit } from './registry.ts';
import { fail, naira, ok } from './util.ts';
import type { ActivityDefinition } from '../types/content.ts';
import type { LifeContext, LifeState } from '../types/life.ts';
import type { AttachedActivity } from '../types/registry.ts';

/** What is still owed for a ride home taken on credit. */
export const rideDebtOf = (state: LifeState): number => state.travel?.rideDebt ?? 0;

/** The stored amount: whole naira inside the limit; anything else is no debt (so the field is absent). */
export const cleanRideDebt = (value: unknown): number => (typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? Math.min(value, RIDE_CREDIT.max) : 0);

/** Set what is owed; zero removes the field. */
export function setRideDebt(state: LifeState, owed: number): void {
  if (owed > 0) state.travel.rideDebt = owed;
  else delete state.travel.rideDebt;
}

/** The sentence the wallet and the cards show. */
export const rideDebtText = (owed: number): string => `You owe ${naira(owed)} for your ride home`;

/** Why a trip between cities, a second home or a new main home waits while a ride debt stands (null when none does). */
export function rideDebtReason(state: LifeState): string | null {
  const owed = rideDebtOf(state);
  if (!owed) return null;
  return `${rideDebtText(owed)}: pay it before another trip between cities or a home elsewhere.`;
}

/**
 * Money the player has just earned (a wage, a gig, a stall's takings, a gift): the share that belongs to the ride debt is taken
 * from it, as a ledger line of its own. Call it right after the earning was credited.
 */
export function repayFromEarnings(state: LifeState, earned: number, ctx: LifeContext): number {
  const owed = rideDebtOf(state);
  if (!owed || !Number.isSafeInteger(earned) || earned <= 0) return 0;
  const pay = Math.min(owed, Math.ceil(earned * RIDE_CREDIT.share), state.cash);
  if (pay <= 0 || !debit(state, pay, 'Ride home repaid', ctx)) return 0;
  setRideDebt(state, owed - pay);
  if (owed - pay === 0) emit(state, 'notice.posted', { kind: 'loan', text: 'Your ride home is paid off.' }, ctx);
  return pay;
}

/**
 * A life that can comfortably afford the whole debt simply has it cleared: cash of at least the debt plus RIDE_CREDIT.cushion, from any source
 * (earnings, a gift, a stall, an operator's credit, a bonus), at any settlement. It is a sink of the whole debt, as one ledger line. Returns what was paid.
 */
export function settleRideDebt(state: LifeState, ctx: LifeContext): number {
  const owed = rideDebtOf(state);
  if (!owed || state.cash < owed + RIDE_CREDIT.cushion || !debit(state, owed, 'Ride home repaid', ctx)) return 0;
  setRideDebt(state, 0);
  const text = `Your ride home (${naira(owed)}) is paid.`;
  state.message = text;
  emit(state, 'notice.posted', { kind: 'loan', text }, ctx);
  return owed;
}

/** 'travel.repay-ride': pay the debt from cash, as much as cash goes. */
export function repayRide(state: LifeState, _payload: Record<string, unknown>, ctx: LifeContext) {
  const owed = rideDebtOf(state);
  if (!owed) return fail(state, 'no_debt', 'You do not owe anything for a ride.');
  const pay = Math.min(owed, state.cash);
  if (pay <= 0) return fail(state, 'no_cash', `${rideDebtText(owed)} and you have no cash to pay it with. Odd jobs and shifts pay it off a little at a time.`);
  debit(state, pay, 'Ride home repaid', ctx);
  setRideDebt(state, owed - pay);
  state.message = owed - pay ? `You paid ${naira(pay)}. You still owe ${naira(owed - pay)} for your ride home.` : `You paid ${naira(pay)}: your ride home is paid off.`;
  return ok(state, 'repaid');
}

// ---- odd jobs, bench, tap -------------------------------------------------------------------------

const RELIEF: readonly ActivityDefinition[] = [ODD_JOBS, BENCH, TAP];
/** Is this one of the three? They share one break across cities (systems/travel.ts cooldownKey). */
export const isReliefActivity = (def: { id: string } | undefined | null): boolean => RELIEF.some((item) => item.id === def?.id);

/** The three activities, placed at the public place the city opens a newcomer to. */
export function reliefActivities(cityId: string): AttachedActivity[] {
  // On the first spot the place already has (a spot of its own would need a place in every scene).
  const venue = publicArrivalVenue(cityId), spot = Object.values(venue.spots)[0]?.id;
  if (!spot) return [];
  return RELIEF.map((def) => ({ ...def, where: { venue: venue.id, spot } }));
}

/** The veto the three share ('activity.block'): the odd job only for someone short of money, the bench and the tap only for someone who needs them. */
export function reliefBlock(state: LifeState, def: Pick<ActivityDefinition, 'id'>): { code: 'not_needed'; reason: string } | null {
  const short = def.id === ODD_JOBS.id ? state.cash >= ODD_JOBS_CASH_BELOW : def.id === BENCH.id ? state.needs.energy >= RELIEF_BELOW : state.needs.hunger >= RELIEF_BELOW;
  return short ? { code: 'not_needed', reason: def.id === ODD_JOBS.id ? `Odd jobs are for when money is short (under ${naira(ODD_JOBS_CASH_BELOW)}).` : 'You do not need it right now.' } : null;
}
