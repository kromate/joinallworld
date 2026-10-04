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
 *            a stage) — how a spot's own anchor is reached when it sits inside an obstacle
 *   step() allocates nothing and returns true while there is still motion, which is what keeps the
 *   host's frame loop alive — and lets it stop the moment the avatar arrives.
 */

export const CELL = 0.4;
export const AVATAR_RADIUS = 0.34;
export const WALK_SPEED = 4.6, JOG_SPEED = 8;
/** A path longer than this is jogged unless the caller says otherwise. */
export const LONG_WALK = 9;
const TURN_RATE = 14; // radians per second the avatar turns towards where it is going
const SQRT2 = Math.SQRT2;

const isCircle = (shape) => Array.isArray(shape) && shape.length === 3;

/**
 * An occupancy grid over a rectangle of floor.
 * grid.free(x, z)            may the avatar's centre be here?
 * grid.nearest(x, z)         → { x, z } the closest free place (itself when free), or null
 * grid.clearLine(a, b)       is the straight line between two points free all the way?
 * grid.path(ax, az, bx, bz)  → [{ x, z }, ...] waypoints ending at b — or, when b is walled off, at the
 *                            reachable place closest to it. Empty when already there; null without a floor.
 */
export function createWalkGrid({ bounds = [-10, -8, 10, 8], block = [], clear = [], cell = CELL, radius = AVATAR_RADIUS } = {}) {
  const [minX, minZ, maxX, maxZ] = bounds;
  const cols = Math.max(1, Math.ceil((maxX - minX) / cell)), rows = Math.max(1, Math.ceil((maxZ - minZ) / cell));
  const cells = new Uint8Array(cols * rows);
  const col = (x) => Math.floor((x - minX) / cell), row = (z) => Math.floor((z - minZ) / cell);
  const centreX = (c) => minX + (c + 0.5) * cell, centreZ = (r) => minZ + (r + 0.5) * cell;
  const inside = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows;

  function paint(shape, value, grow) {
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

  const free = (x, z) => { const c = col(x), r = row(z); return inside(c, r) && cells[r * cols + c] === 0; };

  function nearest(x, z, reach = Math.max(cols, rows)) {
    const c0 = Math.max(0, Math.min(cols - 1, col(x))), r0 = Math.max(0, Math.min(rows - 1, row(z)));
    if (free(x, z)) return { x, z };
    let best = null, bestDistance = Infinity;
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

  function clearLine(ax, az, bx, bz) {
    const length = Math.hypot(bx - ax, bz - az), steps = Math.max(1, Math.ceil(length / (cell * 0.45)));
    for (let i = 0; i <= steps; i++) { const t = i / steps; if (!free(ax + (bx - ax) * t, az + (bz - az) * t)) return false; }
    return true;
  }

  // A* scratch space, made once per grid.
  const cost = new Float32Array(cols * rows), from = new Int32Array(cols * rows), state = new Uint8Array(cols * rows);
  function path(ax, az, bx, bz) {
    const start = nearest(ax, az), goal = nearest(bx, bz);
    if (!start || !goal) return null;
    if (clearLine(start.x, start.z, goal.x, goal.z)) return [{ x: goal.x, z: goal.z }];
    const sc = col(start.x), sr = row(start.z), gc = col(goal.x), gr = row(goal.z);
    const startIndex = sr * cols + sc, goalIndex = gr * cols + gc;
    cost.fill(Infinity); state.fill(0); from.fill(-1);
    const heap = [], score = [];
    const push = (index, value) => {
      let i = heap.length; heap.push(index); score.push(value);
      while (i > 0) { const parent = (i - 1) >> 1; if (score[parent] <= value) break; heap[i] = heap[parent]; score[i] = score[parent]; i = parent; }
      heap[i] = index; score[i] = value;
    };
    const pop = () => {
      const top = heap[0], lastIndex = heap.pop(), lastScore = score.pop();
      if (heap.length) {
        let i = 0;
        for (;;) {
          let child = i * 2 + 1;
          if (child >= heap.length) break;
          if (child + 1 < heap.length && score[child + 1] < score[child]) child += 1;
          if (score[child] >= lastScore) break;
          heap[i] = heap[child]; score[i] = score[child]; i = child;
        }
        heap[i] = lastIndex; score[i] = lastScore;
      }
      return top;
    };
    const guess = (c, r) => { const dx = Math.abs(c - gc), dz = Math.abs(r - gr); return (dx + dz) + (SQRT2 - 2) * Math.min(dx, dz); };
    cost[startIndex] = 0; push(startIndex, guess(sc, sr));
    let found = false;
    while (heap.length) {
      const index = pop();
      if (state[index] === 2) continue;
      state[index] = 2;
      if (index === goalIndex) { found = true; break; }
      const c = index % cols, r = (index - c) / cols;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = c + dc, nr = r + dr;
        if (!inside(nc, nr)) continue;
        const next = nr * cols + nc;
        if (cells[next] || state[next] === 2) continue;
        // No cutting a corner between two blocked cells.
        if (dr && dc && (cells[r * cols + nc] || cells[nr * cols + c])) continue;
        const value = cost[index] + (dr && dc ? SQRT2 : 1);
        if (value < cost[next]) { cost[next] = value; from[next] = index; push(next, value + guess(nc, nr)); }
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
    const raw = [];
    for (let index = endIndex; index !== -1 && index !== startIndex; index = from[index]) raw.push({ x: centreX(index % cols), z: centreZ(Math.floor(index / cols)) });
    raw.reverse();
    if (found && raw.length) { raw[raw.length - 1].x = goal.x; raw[raw.length - 1].z = goal.z; }
    // Straighten: from each kept point, skip ahead to the farthest waypoint in clear sight.
    const out = [];
    let hereX = start.x, hereZ = start.z, i = 0;
    while (i < raw.length) {
      let far = i;
      for (let j = raw.length - 1; j > i; j--) if (clearLine(hereX, hereZ, raw[j].x, raw[j].z)) { far = j; break; }
      out.push(raw[far]); hereX = raw[far].x; hereZ = raw[far].z; i = far + 1;
    }
    return out;
  }

  return {
    bounds: [minX, minZ, maxX, maxZ], cell, cols, rows, cells,
    free, nearest, clearLine, path,
    /** Text picture of the grid for tests and debugging: '#' blocked, '.' free; marks: { 'S': [x, z], ... }. */
    ascii(marks = {}) {
      const lines = [];
      for (let r = 0; r < rows; r++) {
        let line = '';
        for (let c = 0; c < cols; c++) line += cells[r * cols + c] ? '#' : '.';
        lines.push(line.split(''));
      }
      for (const [mark, at] of Object.entries(marks)) { const c = col(at[0]), r = row(at[1]); if (inside(c, r)) lines[r][c] = mark[0]; }
      return lines.map((line) => line.join('')).join('\n');
    },
  };
}

/**
 * Wrap a geometry batch so that every primitive drawn through it also leaves its ground footprint.
 * Returns { batch (use it exactly like the one given), shapes() → { floor, block } }.
 *   floor   [minX, minZ, maxX, maxZ] of the largest flat slab at ground level (the venue's floor)
 *   block   rectangles of everything that rises above ankle height and starts below chest height
 *           (what hangs overhead — awnings, tree crowns, signs — is walked under), plus water
 */
export function footprintRecorder(inner, { low = 0.34, high = 1.2 } = {}) {
  const block = [];
  let floor = null, floorArea = 0;
  function note(x, y, z, hx, hy, hz, o, flat = false) {
    const c = Math.cos(o?.ry || 0), s = Math.sin(o?.ry || 0);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      const sx = i & 1 ? hx : -hx, sy = i & 2 ? hy : -hy, sz = i & 4 ? hz : -hz;
      const p = inner.world(x + sx * c + sz * s, y + sy, z - sx * s + sz * c);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    const area = (x1 - x0) * (z1 - z0);
    const glass = o?.layer === 'glass';
    if (!glass && !flat && y1 > -0.06 && y1 <= 0.2 && area > floorArea) { floorArea = area; floor = [x0, z0, x1, z1]; }
    if (y0 < high && y1 > low) block.push([x0, z0, x1, z1]);
    else if (glass && y1 <= low && y1 > -0.2 && area > 6) block.push([x0, z0, x1, z1]); // water lying on the ground
  }
  const batch = {
    isBatch: true,
    box(x, y, z, w, h, d, colour, o) { note(x, y, z, w / 2, h / 2, d / 2, o); inner.box(x, y, z, w, h, d, colour, o); return batch; },
    cyl(x, y, z, r, h, colour, o) { note(x, y, z, r * (o?.sx || 1), h / 2, r * (o?.sz || 1), o); inner.cyl(x, y, z, r, h, colour, o); return batch; },
    cone(x, y, z, r, h, colour, o) { return batch.cyl(x, y, z, r, h, colour, { ...o, top: 0 }); },
    ball(x, y, z, rx, ry, rz, colour, o) { note(x, y, z, rx, ry, rz, o); inner.ball(x, y, z, rx, ry, rz, colour, o); return batch; },
    ico(x, y, z, rx, ry, rz, colour, o) { note(x, y, z, rx, ry, rz, o); inner.ico(x, y, z, rx, ry, rz, colour, o); return batch; },
    quad(x, y, z, w, h, colour, o) { note(x, y, z, w / 2, h / 2, 0.02, o); inner.quad(x, y, z, w, h, colour, o); return batch; },
    disc(x, y, z, r, colour, o) { note(x, y, z, r * (o?.sx || 1), 0.01, r * (o?.sz || 1), o, true); inner.disc(x, y, z, r, colour, o); return batch; },
    at(x, y, z, ry, draw, rx, rz, scale) { inner.at(x, y, z, ry, () => draw(batch), rx, rz, scale); return batch; },
    light(...args) { inner.light(...args); return batch; },
    world: (x, y, z) => inner.world(x, y, z),
    get triangles() { return inner.triangles; },
    build: (materials) => inner.build(materials),
  };
  return { batch, shapes: () => ({ floor, block }) };
}

/** Shortest signed turn from one heading to another. */
export function turnTowards(from, to) {
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
 *                                              face: heading to take on arrival; arrive(): called once there;
 *                                              jog: true / false (default: jog when the path is long)
 *   walker.stop()                              drop the path and the input
 *   walker.step(dt, cameraYaw, snap?) → bool   advance; true while still moving or turning
 */
export function createWalker({ speed = WALK_SPEED, jogSpeed = JOG_SPEED } = {}) {
  let grid = null, inputX = 0, inputZ = 0, jog = false;
  let route = null, routeIndex = 0, finish = null, face = null, arrive = null, turning = false;
  const walker = {
    x: 0, z: 0, ry: 0, moving: false, mode: 'idle', speed, jogSpeed, blocked: false,
    setGrid(next) { grid = next || null; },
    get grid() { return grid; },
    get target() { return route ? (finish || route[route.length - 1]) : null; },
    place(x, z, ry) {
      walker.x = x; walker.z = z; if (Number.isFinite(ry)) walker.ry = ry;
      walker.heading = NaN;
      route = null; finish = null; face = null; arrive = null; turning = false; walker.moving = false; walker.mode = 'idle';
    },
    input(right, forward, fast = false) {
      inputX = Math.max(-1, Math.min(1, Number(right) || 0)); inputZ = Math.max(-1, Math.min(1, Number(forward) || 0)); jog = Boolean(fast);
      if (inputX || inputZ) { route = null; finish = null; face = null; arrive = null; }
    },
    get hasInput() { return inputX !== 0 || inputZ !== 0; },
    goTo(x, z, options = {}) {
      if (!grid || !Number.isFinite(x) || !Number.isFinite(z)) return false;
      const waypoints = grid.path(walker.x, walker.z, x, z);
      if (!waypoints) return false;
      // Standing off the floor (on a seat, a stage): step back on to it first.
      const start = grid.free(walker.x, walker.z) ? null : grid.nearest(walker.x, walker.z);
      route = start ? [start, ...waypoints] : waypoints;
      routeIndex = 0;
      const end = route[route.length - 1];
      finish = options.exact && Math.hypot(end.x - x, end.z - z) > 0.05 ? { x, z } : null;
      face = Number.isFinite(options.face) ? options.face : null;
      arrive = typeof options.arrive === 'function' ? options.arrive : null;
      // A long way (across the venue) is jogged, so being sent somewhere never takes long.
      let length = 0, fromX = walker.x, fromZ = walker.z;
      for (const next of route) { length += Math.hypot(next.x - fromX, next.z - fromZ); fromX = next.x; fromZ = next.z; }
      jog = options.jog === undefined ? length > LONG_WALK : Boolean(options.jog);
      inputX = 0; inputZ = 0; turning = false;
      walker.mode = 'path'; walker.moving = true;
      return true;
    },
    stop() { route = null; finish = null; face = null; arrive = null; inputX = 0; inputZ = 0; turning = false; walker.moving = false; walker.mode = 'idle'; },
    /** Jump to the end of the current path (reduced motion, or no frame loop available). */
    finishNow() {
      if (!route) return false;
      const end = finish || route[route.length - 1];
      walker.x = end.x; walker.z = end.z;
      if (face !== null) walker.ry = face;
      const done = arrive;
      route = null; finish = null; face = null; arrive = null; turning = false; walker.moving = false; walker.mode = 'idle';
      done?.();
      return true;
    },
    step(dt, cameraYaw = 0, snap = false) {
      walker.blocked = false;
      if (route) {
        let left = (jog ? walker.jogSpeed : walker.speed) * dt;
        while (left > 0 && route) {
          const hop = routeIndex >= route.length;
          const next = hop ? finish : route[routeIndex];
          if (!next) { route = null; break; }
          const dx = next.x - walker.x, dz = next.z - walker.z, distance = Math.hypot(dx, dz);
          if (distance > 1e-4) walker.heading = Math.atan2(dx, dz);
          if (distance <= left) {
            walker.x = next.x; walker.z = next.z; left -= distance;
            if (hop) { route = null; finish = null; } else { routeIndex += 1; if (routeIndex >= route.length && !finish) route = null; }
          } else { walker.x += (dx / distance) * left; walker.z += (dz / distance) * left; left = 0; }
        }
        if (!route) {
          const done = arrive; arrive = null;
          walker.mode = 'idle'; walker.moving = false; turning = face !== null;
          if (turning) walker.heading = face;
          face = null;
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
        }
        else if (vx && grid.free(nx, walker.z)) { walker.x = nx; walker.blocked = !vz; }       // slide along a wall
        else if (vz && grid.free(walker.x, nz)) { walker.z = nz; walker.blocked = !vx; }
        else walker.blocked = true;
      } else if (walker.mode === 'keys') { walker.mode = 'idle'; walker.moving = false; }
      // Turn to face where the avatar is heading.
      if (Number.isFinite(walker.heading)) {
        const delta = turnTowards(walker.ry, walker.heading);
        if (snap || Math.abs(delta) < 0.02) { walker.ry = walker.heading; turning = false; if (!walker.moving) walker.heading = NaN; }
        else { walker.ry += Math.sign(delta) * Math.min(Math.abs(delta), TURN_RATE * dt); if (!walker.moving) turning = true; }
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
export function createPositionReporter(send, { perSecond = 3, minStep = 0.25 } = {}) {
  let lastAt = -Infinity, lastX = NaN, lastZ = NaN, waitingX = NaN, waitingZ = NaN;
  const gap = 1000 / perSecond;
  const moved = (x, z) => !(Math.hypot(x - lastX, z - lastZ) < minStep);
  function report(x, z, now) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !moved(x, z)) { waitingX = NaN; return false; }
    if (now - lastAt < gap) { waitingX = x; waitingZ = z; return false; }
    lastAt = now; lastX = x; lastZ = z; waitingX = NaN;
    send(Math.round(x * 100) / 100, Math.round(z * 100) / 100);
    return true;
  }
  return {
    report,
    flush(now) { return Number.isFinite(waitingX) ? report(waitingX, waitingZ, Math.max(now, lastAt + gap)) : false; },
    reset() { lastAt = -Infinity; lastX = NaN; lastZ = NaN; waitingX = NaN; },
  };
}
