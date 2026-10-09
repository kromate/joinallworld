import * as THREE from 'three';
import type { WardrobeRestFrame } from '../../../../../src/scene/wardrobe/geometry.ts';
import { buildExpandedOfficeShell, type ExpandedOfficeShellOptions } from '../office-source-shell-v2/office-expanded-shell.ts';

export type SourceCornerChartResult=Readonly<{geometry:THREE.BufferGeometry;triangles:number;bytes:number;sourceFaceIds:readonly number[];sourceBindings:readonly Readonly<{vertices:readonly[number,number,number];barycentric:readonly[number,number,number]}>[];sourceCornerPositionBytes:number;item:'office-source-corner-chart'}>;
const ATTRS=['sourceBind0','sourceBind1','sourceBind2','sourceBind3'] as const;
/**
 * Builds the unchanged v2 zero-ease geographic chart, then stores one bind-space
 * source point for each unchanged skin slot. For every generated corner v:
 * sum_b weight[v,b] * BoneMatrix[b] * sourceBind[v,b] equals the barycentric
 * sum of the original source corners after linear blend skinning.
 */
export function buildOfficeSourceCornerChart(base:THREE.SkinnedMesh,rest:WardrobeRestFrame,options:Omit<ExpandedOfficeShellOptions,'radialEase'>):SourceCornerChartResult{
  const shell=buildExpandedOfficeShell(base,rest,{...options,radialEase:0}),geometry=shell.geometry,source=base.geometry,sourcePosition=source.getAttribute('position'),sourceIndex=source.getAttribute('skinIndex'),sourceWeight=source.getAttribute('skinWeight'),skinIndex=geometry.getAttribute('skinIndex'),skinWeight=geometry.getAttribute('skinWeight');
  if(!geometry.index||!sourcePosition||!sourceIndex||!sourceWeight||!skinIndex||!skinWeight)throw new Error('Source-corner chart requires indexed skinned source and output geometry');
  const arrays=[[],[],[],[]] as number[][],bindMatrix=base.bindMatrix;
  for(let v=0;v<geometry.getAttribute('position').count;v++){
    const binding=shell.sourceBindings[v];if(!binding)throw new Error(`Missing barycentric source binding ${v}`);const coefficient=new Map<number,number>(),accumulated=new Map<number,THREE.Vector3>();
    for(let k=0;k<3;k++)for(let c=0;c<4;c++){const src=binding.vertices[k],bone=sourceIndex.getComponent(src,c),amount=binding.barycentric[k]*sourceWeight.getComponent(src,c);if(amount<=0)continue;coefficient.set(bone,(coefficient.get(bone)??0)+amount);let sum=accumulated.get(bone);if(!sum){sum=new THREE.Vector3();accumulated.set(bone,sum);}sum.addScaledVector(new THREE.Vector3().fromBufferAttribute(sourcePosition,src).applyMatrix4(bindMatrix),amount);}
    if(coefficient.size>4)throw new Error(`Vertex ${v} needs ${coefficient.size} source bones; refusing to prune influences`);
    const emitted=new Set<number>();for(let slot=0;slot<4;slot++){const bone=skinIndex.getComponent(v,slot),weight=skinWeight.getComponent(v,slot);if(weight<=0){arrays[slot]!.push(0,0,0);continue;}if(emitted.has(bone))throw new Error(`Duplicate skin bone slot ${bone} at vertex ${v}`);emitted.add(bone);const expected=coefficient.get(bone)??0,point=accumulated.get(bone);if(!point||Math.abs(expected-weight)>1e-5)throw new Error(`Skin slot mismatch at vertex ${v}, bone ${bone}: output=${weight} source=${expected}`);point.multiplyScalar(1/expected);arrays[slot]!.push(point.x,point.y,point.z);}
    if(emitted.size!==coefficient.size)throw new Error(`Source bone set and output skin slots differ at vertex ${v}`);
  }
  for(let slot=0;slot<4;slot++)geometry.setAttribute(ATTRS[slot],new THREE.Float32BufferAttribute(arrays[slot]!,3));
  const added=geometry.getAttribute(ATTRS[0]).count*4*3*Float32Array.BYTES_PER_ELEMENT,bytes=shell.bytes+added;
  return{geometry,triangles:shell.triangles,bytes,sourceFaceIds:shell.sourceFaceIds,sourceBindings:shell.sourceBindings,sourceCornerPositionBytes:added,item:'office-source-corner-chart'};
}
