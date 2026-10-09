import * as THREE from 'three';

export const NATIVE_CURL_HAIR_SOURCE_SHA256 = '3d37f4a379c19b4d64a9c21bb08418858ede79317a477b34b3fdfb965fd11474';
export const NATIVE_CURL_HAIR_INSTANCE_LIMIT = 600;
export const NATIVE_CURL_HAIR_TRIANGLE_LIMIT = 14_400;

export interface NativeCurlHairOptions {
  /** Mesh loaded from the pinned afro01-mobile.glb, kept invisible by its caller. */
  readonly guide: THREE.Mesh;
  /** Actor root containing the guide, Body, and the native head bone. */
  readonly actorRoot: THREE.Object3D;
  /** The actual mixamorigHead bone in this actor's native skeleton. */
  readonly headBone: THREE.Bone;
  /** Body mesh whose bodyFeminine/bodyMasculine morph weights are mirrored by the guide. */
  readonly body: THREE.SkinnedMesh;
  readonly guideSha256: string;
  readonly hairColor: THREE.ColorRepresentation;
  readonly maximumCurls?: number;
}

export interface NativeCurlHairMetrics {
  readonly sourceSha256: string;
  readonly guideVertices: number;
  readonly guideTriangles: number;
  readonly curls: number;
  readonly triangles: number;
  readonly drawCalls: 1;
  readonly sourceGuideRootBounds: { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] };
  readonly guideTriangleCenterRootBounds: { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] };
  readonly curlCenterHeadBounds: { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] };
  readonly familyMorphs: Readonly<Record<string, number>>;
  readonly sharedGeometryReferences: number;
}

export interface NativeCurlHairLease {
  readonly object: THREE.InstancedMesh;
  readonly metrics: NativeCurlHairMetrics;
  /** Rebuild only when the actor's identity morph values change; head animation follows the bone directly. */
  refresh(): void;
  setColor(color: THREE.ColorRepresentation): void;
  dispose(): void;
}

const FAMILY_MORPHS = ['bodyFeminine', 'bodyMasculine'] as const;
const CURL_TRIANGLES = 20;
const MIN_RADIUS = 0.0105;
const MAX_RADIUS = 0.015;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('Native curl hair: ' + message);
}

function guideBounds(points: readonly THREE.Vector3[]): NativeCurlHairMetrics['sourceGuideRootBounds'] {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const point of points) for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis]!, point.getComponent(axis));
    max[axis] = Math.max(max[axis]!, point.getComponent(axis));
  }
  return { min: min as [number, number, number], max: max as [number, number, number] };
}

function makePoints(guide: THREE.Mesh, guideToRoot: THREE.Matrix4): { points: THREE.Vector3[]; triangles: number[][]; vertices: THREE.Vector3[] } {
  const position = guide.geometry.getAttribute('position');
  const index = guide.geometry.getIndex();
  assert(position && index && index.count % 3 === 0, 'pinned source guide must be indexed triangles');
  const vertices = Array.from({ length: position.count }, (_, vertex) =>
    guide.getVertexPosition(vertex, new THREE.Vector3()).applyMatrix4(guideToRoot));
  const triangles: number[][] = [];
  const candidates = new Map<string, THREE.Vector3>();
  for (let offset = 0; offset < index.count; offset += 3) {
    const ids = [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)];
    triangles.push(ids);
    const point = vertices[ids[0]!]!.clone().add(vertices[ids[1]!]!).add(vertices[ids[2]!]!).multiplyScalar(1 / 3);
    const cell = 0.0012;
    const key = [point.x, point.y, point.z].map((v) => Math.round(v / cell)).join(':');
    if (!candidates.has(key)) candidates.set(key, point);
  }
  return { points: [...candidates.values()], triangles, vertices };
}

function farthestSamples(points: readonly THREE.Vector3[], requested: number): { indices: number[]; nearestDistances: number[] } {
  assert(points.length > 1, 'source silhouette has too few distinct points');
  const count = Math.min(requested, points.length);
  let first = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i]!, b = points[first]!;
    if (a.y > b.y || (a.y === b.y && (a.x < b.x || (a.x === b.x && a.z < b.z)))) first = i;
  }
  const nearest = new Float64Array(points.length);
  nearest.fill(Infinity);
  const selected = new Uint8Array(points.length);
  const indices: number[] = [];
  let current = first;
  for (let step = 0; step < count; step++) {
    selected[current] = 1;
    indices.push(current);
    const anchor = points[current]!;
    let next = -1, maxDistance = -1;
    for (let i = 0; i < points.length; i++) {
      if (selected[i]) continue;
      const distance = points[i]!.distanceToSquared(anchor);
      if (distance < nearest[i]!) nearest[i] = distance;
      if (nearest[i]! > maxDistance) { maxDistance = nearest[i]!; next = i; }
    }
    if (next < 0) break;
    current = next;
  }
  const nearestDistances = indices.map((index, i) => {
    if (indices.length === 1) return 0.01;
    let result = Infinity;
    for (let j = 0; j < indices.length; j++) {
      if (i === j) continue;
      result = Math.min(result, points[index]!.distanceToSquared(points[indices[j]!]!));
    }
    return Math.sqrt(result);
  });
  return { indices, nearestDistances };
}

function hashUnit(value: number): number {
  let x = Math.imul(value + 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
  return (x >>> 0) / 0x1_0000_0000;
}

/** Shares only the tiny unit curl geometry. Each lease gets private color and instance transforms. */
export class NativeCurlHairFactory {
  private readonly curlGeometry = new THREE.IcosahedronGeometry(1, 0);
  private references = 0;
  private destroyed = false;

  constructor() {
    const positions = this.curlGeometry.getAttribute('position');
    const normals = this.curlGeometry.getAttribute('normal');
    const normal = new THREE.Vector3();
    for (let index = 0; index < positions.count; index++) {
      normal.fromBufferAttribute(positions, index).normalize();
      normals.setXYZ(index, normal.x, normal.y, normal.z);
    }
    assert(this.curlGeometry.getAttribute('position').count / 3 === CURL_TRIANGLES,
      'unit curl geometry must stay at twenty triangles');
  }

  create(options: NativeCurlHairOptions): NativeCurlHairLease {
    assert(!this.destroyed, 'factory is disposed');
    assert(options.guideSha256.toLowerCase() === NATIVE_CURL_HAIR_SOURCE_SHA256,
      'only the exact pinned afro01 mobile GLB may provide the curl guide');
    assert(options.actorRoot.getObjectById(options.headBone.id) === options.headBone,
      'head bone must belong to the actor root');
    assert(options.actorRoot.getObjectById(options.body.id) === options.body,
      'body must belong to the actor root');
    assert(options.actorRoot.getObjectById(options.guide.id) === options.guide,
      'guide must be attached below the actor root');
    const guideIndex = options.guide.geometry.getIndex();
    const guidePosition = options.guide.geometry.getAttribute('position');
    const morphs = options.guide.geometry.morphAttributes.position ?? [];
    assert(guideIndex && guidePosition && guideIndex.count / 3 === 2_192 && guidePosition.count === 2_276,
      'pinned afro01 geometry contract changed');
    const targetNames = options.guide.userData.targetNames as unknown;
    assert(morphs.length === 2 && Array.isArray(targetNames) && JSON.stringify(targetNames) === JSON.stringify(FAMILY_MORPHS), 'guide must expose the pinned native family target order');
    assert(options.body.morphTargetDictionary && options.body.morphTargetInfluences, 'actor body morph state is unavailable');
    const maximum = Math.min(options.maximumCurls ?? NATIVE_CURL_HAIR_INSTANCE_LIMIT, NATIVE_CURL_HAIR_INSTANCE_LIMIT);
    assert(Number.isInteger(maximum) && maximum > 0, 'maximum curl count must be a positive integer');
    assert(options.headBone.name === 'mixamorigHead', 'expected the actual native mixamorigHead bone');

    options.actorRoot.updateMatrixWorld(true);
    const worldToRoot = options.actorRoot.matrixWorld.clone().invert();
    const guideToRoot = worldToRoot.clone().multiply(options.guide.matrixWorld.clone());
    // Capture the native rest head transform before animation. Curl instances use this
    // inverse at creation/identity-refresh; subsequent head animation moves the parent bone.
    const headAtRestInRoot = worldToRoot.clone().multiply(options.headBone.matrixWorld.clone());
    const rootToHeadRest = headAtRestInRoot.clone().invert();
    const familyState = new Map<string, number>();
    const copyFamilyMorphs = () => {
      for (const name of FAMILY_MORPHS) {
        const bodyIndex = options.body.morphTargetDictionary?.[name];
        const guideIndex = (options.guide.userData.targetNames as string[]).indexOf(name);
        assert(Number.isInteger(bodyIndex) && guideIndex >= 0, 'missing family morph ' + name);
        const value = options.body.morphTargetInfluences?.[bodyIndex!] ?? 0;
        options.guide.morphTargetInfluences![guideIndex!] = value;
        familyState.set(name, value);
      }
    };
    copyFamilyMorphs();
    const positions = makePoints(options.guide, guideToRoot);
    let sampled = farthestSamples(positions.points, maximum);
    assert(sampled.indices.length * CURL_TRIANGLES <= NATIVE_CURL_HAIR_TRIANGLE_LIMIT,
      'generated curl shell exceeds the 7,200-triangle limit');

    const material = new THREE.MeshStandardMaterial({ color: options.hairColor, roughness: 0.92, metalness: 0 });
    const curls = new THREE.InstancedMesh(this.curlGeometry, material, sampled.indices.length);
    curls.name = 'Native 3D Afro Curls';
    curls.count = sampled.indices.length;
    curls.frustumCulled = false;
    curls.castShadow = true;
    curls.receiveShadow = true;
    curls.matrixAutoUpdate = false;
    curls.matrix.identity();
    options.headBone.add(curls);

    const matrix = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const center = new THREE.Vector3();
    const lastFamilyState = new Map<string, number>();
    let disposed = false;
    const updateInstanceMatrices = () => {
      for (const name of FAMILY_MORPHS) lastFamilyState.set(name, familyState.get(name) ?? 0);
      for (let i = 0; i < sampled.indices.length; i++) {
        center.copy(positions.points[sampled.indices[i]!]!).applyMatrix4(rootToHeadRest);
        const radius = THREE.MathUtils.clamp(sampled.nearestDistances[i]! * 0.90, MIN_RADIUS, MAX_RADIUS);
        const noise = hashUnit(i + 701);
        scale.set(radius * (0.9 + noise * 0.2), radius * (0.92 + hashUnit(i + 1901) * 0.18),
          radius * (0.9 + hashUnit(i + 3701) * 0.2));
        matrix.compose(center, quaternion.identity(), scale);
        curls.setMatrixAt(i, matrix);
      }
      curls.instanceMatrix.needsUpdate = true;
      curls.computeBoundingBox(); curls.computeBoundingSphere();
    };
    updateInstanceMatrices();

    const factory = this;
    const metrics: NativeCurlHairMetrics = {
      sourceSha256: options.guideSha256.toLowerCase(),
      guideVertices: guidePosition.count,
      guideTriangles: guideIndex.count / 3,
      curls: sampled.indices.length,
      triangles: sampled.indices.length * CURL_TRIANGLES,
      drawCalls: 1,
      get sourceGuideRootBounds() { return guideBounds(positions.vertices); },
      get guideTriangleCenterRootBounds() { return guideBounds(positions.points); },
      get curlCenterHeadBounds() { return guideBounds(sampled.indices.map((index) => positions.points[index]!.clone().applyMatrix4(rootToHeadRest))); },
      get familyMorphs() { return Object.fromEntries(familyState) as Record<string, number>; },
      get sharedGeometryReferences() { return factory.references; },
    };
    const refresh = () => {
      assert(!disposed, 'lease is disposed');
      copyFamilyMorphs();
      let changed = false;
      for (const name of FAMILY_MORPHS) if (lastFamilyState.get(name) !== familyState.get(name)) changed = true;
      if (changed) {
        const updated = makePoints(options.guide, guideToRoot);
        const updatedSamples = farthestSamples(updated.points, maximum);
        assert(updatedSamples.indices.length === curls.count, 'family morph changed source candidate count');
        positions.points.splice(0, positions.points.length, ...updated.points);
        positions.vertices.splice(0, positions.vertices.length, ...updated.vertices);
        sampled = updatedSamples;
        updateInstanceMatrices();
      }
    };
    curls.onBeforeRender = () => { refresh(); };
    this.references++;
    return {
      object: curls,
      metrics,
      refresh,
      setColor(color) { assert(!disposed, 'lease is disposed'); material.color.set(color); },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        curls.parent?.remove(curls);
        material.dispose();
        this.references--;
        assert(this.references >= 0, 'shared geometry reference count underflow');
      },
    };
  }

  dispose(): void {
    assert(this.references === 0, 'dispose all actor leases before releasing shared curl geometry');
    if (this.destroyed) return;
    this.destroyed = true;
    this.curlGeometry.dispose();
  }

  get activeReferences(): number { return this.references; }
}
