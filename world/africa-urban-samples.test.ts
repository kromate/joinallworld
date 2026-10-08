import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { validateCampaign } from './campaign.ts';

function canonical(value:unknown):string{if(Array.isArray(value))return`[${value.map(canonical).join(',')}]`;if(value&&typeof value==='object')return`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical((value as Record<string,unknown>)[k])}`).join(',')}}`;return JSON.stringify(value);}

test('Africa urban sample fixture stays bound to reviewed Natural Earth place and country identities',async()=>{
 const [rawCampaign,rawAnchors,rawSource]=await Promise.all([
  readFile(new URL('./campaign-fixtures/africa-urban-samples-v1.json',import.meta.url),'utf8'),
  readFile(new URL('./africa-urban-samples-anchors.json',import.meta.url),'utf8'),
  readFile(new URL('./settlement-sources.json',import.meta.url),'utf8'),
 ]);
 const campaign=validateCampaign(JSON.parse(rawCampaign) as unknown),anchors=JSON.parse(rawAnchors) as {campaignId:string;campaignInventoryHash:string;countryDirectoryManifestHash:string;selectedPlacesManifestHash:string;selectedPlacesInput:{sha256:string;bytes:number};samples:Array<{unitId:string;priority:number;sourceKey:string;sourceOrdinal:number;featureSha256:string;countryId:string;coordinates:number[];countryCode:string;requestHash:string;request:unknown;selectedPlacesPointsAsset:{sha256:string;bytes:number};knownClassificationCaveat:string}>},source=JSON.parse(rawSource) as {source:{sha256:string;bytes:number;release:string}};
 assert.equal(campaign.id,anchors.campaignId);assert.equal(campaign.inventoryHash,anchors.campaignInventoryHash);assert.equal(campaign.units.length,4);assert.equal(anchors.samples.length,3);
 assert.equal(anchors.countryDirectoryManifestHash,'b3fb51b5660ed22b2ee354235c60291d6857b3dd9245afbabec3fc15918c8501');assert.equal(anchors.selectedPlacesManifestHash,'17932383d2d75ce733a3cfae8e455d053be778fc09dcaa5ca06707416e55b61e');assert.equal(anchors.selectedPlacesInput.sha256,source.source.sha256);assert.equal(anchors.selectedPlacesInput.bytes,source.source.bytes);assert.equal(source.source.release,'ca96624a56bd078437bca8184e78163e5039ad19');
 const expected=[
  {id:'dakar-overture-sample',key:'NE_ID:1159151513',countryId:'country:natural-earth:NE_ID%3A1159321243',countryCode:'SN',timezone:'Africa/Dakar',coordinates:[-17.475076,14.717778],ordinal:7234,featureSha256:'a235d08275092e7e26849178a1b9022a254d475cbc8bce7b718ceb150a223f8a',assetSha256:'25141b43ac8a24b1af3e033720ababbd20b1f6b9eba4632896554e42d063c41d'},
  {id:'addis-ababa-overture-sample',key:'NE_ID:1159151549',countryId:'country:natural-earth:NE_ID%3A1159320617',countryCode:'ET',timezone:'Africa/Addis_Ababa',coordinates:[38.698059,9.035256],ordinal:7250,featureSha256:'70fbdad07dec0d66e6e41dafcec4b0595c31284a99eeffecc2a2f1a00e4cc518',assetSha256:'01b2eea4b45a5683c5e2ed9126f5cc70d2effbe9df33183841c4a2f469358ee3'},
  {id:'dar-es-salaam-overture-sample',key:'NE_ID:1159151305',countryId:'country:natural-earth:NE_ID%3A1159321337',countryCode:'TZ',timezone:'Africa/Dar_es_Salaam',coordinates:[39.266396,-6.798067],ordinal:7141,featureSha256:'a9ec1a2982bb2ef1594bdb99b51e87acdf10d789aea06f8150c1b4c6b1754935',assetSha256:'be6c85bea98362a744cb9dbdd36138489bf4a7be8a3f18bc4f19d21407361274'},
 ];
 for(let i=0;i<expected.length;i++){
  const e=expected[i]!,unit=campaign.units[i]!,anchor=anchors.samples[i]!;
  if(unit.kind!=='acquire')throw new Error('sample request must be an acquisition');
  assert.equal(unit.kind,'acquire');assert.equal(unit.priority,i);assert.equal(unit.id,e.id);assert.equal(unit.inventoryUnitId,e.countryId);assert.equal(anchor.unitId,e.id);assert.equal(anchor.priority,i);assert.equal(anchor.sourceKey,e.key);assert.equal(anchor.sourceOrdinal,e.ordinal);assert.equal(anchor.featureSha256,e.featureSha256);assert.equal(anchor.countryId,e.countryId);assert.equal(anchor.countryCode,e.countryCode);assert.deepEqual(anchor.coordinates,e.coordinates);assert.equal(anchor.selectedPlacesPointsAsset.sha256,e.assetSha256);assert.deepEqual(anchor.request,unit.request);
  const request=unit.request as {schemaVersion:number;id:string;inventoryUnitId:string;region:{parentId:string;kind:string;countryCode:string;timezone:string;bounds:number[]};provider:string;release:string;layers:string[];limits:Record<string,unknown>};assert.equal(request.region.parentId,e.countryId);assert.equal(request.region.kind,'cell');assert.equal(request.region.countryCode,e.countryCode);assert.equal(request.region.timezone,e.timezone);assert.deepEqual(request.region.bounds,[e.coordinates[0]!-0.002,e.coordinates[1]!-0.002,e.coordinates[0]!+0.002,e.coordinates[1]!+0.002]);assert.equal(request.release,'2026-09-23.1');assert.deepEqual(request.layers,['buildings','roads']);assert.deepEqual(request.limits,{networkBytes:32000000,outputBytes:10000000,features:5000,durationMs:600000,memoryMb:1536,diskBytes:128000000});
  const selection={schemaVersion:request.schemaVersion,id:request.id,inventoryUnitId:request.inventoryUnitId,region:request.region,provider:request.provider,release:request.release,layers:request.layers};assert.equal(anchor.requestHash,createHash('sha256').update(canonical({compiler:'world-source-compiler-v2',selection,sourceConfig:JSON.parse((await readFile(new URL('./acquisition-sources.json',import.meta.url),'utf8')))})).digest('hex'));
 }
 assert.deepEqual(campaign.limits,{durationMs:5400000,jobDurationMs:600000,networkBytes:96000000,inputBytes:30000000,outputBytes:40000000,diskBytes:512000000,memoryMb:1536,maxAttempts:2});const nigeria=campaign.units[3]!;assert.equal(nigeria.kind,'protected');assert.equal(nigeria.priority,3);assert.equal(nigeria.inventoryUnitId,'legacy-ng');assert.match(anchors.samples[2]!.knownClassificationCaveat,/not.*current capital|not.*capital/i);
});
