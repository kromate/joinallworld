import type { SourceRecord } from '../types.ts';
import type { SettlementCountryPoints, SettlementCountryRef, SettlementProductManifest, SettlementPointRecord } from '../settlement-product-types.ts';

export const SETTLEMENT_PREVIEW_LIMITS = Object.freeze({ markers: 256, pageRows: 50, queuedRequests: 32, cacheEntries: 256, requestMs: 25_000 });
/** Bound to the already verified separate country directory, never a name join. */
export interface SettlementBinding {
  countryId: string; countryName: string; provider: 'world' | 'legacy-ng';
  parentManifestHash: string; parentSource: SourceRecord;
}
export interface SettlementReaderSnapshot {
  /** Decoded body bytes observed, including failed/partial responses; not wire-byte measurements. */
  downloadedBytes: number; cacheBytes: number; cacheEntries: number;
  requestStarts: number; inflightRequests: number; queuedRequests: number;
}
export interface SettlementClientOptions {
  origin: string; fetcher?: typeof fetch; cacheBytes?: number;
  changed?: (snapshot: SettlementReaderSnapshot) => void;
}
export interface SettlementReadResult {
  status: 'available' | 'missing' | 'protected';
  manifestHash: string | null; manifest: SettlementProductManifest | null;
  country: SettlementCountryRef | null; points: SettlementCountryPoints | null;
  cached: boolean;
}
export interface SettlementPanelOptions {
  host: HTMLElement; binding: () => SettlementBinding | null;
  activate: () => void; clear: () => void;
  draw: (result: SettlementReadResult) => void;
  focus: (point: SettlementPointRecord) => void;
  downloaded: (bytes: number) => void;
}
export interface SettlementAtlasFrame { viewBox: string; wraps: boolean }
export interface SettlementMarkerPlan {
  markers: Array<{ point: SettlementPointRecord; x: number; y: number }>;
  eligible: number; outsideView: number; deferred: number;
}
