import * as THREE from 'three';
import familyAnchorData from './native-family-rig-audit/family-anchor-coefficients.json' with { type: 'json' };

interface AnchorRecord {
  sourceRigName: string;
  parent: string | null;
  strategy: 'MEAN' | 'CUBE';
  anchor: number[] | string;
  neutral: [number, number, number];
  male: [number, number, number];
  female: [number, number, number];
}
interface AnchorData {
  schema: string;
  upstreamCommit: string;
  sourceGlbSha256: string;
  expressiveGlbSha256: string;
  anchors: Record<string, AnchorRecord>;
}

const ANCHORS = familyAnchorData as unknown as AnchorData;
const EXPECTED_MESHES = ['Body', 'Eyes', 'Teeth', 'Tongue'] as const;
const NEUTRAL_TOLERANCE_METERS = 0.00015;
const CORRECTED_TOLERANCE_METERS = 0.00002;

export interface NativeFamilyRigMetrics {
  readonly familyWeights: Readonly<{ male: number; female: number }>;
  readonly boneCount: number;
  readonly skeletonWrapperCount: number;
  readonly correctedMeshes: readonly string[];
  readonly maxNeutralAnchorErrorMeters: number;
  readonly maxCorrectedAnchorErrorMeters: number;
}

export interface NativeFamilyRigCorrection {
  readonly metrics: NativeFamilyRigMetrics;
  /** Restore exact bone locals and inverse-bind arrays captured before correction. Idempotent. */
  restore(): void;
  /** Alias for restore; call before releasing the actor's skeleton wrappers. */
  dispose(): void;
}

type BoneState = { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 };
type SkeletonState = { skeleton: THREE.Skeleton; inverses: THREE.Matrix4[] };

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Native family rig correction: ${message}`);
}

function distance(a: THREE.Vector3, b: readonly number[]): number {
  const dx = a.x - b[0]!;
  const dy = a.y - b[1]!;
  const dz = a.z - b[2]!;
  return Math.hypot(dx, dy, dz);
}

function collectMeshes(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh) meshes.push(mesh);
  });
  invariant(meshes.length === EXPECTED_MESHES.length,
    `expected the four authored skinned meshes, got ${meshes.map((mesh) => mesh.name).join(', ')}`);
  for (const name of EXPECTED_MESHES) {
    invariant(meshes.some((mesh) => mesh.name === name), `missing authored mesh ${name}`);
  }
  return meshes;
}

function depth(bone: THREE.Bone): number {
  let value = 0;
  let parent = bone.parent;
  while (parent instanceof THREE.Bone) { value++; parent = parent.parent; }
  return value;
}

function readFamilyWeights(body: THREE.SkinnedMesh): { male: number; female: number } {
  const dict = body.morphTargetDictionary;
  const values = body.morphTargetInfluences;
  invariant(dict && values, 'Body has no morph target dictionary/influences');
  const feminineIndex = dict.bodyFeminine;
  const masculineIndex = dict.bodyMasculine;
  invariant(Number.isInteger(feminineIndex) && Number.isInteger(masculineIndex),
    'Body is missing bodyFeminine/bodyMasculine morph targets');
  const female = values[feminineIndex!]!;
  const male = values[masculineIndex!]!;
  invariant(Number.isFinite(female) && Number.isFinite(male) && female >= 0 && male >= 0,
    `invalid family morph influences ${female}/${male}`);
  const sum = female + male;
  invariant(sum > 1e-8, 'family morph weights are both zero; family is ambiguous');
  return { male: male / sum, female: female / sum };
}

function sameMatrix(a: THREE.Matrix4, b: THREE.Matrix4, tolerance = 1e-6): boolean {
  for (let i = 0; i < 16; i++) if (Math.abs(a.elements[i]! - b.elements[i]!) > tolerance) return false;
  return true;
}

function assertSkeletonSet(meshes: readonly THREE.SkinnedMesh[]): THREE.Bone[] {
  const first = meshes[0]!.skeleton;
  invariant(first.bones.length === Object.keys(ANCHORS.anchors).length,
    `expected ${Object.keys(ANCHORS.anchors).length} bones, got ${first.bones.length}`);
  const names = new Set<string>();
  for (let index = 0; index < first.bones.length; index++) {
    const bone = first.bones[index];
    invariant(bone, `missing bone at index ${index}`);
    const anchor = ANCHORS.anchors[bone.name];
    invariant(anchor, `unrecognized bone name ${bone.name}`);
    invariant(!names.has(bone.name), `duplicate bone ${bone.name}`);
    names.add(bone.name);
    const parentBone = bone.parent instanceof THREE.Bone ? bone.parent : null;
    invariant((parentBone?.name ?? null) === anchor.parent,
      `parent mismatch for ${bone.name}: expected ${anchor.parent}, got ${parentBone?.name ?? null}`);
  }
  for (const mesh of meshes) {
    invariant(mesh.skeleton.bones.length === first.bones.length
      && mesh.skeleton.bones.every((bone, index) => bone === first.bones[index]),
    `${mesh.name} does not share the actor's exact bone objects/order`);
    invariant(mesh.skeleton.boneInverses.length === first.boneInverses.length,
      `${mesh.name} inverse-bind count does not match its bones`);
    for (let i = 0; i < first.boneInverses.length; i++) {
      invariant(sameMatrix(mesh.skeleton.boneInverses[i]!, first.boneInverses[i]!),
        `${mesh.name} has a different neutral inverse-bind matrix at bone ${i}`);
    }
  }
  return first.bones;
}

function localAnchorError(
  root: THREE.Object3D,
  bones: readonly THREE.Bone[],
  select: (record: AnchorRecord) => readonly number[],
): number {
  root.updateMatrixWorld(true);
  const inverseRoot = root.matrixWorld.clone().invert();
  let max = 0;
  for (const bone of bones) {
    const actual = bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseRoot);
    max = Math.max(max, distance(actual, select(ANCHORS.anchors[bone.name]!)));
  }
  return max;
}

/**
 * Recompute a freshly loaded actor's private 52-bone rest from its applied family morph weights.
 * Call immediately after loadCompleteCharacter(), before native pose controllers, presentation rigs,
 * or world placement. It does not alter geometry, morph weights, the actor root transform, or templates.
 */
export function applyNativeFamilyRigCorrection(root: THREE.Object3D): NativeFamilyRigCorrection {
  invariant(ANCHORS.schema === 'threews-native-family-anchor-coefficients-v1', 'coefficient schema mismatch');
  invariant(ANCHORS.upstreamCommit === 'ec8d1d270b93b8e2e87e8a6160bb908665fe1fcd', 'coefficient source commit mismatch');
  const meshes = collectMeshes(root);
  const body = meshes.find((mesh) => mesh.name === 'Body')!;
  const familyWeights = readFamilyWeights(body);
  const bones = assertSkeletonSet(meshes);
  const skeletons = [...new Set(meshes.map((mesh) => mesh.skeleton))];
  const boneStates = new Map<THREE.Bone, BoneState>(bones.map((bone) => [bone, {
    position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone(),
  }]));
  const skeletonStates: SkeletonState[] = skeletons.map((skeleton) => ({
    skeleton,
    inverses: skeleton.boneInverses.map((matrix) => matrix.clone()),
  }));
  let restored = false;
  const restore = (): void => {
    if (restored) return;
    restored = true;
    for (const [bone, state] of boneStates) {
      bone.position.copy(state.position);
      bone.quaternion.copy(state.quaternion);
      bone.scale.copy(state.scale);
      bone.updateMatrix();
    }
    for (const state of skeletonStates) {
      state.skeleton.boneInverses = state.inverses.map((matrix) => matrix.clone());
    }
    root.updateMatrixWorld(true);
    for (const state of skeletonStates) state.skeleton.update();
  };

  try {
    // A mixer may have sampled idle at t=0 during loading. Re-enter the exact source bind pose
    // before checking its anchor table and constructing a family-specific rest.
    skeletons[0]!.pose();
    root.updateMatrixWorld(true);
    const maxNeutralAnchorErrorMeters = localAnchorError(root, bones, (record) => record.neutral);
    invariant(maxNeutralAnchorErrorMeters <= NEUTRAL_TOLERANCE_METERS,
      `loaded source neutral anchors do not match the pinned source table (${maxNeutralAnchorErrorMeters} m)`);

    const desired = (record: AnchorRecord): THREE.Vector3 => new THREE.Vector3(
      record.male[0] * familyWeights.male + record.female[0] * familyWeights.female,
      record.male[1] * familyWeights.male + record.female[1] * familyWeights.female,
      record.male[2] * familyWeights.male + record.female[2] * familyWeights.female,
    );
    const rootWorld = root.matrixWorld.clone();
    const ordered = [...bones].sort((a, b) => depth(a) - depth(b));
    for (const bone of ordered) {
      const parent = bone.parent;
      invariant(parent, `${bone.name} has no parent object`);
      parent.updateWorldMatrix(true, false);
      const parentInverse = parent.matrixWorld.clone().invert();
      const worldTarget = desired(ANCHORS.anchors[bone.name]!).applyMatrix4(rootWorld);
      bone.position.copy(worldTarget.applyMatrix4(parentInverse));
      bone.updateMatrix();
      bone.updateWorldMatrix(true, false);
    }
    root.updateMatrixWorld(true);

    // Bone matrices must be actor-root-relative. calculateInverses() would include an already
    // placed actor root, so derive the same local bind inverses explicitly without moving the root.
    const inverseRoot = root.matrixWorld.clone().invert();
    for (const skeleton of skeletons) {
      skeleton.boneInverses = skeleton.bones.map((bone) => {
        invariant(bone, 'null bone in authored skeleton');
        return inverseRoot.clone().multiply(bone.matrixWorld).invert();
      });
      skeleton.update();
    }
    const maxCorrectedAnchorErrorMeters = localAnchorError(root, bones, (record) => {
      const target = desired(record);
      return [target.x, target.y, target.z];
    });
    invariant(maxCorrectedAnchorErrorMeters <= CORRECTED_TOLERANCE_METERS,
      `corrected anchors do not match source family anchors (${maxCorrectedAnchorErrorMeters} m)`);
    const metrics: NativeFamilyRigMetrics = Object.freeze({
      familyWeights: Object.freeze({ ...familyWeights }),
      boneCount: bones.length,
      skeletonWrapperCount: skeletons.length,
      correctedMeshes: Object.freeze(meshes.map((mesh) => mesh.name)),
      maxNeutralAnchorErrorMeters,
      maxCorrectedAnchorErrorMeters,
    });
    return { metrics, restore, dispose: restore };
  } catch (error) {
    restore();
    throw error;
  }
}
