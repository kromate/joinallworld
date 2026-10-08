import type { EnvironmentManifest, EnvironmentRequest } from './environment-types.ts';
import type { Region, WorldManifest } from './types.ts';

export const CLIMATE_ATTACHMENT_PRODUCT = 'city-associated-monthly-climate-v1' as const;
export const CLIMATE_ATTACHMENT_COMPILER = 'climate-attachment-compiler-v1' as const;
export const CLIMATE_ATTACHMENT_POLICY = 'explicit-pinned-city-association-v1' as const;
export const CLIMATE_ATTACHMENT_LIMITS = Object.freeze({
  jobs: 3, baseManifestBytes: 128 * 1024, environmentManifestBytes: 16 * 1024,
  rawSourceBytes: 1_000_000, tiles: 64, tileBytes: 1024 * 1024,
  provenanceBytes: 64 * 1024, manifestBytes: 128 * 1024,
  logicalBytes: 8 * 1024 * 1024, treeBytes: 24 * 1024 * 1024,
  treeEntries: 1024, treeDepth: 4, freeBytes: 100 * 1024 * 1024,
  durationMs: 60_000, rssBytes: 256 * 1024 * 1024,
  auditBytes: 1024 * 1024, auditRecords: 128, auditRecordBytes: 8 * 1024,
  attemptsPerRequest: 4, pinBytes: 64 * 1024,
});
export interface ClimateAttachmentFilePin { sha256: string; bytes: number; path: string }
export interface ClimateAttachmentBinding {
  schemaVersion: 1; id: string; campaignId: string;
  baseManifest: ClimateAttachmentFilePin; expectedRegion: Region;
  environmentManifest: ClimateAttachmentFilePin;
  environmentRequest: EnvironmentRequest;
  rawSource: ClimateAttachmentFilePin & { url: string };
  expectedSample: { longitude: number; latitude: number };
  association: {
    mode: 'explicit-city-associated-native-grid-point';
    sampleInsidePackBounds: boolean;
    centreOffsetDegrees: { longitude: number; latitude: number };
    maximumAbsoluteCentreOffsetDegrees: 0.01;
    disclosure: string;
  };
}
export interface ClimateAttachmentBuildInput {
  binding: ClimateAttachmentBinding;
  baseBytes: Uint8Array; environmentBytes: Uint8Array; rawSourceBytes: Uint8Array;
  tiles: Array<{ relative: string; body: Uint8Array }>;
}
export interface ClimateAttachmentProvenance {
  schemaVersion: 1;
  product: typeof CLIMATE_ATTACHMENT_PRODUCT;
  compiler: typeof CLIMATE_ATTACHMENT_COMPILER;
  policy: typeof CLIMATE_ATTACHMENT_POLICY;
  binding: ClimateAttachmentBinding;
  environment: EnvironmentManifest;
  originalTiles: WorldManifest['tiles'];
  limitations: string[];
}
export interface CompiledClimateAttachment {
  manifest: WorldManifest; manifestHash: string; manifestPath: string;
  provenance: ClimateAttachmentProvenance; provenanceHash: string; provenancePath: string;
  /** Original tiles unchanged, provenance before manifest, manifest last. */
  assets: Array<{ relative: string; body: Uint8Array }>;
  bytes: number;
}
export interface ClimateAttachmentPublishedResult {
  id: string; regionId: string; manifestHash: string; manifestPath: string;
  provenanceHash: string; provenancePath: string; bytes: number;
  tiles: number; cacheHit: boolean; elapsedMs: number; networkBytes: 0;
}
export interface PublishClimateAttachmentOptions {
  repositoryRoot: string; binding: ClimateAttachmentBinding;
  signal?: AbortSignal; durationMs?: number;
  onWorkerOnline?: () => void; onAssetWritten?: (relative: string) => void;
}
export interface ClimateAttachmentDisplay {
  mode: 'unknown' | 'monthly'; month: number | null;
  text: string; sourceText: string;
}
