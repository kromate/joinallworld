/**
 * OWNER: scenes
 * Orbit camera for a scene: where the camera is, from what the player asked for. Pure arithmetic
 * on plain numbers (the only thing it touches is the camera object it is handed), so it runs
 * under `node --test`.
 *
 * CONVENTIONS (one for mouse, touch and keys)
 *   yaw     turning around the pivot. Dragging right swings the camera to the left, so the scene
 *           turns with the finger, as if grabbed.
 *   pitch   the camera's elevation above the ground, in radians: PITCH_MIN looks along the ground,
 *           PITCH_MAX looks almost straight down. Dragging DOWN raises the camera (the scene tips
 *           towards you, you see it more from above); dragging UP lowers it (you look up, towards
 *           the horizon). Same grab-the-scene rule as yaw.
 *   zoom    a factor on the scene's own camera distance: 1 is the scene's composed view, more is
 *           closer. The camera dollies towards the pivot, which the host moves on to the avatar as
 *           the player zooms in — so zooming in arrives at the character, not at the floor's centre.
 *
 * The camera never goes under the floor (pitch ≥ PITCH_MIN and the pivot is above ground). It may
 * orbit all the way round every scene: a room hides whichever of its walls the camera has gone
 * behind (venue-scenes.js / home-scene.js `look`), so there is no azimuth limit any more (the
 * `azimuth` limit is still honoured if a scene ever sets one).
 *
 * COLLISION. cap(distance) holds the camera no farther than `distance` from the pivot — the host
 * sets it when something stands between the camera and the avatar (camera-collision.js) and clears
 * it with cap(Infinity). The cap is eased like everything else: quickly in (the avatar must not
 * disappear), slowly out (no pumping when a lamp post passes), so it never jitters.
 *
 * `goal` is what the player asked for; `now` eases after it in step(dt). step() returns true while
 * there is still a difference, which is what keeps the host's frame loop running — and false the
 * moment the camera has arrived, so the loop stops.
 */

export const PITCH_MIN = 0.1;                 // ≈ 6° above the ground
export const PITCH_MAX = Math.PI / 2 - 0.07;  // ≈ 86°: nearly top-down
export const DRAG_YAW = 0.006, DRAG_PITCH = 0.005; // radians per CSS pixel
const EASE = { turn: 18, zoom: 11, pivot: 7, squeezeIn: 12, squeezeOut: 3.2 };
/** What step() eases: the two angles first (at the turning rate), then the pivot. */
const EASED = ['yaw', 'tilt', 'x', 'y', 'z'] as const;

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** One side of the orbit: yaw / tilt offsets, zoom factor, pivot, collision squeeze. */
export interface OrbitState { yaw: number; tilt: number; zoom: number; x: number; y: number; z: number; squeeze: number }
export interface OrbitBase { azimuth: number; elevation: number; distance: number }
export interface OrbitLimits { zoomMin: number; zoomMax: number; azimuth: [number, number] | null }
/** The camera as the orbit drives it (a THREE camera satisfies this). */
export interface OrbitCamera {
  position: { set(x: number, y: number, z: number): unknown };
  lookAt(x: number, y: number, z: number): void;
}
export interface Orbit {
  base: OrbitBase;
  limits: OrbitLimits;
  goal: OrbitState;
  now: OrbitState;
  setBase(position: readonly number[], target?: readonly number[]): void;
  setLimits(options?: { near?: number; far?: number; azimuth?: [number, number] | null }): void;
  rotate(yaw: number, tilt: number): void;
  drag(dx: number, dy: number): void;
  zoomBy(factor: number): void;
  reset(): void;
  unwind(): void;
  follow(x: number, y: number, z: number): void;
  cap(distance: number): void;
  snap(): void;
  readonly settled: boolean;
  step(dt: number): boolean;
  readonly azimuth: number;
  readonly pitch: number;
  readonly distance: number;
  readonly asked: number;
  apply(camera: OrbitCamera): void;
}

export function createOrbit(): Orbit {
  const base: OrbitBase = { azimuth: 0.6, elevation: 0.6, distance: 35 };
  const limits: OrbitLimits = { zoomMin: 0.72, zoomMax: 6, azimuth: null };
  // squeeze: the share of the asked-for distance the camera is held at (1 = not held; see cap()).
  const goal: OrbitState = { yaw: 0, tilt: 0, zoom: 1, x: 0, y: 0.7, z: 0, squeeze: 1 };
  const now: OrbitState = { yaw: 0, tilt: 0, zoom: 1, x: 0, y: 0.7, z: 0, squeeze: 1 };

  function constrain() {
    goal.tilt = clamp(base.elevation + goal.tilt, PITCH_MIN, PITCH_MAX) - base.elevation;
    goal.zoom = clamp(goal.zoom, limits.zoomMin, limits.zoomMax);
    if (limits.azimuth) goal.yaw = clamp(base.azimuth + goal.yaw, limits.azimuth[0], limits.azimuth[1]) - base.azimuth;
  }
  const orbit: Orbit = {
    base, limits, goal, now,
    /** The scene's own camera preset: its position and the point it looks at. */
    setBase(position, target = [0, 0.7, 0]) {
      const dx = position[0]! - target[0]!, dy = position[1]! - target[1]!, dz = position[2]! - target[2]!;
      const flat = Math.hypot(dx, dz);
      base.azimuth = Math.atan2(dx, dz); base.elevation = Math.atan2(dy, flat); base.distance = Math.hypot(flat, dy);
      constrain();
    },
    /** { near, far (camera distances), azimuth: [min, max] | null (absolute, radians) } */
    setLimits({ near = 5.5, far, azimuth = null } = {}) {
      limits.zoomMax = Math.max(1, base.distance / near);
      limits.zoomMin = Math.min(1, base.distance / (far || base.distance * 1.38));
      limits.azimuth = Array.isArray(azimuth) ? azimuth : null;
      constrain();
    },
    rotate(yaw, tilt) { goal.yaw += yaw; goal.tilt += tilt; constrain(); },
    /** Pointer drag in CSS pixels: right turns the scene with the finger, down looks from higher up. */
    drag(dx, dy) { orbit.rotate(-dx * DRAG_YAW, dy * DRAG_PITCH); },
    zoomBy(factor) { if (Number.isFinite(factor) && factor > 0) { goal.zoom *= factor; constrain(); } },
    reset() { orbit.unwind(); goal.yaw = 0; goal.tilt = 0; goal.zoom = 1; constrain(); },
    /** Full turns add up while orbiting freely: bring both angles back into one turn (no visible change). */
    unwind() { const turns = Math.round(goal.yaw / (Math.PI * 2)); if (turns) { goal.yaw -= turns * Math.PI * 2; now.yaw -= turns * Math.PI * 2; } },
    follow(x, y, z) { goal.x = x; goal.y = y; goal.z = z; },
    /** Hold the camera within `distance` of the pivot (Infinity = not held). Measured against the distance being eased to right now. */
    cap(distance) {
      const asked = base.distance / now.zoom;
      const next = Number.isFinite(distance) && distance < asked ? clamp(distance / asked, 0.05, 1) : 1;
      // Small changes of an existing hold are ignored, so a hit that wobbles by a few centimetres does not move the camera.
      if (next === 1 || goal.squeeze === 1 || Math.abs(next - goal.squeeze) > 0.02) goal.squeeze = next;
    },
    /** Jump to the goal: no easing (a new venue, reduced motion, no frame loop). */
    snap() { now.yaw = goal.yaw; now.tilt = goal.tilt; now.zoom = goal.zoom; now.x = goal.x; now.y = goal.y; now.z = goal.z; now.squeeze = goal.squeeze; },
    get settled() {
      return now.yaw === goal.yaw && now.tilt === goal.tilt && now.zoom === goal.zoom && now.x === goal.x && now.y === goal.y && now.z === goal.z && now.squeeze === goal.squeeze;
    },
    step(dt) {
      // Allocation-free: this runs every frame of the motion loop.
      const turn = 1 - Math.exp(-EASE.turn * dt), slide = 1 - Math.exp(-EASE.pivot * dt);
      let moving = false;
      for (let i = 0; i < EASED.length; i++) {
        const key = EASED[i]!, delta = goal[key] - now[key];
        if (delta === 0) continue;
        if (Math.abs(delta) < (i < 2 ? 0.0008 : 0.004)) { now[key] = goal[key]; continue; }
        now[key] += delta * (i < 2 ? turn : slide);
        moving = true;
      }
      // Zoom eases in proportion, so it feels the same close up and far away.
      const ratio = goal.zoom / now.zoom;
      if (ratio !== 1) {
        if (Math.abs(Math.log(ratio)) < 0.002) now.zoom = goal.zoom;
        else { now.zoom *= Math.exp(Math.log(ratio) * (1 - Math.exp(-EASE.zoom * dt))); moving = true; }
      }
      // The collision hold: in quickly, out slowly.
      const gap = goal.squeeze - now.squeeze;
      if (gap !== 0) {
        if (Math.abs(gap) < 0.003) now.squeeze = goal.squeeze;
        else { now.squeeze += gap * (1 - Math.exp(-(gap < 0 ? EASE.squeezeIn : EASE.squeezeOut) * dt)); moving = true; }
      }
      return moving;
    },
    /** Absolute heading of the camera around the pivot right now (what "forward" is measured from). */
    get azimuth() { return base.azimuth + now.yaw; },
    get pitch() { return clamp(base.elevation + now.tilt, PITCH_MIN, PITCH_MAX); },
    /** How far the camera is from the pivot right now (held in by a collision if there is one). */
    get distance() { return (base.distance / now.zoom) * now.squeeze; },
    /** The distance the player asked for, before any collision hold. */
    get asked() { return base.distance / now.zoom; },
    /** Put a camera where the orbit says. */
    apply(camera) {
      const azimuth = orbit.azimuth, pitch = orbit.pitch, distance = orbit.distance;
      const flat = Math.cos(pitch) * distance;
      camera.position.set(now.x + Math.sin(azimuth) * flat, now.y + Math.sin(pitch) * distance, now.z + Math.cos(azimuth) * flat);
      camera.lookAt(now.x, now.y, now.z);
    },
  };
  return orbit;
}

/** How much the pivot belongs to the avatar (1) rather than the scene's centre (0) at a zoom level. */
export function followShare(zoom: number) { return clamp(0.35 + (zoom - 1) * 0.9, 0.08, 1); }
