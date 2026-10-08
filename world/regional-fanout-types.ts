import type { Bounds, Position, Region } from './types.ts';
import type { WorldPlan } from './pipeline.ts';

/** Additive local product; existing acquisition, pack and campaign identities stay unchanged. */
export interface RegionalFanoutRequest {
  schemaVersion: 1;
  id: string;
  inventoryHash: string;
  inventoryUnitId: string;
  parentPlan: WorldPlan;
  parentAcquisition: { requestHash: string; receipt: { path: string; sha256: string; bytes: number } } | null;
  children: Region[];
  limits: { inputBytes: number; features: number; coordinates: number; children: number; outputBytes: number };
}
export interface RegionalInputRef { path: string; sha256: string; bytes: number }
export interface RegionalFeatureRow {
  key: string;
  featureId: string;
  featureSha256: string;
  sourceOrdinals: number[];
  kind: 'building' | 'road' | 'unsupported';
  partIds: string[];
  ownerPoint: Position | null;
  ownerCellId: string | null;
  status: 'owned' | 'outside-denominator' | 'unsupported';
  bounds: Bounds | null;
  /** Conservative whole-feature bounding-box candidates, not exact geometry intersections. */
  touchingCellIds: string[];
}
export interface RegionalCellRow {
  region: Region;
  status: 'owned-features' | 'empty-owned';
  ownedFeatureKeys: string[];
  touchingFeatureKeys: string[];
  /** Distinct sorted owner CELL ids for touching geometry stored in another child. */
  ownerDependencies: string[];
  unresolvedFeatureKeys: string[];
  input: RegionalInputRef;
  /** Relative input path resolves inside the published fan-out output directory. */
  plan: WorldPlan;
}
export interface RegionalFanoutIndex {
  schemaVersion: 1;
  compilerVersion: 'regional-whole-feature-fanout-v1';
  requestHash: string;
  request: RegionalFanoutRequest;
  coverage: 'foundation';
  ownership: 'lexicographic-source-vertex-closed-cell-id-tie-v1';
  intersection: 'conservative-feature-bounds';
  features: RegionalFeatureRow[];
  cells: RegionalCellRow[];
  counts: { sourceRows: number; uniqueFeatures: number; duplicateRows: number; owned: number; outsideDenominator: number; unsupported: number; emittedParts: number; coordinates: number };
  limitations: string[];
}
export interface RegionalFanoutProduct {
  index: RegionalFanoutIndex;
  indexBytes: Uint8Array;
  indexHash: string;
  inputs: Array<{ ref: RegionalInputRef; bytes: Uint8Array }>;
  logicalBytes: number;
}
export interface RegionalFanoutPublishOptions {
  /** Canonical dedicated root: production .cache/world-build, or an isolated temporary root. */
  allowedRoot: string;
  /** Dedicated output descendant of allowedRoot. */
  outputRoot: string;
  durationMs: number;
  memoryMb: number;
  signal?: AbortSignal;
}
export interface RegionalFanoutPublished {
  index: RegionalFanoutIndex;
  indexHash: string;
  indexPath: string;
  logicalBytes: number;
  plans: WorldPlan[];
  /** Immutable completion receipt detects a previously published index that later disappears. */
  publication: { path: string; sha256: string; bytes: number };
  networkBytes: 0;
}
