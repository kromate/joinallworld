import type { Bounds } from './types.ts';
import type { AcquisitionRequest, WorldCampaign } from './production-types.ts';
import type { AcquisitionBudgetReason } from './acquisition-errors.ts';

/** Additive query coverage. No query result is compiled/playable coverage. */
export interface GridQueryAddress { rootCellId: string; path: string }
export interface GridQueryBinding {
  schemaVersion: 1; planHash: string; maxDepth: number; maxJobs: number;
}
export interface ResolvedGridQueryAddress extends GridQueryAddress {
  cellId: string; depth: number; bounds: Bounds;
}
export type GridQueryResult = {
  status: 'query-captured'; features: number; requestHash: string;
  inputSha256: string; inputBytes: number; receiptSha256: string; receiptBytes: number;
} | {
  status: 'query-subdivided'; reason: AcquisitionBudgetReason; children: GridQueryAddress[];
};
export interface GridQueryJobView {
  address: GridQueryAddress; status: 'queued'|'leased'|'failed'|'completed'; result: GridQueryResult|null;
}
export interface GridQueryCoverage {
  schemaVersion: 1; planHash: string; coverage: 'source-query-only'; geometryCoverage: 'not-compiled';
  roots: { requested: number; captured: number; exception: number; pending: number };
  jobs: { total: number; subdivided: number; captured: number; zeroSupportedFeatures: number; failed: number; queued: number; leased: number };
  /** Summed rows across overlapping accepted queries, never unique building count. */
  supportedFeatureRows: number;
}
export interface GridQueryUnit {
  id: string; inventoryUnitId: string; priority: number; kind: 'grid-query';
  query: GridQueryAddress; request: AcquisitionRequest;
}
export interface GridQueryCampaign {
  schemaVersion: 2; id: string; inventoryHash: string; inventoryKind: 'country-directory';
  gridQuery: GridQueryBinding; units: GridQueryUnit[]; limits: WorldCampaign['limits'];
}
