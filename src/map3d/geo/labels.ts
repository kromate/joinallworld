/**
 * OWNER: world
 * Which labels fit. Pure — no DOM: the atlas measures nothing, it estimates a label's box from
 * its text, and this decides what is shown so that two labels never overlap.
 *
 *   textWidth(text, size)                         an estimate, a little generous
 *   placeLabels(candidates, { cap, pad, width, height })  → the labels to show, most important first
 *
 * LabelCandidate:
 *   x, y      where it points, in CSS pixels
 *   room      how wide the thing it names is on screen; a name wider than its region is abbreviated or dropped
 *   short     the abbreviation to fall back on
 *   note      a second, smaller line under the name
 *   fixed     shown whatever it overlaps (the "You are here" marker)
 *   cls, title  carried through for the atlas's DOM node (a class list and a tooltip)
 */

export type LabelAnchor = 'centre' | 'above' | 'right';
export interface LabelBox { left: number; top: number; right: number; bottom: number }
export interface LabelCandidate { id: string; x: number; y: number; priority: number; size?: number; room?: number | undefined,
  text: string; short?: string | undefined; note?: string | undefined; anchor?: LabelAnchor | undefined; fixed?: boolean | undefined; cls?: string | undefined; title?: string | undefined }
export interface PlacedLabel extends LabelCandidate { shown: string; abbreviated: boolean; box: LabelBox }

/** The hard cap on labels on screen at once. */
export const LABEL_CAP = 44;

export const textWidth = (text: unknown, size = 12): number => Math.ceil(String(text).length * size * 0.6) + 10;

const boxOf = (candidate: LabelCandidate, text: string): LabelBox => {
  const size = candidate.size || 12, w = Math.max(textWidth(text, size), candidate.note ? textWidth(candidate.note, 10) : 0) + (candidate.note ? 8 : 0), h = Math.round(size * 1.5) + (candidate.note ? 16 : 0);
  if (candidate.anchor === 'above') return { left: candidate.x - w / 2, right: candidate.x + w / 2, top: candidate.y - h - 8, bottom: candidate.y - 8 };
  if (candidate.anchor === 'right') return { left: candidate.x + 7, right: candidate.x + 7 + w, top: candidate.y - h / 2, bottom: candidate.y + h / 2 };
  return { left: candidate.x - w / 2, right: candidate.x + w / 2, top: candidate.y - h / 2, bottom: candidate.y + h / 2 };
};
const overlaps = (a: LabelBox, b: LabelBox, pad: number): boolean => a.left < b.right + pad && b.left < a.right + pad && a.top < b.bottom + pad && b.top < a.bottom + pad;

/** The space kept between a label that is always shown and the edge of the screen, in CSS pixels. */
export const EDGE_MARGIN = 8;
/** How far a box must move to lie inside `0..limit` with `margin` to spare; none when it already does (or cannot fit). */
const nudge = (low: number, high: number, limit: number, margin: number): number => {
  if (!Number.isFinite(limit) || high - low > limit - 2 * margin) return low < margin ? margin - low : 0;
  return low < margin ? margin - low : high > limit - margin ? limit - margin - high : 0;
};

export interface PlaceOptions { cap?: number; pad?: number; width?: number; height?: number; avoid?: readonly LabelBox[] }
/**
 * options.width/height: the screen; a label wholly outside it is skipped, and a label that is always shown (`fixed`) is moved to lie
 * inside it with EDGE_MARGIN to spare, so the place you are in is never cut off at the edge. options.avoid: boxes nothing may cover (the panels).
 */
export function placeLabels(candidates: readonly LabelCandidate[], { cap = LABEL_CAP, pad = 3, width = Infinity, height = Infinity, avoid = [] }: PlaceOptions = {}): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  const ordered = [...candidates].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
  for (const candidate of ordered) {
    if (placed.length >= cap) break;
    for (const text of candidate.short && candidate.short !== candidate.text ? [candidate.text, candidate.short] : [candidate.text]) {
      if (candidate.room !== undefined && textWidth(text, candidate.size) > candidate.room) continue;
      let box = boxOf(candidate, text), at = candidate;
      if (box.right < 0 || box.left > width || box.bottom < 0 || box.top > height) break;
      if (candidate.fixed) {
        const dx = nudge(box.left, box.right, width, EDGE_MARGIN), dy = nudge(box.top, box.bottom, height, EDGE_MARGIN);
        if (dx || dy) { box = { left: box.left + dx, right: box.right + dx, top: box.top + dy, bottom: box.bottom + dy }; at = { ...candidate, x: candidate.x + dx, y: candidate.y + dy }; }
      }
      if (!candidate.fixed && (placed.some((other) => overlaps(box, other.box, pad)) || avoid.some((other) => overlaps(box, other, 0)))) continue;
      placed.push({ ...at, shown: text, abbreviated: text !== candidate.text, box });
      break;
    }
  }
  return placed;
}
