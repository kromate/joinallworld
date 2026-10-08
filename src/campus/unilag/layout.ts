/** Geographic UNILAG layout derived from the pinned OSM snapshot. */
import { landmarkLabel } from './spot-names.ts';
import { CAMPUS_MAP } from './map.generated.ts';
import { boundsOf, pointInRing } from './geo.ts';

export type Confidence = 'high' | 'medium' | 'low';
export interface Portal { id: string; to: string; at: { x: number; z: number }; peer: { x: number; z: number } }
export interface CampusZone { id: string; label: string; bounds: [number,number,number,number]; kind: 'campus'|'waterfront'; neighbours: string[]; portals: Portal[]; description: string }
export interface CampusBuilding { id:string; label:string; zone:string; x:number; z:number; w:number; d:number; h:number; kind:'faculty'|'hall'|'administration'|'academic'|'services'|'worship'|'gate'|'open-space'; color:string; interior:boolean; confidence:Confidence; source:string; osmId?:number }
export interface CampusAnchor { id:string; building:string; label:string; zone:string; x:number; y:number; z:number; ry:number; kind:'interior'|'approach'; landmark:string }
export interface CampusRoad { id:string; label:string; kind:'road'; width:number; points:Array<[number,number]>; source?:string; osmId?:number }

export const TILE_SIZE = 256;
/** Gameplay arrival just inside the mapped entrance; the OSM projection origin remains (0,0). */
export const MAIN_GATE_APPROACH=Object.freeze({x:5,z:8,ry:-Math.PI/2});
const [MIN_X,MIN_Z,MAX_X,MAX_Z]=CAMPUS_MAP.bounds;
const tileId=(column:number,row:number)=>`tile-${column}-${row}`;
const columns=Math.ceil((MAX_X-MIN_X)/TILE_SIZE), rows=Math.ceil((MAX_Z-MIN_Z)/TILE_SIZE);
const rawZones: CampusZone[]=[];
for(let row=0;row<rows;row++) for(let column=0;column<columns;column++) {
  const x0=MIN_X+column*TILE_SIZE,z0=MIN_Z+row*TILE_SIZE,x1=Math.min(MAX_X,x0+TILE_SIZE),z1=Math.min(MAX_Z,z0+TILE_SIZE);
  rawZones.push({id:tileId(column,row),label:`Campus ${column+1},${row+1}`,bounds:[x0,z0,x1,z1],kind:'campus',neighbours:[],portals:[],description:'A geographic streaming tile of the UNILAG Akoka campus.'});
}
const zoneIds=new Set(rawZones.map(z=>z.id));
for(const zone of rawZones){const parts=zone.id.split('-');const column=Number(parts[1]),row=Number(parts[2]);for(const [dc,dr] of [[-1,0],[1,0],[0,-1],[0,1]] as const){const id=tileId(column+dc,row+dr);if(zoneIds.has(id))zone.neighbours.push(id);}}
export const ZONES: CampusZone[]=rawZones;
export const zoneAtPoint=(x:number,z:number):CampusZone|null=>ZONES.find(zone=>x>=zone.bounds[0]&&x<zone.bounds[2]&&z>=zone.bounds[1]&&z<zone.bounds[3]&&pointInRing([x,z],CAMPUS_MAP.boundary))??null;

type LandmarkKind=CampusBuilding['kind'];
interface Mapping { osmType:'node'|'way'|'origin'; osmId:number; kind:LandmarkKind; color:string }
export const LANDMARK_MAPPINGS: Readonly<Record<string,Mapping>>={
  'main-gate':{osmType:'origin',osmId:9889685634,kind:'gate',color:'#8f2434'},
  'eni-njoku-hall':{osmType:'way',osmId:596634676,kind:'hall',color:'#ba6d43'},'makama-hall':{osmType:'way',osmId:596634675,kind:'hall',color:'#bd7c4e'},
  'access-bank':{osmType:'way',osmId:650873125,kind:'services',color:'#e36b32'},'arts':{osmType:'way',osmId:1424381710,kind:'faculty',color:'#b56b57'},
  'law':{osmType:'node',osmId:6122566946,kind:'faculty',color:'#9f6658'},'management':{osmType:'node',osmId:6122566947,kind:'faculty',color:'#ab7655'},
  'library':{osmType:'node',osmId:6122566943,kind:'academic',color:'#8f6b53'},'senate':{osmType:'way',osmId:653186158,kind:'administration',color:'#a16e4b'},
  'auditorium':{osmType:'way',osmId:707225648,kind:'academic',color:'#ad7957'},'uba-bank':{osmType:'node',osmId:6122566945,kind:'services',color:'#b5282f'},
  'environmental':{osmType:'node',osmId:6122566936,kind:'faculty',color:'#9d7854'},'education-chapel':{osmType:'way',osmId:650873126,kind:'worship',color:'#8e7b65'},
  'central-mosque':{osmType:'way',osmId:1286088886,kind:'worship',color:'#4f8862'},'wema-bank':{osmType:'node',osmId:10918408241,kind:'services',color:'#7550a3'},
  'education':{osmType:'node',osmId:6122566937,kind:'faculty',color:'#b98552'},'multipurpose-hall':{osmType:'way',osmId:370047009,kind:'academic',color:'#8c6b50'},
  'social-sciences':{osmType:'node',osmId:6122566933,kind:'faculty',color:'#a67554'},'queen-amina-hall':{osmType:'way',osmId:707240068,kind:'hall',color:'#b46f51'},
  'kofo-hall':{osmType:'node',osmId:6122566940,kind:'hall',color:'#bc7952'},'biobaku-hall':{osmType:'node',osmId:6122566938,kind:'hall',color:'#ae6748'},
  'amphitheatre':{osmType:'way',osmId:707208536,kind:'open-space',color:'#998267'},'university-bookshop':{osmType:'way',osmId:650883644,kind:'services',color:'#9a7656'},
  'swimming-pool':{osmType:'way',osmId:707208516,kind:'open-space',color:'#4d91a8'},'moremi-hall':{osmType:'node',osmId:6104938229,kind:'hall',color:'#bd7451'},
  'medical-centre':{osmType:'way',osmId:707234131,kind:'services',color:'#a67a5e'},'medical-gardens':{osmType:'node',osmId:10944364898,kind:'open-space',color:'#5d9764'},
  'jaja-hall':{osmType:'node',osmId:6121178177,kind:'hall',color:'#b76e49'},'engineering':{osmType:'node',osmId:6121119459,kind:'faculty',color:'#9c7656'},
  'mariere-hall':{osmType:'node',osmId:6121187825,kind:'hall',color:'#af694b'},
  'science':{osmType:'node',osmId:6121748261,kind:'faculty',color:'#9f7552'},'honours-hall':{osmType:'node',osmId:13111316590,kind:'hall',color:'#b5724f'},
  'dli-building':{osmType:'node',osmId:6122566932,kind:'academic',color:'#9f714c'},'lagoon-front':{osmType:'node',osmId:6121114159,kind:'open-space',color:'#4c9b8d'},
  'sports-centre':{osmType:'way',osmId:707208530,kind:'open-space',color:'#5d9660'},
};
export const UNMAPPED_LANDMARKS=Object.freeze(['el-kanemi-hall','sodeinde-hall','fagunwa-hall','tinubu-hall','cafeteria','new-hall-shopping','henry-carr-hall','student-union','pharmacy','second-gate'] as const);
const buildingByOsm=new Map(CAMPUS_MAP.buildings.map(b=>[b.osm.id,b]));
const surfaceByOsm=new Map(CAMPUS_MAP.surfaces.map(surface=>[surface.osm.id,surface]));
const poiByOsm=new Map(CAMPUS_MAP.pois.map(p=>[`${p.osm.type}:${p.osm.id}`,p]));
const derived:CampusBuilding[]=[];
const anchors:Record<string,CampusAnchor>={};
for(const [id,mapping] of Object.entries(LANDMARK_MAPPINGS)){
  const polygon=mapping.osmType==='way'?(buildingByOsm.get(mapping.osmId)??surfaceByOsm.get(mapping.osmId)):undefined;
  const poi=mapping.osmType==='origin'?{point:[MAIN_GATE_APPROACH.x,MAIN_GATE_APPROACH.z] as const}:poiByOsm.get(`${mapping.osmType}:${mapping.osmId}`);
  const bounds=polygon?boundsOf(polygon.ring):null;
  const openPoint=polygon&&mapping.kind==='open-space'?polygon.ring.reduce<[number,number]>(([x,z],point)=>[x+point[0]/polygon.ring.length,z+point[1]/polygon.ring.length],[0,0]):null;
  const x=openPoint?.[0]??(bounds?(bounds[0]+bounds[2])/2:poi?.point[0]), z=openPoint?.[1]??(bounds?bounds[3]+2:poi?.point[1]);
  if(x===undefined||z===undefined)continue;
  const zone=zoneAtPoint(x,z)??(bounds?zoneAtPoint((bounds[0]+bounds[2])/2,(bounds[1]+bounds[3])/2):null);if(!zone)continue;
  const w=bounds?bounds[2]-bounds[0]:0,d=bounds?bounds[3]-bounds[1]:0,h=polygon&&'height' in polygon?polygon.height:0;
  derived.push({id,label:landmarkLabel(id),zone:zone.id,x:bounds?(bounds[0]+bounds[2])/2:x,z:bounds?(bounds[1]+bounds[3])/2:z,w,d,h,kind:mapping.kind,color:mapping.color,interior:false,confidence:'high',source:id==='sports-centre'?'OpenStreetMap way 707208530; broad mapped sports grounds centroid':`OpenStreetMap ${mapping.osmType} ${mapping.osmId}`,osmId:mapping.osmId});
  anchors[id]={id:`${id}-anchor`,building:id,label:landmarkLabel(id),zone:zone.id,x,y:0,z,ry:mapping.osmType==='origin'?MAIN_GATE_APPROACH.ry:0,kind:'approach',landmark:id};
}
export const BUILDINGS:CampusBuilding[]=derived;
export const ANCHORS:Record<string,CampusAnchor>=anchors;
export const ROADS:CampusRoad[]=CAMPUS_MAP.roads.map(road=>({id:road.id,label:road.name??road.highway,kind:'road',width:road.width,points:road.points.map(([x,z])=>[x,z]),source:`OpenStreetMap way ${road.osm.id}`,osmId:road.osm.id}));
export const ENTRANCE=Object.freeze({x:MAIN_GATE_APPROACH.x,y:0,z:MAIN_GATE_APPROACH.z,ry:MAIN_GATE_APPROACH.ry,zone:zoneAtPoint(MAIN_GATE_APPROACH.x,MAIN_GATE_APPROACH.z)?.id??ZONES[0]!.id});
export const LAYOUT=Object.freeze({source:CAMPUS_MAP.source,origin:CAMPUS_MAP.origin,bounds:CAMPUS_MAP.bounds,boundary:CAMPUS_MAP.boundary,zones:ZONES,buildings:BUILDINGS,roads:ROADS,anchors:ANCHORS,unmapped:UNMAPPED_LANDMARKS});
