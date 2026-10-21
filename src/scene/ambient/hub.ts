/**
 * OWNER: scenes
 * What a venue scene gives the ambient layer, and what it takes back: the glue between venue-scenes.ts and layer.ts.
 *
 * The scene says where its door is, what is free to walk on, which seats the props drew, who its regulars are and what budget is left;
 * the hub builds the Stage the planner needs from that, makes the layer when there is a config for this place and the scene is live,
 * and drops it when the scene is released. With no config (the default; the tests of every scene kind) there is no layer, nothing is
 * built, nothing moves, and the scene is exactly what it was.
 */
import type * as THREE from 'three';
import type { Kit } from '../kit.ts';
import type { FootprintShapes, WalkGrid } from '../movement.ts';
import { SCENE_CHARACTER_TRIANGLES, SCENE_DRAW_CALLS, SCENE_TRIANGLES } from '../../budgets.ts';
import type * as Layers from './layer.ts';
import type { AmbientLayer, AmbientPerson, AmbientTag, Resident } from './layer.ts';
import type { Ident, Stage } from './plan.ts';
import { restyleMarks } from '../markers.ts';

/**
 * The layer, the plan, the density curves and the figures are one lazy chunk: this file is all the scene's own chunk carries. It is fetched the
 * first time a scene is given a place to fill (after the first frame), never on a device that is told to show nobody, and kept for the session.
 */
let loaded: typeof Layers | null = null;
let loading: Promise<void> | null = null;
export function loadAmbient(): Promise<void> {
  loading ||= Promise.all([import('./layer.ts'), import('../body/skinned.ts')])
    .then(async ([module, bodies]) => {
      await Promise.all([bodies.preloadCanonicalBodies(), bodies.preloadCanonicalBodies(['male', 'female'], 'lod')]);
      loaded = module;
    })
    .catch((error: unknown) => { loading = null; throw error; });
  return loading;
}

/** What the scene keeps for the things it cannot foresee (its own crowd changing, the walking marks). */
const MARGIN_TRIANGLES = 800, MARGIN_CALLS = 4;
const POINT_GAP = 1.5;

export interface HubEnv {
  kit: Kit
  parent: THREE.Object3D
  grid(): WalkGrid | null
  shapes(): FootprintShapes | null
  entrance(): readonly [number, number] | null
  open(): boolean
  /** Is the place off every spot marker and the ground in front of one? */
  offMarkers(x: number, z: number): boolean
  heightAt(x: number, z: number): number
  avatar(): { x: number; z: number }
  /** Authored people already reserve their standing or seated positions. */
  fixed?(): readonly { x: number; z: number }[]
  /** What the scene draws now: triangles and draw calls. */
  spent(): { triangles: number; characterTriangles?: number; drawCalls: number }
  live(): boolean
  /** The ambient tags (a spoken line) changed. */
  changed(): void
  /** The chunk arrived and the layer was built after the scene had asked: draw again, with the people in. */
  ready(): void
  clock?(): number
}

export interface AmbientHub {
  /** Switch the layer on for a place, or off with null. True when it changed. */
  configure(ident: Ident | null): boolean
  /** The scene is live: build the layer if there is a config. */
  attach(): void
  /** The scene is released: drop the layer (the config stays). */
  release(): void
  setResidents(list: readonly Resident[]): string[]
  /** The scene's own crowd changed: what is left to spend is read again. */
  rebudget(): void
  residentTag(id: string, name: string): AmbientTag | null
  readonly layer: AmbientLayer | null
  readonly on: boolean
  /** What the budget allows (diagnostics). */
  caps(): { full: number; lean: number; far: number } | null
  tags(): AmbientTag[]
  people(): AmbientPerson[]
}

export function createAmbientHub(env: HubEnv): AmbientHub {
  let config: Ident | null = null, layer: AmbientLayer | null = null, residents: readonly Resident[] = []
  const fixed: { x: number; z: number }[] = []

  function stage(): Stage {
    const grid = env.grid()!, shapes = env.shapes()
    const [x0, z0, x1, z1] = grid.bounds
    const free = (x: number, z: number): boolean => grid.free(x, z) && env.offMarkers(x, z)
    const points: [number, number][] = []
    for (let z = z0 + 1; z <= z1 - 1; z += POINT_GAP) for (let x = x0 + 1; x <= x1 - 1; x += POINT_GAP) if (free(x, z)) points.push([x, z])
    const seats = (shapes?.seats ?? []).filter((seat) => seat.x > x0 - 1 && seat.x < x1 + 1 && seat.z > z0 - 1 && seat.z < z1 + 1 && env.offMarkers(seat.x, seat.z))
    return { bounds: grid.bounds, entrance: env.entrance(), open: env.open(), free, path: (ax, az, bx, bz) => grid.path(ax, az, bx, bz), seats, points, fixed }
  }

  function drop(): void { layer?.dispose(); layer = null }
  function build(): void {
    drop()
    if (!config || !env.live() || !env.grid() || config.tier === 'off') return
    if (!loaded) {
      // Not here yet: ask for it, and build when it comes (if the scene is still asking for the same place).
      const asked = config
      void loadAmbient().then(() => { if (config === asked && !layer && env.live()) { build(); if (layer) env.ready() } }, (error: unknown) => {
        console.error('Canonical ambient bodies could not load:', error);
      })
      return
    }
    fixed.length = 0
    fixed.push(...(env.fixed?.() ?? []))
    for (const resident of residents) fixed.push({ x: resident.x, z: resident.z })
    layer = loaded.createAmbientLayer({
      kit: env.kit, parent: env.parent, stage: stage(), ident: config, heightAt: env.heightAt, avatar: env.avatar, changed: env.changed, ...(env.clock ? { clock: env.clock } : {}),
      room: () => {
        const base = env.spent()
        return {
          triangles: Math.max(0, Math.min(SCENE_TRIANGLES.value - base.triangles,
            SCENE_CHARACTER_TRIANGLES.value - (base.characterTriangles ?? base.triangles)) - MARGIN_TRIANGLES),
          meshes: Math.max(0, SCENE_DRAW_CALLS.value - base.drawCalls - MARGIN_CALLS),
        }
      },
    })
    if (residents.length) layer.setResidents(residents)
  }

  return {
    configure(ident) {
      const same = (config === null && ident === null) || (config !== null && ident !== null && config.cityId === ident.cityId && config.venueId === ident.venueId && config.kind === ident.kind && config.tier === ident.tier)
      config = ident
      if (same && (layer || !ident)) return false
      build()
      return true
    },
    attach() { restyleMarks(env.kit.THREE, env.parent); build() },
    release() { drop() },
    setResidents(list) {
      residents = list
      fixed.length = 0
      fixed.push(...(env.fixed?.() ?? []))
      for (const resident of residents) fixed.push({ x: resident.x, z: resident.z })
      return layer ? layer.setResidents(list) : []
    },
    rebudget() { layer?.rebudget() },
    residentTag: (id, name) => layer?.residentTag(id, name) ?? null,
    get layer() { return layer },
    get on() { return layer !== null },
    caps: () => layer?.caps() ?? null,
    tags: () => layer?.tags() ?? [],
    people: () => layer?.people() ?? [],
  }
}
