/**
 * The saved state of one life, as built by `createLife()` in src/life.js.
 *
 * Every shape here is read off the owning system's `stateKeys` and `sanitize()` in
 * src/game/systems/*.js: what sanitize rebuilds is what a state can contain, nothing else
 * survives a load. `src/types/engine.test.ts` fails when the running code and these types drift.
 *
 * Naming: a `<System>Slice` holds the TOP-LEVEL state keys a system owns (its `stateKeys`);
 * `LifeState` is the intersection of all sixteen. Older systems keep several flat keys
 * (`cash`, `needs`, `job` …); newer ones keep one object under their own id (`travel`, `goals` …),
 * typed as `<System>State`.
 */

// ---- closed id sets -----------------------------------------------------------------------

/** The six needs (systems/needs.js NEEDS). Satisfaction 0–100, higher is better. */
export type NeedId = 'hunger' | 'energy' | 'fun' | 'social' | 'hygiene' | 'bladder'

/** The nine skills (systems/skills.js SKILLS). */
export type SkillId = 'cooking' | 'charisma' | 'fitness' | 'coding' | 'music' | 'hustle' | 'dance' | 'comedy' | 'photography'

/** Every venue in this build (keys of content/venues.js VENUES). `state.location` is always one of these. */
export type VenueId =
  | 'park' | 'library' | 'home' | 'radio' | 'shrine' | 'viewing-centre' | 'amala-shitta' | 'cchub'
  | 'hospital' | 'salon' | 'church' | 'mosque' | 'market' | 'police' | 'polling-unit' | 'state-house'
  | 'i-fitness' | 'office' | 'quilox' | 'rooftop' | 'canopy-walk' | 'palms' | 'beach'

/** Places shown on the map that cannot be travelled to yet (content/venues.js COMING_SOON). */
export type ComingSoonId = 'airport' | 'refinery'

/** Houses a life can live in (content/housing.js HOUSES; also the keys of venues.js HOME_SPOTS and economy.js RENTS). */
export type HouseId = 'mushin' | 'yaba' | 'lekki' | 'ikoyi' | 'banana'

/** Houses offered at the end of character creation (content/traits.js START_HOMES). */
export type StartHomeId = 'mushin' | 'yaba' | 'lekki'

/** The five base travel modes (content/travel.js TRAVEL_MODES). */
export type BaseTravelModeId = 'trek' | 'keke' | 'danfo' | 'okada' | 'cab'

/** Every mode the travel action accepts: the base five plus the own-car mode (ALL_MODES). */
export type TravelModeId = BaseTravelModeId | 'car'

/** Job ids (content/jobs.js JOBS): the starter job plus fourteen career tracks. */
export type JobId =
  | 'community-helper' | 'tech' | 'banking' | 'music' | 'trading' | 'nursing' | 'hair' | 'chef'
  | 'dj' | 'fitness' | 'creator' | 'teaching' | 'event' | 'football' | 'retail'

/** Car ids (content/cars.js CARS). */
export type CarId =
  | 'agama-150' | 'tokunbo-saloon' | 'oga-sedan' | 'marina-v6' | 'chief-suv' | 'boardroom-330'
  | 'harmattan-cruiser' | 'atlantic-x' | 'atlantic-grand'

/** Trait ids (content/traits.js TRAITS). */
export type TraitId =
  | 'hustler' | 'foodie' | 'owambe-spirit' | 'gym-rat' | 'smooth-talker' | 'lazy-bone' | 'clean-pikin'
  | 'night-crawler' | 'tech-bro-or-sis' | 'musical'

/** Dream ids (content/traits.js DREAMS). */
export type DreamId = 'oga-at-the-top' | 'lekki-landlord' | 'afrobeats-star' | 'everybodys-padi' | 'yaba-unicorn'

/** Birth lottery outcome ids (content/traits.js LOTTERY). */
export type LotteryId = 'lapo-baby' | 'civil-servant' | 'street-smart' | 'ajebutter'

/** Perk ids (content/goals.js PERKS). */
export type PerkId =
  | 'steel-bladder' | 'iron-belle' | 'early-bird' | 'never-dull' | 'sweet-mouth' | 'connected' | 'hustle-juice'
  | 'fast-learner' | 'stay-fresh' | 'people-person' | 'buka-regular' | 'area-sabi' | 'ogas-favourite'
  | 'lucky-star' | 'second-wind' | 'odogwu'

/** Starter goal ids, in chain order (content/goals.js STARTER_GOALS). */
export type StarterGoalId = 'eat' | 'freshen-up' | 'get-a-job' | 'buy-something' | 'visit-buka' | 'make-a-friend' | 'work-a-shift'

/** Roadside event ids (content/events.js EVENTS). */
export type RoadsideEventId = 'agbo' | 'hawker' | 'change' | 'puddle' | 'wallet' | 'toll' | 'busker' | 'holdup'

/** Fixed-deposit term ids (systems/economy.js DEPOSIT_TERMS). */
export type DepositTermId = 'd1' | 'd3' | 'd7'

/** Family contacts that can be phoned (content/npcs.js FAMILY). */
export type FamilyId = 'mummy' | 'daddy' | 'tobi' | 'grandma'

/** Closeness tiers by points (content/npcs.js TIERS). Bae is a status, not a points tier. */
export type TierId = 'stranger' | 'acquaintance' | 'friend' | 'paddy'

/** Open sets: too large or too volatile to enumerate; validated at runtime against their catalogue. */
export type ActivityId = string
/** Spot ids are per venue (content/venues.js plus spots systems attach: 'work', 'people', 'living', 'study', 'pitch-room'). */
export type SpotId = string
/** content/furniture.js FURNITURE key. */
export type FurnitureId = string
/** Inventory item id: a lowercase slug (util.js ID_PATTERN). Kitchen ingredients are content/food.js INGREDIENTS keys. */
export type ItemId = string
/** content/npcs.js NPCS key. */
export type NpcId = string
/** content/goals.js WISHES id. */
export type WishId = string
/** Another player's public id: a 36-character lowercase UUID (systems/social.js playerId). */
export type PlayerPublicId = string
/** Server time in milliseconds. */
export type Ms = number
/** Whole Lagos days since 1970-01-01 (clock.js lagosTime().day). */
export type LagosDay = number

/** `{ need: amount }` — a delta, a minimum or a per-second rate depending on where it is used. */
export type NeedMap = Partial<Record<NeedId, number>>
/** `{ skill: amount }` — XP amounts, per-second XP rates or starting levels. */
export type SkillMap = Partial<Record<SkillId, number>>

// ---- core ---------------------------------------------------------------------------------

/** Fields every timed action carries, whatever its kind (core.js sanitizeActive). */
interface ActiveActionBase {
  /** Total length in seconds. */
  duration: number
  /** Seconds still to run; always `0 < remaining <= duration` in a stored state. */
  remaining: number
}

/** A venue activity, job shift, furniture action or NPC interaction (systems/activities.js). */
export interface ActivityAction extends ActiveActionBase {
  kind: 'activity'
  /** Activity id in the merged catalogue. */
  id: ActivityId
  /** Present only when the activity has `choices`: the chosen option's id. */
  choice?: string
  /** Present only for `chargeOn: 'start'` with a price above zero: the naira debited at the start (the adjusted price). */
  paid?: number
}

/** A trip between venues (systems/travel.js). The player is still recorded at the venue they left. */
export interface TravelAction extends ActiveActionBase {
  kind: 'travel'
  /** Destination venue. */
  id: VenueId
  /** Absent on a save from before per-mode travel (such a trip has the old flat duration and still arrives). */
  mode?: TravelModeId
  /** Naira charged at departure; absent on an older trip. Never refunded by a cancel. */
  fare?: number
}

/** The automatic "Go automatically" commute to the workplace (systems/career.js). Free and cancellable. */
export interface CommuteAction extends ActiveActionBase {
  kind: 'commute'
  /** The workplace venue of the job held. */
  id: VenueId
}

/** A phone call to a family contact (systems/social.js). Works anywhere; does not move the player. */
export interface CallAction extends ActiveActionBase {
  kind: 'call'
  id: FamilyId
}

/** The single timed-action slot. Only one runs at a time. */
export type ActiveAction = ActivityAction | TravelAction | CommuteAction | CallAction

/** Every registered timed-action kind. */
export type ActiveKind = ActiveAction['kind']

/** OWNER core. Identity of a life and the timed-action slot. */
export interface CoreSlice {
  /** Global schema version (STATE_VERSION, currently 1). Owned by src/life.js. */
  v: number
  /** Server ms this state was last settled to. */
  t: Ms
  /** Display name, 1–24 characters; 'New Lagosian' by default. */
  name: string
  /** The last thing the game told the player (at most 500 characters). A failed action mirrors its reason here. */
  message: string
  /** Where the player is recorded. Changes on ARRIVAL: during a trip it is still the venue being left. */
  location: VenueId
  activeAction: ActiveAction | null
}

// ---- wallet -------------------------------------------------------------------------------

/** One balance change, kept in full for the last LEDGER_LIMIT (60) changes. */
export interface LedgerLine {
  at: Ms
  /** Signed whole naira; never 0. */
  amount: number
  /** Human-readable reason, at most 80 characters. */
  reason: string
  /** Balance AFTER this change, so `balance - amount` is the balance before it. */
  balance: number
}

/** Summary of one Lagos day on which the balance changed (kept for the last 35 such days). */
export interface LedgerDay {
  day: LagosDay
  /** Balance when the day's first change happened. */
  open: number
  /** Balance after the day's last change; `open + in - out === close`. */
  close: number
  /** Money in (≥ 0). */
  in: number
  /** Money out (≥ 0). */
  out: number
  /** Number of changes that day. */
  n: number
  /** Net and count per reason group (at most 8 named groups plus "Other"). */
  by: Record<string, [net: number, count: number]>
}

/** OWNER wallet. Legacy flat keys: `cash`, `ledger`, `ledgerDays`. Never write `cash` directly — use api.credit/debit. */
export interface WalletSlice {
  /** Integer naira, never negative. */
  cash: number
  /** Newest last. */
  ledger: LedgerLine[]
  /** Newest last. */
  ledgerDays: LedgerDay[]
}

// ---- inventory ----------------------------------------------------------------------------

/** OWNER inventory. Counted items: count 1–9999, at most 200 kinds; an item at 0 is deleted. */
export interface InventorySlice {
  inventory: Record<ItemId, number>
}

// ---- needs --------------------------------------------------------------------------------

/** A stored, named mood modifier. */
export interface Moodlet {
  id: string
  /** At most 40 characters. */
  label: string
  /** Mood points, −100…100, a whole number. */
  value: number
  /** Server ms it lapses at, or null for one that lasts until removed. */
  expiresAt: Ms | null
}

/** OWNER needs. Legacy flat keys: `needs`, `decay`, `moodlets`. */
export interface NeedsSlice {
  /** Satisfaction 0–100 per need (may be fractional after a per-second activity). */
  needs: Record<NeedId, number>
  /** Sub-point background decay carried between settlements, each in [0, 1). */
  decay: Record<NeedId, number>
  /** At most 20, oldest first. */
  moodlets: Moodlet[]
}

// ---- skills -------------------------------------------------------------------------------

/** OWNER skills. XP per skill (0…5500); the level is derived (levelForXp). */
export interface SkillsSlice {
  skills: Record<SkillId, number>
}

// ---- career -------------------------------------------------------------------------------

export interface CareerState {
  /** 1-based ladder level in the current track (1 when unemployed or in the starter job). */
  level: number
  /** 0–100 in the current role (may be fractional). */
  performance: number
  /** Completed shifts in the current job. */
  shifts: number
  /** "Go automatically". */
  auto: boolean
  /** Lagos day the last paid career shift counted for — the one-shift-a-day idempotency key. */
  lastShiftDay: LagosDay | null
  /** Lagos day the running career shift started on. */
  shiftStartDay: LagosDay | null
  /** Lagos day of the last automatic commute. */
  autoDay: LagosDay | null
  /** True once any career shift has been completed (ends the day-off "orientation" allowance). */
  oriented: boolean
}

/** OWNER career. Legacy flat keys `job` and `completedShifts`, plus the `career` record. */
export interface CareerSlice {
  /** Job held, or null. Activities read it for `requiresJob`. Dropped at load if the workplace venue left the build. */
  job: JobId | null
  /** Lifetime count of completed shifts in any job. */
  completedShifts: number
  career: CareerState
}

// ---- activities ---------------------------------------------------------------------------

/** OWNER activities. Legacy flat key `spot`. (The `activity` timed action lives in core's `activeAction`.) */
export interface ActivitiesSlice {
  /** Spot the player stands at in `location`; null only if the venue has no spots. */
  spot: SpotId | null
}

// ---- travel -------------------------------------------------------------------------------

export interface TravelState {
  /** House used to place Home on the map (learned from 'life.started' / 'house.moved'). */
  home: HouseId
  /** Pending roadside choice; lapses on the next trip or after EVENT_TTL_SECONDS. */
  event: { id: RoadsideEventId; at: Ms } | null
  /** The trip that just ended. `mode` is null for a legacy trip without one. */
  lastTrip: { mode: TravelModeId | null; from: VenueId; to: VenueId } | null
  /** Venues arrived at by travelling, in first-visit order. */
  visited: VenueId[]
  /** Completed trips. */
  trips: number
  /** `{ [activityId]: readyAtMs }`, at most 80 entries; expired ones are removed on settlement. */
  cooldowns: Record<ActivityId, Ms>
  /**
   * True once the CcHub 'hub-pitch' seed grant has been paid.
   * INCONSISTENT: written as `state.travel[outcome.once]` (travel.js:268-269), so the key name comes
   * from content (events.js ACTIVITY_OUTCOMES … once: 'funded'); any other `once` value would be
   * written into this slice and lost at the next load. Unrelated to `goals.stats.funded`.
   */
  funded: boolean
  /** Paid gigs finished on Lagos day `day` (the daily gig limit). */
  gigs: { day: LagosDay; count: number }
  /** Lagos day a once-a-day roadside event was last offered. */
  eventDays: Partial<Record<RoadsideEventId, LagosDay>>
}

/** OWNER world. */
export interface TravelSlice {
  travel: TravelState
}

// ---- health -------------------------------------------------------------------------------

export type IllnessCause = 'neglect' | 'rain'

export interface HealthState {
  sick: boolean
  /** Null exactly when not sick. */
  cause: IllnessCause | null
  /** Server ms the illness began; null exactly when not sick. */
  since: Ms | null
  /** Seconds of neglect accumulated toward falling sick (0 … illness.neglectSeconds). */
  strain: number
  /** Server ms until which the player cannot fall sick; 0 when never immune. */
  immuneUntil: Ms
}

/** OWNER world. */
export interface HealthSlice {
  health: HealthState
}

// ---- economy ------------------------------------------------------------------------------

export interface Deposit {
  /** `fd-<seq>`. */
  id: string
  /** Whole naira locked. */
  amount: number
  term: DepositTermId
  openedAt: Ms
}

export interface EconomyState {
  /** Index of the last Saturday settled; null until there is something to bill. */
  billedWeek: number | null
  /** True once 'life.started' has been handled (it sets up the loan once). */
  started: boolean
  /** `missed` counts Saturdays missed in a row. `house` is null until 'life.started' or 'house.moved'. */
  rent: { house: HouseId | null; arrears: number; missed: number }
  /** `prepaid` = Saturdays already covered by an early instalment; `fees` = late fees added (at most 4). */
  loan: { left: number; prepaid: number; fees: number } | null
  /** At most 3. */
  deposits: Deposit[]
  /** Counter for deposit ids. */
  seq: number
  /** Billing week whose Friday reminder has been posted. */
  reminded: number | null
}

/** OWNER career. */
export interface EconomySlice {
  economy: EconomyState
}

// ---- property -----------------------------------------------------------------------------

export interface PropertyState {
  /** Where the player lives. The home grid and the move-in price come from HOUSES[house]. */
  house: HouseId
  /** Cars owned, each at most once. */
  cars: CarId[]
  /** The owned car currently driven, or null. */
  car: CarId | null
}

/** OWNER home. `homeOwned` is a legacy flag carried from old saves and otherwise unused. */
export interface PropertySlice {
  homeOwned: boolean
  property: PropertyState
}

// ---- home ---------------------------------------------------------------------------------

/** A placed object (rules in src/game/home-layout.js). */
export interface PlacedItem {
  /** `f<seq>`, unique within the room. */
  id: string
  itemId: FurnitureId
  /** Floor items: left tile of the footprint. Wall items: slot on the back wall (rot 0), else 0. */
  x: number
  /** Floor items: top tile of the footprint. Wall items: slot on the side wall (rot 1), else 0. */
  y: number
  /** Quarter turns 0–3 (an odd value swaps the footprint); wall items use only 0 (back wall) and 1 (side wall). */
  rot: number
}

/** Bookkeeping for the star-quality bonus on a running per-second activity (sleep, a nap). */
export interface HomeBoost {
  /** Activity id the bonus belongs to. */
  id: ActivityId
  /** Result multiplier, 0.5–4. */
  mult: number
  /** Seconds of the activity already paid out. */
  done: number
  /** The activity completed; the remainder is paid on the next settlement. */
  finished: boolean
}

export interface HomeState {
  items: PlacedItem[]
  /** Owned but not placed: `{ [furnitureId]: count }`, 1–99 each. */
  storage: Record<FurnitureId, number>
  /** Next number for a placed object's id. */
  seq: number
  /** The starter kitchen ingredients have been handed out. */
  stocked: boolean
  /** The player has rearranged something (a fresh room is re-laid at 'life.started'). */
  custom: boolean
  boost: HomeBoost | null
}

/** OWNER home. */
export interface HomeSlice {
  home: HomeState
}

// ---- onboarding ---------------------------------------------------------------------------

export type BodyId = 'woman' | 'man'
/** Hairstyles of either body (APPEARANCE.hair); which are valid depends on `body`. */
export type HairId = 'braids' | 'afro' | 'bun' | 'ponytail' | 'long' | 'locs' | 'low-cut' | 'gele' | 'classic' | 'bald' | 'curls'
/** Outfits of either body (APPEARANCE.outfits); which are valid depends on `body`. */
export type OutfitId = 'casual' | 'office' | 'owambe' | 'site-work' | 'hoodie' | 'chill'
export type FabricId = 'plain' | 'ankara' | 'adire' | 'aso-oke'
export type SkinId = 'skin-1' | 'skin-2' | 'skin-3' | 'skin-4' | 'skin-5' | 'skin-6' | 'skin-7'
export type HairColourId = 'black' | 'soft-black' | 'dark-brown' | 'brown' | 'auburn' | 'blonde' | 'purple'
/** Used for both the outfit colour and the bottoms colour. */
export type OutfitColourId = 'blue' | 'green' | 'red' | 'orange' | 'violet' | 'pink' | 'teal' | 'navy' | 'cream' | 'gold'

/** The wardrobe kinds: the three look fields that are bought rather than free. */
export type WardrobeKind = 'hair' | 'outfit' | 'fabric'

/**
 * The character's look, read by the scene code to draw the avatar. Every value is an id from
 * content/traits.js APPEARANCE; the hex of each swatch id is looked up there.
 * (The field names use American `Color`; the APPEARANCE lists use British `Colours`.)
 */
export interface Look {
  body: BodyId
  hair: HairId
  outfit: OutfitId
  fabric: FabricId
  skin: SkinId
  hairColor: HairColourId
  outfitColor: OutfitColourId
  bottomsColor: OutfitColourId
}

/** Owned styles: the basics, the look chosen at creation, and boutique purchases. */
export interface Wardrobe {
  hair: HairId[]
  outfit: OutfitId[]
  fabric: FabricId[]
}

export interface OnboardingState {
  /** The life has moved in. Traits and lottery effects apply only once true. */
  done: boolean
  /** Saved before character creation existed: treated as onboarded with the default look. */
  legacy: boolean
  /** This life must finish creation before anything else (every non-`onboarding.*` action is vetoed). */
  required: boolean
  /** 0–5: index of the next creation step still to confirm (5 = done). */
  step: number
  /** Cash the life was created with, so the start-cash grant tops the wallet up instead of adding to it. */
  seed: number
  look: Look
  /** Two trait ids once chosen, else []. */
  traits: TraitId[]
  dream: DreamId | null
  /** The birth lottery roll. Survives "new life": sanitize keeps it even when ctx.isNew. */
  lottery: { id: LotteryId; at: Ms } | null
  /** The starting home chosen. */
  house: StartHomeId | null
  wardrobe: Wardrobe
  /** Server ms the life moved in. */
  completedAt: Ms | null
  /** Server ms a food bonus was last given (so one meal is never counted twice); 0 when never. */
  bonusAt: Ms
}

/** OWNER character. */
export interface OnboardingSlice {
  onboarding: OnboardingState
}

// ---- goals --------------------------------------------------------------------------------

export interface ActiveWish {
  id: WishId
  /** Progress towards the wish's target. */
  n: number
  /** Lagos day `n` counts for (an 'earn' wish restarts each day). */
  day: LagosDay
}

/** What the dream formulas measure, collected from other systems' events. */
export interface GoalStats {
  /** Friends made (capped at 999). */
  friends: number
  /** Best friends counted (capped at 999). */
  best: number
  /** Highest career level reached. */
  level: number
  /** Size of the career ladder last reported by an event; 0 until one is. */
  levelCap: number
  /** Naira spent on furniture and groceries ('item.bought' prices). */
  assets: number
  /** Loan balance last reported. */
  debt: number
  /** Has ever arrived at CcHub. */
  cchub: boolean
  /** The one-off 'dream-startup-pitch' was completed (pays DREAM_TARGETS.funding). Not the same flag as `travel.funded`. */
  funded: boolean
}

export interface GoalsState {
  /** The starter chain is running (set by 'life.started'). */
  started: boolean
  /** 0–7: index in STARTER_GOALS of the current starter goal (7 = chain finished). */
  chain: number
  /** Later goals whose condition already happened; they pay as soon as the chain reaches them. */
  seen: StarterGoalId[]
  /** Unspent stars (at most 1,000,000). */
  stars: number
  perks: PerkId[]
  /** Up to 3 active wishes. */
  wishes: ActiveWish[]
  /** Wish re-rolls used on that Lagos day. */
  rerolls: { day: LagosDay; used: number }
  /** Wishes that have come true. */
  granted: number
  dream: DreamId | null
  /** The dream's reward was paid. */
  dreamDone: boolean
  stats: GoalStats
  /** Friend ids already counted as best friends (at most 16), so one friend counts once. */
  besties: string[]
  /** Counter for `feed[].n`. */
  seq: number
  /** The last 8 announcements; the UI toasts each `n` once. */
  feed: { n: number; text: string }[]
}

/** OWNER character. */
export interface GoalsSlice {
  goals: GoalsState
}

// ---- social -------------------------------------------------------------------------------

/** Closeness with one NPC or one real player. Short keys keep the save small. */
export interface Relationship {
  /** Closeness points 0–100, one decimal. */
  p: number
  /** Lagos day of the last interaction. */
  d: LagosDay
  /** Interactions on day `d` (at most DAILY_INTERACTIONS). */
  n: number
  /** True for an NPC (the key is an NpcId); false for a player (the key is a PlayerPublicId). */
  npc: boolean
  /** Server ms of first contact. */
  at: Ms
  /** Players only: display name, at most 24 characters. */
  name?: string
  /** Players only, and only while friends (the key is deleted on unfriend). NPC friendship is derived from points. */
  friend?: true
}

/** A line in Messages → Updates. */
export interface Notice {
  /** Counts up by one per notice within a life. */
  id: number
  /** A slug: see NoticeKind in registry.ts for the kinds the engine posts; 'notice' when the kind was invalid. */
  kind: string
  /** At most 160 characters. */
  text: string
  at: Ms
}

export interface SocialState {
  /** Keyed by NPC id or player public id; at most 200. */
  rel: Record<string, Relationship>
  /** The Bae's player public id. */
  bae: PlayerPublicId | null
  /** Last Lagos day each family member was called. */
  family: Partial<Record<FamilyId, LagosDay>>
  /** Consecutive days with at least one family call. */
  streak: { day: LagosDay; count: number }
  /** Naira earned from paid activities — the ceiling on lifetime gifts. */
  earned: number
  /** Gifts sent on `day` (`sent` naira over `count` gifts) and in this life (`total`). */
  transfer: { day: LagosDay; sent: number; count: number; total: number }
  /** At most 20, oldest first. */
  notices: Notice[]
}

/** OWNER social. */
export interface SocialSlice {
  social: SocialState
}

// ---- civic --------------------------------------------------------------------------------

export type GemKind = 'visit' | 'activity'

export interface HuntGem {
  venue: VenueId
  /** 'visit' gems: the spot to stand at (null = anywhere in the venue). Always null for 'activity' gems. */
  spot: SpotId | null
  /** 'visit' — stand there; 'activity' — finish any activity in the venue. */
  kind: GemKind
  found: boolean
}

export interface DailyHunt {
  day: LagosDay
  /** The daily prize was paid (only possible once every gem is found). */
  claimed: boolean
  /** 1–3 gems. */
  gems: HuntGem[]
}

export interface CivicState {
  /** Unsigned 32-bit integer that fixes where this player's gems hide each day. */
  seed: number
  /** Server ms this life first existed in the city (for "days lived here"). */
  since: Ms
  /** Lifetime gems found. */
  gems: number
  /** Lifetime daily prizes claimed. */
  claims: number
  /** Naira received in Monday-started Lagos week `week`. */
  week: { week: number; earned: number }
  /** Different Lagos days this life was paid for work on, and the last such day (null exactly when days is 0). */
  work: { days: number; last: LagosDay | null }
  /** City news ids already posted to Updates, newest last (at most 40). */
  news: string[]
  /** Null on a fresh life until the first settlement or 'civic.refresh' rolls today's hunt. */
  hunt: DailyHunt | null
}

/** OWNER civic. */
export interface CivicSlice {
  civic: CivicState
}

// ---- the whole state ----------------------------------------------------------------------

/**
 * One JSON object per life per city. A top-level key outside this interface cannot exist:
 * the engine throws `Undeclared state key` the moment one is written.
 */
export interface LifeState extends CoreSlice, WalletSlice, InventorySlice, NeedsSlice, SkillsSlice, CareerSlice, ActivitiesSlice,
  TravelSlice, HealthSlice, EconomySlice, PropertySlice, HomeSlice, OnboardingSlice, GoalsSlice, SocialSlice, CivicSlice {}

/** System ids in registration order (systems/index.js). Sanitize, events and modifiers all run in this order. */
export type SystemId =
  | 'core' | 'wallet' | 'inventory' | 'needs' | 'skills' | 'career' | 'activities' | 'travel' | 'health'
  | 'economy' | 'property' | 'home' | 'onboarding' | 'goals' | 'social' | 'civic'

/** The top-level keys each system owns. */
export interface SliceBySystem {
  core: CoreSlice
  wallet: WalletSlice
  inventory: InventorySlice
  needs: NeedsSlice
  skills: SkillsSlice
  career: CareerSlice
  activities: ActivitiesSlice
  travel: TravelSlice
  health: HealthSlice
  economy: EconomySlice
  property: PropertySlice
  home: HomeSlice
  onboarding: OnboardingSlice
  goals: GoalsSlice
  social: SocialSlice
  civic: CivicSlice
}

// ---- context and results ------------------------------------------------------------------

/**
 * The `ctx` every system receives, built by `makeContext()` in src/game/util.js.
 * makeContext passes any other property through untouched (`...rest`); the optional fields below
 * are the ones the engine itself reads.
 * INCONSISTENT: the contract in registry.js:78 lists `{ now, cityId, rng, isNew?, actionId?,
 * requireOnboarding?, internal? }` and omits `trustedSave`, which core.js:39 and activities.js:254 read.
 */
export interface LifeContext {
  /** Server time in ms — the only clock a system may read. During advanceLife it is the END of the interval. */
  now: Ms
  /** The city this life belongs to ('lagos', 'ibadan' …). */
  cityId: string
  /** Deterministic float in [0, 1), seeded from the action id or the settlement interval (keyed with a per-life secret on a server). */
  rng: () => number
  /** createLife only: true when no save existed (a brand-new life). */
  isNew?: boolean
  /** The client-chosen id of the request being applied (set by the server host; the engine never reads it). */
  actionId?: string
  /** createLife only, with isNew: the life must finish character creation before anything else. */
  requireOnboarding?: boolean
  /** dispatch only: true lets a server-only action run. Set by the route host's ctx.act and by nothing a player can reach. */
  internal?: boolean
  /** createLife only: the input is the server's own stored copy, so an invalid saved action may be settled (refunded or charged). */
  trustedSave?: boolean
}

/**
 * What a caller may hand to createLife / dispatch / advanceLife / viewLife instead of a built
 * context: the engine builds one (src/life.js contextFor) unless `rng` is already a function.
 * `seed` and `salt` are consumed by makeContext and are not part of the resulting LifeContext.
 */
export interface LifeContextInit extends Partial<LifeContext> {
  /** Seed text for the generator (the engine supplies `create`, `action|<id>`, `settle|…` or `view`). */
  seed?: string
  /** Server-held secret the seed is keyed with, so outcomes cannot be computed from anything a client knows. */
  salt?: string
}

/** A successful action, as built by `ok()` in util.js. */
export interface ActionSuccess<Code extends string = string> {
  ok: true
  code: Code
  /** The same object that was passed in, mutated. */
  state: LifeState
}

/** A refused action, as built by `fail()` in util.js. The reason is mirrored in `state.message`. */
export interface ActionFailure<Code extends string = string> {
  ok: false
  code: Code
  state: LifeState
  /**
   * Names the unmet prerequisite. The key is absent when fail() was called without one.
   * INCONSISTENT: the contract says a failure MUST carry a reason, but 'cancel' with nothing
   * running returns `fail(state, 'idle')` without one (core.js:74).
   */
  reason?: string
}

/** `{ ok, code, state, reason? }` — the result of every action handler and of dispatch(). */
export type ActionOutcome<OkCode extends string = string, FailCode extends string = string> = ActionSuccess<OkCode> | ActionFailure<FailCode>

/** The result of advanceLife(). 'invalid_time' (ok: false) means dt was not a positive finite number and nothing ran. */
export interface AdvanceOutcome {
  ok: boolean
  code: 'idle' | 'advanced' | 'completed' | 'invalid_time'
  state: LifeState
}

// ---- runtime lists (checked against the running engine by engine.test.ts) -------------------

/** Every top-level key of a life, sorted. Equals `Object.keys(createLife(null, ctx)).sort()`. */
export const LIFE_STATE_KEYS = [
  'activeAction', 'career', 'cash', 'civic', 'completedShifts', 'decay', 'economy', 'goals', 'health', 'home',
  'homeOwned', 'inventory', 'job', 'ledger', 'ledgerDays', 'location', 'message', 'moodlets', 'name', 'needs',
  'onboarding', 'property', 'skills', 'social', 'spot', 't', 'travel', 'v',
] as const satisfies readonly (keyof LifeState)[]

/** Each system's `stateKeys`, in registration order. */
export const SYSTEM_STATE_KEYS = {
  core: ['v', 't', 'name', 'message', 'location', 'activeAction'],
  wallet: ['cash', 'ledger', 'ledgerDays'],
  inventory: ['inventory'],
  needs: ['needs', 'decay', 'moodlets'],
  skills: ['skills'],
  career: ['job', 'completedShifts', 'career'],
  activities: ['spot'],
  travel: ['travel'],
  health: ['health'],
  economy: ['economy'],
  property: ['homeOwned', 'property'],
  home: ['home'],
  onboarding: ['onboarding'],
  goals: ['goals'],
  social: ['social'],
  civic: ['civic'],
} as const satisfies { readonly [S in SystemId]: readonly (keyof SliceBySystem[S])[] }

/**
 * The fields of every fixed-shape object slice, sorted. A slice keyed by a dynamic id
 * (`inventory`) is not listed; `needs`/`decay` are keyed by NeedId and `skills` by SkillId.
 */
export const SLICE_FIELD_KEYS = {
  career: ['auto', 'autoDay', 'lastShiftDay', 'level', 'oriented', 'performance', 'shiftStartDay', 'shifts'],
  travel: ['cooldowns', 'event', 'eventDays', 'funded', 'gigs', 'home', 'lastTrip', 'trips', 'visited'],
  health: ['cause', 'immuneUntil', 'sick', 'since', 'strain'],
  economy: ['billedWeek', 'deposits', 'loan', 'reminded', 'rent', 'seq', 'started'],
  property: ['car', 'cars', 'house'],
  home: ['boost', 'custom', 'items', 'seq', 'stocked', 'storage'],
  onboarding: ['bonusAt', 'completedAt', 'done', 'dream', 'house', 'legacy', 'look', 'lottery', 'required', 'seed', 'step', 'traits', 'wardrobe'],
  goals: ['besties', 'chain', 'dream', 'dreamDone', 'feed', 'granted', 'perks', 'rerolls', 'seen', 'seq', 'stars', 'started', 'stats', 'wishes'],
  social: ['bae', 'earned', 'family', 'notices', 'rel', 'streak', 'transfer'],
  civic: ['claims', 'gems', 'hunt', 'news', 'seed', 'since', 'week', 'work'],
} as const satisfies { readonly [K in keyof LifeState]?: readonly (keyof LifeState[K])[] }

/** NEEDS, in the engine's display order. */
export const NEED_IDS = ['hunger', 'energy', 'fun', 'social', 'hygiene', 'bladder'] as const satisfies readonly NeedId[]

/** SKILLS, in the engine's display order. */
export const SKILL_IDS = ['cooking', 'charisma', 'fitness', 'coding', 'music', 'hustle', 'dance', 'comedy', 'photography'] as const satisfies readonly SkillId[]

/** Every registered timed-action kind, sorted. */
export const ACTIVE_KINDS = ['activity', 'call', 'commute', 'travel'] as const satisfies readonly ActiveKind[]
