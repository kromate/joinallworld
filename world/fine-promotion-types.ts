import type { FineDirectoryCatalogueReport } from './fine-directory-catalogue.ts';
import type { VerifiedCountryDirectory } from './country-directory-reader.ts';
import type { FineSourcePin } from './fine-types.ts';

/** Admission is local ingestion only; publishing and geopolitical adjudication are separate. */
export const FINE_PROMOTION_POLICY = 'natural-earth-public-domain-local-ingestion-v1' as const;
export const FINE_POINTER_LIMITS = Object.freeze({
  pointerBytes: 4096, durationMs: 30_000, networkBytes: 64 * 1024,
  cacheBytes: 256 * 1024, auditBytes: 256 * 1024, auditEntries: 128,
  scanEntries: 256, scanDepth: 4, freeBytes: 100 * 1024 * 1024,
});

export interface FinePromotionSelection { countryId: string; countryIso3: string; commit: string }
export interface FinePromotionContext {
  catalogueBytes: Uint8Array;
  catalogueHash: string;
  catalogue: FineDirectoryCatalogueReport;
  metadataBytes: Uint8Array;
  directory: VerifiedCountryDirectory;
}
export interface FinePromotionRequest {
  schemaVersion: 1;
  policy: typeof FINE_PROMOTION_POLICY;
  parent: { product: 'country-directory'; manifestHash: string };
  catalogueHash: string;
  metadataSnapshot: { sha256: string; bytes: number };
  metadataRow: { ordinal: number; sha256: string; bytes: number };
  country: { id: string; code: string; iso3: string; name: string };
  layer: { id: string; canonicalType: string; representedYear: string; buildDate: string; expectedUnits: number };
  commit: string;
  pointerUrl: string;
}
export interface FinePromotion {
  request: FinePromotionRequest;
  /** Canonical JSON of the original metadata row, bound by pin.metadataSha256/metadataBytes. */
  metadataRowBytes: Uint8Array;
  pointer: { sha256: string; bytes: number };
  pin: FineSourcePin;
}
export interface FinePointerAcquisitionOptions {
  repositoryRoot: string;
  signal?: AbortSignal;
  durationMs?: number;
  cacheOnly?: boolean;
  /** Test seam only; URL, redirect and encoding policy remain module-controlled. */
  fetcher?: typeof fetch;
}
export interface FinePointerAcquisitionResult {
  requestHash: string;
  pointerPath: string;
  receiptPath: string;
  pointerBytes: Uint8Array;
  pointer: { sha256: string; bytes: number };
  networkBytes: number;
  cacheHit: boolean;
}
