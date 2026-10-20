/**
 * OWNER: scenes
 * The weather of one scene: its rain (rain.ts) and its smoke (smoke.ts) behind one small door, so each host (a venue, the street, a home) needs one
 * lazy import() and a handful of lines. This file is the lazy chunk's entry; a scene that is dry and has nothing to smoke never loads it.
 *
 *   createWeather({ THREE, parent, ... })   null when there is nothing to draw
 *   weather.update(look, sources)           the city's conditions or the sources changed
 *   weather.wake() / step(dt) / settle()    the wake window, as the ambient layer has it (src/scene/ambient/layer.ts)
 *
 * BATTERY RULE: nothing here asks for a frame. The host calls wake() when it opens its window of frames, step(dt) inside it, and settle() for
 * reduced motion (a still frame). When the window ends the weather stands where it was.
 */
import type * as THREE from 'three'
import type { ThreeModule, TimeOfDay } from '../types.ts'
import type { LookConditions } from '../../game/conditions/look.ts'
import { renderTier } from '../look.ts'
import { createRain } from './rain.ts'
import type { Rain } from './rain.ts'
import { createSmoke } from './smoke.ts'
import type { Smoke } from './smoke.ts'
import { rainCount } from './rain-plan.ts'
import type { RainTier } from './rain-plan.ts'
import { coverFromBoxes, coverFromBuildings } from './cover.ts'
import type { Box6, Rect4 } from './cover.ts'
import { smokeSources } from './smoke-plan.ts'
import type { LandmarkLike, SmokeSource } from './smoke-plan.ts'

export { wetFromQuery, withWetQuery } from '../weather-query.ts'

/** Seconds of frames the weather asks for after it is woken (the same window as the people: ambient/layer.ts WINDOW_MS). */
export const WINDOW_S = 12
/** How much of the day's light the smoke is lit with. */
const LEVEL: Record<TimeOfDay, number> = { day: 1, dusk: 0.75, night: 0.45 }

export interface WeatherOptions {
  THREE: ThreeModule
  parent: THREE.Object3D
  /** Does it rain here at all? False for a room with a ceiling: only the smoke is drawn. */
  open?: boolean
  /**
   * What is over the heads, as boxes [x0, y0, z0, x1, y1, z1] inside `bounds`. A venue's are the awnings and roofs its builder drew
   * (src/scene/roof-record.ts); `buildings` says the boxes are houses that run from the ground (the street's), cover from the roof down.
   */
  roofs?: { boxes: readonly Box6[]; bounds: Rect4; buildings?: boolean } | null
  tier?: RainTier
  time?: TimeOfDay
}

export interface Weather {
  readonly rain: Rain | null
  readonly smoke: Smoke | null
  /** Draw calls the weather costs now. */
  readonly drawCalls: number
  readonly awake: boolean
  readonly active: boolean
  /** The conditions or the place's landmarks changed: rain if wet, a grill's smoke, a running generator's exhaust. */
  update(look: Readonly<Pick<LookConditions, 'wet' | 'outage' | 'generator'>>, place?: { landmarks?: readonly LandmarkLike[]; behind?: { x: number; z: number } | null }): void
  setTime(time: TimeOfDay): void
  /** Open the window. False when there is nothing to draw. */
  wake(): boolean
  /** True while the window is open. */
  step(dt: number): boolean
  settle(): void
  dispose(): void
}

const sameSources = (a: readonly SmokeSource[], b: readonly SmokeSource[]): boolean =>
  a.length === b.length && a.every((s, i) => s.kind === b[i]!.kind && s.x === b[i]!.x && s.y === b[i]!.y && s.z === b[i]!.z)

export function createWeather({ THREE, parent, open = true, roofs = null, tier = renderTier().name, time = 'day' }: WeatherOptions): Weather {
  let rain: Rain | null = null, smoke: Smoke | null = null, sources: readonly SmokeSource[] = [], left = 0, still = false, gone = false, day: TimeOfDay = time
  const active = (): boolean => (rain?.active ?? false) || smoke !== null
  const api: Weather = {
    get rain() { return rain },
    get smoke() { return smoke },
    get drawCalls() { return (rain?.active ? rain.drawCalls : 0) + (smoke?.drawCalls ?? 0) },
    get awake() { return left > 0 },
    get active() { return active() },
    update(look, place = {}) {
      if (gone) return
      const next = smokeSources(place.landmarks ?? [], { generatorRunning: Boolean(look.outage && look.generator), behind: place.behind ?? null })
      if (open && rainCount(tier, Boolean(look.wet)) > 0) {
        rain ||= createRain({ THREE, parent, tier, cover: roofs ? (roofs.buildings ? coverFromBuildings : coverFromBoxes)(roofs.boxes, roofs.bounds) : null, light: day })
        rain.setActive(true)
        if (still) rain.settle()
      } else rain?.setActive(false)
      if (!sameSources(sources, next)) {
        sources = next.slice()
        smoke?.dispose()
        smoke = createSmoke({ THREE, parent, tier, sources })
        smoke?.setLevel(LEVEL[day])
        if (still) smoke?.settle()
      }
      if (!active()) left = 0
    },
    setTime(next) { day = next; rain?.setLight(next); smoke?.setLevel(LEVEL[next]) },
    wake() { if (gone || !active()) return false; left = WINDOW_S; still = false; return true },
    step(dt) {
      if (gone || left <= 0) return false
      left = Math.max(0, left - dt)
      if (rain?.active) rain.step(dt)
      smoke?.step(dt)
      if (left <= 0) rain?.rest()
      return left > 0
    },
    settle() { left = 0; still = true; rain?.settle(); smoke?.settle() },
    dispose() { gone = true; rain?.dispose(); smoke?.dispose(); rain = null; smoke = null },
  }
  return api
}
