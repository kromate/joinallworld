import type { BufferGeometry, InstancedMesh, Material, Mesh, Object3D } from 'three';

export interface RenderCost { triangles: number; meshes: number; drawCalls: number }
export interface SceneRenderCost {
  scenery: RenderCost;
  characters: RenderCost;
  /**
   * The unique place model behind a venue (src/scene/places): a node marked `userData.placeModel === true`. Its triangles are measured here, under
   * PLACE_MODEL_TRIANGLES, and are NOT in `scenery.triangles` (scenery keeps its own 15,000). Its draw calls ARE added to `scenery.drawCalls`
   * as well, because the 60 draw calls are shared by everything on screen; its meshes are not added to `scenery.meshes`.
   */
  place: RenderCost;
  reservedTriangles: number;
  reservedDrawCalls: number;
}

/** Visible geometry plus explicit native-character loading reservations. A reserved subtree is counted once. */
export function measureRenderCost(root: Object3D, exclude?: Object3D | ((node: Object3D) => boolean)): SceneRenderCost {
  const result: SceneRenderCost = {
    scenery: { triangles: 0, meshes: 0, drawCalls: 0 },
    characters: { triangles: 0, meshes: 0, drawCalls: 0 },
    place: { triangles: 0, meshes: 0, drawCalls: 0 },
    reservedTriangles: 0, reservedDrawCalls: 0,
  };
  const positive = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
  function visit(node: Object3D, character: boolean, place = false): void {
    if (!node.visible || (typeof exclude === 'function' ? exclude(node) : node === exclude)) return;
    character ||= node.userData.canonicalCharacter === true || node.userData.characterFoundation === 'native53';
    place ||= node.userData.placeModel === true;
    const reservedTriangles = positive(node.userData.characterReservedTriangles);
    const reservedDrawCalls = positive(node.userData.characterReservedDrawCalls);
    if (reservedTriangles || reservedDrawCalls) {
      result.characters.triangles += reservedTriangles;
      result.characters.meshes += reservedDrawCalls;
      result.characters.drawCalls += reservedDrawCalls;
      result.reservedTriangles += reservedTriangles;
      result.reservedDrawCalls += reservedDrawCalls;
      return;
    }
    const mesh = node as Mesh<BufferGeometry, Material | Material[]>;
    if (mesh.isMesh) {
      const geometry = mesh.geometry;
      const available = geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0;
      const start = Math.max(0, geometry.drawRange.start);
      const end = Math.min(available, start + geometry.drawRange.count);
      const instances = (mesh as InstancedMesh).isInstancedMesh ? positive((mesh as InstancedMesh).count) : 1;
      const materials = mesh.material;
      const draws = Array.isArray(materials)
        ? geometry.groups.filter(group => group.start < end && group.start + group.count > start && materials[group.materialIndex ?? 0]?.visible === true).length
        : materials.visible ? 1 : 0;
      if (draws && instances && end > start) {
        const calls = draws * (mesh.castShadow ? 2 : 1), triangles = Math.floor(Math.max(0, end - start) / 3) * instances;
        if (place && !character) {
          result.place.triangles += triangles; result.place.meshes++; result.place.drawCalls += calls;
          result.scenery.drawCalls += calls;
        } else {
          const part = character ? result.characters : result.scenery;
          part.triangles += triangles;
          part.meshes++;
          part.drawCalls += calls;
        }
      }
    }
    for (const child of node.children) visit(child, character, place);
  }
  let character = false, place = false;
  for (let node = root.parent; node; node = node.parent) { character ||= node.userData.canonicalCharacter === true; place ||= node.userData.placeModel === true; }
  visit(root, character, place);
  return result;
}

export function totalRenderCost(root: Object3D): RenderCost {
  const { scenery, characters } = measureRenderCost(root);
  return {
    triangles: scenery.triangles + characters.triangles,
    meshes: scenery.meshes + characters.meshes,
    drawCalls: scenery.drawCalls + characters.drawCalls,
  };
}
