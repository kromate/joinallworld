/**
 * OWNER: world
 * Builds a city pack (src/map3d/cities/*.js) into a Three.js group: the board, the water, the
 * land, roads and bridges, one landmark per venue, the coming-soon building sites, district
 * plates, and the fabric that makes it a city — houses, blocks, towers, trees, palms, boats and
 * street traffic.
 *
 * BUDGET (asserted in src/map3d/map3d.test.ts): everything static is merged into a few meshes and
 * everything repeated is instanced, so the whole city is a few dozen draw calls and stays under
 * CITY_TRIANGLE_BUDGET. Nothing here needs a WebGL context: it is typed-array work and runs under
 * `node --test`. There are no shadow maps — shadows are flat dark quads laid beside what casts them.
 *
 *   buildCity(kit, pack, network, { venues, soon, labelOf }) → {
 *     group, places, triangles, counts,
 *     setHome(houseId)        move the Home landmark to the player's district
 *     setTime('day'|'dusk'|'night')
 *     setTraffic(on)          the decorative "Moving" layer: more vehicles, and they drive
 *     animate(seconds)        called only from a running frame loop: water and traffic drift
 *     dispose()
 *   }
 * places[id] = { id, kind: 'venue' | 'home' | 'soon', x, z, ry, top, gate }
 */
import type { BufferGeometry, Group, InstancedMesh, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D } from 'three';
import type { Kit } from '../scene/kit.ts';
import { createBatch, sceneMaterials, hash } from '../scene/build.ts';
import { sign, textWidth } from '../scene/props.ts';
import { drawLandmark, PLINTH } from './landmarks.ts';
import type { Batch, LandmarkContext } from './landmarks.ts';
import { miniVehicle, boat } from './vehicles.ts';
import { pointInPolygon } from './roads.ts';
import type { Network, Road } from './roads.ts';
import { landOf, rasterLgas, scanRings } from './lga.ts';
import { estateLayout } from './estates.ts';
import { reliefAt, reliefNormal } from './relief.ts';
import type { Box4, CityPack, FabricStyle, LandKind, PackDistrict, PackFabric, PackHill, Point2, Point3, XZ } from './types.ts';

/** The Three.js namespace the map code is handed (it is loaded lazily, so it is never imported here as a value). */
type Three = typeof import('three');
/** What the map code uses of the scene kit (src/scene/kit.ts createKit()). */
/** The scene kit as the map code uses it: the real kit (src/scene/kit.ts createKit()). */
export type MapKit = Kit;
export type TimeOfDay = 'day' | 'dusk' | 'night';
/** Lighting for one time of day: sky gradient, hemisphere [sky, ground, intensity], sun [colour, intensity, position], and the city's own water / window / wave / shadow values. */
export interface TimePreset {
  sky: [string, string];
  hemi: [string, string, number];
  sun: [string, number, [number, number, number]];
  water: string;
  windows: string;
  waves: number;
  shadow: number;
}
/** One place on the map: a venue, the player's Home, or a coming-soon site. `gate` is where its path meets the road. */
export interface CityPlace {
  id: string;
  kind: 'venue' | 'home' | 'soon';
  x: number;
  z: number;
  ry: number;
  top: number;
  gate: Point3 | null;
  /** Home only: the district house id, or 'own' for the player's own plot. */
  house?: string;
  /** Home only: the district name, or the label of the player's own house. */
  district?: string;
  /** Home only: true when Home is the player's own plot. */
  own?: boolean;
}
/** The player's own plot, for setHome: where it is, what the label says, and how high the label sits. */
export interface OwnHome { x: number; z: number; label: string; top?: number }
/** The venue fields the builder reads (src/game/content/venues.ts). */
export interface CityVenue { scene?: { kind?: string; variant?: string } }
export interface CityMaterials {
  ground: MeshStandardMaterial;
  water: MeshStandardMaterial;
  board: MeshStandardMaterial;
  waves: MeshBasicMaterial;
  windows: MeshBasicMaterial;
  shadow: MeshBasicMaterial;
  instanced: MeshStandardMaterial;
}
/** The first estate of a local government (an element of estateLayout().cells). */
export interface CityFront { x: number; z: number; size: number }
/** What buildCity returns. */
export interface City {
  group: Group;
  places: Record<string, CityPlace>;
  materials: CityMaterials;
  pack: CityPack;
  readonly triangles: number;
  counts: { houses: number; towers: number; trees: number; palms: number; vehicles: number; shadows: number };
  readonly time: string;
  setHome(house: string | null, own?: OwnHome | null): boolean;
  setLgas(on: boolean, own?: string | null): boolean;
  /** Level of detail for a camera this far from the ground: returns true when something was shown or hidden. */
  setDetail(distance: number, far?: number): boolean;
  fronts: CityFront[];
  setTime(next: string): TimePreset;
  setTraffic(on: boolean): boolean;
  readonly traffic: boolean;
  animate(seconds: number): void;
  dispose(): void;
}
/** createRaw: a hand-rolled mesh collector for flat things the batch has no primitive for. */
export interface Raw {
  shape(polygon: readonly Point2[], y: number, colour: string, holes?: readonly (readonly Point2[])[]): void;
  wall(polygon: readonly Point2[], y0: number, y1: number, colour: string): void;
  ribbon(points: readonly Point3[], width: number, lift: number, colour: string, side?: number): void;
  /** A low round hill standing on the ground, in the ground's own colour at each point (`base`), lighter towards the crest and shaded by its slope. */
  mound(hill: PackHill, hills: readonly PackHill[], base: (x: number, z: number) => string): void;
  strip(points: readonly Point3[], side: number, low: number, high: number | number[], colour: string, facing?: number): void;
  readonly triangles: number;
  build(material: Material): Mesh;
}

export const WATER_Y = -0.5;
/**
 * The most triangles one frame of the city may cost: the city itself, its overlays, the route and the houses of an estate in view.
 * It was 60,000 for an invented board of 370 x 180 units. A map in true scale draws the real shoreline, about five triangles for
 * each of its few thousand vertices (the shallows, the wall and the top of the land), which is about 17,000 on its own, and the
 * fabric is spread over a state and not a city. Instancing and the merged meshes keep it to about forty draw calls, which is the limit that matters.
 */
export const CITY_TRIANGLE_BUDGET = 90000;
/** Landmarks are drawn a little larger than life, so each can be told apart on a view of the whole city. */
export const LANDMARK_SCALE = 1.15;
/** Footprint of a fabric house or block, as a share of its drawn size (see the fabric below). */
const FABRIC_SIZE = 0.6;
const LOT = PLINTH * LANDMARK_SCALE;
/** The land around a state map: quiet greys-greens that stay behind the state's own colours. */
export const CONTEXT_COLOURS = { state: '#dde1d3', country: '#e4dfd0', road: '#c2c3b8' } as const;
const LAND_COLOURS: Record<LandKind, string> = { mainland: '#bcd596', island: '#c6dca2', estate: '#b2d892', sand: '#f1dfae' };
/** The half-widths of the shallows and of the beach along a true-scale shoreline, in map units (100 m each at the frame's scale). */
const SHALLOWS = 0.55, BEACH = 0.22;
const ASPHALT = '#5d626b', TRUNK = '#464a52', TRUNK_KERB = '#f0eadb', KERB = '#e4dfcf', DASH = '#f6f2e2', PATH = '#dcd2b6';

export const CITY_LIGHT: Readonly<Record<TimeOfDay, TimePreset>> = Object.freeze({
  day: { sky: ['#cfeaf5', '#8fcbe6'], hemi: ['#f4fbff', '#9fb07f', 2.1], sun: ['#fff0d2', 2.5, [-70, 120, 90]], water: '#4faacb', windows: '#56748c', waves: 0.5, shadow: 0.2 },
  dusk: { sky: ['#f3b184', '#6a5c98'], hemi: ['#f6c9a8', '#5a5370', 1.45], sun: ['#ff9f5f', 1.9, [-130, 46, 40]], water: '#4a79a6', windows: '#ffd9a0', waves: 0.35, shadow: 0.24 },
  night: { sky: ['#1b2748', '#0a1024'], hemi: ['#9db2e6', '#1c2a44', 1.25], sun: ['#b4c6f5', 1.0, [-60, 110, 60]], water: '#1b3d68', windows: '#ffffff', waves: 0.16, shadow: 0.3 },
});

function mulberry(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const segmentDistance = (x: number, z: number, a: XZ, b: XZ) => { const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(x - a.x - dx * t, z - a.z - dz * t); };
const circle = (x: number, z: number, radius: number, sides = 12) => Array.from({ length: sides }, (_, i): [number, number] => [x + Math.cos((i / sides) * Math.PI * 2) * radius, z + Math.sin((i / sides) * Math.PI * 2) * radius]);
const PYLON_STAYS = 5;
/** Fabric outside the core is spaced this many times wider. */
const FAR_SPREAD = 2.4;
/** From this camera distance the instanced fabric is left out: a house is a speck, and a whole state reads as its shape. */
export const FABRIC_FAR = 760;
const inBox = (x: number, z: number, [x0, z0, x1, z1]: Box4) => x >= x0 && x <= x1 && z >= z0 && z <= z1;

/** A hand-rolled mesh collector for flat things the batch has no primitive for: polygons, ribbons, walls. */
export function createRaw(THREE: Three): Raw {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [], tint = new THREE.Color(), cache = new Map<string, [number, number, number]>();
  const rgb = (colour: string) => { if (!cache.has(colour)) { tint.set(colour); cache.set(colour, [tint.r, tint.g, tint.b]); } return cache.get(colour)!; };
  const v = (x: number, y: number, z: number, nx: number, ny: number, nz: number, colour: string) => { const c = rgb(colour); pos.push(x, y, z); nor.push(nx, ny, nz); col.push(c[0], c[1], c[2]); return pos.length / 3 - 1; };
  /** A triangle wound so that it faces the way its first vertex's normal points. */
  function tri(i: number, j: number, k: number) {
    const ax = pos[i * 3]!, ay = pos[i * 3 + 1]!, az = pos[i * 3 + 2]!;
    const ux = pos[j * 3]! - ax, uy = pos[j * 3 + 1]! - ay, uz = pos[j * 3 + 2]! - az, wx = pos[k * 3]! - ax, wy = pos[k * 3 + 1]! - ay, wz = pos[k * 3 + 2]! - az;
    const facing = (uy * wz - uz * wy) * nor[i * 3]! + (uz * wx - ux * wz) * nor[i * 3 + 1]! + (ux * wy - uy * wx) * nor[i * 3 + 2]!;
    if (facing >= 0) idx.push(i, j, k); else idx.push(i, k, j);
  }
  const raw: Raw = {
    /** A flat polygon [[x, z], …] at height y, facing up. */
    shape(polygon, y, colour, holes = []) {
      // A ring closed by repeating its first point is opened first, so the indices the triangulation returns match the vertices pushed here.
      const rings = [polygon, ...holes].map((ring) => { const a = ring[0], b = ring[ring.length - 1]; return a && b && ring.length > 3 && a[0] === b[0] && a[1] === b[1] ? ring.slice(0, -1) : ring; });
      const base = pos.length / 3;
      for (const ring of rings) for (const [x, z] of ring) v(x, y, z, 0, 1, 0, colour);
      const vectors = rings.map((ring) => ring.map(([x, z]) => new THREE.Vector2(x, z)));
      for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(vectors[0]!, vectors.slice(1))) tri(base + a!, base + b!, base + c!);
    },
    /** The vertical side of a closed polygon between two heights, facing outwards. */
    wall(polygon, y0, y1, colour) {
      let area = 0;
      for (let i = 0; i < polygon.length; i++) { const [ax, az] = polygon[i]!, [bx, bz] = polygon[(i + 1) % polygon.length]!; area += ax * bz - bx * az; }
      const out = area > 0 ? 1 : -1;
      for (let i = 0; i < polygon.length; i++) {
        const [ax, az] = polygon[i]!, [bx, bz] = polygon[(i + 1) % polygon.length]!, length = Math.hypot(bx - ax, bz - az) || 1;
        const nx = ((bz - az) / length) * out, nz = (-(bx - ax) / length) * out;
        const a = v(ax, y1, az, nx, 0, nz, colour), b = v(bx, y1, bz, nx, 0, nz, colour), c = v(bx, y0, bz, nx, 0, nz, colour), d = v(ax, y0, az, nx, 0, nz, colour);
        tri(a, b, c); tri(a, c, d);
      }
    },
    /** A flat band of the given width along a polyline [{ x, y, z }], `lift` above it; `side` shifts it sideways. */
    ribbon(points, width, lift, colour, side = 0) {
      const base = pos.length / 3;
      for (let i = 0; i < points.length; i++) {
        const a = points[Math.max(0, i - 1)]!, b = points[Math.min(points.length - 1, i + 1)]!, length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const px = -(b.z - a.z) / length, pz = (b.x - a.x) / length, p = points[i]!;
        v(p.x + px * (side + width / 2), p.y + lift, p.z + pz * (side + width / 2), 0, 1, 0, colour);
        v(p.x + px * (side - width / 2), p.y + lift, p.z + pz * (side - width / 2), 0, 1, 0, colour);
      }
      for (let i = 0; i < points.length - 1; i++) { const k = base + i * 2; tri(k, k + 1, k + 2); tri(k + 1, k + 3, k + 2); }
    },
    mound(hill, hills, ground) {
      const sides = 20, rings = 6, base = pos.length / 3, lit = new THREE.Color('#f2efc0'), mixed = new THREE.Color();
      // The sun is to the west and south: that flank is lighter, the far one darker.
      const colourAt = (x: number, z: number, t: number, nx: number, nz: number) => { const shade = 1 + (-nx * 0.5 + nz * 0.35) * 2.4; mixed.set(ground(x, z)).lerp(lit, t * t * 0.3); return `#${mixed.multiplyScalar(Math.max(0.55, Math.min(1.3, shade))).getHexString()}`; };
      const centre = reliefNormal(hills, hill.x, hill.z);
      v(hill.x, reliefAt(hills, hill.x, hill.z) + 0.01, hill.z, centre[0], centre[1], centre[2], colourAt(hill.x, hill.z, 1, 0, 0));
      for (let ring = 1; ring <= rings; ring++) for (let i = 0; i < sides; i++) {
        const r = (hill.r * ring) / rings, angle = (i / sides) * Math.PI * 2, x = hill.x + Math.cos(angle) * r, z = hill.z + Math.sin(angle) * r;
        const n = reliefNormal(hills, x, z);
        v(x, ring === rings ? 0 : reliefAt(hills, x, z) + 0.01, z, n[0], n[1], n[2], colourAt(x, z, 1 - ring / rings, n[0], n[2]));
      }
      for (let i = 0; i < sides; i++) tri(base, base + 1 + i, base + 1 + ((i + 1) % sides));
      for (let ring = 1; ring < rings; ring++) for (let i = 0; i < sides; i++) {
        const p = base + 1 + (ring - 1) * sides, q = p + sides, j = (i + 1) % sides;
        tri(p + i, q + i, q + j); tri(p + i, q + j, p + j);
      }
    },
    /** A vertical strip along a polyline, `side` units to one side, between two lifts (`high` may be a list, one per point); it faces away from the line. */
    strip(points, side, low, high, colour, facing = Math.sign(side) || 1) {
      const base = pos.length / 3;
      for (let i = 0; i < points.length; i++) {
        const a = points[Math.max(0, i - 1)]!, b = points[Math.min(points.length - 1, i + 1)]!, length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const px = -(b.z - a.z) / length, pz = (b.x - a.x) / length, p = points[i]!;
        v(p.x + px * side, p.y + (Array.isArray(high) ? high[i]! : high), p.z + pz * side, px * facing, 0, pz * facing, colour);
        v(p.x + px * side, p.y + low, p.z + pz * side, px * facing, 0, pz * facing, colour);
      }
      for (let i = 0; i < points.length - 1; i++) { const k = base + i * 2; tri(k, k + 1, k + 2); tri(k + 1, k + 3, k + 2); }
    },
    get triangles() { return idx.length / 3; },
    build(material) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
      geometry.setIndex(new THREE.BufferAttribute(pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
      return new THREE.Mesh(geometry, material);
    },
  };
  return raw;
}

/** The shimmer tile covers this many units of water. */
const WATER_TILE = 30;
/** The brightness (0…1) of the water's shimmer at (u, v) of its tile. Every frequency is a whole number, so the tile repeats without a seam. */
export function shimmer(u: number, v: number) {
  const a = u * Math.PI * 2, c = v * Math.PI * 2;
  const swell = Math.sin(c * 3 + Math.sin(a * 2) * 1.3) * 0.55 + Math.sin(c * 7 + a + Math.sin(a * 3 + c) * 0.9) * 0.45;
  const glint = Math.pow(Math.max(0, Math.sin(c * 10 + Math.sin(a * 2 + c) * 2.4 + Math.sin(a * 5) * 0.7)), 10) * (0.5 + 0.5 * Math.sin(a * 3 + c * 2));
  return Math.min(1, 0.91 + swell * 0.03 + glint * 0.07);
}
/**
 * The water's shimmer: a small procedural texture of soft swells and pale glints, made once and
 * tiled over the lagoon. It is STATIC — nothing about it moves, so it costs no frames; it multiplies
 * the water's colour, so it follows the time of day with it.
 */
function waterTexture(THREE: Three, size = 128) {
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const tone = Math.round(shimmer(i / size, j / size) * 255), k = (j * size + i) * 4;
    data[k] = tone; data[k + 1] = tone; data[k + 2] = Math.min(255, tone + 4); data[k + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true;
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Lean unit shapes for things drawn hundreds of times: a box without its underside (10 triangles)
 * and a four-sided pyramid without a base (4). White, so an instance colour is the colour.
 */
export function leanGeometry(THREE: Three, kind: 'box' | 'gable' | 'pyramid'): BufferGeometry {
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  const face = (points: number[][], normal: number[]) => { const base = pos.length / 3; for (const point of points) { pos.push(...point); nor.push(...normal); } for (let i = 1; i < points.length - 1; i++) idx.push(base, base + i, base + i + 1); };
  if (kind === 'box') {
    const a = -0.5, b = 0.5;
    face([[a, 1, b], [b, 1, b], [b, 1, a], [a, 1, a]], [0, 1, 0]);
    face([[a, 0, b], [b, 0, b], [b, 1, b], [a, 1, b]], [0, 0, 1]); face([[b, 0, a], [a, 0, a], [a, 1, a], [b, 1, a]], [0, 0, -1]);
    face([[b, 0, b], [b, 0, a], [b, 1, a], [b, 1, b]], [1, 0, 0]); face([[a, 0, a], [a, 0, b], [a, 1, b], [a, 1, a]], [-1, 0, 0]);
  } else if (kind === 'gable') {
    // A ridge roof: two slopes and two gable ends, the ridge running front to back. It sits on a unit house (y = 0 is the eaves).
    const r = 0.58, d = 0.56, h = 0.46, k = Math.hypot(h, r);
    face([[-r, 0, d], [0, h, d], [0, h, -d], [-r, 0, -d]], [-h / k, r / k, 0]); face([[r, 0, -d], [0, h, -d], [0, h, d], [r, 0, d]], [h / k, r / k, 0]);
    face([[-r, 0, d], [r, 0, d], [0, h, d]], [0, 0, 1]); face([[r, 0, -d], [-r, 0, -d], [0, h, -d]], [0, 0, -1]);
  } else {
    const r = 0.56, h = 0.6, k = Math.hypot(h, r);
    face([[-r, 0, r], [r, 0, r], [0, h, 0]], [0, r / k, h / k]); face([[r, 0, -r], [-r, 0, -r], [0, h, 0]], [0, r / k, -h / k]);
    face([[r, 0, r], [r, 0, -r], [0, h, 0]], [h / k, r / k, 0]); face([[-r, 0, -r], [-r, 0, r], [0, h, 0]], [-h / k, r / k, 0]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.length).fill(1), 3));
  geometry.setIndex(idx);
  return geometry;
}

/** Push a polygon's outline outwards by `distance`. */
function offsetPolygon(polygon: readonly Point2[], distance: number): [number, number][] {
  let area = 0;
  for (let i = 0; i < polygon.length; i++) { const [ax, az] = polygon[i]!, [bx, bz] = polygon[(i + 1) % polygon.length]!; area += ax * bz - bx * az; }
  const out = area > 0 ? 1 : -1, n = polygon.length;
  return polygon.map(([x, z], i) => {
    const [px, pz] = polygon[(i + n - 1) % n]!, [qx, qz] = polygon[(i + 1) % n]!, length = Math.hypot(qx - px, qz - pz) || 1;
    return [x + ((qz - pz) / length) * out * distance, z + (-(qx - px) / length) * out * distance];
  });
}

/** A stretch of ground road (or a path), and how far the fabric keeps off it. */
interface Segment { a: XZ; b: XZ; half: number }
/** A circle the fabric keeps out of. */
interface Clear { x: number; z: number; r: number }
/** A flat shadow quad, drawn in one instanced mesh. */
interface Shadow { x: number; z: number; w: number; d: number; ry: number }
interface HouseItem { x: number; z: number; ry: number; sx: number; sy: number; sz: number; wall: string; roof: string }
interface TowerItem { x: number; z: number; ry: number; sx: number; sy: number; sz: number; colour: string }
/** A tree or palm; palms on sand sit a little below ground (y). */
interface TreeItem { x: number; z: number; s: number; ry: number; y?: number }
/** Anything the instanced fabric stands up on the ground. */
interface Upright { x: number; y?: number; z: number; ry?: number; sx?: number; sy?: number; sz?: number }
interface TrafficItem { road: Road; at: number; speed: number; kind: 'danfo' | 'car'; colour: string }
/** The builder's drawing context: the landmark's batches, and `at` to stand it on a spot. */
interface Builder extends LandmarkContext { at(x: number, y: number, z: number, ry: number, draw: (g: Builder) => void): unknown }
type MaybeInstanced = Mesh & { isInstancedMesh?: boolean; count?: number };

export function buildCity(kit: MapKit, pack: CityPack, network: Network, { venues = {}, soon = {} }: { venues?: Readonly<Record<string, CityVenue | undefined>>; soon?: object } = {}): City {
  const { THREE } = kit;
  const shared = sceneMaterials(kit);
  const rng = mulberry(hash(`city:${pack.id}`));
  const group = new THREE.Group();
  group.name = `city:${pack.id}`;
  const own: { dispose(): void }[] = [];                                   // geometries and materials this city must free
  const keep = <T extends { dispose(): void }>(thing: T): T => { own.push(thing); return thing; };
  const materials = {
    ground: keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })),
    water: keep(new THREE.MeshStandardMaterial({ color: CITY_LIGHT.day.water, roughness: 0.42, metalness: 0.05, map: keep(waterTexture(THREE)) })),
    board: keep(new THREE.MeshStandardMaterial({ color: '#2c4a52', roughness: 1 })),
    waves: keep(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false })),
    windows: keep(new THREE.MeshBasicMaterial({ vertexColors: true, color: CITY_LIGHT.day.windows })),
    shadow: keep(new THREE.MeshBasicMaterial({ color: '#0d1a14', transparent: true, opacity: 0.2, depthWrite: false })),
    instanced: keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 })),
  };
  let triangles = 0;
  const add = <T extends Mesh>(mesh: T, name: string, order = 0): T => { mesh.name = name; mesh.renderOrder = order; mesh.matrixAutoUpdate = false; mesh.updateMatrix(); keep(mesh.geometry); group.add(mesh); return mesh; };
  const count = <T extends MaybeInstanced>(mesh: T): T => { triangles += (mesh.geometry.index!.count / 3) * (mesh.isInstancedMesh ? mesh.count! : 1); return mesh; };

  // ---- the board and the water -------------------------------------------------------------
  const { minX, maxX, minZ, maxZ } = pack.bounds;
  const seaZ = pack.bounds.sea ? pack.bounds.sea.z1 + 4 : maxZ;
  // A state map sits in the real map around it: the water and the board reach as far as the context land does.
  const edge = pack.context?.rect;
  const [bx0, bx1, bz0, bz1] = edge ? [Math.min(minX, edge.minX), Math.max(maxX, edge.maxX), Math.min(minZ, edge.minZ), Math.max(seaZ, edge.maxZ)] : [minX, maxX, minZ, seaZ];
  const width = bx1 - bx0, depth = bz1 - bz0, midX = (bx0 + bx1) / 2, midZ = (bz0 + bz1) / 2;
  const board = new THREE.Mesh(new THREE.BoxGeometry(width + 2, 3, depth + 2), materials.board);
  board.position.set(midX, WATER_Y - 1.56, midZ);
  count(add(board, 'board'));
  const water = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), materials.water);
  materials.water.map!.repeat.set(width / WATER_TILE, depth / WATER_TILE);
  if (pack.inland) { materials.water.map = null; materials.water.color.set('#bcd596'); materials.water.roughness = 1; materials.water.metalness = 0; }
  water.rotation.x = -Math.PI / 2; water.position.set(midX, WATER_Y, midZ);
  count(add(water, 'water'));

  // ---- land --------------------------------------------------------------------------------
  const raw = createRaw(THREE);
  // `k` shrinks what is drawn on a road (widths, kerbs, parapets, piers) for a map in true scale; the road's length and the deck's height are the pack's.
  const k = pack.roadScale ?? 1;
  const lands = landOf(pack).map((entry) => ({ ...entry, exact: pack.land.find((land) => land.id === entry.id)?.exact === true }));
  // Where the land is, as a grid: bit 1 is any land, bit 2 is land that may be built on. Looked up thousands of times by the fabric, the boats and the waves.
  const gridCell = Math.max(0.5, Math.sqrt((width * (maxZ - minZ)) / 6e6)), gridW = Math.ceil(width / gridCell), gridH = Math.ceil((maxZ - minZ) / gridCell);
  const mask = new Uint8Array(gridW * gridH);
  for (const entry of lands) {
    const bits = entry.kind === 'sand' ? 1 : 3;
    scanRings([entry.polygon, ...(entry.holes ?? [])], minX, minZ, gridCell, gridW, gridH, (row, from, to) => { for (let i = row * gridW + from; i <= row * gridW + to; i++) mask[i]! |= bits; });
  }
  const bitAt = (x: number, z: number, bit: number) => { const col = Math.floor((x - minX) / gridCell), row = Math.floor((z - minZ) / gridCell); return col >= 0 && row >= 0 && col < gridW && row < gridH && (mask[row * gridW + col]! & bit) !== 0; };
  const around = (x: number, z: number, margin: number): [number, number][] => [[x, z], [x + margin, z], [x - margin, z], [x, z + margin], [x, z - margin]];
  const onLand = (x: number, z: number, margin = 0) => (margin ? around(x, z, margin).every(([px, pz]) => bitAt(px, pz, 2)) : bitAt(x, z, 2));
  /** Land, or its shore (3 units round it): where no boat sails and no wave breaks. */
  const onAnyLand = (x: number, z: number) => pack.inland || around(x, z, 3).some(([px, pz]) => bitAt(px, pz, 1));
  /**
   * The stretches of a true-scale outline that are shore: an edge with more land just beyond it (the boundary between two local governments) is no shore and gets no
   * wall, shallows or beach. A stretch is a run of points; a ring that is shore all the way round is one closed run.
   */
  function shoreRuns(ring: readonly Point2[], hole: boolean): Point3[][] {
    const n = ring.length;
    let area = 0;
    for (let i = 0; i < n; i++) { const [ax, az] = ring[i]!, [bx, bz] = ring[(i + 1) % n]!; area += ax * bz - bx * az; }
    // Beyond the edge is the water side: outside an outer ring, inside a hole.
    const side = (area > 0 ? 1 : -1) * (hole ? -1 : 1);
    const shore = ring.map(([ax, az], i) => {
      const [bx, bz] = ring[(i + 1) % n]!, length = Math.hypot(bx - ax, bz - az) || 1;
      return !bitAt((ax + bx) / 2 + ((bz - az) / length) * side * 0.6, (az + bz) / 2 - ((bx - ax) / length) * side * 0.6, 1);
    });
    const at = (i: number): Point3 => ({ x: ring[i % n]![0], y: 0, z: ring[i % n]![1] });
    if (shore.every(Boolean)) return [Array.from({ length: n + 1 }, (_, i) => at(i))];
    const start = shore.findIndex((edge) => !edge), runs: Point3[][] = [];
    let run: Point3[] = [];
    for (let j = 1; j <= n; j++) {
      const i = (start + j) % n;
      if (shore[i]) { if (!run.length) run.push(at(i)); run.push(at(i + 1)); } else if (run.length) { runs.push(run); run = []; }
    }
    if (run.length) runs.push(run);
    return runs;
  }
  // The land around the state: flat, muted, under everything else, with no shore or beach of its own.
  for (const piece of pack.context?.land ?? []) raw.shape(piece.points, -0.06, piece.kind === 'country' ? CONTEXT_COLOURS.country : piece.kind === 'base' ? CONTEXT_COLOURS.state : CONTEXT_COLOURS.state, piece.holes);
  // Two sources meet at a border (Natural Earth for the countries, geoBoundaries for the states): a band along every outline closes the hairline gaps between them.
  for (const piece of pack.context?.land ?? []) if (piece.kind !== 'base') raw.ribbon([...piece.points, piece.points[0]!].map(([x, z]) => ({ x, y: 0, z })), 7, -0.07, piece.kind === 'country' ? CONTEXT_COLOURS.country : CONTEXT_COLOURS.state);
  for (const road of pack.context?.roads ?? []) if (road.points.length > 1) raw.ribbon(road.points.map(([x, z]) => ({ x, y: 0, z })), 1.1 * (pack.roadScale ?? 1), -0.02, CONTEXT_COLOURS.road);
  for (const entry of lands) {
    const sand = entry.kind === 'sand', holes = entry.holes ?? [];
    if (entry.exact) {
      // A real shoreline is drawn as given: the shallows and the beach are bands laid along it (half of each lies under the land), so no corner moves.
      const wall = sand ? '#e0cc98' : '#a9b98a', top = sand ? -0.12 : 0;
      [entry.polygon, ...holes].forEach((ring, index) => {
        for (const run of shoreRuns(ring, index > 0)) {
          raw.ribbon(run, SHALLOWS * 2, WATER_Y + 0.03, '#7cc6d6');
          if (sand) raw.ribbon(run, BEACH * 2, WATER_Y + 0.14, '#f8efd2');           // a green shore needs no beach band: it is under a pixel wide from any distance that shows it
          let area = 0;
          for (let i = 0; i < ring.length; i++) { const [ax, az] = ring[i]!, [bx, bz] = ring[(i + 1) % ring.length]!; area += ax * bz - bx * az; }
          raw.strip(run, 0, WATER_Y + 0.1, top, wall, (area > 0 ? 1 : -1) * (index > 0 ? 1 : -1));
        }
      });
    } else {
      raw.shape(offsetPolygon(entry.polygon, 2.6), WATER_Y + 0.03, '#7cc6d6');                       // the shallows
      raw.shape(offsetPolygon(entry.polygon, 1.1), WATER_Y + 0.14, sand ? '#f8efd2' : '#ecdcae');    // the beach rim
      raw.wall(entry.polygon, WATER_Y + 0.1, sand ? -0.12 : 0, sand ? '#e0cc98' : '#a9b98a');
    }
    raw.shape(entry.polygon, sand ? -0.12 : 0, LAND_COLOURS[entry.kind] || LAND_COLOURS.mainland, holes);
  }

  // ---- character: ground colour of old and planned areas, hills, inland water, railways ------
  const AREA_COLOURS = { old: '#cdb48c', planned: '#a6cc7c' } as const;
  const blob = (x: number, z: number, radius: number, seed: number): [number, number][] => Array.from({ length: 22 }, (_, i) => {
    const angle = (i / 22) * Math.PI * 2, wobble = 0.86 + 0.28 * ((hash(`${pack.id}:blob:${seed}:${i}`) % 100) / 100);
    return [x + Math.cos(angle) * radius * wobble, z + Math.sin(angle) * radius * wobble];
  });
  (pack.areas ?? []).forEach((area, i) => {
    // A wide soft edge: a larger, fainter patch under the main one.
    raw.shape(blob(area.x, area.z, area.r * 1.18, i), 0.016, area.tone === 'old' ? '#c4c19a' : '#b3d08a');
    raw.shape(blob(area.x, area.z, area.r, i + 100), 0.019, AREA_COLOURS[area.tone]);
  });
  const hills = pack.relief ?? [];
  const groundAt = (x: number, z: number) => { const area = (pack.areas ?? []).find((item) => Math.hypot(x - item.x, z - item.z) < item.r * 0.95); return area ? AREA_COLOURS[area.tone] : LAND_COLOURS.mainland; };
  for (const hill of hills) raw.mound(hill, hills, groundAt);
  const flat = (points: readonly Point2[], y = 0): Point3[] => points.map(([x, z]) => ({ x, y, z }));
  for (const water of pack.waters ?? []) {
    if (water.kind === 'lake') {
      raw.shape(water.points, 0.022, '#79bfd2');
      raw.ribbon(flat([...water.points, water.points[0]!]), 0.5, 0.02, '#a9dbe4');
    } else raw.ribbon(flat(water.points), water.width ?? 0.5, 0.025, '#6fb6cd');
  }
  for (const rail of pack.rails ?? []) {
    const line = flat(rail.points);
    raw.ribbon(line, 0.9, 0.03, '#a7a395');
    raw.ribbon(line, 0.64, 0.034, '#6f6b60');
    for (const side of [-0.2, 0.2]) raw.ribbon(line, 0.08, 0.04, '#d8d4c6', side);
  }

  // ---- roads and bridges --------------------------------------------------------------------
  const b = createBatch(THREE), w = createBatch(THREE);
  const g: Builder = { b, w, at: (x, y, z, ry, draw) => b.at(x, y, z, ry, () => w.at(x, y, z, ry, () => draw(g), 0, 0, LANDMARK_SCALE), 0, 0, LANDMARK_SCALE) };
  const hk = Math.sqrt(k), pk = Math.max(0.5, k);               // heights follow roads by the square root; paths never get thinner than half
  const segments: Segment[] = [];                              // every ground stretch of road, for keeping the fabric off it
  for (const road of network.roads) {
    const wide = (road.trunk ? 3.6 : road.major ? 2.5 : 1.8) * k;
    // On a hill the ribbon rides a little higher, so the mound's coarse surface never covers it.
    const hl = !road.bridge && road.points.some((point) => point.y > 0.05) ? 0.08 : 0;
    raw.ribbon(road.points, wide + 0.7 * k, road.bridge ? 0.05 : 0.035 + hl, road.trunk ? TRUNK_KERB : KERB);
    raw.ribbon(road.points, wide, road.bridge ? 0.08 : 0.06 + hl, road.trunk ? TRUNK : ASPHALT);
    if (road.major || road.trunk) {
      for (let i = 1; i < road.points.length - 1; i += 2) {
        const a = road.points[i]!, c = road.points[i + 1]!, mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2, z: (a.z + c.z) / 2 };
        raw.ribbon([{ x: a.x + (mid.x - a.x) * 0.3, y: a.y, z: a.z + (mid.z - a.z) * 0.3 }, mid], 0.16 * k, road.bridge ? 0.1 : 0.08 + hl, DASH);
      }
    }
    // Every road end is rounded off, so two roads that meet at an angle join in a smooth corner and not a notch.
    for (const end of [road.points[0]!, road.points[road.points.length - 1]!]) {
      raw.shape(circle(end.x, end.z, wide / 2 + 0.35 * k), 0.035 + hl + end.y, road.trunk ? TRUNK_KERB : KERB); raw.shape(circle(end.x, end.z, wide / 2), 0.06 + hl + end.y, road.trunk ? TRUNK : ASPHALT);
    }
    if (road.bridge) {
      // The parapets grow out of the ground with the ramp, so the deck leaves the road without a step.
      const span = road.points.slice(1, -1), rise = span.map((point) => 0.42 * hk * Math.min(1, point.y / (road.bridge * 0.4)));
      const coping = span.map((point, i) => ({ ...point, y: point.y + Math.max(0.1 * hk, rise[i]!) }));
      for (const side of [-1, 1]) {
        const edge = side * (wide / 2 + 0.35 * k);
        raw.strip(span, edge, -0.4, rise, '#efe9da', side); raw.strip(span, edge - side * 0.12 * k, 0.05, rise.map((high) => Math.max(0.05, high)), '#d6cfbc', -side);
        raw.ribbon(coping, 0.14 * k, 0, '#f6f2e6', edge - side * 0.06 * k);
      }
      const mid = Math.floor(road.points.length / 2), middle = road.points[mid]!;
      let since = 99;
      for (let i = 1; i < road.points.length - 1; i++) {
        const point = road.points[i]!, previous = road.points[i - 1]!;
        since += Math.hypot(point.x - previous.x, point.z - previous.z);
        if (since < 5.5 || onLand(point.x, point.z) || (road.pylon && Math.hypot(point.x - middle.x, point.z - middle.z) < 3.2 * k)) continue;
        since = 0;
        const next = road.points[i + 1]!, ry = Math.atan2(next.x - previous.x, next.z - previous.z), height = point.y - WATER_Y;
        b.box(point.x, WATER_Y + height / 2 - 0.2, point.z, wide * 0.8, height, 0.5 * k, '#cfc8b6', { ry });
        b.box(point.x, WATER_Y + 0.12, point.z, wide * 0.95, 0.24, 0.9 * k, '#b9b2a0', { ry });
      }
      if (road.pylon) {
        // A cable-stayed pylon astride the deck at mid-span: two legs rise from pile caps in the water and lean in to one
        // mast head, a cross-beam carries the deck between them, and the stays fan down in two planes to the parapets.
        const before = road.points[mid - 1]!, after = road.points[mid + 1]!, ry = Math.atan2(after.x - before.x, after.z - before.z);
        const foot = wide / 2 + 1.25 * k, apex = 0.2 * k, top = middle.y + 8.2 * hk, tall = top - WATER_Y, lean = Math.atan2(foot - apex, tall), stone = '#f4f0e6';
        const legAt = (y: number) => foot - (foot - apex) * ((y - WATER_Y) / tall);
        const heads: Record<number, Point3[]> = { [-1]: [], 1: [] };
        b.at(middle.x, 0, middle.z, ry, () => {
          for (const side of [-1, 1]) {
            b.box(side * (foot + apex) / 2, WATER_Y + tall / 2, 0, 0.5 * k, Math.hypot(foot - apex, tall), 0.62 * k, stone, { rz: side * lean });
            b.box(side * foot, WATER_Y + 0.2, 0, 1.4 * k, 0.4, 1.6 * k, '#b9b2a0');
            for (let n = 1; n <= PYLON_STAYS; n++) heads[side]!.push(b.world(-side * 0.16, top + 0.1 + n * 0.3, 0));
          }
          b.box(0, middle.y - 0.42, 0, legAt(middle.y - 0.42) * 2, 0.44, 0.5 * k, stone);
          b.box(0, top + 0.55, 0, 0.66 * k, 2.5, 0.72 * k, stone);
          b.box(0, top + 1.88, 0, 0.86 * k, 0.16, 0.92 * k, '#d9d3c4');
          b.ico(0, top + 2.14, 0, 0.17, 0.17, 0.17, '#ff3b30', { layer: 'glow' });
        });
        for (const way of [-1, 1]) {
          let run = 0, n = 0;
          for (let i = mid + way; i > 1 && i < road.points.length - 2 && n < PYLON_STAYS; i += way) {
            const point = road.points[i]!, previous = road.points[i - way]!;
            run += Math.hypot(point.x - previous.x, point.z - previous.z);
            if (run < (n + 1) * 1.45 * hk) continue;
            const a = road.points[i - 1]!, c = road.points[i + 1]!, length = Math.hypot(c.x - a.x, c.z - a.z) || 1, px = -(c.z - a.z) / length, pz = (c.x - a.x) / length;
            for (const side of [-1, 1]) {
              const head = heads[side]![n]!, reach = side * (wide / 2 + 0.29 * k);
              const anchor = { x: point.x + px * reach, y: point.y + 0.4, z: point.z + pz * reach };
              const flat = Math.hypot(anchor.x - head.x, anchor.z - head.z), drop = head.y - anchor.y;
              b.at(head.x, head.y, head.z, Math.atan2(anchor.x - head.x, anchor.z - head.z), () => b.box(0, -drop / 2, flat / 2, 0.055 * hk, Math.hypot(flat, drop), 0.055 * hk, '#e6eaec', { rx: -Math.atan2(flat, drop) }));
            }
            n += 1;
          }
        }
      }
    } else {
      for (let i = 1; i < road.points.length; i++) segments.push({ a: road.points[i - 1]!, b: road.points[i]!, half: wide / 2 + 0.5 * k });
    }
  }

  // ---- landmarks ----------------------------------------------------------------------------
  const ground = (x: number, z: number) => reliefAt(hills, x, z);
  // A railway keeps the fabric off it, and each station stands beside its line.
  for (const rail of pack.rails ?? []) {
    for (let i = 1; i < rail.points.length; i++) segments.push({ a: { x: rail.points[i - 1]![0], z: rail.points[i - 1]![1] }, b: { x: rail.points[i]![0], z: rail.points[i]![1] }, half: 0.7 });
    for (const station of rail.stations) {
      b.box(station.x + 1.1, 0.14, station.z, 0.7, 0.2, 5.2, '#d8d1bd'); b.box(station.x + 1.1, 0.95, station.z, 0.9, 0.12, 5.6, '#b5593c');
      for (const dz of [-2.4, 2.4]) b.box(station.x + 1.1, 0.5, station.z + dz, 0.1, 0.9, 0.1, '#8d8a80');
    }
  }
  const places: Record<string, CityPlace> = {};
  const shadows: Shadow[] = [];                               // { x, z, w, d, ry } flat shadows, drawn as one instanced mesh
  const clear: Clear[] = [];                                 // { x, z, r } circles the fabric keeps out of
  const path = (place: { x: number; z: number; gate: Point3 | null }) => {
    if (!place.gate) return;
    const length = Math.hypot(place.gate.x - place.x, place.gate.z - place.z), k = Math.min(1, (LOT / 2 - 0.2) / (length || 1));
    const start = { x: place.x + (place.gate.x - place.x) * k, y: ground(place.x, place.z), z: place.z + (place.gate.z - place.z) * k };
    raw.ribbon([start, place.gate], 1.3 * pk, 0.045, PATH);
    segments.push({ a: start, b: place.gate, half: 1.2 * pk });
  };
  for (const [id, spot] of Object.entries(pack.sites)) {
    const venue = venues[id], node = network.places[id];
    if (!venue || !node) continue;
    let top = 4;
    const lift = ground(node.x, node.z);
    g.at(node.x, lift, node.z, node.ry, () => { top = drawLandmark(g, venue.scene?.kind, venue.scene?.variant).top * LANDMARK_SCALE; });
    places[id] = { id, kind: 'venue', x: spot.x, z: spot.z, ry: node.ry, top: top + lift, gate: node.gate };
    shadows.push({ x: spot.x + 0.7, z: spot.z + 0.55, w: LOT + 1.3, d: LOT + 1.3, ry: node.ry });
    clear.push({ x: spot.x, z: spot.z, r: LOT * 0.78 });
    path(places[id]);
  }
  // Home: every district's lot is laid out; the house itself is its own small mesh, moved to the player's lot.
  for (const [house, spot] of Object.entries(pack.homes)) {
    const node = network.places[`home:${house}`]!;
    // An empty lot is a small garden: three trees, so it never reads as a hole in the city.
    for (const [dx, dz, size] of [[-2.2, -1.8, 1.1], [2, -0.6, 0.9], [-0.6, 2, 1]] as [number, number, number][]) { b.cyl(spot.x + dx, ground(spot.x, spot.z) + 0.5 * size, spot.z + dz, 0.14 * size, size, '#6b4f36', { seg: 5 }); b.ico(spot.x + dx, ground(spot.x, spot.z) + 1.5 * size, spot.z + dz, 0.85 * size, 0.95 * size, 0.85 * size, '#3f8a57'); }
    clear.push({ x: spot.x, z: spot.z, r: LOT * 0.78 });
    path({ x: spot.x, z: spot.z, gate: node.gate });
  }
  for (const [id, spot] of Object.entries(pack.soon || {})) {
    if (!(soon as Record<string, unknown>)[id]) continue;
    places[id] = { id, kind: 'soon', x: spot.x, z: spot.z, ry: 0, top: 7.5, gate: null };
  }
  const homeBatch = createBatch(THREE), homeWindows = createBatch(THREE);
  const hg: Builder = { b: homeBatch, w: homeWindows, at: (x, y, z, ry, draw) => draw(hg) };
  const homeTop = drawLandmark(hg, 'home').top * LANDMARK_SCALE;

  // ---- district plates, laid on the ground or lettered on the water ---------------------------
  const plates: (PackDistrict & { box: Box4 })[] = [];
  for (const plate of pack.districts || []) {
    const size = plate.size || 2, wide = textWidth(plate.name, size);
    b.at(plate.x, plate.water ? WATER_Y + 0.07 : 0.1 + ground(plate.x, plate.z), plate.z, 0, () => {
      if (!plate.water) b.box(0, 0, -0.04, wide + size * 0.9, size * 1.7, 0.08, '#8fb07a');
      sign(b, 0, 0, 0, plate.name, { size, color: plate.water ? '#d6f1f7' : '#f6faea' });
    }, -Math.PI / 2);
    plates.push({ ...plate, box: [plate.x - wide / 2 - size, plate.z - size * 1.2, plate.x + wide / 2 + size, plate.z + size * 1.2] });
  }

  // ---- what only this city has ----------------------------------------------------------------
  pack.decorate?.(b, { rng, w });

  /** The metropolitan core: the default view, where the boats sail and the fabric is densest. The whole board when the pack names none. */
  const core = pack.core ?? { minX: minX + 8, maxX: maxX - 8, minZ: minZ + 8, maxZ: maxZ - 8 };
  const inCore = (x: number, z: number, pad = 0) => x >= core.minX - pad && x <= core.maxX + pad && z >= core.minZ - pad && z <= core.maxZ + pad;
  // ---- boats on the lagoon and the creek ------------------------------------------------------
  const hulls = ['#b5483f', '#2b5fa8', '#e0a23a', '#3f9a5a', '#ece2c6'];
  for (let i = 0, placed = 0; i < 400 && placed < 16; i++) {
    const x = core.minX + 8 + rng() * (core.maxX - core.minX - 16), z = core.minZ + 8 + rng() * (core.maxZ - core.minZ - 16);
    if (onAnyLand(x, z) || network.roads.some((road) => road.bridge && road.points.some((point) => Math.hypot(point.x - x, point.z - z) < 5)) || plates.some((plate) => inBox(x, z, plate.box))) continue;
    boat(b, x, z, rng() * Math.PI * 2, hulls[placed % hulls.length]!, placed % 3 !== 0);
    placed += 1;
  }

  // ---- the fabric: houses, blocks, towers, trees and palms ------------------------------------
  const roadDistance = (x: number, z: number) => { let best = Infinity; for (const segment of segments) { const d = segmentDistance(x, z, segment.a, segment.b) - segment.half; if (d < best) best = d; } return best; };
  // The first estate of every local government is open ground for its residents' houses.
  const fronts: CityFront[] = (pack.lgas || []).map((lga) => estateLayout(pack, lga.id)!.cells[0]!);
  const blocked = (x: number, z: number, pad: number) => fronts.some((cell) => Math.abs(x - cell.x) < cell.size / 2 + pad + 0.6 && Math.abs(z - cell.z) < cell.size / 2 + pad + 0.6) || clear.some((circle) => Math.hypot(circle.x - x, circle.z - z) < circle.r + pad)
    || (pack.zones || []).some((zone) => inBox(x, z, [zone[0] - pad, zone[1] - pad, zone[2] + pad, zone[3] + pad]))
    || plates.some((plate) => !plate.water && inBox(x, z, [plate.box[0] - pad, plate.box[1] - pad, plate.box[2] + pad, plate.box[3] + pad]))
    || Object.values(pack.estates || {}).some((estate) => inBox(x, z, [estate.x - 1.6 - pad, estate.z - 1.6 - pad, estate.x + (estate.cols - 1) * 2.7 + 1.6 + pad, estate.z + (Math.ceil((estate.max ?? 18) / estate.cols) - 1) * 3 + 1.6 + pad]));
  const noise = (x: number, z: number) => { const cell = (ix: number, iz: number) => (hash(`${pack.id}:${ix}:${iz}`) % 1000) / 1000, fx = x / 22, fz = z / 22, ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    return (cell(ix, iz) * (1 - tx) + cell(ix + 1, iz) * tx) * (1 - tz) + (cell(ix, iz + 1) * (1 - tx) + cell(ix + 1, iz + 1) * tx) * tz; };
  const STYLES: Partial<Record<FabricStyle, { gap: number; keep: number; tree: number }>> = {
    dense: { gap: 3.5, keep: 0.66, tree: 0.1 },
    blocks: { gap: 4.6, keep: 0.7, tree: 0.1 },
    towers: { gap: 5.0, keep: 0.78, tree: 0.08 },
    villas: { gap: 4.7, keep: 0.74, tree: 0.26 },
  };
  const WALLS = ['#f3ead6', '#ece0c4', '#f6f0e2', '#e9d9b8', '#efe3d0', '#dfe8ea'], ROOFS = ['#a85c40', '#96483a', '#8d9399', '#b67a45', '#6f8492', '#9b9b8f'];
  const BLOCKS = ['#e6dcc6', '#d9cdb4', '#cfd8dc', '#e8d6c0', '#d6dfd0', '#f0e4cc'], GLASSY = ['#9fb9c8', '#b7c9d2', '#8fa9bd', '#c9d6da', '#a9bfc0', '#d9d2c0'];
  const inArea = (entry: PackFabric, x: number, z: number) => inBox(x, z, entry.box) && (!entry.circle || Math.hypot(x - entry.circle[0], z - entry.circle[1]) <= entry.circle[2]);
  const houses: HouseItem[] = [], towers: TowerItem[] = [], trees: TreeItem[] = [], palms: TreeItem[] = [];
  for (const area of pack.fabric || []) {
    const style = STYLES[area.style];
    if (!style) continue;
    // Far suburbs are drawn lighter: the same fabric, spaced wider, so a whole state costs little more than the core.
    const gap = style.gap * (inCore((area.box[0] + area.box[2]) / 2, (area.box[1] + area.box[3]) / 2, 20) ? 1 : FAR_SPREAD);
    for (let x = area.box[0]; x <= area.box[2]; x += gap) for (let z = area.box[1]; z <= area.box[3]; z += gap) {
      const px = x + (rng() - 0.5) * 0.7, pz = z + (rng() - 0.5) * 0.7, roll = rng(), turn = rng() < 0.5 ? 0 : Math.PI / 2, pick = Math.floor(rng() * 6), tall = rng();
      // The first area that contains a point owns it, so overlapping areas never double up.
      if (pack.fabric.find((entry) => inArea(entry, px, pz)) !== area) continue;
      if (!onLand(px, pz, 2.2) || blocked(px, pz, 1.6)) continue;
      const toRoad = roadDistance(px, pz);
      if (toRoad < 1.5) continue;
      const patch = noise(px, pz);
      // Built-up patches along the roads, green between them.
      const built = toRoad < 24 && patch < style.keep + (area.keep ?? 0) + (toRoad < 7 ? 0.3 : 0);
      if (!built || roll < style.tree) {
        if (roll < (built ? 1 : 0.5)) (area.style === 'villas' && tall < 0.35 ? palms : trees).push({ x: px, z: pz, s: 0.8 + tall * 0.7, ry: tall * 6 });
        continue;
      }
      if (area.style === 'dense') houses.push({ x: px, z: pz, ry: turn, sx: 1.9 + tall * 0.6, sy: 1.0 + tall * 0.5, sz: 2.2 + roll * 0.7, wall: WALLS[pick]!, roof: (area.roofs ?? ROOFS)[(pick + Math.floor(tall * 3)) % (area.roofs ?? ROOFS).length]! });
      else if (area.style === 'villas') houses.push({ x: px, z: pz, ry: turn, sx: 2.7 + tall * 0.6, sy: 1.5 + tall * 0.5, sz: 3.0 + roll * 0.6, wall: '#f6f1e6', roof: ['#b5593c', '#a85c40', '#3f7f86', '#b5593c', '#96483a', '#55707c'][pick]! });
      else if (area.style === 'blocks') towers.push({ x: px, z: pz, ry: turn, sx: 2.5 + roll * 0.9, sy: 2.4 + tall * 2.4, sz: 2.5 + tall * 0.8, colour: BLOCKS[pick]! });
      else towers.push({ x: px, z: pz, ry: turn, sx: 2.7 + roll * 0.8, sy: 4.6 + tall * tall * 7.5, sz: 2.7 + tall * 0.6, colour: GLASSY[pick]! });
    }
  }
  // Palms along the sand, wherever there is sand.
  for (const entry of lands.filter((item) => item.kind === 'sand')) {
    for (let i = 0; i < entry.polygon.length; i += 3) {
      const [ax, az] = entry.polygon[i]!;
      const cx = entry.polygon.reduce((sum, point) => sum + point[0], 0) / entry.polygon.length, cz = entry.polygon.reduce((sum, point) => sum + point[1], 0) / entry.polygon.length;
      const x = ax + (cx - ax) * 0.12 + (rng() - 0.5) * 2, z = az + (cz - az) * 0.3 + (rng() - 0.5);
      if (!blocked(x, z, 1) && roadDistance(x, z) > 1 && pointInPolygon(x, z, entry.polygon)) palms.push({ x, z, s: 0.8 + rng() * 0.5, ry: rng() * 6, y: -0.12 });
    }
  }
  // The core keeps its share of every cap, so the far suburbs thin first.
  const thin = <T extends XZ>(list: T[], cap: number): T[] => {
    const inner = list.filter((item) => inCore(item.x, item.z, 20)), outer = list.filter((item) => !inCore(item.x, item.z, 20));
    const take = (items: T[], limit: number): T[] => { if (items.length <= limit) return items; const step = items.length / limit; return Array.from({ length: limit }, (_, i) => items[Math.floor(i * step)]!); };
    const room = Math.max(0, cap - inner.length);
    return [...take(inner, Math.ceil(cap * 0.8)), ...take(outer, Math.max(Math.floor(cap * 0.2), room))];
  };
  // The fabric is a sketch of built-up areas and the landmarks are icons of places: at 100 m a unit a fabric house is drawn about 150 m wide, clearly smaller than a landmark, which is drawn larger than life on purpose.
  for (const item of [...houses, ...towers]) { item.sx *= FABRIC_SIZE; item.sz *= FABRIC_SIZE; item.sy *= 0.85; }
  // The decorative fabric is thinner than it could be on purpose: the houses that matter are the players' own (src/map3d/houses.ts), and they need room in the budget.
  const HOUSE_CAP = 460, TOWER_CAP = 160, TREE_CAP = 330, PALM_CAP = 80;
  const fabric = { houses: thin(houses, HOUSE_CAP), towers: thin(towers, TOWER_CAP), trees: thin(trees, TREE_CAP), palms: thin(palms, PALM_CAP) };

  const dummy = new THREE.Object3D(), tint = new THREE.Color();
  const unit = (draw: (batch: Batch) => void, material: Material = materials.instanced) => { const batch = createBatch(THREE); draw(batch); return batch.build({ solid: material, glow: material, glass: material }).meshes[0]!.geometry; };
  function instanced<T>(name: string, geometry: BufferGeometry, material: Material, items: T[], place: (item: T, object: Object3D) => void, colourOf?: ((item: T) => string) | null): InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, items.length));
    mesh.count = items.length;
    items.forEach((item, i) => {
      place(item, dummy); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
      if (colourOf) mesh.setColorAt(i, tint.set(colourOf(item)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    add(mesh, name);
    if (items.length) count(mesh);
    mesh.visible = items.length > 0;
    return mesh;
  }
  const upright = (item: Upright, object: Object3D, sx = item.sx!, sy = item.sy!, sz = item.sz!) => { object.position.set(item.x, (item.y || 0) + ground(item.x, item.z), item.z); object.rotation.set(0, item.ry || 0, 0); object.scale.set(sx, sy, sz); };
  const fabricMeshes: InstancedMesh[] = [];
  const fabricLayer = (mesh: InstancedMesh) => { fabricMeshes.push(mesh); return mesh; };
  fabricLayer(instanced('house-walls', leanGeometry(THREE, 'box'), materials.instanced, fabric.houses, (item, o) => upright(item, o), (item) => item.wall));
  fabricLayer(instanced('house-roofs', leanGeometry(THREE, 'pyramid'), materials.instanced, fabric.houses,
    (item, o) => { o.position.set(item.x, item.sy + ground(item.x, item.z), item.z); o.rotation.set(0, item.ry, 0); o.scale.set(item.sx, 0.9 + item.sy * 0.25, item.sz); }, (item) => item.roof));
  fabricLayer(instanced('house-windows', unit((u) => { u.quad(0.18, 0.55, 0.506, 0.26, 0.3, '#ffe6ae'); u.quad(0.506, 0.55, -0.1, 0.26, 0.3, '#fff4d6', { ry: Math.PI / 2 }); }, materials.windows),
    materials.windows, fabric.houses, (item, o) => upright(item, o)));
  fabricLayer(instanced('towers', unit((u) => { u.box(0, 0.5, 0, 1, 1, 1, '#ffffff'); u.box(0, 1.01, 0, 0.7, 0.03, 0.7, '#c9ced3'); }), materials.instanced, fabric.towers, (item, o) => upright(item, o), (item) => item.colour));
  fabricLayer(instanced('tower-windows', unit((u) => {
    const tones = ['#ffe6ae', '#fff4d6', '#2c3a4a', '#ffd98a', '#cfe4ff', '#2c3a4a'];
    for (let floor = 0; floor < 4; floor++) for (let face = 0; face < 4; face++) {
      const ry = face * Math.PI / 2;
      u.quad(Math.sin(ry) * 0.506, 0.2 + floor * 0.2, Math.cos(ry) * 0.506, 0.78, 0.085, tones[(floor * 5 + face * 3) % tones.length]!, { ry });
    }
  }, materials.windows), materials.windows, fabric.towers, (item, o) => upright(item, o)));
  fabricLayer(instanced('trees', unit((u) => { u.cyl(0, 0.45, 0, 0.13, 0.9, '#6b4f36', { seg: 4, open: true }); u.ico(0, 1.45, 0, 0.85, 0.95, 0.85, '#ffffff'); }), materials.instanced, fabric.trees,
    (item, o) => upright(item, o, item.s, item.s, item.s), (item) => ['#3f8a57', '#4f9a5f', '#2c6b4a', '#5aa55f', '#3a7d4f'][Math.floor(item.ry * 7) % 5]!));
  fabricLayer(instanced('palms', unit((u) => {
    u.cyl(0, 1.5, 0, 0.11, 3.0, '#8a7250', { seg: 5, top: 0.7 });
    for (let i = 0; i < 6; i++) { const a = i * 1.047; u.cone(Math.sin(a) * 0.8, 2.95, Math.cos(a) * 0.8, 0.32, 1.6, i % 2 ? '#3f8a57' : '#4f9a5f', { seg: 3, rz: -Math.sin(a) * 1.25, rx: Math.cos(a) * 1.25 }); }
  }), materials.instanced, fabric.palms, (item, o) => upright(item, o, item.s, item.s, item.s)));

  // ---- flat shadows: one instanced quad beside everything that stands up -----------------------
  for (const item of fabric.houses) shadows.push({ x: item.x + 0.3 + item.sy * 0.22, z: item.z + 0.2 + item.sy * 0.16, w: item.sx + 0.5, d: item.sz + 0.5, ry: item.ry });
  for (const item of fabric.towers) shadows.push({ x: item.x + 0.3 + item.sy * 0.2, z: item.z + 0.2 + item.sy * 0.14, w: item.sx + 0.5 + item.sy * 0.12, d: item.sz + 0.5 + item.sy * 0.1, ry: item.ry });
  for (const item of fabric.trees) shadows.push({ x: item.x + 0.4 * item.s, z: item.z + 0.3 * item.s, w: 1.7 * item.s, d: 1.5 * item.s, ry: 0.5 });
  const shadowGeometry = new THREE.PlaneGeometry(1, 1); shadowGeometry.rotateX(-Math.PI / 2);
  const shadowMesh = instanced('shadows', shadowGeometry, materials.shadow, shadows, (item, o) => { o.position.set(item.x, 0.02 + ground(item.x, item.z), item.z); o.rotation.set(0, item.ry, 0); o.scale.set(item.w, 1, item.d); });
  shadowMesh.renderOrder = 1;
  fabricLayer(shadowMesh);
  let fabricOn = true;

  // ---- street traffic: parked until the Moving layer is on and a frame loop is running ---------
  const lanes = network.roads.filter((road) => road.major && road.length > 20 && road.points.some((point) => inCore(point.x, point.z)));
  if (!lanes.length) lanes.push(...network.roads.filter((road) => road.major && road.length > 20));
  const traffic: TrafficItem[] = [];
  for (let i = 0; i < 38 && lanes.length; i++) {
    const road = lanes[i % lanes.length]!;
    traffic.push({ road, at: rng() * road.length, speed: (2.2 + rng() * 2.2) * (i % 2 ? 1 : -1), kind: i % 5 < 2 ? 'danfo' : 'car', colour: ['#f6f2e6', '#c9423a', '#2b5fa8', '#30343b', '#d9d4c4', '#1f8a86'][i % 6]! });
  }
  const along = (road: Road, distance: number) => {
    const points = road.points, d = ((distance % road.length) + road.length) % road.length;
    let run = 0;
    for (let i = 1; i < points.length; i++) {
      const length = Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z);
      if (run + length >= d || i === points.length - 1) { const t = Math.min(1, (d - run) / (length || 1)); return { x: points[i - 1]!.x + (points[i]!.x - points[i - 1]!.x) * t, y: points[i - 1]!.y + (points[i]!.y - points[i - 1]!.y) * t, z: points[i - 1]!.z + (points[i]!.z - points[i - 1]!.z) * t, ry: Math.atan2(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z) }; }
      run += length;
    }
    return { x: points[0]!.x, y: 0, z: points[0]!.z, ry: 0 };
  };
  const fleets = ['danfo', 'car'].map((kind) => {
    const items = traffic.filter((item) => item.kind === kind);
    const mesh = instanced(`traffic-${kind}`, unit((u) => miniVehicle(u, kind)), materials.instanced, items, (item, o) => o.position.set(0, 0, 0), kind === 'car' ? (item) => item.colour : null);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return { mesh, items };
  });
  const vehicleScale = Math.min(1, Math.max(0.5, k * 1.3));
  let trafficOn = false;
  function placeTraffic(seconds: number) {
    for (const { mesh, items } of fleets) {
      items.forEach((item, i) => {
        const spot = along(item.road, item.at + (trafficOn ? item.speed * seconds : 0)), lane = (item.speed > 0 ? -0.62 : 0.62) * pk, ry = spot.ry + (item.speed > 0 ? 0 : Math.PI);
        dummy.position.set(spot.x - Math.cos(spot.ry) * lane, spot.y + 0.08, spot.z + Math.sin(spot.ry) * lane);
        dummy.rotation.set(0, ry, 0); dummy.scale.setScalar(vehicleScale); dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.count = trafficOn ? items.length : Math.ceil(items.length / 2);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
  placeTraffic(0);

  // ---- waves: a few pale dashes on open water ---------------------------------------------------
  const waveRaw = createRaw(THREE);
  for (let i = 0, placed = 0; i < 2400 && placed < 260; i++) {
    const x = minX + 3 + rng() * (width - 6), z = minZ + 3 + rng() * (depth - 6), length = 1.2 + rng() * 2.2;
    if (onAnyLand(x, z)) continue;
    waveRaw.ribbon([{ x: x - length / 2, y: 0, z }, { x, y: 0, z: z + 0.12 }, { x: x + length / 2, y: 0, z }], 0.12, WATER_Y + 0.05, '#ffffff');
    placed += 1;
  }
  const waves = count(add(waveRaw.build(materials.waves), 'waves', 1));

  // ---- bake ------------------------------------------------------------------------------------
  count(add(raw.build(materials.ground), 'ground'));
  const built = b.build(shared);
  for (const mesh of built.meshes) { mesh.castShadow = false; mesh.receiveShadow = false; count(add(mesh, `city-${mesh.name}`, mesh.name === 'glass' ? 2 : 0)); }
  const windowMesh = w.build({ solid: materials.windows, glow: materials.windows, glass: materials.windows }).meshes[0];
  if (windowMesh) { windowMesh.castShadow = false; windowMesh.receiveShadow = false; count(add(windowMesh, 'windows')); }

  // The Home landmark: its own two small meshes in a group that is moved to the player's lot.
  const home = new THREE.Group();
  home.name = 'home';
  for (const mesh of homeBatch.build(shared).meshes) { mesh.castShadow = false; mesh.receiveShadow = false; keep(mesh.geometry); triangles += mesh.geometry.index!.count / 3; home.add(mesh); }
  const homeWindowMesh = homeWindows.build({ solid: materials.windows, glow: materials.windows, glass: materials.windows }).meshes[0];
  if (homeWindowMesh) { homeWindowMesh.castShadow = false; keep(homeWindowMesh.geometry); triangles += homeWindowMesh.geometry.index!.count / 3; home.add(homeWindowMesh); }
  group.add(home);
  let homeId: string | null = null;
  /**
   * Where Home is: the rented home of a district (the landmark stands on its lot), or — `own` =
   * { x, z, label } — the player's own house on its plot, where the landmark makes way for the
   * estate's houses and Home is just the place the label points at.
   */
  function setHome(house: string | null, own: OwnHome | null = null): boolean {
    if (own) {
      const key = `own:${own.x.toFixed(2)}:${own.z.toFixed(2)}`;
      if (key === homeId) return false;
      homeId = key; home.visible = false;
      const node = network.attachPlace('home:own', { x: own.x, z: own.z })!;
      places.home = { id: 'home', kind: 'home', house: 'own', district: own.label, x: own.x, z: own.z, ry: node.ry, top: own.top ?? 1, gate: node.gate, own: true };
      return true;
    }
    const id = Object.hasOwn(pack.homes, house as string) ? house as string : Object.keys(pack.homes)[0]!;
    if (id === homeId) return false;
    homeId = id; home.visible = true;
    const node = network.places[`home:${id}`]!, spot = pack.homes[id]!;
    home.position.set(spot.x, ground(spot.x, spot.z), spot.z); home.rotation.y = node.ry; home.scale.setScalar(LANDMARK_SCALE);
    places.home = { id: 'home', kind: 'home', house: id, district: spot.district, x: spot.x, z: spot.z, ry: node.ry, top: homeTop + ground(spot.x, spot.z), gate: node.gate };
    return true;
  }
  setHome(null);

  // ---- the local governments: one flat layer of tints and boundary lines, drawn on land only ----------------
  let lgaMesh: Mesh<BufferGeometry, MeshBasicMaterial> | null = null, lgaOwn: string | null | undefined;
  if (pack.lgas?.length) {
    const material = keep(new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    const plane = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ);
    plane.rotateX(-Math.PI / 2);
    lgaMesh = new THREE.Mesh(plane, material);
    lgaMesh.position.set((minX + maxX) / 2, 0.012, (minZ + maxZ) / 2);
    lgaMesh.visible = false;
    count(add(lgaMesh, 'lgas', 1));
  }
  /** Show or hide the local-government layer; `own` is the player's, drawn brighter with a firmer line. Returns true when it changed. */
  function setLgas(on: boolean, own: string | null = null): boolean {
    if (!lgaMesh) return false;
    let changed = lgaMesh.visible !== Boolean(on);
    lgaMesh.visible = Boolean(on);
    if (on && (own !== lgaOwn || !lgaMesh.material.map)) {
      lgaOwn = own;
      const image = rasterLgas(pack, { scale: Math.min(2, 4000 / (maxX - minX)), own });
      lgaMesh.material.map?.dispose();
      const texture = new THREE.DataTexture(image.data, image.width, image.height, THREE.RGBAFormat);
      texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearFilter; texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = true; texture.needsUpdate = true;
      lgaMesh.material.map = texture; lgaMesh.material.needsUpdate = true;
      changed = true;
    }
    return changed;
  }

  let time = 'day';
  const presets: Readonly<Record<string, TimePreset | undefined>> = CITY_LIGHT;
  return {
    group, places, materials, pack,
    get triangles() { return triangles; },
    counts: { houses: fabric.houses.length, towers: fabric.towers.length, trees: fabric.trees.length, palms: fabric.palms.length, vehicles: traffic.length, shadows: shadows.length },
    get time() { return time; },
    setHome, setLgas, fronts,
    /** Choose the level of detail for a camera this far away: the fabric is drawn near, and left out when the whole state is in view. True when it changed. */
    setDetail(distance: number, far = FABRIC_FAR) {
      const on = distance < far;
      if (on === fabricOn) return false;
      fabricOn = on;
      for (const mesh of fabricMeshes) mesh.visible = on && mesh.count > 0;
      return true;
    },
    /** Lighting that belongs to the city's own materials. The host applies hemi, sun and sky. */
    setTime(next: string) {
      const preset = presets[next] || CITY_LIGHT.day;
      time = presets[next] ? next : 'day';
      materials.water.color.set(pack.inland ? '#bcd596' : preset.water); materials.windows.color.set(preset.windows);
      materials.waves.opacity = preset.waves; materials.shadow.opacity = preset.shadow;
      return preset;
    },
    setTraffic(on: boolean) { if (trafficOn === Boolean(on)) return false; trafficOn = Boolean(on); placeTraffic(0); return true; },
    get traffic() { return trafficOn; },
    /** Only ever called from a running frame loop: nothing here moves while the map is idle. */
    animate(seconds: number) {
      waves.position.x = Math.sin(seconds * 0.5) * 0.9; waves.position.z = Math.cos(seconds * 0.37) * 0.35; waves.updateMatrix();
      if (trafficOn) placeTraffic(seconds);
    },
    dispose() {
      lgaMesh?.material.map?.dispose();
      for (const thing of own) thing.dispose?.();
      group.parent?.remove(group);
      own.length = 0;
    },
  };
}
