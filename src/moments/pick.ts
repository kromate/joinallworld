// The moment picker: pure, deterministic and free of data (the banks are in index.ts). The same place, city, time window and seed
// give the same moment on the server, the worker and the browser, and the lines of one stretch of the day come round without a repeat.
//
// How it works. A band of the day (dawn, morning, …) is cut into windows of MOMENT_WINDOW_MS counted from the band's start.
// The moments that fit the place, the city, the band, the season and the active conditions form the pool. The pool is put in a
// seeded, weighted order (heavier lines tend to come earlier) and window k plays line k of it; after the last line the pool is
// re-ordered for the next cycle, and the new order never opens with the line that closed the last one. So no line repeats inside
// a cycle of pool.length windows. The order is seeded by the band's own start, so it stays put for the whole band. The only
// places a line can repeat are the band edges and a change in the active conditions, where the pool itself changes.
import { makeRng } from '../game/util.ts'
import { bandSpan, citySeason } from '../game/world-time.ts'
import type { CitySeason } from '../game/world-time.ts'
import type { CityClimate, SceneKind } from '../types/content.ts'
import type { Moment, MomentCondition } from './types.ts'
import type { TimeBand } from '../game/world-time.ts'

/** One moment plays for one window. */
export const MOMENT_WINDOW_MS = 60_000
/** A shown moment stays up this long at the start of its window. */
export const MOMENT_SHOW_MS = 14_000
/** The share of windows that show a moment at all, so a moment stays occasional. */
export const MOMENT_SHOW_RATE = 0.6

/** Where the moment happens: the venue's scene kind, and its variant where it has one (worship: 'church' | 'mosque'). */
export interface MomentPlace { kind: string; variant?: string | undefined }

export interface PickOptions {
  /** The city's climate (`CITY_RULES[cityId]?.climate`). Without it a season-bound line is never eligible. */
  climate?: Pick<CityClimate, 'rainChanceByMonth' | 'clearLabel' | 'harmattan'> | null | undefined
  /** Conditions that are active now. A line with `cond` waits for its condition. */
  conditions?: readonly MomentCondition[] | undefined
}

const fits = (moment: Moment, place: MomentPlace, cityId: string, band: TimeBand, season: CitySeason, conditions: readonly MomentCondition[]): boolean =>
  (!moment.placeKinds || moment.placeKinds.includes(place.kind as SceneKind))
  && (!moment.cityIds || moment.cityIds.includes(cityId))
  && (!moment.variants || (place.variant !== undefined && moment.variants.includes(place.variant)))
  && (!moment.bands || moment.bands.includes(band))
  && (moment.season?.wet === undefined || moment.season.wet === season.wet)
  && (moment.season?.harmattan === undefined || moment.season.harmattan === season.harmattan)
  && (!moment.cond || conditions.includes(moment.cond))

const finiteTime = (now: number): number => (Number.isFinite(now) ? now : 0)

/** The moments that may play at this place, in this city, at this time, sorted by id. */
export function eligibleMoments(bank: readonly Moment[], place: MomentPlace, cityId: string, now: number, options: PickOptions = {}): Moment[] {
  const span = bandSpan(finiteTime(now))
  const season = citySeason(options.climate, span.from)
  return bank.filter((moment) => fits(moment, place, cityId, span.band, season, options.conditions ?? [])).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** A seeded, weighted shuffle without replacement (Efraimidis–Spirakis): the line with the largest log(u) / weight comes first. */
function order(pool: readonly Moment[], seed: string): Moment[] {
  const next = makeRng(seed)
  return pool.map((moment) => ({ moment, key: Math.log(next() || 1e-12) / Math.max(moment.weight, 1e-6) }))
    .sort((a, b) => b.key - a.key || (a.moment.id < b.moment.id ? -1 : 1))
    .map((item) => item.moment)
}

/** The moment for this place and time from `bank`, or null when nothing fits. See the top of the file. */
export function pickFrom(bank: readonly Moment[], place: MomentPlace, cityId: string, now: number, seed: number | string, options: PickOptions = {}): Moment | null {
  const time = finiteTime(now)
  const span = bandSpan(time)
  const pool = eligibleMoments(bank, place, cityId, time, options)
  const count = pool.length
  if (!count) return null
  const window = Math.floor((time - span.from) / MOMENT_WINDOW_MS)
  const cycle = Math.floor(window / count)
  const base = `moment|${seed}|${cityId}|${place.kind}|${place.variant ?? ''}|${span.from}|${pool.map((moment) => moment.id).join(',')}`
  const lines = order(pool, `${base}|${cycle}`)
  if (cycle > 0 && count > 1) {
    const last = order(pool, `${base}|${cycle - 1}`)[count - 1] as Moment
    if ((lines[0] as Moment).id === last.id) [lines[0], lines[1]] = [lines[1] as Moment, lines[0] as Moment]
  }
  return lines[window - cycle * count] as Moment
}

/** Whether a moment is on show at this instant: a fixed share of windows, and only the first MOMENT_SHOW_MS of each. Pure, from the same seed. */
export function momentShown(now: number, seed: number | string): boolean {
  const time = finiteTime(now)
  const window = Math.floor(time / MOMENT_WINDOW_MS)
  return time - window * MOMENT_WINDOW_MS < MOMENT_SHOW_MS && makeRng(`moment-show|${seed}|${window}`)() < MOMENT_SHOW_RATE
}
