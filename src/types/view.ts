/**
 * `viewLife(state, ctx)` — derived, display-only data: `{ [systemId]: view }` for every system
 * that defines `view()`. Never stored; recomputed on every poll.
 *
 * Each interface is read line by line off the system's `view()` in src/game/systems/*.js.
 * A field typed `T | null` is always present; a field marked `?` is genuinely missing from the
 * object in some cases (and JSON drops `undefined`, so over the wire both look the same).
 */
import type {
  ActivityBlockCode, CivicCheckCode, TravelBlockCode,
} from './actions.ts'
import type {
  ActivityDefinition, Block, CarDefinition, CityLinkFrom, DayTitle, DreamDefinition, HealthCure, HouseDefinition, JobDefinition,
  MissionKind, OnboardingStep, StartHomeDefinition, TierDefinition, TransferLimits, TravelModeDefinition, VenueZone,
} from './content.ts'
import type {
  AccessorySlot, ActivityId, CityLinkMode, WorldCityId, ComingSoonId, DepositTermId, DreamId, EventOccurrenceKey, FamilyId, FurnitureId, GemKind,
  HouseId, HouseStyle, HouseStyleField, HouseTierId, IllnessCause, ItemId, JobId, LagosDay, LagosWeek, LedgerLine, LgaId, LgaVia,
  Look, LotteryId, MissionId, Moodlet, Ms, NeedId, NeedMap, Notice, NpcId, OnboardingStage, PerkId, PlotAddress, RoadsideEventId,
  SkillId, SkillMap, SpotId, StarterGoalId, StartHomeId, TierId, TraitId, TravelModeId, VenueId, Wardrobe, WardrobeKind, WishId,
} from './life.ts'
import type { UnilagCommunityView, UnilagShuttleView, UnilagStudentView } from './campus.ts'

// ---- wallet -------------------------------------------------------------------------------

/** One Lagos day of the statement (wallet.js statementOf). */
export interface StatementDay {
  day: LagosDay
  open: number
  close: number
  in: number
  out: number
  /** Number of balance changes that day. */
  changes: number
  /** Net per reason group, largest movement first. */
  groups: { group: string; net: number; count: number }[]
}

export interface StatementTotals {
  in: number
  out: number
  changes: number
  /** `in - out`. */
  net: number
}

/**
 * The full statement (wallet.js statementOf), returned by GET /api/support/statement.
 * INCONSISTENT: the file header (wallet.js:31-32) documents the result without `kept`, which the
 * function returns (wallet.js:144-145).
 */
export interface WalletStatement {
  /** The current balance. */
  closing: number
  /** Where the kept history starts; `day` is null when no daily summary exists. */
  opening: { balance: number; day: LagosDay | null }
  /** Oldest first. */
  days: StatementDay[]
  /** Oldest first. */
  lines: LedgerLine[]
  /** Balance before the first kept line. */
  linesOpening: number
  totals: StatementTotals
  /** Opening balance plus every kept change equals the closing balance at both levels. */
  reconciled: boolean
  /** Anything that does not add up; should always be empty. */
  problems: string[]
  /** How much history is kept: full lines and daily summaries. */
  kept: { lines: number; days: number }
}

export interface WalletView {
  cash: number
  /** NEWEST FIRST (the stored ledger is newest last). */
  ledger: LedgerLine[]
  /** NEWEST FIRST. */
  days: StatementDay[]
  /** The statement without its `days` and `lines` (they are the two fields above, reversed). */
  statement: Pick<WalletStatement, 'opening' | 'closing' | 'totals' | 'reconciled' | 'problems' | 'kept' | 'linesOpening'>
}

// ---- inventory ----------------------------------------------------------------------------

export interface InventoryView {
  items: Record<ItemId, number>
}

// ---- needs --------------------------------------------------------------------------------

export interface Mood {
  /** 0–100: average need plus every feeling. */
  score: number
  label: 'Happy' | 'Okay' | 'Uneasy' | 'Miserable'
  icon: string
}

/**
 * A feeling: a stored moodlet, or an automatic low-need feeling (needs.js feelingsOf).
 * `need` is present only on the automatic ones (which never expire).
 */
export interface Feeling extends Moodlet {
  need?: NeedId
}

export interface NeedsView {
  /** Display order of the needs. The values themselves are read from `state.needs`. */
  order: readonly NeedId[]
  /** A need below this shows its low-need feeling (LOW_NEED). */
  low: number
  mood: Mood
  /** Low-need feelings first, then stored moodlets. */
  feelings: Feeling[]
}

// ---- skills -------------------------------------------------------------------------------

export interface SkillProgress {
  xp: number
  /** 0–10. */
  level: number
  /** XP at which the next level starts; null at the top level. */
  next: number | null
  /** 0–1 through the current level; 1 at the top level. */
  progress: number
}

export type SkillsView = Record<SkillId, SkillProgress>

// ---- career -------------------------------------------------------------------------------

/** What today's shift status is (career.js shiftStatus). */
export type ShiftStatusCode = 'no_job' | 'working' | 'available' | 'orientation' | 'shift_done' | 'day_off'

/** What the next promotion needs. */
export interface PromotionTarget {
  role: string
  /** Naira per shift after the promotion. */
  pay: number
  /** The ladder level it leads to. */
  level: number
  skill: SkillId
  /** Skill level required. */
  skillLevel: number
  /** Skill level the player has. */
  have: number
  performanceMet: boolean
  skillMet: boolean
  text: string
}

/** The player's next step, in one sentence, with where to send them. `venue`/`spot` exist only on the kinds shown. */
export type CareerStep =
  | { kind: 'apply' | 'wait' | 'start'; text: string }
  | { kind: 'home'; venue: 'home'; text: string }
  | { kind: 'go'; venue: VenueId; spot: SpotId; text: string }

/** One row of the Jobs list. */
export interface JobListing {
  id: JobId
  label: string
  icon: string
  track: boolean
  beta: boolean
  /** The player holds this job. */
  current: boolean
  entryRole: string
  /** Entry pay per shift. */
  pay: number
  /** Null for the starter job. */
  topRole: string | null
  summary: string
  /** The one schedule sentence (career.js scheduleText). */
  schedule: string
  /** The one workplace-hours sentence. */
  hours: string
  /** Null for the starter job. */
  skill: SkillId | null
  /** Shift length in seconds. */
  duration: number
  /** Workplace display name. */
  workplace: string
  /** Why Apply is unavailable, or null. */
  blocked: string | null
  /** Workplace venue id; null while the venue is not in this build. */
  venue: VenueId | null
  /** The workplace is open at this moment. */
  openNow: boolean
  /** What switching to this job loses; null when unemployed or for the current job. */
  switchWarning: string | null
  /** The player holds this same track in another city: taking it here moves the job, keeping level, performance and shifts. */
  transfer: boolean
}

/** The work dilemma waiting for an answer: its id only. The words and choices are in src/game/content/dilemmas.ts, fetched by the Career tab's card. */
export interface DilemmaView {
  id: string
}

export interface CareerView {
  /** Legacy field: the raw catalogue entry of the job held. */
  job: JobDefinition | null
  /** The dilemma waiting after a shift, or null. The key is absent until a life has had one (nothing writes it with dilemmas switched off). */
  dilemma?: DilemmaView | null
  completedShifts: number
  employed: boolean
  id: JobId | null
  label: string | null
  icon: string
  isTrack: boolean
  /** Ladder level; null without a career track. */
  level: number | null
  /** Rungs in the ladder; null without a career track. */
  levels: number | null
  role: string | null
  /** Naira per shift now; 0 when unemployed. */
  pay: number
  /** `pay` × work days a week; 0 without a career track. */
  weeklyPay: number
  /** Whole percent; null without a career track. */
  performance: number | null
  /** Completed shifts in the current job. */
  shifts: number
  schedule: string | null
  /** Sunday-first week strip. */
  chips: { letter: string; name: string; work: boolean; today: boolean }[]
  today: { code: ShiftStatusCode; canWork: boolean; text: string; weekday: string }
  /** "Next shift: …"; null when unemployed. */
  nextShift: string | null
  /** Null at the top of the ladder or without a career track. */
  next: PromotionTarget | null
  topOfLadder: boolean
  /** "Go automatically". */
  auto: boolean
  workplace: { venue: VenueId; spot: SpotId; label: string; open: boolean; status: string } | null
  /** The workplace-hours sentence; null when unemployed. */
  hours: string | null
  /**
   * INCONSISTENT: `xp` is defaulted (`|| {}`) but `minimumNeeds` and `effects` are passed through
   * as written (career.js:381), so they would be missing for a job whose shift omits them. Every
   * shipped job defines both.
   */
  shift: { id: ActivityId; label: string; duration: number; minimumNeeds: NeedMap; effects: NeedMap; xp: SkillMap } | null
  step: CareerStep
  /** A timed action is running. */
  busy: boolean
  rules: string[]
  jobs: JobListing[]
}

// ---- activities ---------------------------------------------------------------------------

/** A spot of the current venue. `caption` is missing on a spot a system created; `icon` may be too. */
export interface SpotSummary {
  id: SpotId
  label: string
  icon?: string
  caption?: string
  /** Activities attached to the spot (hidden ones included). */
  count: number
}

/**
 * Display summary of one activity (activities.js card): the definition without `where` and
 * `note`, with `cost` and `reward` replaced by the amounts after every modifier.
 * For an activity with `choices`, `cost`/`reward` are those of the BASE definition and `blocked`
 * is only computed when the activity is `unavailable`.
 */
export interface ActivityCard extends Omit<ActivityDefinition, 'where' | 'note' | 'cost' | 'reward'> {
  /** Naira actually charged. */
  cost: number
  /** Naira actually paid. */
  reward: number
  /** Why it cannot start right now, or null. */
  blocked: Block<ActivityBlockCode> | null
}

export interface ActivitiesView {
  /** The spot the player stands at. */
  spot: SpotId | null
  spots: SpotSummary[]
  /** Activities at the current spot, minus those hidden through 'activity.hidden'. */
  cards: ActivityCard[]
  /** The activity that is running (only for timed-action kind 'activity'). */
  active: { id: ActivityId; label: string; icon?: string; reward: number; cancellable: boolean; tags: string[] } | null
}

// ---- travel -------------------------------------------------------------------------------

/** One way to get to one destination. */
export interface TravelModeCard {
  id: TravelModeId
  label: string
  icon: string
  blurb: string
  /** The "fare" is fuel (own car). */
  fuel: boolean
  /** Naira for this trip, after every modifier. */
  fare: number
  seconds: number
  /** Need deltas applied on arrival. */
  needs: NeedMap
  xp: SkillMap
  blocked: Block<TravelBlockCode> | null
}

/**
 * A place on the map: a venue, Home, or a coming-soon place. Every card has the same keys.
 * (No coming-soon place exists in this build, so kind 'soon' does not occur: see ComingSoonId.)
 * For Home in a house the player owns, `district` is the name of its local government and the
 * position is the middle of the map.
 */
export interface TravelDestination {
  id: VenueId | ComingSoonId
  kind: 'home' | 'venue' | 'soon'
  label: string
  district: string
  icon: string
  description: string
  /** A VenueCategoryId, 'home', or 'soon'. */
  category: string
  /** Map position in percent. */
  x: number
  y: number
  zone: VenueZone
  /** The player is recorded here. */
  here: boolean
  visited: boolean
  open: boolean
  /** 'Open 24 hours' | '8AM – 10PM' | 'Coming soon'. */
  hours: string
  /** 'Open now · closes 10PM' | 'Closed · opens 8AM (in 5h 19m)' | 'Coming soon' … */
  status: string
  /** 'Short hop' | 'Across town' | 'Across the lagoon'; null for the current venue and coming-soon places. */
  band: string | null
  /** One rotating line; '' when the venue has none. */
  ambient: string
  /** Labels of every activity there. */
  preview: string[]
  /** A reason that applies to every mode (already here, closed, coming soon), or null. */
  blocked: Block<TravelBlockCode> | null
  /** Empty for a coming-soon place. */
  modes: TravelModeCard[]
}

export interface RoadsideChoiceCard {
  id: string
  label: string
  hint: string
  /** Naira; 0 when free. */
  cost: number
  /** Whole percent chance of success; null when nothing is rolled. */
  chance: number | null
  blocked: Block<'insufficient_funds'> | null
}

/** Paying to arrive now from the trip in progress ('travel.skip'). */
export interface TripSkipOffer {
  /** 'intercity' between two cities, 'travel' between two venues. */
  kind: 'intercity' | 'travel'
  /** Naira, as the trip stands; it falls as the trip goes on. 0 when `free`. */
  fee: number
  /** The character's first skip between cities costs nothing. */
  free: boolean
  /** The price is large enough to be asked about once more before it is paid. */
  confirm: boolean
  /** Why it cannot be bought right now. For 'insufficient_funds' the reason is "You need ₦X more". */
  blocked: Block<'almost_there' | 'insufficient_funds' | 'ride_debt'> | null
}

export interface TravelView {
  /** Legacy list of the five base modes with standard fares. */
  modes: TravelModeDefinition[]
  /** Legacy flat trip time in seconds. */
  duration: number
  defaultMode: TravelModeId
  /** House used to place Home on the map. */
  home: HouseId
  /** Completed trips. */
  trips: number
  /** NUMBER of venues visited (the list is `state.travel.visited`). */
  visited: number
  /** Venues first, then coming-soon places. */
  destinations: TravelDestination[]
  /** The pending roadside choice. */
  event: {
    id: RoadsideEventId
    icon: string
    title: string
    text: string
    at: Ms
    /** Seconds until it lapses. */
    expiresIn: number
    choices: RoadsideChoiceCard[]
  } | null
  /** Seconds left per activity id; only those still cooling down. */
  cooldowns: Record<ActivityId, number>
  gigs: { limit: number; used: number; left: number }
  /** Activity ids at the current spot that count towards the daily gig limit. */
  gigsHere: ActivityId[]
  /** The trip in progress. `mode` and `fare` are null on a trip from an older save. A cancel never refunds. */
  active: { from: VenueId; to: VenueId; mode: TravelModeId | null; fare: number | null; refundable: false } | null
  /** The price of arriving now, while a trip that can be skipped runs (between cities, or a long one inside the city). */
  skip: TripSkipOffer | null
}

// ---- health -------------------------------------------------------------------------------

export interface HealthView {
  sick: boolean
  cause: IllnessCause | null
  since: Ms | null
  /** 0–1: how far neglect has gone toward falling sick (the STATE field of the same name is in seconds). */
  strain: number
  /** Not sick, but past the warning point. */
  rundown: boolean
  /** Needs that currently count as neglected. */
  low: NeedId[]
  soaked: boolean
  immune: boolean
  immuneMinutes: number
  /** Minutes until the illness passes by itself; null when not sick. */
  healsInMinutes: number | null
  /** 'Very Sick' | 'Run down' | 'Healthy'. */
  status: string
  weather: { id: 'clear' | 'rain'; label: string; icon: string; text: string; raining: boolean; minutesLeft: number }
  /** The HUD chip. */
  warning: { level: 'sick' | 'rundown' | 'rain'; icon: string; text: string } | null
  /** At least one sentence. */
  advice: string[]
  cures: HealthCure[]
  /** The health-related feelings the player currently has (sick, soaked, recovered). */
  feelings: Feeling[]
}

// ---- economy ------------------------------------------------------------------------------

export interface RentCard {
  house: HouseId
  /** RENTS label ('Yaba self-contain'), not the HOUSES label. */
  label: string
  /** Naira per week. */
  amount: number
  /** Server ms of the next Saturday 00:00 Lagos time. */
  nextDue: Ms
  /** 'Sat 10 Oct'. */
  nextDueLabel: string
  arrears: number
  /** Saturdays missed in a row. */
  missed: number
  /** Naira added per further Saturday in arrears. */
  lateFee: number
  canPayArrears: boolean
  /** Why "Pay rent now" is unavailable, or null. */
  payBlocked: string | null
  warning: string | null
  rule: string
}

export interface LoanCard {
  principal: number
  /** Naira to repay including late fees so far. */
  total: number
  weekly: number
  left: number
  /** Late fees added. */
  fees: number
  paid: number
  /** 0–1. */
  progress: number
  cleared: boolean
  /** Saturdays already covered by an early instalment. */
  prepaid: number
  /** The next instalment in naira (less than `weekly` at the end). */
  instalment: number
  weeksLeft: number
  nextDue: Ms
  nextDueLabel: string
  nextCollection: string
  /** Why "pay one instalment" is unavailable, or null. */
  weekBlocked: string | null
  /** Why "pay it all off" is unavailable, or null. */
  allBlocked: string | null
  rule: string
}

export interface DepositCard {
  id: string
  amount: number
  term: DepositTermId
  termLabel: string
  /** Naira of interest at maturity. */
  interest: number
  /** `amount + interest`. */
  payout: number
  maturesAt: Ms
  maturesLabel: string
}

export interface SavingsCard {
  beta: true
  /** Naira locked in open deposits. */
  locked: number
  /** Naira that can still be locked. */
  room: number
  min: number
  /** Largest deposit that can be opened now. */
  max: number
  maxOpen: number
  cap: number
  /** Why no deposit can be opened, or null. */
  blocked: string | null
  terms: { id: DepositTermId; label: string; days: number; percent: number }[]
  /** Suggested amounts with their payout per term. */
  amounts: { amount: number; payouts: Record<DepositTermId, number>; blocked: string | null }[]
}

export interface EconomyView {
  nextDue: Ms
  nextDueLabel: string
  /** Rent plus the loan instalment, in naira. */
  weeklyBills: number
  /** Null until the life has a rent house. */
  rent: RentCard | null
  /** Null for a life without the loan (the card stays, `cleared`, once it is paid off). */
  loan: LoanCard | null
  deposits: DepositCard[]
  savings: SavingsCard
}

// ---- property -----------------------------------------------------------------------------

export interface HouseCard extends HouseDefinition {
  /** The player lives here — false for every card while they live in their own house (view.estate.living === 'own'). */
  current: boolean
  affordable: boolean
  /** Why "Move in" is unavailable, or null. */
  blocked: string | null
}

export interface CarCard extends CarDefinition {
  /** Overrides the definition's `price` with the price after 'shop.price' modifiers. */
  price: number
  listPrice: number
  owned: boolean
  driving: boolean
  /** Naira returned when sold. */
  resale: number
  affordable: boolean
  /** Why "Buy" is unavailable, or null (always null for an owned car). */
  blocked: string | null
}

export interface PropertyView {
  /** The rented tier (the last one rented while the player lives in their own house). */
  house: HouseDefinition
  /** Weekly rent of the current house (HOUSES, not RENTS). */
  rent: number
  houses: HouseCard[]
  /** The next house up, or null in the mansion. */
  nextHouse: HouseId | null
  /** The car currently driven. */
  car: CarDefinition | null
  cars: CarCard[]
}

// ---- estate -------------------------------------------------------------------------------

/** One local government in the chooser, with what moving the current house there would cost. */
export interface LgaCard {
  id: LgaId
  name: string
  line: string
  /** How dear land is there, in naira. */
  land: number
  /** Naira charged for taking the current house there (0 when the land is not dearer). */
  levy: number
}

/** One option of one field of the house's look. */
export interface HouseStyleCard {
  /** The value to send in 'estate.style'. */
  index: number
  id: string
  label: string
  hex: string | null
  /** Naira charged when a field is changed to it; 0 = free. */
  price: number
  chosen: boolean
}

export interface HouseTierCard {
  id: HouseTierId
  label: string
  icon: string
  grid: number
  /** Naira in the life's local government. */
  cost: number
  /** Build time in whole minutes. */
  minutes: number
  groundRent: number
  blurb: string
  current: boolean
  /** Why it cannot be built now, or null. */
  blocked: string | null
}

/** A way out of the city, with whether it can be taken now. */
export interface CityLinkCard extends CityLinkFrom {
  /** The destination city's name. */
  name: string
  open: boolean
  /** Where it leaves from in this city. */
  hub: string | null
  blocked: string | null
}

/** The location-confirmed badge as its owner sees it (docs/LOCATION.md). `city` is the main home's city, whose boundary the device is checked against. */
export interface ResidenceView {
  city: WorldCityId
  cityName: string
  unit: string
  lga: LgaId
  lgaName: string
  /** The standing confirmation and the server ms it lapses, or null. */
  confirmed: { at: Ms; until: Ms } | null
  days: number
}

export interface EstateView {
  city: WorldCityId
  cityName: string
  /** What the city calls its districts ('local government'). */
  unit: string
  /** Null only in a city without local governments. */
  lga: Omit<LgaCard, 'levy'> | null
  lgaConfirmed: boolean
  lgaVia: LgaVia
  /** The life has a place in the city — a local government of its own, and so a house (estate.js hasPlace). False for a guest. */
  placed: boolean
  /** `at` is the server ms the cooldown ends, or null when a change is allowed now. */
  change: { cooldownDays: number; at: Ms | null; blocked: string | null }
  lgas: LgaCard[]
  /** `key` is the stored address (`ikeja/41/2/6`), `address` the readable one. Null until the server has allocated a plot. */
  plot: (PlotAddress & { key: string; address: string }) | null
  tier: { id: HouseTierId; label: string; icon: string; grid: number; groundRent: number }
  style: HouseStyle
  /** Style and tier as one integer (world.js packStyle): what the map draws from. */
  packed: number
  styles: Record<HouseStyleField, HouseStyleCard[]>
  /** `remaining` in seconds, `progress` 0–1. */
  upgrade: { to: HouseTierId; label: string; cost: number; startedAt: Ms; doneAt: Ms; remaining: number; progress: number } | null
  /** Smallest first. */
  tiers: HouseTierCard[]
  living: 'own' | 'rent'
  /** Ground rent owed. */
  arrears: number
  /** The cheapest upgrade there is in the city. */
  cheapest: { lga: LgaId; tier: HouseTierId; total: number; lgaName: string; label: string } | null
  rules: { beta: true; housesPerLife: number; cooldownDays: number }
  links: CityLinkCard[]
  /** Homes kept in other cities; `tier` is the tier's LABEL. */
  away: { city: WorldCityId; name: string; tier: string; living: 'own' | 'rent' }[]
  /** The main home: its city, and whether that is the city the life is in. Null for a life with no home anywhere yet. */
  home: { city: WorldCityId; name: string; here: boolean } | null
  /** A settled life in a city where it has no local government: it lives here as a visitor. */
  visiting: boolean
  /**
   * What a visitor may do about a home here, or null for anyone else. `buy` is an additional home (the house, and its price in the
   * cheapest local unit; each unit's own price is `prices`). `main` moves the main home here: `blocked` says why it cannot, and
   * `gives` names what is given up when it can.
   */
  settle: { buy: { tier: string; from: number; prices: Record<string, number>; groundRent: number }; main: { blocked: string | null; gives: string | null } } | null
  /** In a city where the life keeps a house that is not its main home: why it cannot be made the main home now (null when it can). Null elsewhere. */
  makeMain: { blocked: string | null } | null
  /** A room at a guest house ('estate.lodge'): the price, and why it cannot be taken now (null when it can). */
  lodging: { fee: number; blocked: string | null }
  /** The ride home on credit (src/game/relief.ts): what is owed, and the ride on offer to a visitor who cannot pay the cheapest fare to the main home. */
  ride: RideCreditView
  /** The location-confirmed badge. Null while the life has no home anywhere. */
  residence: ResidenceView | null
}

export interface RideCreditView {
  /** Naira still owed for a ride home taken on credit (0 when nothing is). */
  debt: number
  offer: { to: WorldCityId; mode: CityLinkMode; fare: number } | null
}
/** One thing a stuck player can do right now. `venue` is where it is done (null: anywhere); `here` says they are already there. */
export interface ReliefAction {
  id: 'odd-job' | 'bench' | 'tap' | 'clinic' | 'credit-ride' | 'friend' | 'cash-box' | 'repay'
  label: string
  detail: string
  /** Why it cannot be done now (null when it can). */
  blocked: string | null
  venue: string | null
  here: boolean
  activity: string | null
  spot: string | null
  to: WorldCityId | null
  mode: CityLinkMode | null
}
export interface ReliefHelp {
  /** What kind of moment this is; a dismissed card is not shown again for the same key. */
  key: string
  title: string
  /** The words of the small entry chip in the HUD. */
  chip: string
  line: string
  actions: ReliefAction[]
}

// ---- home ---------------------------------------------------------------------------------

/** The placed objects and storage are not repeated here: read `state.home.items` / `state.home.storage`. */
export interface HomeView {
  /** The RENTED tier (`state.property.house`), also while the player lives in their own house — `grid` is then the owned tier's. */
  house: HouseId
  /** The room is grid × grid tiles. */
  grid: number
  /** Back-wall slot the window takes. */
  window: number
  /** Side-wall slot the door takes. */
  door: number
  atHome: boolean
  /** Number of placed objects. */
  placed: number
  /** Number of stored objects. */
  stored: number
  stocked: boolean
  /** Share of the list price returned on a sale. */
  refundRate: number
  /** Stars of decor, light, comfort and pet items. */
  ambience: number
  /** Price of every catalogue item after discounts. */
  prices: Record<FurnitureId, number>
  /** `{ [ingredientId]: { [packs]: { price, list } } }` for each offered pack count (1 and 3). */
  groceries: Record<ItemId, Record<number, { price: number; list: number }>>
  /** What the kitchen holds, in catalogue order. */
  kitchen: { id: ItemId; label: string; icon: string; count: number }[]
  /** Result multiplier per furniture kind that has actions (0 = none placed). */
  quality: Record<string, number>
}

// ---- onboarding ---------------------------------------------------------------------------

export interface StartHomeCard extends StartHomeDefinition {
  /** Null before the lottery is rolled, or while locked. */
  startCash: number | null
  /** Why it cannot be chosen with the rolled outcome; null before the roll. */
  locked: string | null
}

export interface BoutiqueItem {
  kind: WardrobeKind | 'accessories'
  id: string
  /** Accessories only: where it is worn. */
  slot?: AccessorySlot
  label: string
  price: number
  owned: boolean
  wearing: boolean
  blocked: string | null
}

export interface OnboardingView {
  stage: OnboardingStage
  /** A life of the quick start that has not settled in: it has no home, no local government and no house. */
  guest: boolean
  done: boolean
  legacy: boolean
  /** The life is held until its look is confirmed: nothing but `onboarding.*` is accepted. */
  required: boolean
  step: number
  /** The first-minute timings in server ms (null until they happen); `settledAt` is the state's `completedAt`. */
  timing: { bornAt: Ms | null; playedAt: Ms | null; firstAt: Ms | null; settledAt: Ms | null }
  /** Activities finished while a guest. */
  activities: number
  /** For a guest: the sentence that says what settling in gives. Null otherwise. */
  settleReason: string | null
  steps: OnboardingStep[]
  look: Look
  traits: TraitId[]
  dream: DreamId | null
  house: StartHomeId | null
  lottery: { id: LotteryId; label: string; icon: string; tagline: string; bullets: string[]; beta: boolean; at: Ms } | null
  /** The start a new life is offered: its own starter house, free. `startCash` is null before the lottery is rolled. */
  own: { startCash: number | null; rent: 0 }
  /** The rented starting homes (not offered by the game's own settle-in screens any more). */
  homes: StartHomeCard[]
  /** `accessories` is always present here and lists EVERY accessory owned, the free basics included (unlike the state's). */
  wardrobe: Required<Wardrobe>
  /** Every style the current body can wear, then every accessory. */
  boutique: BoutiqueItem[]
  /** The five-word mood scale (MOODS) — a different scale from `view.needs.mood.label`. */
  mood: { word: string; tone: 'good' | 'neutral' | 'warn' | 'bad'; icon: string; score: number }
  /** Feelings with a one-line description ('' when there is none). */
  feelings: (Feeling & { line: string })[]
}

// ---- goals --------------------------------------------------------------------------------

/** Where tapping the chip walks to: `[venue]` or `[venue, spot]`. */
export type ChipTarget = [venue: string, spot?: string]

/**
 * The HUD chip: character creation (never for a guest of the quick start, whose chain runs from the
 * first moment), then the current starter goal, then a rolling next step.
 * At most one of `go` (walk there) and `open` (open that panel) is present; a 'goal' chip may
 * have neither.
 */
export type GoalChip =
  | { kind: 'create'; icon: string; title: string; hint: string; open: 'onboarding' }
  | {
    kind: 'goal'
    id: StarterGoalId
    icon: string
    title: string
    hint: string
    /** '+₦500 +1✨'. */
    reward: string
    /** 1-based position in the chain. */
    step: number
    of: number
    go?: ChipTarget
    /** Only on a goal done "here" (the quick start's first goal), with `go`: the activity to start at that spot. */
    activity?: ActivityId
    open?: string
    /** Parameters for the opened panel; only with `open`. */
    params?: Record<string, unknown>
  }
  | { kind: 'guide'; icon: string; title: string; hint: string; go?: ChipTarget; open?: string; /** The title of the activity card to mark on arrival. */ card?: string }

export interface PerkCard {
  id: PerkId
  label: string
  icon: string
  cost: number
  effect: string
  beta: boolean
  owned: boolean
  /** 'Owned', what is missing, or null when it can be bought. */
  blocked: string | null
}

export interface WishCard {
  /** Index to send to 'goals.reroll-wish'. */
  slot: number
  id: WishId
  label: string
  hint: string
  icon: string
  /** Stars it grants (without perk bonuses). */
  stars: number
  progress: number
  target: number
  /** Progress is naira earned today. */
  money: boolean
  beta: boolean
}

export interface GoalsView {
  chip: GoalChip
  chain: {
    started: boolean
    index: number
    total: number
    finished: boolean
    current: { id: StarterGoalId; title: string; hint: string; icon: string; cash: number; stars: number } | null
  }
  stars: number
  perks: PerkCard[]
  wishes: WishCard[]
  rerolls: { used: number; left: number; max: number; blocked: string | null }
  /** Wishes that have come true. */
  granted: number
  dream: (DreamDefinition & { progress: number; percent: number; done: boolean; reward: { beta?: boolean; cash: number; stars: number } }) | null
  /** The dreams to choose from; empty once one is chosen. */
  dreams: DreamDefinition[]
  feed: { n: number; text: string }[]
  seq: number
}

// ---- social -------------------------------------------------------------------------------

export interface NpcActionCard {
  id: string
  /** The activity id to start (`npc-<npc>-<action>`). */
  activity: ActivityId
  label: string
  /** Nigerian Pidgin wording of `label`. Only a place action (switched on by the host) carries one. */
  pcmLabel?: string
  icon: string
  duration: number
  cost: number
  /** The needs it touches. */
  tags: string[]
  /** Whole percent chance that it lands; null when it always does. */
  chance: number | null
}

/** A regular at the current venue. */
export interface NpcSummary {
  id: NpcId
  name: string
  role: string
  emoji: string
  npc: true
  beta: boolean
  /** Landmark key of the venue's scene, or null. */
  at: string | null
  quote: string
  points: number
  tier: TierId
  tierLabel: string
  next: { label: string; min: number } | null
  /** Interactions left today. */
  left: number
  blocked: string | null
  actions: NpcActionCard[]
}

export interface RelationshipCard {
  /** NPC id or player public id. */
  id: string
  npc: boolean
  name: string
  emoji: string
  role: string
  points: number
  tier: TierId | 'bae'
  tierLabel: string
  next: { label: string; min: number } | null
  /** NPCs: closeness has reached the Friend tier. Players: a friendship exists. */
  friend: boolean
  left: number
}

export interface SocialView {
  tiers: TierDefinition[]
  maxCloseness: number
  /** Closeness at which "Ask to be my Bae" opens. */
  baeUnlock: number
  bae: string | null
  dailyInteractions: number
  /** The regulars of the venue the player is in. */
  here: NpcSummary[]
  /** Closest first. */
  relationships: RelationshipCard[]
  friends: RelationshipCard[]
  paddyCount: number
  playerActions: { id: string; label: string; icon: string; tags: string[]; success: boolean }[]
  family: { id: FamilyId; name: string; relation: string; emoji: string; line: string; contact: boolean; calledToday: boolean }[]
  /** `social` = Social gained by a first call of the day; `mood` = the check-in feeling's value. */
  familyCall: { duration: number; social: number; mood: number }
  /** Consecutive days with a family call (0 once a day is skipped). */
  streak: number
  /** The family member being phoned. */
  calling: FamilyId | null
  /** Every TRANSFER_LIMITS field (its `beta` mark included) plus this life's standing against them. */
  transfer: TransferLimits & { earned: number; sentToday: number; countToday: number; leftToday: number; giftsLeftToday: number; /** Unrestricted funds (an admin's credit): gifted with none of the gift rules. */ free: number}
  /** NEWEST FIRST (stored oldest first). */
  notices: Notice[]
}

// ---- civic --------------------------------------------------------------------------------

/** One requirement to run or vote, with its current status. */
export interface EligibilityCheck {
  id: 'days' | 'fee' | 'work' | 'place' | 'home'
  met: boolean
  label: string
  detail: string
  /** The failure code returned when this is the first unmet check. */
  code: CivicCheckCode
}

export interface CivicView {
  hunt: {
    day: LagosDay
    total: number
    found: number
    claimed: boolean
    prize: number
    canClaim: boolean
    /** Clues name the venue only; the exact spot is for the player to find. */
    gems: { venue: VenueId; label: string; kind: GemKind; found: boolean; clue: string }[]
  }
  eligibility: {
    /** Lagos days lived in the city. */
    days: number
    /** Null while the polling venue is not in this build. */
    pollingVenue: string | null
    run: EligibilityCheck[]
    /** Includes the 'place' check only when the polling venue exists. */
    vote: EligibilityCheck[]
  }
  workDays: number
  earnedThisWeek: number
  /** Lifetime gems found. */
  gems: number
}

// ---- missions -----------------------------------------------------------------------------

/** One row of the Missions app. */
export interface MissionRow {
  id: MissionId
  kind: MissionKind
  label: string
  hint: string
  /** Progress. */
  n: number
  /** Target. */
  count: number
  done: boolean
  claimed: boolean
  /** Naira paid when claimed. */
  cash: number
  /** The Go button opens this panel … */
  open: string | null
  /** … or walks to `[venue]` / `[venue, spot]`. */
  go: string[] | null
}

/** How far one set (daily or weekly) is, and whether its star bonus was granted. */
export interface MissionSet {
  done: number
  claimed: number
  total: number
  /** Stars the full set pays. */
  stars: number
  granted: boolean
}

export interface MissionsView {
  /** For a guest of the quick start: why missions are not open yet. Null once they are. */
  locked: string | null
  day: LagosDay
  week: LagosWeek
  /** Today's set; empty while a saved set is from an earlier day. */
  daily: MissionRow[]
  weekly: MissionRow[]
  dailySet: MissionSet
  weeklySet: MissionSet
  rerollsLeft: number
  /** Finished missions not collected yet. */
  claimable: number
  stamps: { days: number; need: number; stars: number; paid: boolean }
  activeDays: number
  /** The label of the title earned last, or null. */
  title: string | null
  /** Labels of every title earned. */
  titles: string[]
  nextTitle: DayTitle | null
  /** Server ms of the next Lagos midnight. */
  resetAt: Ms
  /** Server ms of the next Monday 00:00, Lagos time. */
  weekResetAt: Ms
  /** Lifetime missions claimed. */
  claimed: number
}

// ---- events -------------------------------------------------------------------------------

export interface EventsView {
  /** Every calendar event that is on in the city right now. */
  live: { id: string; key: EventOccurrenceKey; venue: string; attended: boolean }[]
  /** The live event at the venue the player is in (null while departing). */
  here: { id: string; key: EventOccurrenceKey; title: string; spray: boolean; attended: boolean } | null
  spray: { amounts: number[]; perDay: number; spentToday: number; left: number }
  /** Lifetime events attended. */
  count: number
  /** Lifetime naira sprayed. */
  sprayed: number
}

// ---- growth -------------------------------------------------------------------------------

export interface GrowthView {
  /** `win` is the naira a paid win pays; `paidToday`/`paidLeft` against `perDay`; lifetime `played` and `won`. */
  tables: { win: number; paidToday: number; paidLeft: number; perDay: number; played: number; won: number }
  referral: {
    welcomed: boolean
    paidThisWeek: number
    paidTotal: number
    perWeek: number
    lifetime: number
    /** Naira to a referred newcomer. */
    welcome: number
    /** Naira and stars to the inviter. */
    reward: number
    rewardStars: number
  }
}

// ---- business -----------------------------------------------------------------------------

/** The life's side of businesses; the shop itself is read from /api/business/. */
export interface BusinessView {
  opened: number
  sales: number
  /** Trade goods carried: `[productId, units]`, and how many more units fit. */
  bag: [string, number][]
  bagRoom: number
  /** What this life may still spend at players' shops today, and why it may not buy at all ('' when it may). */
  canSpend: number
  buyWhy: string
}

// ---- the whole view -----------------------------------------------------------------------

/** The object returned by `viewLife(state, ctx)`. `core` has no view. The three campus views are in campus.ts. */
export interface LifeView {
  wallet: WalletView
  inventory: InventoryView
  needs: NeedsView
  skills: SkillsView
  career: CareerView
  activities: ActivitiesView
  travel: TravelView
  health: HealthView
  economy: EconomyView
  property: PropertyView
  estate: EstateView
  home: HomeView
  onboarding: OnboardingView
  goals: GoalsView
  social: SocialView
  civic: CivicView
  missions: MissionsView
  events: EventsView
  growth: GrowthView
  business: BusinessView
  unilagStudent: UnilagStudentView
  unilagCommunity: UnilagCommunityView
  unilagShuttle: UnilagShuttleView
}

// ---- runtime lists (checked against the running engine by engine.test.ts) -------------------

/** The keys of `viewLife(state, ctx)`, in registration order. */
export const VIEW_KEYS = [
  'wallet', 'inventory', 'needs', 'skills', 'career', 'activities', 'travel', 'health', 'economy', 'property', 'estate', 'home',
  'onboarding', 'goals', 'social', 'civic', 'missions', 'events', 'growth', 'business', 'unilagStudent', 'unilagCommunity', 'unilagShuttle',
] as const satisfies readonly (keyof LifeView)[]

/** The keys of each system's view, sorted. (`skills` is keyed by SkillId.) */
export const VIEW_FIELD_KEYS = {
  wallet: ['cash', 'days', 'ledger', 'statement'],
  inventory: ['items'],
  needs: ['feelings', 'low', 'mood', 'order'],
  career: [
    'auto', 'busy', 'chips', 'completedShifts', 'dilemma', 'employed', 'hours', 'icon', 'id', 'isTrack', 'job', 'jobs', 'label', 'level',
    'levels', 'next', 'nextShift', 'pay', 'performance', 'role', 'rules', 'schedule', 'shift', 'shifts', 'step', 'today',
    'topOfLadder', 'weeklyPay', 'workplace',
  ],
  activities: ['active', 'cards', 'spot', 'spots'],
  travel: ['active', 'cooldowns', 'defaultMode', 'destinations', 'duration', 'event', 'gigs', 'gigsHere', 'home', 'modes', 'skip', 'trips', 'visited'],
  health: [
    'advice', 'cause', 'cures', 'feelings', 'healsInMinutes', 'immune', 'immuneMinutes', 'low', 'rundown', 'sick', 'since',
    'soaked', 'status', 'strain', 'warning', 'weather',
  ],
  economy: ['deposits', 'loan', 'nextDue', 'nextDueLabel', 'rent', 'savings', 'weeklyBills'],
  property: ['car', 'cars', 'house', 'houses', 'nextHouse', 'rent'],
  estate: [
    'arrears', 'away', 'change', 'cheapest', 'city', 'cityName', 'home', 'lga', 'lgaConfirmed', 'lgaVia', 'lgas', 'links', 'living', 'lodging', 'makeMain', 'packed',
    'placed', 'plot', 'residence', 'ride', 'rules', 'settle', 'style', 'styles', 'tier', 'tiers', 'unit', 'upgrade', 'visiting',
  ],
  home: ['ambience', 'atHome', 'door', 'grid', 'groceries', 'house', 'kitchen', 'placed', 'prices', 'quality', 'refundRate', 'stocked', 'stored', 'window'],
  onboarding: [
    'activities', 'boutique', 'done', 'dream', 'feelings', 'guest', 'homes', 'house', 'legacy', 'look', 'lottery', 'mood', 'own',
    'required', 'settleReason', 'stage', 'step', 'steps', 'timing', 'traits', 'wardrobe',
  ],
  goals: ['chain', 'chip', 'dream', 'dreams', 'feed', 'granted', 'perks', 'rerolls', 'seq', 'stars', 'wishes'],
  social: [
    'bae', 'baeUnlock', 'calling', 'dailyInteractions', 'family', 'familyCall', 'friends', 'here', 'maxCloseness', 'notices',
    'paddyCount', 'playerActions', 'relationships', 'streak', 'tiers', 'transfer',
  ],
  civic: ['earnedThisWeek', 'eligibility', 'gems', 'hunt', 'workDays'],
  missions: [
    'activeDays', 'claimable', 'claimed', 'daily', 'dailySet', 'day', 'locked', 'nextTitle', 'rerollsLeft', 'resetAt', 'stamps',
    'title', 'titles', 'week', 'weekResetAt', 'weekly', 'weeklySet',
  ],
  events: ['count', 'here', 'live', 'spray', 'sprayed'],
  growth: ['referral', 'tables'],
  business: ['bag', 'bagRoom', 'buyWhy', 'canSpend', 'opened', 'sales'],
  unilagStudent: [
    'admittedDay', 'applicationCount', 'betaRules', 'campusJobs', 'courses', 'degree', 'hostel', 'lifetime', 'programme', 'records',
    'status', 'studentId', 'term',
  ],
  unilagCommunity: ['clubs', 'discoveries', 'eligible', 'events', 'quiz', 'tables', 'today', 'trail'],
  unilagShuttle: ['active', 'fare', 'source', 'stops'],
} as const satisfies { readonly [K in keyof LifeView]?: readonly (keyof LifeView[K])[] }

/** The keys every entry of `view.travel.destinations` carries, sorted. */
export const TRAVEL_DESTINATION_KEYS = [
  'ambient', 'band', 'blocked', 'category', 'description', 'district', 'here', 'hours', 'icon', 'id', 'kind', 'label', 'modes',
  'open', 'preview', 'status', 'visited', 'x', 'y', 'zone',
] as const satisfies readonly (keyof TravelDestination)[]
