/**
 * OWNER: home (storeys)
 * The floor plan of a house: its rooms, inner walls, doorways and stairs, in tiles, on the plot
 * of src/game/home-layout.ts (plotOf). Pure data and pure functions, no state.
 *
 * WHERE IT LOADS. Not in the first download: vite.config.ts keeps this file out of the engine chunk.
 * The home scene and Buy mode import it (both lazy); the server's rules use it inside the part of
 * systems/home.ts the browser never builds (PLAYS), so the page's engine does not carry it.
 *
 * THE PLANS. Room one is the room every save already has (grid × grid, back corner, x 0 / y 0).
 * Rented houses and the starter are that room alone. An owned house is laid out the Lagos way:
 *   two-room house  room, second room, bath and toilet
 *   bungalow        parlour, two bedrooms, kitchen, bath and toilet, dining
 *   duplex          parlour, dining, kitchen, guest toilet and hall downstairs;
 *                   master bedroom, bedroom, bath and toilet, balcony and landing upstairs
 *   villa           parlour, dining, kitchen, BQ and hall; four rooms, balcony and landing on the
 *                   first floor; the roof terrace on top
 * STAIRS run along x, two tiles wide, from `floor` to floor + 1. `dir` 1 climbs towards +x (the
 * foot is at x, the head at x + w), -1 the other way. On the floor below, the stairs and the tile
 * column at their foot are kept clear; on the floor above, the stairwell and the column at their head.
 */
import { setPlanRule, type Plot, type PlotRule } from './home-layout.ts';

export interface PlanRoom { label: string; x: number; y: number; w: number; h: number }
export interface PlanStairs { floor: number; x: number; y: number; w: number; h: number; dir: 1 | -1 }
/** An inner wall in tiles: from (x0, y0) to (x1, y1), along x (y0 === y1) or along y (x0 === x1). */
export interface PlanWall { x0: number; y0: number; x1: number; y1: number }
export interface HousePlan { plot: Plot; floors: PlanRoom[][]; stairs: PlanStairs[] }

type Rect = [label: string, x: number, y: number, w: number, h: number];
const rooms = (rects: Rect[]): PlanRoom[] => rects.map(([label, x, y, w, h]) => ({ label, x, y, w, h }));

/** Owned plans by room one's size (the tier's grid). */
const PLANS: Record<number, { floors: Rect[][]; stairs: PlanStairs[] }> = {
  8: { floors: [[['Room', 0, 0, 8, 8], ['Second room', 8, 0, 4, 5], ['Bath & toilet', 8, 5, 4, 3]]], stairs: [] },
  10: {
    floors: [[['Parlour', 0, 0, 10, 10], ['Bedroom', 10, 0, 5, 5], ['Second bedroom', 10, 5, 5, 5], ['Kitchen', 0, 10, 6, 4], ['Bath & toilet', 6, 10, 4, 4], ['Dining', 10, 10, 5, 4]]],
    stairs: [],
  },
  12: {
    floors: [
      [['Parlour', 0, 0, 12, 12], ['Dining', 12, 0, 6, 6], ['Kitchen', 12, 6, 6, 6], ['Guest toilet', 0, 12, 5, 4], ['Hall', 5, 12, 13, 4]],
      [['Master bedroom', 0, 0, 12, 12], ['Bedroom', 12, 0, 6, 6], ['Bath & toilet', 12, 6, 6, 6], ['Balcony', 0, 12, 5, 4], ['Landing', 5, 12, 13, 4]],
    ],
    stairs: [{ floor: 0, x: 7, y: 14, w: 6, h: 2, dir: 1 }],
  },
  14: {
    floors: [
      [['Parlour', 0, 0, 14, 14], ['Dining', 14, 0, 7, 7], ['Kitchen', 14, 7, 7, 7], ['BQ', 0, 14, 5, 4], ['Hall', 5, 14, 16, 4]],
      [['Master bedroom', 0, 0, 9, 14], ['Family lounge', 9, 0, 5, 14], ['Bedroom', 14, 0, 7, 7], ['Bath & toilet', 14, 7, 7, 7], ['Balcony', 0, 14, 5, 4], ['Landing', 5, 14, 16, 4]],
      [['Roof terrace', 0, 0, 21, 18]],
    ],
    stairs: [{ floor: 0, x: 8, y: 16, w: 7, h: 2, dir: 1 }, { floor: 1, x: 8, y: 14, w: 7, h: 2, dir: -1 }],
  },
};

/** The plan of a plot (plotOf): an owned house's rooms and stairs, or room one alone. */
export function planOf(plot: Plot): HousePlan {
  const owned = plot.w > plot.grid ? PLANS[plot.grid] : undefined;
  if (!owned || owned.floors.length !== plot.floors) return { plot, floors: [rooms([['Room', 0, 0, plot.grid, plot.grid]])], stairs: [] };
  return { plot, floors: owned.floors.map(rooms), stairs: owned.stairs };
}

const inside = (rect: { x: number; y: number; w: number; h: number }, x: number, y: number): boolean => x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h;

/** Index of the room holding tile (x, y) on `floor`, or -1. */
export const roomAt = (plan: HousePlan, floor: number, x: number, y: number): number => (plan.floors[floor] ?? []).findIndex((room) => inside(room, x, y));

/** The stairs that reach `floor`: the flight up from it and the flight down to it. */
export const stairsOn = (plan: HousePlan, floor: number): PlanStairs[] => plan.stairs.filter((flight) => flight.floor === floor || flight.floor === floor - 1);

/** The flight that comes up through `floor` (its stairwell), if any. */
export const stairwellOf = (plan: HousePlan, floor: number): PlanStairs | undefined => plan.stairs.find((flight) => flight.floor === floor - 1);

/** Where a tile point (x, y) is on the stairs reaching `floor`: the flight and how far up it (0 foot … 1 head), or null. */
export function flightAt(plan: HousePlan, floor: number, x: number, y: number): { flight: PlanStairs; up: number } | null {
  for (const flight of stairsOn(plan, floor)) {
    if (y < flight.y || y > flight.y + flight.h || x < flight.x - 0.02 || x > flight.x + flight.w + 0.02) continue;
    const u = Math.min(1, Math.max(0, (x - flight.x) / flight.w));
    return { flight, up: flight.dir === 1 ? u : 1 - u };
  }
  return null;
}

/** A tile point just on a flight, at its foot (`end` 0) or its head (1), down the middle. */
export const stairSpot = (flight: PlanStairs, end: 0 | 1): { x: number; y: number } => ({ x: (end === 1) === (flight.dir === 1) ? flight.x + flight.w - 0.4 : flight.x + 0.4, y: flight.y + flight.h / 2 });

/**
 * The way from `from` to a point on floor `to`: across each floor to its stairs, up or down them,
 * and across the last floor to `goal`. `at` turns a tile point into the walker's units; `path`
 * walks one floor (its grid's path, without the start). Null on the same floor or without stairs.
 */
export function routeOf<P>(plan: HousePlan, from: number, to: number, goal: P, at: (x: number, y: number) => P, path: (floor: number, a: P, b: P) => P[] | null): P[] | null {
  const points: P[] = [], spot = (flight: PlanStairs, end: 0 | 1) => { const s = stairSpot(flight, end); return at(s.x, s.y); };
  let floor = from;
  for (; floor !== to; floor += to > floor ? 1 : -1) {
    const up = to > floor, flight = stairwellOf(plan, up ? floor + 1 : floor);
    if (!flight) return null;
    const enter = spot(flight, up ? 0 : 1);
    if (points.length) points.push(...(path(floor, points[points.length - 1]!, enter) ?? []));
    points.push(enter, spot(flight, up ? 1 : 0));
  }
  return points.length ? [...points, ...(path(to, points[points.length - 1]!, goal) ?? [])] : null;
}

/** A flight's rails on `floor`, as tile lines: both sides, and the end that is not its way on (the head on the floor below, the foot above). */
export function railsOf(flight: PlanStairs, floor: number): PlanWall[] {
  const x1 = flight.x + flight.w, y1 = flight.y + flight.h, closed = (flight.floor === floor) === (flight.dir === 1) ? x1 : flight.x;
  return [{ x0: flight.x, y0: flight.y, x1, y1: flight.y }, { x0: flight.x, y0: y1, x1, y1 }, { x0: closed, y0: flight.y, x1: closed, y1 }];
}

/** What a walker bumps into on `floor`, as tile lines: the inner walls and the rails of every flight reaching it. */
export const bumpsOf = (plan: HousePlan, floor: number): PlanWall[] => [...wallsOf(plan, floor), ...stairsOn(plan, floor).flatMap((flight) => railsOf(flight, floor))];

/** The slab `floor` stands on, round its stairwell, as tile rectangles [x0, y0, x1, y1]; none without a stairwell. */
export function slabOf(plan: HousePlan, floor: number): [number, number, number, number][] {
  const hole = stairwellOf(plan, floor), { w, d } = plan.plot;
  if (!hole) return [];
  const x1 = hole.x + hole.w, y1 = hole.y + hole.h;
  const slabs: [number, number, number, number][] = [[0, 0, w, hole.y], [0, y1, w, d], [0, hole.y, hole.x, y1], [x1, hole.y, w, y1]];
  return slabs.filter(([a, b, c, e]) => c > a && e > b);
}

/** Floor tiles by room: wet rooms get light tiles, the open air terrazzo; undefined for the city's own palette. */
const FINISHES: [RegExp, readonly [string, string]][] = [[/bath|toilet|kitchen/i, ['#e4e7e3', '#c9d0cc']], [/balcony|terrace/i, ['#b8afa0', '#a1978a']]];
export const finishAt = (plan: HousePlan, floor: number, x: number, y: number): readonly [string, string] | undefined => {
  const label = plan.floors[floor]?.[roomAt(plan, floor, x, y)]?.label ?? '';
  return FINISHES.find(([test]) => test.test(label))?.[1];
};

/** Free tiles of `floor` (off the stairs and not in `taken`, "floor:x,y"), nearest (cx, cy) first; tiles in another room than that point's come last. */
export function nearestFree(plan: HousePlan, floor: number, cx: number, cy: number, taken: Set<string>): { x: number; y: number }[] {
  const home = roomAt(plan, floor, Math.round(cx), Math.round(cy)), found: { x: number; y: number; d: number }[] = [];
  for (let x = 0; x < plan.plot.w; x++) for (let y = 0; y < plan.plot.d; y++) {
    if (taken.has(`${floor}:${x},${y}`) || stairCell(plan, floor, x, y)) continue;
    found.push({ x, y, d: Math.hypot(x - cx, y - cy) + (roomAt(plan, floor, x, y) === home ? 0 : 100) });
  }
  return found.sort((a, b) => a.d - b.d);
}

/** The tile column (x) at the foot (`end` 0) or head (`end` 1) of a flight, just off the stairs. */
export const stairEnd = (flight: PlanStairs, end: 0 | 1): number => ((end === 1) === (flight.dir === 1) ? flight.x + flight.w : flight.x - 1);

/** Is tile (x, y) kept clear on `floor` (stairs, stairwell, or the column a flight is walked onto from)? */
export function stairCell(plan: HousePlan, floor: number, x: number, y: number): boolean {
  return stairsOn(plan, floor).some((flight) => {
    if (inside(flight, x, y)) return true;
    const end = stairEnd(flight, flight.floor === floor ? 0 : 1);
    return x === end && y >= flight.y && y < flight.y + flight.h;
  });
}

/** checkPlacement's rule for a plan: an object stays inside one room and off the stairs. */
export function planRule(plan: HousePlan): PlotRule {
  return (floor, cells) => {
    if (cells.some(([x, y]) => stairCell(plan, floor, x, y))) return 'Keep the stairs clear.';
    const room = cells.length ? roomAt(plan, floor, cells[0]![0], cells[0]![1]) : -1;
    return cells.some(([x, y]) => roomAt(plan, floor, x, y) !== room) ? 'That would stand across a wall. Keep it inside one room.' : null;
  };
}

/** A plot with its plan's rule, ready for checkPlacement. */
export const ruledPlot = (plot: Plot): Plot => ({ ...plot, rule: planRule(planOf(plot)) });

// Loading this file is what makes plotOf hand out ruled plots.
setPlanRule((plot) => planRule(planOf(plot)));

/**
 * The inner walls of `floor`, merged into runs, with a doorway in every wall two rooms share
 * (two tiles wide where the wall allows, else one): every room can be walked into.
 */
export function wallsOf(plan: HousePlan, floor: number): PlanWall[] {
  const { w, d } = plan.plot, walls: PlanWall[] = [];
  const shared = new Map<string, number[]>(); // "a|b|axis|line" → tile positions along the line
  const note = (a: number, b: number, axis: string, line: number, p: number) => {
    if (a === b || a < 0 || b < 0) return;
    const key = `${Math.min(a, b)}|${Math.max(a, b)}|${axis}|${line}`;
    shared.set(key, [...(shared.get(key) ?? []), p]);
  };
  for (let y = 0; y < d; y++) for (let x = 1; x < w; x++) note(roomAt(plan, floor, x - 1, y), roomAt(plan, floor, x, y), 'y', x, y);
  for (let x = 0; x < w; x++) for (let y = 1; y < d; y++) note(roomAt(plan, floor, x, y - 1), roomAt(plan, floor, x, y), 'x', y, x);
  for (const [key, along] of shared) {
    const [, , axis, lineText] = key.split('|'), line = Number(lineText);
    along.sort((p, q) => p - q);
    const wide = along.length >= 4 ? 2 : 1, door = along[Math.floor((along.length - wide) / 2)]!;
    const open = (p: number) => p >= door && p < door + wide;
    let start: number | null = null;
    for (const p of along) {
      if (open(p)) continue;
      start ??= p;
      if (along.includes(p + 1) && !open(p + 1)) continue;
      walls.push(axis === 'y' ? { x0: line, y0: start, x1: line, y1: p + 1 } : { x0: start, y0: line, x1: p + 1, y1: line });
      start = null;
    }
  }
  return walls;
}
