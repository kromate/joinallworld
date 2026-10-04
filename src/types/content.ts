/**
 * Shapes of the content tables in src/game/content/*.js (plus the three content-like tables
 * that live in systems/economy.js). Plain data: no functions.
 *
 * Provenance marks appear on most entries and are never read by the rules: `beta: true` (an
 * original beta value), `betaFields` (which fields of an otherwise observed entry are original),
 * `observed`, `note`.
 */
import type {
  ActivityId, BaseTravelModeId, BodyId, CarId, ComingSoonId, DepositTermId, DreamId, FabricId, FamilyId, FurnitureId,
  HairColourId, HairId, HouseId, ItemId, JobId, LotteryId, NeedId, NeedMap, NpcId, OutfitColourId, OutfitId, PerkId,
  RoadsideEventId, SkillId, SkillMap, SkinId, SpotId, StarterGoalId, StartHomeId, TierId, TraitId, TravelModeId, VenueId,
  WardrobeKind, WishId,
} from './life.ts'

// ---- shared pieces ------------------------------------------------------------------------

/**
 * Opening hours on Lagos time (clock.js isOpen). Hours are numbers (9, 17.5); `close <= open`
 * wraps past midnight. Missing hours anywhere means "always open".
 */
export interface OpeningHours {
  open: number
  close: number
  /** Weekdays 0 = Sunday … 6 = Saturday. Omitted = every day. */
  days?: number[]
}

/** A feeling handed to api.addMoodlet. */
export interface MoodletSpec {
  id: string
  label: string
  /** Mood points, −100…100. */
  value: number
  /** Seconds it lasts; omitted = until removed. */
  duration?: number
}

/** `{ code, reason }` — why something cannot be done right now. */
export interface Block<Code extends string = string> {
  code: Code
  reason: string
}

// ---- activities (format documented at the top of systems/activities.js) -------------------

/** Where a system attaches one of its activities. A spot id the venue does not have is created, labelled `spotLabel`. */
export interface ActivityPlacement {
  venue: VenueId
  spot: SpotId
  spotLabel?: string
  spotIcon?: string
}

/** The fields an activity — or one of its `choices` — may carry. Everything is optional here. */
export interface ActivityFields {
  icon?: string
  /** Seconds of real time. */
  duration?: number
  /** Naira. The price actually charged is modify('activity.cost', cost, { def }). */
  cost?: number
  /** 'complete' (default) debits when the activity finishes; 'start' debits when it starts. */
  chargeOn?: 'start' | 'complete'
  /** For chargeOn 'start': false makes the price a sunk cost (default: a cancel refunds it, or the unused part if metered). */
  refundOnCancel?: boolean
  /** false forbids cancelling; such an activity may last at most MAX_LOCKED_SECONDS (300). */
  cancellable?: boolean
  /** Need deltas applied once on completion. */
  effects?: NeedMap
  /** Need rates accrued while running; an early stop keeps what accrued. Makes the activity "metered". */
  effectsPerSecond?: NeedMap
  /** Naira credited on completion (after modify('activity.reward', reward, { def })). */
  reward?: number
  /** XP granted on completion. */
  xp?: SkillMap
  /** XP rates accrued while running. Makes the activity "metered". */
  xpPerSecond?: SkillMap
  requiresSkill?: { id: SkillId; level: number }
  /** `state.job` must equal this. */
  requiresJob?: JobId
  /** Minimum need levels to start. */
  minimumNeeds?: NeedMap
  /** Falls back to the venue's hours. */
  hours?: OpeningHours
  /** Taken from the inventory on start (not returned on cancel). */
  consumes?: Record<ItemId, number>
  /** Added to the inventory on completion. */
  produces?: Record<ItemId, number>
  /** Feelings added on completion. */
  moodlets?: MoodletSpec[]
  /** Passed to 'activity.completed' listeners ('food', 'work', 'sleep', 'cure' …). */
  tags?: string[]
  /** Listed but cannot be started. */
  unavailable?: boolean
  beta?: boolean
  note?: string

  // -- understood by the world systems (documented in content/venues.js) --
  /** Seconds before the same activity can be started again (systems/travel.js). */
  cooldown?: number
  /** Id of a feeling the player must currently have (systems/travel.js, code 'not_needed'). */
  requiresMoodlet?: string
  /** The refusal text shown when `requiresMoodlet` is not met. */
  requiresReason?: string
  /** Feelings removed on completion (systems/travel.js). */
  clears?: string[]
  /** Only while sick (systems/health.js, code 'not_sick'). */
  requiresIllness?: boolean
}

/** One option of an activity with `choices`; its fields override the base definition. */
export interface ActivityChoice extends ActivityFields {
  id: string
  label: string
}

/**
 * One activity definition. Ids are global and unique across venues and systems.
 * INCONSISTENT: no shipped activity uses `choices`, `consumes`, `produces`, `chargeOn`,
 * `refundOnCancel`, `cancellable`, `xpPerSecond` or `unavailable` — they are exercised only by
 * test systems (contracts.test.js), so 'choice_required' and 'not_cancellable' are unreachable
 * with the shipped content.
 */
export interface ActivityDefinition extends ActivityFields {
  id: ActivityId
  label: string
  /** Required on a definition without `choices`; with them, every merged variant must end up with one. */
  duration: number
  /** The player must pick one; the chosen entry's fields override the base definition. */
  choices?: ActivityChoice[]

  // -- markers set by the system that attaches the activity --
  /** systems only: where to attach it. Stripped from the display card. */
  where?: ActivityPlacement
  /** career: a track's shift — it pays the player's ladder level and is limited to one per Lagos day. */
  careerTrack?: JobId
  /** home: the furniture kind that must be placed, and the recipe cooked (ingredients leave the kitchen on completion). */
  home?: { kind: FurnitureKind; recipe?: string }
  /** social: an NPC interaction. */
  social?: { npc: NpcId; action: string }
}

/** An activity as started: with a choice applied, the label reads `<label>: <choice label>` and `choice` is set. */
export interface ResolvedActivity extends ActivityDefinition {
  choice?: string
}

// ---- venues -------------------------------------------------------------------------------

/** Landmass; crossing between 'mainland' and anything else is a long ('far') trip. */
export type VenueZone = 'mainland' | 'island' | 'east'

/**
 * Map filter bar ids (VENUE_CATEGORIES).
 * INCONSISTENT: Home uses category 'home' (venues.js:129), which is not a key of
 * VENUE_CATEGORIES (venues.js:55); the travel view adds a third, 'soon'.
 */
export type VenueCategoryId = 'food' | 'fun' | 'nightlife' | 'work' | 'care' | 'civic'

/** Which scene src/scene/venue-scenes.js draws (SCENE_KINDS). */
export type SceneKind =
  | 'park' | 'buka' | 'hub' | 'club' | 'office' | 'market' | 'gym' | 'mall' | 'beach' | 'hospital' | 'salon'
  | 'rooftop' | 'police' | 'worship' | 'radio' | 'polling' | 'viewing' | 'shrine' | 'walk' | 'statehouse' | 'home'

export interface VenueScene {
  kind: SceneKind
  /** Picks the look where one kind has several (club: 'speakeasy'; worship: 'church' | 'mosque'). */
  variant?: 'speakeasy' | 'church' | 'mosque'
  /** Pins a spot id — including spots other systems add, such as 'work' — to a landmark key of the scene. */
  anchors?: Record<SpotId, string>
}

/** Position in percent of the city map (which is 1000 × 700 map units). */
export interface MapPoint {
  x: number
  y: number
}

export interface SpotDefinition {
  id: SpotId
  label: string
  icon?: string
  /** One line shown under the spot name. */
  caption?: string
  activities: ActivityDefinition[]
  beta?: boolean
}

export interface VenueDefinition {
  id: VenueId
  label: string
  district: string
  icon: string
  description: string
  category: VenueCategoryId | 'home'
  /** Omitted = always open. */
  hours?: OpeningHours
  zone: VenueZone
  map: MapPoint
  /** Rotating one-liners for the venue card. */
  ambient: string[]
  scene: VenueScene
  /** The first spot is where a player stands on arrival. Other systems attach activities by spot id. */
  spots: Record<SpotId, SpotDefinition>
  beta?: boolean
}

/** A spot of the merged catalogue (activities.js spotsOf): venue content plus what systems attached. */
export interface CatalogueSpot {
  id: SpotId
  label: string
  icon?: string
  /** The key is missing on a spot created by a system. */
  caption?: string
  activities: ActivityDefinition[]
}

/** A place shown on the map that cannot be visited yet (COMING_SOON). */
export interface ComingSoonDefinition {
  id: ComingSoonId
  label: string
  district: string
  icon: string
  description: string
  zone: VenueZone
  map: MapPoint
}

/**
 * Where Home sits on the map for each house (content/venues.js HOME_SPOTS).
 * INCONSISTENT: content/furniture.js exports a different table under the same name
 * (HOME_SPOTS = the 'living' and 'study' spots); see HomeSpotMeta.
 */
export interface HomeMapSpot {
  district: string
  zone: VenueZone
  map: MapPoint
}

export interface VenueCategory {
  id: VenueCategoryId
  label: string
}

/** Per-city display names (CITY_LABELS[cityId][venueId]); ids and rules are shared between cities. */
export interface CityVenueLabel {
  label: string
  district: string
}

/** Names of the map's regions and bridges per city (CITY_MAPS). */
export interface CityMapNames {
  north: string
  south: string
  east: string
  water: string
  sea: string
  bridges: string[]
}

// ---- travel -------------------------------------------------------------------------------

export type RouteBand = 'near' | 'standard' | 'far'

export interface TravelModeDefinition {
  id: TravelModeId
  label: string
  icon: string
  /** Standard-band fare in naira (for the car mode: fuel). */
  fare: number
  /** Standard-band trip time. */
  seconds: number
  /** Need deltas applied on arrival. */
  needs: NeedMap
  /** XP granted on arrival (only Trek trains anything). */
  xp?: SkillMap
  /** No roof: arriving in the rain soaks the player. */
  exposed?: boolean
  /** Chance that a roadside event is offered on arrival. */
  eventChance: number
  blurb: string
  /** Own car: the "fare" is fuel. */
  fuel?: boolean
  beta?: boolean
}

/** Fares for the bands that differ from each mode's own `fare` (FARE_BANDS). Trek is free everywhere. */
export type FareBands = Record<'near' | 'far', Partial<Record<TravelModeId, number>> & { beta?: boolean }>

// ---- jobs ---------------------------------------------------------------------------------

export interface LadderRung {
  role: string
  /** Naira per shift at this level. */
  pay: number
  /** Level of the track skill needed to be promoted INTO this rung. */
  skillLevel: number
}

/** Fields every job has. */
interface JobBase {
  id: JobId
  label: string
  /** The starter job has none (the view falls back to 💼). */
  icon?: string
  summary: string
  /** `spot` is always 'work'. The venue may not exist in this build, in which case the job cannot be held. */
  workplace: { venue: VenueId; spot: SpotId }
  /** Display name used while the venue is not in the build. */
  workplaceName: string
  /** Attached to the workplace spot by systems/career.js, with `requiresJob` added. */
  shift: ActivityDefinition
  beta?: boolean
}

/** The starter Community helper job: no ladder, any time of day, limited by the shift's cooldown. */
export interface StarterJobDefinition extends JobBase {
  track?: undefined
}

/** One of the fourteen career tracks. */
export interface TrackJobDefinition extends JobBase {
  track: true
  icon: string
  /** The skill that gates promotion and that a shift trains. */
  skill: SkillId
  /** Work days, weekdays 0 = Sunday … 6 = Saturday. */
  days: number[]
  /** Six rungs (MAX_CAREER_LEVEL). */
  ladder: LadderRung[]
}

export type JobDefinition = StarterJobDefinition | TrackJobDefinition

// ---- furniture and the home ---------------------------------------------------------------

export type FurnitureCategoryId = 'sleep' | 'kitchen' | 'bath' | 'comfort' | 'fun' | 'skills' | 'light' | 'decor' | 'pets'

/** What an object does (furniture.js KINDS); objects of the same kind share actions. */
export type FurnitureKind =
  | 'bed' | 'cooler' | 'stove' | 'bath' | 'tub' | 'toilet' | 'seat' | 'radio' | 'tv' | 'console' | 'game' | 'pet'
  | 'gym' | 'desk' | 'shelf' | 'keys' | 'mirror' | 'tripod' | 'mic' | 'light' | 'power' | 'water' | 'decor'

export interface FurnitureCategory {
  id: FurnitureCategoryId
  label: string
  icon: string
  beta?: boolean
}

export interface FurnitureDefinition {
  id: FurnitureId
  label: string
  category: FurnitureCategoryId
  kind: FurnitureKind
  /** Footprint in floor tiles before rotation. */
  w: number
  h: number
  /** Hangs on a wall and takes no floor tiles. */
  wall?: boolean
  /** Quality 0–4; STAR_MULTIPLIER[stars] scales positive effects and XP of the object's actions. */
  stars: number
  /** List price in naira (the charged price is modify('shop.price', price, { item, kind: 'furniture' })). */
  price: number
  icon: string
  /** Which procedural model src/scene/home-scene.js draws. */
  shape: string
  /** Hex colour. */
  color: string
  blurb: string
  beta?: boolean
}

/** KINDS[kind]: the home spot a kind's actions appear at (null = no actions), and how to name it in a "you need one" message. */
export interface FurnitureKindInfo {
  spot: 'bedroom' | 'kitchen' | 'bathroom' | 'living' | 'study' | null
  /** Absent on the kinds without a spot. */
  needs?: string
}

/** content/furniture.js HOME_SPOTS: the home spots the home owner adds ('living', 'study'). */
export interface HomeSpotMeta {
  label: string
  icon: string
}

/** One object of the starter room, positioned for a 6 × 6 room (bigger rooms scale the positions). */
export interface StarterFurnitureEntry {
  item: FurnitureId
  x: number
  y: number
  rot: number
}

/** An action furniture offers (HOME_ACTIVITIES). The engine-wide activity id is `home-<id>`. */
export interface HomeActivityDefinition extends ActivityFields {
  id: string
  label: string
  duration: number
  /** The furniture kind that must be placed in the room. (Not a need map: this field is replaced by `home.kind` when attached.) */
  needs: FurnitureKind
}

// ---- food ---------------------------------------------------------------------------------

export interface IngredientDefinition {
  /** The inventory item id. */
  id: ItemId
  label: string
  icon: string
  /** How many a new kitchen holds. */
  start: number
  /** Naira for one pack. */
  price: number
  /** Units in one pack. */
  pack: number
  beta?: boolean
}

export interface RecipeDefinition {
  id: string
  label: string
  icon: string
  /** Which kitchen object prepares it. */
  station: 'cooler' | 'stove'
  duration: number
  /** `{ ingredientId: count }` used when the meal is FINISHED (cancelling costs nothing). */
  ingredients: Record<ItemId, number>
  /** Ingredients the recipe uses that were not legible in the reference game. */
  betaIngredients?: ItemId[]
  effects: NeedMap
  xp?: SkillMap
  requiresSkill?: { id: SkillId; level: number }
  moodlets?: MoodletSpec[]
  beta?: boolean
  note: string
}

// ---- character: effects, traits, dreams, lottery, appearance ------------------------------

/**
 * Plain-data effect block shared by traits, lottery outcomes and perks, applied by
 * src/game/character-effects.js through the registry modifier keys. Multipliers are ≥ 0.
 */
export interface EffectBlock {
  /** 'skills.xpRate' — `all` and/or per skill. */
  xp?: SkillMap & { all?: number }
  /** 'needs.decayRate' — `all` and/or per need. */
  decay?: NeedMap & { all?: number }
  /** 'needs.decayRate', 9 PM – 5 AM Lagos time only. */
  nightDecay?: NeedMap
  /** 'career.performance' (applied to gains only). */
  performance?: number
  /** 'social.gain' (applied to gains only). */
  social?: number
  /** 'travel.fare'. */
  fare?: number
  /** 'shop.price' for furniture and groceries (never cars). */
  shop?: number
  /** 'activity.cost' for activities carrying any of the tags. */
  cost?: { tags: string[]; mult: number }
  /** 'activity.reward' for activities carrying any of the tags. */
  reward?: { tags: string[]; mult: number }
  /** Extra need change when an activity carrying any of the tags completes. */
  bonus?: { tags: string[]; needs: NeedMap }
}

export interface TraitDefinition {
  id: TraitId
  label: string
  icon: string
  blurb: string
  /** Display sentences describing `fx`. */
  effects: string[]
  fx: EffectBlock
  beta?: boolean
  betaFields?: string[]
}

export interface DreamDefinition {
  id: DreamId
  label: string
  icon: string
  /** The completion condition, as a sentence. */
  goal: string
  /** How progress is measured, as a sentence. */
  measure: string
}

/**
 * A starting home offered at the end of character creation (START_HOMES).
 * INCONSISTENT: the weekly rent of a house is written in three places — here, in
 * content/housing.js HOUSES and in systems/economy.js RENTS (which also has its own labels).
 */
export interface StartHomeDefinition {
  id: StartHomeId
  label: string
  district: string
  /** Naira per week. */
  rent: number
  /** Difficulty tag ('Hard start' …). */
  tag: string
  icon: string
  blurb: string
}

export interface LotteryOutcome {
  id: LotteryId
  label: string
  icon: string
  tagline: string
  /** Weight out of 100. */
  odds: number
  /** Start cash per starting home; a home without an entry cannot be chosen with this outcome. */
  startCash: Partial<Record<StartHomeId, number>>
  /** Starting homes that are locked, with the sentence explaining why. */
  locked: Partial<Record<StartHomeId, string>>
  /** The LAPO loan (principal is part of the start cash; `owed` is what must be repaid). */
  loan: { principal: number; weekly: number; owed: number } | null
  /** Skill levels set when the life moves in. */
  skills: SkillMap
  fx: EffectBlock
  /** Display sentences. */
  bullets: string[]
  beta?: boolean
  betaFields?: string[]
}

export interface Swatch<Id extends string = string> {
  id: Id
  label: string
  hex: string
}

export interface Appearance {
  bodies: { id: BodyId; label: string }[]
  /** Hairstyles per body. */
  hair: Record<BodyId, HairId[]>
  /** Outfits per body. */
  outfits: Record<BodyId, OutfitId[]>
  fabrics: FabricId[]
  skin: Swatch<SkinId>[]
  hairColours: Swatch<HairColourId>[]
  /** Used for both the outfit colour and the bottoms colour. */
  outfitColours: Swatch<OutfitColourId>[]
  /** Display name of every hair, outfit and fabric id. */
  labels: Record<string, string>
}

/** Boutique prices in naira per wardrobe kind (0 = a basic everyone owns). */
export type BoutiquePrices = { beta?: boolean } & Record<WardrobeKind, Record<string, number>>

export interface OnboardingStep {
  id: 'look' | 'traits' | 'dream' | 'lottery' | 'home'
  label: string
}

/** A mood word for a 0–100 mood score (MOODS, highest `min` first). */
export interface MoodWord {
  word: string
  min: number
  tone: 'good' | 'neutral' | 'warn' | 'bad'
  icon: string
}

// ---- cars and housing ---------------------------------------------------------------------

export interface CarDefinition {
  id: CarId
  label: string
  nickname: string
  icon: string
  /** List price in naira. */
  price: number
  /** Naira of fuel per trip when driven. */
  fuel: number
  /** Multiplier on travel time when driven (lower is faster). */
  speed: number
  beta?: boolean
  /** The price was reported but not seen on screen. */
  priceReported?: boolean
}

export interface HouseDefinition {
  id: HouseId
  label: string
  district: string
  /** The room is grid × grid floor tiles. */
  grid: number
  /** Naira per week. */
  rent: number
  /** What the Houses app charges to move in (3 × rent). */
  moveIn: number
  tag?: string
  description: string
  betaFields?: string[]
}

// ---- npcs and social ----------------------------------------------------------------------

export interface TierDefinition {
  id: TierId
  label: string
  /** Closeness points at which the tier starts. */
  min: number
  beta?: boolean
  note?: string
}

/** An interaction every NPC offers (NPC_ACTIONS); attached as activity `npc-<npc>-<action>`. */
export interface NpcAction {
  id: string
  label: string
  icon: string
  duration: number
  cost?: number
  /** Applied on completion whatever happens. */
  effects: NeedMap
  /** Granted only when the interaction lands. */
  bonus?: NeedMap
  xp?: SkillMap
  /** Closeness points granted when it lands. */
  points: number
  /** Percent chance (before skill and closeness) for an interaction that can flop; absent = always lands. */
  success?: { base: number }
  beta?: boolean
  note?: string
}

/** An instant interaction between two real players (PLAYER_ACTIONS). */
export interface PlayerAction {
  id: 'hello' | 'gist' | 'joke' | 'shade'
  label: string
  icon: string
  effects: NeedMap
  bonus?: NeedMap
  xp?: SkillMap
  points: number
  success?: { base: number }
  beta?: boolean
}

export interface NpcDefinition {
  id: NpcId
  /** Venue the regular is found at; an NPC whose venue is not in the build is simply absent. */
  venue: string
  name: string
  role: string
  emoji: string
  quotes: string[]
  /** Landmark key of the venue's scene where they stand, or null to join the general crowd. */
  at: string | null
  beta?: boolean
  note?: string
}

export interface FamilyMember {
  id: FamilyId
  name: string
  relation: string
  emoji: string
  line: string
  /** Shown as a phone contact. */
  contact?: boolean
  quotes: string[]
  beta?: boolean
  note?: string
}

export interface FamilyCallRules {
  /** Seconds. */
  duration: number
  /** Every call. */
  effects: NeedMap
  /** Extra, on the first call to each member per Lagos day. */
  first: NeedMap
  xp: SkillMap
  moodlet: MoodletSpec
  beta?: boolean
}

/** Limits on gifts of naira between players. The engine enforces the first five and `minEarned`; the rest are the server's. */
export interface TransferLimits {
  min: number
  maxPerTransfer: number
  dailyAmount: number
  dailyCount: number
  dailyReceive: number
  minEarned: number
  minAccountAgeMs: number
  minFriendshipMs: number
  beta?: boolean
}

// ---- goals --------------------------------------------------------------------------------

/** How a starter goal completes: any one of these. */
export interface StarterGoalCondition {
  /** Any of these registry events fires. */
  events?: string[]
  /** An 'activity.completed' carrying any of these tags. */
  tags?: string[]
  /** Arriving at (or already being in) this venue. */
  venue?: string
  /** Already employed when the goal comes up. */
  hasJob?: boolean
}

export interface StarterGoal {
  id: StarterGoalId
  title: string
  hint: string
  icon: string
  /** Naira paid through the wallet, once. */
  cash: number
  stars: number
  done: StarterGoalCondition
  /** Tapping the chip opens this panel. */
  open?: string
  /** Parameters for the opened panel. */
  params?: Record<string, unknown>
  /** Tapping the chip walks to `[venue]` or `[venue, spot]`. */
  go?: string[]
  /** Tapping the chip goes to the player's workplace (or opens Jobs without one). */
  workplace?: boolean
  betaFields?: string[]
}

interface WishBase {
  id: WishId
  label: string
  hint: string
  icon: string
  beta?: boolean
}

/** A wish, detected one of four ways. */
export type WishDefinition =
  /** Cash earned on one Lagos day reaches `amount`. */
  | (WishBase & { on: 'earn'; amount: number })
  /** An activity completes at `venue` matching `activity`, `spot` or any of `tags`. */
  | (WishBase & { on: 'activity'; venue: string; activity?: ActivityId; spot?: SpotId; tags?: string[] })
  /** Arrive at `venue`. */
  | (WishBase & { on: 'visit'; venue: string })
  /** The registry event fires `count` times (default 1). */
  | (WishBase & { on: 'event'; event: string; count?: number })

export interface PerkDefinition {
  id: PerkId
  label: string
  icon: string
  /** Stars. */
  cost: number
  /** Display sentence. */
  effect: string
  fx: EffectBlock
  /** Extra stars every granted wish pays. */
  wishBonus?: number
  beta?: boolean
  betaFields?: string[]
}

// ---- roadside events and chance outcomes --------------------------------------------------

/** What a roadside choice, a check result or a chance activity applies. */
export interface OutcomeBlock {
  /** Naira taken (as far as the wallet allows for a check result; in full, and refused if unaffordable, for a choice). */
  cost?: number
  /** Naira taken as far as the wallet allows. */
  fine?: number
  reward?: number
  effects?: NeedMap
  xp?: SkillMap
  moodlet?: MoodletSpec
  /** Cures illness ('health.treat'). */
  treat?: boolean
  /** Message shown afterwards. */
  result: string
}

/** chance = base + perLevel × level of `skill`, capped at `max` (default 1). */
export interface SkillCheck<Success = OutcomeBlock, Failure = OutcomeBlock> {
  skill: SkillId
  base: number
  perLevel: number
  max?: number
  success: Success
  failure: Failure
}

export interface RoadsideChoice extends OutcomeBlock {
  id: string
  label: string
  hint: string
  /** When present its outcome's `result` replaces the choice's own (which is then ''). */
  check?: SkillCheck
  beta?: boolean
}

export interface RoadsideEvent {
  id: RoadsideEventId
  icon: string
  title: string
  text: string
  /** Trips on these modes can trigger it. */
  modes: TravelModeId[]
  /** Relative chance among the events that fit the trip. */
  weight: number
  /** The LAST choice is always free and has no requirement. */
  choices: RoadsideChoice[]
  /** Offered at most once per Lagos day. */
  oncePerDay?: boolean
  beta?: boolean
}

/** The success branch of a chance activity. */
export interface ActivitySuccessOutcome extends OutcomeBlock {
  /** Key in `state.travel` set true the first time; later successes give `repeat` instead. Only 'funded' is rebuilt by sanitize. */
  once?: 'funded'
  /** What a later success gives when `once` was already used. */
  repeat?: OutcomeBlock
  /** Registry event emitted on success with `{ venue }` (currently 'startup.funded'). */
  event?: string
}

/** Chance outcome rolled when a venue activity completes (ACTIVITY_OUTCOMES[activityId]). */
export interface ActivityOutcomeRule extends SkillCheck<ActivitySuccessOutcome, OutcomeBlock> {
  beta?: boolean
}

// ---- health -------------------------------------------------------------------------------

export interface HealthFeeling extends MoodletSpec {
  text: string
  beta?: boolean
}

export interface WeatherKind {
  id: 'clear' | 'rain'
  label: string
  icon: string
  text: string
}

/** A way to get well, listed in the Health app. */
export interface HealthCure {
  id: string
  label: string
  /** Venue to go to, or null when it is not a place (roadside agbo, waiting). */
  where: string | null
  /** Present with `where`. */
  spot?: SpotId
  /** Present with `where`: the activity that cures. */
  activity?: ActivityId
  /** Present without `where`. */
  cost?: number
  text: string
}

export interface HealthContent {
  feelings: { soaked: HealthFeeling; sick: HealthFeeling; recovered: HealthFeeling }
  /** Extra need cost of a trek while sick. */
  sickTrek: NeedMap
  weather: {
    beta?: boolean
    /** The sky is decided once per block for the whole city. */
    blockMinutes: number
    rainChance: number
    kinds: { clear: WeatherKind; rain: WeatherKind }
  }
  illness: {
    beta?: boolean
    /** Chance of falling sick each time rain soaks you. */
    soakedChance: number
    /** A need under this counts as neglected. */
    neglectBelow: number
    neglectNeeds: NeedId[]
    /** Seconds of neglect (while playing) before falling sick. */
    neglectSeconds: number
    /** Time counted per settlement, so a long absence cannot make you sick on its own. */
    maxStepSeconds: number
    /** Fraction of the way to falling sick from which the "run down" warning shows. */
    warnAt: number
    selfHealSeconds: number
    immunitySeconds: { cure: number; agbo: number; vitamins: number }
  }
  cures: HealthCure[]
}

// ---- civic --------------------------------------------------------------------------------

export interface ElectionRules {
  beta?: boolean
  /** Weekdays (0 = Sunday) on which candidates declare. */
  nominationWeekdays: number[]
  votingWeekdays: number[]
  resultsWeekday: number
  termDays: number
  /** Lagos calendar days lived in the city. */
  minDaysToRun: number
  minDaysToVote: number
  /** Different Lagos days with paid work before voting or running. */
  minWorkDays: number
  /** Naira, not refunded. */
  filingFee: number
  sloganMin: number
  sloganMax: number
  maxCandidates: number
  /** Weeks of history kept in storage. */
  keepElections: number
  pollingVenue: string
  stateHouseVenue: string
  announcement: { max: number; min: number; cooldownMs: number; perDay: number; keep: number }
}

export interface AdColour {
  id: string
  label: string
  /** Background hex. */
  bg: string
  /** Text hex. */
  ink: string
}

export interface AdIcon {
  id: string
  icon: string
}

export interface BillboardSlot {
  /** `bb-NN`. */
  id: string
  /** Venue id the board stands beside. */
  near: string
  /** Display name of the road. */
  road: string
}

export interface BillboardContent {
  beta?: boolean
  /** Naira per period. */
  price: number
  days: number
  maxPerPlayer: number
  slots: BillboardSlot[]
}

/** Sea plots: ids are `sea-<row>-<col>`, zero-based; rows below `shoreRows` cost `shorePrice`. */
export interface SeaPlotContent {
  observed?: string[]
  price: number
  days: number
  cols: number
  rows: number
  shoreRows: number
  shorePrice: number
  maxPerPlayer: number
}

export interface HuntContent {
  observed?: string[]
  label: string
  /** Naira paid once every gem of the day is found. */
  prize: number
  gemsPerDay: number
}

export interface RadioContent {
  beta?: boolean
  /** Venues a shout-out can be bought in. */
  venues: string[]
  price: number
  slotSeconds: number
  perPlayerPerDay: number
  queueMax: number
  titleMax: number
  artistMax: number
  label: string
  cta: string
}

export interface District {
  id: HouseId | 'unknown'
  label: string
}

// ---- economy tables (they live in systems/economy.js) -------------------------------------

/** RENTS[houseId] — the rent the billing system actually charges. See StartHomeDefinition for the duplication. */
export interface RentEntry {
  id: HouseId
  label: string
  /** Naira per week. */
  rent: number
}

/** LOAN: the birth-lottery loan. */
export interface LoanTerms {
  principal: number
  /** Naira to repay in total, before late fees. */
  total: number
  weekly: number
}

export interface DepositTerm {
  id: DepositTermId
  label: string
  days: number
  /** Simple interest in basis points. */
  bps: number
}

/** TRAVEL_MODES: the five base modes by id. */
export type BaseModeTable = Record<BaseTravelModeId, TravelModeDefinition>
