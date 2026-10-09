import * as THREE from 'three';
import type { NativePreparedFactoryOptions } from './native/native-full-runtime-v1/native-prepared-factory.ts';
import type { StandInScene } from './stand-in.ts';

export type NativeSceneBodySupport = Pick<NativePreparedFactoryOptions,
  'seatSupport' | 'stairContactHeightAt' | 'workSupport' | 'restSupport'>;

function belongsTo(object: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) if (node === ancestor) return true;
  return false;
}

/** Query rendered host geometry; actor meshes and hidden furniture cannot provide their own support. */
export function hostSurfaceYAt(
  host: THREE.Object3D, actor: THREE.Object3D, worldX: number, worldZ: number,
  maximumWorldY: number, minimumWorldY: number,
  accepts: (hit: THREE.Intersection<THREE.Object3D>) => boolean = () => true,
): number | null {
  if (![worldX, worldZ, maximumWorldY, minimumWorldY].every(Number.isFinite) || maximumWorldY <= minimumWorldY) return null;
  host.updateWorldMatrix(true, false); host.updateMatrixWorld(true);
  const meshes: THREE.Object3D[] = [];
  host.traverseVisible((node) => {
    if (node instanceof THREE.Mesh && !belongsTo(node, actor)) meshes.push(node);
  });
  const ray = new THREE.Raycaster(new THREE.Vector3(worldX, maximumWorldY, worldZ), new THREE.Vector3(0, -1, 0), 0, maximumWorldY - minimumWorldY);
  const hit = ray.intersectObjects(meshes, false).find(accepts);
  return hit?.point.y ?? null;
}

/** Scene callbacks stay live as the stand-in moves between groups; no captured chair or floor survives a transition. */
export function createStandInNativeSupport(
  sceneAt: () => StandInScene | null,
  surfaceHostAt: () => THREE.Object3D | null = () => sceneAt()?.group ?? null,
): NativeSceneBodySupport {
  function floorWorld(actor: THREE.Group, x: number, z: number, expectedY: number): number | null {
    const scene = sceneAt();
    if (!scene?.contactHeightAt || actor.parent !== scene.group) return null;
    const localY = scene.contactHeightAt(x, z, expectedY);
    if (localY === null || !Number.isFinite(localY)) return null;
    scene.group.updateWorldMatrix(true, false);
    return new THREE.Vector3(x, localY, z).applyMatrix4(scene.group.matrixWorld).y;
  }
  return {
    stairContactHeightAt(contact, actor) {
      const scene = sceneAt();
      if (!scene?.contactHeightAt || actor.parent !== scene.group) return null;
      return scene.contactHeightAt(contact.x, contact.z, contact.y);
    },
    seatSupport(seat, actor) {
      const scene = sceneAt();
      if (!scene || actor.parent !== scene.group) return { kind: 'diagnostic', floorY: Number.NaN };
      scene.group.updateWorldMatrix(true, false);
      const anchor = new THREE.Vector3(seat.x, seat.top, seat.z).applyMatrix4(scene.group.matrixWorld);
      const scale = new THREE.Vector3(); scene.group.getWorldScale(scale);
      const surfaceHost = surfaceHostAt();
      const seatTopY = surfaceHost ? hostSurfaceYAt(surfaceHost, actor, anchor.x, anchor.z, anchor.y + 0.025 * scale.y, anchor.y - 0.025 * scale.y) : null;
      const floorY = floorWorld(actor, seat.x, seat.z, seat.top - 0.6 * scene.scale);
      const hips = actor.getObjectByName('mixamorigHips');
      if (seatTopY === null || floorY === null || !hips) return { kind: 'diagnostic', floorY: floorY ?? Number.NaN };
      actor.updateWorldMatrix(true, false); actor.updateMatrixWorld(true);
      const hip = hips.getWorldPosition(new THREE.Vector3());
      return { kind: 'seat-anchor', hipWorld: [anchor.x, hip.y, anchor.z], seatTopY, floorY };
    },
    workSupport(placement, actor) {
      const floorY = floorWorld(actor, placement.x, placement.z, placement.y);
      return floorY === null ? { kind: 'diagnostic', floorY: Number.NaN } : { kind: 'flat-feet', floorY };
    },
  };
}
