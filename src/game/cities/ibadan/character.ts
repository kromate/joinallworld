import type { ModuleCharacter } from '../../../map3d/cities/module.ts'
import { IBADAN_WATER } from './water.ts'
import { IBADAN_RAIL_ROUTE, IBADAN_LANDMARK_POINTS } from './landmarks.ts'

type Line = readonly (readonly [number, number])[]

/** Rows of water.ts (name, kind, first longitude and latitude in 0.0001 degrees, then steps) as lines in degrees. */
function waters(): NonNullable<ModuleCharacter['waters']> {
  return IBADAN_WATER.map((row) => {
    const [name, kind, x0, y0, ...steps] = row as [string, 'lake' | 'river', number, number, ...number[]]
    let x = x0, y = y0
    const line: [number, number][] = [[x / 1e4, y / 1e4]]
    for (let i = 0; i + 1 < steps.length; i += 2) { x += steps[i]!; y += steps[i + 1]!; line.push([x / 1e4, y / 1e4]) }
    return { name, kind, line: kind === 'lake' && line.length > 3 ? line.slice(0, -1) : line, ...(kind === 'river' ? { width: 0.55 } : {}) }
  })
}

const station = IBADAN_LANDMARK_POINTS.find((point) => point.id === 'moniya-station')

/**
 * How Ibadan reads from above: old brown-roofed Mapo, Beere, Oje and Oja'ba against the planned, leafy Bodija, the university,
 * Jericho and Agodi; the seven hills as low mounds (centres are approximate: the data holds no peaks); the Ogunpa and the Eleyele
 * water; the standard-gauge line with its station; and the roads that carry the city.
 */
export const IBADAN_CHARACTER: ModuleCharacter = {
  extent: 'city',
  notable: ['cocoa-house', 'mapo-hall', 'bowers-tower', 'ui-campus', 'lekan-salami-stadium', 'uch', 'eleyele-lake', 'moniya-station', 'ibadan-airport', 'challenge-interchange'],
  areas: [
    { name: 'Mapo and Oja’ba', lon: 3.8975, lat: 7.3775, km: 1.1, tone: 'old' },
    { name: 'Beere and Oje', lon: 3.9120, lat: 7.3715, km: 1.2, tone: 'old' },
    { name: 'Oke Aremo and Idi Arere', lon: 3.8985, lat: 7.3905, km: 1.1, tone: 'old' },
    { name: 'Dugbe and Ayeye', lon: 3.8800, lat: 7.3850, km: 1.0, tone: 'old' },
    { name: 'Bodija', lon: 3.9120, lat: 7.4300, km: 1.4, tone: 'planned' },
    { name: 'University of Ibadan', lon: 3.9000, lat: 7.4440, km: 1.5, tone: 'planned' },
    { name: 'Jericho', lon: 3.8660, lat: 7.3960, km: 0.9, tone: 'planned' },
    { name: 'Agodi GRA', lon: 3.8960, lat: 7.4090, km: 1.0, tone: 'planned' },
  ],
  hills: [
    { name: 'Mapo', lon: 3.8960, lat: 7.3770, km: 1.0, rise: 1.0 },
    { name: 'Oke Aare', lon: 3.8966, lat: 7.3920, km: 1.1, rise: 1.1 },
    { name: 'Oke Ado', lon: 3.8745, lat: 7.3795, km: 0.9, rise: 0.8 },
    { name: 'Oke Sapati', lon: 3.9215, lat: 7.3690, km: 0.9, rise: 0.8 },
    { name: 'Oke Padre', lon: 3.9060, lat: 7.3620, km: 0.8, rise: 0.7 },
    { name: 'Agodi', lon: 3.9030, lat: 7.4050, km: 1.0, rise: 0.8 },
  ],
  waters: waters(),
  rails: [{
    name: IBADAN_RAIL_ROUTE.name,
    lines: IBADAN_RAIL_ROUTE.segments.map((segment) => segment as Line),
    stations: station ? [{ name: 'Obafemi Awolowo Station', lon: station.lon, lat: station.lat }] : [],
  }],
  trunkRoads: ['Lagos-Ibadan Expressway', 'Ibadan-Ilorin Expressway', 'Ile-Ife Expressway', 'Akala Expressway', 'Lagos Bypass', 'Ring Road', 'Ibadan Circular Road'],
}
