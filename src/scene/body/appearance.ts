import {
  Float32BufferAttribute,
  InterleavedBufferAttribute,
  Matrix4,
  SkinnedMesh,
  Vector3,
} from 'three';
import type { BufferAttribute } from 'three';
import { DEFAULT_AVATAR_APPEARANCE, normalizeAvatarAppearance } from '../../types/avatar.ts';
import type { AvatarAppearance, AvatarAgeAppearance } from '../../types/avatar.ts';

type Attribute = BufferAttribute | InterleavedBufferAttribute;
type UnsupportedReason =
  | 'not_skinned_mesh'
  | 'missing_position'
  | 'missing_skin_attributes'
  | 'missing_region_attribute'
  | 'missing_rest_bones'
  | 'invalid_transform'
  | 'no_face_region'
  | 'mesh_changed'
  | 'disposed';

export interface AppearanceChange {
  readonly ok: true;
  readonly appearance: Readonly<AvatarAppearance>;
  readonly changed: boolean;
}
export interface AppearanceFailure {
  readonly ok: false;
  readonly reason: UnsupportedReason;
}
export type AppearanceResult = AppearanceChange | AppearanceFailure;

export interface AvatarAppearanceController {
  /** Current cosmetic categories; never contains user identity or real-age data. */
  readonly appearance: Readonly<AvatarAppearance>;
  /** Apply one of the closed cosmetic presets. Repeated values do not rewrite geometry. */
  apply(value: unknown): AppearanceResult;
  /** Restore the exact source POSITION attribute. */
  reset(): void;
  /** Restore source positions and release this controller's bounded cached arrays. */
  dispose(): void;
}

export type AppearanceControllerResult =
  | { readonly ok: true; readonly controller: AvatarAppearanceController }
  | AppearanceFailure;

interface FaceVertex {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly height: number;
  readonly side: number;
  readonly front: number;
}

interface Bounds {
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
}

const finiteMatrix = (matrix: Matrix4): boolean => matrix.elements.every(Number.isFinite);
const smoothstep = (low: number, high: number, value: number): number => {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
};
const readComponent = (attribute: Attribute, vertex: number, component: number): number => {
  switch (component) {
    case 0: return attribute.getX(vertex);
    case 1: return attribute.getY(vertex);
    case 2: return attribute.getZ(vertex);
    case 3: return attribute.getW(vertex);
    default: return 0;
  }
};
const emptyBounds = (): Bounds => ({
  minX: Infinity, maxX: -Infinity,
  minY: Infinity, maxY: -Infinity,
  minZ: Infinity, maxZ: -Infinity,
});
function growBounds(bounds: Bounds, x: number, y: number, z: number): void {
  bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
  bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y);
  bounds.minZ = Math.min(bounds.minZ, z); bounds.maxZ = Math.max(bounds.maxZ, z);
}
function isFiniteBounds(bounds: Bounds): boolean {
  return Object.values(bounds).every(Number.isFinite)
    && bounds.maxX > bounds.minX && bounds.maxY > bounds.minY && bounds.maxZ > bounds.minZ;
}
function restBonePosition(mesh: SkinnedMesh, index: number, meshMatrix: Matrix4): Vector3 | null {
  const inverseBind = mesh.skeleton.boneInverses[index];
  if (!inverseBind || !finiteMatrix(inverseBind) || Math.abs(inverseBind.determinant()) < 1e-12) return null;
  // The inverse bind matrix is the source of truth for the authored rest pose. Never read the live
  // animated bone.matrixWorld here: appearance changes can happen while a clip is playing.
  return new Vector3().setFromMatrixPosition(inverseBind.clone().invert()).applyMatrix4(meshMatrix);
}
function normalizeResult(appearance: AvatarAppearance): Readonly<AvatarAppearance> {
  return Object.freeze({
    height: appearance.height,
    build: appearance.build,
    ageAppearance: appearance.ageAppearance,
  });
}
function sameAppearance(a: AvatarAppearance, b: AvatarAppearance): boolean {
  return a.height === b.height && a.build === b.build && a.ageAppearance === b.ageAppearance;
}
function morphAmount(age: AvatarAgeAppearance): number {
  return age === 'elder' ? 1 : age === 'mature' ? 0.55 : 0;
}

/**
 * Build a bounded, per-mesh cosmetic controller for the current skinned body.
 *
 * Only a small face region is changed for `mature`/`elder`; it is derived from immutable source
 * positions, skin-region weights, and Head/neck inverse-bind transforms. `adult` restores the
 * original position attribute object exactly. The controller never disposes the shared geometry,
 * skeleton, indices, materials, or source attributes.
 *
 * @example
 * const made = createAvatarAppearanceController(skinnedMesh)
 * if (made.ok) { made.controller.apply(look.appearance); body.dispose = () => made.controller.dispose() }
 */
export function createAvatarAppearanceController(input: unknown): AppearanceControllerResult {
  if (!(input instanceof SkinnedMesh)) return { ok: false, reason: 'not_skinned_mesh' };
  const mesh = input;
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  const skinIndex = geometry.getAttribute('skinIndex');
  const skinWeight = geometry.getAttribute('skinWeight');
  const region = geometry.getAttribute('color');
  if (!position || position.itemSize !== 3 || position.count === 0) return { ok: false, reason: 'missing_position' };
  if (!skinIndex || skinIndex.itemSize < 4 || !skinWeight || skinWeight.itemSize < 4) return { ok: false, reason: 'missing_skin_attributes' };
  if (!region || region.itemSize < 4) return { ok: false, reason: 'missing_region_attribute' };
  const headIndex = mesh.skeleton.bones.findIndex((bone) => bone.name === 'Head');
  const neckIndex = mesh.skeleton.bones.findIndex((bone) => bone.name === 'neck_01');
  if (headIndex < 0 || neckIndex < 0) return { ok: false, reason: 'missing_rest_bones' };

  // GLTF quantization can put the metre conversion in this node matrix. Freeze that source matrix
  // and its inverse once; all editing below is performed in body metres, then mapped back to the
  // matching local coordinate system for the replacement Float32 attribute.
  const meshMatrix = mesh.matrix.clone();
  if (!finiteMatrix(meshMatrix) || Math.abs(meshMatrix.determinant()) < 1e-12) return { ok: false, reason: 'invalid_transform' };
  const inverseMeshMatrix = meshMatrix.clone().invert();
  const headRest = restBonePosition(mesh, headIndex, meshMatrix);
  const neckRest = restBonePosition(mesh, neckIndex, meshMatrix);
  if (!headRest || !neckRest) return { ok: false, reason: 'missing_rest_bones' };

  const count = position.count;
  const sourceLocal = new Float64Array(count * 3);
  const sourceBody = new Float64Array(count * 3);
  const headBounds = emptyBounds();
  const headVertices: number[] = [];
  const point = new Vector3();
  for (let index = 0; index < count; index++) {
    const at = index * 3;
    const x = position.getX(index), y = position.getY(index), z = position.getZ(index);
    if (![x, y, z].every(Number.isFinite)) return { ok: false, reason: 'invalid_transform' };
    sourceLocal[at] = x; sourceLocal[at + 1] = y; sourceLocal[at + 2] = z;
    point.set(x, y, z).applyMatrix4(meshMatrix);
    sourceBody[at] = point.x; sourceBody[at + 1] = point.y; sourceBody[at + 2] = point.z;

    let headWeight = 0;
    for (let component = 0; component < 4; component++) {
      if (readComponent(skinIndex, index, component) === headIndex) headWeight += readComponent(skinWeight, index, component);
    }
    const skinRegion = region.getX(index), hairRegion = region.getW(index);
    if (headWeight >= 0.25 && skinRegion >= 0.45 && hairRegion <= 0.2 && point.y >= neckRest.y - 0.015) {
      headVertices.push(index);
      growBounds(headBounds, point.x, point.y, point.z);
    }
  }
  if (!isFiniteBounds(headBounds)) return { ok: false, reason: 'no_face_region' };

  const width = headBounds.maxX - headBounds.minX;
  const neckGap = headRest.y - neckRest.y;
  if (!Number.isFinite(neckGap) || neckGap < 0.02) return { ok: false, reason: 'missing_rest_bones' };
  const faceBaseY = Math.max(headBounds.minY, neckRest.y + neckGap * 0.8);
  const faceHeight = headBounds.maxY - faceBaseY;
  const height = headBounds.maxY - headBounds.minY;
  const depth = headBounds.maxZ - headBounds.minZ;
  if (width < 0.04 || height < 0.06 || depth < 0.04) return { ok: false, reason: 'no_face_region' };
  const centerX = headRest.x;
  const frontStart = headBounds.minZ + depth * 0.62;
  const candidates: FaceVertex[] = [];
  for (const index of headVertices) {
    const at = index * 3, x = sourceBody[at]!, y = sourceBody[at + 1]!, z = sourceBody[at + 2]!;
    const heightFraction = (y - faceBaseY) / faceHeight;
    const front = smoothstep(frontStart, headBounds.minZ + depth * 0.78, z);
    if (front < 0.5 || heightFraction < 0.04 || heightFraction > 0.96) continue;
    candidates.push({
      index, x, y, z, height: heightFraction,
      side: Math.max(-1, Math.min(1, (x - centerX) / (width * 0.5))),
      front,
    });
  }
  if (candidates.length === 0) return { ok: false, reason: 'no_face_region' };

  let current = normalizeResult(DEFAULT_AVATAR_APPEARANCE);
  let activePosition: Attribute = position;
  let morphedPosition: Float32BufferAttribute | null = null;
  let disposed = false;

  function usePosition(next: Attribute): void {
    if (activePosition === next) return;
    // Three releases only currently attached attribute buffers when a geometry is disposed.
    geometry.dispose();
    geometry.setAttribute('position', next);
    activePosition = next;
  }

  function restore(appearance: AvatarAppearance = DEFAULT_AVATAR_APPEARANCE): void {
    if (geometry.getAttribute('position') === activePosition) usePosition(position);
    activePosition = position;
    current = normalizeResult(appearance);
  }

  function apply(value: unknown): AppearanceResult {
    if (disposed) return { ok: false, reason: 'disposed' };
    if (mesh.geometry !== geometry || geometry.getAttribute('position') !== activePosition) return { ok: false, reason: 'mesh_changed' };
    const next = normalizeResult(normalizeAvatarAppearance(value));
    if (sameAppearance(current, next)) return { ok: true, appearance: next, changed: false };
    if (next.ageAppearance === current.ageAppearance) {
      current = next;
      return { ok: true, appearance: next, changed: false };
    }
    if (next.ageAppearance === 'adult') {
      restore(next);
      return { ok: true, appearance: next, changed: true };
    }

    const amount = morphAmount(next.ageAppearance);
    const maxDown = next.ageAppearance === 'elder' ? 0.0038 : 0.0022;
    const maxWidth = next.ageAppearance === 'elder' ? 0.002 : 0.0012;
    const forehead = next.ageAppearance === 'elder' ? 0.001 : 0.0006;
    morphedPosition ??= new Float32BufferAttribute(new Float32Array(sourceLocal.length), 3)
      .setUsage(position instanceof InterleavedBufferAttribute ? position.data.usage : position.usage);
    const output = morphedPosition.array;
    output.set(sourceLocal);
    const minX = headBounds.minX, maxX = headBounds.maxX;
    const minY = headBounds.minY, maxY = headBounds.maxY;
    const minZ = headBounds.minZ, maxZ = headBounds.maxZ;
    for (const vertex of candidates) {
      const jaw = smoothstep(0.04, 0.22, vertex.height) * (1 - smoothstep(0.36, 0.5, vertex.height));
      const cheek = smoothstep(0.2, 0.34, vertex.height) * (1 - smoothstep(0.58, 0.7, vertex.height));
      const sideWeight = smoothstep(0.12, 0.48, Math.abs(vertex.side));
      const foreheadWeight = smoothstep(0.68, 0.82, vertex.height) * (1 - smoothstep(0.92, 0.99, vertex.height));
      const cheekShape = cheek * sideWeight * vertex.front;
      const jawShape = jaw * vertex.front;
      const bodyPoint = new Vector3(
        Math.max(minX, Math.min(maxX, vertex.x + Math.sign(vertex.side) * maxWidth * amount * cheekShape)),
        Math.max(minY, Math.min(maxY, vertex.y - maxDown * amount * (0.55 * jawShape + 0.45 * cheekShape))),
        Math.max(minZ, Math.min(maxZ, vertex.z - forehead * amount * foreheadWeight * vertex.front)),
      );
      bodyPoint.applyMatrix4(inverseMeshMatrix);
      const at = vertex.index * 3;
      output[at] = bodyPoint.x; output[at + 1] = bodyPoint.y; output[at + 2] = bodyPoint.z;
    }
    morphedPosition.needsUpdate = true;
    usePosition(morphedPosition);
    current = next;
    return { ok: true, appearance: next, changed: true };
  }

  const controller: AvatarAppearanceController = {
    get appearance() { return current; },
    apply,
    reset() { if (!disposed && mesh.geometry === geometry) restore(); },
    dispose() {
      if (disposed) return;
      if (mesh.geometry === geometry) restore();
      disposed = true;
    },
  };
  return { ok: true, controller };
}
