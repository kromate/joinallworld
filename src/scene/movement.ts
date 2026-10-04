/**
 * OWNER: scenes
 * Walking inside a scene: where the avatar may stand, how it gets from A to B, and how it moves
 * each frame. Pure arithmetic — no THREE, no DOM, no timers — so all of it runs under `node --test`.
 *
 * WALKABLE DESCRIPTION
 *   A scene describes its floor as bounds plus obstacle rectangles and circles:
 *     { bounds: [minX, minZ, maxX, maxZ], block: [[x0, z0, x1, z1] | [x, z, radius], ...],
 *       clear: [...same shapes, opened again after blocking...], entrance: [x, z, ry] }
 *   createWalkGrid() rasterises that once into a small occupancy grid (CELL units per cell, obstacles
 *   grown by the avatar's radius). Venue scenes get most obstacles for free: footprintRecorder()
 *   wraps the geometry batch a scene builder draws into and notes the ground footprint of every
 *   primitive that stands in a walker's way (walls, counters, tables, trees, people, water), so a
 *   scene's obstacles can never drift away from what it draws. The per-scene `walk` data in
 *   src/scene/venues-*.js adds what cannot be seen from primitives (the entrance, bounds, extra
 *   blocked or opened areas). The home room is described from state.home.items (home-scene.js).
 *
 * MOVING
 *   createWalker() holds the avatar's position and facing and advances it by `step(dt, yaw)`:
 *     keys   camera-relative input (forward = away from the camera), sliding along obstacles
 *     path   waypoints from grid.path() (A* over the grid, then straightened by line of sight)
 *     hop    a short straight move on to or off a place that is not on the walkable floor (a seat,
 *            a stage) — how a spot's own anchor is reached when it sits inside an obstacle. A raised
 *            place declares an APPROACH point (the foot of its steps): the path ends there and the
 *            hop starts there, so the avatar steps up where the steps are instead of through a rail
 *   others soft circle avoidance: the walker slides round other figures (walker.others) instead of
 *            walking through them, and is never trapped by them — see avoid() below
 *   step() allocates nothing and returns true while there is still motion, which is what keeps the
 *   host's frame loop alive — and lets it stop the moment the avatar arrives.
 */

import type { Batch, BatchOptions } from './types.ts';

export const CELL = 0.4;
export const AVATAR_RADIUS = 0.34;
export const WALK_SPEED = 4.6, JOG_SPEED = 8;
/** A path longer than this is jogged unless the caller says otherwise. */
export const LONG_WALK = 9;
const TURN_RATE = 14; // radians per second the avatar turns towards where it is going
const SQRT2 = Math.SQRT2;

/** [x0, z0, x1, z1] */
export type WalkRect = [number, number, number, number];
/** [x, z, radius] */
export type WalkCircle = [number, number, number];
export type WalkShape = WalkRect | WalkCircle;
export interface WalkPoint { x: number; z: number }
/** A scene's walkable description (see the header). */
export interface WalkDescription {
  bounds?: WalkRect;
  block?: WalkShape[];
  clear?: WalkShape[];
  cell?: number;
  radius?: number;
  entrance?: [number, number, number];
}

const isCircle = (shape: WalkShape): shape is WalkCircle => Array.isArray(shape) && shape.length === 3;

/**
 * An occupancy grid over a rectangle of floor.
 * grid.free(x, z)            may the avatar's centre be here?
 * grid.nearest(x, z)         → { x, z } the closest free place (itself when free), or null
 * grid.clearLine(a, b)       is the straight line between two points free all the way?
 * grid.path(ax, az, bx, bz)  → [{ x, z }, ...] waypoints ending at b — or, when b is walled off, at the
 *                            reachable place closest to it. Empty when already there; null without a floor.
 */
export interface WalkGrid {
  bounds: WalkRect;
  cell: number;
  cols: number;
  rows: number;
  cells: Uint8Array;
  free(x: number, z: number): boolean;
  nearest(x: number, z: number, reach?: number): WalkPoint | null;
  clearLine(ax: number, az: number, bx: number, bz: number): boolean;
  path(ax: number, az: number, bx: number, bz: number): WalkPoint[] | null;
  ascii(marks?: Record<string, [number, number]>): string;
}

export function createWalkGrid({ bounds = [-10, -8, 10, 8], block = [], clear = [], cell = CELL, radius = AVATAR_RADIUS }: WalkDescription = {}): WalkGrid {
  const [minX, minZ, maxX, maxZ] = bounds;
  const cols = Math.max(1, Math.ceil((maxX - minX) / cell)), rows = Math.max(1, Math.ceil((maxZ - minZ) / cell));
  const cells = new Uint8Array(cols * rows);
  const col = (x: number) => Math.floor((x - minX) / cell), row = (z: number) => Math.floor((z - minZ) / cell);
  const centreX = (c: number) => minX + (c + 0.5) * cell, centreZ = (r: number) => minZ + (r + 0.5) * cell;
  const inside = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows;

  function paint(shape: WalkShape, value: number, grow: number) {
    if (!Array.isArray(shape)) return;
    if (isCircle(shape)) {
      const [x, z, r] = shape, reach = r + grow;
      for (let rr = Math.max(0, row(z - reach)); rr <= Math.min(rows - 1, row(z + reach)); rr++) {
        for (let cc = Math.max(0, col(x - reach)); cc <= Math.min(cols - 1, col(x + reach)); cc++) {
          if (Math.hypot(centreX(cc) - x, centreZ(rr) - z) <= reach) cells[rr * cols + cc] = value;
        }
      }
      return;
    }
    const x0 = Math.min(shape[0], shape[2]) - grow, x1 = Math.max(shape[0], shape[2]) + grow;
    const z0 = Math.min(shape[1], shape[3]) - grow, z1 = Math.max(shape[1], shape[3]) + grow;
    for (let rr = Math.max(0, row(z0)); rr <= Math.min(rows - 1, row(z1)); rr++) {
      for (let cc = Math.max(0, col(x0)); cc <= Math.min(cols - 1, col(x1)); cc++) {
        const x = centreX(cc), z = centreZ(rr);
        if (x >= x0 && x <= x1 && z >= z0 && z <= z1) cells[rr * cols + cc] = value;
      }
    }
  }
  for (const shape of block) paint(shape, 1, radius);
  for (const shape of clear) paint(shape, 0, 0);

  const free = (x: number, z: number) => { const c = col(x), r = row(z); return inside(c, r) && cells[r * cols + c] === 0; };

  function nearest(x: number, z: number, reach = Math.max(cols, rows)): WalkPoint | null {
    const c0 = Math.max(0, Math.min(cols - 1, col(x))), r0 = Math.max(0, Math.min(rows - 1, row(z)));
    if (free(x, z)) return { x, z };
    let best: WalkPoint | null = null, bestDistance = Infinity;
    for (let ring = 1; ring <= reach; ring++) {
      for (let r = r0 - ring; r <= r0 + ring; r++) {
        for (let c = c0 - ring; c <= c0 + ring; c++) {
          if (Math.max(Math.abs(c - c0), Math.abs(r - r0)) !== ring || !inside(c, r) || cells[r * cols + c]) continue;
          const distance = Math.hypot(centreX(c) - x, centreZ(r) - z);
          if (distance < bestDistance) { bestDistance = distance; best = { x: centreX(c), z: centreZ(r) }; }
        }
      }
      // One more ring after the first hit: a diagonal cell of this ring may be farther than a straight one of the next.
      if (best && ring * cell > bestDistance) break;
    }
    return best;
  }

  function clearLine(ax: number, az: number, bx: number, bz: number) {
    const length = Math.hypot(bx - ax, bz - az), steps = Math.max(1, Math.ceil(length / (cell * 0.45)));
    for (let i = 0; i <= steps; i++) { const t = i / steps; if (!free(ax + (bx - ax) * t, az + (bz - az) * t)) return false; }
    return true;
  }

  // A* scratch space, made once per grid.
  const cost = new Float32Array(cols * rows), from = new Int32Array(cols * rows), state = new Uint8Array(cols * rows);
  function path(ax: number, az: number, bx: number, bz: number): WalkPoint[] | null {
    const start = nearest(ax, az), goal = nearest(bx, bz);
    if (!start || !goal) return null;
    if (clearLine(start.x, start.z, goal.x, goal.z)) return [{ x: goal.x, z: goal.z }];
    const sc = col(start.x), sr = row(start.z), gc = col(goal.x), gr = row(goal.z);
    const startIndex = sr * cols + sc, goalIndex = gr * cols + gc;
    cost.fill(Infinity); state.fill(0); from.fill(-1);
    const heap: number[] = [], score: number[] = [];
    const push = (index: number, value: number) => {
      let i = heap.length; heap.push(index); score.push(value);
      while (i > 0) { const parent = (i - 1) >> 1; if (score[parent]! <= value) break; heap[i] = heap[parent]!; score[i] = score[parent]!; i = parent; }
      heap[i] = index; score[i] = value;
    };
    const pop = () => {
      const top = heap[0]!, lastIndex = heap.pop()!, lastScore = score.pop()!;
      if (heap.length) {
        let i = 0;
        for (;;) {
          let child = i * 2 + 1;
          if (child >= heap.length) break;
          if (child + 1 < heap.length && score[child + 1]! < score[child]!) child += 1;
          if (score[child]! >= lastScore) break;
          heap[i] = heap[child]!; score[i] = score[child]!; i = child;
        }
        heap[i] = lastIndex; score[i] = lastScore;
      }
      return top;
    };
    const guess = (c: number, r: number) => { const dx = Math.abs(c - gc), dz = Math.abs(r - gr); return (dx + dz) + (SQRT2 - 2) * Math.min(dx, dz); };
    cost[startIndex] = 0; push(startIndex, guess(sc, sr));
    let found = false;
    while (heap.length) {
      const index = pop();
      if (state[index!] === 2) continue;
      state[index!] = 2;
      if (index === goalIndex) { found = true; break; }
      const c = index! % cols, r = (index! - c) / cols;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = c + dc, nr = r + dr;
        if (!inside(nc, nr)) continue;
        const next = nr * cols + nc;
        if (cells[next] || state[next] === 2) continue;
        // No cutting a corner between two blocked cells.
        if (dr && dc && (cells[r * cols + nc] || cells[nr * cols + c])) continue;
        const value = cost[index!]! + (dr && dc ? SQRT2 : 1);
        if (value < cost[next]!) { cost[next] = value; from[next] = index!; push(next, value + guess(nc, nr)); }
      }
    }
    // Walled off (a stage, an island of floor): go to the reachable place closest to it instead.
    let endIndex = goalIndex;
    if (!found) {
      let best = Infinity;
      for (let index = 0; index < state.length; index++) {
        if (state[index] !== 2) continue;
        const distance = Math.hypot(centreX(index % cols) - goal.x, centreZ(Math.floor(index / cols)) - goal.z);
        if (distance < best) { best = distance; endIndex = index; }
      }
    }
    const raw: WalkPoint[] = [];
    for (let index = endIndex; index !== -1 && index !== startIndex; index = from[index]!) raw.push({ x: centreX(index % cols), z: centreZ(Math.floor(index / cols)) });
    raw.reverse();
    if (found && raw.length) { raw[raw.length - 1]!.x = goal.x; raw[raw.length - 1]!.z = goal.z; }
    // Straighten: from each kept point, skip ahead to the farthest waypoint in clear sight.
    const out: WalkPoint[] = [];
    let hereX = start.x, hereZ = start.z, i = 0;
    while (i < raw.length) {
      let far = i;
      for (let j = raw.length - 1; j > i; j--) if (clearLine(hereX, hereZ, raw[j]!.x, raw[j]!.z)) { far = j; break; }
      out.push(raw[far]!); hereX = raw[far]!.x; hereZ = raw[far]!.z; i = far + 1;
    }
    return out;
  }

  return {
    bounds: [minX, minZ, maxX, maxZ], cell, cols, rows, cells,
    free, nearest, clearLine, path,
    /** Text picture of the grid for tests and debugging: '#' blocked, '.' free; marks: { 'S': [x, z], ... }. */
    ascii(marks: Record<string, [number, number]> = {}) {
      const lines: string[][] = [];
      for (let r = 0; r < rows; r++) {
        let line = '';
        for (let c = 0; c < cols; c++) line += cells[r * cols + c] ? '#' : '.';
        lines.push(line.split(''));
      }
      for (const [mark, at] of Object.entries(marks)) { const c = col(at[0]), r = row(at[1]); if (inside(c, r)) lines[r]![c] = mark[0]!; }
      return lines.map((line: string[]) => line.join('')).join('\n');
    },
  };
}

/**
 * Wrap a geometry batch so that every primitive drawn through it also leaves its ground footprint.
 * Returns { batch (use it exactly like the one given), shapes() → { floor, block, solids, walls } }.
 *   floor   [minX, minZ, maxX, maxZ] of the largest flat slab at ground level (the venue's floor)
 *   block   rectangles of everything that rises above ankle height and starts below chest height
 *           (what hangs overhead — awnings, tree crowns, signs — is walked under), plus water
 *   solids  [x0, y0, z0, x1, y1, z1] boxes of everything bulky enough to hide the avatar from the
 *           camera (tree crowns, kiosks, shelves, people) — WITH heights; what the camera's line to
 *           the avatar is tested against (src/scene/camera-collision.ts)
 *   walls   { backZ, leftX } | null — set when the builder declared a room (batch.walls). Whatever
 *           is drawn wholly inside the strip along a wall (the wall itself, its trim, windows,
 *           boards, a shelf against it) is baked as that wall's PART ('wallBack' / 'wallLeft' —
 *           see build.js), so the scene can hide the wall, with what hangs on it, when the camera
 *           goes round behind it. Parts are never camera solids: a hidden wall hides nothing.
 */
export const WALL_REACH = 0.75;
export type FootprintSolid = [number, number, number, number, number, number];
export interface FootprintShapes {
  floor: WalkRect | null;
  block: WalkRect[];
  solids: FootprintSolid[];
  walls: { backZ: number; leftX: number } | null;
}
/** What footprintRecorder returns: the batch to draw into and the recorded shapes. */
export interface FootprintRecorder { batch: Batch; shapes(): FootprintShapes }

export function footprintRecorder(inner: Batch, { low = 0.34, high = 1.2 }: { low?: number; high?: number } = {}): FootprintRecorder {
  const block: WalkRect[] = [], solids: FootprintSolid[] = [];
  let floor: WalkRect | null = null, floorArea = 0, walls: { backZ: number; leftX: number } | null = null;
  /** Records one primitive's footprint; returns the options to draw it with (the same, or with its wall part). */
  function note(x: number, y: number, z: number, hx: number, hy: number, hz: number, o: BatchOptions | undefined, flat = false): BatchOptions | undefined {
    const c = Math.cos(o?.ry || 0), s = Math.sin(o?.ry || 0);
    // A primitive tipped over (a ring or a sign laid against a wall) has other extents: turn its corners the way the batch does (Y, then X, then Z).
    const tipped = Boolean(o?.rx || o?.rz), cx = Math.cos(o?.rx || 0), sx0 = Math.sin(o?.rx || 0), cz = Math.cos(o?.rz || 0), sz0 = Math.sin(o?.rz || 0);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      let sx = i & 1 ? hx : -hx, sy = i & 2 ? hy : -hy, sz = i & 4 ? hz : -hz;
      if (tipped) {
        const ax = sx * cz - sy * sz0, ay = sx * sz0 + sy * cz;          // about Z
        const by = ay * cx - sz * sx0, bz = ay * sx0 + sz * cx;          // about X
        sx = ax; sy = by; sz = bz;
      }
      const p = inner.world(x + sx * c + sz * s, y + sy, z - sx * s + sz * c);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    const area = (x1 - x0) * (z1 - z0);
    const glass = o?.layer === 'glass';
    if (!glass && !flat && y1 > -0.06 && y1 <= 0.2 && area > floorArea) { floorArea = area; floor = [x0, z0, x1, z1]; }
    if (y0 < high && y1 > low) block.push([x0, z0, x1, z1]);
    else if (glass && y1 <= low && y1 > -0.2 && area > 6) block.push([x0, z0, x1, z1]); // water lying on the ground
    // Wholly inside the strip along a declared wall: it belongs to that wall and hides with it.
    const part = !walls || o?.part ? null : z1 <= walls.backZ + WALL_REACH ? 'wallBack' : x1 <= walls.leftX + WALL_REACH ? 'wallLeft' : null;
    if (part) return { ...o, part };
    if (!flat && !glass && !o?.part && y1 > 0.9 && y1 - y0 > 0.4 && Math.min(x1 - x0, z1 - z0) > 0.25 && area < 80) solids.push([x0, y0, z0, x1, y1, z1]);
    return o;
  }
  const batch: Batch = {
    isBatch: true,
    box(x, y, z, w, h, d, colour, o) { inner.box(x, y, z, w, h, d, colour, note(x, y, z, w / 2, h / 2, d / 2, o)); return batch; },
    cyl(x, y, z, r, h, colour, o) { inner.cyl(x, y, z, r, h, colour, note(x, y, z, r * (o?.sx || 1), h / 2, r * (o?.sz || 1), o)); return batch; },
    cone(x, y, z, r, h, colour, o) { return batch.cyl(x, y, z, r, h, colour, { ...o, top: 0 }); },
    ball(x, y, z, rx, ry, rz, colour, o) { inner.ball(x, y, z, rx, ry, rz, colour, note(x, y, z, rx, ry, rz, o)); return batch; },
    ico(x, y, z, rx, ry, rz, colour, o) { inner.ico(x, y, z, rx, ry, rz, colour, note(x, y, z, rx, ry, rz, o)); return batch; },
    quad(x, y, z, w, h, colour, o) { inner.quad(x, y, z, w, h, colour, note(x, y, z, w / 2, h / 2, 0.02, o)); return batch; },
    disc(x, y, z, r, colour, o) { inner.disc(x, y, z, r, colour, note(x, y, z, r * (o?.sx || 1), 0.01, r * (o?.sz || 1), o, true)); return batch; },
    at(x, y, z, ry, draw, rx, rz, scale) { inner.at(x, y, z, ry, () => draw(batch), rx, rz, scale); return batch; },
    light(x, y, z, colour, intensity, distance) { inner.light(x, y, z, colour, intensity, distance); return batch; },
    /** The builder's room: a back wall along z = −d / 2 and a left wall along x = −w / 2 (props.js room()). */
    walls({ w, d }: { w?: number; d?: number } = {}) { if (Number.isFinite(w) && Number.isFinite(d)) walls = { backZ: -d! / 2, leftX: -w! / 2 }; return batch; },
    world: (x, y, z) => inner.world(x, y, z),
    get triangles() { return inner.triangles; },
    build: (materials) => inner.build(materials),
  };
  return { batch, shapes: () => ({ floor, block, solids, walls }) };
}

/** Shortest signed turn from one heading to another. */
export function turnTowards(from: number, to: number) {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2; else if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

/**
 * The avatar's position and how it moves.
 *   walker.x / z / ry / moving / mode ('idle' | 'keys' | 'path')
 *   walker.setGrid(grid)                       the floor to walk on (null = no walking)
 *   walker.place(x, z, ry?)                    put the avatar somewhere at once
 *   walker.input(right, forward, jog)          held movement keys / joystick, each −1…1, relative to the camera
 *   walker.goTo(x, z, { exact, face, arrive }) walk a path there. exact: finish with a straight hop to
 *                                              exactly (x, z) even if that place is off the walkable floor;
 *                                              via: { x, z } the approach point the path ends at before that
 *                                              hop; leave: { x, z } where to step back on to the floor first
 *                                              when the avatar stands off it; face: heading to take on
 *                                              arrival; arrive(): called once there;
 *                                              jog: true / false (default: jog when the path is long)
 *   walker.others = [{ x, z }, ...]            other figures to keep clear of (live objects; may move)
 *   walker.reach                               how close two figures' centres may come (default 2 radii)
 *   walker.stop()                              drop the path and the input
 *   walker.step(dt, cameraYaw, snap?) → bool   advance; true while still moving or turning
 */
export type WalkMode = 'idle' | 'keys' | 'path';
export interface WalkToOptions {
  exact?: boolean;
  via?: WalkPoint | null;
  steps?: WalkPoint | WalkPoint[] | null;
  leave?: WalkPoint | WalkPoint[] | null;
  face?: number | null;
  arrive?: (() => void) | null;
  jog?: boolean;
}
export interface Walker {
  x: number;
  z: number;
  ry: number;
  moving: boolean;
  mode: WalkMode;
  speed: number;
  jogSpeed: number;
  blocked: boolean;
  others: WalkPoint[] | null;
  reach: number;
  heading: number;
  readonly passing: boolean;
  readonly hopping: boolean;
  readonly grid: WalkGrid | null;
  readonly target: WalkPoint | null;
  readonly hasInput: boolean;
  readonly jogging: boolean;
  setGrid(next: WalkGrid | null | undefined): void;
  place(x: number, z: number, ry?: number): void;
  input(right: number, forward: number, fast?: boolean): void;
  goTo(x: number, z: number, options?: WalkToOptions): boolean;
  stop(): void;
  finishNow(): boolean;
  step(dt: number, cameraYaw?: number, snap?: boolean): boolean;
}
interface RouteNode extends WalkPoint { hop: boolean }

export function createWalker({ speed = WALK_SPEED, jogSpeed = JOG_SPEED }: { speed?: number; jogSpeed?: number } = {}): Walker {
  let grid: WalkGrid | null = null, inputX = 0, inputZ = 0, jog = false, routeJog = false;
  let route: RouteNode[] | null = null, routeIndex = 0, face: number | null = null, arrive: (() => void) | null = null, turning = false;
  let stuck = 0, ghost = false, nearest = Infinity;
  /**
   * Keep clear of the other figures. Called after the avatar has moved from (fromX, fromZ): each
   * figure closer than `reach` pushes it straight back out, never by more than it just walked — so
   * walking AT someone goes nowhere (a soft block) and walking past them slides round. Head-on, a
   * sideways share is added so a path bends round a person instead of stopping in front of them.
   * A push never leaves the floor. And nobody is ever trapped: making no headway against the crowd
   * for 0.4 s lets the avatar pass through until it is clear of everyone again.
   */
  function avoid(fromX: number, fromZ: number, dt: number) {
    const others = walker.others;
    if (!others || !others.length) { stuck = 0; return; }
    const reach = walker.reach, moved = Math.hypot(walker.x - fromX, walker.z - fromZ);
    let touching = false, pushX = 0, pushZ = 0;
    for (let i = 0; i < others.length; i++) {
      const other = others[i]!;
      let dx = walker.x - other.x, dz = walker.z - other.z;
      const distance = Math.hypot(dx, dz);
      if (distance >= reach) continue;
      touching = true;
      if (ghost) continue;
      if (distance < 1e-4) { dx = Math.sin(walker.ry); dz = Math.cos(walker.ry); } else { dx /= distance; dz /= distance; }
      const depth = reach - distance;
      pushX += dx * depth; pushZ += dz * depth;
      // Head-on (the push points back along the heading): add a turn to the side the figure is not on.
      if (Number.isFinite(walker.heading)) {
        const hx = Math.sin(walker.heading), hz = Math.cos(walker.heading);
        if (dx * hx + dz * hz < -0.7) { const side = dx * hz - dz * hx >= 0 ? 1 : -1; pushX += hz * side * depth; pushZ += -hx * side * depth; }
      }
    }
    if (!touching) { ghost = false; stuck = 0; return; }
    if (ghost) return;
    const size = Math.hypot(pushX, pushZ), limit = Math.max(moved, 1e-3) * 1.05;
    if (size > 1e-6) {
      const scale = Math.min(1, limit / size);
      const nx = walker.x + pushX * scale, nz = walker.z + pushZ * scale;
      if (!grid || grid.free(nx, nz)) { walker.x = nx; walker.z = nz; }
      else if (grid.free(nx, walker.z)) walker.x = nx;
      else if (grid.free(walker.x, nz)) walker.z = nz;
    }
    // Headway: is the avatar getting anywhere in the direction it wants to go? (Being shoved sideways is not headway.)
    // If the crowd has held it for a moment, let it through.
    if (route) {
      // On a path: is it getting any nearer to where it is going?
      const end = route[route.length - 1]!, gap = Math.hypot(end.x - walker.x, end.z - walker.z);
      if (gap < nearest - 0.01) { nearest = gap; stuck = 0; } else stuck += dt;
    } else {
      const gained = Number.isFinite(walker.heading) ? (walker.x - fromX) * Math.sin(walker.heading) + (walker.z - fromZ) * Math.cos(walker.heading) : Math.hypot(walker.x - fromX, walker.z - fromZ);
      stuck = gained < moved * 0.35 ? stuck + dt : Math.max(0, stuck - dt * 2);
    }
    if (stuck > 0.4) { ghost = true; stuck = 0; }
  }
  const reset = () => { route = null; routeIndex = 0; face = null; arrive = null; turning = false; walker.moving = false; walker.mode = 'idle'; };
  const point = (value: WalkPoint | null | undefined): WalkPoint | null => (value && Number.isFinite(value.x) && Number.isFinite(value.z) ? value : null);
  /** A list of off-floor points ({ x, z } or [{ x, z }, ...]) as hop nodes. */
  const hops = (value: WalkPoint | WalkPoint[] | null | undefined): RouteNode[] => (Array.isArray(value) ? value : [value]).map(point).filter(Boolean).map((at) => ({ x: at!.x, z: at!.z, hop: true }));
  const walker: Walker = {
    x: 0, z: 0, ry: 0, moving: false, mode: 'idle', speed, jogSpeed, blocked: false, others: null, reach: AVATAR_RADIUS * 2,
    /** True while the avatar is being let through a crowd that had boxed it in. */
    get passing() { return ghost; },
    /** True while the avatar is on a hop (stepping on to or off a place that is not on the walkable floor). */
    get hopping() { return Boolean(route) && routeIndex < route!.length && route![routeIndex]!.hop === true; },
    setGrid(next) { grid = next || null; },
    get grid() { return grid; },
    get target() { const end = route ? route[route.length - 1] : null; return end ? { x: end.x, z: end.z } : null; },
    place(x, z, ry) {
      walker.x = x; walker.z = z; if (Number.isFinite(ry)) walker.ry = ry!;
      walker.heading = NaN;
      reset(); stuck = 0; ghost = false;
    },
    input(right, forward, fast = false) {
      inputX = Math.max(-1, Math.min(1, Number(right) || 0)); inputZ = Math.max(-1, Math.min(1, Number(forward) || 0)); jog = Boolean(fast);
      if (inputX || inputZ) { route = null; face = null; arrive = null; }
    },
    get hasInput() { return inputX !== 0 || inputZ !== 0; },
    /** True while the avatar is going faster than a walk (Shift, a full push of the joystick, a long path). */
    get jogging() { return route ? routeJog : jog && (inputX !== 0 || inputZ !== 0); },
    /**
     * Walk to (x, z). The route is: [off the place it stands on (options.leave)] → a path over the
     * floor → [up the approach (options.via, then options.steps)] → [a last hop to exactly (x, z)].
     *   exact   finish with a straight hop to exactly (x, z) even if that is off the walkable floor
     *   via     { x, z } the approach point on the floor the path ends at before the hop
     *   steps   [{ x, z }, ...] further points of the way up, walked in order after `via` (a stair
     *           top, a platform, a bridge end) — all off the floor
     *   leave   { x, z } | [{ x, z }, ...] the way back down from where the avatar stands, ending
     *           on the floor; without it an avatar that is off the floor steps to the nearest free place
     */
    goTo(x, z, options: WalkToOptions = {}) {
      if (!grid || !Number.isFinite(x) || !Number.isFinite(z)) return false;
      const nodes: RouteNode[] = [];
      let fromX = walker.x, fromZ = walker.z;
      if (!grid.free(walker.x, walker.z)) {
        const down: RouteNode[] = options.leave ? hops(options.leave) : [];
        if (down.length) {
          // The last point of the way down is on the floor: walked to like any waypoint.
          const foot = grid.nearest(down[down.length - 1]!.x, down[down.length - 1]!.z);
          down.pop();
          nodes.push(...down);
          if (foot) nodes.push({ x: foot.x, z: foot.z, hop: true });
        } else { const back = grid.nearest(walker.x, walker.z); if (back) nodes.push({ x: back.x, z: back.z, hop: true }); }
        if (nodes.length) { fromX = nodes[nodes.length - 1]!.x; fromZ = nodes[nodes.length - 1]!.z; }
      }
      // A raised or walled-in place is approached at its approach point: the path ends there, the hop starts there.
      const via = point(options.via) ? grid.nearest(options.via!.x, options.via!.z) : null;
      const aim = via || { x, z };
      const waypoints = grid.path(fromX, fromZ, aim.x, aim.z);
      if (!waypoints) return false;
      for (const next of waypoints) nodes.push({ x: next.x, z: next.z, hop: false });
      if (via && options.steps) nodes.push(...hops(options.steps));
      const end: WalkPoint = nodes.length ? nodes[nodes.length - 1]! : walker;
      if ((options.exact || via) && Math.hypot(end.x - x, end.z - z) > 0.05) nodes.push({ x, z, hop: true });
      if (!nodes.length) return false; // already there
      route = nodes; routeIndex = 0; nearest = Infinity; stuck = 0;
      face = Number.isFinite(options.face) ? options.face! : null;
      arrive = typeof options.arrive === 'function' ? options.arrive : null;
      // A long way (across the venue) is jogged, so being sent somewhere never takes long.
      let length = 0, lastX = walker.x, lastZ = walker.z;
      for (const next of route) { length += Math.hypot(next.x - lastX, next.z - lastZ); lastX = next.x; lastZ = next.z; }
      routeJog = options.jog === undefined ? length > LONG_WALK : Boolean(options.jog);
      inputX = 0; inputZ = 0; turning = false;
      walker.mode = 'path'; walker.moving = true;
      return true;
    },
    stop() { reset(); inputX = 0; inputZ = 0; },
    /** Jump to the end of the current path (reduced motion, or no frame loop available). */
    finishNow() {
      if (!route) return false;
      const end = route[route.length - 1]!;
      walker.x = end.x; walker.z = end.z;
      if (face !== null) walker.ry = face;
      const done = arrive;
      reset();
      done?.();
      return true;
    },
    step(dt, cameraYaw = 0, snap = false) {
      walker.blocked = false;
      const fromX = walker.x, fromZ = walker.z;
      let hopped = false;
      if (route) {
        let left = (routeJog ? walker.jogSpeed : walker.speed) * dt;
        while (left > 0 && route) {
          const next = route[routeIndex];
          if (!next) { route = null; break; }
          if (next.hop) hopped = true;
          const dx = next.x - walker.x, dz = next.z - walker.z, distance = Math.hypot(dx, dz);
          if (distance > 1e-4) walker.heading = Math.atan2(dx, dz);
          if (distance <= left) {
            walker.x = next.x; walker.z = next.z; left -= distance;
            routeIndex += 1;
            if (routeIndex >= route.length) route = null;
          } else { walker.x += (dx / distance) * left; walker.z += (dz / distance) * left; left = 0; }
        }
        if (!route) {
          const done = arrive, facing = face;
          reset();
          turning = facing !== null;
          if (turning) walker.heading = facing!;
          done?.();
        } else walker.moving = true;
      } else if (inputX || inputZ) {
        // Forward is away from the camera; right is the camera's right.
        const sin = Math.sin(cameraYaw), cos = Math.cos(cameraYaw);
        let vx = inputX * cos - inputZ * sin, vz = -inputX * sin - inputZ * cos;
        const size = Math.hypot(vx, vz);
        if (size > 1) { vx /= size; vz /= size; }
        const pace = (jog ? walker.jogSpeed : walker.speed) * dt;
        const nx = walker.x + vx * pace, nz = walker.z + vz * pace;
        walker.heading = Math.atan2(vx, vz);
        walker.mode = 'keys'; walker.moving = true; turning = false;
        if (!grid || grid.free(nx, nz)) { walker.x = nx; walker.z = nz; }
        else if (!grid.free(walker.x, walker.z)) {
          // Off the floor (sitting at a spot): walk straight back on to it.
          const back = grid.nearest(walker.x, walker.z);
          if (back) {
            const dx = back.x - walker.x, dz = back.z - walker.z, distance = Math.hypot(dx, dz) || 1;
            const move = Math.min(distance, pace);
            walker.x += (dx / distance) * move; walker.z += (dz / distance) * move;
          }
          hopped = true;
        }
        else if (vx && grid.free(nx, walker.z)) { walker.x = nx; walker.blocked = !vz; }       // slide along a wall
        else if (vz && grid.free(walker.x, nz)) { walker.z = nz; walker.blocked = !vx; }
        else walker.blocked = true;
      } else if (walker.mode === 'keys') { walker.mode = 'idle'; walker.moving = false; }
      // Other figures are walked round, not through — except on a hop on to a seat or a stage, which is exact.
      if (walker.moving && !hopped && !snap) avoid(fromX, fromZ, dt);
      // Turn to face where the avatar is heading.
      if (Number.isFinite(walker.heading)) {
        const delta = turnTowards(walker.ry, walker.heading);
        if (snap || Math.abs(delta) < 0.02) { walker.ry = walker.heading; turning = false; if (!walker.moving) walker.heading = NaN; }
        else {
          walker.ry += Math.sign(delta) * Math.min(Math.abs(delta), TURN_RATE * dt);
          if (walker.ry > Math.PI) walker.ry -= Math.PI * 2; else if (walker.ry < -Math.PI) walker.ry += Math.PI * 2;
          if (!walker.moving) turning = true;
        }
      }
      return walker.moving || turning;
    },
    heading: NaN,
  };
  return walker;
}

/**
 * Sends a position to someone else at most `perSecond` times a second, and only when it moved
 * by `minStep`. report(x, z, now) → true when it sent. flush(now) sends the last unsent position.
 */
export interface PositionReporter {
  report(x: number, z: number, now: number): boolean;
  flush(now: number): boolean;
  rest(x: number, z: number, now: number): boolean;
  reset(): void;
}
export function createPositionReporter(send: (x: number, z: number) => void, { perSecond = 3, minStep = 0.25 }: { perSecond?: number; minStep?: number } = {}): PositionReporter {
  let lastAt = -Infinity, lastX = NaN, lastZ = NaN, waitingX = NaN, waitingZ = NaN;
  const gap = 1000 / perSecond;
  const moved = (x: number, z: number) => !(Math.hypot(x - lastX, z - lastZ) < minStep);
  function report(x: number, z: number, now: number) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !moved(x, z)) { waitingX = NaN; return false; }
    if (now - lastAt < gap) { waitingX = x; waitingZ = z; return false; }
    lastAt = now; lastX = x; lastZ = z; waitingX = NaN;
    send(Math.round(x * 100) / 100, Math.round(z * 100) / 100);
    return true;
  }
  return {
    report,
    flush(now) { return Number.isFinite(waitingX) ? report(waitingX, waitingZ, Math.max(now, lastAt + gap)) : false; },
    /** The avatar came to rest at (x, z): others must see it exactly there, however recently the last report went. */
    rest(x, z, now) {
      waitingX = NaN;
      if (!Number.isFinite(x) || !Number.isFinite(z) || Math.hypot(x - lastX, z - lastZ) < 0.02) return false;
      lastAt = now; lastX = x; lastZ = z;
      send(Math.round(x * 100) / 100, Math.round(z * 100) / 100);
      return true;
    },
    reset() { lastAt = -Infinity; lastX = NaN; lastZ = NaN; waitingX = NaN; },
  };
}
