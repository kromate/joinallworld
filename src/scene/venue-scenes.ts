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
  Anchor, Batch, Colour, CrowdPerson, Landmark, SceneOptions, Lighting, Mood, RaisedShape, SceneBuilder, SceneCamera, SceneContext, SceneDef, SceneEntrance, SceneEntry,
  SceneLayout, SceneMaterials, ScenePerson, SceneRest, SceneSpot, SceneState, SceneTag, SceneThing, SceneVenue, SceneWalk, PlayerOptions, ThreeModule, TimeOfDay, Vec3, WalkSpot,
} from './types.ts';
import { buildAvatar, drawCrowd } from './characters.ts';
import { playerOptions, rigOf } from './avatar-rig.ts';
import { createWalkGrid, footprintRecorder, turnTowards } from './movement.ts';
import { spotMarker, gameTable } from './props.ts';
import { tablesAt, GAME_LABELS } from '../tables/city-places.ts';
import { DEFAULT_CITY_ID } from '../game/cities/registry.ts';
import { lagosTime } from '../game/clock.ts';
import * as outdoor from './venues-outdoor.ts';
import * as social from './venues-social.ts';
import * as work from './venues-work.ts';
import * as civic from './venues-civic.ts';
import * as transport from './venues-transport.ts';

export const DEFAULT_CAMERA: SceneCamera = { landscape: [16, 21, 27], portrait: [13, 24, 31] };
const SCENE_CAMERA: SceneCamera = { landscape: [15, 19.8, 25.4], portrait: [16.5, 29.5, 38.5] };
export const TIMES: readonly TimeOfDay[] = Object.freeze<TimeOfDay[]>(['day', 'dusk', 'night']);
const isTime = (value: unknown): value is TimeOfDay => TIMES.includes(value as TimeOfDay);
export const MAX_CROWD = 12;

/**
 * Day / dusk / night presets per mood. sky: [horizon, zenith]; hemi: [sky, ground, intensity];
 * sun: [colour, intensity, position]; rim: [colour, intensity] (the host's back light);
 * glow: strength of lit surfaces; lamps: point-light scale.
 *
 * LIT FOR EVERY SKIN TONE. The hemisphere's ground colour is the light that reaches a face from
 * below: it is a warm bounce off sand, laterite or a wooden floor — never dark green or near-black,
 * which is what turned the darkest skin tones into silhouettes. Night keeps a hemisphere of at
 * least 1 and leans on the rim light, so people stay readable against a dark sky; the club keeps
 * its purple but gets a warmer floor bounce for faces.
 */
export const LIGHTING: Readonly<Record<Mood, Readonly<Record<TimeOfDay, Lighting>>>> = Object.freeze({
  outdoor: {
    day: { sky: ['#cfe9f3', '#6fb4e6'], hemi: ['#eaf4ff', '#c9b08a', 1.9], sun: ['#fff0d2', 2.4, [-10, 26, 12]], rim: ['#cfe2ff', 0.7], glow: 0.6, lamps: 0.1 },
    dusk: { sky: ['#f0b48c', '#5d528f'], hemi: ['#f3cdb6', '#8a6f6a', 1.5], sun: ['#ff9a5c', 1.9, [-22, 11, 7]], rim: ['#c9b6f0', 0.9], glow: 1.05, lamps: 0.8 },
    night: { sky: ['#243152', '#0b1020'], hemi: ['#9fb4e6', '#3a3550', 1.05], sun: ['#9fb9ea', 0.8, [-12, 25, 8]], rim: ['#bcd0ff', 0.95], glow: 1.3, lamps: 1.6 },
  },
  indoor: {
    day: { sky: ['#d6e9ef', '#8cc0e2'], hemi: ['#fff6ea', '#cdbba6', 2.2], sun: ['#fff1d8', 1.9, [-8, 26, 14]], rim: ['#dfeaff', 0.5], glow: 0.85, lamps: 0.45 },
    dusk: { sky: ['#e3a37c', '#6f5f95'], hemi: ['#ffe4c7', '#a8937f', 1.9], sun: ['#ffb57c', 1.4, [-18, 14, 10]], rim: ['#d9c8f2', 0.6], glow: 1.05, lamps: 0.85 },
    night: { sky: ['#232e4a', '#0e1324'], hemi: ['#ecdfc9', '#7a6f78', 1.6], sun: ['#c9d3ee', 0.9, [-12, 25, 8]], rim: ['#c6d4ff', 0.7], glow: 1.2, lamps: 1.1 },
  },
  club: {
    day: { sky: ['#241d3a', '#120f1f'], hemi: ['#b3a2ea', '#4a3550', 1.1], sun: ['#c0b0ff', 0.7, [-10, 26, 10]], rim: ['#ffd9b0', 0.8], glow: 1.2, lamps: 1.05 },
    dusk: { sky: ['#221b36', '#110e1d'], hemi: ['#a996e2', '#46324c', 1.05], sun: ['#b8a4ff', 0.6, [-10, 26, 10]], rim: ['#ffd9b0', 0.8], glow: 1.3, lamps: 1.15 },
    night: { sky: ['#1e1833', '#0d0a18'], hemi: ['#a08cdc', '#422f48', 1], sun: ['#b8a4ff', 0.55, [-10, 26, 10]], rim: ['#ffd9b0', 0.85], glow: 1.35, lamps: 1.2 },
  },
});

/** Lagos time of day from server ms: day 06:30–17:30, dusk for the hour either side of night. */
export function timeOfDay(ms: number): TimeOfDay {
  const { minuteOfDay } = lagosTime(ms);
  if (minuteOfDay >= 390 && minuteOfDay < 1050) return 'day';
  if ((minuteOfDay >= 330 && minuteOfDay < 390) || (minuteOfDay >= 1050 && minuteOfDay < 1170)) return 'dusk';
  return 'night';
}
export const lightingFor = (mood: string, time: unknown): Lighting => (LIGHTING[mood as Mood] || LIGHTING.outdoor)[isTime(time) ? time : 'day'];

const DEFS: Record<string, SceneDef> = { ...outdoor.SCENES, ...social.SCENES, ...work.SCENES, ...civic.SCENES, ...transport.SCENES };
/** Kinds that are another kind with a default variant. */
const ALIASES: Record<string, [string, string]> = { library: ['club', 'speakeasy'], church: ['worship', 'church'], mosque: ['worship', 'mosque'] };
export const KINDS = Object.freeze(Object.keys(DEFS).filter((kind) => kind !== 'generic'));

/** The scene materials plus the sky's, made once per kit by the first scene. */
type SkyMaterials = SceneMaterials & { sky?: THREE.MeshBasicMaterial };

function skyDome(kit: Kit, materials: SkyMaterials) {
  const { THREE } = kit;
  const geometry = new THREE.SphereGeometry(90, 16, 8);
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
/** How long another player's figure takes to ease to a newly reported position (seconds), and the jump beyond which it is simply placed. */
const PEER_EASE: [number, number] = [0.16, 0.42], PEER_JUMP = 7, PEER_PACE = 6;

/** One other player's figure: a standing and a walking pose, eased between reported positions. */
interface Peer {
  id: string; lookKey: string; look: unknown; seed: unknown; group: THREE.Group; shown: AvatarGroup | null;
  x: number; z: number; y: number; ry: number; fromX: number; fromZ: number; toX: number; toZ: number;
  t: number; span: number; stride: number; top: number; tag: SceneTag; at: ScenePerson; stand: AvatarGroup; walk: AvatarGroup;
}
/** A crowd person with a reported position. */
type LivePerson = CrowdPerson & { x: number; z: number };
interface View {
  time: TimeOfDay; fixedTime: boolean; spot: string | null; look: unknown; lookKey: string; seed: unknown; name: string;
  pose: string; poseFixed: boolean; crowd: CrowdPerson[];
}

function createEntry(kit: Kit, venue: SceneVenue | null | undefined, def: SceneDef, kind: string, defaultVariant?: string, cityId: string = DEFAULT_CITY_ID): SceneEntry {
  const { THREE } = kit;
  const shared = kitResources(kit);
  const materials: SkyMaterials = shared.materials;
  if (!materials.sky) materials.sky = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false, fog: false });
  const options: SceneOptions = venue?.scene && typeof venue.scene === 'object' ? venue.scene : {};
  const spots: SceneSpot[] = Array.isArray(options.spots) ? options.spots : Object.values(venue?.spots || {});
  const context: SceneContext = {
    kind, venue, spots,
    variant: typeof options.variant === 'string' ? options.variant : defaultVariant || null,
    accent: typeof options.palette === 'string' && /^#[0-9a-f]{6}$/i.test(options.palette) ? options.palette : def.accent || '#e0a43a',
    label: String(venue?.label || kind),
  };
  const mood = (typeof def.mood === 'function' ? def.mood(context) : def.mood) || 'outdoor';
  const group = new THREE.Group();
  group.name = `venue:${kind}`;

  const view: View = {
    time: isTime(options.time) ? options.time : 'day',
    fixedTime: isTime(options.time),
    spot: null, look: options.look ?? null, lookKey: JSON.stringify(options.look ?? null), seed: options.seed ?? 'you', name: 'You',
    pose: 'stand', poseFixed: false, crowd: [],
  };
  const hints: Record<string, string> = options.anchors && typeof options.anchors === 'object' ? options.anchors : {};
  let layout: SceneLayout | null = null, resolved: Resolved | null = null, live = false, disposed = false, footprints: FootprintShapes | null = null, grid: WalkGrid | null = null, entrance: SceneEntrance | null = null;
  const staticObjects: Releasable[] = [], actorObjects: Releasable[] = [], markObjects: Releasable[] = [];
  let staticTriangles = 0, actorTriangles = 0, crowdTags: SceneTag[] = [], selfTag: SceneTag | null = null, sky: THREE.Mesh | null = null;
  // Other players who report where they stand: one figure each, eased to every new position.
  const peers = new Map<string, Peer>();
  let peopleList: ScenePerson[] = [], mergedTags: SceneTag[] = [], batchKey: string | null = null, easing = false;
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
    layout = (def.build(batch, context) || {}) as SceneLayout;
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
    const data = (Object.hasOwn(WALK, kind) ? WALK[kind] : WALK_DEFAULT)!;
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
    for (const item of tableList) gameTable(recorder.batch, item.x, item.z, { game: item.game, accent: context.accent, ry: item.game === 'penalty' ? Math.atan2(-item.x, -item.z) + Math.PI : (item.x + item.z) * 0.37 });
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
  function clearOfSpots(x: number, z: number, taken: Point[]): Point {
    const fits = (px: number, pz: number) => (!grid || grid.free(px, pz)) && offMarkers(px, pz) && !taken.some((other) => Math.hypot(other.x - px, other.z - pz) < 0.9);
    if (fits(x, z)) return { x, z };
    for (let ring = 1; ring <= 14; ring++) {
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
    return { x, z };
  }
  /** Where each person of the crowd stands. A player with a reported position stands there (`live`); everyone else is placed by the scene. */
  function placeCrowd(people: CrowdPerson[]): CrowdPerson[] {
    const slots = layout!.crowd, base = resolved!.anchors.people || { x: 0, z: 3 }, taken: Point[] = [];
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
    peer.group.rotation.y = peer.ry;
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
        at: { id, kind: 'player', x: person.x, z: person.z, top: 2.95 } } as Peer;
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
  function stepCrowd(dt: number) {
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
    for (const person of placed) if (person.live) kept.add(syncPeer(person as LivePerson).id);
    for (const peer of [...peers.values()]) if (!kept.has(peer.id)) dropPeer(peer);
    // Tags and tap targets in the order the crowd was given.
    let next = 0;
    crowdTags = placed.map((person) => (person.live ? peers.get(String(person.id))!.tag : mergedTags[next++])).filter((tag): tag is SceneTag => Boolean(tag));
    peopleList = crowdTags.map((tag) => peers.get(tag.id)?.tag === tag ? peers.get(tag.id)!.at : { id: tag.id, kind: tag.kind, x: tag.position.x, z: tag.position.z, top: tag.position.y });
  }
  function applyLighting() {
    const preset = lightingFor(mood, view.time);
    shared.materials.glow.color.setScalar(preset.glow);
    for (const object of staticObjects as THREE.PointLight[]) if (object.isPointLight) object.intensity = object.userData.intensity * preset.lamps;
    if (sky) paintSky(THREE, sky, preset.sky);
  }
  function realise() {
    if (live || disposed) return;
    const built = drawStatic().build(shared.materials);
    staticTriangles = built.triangles;
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
    get open() { return (Object.hasOwn(WALK, kind) ? WALK[kind] : WALK_DEFAULT)!.open !== false; },
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
    near(spot: { x: number; y: number; z: number } | null | undefined) { return spot ? placeMark(marks.near, spot.x, spot.y, spot.z, true) : placeMark(marks.near, 0, 0, 0, false); },
    goal(x?: number, z?: number) { return Number.isFinite(x) ? placeMark(marks.goal, x!, 0, z!, true) : placeMark(marks.goal, 0, 0, 0, false); },
  };
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
    get background() { return lightingFor(mood, view.time).sky[0]; },
    /** [horizon, zenith] for the host's graded sky. */
    get sky() { return lightingFor(mood, view.time).sky; },
    get anchors() { return resolved!.anchors; },
    get time() { return view.time; },
    get spot() { return view.spot; },
    lighting: () => lightingFor(mood, view.time),
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
    get easing() { return easing; },
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

const builder = (kind: string, def: SceneDef, variant?: string): SceneBuilder => (kit, venue) => createEntry(kit, venue, def, kind, variant);
export const SCENES: Record<string, SceneBuilder> = Object.fromEntries([
  ...Object.entries(DEFS).map(([kind, def]): [string, SceneBuilder] => [kind, builder(kind, def)]),
  ...Object.entries(ALIASES).map(([alias, [kind, variant]]): [string, SceneBuilder] => [alias, builder(kind, DEFS[kind]!, variant)]),
]);

/** Build the scene for a venue; unknown or missing kinds get the generic plaza. */
export function buildVenueScene(kit: Kit, venue?: SceneVenue | null, cityId: string = DEFAULT_CITY_ID): SceneEntry {
  const requested = String(venue?.scene?.kind), alias = ALIASES[requested];
  const kind = alias?.[0] ?? (Object.hasOwn(DEFS, requested) ? requested : 'generic'), def = DEFS[kind] ?? DEFS.generic;
  if (!def) throw new TypeError(`No scene builder for ${kind}`);
  return createEntry(kit, venue, def, kind, alias?.[1], cityId);
}
