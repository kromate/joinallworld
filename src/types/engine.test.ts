import { isOpenCityId, loadAllCityRules, loadCityContent as preloadCityContent, playableCityIds } from '../game/cities/registry.ts';
await Promise.all([loadAllCityRules(), ...['lagos', 'ibadan', 'abuja', 'kaduna'].map(preloadCityContent)]);
import { CITY_MAPS } from '../map3d/city-labels.ts';
/**
 * Proves that src/types/{life,view,actions,content,registry}.ts still describe the running rules
 * engine. It FAILS when a sibling branch adds an action, a state key, a view key, an event, a
 * modifier key, a timed-action kind or a content id without updating the types.
 *
 *   node --experimental-strip-types --test src/types/engine.test.ts
 *
 * Two kinds of check:
 *   runtime       the lists exported by the type files equal what the engine reports
 *   compile time  the content tables are assigned to the content types, the lists are proved to
 *                 name EVERY key of their type, and typed readers touch every declared field —
 *                 so `npm run typecheck` fails in this file when a type and the code disagree
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { actionTypes, advanceLife, createLife, dispatch, makeContext, spotsOf, viewLife } from '../life.ts'
import { serverOnlyReason, systems } from '../game/registry.ts'
import { COMING_SOON, SCENE_KINDS, VENUE_CATEGORIES } from '../game/content/venues.ts';
import { HOME_SPOTS, VENUES } from '../game/cities/lagos/venues.ts';
import { ALL_MODES, FARE_BANDS, TRAVEL_MODES } from '../game/content/travel.ts'
import { JOBS } from '../game/content/jobs.ts'
import { CATEGORIES, FURNITURE, HOME_ACTIVITIES, HOME_SPOTS as FURNITURE_HOME_SPOTS, KINDS, STARTER_FURNITURE } from '../game/content/furniture.ts'
import { INGREDIENTS, RECIPES } from '../game/content/food.ts'
import { APPEARANCE, BOUTIQUE_PRICES, DEFAULT_LOOK, DREAMS, LOTTERY, MOODS, ONBOARDING_STEPS, START_HOMES, TRAITS } from '../game/content/traits.ts'
import { CARS } from '../game/content/cars.ts'
import { HOUSES } from '../game/content/housing.ts'
import { FAMILY, FAMILY_CALL, NPC_ACTIONS, PLAYER_ACTIONS, TIERS, TRANSFER_LIMITS } from '../game/content/npcs.ts';
import { NPCS } from '../game/cities/lagos/regulars.ts';
import { PERKS, STARTER_GOALS, WISHES } from '../game/content/goals.ts'
import { ACTIVITY_OUTCOMES, EVENTS } from '../game/content/events.ts'
import { HEALTH } from '../game/content/health.ts'
import { AD_COLOURS, AD_ICONS, BILLBOARDS, DISTRICTS, ELECTION, HUNT, RADIO, SEA_PLOTS } from '../game/content/civic.ts'
import { LAGOS_LGAS } from '../game/cities/lagos/localUnits.ts'
import type { LagosLocalGovernmentId } from '../game/cities/lagos/localUnits.ts'
import { CITY_LINKS, CITY_RULES, ESTATE, HOUSE_STYLE, HOUSE_TIERS, LGA_RULES, OWNING, STYLE_FIELDS, TIER_ORDER, linksFrom, lgaOf } from '../game/content/world.ts'
import { DAILY_MISSIONS, DAY_TITLES, MISSION_KINDS, MISSION_REWARDS, STAMP_CARD, WEEKLY_MISSIONS, WEEK_TITLE } from '../game/content/missions.ts'
import { EVENTS_CALENDAR, SPRAY } from '../game/content/calendar.ts'
import { REFERRAL, TABLE_REWARDS } from '../game/content/growth.ts'
import { DEPOSIT_TERMS, LOAN, RENTS } from '../game/systems/economy.ts'
import { NEEDS } from '../game/systems/needs.ts'
import { GUEST_CAMPUS } from '../game/systems/onboarding.ts'
import { SKILLS } from '../game/systems/skills.ts'
import { DISCOVERY_TRAIL } from '../campus/unilag/content.ts'
import { LECTURE_SLOTS, PROGRAMMES, UNILAG_BETA_RULES } from '../campus/unilag/curriculum.ts'
import { CAMPUS_CLUBS, CAMPUS_DISCOVERIES, CAMPUS_FACULTIES, CAMPUS_HALLS, QUIZ_QUESTIONS, STUDENT_UNION_TABLES } from '../campus/unilag/games.ts'
import { SHUTTLE_STOPS } from '../campus/unilag/shuttle.ts'
import { CAMPUS_JOBS, HOSTEL_HALLS, HOSTEL_STORAGE_ITEMS } from '../campus/unilag/student.ts'
import { ACTION_TYPES, INBOUND_ACTIONS, SERVER_ONLY_ACTIONS, SOCIAL_SERVER_OPS } from './actions.ts'
import type { ActionPayload, ActionResult, ActionType, InboundActionType, ServerOnlyActionType, SocialServerOp } from './actions.ts'
import { CAMPUS_ACTION_TYPES, CAMPUS_EVENT_NAMES, GUEST_CAMPUS_ACTIONS } from './campus.ts'
import type {
  CampusActionType, CampusClubDefinition, CampusClubId, CampusDiscoveryDefinition, CampusDiscoveryId, CampusEngineEvent, CampusFaculty,
  CampusGameAction, CampusJobDefinition, CampusJobId, CampusShuttleAction, CampusStudyAction, GuestCampusActionType, HostelHallId,
  HostelStorageItemId, LectureSlot, LectureSlotId, ProgrammeDefinition, ProgrammeId, QuizQuestion, ShuttleStopId, StudentUnionTable,
  TrailStopDefinition, TrailStopId, UnilagBetaRules,
} from './campus.ts'
import type {
  ActivityDefinition, ActivityOutcomeRule, AdColour, AdIcon, Appearance, BillboardContent, BoutiquePrices, CalendarEvent, CarDefinition,
  CatalogueSpot, CityLink, CityLinkFrom, CityMapNames, CityRules, CityVenueLabel, ComingSoonDefinition, DayTitle, DepositTerm, District,
  DreamDefinition, ElectionRules, EstateGrid, FamilyCallRules, FamilyMember, FareBands, FurnitureCategory, FurnitureCategoryId,
  FurnitureDefinition, FurnitureKind, FurnitureKindInfo, HealthContent, HomeActivityDefinition, HouseStyleContent, HouseTierDefinition,
  JobDefinition, HomeMapSpot, HomeSpotMeta, HouseDefinition, HuntContent, IngredientDefinition, LgaDefinition, LgaRules, LoanTerms,
  LotteryOutcome, MissionDefinition, MissionKind, MissionRewards, MoodWord, NpcAction, NpcDefinition, OnboardingStep, OwningRules,
  PerkDefinition, PlayerAction, RadioContent, RecipeDefinition, ReferralRules, RentEntry, RoadsideEvent, SceneKind, SeaPlotContent,
  SpotDefinition, SprayRules, StampCard, StarterFurnitureEntry, StarterGoal, StartHomeDefinition, TableRewards, TierDefinition,
  TraitDefinition, TransferLimits, TravelModeDefinition, VenueCategory, VenueCategoryId, VenueDefinition, VenueZone, WishDefinition,
} from './content.ts'
import { ACTIVE_KINDS, LGA_IDS, LIFE_STATE_KEYS, NEED_IDS, SKILL_IDS, SLICE_FIELD_KEYS, SYSTEM_STATE_KEYS } from './life.ts'
import type {
  AccessoryId, AccessorySlot, ActiveAction, ActiveKind, ActivityAction, BaseTravelModeId, BodyId, CallAction, CarId, WorldCityId,
  ComingSoonId, CommuteAction, DepositTermId, DreamId, ExpressionId, FabricId, FaceId, FamilyId, HairColourId, HairId, HouseId,
  HouseStyleField, HouseTierId, IntercityAction, JobId, LgaId, LifeContext, LifeContextInit, LifeState, Look, LotteryId,
  MissionTitleId, NeedId, OutfitColourId, OutfitId, PerkId, RoadsideEventId, SkillId, SkinId, SliceBySystem, StarterGoalId,
  StartHomeId, SystemId, TierId, TraitId, TravelAction, TravelModeId, VenueId,
} from './life.ts'
import { CONTENT_EVENT_NAMES, EVENT_NAMES, MODIFIER_KEYS, UNEMITTED_LISTENED_EVENTS } from './registry.ts'
import type { EngineEvent, ModifierKey } from './registry.ts'
import { TRAVEL_DESTINATION_KEYS, VIEW_FIELD_KEYS, VIEW_KEYS } from './view.ts'
import type { LifeView, TravelDestination } from './view.ts'

/** dispatch() with a body the types would refuse: these tests send every action type, and unknown operations, on purpose. */
const dispatchLoose = dispatch as unknown as (state: LifeState, body: { type: string; payload?: Record<string, unknown> }, ctx?: LifeContextInit) => unknown

// ---- compile-time helpers -----------------------------------------------------------------

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
/** Compiles only when `T` is exactly `true`. */
type Assert<T extends true> = T
/** The union of the members of a readonly tuple. */
type Members<L> = L extends readonly (infer U)[] ? U : never
/** `true` for every key of `Lists` whose list names exactly the keys of `Shapes[key]`. */
type ListsEveryKey<Lists, Shapes> = { [K in keyof Lists]: K extends keyof Shapes ? Equal<Members<Lists[K]>, keyof Shapes[K]> : false }

/**
 * A type with its closed sets widened: TypeScript infers `string` for an id written in a plain
 * JavaScript object, so the content tables are compared with this form of the content types.
 * Field names, nesting and optionality are still checked exactly; that the ids are members of the
 * closed sets is checked at runtime below. Lists are compared as read-only ones: some tables are
 * frozen (content/world.js), and content is never written to.
 */
type Loose<T> =
  T extends string ? string
    : T extends number ? number
      : T extends boolean ? boolean
        : T extends readonly (infer U)[] ? readonly Loose<U>[]
          : T extends object ? { [K in keyof T]: Loose<T[K]> }
            : T
type Table<T> = Readonly<Record<string, Loose<T>>>
type SparseTable<T> = Readonly<Partial<Record<string, Loose<T>>>>
function required<T>(value: T | null | undefined): T { assert.ok(value, 'catalogue entry is present'); return value }
type List<T> = readonly Loose<T>[]

// Each runtime list names EVERY member of its type (a list that only `satisfies` could be short).
export type ListChecks = [
  Assert<Equal<Members<typeof LIFE_STATE_KEYS>, keyof LifeState>>,
  Assert<Equal<keyof typeof SYSTEM_STATE_KEYS, SystemId>>,
  Assert<ListsEveryKey<typeof SYSTEM_STATE_KEYS, SliceBySystem> extends Record<SystemId, true> ? true : false>,
  Assert<ListsEveryKey<typeof SLICE_FIELD_KEYS, LifeState> extends Record<keyof typeof SLICE_FIELD_KEYS, true> ? true : false>,
  Assert<Equal<Members<typeof NEED_IDS>, NeedId>>,
  Assert<Equal<Members<typeof SKILL_IDS>, SkillId>>,
  Assert<Equal<Members<typeof ACTIVE_KINDS>, ActiveKind>>,
  Assert<Equal<Members<typeof VIEW_KEYS>, keyof LifeView>>,
  Assert<ListsEveryKey<typeof VIEW_FIELD_KEYS, LifeView> extends Record<keyof typeof VIEW_FIELD_KEYS, true> ? true : false>,
  Assert<Equal<Members<typeof TRAVEL_DESTINATION_KEYS>, keyof TravelDestination>>,
  Assert<Equal<Members<typeof ACTION_TYPES>, ActionType>>,
  Assert<Equal<Members<typeof SERVER_ONLY_ACTIONS>, ServerOnlyActionType>>,
  Assert<Equal<Members<typeof SOCIAL_SERVER_OPS>, SocialServerOp>>,
  Assert<Equal<Members<typeof INBOUND_ACTIONS>, InboundActionType>>,
  Assert<Equal<Members<typeof LGA_IDS>, LagosLocalGovernmentId>>,
  Assert<Members<typeof LGA_IDS> extends LgaId ? true : false>,
  Assert<Equal<Members<typeof EVENT_NAMES>, EngineEvent>>,
  Assert<Equal<Members<typeof MODIFIER_KEYS>, ModifierKey>>,
  Assert<Equal<Members<typeof CAMPUS_ACTION_TYPES>, CampusActionType>>,
  Assert<Equal<Members<typeof GUEST_CAMPUS_ACTIONS>, GuestCampusActionType>>,
  Assert<Equal<Members<typeof CAMPUS_EVENT_NAMES>, CampusEngineEvent>>,
]

// ---- compile-time conformance of the content tables ---------------------------------------
// A wrong field name, a missing required field or a wrong nesting in content.ts is a type error
// on one of these lines. Two tables are inferred loosely from the JavaScript and are therefore
// ALSO checked field by field at runtime below: NPCS (built with Object.fromEntries, so `any`)
// and the career tracks of JOBS (built by a function with untyped parameters).

export const contentConformance = {
  venues: VENUES satisfies Table<VenueDefinition>,
  // Keyed by ComingSoonId, which has no member in this build: the table is empty.
  comingSoon: COMING_SOON satisfies Partial<Record<ComingSoonId, Loose<ComingSoonDefinition>>>,
  homeMapSpots: HOME_SPOTS satisfies Table<HomeMapSpot>,
  venueCategories: VENUE_CATEGORIES satisfies Table<VenueCategory>,
  cityMaps: CITY_MAPS satisfies SparseTable<CityMapNames>,
  baseModes: TRAVEL_MODES satisfies Table<TravelModeDefinition>,
  allModes: ALL_MODES satisfies Table<TravelModeDefinition>,
  jobs: JOBS satisfies Table<JobDefinition>,
  fareBands: FARE_BANDS satisfies Loose<FareBands>,
  furniture: FURNITURE satisfies Table<FurnitureDefinition>,
  furnitureCategories: CATEGORIES satisfies List<FurnitureCategory>,
  furnitureKinds: KINDS satisfies Table<FurnitureKindInfo>,
  homeSpots: FURNITURE_HOME_SPOTS satisfies Table<HomeSpotMeta>,
  starterFurniture: STARTER_FURNITURE satisfies List<StarterFurnitureEntry>,
  homeActivities: HOME_ACTIVITIES satisfies List<HomeActivityDefinition>,
  ingredients: INGREDIENTS satisfies Table<IngredientDefinition>,
  recipes: RECIPES satisfies Table<RecipeDefinition>,
  traits: TRAITS satisfies Table<TraitDefinition>,
  dreams: DREAMS satisfies Table<DreamDefinition>,
  startHomes: START_HOMES satisfies Table<StartHomeDefinition>,
  lottery: LOTTERY satisfies Table<LotteryOutcome>,
  appearance: APPEARANCE satisfies Loose<Appearance>,
  defaultLook: DEFAULT_LOOK satisfies Loose<Look>,
  boutique: BOUTIQUE_PRICES satisfies Loose<BoutiquePrices>,
  steps: ONBOARDING_STEPS satisfies List<OnboardingStep>,
  moods: MOODS satisfies List<MoodWord>,
  cars: CARS satisfies Table<CarDefinition>,
  houses: HOUSES satisfies Table<HouseDefinition>,
  tiers: TIERS satisfies List<TierDefinition>,
  npcActions: NPC_ACTIONS satisfies List<NpcAction>,
  playerActions: PLAYER_ACTIONS satisfies List<PlayerAction>,
  npcs: NPCS satisfies Table<NpcDefinition>,
  family: FAMILY satisfies Table<FamilyMember>,
  familyCall: FAMILY_CALL satisfies Loose<FamilyCallRules>,
  transferLimits: TRANSFER_LIMITS satisfies Loose<TransferLimits>,
  starterGoals: STARTER_GOALS satisfies List<StarterGoal>,
  wishes: WISHES satisfies List<WishDefinition>,
  perks: PERKS satisfies List<PerkDefinition>,
  roadsideEvents: EVENTS satisfies Table<RoadsideEvent>,
  activityOutcomes: ACTIVITY_OUTCOMES satisfies Table<ActivityOutcomeRule>,
  health: HEALTH satisfies Loose<HealthContent>,
  election: ELECTION satisfies Loose<ElectionRules>,
  billboards: BILLBOARDS satisfies Loose<BillboardContent>,
  seaPlots: SEA_PLOTS satisfies Loose<SeaPlotContent>,
  hunt: HUNT satisfies Loose<HuntContent>,
  radio: RADIO satisfies Loose<RadioContent>,
  adColours: AD_COLOURS satisfies List<AdColour>,
  adIcons: AD_ICONS satisfies List<AdIcon>,
  districts: DISTRICTS satisfies List<District>,
  rents: RENTS satisfies Table<RentEntry>,
  loan: LOAN satisfies Loose<LoanTerms>,
  depositTerms: DEPOSIT_TERMS satisfies Table<DepositTerm>,
  estateGrid: ESTATE satisfies Loose<EstateGrid>,
  lgas: LAGOS_LGAS satisfies List<LgaDefinition>,
  houseTiers: HOUSE_TIERS satisfies Table<HouseTierDefinition>,
  houseStyle: HOUSE_STYLE satisfies Loose<HouseStyleContent>,
  owning: OWNING satisfies Loose<OwningRules>,
  lgaRules: LGA_RULES satisfies Loose<LgaRules>,
  cityRules: CITY_RULES satisfies SparseTable<CityRules>,
  cityLinks: CITY_LINKS satisfies List<CityLink>,
  linksFromLagos: linksFrom('lagos') satisfies List<CityLinkFrom>,
  missionRewards: MISSION_REWARDS satisfies Loose<MissionRewards>,
  stampCard: STAMP_CARD satisfies Loose<StampCard>,
  dayTitles: DAY_TITLES satisfies List<DayTitle>,
  calendar: EVENTS_CALENDAR satisfies List<CalendarEvent>,
  spray: SPRAY satisfies Loose<SprayRules>,
  tableRewards: TABLE_REWARDS satisfies Loose<TableRewards>,
  referral: REFERRAL satisfies Loose<ReferralRules>,
  // The campus tables (src/campus/unilag).
  programmes: PROGRAMMES satisfies Table<ProgrammeDefinition>,
  lectureSlots: LECTURE_SLOTS satisfies Table<LectureSlot>,
  betaRules: UNILAG_BETA_RULES satisfies Readonly<Record<string, number>>,
  campusJobs: CAMPUS_JOBS satisfies Table<CampusJobDefinition>,
  campusClubs: CAMPUS_CLUBS satisfies List<CampusClubDefinition>,
  campusDiscoveries: CAMPUS_DISCOVERIES satisfies Table<CampusDiscoveryDefinition>,
  unionTables: STUDENT_UNION_TABLES satisfies List<StudentUnionTable>,
  trail: DISCOVERY_TRAIL satisfies List<TrailStopDefinition>,
}

// ---- runtime helpers ----------------------------------------------------------------------

const MONDAY_9AM = Date.UTC(2026, 0, 5, 8) // 09:00 in Lagos
const context = makeContext as (init: LifeContextInit) => LifeContext
const at = (now: number = MONDAY_9AM, seed = 'types'): LifeContext => context({ now, cityId: 'lagos', seed })

const life = (saved: unknown, ctx: LifeContext): LifeState => createLife(saved, ctx) as unknown as LifeState
const view = (state: LifeState, ctx: LifeContext): LifeView => viewLife(state, ctx) as unknown as LifeView
const act = <T extends ActionType>(state: LifeState, type: T, payload: ActionPayload<T>, ctx: LifeContext): ActionResult<T> =>
  dispatch(state, { type, payload }, ctx) as ActionResult<T>
const settle = (state: LifeState, seconds: number, now: number): string => (advanceLife(state, seconds, at(now)) as { code: string }).code

const sorted = (list: readonly string[]): string[] => [...list].sort()
const keys = (value: object): string[] => Object.keys(value).sort()
/** The keys of an exhaustive `{ [id]: true }` record: the compiler rejects a missing or an extra id. */
const idsOf = <K extends string>(record: Record<K, true>): string[] => keys(record)

/** A life that has finished character creation, as the existing engine tests build one. */
function onboarded(): LifeState {
  const state = life(null, at())
  const look: Look = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' }
  assert.equal(act(state, 'onboarding.look', { look }, at()).code, 'look_saved')
  assert.equal(act(state, 'onboarding.traits', { traits: ['musical', 'tech-bro-or-sis'] }, at()).code, 'traits_saved')
  assert.equal(act(state, 'onboarding.dream', { dream: 'yaba-unicorn' }, at()).code, 'dream_saved')
  assert.equal(act(state, 'onboarding.lottery', {}, at()).code, 'rolled')
  const moved = act(state, 'onboarding.home', { house: 'yaba' }, at())
  assert.equal(moved.code, 'life_started', moved.ok ? '' : moved.reason)
  return state
}

/**
 * A life in the middle of a first day: created, hired, travelled to work, a shift worked, a
 * deposit opened, a family call made and the gem hunt rolled. `seen` holds every timed action
 * that was seen running on the way.
 */
function midGame(): { state: LifeState; now: number; seen: ActiveAction[] } {
  const state = onboarded()
  const seen: ActiveAction[] = []
  let now = MONDAY_9AM
  const run = () => {
    const active = state.activeAction
    assert.ok(active, 'a timed action is running')
    seen.push({ ...active })
    now += active.duration * 1000
    assert.equal(settle(state, active.duration, now), 'completed')
    assert.equal(state.activeAction, null)
  }
  assert.equal(act(state, 'apply-job', { id: 'community-helper' }, at(now)).code, 'applied')
  assert.equal(act(state, 'travel', { id: 'park', mode: 'trek' }, at(now)).code, 'started')
  run()
  assert.equal(state.location, 'park')
  assert.equal(act(state, 'spot', { id: 'work' }, at(now)).code, 'selected')
  const started = act(state, 'activity', { id: 'helper-shift' }, at(now))
  assert.equal(started.code, 'started', started.ok ? '' : started.reason)
  run()
  assert.equal(state.completedShifts, 1)
  assert.equal(act(state, 'economy.open-deposit', { amount: 1000, term: 'd1' }, at(now)).code, 'deposit_opened')
  assert.equal(act(state, 'social.call', { id: 'mummy' }, at(now)).code, 'calling')
  run()
  assert.equal(act(state, 'civic.refresh', {}, at(now)).code, 'refreshed')
  return { state, now, seen }
}

// ---- typed readers: every declared field of the core slices is read by name ---------------
// Renaming or removing a field in life.ts is a type error here; a field the engine does not
// produce is `undefined` at runtime and fails `complete()`.

const readers = {
  core: (s: LifeState) => ({ v: s.v, t: s.t, name: s.name, message: s.message, location: s.location, activeAction: s.activeAction }),
  wallet: (s: LifeState) => ({ cash: s.cash, ledger: s.ledger, ledgerDays: s.ledgerDays }),
  needs: (s: LifeState) => ({ needs: s.needs, decay: s.decay, moodlets: s.moodlets }),
  career: (s: LifeState) => ({ job: s.job, completedShifts: s.completedShifts, career: s.career }),
  activities: (s: LifeState) => ({ spot: s.spot }),
  travel: (s: LifeState) => ({ travel: s.travel }),
  economy: (s: LifeState) => ({ economy: s.economy }),
  onboarding: (s: LifeState) => ({ onboarding: s.onboarding }),
} satisfies { [S in SystemId]?: (state: LifeState) => SliceBySystem[S] }

const inner = {
  career: ({ career: c }: LifeState) => ({ city: c.city, level: c.level, performance: c.performance, shifts: c.shifts, auto: c.auto, lastShiftDay: c.lastShiftDay, shiftStartDay: c.shiftStartDay, autoDay: c.autoDay, transferDay: c.transferDay, oriented: c.oriented }),
  travel: ({ travel: t }: LifeState) => ({ home: t.home, event: t.event, lastTrip: t.lastTrip, visited: t.visited, trips: t.trips, cooldowns: t.cooldowns, funded: t.funded, gigs: t.gigs, eventDays: t.eventDays, skipped: t.skipped }),
  economy: ({ economy: e }: LifeState) => ({ billedWeek: e.billedWeek, started: e.started, rent: e.rent, loan: e.loan, deposits: e.deposits, seq: e.seq, reminded: e.reminded }),
  onboarding: ({ onboarding: o }: LifeState) => ({
    stage: o.stage, done: o.done, legacy: o.legacy, required: o.required, step: o.step, seed: o.seed, look: o.look, traits: o.traits, dream: o.dream, lottery: o.lottery, house: o.house,
    wardrobe: o.wardrobe, completedAt: o.completedAt, bonusAt: o.bonusAt, bornAt: o.bornAt, playedAt: o.playedAt, firstAt: o.firstAt, activities: o.activities, needsSet: o.needsSet, joined: o.joined,
  }),
  health: ({ health: h }: LifeState) => ({ sick: h.sick, cause: h.cause, since: h.since, strain: h.strain, immuneUntil: h.immuneUntil }),
  property: ({ property: p }: LifeState) => ({ house: p.house, cars: p.cars, car: p.car }),
  estate: ({ estate: e }: LifeState) => ({
    city: e.city, lga: e.lga, lgaAt: e.lgaAt, lgaConfirmed: e.lgaConfirmed, lgaVia: e.lgaVia, plot: e.plot, old: e.old, tier: e.tier, style: e.style, upgrade: e.upgrade,
    living: e.living, ground: e.ground, away: e.away, nudged: e.nudged, home: e.home, homeAt: e.homeAt,
  }),
  home: ({ home: h }: LifeState) => ({ items: h.items, storage: h.storage, seq: h.seq, stocked: h.stocked, custom: h.custom, boost: h.boost }),
  goals: ({ goals: g }: LifeState) => ({ started: g.started, chain: g.chain, cv: g.cv, seen: g.seen, stars: g.stars, perks: g.perks, wishes: g.wishes, rerolls: g.rerolls, granted: g.granted, dream: g.dream, dreamDone: g.dreamDone, stats: g.stats, besties: g.besties, seq: g.seq, feed: g.feed }),
  social: ({ social: s }: LifeState) => ({ rel: s.rel, bae: s.bae, family: s.family, streak: s.streak, earned: s.earned, transfer: s.transfer, notices: s.notices }),
  civic: ({ civic: c }: LifeState) => ({ seed: c.seed, since: c.since, gems: c.gems, claims: c.claims, week: c.week, work: c.work, news: c.news, hunt: c.hunt }),
  missions: ({ missions: m }: LifeState) => ({
    seed: m.seed, day: m.day, daily: m.daily, week: m.week, weekly: m.weekly, rerolls: m.rerolls, sets: m.sets, active: m.active, stamps: m.stamps, visited: m.visited,
    paidDay: m.paidDay, titles: m.titles, claimed: m.claimed,
  }),
  events: ({ events: e }: LifeState) => ({ attended: e.attended, count: e.count, spray: e.spray, sprayed: e.sprayed }),
  growth: ({ growth: g }: LifeState) => ({ tables: g.tables, welcomed: g.welcomed, referrals: g.referrals }),
  business: ({ business: b }: LifeState) => ({ opened: b.opened, sales: b.sales, spent: b.spent, buys: b.buys, bag: b.bag }),
  unilagStudent: ({ unilagStudent: u }: LifeState) => ({
    status: u.status, programme: u.programme, studentId: u.studentId, admittedDay: u.admittedDay, applicationCount: u.applicationCount, term: u.term, records: u.records,
    hostel: u.hostel, lifetime: u.lifetime,
  }),
  unilagCommunity: ({ unilagCommunity: u }: LifeState) => ({ clubs: u.clubs, discoveries: u.discoveries, trail: u.trail, days: u.days, quiz: u.quiz, elections: u.elections }),
  unilagShuttle: ({ unilagShuttle: u }: LifeState) => ({ rides: u.rides }),
} satisfies { [K in keyof typeof SLICE_FIELD_KEYS]: (state: LifeState) => LifeState[K] }

const activeReaders = {
  activity: (a: ActivityAction) => ({ kind: a.kind, id: a.id, duration: a.duration, remaining: a.remaining }),
  travel: (a: TravelAction) => ({ kind: a.kind, id: a.id, duration: a.duration, remaining: a.remaining, mode: a.mode, fare: a.fare }),
  commute: (a: CommuteAction) => ({ kind: a.kind, id: a.id, duration: a.duration, remaining: a.remaining }),
  call: (a: CallAction) => ({ kind: a.kind, id: a.id, duration: a.duration, remaining: a.remaining }),
  intercity: (a: IntercityAction) => ({ kind: a.kind, id: a.id, duration: a.duration, remaining: a.remaining, mode: a.mode, fare: a.fare, from: a.from }),
  // One kind, four tasks: `semester` exists on a lecture, an assignment and a test; `session` on a lecture only.
  'campus-study': (a: CampusStudyAction) => ({
    kind: a.kind, id: a.id, duration: a.duration, remaining: a.remaining, task: a.task, startedDay: a.startedDay, startedMinute: a.startedMinute,
    ...(a.task === 'lecture' ? { semester: a.semester, session: a.session } : a.task === 'assignment' || a.task === 'test' ? { semester: a.semester } : {}),
  }),
  'campus-game': (a: CampusGameAction) => ({ kind: a.kind, id: a.id, duration: a.duration, remaining: a.remaining, day: a.day }),
  'campus-shuttle': (a: CampusShuttleAction) => ({ kind: a.kind, id: a.id, duration: a.duration, remaining: a.remaining, origin: a.origin, dest: a.dest, start: a.start }),
} satisfies { [K in ActiveKind]: (action: Extract<ActiveAction, { kind: K }>) => object }

/** Every field read is present (not undefined), and the fields read are exactly the keys that exist. */
function complete(read: Record<string, unknown>, actual: object, what: string): void {
  for (const [field, value] of Object.entries(read)) assert.notEqual(value, undefined, `${what}.${field} is declared in the types but missing from the state`)
  assert.deepEqual(keys(read), keys(actual), `${what}: the declared fields are the fields that exist`)
}

function checkState(state: LifeState, what: string): void {
  assert.deepEqual(keys(state), sorted(LIFE_STATE_KEYS), `${what}: top-level keys`)
  for (const read of Object.values(readers)) for (const [field, value] of Object.entries(read(state))) assert.notEqual(value, undefined, `${what}: state.${field}`)
  // A field that is ABSENT until it has something to say (the ride debt, a location confirmation) is listed but need not exist.
  const optional = ['rideDebt', 'confirmed', 'free', 'dilemmas', 'coupon']
  for (const [slice, list] of Object.entries(SLICE_FIELD_KEYS)) {
    assert.deepEqual(keys(state[slice as keyof typeof SLICE_FIELD_KEYS]).filter((key) => !optional.includes(key)), sorted(list).filter((key) => !optional.includes(key)), `${what}: keys of state.${slice}`)
  }
  for (const [slice, read] of Object.entries(inner)) complete(read(state), state[slice as keyof typeof inner], `${what}: state.${slice}`)
  assert.deepEqual(keys(state.needs), sorted(NEED_IDS), `${what}: state.needs`)
  assert.deepEqual(keys(state.decay), sorted(NEED_IDS), `${what}: state.decay`)
  assert.deepEqual(keys(state.skills), sorted(SKILL_IDS), `${what}: state.skills`)
  assert.deepEqual(keys(state.onboarding.look), ['body', 'bottomsColor', 'fabric', 'hair', 'hairColor', 'outfit', 'outfitColor', 'skin'], `${what}: look`)
  assert.deepEqual(keys(state.onboarding.wardrobe), ['fabric', 'hair', 'outfit'], `${what}: wardrobe`)
  assert.deepEqual(keys(state.goals.stats), ['assets', 'best', 'cchub', 'debt', 'friends', 'funded', 'level', 'levelCap'], `${what}: goals.stats`)
  assert.deepEqual(keys(state.economy.rent), ['arrears', 'house', 'missed'], `${what}: economy.rent`)
  assert.deepEqual(keys(state.social.transfer), ['count', 'day', 'sent', 'total'], `${what}: social.transfer`)
  for (const line of state.ledger) assert.deepEqual(keys(line), ['amount', 'at', 'balance', 'reason'], `${what}: ledger line`)
  for (const day of state.ledgerDays) assert.deepEqual(keys(day), ['by', 'close', 'day', 'in', 'n', 'open', 'out'], `${what}: ledger day`)
  for (const moodlet of state.moodlets) assert.deepEqual(keys(moodlet), ['expiresAt', 'id', 'label', 'value'], `${what}: moodlet`)
  for (const item of state.home.items) assert.deepEqual(keys(item), ['id', 'itemId', 'rot', 'x', 'y'], `${what}: placed item`)
  for (const wish of state.goals.wishes) assert.deepEqual(keys(wish), ['day', 'id', 'n'], `${what}: wish`)
  for (const deposit of state.economy.deposits) assert.deepEqual(keys(deposit), ['amount', 'id', 'openedAt', 'term'], `${what}: deposit`)
  for (const notice of state.social.notices) assert.deepEqual(keys(notice), ['at', 'id', 'kind', 'text'], `${what}: notice`)
  assert.deepEqual(keys(state.estate.style), sorted(STYLE_FIELDS), `${what}: estate.style`)
  assert.deepEqual(keys(state.estate.ground), ['arrears', 'week'], `${what}: estate.ground`)
  if (state.estate.plot) assert.deepEqual(keys(state.estate.plot), ['estate', 'lga', 'plot'], `${what}: estate.plot`)
  if (state.estate.upgrade) assert.deepEqual(keys(state.estate.upgrade), ['cost', 'doneAt', 'startedAt', 'to'], `${what}: estate.upgrade`)
  for (const home of Object.values(state.estate.away)) {
    assert.ok(home, 'stored away home exists')
    assert.deepEqual(keys(home), ['ground', 'house', 'lga', 'lgaAt', 'lgaConfirmed', 'lgaVia', 'living', 'old', 'plot', 'style', 'tier', 'upgrade'], `${what}: a home kept in another city`)
  }
  for (const entry of [...state.missions.daily, ...state.missions.weekly]) assert.deepEqual(keys(entry), ['claimed', 'id', 'marks', 'n'], `${what}: mission`)
  assert.deepEqual(keys(state.missions.sets), ['day', 'week'], `${what}: missions.sets`)
  assert.deepEqual(keys(state.missions.active), ['days', 'last'], `${what}: missions.active`)
  assert.deepEqual(keys(state.missions.stamps), ['days', 'paid', 'week'], `${what}: missions.stamps`)
  assert.deepEqual(keys(state.missions.visited), ['list', 'week'], `${what}: missions.visited`)
  assert.deepEqual(keys(state.events.spray), ['day', 'spent'], `${what}: events.spray`)
  assert.deepEqual(keys(state.growth.tables), ['bots', 'day', 'paid', 'played', 'won'], `${what}: growth.tables`)
  assert.deepEqual(keys(state.growth.referrals), ['paid', 'total', 'week'], `${what}: growth.referrals`)
  const student = state.unilagStudent
  assert.deepEqual(keys(student.hostel), ['allocations', 'storage'], `${what}: unilagStudent.hostel`)
  assert.deepEqual(keys(student.lifetime), ['campusJobDays', 'scholarshipPaid'], `${what}: unilagStudent.lifetime`)
  for (const room of student.hostel.allocations) assert.deepEqual(keys(room), ['attempt', 'hall', 'room', 'semester'], `${what}: hostel allocation`)
  for (const item of Object.keys(student.hostel.storage)) assert.ok((HOSTEL_STORAGE_ITEMS as readonly string[]).includes(item), `${what}: hostel storage ${item}`)
  if (student.term) {
    assert.deepEqual(keys(student.term), ['assessments', 'attempt', 'attendance', 'deadlineDay', 'deferredAtDay', 'deferredDays', 'registeredCourses', 'semester', 'startDay', 'study'], `${what}: unilagStudent.term`)
    const courses = sorted(student.term.registeredCourses)
    for (const record of [student.term.attendance, student.term.study, student.term.assessments]) assert.deepEqual(keys(record), courses, `${what}: a term record is keyed by the registered courses`)
    for (const assessment of Object.values(student.term.assessments)) assert.deepEqual(keys(assessment), ['assignment', 'test'], `${what}: assessment`)
  }
  for (const record of student.records) {
    assert.deepEqual(keys(record), ['attempt', 'closedDay', 'courseResults', 'gpa', 'passed', 'scholarshipAwarded', 'semester', 'startedDay'], `${what}: semester record`)
    for (const result of record.courseResults) assert.deepEqual(keys(result), ['assignment', 'attendanceDays', 'attendanceMark', 'courseId', 'credits', 'exam', 'grade', 'points', 'total'], `${what}: course result`)
  }
  const community = state.unilagCommunity
  assert.deepEqual(keys(community.elections), ['nominated', 'voted'], `${what}: unilagCommunity.elections`)
  if (community.quiz) assert.deepEqual(keys(community.quiz), ['day', 'faculty', 'questionId', 'startedAt'], `${what}: unilagCommunity.quiz`)
  for (const day of community.days) {
    assert.deepEqual(keys(day).filter((key) => key !== 'teams'), ['day', 'games', 'volunteered'], `${what}: community day`)
    assert.equal('teams' in day, Object.keys(day.games).length > 0, `${what}: a day has teams exactly when a game was scored`)
    for (const team of Object.values(day.teams ?? {})) assert.deepEqual(keys(team), ['faculty', 'hall', 'studentId'], `${what}: team`)
  }
}

function checkView(state: LifeState, ctx: LifeContext, what: string): LifeView {
  const shown = view(state, ctx)
  assert.deepEqual(Object.keys(shown), [...VIEW_KEYS], `${what}: view keys, in registration order`)
  // `career.dilemma` exists only while a dilemma is waiting (src/game/features.ts), so it is listed but need not be present.
  for (const [id, list] of Object.entries(VIEW_FIELD_KEYS)) assert.deepEqual(keys(shown[id as keyof typeof VIEW_FIELD_KEYS]).filter((key) => key !== 'dilemma'), sorted(list).filter((key) => key !== 'dilemma'), `${what}: keys of view.${id}`)
  assert.deepEqual(keys(shown.skills), sorted(SKILL_IDS), `${what}: view.skills`)
  for (const skill of Object.values(shown.skills)) assert.deepEqual(keys(skill), ['level', 'next', 'progress', 'xp'], `${what}: skill progress`)
  for (const destination of shown.travel.destinations) assert.deepEqual(keys(destination), sorted(TRAVEL_DESTINATION_KEYS), `${what}: destination ${destination.id}`)
  for (const mode of shown.travel.destinations.flatMap((destination) => destination.modes)) {
    assert.deepEqual(keys(mode), ['blocked', 'blurb', 'fare', 'fuel', 'icon', 'id', 'label', 'needs', 'seconds', 'xp'], `${what}: mode card`)
  }
  assert.deepEqual(keys(shown.wallet.statement), ['closing', 'kept', 'linesOpening', 'opening', 'problems', 'reconciled', 'totals'], `${what}: statement`)
  assert.deepEqual(keys(shown.needs.mood), ['icon', 'label', 'score'], `${what}: mood`)
  for (const card of shown.activities.cards) {
    assert.equal(typeof card.cost, 'number')
    assert.equal(typeof card.reward, 'number')
    assert.ok(card.blocked === null || (typeof card.blocked.code === 'string' && typeof card.blocked.reason === 'string'))
    assert.ok(!('where' in card) && !('note' in card), 'a card never carries where or note')
  }
  for (const spot of shown.activities.spots) assert.deepEqual(keys(spot).filter((key) => key !== 'caption' && key !== 'icon'), ['count', 'id', 'label'], `${what}: spot summary`)
  for (const job of shown.career.jobs) {
    assert.deepEqual(keys(job), ['beta', 'blocked', 'current', 'duration', 'entryRole', 'hours', 'icon', 'id', 'label', 'openNow', 'pay', 'schedule', 'skill', 'summary', 'switchWarning', 'topRole', 'track', 'transfer', 'venue', 'workplace'], `${what}: job listing`)
  }
  assert.deepEqual(keys(shown.civic.hunt), ['canClaim', 'claimed', 'day', 'found', 'gems', 'prize', 'total'], `${what}: hunt`)
  assert.deepEqual(keys(shown.civic.eligibility), ['days', 'pollingVenue', 'run', 'vote'], `${what}: eligibility`)
  for (const check of [...shown.civic.eligibility.run, ...shown.civic.eligibility.vote]) assert.deepEqual(keys(check), ['code', 'detail', 'id', 'label', 'met'], `${what}: eligibility check`)
  assert.deepEqual(keys(shown.economy.savings), ['amounts', 'beta', 'blocked', 'cap', 'locked', 'max', 'maxOpen', 'min', 'room', 'terms'], `${what}: savings`)
  assert.deepEqual(keys(shown.goals.chain), ['current', 'finished', 'index', 'started', 'total'], `${what}: goal chain`)
  assert.deepEqual(keys(shown.onboarding.timing), ['bornAt', 'firstAt', 'playedAt', 'settledAt'], `${what}: onboarding timing`)
  assert.deepEqual(keys(shown.onboarding.own), ['rent', 'startCash'], `${what}: the own-house start`)
  assert.deepEqual(keys(shown.onboarding.wardrobe), ['accessories', 'fabric', 'hair', 'outfit'], `${what}: view wardrobe`)
  for (const item of shown.onboarding.boutique) {
    assert.deepEqual(keys(item).filter((key) => key !== 'slot'), ['blocked', 'id', 'kind', 'label', 'owned', 'price', 'wearing'], `${what}: boutique item`)
    assert.equal('slot' in item, item.kind === 'accessories', `${what}: only an accessory has a slot`)
  }
  const estate = shown.estate
  assert.ok(estate.lga)
  assert.deepEqual(keys(estate.lga), ['id', 'land', 'line', 'name'], `${what}: estate.lga`)
  assert.deepEqual(keys(estate.change), ['at', 'blocked', 'cooldownDays'], `${what}: estate.change`)
  assert.deepEqual(estate.lgas.map((lga) => lga.id), [...LGA_IDS], `${what}: estate.lgas`)
  for (const lga of estate.lgas) assert.deepEqual(keys(lga), ['id', 'land', 'levy', 'line', 'name'], `${what}: lga card`)
  if (estate.plot) assert.deepEqual(keys(estate.plot), ['address', 'estate', 'key', 'lga', 'plot'], `${what}: estate.plot`)
  assert.deepEqual(keys(estate.tier), ['grid', 'groundRent', 'icon', 'id', 'label'], `${what}: estate.tier`)
  assert.deepEqual(keys(estate.styles), sorted(STYLE_FIELDS), `${what}: estate.styles`)
  for (const option of Object.values(estate.styles).flat()) assert.deepEqual(keys(option), ['chosen', 'hex', 'id', 'index', 'label', 'price'], `${what}: style option`)
  if (estate.upgrade) assert.deepEqual(keys(estate.upgrade), ['cost', 'doneAt', 'label', 'progress', 'remaining', 'startedAt', 'to'], `${what}: estate.upgrade`)
  assert.deepEqual(estate.tiers.map((tier) => tier.id), [...TIER_ORDER], `${what}: estate.tiers`)
  for (const tier of estate.tiers) assert.deepEqual(keys(tier), ['blocked', 'blurb', 'cost', 'current', 'grid', 'groundRent', 'icon', 'id', 'label', 'minutes'], `${what}: tier card`)
  assert.ok(estate.cheapest)
  assert.deepEqual(keys(estate.cheapest), ['label', 'lga', 'lgaName', 'tier', 'total'], `${what}: estate.cheapest`)
  assert.equal(typeof estate.cheapest.total, 'number')
  assert.deepEqual(keys(estate.rules), ['beta', 'cooldownDays', 'housesPerLife'], `${what}: estate.rules`)
  assert.ok(estate.links.length > 0)
  for (const link of estate.links) assert.deepEqual(keys(link), ['beta', 'blocked', 'fare', 'hub', 'icon', 'km', 'label', 'mode', 'name', 'open', 'seconds', ...(link.status ? ['status'] : []), 'to'], `${what}: city link`)
  for (const home of estate.away) assert.deepEqual(keys(home), ['city', 'living', 'name', 'tier'], `${what}: a home in another city`)
  for (const row of [...shown.missions.daily, ...shown.missions.weekly]) assert.deepEqual(keys(row), ['cash', 'claimed', 'count', 'done', 'go', 'hint', 'id', 'kind', 'label', 'n', 'open'], `${what}: mission row`)
  for (const set of [shown.missions.dailySet, shown.missions.weeklySet]) assert.deepEqual(keys(set), ['claimed', 'done', 'granted', 'stars', 'total'], `${what}: mission set`)
  assert.deepEqual(keys(shown.missions.stamps), ['days', 'need', 'paid', 'stars'], `${what}: stamps`)
  if (shown.missions.nextTitle) assert.deepEqual(keys(shown.missions.nextTitle), ['days', 'id', 'label'], `${what}: next title`)
  for (const event of shown.events.live) assert.deepEqual(keys(event), ['attended', 'id', 'key', 'venue'], `${what}: live event`)
  if (shown.events.here) assert.deepEqual(keys(shown.events.here), ['attended', 'id', 'key', 'spray', 'title'], `${what}: the event here`)
  assert.deepEqual(keys(shown.events.spray), ['amounts', 'left', 'perDay', 'spentToday'], `${what}: spray`)
  assert.deepEqual(keys(shown.growth.tables), ['paidLeft', 'paidToday', 'perDay', 'played', 'win', 'won'], `${what}: growth.tables`)
  assert.deepEqual(keys(shown.growth.referral), ['lifetime', 'paidThisWeek', 'paidTotal', 'perWeek', 'reward', 'rewardStars', 'welcome', 'welcomed'], `${what}: growth.referral`)
  const campus = shown.unilagStudent
  if (campus.programme) assert.deepEqual(keys(campus.programme), ['department', 'faculty', 'id', 'label', 'spot'], `${what}: programme card`)
  if (campus.degree) assert.deepEqual(keys(campus.degree), ['careerTrack', 'cgpa', 'faculty', 'programme', 'skill'], `${what}: degree`)
  for (const course of campus.courses) assert.deepEqual(keys(course), ['assignment', 'attendance', 'credits', 'id', 'skill', 'slot', 'study', 'test', 'title'], `${what}: course progress`)
  assert.deepEqual(keys(campus.betaRules), keys(UNILAG_BETA_RULES), `${what}: betaRules`)
  for (const job of campus.campusJobs) assert.deepEqual(keys(job), ['id', 'label', 'pay', 'spot'], `${what}: campus job`)
  const community = shown.unilagCommunity
  for (const club of community.clubs) assert.deepEqual(keys(club), ['id', 'joined', 'label', 'spot'], `${what}: club`)
  for (const discovery of community.discoveries) assert.deepEqual(keys(discovery), ['found', 'id', 'label', 'skill'], `${what}: discovery`)
  for (const table of community.tables) assert.deepEqual(keys(table), ['game', 'id', 'label', 'seats', 'spot'], `${what}: union table`)
  for (const event of community.events) assert.deepEqual(keys(event), ['beta', 'endsAt', 'id', 'label', 'startsAt', 'tags'], `${what}: campus event`)
  if (community.quiz) assert.deepEqual([keys(community.quiz), keys(community.quiz.question)], [['faculty', 'question'], ['id', 'options', 'prompt']], `${what}: quiz`)
  assert.deepEqual(keys(community.today).filter((key) => key !== 'teams'), ['day', 'games', 'volunteered'], `${what}: today`)
  assert.deepEqual(keys(community.trail), ['complete', 'found', 'shareText', 'total'], `${what}: trail`)
  for (const stop of shown.unilagShuttle.stops) assert.deepEqual(keys(stop), ['id', 'label'], `${what}: shuttle stop`)
  if (shown.unilagShuttle.active) assert.deepEqual(keys(shown.unilagShuttle.active), ['destination', 'origin', 'refundable'], `${what}: shuttle ride`)
  return shown
}

// ---- (a) actions --------------------------------------------------------------------------

test('ACTION_TYPES lists every registered action, in registration order', () => {
  assert.deepEqual(actionTypes(), [...ACTION_TYPES])
  assert.deepEqual(sorted(actionTypes()), sorted(ACTION_TYPES))
  assert.equal(new Set<string>(ACTION_TYPES).size, ACTION_TYPES.length)
})

test('SERVER_ONLY_ACTIONS is exactly the set the registry refuses without ctx.internal', () => {
  const serverOnly = (actionTypes() as string[]).filter((type) => serverOnlyReason(type) !== null)
  assert.deepEqual(sorted(serverOnly), sorted(SERVER_ONLY_ACTIONS))
  const state = life(null, at())
  for (const type of SERVER_ONLY_ACTIONS) {
    const refused = dispatchLoose(state, { type, payload: {} }, at()) as { ok: boolean; code: string; reason?: string }
    assert.deepEqual([refused.ok, refused.code, typeof refused.reason], [false, 'server_only', 'string'], type)
  }
})

test('every operation in SOCIAL_SERVER_OPS exists in social.server', () => {
  const internal: LifeContext = { ...at(), internal: true }
  for (const op of SOCIAL_SERVER_OPS) {
    const result = dispatchLoose(life(null, at()), { type: 'social.server', payload: { op } }, internal) as { code: string }
    assert.notEqual(result.code, 'invalid_operation', op)
  }
  const unknown = dispatchLoose(life(null, at()), { type: 'social.server', payload: { op: 'no-such-op' } }, internal) as { code: string }
  assert.equal(unknown.code, 'invalid_operation')
})

test('dispatch returns { ok, code, state, reason? } as ActionOutcome describes', () => {
  const state = life(null, at())
  const good = act(state, 'social.sync', {}, at())
  assert.deepEqual(keys(good), ['code', 'ok', 'state'])
  assert.equal(good.state, state, 'the result carries the very state object that was passed in')
  const bad = act(state, 'career.quit', {}, at())
  assert.deepEqual(keys(bad), ['code', 'ok', 'reason', 'state'])
  assert.deepEqual([bad.ok, bad.code], [false, 'no_job'])
  assert.equal(state.message, bad.ok ? '' : bad.reason, 'a failure mirrors its reason in state.message')
  const bare = act(state, 'cancel', {}, at())
  assert.deepEqual(keys(bare), ['code', 'ok', 'state'], 'the one failure without a reason: nothing to cancel')
  assert.deepEqual([bare.ok, bare.code], [false, 'idle'])
})

const LOOK: Look = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' }
/** A brand-new life of the quick start: a guest, held until its look is confirmed. */
const guest = (): LifeState => life(null, { ...at(), isNew: true, quickStart: true })

test('a guest whose look is not confirmed vetoes every action outside onboarding.*, except the deliveries to it', () => {
  for (const flag of ['quickStart', 'requireOnboarding'] as const) {
    const state = life(null, { ...at(), isNew: true, [flag]: true })
    assert.deepEqual([state.onboarding.stage, state.onboarding.required, state.onboarding.bornAt], ['guest', true, MONDAY_9AM], flag)
    for (const type of ACTION_TYPES) {
      const result = dispatchLoose(state, { type, payload: {} }, { ...at(), internal: true }) as { code: string }
      // The two post-creation actions return the same code from their own handler (mustBeDone), not from the veto.
      const ownGuard = type === 'onboarding.set-look' || type === 'onboarding.boutique-buy'
      const passes = (type.startsWith('onboarding.') && !ownGuard) || (INBOUND_ACTIONS as readonly string[]).includes(type)
      if (passes) assert.notEqual(result.code, 'onboarding_required', type)
      else assert.equal(result.code, 'onboarding_required', type)
    }
  }
  // A life made without the flag is offered creation and never held.
  assert.deepEqual([life(null, at()).onboarding.stage, life(null, at()).onboarding.required], ['settled', false])
})

test('a guest who is playing is refused exactly what needs a home, until it settles in', () => {
  const state = guest()
  assert.equal(act(state, 'onboarding.quick-start', { look: LOOK }, at()).code, 'playing')
  assert.deepEqual([state.onboarding.stage, state.onboarding.required, state.onboarding.playedAt, state.onboarding.needsSet], ['guest', false, MONDAY_9AM, true])
  checkState(state, 'guest')
  for (const type of ACTION_TYPES) {
    const payload = type === 'travel' ? { id: 'home', mode: 'trek' } : {}
    const result = dispatchLoose(state, { type, payload }, { ...at(), internal: true }) as { code: string }
    const needsHome = type.startsWith('home.') || type.startsWith('estate.') || type === 'property.house-move' || type === 'travel' || GUEST_CAMPUS.test(type)
    assert.equal(result.code === 'settle_required', needsHome, `${type}: ${result.code}`)
    // The wardrobe and the Boutique open once there is a home: their own handler says so with this code (mustBeDone).
    assert.equal(result.code === 'onboarding_required', type === 'onboarding.set-look' || type === 'onboarding.boutique-buy', `${type}: ${result.code}`)
  }
  const shown = checkView(state, at(), 'guest')
  assert.deepEqual([shown.onboarding.stage, shown.onboarding.guest, shown.estate.placed, typeof shown.onboarding.settleReason, typeof shown.missions.locked], ['guest', true, false, 'string', 'string'])
  assert.equal(shown.goals.chip.kind, 'goal', 'a guest follows the starter chain from the first moment')
  if (shown.goals.chip.kind === 'goal') assert.deepEqual([shown.goals.chip.id, shown.goals.chip.go, shown.goals.chip.activity], ['first-fun', ['park', 'trees'], 'play-ayo'])
  assert.equal(act(state, 'missions.claim', { id: 'd-meal' }, at()).code, 'missions_locked')

  // Settling in with a local government: the free starter house, no rented home, no weekly rent.
  assert.equal(act(state, 'onboarding.traits', { traits: ['musical', 'tech-bro-or-sis'] }, at()).code, 'traits_saved')
  assert.equal(act(state, 'onboarding.dream', { dream: 'yaba-unicorn' }, at()).code, 'dream_saved')
  assert.equal(act(state, 'onboarding.lottery', {}, at()).code, 'rolled')
  assert.equal(act(state, 'onboarding.home', {} as ActionPayload<'onboarding.home'>, at()).code, 'lga_required')
  assert.equal(act(state, 'onboarding.home', { lga: 'ikeja', via: 'device' }, at()).code, 'life_started')
  assert.deepEqual([state.onboarding.stage, state.onboarding.done, state.onboarding.house, state.location], ['settled', true, null, 'home'])
  assert.deepEqual([state.estate.lga, state.estate.lgaConfirmed, state.estate.lgaVia, state.estate.living, state.economy.rent.house], ['ikeja', true, 'device', 'own', null])
  checkState(state, 'settled in its own house')
  const internal: LifeContext = { ...at(), internal: true }
  assert.equal(act(state, 'estate.assign', { lga: 'ikeja', estate: 41, plot: 34 }, internal).code, 'assigned')
  const settled = checkView(state, at(), 'settled in its own house')
  assert.deepEqual([settled.estate.placed, settled.estate.living, settled.estate.plot?.key, settled.onboarding.guest, settled.missions.locked], [true, 'own', 'ikeja/41/2/6', false, null])
  assert.equal(settled.missions.daily.length, MISSION_REWARDS.daily.slots, 'missions are dealt the moment the life settles in')
  assert.ok(settled.economy.rent === null, 'no rent card in a house of your own')
})

test('a trip between cities is the timed action kind intercity', () => {
  const kaduna = onboarded(); kaduna.estate.city = 'abuja'
  assert.equal(act(kaduna, 'estate.relocate', { to: 'kaduna', mode: 'rail' }, at()).code, isOpenCityId('kaduna') ? 'departed' : 'city_not_open')
  const state = onboarded()
  assert.equal(act(state, 'estate.relocate', { to: 'ibadan', mode: 'road' }, at()).code, 'departed')
  const active = state.activeAction
  assert.ok(active && active.kind === 'intercity')
  complete(activeReaders.intercity(active), active, 'intercity action')
  assert.deepEqual([active.id, active.from, active.mode], ['ibadan', 'lagos', 'road'])
  assert.equal(act(state, 'cancel', {}, at()).code, 'no_cancel')
  const arrival = MONDAY_9AM + active.duration * 1000
  assert.equal(settle(state, active.duration, arrival), 'completed')
  assert.deepEqual([state.estate.city, state.location, keys(state.estate.away)], ['ibadan', 'iwo-road-interchange', ['lagos']])
  checkState(state, 'in another city')
  const shown = view(state, at(arrival))
  assert.equal(shown.estate.city, 'ibadan'); assert.equal(shown.estate.lga, null); assert.ok(shown.estate.cheapest, 'Ibadan offers its cheapest local starter upgrade')
  assert.deepEqual(shown.estate.away.map((home) => home.city), ['lagos'])
})

// ---- (b) state keys -----------------------------------------------------------------------

test('LIFE_STATE_KEYS equals the top-level keys of a fresh life', () => {
  assert.deepEqual(keys(life(null, at())), [...LIFE_STATE_KEYS])
})

test('SYSTEM_STATE_KEYS equals every registered system and its stateKeys, in order', () => {
  const registered = systems() as readonly { id: string; stateKeys: readonly string[] }[]
  assert.deepEqual(registered.map((system) => system.id), Object.keys(SYSTEM_STATE_KEYS))
  for (const system of registered) assert.deepEqual(system.stateKeys, SYSTEM_STATE_KEYS[system.id as SystemId], system.id)
  assert.deepEqual(sorted(Object.values(SYSTEM_STATE_KEYS).flat()), [...LIFE_STATE_KEYS])
})

test('ACTIVE_KINDS equals every registered timed-action kind', () => {
  const registered = (systems() as { active?: Record<string, { moves: boolean }> }[]).flatMap((system) => Object.keys(system.active ?? {}))
  assert.deepEqual(sorted(registered), [...ACTIVE_KINDS])
  assert.deepEqual(keys(activeReaders), [...ACTIVE_KINDS])
})

// ---- (c) view keys ------------------------------------------------------------------------

test('VIEW_KEYS and VIEW_FIELD_KEYS equal what viewLife returns for a fresh life', () => {
  const state = life(null, at())
  const shown = checkView(state, at(), 'fresh')
  const withView = (systems() as { id: string; view?: unknown }[]).filter((system) => system.view).map((system) => system.id)
  assert.deepEqual(withView, [...VIEW_KEYS])
  assert.equal(shown.goals.chip.kind, 'create')
  assert.equal(shown.economy.rent, null)
  assert.equal(shown.economy.loan, null)
  assert.equal(shown.travel.event, null)
  assert.equal(shown.travel.active, null)
  assert.equal(shown.activities.active, null)
  assert.equal(shown.career.job, null)
  assert.equal(shown.career.step.kind, 'apply')
})

// ---- (d) slices, fresh and mid-game -------------------------------------------------------

test('every slice of a fresh life has exactly the declared fields', () => {
  const state = life(null, at())
  checkState(state, 'fresh')
  assert.equal(state.activeAction, null)
  assert.equal(state.civic.hunt, null, 'the hunt is rolled by the first settlement, not by createLife')
  assert.equal(state.onboarding.done, false)
})

test('every slice of a mid-game life has exactly the declared fields, and survives a reload unchanged', () => {
  const { state, now, seen } = midGame()
  checkState(state, 'mid-game')
  assert.equal(state.job, 'community-helper')
  assert.equal(state.economy.deposits.length, 1)
  assert.ok(state.ledger.length > 0 && state.ledgerDays.length > 0)
  assert.ok(state.civic.hunt, 'the hunt was rolled')
  assert.deepEqual(keys(state.civic.hunt), ['city', 'claimed', 'day', 'gems'])
  assert.equal(state.civic.hunt.city, state.estate.city)
  for (const gem of state.civic.hunt.gems) assert.deepEqual(keys(gem), ['found', 'kind', 'spot', 'venue'])
  assert.deepEqual(keys(state.travel.gigs), ['count', 'day'])
  assert.deepEqual(keys(state.travel.lastTrip ?? {}), ['from', 'mode', 'to'])
  // What sanitize rebuilds is what the actions wrote: nothing in the declared shape is lost at a load.
  assert.deepEqual(life(JSON.parse(JSON.stringify(state)), { ...at(now), isNew: false }), state)

  // The timed actions that ran on the way, read through the typed readers.
  assert.deepEqual(seen.map((action) => action.kind), ['travel', 'activity', 'call'])
  for (const action of seen) {
    if (action.kind === 'travel') complete(activeReaders.travel(action), action, 'travel action')
    else if (action.kind === 'activity') complete(activeReaders.activity(action), action, 'activity action')
    else if (action.kind === 'call') complete(activeReaders.call(action), action, 'call action')
    else if (action.kind === 'commute') complete(activeReaders.commute(action), action, 'commute action')
    else if (action.kind === 'intercity') complete(activeReaders.intercity(action), action, 'intercity action')
    else assert.fail(`${action.kind}: the campus kinds are read in the campus test`)
  }

  const shown = checkView(state, at(now), 'mid-game')
  assert.ok(shown.economy.rent, 'a rent card exists once the life has moved in')
  assert.deepEqual(keys(shown.economy.rent), ['amount', 'arrears', 'canPayArrears', 'house', 'label', 'lateFee', 'missed', 'nextDue', 'nextDueLabel', 'payBlocked', 'rule', 'warning'])
  for (const deposit of shown.economy.deposits) assert.deepEqual(keys(deposit), ['amount', 'id', 'interest', 'maturesAt', 'maturesLabel', 'payout', 'term', 'termLabel'])
  assert.ok(shown.career.workplace && shown.career.shift && shown.career.job)
  assert.deepEqual(keys(shown.career.workplace), ['label', 'open', 'spot', 'status', 'venue'])
  assert.deepEqual(keys(shown.career.shift), ['duration', 'effects', 'id', 'label', 'minimumNeeds', 'xp'])
  assert.deepEqual(keys(shown.career.today), ['canWork', 'code', 'text', 'weekday'])
  if (shown.economy.loan) {
    assert.deepEqual(keys(shown.economy.loan), ['allBlocked', 'cleared', 'fees', 'instalment', 'left', 'nextCollection', 'nextDue', 'nextDueLabel', 'paid', 'prepaid', 'principal', 'progress', 'rule', 'total', 'weekBlocked', 'weekly', 'weeksLeft'])
  }
})

test('a running timed action shows in the views that describe it', () => {
  const state = onboarded()
  assert.equal(act(state, 'travel', { id: 'park', mode: 'trek' }, at()).code, 'started')
  const trip = view(state, at()).travel.active
  assert.ok(trip)
  assert.deepEqual(keys(trip), ['fare', 'from', 'mode', 'refundable', 'to'])
  assert.deepEqual([trip.from, trip.to, trip.mode, trip.refundable], ['home', 'park', 'trek', false])
  assert.equal(act(state, 'cancel', {}, at()).code, 'cancelled')
  assert.equal(act(state, 'spot', { id: 'bedroom' }, at()).code, 'selected')
  assert.equal(act(state, 'activity', { id: 'nap' }, at()).code, 'started')
  const running = view(state, at()).activities.active
  assert.ok(running)
  assert.deepEqual(keys(running), ['cancellable', 'icon', 'id', 'label', 'reward', 'tags'])
})

// ---- the UNILAG campus (src/campus/unilag) ---------------------------------------------------

test('the campus id unions are exactly the campus tables', () => {
  assert.deepEqual(keys(PROGRAMMES), idsOf<ProgrammeId>({ eee: true, computer: true, mechanical: true, civil: true, english: true, business: true, economics: true }))
  const faculties = idsOf<CampusFaculty>({ Engineering: true, Arts: true, 'Management Sciences': true, 'Social Sciences': true })
  assert.deepEqual(sorted(CAMPUS_FACULTIES), faculties)
  assert.deepEqual(keys(QUIZ_QUESTIONS), faculties)
  const halls = idsOf<HostelHallId>({ moremi: true, mariere: true, 'eni-njoku': true, jaja: true, fagunwa: true })
  assert.deepEqual(sorted(HOSTEL_HALLS), halls)
  assert.deepEqual(sorted(CAMPUS_HALLS), halls, 'games.js keeps its own copy of the hall list')
  assert.deepEqual(sorted(HOSTEL_STORAGE_ITEMS), idsOf<HostelStorageItemId>({ rice: true, garri: true, sugar: true, noodles: true, eggs: true, bread: true, zobo: true, plantain: true }))
  assert.deepEqual(keys(CAMPUS_JOBS), idsOf<CampusJobId>({ 'library-assistant': true, 'lab-assistant': true, tutor: true }))
  assert.deepEqual(sorted(CAMPUS_CLUBS.map((club) => club.id)), idsOf<CampusClubId>({ robotics: true, literary: true, debate: true, enterprise: true, football: true }))
  assert.deepEqual(keys(CAMPUS_DISCOVERIES), idsOf<CampusDiscoveryId>({ senate: true, library: true, 'lagoon-front': true, 'sports-centre': true, 'student-union': true }))
  assert.deepEqual(sorted(DISCOVERY_TRAIL.map((stop) => stop.id)), idsOf<TrailStopId>({
    'main-gate': true, 'new-hall': true, library: true, engineering: true, sports: true, auditorium: true, lagoon: true, 'student-union': true,
  }))
  assert.deepEqual(sorted(SHUTTLE_STOPS.map((stop) => stop.id)), idsOf<ShuttleStopId>({
    'main-gate': true, 'new-hall-shopping': true, senate: true, engineering: true, 'sports-centre': true, 'second-gate': true, 'dli-building': true, 'lagoon-front': true,
  }))
  assert.deepEqual(keys(LECTURE_SLOTS), idsOf<LectureSlotId>({ morning: true, afternoon: true, night: true }))
  assert.deepEqual(keys(UNILAG_BETA_RULES), idsOf<keyof UnilagBetaRules>({
    admissionFee: true, tuition: true, levy: true, hostelFee: true, hostelSleepSeconds: true, hostelSleepEnergy: true, semesterDays: true, lectureSeconds: true,
    assessmentSeconds: true, campusJobSeconds: true, lectureXp: true, attendanceMaximumDays: true, attendanceWeight: true, assignmentWeight: true, examWeight: true,
    graduationCgpa: true, scholarshipCgpa: true, scholarshipAward: true,
  }))

  // Every spot the campus rules name is a spot of the venue, and every id a rule points at is in its closed set.
  const spots = new Set((spotsOf('unilag', 'lagos') as CatalogueSpot[]).map((spot) => spot.id))
  const jobs: readonly string[] = keys(JOBS)
  for (const programme of Object.values(PROGRAMMES)) {
    assert.ok(spots.has(programme.spot), `${programme.id}: spot`)
    assert.ok((SKILL_IDS as readonly string[]).includes(programme.skill), `${programme.id}: skill`)
    assert.ok(programme.careerTrack === null || jobs.includes(programme.careerTrack), `${programme.id}: career track`)
    assert.deepEqual(programme.semesters.map((semester) => semester.number), [1, 2], programme.id)
    assert.deepEqual(Object.keys(programme).filter((key) => key !== 'note'), ['id', 'label', 'faculty', 'department', 'spot', 'skill', 'careerTrack', 'semesters'], programme.id)
    for (const course of programme.semesters.flatMap((semester) => semester.courses)) {
      assert.deepEqual(keys(course), ['credits', 'id', 'skill', 'slot', 'title'], course.id)
      assert.ok((SKILL_IDS as readonly string[]).includes(course.skill) && (course.slot === 'morning' || course.slot === 'afternoon'), course.id)
    }
  }
  for (const hall of HOSTEL_HALLS) assert.ok(spots.has(`${hall}-hall`), `${hall}: the hall's spot`)
  for (const place of [...Object.values(CAMPUS_JOBS), ...CAMPUS_CLUBS, ...DISCOVERY_TRAIL, ...STUDENT_UNION_TABLES]) assert.ok(spots.has(place.spot), `${place.id}: spot`)
  for (const id of [...keys(CAMPUS_DISCOVERIES), ...SHUTTLE_STOPS.map((stop) => stop.id)]) assert.ok(spots.has(id), `${id}: spot`)
  for (const discovery of Object.values(CAMPUS_DISCOVERIES)) assert.ok((SKILL_IDS as readonly string[]).includes(discovery.skill), discovery.id)
  const questions: readonly QuizQuestion[] = Object.values(QUIZ_QUESTIONS).flat()
  for (const question of questions) {
    assert.deepEqual(keys(question), ['id', 'options', 'prompt'], `${question.id}: a public question never carries its answer`)
    for (const option of question.options) assert.deepEqual(keys(option), ['id', 'label'], question.id)
  }
  const campus: Loose<VenueDefinition> = VENUES.unilag
  assert.deepEqual(campus.cities, ['lagos'])
})

test('the campus lists equal what the campus systems register and emit', () => {
  const campus = (systems() as { id: string; actions?: Record<string, unknown> }[]).filter((system) => system.id.startsWith('unilag'))
  assert.deepEqual(campus.map((system) => system.id), ['unilagStudent', 'unilagCommunity', 'unilagShuttle'])
  assert.deepEqual(campus.flatMap((system) => Object.keys(system.actions ?? {})), [...CAMPUS_ACTION_TYPES])
  assert.deepEqual(ACTION_TYPES.slice(-CAMPUS_ACTION_TYPES.length), [...CAMPUS_ACTION_TYPES], 'the campus registers last')
  assert.deepEqual((ACTION_TYPES as readonly string[]).filter((type) => GUEST_CAMPUS.test(type)), [...GUEST_CAMPUS_ACTIONS])
  const root = fileURLToPath(new URL('../campus/unilag/', import.meta.url))
  const source = (readdirSync(root) as string[]).filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts')).map((file) => readFileSync(`${root}${file}`, 'utf8')).join('\n')
  assert.deepEqual([...new Set([...source.matchAll(/\bemit\(state,\s*'([A-Za-z.-]+)'/g)].map((match) => match[1] ?? ''))].sort(), [...CAMPUS_EVENT_NAMES])
  // None of them is an engine event, and no system listens to one.
  const listened = new Set((systems() as { on?: Record<string, unknown> }[]).flatMap((system) => Object.keys(system.on ?? {})))
  for (const name of CAMPUS_EVENT_NAMES) assert.ok(!(EVENT_NAMES as readonly string[]).includes(name) && !listened.has(name), name)
})

test('a student life: every campus slice, timed action and view has exactly the declared fields, and survives a reload', () => {
  const state = onboarded()
  let now = MONDAY_9AM // Monday 09:00 in Lagos: the morning lecture slot, and the freshers' day
  const run = (): ActiveAction => {
    const active = state.activeAction
    assert.ok(active, 'a timed action is running')
    const seen = { ...active }
    now += active.duration * 1000
    assert.equal(settle(state, active.duration, now), 'completed')
    assert.equal(state.activeAction, null)
    return seen
  }
  const stand = (id: string) => assert.equal(act(state, 'spot', { id }, at(now)).code, 'selected', id)
  const study = (action: ActiveAction): CampusStudyAction => {
    assert.ok(action.kind === 'campus-study')
    complete(activeReaders['campus-study'](action), action, `campus-study action (${action.task})`)
    return action
  }

  // A visitor: the trail and the shuttle are open, the student games are not.
  assert.equal(act(state, 'travel', { id: 'unilag', mode: 'trek' }, at(now)).code, 'started')
  run()
  assert.deepEqual([state.location, state.spot], ['unilag', 'main-gate'])
  assert.equal(act(state, 'unilag.trail.visit', {}, at(now)).code, 'trail_visited')
  assert.equal(act(state, 'unilag.discovery', {}, at(now)).code, 'student_required')
  assert.equal(act(state, 'unilag.apply', { programme: 'eee' }, at(now)).code, 'wrong_place')
  assert.equal(act(state, 'campus-shuttle', { destination: 'senate' }, at(now)).code, 'started')
  const riding = view(state, at(now)).unilagShuttle.active
  assert.deepEqual(riding, { origin: 'main-gate', destination: 'senate', refundable: false })
  const ride = run()
  assert.ok(ride.kind === 'campus-shuttle')
  complete(activeReaders['campus-shuttle'](ride), ride, 'campus-shuttle action')
  assert.deepEqual([ride.id, ride.origin, ride.dest, state.location, state.spot, state.unilagShuttle.rides], ['senate', 'main-gate', 'senate', 'unilag', 'senate', 1])

  // Admission, matriculation, registration and a room, all at the Senate.
  assert.equal(act(state, 'unilag.apply', { programme: 'eee' }, at(now)).code, 'admitted')
  assert.equal(act(state, 'unilag.apply', { programme: 'eee' }, at(now)).code, 'already_applied')
  assert.equal(act(state, 'unilag.change-programme', { programme: 'computer' }, at(now)).code, 'programme_changed')
  assert.equal(act(state, 'unilag.change-programme', { programme: 'eee' }, at(now)).code, 'programme_changed')
  assert.equal(act(state, 'unilag.matriculate', {}, at(now)).code, 'matriculated')
  assert.match(state.unilagStudent.studentId ?? '', /^ULG-[0-9]{4}-[0-9]{6}$/)
  const eee = PROGRAMMES.eee
  assert.ok(eee)
  const courses = eee.semesters[0]?.courses.map((course) => course.id) ?? []
  assert.equal(act(state, 'unilag.register-semester', { courses: courses.slice(1) }, at(now)).code, 'courses_required')
  assert.equal(act(state, 'unilag.register-semester', { courses }, at(now)).code, 'registered')
  assert.equal(act(state, 'unilag.hostel.sleep', {}, at(now)).code, 'hostel_required', 'without a room the expected spot is the Senate itself')
  assert.equal(act(state, 'unilag.hostel.allocate', { hall: 'jaja' }, at(now)).code, 'hostel_allocated')
  assert.deepEqual([state.unilagStudent.status, state.unilagStudent.programme, state.unilagStudent.term?.semester], ['studying', 'eee', 1])

  // Study at the programme's spot: three tasks of the one kind 'campus-study', then a campus job.
  stand('engineering')
  assert.equal(act(state, 'unilag.lecture', { course: 'eee-101' }, at(now)).code, 'started')
  const lecture = study(run())
  assert.deepEqual([lecture.task, lecture.id, 'session' in lecture && lecture.session, 'semester' in lecture && lecture.semester], ['lecture', 'eee-101', 'official', 1])
  assert.equal(act(state, 'unilag.assignment', { course: 'eee-101' }, at(now)).code, 'started')
  assert.deepEqual([study(run()).task, typeof state.unilagStudent.term?.assessments['eee-101']?.assignment], ['assignment', 'number'])
  assert.equal(act(state, 'unilag.assignment', { course: 'eee-101' }, at(now)).code, 'already_completed')
  assert.equal(act(state, 'unilag.test', { course: 'eee-101' }, at(now)).code, 'started')
  assert.equal(study(run()).task, 'test')
  assert.equal(act(state, 'unilag.close-semester', {}, at(now)).code, 'semester_running')
  assert.equal(act(state, 'unilag.job', { id: 'lab-assistant' }, at(now)).code, 'started')
  const job = study(run())
  assert.deepEqual([job.task, job.id, 'semester' in job, state.unilagStudent.lifetime.campusJobDays.length], ['job', 'lab-assistant', false, 1])
  assert.equal(act(state, 'unilag.job', { id: 'lab-assistant' }, at(now)).code, 'campus_job_done')

  // The student games, a club, the hall.
  assert.equal(act(state, 'campus-shuttle', { destination: 'sports-centre' }, at(now)).code, 'started')
  run()
  assert.equal(act(state, 'unilag.penalties', {}, at(now)).code, 'started')
  const game = run()
  assert.ok(game.kind === 'campus-game')
  complete(activeReaders['campus-game'](game), game, 'campus-game action')
  assert.equal(act(state, 'unilag.penalties', {}, at(now)).code, 'daily_limit')
  assert.equal(act(state, 'unilag.discovery', {}, at(now)).code, 'discovered')
  assert.equal(act(state, 'unilag.club.join', { id: 'football' }, at(now)).code, 'joined')
  assert.equal(act(state, 'unilag.quiz.start', {}, at(now)).code, 'wrong_place')
  stand('student-union')
  assert.equal(act(state, 'unilag.quiz.start', {}, at(now)).code, 'quiz_closed', 'quiz night is on Friday evening')
  const volunteering = view(state, at(now)).activities.cards.find((card) => card.id === 'unilag-volunteer')
  assert.ok(volunteering && volunteering.blocked === null)
  assert.equal(act(state, 'activity', { id: 'unilag-volunteer' }, at(now)).code, 'started')
  run()
  assert.equal(view(state, at(now)).activities.cards.find((card) => card.id === 'unilag-volunteer')?.blocked?.code, 'daily_limit', 'the campus veto shows on the card')
  stand('jaja-hall')
  assert.equal(act(state, 'unilag.hostel.sleep', {}, at(now)).code, 'started')
  const sleep = study(run())
  assert.deepEqual([sleep.task, sleep.id], ['sleep', 'hostel-sleep'])
  assert.equal(act(state, 'unilag.hostel.store', { item: 'rice', count: 1, direction: 'in' }, at(now)).code, 'stored')
  assert.deepEqual(state.unilagStudent.hostel.storage, { rice: 1 })
  assert.equal(act(state, 'unilag.defer', {}, at(now)).code, 'deferred')
  assert.deepEqual([state.unilagStudent.status, state.unilagStudent.term?.deferredAtDay === null], ['deferred', false])
  assert.equal(act(state, 'unilag.lecture', { course: 'eee-101' }, at(now)).code, 'deferred')
  assert.equal(act(state, 'unilag.resume', {}, at(now)).code, 'resumed')

  // The student vote is the server's: refused to a player, recorded with server authority (Monday: nominations).
  assert.equal(act(state, 'unilag.election.nominate', {}, at(now)).code, 'server_only')
  const internal: LifeContext = { ...at(now), internal: true }
  assert.equal(act(state, 'unilag.election.nominate', {}, internal).code, 'nominated')
  assert.equal(act(state, 'unilag.election.vote', { candidate: 'someone' }, internal).code, 'polls_closed')
  assert.equal(state.unilagCommunity.elections.nominated.length, 1)

  checkState(state, 'student')
  const today = state.unilagCommunity.days.at(-1)
  assert.ok(today)
  assert.deepEqual([keys(today.games), keys(today.teams ?? {}), today.volunteered], [['discovery', 'penalties'], ['discovery', 'penalties'], true])
  assert.deepEqual([state.unilagCommunity.clubs, state.unilagCommunity.discoveries, state.unilagCommunity.trail], [['football'], ['sports-centre'], ['main-gate']])
  // What sanitize rebuilds is what the actions wrote.
  assert.deepEqual(life(JSON.parse(JSON.stringify(state)), { ...at(now), isNew: false }), state)

  const shown = checkView(state, at(now), 'student')
  assert.deepEqual([shown.unilagStudent.status, shown.unilagStudent.programme?.id, shown.unilagStudent.degree, shown.unilagStudent.courses.length], ['studying', 'eee', null, courses.length])
  assert.deepEqual(shown.unilagStudent.courses[0], { ...eee.semesters[0]?.courses[0], attendance: 1, study: 1, ...state.unilagStudent.term?.assessments['eee-101'] })
  assert.deepEqual([shown.unilagCommunity.eligible, shown.unilagCommunity.events.map((event) => event.id), shown.unilagCommunity.trail.found], [true, ['freshers'], 1])
  assert.deepEqual(shown.unilagCommunity.today, today)
  assert.equal(shown.unilagShuttle.active, null)

  // Dropping out keeps what a new application does not reset.
  assert.equal(act(state, 'unilag.drop', {}, at(now)).code, 'dropped')
  assert.deepEqual([state.unilagStudent.status, state.unilagStudent.programme, state.unilagStudent.term, state.unilagStudent.hostel.allocations.length, state.unilagStudent.hostel.storage.rice], ['dropped', null, null, 0, 1])
  checkState(state, 'dropped out')
  assert.deepEqual(life(JSON.parse(JSON.stringify(state)), { ...at(now), isNew: false }), state)
})

test('the campus is a venue of Lagos only', () => {
  const lagos = onboarded()
  const elsewhere: LifeContext = context({ now: MONDAY_9AM, cityId: 'ibadan', seed: 'types' })
  const state = life({ ...lagos, estate: { ...lagos.estate, city: 'ibadan' } }, elsewhere)
  const refused = act(state, 'travel', { id: 'unilag', mode: 'trek' }, elsewhere)
  assert.deepEqual([refused.ok, refused.code], [false, 'campus_lagos_only'])
  assert.ok(!view(state, elsewhere).travel.destinations.some((destination) => destination.id === 'unilag'))
  assert.ok(!view(state, at()).travel.destinations.some((destination) => destination.id === 'unilag'), 'a stale Lagos storage context does not move the character')
  assert.ok(view(lagos, elsewhere).travel.destinations.some((destination) => destination.id === 'unilag'), 'the Lagos character keeps its own city despite a stale storage context')
})

// ---- registry: events and modifier keys ---------------------------------------------------

/** Every non-test .ts file of the rules engine, as text. */
function engineSource(): string {
  const root = fileURLToPath(new URL('../game/', import.meta.url))
  const files = (readdirSync(root, { recursive: true }) as string[]).filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
  return [...files.map((file) => readFileSync(`${root}${file}`, 'utf8')), readFileSync(fileURLToPath(new URL('../life.ts', import.meta.url)), 'utf8')].join('\n')
}
const namesIn = (source: string, pattern: RegExp): string[] => [...new Set([...source.matchAll(pattern)].map((match) => match[1] ?? ''))].sort()

test('EVENT_NAMES lists every event the engine emits', () => {
  const literal = namesIn(engineSource(), /\bemit\(state, '([A-Za-z.-]+)'/g)
  const fromContent = (Object.values(ACTIVITY_OUTCOMES) as { success: { event?: string } }[]).flatMap((rule) => (rule.success.event ? [rule.success.event] : []))
  assert.deepEqual(sorted(fromContent), [...CONTENT_EVENT_NAMES])
  assert.deepEqual([...new Set([...literal, ...fromContent])].sort(), [...EVENT_NAMES])
})

test('every listener is for a known event, and the listened-but-never-emitted set is as recorded', () => {
  const listened = new Set((systems() as { on?: Record<string, unknown> }[]).flatMap((system) => Object.keys(system.on ?? {})))
  const emitted = new Set<string>(EVENT_NAMES)
  assert.deepEqual([...listened].filter((event) => !emitted.has(event)).sort(), [...UNEMITTED_LISTENED_EVENTS])
})

test('MODIFIER_KEYS lists every key passed to modify(), and every contributed modifier is one of them', () => {
  assert.deepEqual(namesIn(engineSource(), /\bmodify\(state, '([A-Za-z.-]+)'/g), [...MODIFIER_KEYS])
  const contributed = new Set((systems() as { modifiers?: Record<string, unknown> }[]).flatMap((system) => Object.keys(system.modifiers ?? {})))
  const asked = new Set<string>(MODIFIER_KEYS)
  assert.deepEqual([...contributed].filter((key) => !asked.has(key)), [])
})

// ---- content: the closed id sets are the keys of the tables ---------------------------------

test('the id unions in life.ts are exactly the keys of the content tables', () => {
  assert.deepEqual([...NEEDS], [...NEED_IDS])
  assert.deepEqual([...SKILLS], [...SKILL_IDS])
  assert.deepEqual(keys(VENUES), idsOf<VenueId>({
    park: true, library: true, home: true, radio: true, shrine: true, 'viewing-centre': true, 'amala-shitta': true, cchub: true,
    hospital: true, salon: true, church: true, mosque: true, market: true, police: true, 'polling-unit': true, 'state-house': true,
    'i-fitness': true, office: true, quilox: true, rooftop: true, 'canopy-walk': true, palms: true, beach: true, airport: true, refinery: true,
    unilag: true,
  }))
  // No place is waiting in this build: ComingSoonId has no member.
  assert.deepEqual(keys(COMING_SOON), idsOf<ComingSoonId>({}))
  const houses = idsOf<HouseId>({ mushin: true, yaba: true, lekki: true, ikoyi: true, banana: true })
  assert.deepEqual(keys(HOUSES), houses)
  assert.deepEqual(keys(HOME_SPOTS), houses)
  assert.deepEqual(keys(RENTS), houses)
  assert.deepEqual(keys(START_HOMES), idsOf<StartHomeId>({ mushin: true, yaba: true, lekki: true }))
  assert.deepEqual(keys(TRAVEL_MODES), idsOf<BaseTravelModeId>({ trek: true, keke: true, danfo: true, okada: true, cab: true }))
  assert.deepEqual(keys(ALL_MODES), idsOf<TravelModeId>({ trek: true, keke: true, danfo: true, okada: true, cab: true, car: true, boat: true }))
  assert.deepEqual(keys(JOBS), idsOf<JobId>({
    'community-helper': true, tech: true, banking: true, music: true, trading: true, nursing: true, hair: true, chef: true,
    dj: true, fitness: true, creator: true, teaching: true, event: true, football: true, retail: true,
  }))
  assert.deepEqual(keys(CARS), idsOf<CarId>({
    'agama-150': true, 'tokunbo-saloon': true, 'oga-sedan': true, 'marina-v6': true, 'chief-suv': true, 'boardroom-330': true,
    'harmattan-cruiser': true, 'atlantic-x': true, 'atlantic-grand': true,
  }))
  assert.deepEqual(keys(TRAITS), idsOf<TraitId>({
    hustler: true, foodie: true, 'owambe-spirit': true, 'gym-rat': true, 'smooth-talker': true, 'lazy-bone': true,
    'clean-pikin': true, 'night-crawler': true, 'tech-bro-or-sis': true, musical: true,
  }))
  assert.deepEqual(keys(DREAMS), idsOf<DreamId>({ 'oga-at-the-top': true, 'lekki-landlord': true, 'afrobeats-star': true, 'everybodys-padi': true, 'yaba-unicorn': true }))
  assert.deepEqual(keys(LOTTERY), idsOf<LotteryId>({ 'lapo-baby': true, 'civil-servant': true, 'street-smart': true, ajebutter: true }))
  assert.deepEqual(sorted(PERKS.map((perk) => perk.id)), idsOf<PerkId>({
    'steel-bladder': true, 'iron-belle': true, 'early-bird': true, 'never-dull': true, 'sweet-mouth': true, connected: true,
    'hustle-juice': true, 'fast-learner': true, 'stay-fresh': true, 'people-person': true, 'buka-regular': true, 'area-sabi': true,
    'ogas-favourite': true, 'lucky-star': true, 'second-wind': true, odogwu: true,
  }))
  assert.deepEqual(sorted(STARTER_GOALS.map((goal) => goal.id)), idsOf<StarterGoalId>({
    'first-fun': true, 'say-hello': true, 'settle-in': true, eat: true, 'freshen-up': true, 'get-a-job': true, 'buy-something': true, 'visit-buka': true, 'make-a-friend': true, 'work-a-shift': true,
  }))
  assert.deepEqual(keys(EVENTS), idsOf<RoadsideEventId>({ agbo: true, hawker: true, change: true, puddle: true, wallet: true, toll: true, busker: true, holdup: true }))
  assert.deepEqual(keys(DEPOSIT_TERMS), idsOf<DepositTermId>({ d1: true, d3: true, d7: true }))
  assert.deepEqual(keys(FAMILY), idsOf<FamilyId>({ mummy: true, daddy: true, tobi: true, grandma: true }))
  assert.deepEqual(sorted(TIERS.map((tier) => tier.id)), idsOf<TierId>({ stranger: true, acquaintance: true, friend: true, paddy: true }))
  const originalCities = idsOf<WorldCityId>({ lagos: true, ibadan: true, abeokuta: true, ota: true, 'ijebu-ode': true, sagamu: true, 'port-harcourt': true, abuja: true, kano: true })
  assert.ok(originalCities.every((id) => Object.hasOwn(CITY_RULES, id)), 'the original nine city rules remain')
  assert.deepEqual(new Set(keys(CITY_RULES)), new Set(playableCityIds()))
  assert.deepEqual(LAGOS_LGAS.map((lga) => lga.id), [...LGA_IDS])
  for (const city of Object.values(CITY_RULES).map(required)) {
    for (const unit of city.units) assert.equal(lgaOf(city.id, unit.id), unit, `${city.id}: ${unit.id}`)
    assert.equal(lgaOf(city.id, 'not-a-local-government'), null)
  }
  const tiers = idsOf<HouseTierId>({ starter: true, bq: true, bungalow: true, duplex: true, villa: true })
  assert.deepEqual(keys(HOUSE_TIERS), tiers)
  assert.deepEqual(sorted(TIER_ORDER), tiers)
  assert.deepEqual(sorted(STYLE_FIELDS), idsOf<HouseStyleField>({ shape: true, wall: true, roof: true, door: true, windows: true, fence: true, yard: true, sign: true }))
  assert.deepEqual([...new Set(CITY_LINKS.map((link) => link.mode))].sort(), ['air', 'rail', 'road'])
  assert.deepEqual(sorted([...DAY_TITLES.map((title) => title.id), WEEK_TITLE.id]), idsOf<MissionTitleId>({ settled: true, lagosian: true, 'city-elder': true, 'week-finisher': true }))
  assert.deepEqual(sorted(MISSION_KINDS), idsOf<MissionKind>({ life: true, discovery: true, social: true }))
})

test('the look unions are exactly the appearance options', () => {
  assert.deepEqual(sorted(APPEARANCE.bodies.map((body) => body.id)), idsOf<BodyId>({ woman: true, man: true }))
  assert.deepEqual([...new Set([...APPEARANCE.hair.woman, ...APPEARANCE.hair.man, ...APPEARANCE.extra.hair.woman, ...APPEARANCE.extra.hair.man])].sort(), idsOf<HairId>({
    braids: true, afro: true, bun: true, ponytail: true, long: true, locs: true, 'low-cut': true, gele: true, classic: true, bald: true, curls: true,
    'bantu-knots': true, cornrows: true, fade: true, twists: true,
  }))
  assert.deepEqual([...new Set([...APPEARANCE.outfits.woman, ...APPEARANCE.outfits.man, ...APPEARANCE.extra.outfits.woman, ...APPEARANCE.extra.outfits.man])].sort(), idsOf<OutfitId>({
    casual: true, office: true, owambe: true, 'site-work': true, hoodie: true, chill: true, jersey: true, kaftan: true, gown: true, agbada: true,
  }))
  assert.deepEqual(sorted(APPEARANCE.fabrics), idsOf<FabricId>({ plain: true, ankara: true, adire: true, 'aso-oke': true }))
  assert.deepEqual(sorted(APPEARANCE.skin.map((swatch) => swatch.id)), idsOf<SkinId>({ 'skin-1': true, 'skin-2': true, 'skin-3': true, 'skin-4': true, 'skin-5': true, 'skin-6': true, 'skin-7': true }))
  assert.deepEqual(sorted(APPEARANCE.hairColours.map((swatch) => swatch.id)), idsOf<HairColourId>({
    black: true, 'soft-black': true, 'dark-brown': true, brown: true, auburn: true, blonde: true, purple: true,
  }))
  assert.deepEqual(sorted(APPEARANCE.outfitColours.map((swatch) => swatch.id)), idsOf<OutfitColourId>({
    blue: true, green: true, red: true, orange: true, violet: true, pink: true, teal: true, navy: true, cream: true, gold: true,
  }))
  assert.deepEqual(sorted(APPEARANCE.accessories.map((item) => item.id)), idsOf<AccessoryId>({
    glasses: true, sunglasses: true, cap: true, headwrap: true, fila: true, earrings: true, chain: true, watch: true, beads: true, backpack: true, handbag: true,
  }))
  assert.deepEqual([...new Set(APPEARANCE.accessories.map((item) => item.slot))].sort(), idsOf<AccessorySlot>({ eyes: true, head: true, ears: true, neck: true, wrist: true, hand: true, carry: true }))
  assert.deepEqual(keys(BOUTIQUE_PRICES.accessories), sorted(APPEARANCE.accessories.map((item) => item.id)))
  assert.deepEqual(sorted(APPEARANCE.faces), idsOf<FaceId>({ oval: true, round: true, long: true }))
  assert.deepEqual(sorted(APPEARANCE.expressions), idsOf<ExpressionId>({ smile: true, neutral: true, grin: true }))
  assert.deepEqual([APPEARANCE.faces[0], APPEARANCE.expressions[0]], ['oval', 'smile'], 'the defaults, which a look never stores')
  assert.deepEqual(keys(BOUTIQUE_PRICES.hair), sorted([...new Set([...APPEARANCE.hair.woman, ...APPEARANCE.hair.man, ...APPEARANCE.extra.hair.woman, ...APPEARANCE.extra.hair.man])]))
})

test('venue, scene and furniture unions are exactly the values the content uses', () => {
  const venues = Object.values(VENUES) as { zone: string; category: string; scene: { kind: string; variant?: string } }[]
  assert.deepEqual([...SCENE_KINDS].sort(), idsOf<SceneKind>({
    park: true, buka: true, hub: true, club: true, office: true, market: true, gym: true, mall: true, beach: true, hospital: true,
    salon: true, rooftop: true, police: true, worship: true, radio: true, polling: true, viewing: true, shrine: true, walk: true,
    statehouse: true, airport: true, refinery: true, unilag: true, home: true,
    quad: true, hilltop: true, lakeside: true,
  }))
  for (const venue of venues) assert.ok((SCENE_KINDS as readonly string[]).includes(venue.scene.kind), venue.scene.kind)
  assert.deepEqual([...new Set(venues.map((venue) => venue.zone))].sort(), idsOf<VenueZone>({ mainland: true, island: true, east: true }))
  assert.deepEqual(keys(VENUE_CATEGORIES), idsOf<VenueCategoryId>({ food: true, fun: true, nightlife: true, work: true, care: true, civic: true }))
  // Home's category is the one value outside VENUE_CATEGORIES (recorded as an inconsistency in content.ts).
  assert.deepEqual([...new Set(venues.map((venue) => venue.category))].sort(), sorted([...keys(VENUE_CATEGORIES), 'home']))
  assert.deepEqual([...new Set(venues.flatMap((venue) => (venue.scene.variant ? [venue.scene.variant] : [])))].sort(), ['church', 'mosque', 'speakeasy'])
  assert.deepEqual(keys(KINDS), idsOf<FurnitureKind>({
    bed: true, cooler: true, stove: true, bath: true, tub: true, toilet: true, seat: true, radio: true, tv: true, console: true,
    game: true, pet: true, gym: true, desk: true, shelf: true, keys: true, mirror: true, tripod: true, mic: true, light: true,
    power: true, water: true, decor: true,
  }))
  assert.deepEqual(sorted(CATEGORIES.map((category) => category.id)), idsOf<FurnitureCategoryId>({
    sleep: true, kitchen: true, bath: true, comfort: true, fun: true, skills: true, light: true, decor: true, pets: true,
  }))
  for (const item of Object.values(FURNITURE)) {
    assert.ok(Object.hasOwn(KINDS, item.kind), `${item.id}: kind`)
    assert.ok(CATEGORIES.some((category) => category.id === item.category), `${item.id}: category`)
  }
})

test('every field used by a venue, a spot, an activity or a job is declared in content.ts', () => {
  const venueFields = ['id', 'label', 'district', 'icon', 'description', 'category', 'hours', 'zone', 'map', 'ambient', 'scene', 'spots', 'beta', 'cities', 'note'] as const satisfies readonly (keyof VenueDefinition)[]
  const spotFields = ['id', 'label', 'icon', 'caption', 'activities', 'beta', 'integration'] as const satisfies readonly (keyof SpotDefinition)[]
  const catalogueSpotFields = ['id', 'label', 'icon', 'caption', 'activities'] as const satisfies readonly (keyof CatalogueSpot)[]
  const activityFields = [
    'id', 'label', 'icon', 'duration', 'cost', 'chargeOn', 'refundOnCancel', 'cancellable', 'effects', 'effectsPerSecond', 'reward',
    'xp', 'xpPerSecond', 'requiresSkill', 'requiresJob', 'minimumNeeds', 'hours', 'consumes', 'produces', 'moodlets', 'choices',
    'tags', 'unavailable', 'beta', 'note', 'cooldown', 'requiresMoodlet', 'requiresReason', 'clears', 'requiresIllness', 'where',
    'careerTrack', 'home', 'social',
  ] as const satisfies readonly (keyof ActivityDefinition)[]
  type AllActivityFields = Assert<Equal<Members<typeof activityFields>, keyof ActivityDefinition>>
  const everyField: AllActivityFields = true
  assert.ok(everyField)
  const undeclared = (value: object, declared: readonly string[]) => Object.keys(value).filter((key) => !declared.includes(key))

  for (const venue of Object.values(VENUES)) {
    assert.deepEqual(undeclared(venue, venueFields), [], `venue ${venue.id}`)
    for (const spot of Object.values(venue.spots)) assert.deepEqual(undeclared(spot, spotFields), [], `spot ${venue.id}/${spot.id}`)
  }
  // The merged catalogue: venue content plus everything systems attach (shifts, furniture, recipes, people, the pitch).
  let activities = 0
  for (const venue of Object.keys(VENUES)) {
    for (const spot of spotsOf(venue, 'lagos') as CatalogueSpot[]) {
      assert.deepEqual(undeclared(spot, catalogueSpotFields), [], `catalogue spot ${venue}/${spot.id}`)
      for (const def of spot.activities) {
        activities += 1
        assert.deepEqual(undeclared(def, activityFields), [], `activity ${def.id}`)
        assert.ok(typeof def.id === 'string' && typeof def.label === 'string' && typeof def.duration === 'number' && def.duration > 0, def.id)
      }
    }
  }
  assert.ok(activities > 100, 'the catalogue was walked')

  const starterFields = ['id', 'label', 'icon', 'summary', 'workplace', 'workplaceName', 'shift', 'beta']
  const trackFields = [...starterFields, 'track', 'skill', 'days', 'ladder']
  for (const job of Object.values(JOBS) as unknown as Record<string, unknown>[]) {
    assert.deepEqual(undeclared(job, job.track ? trackFields : starterFields), [], `job ${String(job.id)}`)
    assert.deepEqual(undeclared(job.shift as object, activityFields), [], `shift of ${String(job.id)}`)
    assert.deepEqual(keys(job.workplace as object), ['spot', 'venue'], `workplace of ${String(job.id)}`)
    if (job.track) for (const rung of job.ladder as object[]) assert.deepEqual(keys(rung), ['pay', 'role', 'skillLevel'], `ladder of ${String(job.id)}`)
  }
})

test('no content entry carries a field that content.ts does not declare', () => {
  /** `fields` must name every key of `T` (checked by the compiler); no entry may carry another. */
  const declared = <T>() => <const L extends readonly (keyof T)[]>(fields: L & ([keyof T] extends [L[number]] ? unknown : never)) =>
    (entries: readonly object[], what: string) => {
      for (const entry of entries) assert.deepEqual(Object.keys(entry).filter((key) => !(fields as readonly PropertyKey[]).includes(key)), [], what)
    }
  declared<FurnitureDefinition>()(['id', 'label', 'category', 'kind', 'w', 'h', 'wall', 'stars', 'price', 'icon', 'shape', 'color', 'beta'])(Object.values(FURNITURE), 'furniture')
  declared<CarDefinition>()(['id', 'label', 'nickname', 'icon', 'price', 'fuel', 'speed', 'beta', 'priceReported'])(Object.values(CARS), 'car')
  declared<HouseDefinition>()(['id', 'label', 'district', 'grid', 'rent', 'moveIn', 'tag', 'description', 'betaFields'])(Object.values(HOUSES), 'house')
  declared<TravelModeDefinition>()(['id', 'label', 'icon', 'fare', 'seconds', 'needs', 'xp', 'exposed', 'eventChance', 'blurb', 'fuel', 'beta'])(Object.values(ALL_MODES), 'travel mode')
  declared<IngredientDefinition>()(['id', 'label', 'icon', 'start', 'price', 'pack', 'beta'])(Object.values(INGREDIENTS), 'ingredient')
  declared<RecipeDefinition>()(['id', 'label', 'icon', 'station', 'duration', 'ingredients', 'betaIngredients', 'effects', 'xp', 'requiresSkill', 'moodlets', 'beta', 'note'])(Object.values(RECIPES), 'recipe')
  declared<TraitDefinition>()(['id', 'label', 'icon', 'blurb', 'effects', 'fx', 'beta', 'betaFields'])(Object.values(TRAITS), 'trait')
  declared<DreamDefinition>()(['id', 'label', 'icon', 'goal', 'measure'])(Object.values(DREAMS), 'dream')
  declared<StartHomeDefinition>()(['id', 'label', 'district', 'rent', 'tag', 'icon', 'blurb'])(Object.values(START_HOMES), 'start home')
  declared<LotteryOutcome>()(['id', 'label', 'icon', 'tagline', 'odds', 'startCash', 'ownCash', 'locked', 'loan', 'skills', 'fx', 'bullets', 'beta', 'betaFields'])(Object.values(LOTTERY), 'lottery outcome')
  declared<NpcDefinition>()(['id', 'venue', 'name', 'role', 'emoji', 'quotes', 'at', 'actions', 'beta', 'note', 'age', 'look', 'greeting'])(Object.values(NPCS), 'npc')
  declared<NpcAction>()(['id', 'label', 'icon', 'duration', 'cost', 'effects', 'bonus', 'xp', 'points', 'success', 'beta', 'note'])(NPC_ACTIONS, 'npc action')
  declared<FamilyMember>()(['id', 'name', 'relation', 'emoji', 'line', 'contact', 'quotes', 'beta', 'note'])(Object.values(FAMILY), 'family member')
  declared<StarterGoal>()(['id', 'title', 'hint', 'icon', 'cash', 'stars', 'done', 'open', 'params', 'go', 'workplace', 'activity', 'here', 'beta', 'betaFields'])(STARTER_GOALS, 'starter goal')
  declared<PerkDefinition>()(['id', 'label', 'icon', 'cost', 'effect', 'fx', 'wishBonus', 'beta', 'betaFields'])(PERKS, 'perk')
  declared<RoadsideEvent>()(['id', 'icon', 'title', 'text', 'modes', 'weight', 'choices', 'oncePerDay', 'beta'])(Object.values(EVENTS), 'roadside event')
  for (const npc of Object.values(NPCS) as unknown as Record<string, unknown>[]) {
    assert.deepEqual([typeof npc.id, typeof npc.venue, typeof npc.name, typeof npc.role, typeof npc.emoji, Array.isArray(npc.quotes)], ['string', 'string', 'string', 'string', 'string', true], String(npc.id))
    assert.ok(npc.at === null || typeof npc.at === 'string', String(npc.id))
  }
  const wishFields = ['id', 'label', 'hint', 'icon', 'beta', 'on', 'amount', 'venue', 'activity', 'spot', 'tags', 'event', 'count']
  for (const wish of WISHES) assert.deepEqual(Object.keys(wish).filter((key) => !wishFields.includes(key)), [], wish.id)
  assert.deepEqual([...new Set(WISHES.map((wish) => wish.on))].sort(), ['activity', 'earn', 'event', 'visit'])
  for (const goal of STARTER_GOALS) assert.deepEqual(Object.keys(goal.done).filter((key) => !['events', 'tags', 'venue', 'hasJob', 'activity', 'fresh'].includes(key)), [], goal.id)
  declared<LgaDefinition>()(['id', 'name', 'zone', 'land', 'districts', 'beta'])(LAGOS_LGAS, 'local government')
  declared<HouseTierDefinition>()(['id', 'rank', 'label', 'icon', 'grid', 'cost', 'buildSeconds', 'groundRent', 'blurb', 'beta'])(Object.values(HOUSE_TIERS), 'house tier')
  declared<CityRules>()(['id', 'name', 'status', 'unit', 'units', 'hub', 'seaPlots', 'legacyLgaChoice', 'legacyVenueAliases', 'civicTitle', 'climate'])(Object.values(CITY_RULES).map(required), 'city')
  declared<CityLink>()(['a', 'b', 'mode', 'label', 'icon', 'fare', 'seconds', 'km', 'beta', 'status'])(CITY_LINKS, 'city link')
  declared<CalendarEvent>()(['id', 'title', 'blurb', 'venue', 'icon', 'when', 'spray', 'table'])(EVENTS_CALENDAR, 'calendar event')
  for (const option of Object.values(HOUSE_STYLE).flat()) assert.deepEqual(Object.keys(option).filter((key) => !['id', 'label', 'hex', 'price'].includes(key)), [], option.id)
  // Missions are a union keyed by `on`; each member's own fields are checked by name.
  const missionFields: Record<MissionDefinition['on'], string[]> = { event: ['event', 'where'], tag: ['tags'], paid: [], venue: ['fresh'] }
  const missions: readonly { id: string; on: string }[] = [...DAILY_MISSIONS, ...WEEKLY_MISSIONS]
  for (const mission of missions) {
    assert.ok(Object.hasOwn(missionFields, mission.on), mission.id)
    const allowed = ['id', 'kind', 'label', 'hint', 'count', 'needs', 'open', 'go', 'on', ...(missionFields[mission.on as MissionDefinition['on']] ?? [])]
    assert.deepEqual(Object.keys(mission).filter((key) => !allowed.includes(key)), [], mission.id)
  }
})
