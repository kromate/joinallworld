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

export interface FineInventory {
  schemaVersion: 1;
  coarseInventoryHash: string;
  countryId: string;
  source: FineSourcePin;
  nodes: FineAdminNode[];
  outlines: Array<{ nodeId: string; geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown } }>;
  registry: FineIdentityRegistry;
  coverage: FineCoverage;
}

export const FINE_LIMITS = Object.freeze({
  sourceBytes: 8 * 1024 * 1024,
  units: 32,
  coordinatePositions: 150_000,
  featurePositions: 40_000,
  publishedBytes: 16 * 1024 * 1024,
});
