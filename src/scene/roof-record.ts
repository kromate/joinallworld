/**
 * OWNER: scenes
 * Notes the roofs and awnings a venue draws, as it draws them. Pure: no THREE, no DOM. A scene builder draws into a Batch; this wraps that batch,
 * passes every call on unchanged, and keeps the world box of each box or cylinder that is cover (high above a head, thin, wide). The boxes are
 * handed to the weather (src/scene/fx/cover.ts turns them into a 1 m grid) only if it rains or smokes there. This file is small on purpose: it is
 * the one piece of the weather a scene host imports statically; the rest is a lazy chunk.
 */
import type { Batch, BatchOptions } from './types.ts'

export type Box6 = readonly [number, number, number, number, number, number]

/** A box counts as cover when its underside is above a person's head, it is a slab rather than a wall, and it spans a real area. */
export const COVER = Object.freeze({ low: 2.6, thick: 1.4, area: 3 })
/** Boxes that are cover as they stand: their underside above a head, thin, wide. */
export function isCover([x0, y0, z0, x1, y1, z1]: Box6): boolean {
  return y0 >= COVER.low && y1 - y0 <= COVER.thick && (x1 - x0) * (z1 - z0) >= COVER.area
}


/** What the recorder notes: the world boxes of the high thin things the scene drew. */
export interface CoverRecorder { batch: Batch; boxes(): Box6[] }

/**
 * A Batch that passes everything on to `inner` and notes the world box of each box or cylinder that is cover. Put it between the scene's
 * builder and the footprint recorder; the picture is unchanged. At most 200 boxes are kept.
 */
export function coverRecorder(inner: Batch): CoverRecorder {
  const boxes: Box6[] = []
  function note(x: number, y: number, z: number, hx: number, hy: number, hz: number, o: BatchOptions | undefined): void {
    if (boxes.length >= 200) return
    const c = Math.cos(o?.ry || 0), s = Math.sin(o?.ry || 0)
    const cx = Math.cos(o?.rx || 0), sx0 = Math.sin(o?.rx || 0), cz = Math.cos(o?.rz || 0), sz0 = Math.sin(o?.rz || 0)
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (let i = 0; i < 8; i++) {
      let sx = i & 1 ? hx : -hx, sy = i & 2 ? hy : -hy, sz = i & 4 ? hz : -hz
      const ax = sx * cz - sy * sz0, ay = sx * sz0 + sy * cz
      const by = ay * cx - sz * sx0, bz = ay * sx0 + sz * cx
      sx = ax; sy = by; sz = bz
      const p = inner.world(x + sx * c + sz * s, y + sy, z - sx * s + sz * c)
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y)
    }
    const box: Box6 = [x0, y0, z0, x1, y1, z1]
    if (isCover(box)) boxes.push(box)
  }
  const batch: Batch = {
    isBatch: true,
    geometry(shape, colour, o) { inner.geometry(shape, colour, o); return batch },
    box(x, y, z, w, h, d, colour, o) { note(x, y, z, w / 2, h / 2, d / 2, o); inner.box(x, y, z, w, h, d, colour, o); return batch },
    cyl(x, y, z, r, h, colour, o) { note(x, y, z, r * (o?.sx || 1), h / 2, r * (o?.sz || 1), o); inner.cyl(x, y, z, r, h, colour, o); return batch },
    cone(x, y, z, r, h, colour, o) { note(x, y, z, r * (o?.sx || 1), h / 2, r * (o?.sz || 1), o); inner.cone(x, y, z, r, h, colour, o); return batch },
    ball(x, y, z, rx, ry, rz, colour, o) { inner.ball(x, y, z, rx, ry, rz, colour, o); return batch },
    ico(x, y, z, rx, ry, rz, colour, o) { inner.ico(x, y, z, rx, ry, rz, colour, o); return batch },
    quad(x, y, z, w, h, colour, o) { inner.quad(x, y, z, w, h, colour, o); return batch },
    disc(x, y, z, r, colour, o) { inner.disc(x, y, z, r, colour, o); return batch },
    at(x, y, z, ry, draw, rx, rz, scale) { inner.at(x, y, z, ry, () => draw(batch), rx, rz, scale); return batch },
    light(x, y, z, colour, intensity, distance) { inner.light(x, y, z, colour, intensity, distance); return batch },
    world: (x, y, z) => inner.world(x, y, z),
    get triangles() { return inner.triangles },
    build: (materials) => inner.build(materials),
    ...(inner.prepareAo ? { prepareAo: () => inner.prepareAo!() } : {}),
  }
  return { batch, boxes: () => boxes.slice() }
}
