import type { AvatarLookExtensions, AvatarWearableId } from './avatar.ts';
/**
 * The saved state of one life, as built by `createLife()` in src/life.ts.
 *
 * Every shape here is read off the owning system's `stateKeys` and `sanitize()` in
 * src/game/systems/*.js: what sanitize rebuilds is what a state can contain, nothing else
 * survives a load. `src/types/engine.test.ts` fails when the running code and these types drift.
 *
 * Naming: a `<System>Slice` holds the TOP-LEVEL state keys a system owns (its `stateKeys`);
 * `LifeState` is the intersection of all twenty-three (the three campus slices are in campus.ts). Older systems keep several flat keys
 * (`cash`, `needs`, `job` …); newer ones keep one object under their own id (`travel`, `goals` …),
 * typed as `<System>State`.
 */
import type { CampusActiveAction, UnilagCommunitySlice, UnilagShuttleSlice, UnilagStudentSlice } from './campus.ts'

// ---- closed id sets -----------------------------------------------------------------------

/** The six needs (systems/needs.js NEEDS). Satisfaction 0–100, higher is better. */
export type NeedId = 'hunger' | 'energy' | 'fun' | 'social' | 'hygiene' | 'bladder'

/** The nine skills (systems/skills.js SKILLS). */
export type SkillId = 'cooking' | 'charisma' | 'fitness' | 'coding' | 'music' | 'hustle' | 'dance' | 'comedy' | 'photography'

/**
 * Every venue in this build (keys of content/venues.js VENUES). `state.location` is always one of these.
 * 'unilag' (the campus, src/campus/unilag/content.ts) exists in Lagos only: see VenueDefinition.cities.
 */
export type VenueId<City extends string = string> = import('../game/cities/ids.ts').VenueId<City>

/**
 * Places shown on the map that cannot be travelled to yet (content/venues.js COMING_SOON).
 * The table is EMPTY in this build (the airport and the refinery became venues), so the union has
 * no member; the mechanism stays for the next place ('coming_soon', destination kind 'soon').
 */
export type ComingSoonId = never

/**
 * Cities the RULES know (content/world.js CITY_RULES). Only 'lagos' is open; the others are data for
 * the links between cities. Not the same set as protocol.ts `CityId` (server/protocol.ts CITY_IDS:
 * the cities a server keeps lives for) — hence the different name.
 */
export type WorldCityId = import('../game/cities/ids.ts').CityId

/** A city's local-government id (Lagos definitions live in cities/lagos/localUnits.ts). */
export type LgaId<City extends string = string> = import('../game/cities/ids.ts').LgaId<City>

/** Sizes of the house everyone has on a plot, smallest first (content/world.js HOUSE_TIERS / TIER_ORDER). */
export type HouseTierId = 'starter' | 'bq' | 'bungalow' | 'duplex' | 'villa'

/** The fields of a house's look (content/world.js STYLE_FIELDS); each holds an index into HOUSE_STYLE[field]. */
export type HouseStyleField = 'shape' | 'wall' | 'roof' | 'door' | 'windows' | 'fence' | 'yard' | 'sign'

/** How two cities connect (content/world.js CITY_LINKS[].mode). */
export type CityLinkMode = 'road' | 'air' | 'rail'

/** Houses a life can live in (content/housing.js HOUSES; also the keys of venues.js HOME_SPOTS and economy.js RENTS). */
export type HouseId<City extends string = string> = import('../game/cities/ids.ts').HouseId<City>

/** Houses offered at the end of character creation (content/traits.js START_HOMES). */
export type StartHomeId = 'mushin' | 'yaba' | 'lekki'

/** The five base travel modes (content/travel.js TRAVEL_MODES). */
export type BaseTravelModeId = 'trek' | 'keke' | 'danfo' | 'okada' | 'cab'

/** Every mode the travel action accepts: the base five plus the own-car mode (ALL_MODES). */
export type TravelModeId = BaseTravelModeId | 'car' | 'boat'

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

/**
 * Starter goal ids, in chain order (content/goals.js STARTER_GOALS). The first three are the quick
 * start's (played as a guest, before there is a home); STARTER_INTRO counts them.
 */
export type StarterGoalId = 'first-fun' | 'say-hello' | 'settle-in' | 'eat' | 'freshen-up' | 'get-a-job' | 'buy-something' | 'visit-buka' | 'make-a-friend' | 'work-a-shift'

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
/** content/missions.js DAILY_MISSIONS / WEEKLY_MISSIONS id (`d-…` / `w-…`). */
export type MissionId = string
/** Titles a life can earn (content/missions.js DAY_TITLES and WEEK_TITLE). */
export type MissionTitleId = 'settled' | 'lagosian' | 'city-elder' | 'week-finisher'
/** One occurrence of a calendar event: `<eventId>:<lagosDay>` (calendar.js occurrenceOn). */
export type EventOccurrenceKey = string
/** Another player's public id: a 36-character lowercase UUID (systems/social.js playerId). */
export type PlayerPublicId = string
/** Server time in milliseconds. */
export type Ms = number
/** Whole Lagos days since 1970-01-01 (clock.js lagosTime().day). */
export type LagosDay = number
/** Monday-started Lagos week index (clock.js lagosTime().week). */
export type LagosWeek = number

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

/**
 * The trip between two cities (systems/estate.js 'estate.relocate'). It cannot be cancelled once the
 * fare is paid ('no_cancel'); on arrival `state.estate.city` changes and the player is put at Home.
 */
export interface IntercityAction extends ActiveActionBase {
  kind: 'intercity'
  /** Destination city. */
  id: WorldCityId
  mode: CityLinkMode
  /** Naira charged at departure; given back only if the link no longer exists at a load. */
  fare: number
  /** The city being left. */
  from: WorldCityId
}

/** The single timed-action slot. Only one runs at a time. The campus kinds ('campus-study', 'campus-game', 'campus-shuttle') are in campus.ts. */
export type ActiveAction = ActivityAction | TravelAction | CommuteAction | CallAction | IntercityAction | CampusActiveAction

/** Every registered timed-action kind. */
export type ActiveKind = ActiveAction['kind']

/** OWNER core. Identity of a life and the timed-action slot. */
export interface CoreSlice {
  /** Global schema version (STATE_VERSION, currently 1). Owned by src/life.ts. */
  v: number
  /** Server ms this state was last settled to. */
  t: Ms
  /** Display name, 1–24 characters; the city module's defaultName ('New Lagosian' in Lagos) by default. */
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
  city: WorldCityId | null
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
  /** Lagos day of the last move of this job to another city (at most one a day). */
  transferDay: LagosDay | null
  /** True once any career shift has been completed (ends the day-off "orientation" allowance). */
  oriented: boolean
  /** Work dilemmas (src/game/dilemmas.ts). Absent until a dilemma has come up; a life saved before it existed loads unchanged. */
  dilemmas?: DilemmaBook
}

/** The work-dilemma record of a life: the one waiting for an answer, the last few seen, and the memory tags earned. */
export interface DilemmaBook {
  /** The dilemma waiting for a choice and the seed its dice are rolled from. */
  pending: { id: string; seed: number } | null
  /** Ids of the last few dilemmas seen (at most 8), oldest first, so they do not repeat at once. */
  seen: string[]
  /** Memory or reputation tags earned (at most 12), oldest first. */
  memory: string[]
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
  /** City-qualified venues, in first-visit order (bare ids remain Lagos); bounded to 512. */
  visited: string[]
  /** Completed trips. */
  trips: number
  /** City-qualified activity keys (bare ids remain Lagos), at most 80; expired timers are removed. */
  cooldowns: Record<string, Ms>
  /**
   * True once the CcHub 'hub-pitch' seed grant has been paid.
   * INCONSISTENT: written as `state.travel[outcome.once]` (travel.js:271-272), so the key name comes
   * from content (events.js ACTIVITY_OUTCOMES … once: 'funded'); any other `once` value would be
   * written into this slice and lost at the next load. Unrelated to `goals.stats.funded`.
   */
  funded: boolean
  /** Paid gigs finished on Lagos day `day` (the daily gig limit). */
  gigs: { day: LagosDay; count: number }
  /** Lagos day a once-a-day roadside event was last offered. */
  eventDays: Partial<Record<RoadsideEventId, LagosDay>>
  /** True once a trip between cities was skipped ('travel.skip': the first such skip is free). False on a save from before skipping. */
  skipped: boolean
  /**
   * Naira still owed for a ride home taken on credit (systems/relief: src/game/relief.ts). ABSENT when nothing is owed, so a life from
   * before the rule is unchanged. Repaid from earnings; while it is above zero no other trip between cities starts.
   */
  rideDebt?: number
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
  /** Billing week whose Thursday heads-up has been posted (one more than the week index, like `reminded`). */
  headsUp: number | null
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

// ---- estate -------------------------------------------------------------------------------

/** The address the server allocated: `estate` 0…511 and `plot` 0…195 inside local government `lga` (world.js validPlot). */
export interface PlotAddress {
  lga: LgaId
  estate: number
  plot: number
}

/** The look of a house: one index per field into content/world.js HOUSE_STYLE. */
export type HouseStyle = Record<HouseStyleField, number>

/** An upgrade being built. It finishes when the server clock passes `doneAt`, whether or not the player is around. */
export interface HouseUpgrade {
  to: HouseTierId
  /** Naira paid. */
  cost: number
  startedAt: Ms
  doneAt: Ms
}

/** How the local government was chosen: found on the player's device, picked from the list, or the game's guess. */
export type LgaVia = 'device' | 'manual' | 'default'

/** A home in one city (estate.js cleanResidence): the part of `state.estate` that is put away when the life leaves a city. */
export interface Residence {
  /** The local government the life belongs to; null only in a city that has none. */
  lga: LgaId | null
  /** Server ms the local government was last chosen or changed. */
  lgaAt: Ms | null
  /** False while `lga` is only the game's guess from the home district. */
  lgaConfirmed: boolean
  lgaVia: LgaVia
  /** Null until the server has allocated one ('estate.assign'). */
  plot: PlotAddress | null
  /** The address left behind by a change of local government, kept until the server has freed it ('estate.released'). */
  old: PlotAddress | null
  tier: HouseTierId
  style: HouseStyle
  upgrade: HouseUpgrade | null
  /** Which home Home is. While 'own' no weekly rent is charged and the room is the tier's grid. */
  living: 'own' | 'rent'
  /** Ground-rent billing: the last Saturday settled (null until the house has a ground rent) and what is owed. */
  ground: { week: number | null; arrears: number }
}

/** A home kept in another city: its residence plus the rented tier that was current there. */
export interface AwayResidence extends Residence {
  house: HouseId
}

export interface EstateState extends Residence {
  /** The city this character is in (the id its life is stored under). */
  city: WorldCityId
  /** Homes kept in other cities, at most 16. */
  away: Partial<Record<WorldCityId, AwayResidence>>
  /** The "you can afford an upgrade" notice has been posted. */
  nudged: boolean
  /** The city of the primary home (it is the current city, or a key of `away`), or null while the life has no home anywhere. Worked out at load for a save without it. */
  home: WorldCityId | null
  /** Server ms the main home was last moved to another city by the player, or null. */
  homeAt: Ms | null
  /** Absent unless the player confirmed (and has not switched it off, moved their main home or let it lapse). */
  confirmed?: ResidenceConfirmed
}

/**
 * A device's word that its owner was in their main home's local government, once, when they pressed the button
 * (docs/LOCATION.md). The game never saw a position: this is only the id and the server's clock.
 */
export interface ResidenceConfirmed {
  lga: LgaId
  at: Ms
}

/** OWNER world. */
export interface EstateSlice {
  estate: EstateState
}

// ---- home ---------------------------------------------------------------------------------

/** A placed object (rules in src/game/home-layout.ts). */
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
  /** Storey, 1 and up (left out on the ground floor, which every save from before storeys is on). */
  floor?: number
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
  /** Pieces displaced by a refit after storage filled. Refill storage as pieces are used or sold. */
  overflow?: Record<FurnitureId, number>
  /** Next number for a placed object's id. */
  seq: number
  /** The starter kitchen ingredients have been handed out. */
  stocked: boolean
  /** The player has rearranged something (a fresh room is re-laid at 'life.started'). */
  custom: boolean
  boost: HomeBoost | null
  /** Petrol in the generator, in seconds of running (0 – 48,000). Saves from before generators had fuel load as 0. */
  fuel: number
}

/** OWNER home. */
export interface HomeSlice {
  home: HomeState
}

// ---- onboarding ---------------------------------------------------------------------------

export type BodyId = 'woman' | 'man'
/** Hairstyles of either body (APPEARANCE.hair, then the beta additions in APPEARANCE.extra.hair); which are valid depends on `body`. */
export type HairId =
  | 'braids' | 'afro' | 'bun' | 'ponytail' | 'long' | 'locs' | 'low-cut' | 'gele' | 'classic' | 'bald' | 'curls'
  | 'bantu-knots' | 'cornrows' | 'fade' | 'twists'
/** Outfits of either body (APPEARANCE.outfits, then APPEARANCE.extra.outfits); which are valid depends on `body`. */
export type OutfitId = 'casual' | 'office' | 'owambe' | 'site-work' | 'hoodie' | 'chill' | 'jersey' | 'kaftan' | 'gown' | 'agbada'
export type FabricId = 'plain' | 'ankara' | 'adire' | 'aso-oke'
export type SkinId = 'skin-1' | 'skin-2' | 'skin-3' | 'skin-4' | 'skin-5' | 'skin-6' | 'skin-7'
export type HairColourId = 'black' | 'soft-black' | 'dark-brown' | 'brown' | 'auburn' | 'blonde' | 'purple'
/** Used for both the outfit colour and the bottoms colour. */
export type OutfitColourId = 'blue' | 'green' | 'red' | 'orange' | 'violet' | 'pink' | 'teal' | 'navy' | 'cream' | 'gold'

/** The wardrobe kinds: the three look fields that are bought rather than free. */
export type WardrobeKind = 'hair' | 'outfit' | 'fabric'

/** Accessories (APPEARANCE.accessories): at most APPEARANCE.accessoryLimit on a look, and one per slot. */
export type AccessoryId = 'glasses' | 'sunglasses' | 'cap' | 'headwrap' | 'fila' | 'earrings' | 'chain' | 'watch' | 'beads' | 'backpack' | 'handbag'
/** Where an accessory is worn. */
export type AccessorySlot = 'eyes' | 'head' | 'ears' | 'neck' | 'wrist' | 'hand' | 'carry'
/** Face shapes (APPEARANCE.faces); the first is the default and is never stored. */
export type FaceId = 'oval' | 'round' | 'long'
/** Expressions (APPEARANCE.expressions); the first is the default and is never stored. */
export type ExpressionId = 'smile' | 'neutral' | 'grin'

/**
 * The character's look, read by the scene code to draw the avatar. Every value is an id from
 * content/traits.js APPEARANCE; the hex of each swatch id is looked up there.
 * (The field names use American `Color`; the APPEARANCE lists use British `Colours`.)
 */
export interface Look extends AvatarLookExtensions {
  body: BodyId
  hair: HairId
  outfit: OutfitId
  fabric: FabricId
  skin: SkinId
  hairColor: HairColourId
  outfitColor: OutfitColourId
  bottomsColor: OutfitColourId
  /** The key exists only while at least one accessory is worn (onboarding.js checkLook). */
  accessories?: AccessoryId[]
  /** The key exists only for a face other than the default 'oval'. */
  face?: Exclude<FaceId, 'oval'>
  /** The key exists only for an expression other than the default 'smile'. */
  expression?: Exclude<ExpressionId, 'smile'>
}

/** Owned styles: the basics, the look chosen at creation, and boutique purchases. */
export interface Wardrobe {
  /** Purchased layers; free layers are supplied by the catalogue. */
  wearables?: AvatarWearableId[]
  hair: HairId[]
  outfit: OutfitId[]
  fabric: FabricId[]
  /** BOUGHT accessories only (the free ACCESSORY_BASICS are not listed); the key exists only once there is one. */
  accessories?: AccessoryId[]
}

/** 'guest': made by the quick start and not moved in yet. 'settled': every other life (see THE STAGED MODEL in onboarding.js). */
export type OnboardingStage = 'guest' | 'settled'

export interface OnboardingState {
  /**
   * A guest plays in public venues at once but has no home, no local government and no house until
   * 'onboarding.home' succeeds: going Home, `home.*`, `estate.*`, 'property.house-move' and the student
   * actions of the campus (campus.ts GuestCampusActionType) are refused with 'settle_required'.
   */
  stage: OnboardingStage
  /** The life has moved in. Traits and lottery effects apply only once true. */
  done: boolean
  /** Saved before character creation existed: treated as onboarded with the default look. */
  legacy: boolean
  /**
   * A guest whose look is not confirmed yet: until 'onboarding.quick-start' (or 'onboarding.look')
   * every non-`onboarding.*` action is vetoed with 'onboarding_required'. Set only for a life created
   * with ctx.quickStart; false again from the moment the look is confirmed.
   */
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
  /** The rented starting home chosen; null also for a life that settled into its own starter house. */
  house: StartHomeId | null
  wardrobe: Wardrobe
  /** Server ms the life moved in. */
  completedAt: Ms | null
  /** Server ms a food bonus was last given (so one meal is never counted twice); 0 when never. */
  bonusAt: Ms
  /** Server ms a guest life was created; null for a life not made by the quick start. */
  bornAt: Ms | null
  /** Server ms the quick start was confirmed. */
  playedAt: Ms | null
  /** Server ms the first activity finished while a guest. */
  firstAt: Ms | null
  /** Activities finished while a guest (at most 9999). */
  activities: number
  /** The START_NEEDS were handed out (at the quick start, or at move-in: once either way). */
  needsSet: boolean
  /** The one free arrival at an inviter's venue was used ('onboarding.arrive'). */
  joined: boolean
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
  /** The starter chain is running: from the first moment for a guest of the quick start, otherwise from 'life.started'. */
  started: boolean
  /** Index in STARTER_GOALS of the current starter goal (STARTER_GOALS.length, 10, = chain finished). */
  chain: number
  /** Version of the goal order `chain` counts in; always 2 once loaded (a save without it is moved past the opening goals). */
  cv: 2
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
export interface MemoryFact { k: string; v?: string; day: LagosDay }
export interface Relationship {
  m?: MemoryFact[]
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
  /** NPCs only: what they remember of you, as short ids (at most 4), e.g. `haggled`. Absent until something is remembered. */
  tags?: string[]
  /** Players only, and only while friends (the key is deleted on unfriend). NPC friendship is derived from points. */
  friend?: true
  /** Non-Lagos NPCs only: bounded identity retained when the origin city's lazy content is not loaded. */
  npcSnapshot?: { city: WorldCityId; name: string; emoji: string; role: string }
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
  rumours?: MemoryFact[]
  followUps?: MemoryFact[]
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
  /**
   * UNRESTRICTED FUNDS: naira an admin credited without the gift restrictions (systems/wallet.ts freeOf). A gift to another player and a purchase at a player's stall
   * draw on it first and, for the part it covers, are exempt from the earned-from-work rule and the gift caps. Never more than the cash held (any spend
   * brings it down to cash). The launch bonus is not part of it. Absent = 0; a life saved before it existed loads unchanged.
   */
  free?: number
  /** A discount earned by haggling at the market: `pct` percent off the next grocery order, valid on Lagos day `day` only. Absent when none. */
  coupon?: { pct: number; day: LagosDay }
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
  city?: WorldCityId
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

// ---- missions -----------------------------------------------------------------------------

/** One dealt mission and its progress. */
export interface MissionEntry {
  id: MissionId
  /** Progress, at most the mission's `count`. */
  n: number
  /** Venue ids already counted (for 'venue' missions), at most 12. */
  marks: VenueId[]
  /** The naira was collected (only possible once `n` reached the count). */
  claimed: boolean
}

export interface MissionsState {
  /** Unsigned 32-bit integer that fixes which missions this life is dealt each day. */
  seed: number
  /** Lagos day the daily set belongs to; 0 until a set has been dealt (never for a guest). */
  day: LagosDay
  /** At most MISSION_REWARDS.daily.slots (3), one of each kind. */
  daily: MissionEntry[]
  /** Lagos week the weekly set belongs to; 0 until one has been dealt. */
  week: LagosWeek
  weekly: MissionEntry[]
  /** Daily swaps used on `day`. */
  rerolls: number
  /** The Lagos day / week whose set bonus was already granted (0 = none). */
  sets: { day: LagosDay; week: LagosWeek }
  /** Lagos days with any counted activity (only ever goes up) and the last such day (null exactly when days is 0). */
  active: { days: number; last: LagosDay | null }
  /** This week's stamp card: one stamp per active day, `paid` once the stars were granted. */
  stamps: { week: LagosWeek; days: number; paid: boolean }
  /** Venues arrived at this Lagos week (for "somewhere new"), at most 64. */
  visited: { week: LagosWeek; list: VenueId[] }
  /** Last Lagos day a paid activity was counted as a day worked. */
  paidDay: LagosDay
  titles: MissionTitleId[]
  /** Lifetime missions claimed. */
  claimed: number
}

/** OWNER growth. */
export interface MissionsSlice {
  missions: MissionsState
}

// ---- events -------------------------------------------------------------------------------

export interface EventsState {
  /** The last 24 occurrences attended, newest last (so each counts once). */
  attended: EventOccurrenceKey[]
  /** Lifetime events attended. */
  count: number
  /** Naira sprayed on Lagos day `day` (at most SPRAY.perDay). */
  spray: { day: LagosDay; spent: number }
  /** Lifetime naira sprayed. */
  sprayed: number
}

/** OWNER growth. */
export interface EventsSlice {
  events: EventsState
}

// ---- growth -------------------------------------------------------------------------------

export interface GrowthState {
  /** Today's paid wins and bot credits (reset when `day` turns); lifetime games played and won. */
  tables: { day: LagosDay; paid: number; bots: number; played: number; won: number }
  /** This life has received its one referral welcome gift. */
  welcomed: boolean
  /** Referral rewards paid in Lagos week `week` and for life. */
  referrals: { week: LagosWeek; paid: number; total: number }
}

/** OWNER growth. */
export interface GrowthSlice {
  growth: GrowthState
}

// ---- business -----------------------------------------------------------------------------

/** The life's side of businesses (systems/business.ts). The shop itself is shared state on the server. */
export interface BusinessState {
  /** Shops this life has opened. */
  opened: number
  /** Units sold by its shops, counted when the takings are collected. */
  sales: number
  /** Naira spent at other players' shops, for life: never more than `social.earned`. */
  spent: number
  /** Today's spending at players' shops. */
  buys: { day: LagosDay; spent: number; count: number }
  /** Trade goods carried, units by product id. */
  bag: Record<string, number>
}

/** OWNER business. */
export interface BusinessSlice {
  business: BusinessState
}

// ---- the whole state ----------------------------------------------------------------------

/**
 * One JSON object per life per city. A top-level key outside this interface cannot exist:
 * the engine throws `Undeclared state key` the moment one is written.
 */
export interface LifeState extends CoreSlice, WalletSlice, InventorySlice, NeedsSlice, SkillsSlice, CareerSlice, ActivitiesSlice,
  TravelSlice, HealthSlice, EconomySlice, PropertySlice, EstateSlice, HomeSlice, OnboardingSlice, GoalsSlice, SocialSlice, CivicSlice,
  MissionsSlice, EventsSlice, GrowthSlice, BusinessSlice, UnilagStudentSlice, UnilagCommunitySlice, UnilagShuttleSlice {
  stories: import('./stories.ts').StoryState
}

/** System ids in registration order (systems/index.js). Sanitize, events and modifiers all run in this order. */
export type SystemId =
  | 'core' | 'wallet' | 'inventory' | 'needs' | 'skills' | 'career' | 'activities' | 'travel' | 'health'
  | 'economy' | 'property' | 'estate' | 'home' | 'onboarding' | 'goals' | 'social' | 'civic' | 'missions' | 'events' | 'growth' | 'business'
  | 'unilagStudent' | 'unilagCommunity' | 'unilagShuttle' | 'stories' | 'land'

/** The top-level keys each system owns. */
export interface SliceBySystem {
  land: Record<never, never>
  stories: import('./stories.ts').StoriesSlice
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
  estate: EstateSlice
  home: HomeSlice
  onboarding: OnboardingSlice
  goals: GoalsSlice
  social: SocialSlice
  civic: CivicSlice
  missions: MissionsSlice
  events: EventsSlice
  growth: GrowthSlice
  business: BusinessSlice
  unilagStudent: UnilagStudentSlice
  unilagCommunity: UnilagCommunitySlice
  unilagShuttle: UnilagShuttleSlice
}

// ---- context and results ------------------------------------------------------------------

/**
 * The `ctx` every system receives, built by `makeContext()` in src/game/util.ts.
 * makeContext passes any other property through untouched (`...rest`); the optional fields below
 * are the ones the engine itself reads.
 * INCONSISTENT: the contract in registry.js:78 lists `{ now, cityId, rng, isNew?, actionId?,
 * quickStart?, internal? }` and omits `trustedSave`, which core.js:39 and activities.js:254 read, and
 * `openCities`, which estate.js relocateBlock reads.
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
  /**
   * createLife only, with isNew: the new life starts as a GUEST of the quick start, held (`required`)
   * until its look is confirmed (systems/onboarding.js).
   */
  quickStart?: boolean
  /** @deprecated the older name of `quickStart`; onboarding.js still accepts either. */
  requireOnboarding?: boolean
  /** Tests only: cities to treat as open for 'estate.relocate'. No request can set it. */
  openCities?: WorldCityId[]
  /** dispatch only: true lets a server-only action run. Set by the route host's ctx.act and by nothing a player can reach. */
  internal?: boolean
  /** createLife only: the input is the server's own stored copy, so an invalid saved action may be settled (refunded or charged). */
  trustedSave?: boolean
}

/**
 * What a caller may hand to createLife / dispatch / advanceLife / viewLife instead of a built
 * context: the engine builds one (src/life.ts contextFor) unless `rng` is already a function.
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
  'activeAction', 'business', 'career', 'cash', 'civic', 'completedShifts', 'decay', 'economy', 'estate', 'events', 'goals', 'growth',
  'health', 'home', 'homeOwned', 'inventory', 'job', 'ledger', 'ledgerDays', 'location', 'message', 'missions', 'moodlets',
  'name', 'needs', 'onboarding', 'property', 'skills', 'social', 'spot', 'stories', 't', 'travel', 'unilagCommunity', 'unilagShuttle',
  'unilagStudent', 'v',
] as const satisfies readonly (keyof LifeState)[]

/** Each system's `stateKeys`, in registration order. */
export const SYSTEM_STATE_KEYS = {
  land: [],
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
  estate: ['estate'],
  home: ['home'],
  stories: ['stories'],
  onboarding: ['onboarding'],
  goals: ['goals'],
  social: ['social'],
  civic: ['civic'],
  missions: ['missions'],
  events: ['events'],
  growth: ['growth'],
  business: ['business'],
  unilagStudent: ['unilagStudent'],
  unilagCommunity: ['unilagCommunity'],
  unilagShuttle: ['unilagShuttle'],
} as const satisfies { readonly [S in SystemId]: readonly (keyof SliceBySystem[S])[] }

/**
 * The fields of every fixed-shape object slice, sorted. A slice keyed by a dynamic id
 * (`inventory`) is not listed; `needs`/`decay` are keyed by NeedId and `skills` by SkillId.
 */
export const SLICE_FIELD_KEYS = {
  career: ['city', 'auto', 'autoDay', 'dilemmas', 'lastShiftDay', 'level', 'oriented', 'performance', 'shiftStartDay', 'shifts', 'transferDay'],
  travel: ['cooldowns', 'event', 'eventDays', 'funded', 'gigs', 'home', 'lastTrip', 'rideDebt', 'skipped', 'trips', 'visited'],
  health: ['cause', 'immuneUntil', 'sick', 'since', 'strain'],
  economy: ['billedWeek', 'deposits', 'headsUp', 'loan', 'reminded', 'rent', 'seq', 'started'],
  property: ['car', 'cars', 'house'],
  estate: ['away', 'city', 'confirmed', 'ground', 'home', 'homeAt', 'lga', 'lgaAt', 'lgaConfirmed', 'lgaVia', 'living', 'nudged', 'old', 'plot', 'style', 'tier', 'upgrade'],
  home: ['boost', 'custom', 'fuel', 'items', 'overflow', 'seq', 'stocked', 'storage'],
  stories: ['running', 'scenes', 'seq'],
  onboarding: [
    'activities', 'bonusAt', 'bornAt', 'completedAt', 'done', 'dream', 'firstAt', 'house', 'joined', 'legacy', 'look', 'lottery',
    'needsSet', 'playedAt', 'required', 'seed', 'stage', 'step', 'traits', 'wardrobe',
  ],
  goals: ['besties', 'chain', 'cv', 'dream', 'dreamDone', 'feed', 'granted', 'perks', 'rerolls', 'seen', 'seq', 'stars', 'started', 'stats', 'wishes'],
  social: ['bae', 'coupon', 'earned', 'family', 'followUps', 'free', 'notices', 'rel', 'rumours', 'streak', 'transfer'],
  civic: ['claims', 'gems', 'hunt', 'news', 'seed', 'since', 'week', 'work'],
  missions: ['active', 'claimed', 'daily', 'day', 'paidDay', 'rerolls', 'seed', 'sets', 'stamps', 'titles', 'visited', 'week', 'weekly'],
  events: ['attended', 'count', 'spray', 'sprayed'],
  growth: ['referrals', 'tables', 'welcomed'],
  business: ['bag', 'buys', 'opened', 'sales', 'spent'],
  unilagStudent: ['admittedDay', 'applicationCount', 'hostel', 'lifetime', 'programme', 'records', 'status', 'studentId', 'term'],
  unilagCommunity: ['clubs', 'days', 'discoveries', 'elections', 'quiz', 'trail'],
  unilagShuttle: ['rides'],
} as const satisfies { readonly [K in keyof LifeState]?: readonly (keyof LifeState[K])[] }

/** NEEDS, in the engine's display order. */
export const NEED_IDS = ['hunger', 'energy', 'fun', 'social', 'hygiene', 'bladder'] as const satisfies readonly NeedId[]

/** The local governments of Lagos, in catalogue order. Equals LAGOS_LGAS.map((lga) => lga.id). */
export const LGA_IDS = [
  'agege', 'ajeromi-ifelodun', 'alimosho', 'amuwo-odofin', 'apapa', 'badagry', 'epe', 'eti-osa', 'ibeju-lekki', 'ifako-ijaiye',
  'ikeja', 'ikorodu', 'kosofe', 'lagos-island', 'lagos-mainland', 'mushin', 'ojo', 'oshodi-isolo', 'somolu', 'surulere',
] as const satisfies readonly LgaId[]

/** SKILLS, in the engine's display order. */
export const SKILL_IDS = ['cooking', 'charisma', 'fitness', 'coding', 'music', 'hustle', 'dance', 'comedy', 'photography'] as const satisfies readonly SkillId[]

/** Every registered timed-action kind, sorted. */
export const ACTIVE_KINDS = ['activity', 'call', 'campus-game', 'campus-shuttle', 'campus-study', 'commute', 'intercity', 'travel'] as const satisfies readonly ActiveKind[]
