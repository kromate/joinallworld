/**
 * OWNER: home
 * The home interior. Same builder contract as src/scene/venue-scenes.ts:
 *   buildHomeScene(kit, venue) → { group, background, camera, update(state) → boolean,
 *                                  setPlayer, setCrowd, tags, dispose }
 *
 * WHAT IT DRAWS
 *   An isometric-style room on a checkerboard grid (grid × grid tiles for the player's house),
 *   two walls with a window and a door, and every placed object from state.home.items as a simple
 *   low-poly shape at its tile and rotation. Wall items hang on the two walls.
 *   DOLLHOUSE: the camera may orbit all the way round. look(x, z) — called by the host with the
 *   camera's place before each frame — hides whichever wall the camera has gone behind, together
 *   with its window or door and every wall item hanging on it (lamps, the calendar, art), so the
 *   room is always visible. It only flips `visible`; nothing is rebuilt.
 *   The object the player picked gets a yellow marker; in Buy mode the placement ghost gets a
 *   green (valid) or red (invalid) footprint.
 *   The player's own avatar (state.onboarding.look, drawn by src/scene/characters.ts) stands
 *   beside the furniture of the spot they chose — or by the door — and guests the host has let
 *   in (setCrowd) stand just inside the door. Guests are one merged mesh, rebuilt on change; the
 *   player's own avatar is a separate prebuilt figure per pose that is only ever moved.
 *
 * WALKING (see src/scene/movement.ts; the host, src/venue-world.ts, does the walking)
 *   `walk` is the same contract as a venue scene's: the walkable description is the room's
 *   bounds plus one obstacle rectangle per piece of floor furniture in state.home.items (rugs and
 *   mats are walked over), rebuilt only when the furniture changes. Outside Buy mode a tap on
 *   furniture is not acted on at once: the host walks the avatar to it (pickAt), then use() sends
 *   the same 'jaw:home-pick' the tap always sent. In Buy mode taps work exactly as before.
 *
 * STATIC RENDERING
 *   No frame callbacks, no timers. Geometry is rebuilt only when the room, the furniture
 *   or the selection/ghost actually changed. update(state) returns true exactly when it rebuilt,
 *   so the host draws one frame. The scene never calls the renderer itself, so the host's
 *   renderCount stays honest.
 *
 * EVENTS (window CustomEvents; the Buy panel is the other end)
 *   in   'jaw:mode'        detail { mode } — the shell's view; in 'buy' a tap picks at once
 *   in   'jaw:home-ui'     detail { selected: objectId | null, buy: boolean, ghost: { itemId, x, y, rot, valid } | null, retry? }
 *                          UI-only state to draw. The sender then asks the host for a frame
 *                          (a Buy panel refresh or the next accepted state does that).
 *   out  'jaw:home-pick'   detail { id: objectId | null, cell: { x, y } | null } — the player
 *                          tapped an object and/or a floor tile
 *   out  'jaw:home-scene'  detail { status: 'ready' | 'empty' | 'error', placed } — for the
 *                          on-screen loading / empty / error message
 * The camera and canvas are learned from the renderer at draw time (onBeforeRender), so taps
 * are resolved with the exact camera the host used.
 *
 * SKINNED BODY (src/scene/body/; on for everyone, capability fallback only — see body/gate.ts)
 *   On a device bodyAllowed() accepts and a WebGL2 renderer, the room's first frame starts loading one skinned body
 *   (src/scene/body/skinned.ts). Until it is in, and for good if anything fails, the procedural figure stays. Once in,
 *   it stands in for the player's own figure: idle at rest, the walk/jog clip at the host's stride phase, and on a
 *   seated activity it sits on the chair or sofa (sit-enter plays when the avatar walked there). It asks for its first
 *   frame with 'jaw:home-frame'; sit-enter runs through `easing` / stepCrowd / settleCrowd. Without WebGL2 (and in
 *   Node tests) `body` stays null and the body module is never imported.
 */
import { FURNITURE as CATALOGUE, KINDS as KIND_TABLE, HOME_ACTIVITIES } from '../game/content/furniture.ts';
import { createBatch, sceneMaterials, releaseObjects } from './build.ts';
import { drawAvatar, buildAvatar, POSES } from './characters.ts';
import type { Pose } from './characters.ts';
import { playerOptions, rigOf } from './avatar-rig.ts';
import { createWalkGrid } from './movement.ts';
import { bodyAllowed, drawsWebGL2, importBody } from './body/gate.ts';
import type { BodyPose, SkinnedBody } from './body/skinned.ts';
import { HOUSES, DEFAULT_HOUSE, homeOf } from '../game/content/housing.ts';
import { housesFor } from '../game/cities/housingRuntime.ts';
import { cachedCityContent } from '../game/cities/registry.ts';
import type { HomePalette } from '../types/content.ts';
import { HOUSE_DESIGNS } from '../game/content/world.ts';
import { footprint, windowSlot, doorSlot } from '../game/home-layout.ts';
import type * as THREE from 'three';
import type { Kit } from './kit.ts';
import type { Colour, SceneCamera, Vec3 } from './types.ts';
import type { WalkRect } from './movement.ts';
import type { FurnitureDefinition } from '../types/content.ts';
import type { LifeState } from '../types/life.ts';

/** The modelling tools a furniture shape draws with (the kit's primitives, bound to one parent group). */
export interface Tools {
  box(x: number, y: number, z: number, w: number, h: number, d: number, c: Colour, lit?: boolean): THREE.Mesh;
  round(x: number, y: number, z: number, r: number, h: number, c: Colour, lit?: boolean): THREE.Mesh;
  ball(x: number, y: number, z: number, r: number, c: Colour): THREE.Mesh;
  crown(x: number, y: number, z: number, sx: number, sy: number, sz: number, c: Colour): THREE.Mesh;
}
/** Draws one catalogue shape: W × D tiles, colour, and the catalogue entry. */
type Shape = (b: Tools, W: number, D: number, c: Colour, def: FurnitureDefinition) => void;
/** The UI-only state the Buy panel sends ('jaw:home-ui'). */
export interface HomeGhost { itemId: string; x: number; y: number; rot: number; valid?: boolean }
export interface HomeUi { selected: string | null; ghost: HomeGhost | null; buy: boolean }
/** A name tag the host projects into the DOM (the scene's `tags()`). */
export interface HomeTag { id: string; name: string; kind: string; text: string; marker: string; colour: string; position: { x: number; y: number; z: number } }
/** The player's avatar as the host hands it over (setPlayer). */
export interface HomePlayer { look?: unknown; seed?: string; name?: unknown; pose?: string | null }
/** What the host knows about where the avatar belongs (`walk.rest()`). */
export interface HomeRest { spot: string | null; x: number; y: number; z: number; ry: number; pose: Pose; busy: boolean; leaving: boolean; fixed: boolean }
/** What is under a tap (`pickAt`). */
export interface HomePick { id: string | null; cell: { x: number; y: number } | null; x: number; z: number; rect: [number, number, number, number] | null }
type Wall = 'back' | 'left';
type Solid = [number, number, number, number, number, number];
/** A figure built by characters.ts (one prebuilt per pose). */
type Figure = ReturnType<typeof buildAvatar>;
/** A guest the host let in, as setCrowd keeps it. */
interface Guest { id: unknown; name: unknown; kind: unknown; look: unknown; seed: unknown }
const FURNITURE = CATALOGUE as unknown as Readonly<Record<string, FurnitureDefinition | undefined>>;
const KINDS = KIND_TABLE as unknown as Readonly<Record<string, { spot: string | null } | undefined>>;
const ROOM = 10;         // world units along each wall, whatever the grid size
const WALL_HEIGHT = 3.4;
const WALL_ITEM_Y = 1.95;
const SHIFT = -2.5;      // the room sits up-screen so the bottom panels do not cover it
/** Skinned body only: the home activities that sit on a seat ('Sit & Rest'), by engine id. */
const SEATED_ACTIVITIES = new Set(HOME_ACTIVITIES.filter((activity) => activity.needs === 'seat').map((activity) => `home-${activity.id}`));
/**
 * Skinned body only: where a seat's sitter goes, in the model's tile units (origin the footprint centre, facing +z,
 * the backrest behind at −z): the seat top's height, how far forward of the centre the pelvis sits, and the cushion
 * centres across the width. Read off SHAPES below.
 */
function seatOf(shape: string, W: number, D: number): { top: number; z: number; xs: number[] } {
  if (shape === 'chair') return { top: 0.41, z: -0.08, xs: [0] };
  if (shape === 'sofa') return { top: 0.5, z: -D * 0.25 + 0.13, xs: Array.from({ length: W }, (_, i) => (i - (W - 1) / 2) * 0.82) };
  if (shape === 'beanbag') return { top: 0.45, z: 0.02, xs: [0] };
  return { top: 0.45, z: 0, xs: [0] };
}
/** Skinned body only: the clip pose for each procedural pose. 'sit' needs a seat (else idle). */
const BODY_POSE: Record<Pose, BodyPose> = { stand: 'idle', sit: 'sit', walk: 'walk', jog: 'jog', wave: 'interact', work: 'interact', dance: 'dance', relax: 'idle' };
/** The shared room colours (Lagos): a city's content may give its own `homePalette`. */
export const ROOM_PALETTE: HomePalette = Object.freeze({ back: '#d7ccb0', left: '#c3cbb6', floor: Object.freeze(['#d9cdb4', '#bfae8f'] as const) });
const WOOD = '#7a5c40', DARK = '#33373d', WHITE = '#f3f1ea', STEEL = '#9aa3a8';
/** An avatar is 2.45 units tall in venue scale; furniture here is modelled one unit per tile (about a metre). */
const AVATAR_SCALE = 0.72;
export const MAX_GUESTS_SHOWN = 5;
/** How tall each furniture shape stands, in tiles — what can come between the camera and the avatar (camera-collision.js). Unlisted shapes are low. */
const TALL: Record<string, number | undefined> = { bed: 1.3, fridge: 1.9, shower: 1.8, speaker: 1.25, tv: 1.4, shelf: 1.5, wardrobe: 1.7, tripod: 1.25, mic: 1.3, floorlamp: 1.7, cage: 1.5, aquarium: 1.15, plant: 1.1, drum: 1, cooker: 1.1, desk: 1, bench: 1, inverter: 0.95, chair: 0.95, sofa: 0.85 };

const legs = (b: Tools, w: number, d: number, h: number, c: Colour = WOOD) => { for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) b.box(x, h / 2, z, 0.06, h, 0.06, c); };

/** One low-poly model per catalogue `shape`. Units are tiles; origin is the footprint centre on the floor; W × D is the footprint. */
const SHAPES: { fallback: Shape; [shape: string]: Shape | undefined } = {
  mat(b, W, D, c) { b.box(0, 0.04, 0, W * 0.84, 0.06, D * 0.9, c); b.box(0, 0.1, -D * 0.36, W * 0.5, 0.07, D * 0.12, WHITE); },
  bed(b, W, D, c, def) {
    b.box(0, 0.2, 0, W * 0.92, 0.26, D * 0.94, WOOD);
    b.box(0, 0.42, 0, W * 0.86, 0.2, D * 0.9, WHITE);
    b.box(0, 0.54, D * 0.14, W * 0.88, 0.07, D * 0.58, c);
    for (let i = 0; i < W; i++) b.box((i - (W - 1) / 2) * 0.8, 0.58, -D * 0.38, 0.55, 0.1, D * 0.12 + 0.08, '#ffffff');
    b.box(0, 0.5 + def.stars * 0.08, -D * 0.47, W * 0.92, 0.7 + def.stars * 0.16, 0.07, def.stars >= 4 ? '#c9a227' : WOOD);
  },
  stove(b, W, D, c) {
    b.box(0, 0.5, 0, 0.82, 0.06, 0.82, '#8a6b4a'); legs(b, 0.68, 0.68, 0.5);
    b.round(0, 0.63, 0, 0.2, 0.2, c); b.round(0, 0.8, 0, 0.19, 0.14, '#55595e'); b.round(0, 0.88, 0, 0.2, 0.03, '#2f3236');
  },
  cooker(b, W, D, c) {
    b.box(0, 0.43, 0, W * 0.84, 0.86, D * 0.8, c); b.box(0, 0.88, 0, W * 0.86, 0.04, D * 0.82, DARK);
    for (let i = 0; i < W * 2; i++) b.round((i + 0.5) * 0.42 - W * 0.42, 0.92, 0, 0.13, 0.04, '#6c7278');
    b.box(0, 1.0, -D * 0.37, W * 0.84, 0.2, 0.05, c); b.box(0, 0.45, D * 0.41, W * 0.6, 0.4, 0.02, DARK);
  },
  cooler(b, W, D, c) { b.box(0, 0.24, 0, 0.62, 0.44, 0.44, c); b.box(0, 0.5, 0, 0.66, 0.09, 0.48, WHITE); b.box(0, 0.58, 0, 0.3, 0.05, 0.06, c); },
  fridge(b, W, D, c, def) {
    const h = 1.3 + def.stars * 0.12;
    b.box(0, h / 2, 0, 0.74, h, 0.7, c); b.box(0, h * 0.68, 0.36, 0.7, 0.02, 0.02, DARK); b.box(0.28, h * 0.5, 0.37, 0.04, 0.3, 0.03, STEEL);
  },
  drum(b, W, D, c) { b.round(0, 0.48, 0, 0.36, 0.96, c); b.round(0, 0.98, 0, 0.38, 0.05, '#2c4f76'); b.round(0, 0.3, 0, 0.375, 0.04, '#2c4f76'); b.round(0, 0.66, 0, 0.375, 0.04, '#2c4f76'); },
  bucket(b, W, D, c) { b.round(-0.12, 0.2, -0.08, 0.22, 0.4, c); b.round(-0.12, 0.41, -0.08, 0.24, 0.03, '#2f6f52'); b.round(0.24, 0.07, 0.2, 0.16, 0.12, '#d9574f'); },
  shower(b, W, D, c) {
    b.box(0, 0.04, 0, 0.9, 0.08, 0.9, WHITE);
    b.box(-0.44, 0.9, 0, 0.03, 1.7, 0.9, c); b.box(0, 0.9, -0.44, 0.9, 1.7, 0.03, c);
    b.round(-0.32, 0.95, -0.32, 0.025, 1.8, STEEL); b.box(-0.2, 1.82, -0.2, 0.24, 0.04, 0.24, STEEL);
  },
  tub(b, W, D, c) { b.box(0, 0.28, 0, W * 0.9, 0.52, D * 0.8, c); b.box(0, 0.52, 0, W * 0.78, 0.06, D * 0.6, '#bfe3ee'); b.round(-W * 0.38, 0.66, 0, 0.03, 0.26, STEEL); },
  toilet(b, W, D, c) { b.round(0, 0.19, 0.08, 0.19, 0.38, c); b.round(0, 0.41, 0.1, 0.25, 0.07, c); b.box(0, 0.55, -0.27, 0.46, 0.5, 0.18, c); b.box(0, 0.82, -0.27, 0.5, 0.05, 0.22, WHITE); },
  basin(b, W, D, c) { b.round(0, 0.1, 0, 0.36, 0.2, c); b.round(0, 0.2, 0, 0.3, 0.02, '#8fc6d8'); },
  chair(b, W, D, c) { b.box(0, 0.38, 0, 0.5, 0.06, 0.5, c); b.box(0, 0.66, -0.23, 0.5, 0.5, 0.05, c); legs(b, 0.42, 0.42, 0.36, c); },
  sofa(b, W, D, c) {
    b.box(0, 0.24, 0, W * 0.94, 0.34, D * 0.84, c); b.box(0, 0.58, -D * 0.34, W * 0.94, 0.5, D * 0.18, c);
    for (const side of [-1, 1]) b.box(side * (W * 0.47 - 0.07), 0.46, 0, 0.14, 0.32, D * 0.84, c);
    for (let i = 0; i < W; i++) b.box((i - (W - 1) / 2) * 0.82, 0.45, D * 0.06, 0.66, 0.1, D * 0.5, '#f0e6d6');
  },
  beanbag(b, W, D, c) { b.ball(0, 0.26, 0, 0.38, c); b.ball(0, 0.5, -0.08, 0.24, c); },
  rug(b, W, D, c) { b.box(0, 0.02, 0, W * 0.94, 0.03, D * 0.94, c); b.box(0, 0.04, 0, W * 0.7, 0.02, D * 0.7, '#e8d9b5'); b.box(0, 0.055, 0, W * 0.4, 0.02, D * 0.4, c); },
  radio(b, W, D, c) {
    b.round(0, 0.4, 0, 0.26, 0.06, WOOD); legs(b, 0.3, 0.3, 0.4);
    b.box(0, 0.56, 0, 0.44, 0.26, 0.16, c); b.round(-0.1, 0.56, 0.085, 0.07, 0.02, DARK); b.box(0.18, 0.84, 0, 0.015, 0.34, 0.015, STEEL);
  },
  speaker(b, W, D, c) { b.box(0, 0.6, 0, 0.5, 1.2, 0.46, c); b.ball(0, 0.85, 0.2, 0.14, '#5b6068'); b.ball(0, 0.42, 0.2, 0.2, '#5b6068'); b.box(0, 1.22, 0, 0.3, 0.04, 0.1, '#35d07f', true); },
  board(b, W, D, c) { b.box(0, 0.3, 0, 0.7, 0.05, 0.7, WOOD); legs(b, 0.56, 0.56, 0.3); b.box(0, 0.34, 0, 0.56, 0.03, 0.56, c); b.box(-0.14, 0.36, -0.14, 0.2, 0.02, 0.2, '#c9372c'); b.box(0.14, 0.36, 0.14, 0.2, 0.02, 0.2, '#2f6fbf'); },
  tv(b, W, D, c) {
    b.box(0, 0.24, 0, W * 0.82, 0.48, 0.4, c);
    b.box(0, 0.5 + W * 0.26, 0, W * 0.7, W * 0.42, 0.07, '#15171a'); b.box(0, 0.5 + W * 0.26, 0.04, W * 0.62, W * 0.34, 0.01, '#5d8fc4', true);
  },
  console(b, W, D, c) { b.box(0, 0.2, 0, 0.7, 0.4, 0.5, WOOD); b.box(0, 0.45, 0, 0.4, 0.1, 0.3, c); b.box(0.24, 0.43, 0.14, 0.16, 0.05, 0.1, '#e5e7e9'); b.box(0, 0.51, 0.16, 0.2, 0.01, 0.02, '#4aa3ff', true); },
  gymmat(b, W, D, c) {
    b.box(0, 0.03, 0, W * 0.8, 0.05, D * 0.9, c);
    for (const z of [-0.12, 0.12]) { b.box(W * 0.2, 0.12, D * 0.3 + z, 0.3, 0.05, 0.05, STEEL); for (const x of [-0.15, 0.15]) b.ball(W * 0.2 + x, 0.12, D * 0.3 + z, 0.08, DARK); }
  },
  bench(b, W, D, c) {
    b.box(0, 0.34, 0, W * 0.6, 0.1, 0.34, c); legs(b, W * 0.5, 0.26, 0.3, DARK);
    for (const z of [-0.36, 0.36]) b.box(-W * 0.32, 0.5, z, 0.06, 1.0, 0.06, DARK);
    b.box(-W * 0.32, 0.98, 0, 0.04, 0.04, 0.96, STEEL); for (const z of [-0.44, 0.44]) b.box(-W * 0.32, 0.98, z, 0.3, 0.3, 0.06, DARK);
  },
  desk(b, W, D, c) {
    b.box(0, 0.62, 0, W * 0.9, 0.06, 0.62, c); legs(b, W * 0.8, 0.5, 0.6, DARK);
    b.box(0, 0.67, 0.02, 0.44, 0.02, 0.3, STEEL); b.box(0, 0.83, -0.14, 0.44, 0.3, 0.02, DARK); b.box(0, 0.83, -0.125, 0.4, 0.26, 0.01, '#8fd0ff', true);
    b.box(W * 0.3, 0.72, -0.1, 0.1, 0.14, 0.1, '#d9574f');
  },
  shelf(b, W, D, c) {
    b.box(0, 0.75, -0.14, 0.8, 1.5, 0.05, c); for (const x of [-0.39, 0.39]) b.box(x, 0.75, 0, 0.04, 1.5, 0.34, c);
    [0.08, 0.5, 0.92, 1.34].forEach((y, row) => { b.box(0, y, 0, 0.78, 0.04, 0.34, c); if (row < 3) for (let i = 0; i < 5; i++) b.box(-0.28 + i * 0.14, y + 0.17, 0, 0.1, 0.28 - (i % 2) * 0.05, 0.22, ['#b6524a', '#4f7fa8', '#d1a94a', '#5d8f63', '#8a5f99'][(i + row) % 5]!); });
  },
  keyboard(b, W, D, c) {
    for (const x of [-W * 0.3, W * 0.3]) { b.box(x, 0.36, 0, 0.05, 0.72, 0.05, DARK); b.box(x, 0.03, 0, 0.05, 0.05, 0.5, DARK); }
    b.box(0, 0.75, 0, W * 0.88, 0.08, 0.32, c); b.box(0, 0.8, 0.05, W * 0.82, 0.02, 0.16, WHITE); b.box(0, 0.815, 0.01, W * 0.82, 0.02, 0.05, '#17181a');
  },
  tripod(b, W, D, c) {
    for (const [x, z] of [[-0.2, 0.16], [0.2, 0.16], [0, -0.22]] as const) b.box(x * 0.6, 0.5, z * 0.6, 0.04, 1.0, 0.04, STEEL);
    b.box(0, 1.1, 0, 0.3, 0.2, 0.2, c); b.round(0, 1.1, 0.13, 0.07, 0.06, '#5b6068');
  },
  mic(b, W, D, c) { b.round(0, 0.03, 0, 0.2, 0.05, c); b.round(0, 0.62, 0, 0.022, 1.2, STEEL); b.ball(0, 1.26, 0, 0.07, DARK); },
  lantern(b, W, D, c) { b.round(0, 0.05, 0, 0.14, 0.1, DARK); b.round(0, 0.24, 0, 0.11, 0.28, c, true); b.round(0, 0.41, 0, 0.14, 0.06, DARK); },
  floorlamp(b, W, D, c) { b.round(0, 0.03, 0, 0.2, 0.05, DARK); b.round(0, 0.7, 0, 0.025, 1.36, STEEL); b.round(0, 1.5, 0, 0.24, 0.34, c, true); },
  generator(b, W, D, c) {
    b.box(0, 0.3, 0, 0.7, 0.4, 0.5, c); b.round(0, 0.56, 0, 0.22, 0.14, DARK);
    for (const x of [-0.4, 0.4]) b.box(x, 0.32, 0, 0.04, 0.64, 0.56, DARK); b.box(0, 0.64, 0, 0.84, 0.04, 0.04, DARK); b.box(0, 0.05, 0, 0.84, 0.06, 0.56, DARK);
  },
  inverter(b, W, D, c) { b.box(0, 0.62, -0.18, 0.5, 0.6, 0.18, c); b.box(0, 0.74, -0.08, 0.2, 0.1, 0.01, '#35d07f', true); for (const x of [-0.2, 0.2]) b.box(x, 0.16, 0.08, 0.34, 0.32, 0.5, DARK); },
  jerrycans(b, W, D, c) { b.box(-0.18, 0.24, -0.06, 0.26, 0.48, 0.34, c); b.box(0.16, 0.24, 0.08, 0.26, 0.48, 0.34, c); b.box(-0.18, 0.52, -0.06, 0.08, 0.08, 0.08, DARK); b.box(0.16, 0.52, 0.08, 0.08, 0.08, 0.08, DARK); },
  plant(b, W, D, c) { b.round(0, 0.17, 0, 0.2, 0.34, '#b9744f'); b.crown(0, 0.72, 0, 0.36, 0.5, 0.36, c); b.crown(0.14, 0.92, -0.06, 0.22, 0.3, 0.22, '#63a56e'); },
  wardrobe(b, W, D, c) { b.box(0, 0.85, 0, W * 0.92, 1.7, 0.56, c); b.box(0, 0.85, 0.285, 0.02, 1.6, 0.01, DARK); for (const x of [-0.07, 0.07]) b.box(x, 0.9, 0.3, 0.03, 0.2, 0.03, STEEL); },
  aquarium(b, W, D, c) { b.box(0, 0.3, 0, 0.8, 0.6, 0.44, WOOD); b.box(0, 0.86, 0, 0.78, 0.5, 0.4, c); b.box(0, 1.13, 0, 0.8, 0.05, 0.42, DARK); b.box(-0.15, 0.9, 0.205, 0.12, 0.06, 0.01, '#ffb347', true); b.box(0.18, 0.78, 0.205, 0.1, 0.05, 0.01, '#ff6f61', true); },
  petbed(b, W, D, c) {
    b.round(0, 0.07, 0, 0.4, 0.14, '#7a8f9a'); b.box(0, 0.24, 0, 0.42, 0.2, 0.24, c); b.ball(0.24, 0.36, 0.02, 0.13, c);
    for (const z of [-0.07, 0.11]) b.box(0.27, 0.5, z, 0.05, 0.1, 0.05, c); b.box(-0.26, 0.3, 0, 0.14, 0.05, 0.05, c);
  },
  cage(b, W, D, c) { b.round(0, 0.03, 0, 0.2, 0.05, DARK); b.round(0, 0.5, 0, 0.025, 0.94, STEEL); b.round(0, 1.2, 0, 0.26, 0.5, '#d8c27a'); b.ball(0, 1.14, 0.2, 0.11, c); b.box(0, 1.14, 0.32, 0.05, 0.04, 0.06, '#c9372c'); },
  // ---- wall items: origin is the mounting point on the wall, facing +z ----
  lamp(b, W, D, c) { b.box(0, 0, 0.04, 0.1, 0.16, 0.08, DARK); b.box(0, 0.06, 0.14, 0.22, 0.24, 0.16, c, true); },
  strip(b, W, D, c) { b.box(0, 0.5, 0.03, 0.9, 0.06, 0.04, c, true); },
  fan(b) { b.box(0, 0, 0.06, 0.1, 0.1, 0.12, DARK); b.box(0, 0, 0.16, 0.56, 0.56, 0.03, STEEL); b.box(0, 0, 0.19, 0.5, 0.1, 0.02, WHITE); b.box(0, 0, 0.19, 0.1, 0.5, 0.02, WHITE); },
  mirror(b, W, D, c) { b.box(0, -0.4, 0.03, 0.74, 1.8, 0.05, WOOD); b.box(0, -0.4, 0.06, 0.64, 1.68, 0.02, c); },
  calendar(b, W, D, c) { b.box(0, 0, 0.02, 0.4, 0.54, 0.03, c); b.box(0, 0.2, 0.04, 0.4, 0.14, 0.02, '#c9372c'); },
  art(b, W, D, c) { b.box(0, 0, 0.03, 0.74, 0.58, 0.05, WOOD); b.box(0, 0, 0.06, 0.62, 0.46, 0.02, c); b.box(-0.1, 0.02, 0.075, 0.2, 0.2, 0.01, '#e8d9b5'); b.box(0.16, -0.08, 0.075, 0.14, 0.14, 0.01, '#7fa6d9'); },
  fallback(b, W, D, c) { b.box(0, 0.3, 0, W * 0.8, 0.6, D * 0.8, c); },
};

export function buildHomeScene(kit: Kit) {
  const { THREE } = kit;
  const group = new THREE.Group();
  const room = new THREE.Group(), furniture = new THREE.Group(), overlay = new THREE.Group(), people = new THREE.Group();
  // Each wall, with its trim and its window or door, is a group of its own: hidden when the camera is behind it.
  const wallGroups: Record<Wall, THREE.Group> = { back: new THREE.Group(), left: new THREE.Group() };
  const hiddenWalls: Record<Wall, boolean> = { back: false, left: false };
  let solids: Solid[] = [];
  group.add(room, furniture, overlay, people);
  group.position.set(SHIFT, 0, SHIFT);
  const glow = new THREE.PointLight('#ffe3b0', 26, 18, 1.5);
  glow.position.set(-1, 3, -1);
  group.add(glow);

  let palette: HomePalette = ROOM_PALETTE, grid = 0, tile = 1, drawn = '', lastState: LifeState | null = null, camera: THREE.Camera | null = null, canvas: HTMLElement | null = null, status = '', undrawn = false;
  let ui: HomeUi = { selected: null, ghost: null, buy: false };
  let who: { look: unknown; seed: string; name: string; pose: Pose | null } = { look: undefined, seed: 'you', name: 'You', pose: null }, guests: Guest[] = [], guestTags: HomeTag[] = [], selfTag: HomeTag | null = null, guestKey = '', restKey = '', dressKey = '';
  const actorMeshes: THREE.Mesh[] = [], markMeshes: THREE.Mesh[] = [];
  // The player's own figure: a group moved by its transform, with one prebuilt figure per pose.
  const avatar = new THREE.Group();
  avatar.name = 'avatar';
  people.add(avatar);
  const figures = new Map<Pose, Figure>();
  let shownFigure: Figure | null = null, shownPose: Pose = 'stand', driven = false, walkGrid: ReturnType<typeof createWalkGrid> | null = null, gridKey = '', restAt: HomeRest | null = null, goalMark: THREE.Mesh | null = null;
  // The skinned body (see the header): asked for on an allowed device; null until it loads, and for good without one.
  const wantsBody = bodyAllowed();
  let body: SkinnedBody | null = null, bodyLoading = false, bodyFailed = false, gone = false, seatAt: { x: number; top: number; z: number; ry: number } | null = null;
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const tools = (parent: THREE.Object3D): Tools => ({
    box: (x, y, z, w, h, d, c, lit) => kit.box(x, y, z, w, h, d, c, parent, lit),
    round: (x, y, z, r, h, c, lit) => kit.round(x, y, z, r, h, c, parent, lit),
    ball: (x, y, z, r, c) => kit.sphere(x, y, z, r, c, parent),
    crown: (x, y, z, sx, sy, sz, c) => kit.mesh(kit.crownGeometry, x, y, z, sx, sy, sz, c, parent),
  });
  const along = (index: number, span = 1) => -ROOM / 2 + (index + span / 2) * tile;

  function announce(next: string, placed: number) {
    if (next === status) return;
    status = next;
    globalThis.window?.dispatchEvent?.(new CustomEvent('jaw:home-scene', { detail: { status, placed } }));
  }

  function buildRoom() {
    room.clear(); wallGroups.back.clear(); wallGroups.left.clear();
    const b = tools(room), back = tools(wallGroups.back), left = tools(wallGroups.left);
    b.box(0, -0.21, 0, ROOM + 0.5, 0.4, ROOM + 0.5, '#6f6253');
    for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) b.box(along(x), 0, along(y), tile * 0.985, 0.03, tile * 0.985, (x + y) % 2 ? palette.floor[0] : palette.floor[1]);
    back.box(-0.125, WALL_HEIGHT / 2, -ROOM / 2 - 0.125, ROOM + 0.25, WALL_HEIGHT, 0.25, palette.back);
    left.box(-ROOM / 2 - 0.125, WALL_HEIGHT / 2, 0, 0.25, WALL_HEIGHT, ROOM, palette.left);
    back.box(0, 0.12, -ROOM / 2 + 0.02, ROOM, 0.24, 0.04, '#8c7a62');
    left.box(-ROOM / 2 + 0.02, 0.12, 0, 0.04, 0.24, ROOM, '#8c7a62');
    // Window on the back wall, door on the side wall — the same slots the placement rules keep clear.
    const wide = Math.min(tile * 0.86, 1.5);
    const wx = along(windowSlot(grid)), dz = along(doorSlot(grid));
    back.box(wx, 2.0, -ROOM / 2 + 0.03, wide, 1.2, 0.07, '#5f4a36');
    back.box(wx, 2.0, -ROOM / 2 + 0.07, wide - 0.16, 1.04, 0.02, '#a9d3ea', true);
    back.box(wx, 2.0, -ROOM / 2 + 0.085, 0.05, 1.04, 0.02, '#5f4a36'); back.box(wx, 2.0, -ROOM / 2 + 0.085, wide - 0.16, 0.05, 0.02, '#5f4a36');
    left.box(-ROOM / 2 + 0.03, 1.15, dz, 0.07, 2.3, wide, '#5f4a36');
    left.box(-ROOM / 2 + 0.075, 1.12, dz, 0.02, 2.1, wide - 0.16, '#8a623d');
    left.box(-ROOM / 2 + 0.11, 1.1, dz + wide * 0.3, 0.05, 0.07, 0.07, '#d8c27a');
    room.add(wallGroups.back, wallGroups.left);
    // The floor reports the camera and canvas the host draws with, so taps can be resolved.
    room.children[0]!.onBeforeRender = (renderer, scene, cam) => { camera = cam; undrawn = false; attach(renderer.domElement); if (wantsBody) startBody(renderer); };
  }

  // ---- the skinned body (capability-gated) ---------------------------------------------------
  /** After the room's first frame: fetch the body module and the body, once. Any failure keeps the procedural figure. */
  function startBody(renderer: THREE.WebGLRenderer) {
    if (body || bodyLoading || bodyFailed || gone) return;
    if (!drawsWebGL2(renderer)) { bodyFailed = true; return; }
    bodyLoading = true;
    const look = who.look ?? lastState?.onboarding?.look ?? null, seed = who.seed;
    setTimeout(() => {
      importBody().then((module) => module.loadBody(kit, look, seed, tile * AVATAR_SCALE)).then((loaded) => {
        bodyLoading = false;
        if (gone) { loaded.dispose(); return; }
        // The look changed while it loaded: recolour, or (the other body) start again on the next frame.
        if (!loaded.wear(who.look ?? lastState?.onboarding?.look ?? null, who.seed)) { loaded.dispose(); globalThis.window?.dispatchEvent?.(new CustomEvent('jaw:home-frame')); return; }
        body = loaded;
        body.fit(tile * AVATAR_SCALE);
        people.add(body.object);
        avatar.visible = false;
        poseBody(shownPose, false);
        // The host draws on request only: ask for the frame that shows it.
        globalThis.window?.dispatchEvent?.(new CustomEvent('jaw:home-frame'));
      }).catch((error: unknown) => {
        bodyLoading = false; bodyFailed = true;
        console.warn('Skinned body unavailable; keeping the drawn avatar:', error);
      });
    }, 0);
  }
  /** Back to the procedural figure (a look that needs the other body file loads it again on the next frame). */
  function dropBody() {
    body?.dispose();
    body = null;
    avatar.visible = true;
  }
  /** Pose the body like the procedural figure: on the seat for a seated activity, else where the avatar is. */
  function poseBody(pose: Pose, animate: boolean) {
    if (!body) return;
    const wanted = pose === 'work' && seatAt ? 'sit' : BODY_POSE[pose];
    const next = wanted === 'sit' && !seatAt ? 'idle' : wanted;
    body.show(next, animate);
    if (next === 'sit' && seatAt) body.sitOn(seatAt.x, seatAt.top, seatAt.z, seatAt.ry);
    else body.place(avatar.position.x, avatar.position.y, avatar.position.z, avatar.rotation.y);
  }
  /** The seat a seated activity uses: the seat nearest where the avatar stands. Null otherwise. */
  function seatFor(state: LifeState | null, near: { x: number; y: number }) {
    const active = state?.activeAction;
    if (!active || active.kind !== 'activity' || !SEATED_ACTIVITIES.has(active.id) || (state.location != null && state.location !== 'home')) return null;
    let best: { x: number; top: number; z: number; ry: number; d: number } | null = null;
    for (const item of Array.isArray(state.home?.items) ? state.home.items : []) {
      const def = FURNITURE[item?.itemId];
      if (!def || def.wall || def.kind !== 'seat') continue;
      const size = footprint(def, item.rot), seat = seatOf(def.shape, def.w, def.h), angle = -item.rot * Math.PI / 2;
      const cx = along(item.x, size.w), cz = along(item.y, size.h), cos = Math.cos(angle), sin = Math.sin(angle);
      for (const lx of seat.xs) {
        const x = cx + (lx * cos + seat.z * sin) * tile, z = cz + (-lx * sin + seat.z * cos) * tile;
        const d = Math.hypot(x - along(near.x), z - along(near.y));
        if (!best || d < best.d) best = { x, top: 0.015 + seat.top * tile, z, ry: angle, d };
      }
    }
    return best && { x: best.x, top: best.top, z: best.z, ry: best.ry };
  }

  /** A group holding one object's model, placed and rotated on its tile(s) or wall slot. */
  function model(def: FurnitureDefinition, x: number, y: number, rot: number, parent: THREE.Object3D) {
    const holder = new THREE.Group();
    if (def.wall) {
      const scale = Math.max(tile, 0.8);
      if (rot === 0) holder.position.set(along(x), WALL_ITEM_Y, -ROOM / 2 + 0.01);
      else { holder.position.set(-ROOM / 2 + 0.01, WALL_ITEM_Y, along(y)); holder.rotation.y = Math.PI / 2; }
      holder.scale.setScalar(scale);
      // It hangs on that wall, and hides with it.
      holder.userData.wall = rot === 0 ? 'back' : 'left';
      holder.visible = !hiddenWalls[holder.userData.wall as Wall];
    } else {
      const size = footprint(def, rot);
      holder.position.set(along(x, size.w), 0.015, along(y, size.h));
      holder.rotation.y = -rot * Math.PI / 2;
      holder.scale.setScalar(tile);
    }
    (SHAPES[def.shape] || SHAPES.fallback)(tools(holder), def.wall ? 1 : def.w, def.wall ? 1 : def.h, def.color, def);
    parent.add(holder);
    return holder;
  }

  /** A flat marker under a footprint (or behind a wall item). */
  function marker(def: FurnitureDefinition, x: number, y: number, rot: number, colour: Colour, lift: number) {
    const b = tools(overlay);
    if (def.wall) {
      const size = Math.max(tile, 0.8) * 0.94;
      const mark = rot === 0 ? b.box(along(x), WALL_ITEM_Y, -ROOM / 2 + 0.006, size, size * 1.2, 0.012, colour, true)
        : b.box(-ROOM / 2 + 0.006, WALL_ITEM_Y, along(y), 0.012, size * 1.2, size, colour, true);
      mark.userData.wall = rot === 0 ? 'back' : 'left';
      mark.visible = !hiddenWalls[mark.userData.wall as Wall];
      return;
    }
    const size = footprint(def, rot);
    b.box(along(x, size.w), lift, along(y, size.h), size.w * tile * 0.97, 0.02, size.h * tile * 0.97, colour, true);
  }

  function rebuild(state: LifeState | null) {
    const house = homeOf(state, HOUSE_DESIGNS, state ? housesFor(state.estate.city) : undefined); // the rented tier, or the design of the house the player built
    const colours = (state && cachedCityContent(state.estate.city)?.homePalette) || ROOM_PALETTE;
    if (house.grid !== grid || colours !== palette) { grid = house.grid; tile = ROOM / grid; palette = colours; buildRoom(); }
    furniture.clear(); overlay.clear();
    const items = Array.isArray(state?.home?.items) ? state.home.items : [];
    let placed = 0;
    for (const item of items) {
      const def = FURNITURE[item?.itemId];
      if (!def) continue;
      model(def, item.x, item.y, item.rot, furniture).userData.objectId = item.id;
      placed += 1;
      // Outside Buy mode the marker follows the spot: it clears when the player moves to another one.
      const spot = KINDS[def.kind]?.spot;
      if (item.id === ui.selected && (ui.buy || !spot || spot === state?.spot)) marker(def, item.x, item.y, item.rot, '#ffd24a', 0.035);
    }
    const ghost = ui.ghost, ghostDef = ghost && FURNITURE[ghost.itemId];
    if (ghostDef) {
      marker(ghostDef, ghost.x, ghost.y, ghost.rot, ghost.valid ? '#35d07f' : '#e5484d', 0.05);
      model(ghostDef, ghost.x, ghost.y, ghost.rot, overlay);
    }
    return placed;
  }

  const signature = (state: LifeState | null) => JSON.stringify([state?.property?.house, state?.home?.items, state?.spot, ui]);

  /** Tiles a standing figure may use: not under furniture. `taken` holds "x,y" keys. */
  function freeTiles(items: readonly { itemId: string; x: number; y: number; rot: number }[]) {
    const taken = new Set<string>();
    for (const item of items) {
      const def = FURNITURE[item?.itemId];
      if (!def || def.wall || def.shape === 'rug' || def.shape === 'mat') continue;
      const size = footprint(def, item.rot);
      for (let dx = 0; dx < size.w; dx++) for (let dy = 0; dy < size.h; dy++) taken.add(`${item.x + dx},${item.y + dy}`);
    }
    return taken;
  }
  /** Where the player stands: on a free tile next to the first object of the chosen spot, else just inside the door. */
  function standing(state: LifeState | null, taken: Set<string>) {
    const items = Array.isArray(state?.home?.items) ? state.home.items : [];
    const door = { x: 0, y: doorSlot(grid) };
    const target = items.find((item) => KINDS[FURNITURE[item?.itemId]?.kind ?? '']?.spot === state?.spot && !FURNITURE[item.itemId]!.wall);
    const centre = target ? (() => { const size = footprint(FURNITURE[target.itemId]!, target.rot); return { x: target.x + (size.w - 1) / 2, y: target.y + (size.h - 1) / 2 }; })() : door;
    let best = null;
    for (let x = 0; x < grid; x++) for (let y = 0; y < grid; y++) {
      if (taken.has(`${x},${y}`)) continue;
      const distance = Math.hypot(x - centre.x, y - centre.y);
      if (!best || distance < best.distance) best = { x, y, distance };
    }
    const tileAt = best || door;
    return { x: tileAt.x, y: tileAt.y, ry: Math.atan2(centre.x - tileAt.x, centre.y - tileAt.y) || 0 };
  }
  function figure(pose: Pose) {
    let entry = figures.get(pose);
    if (!entry) {
      const state = lastState;
      // The player's own figure is seen close up: the best detail characters.js offers a scene (avatar-rig.js).
      entry = buildAvatar(kit, who.look ?? state?.onboarding?.look ?? null, { pose, seed: who.seed, scale: tile * AVATAR_SCALE, marker: 'crown', ...playerOptions(pose) });
      entry.visible = false;
      avatar.add(entry);
      figures.set(pose, entry);
    }
    return entry;
  }
  function show(pose: Pose) {
    const next = figure(pose);
    shownPose = pose;
    if (next === shownFigure) return false;
    if (shownFigure) shownFigure.visible = false;
    next.visible = true;
    shownFigure = next;
    return true;
  }
  function clearFigures() {
    for (const entry of figures.values()) entry.userData.dispose();
    figures.clear();
    shownFigure = null;
  }
  /** Move the avatar (transform only) and its name tag. */
  function moveAvatar(x: number, y: number, z: number, ry: number) {
    avatar.position.set(x, y, z);
    avatar.rotation.y = ry;
    if (body && !body.seated) body.place(x, y, z, ry);
    const top = y + (shownFigure?.userData.top ?? 2.95 * tile * AVATAR_SCALE);
    if (driven && selfTag) { selfTag.position.x = x; selfTag.position.y = top; selfTag.position.z = z; }
    else selfTag = { id: 'self', name: who.name, kind: 'self', text: who.name, marker: 'crown', colour: '#ffd34d', position: { x, y: top, z } };
  }
  /** The floor as a grid: the room, minus every piece of floor furniture. Rebuilt only when either changes. */
  function refreshGrid(state: LifeState | null) {
    const items = (Array.isArray(state?.home?.items) ? state.home.items : []).filter((item) => { const def = FURNITURE[item?.itemId]; return def && !def.wall && def.shape !== 'rug' && def.shape !== 'mat'; });
    const key = JSON.stringify([grid, items.map((item) => [item.itemId, item.x, item.y, item.rot])]);
    if (key === gridKey && walkGrid) return;
    gridKey = key;
    const inset = tile * 0.1, edge = ROOM / 2;
    const block = items.map((item): WalkRect => {
      const size = footprint(FURNITURE[item.itemId]!, item.rot);
      return [-edge + item.x * tile + inset, -edge + item.y * tile + inset, -edge + (item.x + size.w) * tile - inset, -edge + (item.y + size.h) * tile - inset];
    });
    walkGrid = createWalkGrid({ bounds: [-edge + 0.22, -edge + 0.22, edge - 0.15, edge - 0.15], block, cell: 0.25, radius: Math.min(0.3, tile * 0.22) });
    // The same footprints, with heights: what can stand between the camera and the avatar.
    solids = items.map((item, index): Solid => [block[index]![0], 0, block[index]![1], block[index]![2], (TALL[FURNITURE[item.itemId]!.shape] || 0.7) * tile, block[index]![3]]).filter((box) => box[4] > 0.9 * tile);
  }
  /** Hide the walls the camera is behind (and what hangs on them); show the others. True when anything changed. */
  function look(x: number, z: number) {
    const back = z < -ROOM / 2, left = x < -ROOM / 2;
    if (back === hiddenWalls.back && left === hiddenWalls.left) return false;
    hiddenWalls.back = back; hiddenWalls.left = left;
    wallGroups.back.visible = !back; wallGroups.left.visible = !left;
    for (const parent of [furniture, overlay]) for (const child of parent.children) if (child.userData.wall) child.visible = !hiddenWalls[child.userData.wall as Wall];
    return true;
  }
  /** Rebuild what changed about the people: the player's figure, where it rests, the guests. Returns true when anything did. */
  function refreshPeople(state: LifeState | null) {
    const taken = freeTiles(Array.isArray(state?.home?.items) ? state.home.items : []);
    const mine = standing(state, taken);
    const active = state?.location === 'home' || state?.location == null ? state?.activeAction : null;
    const leaving = !who.pose && Boolean(active) && (active?.kind === 'travel' || active?.kind === 'commute');
    const pose = who.pose || (!active ? 'stand' : leaving ? 'walk' : 'work');
    let changed = false;
    refreshGrid(state);
    const dress = JSON.stringify([tile, who.look ?? state?.onboarding?.look ?? null, who.seed]);
    if (dress !== dressKey) {
      dressKey = dress; clearFigures(); if (!rigOf(figure('stand'))) figure('walk'); if (driven) { show(shownPose); moveAvatar(avatar.position.x, avatar.position.y, avatar.position.z, avatar.rotation.y); } changed = true;
      if (body) { if (body.wear(who.look ?? state?.onboarding?.look ?? null, who.seed)) body.fit(tile * AVATAR_SCALE); else dropBody(); }
    }
    restAt = { spot: state?.spot ?? null, x: along(mine.x), y: 0.03, z: along(mine.y), ry: mine.ry, pose, busy: Boolean(active) && !leaving && !who.pose, leaving, fixed: Boolean(who.pose) };
    if (wantsBody) {
      const seat = seatFor(state, mine);
      if (JSON.stringify(seat) !== JSON.stringify(seatAt)) { seatAt = seat; if (body && !driven) changed = true; }
    }
    const rest = JSON.stringify([grid, mine, pose, who.name]);
    if (rest !== restKey) {
      restKey = rest; changed = true;
      if (selfTag) { selfTag.name = who.name; selfTag.text = who.name; }
    }
    if (changed && !driven) { show(pose); moveAvatar(restAt.x, restAt.y, restAt.z, restAt.ry); poseBody(pose, false); }
    const guestsNow = JSON.stringify([grid, mine, guests]);
    if (guestsNow === guestKey) return changed;
    guestKey = guestsNow;
    releaseObjects(actorMeshes);
    taken.add(`${mine.x},${mine.y}`);
    const scale = tile * AVATAR_SCALE;
    const batch = createBatch(THREE);
    guestTags = [];
    // Guests wait on the free tiles nearest the door.
    const door = { x: 0, y: doorSlot(grid) }, spare: { x: number; y: number; d: number }[] = [];
    for (let x = 0; x < grid; x++) for (let y = 0; y < grid; y++) if (!taken.has(`${x},${y}`)) spare.push({ x, y, d: Math.hypot(x - door.x, y - door.y) });
    spare.sort((a, b) => a.d - b.d);
    const placed = guests.slice(0, Math.min(MAX_GUESTS_SHOWN, spare.length)).map((guest, index) => ({ ...guest, x: along(spare[index]!.x), y: 0.03, z: along(spare[index]!.y), ry: Math.PI / 2, scale }));
    for (const [index, person] of placed.entries()) {
      const drawn = drawAvatar(batch, person.look ?? null, { x: person.x, y: person.y, z: person.z, ry: person.ry, pose: 'stand', seed: person.seed ?? person.id, scale, marker: person.kind === 'npc' ? 'npc' : 'player' });
      const name = String(person.name ?? '');
      guestTags.push({ id: String(person.id ?? `guest-${index}`), name, kind: person.kind === 'npc' ? 'npc' : 'player', text: person.kind === 'npc' ? name : `@${name}`, marker: person.kind === 'npc' ? 'dot' : 'tag',
        colour: person.kind === 'npc' ? '#58d68a' : '#6fb4ff', position: { x: person.x, y: drawn.top, z: person.z } });
    }
    const builtBatch = batch.build(sceneMaterials(kit));
    for (const mesh of builtBatch.meshes) { mesh.name = `home-people-${mesh.name}`; people.add(mesh); actorMeshes.push(mesh); }
    return true;
  }

  /** Rebuild if anything visible changed. Returns true when it did. */
  function refresh(state: LifeState | null) {
    const next = signature(state);
    if (next === drawn) return false;
    drawn = next;
    try { const placed = rebuild(state); announce(placed ? 'ready' : 'empty', placed); }
    catch (error) { console.error('Home scene failed to build:', error); furniture.clear(); overlay.clear(); announce('error', 0); }
    return true;
  }

  /** What is under a point of the canvas: { id (furniture), cell (floor tile), x, z (the floor point), rect (the furniture's footprint) } | null. */
  function pickAt(clientX: number, clientY: number): HomePick | null {
    if (!group.visible || !camera || !canvas || !lastState) return null;
    const box = canvas.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    pointer.set(((clientX - box.left) / box.width) * 2 - 1, -((clientY - box.top) / box.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    group.updateMatrixWorld(true);
    let id = null;
    // What hangs on a hidden wall cannot be tapped.
    for (let node: THREE.Object3D | null | undefined = raycaster.intersectObjects(furniture.children.filter((child) => child.visible), true)[0]?.object; node && !id; node = node.parent) id = node.userData.objectId ?? null;
    let cell = null, x = NaN, z = NaN;
    const point = raycaster.ray.intersectPlane(floorPlane, new THREE.Vector3());
    if (point) {
      group.worldToLocal(point);
      x = point.x; z = point.z;
      const cx = Math.floor((point.x + ROOM / 2) / tile), cy = Math.floor((point.z + ROOM / 2) / tile);
      if (cx >= 0 && cy >= 0 && cx < grid && cy < grid) cell = { x: cx, y: cy };
    }
    if (!id && !cell) return null;
    let rect: HomePick['rect'] = null;
    const item = id ? lastState.home?.items?.find((entry) => entry.id === id) : null, def = FURNITURE[item?.itemId ?? ''];
    if (def && item && !def.wall) { const size = footprint(def, item.rot); rect = [-ROOM / 2 + item.x * tile, -ROOM / 2 + item.y * tile, -ROOM / 2 + (item.x + size.w) * tile, -ROOM / 2 + (item.y + size.h) * tile]; }
    return { id, cell, x, z, rect };
  }
  /** Tell the Buy panel / home chip that an object or a tile was chosen — what a tap has always done. */
  function use(id?: string | null, cell?: { x: number; y: number } | null) { window.dispatchEvent(new CustomEvent('jaw:home-pick', { detail: { id: id ?? null, cell: cell ?? null } })); }
  function onPick(event: MouseEvent) {
    // Outside Buy mode the host walks the avatar to the furniture first, then calls use().
    if (driven && !buying()) return;
    const hit = pickAt(event.clientX, event.clientY);
    if (hit) use(hit.id, hit.cell);
  }
  function attach(element: HTMLElement) {
    if (canvas || !element?.addEventListener) return;
    canvas = element;
    canvas.addEventListener('click', onPick);
  }

  const onUi = (event: Event) => {
    const detail = (event as CustomEvent<{ selected?: unknown; buy?: unknown; ghost?: HomeGhost | null; retry?: unknown } | null>).detail || {};
    ui = { selected: typeof detail.selected === 'string' ? detail.selected : null, buy: detail.buy === true, ghost: detail.ghost && FURNITURE[detail.ghost.itemId] ? { ...detail.ghost } : null };
    if (detail.retry) { drawn = ''; status = ''; }
    // Rebuild now so the frame the sender asks the host for shows it; drawing stays the host's job.
    // `undrawn` makes the next update() report a change unless a frame has been drawn meanwhile.
    if (lastState && refresh(lastState)) undrawn = true;
  };
  globalThis.window?.addEventListener?.('jaw:home-ui', onUi);
  // The Buy panel says `buy` only when it has something to draw; the shell's view is known the moment Buy opens.
  // (A scene built while Buy is already open reads the view the shell wrote on its root element.)
  let shellMode = globalThis.document?.querySelector?.<HTMLElement>('.life-ui')?.dataset?.mode || 'venue';
  const onMode = (event: Event) => { shellMode = (event as CustomEvent<{ mode?: string } | null>).detail?.mode || 'venue'; };
  const buying = () => ui.buy || shellMode === 'buy';
  globalThis.window?.addEventListener?.('jaw:mode', onMode);

  grid = HOUSES[DEFAULT_HOUSE].grid; tile = ROOM / grid;
  buildRoom();

  return {
    group,
    background: '#c9d6cf',
    // [horizon, zenith]: a soft morning haze rather than a flat fill; the host grades between them.
    sky: ['#c9d6cf', '#8fb0b4'] as [Colour, Colour],
    ground: '#7f8f7c',
    camera: { landscape: [17.5, 19.5, 17.5], portrait: [19, 24, 19] } as SceneCamera,
    update(state: LifeState) {
      const first = lastState === null;
      lastState = state;
      const room = refresh(state);
      const changed = refreshPeople(state) || room || first || undrawn;
      undrawn = false;
      return changed;
    },
    /** The player's avatar: { look, seed, name, pose? }. Returns true when it changed what is drawn. */
    setPlayer({ look, seed, name, pose }: HomePlayer = {}) {
      who = { look, seed: seed ?? 'you', name: String(name ?? 'You'), pose: (pose as Pose | null | undefined) || null };
      return refreshPeople(lastState);
    },
    /** Guests the host let in, standing by the door: [{ id, name, look?, seed? }]. */
    setCrowd(list: unknown) {
      guests = (Array.isArray(list) ? list as Record<string, unknown>[] : []).filter((person) => person && typeof person === 'object').slice(0, MAX_GUESTS_SHOWN)
        .map((person) => ({ id: person.id, name: person.name, kind: person.kind, look: person.look ?? null, seed: person.seed ?? person.id }));
      refreshPeople(lastState);
      return guestTags;
    },
    tags: () => (selfTag ? [selfTag, ...guestTags] : [...guestTags]),
    look,
    // The skinned body's sit-down (always false without the body): the host steps it in its motion loop.
    get easing() { return Boolean(body?.easing); },
    stepCrowd(dt: number) { return body ? body.step(dt) : false; },
    settleCrowd() { body?.settle(); },
    /** Which walls are showing right now: { back, left } (true = shown). */
    get walls() { return { back: !hiddenWalls.back, left: !hiddenWalls.left }; },
    /** True in Buy mode: taps place and pick furniture, and the host does not walk the avatar. */
    get placing() { return buying(); },
    pickAt, use,
    /** Floor furniture and where it stands, for diagnostics: [{ id, itemId, x, z }] (centre of the footprint). */
    objects() {
      return (Array.isArray(lastState?.home?.items) ? lastState.home.items : []).filter((item) => FURNITURE[item?.itemId] && !FURNITURE[item.itemId]!.wall)
        .map((item) => { const size = footprint(FURNITURE[item.itemId]!, item.rot); return { id: item.id, itemId: item.itemId, x: along(item.x, size.w), z: along(item.y, size.h) }; });
    },
    /** Walking — the same contract as a venue scene's `walk` (src/scene/venue-scenes.ts). */
    walk: {
      get grid() { return walkGrid; },
      get entrance() { return { x: along(0), y: 0.03, z: along(doorSlot(grid)), ry: Math.PI / 2 }; },
      open: false,
      get scale() { return tile * AVATAR_SCALE; },
      // The camera turns about the middle of the room, so a full orbit keeps the room in place on screen
      // (the host already lifts the scene clear of the bottom panels through its insets).
      centre: [0, 0.7, 0] as Vec3,
      avatar,
      drive(on: unknown) { driven = Boolean(on); if (!driven && restAt) { show(restAt.pose); moveAvatar(restAt.x, restAt.y, restAt.z, restAt.ry); poseBody(restAt.pose, false); } },
      rest: () => restAt,
      spots: () => [],
      people: () => guestTags.map((tag) => ({ id: tag.id, kind: tag.kind, x: tag.position.x, z: tag.position.z, top: tag.position.y })),
      get solids() { return solids; },
      move: moveAvatar,
      pose: (name: string) => {
        rigOf(figures.get('stand'))?.rest();
        const pose = (POSES as readonly string[]).includes(name) ? name as Pose : 'stand';
        const shown = show(pose);
        // Straight off a walk the host's motion loop is running, so the sit-down can play out (easing).
        if (body) { const walking = body.pose === 'walk' || body.pose === 'jog'; poseBody(pose, walking); return true; }
        return shown;
      },
      // With a rigged figure the limbs swing with `phase`; without one the two figures alternate (avatar-rig.js).
      gait(step: boolean, phase = 0, jog = false) {
        if (body) { body.stride(phase, jog); body.place(avatar.position.x, avatar.position.y, avatar.position.z, avatar.rotation.y); }
        const rig = rigOf(figures.get('stand')); if (rig) { rig.stride(phase, 1, jog); return show('stand'); } return show(step ? 'walk' : 'stand');
      },
      heightAt: () => 0.03,
      near: () => false,
      goal(x?: number, z?: number) {
        const visible = Number.isFinite(x);
        if (!goalMark) {
          if (!visible) return false;
          const batch = createBatch(THREE);
          batch.cyl(0, 0.07, 0, 0.36, 0.04, '#ffffff', { seg: 14, open: true, layer: 'glow' }); batch.disc(0, 0.06, 0, 0.12, '#ffffff', { seg: 10, layer: 'glow' });
          goalMark = batch.build(sceneMaterials(kit)).meshes[0]!;
          goalMark.name = 'mark-goal';
          group.add(goalMark); markMeshes.push(goalMark);
        }
        const changed = goalMark.visible !== visible || (visible && (goalMark.position.x !== x || goalMark.position.z !== z));
        goalMark.visible = visible;
        if (visible) goalMark.position.set(x!, 0, z!);
        return changed;
      },
    },
    /** Free the avatars and stop listening; the room's own meshes use the kit's shared geometry. */
    dispose() {
      releaseObjects(actorMeshes);
      releaseObjects(markMeshes);
      goalMark = null;
      clearFigures();
      gone = true;
      dropBody();
      globalThis.window?.removeEventListener?.('jaw:home-ui', onUi);
      globalThis.window?.removeEventListener?.('jaw:mode', onMode);
      canvas?.removeEventListener?.('click', onPick);
      canvas = null;
      group.parent?.remove(group);
    },
  };
}

/** What buildHomeScene returns: the scene entry the host drives. */
export type HomeScene = ReturnType<typeof buildHomeScene>;
