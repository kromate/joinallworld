import * as THREE from 'three';
import type { FootContact } from '../../foot-contact.ts';

export type NativeRestPose = 'lie' | 'soak' | 'wash';
export type NativeRestProp = 'bed' | 'mat' | 'tub' | 'shower';
export type NativeRestRegion = 'pelvis-back' | 'torso-back' | 'head-back';

/**
 * A host-owned description of one real prop surface. `surfaceYAt` must query that prop's actual
 * collision/render geometry in world coordinates and return null outside it; it must not infer a
 * floor from the actor's location. For showers, `headZone` identifies the actual water column.
 */
export interface NativeRestPropSurface {
  readonly id: string;
  readonly pose: NativeRestPose;
  readonly prop: NativeRestProp;
  readonly surfaceYAt: (worldX: number, worldZ: number) => number | null;
  readonly headZone?: Readonly<{ contains(worldPoint: THREE.Vector3): boolean }>;
}

export interface NativeRestRegionMeasure {
  readonly vertices: number;
  readonly sampled: number;
  readonly contactVertices: number;
  readonly minimumGap: number;
  readonly maximumGap: number;
}

export interface NativeRestContactMeasure {
  readonly propId: string;
  readonly pose: NativeRestPose;
  readonly regions: Readonly<Record<NativeRestRegion, NativeRestRegionMeasure>>;
  readonly footGaps: Readonly<Record<'left' | 'right', Readonly<{ sampled: number; minimumGap: number }>>>;
  readonly headInZone: boolean | null;
  readonly supported: boolean;
  readonly reason: string | null;
}

export interface NativeRestContactProbe {
  readonly metrics: Readonly<{ candidateVertices: Readonly<Record<NativeRestRegion, number>>; capPerRegion: number }>;
  sample(surface: NativeRestPropSurface, contacts: readonly FootContact[]): NativeRestContactMeasure;
}

const PROP_FOR_POSE = Object.freeze({
  lie: Object.freeze(['bed', 'mat'] as const),
  soak: Object.freeze(['tub'] as const),
  wash: Object.freeze(['shower'] as const),
} satisfies Readonly<Record<NativeRestPose, readonly NativeRestProp[]>>);
const REGION_BONES: Readonly<Record<NativeRestRegion, readonly string[]>> = Object.freeze({
  'pelvis-back': Object.freeze(['mixamorigHips']),
  'torso-back': Object.freeze(['mixamorigSpine', 'mixamorigSpine1', 'mixamorigSpine2']),
  'head-back': Object.freeze(['mixamorigNeck', 'mixamorigHead']),
});
const DEFAULT_WEIGHT = 0.2;
const DEFAULT_CAP = 384;
const CONTACT_GAP = 0.018;
const MAX_PENETRATION = 0.004;

function fail(message: string): never { throw new Error(`Native prop rest contact: ${message}`); }

function activeVertices(mesh: THREE.SkinnedMesh): number[] {
  const { geometry } = mesh;
  const position = geometry.getAttribute('position');
  const index = geometry.index;
  if (!index) fail(`${mesh.name} needs indexed geometry`);
  const start = Math.max(0, Math.floor(geometry.drawRange.start || 0));
  const end = Math.min(index.count, Number.isFinite(geometry.drawRange.count)
    ? start + Math.max(0, Math.floor(geometry.drawRange.count)) : index.count);
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const ranges: Array<readonly [number, number]> = [];
  if (geometry.groups.length) {
    for (const group of geometry.groups) {
      const material = materials[group.materialIndex ?? 0];
      if (material?.visible) ranges.push([Math.max(start, group.start), Math.min(end, group.start + group.count)]);
    }
  } else {
    if (materials.length !== 1) fail(`${mesh.name} array materials require explicit geometry groups`);
    if (materials[0]?.visible) ranges.push([start, end]);
  }
  const vertices = new Set<number>();
  for (const [from, to] of ranges) for (let offset = from; offset < to; offset++) {
    const vertex = index.getX(offset);
    if (!Number.isInteger(vertex) || vertex < 0 || vertex >= position.count) fail(`${mesh.name} has invalid active vertex ${vertex}`);
    vertices.add(vertex);
  }
  return [...vertices];
}

function visibleInTree(mesh: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = mesh; node; node = node.parent) if (!node.visible) return false;
  return true;
}

export function validateNativeRestPropSurface(surface: NativeRestPropSurface): void {
  if (!surface || typeof surface.id !== 'string' || !surface.id.trim()) fail('host prop id is required');
  if (surface.pose !== 'lie' && surface.pose !== 'soak' && surface.pose !== 'wash') fail('unknown resting pose');
  const allowedProps: readonly NativeRestProp[] = PROP_FOR_POSE[surface.pose];
  if (!allowedProps.includes(surface.prop)) fail(`${surface.prop} cannot support ${surface.pose}`);
  if (typeof surface.surfaceYAt !== 'function') fail(`${surface.id} has no actual prop-surface query`);
  if (surface.pose === 'wash' && (surface.prop !== 'shower' || !surface.headZone
    || typeof surface.headZone.contains !== 'function')) fail('wash requires an actual shower surface and head-zone query');
}

function weightedRegions(mesh: THREE.SkinnedMesh, candidates: readonly number[], threshold: number): Map<NativeRestRegion, number[]> {
  const index = mesh.geometry.getAttribute('skinIndex');
  const weight = mesh.geometry.getAttribute('skinWeight');
  if (!index || !weight || index.count !== weight.count) fail(`${mesh.name} lacks aligned skin attributes`);
  const regionIndices = Object.fromEntries(Object.entries(REGION_BONES).map(([region, names]) => {
    const bones = new Set<number>();
    mesh.skeleton.bones.forEach((bone, boneIndex) => { if (names.includes(bone.name)) bones.add(boneIndex); });
    if (!bones.size) fail(`${mesh.name} has no bones for ${region}`);
    return [region, bones] as const;
  })) as Record<NativeRestRegion, Set<number>>;
  const result = new Map<NativeRestRegion, number[]>(Object.keys(REGION_BONES).map((key) => [key as NativeRestRegion, []]));
  for (const vertex of candidates) {
    const totals: Record<NativeRestRegion, number> = { 'pelvis-back': 0, 'torso-back': 0, 'head-back': 0 };
    for (let lane = 0; lane < 4; lane++) {
      const bone = index.getComponent(vertex, lane), value = weight.getComponent(vertex, lane);
      if (!Number.isFinite(value) || value < 0) fail(`${mesh.name} vertex ${vertex} has invalid weights`);
      for (const region of Object.keys(REGION_BONES) as NativeRestRegion[]) if (regionIndices[region].has(bone)) totals[region] += value;
    }
    const best = (Object.keys(REGION_BONES) as NativeRestRegion[]).sort((a, b) => totals[b] - totals[a])[0]!;
    if (totals[best] >= threshold) result.get(best)!.push(vertex);
  }
  return result;
}

function posteriorSamples(
  root: THREE.Group,
  mesh: THREE.SkinnedMesh,
  region: NativeRestRegion,
  candidates: readonly number[],
  forward: THREE.Vector3,
  inverseRoot: THREE.Matrix4,
  cap: number,
): number[] {
  const point = new THREE.Vector3();
  const names = REGION_BONES[region];
  const bones = names.map((name) => root.getObjectByName(name)).filter((node): node is THREE.Bone => node instanceof THREE.Bone);
  if (!bones.length) fail(`actor is missing a region bone for ${region}`);
  const center = new THREE.Vector3();
  for (const bone of bones) center.add(bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseRoot));
  center.multiplyScalar(1 / bones.length);
  const projected = candidates.map((vertex) => {
    mesh.getVertexPosition(vertex, point); mesh.localToWorld(point); point.applyMatrix4(inverseRoot);
    return { vertex, rearward: -point.sub(center).dot(forward) };
  }).sort((a, b) => b.rearward - a.rearward || a.vertex - b.vertex);
  if (!projected.length || cap <= 0) return [];
  // Only the anatomically posterior half of this influence region may witness back support.
  const posteriorCount = Math.max(1, Math.ceil(projected.length * 0.5));
  const posterior = projected.slice(0, posteriorCount);
  const take = Math.min(posterior.length, cap);
  const result: number[] = [];
  for (let i = 0; i < take; i++) result.push(posterior[Math.floor(i * posterior.length / take)]!.vertex);
  return result;
}

/**
 * Caches small, indexed, skin-weighted anatomical surface samples. It measures actual deformed
 * vertices from the visible body/garment meshes; caller-supplied prop geometry remains authoritative.
 */
export function createNativeRestContactProbe(
  root: THREE.Group,
  meshes: readonly THREE.SkinnedMesh[],
  options: Readonly<{ minimumBoneWeight?: number; maximumVerticesPerRegion?: number }> = {},
): NativeRestContactProbe {
  if (!meshes.length || meshes.length > 3) fail('expected visible Body and at most two outfit meshes');
  const minimumBoneWeight = options.minimumBoneWeight ?? DEFAULT_WEIGHT;
  const maximumVerticesPerRegion = options.maximumVerticesPerRegion ?? DEFAULT_CAP;
  if (!(minimumBoneWeight > 0 && minimumBoneWeight <= 1) || !Number.isInteger(maximumVerticesPerRegion)
    || maximumVerticesPerRegion < 16 || maximumVerticesPerRegion > 1024) fail('sample bounds are invalid');
  const referenceBones = meshes[0]!.skeleton.bones;
  const regions = new Map<NativeRestRegion, Array<{ mesh: THREE.SkinnedMesh; vertices: Uint32Array }>>(
    (Object.keys(REGION_BONES) as NativeRestRegion[]).map((region) => [region, []]));
  const totals: Record<NativeRestRegion, number> = { 'pelvis-back': 0, 'torso-back': 0, 'head-back': 0 };
  root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
  for (const mesh of meshes) mesh.skeleton.update();
  const inverseRoot = root.matrixWorld.clone().invert();
  const toeDirection = (side: 'Left' | 'Right') => {
    const foot = root.getObjectByName(`mixamorig${side}Foot`);
    const toe = root.getObjectByName(`mixamorig${side}ToeBase`);
    if (!(foot instanceof THREE.Bone) || !(toe instanceof THREE.Bone)) fail(`actor is missing ${side.toLowerCase()} foot/toe landmarks`);
    return toe.getWorldPosition(new THREE.Vector3()).sub(foot.getWorldPosition(new THREE.Vector3()));
  };
  const forward = toeDirection('Left').add(toeDirection('Right'));
  forward.y = 0;
  if (forward.lengthSq() < 1e-8) fail('actor has no measurable forward axis');
  forward.transformDirection(inverseRoot).normalize();
  for (const mesh of meshes) {
    if (root.getObjectById(mesh.id) !== mesh || !mesh.isSkinnedMesh || !visibleInTree(mesh)) fail(`${mesh.name} must be a visible actor-owned SkinnedMesh`);
    if (mesh.skeleton.bones.length !== referenceBones.length || !mesh.skeleton.bones.every((bone, index) => bone === referenceBones[index])) {
      fail(`${mesh.name} does not share the exact actor skeleton and order`);
    }
    const active = activeVertices(mesh);
    const byRegion = weightedRegions(mesh, active, minimumBoneWeight);
    for (const region of Object.keys(REGION_BONES) as NativeRestRegion[]) {
      const source = byRegion.get(region)!;
      if (!source.length) continue;
      // Select the posterior-facing half by actual rest-space anatomical forward projection,
      // then cap the per-pose sample count without changing the indexed source geometry.
      const selected = posteriorSamples(root, mesh, region, source, forward, inverseRoot,
        maximumVerticesPerRegion - totals[region]);
      if (selected.length) {
        regions.get(region)!.push({ mesh, vertices: Uint32Array.from(selected) });
        totals[region] += selected.length;
      }
    }
  }
  for (const region of Object.keys(REGION_BONES) as NativeRestRegion[]) if (!totals[region]) fail(`no visible vertices sampled for ${region}`);

  const point = new THREE.Vector3();
  const probe: NativeRestContactProbe = {
    metrics: Object.freeze({ candidateVertices: Object.freeze({ ...totals }), capPerRegion: maximumVerticesPerRegion }),
    sample(surface: NativeRestPropSurface, contacts: readonly FootContact[]) {
      validateNativeRestPropSurface(surface);
      root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
      for (const mesh of meshes) mesh.skeleton.update();
      const regionMeasures = {} as Record<NativeRestRegion, NativeRestRegionMeasure>;
      for (const region of Object.keys(REGION_BONES) as NativeRestRegion[]) {
        let sampled = 0, contactVertices = 0, minimumGap = Infinity, maximumGap = -Infinity;
        for (const { mesh, vertices } of regions.get(region)!) {
          if (!visibleInTree(mesh)) continue;
          for (const vertex of vertices) {
            mesh.getVertexPosition(vertex, point); mesh.localToWorld(point);
            const y = surface.surfaceYAt(point.x, point.z);
            if (y === null) continue;
            if (!Number.isFinite(y)) fail(`${surface.id} returned non-finite support height`);
            const gap = point.y - y;
            if (!Number.isFinite(gap)) fail(`${mesh.name} vertex ${vertex} has non-finite world position`);
            sampled++; if (gap <= CONTACT_GAP) contactVertices++;
            minimumGap = Math.min(minimumGap, gap); maximumGap = Math.max(maximumGap, gap);
          }
        }
        regionMeasures[region] = Object.freeze({ vertices: totals[region], sampled, contactVertices,
          minimumGap: sampled ? minimumGap : Infinity, maximumGap: sampled ? maximumGap : Infinity });
      }
      const footGaps: Record<'left' | 'right', { sampled: number; minimumGap: number }> = {
        left: { sampled: 0, minimumGap: Infinity }, right: { sampled: 0, minimumGap: Infinity },
      };
      for (const contact of contacts) for (const point of contact.points ?? [contact]) {
        const y = surface.surfaceYAt(point.x, point.z);
        if (y === null) continue;
        if (!Number.isFinite(y)) fail(`${surface.id} returned non-finite sole support height`);
        const gap = point.y - y;
        const target = footGaps[point.side]; target.sampled++; target.minimumGap = Math.min(target.minimumGap, gap);
      }
      const headZone = surface.pose === 'wash' ? surface.headZone! : undefined;
      const head = headZone ? root.getObjectByName('mixamorigHead') : null;
      const headPoint = head?.getWorldPosition(new THREE.Vector3());
      const headInZone = headZone ? Boolean(headPoint && headZone.contains(headPoint)) : null;
      const penetration = (Object.values(regionMeasures).some((measure) => measure.sampled && measure.minimumGap < -MAX_PENETRATION)
        || Object.values(footGaps).some((measure) => measure.sampled && measure.minimumGap < -MAX_PENETRATION));
      const supported = surface.pose === 'lie'
        ? !penetration && regionMeasures['pelvis-back'].sampled > 0 && regionMeasures['torso-back'].sampled > 0
          && regionMeasures['pelvis-back'].contactVertices > 0 && regionMeasures['torso-back'].contactVertices > 0
          : surface.pose === 'soak'
          ? !penetration && regionMeasures['pelvis-back'].sampled > 0 && regionMeasures['pelvis-back'].contactVertices > 0
            && footGaps.left.sampled > 0 && footGaps.right.sampled > 0
            && footGaps.left.minimumGap <= CONTACT_GAP && footGaps.right.minimumGap <= CONTACT_GAP
          : !penetration && headInZone === true && footGaps.left.sampled > 0 && footGaps.right.sampled > 0
            && footGaps.left.minimumGap <= CONTACT_GAP && footGaps.right.minimumGap <= CONTACT_GAP;
      const reason = supported ? null : surface.pose === 'lie'
        ? 'bed/mat requires visible pelvis-back and torso-back support with no >4 mm penetration'
        : surface.pose === 'soak'
          ? 'tub requires visible posterior-pelvis and both foot regions over the actual interior floor'
          : 'shower requires head inside the host water zone and at least one supported sole, with both feet sampled';
      return Object.freeze({ propId: surface.id, pose: surface.pose,
        regions: Object.freeze(regionMeasures),
        footGaps: Object.freeze({ left: Object.freeze(footGaps.left), right: Object.freeze(footGaps.right) }),
        headInZone, supported, reason });
    },
  };
  return Object.freeze(probe);
}
