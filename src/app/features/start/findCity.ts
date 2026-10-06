// "Find my city" on the landing, without a DOM: which open city a visitor is in, or the nearest one when they are somewhere that is
// not open yet.
//
// LOCATION PRIVACY (the same rule as "Find my area", world/lgaCardModel.ts). The browser is asked for a position only when the
// visitor taps the button, never before. The position is a local variable of one function: it is worked out against the city
// registry's own coordinates and the city packs fetched to this device, and what comes out is a city id and a name. It is never
// stored, logged, put in an event or sent: no request is made with it.
import { nearestCities, nearestCity } from '../../../paths.ts'
import type { NearCity } from '../../../paths.ts'
import { loadCityPackApi } from '../world/cityPack.ts'
import type { CityPackApi } from '../world/cityPack.ts'

/** What the visitor is told: where they are, and the open city to start in. */
export type CityFind =
  | { kind: 'in'; city: string; name: string; line: string }
  | { kind: 'near'; city: string; name: string; place: string | null; line: string }
  | { kind: 'none'; line: string }

export interface FindCityDeps {
  geolocation: Pick<Geolocation, 'getCurrentPosition'> | undefined
  /** Fetches the lazy city packs. */
  packs?: () => Promise<CityPackApi>
}

export const NO_CITY_LOCATION = 'This device cannot share a location. Choose where to start yourself instead.'
export const CITY_LOCATION_WHY: Readonly<Record<number, string>> = {
  1: 'Location is switched off for this site. Choose where to start yourself instead.',
  2: 'This device could not work out where it is. Choose where to start yourself instead.',
  3: 'Finding you took too long. Choose where to start yourself instead.',
}
/** How near a city that is not open yet must be to be named ("Kaduna is coming"). */
const NAMED_KM = 80
/** How many of the nearest open cities are looked into for a place the visitor is standing in. */
const LOOKED_INTO = 3

export async function findCity(deps: FindCityDeps = { geolocation: globalThis.navigator?.geolocation }): Promise<CityFind> {
  const { geolocation } = deps
  if (!geolocation) return { kind: 'none', line: NO_CITY_LOCATION }
  try {
    // The position exists only inside this function: it is reduced to a city and dropped.
    const at = await new Promise<{ lat: number; lon: number }>((resolve, reject) => geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lon: position.coords.longitude }),
      (error) => reject(error), { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }))
    const packs = await (deps.packs ?? loadCityPackApi)()
    for (const near of nearestCities(at.lat, at.lon, LOOKED_INTO)) {
      if (!packs.has(near.id)) continue
      const pack = await packs.load(near.id)
      if (pack && packs.resolve(pack, at.lat, at.lon)) return { kind: 'in', city: near.id, name: near.name, line: `You are in ${near.name} — start there?` }
    }
    const open: NearCity | null = nearestCity(at.lat, at.lon)
    if (!open) return { kind: 'none', line: NO_CITY_LOCATION }
    const coming = nearestCity(at.lat, at.lon, { open: false })
    const place = coming && coming.km <= NAMED_KM ? coming.name : null
    return { kind: 'near', city: open.id, name: open.name, place, line: `${place ? `${place} is coming` : 'Allworld is not open where you are yet'} — start in the nearest open city: ${open.name}` }
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    return { kind: 'none', line: typeof code === 'number' ? CITY_LOCATION_WHY[code] ?? CITY_LOCATION_WHY[2] ?? NO_CITY_LOCATION : CITY_LOCATION_WHY[2] ?? NO_CITY_LOCATION }
  }
}
