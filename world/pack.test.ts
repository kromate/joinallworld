import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, encodeManifest, encodeTile, sha256 } from './pack.ts';

const square = [[0,0],[.001,0],[.001,.001],[0,.001],[0,0]] as [number,number][];
const tile = {schemaVersion:1 as const,id:'t',regionId:'r',bounds:[0,0,1,1] as [number,number,number,number],anchor:{longitude:0,latitude:0,height:0},buildings:[{id:'b',sourceId:'s',rings:[square],heightM:5,heightKind:'source' as const}],roads:[]};
const manifest = {schemaVersion:1 as const,compilerVersion:'1',region:{id:'r',parentId:null,name:'R',kind:'city' as const,countryCode:'GH',timezone:null,bounds:[0,0,1,1] as [number,number,number,number]},frame:'wgs84-enu-m-v1' as const,verticalDatum:'WGS84-ellipsoid' as const,coverage:'foundation' as const,exceptions:[],sources:[{id:'s',url:'https://example.test/source',release:'v1',license:'CC-BY-4.0',attribution:'x',sha256:'a'.repeat(64),bytes:42}],tiles:[],climate:null};

test('canonical JSON and encoded tiles are stable and content addressed',()=>{
  assert.equal(canonicalJson({z:1,a:{y:2,x:3}}),'{"a":{"x":3,"y":2},"z":1}');
  const first=encodeTile(tile), second=encodeTile(tile);
  assert.equal(first.ref.sha256,sha256(first.bytes));
  assert.equal(first.ref.path,`tiles/${first.ref.sha256}.json`);
  assert.equal(first.ref.sha256,second.ref.sha256);
  assert.ok(first.ref.brotliBytes>0);
  assert.ok(first.ref.triangles>=12);
});

test('manifest encoding hashes canonical validated bytes',()=>{
  const encoded=encodeManifest(manifest);
  assert.equal(encoded.hash,sha256(encoded.bytes));
  assert.ok(encoded.bytes.byteLength>0);
});

test('conservative geometry count rejects excessive complexity before packaging',()=>{
  const buildings=Array.from({length:3000},(_,i)=>({id:`b${i}`,sourceId:'s',rings:[square],heightM:1,heightKind:'estimated' as const}));
  assert.throws(()=>encodeTile({...tile,buildings}),/triangle budget/);
});

test('canonical JSON rejects non JSON values',()=>{
  assert.throws(()=>canonicalJson({x:Number.NaN}),/non-finite/);
  assert.throws(()=>canonicalJson({x:undefined}),/not JSON/);
});
