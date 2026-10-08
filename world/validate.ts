import type { Anchor, Bounds, Building, Position, Region, SourceRecord, TileRef, WorldManifest, WorldTile } from './types.ts';
import { WORLD_LIMITS } from './types.ts';

const object = (v: unknown, label: string): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new TypeError(`${label} must be an object`);
  return v as Record<string, unknown>;
};
const str = (v: unknown, label: string): string => {
  if (typeof v !== 'string' || !v.trim()) throw new TypeError(`${label} must be a non-empty string`);
  return v;
};
const num = (v: unknown, label: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`${label} must be finite`);
  return v;
};
const arr = (v: unknown, label: string): unknown[] => {
  if (!Array.isArray(v)) throw new TypeError(`${label} must be an array`);
  return v;
};
function bounds(v: unknown, label: string): Bounds {
  const a = arr(v, label).map((x, i) => num(x, `${label}[${i}]`));
  const west=a[0], south=a[1], east=a[2], north=a[3];
  if (a.length !== 4 || west === undefined || south === undefined || east === undefined || north === undefined || west < -180 || west > 180 || east < -180 || east > 180 || south < -90 || north > 90 || south >= north || west === east) throw new TypeError(`${label} is invalid`);
  return a as Bounds;
}
function position(v: unknown, label: string): Position {
  const a = arr(v, label);
  if (a.length !== 2) throw new TypeError(`${label} must be [longitude, latitude]`);
  const lon = num(a[0], `${label}[0]`), lat = num(a[1], `${label}[1]`);
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) throw new TypeError(`${label} is outside WGS84`);
  return [lon, lat];
}
interface Work { coordinates: number; operations: number }
const COORDINATE_LIMIT = 200_000;
const TOPOLOGY_WORK_LIMIT = 10_000_000;
function charge(work: Work, amount: number): void {
  work.operations += amount;
  if (work.operations > TOPOLOGY_WORK_LIMIT) throw new TypeError('geometry topology validation workload exceeds limit');
}
function unwrap(points: Position[], around?: number): Position[] {
  const first=points[0]!;
  let lon=first[0];
  if(around!==undefined) lon += 360*Math.round((around-lon)/360);
  const result:Position[]=[[lon,first[1]]];
  for(let i=1;i<points.length;i++) {
    const point=points[i]!; let next=point[0];
    while(next-lon>180) next-=360;
    while(next-lon< -180) next+=360;
    result.push([next,point[1]]); lon=next;
  }
  return result;
}
function ring(v: unknown, label: string, work: Work, around?: number): Position[] {
  const raw=arr(v,label);
  if(raw.length>1001) throw new TypeError(`${label} exceeds 1000 ring vertices`);
  work.coordinates+=raw.length;
  if(work.coordinates>COORDINATE_LIMIT) throw new TypeError('tile exceeds 200000 geometry coordinates');
  const canonical = raw.map((p, i) => position(p, `${label}[${i}]`));
  if(canonical.length<4) throw new TypeError(`${label} needs at least four positions`);
  if(canonical[0]![0]!==canonical.at(-1)![0]||canonical[0]![1]!==canonical.at(-1)![1]) throw new TypeError(`${label} must be closed`);
  const points = unwrap(canonical,around);
  points[points.length-1]=points[0]!;
  const first = points[0]!, last = points.at(-1)!;
  if (first[0] !== last[0] || first[1] !== last[1]) throw new TypeError(`${label} must be closed`);
  const unique = new Set(points.slice(0, -1).map(p => `${p[0]},${p[1]}`));
  if (unique.size < 3) throw new TypeError(`${label} is degenerate`);
  if(unique.size!==points.length-1) throw new TypeError(`${label} repeats a vertex and self-touches`);
  let area = 0;
  for (let i = 0; i < points.length - 1; i++) area += points[i]![0] * points[i + 1]![1] - points[i + 1]![0] * points[i]![1];
  if (Math.abs(area) < 1e-14) throw new TypeError(`${label} has zero area`);
  charge(work,(points.length-1)**2);
  for (let i = 0; i < points.length - 1; i++) for (let j = i + 1; j < points.length - 1; j++) {
    const adjacent=j===i+1||(i===0&&j===points.length-2);
    const a=points[i]!, b=points[i+1]!, c=points[j]!, d=points[j+1]!;
    if(adjacent) {
      const collinear=Math.abs(orient(a,b,c))<1e-12&&Math.abs(orient(a,b,d))<1e-12;
      if(collinear) {
        const shared=j===i+1?b:a;
        const other1=j===i+1?a:b, other2=j===i+1?d:c;
        const dot=(other1[0]-shared[0])*(other2[0]-shared[0])+(other1[1]-shared[1])*(other2[1]-shared[1]);
        if(dot>1e-12) throw new TypeError(`${label} has collinear overlap`);
      }
      continue;
    }
    if(segmentsIntersect(a,b,c,d)) throw new TypeError(`${label} self-intersects or self-touches`);
  }
  return canonical;
}
function orient(a: Position,b: Position,c: Position):number { return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]); }
function onSegment(a:Position,b:Position,p:Position):boolean {
  return Math.abs(orient(a,b,p))<1e-12 && p[0]>=Math.min(a[0],b[0])-1e-12&&p[0]<=Math.max(a[0],b[0])+1e-12&&p[1]>=Math.min(a[1],b[1])-1e-12&&p[1]<=Math.max(a[1],b[1])+1e-12;
}
function segmentsIntersect(a:Position,b:Position,c:Position,d:Position):boolean {
  if(Math.max(a[0],b[0])<Math.min(c[0],d[0])-1e-12||Math.max(c[0],d[0])<Math.min(a[0],b[0])-1e-12||Math.max(a[1],b[1])<Math.min(c[1],d[1])-1e-12||Math.max(c[1],d[1])<Math.min(a[1],b[1])-1e-12)return false;
  const abC=orient(a,b,c),abD=orient(a,b,d),cdA=orient(c,d,a),cdB=orient(c,d,b);
  return (abC*abD<0&&cdA*cdB<0)||onSegment(a,b,c)||onSegment(a,b,d)||onSegment(c,d,a)||onSegment(c,d,b);
}
function inside(point: Position, boundary: Position[]): boolean {
  let result = false;
  for (let i = 0, j = boundary.length - 2; i < boundary.length - 1; j = i++) {
    const a = boundary[i]!, b = boundary[j]!;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < ((b[0]-a[0]) * (point[1]-a[1])) / (b[1]-a[1]) + a[0]) result = !result;
  }
  return result;
}
function ringsCross(a: Position[], b: Position[], work:Work): boolean {
  charge(work,(a.length-1)*(b.length-1));
  for (let i=0;i<a.length-1;i++) for(let j=0;j<b.length-1;j++) {
    const p=a[i]!,q=a[i+1]!,r=b[j]!,s=b[j+1]!;
    if(segmentsIntersect(p,q,r,s)) return true;
  }
  return false;
}
function alignRing(r:Position[],around:number):Position[] { const points=unwrap(r,around); points[points.length-1]=points[0]!; return points; }
function longitudeInBounds(lon:number,b:Bounds):boolean { return b[0]!<b[2]!?lon>=b[0]!&&lon<=b[2]!:lon>=b[0]!||lon<=b[2]!; }
function positionInBounds(p:Position,b:Bounds):boolean { return longitudeInBounds(p[0],b)&&p[1]>=b[1]!&&p[1]<=b[3]!; }
function anchor(v: unknown): Anchor {
  const o=object(v,'anchor'), longitude=num(o.longitude,'anchor.longitude'), latitude=num(o.latitude,'anchor.latitude'), height=num(o.height,'anchor.height');
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) throw new TypeError('anchor is outside WGS84');
  return {longitude,latitude,height};
}
function unique(items: readonly {id:string}[], label:string): void {
  const seen=new Set<string>(); for(const item of items) { if(seen.has(item.id)) throw new TypeError(`duplicate ${label} id: ${item.id}`); seen.add(item.id); }
}

/** Strict, browser-safe validation. It imports no Node APIs. */
export function validateTile(value: unknown): WorldTile {
  const o=object(value,'tile');
  if(o.schemaVersion !== 1) throw new TypeError('unsupported tile schemaVersion');
  const tileBounds=bounds(o.bounds,'tile.bounds'),tileAnchor=anchor(o.anchor),work:Work={coordinates:0,operations:0};
  const buildings=arr(o.buildings,'tile.buildings').map((v,i)=>{
    const b=object(v,`buildings[${i}]`), rawRings=arr(b.rings,`buildings[${i}].rings`), rings:Position[][]=[];
    for(let j=0;j<rawRings.length;j++) {
      const around=j===0?undefined:unwrap(rings[0]!,rings[0]![0]![0])[0]![0];
      rings.push(ring(rawRings[j],`buildings[${i}].rings[${j}]`,work,around));
    }
    if(!rings.length) throw new TypeError('building needs an exterior ring');
    const outer=alignRing(rings[0]!,unwrap(rings[0]!)[0]![0]);
    for(let h=1;h<rings.length;h++) {
      const hole=alignRing(rings[h]!,outer[0]![0]);
      if(!inside(hole[0]!,outer)) throw new TypeError('building hole lies outside its exterior ring');
      if(ringsCross(hole,outer,work)) throw new TypeError('building hole crosses its exterior ring');
      for(let other=1;other<h;other++) { const previous=alignRing(rings[other]!,outer[0]![0]); if(ringsCross(hole,previous,work)||inside(hole[0]!,previous)||inside(previous[0]!,hole)) throw new TypeError('building holes overlap'); }
    }
    const heightM=num(b.heightM,'building.heightM'); if(heightM < 0 || heightM > 1000) throw new TypeError('building heightM is out of range');
    if(b.heightKind!=='source'&&b.heightKind!=='estimated') throw new TypeError('invalid heightKind');
    for(const r of rings) for(const p of r) if(!positionInBounds(p,tileBounds)) throw new TypeError('tile bounds do not contain building geometry');
    return {id:str(b.id,'building.id'),sourceId:str(b.sourceId,'building.sourceId'),rings,heightM,heightKind:b.heightKind as Building['heightKind']};
  });
  const roads=arr(o.roads,'tile.roads').map((v,i)=>{
    const r=object(v,`roads[${i}]`), rawPoints=arr(r.points,`roads[${i}].points`);
    if(rawPoints.length>1000) throw new TypeError('road exceeds 1000 points');
    work.coordinates+=rawPoints.length; if(work.coordinates>COORDINATE_LIMIT) throw new TypeError('tile exceeds 200000 geometry coordinates');
    const points=rawPoints.map((p,j)=>position(p,`roads[${i}].points[${j}]`));
    if(points.length<2 || points.every(p=>p[0]===points[0]![0]&&p[1]===points[0]![1])) throw new TypeError('road needs at least two distinct points');
    for(const p of points) if(!positionInBounds(p,tileBounds)) throw new TypeError('tile bounds do not contain road geometry');
    const level=num(r.level,'road.level'); if(!Number.isInteger(level)) throw new TypeError('road.level must be an integer');
    return {id:str(r.id,'road.id'),sourceId:str(r.sourceId,'road.sourceId'),points,class:str(r.class,'road.class'),level};
  });
  if(!positionInBounds([tileAnchor.longitude,tileAnchor.latitude],tileBounds)) throw new TypeError('tile bounds do not contain anchor');
  const tile:WorldTile={schemaVersion:1,id:str(o.id,'tile.id'),regionId:str(o.regionId,'tile.regionId'),bounds:tileBounds,anchor:tileAnchor,buildings,roads};
  unique(tile.buildings,'building'); unique(tile.roads,'road');
  return tile;
}
function source(v:unknown):SourceRecord {
  const o=object(v,'source'), bytes=num(o.bytes,'source.bytes');
  if(!Number.isSafeInteger(bytes)||bytes<=0) throw new TypeError('source.bytes must be a positive safe integer');
  const sha256=str(o.sha256,'source.sha256'); if(!/^[a-f0-9]{64}$/.test(sha256)) throw new TypeError('source.sha256 must be lowercase SHA-256');
  const url=str(o.url,'source.url');
  const localPilot=/^file:world\/pilots\/[A-Za-z0-9._/-]+$/.test(url)&&!url.includes('..');
  try { const parsed=new URL(url); if(!localPilot&&parsed.protocol!=='https:'&&parsed.protocol!=='http:') throw new Error(); } catch { throw new TypeError('source.url must be HTTP(S) or a local world/pilots provenance URI'); }
  return {id:str(o.id,'source.id'),url,release:str(o.release,'source.release'),license:str(o.license,'source.license'),attribution:str(o.attribution,'source.attribution'),sha256,bytes};
}
function region(v:unknown):Region {
  const o=object(v,'region');
  if(!['continent','country','admin','city','cell'].includes(String(o.kind))) throw new TypeError('invalid region.kind');
  const countryCode=o.countryCode===null?null:str(o.countryCode,'region.countryCode');
  if(countryCode!==null&&!/^[A-Z]{2}$/.test(countryCode)) throw new TypeError('region.countryCode must be ISO alpha-2');
  const timezone=o.timezone===null?null:str(o.timezone,'region.timezone');
  if(timezone!==null) { try { new Intl.DateTimeFormat('en',{timeZone:timezone}); } catch { throw new TypeError('invalid IANA timezone'); } }
  const parentId=o.parentId===null?null:str(o.parentId,'region.parentId');
  return {id:str(o.id,'region.id'),parentId,name:str(o.name,'region.name'),kind:o.kind as Region['kind'],countryCode,timezone,bounds:bounds(o.bounds,'region.bounds')};
}
function tileRef(v:unknown):TileRef {
  const o=object(v,'tile ref'), sha=str(o.sha256,'tile.sha256');
  if(!/^[a-f0-9]{64}$/.test(sha)) throw new TypeError('tile sha256 must be lowercase SHA-256');
  const path=str(o.path,'tile.path');
  if(path!==`tiles/${sha}.json` || path.startsWith('/') || path.includes('..') || path.includes('\\')) throw new TypeError('unsafe or non-content-addressed tile path');
  const int=(v:unknown,n:string,min=0)=>{const x=num(v,n);if(!Number.isSafeInteger(x)||x<min)throw new TypeError(`${n} must be a safe integer`);return x;};
  const bytes=int(o.bytes,'tile.bytes',1), brotliBytes=int(o.brotliBytes,'tile.brotliBytes',1), triangles=int(o.triangles,'tile.triangles'), drawCalls=int(o.drawCalls,'tile.drawCalls');
  if(bytes>10_000_000) throw new TypeError('tile ref raw bytes exceeds 10 MB');
  if(brotliBytes>WORLD_LIMITS.tileBrotliBytes||triangles>WORLD_LIMITS.tileTriangles||drawCalls>WORLD_LIMITS.visibleDrawCalls) throw new TypeError('tile ref exceeds a declared workload budget');
  return {id:str(o.id,'tile.id'),path,sha256:sha,bytes,brotliBytes,triangles,drawCalls,bounds:bounds(o.bounds,'tile.bounds')};
}
export function validateManifest(value: unknown): WorldManifest {
  const o=object(value,'manifest'); if(o.schemaVersion!==1) throw new TypeError('unsupported manifest schemaVersion');
  if(o.frame!=='wgs84-enu-m-v1'||o.verticalDatum!=='WGS84-ellipsoid') throw new TypeError('unsupported coordinate frame or vertical datum');
  if(o.coverage!=='foundation'&&o.coverage!=='explorable') throw new TypeError('invalid coverage');
  const sources=arr(o.sources,'sources').map(source), tiles=arr(o.tiles,'tiles').map(tileRef); unique(sources,'source'); unique(tiles,'tile');
  const climate=o.climate===null?null:(()=>{const c=object(o.climate,'climate'), months=arr(c.months,'climate.months'); if(months.length!==12)throw new TypeError('climate needs 12 monthly values'); const monthsOut=months.map((m,i)=>{const x=object(m,`climate.months[${i}]`), temperatureC=num(x.temperatureC,'temperatureC'), relativeHumidityPct=num(x.relativeHumidityPct,'relativeHumidityPct'), precipitationMm=num(x.precipitationMm,'precipitationMm'), windMps=num(x.windMps,'windMps'); if(relativeHumidityPct<0||relativeHumidityPct>100||precipitationMm<0||windMps<0)throw new TypeError('climate value out of range'); return {temperatureC,relativeHumidityPct,precipitationMm,windMps};}); return {sourceId:str(c.sourceId,'climate.sourceId'),period:str(c.period,'climate.period'),months:monthsOut};})();
  const sourceIds=new Set(sources.map(s=>s.id)); if(climate&&!sourceIds.has(climate.sourceId))throw new TypeError('climate sourceId does not resolve');
  const exceptions=arr(o.exceptions,'exceptions').map((x,i)=>str(x,`exceptions[${i}]`));
  const manifest:WorldManifest={schemaVersion:1,compilerVersion:str(o.compilerVersion,'compilerVersion'),region:region(o.region),frame:'wgs84-enu-m-v1',verticalDatum:'WGS84-ellipsoid',coverage:o.coverage,exceptions,sources,tiles,climate};
  if(new TextEncoder().encode(JSON.stringify(manifest)).byteLength>WORLD_LIMITS.bootstrapBrotliBytes*8) throw new TypeError('manifest is too large');
  return manifest;
}
