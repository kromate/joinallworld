/**
 * OWNER: foundation
 * Shared geometry/material cache handed to every scene builder. All art is procedural: unit
 * primitives scaled per mesh, and one material per colour, so a whole venue costs a handful of
 * GPU resources.
 *
 * WHO FREES WHAT
 *   Meshes made through the kit (box, round, sphere, mesh) share the kit's geometries and
 *   materials; kit.dispose() frees those. A scene may instead bake its own merged meshes
 *   (src/scene/build.ts): it then returns dispose(), which the host calls when the player
 *   leaves the venue and when the host itself is disposed. Anything that must outlive one scene
 *   (shared materials) registers a clean-up with kit.onDispose(fn).
 */
import * as THREE from 'three';
import type { Colour } from './types.ts';

/** matte: build Lambert materials instead of Standard ones (the cheaper-scenery flag, src/scene/look.ts matteScenery(); default off). */
export interface Kit {
  THREE: typeof THREE;
  matte: boolean;
  material(color: Colour, glow?: boolean): THREE.MeshLambertMaterial | THREE.MeshStandardMaterial;
  mesh(geometry: THREE.BufferGeometry, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: Colour, parent: THREE.Object3D, glow?: boolean): THREE.Mesh;
  boxGeometry: THREE.BoxGeometry;
  sphereGeometry: THREE.SphereGeometry;
  cylinderGeometry: THREE.CylinderGeometry;
  crownGeometry: THREE.IcosahedronGeometry;
  /** Run `fn` when the kit is disposed. Returns a function that withdraws it. */
  onDispose(fn: () => void): () => boolean;
  /** Run `fn(material)` on every material the kit has made and on each one it makes from now on (the host's see-through patch). */
  eachMaterial(fn: (material: THREE.Material) => void): void;
  /** box(x, y, z, width, height, depth, colour, parent, glow?) */
  box(x: number, y: number, z: number, w: number, h: number, d: number, c: Colour, p: THREE.Object3D, glow?: boolean): THREE.Mesh;
  /** round(x, y, z, radius, height, colour, parent, glow?) — an upright cylinder */
  round(x: number, y: number, z: number, r: number, h: number, c: Colour, p: THREE.Object3D, glow?: boolean): THREE.Mesh;
  /** sphere(x, y, z, radius, colour, parent) */
  sphere(x: number, y: number, z: number, r: number, c: Colour, p: THREE.Object3D): THREE.Mesh;
  dispose(): void;
}

export function createKit({ matte = false }: { matte?: boolean } = {}): Kit {
  const materials = new Map<string, THREE.MeshLambertMaterial | THREE.MeshStandardMaterial>();
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const sphereGeometry = new THREE.SphereGeometry(1, 9, 7);
  const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 9);
  const crownGeometry = new THREE.IcosahedronGeometry(1, 0);
  const geometries: THREE.BufferGeometry[] = [boxGeometry, sphereGeometry, cylinderGeometry, crownGeometry];
  let prepare: ((material: THREE.Material) => void) | null = null;
  function material(color: Colour, glow = false) {
    const key = `${color}:${glow}`;
    if (!materials.has(key)) {
      const made = matte ? new THREE.MeshLambertMaterial({ color, ...(glow ? { emissive: color, emissiveIntensity: 1.3 } : {}) })
        : new THREE.MeshStandardMaterial({ color, roughness: 0.92, ...(glow ? { emissive: color, emissiveIntensity: 1.3 } : {}) });
      prepare?.(made);
      materials.set(key, made);
    }
    return materials.get(key) as THREE.MeshLambertMaterial | THREE.MeshStandardMaterial;
  }
  function mesh(geometry: THREE.BufferGeometry, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: Colour, parent: THREE.Object3D, glow = false) {
    const object = new THREE.Mesh(geometry, material(color, glow));
    object.position.set(x, y, z);
    object.scale.set(sx, sy, sz);
    object.castShadow = !glow;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }
  const cleanups = new Set<() => void>();
  let disposed = false;
  return {
    THREE, matte, material, mesh, boxGeometry, sphereGeometry, cylinderGeometry, crownGeometry,
    /** Run `fn` when the kit is disposed. Returns a function that withdraws it. */
    onDispose(fn: () => void) {
      if (disposed) { fn(); return () => false; }
      cleanups.add(fn);
      return () => cleanups.delete(fn);
    },
    /** Run `fn(material)` on every material the kit has made and on each one it makes from now on (the host's see-through patch). */
    eachMaterial(fn: (material: THREE.Material) => void) { prepare = fn; materials.forEach((item) => fn(item)); },
    /** box(x, y, z, width, height, depth, colour, parent, glow?) */
    box: (x, y, z, w, h, d, c, p, glow) => mesh(boxGeometry, x, y, z, w, h, d, c, p, glow),
    /** round(x, y, z, radius, height, colour, parent, glow?) — an upright cylinder */
    round: (x, y, z, r, h, c, p, glow) => mesh(cylinderGeometry, x, y, z, r, h, r, c, p, glow),
    /** sphere(x, y, z, radius, colour, parent) */
    sphere: (x, y, z, r, c, p) => mesh(sphereGeometry, x, y, z, r, r, r, c, p),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const fn of [...cleanups]) { cleanups.delete(fn); fn(); }
      geometries.forEach((geometry) => geometry.dispose()); materials.forEach((item) => item.dispose());
    },
  };
}
