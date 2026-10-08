/**
 * RULES ENGINE REGISTRY — the contract for every game system.
 * ===========================================================================
 * The rules engine is pure: no I/O, no Date.now(), no Math.random(), no DOM. The same
 * code runs on the Node server, the Cloudflare worker and (read-only, for display) the
 * browser. The server is the only thing that ever applies an action.
 *
 * HOW TO ADD OR EXTEND A SYSTEM
 * -----------------------------
 * Every system file in `src/game/systems/` is already imported and registered, in a
 * fixed order, by `src/game/systems/index.ts`. You own your file(s); you never edit the
 * index, this registry, `src/life.ts` or another owner's file.
 *
 * A system is a default-exported plain object:
 *
 *   export default {
 *     id: 'career',                       // unique; also the default state slice name
 *     stateKeys: ['career'],              // every top-level state key this system writes. ENFORCED:
 *                                         // createLife, dispatch and advanceLife throw if a system
 *                                         // leaves a top-level key on the state that nobody declared
 *                                         // (it would vanish at the next load), and sanitize() may only
 *                                         // add keys its own system declared. See STATE below.
 *
 *     // Rebuild this system's slice from UNTRUSTED saved input. `input` is the raw saved
 *     // object (already migrated to the current state.v); `state` is the fresh state being
 *     // built — systems earlier in the order have already filled their keys. Write only your
 *     // stateKeys. Never copy a value without validating it; fall back to defaults.
 *     // ctx.isNew is true when no save existed (a brand-new life).
 *     sanitize(input, state, ctx) { state.career = { ... } },
 *
 *     // Player actions, keyed by the `type` sent to POST /api/action. `payload` is an
 *     // untrusted plain object (the server only guarantees it is an object under 2 KB):
 *     // validate every field. Return ok(state, code) or fail(state, code, reason) from
 *     // util.js — a failure MUST name the unmet prerequisite in `reason`.
 *     actions: { 'apply-job': (state, payload, ctx) => ({ ok, code, state, reason? }) },
 *
 *     // SERVER-ONLY ACTIONS. An action that is one half of a change whose other half lives in
 *     // shared storage (a ballot, a gift between two players) is declared as an object instead:
 *     //   'civic.vote': { serverOnly: true, run: (state, payload, ctx) => result, refusal?: 'sentence' }
 *     // dispatch() refuses it with code 'server_only' (changing nothing) unless ctx.internal === true.
 *     // Only the route host's ctx.act sets that flag, and only server code calls ctx.act; the public
 *     // POST /api/action and the worker never do. Never pass a client-chosen `type` to ctx.act.
 *
 *     // Called on every settlement with the elapsed seconds, whether or not a timed
 *     // action is running. dt can be large (a player returning after days): cap or
 *     // batch your own work. ctx.now is the time at the END of the interval.
 *     advance(state, dtSeconds, ctx) {},
 *
 *     // Optional derived, display-only data (never stored). Returned to the client UI
 *     // as view[id] by viewLife(). Must not mutate state.
 *     view(state, ctx) { return { ... } },
 *
 *     // Optional event listeners and modifiers — see CROSS-SYSTEM HOOKS below.
 *     on: { 'activity.completed': (state, data, ctx) => {} },
 *     modifiers: { 'skills.xpRate': (value, state, data, ctx) => value },
 *
 *     // Optional static activity definitions this system attaches to venue spots
 *     // (see systems/activities.js for the definition format).
 *     activities: [{ id: 'my-activity', where: { venue: 'park', spot: 'work' }, ... }],
 *
 *     // Optional handlers for kinds of timed action held in state.activeAction
 *     // ({ kind, id, duration, remaining, ... }). Only one timed action runs at a time.
 *     //   moves        REQUIRED boolean. true = this kind takes the player out of the venue they
 *     //                are in (a trip, a commute): while it runs the player is DEPARTING, which the
 *     //                servers use to end venue-room membership and voice (isDeparting below).
 *     //                Registration refuses a kind that does not say, and the engine refuses to let
 *     //                a kind declared `moves: false` change state.location when it completes.
 *     //   sanitize     return the kind-specific fields to keep, or null when the saved action is
 *     //                no longer valid (it is then dropped)
 *     //   invalidated  optional: called at load when sanitize returned null, so a kind that took
 *     //                something at the start (a price) can give it back. Runs at most once per
 *     //                action, because the action is gone from the state afterwards.
 *     active: { travel: { moves: true, sanitize(value, state, ctx), tick?(state, active, elapsedSeconds, ctx),
 *                         complete(state, active, ctx), cancel?(state, active, ctx),
 *                         invalidated?(state, value, ctx) } },
 *   };
 *
 * ctx (built by makeContext in util.js) is `{ now, cityId, rng, isNew?, actionId?, quickStart?, internal? }` (quickStart: the new life starts as a guest of the quick start — systems/onboarding.js; `requireOnboarding` is its older name):
 *   now     server time in ms — the only clock you may read (see clock.js for Lagos time)
 *   cityId  the city this life belongs to
 *   rng     () => float in [0,1), seeded from the action ID or the settlement interval, so
 *           a replayed request or a re-run test produces the same outcome. On a server the seed
 *           is also keyed with a secret held per life (server/life-service.ts) that no client
 *           ever sees, so a player cannot work out an outcome in advance or pick an action ID
 *           that produces the one they want. The secret is consumed by makeContext and is not
 *           part of ctx: a system cannot read it, store it or show it.
 *
 * WHAT YOU MAY IMPORT (inside src/game/)
 *   registry.js (emit, modify), util.js, clock.js, api.js (core systems' public functions:
 *   wallet, needs, skills, inventory, activities, arrive(state, venue, ctx, { spot?, mode? })) and
 *   any file in content/.
 * WHAT YOU MAY NOT IMPORT
 *   another feature system (systems/*.js other than through api.js), src/life.ts, anything
 *   under src/ui, src/scene or server/, Node built-ins, or browser globals.
 *
 * STATE
 *   One JSON object per life per city. New systems keep everything under `state[id]`.
 *   Legacy top-level keys are grandfathered to their owning system (cash → wallet,
 *   needs → needs, job/completedShifts → career, homeOwned → property, location/spot/
 *   activeAction/name/message → core/activities). `state.v` is the global schema version,
 *   owned by src/life.ts; do not bump it. If you change the shape of your own slice, make
 *   your sanitize() accept the older shape — that is your migration.
 *   A top-level key outside every system's stateKeys cannot be written silently: the engine
 *   throws `Undeclared state key` the moment an action, a settlement or a load leaves one behind.
 *   Inside your own slice, anything your sanitize() does not rebuild is lost at the next load;
 *   test it by asserting createLife(state) deep-equals state after your actions (the conservation
 *   and first-day tests do this for every shipped system after every step).
 *
 * CROSS-SYSTEM HOOKS — systems never import each other
 * ----------------------------------------------------
 *   emit(state, event, data, ctx)        tell everyone something happened (may mutate state)
 *   modify(state, key, base, data, ctx)  ask everyone to adjust a value; returns the result
 *
 * Worked example — a trait that speeds up skills, a perk that discounts purchases, and a
 * goal that watches for a meal, without goals/traits/home importing one another:
 *
 *   // systems/skills.js (core) computes the rate before granting XP:
 *   const rate = modify(state, 'skills.xpRate', 1, { skill }, ctx);
 *
 *   // systems/onboarding.js (character owner) contributes the trait:
 *   modifiers: { 'skills.xpRate': (value, state) => state.onboarding.traits?.includes('fast-learner') ? value * 1.25 : value },
 *
 *   // systems/home.js (home owner) asks for the price and announces the purchase:
 *   const price = Math.round(modify(state, 'shop.price', item.price, { item }, ctx));
 *   emit(state, 'item.bought', { item: item.id, price }, ctx);
 *
 *   // systems/goals.js (character owner) contributes the discount perk and observes events:
 *   modifiers: { 'shop.price': (value, state) => state.goals.perks?.includes('discount') ? value * 0.9 : value },
 *   on: { 'item.bought': (state, data, ctx) => complete(state, 'buy-something', ctx),
 *         'activity.completed': (state, { tags }, ctx) => { if (tags.includes('food')) complete(state, 'eat', ctx); } },
 *
 * Events emitted by the foundation:
 *   'activity.started'   { id, def }
 *   'activity.completed' { id, def, tags, choice, cash }  cash is the naira actually credited
 *   'activity.unpaid'    { id, def }  (finished but could no longer be paid for; no effects)
 *   'action.cancelled'   { kind, id }
 *   'wallet.changed'     { amount, reason, balance }
 *   'skill.levelup'      { skill, level }
 *   'travel.arrived'     { venue, from, mode }   mode is a travel mode id, or null (commute, moving in)
 *   'job.applied'        { job }            (ported starter job)
 *   'shift.completed'    { job, activity }  (ported starter job)
 * Modifier keys consulted by the foundation (base value → your adjusted value):
 *   'needs.decayRate'  data { need }   base 1 — multiply background decay
 *   'skills.xpRate'    data { skill }  base 1 — multiply XP gains
 *   'activity.cost'    data { def }    base def.cost
 *   'activity.reward'  data { def }    base def.reward
 *   'activity.block'   data { def }    base null — return { code, reason } to veto a start
 *   'activity.hidden'  data { def }    base false — return true to leave an activity out of the list
 *   'action.block'     data { type, payload }  base null — return { code, reason } to veto ANY action
 *                      before its handler runs (dispatch asks for every action type). Pass a veto
 *                      from an earlier system through unchanged: `if (value) return value`.
 *   'travel.fare'      data { mode, destination }  base fare
 * Owners add their own names as `<system>.<thing>` (e.g. 'shop.price', 'friend.made') and
 * list them in their file header. Listeners must tolerate events they do not know.
 * emit() may be called from a listener, but only MAX_EMIT_DEPTH (8) deep: beyond that it throws,
 * because an event that is silently dropped leaves systems disagreeing about what happened.
 *
 * RANDOM CHANCES IN advance()
 *   Clients poll about once a second while something is running and once a minute otherwise, so
 *   advance() runs at whatever rhythm the player's browser chooses. A chance rolled "per call"
 *   would therefore depend on how often someone polls. Roll per EVENT (an arrival, a completed
 *   activity) or scale the chance with the elapsed seconds (1 − (1 − p)^dt), never per call.
 *
 * HOW TO TEST
 *   node --test picks up src/** and server/** `*.test.js`. Your pre-created test file imports the
 *   public entry only:
 *     import { createLife, dispatch, advanceLife, viewLife } from '../life.ts';
 *     import { makeContext } from './util.ts';
 *     const ctx = makeContext({ now: Date.UTC(2026, 0, 5, 9), cityId: 'lagos', seed: 't1' });
 *     const state = createLife(null, ctx);
 *     assert.equal(dispatch(state, { type: 'apply-job', payload: { id: 'x' } }, ctx).code, 'applied');
 *     advanceLife(state, 60, { ...ctx, now: ctx.now + 60000 });
 *   Always include a test that feeds your sanitize() hostile input.
 */

import type {
  ActionHandler, ActiveKindHandler, EngineEvent, EngineEventMap, EventListener, ModifierKey, ModifierMap, ServerOnlyAction, SystemDefinition,
} from '../types/registry.ts';
import { PLAYS } from './profile.ts';
import type { LifeContext, LifeState } from '../types/life.ts';
import type { CampusEngineEvent, CampusEventMap } from '../types/campus.ts';

const order: SystemDefinition[] = [];
const byId = new Map<string, SystemDefinition>();
const actionTable = new Map<string, ActionHandler>();
const serverOnlyTable = new Map<string, string>();
const activeTable = new Map<string, ActiveKindHandler>();
const declaredKeys = new Set<string>();
const MAX_EMIT_DEPTH = 8;
const SERVER_ONLY_REASON = 'That step is completed by the game server from its own screen. Nothing was changed.';
let depth = 0;

/** Check a definition and write its actions and timed-action kinds into the tables. Nothing is changed when it throws. */
function install(def: SystemDefinition<string>, replacing: SystemDefinition | null): void {
  const actions: Record<string, ActionHandler | ServerOnlyAction | undefined> = def.actions || {};
  const active: Record<string, ActiveKindHandler | undefined> = def.active || {};
  const ours = (table: Map<string, unknown>, key: string, owned: string[] | undefined): boolean => table.has(key) && !(owned ?? []).includes(key);
  const previous = replacing as { actions?: Record<string, unknown>; active?: Record<string, unknown> } | null;
  const handlers: [string, ActionHandler, ServerOnlyAction | undefined][] = [];
  for (const type of Object.keys(actions)) {
    if (ours(actionTable, type, previous?.actions ? Object.keys(previous.actions) : undefined)) throw new Error(`Action "${type}" is already registered`);
    const entry = actions[type];
    const handler = typeof entry === 'function' ? entry : entry?.serverOnly === true ? entry.run : null;
    if (typeof handler !== 'function') throw new Error(`Action "${type}" needs a handler function, or { serverOnly: true, run }`);
    handlers.push([type, handler, typeof entry === 'function' ? undefined : entry]);
  }
  for (const kind of Object.keys(active)) {
    if (ours(activeTable, kind, previous?.active ? Object.keys(previous.active) : undefined)) throw new Error(`Active kind "${kind}" is already registered`);
    const handler = active[kind];
    // Whether a timed action takes the player out of their venue is never left to a default:
    // room membership and voice depend on it (isDeparting), so every kind must say.
    if (typeof handler?.moves !== 'boolean') throw new Error(`Active kind "${kind}" must declare moves: true or false`);
    // A build that only reads lives carries no completion (./profile.ts): it never runs one.
    if (typeof handler.sanitize !== 'function' || (PLAYS && typeof handler.complete !== 'function')) throw new Error(`Active kind "${kind}" needs sanitize and complete`);
  }
  for (const key of Object.keys(previous?.actions ?? {})) { actionTable.delete(key); serverOnlyTable.delete(key); }
  for (const key of Object.keys(previous?.active ?? {})) activeTable.delete(key);
  for (const [type, handler, entry] of handlers) {
    actionTable.set(type, handler);
    if (entry) serverOnlyTable.set(type, typeof entry.refusal === 'string' && entry.refusal ? entry.refusal : SERVER_ONLY_REASON);
  }
  for (const kind of Object.keys(active)) {
    const handler = active[kind];
    if (handler) activeTable.set(kind, handler);
  }
}

function validate(def: SystemDefinition<string>): void {
  if (!def || typeof def.id !== 'string') throw new Error(`Invalid or duplicate system: ${def?.id}`);
  if (!Array.isArray(def.stateKeys) || typeof def.sanitize !== 'function') throw new Error(`System ${def.id} needs stateKeys and sanitize`);
  if (def.stateKeys.some((key) => typeof key !== 'string' || !key || ['__proto__', 'constructor', 'prototype'].includes(key))
    || new Set(def.stateKeys).size !== def.stateKeys.length) throw new Error(`Invalid stateKeys for ${def.id}`);
}

export function registerSystem(def: SystemDefinition<string>): SystemDefinition {
  if (!def || typeof def.id !== 'string' || byId.has(def.id)) throw new Error(`Invalid or duplicate system: ${def?.id}`);
  validate(def);
  for (const key of def.stateKeys) {
    const owner = order.find((other) => other.stateKeys.includes(key));
    if (owner) throw new Error(`State key "${key}" is owned by ${owner.id}, not ${def.id}`);
  }
  install(def, null);
  for (const key of def.stateKeys) declaredKeys.add(key);
  // Tests register probe systems under ids of their own; the table keeps the engine's own SystemId type.
  const registered = def as SystemDefinition;
  order.push(registered);
  byId.set(def.id, registered);
  return registered;
}

/**
 * LAZY SYSTEMS. The browser starts with a small stand-in for a system whose code it fetches only when a life needs it
 * (the UNILAG campus: src/campus/unilag/register.ts). A stand-in registers like any system and owns the same state keys,
 * but it only knows the slice of a life that has never used the system and REFUSES (throws) any other input: nothing is
 * ever rebuilt without the real sanitize(). `completeSystem` puts the real definition in the stand-in's place, in the same
 * position of the order, so sanitize, events and modifiers run in the order every other host uses.
 */
const standIns = new Set<string>();
const changeListeners = new Set<() => void>();
export function registerStandIn(def: SystemDefinition<string>): SystemDefinition { const registered = registerSystem(def); standIns.add(def.id); return registered; }
/** True while `id` is only a stand-in: its views, actions and listeners are not loaded. */
export const isStandIn = (id: string): boolean => standIns.has(id);
export function completeSystem(def: SystemDefinition<string>): SystemDefinition {
  validate(def);
  const index = order.findIndex((other) => other.id === def.id);
  const current = order[index];
  if (!current || !standIns.has(def.id)) throw new Error(`System "${def.id}" is not a stand-in`);
  if (current.stateKeys.length !== def.stateKeys.length || current.stateKeys.some((key, at) => def.stateKeys[at] !== key)) throw new Error(`The system "${def.id}" must own the same state keys as its stand-in`);
  install(def, current);
  const registered = def as SystemDefinition;
  order[index] = registered;
  byId.set(def.id, registered);
  standIns.delete(def.id);
  systemsChanged();
  return registered;
}
/** Told after a stand-in was replaced by its system: what was derived from the registry (views) is stale. Returns the unsubscribe. */
export function onSystemsCompleted(listener: () => void): () => void { changeListeners.add(listener); return () => { changeListeners.delete(listener); }; }
/** Tell the listeners that what was derived from the registry is stale (a stand-in was replaced, or a pack changed what the views say). */
export function systemsChanged(): void { for (const listener of changeListeners) listener(); }

export const systems = (): SystemDefinition[] => order;
export const getSystem = (id: string): SystemDefinition | undefined => byId.get(id);
export const actionTypes = (): string[] => [...actionTable.keys()];
export const hasAction = (type: unknown): type is string => typeof type === 'string' && actionTable.has(type);
export const actionHandler = (type: string): ActionHandler | undefined => actionTable.get(type);
/** The refusal sentence of a server-only action type, or null for an ordinary player action. */
export const serverOnlyReason = (type: unknown): string | null => (typeof type === 'string' ? serverOnlyTable.get(type) ?? null : null);
export const activeHandler = (kind: unknown): ActiveKindHandler | undefined => (typeof kind === 'string' ? activeTable.get(kind) : undefined);

/**
 * Does a timed action of this kind take the player out of the venue they are in? Declared by the
 * kind's handler (`moves`). A kind nobody registered is treated as moving: unknown means "not
 * provably here".
 */
export const activeMoves = (kind: unknown): boolean => activeHandler(kind)?.moves !== false;
/**
 * THE departing predicate. True while the life's timed action is one that moves the player (a
 * trip, the automatic commute, any future kind registered with `moves: true`). A departing player
 * is still recorded at the venue they are leaving (state.location changes on arrival) but is no
 * longer in it: no venue room, no voice, no "people here". Everything that asks "is this player
 * really at their location?" uses this — never a comparison with one kind's name.
 */
export const isDeparting = (state: { activeAction?: { kind: string } | null } | null | undefined): boolean => Boolean(state?.activeAction) && activeMoves(state?.activeAction?.kind);
/** Is the player in `venueId` right now — recorded there and not on their way out? */
export const occupiesVenue = (state: Pick<LifeState, 'activeAction' | 'location'> | null | undefined, venueId: unknown): boolean => !!state && typeof venueId === 'string' && state.location === venueId && !isDeparting(state);

/** Top-level keys on `state` that no registered system declared. Empty for every valid state. */
export function undeclaredKeys(state: object): string[] {
  const found: string[] = [];
  for (const key of Object.keys(state)) if (!declaredKeys.has(key)) found.push(key);
  return found;
}
/**
 * Refuse a state that carries a key nobody declared. Such a key would survive until the next load
 * and then disappear without a trace; throwing here turns that into a failure at the moment of the
 * write, in the first test (or request) that reaches it. `where` names what just ran.
 */
export function assertDeclared(state: object, where: string): void {
  const stray = Object.keys(state).filter((key) => !declaredKeys.has(key));
  if (!stray.length) return;
  // The key is taken off again before the failure is raised, so a caller that catches the error
  // is not left holding a life with a value the next load would silently drop.
  for (const key of stray) delete (state as Record<string, unknown>)[key];
  throw new Error(`Undeclared state key "${stray[0]}" after ${where}: add it to the owning system's stateKeys and rebuild it in sanitize(), or it is lost at the next load.`);
}

/** Notify every system, in registration order. Listeners may mutate state and emit further events.
 * Listeners always receive an object: anything else is replaced with {} so they can destructure safely. */
export function emit<E extends EngineEvent>(state: LifeState, event: E, data: EngineEventMap[E], ctx: LifeContext): void;
export function emit<E extends CampusEngineEvent>(state: LifeState, event: E, data: CampusEventMap[E], ctx: LifeContext): void;
export function emit<E extends EngineEvent | CampusEngineEvent>(state: LifeState, event: E, data: (EngineEventMap & CampusEventMap)[E], ctx: LifeContext): void {
  // Listeners emitting from listeners this deep is a loop, not a design: dropping the event
  // silently would leave some systems updated and others not, so it is an error instead.
  if (depth >= MAX_EMIT_DEPTH) throw new Error(`Event "${event}" was emitted ${MAX_EMIT_DEPTH} listeners deep: an event loop between systems.`);
  // Anything that is not a plain object reaches listeners as {} (a trust boundary: tests and other owners may emit partial data).
  const payload = (data !== null && typeof data === 'object' && !Array.isArray(data) ? data : {}) as (EngineEventMap & CampusEventMap)[E];
  depth += 1;
  try {
    for (const def of order) {
      const on: { [K in EngineEvent | CampusEngineEvent]?: EventListener<K> } | undefined = def.on;
      const listener: EventListener<E> | undefined = on?.[event];
      listener?.(state, payload, ctx);
    }
  } finally { depth -= 1; }
}

/** Fold a value through every system's modifier for `key`, in registration order. */
export function modify<K extends ModifierKey>(state: LifeState, key: K, base: ModifierMap[K]['base'], data: ModifierMap[K]['data'], ctx: LifeContext): ModifierMap[K]['base'] {
  let value = base;
  for (const def of order) {
    const fn = def.modifiers?.[key];
    if (fn) value = fn(value, state, data, ctx);
  }
  return value;
}
