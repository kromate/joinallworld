// The drawings on the Houses and Cars apps, as data: original, procedural SVG, no photos. The
// components draw what these functions describe, so the geometry is tested without a browser.

// ---- houses --------------------------------------------------------------------------------

const SKIES: readonly (readonly [string, string])[] = [['#f7c98b', '#e98f6a'], ['#9fd8f0', '#5aa9dd'], ['#8fd3c8', '#3f9f9a'], ['#b7a4f0', '#6a5acd'], ['#27336b', '#0f1a3d']]
const WALLS = ['#e8d2b0', '#f1ede4', '#f6f3ee', '#ffffff', '#f3ecd9'] as const

export interface Pane { x: string; y: string; width: number; height: number; fill: string; opacity?: number; door?: true }
export interface HouseArt {
  sky: readonly [string, string]
  /** The sun or moon. */
  sun: string
  wall: { x: number; y: number; width: number; height: number; fill: string }
  roof: { kind: 'pitched'; d: string } | { kind: 'flat'; x: number; y: number; width: number }
  panes: Pane[]
  /** x of each palm tree. */
  palms: number[]
}

/** A house tier drawn: the higher the tier, the wider and taller the building and the later the sky. `tier` is 0-based. */
export function houseArt(tier: number): HouseArt {
  const sky = SKIES[Math.min(tier, SKIES.length - 1)] ?? SKIES[0] as readonly [string, string]
  const floors = 1 + Math.min(3, tier), width = 62 + tier * 18, x = 160 - width / 2, floor = 20
  const height = floors * floor, y = 92 - height
  const cols = 2 + Math.min(4, tier)
  const panes: Pane[] = []
  for (let row = 0; row < floors; row++) for (let col = 0; col < cols; col++) {
    const wx = x + 8 + col * ((width - 16) / cols) + ((width - 16) / cols - 9) / 2, wy = y + 5 + row * floor
    if (row === floors - 1 && col === Math.floor(cols / 2)) panes.push({ x: wx.toFixed(1), y: (wy + 1).toFixed(1), width: 9, height: 14, fill: '#5b3a26', door: true })
    else panes.push({ x: wx.toFixed(1), y: wy.toFixed(1), width: 9, height: 9, fill: tier >= 4 ? '#ffe9a6' : '#fff', opacity: 0.9 })
  }
  return {
    sky, sun: tier >= 4 ? '#f4f1d0' : '#fff3c4',
    wall: { x, y, width, height, fill: WALLS[Math.min(tier, 4)] ?? '#ffffff' },
    roof: tier < 2 ? { kind: 'pitched', d: `M${x - 6} ${y}L160 ${y - 18}L${x + width + 6} ${y}Z` } : { kind: 'flat', x: x - 4, y: y - 5, width: width + 8 },
    panes,
    palms: [...(tier >= 2 ? [52] : []), ...(tier >= 3 ? [278] : [])],
  }
}

/** The two paths of a palm tree whose trunk stands at `x`. */
export const palmPaths = (x: number): { trunk: string; leaves: string } => ({
  trunk: `M${x} 92V66`,
  leaves: `M${x} 66c-10-8-18-4-20 2 8-4 14-2 20-2Zm0 0c10-8 18-4 20 2-8-4-14-2-20-2Zm0 0c-2-12 6-16 12-14-6 4-9 8-12 14Zm0 0c2-12-6-16-12-14 6 4 9 8 12 14Z`,
})

// ---- cars ----------------------------------------------------------------------------------

/** Which silhouette a car id is drawn as; anything not listed is a saloon. */
const SHAPES: Readonly<Record<string, CarKind>> = { 'agama-150': 'bike', 'boardroom-330': 'coupe', 'marina-v6': 'suv', 'chief-suv': 'suv', 'harmattan-cruiser': 'suv', 'atlantic-x': 'suv', 'atlantic-grand': 'suv' }
const PAINT = ['#e2543b', '#3b82c4', '#1f2937', '#0f766e', '#b7791f', '#7c3aed', '#be123c', '#0e7490', '#111827'] as const

export type CarKind = 'bike' | 'saloon' | 'suv' | 'coupe'
export interface CarArt {
  paint: string
  kind: CarKind
  /** The body, as the paths and strokes of its silhouette. */
  body: { d: string; fill?: string; stroke?: string; strokeWidth?: number }[]
  /** The saddle of a bike. */
  seat: boolean
  wheels: { x: number; r: number }[]
}

export function carArt(carId: string, index: number): CarArt {
  const paint = PAINT[index % PAINT.length] ?? '#e2543b'
  const kind = SHAPES[carId] ?? 'saloon'
  const glass = '#dff1fb'
  switch (kind) {
    case 'bike': return { paint, kind, seat: true, wheels: [{ x: 118, r: 13 }, { x: 194, r: 13 }], body: [{ d: 'M118 74l22-26h30l14 26M140 48l-8-12h-12M170 48l16-10h14', stroke: paint, strokeWidth: 7 }] }
    case 'suv': return { paint, kind, seat: false, wheels: [{ x: 118, r: 13 }, { x: 204, r: 13 }], body: [{ d: 'M84 74V50a8 8 0 0 1 7-8l14-2 14-18a8 8 0 0 1 6-3h62a8 8 0 0 1 7 4l10 18 22 5a8 8 0 0 1 6 8v20Z', fill: paint }, { d: 'M124 40l11-14h26v14Zm43-14h24l8 14h-32Z', fill: glass }] }
    case 'coupe': return { paint, kind, seat: false, wheels: [{ x: 116, r: 11 }, { x: 208, r: 11 }], body: [{ d: 'M80 74V60a8 8 0 0 1 6-8l30-7 24-13a10 10 0 0 1 5-1h30a10 10 0 0 1 7 3l16 14 34 6a8 8 0 0 1 6 8v12Z', fill: paint }, { d: 'M128 46l18-10h26l12 11Z', fill: glass }] }
    default: return { paint, kind, seat: false, wheels: [{ x: 116, r: 11 }, { x: 206, r: 11 }], body: [{ d: 'M82 74V56a8 8 0 0 1 6-8l22-4 18-16a8 8 0 0 1 5-2h46a8 8 0 0 1 6 3l14 16 28 5a8 8 0 0 1 7 8v16Z', fill: paint }, { d: 'M122 44l13-12h22v12Zm41-12h18l11 12h-29Z', fill: glass }] }
  }
}
