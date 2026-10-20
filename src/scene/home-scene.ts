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
 * CANONICAL BODY (src/scene/body/skinned.ts)
 *   The host preloads the shared templates before constructing this room. Its visible body exists before the first
 *   frame: idle at rest, the walk/jog clip at the host's stride phase, and on a
 *   furniture activity it takes the furniture: sits on a chair or sofa, lies on a bed or mat (sleep, stay in bed, nap),
 *   soaks in the tub, washes at a bucket or shower (sit-enter / lie-down play when the avatar walked there; sit-exit /
 *   get-up play where it lay). The clips run through `easing` / stepCrowd / settleCrowd.
 */
import { FURNITURE as CATALOGUE, KINDS as KIND_TABLE, HOME_ACTIVITIES, PORTED_ACTIVITY_KIND } from '../game/content/furniture.ts';
import { homeMementos } from '../game/mementos.ts';
import type { HomeMemento } from '../types/mementos.ts';
import { ACHIEVEMENTS } from '../game/content/achievements.ts';
import type { AchievementId } from '../types/achievements.ts';
import { RECIPES } from '../game/content/food.ts';
import { createBatch, sceneMaterials, releaseObjects } from './build.ts';
import { POSES, normalizeLook } from './characters.ts';
import { createPartyLayer } from './party-dress.ts';
import type { PartyDressing } from './party-dress.ts';
import { asoEbiLook } from '../festivals/party.ts';
import type { Pose } from './characters.ts';
import { buildCanonicalCrowd } from './body/canonical-crowd.ts';
import { createWalkGrid } from './movement.ts';
import { createBody } from './body/skinned.ts';
import { lightingFor, timeOfDay } from './lighting.ts';
import { createObjectSequence } from './smart-objects/sequence.ts';
import { createUseProps } from './smart-objects/props.ts';
import { createHingedHomeDoor } from './smart-objects/door.ts';
import type { ObjectAction } from './smart-objects/sequence.ts';
import type { BodyPose, SkinnedBody } from './body/skinned.ts';
import { HOUSES, DEFAULT_HOUSE, homeOf } from '../game/content/housing.ts';
import { housesFor } from '../game/cities/housingRuntime.ts';
import { cachedCityContent, cityRules } from '../game/cities/registry.ts';
import { CLEAR_LOOK, lookAt, lookKey } from '../game/conditions/look.ts';
import type { LookConditions } from '../game/conditions/look.ts';
import type { Weather } from './fx/weather.ts';
import { withWetQuery } from './weather-query.ts';
import type { HomePalette } from '../types/content.ts';
import { HOUSE_DESIGNS, HOUSE_STYLE } from '../game/content/world.ts';
import { footprint, windowSlot, doorSlot, plotOf } from '../game/home-layout.ts';
import { zonesOf } from './home-zones.ts';
import type { Plot } from '../game/home-layout.ts';
import { planOf, wallsOf, bumpsOf, railsOf, flightAt, stairwellOf, routeOf, slabOf, finishAt, nearestFree } from '../game/home-plan.ts';
import type { HousePlan, PlanStairs, PlanWall } from '../game/home-plan.ts';
import type * as THREE from 'three';
import type { Kit } from './kit.ts';
import type { Batch, Colour, SceneCamera, TimeOfDay, Vec3 } from './types.ts';
import type { WalkGrid, WalkPoint, WalkRect } from './movement.ts';
import type { FurnitureDefinition } from '../types/content.ts';
import type { HouseStyle, LifeState, PlacedItem } from '../types/life.ts';

/** Public furnishings only. Visits keep the viewer's avatar and never act on these items. */
export interface VisitHomeScene { grid: number; style: HouseStyle; items: readonly PlacedItem[]; owned: boolean; achievement?: AchievementId; mementos?: readonly HomeMemento[] }

/** The modelling tools a furniture shape draws with (the kit's primitives bound to one group, or a batch part). */
export interface Tools {
  box(x: number, y: number, z: number, w: number, h: number, d: number, c: Colour, lit?: boolean): unknown;
  round(x: number, y: number, z: number, r: number, h: number, c: Colour, lit?: boolean): unknown;
  ball(x: number, y: number, z: number, r: number, c: Colour): unknown;
  crown(x: number, y: number, z: number, sx: number, sy: number, sz: number, c: Colour): unknown;
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
/** A guest the host let in, as setCrowd keeps it. */
interface Guest { id: unknown; name: unknown; kind: unknown; look: unknown; seed: unknown }
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
/** The clip pose for each scene pose. 'sit' needs a seat (else idle). */
const BODY_POSE: Record<Pose, BodyPose> = { stand: 'idle', sit: 'sit', walk: 'walk', jog: 'jog', wave: 'interact', work: 'interact', dance: 'dance', relax: 'idle' };
/** The shared room colours (Lagos): a city's content may give its own `homePalette`. */
export const ROOM_PALETTE: HomePalette = Object.freeze({ back: '#d7ccb0', left: '#c3cbb6', floor: Object.freeze(['#d9cdb4', '#bfae8f'] as const) });
const WOOD = '#7a5c40', DARK = '#33373d', WHITE = '#f3f1ea', STEEL = '#9aa3a8';
/** An avatar is 2.45 units tall in venue scale; furniture here is modelled one unit per tile (about a metre). */
const AVATAR_SCALE = 0.72;
/** Others drawn in a room: a home takes five guests (src/game/visit.ts), a group's room up to fifteen (src/places/model.ts). */
export const MAX_GUESTS_SHOWN = 15;
/** How tall each furniture shape stands, in tiles — what can come between the camera and the avatar (camera-collision.js). Unlisted shapes are low. */
const TALL: Record<string, number | undefined> = { bed: 1.3, fridge: 1.9, shower: SHOWER_HEAD + 0.02, speaker: 1.25, tv: 1.4, shelf: 1.5, wardrobe: 1.7, tripod: 1.25, mic: 1.3, floorlamp: 1.7, cage: 1.5, aquarium: 1.15, plant: 1.1, drum: 1, cooker: 1.1, desk: 1, bench: 1, inverter: 0.95, chair: 0.95, sofa: 0.85 };

/** A hex colour moved `t` of the way to `to`: dados, skirting and shadows are derived from whatever palette the city gives. */
const mix = (a: Colour, to: Colour, t: number): Colour => {
  const x = parseInt(a.slice(1), 16), y = parseInt(to.slice(1), 16), ch = (s: number) => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t);
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
};
/** A cushioned box: the body, and a slightly lighter, inset top so the edge reads as rounded from above. */
const soft = (b: Tools, x: number, y: number, z: number, w: number, h: number, d: number, c: Colour, e = 0.04) => {
  b.box(x, y - e / 2, z, w, h - e, d, c); b.box(x, y + h / 2 - e / 2, z, w - e * 2, e, d - e * 2, mix(c, '#ffffff', 0.14));
};
const legs = (b: Tools, w: number, d: number, h: number, c: Colour = WOOD) => { for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) b.box(x, h / 2, z, 0.06, h, 0.06, c); };

/** One low-poly model per catalogue `shape`. Units are tiles; origin is the footprint centre on the floor; W × D is the footprint. */
const SHAPES: { fallback: Shape; [shape: string]: Shape | undefined } = {
  mat(b, W, D, c) { b.box(0, 0.04, 0, W * 0.84, 0.06, D * 0.9, c); b.box(0, 0.1, -D * 0.36, W * 0.5, 0.07, D * 0.12, WHITE); },
  bed(b, W, D, c, def) {
    const wood = def.stars >= 4 ? '#c9a227' : WOOD, top = 0.5 + def.stars * 0.08, tall = 0.7 + def.stars * 0.16;
    b.box(0, 0.2, 0, W * 0.92, 0.26, D * 0.94, wood);
    for (const x of [-1, 1]) for (const z of [-1, 1]) b.box(x * W * 0.43, 0.04, z * D * 0.44, 0.1, 0.08, 0.1, mix(wood, '#000000', 0.35));
    soft(b, 0, 0.42, 0, W * 0.86, 0.2, D * 0.9, WHITE);
    soft(b, 0, 0.54, D * 0.14, W * 0.88, 0.07, D * 0.58, c, 0.025);
    b.box(0, 0.552, -D * 0.14, W * 0.88, 0.078, 0.14, mix(c, '#ffffff', 0.55));
    b.box(0, 0.565, D * 0.4, W * 0.88, 0.06, 0.2, mix(c, '#000000', 0.2));
    for (let i = 0; i < W; i++) soft(b, (i - (W - 1) / 2) * 0.8, 0.58, -D * 0.38, 0.55, 0.12, D * 0.12 + 0.08, '#ffffff', 0.04);
    b.box(0, top, -D * 0.47, W * 0.92, tall, 0.07, wood); b.box(0, top + tall * 0.1, -D * 0.435, W * 0.76, tall * 0.62, 0.02, mix(wood, '#ffffff', 0.12));
    for (const x of [-1, 1]) b.box(x * W * 0.46, top + tall / 2 + 0.05, -D * 0.47, 0.09, 0.09, 0.09, mix(wood, '#000000', 0.25));
  },
  stove(b, W, D, c) {
    b.box(0, 0.5, 0, 0.82, 0.06, 0.82, '#8a6b4a'); legs(b, 0.68, 0.68, 0.5);
    b.round(0, 0.63, 0, 0.2, 0.2, c);
  },
  cooker(b, W, D, c) {
    b.box(0, 0.43, 0, W * 0.84, 0.86, D * 0.8, c); b.box(0, 0.88, 0, W * 0.86, 0.04, D * 0.82, DARK);
    for (let i = 0; i < W * 2; i++) b.round((i + 0.5) * 0.42 - W * 0.42, 0.92, 0, 0.13, 0.04, '#6c7278');
    b.box(0, 1.0, -D * 0.37, W * 0.84, 0.2, 0.05, c); b.box(0, 0.45, D * 0.41, W * 0.6, 0.4, 0.02, DARK);
    b.round(-W * 0.2, 1.0, 0.04, 0.17, 0.2, '#b9bdc0'); b.round(-W * 0.2, 1.12, 0.04, 0.18, 0.03, '#8a8f93'); b.box(-W * 0.2 + 0.2, 1.02, 0.04, 0.12, 0.04, 0.04, DARK);
  },
  cooler(b, W, D, c) { b.box(0, 0.24, 0, 0.62, 0.44, 0.44, c); b.box(0, 0.5, 0, 0.66, 0.09, 0.48, WHITE); b.box(0, 0.58, 0, 0.3, 0.05, 0.06, c); },
  fridge(b, W, D, c, def) {
    const h = 1.3 + def.stars * 0.12;
    const split = h * 0.68, edge = mix(c, '#000000', 0.12);
    b.box(0, 0.03, 0, 0.7, 0.06, 0.66, DARK); b.box(0, (h - 0.06) / 2 + 0.06, 0, 0.74, h - 0.12, 0.7, c); b.box(0, h - 0.03, 0, 0.7, 0.06, 0.66, mix(c, '#ffffff', 0.18));
    b.box(0, split, 0.355, 0.72, 0.025, 0.02, DARK); b.box(0, h / 2 + 0.05, 0.355, 0.012, h - 0.2, 0.012, edge);
    for (const [y, tall] of [[split + 0.1, 0.22], [split - 0.38, 0.4]] as const) b.box(0.29, y, 0.375, 0.035, tall, 0.035, STEEL);
    b.box(-0.2, split + 0.12, 0.362, 0.1, 0.12, 0.012, '#d9d4c0'); b.box(-0.2, split + 0.17, 0.37, 0.1, 0.02, 0.012, '#c9372c');
    for (const [x, y, m] of [[-0.12, split - 0.2, '#35a06b'], [-0.24, split - 0.3, '#e0a526'], [0, split - 0.36, '#2f6fbf']] as const) b.box(x, y, 0.362, 0.06, 0.06, 0.014, m);
  },
  drum(b, W, D, c) { b.round(0, 0.48, 0, 0.36, 0.96, c); b.round(0, 0.98, 0, 0.38, 0.05, '#2c4f76'); b.round(0, 0.3, 0, 0.375, 0.04, '#2c4f76'); b.round(0, 0.66, 0, 0.375, 0.04, '#2c4f76'); },
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
    soft(b, 0, 0.38, 0, 0.5, 0.06, 0.5, c, 0.025); legs(b, 0.42, 0.42, 0.36, mix(c, '#000000', 0.25));
    for (const x of [-0.2, 0.2]) b.box(x, 0.62, -0.23, 0.05, 0.42, 0.05, mix(c, '#000000', 0.15));
    b.box(0, 0.84, -0.23, 0.5, 0.06, 0.05, c); soft(b, 0, 0.64, -0.23, 0.36, 0.26, 0.04, c, 0.02);
  },
  sofa(b, W, D, c) {
    const dark = mix(c, '#000000', 0.18);
    for (const x of [-1, 1]) for (const z of [-1, 1]) b.box(x * W * 0.42, 0.04, z * D * 0.34, 0.07, 0.08, 0.07, WOOD);
    b.box(0, 0.19, 0, W * 0.94, 0.22, D * 0.84, dark); soft(b, 0, 0.62, -D * 0.34, W * 0.94, 0.5, D * 0.18, c, 0.05);
    for (const side of [-1, 1]) soft(b, side * (W * 0.47 - 0.07), 0.46, 0, 0.14, 0.38, D * 0.84, c, 0.05);
    for (let i = 0; i < W; i++) {
      const x = (i - (W - 1) / 2) * 0.82;
      soft(b, x, 0.4, D * 0.06, 0.7, 0.2, D * 0.52, mix(c, '#ffffff', 0.08), 0.05);
      soft(b, x, 0.68, -D * 0.2, 0.66, 0.36, 0.12, mix(c, '#ffffff', 0.05), 0.04);
    }
    // Ankara-style throw pillows: a bold ground with a contrasting inner panel, one at each end.
    for (const [x, ground, panel] of [[W / 2 - 0.4, '#d9a441', '#1f5f8b'], [-W / 2 + 0.4, '#1f5f8b', '#e0702c']] as const) { soft(b, x, 0.68, -D * 0.1, 0.3, 0.3, 0.1, ground, 0.03); b.box(x, 0.68, -D * 0.1 + 0.052, 0.16, 0.16, 0.01, panel); }
  },
  beanbag(b, W, D, c) { b.ball(0, 0.26, 0, 0.38, c); b.ball(0, 0.5, -0.08, 0.24, c); },
  rug(b, W, D, c) {
    // A wax-print rug: border bands, then rows of bold circles in two-tone prints.
    b.box(0, 0.02, 0, W * 0.94, 0.03, D * 0.94, c); b.box(0, 0.04, 0, W * 0.86, 0.02, D * 0.86, '#efe3c4'); b.box(0, 0.055, 0, W * 0.8, 0.02, D * 0.8, '#1f5f8b');
    const prints = [['#d9a441', '#c9372c'], ['#efe3c4', '#e0702c']] as const, nx = Math.max(2, Math.round(W * 1.5)), nz = Math.max(2, Math.round(D * 1.5));
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const [outer, inner] = prints[(i + j) % 2]!, x = (i + 0.5 - nx / 2) * (W * 0.7 / nx), z = (j + 0.5 - nz / 2) * (D * 0.7 / nz), r = Math.min(W * 0.7 / nx, D * 0.7 / nz) * 0.4;
      b.round(x, 0.075, z, r, 0.02, outer); b.round(x, 0.087, z, r * 0.5, 0.01, inner);
    }
    for (const z of [-1, 1]) b.box(0, 0.012, z * D * 0.485, W * 0.9, 0.02, 0.05, '#efe3c4');
  },
  radio(b, W, D, c) {
    b.round(0, 0.4, 0, 0.26, 0.06, WOOD); legs(b, 0.3, 0.3, 0.4);
    b.box(0, 0.56, 0, 0.44, 0.26, 0.16, c); b.round(-0.1, 0.56, 0.085, 0.07, 0.02, DARK); b.box(0.18, 0.84, 0, 0.015, 0.34, 0.015, STEEL);
  },
  speaker(b, W, D, c) { b.box(0, 0.6, 0, 0.5, 1.2, 0.46, c); b.ball(0, 0.85, 0.2, 0.14, '#5b6068'); b.ball(0, 0.42, 0.2, 0.2, '#5b6068'); b.box(0, 1.22, 0, 0.3, 0.04, 0.1, '#35d07f', true); },
  board(b, W, D, c) { b.box(0, 0.3, 0, 0.7, 0.05, 0.7, WOOD); legs(b, 0.56, 0.56, 0.3); b.box(0, 0.34, 0, 0.56, 0.03, 0.56, c); b.box(-0.14, 0.36, -0.14, 0.2, 0.02, 0.2, '#c9372c'); b.box(0.14, 0.36, 0.14, 0.2, 0.02, 0.2, '#2f6fbf'); },
  tv(b, W, D, c) {
    soft(b, 0, 0.26, 0, W * 0.82, 0.44, 0.4, c, 0.03); legs(b, W * 0.74, 0.3, 0.05, DARK);
    for (const x of W > 1 ? [-1, 1] : [0]) b.box(x * W * 0.2, 0.26, 0.205, W > 1 ? W * 0.34 : W * 0.7, 0.32, 0.012, mix(c, '#000000', 0.22));
    b.box(0, 0.53, 0, 0.1, 0.06, 0.1, DARK);
    b.box(W * 0.1, 0.5, 0.05, W * 0.46, 0.012, 0.28, '#f4efe0'); b.box(W * 0.1, 0.486, 0.19, W * 0.46, 0.02, 0.02, '#d9d0b8');
    if (W > 1) { b.box(-W * 0.3, 0.55, 0.08, 0.16, 0.12, 0.02, WOOD); b.box(-W * 0.3, 0.55, 0.09, 0.13, 0.09, 0.012, '#9bbad4'); }
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
    soft(b, 0, 0.62, 0, W * 0.9, 0.06, 0.62, c, 0.02); legs(b, W * 0.8, 0.5, 0.6, DARK);
    b.box(-W * 0.28, 0.46, 0.02, W * 0.3, 0.26, 0.5, mix(c, '#000000', 0.2)); b.box(-W * 0.28, 0.46, 0.275, W * 0.26, 0.2, 0.012, mix(c, '#000000', 0.05)); b.box(-W * 0.28, 0.46, 0.285, 0.1, 0.02, 0.014, STEEL);
    b.box(0, 0.67, 0.02, 0.44, 0.02, 0.3, STEEL); b.box(0, 0.83, -0.14, 0.44, 0.3, 0.02, DARK); b.box(0, 0.83, -0.125, 0.4, 0.26, 0.01, '#8fd0ff', true);
    b.box(W * 0.3, 0.72, -0.1, 0.1, 0.14, 0.1, '#d9574f');
  },
  shelf(b, W, D, c) {
    b.box(0, 0.75, -0.14, 0.8, 1.5, 0.05, c); for (const x of [-0.39, 0.39]) b.box(x, 0.75, 0, 0.04, 1.5, 0.34, c);
    b.box(0.2, 1.57, 0, 0.2, 0.14, 0.03, WOOD); b.box(0.2, 1.57, 0.02, 0.16, 0.1, 0.012, '#d7b58a'); b.box(-0.12, 1.55, 0, 0.14, 0.1, 0.03, WOOD); b.box(-0.12, 1.55, 0.02, 0.1, 0.07, 0.012, '#9bbad4');
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
  plant(b, W, D, c) {
    b.round(0, 0.15, 0, 0.18, 0.3, '#b9744f'); b.round(0, 0.32, 0, 0.23, 0.05, '#c98660'); b.round(0, 0.345, 0, 0.19, 0.02, '#4a3526');
    // Upright leaf blades round the pot (a snake plant): each a tall, narrow lump, taller and darker at the middle.
    for (let i = 0; i < 8; i++) {
      const a = i * 2.4, r = i < 2 ? 0.02 : 0.1 + (i % 3) * 0.035, tall = i < 2 ? 0.62 : 0.34 + (i % 4) * 0.07;
      b.crown(Math.cos(a) * r, 0.34 + tall * 0.9, Math.sin(a) * r, 0.055, tall * 0.9, 0.09, i % 2 ? c : mix(c, '#000000', 0.22));
    }
    b.crown(0.13, 0.8, 0.06, 0.04, 0.2, 0.07, '#a8c46a');
  },
  wardrobe(b, W, D, c) {
    b.box(0, 0.04, 0.02, W * 0.9, 0.08, 0.5, mix(c, '#000000', 0.4)); b.box(0, 0.88, 0, W * 0.92, 1.64, 0.56, c); b.box(0, 1.73, 0, W * 0.96, 0.06, 0.6, mix(c, '#000000', 0.15));
    b.box(0, 0.88, 0.285, 0.02, 1.6, 0.01, DARK);
    for (const s of [-1, 1]) { soft(b, s * W * 0.22, 1.0, 0.29, W * 0.38, 1.1, 0.012, mix(c, '#ffffff', 0.1), 0.02); soft(b, s * W * 0.22, 0.28, 0.29, W * 0.38, 0.3, 0.012, mix(c, '#ffffff', 0.1), 0.02); }
    for (const x of [-0.07, 0.07]) b.box(x, 0.9, 0.3, 0.03, 0.2, 0.03, STEEL);
  },
  aquarium(b, W, D, c) { b.box(0, 0.3, 0, 0.8, 0.6, 0.44, WOOD); b.box(0, 0.86, 0, 0.78, 0.5, 0.4, c); b.box(0, 1.13, 0, 0.8, 0.05, 0.42, DARK); b.box(-0.15, 0.9, 0.205, 0.12, 0.06, 0.01, '#ffb347', true); b.box(0.18, 0.78, 0.205, 0.1, 0.05, 0.01, '#ff6f61', true); },
  petbed(b, W, D, c) {
    b.round(0, 0.07, 0, 0.4, 0.14, '#7a8f9a'); b.box(0, 0.24, 0, 0.42, 0.2, 0.24, c); b.ball(0.24, 0.36, 0.02, 0.13, c);
    for (const z of [-0.07, 0.11]) b.box(0.27, 0.5, z, 0.05, 0.1, 0.05, c); b.box(-0.26, 0.3, 0, 0.14, 0.05, 0.05, c);
  },
  cage(b, W, D, c) { b.round(0, 0.03, 0, 0.2, 0.05, DARK); b.round(0, 0.5, 0, 0.025, 0.94, STEEL); b.round(0, 1.2, 0, 0.26, 0.5, '#d8c27a'); b.ball(0, 1.14, 0.2, 0.11, c); b.box(0, 1.14, 0.32, 0.05, 0.04, 0.06, '#c9372c'); },
  // ---- wall items: origin is the mounting point on the wall, facing +z ----
  lamp(b, W, D, c) { b.box(0, 0, 0.04, 0.1, 0.16, 0.08, DARK); b.box(0, 0.06, 0.14, 0.22, 0.24, 0.16, c, true); },
  strip(b, W, D, c) { b.box(0, 0.5, 0.03, 0.9, 0.06, 0.04, c, true); },
  fan(b) {
    b.box(0, 0, 0.06, 0.1, 0.1, 0.12, DARK); b.box(0, -0.02, 0.15, 0.64, 0.64, 0.02, mix(STEEL, '#ffffff', 0.2));
    for (const [x, y, w, h] of [[0, 0.3, 0.64, 0.03], [0, -0.3, 0.64, 0.03], [0.3, 0, 0.03, 0.6], [-0.3, 0, 0.03, 0.6]] as const) b.box(x, y - 0.02, 0.17, w, h, 0.03, STEEL);
    b.box(0, -0.02, 0.2, 0.52, 0.1, 0.02, WHITE); b.box(0, -0.02, 0.2, 0.1, 0.52, 0.02, WHITE); b.box(0, -0.02, 0.22, 0.1, 0.1, 0.03, DARK);
  },
  mirror(b, W, D, c) { b.box(0, -0.4, 0.03, 0.74, 1.8, 0.05, WOOD); b.box(0, -0.4, 0.06, 0.64, 1.68, 0.02, c); },
  calendar(b, W, D, c) { b.box(0, 0, 0.02, 0.4, 0.54, 0.03, c); b.box(0, 0.2, 0.04, 0.4, 0.14, 0.02, '#c9372c'); },
  art(b, W, D, c) { b.box(0, 0, 0.03, 0.74, 0.58, 0.05, WOOD); b.box(0, 0, 0.055, 0.64, 0.48, 0.02, '#f1e9d6'); b.box(0, 0, 0.06, 0.56, 0.4, 0.02, c); b.box(-0.1, 0.02, 0.075, 0.2, 0.2, 0.01, '#e8d9b5'); b.box(0.16, -0.08, 0.075, 0.14, 0.14, 0.01, '#7fa6d9'); },
  fallback(b, W, D, c) { b.box(0, 0.3, 0, W * 0.8, 0.6, D * 0.8, c); },
};

/** Shapes that stand on a round footprint, and those that lie flat on the floor (a shadow under them would only show as a halo). */
const ROUND_SHAPES = new Set(['plant', 'lantern', 'floorlamp', 'drum', 'beanbag', 'mic', 'bucket', 'basin', 'cage', 'stove', 'radio', 'toilet']);
const FLAT_SHAPES = new Set(['rug', 'mat', 'gymmat']);
const within = (zone: readonly number[], tx: number, ty: number) => tx >= zone[0]! && ty >= zone[1]! && tx < zone[0]! + zone[2]! && ty < zone[1]! + zone[3]!;
const TRIM = '#8c7a62', RAIL = '#4a4038', PAINT = '#efe7d4', CURTAIN = '#b5654a', BARS = '#26282c';
/** Curtain colours a home may have, and how its walls lean: a tint towards a harmonious colour, picked by home (deterministic). */
const CURTAINS = ['#b5654a', '#2f7f86', '#c9a03a', '#8a3a46'] as const;
const WALL_TINTS = [null, '#f0d9b0', '#c8d4b8', '#e8c9c0'] as const;
const hashOf = (text: string) => { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h >>> 0; };
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
  ball: (x, y, z, r, c) => batch.ball(x, y, z, r, r, r, c, { part, seg: 9 }),
  crown: (x, y, z, sx, sy, sz, c) => batch.ico(x, y, z, sx, sy, sz, c, { part }),
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
  // An owambe while one is on (setParty): the jollof table, the flying notes, and everyone in the party's aso-ebi (src/scene/party-dress.ts).
  const owambe = createPartyLayer(kit);
  group.add(owambe.group);
  let party: PartyDressing | null = null;
  const glow = new THREE.PointLight('#ffe3b0', 26, 18, 1.5);
  glow.position.set(-1, 3, -1);
  group.add(glow);

  let walls = { back: ROOM_PALETTE.back, left: ROOM_PALETTE.left }, paint: Colour = PAINT, curtain: Colour = CURTAIN, homeKey = '';
  let palette: HomePalette = ROOM_PALETTE, grid = 0, owned = false, tile = 1, drawn = '', lastState: LifeState | null = null, camera: THREE.Camera | null = null, canvas: HTMLElement | null = null, status = '', undrawn = false;
  let homeTime: TimeOfDay = 'day';
  glow.intensity = 26 * lightingFor('indoor', homeTime).lamps;
  // The weather (src/scene/fx, one lazy chunk): rain falls on the yard round the house and never inside it. A dry day never loads it. It asks for no
  // frames of its own: the host's ambient hooks below give it a window of frames when the player acts (as in the venues and the street).
  let weatherFx: Weather | null = null, weatherAsked = false, wetNow: LookConditions = CLEAR_LOOK, onAmbient: ((ready: boolean) => void) | null = null;
  function syncWeather(state: LifeState): boolean {
    const city = state.estate?.city, next = Number.isFinite(state.t) && city ? withWetQuery(lookAt(city, null, cityRules(city)?.climate, state.t)) : wetNow;
    const changed = lookKey(next) !== lookKey(wetNow);
    wetNow = next;
    if (weatherFx) { weatherFx.setTime(homeTime); weatherFx.update(wetNow); if (changed) onAmbient?.(true); return changed; }
    if (!wetNow.wet || weatherAsked || gone) return changed;
    weatherAsked = true;
    void import('./fx/index.ts').then((fx) => fx.loadFxHere()).then(({ tier, weather: fx }) => {
      if (gone) return;
      const half = ROOM / 2 + 0.3;
      // The whole house is cover at any height (the grid caps it): the room is a cutaway with no roof drawn, so drops above its roof line would read as rain in the room.
      weatherFx = fx.createWeather({ THREE, parent: group, tier, time: homeTime, roofs: { boxes: [[-half, 0, -half, half, 1e6, half]], bounds: [-30, -30, 30, 30], buildings: true } });
      weatherFx.update(wetNow); onAmbient?.(true);
    }).catch(() => { weatherAsked = false; });
    return changed;
  }
  let plot: Plot = plotOf(1), plan: HousePlan = planOf(plot);
  // The floor the avatar stands on, and the floors drawn (0 … shownFloor): the ones above are lifted off.
  let level = 0, shownFloor = 0, restFloor = 0, lastAt = { x: NaN, z: NaN };
  let ui: HomeUi = { selected: null, ghost: null, buy: false };
  let who: { look: unknown; seed: string; name: string; pose: Pose | null } = { look: undefined, seed: 'you', name: 'You', pose: null }, guests: Guest[] = [], guestTags: HomeTag[] = [], selfTag: HomeTag | null = null, guestKey = '', restKey = '', dressKey = '';
  const markMeshes: THREE.Mesh[] = [], roomMeshes: THREE.Mesh[] = [], furnitureMeshes: THREE.Mesh[] = [], itemMeshes: THREE.Mesh[] = [];
  let visualLayer: 'canonical' | 'housing' = 'canonical';
  let navigationProjection: ((base: WalkGrid, floor: number) => WalkGrid) | null = null;
  // The player's own figure: a group moved by its transform, with one prebuilt figure per pose.
  let guestBatch: ReturnType<typeof buildCanonicalCrowd> | null = null;
  const avatar = new THREE.Group();
  avatar.name = 'avatar';
  people.add(avatar);
  let presentedBody: SkinnedBody | null = null, presentation = 'everyday';
  let shownPose: Pose = 'stand', driven = false, walkGrid: WalkGrid | null = null, grids: WalkGrid[] = [], gridKey = '', restAt: HomeRest | null = null, goalMark: THREE.Mesh | null = null;
  // Preloaded before scene construction; null only during disposal or a body-shape replacement.
  let body: SkinnedBody | null = null, gone = false, seatAt: Rest | null = null, sat: Spot | undefined;
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
    if (visualLayer === 'housing') {
      for (const mesh of roomMeshes) mesh.visible = false;
      for (const mesh of itemMeshes) mesh.visible = false;
      for (const mesh of furnitureMeshes) {
        const part = mesh.userData.part;
        if (typeof part === 'string' && Number(part.slice(1).split('-')[0]) !== shownFloor) mesh.visible = false;
      }
    }
  }

  /** A window on an outer wall: a deep painted reveal round bright glass, burglar bars, a sill, curtains on a rod, a clock above and a bulb bracket. */
  function windowAt(b: Batch, x: number, y: number, part: string) {
    const wide = Math.min(tile * 0.86, 1.5), z = -ROOM / 2, p = { part }, mid = y + 2.0, inner = mix(paint, '#000000', 0.2);
    b.box(x, mid, z + 0.01, wide - 0.14, 1.04, 0.02, '#cfeaf7', { part, layer: 'glow' });
    // Reveal: the frame stands proud of the wall on four sides, its inner faces a shade darker, so the glass reads as set back.
    b.box(x, mid + 0.6 - 0.035, z + 0.05, wide, 0.07, 0.1, paint, p); b.box(x, mid - 0.6 + 0.035, z + 0.05, wide, 0.07, 0.1, paint, p);
    for (const s of [-1, 1]) b.box(x + s * (wide / 2 - 0.035), mid, z + 0.05, 0.07, 1.2, 0.1, paint, p);
    b.box(x, mid + 0.52, z + 0.05, wide - 0.14, 0.02, 0.09, inner, p); b.box(x, mid - 0.52, z + 0.05, wide - 0.14, 0.02, 0.09, inner, p);
    b.box(x, mid, z + 0.055, 0.04, 1.04, 0.04, paint, p);
    // Burglar bars: iron uprights and two rails in front of the glass, with a diamond at the middle.
    const bars = Math.max(3, Math.round(wide / 0.22));
    for (let i = 0; i <= bars; i++) b.box(x + (i / bars - 0.5) * (wide - 0.16), mid, z + 0.1, 0.022, 1.04, 0.022, BARS, p);
    for (const dy of [-0.2, 0.2]) b.box(x, mid + dy, z + 0.1, wide - 0.14, 0.022, 0.022, BARS, p);
    b.box(x, mid, z + 0.105, 0.2, 0.2, 0.018, BARS, { part, ry: 0, rz: Math.PI / 4 });
    b.box(x, y + 1.37, z + 0.1, wide + 0.22, 0.05, 0.16, paint, p);
    b.box(x, y + 2.8, z + 0.2, wide + 0.8, 0.03, 0.03, '#4a3a2c', p);
    for (const s of [-1, 1]) {
      const cx = x + s * (wide / 2 + 0.17);
      b.box(x + s * (wide / 2 + 0.42), y + 2.8, z + 0.2, 0.06, 0.06, 0.06, '#d9a441', p);
      for (const k of [-1, 0, 1]) b.box(cx + k * 0.13, y + 1.98, z + 0.19 + (k ? 0.012 : 0), 0.12, 1.6, 0.05, k ? mix(curtain, '#000000', 0.14) : curtain, p);
      b.box(cx, y + 1.5, z + 0.2, 0.44, 0.045, 0.07, '#d9a441', p);
    }
    const lampX = x > 0 ? -ROOM * 0.3 : ROOM * 0.3;
    b.box(lampX, y + 3.04, z + 0.05, 0.1, 0.1, 0.1, '#4a3a2c', p); b.box(lampX, y + 2.95, z + 0.12, 0.03, 0.03, 0.14, '#4a3a2c', p);
    b.ball(lampX, y + 2.9, z + 0.2, 0.09, 0.09, 0.09, '#ffe6a8', { part, seg: 8, layer: 'glow' });
    b.cyl(x, y + 3.0, z + 0.035, 0.15, 0.05, '#3b3028', { part, rx: Math.PI / 2, seg: 14 });
    b.cyl(x, y + 3.0, z + 0.062, 0.12, 0.012, '#f3ecda', { part, rx: Math.PI / 2, seg: 14 });
    b.box(x, y + 3.03, z + 0.075, 0.016, 0.1, 0.01, DARK, p); b.box(x + 0.03, y + 3.0, z + 0.075, 0.07, 0.016, 0.01, DARK, p);
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
    plinth.onBeforeRender = (renderer, scene, cam) => { camera = cam; undrawn = false; attach(renderer.domElement); };
    const b = createBatch(THREE);
    // This home's look, the same every time: walls leaning to one of a few harmonious tints, paint and curtains to match, and a floor by tier
    // (ceramic tiles in a single room, speckled terrazzo in a flat, wood planks in the big houses; wet rooms keep their tiles).
    const seed = hashOf(homeKey), lean = visit ? null : WALL_TINTS[seed % WALL_TINTS.length]!;
    walls = { back: lean ? mix(palette.back, lean, 0.3) : palette.back, left: lean ? mix(palette.left, lean, 0.3) : palette.left };
    paint = mix(PAINT, walls.back, 0.18); curtain = CURTAINS[(seed >>> 3) % CURTAINS.length]!;
    const finish = grid <= 6 ? 'tile' : grid <= 9 ? 'terrazzo' : 'wood', wood = mix(['#a9794f', '#9a6a42', '#b58759'][(seed >>> 6) % 3]!, palette.floor[1], 0.15);
    for (let floor = 0; floor < plot.floors; floor++) {
      const y = lift(floor), part = partOf(floor), rooms = plan.floors[floor] ?? [], hole = stairwellOf(plan, floor);
      const open = rooms.length === 1 && /terrace/i.test(rooms[0]!.label), high = open ? 1 : WALL_HEIGHT;
      if (hole) {
        // The slab this floor stands on, round the stairwell, and a rail along the drop.
        for (const [ax, az, bx, bz] of slabOf(plan, floor)) b.box(edge((ax + bx) / 2), y - 0.1, edge((az + bz) / 2), (bx - ax) * tile, 0.2, (bz - az) * tile, '#8c8478', { part });
        for (const line of railsOf(hole, floor)) run(b, line, y + 0.87, 0.06, 0.06, RAIL, part);
      }
      // Grout under the tiles (not where the stairwell is), and each tile a touch lighter or darker than its tone so the floor reads as laid, not printed.
      if (!hole) b.quad(x0 + W / 2, y + 0.01, z0 + D / 2, W, D, mix(palette.floor[1], '#3a2c1c', 0.3), { part, rx: -Math.PI / 2 });
      const bare = (tx: number, ty: number) => !(hole && tx >= hole.x && tx < hole.x + hole.w && ty >= hole.y && ty < hole.y + hole.h);
      const noise = (tx: number, ty: number, k = 0) => (Math.imul(tx + 7, 73856093) ^ Math.imul(ty + 3, 19349663) ^ Math.imul(floor + 1, 83492791) ^ Math.imul(k + 1, 2654435761)) >>> 0;
      // A single-room home is zoned by its floor: a glossy white kitchen corner, a wood-floored sleeping corner and a darker entry strip by the door; the rest is the tier's finish.
      const zones = floor === 0 && plan.floors[0]?.length === 1 && plot.w === plot.grid ? zonesOf(grid) : null;
      const kindAt = (tx: number, ty: number): string => {
        if (finishAt(plan, floor, tx, ty)) return 'tile';
        if (zones) for (const zone of ['kitchen', 'hall', 'bed'] as const) if (within(zones[zone], tx, ty)) return zone === 'kitchen' ? 'gloss' : zone === 'hall' ? 'hall' : finish === 'wood' ? 'terrazzo' : 'wood';
        return finish;
      };
      for (let ty = 0; ty < plot.d; ty++) {
        for (let tx = 0; tx < plot.w; tx++) {
          if (!bare(tx, ty)) continue;
          const kind = kindAt(tx, ty), tones = finishAt(plan, floor, tx, ty) ?? palette.floor, jitter = noise(tx, ty);
          if (kind === 'wood') continue;
          if (kind === 'terrazzo') {
            // One pale slab with scattered chips (dark, white, terracotta) baked in as tiny quads.
            b.quad(along(tx), y + 0.016, along(ty), tile * 0.985, tile * 0.985, mix(mix(tones[0], '#ffffff', 0.3), jitter % 2 ? '#ffffff' : '#000000', (jitter >>> 4) % 3 * 0.015), { part, rx: -Math.PI / 2 });
            for (let k = 0; k < 4; k++) { const n = noise(tx, ty, k), size = tile * (0.03 + (n >>> 8) % 4 * 0.012); b.quad(along(tx) + ((n & 255) / 255 - 0.5) * tile * 0.86, y + 0.019, along(ty) + (((n >>> 12) & 255) / 255 - 0.5) * tile * 0.86, size, size, ['#4a4038', '#fbf8ef', '#b9714f', '#8a8478'][k]!, { part, rx: -Math.PI / 2 }); }
            continue;
          }
          const base = kind === 'gloss' ? ['#f3f5f2', '#e1e7e3'] as const : kind === 'hall' ? [mix(palette.floor[1], '#4a4038', 0.4), mix(palette.floor[1], '#4a4038', 0.52)] as const : tones;
          b.quad(along(tx), y + 0.016, along(ty), tile * 0.965, tile * 0.965, mix((tx + ty) % 2 ? base[0] : base[1], jitter % 3 ? '#ffffff' : '#000000', (jitter >>> 4) % 4 * 0.012), { part, rx: -Math.PI / 2 });
          if (kind === 'gloss') b.quad(along(tx) - tile * 0.12, y + 0.018, along(ty) - tile * 0.12, tile * 0.42, tile * 0.42, '#ffffff', { part, rx: -Math.PI / 2 });
        }
        // Planks: three strips to a tile row, each broken into boards about three tiles long, the joints staggered from strip to strip.
        for (let k = 0; k < 3; k++) {
          let start = -1;
          for (let tx = 0; tx <= plot.w; tx++) {
            const live = tx < plot.w && bare(tx, ty) && kindAt(tx, ty) === 'wood', joint = live && (tx + ty * 2 + k) % 3 === 0 && tx > start;
            if (start >= 0 && (!live || joint)) {
              const n = noise(start, ty, k), c = mix(wood, n % 2 ? '#ffffff' : '#000000', (n >>> 5) % 4 * 0.025);
              b.quad(edge((start + tx) / 2), y + 0.016, edge(ty) + (k + 0.5) * tile / 3, (tx - start) * tile - 0.03, tile / 3 - 0.025, c, { part, rx: -Math.PI / 2 });
              start = -1;
            }
            if (live && start < 0) start = tx;
          }
        }
      }
      // Thresholds: a brass strip along the open edges of the kitchen and sleeping corners (flat, walked over).
      if (zones) for (const [zx, zy, zw, zh] of [zones.kitchen, zones.bed]) {
        b.box(edge(zx + zw / 2), y + 0.02, edge(zy > 0 ? zy : zy + zh), zw * tile, 0.012, 0.04, '#b08d4a', { part });
        b.box(edge(zx > 0 ? zx : zx + zw), y + 0.02, edge(zy + zh / 2), 0.04, 0.012, zh * tile, '#b08d4a', { part });
      }
      for (const wall of wallsOf(plan, floor)) {
        run(b, wall, y, INNER, 0.12, walls.left, part);
        run(b, wall, y + INNER, 0.04, 0.16, TRIM, part, 0.04);
      }
      for (const flight of plan.stairs) if (flight.floor === floor) stairsOf(b, flight);
      const back = partOf(floor, 'back'), left = partOf(floor, 'left');
      b.box(x0 + W / 2 - 0.125, y + high / 2, z0 - 0.125, W + 0.25, high, 0.25, walls.back, { part: back });
      const doorWidth = Math.min(tile * 0.86, 1.5), doorZ = along(doorSlot(grid));
      const unit = tile * AVATAR_SCALE * 2.45 / 1.81;
      const vertical = body?.scale ?? unit, lateral = body?.scaleX ?? unit;
      const doorHeight = Math.min(WALL_HEIGHT - 0.08, Math.max(2.3, 1.81 * vertical + 0.45));
      if (floor === 0) {
        const a = doorZ - doorWidth / 2, c = doorZ + doorWidth / 2;
        b.box(x0 - 0.125, high / 2, (z0 + a) / 2, 0.25, high, a - z0, walls.left, { part: left });
        b.box(x0 - 0.125, high / 2, (c + z0 + D) / 2, 0.25, high, z0 + D - c, walls.left, { part: left });
        b.box(x0 - 0.125, (high + doorHeight) / 2, doorZ, 0.25, high - doorHeight, doorWidth, walls.left, { part: left });
        hinge = createHingedHomeDoor(kit, { x: x0, z: doorZ, width: doorWidth, height: doorHeight,
          handleHeight: 0.03 + (0.045 + 0.92) * vertical, handleOffset: 0.1 * lateral });
        hinge.object.userData.part = left;
        room.add(hinge.object);
      } else b.box(x0 - 0.125, y + high / 2, z0 + D / 2, 0.25, high, D, walls.left, { part: left });
      // Both outer walls inside: a darker dado with its rail, skirting with a cap, crown moulding, and a soft dark strip on the floor where wall meets floor.
      const dado = mix(walls.back, '#3a2a1c', 0.14), dadoLeft = mix(walls.left, '#3a2a1c', 0.14), shade = mix(palette.floor[1], '#2a1c10', 0.16), cap = mix(paint, '#000000', 0.12);
      const reach: [number, number][] = floor === 0 ? [[z0, doorZ - doorWidth / 2], [doorZ + doorWidth / 2, z0 + D]] : [[z0, z0 + D]];
      b.quad(x0 + W / 2, y + 0.021, z0 + 0.16, W, 0.3, shade, { part: back, rx: -Math.PI / 2 });
      b.box(x0 + W / 2, y + 0.11, z0 + 0.03, W, 0.22, 0.06, paint, { part: back }); b.box(x0 + W / 2, y + 0.235, z0 + 0.04, W, 0.03, 0.08, cap, { part: back });
      if (!open) {
        b.box(x0 + W / 2, y + 0.55, z0 + 0.012, W, 0.6, 0.024, dado, { part: back }); b.box(x0 + W / 2, y + 0.9, z0 + 0.025, W, 0.05, 0.05, paint, { part: back });
        b.box(x0 + W / 2, y + high - 0.07, z0 + 0.05, W, 0.14, 0.1, paint, { part: back }); b.box(x0 + W / 2, y + high - 0.17, z0 + 0.03, W, 0.04, 0.06, cap, { part: back });
      }
      if (!open) {
        // A split AC on the middle of the left wall (white case, vent slit, a standby light), and a lit cove under the crown: POP ceilings have both.
        const acZ = z0 + D * 0.5;
        b.box(x0 + 0.12, y + 2.62, acZ, 0.22, 0.34, 1.05, '#f1f1ec', { part: left }); b.box(x0 + 0.16, y + 2.52, acZ, 0.16, 0.05, 0.9, '#c9cdca', { part: left });
        b.box(x0 + 0.24, y + 2.7, acZ + 0.4, 0.014, 0.03, 0.05, '#35d07f', { part: left, layer: 'glow' });
        b.box(x0 + W / 2, y + high - 0.2, z0 + 0.04, W, 0.025, 0.05, '#f0cf8e', { part: back, layer: 'glow' });
        for (const [s0, s1] of reach) b.box(x0 + 0.04, y + high - 0.2, (s0 + s1) / 2, 0.05, 0.025, s1 - s0, '#f0cf8e', { part: left, layer: 'glow' });
      }
      if (!open) {
        // Long walls get a cluster of family photos every few metres, in the band above the wall items (which hang about the middle), clear of the window, clock, bulb and door.
        const windowX = along(windowSlot(grid)), lampX = windowX > 0 ? -ROOM * 0.3 : ROOM * 0.3, frames = ['#d7b58a', '#9bbad4', '#c98f7a', '#a9c49a', '#e0c36a'];
        const cluster = (at: number, wall: 'back' | 'left', n: number) => {
          const pick = (k: number) => frames[(noise(n, k, 9) >>> 3) % frames.length]!;
          const place = (u: number, v: number, w: number, h: number, k: number) => {
            const tall = y + 2.78 + v, fw = wall === 'back' ? [w, h, 0.035] as const : [0.035, h, w] as const, pos = (d: number): [number, number] => wall === 'back' ? [at + u, z0 + d] : [x0 + d, at + u];
            const [fx, fz] = pos(0.025), [mx, mz] = pos(0.038);
            b.box(fx, tall, fz, fw[0], fw[1], fw[2], WOOD, { part: wall === 'back' ? back : left });
            b.box(mx, tall, mz, wall === 'back' ? w - 0.07 : 0.012, h - 0.07, wall === 'back' ? 0.012 : w - 0.07, pick(k), { part: wall === 'back' ? back : left });
          };
          place(-0.2, 0.04, 0.34, 0.26, 0); place(0.1, -0.02, 0.22, 0.3, 1); if (n % 2) place(0.34, 0.06, 0.2, 0.16, 2);
        };
        for (let at = x0 + 1.7, n = 0; at < x0 + W - 1.2; at += 3.1, n++) if (Math.abs(at - windowX) > 1.5 && Math.abs(at - lampX) > 0.7) cluster(at, 'back', n + floor * 7);
        for (let at = z0 + 1.7, n = 0; at < z0 + D - 1.2; at += 3.1, n++) if ((floor > 0 || Math.abs(at - doorZ) > 1.3) && Math.abs(at - (z0 + D * 0.5)) > 1.3) cluster(at, 'left', n + 3 + floor * 7);
      }
      for (const [s0, s1] of reach) {
        const mid = (s0 + s1) / 2, length = s1 - s0;
        b.quad(x0 + 0.16, y + 0.021, mid, 0.3, length, shade, { part: left, rx: -Math.PI / 2 });
        b.box(x0 + 0.03, y + 0.11, mid, 0.06, 0.22, length, paint, { part: left }); b.box(x0 + 0.04, y + 0.235, mid, 0.08, 0.03, length, cap, { part: left });
        if (open) continue;
        b.box(x0 + 0.012, y + 0.55, mid, 0.024, 0.6, length, dadoLeft, { part: left }); b.box(x0 + 0.025, y + 0.9, mid, 0.05, 0.05, length, paint, { part: left });
        b.box(x0 + 0.05, y + high - 0.07, mid, 0.1, 0.14, length, paint, { part: left }); b.box(x0 + 0.03, y + high - 0.17, mid, 0.06, 0.04, length, cap, { part: left });
      }
      if (floor === 0) {
        // The door's casing: posts and a head round the opening (flat to the wall, so the swinging door clears it), and a mat inside.
        const a = doorZ - doorWidth / 2, c = doorZ + doorWidth / 2;
        for (const edgeZ of [a - 0.07, c + 0.07]) b.box(x0 + 0.02, doorHeight / 2, edgeZ, 0.04, doorHeight, 0.14, paint, { part: left });
        b.box(x0 + 0.02, doorHeight + 0.06, doorZ, 0.04, 0.12, doorWidth + 0.28, paint, { part: left });
        b.box(x0 + 0.55, 0.03, doorZ, 0.8, 0.02, doorWidth * 0.9, '#5a4636', { part }); b.box(x0 + 0.55, 0.042, doorZ, 0.62, 0.012, doorWidth * 0.7, '#8a6a4a', { part });
      }
      if (floor > 0) {
        // Upstairs, the open sides get a parapet (the roof terrace) or a rail: nobody steps off the edge.
        const tall = open ? 1 : 0.06, at = open ? 0.5 : 0.9;
        b.box(x0 + W / 2, y + at, z0 + D, W, tall, 0.1, open ? walls.back : RAIL, { part });
        b.box(x0 + W, y + at, z0 + D / 2, 0.1, tall, D, open ? walls.left : RAIL, { part });
      }
      // A window on the back wall of every room-floor, the door on the ground floor's side wall: the slots the placement rules keep clear.
      if (!open) windowAt(b, along(windowSlot(grid)), y, back);
    }
    for (const mesh of b.build(sceneMaterials(kit)).meshes) { mesh.name = `home-room-${mesh.name}`; room.add(mesh); roomMeshes.push(mesh); }
    applyParts();
  }

  // ---- the canonical skinned body -------------------------------------------------------------
  /** Construct the shared skinned body after canonical preload, before the room is shown. */
  function startBody() {
    if (body || gone) return;
    const look = who.look ?? lastState?.onboarding?.look ?? null, seed = who.seed;
    body = createBody(kit, look, seed, tile * AVATAR_SCALE);
    buildRoom();
    people.add(body.object);
    avatar.visible = false;
    poseBody(shownPose, false);
    syncPresentation();
  }
  /** Release the old body before constructing a different body shape or disposing the room. */
  function dropBody() {
    body?.dispose();
    body = null;
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
  /** Place the body on its furniture during a home activity, or at its walking position. */
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
  /** A contact shadow: a darker patch of floor under a piece (opaque, so it costs nothing extra), a little wider than its footprint. `lifted` clears a rug. */
  function shade(b: Batch, part: string, def: FurnitureDefinition, lifted: boolean) {
    const tone = mix(palette.floor[1], '#1d140c', 0.4), at = lifted ? 0.075 : 0.012;
    if (ROUND_SHAPES.has(def.shape)) b.disc(0, at, 0, def.shape === 'floorlamp' || def.shape === 'mic' ? 0.24 : 0.4, tone, { part, seg: 14 });
    else b.quad(0, at, 0, def.w * 1.04, def.h * 1.04, tone, { part, rx: -Math.PI / 2 });
  }
  function model(b: Batch, def: FurnitureDefinition, x: number, y: number, rot: number, floor: number, lifted = false) {
    const at = mountOf(def, x, y, rot, floor);
    b.at(at.x, at.y, at.z, at.ry, () => {
      if (!def.wall && !FLAT_SHAPES.has(def.shape)) shade(b, at.part, def, lifted);
      (SHAPES[def.shape] || SHAPES.fallback)(batchTools(b, at.part), def.wall ? 1 : def.w, def.wall ? 1 : def.h, def.color, def);
    }, 0, 0, at.scale);
  }
  /** Build a batch into meshes of `parent` (released with the furniture). */
  function keep(b: Batch, parent: THREE.Object3D, meshes = furnitureMeshes) {
    for (const mesh of b.build(sceneMaterials(kit)).meshes) { mesh.name = `home-furniture-${mesh.name}`; parent.add(mesh); meshes.push(mesh); }
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

  const mementosOf = (state: LifeState | null): readonly HomeMemento[] => visit ? (visit.mementos ?? []).slice(0, 8) : homeMementos(state);
  function displayedAchievement(state: LifeState | null) {
    const id = visit ? visit.achievement : state?.achievements?.displayed;
    return id && (visit || state?.achievements?.earned[id]) ? ACHIEVEMENTS.find(row => row.id === id) : undefined;
  }

  function rebuild(state: LifeState | null) {
    const house = visit ?? homeOf(state, HOUSE_DESIGNS, state ? housesFor(state.estate.city) : undefined);
    const colours = visitPalette ?? (state && cachedCityContent(state.estate.city)?.homePalette) ?? ROOM_PALETTE;
    const key = 'id' in house ? `${house.id}|${house.label}` : 'visit';
    if (house.grid !== grid || house.owned !== owned || colours !== palette || key !== homeKey) {
      homeKey = key; grid = house.grid; owned = house.owned; tile = ROOM / grid; palette = colours;
      plot = plotOf(grid, owned); plan = planOf(plot);
      level = Math.min(level, plot.floors - 1); shownFloor = viewFloor();
      buildRoom();
    }
    releaseObjects(itemMeshes); releaseObjects(furnitureMeshes); furniture.clear(); overlay.clear();
    const items = itemsOf(state);
    const b = createBatch(THREE), native = createBatch(THREE);
    let placed = 0;
    // Pieces standing on a rug get their shadow on top of it.
    const rugs = items.flatMap((item) => { const def = FURNITURE[item?.itemId]; return def?.shape === 'rug' ? [{ floor: floorOf(item), rect: rectOf(def, item) }] : []; });
    for (const item of items) {
      const def = FURNITURE[item?.itemId], floor = floorOf(item);
      if (!def || floor >= plot.floors) continue;
      const rest = (def.shape === 'rug' || def.shape === 'mat') ? null : mountOf(def, item.x, item.y, item.rot, floor);
      const layer = visualLayer === 'housing' && (def.wall || def.kind === 'tv') ? native : b;
      model(layer, def, item.x, item.y, item.rot, floor, Boolean(rest && !def.wall && rugs.some((rug) => rug.floor === floor && rest.x >= rug.rect[0] && rest.x <= rug.rect[2] && rest.z >= rug.rect[1] && rest.z <= rug.rect[3])));
      placed += 1;
      // Outside Buy mode the marker follows the spot: it clears when the player moves to another one.
      const spot = KINDS[def.kind]?.spot;
      if (!visit && item.id === ui.selected && (ui.buy || !spot || spot === state?.spot)) marker(def, item.x, item.y, item.rot, floor, '#ffd24a', 0.035);
    }
    if (visualLayer === 'housing') { keep(b, furniture, itemMeshes); keep(native, furniture); }
    const keepsakes = visualLayer === 'housing' ? createBatch(THREE) : b, achievement = displayedAchievement(state);
    if (achievement) {
      const part = partOf(0, 'back'), x = -ROOM * 0.36, y = 2.65, z = -ROOM / 2 + 0.12;
      keepsakes.box(x, y, z, 1.02, 0.82, 0.10, '#b48937', { part });
      keepsakes.box(x, y, z + 0.06, 0.9, 0.7, 0.04, '#204b46', { part });
      keepsakes.box(x, y + 0.06, z + 0.1, 0.3, 0.3, 0.06, '#f2d17a', { part, rz: Math.PI / 4 });
      const count = ACHIEVEMENTS.findIndex(row => row.id === achievement.id) + 1;
      for (let i = 0; i < count; i++) keepsakes.box(x + (i - (count - 1) / 2) * 0.1, y - 0.23, z + 0.1, 0.05, 0.05, 0.03, '#f2d17a', { part });
    }
    for (const [index] of mementosOf(state).entries()) {
      const part = partOf(0, 'back'), x = -ROOM * 0.36 + (index % 4) * 0.72, y = 1.75 - Math.floor(index / 4) * 0.7, z = -ROOM / 2 + 0.12;
      keepsakes.box(x, y, z, 0.58, 0.48, 0.08, '#925f37', { part });
      keepsakes.box(x, y, z + 0.06, 0.46, 0.36, 0.04, index % 2 ? '#8b374c' : '#315c9b', { part });
      keepsakes.box(x, y + 0.02, z + 0.1, 0.15, 0.15, 0.03, '#f2d17a', { part, rz: Math.PI / 4 });
    }
    if (visualLayer === 'housing') keep(keepsakes, furniture);
    else keep(b, furniture);
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

  const signature = (state: LifeState | null) => visit ? JSON.stringify(visit) : JSON.stringify([state?.property?.house, state?.estate?.living, state?.estate?.tier, itemsOf(state), state?.spot, displayedAchievement(state)?.id, mementosOf(state), ui]);

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
  function show(pose: Pose) {
    const changed = pose !== shownPose;
    shownPose = pose;
    placeFigure();
    return changed;
  }
  function placeFigure() {
    const at = shownPose === 'work' || shownPose === 'sit' ? seatAt?.at : undefined;
    if (at) {
      avatar.position.set(at.x, at.kind === 'seat' ? at.top - 0.6 * tile * AVATAR_SCALE : at.y, at.z);
      avatar.rotation.y = at.ry;
    } else { avatar.position.set(floorAt.x, floorAt.y, floorAt.z); avatar.rotation.y = floorAt.ry; }
    markAvatar();
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
    const head = body?.object.getObjectByName('head');
    if (head && body) {
      body.object.updateWorldMatrix(true, true);
      head.getWorldPosition(headAt); group.worldToLocal(headAt); headAt.y += 0.32 * body.scale;
    } else headAt.set(avatar.position.x, avatar.position.y + 2.95 * tile * AVATAR_SCALE, avatar.position.z);
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
  function projectedPath(floor: number, ax: number, az: number, bx: number, bz: number): WalkPoint[] | null {
    const grid = navigationProjection?.(grids[floor]!, floor) ?? grids[floor]!;
    const path = grid.path(ax, az, bx, bz);
    if (!navigationProjection) return path;
    // WalkGrid deliberately returns a partial approach to an unreachable goal.
    // A scripted stair/action route must never turn that partial path into a hop.
    const goal = grid.nearest(bx, bz), end = path?.at(-1) ?? grid.nearest(ax, az);
    return path && goal && end && Math.hypot(end.x - goal.x, end.z - goal.z) < 0.01 ? path : null;
  }

  /** The way to a place on another floor: over this floor to the stairs, up or down them, and across the floor there. */
  function route(to: number, x: number, z: number): { approach: WalkPoint; steps: WalkPoint[] } | null {
    let blocked = false;
    const points = grids.length > Math.max(to, level) && routeOf<WalkPoint>(plan, level, to, { x, z }, (tx, ty) => ({ x: edge(tx), z: edge(ty) }), (floor, a, b) => {
      const path = projectedPath(floor, a.x, a.z, b.x, b.z);
      if (navigationProjection && !path) blocked = true;
      return path;
    });
    return points && !blocked ? { approach: points[0]!, steps: points.slice(1) } : null;
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
    const own = who.look ?? state?.onboarding?.look ?? null, worn = party ? asoEbiLook(normalizeLook(own, who.seed), party.hex) : own;
    const dress = JSON.stringify([tile, own, who.seed, party?.hex ?? null]);
    if (dress !== dressKey) {
      dressKey = dress; if (driven) { show(shownPose); moveAvatar(floorAt.x, floorAt.y, floorAt.z, floorAt.ry); } changed = true;
      if (body) { if (body.wear(worn, who.seed)) { body.fit(tile * AVATAR_SCALE); buildRoom(); } else { dropBody(); startBody(); } }
    }
    restFloor = mine.floor;
    const seat = seatFor(state, mine);
    if (JSON.stringify(seat) !== JSON.stringify(seatAt)) { seatAt = seat; changed = true; }
    const at = seat?.at, offset = at?.kind === 'seat' ? tile * 0.85 : 0;
    const approach = at && grids[mine.floor]?.nearest(at.x + Math.sin(at.ry) * offset, at.z + Math.cos(at.ry) * offset, Math.ceil(tile * 2 / 0.25));
    const x = approach?.x ?? along(mine.x), z = approach?.z ?? along(mine.y);
    const way = route(mine.floor, x, z), approachTarget = way?.approach ?? { x, z };
    const reachable = !navigationProjection || !driven || Boolean((mine.floor === level || way) && projectedPath(level, floorAt.x, floorAt.z, approachTarget.x, approachTarget.z));
    restAt = reachable
      ? { spot: visit ? null : state?.spot ?? null, x, y: lift(mine.floor) + 0.03, z, ry: at?.ry ?? mine.ry, pose, busy: Boolean(active) && !leaving && !who.pose, leaving, fixed: Boolean(who.pose), ...way }
      : { spot: null, x: floorAt.x, y: floorAt.y, z: floorAt.z, ry: floorAt.ry, pose: 'stand', busy: Boolean(active), leaving: false, fixed: false };
    if (!reachable) { show('stand'); poseBody('stand', false); }
    const object: ObjectAction | null = reachable && at && seat?.id && (seat.pose === 'sit' || seat.pose === 'lie' || seat.pose === 'bucket' || seat.pose === 'cook' || seat.pose === 'cookLow' || seat.pose === 'eat' || seat.pose === 'drink' || seat.pose === 'wash' || seat.pose === 'soak') && active?.kind === 'activity' && !who.pose
      ? { id: [seat.id, active.id, active.duration, active.choice ?? ''].join('|'), pose: seat.pose, floor: mine.floor,
        approach: { x, y: restAt.y, z, ry: restAt.ry }, use: at, exit: { x, y: restAt.y, z, ry: restAt.ry }, ...(seat.table ? { table: seat.table } : {}), ...(seat.surface ? { surface: seat.surface } : {}) } : null;
    sequence.sync(object);
    const rest = JSON.stringify([grid, plot.w, mine, pose, who.name]);
    if (rest !== restKey) {
      restKey = rest; changed = true;
      if (selfTag) { selfTag.name = who.name; selfTag.text = who.name; }
    }
    if (changed && !driven) { level = restFloor; show(pose); moveAvatar(restAt.x, restAt.y, restAt.z, restAt.ry); poseBody(pose, false); }
    const guestsNow = JSON.stringify([grid, plot.w, mine, guests, party?.hex ?? null]);
    if (guestsNow === guestKey) return changed;
    guestKey = guestsNow;
    guestBatch?.dispose(); guestBatch = null;
    if (mine.floor === 0) taken.add(`0:${mine.x},${mine.y}`);
    const scale = tile * AVATAR_SCALE;
    guestTags = [];
    // Guests wait on the free tiles nearest the door.
    const spare = nearestFree(plan, 0, 0, doorSlot(grid), taken);
    const placed = guests.slice(0, Math.min(MAX_GUESTS_SHOWN, spare.length)).map((guest, index) => ({ id: String(guest.id ?? `guest-${index}`), name: String(guest.name ?? ''), kind: guest.kind === 'npc' ? 'npc' as const : 'player' as const, look: guest.look, seed: guest.seed ?? guest.id, x: along(spare[index]!.x), y: 0.03, z: along(spare[index]!.y), ry: Math.PI / 2, scale, ...(party ? { dress: party.hex } : {}) }));
    guestBatch = buildCanonicalCrowd(kit, placed);
    people.add(guestBatch.group);
    const pendingGuests = guestBatch;
    const syncGuestTags = () => {
      if (guestBatch !== pendingGuests) return;
      guestTags = pendingGuests.tags.map((tag) => ({ ...tag, colour: tag.colour ?? '#6fb4ff' }));
      kit.requestRender?.();
    };
    void Promise.resolve(pendingGuests.group.userData.ready).then(syncGuestTags, () => {});
    return true;
  }

  /** Rebuild if anything visible changed. Returns true when it did. */
  function refresh(state: LifeState | null) {
    const next = signature(state);
    if (next === drawn) return false;
    drawn = next;
    try { const placed = rebuild(state); announce(placed ? 'ready' : 'empty', placed); }
    catch (error) { console.error('Home scene failed to build:', error); releaseObjects(itemMeshes); releaseObjects(furnitureMeshes); furniture.clear(); overlay.clear(); announce('error', 0); }
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
    const targets = furniture.children.filter((child) => child.visible);
    // Housing replaces the drawn item models, but the canonical meshes remain the
    // exact interaction proxies for saved furniture and its server-owned actions.
    if (visualLayer === 'housing') for (const mesh of itemMeshes) if (partShown(mesh.userData.part)) targets.push(mesh);
    const touched = raycaster.intersectObjects(targets, false)[0];
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
    if (detail.retry) { drawn = ''; status = ''; }
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
  startBody();

  return {
    group,
    get homeDoor() {
      const x = along(0), z = along(doorSlot(grid)), way = route(0, x, z), first = way?.approach ?? { x, z };
      const blocked = navigationProjection && ((level > 0 && !way) || !projectedPath(level, floorAt.x, floorAt.z, first.x, first.z));
      return { x, y: 0.03, z, ry: -Math.PI / 2, direction: 'outside' as const, ...(blocked ? { blocked: true } : {}), ...way };
    },
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
      const weatherChanged = syncWeather(state);
      const room = refresh(state);
      const changed = refreshPeople(state) || room || first || undrawn || timeChanged || weatherChanged;
      undrawn = false;
      return changed;
    },
    /** The weather's window of frames (the host's ambient hooks): the home has no people of its own to walk, so this is the rain alone. */
    setAmbient() { return false; },
    stepAmbient(dt: number) { return weatherFx?.step(dt) ?? false; },
    wakeAmbient() { return weatherFx?.wake() ?? false; },
    settleAmbient() { weatherFx?.settle(); },
    get ambientAwake() { return weatherFx?.awake ?? false; },
    set onAmbient(fn: ((ready: boolean) => void) | null) { onAmbient = fn; },
    /** The player's avatar: { look, seed, name, pose? }. Returns true when it changed what is drawn. */
    setPlayer({ look, seed, name, pose }: HomePlayer = {}) {
      if (pose != null) cancelDoor();
      who = { look, seed: seed ?? 'you', name: String(name ?? 'You'), pose: (pose as Pose | null | undefined) || null };
      return refreshPeople(lastState);
    },
    /**
     * An owambe in this home (src/festivals/party.ts), or null: the jollof table on the free tile nearest the middle of the ground floor,
     * everyone in the party's aso-ebi, and notes flying whenever `sprays` goes up. Returns true when the picture changed.
     */
    setParty(next: PartyDressing | null) {
      const before = party?.hex ?? null;
      party = next && /^#[0-9a-f]{6}$/i.test(next.hex) ? { hex: next.hex, sprays: Math.max(0, Math.floor(next.sprays) || 0) } : null;
      const spot = nearestFree(plan, 0, (plot.w - 1) / 2, (plot.d - 1) / 2, freeTiles(itemsOf(lastState)))[0] ?? { x: 0, y: 0 };
      const shown = owambe.set(party, { x: along(spot.x), z: along(spot.y) }, tile * 0.8);
      const dressed = before !== (party?.hex ?? null) && refreshPeople(lastState);
      return shown || dressed;
    },
    /** Guests the host let in, standing by the door: [{ id, name, look?, seed? }]. */
    setCrowd(list: unknown) {
      guests = (Array.isArray(list) ? list as Record<string, unknown>[] : []).filter((person) => person && typeof person === 'object').slice(0, MAX_GUESTS_SHOWN)
        .map((person) => ({ id: person.id, name: person.name, kind: person.kind, look: person.look ?? null, seed: person.seed ?? person.id }));
      refreshPeople(lastState);
      return guestTags;
    },
    tags: () => {
      const door = { id: 'home-door', name: 'Step outside', kind: 'home-door', text: 'Step outside', marker: 'tag', position: { x: along(0), y: 1.5, z: along(doorSlot(grid)) } };
      const achievement = displayedAchievement(lastState);
      const plaque = achievement && !hiddenWalls.back && viewFloor() === 0 ? [{ id: `achievement-${achievement.id}`, name: achievement.title, kind: 'achievement', text: achievement.title, marker: 'tag', colour: '#f2d17a', position: { x: SHIFT - ROOM * 0.36, y: 3.17, z: SHIFT - ROOM / 2 + 0.2 } }] : [];
      const mementos = !hiddenWalls.back && viewFloor() === 0 ? mementosOf(lastState) : [];
      const keepsakes = mementos.length ? [{ id: 'home-mementos', name: mementos.map(row => row.title).join(' · '), kind: 'achievement', text: `${mementos.length} lasting memento${mementos.length === 1 ? '' : 's'}`, marker: 'tag', colour: '#f2d17a', position: { x: SHIFT - ROOM * 0.3, y: 1, z: SHIFT - ROOM / 2 + 0.2 } }] : [];
      return buying() ? (selfTag ? [selfTag, ...guestTags] : [...guestTags]) : [door, ...plaque, ...keepsakes, ...(selfTag ? [selfTag, ...guestTags] : guestTags)];
    },
    look,
    // The skinned body's sit-down (always false without the body): the host steps it in its motion loop.
    get easing() { return Boolean(body?.easing || sequence.easing || doorDone || owambe.flying); },
    beginDoor(done: () => void) {
      if (!hinge) { done(); return; }
      doorDone = done; doorVisual = true; doorRelease.x = floorAt.x; doorRelease.z = floorAt.z; hinge.begin(() => {}, 2.4);
      if (body) body.show('homeDoor', false); else show('work');
      placeBody(); markAvatar();
    },
    get objectPhase() { return sequence.phase; },
    get playerPose() {
      if (sequence.phase === 'approach' || sequence.phase === 'align') return 'stand';
      return sequence.presented?.pose;
    },
    get bodyShown() { return body !== null; },
    cycleDistance(jog:boolean){return body?.cycleDistance(jog);},
    stepCharacter(dt:number){return body?.easing||sequence.easing||doorDone?false:body?.step(dt)??false;},
    stepCrowd(dt: number) {
      const more = Boolean(body?.step(dt)), using = sequence.step(dt), door = hinge?.step(dt) ?? false, notes = owambe.step(dt);
      if (body?.contactSolvable && !sequence.presented && !doorDone) body.solveFeet(contact => contactHeightAt(contact.x, contact.z, contact.y));
      if (doorDone && body) body.sampleUse('homeDoor', Math.min(2.399, (hinge?.progress ?? 0) * 2.4));
      if (!more) placeBody();
      const action = sequence.presented; if (action) useProps.update(action, body); else useProps.hide();
      syncPresentation();
      markAvatar(); finishDoor(); return more || using || door || notes || Boolean(doorDone);
    },
    settleCrowd() {
      while (owambe.step(0.1)) { /* the notes land at once (reduced motion) */ }
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
    /** Project route queries through a scene-owned barrier layer; default is the canonical floor grid. */
    setNavigationProjection(project: ((base: WalkGrid, floor: number) => WalkGrid) | null) {
      if (navigationProjection === project) return false;
      navigationProjection = project;
      if (lastState) refreshPeople(lastState);
      return true;
    },
    /** Switch only the procedural shell and replaceable furniture. The plinth, door, UI overlays, wall pieces, TVs and keepsakes remain canonical. */
    setVisualLayer(next: 'canonical' | 'housing') {
      if (next === visualLayer) return false;
      visualLayer = next;
      if (lastState) rebuild(lastState);
      else applyParts();
      return true;
    },
    /** Worst-case canonical scenery retained by the housing layer, across all floors and wall views. */
    housingVisualCost(floor = viewFloor()) {
      const replaced = new Set<THREE.Object3D>([...roomMeshes, ...itemMeshes]);
      let triangles = 0, drawCalls = 0;
      for (const parent of [room, furniture, overlay]) parent.traverse((object) => {
        if (!(object instanceof THREE.Mesh) || replaced.has(object)) return;
        const part = object.userData.part;
        if (typeof part === 'string' && Number(part.slice(1).split('-')[0]) !== floor) return;
        const count = object.geometry.index?.count ?? object.geometry.getAttribute('position')?.count ?? 0;
        triangles += count / 3;
        drawCalls += 1;
      });
      return { triangles, drawCalls };
    },
    screens() {
      return itemsOf(lastState).flatMap(item => {
        const def = FURNITURE[item.itemId];
        if (def?.kind !== 'tv') return [];
        const at = mountOf(def, item.x, item.y, item.rot, floorOf(item)), depth = 0.047 * at.scale;
        return [{ id: item.id, x: at.x + Math.sin(at.ry) * depth, y: at.y + (0.5 + def.w * 0.26) * at.scale,
          z: at.z + Math.cos(at.ry) * depth, ry: at.ry, width: def.w * 0.62 * at.scale, height: def.w * 0.34 * at.scale }];
      });
    },
    get playerBody() { return body?.object ?? null; },
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
      gait(step: boolean, phase = 0, jog = false, animate = false) {
        if (doorVisual) cancelDoor();
        if (sequence.easing || sequence.phase === 'rest') { sequence.interrupt(); useProps.hide(); }
        if (body) {
          const run = Math.hypot(floorAt.x - lastGait.x, floorAt.z - lastGait.z);
          let slope = run > 1e-4 ? (floorAt.y - lastGait.y) / run : 0;
          const flight = flightAt(plan, level, (floorAt.x + ROOM / 2) / tile, (floorAt.z + ROOM / 2) / tile)?.flight;
          if (flight && Math.abs(slope) < 0.3) slope = (Math.sign(floorAt.x - lastGait.x) || 1) * flight.dir * WALL_HEIGHT / (flight.w * tile);
          lastGait.x = floorAt.x; lastGait.y = floorAt.y; lastGait.z = floorAt.z;
          body.stride(phase, jog, Math.abs(slope) >= 0.3 ? slope : 0, animate); placeBody();
          if (!sequence.presented && !doorDone) body.solveFeet(contact => contactHeightAt(contact.x, contact.z, contact.y));
        }
        syncPresentation();
        show(step ? jog ? 'jog' : 'walk' : 'stand');
        markAvatar(); return true;
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
      weatherFx?.dispose(); weatherFx = null;
      doorDone = null; hinge?.dispose(); hinge = null;
      useProps.dispose();
      sequence.dispose();
      guestBatch?.dispose(); guestBatch = null;
      owambe.dispose();
      releaseObjects(markMeshes);
      releaseObjects(roomMeshes);
      releaseObjects(itemMeshes);
      releaseObjects(furnitureMeshes);
      goalMark = null;
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
