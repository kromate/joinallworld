import type { SceneKind, VenueCategoryId } from '../../../src/types/content.ts';
import type { DestinationPlace } from '../../../src/game/cities/africa/types.ts';
import type { Box } from './geometry-tools.ts';

/** One real place chosen from the recorded places answer. The name and point are read from the element, never typed. */
export interface PlacePick {
  /** `node/1`, `way/2` or `relation/3` in the recorded answer. */
  ref: string
  /** The generic starter venue it replaces (its id and activities are kept), or the key of an added venue. */
  slot?: NonNullable<DestinationPlace['slot']>
  key?: string
  kind: SceneKind
  category: VenueCategoryId
  icon: string
  line: string
  /** Only to shorten an English name that is longer than a map label; it must be a part of the recorded name. */
  label?: string
}

export interface NamePick { id: string; ref: string; kind: 'neighbourhood' | 'water'; label?: string }

/** Everything that differs between destinations in scripts/geo/build-destination-detail.ts. */
export interface DetailConfig {
  name: string
  /** South, west, north, east of the play area. */
  box: Box
  /** The dense core, where roads keep more detail. */
  core: Box
  /** Overpass queries; `bbox` is "south,west,north,east". */
  /** One query per cache label; each answer is recorded by its sha256. */
  discovery: (bbox: string) => Record<string, string>
  /** Land-use areas whose centres mark the built-up extent. */
  landuse: (bbox: string) => string
  /** Grid cell in degrees, how many cells to grow each land-use point, and the smallest hole (in cells) left unfilled. */
  cell: number
  grow: number
  /** Fine cells per coarse cell, and how many fine cells the land keeps back from the water. */
  split: number
  shore: number
  minHole: number
  /** The shortest a non-major road may be, in kilometres, and the most roads kept (longest first). */
  minRoadKm: number
  maxRoads: number
  water: (bbox: string) => string
  /** Set when the water answer holds shore ways of the sea (`coast`: coastline, land on the left) or of a big lake (`lake`: the member ways of its relation): the water is drawn this far out from the shore, in metres. */
  sea?: { kind: 'coast' | 'lake'; bandMetres: number }
  roads: (bbox: string, core: string) => string
  boundaryNote: string
  terrainNote: string
  source: string
  outlineTolerance: number
  waterTolerance: number
  farTolerance: number
  coreTolerance: number
  places: readonly PlacePick[]
  names: readonly NamePick[]
}
