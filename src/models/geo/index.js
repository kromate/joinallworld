import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** @typedef {[number, number]} Coordinate Longitude, latitude in degrees. */
/** @typedef {{id:string,name:string,group?:string,disputed?:boolean,polygons:Coordinate[][][]}} GeoFeature */
/** @typedef {{id:string,name:string,features:GeoFeature[],cities?:City[],rivers?:{name:string,paths:Coordinate[][]}[],roads?:{name:string,points:Coordinate[],schematic:boolean}[],coastlines?:Coordinate[][],airports?:City[],source?:string,license?:string}} GeoData */
/** @typedef {{id:string,name:string,lon:number,lat:number,capitalOf?:string}} City */
/** @typedef {{west:number,east:number,south:number,north:number}} Bounds */
/** @typedef {{position:THREE.Vector3,target:THREE.Vector3,span:number}} CameraFrame */
/** @typedef {{width?:number,depth?:number,time?:'day'|'night',palette?:THREE.ColorRepresentation[],selected?:string,comingSoon?:string[],roads?:boolean,labels?:boolean}} GeoOptions */
/** @typedef {{object3D:THREE.Group,userData:Record<string,any>,data:GeoData,project:(lon:number,lat:number,target?:THREE.Vector3)=>THREE.Vector3,unproject:(x:number,z:number)=>{lon:number,lat:number},pick:(point:{lon:number,lat:number})=>string|null,highlight:(id:string,on?:boolean)=>boolean,hover:(id:string|null)=>void,frame:(id?:string)=>CameraFrame}} GeographyModel */

export const GEOGRAPHY_LEVELS = Object.freeze(['world', 'africa', 'nigeria', 'kenya']);
const COLORS = [0xc1cc8b, 0xe0c688, 0xacc9a8, 0xd4ad8c, 0x91bdb0, 0xd9c9a7, 0xb7b3c9];

/** Load one local data chunk. No remote API or tile requests occur. @param {string} level @returns {Promise<GeoData>} */
export async function loadGeography(level) {
  switch (level) {
    case 'world': return (await import('./data/world.js')).default;
    case 'africa': return (await import('./data/africa.js')).default;
    case 'nigeria': return (await import('./data/nigeria.js')).default;
    case 'kenya': return (await import('./data/kenya.js')).default;
    default: throw new RangeError(`Unknown geography: ${level}`);
  }
}

/** @param {Coordinate[]} ring @param {number} x @param {number} y */
function insideRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (((a[1] > y) !== (b[1] > y)) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** @param {GeoFeature} feature @param {number} lon @param {number} lat */
export function containsPoint(feature, lon, lat) {
  return feature.polygons.some(rings => insideRing(rings[0], lon, lat) && !rings.slice(1).some(hole => insideRing(hole, lon, lat)));
}

/** @param {GeoFeature[]} features @returns {Bounds} */
function boundsOf(features) {
  const bounds = { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity };
  for (const feature of features) for (const rings of feature.polygons) for (const ring of rings) for (const [lon, lat] of ring) {
    bounds.west = Math.min(bounds.west, lon); bounds.east = Math.max(bounds.east, lon);
    bounds.south = Math.min(bounds.south, lat); bounds.north = Math.max(bounds.north, lat);
  }
  return bounds;
}

/** @param {Coordinate[]} ring */
function ringArea(ring){let area=0;for(let i=1;i<ring.length;i++)area+=ring[i-1][0]*ring[i][1]-ring[i][0]*ring[i-1][1];return Math.abs(area)/2;}

/** Frame the main landmass rather than overseas islands or the opposite dateline edge. @param {GeoFeature} feature @returns {Bounds} */
function focusBounds(feature){let largest=feature.polygons[0],weight=-1;for(const polygon of feature.polygons){const b=boundsOf([{...feature,polygons:[polygon]}]),area=ringArea(polygon[0])*Math.cos((b.north+b.south)*Math.PI/360);if(area>weight){largest=polygon;weight=area;}}return boundsOf([{...feature,polygons:[largest]}]);}

/** Find an interior label anchor, including concave/multipart geometry. @param {GeoFeature} f @param {Bounds} b @returns {Coordinate} */
function interiorPoint(f, b) {
  const cx = (b.west + b.east) / 2, cy = (b.south + b.north) / 2;
  if (containsPoint(f, cx, cy)) return [cx, cy];
  for (const rings of f.polygons) {
    const contour = rings[0].slice(0, -1).map(p => new THREE.Vector2(...p));
    const holes = rings.slice(1).map(r => r.slice(0, -1).map(p => new THREE.Vector2(...p)));
    const points = [...contour, ...holes.flat()];
    const triangles = THREE.ShapeUtils.triangulateShape(contour, holes);
    let best = -1, result = null;
    for (const [a, c, d] of triangles) {
      const p = points[a], q = points[c], r = points[d];
      const area = Math.abs((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
      const x = (p.x + q.x + r.x) / 3, y = (p.y + q.y + r.y) / 3;
      if (area > best && containsPoint(f, x, y)) { best = area; result = [x, y]; }
    }
    if (result) return result;
  }
  return f.polygons[0][0][0];
}

/** Area centroid in the flat source projection, distinct from the interior label anchor. @param {GeoFeature} feature @returns {{lon:number,lat:number}} */
function centroidOf(feature){let weight=0,x=0,y=0;
  for(const rings of feature.polygons)for(let r=0;r<rings.length;r++){const ring=rings[r];let twiceArea=0,cx=0,cy=0;
    for(let i=1;i<ring.length;i++){const a=ring[i-1],b=ring[i],cross=a[0]*b[1]-b[0]*a[1];twiceArea+=cross;cx+=(a[0]+b[0])*cross;cy+=(a[1]+b[1])*cross;}
    if(Math.abs(twiceArea)<1e-12)continue;const w=Math.abs(twiceArea)*(r===0?1:-1);weight+=w;x+=cx/(3*twiceArea)*w;y+=cy/(3*twiceArea)*w;
  }
  if(!weight){const p=feature.polygons[0][0][0];return {lon:p[0],lat:p[1]};}return {lon:x/weight,lat:y/weight};
}

/** @param {THREE.Object3D} root @returns {{triangles:number,drawCalls:number}} */
export function measureGeography(root) {
  let triangles = 0, drawCalls = 0;
  root.traverse(node => {
    if (!(node.isMesh || node.isLine || node.isPoints) || !node.visible) return;
    if (node.isMesh) triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3 * (node.isInstancedMesh ? node.count : 1);
    drawCalls += node.geometry.groups.length && Array.isArray(node.material) ? node.geometry.groups.length : 1;
  });
  return { triangles, drawCalls };
}

/** Make a horizontal ribbon with square segment joins. @param {THREE.Vector3[]} points @param {number} width @returns {THREE.BufferGeometry} */
function ribbon(points, width) {
  const vertices = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], length = Math.hypot(b.x - a.x, b.z - a.z);
    if (!length) continue;
    const dx = (b.z - a.z) / length * width / 2, dz = -(b.x - a.x) / length * width / 2;
    vertices.push(a.x-dx,a.y,a.z-dz, b.x-dx,b.y,b.z-dz, a.x+dx,a.y,a.z+dz,
      a.x+dx,a.y,a.z+dz, b.x-dx,b.y,b.z-dz, b.x+dx,b.y,b.z+dz);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.computeVertexNormals();
  return geometry;
}

/**
 * Build any country or region from compact polygon data. IDs are stable source IDs.
 * A feature's bounds/centroid/label anchor are available in userData.features.
 * @param {GeoData} data @param {GeoOptions} [options] @returns {GeographyModel}
 */
export function buildGeography(data, options = {}) {
  if (!data?.features?.length) throw new TypeError('Geography requires at least one feature.');
  const ids = new Set();
  for (const f of data.features) {
    if (!f.id || ids.has(f.id) || !f.polygons?.length) throw new TypeError(`Invalid or duplicate feature: ${f.id}`);
    ids.add(f.id);
    for (const rings of f.polygons) for (const ring of rings) {
      if (ring.length < 4 || ring.some(p => p.length !== 2 || !p.every(Number.isFinite)) || ring[0][0]!==ring.at(-1)[0] || ring[0][1]!==ring.at(-1)[1] || new Set(ring.map(p=>p.join(','))).size<3 || ringArea(ring)<1e-12) throw new TypeError(`Invalid polygon: ${f.id}`);
    }
  }
  const root = new THREE.Group(); root.name = `geography:${data.id}`;
  const bounds = boundsOf(data.features), width = options.width ?? 24;
  if (!(width > 0 && Number.isFinite(width))) throw new RangeError('Map width must be positive.');
  const centerLon = (bounds.west + bounds.east) / 2, centerLat = (bounds.south + bounds.north) / 2;
  const scale = width / Math.max(bounds.east - bounds.west, bounds.north - bounds.south, .001);
  const depth = options.depth ?? .18, night = options.time === 'night';
  if(!(depth>0&&Number.isFinite(depth)))throw new RangeError('Map depth must be positive and finite.');
  const project = (lon, lat, target = new THREE.Vector3()) => target.set((lon-centerLon)*scale, depth, (centerLat-lat)*scale);
  const unproject = (x, z) => ({ lon: x/scale+centerLon, lat: centerLat-z/scale });
  const materials = [], geometries = [], disposables = [];
  const addMesh = (geometry, material, name) => { const mesh = new THREE.Mesh(geometry, material); mesh.name = name; root.add(mesh); geometries.push(geometry); materials.push(material); return mesh; };
  const oceanGeometry = new THREE.PlaneGeometry((bounds.east-bounds.west)*scale+2, (bounds.north-bounds.south)*scale+2);
  oceanGeometry.rotateX(-Math.PI/2); oceanGeometry.translate(0, -.04, 0);
  addMesh(oceanGeometry, new THREE.MeshBasicMaterial({color:night?0x122e48:0x7bbbc5}), 'ocean');
  const metadata = {}, pieces = [], borderVertices = [], borderKeys = new Set();
  const palette = options.palette?.length ? options.palette : COLORS;
  let vertexOffset = 0;
  for (let i = 0; i < data.features.length; i++) {
    const feature = data.features[i], tint = new THREE.Color(palette[i % palette.length]);
    if (night) tint.multiplyScalar(.58);
    const start = vertexOffset;
    for (const rings of feature.polygons) {
      const converted = rings.map(ring => ring.slice(0,-1).map(([lon,lat]) => new THREE.Vector2((lon-centerLon)*scale,(lat-centerLat)*scale)));
      const shape = new THREE.Shape(converted[0]);
      for (const hole of converted.slice(1)) shape.holes.push(new THREE.Path(hole));
      const geometry = new THREE.ExtrudeGeometry(shape, {depth,bevelEnabled:false,steps:1,curveSegments:1});
      geometry.rotateX(-Math.PI/2); geometry.clearGroups();
      const count = geometry.attributes.position.count, colors = new Float32Array(count*3), normal = geometry.attributes.normal;
      for (let v = 0; v < count; v++) { const shade = normal.getY(v) > .5 ? 1 : .74; colors[v*3]=tint.r*shade;colors[v*3+1]=tint.g*shade;colors[v*3+2]=tint.b*shade; }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors,3)); pieces.push(geometry); vertexOffset += count;
      for (const ring of rings) for (let j=1;j<ring.length;j++) {
        const a = ring[j-1], b = ring[j], key = [a.join(','),b.join(',')].sort().join(':');
        if (borderKeys.has(key)) continue;
        borderKeys.add(key); const p=project(...a),q=project(...b);
        borderVertices.push(p.x,depth+.018,p.z,q.x,depth+.018,q.z);
      }
    }
    const featureBounds = boundsOf([feature]), coordinate = interiorPoint(feature,featureBounds);
    metadata[feature.id] = {id:feature.id,name:feature.name,group:feature.group,disputed:!!feature.disputed,bounds:featureBounds,focusBounds:focusBounds(feature),
      centroid:centroidOf(feature),labelAnchor:project(...coordinate),range:{start,count:vertexOffset-start},selected:feature.id===options.selected,hover:false};
  }
  const landGeometry = mergeGeometries(pieces, false); for (const piece of pieces) piece.dispose();
  const land = addMesh(landGeometry, new THREE.MeshLambertMaterial({vertexColors:true}), 'land');
  const baseline = landGeometry.attributes.color.array.slice(), colors = landGeometry.attributes.color, selectedTint = new THREE.Color(0xe5a62d), hoverTint = new THREE.Color(0xf0d08d);
  const recolor = id => { const f=metadata[id];if(!f)return false; const tint=f.selected?selectedTint:f.hover?hoverTint:null;
    for(let v=f.range.start;v<f.range.start+f.range.count;v++){const offset=v*3;colors.array[offset]=tint?tint.r:baseline[offset];colors.array[offset+1]=tint?tint.g:baseline[offset+1];colors.array[offset+2]=tint?tint.b:baseline[offset+2];} colors.needsUpdate=true;return true; };
  const borderGeometry = new THREE.BufferGeometry();borderGeometry.setAttribute('position',new THREE.Float32BufferAttribute(borderVertices,3));
  const borderMaterial = new THREE.LineBasicMaterial({color:night?0xc9d5c1:0x5d7767});
  const borders = new THREE.LineSegments(borderGeometry,borderMaterial);borders.name='borders';root.add(borders);geometries.push(borderGeometry);materials.push(borderMaterial);
  const overlays = (name, paths, color, pathWidth, y) => {
    const chunks=paths.filter(path=>path.length>1).map(path=>ribbon(path.map(p=>project(...p).setY(y)),pathWidth));
    if(!chunks.length)return;const geometry=mergeGeometries(chunks,false);for(const c of chunks)c.dispose();addMesh(geometry,new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide}),name);
  };
  overlays('shore-band',data.coastlines||[],0xe8d4a3,width*.008,depth+.025);
  overlays('rivers',(data.rivers||[]).flatMap(r=>r.paths),night?0x459cc0:0x379bbc,width*.004,depth+.035);
  if(options.roads!==false){
    overlays('roads',(data.roads||[]).map(r=>r.points),0x676b64,width*.0032,depth+.045);
    const marks=[];
    for(const road of data.roads||[])for(let i=1;i<road.points.length;i++){
      const a=road.points[i-1],b=road.points[i];const n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])*scale/.3));
      for(let j=0;j<n;j++){const t=j/n,u=(j+.42)/n;marks.push([[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],[a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u]]);}
    }
    overlays('lane-markings',marks,0xf4e6bd,width*.00055,depth+.049);
  }
  const cityAnchors={};
  for(const [name,points,color,radius] of [['cities',data.cities||[],0x5d453a,.065],['airports',data.airports||[],0xf3d48b,.085]]){
    if(!points.length)continue;const geometry=new THREE.OctahedronGeometry(radius),material=new THREE.MeshBasicMaterial({color});
    const mesh=new THREE.InstancedMesh(geometry,material,points.length),matrix=new THREE.Matrix4();mesh.name=name;
    points.forEach((city,i)=>{const p=project(city.lon,city.lat);p.y+=.1;matrix.makeTranslation(p.x,p.y,p.z);mesh.setMatrixAt(i,matrix);cityAnchors[city.id]={...city,position:p};});
    root.add(mesh);geometries.push(geometry);materials.push(material);disposables.push(mesh);
  }
  // Clip original diagonal hatch lines against each selected coming-soon polygon.
  const hatchVertices=[];
  for(const id of options.comingSoon||[]){const f=data.features.find(v=>v.id===id);if(!f)continue;const b=metadata[id].bounds;
    const step=(b.east-b.west+b.north-b.south)/18;
    if(!(step>0))continue;
    for(let offset=b.south-b.east;offset<=b.north-b.west;offset+=step){const hits=[];
      for(const rings of f.polygons)for(const ring of rings)for(let i=1;i<ring.length;i++){const a=ring[i-1],c=ring[i],da=a[1]-a[0]-offset,dc=c[1]-c[0]-offset;if((da>0)===(dc>0))continue;const t=da/(da-dc);hits.push(a[0]+(c[0]-a[0])*t);}
      hits.sort((a,b)=>a-b);for(let i=1;i<hits.length;i+=2){const a=project(hits[i-1],hits[i-1]+offset),b=project(hits[i],hits[i]+offset);hatchVertices.push(a.x,depth+.022,a.z,b.x,depth+.022,b.z);}
    }
  }
  if(hatchVertices.length){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(hatchVertices,3));const m=new THREE.LineBasicMaterial({color:0x796955});const hatch=new THREE.LineSegments(g,m);hatch.name='coming-soon';root.add(hatch);geometries.push(g);materials.push(m);}
  let disposed=false,hovered=null;
  const dispose=()=>{if(disposed)return;disposed=true;for(const d of disposables)d.dispose();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();root.removeFromParent();};
  const frame=id=>{const city=id?.startsWith('city:')?cityAnchors[id.slice(5)]:null;const group=id?.startsWith('group:')?data.features.filter(f=>f.group===id.slice(6)):null;const b=group?.length?boundsOf(group):city?{west:city.lon-.18,east:city.lon+.18,south:city.lat-.18,north:city.lat+.18}:id?metadata[id]?.focusBounds:bounds;if(!b)throw new RangeError(`Unknown feature: ${id}`);const center=project((b.west+b.east)/2,(b.south+b.north)/2);const span=Math.max(b.east-b.west,b.north-b.south)*scale;return {target:center,position:new THREE.Vector3(center.x,Math.max(1.5,span*1.8),center.z+Math.max(1,span*.7)),span};};
  const userData={...measureGeography(root),dispose,features:metadata,bounds,anchors:{cities:cityAnchors,labels:Object.fromEntries(Object.values(metadata).map(f=>[f.id,f.labelAnchor]))},parts:{land,borders},source:data.source,license:data.license,schematicRoads:(data.roads||[]).some(r=>r.schematic)};
  root.userData=userData;
  for(const f of Object.values(metadata))if(f.selected)recolor(f.id);
  return {object3D:root,userData,data,project,unproject,pick:({lon,lat})=>data.features.find(f=>containsPoint(f,lon,lat))?.id??null,
    highlight:(id,on=true)=>{if(!metadata[id])return false;metadata[id].selected=on;return recolor(id);},
    hover:id=>{if(hovered&&metadata[hovered]){metadata[hovered].hover=false;recolor(hovered);}hovered=id;if(id&&metadata[id]){metadata[id].hover=true;recolor(id);}},frame};
}

/** @param {GeoData} data @param {GeoOptions} [options] */
export const buildCountry = (data,options) => buildGeography(data,options);

/** Extract one state/county as a data-only next level, preserving local city anchors. @param {GeoData} data @param {string} id @returns {GeoData} */
export function regionData(data,id){const feature=data.features.find(f=>f.id===id);if(!feature)throw new RangeError(`Unknown feature: ${id}`);return {...data,id:`${data.id}/${id}`,name:feature.name,features:[feature],cities:(data.cities||[]).filter(c=>containsPoint(feature,c.lon,c.lat)),airports:(data.airports||[]).filter(c=>containsPoint(feature,c.lon,c.lat)),roads:[],rivers:[],coastlines:[]};}

/** Mutate a supplied frame without allocations. The caller owns camera application. @param {CameraFrame} from @param {CameraFrame} to @param {number} progress @param {CameraFrame} out @returns {CameraFrame} */
export function transitionCamera(from,to,progress,out){const p=Math.max(0,Math.min(1,Number.isFinite(progress)?progress:0));if(p===0||p===1){const endpoint=p===0?from:to;out.position.copy(endpoint.position);out.target.copy(endpoint.target);out.span=endpoint.span;return out;}const t=p*p*(3-2*p);out.position.lerpVectors(from.position,to.position,t);out.target.lerpVectors(from.target,to.target,t);out.span=from.span+(to.span-from.span)*t;return out;}

/** @typedef {{object3D:THREE.Group,userData:Record<string,any>,pose:(progress:number)=>void}} RouteModel */
/**
 * Precompute a dashed route and a marker anchor. Attach a separately owned vehicle
 * to anchors.traveller; route disposal does not dispose the supplied vehicle.
 * @param {GeographyModel} map @param {Coordinate[]} points
 * @param {{mode?:'road'|'flight',color?:THREE.ColorRepresentation,height?:number}} [options]
 * @returns {RouteModel}
 */
export function buildRoute(map,points,options={}){
  if(points.length<2||points.some(p=>p.length!==2||!p.every(Number.isFinite)))throw new TypeError('Route requires at least two valid coordinates.');
  const root=new THREE.Group();root.name='travel-route';const source=[];
  for(const point of points){const projected=map.project(...point);if(!source.length||projected.distanceToSquared(source.at(-1))>1e-14)source.push(projected);}
  if(source.length<2)throw new RangeError('Route has zero length.');
  const lengths=[0];
  for(let i=1;i<source.length;i++)lengths.push(lengths[i-1]+source[i].distanceTo(source[i-1]));
  const length=lengths.at(-1);if(!length)throw new RangeError('Route has zero length.');
  const count=128,samples=new Float32Array((count+1)*3),lift=options.mode==='flight'?(options.height??length*.2):0;
  let segment=1;
  for(let i=0;i<=count;i++){const distance=length*i/count;while(segment<lengths.length-1&&lengths[segment]<distance)segment++;const a=source[segment-1],b=source[segment],t=(distance-lengths[segment-1])/(lengths[segment]-lengths[segment-1]);samples[i*3]=a.x+(b.x-a.x)*t;samples[i*3+1]=a.y+.13+Math.sin(Math.PI*i/count)*lift;samples[i*3+2]=a.z+(b.z-a.z)*t;}
  const vertices=[];for(let i=0;i<count;i+=2)vertices.push(...samples.slice(i*3,i*3+6));
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));const material=new THREE.LineBasicMaterial({color:options.color??0xe88530});
  root.add(new THREE.LineSegments(geometry,material));const traveller=new THREE.Group();traveller.name='traveller';root.add(traveller);
  let disposed=false;const userData={triangles:0,drawCalls:1,anchors:{traveller},length,dispose:()=>{if(disposed)return;disposed=true;geometry.dispose();material.dispose();root.removeFromParent();}};root.userData=userData;
  const pose=progress=>{const p=Math.max(0,Math.min(1,Number.isFinite(progress)?progress:0)),v=p*count,i=Math.min(count-1,Math.floor(v)),t=v-i,a=i*3,b=a+3;
    traveller.position.set(samples[a]+(samples[b]-samples[a])*t,samples[a+1]+(samples[b+1]-samples[a+1])*t,samples[a+2]+(samples[b+2]-samples[a+2])*t);
    traveller.rotation.set(0,Math.atan2(samples[b]-samples[a],samples[b+2]-samples[a+2]),0);geometry.setDrawRange(0,Math.floor(p*count/2)*2);};
  pose(0);return {object3D:root,userData,pose};
}
