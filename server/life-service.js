// Portable settlement logic shared by the Node server and the Cloudflare worker (no I/O).
import { createLife, advanceLife, dispatch, hasAction, VENUES } from '../src/life.js';

export { VENUES };

/**
 * Bring one city's life up to `now` and return it. Creates the life on first use, re-validates
 * the stored state (migrating older saves), then settles the elapsed server time: the timed
 * action progresses and every system's background advance runs.
 */
export function settleCity(session, cityId, now) {
  session.cities ||= {};
  const entry = session.cities[cityId] ||= { state: createLife({ name: session.name }, { now, cityId, isNew: true }), updatedAt: now };
  entry.state = createLife(entry.state, { now, cityId, isNew: false });
  const elapsed = Number.isFinite(entry.updatedAt) ? Math.max(0, (now - entry.updatedAt) / 1000) : 0;
  if (elapsed > 0) advanceLife(entry.state, elapsed, { now, cityId });
  entry.state.t = now;
  entry.updatedAt = now;
  entry.state.name = session.name;
  return entry.state;
}

/**
 * Apply a validated action body to a settled state. The context defaults to the state's own
 * settlement time and a generator seeded from the action ID, so callers that only pass
 * (state, body) — such as the worker — stay deterministic.
 */
export function applyLifeAction(state, body, ctx) {
  if (!hasAction(body?.type)) throw new Error('Invalid action type');
  return dispatch(state, body, ctx ?? { now: state.t, cityId: body.cityId, actionId: body.actionId });
}
