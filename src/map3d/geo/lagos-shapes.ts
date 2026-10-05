/**
 * OWNER: world
 * The real shapes of Lagos State: its 20 local governments, its outline and the Lagos Lagoon, as lon/lat rings.
 * Pure — no Three.js, no DOM. Decodes ./data/lagos.ts synchronously and caches the result.
 *
 * LOAD RULE  ./data/lagos.ts is a data chunk (about 14 kB). Import this module only from code that is itself loaded
 * lazily (the Lagos city map), never from the first-paint bundle.
 *
 * WATER RULE  the local governments are LAND ONLY: the Lagos Lagoon (and the east Lekki Lagoon) are the gaps between
 * them. Water in the city is anything not covered by a local government. `lagoon` is the part of that gap inside the State
 * outline, derived for convenience; the State outline itself includes the lagoon.
 *
 * Project with ./frame.ts (project / toLocal with ORIGINS.lagos).
 */
import { LAGOS } from './data/lagos.ts';
import { decodeTopology } from './topo.ts';

/** A polygon: [outer ring, ...holes]. Each ring is a list of [lon, lat] in degrees, not repeated at the end (closing is implied). */
export type LonLatPolygon = Array<Array<[number, number]>>;

export interface LagosShapes {
  /** Local governments by game id (see LAGOS_LGAS in src/game/content/world.ts): 20 entries. */
  lgas: Record<string, LonLatPolygon[]>;
  /** The Lagos State outline (includes the Lagos Lagoon). */
  state: LonLatPolygon[];
  /** Derived water: the State outline minus the 20 local governments. */
  lagoon: LonLatPolygon[];
}

const toPolygons = (rings: Float64Array[][]): LonLatPolygon[] =>
  rings.map((poly) => poly.map((ring) => Array.from({ length: ring.length / 2 }, (_, i): [number, number] => [ring[i * 2]!, ring[i * 2 + 1]!])));

let cached: LagosShapes | undefined;

/** The decoded shapes. The arrays are shared: do not modify them. */
export function lagosShapes(): LagosShapes {
  if (cached) return cached;
  const topology = decodeTopology(LAGOS), lgas: Record<string, LonLatPolygon[]> = {};
  let state: LonLatPolygon[] = [], lagoon: LonLatPolygon[] = [];
  for (const feature of topology.features) {
    if (feature.id === 'lagos-state') state = toPolygons(feature.rings);
    else if (feature.id === 'lagoon') lagoon = toPolygons(feature.rings);
    else lgas[feature.id] = toPolygons(feature.rings);
  }
  cached = { lgas, state, lagoon };
  return cached;
}
