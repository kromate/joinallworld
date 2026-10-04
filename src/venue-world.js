/**
 * Venue scene host (thin). It owns the renderer, the camera, the two lights and the DOM name
 * tags, and asks the scene modules for geometry: src/scene/venue-scenes.js for each venue
 * `scene.kind`, src/scene/home-scene.js for the home interior.
 *
 * WHAT A SCENE ENTRY MAY OFFER (all optional except group/camera/update)
 *   group, camera: { landscape, portrait }, update(state) → boolean
 *   background          clear colour; re-read after every update() that returns true
 *   lighting()          → { hemi: [sky, ground, intensity], sun: [colour, intensity, [x, y, z]] }
 *                       applied to the host's own lights; a scene without it gets HOST_LIGHTING
 *   setPlayer({ look, seed, name, pose }) → boolean   the player's avatar; seed is the public id
 *   setCrowd(people)    other players and NPCs standing in the scene
 *   easing, stepCrowd(dt), settleCrowd()   other players' figures on their way to a newly reported
 *                       position: the host steps them in the motion loop while `easing` is true
 *   look(x, z) → boolean   the camera's place in the scene's own coordinates, told before every
 *                       frame: a room hides the walls the camera is behind (dollhouse-style)
 *   tags()              → [{ id, kind, text, marker, colour, position }] projected into DOM tags
 *   walk                what the host needs to walk the avatar about (see venue-scenes.js). A
 *                       scene without it is shown from its fixed camera and nobody walks.
 *   placing, pickAt(x, y), use(id, cell)   the home scene's furniture taps (see home-scene.js)
 *   dispose()           called when the player leaves the venue and when the host is disposed.
 *                       A scene that has it is rebuilt on the next visit; one without is kept.
 *
 * THE SCENE IS THE HERO: setInsets({ top, bottom }) tells the host how much of the canvas the HUD
 * covers at the top and the bottom. The camera's view is shifted (and, on a wide screen, gently
 * zoomed out) so the scene sits in the part that is left free instead of under a panel. Name
 * tags and taps use the same camera, so they stay exact.
 *
 * BATTERY RULE: scenes are drawn on demand. A frame is rendered when the canvas is resized, the
 * venue changes, the insets change, a scene's update(state) / setPlayer / setCrowd reports a
 * change, or update() is called. The one exception is MOTION: while a movement key or the
 * joystick is held, while the avatar is walking to a target, or while the camera is still easing
 * after a drag or a zoom, the motion loop (src/scene/motion-loop.js) draws frames — and it ends
 * itself on the first frame in which nothing moved, and when the page is hidden. Nothing else may
 * schedule frames. Name tags are projected in the same step, so they move only when a frame is
 * drawn. diagnostics().renderCount and diagnostics().loop prove it: flat and stopped while nothing
 * is happening (asserted in src/venue-world.test.js).
 *
 * LOOKING AND WALKING (src/scene/camera-controls.js, src/scene/movement.js)
 *   camera   drag = orbit (right turns the scene with the finger; DOWN looks from higher up, UP
 *            looks along the ground), wheel / trackpad pinch / two-finger pinch / + − = zoom towards
 *            the avatar, 0 or the ◎ button = recentre. The pivot moves on to the avatar as the
 *            player zooms in and eases after it as it walks. The orbit is FREE in every scene: a
 *            room hides whichever wall the camera has gone behind (scene.look). A drag that starts
 *            on a name tag orbits like any other; only a tag that was not dragged opens its card.
 *   in sight when the player has zoomed in and something comes between the camera and the avatar
 *            the camera is brought in along its own ray to just in front of it; when that is not
 *            enough (or the view is wide) the thing in the way is dithered away in a small circle
 *            around the avatar. Both are eased, both are computed only on a frame in which the
 *            camera or the avatar moved, against boxes — never mesh raycasts (camera-collision.js).
 *   walking  W A S D or the arrow keys (camera-relative: W / ↑ walks away from the camera, A / D
 *            strafe; the avatar turns to face where it goes; Shift jogs), the on-screen joystick,
 *            or a click / tap on the floor (a path around obstacles). A click on a spot, a person
 *            or — at home — a piece of furniture walks there first and then does what the tap did.
 *            A spot's marker wins the tap whenever the pointer is on it (its hit area is a little
 *            larger than the ring), whoever stands near; hovering shows which thing a click would
 *            pick (the marker lights up and names itself, a person's tag is outlined). Other
 *            figures are walked round, not through (movement.js avoid), and never trap the avatar.
 *            A raised spot is reached by its declared approach: to the foot of its steps along
 *            the floor, then up (venue-scenes.js layout.raised and landmark `approach`).
 *   Where the avatar stands inside a venue is presentation only. Game state changes exactly as
 *   before: the `spot` action, asked for through the 'jaw:scene-spot' window event (the shell sends
 *   it), when the avatar arrives at a spot it was sent to or rests beside one for a moment.
 *
 * EVENTS
 *   in   'jaw:key'         { action, mode, jog } — the shell's key forwarder (src/ui/keys.js). In the
 *                          venue view: move-* / walk-* walk, look-* orbit, zoom-in / zoom-out /
 *                          zoom-fit zoom and recentre. Ignored on the map and while a sheet is open.
 *   in   'jaw:key-up'      { action } — a held key was released
 *   in   'jaw:mode'        { mode } — the shell's view: a tap walks the avatar only in 'venue'
 *                          (Buy mode keeps its own taps for placing and picking furniture)
 *   out  'jaw:scene-spot'  { id, open } — the avatar is at this spot; `open` = it was sent there
 *                          on purpose, so the shell also shows the spot's activities
 *   out  'jaw:avatar-move' { x, z, location } — where the avatar stands, at most three times a
 *                          second and only when it moved (also options.onMove), for presence.
 *                          These are PRESENCE units: scene coordinates, scaled down only if a
 *                          scene's floor were larger than the room protocol's ±20 (none is today);
 *                          setCrowd() takes other players' { x, z } in the same units.
 */
import { createKit } from './scene/kit.js';
import { createOrbit, followShare } from './scene/camera-controls.js';
import { createOccluders, resolve as resolveCollision } from './scene/camera-collision.js';
import { sceneMaterials } from './scene/build.js';
import { createMotionLoop } from './scene/motion-loop.js';
import { createWalker, createPositionReporter, WALK_SPEED, JOG_SPEED } from './scene/movement.js';
import { createSceneControls } from './scene/controls.js';
import { buildVenueScene, DEFAULT_CAMERA, MAX_CROWD, SPOT_REACH } from './scene/venue-scenes.js';
import { buildHomeScene } from './scene/home-scene.js';
import { VENUES } from './game/content/venues.js';
import { spotsOf } from './life.js';

export const HOST_LIGHTING = Object.freeze({ hemi: ['#bdd4e7', '#273e2b', 1.6], sun: ['#c7dbec', 1.4, [-12, 25, 8]] });
const DEFAULT_BACKGROUND = '#182a25';

/** The host's two lights. apply(preset) sets them from a scene's lighting(), or back to the defaults. */
export function createHostLights(THREE, scene) {
  const hemi = new THREE.HemisphereLight(HOST_LIGHTING.hemi[0], HOST_LIGHTING.hemi[1], HOST_LIGHTING.hemi[2]);
  const sun = new THREE.DirectionalLight(HOST_LIGHTING.sun[0], HOST_LIGHTING.sun[1]);
  sun.position.set(...HOST_LIGHTING.sun[2]);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 70 });
  sun.shadow.normalBias = 0.04;
  scene.add(hemi, sun);
  return {
    hemi, sun,
    apply(preset) {
      const use = Array.isArray(preset?.hemi) && Array.isArray(preset?.sun) ? preset : HOST_LIGHTING;
      hemi.color.set(use.hemi[0]); hemi.groundColor.set(use.hemi[1]); hemi.intensity = use.hemi[2];
      sun.color.set(use.sun[0]); sun.intensity = use.sun[1]; sun.position.set(...use.sun[2]);
    },
  };
}

/** The venue as the scene module should see it: every spot players can stand at, including spots other systems added. */
export function sceneVenue(id) {
  const venue = VENUES[id];
  if (!venue) return venue;
  return { ...venue, scene: { ...venue.scene, spots: spotsOf(id).map((spot) => ({ id: spot.id, label: spot.label })) } };
}

const HINT_DESKTOP = 'Drag to look · scroll to zoom · WASD to walk · click to go';
const HINT_TOUCH = 'Drag to look · pinch to zoom · stick or tap to walk';
const ZOOM_STEP = 1.35, LOOK_YAW = 1.9, LOOK_PITCH = 1.2;
/** How long the avatar rests beside a spot before the spot is selected, and the least time between two such requests. */
const DWELL_MS = 650, SPOT_GAP_MS = 1500;
/** The room protocol accepts positions within ±20 (server/protocol.js POSITION_BOUNDS); a little is kept in hand. */
const PRESENCE_REACH = 19.5;
/** How fast the see-through circle fades in and out (per second), and its radius in avatar heights. */
const GHOST_RATE = 9, GHOST_RADIUS = 0.62;
const CROWN_MARK = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" stroke="rgba(0,0,0,.55)" stroke-width="1.2" stroke-linejoin="round"><path d="M3.5 18.5 2.5 7.5l5.6 4.2L12 4.5l3.9 7.2 5.6-4.2-1 11Z"/></svg>';
const WALK_KEYS = { 'move-up': 'up', 'move-down': 'down', 'move-left': 'left', 'move-right': 'right', 'walk-up': 'up', 'walk-down': 'down', 'walk-left': 'left', 'walk-right': 'right', 'walk-jog': 'jog' };
const LOOK_KEYS = { 'look-left': 'lookLeft', 'look-right': 'lookRight', 'look-up': 'lookUp', 'look-down': 'lookDown' };

/**
 * The see-through patch for a lit material: fragments that are above the ground, closer to the
 * camera than the avatar and inside a circle around it on screen are dithered away, by the strength
 * in `uniforms.uGhost.value.w`. With the strength at zero (always, unless something is in the way)
 * the shader does nothing. Every patched material shares the one uniforms object.
 */
function ghostPatch(uniforms) {
  return (material) => {
    if (!material || material.userData?.jawGhost) return;
    material.userData.jawGhost = true;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uGhost = uniforms.uGhost; shader.uniforms.uGhostDepth = uniforms.uGhostDepth;
      shader.vertexShader = `varying float vGhostY;\n${shader.vertexShader}`.replace('#include <project_vertex>', '#include <project_vertex>\n  vGhostY = (modelMatrix * vec4(transformed, 1.0)).y;');
      shader.fragmentShader = `uniform vec4 uGhost;\nuniform float uGhostDepth;\nvarying float vGhostY;\n${shader.fragmentShader}`.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  if (uGhost.w > 0.004 && vGhostY > 0.35) {
    float ghostAway = distance(gl_FragCoord.xy, uGhost.xy) / uGhost.z;
    if (ghostAway < 1.0 && length(vViewPosition) < uGhostDepth) {
      float ghostKeep = mix(1.0, max(0.07, smoothstep(0.5, 1.0, ghostAway)), uGhost.w);
      vec2 ghostCell = floor(gl_FragCoord.xy);
      if (fract(52.9829189 * fract(dot(ghostCell, vec2(0.06711056, 0.00583715)))) > ghostKeep) discard;
    }
  }`);
    };
    material.customProgramCacheKey = () => 'jaw-ghost';
    material.needsUpdate = true;
  };
}

export function createVenueWorld(container, { location = 'park', renderer: providedRenderer, onTag, onSpot, onMove } = {}) {
  const kit = createKit();
  const { THREE } = kit;
  const scene = new THREE.Scene();
  const renderer = providedRenderer || new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 150);
  const lights = createHostLights(THREE, scene);
  const win = globalThis.window;
  // Keeping the avatar in sight (camera-collision.js): boxes to test against, and the see-through circle.
  const occluders = createOccluders(), collision = { cap: Infinity, ghost: false };
  const ghost = { now: 0, goal: 0, uniforms: { uGhost: { value: new THREE.Vector4(0, 0, 1, 0) }, uGhostDepth: { value: 0 } } };
  const patchGhost = ghostPatch(ghost.uniforms);
  { const shared = sceneMaterials(kit); patchGhost(shared.solid); patchGhost(shared.glass); kit.eachMaterial(patchGhost); }

  // Name tags live in the DOM, above the canvas. There is none under `node --test`.
  const tagLayer = globalThis.document?.createElement ? globalThis.document.createElement('div') : null;
  if (tagLayer) {
    tagLayer.className = 'scene-tags';
    container.appendChild(tagLayer);
    tagLayer.addEventListener('click', (event) => {
      // A drag that began on a tag turned the camera: it is not a click on the tag.
      if (suppressClick && event.detail !== 0) return;
      const node = event.target.closest?.('[data-tag]');
      if (node) onTag?.({ id: node.dataset.tag, kind: node.dataset.kind });
    });
    // A press on a tag is followed like a press on the scene, so dragging from a tag orbits the camera.
    tagLayer.addEventListener('pointerdown', (event) => { if (event.target.closest?.('[data-tag]')) pointerDown(event, false); });
    tagLayer.addEventListener('pointermove', (event) => pointerMove(event));
    for (const type of ['pointerup', 'pointercancel']) tagLayer.addEventListener(type, (event) => pointerEnd(event));
  }
  const spotHint = tagLayer ? globalThis.document.createElement('span') : null;
  if (spotHint) { spotHint.className = 'scene-spot-hint'; spotHint.hidden = true; }

  const built = new Map();
  let current = null, currentLocation = null, renderCount = 0, lastState = null, size = { width: 0, height: 0 };
  let player = {}, crowd = [], crowdKey = '[]', background = DEFAULT_BACKGROUND, insets = { top: 0, bottom: 0 };
  let tagSource = [], shownTags = [], tagNodes = [], tagShape = '', tagsRead = true;
  const point = new THREE.Vector3(), rayA = new THREE.Vector3(), rayB = new THREE.Vector3();
  const orbit = createOrbit();
  const walker = createWalker();
  const pointers = new Map();
  let suppressClick = false;
  const canvas = renderer.domElement;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const previousTouchAction = canvas.style?.touchAction;
  const previousCursor = canvas.style?.cursor;
  // A drag on the scene orbits the camera: it must never scroll the page or start a text selection.
  if (canvas.style) { canvas.style.touchAction = 'none'; canvas.style.cursor = 'grab'; canvas.style.userSelect = 'none'; canvas.style.webkitUserSelect = 'none'; }
  const reduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

  // ---- walking state --------------------------------------------------------------------
  const held = { up: false, down: false, left: false, right: false, jog: false, lookLeft: false, lookRight: false, lookUp: false, lookDown: false };
  const stick = { x: 0, z: 0, jog: false };
  let locked = false, restKey = '', restWas = { spot: null, busy: false, leaving: false }, stride = 0, wasMoving = false, restPose = null;
  let nearSpot = null, expected = null, dwell = null, lastSpotAt = -Infinity, spotList = [], avatarY = 0, fresh = false, uiMode = 'venue';
  // perch: the raised place the avatar stepped up on to, and the way back down ([{ x, z }, ...] ending on the floor).
  let perch = null, hover = null, hintTop = 0;
  const walkOf = () => current?.walk || null;
  /** Scene units → presence units (1 unless a scene's floor is larger than the room protocol's bounds). */
  function presenceScale() {
    const bounds = walkOf()?.grid?.bounds;
    if (!bounds) return 1;
    const reach = Math.max(Math.abs(bounds[0]), Math.abs(bounds[1]), Math.abs(bounds[2]), Math.abs(bounds[3]));
    return reach > PRESENCE_REACH ? PRESENCE_REACH / reach : 1;
  }
  const report = createPositionReporter((x, z) => {
    const k = presenceScale(), at = { x: Math.round(x * k * 100) / 100, z: Math.round(z * k * 100) / 100, location: currentLocation };
    onMove?.(at);
    win?.dispatchEvent?.(new CustomEvent('jaw:avatar-move', { detail: at }));
  });

  /** Put the avatar's figure where the walker is, and aim the camera's pivot at it. */
  function applyAvatar(bob = 0) {
    const walk = walkOf();
    if (!walk) return;
    avatarY = walk.heightAt(walker.x, walker.z);
    walk.move(walker.x, avatarY + bob, walker.z, walker.ry);
  }
  function setPivot() {
    const walk = walkOf();
    if (!walk) { orbit.follow(0, 0.7, 0); return; }
    const share = followShare(orbit.now.zoom), centre = walk.centre, offset = current.group.position;
    orbit.follow(offset.x + centre[0] + (walker.x - centre[0]) * share, centre[1] + (avatarY + 1.55 * walk.scale - centre[1]) * share, offset.z + centre[2] + (walker.z - centre[2]) * share);
  }
  function nearestSpot() {
    let best = null, bestDistance = SPOT_REACH;
    for (const spot of spotList) {
      const distance = Math.hypot(spot.x - walker.x, spot.z - walker.z);
      if (distance < bestDistance) { bestDistance = distance; best = spot; }
    }
    return best;
  }
  /** Light up the spot the avatar is beside, unless it is the selected one (that has its own ring). */
  function showNear() {
    const walk = walkOf();
    if (!walk) return;
    const spot = locked ? null : nearestSpot();
    nearSpot = spot;
    // The spot under the pointer lights up first; otherwise the one the avatar is beside.
    const lit = hover?.type === 'spot' ? hover.spot : spot && spot.id !== lastState?.spot ? spot : null;
    walk.near(lit);
  }
  function clearDwell() { if (dwell !== null) { clearTimeout(dwell); dwell = null; } }
  /** Ask for a spot through the game's own `spot` action (the shell sends it). Never while an activity runs. */
  function requestSpot(id, open) {
    if (locked || lastState?.activeAction) return false;
    const now = Date.now();
    if (!open && (id === lastState?.spot || now - lastSpotAt < SPOT_GAP_MS - 5)) return false;
    lastSpotAt = now;
    expected = { id, near: !open };
    onSpot?.({ id, open });
    win?.dispatchEvent?.(new CustomEvent('jaw:scene-spot', { detail: { id, open } }));
    return true;
  }
  /** The avatar came to rest: after a short dwell beside a spot, that spot is selected. */
  function rested() {
    report.rest(walker.x, walker.z, Date.now());
    clearDwell();
    if (locked || !nearSpot || nearSpot.id === lastState?.spot || typeof setTimeout !== 'function') return;
    const id = nearSpot.id;
    // Wandering between two spots must not spam the server: requests of this kind are spaced out, so the dwell waits.
    const wait = Math.max(DWELL_MS, lastSpotAt + SPOT_GAP_MS - Date.now());
    dwell = setTimeout(() => { dwell = null; if (!walker.moving && nearSpot?.id === id) requestSpot(id, false); }, wait);
  }
  function showPose() {
    const walk = walkOf();
    if (!walk) return;
    if (restPose) walk.pose(restPose.pose, restPose.seat); else walk.pose('stand');
  }
  /** One step of walking. Returns true while the avatar is still moving or turning. */
  function advance(dt) {
    const walk = walkOf();
    if (!walk) return false;
    const wantX = (held.right ? 1 : 0) - (held.left ? 1 : 0) + stick.x, wantZ = (held.up ? 1 : 0) - (held.down ? 1 : 0) + stick.z;
    if (locked) walker.input(0, 0);
    else if (perch && (wantX || wantZ)) {
      // Standing on a raised place: a walking key first takes the way back down, then the keys walk as usual.
      walker.input(0, 0);
      if (walker.mode !== 'path') { const foot = perch.down[perch.down.length - 1]; walkTo(foot.x, foot.z); }
    }
    else walker.input(wantX, wantZ, held.jog || stick.jog);
    if (walker.hasInput && walker.mode === 'path') walk.goal();
    const still = reduced();
    const more = walker.step(dt, orbit.azimuth, still);
    let bob = 0;
    if (walker.moving) {
      if (!wasMoving) { clearDwell(); controls?.hint(null); }
      stride += dt * (walker.jogging ? 9 : 6.5);
      // Two prebuilt figures alternate for the stride; nothing is built while walking.
      walk.gait(still || Math.floor(stride) % 2 === 0, still ? 0 : stride * Math.PI);
      if (!still) bob = Math.abs(Math.sin(stride * Math.PI)) * 0.06 * walk.scale;
    } else if (wasMoving) { walk.goal(); showPose(); }
    applyAvatar(bob);
    showNear();
    // Back on the floor: the perch is behind it.
    if (perch && !walker.hopping && walk.grid?.free(walker.x, walker.z)) perch = null;
    if (walker.moving) report.report(walker.x, walker.z, Date.now());
    else if (wasMoving) rested();
    wasMoving = walker.moving;
    return more;
  }
  /** Send the avatar somewhere along the floor. Without a frame loop, or with reduced motion, it is simply there. */
  function walkTo(x, z, { exact = false, face, jog, then, mark = false, via = null, steps = null } = {}) {
    const walk = walkOf();
    if (!walk) return false;
    clearDwell();
    // The way up becomes the way down for the next walk; arriving anywhere else forgets it.
    const up = via ? [via, ...(steps || [])] : null;
    const arrive = () => { perch = up && !walk.grid?.free(x, z) ? { down: [...up].reverse() } : null; then?.(); };
    if (!walker.goTo(x, z, { exact, face, jog, arrive, via, steps, leave: perch?.down })) { walker.place(x, z, face); arrive(); applyAvatar(); return true; }
    const target = walker.target;
    if (mark && target) walk.goal(target.x, target.z);
    if (!loop.available || reduced()) {
      walker.finishNow(); walk.goal(); showPose(); applyAvatar(); showNear(); setPivot(); orbit.snap(); orbit.apply(camera);
      report.report(walker.x, walker.z, Date.now());
      wasMoving = false;
      return true;
    }
    loop.wake();
    return true;
  }
  /**
   * The scene says where the avatar belongs (its spot, the seat of a running activity, the way out).
   * Walk there instead of jumping. Returns true when what is drawn changed.
   */
  function syncRest() {
    const walk = walkOf(), rest = walk?.rest();
    if (!rest) return false;
    const key = `${rest.spot}|${rest.busy}|${rest.leaving}|${rest.fixed}|${rest.pose}|${rest.x.toFixed(2)},${rest.z.toFixed(2)}`;
    // The first state for a scene just shown (the player has only now arrived): the avatar stays at the entrance.
    if (fresh && lastState && (lastState.location == null || lastState.location === currentLocation)) { fresh = false; arrive(rest); if (key === restKey) return false; restKey = key; return true; }
    if (key === restKey) return false;
    const before = restWas, moved = before.spot !== rest.spot || before.at !== `${rest.x.toFixed(2)},${rest.z.toFixed(2)}`;
    restKey = key;
    restWas = { spot: rest.spot, busy: rest.busy, leaving: rest.leaving, at: `${rest.x.toFixed(2)},${rest.z.toFixed(2)}` };
    locked = rest.busy || rest.leaving || rest.fixed;
    const away = Math.hypot(rest.x - walker.x, rest.z - walker.z);
    if (rest.fixed) { restPose = { pose: rest.pose, seat: rest.seat }; walker.place(rest.x, rest.z, rest.ry); showPose(); applyAvatar(); }
    else if (rest.busy) {
      // An activity started: go to the spot (its seat, its counter) first, then take the activity's pose.
      restPose = null;
      const pose = { pose: rest.pose, seat: rest.seat };
      const settle = () => { restPose = pose; showPose(); };
      if (away > 0.05) walkTo(rest.x, rest.z, { exact: true, face: rest.ry, jog: true, then: settle, ...wayUp(rest) }); else { walker.ry = rest.ry; settle(); applyAvatar(); }
    } else if (rest.leaving) {
      // Setting off on a trip: walk to the way out.
      restPose = { pose: 'walk' };
      walkTo(walk.entrance.x, walk.entrance.z, { jog: true });
    } else {
      restPose = null;
      const sent = expected && expected.id === rest.spot ? expected : null;
      if (sent) expected = null;
      if (before.busy) { showPose(); if (away > 0.05) walkTo(rest.x, rest.z, { exact: true, face: rest.ry, ...wayUp(rest) }); }
      else if (before.leaving) { walker.stop(); showPose(); applyAvatar(); }
      // A spot chosen in the panel: walk to it. One the avatar wandered up to: it is already there.
      else if (moved && !sent?.near && away > SPOT_REACH) walkTo(rest.x, rest.z, { exact: true, face: rest.ry, ...wayUp(rest) });
    }
    showNear();
    return true;
  }
  /** The declared way up to a raised place (a spot, or where the scene rests the avatar), unless the avatar is already up there beside it. */
  function wayUp(place) {
    if (!place?.approach) return null;
    if (perch && Math.hypot(place.x - walker.x, place.z - walker.z) < 6 && !walkOf()?.grid?.free(walker.x, walker.z) && avatarY > 0.2 && Math.abs((place.y || 0) - avatarY) < 0.4) return null;
    return { via: place.approach, steps: place.steps };
  }
  /** Where the avatar is when a scene is first shown: at the entrance — or, mid-activity, already at its place and in its pose. */
  function arrive(rest) {
    const walk = walkOf(), door = walk.entrance;
    locked = Boolean(rest && (rest.busy || rest.leaving || rest.fixed));
    if (rest && (rest.busy || rest.fixed)) { restPose = { pose: rest.pose, seat: rest.seat }; walker.place(rest.x, rest.z, rest.ry); }
    else { restPose = rest?.leaving ? { pose: 'walk' } : null; walker.place(door.x, door.z, door.ry); }
    restWas = rest ? { spot: rest.spot, busy: rest.busy, leaving: rest.leaving, at: `${rest.x.toFixed(2)},${rest.z.toFixed(2)}` } : { spot: null, busy: false, leaving: false };
    showPose(); applyAvatar(); showNear();
  }
  /** A scene was shown: the avatar appears at the entrance (or, mid-activity, at its place) and can move at once. */
  function enterScene() {
    const walk = walkOf();
    walker.stop(); clearDwell(); report.reset();
    expected = null; nearSpot = null; restPose = null; wasMoving = false; stride = 0; spotList = []; perch = null; setHover(null);
    stick.x = 0; stick.z = 0; stick.jog = false;
    walker.setGrid(walk?.grid || null);
    walker.others = walk?.people() || null;
    occluders.setStatic(walk?.solids || []);
    ghost.now = 0; ghost.goal = 0; ghost.uniforms.uGhost.value.w = 0; orbit.cap(Infinity);
    if (!walk) { locked = false; restKey = ''; return; }
    walk.drive(true);
    spotList = walk.spots();
    walker.speed = WALK_SPEED * clamp(walk.scale, 0.6, 1); walker.jogSpeed = JOG_SPEED * clamp(walk.scale, 0.6, 1);
    walker.reach = 0.66 * walk.scale;
    const rest = walk.rest();
    restKey = rest ? `${rest.spot}|${rest.busy}|${rest.leaving}|${rest.fixed}|${rest.pose}|${rest.x.toFixed(2)},${rest.z.toFixed(2)}` : '';
    // Until the state for THIS venue has been seen, the next one only confirms the arrival (see syncRest).
    fresh = !(lastState && lastState.location === currentLocation);
    arrive(rest);
  }

  // ---- the motion loop: frames only while something moves ------------------------------------
  function tick(dt) {
    let more = false;
    const yaw = (held.lookRight ? 1 : 0) - (held.lookLeft ? 1 : 0), pitch = (held.lookUp ? 1 : 0) - (held.lookDown ? 1 : 0);
    if (yaw || pitch) { orbit.rotate(yaw * LOOK_YAW * dt, pitch * LOOK_PITCH * dt); more = true; }
    more = advance(dt) || more;
    // Other players' figures on their way to a newly reported position.
    if (current?.easing) more = (reduced() ? (current.settleCrowd(), false) : current.stepCrowd(dt)) || more;
    setPivot();
    keepInSight();
    if (reduced()) { orbit.snap(); ghost.now = ghost.goal; }
    else {
      more = orbit.step(dt) || more;
      if (ghost.now !== ghost.goal) {
        const gap = ghost.goal - ghost.now;
        if (Math.abs(gap) < 0.02) ghost.now = ghost.goal; else { ghost.now += gap * (1 - Math.exp(-GHOST_RATE * dt)); more = true; }
      }
    }
    orbit.apply(camera);
    renderScene();
    return more;
  }
  const head = new THREE.Vector3(), eye = new THREE.Vector3();
  /**
   * Is anything between the camera and the avatar? Sets the orbit's hold and the see-through goal.
   * Tested against boxes in the scene's own coordinates, with the camera where the player asked for
   * it (not where a hold has already brought it), so the answer does not feed back on itself.
   */
  function keepInSight() {
    const walk = walkOf();
    if (!walk || !current) { orbit.cap(Infinity); ghost.goal = 0; return; }
    const offset = current.group.position, tall = 2.45 * walk.scale;
    head.set(walker.x, avatarY + tall * 0.62, walker.z);
    // The camera's un-held place, from the orbit's present angles and pivot.
    const azimuth = orbit.azimuth, pitch = orbit.pitch, asked = orbit.asked, flat = Math.cos(pitch) * asked;
    eye.set(orbit.now.x + Math.sin(azimuth) * flat - offset.x, orbit.now.y + Math.sin(pitch) * asked, orbit.now.z + Math.cos(azimuth) * flat - offset.z);
    occluders.setPeople(walk.people(), 0.3 * walk.scale);
    const reach = head.distanceTo(eye);
    const hit = occluders.sweep(head.x, head.y, head.z, eye.x, eye.y, eye.z);
    resolveCollision(hit, reach, orbit.now.zoom, 2.6 * walk.scale, collision);
    // The hold is a distance from the PIVOT; the hit was measured from the head. Zoomed in, the two are within a step of each other.
    orbit.cap(Number.isFinite(collision.cap) ? Math.max(1.8 * walk.scale, collision.cap - head.distanceTo(eye) + asked) : Infinity);
    ghost.goal = collision.ghost ? 1 : 0;
  }
  /** Give the see-through circle its place on screen (drawing-buffer pixels) for the frame about to be drawn. */
  function aimGhost() {
    const value = ghost.uniforms.uGhost.value;
    value.w = ghost.now;
    if (ghost.now <= 0.004 || !current) return;
    const walk = walkOf(), tall = 2.45 * (walk?.scale || 1), ratio = renderer.getPixelRatio?.() || 1;
    current.group.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    point.set(walker.x, avatarY + tall * 0.55, walker.z).applyMatrix4(current.group.matrixWorld);
    const depth = point.distanceTo(camera.position);
    point.project(camera);
    const cx = (point.x + 1) / 2 * size.width * ratio, cy = (point.y + 1) / 2 * size.height * ratio;
    // The avatar's height on screen, from the projection: the circle covers the figure, not the venue.
    const perUnit = (size.height * ratio * camera.zoom) / (2 * Math.tan((camera.fov * Math.PI) / 360) * Math.max(0.5, depth));
    value.x = cx; value.y = cy; value.z = Math.max(26 * ratio, tall * perUnit * GHOST_RADIUS);
    ghost.uniforms.uGhostDepth.value = Math.max(0.2, depth - 0.75 * (walk?.scale || 1));
  }
  function dropInput() {
    for (const key of Object.keys(held)) held[key] = false;
    stick.x = 0; stick.z = 0; stick.jog = false;
    controls?.release();
  }
  // Hidden: stop and forget held keys. Visible again: only a walk that was cut short carries on.
  const loop = createMotionLoop(tick, { onHidden: dropInput, onVisible: () => { if (walker.mode === 'path') loop.wake(); } });
  /** The camera's goal changed: ease to it in the loop, or — with no loop or reduced motion — draw it at once. */
  function redrawView() {
    if (loop.available && !reduced()) { loop.wake(); return; }
    settleView(); orbit.apply(camera); renderScene();
  }
  /** Put the camera where it is going, at once: the pivot, any collision hold and the see-through circle included. */
  function settleView() {
    setPivot(); orbit.snap(); setPivot(); orbit.snap();
    keepInSight(); orbit.snap(); ghost.now = ghost.goal;
  }
  function zoom(direction) { orbit.zoomBy(direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP); redrawView(); }
  function recentre() { orbit.reset(); redrawView(); }

  // ---- pointer: drag to look, pinch and wheel to zoom, tap to walk ---------------------------
  function releasePointers() {
    for (const id of pointers.keys()) { try { canvas.releasePointerCapture?.(id); } catch {} }
    pointers.clear();
    if (canvas.style) canvas.style.cursor = 'grab';
  }
  function resetView() {
    releasePointers();
    suppressClick = false;
    orbit.reset();
  }
  function pointerDown(event, capture = true) {
    if (event.pointerType === 'touch') controls?.touch(true);
    // The first input of any kind retires the one-time hint.
    controls?.hint(null);
    if (event.button !== 0 || pointers.size >= 2) return;
    if (!pointers.size) suppressClick = false;
    else suppressClick = true;
    // A press that began on a name tag is not captured yet: left alone it is a click on the tag; once it moves it becomes a drag (pointerMove).
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, loose: !capture });
    if (capture) { try { canvas.setPointerCapture?.(event.pointerId); } catch {} }
    if (canvas.style) canvas.style.cursor = 'grabbing';
    setHover(null);
  }
  function pointerMove(event) {
    const previous = pointers.get(event.pointerId);
    if (!previous) { if (!pointers.size && event.pointerType !== 'touch') hoverAt(event); return; }
    const next = { ...previous, x: event.clientX, y: event.clientY };
    if (!suppressClick && pointers.size === 1) {
      if (Math.hypot(next.x - previous.startX, next.y - previous.startY) < 6) return;
      suppressClick = true;
      if (previous.loose) { next.loose = false; try { canvas.setPointerCapture?.(event.pointerId); } catch {} }
    }
    if (next.x === previous.x && next.y === previous.y) return;
    if (pointers.size === 2) {
      const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)[1];
      const before = Math.hypot(previous.x - other.x, previous.y - other.y);
      const after = Math.hypot(next.x - other.x, next.y - other.y);
      if (before > 4 && after > 4) orbit.zoomBy(after / before);
    } else orbit.drag(next.x - previous.x, next.y - previous.y);
    pointers.set(event.pointerId, next);
    event.preventDefault();
    redrawView();
  }
  function pointerEnd(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    try { canvas.releasePointerCapture?.(event.pointerId); } catch {}
    if (!pointers.size && canvas.style) canvas.style.cursor = 'grab';
  }
  function wheel(event) {
    if (!Number.isFinite(event.deltaY)) return;
    event.preventDefault();
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1;
    // A trackpad pinch arrives as ctrl+wheel with small deltas.
    const before = orbit.goal.zoom;
    orbit.zoomBy(Math.exp(clamp(-event.deltaY * units * (event.ctrlKey ? 0.012 : 0.0016), -0.6, 0.6)));
    if (orbit.goal.zoom === before) return;
    controls?.hint(null);
    redrawView();
  }
  /** The floor point (scene coordinates) under a point of the canvas, or null when it looks at the sky. */
  function floorAt(clientX, clientY, out) {
    const box = container.getBoundingClientRect();
    if (!box.width || !box.height || !current) return null;
    const nx = ((clientX - (box.left || 0)) / box.width) * 2 - 1, ny = -((clientY - (box.top || 0)) / box.height) * 2 + 1;
    camera.updateMatrixWorld(true);
    rayA.set(nx, ny, -1).unproject(camera); rayB.set(nx, ny, 1).unproject(camera);
    const fall = rayB.y - rayA.y;
    if (!(fall < -1e-6)) return null;
    const t = -rayA.y / fall;
    if (t < 0 || t > 1) return null;
    out.x = rayA.x + (rayB.x - rayA.x) * t - current.group.position.x;
    out.z = rayA.z + (rayB.z - rayA.z) * t - current.group.position.z;
    return out;
  }
  /** Where a scene point is on the canvas, in CSS pixels. */
  function screenOf(x, y, z, out) {
    point.set(x, y, z);
    if (current?.group) point.applyMatrix4(current.group.matrixWorld);
    point.project(camera);
    const box = container.getBoundingClientRect();
    out.x = (box.left || 0) + ((point.x + 1) / 2) * box.width; out.y = (box.top || 0) + ((1 - point.y) / 2) * box.height;
    return out;
  }
  const spare = { x: 0, z: 0 }, pixel = { x: 0, y: 0 }, pixelTop = { x: 0, y: 0 }, pixelSide = { x: 0, y: 0 };
  /** How far a spot's marker reaches on screen, in CSS pixels across and down: the ring as the camera sees it, and a little more — never less than a fingertip. */
  function markerReach(spot, out) {
    const azimuth = orbit.azimuth;
    screenOf(spot.x, spot.y + 0.1, spot.z, pixel);
    screenOf(spot.x + Math.cos(azimuth) * 0.82, spot.y + 0.1, spot.z - Math.sin(azimuth) * 0.82, pixelSide);
    const across = Math.hypot(pixelSide.x - pixel.x, pixelSide.y - pixel.y);
    out.x = Math.max(24, across * 1.25); out.y = Math.max(24, across * Math.sin(orbit.pitch) * 1.25);
    // The ring itself, as drawn (never less than a mouse can hit).
    out.ringX = Math.max(12, across); out.ringY = Math.max(12, across * Math.sin(orbit.pitch));
    return out;
  }
  const reachOf = { x: 0, y: 0, ringX: 0, ringY: 0 };
  /**
   * What a click at a point of the canvas would pick, in the order it is decided:
   *   spot     the pointer is on a spot's marker ring — the marker wins, whoever stands in front of it
   *   person   it is on someone's figure
   *   spot     it is within the marker's larger hit area (a quarter wider than the ring, a fingertip at least)
   *   object   (home) it is on a piece of furniture
   *   spot     it is on the floor right beside a marker
   *   floor    anywhere else on the floor; null when it looks at the sky
   * → { type, spot | person | hit, at } | null. Used by the tap and by the hover, so what lights up is what a click does.
   */
  function pick(clientX, clientY) {
    const walk = walkOf();
    if (!walk || !walk.grid || !current) return null;
    current.group.updateMatrixWorld(true);
    let onRing = null, ringAway = 1, chosen = null, closest = 1;
    for (const spot of spotList) {
      markerReach(spot, reachOf);
      const dx = pixel.x - clientX, dy = pixel.y - clientY;
      const ring = Math.hypot(dx / reachOf.ringX, dy / reachOf.ringY), away = Math.hypot(dx / reachOf.x, dy / reachOf.y);
      if (ring < ringAway) { ringAway = ring; onRing = spot; }
      if (away < closest) { closest = away; chosen = spot; }
    }
    if (onRing) return { type: 'spot', spot: onRing };
    for (const person of walk.people()) {
      screenOf(person.x, 0, person.z, pixel); screenOf(person.x, person.top, person.z, pixelTop);
      const tall = Math.max(18, pixel.y - pixelTop.y);
      if (clientY < pixelTop.y - 6 || clientY > pixel.y + 6 || Math.abs(clientX - pixel.x) > tall * 0.24 + 6) continue;
      return { type: 'person', person };
    }
    if (chosen) return { type: 'spot', spot: chosen };
    const hit = current.pickAt?.(clientX, clientY);
    if (hit?.id) return { type: 'object', hit };
    const at = hit && Number.isFinite(hit.x) ? hit : floorAt(clientX, clientY, spare);
    if (!at) return null;
    let beside = null, nearest = 1.25;
    for (const spot of spotList) { const distance = Math.hypot(spot.x - at.x, spot.z - at.z); if (distance < nearest) { nearest = distance; beside = spot; } }
    return beside ? { type: 'spot', spot: beside } : { type: 'floor', at };
  }
  /** A tap that was not a drag: walk to what was tapped, then do what tapping it does. */
  function tap(event) {
    const walk = walkOf();
    if (!walk || !walk.grid || locked || uiMode !== 'venue' || current.placing || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return false;
    controls?.hint(null);
    const target = pick(event.clientX, event.clientY);
    if (!target) return false;
    if (target.type === 'spot') {
      const spot = target.spot, id = spot.id;
      return walkTo(spot.x, spot.z, { exact: true, face: spot.ry, mark: true, then: () => requestSpot(id, true), ...wayUp(spot) });
    }
    if (target.type === 'person') {
      const person = target.person;
      const side = Math.atan2(walker.x - person.x, walker.z - person.z), reach = 1.5 * walk.scale;
      const stand = walk.grid.nearest(person.x + Math.sin(side) * reach, person.z + Math.cos(side) * reach);
      return stand ? walkTo(stand.x, stand.z, { face: Math.atan2(person.x - stand.x, person.z - stand.z), then: () => onTag?.({ id: person.id, kind: person.kind }) }) : false;
    }
    if (target.type === 'object') {
      // Furniture at home: walk up to it, then use it.
      const hit = target.hit;
      const cx = hit.rect ? (hit.rect[0] + hit.rect[2]) / 2 : hit.x, cz = hit.rect ? (hit.rect[1] + hit.rect[3]) / 2 : hit.z;
      const stand = Number.isFinite(cx) ? walk.grid.nearest(cx, cz) : null;
      if (!stand) { current.use(hit.id, hit.cell); return true; }
      return walkTo(stand.x, stand.z, { face: Math.atan2(cx - stand.x, cz - stand.z), then: () => current.use(hit.id, hit.cell) });
    }
    return walkTo(target.at.x, target.at.z, { mark: true });
  }
  /** Show what a click would pick: a marker lights up and names itself, a person's tag is outlined. One frame per change; nothing while the pointer rests. */
  function setHover(next) {
    const key = next ? `${next.type}:${next.spot?.id ?? next.person?.id ?? ''}` : '';
    if (key === (hover?.key ?? '')) return false;
    hover = next ? { key, type: next.type, spot: next.spot || null, person: next.person || null } : null;
    if (canvas.style && !pointers.size) canvas.style.cursor = hover && hover.type !== 'floor' ? 'pointer' : 'grab';
    for (const node of tagNodes) node.classList?.toggle('is-hover', hover?.type === 'person' && node.dataset.tag === hover.person.id);
    if (spotHint) { spotHint.hidden = hover?.type !== 'spot'; if (hover?.type === 'spot') spotHint.textContent = hover.spot.label || hover.spot.id; }
    showNear();
    return true;
  }
  function hoverAt(event) {
    if (locked || uiMode !== 'venue' || current?.placing || loop.running || !Number.isFinite(event.clientX)) { if (hover) { setHover(null); if (!loop.running) renderScene(); } return; }
    const target = pick(event.clientX, event.clientY);
    if (setHover(target && target.type !== 'floor' && target.type !== 'object' ? target : null)) renderScene();
  }
  const listeners = { pointerdown: (event) => pointerDown(event), pointermove: pointerMove, pointerup: pointerEnd,
    pointercancel: pointerEnd, lostpointercapture: pointerEnd, wheel,
    pointerleave() { if (hover && !pointers.size) { setHover(null); if (!loop.running) renderScene(); } },
    click(event) {
      if (suppressClick && event.detail !== 0) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      if (event.detail === 0) return; // a keyboard-generated click is not a place on the floor
      if (tap(event) && !loop.running) renderScene();
    } };
  for (const [type, listener] of Object.entries(listeners)) canvas.addEventListener?.(type, listener, { passive: false, capture: type === 'click' });

  // ---- keys (forwarded by the shell) and the on-screen controls ------------------------------
  function onKey(event) {
    const { action, mode, jog } = event.detail || {};
    if (mode !== 'venue' && mode !== 'buy') return;
    if (Object.hasOwn(WALK_KEYS, action) || Object.hasOwn(LOOK_KEYS, action) || /^zoom-/.test(action || '')) controls?.hint(null);
    if (action === 'zoom-in') zoom(1);
    else if (action === 'zoom-out') zoom(-1);
    else if (action === 'zoom-fit') recentre();
    else if (mode !== 'venue') return;
    else if (Object.hasOwn(WALK_KEYS, action)) {
      held[WALK_KEYS[action]] = true;
      if (action !== 'walk-jog') held.jog = Boolean(jog);
      if (walkOf() && !locked) loop.wake();
    } else if (Object.hasOwn(LOOK_KEYS, action)) {
      held[LOOK_KEYS[action]] = true;
      if (loop.available) loop.wake(); else { orbit.rotate(((held.lookRight ? 1 : 0) - (held.lookLeft ? 1 : 0)) * 0.12, ((held.lookUp ? 1 : 0) - (held.lookDown ? 1 : 0)) * 0.08); held[LOOK_KEYS[action]] = false; redrawView(); }
    }
  }
  function onKeyUp(event) {
    const action = event.detail?.action;
    if (Object.hasOwn(WALK_KEYS, action)) held[WALK_KEYS[action]] = false;
    else if (Object.hasOwn(LOOK_KEYS, action)) held[LOOK_KEYS[action]] = false;
  }
  function onMode(event) { uiMode = event.detail?.mode || 'venue'; if (uiMode !== 'venue') dropInput(); }
  // Created after the shell: start from the view the shell wrote on its root element.
  uiMode = globalThis.document?.querySelector?.('.life-ui')?.dataset?.mode || 'venue';
  win?.addEventListener?.('jaw:mode', onMode);
  win?.addEventListener?.('jaw:key', onKey);
  win?.addEventListener?.('jaw:key-up', onKeyUp);
  win?.addEventListener?.('blur', dropInput);
  const controls = createSceneControls(container, {
    onZoom: zoom, onRecentre: recentre,
    onStick(x, z, jog) { stick.x = x; stick.z = z; stick.jog = jog; if ((x || z) && walkOf() && !locked) loop.wake(); },
  });
  if (controls) {
    const coarse = globalThis.matchMedia?.('(pointer: coarse)').matches === true;
    controls.touch(coarse);
    controls.hint(coarse ? HINT_TOUCH : HINT_DESKTOP);
  }

  /**
   * Project the current scene's tags through the camera. Runs with every frame the host draws —
   * never on its own. The DOM nodes are made when the list of tags changes; a frame only moves them.
   */
  function projectTags() {
    camera.updateMatrixWorld(true);
    current?.group.updateMatrixWorld(true);
    if (shownTags.length !== tagSource.length) shownTags = tagSource.map(() => ({}));
    for (let i = 0; i < tagSource.length; i++) {
      const tag = tagSource[i], shown = shownTags[i];
      point.set(tag.position.x, tag.position.y, tag.position.z);
      if (current?.group) point.applyMatrix4(current.group.matrixWorld);
      point.project(camera);
      shown.id = tag.id; shown.kind = tag.kind; shown.text = tag.text; shown.name = tag.name; shown.marker = tag.marker; shown.colour = tag.colour;
      shown.x = Math.round(((point.x + 1) / 2) * size.width); shown.y = Math.round(((1 - point.y) / 2) * size.height);
      shown.visible = point.z > -1 && point.z < 1 && Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1;
    }
    if (!tagLayer) return;
    // Who is tagged is compared only when the list was read again — a frame of the motion loop builds no strings.
    const shape = tagsRead ? shownTags.map((tag) => `${tag.id}\u0001${tag.kind}\u0001${tag.text}\u0001${tag.name}\u0001${tag.marker}`).join('\u0002') : tagShape;
    tagsRead = false;
    if (shape !== tagShape) {
      tagShape = shape;
      tagNodes = shownTags.map((tag) => {
        // Built with textContent only: a player's name can never become markup.
        const node = globalThis.document.createElement(tag.kind === 'self' ? 'span' : 'button');
        node.className = `scene-tag is-${tag.kind}`;
        node.dataset.tag = tag.id; node.dataset.kind = tag.kind;
        if (tag.marker === 'crown') node.innerHTML = CROWN_MARK;
        else if (tag.marker === 'dot') node.appendChild(globalThis.document.createElement('i'));
        else node.textContent = tag.text;
        node.title = tag.kind === 'self' ? 'You' : tag.name;
        node.setAttribute('aria-label', tag.kind === 'self' ? 'You' : tag.kind === 'npc' ? `${tag.name}, a local` : `${tag.name}, a player`);
        node.jawX = NaN; node.jawY = NaN; node.jawShown = true;
        return node;
      });
      tagLayer.replaceChildren(...tagNodes, spotHint);
    }
    if (spotHint && hover?.type === 'spot') {
      point.set(hover.spot.x, hover.spot.y + 0.1, hover.spot.z);
      if (current?.group) point.applyMatrix4(current.group.matrixWorld);
      point.project(camera);
      spotHint.style.left = `${Math.round(((point.x + 1) / 2) * size.width)}px`; spotHint.style.top = `${Math.round(((1 - point.y) / 2) * size.height)}px`;
    }
    for (let i = 0; i < tagNodes.length; i++) {
      const node = tagNodes[i], tag = shownTags[i];
      if (node.jawShown !== tag.visible) { node.jawShown = tag.visible; node.hidden = !tag.visible; }
      if (node.jawX !== tag.x) { node.jawX = tag.x; node.style.left = `${tag.x}px`; }
      if (node.jawY !== tag.y) { node.jawY = tag.y; node.style.top = `${tag.y}px`; }
    }
  }
  function readTags() { tagSource = current?.tags?.() || []; tagsRead = true; }
  /** Tell the scene where the camera is, so a room can hide the walls it is behind. Flips visibility only. */
  function lookIn() {
    if (!current?.look) return;
    const offset = current.group.position;
    current.look(camera.position.x - offset.x, camera.position.z - offset.z);
  }
  function renderScene() { lookIn(); aimGhost(); renderer.render(scene, camera); renderCount += 1; projectTags(); }

  /** Build a venue's scene when it is shown. A scene with dispose() is freed on leaving and rebuilt next time. */
  function sceneFor(id) {
    if (!built.has(id)) {
      const venue = VENUES[id];
      const entry = venue?.scene?.kind === 'home' ? buildHomeScene(kit, venue) : buildVenueScene(kit, sceneVenue(id));
      entry.group.visible = false;
      scene.add(entry.group);
      built.set(id, entry);
    }
    return built.get(id);
  }
  /** Take the lighting and clear colour the current scene asks for. */
  function applyLook() {
    lights.apply(current?.lighting?.());
    background = current?.background || DEFAULT_BACKGROUND;
    renderer.setClearColor(background);
  }
  /** Size the canvas and the projection, and give the orbit the scene's own camera preset and limits. */
  function frame() {
    const { width, height } = container.getBoundingClientRect();
    size = { width, height };
    camera.aspect = width / Math.max(1, height);
    const portrait = camera.aspect < 0.85;
    const view = current?.camera || DEFAULT_CAMERA, walk = walkOf();
    orbit.setBase(portrait ? view.portrait : view.landscape);
    // Close enough to see a face, far enough to see the whole venue. The orbit is free all the way round:
    // a room hides the walls the camera is behind (lookIn), so no scene needs an azimuth limit.
    orbit.setLimits({ near: 6.2 * (walk?.scale || 1), azimuth: null });
    camera.fov = portrait ? 48 : 43;
    // Centre the scene in what the HUD leaves free; on a wide screen also step back a little when little is left.
    const free = Math.max(160, height - insets.top - insets.bottom);
    camera.zoom = portrait ? 1 : Math.max(0.74, Math.min(1, free / (height * 0.6)));
    // Scenes are composed a little above the point the camera looks at (walls and props rise from the floor).
    const shift = insets.top || insets.bottom ? Math.round((insets.bottom - insets.top) / 2 - height * 0.06 * camera.zoom) : 0;
    if (shift && width > 0 && height > 0) camera.setViewOffset(width, height, 0, shift, width, height); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    controls?.place({ top: insets.top, bottom: insets.bottom, wide: width > 1000, hintTop });
    setPivot();
    if (!loop.running) settleView();
    orbit.apply(camera);
  }
  function resize() { frame(); renderScene(); }
  /** Show a venue. Draws one frame only if the venue actually changed. */
  function setLocation(id) {
    if (id === currentLocation) return;
    loop.stop();
    if (current) {
      current.walk?.drive(false);
      current.group.visible = false;
      if (typeof current.dispose === 'function') { current.dispose(); scene.remove(current.group); built.delete(currentLocation); }
    }
    resetView();
    currentLocation = id;
    current = sceneFor(id);
    current.group.visible = true;
    current.setPlayer?.(player);
    current.setCrowd?.(crowd);
    current.settleCrowd?.();
    if (lastState) current.update?.(lastState);
    enterScene();
    readTags();
    applyLook();
    resize();
  }
  /** Give the current scene the latest game state. Draws one frame only if the scene says it changed. */
  function setState(state) {
    lastState = state;
    const changed = current?.update?.(state);
    const walk = walkOf();
    if (walk) { walker.setGrid(walk.grid); spotList = walk.spots(); }
    const moved = syncRest();
    readTags();
    if (changed) applyLook();
    if ((changed || moved) && !loop.running) { setPivot(); if (!loop.available || reduced()) settleView(); orbit.apply(camera); renderScene(); }
  }
  /** The player's avatar: { look, seed (the session's public id), name, pose? }. One frame if it changed. */
  function setPlayer(next = {}) {
    player = { ...next };
    const changed = current?.setPlayer?.(player);
    const moved = changed ? syncRest() : false;
    readTags();
    if ((changed || moved) && !loop.running) renderScene();
  }
  /** Other players and NPCs standing here (capped at MAX_CROWD). One frame, and only if the list changed. */
  function setCrowd(people) {
    const list = (Array.isArray(people) ? people : []).filter((person) => person && typeof person === 'object').slice(0, MAX_CROWD);
    const key = JSON.stringify(list);
    if (key === crowdKey) return false;
    crowdKey = key; crowd = list;
    return showCrowd();
  }
  /** Hand the crowd to the current scene: reported positions come in presence units and are turned back into the scene's own. */
  function showCrowd() {
    if (!current?.setCrowd) return false;
    const k = presenceScale();
    current.setCrowd(k === 1 ? crowd : crowd.map((person) => (Number.isFinite(person.x) && Number.isFinite(person.z) ? { ...person, x: person.x / k, z: person.z / k } : person)));
    walker.others = walkOf()?.people() || null;
    setHover(null);
    readTags();
    // Somebody is on their way to a new place: the loop eases them there (bounded) — or, without one, they are simply there.
    if (current.easing) { if (loop.available && !reduced()) { loop.wake(); return true; } current.settleCrowd(); }
    if (!loop.running) renderScene();
    return true;
  }
  setLocation(location);
  return {
    update() { renderScene(); },
    diagnostics() {
      return {
        renderCount,
        // Movement and camera: where the avatar is, which way it faces, where the camera is, and whether frames are being drawn.
        loop: { running: loop.running, frames: loop.frames },
        avatar: { x: Math.round(walker.x * 100) / 100, z: Math.round(walker.z * 100) / 100, y: Math.round(avatarY * 100) / 100, facing: Math.round(walker.ry * 1000) / 1000, moving: walker.moving, mode: walker.mode, blocked: walker.blocked, locked, near: nearSpot?.id ?? null },
        // walls: which of a room's walls are showing; held: the share of the asked-for distance a collision holds the camera at; ghost: the see-through circle's strength.
        walls: current?.walls ?? null, perch: Boolean(perch), hover: hover ? hover.key : null, easing: Boolean(current?.easing), solids: occluders.count,
        camera: { yaw: Math.round(orbit.azimuth * 1000) / 1000, pitch: Math.round(orbit.pitch * 1000) / 1000, zoom: Math.round(orbit.now.zoom * 1000) / 1000, distance: Math.round(orbit.distance * 100) / 100,
          asked: Math.round(orbit.asked * 100) / 100, held: Math.round(orbit.now.squeeze * 1000) / 1000, ghost: Math.round(ghost.now * 100) / 100, x: Math.round(camera.position.x * 100) / 100, y: Math.round(camera.position.y * 100) / 100, z: Math.round(camera.position.z * 100) / 100,
          limits: { pitch: [0.1, Math.round((Math.PI / 2 - 0.07) * 1000) / 1000], zoom: [Math.round(orbit.limits.zoomMin * 1000) / 1000, Math.round(orbit.limits.zoomMax * 1000) / 1000], azimuth: orbit.limits.azimuth } },
        // Where each spot and person is on the canvas (CSS pixels) — what a tap on it has to hit.
        spots: spotList.map((spot) => { current.group.updateMatrixWorld(true); const at = screenOf(spot.x, spot.y + 0.1, spot.z, { x: 0, y: 0 }); return { id: spot.id, x: spot.x, z: spot.z, px: Math.round(at.x), py: Math.round(at.y), selected: spot.id === lastState?.spot }; }),
        people: (walkOf()?.people() || []).map((person) => { const at = screenOf(person.x, person.top * 0.5, person.z, { x: 0, y: 0 }); return { id: person.id, kind: person.kind, x: person.x, z: person.z, px: Math.round(at.x), py: Math.round(at.y) }; }),
        objects: (current?.objects?.() || []).map((item) => { const at = screenOf(item.x, 0.35, item.z, { x: 0, y: 0 }); return { id: item.id, itemId: item.itemId, x: item.x, z: item.z, px: Math.round(at.x), py: Math.round(at.y) }; }),
        drawCalls: renderer.info?.render.calls,
        triangles: renderer.info?.render.triangles,
        geometries: renderer.info?.memory.geometries,
        textures: renderer.info?.memory.textures,
        location: currentLocation, background, scenes: built.size, crowd: crowd.length,
        lighting: { hemi: lights.hemi.intensity, sun: lights.sun.intensity, sky: `#${lights.hemi.color.getHexString()}` },
        tags: shownTags.map((tag) => ({ ...tag })),
      };
    },
    resize,
    /** How many CSS pixels of the canvas the HUD covers at the top and bottom. One frame, and only if it changed. */
    setInsets(next = {}) {
      const snap = (value) => Math.max(0, Math.round((Number(value) || 0) / 12) * 12);
      const top = snap(next.top), bottom = snap(next.bottom);
      // hint: where the HUD's own rows under the top bar end on a phone — the one-time hint sits just below (no frame is needed to move it).
      const hintAt = Math.max(0, Math.round(Number(next.hint) || 0));
      if (hintAt !== hintTop) { hintTop = hintAt; controls?.place({ top: insets.top, bottom: insets.bottom, wide: size.width > 1000, hintTop }); }
      if (top === insets.top && bottom === insets.bottom) return false;
      insets = { top, bottom };
      resize();
      return true;
    },
    setLocation,
    setState,
    setPlayer,
    setCrowd,
    /** Camera and walking, for the on-screen controls and for tests. */
    zoom, recentre,
    walkTo(x, z) { const ok = walkTo(x, z, { mark: true }); if (ok && !loop.running) renderScene(); return ok; },
    /** Walk the avatar by (dx, dz) scene units — the community panel's keyboard-accessible Walk buttons. False when it cannot walk now. */
    walkBy(dx, dz) {
      if (!walkOf()?.grid || locked || uiMode !== 'venue' || current.placing || !Number.isFinite(dx) || !Number.isFinite(dz)) return false;
      const ok = walkTo(walker.x + dx, walker.z + dz, { mark: true });
      if (ok && !loop.running) renderScene();
      return ok;
    },
    /** Where the avatar stands right now, in presence units: { x, z, location } — what onMove reports while it moves. */
    position() { const k = presenceScale(); return { x: Math.round(walker.x * k * 100) / 100, z: Math.round(walker.z * k * 100) / 100, location: currentLocation }; },
    dispose() {
      loop.dispose(); clearDwell();
      releasePointers();
      for (const [type, listener] of Object.entries(listeners)) canvas.removeEventListener?.(type, listener, { capture: type === 'click' });
      win?.removeEventListener?.('jaw:mode', onMode); win?.removeEventListener?.('jaw:key', onKey); win?.removeEventListener?.('jaw:key-up', onKeyUp); win?.removeEventListener?.('blur', dropInput);
      controls?.dispose();
      if (canvas.style) { canvas.style.touchAction = previousTouchAction || ''; canvas.style.cursor = previousCursor || ''; }
      for (const entry of built.values()) entry.dispose?.();
      built.clear();
      kit.dispose();
      renderer.dispose();
      renderer.domElement.remove?.();
      tagLayer?.remove();
    },
  };
}
