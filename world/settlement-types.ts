import type { SourceRecord } from './types.ts';

export const SETTLEMENT_CAPTURE_LIMITS = Object.freeze({
  sourceBytes: 32 * 1024 * 1024, networkBytes: 64 * 1024 * 1024,
  cacheBytes: 64 * 1024 * 1024, auditBytes: 512 * 1024,
  auditRecords: 64, recordBytes: 8 * 1024, reserveBytes: 16 * 1024,
  maxAttempts: 2, durationMs: 120_000, rssBytes: 512 * 1024 * 1024,
  freeBytes: 100 * 1024 * 1024, scanEntries: 512, scanDepth: 5,
  metadataBytes: 64 * 1024, overshootBytes: 64 * 1024,
});
export interface SettlementCaptureSpec {
  schemaVersion: 1; provider: 'natural-earth'; release: string; resolution: '10m';
  metadataPath: '.cache/world-build/evidence/settlement-admission/source-api.json';
  metadataSha256: string; metadataBytes: number; expectedBytes: number;
  expectedGitBlobSha1: string; license: 'Public-domain'; attribution: string;
}
export interface SettlementCaptureResult {
  source: SourceRecord; input: string; inputPath: string; receiptPath: string;
  cacheHit: boolean; networkBytes: number; requestHash: string;
}
export interface SettlementSourcePin {
  schemaVersion: 1; source: SourceRecord; input: string; gitBlobSha1: string;
}
