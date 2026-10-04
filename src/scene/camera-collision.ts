/**
 * OWNER: scenes
 * Keeping the avatar in sight. Pure arithmetic on plain numbers — no THREE, no DOM, no timers — so
 * it runs under `node --test`.
 *
 * THE PROBLEM. Zoomed in, the camera sits a few units from the avatar and can end up inside a tree
 * crown, behind a kiosk or behind somebody's back. Per-frame mesh raycasts would be far too much
 * work for a scene baked into a few merged meshes, so the test is against BOXES: the same footprints
 * the walking code derives from what a scene draws (movement.js footprintRecorder → `solids`), with
 * their heights, plus a box per person. A few hundred slab tests, and only on a frame in which the
 * camera or the avatar actually moved.
 *
 * WHAT IS DONE ABOUT IT (the host, src/venue-world.ts, applies both; both are eased, never snapped)
 *   pull    the camera is brought in along its own ray to just in front of the first thing the
 *           line from the avatar's head to the camera meets — only when the player has zoomed in
 *           (at the composed wide view a lamp post crossing the line must not dolly the camera)
 *   ghost   when pulling in is not enough (the thing is right behind the avatar's shoulder, or the
 *           view is wide), whatever is between camera and avatar is dithered away in a small
 *           circle around the avatar, so the avatar shows through it
 *
 * createOccluders() holds the boxes; sweep() is the test; resolve() turns a hit into { cap, ghost }.
 */

/** One box: [x0, y0, z0, x1, y1, z1]. */
export type OccluderBox = [number, number, number, number, number, number];
/** A person standing about, as a box: x / z centre, top height. */
export interface OccluderPerson { x: number; z: number; top?: number }
export interface Occluders {
  setStatic(boxes: OccluderBox[] | Float32Array | null | undefined): void;
  setPeople(people: OccluderPerson[] | null | undefined, radius?: number): void;
  readonly count: number;
  sweep(hx: number, hy: number, hz: number, cx: number, cy: number, cz: number, skin?: number): number;
}

/** Boxes are stored flat: [x0, y0, z0, x1, y1, z1] per box. */
export function createOccluders(): Occluders {
  let fixed: Float32Array = new Float32Array(0), moving: Float32Array = new Float32Array(0), movingCount = 0;
  return {
    /** The scene's own solids: [[x0, y0, z0, x1, y1, z1], ...] (or a ready Float32Array). Set once per scene. */
    setStatic(boxes) {
      if (boxes instanceof Float32Array) { fixed = boxes; return; }
      const list = Array.isArray(boxes) ? boxes : [];
      fixed = new Float32Array(list.length * 6);
      for (let i = 0; i < list.length; i++) for (let k = 0; k < 6; k++) fixed[i * 6 + k] = list[i]![k]!;
    },
    /** People standing about: [{ x, z, top }] — a box each. Re-read whenever the crowd changed or moved; allocates only when it grows. */
    setPeople(people, radius = 0.32) {
      const list = Array.isArray(people) ? people : [];
      if (moving.length < list.length * 6) moving = new Float32Array(list.length * 6);
      movingCount = list.length;
      for (let i = 0; i < list.length; i++) {
        const person = list[i]!, at = i * 6;
        moving[at] = person.x - radius; moving[at + 1] = 0; moving[at + 2] = person.z - radius;
        moving[at + 3] = person.x + radius; moving[at + 4] = Number.isFinite(person.top) ? person.top! : 2.4; moving[at + 5] = person.z + radius;
      }
    },
    get count() { return fixed.length / 6 + movingCount; },
    /**
     * The distance from the head (hx, hy, hz) at which the straight line to the camera (cx, cy, cz)
     * first enters a box, or Infinity when the line is clear. A box the head itself is inside (the
     * seat it sits on, the crown it stands under) does not count. Allocation-free.
     */
    sweep(hx, hy, hz, cx, cy, cz, skin = 0.08) {
      const dx = cx - hx, dy = cy - hy, dz = cz - hz;
      const length = Math.hypot(dx, dy, dz);
      if (!(length > 1e-6)) return Infinity;
      let best = Infinity;
      best = scan(fixed, fixed.length / 6, hx, hy, hz, dx, dy, dz, length, skin, best);
      best = scan(moving, movingCount, hx, hy, hz, dx, dy, dz, length, skin, best);
      return best;
    },
  };
}

function scan(boxes: Float32Array, count: number, hx: number, hy: number, hz: number, dx: number, dy: number, dz: number, length: number, skin: number, best: number) {
  for (let i = 0; i < count; i++) {
    const at = i * 6;
    const x0 = boxes[at]! - skin, y0 = boxes[at + 1]! - skin, z0 = boxes[at + 2]! - skin, x1 = boxes[at + 3]! + skin, y1 = boxes[at + 4]! + skin, z1 = boxes[at + 5]! + skin;
    if (hx > x0 && hx < x1 && hy > y0 && hy < y1 && hz > z0 && hz < z1) continue; // the head is inside it
    // Slab test of the segment head → camera, t in 0…1.
    let enter = 0, leave = 1;
    if (Math.abs(dx) < 1e-9) { if (hx < x0 || hx > x1) continue; }
    else { let a = (x0 - hx) / dx, b = (x1 - hx) / dx; if (a > b) { const swap = a; a = b; b = swap; } if (a > enter) enter = a; if (b < leave) leave = b; if (enter > leave) continue; }
    if (Math.abs(dy) < 1e-9) { if (hy < y0 || hy > y1) continue; }
    else { let a = (y0 - hy) / dy, b = (y1 - hy) / dy; if (a > b) { const swap = a; a = b; b = swap; } if (a > enter) enter = a; if (b < leave) leave = b; if (enter > leave) continue; }
    if (Math.abs(dz) < 1e-9) { if (hz < z0 || hz > z1) continue; }
    else { let a = (z0 - hz) / dz, b = (z1 - hz) / dz; if (a > b) { const swap = a; a = b; b = swap; } if (a > enter) enter = a; if (b < leave) leave = b; if (enter > leave) continue; }
    const distance = enter * length;
    if (distance < best) best = distance;
  }
  return best;
}

/** How far in front of what it meets the camera stops, and how close to the avatar it may come. */
export const CAMERA_GAP = 0.45;
/** Below this zoom the view is the composed one: nothing pulls the camera, the ghost alone keeps the avatar in sight. */
export const PULL_FROM_ZOOM = 1.5;

/**
 * What to do about a hit.
 *   hit       sweep()'s result (distance from the head to the first thing in the way, or Infinity)
 *   distance  how far the camera is from the head along that line (un-pulled)
 *   zoom      the orbit's zoom (1 = the composed view)
 *   nearest   the closest the camera may be brought (so a face still fits the view)
 * → { cap, ghost }: cap = the distance to hold the camera at (Infinity = leave it alone);
 *   ghost = true when what is in the way must be dithered away instead of (or as well as) pulling in.
 */
export interface Resolution { cap: number; ghost: boolean }
export function resolve(hit: number, distance: number, zoom: number, nearest: number, out: Resolution = { cap: Infinity, ghost: false }): Resolution {
  out.cap = Infinity; out.ghost = false;
  if (!(hit < distance)) return out;
  const room = hit - CAMERA_GAP;
  if (zoom >= PULL_FROM_ZOOM && room >= nearest) { out.cap = room; return out; }
  // Too close behind the avatar to stop in front of, or the wide view: show the avatar through it.
  out.ghost = true;
  return out;
}
