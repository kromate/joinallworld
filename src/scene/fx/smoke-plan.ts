/**
 * OWNER: scenes
 * Smoke, planned. Pure: no THREE, no DOM. A grill smokes and a generator that is running exhausts; each is a SOURCE at a place, and its puffs are a
 * function of (puff index, seconds): they rise, thin out, grow and lean with the wind, and begin again, so nothing is stored per puff. smoke.ts draws
 * them with the same formulas in a shader. Sources come from the landmarks a venue scene already names (the grill stands where venues-social.ts
 * says), and a running generator (an outage at a place that has one) puts one source behind the venue.
 */
import type { RainTier } from './rain-plan.ts'

export type SmokeKind = 'grill' | 'generator'
export interface SmokeSource { kind: SmokeKind; x: number; y: number; z: number }
/** A scene landmark, as much of it as the planner reads (src/scene/props.ts). */
export interface LandmarkLike { key: string; x: number; y?: number; z: number }

/** The words that name them (the landmarks' own). */
export const GRILL = /suya|grill|smoke/i, GENERATOR = /generator|exhaust/i
/** Puffs a source makes at each tier, and the most sources a scene smokes from. */
export const PUFFS: Readonly<Record<RainTier, number>> = Object.freeze({ phone: 6, wide: 12, high: 20 })
export const MAX_SOURCES = 4

/** How each kind behaves: the seconds a puff lives, how high it rises, its size at the start and the end, its strength and grey. */
export const SMOKE = Object.freeze({
  grill: { life: 3.4, rise: 5.5, size: [0.5, 2.6], alpha: 0.32, grey: 0.82, lift: 1.7 },
  generator: { life: 2.2, rise: 3.0, size: [0.35, 1.6], alpha: 0.4, grey: 0.28, lift: 1.4 },
} as const)

/**
 * The sources of a scene: a grill at every landmark whose key says so, a generator at one that says that, and when no landmark does but the generator
 * is running, one at `behind` (a place at the back of the venue). At most four.
 */
export function smokeSources(landmarks: readonly LandmarkLike[], { generatorRunning = false, behind = null }: { generatorRunning?: boolean; behind?: { x: number; z: number } | null } = {}): SmokeSource[] {
  const out: SmokeSource[] = []
  for (const landmark of landmarks) {
    const kind: SmokeKind | null = GENERATOR.test(landmark.key) ? (generatorRunning ? 'generator' : null) : GRILL.test(landmark.key) ? 'grill' : null
    if (kind && [landmark.x, landmark.z].every(Number.isFinite)) out.push({ kind, x: landmark.x, y: (landmark.y ?? 0) + SMOKE[kind].lift, z: landmark.z })
  }
  if (generatorRunning && behind && !out.some((source) => source.kind === 'generator')) out.push({ kind: 'generator', x: behind.x, y: SMOKE.generator.lift, z: behind.z })
  return out.slice(0, MAX_SOURCES)
}

export const hash = (n: number, seed: number): number => { const s = Math.sin(n * 12.9898 + seed * 78.233) * 43758.5453; return s - Math.floor(s) }

export interface Puff { x: number; y: number; z: number; size: number; alpha: number; age: number }

/** Puff `k` of source `e` at `seconds`; `wind` is [x, z] in units a second. age runs 0 to 1 over its life. */
export function puffAt(source: SmokeSource, e: number, k: number, perSource: number, seconds: number, wind: readonly [number, number]): Puff {
  const kind = SMOKE[source.kind], t = seconds / kind.life + k / perSource, age = t - Math.floor(t), cycle = Math.floor(t)
  const jx = hash(k + cycle * 7, e + 3) - 0.5, jz = hash(k + cycle * 7, e + 5) - 0.5
  const spread = 0.5 * (1 - age * 0.5), lean = age * kind.life * 0.35
  const smooth = Math.min(1, age / 0.08)
  return {
    x: source.x + jx * spread + wind[0] * lean + Math.sin(t * 2.1 + k) * 0.25 * age,
    y: source.y + age * kind.rise,
    z: source.z + jz * spread + wind[1] * lean,
    size: kind.size[0] + (kind.size[1] - kind.size[0]) * age,
    alpha: (1 - age) * (1 - age) * smooth * smooth * (3 - 2 * smooth) * kind.alpha,
    age,
  }
}
