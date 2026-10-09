import * as THREE from 'three';
import type { NativeRestPose, NativeRestProp, NativeRestPropSurface } from './native-rest-contact.ts';

export interface HomeRestPropFixture {
  readonly prop: NativeRestProp;
  readonly group: THREE.Group;
  readonly supportSurface: NativeRestPropSurface;
  dispose(): void;
}

export interface HomeChairFixture {
  readonly group: THREE.Group;
  readonly seat: THREE.Mesh;
  dispose(): void;
}

const ROOM_WHITE = '#f3f1ea';
const WOOD = '#7a5c40';
const STEEL = '#9aa3a8';
/** 3af home-scene uses ROOM/grid = 10/12 for the default house. Furniture geometry is in tiles. */
export const HOME_SOURCE_TILE = 10 / 12;

function box(parent: THREE.Object3D, name: string, position: readonly [number, number, number], size: readonly [number, number, number], color: string): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color, roughness: 0.86 }));
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function surfaceY(meshes: readonly THREE.Mesh[], worldX: number, worldZ: number, minY: number, maxY: number): number | null {
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    mesh.updateMatrixWorld(true);
  }
  const ray = new THREE.Raycaster(new THREE.Vector3(worldX, 12, worldZ), new THREE.Vector3(0, -1, 0), 0, 24);
  const point = ray.intersectObjects(meshes.slice(), false).find((hit) => hit.point.y >= minY && hit.point.y <= maxY)?.point;
  return point?.y ?? null;
}

/** Exact SHAPES.chair geometry from the pinned home-scene.ts definition. */
export function createHomeChairFixture(): HomeChairFixture {
  const group = new THREE.Group(); group.name = 'source-3af-chair';
  group.scale.setScalar(HOME_SOURCE_TILE);
  group.position.y = 0.015;
  const seat = box(group, 'chair-seat-support', [0, 0.38, 0], [0.5, 0.06, 0.5], WOOD);
  box(group, 'chair-back', [0, 0.66, -0.23], [0.5, 0.5, 0.05], WOOD);
  for (const x of [-0.21, 0.21]) for (const z of [-0.21, 0.21]) box(group, `chair-leg-${x}-${z}`, [x, 0.18, z], [0.06, 0.36, 0.06], WOOD);
  let disposed = false;
  return Object.freeze({ group, seat, dispose() {
    if (disposed) return;
    disposed = true; group.removeFromParent();
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.dispose();
      }
    });
  } });
}

/**
 * Recreates the home-scene SHAPES contact-bearing pieces from 3af17a0. Geometry/materials are
 * real meshes and the support callback raycasts those meshes; it does not return a guessed plane.
 * Home item transform is applied by the caller, just as mountOf/model does in home-scene.ts.
 */
export function createHomeRestPropFixture(prop: NativeRestProp, pose: NativeRestPose, id = `home-${prop}`): HomeRestPropFixture {
  const expectedPose: Readonly<Record<NativeRestProp, NativeRestPose>> = { bed: 'lie', mat: 'lie', tub: 'soak', shower: 'wash' };
  if (expectedPose[prop] !== pose) throw new Error(`${prop} cannot fixture ${pose}`);
  const group = new THREE.Group();
  group.name = `source-3af-${prop}`;
  // home-scene `model()` applies mount.scale=tile to every non-wall furniture shape.
  group.scale.setScalar(HOME_SOURCE_TILE);
  group.position.y = 0.015;
  const support: THREE.Mesh[] = [];
  let headZoneMesh: THREE.Mesh | null = null;
  if (prop === 'bed') {
    // SHAPES.bed, home-scene.ts: a 1×2-tile bed (W=1, D=2).
    box(group, 'bed-frame', [0, 0.2, 0], [0.92, 0.26, 1.88], WOOD);
    support.push(box(group, 'bed-sheet-support', [0, 0.42, 0], [0.86, 0.2, 1.8], ROOM_WHITE));
    support.push(box(group, 'bed-blanket-support', [0, 0.54, 0.28], [0.88, 0.07, 1.16], '#8fa7c4'));
    support.push(box(group, 'bed-pillow-support', [0, 0.58, -0.76], [0.55, 0.1, 0.32], '#ffffff'));
    // Exact source definition uses spring-bed stars=1 here: y=.50 + 1*.08, height=.70 + 1*.16.
    box(group, 'bed-headboard', [0, 0.58, -0.94], [0.92, 0.86, 0.07], WOOD);
  } else if (prop === 'mat') {
    // SHAPES.mat, home-scene.ts: W=1, D=2.
    support.push(box(group, 'mat-rest-surface', [0, 0.04, 0], [0.84, 0.06, 1.8], '#c9a45c'));
    support.push(box(group, 'mat-pillow-support', [0, 0.1, -0.72], [0.5, 0.07, 0.24], ROOM_WHITE));
  } else if (prop === 'tub') {
    // SHAPES.tub, home-scene.ts: W=2, D=1; support is the actual inner floor/base top.
    support.push(box(group, 'tub-interior-floor', [0, 0.08, 0], [1.8, 0.12, 0.8], '#f1f1ec'));
    for (const side of [-1, 1]) {
      box(group, `tub-wall-x-${side}`, [side * 0.84, 0.3, 0], [0.12, 0.48, 0.8], '#f1f1ec');
      box(group, `tub-wall-z-${side}`, [0, 0.3, side * 0.36], [1.8, 0.48, 0.16], '#f1f1ec');
    }
    box(group, 'tub-water-visual', [0, 0.5, 0], [1.56, 0.04, 0.6], '#bfe3ee');
    const tap = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.26, 8), new THREE.MeshStandardMaterial({ color: STEEL, metalness: 0.55, roughness: 0.32 }));
    tap.name = 'tub-tap'; tap.position.set(-0.76, 0.66, 0); group.add(tap);
  } else {
    // SHAPES.shower, home-scene.ts: 1×1 tray, two partitions and the source head at 1.98 tiles.
    support.push(box(group, 'shower-tray-support', [0, 0.04, 0], [0.9, 0.08, 0.9], ROOM_WHITE));
    box(group, 'shower-partition-left', [-0.44, 1.03, 0], [0.03, 1.9, 0.9], '#bfd6dc');
    box(group, 'shower-partition-back', [0, 1.03, -0.44], [0.9, 1.9, 0.03], '#bfd6dc');
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.9, 8), new THREE.MeshStandardMaterial({ color: STEEL, metalness: 0.5, roughness: 0.35 }));
    pipe.name = 'shower-pipe'; pipe.position.set(-0.32, 1.02, -0.32); group.add(pipe);
    headZoneMesh = box(group, 'shower-head-source', [-0.2, 1.98, -0.2], [0.24, 0.04, 0.24], STEEL);
  }
  const surface: NativeRestPropSurface = Object.freeze({
    id, pose, prop,
      surfaceYAt: (x: number, z: number) => {
        group.updateWorldMatrix(true, false); group.updateMatrixWorld(true);
        const ceilingTiles = prop === 'tub' ? 0.15 : prop === 'shower' ? 0.1 : prop === 'mat' ? 0.15 : 0.65;
        const high = group.localToWorld(new THREE.Vector3(0, ceilingTiles, 0)).y;
        const low = group.localToWorld(new THREE.Vector3(0, -0.02, 0)).y;
        return surfaceY(support, x, z, Math.min(low, high), Math.max(low, high));
      },
      ...(headZoneMesh ? { headZone: Object.freeze({ contains: (point: THREE.Vector3) => {
      group.updateWorldMatrix(true, false); group.updateMatrixWorld(true);
      const local = group.worldToLocal(point.clone());
      // Exact home-scene source predicate in item-local tile units, including mount rotation.
      return Math.abs(local.x + 0.2) <= 0.2
        && Math.abs(local.z + 0.2) <= 0.2
        && local.y >= 1.98 - 0.65
        && local.y <= 1.98 + 0.02;
    } }) } : {}),
  });
  let disposed = false;
  return Object.freeze({
    prop, group, supportSurface: surface,
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) material.dispose();
        }
      });
    },
  });
}
