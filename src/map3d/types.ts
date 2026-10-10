/**
 * OWNER: world
 * The contracts of the map code that more than one module shares: the city pack, the region and
 * atlas registry, the compact geographic data modules, and the shapes of the /api/world/* answers.
 * Types only — nothing here exists at run time.
 */

import type { MapOrigin } from './geo/frame.ts';
import type { MapContext } from './context.ts';

// ---- Plain geometry -------------------------------------------------------------------------------------

/** [x, z] in map units (x runs east, z runs south). */
export type Point2 = readonly [number, number]
/** [x0, z0, x1, z1]: a rectangle in map units. */
export type Box4 = readonly [number, number, number, number]
export interface Point3 { x: number; y: number; z: number }
export interface XZ { x: number; z: number }
export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }
/** Longitude and latitude, in degrees. */
export interface LonLat { lon: number; lat: number }

/** The part of a geometry batch (src/scene/build.ts createBatch) that decorate() draws with. `opts` are the batch's per-primitive options. */
export interface BatchOptions { ry?: number; rx?: number; rz?: number; seg?: number; top?: number; layer?: 'solid' | 'glow' | 'glass'; part?: string }
export interface DecorateBatch {
  box: (x: number, y: number, z: number, w: number, h: number, d: number, colour: string, opts?: BatchOptions) => void
  cyl: (x: number, y: number, z: number, radius: number, height: number, colour: string, opts?: BatchOptions) => void
  cone: (x: number, y: number, z: number, radius: number, height: number, colour: string, opts?: BatchOptions) => void
  at: (x: number, y: number, z: number, ry: number, draw: () => void) => void
}

// ---- The city pack (src/map3d/cities/<id>.ts) ---------------------------------------------------------------

export type LandKind = 'mainland' | 'island' | 'estate' | 'sand'
export type FabricStyle = 'dense' | 'blocks' | 'towers' | 'villas' | 'green'

export interface PackBounds extends Rect {
  /** What "the whole city" frames: the land, not the open sea. */
  fit: Rect
  /** The open-water block the sea-plot layer uses. */
  sea: { x0: number; x1: number; z0: number; z1: number }
}
/**
 * A land mass as a control polygon; the builder rounds the corners unless `exact` is set (real
 * boundaries are drawn as given). `holes` are cut out of the land (inner rings).
 */
export interface PackLand { id: string; kind: LandKind; points: readonly Point2[]; exact?: boolean; holes?: readonly (readonly Point2[])[] }
/** A road (or bridge) centre line as control points. `bridge` is the deck height above the water. */
export interface PackRoad { id: string; name: string; major?: boolean; /** The strongest roads of the city (expressways, ring roads): drawn wider than the other main roads. */ trunk?: boolean; bridge?: number; pylon?: boolean; points: readonly Point2[] }
/** Where a venue's landmark stands. */
export interface PackSite extends XZ { }
/** Where Home stands for one house. */
export interface PackHome extends XZ { district: string }
/** A coming-soon district. */
export interface PackSoon extends XZ { zone: Box4; gate: Point2 }
/** A district name plate laid on the ground. */
export interface PackDistrict { name: string; x: number; z: number; size: number; water?: boolean }
export interface PackFabric {
  box: Box4
  style: FabricStyle
  /** Keep the area to this circle [x, z, radius] inside its box. */
  circle?: readonly [number, number, number]
  /** Roof colours of this area's houses, instead of the usual mix. */
  roofs?: readonly string[]
  /** Added to the share of the area that is built up (0 to 1). */
  keep?: number
}
/** How an area of the city reads from above: old and dense (brown roofs) or planned and leafy. A soft patch of ground colour and, with `PackFabric`, the roofs. */
export interface PackArea { name: string; x: number; z: number; r: number; tone: 'old' | 'planned' }
/** A hill as a low shaded mound under the fabric: centre, radius and height in map units. */
export interface PackHill { name: string; x: number; z: number; r: number; h: number }
/** Inland water: a lake is a closed ring, a river a line (with its width in map units). */
export interface PackWater { name: string; kind: 'lake' | 'river'; points: readonly Point2[]; width?: number }
/** A railway line with its stations. */
export interface PackRail { name: string; points: readonly Point2[]; stations: readonly { name: string; x: number; z: number }[] }
/** Where one district's player homes are drawn. */
export interface PackEstate extends XZ { cols: number; max?: number }
export interface PackLga {
  id: string
  name: string
  line: string
  land: number
  districts?: readonly string[]
  /** The largest part of the boundary (kept for callers that want one ring). */
  polygon: readonly Point2[]
  /** Every part of the boundary, each as [outer ring, ...holes]. Estates and the finder use all parts. */
  polygons?: readonly (readonly (readonly Point2[])[])[]
  plate: Point2
  tint: string
  /** `c` is [lat, lon]; `box` is [south, west, north, east]. */
  geo: { c: Point2; box: Box4 }
}
/** What a city module exports, and what the maps are drawn from. `decorate` receives a geometry batch (src/scene/build) and helpers. */
export interface CityPack {
  /** Historical context only; these lines are never roads, collision walls or navigation links. */
  heritageLines?: readonly { id: string; name: string; kind: 'historic-wall-alignment'; points: readonly Point2[] }[]
  water?: readonly { id: string; points: readonly Point2[]; holes?: readonly (readonly Point2[])[] }[]
  localRoutes?: readonly { a: string; b: string; mode: 'boat'; points: readonly Point3[] }[]
  /** Ground continues beyond this inland footprint; uncovered space is not ocean. */
  inland?: boolean
  /** The colour of the ground round an inland footprint (the countryside or desert the city sits in); the board reaches far beyond the footprint so that no edge or slab shows. */
  surround?: string
  id: string
  name: string
  bounds: PackBounds
  land: readonly PackLand[]
  roads: readonly PackRoad[]
  sites: Readonly<Record<string, PackSite>>
  homes: Readonly<Record<string, PackHome>>
  soon: Readonly<Record<string, PackSoon>>
  districts: readonly PackDistrict[]
  /** Character of parts of the city, drawn as ground colour (src/map3d/city-build.ts). */
  areas?: readonly PackArea[]
  relief?: readonly PackHill[]
  waters?: readonly PackWater[]
  rails?: readonly PackRail[]
  /** What the whole-extent view button says: 'state' when the pack covers a state with its surroundings, 'city' for a metropolitan area. */
  extent?: 'state' | 'city'
  /** Venue ids lettered before the rest where the labels crowd (the city's landmarks). */
  notable?: readonly string[]
  zones: readonly Box4[]
  fabric: readonly PackFabric[]
  estates: Readonly<Record<string, PackEstate>>
  lgas: readonly PackLga[]
  /** The rough box of the city's state [south, west, north, east]. */
  geo: { box: Box4 }
  /** The map's projection frame (src/map3d/geo/frame.ts): where local (0, 0) sits and how many units make a km. */
  frame?: { origin: MapOrigin; unitsPerKm: number }
  /** The land around a state map (src/map3d/geo/context.ts): drawn flat and quiet, not interactive. A pack that has it covers a whole state. */
  context?: MapContext
  /** The metropolitan core (where the venues are): the default camera view. */
  core?: Rect
  /** A multiplier the builder applies to road widths (default 1). */
  roadScale?: number
  decorate: (batch: DecorateBatch, tools: { rng: () => number; w?: unknown }) => void
}

// ---- The region registry (src/map3d/regions.ts) ---------------------------------------------------------

export type CityStatus = 'playable' | 'soon'
export type CityId = string
/** 'open' enterable; 'planned' greyed and announced; 'soon' greyed (the default); null context only. */
export type RegionStatus = 'open' | 'planned' | 'soon' | null
export type RegionKind = 'state' | 'country'
export type ZoneId = 'sw' | 'se' | 'ss' | 'nc' | 'nw' | 'ne'
export type AfricaGroupId = 'north' | 'west' | 'east' | 'central' | 'south'
export type ContinentId = 'af' | 'eu' | 'as' | 'na' | 'sa' | 'oc' | 'an'
export type AtlasLevelId = 'world' | 'africa' | 'nigeria'
export interface Hub { name: string; lon: number; lat: number }
export interface RegionEntry {
  status?: RegionStatus
  teaser?: string
  city?: string
  zone?: ZoneId
  level?: AtlasLevelId
  hub?: Hub
}

// ---- The compact geographic data (src/map3d/geo/data/*.ts, read by geo/topo.ts) --------------------------

/** One feature of a data module: a region with its rings as lists of arc numbers (~n is arc n backwards). */
export interface RawFeature {
  id: string
  name: string
  polys: number[][][]
  [extra: string]: unknown
}
export interface RawTopology { grid: number; arcs: string; features: RawFeature[] }
