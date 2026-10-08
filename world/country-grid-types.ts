import type { Bounds, Position, SourceRecord } from './types.ts';
import type { InventoryNode } from './production-types.ts';

/** Geographic candidates are a frozen build denominator, not acquired/explorable geometry. */
export const COUNTRY_GRID_COMPILER = 'country-source-cut-grid-v1' as const;
export const COUNTRY_GRID_LIMITS = Object.freeze({ requestBytes: 16_000, boundaryBytes: 2_097_152, positions: 100_000,
  bboxCells: 300_000, cells: 100_000, operations: 100_000_000, outputBytes: 16_000_000, durationMs: 60_000, rssBytes: 768 * 1024 * 1024 });
export interface CountryGridRequest {
  schemaVersion: 1; id: string; directoryManifestHash: string; countryId: string;
  /** Degree step = 1 / 2**level. Initial country denominator uses level 1 (0.5 degree). */
  level: number;
  limits: { positions: number; bboxCells: number; cells: number; operations: number; outputBytes: number };
}
export interface CountryGridPin { path: string; sha256: string; bytes: number }
export interface CountryGridBoundary {
  directoryManifestHash: string; node: InventoryNode; source: SourceRecord;
  /** All paths relative to the country directory root, preserving original indexed part order. */
  pins: { manifest: CountryGridPin; node: CountryGridPin; outlineIndex: CountryGridPin; parts: CountryGridPin[] };
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
}
export interface GeographicGridCell { id: string; level: number; column: number; row: number; bounds: Bounds }
export interface CountryGridCell extends GeographicGridCell {
  /** Source polygon indices, including boundary-only contacts; not spherical/official membership. */
  polygonIndices: number[]; state: 'not-started';
}
export interface CountryGridPlan {
  schemaVersion: 1; compilerVersion: typeof COUNTRY_GRID_COMPILER; requestHash: string; request: CountryGridRequest;
  country: InventoryNode; source: SourceRecord; boundaryPins: CountryGridBoundary['pins'];
  geographicCoverage: 'source-bound-grid-denominator'; geometryCoverage: 'not-acquired';
  selection: 'inclusive-planar-source-cut-polygon-cell-contact';
  ownership: 'global-half-open-grid-seam-pole-v1';
  grid: { level: number; stepDegrees: number; columns: number; rows: number };
  cells: CountryGridCell[];
  counts: { polygons: number; positions: number; bboxCandidates: number; selectedCells: number; operations: number };
  limitations: string[];
}
export interface CountryGridProduct { plan: CountryGridPlan; bytes: Uint8Array; sha256: string }
export interface CountryGridPublished {
  plan: CountryGridPlan; planPath: string; planHash: string; bytes: number; cacheHit: boolean;
  completion: CountryGridPin; networkBytes: 0;
}
export type CountryGridPosition = Position;
