import type { Bounds, SourceRecord } from './types.ts';

/** Separate administrative directory; coarse country IDs and schema stay unchanged. */
export interface FineSourcePin {
  schemaVersion: 1;
  provider: 'geoBoundaries';
  source: SourceRecord;
  input: string;
  countryCode: string;
  countryIso3: string;
  adminLevel: 'ADM1';
  layerId: string;
  canonicalType: string;
  representedYear: string;
  buildDate: string;
  expectedUnits: number;
  originalLicense: string;
  licenseEvidence: string[];
  metadataSha256: string;
  metadataBytes: number;
  boundaryPolicy: string;
}

export interface FineIdentityEntry {
  id: string;
  sourceFeatureKeys: string[];
  names: string[];
  status: 'active' | 'retired';
  replacedBy: string[];
}

/** Retains provider keys; release-qualified references remain on nodes and immutable manifests. */
export interface FineIdentityRegistry {
  schemaVersion: 1;
  provider: 'geoBoundaries';
  countryId: string;
  adminLevel: 'ADM1';
  entries: FineIdentityEntry[];
}

/** Explicit mappings are required when provider keys change, units split or units merge. */
export interface FineIdentityMigration {
  assignments: Record<string, string>;
  retirements: Array<{ id: string; replacedBy: string[] }>;
}

export interface FineAdminNode {
  id: string;
  parentId: string;
  countryCode: string;
  name: string;
  kind: 'admin';
  adminLevel: 'ADM1';
  adminType: string;
  bounds: Bounds;
  aliases: string[];
  sourceRef: { sourceId: string; release: string; layerId: string; featureKey: string };
  coverage: 'geographic-outline';
  exceptions: string[];
}

export interface FineCoverage {
  expectedUnits: number;
  sourceUnits: number;
  acceptedUnits: number;
  rejectedUnits: number;
  coordinatePositions: number;
  exceptions: string[];
}

/** Hash-bound planar topology evidence; higher dimensions and spherical validity remain outside its scope. */
export interface FineTopologyReport {
  schemaVersion: 1;
  validator: 'duckdb-spatial-ogc-planar-v1';
  sourceSha256: string;
  sourceBytes: number;
  expectedUnits: number;
  checkedUnits: number;
  validUnits: number;
  invalidUnits: number;
  unsupportedUnits: number;
  tooling: {
    duckdbVersion: '1.5.6';
    spatialVersion: '04270fe';
    spatialSha256: 'e326286e0ff4651680bfa2918fb22990fed50cb7d27d79dd21143ac7e74b0da9';
  };
  rows: Array<{ featureKey: string; status: 'valid' | 'invalid' | 'unsupported'; valid: boolean | null; empty: boolean | null; reason: string | null }>;
  exceptions: string[];
}

export interface FineInventory {
  schemaVersion: 2;
  compiler: 'fine-inventory-compiler-v2';
  coarseInventoryHash: string;
  countryId: string;
  source: FineSourcePin;
  nodes: FineAdminNode[];
  outlines: Array<{ nodeId: string; geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown } }>;
  registry: FineIdentityRegistry;
  coverage: FineCoverage;
  topology: FineTopologyReport;
}

export const FINE_LIMITS = Object.freeze({
  sourceBytes: 8 * 1024 * 1024,
  units: 32,
  coordinatePositions: 150_000,
  featurePositions: 40_000,
  publishedBytes: 16 * 1024 * 1024,
});
