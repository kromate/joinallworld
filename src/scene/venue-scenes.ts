/**
 * OWNER: scenes
 * One procedural scene per `scene.kind` declared in src/game/content/venues.ts.
 *
 * SCENES[kind] = (kit, venue) => ({
 *   group,                      // THREE.Group holding everything for this venue
 *   background,                 // clear colour for the current time of day
 *   camera: { landscape: [x, y, z], portrait: [x, y, z] },
 *   update(state) → boolean,    // reflect game state; true if anything changed (host draws one frame)
 *   ...the extensions below
 * })
 * Ibadan kinds: quad (a university court with a clock tower), hilltop (a tower terrace over the city's roofs), lakeside (a reservoir shore with a jetty); built in src/scene/venues-ibadan-a.ts.
 * A CITY'S OWN SCENES — those three kinds and every scene asked for through `scene.variant` that is a scene of its own — are not part
 * of this file's download: src/scene/city-scenes.ts fetches them per city, and buildVenueScene throws for a city whose scenes have
 * not arrived (the caller awaits loadCityScenes(cityId) first).
 * Kinds: park, buka, hub, club, office, market, gym, mall, beach, hospital, salon, rooftop,
 * police, worship, radio, polling, viewing, shrine, walk, statehouse, airport, refinery — plus `library` (the
 * speakeasy variant of club) and `generic`, the fallback for unknown kinds. `home` belongs to
 * src/scene/home-scene.ts.
 *
 * venue.scene options: { kind, variant, palette (accent colour), time ('day' | 'dusk' | 'night',
 * fixes the lighting; otherwise it follows Lagos time from state.t), spots: [{ id, label }]
 * (defaults to the venue's own spots), look, seed }.
 *
 * venue.scene.anchors: { [spotId]: landmarkKey } pins a spot to one of the scene's landmarks;
 * spots without a hint are matched by their id and label, and only then take what is left.
 *
 * BATTERY RULE. Scenes are static: no frame callbacks, timers or per-frame work, and a scene
 * never renders by itself. A venue is baked into a few merged meshes (src/scene/build.ts); a
 * crowd change rebuilds only the small "actors" batch and reports true so the host draws exactly
 * one frame. The player's avatar, the spot ring and the walking marks are separate, prebuilt
 * objects that are only ever MOVED (position, rotation, visibility) — walking builds no geometry.
 * The host (src/venue-world.ts) calls dispose() when the player leaves the venue, which frees
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
 *                               goal(x, z), solids } — see WALK below and src/scene/movement.ts
 *   walk.things()               what else can be walked up to and tapped: the game tables that stand in this venue
 *                               (TABLES below) — [{ id: 'table:<id>', kind: 'table', x, z, top, r, label }], fixed for the scene
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
import type * as THREE from 'three';
import { createBatch, kitResources, releaseObjects, GLOW } from './build.ts';
import type { Releasable } from './build.ts';
import type { Kit } from './kit.ts';
import type { AvatarGroup, Pose } from './characters.ts';
import type { FootprintRecorder, FootprintShapes, WalkGrid, WalkRect, WalkShape } from './movement.ts';
import type {
  Anchor, Batch, Colour, CrowdPerson, Landmark, SceneOptions, Lighting, RaisedShape, SceneBuilder, SceneCamera, SceneContext, SceneDef, SceneEntrance, SceneEntry,
  SceneLayout, SceneMaterials, ScenePerson, SceneRest, SceneSpot, SceneState, SceneTag, SceneThing, SceneVenue, SceneWalk, PlayerOptions, ThreeModule, TimeOfDay, Vec3, WalkSpot,
} from './types.ts';
import { buildAvatar, drawCrowd } from './characters.ts';
import { avatarProportions } from '../types/avatar.ts';
import { normalizeLook } from './characters.ts';
import { bodyAllowed, drawsWebGL2 } from './body/gate.ts';
import type { SkinnedBody } from './body/skinned.ts';
import { createCanonicalCrowd, type CanonicalCrowdSpec } from './body/canonical-crowd.ts';
import type { NativeExpressionController } from './body/native/native-expression-controller.ts';
import { playerOptions, rigOf, lookAvatar } from './avatar-rig.ts';
import { createWalkGrid, footprintRecorder, turnTowards } from './movement.ts';
import { FIGURE_GAP, gapFor, tieOf, newGaze, stepGaze, watch, gazing } from './space.ts';
import type { GazeState } from './space.ts';
import { spotMarker, gameTable } from './props.ts';
import { tablesAt, GAME_LABELS } from '../tables/city-places.ts';
import { CITY_RULES, DEFAULT_CITY_ID } from '../game/cities/registry.ts';
import { CLEAR_LOOK, adjustLighting, lookAt, lookKey } from '../game/conditions/look.ts';
import type { LookConditions } from '../game/conditions/look.ts';
import { isTimeOfDay as isTime, timeOfDay, lightingFor } from './lighting.ts';
import * as outdoor from './venues-outdoor.ts';
import * as social from './venues-social.ts';
import * as work from './venues-work.ts';
import * as civic from './venues-civic.ts';
import * as transport from './venues-transport.ts';
import { CITY_KINDS, citySceneDef, cityScenesReady, parametricSceneAdapter } from './city-scenes.ts';

export const DEFAULT_CAMERA: SceneCamera = { landscape: [16, 21, 27], portrait: [13, 24, 31] };
const SCENE_CAMERA: SceneCamera = { landscape: [15, 19.8, 25.4], portrait: [16.5, 29.5, 38.5] };
export { TIMES, LIGHTING, timeOfDay, lightingFor } from './lighting.ts';
export const MAX_CROWD = 12;
/** Initial authored NPC allowance; public crowd population remains unchanged. */
export const MAX_NATIVE_NPCS = 2;

/** The kinds every city draws with. A kind a city added (CITY_KINDS) arrives with that city's scenes. */
const DEFS: Record<string, SceneDef> = { ...outdoor.SCENES, ...social.SCENES, ...work.SCENES, ...civic.SCENES, ...transport.SCENES };
/** Kinds that are another kind with a default variant. */
const ALIASES: Record<string, [string, string]> = { library: ['club', 'speakeasy'], church: ['worship', 'church'], mosque: ['worship', 'mosque'] };
export const KINDS = Object.freeze([...Object.keys(DEFS).filter((kind) => kind !== 'generic'), ...Object.keys(CITY_KINDS)]);

/** The scene materials plus the sky's, made once per kit by the first scene. */
type SkyMaterials = SceneMaterials & { sky?: THREE.MeshBasicMaterial };

function skyDome(kit: Kit, materials: SkyMaterials) {
  const { THREE } = kit;
  const geometry = new THREE.SphereGeometry(170, 16, 8);
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position!.count * 3), 3));
  const mesh = new THREE.Mesh(geometry, materials.sky);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}
function paintSky(THREE: ThreeModule, mesh: THREE.Mesh, [horizon, zenith]: [Colour, Colour]) {
  const low = new THREE.Color(horizon), high = new THREE.Color(zenith), mix = new THREE.Color();
  const { position, color } = mesh.geometry.attributes as Record<'position' | 'color', THREE.BufferAttribute>;
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
interface Resolved { anchors: Record<string, Anchor>; fallback(): Anchor; hint(id: string): Landmark | null; place(landmark: Landmark): Anchor }
type Point = { x: number; z: number };
const present = (point: Point | null): point is Point => point !== null;
function resolveAnchors(landmarks: Landmark[], spots: SceneSpot[], spare: [number, number][], hints: Record<string, string> = {}): Resolved {
  const anchors: Record<string, Anchor> = {}, used = new Set<string>();
  // approach on a landmark is the way up to a raised place: [x, z] — the foot of its steps, where the avatar leaves the
  // floor — or a chain [[x, z], ...] whose first point is on the floor and whose others are the way up (a stair top, a platform).
  const place = (landmark: Landmark): Anchor => {
    const pair = (value: unknown): Point | null => (Array.isArray(value) && Number.isFinite(value[0]) && Number.isFinite(value[1]) ? { x: value[0], z: value[1] } : null);
    const chain = Array.isArray(landmark.approach) ? (Array.isArray(landmark.approach[0]) ? landmark.approach.map(pair).filter(present) : [pair(landmark.approach)].filter(present)) : [];
    return { x: landmark.x, y: landmark.y || 0, z: landmark.z, ry: landmark.ry || 0, landmark: landmark.key, act: landmark.act || null, approach: chain[0] || null, steps: chain.slice(1) };
  };
  for (const landmark of landmarks) anchors[landmark.key] = place(landmark);
  const pending: SceneSpot[] = [], unhinted: SceneSpot[] = [];
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
  const fallback = (): Anchor => {
    const free = landmarks.find((landmark) => !used.has(landmark.key));
    if (free) { used.add(free.key); return place(free); }
    const [x, z] = spare[spareIndex % spare.length]!;
    const ring = Math.floor(spareIndex / spare.length);
    spareIndex += 1;
    return { x: x + ring * 0.9, y: 0, z: z + ring * 0.9, ry: 0, landmark: null, act: null, approach: null, steps: [] };
  };
  for (const spot of pending) anchors[spot.id] = fallback();
  return { anchors, fallback, hint: (id: string) => (typeof hints[id] === 'string' && landmarks.find((landmark) => landmark.key === hints[id])) || null, place };
}

/**
 * WALKABLE DESCRIPTION per scene kind (see src/scene/movement.ts). Every kind has one; an unknown
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
export interface WalkSpec {
  bounds: Readonly<WalkRect> | null;
  entrance: readonly [number, number] | null;
  open: boolean;
  block?: WalkShape[];
  clear?: WalkShape[];
}
const GROUND = Object.freeze([-14.2, -12.2, 14.2, 12.2]) as Readonly<WalkRect>, FLOOR = Object.freeze([-11.5, -9.5, 11.5, 9.5]) as Readonly<WalkRect>;
const outdoors = (more?: Partial<WalkSpec>): Readonly<WalkSpec> => Object.freeze({ bounds: GROUND, entrance: [0, 11.4] as const, open: true, ...more });
const indoors = (more?: Partial<WalkSpec>): Readonly<WalkSpec> => Object.freeze({ bounds: FLOOR, entrance: [0, 8.8] as const, open: false, ...more });
export const WALK_DEFAULT: Readonly<WalkSpec> = Object.freeze({ bounds: null, entrance: null, open: true });
export const WALK: Readonly<Record<string, Readonly<WalkSpec>>> = Object.freeze({
  park: outdoors(), market: outdoors(), beach: outdoors({ entrance: [0, 11.2] }), polling: outdoors(), walk: outdoors(), statehouse: outdoors(),
  rooftop: outdoors({ bounds: [-10.4, -8.4, 10.4, 8.4], entrance: [0, 7.6] }),
  generic: outdoors({ bounds: [-13.2, -11.2, 13.2, 11.2], entrance: [0, 10.4] }),
  buka: indoors(), club: indoors(), viewing: indoors(), shrine: indoors(), mall: indoors(), hub: indoors(), office: indoors(),
  gym: indoors(), salon: indoors(), radio: indoors(), hospital: indoors(), police: indoors(), worship: indoors(),
  airport: indoors(), refinery: outdoors(),
  quad: outdoors(),
  hilltop: outdoors({ bounds: [-12.4, -3.4, 12.4, 11.2], entrance: [0, 10.6] }),
  lakeside: outdoors({ bounds: [-13.4, -9.6, 13.4, 11.4], entrance: [0, 10.6], clear: [[3.7, -9.7, 5.5, -1.2]] }),
});
/**
 * GAME TABLES IN THE SCENE. Every table of src/tables/places.ts stands in its venue: a visible table (props.js gameTable)
 * on free floor, solid like any furniture (its footprint is recorded with the rest), listed in walk.things() so the host
 * can walk the avatar up to it and open it. WHERE: `venue.scene.anchors['table:<id>']` may pin a table to one of the
 * scene's landmarks; otherwise it takes the first of its preferred places below ([x, z], tried in order: the table's own, then the scene kind's) that is
 * free — clear of every wall, prop, spot marker and the ground in front of one, of the entrance and of the other tables —
 * and, failing those, the nearest free place found in widening rings. The places are checked in src/scene/scenes.test.ts
 * for every table of every venue: free floor around it, a way to it from the entrance, no marker covered.
 */
export const TABLE_PLACES: Readonly<Record<string, readonly (readonly [number, number])[]>> = Object.freeze({
  // By table id (src/tables/places.ts): where that table belongs in its room — the goal by the pitch, the corner table in the corner.
  'buka-corner': [[-7.4, 5.2], [7.6, 4.6]], 'buka-door': [[-3.2, 6.2], [4.4, 5.6], [-8.6, 0.9]],
  'park-bench': [[9.7, 2.9], [9.6, 6.4]], 'park-goal': [[-9.6, 1.8], [-10.6, 0.4]],
  'rooftop-lounge': [[0.5, -1.5], [6.6, 3.6]],
  'viewing-whot': [[-4.6, 6.6], [-7.0, 7.3]], 'viewing-goal': [[9.0, 4.6], [4.9, 7.0]],
  'beach-goal': [[9.6, 5.6], [-9.6, 6.2]],
  // By scene kind: for a table added later, before it is given a place of its own.
  buka: [[7.6, 4.6], [-7.4, 5.2], [7.8, -1.4], [-7.6, 0.6]],
  park: [[9.6, 6.4], [-9.8, 6.8], [10.4, -1.6], [-10.6, 0.4]],
  rooftop: [[6.6, 3.6], [-6.8, 4.0], [6.8, -2.2]],
  viewing: [[7.8, 5.0], [-7.6, 5.4], [8.0, 0.2], [-7.8, 0.8]],
  beach: [[9.4, 5.8], [-9.6, 6.2], [10.2, -0.6]],
  // Ibadan tables (src/game/cities/ibadan/content.ts): the garden's ayo table on the lawn, the stadium's penalty spot on the apron.
  'ibadan-agodi-ayo': [[-2.6, 3.8], [8, 6.4]], 'ibadan-stadium-penalty': [[-6.4, 9], [6.2, 9.4]],
  quad: [[-3.8, 6.8], [10, 2.6], [-9.6, 8.4]],
  hilltop: [[6.6, 6], [-9, 5.6], [-1.4, 8.6]],
  lakeside: [[-5.8, 4], [8.6, 6.4], [-9.4, 8.4]],
});
const TABLE_FALLBACK: readonly (readonly [number, number])[] = Object.freeze([[7.5, 4.5], [-7.5, 4.5], [7.5, -1], [-7.5, -1], [0, 5]]);
/** A table's clear ground: nothing else within this radius of its centre (it is 0.9 across, with stools to 1.6). */
export const TABLE_CLEAR = 1.9, TABLE_REACH = 2.5;

/** How far from a spot's anchor the avatar counts as standing at it. */
export const SPOT_REACH = 1.5;
/**
 * The ground a placed figure keeps off, around each spot marker: SPOT_BEHIND units beyond it,
 * SPOT_FRONT units towards the scene's own camera (a figure standing there would cover the marker
 * on screen — a person is 2.45 tall), SPOT_SIDE to either side.
 */
export const SPOT_BEHIND = 1.3, SPOT_FRONT = 3.4, SPOT_SIDE = 1.7;
/** A rendered, horizontal triangle in venue-local space. */
interface ContactTriangle { ax: number; az: number; bx: number; bz: number; cx: number; cz: number; y: number }
const CONTACT_CELL = 1, CONTACT_TOP_EPSILON = 0.004, CONTACT_EDGE_MARGIN = 0.16;
interface ContactSurfaceQuery {
  (x: number, z: number, minY: number, maxY: number, exactY?: number): number | null;
  readonly retainedTriangles: number;
  readonly cellEntries: number;
  readonly broadTriangles: number;
}

/** Index only actual upward-facing solid triangles; the walk description alone is not floor provenance. */
function contactSurfaceIndex(meshes: readonly THREE.Mesh[], deckHeights: readonly number[]): ContactSurfaceQuery {
  const cells = new Map<string, ContactTriangle[]>();
  const broad: ContactTriangle[] = [];
  let retainedTriangles = 0, cellEntries = 0;
  const key = (x: number, z: number) => `${Math.floor(x / CONTACT_CELL)},${Math.floor(z / CONTACT_CELL)}`;
  const insert = (triangle: ContactTriangle) => {
    const x0 = Math.floor(Math.min(triangle.ax, triangle.bx, triangle.cx) / CONTACT_CELL);
    const x1 = Math.floor(Math.max(triangle.ax, triangle.bx, triangle.cx) / CONTACT_CELL);
    const z0 = Math.floor(Math.min(triangle.az, triangle.bz, triangle.cz) / CONTACT_CELL);
    const z1 = Math.floor(Math.max(triangle.az, triangle.bz, triangle.cz) / CONTACT_CELL);
    const entries = (x1 - x0 + 1) * (z1 - z0 + 1);
    retainedTriangles++;
    // A ground slab can cover hundreds of cells; keep a few such triangles once and test
    // them from a short fallback list instead of duplicating them into every cell bucket.
    if (entries > 64) { broad.push(triangle); return; }
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const cell = key(x * CONTACT_CELL, z * CONTACT_CELL), list = cells.get(cell);
      if (list) list.push(triangle); else cells.set(cell, [triangle]);
      cellEntries++;
    }
  };
  for (const mesh of meshes) {
    if (mesh.name !== 'solid' && !mesh.name.startsWith('solid@')) continue;
    const geometry = mesh.geometry, position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal'), index = geometry.index;
    if (!position || !normal) continue;
    const count = index?.count ?? position.count;
    for (let i = 0; i + 2 < count; i += 3) {
      const ia = index ? index.getX(i) : i, ib = index ? index.getX(i + 1) : i + 1, ic = index ? index.getX(i + 2) : i + 2;
      if (normal.getY(ia) < 0.999 || normal.getY(ib) < 0.999 || normal.getY(ic) < 0.999) continue;
      const ax = position.getX(ia), ay = position.getY(ia), az = position.getZ(ia);
      const bx = position.getX(ib), by = position.getY(ib), bz = position.getZ(ib);
      const cx = position.getX(ic), cy = position.getY(ic), cz = position.getZ(ic);
      if (Math.max(ay, by, cy) - Math.min(ay, by, cy) > CONTACT_TOP_EPSILON) continue;
      const y = (ay + by + cy) / 3;
      // Retain only the recorded ground band and explicitly declared deck planes, so table,
      // seat, roof, and foliage tops never enter the support query.
      if (!(y >= -0.06 && y <= 0.08) && !deckHeights.some((height) => Math.abs(y - height) <= CONTACT_TOP_EPSILON)) continue;
      const area = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
      if (Math.abs(area) < 1e-7) continue;
      insert({ ax, az, bx, bz, cx, cz, y });
    }
  }
  const query = (x: number, z: number, minY: number, maxY: number, exactY?: number) => {
    const candidates = cells.get(key(x, z));
    let highest = -Infinity;
    const test = (triangle: ContactTriangle) => {
      if (triangle.y < minY || triangle.y > maxY || (exactY !== undefined && Math.abs(triangle.y - exactY) > CONTACT_TOP_EPSILON)) return;
      const area = (triangle.bx - triangle.ax) * (triangle.cz - triangle.az) - (triangle.bz - triangle.az) * (triangle.cx - triangle.ax);
      const u = ((triangle.bx - x) * (triangle.cz - z) - (triangle.bz - z) * (triangle.cx - x)) / area;
      const v = ((triangle.cx - x) * (triangle.az - z) - (triangle.cz - z) * (triangle.ax - x)) / area;
      const w = 1 - u - v;
      if (u >= -1e-5 && v >= -1e-5 && w >= -1e-5) highest = Math.max(highest, triangle.y);
    };
    for (const triangle of candidates ?? []) test(triangle);
    for (const triangle of broad) test(triangle);
    return Number.isFinite(highest) ? highest : null;
  };
  return Object.assign(query, { retainedTriangles, cellEntries, broadTriangles: broad.length });
}

function raisedContactTop(shapes: readonly RaisedShape[] | undefined, x: number, z: number): number | null | undefined {
  if (!shapes?.length) return undefined;
  let top: number | undefined, atUnsafeEdge = false;
  for (const shape of shapes) {
    if (shape.ramp) {
      const [ax, az, , bx, bz] = shape.ramp, dx = bx - ax, dz = bz - az, span = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / span));
      if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) <= Math.max(0, shape.half ?? 0.7) + CONTACT_EDGE_MARGIN) return null;
      continue;
    }
    if (!Number.isFinite(shape.y)) continue;
    if (shape.rect) {
      const [x0, z0, x1, z1] = shape.rect, lip = Math.max(0, shape.lip ?? 0);
      const safe = x > x0 + CONTACT_EDGE_MARGIN && x < x1 - CONTACT_EDGE_MARGIN && z > z0 + CONTACT_EDGE_MARGIN && z < z1 - CONTACT_EDGE_MARGIN;
      const inTransition = x >= x0 - lip && x <= x1 + lip && z >= z0 - lip && z <= z1 + lip;
      if (safe) top = Math.max(top ?? -Infinity, shape.y!);
      else if (inTransition) atUnsafeEdge = true;
    } else if (shape.disc) {
      const distance = Math.hypot(x - shape.disc[0], z - shape.disc[1]), radius = shape.disc[2], lip = Math.max(0, shape.lip ?? 0);
      if (distance < radius - CONTACT_EDGE_MARGIN) top = Math.max(top ?? -Infinity, shape.y!);
      else if (distance <= radius + lip) atUnsafeEdge = true;
    }
  }
  return atUnsafeEdge ? null : top;
}


/** How long another player's figure takes to ease to a newly reported position (seconds), and the jump beyond which it is simply placed. */
const PEER_EASE: [number, number] = [0.16, 0.42], PEER_JUMP = 7, PEER_PACE = 6;

/** One other player's figure: a standing and a walking pose, eased between reported positions. */
interface Peer {
  id: string; lookKey: string; look: unknown; seed: unknown; group: THREE.Group; shown: AvatarGroup | null;
  x: number; z: number; y: number; ry: number; fromX: number; fromZ: number; toX: number; toZ: number;
  t: number; span: number; stride: number; top: number; tag: SceneTag; at: ScenePerson; stand: AvatarGroup; walk: AvatarGroup;
  friend: boolean; gaze: GazeState;
}
/** Who a placed figure is to the others (src/scene/space.ts tieOf). */
interface Tied { spot?: string | null; friend?: boolean }
type Placed = Point & Tied
/** A crowd person with a reported position. */
type LivePerson = CrowdPerson & { x: number; z: number };
interface CanonicalVenueActor { readonly body: SkinnedBody; readonly talk: NativeExpressionController; dispose(): void }
interface View {
  time: TimeOfDay; fixedTime: boolean; spot: string | null; look: unknown; lookKey: string; seed: unknown; name: string;
  pose: string; poseFixed: boolean; crowd: CrowdPerson[];
  /** The city's conditions at this place now (a power cut, the season): they change how the light looks. */
  weather: LookConditions;
}

function createEntry(kit: Kit, venue: SceneVenue | null | undefined, wanted: string, defaultVariant?: string, cityId: string = DEFAULT_CITY_ID, drawnAs: string = cityId): SceneEntry {
  // drawnAs: the city whose own scenes are looked up (the venue's city; a bare kind that a city added is drawn as that city's).
  if (!cityScenesReady(drawnAs)) throw new Error(`The scenes of ${drawnAs} have not been loaded`);
  const { THREE } = kit;
  const shared = kitResources(kit);
  const materials: SkyMaterials = shared.materials;
  if (!materials.sky) materials.sky = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false });
  const options: SceneOptions = venue?.scene && typeof venue.scene === 'object' ? venue.scene : {};
  const parametric = options.design ? parametricSceneAdapter() : null;
  if (options.design && !parametric) throw new Error('Parametric venue scenes have not been loaded');
  // A venue may ask for a variant that is a scene of its own city (venues-ibadan-b.ts); the kind's walkable description then yields to the variant's.
  // A kind neither shared nor this city's is the generic plaza.
  const variantKey = typeof options.variant === 'string' ? options.variant : defaultVariant ?? '';
  const own = citySceneDef(drawnAs, wanted, variantKey) ?? (Object.hasOwn(DEFS, wanted) ? DEFS[wanted] : null);
  const kind = own ? wanted : 'generic', found = own ?? DEFS.generic;
  if (!found) throw new TypeError(`No scene builder for ${kind}`);
  const def: SceneDef = found;
  const walkSpec = (): Readonly<WalkSpec> => def.walk ?? (Object.hasOwn(WALK, kind) ? WALK[kind] : WALK_DEFAULT)!;
  const spots: SceneSpot[] = Array.isArray(options.spots) ? options.spots : Object.values(venue?.spots || {});
  const context: SceneContext = {
    kind, venue, spots,
    variant: typeof options.variant === 'string' ? options.variant : defaultVariant || null,
    accent: options.design?.palette.accent ?? (typeof options.palette === 'string' && /^#[0-9a-f]{6}$/i.test(options.palette) ? options.palette : def.accent || '#e0a43a'),
    label: String(venue?.label || kind),
    cityId,
  };
  const mood = (typeof def.mood === 'function' ? def.mood(context) : def.mood) || 'outdoor';
  const group = new THREE.Group();
  group.name = `venue:${kind}`;

  const view: View = {
    time: isTime(options.time) ? options.time : 'day',
    fixedTime: isTime(options.time),
    spot: null, look: options.look ?? null, lookKey: JSON.stringify(options.look ?? null), seed: options.seed ?? 'you', name: 'You',
    pose: 'stand', poseFixed: false, crowd: [], weather: CLEAR_LOOK,
  };
  /** The preset in use: the mood's light for this time of day, as the city's conditions leave it. */
  const lit = (): Lighting => adjustLighting(lightingFor(mood, view.time), view.weather);
  const hints: Record<string, string> = options.anchors && typeof options.anchors === 'object' ? options.anchors : {};
  let layout: SceneLayout | null = null, resolved: Resolved | null = null, live = false, disposed = false, footprints: FootprintShapes | null = null, grid: WalkGrid | null = null, entrance: SceneEntrance | null = null;
  let renderedContactTop: ReturnType<typeof contactSurfaceIndex> | null = null;
  const staticObjects: Releasable[] = [], actorObjects: Releasable[] = [], markObjects: Releasable[] = [];
  let staticTriangles = 0, actorTriangles = 0, crowdTags: SceneTag[] = [], selfTag: SceneTag | null = null, sky: THREE.Mesh | null = null;
  // Other players who report where they stand: one figure each, eased to every new position.
  const peers = new Map<string, Peer>();
  let peopleList: ScenePerson[] = [], mergedTags: SceneTag[] = [], batchKey: string | null = null, easing = false;
  let activeNpcActivity: string | null = null;
  function nativeNpcPose(id: string): 'idle' | 'interact' {
    return id.startsWith('npc:') && activeNpcActivity?.startsWith(`npc-${id.slice(4)}-`) ? 'interact' : 'idle';
  }
  function syncNativeTalk(actor: CanonicalVenueActor, pose: 'idle' | 'interact') {
    const active = actor.talk.snapshot().active;
    if (pose === 'interact' && !active) actor.talk.startTalk();
    else if (pose === 'idle' && active) actor.talk.stop();
  }
  let placedCrowd: CrowdPerson[] = [], notifyCrowdChanged: (() => void) | null = null, crowdGateRejected = false;
  const canonicalCrowd = createCanonicalCrowd<CanonicalVenueActor>({
    async load(spec) {
      // Keep the provider and its model/clip dependencies behind the first-frame capability gate.
      const { loadGameBody } = await import('./body/provider.ts');
      const body = await loadGameBody(kit, spec.look, spec.seed, spec.scale, { scene: 'venue', role: 'npc', poses: ['idle', 'walk', 'interact'] });
      const preparedNative = 'preparedMetrics' in body;
      body.object.userData.nativeGameProviderEvidence = {
        role: 'npc', preparedNative, representation: preparedNative ? 'native-prepared' : 'legacy-fallback',
        requestedLifecyclePoses: ['idle', 'walk', 'interact'],
      };
      let talk: NativeExpressionController;
      try {
        // Expression code stays behind the same renderer-gated, demand-loaded NPC path as its body.
        const { createNativeExpressionController } = await import('./body/native/native-expression-controller.ts');
        talk = createNativeExpressionController(body.object);
      }
      catch (error) { body.object.removeFromParent(); body.dispose(); throw error; }
      return { body, talk, dispose() { talk.dispose(); body.object.removeFromParent(); body.dispose(); } };
    },
    place(actor, spec) {
      actor.body.fit(spec.scale);
      const pose = nativeNpcPose(spec.id);
      actor.body.show(pose, false);
      actor.body.place(spec.x, spec.y, spec.z, spec.ry);
      actor.body.object.userData.nativeGameNpcPose = pose;
      syncNativeTalk(actor, pose);
    },
    mount(actor, id) {
      actor.body.object.name = `canonical-crowd:${id}`;
      group.add(actor.body.object);
      solveNativeNpcFeetOnVenueFloor(actor);
    },
    changed() {
      rebuildActorBatch();
      notifyCrowdChanged?.();
    },
    failed(id, error) { console.warn(`Canonical crowd actor ${id} unavailable; keeping its procedural figure:`, error); },
    yieldBetweenActors: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  });
  const wallParts: Record<'wallBack' | 'wallLeft', THREE.Object3D[]> = { wallBack: [], wallLeft: [] };
  const sceneCamera = def.camera || SCENE_CAMERA;
  // The ground direction from the scene's centre towards its own camera: "in front of" a marker.
  const toCamera = (() => { const [cx, , cz] = sceneCamera.landscape, size = Math.hypot(cx, cz) || 1; return { x: cx / size, z: cz / size }; })();
  // The player's avatar is its own group, moved by its transform only: one prebuilt figure per pose.
  const avatar = new THREE.Group();
  avatar.name = 'avatar';
  const figures = new Map<string, AvatarGroup>();
  let shownFigure: AvatarGroup | null = null, standFigure: AvatarGroup | null = null, strideFigure: AvatarGroup | null = null, driven = false;
  const marks: Record<'ring' | 'near' | 'goal', THREE.Mesh | null> = { ring: null, near: null, goal: null };
  /** The game tables that stand here: [{ id, kind: 'table', table, game, x, z, top, r, label }] (see TABLE_PLACES). */
  const tableList: SceneThing[] = [];

  function drawStatic() {
    const recorder = footprintRecorder(createBatch(THREE));
    const batch = recorder.batch;
    const neutralWorship = options.design && wanted === 'worship' && !options.variant;
    layout = ((neutralWorship && parametric ? parametric.buildQuietParametricWorship(batch, context) : def.build(batch, context)) || {}) as SceneLayout;
    if (options.design && parametric) parametric.decorateParametricVenue({ batch, context, layout, footprints: recorder.shapes(), indoor: mood !== 'outdoor' });
    footprints = recorder.shapes();
    layout.spots ||= [];
    layout.crowd ||= [];
    layout.spare ||= [[0, 4], [3, 5], [-3, 5], [5, 2], [-5, 2], [0, 7]];
    if (!resolved) {
      resolved = resolveAnchors(layout.spots, spots, layout.spare, hints);
      view.spot = spots.find((spot) => spot && resolved!.anchors[spot.id])?.id ?? layout.spots[0]?.key ?? null;
    }
    for (const landmark of layout.spots) spotMarker(batch, landmark.x, landmark.z, context.accent, landmark.y || 0);
    placeTables(recorder);
    footprints = recorder.shapes();
    return batch;
  }
  /** The walk grid for this kind's walkable description and a set of recorded footprints. */
  function gridFor(shapes: FootprintShapes | null) {
    const data = walkSpec();
    const floor = shapes?.floor;
    const bounds = (data.bounds || (floor ? [floor[0] + 1.3, floor[1] + 1.3, floor[2] - 1.3, floor[3] - 1.3] : [-10, -8, 10, 8])) as WalkRect;
    return { data, bounds, grid: createWalkGrid({ bounds, block: [...(shapes?.block || []), ...(data.block || [])], clear: data.clear || [] }) };
  }
  /**
   * Stand each of this venue's game tables on free floor and draw it (see TABLE_PLACES). Decided once per scene — a rebuild
   * (the time of day changed) draws them where they already are — from the floor as it is BEFORE the tables: what the
   * scene's own builder drew.
   */
  function placeTables(recorder: FootprintRecorder) {
    const wanted = venue?.id ? tablesAt(cityId, venue.id) : [];
    if (!wanted.length) return;
    if (!tableList.length) {
      const before = gridFor(recorder.shapes()), free = before.grid, door = before.data.entrance || [(before.bounds[0] + before.bounds[2]) / 2, before.bounds[3] - 0.8];
      // Free all round, off every marker and the ground in front of one, away from the door and from the other tables.
      const fits = (x: number, z: number): boolean => {
        if (Math.hypot(x - door[0], z - door[1]) < 3.2 || tableList.some((other) => Math.hypot(other.x - x, other.z - z) < TABLE_CLEAR * 2 + 0.6)) return false;
        let standing = 0;
        for (let step = 0; step < 12; step++) {
          const angle = (step / 12) * Math.PI * 2;
          if (!free.free(x + Math.sin(angle) * TABLE_CLEAR, z + Math.cos(angle) * TABLE_CLEAR)) return false;
          if (free.free(x + Math.sin(angle) * TABLE_REACH, z + Math.cos(angle) * TABLE_REACH)) standing += 1;   // where someone walking up to it stands
        }
        if (standing < 9) return false;
        return free.free(x, z) && offMarkers(x, z) && markerList().every((at) => Math.hypot(at.x - x, at.z - z) > TABLE_CLEAR + 0.9);
      };
      wanted.forEach((table, index) => {
        const places = [...(TABLE_PLACES[table.id] || []), ...(TABLE_PLACES[kind] || TABLE_FALLBACK)], own = TABLE_PLACES[table.id] ? 0 : index;
        const pinned = resolved!.hint(`table:${table.id}`);
        let at: Point | null = pinned && fits(pinned.x, pinned.z) ? { x: pinned.x, z: pinned.z } : null;
        for (let i = 0; i < places.length && !at; i++) { const [x, z] = places[(own + i) % places.length]!; if (fits(x, z)) at = { x, z }; }
        for (let ring = 1; ring <= 40 && !at; ring++) {
          const [cx, cz] = places[own % places.length]!, radius = ring * 0.5;
          for (let step = 0; step < 20 && !at; step++) { const angle = (step / 20) * Math.PI * 2 + ring * 0.31, x = cx + Math.sin(angle) * radius, z = cz + Math.cos(angle) * radius; if (fits(x, z)) at = { x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 }; }
        }
        // A venue with no room left for a table simply has none in the scene: the Phone's Tables app still lists it.
        if (at) tableList.push({ id: `table:${table.id}`, kind: 'table', table: table.id, game: table.game, x: at.x, z: at.z, top: 1.7, r: 1.6, label: `${(GAME_LABELS as Record<string, string>)[table.game] ?? table.game} · ${table.label}` });
      });
    }
    markers = null; // read again when the crowd is placed: the list was only borrowed here
    // Turned a little so that two tables in one room do not look stamped, and the goal faces the room's middle.
    for (const item of tableList) gameTable(recorder.batch, item.x, item.z, { game: item.game, accent: context.accent, ry: item.game === 'penalty' ? Math.atan2(-item.x, -item.z) + Math.PI : item.game === 'chess' ? Math.round(Math.atan2(item.x, item.z) / (Math.PI / 2)) * (Math.PI / 2) : (item.x + item.z) * 0.37 });
  }
  /** The floor as a grid, from this kind's walkable description and the footprints of what was drawn. */
  function buildGrid() {
    const made = gridFor(footprints), data = made.data, bounds = made.bounds;
    grid = made.grid;
    const wanted = data.entrance || [(bounds[0] + bounds[2]) / 2, bounds[3] - 0.8];
    const at = grid.nearest(wanted[0], wanted[1]) || { x: wanted[0], z: wanted[1] };
    entrance = { x: at.x, y: 0, z: at.z, ry: Math.PI };
  }
  function anchorFor(id: string | null | undefined): Anchor | null {
    if (id == null) return null;
    if (!resolved!.anchors[id]) { const pinned = resolved!.hint(id); resolved!.anchors[id] = pinned ? resolved!.place(pinned) : resolved!.fallback(); }
    return resolved!.anchors[id]!;
  }
  /** Is this place off every spot marker and off the ground in front of one (as the scene's own camera sees it)? */
  function offMarkers(x: number, z: number) {
    for (const at of markerList()) {
      const dx = x - at.x, dz = z - at.z;
      const along = dx * toCamera.x + dz * toCamera.z, side = dx * toCamera.z - dz * toCamera.x;
      if (along > -SPOT_BEHIND && along < SPOT_FRONT && Math.abs(side) < SPOT_SIDE) return false;
    }
    return true;
  }
  let markers: Anchor[] | null = null;
  /** Every place a spot marker is drawn, and every spot the server knows (each once). */
  function markerList(): Anchor[] {
    if (markers) return markers;
    const seen = new Set<string>(), list: Anchor[] = [];
    for (const at of Object.values(resolved!.anchors)) { const key = `${at.x.toFixed(2)},${at.z.toFixed(2)}`; if (!seen.has(key)) { seen.add(key); list.push(at); } }
    markers = list;
    return list;
  }
  /**
   * The nearest place to (x, z) where a figure may be stood: on free floor, clear of every spot
   * marker and of the ground in front of it, and not on top of someone already placed. Searched in
   * widening rings, so a crowd place that is already fine is kept exactly.
   */
  function clearOfSpots(x: number, z: number, taken: Placed[], who: Tied = {}): Point {
    // Each pair keeps the distance its tie asks for (src/scene/space.ts): a group at one spot stands closer than strangers do.
    const apart = (px: number, pz: number, floor: boolean) => !taken.some((other) => Math.hypot(other.x - px, other.z - pz) < (floor ? FIGURE_GAP : gapFor(tieOf(who, other))));
    const fits = (px: number, pz: number, floor = false) => (!grid || grid.free(px, pz)) && offMarkers(px, pz) && apart(px, pz, floor);
    if (fits(x, z)) return { x, z };
    // Where they were put is fine for a body: look only a little way for more room, and keep the place if there is none.
    const reach = fits(x, z, true) ? 5 : 14;
    for (let ring = 1; ring <= reach; ring++) {
      const radius = ring * 0.45;
      let best: Point | null = null, bestScore = Infinity;
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
    // A crowded room cannot give everyone the distance they would like: then the place, or the nearest one, that only keeps bodies apart.
    if (fits(x, z, true)) return { x, z };
    for (let ring = 1; ring <= 14; ring++) {
      const radius = ring * 0.45;
      for (let step = 0; step < 16; step++) {
        const angle = (step / 16) * Math.PI * 2 + ring * 0.37;
        const px = x + Math.sin(angle) * radius, pz = z + Math.cos(angle) * radius;
        if (fits(px, pz, true)) return { x: px, z: pz };
      }
    }
    return { x, z };
  }
  /** Where each person of the crowd stands. A player with a reported position stands there (`live`); everyone else is placed by the scene. */
  function placeCrowd(people: CrowdPerson[]): CrowdPerson[] {
    const slots = layout!.crowd, base = resolved!.anchors.people || { x: 0, z: 3 }, taken: Placed[] = [];
    return people.slice(0, MAX_CROWD).map((person, index) => {
      if (Number.isFinite(person.x) && Number.isFinite(person.z)) {
        const bounds = grid?.bounds;
        const x = bounds ? Math.max(bounds[0], Math.min(bounds[2], person.x!)) : person.x!, z = bounds ? Math.max(bounds[1], Math.min(bounds[3], person.z!)) : person.z!;
        return { ...person, x, z, live: person.kind !== 'npc' };
      }
      let wanted: { x: number; y?: number; z: number; ry: number };
      const at = person.spot != null && resolved!.anchors[person.spot];
      if (at) {
        const turn = index * 2.4;
        // Far enough from the anchor that someone standing at it (you, perhaps) and this person do not overlap.
        const reach = 1.9, angle = turn + 0.9;
        wanted = { x: at.x + Math.sin(angle) * reach, y: at.y, z: at.z + Math.cos(angle) * reach, ry: person.ry ?? angle + Math.PI };
      } else if (index < slots.length) { const [x, z, ry = 0, y = 0] = slots[index]!; wanted = { x, y, z, ry: person.ry ?? ry }; }
      else { const turn = index * 2.4, radius = 1.6 + (index % 3) * 0.7; wanted = { x: base.x + Math.sin(turn) * radius, z: base.z + Math.cos(turn) * radius, ry: person.ry ?? turn + Math.PI }; }
      // Someone on a raised place (a stage, a walkway) stands at its height, where the scene put them; everyone else is on
      // the ground, clear of the markers.
      const deck = Math.max(walk.heightAt(wanted.x, wanted.z), index < slots.length && !at ? wanted.y || 0 : 0);
      const who: Tied = { spot: person.spot ?? null, friend: person.friend === true };
      const clear = deck > 0.05 ? { x: wanted.x, z: wanted.z } : clearOfSpots(wanted.x, wanted.z, taken, who);
      // Someone standing "at" a spot who had to step aside still faces it.
      const ry = at && (clear.x !== wanted.x || clear.z !== wanted.z) ? Math.atan2(at.x - clear.x, at.z - clear.z) : wanted.ry;
      taken.push({ ...clear, ...who });
      return { ...person, ...wanted, x: clear.x, y: deck > 0.05 ? deck : 0, z: clear.z, ry };
    });
  }
  /**
   * Where the scene itself stands the avatar: at the chosen spot's anchor, or — while an activity
   * runs there — at the place and in the pose the spot gives it (anchor.act).
   */
  function rest(): SceneRest {
    const anchor = anchorFor(view.spot) || ({ x: 0, y: 0, z: 3, ry: 0 } as Anchor);
    const acting = view.pose === 'busy' && !view.poseFixed && anchor.act ? anchor.act : null;
    const pose = view.poseFixed ? view.pose : acting ? acting.pose || 'work' : view.pose === 'stand' || view.pose === 'walk' ? view.pose : 'work';
    return {
      spot: view.spot, x: acting?.x ?? anchor.x, y: acting?.y ?? anchor.y, z: acting?.z ?? anchor.z, ry: acting?.ry ?? anchor.ry, pose, seat: acting?.seat,
      busy: view.pose === 'busy' && !view.poseFixed, leaving: view.pose === 'walk' && !view.poseFixed, fixed: view.poseFixed,
      anchor, approach: anchor.approach || null, steps: anchor.steps || [],
    };
  }
  /** One figure per pose, built the first time the pose is needed and kept until the look changes. */
  function figure(pose: string, seat?: number): AvatarGroup {
    const key = `${pose}:${seat ?? ''}`;
    let entry = figures.get(key);
    if (!entry) {
      // The player's own figure is seen close up: the best detail characters.js offers a scene (avatar-rig.js).
      entry = buildAvatar(kit, view.look, { pose: pose as Pose, seat, seed: view.seed, marker: 'crown', ...playerOptions(pose as Pose) });
      entry.visible = false;
      avatar.add(entry);
      figures.set(key, entry);
    }
    return entry;
  }
  function show(pose: string, seat?: number) { return showFigure(figure(pose, seat)); }
  function showFigure(next: AvatarGroup | null) {
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
  function moveAvatar(x: number, y: number, z: number, ry: number) {
    avatar.position.set(x, y, z);
    avatar.rotation.y = ry;
    noticeAvatar();
    const top = y + (shownFigure?.userData.top ?? 2.95);
    if (driven && selfTag) { selfTag.position.x = x; selfTag.position.y = top; selfTag.position.z = z; }
    else selfTag = { id: 'self', name: view.name, kind: 'self', text: view.name, marker: 'crown', colour: '#ffd34d', position: { x, y: top, z } };
  }
  function placeMark(mark: THREE.Mesh | null, x: number, y: number, z: number, visible: boolean) {
    if (!mark) return false;
    const changed = mark.visible !== visible || (visible && (mark.position.x !== x || mark.position.y !== y || mark.position.z !== z));
    mark.visible = visible;
    if (visible) mark.position.set(x, y, z);
    return changed;
  }
  /** The ring under the chosen spot, the lighter ring under a spot the avatar is near, and the tap-to-walk target. */
  function buildMarks() {
    const make = (name: string, draw: (b: Batch) => void) => {
      const batch = createBatch(THREE);
      draw(batch);
      const mesh = batch.build(shared.materials).meshes[0]!;
      mesh.name = `mark-${name}`; mesh.visible = false;
      group.add(mesh); markObjects.push(mesh);
      return mesh;
    };
    marks.ring = make('spot', (b: Batch) => { b.cyl(0, 0.12, 0, 0.82, 0.1, context.accent, { seg: 16, open: true, ...GLOW }); b.disc(0, 0.115, 0, 0.7, '#fff3c4', { seg: 16, ...GLOW }); });
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
  function peerFigure(peer: Peer, pose: 'stand' | 'walk') {
    const figure = buildAvatar(kit, peer.look, { pose, seed: peer.seed, marker: 'player' });
    figure.visible = false;
    peer.group.add(figure);
    return figure;
  }
  function showPeer(peer: Peer, walking: boolean) {
    const next = walking ? peer.walk : peer.stand;
    if (peer.shown === next) return;
    if (peer.shown) peer.shown.visible = false;
    next.visible = true; peer.shown = next;
  }
  function placePeer(peer: Peer) {
    peer.y = walk.heightAt(peer.x, peer.z);
    peer.group.position.set(peer.x, peer.y, peer.z);
    // A glance turns the head and a little of the torso of a rigged figure; a plain figure turns as a whole.
    peer.group.rotation.y = peer.ry + (lookAvatar(peer.stand, peer.gaze.offset) ? 0 : peer.gaze.offset);
    if (peer.walk !== peer.stand) lookAvatar(peer.walk, peer.gaze.offset);
    peer.tag.position.x = peer.x; peer.tag.position.y = peer.y + peer.top; peer.tag.position.z = peer.z;
    peer.at.x = peer.x; peer.at.z = peer.z; peer.at.top = peer.y + peer.top;
  }
  function dropPeer(peer: Peer) {
    peer.stand.userData.dispose(); peer.walk.userData.dispose();
    peer.group.parent?.remove(peer.group);
    peers.delete(peer.id);
  }
  /** A player with a reported position: make their figure, or send it on its way to the new place. */
  function syncPeer(person: LivePerson): Peer {
    const id = String(person.id), lookKey = JSON.stringify([person.look ?? null, person.seed ?? id]);
    let peer: Peer | undefined = peers.get(id);
    if (peer && peer.lookKey !== lookKey) { dropPeer(peer); peer = undefined; }
    const name = String(person.name ?? '');
    if (!peer) {
      const holder = new THREE.Group();
      holder.name = 'peer';
      peer = { id, lookKey, look: person.look ?? null, seed: person.seed ?? id, group: holder, shown: null, x: person.x, z: person.z, y: 0, ry: Number.isFinite(person.ry) ? person.ry! : Math.atan2(-person.x, -person.z) || 0,
        fromX: person.x, fromZ: person.z, toX: person.x, toZ: person.z, t: 1, span: 0, stride: 0, top: 2.95,
        tag: { id, name, kind: 'player', text: `@${name}`, marker: 'tag', colour: '#6fb4ff', position: { x: person.x, y: 2.95, z: person.z } },
        at: { id, kind: 'player', x: person.x, z: person.z, top: 2.95 }, friend: person.friend === true, gaze: newGaze() } as Peer;
      peer.stand = peerFigure(peer, 'stand'); peer.walk = peerFigure(peer, 'walk');
      peer.top = peer.stand.userData.top ?? 2.95;
      showPeer(peer, false);
      group.add(holder);
      peers.set(id, peer);
      placePeer(peer);
      return peer;
    }
    if (peer.tag.name !== name) { peer.tag.name = name; peer.tag.text = `@${name}`; }
    peer.friend = person.friend === true;
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
  function stepCrowd(dt: number) {
    let more = false;
    if (easing) {
      for (const peer of peers.values()) {
        if (peer.t >= 1) { if (stepGlance(peer, dt)) more = true; continue; }
        resetGlance(peer);
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
    }
    // NPC jaw motion shares the host's existing bounded crowd motion loop. It exists only while
    // an admitted native NPC has an active interaction, so idle venues request no extra frames.
    for (const person of placedCrowd) {
      const id = String(person.id ?? ''), actor = canonicalCrowd.get(id);
      if (!actor || !actor.talk.snapshot().active) continue;
      actor.talk.step(dt);
      more = true;
    }
    return more || easing;
  }
  /** Put every figure where it is going, at once (reduced motion, or no frame loop). */
  function settleCrowd() {
    for (const peer of peers.values()) {
      resetGlance(peer);
      if (peer.t >= 1) { placePeer(peer); continue; }
      peer.t = 1; peer.x = peer.toX; peer.z = peer.toZ; showPeer(peer, false); placePeer(peer);
    }
    easing = false;
    for (const person of placedCrowd) {
      const actor = canonicalCrowd.get(String(person.id ?? ''));
      if (actor?.talk.snapshot().active) actor.talk.stop();
    }
  }
  /** Someone standing still looks at the player when they come close, then looks away (src/scene/space.ts). True while still turning. */
  function stepGlance(peer: Peer, dt: number) {
    if (!gazing(peer.gaze) && !watch(peer.gaze, peer, peer.ry, avatar.position)) return false;
    stepGaze(peer.gaze, dt, peer, peer.ry, avatar.position, peer.friend ? 'friend' : 'stranger');
    placePeer(peer);
    return gazing(peer.gaze);
  }
  function resetGlance(peer: Peer) {
    if (!gazing(peer.gaze)) return;
    peer.gaze.phase = 'rest'; peer.gaze.offset = 0; peer.gaze.held = 0;
    lookAvatar(peer.stand, 0); lookAvatar(peer.walk, 0);
  }
  /** The player moved: wake the crowd easing if someone near would notice, so the glance is drawn on a frame the host is running anyway. */
  function noticeAvatar() {
    if (easing || !driven || !peers.size) return;
    for (const peer of peers.values()) if (peer.t >= 1 && watch(peer.gaze, peer, peer.ry, avatar.position)) { easing = true; return; }
  }
  function supportsCanonicalStaticPose(person: CrowdPerson): boolean {
    return person.pose === undefined || person.pose === null || person.pose === 'stand';
  }
  function canonicalSpec(person: CrowdPerson, index: number): CanonicalCrowdSpec {
    const id = String(person.id ?? `person-${index}`), seed = String(person.seed ?? person.id ?? person.name ?? id);
    return { id, look: person.look ?? null, seed, x: person.x ?? 0, y: person.y ?? 0, z: person.z ?? 0, ry: person.ry ?? 0, scale: 1 };
  }
  function canonicalTag(person: CrowdPerson, index: number, useCanonicalHead = true): SceneTag {
    const kind = person.kind === 'npc' || person.kind === 'self' ? person.kind : 'player';
    const name = String(person.name ?? person.id ?? ''), id = String(person.id ?? `person-${index}`);
    const look = normalizeLook(person.look, person.seed ?? id);
    const top = (person.y ?? 0) + 2.95 * avatarProportions(look.appearance).height;
    const body = useCanonicalHead ? canonicalCrowd.get(id)?.body : undefined;
    const head = body?.object.getObjectByName('Head');
    if (body && head) {
      body.object.updateWorldMatrix(true, false);
      body.object.updateMatrixWorld(true);
      const point = new THREE.Vector3();
      head.getWorldPosition(point);
      point.y += body.scale * 0.32;
      return { id, name, kind, text: kind === 'player' ? `@${name}` : name,
        marker: kind === 'npc' ? 'dot' : kind === 'self' ? 'crown' : 'tag',
        colour: kind === 'npc' ? '#58d68a' : kind === 'self' ? '#ffd34d' : '#6fb4ff',
        position: { x: person.x ?? 0, y: point.y, z: person.z ?? 0 } };
    }
    return { id, name, kind, text: kind === 'player' ? `@${name}` : name,
      marker: kind === 'npc' ? 'dot' : kind === 'self' ? 'crown' : 'tag',
      colour: kind === 'npc' ? '#58d68a' : kind === 'self' ? '#ffd34d' : '#6fb4ff',
      position: { x: person.x ?? 0, y: top, z: person.z ?? 0 } };
  }
  function rebuildActorBatch() {
    const placed = placedCrowd;
    const merged = placed.filter((person) => !person.live);
    const fallback = merged.filter((person, index) => !supportsCanonicalStaticPose(person) || !canonicalCrowd.get(String(person.id ?? `person-${index}`)));
    // Keep the procedural member visible until its own canonical body is committed; do not hide a whole merged crowd batch.
    const key = JSON.stringify(fallback);
    if (key !== batchKey) {
      batchKey = key;
      const batch = createBatch(THREE);
      drawCrowd(batch, fallback);
      const built = batch.build(shared.materials);
      releaseObjects(actorObjects);
      actorTriangles = built.triangles;
      for (const mesh of built.meshes) { mesh.name = `actors-${mesh.name}`; group.add(mesh); actorObjects.push(mesh); }
    }
    mergedTags = merged.map((person, index) => canonicalCrowd.get(String(person.id ?? `person-${index}`))
      ? canonicalTag(person, index) : canonicalTag(person, index, false));
    const kept = new Set();
    for (const person of placed) if (person.live) kept.add(syncPeer(person as LivePerson).id);
    for (const peer of [...peers.values()]) if (!kept.has(peer.id)) dropPeer(peer);
    // Tags and tap targets in the order the crowd was given.
    let next = 0;
    crowdTags = placed.map((person) => (person.live ? peers.get(String(person.id))!.tag : mergedTags[next++])).filter((tag): tag is SceneTag => Boolean(tag));
    peopleList = crowdTags.map((tag) => peers.get(tag.id)?.tag === tag ? peers.get(tag.id)!.at : { id: tag.id, kind: tag.kind, x: tag.position.x, z: tag.position.z, top: tag.position.y });
  }
  function buildActors() {
    placedCrowd = placeCrowd(view.crowd);
    canonicalCrowd.sync(placedCrowd.flatMap((person, index) => {
      if (person.live || person.kind !== 'npc' || !person.look || !supportsCanonicalStaticPose(person)) return [];
      return [canonicalSpec(person, index)];
    }).slice(0, MAX_NATIVE_NPCS));
    rebuildActorBatch();
  }
  function startCrowd(renderer: { getContext?: () => unknown }, changed: () => void) {
    notifyCrowdChanged = changed;
    if (crowdGateRejected) return;
    if (!bodyAllowed() || !drawsWebGL2(renderer)) { crowdGateRejected = true; return; }
    canonicalCrowd.start();
  }
  function applyLighting() {
    const preset = lit();
    shared.materials.glow.color.setScalar(preset.glow);
    for (const object of staticObjects as THREE.PointLight[]) if (object.isPointLight) object.intensity = object.userData.intensity * preset.lamps;
    if (sky) paintSky(THREE, sky, preset.sky);
  }
  function realise() {
    if (live || disposed) return;
    const built = drawStatic().build(shared.materials);
    staticTriangles = built.triangles;
    const deckHeights = (layout?.raised || []).flatMap((shape) =>
      (shape.rect || shape.disc) && Number.isFinite(shape.y) ? [shape.y!] : [],
    );
    // Batch.build bakes parent transforms into vertices; the index is already venue-local.
    renderedContactTop = contactSurfaceIndex(built.meshes, deckHeights);
    for (const object of [...built.meshes, ...built.lights]) { group.add(object); staticObjects.push(object); const part = object.userData.part as keyof typeof wallParts | undefined; if (part && wallParts[part]) wallParts[part].push(object); }
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
    renderedContactTop = null;
    canonicalCrowd.dispose();
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
    if (driven && pose) { const [name, seat] = pose.split(':'); show(name!, seat === '' ? undefined : Number(seat)); if (selfTag) selfTag.position.y = avatar.position.y + shownFigure!.userData.top; }
  }

  const triangleCount = (object: THREE.Mesh) => (object.geometry?.index ? object.geometry.index.count / 3 : 0);
  /**
   * WALKING (driven by the host, src/venue-world.ts). Until the host calls walk.drive(true) the scene
   * stands the avatar at its spot by itself, exactly as before; once driven it only reports where
   * the avatar should be (rest()) and the host moves it there along the floor.
   */
  const walk: SceneWalk = {
    get grid() { return grid; },
    get entrance() { return entrance; },
    get open() { return walkSpec().open !== false; },
    scale: 1,
    centre: [0, 0.7, 0],
    avatar,
    drive(on: boolean) { driven = Boolean(on); if (!driven && live) settle(); },
    rest,
    /** The spots the server knows, with where they are: [{ id, label, x, y, z, ry, approach }] (approach: the foot of the steps up to a raised spot, or null). */
    spots() { return spots.filter((spot) => spot && typeof spot.id === 'string').map((spot) => { const at = anchorFor(spot.id)!; return { id: spot.id, label: String(spot.label ?? spot.id), x: at.x, y: at.y, z: at.z, ry: at.ry, approach: at.approach || null, steps: at.steps || [] }; }); },
    /** The game tables that stand in this venue (see TABLE_PLACES): fixed for the life of the scene. */
    things() { return tableList; },
    /** People standing in the scene, for taps and for walking round them: [{ id, kind, x, z, top }]. The same objects until the crowd changes; a moving player's entry moves with them. */
    people() { return peopleList; },
    /** Boxes [x0, y0, z0, x1, y1, z1] of what can hide the avatar from the camera (camera-collision.js). */
    get solids() { return footprints?.solids || []; },
    move: moveAvatar,
    /** Resting pose ('stand', or the activity's pose) — builds that figure if it has not been needed yet. */
    pose(name?: string, seat?: number) { rigOf(standFigure)?.rest(); return show(name || 'stand', seat); },
    /**
     * The walk cycle. With a rigged figure (characters.js offering limb parts — see avatar-rig.js) the
     * standing figure's limbs swing with `phase`; without one the walking and the standing figure
     * alternate, one visible at a time. Either way no geometry is built.
     */
    gait(step: unknown, phase = 0, jog = false) {
      const rig = rigOf(standFigure);
      if (rig) { rig.stride(phase, 1, jog); return showFigure(standFigure); }
      return showFigure(step ? strideFigure : standFigure);
    },
    /**
     * How high the floor is at a place. A scene declares what can be stood on above the ground in
     * layout.raised (see deckHeight): a stage, a landing, a stair, a bridge. A raised spot nothing
     * was declared for still lifts the avatar as it steps on, in a small radius around it.
     */
    heightAt(x: number, z: number) {
      let height = deckHeight(x, z);
      for (const at of raised) {
        const share = 1 - (Math.hypot(x - at.x, z - at.z) - 0.3) / 1.6;
        if (share > 0) height = Math.max(height, at.y * Math.min(1, share));
      }
      return height;
    },
    /** Return a target only if a horizontal support face exists in the baked solid geometry. */
    contactHeightAt(x: number, z: number, expectedY?: number) {
      if (!Number.isFinite(x) || !Number.isFinite(z) || (expectedY !== undefined && !Number.isFinite(expectedY))) return null;
      // heightAt() also supplies synthetic ramps around unsupported raised anchors. They are
      // navigation assists, not rendered support, so reject their entire influence radius.
      if (raised.some((at) => Math.hypot(x - at.x, z - at.z) < 1.9)) return null;
      const declared = raisedContactTop(layout?.raised, x, z);
      if (declared === null) return null;
      let top: number | null;
      if (declared !== undefined) {
        // A deck declaration is necessary but not sufficient: require its exact plane in the
        // merged solid mesh at this point. This prevents anchors/missing deck art becoming support.
        if (Math.abs(deckHeight(x, z) - declared) > CONTACT_TOP_EPSILON) return null;
        top = renderedContactTop?.(x, z, declared - CONTACT_TOP_EPSILON, declared + CONTACT_TOP_EPSILON, declared) ?? null;
      } else {
        const floor = footprints?.floor;
        if (!floor || deckHeight(x, z) > CONTACT_TOP_EPSILON) return null;
        const [x0, z0, x1, z1] = floor;
        if (x <= x0 + 0.08 || x >= x1 - 0.08 || z <= z0 + 0.08 || z >= z1 - 0.08) return null;
        // footprintRecorder's ground-slab rule admits only top faces near y=0. Sample the
        // actual highest horizontal face in that band; do not substitute navigation heightAt().
        top = renderedContactTop?.(x, z, -0.06, 0.08) ?? null;
      }
      // Raised swing soles are still over this known support; the body solver preserves them.
      // Only reject a sample buried materially below the surface, where a correction would exceed its envelope.
      if (top === null || (expectedY !== undefined && expectedY < top - 0.14)) return null;
      return top + 0.016;
    },
    near(spot: { x: number; y: number; z: number } | null | undefined) { return spot ? placeMark(marks.near, spot.x, spot.y, spot.z, true) : placeMark(marks.near, 0, 0, 0, false); },
    goal(x?: number, z?: number) { return Number.isFinite(x) ? placeMark(marks.goal, x!, 0, z!, true) : placeMark(marks.goal, 0, 0, 0, false); },
  };
  /** Fit grounded prepared NPCs to this venue's measured rendered floor after mounting. */
  function solveNativeNpcFeetOnVenueFloor(actor: CanonicalVenueActor): boolean {
    if (actor.body.object.userData.nativeGameProviderEvidence?.preparedNative !== true) return false;
    const contactHeightAt = walk.contactHeightAt;
    if (typeof contactHeightAt !== 'function') return false;
    // Venue NPCs currently use idle/interact. Never flatten a future locomotion pose's swing foot.
    if (actor.body.pose !== 'idle' && actor.body.pose !== 'interact') return false;
    const contacts = actor.body.sampleFootContacts();
    if (contacts.length !== 2 || !['left', 'right'].every((side) => contacts.some((contact) => contact.side === side))) return false;
    for (const contact of contacts) {
      const points = contact.points?.length ? contact.points : [contact];
      if (!points.length) return false;
      for (const point of points) {
        if (![point.x, point.y, point.z].every(Number.isFinite)) return false;
        const callbackTargetY = contactHeightAt(point.x, point.z, point.y);
        if (callbackTargetY === null || !Number.isFinite(callbackTargetY)) return false;
      }
    }
    // contactHeightAt reports the measured surface plus a 16 mm safety offset. The solver
    // needs the physical top so its correction does not bake that navigation clearance into soles.
    const result = actor.body.solveFeet((point) => {
      const callbackTargetY = contactHeightAt(point.x, point.z, point.y);
      return callbackTargetY === null || !Number.isFinite(callbackTargetY) ? Number.NaN : callbackTargetY - 0.016;
    });
    actor.body.object.userData.nativeVenueFootContactSolve = {
      pose: actor.body.pose, contactSides: contacts.map((contact) => contact.side),
      sampledPointCount: contacts.reduce((total, contact) => total + (contact.points?.length ?? 1), 0),
      targetClearanceMeters: 0.016, corrected: result.corrected, maxError: result.maxError, limited: result.limited,
    };
    return true;
  }
  let raised: { x: number; y: number; z: number }[] = [];
  /**
   * layout.raised: what can be stood on above the ground, so the avatar walks UP it instead of
   * through it. Each shape gives the height of its top:
   *   { rect: [x0, z0, x1, z1], y, lip }   a stage or a landing; `lip` is how wide the step up around it is
   *   { disc: [x, z, radius], y, lip }     a round platform
   *   { ramp: [ax, az, ay, bx, bz, by], half, sag }   a stair or a bridge between two heights, `half` wide to each side
   */
  function deckHeight(x: number, z: number) {
    let height = 0;
    const shapes = layout?.raised;
    if (!shapes) return 0;
    for (let i = 0; i < shapes.length; i++) {
      const shape = shapes[i]!;
      let top = 0;
      if (shape.rect) {
        const [x0, z0, x1, z1] = shape.rect;
        const away = Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));
        top = away <= 0 ? shape.y! : shape.lip! > 0 && away < shape.lip! ? shape.y! * (1 - away / shape.lip!) : 0;
      } else if (shape.disc) {
        const away = Math.hypot(x - shape.disc[0], z - shape.disc[1]) - shape.disc[2];
        top = away <= 0 ? shape.y! : shape.lip! > 0 && away < shape.lip! ? shape.y! * (1 - away / shape.lip!) : 0;
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
    const lone = (x: number, y: number, z: number) => { if (y > 0.05 && deckHeight(x, z) < y - 0.2) raised.push({ x, y, z }); };
    for (const at of Object.values(resolved!.anchors)) {
      lone(at.x, at.y, at.z);
      if (at.act) lone(at.act.x ?? at.x, at.act.y ?? at.y, at.act.z ?? at.z);
    }
  }

  const refresh = () => { if (live) settle(); return true; };
  const entry: SceneEntry = {
    group, kind, mood, walk,
    camera: def.camera || SCENE_CAMERA,
    get background() { return lit().sky[0]; },
    /** [horizon, zenith] for the host's graded sky. */
    get sky() { return lit().sky; },
    get anchors() { return resolved!.anchors; },
    get time() { return view.time; },
    get spot() { return view.spot; },
    lighting: lit,
    setTime(time: string) {
      if (!isTime(time) || time === view.time) return false;
      view.time = time;
      if (live) applyLighting();
      return true;
    },
    setSpot(id: string) {
      if (typeof id !== 'string' || id === view.spot) return false;
      anchorFor(id); findRaised();
      view.spot = id;
      return refresh();
    },
    setPlayer({ look, seed, pose, name }: PlayerOptions = {}) {
      let changed = false, dressed = false;
      if (look !== undefined) { const lookKey = JSON.stringify(look ?? null); if (lookKey !== view.lookKey) { view.look = look; view.lookKey = lookKey; changed = true; dressed = true; } }
      if (seed !== undefined && seed !== view.seed) { view.seed = seed; changed = true; dressed = true; }
      if (name !== undefined && name !== view.name) { view.name = String(name); changed = true; if (selfTag) { selfTag.name = view.name; selfTag.text = view.name; } }
      if (pose !== undefined) { const next = pose || 'stand', fixed = !!pose; if (next !== view.pose || fixed !== view.poseFixed) { view.pose = next; view.poseFixed = fixed; changed = true; } }
      if (dressed) redress();
      return changed ? refresh() : false;
    },
    setCrowd(people: unknown) {
      view.crowd = Array.isArray(people) ? (people as unknown[]).filter((person): person is CrowdPerson => Boolean(person) && typeof person === 'object') : [];
      if (live) buildActors(); else { crowdTags = []; peopleList = []; }
      return crowdTags;
    },
    /** True while another player's figure is on its way to a newly reported position. */
    get easing() { return easing || placedCrowd.some((person) => canonicalCrowd.get(String(person.id ?? ''))?.talk.snapshot().active === true); },
    stepCrowd, settleCrowd,
    /** The camera is at (x, z): hide whichever wall it has gone behind, with what hangs on it. */
    look(x: number, z: number) {
      const zone = footprints?.walls;
      if (!zone || !live) return false;
      let changed = false;
      const set = (meshes: THREE.Object3D[], shown: boolean) => { for (const mesh of meshes) if (mesh.visible !== shown) { mesh.visible = shown; changed = true; } };
      set(wallParts.wallBack, !(z < zone.backZ));
      set(wallParts.wallLeft, !(x < zone.leftX));
      return changed;
    },
    /** Which walls are showing right now: { back, left } (true = shown), or null for a scene without walls. */
    get walls() { return footprints?.walls ? { back: wallParts.wallBack.every((mesh) => mesh.visible), left: wallParts.wallLeft.every((mesh) => mesh.visible) } : null; },
    tags: () => (selfTag ? [selfTag, ...crowdTags] : [...crowdTags]),
    stats() {
      const meshes: THREE.Mesh[] = [];
      group.traverseVisible((child) => { if ((child as THREE.Mesh).isMesh) meshes.push(child as THREE.Mesh); });
      return {
        triangles: live ? meshes.reduce((sum, mesh) => sum + triangleCount(mesh), 0) : 0,
        meshes: meshes.length,
        drawCalls: meshes.length + meshes.filter((mesh) => mesh.castShadow).length,
        lights: group.children.filter((child) => (child as THREE.Light).isLight).length,
        geometries: meshes.length,
      };
    },
    /** Reflect the server state: Lagos time of day, the spot you stand at, your look, and whether you are busy. */
    update(state: SceneState | null | undefined) {
      if (!state || typeof state !== 'object') return false;
      let changed = false, actors = false, dressed = false;
      if (!view.fixedTime && Number.isFinite(state.t)) {
        const time = timeOfDay(state.t!);
        if (time !== view.time) { view.time = time; changed = true; }
      }
      if (Number.isFinite(state.t)) {
        const weather = lookAt(cityId, venue, CITY_RULES[cityId]?.climate, state.t!);
        if (lookKey(weather) !== lookKey(view.weather)) { view.weather = weather; changed = true; }
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
      const nextNpcActivity = here && state.activeAction?.kind === 'activity' && typeof state.activeAction.id === 'string'
        ? state.activeAction.id : null;
      const npcPoseChanged = activeNpcActivity !== nextNpcActivity;
      activeNpcActivity = nextNpcActivity;
      if (live) {
        if (dressed) redress();
        if (actors) settle();
        if (changed) applyLighting();
        if (npcPoseChanged) for (const person of placedCrowd) {
          const id = String(person.id ?? ''), actor = canonicalCrowd.get(id);
          if (!actor) continue;
          const pose = nativeNpcPose(id);
          actor.body.show(pose, false);
          actor.body.object.userData.nativeGameNpcPose = pose;
          syncNativeTalk(actor, pose);
          solveNativeNpcFeetOnVenueFloor(actor);
        }
      }
      return changed || actors || npcPoseChanged;
    },
    dispose() {
      if (disposed) return;
      release();
      disposed = true;
      shared.disposers.delete(entry.dispose);
      group.parent?.remove(group);
    },
  };
  // HostScene already calls this optional seam after its first rendered, capability-gated frame.
  // Keep the extra diagnostics off SceneEntry's stable public type in this source-only packet.
  Object.assign(entry, { startCrowd });
  group.userData.canonicalCrowdCounts = () => {
    const counts = canonicalCrowd.counts, staticCount = placedCrowd.filter((person) => !person.live).length;
    return { ...counts, static: staticCount, procedural: staticCount - counts.canonical };
  };
  shared.disposers.add(entry.dispose);
  realise();
  findRaised();
  return entry;
}

const builder = (kind: string, variant?: string, drawnAs?: string): SceneBuilder => (kit, venue) => createEntry(kit, venue, kind, variant, DEFAULT_CITY_ID, drawnAs);
/** One builder per kind and alias. A kind a city added is built as that city's (its scenes must have been loaded). */
export const SCENES: Record<string, SceneBuilder> = Object.fromEntries([
  ...Object.keys(DEFS).map((kind): [string, SceneBuilder] => [kind, builder(kind)]),
  ...Object.entries(CITY_KINDS).map(([kind, cityId]): [string, SceneBuilder] => [kind, builder(kind, undefined, cityId)]),
  ...Object.entries(ALIASES).map(([alias, [kind, variant]]): [string, SceneBuilder] => [alias, builder(kind, variant)]),
]);

/** Build the scene for a venue; unknown or missing kinds get the generic plaza. Throws for a city whose own scenes have not been loaded (src/scene/city-scenes.ts). */
export function buildVenueScene(kit: Kit, venue?: SceneVenue | null, cityId: string = DEFAULT_CITY_ID): SceneEntry {
  const requested = String(venue?.scene?.kind), alias = ALIASES[requested];
  return createEntry(kit, venue, alias?.[0] ?? requested, alias?.[1], cityId);
}
