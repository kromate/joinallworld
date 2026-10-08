import type { Admin1AuditRow, Admin1InspectionReport } from './admin1-types.ts';
import type { Admin1ProductManifest } from './admin1-product-types.ts';

export const ADMIN1_TOPOLOGY_VALIDATOR = 'natural-earth-admin1-ogc-planar-v1' as const;
export const ADMIN1_TOPOLOGY_LIMITS = Object.freeze({
  durationMs: 120_000, rssBytes: 512 * 1024 * 1024,
  sourceBytes: 64 * 1024 * 1024, sourceUnits: 10_000, positions: 3_000_000,
  featurePositions: 100_000, reportBytes: 2 * 1024 * 1024,
  requestBytes: 64 * 1024, stderrBytes: 16 * 1024,
  treeBytes: 16 * 1024 * 1024, treeEntries: 512, treeDepth: 5,
  auditBytes: 1024 * 1024, auditEntries: 128, auditRecordBytes: 8 * 1024,
  attemptsPerRequest: 8, freeBytes: 100 * 1024 * 1024,
});
export const ADMIN1_TOPOLOGY_SCOPE = [
  'OGC validity checks a derived 2D unwrapped longitude/latitude image; original source geometry is never changed.',
  'Polar, global-span and ambiguous longitude images are unsupported; higher ordinates are ignored.',
  'Nigeria is protected and not submitted to topology predicates.',
  'No spherical validity, matching shared borders, complete coverage, official hierarchy, currentness, boundary recognition or playability is established.',
] as const;
export interface Admin1TopologyTooling {
  duckdbVersion: '1.5.6'; spatialVersion: '04270fe';
  spatialSha256: 'e326286e0ff4651680bfa2918fb22990fed50cb7d27d79dd21143ac7e74b0da9';
  workerSha256: string; geometryHelperSha256: string;
}
export type Admin1TopologyStatus = 'valid' | 'invalid' | 'unsupported' | 'protected';
export interface Admin1TopologyWorkerRow {
  sourceOrdinal: number; sourceKey: string; status: Admin1TopologyStatus;
  valid: boolean | null; empty: boolean | null; reason: string | null;
}
/** Python stdout, bounded one JSON line plus LF; key order is lexical source-key order. */
export interface Admin1TopologyWorkerReport {
  schemaVersion: 1; validator: typeof ADMIN1_TOPOLOGY_VALIDATOR;
  sourceSha256: string; sourceBytes: number; expectedUnits: number;
  tooling: Pick<Admin1TopologyTooling, 'duckdbVersion' | 'spatialVersion' | 'spatialSha256'>;
  rows: Admin1TopologyWorkerRow[];
}
export interface Admin1TopologyRow extends Admin1TopologyWorkerRow {
  id: string; featureSha256: string; countryId: string | null;
  joinStatus: Admin1AuditRow['joinStatus'];
}
export interface Admin1TopologyReport {
  schemaVersion: 1; validator: typeof ADMIN1_TOPOLOGY_VALIDATOR;
  sourceSha256: string; sourceBytes: number; parentManifestHash: string;
  publicationManifestHash: string; inspectionSha256: string;
  expectedUnits: number; checkedUnits: number; validUnits: number;
  invalidUnits: number; unsupportedUnits: number; protectedUnits: number;
  tooling: Admin1TopologyTooling; rows: Admin1TopologyRow[];
  limitations: string[];
}
export interface Admin1TopologyBinding {
  manifestHash: string; manifest: Admin1ProductManifest;
  inspection: Admin1InspectionReport; tooling: Admin1TopologyTooling;
}
export interface Admin1TopologyResult {
  requestHash: string; reportHash: string; reportPath: string;
  report: Admin1TopologyReport; cacheHit: boolean; elapsedMs: number;
  networkBytes: 0; peakRssBytes: number | null; rssSamples: number;
}
