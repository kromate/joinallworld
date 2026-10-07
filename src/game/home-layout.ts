/**
 * OWNER: home
 * Pure placement rules for the home grid, shared by the rules engine (systems/home.ts), the Buy
 * panel (ghost validity before a tap) and the home scene. No state, no I/O.
 *
 * THE ROOM
 *   grid × grid floor tiles. x runs along the back wall (0 = the corner), y runs towards the
 *   viewer. The two visible walls are the back wall (y = 0 edge) and the side wall (x = 0 edge).
 *   The window takes one slot of the back wall and the door one slot of the side wall.
 * THE PLOT (plotOf)
 *   An owned house bigger than the starter is w × d tiles on every one of its floors: the room
 *   above is room one, in the back corner, and the other rooms lie to its right and in front of
 *   it, so a save from before storeys keeps every object where it stood. Which rooms and where the
 *   stairs go is the plan's business (src/game/home-plan.ts, a lazy chunk): it hands checkPlacement
 *   a `rule` for the cells it refuses. Without one, only the plot's edges and other objects count.
 * A PLACED OBJECT is { id, itemId, x, y, rot, floor? } (floor 0, the ground, is left out).
 *   Floor items: (x, y) is the top-left tile of the footprint; rot 0–3 are quarter turns, and
 *   an odd rot swaps the footprint's width and height.
 *   Wall items: rot 0 hangs on the back wall at slot x (y is 0); rot 1 hangs on the side wall at
 *   slot y (x is 0). They take no floor tiles.
 */
import { FURNITURE, STARTER_FURNITURE } from './content/furniture.ts';
import type { FurnitureId, PlacedItem } from '../types/life.ts';
import type { FurnitureDefinition, Block } from '../types/content.ts';
import type { PlacementCode } from '../types/actions.ts';

/** Where an object stands: the tile (or wall slot) and the quarter turns. */
export interface Placement {
  x: number
  y: number
  rot: number
}
/** Why an object cannot go somewhere. */
export type PlacementBlock = Block<PlacementCode>;
/** The plan's own refusal of floor cells on a floor (crossing a room's wall, the stairs), or null. */
export type PlotRule = (floor: number, cells: [number, number][]) => string | null;
/** Where objects go: w × d tiles on each of `floors` floors; room one is grid × grid. */
export interface Plot { grid: number; w: number; d: number; floors: number; rule?: PlotRule | null }
/** The parts of a furniture definition the footprint reads. */
type Footprinted = Pick<FurnitureDefinition, 'w' | 'h' | 'wall'>;
/** An object to fit into a room: its position is only a wish (it may be hostile saved data). */
export interface WantedItem {
  id: string
  itemId: FurnitureId
  x: unknown
  y: unknown
  rot: unknown
  floor?: unknown
}

export const MAX_PLACED = 160;
export const MAX_STORED_PER_ITEM = 99;

export const windowSlot = (grid: number): number => Math.floor(grid / 2);
export const doorSlot = (grid: number): number => grid - 2;

/** The plan's rule maker, installed by src/game/home-plan.ts when it loads (servers, tests, the home scene). */
let ruleOf: ((plot: Plot) => PlotRule) | null = null;
export const setPlanRule = (make: (plot: Plot) => PlotRule): void => { ruleOf = make; };
/** The plot of a house: a rented room is grid × grid; an owned two-room house, bungalow, duplex or villa grows rooms and floors. */
export function plotOf(grid: number, owned = false): Plot {
  const plot: Plot = owned && grid > 6
    ? { grid, w: grid * 1.5, d: grid > 8 ? grid + 4 : grid, floors: grid > 12 ? 3 : grid > 10 ? 2 : 1 }
    : { grid, w: grid, d: grid, floors: 1 };
  plot.rule = ruleOf?.(plot);
  return plot;
}
const plotIn = (space: number | Plot): Plot => (typeof space === 'number' ? plotOf(space) : space);
const floorOf = (item: { floor?: number }): number => item.floor ?? 0;

const whole = (value: unknown): value is number => Number.isInteger(value);

/** Footprint in tiles after rotation. */
export function footprint(def: Footprinted, rot = 0): { w: number; h: number } {
  if (def.wall) return { w: 1, h: 1 };
  return rot % 2 ? { w: def.h, h: def.w } : { w: def.w, h: def.h };
}

/** New floor furniture must leave the ground entrance usable, including in rented rooms. */
export function frontDoorBlocked(grid: number, def: Footprinted, at: Placement, floor = 0): PlacementBlock | null {
  const { h } = footprint(def, at.rot);
  return !def.wall && floor === 0 && at.x === 0 && at.y <= doorSlot(grid) && at.y + h > doorSlot(grid)
    ? { code: 'blocked', reason: 'Keep the front door clear.' } : null;
}

/** Canonical position: wall items are pinned to their wall, floor rotations wrap to 0–3. */
export function normalise(def: Pick<FurnitureDefinition, 'wall'>, x: unknown, y: unknown, rot: unknown): Placement | null {
  if (!whole(x) || !whole(y) || !whole(rot)) return null;
  if (def.wall) return rot % 2 === 0 ? { x, y: 0, rot: 0 } : { x: 0, y, rot: 1 };
  return { x, y, rot: ((rot % 4) + 4) % 4 };
}

/** Floor tiles an object covers ([] for wall items). */
export function cellsOf(def: Footprinted, x: number, y: number, rot: number): [number, number][] {
  if (def.wall) return [];
  const { w, h } = footprint(def, rot);
  const cells: [number, number][] = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) cells.push([x + dx, y + dy]);
  return cells;
}

const wallKey = (item: Placement): string => (item.rot === 0 ? `n${item.x}` : `w${item.y}`);

/**
 * Why `def` cannot go at (x, y, rot) on `floor` of a plot (or a grid × grid room) holding `items`,
 * or null if it can. `ignoreId` skips one placed object (the one being moved). Returns { code, reason }.
 */
export function checkPlacement(space: number | Plot, items: readonly PlacedItem[], def: FurnitureDefinition, x: number, y: number, rot: number, ignoreId: string | null = null, floor = 0): PlacementBlock | null {
  const { grid, w: wide, d: deep, floors, rule } = plotIn(space);
  const at = normalise(def, x, y, rot);
  if (!at || !whole(floor) || floor < 0 || floor >= floors) return { code: 'invalid_position', reason: 'Choose a tile inside your room.' };
  const outside: PlacementBlock = { code: 'out_of_bounds', reason: `${def.label} does not fit there: your ${wide > grid ? 'house' : 'room'} is ${wide} × ${deep} tiles.` };
  items = items.filter((item) => floorOf(item) === floor);
  if (def.wall) {
    const slot = at.rot === 0 ? at.x : at.y;
    if (slot < 0 || slot >= (at.rot === 0 ? wide : deep)) return outside;
    if (at.rot === 0 && slot === windowSlot(grid)) return { code: 'blocked', reason: 'The window is on that part of the wall.' };
    if (at.rot === 1 && slot === doorSlot(grid)) return { code: 'blocked', reason: 'The door is on that part of the wall.' };
    const other = items.find((item) => item.id !== ignoreId && FURNITURE[item.itemId]?.wall && wallKey(item) === wallKey(at));
    return other ? { code: 'occupied', reason: `Your ${FURNITURE[other.itemId]?.label} already hangs there.` } : null;
  }
  const { w, h } = footprint(def, at.rot);
  if (at.x < 0 || at.y < 0 || at.x + w > wide || at.y + h > deep) return outside;
  const door = wide > grid ? frontDoorBlocked(grid, def, at, floor) : null;
  if (door) return door;
  const refused = rule?.(floor, cellsOf(def, at.x, at.y, at.rot));
  if (refused) return { code: 'blocked', reason: refused };
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

/** First free position for `def` on `floor`, scanning from the back corner; null when that floor is full. */
export function findFreeSpot(space: number | Plot, items: readonly PlacedItem[], def: FurnitureDefinition, ignoreId: string | null = null, floor = 0): Placement | null {
  const { w: wide, d: deep } = plotIn(space);
  if (def.wall) {
    for (let slot = 0; slot < wide; slot++) if (!checkPlacement(space, items, def, slot, 0, 0, ignoreId, floor)) return { x: slot, y: 0, rot: 0 };
    for (let slot = 0; slot < deep; slot++) if (!checkPlacement(space, items, def, 0, slot, 1, ignoreId, floor)) return { x: 0, y: slot, rot: 1 };
    return null;
  }
  for (const rot of def.w === def.h ? [0] : [0, 1]) {
    for (let y = 0; y < deep; y++) for (let x = 0; x < wide; x++) if (!checkPlacement(space, items, def, x, y, rot, ignoreId, floor)) return { x, y, rot };
  }
  return null;
}

/**
 * Fit `wanted` ([{ itemId, x, y, rot, floor?, id }], in priority order) into a plot (or a grid × grid room).
 * Each object keeps its position if it is still valid, otherwise takes the first free spot on its
 * floor, then on the ground and up, otherwise goes to storage. Nothing is ever dropped: every entry
 * ends up in `items` or `stored`. An object without a floor is on the ground.
 */
export function fitInto(space: number | Plot, wanted: readonly WantedItem[]): { items: PlacedItem[]; stored: FurnitureId[] } {
  const { floors } = plotIn(space);
  const items: PlacedItem[] = [], stored: FurnitureId[] = [];
  for (const entry of wanted) {
    const def = FURNITURE[entry.itemId];
    if (!def) continue;
    const asked = entry.floor ?? 0, kept = normalise(def, entry.x, entry.y, entry.rot);
    let floor = whole(asked) && asked > 0 && asked < floors ? asked : 0;
    let at = kept && items.length < MAX_PLACED && !checkPlacement(space, items, def, kept.x, kept.y, kept.rot, null, floor) ? kept : null;
    for (const next of [floor, ...Array.from({ length: floors }, (_, index) => index)]) {
      if (at || items.length >= MAX_PLACED) break;
      at = findFreeSpot(space, items, def, null, next);
      floor = next;
    }
    if (at) items.push({ id: entry.id, itemId: entry.itemId, ...at, ...(floor ? { floor } : {}) });
    else stored.push(entry.itemId);
  }
  return { items, stored };
}

/** The starter room for a grid × grid house: the 6 × 6 design, spread out in bigger rooms. */
export function starterLayout(grid: number): PlacedItem[] {
  const scale = (grid - 1) / 5;
  const wanted = STARTER_FURNITURE.map((entry, index) => ({
    id: `f${index + 1}`, itemId: entry.item, x: Math.round(entry.x * scale), y: Math.round(entry.y * scale), rot: entry.rot,
  }));
  return fitInto(grid, wanted).items;
}

/** Move a ghost by (dx, dy) tiles, kept inside the plot. Wall items slide along their wall. */
export function nudge(space: number | Plot, def: Footprinted, at: Placement, dx: number, dy: number): Placement {
  const { w: wide, d: deep } = plotIn(space);
  if (def.wall) {
    const step = dx || dy;
    return at.rot === 0 ? { x: clampTo(at.x + step, 0, wide - 1), y: 0, rot: 0 } : { x: 0, y: clampTo(at.y + step, 0, deep - 1), rot: 1 };
  }
  const { w, h } = footprint(def, at.rot);
  return { x: clampTo(at.x + dx, 0, Math.max(0, wide - w)), y: clampTo(at.y + dy, 0, Math.max(0, deep - h)), rot: at.rot };
}

/** Quarter-turn a ghost (wall items hop to the other wall), kept inside the plot. */
export function turn(space: number | Plot, def: Footprinted, at: Placement): Placement {
  const { w: wide, d: deep } = plotIn(space);
  if (def.wall) return at.rot === 0 ? { x: 0, y: clampTo(at.x, 0, deep - 1), rot: 1 } : { x: clampTo(at.y, 0, wide - 1), y: 0, rot: 0 };
  return nudge(space, def, { ...at, rot: (at.rot + 1) % 4 }, 0, 0);
}

function clampTo(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
