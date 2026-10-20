/**
 * OWNER: scenes
 * Rain, planned. Pure: no THREE, no DOM. Every drop is a function of (its index, the seconds, the field): a lattice that is fixed in the world,
 * falls and drifts with the wind, and is wrapped into a box round a focus point, so nothing is stored and nothing is stepped per drop. The
 * shader in rain.ts evaluates exactly these formulas on the GPU (the hash is the same, to float precision); this file is the reference the
 * tests hold it to, and what rain.ts reads for its counts and constants.
 *
 *   dropAt()       where drop `i` is at a time
 *   wrap()         the wrap into the box (a drop that leaves one side comes in at the other)
 *   dropAlpha()    how visible it is: near fade, far fade, top fade, and none at all under cover
 *   rainCount()    how many drops a tier draws, and none when it is not wet
 *
 * Units are scene units (1.5 to the metre, as in street-scene.ts).
 */

export type RainTier = 'phone' | 'wide' | 'high'
/** Drops per tier. A phone has the fewest: overdraw is what rain costs. */
export const RAIN_COUNT: Readonly<Record<RainTier, number>> = Object.freeze({ phone: 600, wide: 2000, high: 6000 })
/** Splash crowns per tier. */
export const SPLASH_COUNT: Readonly<Record<RainTier, number>> = Object.freeze({ phone: 40, wide: 120, high: 300 })

export interface RainField {
  /** Side of the box (x and z) the drops live in, and its height above the ground. */
  box: number
  height: number
  /** Fall speed in units a second, and the wind in units a second [x, z]. */
  fall: number
  wind: readonly [number, number]
  seed: number
}

/** A field for a place: a box wide enough for a venue floor, a cloud base at 20 m. */
export const FIELD: Readonly<RainField> = Object.freeze({ box: 56, height: 30, fall: 17, wind: [3.3, 1.35] as const, seed: 1.3 })
/** The same field with a box that suits the tier: a phone's few drops are kept closer together. */
export const fieldFor = (tier: RainTier): RainField => ({ ...FIELD, box: tier === 'phone' ? 32 : tier === 'wide' ? 44 : FIELD.box })

/** How the rain is painted by the light of the day: a colour that reads against the ground, and how much of it. Additive, so brighter at night. */
export type RainLight = 'day' | 'dusk' | 'night'
export const RAIN_LOOK: Readonly<Record<RainLight, { tint: readonly [number, number, number]; alpha: number }>> = Object.freeze({
  day: { tint: [0.95, 0.97, 1.0], alpha: 0.75 },
  dusk: { tint: [0.85, 0.88, 0.97], alpha: 0.8 },
  night: { tint: [0.65, 0.72, 0.9], alpha: 0.8 },
})

/** The number of drops for a tier; nothing at all when it is not wet. */
export function rainCount(tier: RainTier, wet: boolean): number {
  return wet ? RAIN_COUNT[tier] ?? RAIN_COUNT.wide : 0
}

/** The hash both sides use: a number in [0, 1). */
export function hash(n: number, seed: number): number {
  const s = Math.sin(n * 12.9898 + seed * 78.233) * 43758.5453
  return s - Math.floor(s)
}

/** `v` wrapped into [−size/2, size/2). */
export function wrap(v: number, size: number): number {
  const w = (v + size / 2) / size
  return (w - Math.floor(w)) * size - size / 2
}

export interface Drop { x: number; y: number; z: number; speed: number; vx: number; vy: number; vz: number }

/** Each drop falls a little faster or slower than the rest. */
export const dropSpeed = (i: number): number => 0.85 + 0.3 * hash(i, 9.3)

/** Where drop `i` is at `seconds`, in a box round `focus` (x, z), standing on the ground (y from 0 to the field's height). */
export function dropAt(i: number, seconds: number, field: RainField, focus: { x: number; z: number }): Drop {
  const speed = dropSpeed(i)
  const vx = field.wind[0] * speed, vy = -field.fall * speed, vz = field.wind[1] * speed
  const ax = hash(i, field.seed) * field.box + vx * seconds
  const ay = hash(i + 17.1, field.seed) * field.height + vy * seconds
  const az = hash(i * 1.37, field.seed + 3) * field.box + vz * seconds
  const fy = ay / field.height
  return { x: focus.x + wrap(ax - focus.x, field.box), y: (fy - Math.floor(fy)) * field.height, z: focus.z + wrap(az - focus.z, field.box), speed, vx, vy, vz }
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** The nearest a drop is drawn at (it fades in from 0.9 to 3.75 units from the camera). */
export const NEAR = [0.9, 3.75] as const

/**
 * How visible a drop is (0 to 1), before the intensity: faded close to the camera, at the edge of the box and at the cloud base, and gone
 * when `covered` (a roof or an awning is over it). `dist` is the distance to the camera, `edge` the horizontal distance to the focus.
 */
export function dropAlpha(p: { y: number }, dist: number, edge: number, field: RainField, covered: boolean): number {
  if (covered) return 0
  return smooth(NEAR[0], NEAR[1], dist) * smooth(field.box * 0.5, field.box * 0.28, edge) * smooth(field.height, field.height * 0.85, p.y)
}

/** Anything with a height at a place: the roof or awning over (x, z), or 0 where the sky is open (cover.ts). */
export interface Roofs { heightAt(x: number, z: number): number }

/** Is the point under a roof? */
export function underCover(roofs: Roofs | null | undefined, x: number, y: number, z: number): boolean {
  return Boolean(roofs) && y <= roofs!.heightAt(x, z)
}

/** The width a drop is drawn at: never thinner than about a pixel at its distance, with brightness conserved (alpha is scaled by `width / drawn`). */
export const PIXEL = 0.0011
export function drawnWidth(width: number, dist: number): number { return Math.max(width, dist * PIXEL) }

/** The streak length: the velocity relative to the camera as if exposed for 1/30 s, kept between a short dash and a long line. */
export function streakLength(relative: number, shutter = 1 / 30): number {
  return Math.min(5.2, Math.max(0.4, relative * shutter))
}
