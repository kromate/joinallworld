/** Geometry primitives shared by the generated UNILAG map and its consumers. */
export type MetrePoint = readonly [x: number, z: number];
export type MetreRing = readonly MetrePoint[];
export type MetreBounds = readonly [minX: number, minZ: number, maxX: number, maxZ: number];

export interface OsmRef {
  readonly type: 'node' | 'way';
  readonly id: number;
  readonly version: number;
  readonly timestamp: string;
}

export interface CampusMapBuilding {
  readonly id: string;
  readonly osm: OsmRef;
  readonly name?: string;
  readonly ring: MetreRing;
  readonly height: number;
  readonly heightSource: 'height' | 'levels' | 'estimated';
}

export interface CampusMapRoad {
  readonly id: string;
  readonly osm: OsmRef;
  readonly name?: string;
  readonly highway: string;
  readonly points: readonly MetrePoint[];
  readonly width: number;
  readonly widthSource: 'width' | 'lanes' | 'estimated';
}

export interface CampusMapPoi {
  readonly id: string;
  readonly osm: OsmRef;
  readonly name: string;
  readonly point: MetrePoint;
  readonly tags: Readonly<Record<string, string>>;
}

export interface CampusMapSurface {
  readonly id: string;
  readonly osm: OsmRef;
  readonly kind: 'water' | 'wetland' | 'pool' | 'pitch' | 'sports';
  readonly name?: string;
  readonly sport?: string;
  readonly ring: MetreRing;
}

export interface CampusMapData {
  readonly schemaVersion: 1;
  readonly source: Readonly<{ attribution: string; license: string; snapshot: string; boundary: OsmRef }>;
  readonly origin: Readonly<{ latitude: number; longitude: number; label: string; source: string }>;
  readonly bounds: MetreBounds;
  readonly boundary: MetreRing;
  readonly buildings: readonly CampusMapBuilding[];
  readonly roads: readonly CampusMapRoad[];
  readonly surfaces: readonly CampusMapSurface[];
  readonly pois: readonly CampusMapPoi[];
}

/** Standard even-odd point-in-polygon test; boundary points count as inside. */
export function pointInRing(point: MetrePoint, ring: MetreRing): boolean {
  const [x, z] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i]!, [xj, zj] = ring[j]!;
    const cross = (x - xi) * (zj - zi) - (z - zi) * (xj - xi);
    if (Math.abs(cross) < 1e-7 && x >= Math.min(xi, xj) && x <= Math.max(xi, xj)
      && z >= Math.min(zi, zj) && z <= Math.max(zi, zj)) return true;
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function boundsOf(points: readonly MetrePoint[]): MetreBounds {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z] of points) { minX = Math.min(minX, x); minZ = Math.min(minZ, z); maxX = Math.max(maxX, x); maxZ = Math.max(maxZ, z); }
  return [minX, minZ, maxX, maxZ];
}
