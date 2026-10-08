import { createHash } from 'node:crypto';
import { mkdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import type { SourceRecord, Bounds } from './types.ts';
import type { InventoryNode, WorldInventory } from './production-types.ts';
import { createOutputStore } from './storage.ts';

const MAX_UNITS = 10_000;
const MAX_COORDINATES = 2_000_000;

const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value as object).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}` : JSON.stringify(value);
const slug = (value: string): string => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown';
function obj(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function geometry(value: unknown): { type: 'Polygon'|'MultiPolygon'; coordinates: unknown } {
  const g = obj(value, 'geometry');
  if ((g.type !== 'Polygon' && g.type !== 'MultiPolygon') || !Array.isArray(g.coordinates)) throw new TypeError('source geometry must be Polygon or MultiPolygon');
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  if (!polygons.length) throw new TypeError('source geometry has no polygon parts');
  let count = 0;
  for (const polygon of polygons as unknown[][]) {
    if (!Array.isArray(polygon) || !polygon.length) throw new TypeError('polygon must retain its exterior ring and any holes');
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4) throw new TypeError('polygon ring must contain at least four positions');
      const first = ring[0] as unknown[], last = ring[ring.length - 1] as unknown[];
      for (const point of ring as unknown[][]) {
        if (++count > MAX_COORDINATES) throw new RangeError('inventory geometry coordinate budget exceeded');
        if (!Array.isArray(point) || point.length !== 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || (point[0] as number) < -180 || (point[0] as number) > 180 || (point[1] as number) < -90 || (point[1] as number) > 90) throw new TypeError('polygon coordinate is outside WGS84 bounds');
      }
      if (first[0] !== last[0] || first[1] !== last[1]) throw new TypeError('inventory polygon ring must be closed');
    }
  }
  return { type: g.type, coordinates: g.coordinates };
}
function bounds(g: {type:string;coordinates:unknown}): Bounds {
  const points: number[][] = [];
  const visit = (v: unknown): void => { if (Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number') points.push(v as number[]); else if (Array.isArray(v)) for (const x of v) visit(x); };
  visit(g.coordinates);
  const lons = points.map(p => p[0]!).sort((a,b)=>a-b);
  let south = 90, north = -90;
  for (const point of points) { south = Math.min(south, point[1]!); north = Math.max(north, point[1]!); }
  // Any polygon touching a pole spans every longitude, regardless of its ring's seam.
  if (south <= -89.999999 || north >= 89.999999) return [-180,south,180,north];
  // The complement of the largest longitude gap is the narrowest circular envelope.
  let gap = -1, after = 0;
  for (let i=0;i<lons.length;i++) { const next = i===lons.length-1 ? lons[0]!+360 : lons[i+1]!; if(next-lons[i]!>gap){gap=next-lons[i]!;after=(i+1)%lons.length;} }
  const west = lons[after]!; const east = lons[(after+lons.length-1)%lons.length]!;
  return [west, south, east, north];
}
function featureIdentity(p: Record<string, unknown>, f: Record<string, unknown>, index: number): {id:string; exceptions:string[]} {
  const usable=(value:unknown):value is string|number=>(typeof value==='string'||typeof value==='number')&&String(value).trim()!==''&&String(value)!=='-99';
  const raw=usable(p.NE_ID)?{kind:'NE_ID',value:p.NE_ID}:usable(p.ADM0_A3)?{kind:'ADM0_A3',value:p.ADM0_A3}:usable(f.id)?{kind:'feature-id',value:f.id}:null;
  if (!raw) throw new Error(`feature ${index} has no stable Natural Earth source feature identity`);
  const primary=`${raw.kind}:${raw.value}`;
  const exceptions: string[] = [];
  if(raw.kind!=='NE_ID')exceptions.push(`source identity uses ${raw.kind} because NE_ID is absent or ambiguous`);
  return { id: `${primary}`, exceptions };
}
function validCountryCode(value: unknown): string | null { return typeof value === 'string' && /^[A-Z]{2}$/.test(value) && value !== '-99' ? value : null; }
export function buildInventory(source: SourceRecord, geojson: unknown): WorldInventory {
  const fc = obj(geojson, 'GeoJSON');
  if (fc.type !== 'FeatureCollection' || !Array.isArray(fc.features) || fc.features.length < 1 || fc.features.length > MAX_UNITS) throw new TypeError('GeoJSON must be a bounded non-empty FeatureCollection');
  if (!source || typeof source.id!=='string'||!source.id||typeof source.url!=='string'||!source.url||typeof source.release!=='string'||!source.release||typeof source.license!=='string'||!source.license||typeof source.attribution!=='string'||!source.attribution||!/^[a-f0-9]{64}$/.test(source.sha256) || !Number.isSafeInteger(source.bytes) || source.bytes < 1) throw new TypeError('source must pin exact bytes and SHA-256 with attribution and license');
  const rootId = 'world:earth';
  const nodes: InventoryNode[] = [{id:rootId,parentId:null,name:'World',kind:'world',countryCode:null,bounds:null,sourceFeatureIds:[],provider:'world',outline:'missing',exceptions:[]}];
  const outlines: WorldInventory['outlines'] = [];
  const exceptions: string[] = [];
  const continents = new Map<string,string>();
  const featureIds = new Set<string>(), countryIds = new Set<string>();
  let nigeriaSeen = false;
  (fc.features as unknown[]).forEach((raw,index)=>{
    const f=obj(raw,`feature ${index}`), p=obj(f.properties,`feature ${index} properties`);
    const ident=featureIdentity(p,f,index); const featureId=`${source.id}:${ident.id}`;
    if(featureIds.has(featureId)) throw new Error(`duplicate source feature identity ${featureId}`); featureIds.add(featureId);
    const nameValue=p.ADMIN ?? p.NAME ?? p.NAME_EN;
    if(typeof nameValue!=='string'||!nameValue.trim()) throw new Error(`feature ${featureId} has no source country name`);
    const name=nameValue.trim(), continentValue=p.CONTINENT;
    const continent=typeof continentValue==='string'&&continentValue.trim()?continentValue.trim():null;
    const issue=[...ident.exceptions];
    let code=validCountryCode(p.ISO_A2_EH);
    if(!code) issue.push('source ISO_A2_EH country code is absent or ambiguous');
    if(!continent) issue.push('source continent category is absent');
    const geom=geometry(f.geometry);
    if(continent){
      let cid=continents.get(continent);
      if(!cid){cid=`continent:${slug(continent)}`;continents.set(continent,cid);nodes.push({id:cid,parentId:rootId,name:continent,kind:'continent',countryCode:null,bounds:null,sourceFeatureIds:[],provider:'world',outline:'missing',exceptions:[]});}
      const isNigeria=code==='NG'||name.toLowerCase()==='nigeria';
      // Game-facing hierarchy IDs survive a source release refresh. References retain the release.
      const countryId=isNigeria?'legacy-ng':`country:natural-earth:${encodeURIComponent(ident.id)}`;
      if(countryIds.has(countryId)) throw new Error(`duplicate country node identity ${countryId}`); countryIds.add(countryId);
      const node:InventoryNode={id:countryId,parentId:cid,name,kind:'country',countryCode:isNigeria?'NG':code,bounds:bounds(geom),sourceFeatureIds:[featureId],provider:isNigeria?'legacy-ng':'world',outline:isNigeria?'missing':'available',exceptions:isNigeria?[...issue,'protected legacy Nigeria provider; no world content generation']:issue};
      nodes.push(node);
      if(!isNigeria) outlines.push({nodeId:countryId,geometry:geom}); else {nigeriaSeen=true;exceptions.push('legacy-ng: protected legacy Nigeria provider; no world content generation');}
      if(issue.length) exceptions.push(`${countryId}: ${issue.join('; ')}`);
    } else {
      const id=`country:natural-earth:${encodeURIComponent(ident.id)}`;
      nodes.push({id,parentId:rootId,name,kind:'country',countryCode:code,bounds:bounds(geom),sourceFeatureIds:[featureId],provider:'world',outline:'available',exceptions:[...issue,'no continent parent could be formed']});
      outlines.push({nodeId:id,geometry:geom}); exceptions.push(`${id}: ${issue.join('; ')}`);
    }
  });
  if(!nigeriaSeen) {
    const africa=continents.get('Africa');
    const protectedException='protected legacy Nigeria provider; source unit not generated by this inventory';
    exceptions.push(`legacy-ng: ${protectedException}`);
    if(africa) nodes.push({id:'legacy-ng',parentId:africa,name:'Nigeria',kind:'country',countryCode:'NG',bounds:null,sourceFeatureIds:[],provider:'legacy-ng',outline:'missing',exceptions:[protectedException]});
    else nodes.push({id:'legacy-ng',parentId:rootId,name:'Nigeria',kind:'country',countryCode:'NG',bounds:null,sourceFeatureIds:[],provider:'legacy-ng',outline:'missing',exceptions:[protectedException,'Africa source continent unavailable']});
  }
  // Every source feature is assigned once, including source units that resolve only to a recorded exception.
  const assigned=nodes.flatMap(n=>n.sourceFeatureIds);
  if(assigned.length!==featureIds.size||new Set(assigned).size!==featureIds.size||assigned.some(id=>!featureIds.has(id))) throw new Error('source unit denominator does not match exactly assigned source features');
  const inventory:WorldInventory={schemaVersion:1,sources:[source],nodes, outlines, sourceUnitCount:featureIds.size, exceptions};
  return validateInventory(inventory);
}
export function validateInventory(value: unknown): WorldInventory {
  const v=obj(value,'inventory');
  if(v.schemaVersion!==1||!Array.isArray(v.sources)||v.sources.length<1||v.sources.length>10||!Array.isArray(v.nodes)||v.nodes.length>MAX_UNITS+100||!Array.isArray(v.outlines)||!Number.isSafeInteger(v.sourceUnitCount)||(v.sourceUnitCount as number)<1||(v.sourceUnitCount as number)>MAX_UNITS||!Array.isArray(v.exceptions)) throw new TypeError('inventory schema is invalid');
  const text = (s:unknown):s is string => typeof s==='string'&&s.length>0&&s.length<=2048&&!/[\u0000-\u001f]/.test(s);
  const texts = (s:unknown):s is string[] => Array.isArray(s)&&s.length<=MAX_UNITS&&s.every(text);
  if(!texts(v.exceptions))throw new TypeError('inventory exceptions invalid');
  const sourceIds = new Set<string>();
  for(const raw of v.sources){const s=obj(raw,'inventory source');if(!text(s.id)||sourceIds.has(s.id)||!text(s.url)||!text(s.release)||!text(s.license)||!text(s.attribution)||typeof s.sha256!=='string'||!/^[a-f0-9]{64}$/.test(s.sha256)||!Number.isSafeInteger(s.bytes)||(s.bytes as number)<1)throw new TypeError('inventory source invalid');sourceIds.add(s.id);}
  const nodes=v.nodes as InventoryNode[], ids=new Set<string>(), outlineIds=new Set<string>();
  for(const n of nodes){if(!n||!text(n.id)||!text(n.name)||ids.has(n.id)||!['world','continent','country'].includes(n.kind)||!['world','legacy-ng'].includes(n.provider)||!texts(n.sourceFeatureIds)||!texts(n.exceptions)||!['available','missing'].includes(n.outline)||(n.countryCode!==null&&!/^[A-Z]{2}$/.test(n.countryCode))||(n.parentId!==null&&!text(n.parentId))) throw new TypeError('inventory node is invalid or duplicated');ids.add(n.id);
    if(n.bounds!==null&&(!Array.isArray(n.bounds)||n.bounds.length!==4||n.bounds.some(x=>!Number.isFinite(x))||n.bounds[0]<-180||n.bounds[0]>180||n.bounds[2]<-180||n.bounds[2]>180||n.bounds[1]<-90||n.bounds[3]>90||n.bounds[1]>n.bounds[3]))throw new TypeError('inventory node bounds invalid');
    if(n.provider==='legacy-ng'&&(n.id!=='legacy-ng'||n.countryCode!=='NG'||n.kind!=='country'||n.outline!=='missing'))throw new TypeError('protected Nigeria provider invalid');
    if(n.countryCode==='NG'&&n.provider!=='legacy-ng')throw new TypeError('Nigeria must use protected legacy provider');
    if(n.sourceFeatureIds.some(ref=>![...sourceIds].some(s=>ref.startsWith(s+':'))))throw new TypeError('inventory source reference unresolved');
  }
  const roots=nodes.filter(n=>n.kind==='world'); if(roots.length!==1||roots[0]!.parentId!==null) throw new Error('inventory needs one world root');
  const byId = new Map(nodes.map(n=>[n.id,n]));
  for(const n of nodes){if(n.kind==='world')continue;const parent=n.parentId===null?undefined:byId.get(n.parentId);if(!parent)throw new Error(`inventory node parent is missing: ${n.id}`);if(parent.kind!=='world'&&!(parent.kind==='continent'&&n.kind==='country'))throw new Error(`inventory hierarchy is cyclic or has an invalid parent: ${n.id}`);}
  for(const o of v.outlines as WorldInventory['outlines']){if(!ids.has(o.nodeId)||outlineIds.has(o.nodeId))throw new Error(`orphan or duplicate outline: ${o.nodeId}`);geometry(o.geometry);outlineIds.add(o.nodeId);}
  const featureRefs=nodes.flatMap(n=>n.sourceFeatureIds); if(featureRefs.length!==v.sourceUnitCount||new Set(featureRefs).size!==featureRefs.length)throw new Error('inventory source denominator is incomplete or duplicated');
  for(const n of nodes) if(n.outline==='available'&&!outlineIds.has(n.id))throw new Error(`available outline missing: ${n.id}`);
  for(const n of nodes)if(n.outline==='missing'&&outlineIds.has(n.id))throw new Error(`missing or protected outline must not be generated: ${n.id}`);
  return value as WorldInventory;
}

/** Refuse existing symlink ancestors before creating even the first missing directory. */
export async function ensureInventoryDirectory(directory:string):Promise<void>{
  if(!path.isAbsolute(directory))throw new TypeError('inventory directory must be absolute');
  const resolved=path.resolve(directory),parts=resolved.slice(path.parse(resolved).root.length).split(path.sep).filter(Boolean);
  let cursor=path.parse(resolved).root;
  for(const part of parts){cursor=path.join(cursor,part);try{const info=await lstat(cursor);if(info.isSymbolicLink()||!info.isDirectory())throw new Error('inventory directory contains symlink or non-directory');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
  cursor=path.parse(resolved).root;
  for(const part of parts){cursor=path.join(cursor,part);try{await mkdir(cursor);}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}const info=await lstat(cursor);if(info.isSymbolicLink()||!info.isDirectory())throw new Error('inventory directory changed during creation');}
}

/** Publish lazy node indexes and independent outline assets; the content-addressed root manifest is written last. */
export async function publishInventory(inventoryValue: WorldInventory, outputRoot: string, allowedRoot: string): Promise<{manifestPath:string;manifestHash:string;bytes:number}> {
  const inventory=validateInventory(inventoryValue), out=path.resolve(outputRoot), allowed=path.resolve(allowedRoot);
  const rel=path.relative(allowed,out); if(!rel||rel==='..'||rel.startsWith(`..${path.sep}`)||path.isAbsolute(rel))throw new Error('inventory output must be inside allowed root');
  await ensureInventoryDirectory(allowed);
  const store=await createOutputStore(out,allowed);
  let totalOutput=0;
  const write=async(relative:string,body:string):Promise<number>=>{const bytes=Buffer.from(body);totalOutput+=bytes.length;if(totalOutput>100_000_000)throw new RangeError('inventory publication exceeds 100 MB budget');await store.writeImmutable(relative,bytes);return bytes.length;};
  let bytes=0;
  const outlinePaths=new Map<string,string>();
  for(const outline of inventory.outlines){const body=canonical(outline.geometry),hash=sha256(body),relative=`outlines/${hash}.json`;bytes+=await write(relative,body);outlinePaths.set(outline.nodeId,relative);}
  const byParent=new Map<string|null,InventoryNode[]>();for(const node of inventory.nodes){const list=byParent.get(node.parentId)??[];list.push(node);byParent.set(node.parentId,list);}
  const publishNode=async(node:InventoryNode):Promise<string>=>{const children=byParent.get(node.id)??[];const childRefs=[];for(const child of children)childRefs.push({id:child.id,path:await publishNode(child)});const body=canonical({node,outlinePath:outlinePaths.get(node.id)??null,children:childRefs});const hash=sha256(body),relative=`nodes/${hash}.json`;bytes+=await write(relative,body);return relative;};
  const root=inventory.nodes.find(n=>n.kind==='world')!;const rootNodePath=await publishNode(root);
  const rollups=(byParent.get(root.id)??[]).map(continent=>({id:continent.id,name:continent.name,countryCount:(byParent.get(continent.id)??[]).length,sourceUnitCount:(byParent.get(continent.id)??[]).reduce((sum,n)=>sum+n.sourceFeatureIds.length,0),exceptionCount:(byParent.get(continent.id)??[]).reduce((sum,n)=>sum+n.exceptions.length,0)}));
  const manifestBody=canonical({schemaVersion:inventory.schemaVersion,sources:inventory.sources,sourceUnitCount:inventory.sourceUnitCount,exceptions:inventory.exceptions,rollups,rootNodePath,outlineCount:outlinePaths.size}),manifestHash=sha256(manifestBody),manifestPath=`manifests/${manifestHash}.json`;
  bytes+=await write(manifestPath,manifestBody);
  return {manifestPath,manifestHash,bytes};
}
