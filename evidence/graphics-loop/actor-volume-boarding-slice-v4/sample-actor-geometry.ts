import * as THREE from 'three';

export type ActorRendererPath = 'skinned' | 'procedural-fallback';
export type ActorSamplePose = 'idle' | 'walk' | 'jog' | 'sit' | 'entry' | 'exit' | 'other';
export type ActorSampleState = 'ready' | 'unknown';
export type ActorShaderPath = 'three-default-skinning' | 'production-body-skinning' | 'production-wardrobe-fabric';

export interface ActorSamplePhase {
  readonly hostPhase: string;
  readonly pose: ActorSamplePose;
  readonly easing: boolean;
  readonly sampleTimeSeconds: number;
  readonly gaitPhaseRadians: number | null;
  readonly transitionClip: string | null;
  readonly transitionProgress: number | null;
}

export interface ActorSampleHostContext {
  readonly rendererPath: ActorRendererPath;
  /** Canonical normalized look, seed, resolved wearable ids, body family, and presentation. */
  readonly appearanceKey: string;
  readonly phase: ActorSamplePhase;
}

declare const identityBrand: unique symbol;
export interface ActorSampleIdentity extends ActorSampleHostContext {
  readonly rootMatrixWorld: readonly number[];
  readonly attestor: 'allworld-host-sample-v3';
  readonly [identityBrand]: true;
}

export interface ActorPositionProgramAttestation {
  readonly shaderPath: ActorShaderPath;
  readonly material: THREE.Material;
  readonly sourceSha256: string;
  readonly programCacheKey: string;
  readonly materialType: string;
  readonly onBeforeCompile: THREE.Material['onBeforeCompile'];
}

export interface ActorSoleInput {
  /** Must be body.object.parent: FootContact points are returned in this parent-local frame. */
  readonly frameNode: THREE.Object3D;
  readonly contacts: readonly {
    readonly side: 'left' | 'right';
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly points?: readonly { readonly x: number; readonly y: number; readonly z: number }[];
  }[];
}

export interface ActorGeometrySampleInput {
  /** The complete actor subtree, including body and wardrobe sibling meshes. */
  readonly root: THREE.Object3D;
  readonly identity: ActorSampleIdentity;
  readonly soles: ActorSoleInput | null;
  /** Exact per-material shader attestations created by the trusted host path. Missing material means unknown. */
  readonly positionPrograms: readonly ActorPositionProgramAttestation[];
}

export type ActorSoleSample =
  | Readonly<{ state: 'ready'; coordinateFrame: 'body-parent-to-world'; sides: readonly ['left', 'right']; points: readonly { readonly side: 'left' | 'right'; readonly points: readonly (readonly [number, number, number])[] }[] }>
  | Readonly<{ state: 'unknown'; reason: string }>;

export interface ActorGeometryReady {
  readonly state: 'ready';
  readonly frame: 'scene-world';
  readonly units: 'scene-units';
  readonly identity: ActorSampleIdentity;
  readonly bounds: readonly [number, number, number, number, number, number];
  /** Active indexed geometry triangles; this is not a frustum or occlusion count. */
  readonly activeGeometryTriangles: number;
  readonly sampledVertexCount: number;
  readonly sampledMeshes: readonly { readonly name: string; readonly triangles: number }[];
  readonly soles: ActorSoleSample;
  readonly evidence: 'current-rendered-geometry-sample-only';
}

export interface ActorGeometryUnknown {
  readonly state: 'unknown';
  readonly reason: string;
  readonly identity: ActorSampleIdentity | null;
  readonly evidence: 'no-clearance-proof';
}
export type ActorGeometrySample = ActorGeometryReady | ActorGeometryUnknown;

const identityRecords = new WeakSet<object>();
const positionPrograms = new WeakMap<THREE.Material, ActorPositionProgramAttestation>();
const finite = (value: number): boolean => Number.isFinite(value);
const matrixIsFinite = (matrix: THREE.Matrix4): boolean => matrix.elements.every(finite);
const BODY_SOURCE_SHA256 = '4fa64261e15a7e104f527ad4782aff2bb80c53d559dc7a448d95d797d92c6bdb';
const WARDROBE_SOURCE_SHA256 = '4b053592fdc8efdad0e9cd5071cb853594c2db53829cd74116bf578f439f82da';
const THREE_LOCK_SHA256 = 'd3a82d0f0d7e750bee84042a2ab36dcaa655cf6e7c9bdb8047823e507112efa9';
const BODY_PROGRAM_KEY = 'allworld-body-sleep-socket-eyes-2';
const WARDROBE_PROGRAM_KEY = 'allworld-wardrobe-fabric-v2';

function frozenPhase(value: ActorSamplePhase): ActorSamplePhase {
  const phase = {
    hostPhase: value.hostPhase, pose: value.pose, easing: value.easing,
    sampleTimeSeconds: value.sampleTimeSeconds, gaitPhaseRadians: value.gaitPhaseRadians,
    transitionClip: value.transitionClip, transitionProgress: value.transitionProgress,
  };
  return Object.freeze(phase);
}

/**
 * Called by the trusted scene host after it has sampled pose, normalized look/seed and wearables.
 * It captures a defensive immutable copy; arbitrary structural identity objects are not accepted.
 */
export function attestActorSampleIdentity(root: THREE.Object3D, context: ActorSampleHostContext): ActorSampleIdentity {
  root.updateWorldMatrix(true, false);
  root.updateMatrixWorld(true);
  if (!matrixIsFinite(root.matrixWorld)) throw new Error('Cannot attest a non-finite actor root matrix');
  const phase = frozenPhase(context.phase);
  const identity = Object.freeze({
    rendererPath: context.rendererPath,
    appearanceKey: `${context.appearanceKey}`,
    phase,
    rootMatrixWorld: Object.freeze([...root.matrixWorld.elements]),
    attestor: 'allworld-host-sample-v3' as const,
  }) as ActorSampleIdentity;
  identityRecords.add(identity);
  return identity;
}

/**
 * Attests one exact material path. Production call sites must bind the source digest and key from
 * their reviewed source registry; a generic `true` callback cannot certify future shader edits.
 */
export function attestPositionProgram(
  material: THREE.Material,
  shaderPath: ActorShaderPath,
  sourceSha256: string,
): ActorPositionProgramAttestation | null {
  if (!material || !/^[a-f0-9]{64}$/.test(sourceSha256)) return null;
  const key = material.customProgramCacheKey();
  const expected = shaderPath === 'production-body-skinning'
    ? { sourceSha256: BODY_SOURCE_SHA256, key: BODY_PROGRAM_KEY }
    : shaderPath === 'production-wardrobe-fabric'
      ? { sourceSha256: WARDROBE_SOURCE_SHA256, key: WARDROBE_PROGRAM_KEY }
      : null;
  if (shaderPath === 'three-default-skinning') {
    // Three's stock onBeforeCompile is the only accepted generic path. Custom shader callbacks need an explicit production path.
    if (sourceSha256 !== THREE_LOCK_SHA256 || material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile || key !== THREE.Material.prototype.onBeforeCompile.toString()) return null;
  } else if (!expected || sourceSha256 !== expected.sourceSha256 || key !== expected.key
    || !(material.type === 'MeshStandardMaterial' || material.type === 'MeshLambertMaterial')) return null;
  const record = Object.freeze({ shaderPath, material, sourceSha256, programCacheKey: key, materialType: material.type, onBeforeCompile: material.onBeforeCompile });
  positionPrograms.set(material, record);
  return record;
}

const unknown = (reason: string, identity: ActorSampleIdentity | null = null): ActorGeometryUnknown => Object.freeze({
  state: 'unknown', reason, identity, evidence: 'no-clearance-proof',
});

function validateIdentity(identity: ActorSampleIdentity): string | null {
  if (!identityRecords.has(identity)) return 'identity-not-host-attested';
  if (identity.rendererPath !== 'skinned' && identity.rendererPath !== 'procedural-fallback') return 'invalid-renderer-path';
  if (typeof identity.appearanceKey !== 'string' || identity.appearanceKey.length === 0) return 'missing-appearance-key';
  if (!Array.isArray(identity.rootMatrixWorld) || identity.rootMatrixWorld.length !== 16 || !identity.rootMatrixWorld.every(finite)) return 'invalid-root-matrix';
  const phase = identity.phase;
  if (!phase || typeof phase.hostPhase !== 'string' || !phase.hostPhase
    || !['idle', 'walk', 'jog', 'sit', 'entry', 'exit', 'other'].includes(phase.pose)
    || typeof phase.easing !== 'boolean' || !finite(phase.sampleTimeSeconds) || phase.sampleTimeSeconds < 0
    || !(phase.gaitPhaseRadians === null || finite(phase.gaitPhaseRadians))
    || !(phase.transitionClip === null || typeof phase.transitionClip === 'string')
    || !(phase.transitionProgress === null || finite(phase.transitionProgress) && phase.transitionProgress >= 0 && phase.transitionProgress <= 1)) return 'invalid-sample-phase';
  return null;
}

function activeRanges(mesh: THREE.Mesh, indexCount: number): { material: THREE.Material; start: number; end: number }[] | null {
  const geometry = mesh.geometry, material = mesh.material;
  const drawStart = geometry.drawRange.start, drawCount = geometry.drawRange.count;
  if (!Number.isInteger(drawStart) || drawStart < 0 || !(drawCount === Infinity || Number.isInteger(drawCount) && drawCount >= 0)) return null;
  const drawEnd = Math.min(indexCount, drawCount === Infinity ? indexCount : drawStart + drawCount);
  const intersect = (start: number, count: number): [number, number] | null => {
    if (!Number.isInteger(start) || start < 0 || !(count === Infinity || Number.isInteger(count) && count >= 0)) return null;
    const end = Math.min(indexCount, count === Infinity ? indexCount : start + count);
    const first = Math.max(start, drawStart), last = Math.min(end, drawEnd);
    if (last <= first) return [0, 0];
    if (first % 3 !== 0 || (last - first) % 3 !== 0) return null;
    return [first, last];
  };
  const out: { material: THREE.Material; start: number; end: number }[] = [];
  if (Array.isArray(material)) {
    for (const group of geometry.groups) {
      const range = intersect(group.start, group.count);
      if (!range) return null;
      if (range[0] === range[1]) continue;
      const selected = material[group.materialIndex];
      if (!selected?.visible) continue;
      out.push({ material: selected, start: range[0], end: range[1] });
    }
  } else {
    const range = intersect(0, indexCount);
    if (!range) return null;
    if (range[0] !== range[1] && material.visible) out.push({ material, start: range[0], end: range[1] });
  }
  return out;
}

function sampleSoles(soles: ActorSoleInput | null): ActorSoleSample {
  if (!soles) return Object.freeze({ state: 'unknown', reason: 'no-foot-contact-sampler' });
  if (!soles.frameNode || !Array.isArray(soles.contacts) || soles.contacts.length !== 2) return Object.freeze({ state: 'unknown', reason: 'incomplete-foot-contact-pair' });
  const bySide = new Map(soles.contacts.map(contact => [contact.side, contact]));
  const left = bySide.get('left'), right = bySide.get('right');
  if (!left || !right || bySide.size !== 2) return Object.freeze({ state: 'unknown', reason: 'incomplete-foot-contact-pair' });
  try {
    soles.frameNode.updateWorldMatrix(true, true);
    const pointsBySide = [left, right].map(contact => {
      const localPoints = contact.points === undefined ? [contact] : contact.points;
      if (!localPoints.length) throw new Error('empty-foot-contact-side');
      const points = localPoints.map(point => {
        if (![point.x, point.y, point.z].every(finite)) throw new Error('invalid-foot-contact-point');
        const world = new THREE.Vector3(point.x, point.y, point.z).applyMatrix4(soles.frameNode.matrixWorld);
        if (![world.x, world.y, world.z].every(finite)) throw new Error('non-finite-world-foot-contact');
        return Object.freeze([world.x, world.y, world.z] as const);
      });
      return Object.freeze({ side: contact.side, points: Object.freeze(points) });
    });
    return Object.freeze({ state: 'ready', coordinateFrame: 'body-parent-to-world', sides: Object.freeze(['left', 'right'] as const), points: Object.freeze(pointsBySide) });
  } catch (error) {
    return Object.freeze({ state: 'unknown', reason: error instanceof Error ? error.message : 'foot-contact-conversion-failed' });
  }
}

/** Samples one current actor AABB, never a swept volume, occlusion result, or boarding decision. */
export function sampleActorGeometry(input: ActorGeometrySampleInput): ActorGeometrySample {
  const identity = input?.identity ?? null;
  if (!identity) return unknown('missing-sample-identity');
  const identityError = validateIdentity(identity);
  if (identityError) return unknown(identityError, identityRecords.has(identity) ? identity : null);
  if (!input?.root || !Array.isArray(input.positionPrograms)) return unknown('missing-root-or-position-program-attestations', identity);
  try {
    input.root.updateWorldMatrix(true, false);
    input.root.updateMatrixWorld(true);
  } catch { return unknown('world-matrix-update-failed', identity); }
  if (!matrixIsFinite(input.root.matrixWorld)) return unknown('non-finite-root-matrix', identity);
  if (input.root.matrixWorld.elements.some((value, index) => Math.abs(value - identity.rootMatrixWorld[index]!) > 1e-8)) return unknown('root-matrix-identity-mismatch', identity);

  const supplied = new Map<THREE.Material, ActorPositionProgramAttestation>();
  for (const record of input.positionPrograms) {
    if (!record || !record.material || positionPrograms.get(record.material) !== record || record.material.type !== record.materialType
      || record.material.onBeforeCompile !== record.onBeforeCompile || record.material.customProgramCacheKey() !== record.programCacheKey) return unknown('invalid-position-program-attestation', identity);
    supplied.set(record.material, record);
  }
  const low = new THREE.Vector3(Infinity, Infinity, Infinity), high = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const vertex = new THREE.Vector3(), world = new THREE.Vector3();
  const seen = new Map<THREE.Mesh, Set<number>>(), meshTriangles = new Map<THREE.Mesh, number>();
  let triangleCount = 0, failed: string | null = null;
  const visit = (node: THREE.Object3D, ancestorsVisible: boolean): void => {
    if (failed || !ancestorsVisible || !node.visible) return;
    const mesh = node as THREE.Mesh;
    if ((node as THREE.InstancedMesh).isInstancedMesh || (node as THREE.Line).isLine || (node as THREE.Points).isPoints
      || (node as THREE.Object3D & { isBatchedMesh?: boolean }).isBatchedMesh) { failed = `unsupported-renderable:${node.name || node.uuid}`; return; }
    if (mesh.isMesh) {
      const geometry = mesh.geometry, position = geometry.getAttribute('position'), index = geometry.index;
      if (!position || position.itemSize < 3) { failed = `missing-position:${mesh.name || mesh.uuid}`; return; }
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh && (!geometry.getAttribute('skinIndex') || !geometry.getAttribute('skinWeight'))) { failed = `missing-skin-attributes:${mesh.name || mesh.uuid}`; return; }
      const indexCount = index ? index.count : position.count, ranges = activeRanges(mesh, indexCount);
      if (!ranges) { failed = `unsupported-draw-ranges:${mesh.name || mesh.uuid}`; return; }
      if (!ranges.length) { for (const child of node.children) visit(child, true); return; }
      for (const range of ranges) {
        const record = supplied.get(range.material);
        if (!record || positionPrograms.get(range.material) !== record) { failed = `unattested-vertex-position-program:${mesh.name || mesh.uuid}`; return; }
        if (record.material.onBeforeCompile !== record.onBeforeCompile || record.material.customProgramCacheKey() !== record.programCacheKey) { failed = `position-program-changed:${mesh.name || mesh.uuid}`; return; }
      }
      const used = new Set<number>(); let triangles = 0;
      for (const range of ranges) for (let offset = range.start; offset < range.end; offset += 3) {
        const ids = [0, 1, 2].map(corner => index ? index.getX(offset + corner) : offset + corner);
        if (ids.some(id => !Number.isInteger(id) || id < 0 || id >= position.count)) { failed = `invalid-index:${mesh.name || mesh.uuid}`; return; }
        for (const id of ids) used.add(id);
        triangles++;
      }
      if (used.size) { seen.set(mesh, used); meshTriangles.set(mesh, triangles); triangleCount += triangles; }
    }
    for (const child of node.children) visit(child, true);
  };
  visit(input.root, true);
  if (failed) return unknown(failed, identity);
  if (!triangleCount) return unknown('no-visible-triangles', identity);

  let sampledVertexCount = 0;
  try {
    for (const [mesh, vertices] of seen) for (const id of vertices) {
      mesh.getVertexPosition(id, vertex); world.copy(vertex).applyMatrix4(mesh.matrixWorld);
      if (![world.x, world.y, world.z].every(finite)) return unknown(`non-finite-deformed-vertex:${mesh.name || mesh.uuid}`, identity);
      low.min(world); high.max(world); sampledVertexCount++;
    }
  } catch { return unknown('vertex-deformation-evaluation-failed', identity); }
  if (![low.x, low.y, low.z, high.x, high.y, high.z].every(finite)) return unknown('empty-or-invalid-bounds', identity);

  const immutableBounds = Object.freeze([low.x, low.y, low.z, high.x, high.y, high.z] as const);
  const meshes = Object.freeze([...meshTriangles].map(([mesh, triangles]) => Object.freeze({ name: mesh.name || mesh.uuid, triangles })));
  return Object.freeze({
    state: 'ready', frame: 'scene-world', units: 'scene-units', identity,
    bounds: immutableBounds, activeGeometryTriangles: triangleCount, sampledVertexCount,
    sampledMeshes: meshes, soles: sampleSoles(input.soles), evidence: 'current-rendered-geometry-sample-only',
  });
}
