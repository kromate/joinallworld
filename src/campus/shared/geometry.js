import { createBatch, sceneMaterials } from '../../scene/build.js';

/** @typedef {{x:number,y:number,z:number,sx?:number,sy?:number,sz?:number,ry?:number,color?:string}} Instance */

/** Bake original primitives into one shared-material mesh.
 * @param {ReturnType<import('../../scene/kit.js').createKit>} kit
 * @param {(batch:ReturnType<typeof createBatch>)=>void} draw
 * @returns {import('three').BufferGeometry}
 */
export function primitiveGeometry(kit, draw) {
  const batch = createBatch(kit.THREE);
  draw(batch);
  return batch.build(sceneMaterials(kit)).meshes[0].geometry;
}

/** @param {ReturnType<import('../../scene/kit.js').createKit>} kit
 * @param {import('three').BufferGeometry} geometry
 * @param {Instance[]} items
 * @returns {import('three').InstancedMesh|null}
 */
export function instances(kit, geometry, items) {
  if (!items.length) return null;
  const { THREE } = kit;
  const mesh = new THREE.InstancedMesh(geometry, sceneMaterials(kit).solid, items.length);
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
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

/** Count the whole resident view, including every instance and shadow-independent draw.
 * @param {import('three').Object3D} root
 * @returns {{triangles:number,drawCalls:number,meshes:number,geometries:number,lights:number}}
 */
export function measureScene(root) {
  let triangles = 0, drawCalls = 0, meshes = 0, lights = 0;
  const geometries = new Set();
  root.traverseVisible(object => {
    if (object.isLight) lights++;
    if (!object.isMesh) return;
    meshes++;
    const g = object.geometry;
    geometries.add(g);
    triangles += ((g.index?.count ?? g.attributes.position.count) / 3) * (object.isInstancedMesh ? object.count : 1);
    drawCalls += Array.isArray(object.material) ? Math.max(1, g.groups.length) : 1;
  });
  return { triangles, drawCalls, meshes, geometries: geometries.size, lights };
}
