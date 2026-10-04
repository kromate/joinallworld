/**
 * Public entry to the rules engine, shared by the Node server, the Cloudflare worker and
 * the browser (display only). Pure: no I/O and no clocks other than ctx.now.
 *
 *   createLife(saved, ctx?)        build a valid state from untrusted saved input
 *   dispatch(state, body, ctx?)    apply one player action → { ok, code, state, reason? }
 *   advanceLife(state, dt, ctx?)   settle `dt` seconds: timed action, then every system's advance
 *   viewLife(state, ctx?)          derived display data, { [systemId]: view }
 *
 * Systems live in src/game/systems and are registered by src/game/systems/index.js; the
 * contract for adding to them is at the top of src/game/registry.js.
 *
 * State versions: `state.v` is the global schema version. A save without `v` is the
 * pre-registry format (v0). MIGRATIONS[n] upgrades a raw save from version n to n+1 before
 * any system sanitizes it; each system then validates its own slice and fills defaults, so
 * fields that did not exist when a save was written simply start at their defaults.
 */
import './game/systems/index.js';
import { systems, actionHandler, hasAction, actionTypes, modify, serverOnlyReason } from './game/registry.js';
import { fail, finite, isRecord, makeContext } from './game/util.js';
import { STATE_VERSION, sanitizeActive, advanceActive } from './game/systems/core.js';
import { NEEDS } from './game/systems/needs.js';
import { VENUES } from './game/content/venues.js';
import { TRAVEL_MODES, TRAVEL_DURATION } from './game/content/travel.js';

export { VENUES, STATE_VERSION, NEEDS, makeContext, actionTypes, hasAction };
export { spotsOf } from './game/systems/activities.js';

/** Legacy names kept for existing callers. Fares by mode, and the flat beta trip time. */
export const TRAVEL_OPTIONS = Object.freeze(Object.fromEntries(Object.values(TRAVEL_MODES).map((mode) => [mode.id, mode.fare])));
export const PREVIEW_TRAVEL_DURATION = TRAVEL_DURATION;

const MIGRATIONS = [
  // v0 → v1: the earliest saves kept needs as flat top-level numbers; everything else carries over as-is.
  (input) => {
    const needs = isRecord(input.needs) ? input.needs : Object.fromEntries(NEEDS.filter((need) => finite(input[need])).map((need) => [need, input[need]]));
    return { ...input, needs, v: 1 };
  },
];

export function migrate(saved) {
  let input = isRecord(saved) ? saved : {};
  let version = Number.isInteger(input.v) && input.v >= 0 ? input.v : 0;
  while (version < STATE_VERSION) input = MIGRATIONS[version++](input);
  return input;
}

const contextFor = (state, ctx, seed) => (ctx && typeof ctx.rng === 'function' ? ctx
  : makeContext({ ...ctx, now: finite(ctx?.now) ? ctx.now : state?.t ?? 0, cityId: ctx?.cityId ?? 'lagos', seed }));

/**
 * Build a life from saved input. Nothing in `saved` is trusted: every system rebuilds its own
 * keys, unknown keys are dropped, and malformed values fall back to defaults. Calling it on an
 * already-valid state returns an equal deep copy. The beta seed is ₦5,000 and all needs at 50.
 */
export function createLife(saved, ctx) {
  const context = contextFor(null, { isNew: !isRecord(saved), ...ctx }, 'create');
  const input = migrate(saved);
  const state = {};
  for (const system of systems()) system.sanitize(input, state, context);
  sanitizeActive(input, state, context);
  return state;
}

/**
 * Apply one action. `body` is `{ type, payload? }`; the legacy top-level `id` and `mode`
 * fields are folded into the payload. Throws for an unknown type (callers validate first).
 * Before the handler runs every system may veto the action through the 'action.block' modifier
 * (data { type, payload }); a veto is an ordinary failure with its code and reason.
 * A server-only action (registry.js) is refused with 'server_only' unless ctx.internal === true:
 * that flag is set by the route host's ctx.act and by nothing a player can reach.
 */
export function dispatch(state, body, ctx) {
  const handler = actionHandler(body?.type);
  if (!handler) throw new Error('Invalid action type');
  const payload = { ...(isRecord(body.payload) ? body.payload : {}) };
  if (body.id !== undefined && payload.id === undefined) payload.id = body.id;
  if (body.mode !== undefined && payload.mode === undefined) payload.mode = body.mode;
  const context = contextFor(state, ctx, `action|${body.actionId ?? ''}`);
  const refusal = serverOnlyReason(body.type);
  if (refusal && context.internal !== true) return fail(state, 'server_only', refusal);
  const veto = modify(state, 'action.block', null, { type: body.type, payload }, context);
  if (isRecord(veto) && typeof veto.code === 'string') return fail(state, veto.code, typeof veto.reason === 'string' ? veto.reason : 'That is not possible right now.');
  return handler(state, payload, context);
}

/**
 * Settle `dt` seconds. The timed action advances first, then every system's advance() runs —
 * always, so needs decay and bills fall due whether or not the player is doing anything.
 * Returns { ok, code: 'idle' | 'advanced' | 'completed' | 'invalid_time', state }.
 */
export function advanceLife(state, dt, ctx) {
  if (!finite(dt) || dt <= 0) return { ok: false, code: 'invalid_time', state };
  const now = finite(ctx?.now) ? ctx.now : state.t + dt * 1000;
  const context = contextFor(state, { ...ctx, now }, `settle|${state.t}|${now}`);
  const code = advanceActive(state, dt, context);
  for (const system of systems()) system.advance?.(state, dt, context);
  state.t = now;
  return { ok: true, code, state };
}

/** Derived, display-only data from every system that defines view(). Never mutates state. */
export function viewLife(state, ctx) {
  const context = contextFor(state, ctx, 'view');
  const view = {};
  for (const system of systems()) if (system.view) view[system.id] = system.view(state, context);
  return view;
}

// Thin named wrappers kept for older callers and tests.
export const startActivity = (state, id, ctx) => dispatch(state, { type: 'activity', id }, ctx);
export const cancelActivity = (state, ctx) => dispatch(state, { type: 'cancel' }, ctx);
export const startTravel = (state, destination, mode, ctx) => dispatch(state, { type: 'travel', id: destination, mode }, ctx);
export const applyJob = (state, id, ctx) => dispatch(state, { type: 'apply-job', id }, ctx);
