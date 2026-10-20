/**
 * OWNER: news (docs/OPEN-SOURCE-PLAN.md, Phase 4)
 * WHAT THE PAGE TELLS THE TICKER: the adapter from the running game (the city, the life, the gist the store holds) to the ticker's source
 * (ticker.ts). Kept apart from Ticker.vue so it can be tested without a page: the component only hands over the handles.
 *
 * The outages are the conditions code's own answer (src/game/conditions/grid.ts powerCutAt, the same one the scene's lamps and the generators
 * read), asked for the districts of the city the player is in, the player's own district first. Nothing here changes a lamp or a generator.
 */
import { powerCutAt } from '../game/conditions/grid.ts'
import { cachedCityContent, cityRules } from '../game/cities/registry.ts'
import { registerFor } from './banks.ts'
import type { GistItem, LifeSnapshot, Outage } from './observer.ts'
import type { TickerSource } from './ticker.ts'

/** The districts of a city that have venues, the one the player stands in first (a city whose content is not loaded yet has none). */
export function districtsOf(city: string, venueId?: string): string[] {
  const venues = cachedCityContent(city)?.venues ?? []
  const own = venues.find((venue) => venue.id === venueId)?.district
  return [...new Set([...(own ? [own] : []), ...venues.map((venue) => venue.district)])]
}

/** The districts out of light now, in the order given. `cutAt` is the conditions code's powerCutAt, replaceable for tests. */
export function outagesIn(city: string, districts: readonly string[], now: number, cutAt: typeof powerCutAt = powerCutAt): Outage[] {
  const out: Outage[] = []
  for (const district of districts) {
    const cut = cutAt(city, district, now)
    if (cut) out.push({ district, from: cut.from })
  }
  return out
}

/** The few numbers of a life the ticker watches; anything missing reads as zero, never as a change. */
export function lifeOf(state: { cash?: unknown; career?: { level?: unknown } | null; goals?: { chain?: unknown } | null } | null | undefined): LifeSnapshot | null {
  if (!state) return null
  const number = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  return { cash: number(state.cash), level: number(state.career?.level), goals: number(state.goals?.chain) }
}

export interface LiveHandles {
  cityId(): string
  /** The player's life, and the venue they stand in. */
  state(): { location?: string; cash?: unknown; career?: { level?: unknown } | null; goals?: { chain?: unknown } | null } | null
  /** The lines of the gist store, for the city asked for (empty when it holds another city's). */
  gistLines(city: string): readonly GistItem[]
  askGist(city: string, now: number): void
  now?(): number
}

export function liveSource(handles: LiveHandles): TickerSource {
  const city = (): string => handles.cityId()
  // The grid changes on quarter hours; asking once a minute is plenty (and the page asks every few seconds).
  let asked = { key: '', out: [] as Outage[] }
  return {
    city,
    cityName: () => cityRules(city())?.name ?? 'the city',
    register: () => registerFor(city(), cityRules(city())?.country?.id),
    now: handles.now ?? Date.now,
    gist: () => handles.gistLines(city()),
    life: () => lifeOf(handles.state()),
    outages: (now) => {
      const venue = handles.state()?.location, key = `${city()}|${venue ?? ''}|${Math.floor(now / 60000)}`
      if (asked.key !== key) asked = { key, out: outagesIn(city(), districtsOf(city(), venue), now) }
      return asked.out
    },
    refresh: (now) => handles.askGist(city(), now),
  }
}
