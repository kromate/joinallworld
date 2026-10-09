/**
 * Deduplicate parsed model resources for one Kit. A cache survives scene changes and is released with the Kit;
 * individual actor instances own their mutable geometry, materials, skeletons and animation mixers separately.
 */
export interface SharedResourceCache<T> {
  load(key: string, make: () => Promise<T>): Promise<T>;
  assertOpen(): void;
  dispose(): void;
}

/** Clone bones/skeleton links per actor, then detach geometry because appearance and wardrobe fit mutate vertices. */
export function cloneSkinnedBodyScene(source: THREE.Group): { scene: THREE.Object3D; mesh: THREE.SkinnedMesh } {
  const scene = cloneSkinnedHierarchy(source);
  let mesh: THREE.SkinnedMesh | null = null;
  scene.traverse((node) => { if ((node as THREE.SkinnedMesh).isSkinnedMesh && !mesh) mesh = node as THREE.SkinnedMesh; });
  if (!mesh) throw new Error('cloned body has no skinned mesh');
  const skinned: THREE.SkinnedMesh = mesh;
  skinned.geometry = skinned.geometry.clone();
  return { scene, mesh: skinned };
}

export function createSharedResourceCache<T>(
  onDispose: (dispose: () => void) => () => boolean,
  release: (resource: T) => void,
): SharedResourceCache<T> {
  type Entry = { promise: Promise<T>; value?: T };
  const entries = new Map<string, Entry>();
  let closed = false;

  const dispose = () => {
    if (closed) return;
    closed = true;
    for (const entry of entries.values()) if (entry.value !== undefined) release(entry.value);
    entries.clear();
  };
  const withdraw = onDispose(dispose);

  return {
    assertOpen() {
      if (closed) throw new Error('shared body resource cache is disposed');
    },
    load(key, make) {
      if (closed) return Promise.reject(new Error('shared body resource cache is disposed'));
      const existing = entries.get(key);
      if (existing) return existing.promise;
      const entry: Entry = { promise: Promise.resolve().then(() => {
        // A scene can close in the same task that queued this fetch. Do not start new work for it.
        if (closed) throw new Error('shared body resource cache is disposed');
        return make();
      }).then((value) => {
        if (closed) {
          release(value);
          throw new Error('shared body resource cache was disposed while loading');
        }
        entry.value = value;
        return value;
      }).catch((error: unknown) => {
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      }) };
      entries.set(key, entry);
      return entry.promise;
    },
    dispose() {
      if (closed) return;
      withdraw();
      dispose();
    },
  };
}
import { clone as cloneSkinnedHierarchy } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type * as THREE from 'three';
