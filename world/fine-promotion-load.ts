import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { readBoundedLocalFile } from './inventory-reader.ts';
import { readCountryDirectory } from './country-directory-reader.ts';
import type { FineDirectoryCatalogueReport } from './fine-directory-catalogue.ts';
import { buildFineCampaignPlan } from './fine-campaign-plan.ts';
import { FINE_POINTER_LIMITS, type FinePromotionContext } from './fine-promotion-types.ts';

const HASH = /^[a-f0-9]{64}$/;
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const canonical = (value: unknown): string => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new TypeError('non-finite value in promotion binding'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  throw new TypeError('unsupported value in promotion binding');
};

function check(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new Error('fine promotion context load aborted');
  if (process.memoryUsage().rss > 512 * 1024 * 1024) throw new RangeError('fine promotion context RSS exceeds 512 MiB');
}

function parseJson(bytes: Uint8Array, label: string): unknown {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new TypeError(`${label} is not valid UTF-8 JSON`); }
}

function assertDirectoryBindings(report: FineDirectoryCatalogueReport, directory: FinePromotionContext['directory'], signal: AbortSignal): void {
  if (report.parent.product !== 'country-directory' || report.parent.manifestHash !== directory.manifestHash) throw new Error('fine catalogue parent hash does not match verified country directory');
  if (report.coarseSources.length !== 1 || canonical(report.coarseSources[0]) !== canonical(directory.manifest.source)) throw new Error('fine catalogue coarse source differs from verified directory source');
  if (report.sourceCounts.coarseSourceUnits !== directory.manifest.sourceUnitCount) throw new Error('fine catalogue source-unit count differs from verified directory');
  const directoryCountries = directory.nodes.filter(node => node.kind === 'country');
  if (report.sourceCounts.coarseCountryNodes !== directoryCountries.length || report.countries.length !== directoryCountries.length) throw new Error('fine catalogue country count differs from verified directory');
  const byId = new Map(directoryCountries.map(country => [country.id, country]));
  if (byId.size !== directoryCountries.length) throw new Error('verified directory repeats country identity');
  for (const country of report.countries) {
    check(signal);
    const node = byId.get(country.countryId);
    if (!node || country.name !== node.name || canonical(country.sourceFeatureIds) !== canonical(node.sourceFeatureIds)) throw new Error(`fine catalogue country ${country.countryId} differs from verified directory identity`);
    if (node.countryCode === 'NG') {
      if (country.countryId !== 'legacy-ng' || country.status !== 'protected' || node.provider !== 'legacy-ng') throw new Error('Nigeria promotion binding is not protected');
    } else if (node.provider !== 'world') throw new Error(`fine catalogue country ${country.countryId} binds a non-world provider`);
    byId.delete(country.countryId);
  }
  if (byId.size !== 0) throw new Error('fine catalogue omits countries from the verified directory');
}

/** Load and verify the exact private discovery report and its frozen inputs without network or writes. */
export async function loadFinePromotionContext(options: { repositoryRoot: string; catalogueHash: string; signal?: AbortSignal }): Promise<FinePromotionContext> {
  if (!path.isAbsolute(options.repositoryRoot) || path.resolve(options.repositoryRoot) !== options.repositoryRoot) throw new TypeError('repositoryRoot must be canonical and absolute');
  if (!HASH.test(options.catalogueHash)) throw new TypeError('catalogueHash must be a lowercase SHA-256');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('fine promotion context load exceeded its 30-second deadline')), FINE_POINTER_LIMITS.durationMs);
  timer.unref();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  try {
    check(signal);
    const repositoryRoot = await realpath(options.repositoryRoot);
    if (repositoryRoot !== options.repositoryRoot) throw new Error('repositoryRoot must not contain symlink aliases');
    check(signal);
    const buildRoot = path.join(repositoryRoot, '.cache', 'world-build');
    const cataloguePath = path.join(buildRoot, 'fine-directory-catalogue', 'reports', `${options.catalogueHash}.json`);
    const catalogueBytes = await readBoundedLocalFile(cataloguePath, 1_000_000);
    check(signal);
    if (sha(catalogueBytes) !== options.catalogueHash) throw new Error('fine catalogue report bytes do not match requested hash');
    const parsed = parseJson(catalogueBytes, 'fine catalogue report');
    check(signal);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('fine catalogue report must be an object');
    const catalogue = parsed as FineDirectoryCatalogueReport;
    if (catalogue.schemaVersion !== 2 || catalogue.purpose !== 'metadata-discovery-only' || !catalogue.pin || !HASH.test(catalogue.pin.sha256) || !Number.isSafeInteger(catalogue.pin.bytes) || catalogue.pin.bytes < 1 || catalogue.pin.bytes > 2 * 1024 * 1024) throw new Error('fine catalogue report schema or metadata pin is invalid');
    // This performs the full bounded structural/count/identity validation used by campaign planning.
    buildFineCampaignPlan(catalogue, options.catalogueHash, []);
    check(signal);
    const metadataBytes = await readBoundedLocalFile(path.join(buildRoot, 'fine-catalogue-cache', `all-adm1-metadata.${catalogue.pin.sha256}.json`), 2 * 1024 * 1024);
    check(signal);
    if (metadataBytes.byteLength !== catalogue.pin.bytes || sha(metadataBytes) !== catalogue.pin.sha256) throw new Error('frozen fine metadata bytes do not match report pin');
    const directory = await readCountryDirectory(path.join(buildRoot, 'output', 'country-inventory'), catalogue.parent.manifestHash, signal);
    check(signal);
    assertDirectoryBindings(catalogue, directory, signal);
    check(signal);
    return { catalogueBytes, catalogueHash: options.catalogueHash, catalogue, metadataBytes, directory };
  } finally {
    clearTimeout(timer);
  }
}
