// What a tap on the 3D place landed on, worked out from where things are on the screen (the host's diagnostics()). Pure, so it is tested without a browser.
// The host decides what a tap does (walk, open a person, open a table); this only works out what to SAY about it.

export interface Pt { x: number; y: number }
export interface ScreenItem { id: string; px: number; py: number }
export interface TapScene { spots?: ScreenItem[]; things?: ScreenItem[]; people?: ScreenItem[]; objects?: ScreenItem[] }
export type TapKind = 'spot' | 'thing' | 'person' | 'object' | 'none'
export interface TapHit { kind: TapKind; id: string; px: number; py: number; away: number }

/** How close (CSS pixels) a tap has to be to the middle of each kind of thing to count as on it. A fingertip is wider than a mouse pointer. */
export const REACH = { person: 34, thing: 46, object: 34, spot: 40 } as const

/** The nearest thing a tap is on, people first, then game tables, then furniture, then spots; 'none' when it is on bare ground or scenery. */
export function classifyTap(scene: TapScene, at: Pt): TapHit {
  const order: [TapKind, ScreenItem[] | undefined, number][] = [['person', scene.people, REACH.person], ['thing', scene.things, REACH.thing], ['object', scene.objects, REACH.object], ['spot', scene.spots, REACH.spot]]
  for (const [kind, list, reach] of order) {
    let best: TapHit | null = null
    for (const item of list ?? []) {
      const away = Math.hypot(item.px - at.x, item.py - at.y)
      if (away <= reach && (!best || away < best.away)) best = { kind, id: item.id, px: item.px, py: item.py, away }
    }
    if (best) return best
  }
  return { kind: 'none', id: '', px: at.x, py: at.y, away: 0 }
}

/** The spot nearest to a point on the screen, or null when the place has none. */
export function nearestSpot<T extends ScreenItem>(spots: readonly T[] | undefined, at: Pt): T | null {
  let best: T | null = null, bestAway = Infinity
  for (const spot of spots ?? []) { const away = Math.hypot(spot.px - at.x, spot.py - at.y); if (away < bestAway) { best = spot; bestAway = away } }
  return best
}

/** Whether the avatar went anywhere because of a tap: it is walking, or it is not where it was. A tap that did neither landed on something that cannot be walked to. */
export function wentSomewhere(before: { x: number; z: number }, after: { x: number; z: number; moving: boolean }): boolean {
  return after.moving || Math.hypot(after.x - before.x, after.z - before.z) > 0.05
}

/** Where a card of this size goes: beside a point, above it when there is room, kept inside the box. */
export function placeCard(at: Pt, card: { w: number; h: number }, box: { w: number; h: number }, top = 0, gap = 26): Pt {
  const x = Math.min(Math.max(at.x - card.w / 2, 8), Math.max(8, box.w - card.w - 8))
  const above = at.y - gap - card.h
  const y = above >= top + 8 ? above : Math.min(at.y + gap, Math.max(top + 8, box.h - card.h - 8))
  return { x, y }
}
