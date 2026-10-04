/**
 * OWNER: world
 * The visible trip. Pure maths — no Three.js, no DOM.
 *
 * THE SERVER OWNS THE TIMER. A trip is the server's timed action
 *   state.activeAction = { kind: 'travel' | 'commute', id: destination, duration, remaining, mode? }
 * and the place it left from is state.location (it does not change until the trip ends). The
 * animation never keeps time of its own: every state the server sends re-anchors the clock
 * (`remaining` seconds from now), and the position on the route is a pure function of the
 * fraction done, 1 − remaining ÷ duration. So a reload mid-trip picks up at the right point, the
 * avatar reaches the door when the server's timer does, and a cancelled trip simply stops.
 *
 *   tripOf(state)                         → { key, kind, from, to, mode, duration, remaining } | null
 *   createTripClock()                     → { sync(trip, nowMs), progress(nowMs), remaining(nowMs) }
 *   tripPose(route, progress, mode)       → where the traveller and the vehicle are
 */
import { pointAt } from './roads.js';

/** How each travel mode looks. `speed` only shapes the walk-to-the-road share of the trip. */
export const TRIP_LOOKS = Object.freeze({
  trek: { vehicle: null, label: 'On foot' },
  keke: { vehicle: 'keke', label: 'Keke' },
  danfo: { vehicle: 'danfo', label: 'Danfo' },
  okada: { vehicle: 'okada', label: 'Okada' },
  cab: { vehicle: 'cab', label: 'Cab' },
  car: { vehicle: 'car', label: 'Your car' },
  commute: { vehicle: 'danfo', label: 'Staff bus' },
});
export const lookOf = (mode) => TRIP_LOOKS[mode] || TRIP_LOOKS.danfo;

const TRIP_KINDS = ['travel', 'commute'];

/** The trip in a state, or null. */
export function tripOf(state) {
  const active = state?.activeAction;
  if (!active || !TRIP_KINDS.includes(active.kind) || typeof active.id !== 'string' || typeof state.location !== 'string' || active.id === state.location) return null;
  const duration = Number.isFinite(active.duration) && active.duration > 0 ? active.duration : 1;
  const remaining = Math.max(0, Math.min(duration, Number.isFinite(active.remaining) ? active.remaining : duration));
  const mode = active.kind === 'commute' ? 'commute' : Object.hasOwn(TRIP_LOOKS, active.mode) ? active.mode : 'danfo';
  return { key: `${active.kind}|${state.location}|${active.id}|${mode}|${duration}`, kind: active.kind, from: state.location, to: active.id, mode, duration, remaining };
}

/** Samples closer together than this are the same reading taken a moment apart: the earlier arrival is kept, so the avatar never steps back. */
const JITTER_MS = 350;

export function createTripClock() {
  let key = null, duration = 1, endsAt = 0;
  return {
    get key() { return key; },
    get duration() { return duration; },
    /** Take the server's reading. Returns true when this is a different trip from the last one. */
    sync(trip, nowMs) {
      const end = nowMs + trip.remaining * 1000, fresh = trip.key !== key;
      if (fresh || Math.abs(end - endsAt) > JITTER_MS) endsAt = end; else endsAt = Math.min(endsAt, end);
      key = trip.key; duration = trip.duration;
      return fresh;
    },
    clear() { key = null; },
    remaining: (nowMs) => Math.max(0, Math.min(duration, (endsAt - nowMs) / 1000)),
    progress(nowMs) { return 1 - this.remaining(nowMs) / duration; },
  };
}

/** A walker covers ground this many times slower than a vehicle; it sets how long the walk to and from the road takes. */
const WALK_SLOWDOWN = 4;
const MAX_WALK_SHARE = 0.2;
const STRIDE = 0.85;
const ease = (u) => u * 0.55 + 0.45 * (u * u * (3 - 2 * u));

/** The shares of the trip spent walking to the road and walking from it, for a vehicle trip. */
export function tripShares(route) {
  const ride = Math.max(0.001, route.length - route.lead - route.tail);
  const total = route.lead * WALK_SLOWDOWN + ride + route.tail * WALK_SLOWDOWN;
  return { lead: Math.min(MAX_WALK_SHARE, (route.lead * WALK_SLOWDOWN) / total), tail: Math.min(MAX_WALK_SHARE, (route.tail * WALK_SLOWDOWN) / total) };
}

/**
 * Where everything is at `progress` (0…1) of the trip.
 *   { x, y, z, ry, distance, phase: 'walk' | 'leave' | 'ride' | 'arrive', walking, step, bridge, vehicle: { x, y, z, ry } | null }
 * `step` counts strides along the route (the walk cycle is drawn from it, so it too is a function of progress).
 */
export function tripPose(route, progress, mode) {
  const p = Math.max(0, Math.min(1, progress)), look = lookOf(mode);
  if (!look.vehicle) {
    const distance = route.length * p, at = pointAt(route, distance);
    return { ...at, distance, phase: 'walk', walking: p > 0 && p < 1, step: Math.floor(distance / STRIDE), vehicle: null };
  }
  const shares = tripShares(route), rideEnd = route.length - route.tail;
  const gateA = pointAt(route, route.lead + 0.01), gateB = pointAt(route, rideEnd - 0.01);
  if (p < shares.lead) {
    const distance = route.lead * (p / shares.lead), at = pointAt(route, distance);
    return { ...at, distance, phase: 'leave', walking: true, step: Math.floor(distance / STRIDE), vehicle: gateA };
  }
  if (p > 1 - shares.tail) {
    const distance = rideEnd + route.tail * ((p - (1 - shares.tail)) / shares.tail), at = pointAt(route, distance);
    return { ...at, distance, phase: 'arrive', walking: p < 1, step: Math.floor(distance / STRIDE), vehicle: gateB };
  }
  const u = (p - shares.lead) / (1 - shares.lead - shares.tail);
  const distance = route.lead + (rideEnd - route.lead) * ease(u), at = pointAt(route, distance);
  return { ...at, distance, phase: 'ride', walking: false, step: 0, vehicle: at };
}
