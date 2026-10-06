/**
 * OWNER: politics
 * The constitution: every office, fee and limit, and the levers an officeholder may set. Plain data only. Design: docs/POLITICS.md.
 *
 * A decree is never free text: it is a number for one lever, inside the range written here. The game enforces it where money
 * moves, so nothing an officeholder types can reach outside these ranges.
 */
import type { LeverId, TierId } from '../../types/politics.ts';

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
/**
 * The fewest votes an election needs to count, per seat. Below it the election is void: nobody takes office and the seat stays
 * empty until the next one, so a lone player can never become president on one vote. Whole numbers, raised as the world fills.
 */
export const QUORUM: Readonly<Record<TierId, number>> = { city: 3, state: 10, nation: 25 };

/** What an officeholder is called outside a city (a city names its own seat: cities/terminology.ts). */
export const SEAT_TITLES: Readonly<Record<Exclude<TierId, 'city'>, string>> = { state: 'Governor', nation: 'President' };

/** The share of a treasury an officeholder may draw as one salary, once per term. */
export const SALARY_SHARE = 0.2;
export const LEDGER_KEEP = 40;

export interface LeverRules {
  tier: TierId
  label: string
  /** Whole numbers, inclusive. */
  min: number
  max: number
  /** The value when nobody has set one: the game as it plays without a government. */
  base: number
  unit: '%'
  /** What the levy is charged on: a purchase at a stall, or goods bought to carry between cities. */
  on: 'sale' | 'trade'
  about: string
}
export const LEVERS: Readonly<Record<LeverId, LeverRules>> = {
  marketLevy: { tier: 'city', label: 'Market levy', min: 0, max: 10, base: 0, unit: '%', on: 'sale', about: 'Added to the price of everything bought at a stall in the city. It goes to the city treasury.' },
  salesTax: { tier: 'state', label: 'Sales tax', min: 0, max: 10, base: 0, unit: '%', on: 'sale', about: 'Added to the price of everything bought at a stall in the state’s cities. It goes to the state treasury.' },
  vat: { tier: 'nation', label: 'VAT', min: 0, max: 15, base: 0, unit: '%', on: 'sale', about: 'Added to the price of everything bought at a stall in the country. It goes to the federal treasury.' },
  tradeDuty: { tier: 'nation', label: 'Trade duty', min: 0, max: 25, base: 0, unit: '%', on: 'trade', about: 'Added to the cost of goods bought to carry between cities. It goes to the federal treasury.' },
};
export const LEVER_IDS = Object.keys(LEVERS) as LeverId[];
export const leversOf = (tier: TierId): LeverId[] => LEVER_IDS.filter((id) => LEVERS[id].tier === tier);

export const PARTY = {
  fee: 5000,
  nameMin: 3,
  nameMax: 24,
  mottoMin: 3,
  mottoMax: 60,
  /** Parties a single player may found. */
  perFounder: 1,
};
