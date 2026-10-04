/**
 * OWNER: world
 * The city map's camera: a tilted orbit around a point on the ground, clamped so the player can
 * never get lost. Pure state and maths on a THREE.PerspectiveCamera — no events, no timers; the
 * host (src/map3d/map3d.ts) feeds it input and asks whether it is still moving.
 *
 *   rig.view = { x, z, yaw, pitch, distance }       what is looked at, from where
 *   orbit(dYaw, dPitch) · pan(dx, dz) · panScreen(px, py) · zoomAt(factor, ndcX, ndcY)
 *   fit() · focus(x, z, distance?) · frame(points)  set a target view; step() eases towards it
 *   step(dt) → true while the view is still changing (an ease or inertia)
 *
 * The HUD covers part of the canvas. setViewport(width, height, insets) tells the rig which part
 * is free; the camera's view is shifted so the thing looked at sits in the middle of the free
 * part, and fit()/frame() fill that part rather than the whole canvas.
 */

/** The camera's view: what is looked at (x, z on the ground), the turn, the tilt and the distance. */
export interface RigView { x: number; z: number; yaw: number; pitch: number; distance: number }
/** What the rig needs to know of the city: the board it may wander over, the land to fit, and optional limits. */
export interface RigBounds { minX: number; maxX: number; minZ: number; maxZ: number; fit?: { minX: number; maxX: number; minZ: number; maxZ: number }; minDistance?: number; roamZ?: number }
/** Pixels of the canvas the HUD covers. */
export interface RigInsets { left?: number; top?: number; right?: number; bottom?: number }
export interface RigPoint { x: number; z: number; y?: number }
interface RigGoal { from: RigView; to: RigView; t: number; seconds: number }
export interface Rig {
  readonly view: RigView
  readonly goal: RigGoal | null
  readonly maxDistance: number
  setViewport(width: number, height: number, insets?: RigInsets): void
  apply(): void
  hold(): void
  orbit(dYaw: number, dPitch: number): void
  release(velocity?: number): void
  pan(dx: number, dz: number): void
  panScreen(px: number, py: number): void
  zoomAt(factor: number, nx?: number | null, ny?: number | null): void
  groundAt(nx: number, ny: number): { x: number; z: number } | null
  ease(target: Partial<RigView>, seconds?: number): void
  jump(target: Partial<RigView>): void
  whole(): RigView
  framing(points: readonly RigPoint[], options?: { pad?: number; min?: number }): { x: number; z: number; distance: number }
  readonly moving: boolean
  step(dt: number): boolean
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
export const PITCH_MIN = 0.36, PITCH_MAX = 1.5, DEFAULT_PITCH = 0.92, MIN_DISTANCE = 34;

export function createRig(THREE: typeof import('three'), camera: import('three').PerspectiveCamera, bounds: RigBounds): Rig {
  const view: RigView = { x: 0, z: 0, yaw: 0, pitch: DEFAULT_PITCH, distance: 220 };
  let goal: RigGoal | null = null, spin = 0, size = { width: 1, height: 1 }, free = { left: 0, top: 0, right: 0, bottom: 0 }, maxDistance = 400;
  // `bounds.fit` is what "the whole city" means (the land); the bounds themselves are how far the view may wander (the board).
  // How close the view may come: near enough to see a single house of an estate.
  const floor = bounds.minDistance ?? MIN_DISTANCE;
  const whole = bounds.fit || bounds;
  const centre = { x: (whole.minX + whole.maxX) / 2, z: (whole.minZ + whole.maxZ) / 2 };
  const roam = { minX: whole.minX, maxX: whole.maxX, minZ: whole.minZ, maxZ: Math.max(whole.maxZ, bounds.roamZ ?? whole.maxZ) };
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3(), probe = new THREE.Vector3();

  function limit<T extends RigView>(target: T): T {
    target.pitch = clamp(target.pitch, PITCH_MIN, PITCH_MAX);
    target.distance = clamp(target.distance, floor, maxDistance);
    // What is looked at never leaves the land (plus the sea plots), so the city cannot be dragged out of sight.
    target.x = clamp(target.x, roam.minX, roam.maxX); target.z = clamp(target.z, roam.minZ, roam.maxZ);
    return target;
  }
  function apply() {
    limit(view);
    const flat = Math.cos(view.pitch) * view.distance;
    camera.position.set(view.x + Math.sin(view.yaw) * flat, Math.sin(view.pitch) * view.distance, view.z + Math.cos(view.yaw) * flat);
    camera.up.set(0, 1, 0);
    camera.lookAt(view.x, 0, view.z);
    camera.near = Math.max(0.2, view.distance * 0.05); camera.far = view.distance * 4 + 600;
    camera.aspect = size.width / size.height;
    // Shift the picture so the looked-at point sits in the middle of the free part of the canvas.
    const dx = (free.left - free.right) / 2, dy = (free.top - free.bottom) / 2;
    if (dx || dy) camera.setViewOffset(size.width, size.height, -dx, -dy, size.width, size.height); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }
  /** The free part of the canvas as a fraction of the whole, for fitting. */
  const freeShare = () => ({ x: Math.max(0.2, (size.width - free.left - free.right) / size.width), y: Math.max(0.2, (size.height - free.top - free.bottom) / size.height) });

  /** The distance at which every point fits in the free part, looking at (x, z) with this yaw and pitch. */
  function distanceFor(points: readonly RigPoint[], x: number, z: number, yaw: number, pitch: number, pad = 1): number {
    const saved = { ...view }, share = freeShare();
    let low = Math.min(floor, MIN_DISTANCE * 0.5), high = 1400;
    for (let i = 0; i < 22; i++) {
      const mid = (low + high) / 2;
      Object.assign(view, { x, z, yaw, pitch, distance: mid });
      const flat = Math.cos(pitch) * mid;
      camera.position.set(x + Math.sin(yaw) * flat, Math.sin(pitch) * mid, z + Math.cos(yaw) * flat);
      camera.lookAt(x, 0, z); camera.aspect = size.width / size.height; camera.clearViewOffset(); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
      const fits = points.every((point) => { probe.set(point.x, point.y || 0, point.z).project(camera); return Math.abs(probe.x) <= share.x / pad && Math.abs(probe.y) <= share.y / pad && probe.z < 1; });
      if (fits) high = mid; else low = mid;
    }
    Object.assign(view, saved);
    apply();
    return high;
  }
  const corners = () => ([[whole.minX, whole.minZ], [whole.maxX, whole.minZ], [whole.minX, whole.maxZ], [whole.maxX, whole.maxZ]] as const).map(([x, z]) => ({ x, z }));

  function groundAt(nx: number, ny: number): { x: number; z: number } | null {
    ndc.set(nx, ny);
    ray.setFromCamera(ndc, camera);
    return ray.ray.intersectPlane(ground, hit) ? { x: hit.x, z: hit.z } : null;
  }

  const rig: Rig = {
    view,
    get goal() { return goal; },
    get maxDistance() { return maxDistance; },
    setViewport(width, height, insets) {
      size = { width: Math.max(1, width), height: Math.max(1, height) };
      free = { left: 0, top: 0, right: 0, bottom: 0, ...insets };
      maxDistance = distanceFor(corners(), centre.x, centre.z, 0, DEFAULT_PITCH, 1) * 1.3;
      apply();
    },
    apply,
    /** Stop any ease or inertia where it is. */
    hold() { goal = null; spin = 0; },
    orbit(dYaw, dPitch) { goal = null; spin = 0; view.yaw += dYaw; view.pitch += dPitch; apply(); },
    /** Let go after an orbit: the turn carries on for a moment. `velocity` is in radians a second. */
    release(velocity = 0) { spin = Math.abs(velocity) > 0.25 ? clamp(velocity, -2.6, 2.6) : 0; },
    pan(dx, dz) { goal = null; spin = 0; view.x += dx; view.z += dz; apply(); },
    /** Pan by screen pixels: the ground follows the fingers. */
    panScreen(px, py) {
      const perPixel = (2 * Math.tan((camera.fov * Math.PI) / 360) * view.distance) / size.height;
      const rightX = Math.cos(view.yaw), rightZ = -Math.sin(view.yaw), forwardX = -Math.sin(view.yaw), forwardZ = -Math.cos(view.yaw), up = perPixel / Math.max(0.35, Math.sin(view.pitch));
      rig.pan(-px * perPixel * rightX + py * up * forwardX, -px * perPixel * rightZ + py * up * forwardZ);
    },
    /** Zoom by `factor` (< 1 closer) keeping the ground under (ndcX, ndcY) where it is. */
    zoomAt(factor, nx = null, ny = null) {
      goal = null; spin = 0;
      const before = nx === null ? null : groundAt(nx, ny!), next = clamp(view.distance * factor, floor, maxDistance), ratio = next / view.distance;
      if (before) { view.x = before.x + (view.x - before.x) * ratio; view.z = before.z + (view.z - before.z) * ratio; }
      view.distance = next;
      apply();
    },
    groundAt,
    /** Ease to a view. Missing fields keep their current value. */
    ease(target, seconds = 0.6) { spin = 0; goal = { from: { ...view }, to: limit({ ...view, ...target }), t: 0, seconds: Math.max(0.01, seconds) }; },
    /** Jump to a view at once (reduced motion, the first frame, a resize). */
    jump(target) { goal = null; spin = 0; Object.assign(view, limit({ ...view, ...target })); apply(); },
    /** The whole city, seen from the south at the default tilt. */
    whole() { return { x: centre.x, z: centre.z, yaw: 0, pitch: DEFAULT_PITCH, distance: distanceFor(corners(), centre.x, centre.z, 0, DEFAULT_PITCH, 1) }; },
    /** A view that holds every given ground point, keeping the current turn and tilt. */
    framing(points, { pad = 1.35, min = 60 } = {}) {
      const xs = points.map((point) => point.x), zs = points.map((point) => point.z);
      const x = (Math.min(...xs) + Math.max(...xs)) / 2, z = (Math.min(...zs) + Math.max(...zs)) / 2;
      return { x, z, distance: clamp(Math.max(min, distanceFor(points.map((point) => ({ ...point, y: point.y ?? 4 })), x, z, view.yaw, view.pitch, pad)), floor, maxDistance) };
    },
    get moving() { return Boolean(goal) || spin !== 0; },
    /** Advance an ease or the inertia by dt seconds. Returns true while something is still moving. */
    step(dt) {
      if (goal) {
        goal.t = Math.min(1, goal.t + dt / goal.seconds);
        const k = goal.t * goal.t * (3 - 2 * goal.t), { from, to } = goal;
        let turn = (to.yaw - from.yaw) % (Math.PI * 2);
        if (turn > Math.PI) turn -= Math.PI * 2; else if (turn < -Math.PI) turn += Math.PI * 2;
        view.x = from.x + (to.x - from.x) * k; view.z = from.z + (to.z - from.z) * k; view.pitch = from.pitch + (to.pitch - from.pitch) * k;
        view.yaw = from.yaw + turn * k; view.distance = from.distance * Math.pow(to.distance / from.distance, k);
        if (goal.t >= 1) goal = null;
        apply();
      } else if (spin) {
        // A short glide: it loses 99.9% of its speed each second, so even a hard flick turns the city less than a quarter turn more.
        view.yaw += spin * dt;
        spin *= Math.pow(0.001, dt);
        if (Math.abs(spin) < 0.08) spin = 0;
        apply();
      }
      return rig.moving;
    },
  };
  apply();
  return rig;
}
