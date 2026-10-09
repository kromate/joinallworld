import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { Kit } from '../../kit.ts';
import { BODY_FILES } from '../files.ts';
import authoredUrl from './authored-body-compression/outcompressed/parametric-base-facial-meshopt.glb?url';
import type { CompleteCharacterKit } from './rig.ts';

const sourceJointNames = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head', 'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r', 'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r'];

const kitAssets = new WeakMap<Kit, CompleteCharacterKit>();
// Reuse the complete immutable binary payload across independently-owned Kits.
// Each Kit still parses its own scene/skeleton; only the fetched bytes are shared.
const motionBytes = new Map<string, Promise<ArrayBuffer>>();
const clipDiagnostics = { requests: 0, bytesRead: 0, parseSuccesses: 0, kitsParsed: 0, cacheHits: 0 };

export function getClipSnapshotDiagnostics() { return { ...clipDiagnostics }; }
Object.assign(globalThis, { __clipSnapshotDiagnostics: getClipSnapshotDiagnostics });

async function fetchMotionBytes(url: string): Promise<ArrayBuffer> {
  let pending = motionBytes.get(url);
  if (!pending) {
    clipDiagnostics.requests++;
    pending = (async () => {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Motion GLB fetch failed (${response.status}): ${url}`);
      const expectedLength = Number(response.headers.get('content-length'));
      const bytes = await response.arrayBuffer();
      const contentEncoding = response.headers.get('content-encoding');
      if (bytes.byteLength === 0 || (!contentEncoding && Number.isFinite(expectedLength) && expectedLength > 0 && bytes.byteLength !== expectedLength)) {
        throw new Error(`Motion GLB payload length mismatch for ${url}: ${bytes.byteLength}/${expectedLength}`);
      }
      clipDiagnostics.bytesRead += bytes.byteLength;
      return bytes;
    })();
    motionBytes.set(url, pending);
    void pending.catch(() => { if (motionBytes.get(url) === pending) motionBytes.delete(url); });
  } else clipDiagnostics.cacheHits++;
  return pending;
}

/** Own the two immutable templates once per comparison Kit. Actors own only their clones. */
export function completeCharacterKit(kit: Kit): CompleteCharacterKit {
  const existing=kitAssets.get(kit);
  if(existing)return existing;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const ownedRoots = new Set<THREE.Group>();
  const ownedSkeletons = new Set<THREE.Skeleton>();
  let closed = false;
  function release(root: THREE.Group) {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const skeletons=new Set<THREE.Skeleton>();
    root.traverse(node => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      geometries.add(mesh.geometry);
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) skeletons.add((mesh as THREE.SkinnedMesh).skeleton);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for(const skeleton of skeletons){skeleton.dispose();ownedSkeletons.delete(skeleton);}
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
  const result:CompleteCharacterKit = {
    onDispose: callback => kit.onDispose(callback),
    authoredCharacterAssets: {
      async loadTemplate() {
        if (closed) throw new Error('Complete character assets were disposed');
        template ??= load(authoredUrl).catch((error: unknown)=>{template=undefined;throw error;});
        return (await template).scene;
      },
      loadMotionRig() {
        if (closed) return Promise.reject(new Error('Complete character assets were disposed'));
        motion ??= (async () => {
          const url = BODY_FILES.clips;
          const bytes = await fetchMotionBytes(url);
          if (closed) throw new Error('Complete character assets were disposed before motion parsing');
          const gltf = await loader.parseAsync(bytes, new URL('.', new URL(url, import.meta.url)).href);
          if (closed) { release(gltf.scene); throw new Error('Complete character assets were disposed while parsing motion'); }
          clipDiagnostics.parseSuccesses++;
          ownedRoots.add(gltf.scene);
          gltf.scene.updateMatrixWorld(true);
          const bones = sourceJointNames.map(name => {
            const bone = gltf.scene.getObjectByName(name);
            if (!bone) throw new Error(`Animation source joint missing: ${name}`);
            return bone as THREE.Bone;
          });
          const skeleton = new THREE.Skeleton(bones, bones.map(bone => bone.matrixWorld.clone().invert()));
          ownedSkeletons.add(skeleton);
          const root = Object.assign(gltf.scene, {skeleton});
          clipDiagnostics.kitsParsed++;
          return {root, clips: gltf.animations};
        })().catch((error: unknown)=>{motion=undefined;throw error;});
        return motion;
      },
    },
  };
  kitAssets.set(kit,result);
  return result;
}
