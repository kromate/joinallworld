import { createHash } from 'node:crypto';
import type { WorldInventory, InventoryNode } from './production-types.ts';
import type { SourceRecord } from './types.ts';
import { validateInventory } from './inventory.ts';

export const FINE_CATALOGUE_URL = 'https://www.geoboundaries.org/api/current/gbOpen/ALL/ADM1/';
export const FINE_CATALOGUE_MAX_BYTES = 2 * 1024 * 1024;
export const FINE_CATALOGUE_MAX_LAYERS = 300;
export const FINE_CATALOGUE_PILOT_UNITS = 32;

export interface FineCataloguePin { sourceUrl: string; sha256: string; bytes: number; capturedAt: string }
export interface FineCatalogueLayer {
  ordinal: number; boundaryId: string | null; iso3: string | null; name: string | null;
  adminType: string | null; representedYear: string | null; buildDate: string | null;
  source: string | null; originalLicense: string | null; licenseSource: string | null;
  candidateUrl: string | null; shortReleaseCandidate: string | null;
  reportedAdminUnits: number | null; pilotUnitLimit: 32; pilotStatus: 'within-limit' | 'too-large' | 'unknown';
  countryId: string | null; priority: number | null;
  status: 'linked' | 'protected' | 'missing-coarse-country' | 'ambiguous-iso3' | 'source-resolution-exception' | 'invalid-metadata';
  exceptions: string[];
}
export interface FineCatalogueCountry {
  countryId: string; name: string; sourceFeatureIds: string[]; iso3: string | null;
  boundaryId: string | null; priority: number | null;
  status: 'linked' | 'protected' | 'missing-metadata' | 'ambiguous-iso3' | 'source-resolution-exception';
  exceptions: string[];
}
export interface FineCatalogueReport {
  schemaVersion: 1; purpose: 'metadata-discovery-only'; pin: FineCataloguePin;
  coarseSources: SourceRecord[];
  expectedLayerCount: number; reportedLayerCount: number;
  counts: { metadataRecords: number; validAdm1Layers: number; invalidMetadataRecords: number; duplicateIso3Groups: number; linkedCountries: number; missingMetadataCountries: number; protectedCountries: number; ambiguousCountries: number; tooLargeForPilot: number };
  sourceCounts: { coarseSourceUnits: number; coarseCountryNodes: number; metadataReportedAdminUnits: number; metadataUnitCountsKnown: number };
  layers: FineCatalogueLayer[]; countries: FineCatalogueCountry[];
  exceptions: string[];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const boundedText = (v: unknown, max = 512): string | null => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v) ? v.trim() : null;
const iso3 = (v: unknown): string | null => typeof v === 'string' && /^[A-Z]{3}$/.test(v) && v !== 'XXX' ? v : null;
const safeCount = (v: unknown): number | null => typeof v === 'string' && /^(0|[1-9][0-9]{0,8})$/.test(v) && Number.isSafeInteger(Number(v)) ? Number(v) : null;
const candidate = (v: unknown, expectedIso: string | null): { url: string | null; release: string | null } => {
  const url = boundedText(v, 2048); if (!url) return { url: null, release: null };
  try { if (!expectedIso || !/^https:\/\/github\.com\//.test(url)) return { url: null, release: null }; const u = new URL(url); if (u.protocol !== 'https:' || u.hostname !== 'github.com' || u.username || u.password || u.port || u.search || u.hash) return { url: null, release: null };
    const m = u.pathname.match(/^\/wmgeolab\/geoBoundaries\/raw\/([0-9a-f]{7,40})\/releaseData\/gbOpen\/([A-Z]{3})\/ADM1\/geoBoundaries-([A-Z]{3})-ADM1\.geojson$/);
    if (!m || m[2] !== expectedIso || m[3] !== expectedIso) return { url: null, release: null };
    return { url: u.href, release: m[1]! };
  } catch { return { url: null, release: null }; }
};
function featureKey(feature: Obj): string | null {
  const props = obj(feature.properties) ? feature.properties : {};
  const usable = (v: unknown) => (typeof v === 'string' || typeof v === 'number') && String(v).trim() !== '' && String(v) !== '-99';
  if (usable(props.NE_ID)) return `NE_ID:${props.NE_ID}`;
  if (usable(props.ADM0_A3)) return `ADM0_A3:${props.ADM0_A3}`;
  return usable(feature.id) ? `feature-id:${feature.id}` : null;
}
function countryIso3FromFeature(feature: Obj): string | null {
  const p = obj(feature.properties) ? feature.properties : {};
  return iso3(p.ISO_A3_EH) ?? iso3(p.ADM0_A3);
}
function priorityFor(inventory: WorldInventory, country: InventoryNode): number {
  return inventory.nodes.find(n => n.id === country.parentId)?.id === 'continent:africa' ? 0 : 1;
}
function assertPin(bytes: Uint8Array, pin: FineCataloguePin): void {
  if (!pin || pin.sourceUrl !== FINE_CATALOGUE_URL || !/^[a-f0-9]{64}$/.test(pin.sha256) || !Number.isSafeInteger(pin.bytes) || pin.bytes !== bytes.byteLength || bytes.byteLength < 1 || bytes.byteLength > FINE_CATALOGUE_MAX_BYTES || createHash('sha256').update(bytes).digest('hex') !== pin.sha256 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(pin.capturedAt) || !Number.isFinite(Date.parse(pin.capturedAt))) throw new TypeError('metadata snapshot pin, byte count, hash, or capture time is invalid');
}

/** Pure discovery report builder. It never fetches metadata or candidate geometries. */
export function buildFineCatalogue(metadataBytes: Uint8Array, pin: FineCataloguePin, coarse: WorldInventory, coarseGeoJSON: unknown): FineCatalogueReport {
  assertPin(metadataBytes, pin);
  validateInventory(coarse);
  if (coarse.sources.length !== 1) throw new TypeError('coarse raw GeoJSON mapping requires exactly one pinned source');
  const fc = obj(coarseGeoJSON) && coarseGeoJSON.type === 'FeatureCollection' && Array.isArray(coarseGeoJSON.features) ? coarseGeoJSON : null;
  if (!fc) throw new TypeError('coarse source must be a bounded FeatureCollection matching the inventory source denominator');
  const coarseFeatures = fc.features as unknown[];
  if (coarseFeatures.length > 10_000 || coarseFeatures.length !== coarse.sourceUnitCount) throw new TypeError('coarse source must be a bounded FeatureCollection matching the inventory source denominator');
  const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(metadataBytes));
  if (!Array.isArray(data) || data.length < 1 || data.length > FINE_CATALOGUE_MAX_LAYERS) throw new TypeError('metadata must be a nonempty array of at most 300 layers');

  const featuresByRef = new Map<string, Obj[]>();
  const featureRows: Array<{ feature: Obj; ref: string | null; iso: string | null }> = [];
  const inventoryRefs = new Set(coarse.nodes.flatMap(n => n.sourceFeatureIds));
  const seenFeatureRefs = new Set<string>();
  const sourceId = coarse.sources[0]!.id;
  for (const raw of coarseFeatures) {
    if (!obj(raw) || raw.type !== 'Feature' || !obj(raw.properties)) throw new TypeError('coarse GeoJSON contains a malformed source feature');
    const key = featureKey(raw);
    if (!key) throw new TypeError('coarse GeoJSON source feature has no stable source identity');
    const ref = `${sourceId}:${key}`;
    if (!inventoryRefs.has(ref)) throw new Error(`coarse GeoJSON feature is not referenced by the validated inventory: ${ref}`);
    if (seenFeatureRefs.has(ref)) throw new Error(`coarse GeoJSON repeats source feature identity: ${ref}`);
    seenFeatureRefs.add(ref);
    const group = featuresByRef.get(ref) ?? []; group.push(raw); featuresByRef.set(ref, group);
    featureRows.push({ feature: raw, ref, iso: countryIso3FromFeature(raw) });
  }
  if (seenFeatureRefs.size !== inventoryRefs.size || [...inventoryRefs].some(ref => !seenFeatureRefs.has(ref))) throw new Error('coarse GeoJSON source features do not match exact inventory references');
  const isoFeatureRefs = new Map<string, Set<string>>();
  for (const row of featureRows) if (row.iso && row.ref) { const set = isoFeatureRefs.get(row.iso) ?? new Set<string>(); set.add(row.ref); isoFeatureRefs.set(row.iso, set); }
  const countryRows = coarse.nodes.filter(n => n.kind === 'country');
  const countryByIso = new Map<string, InventoryNode[]>();
  for (const country of countryRows) {
    const refs = country.sourceFeatureIds;
    const refsFeatures = refs.flatMap(ref => featuresByRef.get(ref) ?? []);
    const isos = new Set(refsFeatures.map(countryIso3FromFeature).filter((x): x is string => !!x));
    // The inventory linkage must resolve to exactly one source feature and one ISO3.
    const resolved = refs.length === 1 && refsFeatures.length === 1 && isos.size === 1 && isoFeatureRefs.get([...isos][0]!)?.size === 1 ? [...isos][0]! : null;
    if (resolved) { const group = countryByIso.get(resolved) ?? []; group.push(country); countryByIso.set(resolved, group); }
  }
  const unresolvedIsoFeatures = new Set(featureRows.filter(row=>row.iso&&row.ref).filter(row=>!countryRows.some(country=>country.sourceFeatureIds.length===1&&country.sourceFeatureIds[0]===row.ref)).map(row=>row.iso!));

  const rawLayers: FineCatalogueLayer[] = [];
  const validIdentityCounts = new Map<string, number>();
  const recordInfos: Array<{ row: Obj | null; iso: string | null; boundaryId: string | null; count: number | null; identityValid: boolean }> = [];
  for (const [ordinal, raw] of data.entries()) {
    const row = obj(raw) ? raw : null;
    const layerIso = row ? iso3(row.boundaryISO) : null;
    const id = row ? boundedText(row.boundaryID, 160) : null;
    const type = row ? boundedText(row.boundaryType, 16) : null;
    const count = row ? safeCount(row.admUnitCount) : null;
    const identityValid = !!row && !!layerIso && !!id && type === 'ADM1' && !!count && id.startsWith(`${layerIso}-ADM1-`);
    if (identityValid) { const k = `${layerIso}:ADM1:${id}`; validIdentityCounts.set(k, (validIdentityCounts.get(k) ?? 0) + 1); }
    recordInfos.push({ row, iso: layerIso, boundaryId: id, count, identityValid });
  }
  const duplicateIso3 = new Set<string>();
  const isoRecordCounts = new Map<string, number>();
  for (const info of recordInfos) if (info.identityValid && info.iso) isoRecordCounts.set(info.iso,(isoRecordCounts.get(info.iso)??0)+1);
  for (const [code, n] of isoRecordCounts) if (n > 1) duplicateIso3.add(code);
  const duplicateIdentity = new Set([...validIdentityCounts].filter(([,n])=>n>1).map(([k])=>k));
  const metadataIsoSet = new Set(recordInfos.filter(x=>x.identityValid).map(x=>x.iso!));

  for (let ordinal=0; ordinal<recordInfos.length; ordinal++) {
    const info = recordInfos[ordinal]!, row = info.row;
    const c = row ? candidate(row.gjDownloadURL, info.iso) : { url:null, release:null };
    const idKey = info.iso && info.boundaryId ? `${info.iso}:ADM1:${info.boundaryId}` : '';
    const exceptions: string[] = [];
    if (!info.identityValid) exceptions.push('invalid or incomplete ADM1 identity/count metadata; row retained without unit-count admission');
    if (info.iso && duplicateIso3.has(info.iso)) exceptions.push('ISO3 occurs more than once in discovery metadata; no unique country-to-layer choice');
    if (duplicateIdentity.has(idKey)) exceptions.push('duplicate ISO3/ADM1/boundaryID tuple');
    if (row && !c.url) exceptions.push('candidate GeoJSON URL did not match the bounded geoBoundaries GitHub raw path shape');
    const matchedCountries = info.iso ? countryByIso.get(info.iso) ?? [] : [];
    const duplicateFeatureMapping = info.iso ? (isoFeatureRefs.get(info.iso)?.size ?? 0) > 1 || matchedCountries.length > 1 : false;
    const country = matchedCountries.length === 1 && !duplicateFeatureMapping ? matchedCountries[0]! : null;
    let status: FineCatalogueLayer['status'] = 'invalid-metadata';
    if (info.identityValid && info.iso && duplicateIso3.has(info.iso)) status = 'ambiguous-iso3';
    else if (info.identityValid && duplicateIdentity.has(idKey)) status = 'ambiguous-iso3';
    else if (info.identityValid && country && country.provider === 'legacy-ng') status = 'protected';
    else if (info.identityValid && country) status = 'linked';
    else if (info.identityValid && matchedCountries.length > 1 || (info.identityValid && duplicateFeatureMapping)) { status = 'source-resolution-exception'; exceptions.push('multiple coarse country/source-feature mappings resolve to this ISO3'); }
    else if (info.identityValid) { status = info.iso && unresolvedIsoFeatures.has(info.iso) ? 'source-resolution-exception' : 'missing-coarse-country'; exceptions.push('no unique coarse Natural Earth country feature maps to metadata ISO3'); }
    if (status === 'invalid-metadata' && !exceptions.length) exceptions.push('metadata layer was not admitted for mapping');
    const priority = country ? priorityFor(coarse,country) : null;
    const reportedName = row ? boundedText(row.boundaryName, 256) : null;
    rawLayers.push({ ordinal, boundaryId:info.boundaryId, iso3:info.iso, name:reportedName,
      adminType:row?boundedText(row.boundaryCanonical,128):null, representedYear:row?boundedText(row.boundaryYearRepresented,32):null,
      buildDate:row?boundedText(row.buildDate,64):null, source:row?boundedText(row.boundarySource,256):null,
      originalLicense:row?boundedText(row.boundaryLicense,256):null, licenseSource:row?boundedText(row.licenseSource,512):null,
      candidateUrl:c.url, shortReleaseCandidate:c.release, reportedAdminUnits:info.count, pilotUnitLimit:FINE_CATALOGUE_PILOT_UNITS,
      pilotStatus:info.count === null ? 'unknown' : info.count > FINE_CATALOGUE_PILOT_UNITS ? 'too-large' : 'within-limit',
      countryId:country?.id ?? null, priority, status, exceptions });
  }

  const byIsoLayers = new Map<string, FineCatalogueLayer[]>();
  for (const layer of rawLayers) if(layer.iso3 && layer.status !== 'invalid-metadata'){const a=byIsoLayers.get(layer.iso3)??[];a.push(layer);byIsoLayers.set(layer.iso3,a);}
  const countries: FineCatalogueCountry[] = countryRows.map(country=>{
    const refsFeatures=country.sourceFeatureIds.flatMap(ref=>featuresByRef.get(ref)??[]);
    const isos=new Set(refsFeatures.map(countryIso3FromFeature).filter((x):x is string=>!!x));
    const iso=country.sourceFeatureIds.length===1 && refsFeatures.length===1 && isos.size===1 && isoFeatureRefs.get([...isos][0]!)?.size===1 ? [...isos][0]! : null;
    const priority=priorityFor(coarse,country); const layerRows=iso?byIsoLayers.get(iso)??[]:[];
    let status:FineCatalogueCountry['status']; let boundaryId:string|null=null; const exceptions:string[]=[];
    if(country.provider==='legacy-ng'){status='protected'; if(layerRows.length)boundaryId=layerRows[0]!.boundaryId; exceptions.push('protected legacy Nigeria provider; catalogue does not authorize replacement or content generation');}
    else if(!iso){status='source-resolution-exception';exceptions.push('sourceFeatureIds did not resolve through exactly one Natural Earth feature to one ISO3');}
    else if(duplicateIso3.has(iso)){status='ambiguous-iso3';exceptions.push('metadata contains multiple ADM1 rows for ISO3; no unique layer linkage');}
    else if(layerRows.length===0){status='missing-metadata';exceptions.push('coarse country ISO3 absent from captured ADM1 metadata');}
    else {boundaryId=layerRows[0]!.boundaryId;status=layerRows[0]!.status==='linked'?'linked':layerRows[0]!.status==='protected'?'protected':layerRows[0]!.status==='source-resolution-exception'?'source-resolution-exception':'ambiguous-iso3';if(status!=='linked')exceptions.push(...layerRows[0]!.exceptions);}
    return {countryId:country.id,name:country.name,sourceFeatureIds:[...country.sourceFeatureIds],iso3:iso,boundaryId,priority,status,exceptions};
  });
  const knownCounts=rawLayers.map(l=>l.reportedAdminUnits).filter((x):x is number=>x!==null);
  const totalReported=knownCounts.reduce((sum,n)=>sum+n,0);
  const countBy=(s:FineCatalogueCountry['status'])=>countries.filter(c=>c.status===s).length;
  const exceptions=[
    `${duplicateIso3.size} ISO3 code(s) have duplicate ADM1 metadata rows; all source rows are retained and marked ambiguous.`,
    'Discovery metadata describes candidate datasets only; license strings are preserved as supplied and are not license admission.',
    'The 1:110m Natural Earth coarse inventory is a limited denominator; absent countries are not claims about sovereign status or world coverage.',
    'Pilot limit is 32 reported units per layer; over-limit rows remain in the catalogue and are not silently dropped.',
  ];
  return { schemaVersion:1,purpose:'metadata-discovery-only',pin:{...pin},coarseSources:coarse.sources.map(s=>({...s})),expectedLayerCount:data.length,reportedLayerCount:rawLayers.length,
    counts:{metadataRecords:data.length,validAdm1Layers:recordInfos.filter(x=>x.identityValid).length,invalidMetadataRecords:recordInfos.filter(x=>!x.identityValid).length,duplicateIso3Groups:duplicateIso3.size,
      linkedCountries:countBy('linked'),missingMetadataCountries:countBy('missing-metadata'),protectedCountries:countBy('protected'),ambiguousCountries:countBy('ambiguous-iso3'),tooLargeForPilot:rawLayers.filter(l=>l.pilotStatus==='too-large').length},
    sourceCounts:{coarseSourceUnits:coarse.sourceUnitCount,coarseCountryNodes:countryRows.length,metadataReportedAdminUnits:totalReported,metadataUnitCountsKnown:knownCounts.length},layers:rawLayers,countries,exceptions};
}
