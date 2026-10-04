import test from 'node:test';
import assert from 'node:assert/strict';
import {createKit} from '../../scene/kit.js';
import {buildUnilag,CAMPUS_BUDGET} from './scene.js';
import {ANCHORS,ENTRANCE,ZONES} from './layout.js';

test('every resident zone combination, full crowd and all landmarks stay within budget',()=>{
 const kit=createKit(),scene=buildUnilag(kit);let worst={triangles:0,drawCalls:0};
 const visited=new Set();
 for(const [id,anchor] of Object.entries(ANCHORS)){
  assert.ok(scene.walk.grid.free(anchor.x,anchor.z),`${id} is obstructed by rendered props`);
  const path=scene.navigation.route(ENTRANCE,anchor);assert.ok(path,`no route to ${id}`);
  assert.ok(scene.setSpot(id));visited.add(scene.zone);
  scene.setCrowd(Array.from({length:12},(_,i)=>({id:String(i),name:'Visitor',x:anchor.x,z:anchor.z})));
  const stats=scene.stats();worst.triangles=Math.max(worst.triangles,stats.triangles);worst.drawCalls=Math.max(worst.drawCalls,stats.drawCalls);
  assert.ok(stats.triangles<=CAMPUS_BUDGET.triangles,`${id}: ${stats.triangles} triangles`);
  assert.ok(stats.drawCalls<=CAMPUS_BUDGET.drawCalls,`${id}: ${stats.drawCalls} calls`);
  assert.equal(stats.lights,0);
 }
 // Empty south zone is still a required resident view.
 for(const zone of ZONES){const p=scene.navigation.grids.get(zone.id).nearest((zone.bounds[0]+zone.bounds[2])/2,(zone.bounds[1]+zone.bounds[3])/2);assert.ok(scene.setPosition(p.x,p.z));const stats=scene.stats();assert.ok(stats.triangles<=60000);assert.ok(stats.drawCalls<=60);visited.add(scene.zone);}
 assert.equal(visited.size,ZONES.length);console.log('UNILAG worst resident view',worst);
 scene.dispose();kit.dispose();
});

test('zone movement reuses resident geometry; disposal frees observed resources exactly once',()=>{
 const kit=createKit(),scene=buildUnilag(kit),observed=new Map();
 const watch=()=>scene.group.traverse(o=>{if(o.geometry&&!observed.has(o.geometry)){observed.set(o.geometry,0);o.geometry.addEventListener('dispose',()=>observed.set(o.geometry,observed.get(o.geometry)+1));}});
 watch();const start=scene.stats().rebuilds;
 scene.setPosition(ENTRANCE.x,ENTRANCE.z+1);assert.equal(scene.stats().rebuilds,start);
 for(const [id] of Object.entries(ANCHORS)){scene.setSpot(id);watch();}
 scene.dispose();scene.dispose();assert.equal(scene.group.children.length,0);
 for(const count of observed.values())assert.equal(count,1);
 kit.dispose();for(const count of observed.values())assert.equal(count,1);
});

test('resident renderings keep movement floors consistent and reject water',()=>{
 const kit=createKit(),scene=buildUnilag(kit);
 assert.equal(scene.setPosition(360,0),false);
 assert.equal(scene.setPosition(NaN,0),false);
 assert.equal(scene.walk.grid.path(ENTRANCE.x,ENTRANCE.z,360,0),null);
 assert.equal(scene.update({t:Date.UTC(2026,9,4,11)}),false);
 scene.setTime('night');assert.equal(scene.update({t:Date.UTC(2026,9,4,22)}),false);
 scene.dispose();kit.dispose();
});
