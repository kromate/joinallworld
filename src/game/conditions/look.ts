// How the city's conditions change the light of a place you are standing in. Pure: a lighting preset in, a lighting preset out; the scene host
// draws whatever it is given. Only the 3D venue scenes read this, and they load on demand, so nothing here is in the page's first download.
//   a power cut      the lamps and the glow of windows go down; a place on a generator keeps most of them, a little lower and steadier
//   harmattan        a dusty, yellowish haze in the sky and the light, and a weaker sun
//   the rains        a grey-blue sky and a flatter light
// Every number is an original beta value.
import { citySeason } from '../world-time.ts'
import { powerCutAt, venueHasGenerator } from './conditions.ts'
import type { CityClimate } from '../../types/content.ts'
import type { Lighting } from '../../scene/types.ts'

export interface LookConditions {
  /** The district's NEPA light is off. */
  outage: boolean
  /** The place runs a generator of its own. */
  generator: boolean
  wet: boolean
  harmattan: boolean
}

/** No condition at all: the preset comes back unchanged. */
export const CLEAR_LOOK: Readonly<LookConditions> = Object.freeze({ outage: false, generator: false, wet: false, harmattan: false })

const HAZE = '#d8c39a'
const RAIN = '#8d9db1'

const channel = (hex: string, at: number): number => parseInt(hex.slice(1 + at * 2, 3 + at * 2), 16)
/** `a` moved `amount` (0–1) of the way to `b`; both are #rrggbb. Anything else is returned as it came. */
export function tint(a: string, b: string, amount: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(b)) return a
  let out = '#'
  for (let at = 0; at < 3; at++) out += Math.round(channel(a, at) + (channel(b, at) - channel(a, at)) * amount).toString(16).padStart(2, '0')
  return out
}

/** `base` as the conditions leave it. The result is a new object; `base` is never changed, and no conditions gives back an equal preset. */
export function adjustLighting(base: Lighting, now: Readonly<LookConditions>): Lighting {
  if (!now.outage && !now.wet && !now.harmattan) return base
  let { glow, lamps } = base
  let hemiPower = base.hemi[2], sunPower = base.sun[1]
  let sky: [string, string] = [...base.sky], hemi: [string, string] = [base.hemi[0], base.hemi[1]]
  if (now.outage) {
    // Dark outside the generator's reach; a generator keeps the room lit, only a little dimmer.
    lamps *= now.generator ? 0.75 : 0.2
    glow *= now.generator ? 0.85 : 0.45
    hemiPower *= now.generator ? 0.95 : 0.85
  }
  if (now.harmattan) {
    sky = [tint(sky[0], HAZE, 0.4), tint(sky[1], HAZE, 0.25)]
    hemi = [tint(hemi[0], HAZE, 0.3), tint(hemi[1], HAZE, 0.2)]
    sunPower *= 0.85
  }
  if (now.wet) {
    sky = [tint(sky[0], RAIN, 0.35), tint(sky[1], RAIN, 0.3)]
    hemi = [tint(hemi[0], RAIN, 0.25), tint(hemi[1], RAIN, 0.15)]
    sunPower *= 0.75
    hemiPower *= 0.95
  }
  return { ...base, sky, hemi: [hemi[0], hemi[1], hemiPower], sun: [base.sun[0], sunPower, base.sun[2]], glow, lamps }
}

/** What a place's light has to reckon with at `now`: its district's power, whether it has a generator, and the season of its city. */
export function lookAt(cityId: string, place: { id?: string; district?: string; generator?: boolean } | null | undefined, climate: Pick<CityClimate, 'rainChanceByMonth' | 'clearLabel' | 'harmattan'> | null | undefined, now: number): LookConditions {
  const season = citySeason(climate, now)
  const outage = Boolean(place?.district && powerCutAt(cityId, place.district, now))
  return { outage, generator: Boolean(place?.id) && venueHasGenerator({ id: place!.id!, generator: place?.generator }), wet: season.wet, harmattan: season.harmattan }
}

/** A short key of the four flags, so a scene can tell that the conditions changed and the light needs redrawing. */
export const lookKey = (look: Readonly<LookConditions>): string => `${look.outage ? 'o' : ''}${look.generator ? 'g' : ''}${look.wet ? 'w' : ''}${look.harmattan ? 'h' : ''}`
