import type { SourceRecord } from './types.ts';
import type { InventoryNode } from './production-types.ts';
import type { SettlementSourcePin } from './settlement-types.ts';

/** Selected reference points only; a separate product from game destinations and Nigeria. */
export const SETTLEMENT_PRODUCT = 'natural-earth-selected-places-v1' as const;
export const SETTLEMENT_COMPILER = 'selected-place-compiler-v1' as const;
export const SETTLEMENT_PRODUCT_LIMITS = Object.freeze({
  sourceBytes: 32 * 1024 * 1024, parentSourceBytes: 16 * 1024 * 1024,
  sourceUnits: 100_000, countries: 1024, propertiesBytes: 32 * 1024,
  textBytes: 256, reportBytes: 3 * 1024 * 1024, manifestBytes: 256 * 1024,
  // Existing country route ceiling is decimal 512,000 bytes, not 512 KiB.
  countryBytes: 512_000, countryPoints: 100_000,
  logicalBytes: 16 * 1024 * 1024, treeBytes: 32 * 1024 * 1024,
  treeEntries: 2048, treeDepth: 5, auditBytes: 1024 * 1024,
  auditRecords: 128, auditRecordBytes: 8 * 1024, attemptsPerRequest: 8,
  durationMs: 120_000, rssBytes: 512 * 1024 * 1024,
  freeBytes: 100 * 1024 * 1024, browserCacheBytes: 5 * 1024 * 1024,
  browserRequests: 2,
});
export interface SettlementParentPin {
  manifestHash: string;
  directoryRoot: '.cache/world-build/output/country-inventory';
  source: SourceRecord; input: string;
}
export interface SettlementBuildInput {
  source: SourceRecord; raw: Uint8Array;
  parent: { manifestHash: string; source: SourceRecord; raw: Uint8Array; nodes: InventoryNode[] };
}
export type SettlementJoinStatus = 'linked' | 'protected' | 'unlinked' | 'ambiguous';
export interface SettlementAuditRow {
  sourceOrdinal: number; sourceKey: string; id: string; featureSha256: string;
  adm0Code: string | null; countryId: string | null; joinStatus: SettlementJoinStatus;
  pointIssue: string | null; labelIssue: string | null; emitted: boolean;
}
export interface SettlementInspectionReport {
  schemaVersion: 1; product: typeof SETTLEMENT_PRODUCT; compiler: typeof SETTLEMENT_COMPILER;
  source: SourceRecord; parent: { manifestHash: string; source: SourceRecord };
  joinPolicy: 'literal-ADM0_A3-v1'; keyField: 'NE_ID'; countryField: 'ADM0_A3';
  sourceUnits: number; validPoints: number; linked: number; protected: number;
  unlinked: number; ambiguous: number; invalidRows: number; emittedUnits: number;
  countries: Array<{ countryId: string; sourceUnits: number; emittedUnits: number }>;
  missingCountries: string[]; rows: SettlementAuditRow[]; limitations: string[];
}
export interface SettlementAssetRef { path: string; sha256: string; bytes: number }
export interface SettlementPointRecord {
  sourceOrdinal: number; sourceKey: string; id: string;
  name: string; nameAscii: string; sourceClass: string; scaleRank: number;
  coordinates: [number, number];
}
export interface SettlementCountryPoints {
  schemaVersion: 1; product: typeof SETTLEMENT_PRODUCT; countryId: string;
  sourceSha256: string; parentManifestHash: string;
  sourceUnits: number; emittedUnits: number; rows: SettlementPointRecord[];
}
export interface SettlementCountryRef {
  countryId: string; status: 'available' | 'missing' | 'protected';
  sourceUnits: number; emittedUnits: number; points: SettlementAssetRef | null;
}
export interface SettlementProductManifest {
  schemaVersion: 1; product: typeof SETTLEMENT_PRODUCT; compiler: typeof SETTLEMENT_COMPILER;
  source: SourceRecord; parent: { manifestHash: string; source: SourceRecord };
  joinPolicy: 'literal-ADM0_A3-v1'; keyField: 'NE_ID'; countryField: 'ADM0_A3';
  representation: 'selected-source-point-geometry';
  validation: 'source-bound-structural-with-explicit-exceptions';
  sourceUnits: number; validPoints: number; linked: number; protected: number;
  unlinked: number; ambiguous: number; invalidRows: number;
  emittedUnits: number; exceptionUnits: number;
  inspection: SettlementAssetRef; countries: SettlementCountryRef[];
  limitations: string[];
}
export interface CompiledSettlementProduct {
  manifest: SettlementProductManifest; manifestHash: string; manifestPath: string;
  report: SettlementInspectionReport;
  /** Includes report, all country point assets, and manifest last. Canonical JSON plus one LF. */
  assets: Array<{ relative: string; body: Uint8Array }>;
  bytes: number;
}
export interface SettlementPublishedResult {
  manifestHash: string; manifestPath: string; bytes: number;
  sourceUnits: number; emittedUnits: number; countries: number;
  cacheHit: boolean; elapsedMs: number; networkBytes: 0;
}
export interface PublishSettlementOptions {
  repositoryRoot: string; sourcePin: SettlementSourcePin; parentPin: SettlementParentPin;
  signal?: AbortSignal; durationMs?: number;
  onWorkerOnline?: () => void; onAssetWritten?: (relativePath: string) => void;
}
