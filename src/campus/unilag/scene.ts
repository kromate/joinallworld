import type { Group, Mesh } from 'three';
import type { Look } from '../../types/life.ts';
import type { Kit } from '../../scene/kit.ts';
import { kitResources } from '../../scene/build.ts';
import { buildAvatar, poseAvatar, normalizeLook } from '../../scene/characters.ts';
import type { Pose } from '../../scene/characters.ts';
import { lagosTime } from '../../game/clock.ts';
import { ANCHORS, ENTRANCE } from './layout.ts';
import type { CampusAnchor } from './layout.ts';
import { createCampusWalk } from './walk.ts';
import type { CampusWalk as NavigationApi, WalkCircle, WalkGrid, WalkPoint, WalkRect } from './walk.ts';
import { measureScene } from '../shared/geometry.ts';
import type { SceneMeasure } from '../shared/geometry.ts';
import { createMappedGeometry } from './mapped-geometry.ts';
import { CAMPUS_MAP } from './map.generated.ts';
import { boundsOf } from './geo.ts';

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
export interface CrowdPerson { id: string; name: string; kind: 'npc' | 'player'; x: number; z: number; look?: unknown }
/** What a caller may pass to setCrowd(): a position, or a landmark id to stand beside. */
/** A peer sent without `kind` is a player: the tag layer, the scene and the host's mini-map all read it so. */
export const crowdKindOf = (person: { kind?: string }): 'npc' | 'player' => (person.kind === 'npc' ? 'npc' : 'player');
export interface CrowdInput { id: string | number; name?: unknown; kind?: string; x?: number; z?: number; spot?: string; look?: unknown }
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
  gait(step: unknown, phase: number, jog?: boolean): void;
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

export const CAMPUS_BUDGET = Object.freeze({ triangles: 60000, drawCalls: 60, crowd: 12 });

export function buildUnilag(kit: Kit, venue: { scene?: { time?: string } } = {}): UnilagScene {
  const { THREE } = kit, group = new THREE.Group();
  group.name = 'UNILAG Akoka · mapped campus';
  const navigation = createCampusWalk();
  const mapped = createMappedGeometry(kit); group.add(mapped.group);
  let player = buildAvatar(kit, { body: 'woman', outfit: 'casual', outfitColor: 'gold', skin: 'skin-5' }, { detail: 'low', rig: true, scale: .60, seed: 'campus-visitor' });
  group.add(player);
  let time = venue.scene?.time || 'day', disposed = false, playerKey = '';
  let crowd: CrowdPerson[] = [];
  const peopleGroup = new THREE.Group(); peopleGroup.name='Campus stationary peers'; group.add(peopleGroup);
  const peopleCache = new Map<string, { key: string; body: ReturnType<typeof buildAvatar> }>();
  const position: PlayerPosition = { ...ENTRANCE };
  const grid: CampusGridView = {
    bounds: [...CAMPUS_MAP.bounds],
    free(x,z){const zone=navigation.zoneAt(x,z);return !!zone&&!!navigation.grids.get(zone.id)?.free(x,z);},
    path(ax,az,bx,bz){return navigation.route({x:ax,z:az},{x:bx,z:bz});},
    nearest(x,z){const zone=navigation.zoneAt(x,z);return zone?navigation.grids.get(zone.id)?.nearest(x,z)??null:null;},
  };
  const markerGeometry=new THREE.RingGeometry(.65,.82,28);markerGeometry.rotateX(-Math.PI/2);
  const nearMarker=new THREE.Mesh(markerGeometry,kit.material('#f0c060',true)),goalMarker=new THREE.Mesh(markerGeometry,kit.material('#89b7c2',true));
  nearMarker.visible=goalMarker.visible=false;group.add(nearMarker,goalMarker);
  const mark=(mesh:Mesh,at?:Point|null)=>{mesh.visible=!!at;if(at)mesh.position.set(at.x,.14,at.z);return true;};
  function setPosition(x:number,z:number):boolean {
    const zone=navigation.zoneAt(x,z);
    if(disposed||!zone||!grid.free(x,z))return false;
    position.x=x;position.z=z;position.zone=zone.id;player.position.set(x,0,z);mapped.update(x,z);return true;
  }
  function clearPeople(){for(const peer of peopleCache.values())peer.body.userData.dispose();peopleCache.clear();peopleGroup.clear();}
  const walk:AvatarWalk={
    entrance:[ENTRANCE.x,ENTRANCE.z,ENTRANCE.ry],open:true,avatar:player,raised:[],scale:.60,
    get centre(){return [position.x,1,position.z];},get grid(){return grid;},
    solids:CAMPUS_MAP.buildings.map(b=>{const [x0,z0,x1,z1]=boundsOf(b.ring);return [x0,0,z0,x1,b.osm.id===653186158?43:b.height,z1];}),
    move(x,y,z,ry){if(setPosition(x,z)){player.rotation.y=ry;position.ry=ry;}},drive(){},rest(){poseAvatar(player,{pose:'stand'});},
    gait(step,phase,jog=false){poseAvatar(player,{pose:jog?'jog':'walk',stride:phase/(Math.PI*2)});},pose(name){poseAvatar(player,{pose:name as Pose});},heightAt:()=>0,
    near:at=>mark(nearMarker,at),goal:(x,z)=>mark(goalMarker,Number.isFinite(x)&&Number.isFinite(z)?{x:x!,z:z!}:null),
    spots:()=>Object.values(ANCHORS).map(a=>({...a,approach:null,steps:[]})),people:()=>crowd.map(p=>({...p,top:2.3})),
  };
  const scene:UnilagScene={group,kind:'unilag',mood:'outdoor',anchors:ANCHORS,walk,navigation,
    camera:{landscape:[22,20,26],portrait:[26,30,34]},
    get background(){return time==='night'?'#132638':time==='dusk'?'#c9a792':'#b7ced6';},
    get time(){return time;},get zone(){return position.zone;},get position(){return {...position};},
    update(state){const hour=lagosTime(state?.t??0).hour;return scene.setTime(venue.scene?.time||(hour<6||hour>=19?'night':hour>=17?'dusk':'day'));},
    setTime(value){if(!['day','dusk','night'].includes(value)||value===time)return false;time=value;return true;},
    lighting(){return {hemi:[scene.background,'#677457',time==='night'?.8:1.6],sun:[time==='night'?'#96b5da':'#fff0d2',time==='night'?.65:2.4,[80,140,50]]};},
    setPosition,setSpot(id){const a=ANCHORS[id];return !!a&&setPosition(a.x,a.z);},
    setPlayer({look,seed='campus-visitor',pose='stand'}:PlayerInput={}){const key=JSON.stringify([look,seed]);if(look&&key!==playerKey){playerKey=key;player.userData.dispose();player=buildAvatar(kit,look,{detail:'low',rig:true,scale:.60,seed});group.add(player);player.position.set(position.x,0,position.z);walk.avatar=player;}poseAvatar(player,{pose});return true;},
    setCrowd(people){
      crowd=(people??[]).slice(0,CAMPUS_BUDGET.crowd).flatMap(p=>{const anchor=p.spot?ANCHORS[p.spot]:undefined;const at=typeof p.x==='number'&&typeof p.z==='number'?{x:p.x,z:p.z}:anchor?grid.nearest(anchor.x+2,anchor.z+2):null;return at&&grid.free(at.x,at.z)?[{id:String(p.id),name:String(p.name??''),kind:crowdKindOf(p),x:at.x,z:at.z,look:p.look}]:[];});
      const present=new Set(crowd.map(person=>person.id));
      for(const[id,peer]of peopleCache)if(!present.has(id)){peer.body.userData.dispose();peopleCache.delete(id);}
      for(const person of crowd){
        const look=normalizeLook(person.look,person.id),key=JSON.stringify(look);let peer=peopleCache.get(person.id);
        if(!peer||peer.key!==key){peer?.body.userData.dispose();const body=buildAvatar(kit,look,{detail:'low',rig:false,scale:.60,seed:person.id});peer={key,body};peopleCache.set(person.id,peer);peopleGroup.add(body);}
        peer.body.position.set(person.x,0,person.z);
      }
      return scene.tags();
    },
    tags(){return Object.entries(ANCHORS).filter(([,a])=>Math.hypot(a.x-position.x,a.z-position.z)<220).map(([id,a])=>({id,name:a.label,kind:'landmark',position:{x:a.x,y:3.5,z:a.z}})).concat(crowd.map(p=>({id:p.id,name:p.name,kind:p.kind,position:{x:p.x,y:2.3,z:p.z}})));},
    stats(){return {...measureScene(group),zone:position.zone,resident:mapped.resident,rebuilds:mapped.rebuilds};},
    dispose(){if(disposed)return;disposed=true;registry.delete(scene.dispose);mapped.dispose();clearPeople();player.userData.dispose();markerGeometry.dispose();group.removeFromParent();group.clear();},
  };
  const registry=kitResources(kit).disposers;registry.add(scene.dispose);
  const start=grid.nearest(ENTRANCE.x,ENTRANCE.z);if(start)setPosition(start.x,start.z);
  return scene;
}
export default buildUnilag;
