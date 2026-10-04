// Shared contracts of the Three.js scene modules. Types only: this file imports nothing at run time,
// so it adds nothing to any chunk. Each builder module owns its own detail types; what several
// modules pass to each other lives here.
import type * as THREE from 'three'

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
  build(materials: SceneMaterials): BatchResult
  /** Added by footprintRecorder (movement.ts): tells the recorder where the two walls are. */
  walls?(size: { w: number; d: number }): void
}
