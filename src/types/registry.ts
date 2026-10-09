/**
 * The system contract of the rules engine, as types. The prose contract is the header of
 * src/game/registry.ts; this file is its shape: what a system file default-exports, the events
 * systems emit to one another, and the modifier keys they fold values through.
 */
import type { ActionMap, ActionType, ActionVetoCode, ActivityVetoCode } from './actions.ts'
import type {
  ActivityDefinition, Block, CarDefinition, FurnitureDefinition, IngredientDefinition, ResolvedActivity, RouteBand,
} from './content.ts'
import type {
  ActionFailure, ActionOutcome, ActiveAction, ActiveKind, ActivityId, CarId, WorldCityId, DepositTermId, DreamId, FurnitureId, HouseId,
  HouseTierId, IllnessCause, ItemId, JobId, LgaId, LifeContext, LifeState, Look, LotteryId, MissionId, NeedId, NeedMap, NpcId, PerkId,
  RoadsideEventId, SkillId, StarterGoalId, StartHomeId, SystemId, TierId, TraitId, TravelModeId, VenueId, WishId,
} from './life.ts'
import type { LifeView } from './view.ts'
import type { CampusEngineEvent, CampusEventMap } from './campus.ts'

// ---- events -------------------------------------------------------------------------------

/**
 * `kind` of a line posted to the Updates feed through 'notice.posted':
 *   career 'promotion' · health 'illness' | 'recovered' · economy 'rent-due' | 'rent' |
 *   'rent-missed' | 'loan' | 'loan-missed' · civic 'gov' · estate 'house' | 'ground-rent' · home 'power' ·
 *   missions 'mission' · growth 'referral'.
 * (The social system also writes 'transfer' and 'bae' notices directly, without the event.)
 */
export type NoticeKind =
  | 'promotion' | 'illness' | 'recovered' | 'rent-due' | 'rent' | 'rent-missed' | 'loan' | 'loan-missed' | 'gov'
  | 'house' | 'ground-rent' | 'mission' | 'referral' | 'power'

/**
 * Every event emitted through `emit(state, '<name>', data, ctx)` anywhere in src/game, with the
 * data its emitter passes. (The campus systems in src/campus/unilag emit seven more, which nothing
 * listens to: campus.ts CampusEventMap.) Listeners always receive an object (anything else becomes `{}`), run in
 * registration order, may mutate state and may emit further events (at most 8 deep).
 */
export interface EngineEventMap {
  // -- foundation (activities, core, wallet, skills) --
  'activity.started': { id: ActivityId; def: ResolvedActivity }
  /** `cash` is the naira actually credited (0 when the activity had no reward or the credit was refused). */
  'activity.completed': { id: ActivityId; def: ResolvedActivity; tags: string[]; choice: string | null; cash: number }
  /** Finished but could no longer be paid for: none of its completion effects were applied. */
  'activity.unpaid': { id: ActivityId; def: ResolvedActivity }
  /** The timed action was cancelled by the player (any kind). */
  'action.cancelled': { kind: ActiveKind; id: string }
  /** Every balance change. `amount` is signed; `balance` is the balance after it. */
  'wallet.changed': { amount: number; reason: string; balance: number }
  'skill.levelup': { skill: SkillId; level: number }
  /**
   * The player was put in a venue (a trip, the commute, moving in). `mode` is a travel mode id, or
   * null when no vehicle was used. Extra `options` handed to api.arrive() are passed through.
   */
  // INCONSISTENT: the campus shuttle arrives with `mode: 'campus-shuttle'` (src/campus/unilag/shuttle.ts:246), which is
  // not a travel mode id; the listeners (health, missions, goals, home) only compare it with ids they know.
  'travel.arrived': { venue: VenueId; from: VenueId; mode: TravelModeId | 'campus-shuttle' | null; [extra: string]: unknown }

  // -- career --
  /** `maxLevel` (rungs in the ladder) only for a career track. */
  'job.applied': { job: JobId; maxLevel?: number }
  'job.quit': { job: JobId }
  /**
   * `pay` and `level` are those the shift was worked at; `maxLevel` only for a career track.
   * INCONSISTENT: registry.js:141 documents this event as `{ job, activity }` only.
   */
  'shift.completed': { job: JobId; activity: ActivityId; pay: number; level: number; maxLevel?: number }
  promotion: { job: JobId; level: number; role: string; maxLevel: number; top: boolean }
  /** A line for the Updates feed; the social system stores it. */
  'notice.posted': { kind: NoticeKind; text: string }

  // -- travel --
  /** After every arrival by travelling; `first` = never been before. */
  'venue.visited': { venue: VenueId; first: boolean }
  'roadside.offered': { event: RoadsideEventId }
  /** `success` is null when the choice rolled nothing. */
  'roadside.resolved': { event: RoadsideEventId; choice: string; success: boolean | null }
  /** A roadside remedy was taken; `by` is the event title. */
  'health.treat': { by: string }
  /**
   * The CcHub 'hub-pitch' chance activity won its one-time grant. Emitted through content
   * (`emit(state, outcome.event, …)`, travel.js:276; events.js:122), not by a literal name.
   * INCONSISTENT: no system listens to it; the dream "Yaba Unicorn" is completed by a different
   * activity ('dream-startup-pitch', goals.js) and a different flag (`goals.stats.funded`).
   */
  'startup.funded': { venue: VenueId }
  /** A chance activity was rolled. */
  'activity.outcome': { id: ActivityId; success: boolean }

  // -- health --
  'illness.started': { cause: IllnessCause }
  /** `by` is the curing activity id, a roadside event title, 'remedy' or 'rest'. */
  'illness.cured': { by: string }
  'weather.soaked': { mode: TravelModeId }

  // -- economy --
  'rent.due': { amount: number; house: HouseId }
  /** `arrears` is what is still owed after the payment. */
  'rent.paid': { amount: number; house: HouseId; arrears: number }
  'rent.missed': { amount: number; house: HouseId; arrears: number; missed: number }
  'loan.paid': { amount: number; left: number }
  'loan.missed': { amount: number; left: number }
  'deposit.opened': { id: string; amount: number; term: DepositTermId }
  /** `interest` is 0 for an early close. */
  'deposit.closed': { id: string; amount: number; interest: number }

  // -- property and estate --
  /**
   * The home changed, so furniture is re-fitted. Four emitters:
   *   property 'property.house-move'  `id` the new rented house, `from` the old one, `cost` the move-in fee
   *   estate   'estate.move-in'       `id: 'own'`, `from` the rented house left, cost 0
   *   estate   an upgrade finished    `id: 'own'`, `from: 'own'`, cost 0 (the room grew), only while living there
   *   estate   arriving in a city     `from: 'away'`, cost 0, and `house` = the rented tier kept there
   */
  'house.moved': { id: HouseId | 'own'; from: HouseId | 'own' | 'away'; cost: number; house?: HouseId }
  /** The home changed between rented and owned: `living` true = the life now lives in its own house. `house` is the rented tier. */
  'home.owned': { living: boolean; house: HouseId }
  /** An upgrade was paid for and the builders started. */
  'house.upgrade-started': { to: HouseTierId; cost: number }
  /** An upgrade finished: the house is now this tier. */
  'house.upgraded': { tier: HouseTierId }
  /** The look of the house changed; `price` is what was charged (0 for free options). */
  'house.styled': { price: number }
  /** The local government was chosen for the first time or changed (the server then allocates a plot there). */
  'lga.changed': { lga: LgaId }
  /** An intercity trip arrived: the life is now in city `to`. */
  'city.changed': { from: WorldCityId; to: WorldCityId }
  'car.bought': { id: CarId; price: number }
  'car.sold': { id: CarId; refund: number }

  // -- home --
  /** `id` and `item` are the same catalogue id; `count` (units delivered) only for groceries. */
  'item.bought': { id: FurnitureId | ItemId; item: FurnitureId | ItemId; price: number; kind: 'furniture' | 'grocery'; count?: number }
  /** INCONSISTENT: the header of home.js (line 48) documents `{ id, refund }`; the emitter also sends `item` (home.js:204). */
  'item.sold': { id: FurnitureId; item: FurnitureId; refund: number }
  /** `id` is the recipe id, or the activity id for a ported food activity eaten at home. */
  'meal.eaten': { id: string; source: 'home' }

  // -- onboarding --
  /**
   * Emitted exactly once, when the life moves in. `lottery` is the outcome id; `loan` is null without
   * the LAPO loan. `lga`, `via` and `own` are present together, only when a local government was chosen.
   */
  'life.started': {
    body: Look['body']
    traits: TraitId[]
    dream: DreamId
    lottery: LotteryId
    /** The rented home, or null for a life that lives in its own starter house. */
    house: StartHomeId | null
    look: Look
    loan: { principal: number; weekly: number; owed: number } | null
    /** Weekly rent of the chosen home; 0 in the own house. */
    rent: number
    startCash: number
    lga?: LgaId
    via?: 'device' | 'manual'
    /** True: the life lives in its own house (no rented home was chosen). */
    own?: boolean
  }

  // -- goals --
  /** `cash` is 0 when the reward could not be credited. */
  'goal.completed': { id: StarterGoalId; cash: number; stars: number }
  'wish.granted': { id: WishId; stars: number }
  'perk.bought': { id: PerkId; cost: number }
  'dream.completed': { id: DreamId }
  /** Stars another system awards (mission set bonuses, the stamp card, a referral). goals.js adds at most 50 per grant. */
  'stars.granted': { amount: number; reason: string }

  // -- social --
  /** A "Say Hello" to an NPC finished. */
  'npc.greeted': { npc: NpcId }
  /** Any finished NPC interaction, and a finished family call (`npc` is then the family member id, action 'call'). */
  'npc.interacted': { npc: string; action: string; success: boolean }
  /** `npc: true` — closeness reached the Friend tier; `npc: false` — a friendship between players was made. */
  'friend.made': { id: string; npc: boolean }
  /** `tier` is 'bae' when a Bae was set. */
  'relationship.changed': { id: string; value: number; tier: TierId | 'bae' }
  'transfer.sent': { to: string; amount: number }
  'transfer.received': { from: string; amount: number }

  // -- civic --
  /** One gem found: `found` of `total` today. `prize` is always 0 here (the prize is paid by the claim). */
  'gem.found': { prize: 0; found: number; total: number; venue: VenueId }
  'hunt.claimed': { prize: number }
  'candidacy.declared': { fee: number }
  'vote.cast': Record<string, never>
  'ad.bought': { kind: 'billboard' | 'sea'; slot: string; price: number }
  'radio.shoutout': { venue: VenueId; price: number }

  // -- missions --
  /** A mission's progress reached its count. */
  'mission.completed': { id: MissionId; scope: 'daily' | 'weekly' }
  'mission.claimed': { id: MissionId; scope: 'daily' | 'weekly'; cash: number }
  /** The first paid activity of a Lagos day (feeds the weekly "paid on four days" mission). */
  'work.day': Record<string, never>

  // -- events --
  /** An activity finished at a venue while a calendar event was on there; once per occurrence. */
  'event.attended': { id: string; venue: string }
  'event.sprayed': { id: string; amount: number }

  // -- growth --
  /** A finished table game that counts for missions. `paid` is the naira credited (0 when none). */
  'table.played': { game: string; won: boolean; human: boolean; paid: number; chessWin: boolean; wordSolved: boolean }

  // -- business --
  /** This life opened a shop. */
  'business.opened': { city: string; venue: string }
  /** One unit its shop sold, told when the takings are collected (at most SALES_COUNTED_PER_COLLECT per collection). */
  'business.sale': Record<string, never>
  /** This life bought something at another player's shop. */
  'business.bought': { amount: number }
}

export type EngineEvent = keyof EngineEventMap

/**
 * Events a system listens to that nothing emits.
 * INCONSISTENT: goals.js registers 'friend.best' (goals.js:289, 310) but no system emits it;
 * best friends are in practice counted from 'relationship.changed' { tier: 'paddy' | 'bae' }.
 */
export type UnemittedListenedEvent = 'friend.best'

/** A listener in a system's `on` table. `data` should be read defensively: tests and other owners may emit partial data. */
export type EventListener<E extends EngineEvent | CampusEngineEvent = EngineEvent> = (state: LifeState, data: (EngineEventMap & CampusEventMap)[E], ctx: LifeContext) => void

// ---- modifiers ----------------------------------------------------------------------------

/** Data passed with the travel modifier keys that concern one quoted trip. */
export interface TripModifierData {
  mode: TravelModeId
  destination: VenueId
  from: VenueId
  band: RouteBand
}

/**
 * Every key passed to `modify(state, key, base, data, ctx)`, with the type of the value being
 * folded (`base`) and the data that comes with it. Each system's modifier receives the value the
 * previous one returned, in registration order.
 */
export interface ModifierMap {
  /** Base 1 — multiplies background decay of one need. */
  'needs.decayRate': { base: number; data: { need: NeedId } }
  /** Base 1 — multiplies an XP gain. */
  'skills.xpRate': { base: number; data: { skill: SkillId } }
  /** Base `def.cost || 0` — the price of an activity. */
  'activity.cost': { base: number; data: { def: ActivityDefinition } }
  /** Base `def.reward || 0` — what an activity pays (career replaces it with the ladder pay). */
  'activity.reward': { base: number; data: { def: ActivityDefinition } }
  /** Base null — return `{ code, reason }` to veto a start. Pass an earlier veto through unchanged. */
  'activity.block': { base: Block<ActivityVetoCode> | null; data: { def: ActivityDefinition } }
  /** Base false — return true to leave an activity out of the list (it can still run). */
  'activity.hidden': { base: boolean; data: { def: ActivityDefinition } }
  /** Base null — return `{ code, reason }` to veto ANY action before its handler runs. */
  /**
   * `internal` is true when a server-only action runs with the server's authority (ctx.internal), so
   * a system can let a delivery TO the life through its own hold.
   */
  'action.block': { base: Block<ActionVetoCode> | null; data: { type: ActionType; payload: Record<string, unknown>; internal: boolean } }
  /**
   * Base: the band fare (for mode 'car': fuel).
   * INCONSISTENT: registry.js:152 documents the data as `{ mode, destination }`; travel.js:113
   * sends `{ mode, destination, from, band }`.
   */
  'travel.fare': { base: number; data: TripModifierData }
  /** Base: seconds for the band. */
  'travel.duration': { base: number; data: TripModifierData }
  /** Base: the mode's need deltas, applied on arrival — return a NEW object. */
  'travel.needCost': { base: NeedMap; data: TripModifierData }
  /**
   * Base: the five base mode ids — add 'car' to offer the own-car mode.
   * INCONSISTENT: property.js:138-139 also handles a list or a map of mode OBJECTS, which the
   * travel system never passes (dead branches).
   */
  'travel.modes': { base: TravelModeId[]; data: { destination: VenueId; from: VenueId } }
  /**
   * Base: the list price — for groceries `item.price × packs`. `kind` is set by the seller; the
   * character discounts apply to 'furniture' and 'grocery' only.
   */
  'shop.price': {
    base: number
    data:
      | { item: FurnitureDefinition; kind: 'furniture' }
      | { item: IngredientDefinition; kind: 'grocery' }
      | { item: CarDefinition; kind: 'car' }
  }
  /** Base: closeness points about to be granted. `action` is the interaction id. */
  'social.gain': { base: number; data: { id: string; npc: boolean; action: string } }
  /** Base: percent chance that a joke lands. Nothing contributes to it yet. */
  'social.success': { base: number; data: { id: string; npc: boolean; action: string } }
  /** Base PERFORMANCE_PER_SHIFT — performance gained by a completed career shift. */
  'career.performance': { base: number; data: { job: JobId; level: number } }
  /** Base true — return false to hold "Go automatically" for now (the tutorial does). */
  'career.autoCommute': { base: boolean; data: { job: JobId } }
}

export type ModifierKey = keyof ModifierMap

/** A function in a system's `modifiers` table: returns the adjusted value. */
export type Modifier<K extends ModifierKey = ModifierKey> = (
  value: ModifierMap[K]['base'],
  state: LifeState,
  data: ModifierMap[K]['data'],
  ctx: LifeContext,
) => ModifierMap[K]['base']

// ---- actions and timed actions ------------------------------------------------------------

/** A player action handler. `payload` is an untrusted plain object: validate every field. */
export type ActionHandler = (state: LifeState, payload: Record<string, unknown>, ctx: LifeContext) => ActionOutcome

/** The handler of action type `T`: its result codes are the ones `ActionMap[T]` lists. */
export type TypedActionHandler<T extends ActionType> = (
  state: LifeState,
  payload: Record<string, unknown>,
  ctx: LifeContext,
) => ActionOutcome<ActionMap[T]['ok'], ActionMap[T]['fail']>

/**
 * A server-only action: one half of a change whose other half lives in shared storage.
 * dispatch() refuses it with 'server_only' (changing nothing) unless ctx.internal === true.
 */
export interface ServerOnlyAction<T extends ActionType = ActionType> {
  serverOnly: true
  run: TypedActionHandler<T>
  /** The refusal sentence; a default one is used when absent. */
  refusal?: string
}

/** A saved timed action as it reaches a kind's sanitize: untrusted apart from the validated timing. */
export interface SavedActiveAction {
  kind: string
  id: string
  duration: number
  remaining: number
  /** The versioned, accepted multi-leg ticket of the homeward active kind. */
  ticket?: unknown
  [field: string]: unknown
}

/**
 * How one kind of timed action behaves (`active: { [kind]: handler }`).
 * `A` is the stored action of that kind.
 */
export interface ActiveKindHandler<A extends ActiveAction = ActiveAction> {
  /**
   * REQUIRED. true = this kind takes the player out of the venue they are in (they are
   * "departing": no venue room, no voice). The engine refuses to let a `moves: false` kind change
   * `state.location` when it completes.
   */
  moves: boolean
  /** Return the kind-specific fields to keep (possibly `{}`), or null when the saved action is no longer valid. */
  sanitize(value: SavedActiveAction, state: LifeState, ctx: LifeContext): Omit<A, 'kind' | 'id' | 'duration' | 'remaining'> | null
  /** Called at load (server's own save only) when sanitize returned null, so a kind that took something at the start can give it back. */
  invalidated?(state: LifeState, value: SavedActiveAction, ctx: LifeContext): void
  /** An authored interactive action waits for input instead of consuming its legacy timer. */
  waitsForInput?(state: LifeState, active: A, ctx: LifeContext): boolean
  /** Called on every settlement while running, with the seconds just elapsed (never more than what remained). */
  tick?(state: LifeState, active: A, elapsedSeconds: number, ctx: LifeContext): void
  /** The action ran to its end. `state.activeAction` is already null. */
  complete(state: LifeState, active: A, ctx: LifeContext): void
  /** The player cancels. Return a failure to refuse the cancel; anything falsy lets it go through. */
  cancel?(state: LifeState, active: A, ctx: LifeContext): ActionFailure<'not_cancellable' | 'no_cancel'> | null | undefined | void
}

// ---- the system definition ----------------------------------------------------------------

/** An activity a system attaches to a venue spot: `where` is required. */
export type AttachedActivity = ActivityDefinition & Required<Pick<ActivityDefinition, 'where'>>

/** The raw saved object handed to sanitize(): already migrated to the current `v`, otherwise untrusted. */
export type SavedInput = Record<string, unknown>

/**
 * A system: the default export of every file in src/game/systems/, registered in a fixed order
 * by systems/index.js.
 */
export interface SystemDefinition<Id extends string = SystemId> {
  /** Unique; also the key of this system's view in LifeView. */
  id: Id
  /** Every top-level state key this system writes. ENFORCED: an undeclared key throws. */
  stateKeys: readonly string[]
  /**
   * Rebuild this system's keys from untrusted saved input. `state` is the fresh state being built:
   * systems earlier in the order have already filled their keys, later ones have not.
   */
  sanitize(input: SavedInput, state: LifeState, ctx: LifeContext): void
  /** Keyed by the `type` sent to POST /api/action. */
  actions?: { [T in ActionType]?: TypedActionHandler<T> | ServerOnlyAction<T> }
  /** Called on every settlement with the elapsed seconds (possibly days' worth). ctx.now is the END of the interval. */
  advance?(state: LifeState, dtSeconds: number, ctx: LifeContext): void
  /** Derived, display-only data returned as `view[id]`. Must not mutate state. */
  view?(state: LifeState, ctx: LifeContext): Id extends keyof LifeView ? LifeView[Id] : unknown
  /** Event listeners. Listeners must tolerate events they do not know. */
  on?: { [E in EngineEvent]?: EventListener<E> } & { [E in CampusEngineEvent]?: EventListener<E> } & { [E in UnemittedListenedEvent]?: (state: LifeState, data: Record<string, unknown>, ctx: LifeContext) => void }
  /** Modifiers this system contributes. */
  modifiers?: { [K in ModifierKey]?: Modifier<K> }
  /** Static activity definitions attached to venue spots. */
  activities?: AttachedActivity[]
  activitiesFor?: (cityId: string) => AttachedActivity[]
  /** Handlers for the timed-action kinds this system owns. */
  active?: { [K in ActiveKind]?: ActiveKindHandler<Extract<ActiveAction, { kind: K }>> }
}

// ---- runtime lists (checked against the engine's source by engine.test.ts) -------------------

/** Every event name emitted anywhere in the engine, sorted. */
export const EVENT_NAMES = [
  'action.cancelled', 'activity.completed', 'activity.outcome', 'activity.started', 'activity.unpaid', 'ad.bought',
  'business.bought', 'business.opened', 'business.sale', 'candidacy.declared', 'car.bought', 'car.sold', 'city.changed', 'deposit.closed', 'deposit.opened', 'dream.completed',
  'event.attended', 'event.sprayed', 'friend.made', 'gem.found', 'goal.completed', 'health.treat', 'home.owned', 'house.moved',
  'house.styled', 'house.upgrade-started', 'house.upgraded', 'hunt.claimed', 'illness.cured', 'illness.started', 'item.bought',
  'item.sold', 'job.applied', 'job.quit', 'lga.changed', 'life.started', 'loan.missed', 'loan.paid', 'meal.eaten',
  'mission.claimed', 'mission.completed', 'notice.posted', 'npc.greeted', 'npc.interacted', 'perk.bought', 'promotion',
  'radio.shoutout', 'relationship.changed', 'rent.due', 'rent.missed', 'rent.paid', 'roadside.offered', 'roadside.resolved',
  'shift.completed', 'skill.levelup', 'stars.granted', 'startup.funded', 'table.played', 'transfer.received', 'transfer.sent',
  'travel.arrived', 'venue.visited', 'vote.cast', 'wallet.changed', 'weather.soaked', 'wish.granted', 'work.day',
] as const satisfies readonly EngineEvent[]

/** Events emitted through a name held in content rather than a literal: ACTIVITY_OUTCOMES[…].success.event. */
export const CONTENT_EVENT_NAMES = ['startup.funded'] as const satisfies readonly EngineEvent[]

/** Events some system listens to although nothing emits them. */
export const UNEMITTED_LISTENED_EVENTS = ['friend.best'] as const satisfies readonly UnemittedListenedEvent[]

/** Every modifier key asked anywhere in the engine, sorted. */
export const MODIFIER_KEYS = [
  'action.block', 'activity.block', 'activity.cost', 'activity.hidden', 'activity.reward', 'career.autoCommute',
  'career.performance', 'needs.decayRate', 'shop.price', 'skills.xpRate', 'social.gain', 'social.success',
  'travel.duration', 'travel.fare', 'travel.modes', 'travel.needCost',
] as const satisfies readonly ModifierKey[]
