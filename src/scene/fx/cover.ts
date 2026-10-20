/**
 * OWNER: scenes
 * What is over your head. Pure: no THREE, no DOM. A scene's roofs and awnings become a 1 m grid of heights, built once; rain.ts uploads it as a
 * small texture and drops that would fall under a roof are not drawn. Ways in:
 *
 *   (the recorder that notes a venue's awnings as it draws is ../roof-record.ts: it is the one part a scene host imports, so it lives outside fx)
 *   coverFromBoxes()  turns boxes [x0, y0, z0, x1, y1, z1] into the grid (the street plan's buildings are such boxes);
 *   createCover()     an empty grid to fill with add().
 *
 * Heights are stored in a byte (0 is open sky), so a roof is known to 1/8 of a unit up to the cap, and the grid is never wider than 256 cells.
 */
import { COVER, isCover } from '../roof-record.ts'
import type { Box6 } from '../roof-record.ts'
import type { Roofs } from './rain-plan.ts'

export type { Box6 }
/** [minX, minZ, maxX, maxZ] */
export type Rect4 = readonly [number, number, number, number]

/** One metre in scene units, the grid's cell. */
export const CELL = 1.5
/** The tallest roof the grid keeps. */
export const CAP = 32

export interface Cover extends Roofs {
  readonly x0: number
  readonly z0: number
  readonly cols: number
  readonly rows: number
  readonly cell: number
  readonly cap: number
  /** One byte per cell, row by row from z0: 0 is open, otherwise height / cap * 255. */
  readonly data: Uint8Array
  /** True while nothing has been added. */
  readonly empty: boolean
  /** Put a roof of height `top` over the rectangle (the higher of two wins). */
  add(x0: number, z0: number, x1: number, z1: number, top: number): void
  /** Is the grid's footprint known at (x, z)? Outside it the sky is taken as open. */
  inside(x: number, z: number): boolean
}

/** An empty grid over `bounds` ([minX, minZ, maxX, maxZ]). The cell grows when the bounds are wider than `maxSide` cells. */
export function createCover(bounds: Rect4, { cell = CELL, cap = CAP, maxSide = 256 }: { cell?: number; cap?: number; maxSide?: number } = {}): Cover {
  const [bx0, bz0, bx1, bz1] = bounds
  const size = cell * Math.max(1, Math.ceil(Math.max(bx1 - bx0, bz1 - bz0) / cell / maxSide))
  const cols = Math.max(1, Math.ceil((bx1 - bx0) / size)), rows = Math.max(1, Math.ceil((bz1 - bz0) / size))
  const data = new Uint8Array(cols * rows)
  let empty = true
  const at = (x: number, z: number): number => {
    const c = Math.floor((x - bx0) / size), r = Math.floor((z - bz0) / size)
    return c < 0 || r < 0 || c >= cols || r >= rows ? -1 : r * cols + c
  }
  return {
    x0: bx0, z0: bz0, cols, rows, cell: size, cap, data,
    get empty() { return empty },
    inside: (x, z) => at(x, z) >= 0,
    heightAt(x, z) { const i = at(x, z); return i < 0 ? 0 : (data[i]! / 255) * cap },
    add(x0, z0, x1, z1, top) {
      if (![x0, z0, x1, z1, top].every(Number.isFinite) || top <= 0) return
      const value = Math.max(1, Math.min(255, Math.ceil((Math.min(top, cap) / cap) * 255)))
      let c0 = Math.max(0, Math.ceil((Math.min(x0, x1) - bx0) / size - 0.5)), c1 = Math.min(cols - 1, Math.floor((Math.max(x0, x1) - bx0) / size - 0.5))
      let r0 = Math.max(0, Math.ceil((Math.min(z0, z1) - bz0) / size - 0.5)), r1 = Math.min(rows - 1, Math.floor((Math.max(z0, z1) - bz0) / size - 0.5))
      // A roof smaller than a cell still covers the cell it is in.
      if (c1 < c0) { c0 = c1 = Math.floor(((x0 + x1) / 2 - bx0) / size) }
      if (r1 < r0) { r0 = r1 = Math.floor(((z0 + z1) / 2 - bz0) / size) }
      for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++) {
        for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) {
          const i = r * cols + c
          if (data[i]! < value) { data[i] = value; empty = false }
        }
      }
    },
  }
}

/** A grid over `bounds` with every box that is cover in it. */
export function coverFromBoxes(boxes: readonly Box6[], bounds: Rect4, options?: Parameters<typeof createCover>[1]): Cover {
  const cover = createCover(bounds, options)
  for (const box of boxes) if (isCover(box)) cover.add(box[0], box[2], box[3], box[5], box[4])
  return cover
}

/**
 * A grid for buildings whose boxes run from the ground up (the street's houses): a building is cover from its roof down, whatever its
 * height, so boxes are taken as they are when they reach `low` or higher.
 */
export function coverFromBuildings(boxes: readonly Box6[], bounds: Rect4, options?: Parameters<typeof createCover>[1]): Cover {
  const cover = createCover(bounds, options)
  for (const box of boxes) if (box[4] >= COVER.low && (box[3] - box[0]) * (box[5] - box[2]) >= COVER.area) cover.add(box[0], box[2], box[3], box[5], box[4])
  return cover
}
