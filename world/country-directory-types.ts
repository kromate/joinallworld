import type { InventoryNode, WorldInventory } from './production-types.ts';
import type { SourceRecord } from './types.ts';
import type { CountryIdentityComparison } from './country-types.ts';

/** A distinct product: legacy inventory and its fine bindings remain immutable. */
export const COUNTRY_DIRECTORY_COMPILER = 'country-directory-compiler-v1' as const;
export const COUNTRY_DIRECTORY_LIMITS = Object.freeze({
  manifestBytes: 1_000_000, indexBytes: 128_000, identityBytes: 256_000,
  partBytes: 512_000, countryBytes: 2 * 1024 * 1024, positions: 100_000,
  publishedBytes: 16_000_000, cacheBytes: 5_000_000, requests: 2,
});
export interface CountryDirectoryNodeIndex {
  schemaVersion: 1; node: InventoryNode; outlineIndexPath: string | null;
  children: Array<{ id: string; name: string; path: string }>;
}
export interface CountryOutlineIndex {
  schemaVersion: 1; countryId: string; sourceRef: string;
  geometryType: 'Polygon' | 'MultiPolygon'; polygonCount: number;
  coordinatePositions: number; totalPartBytes: number;
  parts: Array<{ path: string; polygonOffset: number; polygonCount: number; bytes: number; coordinatePositions: number }>;
}
export interface CountryDirectoryManifest {
  schemaVersion: 1; compiler: typeof COUNTRY_DIRECTORY_COMPILER;
  source: SourceRecord; baselineSource: SourceRecord; baselineInventoryHash: string;
  sourceUnitCount: number; nodeCount: number; outlineCount: number; partCount: number;
  rootNodePath: string; identityPath: string;
  rollups: Array<{ id: string; name: string; countryCount: number; sourceUnitCount: number; exceptionCount: number }>;
  representation: 'whole-polygon-groups';
  limits: { partBytes: 512000; countryBytes: 2097152; positions: 100000 };
  exceptions: string[];
}
export interface CompiledCountryDirectory {
  manifest: CountryDirectoryManifest; manifestHash: string; manifestPath: string;
  bytes: number; assets: Array<{ relative: string; body: Uint8Array }>;
  inventory: WorldInventory; identity: CountryIdentityComparison;
}
export interface CountryDirectoryBuildResult {
  manifestHash: string; manifestPath: string; bytes: number;
  sourceUnitCount: number; nodeCount: number; outlineCount: number; partCount: number;
  retained: number; added: number; missing: number;
  networkBytes: 0; elapsedMs: number;
}
