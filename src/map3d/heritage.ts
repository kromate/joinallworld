import type { CityPack, Point2 } from './types.ts'

/** Symbol widths/heights are for map legibility, not measurements of surviving structures. */
export const HERITAGE_STYLE = { colour: '#975936', width: 0.3, height: 0.18, dash: 0.8, gap: 0.6 } as const

export function heritageDashes(lines: NonNullable<CityPack['heritageLines']>): { from: Point2; to: Point2 }[] {
  const result: { from: Point2; to: Point2 }[] = []
  const cycle = HERITAGE_STYLE.dash + HERITAGE_STYLE.gap
  for (const line of lines) {
    let travelled = 0
    for (let i = 1; i < line.points.length; i++) {
      const a = line.points[i - 1], b = line.points[i]
      if (!a || !b) continue
      const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz)
      if (!length) continue
      let at = 0
      while (at < length) {
        const phase = (travelled + at) % cycle
        const draw = phase < HERITAGE_STYLE.dash
        const end = Math.min(length, at + Math.max(1e-8, (draw ? HERITAGE_STYLE.dash : cycle) - phase))
        if (draw && end - at > 1e-7) result.push({ from: [a[0] + dx * at / length, a[1] + dz * at / length], to: [a[0] + dx * end / length, a[1] + dz * end / length] })
        at = end
      }
      travelled += length
    }
  }
  return result
}
