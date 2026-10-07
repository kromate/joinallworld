// The live side of the moments: what the venue card asks for. Lazy, like the rest of src/moments/ (see index.ts).
import { CITY_RULES, cachedCityContent } from '../game/cities/registry.ts'
import { daySeed } from '../game/world-time.ts'
import { conditionsAt, noticeLine, powerCutsOn } from '../game/conditions/conditions.ts'
import { momentShown, pickMoment } from './index.ts'
import type { MomentCondition } from './types.ts'

/** How often the venue card asks again. A moment lasts MOMENT_SHOW_MS inside a 60 s window, so this never misses one. */
export const MOMENT_POLL_MS = 5_000

const LAGOS_OFFSET_MS = 3_600_000
const DAY_MS = 86_400_000

/** How long after the light comes back its lines (cheering, fans spinning up) still fit. */
const RESTORED_MS = 10 * 60_000

/** The venue a location names in a city (null for home, or a place the city does not have). */
const venueAt = (cityId: string, location: string) => (location === 'home' ? null : cachedCityContent(cityId)?.venues.find((item) => item.id === location) ?? null)

/** What the city is going through at this venue, in the words the moments use: a cut in its district, the rain, the go-slow, a match at a viewing centre. */
export function momentConditions(cityId: string, location: string, now: number): MomentCondition[] {
  const venue = venueAt(cityId, location)
  const district = venue?.definition.district
  const found = new Set<MomentCondition>()
  for (const item of conditionsAt(cityId, now, district ? [district] : [])) {
    if (item.kind === 'match-night' && !(item.venues ?? []).includes(location)) continue
    found.add(item.kind)
  }
  if (district && !found.has('power-cut')) {
    const day = Math.floor((now + LAGOS_OFFSET_MS) / DAY_MS)
    for (const when of [day - 1, day]) if (powerCutsOn(cityId, district, when).some((cut) => now >= cut.to && now < cut.to + RESTORED_MS)) found.add('power-restored')
  }
  return [...found]
}

/** The line of the venue card about the grid or the match here, or '' when there is none. */
export function noticeAt(cityId: string, location: string, now: number = Date.now()): string {
  const venue = venueAt(cityId, location)
  return venue ? noticeLine(cityId, { id: venue.id, district: venue.definition.district, generator: venue.definition.generator }, now) : ''
}

/** The moment line on show at this venue right now, or '' when none is. `location` is state.location ('home' for the player's house). */
export function momentLine(cityId: string, location: string, now: number = Date.now()): string {
  const venue = venueAt(cityId, location)
  const place = location === 'home' ? { kind: 'home' } : venue ? { kind: venue.kind, variant: venue.definition.scene?.variant } : { kind: location }
  const seed = `${daySeed(cityId, Math.floor((now + LAGOS_OFFSET_MS) / DAY_MS))}|${location}`
  if (!momentShown(now, seed)) return ''
  return pickMoment(place, cityId, now, seed, { climate: CITY_RULES[cityId]?.climate, conditions: momentConditions(cityId, location, now) })?.text ?? ''
}
