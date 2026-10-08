/** Independent world-data contract. No imports from the game or its database. */
export type Position = [longitude: number, latitude: number];
/** West > east denotes a bounds crossing the antimeridian. */
export type Bounds = [west: number, south: number, east: number, north: number];
export interface Anchor { longitude: number; latitude: number; height: number }
export interface SourceRecord {
  id: string; url: string; release: string; license: string; attribution: string;
  sha256: string; bytes: number;
}
export interface Region {
  id: string; parentId: string | null; name: string;
  kind: 'continent' | 'country' | 'admin' | 'city' | 'cell';
  countryCode: string | null; timezone: string | null; bounds: Bounds;
}
export interface Building {
  id: string; sourceId: string; rings: Position[][];
  heightM: number; heightKind: 'source' | 'estimated';
}
export interface Road {
  id: string; sourceId: string; points: Position[];
  class: string; level: number;
}
export interface WorldTile {
  schemaVersion: 1; id: string; regionId: string; bounds: Bounds;
  anchor: Anchor; buildings: Building[]; roads: Road[];
}
export interface TileRef {
  id: string; path: string; sha256: string; bytes: number; brotliBytes: number;
  triangles: number; drawCalls: number; bounds: Bounds;
}
export interface ClimateMonth {
  temperatureC: number; relativeHumidityPct: number; precipitationMm: number; windMps: number;
}
export interface ClimateProfile {
  sourceId: string; period: string; months: ClimateMonth[];
}
export interface WorldManifest {
  schemaVersion: 1; compilerVersion: string; region: Region;
  frame: 'wgs84-enu-m-v1'; verticalDatum: 'WGS84-ellipsoid';
  coverage: 'foundation' | 'explorable'; exceptions: string[];
  sources: SourceRecord[]; tiles: TileRef[]; climate: ClimateProfile | null;
}
export const WORLD_LIMITS = Object.freeze({
  tileBrotliBytes: 60_000, tileTriangles: 25_000,
  visibleTriangles: 90_000, visibleDrawCalls: 40,
  bootstrapBrotliBytes: 250_000, maxFetches: 2, cacheBytes: 50_000_000,
});
