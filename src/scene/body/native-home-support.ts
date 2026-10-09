import * as THREE from 'three';
import { hostSurfaceYAt, type NativeSceneBodySupport } from './native-scene-support.ts';
import { prepareNativeStaticSurfaceQuery } from './native-static-surface.ts';
type RestSupport = NonNullable<NativeSceneBodySupport['restSupport']>;
type RestPose = Parameters<RestSupport>[0];
export interface NativeHomeRestSpec {
  readonly id: string;
  readonly prop: 'bed' | 'mat' | 'tub' | 'shower';
  readonly mount: { readonly x: number; readonly y: number; readonly z: number; readonly ry: number };
  readonly tile: number;
  readonly showerHead: number;
  readonly group: THREE.Group;
  readonly furniture: THREE.Group;
  readonly objectAt: (point: THREE.Vector3) => string | null;
}
export function createHomeNativeRestSupport(specAt: (pose: RestPose) => NativeHomeRestSpec | null): RestSupport {
  return (pose, actor) => {
    const spec = specAt(pose);
    if (!spec) return null;
    const { id, prop, mount, tile, showerHead, group, furniture, objectAt } = spec;
    const maximum = mount.y + (prop === 'tub' ? 0.15 : prop === 'shower' ? 0.1 : prop === 'mat' ? 0.15 : 0.65) * tile;
    group.updateWorldMatrix(true, false);
    const top = group.localToWorld(new THREE.Vector3(mount.x, maximum, mount.z)).y;
    const bottom = group.localToWorld(new THREE.Vector3(mount.x, mount.y - 0.02 * tile, mount.z)).y;
    group.updateWorldMatrix(true, true);
    const accepts = (hit: THREE.Intersection<THREE.Object3D>) => objectAt(group.worldToLocal(hit.point.clone())) === id;
    // The query is prepared at this per-frame support boundary: unchanged static
    // geometry reuses its transformed triangle index, while changed/dynamic meshes
    // are revalidated or delegated to the host Raycaster.
    const surfaceQuery = prepareNativeStaticSurfaceQuery(furniture, (worldX, worldZ, maximumWorldY, minimumWorldY, acceptsHit) =>
      hostSurfaceYAt(furniture, actor, worldX, worldZ, maximumWorldY, minimumWorldY, acceptsHit), actor);
    return { kind: 'prop-rest', surface: { id, pose, prop,
      surfaceYAt(worldX, worldZ) {
        return surfaceQuery(worldX, worldZ, top, bottom, accepts);
      },
      ...(prop === 'shower' ? { headZone: { anchorWorld(): readonly [number, number, number] {
        group.updateWorldMatrix(true, false);
        const point = new THREE.Vector3(-0.2 * tile, showerHead * tile, -0.2 * tile)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), mount.ry)
          .add(new THREE.Vector3(mount.x, mount.y, mount.z));
        return group.localToWorld(point).toArray();
      }, contains(worldPoint: THREE.Vector3) {
        group.updateWorldMatrix(true, false);
        const local = group.worldToLocal(worldPoint.clone());
        const dx = (local.x - mount.x) / tile, dz = (local.z - mount.z) / tile;
        const cos = Math.cos(mount.ry), sin = Math.sin(mount.ry);
        const x = dx * cos - dz * sin, z = dx * sin + dz * cos;
        const y = (local.y - mount.y) / tile;
        // The actual 0.24m showerhead at (-.2,showerHead,-.2), with its bounded spray column.
        return Math.abs(x + 0.2) <= 0.2 && Math.abs(z + 0.2) <= 0.2 && y >= showerHead - 0.65 && y <= showerHead + 0.02;
      } } } : {}),
    } };
  };
}
