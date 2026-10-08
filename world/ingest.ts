import type { Building, Bounds, Position, Region, Road, SourceRecord, WorldManifest, WorldTile } from './types.ts';
import { encodeTile } from './pack.ts';
import { validateManifest, validateTile } from './validate.ts';

const COMPILER = 'world-source-compiler-v1';
type Item = { kind: 'building'; value: Building; points: Position[] } | { kind: 'road'; value: Road; points: Position[] };
type Cell = { west: number; south: number; east: number; north: number; path: string; depth: number };
const obj = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new TypeError('GeoJSON value must be an object');
  return v as Record<string, unknown>;
};
const pos = (v: unknown): Position => {
  if (!Array.isArray(v) || v.length < 2 || typeof v[0] !== 'number' || typeof v[1] !== 'number' || !Number.isFinite(v[0]) || !Number.isFinite(v[1]) || v[0] < -180 || v[0] > 180 || v[1] < -90 || v[1] > 90) throw new TypeError('invalid WGS84 GeoJSON position');
  return [v[0], v[1]];
};
function line(raw: unknown): Position[] {
  if (!Array.isArray(raw) || raw.length > 200_000) throw new TypeError('line coordinates must be an array with at most 200000 positions');
  const points = raw.map(pos);
  if (points.length < 2 || points.every(p => p[0] === points[0]![0] && p[1] === points[0]![1])) throw new TypeError('line needs two distinct positions');
  return points;
}
function rings(raw: unknown): Position[][] {
  if (!Array.isArray(raw) || !raw.length) throw new TypeError('polygon needs rings');
  return raw.map((r) => {
    if (!Array.isArray(r) || r.length > 200) throw new TypeError('ring coordinates must be an array of at most 200 positions');
    return r.map(pos);
  });
}
function boundsOf(points: Position[], region: Region): { west: number; south: number; east: number; north: number } {
  const westRegion = region.bounds[0], eastRegion = region.bounds[2] < westRegion ? region.bounds[2] + 360 : region.bounds[2];
  const wrapped = region.bounds[2] < westRegion;
  let west=Infinity,south=Infinity,east=-Infinity,north=-Infinity;
  for(const p of points) {
    const lon=wrapped&&(westRegion>=0?p[0]<0:p[0]<westRegion)?p[0]+360:p[0];
    west=Math.min(west,lon);east=Math.max(east,lon);south=Math.min(south,p[1]);north=Math.max(north,p[1]);
  }
  return {west,south,east,north};
}
function overlaps(a: {west:number;south:number;east:number;north:number}, b: Cell): boolean {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}
function includes(a: {west:number;south:number;east:number;north:number}, b: Cell): boolean {
  return a.west >= b.west && a.east <= b.east && a.south >= b.south && a.north <= b.north;
}
function featureId(raw: unknown, index: number): string {
  if (typeof raw === 'string' || typeof raw === 'number') return String(raw);
  throw new TypeError(`feature ${index} needs a stable id`);
}
function numericHeight(properties: Record<string, unknown>): {value:number;kind:'source'|'estimated'} | null {
  const h = properties.height;
  if (typeof h === 'number' && Number.isFinite(h) && h > 0 && h <= 1000) return {value:h,kind:'source'};
  if (typeof h === 'string') {
    const parsed = Number(h.replace(/\s*m$/i, ''));
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 1000) return {value:parsed,kind:'source'};
  }
  const rendered = Number(properties.render_height);
  if (properties.render_height !== undefined && Number.isFinite(rendered) && rendered > 0 && rendered <= 1000) return {value:rendered,kind:'source'};
  const levels = Number(properties['building:levels']);
  if (properties['building:levels'] !== undefined && Number.isFinite(levels) && levels > 0 && levels <= 200) return {value:levels * 3,kind:'estimated'};
  return null;
}
function featureItems(value: unknown, source: SourceRecord, exceptions: string[]): Item[] {
  const root = obj(value);
  if (root.type !== 'FeatureCollection' || !Array.isArray(root.features)) throw new TypeError('input must be a GeoJSON FeatureCollection');
  if (root.features.length > 50_000) throw new RangeError('feature count exceeds compiler limit');
  if (root.metadata && typeof root.metadata === 'object' && !Array.isArray(root.metadata)) {
    const meta = root.metadata as Record<string,unknown>;
    if (Array.isArray(meta.exceptions)) for (const note of meta.exceptions) if (typeof note === 'string' && note.trim()) exceptions.push(note);
  }
  const items: Item[] = [];
  let vertices = 0;
  const addVertices = (count: number) => { vertices += count; if (vertices > 200_000) throw new RangeError('coordinate count exceeds compiler limit'); };
  root.features.forEach((v, index) => {
    const f = obj(v);
    if (f.type !== 'Feature') throw new TypeError(`feature ${index} is not a GeoJSON Feature`);
    const props = f.properties === null ? {} : obj(f.properties);
    const id = `${source.id}:${featureId(f.id, index)}`;
    const g = obj(f.geometry), type = g.type, c = g.coordinates;
    const building = props.building !== undefined && props.building !== null && props.building !== false && props.building !== 'no';
    const highway = props.highway;
    if (building && (type === 'Polygon' || type === 'MultiPolygon')) {
      const polygons = type === 'Polygon' ? [c] : c;
      if (!Array.isArray(polygons)) throw new TypeError(`${id} has invalid polygon coordinates`);
      polygons.forEach((poly, part) => {
        const rs = rings(poly), flat = rs.flat();
        addVertices(flat.length);
        if (!flat.length) throw new TypeError(`${id} is empty`);
        const height = numericHeight(props);
        const b: Building = { id: `${id}/building/${part}`, sourceId: source.id, rings: rs, heightM: height?.value ?? 6, heightKind: height?.kind ?? 'estimated' };
        items.push({ kind: 'building', value: b, points: flat });
      });
      return;
    }
    if (highway !== undefined && highway !== null && (type === 'LineString' || type === 'MultiLineString')) {
      const lines = type === 'LineString' ? [c] : c;
      if (!Array.isArray(lines)) throw new TypeError(`${id} has invalid line coordinates`);
      lines.forEach((part, i) => {
        const points = line(part);
        addVertices(points.length);
        const levelRaw = Number(props.layer ?? 0), level = Number.isInteger(levelRaw) ? levelRaw : 0;
        const road: Road = { id: `${id}/road/${i}`, sourceId: source.id, points, class: String(highway), level };
        items.push({ kind: 'road', value: road, points });
      });
      return;
    }
    exceptions.push(`unhandled source feature ${id}: ${String(type)}${building || highway !== undefined ? ' has unsupported geometry or tags' : ' has no supported building/highway tags'}`);
  });
  return items.sort((a,b) => a.value.id < b.value.id ? -1 : a.value.id > b.value.id ? 1 : 0);
}
function wrapLongitude(lon: number): number {
  if (lon >= -180 && lon <= 180) return lon;
  const wrapped = ((lon + 180) % 360 + 360) % 360 - 180;
  return wrapped;
}
function boundsToGeo(cell: {west:number;south:number;east:number;north:number}): Bounds {
  return [wrapLongitude(cell.west),cell.south,wrapLongitude(cell.east),cell.north];
}
function tile(region: Region, id: string, cell: Cell, items: Item[]): WorldTile {
  let west=cell.west,south=cell.south,east=cell.east,north=cell.north;
  for(const item of items) {
    const b=boundsOf(item.points,region);
    west=Math.min(west,b.west); south=Math.min(south,b.south); east=Math.max(east,b.east); north=Math.max(north,b.north);
  }
  const bounds=boundsToGeo({west,south,east,north});
  return { schemaVersion: 1, id, regionId: region.id, bounds,
    anchor: { longitude: wrapLongitude((west + east) / 2), latitude: (south + north) / 2, height: 0 },
    buildings: items.filter((x): x is Extract<Item,{kind:'building'}> => x.kind === 'building').map(x=>x.value),
    roads: items.filter((x): x is Extract<Item,{kind:'road'}> => x.kind === 'road').map(x=>x.value) };
}
function split(cell: Cell, axis: 0|1): [Cell, Cell] {
  if(axis===0) { const m=(cell.west+cell.east)/2; return [{...cell,east:m,path:`${cell.path}0`,depth:cell.depth+1},{...cell,west:m,path:`${cell.path}1`,depth:cell.depth+1}]; }
  const m=(cell.south+cell.north)/2; return [{...cell,north:m,path:`${cell.path}0`,depth:cell.depth+1},{...cell,south:m,path:`${cell.path}1`,depth:cell.depth+1}];
}
function emitChunks(region:Region,cell:Cell,items:Item[],tiles:WorldTile[],exceptions:string[]):void {
  let batch:Item[]=[],chunk=0;
  const flush=()=>{if(batch.length){tiles.push(tile(region,`${region.id}-${cell.path}-c${chunk++}`,cell,batch));batch=[];}};
  for(const item of [...items].sort((a,b)=>a.value.id<b.value.id?-1:a.value.id>b.value.id?1:0)) {
    const trial=[...batch,item];
    try {encodeTile(tile(region,`${region.id}-${cell.path}-chunk`,cell,trial));batch=trial;}
    catch(error) {
      if(!(error instanceof TypeError)||!/budget exceeded/.test(error.message)) throw error;
      flush();
      try {encodeTile(tile(region,`${region.id}-${cell.path}-chunk`,cell,[item]));batch=[item];}
      catch(singleError) {if(singleError instanceof TypeError&&/budget exceeded/.test(singleError.message)) exceptions.push(`oversized feature rejected by tile budget: ${item.value.id}`);else throw singleError;}
    }
  }
  flush();
}
function regionCell(region:Region):Cell {
  const [west,south,east,north]=region.bounds;
  return {west,south,east:east<west?east+360:east,north,path:'r',depth:0};
}
/** Compile a bounded GeoJSON extract. Whole intersecting features are assigned to one spatial cell; no clipping or line reconnection occurs. */
export function compileRegion(region: Region, source: SourceRecord, geojson: unknown): { manifest: WorldManifest; tiles: WorldTile[] } {
  if (region.countryCode === 'NG') throw new TypeError('Nigeria region compilation is explicitly excluded');
  if (!/^[a-f0-9]{64}$/.test(source.sha256) || !Number.isSafeInteger(source.bytes) || source.bytes <= 0) throw new TypeError('source must be pinned with SHA-256 and byte count');
  const exceptions = ['terrain unavailable: no elevation source was provided','climate unavailable: no monthly regional climate source was provided'];
  const items = featureItems(geojson, source, exceptions), rootCell=regionCell(region);
  // Validate all supported geometry before filtering; included features also remain whole across cells and bounds.
  for (const item of items) validateTile(tile(region, 'geometry-check', rootCell, [item]));
  const selected: Item[]=[];
  for (const item of items) {
    const b=boundsOf(item.points,region);
    if ((b.east-b.west)*(b.north-b.south)>25) throw new RangeError(`${item.value.id} geometry exceeds 25 square degrees`);
    if (overlaps(b,rootCell)) {
      selected.push(item);
      if (!includes(b,rootCell)) exceptions.push(`feature bounding box overlaps selected bounds and complete geometry is retained (conservative intersection): ${item.value.id}`);
    } else exceptions.push(`feature omitted because it does not intersect selected region bounds: ${item.value.id}`);
  }
  const pending: {cell:Cell;items:Item[]}[]=[{cell:rootCell,items:selected}];
  const tiles: WorldTile[]=[];
  let visited=0;
  while(pending.length) {
    if(++visited>100_000) throw new RangeError('spatial subdivision limit exceeded');
    const current=pending.pop()!;
    if(!current.items.length) continue;
    const candidate=tile(region,`${region.id}-${current.cell.path}`,current.cell,current.items);
    try { encodeTile(candidate); tiles.push(candidate); continue; }
    catch(error) { if(!(error instanceof TypeError)||!/budget exceeded/.test(error.message)) throw error; }
    if(current.items.length===1) { exceptions.push(`oversized feature rejected by tile budget: ${current.items[0]!.value.id}`); continue; }
    const axis:0|1=Math.abs(current.cell.east-current.cell.west)>=Math.abs(current.cell.north-current.cell.south)?0:1;
    const [a,b]=split(current.cell,axis), mid=axis===0?a.east:a.north;
    const left:Item[]=[],right:Item[]=[];
    for(const item of current.items) {
      const extent=boundsOf(item.points,region), rawCenter=axis===0?(extent.west+extent.east)/2:(extent.south+extent.north)/2;
      const low=axis===0?current.cell.west:current.cell.south, high=axis===0?current.cell.east:current.cell.north;
      const center=Math.max(low,Math.min(high,rawCenter));
      (center<mid?left:right).push(item);
    }
    const unchanged=(axis===0?(a.east===current.cell.east&&b.west===current.cell.west):(a.north===current.cell.north&&b.south===current.cell.south));
    if(current.cell.depth>=32||unchanged) {emitChunks(region,current.cell,current.items,tiles,exceptions);continue;}
    if(left.length) pending.push({cell:a,items:left});
    if(right.length) pending.push({cell:b,items:right});
    if(!left.length&&!right.length) emitChunks(region,current.cell,current.items,tiles,exceptions);
  }
  tiles.sort((a,b)=>a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const manifest=validateManifest({schemaVersion:1,compilerVersion:COMPILER,region,frame:'wgs84-enu-m-v1',verticalDatum:'WGS84-ellipsoid',coverage:'foundation',exceptions:[...new Set(exceptions)].sort(),sources:[source],tiles:tiles.map(t=>encodeTile(t).ref),climate:null});
  return {manifest,tiles};
}
