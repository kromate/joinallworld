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

export type LabelAnchor = 'centre' | 'above' | 'right' | 'left' | 'below' | 'far-above' | 'far-below' | 'far-right' | 'far-left';
export interface LabelBox { left: number; top: number; right: number; bottom: number }
export interface LabelCandidate { id: string; x: number; y: number; priority: number; size?: number; room?: number | undefined,
  text: string; short?: string | undefined; note?: string | undefined; anchor?: LabelAnchor | undefined; /** Other anchors to try, in order, when the first would overlap a label already shown. */ alts?: readonly LabelAnchor[] | undefined; fixed?: boolean | undefined; cls?: string | undefined; title?: string | undefined }
/** `home` is the point the label names; `displaced` is set when the label sits away from it (another anchor, or moved to stay on screen). */
export interface PlacedLabel extends LabelCandidate { shown: string; abbreviated: boolean; box: LabelBox; home: { x: number; y: number }; displaced: boolean }

/** The hard cap on labels on screen at once. */
export const LABEL_CAP = 44;

export const textWidth = (text: unknown, size = 12): number => Math.ceil(String(text).length * size * 0.6) + 10;

const boxOf = (candidate: LabelCandidate, text: string): LabelBox => {
  const size = candidate.size || 12, w = Math.max(textWidth(text, size), candidate.note ? textWidth(candidate.note, 10) : 0) + (candidate.note ? 8 : 0), h = Math.round(size * 1.5) + (candidate.note ? 16 : 0);
  if (candidate.anchor === 'above') return { left: candidate.x - w / 2, right: candidate.x + w / 2, top: candidate.y - h - 8, bottom: candidate.y - 8 };
  if (candidate.anchor === 'far-above') return { left: candidate.x - w / 2, right: candidate.x + w / 2, top: candidate.y - h - 54, bottom: candidate.y - 54 };
  if (candidate.anchor === 'far-below') return { left: candidate.x - w / 2, right: candidate.x + w / 2, top: candidate.y + 54, bottom: candidate.y + 54 + h };
  if (candidate.anchor === 'far-right') return { left: candidate.x + 48, right: candidate.x + 48 + w, top: candidate.y - h / 2, bottom: candidate.y + h / 2 };
  if (candidate.anchor === 'far-left') return { left: candidate.x - 48 - w, right: candidate.x - 48, top: candidate.y - h / 2, bottom: candidate.y + h / 2 };
  if (candidate.anchor === 'left') return { left: candidate.x - 7 - w, right: candidate.x - 7, top: candidate.y - h / 2, bottom: candidate.y + h / 2 };
  if (candidate.anchor === 'below') return { left: candidate.x - w / 2, right: candidate.x + w / 2, top: candidate.y + 8, bottom: candidate.y + 8 + h };
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

/** Where a name that found no free side is set down: rings round its point, nearest first, with a leader line back to the point. */
const RING_RADII = [58, 86, 114, 142, 170, 198, 226] as const, RING_STEPS = 24;
/** A box wholly on the screen, with EDGE_MARGIN to spare (always true when the screen is not known). */
const onScreen = (box: LabelBox, width: number, height: number): boolean => (!Number.isFinite(width) || (box.left >= EDGE_MARGIN && box.right <= width - EDGE_MARGIN)) && (!Number.isFinite(height) || (box.top >= EDGE_MARGIN && box.bottom <= height - EDGE_MARGIN));

export interface PlaceOptions { cap?: number; pad?: number; width?: number; height?: number; avoid?: readonly LabelBox[] }
/**
 * options.width/height: the screen; a label wholly outside it is skipped, and a label that is always shown (`fixed`) is moved to lie
 * inside it with EDGE_MARGIN to spare, so the place you are in is never cut off at the edge. options.avoid: boxes nothing may cover (the panels).
 */
export function placeLabels(candidates: readonly LabelCandidate[], { cap = LABEL_CAP, pad = 3, width = Infinity, height = Infinity, avoid = [] }: PlaceOptions = {}): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  // A city's own dot: a label that has moved away from its point never sits on top of another city's dot.
  const dots = candidates.filter((item) => item.cls?.includes('is-city'));
  const covers = (box: LabelBox, self: LabelCandidate): boolean => dots.some((dot) => dot.id !== self.id && dot.x > box.left - 5 && dot.x < box.right + 5 && dot.y > box.top - 5 && dot.y < box.bottom + 5);
  // The leader line from the point to a moved label must not run through a label already shown.
  const crosses = (box: LabelBox, self: LabelCandidate): boolean => {
    const x = Math.min(Math.max(self.x, box.left), box.right), y = Math.min(Math.max(self.y, box.top), box.bottom);
    for (let step = 1; step < 8; step++) {
      const px = self.x + (x - self.x) * step / 8, py = self.y + (y - self.y) * step / 8;
      if (placed.some((other) => !(self.x > other.box.left && self.x < other.box.right && self.y > other.box.top && self.y < other.box.bottom) && px > other.box.left && px < other.box.right && py > other.box.top && py < other.box.bottom)) return true;
    }
    return false;
  };
  const ordered = [...candidates].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
  for (const candidate of ordered) {
    if (placed.length >= cap) break;
    for (const text of candidate.short && candidate.short !== candidate.text ? [candidate.text, candidate.short] : [candidate.text]) {
      if (candidate.room !== undefined && textWidth(text, candidate.size) > candidate.room) continue;
      let box = boxOf(candidate, text), at = candidate, displaced = false;
      if (box.right < 0 || box.left > width || box.bottom < 0 || box.top > height) break;
      // A label that would overlap another tries its other anchors before it gives way.
      // A label keeps its place unless that would hide another city's dot (or, for one that may give way, overlap a label); then it moves to the nearest free side.
      const hides = covers(box, candidate);
      // A name that may move (it has other anchors) also moves when its first place is cut off by the edge of the screen.
      const cut = Boolean(candidate.alts?.length) && !onScreen(box, width, height);
      /** True when a box cannot be used: it overlaps a name or a panel, or sits on another city's dot. */
      const blocked = (trial: LabelBox): boolean => placed.some((other) => overlaps(trial, other.box, pad)) || avoid.some((other) => overlaps(trial, other, 0)) || covers(trial, candidate);
      const taken = (trial: LabelBox): boolean => blocked(trial) || crosses(trial, candidate);
      if (hides || cut || (!candidate.fixed && (placed.some((other) => overlaps(box, other.box, pad)) || avoid.some((other) => overlaps(box, other, 0))))) {
        // Of the other anchors that are free, the one nearest the point it names wins (the list order breaks ties).
        let nearest = Infinity;
        for (const anchor of candidate.alts ?? []) {
          const moved = { ...candidate, anchor }, trial = boxOf(moved, text);
          if (trial.right < 0 || trial.left > width || trial.bottom < 0 || trial.top > height) continue;
          if (taken(trial) || !onScreen(trial, width, height)) continue;
          const away = Math.hypot((trial.left + trial.right) / 2 - candidate.x, (trial.top + trial.bottom) / 2 - candidate.y);
          if (away < nearest - 0.5) { nearest = away; box = trial; at = moved; displaced = true; }
        }
        // No side is free (several cities within a few pixels of each other): the name is set down on the nearest free spot of the rings round its
        // point, wholly on screen, and a leader line joins it to the point.
        if (!displaced && candidate.alts?.length && (cut || hides || taken(box))) {
          const plain = boxOf({ ...candidate, anchor: 'centre' }, text), halfW = (plain.right - plain.left) / 2, halfH = (plain.bottom - plain.top) / 2;
          // A leader that would pass under a name already shown is avoided; where every free spot needs one, the nearest is taken all the same.
          search: for (const strict of [true, false]) for (const radius of RING_RADII) {
            for (let step = 0; step < RING_STEPS; step++) {
              // Below the point first, then alternately to either side of it, so that names fall into open water where a coast is near.
              const turn = Math.ceil(step / 2) * (step % 2 ? 1 : -1) * (2 * Math.PI / RING_STEPS), angle = Math.PI / 2 + turn;
              const cx = candidate.x + Math.cos(angle) * (radius + halfW * Math.abs(Math.cos(angle))), cy = candidate.y + Math.sin(angle) * (radius + halfH * Math.abs(Math.sin(angle)));
              const trial = { left: cx - halfW, right: cx + halfW, top: cy - halfH, bottom: cy + halfH };
              if (!onScreen(trial, width, height) || (strict ? taken(trial) : blocked(trial))) continue;
              box = trial; at = { ...candidate, anchor: 'centre', x: cx, y: cy }; displaced = true;
              break search;
            }
          }
        }
      }
      if (candidate.fixed) {
        const dx = nudge(box.left, box.right, width, EDGE_MARGIN), dy = nudge(box.top, box.bottom, height, EDGE_MARGIN);
        if (dx || dy) { box = { left: box.left + dx, right: box.right + dx, top: box.top + dy, bottom: box.bottom + dy }; at = { ...candidate, x: candidate.x + dx, y: candidate.y + dy }; displaced = true; }
      }
      if (!candidate.fixed && (placed.some((other) => overlaps(box, other.box, pad)) || avoid.some((other) => overlaps(box, other, 0)))) continue;
      placed.push({ ...at, shown: text, abbreviated: text !== candidate.text, box, home: { x: candidate.x, y: candidate.y }, displaced });
      break;
    }
  }
  return placed;
}
