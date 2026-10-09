import * as THREE from 'three';

export interface NativeBodySurfaceProbe {
  readonly candidateCount: number;
  readonly blendBucketCount: number;
  readonly sourceVertexCount: number;
  sample(): Readonly<{ minY: number; maxY: number }>;
}
const DIRECTIONS = [
  [1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],
  ...[-1,1].flatMap(x => [-1,1].flatMap(y => [-1,1].map(z => [x,y,z]))),
].map(value => new THREE.Vector3(value[0]!,value[1]!,value[2]!).normalize());

/** Cache anatomical surface extremes once; sample only those vertices during a bounded pose. */
export function createNativeBodySurfaceProbe(root: THREE.Group, meshes: readonly THREE.SkinnedMesh[]): NativeBodySurfaceProbe {
  if (!meshes.length || meshes.length > 8) throw new Error('Native body surface needs one to eight owned meshes');
  root.updateWorldMatrix(true,false);root.updateMatrixWorld(true);
  const rootInverse=root.matrixWorld.clone().invert(),point=new THREE.Vector3();
  const samples: {mesh:THREE.SkinnedMesh; vertices:Uint32Array}[]=[];
  let sourceVertexCount=0,candidateCount=0,blendBucketCount=0;
  for(const mesh of meshes){
    if(root.getObjectById(mesh.id)!==mesh)throw new Error('Native body surface mesh must belong to the actor');
    const position=mesh.geometry.getAttribute('position'),indices=mesh.geometry.getAttribute('skinIndex'),weights=mesh.geometry.getAttribute('skinWeight');
    if(!position||!indices||!weights||position.count!==indices.count||position.count!==weights.count)throw new Error('Native body surface needs aligned skin attributes');
    const used=mesh.geometry.index?new Set(Array.from(mesh.geometry.index.array)):new Set(Array.from({length:position.count},(_,i)=>i));
    const buckets=new Map<string,{scores:Float64Array;vertices:Int32Array}>();
    mesh.skeleton.update();
    for(const vertex of used){
      let bone=-1,maximum=0;
      for(let channel=0;channel<4;channel++){const weight=weights.getComponent(vertex,channel);if(weight>maximum){maximum=weight;bone=indices.getComponent(vertex,channel);}}
      if(bone<0||!mesh.skeleton.bones[bone])throw new Error('Native body surface vertex lacks positive valid support');
      // Bucket by the top three *aggregated* bone influences and quantized secondary/tertiary
      // weights. The previous key omitted the third bone and could merge vertices whose omitted
      // support moved differently during a fold; very coarse support buckets then missed the
      // actual indexed-surface minimum even though the cached candidate looked stable.
      const influenceByBone=new Map<number,number>();
      for(let channel=0;channel<4;channel++){
        const boneIndex=indices.getComponent(vertex,channel),weight=weights.getComponent(vertex,channel);
        if(weight>1e-5)influenceByBone.set(boneIndex,(influenceByBone.get(boneIndex)??0)+weight);
      }
      const supports=[...influenceByBone].map(([boneIndex,weight])=>({bone:boneIndex,weight}))
        .sort((a,b)=>b.weight-a.weight||a.bone-b.bone);
      const primary=supports[0]!,secondary=supports[1],tertiary=supports[2];
      const quantize=(weight:number|undefined)=>Math.floor((weight??0)*4+1e-7);
      const key=`${primary.bone}:${secondary?.bone??-1}:${tertiary?.bone??-1}:${quantize(secondary?.weight)}:${quantize(tertiary?.weight)}`;
      let bucket=buckets.get(key);if(!bucket){bucket={scores:new Float64Array(DIRECTIONS.length).fill(-Infinity),vertices:new Int32Array(DIRECTIONS.length).fill(-1)};buckets.set(key,bucket);}
      mesh.getVertexPosition(vertex,point);point.applyMatrix4(mesh.matrixWorld).applyMatrix4(rootInverse);
      for(let direction=0;direction<DIRECTIONS.length;direction++){const score=point.dot(DIRECTIONS[direction]!);if(score>bucket.scores[direction]!){bucket.scores[direction]=score;bucket.vertices[direction]=vertex;}}
    }
    blendBucketCount+=buckets.size;
    const chosen=new Set<number>();for(const bucket of buckets.values())for(const vertex of bucket.vertices)if(vertex>=0)chosen.add(vertex);
    const vertices=Uint32Array.from(chosen);sourceVertexCount+=used.size;candidateCount+=vertices.length;samples.push({mesh,vertices});
  }
  if(!candidateCount||candidateCount>4096)throw new Error(`Native body surface exceeds bounded candidate allowance: ${candidateCount}`);
  return {
    candidateCount,blendBucketCount,sourceVertexCount,
    sample(){
      root.updateWorldMatrix(true,false);root.updateMatrixWorld(true);
      let minY=Infinity,maxY=-Infinity;
      for(const {mesh,vertices}of samples){if(!mesh.visible)continue;mesh.skeleton.update();for(const index of vertices){mesh.getVertexPosition(index,point);point.applyMatrix4(mesh.matrixWorld);minY=Math.min(minY,point.y);maxY=Math.max(maxY,point.y);}}
      if(!Number.isFinite(minY)||!Number.isFinite(maxY))throw new Error('Native body surface has no finite visible samples');
      return Object.freeze({minY,maxY});
    },
  };
}
