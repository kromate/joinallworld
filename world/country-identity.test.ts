import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInventory } from './inventory.ts';
import { compareCountryIdentities } from './country-identity.ts';
import type { WorldInventory } from './production-types.ts';
import type { SourceRecord } from './types.ts';

const polygon=(west:number,south:number,east:number,north:number)=>({type:'Polygon',coordinates:[[[west,south],[east,south],[east,north],[west,north],[west,south]]]});
const source=(id:string,release:string,fill:string):SourceRecord=>({id,url:`https://example.invalid/${release}.geojson`,release,license:'Public-domain',attribution:'Synthetic Natural Earth-style fixture; not geography evidence',sha256:fill.repeat(64),bytes:100});
type Row={ne:number;name:string;continent?:string;code:string;west:number;south:number;east:number;north:number};
function inventory(rows:Row[],release='a'.repeat(40),id='synthetic-ne',options:{fallback?:boolean}={}):WorldInventory{
 const features=rows.map(row=>({type:'Feature',properties:{NE_ID:options.fallback&&row.code==='GH'?-99:row.ne,...(options.fallback&&row.code==='GH'?{ADM0_A3:'GHA'}:{}),ADMIN:row.name,CONTINENT:row.continent??'Africa',ISO_A2_EH:row.code},geometry:polygon(row.west,row.south,row.east,row.north)}));
 return buildInventory(source(id,release,'a'),{type:'FeatureCollection',features});
}
const baselineRows:Row[]=[
 {ne:1,name:'Ghana',code:'GH',west:-3,south:4,east:1,north:11},
 {ne:90,name:'Zedland',code:'ZD',continent:'Europe',west:10,south:40,east:12,north:42},
 {ne:159,name:'Nigeria',code:'NG',west:3,south:4,east:15,north:14},
];

test('retains NE_ID country identity across source IDs/releases and protects source-backed Nigeria',()=>{
 const before=inventory(baselineRows,'a'.repeat(40),'natural-earth-110m');
 const after=inventory([...baselineRows].reverse(),'b'.repeat(40),'natural-earth-10m');
 const report=compareCountryIdentities(before,after);
 assert.equal(report.baselineSourceId,'natural-earth-110m');assert.equal(report.candidateSourceId,'natural-earth-10m');
 assert.equal(report.baselineUnits,3);assert.equal(report.candidateUnits,3);assert.equal(report.retained.length,3);
 assert.deepEqual(report.retained.map(row=>row.featureKey),['NE_ID:1','NE_ID:159','NE_ID:90']);
 assert.ok(report.retained.every(row=>!row.metadataChanged));
 const nigeria=report.retained.find(row=>row.featureKey==='NE_ID:159');
 assert.equal(nigeria?.countryId,'legacy-ng');assert.equal(report.protectedCountryId,'legacy-ng');assert.deepEqual(report.added,[]);assert.deepEqual(report.missing,[]);assert.deepEqual(report.exceptions,[]);
});

test('names are display metadata while names, parent, country code and bounds changes are reported',()=>{
 const before=inventory(baselineRows);
 const after=inventory(baselineRows.map(row=>row.ne===1?{...row,name:'Ghana (renamed)',continent:'Europe',code:'GM',east:2}:row));
 const report=compareCountryIdentities(before,after);
 const retained=report.retained.find(row=>row.featureKey==='NE_ID:1')!;
 assert.equal(retained.countryId,'country:natural-earth:NE_ID%3A1');assert.equal(retained.baselineName,'Ghana');assert.equal(retained.candidateName,'Ghana (renamed)');assert.equal(retained.metadataChanged,true);
 assert.equal(report.retained.find(row=>row.featureKey==='NE_ID:90')?.metadataChanged,false);
});

test('missing and added keys are conserved explicitly without fuzzy name matching or inferred migrations',()=>{
 const before=inventory(baselineRows);
 const after=inventory([baselineRows[0]!,{...baselineRows[1]!,ne:91},baselineRows[2]!]);
 const report=compareCountryIdentities(before,after);
 assert.equal(report.baselineUnits,3);assert.equal(report.candidateUnits,3);
 assert.deepEqual(report.missing,[{featureKey:'NE_ID:90',countryId:'country:natural-earth:NE_ID%3A90',name:'Zedland'}]);
 assert.deepEqual(report.added,[{featureKey:'NE_ID:91',countryId:'country:natural-earth:NE_ID%3A91',name:'Zedland'}]);
 assert.equal(report.retained.length+report.missing.length,report.baselineUnits);assert.equal(report.retained.length+report.added.length,report.candidateUnits);
 assert.match(report.exceptions[0]!,/no replacement ID or migration was inferred/);
});

test('added countries and baseline-missing countries use deterministic codepoint order',()=>{
 const before=inventory([baselineRows[0]!,baselineRows[2]!]);
 const after=inventory([{ne:100,name:'One Hundred',code:'OH',west:20,south:0,east:22,north:2},baselineRows[0]!,baselineRows[2]!,{ne:2,name:'Two',code:'TW',west:30,south:0,east:32,north:2}]);
 const report=compareCountryIdentities(before,after);
 assert.deepEqual(report.added.map(row=>row.featureKey),['NE_ID:100','NE_ID:2']);
 assert.deepEqual(report.retained.map(row=>row.featureKey),['NE_ID:1','NE_ID:159']);
});

test('rejects source-key fallbacks, malformed bindings and invalid Nigeria protection',()=>{
 const good=inventory(baselineRows);
 assert.throws(()=>compareCountryIdentities(good,inventory(baselineRows,'b'.repeat(40),'other',{fallback:true})),/NE_ID safe integer/);
 const duplicated=structuredClone(good);duplicated.sources.push({...duplicated.sources[0]!,id:'second-source'});
 assert.throws(()=>compareCountryIdentities(good,duplicated),/exactly one pinned source/);
 const invalidId=structuredClone(good);invalidId.nodes.find(node=>node.countryCode==='GH')!.id='country:natural-earth:ADM0_A3%3AGHA';invalidId.outlines.find(outline=>outline.nodeId==='country:natural-earth:NE_ID%3A1')!.nodeId='country:natural-earth:ADM0_A3%3AGHA';
 assert.throws(()=>compareCountryIdentities(good,invalidId),/does not match its stable NE_ID identity/);
 const misprotected=structuredClone(good);misprotected.nodes.find(node=>node.id==='legacy-ng')!.provider='world';
 assert.throws(()=>compareCountryIdentities(good,misprotected),/Nigeria must use protected legacy provider/);
 const noNigeriaKey=structuredClone(good);const nigeria=noNigeriaKey.nodes.find(node=>node.id==='legacy-ng')!;nigeria.sourceFeatureIds=[];noNigeriaKey.sourceUnitCount--;
 assert.throws(()=>compareCountryIdentities(good,noNigeriaKey),/country legacy-ng must own exactly one source feature/);
 const duplicateKey=structuredClone(good);duplicateKey.nodes.find(node=>node.id==='country:natural-earth:NE_ID%3A1')!.sourceFeatureIds=['synthetic-ne:NE_ID:159'];
 assert.throws(()=>compareCountryIdentities(good,duplicateKey),/denominator is incomplete or duplicated/);
});
