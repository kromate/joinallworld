import * as THREE from 'three';

export type AuthoredHairStyle = 'short' | 'bun';

/** Bounds measured on cm_vitruvian_1 in expressive-head-lod.glb (native scene coordinates). */
export const AUTHORED_HEAD_BOUNDS = new THREE.Box3(
  new THREE.Vector3(-0.0979931578040123, 1.4583238363265991, -0.13642708584666252),
  new THREE.Vector3(0.0979931578040123, 1.757686972618103, 0.10583589598536491),
);

/** Build one merged, native-coordinate hair mesh for an authored head adapter to attach. */
export function createAuthoredHair(style: AuthoredHairStyle, color: string, seed: string): {
  readonly object: THREE.Object3D;
  readonly triangles: number;
  readonly drawCalls: number;
  dispose(): void;
} {
  const headBounds = AUTHORED_HEAD_BOUNDS;
  if (headBounds.isEmpty() || !headBounds.min.toArray().concat(headBounds.max.toArray()).every(Number.isFinite)) {
    throw new Error('Authored hair requires finite native head bounds');
  }
  const width = headBounds.max.x - headBounds.min.x;
  const height = headBounds.max.y - headBounds.min.y;
  const depth = headBounds.max.z - headBounds.min.z;
  if (width < 0.08 || height < 0.16 || depth < 0.1) throw new Error('Authored head bounds are too small for fitted hair');

  const centreX = (headBounds.min.x + headBounds.max.x) * 0.5;
  // The authored face points toward +Z; bias the scalp volume slightly forward so
  // the hairline rests on the forehead instead of hovering behind it.
  const centreZ = (headBounds.min.z + headBounds.max.z) * 0.5 + depth * 0.025;
  const scalpRx = width * 0.43;
  const scalpRz = depth * 0.4;
  const hairlineY = headBounds.max.y - height * 0.17;
  const crownY = headBounds.max.y + height * 0.075;
  const crownHeight = crownY - hairlineY;
  const seedValue = [...seed].reduce((value, character) => (value * 33 + character.charCodeAt(0)) >>> 0, 5381);
  const phase = (seedValue / 0x100000000) * Math.PI * 2;
  const positions: number[] = [], colours: number[] = [], indices: number[] = [];
  const baseColor = new THREE.Color(color);

  const pushVertex = (point: THREE.Vector3, brightness = 1): number => {
    const index = positions.length / 3;
    positions.push(point.x, point.y, point.z);
    const color = baseColor.clone().multiplyScalar(brightness);
    colours.push(color.r, color.g, color.b);
    return index;
  };
  const connectRows = (rows: number[][], reverse = false): void => {
    const columns = rows[0]?.length ?? 0;
    for (let row = 0; row < rows.length - 1; row++) {
      for (let column = 0; column < columns; column++) {
        const next = (column + 1) % columns;
        const a = rows[row]![column]!, b = rows[row + 1]![column]!;
        const c = rows[row + 1]![next]!, d = rows[row]![next]!;
        if (reverse) indices.push(a, c, b, a, d, c);
        else indices.push(a, b, c, a, c, d);
      }
    }
  };

  // A single 96-column cap provides a continuous hairline and an integrated curl
  // silhouette. Shared vertices and computed normals avoid the beveled-bead look.
  const ringSegments = 96;
  const profile = [
    [0, 0.82, 0.8], [0.1, 0.94, 0.9], [0.28, 1, 0.99], [0.5, 1.04, 1.02],
    [0.7, 0.96, 0.92], [0.86, 0.75, 0.7], [0.96, 0.44, 0.4], [1, 0.018, 0.018],
  ] as const;
  const amplitude = style === 'short' ? 0.062 : 0.022;
  const curlWave = (angle: number, t: number): number => Math.sin(Math.PI * t) * amplitude * (
    0.55 * Math.sin(angle * 12 + phase + t * 5.8)
    + 0.3 * Math.sin(angle * 20 - phase * 0.7 - t * 7.2)
    + 0.15 * Math.sin(angle * 31 + phase * 0.43 + t * 9.1)
  );
  const profileAt = (t: number): readonly [number, number] => {
    for (let i = 0; i < profile.length - 1; i++) {
      const a = profile[i]!, b = profile[i + 1]!;
      if (t <= b[0]) {
        const mix = (t - a[0]) / (b[0] - a[0]);
        return [THREE.MathUtils.lerp(a[1], b[1], mix), THREE.MathUtils.lerp(a[2], b[2], mix)];
      }
    }
    return [profile.at(-1)![1], profile.at(-1)![2]];
  };
  const scalpPoint = (angle: number, t: number): THREE.Vector3 => {
    const [xScale, zScale] = profileAt(t), wave = curlWave(angle, t);
    return new THREE.Vector3(centreX + Math.cos(angle) * scalpRx * xScale * (1 + wave),
      hairlineY + t * crownHeight, centreZ + Math.sin(angle) * scalpRz * zScale * (1 + wave));
  };
  const capRows = profile.map(([t]) => {
    const envelope = Math.sin(Math.PI * t);
    return Array.from({length: ringSegments}, (_, column) => {
      const angle = column * Math.PI * 2 / ringSegments;
      const brightness = 0.94 + 0.055 * Math.sin(angle * 12 + phase + t * 5.8) * envelope;
      return pushVertex(scalpPoint(angle, t), brightness);
    });
  });
  connectRows(capRows);
  const crownTip = pushVertex(new THREE.Vector3(centreX, crownY, centreZ), 0.99);
  const finalRing = capRows[capRows.length - 1]!;
  for (let column = 0; column < ringSegments; column++) {
    indices.push(finalRing[column]!, crownTip, finalRing[(column + 1) % ringSegments]!);
  }

  const addCurl = (anchor: THREE.Vector3, normal: THREE.Vector3, tangent: THREE.Vector3, radius: number, thickness: number, curlPhase: number): void => {
    const across = new THREE.Vector3().crossVectors(normal, tangent).normalize();
    const rows = Array.from({length: 5}, (_, step) => {
      const t = step / 4, theta = curlPhase + t * Math.PI * 1.75;
      const centre = anchor.clone()
        .addScaledVector(tangent, Math.cos(theta) * radius)
        .addScaledVector(across, Math.sin(theta) * radius)
        .addScaledVector(normal, Math.sin(theta * 2 + curlPhase) * radius * 0.12);
      const direction = tangent.clone().multiplyScalar(-Math.sin(theta))
        .addScaledVector(across, Math.cos(theta)).normalize();
      const side = new THREE.Vector3().crossVectors(direction, normal).normalize();
      const up = new THREE.Vector3().crossVectors(direction, side).normalize();
      return Array.from({length: 6}, (_, column) => {
        const around = column * Math.PI / 3;
        return pushVertex(centre.clone()
          .addScaledVector(side, Math.cos(around) * thickness)
          .addScaledVector(up, Math.sin(around) * thickness),
        0.92 + 0.1 * Math.sin(theta * 2 + curlPhase));
      });
    });
    connectRows(rows, true);
  };

  if (style === 'short') {
    // Ninety short, bent ringlets lie against the cap in a staggered scalp grid.
    // Their ends sink into the shell, leaving a filled silhouette rather than loose beads.
    const rowCount = 6, columnCount = 15;
    for (let row = 0; row < rowCount; row++) for (let column = 0; column < columnCount; column++) {
      const t = 0.16 + row * 0.105 + ((column * 17 + row * 11) % 7) * 0.003;
      const angle = (column + (row % 2) * 0.5) * Math.PI * 2 / columnCount + phase * 0.17;
      const radial = new THREE.Vector3(Math.cos(angle), 0.22 + t * 0.35, Math.sin(angle)).normalize();
      const tangent = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle)).normalize();
      addCurl(scalpPoint(angle, t).addScaledVector(radial, 0.0012), radial, tangent, 0.008, 0.0018, phase + row * 0.71 + column * 1.37);
    }
  }

  if (style === 'bun') {
    const bunCentre = new THREE.Vector3(centreX, crownY - crownHeight * 0.06, centreZ - scalpRz * 0.42);
    const rx = scalpRx * 0.34, ry = crownHeight * 0.26, rz = scalpRz * 0.34;
    const bunRows = Array.from({length: 15}, (_, row) => {
      const phi = Math.PI * row / 14;
      return Array.from({length: 32}, (_, column) => {
        const theta = Math.PI * 2 * column / 32;
        return pushVertex(new THREE.Vector3(
          bunCentre.x + Math.sin(phi) * Math.cos(theta) * rx,
          bunCentre.y + Math.cos(phi) * ry,
          bunCentre.z + Math.sin(phi) * Math.sin(theta) * rz,
        ), 0.96 + 0.04 * Math.sin(theta * 3 + phi * 2));
      });
    });
    connectRows(bunRows, true);
    // Individual curled locks replace the smooth bun coil, but stay within its bun volume.
    for (let row = 0; row < 6; row++) for (let column = 0; column < 8; column++) {
      const phi = 0.48 + row * 0.42, theta = column * Math.PI / 4 + (row % 2) * Math.PI / 8;
      const normal = new THREE.Vector3(Math.sin(phi) * Math.cos(theta) / rx, Math.cos(phi) / ry,
        Math.sin(phi) * Math.sin(theta) / rz).normalize();
      const tangent = new THREE.Vector3(-Math.sin(theta), 0, Math.cos(theta)).normalize();
      const anchor = bunCentre.clone().add(new THREE.Vector3(rx * Math.sin(phi) * Math.cos(theta),
        ry * Math.cos(phi), rz * Math.sin(phi) * Math.sin(theta))).addScaledVector(normal, 0.001);
      addCurl(anchor, normal, tangent, 0.005, 0.0016, phase + row * 0.83 + column * 1.19);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.76, metalness: 0});
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `authored-hair-${style}`;
  mesh.userData.triangles = indices.length / 3;
  mesh.userData.nativeBounds = {min: headBounds.min.toArray(), max: headBounds.max.toArray()};
  const group = new THREE.Group();
  group.name = `authored-hair-${style}`;
  group.add(mesh);
  return {
    object: group,
    triangles: indices.length / 3,
    drawCalls: 1,
    dispose() { geometry.dispose(); material.dispose(); group.removeFromParent(); },
  };
}
