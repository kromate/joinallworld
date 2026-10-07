// Shared contracts of the Three.js scene modules. Types only: this file imports nothing at run time,
// so it adds nothing to any chunk. Each builder module owns its own detail types; what several
// modules pass to each other lives here.
import type * as THREE from 'three'
import type { CrowdPerson as DrawnPerson } from './characters.ts'
import type { ParametricVenueDesign } from '../types/content.ts'

/** The `three` module as the scenes receive it (they are handed it, never import it themselves, so tests can run without WebGL). */
export type ThreeModule = typeof THREE

/** '#rrggbb' (or any CSS colour string three.js parses). */
export type Colour = string

/** A [x, y, z] position. */
export type Vec3 = [number, number, number]

/** The three layers of a geometry batch. */
export type BatchLayer = 'solid' | 'glow' | 'glass'
/** Options every batch primitive takes. */
export interface BatchOptions {
  ry?: number
  rx?: number
  rz?: number
  layer?: BatchLayer
  /** Bake into its own mesh per layer, named 'layer@part', with userData.part = part. */
  part?: string
  /** cyl / ball / disc */
  top?: number
  seg?: number
  open?: boolean
  sx?: number
  sz?: number
}
export interface LightSpec { x: number; y: number; z: number; colour: Colour; intensity: number; distance: number }
export interface BatchResult { meshes: THREE.Mesh[]; lights: THREE.PointLight[]; triangles: number }
export interface SceneMaterials { solid: THREE.MeshLambertMaterial | THREE.MeshStandardMaterial; glow: THREE.MeshBasicMaterial; glass: THREE.MeshStandardMaterial }

/** The geometry batcher (src/scene/build.ts). */
export interface Batch {
  isBatch: true
  box(x: number, y: number, z: number, w: number, h: number, d: number, colour: Colour, o?: BatchOptions): Batch
  cyl(x: number, y: number, z: number, r: number, h: number, colour: Colour, o?: BatchOptions): Batch
  cone(x: number, y: number, z: number, r: number, h: number, colour: Colour, o?: BatchOptions): Batch
  ball(x: number, y: number, z: number, rx: number, ry: number, rz: number, colour: Colour, o?: BatchOptions): Batch
  ico(x: number, y: number, z: number, rx: number, ry: number, rz: number, colour: Colour, o?: BatchOptions): Batch
  quad(x: number, y: number, z: number, w: number, h: number, colour: Colour, o?: BatchOptions): Batch
  disc(x: number, y: number, z: number, r: number, colour: Colour, o?: BatchOptions): Batch
  at(x: number, y: number, z: number, ry: number, draw: (b: Batch) => void, rx?: number, rz?: number, scale?: number): Batch
  light(x: number, y: number, z: number, colour: Colour, intensity?: number, distance?: number): Batch
  world(x: number, y: number, z: number): { x: number; y: number; z: number }
  readonly triangles: number
  /** Any material may back a layer (the map passes one shared material for all three). */
  build(materials: Record<keyof SceneMaterials, THREE.Material>): BatchResult
  /** Added by footprintRecorder (movement.ts): tells the recorder where the two walls are. */
  walls?(size: { w: number; d: number }): void
}

// ---- The scene entry contract (src/scene/venue-scenes.ts; the home scene returns the same shape) ----

/** Lagos time of day a scene is lit for. */
export type TimeOfDay = 'day' | 'dusk' | 'night'
/** Lighting mood of a scene. */
export type Mood = 'outdoor' | 'indoor' | 'club'
/** The numbers the host lights a scene with (LIGHTING[mood][time]). sky: [horizon, zenith]; hemi: [sky, ground, intensity]; sun: [colour, intensity, position]; rim: [colour, intensity]. */
export interface Lighting {
  sky: [Colour, Colour]
  hemi: [Colour, Colour, number]
  sun: [Colour, number, Vec3]
  rim: [Colour, number]
  glow: number
  lamps: number
}
/**
 * A camera position per orientation. `start` (default 1) scales how far the camera begins from the
 * avatar: a scene with something tall in it starts farther back so the whole of it is in view.
 */
export interface SceneCamera { landscape: Vec3; portrait: Vec3; start?: number }
/** The place and pose a spot gives an activity running there (landmark.act). */
export interface LandmarkAct { pose?: string; x?: number; y?: number; z?: number; ry?: number; seat?: number }
/** A place in a scene a venue spot can attach to (props.landmark). approach: [x, z] or a chain [[x, z], ...]. */
export interface Landmark {
  key: string
  match?: RegExp
  x: number
  y?: number
  z: number
  ry?: number
  act?: LandmarkAct
  approach?: [number, number] | [number, number][]
}
/** Where a spot is in the scene (SceneEntry.anchors, keyed by spot id and by landmark key). */
export interface Anchor {
  x: number
  y: number
  z: number
  ry: number
  landmark: string | null
  act: LandmarkAct | null
  approach: { x: number; z: number } | null
  steps: { x: number; z: number }[]
}
/** layout.raised: what can be stood on above the ground. */
export interface RaisedShape {
  rect?: [number, number, number, number]
  disc?: [number, number, number]
  ramp?: [number, number, number, number, number, number]
  y?: number
  lip?: number
  half?: number
  sag?: number
}
/** What a scene's build() returns: [x, z, ry, y?] crowd places, [x, z] spare ground. */
export interface SceneLayout {
  spots: Landmark[]
  crowd: [number, number, number?, number?][]
  spare?: [number, number][]
  raised?: RaisedShape[]
}
/** A spot as the scene receives it (a venue's spot, or one the host passes in venue.scene.spots). */
export interface SceneSpot { id: string; label?: string; anchor?: string }
/** venue.scene: how a venue asks for its scene. */
export interface SceneOptions {
  kind?: string
  variant?: string
  palette?: string
  time?: string
  spots?: SceneSpot[]
  look?: unknown
  seed?: unknown
  anchors?: Record<string, string>
  design?: ParametricVenueDesign
}
/** The venue a scene builder is given (VenueDefinition satisfies it). */
export interface SceneVenue {
  id?: string
  label?: string
  spots?: Record<string, SceneSpot>
  scene?: SceneOptions
}
/** What a scene definition's build() is given. */
export interface SceneContext {
  kind: string
  venue: SceneVenue | null | undefined
  spots: SceneSpot[]
  variant: string | null
  accent: Colour
  label: string
  /** The city the scene stands in (what its signs may name). */
  cityId: string
}
/** A scene's own walkable description, where it differs from its kind's (see WALK in venue-scenes.ts). */
export interface SceneWalkSpec {
  bounds: [number, number, number, number] | null
  entrance: [number, number] | null
  open: boolean
  block?: import('./movement.ts').WalkShape[]
  clear?: import('./movement.ts').WalkShape[]
}
/** One scene kind: `{ mood, accent?, camera?, build(b, context) }`. */
export interface SceneDef {
  mood: Mood | ((context: SceneContext) => Mood)
  accent?: Colour
  camera?: SceneCamera
  /** Replaces the walkable description of the scene's kind (a variant that is walled, or open, where its kind is not). */
  walk?: SceneWalkSpec
  build(b: Batch, context: SceneContext): SceneLayout | void
}
/** The slice of game state a scene reads in update(). */
export interface SceneState {
  t?: number
  location?: string | null
  spot?: string | null
  name?: string
  onboarding?: { look?: unknown } | null
  activeAction?: { kind?: string; id?: string } | null
}
/** setPlayer({ look, seed, pose, name }). */
export interface PlayerOptions { look?: unknown; seed?: unknown; pose?: string | null; name?: string }
/** A person of the crowd (other players and NPCs; see characters.ts). A reported x/z puts a player exactly there. */
export interface CrowdPerson extends DrawnPerson {
  /** The spot (anchor key) they stand at. */
  spot?: string | null
  /** A friend of the player (src/scene/crowd.ts): they stand and look at the player as a friend does, not as a stranger. */
  friend?: boolean
  /** Set by the scene: a player with a reported position, drawn as a figure of their own. */
  live?: boolean
}
/** Name-tag data for the DOM layer. */
export interface SceneTag {
  id: string
  name: string
  kind: string
  text: string
  marker: string
  colour?: Colour
  position: { x: number; y: number; z: number }
}
/** A person to tap or walk round: { id, kind, x, z, top }. */
export interface ScenePerson { id: string; kind: string; x: number; z: number; top: number }
/** A game table that stands in the venue (walk.things()). */
export interface SceneThing { id: string; kind: 'table'; table: string; game: string; x: number; z: number; top: number; r: number; label: string }
/** A spot with where it is (walk.spots()). */
export interface WalkSpot { id: string; label: string; x: number; y: number; z: number; ry: number; approach: { x: number; z: number } | null; steps: { x: number; z: number }[] }
/** Where the scene itself stands the avatar (walk.rest()). */
export interface SceneRest {
  spot: string | null
  x: number
  y: number
  z: number
  ry: number
  pose: string
  seat: number | undefined
  busy: boolean
  leaving: boolean
  fixed: boolean
  anchor: Anchor
  approach: { x: number; z: number } | null
  steps: { x: number; z: number }[]
}
/** The avatar's start on arrival. */
export interface SceneEntrance { x: number; y: number; z: number; ry: number }
/** What the host needs to walk the avatar about. */
export interface SceneWalk {
  readonly grid: ReturnType<typeof import('./movement.ts').createWalkGrid> | null
  readonly entrance: SceneEntrance | null
  readonly open: boolean
  scale: number
  centre: Vec3
  avatar: THREE.Group
  drive(on: boolean): void
  rest(): SceneRest
  spots(): WalkSpot[]
  things(): SceneThing[]
  people(): ScenePerson[]
  /** Boxes [x0, y0, z0, x1, y1, z1] of what can hide the avatar from the camera. */
  readonly solids: number[][]
  move(x: number, y: number, z: number, ry: number): void
  pose(name?: string, seat?: number): boolean
  gait(step: unknown, phase?: number, jog?: boolean): boolean
  heightAt(x: number, z: number): number
  near(spot: { x: number; y: number; z: number } | null | undefined): boolean
  goal(x?: number, z?: number): boolean
}
export interface SceneStats { triangles: number; meshes: number; drawCalls: number; lights: number; geometries: number }
/** What a scene builder returns (every member is optional for the host). */
export interface SceneEntry {
  group: THREE.Group
  kind: string
  mood: Mood
  walk: SceneWalk
  camera: SceneCamera
  /** Clear colour for the current time of day (re-read whenever update() returns true). */
  readonly background: Colour
  /** [horizon, zenith] for the host's graded sky. */
  readonly sky: [Colour, Colour]
  readonly anchors: Record<string, Anchor>
  readonly time: TimeOfDay
  readonly spot: string | null
  lighting(): Lighting
  setTime(time: string): boolean
  setSpot(id: string): boolean
  setPlayer(options?: PlayerOptions): boolean
  setCrowd(people: unknown): SceneTag[]
  readonly easing: boolean
  stepCrowd(dt: number): boolean
  settleCrowd(): void
  /** The camera is at (x, z): hide whichever wall it has gone behind. True when a wall was shown or hidden. */
  look(x: number, z: number): boolean
  /** Which walls are showing right now, or null for a scene without walls. */
  readonly walls: { back: boolean; left: boolean } | null
  tags(): SceneTag[]
  stats(): SceneStats
  update(state: SceneState | null | undefined): boolean
  dispose(): void
}
/** SCENES[kind]: builds the scene for a venue. */
export type SceneBuilder = (kit: import('./kit.ts').Kit, venue?: SceneVenue | null) => SceneEntry
