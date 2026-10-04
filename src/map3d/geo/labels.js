/**
 * OWNER: world
 * Which labels fit. Pure — no DOM: the atlas measures nothing, it estimates a label's box from
 * its text, and this decides what is shown so that two labels never overlap.
 *
 *   textWidth(text, size)                         an estimate, a little generous
 *   placeLabels(candidates, { cap, pad, width, height })  → the labels to show, most important first
 *
 * @typedef {{ id: string, x: number, y: number, priority: number, size?: number, room?: number,
 *   text: string, short?: string, note?: string, anchor?: 'centre' | 'above' | 'right', fixed?: boolean }} LabelCandidate
 *   x, y      where it points, in CSS pixels
 *   room      how wide the thing it names is on screen; a name wider than its region is abbreviated or dropped
 *   short     the abbreviation to fall back on
 *   note      a second, smaller line under the name
 *   fixed     shown whatever it overlaps (the "You are here" marker)
 * @typedef {LabelCandidate & { shown: string, abbreviated: boolean, box: { left: number, top: number, right: number, bottom: number } }} PlacedLabel
 */

/** The hard cap on labels on screen at once. */
export const LABEL_CAP = 44;

export const textWidth = (text, size = 12) => Math.ceil(String(text).length * size * 0.6) + 10;

const boxOf = (candidate, text) => {
  const size = candidate.size || 12, w = Math.max(textWidth(text, size), candidate.note ? textWidth(candidate.note, 10) : 0) + (candidate.note ? 8 : 0), h = Math.round(size * 1.5) + (candidate.note ? 16 : 0);
  if (candidate.anchor === 'above') return { left: candidate.x - w / 2, right: candidate.x + w / 2, top: candidate.y - h - 8, bottom: candidate.y - 8 };
  if (candidate.anchor === 'right') return { left: candidate.x + 7, right: candidate.x + 7 + w, top: candidate.y - h / 2, bottom: candidate.y + h / 2 };
  return { left: candidate.x - w / 2, right: candidate.x + w / 2, top: candidate.y - h / 2, bottom: candidate.y + h / 2 };
};
const overlaps = (a, b, pad) => a.left < b.right + pad && b.left < a.right + pad && a.top < b.bottom + pad && b.top < a.bottom + pad;

/**
 * @param {LabelCandidate[]} candidates
 * @param {{ cap?: number, pad?: number, width?: number, height?: number, avoid?: { left: number, top: number, right: number, bottom: number }[] }} [options]
 *   width/height: the screen; a label wholly outside it is skipped. avoid: boxes nothing may cover (the panels).
 * @returns {PlacedLabel[]}
 */
export function placeLabels(candidates, { cap = LABEL_CAP, pad = 3, width = Infinity, height = Infinity, avoid = [] } = {}) {
  const placed = [];
  const ordered = [...candidates].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
  for (const candidate of ordered) {
    if (placed.length >= cap) break;
    for (const text of candidate.short && candidate.short !== candidate.text ? [candidate.text, candidate.short] : [candidate.text]) {
      if (candidate.room !== undefined && textWidth(text, candidate.size) > candidate.room) continue;
      const box = boxOf(candidate, text);
      if (box.right < 0 || box.left > width || box.bottom < 0 || box.top > height) break;
      if (!candidate.fixed && (placed.some((other) => overlaps(box, other.box, pad)) || avoid.some((other) => overlaps(box, other, 0)))) continue;
      placed.push({ ...candidate, shown: text, abbreviated: text !== candidate.text, box });
      break;
    }
  }
  return placed;
}
