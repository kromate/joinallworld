/**
 * OWNER: politics
 * The constitution: every office, fee and limit, and the levers an officeholder may set. Plain data only. Design: docs/POLITICS.md.
 *
 * A decree is never free text: it is a number for one lever, inside the range written here. The game enforces it where money
 * moves, so nothing an officeholder types can reach outside these ranges.
 */
import type { LeverId, LeverUnit, TierId } from '../../types/politics.ts';

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
  unit: LeverUnit
  /** What the lever acts on: a levy on a purchase at a stall, a levy on goods bought to carry between cities, or the length of a jail sentence. */
  on: 'sale' | 'trade' | 'sentence' | 'bail'
  about: string
}
export const LEVERS: Readonly<Record<LeverId, LeverRules>> = {
  marketLevy: { tier: 'city', label: 'Market levy', min: 0, max: 10, base: 0, unit: '%', on: 'sale', about: 'Added to the price of everything bought at a stall in the city. It goes to the city treasury.' },
  salesTax: { tier: 'state', label: 'Sales tax', min: 0, max: 10, base: 0, unit: '%', on: 'sale', about: 'Added to the price of everything bought at a stall in the state’s cities. It goes to the state treasury.' },
  vat: { tier: 'nation', label: 'VAT', min: 0, max: 15, base: 0, unit: '%', on: 'sale', about: 'Added to the price of everything bought at a stall in the country. It goes to the federal treasury.' },
  citySentence: { tier: 'city', label: 'Assault sentence', min: 1, max: 60, base: 10, unit: 'min', on: 'sentence', about: 'How long a player arrested by the city’s police for assault is held.' },
  stateSentence: { tier: 'state', label: 'Assault sentence', min: 1, max: 120, base: 15, unit: 'min', on: 'sentence', about: 'How long a player arrested by the state’s police for assault is held.' },
  nationSentence: { tier: 'nation', label: 'Assault sentence', min: 1, max: 240, base: 20, unit: 'min', on: 'sentence', about: 'How long a player arrested by the federal police for assault is held.' },
  cityBail: { tier: 'city', label: 'Bail', min: 0, max: 5000, base: 0, unit: '₦', on: 'bail', about: 'What a player jailed by the city’s police pays to go free at once. 0 means no bail. It goes to the city treasury.' },
  stateBail: { tier: 'state', label: 'Bail', min: 0, max: 20000, base: 0, unit: '₦', on: 'bail', about: 'What a player jailed by the state’s police pays to go free at once. 0 means no bail. It goes to the state treasury.' },
  nationBail: { tier: 'nation', label: 'Bail', min: 0, max: 50000, base: 0, unit: '₦', on: 'bail', about: 'What a player jailed by the federal police pays to go free at once. 0 means no bail. It goes to the federal treasury.' },
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

/** The bail lever of each seat. */
export const BAIL_LEVER: Readonly<Record<TierId, LeverId>> = { city: 'cityBail', state: 'stateBail', nation: 'nationBail' };

/** The sentence lever of each seat. */
export const SENTENCE_LEVER: Readonly<Record<TierId, LeverId>> = { city: 'citySentence', state: 'stateSentence', nation: 'nationSentence' };

/** Fights, offences, police and jail. Every number is a limit the game keeps whoever is in office. */
export const JUSTICE = {
  /** Days lived before a player may fight or be fought: a newcomer is left alone. */
  minDays: 1,
  /** The least energy a player needs to start a fight. */
  minEnergy: 20,
  /** A player may start a fight this often, and the same pair this often. */
  cooldownMs: 5 * 60000,
  pairCooldownMs: 30 * 60000,
  /** Energy each side loses, and the mood the loser is left with. */
  winnerEnergy: 10,
  loserEnergy: 25,
  loserMood: { value: -3, seconds: 3600 },
  /** An offence can be acted on this long after it. */
  offenceMs: 24 * 3600000,
  /** The most a sentence can ever be, whatever a lever allows. */
  sentenceMaxMin: 240,
  /** Officers an officeholder may enrol. */
  officers: { city: 3, state: 8, nation: 15 } as Readonly<Record<TierId, number>>,
  /** Judges an officeholder may enrol, like police, for their term. */
  judges: { city: 2, state: 4, nation: 6 } as Readonly<Record<TierId, number>>,
  /** Naira the court takes to hear an appeal, and a second appeal to the next court up. */
  appealFee: 500,
  escalateFee: 1500,
  statementMax: 140,
  argumentMax: 200,
  noteMax: 100,
  /** Lawyers listed, and rulings and cases kept. */
  lawyersListed: 40,
  rulingsKept: 30,
  /** Arrests one officer may make in an hour. */
  arrestsPerHour: 6,
  /** Offences and jail records kept. */
  keepOffences: 200,
};
