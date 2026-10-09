import test from 'node:test';
import assert from 'node:assert/strict';
import type { BufferGeometry, InstancedMesh, Mesh } from 'three';
import {createKit} from '../../scene/kit.ts';
import {buildUnilag,CAMPUS_BUDGET,crowdKindOf} from './scene.ts';
import {ANCHORS,ENTRANCE,TILE_SIZE,ZONES} from './layout.ts';
import {CAMPUS_MAP} from './map.generated.ts';
import {boundsOf,pointInRing} from './geo.ts';
import {CAMPUS_TREES} from './landscape.ts';

function residentPoint(scene:ReturnType<typeof buildUnilag>,zone:(typeof ZONES)[number]){
 const grid=scene.navigation.grids.get(zone.id);assert.ok(grid,`${zone.id} has an indexed walk grid`);
 const [gx,gz]=grid.bounds;
 const c0=Math.max(0,Math.floor((zone.bounds[0]-gx)/grid.cell)),c1=Math.min(grid.cols-1,Math.ceil((zone.bounds[2]-gx)/grid.cell)-1);
 const r0=Math.max(0,Math.floor((zone.bounds[1]-gz)/grid.cell)),r1=Math.min(grid.rows-1,Math.ceil((zone.bounds[3]-gz)/grid.cell)-1);
 for(let row=r0;row<=r1;row++)for(let col=c0;col<=c1;col++){
  const index=row*grid.cols+col;if(grid.cells[index]!==0)continue;
  const x=gx+(col+.5)*grid.cell,z=gz+(row+.5)*grid.cell;
  if(x<zone.bounds[0]||x>=zone.bounds[2]||z<zone.bounds[1]||z>=zone.bounds[3])continue;
  if(scene.navigation.zoneAt(x,z)?.id===zone.id&&scene.walk.grid.free(x,z))return{x,z};
 }
 return null;
}

function expectedResidentZoneIds(scene:ReturnType<typeof buildUnilag>){
 for(const zone of ZONES)assert.ok(scene.navigation.grids.has(zone.id),`${zone.id} is present in the walk-grid index`);
 const grid=scene.navigation.grids.get(ZONES[0]!.id);assert.ok(grid,'the campus has an indexed walk grid');
 const ids=new Set<string>(),checkedTiles=new Set<string>();const [gx,gz]=grid.bounds;const columns=Math.ceil((grid.bounds[2]-grid.bounds[0])/TILE_SIZE);
 // Independent whole-grid scan: occupancy cells are the walk mask; zoneAt classifies one free cell in each tile.
 for(let row=0;row<grid.rows;row++)for(let col=0;col<grid.cols;col++){
  if(grid.cells[row*grid.cols+col]!==0)continue;
  const x=gx+(col+.5)*grid.cell,z=gz+(row+.5)*grid.cell,tileColumn=Math.floor((x-gx)/TILE_SIZE),tileRow=Math.floor((z-gz)/TILE_SIZE),tile=ZONES[tileRow*columns+tileColumn];
  if(!tile||checkedTiles.has(tile.id))continue;
  const id=scene.navigation.zoneAt(x,z)?.id;if(id){ids.add(id);checkedTiles.add(tile.id);}
 }
 return ids;
}

function assertTreeInstanceBudget(scene:ReturnType<typeof buildUnilag>){
 const ground=scene.group.getObjectByName('UNILAG mapped ground');assert.ok(ground,'mapped ground group exists');
 const trees:InstancedMesh[]=[];ground.traverse(object=>{const mesh=object as InstancedMesh;if(mesh.isInstancedMesh)trees.push(mesh);});
 assert.ok(trees.length>0,'mapped tree instances are present');assert.ok(trees.length<=2,'tree detail remains one near and one far instance group');
 assert.equal(trees.reduce((sum,mesh)=>sum+mesh.count,0),CAMPUS_TREES.length,'near and far instances cover every authored tree exactly once');
 if(trees.length===2){
  const [high,low]=trees.slice().sort((a,b)=>b.geometry.attributes.position!.count-a.geometry.attributes.position!.count);
  assert.ok(high.geometry.attributes.position!.count>low.geometry.attributes.position!.count,'near-tree geometry is the higher-detail template');
  assert.ok(high.count<=24,'the higher-detail tree instance group stays within its authored cap');
 }else assert.equal(trees[0]!.count,CAMPUS_TREES.length,'when no near instance set exists, the sole set is the far-tree population');
}

function pointInsidePoolWithoutBuilding(){
 const pool=CAMPUS_MAP.surfaces.find(surface=>surface.kind==='pool'&&surface.osm.id===707208514);
 assert.ok(pool,'the pinned mapped pool fixture is present');
 const [x0,z0,x1,z1]=boundsOf(pool.ring),steps=64;
 for(let row=1;row<steps;row++)for(let col=1;col<steps;col++){
  const point:[number,number]=[x0+(x1-x0)*col/steps,z0+(z1-z0)*row/steps];
  if(pointInRing(point,pool.ring)&&pointInRing(point,CAMPUS_MAP.boundary)&&!CAMPUS_MAP.buildings.some(building=>pointInRing(point,building.ring)))return point;
 }
 return null;
}

function facadeGeometryRefs(scene:ReturnType<typeof buildUnilag>){
 const facade=scene.group.getObjectByName('Near campus facades');assert.ok(facade,'resident facade group exists');
 const geometries=new Set<BufferGeometry>();facade.traverse(object=>{const geometry=(object as Mesh).geometry;if(geometry)geometries.add(geometry);});
 return geometries;
}

test('every resident zone combination, full crowd and all landmarks stay within budget',()=>{
 const kit=createKit(),scene=buildUnilag(kit);let worst={triangles:0,drawCalls:0};
 const expectedResidents=expectedResidentZoneIds(scene);
 for(const [id,anchor] of Object.entries(ANCHORS)){
  assert.ok(scene.walk.grid.free(anchor.x,anchor.z),`${id} is obstructed by rendered props`);
  const path=scene.navigation.route(ENTRANCE,anchor);assert.ok(path,`no route to ${id}`);
  assert.ok(scene.setSpot(id));
  scene.setCrowd(Array.from({length:12},(_,i)=>({id:String(i),name:'Visitor',x:anchor.x,z:anchor.z})));
  assert.equal(scene.tags().filter(tag=>tag.kind==='player').length,CAMPUS_BUDGET.crowd,`${id}: all twelve peers are resident`);
  const stats=scene.stats();worst.triangles=Math.max(worst.triangles,stats.triangles);worst.drawCalls=Math.max(worst.drawCalls,stats.drawCalls);
  assert.ok(stats.triangles<=CAMPUS_BUDGET.triangles,`${id}: ${stats.triangles} triangles`);
  assert.ok(stats.drawCalls<=CAMPUS_BUDGET.drawCalls,`${id}: ${stats.drawCalls} calls`);
  assert.equal(stats.lights,0);
  assertTreeInstanceBudget(scene);
 }
 // ZONES is a rectangular 9x9 index; some cells have no walkable point inside the OSM campus polygon.
 const residentVisited=new Set<string>();
 for(const zone of ZONES){const p=residentPoint(scene,zone);if(!p){assert.ok(!expectedResidents.has(zone.id),`${zone.id} has no walkable cell inside its own polygon region`);continue;}assert.ok(expectedResidents.has(zone.id),`${zone.id} is independently resident in the full-grid scan`);assert.ok(scene.setPosition(p.x,p.z),`${zone.id} resident point is walkable`);assert.equal(scene.zone,zone.id);const stats=scene.stats();assert.ok(stats.triangles<=CAMPUS_BUDGET.triangles);assert.ok(stats.drawCalls<=CAMPUS_BUDGET.drawCalls);residentVisited.add(zone.id);assertTreeInstanceBudget(scene);}
 assert.deepEqual(residentVisited,expectedResidents,'per-zone resident sampling matches the independent whole-grid scan');console.log('UNILAG worst resident view',worst,'resident zones',residentVisited.size,'indexed zones',ZONES.length);
 scene.dispose();kit.dispose();
});

test('zone movement reuses resident geometry; disposal frees observed resources exactly once',()=>{
 const kit=createKit(),scene=buildUnilag(kit),observed=new Map<BufferGeometry,number>();
 const watch=()=>scene.group.traverse(o=>{const g=(o as Mesh).geometry;if(g&&!observed.has(g)){observed.set(g,0);g.addEventListener('dispose',()=>observed.set(g,observed.get(g)!+1));}});
 watch();
 const nudge=Object.entries(ANCHORS).flatMap(([id,anchor])=>[
  {id,anchor,x:anchor.x+1,z:anchor.z},{id,anchor,x:anchor.x-1,z:anchor.z},
  {id,anchor,x:anchor.x,z:anchor.z+1},{id,anchor,x:anchor.x,z:anchor.z-1},
 ]).find(({anchor,x,z})=>scene.navigation.zoneAt(x,z)?.id===anchor.zone&&scene.walk.grid.free(x,z));
 assert.ok(nudge,'a validated landmark has a free one-metre neighbor in its zone');
 assert.ok(scene.setSpot(nudge.id));watch();assertTreeInstanceBudget(scene);
 const startResidents=scene.stats().resident.slice(),startFacades=facadeGeometryRefs(scene);assert.ok(startFacades.size>0,'the selected landmark view has resident facade geometry');
 assert.ok(scene.setPosition(nudge.x,nudge.z));
 assert.deepEqual(scene.stats().resident,startResidents,'one-metre movement retains the same facade resident tiles');
 const movedFacades=facadeGeometryRefs(scene);assert.equal(movedFacades.size,startFacades.size);
 for(const geometry of startFacades)assert.ok(movedFacades.has(geometry),'same-tile movement reuses resident facade geometry');
 // stats().rebuilds aggregates facade-detail and tree-LOD work; geometry identity is the facade reuse oracle.
 assertTreeInstanceBudget(scene);
 for(const [id] of Object.entries(ANCHORS)){scene.setSpot(id);watch();assertTreeInstanceBudget(scene);}
 scene.dispose();scene.dispose();assert.equal(scene.group.children.length,0);
 for(const count of observed.values())assert.equal(count,1);
 kit.dispose();for(const count of observed.values())assert.equal(count,1);
});

test('resident renderings keep movement floors consistent and reject water',()=>{
 const kit=createKit(),scene=buildUnilag(kit);
 const poolPoint=pointInsidePoolWithoutBuilding();assert.ok(poolPoint,'pool fixture has an interior point on campus outside all buildings');
 assert.equal(pointInRing(poolPoint,CAMPUS_MAP.surfaces.find(surface=>surface.kind==='pool'&&surface.osm.id===707208514)!.ring),true);
 assert.equal(scene.walk.grid.free(poolPoint[0],poolPoint[1]),false,'mapped pool ground is blocked');
 assert.equal(scene.setPosition(poolPoint[0],poolPoint[1]),false);
 assert.equal(scene.setPosition(NaN,0),false);
 assert.equal(scene.walk.grid.path(ENTRANCE.x,ENTRANCE.z,poolPoint[0],poolPoint[1]),null);
 const outsideX=CAMPUS_MAP.bounds[2]+1;
 assert.equal(scene.walk.grid.free(outsideX,0),false);
 assert.equal(scene.setPosition(outsideX,0),false);
 assert.equal(scene.walk.grid.path(ENTRANCE.x,ENTRANCE.z,outsideX,0),null);
 assert.equal(scene.update({t:Date.UTC(2026,9,4,11)}),false);
 scene.setTime('night');assert.equal(scene.update({t:Date.UTC(2026,9,4,22)}),false);
 scene.dispose();kit.dispose();
});

test('the starting avatar uses a valid outfit colour id, so its look is deterministic',async()=>{
  const {APPEARANCE}=await import('../../game/content/traits.ts');
  const source=(await import('node:fs')).readFileSync(new URL('./scene.ts',import.meta.url),'utf8');
  const colour=/outfitColor: '([a-z-]+)'/.exec(source)?.[1];
  assert.ok(colour);
  assert.ok(APPEARANCE.outfitColours.some((option)=>option.id===colour),`${colour} is an outfit colour`);
});

test('a peer sent without kind is a player on the mini-map, like the tag layer and the scene',()=>{
  assert.equal(crowdKindOf({}),'player');
  assert.equal(crowdKindOf({kind:'player'}),'player');
  assert.equal(crowdKindOf({kind:'npc'}),'npc');
});
