import test from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest, validateTile } from './validate.ts';

const tile = { schemaVersion:1 as const,id:'t',regionId:'r',bounds:[0,0,2,2] as [number,number,number,number],anchor:{longitude:1,latitude:1,height:0},buildings:[{id:'b',sourceId:'src',rings:[[[0,0],[2,0],[2,2],[0,2],[0,0]],[[.5,.5],[.5,1],[1,1],[1,.5],[.5,.5]]],heightM:4,heightKind:'estimated' as const}],roads:[] };
const source={id:'src',url:'https://example.test/data',release:'v1',license:'ODbL',attribution:'example',sha256:'a'.repeat(64),bytes:10};
const manifest={schemaVersion:1 as const,compilerVersion:'1',region:{id:'r',parentId:null,name:'R',kind:'city' as const,countryCode:'GH',timezone:'Africa/Accra',bounds:[0,0,2,2] as [number,number,number,number]},frame:'wgs84-enu-m-v1' as const,verticalDatum:'WGS84-ellipsoid' as const,coverage:'foundation' as const,exceptions:[],sources:[source],tiles:[],climate:null};

test('tile validation preserves polygon holes and checks coordinates and ring topology',()=>{
  assert.equal(validateTile(tile).buildings[0]!.rings.length,2);
  assert.throws(()=>validateTile({...tile,buildings:[{...tile.buildings[0],rings:[[[0,0],[1,1],[0,1],[1,0],[0,0]]]}]}),/zero area|self-intersects/);
  assert.throws(()=>validateTile({...tile,buildings:[{...tile.buildings[0],rings:[tile.buildings[0]!.rings[0]!,[[3,3],[3,3.5],[3.5,3.5],[3.5,3],[3,3]]]}]}),/outside/);
  assert.throws(()=>validateTile({...tile,bounds:[0,0,NaN,2]}),/finite/);
  assert.throws(()=>validateTile({...tile,schemaVersion:2}),/unsupported/);
  assert.throws(()=>validateTile({...tile,buildings:[{...tile.buildings[0],rings:[[[0,0],[2,2],[0,2],[2,0],[0,0]]]}]}),/zero area|self-intersects/);
  assert.throws(()=>validateTile({...tile,buildings:[{...tile.buildings[0],rings:[[[0,0],[2,0],[1,0],[1,1],[0,1],[0,0]]]}]}),/overlap|self-touches/);
  assert.throws(()=>validateTile({...tile,buildings:[{...tile.buildings[0],rings:[tile.buildings[0]!.rings[0]!,[[1.5,.5],[1.5,1.5],[2.5,1.5],[2.5,.5],[1.5,.5]]]}]}),/outside|crosses/);
  assert.throws(()=>validateTile({...tile,buildings:[{...tile.buildings[0],rings:[tile.buildings[0]!.rings[0]!,[[.5,.5],[.5,1.5],[1.5,1.5],[1.5,.5],[.5,.5]],[[1,1],[1,1.7],[1.7,1.7],[1.7,1],[1,1]]]}]}),/overlap/);
});

test('dateline-crossing rings validate against crossing bounds',()=>{
  const crossing={schemaVersion:1 as const,id:'d',regionId:'r',bounds:[170,-10,-170,10] as [number,number,number,number],anchor:{longitude:180,latitude:1,height:0},buildings:[{id:'b',sourceId:'src',rings:[[[179,0],[-179,0],[-179,2],[179,2],[179,0]] as [number,number][]],heightM:3,heightKind:'source' as const}],roads:[]};
  assert.equal(validateTile(crossing).buildings.length,1);
  assert.throws(()=>validateTile({...crossing,bounds:[170,-10,175,10]}),/bounds do not contain/);
});

test('manifest validates timezone, safe content paths, unique IDs and source references',()=>{
  assert.equal(validateManifest(manifest).region.timezone,'Africa/Accra');
  assert.throws(()=>validateManifest({...manifest,region:{...manifest.region,timezone:'Mars/Olympus'}}),/timezone/);
  assert.throws(()=>validateManifest({...manifest,sources:[source,{...source}]}),/duplicate source/);
  assert.equal(validateManifest({...manifest,sources:[{...source,url:'file:world/pilots/accra.geojson'}]}).sources[0]!.url,'file:world/pilots/accra.geojson');
  assert.throws(()=>validateManifest({...manifest,climate:{sourceId:'missing',period:'x',months:Array.from({length:12},()=>({temperatureC:1,relativeHumidityPct:50,precipitationMm:0,windMps:0}))}}),/does not resolve/);
  assert.throws(()=>validateManifest({...manifest,sources:[{...source,url:'javascript:alert(1)'}]}),/HTTP\(S\)/);
  assert.throws(()=>validateManifest({...manifest,tiles:[{id:'t',path:'../x',sha256:'b'.repeat(64),bytes:1,brotliBytes:1,triangles:0,drawCalls:0,bounds:[0,0,1,1]}]}),/unsafe/);
});
