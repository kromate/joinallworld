import { toLocal } from '../../../geo/frame.ts'
import { pointInPart } from '../../../map3d/lga.ts'
import type { CityMapOrigin, LonLatPolygon } from '../../../types/content.ts'
import type { CityPack, Point2 } from '../../../map3d/types.ts'

/** Illustrative trees within sourced mangrove areas, not surveyed individual trees. */
export function mangroveSites(polygons: readonly LonLatPolygon[], origin: CityMapOrigin): Point2[] {
  const candidates: Point2[] = []
  for (const polygon of polygons) {
    const local = polygon.map(ring => ring.map(([lon, lat]) => toLocal(origin, lon, lat)))
    const outer = local[0]
    if (!outer?.length) continue
    const minX = Math.min(...outer.map(point => point[0])), maxX = Math.max(...outer.map(point => point[0]))
    const minZ = Math.min(...outer.map(point => point[1])), maxZ = Math.max(...outer.map(point => point[1]))
    for (let row = 0; row < 10; row++) for (let col = 0; col < 10; col++) {
      const x = minX + (maxX - minX) * (col + 0.5) / 10, z = minZ + (maxZ - minZ) * (row + 0.5) / 10
      if (pointInPart(x, z, local)) candidates.push([x, z])
    }
  }
  const stride = Math.max(1, Math.ceil(candidates.length / 96))
  return candidates.filter((_, index) => index % stride === 0)
}

export function mangroveDecoration(polygons: readonly LonLatPolygon[], origin: CityMapOrigin): CityPack['decorate'] {
  const sites = mangroveSites(polygons, origin)
  return batch => {
    for (const [x, z] of sites) {
      batch.cyl(x, 0.52, z, 0.07, 0.95, '#66563d', { seg: 5 })
      for (const angle of [0, Math.PI * 2 / 3, Math.PI * 4 / 3]) {
        batch.box(x + Math.sin(angle) * 0.16, 0.23, z + Math.cos(angle) * 0.16, 0.05, 0.55, 0.05, '#66563d', { rx: 0.55, ry: angle })
      }
      batch.cyl(x, 1.05, z, 0.48, 0.38, '#477656', { seg: 7 })
      batch.cone(x - 0.12, 1.32, z + 0.1, 0.4, 0.34, '#5a8658', { seg: 7 })
    }
  }
}
