// The moment banks, assembled, and the one function the game calls. This file and everything under src/moments/ is loaded lazily
// (a dynamic import behind the ?models=moments flag), so the lines never enter the startup bundle. The picker itself is in pick.ts.
import { ANYWHERE, CONDITIONED, MINOR_KINDS } from './common.ts'
import { MAIN_KINDS } from './kinds.ts'
import { CITY_MOMENTS } from './cities.ts'
import { pickFrom } from './pick.ts'
import type { MomentPlace, PickOptions } from './pick.ts'
import type { Moment } from './types.ts'

export { MOMENT_SHOW_MS, MOMENT_SHOW_RATE, MOMENT_WINDOW_MS, eligibleMoments, momentShown } from './pick.ts'
export type { MomentPlace, PickOptions } from './pick.ts'
export type { Moment, MomentCondition, MomentFx, MomentLang } from './types.ts'

/** Every moment line, all banks together. Ids are unique across it. */
export const MOMENT_BANK: readonly Moment[] = Object.freeze([...ANYWHERE, ...CONDITIONED, ...MINOR_KINDS, ...MAIN_KINDS, ...CITY_MOMENTS])

/** The moment for this place, city and instant (`now` in epoch ms), or null when nothing fits. Pure: the same arguments give the same line. */
export function pickMoment(place: MomentPlace, cityId: string, now: number, seed: number | string, options: PickOptions = {}): Moment | null {
  return pickFrom(MOMENT_BANK, place, cityId, now, seed, options)
}
