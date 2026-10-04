import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import type { EnvironmentModel } from './index.ts';
import { DETAILS, ENVIRONMENT_TYPES, buildEnvironment, poseEnvironment } from './index.ts';
import { GeometryBatch } from './geometry.ts';

const LIMITS={map:250,street:1500,showcase:8000};

const mesh=(model: EnvironmentModel,part: string)=>model.userData.parts[part] as THREE.Mesh;
const anchorOf=(model: EnvironmentModel,name: string)=>(model.userData.anchors as unknown as Record<string, THREE.Object3D | THREE.Vector3>)[name]!;
const attr=(geometry: THREE.BufferGeometry,name: string)=>geometry.attributes[name]!;

test('all environment types build within every detail budget',()=>{
  for(const type of ENVIRONMENT_TYPES) for(const detail of DETAILS){
    const model=buildEnvironment(type,{detail});
    assert.equal(model.object3D.userData,model.userData);
    assert.ok(model.userData.triangles>0,`${type}/${detail} has geometry`);
    assert.ok(model.userData.triangles<=LIMITS[detail],`${type}/${detail}: ${model.userData.triangles}`);
    assert.ok(model.userData.drawCalls<=3,`${type}/${detail}: ${model.userData.drawCalls} draw calls`);
    assert.ok(model.userData.anchors.footprint.x>0);
    assert.ok(model.userData.dimensions.height>0);
    model.userData.dispose(); model.userData.dispose();
  }
});

test('options alter colour and controlled water opacity',()=>{
  const building=buildEnvironment('bungalow',{detail:'showcase',color:'#224466'});
  const color=attr(mesh(building,'structure').geometry,'color');
  assert.ok(color.count>0);
  const lagoon=buildEnvironment('lagoon',{detail:'street',color:'#336699',opacity:.7,time:4});
  assert.equal((mesh(lagoon,'water').material as THREE.MeshStandardMaterial).opacity,.7);
  assert.equal((mesh(lagoon,'water').material as THREE.MeshStandardMaterial).transparent,true);
  assert.equal((mesh(lagoon,'water').material as THREE.MeshStandardMaterial).forceSinglePass,true);
  const opaque=buildEnvironment('river');
  assert.equal((mesh(opaque,'water').material as THREE.MeshStandardMaterial).transparent,false);
  opaque.userData.dispose();
  building.userData.dispose(); lagoon.userData.dispose();
});

test('water pose is deterministic, preserves placement, and reuses position and normal buffers',()=>{
  for(const type of ['lagoon','river','beach']){
    const model=buildEnvironment(type,{detail:'showcase'}); const attribute=attr(mesh(model,'water').geometry,'position'); const normal=attr(mesh(model,'water').geometry,'normal'); const array=attribute.array; const normalArray=normal.array;
    model.object3D.position.set(7,11,-4);
    poseEnvironment(model,{progress:.37,time:8.5}); const first=Array.from(array);
    poseEnvironment(model,{progress:.9,time:2}); poseEnvironment(model,{progress:.37,time:8.5});
    assert.equal(attribute.array,array); assert.equal(normal.array,normalArray); assert.deepEqual(Array.from(array),first); assert.deepEqual(model.object3D.position.toArray(),[7,11,-4]); model.userData.dispose();
  }
});

test('environment massing and anchors stay stable across detail levels',()=>{
  for(const type of ENVIRONMENT_TYPES){
    const models=DETAILS.map((detail)=>buildEnvironment(type,{detail})); const first=models[0]!;
    for(const model of models.slice(1)){
      for(const key of ['width','height','depth'] as const) assert.ok(Math.abs(model.userData.dimensions[key]-first.userData.dimensions[key])<1e-5,`${type} ${key}`);
      for(const name of Object.keys(first.userData.anchors)){ const a=anchorOf(first,name); const b=anchorOf(model,name); const av=a instanceof THREE.Object3D?a.position:a; const bv=b instanceof THREE.Object3D?b.position:b; assert.ok(av.distanceTo(bv)<1e-5,`${type} ${name}`); }
    }
    models.forEach((model)=>model.userData.dispose());
  }
});

test('compound gateway has a clear central opening',()=>{
  const model=buildEnvironment('compound-house',{detail:'showcase'}); const position=attr(mesh(model,'structure').geometry,'position');
  for(let i=0;i<position.count;i+=1){ const x=position.getX(i); const y=position.getY(i); const z=position.getZ(i); assert.ok(!(Math.abs(x)<1&&y>.5&&y<1.5&&z>3.3),`blocked at ${x},${y},${z}`); }
  assert.deepEqual(model.userData.anchors.gate!.position.toArray(),[0,0,3.5]); model.userData.dispose();
});

test('gabled roof end-cap normals face outward',()=>{
  const batch=new GeometryBatch(); batch.roof(0,0,0,4,2,6,0xffffff); const geometry=batch.build(); const position=attr(geometry,'position'); const normal=attr(geometry,'normal');
  for(let i=0;i<position.count;i+=1){ const z=position.getZ(i); const nz=normal.getZ(i); if(z===-3&&Math.abs(nz)>.5) assert.ok(nz<0); if(z===3&&Math.abs(nz)>.5) assert.ok(nz>0); }
  geometry.dispose();
});

test('showcase corrugation follows and contacts each bungalow roof slope',()=>{
  const model=buildEnvironment('bungalow',{detail:'showcase'}); const geometry=mesh(model,'structure').geometry; const position=attr(geometry,'position'); const color=attr(geometry,'color'); const target=new THREE.Color(0x7f342d); let matches=0; let contacts=0;
  for(let i=0;i<position.count;i+=1){ if(Math.abs(color.getX(i)-target.r)>.0001||Math.abs(color.getY(i)-target.g)>.0001||Math.abs(color.getZ(i)-target.b)>.0001) continue; matches+=1; const x=position.getX(i); const surface=2.5+1.25*(1-Math.abs(x)/3.7); const gap=position.getY(i)-surface; assert.ok(gap>-.0001&&gap<.08,`corrugation gap ${gap}`); if(Math.abs(gap)<.0001) contacts+=1; }
  assert.ok(matches>40); assert.ok(contacts>10); model.userData.dispose();
});

test('bridge defaults to asphalt, accepts a deck colour, and showcase market adds produce piles',()=>{
  const bridge=buildEnvironment('bridge',{detail:'map'}); const custom=buildEnvironment('bridge',{detail:'map',color:0x123456});
  const firstHex=(model: EnvironmentModel)=>{ const color=attr(mesh(model,'structure').geometry,'color'); return new THREE.Color().setRGB(color.getX(0),color.getY(0),color.getZ(0)).getHex(); };
  assert.equal(firstHex(bridge),0x454a4d); assert.equal(firstHex(custom),0x123456);
  const street=buildEnvironment('market-stall',{detail:'street'}); const showcase=buildEnvironment('market-stall',{detail:'showcase'}); assert.ok(showcase.userData.triangles-street.userData.triangles>=78);
  bridge.userData.dispose(); custom.userData.dispose(); street.userData.dispose(); showcase.userData.dispose();
});

test('unknown type is rejected and unknown detail falls back safely',()=>{
  assert.throws(()=>buildEnvironment('airport'),RangeError);
  const model=buildEnvironment('bus-stop',{detail:'cinematic' as unknown as 'map'});
  assert.equal(model.userData.detail,'street'); model.userData.dispose();
});

test('dispose owns each resource and remains idempotent',()=>{
  const model=buildEnvironment('beach',{detail:'showcase'}); let calls=0; let instanceDisposals=0;
  model.userData.parts.palms!.addEventListener('dispose' as never,()=>{ instanceDisposals+=1; });
  model.object3D.traverse((object)=>{
    if(!(object instanceof THREE.Mesh)) return;
    for(const resource of [object.geometry as THREE.BufferGeometry,object.material as THREE.Material]){ const dispose=resource.dispose.bind(resource); resource.dispose=()=>{ calls+=1; dispose(); }; }
  });
  model.userData.dispose(); const first=calls; model.userData.dispose();
  assert.equal(first,6); assert.equal(calls,first); assert.equal(instanceDisposals,1);
});
