/**
 * OWNER: world
 * WHERE EVERY HOUSE STANDS — computed from the city pack alone.
 *
 * A local government has 512 estates of 14 streets × 14 plots (src/game/content/world.ts). The
 * server hands out addresses (`lga/estate/street/plot`) and never positions; this file turns an
 * address into a point on the map, the same way on every device and in both maps, so a street of
 * houses can be drawn without fetching anything about the houses that are not there.
 *
 *   estateLayout(pack, lgaId) → { id, size, front, cells: [{ x, z, size }] × 512, pitch(estate), plot(estate, plot) → { x, z }, estateAt(x, z) }
 *     Estate 1 is one big square near the name plate (`front` units a side): the first 196
 *     residents live where their houses can be seen from across the district. The other 511 are
 *     a square lattice just fine enough (`size` a side) that every one lies wholly on the local
 *     government's buildable land — clear of the venues, the home lots, the coming-soon zones and
 *     the roads — numbered outwards from the first, so the growing edge spreads from the middle.
 *   plotAt(layout, x, z)      → { estate, plot } under the point, or null
 * Pure maths: no Three.js, no DOM. Layouts are cached per pack.
 */
import { ESTATE } from '../game/content/world.ts';
import { landOf, scan } from './lga.ts';
import type { CityPack, PackLga, Point2, Rect, XZ } from './types.ts';

/** One estate's square on the map: its centre and its side. */
export interface EstateCell { x: number; z: number; size: number }
/** Where every house of one local government stands; see the header. */
export interface EstateLayout {
  id: string
  /** The side of the compact estates' lattice. */
  size: number
  /** The side of the first, big estate. */
  front: number
  cells: EstateCell[]
  /** The distance between two plots of an estate. */
  pitch: (estate: number) => number
  /** Where a plot is: streets run west–east, street 1 at the north side; plots count from the west. */
  plot: (estate: number, plot: number) => XZ
  /** The estate whose square contains the point, or -1. */
  estateAt: (x: number, z: number) => number
}
/** An address on the map: an estate and a plot of it (plot -1 on the verge of an estate). */
export interface PlotRef { estate: number; plot: number }
interface Grid { width: number; height: number; owner: Uint8Array; x0: number; z0: number }
type Sampler = (x: number, z: number) => boolean;

const cache = new WeakMap<CityPack, Map<string, EstateLayout>>();
const FRONT = 15;            // the side of a local government's first estate, where the land allows
const FILL = 0.9;            // the share of an estate's square its plots cover (the rest is the verge between estates)

const SCALE = 4;             // cells of the buildable-land grid per map unit
const grids = new WeakMap<CityPack, Grid>();
/**
 * The city as a grid: for every quarter-unit cell, the local government it belongs to if a house
 * may stand there (0 otherwise: water, sand, a venue's lot, a coming-soon zone, a road). Built once
 * per pack with scan-line fills, so laying out twenty local governments costs milliseconds.
 */
function gridOf(pack: CityPack): Grid {
  if (grids.has(pack)) return grids.get(pack)!;
  const { minX, maxX, minZ, maxZ } = pack.bounds, cell = 1 / SCALE;
  const width = Math.ceil((maxX - minX) * SCALE), height = Math.ceil((maxZ - minZ) * SCALE);
  const land = new Uint8Array(width * height), owner = new Uint8Array(width * height);
  const paint = (target: Uint8Array, value: number) => (row: number, from: number, to: number) => target.fill(value, row * width + from, row * width + to + 1);
  for (const entry of landOf(pack)) if (entry.kind !== 'sand') scan(entry.polygon, minX, minZ, cell, width, height, paint(land, 1));
  const box = (x0: number, z0: number, x1: number, z1: number): [number, number][] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  for (const zone of pack.zones || []) scan(box(zone[0], zone[1], zone[2], zone[3]), minX, minZ, cell, width, height, paint(land, 0));
  for (const spot of [...Object.values<XZ>(pack.sites || {}), ...Object.values<XZ>(pack.homes || {})]) scan(box(spot.x - 4.6, spot.z - 4.6, spot.x + 4.6, spot.z + 4.6), minX, minZ, cell, width, height, paint(land, 0));
  for (const road of pack.roads || []) {
    if (road.bridge) continue;
    const half = (road.major ? 1.25 : 0.9) + 0.7;
    for (let i = 1; i < road.points.length; i++) {
      const [ax, az] = road.points[i - 1]!, [bx, bz] = road.points[i]!, length = Math.hypot(bx - ax, bz - az) || 1, nx = (-(bz - az) / length) * half, nz = ((bx - ax) / length) * half;
      const ex = ((bx - ax) / length) * half, ez = ((bz - az) / length) * half;
      scan([[ax - ex + nx, az - ez + nz], [bx + ex + nx, bz + ez + nz], [bx + ex - nx, bz + ez - nz], [ax - ex - nx, az - ez - nz]], minX, minZ, cell, width, height, paint(land, 0));
    }
  }
  pack.lgas.forEach((lga, index) => scan(lga.polygon, minX, minZ, cell, width, height, (row, from, to) => { for (let i = row * width + from; i <= row * width + to; i++) if (land[i] && !owner[i]) owner[i] = index + 1; }));
  const grid = { width, height, owner, x0: minX, z0: minZ };
  grids.set(pack, grid);
  return grid;
}

const sampler = (grid: Grid, id: number): Sampler => (x: number, z: number) => { const col = Math.floor((x - grid.x0) * SCALE), row = Math.floor((z - grid.z0) * SCALE); return col >= 0 && row >= 0 && col < grid.width && row < grid.height && grid.owner[row * grid.width + col] === id; };
/** Is the whole square (centre x, z; side `size`) this local government's buildable land? */
function squareFree(mine: Sampler, x: number, z: number, size: number): boolean {
  const steps = Math.max(2, Math.ceil(size * SCALE)), inset = (size / 2) * 0.96;
  for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps; j++) if (!mine(x - inset + (2 * inset * i) / steps, z - inset + (2 * inset * j) / steps)) return false;
  return true;
}
const boundsOf = (polygon: readonly Point2[]): Rect => { const xs = polygon.map((point) => point[0]), zs = polygon.map((point) => point[1]); return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }; };

/**
 * ESTATE 1 IS THE SHOW ESTATE: one big square near the name plate, where the first 196 residents
 * live in houses large enough to be seen from a street away. It is as big as the land allows
 * (up to FRONT units a side). The other 511 estates are the compact lattice around it.
 */
function frontFor(lga: PackLga, mine: Sampler): EstateCell | null {
  const { minX, maxX, minZ, maxZ } = boundsOf(lga.polygon), [px, pz] = lga.plate;
  for (let size = FRONT; size >= 3; size *= 0.9) {
    let best: { x: number; z: number; size: number; far: number } | null = null;
    for (let z = minZ + size / 2; z <= maxZ - size / 2; z += size / 4) for (let x = minX + size / 2; x <= maxX - size / 2; x += size / 4) {
      const far = Math.hypot(x - px, z - pz);
      if ((!best || far < best.far) && squareFree(mine, x, z, size)) best = { x, z, size, far };
    }
    if (best) return { x: best.x, z: best.z, size: best.size };
  }
  return null;
}
function cellsFor(lga: PackLga, size: number, mine: Sampler, front: EstateCell | null, want: number): EstateCell[] | null {
  const { minX, maxX, minZ, maxZ } = boundsOf(lga.polygon), half = size / 2, cells: EstateCell[] = [], gap = front ? front.size / 2 + half + 0.4 : 0;
  for (let z = minZ + half; z + half <= maxZ + 1e-9; z += size) for (let x = minX + half; x + half <= maxX + 1e-9; x += size) {
    if (front && Math.abs(x - front.x) < gap && Math.abs(z - front.z) < gap) continue;
    if (squareFree(mine, x, z, size)) cells.push({ x, z, size });
  }
  return cells.length >= want ? cells : null;
}

export function estateLayout(pack: CityPack, lgaId: string): EstateLayout | null {
  let layouts = cache.get(pack);
  if (!layouts) cache.set(pack, layouts = new Map<string, EstateLayout>());
  if (layouts.has(lgaId)) return layouts.get(lgaId)!;
  const lga = pack.lgas?.find((item) => item.id === lgaId);
  if (!lga) return null;
  const mine = sampler(gridOf(pack), pack.lgas.indexOf(lga) + 1), want = ESTATE.estates - 1;
  const front = frontFor(lga, mine);
  if (!front) throw new Error(`The land of ${lgaId} has no room for its first estate`);
  let size = 4, cells: EstateCell[] | null = null;
  // The coarsest lattice that still gives every other estate its own square.
  for (; size > 0.3 && !cells; size *= 0.94) cells = cellsFor(lga, size, mine, front, want);
  if (!cells) throw new Error(`The land of ${lgaId} cannot hold ${ESTATE.estates} estates`);
  size /= 0.94;
  cells.sort((a, b) => Math.hypot(a.x - front.x, a.z - front.z) - Math.hypot(b.x - front.x, b.z - front.z) || a.z - b.z || a.x - b.x);
  cells.length = want;
  cells.unshift(front);
  const key = (x: number, z: number) => `${Math.round((x / size) * 2)}:${Math.round((z / size) * 2)}`;
  const index = new Map<string, number>(cells.slice(1).map((cell, i): [string, number] => [key(cell.x, cell.z), i + 1]));
  const anchor = cells[1]!;
  const layout: EstateLayout = {
    id: lgaId, size, front: front.size, cells,
    /** The distance between two plots of an estate. */
    pitch: (estate) => (cells![estate]!.size * FILL) / ESTATE.plots,
    /** Where a plot is: streets run west–east, street 1 at the north side; plots count from the west. */
    plot(estate, plot) {
      const cell = cells![estate]!, pitch = (cell.size * FILL) / ESTATE.plots, origin = -(cell.size * FILL) / 2 + pitch / 2;
      return { x: cell.x + origin + (plot % ESTATE.plots) * pitch, z: cell.z + origin + Math.floor(plot / ESTATE.plots) * pitch };
    },
    /** The estate whose square contains the point, or -1. */
    estateAt(x, z) {
      if (Math.abs(x - front.x) <= front.size / 2 && Math.abs(z - front.z) <= front.size / 2) return 0;
      // The compact estates sit on a lattice of step `size`, so the nearest lattice point is found without a search.
      const gx = anchor.x + Math.round((x - anchor.x) / size) * size, gz = anchor.z + Math.round((z - anchor.z) / size) * size;
      const found = index.get(key(gx, gz));
      return found === undefined || Math.abs(x - gx) > size / 2 || Math.abs(z - gz) > size / 2 ? -1 : found;
    },
  };
  layouts.set(lgaId, layout);
  return layout;
}

export const estateAt = (layout: EstateLayout, x: number, z: number) => layout.estateAt(x, z);
/** The plot under a point: { estate, plot } (plot −1 on the verge of an estate), or null off every estate. */
export function plotAt(layout: EstateLayout, x: number, z: number): PlotRef | null {
  const estate = layout.estateAt(x, z);
  if (estate < 0) return null;
  const cell = layout.cells[estate]!, pitch = layout.pitch(estate), span = pitch * ESTATE.plots;
  const col = Math.floor((x - (cell.x - span / 2)) / pitch), row = Math.floor((z - (cell.z - span / 2)) / pitch);
  if (col < 0 || col >= ESTATE.plots || row < 0 || row >= ESTATE.streets) return { estate, plot: -1 };
  return { estate, plot: row * ESTATE.plots + col };
}
