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
 * BATTERY RULE. Scenes are static: no requestAnimationFrame, timers or per-frame work, and a
 * scene never renders by itself. A venue is baked into a few merged meshes (src/scene/build.js);
 * state changes rebuild only the small "actors" batch (your avatar, the crowd, the spot ring)
 * and report true so the host draws exactly one frame. The host (src/venue-world.js) calls
 * dispose() when the player leaves the venue, which frees every geometry the scene made.
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
 *   stats()                     { triangles, meshes, drawCalls, lights, geometries }
 *   dispose()                   free everything and detach from the parent (the host calls it on
 *                               a location change and when it is disposed itself)
 */
import { createBatch, kitResources, releaseObjects, GLOW } from './build.js';
import { drawAvatar, drawCrowd } from './characters.js';
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
  const place = (landmark) => ({ x: landmark.x, y: landmark.y || 0, z: landmark.z, ry: landmark.ry || 0, landmark: landmark.key, act: landmark.act || null });
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
    return { x: x + ring * 0.9, y: 0, z: z + ring * 0.9, ry: 0, landmark: null, act: null };
  };
  for (const spot of pending) anchors[spot.id] = fallback();
  return { anchors, fallback, hint: (id) => (typeof hints[id] === 'string' && landmarks.find((landmark) => landmark.key === hints[id])) || null, place };
}

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
  let layout = null, resolved = null, live = false, disposed = false;
  const staticObjects = [], actorObjects = [];
  let staticTriangles = 0, actorTriangles = 0, crowdTags = [], selfTag = null, sky = null;

  function drawStatic() {
    const batch = createBatch(THREE);
    layout = def.build(batch, context) || {};
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
  function anchorFor(id) {
    if (id == null) return null;
    if (!resolved.anchors[id]) { const pinned = resolved.hint(id); resolved.anchors[id] = pinned ? resolved.place(pinned) : resolved.fallback(); }
    return resolved.anchors[id];
  }
  function placeCrowd(people) {
    const slots = layout.crowd, base = resolved.anchors.people || { x: 0, z: 3 };
    return people.slice(0, MAX_CROWD).map((person, index) => {
      if (Number.isFinite(person.x) && Number.isFinite(person.z)) return person;
      const at = person.spot != null && resolved.anchors[person.spot];
      if (at) {
        const turn = index * 2.4;
        // Far enough from the anchor that someone standing at it (you, perhaps) and this person do not overlap.
        const reach = 1.9, angle = turn + 0.9;
        return { ...person, x: at.x + Math.sin(angle) * reach, y: at.y, z: at.z + Math.cos(angle) * reach, ry: person.ry ?? angle + Math.PI };
      }
      if (index < slots.length) { const [x, z, ry = 0, y = 0] = slots[index]; return { ...person, x, y, z, ry: person.ry ?? ry }; }
      const turn = index * 2.4, radius = 1.6 + (index % 3) * 0.7;
      return { ...person, x: base.x + Math.sin(turn) * radius, z: base.z + Math.cos(turn) * radius, ry: person.ry ?? turn + Math.PI };
    });
  }
  function buildActors() {
    releaseObjects(actorObjects);
    const batch = createBatch(THREE);
    const anchor = anchorFor(view.spot) || { x: 0, y: 0, z: 3, ry: 0 };
    const acting = view.pose === 'busy' && !view.poseFixed && anchor.act ? anchor.act : null;
    const at = { x: acting?.x ?? anchor.x, y: acting?.y ?? anchor.y, z: acting?.z ?? anchor.z, ry: acting?.ry ?? anchor.ry };
    const pose = view.poseFixed ? view.pose : acting ? acting.pose || 'work' : view.pose === 'stand' || view.pose === 'walk' ? view.pose : 'work';
    batch.cyl(anchor.x, anchor.y + 0.12, anchor.z, 0.82, 0.1, context.accent, { seg: 16, open: true, ...GLOW });
    batch.disc(anchor.x, anchor.y + 0.115, anchor.z, 0.7, '#fff3c4', { seg: 16, ...GLOW });
    const drawn = drawAvatar(batch, view.look, { ...at, pose, seat: acting?.seat, seed: view.seed, marker: 'crown' });
    selfTag = { id: 'self', name: view.name, kind: 'self', text: view.name, marker: 'crown', colour: '#ffd34d', position: { x: at.x, y: drawn.top, z: at.z } };
    crowdTags = drawCrowd(batch, placeCrowd(view.crowd));
    const built = batch.build(shared.materials);
    actorTriangles = built.triangles;
    for (const mesh of built.meshes) { mesh.name = `actors-${mesh.name}`; group.add(mesh); actorObjects.push(mesh); }
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
    for (const object of [...built.meshes, ...built.lights]) { group.add(object); staticObjects.push(object); }
    sky = skyDome(kit, shared.materials);
    group.add(sky);
    staticObjects.push(sky);
    live = true;
    buildActors();
    applyLighting();
  }
  function release() {
    releaseObjects(staticObjects);
    releaseObjects(actorObjects);
    sky = null;
    live = false;
  }

  const refresh = () => { if (live) buildActors(); return true; };
  const entry = {
    group, kind, mood,
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
      anchorFor(id);
      view.spot = id;
      return refresh();
    },
    setPlayer({ look, seed, pose, name } = {}) {
      let changed = false;
      if (look !== undefined) { const lookKey = JSON.stringify(look ?? null); if (lookKey !== view.lookKey) { view.look = look; view.lookKey = lookKey; changed = true; } }
      if (seed !== undefined && seed !== view.seed) { view.seed = seed; changed = true; }
      if (name !== undefined && name !== view.name) { view.name = String(name); changed = true; }
      if (pose !== undefined) { const next = pose || 'stand', fixed = !!pose; if (next !== view.pose || fixed !== view.poseFixed) { view.pose = next; view.poseFixed = fixed; changed = true; } }
      return changed ? refresh() : false;
    },
    setCrowd(people) {
      view.crowd = Array.isArray(people) ? people.filter((person) => person && typeof person === 'object') : [];
      if (live) buildActors(); else crowdTags = [];
      return crowdTags;
    },
    tags: () => (selfTag ? [selfTag, ...crowdTags] : [...crowdTags]),
    stats() {
      const meshes = group.children.filter((child) => child.isMesh);
      return {
        triangles: live ? staticTriangles + actorTriangles + sky.geometry.index.count / 3 : 0,
        meshes: meshes.length,
        drawCalls: meshes.length + meshes.filter((mesh) => mesh.castShadow).length,
        lights: group.children.filter((child) => child.isLight).length,
        geometries: meshes.length,
      };
    },
    /** Reflect the server state: Lagos time of day, the spot you stand at, your look, and whether you are busy. */
    update(state) {
      if (!state || typeof state !== 'object') return false;
      let changed = false, actors = false;
      if (!view.fixedTime && Number.isFinite(state.t)) {
        const time = timeOfDay(state.t);
        if (time !== view.time) { view.time = time; changed = true; }
      }
      const here = state.location == null || !venue?.id || state.location === venue.id;
      if (here && typeof state.spot === 'string' && state.spot !== view.spot) { anchorFor(state.spot); view.spot = state.spot; actors = true; }
      const look = state.onboarding?.look;
      if (look !== undefined) { const lookKey = JSON.stringify(look ?? null); if (lookKey !== view.lookKey) { view.look = look; view.lookKey = lookKey; actors = true; } }
      if (typeof state.name === 'string' && state.name && state.name !== view.name) { view.name = state.name; if (selfTag) selfTag = { ...selfTag, name: view.name, text: view.name }; }
      // A running activity uses the spot's own pose (anchor.act); on the way out the avatar is walking.
      if (!view.poseFixed) {
        const active = here ? state.activeAction : null;
        const pose = !active ? 'stand' : active.kind === 'travel' || active.kind === 'commute' ? 'walk' : 'busy';
        if (pose !== view.pose) { view.pose = pose; actors = true; }
      }
      if (live) { if (actors) buildActors(); if (changed) applyLighting(); }
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
