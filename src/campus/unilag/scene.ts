import type { Look } from '../../types/life.ts';
import type { BufferGeometry, Group, InstancedMesh, Mesh } from 'three';
import { createBatch, sceneMaterials, kitResources, releaseObjects } from '../../scene/build.ts';
import { buildAvatar, poseAvatar } from '../../scene/characters.ts';
import type { Pose, RiggedAvatar } from '../../scene/characters.ts';
import { lagosTime } from '../../game/clock.ts';
import { ZONES, BUILDINGS, ROADS, ANCHORS, ENTRANCE } from './layout.ts';
import type { CampusAnchor, CampusBuilding, CampusZone } from './layout.ts';
import { createCampusWalk, footprintOf } from './walk.ts';
import type { CampusWalk as NavigationApi, WalkCircle, WalkGrid, WalkPoint, WalkRect } from './walk.ts';
import { drawBuilding } from './buildings.ts';
import type { BuildingStyle } from './buildings.ts';
import { instances, primitiveGeometry, measureScene } from '../shared/geometry.ts';
import type { Instance, SceneMeasure } from '../shared/geometry.ts';
import type { Kit } from '../../scene/kit.ts';
import type { Batch, SceneMaterials } from '../../scene/types.ts';

export type Point = WalkPoint;
/** Obstacle shapes the walk model accepts: a rectangle [x0, z0, x1, z1] or a circle [x, z, radius]. */
export type Footprint = WalkRect | WalkCircle;
export type CampusGrid = WalkGrid;
export type CampusNavigation = NavigationApi;
export interface CampusGridView {
  bounds: [number, number, number, number];
  free(x: number, z: number): boolean;
  path(ax: number, az: number, bx: number, bz: number): Point[] | null;
  nearest(x: number, z: number): Point | null;
}
export type Solid = [number, number, number, number, number, number];
export interface CrowdPerson { id: string; name: string; kind: 'npc' | 'player'; x: number; z: number }
/** What a caller may pass to setCrowd(): a position, or a landmark id to stand beside. */
/** A peer sent without `kind` is a player: the tag layer, the scene and the host's mini-map all read it so. */
export const crowdKindOf = (person: { kind?: string }): 'npc' | 'player' => (person.kind === 'npc' ? 'npc' : 'player');
export interface CrowdInput { id: string | number; name?: unknown; kind?: string; x?: number; z?: number; spot?: string }
export interface CampusTag { id: string; name: string; kind: string; position: { x: number; y: number; z: number } }
export interface PlayerInput { look?: Partial<Look> | null; seed?: string; pose?: Pose }
export interface CampusSceneState { t?: number }
export interface CampusSceneStats extends SceneMeasure { zone: string | null; resident: string[]; rebuilds: number }
export interface PlayerPosition { x: number; y: number; z: number; ry: number; zone: string }

/** The campus walk surface the host and the preview drive the avatar through. */
export interface AvatarWalk {
  entrance: number[]; open: boolean; avatar: Group; raised: unknown[]; scale: number;
  readonly centre: number[];
  readonly grid: CampusGridView;
  solids: Solid[];
  move(x: number, y: number, z: number, ry: number): void;
  drive(): void;
  rest(): void;
  gait(step: unknown, phase: number): void;
  pose(name: string): void;
  heightAt(): number;
  near(at?: Point | null): boolean;
  goal(x?: number, z?: number): boolean;
  spots(): Array<CampusAnchor & { approach: null; steps: never[] }>;
  people(): Array<CrowdPerson & { top: number }>;
}

export interface UnilagScene {
  group: Group; kind: 'unilag'; mood: 'outdoor';
  anchors: Record<string, CampusAnchor>;
  walk: AvatarWalk;
  navigation: CampusNavigation;
  camera: { landscape: number[]; portrait: number[] };
  readonly background: string;
  readonly time: string;
  readonly zone: string | null;
  readonly position: PlayerPosition;
  update(state?: CampusSceneState | null): boolean;
  setTime(value: string): boolean;
  lighting(): { hemi: [string, string, number]; sun: [string, number, number[]] };
  setPosition(x: number, z: number): boolean;
  setSpot(id: string): boolean;
  setPlayer(input?: PlayerInput): boolean;
  setCrowd(people: CrowdInput[] | null | undefined): CampusTag[];
  tags(): CampusTag[];
  stats(): CampusSceneStats;
  dispose(): void;
}

interface ResidentZone { node: Group; detail: number; dispose(): void }
type DecorKind = 'tree' | 'lamp' | 'bench' | 'car';
type Decorations = Record<DecorKind, Instance[]>;
const finite = (value: unknown): value is number => Number.isFinite(value);

const STYLE: Record<string, string> = { senate: 'senate', library: 'library', auditorium: 'auditorium', engineering: 'lecture',
  cafeteria: 'cafeteria', 'access-bank': 'bank', 'sports-centre': 'sports', chapel: 'chapel',
  mosque: 'mosque', amphitheatre: 'amphitheatre', 'lagoon-front': 'lagoon' };
const styleOf = (b: CampusBuilding): BuildingStyle => ({ ...b, color: b.kind==='hall'?'#d9ba73':b.id==='access-bank'?'#ded3b6':'#ddd2b5', kind: STYLE[b.id] || (b.id.includes('mosque') ? 'mosque' : b.id.includes('chapel') ? 'chapel' : b.kind === 'open-space' ? 'garden' : b.kind) });
export const CAMPUS_BUDGET = Object.freeze({ triangles: 60000, drawCalls: 60, crowd: 12 });

/** Procedural campus scene. Position updates are the only trigger for zone residency.
 * No renderer, timers or frame loop belong to this module.
 */
export function buildUnilag(kit: Kit, venue: { scene?: { time?: string } } = {}): UnilagScene {
  const { THREE } = kit, group = new THREE.Group(), navigation: CampusNavigation = createCampusWalk();
  group.name = 'Allworld UNILAG';
  const materials: SceneMaterials = sceneMaterials(kit), resident = new Map<string, ResidentZone>(), ownedGeometry = new Set<BufferGeometry>();
  const instanceGeometries: Record<'tree' | 'lamp' | 'bench' | 'car' | 'window' | 'person', BufferGeometry> = {
    tree: primitiveGeometry(kit, b => {
      b.cyl(0, 2.4, 0, .35, 4.8, '#79664a', { seg: 6 });
      b.ico(0, 6, 0, 3.6, 3.1, 3.6, '#608762');
      b.ico(1.8, 5.3, .4, 2.6, 2, 2.6, '#72946a');
    }),
    lamp: primitiveGeometry(kit, b => {
      b.box(0, 3, 0, .16, 6, .16, '#5d6965');
      b.box(.55, 6, 0, 1.2, .18, .5, '#f5de9b');
    }),
    bench: primitiveGeometry(kit, b => {
      b.box(0, .65, 0, 3.2, .25, 1, '#ae8760');
      b.box(0, 1.15, -.5, 3.2, 1, .15, '#ae8760');
      for (const x of [-1.1, 1.1]) b.box(x, .3, 0, .2, .6, .8, '#647770');
    }),
    car: primitiveGeometry(kit, b => {
      b.box(0, .8, 0, 2.3, .9, 4.4, '#c6bba5');
      b.box(0, 1.6, -.2, 2, .8, 2.4, '#65828b');
      for (const x of [-1.1, 1.1]) for (const z of [-1.3, 1.3]) b.box(x, .45, z, .35, .7, .7, '#303d3b');
    }),
    window: primitiveGeometry(kit, b => b.box(0, 0, 0, 1, 1, 1, '#647f83')),
    person: primitiveGeometry(kit, b => {
      b.box(0, 1.05, 0, .65, .8, .35, '#dca85c');
      b.cyl(0, 1.72, 0, .24, .43, '#795136', { seg: 6 });
      for (const x of [-.18, .18]) b.box(x, .37, 0, .23, .74, .26, '#3e555c');
    }),
  };
  Object.values(instanceGeometries).forEach(g => ownedGeometry.add(g));
  // 'gold' is the warm outfit colour of the look options closest to the ochre this was meant to be.
  let player: RiggedAvatar = buildAvatar(kit, { body: 'woman', outfit: 'casual', outfitColor: 'gold', skin: 'skin-5' }, { detail: 'low', rig: true, scale: .75, seed: 'campus-visitor' });
  group.add(player);
  let current: string | null = null, time = venue.scene?.time || 'day', disposed = false, crowd: CrowdPerson[] = [], crowdMesh: InstancedMesh | null = null;
  let rebuilds = 0;
  const position: PlayerPosition = { ...ENTRANCE };
  let playerKey='';
  const markerGeometry = new THREE.RingGeometry(.7,.82,20);markerGeometry.rotateX(-Math.PI/2);ownedGeometry.add(markerGeometry);
  const nearMarker=new THREE.Mesh(markerGeometry,kit.material('#f0c060',true)),goalMarker=new THREE.Mesh(markerGeometry,kit.material('#89b7c2',true));
  nearMarker.visible=goalMarker.visible=false;group.add(nearMarker,goalMarker);
  const moveMark=(mark: Mesh,at?: Point | null): boolean=>{mark.visible=!!at;if(at)mark.position.set(at.x,.12,at.z);return true;};
  const decorations = new Map<string, Decorations>();
  const clearOfRoad=(x: number,z: number,margin: number): boolean=>ROADS.every(road=>road.points.slice(1).every(([bx,bz],i)=>{const [ax,az]=road.points[i]!,dx=bx-ax,dz=bz-az,t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz||1)));return Math.hypot(x-ax-dx*t,z-az-dz*t)>road.width/2+margin;}));
  // Props live on conservative blocked perimeter strips. They cannot obstruct a route.
  for (const zone of ZONES) {
    const [x0,z0,x1,z1] = zone.bounds;
    const items: Decorations = { tree: [], lamp: [], bench: [], car: [] };
    const grid = navigation.grids.get(zone.id);
    for (let i = 0; i < 28; i++) {
      const x = x0 + 10 + (i * 47 % Math.max(1,x1-x0-20)), z = z0 + 8 + (i * 61 % Math.max(1,z1-z0-16));
      if (grid?.free(x,z) && clearOfRoad(x,z,4) && !Object.values(ANCHORS).some(a=>Math.hypot(a.x-x,a.z-z)<10) && !BUILDINGS.some(b => Math.abs(x-b.x)<b.w/2+5 && Math.abs(z-b.z)<b.d/2+5)) {
        items.tree.push({x,y:0,z});
      }
    }
    // A small car park and benches use non-walkable building-side land.
    const first = BUILDINGS.find(b => b.zone===zone.id && !b.interior && b.kind !== 'gate' && b.kind !== 'open-space');
    if(first) {
      // These are parked on a visual forecourt, exported as additional obstacles below.
      for(let i=0;i<3;i++){const x=first.x-first.w/2+3+i*4,z=first.z+first.d/2+8;if(clearOfRoad(x,z,3))items.car.push({x,y:0,z});}
    }
    for (const p of zone.portals.slice(0,2)) {
      const x=p.at.x+5,z=p.at.z+5;
      if(x<x1-3&&z<z1-3&&grid?.free(x,z)) items.lamp.push({x,y:0,z});
    }
    if(zone.id==='lagoon') for(let i=0;i<5;i++) items.bench.push({x:326,y:0,z:-130+i*60,ry:Math.PI/2});
    decorations.set(zone.id,items);
  }
  // Install decoration footprints into the walk model before serving any path.
  // See createCampusWalk's optional extra footprints for exact geometry agreement.
  const extras: Record<string, Footprint[]> = Object.fromEntries([...decorations].map(([id,items]): [string, Footprint[]]=>[id,[
    ...items.tree.map((p): Footprint=>[p.x,p.z,.55]), ...items.lamp.map((p): Footprint=>[p.x,p.z,.3]),
    ...items.car.map((p): Footprint=>[p.x-1.3,p.z-2.3,p.x+1.3,p.z+2.3]),
    ...items.bench.map((p): Footprint=>[p.x-.7,p.z-1.7,p.x+.7,p.z+1.7]),
  ]]));
  const nav: CampusNavigation = createCampusWalk(extras);

  function buildZone(zone: CampusZone, detail: number): ResidentZone {
    const node = new THREE.Group(), batch: Batch = createBatch(THREE), windows: Instance[] = [], meshes: Mesh[] = [];
    node.name = `${zone.id}:lod${detail}`;
    for(const building of BUILDINGS.filter(b=>b.zone===zone.id)) drawBuilding(batch,styleOf(building),detail,windows);
    const built=batch.build(materials);
    meshes.push(...built.meshes); built.meshes.forEach(mesh=>node.add(mesh));
    if(detail===2) {
      for(const [name,items] of Object.entries(decorations.get(zone.id)!) as Array<[DecorKind, Instance[]]>) {
        const made=instances(kit,instanceGeometries[name],items);
        if(made){node.add(made);meshes.push(made);}
      }
      const made=instances(kit,instanceGeometries.window,windows);
      if(made){node.add(made);meshes.push(made);}
    }
    group.add(node); rebuilds++;
    return {node,detail,dispose(){
      for(const mesh of meshes){
        mesh.parent?.remove(mesh);
        if(!ownedGeometry.has(mesh.geometry)) mesh.geometry.dispose();
        if((mesh as Mesh & { isInstancedMesh?: boolean }).isInstancedMesh)(mesh as InstancedMesh).dispose();
      }
      node.removeFromParent();node.clear();
    }};
  }
  const terrain: Batch=createBatch(THREE);
  terrain.box(0,-.35,0,600,.6,480,'#90a578');
  terrain.box(320,-.25,0,40,.4,480,'#c3bd97');
  terrain.box(620,-.35,0,560,.4,1200,'#669ba4');
  // Third Mainland Bridge is distant background scenery, beyond walkable water.
  terrain.box(580,6,-10,12,.7,1000,'#b4b6a8');
  for(let z=-480;z<500;z+=30)terrain.box(580,2.7,z,5,6,4,'#9ea69b');
  for(const road of ROADS) for(let i=1;i<road.points.length;i++) {
    const [ax,az]=road.points[i-1]!,[bx,bz]=road.points[i]!,length=Math.hypot(bx-ax,bz-az);
    const ry=Math.atan2(bx-ax,bz-az);
    terrain.box((ax+bx)/2,.025,(az+bz)/2,road.width+3,.06,length,'#d2cbb0',{ry});
    terrain.box((ax+bx)/2,.065,(az+bz)/2,road.width,.04,length,'#81867d',{ry});
    for(let j=3;j<length;j+=9) {
      const t=j/length;terrain.box(ax+(bx-ax)*t,.095,az+(bz-az)*t,.22,.025,3,'#e8dfbc',{ry});
    }
  }
  const terrainMeshes: Mesh[]=terrain.build(materials).meshes;terrainMeshes.forEach(m=>group.add(m));

  function syncCrowd(): void {
    if(crowdMesh){crowdMesh.removeFromParent();crowdMesh.dispose();crowdMesh=null;}
    const visible=crowd.filter(p=>resident.get(nav.zoneAt(p.x,p.z)?.id ?? '')?.detail===2).slice(0,CAMPUS_BUDGET.crowd);
    crowdMesh=instances(kit,instanceGeometries.person,visible.map(p=>({...p,y:0})));
    if(crowdMesh)group.add(crowdMesh);
  }
  function setPosition(x: number,z: number): boolean {
    if(disposed||!Number.isFinite(x)||!Number.isFinite(z))return false;
    const zone=nav.zoneAt(x,z);
    if(!zone||!nav.grids.get(zone.id)!.free(x,z))return false;
    position.x=x;position.z=z;position.zone=zone.id;player.position.set(x,0,z);
    if(zone.id===current)return true;
    current=zone.id;
    const full=new Set([current,...zone.portals.map(p=>p.to)]);
    for(const item of ZONES){
      const detail=full.has(item.id)?2:0;
      if(resident.get(item.id)?.detail===detail)continue;
      resident.get(item.id)?.dispose();resident.set(item.id,buildZone(item,detail));
    }
    syncCrowd();return true;
  }
  const walk: AvatarWalk={
    entrance:[ENTRANCE.x,ENTRANCE.z,ENTRANCE.ry],open:true,avatar:player,raised:[],scale:.75,
    get centre(){return [position.x,.7,position.z];},
    get grid(): CampusGridView{return {
      bounds:[-300,-240,340,240],free:(x: number,z: number)=>{const zone=nav.zoneAt(x,z);return !!zone&&nav.grids.get(zone.id)!.free(x,z);},
      path:(ax: number,az: number,bx: number,bz: number)=>nav.route({x:ax,z:az},{x:bx,z:bz}),
      nearest:(x: number,z: number)=>{const zone=nav.zoneAt(x,z);return zone?nav.grids.get(zone.id)!.nearest(x,z):null;},
    };},
    solids:BUILDINGS.flatMap(b=>footprintOf(b).map(([x0,z0,x1,z1]): Solid=>[x0,0,z0,x1,b.h,z1])),
    move(x: number,y: number,z: number,ry: number){setPosition(x,z);player.rotation.y=ry;},
    drive(){},rest(){poseAvatar(player,{pose:'stand'});},
    gait(step: unknown,phase: number){poseAvatar(player,{pose:'walk',stride:phase/(Math.PI*2)});},
    pose(name: Pose){poseAvatar(player,{pose:name});},heightAt:()=>0,
    near:(at?: Point | null)=>moveMark(nearMarker,at),goal:(x?: number,z?: number)=>moveMark(goalMarker,finite(x)&&finite(z)?{x,z}:null),
    spots:()=>Object.entries(ANCHORS).map(([,a])=>({...a,approach:null,steps:[]})),people:()=>crowd.map(p=>({...p,kind:p.kind||'player',top:2.3})),
  };
  const scene: UnilagScene={group,kind:'unilag',mood:'outdoor',anchors:ANCHORS,walk,navigation:nav,
    camera:{landscape:[22,20,26],portrait:[26,30,34]},
    get background(){return time==='night'?'#182c3d':time==='dusk'?'#d8ad8d':'#bdd9df';},
    get time(){return time;},get zone(){return current;},get position(){return {...position};},
    update(state){const hour: number=lagosTime(state?.t??0).hour;return scene.setTime(venue.scene?.time||(hour<6||hour>=19?'night':hour>=17?'dusk':'day'));},
    setTime(value: string){if(!['day','dusk','night'].includes(value)||time===value)return false;time=value;return true;},
    lighting(){return {hemi:[scene.background,'#68765a',time==='night'?.9:2],sun:[time==='night'?'#96b5da':'#fff0d2',time==='night'?.65:2.4,[80,140,50]]};},
    setPosition,
    setSpot(id: string){const at=ANCHORS[id];return !!at&&setPosition(at.x,at.z);},
    setPlayer({look,seed='campus-visitor',pose='stand'}: PlayerInput={}){
      const key=JSON.stringify([look,seed]);
      if(look&&key!==playerKey){playerKey=key;player.userData.dispose();player=buildAvatar(kit,look,{detail:'low',rig:true,scale:.75,seed});group.add(player);player.position.set(position.x,0,position.z);walk.avatar=player;}
      poseAvatar(player,{pose});return true;
    },
    setCrowd(people){
      crowd=(Array.isArray(people)?people:[]).slice(0,CAMPUS_BUDGET.crowd).flatMap(p=>{
        const anchor=p.spot===undefined?undefined:ANCHORS[p.spot];
        const at=finite(p.x)&&finite(p.z)?{x:p.x,z:p.z}:anchor?walk.grid.nearest(anchor.x+3,anchor.z+3):null;
        return at&&walk.grid.free(at.x,at.z)?[{id:String(p.id),name:String(p.name??''),kind:p.kind==='npc'?'npc':'player',x:at.x,z:at.z}]:[];
      });syncCrowd();return scene.tags();
    },
    tags(){return BUILDINGS.filter(b=>resident.get(b.zone)?.detail===2).map(b=>({id:b.id,name:b.label,kind:'landmark',position:{x:b.x,y:3.9,z:b.z+b.d/2+.4}})).concat(crowd.map(p=>({...p,kind:p.kind||'player',position:{x:p.x,y:2.3,z:p.z}})));},
    stats(){return {...measureScene(group),zone:current,resident:[...resident].filter(([,v])=>v.detail===2).map(([id])=>id),rebuilds};},
    dispose(){if(disposed)return;disposed=true;registry.delete(scene.dispose);for(const part of resident.values())part.dispose();resident.clear();releaseObjects(terrainMeshes);player.userData.dispose();if(crowdMesh){crowdMesh.removeFromParent();crowdMesh.dispose();}for(const g of ownedGeometry)g.dispose();ownedGeometry.clear();group.removeFromParent();group.clear();},
  };
  const registry=kitResources(kit).disposers;registry.add(scene.dispose);
  setPosition(ENTRANCE.x,ENTRANCE.z);
  return scene;
}

export default buildUnilag;
