/**
 * OWNER: politics
 * The few constants of the constitution that the rules engine itself reads (the fee of a seat, its title, what a lost fight leaves). They sit
 * apart from the rest of the constitution (src/game/content/politics.ts: the levers and their texts, the limits of justice, grants and audits),
 * which only the server and the Politics screens read, so the first download does not carry what only they need.
 */
import type { TierId } from '../../types/politics.ts';

export const TIER_IDS: readonly TierId[] = ['city', 'state', 'nation'];

export interface SeatRules {
  /** Naira, not refunded. */
  fee: number
  /** The most one draw of salary can be, in naira. */
  salaryCap: number
}
export const SEATS: Readonly<Record<TierId, SeatRules>> = {
  city: { fee: 2000, salaryCap: 20000 },
  state: { fee: 10000, salaryCap: 100000 },
  nation: { fee: 50000, salaryCap: 500000 },
};

/** What an officeholder is called outside a city (a city names its own seat: cities/terminology.ts). */
export const SEAT_TITLES: Readonly<Record<Exclude<TierId, 'city'>, string>> = { state: 'Governor', nation: 'President' };

/** The mood a fight leaves the one who lost. */
export const LOSER_MOOD = { value: -3, seconds: 3600 };
