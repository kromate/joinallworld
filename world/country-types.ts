import type { SourceRecord } from './types.ts';
import type { InventoryPin } from './bootstrap.ts';

/** Reviewed metadata identity; raw SHA-256 is frozen only after verified capture. */
export interface CountryCaptureSpec {
  schemaVersion: 1;
  provider: 'natural-earth';
  release: string;
  resolution: '10m';
  metadataPath: string;
  metadataSha256: string;
  metadataBytes: number;
  expectedBytes: number;
  expectedGitBlobSha1: string;
  license: 'Public-domain';
  attribution: string;
}
export interface CountryCaptureResult {
  source: SourceRecord;
  input: string;
  inputPath: string;
  receiptPath: string;
  cacheHit: boolean;
  networkBytes: number;
  requestHash: string;
}
export interface CountryIdentityComparison {
  schemaVersion: 1;
  baselineSourceId: string;
  candidateSourceId: string;
  baselineUnits: number;
  candidateUnits: number;
  retained: Array<{ featureKey: string; countryId: string; baselineName: string; candidateName: string; metadataChanged: boolean }>;
  added: Array<{ featureKey: string; countryId: string; name: string }>;
  missing: Array<{ featureKey: string; countryId: string; name: string }>;
  protectedCountryId: 'legacy-ng';
  exceptions: string[];
}
export interface CountryInspectionReport {
  schemaVersion: 1;
  inspector: 'country-source-inspector-v1';
  source: SourceRecord;
  baselineSource: SourceRecord;
  sourceUnits: number;
  nodes: number;
  outlines: number;
  sourceCoordinatePositions: number;
  coordinatePositions: number;
  outlineBytes: number;
  largestOutlineBytes: number;
  outlineLimits: { bytes: 512000; positions: 100000 };
  oversizedOutlines: Array<{ countryId: string; name: string; bytes: number; positions: number }>;
  identity: CountryIdentityComparison;
  exceptions: string[];
}
export interface CountryInspectionWorkerInput {
  source: SourceRecord;
  rawBuffer: ArrayBuffer;
  baselinePin: InventoryPin;
  baselineBuffer: ArrayBuffer;
}
export type CountryInspectionWorkerReply = { ok: true; report: CountryInspectionReport } | { ok: false; error: string };
