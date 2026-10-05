import { toLocal } from '../../../geo/frame.ts'
import { pointInPart } from '../../../map3d/lga.ts'
import { FCT_RAIL } from '../../../map3d/geo/data/fct.ts'
import type { CityMapOrigin, LonLatPolygon } from '../../../types/content.ts'
import type { CityPack } from '../../../map3d/types.ts'

/** Ground-level track display follows sourced polylines, with no inferred connections between tracks. */
export function abujaRailDecoration(origin: CityMapOrigin, state: readonly LonLatPolygon[]): CityPack['decorate'] {
  const localState = state.map(polygon => polygon.map(ring => ring.map(([lon, lat]) => toLocal(origin, lon, lat))))
  const tracks = FCT_RAIL.flatMap(track => track.points.slice(1).flatMap((b, i) => {
    const a = track.points[i]
    if (!a) return []
    const p = toLocal(origin, a[0], a[1]), q = toLocal(origin, b[0], b[1])
    const x = (p[0] + q[0]) / 2, z = (p[1] + q[1]) / 2
    if (!localState.some(polygon => pointInPart(x, z, polygon))) return []
    return [{ x, z, length: Math.hypot(q[0] - p[0], q[1] - p[1]), heading: Math.atan2(q[0] - p[0], q[1] - p[1]), light: track.mode === 'light_rail' }]
  }))
  return batch => {
    for (const segment of tracks) {
      batch.box(segment.x, 0.035, segment.z, 0.16, 0.07, segment.length, segment.light ? '#657681' : '#70665b', { ry: segment.heading })
    }
  }
}
