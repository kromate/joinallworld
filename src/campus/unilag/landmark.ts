import { createBatch, kitResources, releaseObjects, sceneMaterials } from '../../scene/build.ts';
import { palm } from '../../scene/props.ts';
import type * as ThreeNamespace from 'three';
import type { Kit } from '../../scene/kit.ts';

export interface UnilagLandmark {
  group: ThreeNamespace.Group;
  triangles: number;
  dispose: () => void;
}

/**
 * Approximate city-map placement beside Yaba on the mainland lagoon edge.
 * Presentation coordinates only; this is not a surveyed campus footprint.
 */
export const MAP_PLACEMENT = Object.freeze({
  x: 15, z: -42, ry: 0, footprint: Object.freeze({ w: 14, d: 10 }),
  source: 'Approximate placement beside the existing Yaba miniature and mainland lagoon edge',
});

/**
 * Builds the procedural UNILAG city-map landmark: Senate House, its red grid,
 * the open main gate and palms. It uses merged geometry and no textures.
 */
export function buildUnilagLandmark(kit: Kit): UnilagLandmark {
  const { THREE } = kit, batch = createBatch(THREE), group = new THREE.Group();
  group.name = 'landmark:unilag';
  const cream = '#efe2c4', red = '#8f2434', dark = '#5d4339', glass = '#78a6ae';
  batch.box(0, 0.2, 0, 13.5, 0.4, 9.5, '#b9c887');
  batch.box(1.6, 1.2, -1.2, 6.8, 2.4, 4.4, cream);
  batch.box(1.6, 4.3, -1.7, 4.2, 4.2, 3.1, cream);
  batch.box(1.6, 6.55, -1.7, 4.5, 0.3, 3.35, red);
  for (let floor = 0; floor < 3; floor += 1) {
    const y = 3.05 + floor * 1.2;
    batch.box(1.6, y, -0.12, 3.6, 0.62, 0.06, glass, { layer: 'glass' });
    batch.box(1.6, y + 0.38, -0.07, 4.0, 0.1, 0.1, red);
    for (let column = -1; column <= 1; column += 1) batch.box(1.6 + column * 1.2, y, -0.07, 0.1, 0.75, 0.1, red);
  }
  batch.box(-3.3, 1.15, 2.8, 0.65, 2.3, 0.65, red);
  batch.box(-0.9, 1.15, 2.8, 0.65, 2.3, 0.65, red);
  batch.box(-2.1, 2.2, 2.8, 3.3, 0.3, 0.8, red);
  batch.box(-2.1, 2.45, 2.8, 2.2, 0.2, 0.9, cream);
  batch.box(-2.1, 0.1, 1.7, 5.0, 0.2, 2.2, dark);
  palm(batch, -5.0, -2.8, { s: 0.55, lean: 0.08 });
  palm(batch, 5.3, 1.8, { s: 0.5, lean: -0.06, ry: 1.2 });
  const built = batch.build(sceneMaterials(kit));
  for (const mesh of built.meshes) group.add(mesh);
  const registry = kitResources(kit).disposers;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true; registry.delete(dispose); releaseObjects(built.meshes); group.parent?.remove(group); group.clear();
  };
  registry.add(dispose);
  group.userData = { triangles: built.triangles, placement: MAP_PLACEMENT, dispose };
  return { group, triangles: built.triangles, dispose };
}

