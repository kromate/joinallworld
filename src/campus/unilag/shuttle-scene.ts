/** Rendering-only procedural model for the campus shuttle. */
import type { Group } from 'three';
import { createBatch, kitResources, releaseObjects, sceneMaterials } from '../../scene/build.ts';
import type { Kit } from '../../scene/kit.ts';
import type { Batch } from '../../scene/types.ts';

export function buildShuttle(kit: Kit): { group: Group; triangles: number; dispose: () => void } {
  const { THREE } = kit, batch: Batch = createBatch(THREE), group = new THREE.Group();
  group.name = 'unilag-campus-shuttle';
  batch.box(0, 1.25, 0, 3.2, 1.8, 6.4, '#f2e7c9');
  batch.box(0, 2.2, -0.15, 3.05, 0.45, 5.6, '#8f2434');
  batch.box(0, 1.45, 3.22, 2.5, 1.0, 0.08, '#7db6c5', { layer: 'glass' });
  for (const side of [-1, 1]) {
    batch.box(side * 1.61, 1.5, -0.2, 0.07, 0.8, 4.8, '#78acbb', { layer: 'glass' });
    for (const z of [-2.2, 2.1]) batch.cyl(side * 1.65, 0.62, z, 0.56, 0.34, '#202328', { seg: 10, rz: Math.PI / 2 });
  }
  batch.box(0, 1.0, -3.23, 2.7, 0.5, 0.08, '#8f2434');
  batch.box(0, 2.45, 0, 2.0, 0.12, 3.4, '#d9b43c');
  const built = batch.build(sceneMaterials(kit));
  for (const mesh of built.meshes) group.add(mesh);
  const registry = kitResources(kit).disposers;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true; registry.delete(dispose); releaseObjects(built.meshes); group.parent?.remove(group); group.clear();
  };
  registry.add(dispose);
  group.userData = { triangles: built.triangles, dispose };
  return { group, triangles: built.triangles, dispose };
}
