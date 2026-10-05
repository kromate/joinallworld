/**
 * OWNER: world
 * Which city did a tap mean? Pure — no Three.js, no DOM. The atlas hands in where each open city's dot and name are on
 * the screen (CSS pixels) and the state under the finger; this answers with a city or null.
 *
 * A small state is a few pixels wide on a phone, so the polygon under a finger is often a neighbour's. The order:
 *   0. on the dot itself (within `core` pixels, the size of the drawn dot): that city;
 *   1. on a city's name as drawn: that city;
 *   2. on a dot (within `exact` pixels): the nearest dot;
 *   2b. inside a name grown to at least `touch` pixels each way: the nearest name;
 *   3. near a dot (within half a `touch` target): a city of the state under the finger first, else the nearest dot;
 *   4. nothing: null, and the caller falls back to the state under the finger.
 */
import type { LabelBox } from './labels.ts';

/** The smallest target a finger is given, in CSS pixels. */
export const MIN_TOUCH_PX = 44;
/** A tap this close to a dot is a tap on that dot, whatever else is near. */
export const DOT_EXACT_PX = 12;
/** The drawn dot's own size: a tap on it is that city even where a name is drawn over it. */
export const DOT_CORE_PX = 5;

export interface CityTarget {
  id: string;
  /** The dot. */
  x: number; y: number;
  /** The state the city is in. */
  state?: string | null;
  /** Where its name is on the screen, if it has one. */
  label?: LabelBox | null;
}
export interface CityHitOptions { touch?: number; exact?: number; core?: number; stateUnder?: string | null }

const grown = (box: LabelBox, touch: number): LabelBox => {
  const w = box.right - box.left, h = box.bottom - box.top, cx = (box.left + box.right) / 2, cy = (box.top + box.bottom) / 2, hw = Math.max(w, touch) / 2, hh = Math.max(h, touch) / 2;
  return { left: cx - hw, right: cx + hw, top: cy - hh, bottom: cy + hh };
};

export function cityHit(point: { x: number; y: number }, targets: readonly CityTarget[], { touch = MIN_TOUCH_PX, exact = DOT_EXACT_PX, core = DOT_CORE_PX, stateUnder = null }: CityHitOptions = {}): string | null {
  const away = (target: CityTarget): number => Math.hypot(target.x - point.x, target.y - point.y);
  const nearest = (list: readonly CityTarget[], limit: number, by: (target: CityTarget) => number = away): CityTarget | null => {
    let best: CityTarget | null = null, least = limit;
    for (const target of list) { const d = by(target); if (d <= least) { least = d; best = target; } }
    return best;
  };
  const inside = (box: LabelBox): boolean => point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;
  const middle = (target: CityTarget): number => Math.hypot((target.label!.left + target.label!.right) / 2 - point.x, (target.label!.top + target.label!.bottom) / 2 - point.y);
  const onCore = nearest(targets, core);
  if (onCore) return onCore.id;
  const drawn = nearest(targets.filter(target => target.label && inside(target.label)), Infinity, middle);
  if (drawn) return drawn.id;
  const onDot = nearest(targets, exact);
  if (onDot) return onDot.id;
  const onName = nearest(targets.filter(target => target.label && inside(grown(target.label, touch))), Infinity, middle);
  if (onName) return onName.id;
  const close = targets.filter(target => away(target) <= touch / 2);
  const own = stateUnder ? close.filter(target => target.state === stateUnder) : [];
  return (nearest(own, Infinity) ?? nearest(close, Infinity))?.id ?? null;
}
