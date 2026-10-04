/**
 * OWNER: foundation (core — do not edit from a feature branch)
 * Identity of a life and the single timed-action slot.
 *
 * State keys: v, t, name, message, location, activeAction.
 *   t             server ms this state was last settled to
 *   activeAction  null | { kind, id, duration, remaining, ...kind-specific }
 * Timed actions are driven here; what a kind means is supplied by whichever system
 * registers `active: { [kind]: { sanitize, tick?, complete, cancel? } }`.
 */
import { activeHandler, emit } from '../registry.js';
import { cleanText, finite, isRecord, ok, fail } from '../util.js';
import { VENUES } from '../content/venues.js';

export const STATE_VERSION = 1;
export const DEFAULT_NAME = 'New Lagosian';
const START_VENUE = 'park';

/** Run after every system has sanitized: the active action may depend on any of them. */
export function sanitizeActive(input, state, ctx) {
  const value = input.activeAction;
  state.activeAction = null;
  if (!isRecord(value) || !finite(value.remaining) || value.remaining <= 0 || !finite(value.duration)
    || value.duration <= 0 || value.remaining > value.duration || typeof value.id !== 'string') return;
  const extra = activeHandler(value.kind)?.sanitize(value, state, ctx);
  if (extra) state.activeAction = { kind: value.kind, id: value.id, duration: value.duration, remaining: value.remaining, ...extra };
}

/** Advance the timed action. Returns 'idle' | 'advanced' | 'completed'. */
export function advanceActive(state, dt, ctx) {
  const active = state.activeAction;
  if (!active) return 'idle';
  const handler = activeHandler(active.kind);
  handler?.tick?.(state, active, Math.min(dt, active.remaining), ctx);
  active.remaining = Math.max(0, active.remaining - dt);
  if (active.remaining > 0) return 'advanced';
  state.activeAction = null;
  handler?.complete(state, active, ctx);
  return 'completed';
}

export default {
  id: 'core',
  stateKeys: ['v', 't', 'name', 'message', 'location', 'activeAction'],
  sanitize(input, state, ctx) {
    state.v = STATE_VERSION;
    state.t = finite(input.t) && input.t >= 0 ? input.t : finite(ctx.now) ? ctx.now : 0;
    state.name = typeof input.name === 'string' ? input.name.trim().slice(0, 24) || DEFAULT_NAME : DEFAULT_NAME;
    state.message = typeof input.message === 'string' && input.message.length <= 500 ? input.message : '';
    state.location = typeof input.location === 'string' && Object.hasOwn(VENUES, input.location) ? input.location : START_VENUE;
    state.activeAction = null;
  },
  actions: {
    /** Cancel the running timed action. What is kept or refunded is decided by the kind's handler. */
    cancel(state, payload, ctx) {
      const active = state.activeAction;
      if (!active) return fail(state, 'idle');
      const refused = activeHandler(active.kind)?.cancel?.(state, active, ctx);
      if (refused) return refused;
      state.activeAction = null;
      state.message = 'Action cancelled.';
      emit(state, 'action.cancelled', { kind: active.kind, id: active.id }, ctx);
      return ok(state, 'cancelled');
    },
  },
  advance() {},
};
