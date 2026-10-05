import type { ModuleCharacter, ModuleScene, RoadRows } from '../../../map3d/cities/module.ts'
import { citiesInState } from '../registry.ts'
import { OGUN_CHARACTER, OGUN_QUARTERS, OGUN_SCOPE, OGUN_SURROUNDINGS } from './character.ts'
import type { OgunCityId } from './character.ts'
import { OGUN_ROADS } from './roads.ts'
import { OGUN_WATER } from './water.ts'
import type { OgunLandmarkPoint } from './landmarks.ts'

type Row = readonly (string | number)[]

/** The rows of a road or water file that have a vertex inside [west, south, east, north] (degrees). A row is kept whole, so a road that leaves the box carries on. */
export function rowsWithin<T extends Row>(rows: readonly T[], [west, south, east, north]: readonly [number, number, number, number]): T[] {
  return rows.filter((row) => {
    let x = row[2] as number, y = row[3] as number
    const inside = () => x / 1e4 >= west && x / 1e4 <= east && y / 1e4 >= south && y / 1e4 <= north
    if (inside()) return true
    for (let i = 4; i + 1 < row.length; i += 2) {
      x += row[i] as number; y += row[i + 1] as number
      if (inside()) return true
    }
    return false
  })
}

/** Water rows (name, kind, first longitude and latitude, steps) as lines in degrees: a lake is a ring without its closing vertex. */
function waters(rows: readonly Row[]): NonNullable<ModuleCharacter['waters']> {
  return rows.map((row) => {
    const [name, kind, x0, y0, ...steps] = row as [string, 'lake' | 'river', number, number, ...number[]]
    let x = x0, y = y0
    const line: [number, number][] = [[x / 1e4, y / 1e4]]
    for (let i = 0; i + 1 < steps.length; i += 2) { x += steps[i]!; y += steps[i + 1]!; line.push([x / 1e4, y / 1e4]) }
    return { name, kind, line: kind === 'lake' && line.length > 3 ? line.slice(0, -1) : line, ...(kind === 'river' ? { width: name === 'Ogun' ? 0.8 : 0.5 } : {}) }
  })
}

/** Roads, water, character, names on the ground and the land around one Ogun city's map, ready for createModulePack. */
export function ogunScene(city: OgunCityId, landmarks: readonly OgunLandmarkPoint[]): ModuleScene {
  const scope = OGUN_SCOPE[city]
  const roads: RoadRows = rowsWithin(OGUN_ROADS, scope)
  return {
    landmarks: [...landmarks, ...OGUN_QUARTERS[city].map((quarter) => ({ ...quarter, kind: 'quarter' }))],
    roads,
    character: { ...OGUN_CHARACTER[city], waters: waters(rowsWithin(OGUN_WATER, scope)) },
    surroundings: { spec: OGUN_SURROUNDINGS[city], planned: ['osun', 'ondo', 'kwara'].filter((state) => citiesInState(state).some((city) => city.status !== 'open')) },
  }
}
