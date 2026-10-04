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
 * The camera never goes under the floor (pitch ≥ PITCH_MIN and the pivot is above ground), and a
 * scene with cut-away walls limits the azimuth so the camera stays on the open side.
 *
 * `goal` is what the player asked for; `now` eases after it in step(dt). step() returns true while
 * there is still a difference, which is what keeps the host's frame loop running — and false the
 * moment the camera has arrived, so the loop stops.
 */

export const PITCH_MIN = 0.1;                 // ≈ 6° above the ground
export const PITCH_MAX = Math.PI / 2 - 0.07;  // ≈ 86°: nearly top-down
export const DRAG_YAW = 0.006, DRAG_PITCH = 0.005; // radians per CSS pixel
const EASE = { turn: 18, zoom: 11, pivot: 7 };

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function createOrbit() {
  const base = { azimuth: 0.6, elevation: 0.6, distance: 35 };
  const limits = { zoomMin: 0.72, zoomMax: 6, azimuth: null };
  const goal = { yaw: 0, tilt: 0, zoom: 1, x: 0, y: 0.7, z: 0 };
  const now = { yaw: 0, tilt: 0, zoom: 1, x: 0, y: 0.7, z: 0 };

  function constrain() {
    goal.tilt = clamp(base.elevation + goal.tilt, PITCH_MIN, PITCH_MAX) - base.elevation;
    goal.zoom = clamp(goal.zoom, limits.zoomMin, limits.zoomMax);
    if (limits.azimuth) goal.yaw = clamp(base.azimuth + goal.yaw, limits.azimuth[0], limits.azimuth[1]) - base.azimuth;
  }
  const orbit = {
    base, limits, goal, now,
    /** The scene's own camera preset: its position and the point it looks at. */
    setBase(position, target = [0, 0.7, 0]) {
      const dx = position[0] - target[0], dy = position[1] - target[1], dz = position[2] - target[2];
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
    reset() { goal.yaw = 0; goal.tilt = 0; goal.zoom = 1; constrain(); },
    follow(x, y, z) { goal.x = x; goal.y = y; goal.z = z; },
    /** Jump to the goal: no easing (a new venue, reduced motion, no frame loop). */
    snap() { now.yaw = goal.yaw; now.tilt = goal.tilt; now.zoom = goal.zoom; now.x = goal.x; now.y = goal.y; now.z = goal.z; },
    get settled() {
      return now.yaw === goal.yaw && now.tilt === goal.tilt && now.zoom === goal.zoom && now.x === goal.x && now.y === goal.y && now.z === goal.z;
    },
    step(dt) {
      let moving = false;
      const ease = (key, rate, epsilon) => {
        const delta = goal[key] - now[key];
        if (delta === 0) return;
        if (Math.abs(delta) < epsilon) { now[key] = goal[key]; return; }
        now[key] += delta * (1 - Math.exp(-rate * dt));
        moving = true;
      };
      ease('yaw', EASE.turn, 0.0008); ease('tilt', EASE.turn, 0.0008);
      // Zoom eases in proportion, so it feels the same close up and far away.
      const ratio = goal.zoom / now.zoom;
      if (ratio !== 1) {
        if (Math.abs(Math.log(ratio)) < 0.002) now.zoom = goal.zoom;
        else { now.zoom *= Math.exp(Math.log(ratio) * (1 - Math.exp(-EASE.zoom * dt))); moving = true; }
      }
      ease('x', EASE.pivot, 0.004); ease('y', EASE.pivot, 0.004); ease('z', EASE.pivot, 0.004);
      return moving;
    },
    /** Absolute heading of the camera around the pivot right now (what "forward" is measured from). */
    get azimuth() { return base.azimuth + now.yaw; },
    get pitch() { return clamp(base.elevation + now.tilt, PITCH_MIN, PITCH_MAX); },
    get distance() { return base.distance / now.zoom; },
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
export function followShare(zoom) { return clamp(0.35 + (zoom - 1) * 0.9, 0.08, 1); }
