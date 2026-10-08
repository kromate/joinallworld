import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildFineCatalogue, FINE_CATALOGUE_URL } from './fine-catalogue.ts';
import type { WorldInventory } from './production-types.ts';

const pinFor=(bytes:Uint8Array)=>({sourceUrl:FINE_CATALOGUE_URL,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,capturedAt:'2026-10-08T02:47:11Z'});
const layer=(iso:string,id=`${iso}-ADM1-123`,units='2')=>({boundaryID:id,boundaryISO:iso,boundaryName:iso,boundaryType:'ADM1',boundaryCanonical:'Province',boundaryYearRepresented:'2020',boundarySource:'Ministry',boundaryLicense:'CC BY 4.0',licenseSource:'https://example.test/license',buildDate:'2024-01-01',admUnitCount:units,gjDownloadURL:`https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/${iso}/ADM1/geoBoundaries-${iso}-ADM1.geojson`});
function fixture(countries:Array<{code:string;ne:number;name?:string;provider?:'world'|'legacy-ng';parent?:string}>,rows:unknown[]){
 const source={id:'ne',url:'https://example.test/ne.geojson',release:'a'.repeat(40),license:'Public-domain',attribution:'Natural Earth',sha256:'b'.repeat(64),bytes:20};
 const nodes:WorldInventory['nodes']=[{id:'world:earth',parentId:null,name:'World',kind:'world',countryCode:null,bounds:null,sourceFeatureIds:[],provider:'world',outline:'missing',exceptions:[]},{id:'continent:africa',parentId:'world:earth',name:'Africa',kind:'continent',countryCode:null,bounds:null,sourceFeatureIds:[],provider:'world',outline:'missing',exceptions:[]},{id:'continent:asia',parentId:'world:earth',name:'Asia',kind:'continent',countryCode:null,bounds:null,sourceFeatureIds:[],provider:'world',outline:'missing',exceptions:[]}];
 const features=countries.map(c=>{const identity=`NE_ID:${c.ne}`;nodes.push({id:c.provider==='legacy-ng'?'legacy-ng':`country:${c.code}:${c.ne}`,parentId:c.parent??'continent:africa',name:c.name??c.code,kind:'country',countryCode:c.code==='NGA'?'NG':c.code.slice(0,2),bounds:null,sourceFeatureIds:[`${source.id}:${identity}`],provider:c.provider??'world',outline:'missing',exceptions:[]});return {type:'Feature',properties:{NE_ID:c.ne,ISO_A3_EH:c.code,ADM0_A3:c.code},geometry:null};});
 const inventory:WorldInventory={schemaVersion:1,sources:[source],nodes,outlines:[],sourceUnitCount:countries.length,exceptions:[]};
 const geoJSON={type:'FeatureCollection',features};const bytes=Buffer.from(JSON.stringify(rows));return {report:buildFineCatalogue(bytes,pinFor(bytes),inventory,geoJSON),inventory,bytes,geoJSON};
}

test('conserves every metadata row and coarse country including explicit missing and protected Nigeria',()=>{
 const x=fixture([{code:'GHA',ne:1},{code:'NGA',ne:2,name:'Nigeria',provider:'legacy-ng'},{code:'FJI',ne:3,parent:'continent:asia'}],[layer('GHA'),layer('NGA')]);
 assert.equal(x.report.expectedLayerCount,2);assert.equal(x.report.reportedLayerCount,2);assert.equal(x.report.counts.metadataRecords,2);
 assert.equal(x.report.countries.length,3);assert.equal(x.report.countries.find(c=>c.countryId==='country:FJI:3')?.status,'missing-metadata');
 assert.equal(x.report.countries.find(c=>c.countryId==='legacy-ng')?.status,'protected');
 assert.equal(x.report.layers.find(l=>l.iso3==='NGA')?.status,'protected');assert.equal(x.report.countries.find(c=>c.countryId==='country:GHA:1')?.priority,0);assert.equal(x.report.countries.find(c=>c.countryId==='country:FJI:3')?.priority,1);
});

test('retains duplicate ISO3 rows as ambiguous and never picks one for a country',()=>{
 const x=fixture([{code:'IND',ne:1}],[layer('IND','IND-ADM1-1'),layer('IND','IND-ADM1-2')]);
 assert.equal(x.report.layers.length,2);assert.ok(x.report.layers.every(l=>l.status==='ambiguous-iso3'));
 assert.equal(x.report.countries[0]?.status,'ambiguous-iso3');assert.equal(x.report.counts.duplicateIso3Groups,1);
});

test('retains repeated ISO3/ADM1/boundaryID tuples instead of collapsing source rows',()=>{
 const x=fixture([{code:'GHA',ne:1}],[layer('GHA','GHA-ADM1-same'),layer('GHA','GHA-ADM1-same')]);
 assert.equal(x.report.layers.length,2);assert.ok(x.report.layers.every(l=>l.status==='ambiguous-iso3'));
 assert.ok(x.report.layers.every(l=>l.exceptions.some(e=>e.includes('duplicate ISO3/ADM1/boundaryID tuple'))));
 assert.equal(x.report.countries[0]?.status,'ambiguous-iso3');
});

test('ambiguous coarse Natural Earth ISO mapping is explicit and not fuzzy-resolved',()=>{
 const x=fixture([{code:'GHA',ne:1},{code:'GHA',ne:2}],[layer('GHA')]);
 assert.equal(x.report.layers[0]?.status,'source-resolution-exception');assert.equal(x.report.layers[0]?.countryId,null);
 assert.ok(x.report.countries.every(c=>c.status==='source-resolution-exception'));
});

test('invalid count string is retained as invalid and large valid layers are retained over the pilot cap',()=>{
 const x=fixture([{code:'GHA',ne:1},{code:'KEN',ne:2}],[layer('GHA','GHA-ADM1-1','2.5'),layer('KEN','KEN-ADM1-2','83')]);
 assert.equal(x.report.layers.length,2);assert.equal(x.report.layers[0]?.status,'invalid-metadata');assert.equal(x.report.layers[0]?.reportedAdminUnits,null);
 assert.equal(x.report.layers[1]?.reportedAdminUnits,83);assert.equal(x.report.layers[1]?.pilotStatus,'too-large');assert.equal(x.report.counts.tooLargeForPilot,1);
 assert.equal(x.report.sourceCounts.metadataReportedAdminUnits,83);
});

test('rejects changed bytes, oversized snapshots and invalid root arrays',()=>{
 const x=fixture([{code:'GHA',ne:1}],[layer('GHA')]);
 assert.throws(()=>buildFineCatalogue(Buffer.from('[]'),pinFor(x.bytes),x.inventory,{type:'FeatureCollection',features:[]}),/pin/);
 const tooMany=Buffer.from(JSON.stringify(Array.from({length:301},(_,i)=>layer('GHA',`GHA-ADM1-${i}`))));
 assert.throws(()=>buildFineCatalogue(tooMany,pinFor(tooMany),x.inventory,x.geoJSON),/300/);
});

test('validates coarse inventory and requires one exact source feature per denominator unit',()=>{
 const x=fixture([{code:'GHA',ne:1}],[layer('GHA')]);
 const forged={...x.inventory,sourceUnitCount:2};
 assert.throws(()=>buildFineCatalogue(x.bytes,pinFor(x.bytes),forged,x.geoJSON),/inventory source denominator/);
 const multisource={...x.inventory,sources:[...x.inventory.sources,{...x.inventory.sources[0]!,id:'other-ne'}]};
 assert.throws(()=>buildFineCatalogue(x.bytes,pinFor(x.bytes),multisource,x.geoJSON),/exactly one pinned source/);
 assert.throws(()=>buildFineCatalogue(x.bytes,pinFor(x.bytes),x.inventory,{type:'FeatureCollection',features:[]}),/matching the inventory source denominator/);
 const duplicate={type:'FeatureCollection',features:[...x.geoJSON.features,...x.geoJSON.features]};
 assert.throws(()=>buildFineCatalogue(x.bytes,pinFor(x.bytes),{...x.inventory,sourceUnitCount:2,nodes:x.inventory.nodes.map(n=>n.id==='country:GHA:1'?{...n,sourceFeatureIds:[...n.sourceFeatureIds,'ne:NE_ID:1']}:n)},duplicate),/inventory source denominator|repeats source feature identity/);
 const two=fixture([{code:'GHA',ne:1},{code:'KEN',ne:2}],[layer('GHA')]);
 const duplicateValidInventoryRefs={type:'FeatureCollection',features:[two.geoJSON.features[0],two.geoJSON.features[0]]};
 assert.throws(()=>buildFineCatalogue(two.bytes,pinFor(two.bytes),two.inventory,duplicateValidInventoryRefs),/repeats source feature identity/);
});

test('rejects malformed source features and keeps mismatched or decorated candidate URLs out',()=>{
 const x=fixture([{code:'GHA',ne:1}],[layer('GHA')]);
 assert.throws(()=>buildFineCatalogue(x.bytes,pinFor(x.bytes),x.inventory,{type:'FeatureCollection',features:[{type:'Feature',properties:{ISO_A3_EH:'GHA'}}]}),/malformed|identity/);
 assert.throws(()=>buildFineCatalogue(x.bytes,pinFor(x.bytes),x.inventory,{type:'FeatureCollection',features:[{type:'Feature',properties:{NE_ID:999,ISO_A3_EH:'GHA'}}]}),/not referenced by the validated inventory/);
 for(const url of [layer('KEN').gjDownloadURL,`${layer('GHA').gjDownloadURL}?download=1`,`${layer('GHA').gjDownloadURL}#fragment`,'https://github.com:443/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/GHA/ADM1/geoBoundaries-GHA-ADM1.geojson']) {
  const row={...layer('GHA'),gjDownloadURL:url};const bytes=Buffer.from(JSON.stringify([row]));
  const report=buildFineCatalogue(bytes,pinFor(bytes),x.inventory,x.geoJSON);
  assert.equal(report.layers[0]?.candidateUrl,null);assert.ok(report.layers[0]?.exceptions.some(e=>e.includes('candidate GeoJSON URL')));
 }
});

test('rejects empty snapshot arrays, invalid timestamps and control characters in bounded metadata',()=>{
 const x=fixture([{code:'GHA',ne:1}],[layer('GHA')]);
 const empty=Buffer.from('[]');assert.throws(()=>buildFineCatalogue(empty,pinFor(empty),x.inventory,x.geoJSON),/nonempty/);
 assert.throws(()=>buildFineCatalogue(x.bytes,{...pinFor(x.bytes),capturedAt:'Oct 8 2026'},x.inventory,x.geoJSON),/capture time/);
 const row={...layer('GHA'),boundarySource:'Source\u0001injection'};const bytes=Buffer.from(JSON.stringify([row]));
 const report=buildFineCatalogue(bytes,pinFor(bytes),x.inventory,x.geoJSON);assert.equal(report.layers[0]?.source,null);
});
