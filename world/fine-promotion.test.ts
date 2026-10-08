import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildInventory } from './inventory.ts';
import { buildFineDirectoryCatalogue } from './fine-directory-catalogue.ts';
import { buildFinePromotionRequest, buildFineSourcePromotion, validateFinePromotionRequest } from './fine-promotion.ts';
import { FINE_PROMOTION_POLICY, type FinePromotionContext, type FinePromotionSelection } from './fine-promotion-types.ts';
import type { FineSourcePin } from './fine-types.ts';
import type { SourceRecord } from './types.ts';

const sha=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
const release='abcdef1'+'0'.repeat(33),short=release.slice(0,7),parentHash='d'.repeat(64),snapshotUrl='https://www.geoboundaries.org/api/current/gbOpen/ALL/ADM1/';
const NE_TERMS='https://www.naturalearthdata.com/about/terms-of-use/';
const CC_BY='https://creativecommons.org/licenses/by/4.0/';
const iso2:Record<string,string>={RWA:'RW',GHA:'GH',NGA:'NG'};
const ring=[[28,-3],[31,-3],[31,-1],[28,-1],[28,-3]];
function candidate(iso3:string,rev=short){return `https://github.com/wmgeolab/geoBoundaries/raw/${rev}/releaseData/gbOpen/${iso3}/ADM1/geoBoundaries-${iso3}-ADM1.geojson`;}
function row(iso3:string,options:{source?:string;license?:string;licenseSource?:string;units?:number;url?:string;name?:string}={}){
  return {boundaryID:`${iso3}-ADM1-0001`,boundaryISO:iso3,boundaryName:options.name??(iso3==='RWA'?'Rwanda':iso3),boundaryType:'ADM1',admUnitCount:String(options.units??5),gjDownloadURL:options.url??candidate(iso3),boundaryCanonical:'Province',boundaryYearRepresented:'2020',buildDate:'Dec 12, 2023',boundarySource:options.source??'Natural Earth',boundaryLicense:options.license??'Public Domain',licenseSource:options.licenseSource??NE_TERMS};
}
function feature(iso3:string,neId:number){return {type:'Feature',id:neId,properties:{NE_ID:neId,ADMIN:iso3==='RWA'?'Rwanda':iso3==='NGA'?'Nigeria':'Ghana',CONTINENT:'Africa',ISO_A2_EH:iso2[iso3],ISO_A3_EH:iso3,ADM0_A3:iso3},geometry:{type:'Polygon',coordinates:[ring]}};}
function makeContext(options:{countryIso3?:string;rowOptions?:Parameters<typeof row>[1];units?:number}={}):{context:FinePromotionContext;selection:FinePromotionSelection}{
  const iso3=options.countryIso3??'RWA',metadataRows=[row(iso3,{...options.rowOptions,units:options.units??options.rowOptions?.units}),row('NGA',{source:'Nigeria source',license:'Other license',licenseSource:'https://example.invalid/license',units:37})];
  const metadataBytes=Buffer.from(JSON.stringify(metadataRows)),coarseRaw={type:'FeatureCollection',features:[feature(iso3,1),feature('NGA',2)]};
  const source:SourceRecord={id:'natural-earth-admin0-test',url:'https://example.invalid/admin0.geojson',release:'1'.repeat(40),license:'Public Domain',attribution:'Natural Earth',sha256:sha(Buffer.from('source')),bytes:6};
  source.sha256=sha(Buffer.from(JSON.stringify(coarseRaw)));source.bytes=Buffer.byteLength(JSON.stringify(coarseRaw));
  const inventory=buildInventory(source,coarseRaw),metadataPin={sourceUrl:snapshotUrl,sha256:sha(metadataBytes),bytes:metadataBytes.length,capturedAt:'2026-10-08T00:00:00Z'};
  const catalogue=buildFineDirectoryCatalogue(metadataBytes,metadataPin,inventory,coarseRaw,parentHash),catalogueBytes=Buffer.from(`${JSON.stringify(catalogue,null,2)}\n`),catalogueHash=sha(catalogueBytes);
  const directory={manifestHash:parentHash,manifest:{source},nodes:inventory.nodes} as unknown as FinePromotionContext['directory'];
  const context:FinePromotionContext={catalogueBytes,catalogueHash,catalogue,metadataBytes,directory};
  const country=catalogue.countries.find(item=>item.iso3===iso3)!;
  return {context,selection:{countryId:country.countryId,countryIso3:iso3,commit:release}};
}
const pointer=(size=2_048)=>Buffer.from(`version https://git-lfs.github.com/spec/v1\noid sha256:${'a'.repeat(64)}\nsize ${size}\n`);

test('creates a promotion request and pin only from matching catalogue, metadata, and verified directory identities',()=>{
  const {context,selection}=makeContext(),request=buildFinePromotionRequest(context,selection),promotion=buildFineSourcePromotion(context,selection,pointer());
  assert.equal(request.schemaVersion,1);assert.equal(request.policy,FINE_PROMOTION_POLICY);assert.deepEqual(request.parent,{product:'country-directory',manifestHash:parentHash});
  assert.equal(request.country.id,selection.countryId);assert.equal(request.country.code,'RW');assert.equal(request.country.iso3,'RWA');
  assert.equal(request.layer.expectedUnits,5);assert.equal(request.commit,release);
  assert.equal(request.pointerUrl,`https://raw.githubusercontent.com/wmgeolab/geoBoundaries/${release}/releaseData/gbOpen/RWA/ADM1/geoBoundaries-RWA-ADM1.geojson`);assert.equal(request.metadataSnapshot.sha256,context.catalogue.pin.sha256);
  assert.equal(request.metadataRow.sha256,sha(promotion.metadataRowBytes));assert.equal(request.metadataRow.bytes,promotion.metadataRowBytes.length);
  assert.equal(promotion.pointer.bytes,2_048);assert.equal(promotion.pin.source.sha256,'a'.repeat(64));assert.equal(promotion.pin.source.bytes,2_048);
  assert.equal(promotion.pin.source.url,`https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/${release}/releaseData/gbOpen/RWA/ADM1/geoBoundaries-RWA-ADM1.geojson`);
  assert.equal(promotion.pin.originalLicense,'Public Domain');assert.ok(promotion.pin.licenseEvidence.includes(NE_TERMS));assert.ok(promotion.pin.licenseEvidence.includes(CC_BY));
  assert.deepEqual(validateFinePromotionRequest(request),request);
});

test('rejects catalogue-byte, metadata-snapshot, and parent directory mismatches',()=>{
  const {context,selection}=makeContext();
  const changedCatalogue={...context,catalogueBytes:Buffer.from(' ') };assert.throws(()=>buildFinePromotionRequest(changedCatalogue,selection),/catalogue bytes do not match/);
  const changedMetadata={...context,metadataBytes:Buffer.from('[]')};assert.throws(()=>buildFinePromotionRequest(changedMetadata,selection),/full metadata bytes do not match/);
  const changedDirectory={...context,directory:{...context.directory,manifestHash:'e'.repeat(64)}};assert.throws(()=>buildFinePromotionRequest(changedDirectory,selection),/directory hash differs/);
});

test('refuses protected Nigeria and the excluded Ghana source regardless of pointer contents',()=>{
  const ordinary=makeContext();
  assert.throws(()=>buildFinePromotionRequest(ordinary.context,{countryId:'legacy-ng',countryIso3:'NGA',commit:ordinary.selection.commit}),/Nigeria\/legacy-ng is protected/);
  const ghana=makeContext({countryIso3:'GHA',rowOptions:{source:'Open Street Map',license:'Creative Commons Attribution-ShareAlike 2.0',licenseSource:'https://www.openstreetmap.org/copyright'}});
  assert.throws(()=>buildFinePromotionRequest(ghana.context,ghana.selection),/Ghana source is excluded/);
});

test('rejects a selected unit count above pilot cap and a full commit not extending the metadata short commit',()=>{
  const large=makeContext({units:33});assert.throws(()=>buildFinePromotionRequest(large.context,large.selection),/bounded unit count|32-unit pilot cap/);
  const mismatch=makeContext();assert.throws(()=>buildFinePromotionRequest(mismatch.context,{...mismatch.selection,commit:'b'.repeat(40)}),/does not extend the catalogue short release/);
});

test('rejects raw metadata rows forged after discovery or candidate URL mismatches',()=>{
  const base=makeContext(),metadata=JSON.parse(Buffer.from(base.context.metadataBytes).toString('utf8')) as Array<Record<string,unknown>>;
  metadata[0]!.boundaryName='Forged Rwanda';const metadataBytes=Buffer.from(JSON.stringify(metadata));
  const catalogue={...base.context.catalogue,pin:{...base.context.catalogue.pin,sha256:sha(metadataBytes),bytes:metadataBytes.length}};
  const catalogueBytes=Buffer.from(`${JSON.stringify(catalogue,null,2)}\n`),forged={...base.context,catalogue,catalogueBytes,catalogueHash:sha(catalogueBytes),metadataBytes};
  const country=catalogue.countries.find(item=>item.iso3==='RWA')!;
  assert.throws(()=>buildFinePromotionRequest(forged,{...base.selection,countryId:country.countryId}),/raw metadata field boundaryName differs/);
  const wrong=makeContext({rowOptions:{url:`${candidate('RWA')}?download=1`}});
  assert.throws(()=>buildFinePromotionRequest(wrong.context,wrong.selection),/candidate/);
});

test('rejects a verified-directory source-reference mismatch and structural request forgery',()=>{
  const base=makeContext(),wrongNode={...base.context.directory.nodes.find(node=>node.kind==='country'&&node.id===base.selection.countryId)!,sourceFeatureIds:['forged:source:key']};
  const nodes=base.context.directory.nodes.map(node=>node.id===base.selection.countryId?wrongNode:node);
  const forgedDirectory={...base.context,directory:{...base.context.directory,nodes}};
  assert.throws(()=>buildFinePromotionRequest(forgedDirectory,base.selection),/source feature references differ/);
  const request=buildFinePromotionRequest(base.context,base.selection);
  assert.throws(()=>validateFinePromotionRequest({...request,extra:'not admitted'}),/unknown fields/);
  assert.throws(()=>validateFinePromotionRequest({...request,country:{...request.country,code:'NG',id:'legacy-ng',iso3:'NGA'}}),/protected/);
  assert.throws(()=>validateFinePromotionRequest({...request,pointerUrl:'https://github.com/wmgeolab/geoBoundaries/raw/other/path'}),/exact raw country and commit/);
});

test('does not promote malformed or over-cap LFS pointers even when metadata admission passes',()=>{
  const {context,selection}=makeContext();
  assert.throws(()=>buildFineSourcePromotion(context,selection,Buffer.from('{"type":"FeatureCollection"}')),/pointer/);
  assert.throws(()=>buildFineSourcePromotion(context,selection,pointer(8*1024*1024+1)),/exceeds the admitted/);
});
