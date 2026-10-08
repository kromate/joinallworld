import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileRegion } from './ingest.ts';
import { ACCRA_OSM_SOURCE } from './sources.ts';
import type { Region } from './types.ts';
const region: Region = {id:'accra-test',parentId:null,name:'Accra test cell',kind:'city',countryCode:'GH',timezone:'Africa/Accra',bounds:[-0.21,5.54,-0.19,5.56]};
test('compiles stable namespaced polygon holes, roads, and honest feature exceptions', async()=>{
 const input=JSON.parse(await readFile(new URL('./fixtures/basic.geojson',import.meta.url),'utf8'));
 const a=compileRegion(region,ACCRA_OSM_SOURCE,input), b=compileRegion(region,ACCRA_OSM_SOURCE,input);
 assert.deepEqual(a,b); assert.equal(a.tiles.length,1);
 assert.equal(a.tiles[0]!.buildings[0]!.sourceId,ACCRA_OSM_SOURCE.id);
 assert.equal(a.tiles[0]!.buildings[0]!.rings.length,2);
 assert.deepEqual(a.tiles[0]!.roads[0]!.points,[[-0.202,5.55],[-0.199,5.55]]);
 assert.match(a.manifest.exceptions.join(' '),/unhandled source feature/);
});
test('rejects Nigeria and invalid geometries',()=>{
 assert.throws(()=>compileRegion({...region,countryCode:'NG'},ACCRA_OSM_SOURCE,{type:'FeatureCollection',features:[]}),/excluded/);
 const malformed={type:'FeatureCollection',features:[{type:'Feature',id:4,properties:{building:'yes'},geometry:{type:'Polygon',coordinates:[[[-0.2,5.55],[-0.199,5.551],[-0.2,5.551],[-0.199,5.55],[-0.2,5.55]]]}}]};
 assert.throws(()=>compileRegion(region,ACCRA_OSM_SOURCE,malformed),/self-intersects|zero area/);
});
test('uses bounding-box overlap, retains whole crossing roads, and expands tile bounds',()=>{
 const crossing={type:'FeatureCollection',features:[{type:'Feature',id:'boundary-road',properties:{highway:'primary'},geometry:{type:'LineString',coordinates:[[-0.3,5.55],[0.3,5.55]]}}]};
 const out=compileRegion(region,ACCRA_OSM_SOURCE,crossing), road=out.tiles[0]!.roads[0]!;
 assert.deepEqual(road.points,[[-0.3,5.55],[0.3,5.55]]);
 assert.deepEqual(out.tiles[0]!.bounds,[-0.3,5.54,0.3,5.56]);
 assert.match(out.manifest.exceptions.join(' '),/bounding box overlaps selected bounds/);
});
test('supports antimeridian regions and preserves wrapped tile bounds',()=>{
 const dateline:Region={...region,id:'dateline',bounds:[179.8,-1,-179.8,1]};
 const input={type:'FeatureCollection',features:[{type:'Feature',id:'wrap-road',properties:{highway:'service'},geometry:{type:'LineString',coordinates:[[179.7,0],[-179.7,0]]}}]};
 const out=compileRegion(dateline,ACCRA_OSM_SOURCE,input);
 assert.equal(out.tiles.length,1);
 assert.deepEqual(out.tiles[0]!.roads[0]!.points,[[179.7,0],[-179.7,0]]);
 assert.deepEqual(out.tiles[0]!.bounds,[179.7,-1,-179.7,1]);
});
test('keeps source heights distinct from estimates and ignores building=no',()=>{
 const input={type:'FeatureCollection',features:[
  {type:'Feature',id:'levels',properties:{building:'yes','building:levels':'3'},geometry:{type:'Polygon',coordinates:[[[-0.2,5.55],[-0.199,5.55],[-0.199,5.551],[-0.2,5.551],[-0.2,5.55]]]}},
  {type:'Feature',id:'render',properties:{building:'yes',render_height:'8'},geometry:{type:'Polygon',coordinates:[[[-0.198,5.55],[-0.197,5.55],[-0.197,5.551],[-0.198,5.551],[-0.198,5.55]]]}},
  {type:'Feature',id:'no',properties:{building:'no'},geometry:{type:'Polygon',coordinates:[[[-0.196,5.55],[-0.195,5.55],[-0.195,5.551],[-0.196,5.551],[-0.196,5.55]]]}}
 ]};
 const buildings=compileRegion(region,ACCRA_OSM_SOURCE,input).tiles.flatMap(t=>t.buildings);
 assert.equal(buildings.length,2);
 assert.deepEqual(buildings.map(b=>[b.heightM,b.heightKind]),[[9,'estimated'],[8,'source']]);
});
test('records collection metadata and standard unavailable sources',()=>{
 const out=compileRegion(region,ACCRA_OSM_SOURCE,{type:'FeatureCollection',metadata:{exceptions:['OSM relations unresolved']},features:[]});
 assert.ok(out.manifest.exceptions.includes('OSM relations unresolved'));
 assert.ok(out.manifest.exceptions.some(x=>x.startsWith('terrain unavailable:')));
 assert.ok(out.manifest.exceptions.some(x=>x.startsWith('climate unavailable:')));
});
test('pilot source checksum pins the tracked GeoJSON bytes',async()=>{
 const {sha256}=await import('./pack.ts');
 const bytes=new Uint8Array(await readFile(new URL('./pilots/accra.geojson',import.meta.url)));
 assert.equal(bytes.byteLength,ACCRA_OSM_SOURCE.bytes);
 assert.equal(sha256(bytes),ACCRA_OSM_SOURCE.sha256);
});
test('continues subdivision for a crowded corner instead of dropping clustered features',()=>{
 const large:Region={...region,id:'corner',bounds:[-1,5,-0.19,6]};
 const features=Array.from({length:45},(_,i)=>{const x=-0.99+(i%9)*0.001,y=5.01+Math.floor(i/9)*0.001;return {type:'Feature',id:`corner-${String(i).padStart(2,'0')}`,properties:{building:'yes'},geometry:{type:'Polygon',coordinates:[[[x,y],[x+0.0004,y],[x+0.0004,y+0.0004],[x,y+0.0004],[x,y]]]}};});
 const input={type:'FeatureCollection',features}, a=compileRegion(large,ACCRA_OSM_SOURCE,input), b=compileRegion(large,ACCRA_OSM_SOURCE,input);
 assert.deepEqual(a,b);
 assert.equal(a.tiles.reduce((n,t)=>n+t.buildings.length,0),45);
 assert.ok(a.tiles.length>=2);
});
