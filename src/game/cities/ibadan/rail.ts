import type { CityRouteGeometry } from '../../../types/content.ts'
import { IBADAN_RAIL_ROUTE } from './landmarks.ts'

/**
 * The atlas needs one continuous journey line. All vertices come from OSM relation 10699301.
 * OSM currently leaves 23.4 m between the two source components; joining those two recorded
 * endpoints is the only schematic segment. No other bend is inferred.
 */
export const IBADAN_ROUTE_GEOMETRY: readonly CityRouteGeometry[] = Object.freeze([Object.freeze({
  a: 'lagos',
  b: 'ibadan',
  mode: 'rail',
  points: Object.freeze(IBADAN_RAIL_ROUTE.segments.flatMap((segment) => [...segment])),
})])

export const IBADAN_RAIL_PROVENANCE = Object.freeze({
  source: IBADAN_RAIL_ROUTE.source,
  sourceApi: IBADAN_RAIL_ROUTE.sourceApi,
  sourceSha256: IBADAN_RAIL_ROUTE.sourceSha256,
  licence: IBADAN_RAIL_ROUTE.licence,
  simplificationDegrees: 0.0005,
  schematicGap: IBADAN_RAIL_ROUTE.gap,
})
