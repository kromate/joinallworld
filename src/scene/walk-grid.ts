/**
 * Pure walk-grid construction and pathfinding. Kept separate from the per-frame walker so rules
 * can route over a venue without loading rendering movement code.
 */
export const CELL = 0.4;
export const AVATAR_RADIUS = 0.34;
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
