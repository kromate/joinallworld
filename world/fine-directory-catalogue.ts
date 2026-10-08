import { buildFineCatalogue } from './fine-catalogue.ts';
import type { FineCataloguePin, FineCatalogueReport } from './fine-catalogue.ts';
import type { WorldInventory } from './production-types.ts';

export interface FineDirectoryCatalogueReport extends Omit<FineCatalogueReport, 'schemaVersion' | 'exceptions'> {
  schemaVersion: 2;
  purpose: 'metadata-discovery-only';
  parent: { product: 'country-directory'; manifestHash: string };
  exceptions: string[];
}

/** Builds the discovery-only fine metadata report against one exact country-directory inventory. */
export function buildFineDirectoryCatalogue(
  metadataBytes: Uint8Array,
  pin: FineCataloguePin,
  inventory: WorldInventory,
  rawGeoJSON: unknown,
  parentManifestHash: string,
): FineDirectoryCatalogueReport {
  if (!/^[a-f0-9]{64}$/.test(parentManifestHash)) throw new TypeError('parent country-directory manifest hash must be a lowercase SHA-256');
  const report = buildFineCatalogue(metadataBytes, pin, inventory, rawGeoJSON);
  const exceptions = report.exceptions.filter(exception => !exception.startsWith('The 1:110m Natural Earth coarse inventory'));
  exceptions.push('This report uses the exact pinned 1:10m country-directory map-unit denominator. Map units are not sovereign-state counts; selected-source boundaries do not establish political claims or complete world coverage.');
  return {
    ...report,
    schemaVersion: 2,
    parent: { product: 'country-directory', manifestHash: parentManifestHash },
    exceptions,
  };
}
