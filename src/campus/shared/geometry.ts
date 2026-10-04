import type { BufferGeometry, InstancedMesh, Material, Mesh, Object3D } from 'three';
import { createBatch, sceneMaterials } from '../../scene/build.ts';
import type { Kit } from '../../scene/kit.ts';
import type { Batch, SceneMaterials } from '../../scene/types.ts';

export interface Instance { x: number; y: number; z: number; sx?: number; sy?: number; sz?: number; ry?: number; color?: string }

/** Bake original primitives into one shared-material mesh. */
export function primitiveGeometry(kit: Kit, draw: (batch: Batch) => void): BufferGeometry {
  const batch: Batch = createBatch(kit.THREE);
  draw(batch);
  const materials: SceneMaterials = sceneMaterials(kit);
  return batch.build(materials).meshes[0]!.geometry; // the draw callback always emits at least one solid shape
}

export function instances(kit: Kit, geometry: BufferGeometry, items: Instance[]): InstancedMesh | null {
  if (!items.length) return null;
  const { THREE } = kit;
  const materials: SceneMaterials = sceneMaterials(kit);
  const mesh = new THREE.InstancedMesh(geometry, materials.solid, items.length);
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion();
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), item.ry || 0);
    matrix.compose(new THREE.Vector3(item.x, item.y, item.z), rotation,
      new THREE.Vector3(item.sx ?? 1, item.sy ?? 1, item.sz ?? 1));
    mesh.setMatrixAt(i, matrix);
    if (item.color) mesh.setColorAt(i, new THREE.Color(item.color));
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

export interface SceneMeasure { triangles: number; drawCalls: number; meshes: number; geometries: number; lights: number }

interface ObjectFlags { isLight?: boolean; isMesh?: boolean; isInstancedMesh?: boolean }

/** Count the whole resident view, including every instance and shadow-independent draw. */
export function measureScene(root: Object3D): SceneMeasure {
  let triangles = 0, drawCalls = 0, meshes = 0, lights = 0;
  const geometries = new Set<BufferGeometry>();
  root.traverseVisible(object => {
    const flags = object as Object3D & ObjectFlags;
    if (flags.isLight) lights++;
    if (!flags.isMesh) return;
    const mesh = object as Mesh;
    meshes++;
    const g = mesh.geometry;
    geometries.add(g);
    triangles += ((g.index?.count ?? g.attributes['position']!.count) / 3) * (flags.isInstancedMesh ? (object as InstancedMesh).count : 1);
    drawCalls += Array.isArray(mesh.material) ? Math.max(1, g.groups.length) : 1;
  });
  return { triangles, drawCalls, meshes, geometries: geometries.size, lights };
}
