/**
 * Every action the rules engine accepts through `dispatch(state, { type, payload }, ctx)`.
 *
 * Each `ActionMap` entry is read off the handler registered under that type in
 * src/game/systems/*.js:
 *   payload     the fields the handler reads. It is UNTRUSTED input on the server: these types
 *               describe what a correct client sends, the handler still validates every field.
 *   ok / fail   every code the handler (or a helper it calls) passes to ok() / fail().
 *   serverOnly  declared `{ serverOnly: true, run }`: refused with 'server_only' unless
 *               ctx.internal === true (only the route host's ctx.act sets it).
 *
 * Codes dispatch() itself adds before a handler runs are not repeated in every entry: see
 * `DispatchRefusalCode` and `ActionCode`.
 */
import type {
  ActionFailure, ActionSuccess, ActivityId, CarId, WorldCityId, CityLinkMode, DepositTermId, DreamId, FamilyId, FurnitureId, HouseId,
  HouseStyle, HouseTierId, ItemId, JobId, LgaId, Look, MissionId, PerkId, PlayerPublicId, PlotAddress, SpotId, StartHomeId, TraitId,
  TravelModeId, VenueId, WardrobeKind,
} from './life.ts'
import { CAMPUS_ACTION_TYPES } from './campus.ts'
import type { StoryActionMap } from './stories.ts'
import type { LandPayPayload } from './land.ts'
import type { TierId } from './politics.ts'
import type { CampusActionMap, CampusActivityVetoCode, GuestCampusActionType } from './campus.ts'

// ---- shared code groups -------------------------------------------------------------------

/** Why an object cannot be placed (home-layout.js checkPlacement, and the pre-check in systems/home.js). */
export type PlacementCode = 'invalid_position' | 'out_of_bounds' | 'blocked' | 'occupied'

/** Refusals produced by the activity engine itself (activities.js start + blockReason). */
export type ActivityEngineBlockCode =
  | 'unavailable' | 'closed' | 'job_required' | 'skill_required' | 'needs_required' | 'missing_items'
  | 'balance_limit' | 'insufficient_funds'

/**
 * Refusals contributed through the 'activity.block' modifier:
 *   travel   cooldown · gig_limit · not_needed
 *   career   balance_limit · shift_done · day_off · working · no_job (the last two cannot be seen on a
 *            start — 'busy' wins — but 'working' does appear on the running shift's own card)
 *   health   not_sick
 *   home     furniture_required · missing_items
 *   goals    already_funded · skill_required
 *   social   npc_daily_limit, not_now
 *   campus   student_required · daily_limit (the 'unilag-volunteer' activity only; games.js)
 */
export type ActivityVetoCode =
  | 'cooldown' | 'gig_limit' | 'not_needed' | 'balance_limit' | 'shift_done' | 'day_off' | 'working' | 'no_job'
  | 'not_sick' | 'furniture_required' | 'missing_items' | 'already_funded' | 'skill_required' | 'npc_daily_limit' | 'not_now'
  | CampusActivityVetoCode

/** Every code an activity card's `blocked` (and a refused 'activity' start) can carry. */
export type ActivityBlockCode = ActivityEngineBlockCode | ActivityVetoCode

/**
 * Why a trip cannot start (travel.js travelBlock). 'campus_lagos_only': the destination is 'unilag' and the life is in
 * another city (a venue with `cities`; any other such venue would answer 'invalid_travel').
 */
export type TravelBlockCode =
  | 'coming_soon' | 'invalid_travel' | 'already_here' | 'travel_mode_unavailable' | 'closed' | 'insufficient_funds' | 'campus_lagos_only'

/** Why a gift cannot be sent (social.js transferBlock). */
export type TransferBlockCode =
  | 'invalid_transfer' | 'amount_too_small' | 'amount_too_large' | 'earn_first' | 'gift_exceeds_earned'
  | 'daily_transfer_limit' | 'insufficient_funds'

/** The unmet check of civic eligibility (civic.js civicEligibility → firstUnmet). */
export type CivicCheckCode = 'too_new' | 'insufficient_funds' | 'work_days' | 'wrong_place' | 'not_main_home'

/** Why a trip to another city cannot start (estate.js relocateBlock). */
export type RelocateBlockCode = 'invalid_city' | 'no_route' | 'city_not_open' | 'route_not_open' | 'insufficient_funds' | 'ride_debt' | 'credit_not_offered' | 'settle_required'
/** Why 'travel.skip' is refused: no trip, a trip about to end, a trip inside the city with too little left, a price that rose above the one shown, not enough cash. */
export type TripSkipCode = 'not_travelling' | 'almost_there' | 'too_short' | 'price_changed' | 'insufficient_funds' | 'ride_debt'

/**
 * The settle-in choices 'onboarding.home' takes besides where to live. `via` records how the local
 * government was found ('device' only when sent exactly so, otherwise 'manual'); `stay: true` moves
 * in without leaving the venue the Sim is in (and may run while a timed action does).
 */
export interface SettleInOptions {
  via?: 'device' | 'manual'
  stay?: boolean
}

/** An empty payload. Extra keys are ignored by every handler. */
export type NoPayload = Record<string, never>

/** Position of a furniture object: tile and quarter turns. `rot` defaults to 0 when omitted. */
export interface PlacementPayload {
  floor?: number
  x: number
  y: number
  /**
   * INCONSISTENT: read as `payload?.rot ?? 0` for a move as well (home.js:148), so a
   * 'home.furniture-move' sent without `rot` turns the object back to rotation 0 instead of keeping it.
   */
  rot?: number
}

// ---- social.server operations -------------------------------------------------------------

/**
 * The operations of the server-only 'social.server' action, keyed by `payload.op`
 * (social.js serverOps). Each is run through ctx.act by server/social/service.ts after the
 * server has checked the other player.
 */
export interface SocialServerOpMap {
  /**
   * Would a gift be allowed right now?
   * INCONSISTENT: documented "Never mutates" (social.js:143) but a refusal goes through fail(),
   * which overwrites state.message.
   */
  'transfer-check': { payload: { to: PlayerPublicId; amount: number }; ok: 'allowed'; fail: TransferBlockCode }
  /** Debit a gift; `name` is the recipient's display name for the ledger line. */
  'transfer-out': { payload: { to: PlayerPublicId; amount: number; name?: string }; ok: 'sent'; fail: TransferBlockCode }
  /** Credit a gift, or return one that could not be delivered (`refund: true`). */
  'transfer-in': { payload: { from: PlayerPublicId; amount: number; name?: string; refund?: boolean }; ok: 'received'; fail: 'invalid_transfer' | 'balance_limit' }
  friend: { payload: { id: PlayerPublicId; name?: string }; ok: 'friend_made' | 'already_friends'; fail: 'invalid_friend' }
  /** Unfriend or block: the friendship and any Bae status end; closeness is kept. Never fails. */
  unfriend: { payload: { id: PlayerPublicId }; ok: 'unfriended'; fail: never }
  /** 'flopped' is a SUCCESS code: the interaction counted, the joke did not land. */
  interact: { payload: { id: PlayerPublicId; action: 'hello' | 'gist' | 'joke' | 'shade'; name?: string }; ok: 'interacted' | 'flopped'; fail: 'invalid_interaction' | 'daily_limit' }
  'bae-check': { payload: { id: PlayerPublicId }; ok: 'allowed'; fail: 'already_have_bae' | 'closeness_required' }
  bae: { payload: { id: PlayerPublicId; name?: string }; ok: 'bae'; fail: 'invalid_bae' | 'already_have_bae' }
  /** 'no_bae' (nothing to end, or `id` names someone else) is also a success. */
  'bae-end': { payload: { id?: PlayerPublicId }; ok: 'no_bae' | 'ended'; fail: never }
  /**
   * Stand beside a friend who pinged (server/social/ping.ts): free, at a public venue of `city`. In the life's own city the
   * life is placed there ('joined', or 'here' when it already stands there); in another open city it arrives there exactly
   * as at the end of a trip, with no fare ('joined_city'). `name` is the friend's display name, for the message line.
   */
  join: { payload: { city: string; venue: string; name?: string }; ok: 'joined' | 'here' | 'joined_city'; fail: 'busy' | 'onboarding_required' | 'settle_required' | 'invalid_place' | 'city_not_open' | 'no_route' }
}

export type SocialServerOp = keyof SocialServerOpMap

/** The payload of 'social.server': one operation's fields plus its `op`. */
export type SocialServerPayload = { [Op in SocialServerOp]: { op: Op } & SocialServerOpMap[Op]['payload'] }[SocialServerOp]

/** One item of city news handed to 'civic.news'. `id` must match /^[a-z]+-[a-z0-9-]{1,40}$/. */
export interface CivicNewsItem {
  id: string
  title: string
  text?: string
  /** Server ms the notice was made; news older than the life itself is marked seen, not posted. */
  at: number
}

// ---- the action table ---------------------------------------------------------------------

/** The campus actions (`unilag.*` and 'campus-shuttle', registered after growth) are declared in campus.ts CampusActionMap. */
export interface ActionMap extends CampusActionMap, StoryActionMap {
  'estate.land-pay': { payload: LandPayPayload; ok: 'land_paid'; fail: 'busy' | 'not_owned_home' | 'land_price_changed' | 'insufficient_funds'; serverOnly: true }
  'street.place': { payload: { from: string; to: string }; ok: 'street_placed'; fail: 'busy' | 'street_location_changed' | 'invalid_street_transition'; serverOnly: true }
  // -- core --
  /**
   * Cancel the running timed action.
   * INCONSISTENT: 'idle' is returned without a reason (core.js:74), unlike every other failure.
   * 'not_cancellable' comes from the activity kind's cancel hook, 'no_cancel' from the intercity
   * kind's (a trip between cities cannot be cancelled once the fare is paid).
   */
  cancel: { payload: NoPayload; ok: 'cancelled'; fail: 'idle' | 'not_cancellable' | 'no_cancel' }
  /** SERVER ONLY: the operator's credit or debit, one ledger line ("Admin credit: …" / "Admin debit: …"). A debit takes at most the balance. */
  'wallet.admin': { payload: { op: 'credit' | 'debit'; amount: number; reason: string; /** A credit the recipient may gift and spend at players' stalls without the gift restrictions (social.free). */ unrestricted?: boolean }; ok: 'credited' | 'debited'; fail: 'invalid_amount' | 'balance_limit'; serverOnly: true }
  /** SERVER ONLY: the launch bonus (server/bonus): one ledger line of its own, a faucet that is never counted as earned from work. */
  'wallet.bonus': { payload: { amount: number; reason: string }; ok: 'credited'; fail: 'invalid_amount' | 'balance_limit'; serverOnly: true }
  /** SERVER ONLY: set one need (0-100), or lift every need below 80 to 80. */
  'needs.admin': { payload: { op: 'set' | 'heal'; need?: string; value?: number }; ok: 'set' | 'healed'; fail: 'invalid_need'; serverOnly: true }
  /** SERVER ONLY: stand the player at the city's arrival venue or at home, ending a stuck timed action. */
  'activity.admin': { payload: { to: 'arrival' | 'home' }; ok: 'moved'; fail: 'travelling' | 'invalid_place'; serverOnly: true }

  // -- career --
  /** Apply while unemployed. 'already_employed' (same job) is a success that changes nothing. Never switches jobs. */
  'apply-job': { payload: { id: JobId }; ok: 'applied' | 'already_employed' | 'transferred'; fail: 'busy' | 'invalid_job' | 'workplace_unavailable' | 'confirm_switch' | 'transfer_limit' }
  /** The confirmed switch: leave the current job for another. */
  'career.switch': { payload: { id: JobId }; ok: 'switched' | 'already_employed'; fail: 'busy' | 'invalid_job' | 'workplace_unavailable' | 'no_job' }
  'career.quit': { payload: NoPayload; ok: 'quit'; fail: 'no_job' | 'busy' }
  /** Toggle "Go automatically". */
  'career.auto': { payload: { on: boolean }; ok: 'auto_set'; fail: 'invalid_setting' }
  /** Answer the work dilemma waiting after a shift (src/game/dilemmas.ts). Refused with 'dilemmas_off' while the dilemma kit is not installed. */
  'career.dilemma': { payload: { choice: string }; ok: 'resolved' | 'went_badly'; fail: 'dilemmas_off' | 'no_dilemma' | 'invalid_choice' }
  'career.teach': {
    payload: { generation: number; revision: number; stage: import('../game/living-world/teaching-state.ts').TeachingPracticeStage; choice: string }
    ok: 'answered' | 'retry' | 'shift_completed'
    fail: import('../game/living-world/teaching-practice.ts').TeachingPracticeCode | 'no_teaching_shift' | 'generation_conflict'
  }

  // -- activities --
  /** Start an activity offered at the current spot. `choice` is required when the activity has `choices`. */
  activity: { payload: { id: ActivityId; choice?: string }; ok: 'started'; fail: 'busy' | 'choice_required' | ActivityBlockCode }
  /** Move to another spot in the current venue. */
  spot: { payload: { id: SpotId }; ok: 'selected'; fail: 'busy' | 'invalid_spot' }

  // -- travel --
  /** Start a trip; the fare is charged at departure and is not refunded by a cancel. A guest cannot go Home ('settle_required', a veto). */
  travel: { payload: { id: VenueId; mode: TravelModeId }; ok: 'started'; fail: 'busy' | TravelBlockCode }
  /** Answer the pending roadside event (`view.travel.event`). Allowed while a timed action runs. */
  'world.roadside': { payload: { choice: string }; ok: 'resolved'; fail: 'no_event' | 'invalid_choice' | 'insufficient_funds' }
  /** Pay to arrive now from a trip between venues or between cities. `quote` is the price the player was shown (`view.travel.skip.fee`). */
  'travel.skip': { payload: { quote?: number }; ok: 'skipped'; fail: TripSkipCode }
  /** Pay what is owed for a ride home taken on credit, as far as cash goes (src/game/relief.ts). */
  'travel.repay-ride': { payload: NoPayload; ok: 'repaid'; fail: 'no_debt' | 'no_cash' }

  // -- economy --
  /** 'week' pays one instalment early; 'all' clears the balance ('loan_cleared' whenever nothing is left). */
  'economy.pay-loan': { payload: { mode: 'week' | 'all' }; ok: 'loan_paid' | 'loan_cleared'; fail: 'no_loan' | 'invalid_payment' | 'insufficient_funds' }
  /** Pay rent arrears now. */
  'economy.pay-rent': { payload: NoPayload; ok: 'rent_paid'; fail: 'nothing_due' | 'insufficient_funds' }
  /** `amount` is whole naira from DEPOSIT_MIN to DEPOSIT_MAX. 'deposit_limit' covers both "3 already open" and an exhausted id counter. */
  'economy.open-deposit': { payload: { amount: number; term: DepositTermId }; ok: 'deposit_opened'; fail: 'invalid_term' | 'invalid_amount' | 'rent_arrears' | 'deposit_limit' | 'deposit_cap' | 'insufficient_funds' }
  /** Early withdrawal (principal only), or collecting a matured deposit. */
  'economy.close-deposit': { payload: { id: string }; ok: 'deposit_closed'; fail: 'no_deposit' | 'balance_limit' }

  // -- property --
  /** Rent a house. Moving to the tier already rented is 'already_home' unless the life currently lives in its own house. */
  'property.house-move': { payload: { id: HouseId }; ok: 'moved'; fail: 'busy' | 'invalid_house' | 'already_home' | 'insufficient_funds' }
  'property.car-buy': { payload: { id: CarId }; ok: 'bought'; fail: 'busy' | 'invalid_car' | 'already_owned' | 'insufficient_funds' }
  /** Choose which owned car to drive. */
  'property.car-use': { payload: { id: CarId }; ok: 'selected'; fail: 'busy' | 'not_owned' }
  'property.car-sell': { payload: { id: CarId }; ok: 'sold'; fail: 'busy' | 'not_owned' | 'balance_limit' }

  // -- estate --
  /**
   * Confirm or change the local government. Confirming the game's guess ('lga_confirmed') or a first
   * choice is free and immediate; later changes wait out LGA_RULES.changeCooldownDays and may cost a
   * levy for dearer land. 'unchanged' (already confirmed there) is a success.
   */
  'estate.set-lga': { payload: { lga: LgaId; via?: 'device' | 'manual'; home?: 'buy' | 'main' }; ok: 'lga_set' | 'lga_confirmed' | 'unchanged' | 'home_bought' | 'home_moved'; fail: 'busy' | 'settle_required' | 'invalid_lga' | 'lga_cooldown' | 'upgrade_running' | 'insufficient_funds' | 'choice_required' | 'home_owned' | 'home_cooldown' | 'ride_debt' }
  /** SERVER ONLY: record the plot the server allocated (server/world/service.ts). 'unchanged' (the same plot again) is a success. */
  'estate.assign': { payload: PlotAddress; ok: 'assigned' | 'unchanged'; fail: 'no_place' | 'invalid_plot'; serverOnly: true }
  /** SERVER ONLY: the server freed the plot left behind (`state.estate.old`). Succeeds whether or not the address matched. */
  'estate.released': { payload: PlotAddress; ok: 'released'; fail: never; serverOnly: true }
  /** Change the look; fields left out keep their value. A priced option is charged each time a field is changed to it. */
  'estate.style': { payload: { style: Partial<HouseStyle> }; ok: 'styled' | 'unchanged'; fail: 'invalid_style' | 'insufficient_funds' }
  /** Pay for a bigger house; it is built over the tier's buildSeconds of server time. One at a time, upwards only. */
  'estate.upgrade': { payload: { to: HouseTierId }; ok: 'upgrade_started'; fail: 'onboarding_required' | 'invalid_tier' | 'upgrade_running' | 'not_an_upgrade' | 'insufficient_funds' }
  /** Live in your own house (free; weekly rent stops). Back to a rented home is 'property.house-move'. */
  'estate.move-in': { payload: NoPayload; ok: 'moved_in'; fail: 'busy' | 'already_home' | 'rent_arrears' }
  /** Leave for another city along a CITY_LINKS link (timed action kind 'intercity'). Refused while the destination is not open. */
  'estate.relocate': { payload: { to: WorldCityId; mode: CityLinkMode; credit?: boolean }; ok: 'departed'; fail: 'busy' | RelocateBlockCode }
  /** Accept the current authoritative quotation to borrow one bounded, continuous route to the unchanged main home. */
  'homeward.accept': { payload: { quote: string }; ok: 'departed'; fail: 'busy' | 'settle_required' | 'credit_not_offered' | 'ride_debt' | 'insufficient_funds' | 'quote_changed' }
  /** A visitor's room at a guest house: LODGING.fee is charged and Energy and Hygiene are restored. Refused for a life with a home in this city. */
  'estate.lodge': { payload: NoPayload; ok: 'rested'; fail: 'settle_required' | 'has_home' | 'busy' | 'rested' | 'insufficient_funds' }
  /** Name the city the life is in its primary home. It must hold a house here. */
  'estate.make-home': { payload: NoPayload; ok: 'home_set' | 'unchanged'; fail: 'busy' | 'no_place' | 'home_cooldown' | 'ride_debt' }
  /** The device matched the main home's local government (the position never leaves it): record `{ lga, at }`. Refused unless `lga` is the main home's. */
  'estate.confirm-residence': { payload: { lga: LgaId; ok: true }; ok: 'residence_confirmed'; fail: 'no_home' | 'not_main_home' | 'not_confirmed' }
  /** Switch the location-confirmed badge off: the stored confirmation is deleted. */
  'estate.unconfirm-residence': { payload: NoPayload; ok: 'residence_removed' | 'unchanged'; fail: never }

  // -- home --
  /** Own front door; no travel fare or arrival reward. */
  'home.door': { payload: { direction: 'outside' | 'inside' }; ok: 'stepped_out' | 'stepped_in'; fail: 'busy' | 'not_at_door' | 'invalid_direction' }
  /** At home only; charged when placed. */
  'home.furniture-buy': { payload: { item: FurnitureId } & PlacementPayload; ok: 'bought'; fail: 'busy' | 'not_home' | 'invalid_item' | 'room_full' | 'insufficient_funds' | PlacementCode }
  /** `id` is the placed object's id (`f<n>`). */
  'home.furniture-move': { payload: { id: string } & PlacementPayload; ok: 'moved'; fail: 'busy' | 'not_home' | 'invalid_object' | PlacementCode }
  /** Sell a placed object (`id`), or one from storage (`item`). A matching `id` wins when both are sent. */
  'home.furniture-sell': { payload: { id: string } | { item: FurnitureId }; ok: 'sold'; fail: 'busy' | 'not_home' | 'invalid_object' | 'balance_limit' }
  'home.furniture-store': { payload: { id: string }; ok: 'stored'; fail: 'busy' | 'not_home' | 'invalid_object' | 'storage_full' }
  /** Place an object from storage (free). */
  'home.furniture-place': { payload: { item: FurnitureId } & PlacementPayload; ok: 'placed'; fail: 'busy' | 'not_home' | 'not_in_storage' | 'room_full' | PlacementCode }
  /** Buy ingredient packs anywhere (no busy or location guard). `packs` defaults to 1, at most 20. */
  'home.grocery-buy': { payload: { id: ItemId; packs?: number }; ok: 'delivered'; fail: 'invalid_item' | 'invalid_quantity' | 'insufficient_funds' | 'kitchen_full' }
  /** Hand out the starter ingredients if that has not happened. */
  'home.kitchen-unpack': { payload: NoPayload; ok: 'unpacked'; fail: 'already_unpacked' }
  /** Buy petrol for the generator in your room (delivered at once, anywhere): 1 – 20 litres, as many as the tank has room for. */
  'home.refuel': { payload: { litres: number }; ok: 'fuelled'; fail: 'invalid_quantity' | 'no_generator' | 'tank_full' | 'insufficient_funds' }

  // -- onboarding --
  /**
   * Guests only: confirm the look and start playing (lifts the hold, hands out the starting needs).
   * Repeating it only changes the look. `joining: true` leaves the welcome message to the invite banner.
   */
  'onboarding.quick-start': { payload: { look: Look; joining?: boolean; entry?: 'unilag' }; ok: 'playing'; fail: 'already_onboarded' | 'not_a_guest' | 'invalid_look' | 'invalid_entry' }
  /**
   * SERVER ONLY: put a guest who came by an invite in the inviter's public venue — once per life,
   * within JOIN_WINDOW_MS of its creation, free. The server chooses the venue (server/social).
   */
  'onboarding.arrive': { payload: { venue: VenueId }; ok: 'joined'; fail: 'not_a_guest' | 'already_joined' | 'join_window_closed' | 'invalid_venue' | 'busy'; serverOnly: true }
  /** Step 1. `{ shuffle: true }` picks a random valid look and does NOT confirm the step ('shuffled'). */
  'onboarding.look': { payload: { look: Look } | { shuffle: true }; ok: 'look_saved' | 'shuffled'; fail: 'already_onboarded' | 'invalid_look' }
  /** Step 2: exactly two different traits. */
  'onboarding.traits': { payload: { traits: [TraitId, TraitId] }; ok: 'traits_saved'; fail: 'already_onboarded' | 'step_required' | 'invalid_traits' }
  /** Step 3. */
  'onboarding.dream': { payload: { dream: DreamId }; ok: 'dream_saved'; fail: 'already_onboarded' | 'step_required' | 'invalid_dream' }
  /** Step 4: rolls once, then repeats the stored roll ('already_rolled', a success). */
  'onboarding.lottery': { payload: NoPayload; ok: 'rolled' | 'already_rolled'; fail: 'already_onboarded' | 'step_required' }
  /**
   * Step 5: completes creation and emits 'life.started'. With `lga` alone the life lives in the free
   * starter house on its own plot there; with `house` it starts in that rented home instead.
   */
  'onboarding.home': {
    payload: ({ lga: LgaId; house?: null } | { house: StartHomeId; lga?: LgaId | null }) & SettleInOptions
    ok: 'life_started'
    fail: 'already_onboarded' | 'step_required' | 'busy' | 'invalid_lga' | 'invalid_house' | 'lga_required' | 'house_locked' | 'balance_limit'
  }
  /** After creation: change look using owned styles (colours are free). 'unchanged' is a success. */
  'onboarding.set-look': { payload: { look: Look }; ok: 'look_saved' | 'unchanged'; fail: 'onboarding_required' | 'invalid_look' | 'not_owned' }
  /** Buy a style or an accessory with cash and wear it. */
  'onboarding.boutique-buy': { payload: { kind: WardrobeKind | 'accessories' | 'wearables'; id: string }; ok: 'bought'; fail: 'onboarding_required' | 'invalid_item' | 'wrong_body' | 'already_owned' | 'insufficient_funds' }

  // -- goals --
  'goals.buy-perk': { payload: { id: PerkId }; ok: 'perk_bought'; fail: 'invalid_perk' | 'already_owned' | 'insufficient_stars' }
  /** `slot` is the index of the wish in `view.goals.wishes`. */
  'goals.reroll-wish': { payload: { slot: number }; ok: 'rerolled'; fail: 'invalid_wish' | 'no_rerolls' | 'no_other_wish' }
  /** Only for a life that has no dream yet (one saved before dreams existed). */
  'goals.set-dream': { payload: { dream: DreamId }; ok: 'dream_saved'; fail: 'dream_already_chosen' | 'invalid_dream' }

  // -- social --
  /** Phone a family contact (timed action kind 'call'; works anywhere). */
  'social.call': { payload: { id: FamilyId }; ok: 'calling'; fail: 'busy' | 'invalid_contact' }
  /** No-op: lets the client re-read the life after a server-side change. */
  'social.sync': { payload: NoPayload; ok: 'synced'; fail: never }
  /** SERVER ONLY. See SocialServerOpMap for the per-operation codes. */
  'social.server': {
    payload: SocialServerPayload
    ok: SocialServerOpMap[SocialServerOp]['ok']
    fail: SocialServerOpMap[SocialServerOp]['fail'] | 'invalid_operation'
    serverOnly: true
  }

  // -- civic --
  /** Look for a gem where you stand. */
  'civic.hunt-search': { payload: NoPayload; ok: 'found'; fail: 'travelling' | 'hunt_complete' | 'activity_needed' | 'wrong_spot' | 'nothing_here' }
  /** Collect the daily prize once every gem is found. */
  'civic.hunt-claim': { payload: NoPayload; ok: 'claimed'; fail: 'already_claimed' | 'gems_missing' | 'balance_limit' }
  /** Roll today's hunt (and pick up a gem underfoot); never fails. */
  'civic.refresh': { payload: NoPayload; ok: 'refreshed'; fail: never }
  /** SERVER ONLY: post city news the life has not seen yet to its Updates feed. */
  'civic.news': { payload: { items: CivicNewsItem[] }; ok: 'posted' | 'nothing_new'; fail: never; serverOnly: true }
  /** SERVER ONLY: charge the filing fee for a candidacy the server has accepted. */
  'civic.run': { payload: { tier?: TierId }; ok: 'declared'; fail: Exclude<CivicCheckCode, 'wrong_place'>; serverOnly: true }
  /** SERVER ONLY: confirm this life may vote now. */
  'civic.vote': { payload: NoPayload; ok: 'voted'; fail: Exclude<CivicCheckCode, 'insufficient_funds'>; serverOnly: true }
  /** SERVER ONLY: charge the rent for an ad slot the server found free. `slot` is `bb-NN` or `sea-<row>-<col>`. */
  'civic.rent-ad': { payload: { kind: 'billboard' | 'sea'; slot: string }; ok: 'rented'; fail: 'invalid_slot' | 'insufficient_funds'; serverOnly: true }
  /** SERVER ONLY: money between a life and a party or a treasury, after the server has checked the rule (server/routes/politics.ts). */
  'civic.treasury': { payload: { op: 'pay' | 'receive'; amount: number; label: string }; ok: 'paid' | 'received'; fail: 'invalid_amount' | 'insufficient_funds' | 'balance_limit'; serverOnly: true }
  /** SERVER ONLY: what a fight the server has decided leaves on a life: energy lost, and the mood of one who lost. */
  'civic.justice': { payload: { energy: number; beaten?: boolean }; ok: 'hurt'; fail: 'invalid_amount'; serverOnly: true }
  /** SERVER ONLY: charge for a club-radio shout-out; the player must be standing in a club. */
  'civic.shoutout': { payload: NoPayload; ok: 'queued'; fail: 'not_in_club' | 'insufficient_funds'; serverOnly: true }

  // -- missions --
  /** Collect a finished mission's naira, once. A guest has no missions yet ('missions_locked'). */
  'missions.claim': { payload: { id: MissionId }; ok: 'claimed'; fail: 'missions_locked' | 'unknown_mission' | 'already_claimed' | 'not_done' | 'balance_limit' }
  /** Swap one unfinished DAILY mission (MISSION_REWARDS.rerollsPerDay a day). */
  'missions.reroll': { payload: { id: MissionId }; ok: 'rerolled'; fail: 'missions_locked' | 'unknown_mission' | 'already_done' | 'no_rerolls' | 'nothing_else' }
  /** Deal today's set if the day turned; changes nothing else and never fails. */
  'missions.refresh': { payload: NoPayload; ok: 'refreshed'; fail: never }

  // -- events --
  /** At a live event that allows it: pay `amount` (one of SPRAY.amounts) for Social and Fun. A pure sink. */
  'events.spray': { payload: { amount: number }; ok: 'sprayed'; fail: 'no_event' | 'invalid_amount' | 'spray_limit' | 'insufficient_funds' }

  // -- growth --
  /**
   * SERVER ONLY: one finished table game. 'paid' — a counted win against a real player under the
   * daily cap; 'counted' — it counts for missions; 'for_fun' — neither. Never fails.
   */
  'growth.table-result': {
    payload: { game: string; label: string; won: boolean; human: boolean; counted: boolean }
    ok: 'paid' | 'counted' | 'for_fun'
    fail: never
    serverOnly: true
  }
  /** SERVER ONLY: a referral gift — 'welcome' to the newcomer (once per life) or 'reward' to the inviter (weekly and lifetime caps). */
  'growth.referral': {
    payload: { kind: 'welcome' | 'reward'; name?: string }
    ok: 'welcomed' | 'rewarded'
    fail: 'already_welcomed' | 'balance_limit' | 'referral_lifetime_cap' | 'referral_week_cap' | 'invalid_gift'
    serverOnly: true
  }

  // -- business --
  /** SERVER ONLY: the life's half of a shop change the server has checked (server/business/service.ts). `op` is a BusinessServerOp. */
  'business.server': {
    payload: { op: BusinessServerOp; [field: string]: unknown }
    ok: 'opened' | 'paid' | 'collected' | 'refunded' | 'bought' | 'bagged' | 'unbagged' | 'returned'
    fail: BusinessBlockCode
    serverOnly: true
  }

  /** SERVER ONLY: fixed fictional practice rewards or owned clipper upgrade, checked atomically by their services. */
  'living-world.server': {
    payload: { op: 'barber-reward'; lessonId: 'basic' | 'advanced' } | { op: 'barber-tool' } | { op: 'clerk-reward' } | { op: 'npc-restock-wage' }
    ok: 'barber_rewarded' | 'barber_tool_upgraded' | 'clerk_rewarded' | 'npc_restock_wage_paid'
    fail: 'invalid_barber_action' | 'invalid_clerk_action' | 'invalid_npc_restock_action' | 'balance_limit' | 'insufficient_funds'
    serverOnly: true
  }
}

/** The operations 'business.server' accepts (systems/business.ts). */
export type BusinessServerOp = 'open' | 'spend' | 'collect' | 'refund' | 'buy' | 'bag-add' | 'bag-take' | 'bag-return'
/** Why the life's half of a shop change was refused. */
export type BusinessBlockCode =
  | 'invalid_operation' | 'invalid_amount' | 'insufficient_funds' | 'balance_limit' | 'earn_first' | 'spend_exceeds_earned'
  | 'daily_shop_limit' | 'not_needed' | 'already_have' | 'bag_full' | 'bag_short'

// ---- derived types ------------------------------------------------------------------------

export type ActionType = keyof ActionMap

export type ActionPayload<T extends ActionType> = ActionMap[T]['payload']

/** Actions only the server may run (through ctx.act, with ctx.internal). */
export type ServerOnlyActionType = { [T in ActionType]: ActionMap[T] extends { serverOnly: true } ? T : never }[ActionType]

/** Actions a player may send to POST /api/action. */
export type PlayerActionType = Exclude<ActionType, ServerOnlyActionType>

/**
 * Veto codes contributed through the 'action.block' modifier, which dispatch() asks before ANY
 * handler runs. The only shipped contributor is onboarding (see THE STAGED MODEL in onboarding.js):
 *   'onboarding_required'  a guest of the quick start whose look is not confirmed (`required`)
 *                          refuses everything except `onboarding.*` …
 *   'settle_required'      … and a guest who is playing is refused only what needs a home: going
 *                          Home ('travel' with id 'home'), every `home.*` and `estate.*` action and
 *                          'property.house-move' — and, at the campus, being a student: every
 *                          action onboarding.js GUEST_CAMPUS matches (campus.ts GuestCampusActionType:
 *                          enrolment, study, the hostel, campus jobs and the student vote). A guest
 *                          may still visit the campus, walk the trail and ride the shuttle.
 * Server-only actions run through ctx.act are vetoed like a player's, except the three deliveries
 * TO a life (`InboundActionType`), which pass the hold.
 */
export type ActionVetoCode = 'onboarding_required' | 'settle_required'

/** Server-only actions that are applied even while a life is held for its look (onboarding.js INBOUND). */
export type InboundActionType = 'social.server' | 'growth.referral' | 'growth.table-result'

/** Actions a guest of the quick start cannot run until it has settled in. ('travel' only when the destination is Home.) */
export type SettledOnlyActionType = Extract<ActionType, `home.${string}` | `estate.${string}` | 'property.house-move' | 'travel' | 'homeward.accept'> | GuestCampusActionType

/** Codes dispatch() can return for action `T` without the handler having run. */
export type DispatchRefusalCode<T extends ActionType = ActionType> =
  | (T extends ServerOnlyActionType ? 'server_only' : never)
  | (T extends `onboarding.${string}` | InboundActionType ? never : 'onboarding_required')
  | (T extends SettledOnlyActionType ? 'settle_required' : never)

export type ActionOkCode<T extends ActionType> = ActionMap[T]['ok']

/** Every failure code dispatch() can return for action `T`: the handler's own plus dispatch's refusals. */
export type ActionFailCode<T extends ActionType> = ActionMap[T]['fail'] | DispatchRefusalCode<T>

/** Every result code of action `T`. */
export type ActionCode<T extends ActionType> = ActionOkCode<T> | ActionFailCode<T>

/** The typed result of `dispatch(state, { type: T, … }, ctx)`. */
export type ActionResult<T extends ActionType> = ActionSuccess<ActionOkCode<T>> | ActionFailure<ActionFailCode<T>>

/**
 * The `body` handed to dispatch(). `payload` may be omitted for an action that reads none.
 * Legacy callers may send `id` and `mode` at the top level: dispatch folds them into the payload
 * when the payload does not already have them (life.js:103-104). New code should not.
 */
export type ActionBody<T extends ActionType = ActionType> = {
  [K in T]: {
    type: K
    payload?: ActionPayload<K>
    /** Client-chosen id of the request; seeds the action's random generator and makes a retry idempotent on the server. */
    actionId?: string
    /** @deprecated legacy top-level field, folded into `payload.id`. */
    id?: unknown
    /** @deprecated legacy top-level field, folded into `payload.mode`. */
    mode?: unknown
  }
}[T]

// ---- runtime lists (checked against the running engine by engine.test.ts) -------------------

/** Every registered action type, in registration order. Equals `actionTypes()` from src/life.ts. */
export const ACTION_TYPES = [
  'cancel', 'wallet.admin', 'wallet.bonus', 'needs.admin',
  'apply-job', 'career.switch', 'career.quit', 'career.auto', 'career.dilemma', 'career.teach',
  'activity', 'spot', 'activity.admin',
  'travel', 'world.roadside', 'travel.skip', 'travel.repay-ride',
  'economy.pay-loan', 'economy.pay-rent', 'economy.open-deposit', 'economy.close-deposit',
  'property.house-move', 'property.car-buy', 'property.car-use', 'property.car-sell',
  'estate.set-lga', 'estate.assign', 'estate.released', 'estate.style', 'estate.upgrade', 'estate.move-in', 'estate.relocate', 'estate.lodge', 'estate.make-home',
  'estate.confirm-residence', 'estate.unconfirm-residence',
  'homeward.accept',
  'home.door', 'home.furniture-buy', 'home.furniture-move', 'home.furniture-sell', 'home.furniture-store', 'home.furniture-place',
  'home.grocery-buy', 'home.kitchen-unpack', 'home.refuel',
  'stories.save', 'stories.remove', 'stories.publish', 'stories.start', 'stories.next', 'stories.end',
  'estate.land-pay', 'street.place',
  'onboarding.quick-start', 'onboarding.arrive',
  'onboarding.look', 'onboarding.traits', 'onboarding.dream', 'onboarding.lottery', 'onboarding.home',
  'onboarding.set-look', 'onboarding.boutique-buy',
  'goals.buy-perk', 'goals.reroll-wish', 'goals.set-dream',
  'social.call', 'social.sync', 'social.server',
  'civic.hunt-search', 'civic.hunt-claim', 'civic.refresh', 'civic.news', 'civic.run', 'civic.vote', 'civic.rent-ad', 'civic.treasury', 'civic.justice', 'civic.shoutout',
  'missions.claim', 'missions.reroll', 'missions.refresh',
  'events.spray',
  'growth.table-result', 'growth.referral',
  'business.server',
  'living-world.server',
  // the campus: unilagStudent, unilagCommunity, unilagShuttle (campus.ts)
  ...CAMPUS_ACTION_TYPES,
] as const satisfies readonly ActionType[]

/** The action types declared `serverOnly` (registry.js serverOnlyReason(type) !== null). */
export const SERVER_ONLY_ACTIONS = [
  'estate.land-pay', 'street.place',
  'wallet.admin', 'wallet.bonus', 'needs.admin', 'activity.admin', 'estate.assign', 'estate.released', 'onboarding.arrive', 'social.server', 'civic.news', 'civic.run', 'civic.vote', 'civic.rent-ad',
  'civic.treasury', 'civic.justice', 'civic.shoutout', 'growth.table-result', 'growth.referral', 'business.server', 'living-world.server', 'unilag.election.nominate', 'unilag.election.vote',
] as const satisfies readonly ServerOnlyActionType[]

/** The server-only deliveries that pass a held life's veto (onboarding.js INBOUND). */
export const INBOUND_ACTIONS = ['social.server', 'growth.referral', 'growth.table-result'] as const satisfies readonly InboundActionType[]

/** The operations 'business.server' accepts (systems/business.ts). */
export const BUSINESS_SERVER_OPS = ['open', 'spend', 'collect', 'refund', 'buy', 'bag-add', 'bag-take', 'bag-return'] as const satisfies readonly BusinessServerOp[]

/** The operations 'social.server' accepts (social.js serverOps). */
export const SOCIAL_SERVER_OPS = [
  'transfer-check', 'transfer-out', 'transfer-in', 'friend', 'unfriend', 'interact', 'bae-check', 'bae', 'bae-end', 'join',
] as const satisfies readonly SocialServerOp[]
