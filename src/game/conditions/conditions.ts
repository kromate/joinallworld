// City conditions: what the city is going through at a given minute, the same on every host (docs/REALISM.md §7, §8).
//
//   power-cut    NEPA has taken light in a district for a few hours, mostly in the evening. Places on a generator keep their lights.
//   go-slow      the road jams in the rush (./rush.ts, which the travel system reads on its own).
//   match-night  a game on: the viewing centres fill up.
//   rain         the city's weather now (weatherAt), so there is one sky.
//
// Pure arithmetic on a server time, a city id and a district name: no DOM, no three, no stored state, no network. Power cuts and match nights are
// seeded by daySeed(cityId, day) (src/game/world-time.ts), so two hosts asked about the same city and the same minute give the same answer, and a
// player who comes back after three days is owed exactly the outage the clock says there was. Every rate and time here is an original beta value.
import { formatHour, lagosDayStart, lagosTime } from '../clock.ts'
import { isCityId } from '../cities/registry.ts'
import { weatherAt } from '../systems/health.ts'
import { makeRng } from '../util.ts'
import { daySeed } from '../world-time.ts'
import { goSlowFactor, rushAt } from './rush.ts'

export type ConditionKind = 'power-cut' | 'go-slow' | 'match-night' | 'rain'

/** One thing the city is going through. `from` is inclusive and `to` exclusive, in server ms. */
export interface CityCondition {
  id: string
  kind: ConditionKind
  from: number
  to: number
  /** The districts it touches; absent when it covers the whole city. */
  districts?: string[]
  /** The venues it touches; absent when it covers every venue. */
  venues?: string[]
}

export interface Span { from: number; to: number }

const MINUTE = 60000
const DAY_MS = 86400000

// ---- power ---------------------------------------------------------------------------------------------------------------------------------

/** The chance that a district loses light at all on a given day, then the chance of a second cut. Original beta values. */
export const POWER_CUT_CHANCE = 0.55
const SECOND_CUT_CHANCE = 0.2
/** A cut lasts between 1½ and 4 hours; 7 in 10 begin in the evening (16:00–23:00), the rest in the morning or the afternoon (05:00–14:00). */
const CUT_MINUTES = [90, 240] as const
const EVENING_SHARE = 0.7

/** Venues with a generator of their own, by id (every city shares the ids): the lights stay on and a hum is heard. A venue definition may set `generator` itself. */
const GENERATOR_VENUES: ReadonlySet<string> = new Set(['cchub', 'office', 'quilox', 'rooftop', 'palms', 'hospital', 'state-house', 'radio', 'i-fitness', 'airport', 'refinery', 'unilag',
  'police', 'salon', 'viewing-centre', 'church', 'shrine'])
export const venueHasGenerator = (venue: { id: string; generator?: boolean }): boolean => venue.generator ?? GENERATOR_VENUES.has(venue.id)

/** The cuts one district has on one Lagos day, in order and merged where they touch. A cut that begins late may run on into the next day. */
export function powerCutsOn(cityId: string, district: string, day: number): Span[] {
  const rng = makeRng(`power|${daySeed(cityId, day)}|${district}`)
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

// ---- match nights --------------------------------------------------------------------------------------------------------------------------

/** A game is on: the chance by weekday (0 = Sunday), and when the kickoffs are. Weekends have the big games, midweek has the cups. */
const MATCH_CHANCE = [0.6, 0.15, 0.3, 0.35, 0.3, 0.25, 0.65] as const
const KICKOFFS = [1020, 1140, 1230] as const // 17:00, 19:00, 20:30
const MATCH_MINUTES = 120
const MATCH_VENUES = ['viewing-centre']

/** The match on a Lagos day, or null. Seeded by the day, so every host agrees. */
export function matchOn(cityId: string, day: number): Span | null {
  const rng = makeRng(`match|${daySeed(cityId, day)}`)
  if (rng() >= MATCH_CHANCE[lagosTime(lagosDayStart(day)).weekday]!) return null
  const kickoff = KICKOFFS[Math.floor(rng() * KICKOFFS.length)]!
  return { from: lagosDayStart(day) + kickoff * MINUTE, to: lagosDayStart(day) + (kickoff + MATCH_MINUTES) * MINUTE }
}

// ---- everything at once --------------------------------------------------------------------------------------------------------------------

/**
 * What the city is going through at `now`. Rain, the go-slow and a match night cover the city; a power cut is reported for each of `districts`
 * that has one (the city does not name its own districts here: a venue's district is its own label, so the caller says which ones it asks about).
 * Pure and seeded, so asking twice, or from two hosts, gives the same list in the same order.
 */
export function conditionsAt(cityId: string, now: number, districts: readonly string[] = []): CityCondition[] {
  const found: CityCondition[] = []
  if (isCityId(cityId)) {
    const sky = weatherAt(now, cityId)
    if (sky.raining) found.push({ id: `rain|${sky.until}`, kind: 'rain', from: sky.until - 20 * MINUTE, to: sky.until })
  }
  const jam = rushAt(now)
  if (jam) found.push({ id: `go-slow|${jam.from}`, kind: 'go-slow', from: jam.from, to: jam.to })
  const match = matchOn(cityId, lagosTime(now).day)
  if (match && now >= match.from && now < match.to) found.push({ id: `match-night|${match.from}`, kind: 'match-night', from: match.from, to: match.to, venues: MATCH_VENUES })
  for (const district of [...new Set(districts)].sort()) {
    const cut = powerCutAt(cityId, district, now)
    if (cut) found.push({ id: `power-cut|${district}|${cut.from}`, kind: 'power-cut', from: cut.from, to: cut.to, districts: [district] })
  }
  return found
}

/** How much longer a road trip takes right now (1 on an open road). */
export const slowFactorAt = (cityId: string, now: number): number => (rushAt(now) ? goSlowFactor(cityId) : 1)

// ---- what the player is told -----------------------------------------------------------------------------------------------------------------

const hourOf = (ms: number): string => formatHour(lagosTime(ms).minuteOfDay / 60)

/**
 * The one line of the venue card: light off around the district until when, with a word for a place that runs on a generator, or the match
 * at a viewing centre; '' when there is nothing to say. `place` is the venue the player stands at.
 */
export function noticeLine(cityId: string, place: { id: string; district: string; generator?: boolean }, now: number): string {
  const cut = powerCutAt(cityId, place.district, now)
  if (cut) return `Light is off around ${place.district} until ${hourOf(cut.to)}.${venueHasGenerator(place) ? ' This place is on generator.' : ''}`
  const match = matchOn(cityId, lagosTime(now).day)
  if (match && now >= match.from && now < match.to && MATCH_VENUES.includes(place.id)) return `Match on here until ${hourOf(match.to)}. Come early for a seat.`
  return ''
}

/** What a home or a venue sees of the grid at `now`: is the light on, and until when is it off. */
export function gridAt(cityId: string, district: string, now: number): { on: boolean; until: number | null } {
  const cut = powerCutAt(cityId, district, now)
  return { on: !cut, until: cut ? cut.to : null }
}
