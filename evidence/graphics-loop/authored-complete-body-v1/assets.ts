import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { Kit } from '../../../src/scene/kit.ts';
import { BODY_FILES } from '../../../src/scene/body/files.ts';
import authoredUrl from './parametric-base-facial.glb?url';
import type { CompleteCharacterKit } from './rig.ts';

const sourceJointNames = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r', 'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r'];

/** Own the two immutable templates once per comparison Kit. Actors own only their clones. */
export function completeCharacterKit(kit: Kit): CompleteCharacterKit {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const ownedRoots = new Set<THREE.Group>();
  const ownedSkeletons = new Set<THREE.Skeleton>();
  let closed = false;
  function release(root: THREE.Group) {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    root.traverse(node => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      geometries.add(mesh.geometry);
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) ownedSkeletons.add((mesh as THREE.SkinnedMesh).skeleton);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  }
  async function load(url: string) {
    const gltf = await loader.loadAsync(url);
    if (closed) { release(gltf.scene); throw new Error('Complete character assets were disposed while loading'); }
    ownedRoots.add(gltf.scene);
    return gltf;
  }
  let template: ReturnType<typeof load> | undefined;
  let motion: Promise<{root: THREE.Object3D & {skeleton: THREE.Skeleton}; clips: THREE.AnimationClip[]}> | undefined;
  kit.onDispose(() => {
    closed = true;
    for (const root of ownedRoots) release(root);
    for (const skeleton of ownedSkeletons) skeleton.dispose();
    ownedRoots.clear(); ownedSkeletons.clear();
  });
  return {
    onDispose: callback => kit.onDispose(callback),
    authoredCharacterAssets: {
      async loadTemplate() {
        if (closed) throw new Error('Complete character assets were disposed');
        template ??= load(authoredUrl);
        return (await template).scene;
      },
      loadMotionRig() {
        if (closed) return Promise.reject(new Error('Complete character assets were disposed'));
        motion ??= load(BODY_FILES.clips).then(gltf => {
          gltf.scene.updateMatrixWorld(true);
          const bones = sourceJointNames.map(name => {
            const bone = gltf.scene.getObjectByName(name);
            if (!bone) throw new Error(`Animation source joint missing: ${name}`);
            return bone as THREE.Bone;
          });
          const skeleton = new THREE.Skeleton(bones, bones.map(bone => bone.matrixWorld.clone().invert()));
          ownedSkeletons.add(skeleton);
          const root = Object.assign(gltf.scene, {skeleton});
          return {root, clips: gltf.animations};
        });
        return motion;
      },
    },
  };
}
