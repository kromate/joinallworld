/**
 * OWNER: home
 * Pure placement rules for the home grid, shared by the rules engine (systems/home.js), the Buy
 * panel (ghost validity before a tap) and the home scene. No state, no I/O.
 *
 * THE ROOM
 *   grid × grid floor tiles. x runs along the back wall (0 = the corner), y runs towards the
 *   viewer. The two visible walls are the back wall (y = 0 edge) and the side wall (x = 0 edge).
 *   The window takes one slot of the back wall and the door one slot of the side wall.
 * A PLACED OBJECT is { id, itemId, x, y, rot }.
 *   Floor items: (x, y) is the top-left tile of the footprint; rot 0–3 are quarter turns, and
 *   an odd rot swaps the footprint's width and height.
 *   Wall items: rot 0 hangs on the back wall at slot x (y is 0); rot 1 hangs on the side wall at
 *   slot y (x is 0). They take no floor tiles.
 */
import { FURNITURE, STARTER_FURNITURE } from './content/furniture.js';

export const MAX_PLACED = 160;
export const MAX_STORED_PER_ITEM = 99;

export const windowSlot = (grid) => Math.floor(grid / 2);
export const doorSlot = (grid) => grid - 2;

const whole = (value) => Number.isInteger(value);

/** Footprint in tiles after rotation. */
export function footprint(def, rot = 0) {
  if (def.wall) return { w: 1, h: 1 };
  return rot % 2 ? { w: def.h, h: def.w } : { w: def.w, h: def.h };
}

/** Canonical position: wall items are pinned to their wall, floor rotations wrap to 0–3. */
export function normalise(def, x, y, rot) {
  if (!whole(x) || !whole(y) || !whole(rot)) return null;
  if (def.wall) return rot % 2 === 0 ? { x, y: 0, rot: 0 } : { x: 0, y, rot: 1 };
  return { x, y, rot: ((rot % 4) + 4) % 4 };
}

/** Floor tiles an object covers ([] for wall items). */
export function cellsOf(def, x, y, rot) {
  if (def.wall) return [];
  const { w, h } = footprint(def, rot);
  const cells = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) cells.push([x + dx, y + dy]);
  return cells;
}

const wallKey = (item) => (item.rot === 0 ? `n${item.x}` : `w${item.y}`);

/**
 * Why `def` cannot go at (x, y, rot) in a grid × grid room holding `items`, or null if it can.
 * `ignoreId` skips one placed object (the one being moved). Returns { code, reason }.
 */
export function checkPlacement(grid, items, def, x, y, rot, ignoreId = null) {
  const at = normalise(def, x, y, rot);
  if (!at) return { code: 'invalid_position', reason: 'Choose a tile inside your room.' };
  const outside = { code: 'out_of_bounds', reason: `${def.label} does not fit there: your room is ${grid} × ${grid} tiles.` };
  if (def.wall) {
    const slot = at.rot === 0 ? at.x : at.y;
    if (slot < 0 || slot >= grid) return outside;
    if (at.rot === 0 && slot === windowSlot(grid)) return { code: 'blocked', reason: 'The window is on that part of the wall.' };
    if (at.rot === 1 && slot === doorSlot(grid)) return { code: 'blocked', reason: 'The door is on that part of the wall.' };
    const other = items.find((item) => item.id !== ignoreId && FURNITURE[item.itemId]?.wall && wallKey(item) === wallKey(at));
    return other ? { code: 'occupied', reason: `Your ${FURNITURE[other.itemId].label} already hangs there.` } : null;
  }
  const { w, h } = footprint(def, at.rot);
  if (at.x < 0 || at.y < 0 || at.x + w > grid || at.y + h > grid) return outside;
  for (const item of items) {
    const other = FURNITURE[item.itemId];
    if (item.id === ignoreId || !other || other.wall) continue;
    const size = footprint(other, item.rot);
    if (at.x < item.x + size.w && item.x < at.x + w && at.y < item.y + size.h && item.y < at.y + h) {
      return { code: 'occupied', reason: `That spot overlaps your ${other.label}.` };
    }
  }
  return null;
}

/** First free position for `def`, scanning from the back corner; null when the room is full. */
export function findFreeSpot(grid, items, def, ignoreId = null) {
  if (def.wall) {
    for (let slot = 0; slot < grid; slot++) if (!checkPlacement(grid, items, def, slot, 0, 0, ignoreId)) return { x: slot, y: 0, rot: 0 };
    for (let slot = 0; slot < grid; slot++) if (!checkPlacement(grid, items, def, 0, slot, 1, ignoreId)) return { x: 0, y: slot, rot: 1 };
    return null;
  }
  for (const rot of def.w === def.h ? [0] : [0, 1]) {
    for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) if (!checkPlacement(grid, items, def, x, y, rot, ignoreId)) return { x, y, rot };
  }
  return null;
}

/**
 * Fit `wanted` ([{ itemId, x, y, rot, id? }], in priority order) into a grid × grid room.
 * Each object keeps its position if it is still valid, otherwise takes the first free spot,
 * otherwise goes to storage. Nothing is ever dropped: every entry ends up in `items` or `stored`.
 */
export function fitInto(grid, wanted) {
  const items = [], stored = [];
  for (const entry of wanted) {
    const def = FURNITURE[entry.itemId];
    if (!def) continue;
    const kept = normalise(def, entry.x, entry.y, entry.rot);
    const at = kept && items.length < MAX_PLACED && !checkPlacement(grid, items, def, kept.x, kept.y, kept.rot) ? kept
      : items.length < MAX_PLACED ? findFreeSpot(grid, items, def) : null;
    if (at) items.push({ id: entry.id, itemId: entry.itemId, ...at });
    else stored.push(entry.itemId);
  }
  return { items, stored };
}

/** The starter room for a grid × grid house: the 6 × 6 design, spread out in bigger rooms. */
export function starterLayout(grid) {
  const scale = (grid - 1) / 5;
  const wanted = STARTER_FURNITURE.map((entry, index) => ({
    id: `f${index + 1}`, itemId: entry.item, x: Math.round(entry.x * scale), y: Math.round(entry.y * scale), rot: entry.rot,
  }));
  return fitInto(grid, wanted).items;
}

/** Move a ghost by (dx, dy) tiles, kept inside the room. Wall items slide along their wall. */
export function nudge(grid, def, at, dx, dy) {
  if (def.wall) {
    const step = dx || dy;
    return at.rot === 0 ? { x: clampTo(at.x + step, 0, grid - 1), y: 0, rot: 0 } : { x: 0, y: clampTo(at.y + step, 0, grid - 1), rot: 1 };
  }
  const { w, h } = footprint(def, at.rot);
  return { x: clampTo(at.x + dx, 0, Math.max(0, grid - w)), y: clampTo(at.y + dy, 0, Math.max(0, grid - h)), rot: at.rot };
}

/** Quarter-turn a ghost (wall items hop to the other wall), kept inside the room. */
export function turn(grid, def, at) {
  if (def.wall) return at.rot === 0 ? { x: 0, y: clampTo(at.x, 0, grid - 1), rot: 1 } : { x: clampTo(at.y, 0, grid - 1), y: 0, rot: 0 };
  return nudge(grid, def, { ...at, rot: (at.rot + 1) % 4 }, 0, 0);
}

function clampTo(value, min, max) { return Math.min(max, Math.max(min, value)); }
