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
 * PAN. A player may slide the view over the scene (right button, two fingers, Shift-drag): the pivot is moved off the
 * avatar by an offset (px, pz) of at most limits.pan. While the player is doing that, and for FOLLOW_PAUSE seconds
 * after the last pan, the camera does NOT follow the avatar's walk (the world point looked at stays where it is); then
 * the offset eases away and the camera is back on the avatar. reset() clears it at once. Orbiting and zooming never
 * stop the follow: they turn and dolly about the pivot the avatar carries.
 *
 * `goal` is what the player asked for; `now` eases after it in step(dt). step() returns true while
 * there is still a difference, which is what keeps the host's frame loop running — and false the
 * moment the camera has arrived, so the loop stops.
 */

export const PITCH_MIN = 0.1;                 // ≈ 6° above the ground
export const PITCH_MAX = Math.PI / 2 - 0.07;  // ≈ 86°: nearly top-down
export const DRAG_YAW = 0.006, DRAG_PITCH = 0.005; // radians per CSS pixel
const EASE = { turn: 18, zoom: 11, pivot: 7, squeezeIn: 12, squeezeOut: 3.2 };
/** How long the camera stays where the player slid it before it goes back to following the avatar (seconds). */
export const FOLLOW_PAUSE = 4;
/** What step() eases: the two angles first (at the turning rate), then the pivot and the player's slide of it. */
const EASED = ['yaw', 'tilt', 'x', 'y', 'z', 'px', 'pz'] as const;

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** One side of the orbit: yaw / tilt offsets, zoom factor, pivot, collision squeeze. */
export interface OrbitState { yaw: number; tilt: number; zoom: number; x: number; y: number; z: number; px: number; pz: number; squeeze: number }
export interface OrbitBase { azimuth: number; elevation: number; distance: number }
export interface OrbitLimits { zoomMin: number; zoomMax: number; azimuth: [number, number] | null; /** How far the player may slide the view off the avatar, in scene units. */ pan: number }
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
  /** Slide the view by a pointer drag of (dx, dy) pixels, where one pixel is `perPixel` scene units at the pivot: the ground follows the pointer. */
  panScreen(dx: number, dy: number, perPixel: number): void;
  /** Seconds left of the pause in following the avatar after a slide. */
  readonly holding: number;
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
  const limits: OrbitLimits = { zoomMin: 0.72, zoomMax: 6, azimuth: null, pan: 12 };
  // squeeze: the share of the asked-for distance the camera is held at (1 = not held; see cap()).
  const goal: OrbitState = { yaw: 0, tilt: 0, zoom: 1, x: 0, y: 0.7, z: 0, px: 0, pz: 0, squeeze: 1 };
  const now: OrbitState = { yaw: 0, tilt: 0, zoom: 1, x: 0, y: 0.7, z: 0, px: 0, pz: 0, squeeze: 1 };
  let holding = 0;

  function constrain() {
    goal.tilt = clamp(base.elevation + goal.tilt, PITCH_MIN, PITCH_MAX) - base.elevation;
    goal.zoom = clamp(goal.zoom, limits.zoomMin, limits.zoomMax);
    const reach = Math.hypot(goal.px, goal.pz);
    if (reach > limits.pan) { goal.px *= limits.pan / reach; goal.pz *= limits.pan / reach; }
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
      limits.pan = base.distance * 0.45;
      constrain();
    },
    rotate(yaw, tilt) { goal.yaw += yaw; goal.tilt += tilt; constrain(); },
    /** Pointer drag in CSS pixels: right turns the scene with the finger, down looks from higher up. */
    drag(dx, dy) { orbit.rotate(-dx * DRAG_YAW, dy * DRAG_PITCH); },
    panScreen(dx, dy, perPixel) {
      if (!Number.isFinite(dx + dy + perPixel)) return;
      // The ground follows the pointer: the pivot moves the other way, along the camera's right and (flattened) forward.
      const azimuth = base.azimuth + goal.yaw, tipped = Math.max(0.35, Math.sin(clamp(base.elevation + goal.tilt, PITCH_MIN, PITCH_MAX))), up = perPixel / tipped;
      goal.px += -dx * perPixel * Math.cos(azimuth) + -dy * up * Math.sin(azimuth);
      goal.pz += dx * perPixel * Math.sin(azimuth) + -dy * up * Math.cos(azimuth);
      holding = FOLLOW_PAUSE;
      constrain();
    },
    get holding() { return holding; },
    zoomBy(factor) { if (Number.isFinite(factor) && factor > 0) { goal.zoom *= factor; constrain(); } },
    reset() { orbit.unwind(); goal.yaw = 0; goal.tilt = 0; goal.zoom = 1; goal.px = 0; goal.pz = 0; holding = 0; constrain(); },
    /** Full turns add up while orbiting freely: bring both angles back into one turn (no visible change). */
    unwind() { const turns = Math.round(goal.yaw / (Math.PI * 2)); if (turns) { goal.yaw -= turns * Math.PI * 2; now.yaw -= turns * Math.PI * 2; } },
    follow(x, y, z) {
      // While the player's slide holds, the world point looked at stays put: the offset takes up what the avatar's walk moves the pivot by.
      if (holding > 0 && (goal.px || goal.pz)) { goal.px += goal.x - x; goal.pz += goal.z - z; constrain(); }
      goal.x = x; goal.y = y; goal.z = z;
    },
    /** Hold the camera within `distance` of the pivot (Infinity = not held). Measured against the distance being eased to right now. */
    cap(distance) {
      const asked = base.distance / now.zoom;
      const next = Number.isFinite(distance) && distance < asked ? clamp(distance / asked, 0.05, 1) : 1;
      // Small changes of an existing hold are ignored, so a hit that wobbles by a few centimetres does not move the camera.
      if (next === 1 || goal.squeeze === 1 || Math.abs(next - goal.squeeze) > 0.02) goal.squeeze = next;
    },
    /** Jump to the goal: no easing (a new venue, reduced motion, no frame loop). */
    snap() { now.yaw = goal.yaw; now.tilt = goal.tilt; now.zoom = goal.zoom; now.x = goal.x; now.y = goal.y; now.z = goal.z; now.px = goal.px; now.pz = goal.pz; now.squeeze = goal.squeeze; },
    get settled() {
      return now.yaw === goal.yaw && now.tilt === goal.tilt && now.zoom === goal.zoom && now.x === goal.x && now.y === goal.y && now.z === goal.z && now.px === goal.px && now.pz === goal.pz && now.squeeze === goal.squeeze && holding === 0;
    },
    step(dt) {
      // Allocation-free: this runs every frame of the motion loop.
      const turn = 1 - Math.exp(-EASE.turn * dt), slide = 1 - Math.exp(-EASE.pivot * dt);
      let moving = false;
      // After the pause the slide is let go, and the camera eases back onto the avatar.
      if (holding > 0) { holding = Math.max(0, holding - dt); moving = true; if (holding === 0) { goal.px = 0; goal.pz = 0; } }
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
      camera.position.set(now.x + now.px + Math.sin(azimuth) * flat, now.y + Math.sin(pitch) * distance, now.z + now.pz + Math.cos(azimuth) * flat);
      camera.lookAt(now.x + now.px, now.y, now.z + now.pz);
    },
  };
  return orbit;
}

/** How much the pivot belongs to the avatar (1) rather than the scene's centre (0) at a zoom level. */
export function followShare(zoom: number) { return clamp(0.35 + (zoom - 1) * 0.9, 0.08, 1); }
