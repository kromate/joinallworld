// Where the tour's card goes: beside the target, on the side with room, always inside the screen.
// Pure numbers in and out, so the collisions (a phone, an ultra-wide display, a target on each edge) are tested.

export interface Rect { left: number; top: number; width: number; height: number }
export interface Size { width: number; height: number }
export type Side = 'top' | 'bottom' | 'left' | 'right' | 'center'
export interface Placement {
  /** Which side of the target the card sits on; 'center' for no target, or when no side has room. */
  side: Side
  left: number
  top: number
  /** Where the arrow points, measured along the card's edge from its corner; null when there is no arrow. */
  arrow: number | null
  /** The card overlaps the target because nothing else fits (a target as big as the screen). */
  overlaps: boolean
}
export interface PlaceOptions { gap?: number; margin?: number; inset?: number; prefer?: Side }

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, high < low ? low : value))

export function placeCard(target: Rect | null, card: Size, view: Size, { gap = 14, margin = 12, inset = 22, prefer }: PlaceOptions = {}): Placement {
  const middle = (): Placement => ({ side: 'center', left: Math.round(clamp((view.width - card.width) / 2, margin, view.width - card.width - margin)), top: Math.round(clamp((view.height - card.height) / 2, margin, view.height - card.height - margin)), arrow: null, overlaps: false })
  if (!target) return middle()
  const right = target.left + target.width, bottom = target.top + target.height
  const room: Record<'top' | 'bottom' | 'left' | 'right', number> = { top: target.top - margin, bottom: view.height - bottom - margin, left: target.left - margin, right: view.width - right - margin }
  const need = (side: keyof typeof room): number => (side === 'top' || side === 'bottom' ? card.height : card.width) + gap
  const lower = target.top + target.height / 2 > view.height / 2
  const order: Exclude<Side, 'center'>[] = [...(prefer && prefer !== 'center' ? [prefer] : []), ...(lower ? ['top', 'bottom'] as const : ['bottom', 'top'] as const), 'right', 'left']
  const side = order.find((candidate) => room[candidate] >= need(candidate))
  const alongX = (): number => Math.round(clamp(target.left + target.width / 2 - card.width / 2, margin, view.width - card.width - margin))
  const alongY = (): number => Math.round(clamp(target.top + target.height / 2 - card.height / 2, margin, view.height - card.height - margin))
  if (side) {
    const vertical = side === 'top' || side === 'bottom'
    const left = vertical ? alongX() : side === 'left' ? Math.round(target.left - gap - card.width) : Math.round(right + gap)
    const top = vertical ? (side === 'top' ? Math.round(target.top - gap - card.height) : Math.round(bottom + gap)) : alongY()
    const arrow = vertical ? clamp(target.left + target.width / 2 - left, inset, card.width - inset) : clamp(target.top + target.height / 2 - top, inset, card.height - inset)
    return { side, left, top, arrow: Math.round(arrow), overlaps: false }
  }
  // Nothing has room: sit on the roomier of top and bottom, as far from the middle of the target as the screen allows, over it.
  const high = room.top >= room.bottom
  return { side: 'center', left: alongX(), top: Math.round(clamp(high ? margin : view.height - card.height - margin, margin, view.height - card.height - margin)), arrow: null, overlaps: true }
}

/** The spotlight around a target: its box plus padding, kept on screen, with a corner radius that follows the element's own. */
export function spotlightOf(target: Rect, view: Size, { pad = 8, radius = 12 }: { pad?: number; radius?: number } = {}): Rect & { radius: number } {
  const left = Math.max(0, target.left - pad), top = Math.max(0, target.top - pad)
  const width = Math.min(view.width, target.left + target.width + pad) - left, height = Math.min(view.height, target.top + target.height + pad) - top
  return { left, top, width, height, radius: Math.max(6, Math.min(radius + pad, Math.min(width, height) / 2)) }
}
