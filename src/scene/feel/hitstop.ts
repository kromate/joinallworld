/**
 * OWNER: scenes
 * HIT-STOP: the picture holds for a few tens of milliseconds when a blow lands. It is a clock that can be frozen for N ms, measured
 * by real time (performance.now), not by frames, so a slow phone holds it for the same time. It only changes the time a drawing
 * advances by: input is never blocked and the rules (the server's fight) never wait. Used by the arena fight only.
 */

/** The longest a freeze can be asked for, ms. */
export const HIT_STOP_MAX_MS = 95

export interface HitStop {
  /** Freeze for `ms` from now (a longer freeze already running is kept). */
  freeze(ms: number): void
  readonly frozen: boolean
  /** The time a drawing should advance by: 0 while frozen, `dt` otherwise. */
  advance(dt: number): number
}

export function createHitStop(now: () => number = () => globalThis.performance.now()): HitStop {
  let until = 0
  return {
    freeze(ms) { if (Number.isFinite(ms) && ms > 0) until = Math.max(until, now() + Math.min(HIT_STOP_MAX_MS, ms)) },
    get frozen() { return now() < until },
    advance(dt) { return now() < until ? 0 : dt },
  }
}
