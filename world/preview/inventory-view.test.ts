import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fetchInventoryAsset, inventoryGeometryPath, validateInventoryGeometry, validateInventoryIndex, validateInventoryManifest, verifyInventoryBytes } from './inventory-view.ts';

const digest=async(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const manifest={schemaVersion:1,sources:[{id:'natural-earth',url:'https://example.test/data',release:'r1',license:'Public domain',attribution:'Natural Earth',sha256:'a'.repeat(64),bytes:100}],sourceUnitCount:177,exceptions:[],rollups:[{id:'continent:africa',name:'Africa',countryCount:51,sourceUnitCount:51,exceptionCount:2}],rootNodePath:`nodes/${'b'.repeat(64)}.json`,outlineCount:176};
const countryIndex={node:{id:'country:natural-earth%3ANE_ID%3A12',parentId:'continent:africa',name:'Testland',kind:'country',countryCode:'TL',bounds:[170,-20,-170,20],sourceFeatureIds:['natural-earth:NE_ID:12'],provider:'world',outline:'available',exceptions:[]},outlinePath:`outlines/${'c'.repeat(64)}.json`,children:[]};
const polygon={type:'Polygon',coordinates:[[[179,-2],[-179,-2],[-179,2],[179,2],[179,-2]],[[179.4,-1],[179.8,-1],[179.8,1],[179.4,1],[179.4,-1]]]};

test('validates the published manifest and hierarchy index shapes strictly',()=>{
 assert.equal(validateInventoryManifest(manifest).sourceUnitCount,177);
 assert.equal(validateInventoryIndex(countryIndex,'country:natural-earth%3ANE_ID%3A12').node.name,'Testland');
 assert.throws(()=>validateInventoryManifest({...manifest,extra:true}),/unknown manifest field/);
 assert.throws(()=>validateInventoryIndex({...countryIndex,children:[{id:'bad',path:'../secret'}]}),/invalid/);
 assert.throws(()=>validateInventoryIndex(countryIndex,'country:other'),/invalid/);
});

test('validates bounded closed WGS84 rings and generates antimeridian paths without cross-map edges',()=>{
 const geometry=validateInventoryGeometry(polygon);
 const path=inventoryGeometryPath(geometry);
 assert.equal((path.match(/M/g)??[]).length,3); // Dateline-crossing exterior is repeated at both edges.
 assert.equal((path.match(/Z/g)??[]).length,3);
 let previous:[number,number]|null=null;
 for(const match of path.matchAll(/[ML](-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)){
  const point:[number,number]=[Number(match[1]),Number(match[2])];
  if(match[0][0]==='M')previous=null;
  if(previous)assert.ok(Math.abs(point[0]-previous[0])<20,'ring should not draw a line across the world map');
  previous=point;
 }
 const xs=[...path.matchAll(/[ML](-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map(m=>Number(m[1]));
 assert.ok(xs.some(x=>x<0)&&xs.some(x=>x>720),'dateline copies are clipped naturally at both map edges');
 assert.throws(()=>validateInventoryGeometry({type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1]]]}),/not closed/);
});

test('polar outline stroke does not draw an artificial closure across the map',()=>{
 const antarctica=validateInventoryGeometry({type:'Polygon',coordinates:[[[-180,-80],[-90,-85],[0,-90],[90,-85],[180,-80],[-180,-80]]]});
 const stroke=inventoryGeometryPath(antarctica,720,360,true);
 assert.equal((stroke.match(/Z/g)??[]).length,0);
 let previous:[number,number]|null=null;
 for(const match of stroke.matchAll(/[ML](-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)){
  const point:[number,number]=[Number(match[1]),Number(match[2])];
  if(previous)assert.ok(Math.abs(point[0]-previous[0])<=360,'polar boundary must not close across the map');
  previous=point;
 }
});

test('verifies exact content hashes and caps asset bytes before JSON validation',async()=>{
 const bytes=new TextEncoder().encode(JSON.stringify(manifest)),hash=await digest(bytes);
 await verifyInventoryBytes(bytes,hash,10_000,digest);
 await assert.rejects(verifyInventoryBytes(bytes,'0'.repeat(64),10_000,digest),/hash mismatch/);
 await assert.rejects(verifyInventoryBytes(bytes,hash,4,digest),/byte limit/);
 const response=new Response(bytes,{headers:{'content-length':String(bytes.byteLength)}});
 const fetched=await fetchInventoryAsset('https://example.test/index',hash,10_000,new AbortController().signal,validateInventoryManifest,async()=>response);
 assert.equal(fetched.value.sourceUnitCount,177);
 assert.equal(fetched.bytes,bytes.byteLength);
});
