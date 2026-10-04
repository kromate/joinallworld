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
 *   1. content/venues.js — VENUES[venue].spots[spot].activities (world owner).
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
 *                       Original beta choice: when the reference game takes the money (somewhere
 *                       between start and completion) is unverified. Either way the player must be
 *                       able to afford it at the start. Gradual paid gains require a
 *                       nonrefundable start charge (validated when building the catalogue).
 *   refundOnCancel      for chargeOn 'start': default true (cancel refunds in full); set false
 *                       for a deliberately sunk cost
 *   cancellable         false to forbid cancelling (default true)
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
 *   beta, note          provenance (see content/venues.js)
 *
 * BLOCKED STARTS always return a machine code and a reason naming the unmet prerequisite:
 *   busy · unavailable · choice_required · closed · job_required · skill_required ·
 *   needs_required · missing_items · balance_limit · insufficient_funds · or whatever a
 *   system returns from the 'activity.block' modifier ({ code, reason }).
 *
 * CANCEL SEMANTICS
 *   Completion effects, reward, XP and `produces` are skipped. Per-second gains already
 *   accrued are kept. A complete-charged cost is never charged. A start-charged cost is
 *   refunded in full unless refundOnCancel is false. Consumed items are not returned.
 *
 * COMPLETION WITHOUT FUNDS
 *   A complete-charged price is re-checked when the activity finishes. If cash has dropped
 *   below it meanwhile (a bill fell due), the activity ends with no charge and none of its
 *   completion effects, and state.message says why.
 */
import { emit, modify, systems } from '../registry.js';
import { busy, cap, fail, isRecord, naira, ok } from '../util.js';
import { isOpen, minutesUntilOpen } from '../clock.js';
import { VENUES, venueLabel } from '../content/venues.js';
import { JOBS } from '../content/jobs.js';
import { canAfford, canCredit, credit, debit } from './wallet.js';
import { changeNeeds, addMoodlet } from './needs.js';
import { addSkillXp, skillLevel } from './skills.js';
import { addItem, countItem, hasItems, removeItems } from './inventory.js';

let catalogue = null;
const hasGradualGains = (def) => [def.effectsPerSecond, def.xpPerSecond]
  .some((rates) => Object.values(rates || {}).some((rate) => rate > 0));
const safeGradualCharge = (def, cost) => cost <= 0 || !hasGradualGains(def)
  || (def.chargeOn === 'start' && def.refundOnCancel === false);
function validateCharge(def) {
  for (const variant of def.choices ? def.choices.map((choice) => ({ ...def, ...choice })) : [def]) {
    if (!safeGradualCharge(variant, variant.cost || 0)) throw new Error(`Activity ${def.id}: paid per-second gains require chargeOn start and refundOnCancel false`);
  }
}

/** Rebuild the merged venue/spot/activity index (tests that register extra systems call this). */
export function rebuildCatalogue() {
  const byId = new Map();
  const venues = {};
  const add = (venue, spot, def) => {
    validateCharge(def);
    if (byId.has(def.id)) throw new Error(`Duplicate activity id: ${def.id}`);
    byId.set(def.id, { def, venue, spot: spot.id });
    spot.activities.push(def);
  };
  for (const venue of Object.values(VENUES)) {
    venues[venue.id] = {};
    for (const source of Object.values(venue.spots)) {
      const spot = venues[venue.id][source.id] = { id: source.id, label: source.label, icon: source.icon, caption: source.caption, activities: [] };
      for (const def of source.activities || []) add(venue.id, spot, def);
    }
  }
  for (const system of systems()) for (const def of system.activities || []) {
    const { venue, spot: spotId, spotLabel, spotIcon } = def.where || {};
    if (!venues[venue] || typeof spotId !== 'string') throw new Error(`Activity ${def.id} has no valid where.venue/where.spot`);
    const spot = venues[venue][spotId] ||= { id: spotId, label: spotLabel || cap(spotId), icon: spotIcon, activities: [] };
    add(venue, spot, def);
  }
  catalogue = { byId, venues };
  return catalogue;
}
const index = () => catalogue || rebuildCatalogue();

/** Ordered spots of a venue, including spots and activities contributed by systems. */
export const spotsOf = (venueId) => Object.values(index().venues[venueId] || {});
export const defaultSpot = (venueId) => spotsOf(venueId)[0]?.id ?? null;
export const findActivity = (id) => (typeof id === 'string' ? index().byId.get(id) : undefined);

/**
 * Put the player in a venue (used by travel, the commute and moving in).
 *   options.spot   stand at this spot on arrival if the venue has it (default: the first spot)
 *   options.mode   how the player got there: a travel mode id, or null when no vehicle was used
 * Anything else in `options` is passed through to the 'travel.arrived' listeners, so every
 * system sees the same { venue, from, mode, ... } whatever order it was registered in.
 */
export function arrive(state, venueId, ctx, { spot, mode = null, ...extra } = {}) {
  if (!Object.hasOwn(VENUES, venueId)) return false;
  const from = state.location;
  state.location = venueId;
  state.spot = typeof spot === 'string' && Object.hasOwn(index().venues[venueId] || {}, spot) ? spot : defaultSpot(venueId);
  emit(state, 'travel.arrived', { ...extra, venue: venueId, from, mode }, ctx);
  return true;
}

/** Apply the chosen option. Returns null when a choice is required but missing or invalid. */
function resolve(def, choiceId) {
  if (!def.choices) return def;
  const choice = def.choices.find((item) => item.id === choiceId);
  return choice ? { ...def, ...choice, id: def.id, label: `${def.label}: ${choice.label}`, choice: choice.id } : null;
}

const waitText = (minutes) => (minutes === Infinity ? '' : ` Opens in ${minutes >= 60 ? `${Math.floor(minutes / 60)}h ` : ''}${minutes % 60}m.`);

/** Why `def` (already resolved) cannot start right now, or null. Pure: never mutates state. */
export function blockReason(state, def, venueId, ctx) {
  if (def.unavailable) return { code: 'unavailable', reason: 'This activity is unavailable in the local preview.' };
  const hours = def.hours ?? VENUES[venueId]?.hours;
  const now = ctx?.now ?? state.t;
  if (!isOpen(hours, now)) return { code: 'closed', reason: `${venueLabel(venueId, ctx?.cityId)} is closed right now.${waitText(minutesUntilOpen(hours, now))}` };
  if (def.requiresJob && state.job !== def.requiresJob) {
    return { code: 'job_required', reason: `Requires the ${JOBS[def.requiresJob]?.label ?? def.requiresJob} job. Apply in Phone → Jobs.` };
  }
  if (def.requiresSkill && skillLevel(state, def.requiresSkill.id) < def.requiresSkill.level) {
    return { code: 'skill_required', reason: `Requires ${cap(def.requiresSkill.id)} level ${def.requiresSkill.level} (yours is ${skillLevel(state, def.requiresSkill.id)}).` };
  }
  const short = Object.entries(def.minimumNeeds || {}).filter(([need, minimum]) => state.needs[need] < minimum);
  if (short.length) {
    return { code: 'needs_required', reason: `Requires ${short.map(([need, minimum]) => `${cap(need)} ${minimum}+ (you have ${Math.floor(state.needs[need])})`).join(' and ')}. Eat and rest at Home first.` };
  }
  if (!hasItems(state, def.consumes)) {
    const missing = Object.entries(def.consumes).filter(([id, count]) => countItem(state, id) < count);
    return { code: 'missing_items', reason: `Missing ${missing.map(([id, count]) => `${count - countItem(state, id)} × ${id.replaceAll('-', ' ')}`).join(', ')}.` };
  }
  const veto = modify(state, 'activity.block', null, { def }, ctx);
  if (veto) return veto;
  const reward = rewardOf(state, def, ctx);
  if (reward && !canCredit(state, reward)) return { code: 'balance_limit', reason: 'Your saved balance has reached its supported limit.' };
  const cost = costOf(state, def, ctx);
  if (!safeGradualCharge(def, cost)) return { code: 'unavailable', reason: 'This activity is unavailable while its payment rules are updated.' };
  if (!canAfford(state, cost)) return { code: 'insufficient_funds', reason: `You do not have enough cash for this activity. It costs ${naira(cost)}; you have ${naira(state.cash)}.` };
  return null;
}

const whole = (value) => Math.max(0, Math.round(Number(value) || 0));
const costOf = (state, def, ctx) => whole(modify(state, 'activity.cost', def.cost || 0, { def }, ctx));
const rewardOf = (state, def, ctx) => whole(modify(state, 'activity.reward', def.reward || 0, { def }, ctx));

function start(state, payload, ctx) {
  const blocked = busy(state);
  if (blocked) return blocked;
  const entry = findActivity(payload.id);
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

const active = {
  sanitize(value, state, ctx) {
    const entry = findActivity(value.id);
    const def = entry && resolve(entry.def, value.choice);
    if (!def || entry.venue !== state.location || def.unavailable || value.duration !== def.duration
      || (def.requiresJob && state.job !== def.requiresJob)) return null;
    const paid = Number.isSafeInteger(value.paid) && value.paid > 0 && (ctx?.trustedSave === true || value.paid <= Math.max(def.cost || 0, 0)) ? value.paid : 0;
    return { ...(def.choice ? { choice: def.choice } : {}), ...(paid ? { paid } : {}) };
  },
  tick(state, action, elapsed, ctx) {
    const def = resolve(findActivity(action.id).def, action.choice);
    for (const [need, rate] of Object.entries(def.effectsPerSecond || {})) changeNeeds(state, { [need]: rate * elapsed });
    for (const [skill, rate] of Object.entries(def.xpPerSecond || {})) addSkillXp(state, skill, rate * elapsed, ctx);
  },
  complete(state, action, ctx) {
    const def = resolve(findActivity(action.id).def, action.choice);
    if (def.chargeOn !== 'start') {
      const cost = costOf(state, def, ctx);
      if (!debit(state, cost, def.label, ctx)) {
        state.message = `${def.label} ended without effect: it costs ${naira(cost)} and you now have ${naira(state.cash)}. Nothing was charged.`;
        emit(state, 'activity.unpaid', { id: def.id, def }, ctx);
        return;
      }
    }
    changeNeeds(state, def.effects);
    const reward = rewardOf(state, def, ctx);
    const paid = reward > 0 && credit(state, reward, def.label, ctx);
    for (const [skill, amount] of Object.entries(def.xp || {})) addSkillXp(state, skill, amount, ctx);
    for (const [item, count] of Object.entries(def.produces || {})) addItem(state, item, count);
    for (const moodlet of def.moodlets || []) addMoodlet(state, moodlet, ctx);
    state.message = paid ? `${def.label} completed. You earned ${naira(reward)}.` : `${def.label} completed.`;
    emit(state, 'activity.completed', { id: def.id, def, tags: def.tags || [], choice: action.choice ?? null }, ctx);
  },
  cancel(state, action, ctx) {
    const def = resolve(findActivity(action.id).def, action.choice);
    if (def.cancellable === false) return fail(state, 'not_cancellable', `${def.label} cannot be cancelled once started.`);
    if (def.refundOnCancel !== false && action.paid) credit(state, action.paid, `Refund: ${def.label}`, ctx);
    return null;
  },
};

/** Display summary of one activity for the UI, with the reason it is blocked (if it is). */
function card(state, def, venueId, ctx) {
  const { where, note, ...shown } = def;
  const blocked = def.choices ? (def.unavailable ? blockReason(state, def, venueId, ctx) : null) : blockReason(state, def, venueId, ctx);
  return { ...shown, cost: costOf(state, def, ctx), reward: rewardOf(state, def, ctx), blocked };
}

export default {
  id: 'activities',
  stateKeys: ['spot'],
  sanitize(input, state) {
    const spots = index().venues[state.location] || {};
    state.spot = typeof input.spot === 'string' && Object.hasOwn(spots, input.spot) ? input.spot : defaultSpot(state.location);
  },
  actions: {
    activity: (state, payload, ctx) => start(state, isRecord(payload) ? payload : {}, ctx),
    spot(state, payload) {
      if (state.activeAction) return fail(state, 'busy', 'Finish or cancel your current action before moving.');
      const id = payload?.id;
      if (typeof id !== 'string' || !Object.hasOwn(index().venues[state.location] || {}, id)) return fail(state, 'invalid_spot', 'That spot is not in this venue.');
      state.spot = id;
      return ok(state, 'selected');
    },
  },
  active: { activity: active },
  advance() {},
  view(state, ctx) {
    const spots = spotsOf(state.location);
    const here = spots.find((spot) => spot.id === state.spot);
    const running = state.activeAction?.kind === 'activity' ? findActivity(state.activeAction.id) : null;
    const runningDef = running && resolve(running.def, state.activeAction.choice);
    return {
      spot: state.spot,
      spots: spots.map(({ activities, ...spot }) => ({ ...spot, count: activities.length })),
      cards: (here?.activities || []).filter((def) => modify(state, 'activity.hidden', false, { def }, ctx) !== true).map((def) => card(state, def, state.location, ctx)),
      active: runningDef ? { id: runningDef.id, label: runningDef.label, icon: runningDef.icon, reward: rewardOf(state, runningDef, ctx),
        cancellable: runningDef.cancellable !== false, tags: runningDef.tags || [] } : null,
    };
  },
};
