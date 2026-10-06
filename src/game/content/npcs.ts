/**
 * OWNER: social
 * NPCs, the interactions they offer, relationship tiers, family contacts and the limits on
 * player-to-player gifts. Plain data only (no functions, no imports).
 *
 * Provenance: `beta: true` marks an original beta value. Entries or fields without it are
 * fixed. Where a single field of a fixed entry is provisional, the entry carries a `note` saying which.
 */

/**
 * Relationship tiers by closeness points (0–100).
 * A closeness meter unlocks "Ask to be my Bae" at 40, and
 * a "Paddy Mi" (best friend) status follows. The tier names in between and every other threshold are
 * original beta values. Bae is not a points tier: it is a status two real players agree on.
 */
import type { FamilyId } from '../../types/life.ts'
import type {
  FamilyCallRules, FamilyMember, NpcAction, PlaceAction, PlayerAction, TierDefinition, TransferLimits,
} from '../../types/content.ts'

export const MAX_CLOSENESS = 100;
export const BAE_UNLOCK = 40;
export const TIERS: TierDefinition[] = [
  { id: 'stranger', label: 'Stranger', min: 0, beta: true },
  { id: 'acquaintance', label: 'Acquaintance', min: 5, beta: true },
  { id: 'friend', label: 'Friend', min: 20, beta: true },
  { id: 'paddy', label: 'Paddy Mi', min: BAE_UNLOCK, note: 'Name is fixed; sharing the 40-point Bae threshold is an original beta choice.', beta: true },
];
export const BAE_TIER = { id: 'bae', label: 'Bae' } as const;

/** Interactions per person per Lagos day before they have "heard enough" (original beta value). */
export const DAILY_INTERACTIONS = 4;
/** Most people remembered in one life; the least-close stranger is forgotten first (original beta value). */
export const MAX_RELATIONSHIPS = 200;

/**
 * Interactions offered by every NPC. Labels, the +Fun/+Social tags, the ₦300 drink, the
 * 60% joke chance and Say Hello's +12 Social / +2 Fun are fixed; every duration, every other effect size, XP and closeness points are original
 * beta values.
 *   effects   applied on completion whatever happens
 *   success   { base } percent chance (before skill and closeness); `bonus` effects and the
 *             closeness points are only granted when it lands
 */
export const NPC_ACTIONS: NpcAction[] = [
  { id: 'hello', label: 'Say Hello', icon: '👋', duration: 6, effects: { social: 12, fun: 2 }, xp: { charisma: 5 }, points: 2,
    note: 'Effects are fixed; duration, XP and points are original beta values.' },
  { id: 'gist', label: 'Gist', icon: '🗣️', duration: 10, effects: { social: 10, fun: 6 }, xp: { charisma: 8 }, points: 3, beta: true },
  { id: 'joke', label: 'Crack Joke', icon: '😂', duration: 8, effects: { social: 3, fun: 2 }, bonus: { social: 5, fun: 8 }, xp: { charisma: 6, comedy: 6 }, points: 5,
    success: { base: 60 }, note: 'The 60% base chance is fixed; everything else is an original beta value.' },
  { id: 'compliment', label: 'Compliment Their Fit', icon: '✨', duration: 6, effects: { social: 8, fun: 4 }, xp: { charisma: 6 }, points: 3, beta: true },
  { id: 'drink', label: 'Buy Them a Drink', icon: '🥤', duration: 9, cost: 300, effects: { social: 12, fun: 8 }, xp: { charisma: 8 }, points: 6,
    note: 'The ₦300 price is fixed; everything else is an original beta value.' },
];

/**
 * Interactions a regular offers because of where they are, who they are or when it is (behind the `dilemmas` switch, src/game/features.ts; which regular
 * offers which is decided in src/game/place-actions.ts). They run exactly like NPC_ACTIONS (the same activity engine, the same four-a-day limit per person)
 * and are listed apart from it so that, with the switch off, the catalogue is the one it always was. The ids are shared by every city; `label` is English and
 * `pcmLabel` Nigerian Pidgin (every one is `beta`: the Pidgin has not been reviewed by a speaker). Every number is an original beta value.
 *   places        kinds of place that offer it (placeKindOf: scene kinds, with 'worship' split into 'church' and 'mosque')
 *   elder         offered by regulars who are elders
 *   afterService  offered only for a short while after a service ends (SERVICE_TIMES)
 *   grant         what a success also gives: a grocery coupon (percent) and/or something the regular remembers
 */
export const PLACE_ACTIONS: PlaceAction[] = [
  { id: 'haggle', label: 'Haggle', pcmLabel: 'Bargain Price', icon: '🪙', duration: 10, effects: { social: 4, fun: 3 }, bonus: { fun: 4 }, xp: { hustle: 6, charisma: 3 }, points: 3,
    success: { base: 40 }, places: ['market'], grant: { coupon: 10, memory: 'haggled' }, beta: true,
    note: 'The chance uses the joke formula (charisma and closeness). A success also gives a coupon for 10% off the next grocery order today, worth at most ₦300.' },
  { id: 'respect', label: 'Greet with Respect', pcmLabel: 'Greet Am Well', icon: '🙏🏾', duration: 6, effects: { social: 8, fun: 1 }, xp: { charisma: 5 }, points: 4,
    elder: true, grant: { memory: 'respectful' }, beta: true },
  { id: 'queue', label: 'Join the Queue', pcmLabel: 'Join the Line', icon: '🧍🏾', duration: 12, effects: { social: 6, energy: -2 }, xp: { charisma: 4 }, points: 3,
    places: ['hospital', 'office'], grant: { memory: 'patient' }, beta: true },
  { id: 'argue-football', label: 'Argue Football', pcmLabel: 'Argue Ball', icon: '⚽', duration: 10, effects: { social: 5, fun: 8 }, bonus: { fun: 5 }, xp: { comedy: 5, charisma: 3 }, points: 5,
    success: { base: 50 }, places: ['viewing'], grant: { memory: 'ball-talk' }, beta: true },
  { id: 'dryer-gist', label: 'Gist Under the Dryer', pcmLabel: 'Gist Under Dryer', icon: '💇🏾‍♀️', duration: 10, effects: { social: 8, fun: 6 }, xp: { charisma: 6 }, points: 3,
    places: ['salon'], beta: true },
  { id: 'after-service', label: 'Greet After Service', pcmLabel: 'Greet Dem After Service', icon: '🕊️', duration: 8, effects: { social: 10, fun: 2 }, xp: { charisma: 6 }, points: 4,
    places: ['church', 'mosque'], afterService: true, grant: { memory: 'greeted-after-service' }, beta: true,
    note: 'Only offered for a short while after a service has ended.' },
];
/** The most one grocery coupon may save (₦), whatever the order (original beta value). */
export const COUPON_MAX_SAVING = 300;
/** Closeness-memory tags a regular keeps about you (original beta value). */
export const MAX_RELATIONSHIP_TAGS = 4;

/**
 * Interactions between two real players standing in the same venue. Labels and tags are
 * fixed; all numbers are original beta values. These are instant and limited per day.
 */
export const PLAYER_ACTIONS: PlayerAction[] = [
  { id: 'hello', label: 'Say Hello', icon: '👋', effects: { social: 10 }, xp: { charisma: 4 }, points: 2, beta: true },
  { id: 'gist', label: 'Gist', icon: '🗣️', effects: { social: 8, fun: 5 }, xp: { charisma: 6 }, points: 3, beta: true },
  { id: 'joke', label: 'Crack Joke', icon: '😂', effects: { social: 3, fun: 2 }, bonus: { social: 4, fun: 7 }, xp: { charisma: 5, comedy: 5 }, points: 5, success: { base: 60 }, beta: true },
  { id: 'shade', label: 'Throw Shade', icon: '😏', effects: { social: 4, fun: 6 }, xp: { charisma: 3 }, points: 1, beta: true },
];
/** Joke chance = base + per charisma level + per closeness point, clamped (original beta formula). */
export const JOKE_FORMULA = { perCharismaLevel: 2, perClosenessPoint: 0.4, min: 5, max: 95, beta: true };

/**
 * Family and phone contacts (original beta feature). A "Mummy" contact can be called; the rest of the
 * household, every line and every number here are original beta values. A call is a short timed action that works anywhere.
 *   every call: `effects`; the first call to each member per Lagos day also gives `first`, the
 *   XP and the check-in moodlet.
 */
export const FAMILY: Record<FamilyId, FamilyMember> = {
  mummy: { id: 'mummy', name: 'Mummy', relation: 'Mother', emoji: '👩🏾', line: 'Picks up on the first ring', contact: true,
    quotes: ['Have you eaten?', 'Remember the child of whom you are.', 'Call your father too.'], note: 'Contact is fixed; all values are original.', beta: true },
  daddy: { id: 'daddy', name: 'Daddy', relation: 'Father', emoji: '👨🏾', line: 'Short calls, big advice',
    quotes: ['How is work?', 'Save something every month.', 'Greet your landlord for me.'], beta: true },
  tobi: { id: 'tobi', name: 'Tobi', relation: 'Younger brother', emoji: '🧒🏾', line: 'Wants data and gist',
    quotes: ['Abeg send me something small.', 'When are you coming home?'], beta: true },
  grandma: { id: 'grandma', name: 'Grandma', relation: 'Grandmother', emoji: '👵🏾', line: 'Prays before she says hello',
    quotes: ['You will not see shame.', 'Come home for Christmas.'], beta: true },
};
export const FAMILY_CALL: FamilyCallRules = { duration: 8, effects: { social: 2 }, first: { social: 8 }, xp: { charisma: 2 },
  moodlet: { id: 'family-checkin', label: 'Checked in with family', value: 5, duration: 6 * 3600 }, beta: true };

/**
 * Gifts of naira between players (original beta values, deliberately conservative: easy
 * gifts would make work pointless). A life can never give away more than it has earned from paid work.
 */
export const TRANSFER_LIMITS: TransferLimits = {
  min: 100, maxPerTransfer: 5000, dailyAmount: 10000, dailyCount: 3, dailyReceive: 20000,
  minEarned: 1000, minAccountAgeMs: 0, minFriendshipMs: 0, beta: true, // no waiting period: the earned-from-work rule and the daily caps are the guard
};
