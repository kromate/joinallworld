import type { SourceRecord } from './types.ts';
import type { InventoryNode } from './production-types.ts';

/** Separate Natural Earth foundation product; existing fine/legacy providers are immutable. */
export const ADMIN1_LIMITS = Object.freeze({
  sourceBytes: 64 * 1024 * 1024, parentSourceBytes: 16 * 1024 * 1024,
  features: 10_000, positions: 3_000_000, featurePositions: 100_000,
  propertiesBytes: 16 * 1024, assetBytes: 1024 * 1024, assetFeatures: 64,
  assets: 512, indexBytes: 2 * 1024 * 1024, manifestBytes: 256 * 1024,
  outputBytes: 96 * 1024 * 1024, reportBytes: 2 * 1024 * 1024,
  durationMs: 120_000, rssBytes: 512 * 1024 * 1024, freeBytes: 100 * 1024 * 1024,
});
export interface Admin1CaptureSpec {
  schemaVersion: 1; provider: 'natural-earth'; release: string; resolution: '10m';
  metadataPath: '.cache/world-build/evidence/admin1-resolution-research/source-api.json';
  metadataSha256: string; metadataBytes: number; expectedBytes: number;
  expectedGitBlobSha1: string; license: 'Public-domain'; attribution: string;
}
export interface Admin1CaptureResult {
  source: SourceRecord; input: string; inputPath: string; receiptPath: string;
  cacheHit: boolean; networkBytes: number; requestHash: string;
}
export interface Admin1SourcePin { schemaVersion: 1; source: SourceRecord; input: string; gitBlobSha1: string }
export interface Admin1ParentPin {
  manifestHash: string;
  directoryRoot: '.cache/world-build/output/country-inventory';
  source: SourceRecord; input: string;
}
export interface Admin1BuildInput {
  source: SourceRecord; raw: Uint8Array;
  parent: { manifestHash: string; source: SourceRecord; raw: Uint8Array; nodes: InventoryNode[] };
}
export type Admin1JoinStatus = 'linked' | 'protected' | 'unlinked' | 'ambiguous';
export interface Admin1AuditRow {
  sourceOrdinal: number; sourceKey: string; id: string; featureSha256: string;
  adm0Code: string | null; countryId: string | null; joinStatus: Admin1JoinStatus;
  positions: number; polygons: number; featureBytes: number; propertiesBytes: number;
  geometryIssue: string | null;
}
export interface Admin1InspectionReport {
  schemaVersion: 1; inspector: 'natural-earth-admin1-structural-v1';
  source: SourceRecord; parent: { manifestHash: string; source: SourceRecord };
  sourceUnits: number; sourcePositions: number; sourcePolygons: number;
  linked: number; protected: number; unlinked: number; ambiguous: number;
  geometryExceptions: number; largestFeatureBytes: number; largestFeaturePositions: number;
  countries: Array<{ countryId: string; units: number }>;
  missingCountries: string[]; rows: Admin1AuditRow[]; limitations: string[];
}
export interface Admin1PartitionEntry extends Admin1AuditRow { partitionPath: string | null; exception: string | null }
/** Geometry metrics and source-code diagnostics live once in the source-bound audit report. */
export type Admin1PartitionIndexEntry = Pick<Admin1PartitionEntry,
  'sourceOrdinal' | 'sourceKey' | 'id' | 'featureSha256' | 'countryId' | 'joinStatus' | 'partitionPath' | 'exception'>;
export interface Admin1PartitionPlan {
  schemaVersion: 1; product: 'natural-earth-admin1-partitions-v1';
  source: SourceRecord; parent: { manifestHash: string; source: SourceRecord };
  inspection: Admin1InspectionReport;
  entries: Admin1PartitionEntry[];
  indexEntries: Admin1PartitionIndexEntry[];
  /** Exact canonical compact index bytes; publication binds this asset separately. */
  indexBytes: Uint8Array;
  assets: Array<{ path: string; sha256: string; bytes: Uint8Array; featureKeys: string[] }>;
  logicalBytes: number; limitations: string[];
}
export interface Admin1InspectionResult {
  report: Admin1InspectionReport; reportHash: string; reportPath: string;
  elapsedMs: number; networkBytes: 0;
}
