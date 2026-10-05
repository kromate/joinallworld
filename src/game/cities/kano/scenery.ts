import { toLocal } from '../../../geo/frame.ts'
import { KANO_RAIL } from '../../../map3d/geo/data/kano.ts'
import type { CityMapOrigin } from '../../../types/content.ts'
import type { CityPack } from '../../../map3d/types.ts'
import { KANO_LANDMARKS } from './landmarks.ts'

/** Map-scale gate symbols and ground-level source railway segments. Dimensions are illustrative. */
export function kanoDecoration(origin: CityMapOrigin): CityPack['decorate'] {
  const rails = KANO_RAIL.flatMap(track => track.points.slice(1).flatMap((b, i) => {
    const a = track.points[i]
    if (!a) return []
    const p = toLocal(origin, a[0], a[1]), q = toLocal(origin, b[0], b[1])
    return [{ x: (p[0] + q[0]) / 2, z: (p[1] + q[1]) / 2,
      length: Math.hypot(q[0] - p[0], q[1] - p[1]), heading: Math.atan2(q[0] - p[0], q[1] - p[1]) }]
  }))
  const gates = KANO_LANDMARKS.filter(marker => ['kofar-nassarawa', 'kofar-mata', 'kofar-kabuga'].includes(marker.id))
    .map(marker => toLocal(origin, marker.lon, marker.lat))
  return batch => {
    for (const segment of rails) batch.box(segment.x, 0.035, segment.z, 0.16, 0.07, segment.length, '#70665b', { ry: segment.heading })
    for (const [x, z] of gates) {
      for (const offset of [-0.4, 0.4]) batch.box(x + offset, 0.6, z, 0.22, 1.2, 0.28, '#bc9162')
      batch.box(x, 1.18, z, 1.04, 0.2, 0.3, '#b28555')
    }
  }
}
