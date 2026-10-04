/**
 * OWNER: foundation
 * Shared geometry/material cache handed to every scene builder. All art is procedural: unit
 * primitives scaled per mesh, and one material per colour, so a whole venue costs a handful of
 * GPU resources. Builders must create meshes only through the kit so dispose() can free them.
 */
import * as THREE from 'three';

export function createKit() {
  const materials = new Map();
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const sphereGeometry = new THREE.SphereGeometry(1, 9, 7);
  const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 9);
  const crownGeometry = new THREE.IcosahedronGeometry(1, 0);
  const geometries = [boxGeometry, sphereGeometry, cylinderGeometry, crownGeometry];
  function material(color, glow = false) {
    const key = `${color}:${glow}`;
    if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.92, ...(glow ? { emissive: color, emissiveIntensity: 1.3 } : {}) }));
    return materials.get(key);
  }
  function mesh(geometry, x, y, z, sx, sy, sz, color, parent, glow = false) {
    const object = new THREE.Mesh(geometry, material(color, glow));
    object.position.set(x, y, z);
    object.scale.set(sx, sy, sz);
    object.castShadow = !glow;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }
  return {
    THREE, material, mesh, boxGeometry, sphereGeometry, cylinderGeometry, crownGeometry,
    /** box(x, y, z, width, height, depth, colour, parent, glow?) */
    box: (x, y, z, w, h, d, c, p, glow) => mesh(boxGeometry, x, y, z, w, h, d, c, p, glow),
    /** round(x, y, z, radius, height, colour, parent, glow?) — an upright cylinder */
    round: (x, y, z, r, h, c, p, glow) => mesh(cylinderGeometry, x, y, z, r, h, r, c, p, glow),
    /** sphere(x, y, z, radius, colour, parent) */
    sphere: (x, y, z, r, c, p) => mesh(sphereGeometry, x, y, z, r, r, r, c, p),
    dispose() { geometries.forEach((geometry) => geometry.dispose()); materials.forEach((item) => item.dispose()); },
  };
}
