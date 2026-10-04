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
import { finite, isRecord, ok, fail } from '../util.js';
import { credit } from './wallet.js';
import { VENUES } from '../content/venues.js';

export const STATE_VERSION = 1;
export const DEFAULT_NAME = 'New Lagosian';
const START_VENUE = 'park';

/** Run after every system has sanitized: the active action may depend on any of them. */
export function sanitizeActive(input, state, ctx) {
  const value = input.activeAction;
  state.activeAction = null;
  if (!isRecord(value)) return;
  const validTiming = finite(value.remaining) && value.remaining > 0 && finite(value.duration)
    && value.duration > 0 && value.remaining <= value.duration && typeof value.id === 'string';
  const extra = validTiming ? activeHandler(value.kind)?.sanitize(value, state, ctx) : null;
  if (extra) {
    state.activeAction = { kind: value.kind, id: value.id, duration: value.duration, remaining: value.remaining, ...extra };
  } else if (ctx?.trustedSave === true && value.kind === 'activity' && Number.isSafeInteger(value.paid) && value.paid > 0) {
    // Only server-owned saves may authorize a refund, never an arbitrary imported/client state.
    // Clearing the rejected action above consumes its payment record exactly once.
    if (credit(state, value.paid, 'Refund: unavailable activity', ctx)) state.message = 'Your unfinished activity is no longer available. Its payment was refunded.';
    else state.message = 'Your unfinished activity is no longer available. Its payment could not be refunded because your balance is at the supported limit. Your current balance is unchanged.';
  }
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
