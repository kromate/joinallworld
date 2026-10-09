import * as THREE from 'three';

/** Presentation colors are deliberately separate from the authored skin/eye materials. */
export interface CharacterPresentationLook {
  readonly shirtColor?: THREE.ColorRepresentation;
  readonly trouserColor?: THREE.ColorRepresentation;
  /** Accept the current normalized avatar-look shape used by the experiment viewer. */
  readonly outfitColor?: THREE.ColorRepresentation;
  readonly bottomsColor?: THREE.ColorRepresentation;
  readonly hairColor?: THREE.ColorRepresentation;
  readonly hair?: string;
  readonly hairstyle?: 'short-curls' | 'curly-bun';
  readonly seed?: string;
}

export interface CharacterPresentationMetrics {
  readonly hiddenBodyTriangles: number;
  readonly shirtTriangles: number;
  readonly trouserTriangles: number;
  readonly scalpTriangles: number;
  readonly curlTriangles: number;
  readonly drawCalls: number;
  readonly generatedAttributeBytes: number;
}

export interface CharacterPresentation {
  readonly metrics: CharacterPresentationMetrics;
  dispose(): void;
}

type Face = readonly [number, number, number];
type Vector = readonly [number, number, number];
type CurlAnchor = { readonly face: Face; readonly point: THREE.Vector3; readonly normal: THREE.Vector3; readonly phase: number; readonly size: number; readonly depth: number };

const AUTHORED_HEAD_TOP = 1.6675;
const HAIR_CAP_TRIANGLE_LIMIT = 3_500;
const HAIR_TRIANGLE_LIMIT = 7_000;
const CURL_SIDES = 6;
const CURL_SEGMENTS = 6;

function component(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, index: number, axis: number): number {
  return axis === 0 ? attribute.getX(index) : axis === 1 ? attribute.getY(index) : axis === 2 ? attribute.getZ(index) : attribute.getW(index);
}

function tuple(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, index: number): Vector {
  return [attribute.getX(index), attribute.getY(index), attribute.getZ(index)];
}

function averagePoint(position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, face: Face): THREE.Vector3 {
  return new THREE.Vector3(
    (position.getX(face[0]) + position.getX(face[1]) + position.getX(face[2])) / 3,
    (position.getY(face[0]) + position.getY(face[1]) + position.getY(face[2])) / 3,
    (position.getZ(face[0]) + position.getZ(face[1]) + position.getZ(face[2])) / 3,
  );
}

function faceNormal(normal: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, face: Face): THREE.Vector3 {
  return new THREE.Vector3(
    normal.getX(face[0]) + normal.getX(face[1]) + normal.getX(face[2]),
    normal.getY(face[0]) + normal.getY(face[1]) + normal.getY(face[2]),
    normal.getZ(face[0]) + normal.getZ(face[1]) + normal.getZ(face[2]),
  ).normalize();
}

function boneMass(mesh: THREE.SkinnedMesh, face: Face, predicate: (name: string) => boolean): number {
  const indices = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
  if (!indices || !weights) return 0;
  let total = 0;
  for (const vertex of face) {
    for (let lane = 0; lane < 4; lane++) {
      const bone = mesh.skeleton.bones[Math.round(component(indices, vertex, lane))];
      if (bone && predicate(bone.name.toLowerCase())) total += component(weights, vertex, lane) / 3;
    }
  }
  return total;
}

function hasArmInfluence(name: string): boolean {
  return name.includes('shoulder') || /(?:left|right)arm$/.test(name);
}

function hasLegInfluence(name: string): boolean {
  return /(?:upleg|leftleg|rightleg|foot|toebase)$/.test(name);
}

function classifyFace(mesh: THREE.SkinnedMesh, face: Face): 'shirt' | 'trousers' | null {
  const position = mesh.geometry.getAttribute('position');
  if (!position) return null;
  const center = averagePoint(position, face);
  const arm = boneMass(mesh, face, hasArmInfluence);
  const leg = boneMass(mesh, face, hasLegInfluence);

  // Native coordinates measured from parametric-base-expressive.glb: hips y=.912,
  // spine2 y=1.251, neck y=1.407. Regions are whole source triangles, so the
  // hidden body index and its replacement clothing always share exact boundaries.
  const torsoHalfWidth = 0.12 + THREE.MathUtils.clamp((center.y - 0.88) * 0.34, 0, 0.13);
  if (center.y >= 0.89 && center.y <= 1.365 && Math.abs(center.x) <= torsoHalfWidth) return 'shirt';
  if (center.y >= 0.90 && center.y <= 1.22 && Math.abs(center.x) >= 0.11 && Math.abs(center.x) <= 0.315 && arm >= 0.16) return 'shirt';
  if (center.y >= 0.055 && center.y < 0.89 && (leg >= 0.12 || (center.y >= 0.72 && Math.abs(center.x) < 0.145))) return 'trousers';
  return null;
}

function isScalpFace(position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, normal: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, face: Face): boolean {
  const point = averagePoint(position, face), outward = faceNormal(normal, face);
  // Follow the authored scalp triangles directly. Positive Z faces the face in
  // this pinned asset. Keep the forehead below the hairline, leave the ears, and
  // let the surface topology—not radial bins—form the cap boundary.
  if (point.y < 1.455) return false;
  if (outward.z > 0.24 && point.y < 1.555) return false;
  if (Math.abs(point.x) > 0.078 && point.y < 1.49) return false;
  return point.y < AUTHORED_HEAD_TOP + 0.015;
}

function bodySurfaceWrapper(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.name = 'authored-presentation-body-surface';
  for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
  geometry.morphAttributes = { ...source.morphAttributes };
  geometry.morphTargetsRelative = source.morphTargetsRelative;
  for (const group of source.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  geometry.setDrawRange(source.drawRange.start, source.drawRange.count);
  return geometry;
}

function makeSurfaceGeometry(source: THREE.BufferGeometry, faces: readonly Face[], offset: number, name: string): THREE.BufferGeometry {
  const position = source.getAttribute('position'), normal = source.getAttribute('normal'), sourceIndex = source.getIndex();
  if (!position || !normal || !sourceIndex) throw new Error('Presentation requires indexed authored positions, normals, and triangles');
  const moved = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index++) {
    const point = new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index));
    point.addScaledVector(new THREE.Vector3(normal.getX(index), normal.getY(index), normal.getZ(index)).normalize(), offset);
    moved[index * 3] = point.x; moved[index * 3 + 1] = point.y; moved[index * 3 + 2] = point.z;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.name = name;
  for (const [key, attribute] of Object.entries(source.attributes)) geometry.setAttribute(key, key === 'position' ? new THREE.Float32BufferAttribute(moved, 3) : attribute);
  geometry.morphAttributes = { ...source.morphAttributes };
  geometry.morphTargetsRelative = source.morphTargetsRelative;
  const indices = new Uint16Array(faces.length * 3);
  let cursor = 0;
  for (const face of faces) { indices[cursor++] = face[0]; indices[cursor++] = face[1]; indices[cursor++] = face[2]; }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

function copyMorphState(source: THREE.SkinnedMesh, target: THREE.SkinnedMesh): void {
  target.morphTargetDictionary = source.morphTargetDictionary ? { ...source.morphTargetDictionary } : undefined;
  target.morphTargetInfluences = source.morphTargetInfluences ? [...source.morphTargetInfluences] : undefined;
  target.onBeforeRender = () => {
    if (!source.morphTargetInfluences || !target.morphTargetInfluences) return;
    for (let index = 0; index < source.morphTargetInfluences.length; index++) target.morphTargetInfluences[index] = source.morphTargetInfluences[index] ?? 0;
  };
}

function addSkinnedSibling(source: THREE.SkinnedMesh, geometry: THREE.BufferGeometry, material: THREE.Material, name: string): THREE.SkinnedMesh {
  if (!source.parent) throw new Error('Authored body must be attached to its actor root before presentation');
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.name = name;
  mesh.position.copy(source.position); mesh.quaternion.copy(source.quaternion); mesh.scale.copy(source.scale);
  mesh.matrix.copy(source.matrix); mesh.matrixAutoUpdate = source.matrixAutoUpdate;
  mesh.bindMode = source.bindMode;
  mesh.bind(source.skeleton, source.bindMatrix);
  mesh.frustumCulled = source.frustumCulled;
  mesh.castShadow = source.castShadow;
  mesh.receiveShadow = source.receiveShadow;
  mesh.renderOrder = source.renderOrder + 1;
  copyMorphState(source, mesh);
  source.parent.add(mesh);
  return mesh;
}

function deterministic(seed: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index++) state = Math.imul(state ^ seed.charCodeAt(index), 16777619);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function largestConnectedSurface(faces: readonly Face[]): Face[] {
  const edges = new Map<string, number[]>();
  for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
    const face = faces[faceIndex]!;
    for (const [a, b] of [[face[0], face[1]], [face[1], face[2]], [face[2], face[0]]] as const) {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const owners = edges.get(key);
      if (owners) owners.push(faceIndex); else edges.set(key, [faceIndex]);
    }
  }
  const neighbours = Array.from({ length: faces.length }, () => [] as number[]);
  for (const owners of edges.values()) for (const owner of owners) for (const other of owners) {
    if (owner !== other) neighbours[owner]!.push(other);
  }
  const visited = new Uint8Array(faces.length);
  let largest: number[] = [];
  for (let start = 0; start < faces.length; start++) {
    if (visited[start]) continue;
    const component: number[] = [], queue = [start]; visited[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor]!; component.push(current);
      for (const next of neighbours[current]!) if (!visited[next]) { visited[next] = 1; queue.push(next); }
    }
    if (component.length > largest.length) largest = component;
  }
  const keep = new Uint8Array(faces.length);
  for (const index of largest) keep[index] = 1;
  return faces.filter((_, index) => keep[index] === 1);
}

function selectCurlAnchors(mesh: THREE.SkinnedMesh, faces: readonly Face[], desired: number, style: 'short-curls' | 'curly-bun', seed: string): CurlAnchor[] {
  const position = mesh.geometry.getAttribute('position'), normal = mesh.geometry.getAttribute('normal');
  if (!position || !normal) return [];
  const rng = deterministic(seed), candidates = faces.map((face, index) => ({
    face,
    index,
    point: averagePoint(position, face),
    normal: faceNormal(normal, face),
  }));
  const anchors: CurlAnchor[] = [];
  if (candidates.length === 0) return anchors;
  const first = Math.floor(rng() * candidates.length);
  const selected = new Set<number>([first]);
  while (selected.size < Math.min(desired, candidates.length)) {
    let best = -1, bestDistance = -1;
    for (const candidate of candidates) {
      if (selected.has(candidate.index)) continue;
      let closest = Infinity;
      for (const picked of selected) closest = Math.min(closest, candidate.point.distanceToSquared(candidates[picked]!.point));
      if (closest > bestDistance) { best = candidate.index; bestDistance = closest; }
    }
    if (best < 0) break;
    selected.add(best);
  }
  const chosen = [...selected].map(index => candidates[index]!).sort((a, b) => a.index - b.index);
  const back = chosen.filter(candidate => candidate.point.z < -0.005).sort((a, b) => a.point.z - b.point.z);
  const bunBackSet = new Set(back.slice(0, Math.min(16, back.length)).map(item => item.index));
  for (const candidate of chosen) {
    const large = style === 'curly-bun' && bunBackSet.has(candidate.index);
    anchors.push({ face: candidate.face, point: candidate.point, normal: candidate.normal, phase: rng() * Math.PI * 2, size: large ? 1.35 : 0.82 + rng() * 0.32, depth: large ? 0.012 : 0.0018 });
  }
  return anchors;
}

function interpolateWeights(mesh: THREE.SkinnedMesh, face: Face): readonly [readonly number[], readonly number[]] {
  const indices = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
  if (!indices || !weights) throw new Error('Authored scalp is missing skin weights');
  const combined = new Map<number, number>();
  for (const vertex of face) for (let lane = 0; lane < 4; lane++) {
    const bone = Math.round(component(indices, vertex, lane));
    combined.set(bone, (combined.get(bone) ?? 0) + component(weights, vertex, lane) / 3);
  }
  const sorted = [...combined.entries()].filter(([, weight]) => weight > 1e-6).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = sorted.reduce((total, [, weight]) => total + weight, 0);
  if (sum < 0.999 || sum > 1.001) throw new Error(`Scalp sample has non-normalized skin weights (${sum})`);
  return [sorted.map(([bone]) => bone), sorted.map(([, weight]) => weight / sum)];
}

function createCurlGeometry(mesh: THREE.SkinnedMesh, anchors: readonly CurlAnchor[]): THREE.BufferGeometry {
  const sourceMorphs = mesh.geometry.morphAttributes.position ?? [];
  const verticesPerCurl = (CURL_SEGMENTS + 1) * CURL_SIDES;
  const vertexCount = anchors.length * verticesPerCurl;
  const positions = new Float32Array(vertexCount * 3), normals = new Float32Array(vertexCount * 3);
  const skinIndices = new Uint16Array(vertexCount * 4), skinWeights = new Float32Array(vertexCount * 4);
  const uv = new Float32Array(vertexCount * 2), indices = new Uint16Array(anchors.length * CURL_SEGMENTS * CURL_SIDES * 6);
  const morphPositions = sourceMorphs.map(() => new Float32Array(vertexCount * 3));
  const position = mesh.geometry.getAttribute('position'), sourceNormals = mesh.geometry.getAttribute('normal');
  if (!position || !sourceNormals) throw new Error('Authored scalp is missing source surface attributes');
  let indexCursor = 0;
  for (let curl = 0; curl < anchors.length; curl++) {
    const anchor = anchors[curl]!, [jointIds, jointWeights] = interpolateWeights(mesh, anchor.face);
    const tangent = new THREE.Vector3(position.getX(anchor.face[1]) - position.getX(anchor.face[0]), position.getY(anchor.face[1]) - position.getY(anchor.face[0]), position.getZ(anchor.face[1]) - position.getZ(anchor.face[0]));
    tangent.addScaledVector(anchor.normal, -tangent.dot(anchor.normal)).normalize();
    const bitangent = anchor.normal.clone().cross(tangent).normalize();
    const curlRadius = 0.0044 * anchor.size, tubeRadius = 0.00165 * anchor.size;
    const firstVertex = curl * verticesPerCurl;
    for (let segment = 0; segment <= CURL_SEGMENTS; segment++) {
      const t = segment / CURL_SEGMENTS, phase = anchor.phase + t * Math.PI * 2 * 1.12;
      const radial = curlRadius * t;
      const center = anchor.point.clone()
        .addScaledVector(anchor.normal, anchor.depth + 0.0035 * t)
        .addScaledVector(tangent, Math.cos(phase) * radial)
        .addScaledVector(bitangent, Math.sin(phase) * radial);
      const curveTangent = anchor.normal.clone().multiplyScalar(0.0035)
        .addScaledVector(tangent, curlRadius * Math.cos(phase) * Math.PI * 2 * 1.12)
        .addScaledVector(bitangent, curlRadius * Math.sin(phase) * Math.PI * 2 * 1.12).normalize();
      const ringA = curveTangent.clone().cross(anchor.normal).normalize();
      if (ringA.lengthSq() < 1e-8) ringA.copy(tangent);
      const ringB = curveTangent.clone().cross(ringA).normalize();
      for (let side = 0; side < CURL_SIDES; side++) {
        const local = firstVertex + segment * CURL_SIDES + side, angle = side / CURL_SIDES * Math.PI * 2;
        const radialNormal = ringA.clone().multiplyScalar(Math.cos(angle)).addScaledVector(ringB, Math.sin(angle)).normalize();
        const point = center.clone().addScaledVector(radialNormal, tubeRadius);
        positions.set([point.x, point.y, point.z], local * 3);
        normals.set([radialNormal.x, radialNormal.y, radialNormal.z], local * 3);
        uv.set([segment / CURL_SEGMENTS, side / CURL_SIDES], local * 2);
        for (let lane = 0; lane < jointIds.length; lane++) {
          skinIndices[local * 4 + lane] = jointIds[lane]!;
          skinWeights[local * 4 + lane] = jointWeights[lane]!;
        }
        for (let targetIndex = 0; targetIndex < sourceMorphs.length; targetIndex++) {
          const target = sourceMorphs[targetIndex]!;
          const dx = (target.getX(anchor.face[0]) + target.getX(anchor.face[1]) + target.getX(anchor.face[2])) / 3;
          const dy = (target.getY(anchor.face[0]) + target.getY(anchor.face[1]) + target.getY(anchor.face[2])) / 3;
          const dz = (target.getZ(anchor.face[0]) + target.getZ(anchor.face[1]) + target.getZ(anchor.face[2])) / 3;
          morphPositions[targetIndex]!.set([dx, dy, dz], local * 3);
        }
      }
    }
    for (let segment = 0; segment < CURL_SEGMENTS; segment++) for (let side = 0; side < CURL_SIDES; side++) {
      const a = firstVertex + segment * CURL_SIDES + side;
      const b = firstVertex + segment * CURL_SIDES + (side + 1) % CURL_SIDES;
      const c = a + CURL_SIDES, d = firstVertex + segment * CURL_SIDES + (side + 1) % CURL_SIDES + CURL_SIDES;
      // For the outward ring frame, (around, forward) gives the outward face normal.
      indices.set([a, b, c, b, d, c], indexCursor); indexCursor += 6;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.name = 'authored-scalp-curl-details';
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeights, 4));
  geometry.morphAttributes.position = morphPositions.map(values => new THREE.BufferAttribute(values, 3));
  geometry.morphTargetsRelative = mesh.geometry.morphTargetsRelative;
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
}

function material(color: THREE.ColorRepresentation, roughness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, side: THREE.FrontSide });
}

/**
 * Adds simple fitted clothing and hair to an already-cloned authored character.
 * Only triangles replaced by an offset copy are hidden on the body. The immutable
 * template geometry remains untouched; all copied surfaces retain the source
 * morph targets and skin weights.
 */
export function applyCharacterPresentation(root: THREE.Group, look: CharacterPresentationLook = {}): CharacterPresentation {
  let body: THREE.SkinnedMesh | null = null;
  root.traverse(object => { if (!body && object instanceof THREE.SkinnedMesh && object.name === 'Body') body = object; });
  if (!body) throw new Error('Authored character has no Body SkinnedMesh');
  const sourceBody = body as THREE.SkinnedMesh;
  const templateGeometry = sourceBody.geometry;
  const sourceIndex = templateGeometry.getIndex(), position = templateGeometry.getAttribute('position'), normal = templateGeometry.getAttribute('normal');
  if (!sourceIndex || !position || !normal || Array.isArray(sourceBody.material)) throw new Error('Presentation supports one indexed Body primitive with positions/normals');
  if (templateGeometry.groups.length > 0) throw new Error('Presentation refuses grouped Body geometry until group-aware replacement is implemented');
  const shirtFaces: Face[] = [], trouserFaces: Face[] = [], scalpCandidates: Face[] = [], remaining: number[] = [];
  for (let offset = 0; offset + 2 < sourceIndex.count; offset += 3) {
    const face: Face = [sourceIndex.getX(offset), sourceIndex.getX(offset + 1), sourceIndex.getX(offset + 2)];
    let owner: 'shirt' | 'trousers' | 'hair' | null = null;
    if (isScalpFace(position, normal, face)) owner = 'hair';
    else owner = classifyFace(sourceBody, face);
    if (owner === 'shirt') shirtFaces.push(face);
    else if (owner === 'trousers') trouserFaces.push(face);
    else if (owner === 'hair') scalpCandidates.push(face);
    else remaining.push(face[0], face[1], face[2]);
  }
  const scalpFaces = largestConnectedSurface(scalpCandidates);
  const selectedScalp = new Set(scalpFaces.map(face => face.join(':')));
  for (const face of scalpCandidates) if (!selectedScalp.has(face.join(':'))) remaining.push(face[0], face[1], face[2]);
  if (scalpFaces.length > HAIR_CAP_TRIANGLE_LIMIT) throw new Error(`Scalp surface selection exceeds bounded cap (${scalpFaces.length} triangles)`);
  if (shirtFaces.length === 0 || trouserFaces.length === 0 || scalpFaces.length === 0) throw new Error(`Presentation selection is incomplete (shirt ${shirtFaces.length}, trousers ${trouserFaces.length}, scalp ${scalpFaces.length})`);
  const hairstyle = look.hairstyle ?? (look.hair === 'bun' ? 'curly-bun' : 'short-curls');
  const capTriangles = scalpFaces.length;
  const curlCapacity = Math.floor((HAIR_TRIANGLE_LIMIT - capTriangles) / (CURL_SEGMENTS * CURL_SIDES * 2));
  const anchors = selectCurlAnchors(sourceBody, scalpFaces, curlCapacity, hairstyle, look.seed ?? (look.hairColor == null ? 'authored-hair' : String(look.hairColor)));
  const curlTriangles = anchors.length * CURL_SEGMENTS * CURL_SIDES * 2;
  if (capTriangles + curlTriangles > HAIR_TRIANGLE_LIMIT) throw new Error(`Authored hairstyle exceeds ${HAIR_TRIANGLE_LIMIT} triangles (${capTriangles + curlTriangles})`);

  const retainedIndices = sourceIndex.array instanceof Uint32Array ? new Uint32Array(remaining) : new Uint16Array(remaining);
  const surface = bodySurfaceWrapper(templateGeometry);
  surface.setIndex(new THREE.BufferAttribute(retainedIndices, 1));
  const shirtGeometry = makeSurfaceGeometry(surface, shirtFaces, 0.006, 'authored-fitted-shirt');
  const trouserGeometry = makeSurfaceGeometry(surface, trouserFaces, 0.005, 'authored-fitted-trousers');
  const scalpGeometry = makeSurfaceGeometry(surface, scalpFaces, 0.0035, 'authored-scalp-surface');
  const curlGeometry = createCurlGeometry(sourceBody, anchors);
  const shirtMaterial = material(look.shirtColor ?? look.outfitColor ?? '#6f3d2a', 0.88);
  const trouserMaterial = material(look.trouserColor ?? look.bottomsColor ?? '#252a31', 0.9);
  const hairMaterial = material(look.hairColor ?? '#211915', 0.78);
  const ownedMeshes: THREE.SkinnedMesh[] = [];
  sourceBody.geometry = surface;
  try {
    ownedMeshes.push(addSkinnedSibling(sourceBody, shirtGeometry, shirtMaterial, 'Authored shirt'));
    ownedMeshes.push(addSkinnedSibling(sourceBody, trouserGeometry, trouserMaterial, 'Authored trousers'));
    ownedMeshes.push(addSkinnedSibling(sourceBody, scalpGeometry, hairMaterial, 'Authored scalp hair')); 
    ownedMeshes.push(addSkinnedSibling(sourceBody, curlGeometry, hairMaterial, 'Authored curl details'));
  } catch (error) {
    for (const mesh of ownedMeshes) { mesh.parent?.remove(mesh); mesh.geometry.dispose(); }
    shirtMaterial.dispose(); trouserMaterial.dispose(); hairMaterial.dispose();
    sourceBody.geometry = templateGeometry;
    throw error;
  }
  const sourceArrays = new Set<ArrayBufferView>();
  for (const attribute of Object.values(templateGeometry.attributes)) sourceArrays.add(attribute.array);
  for (const attributes of Object.values(templateGeometry.morphAttributes)) for (const attribute of attributes) sourceArrays.add(attribute.array);
  const generatedArrays = new Set<ArrayBufferView>();
  const remember = (geometry: THREE.BufferGeometry) => {
    if (geometry.index) generatedArrays.add(geometry.index.array);
    for (const attribute of Object.values(geometry.attributes)) if (!sourceArrays.has(attribute.array)) generatedArrays.add(attribute.array);
    for (const attributes of Object.values(geometry.morphAttributes)) for (const attribute of attributes) if (!sourceArrays.has(attribute.array)) generatedArrays.add(attribute.array);
  };
  remember(surface); remember(shirtGeometry); remember(trouserGeometry); remember(scalpGeometry); remember(curlGeometry);
  const generatedAttributeBytes = [...generatedArrays].reduce((sum, array) => sum + array.byteLength, 0);
  return {
    metrics: {
      hiddenBodyTriangles: shirtFaces.length + trouserFaces.length + scalpFaces.length,
      shirtTriangles: shirtFaces.length,
      trouserTriangles: trouserFaces.length,
      scalpTriangles: capTriangles,
      curlTriangles,
      drawCalls: 4,
      generatedAttributeBytes,
    },
    dispose() {
      for (const mesh of ownedMeshes) { mesh.parent?.remove(mesh); mesh.geometry.dispose(); }
      shirtMaterial.dispose(); trouserMaterial.dispose(); hairMaterial.dispose();
      sourceBody.geometry = templateGeometry;
    },
  };
}
