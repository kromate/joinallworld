import type { CityRouteGeometry } from '../../../types/content.ts'
import { IBADAN_RAIL_ROUTE } from '../ibadan/landmarks.ts'

const northern = IBADAN_RAIL_ROUTE.segments[1]
if (!northern) throw new Error('Lagos–Ibadan rail source is incomplete')
const abeokutaIndex = northern.findIndex(([lon, lat]) => lon === 3.3869305 && lat === 7.1242979)
if (abeokutaIndex < 0) throw new Error('Lagos–Ibadan rail source is missing the Abeokuta approach')

/** OSM route vertices to the Abeokuta approach, then a schematic final segment to the mapped station point. */
const southern = IBADAN_RAIL_ROUTE.segments.flatMap((segment) => [...segment]).slice(0, IBADAN_RAIL_ROUTE.segments[0]?.length ?? 0)
const station = [3.39847, 7.12885] as const
export const ABEOKUTA_ROUTE_GEOMETRY: readonly CityRouteGeometry[] = Object.freeze([
  Object.freeze({ a: 'lagos', b: 'abeokuta', mode: 'rail', points: Object.freeze([...southern, ...northern.slice(0, abeokutaIndex + 1), station]) }),
  Object.freeze({ a: 'abeokuta', b: 'ibadan', mode: 'rail', points: Object.freeze([station, ...northern.slice(abeokutaIndex)]) }),
])

export const ABEOKUTA_RAIL_PROVENANCE = Object.freeze({
  source: IBADAN_RAIL_ROUTE.source,
  sourceSha256: IBADAN_RAIL_ROUTE.sourceSha256,
  licence: IBADAN_RAIL_ROUTE.licence,
  station: 'https://www.openstreetmap.org/node/8841632699',
  note: 'The last segment joins the nearest source-route vertex to the mapped Professor Wole Soyinka Station point.',
})
