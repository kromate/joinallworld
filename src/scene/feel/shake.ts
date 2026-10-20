/**
 * OWNER: scenes
 * CAMERA SHAKE FROM TRAUMA. Trauma is a number from 0 to 1 that a big moment adds to and that falls away on its own. The camera is
 * moved by max · trauma² · sin(k · clock) on two axes with different k: a smooth wobble that is the same for the same inputs (never
 * a random number per frame), and that dies quickly because of the square. Pure, so it runs under `node --test`.
 *
 * The scene host (src/venue-world.ts) loads this lazily the first time a big moment asks for a shake, steps it inside its own frame loop,
 * and calls apply() after the orbit has put the camera where it belongs. camera-controls.ts (which is in the first download) is not touched.
 */

/** Trauma lost each second: 0.4 is gone in under 0.3 s, a large moment's 0.6 in 0.4 s. */
export const TRAUMA_DECAY = 1.5
/** Wobble speeds, radians a second (about 17 and 23 times a second): different, so the path is not a straight line. */
export const K_X = 107, K_Y = 144

/** The window event a big moment sends; the scene host that has a camera answers it with orbit.kick(detail.trauma). */
export const SHAKE_EVENT = 'jaw:shake'

export interface ShakeOffset { x: number; y: number }

/** Trauma after `dt` seconds. */
export const decayTrauma = (trauma: number, dt: number): number => Math.max(0, trauma - TRAUMA_DECAY * Math.max(0, dt))

/** Sideways and upward offsets, in the same unit as `max`, for a trauma and a clock in seconds. */
export function shakeOffset(trauma: number, clock: number, max: number, out: ShakeOffset = { x: 0, y: 0 }): ShakeOffset {
  const power = Math.min(1, Math.max(0, trauma)) ** 2 * max
  out.x = power * Math.sin(K_X * clock)
  out.y = power * Math.sin(K_Y * clock + 1.3)
  return out
}

export interface Shake {
  readonly trauma: number
  /** Add trauma (it stays at or under 1). */
  kick(amount: number): void
  /** Move time on; true while there is still shake to draw (the frame loop keeps going until it is false). */
  step(dt: number): boolean
  /** The offset right now, scaled by `max` (scene units). */
  offset(max: number, out?: ShakeOffset): ShakeOffset
  clear(): void
  /** Move a camera's position by the offset (sideways along the screen's right, and up) after the orbit has placed it: `max` is the largest move, `azimuth` the orbit's heading. Never touches where the camera looks or the avatar. */
  apply(position: { x: number; y: number; z: number }, azimuth: number, max: number): void
}

export function createShake(): Shake {
  let trauma = 0, clock = 0
  const out: ShakeOffset = { x: 0, y: 0 }
  return {
    get trauma() { return trauma },
    kick(amount) { if (Number.isFinite(amount) && amount > 0) trauma = Math.min(1, trauma + amount) },
    step(dt) {
      if (trauma <= 0) return false
      clock += Math.max(0, dt)
      trauma = decayTrauma(trauma, dt)
      return trauma > 0
    },
    offset(max, out = { x: 0, y: 0 }) { return trauma > 0 ? shakeOffset(trauma, clock, max, out) : (out.x = 0, out.y = 0, out) },
    clear() { trauma = 0 },
    apply(position, azimuth, max) {
      if (trauma <= 0) return
      const { x, y } = shakeOffset(trauma, clock, max, out)
      position.x += Math.cos(azimuth) * x; position.z -= Math.sin(azimuth) * x; position.y += y
    },
  }
}
