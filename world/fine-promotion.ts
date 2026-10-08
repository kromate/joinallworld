import { canonicalJson, sha256 } from './pack.ts';
import { FINE_CATALOGUE_URL } from './fine-catalogue.ts';
import type { FineCatalogueCountry, FineCatalogueLayer } from './fine-catalogue.ts';
import type { FineDirectoryCatalogueReport } from './fine-directory-catalogue.ts';
import { buildFineCampaignPlan } from './fine-campaign-plan.ts';
import { parseFineLFSPointer } from './fine-lfs.ts';
import { validateFineSourcePin } from './fine.ts';
import { FINE_LIMITS, type FineSourcePin } from './fine-types.ts';
import { FINE_PROMOTION_POLICY, type FinePromotion, type FinePromotionContext, type FinePromotionRequest, type FinePromotionSelection } from './fine-promotion-types.ts';

const HASH=/^[a-f0-9]{64}$/;
const COMMIT=/^[a-f0-9]{40}$/;
const ISO2=/^[A-Z]{2}$/;
const ISO3=/^[A-Z]{3}$/;
const NE_LICENSE='https://www.naturalearthdata.com/about/terms-of-use/';
const CC_BY='https://creativecommons.org/licenses/by/4.0/';
const POINTER_BASE='https://raw.githubusercontent.com/wmgeolab/geoBoundaries/';
function object(value:unknown,label:string):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError(`${label} must be an object`);const prototype=Object.getPrototypeOf(value);if(prototype!==Object.prototype&&prototype!==null)throw new TypeError(`${label} must be a plain data object`);return value as Record<string,unknown>;}
function exact(value:Record<string,unknown>,keys:readonly string[],label:string):void{if(Object.keys(value).length!==keys.length||Object.keys(value).some(key=>!keys.includes(key)))throw new TypeError(`${label} has missing or unknown fields`);}
function text(value:unknown,label:string,max=2048):string{if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/.test(value))throw new TypeError(`${label} is invalid bounded text`);return value;}
function boundedCount(value:unknown,label:string,max:number):number{if(!Number.isSafeInteger(value)||Number(value)<1||Number(value)>max)throw new RangeError(`${label} is outside its bounded range`);return Number(value);}
function fatalJson(bytes:Uint8Array,label:string):unknown{try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;}catch(error){throw new TypeError(`${label} is invalid UTF-8 JSON: ${error instanceof Error?error.message:String(error)}`);}}
function naturalEarthLicenseSource(value:string):boolean{
  const raw=text(value,'Natural Earth license source',512);
  const href=raw.startsWith('https://')?raw:`https://${raw}`;
  try{const url=new URL(href);return url.protocol==='https:'&&url.hostname==='www.naturalearthdata.com'&&!url.port&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/about/terms-of-use/';}catch{return false;}
}
function parseRequest(value:unknown):FinePromotionRequest{
  const request=object(value,'fine promotion request');
  exact(request,['schemaVersion','policy','parent','catalogueHash','metadataSnapshot','metadataRow','country','layer','commit','pointerUrl'],'fine promotion request');
  if(request.schemaVersion!==1||request.policy!==FINE_PROMOTION_POLICY)throw new TypeError('fine promotion request schema or policy is unsupported');
  const parent=object(request.parent,'promotion parent');exact(parent,['product','manifestHash'],'promotion parent');
  if(parent.product!=='country-directory'||typeof parent.manifestHash!=='string'||!HASH.test(parent.manifestHash))throw new TypeError('promotion parent country-directory hash is invalid');
  if(typeof request.catalogueHash!=='string'||!HASH.test(request.catalogueHash))throw new TypeError('promotion catalogue hash is invalid');
  const snapshot=object(request.metadataSnapshot,'metadata snapshot');exact(snapshot,['sha256','bytes'],'metadata snapshot');
  if(typeof snapshot.sha256!=='string'||!HASH.test(snapshot.sha256))throw new TypeError('metadata snapshot SHA-256 is invalid');boundedCount(snapshot.bytes,'metadata snapshot bytes',2*1024*1024);
  const row=object(request.metadataRow,'metadata row pin');exact(row,['ordinal','sha256','bytes'],'metadata row pin');
  if(!Number.isSafeInteger(row.ordinal)||Number(row.ordinal)<0||Number(row.ordinal)>=300||typeof row.sha256!=='string'||!HASH.test(row.sha256))throw new TypeError('metadata row ordinal/hash is invalid');boundedCount(row.bytes,'metadata row bytes',64*1024);
  const country=object(request.country,'promotion country');exact(country,['id','code','iso3','name'],'promotion country');
  const countryId=text(country.id,'country ID',512),code=text(country.code,'country ISO2',2),iso3=text(country.iso3,'country ISO3',3),name=text(country.name,'country name',256);
  if(!/^[A-Za-z0-9][A-Za-z0-9:_%.-]{0,511}$/.test(countryId)||!ISO2.test(code)||!ISO3.test(iso3)||code==='NG'||iso3==='NGA'||countryId==='legacy-ng')throw new TypeError('promotion country identity is invalid or protected');
  if(code==='GH'||iso3==='GHA')throw new Error('Ghana source is excluded from the initial promotion policy');
  const layer=object(request.layer,'promotion layer');exact(layer,['id','canonicalType','representedYear','buildDate','expectedUnits'],'promotion layer');
  const layerId=text(layer.id,'layer ID',256),canonicalType=text(layer.canonicalType,'canonical type',128),year=text(layer.representedYear,'represented year',16),buildDate=text(layer.buildDate,'build date',64);
  if(!layerId.startsWith(`${iso3}-ADM1-`)||!/^(?:19|20)\d{2}$/.test(year))throw new TypeError('promotion layer identity or represented year is invalid');
  boundedCount(layer.expectedUnits,'expected ADM1 units',32);
  if(typeof request.commit!=='string'||!COMMIT.test(request.commit))throw new TypeError('promotion commit must be a full lowercase 40-hex commit');
  const pointerUrl=text(request.pointerUrl,'Git LFS pointer URL',2048);
  const expectedUrl=`${POINTER_BASE}${request.commit}/releaseData/gbOpen/${iso3}/ADM1/geoBoundaries-${iso3}-ADM1.geojson`;
  if(pointerUrl!==expectedUrl)throw new TypeError('Git LFS pointer URL must be the exact raw country and commit-pinned geoBoundaries path');
  return value as FinePromotionRequest;
}

/** Validate the structural request contract without making network or filesystem calls. */
export function validateFinePromotionRequest(value:unknown):FinePromotionRequest{return parseRequest(value);}

function validateContext(context:FinePromotionContext):{catalogue:FineDirectoryCatalogueReport;metadata:unknown[]}{
  if(!context||typeof context!=='object'||!(context.catalogueBytes instanceof Uint8Array)||!(context.metadataBytes instanceof Uint8Array))throw new TypeError('fine promotion context bytes are required');
  if(context.catalogueBytes.byteLength<1||context.catalogueBytes.byteLength>1_000_000||context.metadataBytes.byteLength<1||context.metadataBytes.byteLength>2*1024*1024)throw new RangeError('fine promotion context byte arrays exceed their bounded catalogue/metadata limits');
  const catalogueHash=text(context.catalogueHash,'catalogue hash',64);if(!HASH.test(catalogueHash)||sha256(context.catalogueBytes)!==catalogueHash)throw new Error('catalogue bytes do not match the supplied catalogue hash');
  const parsedCatalogue=fatalJson(context.catalogueBytes,'fine catalogue');
  if(canonicalJson(parsedCatalogue)!==canonicalJson(context.catalogue))throw new Error('parsed catalogue bytes differ from the supplied catalogue object');
  const catalogue=object(parsedCatalogue,'fine directory catalogue report') as unknown as FineDirectoryCatalogueReport;
  buildFineCampaignPlan(catalogue,catalogueHash,[]);
  if(context.metadataBytes.byteLength!==catalogue.pin.bytes||sha256(context.metadataBytes)!==catalogue.pin.sha256)throw new Error('full metadata bytes do not match the catalogue snapshot hash and length');
  const metadata=fatalJson(context.metadataBytes,'fine metadata snapshot');
  if(!Array.isArray(metadata)||metadata.length<1||metadata.length>300||metadata.length!==catalogue.expectedLayerCount)throw new Error('fine metadata snapshot must match the catalogue array denominator (1..300)');
  const directory=object(context.directory,'verified country directory');
  if(directory.manifestHash!==catalogue.parent.manifestHash)throw new Error('verified country directory hash differs from the catalogue parent');
  const manifest=object(directory.manifest,'country directory manifest');
  if(canonicalJson(manifest.source)!==canonicalJson(catalogue.coarseSources[0]))throw new Error('country-directory source pin differs from the catalogue coarse source pin');
  if(!Array.isArray(directory.nodes))throw new TypeError('verified country directory node list is invalid');
  return {catalogue,metadata:metadata as unknown[]};
}
function sourceCandidateUrl(iso3:string,commit:string):string{return `https://github.com/wmgeolab/geoBoundaries/raw/${commit}/releaseData/gbOpen/${iso3}/ADM1/geoBoundaries-${iso3}-ADM1.geojson`;}
function pointerUrl(iso3:string,commit:string):string{return `${POINTER_BASE}${commit}/releaseData/gbOpen/${iso3}/ADM1/geoBoundaries-${iso3}-ADM1.geojson`;}
function selectedBindings(context:FinePromotionContext,selection:FinePromotionSelection):{catalogue:FineDirectoryCatalogueReport;row:Record<string,unknown>;country:FineCatalogueCountry;node:Record<string,unknown>;layer:FineCatalogueLayer;metadataRowBytes:Uint8Array}{
  const checked=validateContext(context),selected=object(selection,'promotion selection');exact(selected,['countryId','countryIso3','commit'],'promotion selection');
  const countryId=text(selected.countryId,'selected country ID',512),iso3=text(selected.countryIso3,'selected country ISO3',3),commit=text(selected.commit,'selected commit',40);
  if(!ISO3.test(iso3)||!COMMIT.test(commit))throw new TypeError('selected country ISO3 or full commit is invalid');
  const catalogue=checked.catalogue;
  const countryRows=catalogue.countries.filter(country=>country.countryId===countryId);
  if(countryRows.length!==1)throw new Error('selected country does not resolve to exactly one catalogue row');
  const country=countryRows[0]!;
  if(country.countryId==='legacy-ng'||country.iso3==='NGA'||country.status==='protected'||iso3==='NGA')throw new Error('Nigeria/legacy-ng is protected from fine-source promotion');
  if(iso3==='GHA')throw new Error('Ghana source is excluded from the initial Natural Earth Public Domain promotion policy');
  if(country.status!=='linked'||country.iso3!==iso3)throw new Error('selected catalogue country must have one linked ISO3 identity');
  const matchingLayers=catalogue.layers.filter(layer=>layer.status==='linked'&&layer.countryId===countryId&&layer.iso3===iso3);
  if(matchingLayers.length!==1)throw new Error('selected country does not resolve to exactly one linked ADM1 layer');
  const layer=matchingLayers[0]!;
  if(layer.reportedAdminUnits===null||layer.reportedAdminUnits<1||layer.reportedAdminUnits>32)throw new Error('selected ADM1 layer is missing a bounded unit count or exceeds the 32-unit pilot cap');
  if(layer.source!=='Natural Earth'||layer.originalLicense!=='Public Domain'||!layer.licenseSource||!naturalEarthLicenseSource(layer.licenseSource))throw new Error('initial promotion requires Natural Earth source, exact Public Domain license, and Natural Earth terms evidence');
  if(!layer.candidateUrl||!layer.shortReleaseCandidate||!new RegExp(`^${iso3}-ADM1-[A-Za-z0-9-]+$`).test(layer.boundaryId??''))throw new Error('selected layer candidate metadata is incomplete');
  if(!commit.startsWith(layer.shortReleaseCandidate))throw new Error('selected full commit does not extend the catalogue short release candidate');
  if(layer.candidateUrl!==`https://github.com/wmgeolab/geoBoundaries/raw/${layer.shortReleaseCandidate}/releaseData/gbOpen/${iso3}/ADM1/geoBoundaries-${iso3}-ADM1.geojson`)throw new Error('catalogue candidate URL is not the exact geoBoundaries country package path');
  const directory=object(context.directory,'verified country directory'),nodes=directory.nodes as Array<Record<string,unknown>>;
  const matches=nodes.filter(node=>node.id===countryId&&node.kind==='country');
  if(matches.length!==1)throw new Error('selected country does not resolve to exactly one verified directory country node');
  const node=matches[0]!;
  if(node.id==='legacy-ng'||node.provider!=='world'||typeof node.countryCode!=='string'||!ISO2.test(node.countryCode))throw new Error('verified directory country node is protected or has an invalid country code');
  if(node.countryCode==='NG')throw new Error('Nigeria/legacy-ng is protected from fine-source promotion');
  if(!Array.isArray(node.sourceFeatureIds)||canonicalJson(node.sourceFeatureIds)!==canonicalJson(country.sourceFeatureIds))throw new Error('verified directory source feature references differ from catalogue country binding');
  const metadataRow=checked.metadata[layer.ordinal];
  if(!metadataRow||typeof metadataRow!=='object'||Array.isArray(metadataRow))throw new Error('selected raw metadata ordinal does not contain an object');
  const row=metadataRow as Record<string,unknown>;
  const equality:[string,unknown][]=[
    ['boundaryID',layer.boundaryId],['boundaryISO',layer.iso3],['boundaryName',layer.name],['boundaryType','ADM1'],
    ['boundaryYearRepresented',layer.representedYear],['boundaryCanonical',layer.adminType],['buildDate',layer.buildDate],
    ['boundarySource',layer.source],['boundaryLicense',layer.originalLicense],['licenseSource',layer.licenseSource],['gjDownloadURL',layer.candidateUrl],
  ];
  for(const [field,expected] of equality){if(typeof row[field]!=='string'||row[field]!==expected)throw new Error(`raw metadata field ${field} differs from its catalogue-derived value`);}
  const countText=row.admUnitCount;
  if(typeof countText!=='string'||!/^[1-9][0-9]{0,8}$/.test(countText)||Number(countText)!==layer.reportedAdminUnits)throw new Error('raw metadata ADM1 unit count differs from the catalogue report');
  if(row.gjDownloadURL!==sourceCandidateUrl(iso3,layer.shortReleaseCandidate))throw new Error('raw metadata candidate URL does not bind selected country/layer/release');
  const rowBytes=new TextEncoder().encode(canonicalJson(row));
  if(rowBytes.byteLength<1||rowBytes.byteLength>64*1024)throw new RangeError('canonical selected metadata row exceeds the 64 KiB source metadata pin cap');
  return {catalogue,row,country,node,layer,metadataRowBytes:rowBytes};
}

/** Build a source promotion request from verified, hash-bound local inputs only. */
export function buildFinePromotionRequest(context:FinePromotionContext,selection:FinePromotionSelection):FinePromotionRequest{
  const bound=selectedBindings(context,selection),selectionRow=object(selection,'promotion selection'),iso3=String(selectionRow.countryIso3),commit=String(selectionRow.commit);
  const request:FinePromotionRequest={schemaVersion:1,policy:FINE_PROMOTION_POLICY,parent:{product:'country-directory',manifestHash:bound.catalogue.parent.manifestHash},catalogueHash:context.catalogueHash,
    metadataSnapshot:{sha256:bound.catalogue.pin.sha256,bytes:bound.catalogue.pin.bytes},metadataRow:{ordinal:bound.layer.ordinal,sha256:sha256(bound.metadataRowBytes),bytes:bound.metadataRowBytes.byteLength},
    country:{id:bound.country.countryId,code:String(bound.node.countryCode),iso3,name:bound.country.name},
    layer:{id:bound.layer.boundaryId!,canonicalType:bound.layer.adminType!,representedYear:bound.layer.representedYear!,buildDate:bound.layer.buildDate!,expectedUnits:bound.layer.reportedAdminUnits!},
    commit,pointerUrl:pointerUrl(iso3,commit)};
  return validateFinePromotionRequest(request);
}

/** Bind an admitted Git LFS pointer to a local-only Natural Earth/geoBoundaries fine-source pin. */
export function buildFineSourcePromotion(context:FinePromotionContext,selection:FinePromotionSelection,pointerBytes:Uint8Array):FinePromotion{
  const request=buildFinePromotionRequest(context,selection),bound=selectedBindings(context,selection);
  const pointer=parseFineLFSPointer(pointerBytes,FINE_LIMITS.sourceBytes);
  const sourceUrl=`https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/${request.commit}/releaseData/gbOpen/${request.country.iso3}/ADM1/geoBoundaries-${request.country.iso3}-ADM1.geojson`;
  const pin:FineSourcePin=validateFineSourcePin({schemaVersion:1,provider:'geoBoundaries',source:{id:`stable-gbopen-${request.country.iso3.toLowerCase()}-adm1`,url:sourceUrl,release:request.commit,license:'CC-BY-4.0 (geoBoundaries gbOpen)',attribution:`Natural Earth; geoBoundaries gbOpen (${request.country.iso3} ADM1)`,sha256:pointer.sha256,bytes:pointer.bytes},
    input:`.cache/world-build/fine-source-cache/${pointer.sha256}.geojson`,countryCode:request.country.code,countryIso3:request.country.iso3,adminLevel:'ADM1',layerId:request.layer.id,canonicalType:request.layer.canonicalType,representedYear:request.layer.representedYear,buildDate:request.layer.buildDate,
    expectedUnits:request.layer.expectedUnits,originalLicense:'Public Domain',licenseEvidence:[FINE_CATALOGUE_URL,NE_LICENSE,CC_BY],metadataSha256:request.metadataRow.sha256,metadataBytes:request.metadataRow.bytes,
    boundaryPolicy:'Preserve the exact published source geometry and stated administrative unit labels. The display is a source depiction, not legal boundary adjudication or sovereignty evidence.'});
  return {request,metadataRowBytes:bound.metadataRowBytes,pointer,pin};
}
