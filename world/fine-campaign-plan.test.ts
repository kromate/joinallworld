import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFineCampaignPlan } from './fine-campaign-plan.ts';
import type { ReviewedFineCampaignInput } from './fine-campaign-plan.ts';
import type { FineDirectoryCatalogueReport } from './fine-directory-catalogue.ts';
import type { FineSourcePin } from './fine-types.ts';
import type { FineCatalogueCountry, FineCatalogueLayer } from './fine-catalogue.ts';

const hash = (char: string) => char.repeat(64);
const release = 'a'.repeat(40);
const parentHash = hash('b'), catalogueHash = hash('c');
const topology = `.cache/world-build/fine-topology/reports/${hash('d')}/${hash('e')}.json`;
function layer(ordinal:number, iso3:string, boundaryId:string, countryId:string, units:number, status:FineCatalogueLayer['status']='linked', extra:Partial<FineCatalogueLayer>={}) : FineCatalogueLayer {
  const source = iso3 === 'RWA' ? 'Rwanda Geo Portal' : iso3 === 'GHA' ? 'Open Street Map' : `Source ${iso3}`;
  const license = iso3 === 'GHA' ? 'Creative Commons Attribution-ShareAlike 2.0' : 'Creative Commons Attribution 4.0';
  const licenseSource = iso3 === 'GHA' ? 'www.openstreetmap.org/copyright' : `licenses.example/${iso3}`;
  const short = release.slice(0,7);
  return {
    ordinal,boundaryId,iso3,name:iso3,adminType:'Province',representedYear:'2020',buildDate:'Dec 12, 2023',source,originalLicense:license,licenseSource,
    candidateUrl:`https://github.com/wmgeolab/geoBoundaries/raw/${short}/releaseData/gbOpen/${iso3}/ADM1/geoBoundaries-${iso3}-ADM1.geojson`,
    shortReleaseCandidate:short,reportedAdminUnits:units,pilotUnitLimit:32,pilotStatus:units>32?'too-large':'within-limit',countryId,priority:0,status,
    exceptions:[],...extra,
  };
}
function country(id:string,iso3:string|null,status:FineCatalogueCountry['status'],priority:0|1=0,boundaryId:string|null=null): FineCatalogueCountry {
  return {countryId:id,name:`Country ${iso3??id}`,sourceFeatureIds:[`coarse:NE_ID:${id}`],iso3,boundaryId,priority,status,exceptions:[]};
}
const report = ():FineDirectoryCatalogueReport => ({
  schemaVersion:2,purpose:'metadata-discovery-only',parent:{product:'country-directory',manifestHash:parentHash},
  pin:{sourceUrl:'https://www.geoboundaries.org/api/current/gbOpen/ALL/ADM1/',sha256:hash('f'),bytes:100,capturedAt:'2026-01-01T00:00:00Z'},
  coarseSources:[{id:'coarse',url:'https://example.invalid/coarse.json',release:'fixture',license:'Public-domain',attribution:'Synthetic test fixture',sha256:hash('a'),bytes:100}],expectedLayerCount:8,reportedLayerCount:8,
  counts:{metadataRecords:8,validAdm1Layers:8,invalidMetadataRecords:0,duplicateIso3Groups:1,linkedCountries:4,missingMetadataCountries:1,protectedCountries:1,ambiguousCountries:1,tooLargeForPilot:2},
  sourceCounts:{coarseSourceUnits:8,coarseCountryNodes:8,metadataReportedAdminUnits:102,metadataUnitCountsKnown:8},
  layers:[
    layer(0,'RWA','RWA-ADM1-1','rwanda-id',5),
    layer(1,'GHA','GHA-ADM1-1','ghana-id',16),
    layer(2,'AFG','AFG-ADM1-1','afghan-id',34,'linked',{priority:1}),
    layer(3,'UNR','UNR-ADM1-1','unreviewed-id',4,'linked',{priority:1}),
    layer(4,'NGA','NGA-ADM1-1','legacy-ng',37,'protected'),
    layer(5,'AAA','AAA-ADM1-1','ambiguous-id',2,'ambiguous-iso3',{priority:1}),
    layer(6,'AAA','AAA-ADM1-2','unused-ambiguous-layer',1,'ambiguous-iso3',{priority:1,countryId:null}),
    layer(7,'BBB','BBB-ADM1-1','resolution-id',3,'source-resolution-exception',{priority:1}),
  ],
  countries:[
    country('rwanda-id','RWA','linked',0,'RWA-ADM1-1'),country('ghana-id','GHA','linked',0,'GHA-ADM1-1'),
    country('afghan-id','AFG','linked',1,'AFG-ADM1-1'),country('unreviewed-id','UNR','linked',1,'UNR-ADM1-1'),
    country('legacy-ng','NGA','protected',0,'NGA-ADM1-1'),country('missing-id','ZZZ','missing-metadata',1),
    country('ambiguous-id','AAA','ambiguous-iso3',1,null),country('resolution-id','BBB','source-resolution-exception',1,'BBB-ADM1-1'),
  ],exceptions:[],
});
function pin(overrides:Partial<FineSourcePin>={}):FineSourcePin {
  const source={id:'stable-gbopen-rwa-adm1',url:`https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/${release}/releaseData/gbOpen/RWA/ADM1/geoBoundaries-RWA-ADM1.geojson`,release,license:'CC BY 4.0 (geoBoundaries gbOpen)',attribution:'geoBoundaries gbOpen; source: Rwanda Geo Portal',sha256:hash('1'),bytes:1024};
  return {schemaVersion:1,provider:'geoBoundaries',source,input:`.cache/world-build/fine-source-cache/${source.sha256}.geojson`,countryCode:'RW',countryIso3:'RWA',adminLevel:'ADM1',layerId:'RWA-ADM1-1',canonicalType:'Province',representedYear:'2020',buildDate:'Dec 12, 2023',expectedUnits:5,originalLicense:'Creative Commons Attribution 4.0',licenseEvidence:['https://licenses.example/RWA'],metadataSha256:hash('2'),metadataBytes:200,boundaryPolicy:'Preserve published source boundary policy.',...overrides};
}
const reviewed = (candidate=pin(), topologyReportPath=topology):ReviewedFineCampaignInput[] => [{pin:candidate,topologyReportPath}];

test('plans exactly one status per catalogue country with deterministic Africa-first ordering and reviewed-source admission',()=>{
  const plan=buildFineCampaignPlan(report(),catalogueHash,reviewed());
  assert.equal(plan.schemaVersion,1);assert.equal(plan.purpose,'administrative-build-campaign');
  assert.deepEqual(plan.parent,{product:'country-directory',manifestHash:parentHash});
  assert.equal(plan.catalogueHash,catalogueHash);assert.equal(plan.metadataSha256,hash('f'));
  assert.equal(plan.countryCount,8);assert.equal(plan.units.length,8);
  assert.deepEqual(plan.units.map(unit=>unit.countryId),['ghana-id','legacy-ng','rwanda-id','afghan-id','ambiguous-id','missing-id','resolution-id','unreviewed-id']);
  assert.equal(plan.units.find(unit=>unit.countryId==='rwanda-id')!.status,'ready');
  assert.equal(plan.units.find(unit=>unit.countryId==='rwanda-id')!.pin!.source.release,release);
  assert.equal(plan.units.find(unit=>unit.countryId==='ghana-id')!.status,'excluded-source');
  assert.match(plan.units.find(unit=>unit.countryId==='ghana-id')!.reason,/Open Street Map.*ShareAlike 2\.0.*licens(?:e|ing).*review/);
  assert.equal(plan.units.find(unit=>unit.countryId==='afghan-id')!.status,'partition-required');
  assert.equal(plan.units.find(unit=>unit.countryId==='unreviewed-id')!.status,'unreviewed-source');
  assert.equal(plan.units.find(unit=>unit.countryId==='missing-id')!.status,'missing-metadata');
  assert.equal(plan.units.find(unit=>unit.countryId==='ambiguous-id')!.status,'ambiguous-identity');
  assert.equal(plan.units.find(unit=>unit.countryId==='resolution-id')!.status,'ambiguous-identity');
  assert.equal(plan.units.find(unit=>unit.countryId==='legacy-ng')!.status,'protected');
  assert.deepEqual(Object.values(plan.counts).reduce((sum,count)=>sum+count,0),plan.countryCount);
  assert.equal(plan.counts.ready,1);assert.equal(plan.units.find(unit=>unit.countryId==='legacy-ng')!.pin,null);
});

test('rejects duplicate, unmatched, unsafe-path, and metadata-mismatched reviewed pins',()=>{
  assert.throws(()=>buildFineCampaignPlan(report(),catalogueHash,[...reviewed(),...reviewed()]),/repeat a source or country/);
  const otherRelease='c'.repeat(40);
  const unmatched=pin({countryIso3:'TST',countryCode:'TS',source:{...pin().source,id:'other',release:otherRelease,url:`https://raw.githubusercontent.com/wmgeolab/geoBoundaries/${otherRelease}/releaseData/gbOpen/TST/ADM1/geoBoundaries-TST-ADM1.geojson`},layerId:'TST-ADM1-1',input:`.cache/world-build/fine-source-cache/${hash('1')}.geojson`});
  assert.throws(()=>buildFineCampaignPlan(report(),catalogueHash,reviewed(unmatched)),/does not match any eligible catalogue country/);
  assert.throws(()=>buildFineCampaignPlan(report(),catalogueHash,reviewed(pin(),'/tmp/topology.json')),/exact bounded fine-topology/);
  assert.throws(()=>buildFineCampaignPlan(report(),catalogueHash,reviewed(pin({expectedUnits:6}))),/expected unit count/);
  const otherCommit='f'.repeat(40);
  const badCommit=pin({source:{...pin().source,release:otherCommit,url:`https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/${otherCommit}/releaseData/gbOpen/RWA/ADM1/geoBoundaries-RWA-ADM1.geojson`}});
  assert.throws(()=>buildFineCampaignPlan(report(),catalogueHash,reviewed(badCommit)),/candidate release/);
  assert.throws(()=>buildFineCampaignPlan(report(),catalogueHash,reviewed(pin({originalLicense:'Public Domain'}))),/attribution\/license/);
  assert.throws(()=>buildFineCampaignPlan(report(),catalogueHash,reviewed(pin({licenseEvidence:['https://unrelated.example/license']}))),/license evidence/);
  const badUrl=report();badUrl.layers[0]!.candidateUrl='https://example.invalid/changed.geojson';
  assert.throws(()=>buildFineCampaignPlan(badUrl,catalogueHash,reviewed()),/candidate URL/);
});

test('never admits a Nigeria/legacy source pin and rejects forged catalogue counts',()=>{
  const nigeriaPin=pin({countryCode:'NG',countryIso3:'NGA',source:{...pin().source,url:`https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/${release}/releaseData/gbOpen/NGA/ADM1/geoBoundaries-NGA-ADM1.geojson`},layerId:'NGA-ADM1-1'});
  assert.throws(()=>buildFineCampaignPlan(report(),catalogueHash,reviewed(nigeriaPin)),/Nigeria\/legacy-ng is protected/);
  const bad=report();bad.counts.linkedCountries++;
  assert.throws(()=>buildFineCampaignPlan(bad,catalogueHash,reviewed()),/summary counts do not match/);
  const noNigeria=report();noNigeria.countries=noNigeria.countries.filter(item=>item.countryId!=='legacy-ng');noNigeria.counts.protectedCountries=0;noNigeria.sourceCounts.coarseCountryNodes--;
  assert.throws(()=>buildFineCampaignPlan(noNigeria,catalogueHash,[]),/protected Nigeria/);
  assert.throws(()=>buildFineCampaignPlan(report(),hash('z'),[]),/catalogue report hash/);
});
