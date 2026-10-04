/**
 * OWNER: scenes
 * One procedural scene per `scene.kind` declared in src/game/content/venues.js.
 *
 * SCENES[kind] = (kit, venue) => ({
 *   group,                      // THREE.Group holding everything for this venue
 *   background,                 // clear colour for the current time of day
 *   camera: { landscape: [x, y, z], portrait: [x, y, z] },
 *   update(state) → boolean,    // reflect game state; true if anything changed (host draws one frame)
 *   ...the extensions below
 * })
 * Kinds: park, buka, hub, club, office, market, gym, mall, beach, hospital, salon, rooftop,
 * police, worship, radio, polling, viewing, shrine, walk, statehouse — plus `library` (the
 * speakeasy variant of club) and `generic`, the fallback for unknown kinds. `home` belongs to
 * src/scene/home-scene.js.
 *
 * venue.scene options: { kind, variant, palette (accent colour), time ('day' | 'dusk' | 'night',
 * fixes the lighting; otherwise it follows Lagos time from state.t), spots: [{ id, label }]
 * (defaults to the venue's own spots), look, seed }.
 *
 * venue.scene.anchors: { [spotId]: landmarkKey } pins a spot to one of the scene's landmarks;
 * spots without a hint are matched by their id and label, and only then take what is left.
 *
 * BATTERY RULE. Scenes are static: no frame callbacks, timers or per-frame work, and a scene
 * never renders by itself. A venue is baked into a few merged meshes (src/scene/build.js); a
 * crowd change rebuilds only the small "actors" batch and reports true so the host draws exactly
 * one frame. The player's avatar, the spot ring and the walking marks are separate, prebuilt
 * objects that are only ever MOVED (position, rotation, visibility) — walking builds no geometry.
 * The host (src/venue-world.js) calls dispose() when the player leaves the venue, which frees
 * every geometry the scene made.
 *
 * What the host does with an entry (every member is optional for the host):
 *   lighting()                  the preset in use (LIGHTING[mood][time]); the HOST applies hemi
 *                               and sun to its own lights. A scene never touches the host.
 *   background                  re-read by the host whenever update() returns true
 *   kind, mood                  resolved kind and lighting mood ('outdoor' | 'indoor' | 'club')
 *   anchors[spotId] → { x, y, z, ry, landmark }   where a spot is in the scene; also keyed by landmark
 *   time                        current 'day' | 'dusk' | 'night'
 *   setTime(time) / setSpot(id) / setPlayer({ look, seed, pose, name }) → boolean (changed)
 *   setCrowd(people) → tags     other players and NPCs; see buildCrowd in characters.js
 *   tags()                      name-tag data for you and the crowd, for the DOM layer
 *   walk                        what the host needs to walk the avatar about: { grid, entrance,
 *                               open, avatar, drive(on), rest(), spots(), people(), move(x, y, z, ry),
 *                               pose(name, seat), gait(step, phase), heightAt(x, z), near(spot),
 *                               goal(x, z), solids } — see WALK below and src/scene/movement.js
 *   look(x, z) → boolean        the camera is at (x, z) in the scene's own coordinates: a room hides
 *                               whichever wall the camera has gone behind, with everything that
 *                               hangs on it (dollhouse-style), so the camera may orbit all the way
 *                               round. True when a wall was shown or hidden. Transform-free and
 *                               build-free: it only flips mesh.visible.
 *   easing / stepCrowd(dt) / settleCrowd()   other PLAYERS who report where they stand are separate
 *                               figures that ease to each new position; the host steps them in its
 *                               motion loop for as long as `easing` is true (each ease is bounded,
 *                               under half a second) and snaps them when motion is reduced
 *
 * WHO STANDS WHERE
 *   NPCs stand at their landmark; players who have not reported a position stand at the scene's
 *   crowd places; a player with a reported position ({ x, z } on the crowd entry — the same scene
 *   coordinates the host reports for the local avatar) stands exactly there. Nobody the scene
 *   places itself stands on a spot marker or on the ground in front of one (clearOfSpots), so a
 *   marker is never hidden behind a figure in the scene's own view.
 *   stats()                     { triangles, meshes, drawCalls, lights, geometries }
 *   dispose()                   free everything and detach from the parent (the host calls it on
 *                               a location change and when it is disposed itself)
 */
import { createBatch, kitResources, releaseObjects, GLOW } from './build.js';
import { buildAvatar, drawCrowd } from './characters.js';
import { playerOptions, rigOf } from './avatar-rig.js';
import { createWalkGrid, footprintRecorder, turnTowards } from './movement.js';
import { spotMarker } from './props.js';
import { lagosTime } from '../game/clock.js';
import * as outdoor from './venues-outdoor.js';
import * as social from './venues-social.js';
import * as work from './venues-work.js';
import * as civic from './venues-civic.js';

export const DEFAULT_CAMERA = { landscape: [16, 21, 27], portrait: [13, 24, 31] };
const SCENE_CAMERA = { landscape: [15, 19.8, 25.4], portrait: [16.5, 29.5, 38.5] };
export const TIMES = Object.freeze(['day', 'dusk', 'night']);
export const MAX_CROWD = 12;

/**
 * Day / dusk / night presets per mood. sky: [horizon, zenith]; hemi: [sky, ground, intensity];
 * sun: [colour, intensity, position]; glow: strength of lit surfaces; lamps: point-light scale.
 */
export const LIGHTING = Object.freeze({
  outdoor: {
    day: { sky: ['#bfe3f2', '#6fb4e6'], hemi: ['#e6f3ff', '#7d916a', 2.2], sun: ['#fff2d4', 2.7, [-10, 26, 12]], glow: 0.6, lamps: 0.1 },
    dusk: { sky: ['#eeaa82', '#5d528f'], hemi: ['#f0c4ac', '#4d4863', 1.4], sun: ['#ff9a5c', 1.9, [-22, 11, 7]], glow: 1.05, lamps: 0.8 },
    night: { sky: ['#1c2742', '#0b1020'], hemi: ['#8ea6d2', '#1a2530', 0.8], sun: ['#9fb9ea', 0.75, [-12, 25, 8]], glow: 1.3, lamps: 1.6 },
  },
  indoor: {
    day: { sky: ['#cfe6ef', '#8cc0e2'], hemi: ['#fff8ee', '#c4b9aa', 2.5], sun: ['#fff1d8', 2.1, [-8, 26, 14]], glow: 0.85, lamps: 0.45 },
    dusk: { sky: ['#e3a37c', '#6f5f95'], hemi: ['#ffe4c7', '#9a8a7c', 1.95], sun: ['#ffb57c', 1.4, [-18, 14, 10]], glow: 1.05, lamps: 0.85 },
    night: { sky: ['#1d2740', '#0e1324'], hemi: ['#ecdfc9', '#6a6270', 1.6], sun: ['#c9d3ee', 0.9, [-12, 25, 8]], glow: 1.2, lamps: 1.1 },
  },
  club: {
    day: { sky: ['#1d1830', '#120f1f'], hemi: ['#a897e0', '#221a2e', 0.95], sun: ['#c0b0ff', 0.7, [-10, 26, 10]], glow: 1.2, lamps: 1.05 },
    dusk: { sky: ['#1b162c', '#110e1d'], hemi: ['#9d89d8', '#1f1829', 0.85], sun: ['#b8a4ff', 0.6, [-10, 26, 10]], glow: 1.3, lamps: 1.15 },
    night: { sky: ['#17132a', '#0d0a18'], hemi: ['#927fd0', '#1c1626', 0.8], sun: ['#b8a4ff', 0.55, [-10, 26, 10]], glow: 1.35, lamps: 1.2 },
  },
});

/** Lagos time of day from server ms: day 06:30–17:30, dusk for the hour either side of night. */
export function timeOfDay(ms) {
  const { minuteOfDay } = lagosTime(ms);
  if (minuteOfDay >= 390 && minuteOfDay < 1050) return 'day';
  if ((minuteOfDay >= 330 && minuteOfDay < 390) || (minuteOfDay >= 1050 && minuteOfDay < 1170)) return 'dusk';
  return 'night';
}
export const lightingFor = (mood, time) => (LIGHTING[mood] || LIGHTING.outdoor)[TIMES.includes(time) ? time : 'day'];

const DEFS = { ...outdoor.SCENES, ...social.SCENES, ...work.SCENES, ...civic.SCENES };
/** Kinds that are another kind with a default variant. */
const ALIASES = { library: ['club', 'speakeasy'], church: ['worship', 'church'], mosque: ['worship', 'mosque'] };
export const KINDS = Object.freeze(Object.keys(DEFS).filter((kind) => kind !== 'generic'));

function skyDome(kit, materials) {
  const { THREE } = kit;
  const geometry = new THREE.SphereGeometry(90, 16, 8);
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 3), 3));
  const mesh = new THREE.Mesh(geometry, materials.sky);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}
function paintSky(THREE, mesh, [horizon, zenith]) {
  const low = new THREE.Color(horizon), high = new THREE.Color(zenith), mix = new THREE.Color();
  const { position, color } = mesh.geometry.attributes;
  for (let i = 0; i < position.count; i++) {
    const t = Math.max(0, Math.min(1, (position.getY(i) + 30) / 75));
    mix.copy(low).lerp(high, t);
    color.setXYZ(i, mix.r, mix.g, mix.b);
  }
  color.needsUpdate = true;
}

/**
 * Match venue spots to the landmarks a scene offers: an explicit hint first (several spots may
 * share one landmark), then the spot's id and label; leftovers take unused landmarks, then spare ground.
 */
function resolveAnchors(landmarks, spots, spare, hints = {}) {
  const anchors = {}, used = new Set();
  // approach on a landmark is the way up to a raised place: [x, z] — the foot of its steps, where the avatar leaves the
  // floor — or a chain [[x, z], ...] whose first point is on the floor and whose others are the way up (a stair top, a platform).
  const place = (landmark) => {
    const pair = (value) => (Array.isArray(value) && Number.isFinite(value[0]) && Number.isFinite(value[1]) ? { x: value[0], z: value[1] } : null);
    const chain = Array.isArray(landmark.approach) ? (Array.isArray(landmark.approach[0]) ? landmark.approach.map(pair).filter(Boolean) : [pair(landmark.approach)].filter(Boolean)) : [];
    return { x: landmark.x, y: landmark.y || 0, z: landmark.z, ry: landmark.ry || 0, landmark: landmark.key, act: landmark.act || null, approach: chain[0] || null, steps: chain.slice(1) };
  };
  for (const landmark of landmarks) anchors[landmark.key] = place(landmark);
  const pending = [], unhinted = [];
  for (const spot of spots) {
    if (!spot || typeof spot.id !== 'string') continue;
    const wanted = Object.hasOwn(hints, spot.id) ? hints[spot.id] : spot.anchor;
    const pinned = typeof wanted === 'string' ? landmarks.find((landmark) => landmark.key === wanted) : null;
    if (pinned) { used.add(pinned.key); anchors[spot.id] = place(pinned); } else unhinted.push(spot);
  }
  for (const spot of unhinted) {
    const text = `${spot.id} ${spot.label || ''}`.toLowerCase();
    // A spot named exactly like a landmark always gets it, even when a hint also sends another spot there.
    const match = landmarks.find((landmark) => landmark.key === spot.id)
      || landmarks.find((landmark) => !used.has(landmark.key) && landmark.match?.test(text));
    if (match) { used.add(match.key); anchors[spot.id] = place(match); } else pending.push(spot);
  }
  let spareIndex = 0;
  const fallback = () => {
    const free = landmarks.find((landmark) => !used.has(landmark.key));
    if (free) { used.add(free.key); return place(free); }
    const [x, z] = spare[spareIndex % spare.length];
    const ring = Math.floor(spareIndex / spare.length);
    spareIndex += 1;
    return { x: x + ring * 0.9, y: 0, z: z + ring * 0.9, ry: 0, landmark: null, act: null, approach: null, steps: [] };
  };
  for (const spot of pending) anchors[spot.id] = fallback();
  return { anchors, fallback, hint: (id) => (typeof hints[id] === 'string' && landmarks.find((landmark) => landmark.key === hints[id])) || null, place };
}

/**
 * WALKABLE DESCRIPTION per scene kind (see src/scene/movement.js). Every kind has one; an unknown
 * kind gets WALK_DEFAULT, whose bounds are then taken from the floor the scene actually drew.
 *   bounds    [minX, minZ, maxX, maxZ] the avatar's centre may be in — inside the floor slab and its walls
 *   entrance  [x, z] where the avatar appears on arrival (the open, camera side of the venue); the
 *             nearest free place to it is used, so a prop standing there can never trap the player
 *   block     extra obstacle rectangles [x0, z0, x1, z1] and circles [x, z, r]
 *   clear     areas opened again after blocking
 *   open      true: no walls, so the camera may orbit all the way round
 * Obstacles for furniture, counters, walls, trees, standing extras and water are not listed by hand:
 * they are the ground footprints of what the scene builder draws (footprintRecorder), so they
 * cannot drift from the art. `block` and `clear` are for what a footprint cannot say.
 */
const GROUND = Object.freeze([-14.2, -12.2, 14.2, 12.2]), FLOOR = Object.freeze([-11.5, -9.5, 11.5, 9.5]);
const outdoors = (more) => Object.freeze({ bounds: GROUND, entrance: [0, 11.4], open: true, ...more });
const indoors = (more) => Object.freeze({ bounds: FLOOR, entrance: [0, 8.8], open: false, ...more });
export const WALK_DEFAULT = Object.freeze({ bounds: null, entrance: null, open: true });
export const WALK = Object.freeze({
  park: outdoors(), market: outdoors(), beach: outdoors({ entrance: [0, 11.2] }), polling: outdoors(), walk: outdoors(), statehouse: outdoors(),
  rooftop: outdoors({ bounds: [-10.4, -8.4, 10.4, 8.4], entrance: [0, 7.6] }),
  generic: outdoors({ bounds: [-13.2, -11.2, 13.2, 11.2], entrance: [0, 10.4] }),
  buka: indoors(), club: indoors(), viewing: indoors(), shrine: indoors(), mall: indoors(), hub: indoors(), office: indoors(),
  gym: indoors(), salon: indoors(), radio: indoors(), hospital: indoors(), police: indoors(), worship: indoors(),
});
/** How far from a spot's anchor the avatar counts as standing at it. */
export const SPOT_REACH = 1.5;
/**
 * The ground a placed figure keeps off, around each spot marker: SPOT_BEHIND units beyond it,
 * SPOT_FRONT units towards the scene's own camera (a figure standing there would cover the marker
 * on screen — a person is 2.45 tall), SPOT_SIDE to either side.
 */
export const SPOT_BEHIND = 1.3, SPOT_FRONT = 3.4, SPOT_SIDE = 1.7;
/** How long another player's figure takes to ease to a newly reported position (seconds), and the jump beyond which it is simply placed. */
const PEER_EASE = [0.16, 0.42], PEER_JUMP = 7, PEER_PACE = 6;

function createEntry(kit, venue, def, kind, defaultVariant) {
  const { THREE } = kit;
  const shared = kitResources(kit);
  if (!shared.materials.sky) shared.materials.sky = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false });
  const options = venue?.scene && typeof venue.scene === 'object' ? venue.scene : {};
  const spots = Array.isArray(options.spots) ? options.spots : Object.values(venue?.spots || {});
  const context = {
    kind, venue, spots,
    variant: typeof options.variant === 'string' ? options.variant : defaultVariant || null,
    accent: typeof options.palette === 'string' && /^#[0-9a-f]{6}$/i.test(options.palette) ? options.palette : def.accent || '#e0a43a',
    label: String(venue?.label || kind),
  };
  const mood = (typeof def.mood === 'function' ? def.mood(context) : def.mood) || 'outdoor';
  const group = new THREE.Group();
  group.name = `venue:${kind}`;

  const view = {
    time: TIMES.includes(options.time) ? options.time : 'day',
    fixedTime: TIMES.includes(options.time),
    spot: null, look: options.look ?? null, lookKey: JSON.stringify(options.look ?? null), seed: options.seed ?? 'you', name: 'You',
    pose: 'stand', poseFixed: false, crowd: [],
  };
  const hints = options.anchors && typeof options.anchors === 'object' ? options.anchors : {};
  let layout = null, resolved = null, live = false, disposed = false, footprints = null, grid = null, entrance = null;
  const staticObjects = [], actorObjects = [], markObjects = [];
  let staticTriangles = 0, actorTriangles = 0, crowdTags = [], selfTag = null, sky = null;
  // Other players who report where they stand: one figure each, eased to every new position.
  const peers = new Map();
  let peopleList = [], mergedTags = [], batchKey = null, easing = false;
  const wallParts = { wallBack: [], wallLeft: [] };
  const sceneCamera = def.camera || SCENE_CAMERA;
  // The ground direction from the scene's centre towards its own camera: "in front of" a marker.
  const toCamera = (() => { const [cx, , cz] = sceneCamera.landscape, size = Math.hypot(cx, cz) || 1; return { x: cx / size, z: cz / size }; })();
  // The player's avatar is its own group, moved by its transform only: one prebuilt figure per pose.
  const avatar = new THREE.Group();
  avatar.name = 'avatar';
  const figures = new Map();
  let shownFigure = null, standFigure = null, strideFigure = null, driven = false;
  const marks = { ring: null, near: null, goal: null };

  function drawStatic() {
    const recorder = footprintRecorder(createBatch(THREE));
    const batch = recorder.batch;
    layout = def.build(batch, context) || {};
    footprints = recorder.shapes();
    layout.spots ||= [];
    layout.crowd ||= [];
    layout.spare ||= [[0, 4], [3, 5], [-3, 5], [5, 2], [-5, 2], [0, 7]];
    if (!resolved) {
      resolved = resolveAnchors(layout.spots, spots, layout.spare, hints);
      view.spot = spots.find((spot) => spot && resolved.anchors[spot.id])?.id ?? layout.spots[0]?.key ?? null;
    }
    for (const landmark of layout.spots) spotMarker(batch, landmark.x, landmark.z, context.accent, landmark.y || 0);
    return batch;
  }
  /** The floor as a grid, from this kind's walkable description and the footprints of what was drawn. */
  function buildGrid() {
    const data = Object.hasOwn(WALK, kind) ? WALK[kind] : WALK_DEFAULT;
    const floor = footprints?.floor;
    const bounds = data.bounds || (floor ? [floor[0] + 1.3, floor[1] + 1.3, floor[2] - 1.3, floor[3] - 1.3] : [-10, -8, 10, 8]);
    grid = createWalkGrid({ bounds, block: [...(footprints?.block || []), ...(data.block || [])], clear: data.clear || [] });
    const wanted = data.entrance || [(bounds[0] + bounds[2]) / 2, bounds[3] - 0.8];
    const at = grid.nearest(wanted[0], wanted[1]) || { x: wanted[0], z: wanted[1] };
    entrance = { x: at.x, y: 0, z: at.z, ry: Math.PI };
  }
  function anchorFor(id) {
    if (id == null) return null;
    if (!resolved.anchors[id]) { const pinned = resolved.hint(id); resolved.anchors[id] = pinned ? resolved.place(pinned) : resolved.fallback(); }
    return resolved.anchors[id];
  }
  /** Is this place off every spot marker and off the ground in front of one (as the scene's own camera sees it)? */
  function offMarkers(x, z) {
    for (const at of markerList()) {
      const dx = x - at.x, dz = z - at.z;
      const along = dx * toCamera.x + dz * toCamera.z, side = dx * toCamera.z - dz * toCamera.x;
      if (along > -SPOT_BEHIND && along < SPOT_FRONT && Math.abs(side) < SPOT_SIDE) return false;
    }
    return true;
  }
  let markers = null;
  /** Every place a spot marker is drawn, and every spot the server knows (each once). */
  function markerList() {
    if (markers) return markers;
    const seen = new Set(), list = [];
    for (const at of Object.values(resolved.anchors)) { const key = `${at.x.toFixed(2)},${at.z.toFixed(2)}`; if (!seen.has(key)) { seen.add(key); list.push(at); } }
    markers = list;
    return list;
  }
  /**
   * The nearest place to (x, z) where a figure may be stood: on free floor, clear of every spot
   * marker and of the ground in front of it, and not on top of someone already placed. Searched in
   * widening rings, so a crowd place that is already fine is kept exactly.
   */
  function clearOfSpots(x, z, taken) {
    const fits = (px, pz) => (!grid || grid.free(px, pz)) && offMarkers(px, pz) && !taken.some((other) => Math.hypot(other.x - px, other.z - pz) < 0.9);
    if (fits(x, z)) return { x, z };
    for (let ring = 1; ring <= 14; ring++) {
      const radius = ring * 0.45;
      let best = null, bestScore = Infinity;
      for (let step = 0; step < 16; step++) {
        const angle = (step / 16) * Math.PI * 2 + ring * 0.37;
        const px = x + Math.sin(angle) * radius, pz = z + Math.cos(angle) * radius;
        if (!fits(px, pz)) continue;
        // Of the places on this ring, prefer the one farthest from the camera side: behind a marker rather than beside it.
        const score = px * toCamera.x + pz * toCamera.z;
        if (score < bestScore) { bestScore = score; best = { x: px, z: pz }; }
      }
      if (best) return best;
    }
    return { x, z };
  }
  /** Where each person of the crowd stands. A player with a reported position stands there (`live`); everyone else is placed by the scene. */
  function placeCrowd(people) {
    const slots = layout.crowd, base = resolved.anchors.people || { x: 0, z: 3 }, taken = [];
    return people.slice(0, MAX_CROWD).map((person, index) => {
      if (Number.isFinite(person.x) && Number.isFinite(person.z)) {
        const bounds = grid?.bounds;
        const x = bounds ? Math.max(bounds[0], Math.min(bounds[2], person.x)) : person.x, z = bounds ? Math.max(bounds[1], Math.min(bounds[3], person.z)) : person.z;
        return { ...person, x, z, live: person.kind !== 'npc' };
      }
      let wanted;
      const at = person.spot != null && resolved.anchors[person.spot];
      if (at) {
        const turn = index * 2.4;
        // Far enough from the anchor that someone standing at it (you, perhaps) and this person do not overlap.
        const reach = 1.9, angle = turn + 0.9;
        wanted = { x: at.x + Math.sin(angle) * reach, y: at.y, z: at.z + Math.cos(angle) * reach, ry: person.ry ?? angle + Math.PI };
      } else if (index < slots.length) { const [x, z, ry = 0, y = 0] = slots[index]; wanted = { x, y, z, ry: person.ry ?? ry }; }
      else { const turn = index * 2.4, radius = 1.6 + (index % 3) * 0.7; wanted = { x: base.x + Math.sin(turn) * radius, z: base.z + Math.cos(turn) * radius, ry: person.ry ?? turn + Math.PI }; }
      // Someone on a raised place (a stage, a walkway) stands at its height, where the scene put them; everyone else is on
      // the ground, clear of the markers.
      const deck = Math.max(walk.heightAt(wanted.x, wanted.z), index < slots.length && !at ? wanted.y || 0 : 0);
      const clear = deck > 0.05 ? { x: wanted.x, z: wanted.z } : clearOfSpots(wanted.x, wanted.z, taken);
      // Someone standing "at" a spot who had to step aside still faces it.
      const ry = at && (clear.x !== wanted.x || clear.z !== wanted.z) ? Math.atan2(at.x - clear.x, at.z - clear.z) : wanted.ry;
      taken.push(clear);
      return { ...person, ...wanted, x: clear.x, y: deck > 0.05 ? deck : 0, z: clear.z, ry };
    });
  }
  /**
   * Where the scene itself stands the avatar: at the chosen spot's anchor, or — while an activity
   * runs there — at the place and in the pose the spot gives it (anchor.act).
   */
  function rest() {
    const anchor = anchorFor(view.spot) || { x: 0, y: 0, z: 3, ry: 0 };
    const acting = view.pose === 'busy' && !view.poseFixed && anchor.act ? anchor.act : null;
    const pose = view.poseFixed ? view.pose : acting ? acting.pose || 'work' : view.pose === 'stand' || view.pose === 'walk' ? view.pose : 'work';
    return {
      spot: view.spot, x: acting?.x ?? anchor.x, y: acting?.y ?? anchor.y, z: acting?.z ?? anchor.z, ry: acting?.ry ?? anchor.ry, pose, seat: acting?.seat,
      busy: view.pose === 'busy' && !view.poseFixed, leaving: view.pose === 'walk' && !view.poseFixed, fixed: view.poseFixed,
      anchor, approach: anchor.approach || null, steps: anchor.steps || [],
    };
  }
  /** One figure per pose, built the first time the pose is needed and kept until the look changes. */
  function figure(pose, seat) {
    const key = `${pose}:${seat ?? ''}`;
    let entry = figures.get(key);
    if (!entry) {
      // The player's own figure is seen close up: the best detail characters.js offers a scene (avatar-rig.js).
      entry = buildAvatar(kit, view.look, { pose, seat, seed: view.seed, marker: 'crown', ...playerOptions(pose) });
      entry.visible = false;
      avatar.add(entry);
      figures.set(key, entry);
    }
    return entry;
  }
  function show(pose, seat) { return showFigure(figure(pose, seat)); }
  function showFigure(next) {
    if (!next || next === shownFigure) return false;
    if (shownFigure) shownFigure.visible = false;
    next.visible = true;
    shownFigure = next;
    return true;
  }
  function clearFigures() {
    for (const entry of figures.values()) entry.userData.dispose();
    figures.clear();
    shownFigure = null; standFigure = null; strideFigure = null;
  }
  /** The two figures of the walk cycle, built ahead so that a step only switches which one is visible. */
  function prebuild() { standFigure = figure('stand'); strideFigure = rigOf(standFigure) ? null : figure('walk'); }
  /** Move the avatar (transform only) and its name tag. */
  function moveAvatar(x, y, z, ry) {
    avatar.position.set(x, y, z);
    avatar.rotation.y = ry;
    const top = y + (shownFigure?.userData.top ?? 2.95);
    if (driven && selfTag) { selfTag.position.x = x; selfTag.position.y = top; selfTag.position.z = z; }
    else selfTag = { id: 'self', name: view.name, kind: 'self', text: view.name, marker: 'crown', colour: '#ffd34d', position: { x, y: top, z } };
  }
  function placeMark(mark, x, y, z, visible) {
    if (!mark) return false;
    const changed = mark.visible !== visible || (visible && (mark.position.x !== x || mark.position.y !== y || mark.position.z !== z));
    mark.visible = visible;
    if (visible) mark.position.set(x, y, z);
    return changed;
  }
  /** The ring under the chosen spot, the lighter ring under a spot the avatar is near, and the tap-to-walk target. */
  function buildMarks() {
    const make = (name, draw) => {
      const batch = createBatch(THREE);
      draw(batch);
      const mesh = batch.build(shared.materials).meshes[0];
      mesh.name = `mark-${name}`; mesh.visible = false;
      group.add(mesh); markObjects.push(mesh);
      return mesh;
    };
    marks.ring = make('spot', (b) => { b.cyl(0, 0.12, 0, 0.82, 0.1, context.accent, { seg: 16, open: true, ...GLOW }); b.disc(0, 0.115, 0, 0.7, '#fff3c4', { seg: 16, ...GLOW }); });
    marks.near = make('near', (b) => { b.cyl(0, 0.13, 0, 1.02, 0.06, '#ffffff', { seg: 20, open: true, ...GLOW }); });
    marks.goal = make('goal', (b) => { b.cyl(0, 0.1, 0, 0.5, 0.05, '#ffffff', { seg: 14, open: true, ...GLOW }); b.disc(0, 0.09, 0, 0.16, '#ffffff', { seg: 10, ...GLOW }); });
  }
  /** Put the ring, the pose and — unless the host is walking the avatar itself — the avatar where the state says. */
  function settle() {
    const at = rest();
    placeMark(marks.ring, at.anchor.x, at.anchor.y, at.anchor.z, true);
    if (driven) return;
    show(at.pose, at.seat);
    moveAvatar(at.x, at.y, at.z, at.ry);
  }
  /** One of a peer's two figures (standing, walking): both are built when the player first appears, so easing builds nothing. */
  function peerFigure(peer, pose) {
    const figure = buildAvatar(kit, peer.look, { pose, seed: peer.seed, marker: 'player' });
    figure.visible = false;
    peer.group.add(figure);
    return figure;
  }
  function showPeer(peer, walking) {
    const next = walking ? peer.walk : peer.stand;
    if (peer.shown === next) return;
    if (peer.shown) peer.shown.visible = false;
    next.visible = true; peer.shown = next;
  }
  function placePeer(peer) {
    peer.y = walk.heightAt(peer.x, peer.z);
    peer.group.position.set(peer.x, peer.y, peer.z);
    peer.group.rotation.y = peer.ry;
    peer.tag.position.x = peer.x; peer.tag.position.y = peer.y + peer.top; peer.tag.position.z = peer.z;
    peer.at.x = peer.x; peer.at.z = peer.z; peer.at.top = peer.y + peer.top;
  }
  function dropPeer(peer) {
    peer.stand.userData.dispose(); peer.walk.userData.dispose();
    peer.group.parent?.remove(peer.group);
    peers.delete(peer.id);
  }
  /** A player with a reported position: make their figure, or send it on its way to the new place. */
  function syncPeer(person) {
    const id = String(person.id), lookKey = JSON.stringify([person.look ?? null, person.seed ?? id]);
    let peer = peers.get(id);
    if (peer && peer.lookKey !== lookKey) { dropPeer(peer); peer = null; }
    const name = String(person.name ?? '');
    if (!peer) {
      const holder = new THREE.Group();
      holder.name = 'peer';
      peer = { id, lookKey, look: person.look ?? null, seed: person.seed ?? id, group: holder, shown: null, x: person.x, z: person.z, y: 0, ry: Number.isFinite(person.ry) ? person.ry : Math.atan2(-person.x, -person.z) || 0,
        fromX: person.x, fromZ: person.z, toX: person.x, toZ: person.z, t: 1, span: 0, stride: 0, top: 2.95,
        tag: { id, name, kind: 'player', text: `@${name}`, marker: 'tag', colour: '#6fb4ff', position: { x: person.x, y: 2.95, z: person.z } },
        at: { id, kind: 'player', x: person.x, z: person.z, top: 2.95 } };
      peer.stand = peerFigure(peer, 'stand'); peer.walk = peerFigure(peer, 'walk');
      peer.top = peer.stand.userData.top ?? 2.95;
      showPeer(peer, false);
      group.add(holder);
      peers.set(id, peer);
      placePeer(peer);
      return peer;
    }
    if (peer.tag.name !== name) { peer.tag.name = name; peer.tag.text = `@${name}`; }
    const distance = Math.hypot(person.x - peer.toX, person.z - peer.toZ);
    if (distance < 0.01) return peer;
    peer.fromX = peer.x; peer.fromZ = peer.z; peer.toX = person.x; peer.toZ = person.z;
    const far = Math.hypot(peer.toX - peer.x, peer.toZ - peer.z);
    if (far > PEER_JUMP) { peer.x = peer.toX; peer.z = peer.toZ; peer.t = 1; showPeer(peer, false); placePeer(peer); return peer; }
    peer.span = Math.max(PEER_EASE[0], Math.min(PEER_EASE[1], far / PEER_PACE));
    peer.t = 0; easing = true;
    return peer;
  }
  /** Advance every figure that is on its way. Returns true while any still is; moves transforms only. */
  function stepCrowd(dt) {
    if (!easing) return false;
    let more = false;
    for (const peer of peers.values()) {
      if (peer.t >= 1) continue;
      peer.t = Math.min(1, peer.t + dt / peer.span);
      const dx = peer.toX - peer.fromX, dz = peer.toZ - peer.fromZ;
      peer.x = peer.fromX + dx * peer.t; peer.z = peer.fromZ + dz * peer.t;
      const turn = turnTowards(peer.ry, Math.atan2(dx, dz));
      peer.ry += Math.sign(turn) * Math.min(Math.abs(turn), 14 * dt);
      if (peer.ry > Math.PI) peer.ry -= Math.PI * 2; else if (peer.ry < -Math.PI) peer.ry += Math.PI * 2;
      peer.stride += dt * 6.5;
      if (peer.t < 1) { showPeer(peer, Math.floor(peer.stride) % 2 === 0); more = true; } else showPeer(peer, false);
      placePeer(peer);
    }
    easing = more;
    return more;
  }
  /** Put every figure where it is going, at once (reduced motion, or no frame loop). */
  function settleCrowd() {
    for (const peer of peers.values()) { if (peer.t >= 1) continue; peer.t = 1; peer.x = peer.toX; peer.z = peer.toZ; showPeer(peer, false); placePeer(peer); }
    easing = false;
  }
  function buildActors() {
    const placed = placeCrowd(view.crowd);
    const merged = placed.filter((person) => !person.live);
    // The merged batch holds NPCs and players without a reported position: rebuilt only when THEY change.
    const key = JSON.stringify(merged);
    if (key !== batchKey) {
      batchKey = key;
      releaseObjects(actorObjects);
      const batch = createBatch(THREE);
      mergedTags = drawCrowd(batch, merged);
      const built = batch.build(shared.materials);
      actorTriangles = built.triangles;
      for (const mesh of built.meshes) { mesh.name = `actors-${mesh.name}`; group.add(mesh); actorObjects.push(mesh); }
    }
    const kept = new Set();
    for (const person of placed) if (person.live) kept.add(syncPeer(person).id);
    for (const peer of [...peers.values()]) if (!kept.has(peer.id)) dropPeer(peer);
    // Tags and tap targets in the order the crowd was given.
    let next = 0;
    crowdTags = placed.map((person) => (person.live ? peers.get(String(person.id)).tag : mergedTags[next++])).filter(Boolean);
    peopleList = crowdTags.map((tag) => peers.get(tag.id)?.tag === tag ? peers.get(tag.id).at : { id: tag.id, kind: tag.kind, x: tag.position.x, z: tag.position.z, top: tag.position.y });
  }
  function applyLighting() {
    const preset = lightingFor(mood, view.time);
    shared.materials.glow.color.setScalar(preset.glow);
    for (const object of staticObjects) if (object.isPointLight) object.intensity = object.userData.intensity * preset.lamps;
    if (sky) paintSky(THREE, sky, preset.sky);
  }
  function realise() {
    if (live || disposed) return;
    const built = drawStatic().build(shared.materials);
    staticTriangles = built.triangles;
    for (const object of [...built.meshes, ...built.lights]) { group.add(object); staticObjects.push(object); if (object.userData.part && wallParts[object.userData.part]) wallParts[object.userData.part].push(object); }
    sky = skyDome(kit, shared.materials);
    group.add(sky);
    staticObjects.push(sky);
    buildGrid();
    group.add(avatar);
    buildMarks();
    prebuild();
    live = true;
    buildActors();
    settle();
    applyLighting();
  }
  function release() {
    for (const peer of [...peers.values()]) dropPeer(peer);
    easing = false; batchKey = null; peopleList = []; mergedTags = [];
    wallParts.wallBack.length = 0; wallParts.wallLeft.length = 0;
    releaseObjects(staticObjects);
    releaseObjects(actorObjects);
    releaseObjects(markObjects);
    marks.ring = null; marks.near = null; marks.goal = null;
    clearFigures();
    avatar.parent?.remove(avatar);
    sky = null;
    live = false;
  }
  /** The player's look changed: every pose figure is rebuilt (never while walking — a look changes in a sheet). */
  function redress() {
    if (!live) return;
    const pose = shownFigure ? [...figures.entries()].find(([, entry]) => entry === shownFigure)?.[0] : null;
    clearFigures();
    prebuild();
    if (driven && pose) { const [name, seat] = pose.split(':'); show(name, seat === '' ? undefined : Number(seat)); if (selfTag) selfTag.position.y = avatar.position.y + shownFigure.userData.top; }
  }

  const triangleCount = (object) => (object.geometry?.index ? object.geometry.index.count / 3 : 0);
  /**
   * WALKING (driven by the host, src/venue-world.js). Until the host calls walk.drive(true) the scene
   * stands the avatar at its spot by itself, exactly as before; once driven it only reports where
   * the avatar should be (rest()) and the host moves it there along the floor.
   */
  const walk = {
    get grid() { return grid; },
    get entrance() { return entrance; },
    get open() { return (Object.hasOwn(WALK, kind) ? WALK[kind] : WALK_DEFAULT).open !== false; },
    scale: 1,
    centre: [0, 0.7, 0],
    avatar,
    drive(on) { driven = Boolean(on); if (!driven && live) settle(); },
    rest,
    /** The spots the server knows, with where they are: [{ id, label, x, y, z, ry, approach }] (approach: the foot of the steps up to a raised spot, or null). */
    spots() { return spots.filter((spot) => spot && typeof spot.id === 'string').map((spot) => { const at = anchorFor(spot.id); return { id: spot.id, label: String(spot.label ?? spot.id), x: at.x, y: at.y, z: at.z, ry: at.ry, approach: at.approach || null, steps: at.steps || [] }; }); },
    /** People standing in the scene, for taps and for walking round them: [{ id, kind, x, z, top }]. The same objects until the crowd changes; a moving player's entry moves with them. */
    people() { return peopleList; },
    /** Boxes [x0, y0, z0, x1, y1, z1] of what can hide the avatar from the camera (camera-collision.js). */
    get solids() { return footprints?.solids || []; },
    move: moveAvatar,
    /** Resting pose ('stand', or the activity's pose) — builds that figure if it has not been needed yet. */
    pose(name, seat) { rigOf(standFigure)?.rest(); return show(name || 'stand', seat); },
    /**
     * The walk cycle. With a rigged figure (characters.js offering limb parts — see avatar-rig.js) the
     * standing figure's limbs swing with `phase`; without one the walking and the standing figure
     * alternate, one visible at a time. Either way no geometry is built.
     */
    gait(step, phase = 0, jog = false) {
      const rig = rigOf(standFigure);
      if (rig) { rig.stride(phase, 1, jog); return showFigure(standFigure); }
      return showFigure(step ? strideFigure : standFigure);
    },
    /**
     * How high the floor is at a place. A scene declares what can be stood on above the ground in
     * layout.raised (see deckHeight): a stage, a landing, a stair, a bridge. A raised spot nothing
     * was declared for still lifts the avatar as it steps on, in a small radius around it.
     */
    heightAt(x, z) {
      let height = deckHeight(x, z);
      for (const at of raised) {
        const share = 1 - (Math.hypot(x - at.x, z - at.z) - 0.3) / 1.6;
        if (share > 0) height = Math.max(height, at.y * Math.min(1, share));
      }
      return height;
    },
    near(spot) { return spot ? placeMark(marks.near, spot.x, spot.y, spot.z, true) : placeMark(marks.near, 0, 0, 0, false); },
    goal(x, z) { return Number.isFinite(x) ? placeMark(marks.goal, x, 0, z, true) : placeMark(marks.goal, 0, 0, 0, false); },
  };
  let raised = [];
  /**
   * layout.raised: what can be stood on above the ground, so the avatar walks UP it instead of
   * through it. Each shape gives the height of its top:
   *   { rect: [x0, z0, x1, z1], y, lip }   a stage or a landing; `lip` is how wide the step up around it is
   *   { disc: [x, z, radius], y, lip }     a round platform
   *   { ramp: [ax, az, ay, bx, bz, by], half, sag }   a stair or a bridge between two heights, `half` wide to each side
   */
  function deckHeight(x, z) {
    let height = 0;
    const shapes = layout?.raised;
    if (!shapes) return 0;
    for (let i = 0; i < shapes.length; i++) {
      const shape = shapes[i];
      let top = 0;
      if (shape.rect) {
        const [x0, z0, x1, z1] = shape.rect;
        const away = Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));
        top = away <= 0 ? shape.y : shape.lip > 0 && away < shape.lip ? shape.y * (1 - away / shape.lip) : 0;
      } else if (shape.disc) {
        const away = Math.hypot(x - shape.disc[0], z - shape.disc[1]) - shape.disc[2];
        top = away <= 0 ? shape.y : shape.lip > 0 && away < shape.lip ? shape.y * (1 - away / shape.lip) : 0;
      } else if (shape.ramp) {
        const [ax, az, ay, bx, bz, by] = shape.ramp, dx = bx - ax, dz = bz - az, span = dx * dx + dz * dz || 1;
        const t = ((x - ax) * dx + (z - az) * dz) / span;
        if (t < -0.02 || t > 1.02) continue;
        const k = Math.max(0, Math.min(1, t));
        if (Math.hypot(x - (ax + dx * k), z - (az + dz * k)) > (shape.half || 0.7)) continue;
        top = ay + (by - ay) * k - (shape.sag || 0) * 4 * k * (1 - k);
      }
      if (top > height) height = top;
    }
    return height;
  }
  function findRaised() {
    raised = [];
    // Only raised places no declared shape covers get the small ramp of their own.
    const lone = (x, y, z) => { if (y > 0.05 && deckHeight(x, z) < y - 0.2) raised.push({ x, y, z }); };
    for (const at of Object.values(resolved.anchors)) {
      lone(at.x, at.y, at.z);
      if (at.act) lone(at.act.x ?? at.x, at.act.y ?? at.y, at.act.z ?? at.z);
    }
  }

  const refresh = () => { if (live) settle(); return true; };
  const entry = {
    group, kind, mood, walk,
    camera: def.camera || SCENE_CAMERA,
    get background() { return lightingFor(mood, view.time).sky[0]; },
    get anchors() { return resolved.anchors; },
    get time() { return view.time; },
    get spot() { return view.spot; },
    lighting: () => lightingFor(mood, view.time),
    setTime(time) {
      if (!TIMES.includes(time) || time === view.time) return false;
      view.time = time;
      if (live) applyLighting();
      return true;
    },
    setSpot(id) {
      if (typeof id !== 'string' || id === view.spot) return false;
      anchorFor(id); findRaised();
      view.spot = id;
      return refresh();
    },
    setPlayer({ look, seed, pose, name } = {}) {
      let changed = false, dressed = false;
      if (look !== undefined) { const lookKey = JSON.stringify(look ?? null); if (lookKey !== view.lookKey) { view.look = look; view.lookKey = lookKey; changed = true; dressed = true; } }
      if (seed !== undefined && seed !== view.seed) { view.seed = seed; changed = true; dressed = true; }
      if (name !== undefined && name !== view.name) { view.name = String(name); changed = true; if (selfTag) { selfTag.name = view.name; selfTag.text = view.name; } }
      if (pose !== undefined) { const next = pose || 'stand', fixed = !!pose; if (next !== view.pose || fixed !== view.poseFixed) { view.pose = next; view.poseFixed = fixed; changed = true; } }
      if (dressed) redress();
      return changed ? refresh() : false;
    },
    setCrowd(people) {
      view.crowd = Array.isArray(people) ? people.filter((person) => person && typeof person === 'object') : [];
      if (live) buildActors(); else { crowdTags = []; peopleList = []; }
      return crowdTags;
    },
    /** True while another player's figure is on its way to a newly reported position. */
    get easing() { return easing; },
    stepCrowd, settleCrowd,
    /** The camera is at (x, z): hide whichever wall it has gone behind, with what hangs on it. */
    look(x, z) {
      const zone = footprints?.walls;
      if (!zone || !live) return false;
      let changed = false;
      const set = (meshes, shown) => { for (const mesh of meshes) if (mesh.visible !== shown) { mesh.visible = shown; changed = true; } };
      set(wallParts.wallBack, !(z < zone.backZ));
      set(wallParts.wallLeft, !(x < zone.leftX));
      return changed;
    },
    /** Which walls are showing right now: { back, left } (true = shown), or null for a scene without walls. */
    get walls() { return footprints?.walls ? { back: wallParts.wallBack.every((mesh) => mesh.visible), left: wallParts.wallLeft.every((mesh) => mesh.visible) } : null; },
    tags: () => (selfTag ? [selfTag, ...crowdTags] : [...crowdTags]),
    stats() {
      const meshes = [];
      group.traverseVisible((child) => { if (child.isMesh) meshes.push(child); });
      return {
        triangles: live ? meshes.reduce((sum, mesh) => sum + triangleCount(mesh), 0) : 0,
        meshes: meshes.length,
        drawCalls: meshes.length + meshes.filter((mesh) => mesh.castShadow).length,
        lights: group.children.filter((child) => child.isLight).length,
        geometries: meshes.length,
      };
    },
    /** Reflect the server state: Lagos time of day, the spot you stand at, your look, and whether you are busy. */
    update(state) {
      if (!state || typeof state !== 'object') return false;
      let changed = false, actors = false, dressed = false;
      if (!view.fixedTime && Number.isFinite(state.t)) {
        const time = timeOfDay(state.t);
        if (time !== view.time) { view.time = time; changed = true; }
      }
      const here = state.location == null || !venue?.id || state.location === venue.id;
      if (here && typeof state.spot === 'string' && state.spot !== view.spot) { anchorFor(state.spot); findRaised(); view.spot = state.spot; actors = true; }
      const look = state.onboarding?.look;
      if (look !== undefined) { const lookKey = JSON.stringify(look ?? null); if (lookKey !== view.lookKey) { view.look = look; view.lookKey = lookKey; actors = true; dressed = true; } }
      if (typeof state.name === 'string' && state.name && state.name !== view.name) { view.name = state.name; if (selfTag) selfTag = { ...selfTag, name: view.name, text: view.name }; }
      // A running activity uses the spot's own pose (anchor.act); on the way out the avatar is walking.
      if (!view.poseFixed) {
        const active = here ? state.activeAction : null;
        const pose = !active ? 'stand' : active.kind === 'travel' || active.kind === 'commute' ? 'walk' : 'busy';
        if (pose !== view.pose) { view.pose = pose; actors = true; }
      }
      if (live) { if (dressed) redress(); if (actors) settle(); if (changed) applyLighting(); }
      return changed || actors;
    },
    dispose() {
      if (disposed) return;
      release();
      disposed = true;
      shared.disposers.delete(entry.dispose);
      group.parent?.remove(group);
    },
  };
  shared.disposers.add(entry.dispose);
  realise();
  findRaised();
  return entry;
}

const builder = (kind, def, variant) => (kit, venue) => createEntry(kit, venue, def, kind, variant);
export const SCENES = Object.fromEntries([
  ...Object.entries(DEFS).map(([kind, def]) => [kind, builder(kind, def)]),
  ...Object.entries(ALIASES).map(([alias, [kind, variant]]) => [alias, builder(kind, DEFS[kind], variant)]),
]);

/** Build the scene for a venue; unknown or missing kinds get the generic plaza. */
export function buildVenueScene(kit, venue) {
  const kind = venue?.scene?.kind;
  return (Object.hasOwn(SCENES, kind) ? SCENES[kind] : SCENES.generic)(kit, venue);
}
