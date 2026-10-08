import type { SourceRecord } from './types.ts';
import type { Admin1PartitionIndexEntry } from './admin1-types.ts';

/** Distinct structural geographic foundation; not fine-v2 or playable content. */
export const ADMIN1_PRODUCT = 'natural-earth-admin1-partitions-v1' as const;
export const ADMIN1_PRODUCT_LIMITS = Object.freeze({
  manifestBytes: 256 * 1024, countryIndexBytes: 256 * 1024,
  globalIndexBytes: 2 * 1024 * 1024, reportBytes: 2 * 1024 * 1024,
  partitionBytes: 1024 * 1024, partitionFeatures: 64,
  sourceUnits: 10_000, countries: 10_000, partitions: 512,
  partitionPositions: 150_000, featurePositions: 100_000,
  logicalBytes: 96 * 1024 * 1024, treeBytes: 128 * 1024 * 1024,
  treeEntries: 2048, treeDepth: 5,
  auditBytes: 1024 * 1024, auditEntries: 128, auditRecordBytes: 8 * 1024,
  attemptsPerRequest: 8, durationMs: 120_000, rssBytes: 512 * 1024 * 1024,
  freeBytes: 100 * 1024 * 1024, cacheBytes: 5 * 1024 * 1024,
});
export interface Admin1AssetRef { path: string; sha256: string; bytes: number }
export interface Admin1CountryRef {
  countryId: string;
  status: 'available' | 'missing' | 'protected';
  sourceUnits: number; emittedUnits: number;
  index: Admin1AssetRef | null;
}
export interface Admin1ProductManifest {
  schemaVersion: 1; product: typeof ADMIN1_PRODUCT;
  source: SourceRecord;
  parent: { manifestHash: string; source: SourceRecord };
  validation: { structural: 'passed-with-explicit-exceptions'; topology: 'unverified' };
  sourceUnits: number; sourcePositions: number; sourcePolygons: number;
  linked: number; protected: number; unlinked: number; ambiguous: number;
  emittedUnits: number; exceptionUnits: number;
  inspection: Admin1AssetRef; globalIndex: Admin1AssetRef;
  partitions: Admin1AssetRef[]; countries: Admin1CountryRef[];
  limitations: string[];
}
export interface Admin1CountryIndexRow extends Admin1PartitionIndexEntry {
  name: string | null; sourceType: string | null; sourceTypeEn: string | null;
  gadmLevel: number | null; positions: number; polygons: number;
}
export interface Admin1CountryIndex {
  schemaVersion: 1; product: typeof ADMIN1_PRODUCT;
  countryId: string; sourceSha256: string; parentManifestHash: string;
  inspectionSha256: string;
  sourceUnits: number; emittedUnits: number;
  rows: Admin1CountryIndexRow[];
}
export interface Admin1Partition {
  schemaVersion: 1; product: typeof ADMIN1_PRODUCT;
  parentCountryId: string | null;
  joinStatus: 'linked' | 'unlinked' | 'ambiguous';
  features: Array<Record<string, unknown>>;
}
export interface Admin1PublishedResult {
  manifestHash: string; manifestPath: string; bytes: number;
  sourceUnits: number; emittedUnits: number; partitions: number;
  elapsedMs: number; networkBytes: 0;
}
