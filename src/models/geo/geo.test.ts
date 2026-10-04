import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three';
import { loadGeography,buildGeography,buildCountry,containsPoint,measureGeography,buildRoute,transitionCamera } from './index.ts';
import type { Coordinate, GeoDataset, GeoFeature, GeographyModel, CameraFrame } from './index.ts';

const featureMeta=(model: GeographyModel,id: string)=>model.userData.features[id]!;
const child=(root: THREE.Object3D,i: number)=>root.children[i] as THREE.LineSegments;

test('all four local datasets retain their feature counts and byte budgets',async()=>{
  for(const [level,count,bytes] of [['world',242,120000],['africa',56,80000],['nigeria',37,60000],['kenya',47,40000]] as [string, number, number][]){
    const data=await loadGeography(level);assert.equal(data.features.length,count);assert.equal(new Set(data.features.map(f=>f.id)).size,count);
    assert.ok((await readFile(new URL(`./data/${level}.ts`,import.meta.url))).byteLength<=bytes);
    const model=buildGeography(data,{selected:data.features[0]!.id,comingSoon:[data.features[1]!.id]});
    assert.deepEqual(measureGeography(model.object3D),{triangles:model.userData.triangles,drawCalls:model.userData.drawCalls});
    assert.ok(model.userData.drawCalls<=12);assert.ok(model.userData.triangles>0);
    for(const feature of data.features){const meta=featureMeta(model,feature.id);const p=model.unproject(meta.labelAnchor.x,meta.labelAnchor.z);assert.ok(containsPoint(feature,p.lon,p.lat),`interior anchor: ${level}/${feature.name}`);}
    model.userData.dispose();
  }
});

test('Nigeria retains 37 distinct capitals and geography picks reviewed sample locations',async()=>{
  const nigeria=await loadGeography('nigeria'),map=buildGeography(nigeria);
  assert.equal(nigeria.cities!.filter(c=>c.capitalOf).length,37);assert.equal(new Set(nigeria.cities!.filter(c=>c.capitalOf).map(c=>c.capitalOf)).size,37);
  assert.equal(map.pick({lon:3.33333,lat:6.58333}),'NG-LA');
  assert.equal(map.pick({lon:7.49,lat:9.06}),'NG-FC');assert.equal(map.pick({lon:8.518,lat:12.002}),'NG-KN');assert.equal(map.pick({lon:0,lat:0}),null);
  assert.ok(nigeria.rivers!.some(r=>r.name==='Niger'));assert.ok(nigeria.rivers!.some(r=>r.name==='Benue'));
  const africa=await loadGeography('africa');assert.ok(africa.features.some(f=>f.id==='MU'));assert.ok(africa.features.some(f=>f.id==='SC'));
  const kenya=buildGeography(await loadGeography('kenya'));assert.equal(featureMeta(kenya,kenya.pick({lon:36.82,lat:-1.29})!).name,'Nairobi');
  map.userData.dispose();kenya.userData.dispose();
});

test('generic country keeps holes unpickable, supports palette/highlight/hover and disposes each owned resource once',()=>{
  const data: GeoDataset={id:'fixture',name:'Fixture',features:[{id:'A',name:'A',polygons:[[[[0,0],[5,0],[5,5],[0,5],[0,0]],[[1,1],[1,2],[2,2],[2,1],[1,1]]]]}]};
  const map=buildCountry(data,{palette:[0x567844],comingSoon:['A']});assert.equal(map.pick({lon:.5,lat:.5}),'A');assert.equal(map.pick({lon:1.5,lat:1.5}),null);
  const color=(map.userData.parts.land.geometry as THREE.BufferGeometry).attributes.color!,base=color.array.slice();map.highlight('A');assert.notDeepEqual(color.array,base);map.hover('A');map.highlight('A',false);map.hover(null);assert.deepEqual(color.array,base);
  interface Disposable { addEventListener: (type: 'dispose', listener: () => void) => void }
  const events=new Map<Disposable, number>();map.object3D.traverse(o=>{const m=o as Partial<THREE.Mesh>;for(const resource of [m.geometry,...(Array.isArray(m.material)?m.material:[m.material]),...(o instanceof THREE.InstancedMesh?[o]:[])] as (Disposable | undefined)[])if(resource&&!events.has(resource)){events.set(resource,0);resource.addEventListener('dispose',()=>events.set(resource,events.get(resource)!+1));}});
  map.userData.dispose();map.userData.dispose();for(const count of events.values())assert.equal(count,1);
  assert.throws(()=>buildGeography({...data,features:[data.features[0]!,data.features[0]!]}),/duplicate/);
});

test('route scrub and camera interpolation are deterministic and reuse buffers',async()=>{
  const data=await loadGeography('nigeria'),map=buildGeography(data),route=buildRoute(map,data.roads![1]!.points,{mode:'flight'}),anchor=route.userData.anchors.traveller;
  const position=child(route.object3D,0).geometry.attributes.position!.array;
  route.pose(.3);const first=anchor.position.toArray();route.pose(.9);route.pose(.3);assert.deepEqual(anchor.position.toArray(),first);assert.equal(child(route.object3D,0).geometry.attributes.position!.array,position);
  route.pose(0);assert.equal(child(route.object3D,0).geometry.drawRange.count,0);route.pose(1);assert.equal(child(route.object3D,0).geometry.drawRange.count,128);
  const from=map.frame(),to=map.frame('NG-LA'),out: CameraFrame={position:new THREE.Vector3(),target:new THREE.Vector3(),span:0};
  const p=out.position,t=out.target;transitionCamera(from,to,.4,out);const snapshot=[...out.position.toArray(),...out.target.toArray(),out.span];transitionCamera(from,to,.8,out);transitionCamera(from,to,.4,out);assert.deepEqual([...out.position.toArray(),...out.target.toArray(),out.span],snapshot);assert.equal(out.position,p);assert.equal(out.target,t);
  transitionCamera(from,to,0,out);assert.deepEqual(out.position,from.position);transitionCamera(from,to,1,out);assert.deepEqual(out.position,to.position);
  route.userData.dispose();map.userData.dispose();
});

test('boundary validation rejects unclosed, degenerate rings and invalid depth',()=>{
  const closed: Coordinate[]=[[0,0],[5,0],[5,5],[0,5],[0,0]],data=(ring: Coordinate[]): GeoDataset=>({id:'fixture',name:'fixture',features:[{id:'A',name:'A',polygons:[[ring]]}]});
  assert.throws(()=>buildGeography(data(closed.slice(0,-1))),/Invalid polygon/);
  assert.throws(()=>buildGeography(data([[0,0],[1,1],[2,2],[0,0]]),{comingSoon:['A']}),/Invalid polygon/);
  for(const depth of [NaN,Infinity,0,-1])assert.throws(()=>buildGeography(data(closed),{depth}),/depth/);
});

test('routes collapse duplicate endpoints and country focus frames prefer mainland geometry',async()=>{
  const nigeria=buildGeography(await loadGeography('nigeria'));
  const a: Coordinate=[3.3,6.5],b: Coordinate=[7.5,9.1];
  for(const points of [[a,a,b],[a,b,b],[a,a,b,b],[a,b,b,a]]){
    const route=buildRoute(nigeria,points);for(const t of [0,.5,1]){route.pose(t);assert.ok(route.userData.anchors.traveller.position.toArray().every(Number.isFinite));}route.userData.dispose();
  }
  assert.throws(()=>buildRoute(nigeria,[a,a]),/zero length/);nigeria.userData.dispose();
  const world=buildGeography(await loadGeography('world'));assert.ok(world.frame('FR').span<world.frame().span/10);assert.ok(world.frame('RU').span<world.frame().span/2);world.userData.dispose();
});

test('compiler nodes unequal edge segmentation before simplifying shared boundaries',()=>{
  const result=execFileSync('python3',['-c',`import importlib.util,json
spec=importlib.util.spec_from_file_location('compiler','src/models/geo/generate-data.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
a={'id':'A','polygons':[[[(0,0),(2,0),(2,1),(2,2),(0,2),(0,0)]]]}
b={'id':'B','polygons':[[[(2,0),(4,0),(4,2),(2,2),(2,0)]]]}
f=m.node_edges([a,b]);assert (2,1) in f[1]['polygons'][0][0]
s=m.simplify(f,.1)
print(json.dumps(s))`],{encoding:'utf8'});
  const [a,b]=JSON.parse(result) as [GeoFeature, GeoFeature],shared=(f: GeoFeature)=>f.polygons[0]![0]!.filter(p=>p[0]===2).map(p=>p.join(',')).sort();assert.deepEqual([...new Set(shared(a))],[...new Set(shared(b))]);
});
