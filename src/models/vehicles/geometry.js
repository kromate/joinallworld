import * as THREE from 'three';

/** @typedef {'map' | 'street' | 'showcase'} VehicleDetail */

/** @type {Readonly<Record<VehicleDetail, { radialSegments: number, text: boolean, trim: boolean }>>} */
export const DETAIL = Object.freeze({
  map: Object.freeze({ radialSegments: 4, text: false, trim: false }),
  street: Object.freeze({ radialSegments: 8, text: true, trim: true }),
  showcase: Object.freeze({ radialSegments: 12, text: true, trim: true }),
});

const FONT = Object.freeze({
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101111011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100110101010', 7: '111001010010010', 8: '111101111101111',
  9: '111101111001110', '-': '000000111000000', '.': '000000000000010', '/': '001001010100100',
});

/**
 * A coloured primitive waiting to be merged into one static draw call.
 * @typedef {{ geometry: THREE.BufferGeometry, color: THREE.Color }} ColoredGeometry
 */

/**
 * Add a transformed box to a static geometry list.
 * @param {ColoredGeometry[]} target
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} width
 * @param {number} height
 * @param {number} depth
 * @param {THREE.ColorRepresentation} color
 * @param {{ rx?: number, ry?: number, rz?: number }} [rotation]
 * @returns {void}
 */
export function box(target, x, y, z, width, height, depth, color, rotation = {}) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometry.rotateX(rotation.rx || 0);
  geometry.rotateY(rotation.ry || 0);
  geometry.rotateZ(rotation.rz || 0);
  geometry.translate(x, y, z);
  target.push({ geometry, color: new THREE.Color(color) });
}

/**
 * Add a transformed cylinder to a static geometry list.
 * @param {ColoredGeometry[]} target
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} radius
 * @param {number} length
 * @param {THREE.ColorRepresentation} color
 * @param {{ segments?: number, rx?: number, ry?: number, rz?: number, topScale?: number }} [options]
 * @returns {void}
 */
export function cylinder(target, x, y, z, radius, length, color, options = {}) {
  const topRadius = radius * (options.topScale === undefined ? 1 : options.topScale);
  const geometry = new THREE.CylinderGeometry(topRadius, radius, length, options.segments || 8, 1, false);
  geometry.rotateX(options.rx || 0);
  geometry.rotateY(options.ry || 0);
  geometry.rotateZ(options.rz || 0);
  geometry.translate(x, y, z);
  target.push({ geometry, color: new THREE.Color(color) });
}

/**
 * Add a transformed torus or partial torus to a static geometry list.
 * @param {ColoredGeometry[]} target
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} radius
 * @param {number} tube
 * @param {THREE.ColorRepresentation} color
 * @param {{ radialSegments?: number, tubularSegments?: number, arc?: number, rx?: number, ry?: number, rz?: number }} [options]
 * @returns {void}
 */
export function torus(target, x, y, z, radius, tube, color, options = {}) {
  const geometry = new THREE.TorusGeometry(
    radius,
    tube,
    options.radialSegments || 4,
    options.tubularSegments || 8,
    options.arc === undefined ? Math.PI * 2 : options.arc,
  );
  geometry.rotateX(options.rx || 0);
  geometry.rotateY(options.ry || 0);
  geometry.rotateZ(options.rz || 0);
  geometry.translate(x, y, z);
  target.push({ geometry, color: new THREE.Color(color) });
}

/**
 * Add a side-profile prism. Points are `[z, y]`, ordered around the silhouette.
 * @param {ColoredGeometry[]} target
 * @param {ReadonlyArray<readonly [number, number]>} profile
 * @param {number} width
 * @param {THREE.ColorRepresentation} color
 * @param {{ x?: number, y?: number, z?: number, ry?: number }} [transform]
 * @returns {void}
 */
export function profilePrism(target, profile, width, color, transform = {}) {
  const count = profile.length;
  const positions = [];
  const pushTriangle = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  };
  const half = width / 2;
  for (let i = 1; i < count - 1; i += 1) {
    pushTriangle(-half, profile[0][1], profile[0][0], -half, profile[i][1], profile[i][0], -half, profile[i + 1][1], profile[i + 1][0]);
    pushTriangle(half, profile[0][1], profile[0][0], half, profile[i + 1][1], profile[i + 1][0], half, profile[i][1], profile[i][0]);
  }
  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count;
    const az = profile[i][0], ay = profile[i][1], bz = profile[next][0], by = profile[next][1];
    pushTriangle(-half, ay, az, half, ay, az, half, by, bz);
    pushTriangle(-half, ay, az, half, by, bz, -half, by, bz);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.rotateY(transform.ry || 0);
  geometry.translate(transform.x || 0, transform.y || 0, transform.z || 0);
  target.push({ geometry, color: new THREE.Color(color) });
}

/**
 * Add centred 3 by 5 block lettering facing positive z.
 * @param {ColoredGeometry[]} target
 * @param {string} text
 * @param {{ x: number, y: number, z: number, height: number, color: THREE.ColorRepresentation }} options
 * @returns {void}
 */
export function blockText(target, text, options) {
  const value = String(text).toUpperCase().slice(0, 12);
  const cell = options.height / 5;
  const width = Math.max(0, value.length * 4 - 1) * cell;
  for (let i = 0; i < value.length; i += 1) {
    const glyph = FONT[value[i]];
    if (!glyph) continue;
    const left = options.x - width / 2 + i * 4 * cell;
    for (let row = 0; row < 5; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        if (glyph[row * 3 + column] !== '1') continue;
        let run = 1;
        while (column + run < 3 && glyph[row * 3 + column + run] === '1') run += 1;
        const x = left + (column + run / 2) * cell;
        const y = options.y + options.height / 2 - (row + 0.5) * cell;
        const halfWidth = run * cell / 2;
        const halfHeight = cell / 2;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute([
          x - halfWidth, y - halfHeight, options.z,
          x + halfWidth, y - halfHeight, options.z,
          x + halfWidth, y + halfHeight, options.z,
          x - halfWidth, y - halfHeight, options.z,
          x + halfWidth, y + halfHeight, options.z,
          x - halfWidth, y + halfHeight, options.z,
        ], 3));
        geometry.computeVertexNormals();
        target.push({ geometry, color: new THREE.Color(options.color) });
        column += run - 1;
      }
    }
  }
}

/**
 * Merge coloured primitives into one non-indexed geometry with vertex colours.
 * Source geometries are disposed during the merge.
 * @param {ColoredGeometry[]} source
 * @returns {THREE.BufferGeometry}
 */
export function mergeColored(source) {
  let vertexCount = 0;
  for (const item of source) vertexCount += item.geometry.index ? item.geometry.index.count : item.geometry.attributes.position.count;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  let offset = 0;
  for (const item of source) {
    const geometry = item.geometry.index ? item.geometry.toNonIndexed() : item.geometry;
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    for (let i = 0; i < position.count; i += 1) {
      const at = (offset + i) * 3;
      positions[at] = position.getX(i);
      positions[at + 1] = position.getY(i);
      positions[at + 2] = position.getZ(i);
      normals[at] = normal.getX(i);
      normals[at + 1] = normal.getY(i);
      normals[at + 2] = normal.getZ(i);
      colors[at] = item.color.r;
      colors[at + 1] = item.color.g;
      colors[at + 2] = item.color.b;
    }
    offset += position.count;
    if (geometry !== item.geometry) geometry.dispose();
    item.geometry.dispose();
  }
  source.length = 0;
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Count rendered triangles for indexed or non-indexed geometry.
 * @param {THREE.BufferGeometry} geometry
 * @returns {number}
 */
export function geometryTriangles(geometry) {
  return (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
}
