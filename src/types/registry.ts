/**
 * The system contract of the rules engine, as types. The prose contract is the header of
 * src/game/registry.js; this file is its shape: what a system file default-exports, the events
 * systems emit to one another, and the modifier keys they fold values through.
 */
import type { ActionType, ActionVetoCode, ActivityVetoCode } from './actions.ts'
import type {
  ActivityDefinition, Block, CarDefinition, FurnitureDefinition, IngredientDefinition, ResolvedActivity, RouteBand,
} from './content.ts'
import type {
  ActionFailure, ActionOutcome, ActiveAction, ActiveKind, ActivityId, CarId, DepositTermId, DreamId, FurnitureId, HouseId,
  IllnessCause, ItemId, JobId, LifeContext, LifeState, Look, LotteryId, NeedId, NeedMap, NpcId, PerkId, RoadsideEventId,
  SkillId, StarterGoalId, StartHomeId, SystemId, TierId, TraitId, TravelModeId, VenueId, WishId,
} from './life.ts'
import type { LifeView } from './view.ts'

// ---- events -------------------------------------------------------------------------------

/**
 * `kind` of a line posted to the Updates feed through 'notice.posted':
 *   career 'promotion' · health 'illness' | 'recovered' · economy 'rent-due' | 'rent' |
 *   'rent-missed' | 'loan' | 'loan-missed' · civic 'gov'.
 * (The social system also writes 'transfer' and 'bae' notices directly, without the event.)
 */
export type NoticeKind = 'promotion' | 'illness' | 'recovered' | 'rent-due' | 'rent' | 'rent-missed' | 'loan' | 'loan-missed' | 'gov'

/**
 * Every event emitted through `emit(state, '<name>', data, ctx)` anywhere in src/game, with the
 * data its emitter passes. Listeners always receive an object (anything else becomes `{}`), run in
 * registration order, may mutate state and may emit further events (at most 8 deep).
 */
export interface EngineEventMap {
  // -- foundation (activities, core, wallet, skills) --
  'activity.started': { id: ActivityId; def: ResolvedActivity }
  /** `tags` is `def.tags || []`; `choice` is the chosen option id or null. */
  'activity.completed': { id: ActivityId; def: ResolvedActivity; tags: string[]; choice: string | null }
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
  'travel.arrived': { venue: VenueId; from: VenueId; mode: TravelModeId | null; [extra: string]: unknown }

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
   * (`emit(state, outcome.event, …)`, travel.js:273; events.js:122), not by a literal name.
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

  // -- property --
  /** `id` is the new house, `from` the old one, `cost` the move-in fee paid. */
  'house.moved': { id: HouseId; from: HouseId; cost: number }
  'car.bought': { id: CarId; price: number }
  'car.sold': { id: CarId; refund: number }

  // -- home --
  /** `id` and `item` are the same catalogue id; `count` (units delivered) only for groceries. */
  'item.bought': { id: FurnitureId | ItemId; item: FurnitureId | ItemId; price: number; kind: 'furniture' | 'grocery'; count?: number }
  /** INCONSISTENT: the header of home.js (line 48) documents `{ id, refund }`; the emitter also sends `item` (home.js:202). */
  'item.sold': { id: FurnitureId; item: FurnitureId; refund: number }
  /** `id` is the recipe id, or the activity id for a ported food activity eaten at home. */
  'meal.eaten': { id: string; source: 'home' }

  // -- onboarding --
  /** Emitted exactly once, when the life moves in. `lottery` is the outcome id; `loan` is null without the LAPO loan. */
  'life.started': {
    body: Look['body']
    traits: TraitId[]
    dream: DreamId
    lottery: LotteryId
    house: StartHomeId
    look: Look
    loan: { principal: number; weekly: number; owed: number } | null
    /** Weekly rent of the chosen home. */
    rent: number
    startCash: number
  }

  // -- goals --
  /** `cash` is 0 when the reward could not be credited. */
  'goal.completed': { id: StarterGoalId; cash: number; stars: number }
  'wish.granted': { id: WishId; stars: number }
  'perk.bought': { id: PerkId; cost: number }
  'dream.completed': { id: DreamId }

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
}

export type EngineEvent = keyof EngineEventMap

/**
 * Events a system listens to that nothing emits.
 * INCONSISTENT: goals.js registers 'friend.best' (goals.js:263, 281) but no system emits it;
 * best friends are in practice counted from 'relationship.changed' { tier: 'paddy' | 'bae' }.
 */
export type UnemittedListenedEvent = 'friend.best'

/** A listener in a system's `on` table. `data` should be read defensively: tests and other owners may emit partial data. */
export type EventListener<E extends EngineEvent = EngineEvent> = (state: LifeState, data: EngineEventMap[E], ctx: LifeContext) => void

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
  'action.block': { base: Block<ActionVetoCode> | null; data: { type: ActionType; payload: Record<string, unknown> } }
  /**
   * Base: the band fare (for mode 'car': fuel).
   * INCONSISTENT: registry.js:152 documents the data as `{ mode, destination }`; travel.js:108
   * sends `{ mode, destination, from, band }`.
   */
  'travel.fare': { base: number; data: TripModifierData }
  /** Base: seconds for the band. */
  'travel.duration': { base: number; data: TripModifierData }
  /** Base: the mode's need deltas, applied on arrival — return a NEW object. */
  'travel.needCost': { base: NeedMap; data: TripModifierData }
  /**
   * Base: the five base mode ids — add 'car' to offer the own-car mode.
   * INCONSISTENT: property.js:133-136 also handles a list or a map of mode OBJECTS, which the
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

/**
 * A server-only action: one half of a change whose other half lives in shared storage.
 * dispatch() refuses it with 'server_only' (changing nothing) unless ctx.internal === true.
 */
export interface ServerOnlyAction {
  serverOnly: true
  run: ActionHandler
  /** The refusal sentence; a default one is used when absent. */
  refusal?: string
}

/** A saved timed action as it reaches a kind's sanitize: untrusted apart from the validated timing. */
export interface SavedActiveAction {
  kind: string
  id: string
  duration: number
  remaining: number
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
  /** Called on every settlement while running, with the seconds just elapsed (never more than what remained). */
  tick?(state: LifeState, active: A, elapsedSeconds: number, ctx: LifeContext): void
  /** The action ran to its end. `state.activeAction` is already null. */
  complete(state: LifeState, active: A, ctx: LifeContext): void
  /** The player cancels. Return a failure to refuse the cancel; anything falsy lets it go through. */
  cancel?(state: LifeState, active: A, ctx: LifeContext): ActionFailure | null | undefined | void
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
  actions?: Record<string, ActionHandler | ServerOnlyAction>
  /** Called on every settlement with the elapsed seconds (possibly days' worth). ctx.now is the END of the interval. */
  advance?(state: LifeState, dtSeconds: number, ctx: LifeContext): void
  /** Derived, display-only data returned as `view[id]`. Must not mutate state. */
  view?(state: LifeState, ctx: LifeContext): Id extends keyof LifeView ? LifeView[Id] : unknown
  /** Event listeners. Listeners must tolerate events they do not know. */
  on?: { [E in EngineEvent]?: EventListener<E> } & { [E in UnemittedListenedEvent]?: (state: LifeState, data: Record<string, unknown>, ctx: LifeContext) => void }
  /** Modifiers this system contributes. */
  modifiers?: { [K in ModifierKey]?: Modifier<K> }
  /** Static activity definitions attached to venue spots. */
  activities?: AttachedActivity[]
  /** Handlers for the timed-action kinds this system owns. */
  active?: { [K in ActiveKind]?: ActiveKindHandler<Extract<ActiveAction, { kind: K }>> }
}

// ---- runtime lists (checked against the engine's source by engine.test.ts) -------------------

/** Every event name emitted anywhere in the engine, sorted. */
export const EVENT_NAMES = [
  'action.cancelled', 'activity.completed', 'activity.outcome', 'activity.started', 'activity.unpaid', 'ad.bought',
  'candidacy.declared', 'car.bought', 'car.sold', 'deposit.closed', 'deposit.opened', 'dream.completed', 'friend.made',
  'gem.found', 'goal.completed', 'health.treat', 'house.moved', 'hunt.claimed', 'illness.cured', 'illness.started',
  'item.bought', 'item.sold', 'job.applied', 'job.quit', 'life.started', 'loan.missed', 'loan.paid', 'meal.eaten',
  'notice.posted', 'npc.greeted', 'npc.interacted', 'perk.bought', 'promotion', 'radio.shoutout', 'relationship.changed',
  'rent.due', 'rent.missed', 'rent.paid', 'roadside.offered', 'roadside.resolved', 'shift.completed', 'skill.levelup',
  'startup.funded', 'transfer.received', 'transfer.sent', 'travel.arrived', 'venue.visited', 'vote.cast', 'wallet.changed',
  'weather.soaked', 'wish.granted',
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
