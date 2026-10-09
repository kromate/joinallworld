import * as THREE from 'three';

export interface TrouserSockTrimOptions {
  readonly actorRoot: THREE.Object3D;
  readonly garment: THREE.SkinnedMesh;
  readonly shoes: THREE.SkinnedMesh;
  /** Must be true only for a presentation whose garment is trousers. Skirt looks are an explicit no-op. */
  readonly trouserOutfit: boolean;
  /** Keep the shoe cut slightly inside the trouser hem so the open edge remains occluded. */
  readonly hemOverlapMetres?: number;
  /** Union of source shoe triangles found above the hem in additional deterministic poses. */
  readonly additionalRemovedSourceTriangleIds?: readonly number[];
  /** Union of sole-contact triangles seen in sampled poses; these always win over trimming. */
  readonly protectedSoleSourceTriangleIds?: readonly number[];
}

export interface TrouserSockTrimLease {
  readonly metrics: Readonly<{
    status: 'trimmed' | 'skipped-skirt';
    sourceTriangles: number;
    retainedTriangles: number;
    removedTriangles: number;
    additionalRemovedTriangleIds: number;
    removedSourceTriangleIds: readonly number[];
    protectedSoleSourceTriangleIds: readonly number[];
    removedSockComponents: readonly Readonly<{ side: 'left' | 'right'; triangleCount: number; legWeight: number; footToeWeight: number; boundsY: readonly [number, number] }>[];
    preservedBootComponents: readonly Readonly<{ side: 'left' | 'right'; triangleCount: number; footToeWeight: number; boundsY: readonly [number, number] }>[];
    classifiedComponents: readonly Readonly<{ side: 'left' | 'right'; triangleCount: number; legWeight: number; footToeWeight: number; boundsY: readonly [number, number]; classification: 'sock' | 'boot' | 'other' }>[];
    hemOverlapMetres: number;
    sides: Readonly<Record<'left' | 'right', Readonly<{
      trouserHemY: number;
      cutY: number;
      soleY: number;
      removedTriangles: number;
      protectedSoleTriangles: number;
    }>>>;
  }>;
  dispose(): void;
}

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Trouser sock trim: ${message}`);
}
function boneIndex(skeleton: THREE.Skeleton, name: string): number {
  const index = skeleton.bones.findIndex((bone) => bone.name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^mixamorig/, '') === name.toLowerCase());
  invariant(index >= 0, `missing ${name} bone`);
  return index;
}
function worldInActor(mesh: THREE.SkinnedMesh, vertex: number, actorInverse: THREE.Matrix4, out: THREE.Vector3): THREE.Vector3 {
  mesh.getVertexPosition(vertex, out).applyMatrix4(mesh.matrixWorld).applyMatrix4(actorInverse);
  return out;
}
function weightsForSide(
  skinIndex: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  skinWeight: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  vertex: number,
  indices: ReadonlySet<number>,
): number {
  let total = 0;
  for (let lane = 0; lane < 4; lane++) if (indices.has(Math.round(skinIndex.getComponent(vertex, lane)))) total += skinWeight.getComponent(vertex, lane);
  return total;
}

function createPrivateIndexGeometry(source: THREE.BufferGeometry, index: Uint16Array | Uint32Array): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.name = `${source.name} (private sock-trim index)`;
  // Footwear presentation already gives this actor a private geometry clone.
  // Share its immutable attributes and allocate only a new index buffer.
  for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
  geometry.morphAttributes = Object.fromEntries(Object.entries(source.morphAttributes).map(([name, attributes]) => [name, [...attributes]]));
  geometry.morphTargetsRelative = source.morphTargetsRelative;
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  for (const group of source.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  geometry.setDrawRange(source.drawRange.start, source.drawRange.count);
  geometry.boundingBox = source.boundingBox?.clone() ?? null;
  geometry.boundingSphere = source.boundingSphere?.clone() ?? null;
  geometry.userData = { ...source.userData };
  return geometry;
}

/**
 * Privately removes only the disconnected sock islands from the authored
 * footwear mesh. The pinned export has one small 252-triangle sock island per
 * foot (mean shin weight 0.689/0.690, mean foot/toe weight 0.311/0.310) and a
 * separate 1,408-triangle boot island per foot (shin 0.490/0.543, foot/toe
 * 0.510/0.457). This margin-based classifier keeps the complete boot island;
 * a trouser-height cut through the combined shoe mesh erased visible uppers.
 */
export function trimAuthoredSockAboveTrouserHem(options: TrouserSockTrimOptions): TrouserSockTrimLease {
  const { actorRoot, garment, shoes } = options;
  const overlap = options.hemOverlapMetres ?? 0.007;
  invariant(Number.isFinite(overlap) && overlap >= 0.003 && overlap <= 0.015, 'hem overlap must be 3–15mm');
  invariant(garment.isSkinnedMesh && shoes.isSkinnedMesh, 'garment and shoes must be skinned meshes');
  invariant(garment.skeleton === shoes.skeleton, 'garment and shoes must share the actor skeleton');
  const sourceGeometry = shoes.geometry;
  const sourceIndex = sourceGeometry.getIndex();
  invariant(sourceIndex && sourceIndex.count % 3 === 0, 'shoe source must have indexed triangles');
  const sourcePosition = sourceGeometry.getAttribute('position');
  const shoeSkinIndex = sourceGeometry.getAttribute('skinIndex');
  const shoeSkinWeight = sourceGeometry.getAttribute('skinWeight');
  const garmentSkinIndex = garment.geometry.getAttribute('skinIndex');
  const garmentSkinWeight = garment.geometry.getAttribute('skinWeight');
  const garmentPosition = garment.geometry.getAttribute('position');
  invariant(sourcePosition && shoeSkinIndex && shoeSkinWeight && garmentPosition && garmentSkinIndex && garmentSkinWeight,
    'shoe and trouser meshes require position and four-lane skinning attributes');
  invariant(shoeSkinIndex.itemSize === 4 && shoeSkinWeight.itemSize === 4 && garmentSkinIndex.itemSize === 4 && garmentSkinWeight.itemSize === 4,
    'four-lane skinning layout is required');

  const sourceTriangles = sourceIndex.count / 3;
  if (!options.trouserOutfit) {
    return Object.freeze({
        metrics: Object.freeze({ status: 'skipped-skirt' as const, sourceTriangles, retainedTriangles: sourceTriangles, removedTriangles: 0, additionalRemovedTriangleIds: 0, removedSourceTriangleIds: Object.freeze([]), protectedSoleSourceTriangleIds: Object.freeze([]), removedSockComponents: Object.freeze([]), preservedBootComponents: Object.freeze([]), classifiedComponents: Object.freeze([]), hemOverlapMetres: overlap,
        sides: Object.freeze({
          left: Object.freeze({ trouserHemY: 0, cutY: 0, soleY: 0, removedTriangles: 0, protectedSoleTriangles: 0 }),
          right: Object.freeze({ trouserHemY: 0, cutY: 0, soleY: 0, removedTriangles: 0, protectedSoleTriangles: 0 }),
        }) }),
      dispose() {},
    });
  }

  actorRoot.updateWorldMatrix(true, false);
  actorRoot.updateMatrixWorld(true);
  garment.updateWorldMatrix(true, true);
  shoes.updateWorldMatrix(true, true);
  garment.skeleton.update();
  const actorInverse = actorRoot.matrixWorld.clone().invert();
  const sides = {
    left: { leg: boneIndex(garment.skeleton, 'LeftLeg'), foot: boneIndex(garment.skeleton, 'LeftFoot'), toe: boneIndex(garment.skeleton, 'LeftToeBase') },
    right: { leg: boneIndex(garment.skeleton, 'RightLeg'), foot: boneIndex(garment.skeleton, 'RightFoot'), toe: boneIndex(garment.skeleton, 'RightToeBase') },
  };
  const sideSets = {
    left: { all: new Set([sides.left.leg, sides.left.foot, sides.left.toe]), sole: new Set([sides.left.foot, sides.left.toe]) },
    right: { all: new Set([sides.right.leg, sides.right.foot, sides.right.toe]), sole: new Set([sides.right.foot, sides.right.toe]) },
  };
  const shinSets = { left: new Set([sides.left.leg]), right: new Set([sides.right.leg]) };
  const hem = { left: Infinity, right: Infinity };
  const scratch = new THREE.Vector3();
  for (let vertex = 0; vertex < garmentPosition.count; vertex++) {
    const left = weightsForSide(garmentSkinIndex, garmentSkinWeight, vertex, sideSets.left.all);
    const right = weightsForSide(garmentSkinIndex, garmentSkinWeight, vertex, sideSets.right.all);
    const side = left > right ? 'left' : 'right';
    const dominant = Math.max(left, right);
    if (dominant < 0.42 || Math.abs(left - right) < 0.20) continue;
    const y = worldInActor(garment, vertex, actorInverse, scratch).y;
    if (Number.isFinite(y)) hem[side] = Math.min(hem[side], y);
  }
  invariant(Number.isFinite(hem.left) && Number.isFinite(hem.right), 'could not locate both actual trouser hems from side-weighted garment vertices');

  const sole = { left: Infinity, right: Infinity };
  for (let vertex = 0; vertex < sourcePosition.count; vertex++) {
    for (const side of ['left', 'right'] as const) {
      if (weightsForSide(shoeSkinIndex, shoeSkinWeight, vertex, sideSets[side].sole) < 0.60) continue;
      const y = worldInActor(shoes, vertex, actorInverse, scratch).y;
      if (Number.isFinite(y)) sole[side] = Math.min(sole[side], y);
    }
  }
  invariant(Number.isFinite(sole.left) && Number.isFinite(sole.right), 'could not locate shoe sole vertices on both sides');

  const cut = { left: hem.left + overlap, right: hem.right + overlap };
  invariant(cut.left > sole.left + 0.025 && cut.right > sole.right + 0.025, 'trouser hem is too close to the shoe sole for a safe trim');
  const kept: number[] = [];
  const removedSourceTriangleIds = new Set<number>();
  const protectedSoleSourceTriangleIds = new Set<number>();
  for (const triangle of options.additionalRemovedSourceTriangleIds ?? []) {
    invariant(Number.isInteger(triangle) && triangle >= 0 && triangle < sourceTriangles, `additional removed triangle ${triangle} is outside the source index`);
    removedSourceTriangleIds.add(triangle);
  }
  for (const triangle of options.protectedSoleSourceTriangleIds ?? []) {
    invariant(Number.isInteger(triangle) && triangle >= 0 && triangle < sourceTriangles, `protected sole triangle ${triangle} is outside the source index`);
    protectedSoleSourceTriangleIds.add(triangle);
  }
  const trimmed = { left: 0, right: 0 };
  const protectedSoleTriangles = { left: 0, right: 0 };
  // Build connected indexed components first. The pinned footwear export has
  // separate sock and boot islands per foot. Never infer a sock from height
  // alone: boot uppers rise above the trouser hem but must remain intact.
  const parent = new Int32Array(sourcePosition.count);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (value: number): number => {
    let root = value;
    while (parent[root]! !== root) root = parent[root]!;
    while (parent[value] !== value) { const next = parent[value]!; parent[value] = root; value = next; }
    return root;
  };
  const union = (left: number, right: number) => { const a = find(left), b = find(right); if (a !== b) parent[b] = a; };
  const coincident = new Map<string, number>();
  for (let vertex = 0; vertex < sourcePosition.count; vertex++) {
    const point = worldInActor(shoes, vertex, actorInverse, new THREE.Vector3());
    const key = `${Math.round(point.x * 100000)}:${Math.round(point.y * 100000)}:${Math.round(point.z * 100000)}`;
    const previousVertex = coincident.get(key);
    if (previousVertex === undefined) coincident.set(key, vertex);
    else union(vertex, previousVertex);
  }
  const triangleVertices: number[][] = new Array(sourceTriangles);
  for (let triangle = 0; triangle < sourceTriangles; triangle++) {
    const offset = triangle * 3;
    const ids = [sourceIndex.getX(offset), sourceIndex.getX(offset + 1), sourceIndex.getX(offset + 2)];
    triangleVertices[triangle] = ids;
    union(ids[0]!, ids[1]!);
    union(ids[1]!, ids[2]!);
  }
  const components = new Map<number, Set<number>>();
  for (let triangle = 0; triangle < sourceTriangles; triangle++) {
    const ids = triangleVertices[triangle]!;
    const key = find(ids[0]!);
    let vertices = components.get(key);
    if (!vertices) { vertices = new Set<number>(); components.set(key, vertices); }
    for (const id of ids) vertices.add(id);
  }
  const componentTriangles = new Map<number, number[]>();
  for (let triangle = 0; triangle < sourceTriangles; triangle++) {
    const key = find(triangleVertices[triangle]![0]!);
    const list = componentTriangles.get(key);
    if (list) list.push(triangle); else componentTriangles.set(key, [triangle]);
  }
  const removedSockComponents: Array<{ side: 'left' | 'right'; triangleCount: number; legWeight: number; footToeWeight: number; boundsY: readonly [number, number] }> = [];
  const preservedBootComponents: Array<{ side: 'left' | 'right'; triangleCount: number; footToeWeight: number; boundsY: readonly [number, number] }> = [];
  const classifiedComponents: Array<{ side: 'left' | 'right'; triangleCount: number; legWeight: number; footToeWeight: number; boundsY: readonly [number, number]; classification: 'sock' | 'boot' | 'other' }> = [];
  for (const [component, vertices] of components) {
    let leftLeg = 0, rightLeg = 0, leftFootToe = 0, rightFootToe = 0, lowY = Infinity, highY = -Infinity;
    for (const vertex of vertices) {
      leftLeg += weightsForSide(shoeSkinIndex, shoeSkinWeight, vertex, shinSets.left);
      rightLeg += weightsForSide(shoeSkinIndex, shoeSkinWeight, vertex, shinSets.right);
      leftFootToe += weightsForSide(shoeSkinIndex, shoeSkinWeight, vertex, sideSets.left.sole);
      rightFootToe += weightsForSide(shoeSkinIndex, shoeSkinWeight, vertex, sideSets.right.sole);
      const y = worldInActor(shoes, vertex, actorInverse, new THREE.Vector3()).y;
      lowY = Math.min(lowY, y); highY = Math.max(highY, y);
    }
    const count = vertices.size;
    const side = leftLeg + leftFootToe >= rightLeg + rightFootToe ? 'left' : 'right';
    const legWeight = (side === 'left' ? leftLeg : rightLeg) / count;
    const footToeWeight = (side === 'left' ? leftFootToe : rightFootToe) / count;
    const sockTriangles = componentTriangles.get(component) ?? [];
    const crossesTrouserHem = highY > hem[side] - 0.01;
    const isSock = legWeight >= 0.65 && footToeWeight <= 0.35 && crossesTrouserHem;
    const isBoot = footToeWeight >= 0.40;
    classifiedComponents.push({ side, triangleCount: sockTriangles.length, legWeight, footToeWeight, boundsY: Object.freeze([lowY, highY] as [number, number]), classification: isSock ? 'sock' : isBoot ? 'boot' : 'other' });
    if (isSock) {
      for (const triangle of sockTriangles) removedSourceTriangleIds.add(triangle);
      trimmed[side] += sockTriangles.length;
      removedSockComponents.push({ side, triangleCount: sockTriangles.length, legWeight, footToeWeight, boundsY: Object.freeze([lowY, highY] as [number, number]) });
    } else if (isBoot) {
      preservedBootComponents.push({ side, triangleCount: sockTriangles.length, footToeWeight, boundsY: Object.freeze([lowY, highY] as [number, number]) });
    }
    for (const triangle of sockTriangles) {
      const ids = triangleVertices[triangle]!;
      if (ids.some((vertex) => weightsForSide(shoeSkinIndex, shoeSkinWeight, vertex, sideSets[side].sole) >= 0.60
        && worldInActor(shoes, vertex, actorInverse, new THREE.Vector3()).y <= sole[side] + 0.025)) {
        protectedSoleTriangles[side]++;
        protectedSoleSourceTriangleIds.add(triangle);
      }
    }
  }
  invariant(removedSockComponents.filter((component) => component.side === 'left').length === 1
    && removedSockComponents.filter((component) => component.side === 'right').length === 1,
  `expected one disconnected shin-weighted sock island per foot, found ${JSON.stringify(removedSockComponents)}`);
  invariant(preservedBootComponents.some((component) => component.side === 'left')
    && preservedBootComponents.some((component) => component.side === 'right'),
  `sock classifier did not prove a retained boot island per foot: ${JSON.stringify(preservedBootComponents)}`);
  for (const triangle of protectedSoleSourceTriangleIds) removedSourceTriangleIds.delete(triangle);
  // Emit the stable source-order index stream from the union across sampled poses.
  kept.length = 0;
  for (let triangle = 0; triangle < sourceTriangles; triangle++) {
    if (removedSourceTriangleIds.has(triangle)) continue;
    const offset = triangle * 3;
    kept.push(sourceIndex.getX(offset), sourceIndex.getX(offset + 1), sourceIndex.getX(offset + 2));
  }
  invariant(removedSourceTriangleIds.size > 0, 'no shoe triangles are wholly above actual trouser hems or sampled-pose union');

  const clone = createPrivateIndexGeometry(sourceGeometry,
    sourceIndex.array instanceof Uint16Array ? new Uint16Array(kept) : new Uint32Array(kept));
  const sourceGroups = sourceGeometry.groups;
  if (sourceGroups.length) {
    // The current shoes GLB has one draw group. Refuse a future multi-group asset
    // until filtering is group-aware rather than silently changing material slots.
    invariant(sourceGroups.length === 1 && sourceGroups[0]!.start === 0 && sourceGroups[0]!.count === sourceIndex.count,
      'multi-group shoe geometry needs a group-preserving trim implementation');
    clone.clearGroups();
    clone.addGroup(0, kept.length, sourceGroups[0]!.materialIndex);
  }
  const previous = sourceGeometry;
  shoes.geometry = clone;
  let disposed = false;
  const metrics = Object.freeze({
    status: 'trimmed' as const,
    sourceTriangles,
    retainedTriangles: kept.length / 3,
    removedTriangles: removedSourceTriangleIds.size,
    additionalRemovedTriangleIds: Math.max(0, removedSourceTriangleIds.size - trimmed.left - trimmed.right),
    removedSourceTriangleIds: Object.freeze([...removedSourceTriangleIds].sort((a, b) => a - b)),
    protectedSoleSourceTriangleIds: Object.freeze([...protectedSoleSourceTriangleIds].sort((a, b) => a - b)),
    removedSockComponents: Object.freeze(removedSockComponents.map((component) => Object.freeze(component))),
    preservedBootComponents: Object.freeze(preservedBootComponents.map((component) => Object.freeze(component))),
    classifiedComponents: Object.freeze(classifiedComponents.map((component) => Object.freeze(component))),
    hemOverlapMetres: overlap,
    sides: Object.freeze({
      left: Object.freeze({ trouserHemY: hem.left, cutY: cut.left, soleY: sole.left, removedTriangles: trimmed.left, protectedSoleTriangles: protectedSoleTriangles.left }),
      right: Object.freeze({ trouserHemY: hem.right, cutY: cut.right, soleY: sole.right, removedTriangles: trimmed.right, protectedSoleTriangles: protectedSoleTriangles.right }),
    }),
  });
  return Object.freeze({
    metrics,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (shoes.geometry === clone) shoes.geometry = previous;
      clone.dispose();
    },
  });
}
