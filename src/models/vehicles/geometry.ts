import * as THREE from 'three';

export type VehicleDetail = 'map' | 'street' | 'showcase';

export interface DetailQuality {
  radialSegments: number;
  text: boolean;
  trim: boolean;
}

export const DETAIL: Readonly<Record<VehicleDetail, DetailQuality>> = Object.freeze({
  map: Object.freeze({ radialSegments: 4, text: false, trim: false }),
  street: Object.freeze({ radialSegments: 8, text: true, trim: true }),
  showcase: Object.freeze({ radialSegments: 12, text: true, trim: true }),
});

const FONT: Readonly<Record<string, string>> = Object.freeze({
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101111011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100110101010', 7: '111001010010010', 8: '111101111101111',
  9: '111101111001110', '-': '000000111000000', '.': '000000000000010', '/': '001001010100100',
});

/** A coloured primitive waiting to be merged into one static draw call. */
export interface ColoredGeometry {
  geometry: THREE.BufferGeometry;
  color: THREE.Color;
}

/**
 * Add a transformed box to a static geometry list.
 */
export function box(target: ColoredGeometry[], x: number, y: number, z: number, width: number, height: number, depth: number, color: THREE.ColorRepresentation, rotation: { rx?: number; ry?: number; rz?: number } = {}): void {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometry.rotateX(rotation.rx || 0);
  geometry.rotateY(rotation.ry || 0);
  geometry.rotateZ(rotation.rz || 0);
  geometry.translate(x, y, z);
  target.push({ geometry, color: new THREE.Color(color) });
}

/**
 * Add a transformed cylinder to a static geometry list.
 */
export function cylinder(target: ColoredGeometry[], x: number, y: number, z: number, radius: number, length: number, color: THREE.ColorRepresentation, options: { segments?: number; rx?: number; ry?: number; rz?: number; topScale?: number } = {}): void {
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
 */
export function torus(target: ColoredGeometry[], x: number, y: number, z: number, radius: number, tube: number, color: THREE.ColorRepresentation, options: { radialSegments?: number; tubularSegments?: number; arc?: number; rx?: number; ry?: number; rz?: number } = {}): void {
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
 */
export function profilePrism(target: ColoredGeometry[], profile: ReadonlyArray<readonly [number, number]>, width: number, color: THREE.ColorRepresentation, transform: { x?: number; y?: number; z?: number; ry?: number } = {}): void {
  const count = profile.length;
  const positions: number[] = [];
  const pushTriangle = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): void => {
    positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  };
  const half = width / 2;
  // Indices below are always in range; the throw only satisfies noUncheckedIndexedAccess.
  const at = (index: number): readonly [number, number] => {
    const point = profile[index];
    if (!point) throw new RangeError(`Profile point ${index} is missing`);
    return point;
  };
  for (let i = 1; i < count - 1; i += 1) {
    const first = at(0), current = at(i), following = at(i + 1);
    pushTriangle(-half, first[1], first[0], -half, current[1], current[0], -half, following[1], following[0]);
    pushTriangle(half, first[1], first[0], half, following[1], following[0], half, current[1], current[0]);
  }
  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count;
    const from = at(i), to = at(next);
    const az = from[0], ay = from[1], bz = to[0], by = to[1];
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
 */
export function blockText(target: ColoredGeometry[], text: string, options: { x: number; y: number; z: number; height: number; color: THREE.ColorRepresentation }): void {
  const value = String(text).toUpperCase().slice(0, 12);
  const cell = options.height / 5;
  const width = Math.max(0, value.length * 4 - 1) * cell;
  for (let i = 0; i < value.length; i += 1) {
    const character = value[i];
    const glyph = character === undefined ? undefined : FONT[character];
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

/** Read a required attribute; a missing one is a malformed primitive (the original would throw a TypeError on it). */
function attribute(geometry: THREE.BufferGeometry, name: 'position' | 'normal'): THREE.BufferAttribute | THREE.InterleavedBufferAttribute {
  const found = geometry.attributes[name];
  if (!found) throw new TypeError(`Geometry has no ${name} attribute`);
  return found;
}

/**
 * Merge coloured primitives into one non-indexed geometry with vertex colours.
 * Source geometries are disposed during the merge.
 */
export function mergeColored(source: ColoredGeometry[]): THREE.BufferGeometry {
  let vertexCount = 0;
  for (const item of source) vertexCount += item.geometry.index ? item.geometry.index.count : attribute(item.geometry, 'position').count;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  let offset = 0;
  for (const item of source) {
    const geometry = item.geometry.index ? item.geometry.toNonIndexed() : item.geometry;
    const position = attribute(geometry, 'position');
    const normal = attribute(geometry, 'normal');
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
 */
export function geometryTriangles(geometry: THREE.BufferGeometry): number {
  return (geometry.index ? geometry.index.count : attribute(geometry, 'position').count) / 3;
}
