import * as THREE from 'three';
import type { WardrobeRestFrame } from '../../../../../src/scene/wardrobe/geometry.ts';
import { clipSourceTriangle, type ClipCorner, type ClipPlane, type Influence } from '../shoulder-yoke-v1/clip-source-triangle.ts';

/** Evidence-only source-conformal office top. No support-bone threshold is used. */
export type ExpandedOfficeShellOptions = Readonly<{ hemY: number; neckTopY: number; radialEase?: number }>;
export type ExpandedOfficeShellResult = Readonly<{ geometry: THREE.BufferGeometry; triangles: number; bytes: number; sourceFaceIds: readonly number[]; sourceBindings: readonly Readonly<{ vertices: readonly [number,number,number]; barycentric: readonly [number,number,number] }>[]; openBoundaryEdges: number; item: 'office-expanded-shell' }>;
function edgeKey(a:number,b:number){return a<b?`${a}:${b}`:`${b}:${a}`;}
function normalizedInfluences(entries:readonly Influence[]):Influence[]{const combined=new Map<number,number>();for(const [id,w]of entries)if(w>0)combined.set(id,(combined.get(id)??0)+w);const total=[...combined.values()].reduce((s,w)=>s+w,0);if(!(total>0&&Number.isFinite(total)))throw new Error('Source shell vertex has invalid skin weights');return[...combined].filter(([,w])=>w>1e-8).map(([id,w])=>[id,w/total] as const);}
function cornerKey(c:ClipCorner){const influence=normalizedInfluences(c.influences).map(([bone,w])=>`${bone}@${Math.round(w*1e6)}`).join('|');return`${c.position.map(v=>Math.round(v*1e6)).join(',')}#${influence}`;}
/**
 * Retains the connected authored body chart between geographic hem/neck/wrist
 * cuts, then applies one positive-determinant x/z ease transform. Unlike the
 * rejected v1 per-vertex normal offset, this affine map cannot reverse a rest
 * triangle. It is only a candidate; skinning may still fold it in motion.
 */
export function buildExpandedOfficeShell(base:THREE.SkinnedMesh,rest:WardrobeRestFrame,options:ExpandedOfficeShellOptions):ExpandedOfficeShellResult{
  const {hemY,neckTopY}=options,ease=options.radialEase??0.035;
  if(!(Number.isFinite(hemY)&&Number.isFinite(neckTopY)&&neckTopY>hemY&&Number.isFinite(ease)&&ease>=0&&ease<=0.08))throw new Error('Invalid expanded-shell bounds');
  const g=base.geometry,index=g.index,pos=g.getAttribute('position'),norm=g.getAttribute('normal'),si=g.getAttribute('skinIndex'),sw=g.getAttribute('skinWeight'),uv=g.getAttribute('uv');
  if(!index||!pos||!norm||!si||!sw||index.count%3!==0)throw new Error('Source body lacks indexed skinned attributes');
  const names=base.skeleton.bones.map(b=>b.name);for(const required of ['pelvis','upperarm_l','upperarm_r','hand_l','hand_r'])if(!names.includes(required))throw new Error(`Source rig lacks ${required}`);
  const hip=rest.bones.get('pelvis')?.point;if(!hip)throw new Error('Source rig lacks pelvis rest point');
  const toMetres=new THREE.Matrix4().copy(rest.meshFromMetres),normalTransform=new THREE.Matrix3().setFromMatrix4(toMetres).transpose();
  const pointAt=(i:number)=>rest.points[i]!.clone(),normalAt=(i:number)=>new THREE.Vector3(norm.getX(i),norm.getY(i),norm.getZ(i)).applyMatrix3(normalTransform).normalize();
  const vertexInfluences=(i:number):Influence[]=>Array.from({length:4},(_,c)=>[si.getComponent(i,c),sw.getComponent(i,c)] as const).filter(([,w])=>w>0);
  const cuffs:ClipPlane[]=[];for(const side of ['l','r'] as const){const shoulder=rest.bones.get(`upperarm_${side}`)?.point,hand=rest.bones.get(`hand_${side}`)?.point;if(!shoulder||!hand)throw new Error(`Missing ${side} arm rest anchors`);const axis=hand.clone().sub(shoulder).normalize(),limit=hand.clone().sub(shoulder).dot(axis)+0.012;cuffs.push({normal:axis.toArray() as [number,number,number],offset:-limit-shoulder.dot(axis),keep:'negative'});}
  const planes:ClipPlane[]=[{normal:[0,1,0],offset:-hemY,keep:'positive'},{normal:[0,1,0],offset:-neckTopY,keep:'negative'},...cuffs];
  const vertices:number[]=[],colors:number[]=[],uvs:number[]=[],cloth:number[]=[],indices:number[]=[],weights:number[]=[],bones:number[]=[],sourceFaceIds:number[]=[],sourceBindings:{vertices:readonly[number,number,number];barycentric:readonly[number,number,number]}[]=[],cache=new Map<string,number>();
  const emit=(sourceIds:readonly[number,number,number],corner:ClipCorner):number=>{const key=cornerKey(corner),cached=cache.get(key);if(cached!==undefined)return cached;const id=vertices.length/3,p=new THREE.Vector3(...corner.position);p.x=hip.x+(p.x-hip.x)*(1+ease);p.z=hip.z+(p.z-hip.z)*(1+ease);p.applyMatrix4(toMetres);vertices.push(p.x,p.y,p.z);colors.push(0.14,0.23,0.40);const restPoint=new THREE.Vector3(...corner.position);uvs.push(restPoint.x*3,restPoint.y*3);cloth.push(1);const inf=normalizedInfluences(corner.influences);for(let c=0;c<4;c++){bones.push(inf[c]?.[0]??0);weights.push(inf[c]?.[1]??0);}sourceBindings.push({vertices:sourceIds,barycentric:corner.barycentric});cache.set(key,id);return id;};
  for(let off=0;off<index.count;off+=3){const ids=[index.getX(off),index.getX(off+1),index.getX(off+2)] as [number,number,number],corners=ids.map((v,k)=>({position:pointAt(v).toArray() as [number,number,number],normal:normalAt(v).toArray() as [number,number,number],uv:uv?([uv.getX(v),uv.getY(v)] as [number,number]):([0,0] as [number,number]),influences:vertexInfluences(v),barycentric:([k===0?1:0,k===1?1:0,k===2?1:0] as [number,number,number])})) as [ClipCorner,ClipCorner,ClipCorner];for(const fragment of clipSourceTriangle(off/3,corners,planes)){const out=fragment.corners.map(c=>emit(ids,c));if(new Set(out).size<3)continue;indices.push(out[0]!,out[1]!,out[2]!);sourceFaceIds.push(fragment.sourceFace);}}
  if(!indices.length)throw new Error('Office expanded shell selected no faces');
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setAttribute('wardrobeUv',new THREE.Float32BufferAttribute(uvs,2));geometry.setAttribute('wardrobeCloth',new THREE.Float32BufferAttribute(cloth,1));geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(bones,4));geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(weights,4));geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();
  const edges=new Map<string,number>();for(let i=0;i<indices.length;i+=3)for(const [a,b]of [[indices[i]!,indices[i+1]!],[indices[i+1]!,indices[i+2]!],[indices[i+2]!,indices[i]!]]){const k=edgeKey(a,b);edges.set(k,(edges.get(k)??0)+1);}const bytes=Object.values(geometry.attributes).reduce((n,a)=>n+a.array.byteLength,0)+(geometry.index?.array.byteLength??0);
  return{geometry,triangles:indices.length/3,bytes,sourceFaceIds,sourceBindings,openBoundaryEdges:[...edges.values()].filter(n=>n===1).length,item:'office-expanded-shell'};
}
