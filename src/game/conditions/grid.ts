// The grid: when NEPA takes light in a district. Split from ./conditions.ts because the home system settles its generator against it on every tick,
// so it is part of the first download; the rest of the conditions (match nights, the venue-card line) load with the venue and the moments.
// Pure and seeded by the city, the Lagos day and the district: the same on every host. Every rate and time here is an original beta value.
import { lagosDayStart, lagosTime } from '../clock.ts'
import { makeRng } from '../util.ts'

export interface Span { from: number; to: number }

const MINUTE = 60000
const DAY_MS = 86400000

/** The chance that a district loses light at all on a given day, then the chance of a second cut. Original beta values. */
export const POWER_CUT_CHANCE = 0.55
const SECOND_CUT_CHANCE = 0.2
/** A cut lasts between 1½ and 4 hours; 7 in 10 begin in the evening (16:00–23:00), the rest in the morning or the afternoon (05:00–14:00). */
const CUT_MINUTES = [90, 240] as const
const EVENING_SHARE = 0.7

/** The cuts one district has on one Lagos day, in order and merged where they touch. A cut that begins late may run on into the next day. */
export function powerCutsOn(cityId: string, district: string, day: number): Span[] {
  const rng = makeRng(`power|${cityId}|${Math.floor(day)}|${district}`)
  if (rng() >= POWER_CUT_CHANCE) return []
  const count = rng() < SECOND_CUT_CHANCE ? 2 : 1
  const start = lagosDayStart(day)
  const cuts: Span[] = []
  for (let i = 0; i < count; i++) {
    const evening = rng() < EVENING_SHARE
    const begin = evening ? 960 + Math.floor(rng() * 28) * 15 : 300 + Math.floor(rng() * 37) * 15
    const length = CUT_MINUTES[0] + Math.floor(rng() * ((CUT_MINUTES[1] - CUT_MINUTES[0]) / 15 + 1)) * 15
    cuts.push({ from: start + begin * MINUTE, to: start + (begin + length) * MINUTE })
  }
  cuts.sort((a, b) => a.from - b.from)
  const merged: Span[] = []
  for (const cut of cuts) {
    const last = merged[merged.length - 1]
    if (last && cut.from <= last.to) last.to = Math.max(last.to, cut.to)
    else merged.push(cut)
  }
  return merged
}

/** The cut a moment is inside, or null while the grid is on. Yesterday's late cut counts. */
export function powerCutAt(cityId: string, district: string, now: number): Span | null {
  const { day } = lagosTime(now)
  for (const when of [day - 1, day]) for (const cut of powerCutsOn(cityId, district, when)) if (now >= cut.from && now < cut.to) return cut
  return null
}

/** The seconds the grid was off in a district between two moments. Bounded to two weeks, so a long absence is settled in a few lookups. */
export function outageSeconds(cityId: string, district: string, from: number, to: number): number {
  const first = Math.max(from, to - 14 * DAY_MS)
  if (!(to > first)) return 0
  let total = 0
  for (let day = lagosTime(first).day - 1; day <= lagosTime(to).day; day++) {
    for (const cut of powerCutsOn(cityId, district, day)) total += Math.max(0, Math.min(to, cut.to) - Math.max(first, cut.from))
  }
  return Math.round(total / 1000)
}

/** What a home or a venue sees of the grid at `now`: is the light on, and until when is it off. */
export function gridAt(cityId: string, district: string, now: number): { on: boolean; until: number | null } {
  const cut = powerCutAt(cityId, district, now)
  return { on: !cut, until: cut ? cut.to : null }
}
