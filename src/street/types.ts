export type SourceKind = 'mapped' | 'authored' | 'generated'
export interface TileCoord { x: number; z: number }
export interface MetrePoint { x: number; z: number }
export type DoorTarget = { kind: 'venue'; venue: string } | { kind: 'estate'; lga: string; estate: number }
export interface StreetDoor { id: string; target: DoorTarget; at: MetrePoint; approach: MetrePoint; source: 'generated' }
export interface TileRoad { id: string; name: string; source: SourceKind; width: number; bridge: boolean; points: MetrePoint[] }
export interface TileBuilding { id: string; source: 'generated-fabric' | 'generated-venue'; height: number; footprint: MetrePoint[] }
/** Centimetres relative to the tile origin; ground is a 64 by 64 bit mask in row order. */
export interface WireStreetTile {
  v: 1; city: string; version: string; tile: [number, number];
  ground: number[];
  roads: { id: string; name: string; source: SourceKind; width: number; bridge: boolean; points: number[] }[];
  buildings: { id: string; source: TileBuilding['source']; height: number; footprint: number[] }[];
  doors: { id: string; target: DoorTarget; at: [number, number]; approach: [number, number]; source: 'generated' }[];
}
export interface StreetTile { city: string; version: string; tile: TileCoord; origin: MetrePoint; ground: Uint32Array; roads: TileRoad[]; buildings: TileBuilding[]; doors: StreetDoor[] }
export interface GenerationIssue { code: 'invalid-road' | 'missing-site' | 'disconnected-door' | 'missing-frame'; id: string; detail: string }
export interface EstateGateSeed { lga: string; estate: number; point: MetrePoint }
export interface EstatePortalMapping { lga: string; estate: number; requested: MetrePoint; anchor: MetrePoint; roadId: string; roadLga: string | null; crossLga: boolean; displacementMetres: number }
export interface StreetSource {
  city: string; version: string; tiles: readonly TileCoord[]; doors: readonly StreetDoor[]; issues: readonly GenerationIssue[]; portals?: readonly EstatePortalMapping[];
  tile(at: TileCoord): WireStreetTile;
  route(from: string, to: string): MetrePoint[] | null;
}
export interface StreetPack { v: 1; city: string; version: string; tiles: { key: string; wire: WireStreetTile }[] }
export interface StreetManifest {
  v: 1; city: string; version: string; tileSize: 128; quantum: 100; groundCell: 2;
  mapFrame: { origin: { x: number; z: number }; unitsPerKm: number };
  tiles: { tile: TileCoord; file: string; rawBytes: number; brotliBytes: number; sha256: string; estimatedTriangles: number; packKey?: string; packSha256?: string }[];
  issues: readonly GenerationIssue[];
  doors: (StreetDoor & { tile: TileCoord })[];
}

/** Public, validated cursor returned by the authoritative street routes. */
interface StreetJourneyBase { id: string; city: string; version: string; anchor: { lga: string; estate: number; plot: number }; point: MetrePoint; seq: number; acceptedAt: number; credit: number }
export type StreetJourney =
  | (StreetJourneyBase & { kind: 'walking' })
  | (StreetJourneyBase & { kind: 'venue'; venue: string; door: string })
  | (StreetJourneyBase & { kind: 'estate'; estatePosition: MetrePoint })
