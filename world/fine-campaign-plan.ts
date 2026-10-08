import { validateFineSourcePin } from './fine.ts';
import type { FineSourcePin } from './fine-types.ts';
import type { FineDirectoryCatalogueReport } from './fine-directory-catalogue.ts';
import { FINE_CATALOGUE_URL } from './fine-catalogue.ts';

export interface ReviewedFineCampaignInput { pin: FineSourcePin; topologyReportPath: string }
export type FineCampaignUnitStatus = 'ready' | 'protected' | 'missing-metadata' | 'ambiguous-identity' | 'unreviewed-source' | 'partition-required' | 'excluded-source';
export interface FineCampaignUnit {
  countryId: string;
  name: string;
  priority: 0 | 1;
  iso3: string | null;
  status: FineCampaignUnitStatus;
  reason: string;
  pin: FineSourcePin | null;
  topologyReportPath: string | null;
}
export interface FineCampaignPlan {
  schemaVersion: 1;
  purpose: 'administrative-build-campaign';
  parent: { product: 'country-directory'; manifestHash: string };
  catalogueHash: string;
  metadataSha256: string;
  countryCount: number;
  units: FineCampaignUnit[];
  counts: Record<FineCampaignUnitStatus, number>;
}

const SHA256 = /^[a-f0-9]{64}$/;
const ISO3 = /^[A-Z]{3}$/;
const TOPOLOGY_PATH = /^\.cache\/world-build\/fine-topology\/reports\/[a-f0-9]{64}\/[a-f0-9]{64}\.json$/;
const STATUSES: FineCampaignUnitStatus[] = ['ready','protected','missing-metadata','ambiguous-identity','unreviewed-source','partition-required','excluded-source'];
const compareCodepoints = (left: string, right: string): number => {
  const a = Array.from(left, character => character.codePointAt(0)!), b = Array.from(right, character => character.codePointAt(0)!);
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
};
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max = 2048): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError(`${label} is invalid bounded text`);
  return value;
}
function count(value: unknown, label: string, max = 10_000): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > max) throw new RangeError(`${label} is outside its bounded range`);
  return Number(value);
}
function checkedCatalogue(reportValue: FineDirectoryCatalogueReport, reportHash: string): FineDirectoryCatalogueReport {
  if (!SHA256.test(reportHash)) throw new TypeError('catalogue report hash must be a lowercase SHA-256');
  const report = object(reportValue, 'fine directory catalogue report');
  if (report.schemaVersion !== 2 || report.purpose !== 'metadata-discovery-only') throw new TypeError('catalogue schema or purpose is unsupported');
  const parent = object(report.parent, 'catalogue parent');
  if (parent.product !== 'country-directory' || typeof parent.manifestHash !== 'string' || !SHA256.test(parent.manifestHash)) throw new TypeError('catalogue parent country-directory binding is invalid');
  const pin = object(report.pin, 'catalogue metadata pin');
  if (pin.sourceUrl !== FINE_CATALOGUE_URL || typeof pin.sha256 !== 'string' || !SHA256.test(pin.sha256) || !Number.isSafeInteger(pin.bytes) || Number(pin.bytes) < 1 || Number(pin.bytes) > 2 * 1024 * 1024 || typeof pin.capturedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(pin.capturedAt) || !Number.isFinite(Date.parse(pin.capturedAt))) throw new TypeError('catalogue metadata pin is invalid');
  const expectedLayerCount = count(report.expectedLayerCount, 'expected metadata layer count', 300);
  const reportedLayerCount = count(report.reportedLayerCount, 'reported metadata layer count', 300);
  if (expectedLayerCount !== reportedLayerCount || !Array.isArray(report.layers) || report.layers.length !== reportedLayerCount || !Array.isArray(report.countries) || report.countries.length < 1 || report.countries.length > 10_000) throw new Error('catalogue layer/country counts are inconsistent');
  const layerOrdinals = new Set<number>();
  const layers = report.layers.map((raw, index) => {
    const layer = object(raw, `catalogue layer ${index}`);
    const ordinal = count(layer.ordinal, `layer ${index} ordinal`, 299);
    if (ordinal !== index) throw new Error('catalogue layer ordinals are not in source order');
    if (layerOrdinals.has(ordinal)) throw new Error('catalogue repeats a layer ordinal');
    layerOrdinals.add(ordinal);
    if (!['linked','protected','missing-coarse-country','ambiguous-iso3','source-resolution-exception','invalid-metadata'].includes(String(layer.status))) throw new TypeError(`catalogue layer ${index} status is invalid`);
    if (layer.iso3 !== null && (typeof layer.iso3 !== 'string' || !ISO3.test(layer.iso3))) throw new TypeError(`catalogue layer ${index} ISO3 is invalid`);
    if (layer.countryId !== null) text(layer.countryId, `catalogue layer ${index} country ID`, 512);
    if (layer.boundaryId !== null) text(layer.boundaryId, `catalogue layer ${index} boundary ID`, 256);
    if (layer.reportedAdminUnits !== null) count(layer.reportedAdminUnits, `catalogue layer ${index} unit count`, 1_000_000);
    if (layer.priority !== null && layer.priority !== 0 && layer.priority !== 1) throw new TypeError(`catalogue layer ${index} priority is invalid`);
    if (layer.pilotUnitLimit !== 32 || !['within-limit','too-large','unknown'].includes(String(layer.pilotStatus))) throw new TypeError(`catalogue layer ${index} pilot limit/status is invalid`);
    if ((layer.reportedAdminUnits === null) !== (layer.pilotStatus === 'unknown') || (typeof layer.reportedAdminUnits === 'number' && (layer.pilotStatus === 'too-large') !== (layer.reportedAdminUnits > 32))) throw new Error(`catalogue layer ${index} pilot status differs from its reported unit count`);
    for (const field of ['source','originalLicense','licenseSource','candidateUrl','shortReleaseCandidate','adminType','representedYear','buildDate'] as const) {
      if (layer[field] !== null) text(layer[field], `catalogue layer ${index} ${field}`, 2048);
    }
    if (!Array.isArray(layer.exceptions) || layer.exceptions.length > 64 || layer.exceptions.some(value => typeof value !== 'string' || value.length > 2048)) throw new TypeError(`catalogue layer ${index} exceptions are invalid`);
    return layer;
  });
  if (layerOrdinals.size && (Math.min(...layerOrdinals) !== 0 || Math.max(...layerOrdinals) !== reportedLayerCount - 1)) throw new Error('catalogue layer ordinals are not contiguous');
  const countryIds = new Set<string>();
  const countryRefs = new Set<string>();
  const coarseSources = report.coarseSources;
  if (!Array.isArray(coarseSources) || coarseSources.length !== 1) throw new TypeError('catalogue must bind exactly one coarse source');
  const coarseSource = object(coarseSources[0], 'catalogue coarse source');
  const coarseSourceId = text(coarseSource.id, 'coarse source ID', 256);
  if (typeof coarseSource.sha256 !== 'string' || !SHA256.test(coarseSource.sha256) || !Number.isSafeInteger(coarseSource.bytes) || Number(coarseSource.bytes) < 1) throw new TypeError('catalogue coarse source pin is invalid');
  const countries = report.countries.map((raw, index) => {
    const country = object(raw, `catalogue country ${index}`);
    const countryId = text(country.countryId, `catalogue country ${index} ID`, 512);
    if (countryIds.has(countryId)) throw new Error('catalogue repeats a country ID');
    countryIds.add(countryId);
    text(country.name, `catalogue country ${index} name`, 2048);
    if (!Array.isArray(country.sourceFeatureIds) || country.sourceFeatureIds.length !== 1) throw new Error(`catalogue country ${countryId} source references are invalid`);
    const reference = text(country.sourceFeatureIds[0], `catalogue country ${countryId} source reference`, 2048);
    if (!reference.startsWith(`${coarseSourceId}:`) || countryRefs.has(reference)) throw new Error('catalogue country source reference is unresolved or duplicated');
    countryRefs.add(reference);
    if (country.iso3 !== null && (typeof country.iso3 !== 'string' || !ISO3.test(country.iso3))) throw new TypeError(`catalogue country ${countryId} ISO3 is invalid`);
    if (country.boundaryId !== null) text(country.boundaryId, `catalogue country ${countryId} boundary ID`, 256);
    if (country.priority !== 0 && country.priority !== 1) throw new TypeError(`catalogue country ${countryId} priority is invalid`);
    if (!['linked','protected','missing-metadata','ambiguous-iso3','source-resolution-exception'].includes(String(country.status))) throw new TypeError(`catalogue country ${countryId} status is invalid`);
    if (!Array.isArray(country.exceptions) || country.exceptions.length > 64 || country.exceptions.some(value => typeof value !== 'string' || value.length > 2048)) throw new TypeError(`catalogue country ${countryId} exceptions are invalid`);
    return country;
  });
  const counts = object(report.counts, 'catalogue counts');
  const sourceCounts = object(report.sourceCounts, 'catalogue source counts');
  const summary: Record<string, number> = {}, sourceSummary: Record<string, number> = {};
  for (const field of ['metadataRecords','validAdm1Layers','invalidMetadataRecords','duplicateIso3Groups','linkedCountries','missingMetadataCountries','protectedCountries','ambiguousCountries','tooLargeForPilot']) summary[field] = count(counts[field], `catalogue counts.${field}`, 100_000);
  for (const field of ['coarseSourceUnits','coarseCountryNodes','metadataReportedAdminUnits','metadataUnitCountsKnown']) sourceSummary[field] = count(sourceCounts[field], `catalogue sourceCounts.${field}`, 1_000_000);
  const validLayers = layers.filter(layer => layer.status !== 'invalid-metadata');
  const invalidMetadataRecords = summary['invalidMetadataRecords'];
  const coarseSourceUnits = sourceSummary['coarseSourceUnits'];
  if (invalidMetadataRecords === undefined || coarseSourceUnits === undefined) throw new Error('catalogue summary is missing a required count');
  const isoCounts = new Map<string,number>();
  for (const layer of validLayers) isoCounts.set(layer.iso3 as string,(isoCounts.get(layer.iso3 as string)??0)+1);
  const duplicateIsoCount = [...isoCounts.values()].filter(value => value > 1).length;
  if (summary.metadataRecords !== layers.length || summary.linkedCountries !== countries.filter(country => country.status === 'linked').length
      || summary.missingMetadataCountries !== countries.filter(country => country.status === 'missing-metadata').length
      || summary.protectedCountries !== countries.filter(country => country.status === 'protected').length
      || summary.ambiguousCountries !== countries.filter(country => country.status === 'ambiguous-iso3').length
      || summary.validAdm1Layers !== validLayers.length
      || summary.duplicateIso3Groups !== duplicateIsoCount
      || summary.validAdm1Layers + invalidMetadataRecords !== layers.length
      || summary.tooLargeForPilot !== layers.filter(layer => layer.pilotStatus === 'too-large').length
      || sourceSummary.coarseCountryNodes !== countries.length
      || coarseSourceUnits < countries.length
      || sourceSummary.metadataUnitCountsKnown !== layers.filter(layer => layer.reportedAdminUnits !== null).length
      || sourceSummary.metadataReportedAdminUnits !== layers.reduce((sum, layer) => sum + (typeof layer.reportedAdminUnits === 'number' ? layer.reportedAdminUnits : 0), 0)) throw new Error('catalogue summary counts do not match its rows');
  const protectedCountries = countries.filter(country => country.status === 'protected');
  if (protectedCountries.length !== 1 || protectedCountries[0]!.countryId !== 'legacy-ng' || protectedCountries[0]!.iso3 !== 'NGA') throw new Error('catalogue must contain exactly one protected Nigeria country');
  for (const country of countries) {
    if (country.status !== 'linked' && country.status !== 'protected') continue;
    const matches = layers.filter(layer => layer.status !== 'invalid-metadata' && layer.countryId === country.countryId && layer.iso3 === country.iso3);
    const expectedStatus = country.status === 'protected' ? 'protected' : 'linked';
    if (matches.length !== 1 || matches[0]!.status !== expectedStatus || matches[0]!.boundaryId !== country.boundaryId || matches[0]!.priority !== country.priority) throw new Error(`catalogue country ${country.countryId} does not bind exactly one matching layer`);
  }
  return reportValue;
}

function exactCandidateMatch(pin: FineSourcePin, country: Record<string, unknown>, layer: Record<string, unknown>): void {
  const iso3 = country.iso3 as string;
  const suffix = `${pin.source.release}/releaseData/gbOpen/${iso3}/ADM1/geoBoundaries-${iso3}-ADM1.geojson`;
  const expectedSourceSuffix = `/releaseData/gbOpen/${iso3}/ADM1/geoBoundaries-${iso3}-ADM1.geojson`;
  if (pin.source.url !== `https://raw.githubusercontent.com/wmgeolab/geoBoundaries/${suffix}`
      && pin.source.url !== `https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/${suffix}`) throw new Error('reviewed source URL does not match the country catalogue package');
  const shortRelease = layer.shortReleaseCandidate;
  if (typeof shortRelease !== 'string' || !/^[a-f0-9]{7,40}$/.test(shortRelease) || !pin.source.release.startsWith(shortRelease)) throw new Error('reviewed source commit does not match the catalogue candidate release');
  const expectedCandidate = `https://github.com/wmgeolab/geoBoundaries/raw/${shortRelease}${expectedSourceSuffix}`;
  if (layer.candidateUrl !== expectedCandidate) throw new Error('catalogue candidate URL does not match its pinned package path');
  if (pin.layerId !== country.boundaryId || pin.layerId !== layer.boundaryId || pin.countryIso3 !== iso3
      || pin.expectedUnits !== layer.reportedAdminUnits) throw new Error('reviewed source identity or expected unit count does not match catalogue');
  if (pin.canonicalType !== layer.adminType || pin.representedYear !== layer.representedYear || pin.buildDate !== layer.buildDate) throw new Error('reviewed source metadata differs from the catalogue layer');
  if (pin.originalLicense !== layer.originalLicense || !pin.source.attribution.includes(layer.source as string)) throw new Error('reviewed source attribution/license differs from catalogue metadata');
  const licenseEvidenceTarget = String(layer.licenseSource).replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!licenseEvidenceTarget || !pin.licenseEvidence.some(url => url.replace(/^https?:\/\//, '').includes(licenseEvidenceTarget))) throw new Error('reviewed source license evidence does not bind the catalogue license source');
}

export function buildFineCampaignPlan(reportValue: FineDirectoryCatalogueReport, reportHash: string, reviewed: ReviewedFineCampaignInput[]): FineCampaignPlan {
  const report = checkedCatalogue(reportValue, reportHash);
  if (!Array.isArray(reviewed) || reviewed.length > report.countries.length) throw new TypeError('reviewed fine source inputs are invalid or exceed country count');
  const reviewedByCountry = new Map<string, { pin: FineSourcePin; topologyReportPath: string }>();
  for (const [index, entryValue] of reviewed.entries()) {
    const entry = object(entryValue, `reviewed source ${index}`);
    const pin = structuredClone(validateFineSourcePin(entry.pin));
    const topologyReportPath = text(entry.topologyReportPath, `reviewed source ${index} topology report path`, 512);
    if (!TOPOLOGY_PATH.test(topologyReportPath)) throw new TypeError('topology report path must be the exact bounded fine-topology reports cache path');
    if (reviewedByCountry.has(pin.source.id) || [...reviewedByCountry.values()].some(existing => existing.pin.countryIso3 === pin.countryIso3)) throw new Error('reviewed source pins repeat a source or country');
    reviewedByCountry.set(pin.source.id, { pin, topologyReportPath });
  }
  const units: FineCampaignUnit[] = report.countries.map(countryValue => {
    const country = countryValue as unknown as Record<string, unknown>;
    const countryId = country.countryId as string, name = country.name as string, iso3 = country.iso3 as string | null;
    const priority = country.priority as 0 | 1;
    const entry = iso3 ? [...reviewedByCountry.values()].find(value => value.pin.countryIso3 === iso3) : undefined;
    const layerCandidates = report.layers.filter(layer => layer.status !== 'invalid-metadata' && layer.iso3 === iso3 && layer.countryId === countryId);
    const layer = layerCandidates.length === 1 ? layerCandidates[0] as unknown as Record<string, unknown> : undefined;
    const make = (status: FineCampaignUnitStatus, reason: string): FineCampaignUnit => ({ countryId, name, priority, iso3, status, reason, pin: null, topologyReportPath: null });
    if (country.status === 'protected' || country.countryCode === 'NG' || countryId === 'legacy-ng') {
      if (entry) throw new Error(`protected country ${countryId} cannot accept a reviewed source pin`);
      return make('protected','Protected legacy Nigeria provider; country geometry acquisition and fine publication are prohibited.');
    }
    if (iso3 === 'GHA') {
      if (entry) throw new Error('Ghana OSM-derived layer is explicitly excluded pending source-license review');
      return make('excluded-source','Ghana GHA catalogue layer credits Open Street Map and records Creative Commons Attribution-ShareAlike 2.0 at openstreetmap.org/copyright; this differs from the reviewed geoBoundaries gbOpen source license evidence and requires source-specific licensing review. No source acquisition is admitted.');
    }
    if (country.status === 'missing-metadata') {
      if (entry) throw new Error(`country ${countryId} has no catalogue metadata for a reviewed source pin`);
      return make('missing-metadata','No unique ADM1 source layer was present in the pinned catalogue.');
    }
    if (country.status === 'ambiguous-iso3' || country.status === 'source-resolution-exception') {
      if (entry) throw new Error(`country ${countryId} has ambiguous source identity and cannot accept a reviewed pin`);
      return make('ambiguous-identity',country.status === 'ambiguous-iso3' ? 'Catalogue contains ambiguous ISO3 or layer identity; no source was selected.' : 'Coarse source references do not resolve to exactly one catalogue ISO3 layer.');
    }
    if (country.status !== 'linked' || !iso3 || !ISO3.test(iso3) || !layer || layer.status !== 'linked') throw new Error(`linked catalogue country ${countryId} has no unique linked source layer`);
    if (typeof layer.reportedAdminUnits !== 'number') throw new Error(`linked catalogue country ${countryId} has no reported unit count`);
    if (layer.reportedAdminUnits > 32) {
      if (entry) throw new Error(`country ${countryId} exceeds the bounded 32-unit pilot and cannot accept a non-partitioned pin`);
      return make('partition-required',`Catalogue reports ${layer.reportedAdminUnits} ADM1 units, above the 32-unit pilot cap; explicit partitioning is required.`);
    }
    if (!entry) return make('unreviewed-source','Catalogue metadata is discovery-only; no exact reviewed immutable source pin and topology report were supplied.');
    exactCandidateMatch(entry.pin, country, layer);
    return { countryId, name, priority, iso3, status:'ready', reason:'Exact catalogue identity, immutable source package, license evidence, and topology report path are linked for bounded processing.', pin:entry.pin, topologyReportPath:entry.topologyReportPath };
  });
  for (const { pin } of reviewedByCountry.values()) {
    const linked = report.countries.some(country => country.status === 'linked' && country.iso3 === pin.countryIso3 && country.countryId !== 'legacy-ng');
    if (!linked) throw new Error(`reviewed source pin does not match any eligible catalogue country: ${pin.countryIso3}`);
  }
  units.sort((a,b) => a.priority - b.priority || compareCodepoints(a.countryId,b.countryId));
  const counts = Object.fromEntries(STATUSES.map(status => [status, units.filter(unit => unit.status === status).length])) as Record<FineCampaignUnitStatus,number>;
  if (units.length !== report.countries.length || Object.values(counts).reduce((sum,value)=>sum+value,0) !== units.length) throw new Error('fine campaign plan does not conserve catalogue countries');
  return {
    schemaVersion:1,purpose:'administrative-build-campaign',parent:{product:'country-directory',manifestHash:report.parent.manifestHash},
    catalogueHash:reportHash,metadataSha256:report.pin.sha256,countryCount:units.length,units,counts,
  };
}
