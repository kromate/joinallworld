// A city to offer a first-time visitor before they ask: the open city of the device's own time zone ("America/Sao_Paulo" is São Paulo).
// Worked out on the device from a setting the browser already has: no permission is asked, nothing is sent or stored. It is only an offer
// under Play ("Start in São Paulo"): Play itself stays as it is. A visitor in Nigeria's zone gets none, and so does a zone with no open city.
import { cityName, isOpenCityId, loadCityIndex } from '../../../game/cities/registry.ts'
import type { CityFind } from './findCity.ts'

/** Zones whose own name is not an open city: an old spelling, or a large city of the same country that has none of its own yet. */
export const ZONE_CITY: Readonly<Record<string, string>> = {
  calcutta: 'delhi', kolkata: 'delhi', karachi: 'lahore', saigon: 'ho-chi-minh-city', 'ho-chi-minh': 'ho-chi-minh-city', katmandu: 'kathmandu', rangoon: 'yangon',
  kiev: 'kyiv', kuwait: 'kuwait-city', qatar: 'doha', makassar: 'jakarta', jayapura: 'jakarta', pontianak: 'jakarta', kuching: 'kuala-lumpur', urumqi: 'shanghai',
  yekaterinburg: 'moscow', novosibirsk: 'moscow', samara: 'moscow', krasnoyarsk: 'moscow', vladivostok: 'moscow', volgograd: 'moscow',
  johannesburg: 'cape-town', douala: 'yaounde', blantyre: 'lilongwe', asmera: 'asmara', 'porto-novo': 'cotonou', lubumbashi: 'kinshasa',
  chicago: 'new-york', 'los-angeles': 'new-york', denver: 'new-york', phoenix: 'new-york', detroit: 'new-york', indianapolis: 'new-york', anchorage: 'new-york', honolulu: 'new-york',
  vancouver: 'toronto', edmonton: 'toronto', winnipeg: 'toronto', halifax: 'toronto', regina: 'toronto',
  tijuana: 'mexico-city', monterrey: 'mexico-city', cancun: 'mexico-city', merida: 'mexico-city', mazatlan: 'mexico-city', chihuahua: 'mexico-city', hermosillo: 'mexico-city',
  panama: 'panama-city', guatemala: 'guatemala-city', 'costa-rica': 'san-jose', jamaica: 'kingston', guayaquil: 'quito',
  fortaleza: 'sao-paulo', recife: 'sao-paulo', manaus: 'sao-paulo', belem: 'sao-paulo', bahia: 'sao-paulo', maceio: 'sao-paulo', cuiaba: 'sao-paulo', 'campo-grande': 'sao-paulo',
  cordoba: 'buenos-aires', mendoza: 'buenos-aires', tucuman: 'buenos-aires', salta: 'buenos-aires',
  melbourne: 'sydney', brisbane: 'sydney', perth: 'sydney', adelaide: 'sydney', hobart: 'sydney', darwin: 'sydney',
}

/** "America/Argentina/Buenos_Aires" → "buenos-aires". */
export const zoneSlug = (zone: string): string => (zone.split('/').pop() ?? '').toLowerCase().replace(/_/g, '-')

/** The open city for a time zone name, or null. Reads the city index, so the caller waits for loadCityIndex() first. */
export function cityOfZone(zone: string): string | null {
  const slug = zoneSlug(zone)
  const id = isOpenCityId(slug) ? slug : ZONE_CITY[slug]
  return id && id !== 'lagos' && isOpenCityId(id) ? id : null
}

export async function suggestCity(zone: string | undefined = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return undefined } })()): Promise<CityFind | null> {
  if (!zone || zone === 'Africa/Lagos') return null
  await loadCityIndex()
  const city = cityOfZone(zone), name = city ? cityName(city) : null
  return city && name ? { kind: 'near', city, name, place: null, line: `${name} is open in Allworld — start there?` } : null
}
