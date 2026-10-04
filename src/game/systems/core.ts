/**
 * OWNER: foundation (core — do not edit from a feature branch)
 * Identity of a life and the single timed-action slot.
 *
 * State keys: v, t, name, message, location, activeAction.
 *   t             server ms this state was last settled to
 *   activeAction  null | { kind, id, duration, remaining, ...kind-specific }
 * Timed actions are driven here; what a kind means is supplied by whichever system
 * registers `active: { [kind]: { moves, sanitize, tick?, complete, cancel?, invalidated? } }`
 * (the contract is in registry.js).
 *
 * A SAVED ACTION THAT IS NO LONGER VALID (its definition changed, its venue is gone, its timing is
 * malformed) is dropped at load. When the input is the server's own save (ctx.trustedSave, see
 * createLife in src/life.js) the kind's `invalidated` hook runs first, so whatever the player paid
 * when it started is returned through the wallet ledger. The action is gone from the state
 * afterwards, so the hook can never run twice for one action. For any other input nothing is
 * settled: the action is just dropped.
 */
import { activeHandler, emit } from '../registry.ts';
import { finite, isRecord, ok, fail } from '../util.ts';
import { VENUES } from '../content/venues.ts';

export const STATE_VERSION = 1;
export const DEFAULT_NAME = 'New Lagosian';
const START_VENUE = 'park';

/** Run after every system has sanitized: the active action may depend on any of them. */
export function sanitizeActive(input, state, ctx) {
  const value = input.activeAction;
  state.activeAction = null;
  if (!isRecord(value)) return;
  const timed = finite(value.remaining) && value.remaining > 0 && finite(value.duration)
    && value.duration > 0 && value.remaining <= value.duration && typeof value.id === 'string';
  const handler = typeof value.kind === 'string' ? activeHandler(value.kind) : undefined;
  const extra = timed ? handler?.sanitize(value, state, ctx) : null;
  if (extra) { state.activeAction = { kind: value.kind, id: value.id, duration: value.duration, remaining: value.remaining, ...extra }; return; }
  // Only the server's own save may settle money for an action that cannot resume. With unusable
  // timing nothing can be said about the time used, so it is settled as if nothing had been.
  if (ctx?.trustedSave === true) handler?.invalidated?.(state, timed ? value : { ...value, duration: 1, remaining: 1 }, ctx);
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
  const from = state.location;
  handler?.complete(state, active, ctx);
  // A kind that moves the player must say so (`moves: true`): room membership and voice are
  // revoked from that declaration while the action runs, not from what it does at the end.
  if (state.location !== from && handler?.moves !== true) throw new Error(`Active kind "${active.kind}" changed the location but is not declared moves: true.`);
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
      // The message is set first so the kind's handler can replace it (an early stop that was
      // charged for the time used says so); a refusal puts its own reason there.
      const before = state.message;
      state.message = 'Action cancelled.';
      const refused = activeHandler(active.kind)?.cancel?.(state, active, ctx);
      if (refused) { if (state.message === 'Action cancelled.') state.message = before; return refused; }
      state.activeAction = null;
      emit(state, 'action.cancelled', { kind: active.kind, id: active.id }, ctx);
      return ok(state, 'cancelled');
    },
  },
  advance() {},
};
