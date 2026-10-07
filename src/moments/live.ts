// The live side of the moments: what the venue card asks for. Lazy, like the rest of src/moments/ (see index.ts).
import { CITY_RULES, cachedCityContent } from '../game/cities/registry.ts'
import { daySeed } from '../game/world-time.ts'
import { momentShown, pickMoment } from './index.ts'

/** How often the venue card asks again. A moment lasts MOMENT_SHOW_MS inside a 60 s window, so this never misses one. */
export const MOMENT_POLL_MS = 5_000

const LAGOS_OFFSET_MS = 3_600_000
const DAY_MS = 86_400_000

/** The moment line on show at this venue right now, or '' when none is. `location` is state.location ('home' for the player's house). */
export function momentLine(cityId: string, location: string, now: number = Date.now()): string {
  const venue = location === 'home' ? null : cachedCityContent(cityId)?.venues.find((item) => item.id === location)
  const place = location === 'home' ? { kind: 'home' } : venue ? { kind: venue.kind, variant: venue.definition.scene?.variant } : { kind: location }
  const seed = `${daySeed(cityId, Math.floor((now + LAGOS_OFFSET_MS) / DAY_MS))}|${location}`
  if (!momentShown(now, seed)) return ''
  return pickMoment(place, cityId, now, seed, { climate: CITY_RULES[cityId]?.climate })?.text ?? ''
}
