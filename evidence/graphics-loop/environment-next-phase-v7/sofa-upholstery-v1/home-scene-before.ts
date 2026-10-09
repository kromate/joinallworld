/**
 * OWNER: home
 * The home interior. Same builder contract as src/scene/venue-scenes.ts:
 *   buildHomeScene(kit, venue) → { group, background, camera, update(state) → boolean,
 *                                  setPlayer, setCrowd, tags, dispose }
 *
 * WHAT IT DRAWS
 *   The house on its plot (plotOf, src/game/home-layout.ts; rooms and stairs from planOf,
 *   src/game/home-plan.ts): a rented room is one grid × grid room; an owned house is several rooms
 *   on one, two or three floors, each floor WALL_HEIGHT above the last. Checkerboard tiles (light
 *   tiles in wet rooms, terrazzo outside), walls between rooms cut low with their doorways open,
 *   stairs with rails, the two outer walls of every floor with a window and the door, and every
 *   placed object from state.home.items as a simple low-poly shape at its tile, rotation and floor.
 *   Wall items hang on the two outer walls of their floor.
 *   ONE MESH PER FLOOR, NOT PER BOX. The house and the furniture are each one geometry batch
 *   (build.ts) with a part per floor and per outer wall ('f1', 'f1-back', 'f1-left'), so a villa
 *   full of furniture is a few dozen draw calls. Only the Buy mode ghost and markers are kit meshes.
 *   DOLLHOUSE: the camera may orbit all the way round. look(x, z) — called by the host with the
 *   camera's place before each frame — hides whichever outer wall the camera has gone behind, together
 *   with its window or door and every wall item hanging on it (lamps, the calendar, art), so the
 *   room is always visible; and the floors above the one the avatar is on are lifted off, so the
 *   floor it walks is seen from above. It only flips `visible`; nothing is rebuilt.
 *   The object the player picked gets a yellow marker; in Buy mode the placement ghost gets a
 *   green (valid) or red (invalid) footprint.
 *   The player's own avatar (state.onboarding.look, drawn by src/scene/characters.ts) stands
 *   beside the furniture of the spot they chose — or by the door — and guests the host has let
 *   in (setCrowd) stand just inside the door. Guests are one merged mesh, rebuilt on change; the
 *   player's own avatar is a separate prebuilt figure per pose that is only ever moved.
 *
 * WALKING (see src/scene/movement.ts; the host, src/venue-world.ts, does the walking)
 *   `walk` is the same contract as a venue scene's: the walkable description is the plot's
 *   bounds plus one obstacle rectangle per piece of floor furniture in state.home.items (rugs and
 *   mats are walked over), the walls between rooms and the stairs' rails, one grid per floor,
 *   rebuilt only when the furniture changes. walk.grid answers for the floor the avatar is on;
 *   heightAt climbs the stairs, and past a flight's middle the avatar is on the next floor. A resting
 *   place on another floor comes with its way there (rest().approach / steps: up the stairs).
 *   Outside Buy mode a tap on
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
 *   in   'jaw:home-ui'     detail { selected: objectId | null, buy: boolean, floor, ghost: { itemId, x, y, rot, floor, valid } | null, retry? }
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
 *   furniture activity it takes the furniture: sits on a chair or sofa, lies on a bed or mat (sleep, stay in bed, nap),
 *   soaks in the tub, washes at a bucket or shower (sit-enter / lie-down play when the avatar walked there; sit-exit /
 *   get-up play where it lay). It asks for its first frame with 'jaw:home-frame'; those clips run through `easing` /
 *   stepCrowd / settleCrowd. Without WebGL2 (and in
 *   Node tests) `body` stays null and the body module is never imported.
 *   After the canonical player is drawn, guests use that same body/appearance/wardrobe loader and kit cache.
 *   Guest clones load one at a time, retain their public tags and positions, and replace only their own fallback.
 *   Stale results are disposed on a look change, removal or scene disposal; failures wait for an explicit retry.
 */
import { FURNITURE as CATALOGUE, KINDS as KIND_TABLE, HOME_ACTIVITIES, PORTED_ACTIVITY_KIND } from '../../../../src/game/content/furniture.ts';
import { RECIPES } from '../../../../src/game/content/food.ts';
import { createBatch, sceneMaterials, releaseObjects } from '../../../../src/scene/build.ts';
import { plant } from '../../../../src/scene/props.ts';
import { drawAvatar, buildAvatar, POSES } from '../../../../src/scene/characters.ts';
import type { Pose } from '../../../../src/scene/characters.ts';
import { playerOptions, rigOf } from '../../../../src/scene/avatar-rig.ts';
import { createWalkGrid } from '../../../../src/scene/movement.ts';
import { bodyAllowed, drawsWebGL2, importBody } from '../../../../src/scene/body/gate.ts';
import { createCanonicalCrowd } from '../../../../src/scene/body/canonical-crowd.ts';
import { lightingFor, timeOfDay } from '../../../../src/scene/lighting.ts';
import { createObjectSequence } from '../../../../src/scene/smart-objects/sequence.ts';
import { createUseProps } from '../../../../src/scene/smart-objects/props.ts';
import { createHingedHomeDoor } from '../../../../src/scene/smart-objects/door.ts';
import type { ObjectAction } from '../../../../src/scene/smart-objects/sequence.ts';
import type { BodyPose, SkinnedBody } from '../../../../src/scene/body/skinned.ts';
import { HOUSES, DEFAULT_HOUSE, homeOf } from '../../../../src/game/content/housing.ts';
import { housesFor } from '../../../../src/game/cities/housingRuntime.ts';
import { cachedCityContent } from '../../../../src/game/cities/registry.ts';
import type { HomePalette } from '../../../../src/types/content.ts';
import { HOUSE_DESIGNS, HOUSE_STYLE } from '../../../../src/game/content/world.ts';
import { footprint, windowSlot, doorSlot, plotOf } from '../../../../src/game/home-layout.ts';
import type { Plot } from '../../../../src/game/home-layout.ts';
import { planOf, wallsOf, bumpsOf, railsOf, flightAt, stairwellOf, routeOf, slabOf, finishAt, nearestFree } from '../../../../src/game/home-plan.ts';
import type { HousePlan, PlanStairs, PlanWall } from '../../../../src/game/home-plan.ts';
import type * as THREE from 'three';
import type { Kit } from '../../../../src/scene/kit.ts';
import type { Batch, Colour, SceneCamera, TimeOfDay, Vec3 } from '../../../../src/scene/types.ts';
import type { WalkGrid, WalkPoint, WalkRect } from '../../../../src/scene/movement.ts';
import type { FurnitureDefinition } from '../../../../src/types/content.ts';
import type { HouseStyle, LifeState, PlacedItem } from '../../../../src/types/life.ts';

/** Public furnishings only. Visits keep the viewer's avatar and never act on these items. */
export interface VisitHomeScene { grid: number; style: HouseStyle; items: readonly PlacedItem[]; owned: boolean }

/** The modelling tools a furniture shape draws with (the kit's primitives bound to one group, or a batch part). */
export interface Tools {
  box(x: number, y: number, z: number, w: number, h: number, d: number, c: Colour, lit?: boolean): unknown;
  round(x: number, y: number, z: number, r: number, h: number, c: Colour, lit?: boolean): unknown;
  ball(x: number, y: number, z: number, r: number, c: Colour, ry?: number, rz?: number, seg?: number): unknown;
}
/** Draws one catalogue shape: W × D tiles, colour, and the catalogue entry. */
type Shape = (b: Tools, W: number, D: number, c: Colour, def: FurnitureDefinition) => void;
/** The UI-only state the Buy panel sends ('jaw:home-ui'). */
export interface HomeGhost { itemId: string; x: number; y: number; rot: number; floor?: number; valid?: boolean }
export interface HomeUi { selected: string | null; ghost: HomeGhost | null; buy: boolean; floor?: number }
/** A name tag the host projects into the DOM (the scene's `tags()`). */
export interface HomeTag { id: string; name: string; kind: string; text: string; marker: string; colour: string; position: { x: number; y: number; z: number } }
/** The player's avatar as the host hands it over (setPlayer). */
export interface HomePlayer { look?: unknown; seed?: string; name?: unknown; pose?: string | null }
/** What the host knows about where the avatar belongs (`walk.rest()`). */
export interface HomeRest { spot: string | null; x: number; y: number; z: number; ry: number; pose: Pose; busy: boolean; leaving: boolean; fixed: boolean; approach?: WalkPoint; steps?: WalkPoint[] }
/** What is under a tap (`pickAt`). */
export interface HomePick { id: string | null; cell: { x: number; y: number } | null; x: number; z: number; rect: [number, number, number, number] | null }
type Wall = 'back' | 'left';
type Solid = [number, number, number, number, number, number];
/** A figure built by characters.ts (one prebuilt per pose). */
type Figure = ReturnType<typeof buildAvatar>;
/** A guest the host let in, as setCrowd keeps it. */
interface Guest { id: unknown; name: unknown; kind: unknown; look: unknown; seed: unknown }
interface PlacedGuest extends Guest { actorId: string; x: number; y: number; z: number; ry: number; scale: number }
const FURNITURE = CATALOGUE as unknown as Readonly<Record<string, FurnitureDefinition | undefined>>;
const KINDS = KIND_TABLE as unknown as Readonly<Record<string, { spot: string | null } | undefined>>;
const ROOM = 10;         // world units along each wall, whatever the grid size
const WALL_HEIGHT = 3.4;
const SHOWER_HEAD = 1.98;
const WALL_ITEM_Y = 1.95;
const SHIFT = -2.5;      // the room sits up-screen so the bottom panels do not cover it
/** Skinned body only: the body pose each furniture kind gives its activities, and those activities (engine id → kind). */
export const REST_POSE: Readonly<Record<string, BodyPose | undefined>> = { seat: 'sit', bed: 'lie', tub: 'soak', bath: 'wash' };
export const REST_KIND = new Map([...HOME_ACTIVITIES.map((activity) => [`home-${activity.id}`, activity.needs] as const), ...Object.entries(PORTED_ACTIVITY_KIND),
  ...Object.values(RECIPES).map((recipe) => [`home-${recipe.id}`, recipe.station] as const)]);
/**
 * Skinned body only: where the body goes on a piece, in the model's tile units (origin the footprint centre, facing
 * +z, the backrest or pillow behind at −z): the seat or mattress top, how far forward of the centre the pelvis is,
 * the places across the width, and a turn from +z (the tub's bather faces the tap). Read off SHAPES below; lying,
 * the head (0.64 tiles behind the hips) is on the pillow.
 */
export function seatOf(shape: string, W: number, D: number): { top: number; z: number; xs: number[]; turn?: number } {
  const across = (step: number) => Array.from({ length: W }, (_, i) => (i - (W - 1) / 2) * step);
  if (shape === 'chair') return { top: 0.41, z: -0.08, xs: [0] };
  if (shape === 'sofa') return { top: 0.5, z: -D * 0.25 + 0.13, xs: across(0.82) };
  if (shape === 'beanbag') return { top: 0.45, z: 0.02, xs: [0] };
  if (shape === 'bed') return { top: 0.56, z: 0.64 - D * 0.38, xs: across(0.8) };
  if (shape === 'mat') return { top: 0.08, z: 0.64 - D * 0.36, xs: [0] };
  if (shape === 'tub') return { top: 0.1, z: 0, xs: [W * 0.2], turn: -Math.PI / 2 };
  return { top: 0.45, z: 0, xs: [0] };
}
/** Skinned body only: a spot on a piece (pelvis over x, z on a top at `top`, facing ry), and an activity's pose there. */
type Spot = ObjectAction['use'];
interface Rest { pose: BodyPose; at?: Spot; id?: string; table?: ObjectAction['table']; surface?: ObjectAction['surface'] }
/** Skinned body only: the clip pose for each procedural pose. 'sit' needs a seat (else idle). */
const BODY_POSE: Record<Pose, BodyPose> = { stand: 'idle', sit: 'sit', walk: 'walk', jog: 'jog', wave: 'interact', work: 'interact', dance: 'dance', relax: 'idle' };
/** The shared room colours (Lagos): a city's content may give its own `homePalette`. */
export const ROOM_PALETTE: HomePalette = Object.freeze({ back: '#d7ccb0', left: '#c3cbb6', floor: Object.freeze(['#d9cdb4', '#bfae8f'] as const) });
const WOOD = '#7a5c40', DARK = '#33373d', WHITE = '#f3f1ea', STEEL = '#9aa3a8';
/** An avatar is 2.45 units tall in venue scale; furniture here is modelled one unit per tile (about a metre). */
const AVATAR_SCALE = 0.72;
export const MAX_GUESTS_SHOWN = 5;
/** How tall each furniture shape stands, in tiles — what can come between the camera and the avatar (camera-collision.js). Unlisted shapes are low. */
const TALL: Record<string, number | undefined> = { bed: 1.3, fridge: 1.9, shower: SHOWER_HEAD + 0.02, speaker: 1.25, tv: 1.4, shelf: 1.5, wardrobe: 1.7, tripod: 1.25, mic: 1.3, floorlamp: 1.7, cage: 1.5, aquarium: 1.15, plant: 1.1, drum: 1, cooker: 1.1, desk: 1, bench: 1, inverter: 0.95, chair: 0.95, sofa: 0.85 };

const legs = (b: Tools, w: number, d: number, h: number, c: Colour = WOOD) => { for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) b.box(x, h / 2, z, 0.06, h, 0.06, c); };
/** A low-profile ellipsoid used for padded upholstery; segment count stays bounded in the furniture batch. */
const pad = (b: Tools, x: number, y: number, z: number, rx: number, ry: number, rz: number, c: Colour) => b.ball(x, y, z, rx, c, ry, rz, 6);

/** One low-poly model per catalogue `shape`. Units are tiles; origin is the footprint centre on the floor; W × D is the footprint. */
const SHAPES: { fallback: Shape; [shape: string]: Shape | undefined } = {
  mat(b, W, D, c) { b.box(0, 0.04, 0, W * 0.84, 0.06, D * 0.9, c); b.box(0, 0.1, -D * 0.36, W * 0.5, 0.07, D * 0.12, WHITE); },
  bed(b, W, D, c, def) {
    legs(b, W * 0.82, D * 0.78, 0.08, WOOD);
    b.box(0, 0.2, 0, W * 0.92, 0.26, D * 0.94, WOOD);
    b.box(0, 0.42, 0, W * 0.86, 0.2, D * 0.9, WHITE);
    b.box(0, 0.54, D * 0.14, W * 0.88, 0.07, D * 0.58, c);
    for (let i = 0; i < W; i++) pad(b, (i - (W - 1) / 2) * 0.8, 0.55, -D * 0.38, 0.27, 0.08, D * 0.08 + 0.04, '#ffffff');
    b.box(0, 0.5 + def.stars * 0.08, -D * 0.47, W * 0.92, 0.7 + def.stars * 0.16, 0.07, def.stars >= 4 ? '#c9a227' : WOOD);
  },
  stove(b, W, D, c) {
    b.box(0, 0.5, 0, 0.82, 0.06, 0.82, '#8a6b4a'); legs(b, 0.68, 0.68, 0.5);
    b.round(0, 0.63, 0, 0.2, 0.2, c);
  },
  cooker(b, W, D, c) {
    b.box(0, 0.43, 0, W * 0.84, 0.86, D * 0.8, c);
    // Keep the cooking surface at y=.94 (the host's existing cooking-use anchor).
    b.box(0, 0.88, 0, W * 0.86, 0.04, D * 0.82, '#303438');
    for (let i = 0; i < W * 2; i++) {
      const x = (i + 0.5) * 0.42 - W * 0.42;
      b.round(x, 0.91, 0, 0.14, 0.025, '#555b60');
      b.round(x, 0.927, 0, 0.07, 0.012, '#25292d');
    }
    // A raised rear splash/control rail and a glazed oven door make the appliance read as a range.
    b.box(0, 1.0, -D * 0.37, W * 0.84, 0.2, 0.05, c);
    b.box(0, 0.76, D * 0.405, W * 0.78, 0.12, 0.03, '#72797c');
    for (let i = 0; i < W * 2; i++) b.box((i + 0.5) * 0.42 - W * 0.42, 0.76, D * 0.43, 0.055, 0.055, 0.035, DARK);
    b.box(0, 0.39, D * 0.408, W * 0.62, 0.42, 0.026, '#282d31');
    b.box(0, 0.39, D * 0.425, W * 0.48, 0.28, 0.012, '#40474b');
    b.box(0, 0.68, D * 0.44, W * 0.48, 0.035, 0.04, STEEL);
    b.box(0, 0.12, D * 0.405, W * 0.7, 0.035, 0.03, DARK);
  },
  cooler(b, W, D, c) { b.box(0, 0.24, 0, 0.62, 0.44, 0.44, c); b.box(0, 0.5, 0, 0.66, 0.09, 0.48, WHITE); b.box(0, 0.58, 0, 0.3, 0.05, 0.06, c); },
  fridge(b, W, D, c, def) {
    const h = 1.3 + def.stars * 0.12;
    b.box(0, h / 2, 0, 0.74, h, 0.7, c);
    b.box(0, h / 2, 0.357, 0.68, h * 0.95, 0.018, c);
    b.box(0, 0.07, 0.371, 0.64, 0.1, 0.035, '#aeb7ba');
    if (def.stars >= 3) {
      b.box(0, h * 0.5, 0.371, 0.018, h * 0.9, 0.02, '#aeb7ba');
      for (const side of [-1, 1]) b.box(side * 0.065, h * 0.54, 0.394, 0.035, h * 0.28, 0.025, STEEL);
    } else {
      b.box(0, h * 0.72, 0.371, 0.66, 0.018, 0.02, '#aeb7ba');
      b.box(0.27, h * 0.5, 0.394, 0.035, h * 0.3, 0.025, STEEL);
    }
  },
  drum(b, W, D, c) {
    // A ribbed polyethylene drum with a domed shoulder, threaded fill cap and front tap.
    b.round(0, 0.44, 0, 0.34, 0.82, c);
    b.ball(0, 0.83, 0, 0.34, c, 0.12, 0.34, 9);
    for (const y of [0.2, 0.52]) b.round(0, y, 0, 0.35, 0.018, '#315d86');
    b.round(0, 0.94, 0, 0.15, 0.06, '#315d86');
    b.round(0, 0.98, 0, 0.105, 0.025, '#244866');
    b.box(0, 0.28, 0.345, 0.12, 0.06, 0.11, '#344b58');
    b.box(0, 0.22, 0.405, 0.055, 0.1, 0.09, '#9bbbc1');
  },
  bucket(b, W, D, c) { b.round(-0.12, 0.2, -0.08, 0.22, 0.4, c); b.round(-0.12, 0.41, -0.08, 0.24, 0.03, '#8fc6d8'); b.round(0.24, 0.07, 0.2, 0.16, 0.12, '#d9574f'); },
  shower(b, W, D, c) {
    b.box(0, 0.04, 0, 0.9, 0.08, 0.9, WHITE);
    b.box(-0.44, 1.03, 0, 0.03, 1.9, 0.9, c); b.box(0, 1.03, -0.44, 0.9, 1.9, 0.03, c);
    b.round(-0.32, 1.02, -0.32, 0.025, 1.9, STEEL); b.box(-0.2, SHOWER_HEAD, -0.2, 0.24, 0.04, 0.24, STEEL);
  },
  tub(b, W, D, c) {
    b.box(0, 0.08, 0, W * 0.9, 0.12, D * 0.8, c);
    for (const s of [-1, 1]) { b.box(s * W * 0.42, 0.30, 0, W * 0.06, 0.48, D * 0.8, c); b.box(0, 0.30, s * D * 0.36, W * 0.9, 0.48, D * 0.08, c); }
    b.box(0, 0.50, 0, W * 0.78, 0.04, D * 0.6, '#bfe3ee'); b.round(-W * 0.38, 0.66, 0, 0.03, 0.26, STEEL);
  },
  toilet(b, W, D, c) { b.round(0, 0.19, 0.08, 0.19, 0.38, c); b.round(0, 0.41, 0.1, 0.25, 0.07, c); b.box(0, 0.55, -0.27, 0.46, 0.5, 0.18, c); b.box(0, 0.82, -0.27, 0.5, 0.05, 0.22, WHITE); },
  basin(b, W, D, c) { b.round(0, 0.1, 0, 0.36, 0.2, c); b.round(0, 0.2, 0, 0.3, 0.02, '#8fc6d8'); },
  chair(b, W, D, c) {
    // A molded stack chair: seat shell, long rear standards and an open slatted back.
    b.box(0, 0.38, 0, 0.5, 0.06, 0.5, c);
    for (const x of [-0.21, 0.21]) {
      b.box(x, 0.18, 0.21, 0.05, 0.36, 0.05, c);
      b.box(x, 0.45, -0.21, 0.05, 0.9, 0.05, c);
    }
    b.box(0, 0.48, -0.23, 0.46, 0.06, 0.05, c);
    for (const x of [-0.1, 0.1]) b.box(x, 0.68, -0.23, 0.07, 0.36, 0.05, c);
    b.box(0, 0.88, -0.23, 0.46, 0.06, 0.05, c);
  },
  sofa(b, W, D, c) {
    legs(b, W * 0.78, D * 0.66, 0.14, WOOD);
    b.box(0, 0.23, 0, W * 0.94, 0.24, D * 0.84, c);
    b.box(0, 0.46, -D * 0.35, W * 0.94, 0.42, D * 0.16, c);
    for (const side of [-1, 1]) b.box(side * (W * 0.47 - 0.07), 0.46, 0, 0.14, 0.32, D * 0.84, c);
    // Paired shallow slabs create a short, readable cushion bevel without the
    // angular diamond ends of low-segment ellipsoids.
    for (let i = 0; i < W; i++) {
      const x = (i - (W - 1) / 2) * 0.82;
      b.box(x, 0.44, D * 0.06, 0.78, 0.1, D * 0.48, '#f0e6d6');
      b.box(x, 0.48, D * 0.045, 0.7, 0.04, D * 0.42, '#f0e6d6');
      b.box(x, 0.57, -D * 0.30, 0.78, 0.30, D * 0.10, '#f0e6d6');
      b.box(x, 0.74, -D * 0.30, 0.7, 0.06, D * 0.08, '#f0e6d6');
    }
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

const TRIM = '#8c7a62', RAIL = '#4a4038';
/** How high the walls between rooms stand: cut low, so every room of the floor can be seen into. */
const INNER = 1.15;
const lift = (floor: number) => floor * WALL_HEIGHT;
const floorOf = (item: { floor?: number | undefined } | null | undefined) => item?.floor ?? 0;
/** The catalogue entry of a piece that stands on the floor in the way (not a wall item, rug or mat). */
const solidOf = (item: { itemId: string } | null | undefined) => { const def = FURNITURE[item?.itemId ?? '']; return def && !def.wall && def.shape !== 'rug' && def.shape !== 'mat' ? def : undefined; };
/** A part name says which floor a mesh belongs to and which outer wall (if any) it hangs on: 'f1', 'f1-back'. */
const partOf = (floor: number, wall?: Wall) => (wall ? `f${floor}-${wall}` : `f${floor}`);

/** The kit's modelling tools, writing into a batch part (one merged mesh per floor or wall, not one mesh per box). */
const batchTools = (batch: Batch, part: string): Tools => ({
  box: (x, y, z, w, h, d, c, lit) => batch.box(x, y, z, w, h, d, c, { part, ...(lit ? { layer: 'glow' as const } : {}) }),
  round: (x, y, z, r, h, c, lit) => batch.cyl(x, y, z, r, h, c, { part, seg: 9, ...(lit ? { layer: 'glow' as const } : {}) }),
  ball: (x, y, z, r, c, ry = r, rz = r, seg = 9) => batch.ball(x, y, z, r, ry, rz, c, { part, seg }),
});

/**
 * One walk grid per floor behind one object: the walker keeps it, and every question goes to the
 * floor the avatar is on now (`floor()`), so climbing the stairs needs no new grid from the host.
 */
function floorGrids(grids: WalkGrid[], floor: () => number): WalkGrid {
  if (grids.length === 1) return grids[0]!;
  const at = () => grids[Math.min(Math.max(floor(), 0), grids.length - 1)]!;
  return {
    get bounds() { return at().bounds; }, get cell() { return at().cell; }, get cols() { return at().cols; }, get rows() { return at().rows; }, get cells() { return at().cells; },
    free: (x, z) => at().free(x, z), nearest: (x, z, reach) => at().nearest(x, z, reach), clearLine: (ax, az, bx, bz) => at().clearLine(ax, az, bx, bz),
    path: (ax, az, bx, bz) => at().path(ax, az, bx, bz), ascii: (marks) => at().ascii(marks),
  };
}

export function buildHomeScene(kit: Kit, options: { visit?: VisitHomeScene } = {}) {
  const { THREE } = kit;
  const visit = options.visit;
  const itemsOf = (state: LifeState | null): readonly PlacedItem[] => visit?.items ?? state?.stories?.running?.content.items ?? (Array.isArray(state?.home?.items) ? state.home.items : []);
  const visitPalette: HomePalette | null = visit ? { ...ROOM_PALETTE, back: HOUSE_STYLE.wall[visit.style.wall]?.hex ?? ROOM_PALETTE.back, left: HOUSE_STYLE.wall[visit.style.wall]?.hex ?? ROOM_PALETTE.left } : null;
  const group = new THREE.Group();
  const room = new THREE.Group(), furniture = new THREE.Group(), overlay = new THREE.Group(), people = new THREE.Group();
  // What the camera is behind: those outer walls hide, with everything hanging on them (meshes tagged '…-back' / '…-left').
  const hiddenWalls: Record<Wall, boolean> = { back: false, left: false };
  let solids: Solid[] = [];
  group.add(room, furniture, overlay, people);
  group.position.set(SHIFT, 0, SHIFT);
  const glow = new THREE.PointLight('#ffe3b0', 26, 18, 1.5);
  glow.position.set(-1, 3, -1);
  group.add(glow);

  let palette: HomePalette = ROOM_PALETTE, grid = 0, owned = false, tile = 1, drawn = '', lastState: LifeState | null = null, camera: THREE.Camera | null = null, canvas: HTMLElement | null = null, status = '', undrawn = false;
  let homeTime: TimeOfDay = 'day';
  glow.intensity = 26 * lightingFor('indoor', homeTime).lamps;
  let plot: Plot = plotOf(1), plan: HousePlan = planOf(plot);
  // The floor the avatar stands on, and the floors drawn (0 … shownFloor): the ones above are lifted off.
  let level = 0, shownFloor = 0, restFloor = 0, lastAt = { x: NaN, z: NaN };
  let ui: HomeUi = { selected: null, ghost: null, buy: false };
  let who: { look: unknown; seed: string; name: string; pose: Pose | null } = { look: undefined, seed: 'you', name: 'You', pose: null }, guests: Guest[] = [], guestTags: HomeTag[] = [], selfTag: HomeTag | null = null, guestKey = '', restKey = '', dressKey = '';
  const actorMeshes: THREE.Mesh[] = [], markMeshes: THREE.Mesh[] = [], roomMeshes: THREE.Mesh[] = [], furnitureMeshes: THREE.Mesh[] = [];
  // The player's own figure: a group moved by its transform, with one prebuilt figure per pose.
  const avatar = new THREE.Group();
  avatar.name = 'avatar';
  people.add(avatar);
  const figures = new Map<Pose, Figure>();
  let sleepingFigure: Figure | null = null, presentedBody: SkinnedBody | null = null, presentation = 'everyday';
  let shownFigure: Figure | null = null, shownPose: Pose = 'stand', driven = false, walkGrid: WalkGrid | null = null, grids: WalkGrid[] = [], gridKey = '', restAt: HomeRest | null = null, goalMark: THREE.Mesh | null = null;
  // The skinned body (see the header): asked for on an allowed device; null until it loads, and for good without one.
  const wantsBody = bodyAllowed();
  let body: SkinnedBody | null = null, bodyLoading = false, bodyFailed = false, gone = false, seatAt: Rest | null = null, sat: Spot | undefined;
  let placedGuests: PlacedGuest[] = [];
  let guestChanged: (() => void) | null = null;
  const guestHead = new THREE.Vector3();
  const guestBodies = createCanonicalCrowd<SkinnedBody>({
    yieldBetweenActors: () => new Promise(resolve => setTimeout(resolve, 0)),
    load: spec => importBody().then(module => module.loadBody(kit, spec.look, spec.seed, spec.scale)).then(loaded => {
      const error = loaded.wardrobeError;
      if (error) { loaded.dispose(); throw new Error(error); }
      loaded.show('idle', false); return loaded;
    }),
    place(loaded, spec) { loaded.fit(spec.scale); loaded.place(spec.x, spec.y, spec.z, spec.ry); },
    mount(loaded, id) { loaded.object.name = `home-guest:${id}`; people.add(loaded.object); },
    changed() {
      if (gone) return;
      buildGuestFigures();
      if (guestChanged) guestChanged();
      else globalThis.window?.dispatchEvent?.(new CustomEvent('jaw:home-frame'));
    },
    failed(id, error) { if (!gone) console.warn(`Canonical home guest ${id} unavailable; keeping its current fallback:`, error); },
  });
  const floorAt = { x: 0, y: 0.03, z: 0, ry: 0 }, headAt = new THREE.Vector3();
  let hinge: ReturnType<typeof createHingedHomeDoor> | null = null, doorDone: (() => void) | null = null, doorVisual = false;
  const doorGrip = new THREE.Vector3(), doorRelease = { x: 0, z: 0 };
  const lastGait = { x: NaN, y: 0, z: 0 };
  const useProps = createUseProps(kit); people.add(useProps.object);
  const sequence = createObjectSequence({
    enter(action) { syncPresentation(); show('work'); poseBody('work', true); useProps.update(action, body); },
    use(action, seconds) { body?.sampleUse(action.pose, seconds); markAvatar(); },
    rest(action) { placeUse(action.use); useProps.update(action, body); markAvatar(); },
    exit() { poseBody('stand', true); },
    transitioning: () => Boolean(body?.easing), canUse: () => body !== null,
    settle() { body?.settle(); markAvatar(); },
  });
  function syncPresentation() {
    const pose = sequence.presented?.pose;
    const next = pose === 'lie' ? 'sleeping' : pose === 'bucket' || pose === 'wash' || pose === 'soak' ? 'bathing' : 'everyday';
    if (body && (body !== presentedBody || next !== presentation)) body.setPresentation(next);
    presentedBody = body; presentation = next;
  }
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2(), floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const along = (index: number, span = 1) => -ROOM / 2 + (index + span / 2) * tile;
  /** Tile edge → scene units (x along the back wall, y towards the viewer). */
  const edge = (index: number) => -ROOM / 2 + index * tile;
  /** A floor piece's footprint in scene units [x0, z0, x1, z1], drawn in by `pad` on every side. */
  const rectOf = (def: FurnitureDefinition, item: { x: number; y: number; rot: number }, pad = 0): WalkRect => {
    const size = footprint(def, item.rot);
    return [edge(item.x) + pad, edge(item.y) + pad, edge(item.x + size.w) - pad, edge(item.y + size.h) - pad];
  };
  // In Buy mode the floor in view is the one being furnished; otherwise the avatar's.
  const viewFloor = () => Math.min(ui.buy && ui.floor !== undefined ? ui.floor : level, plot.floors - 1);
  const syncFloor = () => { if (viewFloor() !== shownFloor) { shownFloor = viewFloor(); applyParts(); } };

  function announce(next: string, placed: number) {
    if (visit) return;
    if (next === status) return;
    status = next;
    globalThis.window?.dispatchEvent?.(new CustomEvent('jaw:home-scene', { detail: { status, placed } }));
  }

  /** Is a mesh of this part drawn now? Floors above the one in view are lifted off; outer walls the camera is behind hide. */
  function partShown(part: unknown) {
    if (typeof part !== 'string') return true;
    const [name, wall] = part.split('-') as [string, Wall | undefined];
    return Number(name.slice(1)) <= shownFloor && !(wall && hiddenWalls[wall]);
  }
  function applyParts() {
    for (const parent of [room, furniture, overlay]) for (const child of parent.children) if (child.userData.part) child.visible = partShown(child.userData.part);
  }

  /** Four wall panels leave a real window opening; their inner edges provide its full depth. */
  function backWallWithWindow(b: Batch, x0: number, width: number, y: number, height: number, z0: number, colour: Colour, part: string, x: number, tileWidth: number) {
    const wallLeft = x0 - 0.25, wallRight = x0 + width, wallDepth = 0.25, wallZ = z0 - 0.125;
    const openingWidth = Math.min(tileWidth * 0.86, 1.5), openingHeight = 1.2;
    const left = x - openingWidth / 2, right = x + openingWidth / 2, bottom = y + 1.4, top = bottom + openingHeight;
    const panel = (cx: number, cy: number, w: number, h: number) => { if (w > 0.001 && h > 0.001) b.box(cx, cy, wallZ, w, h, wallDepth, colour, { part }); };
    panel((wallLeft + left) / 2, y + height / 2, left - wallLeft, height);
    panel((right + wallRight) / 2, y + height / 2, wallRight - right, height);
    panel(x, (y + bottom) / 2, openingWidth, bottom - y);
    panel(x, (top + y + height) / 2, openingWidth, y + height - top);
  }
  /** Window pane sits within the opening; frame rails sit on both wall faces. */
  function windowAt(b: Batch, x: number, y: number, part: string) {
    const wide = Math.min(tile * 0.86, 1.5), z = -ROOM / 2, cy = y + 2.0, h = 1.2, rail = 0.07;
    const railQuad = (qx: number, qy: number, qw: number, qh: number, qz: number, ry = 0) => b.quad(qx, qy, qz, qw, qh, '#5f4a36', { part, ry });
    for (const [qz, ry] of [[z + 0.025, 0], [z - 0.275, Math.PI]] as const) {
      railQuad(x, cy, rail, h, qz, ry);
      railQuad(x - wide / 2 + rail / 2, cy, rail, h, qz, ry);
      railQuad(x + wide / 2 - rail / 2, cy, rail, h, qz, ry);
      railQuad(x, cy - h / 2 + rail / 2, wide - 2 * rail, rail, qz, ry);
      railQuad(x, cy + h / 2 - rail / 2, wide - 2 * rail, rail, qz, ry);
    }
    b.box(x, cy, z - 0.115, wide - 2 * rail, h - 2 * rail, 0.02, '#a9d3ea', { part, layer: 'glass' });
  }
  /** A flight of stairs: treads stacked from the floor, a sloping rail each side. */
  const stairSteps = (flight: PlanStairs) => Math.max(flight.w * 2, Math.ceil(WALL_HEIGHT / (0.18 * tile * AVATAR_SCALE * 2.45 / 1.81)));
  function stairsOf(b: Batch, flight: PlanStairs) {
    const part = partOf(flight.floor), steps = stairSteps(flight), run = (flight.w * tile) / steps, rise = WALL_HEIGHT / steps, base = lift(flight.floor);
    const z0 = edge(flight.y), z1 = edge(flight.y + flight.h), length = flight.w * tile;
    for (let i = 0; i < steps; i++) {
      const x = flight.dir === 1 ? edge(flight.x) + (i + 0.5) * run : edge(flight.x + flight.w) - (i + 0.5) * run, h = (i + 1) * rise;
      b.box(x, base + h / 2, (z0 + z1) / 2, run, h, z1 - z0 - 0.1, i % 2 ? '#a08a6c' : '#94805f', { part });
    }
    const slope = Math.atan2(WALL_HEIGHT, length) * flight.dir, middle = edge(flight.x) + length / 2;
    for (const z of [z0 + 0.05, z1 - 0.05]) b.box(middle, base + WALL_HEIGHT / 2 + 0.9, z, Math.hypot(length, WALL_HEIGHT), 0.06, 0.06, RAIL, { part, rz: slope });
  }
  /** A box along a tile line (an inner wall, its trim, a rail): `h` high from `y`, `t` thick, `more` longer. */
  const run = (b: Batch, line: PlanWall, y: number, h: number, t: number, c: Colour, part: string, more = 0) => {
    const [ax, az, bx, bz] = [edge(line.x0), edge(line.y0), edge(line.x1), edge(line.y1)];
    b.box((ax + bx) / 2, y + h / 2, (az + bz) / 2, bx - ax ? bx - ax + more : t, h, bz - az ? bz - az + more : t, c, { part });
  };

  /** The house: floors (tiles, slab, stairwell), the walls between rooms, stairs, and the two outer walls of every floor. */
  function buildRoom() {
    cancelDoor(); hinge?.dispose(); hinge = null; doorDone = null;
    releaseObjects(roomMeshes); room.clear();
    const W = plot.w * tile, D = plot.d * tile, x0 = -ROOM / 2, z0 = -ROOM / 2;
    // The plinth is drawn whatever floor is in view: it reports the camera and canvas the host draws with, so taps can be resolved.
    const plinth = kit.box(x0 + W / 2, -0.21, z0 + D / 2, W + 0.5, 0.4, D + 0.5, '#6f6253', room);
    plinth.onBeforeRender = (renderer, scene, cam) => { camera = cam; undrawn = false; attach(renderer.domElement); if (wantsBody) { startBody(renderer); if (body && drawsWebGL2(renderer)) guestBodies.start(); } };
    const b = createBatch(THREE);
    for (let floor = 0; floor < plot.floors; floor++) {
      const y = lift(floor), part = partOf(floor), rooms = plan.floors[floor] ?? [], hole = stairwellOf(plan, floor);
      const open = rooms.length === 1 && /terrace/i.test(rooms[0]!.label), high = open ? 1 : WALL_HEIGHT;
      if (hole) {
        // The slab this floor stands on, round the stairwell, and a rail along the drop.
        for (const [ax, az, bx, bz] of slabOf(plan, floor)) b.box(edge((ax + bx) / 2), y - 0.1, edge((az + bz) / 2), (bx - ax) * tile, 0.2, (bz - az) * tile, '#8c8478', { part });
        for (const line of railsOf(hole, floor)) run(b, line, y + 0.87, 0.06, 0.06, RAIL, part);
      }
      for (let ty = 0; ty < plot.d; ty++) for (let tx = 0; tx < plot.w; tx++) {
        if (hole && tx >= hole.x && tx < hole.x + hole.w && ty >= hole.y && ty < hole.y + hole.h) continue;
        const tones = finishAt(plan, floor, tx, ty) ?? palette.floor;
        b.quad(along(tx), y + 0.016, along(ty), tile * 0.985, tile * 0.985, (tx + ty) % 2 ? tones[0] : tones[1], { part, rx: -Math.PI / 2 });
      }
      for (const wall of wallsOf(plan, floor)) {
        run(b, wall, y, INNER, 0.12, palette.left, part);
        run(b, wall, y + INNER, 0.04, 0.16, TRIM, part, 0.04);
      }
      for (const flight of plan.stairs) if (flight.floor === floor) stairsOf(b, flight);
      const back = partOf(floor, 'back'), left = partOf(floor, 'left');
      if (!open) backWallWithWindow(b, x0, W, y, high, z0, palette.back, back, along(windowSlot(grid)), tile);
      else b.box(x0 + W / 2 - 0.125, y + high / 2, z0 - 0.125, W + 0.25, high, 0.25, palette.back, { part: back });
      const doorWidth = Math.min(tile * 0.86, 1.5), doorZ = along(doorSlot(grid));
      const unit = tile * AVATAR_SCALE * 2.45 / 1.81;
      const vertical = body?.scale ?? unit, lateral = body?.scaleX ?? unit;
      const doorHeight = Math.min(WALL_HEIGHT - 0.08, Math.max(2.3, 1.81 * vertical + 0.45));
      if (floor === 0) {
        const a = doorZ - doorWidth / 2, c = doorZ + doorWidth / 2;
        b.box(x0 - 0.125, high / 2, (z0 + a) / 2, 0.25, high, a - z0, palette.left, { part: left });
        b.box(x0 - 0.125, high / 2, (c + z0 + D) / 2, 0.25, high, z0 + D - c, palette.left, { part: left });
        b.box(x0 - 0.125, (high + doorHeight) / 2, doorZ, 0.25, high - doorHeight, doorWidth, palette.left, { part: left });
        hinge = createHingedHomeDoor(kit, { x: x0, z: doorZ, width: doorWidth, height: doorHeight,
          handleHeight: 0.03 + (0.045 + 0.92) * vertical, handleOffset: 0.1 * lateral });
        hinge.object.userData.part = left;
        room.add(hinge.object);
      } else b.box(x0 - 0.125, y + high / 2, z0 + D / 2, 0.25, high, D, palette.left, { part: left });
      b.box(x0 + W / 2, y + 0.12, z0 + 0.02, W, 0.24, 0.04, TRIM, { part: back });
      if (floor === 0) {
        const a = doorZ - doorWidth / 2, c = doorZ + doorWidth / 2;
        b.box(x0 + 0.02, 0.12, (z0 + a) / 2, 0.04, 0.24, a - z0, TRIM, { part: left });
        b.box(x0 + 0.02, 0.12, (c + z0 + D) / 2, 0.04, 0.24, z0 + D - c, TRIM, { part: left });
      } else b.box(x0 + 0.02, y + 0.12, z0 + D / 2, 0.04, 0.24, D, TRIM, { part: left });
      if (floor > 0) {
        // Upstairs, the open sides get a parapet (the roof terrace) or a rail: nobody steps off the edge.
        const tall = open ? 1 : 0.06, at = open ? 0.5 : 0.9;
        b.box(x0 + W / 2, y + at, z0 + D, W, tall, 0.1, open ? palette.back : RAIL, { part });
        b.box(x0 + W, y + at, z0 + D / 2, 0.1, tall, D, open ? palette.left : RAIL, { part });
      }
      // A window on the back wall of every room-floor, the door on the ground floor's side wall: the slots the placement rules keep clear.
      if (!open) windowAt(b, along(windowSlot(grid)), y, back);
    }
    for (const mesh of b.build(sceneMaterials(kit)).meshes) { mesh.name = `home-room-${mesh.name}`; room.add(mesh); roomMeshes.push(mesh); }
    applyParts();
  }

  // ---- the skinned body (capability-gated) ---------------------------------------------------
  /** After the room's first frame: fetch the body module and the body, once. Any failure keeps the procedural figure. */
  function startBody(renderer: THREE.WebGLRenderer) {
    if (body || bodyLoading || bodyFailed || gone) return;
    if (!drawsWebGL2(renderer)) { bodyFailed = true; return; }
    bodyLoading = true;
    setTimeout(() => {
      if (gone) { bodyLoading = false; return; }
      importBody().then((module) => module.loadBody(kit, who.look ?? lastState?.onboarding?.look ?? null, who.seed, tile * AVATAR_SCALE)).then((loaded) => {
        bodyLoading = false;
        if (gone) { loaded.dispose(); return; }
        // The look changed while it loaded: recolour, or (the other body) start again on the next frame.
        if (!loaded.wear(who.look ?? lastState?.onboarding?.look ?? null, who.seed)) { loaded.dispose(); globalThis.window?.dispatchEvent?.(new CustomEvent('jaw:home-frame')); return; }
        body = loaded;
        body.fit(tile * AVATAR_SCALE);
        buildRoom();
        people.add(body.object);
        avatar.visible = false;
        poseBody(shownPose, false);
        syncPresentation();
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
  /** Record the current floor destination, including while the rendered body rests on furniture. */
  function placeBody() {
    if (doorVisual && hinge) {
      const t = doorDone ? hinge.progress : 1, front = -ROOM / 2 - 0.1 - 0.55 * (body?.scaleZ ?? tile * AVATAR_SCALE);
      let x = floorAt.x, z = floorAt.z;
      if (t < 0.22) x += (-ROOM / 2 + 0.11 + 0.2 * (body?.scaleZ ?? tile) - x) * t / 0.22;
      else if (t <= 0.65 && body) {
        body.workOn(x, floorAt.y, z, -Math.PI / 2); body.object.updateWorldMatrix(true, true);
        const hand = body.object.getObjectByName('hand_r');
        if (hand) {
          hand.getWorldPosition(doorGrip); group.worldToLocal(doorGrip);
          const handle = group.worldToLocal(hinge.handlePosition());
          x += handle.x - doorGrip.x; z += handle.z - doorGrip.z;
        }
        doorRelease.x = x; doorRelease.z = z;
      } else { const u = Math.min(1, Math.max(0, (t - 0.65) / 0.35)); x = doorRelease.x + (front - doorRelease.x) * u; z = doorRelease.z + (floorAt.z - doorRelease.z) * u; }
      if (body) { if (doorDone) body.workOn(x, floorAt.y, z, -Math.PI / 2); else body.place(x, floorAt.y, z, -Math.PI / 2); }
      else { avatar.position.set(x, floorAt.y, z); avatar.rotation.y = -Math.PI / 2; }
      return;
    }
    body?.place(floorAt.x, floorAt.y, floorAt.z, floorAt.ry);
  }
  function finishDoor() {
    if (!doorDone || hinge?.easing || body?.easing) return;
    const done = doorDone; doorDone = null; body?.show('idle', false); show('stand'); placeFigure(); placeBody(); markAvatar(); done();
  }
  function cancelDoor() {
    if (!doorDone && !doorVisual) return;
    doorDone = null; doorVisual = false; hinge?.cancel(); body?.settle(); body?.show('idle', false); show('stand'); placeFigure(); placeBody(); markAvatar();
  }
  function placeUse(at: Spot) {
    if (at.kind === 'seat') body?.sitOn(at.x, at.top, at.z, at.ry);
    else body?.workOn(at.x, at.y, at.z, at.ry);
  }
  /** Pose the body like the procedural figure: on its furniture for a home activity that has some, else where the avatar is. */
  function poseBody(pose: Pose, animate: boolean) {
    if (!body) return;
    const next = pose === 'work' && seatAt ? seatAt.pose : pose === 'sit' && !seatAt ? 'idle' : BODY_POSE[pose];
    placeBody();
    body.show(next, animate);
    // Getting up (sit-exit, get-up) happens where it sat or lay: the last spot, until the clip ends (stepCrowd).
    const at = next === seatAt?.pose ? seatAt.at : body.seated ? sat : undefined;
    if (at) { sat = at; placeUse(at); } else placeBody();
    markAvatar();
  }
  /** A home activity's body pose, and the piece it uses (the nearest of its kind to where the avatar stands). Null otherwise. */
  function seatFor(state: LifeState | null, near: { x: number; y: number; floor: number }): Rest | null {
    if (visit) return null;
    const active = state?.activeAction, kind = active?.kind === 'activity' ? REST_KIND.get(active.id) : undefined;
    const pose = kind === 'stove' ? 'cook' : kind === 'cooler' ? active?.id === 'home-drink-zobo' ? 'drink' : 'eat' : kind && REST_POSE[kind];
    if (!pose || (state!.location != null && state!.location !== 'home')) return null;
    let best: (Spot & { d: number; id: string }) | undefined;
    let surface: ObjectAction['surface'];
    if (kind === 'cooler') {
      const table = itemsOf(state).find(item => floorOf(item) === near.floor && ['desk', 'board'].includes(FURNITURE[item.itemId]?.shape ?? ''));
      const item = table ?? itemsOf(state).find(item => floorOf(item) === near.floor && FURNITURE[item.itemId]?.kind === 'cooler');
      const def = item && FURNITURE[item.itemId];
      if (!item || !def || (pose !== 'eat' && pose !== 'drink')) return null;
      const at = mountOf(def, item.x, item.y, item.rot, near.floor), front = tile * 0.75;
      return { id: item.id, pose, at: { kind: 'floor', x: at.x + Math.sin(at.ry) * front, y: lift(near.floor) + 0.03, z: at.z + Math.cos(at.ry) * front, ry: at.ry + Math.PI },
        ...(table ? { table: { x: at.x, y: lift(near.floor) + 0.015 + (def.shape === 'desk' ? 0.65 : 0.36) * tile, z: at.z + 0.2 * tile, ry: at.ry, scale: tile } } : {}) };
    }
    // Washing stands where the avatar does (at the bucket or in the shower).
    for (const item of itemsOf(state)) {
      const def = FURNITURE[item?.itemId];
      if (!def || def.wall || def.kind !== kind || floorOf(item) !== near.floor) continue;
      const size = footprint(def, item.rot), seat = seatOf(def.shape, def.w, def.h), angle = -item.rot * Math.PI / 2;
      const cx = along(item.x, size.w), cz = along(item.y, size.h), cos = Math.cos(angle), sin = Math.sin(angle);
      if (def.shape === 'bucket' || kind === 'stove') {
        const unit = tile * AVATAR_SCALE * 2.45 / 1.81, sx = body?.scaleX ?? unit, sz = body?.scaleZ ?? unit;
        const lx = def.shape === 'bucket' ? -0.12 * tile - 0.08 * sx : (def.shape === 'cooker' ? 0.21 * tile : 0) - 0.16 * sx;
        const lz = def.shape === 'bucket' ? -0.08 * tile + 0.52 * sz : (def.shape === 'cooker' ? 0.22 * tile : 0) + 0.48 * sz;
        const x = cx + lx * cos + lz * sin, z = cz - lx * sin + lz * cos;
        const at: Spot = { kind: 'floor', x, y: lift(near.floor) + 0.03, z, ry: angle + Math.PI };
        return { id: item.id, pose: def.shape === 'bucket' ? 'bucket' : def.shape === 'stove' ? 'cookLow' : 'cook', at,
          ...(kind === 'stove' ? { table: { x: cx, y: lift(near.floor) + 0.015 + (def.shape === 'stove' ? 0.73 : 0.94) * tile, z: cz, ry: angle, scale: tile } } : {}) };
      }
      if (pose === 'wash') return { id: item.id, pose, at: { kind: 'floor', x: cx - 0.05 * tile, y: lift(near.floor) + 0.03 + 0.08 * tile, z: cz - 0.05 * tile, ry: angle },
        surface: { x: cx - 0.2 * tile, y: lift(near.floor) + 0.015 + SHOWER_HEAD * tile, z: cz - 0.2 * tile, ry: angle, w: tile, d: tile } };
      if (pose === 'soak') surface = { x: cx, y: lift(near.floor) + 0.015 + 0.53 * tile, z: cz, ry: angle, w: def.w * tile, d: def.h * tile };
      for (const lx of seat.xs) {
        const x = cx + (lx * cos + seat.z * sin) * tile, z = cz + (-lx * sin + seat.z * cos) * tile;
        const d = Math.hypot(x - along(near.x), z - along(near.y));
        if (!best || d < best.d) best = { kind: 'seat', x, top: lift(near.floor) + 0.015 + seat.top * tile, z, ry: angle + (seat.turn ?? 0), d, id: item.id };
      }
    }
    // Sitting and lying need the piece; without one (an old save, a sold bed) the body stands like the figure.
    return best && best.kind === 'seat' ? { pose, id: best.id, at: { kind: 'seat', x: best.x, top: best.top, z: best.z, ry: best.ry }, ...(surface ? { surface } : {}) } : null;
  }

  /** Where an object is drawn: its origin (footprint centre on its floor, or its mounting point), turn, scale and part. */
  function mountOf(def: FurnitureDefinition, x: number, y: number, rot: number, floor: number) {
    if (def.wall) {
      const back = rot === 0;
      return { x: back ? along(x) : -ROOM / 2 + 0.01, y: lift(floor) + WALL_ITEM_Y, z: back ? -ROOM / 2 + 0.01 : along(y), ry: back ? 0 : Math.PI / 2, scale: Math.max(tile, 0.8), part: partOf(floor, back ? 'back' : 'left') };
    }
    const size = footprint(def, rot);
    return { x: along(x, size.w), y: lift(floor) + 0.015, z: along(y, size.h), ry: -rot * Math.PI / 2, scale: tile, part: partOf(floor) };
  }
  /** Draw an object into a batch, at its place, in its floor's (or wall's) part. */
  function model(b: Batch, def: FurnitureDefinition, x: number, y: number, rot: number, floor: number) {
    const at = mountOf(def, x, y, rot, floor);
    b.at(at.x, at.y, at.z, at.ry, () => {
      if (def.shape === 'plant') plant(b, 0, 0, { s: 0.58, pot: '#b9744f', leaf: def.color, part: at.part });
      else (SHAPES[def.shape] || SHAPES.fallback)(batchTools(b, at.part), def.wall ? 1 : def.w, def.wall ? 1 : def.h, def.color, def);
    }, 0, 0, at.scale);
  }
  /** Build a batch into meshes of `parent` (released with the furniture). */
  function keep(b: Batch, parent: THREE.Object3D) {
    for (const mesh of b.build(sceneMaterials(kit)).meshes) { mesh.name = `home-furniture-${mesh.name}`; parent.add(mesh); furnitureMeshes.push(mesh); }
  }

  /** A flat marker under a footprint (or behind a wall item). */
  function marker(def: FurnitureDefinition, x: number, y: number, rot: number, floor: number, colour: Colour, raise: number) {
    const at = mountOf(def, x, y, rot, floor);
    let mark: THREE.Mesh;
    if (def.wall) {
      const size = at.scale * 0.94, back = rot === 0;
      mark = kit.box(at.x, at.y, back ? -ROOM / 2 + 0.006 : at.z, back ? size : 0.012, size * 1.2, back ? 0.012 : size, colour, overlay, true);
      if (!back) mark.position.x = -ROOM / 2 + 0.006;
    } else {
      const size = footprint(def, rot);
      mark = kit.box(at.x, at.y - 0.015 + raise, at.z, size.w * tile * 0.97, 0.02, size.h * tile * 0.97, colour, overlay, true);
    }
    mark.userData.part = at.part;
  }

  function rebuild(state: LifeState | null) {
    const house = visit ?? homeOf(state, HOUSE_DESIGNS, state ? housesFor(state.estate.city) : undefined);
    const colours = visitPalette ?? (state && cachedCityContent(state.estate.city)?.homePalette) ?? ROOM_PALETTE;
    if (house.grid !== grid || house.owned !== owned || colours !== palette) {
      grid = house.grid; owned = house.owned; tile = ROOM / grid; palette = colours;
      plot = plotOf(grid, owned); plan = planOf(plot);
      level = Math.min(level, plot.floors - 1); shownFloor = viewFloor();
      buildRoom();
    }
    releaseObjects(furnitureMeshes); furniture.clear(); overlay.clear();
    const items = itemsOf(state);
    const b = createBatch(THREE);
    let placed = 0;
    for (const item of items) {
      const def = FURNITURE[item?.itemId], floor = floorOf(item);
      if (!def || floor >= plot.floors) continue;
      model(b, def, item.x, item.y, item.rot, floor);
      placed += 1;
      // Outside Buy mode the marker follows the spot: it clears when the player moves to another one.
      const spot = KINDS[def.kind]?.spot;
      if (!visit && item.id === ui.selected && (ui.buy || !spot || spot === state?.spot)) marker(def, item.x, item.y, item.rot, floor, '#ffd24a', 0.035);
    }
    keep(b, furniture);
    const ghost = ui.ghost, ghostDef = ghost && FURNITURE[ghost.itemId];
    if (ghostDef) {
      const floor = Math.min(floorOf(ghost), plot.floors - 1);
      marker(ghostDef, ghost.x, ghost.y, ghost.rot, floor, ghost.valid ? '#35d07f' : '#e5484d', 0.05);
      // The ghost is a batch of its own in the overlay: it moves with every tap, and taps go through it.
      const g = createBatch(THREE);
      model(g, ghostDef, ghost.x, ghost.y, ghost.rot, floor);
      keep(g, overlay);
    }
    applyParts();
    return placed;
  }

  const signature = (state: LifeState | null) => visit ? JSON.stringify(visit) : JSON.stringify([state?.property?.house, state?.estate?.living, state?.estate?.tier, itemsOf(state), state?.spot, ui]);

  /** Tiles a standing figure may not use: under furniture. `taken` holds "floor:x,y" keys. */
  function freeTiles(items: ReturnType<typeof itemsOf>) {
    const taken = new Set<string>();
    for (const item of items) {
      const def = solidOf(item);
      if (!def) continue;
      const size = footprint(def, item.rot);
      for (let dx = 0; dx < size.w; dx++) for (let dy = 0; dy < size.h; dy++) taken.add(`${floorOf(item)}:${item.x + dx},${item.y + dy}`);
    }
    return taken;
  }
  /** Where the player stands: on a free tile next to the first object of the chosen spot (in its room, on its floor), else just inside the door. */
  function standing(state: LifeState | null, taken: Set<string>) {
    const items = itemsOf(state);
    const door = { x: 0, y: doorSlot(grid) };
    const kind = state?.activeAction?.kind === 'activity' ? REST_KIND.get(state.activeAction.id) : undefined;
    const target = !visit && items.find((item) => {
      const def = FURNITURE[item?.itemId];
      return def && !def.wall && floorOf(item) < plot.floors && (kind ? def.kind === kind : KINDS[def.kind]?.spot === state?.spot);
    });
    const centre = target ? (() => { const size = footprint(FURNITURE[target.itemId]!, target.rot); return { x: target.x + (size.w - 1) / 2, y: target.y + (size.h - 1) / 2 }; })() : door;
    const floor = target ? floorOf(target) : 0, tileAt = nearestFree(plan, floor, centre.x, centre.y, taken)[0] || door;
    return { x: tileAt.x, y: tileAt.y, floor, ry: Math.atan2(centre.x - tileAt.x, centre.y - tileAt.y) || 0 };
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
    // A fallback has a real sitting figure; on a bed or tub it sits rather than claiming a lying/bathing clip.
    const sleeping = pose === 'work' && seatAt?.pose === 'lie';
    if (sleeping && !sleepingFigure) {
      sleepingFigure = buildAvatar(kit, who.look ?? lastState?.onboarding?.look ?? null, { pose: 'sit', sleeping: true, seed: who.seed, scale: tile * AVATAR_SCALE, marker: 'crown', ...playerOptions('sit') });
      sleepingFigure.visible = false; avatar.add(sleepingFigure);
    }
    const next = sleeping && sleepingFigure ? sleepingFigure : figure(pose === 'work' && seatAt?.at?.kind === 'seat' ? 'sit' : pose);
    shownPose = pose;
    if (next === shownFigure) { placeFigure(); return false; }
    if (shownFigure) shownFigure.visible = false;
    next.visible = true;
    shownFigure = next;
    placeFigure();
    return true;
  }
  function placeFigure() {
    const at = shownPose === 'work' || shownPose === 'sit' ? seatAt?.at : undefined;
    if (at) {
      avatar.position.set(at.x, at.kind === 'seat' ? at.top - 0.6 * tile * AVATAR_SCALE : at.y, at.z);
      avatar.rotation.y = at.ry;
    } else { avatar.position.set(floorAt.x, floorAt.y, floorAt.z); avatar.rotation.y = floorAt.ry; }
    markAvatar();
  }
  function clearFigures() {
    sleepingFigure?.userData.dispose(); sleepingFigure = null;
    for (const entry of figures.values()) entry.userData.dispose();
    figures.clear();
    shownFigure = null;
  }

  /**
   * Which floor the avatar is on, from where it is. Over a flight it changes floor past the middle
   * (with a little slack, so it does not flicker); a jump rather than a step (put at the door, or
   * at its resting place) takes the floor of where it landed.
   */
  function settle(x: number, z: number) {
    if (Math.hypot(x - lastAt.x, z - lastAt.z) > 1.2) {
      if (restAt && Math.hypot(x - restAt.x, z - restAt.z) < 0.3) level = restFloor;
      else if (Math.hypot(x - along(0), z - along(doorSlot(grid))) < 0.3) level = 0;
    }
    lastAt = { x, z };
    const on = flightAt(plan, level, (x + ROOM / 2) / tile, (z + ROOM / 2) / tile);
    if (on && level === on.flight.floor && on.up > 0.55) level += 1;
    else if (on && level === on.flight.floor + 1 && on.up < 0.45) level -= 1;
    syncFloor();
    return on;
  }
  /** Move the avatar (transform only) and its name tag. */
  function moveAvatar(x: number, y: number, z: number, ry: number) {
    settle(x, z);
    floorAt.x = x; floorAt.y = y; floorAt.z = z; floorAt.ry = ry;
    placeFigure();
    placeBody();
    if (sequence.phase === 'align') arriveObject();
    markAvatar();
  }
  function contactHeightAt(x: number, z: number, expectedY = floorAt.y) {
        const tx = (x + ROOM / 2) / tile, tz = (z + ROOM / 2) / tile;
        const floor = Math.min(plot.floors - 1, Math.max(0, Math.round(expectedY / WALL_HEIGHT)));
        let best: { height: number; distance: number } | null = null;
        for (const flight of plan.stairs) {
          if (flight.floor !== floor && flight.floor + 1 !== floor) continue;
          if (tx < flight.x || tx > flight.x + flight.w || tz < flight.y + 0.05 / tile || tz > flight.y + flight.h - 0.05 / tile) continue;
          const u = (tx - flight.x) / flight.w, up = flight.dir === 1 ? u : 1 - u, count = stairSteps(flight);
          const distance = Math.abs(lift(flight.floor) + up * WALL_HEIGHT + 0.03 - expectedY);
          const height = lift(flight.floor) + Math.min(count, Math.floor(up * count) + 1) * WALL_HEIGHT / count;
          if (!best || distance < best.distance) best = { height, distance };
        }
        return best?.height ?? lift(floor) + 0.016;
  }
  function arriveObject() {
    const action = sequence.action;
    if (!action || Math.hypot(floorAt.x - action.approach.x, floorAt.z - action.approach.z) > 0.1) return;
    const turn = Math.atan2(Math.sin(floorAt.ry - action.approach.ry), Math.cos(floorAt.ry - action.approach.ry));
    sequence.arrived(Math.abs(turn) < 0.04);
  }
  function markAvatar() {
    const head = body?.object.getObjectByName('Head');
    if (head && body) {
      body.object.updateWorldMatrix(true, true);
      head.getWorldPosition(headAt); group.worldToLocal(headAt); headAt.y += 0.32 * body.scale;
    } else headAt.set(avatar.position.x, avatar.position.y + (shownFigure?.userData.top ?? 2.95 * tile * AVATAR_SCALE), avatar.position.z);
    if (selfTag) { selfTag.position.x = headAt.x; selfTag.position.y = headAt.y; selfTag.position.z = headAt.z; }
    else selfTag = { id: 'self', name: who.name, kind: 'self', text: who.name, marker: 'crown', colour: '#ffd34d', position: { x: headAt.x, y: headAt.y, z: headAt.z } };
  }

  /**
   * The floors as walk grids: each floor's bounds, minus its floor furniture, the walls between its
   * rooms (doorways stay open) and the rails of its stairs. A flight is walkable on both floors it
   * joins; the lower floor is closed at its head and the upper at its foot, so the only way on to
   * the stairs is from their end. Rebuilt only when the house or the furniture changes.
   */
  function refreshGrid(state: LifeState | null) {
    const items = itemsOf(state).filter((item) => solidOf(item) && floorOf(item) < plot.floors);
    const key = JSON.stringify([grid, plot.w, plot.d, plot.floors, items.map((item) => [item.itemId, item.x, item.y, item.rot, floorOf(item)])]);
    if (key === gridKey && walkGrid) return;
    gridKey = key;
    const inset = tile * 0.1, rail = 0.05;
    const rects = items.map((item) => rectOf(FURNITURE[item.itemId]!, item, inset));
    grids = [];
    for (let floor = 0; floor < plot.floors; floor++) {
      const block = rects.filter((_, index) => floorOf(items[index]) === floor);
      for (const wall of bumpsOf(plan, floor)) block.push([edge(wall.x0) - rail, edge(wall.y0) - rail, edge(wall.x1) + rail, edge(wall.y1) + rail]);
      grids.push(createWalkGrid({ bounds: [edge(0) + 0.22, edge(0) + 0.22, edge(plot.w) - 0.15, edge(plot.d) - 0.15], block, cell: 0.25, radius: Math.min(0.3, tile * 0.22) }));
    }
    walkGrid = floorGrids(grids, viewFloor);
    // The same footprints, with heights: what can stand between the camera and the avatar.
    solids = items.map((item, index): Solid => { const base = lift(floorOf(item)), [ax, az, bx, bz] = rects[index]!; return [ax, base, az, bx, base + (TALL[FURNITURE[item.itemId]!.shape] || 0.7) * tile, bz]; })
      .filter((box) => box[4] - box[1] > 0.9 * tile);
  }
  /** The way to a place on another floor: over this floor to the stairs, up or down them, and across the floor there. */
  function route(to: number, x: number, z: number): { approach: WalkPoint; steps: WalkPoint[] } | null {
    const points = grids.length > Math.max(to, level) && routeOf<WalkPoint>(plan, level, to, { x, z }, (tx, ty) => ({ x: edge(tx), z: edge(ty) }), (floor, a, b) => grids[floor]!.path(a.x, a.z, b.x, b.z));
    return points ? { approach: points[0]!, steps: points.slice(1) } : null;
  }

  /** Hide the outer walls the camera is behind (and what hangs on them), and lift off the floors above the one in view. True when anything changed. */
  function look(x: number, z: number) {
    const back = z < -ROOM / 2, left = x < -ROOM / 2, floor = viewFloor();
    if (back === hiddenWalls.back && left === hiddenWalls.left && floor === shownFloor) return false;
    hiddenWalls.back = back; hiddenWalls.left = left; shownFloor = floor;
    applyParts();
    return true;
  }
  /** Rebuild what changed about the people: the player's figure, where it rests, the guests. Returns true when anything did. */
  function refreshPeople(state: LifeState | null) {
    const taken = freeTiles(itemsOf(state));
    const mine = standing(state, taken);
    const active = !visit && (state?.location === 'home' || state?.location == null) ? state?.activeAction : null;
    const leaving = !who.pose && Boolean(active) && (active?.kind === 'travel' || active?.kind === 'commute');
    const pose = who.pose || (!active ? 'stand' : leaving ? 'walk' : 'work');
    let changed = false;
    refreshGrid(state);
    const dress = JSON.stringify([tile, who.look ?? state?.onboarding?.look ?? null, who.seed]);
    if (dress !== dressKey) {
      dressKey = dress; clearFigures(); if (!rigOf(figure('stand'))) figure('walk'); if (driven) { show(shownPose); moveAvatar(floorAt.x, floorAt.y, floorAt.z, floorAt.ry); } changed = true;
      if (body) { if (body.wear(who.look ?? state?.onboarding?.look ?? null, who.seed)) { body.fit(tile * AVATAR_SCALE); buildRoom(); } else dropBody(); }
    }
    restFloor = mine.floor;
    const seat = seatFor(state, mine);
    if (JSON.stringify(seat) !== JSON.stringify(seatAt)) { seatAt = seat; changed = true; }
    const at = seat?.at, offset = at?.kind === 'seat' ? tile * 0.85 : 0;
    const approach = at && grids[mine.floor]?.nearest(at.x + Math.sin(at.ry) * offset, at.z + Math.cos(at.ry) * offset, Math.ceil(tile * 2 / 0.25));
    const x = approach?.x ?? along(mine.x), z = approach?.z ?? along(mine.y);
    restAt = { spot: visit ? null : state?.spot ?? null, x, y: lift(mine.floor) + 0.03, z, ry: at?.ry ?? mine.ry, pose, busy: Boolean(active) && !leaving && !who.pose, leaving, fixed: Boolean(who.pose), ...route(mine.floor, x, z) };
    const object: ObjectAction | null = at && seat?.id && (seat.pose === 'sit' || seat.pose === 'lie' || seat.pose === 'bucket' || seat.pose === 'cook' || seat.pose === 'cookLow' || seat.pose === 'eat' || seat.pose === 'drink' || seat.pose === 'wash' || seat.pose === 'soak') && active?.kind === 'activity' && !who.pose
      ? { id: [seat.id, active.id, active.duration, active.choice ?? ''].join('|'), pose: seat.pose, floor: mine.floor,
        approach: { x, y: restAt.y, z, ry: restAt.ry }, use: at, exit: { x, y: restAt.y, z, ry: restAt.ry }, ...(seat.table ? { table: seat.table } : {}), ...(seat.surface ? { surface: seat.surface } : {}) } : null;
    sequence.sync(object);
    const rest = JSON.stringify([grid, plot.w, mine, pose, who.name]);
    if (rest !== restKey) {
      restKey = rest; changed = true;
      if (selfTag) { selfTag.name = who.name; selfTag.text = who.name; }
    }
    if (changed && !driven) { level = restFloor; show(pose); moveAvatar(restAt.x, restAt.y, restAt.z, restAt.ry); poseBody(pose, false); }
    const guestsNow = JSON.stringify([grid, plot.w, plot.d, mine, guests, [...taken].sort()]);
    if (guestsNow === guestKey) return changed;
    guestKey = guestsNow;
    if (mine.floor === 0) taken.add(`0:${mine.x},${mine.y}`);
    const scale = tile * AVATAR_SCALE;
    // Keep the entrance usable and spread guests across reachable social floor space.
    // Canonical and fallback figures consume the same deterministic slots.
    const spare = guestPlaces(taken, guests.length, mine);
    placedGuests = guests.slice(0, Math.min(MAX_GUESTS_SHOWN, spare.length)).map((guest, index) => ({ ...guest,
      actorId: String(guest.id ?? `guest-${index}`), x: along(spare[index]!.x), y: 0.03, z: along(spare[index]!.y), ry: Math.PI / 2, scale,
    })).filter((guest, index, all) => all.findIndex(other => other.actorId === guest.actorId) === index);
    guestBodies.sync(placedGuests.map(guest => ({ id: guest.actorId, seed: String(guest.seed ?? guest.actorId), look: guest.look,
      x: guest.x, y: guest.y, z: guest.z, ry: guest.ry, scale: guest.scale })));
    buildGuestFigures();
    return true;
  }

  function guestPlaces(taken: Set<string>, count: number, self: { x: number; y: number; floor: number }) {
    const floor = grids[0], doorY = doorSlot(grid), centre = (grid - 1) / 2;
    if (!floor || !count) return [];
    const entrance = floor.nearest(along(0), along(doorY));
    if (!entrance) return [];
    // One component traversal per placement refresh, rather than a path search for every tile.
    // Four-way connectivity is equivalent to this grid's diagonal rule (no corner cutting).
    const reachable = new Uint8Array(floor.cells.length), queue = new Int32Array(floor.cells.length);
    const cellOf = (x: number, z: number) => Math.floor((z - floor.bounds[1]) / floor.cell) * floor.cols + Math.floor((x - floor.bounds[0]) / floor.cell);
    const start = cellOf(entrance.x, entrance.z);
    let read = 0, length = 1;
    queue[0] = start; reachable[start] = 1;
    const enqueue = (index: number) => {
      if (reachable[index] || floor.cells[index]) return;
      reachable[index] = 1; queue[length++] = index;
    };
    while (read < length) {
      const index = queue[read++]!, column = index % floor.cols, row = Math.floor(index / floor.cols);
      if (column > 0) enqueue(index - 1);
      if (column + 1 < floor.cols) enqueue(index + 1);
      if (row > 0) enqueue(index - floor.cols);
      if (row + 1 < floor.rows) enqueue(index + floor.cols);
    }
    const margin = tile * 0.25;
    const spare = nearestFree(plan, 0, centre, centre, taken).filter(point => {
      if (point.x <= 1 && Math.abs(point.y - doorY) <= 1) return false;
      const x = along(point.x), z = along(point.y);
      return floor.free(x, z) && reachable[cellOf(x, z)] === 1
        && floor.free(x - margin, z - margin) && floor.free(x + margin, z - margin)
        && floor.free(x - margin, z + margin) && floor.free(x + margin, z + margin);
    });
    const selected: { x: number; y: number }[] = [];
    while (selected.length < Math.min(count, MAX_GUESTS_SHOWN) && spare.length) {
      let best = 0, bestScore = -Infinity;
      for (let index = 0; index < spare.length; index++) {
        const point = spare[index]!;
        let gap = Math.min(3, Math.hypot(point.x, point.y - doorY));
        if (self.floor === 0) gap = Math.min(gap, Math.hypot(point.x - self.x, point.y - self.y));
        for (const other of selected) gap = Math.min(gap, Math.hypot(point.x - other.x, point.y - other.y));
        const inSocialRoom = point.x < grid && point.y < grid;
        const score = (inSocialRoom ? 100 : 0) + gap - 0.08 * Math.hypot(point.x - centre, point.y - centre);
        if (score > bestScore) { best = index; bestScore = score; }
      }
      selected.push(spare.splice(best, 1)[0]!);
    }
    return selected;
  }

  /** Keep a fallback only for guests whose canonical body has not committed. No idle animation loop. */
  function buildGuestFigures() {
    releaseObjects(actorMeshes);
    const batch = createBatch(THREE);
    guestTags = [];
    for (const person of placedGuests) {
      const loaded = guestBodies.get(person.actorId);
      let top: number;
      if (loaded) {
        loaded.object.updateWorldMatrix(true, true);
        const head = loaded.object.getObjectByName('Head');
        if (head) { head.getWorldPosition(guestHead); group.worldToLocal(guestHead); top = guestHead.y + 0.32 * loaded.scale; }
        else top = person.y + 2.45 * person.scale;
      } else {
        top = drawAvatar(batch, person.look ?? null, { x: person.x, y: person.y, z: person.z, ry: person.ry, pose: 'stand',
          seed: person.seed ?? person.id, scale: person.scale, marker: person.kind === 'npc' ? 'npc' : 'player' }).top;
      }
      const name = String(person.name ?? '');
      guestTags.push({ id: person.actorId, name, kind: person.kind === 'npc' ? 'npc' : 'player', text: person.kind === 'npc' ? name : `@${name}`,
        marker: person.kind === 'npc' ? 'dot' : 'tag', colour: person.kind === 'npc' ? '#58d68a' : '#6fb4ff', position: { x: person.x, y: top, z: person.z } });
    }
    for (const mesh of batch.build(sceneMaterials(kit)).meshes) { mesh.name = `home-people-${mesh.name}`; people.add(mesh); actorMeshes.push(mesh); }
  }

  /** Rebuild if anything visible changed. Returns true when it did. */
  function refresh(state: LifeState | null) {
    const next = signature(state);
    if (next === drawn) return false;
    drawn = next;
    try { const placed = rebuild(state); announce(placed ? 'ready' : 'empty', placed); }
    catch (error) { console.error('Home scene failed to build:', error); releaseObjects(furnitureMeshes); furniture.clear(); overlay.clear(); announce('error', 0); }
    return true;
  }

  /** The placed object a point on the furniture belongs to: the one whose footprint (or wall mounting) holds it, highest floor first. */
  function objectAt(point: THREE.Vector3) {
    let found: string | null = null, foundFloor = -1;
    for (const item of itemsOf(lastState)) {
      const def = FURNITURE[item?.itemId], floor = floorOf(item);
      if (!def || floor > shownFloor || floor < foundFloor) continue;
      const at = mountOf(def, item.x, item.y, item.rot, floor);
      let hit: boolean;
      if (def.wall) hit = partShown(at.part) && Math.hypot(point.x - at.x, point.y - at.y, point.z - at.z) < at.scale * 1.1;
      else {
        const [ax, az, bx, bz] = rectOf(def, item, -0.06), base = lift(floor);
        hit = point.x > ax && point.x < bx && point.z > az && point.z < bz
          && point.y > base - 0.06 && point.y < base + Math.max(TALL[def.shape] || 0.7, 2) * tile;
      }
      if (hit) { found = item.id; foundFloor = floor; }
    }
    return found;
  }
  /** What is under a point of the canvas: { id (furniture), cell (floor tile), x, z (the floor point), rect (the furniture's footprint) } | null. */
  function pickAt(clientX: number, clientY: number): HomePick | null {
    if (!group.visible || !camera || !canvas || !lastState) return null;
    const box = canvas.getBoundingClientRect();
    if (!box.width || !box.height) return null;
    pointer.set(((clientX - box.left) / box.width) * 2 - 1, -((clientY - box.top) / box.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    group.updateMatrixWorld(true);
    // What is on a hidden wall or a lifted-off floor cannot be tapped.
    const touched = raycaster.intersectObjects(furniture.children.filter((child) => child.visible), false)[0];
    const id = !visit && touched ? objectAt(group.worldToLocal(touched.point.clone())) : null;
    let cell = null, x = NaN, z = NaN;
    floorPlane.constant = -(lift(shownFloor) + 0.016) - group.position.y;
    const point = raycaster.ray.intersectPlane(floorPlane, new THREE.Vector3());
    if (point) {
      group.worldToLocal(point);
      x = point.x; z = point.z;
      const cx = Math.floor((point.x + ROOM / 2) / tile), cy = Math.floor((point.z + ROOM / 2) / tile);
      if (cx >= 0 && cy >= 0 && cx < plot.w && cy < plot.d) cell = { x: cx, y: cy };
    }
    if (!id && !cell) return null;
    let rect: HomePick['rect'] = null;
    const item = id ? lastState.home?.items?.find((entry) => entry.id === id) : null, def = FURNITURE[item?.itemId ?? ''];
    if (def && item && !def.wall) rect = rectOf(def, item);
    return { id, cell, x, z, rect };
  }
  /** Tell the Buy panel / home chip that an object or a tile was chosen — what a tap has always done. */
  function use(id?: string | null, cell?: { x: number; y: number } | null) { if (!visit) window.dispatchEvent(new CustomEvent('jaw:home-pick', { detail: { id: id ?? null, cell: cell ?? null } })); }
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
    if (visit) return;
    const detail = (event as CustomEvent<{ selected?: unknown; buy?: unknown; floor?: unknown; ghost?: HomeGhost | null; retry?: unknown } | null>).detail || {};
    ui = { selected: typeof detail.selected === 'string' ? detail.selected : null, buy: detail.buy === true, ghost: detail.ghost && FURNITURE[detail.ghost.itemId] ? { ...detail.ghost } : null, ...(Number.isInteger(detail.floor) ? { floor: detail.floor as number } : {}) };
    syncFloor();
    if (detail.retry) { drawn = ''; status = ''; guestBodies.retry(); }
    // Rebuild now so the frame the sender asks the host for shows it; drawing stays the host's job.
    // `undrawn` makes the next update() report a change unless a frame has been drawn meanwhile.
    if (lastState && refresh(lastState)) undrawn = true;
  };
  globalThis.window?.addEventListener?.('jaw:home-ui', onUi);
  // The Buy panel says `buy` only when it has something to draw; the shell's view is known the moment Buy opens.
  // (A scene built while Buy is already open reads the view the shell wrote on its root element.)
  let shellMode = globalThis.document?.querySelector?.<HTMLElement>('.life-ui')?.dataset?.mode || 'venue';
  const onMode = (event: Event) => { shellMode = (event as CustomEvent<{ mode?: string } | null>).detail?.mode || 'venue'; if (shellMode !== 'venue') cancelDoor(); };
  const buying = () => !visit && (ui.buy || shellMode === 'buy');
  globalThis.window?.addEventListener?.('jaw:mode', onMode);

  grid = HOUSES[DEFAULT_HOUSE].grid; tile = ROOM / grid; plot = plotOf(grid); plan = planOf(plot);
  buildRoom();

  return {
    group,
    get homeDoor() { const x = along(0), z = along(doorSlot(grid)); return { x, y: 0.03, z, ry: -Math.PI / 2, direction: 'outside' as const, ...route(0, x, z) }; },
    get background() { return lightingFor('indoor', homeTime).sky[0]; },
    get sky() { return lightingFor('indoor', homeTime).sky; },
    lighting() { return lightingFor('indoor', homeTime); },
    ground: '#7f8f7c',
    /** The whole house in view: a bigger plot steps the camera back in proportion. */
    get camera(): SceneCamera {
      const k = Math.max(1, (Math.max(plot.w, plot.d) * tile) / ROOM);
      return { landscape: [17.5 * k, 19.5 * k, 17.5 * k], portrait: [19 * k, 24 * k, 19 * k] };
    },
    update(state: LifeState) {
      if (state.activeAction || (doorVisual && !doorDone)) cancelDoor();
      const first = lastState === null;
      const nextTime = Number.isFinite(state.t) ? timeOfDay(state.t) : homeTime;
      const timeChanged = nextTime !== homeTime;
      homeTime = nextTime;
      if (timeChanged) glow.intensity = 26 * lightingFor('indoor', homeTime).lamps;
      lastState = state;
      const room = refresh(state);
      const changed = refreshPeople(state) || room || first || undrawn || timeChanged;
      undrawn = false;
      return changed;
    },
    /** The player's avatar: { look, seed, name, pose? }. Returns true when it changed what is drawn. */
    setPlayer({ look, seed, name, pose }: HomePlayer = {}) {
      if (pose != null) cancelDoor();
      who = { look, seed: seed ?? 'you', name: String(name ?? 'You'), pose: (pose as Pose | null | undefined) || null };
      return refreshPeople(lastState);
    },
    /** Guests the host let in, on reachable social floor space: [{ id, name, look?, seed? }]. */
    setCrowd(list: unknown) {
      guests = (Array.isArray(list) ? list as Record<string, unknown>[] : []).filter((person) => person && typeof person === 'object').slice(0, MAX_GUESTS_SHOWN)
        .map((person) => ({ id: person.id, name: person.name, kind: person.kind, look: person.look ?? null, seed: person.seed ?? person.id }));
      refreshPeople(lastState);
      return guestTags;
    },
    tags: () => {
      const door = { id: 'home-door', name: 'Step outside', kind: 'home-door', text: 'Step outside', marker: 'tag', position: { x: along(0), y: 1.5, z: along(doorSlot(grid)) } };
      return buying() ? (selfTag ? [selfTag, ...guestTags] : [...guestTags]) : [door, ...(selfTag ? [selfTag, ...guestTags] : guestTags)];
    },
    look,
    // The skinned body's sit-down (always false without the body): the host steps it in its motion loop.
    get easing() { return Boolean(body?.easing || sequence.easing || doorDone); },
    beginDoor(done: () => void) {
      if (!hinge) { done(); return; }
      doorDone = done; doorVisual = true; doorRelease.x = floorAt.x; doorRelease.z = floorAt.z; hinge.begin(() => {}, 2.4);
      if (body) body.show('homeDoor', false); else show('work');
      placeBody(); markAvatar();
    },
    get objectPhase() { return sequence.phase; },
    get bodyShown() { return body !== null; },
    startCrowd(renderer: { getContext?: () => unknown }, changed: () => void) {
      if (gone || !body || !drawsWebGL2(renderer)) return;
      guestChanged = changed;
      guestBodies.start();
    },
    get crowdRendering() { return guestBodies.counts; },
    stepCrowd(dt: number) {
      const more = Boolean(body?.step(dt)), using = sequence.step(dt), door = hinge?.step(dt) ?? false;
      if (doorDone && body) body.sampleUse('homeDoor', Math.min(2.399, (hinge?.progress ?? 0) * 2.4));
      if (!more) placeBody();
      const action = sequence.presented; if (action) useProps.update(action, body); else useProps.hide();
      syncPresentation();
      markAvatar(); finishDoor(); return more || using || door || Boolean(doorDone);
    },
    settleCrowd() {
      sequence.settle(); body?.settle(); placeBody();
      hinge?.settle(); finishDoor();
      const action = sequence.presented; if (action) useProps.update(action, body); else useProps.hide();
      syncPresentation();
      markAvatar();
    },
    /** Which walls are showing right now: { back, left } (true = shown). */
    get walls() { return { back: !hiddenWalls.back, left: !hiddenWalls.left }; },
    /** The floor the avatar is on (0 = the ground floor) and how many the house has. */
    get floor() { return viewFloor(); },
    get floors() { return plot.floors; },
    /** True in Buy mode: taps place and pick furniture, and the host does not walk the avatar. */
    get placing() { return buying(); },
    pickAt, use,
    /** Floor furniture and where it stands, for diagnostics: [{ id, itemId, x, y, z }] (centre of the footprint, on its floor). */
    objects() {
      return itemsOf(lastState).filter((item) => FURNITURE[item?.itemId] && !FURNITURE[item.itemId]!.wall)
        .map((item) => { const [ax, az, bx, bz] = rectOf(FURNITURE[item.itemId]!, item); return { id: item.id, itemId: item.itemId, x: (ax + bx) / 2, y: lift(floorOf(item)), z: (az + bz) / 2 }; });
    },
    /** Walking — the same contract as a venue scene's `walk` (src/scene/venue-scenes.ts). */
    walk: {
      get grid() { return walkGrid; },
      get entrance() { return { x: along(0), y: 0.03, z: along(doorSlot(grid)), ry: Math.PI / 2 }; },
      open: false,
      get scale() { return tile * AVATAR_SCALE; },
      get onStairs() { return Boolean(flightAt(plan, level, (floorAt.x + ROOM / 2) / tile, (floorAt.z + ROOM / 2) / tile)); },
      // The camera turns about the middle of the house at the height of the floor in view, so a full
      // orbit keeps the house in place on screen (the host already lifts the scene clear of the bottom panels).
      get centre(): Vec3 { return [edge(plot.w / 2), 0.7 + lift(viewFloor()), edge(plot.d / 2)]; },
      avatar,
      drive(on: unknown) { driven = Boolean(on); if (!driven) cancelDoor(); if (!driven && restAt) { level = restFloor; show(restAt.pose); moveAvatar(restAt.x, restAt.y, restAt.z, restAt.ry); poseBody(restAt.pose, false); } },
      rest: () => restAt,
      spots: () => [],
      people: () => guestTags.map((tag) => ({ id: tag.id, kind: tag.kind, x: tag.position.x, z: tag.position.z, top: tag.position.y })),
      get solids() { return solids; },
      move: moveAvatar,
      pose: (name: string) => {
        if (doorDone) { if (name === 'stand') return false; cancelDoor(); }
        rigOf(figures.get('stand'))?.rest();
        const pose = (POSES as readonly string[]).includes(name) ? name as Pose : name.startsWith('stairs') ? 'walk' : 'stand';
        if (pose === 'work' && sequence.action) {
          arriveObject();
          if (sequence.phase === 'approach' || sequence.phase === 'align') { const changed = show('stand'); poseBody('stand', false); return changed; }
          return show('work');
        }
        const shown = show(pose);
        if (sequence.phase === 'exit') return shown;
        if (body) { poseBody(pose, true); return true; }
        return shown;
      },
      // With a rigged figure the limbs swing with `phase`; without one the two figures alternate (avatar-rig.js).
      gait(step: boolean, phase = 0, jog = false) {
        if (doorVisual) cancelDoor();
        if (sequence.easing || sequence.phase === 'rest') { sequence.interrupt(); useProps.hide(); }
        if (body) {
          const run = Math.hypot(floorAt.x - lastGait.x, floorAt.z - lastGait.z);
          let slope = run > 1e-4 ? (floorAt.y - lastGait.y) / run : 0;
          const flight = flightAt(plan, level, (floorAt.x + ROOM / 2) / tile, (floorAt.z + ROOM / 2) / tile)?.flight;
          if (flight && Math.abs(slope) < 0.3) slope = (Math.sign(floorAt.x - lastGait.x) || 1) * flight.dir * WALL_HEIGHT / (flight.w * tile);
          lastGait.x = floorAt.x; lastGait.y = floorAt.y; lastGait.z = floorAt.z;
          body.stride(phase, jog, Math.abs(slope) >= 0.3 ? slope : 0); placeBody();
          if (!sequence.presented && !doorDone) body.solveFeet(contact => contactHeightAt(contact.x, contact.z, contact.y));
        }
        syncPresentation();
        const rig = rigOf(figures.get('stand')); const changed = rig ? (rig.stride(phase, 1, jog), show('stand')) : show(step ? 'walk' : 'stand');
        markAvatar(); return changed;
      },
      /** The height of the floor under (x, z): the floor the avatar is on, or part-way up a flight of stairs. */
      heightAt(x: number, z: number) {
        const on = settle(x, z);
        return (on ? lift(on.flight.floor) + on.up * WALL_HEIGHT : lift(level)) + 0.03;
      },
      /** Actual tread/flat surface for foot contact. Never changes the root's active floor. */
      contactHeightAt,
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
        const y = lift(viewFloor());
        const changed = goalMark.visible !== visible || (visible && (goalMark.position.x !== x || goalMark.position.z !== z || goalMark.position.y !== y));
        goalMark.visible = visible;
        if (visible) goalMark.position.set(x!, y, z!);
        return changed;
      },
    },
    /** Free the house, the furniture and the avatars, and stop listening. */
    dispose() {
      gone = true; guestChanged = null; guestBodies.dispose();
      doorDone = null; hinge?.dispose(); hinge = null;
      useProps.dispose();
      sequence.dispose();
      releaseObjects(actorMeshes);
      releaseObjects(markMeshes);
      releaseObjects(roomMeshes);
      releaseObjects(furnitureMeshes);
      goalMark = null;
      clearFigures();
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
