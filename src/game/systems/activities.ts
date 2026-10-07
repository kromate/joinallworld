import { contentFor, jobFor, publicArrivalVenue, venuesFor, venueFor } from '../cities/runtime.ts';
/**
 * OWNER: foundation (core — do not edit from a feature branch)
 * Generic data-driven activity engine. Venue spots, job shifts and home furniture all run
 * through this one engine; owners add content, not code.
 *
 * State key: spot (id of the spot the player stands at in state.location, or null).
 * Actions:   'activity' { id, choice? }   start an activity offered at the current spot
 *            'spot'     { id }            move to another spot in the current venue
 * (Cancelling is the core 'cancel' action.)
 *
 * WHERE ACTIVITIES COME FROM
 *   1. content/venues.ts — VENUES[venue].spots[spot].activities (world owner).
 *   2. Any system's `activities: [{ ...def, where: { venue, spot, spotLabel?, spotIcon? } }]`
 *      (career attaches job shifts, home attaches furniture actions). If the spot id does not
 *      exist in the venue it is created, labelled `spotLabel`.
 *   Activity ids are global and must be unique.
 *
 * ACTIVITY DEFINITION — every field except id/label/duration is optional
 *   id, label, icon
 *   duration            seconds (real time)
 *   cost                naira; price actually charged is modify('activity.cost', cost, { def })
 *   chargeOn            'complete' (default) — debited when the activity finishes;
 *                       'start' — debited when it starts.
 *                       Original beta choice: either way the player must be
 *                       able to afford it at the start, and cancelling an activity that gives
 *                       nothing until it finishes never costs anything.
 *   refundOnCancel      for chargeOn 'start': default true (cancel refunds in full — or, for a
 *                       metered activity, the unused part; see METERED below); set false for a
 *                       deliberately sunk cost
 *   cancellable         false to forbid cancelling (default true); such an activity may last at most
 *                       MAX_LOCKED_SECONDS — checked when the catalogue is built
 *   effects             { need: delta } applied once on completion
 *   effectsPerSecond    { need: rate } accrued while running; an early stop KEEPS what accrued
 *   reward              naira credited on completion (modify('activity.reward', reward, { def }))
 *   xp                  { skill: amount } on completion;  xpPerSecond { skill: rate } while running
 *   requiresSkill       { id: skill, level }
 *   requiresJob         job id that state.job must equal
 *   minimumNeeds        { need: minimum } to start
 *   hours               { open, close, days? } Lagos time; falls back to the venue's hours
 *   consumes            { itemId: count } taken from inventory on start (not returned on cancel)
 *   produces            { itemId: count } added to inventory on completion
 *   moodlets            [{ id, label, value, duration }] added on completion
 *   choices             [{ id, label, ...any field above }] — the player must pick one; the
 *                       chosen entry's fields override the base definition
 *   tags                ['food', 'work', ...] passed to 'activity.completed' listeners
 *   unavailable         true = listed but cannot be started
 * A system may hide an activity from the list (not from the engine) through the 'activity.hidden'
 * modifier (data { def }, base false): a hidden activity is left out of view.cards and of the
 * rolling guide, but a save that is running it still loads and completes.
 *   beta, note          provenance (see content/venues.ts)
 *
 * BLOCKED STARTS always return a machine code and a reason naming the unmet prerequisite:
 *   busy · unavailable · choice_required · closed · job_required · skill_required ·
 *   needs_required · missing_items · balance_limit · insufficient_funds · or whatever a
 *   system returns from the 'activity.block' modifier ({ code, reason }).
 *
 * CANCEL SEMANTICS
 *   Completion effects, reward, XP and `produces` are skipped. Per-second gains already
 *   accrued are kept. For an activity WITHOUT per-second gains nothing has been delivered yet,
 *   so a complete-charged cost is not charged and a start-charged cost is refunded in full
 *   (unless refundOnCancel is false). Consumed items are not returned.
 *
 * METERED ACTIVITIES — a price together with effectsPerSecond or xpPerSecond (original rule)
 *   What has accrued is always paid for. Stopping early costs the price in proportion to the
 *   time used, rounded up to a whole naira: price × elapsed ÷ duration.
 *     chargeOn 'complete'  the used part is debited at the cancel (as much of it as the wallet
 *                          holds, if cash has dropped since the start)
 *     chargeOn 'start'     the unused part is refunded (nothing with refundOnCancel: false)
 *   Finishing costs the whole price, as for any activity. A FREE metered activity (sleep, a nap)
 *   is unchanged: waking early keeps the Energy gained and costs nothing.
 *
 * COMPLETION WITHOUT FUNDS
 *   A complete-charged price is re-checked when the activity finishes. If cash has dropped
 *   below it meanwhile (a bill fell due), the activity ends with none of its completion effects,
 *   and state.message says why. Nothing is charged — except for a metered activity, whose
 *   per-second gains were already delivered: it takes what the wallet holds towards the price.
 *
 * AN ACTIVITY INVALIDATED AT LOAD (its definition changed, it left this venue, the job is gone)
 *   is settled like an early stop and then dropped: a start-charged price comes back through the
 *   ledger as "Refund: …" (for a metered activity, the unused part), and a metered
 *   complete-charged activity whose price is still known is charged for the time used. This
 *   happens exactly once: the action is no longer in the state afterwards.
 */
import { dilemmasEnabled } from '../features.ts';
import { LEFT_OUT, PLAYS } from '../profile.ts';
import { emit, modify, systems } from '../registry.ts';
import { busy, cap, fail, isRecord, naira, ok, safeCount } from '../util.ts';
import { isOpen, minutesUntilOpen } from '../clock.ts';
import { venueLabel } from '../content/venues.ts';
import { canAfford, canCredit, credit, debit } from './wallet.ts';
import { repayFromEarnings } from '../relief.ts';
import { changeNeeds, addMoodlet } from './needs.ts';
import { addSkillXp, skillLevel } from './skills.ts';
import { addItem, countItem, hasItems, removeItems } from './inventory.ts';
import { isVenueId } from './core.ts';
import type { ActionMap, ActivityBlockCode } from '../../types/actions.ts';
import type { ActivityDefinition, ActivityPlacement, Block, CatalogueSpot, ResolvedActivity, VenueDefinition } from '../../types/content.ts';
import type { ActivityAction, ActivityId, LifeContext, LifeState, SpotId, TravelModeId } from '../../types/life.ts';
import type { SavedActiveAction, SystemDefinition, TypedActionHandler, ActiveKindHandler } from '../../types/registry.ts';
import type { ActivitiesView, ActivityCard } from '../../types/view.ts';

/** One activity of the merged catalogue, with where it stands. */
export interface CatalogueEntry {
  def: ActivityDefinition;
  venue: string;
  spot: SpotId;
}
interface Catalogue {
  byId: Map<ActivityId, CatalogueEntry>;
  venues: Record<string, Record<SpotId, CatalogueSpot>>;
}
/** Extra fields handed to api.arrive() after `spot` and `mode`: passed through to the 'travel.arrived' listeners. */
export interface ArriveOptions {
  spot?: unknown;
  /** The campus shuttle arrives with 'campus-shuttle' (it is not a travel mode of the fare table). */
  mode?: TravelModeId | 'campus-shuttle' | null;
  [extra: string]: unknown;
}
type StartOutcome = ReturnType<TypedActionHandler<'activity'>>;
type ActivityFailCode = ActionMap['activity']['fail'];

/** Object.entries that keeps the key type: the keys of a typed table are its ids. */
const entriesOf = <K extends string, V>(table: Partial<Record<K, V>> | null | undefined): [K, V][] => Object.entries(table || {}) as [K, V][]; // keys come from the typed table itself

/** The longest a non-cancellable activity may run (original beta value): the player cannot leave it, so it must be short. */
export const MAX_LOCKED_SECONDS = 300;
/** `places`: whether the dilemmas switch was on when it was built (it adds place actions: src/game/features.ts), so a flip builds it again. */
const catalogues = new Map<string, { content: ReturnType<typeof contentFor>; places: boolean; catalogue: Catalogue }>();

/** Rebuild the merged venue/spot/activity index (tests that register extra systems call this). */
export function rebuildCatalogue(cityId: string): Catalogue {
  const byId = new Map<ActivityId, CatalogueEntry>();
  const venues: Catalogue['venues'] = {};
  const add = (venue: string, spot: CatalogueSpot, def: ActivityDefinition): void => {
    if (byId.has(def.id)) throw new Error(`Duplicate activity id: ${def.id}`);
    // A timed action must end: every variant needs a real duration, and one the player cannot
    // cancel may only hold them for MAX_LOCKED_SECONDS.
    for (const variant of def.choices ? def.choices.map((choice) => ({ ...def, ...choice })) : [def]) {
      if (!Number.isFinite(variant.duration) || variant.duration <= 0) throw new Error(`Activity ${def.id} needs a duration in seconds`);
      if (variant.cancellable === false && variant.duration > MAX_LOCKED_SECONDS) throw new Error(`Activity ${def.id} cannot be cancelled, so it may last at most ${MAX_LOCKED_SECONDS} seconds`);
    }
    byId.set(def.id, { def, venue, spot: spot.id });
    spot.activities.push(def);
  };
  for (const venue of venuesFor(cityId)) {
    const spots: Record<SpotId, CatalogueSpot> = {};
    venues[venue.id] = spots;
    for (const source of Object.values(venue.spots)) {
      const spot = spots[source.id] = { id: source.id, label: source.label, icon: source.icon, caption: source.caption, activities: [] };
      for (const def of source.activities || []) add(venue.id, spot, def);
    }
  }
  for (const system of systems()) for (const def of system.activitiesFor?.(cityId) ?? system.activities ?? []) {
    const { venue, spot: spotId, spotLabel, spotIcon }: Partial<ActivityPlacement> = def.where || {};
    const venueSpots = venue === undefined ? undefined : venues[venue];
    if (venue === undefined || !venueSpots || typeof spotId !== 'string') throw new Error(`Activity ${def.id} has no valid where.venue/where.spot`);
    const spot = venueSpots[spotId] ||= { id: spotId, label: spotLabel || cap(spotId), icon: spotIcon, activities: [] };
    add(venue, spot, def);
  }
  for (const venue of contentFor(cityId).venues) {
    const spots = venues[venue.id];
    if (!spots) continue;
    for (const [id, wording] of Object.entries(venue.spotWording)) {
      const spot = spots[id];
      if (!spot) throw new TypeError(`Unknown wording spot ${venue.id}/${id}`);
      if (wording.label !== undefined) spot.label = wording.label;
      if (wording.caption !== undefined) spot.caption = wording.caption;
    }
    for (const [id, label] of Object.entries(venue.activityWording)) {
      const entry = byId.get(id), spot = entry && spots[entry.spot];
      if (!entry || entry.venue !== venue.id || !spot) throw new TypeError(`Unknown wording activity ${venue.id}/${id}`);
      entry.def = { ...entry.def, label };
      spot.activities = spot.activities.map(def => def.id === id ? entry.def : def);
    }
  }
  const catalogue = { byId, venues };
  catalogues.set(cityId, { content: contentFor(cityId), places: dilemmasEnabled(), catalogue });
  return catalogue;
}
const index = (cityId: string): Catalogue => {
  const content = contentFor(cityId), cached = catalogues.get(cityId);
  return cached?.content === content && cached.places === dilemmasEnabled() ? cached.catalogue : rebuildCatalogue(cityId);
};

/** Ordered spots of a venue, including spots and activities contributed by systems. */
export const spotsOf = (venueId: string, cityId: string): CatalogueSpot[] => Object.values(index(cityId).venues[venueId] || {});
export const defaultSpot = (venueId: string, cityId: string): SpotId | null => spotsOf(venueId, cityId)[0]?.id ?? null;
export const findActivity = (id: unknown, cityId: string): CatalogueEntry | undefined => (typeof id === 'string' ? index(cityId).byId.get(id) : undefined);

/**
 * Put the player in a venue (used by travel, the commute and moving in).
 *   options.spot   stand at this spot on arrival if the venue has it (default: the first spot)
 *   options.mode   how the player got there: a travel mode id, or null when no vehicle was used
 * Anything else in `options` is passed through to the 'travel.arrived' listeners, so every
 * system sees the same { venue, from, mode, ... } whatever order it was registered in.
 */
export function arrive(state: LifeState, venueId: string, ctx: LifeContext, { spot, mode = null, ...extra }: ArriveOptions = {}): boolean {
  if (!venueFor(ctx.cityId, venueId)) return false;
  const from = state.location;
  state.location = venueId;
  state.spot = typeof spot === 'string' && Object.hasOwn(index(ctx.cityId).venues[venueId] || {}, spot) ? spot : defaultSpot(venueId, ctx.cityId);
  emit(state, 'travel.arrived', { ...extra, venue: venueId, from, mode }, ctx);
  return true;
}

/** Apply the chosen option. Returns null when a choice is required but missing or invalid. */
function resolve(def: ActivityDefinition, choiceId: unknown): ResolvedActivity | null {
  if (!def.choices) return def;
  const choice = def.choices.find((item) => item.id === choiceId);
  return choice ? { ...def, ...choice, id: def.id, label: `${def.label}: ${choice.label}`, choice: choice.id } : null;
}

const waitText = (minutes: number): string => (minutes === Infinity ? '' : ` Opens in ${minutes >= 60 ? `${Math.floor(minutes / 60)}h ` : ''}${minutes % 60}m.`);

/** Why `def` (already resolved) cannot start right now, or null. Pure: never mutates state. */
export function blockReason(state: LifeState, def: ResolvedActivity, venueId: string, ctx: LifeContext): Block<ActivityBlockCode> | null {
  if (def.unavailable) return { code: 'unavailable', reason: 'This activity is unavailable in the local preview.' };
  const hours = def.hours ?? venueFor(ctx.cityId, venueId)?.hours;
  const now = ctx?.now ?? state.t;
  if (!isOpen(hours, now)) return { code: 'closed', reason: `${venueLabel(venueId, ctx?.cityId)} is closed right now.${waitText(minutesUntilOpen(hours, now))}` };
  if (def.requiresJob && state.job !== def.requiresJob) {
    return { code: 'job_required', reason: `Requires the ${jobFor(ctx.cityId, def.requiresJob)?.label ?? def.requiresJob} job. Apply in Phone → Jobs.` };
  }
  if (def.requiresSkill && skillLevel(state, def.requiresSkill.id) < def.requiresSkill.level) {
    return { code: 'skill_required', reason: `Requires ${cap(def.requiresSkill.id)} level ${def.requiresSkill.level} (yours is ${skillLevel(state, def.requiresSkill.id)}).` };
  }
  const short = entriesOf(def.minimumNeeds).filter(([need, minimum]) => state.needs[need] < minimum);
  if (short.length) {
    return { code: 'needs_required', reason: `Requires ${short.map(([need, minimum]) => `${cap(need)} ${minimum}+ (you have ${Math.floor(state.needs[need])})`).join(' and ')}. Eat and rest at Home first.` };
  }
  if (!hasItems(state, def.consumes)) {
    const missing = entriesOf(def.consumes).filter(([id, count]) => countItem(state, id) < count);
    return { code: 'missing_items', reason: `Missing ${missing.map(([id, count]) => `${count - countItem(state, id)} × ${id.replaceAll('-', ' ')}`).join(', ')}.` };
  }
  const veto = modify(state, 'activity.block', null, { def }, ctx);
  if (veto) return veto;
  const reward = rewardOf(state, def, ctx);
  if (reward && !canCredit(state, reward)) return { code: 'balance_limit', reason: 'Your saved balance has reached its supported limit.' };
  const cost = costOf(state, def, ctx);
  if (!canAfford(state, cost)) return { code: 'insufficient_funds', reason: `You do not have enough cash for this activity. It costs ${naira(cost)}; you have ${naira(state.cash)}.` };
  return null;
}

const whole = (value: unknown): number => Math.max(0, Math.round(Number(value) || 0));
const costOf = (state: LifeState, def: ActivityDefinition, ctx: LifeContext): number => whole(modify(state, 'activity.cost', def.cost || 0, { def }, ctx));
const rewardOf = (state: LifeState, def: ActivityDefinition, ctx: LifeContext): number => whole(modify(state, 'activity.reward', def.reward || 0, { def }, ctx));
/** Does the activity hand out gains while it runs (so an early stop has already delivered something)? */
export const isMetered = (def: Pick<ActivityDefinition, 'effectsPerSecond' | 'xpPerSecond'> | null | undefined): boolean => Object.keys(def?.effectsPerSecond || {}).length > 0 || Object.keys(def?.xpPerSecond || {}).length > 0;
/** The part of `price` owed for the time an action has run: price × elapsed ÷ duration, rounded up, never above the price. */
export function usedShare(price: number, action: { duration: number; remaining: number }): number {
  const elapsed = Math.min(action.duration, Math.max(0, action.duration - action.remaining));
  return Math.min(price, Math.max(0, Math.ceil(price * elapsed / action.duration - 1e-9)));
}
/** The most a running activity can have been charged at its start: the listed price or the adjusted one, whichever is higher. */
const paidLimit = (state: LifeState, def: ActivityDefinition, ctx: LifeContext): number => Math.max(whole(def.cost), costOf(state, def, ctx));

/**
 * Settle the money side of an activity that stops before it finishes (a cancel, or a saved action
 * that is no longer valid). Returns { charged, refunded } in naira. See CANCEL SEMANTICS.
 */
function settleEarlyStop(state: LifeState, def: ActivityDefinition, action: { duration: number; remaining: number; paid?: number }, ctx: LifeContext, why = ''): { charged: number; refunded: number } {
  const metered = isMetered(def);
  if (action.paid) {
    if (def.refundOnCancel === false) return { charged: 0, refunded: 0 };
    const refund = action.paid - (metered ? usedShare(action.paid, action) : 0);
    return { charged: 0, refunded: refund > 0 && credit(state, refund, `Refund: ${def.label}${why}`, ctx) ? refund : 0 };
  }
  if (!metered || def.chargeOn === 'start') return { charged: 0, refunded: 0 };
  const owed = usedShare(costOf(state, def, ctx), action);
  const taken = owed > 0 ? debit(state, owed, `${def.label} (stopped early)`, ctx, { partial: true }) : 0;
  return { charged: taken || 0, refunded: 0 };
}

function start(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext): StartOutcome {
  const blocked = busy(state);
  if (blocked) return blocked;
  const entry = findActivity(payload.id, ctx.cityId);
  if (!entry || entry.venue !== state.location || entry.spot !== state.spot) {
    return fail(state, 'unavailable', 'This activity is unavailable in the local preview.');
  }
  const def = resolve(entry.def, payload.choice);
  if (!def) return fail(state, 'choice_required', `Choose an option for ${entry.def.label}.`);
  const why = blockReason(state, def, entry.venue, ctx);
  if (why) return fail(state, why.code, why.reason);
  const cost = costOf(state, def, ctx);
  const chargedNow = def.chargeOn === 'start' && cost > 0;
  if (chargedNow) debit(state, cost, def.label, ctx);
  removeItems(state, def.consumes);
  state.activeAction = { kind: 'activity', id: def.id, duration: def.duration, remaining: def.duration,
    ...(def.choice ? { choice: def.choice } : {}), ...(chargedNow ? { paid: cost } : {}) };
  state.message = def.label;
  emit(state, 'activity.started', { id: def.id, def }, ctx);
  return ok(state, 'started');
}

/** The definition a running activity was started from. start() and sanitize() checked both lookups, so neither fails for a stored action. */
function runningDef(action: ActivityAction, cityId: string): ResolvedActivity {
  const entry = findActivity(action.id, cityId);
  const def = entry ? resolve(entry.def, action.choice) : null;
  if (!def) throw new Error(`Running activity "${action.id}" is not in the catalogue.`);
  return def;
}

const shown = {
  moves: false,
  sanitize(value: SavedActiveAction, state: LifeState, ctx: LifeContext) {
    const entry = findActivity(value.id, ctx.cityId);
    const def = entry ? resolve(entry.def, value.choice) : null;
    if (!entry || !def || entry.venue !== state.location || def.unavailable || value.duration !== def.duration
      || (def.requiresJob && state.job !== def.requiresJob)) return null;
    // What was charged at the start is the ADJUSTED price (modify 'activity.cost'), which may be
    // above the listed one. The server's own save (ctx.trustedSave) is believed as written — the
    // price may have changed since the player paid. Any other input is cut down to the limit.
    const paid = def.chargeOn === 'start' && safeCount(value.paid) && value.paid > 0
      ? (ctx?.trustedSave === true ? value.paid : Math.min(value.paid, paidLimit(state, def, ctx))) : 0;
    return { ...(def.choice ? { choice: def.choice } : {}), ...(paid ? { paid } : {}) };
  },
};
/**
 * What becomes of a running activity: only a host that plays lives settles, ends or stops one, so the browser's build leaves
 * these out (src/game/profile.ts). What a life is rebuilt with — `moves` and `sanitize` — is above, in every build.
 */
const played = PLAYS ? {
  /**
   * The saved activity can no longer run. Give back what was paid at its start (through the
   * ledger), or charge a metered one for the time used. Called only for the server's own save
   * (core.ts sanitizeActive, ctx.trustedSave), where the stored `paid` is the amount the server
   * itself debited at the start; the caller has already cleared the action, so this runs once.
   * If the refund would take the balance past its supported limit nothing is credited, the
   * player is told, and — the action being gone — no later load can pay it either.
   */
  invalidated(state: LifeState, value: SavedActiveAction, ctx: LifeContext) {
    const entry = typeof value.id === 'string' ? findActivity(value.id, ctx.cityId) : undefined;
    const def = entry && (resolve(entry.def, value.choice) || entry.def);
    const paid = safeCount(value.paid) && value.paid > 0 ? value.paid : 0;
    const label = def?.label ?? 'an activity';
    // The elapsed time is measured against the duration the action was started with.
    const action = { duration: value.duration, remaining: value.remaining, ...(paid ? { paid } : {}) };
    const due = paid && def?.refundOnCancel !== false ? paid - (def && isMetered(def) ? usedShare(paid, action) : 0) : 0;
    if (due > 0 && !canCredit(state, due)) {
      state.message = 'Your unfinished activity is no longer available. Its payment could not be refunded because your balance is at the supported limit. Your current balance is unchanged.';
      return;
    }
    // The stub `{ label }` is cast: settleEarlyStop reads only label and the metered/refund fields, which it lacks.
    const { charged, refunded } = settleEarlyStop(state, def ?? ({ label } as ActivityDefinition), action, ctx, ' (no longer available)');
    // Only a change to the wallet is announced; an action that simply cannot resume is dropped quietly, as before.
    if (refunded) state.message = `${cap(label)} is no longer available here, so it was stopped and ${naira(refunded)} was refunded.`;
    else if (charged) state.message = `${cap(label)} is no longer available here, so it was stopped. You paid ${naira(charged)} for the time used.`;
  },
  tick(state: LifeState, action: ActivityAction, elapsed: number, ctx: LifeContext) {
    const def = runningDef(action, ctx.cityId);
    for (const [need, rate] of entriesOf(def.effectsPerSecond)) changeNeeds(state, { [need]: rate * elapsed });
    for (const [skill, rate] of entriesOf(def.xpPerSecond)) addSkillXp(state, skill, rate * elapsed, ctx);
  },
  complete(state: LifeState, action: ActivityAction, ctx: LifeContext) {
    const def = runningDef(action, ctx.cityId);
    if (def.chargeOn !== 'start') {
      const cost = costOf(state, def, ctx);
      if (!debit(state, cost, def.label, ctx)) {
        // A metered activity has already delivered its per-second gains: it takes what is there.
        const taken = isMetered(def) ? debit(state, cost, `${def.label} (part paid)`, ctx, { partial: true }) || 0 : 0;
        state.message = taken ? `${def.label} ended without its finishing effect: it costs ${naira(cost)} and you only had ${naira(taken)}, which paid for the time used.`
          : `${def.label} ended without effect: it costs ${naira(cost)} and you now have ${naira(state.cash)}. Nothing was charged.`;
        emit(state, 'activity.unpaid', { id: def.id, def }, ctx);
        return;
      }
    }
    changeNeeds(state, def.effects);
    const reward = rewardOf(state, def, ctx);
    const paid = reward > 0 && credit(state, reward, def.label, ctx);
    if (paid) repayFromEarnings(state, reward, ctx);
    for (const [skill, amount] of entriesOf(def.xp)) addSkillXp(state, skill, amount, ctx);
    for (const [item, count] of Object.entries(def.produces || {})) addItem(state, item, count);
    for (const moodlet of def.moodlets || []) addMoodlet(state, moodlet, ctx);
    state.message = paid ? `${def.label} completed. You earned ${naira(reward)}.` : `${def.label} completed.`;
    emit(state, 'activity.completed', { id: def.id, def, tags: def.tags || [], choice: action.choice ?? null }, ctx);
  },
  cancel(state: LifeState, action: ActivityAction, ctx: LifeContext) {
    const def = runningDef(action, ctx.cityId);
    if (def.cancellable === false) return fail(state, 'not_cancellable', `${def.label} cannot be cancelled once started.`);
    const { charged, refunded } = settleEarlyStop(state, def, action, ctx);
    if (charged) state.message = `${def.label} stopped early. You paid ${naira(charged)} for the time used.`;
    else if (refunded && refunded < (action.paid ?? 0)) state.message = `${def.label} stopped early. ${naira(refunded)} was refunded for the unused time.`;
    return null;
  },
} satisfies Pick<ActiveKindHandler<ActivityAction>, 'invalidated' | 'tick' | 'complete' | 'cancel'> : LEFT_OUT;
const active = { ...shown, ...played } satisfies ActiveKindHandler<ActivityAction>;

/** Display summary of one activity for the UI, with the reason it is blocked (if it is). */
function card(state: LifeState, def: ActivityDefinition, venueId: string, ctx: LifeContext): ActivityCard {
  const { where, note, ...shown } = def;
  const blocked = def.choices ? (def.unavailable ? blockReason(state, def, venueId, ctx) : null) : blockReason(state, def, venueId, ctx);
  return { ...shown, cost: costOf(state, def, ctx), reward: rewardOf(state, def, ctx), blocked };
}

/**
 * What only a host that plays the game runs: player actions, settling time and event listeners. The browser reads lives, it never plays them,
 * so its build leaves this out (PLAYS is false there: src/game/profile.ts).
 */
const play = PLAYS ? {
  actions: {
    activity: (state, payload, ctx) => start(state, isRecord(payload) ? payload : {}, ctx),
    spot(state, payload, ctx) {
      if (state.activeAction) return fail(state, 'busy', 'Finish or cancel your current action before moving.');
      const id = payload?.id;
      if (typeof id !== 'string' || !Object.hasOwn(index(ctx.cityId).venues[state.location] || {}, id)) return fail(state, 'invalid_spot', 'That spot is not in this venue.');
      state.spot = id;
      return ok(state, 'selected');
    },
    /** SERVER ONLY (server/admin): stand the player at the city's public arrival venue, or at home, ending a stuck timed action (never a trip between cities). */
    'activity.admin': { serverOnly: true, refusal: 'Players are moved by the operator. Nothing was changed.',
      run(state, payload, ctx) {
        if (state.activeAction?.kind === 'intercity') return fail(state, 'travelling', 'A trip between cities is under way.');
        const to = payload?.to === 'home' ? 'home' : payload?.to === 'arrival' ? publicArrivalVenue(ctx.cityId).id : null;
        if (to === null) return fail(state, 'invalid_place');
        state.activeAction = null;
        return arrive(state, to, ctx) ? ok(state, 'moved') : fail(state, 'invalid_place');
      } },
  },
  advance() {},
} satisfies Pick<SystemDefinition<'activities'>, 'actions' | 'advance'> : LEFT_OUT;

export default {
  id: 'activities',
  stateKeys: ['spot'],
  sanitize(input, state, ctx) {
    const spots = index(ctx.cityId).venues[state.location] || {};
    state.spot = typeof input.spot === 'string' && Object.hasOwn(spots, input.spot) ? input.spot : defaultSpot(state.location, ctx.cityId);
  },
  active: { activity: active },
  view(state, ctx) {
    const spots = spotsOf(state.location, ctx.cityId);
    const here = spots.find((spot) => spot.id === state.spot);
    const current = state.activeAction?.kind === 'activity' ? state.activeAction : null;
    const running = current ? findActivity(current.id, ctx.cityId) : null;
    const runningDef = running && resolve(running.def, current?.choice);
    return {
      spot: state.spot,
      spots: spots.map(({ activities, ...spot }) => ({ ...spot, count: activities.length })),
      cards: (here?.activities || []).filter((def) => modify(state, 'activity.hidden', false, { def }, ctx) !== true).map((def) => card(state, def, state.location, ctx)),
      active: runningDef ? { id: runningDef.id, label: runningDef.label, icon: runningDef.icon, reward: rewardOf(state, runningDef, ctx),
        cancellable: runningDef.cancellable !== false, tags: runningDef.tags || [] } : null,
    };
  },
  ...play,
} satisfies SystemDefinition<'activities'>;
