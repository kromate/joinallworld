import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BufferGeometry, Group } from 'three';
import type { Kit } from '../../scene/kit.ts';
import { createBatch, sceneMaterials } from '../../scene/build.ts';
import { CAMPUS_MAP } from './map.generated.ts';
import { boundsOf } from './geo.ts';
import type { CampusMapBuilding, MetrePoint, MetreRing } from './geo.ts';
import { signLetters } from '../shared/signs.ts';
import { CAMPUS_TREES } from './landscape.ts';
import { instances, primitiveGeometry } from '../shared/geometry.ts';

/** OSM footprints are preserved; facade rhythm and untagged heights are interpretations. */
export function createMappedGeometry(kit: Kit) {
  const { THREE } = kit;
  const group = new THREE.Group();
  const materials = sceneMaterials(kit);
  const tileSize = 256;
  const tiles = new Map<string, CampusMapBuilding[]>();
  const resident = new Map<string, { group: Group; detail: boolean }>();
  let rebuilds = 0;
  const tile = (x: number, z: number) => `${Math.floor(x / tileSize)}:${Math.floor(z / tileSize)}`;
  for (const b of CAMPUS_MAP.buildings) {
    const [x0,z0,x1,z1] = boundsOf(b.ring), key = tile((x0+x1)/2,(z0+z1)/2);
    const list = tiles.get(key) ?? []; list.push(b); tiles.set(key,list);
  }
  const shapeOf = (ring: MetreRing) => new THREE.Shape(ring.map(([x,z]) => new THREE.Vector2(x,-z)));
  function polygon(ring: MetreRing, height: number, color: string): BufferGeometry {
    const geometry = height > 0
      ? new THREE.ExtrudeGeometry(shapeOf(ring), { depth: height, bevelEnabled: false, curveSegments: 1 })
      : new THREE.ShapeGeometry(shapeOf(ring));
    geometry.rotateX(-Math.PI/2);
    const c = new THREE.Color(color), colors = new Float32Array(geometry.attributes.position!.count*3);
    for(let i=0;i<colors.length;i+=3){colors[i]=c.r;colors[i+1]=c.g;colors[i+2]=c.b;}
    geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
    if(!geometry.index)return geometry;
    const expanded=geometry.toNonIndexed();geometry.dispose();return expanded;
  }
  function merged(geometries: BufferGeometry[], into: Group) {
    if(!geometries.length)return;
    const geometry=mergeGeometries(geometries,false);
    geometries.forEach(g=>g.dispose());
    if(!geometry)return;
    const mesh=new THREE.Mesh(geometry,materials.solid);mesh.castShadow=true;mesh.receiveShadow=true;into.add(mesh);
  }
  function clear(node: Group) {
    node.traverse(object=>{if(object instanceof THREE.Mesh)object.geometry.dispose();if(object instanceof THREE.InstancedMesh)object.dispose();});
    node.removeFromParent();node.clear();
  }
  function buildTile(key: string, buildings: CampusMapBuilding[], detail: boolean) {
    const node=new THREE.Group(), bodies: BufferGeometry[]=[], roofs: BufferGeometry[]=[];
    node.name=`mapped-campus:${key}:${detail?'near':'far'}`;
    const batch=createBatch(THREE);
    const parts=buildings.flatMap(b=>{
      if(b.osm.id!==653186158)return [b];
      // The long OSM outline includes the low podium. The southern tower is an
      // estimated massing split checked against the May 2025 overhead image.
      const ring:MetrePoint[]=[];
      const depth=([x,z]:MetrePoint)=>(x-1514)*-.382+(z+181)*-.924-24;
      for(let i=1;i<b.ring.length;i++){
        const a=b.ring[i-1]!,p=b.ring[i]!,da=depth(a),dp=depth(p);
        if(da<=0)ring.push(a);
        if((da<=0)!==(dp<=0)){const t=da/(da-dp);ring.push([a[0]+(p[0]-a[0])*t,a[1]+(p[1]-a[1])*t]);}
      }
      if(ring[0])ring.push(ring[0]);
      return [b,{...b,ring,height:43}];
    });
    for(const b of parts){
      const senate=b.osm.id===653186158&&b.height===43;
      const h=b.height;
      const color=senate?'#d6c8a8':b.osm.id%3===0?'#d8c9b0':b.osm.id%3===1?'#d8d2be':'#cab8a0';
      bodies.push(polygon(b.ring,h,color));
      const roof=polygon(b.ring,0,senate?'#c8bba0':b.osm.id%4===0?'#88584a':'#687271');roof.translate(0,h+.035,0);roofs.push(roof);
      if(!detail)continue;
      const [x0,z0,x1,z1]=boundsOf(b.ring),cx=(x0+x1)/2,cz=(z0+z1)/2;
      for(let i=1;i<b.ring.length;i++){
        const [ax,az]=b.ring[i-1]!,[bx,bz]=b.ring[i]!,dx=bx-ax,dz=bz-az,length=Math.hypot(dx,dz);
        if(length<3)continue;
        const ry=Math.atan2(-dz,dx),mx=(ax+bx)/2,mz=(az+bz)/2;
        const sign=(dz*(mx-cx)-dx*(mz-cz))>=0?1:-1,nx=sign*dz/length,nz=-sign*dx/length;
        const spacing=senate?3:4.4, floors=Math.min(12,Math.max(1,Math.floor(h/3.5)));
        for(let floor=0;floor<floors;floor++)for(let d=2;d<length-1.4;d+=spacing){
          const x=ax+dx*d/length,z=az+dz*d/length,y=2+floor*3.5;
          const lit=(floor+Math.floor(d/spacing)+b.osm.id)%5===0;
          batch.box(x+nx*.12,y,z+nz*.12,senate?1.9:2.1,1.6,.16,lit?'#c7b886':'#4d696e',{ry,layer:lit?'glow':'solid'});
          batch.box(x+nx*.44,y+1,z+nz*.44,senate?2.9:2.6,.18,.95,'#e0d6bd',{ry});
          if(senate){
            batch.box(x+nx*.6,y,z+nz*.6,.22,3.4,1.4,(floor+Math.floor(d/spacing))%4===0?'#934b3d':'#d9cbaa',{ry});
          }
        }
        for(let floor=1;floor<floors;floor++)batch.box(mx+nx*.2,floor*3.5+.25,mz+nz*.2,length,.22,.5,senate?'#9a4b3d':'#bdb49e',{ry});
      }
    }
    merged(bodies,node);merged(roofs,node);
    for(const mesh of batch.build(materials).meshes)node.add(mesh);
    group.add(node);resident.set(key,{group:node,detail});rebuilds++;
  }
  const land=new THREE.Group();land.name='UNILAG mapped ground';group.add(land);
  merged([polygon(CAMPUS_MAP.boundary,0,'#778b65')],land);
  for(const surface of CAMPUS_MAP.surfaces){
    const color=surface.kind==='pool'?'#469eb4':surface.kind==='water'?'#4a8187':surface.kind==='pitch'?'#5b8055':surface.kind==='sports'?'#84936c':'#526e55';
    const geometry=polygon(surface.ring,0,color);geometry.translate(0,surface.kind==='pitch'||surface.kind==='pool'?.035:.014,0);merged([geometry],land);
  }
  const treeGeometry=primitiveGeometry(kit,b=>{
    b.cyl(0,3,0,.32,6,'#786c50',{seg:7});
    b.ico(0,7.4,0,4.4,3.1,4.1,'#476a47');
    b.ico(-2.2,6.2,1.2,3.2,2.5,3.1,'#668258');
    b.ico(2.4,7.1,-.9,2.8,2.6,3,'#597a4e');
  });
  const trees=instances(kit,treeGeometry,CAMPUS_TREES.map(p=>({x:p.x,y:0,z:p.z,sx:p.size,sy:p.size,sz:p.size})));
  if(trees){trees.castShadow=true;trees.receiveShadow=true;land.add(trees);}
  const roads=createBatch(THREE);
  for(const surface of CAMPUS_MAP.surfaces.filter(s=>s.kind==='pitch')){
    const [x0,z0,x1,z1]=boundsOf(surface.ring),cx=(x0+x1)/2,cz=(z0+z1)/2;
    for(let i=1;i<surface.ring.length;i++){
      const a=surface.ring[i-1]!,b=surface.ring[i]!;
      const ax=cx+(a[0]-cx)*.94,az=cz+(a[1]-cz)*.94,bx=cx+(b[0]-cx)*.94,bz=cz+(b[1]-cz)*.94;
      roads.box((ax+bx)/2,.055,(az+bz)/2,.13,.02,Math.hypot(bx-ax,bz-az),'#e3dfc9',{ry:Math.atan2(bx-ax,bz-az)});
    }
  }
  for(const road of CAMPUS_MAP.roads)for(let i=1;i<road.points.length;i++){
    const [ax,az]=road.points[i-1]!,[bx,bz]=road.points[i]!,length=Math.hypot(bx-ax,bz-az);
    if(length<.05)continue;
    const ry=Math.atan2(bx-ax,bz-az),x=(ax+bx)/2,z=(az+bz)/2;
    const foot=['footway','path','pedestrian','steps'].includes(road.highway);
    roads.box(x,.025,z,road.width+1.8,.05,length+.3,'#c8c4b3',{ry});
    roads.box(x,.065,z,road.width,.06,length+.3,foot?'#b7ae95':'#565e5e',{ry});
    if(!foot&&road.width>=6)for(let d=2;d<length-2;d+=10)roads.box(ax+(bx-ax)*d/length,.102,az+(bz-az)*d/length,.13,.015,3,'#d9d5bc',{ry});
  }
  for(const mesh of roads.build(materials).meshes){mesh.receiveShadow=true;land.add(mesh);}

  // Gate silhouette follows Ei'eke's May 2025 photograph. Dimensions are estimated.
  const gate=createBatch(THREE);
  gate.at(0,0,0,-Math.PI/2,()=>{
    for(const x of [-16,0,16]){
      gate.box(x,3.4,0,x===0?5:1.4,6.8,3,'#d6bd86');
      gate.box(x,1.5,1.6,x===0?5:1.4,2.8,.2,'#87443f');
    }
    for(const side of [-1,1]){
      const cx=side*8;
      for(const z of [-2,2]){
        gate.box(cx,7,z,11,.22,.22,'#344143');
        gate.box(cx,6.2,z,11,.18,.18,'#344143');
        for(let k=0;k<6;k++)gate.box(side*2.5+side*k*2,6.6,z,2.15,.13,.13,'#344143',{rz:k%2?.4:-.4});
      }
      for(let k=0;k<7;k++)gate.box(cx-5+k*1.65,7,0,.13,.13,4,'#344143');
    }
    signLetters(gate,'UNIVERSITY OF LAGOS',0,4.7,1.7,5);
  });
  const gateGroup=new THREE.Group();gateGroup.name='Main gate photo interpretation';for(const mesh of gate.build(materials).meshes)gateGroup.add(mesh);group.add(gateGroup);
  for(const x of [-16,0,16]){
    const width=x===0?5:1.4;
    const vertices=x===0?[[-width/2,6.8],[-width/2,12.5],[0,9],[width/2,12.5],[width/2,6.8]]:[[-width/2,6.8],[-width/2,13],[width/2,10.8],[width/2,6.8]];
    const shape=new THREE.Shape(vertices.map(p=>new THREE.Vector2(p[0]!,p[1]!)));
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:3,bevelEnabled:false});geometry.translate(x,0,-1.5);geometry.rotateY(-Math.PI/2);
    const mesh=new THREE.Mesh(geometry,kit.material('#d6bd86'));mesh.castShadow=true;gateGroup.add(mesh);
  }
  function update(x:number,z:number){
    const tx=Math.floor(x/tileSize),tz=Math.floor(z/tileSize);
    for(const [key,buildings]of tiles){
      const [bx,bz]=key.split(':').map(Number),detail=Math.abs(bx!-tx)<=1&&Math.abs(bz!-tz)<=1;
      const previous=resident.get(key);if(previous?.detail===detail)continue;
      if(previous)clear(previous.group);buildTile(key,buildings,detail);
    }
  }
  return {group,update,get rebuilds(){return rebuilds;},get resident(){return [...resident].filter(([,value])=>value.detail).map(([key])=>key);},dispose(){for(const node of resident.values())clear(node.group);resident.clear();clear(land);clear(gateGroup);group.removeFromParent();}};
}
