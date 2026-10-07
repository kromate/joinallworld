/**
 * OWNER: politics
 * The constitution: every office, fee and limit, and the levers an officeholder may set. Plain data only. Design: docs/POLITICS.md.
 *
 * A decree is never free text: it is a number for one lever, inside the range written here. The game enforces it where money
 * moves, so nothing an officeholder types can reach outside these ranges.
 */
import type { LeverId, LeverUnit, TierId } from '../../types/politics.ts';

export { SEATS, SEAT_TITLES, TIER_IDS, LOSER_MOOD } from './politics-core.ts';
export type { SeatRules } from './politics-core.ts';
import { LOSER_MOOD, SEATS } from './politics-core.ts';

/**
 * The fewest votes an election needs to count, per seat. Below it the election is void: nobody takes office and the seat stays
 * empty until the next one, so a lone player can never become president on one vote. Whole numbers, raised as the world fills.
 */
export const QUORUM: Readonly<Record<TierId, number>> = { city: 3, state: 10, nation: 25 };

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
  loserMood: LOSER_MOOD,
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

/** Grants: money the officeholder pays out of the treasury, in the open, within these limits. */
export const GRANTS = {
  /** One grant is at most this share of the treasury, and no more than the seat's salary cap. */
  maxShare: 0.3,
  /** Grants in a term, and the shortest and longest purpose. */
  perTerm: 5,
  purposeMin: 3,
  purposeMax: 80,
  /** A recipient must have lived in the city this many days. */
  recipientDays: 1,
};

/** Audits: a report anyone can ask for, with warnings that follow from the numbers alone. */
export const AUDIT = {
  /** The most often a seat's audit can be asked for. */
  cooldownMs: 10 * 60000,
  /** A warning when one recipient got more than this share of what was granted (with at least two grants). */
  concentration: 0.5,
  /** A warning when more than this share of what was granted went to the officeholder's own party (with at least two grants). */
  partyFavour: 0.7,
  /** A warning when salary and grants took more than this share of what came in (once at least minIncome came in). */
  drained: 0.9,
  minIncome: 1000,
  minGrants: 2,
};

/** Impeachment: needs an audit warning this term, and more than half of the votes the officeholder won (never fewer than the seat's quorum). */
export const IMPEACH = { minDays: 1, minWorkDays: 2 };

/**
 * Assemblies: each seat has one beside its officeholder, filled by the runners-up of the same weekly election (each needs at least one vote),
 * so nobody votes twice and a quiet week simply has a small one. Where a seat has no assembly, its officeholder decrees directly as before.
 * Where it has, a rule changes only by a bill the assembly passes.
 */
export const ASSEMBLY = {
  /** Members beside the officeholder, by seat. */
  seats: { city: 2, state: 4, nation: 6 } as Readonly<Record<TierId, number>>,
  /** Bills a term may see, in all. */
  billsPerTerm: 8,
  /** A member's bill passes without the officeholder's signature when this share of the assembly votes for it (and never fewer than two members do). */
  supermajority: 2 / 3,
  minSupermajority: 2,
};
