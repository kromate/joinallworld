/**
 * OWNER: scenes
 * Reusable procedural props (trees, lamps, and whatever venues need next). Each prop is a
 * function (kit, parent, ...position) that adds meshes to `parent` through the kit.
 */

/** tree(kit, parent, x, z, size = 1) */
export function tree(kit, parent, x, z, size = 1) {
  const { round, mesh, crownGeometry } = kit;
  round(x, 1.45 * size, z, 0.25 * size, 2.9 * size, '#635141', parent);
  mesh(crownGeometry, x, 3.6 * size, z, 1.8 * size, 2.3 * size, 1.7 * size, '#2b6957', parent);
  mesh(crownGeometry, x + 0.8 * size, 4.1 * size, z - 0.3, 1.35 * size, 1.5 * size, 1.3 * size, '#39775b', parent);
}

/** lamp(kit, parent, x, z) — a street lamp with a warm point light */
export function lamp(kit, parent, x, z) {
  const { THREE, round, box } = kit;
  round(x, 2, z, 0.065, 4, '#344441', parent);
  box(x, 4.1, z, 0.44, 0.65, 0.44, '#ffe2a2', parent, true);
  box(x, 4.48, z, 0.65, 0.12, 0.65, '#394a43', parent);
  const light = new THREE.PointLight('#ffc878', 23, 12, 1.5);
  light.position.set(x, 3.8, z);
  parent.add(light);
}
