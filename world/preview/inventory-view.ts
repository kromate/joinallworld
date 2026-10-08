import type { InventoryNode } from '../production-types.ts';

export interface InventoryManifest {
  schemaVersion: 1; sources: Array<{id:string;url:string;release:string;license:string;attribution:string;sha256:string;bytes:number}>;
  sourceUnitCount: number; exceptions: string[];
  rollups: Array<{id:string;name:string;countryCount:number;sourceUnitCount:number;exceptionCount:number}>;
  rootNodePath: string; outlineCount: number;
}
export interface InventoryNodeIndex { node: InventoryNode; outlinePath: string|null; children: Array<{id:string;name?:string;path:string}> }
export interface InventoryGeometry { type:'Polygon'|'MultiPolygon'; coordinates: unknown }
export const INVENTORY_LIMITS=Object.freeze({manifestBytes:1_000_000,indexBytes:128_000,outlineBytes:512_000,cacheBytes:5_000_000,vertices:100_000});
const record=(value:unknown,label:string):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError(`${label} must be an object`);return value as Record<string,unknown>};
const hashPath=(value:unknown,folder:string):value is string=>typeof value==='string'&&new RegExp(`^${folder}/[a-f0-9]{64}\\.json$`).test(value);
function strictKeys(obj:Record<string,unknown>,allowed:string[],label:string){for(const key of Object.keys(obj))if(!allowed.includes(key))throw new TypeError(`unknown ${label} field ${key}`);}
function strings(value:unknown,label:string):string[]{if(!Array.isArray(value)||value.some(x=>typeof x!=='string'))throw new TypeError(`${label} must be an array of strings`);return value as string[];}
export function validateInventoryManifest(value:unknown):InventoryManifest {
 const m=record(value,'inventory manifest');strictKeys(m,['schemaVersion','sources','sourceUnitCount','exceptions','rollups','rootNodePath','outlineCount'],'manifest');
 if(m.schemaVersion!==1||!Number.isSafeInteger(m.sourceUnitCount)||Number(m.sourceUnitCount)<1||!Number.isSafeInteger(m.outlineCount)||Number(m.outlineCount)<0||!hashPath(m.rootNodePath,'nodes')||!Array.isArray(m.sources)||m.sources.length<1||!Array.isArray(m.rollups))throw new TypeError('inventory manifest schema is invalid');
 const sources=m.sources.map((item,i)=>{const s=record(item,`source ${i}`);strictKeys(s,['id','url','release','license','attribution','sha256','bytes'],'source');if(['id','url','release','license','attribution'].some(k=>typeof s[k]!=='string'||!s[k])||typeof s.sha256!=='string'||!/^[a-f0-9]{64}$/.test(s.sha256)||!Number.isSafeInteger(s.bytes)||Number(s.bytes)<1)throw new TypeError(`source ${i} is invalid`);return s as InventoryManifest['sources'][number];});
 const rollups=m.rollups.map((item,i)=>{const x=record(item,`rollup ${i}`);strictKeys(x,['id','name','countryCount','sourceUnitCount','exceptionCount'],'rollup');if(typeof x.id!=='string'||typeof x.name!=='string'||![x.countryCount,x.sourceUnitCount,x.exceptionCount].every(n=>Number.isSafeInteger(n)&&Number(n)>=0))throw new TypeError(`rollup ${i} is invalid`);return x as InventoryManifest['rollups'][number];});
 return {schemaVersion:1,sources,sourceUnitCount:Number(m.sourceUnitCount),exceptions:strings(m.exceptions,'exceptions'),rollups,rootNodePath:m.rootNodePath,outlineCount:Number(m.outlineCount)};
}
export function validateInventoryIndex(value:unknown,expectedId?:string,expectedParentId?:string|null):InventoryNodeIndex {
 const v=record(value,'node index');strictKeys(v,['node','outlinePath','children'],'node index');const n=record(v.node,'inventory node');strictKeys(n,['id','parentId','name','kind','countryCode','bounds','sourceFeatureIds','provider','outline','exceptions'],'node');
 if(typeof n.id!=='string'||!n.id||typeof n.name!=='string'||!n.name||!['world','continent','country'].includes(String(n.kind))||!(n.parentId===null||typeof n.parentId==='string')||!(n.countryCode===null||typeof n.countryCode==='string'&&/^[A-Z]{2}$/.test(n.countryCode))||!['world','legacy-ng'].includes(String(n.provider))||!['available','missing'].includes(String(n.outline))||expectedId!==undefined&&n.id!==expectedId||expectedParentId!==undefined&&n.parentId!==expectedParentId)throw new TypeError('inventory node fields are invalid');
 if(n.bounds!==null&&(!Array.isArray(n.bounds)||n.bounds.length!==4||!n.bounds.every(Number.isFinite)||Number(n.bounds[1])<-90||Number(n.bounds[3])>90||Number(n.bounds[0])<-180||Number(n.bounds[0])>180||Number(n.bounds[2])<-180||Number(n.bounds[2])>180||Number(n.bounds[1])>Number(n.bounds[3])))throw new TypeError('inventory bounds are invalid');
 const sourceFeatureIds=strings(n.sourceFeatureIds,'sourceFeatureIds');if(new Set(sourceFeatureIds).size!==sourceFeatureIds.length)throw new TypeError('inventory node repeats source feature IDs');strings(n.exceptions,'node exceptions');
 if(!(v.outlinePath===null||hashPath(v.outlinePath,'outlines'))||!Array.isArray(v.children))throw new TypeError('node outline or children are invalid');
 const children=v.children.map((item,i)=>{const c=record(item,`child ${i}`);strictKeys(c,['id','name','path'],'child');if(typeof c.id!=='string'||!hashPath(c.path,'nodes')||(c.name!==undefined&&(typeof c.name!=='string'||!c.name||c.name.length>2048)))throw new TypeError(`child ${i} is invalid`);return {id:c.id,...(typeof c.name==='string'?{name:c.name}:{}),path:c.path};});
 if(new Set(children.map(c=>c.id)).size!==children.length)throw new TypeError('node index repeats a child ID');
 if(n.kind==='country'&&children.length)throw new TypeError('country index cannot have children');
 if(n.kind!=='country'&&(n.outline!=='missing'||v.outlinePath!==null))throw new TypeError('world and continent nodes cannot carry country outlines');
 if(n.provider==='legacy-ng'&&(n.kind!=='country'||n.id!=='legacy-ng'||n.countryCode!=='NG'||n.outline!=='missing'))throw new TypeError('legacy Nigeria provider node is invalid');
 if(n.kind==='country'&&n.outline==='available'&&!v.outlinePath||n.kind==='country'&&n.outline==='missing'&&v.outlinePath)throw new TypeError('country outline availability does not match its asset');
 return {node:n as unknown as InventoryNode,outlinePath:v.outlinePath as string|null,children};
}
function validateRing(value:unknown,state:{vertices:number}):number[][] {
 if(!Array.isArray(value)||value.length<4)throw new TypeError('outline ring requires at least four points');
 const ring=value.map((raw)=>{if(!Array.isArray(raw)||raw.length<2||!Number.isFinite(raw[0])||!Number.isFinite(raw[1])||Number(raw[0]) < -180||Number(raw[0])>180||Number(raw[1]) < -90||Number(raw[1])>90)throw new TypeError('outline coordinate is outside WGS84 bounds');state.vertices++;if(state.vertices>INVENTORY_LIMITS.vertices)throw new RangeError('outline has too many vertices');return [Number(raw[0]),Number(raw[1])];});
 const first=ring[0]!,last=ring[ring.length-1]!;if(first[0]!==last[0]||first[1]!==last[1])throw new TypeError('outline ring is not closed');return ring;
}
export function validateInventoryGeometry(value:unknown):InventoryGeometry {
 const g=record(value,'outline');strictKeys(g,['type','coordinates'],'outline');if(g.type!=='Polygon'&&g.type!=='MultiPolygon')throw new TypeError('outline geometry type is unsupported');const state={vertices:0};
 const polygon=(value:unknown)=>{if(!Array.isArray(value)||!value.length)throw new TypeError('outline polygon is empty');return value.map(r=>validateRing(r,state));};
 const coordinates=g.type==='Polygon'?polygon(g.coordinates):(()=>{if(!Array.isArray(g.coordinates)||!g.coordinates.length)throw new TypeError('outline multipolygon is empty');return g.coordinates.map(polygon);})();
 return {type:g.type,coordinates};
}
export async function verifyInventoryBytes(bytes:Uint8Array,expectedHash:string,maxBytes:number,digest:(data:Uint8Array)=>Promise<string>):Promise<void>{
 if(!/^[a-f0-9]{64}$/.test(expectedHash))throw new TypeError('expected inventory SHA-256 is invalid');if(bytes.byteLength>maxBytes)throw new RangeError('inventory response exceeds its byte limit');if(await digest(bytes)!==expectedHash)throw new Error('inventory content hash mismatch');
}
/** Equirectangular SVG path. Unwraps longitude deltas and repeats shifted rings at the antimeridian. */
export function inventoryGeometryPath(value:InventoryGeometry,width=720,height=360,strokeOnly=false,adjacentCopies=false,decimalPlaces=2):string {
 if(!Number.isInteger(decimalPlaces)||decimalPlaces<2||decimalPlaces>6)throw new RangeError('map precision must be 2..6 decimal places');
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new RangeError('map size must be positive');
 const polygons=value.type==='Polygon'?[value.coordinates as number[][][]]:value.coordinates as number[][][][];const paths:string[]=[];
 const addRing=(ring:number[][])=>{const open=ring.slice(0,-1);if(open.length<3)return;const unwrapped:number[][]=[];for(let i=0;i<open.length;i++){const point=open[i]!;const lon=point[0]!,lat=point[1]!;let adjusted:number=lon;if(i){const prev=unwrapped[i-1]![0]!;while(adjusted-prev>180)adjusted-=360;while(adjusted-prev < -180)adjusted+=360;}unwrapped.push([adjusted,lat]);}const first=unwrapped[0]!,last=unwrapped.at(-1)!;const closeLon=first[0]!+Math.round((last[0]!-first[0]!)/360)*360;const wrapsMapSeam=Math.abs(closeLon-first[0]!)>180;const closed=[...unwrapped,[closeLon,first[1]!]];const min=Math.min(...closed.map(p=>p[0]!)),max=Math.max(...closed.map(p=>p[0]!));const firstShift=adjacentCopies?Math.min(-1,Math.ceil((-180-max)/360)):Math.ceil((-180-max)/360),lastShift=adjacentCopies?Math.max(1,Math.floor((180-min)/360)):Math.floor((180-min)/360);for(let shift=firstShift;shift<=lastShift;shift++){const stroke=strokeOnly&&wrapsMapSeam;const coordinates=stroke?unwrapped:closed;const commands=coordinates.map(([lon,lat],i)=>`${i?'L':'M'}${((lon!+shift*360+180)/360*width).toFixed(decimalPlaces)},${((90-lat!)/180*height).toFixed(decimalPlaces)}`).join(' ');paths.push(stroke?commands:`${commands} Z`);}};
 for(const polygon of polygons)for(const ring of polygon)addRing(ring);
 return paths.join(' ');
}
export async function fetchInventoryAsset<T>(url:string,hash:string,limit:number,signal:AbortSignal,validate:(parsed:unknown)=>T,fetcher:typeof fetch=fetch):Promise<{value:T;bytes:number}> {
 const response=await fetcher(url,{signal});if(!response.ok)throw new Error(`Inventory request failed (${response.status}).`);const advertised=Number(response.headers.get('content-length'));if(Number.isFinite(advertised)&&advertised>limit)throw new RangeError('Inventory response exceeds its byte limit');if(!response.body)throw new Error('Inventory response has no readable body');const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new RangeError('Inventory response exceeds its byte limit');}chunks.push(value);}}finally{reader.releaseLock();}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}await verifyInventoryBytes(bytes,hash,limit,async data=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',data.slice().buffer as ArrayBuffer))].map(b=>b.toString(16).padStart(2,'0')).join(''));return {value:validate(JSON.parse(new TextDecoder().decode(bytes))),bytes:size};
}
